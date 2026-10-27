import { ENDING_STATUSES, FORM_GONE_SETTLE, MODULE_ID, MOST_FORMS, NOT_FORM_FOLDERS } from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { recheckCombats } from "./campaign-combats.mjs";
import { characterChanged } from "./character-sync.mjs";
import { activeForm, endedForms, madeForm, noteFormDeleted, originalOf, playerOwners, transformed } from "./characters.mjs";
import { queueBusy, registerQueueSettled } from "./commands.mjs";
import { postEnding, wildShapeOn } from "./command-wildshape.mjs";
import { traitsOf } from "./sheet-details.mjs";
import { damageOf, toHitOf } from "./sheet-rolls.mjs";
import { finite, localize } from "./sheet-values.mjs";

/**
 * Wild Shape from the Sending Stone app, since module 0.40.0, by the 2024 rules: a druid of level 2
 * or more changes into one of the Beasts she knows, a use of her Wild Shape each time, for half her
 * druid level in hours, and back; she knows 4, 6 or 8 Beasts by her level, up to a Challenge Rating
 * her level (or Circle of the Moon) allows, none with a Fly Speed before level 8, and replaces one
 * after each Long Rest. Wild Shape ends as the rules end it: its hours of world time run out, or the
 * form drops to 0 hit points or is Incapacitated.
 *
 * dnd5e does the change itself, with its Wild Shape preset (`transformInto`), and the return
 * (`revertOriginalForm`), and keeps a druid's known forms where it built a place for them: her Wild
 * Shape's Transform activity's linked forms ("By Direct Link", one profile each), so dnd5e's sheet,
 * Tidy 5e and the app offer one list. What dnd5e leaves out this adds: the known forms' count, Challenge
 * Rating and Fly Speed checked, and the Beasts to learn read from the campaign's compendiums; the use
 * spent on her own feature; a record on the form of what it is, when it began and what she had going
 * in (`flags.sending-stone.form`); her tokens switched and put back on every scene, not only the one
 * the Gamemaster is viewing; its endings; and on every return, what she spent or gained in form, which
 * dnd5e's return would lose, carried back onto her own actor, added to anything done to her meanwhile.
 *
 * A transformation made in Foundry, Wild Shape or not, is recorded the same way on the client that
 * makes it, so the app follows it; a 2024 Wild Shape made there is timed and ended as one from the
 * app, while the campaign's switch is on.
 */

/**
 * The fields of a compendium's index a Beast is judged and listed by.
 * @type {string[]}
 */
const INDEX_FIELDS = [
  "system.details.cr", "system.details.type", "system.traits.size", "system.attributes.movement",
  "system.attributes.ac", "system.abilities.dex.value", "img", "folder"
];

/**
 * What a write of the module's own Wild Shape carries, so its hooks know it.
 * @type {string}
 */
const OWN = "wildShape";

/**
 * The partial token data dnd5e built for each change the app asked for, by the command's id: what
 * `switchTokens` writes on every scene, dropped once used.
 * @type {Map<string, object>}
 */
const tokenData = new Map();

/**
 * The forms this client is returning, by id, and each earlier form of their chains: their deletions
 * are a return's, which the deletion safety net leaves be.
 * @type {Set<string>}
 */
const returning = new Set();

/**
 * The characters whose Wild Shape this client is ending now, by id: one at a time each.
 * @type {Set<string>}
 */
const ending = new Set();

/**
 * The forms of the module's record deleted lately, on the bridge, by id, each with the earlier
 * forms of its chain it names, its kind, and whether its return copies spell slots, kept a while
 * past FORM_GONE_SETTLE: a chain's earlier form, which a later one carries on from, is never
 * carried back on its own (the deletion safety net).
 * @type {Map<string, {previous: string[], kind: string|null, slots: boolean}>}
 */
const gone = new Map();

/**
 * Each known form loaded, by uuid, as the sheet summarises it: null for one that can't be loaded, a
 * promise while it loads.
 * @type {Map<string, object|null|Promise<void>>}
 */
const summaries = new Map();

/**
 * The characters waiting on a form's summary, by its uuid: each sent again once it's loaded.
 * @type {Map<string, Set<string>>}
 */
const waiting = new Map();

/* -------------------------------------------- */
/*  The rules                                   */
/* -------------------------------------------- */

/**
 * A druid's Wild Shape: her feature with the identifier `wild-shape` and its Transform activity, on
 * her own actor; the first by sort, where a homebrew copy makes two.
 * @param {Actor|null|undefined} actor
 * @returns {{item: Item, activity: object}|null}
 */
export function wildShapeItemOf(actor) {
  const items = Array.from(actor?.items ?? [])
    .filter(item => (item.type === "feat") && (item.system?.identifier === "wild-shape"))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  for ( const item of items ) {
    const activity = Array.from(item.system?.activities ?? []).find(each => each.type === "transform");
    if ( activity ) return { item, activity };
  }
  return null;
}

/**
 * What the 2024 rules allow a druid now, from her own class and scale values: null for an actor
 * with no 2024 Wild Shape. Moon by her subclass's identifier, `moon`, as dnd5e's preset reads it.
 * @param {Actor|null|undefined} actor
 * @returns {{item: Item, activity: object, level: number, moon: boolean, cr: number, count: number,
 *   fly: boolean, hours: number, temp: number, acFloor: number|null}|null}
 */
export function wildShapeRules(actor) {
  const found = wildShapeItemOf(actor);
  const scale = actor?.system?.scale?.druid ?? {};
  const level = actor?.classes?.druid?.system?.levels ?? 0;
  if ( !found || !(level >= 2) || !Number.isFinite(scale["known-forms"]?.value) ) return null;
  const moon = (actor.getRollData().subclasses?.moon?.levels ?? 0) > 0;
  const cr = Math.max(scale["wild-shape"]?.value ?? 0, moon && (level >= 3) ? Math.floor(level / 3) : 0);
  const wis = actor.system.abilities?.wis?.mod ?? 0;
  return {
    ...found, level, moon, cr, count: scale["known-forms"].value, fly: level >= 8,
    hours: Math.floor(level / 2), temp: moon ? 3 * level : level, acFloor: moon ? 13 + wis : null
  };
}

/**
 * A druid's known forms: her Wild Shape's profiles that name a creature, in their order, while it
 * links forms (`transform.mode` ""); none while it's as dnd5e ships it, by Challenge Rating.
 * @param {object|null|undefined} activity   Her Wild Shape's Transform activity.
 * @returns {object[]}
 */
export function knownProfiles(activity) {
  if ( (activity?.transform?.mode ?? "cr") !== "" ) return [];
  return Array.from(activity.profiles ?? []).filter(profile => (typeof profile?.uuid === "string") && profile.uuid);
}

/* -------------------------------------------- */
/*  The pool                                    */
/* -------------------------------------------- */

/**
 * The compendium and entry a uuid names, if it names an Actor in one: `Compendium.<package>.<pack>.Actor.<id>`.
 * @param {unknown} uuid
 * @returns {{collection: string, id: string}|null}
 */
function packOf(uuid) {
  const parts = String(uuid ?? "").split(".");
  if ( (parts.length !== 5) || (parts[0] !== "Compendium") || (parts[3] !== "Actor") || !parts[4] ) return null;
  return { collection: `${parts[1]}.${parts[2]}`, id: parts[4] };
}

/**
 * Does a uuid name a Beast in one of the campaign's compendiums?
 * @param {unknown} uuid
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function inPool(uuid, campaign) {
  const found = packOf(uuid);
  return Boolean(found) && (campaign?.wildShapePacks ?? []).includes(found.collection);
}

/**
 * The campaign's compendiums its druids learn Beasts from, those of Actors the world has.
 * @param {Campaign} campaign
 * @returns {CompendiumCollection[]}
 */
export function poolOf(campaign) {
  return (campaign?.wildShapePacks ?? []).map(id => game.packs?.get(id)).filter(pack => pack?.documentName === "Actor");
}

/**
 * A pool form's index entry, with the fields it's judged by, read now; null where it's gone, or its
 * compendium is.
 * @param {string} uuid
 * @returns {Promise<{entry: object, pack: CompendiumCollection}|null>}
 */
export async function entryOf(uuid) {
  const found = packOf(uuid);
  const pack = found ? game.packs?.get(found.collection) : null;
  if ( !pack ) return null;
  const index = await pack.getIndex({ fields: INDEX_FIELDS });
  const entry = index?.get?.(found.id) ?? null;
  return entry ? { entry, pack } : null;
}

/**
 * May a druid learn, or change into, this Beast now, by the 2024 rules: a stat block of type Beast,
 * not a swarm, with a Challenge Rating within hers, no Fly Speed before level 8 (in dnd5e 5's shape
 * or 6's), and not a spell's, an item's or a summon's creature, as a pack folder (or one within
 * one) named so says. Read the same of an index entry and of a loaded document.
 * @param {object|null} entry
 * @param {object|null} rules    wildShapeRules'.
 * @param {CompendiumCollection|null} [pack]   Its compendium, whose folders it's in.
 * @returns {boolean}
 */
export function eligible(entry, rules, pack=null) {
  if ( !entry || !rules || (entry.type !== "npc") ) return false;
  const details = entry.system?.details ?? {};
  if ( (details.type?.value !== "beast") || details.type?.swarm ) return false;
  if ( !Number.isFinite(details.cr) || (details.cr > rules.cr) ) return false;
  if ( !rules.fly && flies(entry.system?.attributes?.movement) ) return false;
  return !inNotFormFolder(entry, pack);
}

/**
 * Has a creature a Fly Speed: under `movement.fly`, as dnd5e 5 keeps it and dnd5e 6's prepared
 * documents read it, or `movement.speeds.fly`, as dnd5e 6 saves it, which an index entry holds as
 * saved; either, as dnd5e 6's own Compendium Browser asks.
 * @param {object} [movement]
 * @returns {boolean}
 */
function flies(movement) {
  return [movement?.fly, movement?.speeds?.fly].some(speed => Number(speed) > 0);
}

/**
 * Is an entry in a pack folder whose creatures are no form, or in a folder within one?
 * @param {object} entry
 * @param {CompendiumCollection|null} pack
 * @returns {boolean}
 */
function inNotFormFolder(entry, pack) {
  const folders = pack?.folders;
  const folderOf = value => ((typeof value === "string") ? (folders?.get?.(value) ?? null) : (value ?? null));
  let folder = folderOf(entry.folder ?? entry._source?.folder);
  for ( let depth = 0; folder && (depth < 32); depth++ ) {
    if ( NOT_FORM_FOLDERS.includes(folder.name) ) return true;
    folder = folderOf(folder.folder);
  }
  return false;
}

/**
 * The Beasts a druid may learn now, from the campaign's compendiums, for the app's list: each with
 * what its index says, sorted by Challenge Rating then name, at most MOST_FORMS, with whether there
 * were more, and her limits. Nothing is loaded but the indexes.
 * @param {Campaign} campaign
 * @param {Actor} character
 * @returns {Promise<{forms: object[], more: boolean, limits: {count: number, cr: number, fly: boolean}}>}
 */
export async function beastsFor(campaign, character) {
  const rules = wildShapeRules(character);
  const known = new Set(knownProfiles(rules?.activity).map(profile => profile.uuid));
  const found = [];
  for ( const pack of poolOf(campaign) ) {
    const index = await pack.getIndex({ fields: INDEX_FIELDS });
    for ( const entry of index ?? [] ) {
      if ( !eligible(entry, rules, pack) ) continue;
      const uuid = entry.uuid ?? `Compendium.${pack.collection}.Actor.${entry._id}`;
      found.push({
        uuid, name: entry.name, img: entry.img ?? null, size: sizeLabel(entry), cr: entry.system.details.cr,
        ac: indexAc(entry), speeds: speedsOf(entry.system?.attributes?.movement), known: known.has(uuid)
      });
    }
  }
  found.sort((a, b) => (a.cr - b.cr) || a.name.localeCompare(b.name, game.i18n.lang));
  return {
    forms: found.slice(0, MOST_FORMS),
    more: found.length > MOST_FORMS,
    limits: { count: rules?.count ?? 0, cr: rules?.cr ?? 0, fly: rules?.fly ?? false }
  };
}

/**
 * A Beast's armor class as its index has it: its flat one where it's natural or flat, ten and its
 * Dexterity modifier where it's worked out by default, as a stat block's is with no armour; else null.
 * @param {object} entry
 * @returns {number|null}
 */
function indexAc(entry) {
  const ac = entry.system?.attributes?.ac ?? {};
  if ( ["natural", "flat"].includes(ac.calc) ) return finite(Number(ac.flat));
  const dex = entry.system?.abilities?.dex?.value;
  return ((ac.calc ?? "default") === "default") && Number.isFinite(dex) ? 10 + Math.floor((dex - 10) / 2) : null;
}

/**
 * A creature's size, as dnd5e labels it.
 * @param {object} creature   An actor or an index entry.
 * @returns {string|null}
 */
export function sizeLabel(creature) {
  const size = CONFIG.DND5E?.actorSizes?.[creature?.system?.traits?.size];
  return size ? (localize(size.label ?? size) || null) : null;
}

/**
 * Speeds, as the sheet labels them: "Walk 40 ft". Read from a loaded document, prepared, or from an
 * index entry, which holds them as saved: dnd5e 5 and 6 save each speed as a formula, "40", and the
 * units as null for the world's default, which only a prepared document has as its number and "ft".
 * So a speed saved as a plain number is read as one, any other formula left out, and missing units
 * are the world's default length, as dnd5e prepares them.
 * @param {object} [movement]
 * @returns {string[]}
 */
function speedsOf(movement) {
  if ( !movement ) return [];
  const asSaved = speeds => {
    if ( !speeds || (typeof speeds !== "object") ) return speeds;
    const read = { ...speeds };
    for ( const key of Object.keys(CONFIG.DND5E?.movementTypes ?? {}) ) {
      if ( typeof read[key] === "string" ) read[key] = /^\s*\d+(\.\d+)?\s*$/.test(read[key]) ? Number(read[key]) : null;
    }
    return read;
  };
  const read = asSaved(movement);
  if ( movement.speeds ) read.speeds = asSaved(movement.speeds);
  read.units ??= defaultLength();
  return traitsOf({ system: { attributes: { movement: read } } }).find(trait => trait.id === "speeds")?.values ?? [];
}

/**
 * The world's default unit of length, as dnd5e prepares a creature's speeds with it: "ft", or "m"
 * where the world uses metric lengths; null where dnd5e can't say.
 * @returns {string|null}
 */
function defaultLength() {
  try {
    return globalThis.dnd5e?.utils?.defaultUnits?.("length") ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------- */
/*  Known forms' summaries                      */
/* -------------------------------------------- */

/**
 * A pool form's summary, loaded once on this client and kept for the session: undefined while it
 * loads, which sends the character's sheet again once it's done; null where it can't be loaded.
 * @param {string} uuid
 * @param {Actor} original   Whose sheet waits on it.
 * @returns {object|null|undefined}
 */
export function formSummary(uuid, original) {
  const held = summaries.get(uuid);
  if ( (held !== undefined) && !(held instanceof Promise) ) return held;
  if ( !waiting.has(uuid) ) waiting.set(uuid, new Set());
  if ( original?.id ) waiting.get(uuid).add(original.id);
  if ( !held ) summaries.set(uuid, load(uuid));
  return undefined;
}

/**
 * Load a pool form and summarise it, then send again each character waiting on it.
 * @param {string} uuid
 * @returns {Promise<void>}
 */
async function load(uuid) {
  let document = null;
  try {
    document = await fromUuid(uuid);
  } catch {
    document = null;
  }
  summaries.set(uuid, (document?.documentName === "Actor") ? summarise(document) : null);
  const ids = waiting.get(uuid) ?? new Set();
  waiting.delete(uuid);
  for ( const id of ids ) characterChanged(game.actors.get(id) ?? null);
}

/**
 * What a known form's sheet entry says of it, from the prepared document: its name, portrait, size,
 * Challenge Rating, armor class, speeds and first attack, and what it's judged by.
 * @param {Actor} source
 * @returns {object}
 */
function summarise(source) {
  const system = source.system ?? {};
  return {
    name: source.name,
    img: source.img ?? null,
    size: sizeLabel(source),
    cr: finite(system.details?.cr),
    ac: finite(system.attributes?.ac?.value),
    speeds: speedsOf(system.attributes?.movement),
    attack: attackOf(source),
    facts: {
      type: source.type,
      system: {
        details: { cr: system.details?.cr, type: { value: system.details?.type?.value, swarm: system.details?.type?.swarm } },
        attributes: { movement: { fly: system.attributes?.movement?.fly, speeds: { fly: system.attributes?.movement?.speeds?.fly } } }
      },
      folder: source.folder?.id ?? source._source?.folder ?? source.folder ?? null
    }
  };
}

/**
 * A creature's first attack, its items in their sort order: its name, bonus to hit and damage.
 * @param {Actor} source
 * @returns {{name: string, toHit: number|null, damage: string|null}|null}
 */
function attackOf(source) {
  const items = Array.from(source.items ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  for ( const item of items ) {
    const activity = Array.from(item.system?.activities ?? []).find(each => each.type === "attack");
    if ( activity ) return { name: item.name, toHit: toHitOf(activity), damage: damageOf(activity)[0]?.formula ?? null };
  }
  return null;
}

/**
 * A known form's name for the app: its profile's own, which dnd5e leaves blank for a form added by
 * a drop on its sheet, using the source's name instead; else, never loading it, the name the
 * character's players could see already: a pool form's from its compendium's index, another
 * compendium's where each of them may observe that compendium, a world actor's where each may
 * observe the actor; else the words for a form from Foundry, a bare name as any other, which the
 * app gives "a" or "an" as it does a Beast's.
 * @param {object} profile
 * @param {Actor} original
 * @param {Campaign} campaign
 * @returns {string}
 */
export function formName(profile, original, campaign) {
  if ( String(profile?.name ?? "").trim() ) return profile.name;
  const players = playerOwners(original);
  const seenBy = document => Boolean(players.length) && players.every(user => document?.testUserPermission?.(user, "OBSERVER"));
  const found = packOf(profile?.uuid);
  let name = null;
  if ( found ) {
    const pack = game.packs?.get(found.collection);
    if ( pack && (inPool(profile.uuid, campaign) || seenBy(pack)) ) name = pack.index?.get?.(found.id)?.name ?? null;
  } else {
    const [kind, id, ...rest] = String(profile?.uuid ?? "").split(".");
    const actor = ((kind === "Actor") && id && !rest.length) ? game.actors.get(id) : null;
    if ( actor && seenBy(actor) ) name = actor.name;
  }
  return name || localize("SENDINGSTONE.WildShape.FromFoundry");
}

/**
 * Does a pool form fit a druid now: by its loaded document where it has been, else by its pack's
 * index as it stands; false where neither says.
 * @param {string} uuid
 * @param {object|null|undefined} summary
 * @param {object} rules
 * @returns {boolean}
 */
export function fitsNow(uuid, summary, rules) {
  const found = packOf(uuid);
  const pack = found ? (game.packs?.get(found.collection) ?? null) : null;
  if ( summary?.facts ) return eligible(summary.facts, rules, pack);
  const entry = pack?.index?.get?.(found.id);
  return entry?.system ? eligible(entry, rules, pack) : false;
}

/* -------------------------------------------- */
/*  The record                                  */
/* -------------------------------------------- */

/**
 * The profile of a druid's known forms that names this creature, if one does.
 * @param {Actor} original
 * @param {string} uuid
 * @returns {string|null}
 */
function profileOf(original, uuid) {
  return knownProfiles(wildShapeItemOf(original)?.activity).find(profile => profile.uuid === uuid)?._id ?? null;
}

/**
 * Write the record into a form's creation data, before dnd5e creates it, whoever transforms and from
 * wherever: what it is, when it began, how long the rules give it where they time it, the profile
 * and command it was made for, and what she had going in, which a form made from a form inherits.
 * @param {Actor} host       The actor transformed: she, or a form of hers.
 * @param {Actor} source     What it's transformed into.
 * @param {object} data      The creation data, mutated.
 * @param {object} settings  dnd5e's TransformationSetting.
 * @param {object} options   The creation's options, `sendingStone` the app's.
 * @returns {void}
 */
function record(host, source, data, settings, options) {
  const original = originalOf(host) ?? host;
  const wild = (settings?.preset === "wildshape") && Boolean(original.classes?.druid);
  const rules = wild ? wildShapeRules(original) : null;
  const earlier = transformed(host) ? host.getFlag(MODULE_ID, "form") : null;
  const now = game.time?.worldTime ?? 0;
  data.flags ??= {};
  data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), form: {
    kind: wild ? "wildShape" : "other",
    uuid: source.uuid, name: source.name, img: source.img ?? null,
    cr: finite(source.system?.details?.cr), type: source.system?.details?.type?.label || null,
    size: sizeLabel(source), startedAt: now,
    hours: rules ? rules.hours : null, endsAt: rules ? now + (rules.hours * 3600) : null,
    profile: options?.sendingStone?.profile ?? profileOf(original, source.uuid),
    request: options?.sendingStone?.request ?? null,
    baseline: earlier?.baseline ?? baselineOf(original, data)
  } };
  if ( options?.sendingStone?.request ) tokenData.set(options.sendingStone.request, foundry.utils.deepClone(data.prototypeToken));
}

/**
 * What she had going in, for the carry-back's sums: her hit points and temporary ones; each of her
 * items the form keeps, its uses spent and each activity's; each class's hit dice spent; her Heroic
 * Inspiration, exhaustion and death saves; which of her own effects the form carries; and each of
 * her spell slot pools' value.
 * @param {Actor} original
 * @param {object} data   The form's creation data.
 * @returns {object}
 */
function baselineOf(original, data) {
  const kept = new Set((data.items ?? []).map(item => item?._id));
  const carried = new Set((data.effects ?? []).map(effect => effect?._id));
  const attributes = original.system?.attributes ?? {};
  const items = {};
  for ( const item of original.items ?? [] ) {
    if ( kept.has(item.id) ) items[item.id] = countsOf(item);
  }
  return {
    hp: finite(attributes.hp?.value) ?? 0,
    temp: finite(attributes.hp?.temp) ?? 0,
    items,
    hd: hitDiceOf(original),
    inspiration: attributes.inspiration === true,
    exhaustion: finite(attributes.exhaustion) ?? 0,
    death: { success: finite(attributes.death?.success) ?? 0, failure: finite(attributes.death?.failure) ?? 0 },
    effects: ownEffects(original).map(effect => effect.id).filter(id => carried.has(id)),
    spells: slotsOf(original)
  };
}

/**
 * Each spell slot pool's value, of those with a maximum, as dnd5e's return copies them.
 * @param {Actor} actor
 * @returns {Record<string, number>}
 */
function slotsOf(actor) {
  return Object.fromEntries(Object.entries(actor?.system?.spells ?? {})
    .filter(([, pool]) => finite(pool?.max)).map(([key, pool]) => [key, finite(pool.value) ?? 0]));
}

/**
 * An item's uses spent, and each of its activities'.
 * @param {Item} item
 * @returns {{spent: number, activities: Record<string, number>}}
 */
function countsOf(item) {
  const activities = {};
  for ( const activity of item.system?.activities ?? [] ) {
    if ( Number.isFinite(activity?.uses?.spent) ) activities[activity.id] = activity.uses.spent;
  }
  return { spent: finite(item.system?.uses?.spent) ?? 0, activities };
}

/**
 * Each class's hit dice spent, by the class item's id.
 * @param {Actor} actor
 * @returns {Record<string, number>}
 */
function hitDiceOf(actor) {
  return Object.fromEntries(Array.from(actor.items ?? []).filter(item => item.type === "class")
    .map(item => [item.id, finite(item.system?.hd?.spent) ?? 0]));
}

/**
 * An actor's own effects, not its items'.
 * @param {Actor} actor
 * @returns {ActiveEffect[]}
 */
function ownEffects(actor) {
  return Array.from(actor?.effects ?? []);
}

/* -------------------------------------------- */
/*  Tokens                                      */
/* -------------------------------------------- */

/**
 * The token's own props dnd5e keeps on a change: its bars, name display, link and disposition, and
 * where it stands; under dnd5e 6 its level too.
 * @returns {string[]}
 */
function selfKeys() {
  return [...FROM_SELF, ...standingKeys()];
}

/**
 * Where a token stands, as it's left on a return: its rotation, elevation and visibility, and under
 * dnd5e 6 its level.
 * @returns {string[]}
 */
function standingKeys() {
  const keys = ["rotation", "elevation", "hidden"];
  return String(game.system?.version ?? "").startsWith("6") ? [...keys, "level"] : keys;
}

/** The token's own props dnd5e keeps on a change and puts back on a return. */
const FROM_SELF = ["bar1", "bar2", "displayBars", "displayName", "actorLink", "disposition"];

/** The token props and texture props dnd5e takes from the creature changed into. */
const SOURCE_KEYS = ["width", "height", "alpha", "lockRotation", "ring"];
const TEXTURE_KEYS = ["offsetX", "offsetY", "scaleX", "scaleY", "src", "tint"];

/**
 * Switch a character's linked tokens to her form on every scene, by dnd5e's own recipe, from
 * exactly the partial token data dnd5e built for the change: where each stands left as it is. What
 * it was is kept for its return, but where it stands, as dnd5e 6 keeps it, so a token the
 * Gamemaster hid or turned while she was shaped stays so.
 * @param {Actor} original
 * @param {Actor} form
 * @param {string} request   The command's id, which the token data was kept by.
 * @returns {Promise<void>}
 */
export async function switchTokens(original, form, request) {
  const data = tokenData.get(request);
  tokenData.delete(request);
  if ( !data ) return;
  const name = form.getFlag(MODULE_ID, "form")?.name ?? form.name;
  const keys = selfKeys();
  for ( const scene of game.scenes ?? [] ) {
    const tokens = Array.from(scene.tokens ?? []).filter(token => token.actorLink && (token.actorId === original.id));
    if ( !tokens.length ) continue;
    const updates = tokens.map(token => {
      const update = foundry.utils.deepClone(data);
      update._id = token.id;
      update.actorId = form.id;
      update.actorLink = true;
      for ( const key of keys ) update[key] = token[key];
      update.name = `${token.name} (${name})`;
      foundry.utils.setProperty(update, "flags.dnd5e.originalActor", original.id);
      foundry.utils.setProperty(update, "flags.dnd5e.isPolymorphed", true);
      if ( !token.flags?.dnd5e?.previousTokenData ) {
        const previous = { texture: {} };
        for ( const key of [...SOURCE_KEYS, ...FROM_SELF, "name"] ) previous[key] = token[key];
        for ( const key of TEXTURE_KEYS ) previous.texture[key] = token.texture?.[key];
        foundry.utils.setProperty(update, "flags.dnd5e.previousTokenData", previous);
      }
      return update;
    });
    await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/**
 * Forget the token data kept for a change that didn't happen.
 * @param {string} request
 * @returns {void}
 */
export function forgetTokenData(request) {
  tokenData.delete(request);
}

/**
 * Put back on every scene each token still naming one of these forms, as dnd5e's return puts back
 * the viewed scene's: her own token data, with what the token was before it changed, where it
 * stands and its own elevation, visibility and rotation (and level) left as they are now, over what
 * was kept of them at the change (as dnd5e 6 does): a token hidden while she was shaped stays
 * hidden.
 * @param {string[]} ids   The forms, a chain's earlier ones among them.
 * @param {Actor} original
 * @returns {Promise<void>}
 */
export async function restoreTokens(ids, original) {
  const named = new Set(ids);
  let base = null;
  for ( const scene of game.scenes ?? [] ) {
    const tokens = Array.from(scene.tokens ?? []).filter(token => named.has(token.actorId));
    if ( !tokens.length ) continue;
    base ??= (await original.getTokenDocument()).toObject();
    const updates = tokens.map(token => {
      const update = foundry.utils.deepClone(base);
      update._id = token.id;
      foundry.utils.mergeObject(update, foundry.utils.deepClone(token.flags?.dnd5e?.previousTokenData ?? {}));
      for ( const key of ["elevation", "hidden", "rotation", "level"] ) {
        if ( token[key] !== undefined ) update[key] = token[key];
        else delete update[key];
      }
      delete update.x;
      delete update.y;
      return update;
    });
    await scene.updateEmbeddedDocuments("Token", updates, { diff: false, recursive: false });
  }
}

/* -------------------------------------------- */
/*  What comes back                             */
/* -------------------------------------------- */

/**
 * What the carry-back reads, taken from the form and from her before anything changes: the form's
 * counts, conditions, effects and spell slots, her own hit points and spell slots now, the record's
 * baseline, whether dnd5e's return copies the form's slots over hers, and the forms whose tokens go
 * back: this one, and each earlier form of its chain, live or noted as hers when it was deleted.
 * @param {Actor} form
 * @param {Actor} original
 * @returns {object}
 */
export function snapshot(form, original) {
  const record = form.getFlag(MODULE_ID, "form") ?? {};
  const attributes = form.system?.attributes ?? {};
  const items = {};
  for ( const item of form.items ?? [] ) items[item.id] = countsOf(item);
  const effects = ownEffects(form);
  const chain = id => (id !== original.id) && (game.actors.get(id) ? madeForm(game.actors.get(id), original) : (endedForms.get(id) === original.id));
  return {
    formId: form.id,
    name: record.name ?? form.name,
    hours: Number.isFinite(record.hours) ? record.hours : null,
    ids: [form.id, ...(form.getFlag("dnd5e", "previousActorIds") ?? []).filter(id => id && chain(id))],
    baseline: record.baseline ?? null,
    slotsCopied: copiesSlots(form),
    form: {
      hp: finite(attributes.hp?.value) ?? 0,
      temp: finite(attributes.hp?.temp) ?? 0,
      items,
      hd: hitDiceOf(form),
      inspiration: attributes.inspiration === true,
      exhaustion: finite(attributes.exhaustion) ?? 0,
      death: { success: finite(attributes.death?.success) ?? 0, failure: finite(attributes.death?.failure) ?? 0 },
      effects: effects.map(effect => effect.id),
      conditions: effects.map(effect => ({ id: effect.id, status: conditionOf(effect) })).filter(each => each.status),
      spells: slotsOf(form)
    },
    own: ownOf(original)
  };
}

/**
 * What she has of her own now that dnd5e's return copies the form's over: her hit points and
 * temporary ones, and her spell slots.
 * @param {Actor} original
 * @returns {{hp: number, temp: number, spells: Record<string, number>}}
 */
function ownOf(original) {
  const hp = original.system?.attributes?.hp ?? {};
  return { hp: finite(hp.value) ?? 0, temp: finite(hp.temp) ?? 0, spells: slotsOf(original) };
}

/**
 * Has her own hit points, temporary ones or a spell slot pool changed while she was shaped?
 * @param {object} kept   snapshot's.
 * @returns {boolean}
 */
function ownChanged(kept) {
  const b = kept?.baseline;
  if ( !b ) return false;
  if ( (kept.own.hp !== b.hp) || (kept.own.temp !== b.temp) ) return true;
  return Object.entries(b.spells ?? {}).some(([key, value]) => (key in kept.own.spells) && (kept.own.spells[key] !== value));
}

/**
 * The condition an effect is, if it's a dnd5e condition's own effect: one whose id is its status
 * effect's static id, of a condition other than exhaustion, which is counted, and death, which a form
 * ends at instead. Never the statuses it implies, as Paralyzed's Incapacitated.
 * @param {ActiveEffect} effect
 * @returns {string|null}
 */
function conditionOf(effect) {
  const statuses = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {});
  const status = statuses.find(each => each?._id && (each._id === effect?.id));
  if ( !status || ["exhaustion", "dead"].includes(status.id) ) return null;
  return (status.id in (CONFIG.DND5E?.conditionTypes ?? {})) ? status.id : null;
}

/**
 * Within a field's range.
 * @param {number} value
 * @param {number} min
 * @param {number} [max]
 * @returns {number}
 */
const clamp = (value, min, max=Infinity) => Math.min(Math.max(value, min), Number.isFinite(max) ? max : Infinity);

/**
 * Carry back what changed in form, added to what changed on her own actor meanwhile, so neither is
 * lost: her items' and their activities' uses, hit dice, exhaustion and death saves, as sums within
 * each field's range; Heroic Inspiration the form's where it changed in form; conditions gained in
 * form put on her, one effect each; and conditions and concentration that ended in form taken off
 * her. Each written only where it differs from what she has.
 * @param {object} kept       snapshot's.
 * @param {Actor} original
 * @returns {Promise<void>}
 */
export async function carryBack(kept, original) {
  const b = kept?.baseline;
  if ( !b || !original ) return;
  const f = kept.form;
  const options = { sendingStone: OWN };
  const sum = (h, fv, bv, max) => clamp((finite(h) ?? 0) + ((finite(fv) ?? 0) - (finite(bv) ?? 0)), 0, max);

  const updates = [];
  for ( const [id, base] of Object.entries(b.items ?? {}) ) {
    const item = original.items?.get?.(id);
    const inForm = f.items?.[id];
    if ( !item || !inForm ) continue;
    const update = {};
    const uses = item.system?.uses;
    if ( uses ) {
      const spent = sum(uses.spent, inForm.spent, base.spent, finite(Number(uses.max)) ?? Infinity);
      if ( spent !== (finite(uses.spent) ?? 0) ) update["system.uses.spent"] = spent;
    }
    for ( const activity of item.system?.activities ?? [] ) {
      if ( !Number.isFinite(activity?.uses?.spent) || !(activity.id in (base.activities ?? {})) ) continue;
      const spent = sum(activity.uses.spent, inForm.activities?.[activity.id], base.activities[activity.id],
        finite(Number(activity.uses.max)) ?? Infinity);
      if ( spent !== activity.uses.spent ) update[`system.activities.${activity.id}.uses.spent`] = spent;
    }
    if ( Object.keys(update).length ) updates.push({ _id: id, ...update });
  }
  for ( const [id, base] of Object.entries(b.hd ?? {}) ) {
    const item = original.items?.get?.(id);
    if ( !item || !(id in (f.hd ?? {})) ) continue;
    const spent = sum(item.system?.hd?.spent, f.hd[id], base, finite(item.system?.levels) ?? Infinity);
    if ( spent !== (finite(item.system?.hd?.spent) ?? 0) ) updates.push({ _id: id, "system.hd.spent": spent });
  }
  if ( updates.length ) await original.updateEmbeddedDocuments("Item", updates, options);

  const attributes = original.system?.attributes ?? {};
  const changes = {};
  const exhaustion = sum(attributes.exhaustion, f.exhaustion, b.exhaustion, 6);
  if ( exhaustion !== (finite(attributes.exhaustion) ?? 0) ) changes["system.attributes.exhaustion"] = exhaustion;
  for ( const key of ["success", "failure"] ) {
    const value = sum(attributes.death?.[key], f.death?.[key], b.death?.[key], 3);
    if ( value !== (finite(attributes.death?.[key]) ?? 0) ) changes[`system.attributes.death.${key}`] = value;
  }
  const inspiration = (f.inspiration !== b.inspiration) ? f.inspiration : (attributes.inspiration === true);
  if ( inspiration !== (attributes.inspiration === true) ) changes["system.attributes.inspiration"] = inspiration;
  if ( Object.keys(changes).length ) await original.update(changes, options);

  // Conditions gained in form, each by its own condition, never the statuses it implies.
  const hers = () => new Set(ownEffects(original).map(effect => effect.id));
  for ( const { id, status } of f.conditions ?? [] ) {
    if ( !hers().has(id) ) await original.toggleStatusEffect(status, { active: true });
  }
  // Conditions and concentration that ended in form: those the form had from her, and has no longer.
  const carried = new Set(b.effects ?? []);
  const still = new Set(f.effects ?? []);
  for ( const effect of ownEffects(original) ) {
    if ( !carried.has(effect.id) || still.has(effect.id) ) continue;
    const status = conditionOf(effect);
    if ( status ) await original.toggleStatusEffect(status, { active: false });
    else if ( effect.statuses?.has?.("concentrating") ) await original.endConcentration(effect);
  }
}

/**
 * Her hit points, where her own changed while she was shaped (she was rested, healed or hurt on her
 * own actor): what the form took added to what she has, within her maximum; and her own temporary hit
 * points where they changed (a Long Rest's clearing, a dish's), else the form's. Once dnd5e has copied
 * the form's onto her (`copied`), only where her own changed; for a form deleted by hand, which copied
 * nothing, always, as dnd5e's return would have copied them.
 * @param {object} kept       snapshot's.
 * @param {Actor} original
 * @param {object} [options]
 * @param {boolean} [options.copied]   Has dnd5e copied the form's onto her?
 * @returns {Promise<void>}
 */
export async function correctHp(kept, original, { copied=true }={}) {
  const b = kept?.baseline;
  if ( !b || !original ) return;
  const { own: h, form: f } = kept;
  if ( copied && (h.hp === b.hp) && (h.temp === b.temp) ) return;
  const hp = original.system?.attributes?.hp ?? {};
  const max = finite(hp.effectiveMax) ?? finite(hp.max) ?? Infinity;
  const value = clamp(h.hp + (f.hp - b.hp), 0, max);
  const temp = (h.temp !== b.temp) ? h.temp : f.temp;
  const changes = {};
  if ( value !== hp.value ) changes["system.attributes.hp.value"] = value;
  if ( temp !== (finite(hp.temp) ?? 0) ) changes["system.attributes.hp.temp"] = temp;
  if ( Object.keys(changes).length ) {
    await original.update(changes, { sendingStone: OWN, dnd5e: { concentrationCheck: false } });
  }
}

/**
 * Her spell slots, where her own changed while she was shaped (a Long Rest on her own actor, as a
 * party's rest makes): what the form spent added to what she has, each pool within its maximum.
 * dnd5e's return copies each of the form's pools over hers where the change kept her spells or a
 * spell list, as every Wild Shape does (its preset's Circle of the Moon list); once it has
 * (`copied`), only where her own changed; for a form deleted by hand, which copied nothing,
 * wherever the form's differs, as dnd5e's return would have copied them. Nothing where dnd5e
 * doesn't copy them.
 * @param {object} kept       snapshot's.
 * @param {Actor} original
 * @param {object} [options]
 * @param {boolean} [options.copied]   Has dnd5e copied the form's onto her?
 * @returns {Promise<void>}
 */
export async function correctSlots(kept, original, { copied=true }={}) {
  const b = kept?.baseline?.spells;
  if ( !b || !original || !kept.slotsCopied ) return;
  const changes = {};
  for ( const [key, base] of Object.entries(b) ) {
    const h = kept.own?.spells?.[key];
    const f = kept.form?.spells?.[key];
    if ( !Number.isFinite(h) || !Number.isFinite(f) || (copied && (h === base)) ) continue;
    const pool = original.system?.spells?.[key] ?? {};
    const value = clamp(h + (f - base), 0, finite(pool.max) ?? Infinity);
    if ( value !== finite(pool.value) ) changes[`system.spells.${key}.value`] = value;
  }
  if ( Object.keys(changes).length ) await original.update(changes, { sendingStone: OWN });
}

/* -------------------------------------------- */
/*  Ending it                                   */
/* -------------------------------------------- */

/**
 * End a Wild Shape as the rules end it, on the bridge: dnd5e's own return, told why, then what
 * dnd5e's return doesn't do: what she spent or gained in form carried back, her tokens put back on
 * every scene, and her hit points and spell slots where her own changed meanwhile. One at a time
 * for each character; a second call while one is on its way does nothing, as does one for a form
 * dnd5e didn't make of her (`madeForm`).
 * @param {Actor} form
 * @param {"app"|"change"|"time"|"hp"|"incapacitated"} why
 * @returns {Promise<boolean>}   Is the form gone?
 */
export async function endWildShape(form, why) {
  const original = originalOf(form);
  // Never a form dnd5e didn't make, as a player's own actor flagged as hers: nothing is returned,
  // deleted or carried back as a Gamemaster on what a player wrote.
  if ( !original || !madeForm(form, original) || ending.has(original.id) ) return false;
  ending.add(original.id);
  const kept = snapshot(form, original);
  for ( const id of kept.ids ) returning.add(id);
  try {
    try {
      await form.revertOriginalForm({ renderSheet: false, sendingStone: why });
    } catch (err) {
      console.error(`${MODULE_ID} | Could not end the Wild Shape of ${original.name}`, err);
      for ( const id of kept.ids ) returning.delete(id);
      return false;
    }
    // A return dnd5e refused, or a module's hook stopped: nothing more is written.
    if ( game.actors.get(form.id) ) {
      for ( const id of kept.ids ) returning.delete(id);
      return false;
    }
    await carryBack(kept, original);
    await restoreTokens(kept.ids, original);
    await correctHp(kept, original);
    await correctSlots(kept, original);
    recheckCharacter(original);
    return true;
  } finally {
    ending.delete(original.id);
  }
}

/**
 * Why a character's active form is due to end now, by the 2024 rules, if it is: at 0 hit points or
 * dead, Incapacitated (or a condition that gives it), or its hours of world time run out.
 * @param {Actor} form
 * @param {object} record
 * @returns {"hp"|"incapacitated"|"time"|null}
 */
function dueWhy(form, record) {
  const statuses = form.statuses ?? new Set();
  if ( ((form.system?.attributes?.hp?.value ?? 1) <= 0) || statuses.has("dead") ) return "hp";
  if ( ENDING_STATUSES.some(status => statuses.has(status)) ) return "incapacitated";
  if ( Number.isFinite(record?.endsAt) && (record.endsAt <= (game.time?.worldTime ?? 0)) ) return "time";
  return null;
}

/**
 * The characters of the campaigns whose switch is on, once each.
 * @returns {Actor[]}
 */
function switchedOnCharacters() {
  const ids = new Set(getCampaigns().filter(campaign => wildShapeOn(campaign)).flatMap(campaign => Array.from(campaign.characters)));
  return Array.from(ids, id => game.actors.get(id)).filter(Boolean);
}

/**
 * End each due Wild Shape, on the bridge alone: a character's (or every character's) active form
 * alone, where the 2024 rules time it and its campaign's switch is on; never while a command of that
 * character's is on its way, which checks again when it settles.
 * @param {Actor} [character]   Only this one.
 * @returns {void}
 */
export function endDueForms(character) {
  if ( !canSend() ) return;
  const on = switchedOnCharacters();
  const characters = character ? on.filter(each => each.id === character.id) : on;
  for ( const each of characters ) void endIfDue(each);
}

/**
 * End a character's active form where it's due, and say so in chat.
 * @param {Actor} character
 * @returns {Promise<void>}
 */
async function endIfDue(character) {
  if ( queueBusy(character.id) || ending.has(character.id) ) return;
  const form = activeForm(character);
  const record = form?.getFlag(MODULE_ID, "form");
  if ( !form || !Number.isFinite(record?.hours) ) return;
  const why = dueWhy(form, record);
  if ( !why ) return;
  if ( await endWildShape(form, why) ) await postEnding(character, record, why);
}

/**
 * Check a character again once a write is done, on the next tick.
 * @param {Actor|null} character
 * @returns {void}
 */
function checkSoon(character) {
  if ( !character || !canSend() ) return;
  setTimeout(() => endDueForms(character), 0);
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register Wild Shape's hooks: on every client, the record of a transformation, what comes back on a
 * return, the replacement after a Long Rest, and the forms deleted; on the bridge, the endings, the
 * deletion safety net, and a player's leftover forms.
 * @returns {void}
 */
export function registerWildShapeHooks() {
  Hooks.on("dnd5e.transformActorV2", (host, source, data, settings, options) => record(host, source, data, settings, options));
  Hooks.on("dnd5e.revertOriginalForm", (form, options) => returned(form, options));
  Hooks.on("dnd5e.restCompleted", (actor, result) => rested(actor, result));
  Hooks.on("updateWorldTime", () => {
    if ( canSend() ) setTimeout(() => endDueForms(), 0);
  });
  Hooks.on("updateActor", actor => {
    if ( transformed(actor) ) checkSoon(originalOf(actor));
    else leftover(actor);
  });
  for ( const hook of ["createActiveEffect", "updateActiveEffect"] ) {
    Hooks.on(hook, effect => {
      const actor = effect?.parent;
      if ( (actor?.documentName === "Actor") && transformed(actor) ) checkSoon(originalOf(actor));
    });
  }
  Hooks.on("deleteActor", actor => {
    noteFormDeleted(actor);
    formDeleted(actor);
  });
  registerQueueSettled(key => {
    const character = game.actors.get(key);
    if ( character ) endDueForms(character);
  });
}

/**
 * On the client that returns her, from wherever: what comes back, unless the module is returning her
 * itself, which carries it back once dnd5e is done; and the ending noted on her Wild Shape, before
 * dnd5e deletes the form, for the app's banner and the deletion safety net. Only where this user owns
 * her, and the form is a Wild Shape's.
 * @param {Actor} form
 * @param {object} [options]   The return's, `sendingStone` the module's reason.
 * @returns {void}
 */
function returned(form, options={}) {
  const record = form?.getFlag?.(MODULE_ID, "form");
  const original = originalOf(form);
  if ( (record?.kind !== "wildShape") || !original?.isOwner || !madeForm(form, original) ) return;
  const why = options?.sendingStone ?? null;
  if ( !why ) {
    const kept = snapshot(form, original);
    void carryBack(kept, original);
    if ( ownChanged(kept) ) afterCopy(original, kept);
  }
  if ( why === "change" ) return;
  const found = wildShapeRules(original);
  if ( !found ) return;
  void found.item.update({
    [`flags.${MODULE_ID}.wildShape.ended`]: { form: record.name, why: why ?? "foundry", at: Date.now(), formId: form.id }
  }, { sendingStone: OWN });
}

/**
 * Correct her hit points and spell slots once dnd5e's own update of her lands on this client: its
 * copy of the form's, made without a concentration check.
 * @param {Actor} original
 * @param {object} kept
 * @returns {void}
 */
function afterCopy(original, kept) {
  const listener = Hooks.on("updateActor", (actor, _changes, options) => {
    if ( (actor?.id !== original.id) || (options?.dnd5e?.concentrationCheck !== false) || options?.sendingStone ) return;
    Hooks.off("updateActor", listener);
    void correctHp(kept, original).then(() => correctSlots(kept, original));
  });
  // A copy that changed nothing is never heard of: let the listener go after a while.
  setTimeout(() => Hooks.off("updateActor", listener), 60_000);
}

/**
 * A Long Rest's replacement: one known form may be replaced after it, for a druid of a campaign whose
 * switch is on with at least one known form, on the client that rested, by its owner. Never saved up.
 * @param {Actor} actor   She, or her form.
 * @param {object} [result]
 * @returns {void}
 */
function rested(actor, result) {
  if ( !result?.longRest ) return;
  const original = originalOf(actor) ?? actor;
  if ( !original?.isOwner || !getCampaigns().some(campaign => campaign.characters.has(original.id) && wildShapeOn(campaign)) ) return;
  const rules = wildShapeRules(original);
  if ( !rules || !knownProfiles(rules.activity).length ) return;
  if ( rules.item.getFlag(MODULE_ID, "wildShape")?.swap === true ) return;
  void rules.item.update({ [`flags.${MODULE_ID}.wildShape.swap`]: true }, { sendingStone: OWN });
}

/**
 * A form deleted, on the bridge: its tokens put back where a return isn't putting them back,
 * whatever its kind; and for a Wild Shape the rules time, once FORM_GONE_SETTLE has passed, unless
 * a return made it (this client's own, or one noted on her Wild Shape by the client that returned
 * her), what dnd5e's return would have done and the ending noted, as Foundry's. Only for a form
 * dnd5e made of her (`madeForm`).
 * @param {Actor} form
 * @returns {void}
 */
function formDeleted(form) {
  const record = form?.getFlag?.(MODULE_ID, "form");
  const original = game.actors.get(form?.getFlag?.("dnd5e", "originalActor"));
  if ( !record || !original || !canSend() || !madeForm(form, original) ) return;
  const ours = returning.has(form.id);
  setTimeout(() => returning.delete(form.id), FORM_GONE_SETTLE);
  gone.set(form.id, { previous: Array.from(form.getFlag("dnd5e", "previousActorIds") ?? []), kind: record.kind ?? null, slots: copiesSlots(form) });
  setTimeout(() => gone.delete(form.id), 2 * FORM_GONE_SETTLE);
  if ( !ending.has(original.id) ) void restoreTokens([form.id], original);
  if ( !Number.isFinite(record.hours) ) return;
  const kept = snapshot(form, original);
  setTimeout(() => void byHand(form, original, kept, ours), FORM_GONE_SETTLE);
}

/**
 * A form's deletion, as it settled: one no return made gets what dnd5e's return would have given
 * her, and its ending noted. An earlier form of a chain (dnd5e's Wild Shape or Polymorph made from
 * a form) carries on in the later one that names it, which was built from it, live or deleted with
 * it: a later Wild Shape holds what it spent and is carried back itself, by its return or deleted
 * so, so nothing more; under a later form of another kind, which keeps none of her features, what
 * it spent is carried back here, and no hit points, which dnd5e's return of that one copies, nor
 * spell slots where that return copies them too.
 * @param {Actor} form
 * @param {Actor} original
 * @param {object} kept
 * @param {boolean} ours
 * @returns {Promise<void>}
 */
async function byHand(form, original, kept, ours) {
  const found = wildShapeRules(original);
  if ( ours || returning.has(form.id) || (found?.item.getFlag(MODULE_ID, "wildShape")?.ended?.formId === form.id) ) return;
  if ( !game.actors.get(original.id) ) return;
  const later = laterForm(form.id, original);
  if ( later?.kind === "wildShape" ) return;
  // Her own hit points and spell slots now, as dnd5e would have copied the form's over them.
  kept.own = ownOf(original);
  await carryBack(kept, original);
  if ( !later ) await correctHp(kept, original, { copied: false });
  if ( !later?.slots ) await correctSlots(kept, original, { copied: false });
  await found?.item.update({
    [`flags.${MODULE_ID}.wildShape.ended`]: { form: kept.name, why: "foundry", at: Date.now(), formId: form.id }
  }, { sendingStone: OWN });
}

/**
 * The later form of her chain that names this one among its earlier forms, if one does, a live form
 * of hers or one deleted lately: its record's kind ("other" where it has none), and whether its
 * return copies spell slots.
 * @param {string} id
 * @param {Actor} original
 * @returns {{kind: string, slots: boolean}|null}
 */
function laterForm(id, original) {
  const live = game.actors.find(actor => transformed(actor) && madeForm(actor, original)
    && (actor.getFlag("dnd5e", "previousActorIds") ?? []).includes(id));
  if ( live ) return { kind: live.getFlag(MODULE_ID, "form")?.kind ?? "other", slots: copiesSlots(live) };
  const deleted = Array.from(gone.values()).find(each => each.previous.includes(id));
  return deleted ? { kind: deleted.kind ?? "other", slots: deleted.slots } : null;
}

/**
 * Does dnd5e's return of a form copy its spell slots over hers: where the change kept her spells or
 * a spell list, as every Wild Shape does.
 * @param {Actor} form
 * @returns {boolean}
 */
function copiesSlots(form) {
  const options = form.getFlag("dnd5e", "transformOptions") ?? {};
  return Array.from(options.keep ?? []).includes("spells") || (Array.from(options.spellLists ?? []).length > 0);
}

/**
 * A player's own return in Foundry leaves her forms unflagged in the world: the bridge deletes one
 * carrying the module's record once dnd5e's return has unflagged it, as a Gamemaster's return
 * deletes it, its id first among those being returned. Only one dnd5e made of her (`madeForm`): a
 * player may write the same flags on an actor of their own.
 * @param {Actor} actor
 * @returns {void}
 */
function leftover(actor) {
  if ( !canSend() || !actor?.getFlag?.(MODULE_ID, "form") || transformed(actor) ) return;
  const original = actor.getFlag("dnd5e", "originalActor");
  if ( (typeof original !== "string") || (original === actor.id) || !game.actors.get(actor.id) ) return;
  if ( !madeForm(actor, game.actors.get(original)) ) return;
  returning.add(actor.id);
  // One deleted meanwhile, as by its owner, is gone all the same.
  void actor.delete().catch(() => returning.delete(actor.id));
}

/**
 * Delete each leftover form a player's return left while no Gamemaster was connected, as `leftover`
 * would have once the bridge heard it unflagged: on the bridge, when a client becomes it. Deleting
 * it puts back its tokens on every scene (`formDeleted`).
 * @returns {void}
 */
export function deleteLeftovers() {
  if ( !canSend() ) return;
  for ( const actor of game.actors?.filter?.(each => !transformed(each) && each.getFlag?.(MODULE_ID, "form")) ?? [] ) leftover(actor);
}

/* -------------------------------------------- */
/*  Combats                                     */
/* -------------------------------------------- */

/**
 * Send each campaign a character is in its combats again where a combatant is hers, as her form's or
 * her own: at a change and a return, so the app learns the combatant is hers before the next turn.
 * @param {Actor} character
 * @returns {void}
 */
export function recheckCharacter(character) {
  for ( const campaign of getCampaigns() ) {
    if ( !campaign.characters.has(character.id) ) continue;
    recheckCombats(campaign, combatant => (originalOf(combatant.actor)?.id === character.id)
      || (combatant.actorId === character.id));
  }
}
