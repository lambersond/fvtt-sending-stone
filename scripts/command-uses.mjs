import { MODULE_ID, ROLL_TAG, SETTINGS } from "./constants.mjs";
import {
  authorFor, checkCommand, describeResult, failedResult, findMessage, PUBLIC
} from "./command-rolls.mjs";
import { damageRollsFor, diceStatus, plannedDice, withPlan } from "./dice-plan.mjs";

/**
 * Making a player's attack, spell or feature from the Sending Stone app: using the item as in
 * Foundry, spending what it spends, at the targets the player picked, with the spell slot,
 * ammunition and attack mode they chose; for an attack, rolling it with the d20s they rolled; and
 * once they roll it, its damage or healing, on the same use, with their dice.
 *
 * Where Midi-QOL's activities make every use of an item a workflow, the use goes through that
 * workflow, as if the player had used it in Foundry: Midi checks the hit, has the targets roll their
 * saving throws and, once the damage is rolled, applies it, as the Gamemaster has it set up.
 * Otherwise dnd5e's own cards are posted, for the Gamemaster to apply what they show. What would
 * open a dialog on the Gamemaster's screen is refused beforehand, where it can be known.
 */

/**
 * How long a Midi-QOL use may take, in milliseconds, before it's given up on: until its attack is
 * rolled, it waits for its damage, or it ends. Midi waits on the Gamemaster when it asks them
 * something, such as a target's reaction, and on players rolling their targets' saving throws.
 * @type {number}
 */
const USE_WITHIN = 300_000;

/**
 * How long, at most, the Gamemaster's targets stay a Midi-QOL use's while its damage is rolled into
 * its workflow, in milliseconds: Midi takes an area's targets from them once the damage is rolled,
 * after the Gamemaster has confirmed it, where they're asked to.
 * @type {number}
 */
const TARGETS_HELD = 60_000;

/**
 * How often a Midi-QOL workflow is looked at while it's under way, in milliseconds.
 * @type {number}
 */
const CHECK_EVERY = 100;

/**
 * The activations Midi-QOL counts as using a reaction.
 * @type {Set<string>}
 */
const REACTIONS = new Set(["reaction", "reactiondamage", "reactionmanual", "reactionpreattack"]);

/**
 * The kinds of activity a player can use from the app other than an attack: a saving throw, damage,
 * healing, or anything else, such as an effect.
 * @type {Set<string>}
 */
const USES = new Set(["save", "damage", "heal", "utility"]);

/**
 * dnd5e's own class for each kind of activity whose damage or healing a player rolls in the app.
 * @type {Record<string, string>}
 */
const DND5E_ACTIVITIES = { attack: "AttackActivity", save: "SaveActivity", damage: "DamageActivity", heal: "HealActivity" };

/**
 * The kinds of target Midi-QOL won't use an activity without, where it needs targets.
 * @type {Set<string>}
 */
const CREATURES = new Set(["creature", "enemy", "ally", "willing"]);

/**
 * The states of a Midi-QOL workflow through which it may still take an area's targets from the
 * Gamemaster's, once its damage is rolled.
 * @type {string[]}
 */
const TAKING_TARGETS = [
  "WorkflowState_WaitForDamageRoll", "WorkflowState_ConfirmRoll", "WorkflowState_RollConfirmed",
  "WorkflowState_DamageRollStarted"
];

/**
 * The latest Midi-QOL use, which the next waits for: each sets the Gamemaster's targets.
 * @type {Promise<unknown>}
 */
let midiQueue = Promise.resolve();

/* -------------------------------------------- */
/*  Availability                                */
/* -------------------------------------------- */

/**
 * Why players' attacks can't be made here, if they can't: not until the self-test has shown that
 * their damage takes the player's dice; nor where Midi-QOL makes items' uses and the Gamemaster has
 * turned off making attacks through it.
 * @returns {"pending"|"self-test"|"midi-off"|null}
 */
export function attacksUnavailable() {
  if ( diceStatus.reason === "pending" ) return "pending";
  if ( !diceStatus.attacks ) return "self-test";
  if ( midiActivities() && !midiIntegration() ) return "midi-off";
  return null;
}

/**
 * Does Midi-QOL make the uses of items' activities here: its activities in place of dnd5e's, each
 * use of one a workflow?
 * @returns {boolean}
 */
function midiActivities() {
  if ( game.modules.get("midi-qol")?.active !== true ) return false;
  try {
    return game.settings.get("midi-qol", "ReplaceDefaultActivities") !== false;
  } catch {
    return true;
  }
}

/**
 * Has the Gamemaster left players' attacks to go through Midi-QOL's workflow?
 * @returns {boolean}
 */
function midiIntegration() {
  return game.settings.get(MODULE_ID, SETTINGS.MIDI_INTEGRATION) !== false;
}

/**
 * Does the Gamemaster let a Midi-QOL use be made at targets their canvas doesn't draw, such as on
 * another level, leaving those to be applied from its card?
 * @returns {boolean}
 */
function offCanvasTargets() {
  return game.settings.get(MODULE_ID, SETTINGS.OFF_CANVAS_TARGETS) === true;
}

/**
 * Is this one of Midi-QOL's activities, each use of which is a workflow?
 * @param {Activity} activity
 * @returns {boolean}
 */
function isMidiActivity(activity) {
  return typeof activity?.setupTargets === "function";
}

/* -------------------------------------------- */
/*  Uses                                        */
/* -------------------------------------------- */

/**
 * Make a player's attack, or their use of a spell or feature, for their character, if the campaign
 * takes them and the character can make it now: use the item, then, for an attack, attack.
 * @param {object} command      The player's attack or use, as fetched from the app.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]   Aborted once the app has been told it took too long: a use
 *                                         not yet begun then isn't made at all.
 * @returns {Promise<CommandResult>}
 */
export async function runUseCommand(command, campaign, { signal }={}) {
  const refusal = commandRefusal(command, campaign);
  if ( refusal ) return failedResult(command, refusal.reason, refusal.error);
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failedResult(command, "unknown");
  const use = await prepareUse(command, actor);
  if ( use.refusal ) return failedResult(command, use.refusal, use.error ?? null);
  if ( !isMidiActivity(use.activity) ) {
    return use.attack ? dnd5eAttack(command, campaign, actor, use) : dnd5eUse(command, campaign, actor, use);
  }
  if ( !midiIntegration() ) return failedResult(command, "midi-off");
  return midiUse(command, campaign, actor, use, signal);
}

/**
 * Why a use, or its damage, isn't to be made, before looking at the character.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {{reason: string, error?: string}|null}
 */
function commandRefusal(command, campaign) {
  if ( !campaign.rolls || !diceStatus.ready ) return { reason: "off" };
  if ( !campaign.attacks ) return { reason: "attacks-off" };
  const unavailable = attacksUnavailable();
  if ( unavailable ) return { reason: (unavailable === "pending") ? "off" : unavailable };
  const invalid = checkCommand(command);
  if ( invalid ) return { reason: "invalid", error: invalid };
  return null;
}

/**
 * What a use needs, and whether it can be made, as dnd5e's usage dialog would have it used: with
 * the spell slot, ammunition and attack mode the player chose, or else the dialog's own, at the
 * targets they picked, and with what it consumes.
 * @param {object} command
 * @param {Actor} actor
 * @returns {Promise<object>}   `{refusal, error}`, or what the use is made with.
 */
async function prepareUse(command, actor) {
  const attack = command.kind === "attack";
  const item = actor.items.get(command.item);
  if ( !item || (item.system?.identified === false) || (item.system?.quantity === 0) ) return { refusal: "item" };
  const activity = item.system.activities?.get(command.activity);
  const usable = attack ? (activity?.type === "attack") : USES.has(activity?.type);
  if ( !usable || !activity.canUse ) return { refusal: "activity" };
  // An area attack is made at whoever is in its template, placed by hand.
  if ( attack && activity.target?.template?.type ) return { refusal: "area" };

  const slot = slotFor(command, activity);
  if ( slot === false ) return { refusal: "slot" };
  const weapon = attack ? weaponChoices(command, item, activity) : {};
  if ( weapon.refusal ) return weapon;

  const targets = [];
  for ( const picked of (attack ? [command.target] : (command.targets ?? [])) ) {
    if ( !picked ) continue;
    const target = targetOf(picked);
    if ( !target || targets.some(other => other.token.id === target.token.id) ) return { refusal: "target" };
    targets.push(target);
  }
  // As many as it takes at the level it's cast at, as a spell may take more for each level higher.
  if ( !attack && (targets.length > mostTargets(scaledActivity(activity, slot))) ) return { refusal: "target" };

  const usage = {
    create: { measuredTemplate: false },
    subsequentActions: false,
    ...(slot ? { spell: { slot } } : {})
  };
  // What using it would spend, worked out without spending it: anything it can't spend is said
  // here, rather than on the Gamemaster's screen.
  const prepared = activity._prepareUsageConfig(usage);
  try {
    const updates = await activity._prepareUsageUpdates(prepared, { returnErrors: true });
    if ( Array.isArray(updates) && updates.length ) return { refusal: "consume", error: updates[0]?.message ?? null };
  } catch (err) {
    return { refusal: "consume", error: err instanceof Error ? err.message : String(err) };
  }

  return { attack, item, activity, targets, usage, prepared, attackMode: weapon.attackMode, ammunition: weapon.ammunition };
}

/**
 * The spell slot a spell is cast with: the one the player chose, if dnd5e's usage dialog offers it
 * and it has one left; otherwise the dialog's own choice. A slot chosen for anything cast without
 * one, such as a spell cast at will or from an item, is left out: dnd5e would cast it at that
 * slot's level without spending it.
 * @param {object} command
 * @param {Activity} activity
 * @returns {string|null|false}   False when the chosen slot can't cast it.
 */
function slotFor(command, activity) {
  const slots = eligibleSlots(activity);
  if ( !command.slot || !slots ) return defaultSlot(activity);
  const chosen = slots.find(slot => slot.key === command.slot);
  return chosen?.available ? chosen.key : false;
}

/**
 * The spell slots a spell can be cast with, as dnd5e's usage dialog offers them: each pool from the
 * spell's level up to the highest the character has, that its kind of spellcasting may use, and
 * whether it has one left to spend. Null for anything cast without choosing a slot: a cantrip, a
 * spell cast at will or innately, one cast from an item, or one at a fixed level, as on a scroll.
 * @param {Activity} activity
 * @returns {{key: string, level: number, available: boolean}[]|null}
 */
export function eligibleSlots(activity) {
  return slotChoice(activity)?.slots ?? null;
}

/**
 * The spell slot a spell is cast with, as dnd5e's usage dialog picks it: its own level's, if any
 * are left; otherwise the first pool with any left, at or above its level, that its kind of
 * spellcasting may use. Nothing for a cantrip or a spell cast without slots.
 * @param {Activity} activity
 * @returns {string|null}
 */
export function defaultSlot(activity) {
  const choice = slotChoice(activity);
  if ( !choice ) return null;
  const { configured, consumes, slots } = choice;
  if ( !slots || !consumes || activity.actor.system.spells?.[configured]?.value ) return configured;
  // None is left; the consumption check then says so.
  return slots.find(slot => slot.available)?.key ?? configured;
}

/**
 * How a spell's slot is chosen, as dnd5e's usage dialog has it: the slot it would be cast with
 * unless another is chosen, whether casting spends one, and the slots it offers, if any.
 * @param {Activity} activity
 * @returns {{configured: string|null, consumes: boolean, slots: object[]|null}|null}   Null for
 *   anything cast without a slot.
 */
function slotChoice(activity) {
  if ( !activity.requiresSpellSlot ) return null;
  const prepared = activity._prepareUsageConfig({});
  const configured = prepared.spell?.slot ?? null;
  const consumes = (prepared.consume === true) || Boolean(prepared.consume?.spellSlot);
  if ( (prepared.scaling === false) || prepared.cause?.activity ) return { configured, consumes, slots: null };
  const { actor, item } = activity;
  const spells = actor.system.spells ?? {};
  const lowest = item.system.level ?? 1;
  const highest = Object.values(spells).reduce((max, pool) => pool.max ? Math.max(max, pool.level) : max, 0);
  const method = CONFIG.DND5E.spellcasting?.[item.system.method];
  const slots = Object.entries(spells).flatMap(([key, pool]) => {
    if ( !pool.max || (pool.level < lowest) || (pool.level > highest) || !pool.type ) return [];
    if ( method?.exclusive?.spells && (item.system.method !== pool.type) ) return [];
    if ( CONFIG.DND5E.spellcasting?.[pool.type]?.exclusive?.slots && (item.system.method !== pool.type) ) return [];
    return [{ key, level: pool.level, available: !consumes || (pool.value > 0) }];
  });
  return { configured, consumes, slots };
}

/**
 * The attack mode and ammunition an attack is made with: those the player chose, if they're the
 * weapon's, otherwise those last used.
 * @param {object} command
 * @param {Item} item
 * @param {Activity} activity
 * @returns {{attackMode?: string, ammunition?: string, refusal?: string}}
 */
function weaponChoices(command, item, activity) {
  const modes = Array.from(item.system.attackModes ?? []).filter(mode => mode.value);
  if ( command.attackMode && !modes.some(mode => mode.value === command.attackMode) ) return { refusal: "mode" };
  const attackMode = command.attackMode || defaultAttackMode(item, activity);
  let ammunition;
  if ( command.ammunition ) {
    const option = (item.system.ammunitionOptions ?? []).find(each => each.value === command.ammunition);
    if ( !option || option.disabled ) return { refusal: "ammo" };
    ammunition = option.value;
  }
  else ammunition = defaultAmmunition(item, activity);
  if ( item.system.properties?.has?.("amm") && !ammunition ) return { refusal: "ammo" };
  return { attackMode, ammunition };
}

/**
 * The attack mode an attack is made in: the one last used, if it's still one of the weapon's,
 * otherwise its first. Given always, so that nothing asks for one.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {string|undefined}
 */
export function defaultAttackMode(item, activity) {
  const modes = (item.system.attackModes ?? []).filter(mode => mode.value);
  const last = item.getFlag("dnd5e", `last.${activity.id}.attackMode`);
  return (modes.find(mode => mode.value === last) ?? modes[0])?.value;
}

/**
 * The ammunition an attack uses: the one last used, if any is left, otherwise the first with any
 * left. dnd5e's own choice would take an empty one, or none at all for one used up.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {string|undefined}   The ammunition item's id.
 */
export function defaultAmmunition(item, activity) {
  const options = (item.system.ammunitionOptions ?? []).filter(option => !option.disabled);
  const last = item.getFlag("dnd5e", `last.${activity.id}.ammunition`);
  return (options.find(option => option.value === last) ?? options[0])?.value;
}

/**
 * An activity as it is with a spell slot above its spell's level, with what scales with it, such as
 * how many it targets: as dnd5e has it once it's cast with that slot.
 * @param {Activity} activity
 * @param {string|null} slot
 * @returns {Activity}
 */
function scaledActivity(activity, slot) {
  const level = slot ? activity.actor?.system.spells?.[slot]?.level : null;
  const scaling = ((activity.item.type === "spell") && level) ? (level - (activity.item.system.level ?? 0)) : 0;
  if ( scaling <= 0 ) return activity;
  const item = activity.item.clone({ "flags.dnd5e.scaling": scaling }, { keepId: true });
  return item.system.activities?.get(activity.id) ?? activity;
}

/**
 * The most targets an activity is used at: none for one used on its user alone, the number it
 * affects, or any number.
 * @param {Activity} activity
 * @returns {number}
 */
function mostTargets(activity) {
  const { affects, template } = activity.target ?? {};
  const area = Boolean(template?.type);
  if ( (affects?.type === "self") || (!area && !affects?.type && (activity.range?.units === "self")) ) return 0;
  const count = Number(affects?.count);
  return (Number.isInteger(count) && (count > 0)) ? count : Infinity;
}

/**
 * The combatant a use is made at, with its token and the token's actor.
 * @param {{combatId: string, combatantId: string}} target
 * @returns {{combatant: Combatant, token: TokenDocument, actor: Actor}|null}
 */
export function targetOf({ combatId, combatantId }) {
  const combatant = game.combats?.get(combatId)?.combatants.get(combatantId);
  const token = combatant?.token;
  if ( !token?.actor || combatant.hidden ) return null;
  return { combatant, token, actor: token.actor };
}

/**
 * A target as dnd5e describes it on a card, as its own `getTargetDescriptors` would from the
 * Gamemaster's targets. Total cover leaves it no armor class to hit.
 * @param {{token: TokenDocument|null, actor: Actor}} target
 * @returns {{name: string, img: string, uuid: string, ac: number|null}}
 */
function targetDescriptor({ token, actor }) {
  const ac = actor.statuses?.has("coverTotal") ? null : (actor.system?.attributes?.ac?.value ?? null);
  return { name: token?.name ?? actor.name, img: actor.img, uuid: actor.uuid, ac };
}

/**
 * The targets a use's card names, which dnd5e's damage, healing and effects apply to: those the
 * player picked; or its user, for one used on its user alone.
 * @param {object} use    What `prepareUse` found.
 * @param {Actor} actor
 * @returns {object[]}
 */
function cardTargets({ activity, targets }, actor) {
  if ( targets.length ) return targets.map(targetDescriptor);
  return (mostTargets(activity) === 0) ? [targetDescriptor({ token: null, actor })] : [];
}

/* -------------------------------------------- */

/**
 * Make an attack through dnd5e: use the item, posting its card, then roll the attack, linked to
 * the card, with the player's dice.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use   What `prepareUse` found.
 * @returns {Promise<CommandResult>}
 */
async function dnd5eAttack(command, campaign, actor, use) {
  const { activity, usage, attackMode, ammunition } = use;
  const author = authorFor(actor);
  const targets = use.targets.map(targetDescriptor);
  const results = await activity.use(usage, { configure: false }, {
    rollMode: PUBLIC,
    data: { author: author.id, flags: { dnd5e: { targets }, [MODULE_ID]: { use: command.id } } }
  });
  const card = results?.message;
  if ( !card ) return failedResult(command, "cancelled");

  const rolls = await withPlan(command, () => activity.rollAttack(
    // The target's armor class, or none, rather than the Gamemaster's own target's.
    { attackMode, ammunition, target: targets[0]?.ac ?? null, rolls: [{ options: { [ROLL_TAG]: command.id } }] },
    { configure: false },
    {
      rollMode: PUBLIC,
      data: {
        author: author.id,
        flags: { dnd5e: { originatingMessage: card.id, targets }, [MODULE_ID]: { request: command.id } }
      }
    }
  ));
  const [roll] = rolls ?? [];
  const message = roll?.parent;
  if ( !roll || !message ) return failedResult(command, "no-attack");

  const critical = roll.isCritical === true;
  const ammo = ammunitionOf(message, actor);
  const preview = previewDamage(cardActivity(card), { attackMode, ammunition: ammo, isCritical: critical });
  await storeUse(card, {
    path: "dnd5e", type: "attack", attackMode: attackMode ?? null, ammunition: ammo?.id ?? null, critical, targets,
    preview
  });
  // As dnd5e shows players on the card whether an attack hit, if the world lets it.
  const shown = targets.length && (game.settings.get("dnd5e", "attackRollVisibility") !== "none");
  return attackResult(command, message, actor, campaign, rolls, {
    critical,
    fumble: roll.isFumble === true,
    outcome: shown ? outcomeOf(roll, targets[0]) : null
  }, preview);
}

/**
 * Use a spell or feature through dnd5e, posting its card, which names the targets the player
 * picked: the Gamemaster has them roll their saving throws, and applies the damage, healing and
 * effects, from it, as in Foundry. Its damage or healing is rolled once the player rolls it.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use   What `prepareUse` found.
 * @returns {Promise<CommandResult>}
 */
async function dnd5eUse(command, campaign, actor, use) {
  const { activity, usage } = use;
  const author = authorFor(actor);
  const targets = cardTargets(use, actor);
  const results = await activity.use(usage, { configure: false }, {
    rollMode: PUBLIC,
    data: { author: author.id, flags: { dnd5e: { targets }, [MODULE_ID]: { use: command.id } } }
  });
  const card = results?.message;
  if ( !card ) return failedResult(command, "cancelled");

  const preview = previewDamage(cardActivity(card), { isCritical: false });
  await storeUse(card, {
    path: "dnd5e", type: activity.type, attackMode: null, ammunition: null, critical: false, targets, preview
  });
  return useResult(command, card, actor, campaign, activity, preview);
}

/**
 * Whether an attack hit its target, as dnd5e's card shows it: a critical hit always does; a
 * fumble, or a total under the target's armor class, misses. A target under total cover can't be
 * hit, as Midi-QOL has it.
 * @param {Roll} roll
 * @param {{ac: number|null}} target
 * @returns {"hit"|"miss"}
 */
function outcomeOf(roll, { ac }) {
  if ( ac === null ) return "miss";
  const miss = !roll.isCritical && ((roll.total < ac) || roll.isFumble);
  return miss ? "miss" : "hit";
}

/**
 * The ammunition an attack used, as dnd5e's Damage button finds it: as it was, if it was used up
 * and deleted, otherwise the item.
 * @param {ChatMessage|null} message   The attack's message.
 * @param {Actor} actor
 * @returns {Item|null}
 */
function ammunitionOf(message, actor) {
  const stored = message?.getFlag?.("dnd5e", "roll.ammunitionData");
  if ( stored ) return new Item.implementation(stored, { parent: actor });
  const id = message?.getFlag?.("dnd5e", "roll.ammunition");
  return id ? (actor.items.get(id) ?? null) : null;
}

/**
 * An activity as its card has it used, as dnd5e's card does for its buttons: with what it
 * consumed, and the scaling of the spell slot it was cast with.
 * @param {ChatMessage} card   The use's card.
 * @returns {Activity|null}
 */
export function cardActivity(card) {
  const activity = card.getAssociatedActivity?.();
  if ( !activity ) return null;
  const consumed = activity.createConsumedFlag?.(card.getAssociatedActor?.(), card.system?.deltas);
  const scaling = card.system?.scaling ?? 0;
  const item = (consumed || scaling)
    ? activity.item.clone({ "flags.dnd5e": { consumed, scaling } }, { keepId: true })
    : activity.item;
  return item.system.activities.get(activity.id) ?? null;
}

/**
 * Keep what a use's damage needs on its card, so that it can be rolled later, even after the game
 * is reloaded, and only once.
 * @param {ChatMessage} card
 * @param {object} use   How it was made: `{path, type, attackMode, ammunition, critical, targets,
 *                       preview}`, and on Midi-QOL's, the targets' `tokenIds` and whether it's an
 *                       `area`'s.
 * @returns {Promise<void>}
 */
async function storeUse(card, use) {
  await card.setFlag(MODULE_ID, "usage", use);
}

/**
 * What the app is told of an attack made: its roll, and what came of it, if its player may see
 * them; and the dice its damage will throw, for its player to roll.
 * @param {object} command
 * @param {ChatMessage} message    The attack's message.
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @param {Roll[]} rolls
 * @param {object} attack          Whether it was a critical hit or a fumble, and hit.
 * @param {object|null} damage     What `previewDamage` gave.
 * @returns {CommandResult}
 */
function attackResult(command, message, actor, campaign, rolls, attack, damage) {
  const result = describeResult(command, message, actor, campaign, { rolls, extra: { attack, damage } });
  if ( !result.visible ) result.attack = null;
  return result;
}

/**
 * What the app is told of a spell or feature used: the kind of activity it was, and the dice its
 * damage or healing will throw, for its player to roll. A use rolls none of the player's dice.
 * @param {object} command
 * @param {ChatMessage} card       The use's card.
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @param {Activity} activity
 * @param {object|null} damage     What `previewDamage` gave.
 * @returns {CommandResult}
 */
function useResult(command, card, actor, campaign, activity, damage) {
  return describeResult(command, card, actor, campaign, { rolls: [], extra: { use: { type: activity.type }, damage } });
}

/* -------------------------------------------- */
/*  Midi-QOL                                    */
/* -------------------------------------------- */

/**
 * Make a use through Midi-QOL's workflow, one at a time: each sets the Gamemaster's targets while
 * it's made. A use still waiting its turn when the app is told it took too long isn't made at all.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use            What `prepareUse` found.
 * @param {AbortSignal} [signal]
 * @returns {Promise<CommandResult>}
 */
function midiUse(command, campaign, actor, use, signal) {
  const refusal = midiRefusal(use, actor);
  if ( refusal ) return Promise.resolve(failedResult(command, refusal));
  return midiQueued(() => {
    if ( signal?.aborted ) return failedResult(command, "timeout");
    return midiUseNow(command, campaign, actor, use);
  });
}

/**
 * Do something that sets the Gamemaster's targets for Midi-QOL once whatever else does has done.
 * @template T
 * @param {() => T|Promise<T>} run
 * @returns {Promise<T>}
 */
function midiQueued(run) {
  const next = midiQueue.then(run);
  midiQueue = next.catch(() => null);
  return next;
}

/**
 * Why Midi-QOL would stop to ask the Gamemaster something about this use, or not make it, if it
 * would: Active Defence, which has an attack's target roll instead; an activity that always opens
 * Midi's dialogs, asks which of its effects to apply, or prompts for its roll; a target that can't
 * be targeted; a target the Gamemaster's canvas doesn't draw, unless they allow it; none Midi can
 * target where one is needed; or a reaction or bonus action already used this round, where they're
 * enforced.
 * @param {object} use   What `prepareUse` found.
 * @param {Actor} actor
 * @returns {string|null}
 */
function midiRefusal({ activity, targets, attack }, actor) {
  const MidiQOL = globalThis.MidiQOL;
  if ( !MidiQOL?.Workflow ) return "midi";
  const settings = MidiQOL.configSettings?.() ?? {};
  if ( attack && MidiQOL.checkRule?.("activeDefence") ) return "active-defence";
  const properties = activity.midiProperties ?? {};
  const always = (properties.forceRollDialog === "always") || (properties.forceConsumeDialog === "always")
    || ((properties.forceDamageDialog === "always") && rollsDamage(activity));
  const prompts = (activity.type === "utility") && activity.roll?.formula && activity.roll?.prompt;
  if ( always || properties.chooseEffects || prompts ) return "midi-dialog";

  // Midi targets only tokens the Gamemaster's canvas draws: those on the level and scene they view.
  const drawn = targets.filter(target => target.token.object);
  if ( (drawn.length < targets.length) && !offCanvasTargets() ) return "scene";
  for ( const target of drawn ) {
    if ( MidiQOL.isTargetable && !MidiQOL.isTargetable(target.token.object) ) return "target";
  }
  if ( !drawn.length && midiNeedsTargets(activity, actor, settings) ) return targets.length ? "scene" : "target";

  if ( actor.inCombat ) {
    const enforced = setting => (settings[setting] === "all") || (settings[setting] === actor.type);
    const type = activity.effectiveActivationType ?? activity.activation?.type ?? "";
    const combat = game.combat;
    const ownTurn = combat?.combatant === combat?.getCombatantsByActor?.(actor)?.[0];
    const opportunity = attack && !ownTurn && enforced("recordAOO") && (type !== "special");
    const reaction = (REACTIONS.has(type) && ((activity.activation?.cost ?? 1) > 0)) || opportunity;
    if ( reaction && enforced("enforceReactions") && MidiQOL.hasUsedReaction?.(actor) ) return "reaction";
    if ( (type === "bonus") && enforced("enforceBonusActions") && MidiQOL.hasUsedBonusAction?.(actor) ) {
      return "bonus-action";
    }
  }
  return null;
}

/**
 * Would Midi-QOL refuse to use this activity at no one, as its *Requires Targets* setting has it:
 * one with targets of its own to pick, not its user or an area, that does something to them?
 * @param {Activity} activity
 * @param {Actor} actor
 * @param {object} settings   Midi's settings.
 * @returns {boolean}
 */
function midiNeedsTargets(activity, actor, settings) {
  const rule = settings.requiresTargets;
  const needed = (rule === "always") || ((rule === "combat") && actor.inCombat)
    || ((rule === "tokens") && ((canvas?.scene?.tokens?.size ?? 0) > 0));
  const affects = activity.target?.affects?.type ?? "";
  if ( !needed || !affects || (affects === "self") || activity.target?.template?.type ) return false;
  return CREATURES.has(affects) || (activity.type === "attack") || rollsDamage(activity) || (activity.type === "save");
}

/**
 * Does an activity roll damage or healing?
 * @param {Activity} activity
 * @returns {boolean}
 */
function rollsDamage(activity) {
  return ((activity.damage?.parts?.length ?? 0) > 0) || Boolean(activity.healing?.formula);
}

/**
 * Use the item through Midi-QOL, at the targets the player picked, and wait for its workflow: for an
 * attack, until the attack it rolls with the player's dice is rolled; then until it waits for the
 * damage or healing, or ends.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use   What `prepareUse` found.
 * @returns {Promise<CommandResult>}
 */
async function midiUseNow(command, campaign, actor, use) {
  const { activity, usage, prepared, attackMode, ammunition, attack } = use;
  // Midi works on the targets the Gamemaster's canvas draws; any other, where they allow it, is
  // only named on the card, for them to apply what it does.
  const tokens = use.targets.map(target => target.token.object).filter(Boolean);
  const targets = use.targets.map(targetDescriptor);
  const offCanvas = tokens.length < use.targets.length;
  if ( attack && ammunition ) await fireAmmunition(activity, ammunition);
  // Midi sets the Gamemaster's targets to the workflow's, and takes theirs for an area, or where it
  // has none.
  const saved = currentTargets();
  setTargets(tokens.map(token => token.id));
  try {
    const workflowOptions = {
      autoRollAttack: true,
      fastForwardAttack: true,
      autoFastAttack: true,
      // The damage waits for the player's dice; a utility's own roll is Midi's.
      autoRollDamage: rollsFormula(activity) ? "always" : "none",
      fastForwardDamage: true,
      targetConfirmation: "none",
      forceCompletion: true,
      autoConsumeResource: "both",
      // The targets roll their saving throws as the player picked them, not as the Gamemaster's are.
      ignoreUserTargets: true,
      attackMode,
      preSelectedTargetUuids: tokens.map(token => token.document.uuid),
      // Dice So Nice holds Midi's workflow until a hidden tab is shown again.
      attackRollDSN: !document.hidden,
      damageRollDSN: !document.hidden,
      [ROLL_TAG]: command.id
    };
    const midiUsage = {
      ...usage,
      // Midi puts concentration off until its checks pass, then ends only what it's told to.
      ...(prepared.concentration ? { concentration: { begin: true, end: prepared.concentration.end ?? null } } : {}),
      midiOptions: { targetsToUse: new Set(tokens), configureDialog: false, workflowOptions }
    };

    let card = null;
    let workflow = null;
    // Midi names the workflow's targets on the card, which can't hold one the canvas lacks; the card
    // names every target, for the Gamemaster to apply what Midi can't.
    const nameAll = (used, message) => {
      if ( message?.data?.flags?.[MODULE_ID]?.use !== command.id ) return;
      foundry.utils.setProperty(message.data, "flags.dnd5e.targets", targets);
    };
    if ( offCanvas ) Hooks.on("dnd5e.preCreateUsageMessage", nameAll);
    const state = await withPlan(command, async () => {
      const results = await activity.use(midiUsage, { configure: false }, {
        rollMode: PUBLIC,
        data: { flags: { [MODULE_ID]: { use: command.id } } }
      }).finally(() => Hooks.off("dnd5e.preCreateUsageMessage", nameAll));
      card = results?.message ?? null;
      if ( !card ) return "aborted";
      workflow = midiUsage.workflow ?? globalThis.MidiQOL.Workflow.getWorkflow(card.uuid);
      if ( !workflow ) return "aborted";
      return workflowSettled(workflow);
    });

    if ( (state === "aborted") || !card || !workflow ) return failedResult(command, "midi");
    if ( attack && !workflow.attackRoll ) return failedResult(command, (state === "late") ? "timeout" : "no-attack");

    const critical = attack && (workflow.isCritical === true);
    const ammo = attack ? (workflow.ammunition ?? null) : null;
    const mode = attack ? (workflow.attackMode ?? attackMode ?? null) : null;
    const preview = (state === "waiting")
      ? previewDamage(workflow.activity, { attackMode: mode ?? undefined, ammunition: ammo, isCritical: critical })
      : null;
    await storeUse(card, {
      path: "midi", type: activity.type, attackMode: mode, ammunition: ammo?.id ?? null, critical, targets,
      tokenIds: tokens.map(token => token.id), area: Boolean(activity.target?.template?.type), preview
    });
    if ( !attack ) return useResult(command, card, actor, campaign, activity, preview);

    // As Midi shows players whether an attack hit.
    const settings = globalThis.MidiQOL.configSettings?.() ?? {};
    const [token] = tokens;
    const shown = token && (settings.autoCheckHit === "all") && !workflow.whisperAttackCard;
    const hit = !!token && (workflow.hitTargets?.has(token) || workflow.hitTargetsEC?.has(token));
    // Midi writes its card after its rolls, so they're taken from the workflow.
    return attackResult(command, card, actor, campaign, [workflow.attackRoll], {
      critical,
      fumble: workflow.isFumble === true,
      outcome: shown ? (hit ? "hit" : "miss") : null
    }, preview);
  } finally {
    setTargets(saved);
  }
}

/**
 * Have an attack made through Midi-QOL fire this ammunition: Midi fires the ammunition its activity
 * names, and dnd5e the ammunition last fired, as each keeps it once its own dialog has been used.
 * @param {Activity} activity
 * @param {string} ammunition   The ammunition item's id.
 * @returns {Promise<void>}
 */
async function fireAmmunition(activity, ammunition) {
  const key = `last.${activity.id}.ammunition`;
  if ( activity.item.getFlag("dnd5e", key) !== ammunition ) await activity.item.setFlag("dnd5e", key, ammunition);
  if ( ("ammunition" in activity) && (activity.ammunition !== ammunition) ) await activity.update?.({ ammunition });
}

/**
 * Does Midi-QOL roll this activity's own formula, as a utility's?
 * @param {Activity} activity
 * @returns {boolean}
 */
function rollsFormula(activity) {
  return (activity.type === "utility") && Boolean(activity.roll?.formula);
}

/**
 * Wait for a Midi-QOL workflow to settle: until it waits for its damage, ends, or is aborted, as it
 * can be with no change of state, as for a weapon with no ammunition left. One waiting for a
 * template to be placed goes on without one: its targets are the player's.
 * @param {Workflow} workflow
 * @returns {Promise<"waiting"|"ended"|"aborted"|"late">}
 */
async function workflowSettled(workflow) {
  const until = Date.now() + USE_WITHIN;
  let released = false;
  for ( ;; ) {
    if ( workflow.aborted || (workflow.currentAction === workflow.WorkflowState_Abort) ) return "aborted";
    if ( workflow.suspended && (workflow.currentAction === workflow.WorkflowState_WaitForDamageRoll) ) return "waiting";
    if ( !released && workflow.suspended && (workflow.currentAction === workflow.WorkflowState_AwaitTemplate) ) {
      released = true;
      Promise.resolve(workflow.unSuspend({ itemUseComplete: true })).catch(() => null);
    }
    if ( [workflow.WorkflowState_Completed, workflow.WorkflowState_RollFinished, workflow.WorkflowState_Cleanup]
      .includes(workflow.currentAction) ) return "ended";
    if ( Date.now() >= until ) return "late";
    await new Promise(resolve => setTimeout(resolve, CHECK_EVERY));
  }
}

/**
 * The Gamemaster's targets.
 * @returns {string[]}   Tokens' ids.
 */
function currentTargets() {
  return Array.from(game.user.targets ?? []).map(token => token.id);
}

/**
 * Set the Gamemaster's targets, as Midi-QOL does.
 * @param {string[]} ids   Tokens' ids, on the scene the Gamemaster is viewing.
 */
function setTargets(ids) {
  if ( typeof canvas?.tokens?.setTargets === "function" ) canvas.tokens.setTargets(ids);
  else game.user?.updateTokenTargets?.(ids);
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * The dice a use's damage or healing will throw, worked out before it's rolled, for its player to
 * roll them in the app: as dnd5e will make up its rolls, for the attack mode and ammunition an
 * attack used, and with a critical hit's dice; and each roll's choice of damage types, if it has
 * one. dnd5e's own `getDamageConfig` for the kind of activity is used, not Midi-QOL's, which
 * changes its workflow as it's called.
 * @param {Activity|null} activity
 * @param {object} [config]
 * @param {string} [config.attackMode]
 * @param {Item|null} [config.ammunition]
 * @param {boolean} [config.isCritical]
 * @returns {{critical: boolean, plannable: boolean, healing: boolean, rolls: object[]}|null}   Null
 *   for no damage or healing.
 */
export function previewDamage(activity, { attackMode, ammunition, isCritical=false }={}) {
  const kind = DND5E_ACTIVITIES[activity?.type];
  if ( !kind ) return null;
  const own = globalThis.dnd5e?.documents?.activity?.[kind]?.prototype?.getDamageConfig;
  const getDamageConfig = own ?? activity.getDamageConfig;
  if ( typeof getDamageConfig !== "function" ) return null;
  const process = getDamageConfig.call(activity, { attackMode, ammunition: ammunition ?? undefined });
  if ( !process?.rolls?.length ) return null;
  const rolls = damageRollsFor({ ...process, isCritical });
  const planned = rolls.map(roll => plannedDice(roll));
  const plannable = planned.every(plan => plan.plannable);
  return {
    critical: isCritical,
    plannable,
    healing: activity.type === "heal",
    rolls: rolls.map((roll, index) => ({
      formula: roll.formula,
      type: damageLabel(roll.options.type),
      types: typeChoices(roll.options.types),
      dice: plannable ? planned[index].dice : []
    }))
  };
}

/**
 * A kind of damage or healing, as dnd5e names it.
 * @param {string|undefined} type
 * @returns {string|null}
 */
function damageLabel(type) {
  if ( !type ) return null;
  return CONFIG.DND5E.damageTypes?.[type]?.label ?? CONFIG.DND5E.healingTypes?.[type]?.label ?? type;
}

/**
 * The kinds of damage or healing a roll lets its roller choose among, as dnd5e's damage dialog
 * offers them; null when it has one.
 * @param {string[]|undefined} types
 * @returns {{key: string, label: string}[]|null}
 */
function typeChoices(types) {
  if ( !Array.isArray(types) || (types.length < 2) ) return null;
  return types.map(key => ({ key, label: damageLabel(key) }));
}

/**
 * Roll a player's damage or healing, with their dice, on the use it follows: once, only with the
 * dice the use said it would throw, and as the kinds of damage they chose.
 * @param {object} command      The player's damage, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runDamageCommand(command, campaign) {
  const refusal = commandRefusal(command, campaign);
  if ( refusal ) return failedResult(command, refusal.reason, refusal.error);
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failedResult(command, "unknown");
  const card = game.messages.contents.findLast(message => message.flags?.[MODULE_ID]?.use === command.use);
  const flags = card?.flags?.[MODULE_ID];
  // Module 0.11.0 kept an attack's as `attack`.
  const stored = flags?.usage ?? flags?.attack;
  if ( !card || !stored ) return failedResult(command, "gone");
  if ( card.getAssociatedActor?.()?.id !== actor.id ) return failedResult(command, "unknown");
  if ( flags.damage ) return failedResult(command, "damaged");
  if ( !stored.preview ) return failedResult(command, "not-waiting");
  if ( !matchesPreview(command.dice, stored.preview) ) return failedResult(command, "invalid", "dice");
  if ( !offersTypes(command.types, stored.preview) ) return failedResult(command, "type");

  const rolls = (stored.path === "midi")
    ? await midiDamage(command, card, stored)
    : await dnd5eDamage(command, card, stored, actor);
  if ( typeof rolls === "string" ) return failedResult(command, rolls);
  if ( !rolls?.length ) return failedResult(command, "cancelled");
  await card.setFlag(MODULE_ID, "damage", command.id);
  // Midi-QOL rolls damage onto its card; dnd5e posts it on its own.
  return describeResult(command, rolls[0].parent ?? card, actor, campaign, { rolls });
}

/**
 * Are these the dice a use's damage throws, as its preview has them: the same dice, in order? None,
 * for damage that can't be planned or has no dice.
 * @param {object[]} dice
 * @param {object} preview
 * @returns {boolean}
 */
function matchesPreview(dice, preview) {
  const planned = preview.plannable ? preview.rolls.flatMap(roll => roll.dice) : [];
  if ( dice.length !== planned.length ) return false;
  return dice.every((die, index) => (die.faces === planned[index].faces) && (die.results.length === planned[index].number));
}

/**
 * Is each kind of damage the player chose, by roll, one that roll offers? A roll they chose none
 * for is rolled as dnd5e would, as the kind last rolled.
 * @param {(string|null)[]|undefined} types
 * @param {object} preview
 * @returns {boolean}
 */
function offersTypes(types, preview) {
  if ( !Array.isArray(types) ) return true;
  if ( types.length > preview.rolls.length ) return false;
  return types.every((type, index) => (type === null)
    || (preview.rolls[index].types ?? []).some(choice => choice.key === type));
}

/**
 * Roll damage through dnd5e, as its card's Damage or Healing button would: for the activity as the
 * card used it, in an attack's mode, with its ammunition, a critical hit's if the attack was one.
 * @param {object} command
 * @param {ChatMessage} card
 * @param {object} stored   What the use kept on the card.
 * @param {Actor} actor
 * @returns {Promise<Roll[]|string|undefined>}   The rolls, or why not.
 */
async function dnd5eDamage(command, card, stored, actor) {
  const activity = cardActivity(card);
  if ( !activity ) return "gone";
  const ammunition = ammunitionOf(findMessage(command.use), actor)
    ?? (stored.ammunition ? actor.items.get(stored.ammunition) : null);
  const author = authorFor(actor);
  return withPlan(command, () => activity.rollDamage(
    { attackMode: stored.attackMode ?? undefined, ammunition: ammunition ?? undefined, isCritical: stored.critical,
      [ROLL_TAG]: command.id },
    { configure: false },
    {
      rollMode: PUBLIC,
      data: {
        author: author.id,
        flags: { dnd5e: { originatingMessage: card.id, targets: stored.targets }, [MODULE_ID]: { request: command.id } }
      }
    }
  ));
}

/**
 * Roll damage into the Midi-QOL workflow waiting for it, as Midi rolls it itself, so that the
 * workflow goes on to apply it. The targets go in the roll's message rather than as the
 * Gamemaster's; but an area's are the Gamemaster's again while Midi may take them from theirs.
 * @param {object} command
 * @param {ChatMessage} card
 * @param {object} stored   What the use kept on the card.
 * @returns {Promise<Roll[]|string|undefined>}   The rolls, or why not.
 */
async function midiDamage(command, card, stored) {
  const workflow = globalThis.MidiQOL?.Workflow?.getWorkflow(card.uuid);
  if ( !workflow ) return "gone";
  if ( !waitingForDamage(workflow) ) return "not-waiting";
  const roll = () => {
    workflow.workflowOptions.damageRollDSN = !document.hidden;
    return withPlan(command, () => workflow.activity.rollDamage(
      {
        workflow,
        ammunition: workflow.ammunition ?? undefined,
        midiOptions: {
          ...workflow.rollOptions,
          isCritical: workflow.isCritical,
          fastForwardDamage: true,
          workflowOptions: workflow.workflowOptions
        },
        [ROLL_TAG]: command.id
      },
      { configure: false },
      { create: false, data: { flags: { dnd5e: { targets: stored.targets } } } }
    ));
  };
  if ( !stored.area ) return roll();

  return midiQueued(async () => {
    if ( !waitingForDamage(workflow) ) return "not-waiting";
    const saved = currentTargets();
    setTargets(stored.tokenIds ?? []);
    try {
      const rolls = await roll();
      if ( rolls?.length ) await pastTargeting(workflow);
      return rolls;
    } finally {
      setTargets(saved);
    }
  });
}

/**
 * Is a Midi-QOL workflow waiting for its damage?
 * @param {Workflow} workflow
 * @returns {boolean}
 */
function waitingForDamage(workflow) {
  return workflow.suspended && (workflow.currentAction === workflow.WorkflowState_WaitForDamageRoll);
}

/**
 * Wait for a Midi-QOL workflow, its damage rolled, to go past where it may take an area's targets
 * from the Gamemaster's, for a minute at most: it may wait for the Gamemaster to confirm the damage.
 * @param {Workflow} workflow
 * @returns {Promise<void>}
 */
async function pastTargeting(workflow) {
  const until = Date.now() + TARGETS_HELD;
  while ( Date.now() < until ) {
    if ( workflow.aborted ) return;
    if ( !TAKING_TARGETS.some(state => workflow.currentAction === workflow[state]) ) return;
    await new Promise(resolve => setTimeout(resolve, CHECK_EVERY));
  }
}
