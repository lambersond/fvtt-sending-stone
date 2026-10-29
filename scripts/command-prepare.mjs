import { PREPARE_OPS } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { activeForm } from "./characters.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import { checkCommand, failedResult, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { diceStatus } from "./dice-plan.mjs";
import { campaignGroups } from "./groups.mjs";
import { castCopy } from "./sheet-rolls.mjs";
import { hiddenCopy, preparedOf } from "./sheet-spells.mjs";

/**
 * Preparing and unpreparing a character's spells from the Sending Stone app, since module 0.42.1, as
 * dnd5e's sheet's Prepare and Unprepare do: `system.prepared` set to the state the app asks for,
 * never toggled, on a spell whose casting prepares, as the sheet sends it. Nothing is posted in chat,
 * as dnd5e posts nothing, so only a character's player does it, never the Gamemaster as them.
 * Offered with the charges, wherever the Gamemaster lets the campaign's players attack and cast from
 * the app.
 */

/**
 * The fields of other kinds a spell prepared or unprepared never names, beside those a roll names:
 * a move, a removal, anything typed in, a favorite, a note, a dish, an effect, Wild Shape, a spell
 * slot, charges, Heroic Inspiration, a concentration, a turn and the End Turn a turn taken back names.
 * @type {string[]}
 */
const OTHERS = [
  "transfer", "remove", "typed", "favorite", "note", "dish", "effect", "wildShape", "spellSlot", "counter", "count",
  "inspiration", "concentration", "turn", "undo"
];

/**
 * A spell's id as the sheet names it: its item's, 1 to 64 letters and digits.
 * @type {RegExp}
 */
const SPELL_ID = /^[A-Za-z0-9]{1,64}$/;

/**
 * Why a fetched spell prepared or unprepared isn't one to make, if it isn't: it names one spell, by
 * its id as the sheet names it, and the state wanted of it, prepared or not; and nothing else,
 * nothing a roll names nor another kind's field, and throws no dice. Only its player prepares one
 * from the app: it posts nothing, so would leave no mark of the Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
export function checkPrepareCommand(command) {
  if ( command.by === "gm" ) return "by";
  const given = value => (value !== undefined) && (value !== null);
  const prepare = command.prepare;
  if ( namesRollFields(command) || OTHERS.some(key => given(command[key])) || !isObject(prepare) ) return "prepare";
  if ( (Object.keys(prepare).sort().join() !== "id,op") || !PREPARE_OPS.includes(prepare.op)
    || (typeof prepare.id !== "string") || !SPELL_ID.test(prepare.id) ) return "prepare";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Prepare one of a character's spells, or unprepare it, fetched from the app: every check before the
 * write, as the character and the spell now are. The campaign is read again, as a queue's wait may
 * have changed it. It must be a spell the sheet lists, whose casting prepares, as `preparedOf` says
 * and the sheet sends it, and not the copy an item casts; one already so is done with nothing
 * written, as the app may have been showing an older sheet. A write a hook stops leaves the spell as
 * it was, read again after it: called off. None while the character is transformed: her form's
 * spells are copies her return loses. Then the sheet, as it then stands, ahead of the result, which
 * says nothing of its own: the sheet does.
 * @param {object} command      `{prepare: {op, id}}`, as fetched.
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
export async function runPrepareCommand(command, passed) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !campaign.rolls || !diceStatus.ready ) return failed("off");
  if ( !campaign.attacks ) return failed("attacks-off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const groups = new Set(campaignGroups(campaign).map(group => group.id));
  const actor = (campaign.characters.has(command.actorId) && !groups.has(command.actorId))
    ? (game.actors.get(command.actorId) ?? null) : null;
  if ( !actor ) return failed("unknown");
  if ( activeForm(actor) ) return failed("shaped");

  const { op, id } = command.prepare;
  const spell = actor.items?.get?.(id) ?? null;
  if ( (spell?.type !== "spell") || hiddenCopy(spell) ) return failed("gone");
  const now = preparedOf(spell);
  if ( castCopy(spell) || ![0, 1].includes(now) ) return failed("prepare");
  const wanted = (op === "prepare") ? 1 : 0;
  const done = () => {
    sheetFirst(actor);
    return { id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [] };
  };
  if ( now === wanted ) return done();

  try {
    await spell.update({ "system.prepared": wanted });
  } catch (err) {
    return failed("error", (err instanceof Error) ? err.message : String(err));
  }
  // Read again: a hook may have stopped the write, which then resolves with nothing changed.
  if ( preparedOf(spell) !== wanted ) return failed("cancelled");
  return done();
}
