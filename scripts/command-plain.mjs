import { MODULE_ID, ROLL_TAG } from "./constants.mjs";
import { dnd5eGeneration } from "./command-alone.mjs";
import { appFlags, authorFor, checkCommand, describeResult, failedResult, findMessage, PUBLIC } from "./command-rolls.mjs";
import { commandActor } from "./creatures.mjs";
import { diceStatus, withPlan } from "./dice-plan.mjs";

/**
 * A plain roll of dice from the Sending Stone app's dice tray, since module 0.44.0: any mix of d4s,
 * d6s, d8s, d10s, d12s, d20s and d100s, and a number added or taken away, such as 2d6 + 1d8 + 2, for
 * what the Gamemaster asks. Made in the game as any player's roll is, with the dice they rolled, by
 * dnd5e's own basic roll, without its dialog, with no advantage and nothing else added: as the
 * character's player, spoken by the character, or her form while she's shaped where the app takes
 * Wild Shape, for everyone to see, its flavor "Dice roll". It names no item, no target and no sheet,
 * so a companion never makes one: it's its character's player's.
 *
 * Offered wherever the campaign's players' rolls are made, under dnd5e 5 and 6.
 */

/**
 * Make a plain roll from the app, if the campaign takes its players' rolls.
 * @param {object} command      `{plainRoll: {terms, bonus?}}`, as fetched from the app.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export async function runPlainRollCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const found = commandActor(command, campaign);
  if ( !found ) return failed("unknown");
  const { actor, character } = found;
  let plan;
  let rolls;
  try {
    rolls = await withPlan(command, made => {
      plan = made;
      return CONFIG.Dice.BasicRoll.build(
        { rolls: [{ parts: [plainFormula(command.plainRoll)], data: {}, options: { [ROLL_TAG]: command.id } }] },
        { configure: false },
        plainMessage(command, actor, character)
      );
    });
  } catch (err) {
    return failed("error", (err instanceof Error) ? err.message : String(err));
  }
  const message = rolls?.[0]?.parent ?? (rolls?.length ? findMessage(command.id) : null);
  // A roll a module called off, as dnd5e's hooks allow, made nothing; so did one called off here.
  if ( !message ) return failed(plan?.refusal ?? "cancelled");
  return describeResult(command, message, character, campaign, { rolls });
}

/**
 * A plain roll's formula, as Foundry reads it: each size's dice in the order sent, then the number
 * added or taken away, if any, such as "2d6 + 1d8 + 2" or "1d20 - 1"; a d100 as one die, "1d100".
 * @param {{terms: {faces: number, count: number}[], bonus?: number|null}} plainRoll
 * @returns {string}
 */
export function plainFormula({ terms, bonus }) {
  const dice = terms.map(({ faces, count }) => `${count}d${faces}`).join(" + ");
  if ( !Number.isInteger(bonus) || !bonus ) return dice;
  return `${dice} ${(bonus < 0) ? "-" : "+"} ${Math.abs(bonus)}`;
}

/**
 * The message a plain roll is posted with: the player's, spoken by the actor it's made for, for
 * everyone to see, naming no target. Under dnd5e 5 a roll's flags, of the generic kind, as dnd5e 5
 * flags a formula's; under dnd5e 6 its own generic message, as dnd5e 6 posts a utility's roll, which
 * keeps its targets in its own data and migrates dnd5e 5's roll flags away.
 * @param {object} command
 * @param {Actor} actor         The actor it's made for: the character, or her form.
 * @param {Actor} character     Whose player makes it.
 * @returns {object}
 */
function plainMessage(command, actor, character) {
  const sixth = dnd5eGeneration() >= 6;
  return {
    rollMode: PUBLIC,
    data: {
      author: authorFor(actor, character).id,
      speaker: ChatMessage.implementation.getSpeaker({ actor, token: actor.token ?? undefined }),
      flavor: game.i18n.localize("SENDINGSTONE.Roll.Plain"),
      ...(sixth && { type: "generic", system: { targets: [] } }),
      flags: {
        ...(!sixth && { dnd5e: { messageType: "roll", roll: { type: "generic" }, targets: [] } }),
        [MODULE_ID]: appFlags(command)
      }
    }
  };
}
