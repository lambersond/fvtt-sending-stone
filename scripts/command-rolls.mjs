import { ATTACK_KINDS, DIE_FACES, MODULE_ID, ROLL_KINDS, ROLL_TAG } from "./constants.mjs";
import { playerOwners } from "./characters.mjs";
import { chatAudience, summarizeRoll } from "./chat-data.mjs";
import { diceStatus, withPlan } from "./dice-plan.mjs";

/**
 * Making a player's roll from the Sending Stone app: a check, saving throw, death saving throw or
 * initiative, through dnd5e, as if the player had rolled it in Foundry, with the dice they rolled.
 */

/**
 * How a player's roll is shown: to everyone, as a player's own roll usually is. A module may still
 * make it blind, as Midi-QOL can; the player is then told only that it was made.
 * @type {string}
 */
export const PUBLIC = "public";

/**
 * The rolls of something on the sheet: a skill, tool or ability, by its key.
 * @type {Set<string>}
 */
const KEYED = new Set(["skill", "tool", "ability", "save"]);

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
 * @property {object|null} [attack]     For an attack: whether it was a critical hit or a fumble, and
 *                                      whether it hit its target, when its player may know.
 * @property {object|null} [damage]     For an attack: the dice its damage will throw, for its player
 *                                      to roll; null when no damage follows.
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
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failed("unknown");
  const refusal = checkRoll(command, actor);
  if ( refusal ) return failed(refusal);

  let message;
  try {
    message = await withPlan(command, () => makeRoll(command, actor));
  } catch (err) {
    console.error(`${MODULE_ID} | Could not make ${actor.name}'s roll from Sending Stone`, err);
    return failed("error", err instanceof Error ? err.message : String(err));
  }
  // A roll a module called off, as dnd5e's hooks allow, made nothing.
  if ( !message ) return failed("cancelled");
  return describeResult(command, message, actor, campaign);
}

/**
 * Why a fetched roll isn't one to make, if it isn't. The app checks the same, but what reaches the
 * game is checked again here: only dice a player can roll, and only values those dice show.
 * @param {object} command
 * @returns {string|null}
 */
export function checkCommand(command) {
  if ( ATTACK_KINDS.includes(command.kind) ) return checkAttackCommand(command);
  if ( !ROLL_KINDS.includes(command.kind) ) return "kind";
  if ( KEYED.has(command.kind) !== (typeof command.key === "string") ) return "key";
  if ( (command.kind === "initiative") !== (typeof command.combatId === "string") ) return "combat";
  if ( ![-1, 0, 1].includes(command.mode) || (typeof command.explicit !== "boolean") ) return "mode";
  const { extras, dice } = command;
  if ( !Array.isArray(extras) || (extras.length > 10) || !extras.every(isExtra) ) return "extras";
  if ( !Array.isArray(dice) || !dice.length || (dice.length > 11) || !dice.every(isRolled) ) return "dice";
  return null;
}

/**
 * Why a fetched attack, use or damage isn't one to make, if it isn't. An attack names the item and
 * activity it's made with, and the combatant it's made at, if any, and has its d20s and any dice
 * the player added; it may name the spell slot, ammunition and attack mode it's made with. A use
 * names the item and activity, the combatants it's used at, and the spell slot, if any, and has no
 * dice. Damage names the use it follows and has the dice that use's damage throws, if any, which
 * are checked against them when it's made, and the kind of damage chosen for each of its rolls.
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
  const { target } = command;
  if ( (target !== null) && (target !== undefined) && !isTarget(target) ) return "target";
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
 * Why the character can't make this roll now, if it can't.
 * @param {object} command
 * @param {Actor} actor
 * @returns {string|null}
 */
function checkRoll(command, actor) {
  const { key } = command;
  switch ( command.kind ) {
    case "skill": return (CONFIG.DND5E.skills?.[key] && actor.system.skills?.[key]) ? null : "unknown";
    case "tool": return CONFIG.DND5E.tools?.[key] ? null : "unknown";
    case "ability":
    case "save": return (CONFIG.DND5E.abilities?.[key] && actor.system.abilities?.[key]) ? null : "unknown";
    case "death": {
      // dnd5e would warn the Gamemaster of a death saving throw that isn't needed.
      const { hp, death } = actor.system.attributes ?? {};
      const dying = death && (hp?.value <= 0) && (death.success < 3) && (death.failure < 3);
      return dying ? null : "not-dying";
    }
    case "initiative": return initiativeTurn(command, actor).refusal ?? null;
    default: return "unknown";
  }
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
    default: return null;
  }
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
