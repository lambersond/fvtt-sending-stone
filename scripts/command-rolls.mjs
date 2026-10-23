import {
  ATTACK_KINDS, COMPANION_INITIATIVE, COMPANION_UNTAKEN, CONCENTRATION_KINDS, DIE_FACES, ENCHANT_KINDS, MODULE_ID,
  MOST_HIT_DICE, MOST_SPENT, ROLL_KINDS, ROLL_TAG, TURN_KINDS
} from "./constants.mjs";
import { playerOwners } from "./characters.mjs";
import { chatAudience, summarizeRoll } from "./chat-data.mjs";
import { checkItemDamageCommand, checkRechargeCommand } from "./command-alone.mjs";
import { checkNoteCommand } from "./command-notes.mjs";
import { commandActor, ownedByPlayers } from "./creatures.mjs";
import { checkRemoveCommand, checkTransferCommand } from "./command-transfers.mjs";
import { checkEndTurnCommand } from "./command-turn.mjs";
import { diceStatus, formulaRoll, matchesDice, plannedDice, readModifiers, withPlan } from "./dice-plan.mjs";
import {
  claimMidiPrompt, midiAnswerAuthor, midiAnswerConfig, midiAnswerFailed, midiAnswerFlags, midiOutcome,
  midiPromptAnswered
} from "./midi-prompts.mjs";
import { findPrompt, outcomeOf } from "./prompts.mjs";
import { findLink, MOST_LINKS } from "./sheet-links.mjs";
import { castSpellOf, checkOf, forwardTarget, shownActivity } from "./sheet-rolls.mjs";
import { castFrom } from "./sheet-spells.mjs";

/**
 * Making a player's roll from the Sending Stone app: a check, saving throw, death saving throw or
 * initiative, a hit die spent, or several at once, or a utility's own roll, such as a d4 of luck,
 * through dnd5e, as if the player had rolled it in Foundry, with the dice they rolled; a saving
 * throw the game asked them for, on the card that asked, or since 0.27.0 one Midi-QOL asked them
 * for, a check or skill check among them, as Midi rolls it; a saving throw or check a description
 * of theirs calls for, against its DC; and a check one of their check activities calls for, as its
 * card's button rolls it.
 */

/**
 * How a player's roll is shown: to everyone, as a player's own roll usually is. A module may still
 * make it blind, as Midi-QOL can; the player is then told only that it was made.
 * @type {string}
 */
export const PUBLIC = "public";

/**
 * The rolls of something on the sheet: a skill, tool or ability, by its key. Each may be rolled for
 * a link in a description, a check or a saving throw.
 * @type {Set<string>}
 */
const KEYED = new Set(["skill", "tool", "ability", "save"]);

/**
 * The rolls that may answer a prompt: a saving throw, and since 0.27.0 an ability check or skill
 * check Midi-QOL asks for.
 * @type {Set<string>}
 */
const PROMPTED = new Set(["save", "ability", "skill"]);

/**
 * The kind of check each roll of a check is, as a description's check names its choices.
 * @type {Record<string, string>}
 */
const CHECK_TYPES = { ability: "check", skill: "skill", tool: "tool" };

/**
 * The commands that may name an item and one of its activities: an attack, a use, a utility's roll
 * and since 0.36.0 an action's damage on its own, which must; and a check, which may, rolled for one
 * of the item's check activities. Not a recharge, which may name its item alone.
 * @type {Set<string>}
 */
const WITH_ITEM = new Set(["attack", "use", "formula", "skill", "tool", "ability", "itemDamage"]);

/**
 * Every command a player's roll may be, by kind, for which its item and activity are checked.
 * @type {Set<string>}
 */
const KNOWN_KINDS = new Set([...ROLL_KINDS, ...ATTACK_KINDS, "ask", "textRoll", "textDamage", "itemDamage"]);

/**
 * The rolls made as they are, with no advantage and nothing added: a hit die, hit dice spent at
 * once, and a utility's own roll.
 * @type {Set<string>}
 */
const PLAIN = new Set(["hitDie", "hitDice", "formula"]);

/**
 * The rolls that spend hit dice: one, or several at once. Both are made only once the self-test
 * has shown a hit die takes the player's die.
 * @type {readonly string[]}
 */
export const HIT_DICE_KINDS = Object.freeze(["hitDie", "hitDice"]);

/**
 * What became of a player's roll, as the app is told.
 * @typedef {object} CommandResult
 * @property {string} id
 * @property {"done"|"failed"} status
 * @property {string|null} reason       Why it wasn't made, such as "not-dying".
 * @property {string|null} error        What went wrong, for an error.
 * @property {string|null} messageId    The chat message the roll made; for hit dice, the last.
 * @property {boolean} visible          May its player see the roll? Not one made blind.
 * @property {object[]} rolls           The roll as made, when its player may see it; for hit dice,
 *                                      every roll of every card, in order.
 * @property {number} [healed]          For a hit die or hit dice: the hit points gained.
 * @property {{count: number, made: number}} [spent]   For hit dice: how many were asked for, and
 *                                      how many were rolled, a card each, before they were done or
 *                                      stopped.
 * @property {object|null} [attack]     For an attack: whether it was a critical hit or a fumble, and
 *                                      whether it hit its target, or each target of an area attack,
 *                                      when its player may know.
 * @property {object|null} [damage]     For an attack: the dice its damage will throw, for its player
 *                                      to roll; null when no damage follows.
 * @property {string|null} [outcome]    For a save the game asked for, a save or check a description
 *                                      calls for against a DC, or a check a check activity calls for
 *                                      against its own: "success" or "failure", where its player may
 *                                      know.
 */

/**
 * What the app is told of a command that wasn't made.
 * @param {object} command
 * @param {string} reason         Why not, such as "not-dying".
 * @param {string|null} [error]   What went wrong, for an error.
 * @returns {CommandResult}
 */
export function failedResult(command, reason, error=null) {
  return { id: command.id, status: "failed", reason, error, messageId: null, visible: false, rolls: [] };
}

/**
 * The flags this module puts on a message a command makes: the command's id, under the key that
 * says what the message is, and from 0.23.0, where the campaign's Gamemaster made the roll in the
 * app as the character, `by: "gm"`. The message's author is the player's all the same, as the
 * modules that read it expect: only this mark says who rolled. From 0.32.0, where the player typed
 * the dice in from their own physical dice, `typed: true`; never with the Gamemaster's mark, whose
 * page never types. The dice are used the same either way. Since 0.36.0 one made for a companion's
 * command says which, `companion`, by its key, the command's `actorId`, so that the app places it
 * however Foundry names its speaker.
 * @param {object} command
 * @param {"request"|"use"|"outcome"} [key]   "request" for a roll, "use" for a use's card, and
 *                                            "outcome" for dnd5e 5.3's message of a death save's.
 * @returns {object}
 */
export function appFlags(command, key="request") {
  return { [key]: command.id, ...((command.by === "gm") && { by: "gm" }),
    ...((command.typed === true) && (command.by !== "gm") && { typed: true }),
    ...(isId(command.of) && { companion: String(command.actorId) }) };
}

/* -------------------------------------------- */

/**
 * Make a player's roll for their character, if the campaign takes their rolls and the character
 * can make it now. Since 0.36.0 one for a companion of theirs, named by `of`, on its live actor, as
 * their character's player; a companion's initiative is refused while the campaign keeps it right
 * after a character of its in that combat (`follows`).
 * @param {object} command      The player's roll, as fetched from the app.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]   Aborted once the app has been told the roll took too long:
 *                                         hit dice spent at once then stop before the next die.
 * @returns {Promise<CommandResult>}
 */
export async function runRollCommand(command, campaign, { signal }={}) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  if ( HIT_DICE_KINDS.includes(command.kind) && !diceStatus.hitDice ) return failed("self-test");
  const found = commandActor(command, campaign);
  if ( !found ) return failed("unknown");
  const { actor, character, companion } = found;
  if ( (command.kind === "initiative") && followsCharacter(command, campaign, companion) ) return failed("follows");
  const refusal = checkRoll(command, actor);
  if ( refusal ) return failed(refusal);
  if ( command.kind === "hitDice" ) return spendHitDice(command, actor, campaign, signal, character);
  // A companion no player of its characters owns in Foundry was sent its descriptions without the
  // Gamemaster's secrets, and its links are read from those.
  const secrets = companion ? ownedByPlayers(actor, companion.of) : true;
  let link = null;
  let check = null;
  if ( CHECK_TYPES[command.kind] && (typeof command.item === "string") ) {
    const checked = activityCheck(command, actor);
    if ( checked.refusal ) return failed(checked.refusal);
    link = { dc: checked.dc, usingTool: null, tool: checked.tool };
    check = checked.check;
  }
  else if ( isTextHash(command.text) ) {
    const linked = (command.kind === "save") ? await linkedSave(command, actor, secrets)
      : await linkedCheck(command, actor, secrets);
    if ( linked.refusal ) return failed(linked.refusal);
    link = linked.link;
    check = linked.check ?? null;
  }
  let prompt = null;
  if ( command.prompt ) {
    const asked = findPrompt(command.prompt, actor, campaign, command);
    if ( asked.refusal ) return failed("prompt", asked.refusal);
    // Midi waits on it: made at once, and told of with no message where Midi makes none.
    if ( asked.midi ) return answerMidiPrompt(command, asked.midi);
    // A card's asks for a saving throw alone.
    if ( (command.kind !== "save") || !asked.prompt.abilities.includes(command.key) ) {
      return failed("prompt", "ability");
    }
    prompt = asked.prompt;
  }

  const hp = actor.system.attributes?.hp?.value ?? 0;
  let made;
  let plan;
  try {
    made = await withPlan(command, planned => {
      plan = planned;
      if ( prompt ) return answerPrompt(command, actor, prompt, character);
      if ( check ) return rollLinkedCheck(command, actor, link, check, character);
      return link ? rollLinkedSave(command, actor, link, character) : makeRoll(command, actor, character);
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not make ${actor.name}'s roll from Sending Stone`, err);
    return failed("error", err instanceof Error ? err.message : String(err));
  }
  const message = (prompt || link) ? made?.message : made;
  // A roll a module called off, as dnd5e's hooks allow, made nothing; so did one called off here.
  if ( !message ) return failed(plan?.refusal ?? "cancelled");
  const result = describeResult(command, message, character, campaign);
  if ( prompt || link ) result.outcome = result.visible ? made.outcome : null;
  // The hit points dnd5e gave the character for a hit die: none where a module kept it from it.
  if ( command.kind === "hitDie" ) result.healed = Math.max((actor.system.attributes?.hp?.value ?? hp) - hp, 0);
  return result;
}

/**
 * Why a fetched roll isn't one to make, if it isn't. The app checks the same, but what reaches the
 * game is checked again here: only dice a player can roll, and only values those dice show. A
 * check or saving throw may name the link in a description it's rolled for, but not while
 * answering a prompt; and a check may name the item and check activity it's rolled for instead.
 * Only a use names the enchantment it applies. Ending a concentration, spending charges and Heroic
 * Inspiration each name what they end, spend or change, and nothing else; and since 0.31.0, a move
 * of items and coins what it moves, from where to where. Since 0.36.0 a command may name the
 * campaign character whose companion it's for, `of`, an id, but for a kind a companion never makes,
 * as Heroic Inspiration or charges spent by hand; and an end of a turn names the turn, as the app
 * was shown it, and nothing else.
 * @param {object} command
 * @returns {string|null}
 */
export function checkCommand(command) {
  if ( (command.by !== undefined) && (command.by !== null) && (command.by !== "gm") ) return "by";
  if ( !isOptional(command.of, isId) ) return "of";
  if ( isId(command.of) && COMPANION_UNTAKEN.includes(command.kind) ) return "of";
  if ( TURN_KINDS.includes(command.kind) ) return checkEndTurnCommand(command);
  const named = checkItemCommand(command);
  if ( named ) return named;
  if ( ENCHANT_KINDS.includes(command.kind) ) return checkEnchantCommand(command);
  if ( CONCENTRATION_KINDS.includes(command.kind) ) return checkConcentrationCommand(command);
  if ( command.kind === "spend" ) return checkSpendCommand(command);
  if ( command.kind === "inspiration" ) return checkInspirationCommand(command);
  if ( command.kind === "transfer" ) return checkTransferCommand(command);
  if ( command.kind === "remove" ) return checkRemoveCommand(command);
  if ( command.kind === "note" ) return checkNoteCommand(command);
  if ( (command.kind !== "use") && (command.enchant !== undefined) && (command.enchant !== null) ) return "enchant";
  if ( command.kind === "ask" ) return checkAskCommand(command);
  if ( ["textRoll", "textDamage"].includes(command.kind) ) return checkTextCommand(command);
  if ( command.kind === "itemDamage" ) return checkItemDamageCommand(command);
  if ( ATTACK_KINDS.includes(command.kind) ) return checkAttackCommand(command);
  if ( command.kind === "recharge" ) return checkRechargeCommand(command);
  if ( !ROLL_KINDS.includes(command.kind) ) return "kind";
  if ( PLAIN.has(command.kind) ) return checkPlainCommand(command);
  if ( KEYED.has(command.kind) !== (typeof command.key === "string") ) return "key";
  if ( (command.kind === "initiative") !== (typeof command.combatId === "string") ) return "combat";
  if ( ![-1, 0, 1].includes(command.mode) || (typeof command.explicit !== "boolean") ) return "mode";
  if ( !isOptional(command.prompt, isPromptId) || (command.prompt && !PROMPTED.has(command.kind)) ) return "prompt";
  const linked = (command.text !== undefined) && (command.text !== null);
  if ( linked && (!KEYED.has(command.kind) || !isTextHash(command.text)) ) return "text";
  if ( linked ? !isLinkIndex(command.link) : ((command.link !== undefined) && (command.link !== null)) ) return "link";
  if ( linked && command.prompt ) return "prompt";
  const { extras, dice } = command;
  if ( !Array.isArray(extras) || (extras.length > 10) || !extras.every(isExtra) ) return "extras";
  if ( !Array.isArray(dice) || !dice.length || (dice.length > 11) || !dice.every(isRolled) ) return "dice";
  return null;
}

/**
 * Why a fetched command's item and activity aren't ones to make it with, if they aren't: only an
 * attack, a use, a utility's roll and a check name them, and then both, each an id; and a check
 * rolled for a check activity names no description's link, nor a prompt, besides. Whether one that
 * must name them does is checked with the rest of it.
 * @param {object} command
 * @returns {string|null}
 */
function checkItemCommand(command) {
  const given = value => (value !== undefined) && (value !== null);
  if ( !KNOWN_KINDS.has(command.kind) || (!given(command.item) && !given(command.activity)) ) return null;
  if ( !WITH_ITEM.has(command.kind) || !isId(command.item) || !isId(command.activity) ) return "item";
  if ( CHECK_TYPES[command.kind] && [command.text, command.link, command.prompt].some(given) ) return "item";
  return null;
}

/**
 * Why a fetched ask of the table isn't one to make, if it isn't: it names a description and a link
 * in it, and rolls nothing.
 * @param {object} command
 * @returns {string|null}
 */
export function checkAskCommand(command) {
  if ( !isTextHash(command.text) ) return "text";
  if ( !isLinkIndex(command.link) ) return "link";
  return null;
}

/**
 * Why a fetched roll of a description's damage, healing or other roll isn't one to make, if it
 * isn't. It names a description and a link in it; it's rolled with no advantage and nothing added,
 * as a utility's roll is; and has the dice the link's formula throws, if any, which are checked
 * against them when it's made. Damage may name the kind chosen for each of its parts, be a critical
 * hit's, and be changed as the player chose in the app, as an attack's damage may; a description's
 * own roll is rolled as it is.
 * @param {object} command
 * @returns {string|null}
 */
export function checkTextCommand(command) {
  if ( !isTextHash(command.text) ) return "text";
  if ( !isLinkIndex(command.link) ) return "link";
  if ( !isOptional(command.mode, mode => mode === 0) || !isOptional(command.explicit, explicit => explicit === false) ) {
    return "mode";
  }
  if ( !isOptional(command.extras, extras => Array.isArray(extras) && !extras.length) ) return "extras";
  if ( (command.prompt !== undefined) && (command.prompt !== null) ) return "prompt";
  const damage = command.kind === "textDamage";
  if ( !isOptional(command.critical, critical => (critical === false) || (damage && (critical === true))) ) {
    return "critical";
  }
  const changed = (command.modifiers !== undefined) && (command.modifiers !== null);
  if ( changed && (!damage || (readModifiers(command.modifiers) === null)) ) return "modifiers";
  const { dice, types } = command;
  if ( !Array.isArray(dice) || (dice.length > 20) || !dice.every(isRolled) ) return "dice";
  if ( (types !== undefined) && (types !== null) ) {
    if ( !damage ) return "types";
    if ( !Array.isArray(types) || (types.length > 20) || !types.every(type => (type === null) || isKey(type)) ) {
      return "types";
    }
  }
  return null;
}

/**
 * Is this the hash of a description, as the module sends it: 14 hexadecimal digits?
 * @param {unknown} value
 * @returns {boolean}
 */
function isTextHash(value) {
  return (typeof value === "string") && /^[0-9a-f]{14}$/.test(value);
}

/**
 * Is this the number of a link to act on in a description, as the module numbers them?
 * @param {unknown} value
 * @returns {boolean}
 */
function isLinkIndex(value) {
  return Number.isInteger(value) && (value >= 0) && (value < MOST_LINKS);
}

/**
 * Why a fetched hit die, hit dice or utility's roll isn't one to make, if it isn't. None is rolled
 * with advantage, has anything added, or answers a prompt. A hit die names its size, and has the
 * one die rolled of it. Hit dice name no one size, but each size and how many of it, each size
 * once, and no more than a character of 20th level has; and have the dice rolled of each, in the
 * same order. A utility's roll names the item and activity, and has the dice its formula throws, if
 * any, which are checked against them when it's made.
 * @param {object} command
 * @returns {string|null}
 */
function checkPlainCommand(command) {
  if ( (command.mode !== 0) || (command.explicit !== false) ) return "mode";
  if ( !Array.isArray(command.extras) || command.extras.length ) return "extras";
  if ( (command.prompt !== undefined) && (command.prompt !== null) ) return "prompt";
  const { dice } = command;
  if ( command.kind === "hitDie" ) {
    const faces = Number(/^d(\d{1,3})$/.exec(String(command.denomination ?? ""))?.[1]);
    if ( !DIE_FACES.has(faces) ) return "denomination";
    const one = Array.isArray(dice) && (dice.length === 1) && isRolled(dice[0]) && (dice[0].faces === faces)
      && (dice[0].results.length === 1);
    return one ? null : "dice";
  }
  if ( command.kind === "hitDice" ) {
    if ( (command.denomination !== undefined) && (command.denomination !== null) ) return "denomination";
    const { hitDice } = command;
    if ( !Array.isArray(hitDice) || !hitDice.length || (hitDice.length > DIE_FACES.size) ) return "hit-dice";
    const sizes = hitDice.map(entry => facesOf(entry?.denomination));
    const counts = hitDice.map(entry => entry?.count);
    if ( !sizes.every(faces => DIE_FACES.has(faces)) || (new Set(sizes).size !== sizes.length) ) return "hit-dice";
    if ( !counts.every(count => Number.isInteger(count) && (count >= 1) && (count <= MOST_HIT_DICE)) ) return "hit-dice";
    if ( counts.reduce((total, count) => total + count, 0) > MOST_HIT_DICE ) return "hit-dice";
    const each = Array.isArray(dice) && (dice.length === hitDice.length) && dice.every((rolled, index) =>
      isRolled(rolled) && (rolled.faces === sizes[index]) && (rolled.results.length === counts[index]));
    return each ? null : "dice";
  }
  if ( !isId(command.item) || !isId(command.activity) ) return "item";
  if ( !Array.isArray(dice) || (dice.length > 20) || !dice.every(isRolled) ) return "dice";
  return null;
}

/**
 * The faces of a size of hit die, as a class names it, such as 10 for "d10"; NaN for anything else.
 * @param {unknown} denomination
 * @returns {number}
 */
function facesOf(denomination) {
  return Number(/^d(\d{1,3})$/.exec((typeof denomination === "string") ? denomination : "")?.[1]);
}

/**
 * Is this a prompt's id, as the app sends it: a card's id and a character's, joined by "-"?
 * @param {unknown} value
 * @returns {boolean}
 */
function isPromptId(value) {
  return (typeof value === "string") && /^[A-Za-z0-9]{1,64}-[A-Za-z0-9]{1,64}$/.test(value);
}

/**
 * Why a fetched attack, use or damage isn't one to make, if it isn't. An attack names the item and
 * activity it's made with, and the combatant it's made at, if any, or for an area attack those in
 * its area, but not both, and has its d20s and any dice the player added; it may name the spell
 * slot, ammunition and attack mode it's made with, but never its user as a target. A use names the
 * item and activity, the combatants it's used at, whether it's used at its user too, `self`, and
 * the spell slot, if any, and for an enchantment the profile chosen and the item, if any, and has
 * no dice. Damage names the use it follows and has the dice that use's damage throws, if any,
 * which are checked against them when it's made, and the kind of damage chosen for each of its
 * rolls.
 * @param {object} command
 * @returns {string|null}
 */
function checkAttackCommand(command) {
  const { dice } = command;
  if ( command.kind === "damage" ) {
    if ( !isId(command.use) ) return "use";
    if ( !Array.isArray(dice) || (dice.length > 20) || !dice.every(isRolled) ) return "dice";
    const { types } = command;
    if ( (types !== undefined) && (types !== null)
      && (!Array.isArray(types) || (types.length > 20) || !types.every(type => (type === null) || isKey(type))) ) {
      return "types";
    }
    return null;
  }
  if ( !isId(command.item) || !isId(command.activity) ) return "item";
  if ( !isOptional(command.slot, isKey) ) return "slot";
  if ( command.kind === "use" ) {
    const { targets } = command;
    if ( !Array.isArray(targets) || (targets.length > 20) || !targets.every(isTarget) ) return "target";
    if ( !isOptional(command.self, self => typeof self === "boolean") ) return "self";
    if ( !isOptional(command.enchant, isEnchant) ) return "enchant";
    return null;
  }
  if ( !isOptional(command.self, self => self === false) ) return "self";
  const { target, targets } = command;
  if ( (target !== null) && (target !== undefined) && !isTarget(target) ) return "target";
  if ( (targets !== null) && (targets !== undefined) ) {
    const single = (target !== null) && (target !== undefined);
    if ( single || !Array.isArray(targets) || (targets.length > 20) || !targets.every(isTarget) ) return "target";
  }
  if ( !isOptional(command.ammunition, isId) ) return "ammo";
  if ( !isOptional(command.attackMode, isKey) ) return "attack-mode";
  if ( ![-1, 0, 1].includes(command.mode) || (typeof command.explicit !== "boolean") ) return "mode";
  const { extras } = command;
  if ( !Array.isArray(extras) || (extras.length > 10) || !extras.every(isExtra) ) return "extras";
  if ( !Array.isArray(dice) || !dice.length || (dice.length > 11) || !dice.every(isRolled) ) return "dice";
  return null;
}

/**
 * Why a fetched end of an enchantment isn't one to make, if it isn't: it names the item and the
 * enchantment on it, and throws no dice. Only its player ends one from the app: it's no roll, and
 * would leave no mark of the Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
function checkEnchantCommand(command) {
  if ( command.by === "gm" ) return "by";
  const { enchantment } = command;
  if ( !isId(enchantment?.item) || !isId(enchantment?.effect) ) return "enchantment";
  if ( (command.mode !== 0) || (command.explicit !== false) ) return "dice";
  const none = list => (list === undefined) || (list === null) || (Array.isArray(list) && !list.length);
  if ( !none(command.extras) || !none(command.dice) ) return "dice";
  return null;
}

/**
 * The fields a command names its item, activity, targets, prompt or link by, none of which ending
 * a concentration, spending charges or Heroic Inspiration names, nor a move of items and coins.
 * @type {string[]}
 */
const ROLL_FIELDS = [
  "enchant", "item", "activity", "target", "targets", "self", "slot", "prompt", "text", "link", "key"
];

/**
 * Does a command name anything it's no roll at, as ROLL_FIELDS has them?
 * @param {object} command
 * @returns {boolean}
 */
export function namesRollFields(command) {
  return ROLL_FIELDS.some(field => (command[field] !== undefined) && (command[field] !== null));
}

/**
 * Is a command one that throws no dice: with no advantage, nothing added and no dice?
 * @param {object} command
 * @returns {boolean}
 */
export function throwsNoDice(command) {
  if ( (command.mode !== 0) || (command.explicit !== false) ) return false;
  const none = list => (list === undefined) || (list === null) || (Array.isArray(list) && !list.length);
  return none(command.extras) && none(command.dice);
}

/**
 * Why a fetched end of a concentration isn't one to make, if it isn't: it names the concentration's
 * effect, and nothing a roll names, and throws no dice. Only its player ends one from the app: it
 * posts nothing, so would leave no mark of the Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
function checkConcentrationCommand(command) {
  if ( command.by === "gm" ) return "by";
  if ( namesRollFields(command) || !isObject(command.concentration) || !isId(command.concentration.effect) ) {
    return "concentration";
  }
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Why a fetched spend of charges isn't one to make, if it isn't: it names the counter, as the sheet
 * names it, an item's uses, one of its activities' or a resource, and how many, from 1 to
 * MOST_SPENT, and nothing a roll names, and throws no dice.
 * @param {object} command
 * @returns {string|null}
 */
function checkSpendCommand(command) {
  if ( namesRollFields(command) || !isCounter(command.counter) ) return "counter";
  const { count } = command;
  if ( !Number.isInteger(count) || (count < 1) || (count > MOST_SPENT) ) return "count";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Why a fetched use or gain of Heroic Inspiration isn't one to make, if it isn't: it says which,
 * and names nothing a roll names, and throws no dice.
 * @param {object} command
 * @returns {string|null}
 */
function checkInspirationCommand(command) {
  if ( namesRollFields(command) || !["use", "gain"].includes(command.inspiration) ) return "inspiration";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Is this a counter as the sheet names one: an item's uses, `{item}`, one of its activities',
 * `{item, activity}`, or an old-style resource, `{resource}`, and nothing else?
 * @param {unknown} counter
 * @returns {boolean}
 */
function isCounter(counter) {
  if ( !isObject(counter) ) return false;
  const keys = Object.keys(counter);
  if ( Object.hasOwn(counter, "resource") ) {
    return (keys.length === 1) && ["primary", "secondary", "tertiary"].includes(counter.resource);
  }
  if ( !isId(counter.item) ) return false;
  if ( keys.length === 1 ) return true;
  return (keys.length === 2) && isId(counter.activity);
}

/**
 * Is this a plain object, rather than null or an array?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isObject(value) {
  return Boolean(value) && (typeof value === "object") && !Array.isArray(value);
}

/**
 * Is this the enchantment a use applies, as the player chose it: its profile, and the item they
 * chose, if any?
 * @param {unknown} value
 * @returns {boolean}
 */
function isEnchant(value) {
  if ( !value || (typeof value !== "object") || Array.isArray(value) ) return false;
  return isId(value.profile) && isOptional(value.item, isId);
}

/**
 * Is this the id of a document, as the app sends it?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isId(value) {
  return (typeof value === "string") && (value.length > 0) && (value.length <= 64);
}

/**
 * Is this a key dnd5e names something by, such as a spell slot's or a damage type's?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isKey(value) {
  return (typeof value === "string") && /^[A-Za-z][\w-]{0,31}$/.test(value);
}

/**
 * Is this left out, or else valid?
 * @param {unknown} value
 * @param {(value: unknown) => boolean} valid
 * @returns {boolean}
 */
export function isOptional(value, valid) {
  return (value === undefined) || (value === null) || valid(value);
}

/**
 * Is this a combatant a player picked, in a combat?
 * @param {unknown} target
 * @returns {boolean}
 */
function isTarget(target) {
  return isId(target?.combatId) && isId(target?.combatantId);
}

/**
 * Is this a term a player may add: some dice, or a number?
 * @param {object} term
 * @returns {boolean}
 */
function isExtra(term) {
  if ( ![1, -1].includes(term?.sign) ) return false;
  if ( "flat" in term ) return Number.isInteger(term.flat) && (term.flat >= 0) && (term.flat <= 100);
  return Number.isInteger(term.count) && (term.count >= 1) && (term.count <= 20) && DIE_FACES.has(term.sides);
}

/**
 * Is this a die a player rolled, with values it can show?
 * @param {object} rolled
 * @returns {boolean}
 */
export function isRolled(rolled) {
  const { faces, results } = rolled ?? {};
  return DIE_FACES.has(faces) && Array.isArray(results) && (results.length >= 1) && (results.length <= 40)
    && results.every(value => Number.isInteger(value) && (value >= 1) && (value <= faces));
}

/**
 * Why the character can't make this roll now, if it can't. A tool check needs no proficiency, as in
 * dnd5e; and one a description calls for may be with a kind of vehicle, as dnd5e's link may be.
 * @param {object} command
 * @param {Actor} actor
 * @returns {string|null}
 */
function checkRoll(command, actor) {
  const { key } = command;
  switch ( command.kind ) {
    case "skill": return (CONFIG.DND5E.skills?.[key] && actor.system.skills?.[key]) ? null : "unknown";
    case "tool": {
      const vehicle = isTextHash(command.text) && Object.hasOwn(CONFIG.DND5E.vehicleTypes ?? {}, key);
      return (CONFIG.DND5E.tools?.[key] || vehicle) ? null : "unknown";
    }
    case "ability":
    case "save": return (CONFIG.DND5E.abilities?.[key] && actor.system.abilities?.[key]) ? null : "unknown";
    case "death": {
      // dnd5e would warn the Gamemaster of a death saving throw that isn't needed.
      const { hp, death } = actor.system.attributes ?? {};
      const dying = death && (hp?.value <= 0) && (death.success < 3) && (death.failure < 3);
      return dying ? null : "not-dying";
    }
    case "initiative": return initiativeTurn(command, actor).refusal ?? null;
    case "hitDie": return hitDieLeft(command, actor) ? null : "no-hit-dice";
    case "hitDice": {
      if ( !hitDiceLeft(command, actor) ) return "no-hit-dice";
      return atFullHitPoints(actor) ? "full-hp" : null;
    }
    case "formula": return formulaActivity(command, actor).refusal ?? null;
    default: return "unknown";
  }
}

/**
 * Has the character a hit die of the size a player spends left, as dnd5e looks for one: an NPC
 * its own, a character a class's? dnd5e would otherwise tell the Gamemaster it hasn't.
 * @param {object} command
 * @param {Actor} actor
 * @returns {boolean}
 */
function hitDieLeft(command, actor) {
  const hd = actor.system.attributes?.hd;
  if ( actor.system.isNPC ) return (command.denomination === `d${hd?.denomination}`) && (hd?.value > 0);
  return Array.from(hd?.classes ?? []).some(cls => (cls.system?.hd?.denomination === command.denomination)
    && (cls.system.hd.value > 0));
}

/**
 * Has the character as many hit dice of each size left as a player spends at once? A character's
 * of a size are those of all their classes with it, which dnd5e spends from one after another; an
 * NPC's, its own one size. dnd5e would otherwise tell the Gamemaster it hasn't one, part way.
 * @param {object} command
 * @param {Actor} actor
 * @returns {boolean}
 */
function hitDiceLeft(command, actor) {
  const hd = actor.system.attributes?.hd;
  if ( actor.system.isNPC ) {
    const [only] = command.hitDice;
    return (command.hitDice.length === 1) && (only.denomination === `d${hd?.denomination}`)
      && (hd?.value >= only.count);
  }
  const classes = Array.from(hd?.classes ?? []);
  return command.hitDice.every(({ denomination, count }) => classes
    .filter(cls => cls.system?.hd?.denomination === denomination)
    .reduce((left, cls) => left + (cls.system.hd.value ?? 0), 0) >= count);
}

/**
 * Is the character at full hit points, as far as a hit die can heal them? dnd5e still spends one
 * then, healing nothing, as its rest dialog lets a player; but stops spending them once there, as
 * when it spends them itself on a rest, and so do hit dice spent at once.
 * @param {Actor} actor
 * @returns {boolean}
 */
function atFullHitPoints(actor) {
  const { value, max, effectiveMax } = actor.system.attributes?.hp ?? {};
  return value >= Math.max(0, Number.isFinite(effectiveMax) ? effectiveMax : max);
}

/**
 * How many hit dice of a size the character has spent: of all their classes with it, or an NPC's
 * own.
 * @param {Actor} actor
 * @param {string} denomination
 * @returns {number}
 */
function spentOf(actor, denomination) {
  const hd = actor.system.attributes?.hd;
  if ( actor.system.isNPC ) return hd?.spent ?? 0;
  return Array.from(hd?.classes ?? [])
    .filter(cls => cls.system?.hd?.denomination === denomination)
    .reduce((spent, cls) => spent + (cls.system.hd.spent ?? 0), 0);
}

/**
 * The utility activity whose own roll a player rolls, as the sheet lists it: of an item that's
 * identified, and for a spell an item casts, one the item can cast now; or the activity of the
 * spell a Cast activity casts, by the Cast activity's id; or the one a forward is used through, by
 * the forward's id. Its formula's dice must be ones a player can roll, and the ones they rolled.
 * @param {object} command
 * @param {Actor} actor
 * @returns {{refusal?: string, activity?: Activity}}
 */
function formulaActivity(command, actor) {
  const item = actor.items?.get(command.item);
  // Nor of a spell an item casts while the item can't cast it, as a use of it is refused.
  if ( !item || (item.system?.identified === false) || (castFrom(item)?.usable === false) ) return { refusal: "item" };
  const activity = activityNamed(command, item);
  const roll = formulaRoll(activity);
  const planned = roll ? plannedDice(roll) : null;
  if ( !planned?.plannable ) return { refusal: "activity" };
  if ( !matchesDice(command.dice, planned.dice) ) return { refusal: "dice" };
  return { activity };
}

/**
 * The activity a roll is made for, by the id the sheet lists it by: one of the item's its player can
 * see, as `shownActivity` has it, a forward the sheet leaves out as a repeat of another included;
 * for a Cast activity, its spell's, as it casts it; for a forward, the one it's used through.
 * @param {object} command
 * @param {Item} item
 * @returns {Activity|null}
 */
function activityNamed(command, item) {
  const found = item.system?.activities?.get?.(command.activity);
  const named = shownActivity(found) ? found : null;
  if ( named?.type === "cast" ) return castSpellOf(named)?.lead ?? null;
  return ((named?.type === "forward") ? forwardTarget(named) : named) ?? null;
}

/**
 * The check a check activity on the character's sheet calls for, which a player rolls their own, as
 * the button on the activity's card rolls it, using nothing and spending nothing: one of the checks
 * it offers, as the sheet lists them, of the kind and with the skill, tool or ability the player
 * names, against its DC as the sheet has it, none where that's none; for a tool item's check of its
 * own tool, with the item's bonus, as the button adds it. Or why not: the item isn't the
 * character's, isn't identified yet, or is a spell its item can't cast now (`item`); or the
 * activity, or the one a forward is used through, isn't one they can see, isn't a check made here,
 * is one another creature makes, as a spell's is, or doesn't offer that check (`activity`).
 * @param {object} command
 * @param {Actor} actor
 * @returns {{refusal?: string, check?: {type: string, ability: string, key?: string}, dc?: number|null,
 *   tool?: {bonus: string, prof: object, item: Item}|null}}
 */
function activityCheck(command, actor) {
  const item = actor.items?.get(command.item);
  if ( !item || (item.system?.identified === false) || (castFrom(item)?.usable === false) ) return { refusal: "item" };
  const activity = activityNamed(command, item);
  const owner = activity?.item ?? item;
  const offered = (activity?.type === "check") ? checkOf(owner, activity) : null;
  if ( !offered?.own ) return { refusal: "activity" };
  const type = CHECK_TYPES[command.kind];
  const check = offered.checks.find(each => (each.type === type) && ((each.key ?? each.ability) === command.key));
  if ( !check ) return { refusal: "activity" };
  const base = owner.system?.type?.baseItem;
  const own = (check.type === "tool") && (owner.type === "tool") && (!base || (check.key === base));
  return {
    check,
    // The DC the sheet sends, so that its outcome is the one the app shows: none for one it can't show.
    dc: offered.dc,
    tool: own ? { bonus: owner.system.bonus, prof: owner.system.prof, item: owner } : null
  };
}

/**
 * The saving throw a description on the character's sheet calls for, which a player rolls their
 * own, by its link: a save, rolled with one of the abilities it names, or a concentration check,
 * rolled with the one it names; or one that names none, which the player may name as Constitution
 * or the character's own concentration ability, and which is rolled with the character's own, as
 * dnd5e rolls it from the link. It's read from the description as it was sent, so its DC is the
 * description's, not the player's. Or why not: the description isn't on the sheet now (`gone`), or
 * the link isn't such a save, or not with that ability (`link`).
 * @param {object} command
 * @param {Actor} actor
 * @param {boolean} [secrets]   Were its descriptions sent with their secrets, as since 0.36.0 a
 *                              companion's none of whose players own it weren't?
 * @returns {Promise<{link?: object, refusal?: string}>}
 */
async function linkedSave(command, actor, secrets=true) {
  const found = await findLink(actor, command.text, command.link, { secrets });
  if ( found.refusal ) return { refusal: found.refusal };
  const { link } = found;
  if ( !["save", "concentration"].includes(link?.kind) ) return { refusal: "link" };
  const named = Array.isArray(link.abilities) ? link.abilities : [];
  const own = actor.system.attributes?.concentration?.ability;
  const abilities = (named.length || (link.kind === "save")) ? named : ["con", own];
  return abilities.includes(command.key) ? { link } : { refusal: "link" };
}

/**
 * The check a description on the character's sheet calls for, which a player rolls their own, by
 * its link: one of the checks it offers, of the kind and with the skill, tool or ability the
 * player names, made with the ability the link names for it. It's read from the description as it
 * was sent, so its DC is the description's, not the player's. Or why not: the description isn't on
 * the sheet now (`gone`), or the link isn't a check, or doesn't offer that one (`link`).
 * @param {object} command
 * @param {Actor} actor
 * @param {boolean} [secrets]   Were its descriptions sent with their secrets?
 * @returns {Promise<{link?: object, check?: {type: string, ability: string, key?: string},
 *   refusal?: string}>}
 */
async function linkedCheck(command, actor, secrets=true) {
  const found = await findLink(actor, command.text, command.link, { secrets });
  if ( found.refusal ) return { refusal: found.refusal };
  const { link } = found;
  if ( link?.kind !== "check" ) return { refusal: "link" };
  const type = CHECK_TYPES[command.kind];
  const check = (link.checks ?? []).find(each => (each.type === type) && ((each.key ?? each.ability) === command.key));
  return check ? { link, check } : { refusal: "link" };
}

/**
 * The character's place in the combat a roll of initiative is for: one without initiative yet, in
 * the combat the Gamemaster has up, which is the one dnd5e rolls initiative in. Since 0.36.0 a
 * token's creature, as a companion summoned with an unlinked actor, is that token's combatant, by
 * its token and scene, never the first of its base actor's, as two wolves of one Wolf share an id.
 * @param {object} command
 * @param {Actor} actor
 * @returns {{refusal?: string, roller?: Actor, waiting?: Combatant, combat?: Combat}}
 */
function initiativeTurn(command, actor) {
  const combat = game.combats?.get(command.combatId);
  if ( !combat || (game.combat?.id !== combat.id) ) return { refusal: "not-in-combat" };
  const token = actor.isToken ? actor.token : null;
  const own = token
    ? combat.combatants.filter(combatant => (combatant.tokenId === token.id) && (combatant.sceneId === token.parent?.id))
    : combat.combatants.filter(combatant => (combatant.actor?.id ?? combatant.actorId) === actor.id);
  if ( !own.length ) return { refusal: "not-in-combat" };
  const waiting = own.find(combatant => combatant.initiative === null);
  if ( !waiting ) return { refusal: "already-rolled" };
  // An unlinked token rolls as its own actor.
  const roller = token ? actor : (waiting.actor ?? actor);
  if ( roller._cachedInitiativeRoll ) return { refusal: "busy" };
  return { roller, waiting, combat };
}

/**
 * Is a companion's own initiative its campaign takes from its character's, since 0.36.0: under
 * "Right after its character", while one of its characters is a combatant of the combat it's for
 * (creature-initiative.mjs)? With none of them in it, it rolls its own.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {CompanionEntry|null} companion
 * @returns {boolean}
 */
function followsCharacter(command, campaign, companion) {
  if ( !companion || (campaign.companionInitiative !== COMPANION_INITIATIVE.AFTER) ) return false;
  const combat = game.combats?.get(command.combatId);
  return Boolean(combat?.combatants?.some?.(combatant => companion.of.includes(combatant.actorId)));
}

/* -------------------------------------------- */

/**
 * Make the roll through dnd5e, without its dialog, as the player's own: since 0.36.0 a companion's
 * as its character's player's.
 * @param {object} command
 * @param {Actor} actor
 * @param {Actor} [character]   Whose player makes it.
 * @returns {Promise<ChatMessage|null>}   The roll's message.
 */
async function makeRoll(command, actor, character=actor) {
  const author = authorFor(actor, character);
  const flags = { [MODULE_ID]: appFlags(command) };
  // dnd5e takes the first of these as the roll's own configuration, so each call has its own.
  const config = fields => ({ ...fields, rolls: [{ options: { [ROLL_TAG]: command.id } }] });
  const dialog = { configure: false };
  const message = { rollMode: PUBLIC, data: { author: author.id, flags } };
  const { key } = command;
  switch ( command.kind ) {
    case "skill": return messageOf(await actor.rollSkill(config({ skill: key }), dialog, message));
    case "tool": return messageOf(await actor.rollToolCheck(config({ tool: key }), dialog, message));
    case "ability": return messageOf(await actor.rollAbilityCheck(config({ ability: key }), dialog, message));
    case "save": return messageOf(await actor.rollSavingThrow(config({ ability: key }), dialog, message));
    case "death": return rollDeathSave(command, actor, config({}), message);
    case "initiative": return rollInitiative(command, actor, { author, flags });
    case "hitDie": return rollHitDie(command, actor, message);
    case "formula": return rollFormula(command, actor, message);
    default: return null;
  }
}

/**
 * Roll a death saving throw through dnd5e, without its dialog, as the player's own. Under dnd5e
 * 5.3, a save that revives, steadies or kills the character posts what came of it as a message of
 * its own, without the roll's flags: one the Gamemaster made in the app has that message marked as
 * theirs too, before the app is told, under `outcome` rather than `request`, so that the roll is
 * still the message the command made; and since 0.32.0 so has one whose die the player typed in,
 * marked `typed`. dnd5e 6 writes what came of it on the roll's own card.
 * @param {object} command
 * @param {Actor} actor
 * @param {object} config    The roll's configuration, as for any roll.
 * @param {object} message   The roll's message, as for any roll.
 * @returns {Promise<ChatMessage|null>}   The roll's message.
 */
async function rollDeathSave(command, actor, config, message) {
  const dialog = { configure: false };
  if ( (command.by !== "gm") && (command.typed !== true) ) return messageOf(await actor.rollDeathSave(config, dialog, message));
  let marking = null;
  const mark = (rolls, { message: outcome, subject }={}) => {
    if ( (subject?.id !== actor.id) || (rolls?.[0]?.options?.[ROLL_TAG] !== command.id) ) return;
    if ( !outcome || outcome.flags?.[MODULE_ID] ) return;
    marking = outcome.update({ [`flags.${MODULE_ID}`]: appFlags(command, "outcome") }).catch(err => {
      // The roll was made all the same, and its own card is marked.
      console.error(`${MODULE_ID} | Could not mark ${actor.name}'s death save as the Gamemaster's`, err);
    });
  };
  Hooks.on("dnd5e.postRollDeathSave", mark);
  try {
    const rolls = await actor.rollDeathSave(config, dialog, message);
    await marking;
    return messageOf(rolls);
  } finally {
    Hooks.off("dnd5e.postRollDeathSave", mark);
  }
}

/**
 * Spend a hit die as dnd5e does, without its dialog, healing the character. dnd5e adds its own
 * roll to those it's given, so it's tagged on the process; and names the roll's kind in a way the
 * message's own flags would replace, so they name it.
 * @param {object} command
 * @param {Actor} actor
 * @param {object} message   The roll's message, as for any roll.
 * @returns {Promise<ChatMessage|null>}
 */
async function rollHitDie(command, actor, message) {
  const flags = { ...message.data.flags, dnd5e: { roll: { type: "hitDie" } } };
  return messageOf(await actor.rollHitDie(
    { denomination: command.denomination, [ROLL_TAG]: command.id },
    { configure: false },
    { ...message, data: { ...message.data, flags } }
  ));
}

/**
 * Spend hit dice of one size or more at once, as dnd5e spends them on a short rest: one die at a
 * time, a roll and a card each, each die with the one the player rolled for it, in the order they
 * rolled them. Each die has its plan of its own, so a die a module adds to one, of its size or
 * another, is Foundry's, never the player's next. They stop before the next die once the app has
 * been told they took too long, once the character is at full hit points, as dnd5e stops spending
 * them on a rest, or has none of that size left; and once a die is called off, as a module may, or
 * as one the player's die can't reach, or a module kept dnd5e from spending one, which would
 * otherwise post a card for each die left and spend none. Those spent before they stopped are told
 * of all the same, as `spent`, with what they healed.
 * @param {object} command
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @param {AbortSignal} [signal]   Aborted once the app has been told they took too long.
 * @param {Actor} [character]      Whose player spends them.
 * @returns {Promise<CommandResult>}
 */
async function spendHitDice(command, actor, campaign, signal, character=actor) {
  const author = authorFor(actor, character);
  const message = { rollMode: PUBLIC, data: { author: author.id, flags: { [MODULE_ID]: appFlags(command) } } };
  const { hitDice, ...rest } = command;
  const dice = hitDice.flatMap(({ denomination }, index) => {
    const { faces, results } = command.dice[index];
    return results.map(value => ({ denomination, faces, value }));
  });
  const hp = actor.system.attributes?.hp?.value ?? 0;
  const cards = [];
  let reason = null;
  let error = null;
  for ( const [index, { denomination, faces, value }] of dice.entries() ) {
    if ( index > 0 ) {
      if ( signal?.aborted ) reason = "timeout";
      else if ( atFullHitPoints(actor) ) reason = "full-hp";
      else if ( !hitDieLeft({ denomination }, actor) ) reason = "no-hit-dice";
      if ( reason ) break;
    }
    const die = {
      ...rest, id: `${command.id}-${index}`, kind: "hitDie", denomination, dice: [{ faces, results: [value] }]
    };
    const before = spentOf(actor, denomination);
    let plan;
    let card;
    try {
      card = await withPlan(die, planned => {
        plan = planned;
        return rollHitDie(die, actor, message);
      });
    } catch (err) {
      console.error(`${MODULE_ID} | Could not spend ${actor.name}'s hit dice from Sending Stone`, err);
      reason = "error";
      error = err instanceof Error ? err.message : String(err);
      break;
    }
    // A die a module called off, as dnd5e's hooks allow, made nothing; so did one called off here.
    if ( !card ) {
      reason = plan?.refusal ?? "cancelled";
      break;
    }
    cards.push(card);
    if ( (cards.length < dice.length) && (spentOf(actor, denomination) <= before) ) {
      reason = "cancelled";
      break;
    }
  }

  const spent = { count: dice.length, made: cards.length };
  if ( !cards.length ) return { ...failedResult(command, reason, error), spent };
  const visible = cards.every(card => visibleTo(card, character, campaign));
  return {
    id: command.id,
    status: reason ? "failed" : "done",
    reason,
    error,
    messageId: cards.at(-1).id,
    visible,
    rolls: visible ? cards.flatMap(card => card.rolls.map(summarizeRoll)) : [],
    // The hit points dnd5e gave the character for them all: none where a module kept it from it.
    healed: Math.max((actor.system.attributes?.hp?.value ?? hp) - hp, 0),
    spent
  };
}

/**
 * Roll a utility activity's own formula, as its card's button does, without its dialog. dnd5e
 * adds its own roll to those it's given, so it's tagged on the process; and would name the
 * Gamemaster's own targets on its card, so it names none.
 * @param {object} command
 * @param {Actor} actor
 * @param {object} message   The roll's message, as for any roll.
 * @returns {Promise<ChatMessage|null>}
 */
async function rollFormula(command, actor, message) {
  const { activity } = formulaActivity(command, actor);
  if ( !activity ) return null;
  const flags = { ...message.data.flags, dnd5e: { targets: [] } };
  return messageOf(await activity.rollFormula(
    { [ROLL_TAG]: command.id },
    { configure: false },
    { ...message, data: { ...message.data, flags } }
  ));
}

/**
 * Answer a saving throw the game asked a character for, through dnd5e, without its dialog, as the
 * player's own: on the card that asked, as if they had clicked it there, against its DC. A
 * concentration check is rolled as one; failed, it ends the character's concentration, all of it,
 * as the player would on dnd5e's card, unless Midi-QOL is there to, as it does after a failed check
 * when its Gamemaster has it remove concentration. Since 0.29.0 a player may end one concentration
 * of several from the app themselves, as command-concentration.mjs does.
 * @param {object} command
 * @param {Actor} actor
 * @param {RollPrompt} prompt
 * @param {Actor} [character]   Whose player answers it.
 * @returns {Promise<{message: ChatMessage|null, outcome: string|null}>}
 */
async function answerPrompt(command, actor, prompt, character=actor) {
  const author = authorFor(actor, character);
  const flags = { [MODULE_ID]: appFlags(command), dnd5e: { originatingMessage: prompt.messageId } };
  const config = {
    ability: command.key,
    ...(Number.isFinite(prompt.dc) && { target: prompt.dc }),
    rolls: [{ options: { [ROLL_TAG]: command.id } }]
  };
  const dialog = { configure: false };
  const message = { rollMode: PUBLIC, data: { author: author.id, flags } };
  const concentration = prompt.type === "concentration";
  const rolls = concentration
    ? await actor.rollConcentration(config, dialog, message)
    : await actor.rollSavingThrow(config, dialog, message);
  const made = Array.isArray(rolls) ? rolls : [rolls].filter(Boolean);
  const failed = made[0]?.isFailure === true;
  if ( concentration && failed && (game.modules.get("midi-qol")?.active !== true) ) await actor.endConcentration();
  return { message: messageOf(made), outcome: outcomeOf(prompt, made) };
}

/**
 * Answer a save, check or skill check Midi-QOL asked a character for, with the player's dice: taken
 * at once, so nothing else answers it meanwhile; rolled as Midi would roll it, its rolls then
 * Midi's; and told of once Midi has decided whether it saved, or ten seconds on. Made where Midi
 * would make a roll message, so may have none, as when the Gamemaster's client rolls it while
 * Midi doesn't show saves: done all the same, its dice being the player's own. One that fails, or
 * that a module calls off, leaves the save to Midi.
 * @param {object} command
 * @param {object} entry     The Midi prompt it answers.
 * @returns {Promise<CommandResult>}
 */
async function answerMidiPrompt(command, entry) {
  const claim = claimMidiPrompt(entry);
  if ( claim.refusal ) return failedResult(command, "prompt", claim.refusal);
  let plan;
  let rolls;
  try {
    rolls = await withPlan(command, planned => {
      plan = planned;
      return rollMidiAnswer(command, entry);
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not make ${entry.actor.name}'s save for Midi-QOL from Sending Stone`, err);
    midiAnswerFailed(entry, claim);
    return failedResult(command, "error", err instanceof Error ? err.message : String(err));
  }
  const made = (Array.isArray(rolls) ? rolls : [rolls]).filter(Boolean);
  if ( !made.length ) {
    midiAnswerFailed(entry, claim);
    return failedResult(command, plan?.refusal ?? "cancelled");
  }
  midiPromptAnswered(entry, made, command.key);
  const outcome = await midiOutcome(entry, made);
  return {
    id: command.id,
    status: "done",
    reason: null,
    error: null,
    messageId: messageOf(made)?.id ?? null,
    // The dice are the player's own, whatever the message's mode.
    visible: true,
    rolls: made.map(summarizeRoll),
    outcome
  };
}

/**
 * Roll the answer to a Midi prompt on the character asked, as the token Midi asks has it: a save,
 * which Midi makes a concentration check where it asks for one, an ability check or a skill
 * check, with Midi's options, its message as Midi's own roll for the target would have it; or for
 * Midi's concentration card, the check Midi would roll on the Gamemaster's client, against the
 * card's DC, its message whispered to the Gamemaster, as Midi's is. Midi's hook for a
 * concentration check then ends the concentration of one failed, as Midi has it.
 * @param {object} command
 * @param {object} entry
 * @returns {Promise<Roll[]|null>}
 */
function rollMidiAnswer(command, entry) {
  const { actor } = entry;
  // Where Midi has the player's roll dialog open in Foundry too, the message is theirs, as Midi's
  // own roll would be, and says which save it answers, for their client to close the dialog.
  const data = {
    author: (midiAnswerAuthor(entry) ?? authorFor(actor)).id,
    flags: { [MODULE_ID]: { ...appFlags(command), ...midiAnswerFlags(entry) } }
  };
  const rolls = [{ options: { [ROLL_TAG]: command.id } }];
  const dialog = { configure: false };
  if ( entry.card ) {
    return actor.rollConcentration({ legacy: false, target: entry.rollTarget, rolls }, dialog, {
      create: true, rollMode: "gm", data
    });
  }
  const config = { ...midiAnswerConfig(entry, command.key), rolls };
  const message = { create: entry.create, rollMode: entry.rollMode, data };
  switch ( entry.rollType ) {
    case "skill": return actor.rollSkill(config, dialog, message);
    case "check": return actor.rollAbilityCheck(config, dialog, message);
    default: return actor.rollSavingThrow(config, dialog, message);
  }
}

/**
 * Roll a saving throw a description calls for, through dnd5e, without its dialog, as the player's
 * own: against its DC, if it names one, even one its author hid, as dnd5e rolls one clicked in the
 * description. A concentration check is rolled as one, with what adds to it, such as War Caster,
 * and with the ability the link names, or else the character's own, as dnd5e chooses it; against
 * dnd5e's DC of 10 where the link names none. Failed, it's left to the Gamemaster, or to Midi-QOL,
 * to end the concentration, as dnd5e leaves it.
 * @param {object} command
 * @param {Actor} actor
 * @param {{kind: string, abilities: string[], dc: number|null}} link
 * @param {Actor} [character]   Whose player rolls it.
 * @returns {Promise<{message: ChatMessage|null, outcome: string|null}>}   The roll's message, and
 *   whether it met its DC, where it was rolled against one, as the card shows its author.
 */
async function rollLinkedSave(command, actor, link, character=actor) {
  const author = authorFor(actor, character);
  const flags = { [MODULE_ID]: appFlags(command) };
  const target = Number.isInteger(link.dc) ? link.dc : null;
  // dnd5e rolls a concentration check that names no ability with the character's own.
  const ownAbility = (link.kind === "concentration") && !link.abilities?.length;
  const config = {
    ...(!ownAbility && { ability: command.key }),
    ...((target !== null) && { target }),
    rolls: [{ options: { [ROLL_TAG]: command.id } }]
  };
  const dialog = { configure: false };
  const message = { rollMode: PUBLIC, data: { author: author.id, flags } };
  const rolls = (link.kind === "concentration")
    ? await actor.rollConcentration(config, dialog, message)
    : await actor.rollSavingThrow(config, dialog, message);
  const made = Array.isArray(rolls) ? rolls : [rolls].filter(Boolean);
  return { message: messageOf(made), outcome: outcomeAgainstDC(made) };
}

/**
 * Roll a check a description calls for, through dnd5e, without its dialog, as the player's own, as
 * dnd5e rolls one clicked in the description, or on its request card: with the ability the link
 * names for it, which for a skill or tool may not be the character's own; a skill checked using a
 * tool with it, for dnd5e to add the higher of their proficiencies, and give advantage where the
 * character is proficient in both; and against
 * the link's DC, if it names one, even one its author hid. A check a check activity calls for is
 * rolled the same, as its card's button rolls it: a tool item's check of its own tool with the
 * item's bonus, proficiency and the item, as the button gives them.
 * @param {object} command
 * @param {Actor} actor
 * @param {{dc: number|null, usingTool?: string|null, tool?: {bonus: string, prof: object, item: Item}|null}} link
 * @param {{type: string, ability: string, key?: string}} check   The one of its checks rolled.
 * @param {Actor} [character]   Whose player rolls it.
 * @returns {Promise<{message: ChatMessage|null, outcome: string|null}>}   The roll's message, and
 *   whether it met its DC, where it was rolled against one, as the card shows its author.
 */
async function rollLinkedCheck(command, actor, link, check, character=actor) {
  const author = authorFor(actor, character);
  const flags = { [MODULE_ID]: appFlags(command) };
  const target = Number.isInteger(link.dc) ? link.dc : null;
  const tool = link.tool ? { bonus: link.tool.bonus, prof: link.tool.prof, item: link.tool.item } : {};
  const config = {
    ability: check.ability,
    ...((check.type === "skill") && { skill: check.key, ...(link.usingTool && { tool: link.usingTool }) }),
    ...((check.type === "tool") && { tool: check.key, ...tool }),
    ...((target !== null) && { target }),
    rolls: [{ options: { [ROLL_TAG]: command.id } }]
  };
  const dialog = { configure: false };
  const message = { rollMode: PUBLIC, data: { author: author.id, flags } };
  let rolls;
  switch ( check.type ) {
    case "skill": rolls = await actor.rollSkill(config, dialog, message); break;
    case "tool": rolls = await actor.rollToolCheck(config, dialog, message); break;
    default: rolls = await actor.rollAbilityCheck(config, dialog, message);
  }
  const made = Array.isArray(rolls) ? rolls : [rolls].filter(Boolean);
  return { message: messageOf(made), outcome: outcomeAgainstDC(made) };
}

/**
 * Whether a saving throw or check met its DC, as dnd5e's card shows it, or as a module decided it:
 * the DC it was rolled against, which for a concentration check is dnd5e's 10 where none was given.
 * @param {Roll[]} rolls   Its rolls, as made.
 * @returns {"success"|"failure"|null}   Null for one against no DC.
 */
function outcomeAgainstDC(rolls) {
  const [roll] = rolls;
  if ( !roll || !Number.isNumeric(roll.options?.target) ) return null;
  return (roll.isSuccess || (roll.options.success === true)) ? "success" : "failure";
}

/**
 * Roll initiative as dnd5e's initiative dialog does, without it: build the roll, then have the
 * actor roll initiative with it in the combat. Since 0.36.0 a token's creature's is rolled by the
 * combat itself, for its own combatant, as dnd5e's actor finds a token's combatants only on the
 * Gamemaster's canvas: with the roll cached on its actor, which the combatant's roll takes, between
 * dnd5e's two hooks, as its actor would fire them.
 * @param {object} command
 * @param {Actor} actor
 * @param {{author: User, flags: object}} message
 * @returns {Promise<ChatMessage|null>}
 */
async function rollInitiative(command, actor, { author, flags }) {
  const { roller, waiting, combat, refusal } = initiativeTurn(command, actor);
  if ( refusal ) return null;
  const rollConfig = roller.getInitiativeRollConfig();
  if ( !rollConfig ) return null;
  rollConfig.options = { ...rollConfig.options, [ROLL_TAG]: command.id };

  if ( rollConfig.options.fixed === undefined ) {
    const process = {
      evaluate: false,
      hookNames: ["initiativeDialog", "abilityCheck", "d20Test"],
      rolls: [rollConfig],
      subject: roller
    };
    const rolls = await CONFIG.Dice.D20Roll.build(process, { configure: false }, { rollMode: PUBLIC });
    if ( !rolls?.length ) return null;
    roller._cachedInitiativeRoll = rolls[0];
  } else {
    // A fixed initiative score, as the world may set, rolls no dice.
    const { data, options } = rollConfig;
    roller._cachedInitiativeRoll = new CONFIG.Dice.BasicRoll(String(options.fixed), data, options);
  }

  const initiativeOptions = {
    messageMode: PUBLIC,
    messageOptions: { rollMode: PUBLIC, author: author.id, flags }
  };
  try {
    if ( roller.isToken ) {
      if ( Hooks.call("dnd5e.preRollInitiative", roller, roller._cachedInitiativeRoll) === false ) return null;
      await combat.rollInitiative([waiting.id], initiativeOptions);
      Hooks.callAll("dnd5e.rollInitiative", roller, [waiting]);
    }
    else await roller.rollInitiative({ createCombatants: false, initiativeOptions });
  } finally {
    // Left by a roll that failed part way, it would be the Gamemaster's next roll.
    if ( roller._cachedInitiativeRoll?.options?.[ROLL_TAG] === command.id ) delete roller._cachedInitiativeRoll;
  }
  return findMessage(command.id);
}

/**
 * The user a player's roll is made as: the one whose character it is, or else its only player,
 * or else the Gamemaster making it. Since 0.36.0 a companion's is made as its character's, the
 * seat's player's, whoever owns the companion in Foundry: so that one two players own, or none, as
 * a familiar the Gamemaster summoned, still rolls as its player, its cards not trimmed as a
 * Gamemaster's.
 * @param {Actor} actor
 * @param {Actor} [character]   The campaign character whose player makes it: the actor's own.
 * @returns {User}
 */
export function authorFor(actor, character=actor) {
  const assigned = game.users.find(user => !user.isGM && (user.character?.id === character.id));
  if ( assigned ) return assigned;
  const owners = playerOwners(character);
  return (owners.length === 1) ? owners[0] : game.user;
}

/**
 * The message a roll made, from the rolls dnd5e returns.
 * @param {Roll[]|Roll|null} rolls
 * @returns {ChatMessage|null}
 */
function messageOf(rolls) {
  const [roll] = Array.isArray(rolls) ? rolls : [rolls];
  return roll?.parent ?? null;
}

/**
 * The latest message made for a player's roll.
 * @param {string} commandId
 * @returns {ChatMessage|null}
 */
export function findMessage(commandId) {
  return game.messages.contents.findLast(message => message.flags?.[MODULE_ID]?.request === commandId) ?? null;
}

/**
 * May a character's player see a message? Since 0.36.0 a companion's roll is its character's
 * player's to see, so it's given the character.
 * @param {ChatMessage} message
 * @param {Actor} actor   The campaign character whose player is told.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function visibleTo(message, actor, campaign) {
  const audience = chatAudience(message, campaign);
  return audience.public || audience.characters.includes(actor.id);
}

/**
 * What became of the roll, as the app is told: the roll, if its player may see its message.
 * @param {object} command
 * @param {ChatMessage} message
 * @param {Actor} actor   The campaign character whose player is told: a companion's character.
 * @param {Campaign} campaign
 * @param {object} [options]
 * @param {Roll[]} [options.rolls]   The rolls made, when they aren't the message's own, as
 *                                   Midi-QOL's card is written after its rolls.
 * @param {object} [options.extra]   What else the app is told, as of an attack.
 * @returns {CommandResult}
 */
export function describeResult(command, message, actor, campaign, { rolls=message.rolls, extra={} }={}) {
  const visible = visibleTo(message, actor, campaign);
  return {
    id: command.id,
    status: "done",
    reason: null,
    error: null,
    messageId: message.id,
    visible,
    rolls: visible ? rolls.map(summarizeRoll) : [],
    ...extra
  };
}

/* -------------------------------------------- */

/**
 * Mark a roll made from the app on its chat card, for everyone to see; one the Gamemaster made
 * there as the character, "GM"; and since 0.32.0 one whose dice the player typed in from their own,
 * with a keyboard, "Entered by hand".
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function markAppRoll(message, html) {
  const flags = message.flags?.[MODULE_ID];
  const gm = flags?.by === "gm";
  const typed = !gm && (flags?.typed === true);
  if ( !(flags?.request || flags?.use || gm) || !(html instanceof HTMLElement) ) return;
  const header = html.querySelector(".message-header .message-metadata") ?? html.querySelector(".message-header");
  if ( !header || header.querySelector(".sending-stone-badge") ) return;
  const badge = document.createElement("span");
  badge.className = gm ? "sending-stone-badge sending-stone-gm" : (typed ? "sending-stone-badge sending-stone-typed" : "sending-stone-badge");
  const label = game.i18n.localize(gm ? "SENDINGSTONE.Roll.BadgeGM" : (typed ? "SENDINGSTONE.Roll.BadgeTyped" : "SENDINGSTONE.Roll.Badge"));
  badge.dataset.tooltip = label;
  badge.setAttribute("aria-label", label);
  badge.innerHTML = typed ? '<i class="fa-solid fa-keyboard" inert></i>' : '<i class="fa-solid fa-mobile-screen-button" inert></i>';
  // The author is the player's, so the badge is what says the Gamemaster rolled it.
  if ( gm ) {
    const who = document.createElement("span");
    who.textContent = game.i18n.localize("SENDINGSTONE.Roll.GM");
    badge.append(who);
  }
  header.prepend(badge);
}
