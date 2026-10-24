import { TURN_MIDI_WAIT, TURN_UNDO_WITHIN } from "./constants.mjs";
import { campaignCharacterId } from "./characters.mjs";
import { combatEnabled } from "./config.mjs";
import { reportTurnChange } from "./combat.mjs";
import { involvesCampaign } from "./combat-data.mjs";
import { checkCommand, failedResult, isId, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { midiSettled } from "./command-uses.mjs";
import { commandActor, companionKeyOf, companionsOf } from "./creatures.mjs";
import { diceStatus } from "./dice-plan.mjs";

/**
 * Ending a turn from the Sending Stone app, since module 0.36.0, as Foundry's Next Turn does: the
 * current turn of a campaign character, or of one of its companions, where it is still the one the
 * app was shown, by core's own `nextTurn` on the Gamemaster's client, so that the system's and other
 * modules' turn work runs as when the Gamemaster clicks it. Nothing is posted in chat, so only its
 * player ends one from the app, never the Gamemaster as them.
 *
 * The command names the turn by its combat, round and current combatant, never by its index, which
 * the app is never sent and which moves as initiative changes mid-round: a press made on a turn
 * that has moved on, as one the Gamemaster or an earlier press ended already, ends nothing more.
 *
 * And the turn an End Turn from the app just ended may be taken back, from this client's memory of
 * it, by one update of the combat's turn back to the combatant whose turn it ended, with Foundry's
 * turn events off, so that nothing of the turn's change runs again.
 */

/**
 * The fields a turn is named by, as the app was shown it.
 * @type {string[]}
 */
const TURN_FIELDS = ["combatId", "round", "combatantId"];

/**
 * The fields of other commands an end of a turn never names, beside those a roll names its item,
 * targets or link by; and `undo`, the End Turn that taking a turn back names, and nothing else does.
 * @type {string[]}
 */
const NOT_TURN_FIELDS = ["combatId", "use", "types", "modifiers", "critical", "undo"];

/**
 * An End Turn's request id, as the app makes one: 1 to 64 letters, digits, `_` or `-`.
 * @type {RegExp}
 */
const REQUEST_ID = /^[\w-]{1,64}$/;

/**
 * The last End Turn from the app made on this client, of each combat, by the combat's id, while it
 * may be taken back: who made it, the turn it ended and where it left the combat. A later End Turn
 * of the combat, any character's, replaces it, and taking it back forgets it; it's kept in memory
 * alone, so a reload of Foundry, or the bridge changing hands, forgets it too.
 * @type {Map<string, {requestId: string, campaignId: string, characterId: string,
 *   ended: {round: number, combatantId: string}, left: {round: number, combatantId: string|null},
 *   at: number}>}
 */
const endedTurns = new Map();

/**
 * Why a fetched end of a turn isn't one to make, if it isn't: it names the turn, as the app was
 * shown it, and nothing a roll names, and throws no dice. Only its player ends one from the app: it
 * posts nothing, so would leave no mark of the Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
export function checkEndTurnCommand(command) {
  if ( command.by === "gm" ) return "by";
  if ( namesOtherFields(command) || !namesTurn(command) ) return "turn";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Why a fetched taking back of a turn isn't one to make, if it isn't: it names the End Turn it takes
 * back, by its id, and the turn as the app shows it now, where that End Turn left the combat, and
 * nothing a roll names, and throws no dice. Only the player who ended the turn takes it back.
 * @param {object} command
 * @returns {string|null}
 */
export function checkUndoTurnCommand(command) {
  if ( command.by === "gm" ) return "by";
  if ( namesOtherFields(command, ["undo"]) ) return "turn";
  if ( (typeof command.undo !== "string") || !REQUEST_ID.test(command.undo) ) return "undo";
  if ( !namesTurn(command) ) return "turn";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Does a command name anything an end of a turn never names, but the fields its own kind names?
 * @param {object} command
 * @param {string[]} [own]   Those of NOT_TURN_FIELDS its kind names, as `undo` for taking a turn back.
 * @returns {boolean}
 */
function namesOtherFields(command, own=[]) {
  const given = field => !own.includes(field) && (command[field] !== undefined) && (command[field] !== null);
  return namesRollFields(command) || NOT_TURN_FIELDS.some(given);
}

/**
 * Does a command name a turn as the app is shown one: a combat, its round, 1 or more, and its
 * current combatant, and nothing else?
 * @param {object} command
 * @returns {boolean}
 */
function namesTurn({ turn }) {
  if ( !isObject(turn) || (Object.keys(turn).length !== TURN_FIELDS.length)
    || !TURN_FIELDS.every(field => Object.hasOwn(turn, field)) ) return false;
  return isId(turn.combatId) && Number.isInteger(turn.round) && (turn.round >= 1) && isId(turn.combatantId);
}

/**
 * End the current turn of a combat, if the campaign's players' rolls are made here, the command's
 * character is one of the campaign's, the combat is one the campaign is told of and has started,
 * the turn it names is still the current one, and that is the character's or one of its companions'
 * now. Under Midi-QOL it first waits, a while at most, for the Midi uses from the app on their way,
 * as Midi releases the Gamemaster's targets when the turn changes; then reads Foundry afresh, with
 * nothing waited for between the checks and the turn ended, so a turn ended meanwhile is seen. A
 * turn a module keeps from moving isn't ended (`cancelled`).
 * @param {object} command      `{turn: {combatId, round, combatantId}}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runEndTurnCommand(command, campaign) {
  if ( !campaign.rolls || !diceStatus.ready ) return failedResult(command, "off");
  const invalid = checkCommand(command);
  if ( invalid ) return failedResult(command, "invalid", invalid);
  const found = commandActor(command, campaign);
  if ( !found ) return failedResult(command, "unknown");
  const { character } = found;
  await midiSettledOrLate();

  // Read now, after the wait, and with no wait from here to the turn's end: the Gamemaster, or an
  // earlier press, may have ended this turn meanwhile.
  const { turn } = command;
  if ( !combatEnabled() ) return failedResult(command, "not-in-combat");
  const combat = game.combats.get(turn.combatId);
  if ( !combat || !involvesCampaign(combat, campaign) ) return failedResult(command, "not-in-combat");
  // Foundry's Next Turn on a combat not yet begun would begin it, without its start.
  if ( !combat.started ) return failedResult(command, "not-started");
  const current = combat.combatant;
  // A hidden combatant is never shown to the app as the current one, whatever it's told.
  if ( (combat.round !== turn.round) || (current?.id !== turn.combatantId) || (current.hidden === true) ) {
    return failedResult(command, "moved");
  }
  if ( !endsTurnOf(current, character, campaign) ) return failedResult(command, "not-turn");
  const before = { round: combat.round, combatantId: current.id };
  await combat.nextTurn();
  if ( (combat.round === before.round) && (combat.combatant?.id === before.combatantId) ) {
    return failedResult(command, "cancelled");
  }
  // Remembered, for its player to take back from the app a moment later.
  endedTurns.set(combat.id, {
    requestId: command.id, campaignId: campaign.id, characterId: character.id,
    ended: { round: before.round, combatantId: before.combatantId },
    left: { round: combat.round, combatantId: combat.combatant?.id ?? null },
    at: Date.now()
  });
  return { id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [] };
}

/**
 * Take back the turn an End Turn from the Sending Stone app just ended, since module 0.36.0: only
 * for the character whose player ended it, only while this client remembers that End Turn, a minute
 * at most, as the last of its combat, and the combat still stands exactly where it left it, by its
 * round and current combatant; then one update of the turn back to the combatant whose turn it
 * ended, found by its id, with Foundry's turn events off, so that nothing of the turn's change runs
 * again. What did run then stays done. Nothing is posted.
 * @param {object} command      `{undo, turn: {combatId, round, combatantId}}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runUndoTurnCommand(command, campaign) {
  if ( !campaign.rolls || !diceStatus.ready ) return failedResult(command, "off");
  const invalid = checkCommand(command);
  if ( invalid ) return failedResult(command, "invalid", invalid);
  const found = commandActor(command, campaign);
  if ( !found ) return failedResult(command, "unknown");
  const { character } = found;
  // Midi-QOL releases the Gamemaster's targets whenever the turn is written, back as well.
  await midiSettledOrLate();

  // Read now, after the wait, and with no wait from here to the write: the Gamemaster, or another
  // End Turn, may have moved the turn meanwhile.
  const { turn } = command;
  if ( !combatEnabled() ) return failedResult(command, "not-in-combat");
  const combat = game.combats.get(turn.combatId);
  if ( !combat || !involvesCampaign(combat, campaign) ) return failedResult(command, "not-in-combat");
  const memo = endedTurns.get(combat.id);
  if ( !memo || (memo.requestId !== command.undo) || (memo.campaignId !== campaign.id)
    || (memo.characterId !== character.id) || ((Date.now() - memo.at) > TURN_UNDO_WITHIN) ) {
    return failedResult(command, "not-undoable");
  }
  if ( !combat.started ) return failedResult(command, "not-started");
  const current = combat.combatant;
  // Exactly where that End Turn left it, as the app shows it; never a hidden combatant, which the app
  // is never shown as the current one.
  if ( (combat.round !== turn.round) || (current?.id !== turn.combatantId)
    || (turn.round !== memo.left.round) || (turn.combatantId !== memo.left.combatantId)
    || (current.hidden === true) ) return failedResult(command, "moved");
  const target = combat.combatants.get(memo.ended.combatantId);
  if ( !target || (target.hidden === true) ) return failedResult(command, "not-undoable");
  if ( !endsTurnOf(target, character, campaign) ) return failedResult(command, "not-turn");
  // Its place in the order now, never the one it had: a re-sort since, or a defeated combatant the
  // End Turn skipped, would otherwise give the turn to another.
  const index = combat.turns.findIndex(({ id }) => id === target.id);
  if ( index === -1 ) return failedResult(command, "not-undoable");

  const prior = turnState(combat);
  let heard = false;
  const hear = changed => {
    if ( changed === combat ) heard = true;
  };
  Hooks.on("combatTurnChange", hear);
  try {
    // With the turn events off, no end-of-turn or start-of-turn work, dnd5e's or a module's, runs again.
    await combat.update({ round: memo.ended.round, turn: index }, {
      direction: -1, turnEvents: false,
      worldTime: { delta: combat.getTimeDelta(combat.round, combat.turn, memo.ended.round, index) }
    });
  } finally {
    Hooks.off("combatTurnChange", hear);
  }
  if ( (combat.round !== memo.ended.round) || (combat.combatant?.id !== target.id) ) {
    return failedResult(command, "cancelled");
  }
  endedTurns.delete(combat.id);
  // Core may tell of a turn's change only from its turn events; the app is told once either way.
  if ( !heard ) reportTurnChange(combat, prior, turnState(combat));
  return { id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [] };
}

/**
 * A combat's turn as it stands, as core's `combatTurnChange` gives it.
 * @param {Combat} combat
 * @returns {{round: number, turn: number|null, tokenId: string|null, combatantId: string|null}}
 */
function turnState(combat) {
  const current = combat.combatant ?? null;
  return { round: combat.round, turn: combat.turn, tokenId: current?.tokenId ?? null, combatantId: current?.id ?? null };
}

/**
 * Is a combatant's turn one a campaign character's player may end: the character's own, or one of
 * its companions' by round 0.36.0 §2.1's rule now, never as last told, so a creature hidden or gone
 * a moment ago is no one's?
 * @param {Combatant} combatant
 * @param {Actor} character
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function endsTurnOf(combatant, character, campaign) {
  if ( campaignCharacterId(combatant.actor, campaign) === character.id ) return true;
  return companionsOf(campaign).some(({ entry }) => entry.of.includes(character.id)
    && (companionKeyOf([entry], combatant) !== null));
}

/**
 * Wait for the Midi-QOL uses from the app on their way to be done with the Gamemaster's targets,
 * at most TURN_MIDI_WAIT: past that the turn ends all the same, as the Gamemaster's own Next Turn
 * would.
 * @returns {Promise<void>}
 */
async function midiSettledOrLate() {
  let timer;
  const late = new Promise(resolve => {
    timer = setTimeout(resolve, TURN_MIDI_WAIT);
  });
  try {
    await Promise.race([midiSettled(), late]);
  } finally {
    clearTimeout(timer);
  }
}
