import { ENDING_STATUSES, EVENTS, FORM_UUID, MODULE_ID, PROFILE_ID, WILD_SHAPE_KINDS, WILD_SHAPE_OPS } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { wildShapeTermsChanged } from "./character-sync.mjs";
import { activeForm } from "./characters.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import {
  appFlags, authorFor, checkCommand, failedResult, isObject, namesRollFields, throwsNoDice, visibleTo
} from "./command-rolls.mjs";
import { campaignGroups } from "./groups.mjs";
import { markMidiBonusAction, midiActivities, midiBonusActionUsed } from "./midi-economy.mjs";
import { finite } from "./sheet-values.mjs";
import {
  beastsFor, eligible, endWildShape, entryOf, forgetTokenData, formName, inPool, knownProfiles, recheckCharacter,
  switchTokens, wildShapeItemOf, wildShapeRules
} from "./wild-shape.mjs";

/**
 * Wild Shape from the Sending Stone app, since module 0.40.0 (wild-shape.mjs says how it's kept and
 * ended): a 2024 druid's player changes her into one of the Beasts she knows and back, learns a Beast
 * in an empty place or in place of one after a Long Rest, and lists the Beasts she may learn, every
 * check made here, as she is now, whatever the app showed. The Gamemaster's client does each, as it
 * makes every command: a use of her own Wild Shape spent on her own feature, never through its
 * activity, whose Compendium Browser would open on the Gamemaster's screen; and dnd5e's own change
 * with its Wild Shape preset, the module's numbers for her temporary hit points and Circle of the
 * Moon's armor class floor, no dialog and no sheet shown. A line from her goes to chat for each change,
 * return and ending.
 *
 * Only her player does it from the app, at their own seat, never the Gamemaster as her: a change in
 * the player's name would pass dnd5e's own Allow Polymorphing, which the Gamemaster's client never
 * meets. Offered under D&D Fifth Edition where the campaign's Gamemaster lets its players, by its own
 * switch, apart from its rolls: it throws no dice.
 *
 * Since 0.41.0, where Midi-QOL makes uses and enforces Bonus Actions, a change or return is refused
 * once the character has used theirs in a fight, and marks it used, on the form, or on her once back.
 */

/**
 * The campaigns whose app takes Wild Shape, by id, as their latest answer to a hello or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * What the module's own writes carry, so its hooks know them.
 * @type {string}
 */
const OWN = "wildShape";

/* -------------------------------------------- */
/*  Whether Wild Shape is used here             */
/* -------------------------------------------- */

/**
 * May a campaign's players use Wild Shape from the app: by its own switch, under dnd5e.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function wildShapeOn(campaign) {
  return (campaign?.wildShape === true) && (game.system?.id === "dnd5e");
}

/**
 * What a campaign tells the app of Wild Shape in its hello, beside its rolls: whether its players may
 * use it here, and if not, why not, its switch off or the system.
 * @param {Campaign} campaign
 * @returns {{enabled: boolean, kinds: string[], reason: "off"|"system"|null}}
 */
export function wildShapeFeatures(campaign) {
  if ( campaign.wildShape !== true ) return { enabled: false, kinds: [], reason: "off" };
  if ( game.system?.id !== "dnd5e" ) return { enabled: false, kinds: [], reason: "system" };
  return { enabled: true, kinds: [...WILD_SHAPE_KINDS], reason: null };
}

/**
 * Note whether a campaign's app takes Wild Shape: `features.wildShape`, 1 or later. One that says
 * nothing of it, as an older or rolled back app, is fetched from for it no longer, and is sent its
 * characters' own sheets. An answer to a heartbeat that changes it sends the campaign's sheets again,
 * with or without their forms; a hello's are sent after it anyway.
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteWildShapeReader(campaignId, features, type) {
  const format = features?.wildShape;
  const was = readers.has(campaignId);
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
  if ( (was !== readers.has(campaignId)) && (type !== EVENTS.HELLO) ) wildShapeTermsChanged(campaignId);
}

/**
 * Does a campaign's app take Wild Shape, and a shaped character's sheet?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function wildShapeReader(campaignId) {
  return readers.has(campaignId);
}

/* -------------------------------------------- */
/*  A command                                   */
/* -------------------------------------------- */

/**
 * Why a fetched Wild Shape isn't one to make, if it isn't: exactly one of a change into a known form
 * by its profile's id, a return, a Beast learned by its compendium uuid in an empty place or in place
 * of a known form, or the Beasts to learn listed; nothing else, nothing a roll names, no move,
 * removal, anything typed in, favorite, note, dish or effect; and it throws no dice. Only its player
 * makes one from the app.
 * @param {object} command
 * @returns {string|null}
 */
export function checkWildShapeCommand(command) {
  if ( command.by === "gm" ) return "by";
  const given = value => (value !== undefined) && (value !== null);
  const others = ["transfer", "remove", "typed", "favorite", "note", "dish", "effect"];
  const shape = command.wildShape;
  if ( namesRollFields(command) || others.some(key => given(command[key])) || !isObject(shape) ) return "wildShape";
  if ( !WILD_SHAPE_OPS.includes(shape.op) ) return "wildShape";
  const keys = Object.keys(shape).sort().join();
  const id = value => (typeof value === "string") && PROFILE_ID.test(value);
  const valid = {
    transform: () => (keys === "form,op") && id(shape.form),
    revert: () => keys === "op",
    learn: () => (keys === "op,replace,uuid") && (typeof shape.uuid === "string") && FORM_UUID.test(shape.uuid)
      && ((shape.replace === null) || id(shape.replace)),
    forms: () => keys === "op"
  }[shape.op];
  if ( !valid() ) return "wildShape";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Make a Wild Shape fetched from the app: every check before any write, as the character is now,
 * the campaign read again, as a queue's wait may leave the one passed stale.
 * @param {object} command      `{wildShape: {op, …}}`, as fetched.
 * @param {Campaign} passed     The campaign as it was when fetched.
 * @returns {Promise<CommandResult>}
 */
export async function runWildShapeCommand(command, passed) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !wildShapeOn(campaign) ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const groups = new Set(campaignGroups(campaign).map(group => group.id));
  const character = (campaign.characters.has(command.actorId) && !groups.has(command.actorId))
    ? (game.actors.get(command.actorId) ?? null) : null;
  if ( !character ) return failed("unknown");
  const rules = wildShapeRules(character);
  if ( !rules ) return failed("gone");
  switch ( command.wildShape.op ) {
    case "transform": return transform(command, campaign, character, rules);
    case "revert": return revert(command, campaign, character);
    case "learn": return learn(command, campaign, character, rules);
    default: return done(command, { op: "forms", ...(await beastsFor(campaign, character)) });
  }
}

/**
 * What the app is told of a Wild Shape made: what it did, and its chat line, if any, and whether its
 * player may see it.
 * @param {object} command
 * @param {object} wildShape
 * @param {object} [line]
 * @param {ChatMessage|null} [line.message]
 * @param {Actor} [line.character]
 * @param {Campaign} [line.campaign]
 * @returns {CommandResult}
 */
function done(command, wildShape, { message=null, character, campaign }={}) {
  return {
    id: command.id, status: "done", reason: null, error: null,
    messageId: message?.id ?? null,
    visible: message ? visibleTo(message, character, campaign) : true,
    rolls: [],
    wildShape
  };
}

/**
 * Are Midi-QOL's Bonus Actions counted for a Wild Shape: Midi makes uses here, it can say whether one
 * is used, and the seat, or the character's own actor, is in a fight, as a combatant made from her
 * token may still name her after dnd5e switched it to the form.
 * @param {Actor} seat        The actor she acts as now.
 * @param {Actor} character
 * @returns {boolean}
 */
function midiEconomy(seat, character) {
  return midiActivities() && (typeof globalThis.MidiQOL?.hasUsedBonusAction === "function")
    && Boolean(seat?.inCombat || character?.inCombat);
}

/**
 * Is the actor a character acts as now Incapacitated, as the rules have it, at 0 hit points, or dead?
 * @param {Actor} actor
 * @returns {boolean}
 */
function incapacitated(actor) {
  const statuses = actor.statuses ?? new Set();
  return ENDING_STATUSES.some(status => statuses.has(status)) || statuses.has("dead")
    || ((actor.system?.attributes?.hp?.value ?? 1) <= 0);
}

/**
 * Change into a known form: one usable from the app, its Beast in the campaign's compendiums and
 * fitting her now; not while she's another kind of form, Incapacitated, or out of uses, nor since
 * 0.41.0 with Midi-QOL's Bonus Action used in a fight, where it enforces them. Shaped already, the
 * form she is is returned first, as one command. The use is spent on her own feature before dnd5e
 * changes her, refunded where the change doesn't happen; once the form exists it never is, and the
 * Bonus Action is marked on it.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} character
 * @param {object} rules
 * @returns {Promise<CommandResult>}
 */
async function transform(command, campaign, character, rules) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const profile = knownProfiles(rules.activity).find(each => each._id === command.wildShape.form);
  if ( !profile || !inPool(profile.uuid, campaign) ) return failed("form");
  const found = await entryOf(profile.uuid);
  if ( !found ) return failed("gone");
  if ( !eligible(found.entry, rules, found.pack) ) return failed("form");
  const active = activeForm(character);
  const record = active?.getFlag(MODULE_ID, "form") ?? null;
  if ( active && (record?.profile === profile._id) ) return failed("form");
  // Never a Polymorph an enemy cast, or a form the module doesn't time: those end in Foundry.
  if ( active && !Number.isFinite(record?.hours) ) return failed("transformed");
  const seat = active ?? character;
  if ( incapacitated(seat) ) return failed("incapacitated");
  // Her Wild Shape's uses as the form's copy has them while shaped, the same as hers.
  const row = seat.items?.get?.(rules.item.id) ?? rules.item;
  if ( !((row.system?.uses?.value ?? 0) > 0) ) return failed("consume");
  // Midi-QOL's Bonus Actions, where it makes uses and the seat is in a fight (round 0.41.0 §1).
  const economy = midiEconomy(seat, character);
  const bonus = economy && (rules.activity?.activation?.type === "bonus");
  if ( bonus && midiBonusActionUsed(seat) ) return failed("bonus-action");
  let source = null;
  try {
    source = await fromUuid(profile.uuid);
  } catch {
    source = null;
  }
  if ( source?.documentName !== "Actor" ) return failed("gone");

  if ( active ) {
    await endWildShape(active, "change");
    if ( game.actors.get(active.id) ) return failed("cancelled");
  }

  // The use, spent on her own feature, as the form's return carried back what it spent.
  const item = wildShapeItemOf(character)?.item ?? rules.item;
  const spent = finite(item.system?.uses?.spent) ?? 0;
  try {
    await item.update({ "system.uses.spent": spent + 1, [`flags.${MODULE_ID}.wildShape.ended`]: null }, { sendingStone: OWN });
  } catch (err) {
    return failed("error", messageOf(err));
  }
  if ( (finite(item.system?.uses?.spent) ?? 0) !== (spent + 1) ) return failed("cancelled");
  const refund = async () => {
    forgetTokenData(command.id);
    try {
      await item.update({ "system.uses.spent": spent }, { sendingStone: OWN });
    } catch {
      // The use stays spent: nothing more can be done for it here.
    }
  };

  // dnd5e's Wild Shape preset, with the module's own numbers: the higher of her temporary hit points
  // and the form's, and the Moon's armor class floor, or none; her tokens switched here, on every scene.
  const temp = Math.max(rules.temp, finite(character.system?.attributes?.hp?.temp) ?? 0);
  const settings = new dnd5e.dataModels.settings.TransformationSetting({
    ...CONFIG.DND5E.transformation.presets.wildshape.settings,
    preset: "wildshape",
    tempFormula: String(temp),
    minimumAC: String(rules.acFloor ?? 0),
    transformTokens: false
  });
  try {
    await character.transformInto(source, settings, {
      renderSheet: false, sendingStone: { request: command.id, profile: profile._id }
    });
  } catch (err) {
    await refund();
    return failed("error", messageOf(err));
  }
  const form = game.actors.find(actor => actor.getFlag(MODULE_ID, "form")?.request === command.id) ?? activeForm(character);
  if ( !form || (form.id === active?.id) ) {
    await refund();
    return failed("cancelled");
  }

  // From here the form exists, and the use is never refunded. Her tokens and the combats each go on
  // their own, so a failure of one leaves the rest done: the line and the sheet catch their own.
  try {
    await switchTokens(character, form, command.id);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not finish ${character.name}'s Wild Shape into ${source.name}`, err);
  }
  try {
    recheckCharacter(character);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not finish ${character.name}'s Wild Shape into ${source.name}`, err);
  }
  // The Bonus Action it took, on the form, the seat for the rest of the turn, as Midi's own use marks it.
  if ( bonus ) {
    try {
      await markMidiBonusAction(form);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not mark ${character.name}'s Bonus Action for Midi-QOL`, err);
    }
  }
  const message = await postLine(character, active ? "BecameAgain" : "Became", { name: character.name, aForm: articled(source.name) },
    { op: "transform", form: source.name, why: active ? "change" : null }, command);
  sheetFirst(character);
  return done(command, {
    op: "transform",
    form: { id: profile._id, name: source.name, uuid: profile.uuid },
    temp: finite(form.system?.attributes?.hp?.temp) ?? temp,
    hours: rules.hours
  }, { message, character, campaign });
}

/**
 * Return to her own form: a Wild Shape the module times alone, any other ending in Foundry. Already
 * herself, done with nothing written, as the app may have been showing an older sheet. Since 0.41.0
 * refused where Midi-QOL enforces Bonus Actions and the form has used its own in a fight, and once
 * she's back, marked on her.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} character
 * @returns {Promise<CommandResult>}
 */
async function revert(command, campaign, character) {
  const failed = reason => failedResult(command, reason);
  const active = activeForm(character);
  if ( !active ) return done(command, { op: "revert", form: null });
  const record = active.getFlag(MODULE_ID, "form");
  if ( !Number.isFinite(record?.hours) ) return failed("transformed");
  // Leaving the form early is a Bonus Action too, as the 2024 rules have it (round 0.41.0 §1.5).
  const economy = midiEconomy(active, character);
  if ( economy && midiBonusActionUsed(active) ) return failed("bonus-action");
  await endWildShape(active, "app");
  if ( activeForm(character) ) return failed("cancelled");
  if ( economy ) {
    try {
      await markMidiBonusAction(character);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not mark ${character.name}'s Bonus Action for Midi-QOL`, err);
    }
  }
  const message = await postLine(character, "Left", { name: character.name, aForm: articled(record.name) },
    { op: "revert", form: record.name, why: "app" }, command);
  sheetFirst(character);
  return done(command, { op: "revert", form: { name: record.name } }, { message, character, campaign });
}

/**
 * Learn a Beast from the campaign's compendiums, fitting her now: in an empty place, or in place of a
 * known form after a Long Rest, never the one she is now; one known already is done with nothing
 * written. Her first switches her Wild Shape to dnd5e's linked forms, dropping its Challenge Rating
 * profiles; a replacement keeps the profile's id, which dnd5e's usage cards name.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} character
 * @param {object} rules
 * @returns {Promise<CommandResult>}
 */
async function learn(command, campaign, character, rules) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const { uuid, replace } = command.wildShape;
  if ( !inPool(uuid, campaign) ) return failed("form");
  const found = await entryOf(uuid);
  if ( !found ) return failed("gone");
  if ( !eligible(found.entry, rules, found.pack) ) return failed("form");
  const known = knownProfiles(rules.activity);
  const already = known.find(profile => profile.uuid === uuid);
  if ( already ) {
    return done(command, { op: "learn", form: { id: already._id, name: formName(already, character, campaign), uuid }, replaced: null });
  }
  let replaced = null;
  if ( replace === null ) {
    if ( known.length >= rules.count ) return failed("full");
  } else {
    replaced = known.find(profile => profile._id === replace) ?? null;
    if ( !replaced ) return failed("form");
    // Replacing it would change its Beast under her while its id stays.
    if ( activeForm(character)?.getFlag(MODULE_ID, "form")?.profile === replace ) return failed("shaped");
    if ( rules.item.getFlag(MODULE_ID, "wildShape")?.swap !== true ) return failed("swap");
  }

  const name = found.entry.name;
  const plain = profile => ({
    _id: profile._id, name: profile.name ?? "", uuid: profile.uuid, cr: profile.cr ?? "",
    level: { min: profile.level?.min ?? null, max: profile.level?.max ?? null },
    movement: Array.from(profile.movement ?? []), sizes: Array.from(profile.sizes ?? []), types: Array.from(profile.types ?? [])
  });
  const profiles = replaced
    ? known.map(profile => ((profile._id === replaced._id) ? { ...plain(profile), uuid, name } : plain(profile)))
    : [...known.map(plain), plain({ _id: foundry.utils.randomID(), name, uuid })];
  const path = `system.activities.${rules.activity.id}`;
  const changes = { [`${path}.transform.mode`]: "", [`${path}.profiles`]: profiles };
  if ( replaced ) changes[`flags.${MODULE_ID}.wildShape.swap`] = false;
  try {
    await rules.item.update(changes, { sendingStone: OWN });
  } catch (err) {
    return failed("error", messageOf(err));
  }
  // Read again: a hook may have stopped the write.
  const after = knownProfiles(wildShapeItemOf(character)?.activity);
  const learned = after.find(profile => profile.uuid === uuid);
  if ( !learned || (replaced && after.some(profile => profile.uuid === replaced.uuid)) ) return failed("cancelled");
  sheetFirst(character);
  return done(command, {
    op: "learn",
    form: { id: learned._id, name: learned.name, uuid },
    replaced: replaced ? { id: replaced._id, name: formName(replaced, character, campaign) } : null
  });
}

/* -------------------------------------------- */
/*  Chat                                        */
/* -------------------------------------------- */

/**
 * A creature's name with "a" or "an" before it, by its first letter.
 * @param {string} name
 * @returns {string}
 */
export function articled(name) {
  const text = String(name ?? "");
  return `${/^[aeiou]/i.test(text) ? "an" : "a"} ${text}`;
}

/**
 * Post a public line from the character for what the module did: a change, a return or an ending,
 * flagged with what it was (`flags.sending-stone.wildShape`), and for a command, the command's flags.
 * @param {Actor} character
 * @param {string} key      Under `SENDINGSTONE.WildShape.Chat`.
 * @param {object} data     Its words, escaped here.
 * @param {{op: string, form: string, why: string|null}} flag
 * @param {object|null} [command]
 * @returns {Promise<ChatMessage|null>}
 */
export async function postLine(character, key, data, flag, command=null) {
  const words = Object.fromEntries(Object.entries(data).map(([name, value]) => [name, foundry.utils.escapeHTML(String(value))]));
  try {
    return await ChatMessage.implementation.create({
      author: authorFor(character).id,
      speaker: ChatMessage.implementation.getSpeaker({ actor: character }),
      content: `<p>${game.i18n.format(`SENDINGSTONE.WildShape.Chat.${key}`, words)}</p>`,
      flags: { [MODULE_ID]: { ...(command ? appFlags(command) : {}), wildShape: flag } }
    }) ?? null;
  } catch {
    // The change stands: only its line is missing.
    return null;
  }
}

/**
 * The line for a Wild Shape the game ended: its hours run out (the hour, at levels 2 and 3), at 0
 * hit points, or Incapacitated.
 * @param {Actor} character
 * @param {object} record   The form's.
 * @param {"time"|"hp"|"incapacitated"} why
 * @returns {Promise<ChatMessage|null>}
 */
export function postEnding(character, record, why) {
  const flag = { op: "revert", form: record.name, why };
  const name = character.name;
  if ( why === "time" ) {
    return (record.hours === 1) ? postLine(character, "EndedHour", { name }, flag)
      : postLine(character, "EndedTime", { name, hours: record.hours }, flag);
  }
  return postLine(character, (why === "hp") ? "EndedHp" : "EndedIncapacitated", { name }, flag);
}

/* -------------------------------------------- */

/**
 * What went wrong, in words.
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  return (err instanceof Error) ? err.message : String(err);
}
