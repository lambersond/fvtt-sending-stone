import { MODULE_ID, ROLL_TAG, SETTINGS } from "./constants.mjs";
import { cardTargetAcs } from "./chat-data.mjs";
import {
  appFlags, authorFor, checkCommand, describeResult, failedResult, findMessage, PUBLIC
} from "./command-rolls.mjs";
import {
  diceStatus, matchesDice, modifiedDice, readModifiers, takesAway, unmaximizable, withPlan
} from "./dice-plan.mjs";
import { dnd5eEnchant, enchantChoice, midiEnchantNow } from "./command-enchant.mjs";
import { resultsAlways } from "./config.mjs";
import { commandActor } from "./creatures.mjs";
import { midiPromptWaits } from "./midi-prompts.mjs";
import { DND5E_ACTIVITIES, ownDamageConfig, previewDamage } from "./sheet-links.mjs";
import { enchantInPlay } from "./sheet-enchant.mjs";
import {
  castCopy, castSpellOf, checkUsable, followUpCheck, forwardTarget, FORWARDED, freeCheck, offeredLevels, USES
} from "./sheet-rolls.mjs";
import { finite } from "./sheet-values.mjs";

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
 *
 * A spell an item casts, such as a staff's Silvery Barbs, is cast from the item by its Cast
 * activity: through the activity of the copy of the spell dnd5e keeps for it, as dnd5e's Cast
 * activity would cast it, which spends the item's uses rather than a spell slot; at the level the
 * player chose, where the Cast activity lets it be cast higher for more of them, as a wand of magic
 * missiles does.
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
export function midiActivities() {
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
 * takes them and the character can make it now: use the item, then, for an attack, attack, and for
 * an enchantment, apply it. Since 0.36.0 one of a companion of theirs, named by `of`, on its live
 * actor, as their character's player, what it found carried in the use as `character` and
 * `companion`.
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
  const found = commandActor(command, campaign);
  if ( !found ) return failedResult(command, "unknown");
  const { actor } = found;
  const use = await prepareUse(command, actor);
  if ( use.refusal ) return failedResult(command, use.refusal, use.error ?? null);
  use.character = found.character;
  use.companion = found.companion;
  if ( !isMidiActivity(use.activity) ) {
    if ( use.enchanting ) return dnd5eEnchant(command, campaign, actor, use);
    return use.attack ? dnd5eAttack(command, campaign, actor, use) : dnd5eUse(command, campaign, actor, use);
  }
  if ( !midiIntegration() ) return failedResult(command, "midi-off");
  return midiUse(command, campaign, actor, use, signal);
}

/**
 * Why a use, or its damage, or the end of an enchantment, isn't to be made, before looking at the
 * character.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {{reason: string, error?: string}|null}
 */
export function commandRefusal(command, campaign) {
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
 * targets they picked, and at its user too where they chose, counted among them, and with what it
 * consumes. A forward is used through the activity it names, spending what the forward spends
 * rather than that activity's own, and never a slot: at the level dnd5e casts it at by default,
 * whatever slot the player chose. An enchant activity is used with the profile and item the player
 * chose, as `enchantChoice` has them.
 * @param {object} command
 * @param {Actor} actor
 * @returns {Promise<object>}   `{refusal, error}`, or what the use is made with.
 */
async function prepareUse(command, actor) {
  const attack = command.kind === "attack";
  const named = actor.items.get(command.item);
  if ( !named || (named.system?.identified === false) || (named.system?.quantity === 0) ) return { refusal: "item" };
  const chosen = named.system.activities?.get(command.activity);
  const forward = (chosen?.type === "forward") ? chosen : null;
  // A spell cast from the item is cast through its copy's activity, as dnd5e's Cast activity casts it.
  const cast = forward ? forwardTarget(forward) : chosen;
  if ( forward && !forwardable(named, forward, cast) ) return { refusal: "activity" };
  const linked = (cast?.type === "cast") ? castSpellOf(cast) : null;
  if ( (cast?.type === "cast") && !linked ) return { refusal: "activity" };
  const item = linked?.spell ?? named;
  const activity = linked?.lead ?? cast;
  if ( !castable(item) ) return { refusal: "item" };
  const usable = attack ? (activity?.type === "attack") : USES.has(activity?.type);
  if ( !usable || !activity.canUse ) return { refusal: "activity" };
  // A legendary or mythic action its creature hasn't enough of its pool left for, as dnd5e would
  // refuse it, after warning the Gamemaster, or Midi-QOL would ask them in a dialog.
  const legendary = legendaryRefusal(activity, actor);
  if ( legendary ) return { refusal: legendary };
  if ( (activity.type === "check") && !checkUsedHere(item, activity) ) return { refusal: "activity" };
  // An enchant activity the sheet leaves to Foundry, as a magic item's template or a choice made
  // once, is used there alone, as only one the sheet offers is ended from here.
  if ( (activity.type === "enchant") && !enchantInPlay(activity) ) return { refusal: "activity" };
  // A spell an item casts is cast at a level its Cast activity offers, whether through the Cast
  // activity or through the spell's copy, as the spellbook casts it.
  const castBy = linked ? cast : ((castCopy(item) && !forward) ? (item.system.linkedActivity ?? null) : null);
  const level = castBy ? castLevel(command, castBy, item, activity) : null;
  if ( level?.refusal ) return level;
  // As dnd5e's Cast activity lets other modules know, or stop it, before anything is worked out,
  // with the level it's cast at: what they change of how it's used holds.
  const usage = level?.usage ?? {};
  if ( linked && (Hooks.call("dnd5e.preUseLinkedSpell", cast, usage, { configure: false }, {}) === false) ) {
    return { refusal: "cancelled" };
  }
  // An area attack is made at those the player picked in its area, rather than a template's.
  const area = Boolean(activity.target?.template?.type);
  if ( attack && !area && (command.targets !== undefined) && (command.targets !== null) ) return { refusal: "target" };

  // A forward is cast at the slot dnd5e works out with the forward as its cause, which it doesn't
  // spend, whatever slot the player chose: a free casting is never cast higher. A check called for
  // once its spell is cast is used at the level the player chose, spending none.
  const freeOf = forward ? forwardUsage(forward) : null;
  const unslotted = freeCheck(item, activity);
  const slot = forward ? (activity._prepareUsageConfig(freeOf).spell?.slot ?? null)
    : unslotted ? followUpSlot(command, activity)
    : castBy ? (usage.spell?.slot ?? defaultSlot(activity)) : slotFor(command, activity);
  if ( slot === false ) return { refusal: "slot" };
  const weapon = attack ? weaponChoices(command, item, activity) : {};
  if ( weapon.refusal ) return weapon;
  // An enchantment is used at no one, with the profile and item the player chose, as dnd5e's usage
  // dialog would have them chosen, at the level it's cast at; nothing else is used with one.
  const enchants = activity.type === "enchant";
  if ( !enchants && (command.enchant !== undefined) && (command.enchant !== null) ) {
    return { refusal: "invalid", error: "enchant" };
  }
  // Its user, where the player chose them beside those they picked (module 0.22.0); one used on its
  // user alone is used at them all the same, and an enchantment at no one.
  const self = (command.self === true) && (mostTargets(activity) > 0);
  if ( self && enchants ) return { refusal: "target" };
  const enchanting = enchants ? enchantChoice(command, actor, activity, scaledActivity(activity, slot)) : null;
  if ( enchanting?.refusal ) return enchanting;
  if ( enchanting ) usage.enchantmentProfile = enchanting.profile;

  const targets = self ? [{ ...selfTarget(actor), picked: { self: true } }] : [];
  for ( const picked of ((attack && !command.targets) ? [command.target] : (command.targets ?? [])) ) {
    if ( !picked ) continue;
    const target = targetOf(picked);
    if ( !target || targets.some(other => other.token?.id === target.token.id) ) return { refusal: "target" };
    targets.push({ ...target, picked: { combatId: picked.combatId, combatantId: picked.combatantId } });
  }
  // As many as it takes at the level it's cast at, as a spell may take more for each level higher,
  // its user among them.
  if ( (!attack || area) && (targets.length > mostTargets(scaledActivity(activity, slot))) ) {
    return { refusal: "target" };
  }

  Object.assign(usage, {
    create: { ...usage.create, measuredTemplate: false },
    subsequentActions: false,
    ...((slot && !forward) ? { spell: { ...usage.spell, slot } } : {}),
    ...(unslotted ? { consume: { ...usage.consume, spellSlot: false } } : {})
  });
  // What using it would spend, worked out without spending it, at the level dnd5e will scale it to
  // once it's used: anything it can't spend is said here, rather than on the Gamemaster's screen. A
  // forward's is what the forward spends, as dnd5e works it out with the forward as its cause.
  const prepared = activity._prepareUsageConfig(forward
    ? foundry.utils.mergeObject(freeOf, usage, { inplace: false })
    : usage);
  scaleAsUsed(prepared, activity);
  try {
    const updates = await activity._prepareUsageUpdates(prepared, { returnErrors: true });
    if ( Array.isArray(updates) && updates.length ) return { refusal: "consume", error: updates[0]?.message ?? null };
  } catch (err) {
    return { refusal: "consume", error: err instanceof Error ? err.message : String(err) };
  }

  return {
    attack, area, item, activity, targets, usage, prepared, attackMode: weapon.attackMode, ammunition: weapon.ammunition,
    cast: linked ? cast : null, forward, enchanting
  };
}

/**
 * Can a forward be used from the app, through the activity it names: one the app uses, not a Cast,
 * a summoning, a transformation or an enchantment, nor a spell's check called for once it's cast,
 * as `followUpCheck` has it, which a free casting would spend its use on for nothing; both of them
 * usable, as dnd5e requires of each as it uses it; and not one that lets the level be chosen, which
 * is left to Foundry. One the sheet leaves out as a repeat of another is used as any other.
 * @param {Item} item
 * @param {Activity} forward
 * @param {Activity|null} target   The activity it's used through, as `forwardTarget` finds it.
 * @returns {boolean}
 */
function forwardable(item, forward, target) {
  if ( !target || !FORWARDED.has(target.type) || followUpCheck(item, target) ) return false;
  if ( !forward.canUse || !target.canUse ) return false;
  return forward.consumption?.scaling?.allowed !== true;
}

/**
 * How dnd5e's forward has the activity it names used: with the forward as its cause, which spends
 * the forward's own consumption, and none of the activity's, nor a slot. The use's own usage is
 * merged into it.
 * @param {Activity} forward
 * @returns {object}
 */
function forwardUsage(forward) {
  return { cause: { activity: forward.relativeUUID }, consume: { resources: false, spellSlot: false } };
}

/**
 * Is a check activity used from the app: one made here, as `checkUsable` has it; and under
 * Midi-QOL, not one Midi has its user make at themselves, as for a check of their own tool, which
 * it would roll with Foundry's dice rather than the player's.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {boolean}
 */
function checkUsedHere(item, activity) {
  if ( !checkUsable(item, activity) ) return false;
  if ( !midiActivities() ) return true;
  const affects = activity.target?.affects?.type || "";
  return (affects !== "self") && !((item.type === "tool") && !affects);
}

/**
 * Can an item be cast: anything but a spell an item casts, which can be cast while the item's Cast
 * activity can be used, attuned to, if it must be, as dnd5e lists it in the spellbook only then.
 * @param {Item} item
 * @returns {boolean}
 */
function castable(item) {
  if ( !(item.getFlag?.("dnd5e", "cachedFor") ?? item.flags?.dnd5e?.cachedFor) ) return true;
  return item.system?.linkedActivity?.canUse !== false;
}

/**
 * Let other modules know a spell was cast from an item, as dnd5e's Cast activity does once it's
 * cast.
 * @param {object} use          What `prepareUse` found.
 * @param {object} [results]    What using the spell's activity came to.
 */
export function castFromItem(use, results) {
  if ( use.cast && results ) Hooks.callAll("dnd5e.postUseLinkedSpell", use.cast, use.usage, results);
}

/**
 * The level a spell an item casts is cast at, as dnd5e's usage dialog offers it for the item's Cast
 * activity: the one the player chose, as the slot of that level, if the dialog offers it, or is the
 * one the dialog would choose itself; otherwise the lowest it offers, never below the spell's own.
 * The use is then told the slot and how many levels above the spell's own that is, as the dialog
 * tells it; it spends the item's uses for it, scaled, not a slot. Where the dialog offers no choice,
 * as for a Cast activity that doesn't scale, or a cantrip, which has no slot, the use is told none.
 * @param {object} command
 * @param {Activity} cast       The item's Cast activity.
 * @param {Item} spell          The spell's copy.
 * @param {Activity} activity   Its activity used.
 * @returns {{usage: object}|{refusal: "slot"}}
 */
function castLevel(command, cast, spell, activity) {
  let offered;
  try {
    offered = offeredLevels(cast, { spell, lead: activity });
  } catch {
    offered = [];
  }
  const own = offered.length ? `spell${offered[0]}` : defaultSlot(activity);
  const slots = [...offered.map(level => `spell${level}`), own];
  if ( command.slot && !slots.includes(command.slot) ) return { refusal: "slot" };
  if ( !offered.length ) return { usage: {} };
  const slot = command.slot ?? own;
  const base = finite(spell.system?.level) ?? 0;
  return { usage: { spell: { slot }, scaling: Math.max(0, Number(slot.slice("spell".length)) - base) } };
}

/**
 * Scale how a use is worked out as dnd5e scales it once it's made, before it spends anything: by
 * the level of the spell slot it's cast with, above the spell's own, or a scroll's spell's fixed
 * level, so that what it spends is what dnd5e will spend, such as a wand's charges for a spell it
 * casts above its own level.
 * @param {object} config        As `_prepareUsageConfig` gave it, changed in place.
 * @param {Activity} activity
 */
function scaleAsUsed(config, activity) {
  const fixed = activity.item.getFlag?.("dnd5e", "spellLevel");
  if ( fixed ) config.scaling = Math.max(0, fixed.value - fixed.base);
  else if ( activity.isSpell ) {
    const level = activity.actor?.system.spells?.[config.spell?.slot]?.level;
    if ( level ) config.scaling = level - activity.item.system.level;
  }
}

/**
 * The spell slot a spell is cast with: the one the player chose, if dnd5e's usage dialog offers it
 * and it has one left; otherwise the dialog's own choice. A slot chosen for anything cast without
 * one, such as a spell cast at will, is left out: dnd5e would cast it at that slot's level without
 * spending it. A spell an item casts is cast at a level its Cast activity offers instead, as
 * `castLevel` has it.
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
 * The spell slot a leveled spell's check called for once it's cast, as `freeCheck` has it, is used
 * at: the one the player chose, if dnd5e's usage dialog offers it, whether any is left or not, since
 * none is spent, as a player in Foundry unticking the slot still has it used at the level they
 * chose, which its card names and its targets may scale with; otherwise none, so that dnd5e uses it
 * at the spell's own level, as by default. Of a spell an item casts, none: it's used at the level
 * the item's Cast activity casts it at.
 * @param {object} command
 * @param {Activity} activity
 * @returns {string|null|false}   False when the chosen slot isn't one the dialog offers.
 */
function followUpSlot(command, activity) {
  const slots = eligibleSlots(activity);
  if ( !command.slot || !slots ) return null;
  return slots.some(slot => slot.key === command.slot) ? command.slot : false;
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
 * The character as a target of their own use: by their token, their combatant's in the combat the
 * Gamemaster has up, else their own on the scene the Gamemaster views; else by no token, the actor
 * alone, which the card names all the same, but Midi-QOL can't target. Since 0.36.0 a token's
 * creature, as a companion's, is its own token, and its own combatant, by its token and scene,
 * wherever the Gamemaster's canvas is.
 * @param {Actor} actor
 * @returns {{combatant: Combatant|null, token: TokenDocument|null, actor: Actor}}
 */
function selfTarget(actor) {
  if ( actor.isToken && actor.token ) {
    const { token } = actor;
    const combatant = game.combat?.combatants?.find?.(each => (each.tokenId === token.id)
      && (each.sceneId === token.parent?.id)) ?? null;
    return { combatant, token, actor };
  }
  const combatant = game.combat?.combatants?.find?.(each => (each.actor?.id ?? each.actorId) === actor.id) ?? null;
  const token = combatant?.token ?? actor.getActiveTokens?.(true, true)?.[0] ?? null;
  return { combatant, token, actor: token?.actor ?? actor };
}

/**
 * Why a legendary or mythic action can't be used now, if it can't, as dnd5e's own test has it:
 * where its kind of activation spends a pool of the creature's, as a legendary action spends its
 * legendary actions, the creature has that pool, and nothing it consumes already spends it, the use
 * is refused with none left, even for one that costs none, or with fewer left than it costs, a cost
 * of none counted as none. dnd5e would abort the use after warning the Gamemaster; under Midi-QOL a
 * consumption that fails opens a usage dialog on their screen.
 * @param {Activity} activity
 * @param {Actor} actor
 * @returns {"legendary"|null}
 */
export function legendaryRefusal(activity, actor) {
  const consume = CONFIG.DND5E?.activityActivationTypes?.[activity.activation?.type]?.consume;
  const property = consume?.property;
  if ( !property || (consume.canConsume?.(activity) === false) ) return null;
  const current = foundry.utils.getProperty(actor.system ?? {}, property);
  if ( !current || !Number.isFinite(current.value) ) return null;
  const spends = Array.from(activity.consumption?.targets ?? [])
    .some(target => (target.type === "attribute") && (target.target === `${property}.value`));
  if ( spends ) return null;
  const count = Number(activity.activation?.value ?? 1);
  return ((current.value < 1) || (count > current.value)) ? "legendary" : null;
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
  const author = authorFor(actor, use.character);
  const targets = use.targets.map(targetDescriptor);
  // A forward has the activity it names used, as dnd5e's forward does; the attack is that activity's.
  const results = await (use.forward ?? activity).use(usage, { configure: false }, {
    rollMode: PUBLIC,
    data: { author: author.id, flags: { dnd5e: { targets }, [MODULE_ID]: appFlags(command, "use") } }
  });
  castFromItem(use, results);
  const card = results?.message;
  if ( !card ) return failedResult(command, "cancelled");

  const rolls = await withPlan(command, () => activity.rollAttack(
    {
      attackMode,
      ammunition,
      // The target's armor class, or none, rather than the Gamemaster's own target's; none for an
      // area's targets, as dnd5e gives none for more than one.
      target: (targets.length === 1) ? targets[0].ac : null,
      rolls: [{ options: { [ROLL_TAG]: command.id } }]
    },
    { configure: false },
    {
      rollMode: PUBLIC,
      data: {
        author: author.id,
        flags: { dnd5e: { originatingMessage: card.id, targets }, [MODULE_ID]: appFlags(command) }
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
    preview, actor: actor.uuid
  });
  // As dnd5e shows players on the card whether an attack hit each target, if the world lets it, or
  // since 0.31.0 the Gamemaster has players told always.
  const shown = targets.length && ((game.settings.get("dnd5e", "attackRollVisibility") !== "none") || resultsAlways());
  return attackResult(command, message, use.character ?? actor, campaign, rolls, {
    critical,
    fumble: roll.isFumble === true,
    ...hits(use, (target, index) => (shown ? outcomeOf(roll, targets[index]) : null))
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
  const author = authorFor(actor, use.character);
  const targets = cardTargets(use, actor);
  // A forward has the activity it names used, as dnd5e's forward does: the card is that activity's.
  const results = await (use.forward ?? activity).use(usage, { configure: false }, {
    rollMode: PUBLIC,
    data: { author: author.id, flags: { dnd5e: { targets }, [MODULE_ID]: appFlags(command, "use") } }
  });
  castFromItem(use, results);
  const card = results?.message;
  if ( !card ) return failedResult(command, "cancelled");

  const preview = previewDamage(cardActivity(card), { isCritical: false });
  await storeUse(card, {
    path: "dnd5e", type: activity.type, attackMode: null, ammunition: null, critical: false, targets, preview,
    actor: actor.uuid
  });
  return useResult(command, card, use.character ?? actor, campaign, activity, preview);
}

/**
 * Whether an attack hit, as the app is told: at its target, if it has one; and for an area attack,
 * at each target in the order the player picked them, there being no one outcome for several.
 * @param {object} use                                What `prepareUse` found.
 * @param {(target: object, index: number) => ("hit"|"miss"|null)} outcome   A target's, or null
 *   where its player isn't to know.
 * @returns {{outcome: string|null, targets?: object[]}}
 */
function hits(use, outcome) {
  const targets = use.targets.map((target, index) => ({ ...target.picked, outcome: outcome(target, index) }));
  return {
    outcome: (targets.length === 1) ? targets[0].outcome : null,
    ...(use.area && { targets })
  };
}

/**
 * Whether an attack hit its target, as dnd5e's card shows it: a critical hit always does; a
 * fumble, or a total under the target's armor class, misses. A target under total cover can't be
 * hit, as Midi-QOL has it. Since 0.29.0 so it's read for each target of dnd5e's attack in chat.
 * @param {Roll} roll
 * @param {{ac: number|null}} target
 * @returns {"hit"|"miss"}
 */
export function outcomeOf(roll, { ac }) {
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
 * is reloaded, and only once. Since 0.36.0 with the uuid of the actor that used it, `actor`, so that
 * its damage is its own, whatever the card's speaker names: two tokens of one actor share its id.
 * @param {ChatMessage} card
 * @param {object} use   How it was made: `{path, type, attackMode, ammunition, critical, targets,
 *                       preview, actor}`, and on Midi-QOL's, the targets' `tokenIds` and whether
 *                       it's an `area`'s.
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
 * @param {object} attack          Whether it was a critical hit or a fumble, and hit its target, or
 *                                 each of an area's.
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
    return use.enchanting ? midiEnchantNow(command, campaign, actor, use) : midiUseNow(command, campaign, actor, use);
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
 * would: Active Defence, which has an attack's target roll instead; an area attack whose targets
 * Midi picks itself; an activity that always opens Midi's dialogs, asks which of its effects to
 * apply, or prompts for its roll; a target that can't be targeted; a target the Gamemaster's canvas
 * doesn't draw, unless they allow it, though never its user; none Midi can target where one is
 * needed; or a reaction or bonus action already used this round, where they're enforced.
 * @param {object} use   What `prepareUse` found.
 * @param {Actor} actor
 * @returns {string|null}
 */
function midiRefusal({ activity, targets, attack, area }, actor) {
  const MidiQOL = globalThis.MidiQOL;
  if ( !MidiQOL?.Workflow ) return "midi";
  const settings = MidiQOL.configSettings?.() ?? {};
  if ( attack && MidiQOL.checkRule?.("activeDefence") ) return "active-defence";
  if ( attack && area && midiPicksTargets(activity, settings) ) return "area";
  const properties = activity.midiProperties ?? {};
  const always = (properties.forceRollDialog === "always") || (properties.forceConsumeDialog === "always")
    || ((properties.forceDamageDialog === "always") && rollsDamage(activity));
  const prompts = (activity.type === "utility") && activity.roll?.formula && activity.roll?.prompt;
  if ( always || properties.chooseEffects || prompts ) return "midi-dialog";

  // Midi targets only tokens the Gamemaster's canvas draws: those on the level and scene they view.
  // Its user with none drawn, or none at all, as out of a fight in the theatre of the mind, is named
  // on the card alone and the use made at the others, or at no one, as before a player could pick
  // themselves: refused only where Midi needs a target anyway, below.
  const drawn = targets.filter(target => target.token?.object);
  const unseen = targets.filter(target => !target.token?.object && !target.picked?.self);
  if ( unseen.length && !offCanvasTargets() ) return "scene";
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
 * Does Midi-QOL pick an area's targets itself, as it uses the activity, in place of the player's:
 * an area around its user, which Midi places and targets those in, unless it's told not to target
 * them, or one with no template, whose user's surroundings it targets.
 * @param {Activity} activity
 * @param {object} settings   Midi's settings.
 * @returns {boolean}
 */
function midiPicksTargets(activity, settings) {
  const type = activity.target?.template?.type;
  if ( type === "emanationNoTemplate" ) return true;
  const placed = ["self", undefined].includes(activity.range?.units) && ["radius", "squareRadius"].includes(type);
  const action = activity.midiProperties?.autoTargetAction;
  return placed && (((!action || (action === "default")) ? (settings.autoTarget ?? "none") : action) !== "none");
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
  return CREATURES.has(affects) || (activity.type === "attack") || rollsDamage(activity) || (activity.type === "save")
    || (activity.type === "check");
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
 * damage or healing, or ends; or, with no attack, damage or healing, until it waits on the app for
 * a target's save asked there, since 0.27.0.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use   What `prepareUse` found.
 * @returns {Promise<CommandResult>}
 */
async function midiUseNow(command, campaign, actor, use) {
  const { activity, usage, prepared, attackMode, ammunition, attack } = use;
  // Where Midi averages this creature's damage, it rolls it itself, as a utility's roll: nothing of
  // its damage waits for the player's dice, so its target never takes it twice.
  const averaged = midiAverages(actor);
  // Midi works on the targets the Gamemaster's canvas draws; any other, where they allow it, and its
  // user with no token drawn, is only named on the card, for them to apply what it does.
  const tokens = use.targets.map(target => target.token?.object).filter(Boolean);
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
      // The damage waits for the player's dice; a utility's own roll is Midi's, and damage Midi averages.
      autoRollDamage: (rollsFormula(activity) || averaged) ? "always" : "none",
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
    // A forward has the activity it names used as dnd5e's forward has it used, made here rather than
    // through Midi-QOL's own forward, whose source isn't to be had: so that what Midi writes the
    // workflow on is what's given.
    const midiCall = use.forward
      ? foundry.utils.mergeObject(forwardUsage(use.forward), midiUsage, { inplace: false })
      : midiUsage;

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
      const using = activity.use(midiCall, { configure: false }, {
        rollMode: PUBLIC,
        data: { flags: { [MODULE_ID]: appFlags(command, "use") } }
      }).finally(() => Hooks.off("dnd5e.preCreateUsageMessage", nameAll));
      // A use with nothing more of the player's to roll that has its workflow wait on a save asked in
      // the app is made: the rest goes on without holding the uses after it.
      const asking = (!attack && !rollsDamage(activity)) ? await askingSaves(using, midiCall) : null;
      if ( asking ) {
        using.then(results => castFromItem(use, results)).catch(err => {
          console.error(`${MODULE_ID} | Midi-QOL's use of ${activity.item?.name} from Sending Stone failed`, err);
        });
        workflow = asking;
        card = workflow.chatCard ?? null;
        return card ? "saves" : "aborted";
      }
      const results = await using;
      castFromItem(use, results);
      card = results?.message ?? null;
      if ( !card ) return "aborted";
      workflow = midiCall.workflow ?? globalThis.MidiQOL.Workflow.getWorkflow(card.uuid);
      if ( !workflow ) return "aborted";
      return workflowSettled(workflow);
    });

    if ( (state === "aborted") || !card || !workflow ) return failedResult(command, "midi");
    if ( attack && !workflow.attackRoll ) return failedResult(command, (state === "late") ? "timeout" : "no-attack");

    const critical = attack && (workflow.isCritical === true);
    const ammo = attack ? (workflow.ammunition ?? null) : null;
    const mode = attack ? (workflow.attackMode ?? attackMode ?? null) : null;
    const preview = ((state === "waiting") && !averaged)
      ? previewDamage(workflow.activity, { attackMode: mode ?? undefined, ammunition: ammo, isCritical: critical })
      : null;
    await storeUse(card, {
      path: "midi", type: activity.type, attackMode: mode, ammunition: ammo?.id ?? null, critical, targets,
      tokenIds: tokens.map(token => token.id), area: Boolean(activity.target?.template?.type), preview,
      actor: actor.uuid
    });
    if ( !attack ) return useResult(command, card, use.character ?? actor, campaign, activity, preview);

    // As Midi shows players whether an attack hit each target: only those the Gamemaster's canvas
    // draws, which Midi checks. Since 0.31.0, with players told always, whatever Midi whispers; and
    // where it checks none, each target by the armor class it writes on its card, as chat has it.
    const settings = globalThis.MidiQOL.configSettings?.() ?? {};
    const always = resultsAlways();
    const shown = (tokens.length > 0) && (always || ((settings.autoCheckHit === "all") && !workflow.whisperAttackCard));
    const acs = (always && (settings.autoCheckHit === "none")) ? cardTargetAcs(card) : null;
    const outcome = target => {
      if ( acs ) {
        const uuid = target.token?.actor?.uuid;
        return acs.has(uuid) ? outcomeOf(workflow.attackRoll, { ac: acs.get(uuid) }) : null;
      }
      const token = target.token?.object;
      if ( !shown || !token ) return null;
      return (workflow.hitTargets?.has(token) || workflow.hitTargetsEC?.has(token)) ? "hit" : "miss";
    };
    // Midi writes its card after its rolls, so they're taken from the workflow.
    return attackResult(command, card, use.character ?? actor, campaign, [workflow.attackRoll], {
      critical,
      fumble: workflow.isFumble === true,
      ...hits(use, outcome)
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
 * Does Midi-QOL roll this actor's damage itself, at its average, as its Average Damage setting has
 * it for every actor, or for actors of its type, such as NPCs, every companion among them? It reads
 * that before what a use asks of its workflow.
 * @param {Actor} actor
 * @returns {boolean}
 */
function midiAverages(actor) {
  const average = globalThis.MidiQOL?.configSettings?.()?.averageDamage;
  return (average === "all") || ((typeof average === "string") && (average === actor?.type));
}

/**
 * Wait for a Midi-QOL workflow to settle: until it waits for its damage, ends, or is aborted, as it
 * can be with no change of state, as for a weapon with no ammunition left. One waiting for a
 * template to be placed goes on without one: its targets are the player's.
 * @param {Workflow} workflow
 * @returns {Promise<"waiting"|"ended"|"aborted"|"late">}
 */
export async function workflowSettled(workflow) {
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
 * Wait for a Midi-QOL use to return, or for its workflow to wait on the app for a save it asked
 * there, whichever is first. Midi's use returns once its workflow waits for its damage or ends:
 * through its targets' saves, where it has no damage to wait for; and a save asked in the app may
 * wait a minute, every Midi use from the app waiting behind this one meanwhile. Its targets are
 * the workflow's by then.
 * @param {Promise<object>} using   The use.
 * @param {object} usage            What it's used with, on which Midi puts its workflow.
 * @returns {Promise<Workflow|null>}   The workflow, waiting on the app; or null, the use returned.
 */
async function askingSaves(using, usage) {
  let returned = false;
  const used = using.then(() => { returned = true; }, () => { returned = true; });
  while ( !returned ) {
    if ( midiPromptWaits(usage.workflow) ) return usage.workflow;
    await Promise.race([used, new Promise(resolve => setTimeout(resolve, CHECK_EVERY))]);
  }
  return null;
}

/**
 * The Gamemaster's targets.
 * @returns {string[]}   Tokens' ids.
 */
export function currentTargets() {
  return Array.from(game.user.targets ?? []).map(token => token.id);
}

/**
 * Set the Gamemaster's targets, as Midi-QOL does.
 * @param {string[]} ids   Tokens' ids, on the scene the Gamemaster is viewing.
 */
export function setTargets(ids) {
  if ( typeof canvas?.tokens?.setTargets === "function" ) canvas.tokens.setTargets(ids);
  else game.user?.updateTokenTargets?.(ids);
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * Roll a player's damage or healing, with their dice, on the use it follows: once, only with the
 * dice the use said it would throw, changed as they chose, and at its highest only where it takes
 * no die away and has no die Foundry would roll again, as one that explodes, and as the kinds of
 * damage they chose.
 * Damage that, once built and changed, can't take every die they rolled, as where a die more was
 * chosen of a part whose only dice are its critical damage's, or a module changed it since its
 * preview, is refused as the dice not its own, and nothing is rolled, so they may roll it again.
 * Since 0.36.0 a companion's, named by `of`, on its own use alone: by the actor the use kept, two
 * tokens of one actor sharing its id; a card from before, by its speaker's actor, as before.
 * @param {object} command      The player's damage, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runDamageCommand(command, campaign) {
  const refusal = commandRefusal(command, campaign);
  if ( refusal ) return failedResult(command, refusal.reason, refusal.error);
  const found = commandActor(command, campaign);
  if ( !found ) return failedResult(command, "unknown");
  const { actor, character } = found;
  const card = game.messages.contents.findLast(message => message.flags?.[MODULE_ID]?.use === command.use);
  const flags = card?.flags?.[MODULE_ID];
  // Module 0.11.0 kept an attack's as `attack`.
  const stored = flags?.usage ?? flags?.attack;
  if ( !card || !stored ) return failedResult(command, "gone");
  if ( stored.actor ? (stored.actor !== actor.uuid) : (card.getAssociatedActor?.()?.id !== actor.id) ) {
    return failedResult(command, "unknown");
  }
  if ( flags.damage ) return failedResult(command, "damaged");
  if ( !stored.preview ) return failedResult(command, "not-waiting");
  const modifiers = readModifiers(command.modifiers);
  if ( modifiers === null ) return failedResult(command, "invalid", "modifiers");
  // At its highest, damage that takes a die away would take the most away, and a die Foundry rolls
  // again, as one that explodes, wouldn't be at its highest.
  const formulas = stored.preview.rolls.map(roll => roll.formula);
  if ( modifiers?.maximize && (takesAway(stored.preview) || unmaximizable(formulas)) ) {
    return failedResult(command, "invalid", "modifiers");
  }
  const expected = modifiedDice(stored.preview, modifiers);
  if ( !expected || !matchesDice(command.dice, expected) ) return failedResult(command, "invalid", "dice");
  if ( !offersTypes(command.types, stored.preview) ) return failedResult(command, "type");

  const made = { plan: null };
  const rolls = (stored.path === "midi")
    ? await midiDamage(command, card, stored, made)
    : await dnd5eDamage(command, card, stored, actor, made, character);
  if ( typeof rolls === "string" ) return failedResult(command, rolls);
  if ( !rolls?.length ) {
    return (made.plan?.refusal === "dice") ? failedResult(command, "invalid", "dice") : failedResult(command, "cancelled");
  }
  await card.setFlag(MODULE_ID, "damage", command.id);
  // Midi-QOL rolls damage onto its card; dnd5e posts it on its own.
  return describeResult(command, rolls[0].parent ?? card, character, campaign, { rolls });
}

/**
 * Is each kind of damage the player chose, by roll, one that roll offers? A roll they chose none
 * for is rolled as dnd5e would, as the kind last rolled.
 * @param {(string|null)[]|undefined} types
 * @param {object} preview
 * @returns {boolean}
 */
export function offersTypes(types, preview) {
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
 * @param {{plan: DicePlan|null}} made   Given the roll's plan, for why it was called off, if it was.
 * @param {Actor} [character]   Whose player rolls it.
 * @returns {Promise<Roll[]|string|undefined>}   The rolls, or why not.
 */
async function dnd5eDamage(command, card, stored, actor, made, character=actor) {
  const activity = cardActivity(card);
  if ( !activity ) return "gone";
  const ammunition = ammunitionOf(findMessage(command.use), actor)
    ?? (stored.ammunition ? actor.items.get(stored.ammunition) : null);
  const author = authorFor(actor, character);
  return withPlan(command, plan => {
    made.plan = plan;
    return activity.rollDamage(
      { attackMode: stored.attackMode ?? undefined, ammunition: ammunition ?? undefined, isCritical: stored.critical,
        [ROLL_TAG]: command.id },
      { configure: false },
      {
        rollMode: PUBLIC,
        data: {
          author: author.id,
          flags: { dnd5e: { originatingMessage: card.id, targets: stored.targets }, [MODULE_ID]: appFlags(command) }
        }
      }
    );
  });
}

/**
 * Roll damage into the Midi-QOL workflow waiting for it, as Midi rolls it itself, so that the
 * workflow goes on to apply it. The targets go in the roll's message rather than as the
 * Gamemaster's; but an area's are the Gamemaster's again while Midi may take them from theirs.
 * @param {object} command
 * @param {ChatMessage} card
 * @param {object} stored   What the use kept on the card.
 * @param {{plan: DicePlan|null}} made   Given the roll's plan, for why it was called off, if it was.
 * @returns {Promise<Roll[]|string|undefined>}   The rolls, or why not.
 */
async function midiDamage(command, card, stored, made) {
  const workflow = globalThis.MidiQOL?.Workflow?.getWorkflow(card.uuid);
  if ( !workflow ) return "gone";
  if ( !waitingForDamage(workflow) ) return "not-waiting";
  const roll = () => {
    workflow.workflowOptions.damageRollDSN = !document.hidden;
    return withPlan(command, plan => {
      made.plan = plan;
      return workflow.activity.rollDamage(
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
      );
    });
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
