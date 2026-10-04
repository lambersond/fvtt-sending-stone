import { EVENTS } from "./constants.mjs";
import { combatEnabled, includeGmContent } from "./config.mjs";
import { canSend } from "./bridge.mjs";
import { sendCombatEnded, sendCombatEvent } from "./campaign-combats.mjs";
import { isCombatantShared, shareCombatant, snapshotCombat, summarizeCombatant } from "./combat-data.mjs";

/**
 * Combat tracker events, sent to each campaign with characters in the fight.
 *
 * Every hook used here fires on all clients after the database write, so the bridge sees each
 * change exactly once whoever made it. combatStart, combatTurn and combatRound are deliberately
 * not used: they fire only on the client that made the change, and before the write.
 */

/**
 * Combat fields whose change is reported as combat.updated. Round and turn are reported through
 * combat.turn instead, and the combatant collection through the combatant events.
 * @type {Set<string>}
 */
const COMBAT_FIELDS = new Set(["name", "active", "scene"]);

/**
 * Combatant fields whose change is reported as combat.combatant.updated.
 * @type {Set<string>}
 */
const COMBATANT_FIELDS = new Set(["name", "img", "initiative", "defeated", "hidden", "group"]);

/**
 * Register the combat hooks.
 * @returns {void}
 */
export function registerCombatHooks() {
  Hooks.on("createCombat", onCreateCombat);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("combatTurnChange", onTurnChange);
  Hooks.on("createCombatant", onCreateCombatant);
  Hooks.on("updateCombatant", onUpdateCombatant);
  Hooks.on("deleteCombatant", onDeleteCombatant);
}

/**
 * Should combat events be posted from this client right now?
 * @returns {boolean}
 */
function active() {
  return canSend() && combatEnabled();
}

/* -------------------------------------------- */
/*  Combats                                     */
/* -------------------------------------------- */

/**
 * A new encounter usually has no combatants yet, so it reaches each campaign only once one of its
 * characters joins.
 * @param {Combat} combat
 */
function onCreateCombat(combat) {
  if ( !active() ) return;
  sendCombatEvent(combat, EVENTS.COMBAT_CREATED, campaign => ({ combat: snapshotCombat(combat, campaign) }));
}

/**
 * @param {Combat} combat
 * @param {object} changed   The differential data that was written.
 */
function onUpdateCombat(combat, changed) {
  if ( !active() ) return;
  const changes = Object.keys(changed).filter(key => COMBAT_FIELDS.has(key));
  if ( !changes.length ) return;
  sendCombatEvent(combat, EVENTS.COMBAT_UPDATED, campaign => ({ changes, combat: snapshotCombat(combat, campaign) }));
}

/**
 * Ending an encounter deletes it, so this is the one signal that combat is over.
 * @param {Combat} combat
 */
function onDeleteCombat(combat) {
  if ( !active() ) return;
  sendCombatEnded(combat);
}

/* -------------------------------------------- */

/**
 * Handle the turn order moving on, or back.
 *
 * @param {Combat} combat                 The combat whose turn order changed.
 * @param {CombatHistoryData} prior       The prior turn state. Mutated in place by core, so it
 *                                        must be read immediately and never retained.
 * @param {CombatHistoryData} current     The new turn state.
 * @returns {void}
 */
function onTurnChange(combat, prior, current) {
  if ( !active() || !combat.started ) return;

  const priorRound = prior?.round ?? 0;
  const priorCombatantId = prior?.combatantId ?? null;
  const priorTurn = prior?.turn ?? null;

  // This hook also fires when combatants are added, removed or reordered, which can shift the turn
  // index without anyone's turn actually changing.
  const roundChanged = current.round !== priorRound;
  if ( !roundChanged && (current.combatantId === priorCombatantId) ) return;

  let direction = null;
  if ( roundChanged ) direction = current.round > priorRound ? "forward" : "backward";
  else if ( (current.turn !== null) && (priorTurn !== null) && (current.turn !== priorTurn) ) {
    direction = current.turn > priorTurn ? "forward" : "backward";
  }

  // Before the first round the tracker is still being set up, so reaching it is the start of the
  // fight. Detected here rather than through combatStart, which fires only on the starting client.
  if ( (priorRound < 1) && (current.round >= 1) ) {
    sendCombatEvent(combat, EVENTS.COMBAT_STARTED, campaign => ({ combat: snapshotCombat(combat, campaign) }));
  }

  const previousCombatantId = isCombatantShared(combat.combatants.get(priorCombatantId)) ? priorCombatantId : null;
  sendCombatEvent(combat, EVENTS.COMBAT_TURN, campaign => ({
    combatId: combat.id,
    round: current.round,
    newRound: roundChanged && (direction === "forward"),
    direction,
    combatant: shareCombatant(combat.combatant, campaign),
    previousCombatantId,
    combat: snapshotCombat(combat, campaign)
  }));
}

/* -------------------------------------------- */
/*  Combatants                                  */
/* -------------------------------------------- */

/**
 * @param {Combatant} combatant
 */
function onCreateCombatant(combatant) {
  if ( !active() || !isCombatantShared(combatant) ) return;
  const combatId = combatant.parent.id;
  sendCombatEvent(combatant.parent, EVENTS.COMBATANT_ADDED, campaign => ({
    combatId,
    combatant: summarizeCombatant(combatant, campaign)
  }));
}

/**
 * @param {Combatant} combatant
 * @param {object} changed   The differential data that was written.
 */
function onUpdateCombatant(combatant, changed) {
  if ( !active() ) return;
  const changes = Object.keys(changed).filter(key => COMBATANT_FIELDS.has(key));
  if ( !changes.length ) return;
  const combat = combatant.parent;
  const combatId = combat.id;

  // While hidden combatants are withheld, hiding or revealing one is, as far as the listener can
  // tell, the combatant leaving or joining the fight.
  if ( !includeGmContent() && ("hidden" in changed) ) {
    if ( combatant.hidden ) {
      sendCombatEvent(combat, EVENTS.COMBATANT_REMOVED, () => ({ combatId, combatantId: combatant.id }));
    }
    else {
      sendCombatEvent(combat, EVENTS.COMBATANT_ADDED, campaign => ({
        combatId,
        combatant: summarizeCombatant(combatant, campaign)
      }));
    }
    return;
  }
  if ( !isCombatantShared(combatant) ) return;
  sendCombatEvent(combat, EVENTS.COMBATANT_UPDATED, campaign => ({
    combatId,
    changes,
    combatant: summarizeCombatant(combatant, campaign)
  }));
}

/**
 * @param {Combatant} combatant
 */
function onDeleteCombatant(combatant) {
  if ( !active() || !isCombatantShared(combatant) ) return;
  const combatId = combatant.parent.id;
  sendCombatEvent(combatant.parent, EVENTS.COMBATANT_REMOVED, () => ({ combatId, combatantId: combatant.id }), {
    leaving: combatant.id
  });
}
