import { ATTACK_KINDS, DIE_FACES, MODULE_ID, ROLL_KINDS, ROLL_TAG } from "./constants.mjs";
import { playerOwners } from "./characters.mjs";
import { chatAudience, summarizeRoll } from "./chat-data.mjs";
import { diceStatus, formulaRoll, matchesDice, plannedDice, readModifiers, withPlan } from "./dice-plan.mjs";
import { findPrompt, outcomeOf } from "./prompts.mjs";
import { findLink, MOST_LINKS } from "./sheet-links.mjs";
import { castSpellOf, visibleActivities } from "./sheet-rolls.mjs";
import { castFrom } from "./sheet-spells.mjs";

/**
 * Making a player's roll from the Sending Stone app: a check, saving throw, death saving throw or
 * initiative, a hit die spent, or a utility's own roll, such as a d4 of luck, through dnd5e, as if
 * the player had rolled it in Foundry, with the dice they rolled; a saving throw the game asked
 * them for, on the card that asked; and a saving throw or check a description of theirs calls for,
 * against its DC.
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
 * The kind of check each roll of a check is, as a description's check names its choices.
 * @type {Record<string, string>}
 */
const CHECK_TYPES = { ability: "check", skill: "skill", tool: "tool" };

/**
 * The rolls made as they are, with no advantage and nothing added: a hit die, and a utility's own
 * roll.
 * @type {Set<string>}
 */
const PLAIN = new Set(["hitDie", "formula"]);

/**
 * What became of a player's roll, as the app is told.
 * @typedef {object} CommandResult
 * @property {string} id
 * @property {"done"|"failed"} status
 * @property {string|null} reason       Why it wasn't made, such as "not-dying".
 * @property {string|null} error        What went wrong, for an error.
 * @property {string|null} messageId    The chat message the roll made.
 * @property {boolean} visible          May its player see the roll? Not one made blind.
 * @property {object[]} rolls           The roll as made, when its player may see it.
 * @property {number} [healed]          For a hit die: the hit points it gained.
 * @property {object|null} [attack]     For an attack: whether it was a critical hit or a fumble, and
 *                                      whether it hit its target, or each target of an area attack,
 *                                      when its player may know.
 * @property {object|null} [damage]     For an attack: the dice its damage will throw, for its player
 *                                      to roll; null when no damage follows.
 * @property {string|null} [outcome]    For a save the game asked for, or a save or check a description
 *                                      calls for against a DC: "success" or "failure", where its
 *                                      player may know.
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

/* -------------------------------------------- */

/**
 * Make a player's roll for their character, if the campaign takes their rolls and the character
 * can make it now.
 * @param {object} command      The player's roll, as fetched from the app.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export async function runRollCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  if ( (command.kind === "hitDie") && !diceStatus.hitDice ) return failed("self-test");
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failed("unknown");
  const refusal = checkRoll(command, actor);
  if ( refusal ) return failed(refusal);
  let link = null;
  let check = null;
  if ( isTextHash(command.text) ) {
    const found = (command.kind === "save") ? await linkedSave(command, actor) : await linkedCheck(command, actor);
    if ( found.refusal ) return failed(found.refusal);
    link = found.link;
    check = found.check ?? null;
  }
  let prompt = null;
  if ( command.prompt ) {
    const found = findPrompt(command.prompt, actor, campaign);
    if ( found.refusal ) return failed("prompt", found.refusal);
    if ( !found.prompt.abilities.includes(command.key) ) return failed("prompt", "ability");
    prompt = found.prompt;
  }

  const hp = actor.system.attributes?.hp?.value ?? 0;
  let made;
  let plan;
  try {
    made = await withPlan(command, planned => {
      plan = planned;
      if ( prompt ) return answerPrompt(command, actor, prompt);
      if ( check ) return rollLinkedCheck(command, actor, link, check);
      return link ? rollLinkedSave(command, actor, link) : makeRoll(command, actor);
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not make ${actor.name}'s roll from Sending Stone`, err);
    return failed("error", err instanceof Error ? err.message : String(err));
  }
  const message = (prompt || link) ? made?.message : made;
  // A roll a module called off, as dnd5e's hooks allow, made nothing; so did one called off here.
  if ( !message ) return failed(plan?.refusal ?? "cancelled");
  const result = describeResult(command, message, actor, campaign);
  if ( prompt || link ) result.outcome = result.visible ? made.outcome : null;
  // The hit points dnd5e gave the character for a hit die: none where a module kept it from it.
  if ( command.kind === "hitDie" ) result.healed = Math.max((actor.system.attributes?.hp?.value ?? hp) - hp, 0);
  return result;
}

/**
 * Why a fetched roll isn't one to make, if it isn't. The app checks the same, but what reaches the
 * game is checked again here: only dice a player can roll, and only values those dice show. A
 * check or saving throw may name the link in a description it's rolled for, but not while
 * answering a prompt.
 * @param {object} command
 * @returns {string|null}
 */
export function checkCommand(command) {
  if ( command.kind === "ask" ) return checkAskCommand(command);
  if ( ["textRoll", "textDamage"].includes(command.kind) ) return checkTextCommand(command);
  if ( ATTACK_KINDS.includes(command.kind) ) return checkAttackCommand(command);
  if ( !ROLL_KINDS.includes(command.kind) ) return "kind";
  if ( PLAIN.has(command.kind) ) return checkPlainCommand(command);
  if ( KEYED.has(command.kind) !== (typeof command.key === "string") ) return "key";
  if ( (command.kind === "initiative") !== (typeof command.combatId === "string") ) return "combat";
  if ( ![-1, 0, 1].includes(command.mode) || (typeof command.explicit !== "boolean") ) return "mode";
  if ( !isOptional(command.prompt, isPromptId) || (command.prompt && (command.kind !== "save")) ) return "prompt";
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
 * Why a fetched hit die or utility's roll isn't one to make, if it isn't. Neither is rolled with
 * advantage, has anything added, or answers a prompt. A hit die names its size, and has the one die
 * rolled of it; a utility's roll names the item and activity, and has the dice its formula throws,
 * if any, which are checked against them when it's made.
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
  if ( !isId(command.item) || !isId(command.activity) ) return "item";
  if ( !Array.isArray(dice) || (dice.length > 20) || !dice.every(isRolled) ) return "dice";
  return null;
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
 * slot, ammunition and attack mode it's made with. A use names the item and activity, the
 * combatants it's used at, and the spell slot, if any, and has no dice. Damage names the use it
 * follows and has the dice that use's damage throws, if any, which are checked against them when
 * it's made, and the kind of damage chosen for each of its rolls.
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
    return null;
  }
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
 * Is this the id of a document, as the app sends it?
 * @param {unknown} value
 * @returns {boolean}
 */
function isId(value) {
  return (typeof value === "string") && (value.length > 0) && (value.length <= 64);
}

/**
 * Is this a key dnd5e names something by, such as a spell slot's or a damage type's?
 * @param {unknown} value
 * @returns {boolean}
 */
function isKey(value) {
  return (typeof value === "string") && /^[A-Za-z][\w-]{0,31}$/.test(value);
}

/**
 * Is this left out, or else valid?
 * @param {unknown} value
 * @param {(value: unknown) => boolean} valid
 * @returns {boolean}
 */
function isOptional(value, valid) {
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
 * The utility activity whose own roll a player rolls, as the sheet lists it: of an item that's
 * identified, and for a spell an item casts, one the item can cast now; or the activity of the
 * spell a Cast activity casts, by the Cast activity's id. Its
 * formula's dice must be ones a player can roll, and the ones they rolled.
 * @param {object} command
 * @param {Actor} actor
 * @returns {{refusal?: string, activity?: Activity}}
 */
function formulaActivity(command, actor) {
  const item = actor.items?.get(command.item);
  // Nor of a spell an item casts while the item can't cast it, as a use of it is refused.
  if ( !item || (item.system?.identified === false) || (castFrom(item)?.usable === false) ) return { refusal: "item" };
  const named = visibleActivities(item).find(activity => activity.id === command.activity);
  const activity = (named?.type === "cast") ? castSpellOf(named)?.lead : named;
  const roll = formulaRoll(activity);
  const planned = roll ? plannedDice(roll) : null;
  if ( !planned?.plannable ) return { refusal: "activity" };
  if ( !matchesDice(command.dice, planned.dice) ) return { refusal: "dice" };
  return { activity };
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
 * @returns {Promise<{link?: object, refusal?: string}>}
 */
async function linkedSave(command, actor) {
  const found = await findLink(actor, command.text, command.link);
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
 * @returns {Promise<{link?: object, check?: {type: string, ability: string, key?: string},
 *   refusal?: string}>}
 */
async function linkedCheck(command, actor) {
  const found = await findLink(actor, command.text, command.link);
  if ( found.refusal ) return { refusal: found.refusal };
  const { link } = found;
  if ( link?.kind !== "check" ) return { refusal: "link" };
  const type = CHECK_TYPES[command.kind];
  const check = (link.checks ?? []).find(each => (each.type === type) && ((each.key ?? each.ability) === command.key));
  return check ? { link, check } : { refusal: "link" };
}

/**
 * The character's place in the combat a roll of initiative is for: one without initiative yet, in
 * the combat the Gamemaster has up, which is the one dnd5e rolls initiative in.
 * @param {object} command
 * @param {Actor} actor
 * @returns {{refusal?: string, roller?: Actor}}
 */
function initiativeTurn(command, actor) {
  const combat = game.combats?.get(command.combatId);
  if ( !combat || (game.combat?.id !== combat.id) ) return { refusal: "not-in-combat" };
  const own = combat.combatants.filter(combatant => (combatant.actor?.id ?? combatant.actorId) === actor.id);
  if ( !own.length ) return { refusal: "not-in-combat" };
  const waiting = own.find(combatant => combatant.initiative === null);
  if ( !waiting ) return { refusal: "already-rolled" };
  // An unlinked token rolls as its own actor.
  const roller = waiting.actor ?? actor;
  if ( roller._cachedInitiativeRoll ) return { refusal: "busy" };
  return { roller };
}

/* -------------------------------------------- */

/**
 * Make the roll through dnd5e, without its dialog, as the player's own.
 * @param {object} command
 * @param {Actor} actor
 * @returns {Promise<ChatMessage|null>}   The roll's message.
 */
async function makeRoll(command, actor) {
  const author = authorFor(actor);
  const flags = { [MODULE_ID]: { request: command.id } };
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
    case "death": return messageOf(await actor.rollDeathSave(config({}), dialog, message));
    case "initiative": return rollInitiative(command, actor, { author, flags });
    case "hitDie": return rollHitDie(command, actor, message);
    case "formula": return rollFormula(command, actor, message);
    default: return null;
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
 * concentration check is rolled as one; failed, it ends the character's concentration, which the
 * player can't from the app, unless Midi-QOL is there to, as it does after a failed check when its
 * Gamemaster has it remove concentration.
 * @param {object} command
 * @param {Actor} actor
 * @param {RollPrompt} prompt
 * @returns {Promise<{message: ChatMessage|null, outcome: string|null}>}
 */
async function answerPrompt(command, actor, prompt) {
  const author = authorFor(actor);
  const flags = { [MODULE_ID]: { request: command.id }, dnd5e: { originatingMessage: prompt.messageId } };
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
 * Roll a saving throw a description calls for, through dnd5e, without its dialog, as the player's
 * own: against its DC, if it names one, even one its author hid, as dnd5e rolls one clicked in the
 * description. A concentration check is rolled as one, with what adds to it, such as War Caster,
 * and with the ability the link names, or else the character's own, as dnd5e chooses it; against
 * dnd5e's DC of 10 where the link names none. Failed, it's left to the Gamemaster, or to Midi-QOL,
 * to end the concentration, as dnd5e leaves it.
 * @param {object} command
 * @param {Actor} actor
 * @param {{kind: string, abilities: string[], dc: number|null}} link
 * @returns {Promise<{message: ChatMessage|null, outcome: string|null}>}   The roll's message, and
 *   whether it met its DC, where it was rolled against one, as the card shows its author.
 */
async function rollLinkedSave(command, actor, link) {
  const author = authorFor(actor);
  const flags = { [MODULE_ID]: { request: command.id } };
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
 * the link's DC, if it names one, even one its author hid.
 * @param {object} command
 * @param {Actor} actor
 * @param {{dc: number|null, usingTool?: string}} link
 * @param {{type: string, ability: string, key?: string}} check   The one of its checks rolled.
 * @returns {Promise<{message: ChatMessage|null, outcome: string|null}>}   The roll's message, and
 *   whether it met its DC, where it was rolled against one, as the card shows its author.
 */
async function rollLinkedCheck(command, actor, link, check) {
  const author = authorFor(actor);
  const flags = { [MODULE_ID]: { request: command.id } };
  const target = Number.isInteger(link.dc) ? link.dc : null;
  const config = {
    ability: check.ability,
    ...((check.type === "skill") && { skill: check.key, ...(link.usingTool && { tool: link.usingTool }) }),
    ...((check.type === "tool") && { tool: check.key }),
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
 * actor roll initiative with it in the combat.
 * @param {object} command
 * @param {Actor} actor
 * @param {{author: User, flags: object}} message
 * @returns {Promise<ChatMessage|null>}
 */
async function rollInitiative(command, actor, { author, flags }) {
  const { roller, refusal } = initiativeTurn(command, actor);
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

  try {
    await roller.rollInitiative({
      createCombatants: false,
      initiativeOptions: {
        messageMode: PUBLIC,
        messageOptions: { rollMode: PUBLIC, author: author.id, flags }
      }
    });
  } finally {
    // Left by a roll that failed part way, it would be the Gamemaster's next roll.
    if ( roller._cachedInitiativeRoll?.options?.[ROLL_TAG] === command.id ) delete roller._cachedInitiativeRoll;
  }
  return findMessage(command.id);
}

/**
 * The user a player's roll is made as: the one whose character it is, or else its only player,
 * or else the Gamemaster making it.
 * @param {Actor} actor
 * @returns {User}
 */
export function authorFor(actor) {
  const assigned = game.users.find(user => !user.isGM && (user.character?.id === actor.id));
  if ( assigned ) return assigned;
  const owners = playerOwners(actor);
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
 * May a character's player see a message?
 * @param {ChatMessage} message
 * @param {Actor} actor
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
 * @param {Actor} actor
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
 * Mark a roll made from the app on its chat card, for everyone to see.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function markAppRoll(message, html) {
  const flags = message.flags?.[MODULE_ID];
  if ( !(flags?.request || flags?.use) || !(html instanceof HTMLElement) ) return;
  const header = html.querySelector(".message-header .message-metadata") ?? html.querySelector(".message-header");
  if ( !header || header.querySelector(".sending-stone-badge") ) return;
  const badge = document.createElement("span");
  badge.className = "sending-stone-badge";
  const label = game.i18n.localize("SENDINGSTONE.Roll.Badge");
  badge.dataset.tooltip = label;
  badge.setAttribute("aria-label", label);
  badge.innerHTML = '<i class="fa-solid fa-mobile-screen-button" inert></i>';
  header.prepend(badge);
}
