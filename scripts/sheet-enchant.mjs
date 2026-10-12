import { durationOf, hiddenFromPlayer } from "./sheet-effects.mjs";
import { inventoryTypes } from "./sheet-inventory.mjs";
import { castCopy } from "./sheet-rolls.mjs";
import { finite } from "./sheet-values.mjs";

/**
 * What a character's sheet says of enchantments: which of their enchant activities can be used
 * from the app, such as Magic Weapon, Shillelagh or a Flame Tongue's Engulf in Flames, with the
 * profiles each offers and the items of theirs each may enchant; and the enchantments their items
 * carry, their own and anyone else's, with which of them they may end. One that's a choice made
 * once, as an Eldritch Invocation's, or a magic item's template, such as a Shield's +1, +2 or +3,
 * is left to Foundry. dnd5e's own rules decide which items may take one, as its usage dialog and
 * card's tray have them; see command-enchant.mjs for how one is used and ended.
 *
 * Every reference to dnd5e's enchantments goes through these, so that the same works under dnd5e
 * 5.x and 6.x.
 */

/**
 * How many profiles, items, enchantments applied and enchantments on an item the sheet lists at
 * most.
 * @type {{profiles: number, items: number, applied: number, enchantments: number}}
 */
const MOST = { profiles: 20, items: 500, applied: 50, enchantments: 50 };

/**
 * What each enchant activity offers, by its uuid, while a sheet is built: working out which items
 * may take it asks dnd5e for each, so each activity is worked out once, however often the sheet
 * lists it. Null between builds.
 * @type {Map<string, object>|null}
 */
let described = null;

/* -------------------------------------------- */
/*  Which enchantments, and what they apply to  */
/* -------------------------------------------- */

/**
 * Build a character's sheet, working out each enchant activity once.
 * @template T
 * @param {() => T} build
 * @returns {T}
 */
export function enchantingSheet(build) {
  const outer = described;
  described = outer ?? new Map();
  try {
    return build();
  } finally {
    described = outer;
  }
}

/**
 * The effect a profile of an enchant activity applies: dnd5e 6's by its uuid, or else the item's
 * effect by its id, as dnd5e 5 keeps it. Never through the profile's own `effect`, which dnd5e 6
 * warns about each time it's read. Null where it's gone.
 * @param {Activity} activity
 * @param {{_id: string, uuid?: string}} profile
 * @returns {ActiveEffect|object|null}
 */
export function profileEffect(activity, profile) {
  if ( !profile ) return null;
  try {
    if ( profile.uuid ) return fromUuidSync(profile.uuid, { strict: false }) ?? null;
    return activity.item?.effects?.get(profile._id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Is an enchant activity one a player can use from the app: one used by an action of some kind,
 * not a choice made once, as an Eldritch Invocation's is, with no activation; nor a magic item's
 * template, which isn't a spell's or a feature's, isn't used on its own item, and may enchant any
 * kind of item, as a Shield's +1, +2 or +3; and with a profile it can apply: for anything but a
 * leveled spell, one at the level it's used at now.
 * @param {Activity} activity
 * @returns {boolean}
 */
export function enchantInPlay(activity) {
  if ( activity?.type !== "enchant" ) return false;
  if ( ["", "none"].includes(activity.activation?.type ?? "") ) return false;
  const template = !["spell", "feat"].includes(activity.item?.type) && (activity.enchant?.self !== true)
    && !activity.restrictions?.type;
  if ( template ) return false;
  if ( !Array.from(activity.effects ?? []).some(profile => profileEffect(activity, profile)) ) return false;
  return leveled(activity.item) || (availableProfiles(activity).length > 0);
}

/**
 * What an enchantment says it came from: dnd5e 6's activity, or else its origin.
 * @param {ActiveEffect} effect
 * @returns {string|null}
 */
export function originOf(effect) {
  return effect?.system?.origin?.activity ?? effect?.origin ?? null;
}

/**
 * Is an effect an enchantment an enchant activity applied, to the item it's on: not the one dnd5e
 * gives the copy of a spell an item casts, which no enchant activity applied, nor one of its own
 * an item carries to apply.
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function isEnchantEnchantment(effect) {
  if ( (effect?.type !== "enchantment") || !effect.isAppliedEnchantment ) return false;
  if ( !effect.getFlag?.("dnd5e", "enchantmentProfile") ) return false;
  if ( effect.id === castEnchantmentId() ) return false;
  const origin = resolved(originOf(effect));
  return !origin || (origin.type === "enchant");
}

/**
 * May a character's player end an enchantment on one of their items from the app, as its owner may
 * with the ⟲ on dnd5e's card, or on the item's sheet: one an enchant activity applied that could
 * be used from the app, whoever's it is, as an ally's Magic Weapon on their club; or one whose
 * activity is gone, as a scroll or oil used up, that lasts only a while, or as long as a
 * concentration. Not a magic item's template, a choice made once, nor one whose activity is gone
 * that lasts for good.
 * @param {ActiveEffect} effect
 * @param {Actor} actor   Whose item it's on.
 * @returns {boolean}
 */
export function endable(effect, actor) {
  if ( !isEnchantEnchantment(effect) || !actor || (effect.parent?.parent !== actor) ) return false;
  const activity = resolved(originOf(effect));
  if ( activity ) return enchantInPlay(activity);
  return (effect.isTemporary === true) || Boolean(effect.getFlag?.("dnd5e", "dependentOn"));
}

/**
 * The enchantments an activity applied to an item already.
 * @param {Activity} activity
 * @param {Item|null} item
 * @returns {ActiveEffect[]}
 */
export function ownPrior(activity, item) {
  return effectsOf(item).filter(effect => isEnchantEnchantment(effect) && (originOf(effect) === activity.uuid));
}

/**
 * The concentration dnd5e ends as an activity is used, as the character concentrates on as much as
 * they may: the one on the same activity, or else the first. Null for none.
 * @param {Activity} activity
 * @returns {string|null}   The concentration's id on the character.
 */
export function endingConcentration(activity) {
  try {
    return activity._prepareUsageConfig({})?.concentration?.end ?? null;
  } catch {
    return null;
  }
}

/**
 * The enchantments an item carries that go as an activity is used on it: those the activity applied
 * there already, which it replaces, and those tied to the concentration it ends, which dnd5e ends
 * with it, as Magic Weapon's from a scroll cast while concentrating on the spell's.
 * @param {Activity} activity
 * @param {Item|null} item
 * @param {Actor} actor
 * @param {string|null} [ending]   The uuid of the concentration it ends, if already known.
 * @returns {ActiveEffect[]}
 */
export function goingAway(activity, item, actor, ending=endingUuid(activity, actor)) {
  const going = ownPrior(activity, item);
  if ( !ending ) return going;
  for ( const effect of effectsOf(item) ) {
    if ( going.includes(effect) || !isEnchantEnchantment(effect) ) continue;
    if ( effect.getFlag?.("dnd5e", "dependentOn") === ending ) going.push(effect);
  }
  return going;
}

/**
 * The uuid of the concentration dnd5e ends as an activity is used, as `endingConcentration` has it.
 * @param {Activity} activity
 * @param {Actor} actor
 * @returns {string|null}
 */
function endingUuid(activity, actor) {
  const id = endingConcentration(activity);
  return (id && actor?.effects?.get(id)?.uuid) || null;
}

/**
 * May an enchant activity enchant one of a character's items, as dnd5e's rules have it: an item of
 * theirs, not the copy of a spell an item casts, of a kind dnd5e lets be enchanted, of the kind the
 * activity enchants, or where it names none, one the Inventory tab lists; and one dnd5e's
 * `canEnchant` takes, as other modules may have it, asked about as it would be without the
 * enchantments that go as it's used, as `goingAway` has them: the 2014 Magic Weapon's weapon, made
 * magical by it, may take it again.
 * @param {Activity} activity
 * @param {Item|null} item
 * @param {Actor} actor
 * @param {ActiveEffect[]} [without]   What goes as it's used.
 * @returns {boolean}
 */
export function canTake(activity, item, actor, without=[]) {
  if ( !item || (item.parent !== actor) || castCopy(item) ) return false;
  if ( !enchantableTypes(activity).has(item.type) ) return false;
  const type = activity.restrictions?.type;
  if ( type ? (item.type !== type) : !inventoryTypes().has(item.type) ) return false;
  try {
    const gone = new Set(without.filter(effect => effect && item.effects?.has?.(effect.id)).map(effect => effect.id));
    const others = () => (item.toObject().effects ?? []).filter(effect => !gone.has(effect._id));
    const asked = gone.size ? item.clone({ effects: others() }, { keepId: true }) : item;
    return activity.canEnchant(asked) === true;
  } catch {
    return false;
  }
}

/**
 * The profiles an enchant activity offers, in dnd5e's order, each with the name of the effect it
 * applies: for a leveled spell, every one, with the spell levels it's offered at, as the level it's
 * cast at decides; for anything else, those offered at its level now, as a character's or a
 * class's, with no limits.
 * @param {Activity} activity
 * @param {object} [options]
 * @param {boolean} [options.leveled]
 * @returns {{id: string, name: string, min: number|null, max: number|null}[]}
 */
export function enchantProfiles(activity, { leveled=false }={}) {
  const profiles = leveled ? Array.from(activity.effects ?? []) : availableProfiles(activity);
  return profiles.flatMap(profile => {
    const effect = profileEffect(activity, profile);
    if ( !effect || (typeof profile._id !== "string") ) return [];
    return [{
      id: profile._id,
      name: String(effect.name ?? ""),
      min: leveled ? finite(profile.level?.min) : null,
      max: leveled ? finite(profile.level?.max) : null
    }];
  }).slice(0, MOST.profiles);
}

/**
 * What an enchant activity the app may use offers: whether it enchants its own item, and is then a
 * switch, spending nothing and needing no concentration, as a Flame Tongue's Engulf in Flames; its
 * profiles; the character's items it may enchant, by id, in their order, each as it would be once
 * what goes as it's used is gone; and the enchantments it has applied, on its own item, or else on
 * the character's items.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {{self: boolean, toggle: boolean, profiles: object[], items: string[], applied: object[]}}
 */
export function describeEnchant(item, activity) {
  const key = activity.uuid;
  if ( described?.has(key) ) return described.get(key);
  const actor = activity.actor ?? item.actor;
  const self = activity.enchant?.self === true;
  const ending = self ? null : endingUuid(activity, actor);
  const items = self ? [] : Array.from(actor?.items ?? [])
    .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || String(a.name).localeCompare(String(b.name), game.i18n.lang))
    .filter(other => canTake(activity, other, actor, goingAway(activity, other, actor, ending)))
    .map(other => other.id);
  const enchant = {
    self,
    toggle: self && !(activity.consumption?.targets?.length > 0) && !activity.requiresSpellSlot
      && !activity.requiresConcentration,
    profiles: enchantProfiles(activity, { leveled: leveled(activity.item) }),
    items: items.slice(0, MOST.items),
    applied: appliedBy(activity, actor)
  };
  described?.set(key, enchant);
  return enchant;
}

/**
 * The enchantments an activity has applied, as its own item carries one, or the character's items
 * do: the item, the effect and its profile.
 * @param {Activity} activity
 * @param {Actor} actor
 * @returns {{item: string, effect: string, profile: string}[]}
 */
function appliedBy(activity, actor) {
  let effects;
  try {
    effects = (activity.enchant?.self === true)
      ? [activity.existingEnchantment].filter(Boolean)
      : Array.from(activity.appliedEnchantments ?? []).filter(effect => effect?.parent?.parent === actor);
  } catch {
    return [];
  }
  return effects.filter(isEnchantEnchantment)
    .slice(0, (activity.enchant?.self === true) ? 1 : MOST.applied)
    .map(effect => ({
      item: effect.parent.id, effect: effect.id, profile: effect.getFlag("dnd5e", "enchantmentProfile")
    }));
}

/**
 * The enchantments an item carries, as the sheet lists them, left out where there are none: each
 * applied by an enchant activity, its own or another's, with its name, the item it came from, if
 * that can be found, whether it lasts as long as a concentration, how long it has left, whether its
 * time is up, as dnd5e 5 leaves one that's run out, and whether its player may end it, as `listedOn`
 * has them.
 * @param {Item} item
 * @returns {{enchantments?: object[]}}
 */
export function enchantmentsOf(item) {
  const actor = item.actor ?? item.parent;
  const enchantments = [];
  for ( const effect of effectsOf(item) ) {
    if ( enchantments.length >= MOST.enchantments ) break;
    if ( !listedOn(effect, item, actor) ) continue;
    effect.updateDuration?.();
    enchantments.push({
      id: effect.id,
      name: String(effect.name ?? ""),
      source: sourceOf(effect),
      concentration: concentrating(effect),
      duration: durationOf(effect),
      expired: expired(effect),
      endable: endable(effect, actor)
    });
  }
  return enchantments.length ? { enchantments } : {};
}

/**
 * Is an effect one the sheet lists among an item's enchantments: one an enchant activity applied,
 * and that dnd5e doesn't hide from a player; but for one the character cast on an item of theirs
 * not identified yet, from another item that is, which they know of, though not what the item is.
 * One the item not identified yet applies to itself would tell what it is, as a Flame Tongue's
 * "Ablaze".
 * @param {ActiveEffect} effect
 * @param {Item} item
 * @param {Actor} actor
 * @returns {boolean}
 */
export function listedOn(effect, item, actor) {
  if ( !isEnchantEnchantment(effect) ) return false;
  if ( !hiddenFromPlayer(effect) ) return true;
  if ( (item.system?.identified !== false) || !actor?.uuid ) return false;
  const origin = originOf(effect);
  if ( !origin?.startsWith(`${actor.uuid}.`) || origin.startsWith(`${item.uuid}.`) ) return false;
  return itemOf(resolved(origin))?.system?.identified !== false;
}

/**
 * The name of the item an enchantment came from, as its player knows it, where it can be found.
 * @param {ActiveEffect} effect
 * @returns {string|null}
 */
function sourceOf(effect) {
  const item = itemOf(resolved(originOf(effect)));
  return item ? ownName(item) : null;
}

/**
 * An item's own name, as its player may know it: without what its enchantments make of it, such as
 * "Longsword" rather than "Longsword, +1"; and for one not identified yet, the name dnd5e gives it
 * then, which keeps its secret, as "Strange Sword".
 * @param {Item} item
 * @returns {string}
 */
export function ownName(item) {
  const name = (item?.system?.identified === false) ? item.name : (item?._source?.name ?? item?.name);
  return String(name ?? "");
}

/**
 * The item an activity is on, or the item itself, as an origin may name either.
 * @param {object|null} document
 * @returns {Item|null}
 */
function itemOf(document) {
  return document?.item ?? ((document?.documentName === "Item") ? document : null);
}

/**
 * Does an enchantment last as long as a concentration, as one tied to it does?
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function concentrating(effect) {
  const concentration = resolved(effect.getFlag?.("dnd5e", "dependentOn"));
  const status = CONFIG.specialStatusEffects?.CONCENTRATING;
  return Boolean(status && concentration?.statuses?.has?.(status));
}

/**
 * Has an enchantment's time run out? dnd5e 5 leaves one that has.
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function expired(effect) {
  const duration = effect.duration ?? {};
  if ( duration.expired === true ) return true;
  const timed = (duration.type && (duration.type !== "none")) || Number.isFinite(duration.value);
  return Boolean(timed) && Number.isFinite(duration.remaining) && (duration.remaining <= 0);
}

/* -------------------------------------------- */

/**
 * The profiles offered at an activity's level, as dnd5e's usage dialog offers them, with an effect
 * to apply.
 * @param {Activity} activity
 * @returns {object[]}
 */
export function availableProfiles(activity) {
  try {
    return Array.from(activity.availableEnchantments ?? []).filter(profile => profileEffect(activity, profile));
  } catch {
    return [];
  }
}

/**
 * The effects a document carries, if it has any to go through.
 * @param {Item|null} document
 * @returns {ActiveEffect[]}
 */
export function effectsOf(document) {
  const effects = document?.effects;
  return (typeof effects?.[Symbol.iterator] === "function") ? Array.from(effects) : [];
}

/**
 * Is an item a leveled spell, whose enchantments are offered by the level it's cast at?
 * @param {Item} item
 * @returns {boolean}
 */
function leveled(item) {
  return (item?.type === "spell") && ((finite(item.system?.level) ?? 0) > 0);
}

/**
 * The kinds of item dnd5e lets be enchanted.
 * @param {Activity} activity
 * @returns {Set<string>}
 */
function enchantableTypes(activity) {
  const types = activity.enchantableTypes ?? activity.constructor?.enchantableTypes;
  if ( types instanceof Set ) return types;
  return new Set(Object.entries(CONFIG.Item?.dataModels ?? {})
    .filter(([, model]) => model?.metadata?.enchantable)
    .map(([type]) => type));
}

/**
 * The id of the enchantment dnd5e gives the copy of a spell an item casts.
 * @returns {string|null}
 */
function castEnchantmentId() {
  const dnd5e = globalThis.dnd5e;
  return dnd5e?.documents?.activity?.CastActivity?.ENCHANTMENT_ID
    ?? dnd5e?.utils?.staticID?.("dnd5espellchanges") ?? null;
}

/**
 * What a uuid names, if it can be found now; null otherwise.
 * @param {string|null|undefined} uuid
 * @returns {object|null}
 */
function resolved(uuid) {
  if ( (typeof uuid !== "string") || !uuid ) return null;
  try {
    return fromUuidSync(uuid, { strict: false }) ?? null;
  } catch {
    return null;
  }
}
