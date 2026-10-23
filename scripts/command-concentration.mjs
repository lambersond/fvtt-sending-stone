import { sheetFirst } from "./command-enchant.mjs";
import { checkCommand, failedResult } from "./command-rolls.mjs";
import { commandActor } from "./creatures.mjs";
import { diceStatus } from "./dice-plan.mjs";

/**
 * Ending a concentration of a character's from the Sending Stone app, since module 0.29.0, as
 * dnd5e's Break Concentration does: one of those the sheet lists, by its effect, through dnd5e's
 * own `endConcentration`, so that its hooks may stop it, and what depends on it, such as Bless on
 * the character's allies or an enchantment tied to it, goes with it, as the active Gamemaster's
 * client deletes it. Nothing is posted in chat, as dnd5e posts nothing; so only its player ends one
 * from the app, never the Gamemaster as them, which would leave no mark.
 *
 * Offered wherever the campaign's players' rolls are made, as their concentration checks are,
 * whether or not they may attack and cast from the app: it throws no dice and uses nothing.
 */

/**
 * End a concentration of a character's, if the campaign's players' rolls are made here, the
 * character is one of the campaign's, and it concentrates on it now; then send their sheet, as it
 * then stands, ahead of the result. A concentration dnd5e's hooks keep, as a module's may, isn't
 * ended (`cancelled`). Since 0.36.0 one of a companion of theirs, named by `of`, on its live actor.
 * @param {object} command      `{concentration: {effect}}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runEndConcentrationCommand(command, campaign) {
  if ( !campaign.rolls || !diceStatus.ready ) return failedResult(command, "off");
  const invalid = checkCommand(command);
  if ( invalid ) return failedResult(command, "invalid", invalid);
  const found = commandActor(command, campaign);
  if ( !found ) return failedResult(command, "unknown");
  const { actor } = found;
  // Read now, in its turn: an earlier command, or the Gamemaster, may have ended it meanwhile.
  const effectId = command.concentration.effect;
  const concentrating = Array.from(actor.concentration?.effects ?? []).some(effect => effect.id === effectId);
  if ( !concentrating ) return failedResult(command, "concentration");
  const ended = await actor.endConcentration(effectId);
  if ( !Array.isArray(ended) || !ended.length ) return failedResult(command, "cancelled");
  sheetFirst(actor, found.companion);
  return { id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [] };
}
