import { MODULE_ID, ROLL_TAG } from "./constants.mjs";
import {
  appFlags, authorFor, checkCommand, describeResult, failedResult, findMessage, isId, isKey, isOptional, isRolled,
  PUBLIC
} from "./command-rolls.mjs";
import { offersTypes } from "./command-uses.mjs";
import { commandActor } from "./creatures.mjs";
import {
  changesDamage, diceStatus, matchesDice, modifiedDice, readModifiers, takesAway, unmaximizable, withPlan
} from "./dice-plan.mjs";
import { criticalAdditions, DND5E_ACTIVITIES, ownDamageConfig, previewDamage } from "./sheet-links.mjs";

/**
 * What a player can have made here from a row of their sheet with no attack or use, since 0.36.0
 * (round 0.36.0 §3, §6.8-§6.9): an action's damage or healing on its own, `itemDamage`, as dnd5e's
 * own damage or healing card with no targets, for the Gamemaster to select tokens and apply from its
 * tray, as normal; and a spent recharge rolled, `recharge`, as dnd5e's own recharge roll, with the
 * player's d6. Neither spends anything, and neither goes through Midi-QOL's workflow: dnd5e's own
 * damage roll is called on the activity, as Midi's own sheet Damage button relies on, so Midi's
 * damage calculation applies when the Gamemaster applies it, and nothing else of Midi's does.
 */

/**
 * What a roll names that damage on its own never does: a use, its targets, a spell slot, an attack
 * mode or ammunition, a description's link, an enchantment, a key, a combat or a prompt.
 * @type {string[]}
 */
const NOT_ALONE = [
  "use", "targets", "target", "slot", "attackMode", "ammunition", "text", "link", "enchant", "key", "combatId", "prompt"
];

/**
 * What a roll names that a recharge never does.
 * @type {string[]}
 */
const NOT_RECHARGE = [
  "key", "combatId", "use", "targets", "target", "types", "modifiers", "critical", "text", "link", "prompt", "slot",
  "enchant"
];

/**
 * Is this given, rather than left out?
 * @param {unknown} value
 * @returns {boolean}
 */
function given(value) {
  return (value !== undefined) && (value !== null);
}

/**
 * Does a command throw its dice as they are, with no advantage and nothing added?
 * @param {object} command
 * @returns {boolean}
 */
function plain(command) {
  return (command.mode === 0) && (command.explicit === false) && Array.isArray(command.extras) && !command.extras.length;
}

/**
 * dnd5e's generation, as its version's first number has it: 5 for 5.3.3, 6 for 6.0.5.
 * @returns {number}
 */
export function dnd5eGeneration() {
  return Number.parseInt(String(game.system.version ?? ""));
}

/* -------------------------------------------- */
/*  Damage on its own                           */
/* -------------------------------------------- */

/**
 * Why a fetched action's damage on its own isn't one to make, if it isn't: it names the item and
 * the activity, and none of what a use names; it's thrown as it is; it may be a critical hit's; and
 * it has the dice the activity throws, which are checked against them when it's made, and the kind
 * of damage chosen for each of its rolls, as a use's damage has.
 * @param {object} command
 * @returns {string|null}
 */
export function checkItemDamageCommand(command) {
  if ( !isId(command.item) || !isId(command.activity) ) return "item";
  if ( NOT_ALONE.some(field => given(command[field])) ) return "item";
  if ( !plain(command) ) return "mode";
  if ( !isOptional(command.critical, critical => critical === true) ) return "critical";
  const { dice, types } = command;
  if ( !Array.isArray(dice) || !dice.length || (dice.length > 20) || !dice.every(isRolled) ) return "dice";
  if ( given(types) && (!Array.isArray(types) || (types.length > 20) || !types.every(type => (type === null) || isKey(type))) ) {
    return "types";
  }
  return null;
}

/**
 * Roll an action's damage or healing on its own, with the player's dice, as dnd5e's sheet and chat
 * Damage buttons make it: dnd5e's own card for the activity's kind, a heal's healing, with its
 * damage breakdown and a save's "On save" line, naming no target, ever, whatever the Gamemaster has
 * targeted, for them to select tokens and apply it from its tray; authored as the player, their
 * character's for a companion's; public; flagged `alone`, so that the app's chat can say it was
 * made on its own. No use, slot, ammunition or save: the first attack mode, at the spell's own
 * level, as the sheet's `tableDamage` previews it, which the dice must be, changed as the player
 * chose, and a critical hit's only where the activity allows one. Each check is made before
 * anything is rolled.
 * @param {object} command      `{item, activity, critical?, dice, types?, modifiers?}`, as fetched.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runItemDamageCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready ) return failed("off");
  if ( !campaign.attacks ) return failed("attacks-off");
  if ( !diceStatus.attacks ) return failed("self-test");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const modifiers = readModifiers(command.modifiers);
  if ( modifiers === null ) return failed("invalid", "modifiers");
  if ( changesDamage(modifiers) && !diceStatus.modifiers ) return failed("self-test");
  const found = commandActor(command, campaign);
  if ( !found ) return failed("unknown");
  const { actor, character } = found;

  const item = actor.items?.get(command.item);
  const activity = item?.system?.activities?.get?.(command.activity);
  if ( !item || !activity || (item.system?.identified === false) || !DND5E_ACTIVITIES[activity.type] ) return failed("gone");
  const isCritical = command.critical === true;
  const preview = previewDamage(activity, { isCritical });
  if ( !preview?.plannable ) return failed("gone");
  if ( isCritical && ((activity.type === "heal")
    || !criticalAdditions(ownDamageConfig(activity), preview.rolls.length).allowed) ) return failed("invalid", "critical");
  // At its highest, damage that takes a die away would take the most away, and a die Foundry rolls
  // again, as one that explodes, wouldn't be at its highest.
  const formulas = preview.rolls.map(roll => roll.formula);
  if ( modifiers?.maximize && (takesAway(preview) || unmaximizable(formulas)) ) return failed("invalid", "modifiers");
  const expected = modifiedDice(preview, modifiers);
  if ( !expected || !matchesDice(command.dice, expected) ) return failed("invalid", "dice");
  if ( !offersTypes(command.types, preview) ) return failed("type");

  // dnd5e's own, not a module's in its place: Midi-QOL's would add the ammunition it cached on the
  // activity from an earlier attack.
  const own = globalThis.dnd5e?.documents?.activity?.[DND5E_ACTIVITIES[activity.type]]?.prototype?.rollDamage;
  if ( typeof own !== "function" ) return failed("gone");
  const sixth = dnd5eGeneration() >= 6;
  let plan;
  let rolls;
  try {
    rolls = await withPlan(command, made => {
      plan = made;
      return own.call(activity,
        { isCritical, [ROLL_TAG]: command.id },
        { configure: false },
        { rollMode: PUBLIC, data: {
          author: authorFor(actor, character).id,
          // No targets, ever: the Gamemaster's of the moment aren't the player's. dnd5e 6 keeps
          // them in its message's own data, which it reads alone. Marked made on its own, so that
          // the app can say it's for the Gamemaster to apply.
          flags: { ...(!sixth && { dnd5e: { targets: [] } }), [MODULE_ID]: { ...appFlags(command), alone: true } },
          ...(sixth && { system: { targets: [] } })
        } }
      );
    });
  } catch (err) {
    return failed("error", err instanceof Error ? err.message : String(err));
  }
  if ( !rolls?.length ) return (plan?.refusal === "dice") ? failed("invalid", "dice") : failed(plan?.refusal ?? "cancelled");
  return describeResult(command, rolls[0].parent ?? findMessage(command.id), character, campaign, { rolls });
}

/* -------------------------------------------- */
/*  Recharges                                   */
/* -------------------------------------------- */

/**
 * Why a fetched recharge isn't one to make, if it isn't: it names the item, and the activity whose
 * own uses recharge, if it's an activity's, each an id; it's one d6, thrown as it is; and it names
 * nothing else a roll does.
 * @param {object} command
 * @returns {string|null}
 */
export function checkRechargeCommand(command) {
  if ( !isId(command.item) ) return "item";
  if ( given(command.activity) && !isId(command.activity) ) return "item";
  const { dice } = command;
  const one = Array.isArray(dice) && (dice.length === 1) && isRolled(dice[0]) && (dice[0].faces === 6)
    && (dice[0].results.length === 1);
  if ( !one ) return "dice";
  if ( !plain(command) ) return "mode";
  if ( NOT_RECHARGE.some(field => given(command[field])) ) return "item";
  return null;
}

/**
 * Roll a spent recharge, as dnd5e's own `rollRecharge` rolls one, with the player's d6: an item's
 * uses, or one of its activities' own, that recharge, where any is spent, as dnd5e would roll one,
 * against the recovery's formula; recharged on a success, as dnd5e recharges it; posted publicly,
 * spoken by the creature, authored as the player, their character's for a companion's. dnd5e's
 * hooks may keep the uses as they were, which leaves the roll as it was made. Refused as no such
 * item or activity, or none that recharges (`gone`), and as not spent (`charged`).
 * @param {object} command      `{item, activity?, dice: [one d6]}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runRechargeCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready ) return failed("off");
  if ( !campaign.attacks ) return failed("attacks-off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const found = commandActor(command, campaign);
  if ( !found ) return failed("unknown");
  const { actor, character } = found;

  const item = actor.items?.get(command.item);
  const ofActivity = given(command.activity);
  const subject = ofActivity ? item?.system?.activities?.get?.(command.activity) : item;
  if ( !subject ) return failed("gone");
  const uses = ofActivity ? subject.uses : subject.system?.uses;
  const recovery = Array.from(uses?.recovery ?? []).find(each => each?.period === "recharge");
  if ( !recovery || (typeof uses.rollRecharge !== "function") ) return failed("gone");
  if ( !uses.spent ) return failed("charged");

  // dnd5e's own roll, given whole, as its options merge arrays whole: tagged as the player's.
  const delta = ofActivity ? { item: item.id, keyPath: `system.activities.${subject.id}.uses.spent` }
    : { item: item.id, keyPath: "system.uses.spent" };
  let plan;
  let made;
  try {
    made = await withPlan(command, planned => {
      plan = planned;
      return uses.rollRecharge(
        { rolls: [{
          parts: ["1d6"],
          data: subject.getRollData(),
          options: { delta, target: Number.parseInt(recovery.formula ?? "6"), [ROLL_TAG]: command.id }
        }] },
        {},
        { rollMode: PUBLIC, data: { author: authorFor(actor, character).id, flags: { [MODULE_ID]: appFlags(command) } } }
      );
    });
  } catch (err) {
    return failed("error", err instanceof Error ? err.message : String(err));
  }
  const rolls = Array.isArray(made) ? made : made?.rolls;
  if ( !rolls?.length ) return (plan?.refusal === "dice") ? failed("invalid", "dice") : failed(plan?.refusal ?? "cancelled");
  const message = rolls[0].parent ?? findMessage(command.id);
  if ( !message ) return failed("cancelled");
  const result = describeResult(command, message, character, campaign, { rolls });
  if ( result.visible ) result.outcome = rolls[0].isSuccess ? "success" : "failure";
  return result;
}
