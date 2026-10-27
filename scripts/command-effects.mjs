import { EFFECT_ID, EFFECT_KINDS, EFFECT_OPS, MODULE_ID } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { activeForm } from "./characters.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import { checkCommand, failedResult, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { campaignGroups } from "./groups.mjs";
import { effectIdOf, knownOf, opsOf } from "./sheet-effects.mjs";

/**
 * A player's own effects turned off, turned back on and deleted from the Sending Stone app, since
 * module 0.39.0, as dnd5e's sheet toggles and deletes them: those their party put on their own
 * character, and their items' temporary ones, as `opsOf` says (sheet-effects.mjs). The Gamemaster's
 * client writes it, as it writes every command. Nothing is posted in chat, as dnd5e posts nothing;
 * so only a character's player does it from the app, never the Gamemaster as them, which would leave
 * no mark.
 *
 * An effect turned off from the app is marked, `flags.sending-stone.offByPlayer`, and only one so
 * marked may be turned back on from there: any other change to whether it's on, in Foundry or by a
 * module, clears the mark. So an effect the Gamemaster turned off stays off, and an item's Rage isn't
 * started from the app without spending a use.
 *
 * Offered under D&D Fifth Edition where the campaign's Gamemaster lets its players, by its own
 * switch, apart from its rolls: it throws no dice and uses nothing.
 */

/**
 * The campaigns whose app takes effects, by id, as their latest answer to a hello or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * The option an effect's write from the app carries, so the mark's hook knows its own.
 * @type {string}
 */
const OWN = "effect";

/* -------------------------------------------- */
/*  Whether effects are changed here            */
/* -------------------------------------------- */

/**
 * May a campaign's players change their own effects from the app: by its own switch, under dnd5e.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function effectsOn(campaign) {
  return (campaign.effects === true) && (game.system?.id === "dnd5e");
}

/**
 * What a campaign tells the app of its players' own effects in its hello, beside its rolls: whether
 * they may change them here, and if not, why not, its switch off or the system.
 * @param {Campaign} campaign
 * @returns {{enabled: boolean, kinds: string[], reason: "off"|"system"|null}}
 */
export function effectFeatures(campaign) {
  if ( campaign.effects !== true ) return { enabled: false, kinds: [], reason: "off" };
  if ( game.system?.id !== "dnd5e" ) return { enabled: false, kinds: [], reason: "system" };
  return { enabled: true, kinds: [...EFFECT_KINDS], reason: null };
}

/**
 * Note whether a campaign's app takes effects: `features.effects`, 1 or later. One that says nothing
 * of them, as an older or rolled back app, is fetched from for them no longer.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {void}
 */
export function noteEffectReader(campaignId, features) {
  const format = features?.effects;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
}

/**
 * Does a campaign's app take effects?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function effectReader(campaignId) {
  return readers.has(campaignId);
}

/* -------------------------------------------- */
/*  The mark                                    */
/* -------------------------------------------- */

/**
 * Register the hook that keeps the mark honest, on every client, as any client may turn an effect on
 * or off: a change to whether a marked effect is on, by anything but the app's own command, clears
 * its mark in the same write.
 * @returns {void}
 */
export function registerEffectHooks() {
  Hooks.on("preUpdateActiveEffect", (effect, changes, options) => clearMark(effect, changes, options));
}

/**
 * Clear an effect's mark where this write turns it on or off and isn't the app's own.
 * @param {ActiveEffect} effect
 * @param {object} changes    The write's changes, which a pre-hook may add to.
 * @param {object} options
 * @returns {void}
 */
function clearMark(effect, changes, options) {
  if ( (options?.sendingStone === OWN) || !isObject(changes) ) return;
  if ( !Object.hasOwn(changes, "disabled") || (changes.disabled === effect?.disabled) ) return;
  if ( effect?.flags?.[MODULE_ID]?.offByPlayer !== true ) return;
  changes.flags = isObject(changes.flags) ? changes.flags : {};
  changes.flags[MODULE_ID] = isObject(changes.flags[MODULE_ID]) ? changes.flags[MODULE_ID] : {};
  changes.flags[MODULE_ID].offByPlayer = false;
}

/* -------------------------------------------- */
/*  An effect                                   */
/* -------------------------------------------- */

/**
 * Why a fetched change to an effect isn't one to make, if it isn't: it names one effect, by its id
 * as the sheet names it, and the state wanted of it, off, on or gone; and nothing else, nothing a
 * roll names, no move, removal, anything typed in, favorite, note or dish, and throws no dice. Only
 * its player changes one from the app: it posts nothing, so would leave no mark of the Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
export function checkEffectCommand(command) {
  if ( command.by === "gm" ) return "by";
  const given = value => (value !== undefined) && (value !== null);
  const others = ["transfer", "remove", "typed", "favorite", "note", "dish"];
  const effect = command.effect;
  if ( namesRollFields(command) || others.some(key => given(command[key])) || !isObject(effect) ) return "effect";
  if ( (Object.keys(effect).sort().join() !== "id,op") || !EFFECT_OPS.includes(effect.op)
    || (typeof effect.id !== "string") || !EFFECT_ID.test(effect.id) ) return "effect";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Turn one of a character's effects off or on, or delete it, fetched from the app: every check before
 * any write, as the character is now. It must be one the sheet lists, and its player's to change that
 * way now, as `opsOf` says; one that's already so, off, on or gone, is done with nothing written, as
 * the app may have been showing an older sheet. A write that a hook stops, as a module's may, leaves
 * the effect as it was, read again after it: called off, with no sheet. Then the sheet, as it then
 * stands, ahead of the result, which says what the effect now is.
 * @param {object} command      `{effect: {op, id}}`, as fetched.
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
export async function runEffectCommand(command, passed) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !effectsOn(campaign) ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const groups = new Set(campaignGroups(campaign).map(group => group.id));
  const actor = (campaign.characters.has(command.actorId) && !groups.has(command.actorId))
    ? (game.actors.get(command.actorId) ?? null) : null;
  if ( !actor ) return failed("unknown");
  // Since 0.40.0 none while she's transformed: her form's are copies, and her own wait for her return.
  if ( activeForm(actor) ) return failed("shaped");

  const { op, id } = command.effect;
  const listed = () => Array.from(actor.allApplicableEffects?.() ?? []);
  const effect = listed().find(each => effectIdOf(each) === id);
  const done = (deleted, disabled) => {
    sheetFirst(actor);
    return {
      id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [],
      effect: { id, disabled: deleted ? null : disabled, deleted }
    };
  };
  if ( !effect ) return (op === "delete") ? done(true, null) : failed("gone");
  const ops = opsOf(effect, actor, knownOf(actor));
  if ( !ops.length ) return failed("effect");
  if ( (op === "disable") && (effect.disabled === true) ) return done(false, true);
  if ( (op === "enable") && (effect.disabled !== true) ) return done(false, false);
  if ( !ops.includes(op) ) return failed("effect");

  const options = { sendingStone: OWN };
  const marked = `flags.${MODULE_ID}.offByPlayer`;
  try {
    if ( op === "delete" ) await effect.delete(options);
    else await effect.update({ disabled: op === "disable", [marked]: op === "disable" }, options);
  } catch (err) {
    // A delete of one gone meanwhile, as with what kept it up, is done all the same.
    const gone = (op === "delete") && !listed().some(each => effectIdOf(each) === id);
    if ( !gone ) return failed("error", messageOf(err));
  }
  // Read again: a hook may have stopped the write, which then resolves with nothing changed.
  if ( op === "delete" ) {
    return listed().some(each => effectIdOf(each) === id) ? failed("cancelled") : done(true, null);
  }
  if ( (effect.disabled === true) !== (op === "disable") ) return failed("cancelled");
  return done(false, effect.disabled === true);
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
