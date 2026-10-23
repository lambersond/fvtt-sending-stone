import { TURN_MIDI_WAIT } from "./constants.mjs";
import { campaignCharacterId } from "./characters.mjs";
import { combatEnabled } from "./config.mjs";
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
 */

/**
 * The fields a turn is named by, as the app was shown it.
 * @type {string[]}
 */
const TURN_FIELDS = ["combatId", "round", "combatantId"];

/**
 * The fields of other commands an end of a turn never names, beside those a roll names its item,
 * targets or link by.
 * @type {string[]}
 */
const NOT_TURN_FIELDS = ["combatId", "use", "types", "modifiers", "critical"];

/**
 * Why a fetched end of a turn isn't one to make, if it isn't: it names the turn, as the app was
 * shown it, and nothing a roll names, and throws no dice. Only its player ends one from the app: it
 * posts nothing, so would leave no mark of the Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
export function checkEndTurnCommand(command) {
  if ( command.by === "gm" ) return "by";
  const given = field => (command[field] !== undefined) && (command[field] !== null);
  if ( namesRollFields(command) || NOT_TURN_FIELDS.some(given) ) return "turn";
  const { turn } = command;
  if ( !isObject(turn) || (Object.keys(turn).length !== TURN_FIELDS.length)
    || !TURN_FIELDS.every(field => Object.hasOwn(turn, field)) ) return "turn";
  if ( !isId(turn.combatId) || !Number.isInteger(turn.round) || (turn.round < 1) || !isId(turn.combatantId) ) {
    return "turn";
  }
  return throwsNoDice(command) ? null : "dice";
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
  return { id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [] };
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
