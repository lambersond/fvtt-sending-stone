import { MODULE_ID, ROLL_TAG, SETTINGS } from "./constants.mjs";
import {
  authorFor, checkCommand, describeResult, failedResult, findMessage, PUBLIC
} from "./command-rolls.mjs";
import { damageRollsFor, diceStatus, plannedDice, withPlan } from "./dice-plan.mjs";

/**
 * Making a player's attack from the Sending Stone app: using the item as in Foundry, spending what
 * it spends, then the attack, at the target the player picked, with the d20s they rolled; and once
 * they roll it, the attack's damage, on the same use, with their dice.
 *
 * Where Midi-QOL's activities make every use of an item a workflow, the attack goes through that
 * workflow, as if the player had attacked in Foundry: Midi checks the hit and, once the damage is
 * rolled, applies it, as the Gamemaster has it set up. Otherwise dnd5e's own cards are posted.
 * What would open a dialog on the Gamemaster's screen is refused beforehand, where it can be known.
 */

/**
 * How long a Midi-QOL attack may take to be rolled, in milliseconds, before it's given up on. Midi
 * waits on the Gamemaster when it asks them something, such as a target's reaction.
 * @type {number}
 */
const ATTACK_WITHIN = 300_000;

/**
 * How often a Midi-QOL workflow is looked at while its attack is being rolled, in milliseconds.
 * @type {number}
 */
const CHECK_EVERY = 100;

/**
 * The activations Midi-QOL counts as using a reaction.
 * @type {Set<string>}
 */
const REACTIONS = new Set(["reaction", "reactiondamage", "reactionmanual", "reactionpreattack"]);

/**
 * The latest Midi-QOL attack, which the next waits for: each sets the Gamemaster's targets.
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
 * Is this one of Midi-QOL's activities, each use of which is a workflow?
 * @param {Activity} activity
 * @returns {boolean}
 */
function isMidiActivity(activity) {
  return typeof activity?.setupTargets === "function";
}

/* -------------------------------------------- */
/*  Attacks                                     */
/* -------------------------------------------- */

/**
 * Make a player's attack for their character, if the campaign takes their attacks and the
 * character can make it now: use the item, then attack.
 * @param {object} command      The player's attack, as fetched from the app.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]   Aborted once the app has been told it took too long: an
 *                                         attack not yet begun then isn't made at all.
 * @returns {Promise<CommandResult>}
 */
export async function runAttackCommand(command, campaign, { signal }={}) {
  const refusal = commandRefusal(command, campaign);
  if ( refusal ) return failedResult(command, refusal.reason, refusal.error);
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failedResult(command, "unknown");
  const use = await prepareAttack(command, actor);
  if ( use.refusal ) return failedResult(command, use.refusal, use.error ?? null);
  if ( !isMidiActivity(use.activity) ) return dnd5eAttack(command, campaign, actor, use);
  if ( !midiIntegration() ) return failedResult(command, "midi-off");
  return midiAttack(command, campaign, actor, use, signal);
}

/**
 * Why an attack, or its damage, isn't to be made, before looking at the character.
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
 * What an attack needs, and whether it can be made, as dnd5e's usage dialog would have it used:
 * its default spell slot, its consumption, and the attack mode and ammunition last used.
 * @param {object} command
 * @param {Actor} actor
 * @returns {Promise<object>}   `{refusal, error}`, or what the attack is made with.
 */
async function prepareAttack(command, actor) {
  const item = actor.items.get(command.item);
  if ( !item || (item.system?.identified === false) || (item.system?.quantity === 0) ) return { refusal: "item" };
  const activity = item.system.activities?.get(command.activity);
  if ( (activity?.type !== "attack") || !activity.canUse ) return { refusal: "activity" };
  if ( activity.target?.template?.type ) return { refusal: "area" };

  const ammunition = defaultAmmunition(item, activity);
  if ( item.system.properties?.has?.("amm") && !ammunition ) return { refusal: "ammo" };
  // A choice of damage types would be asked of whoever rolls it.
  const choosing = damage => (damage?.types?.size ?? 0) > 1;
  const ammo = ammunition ? actor.items.get(ammunition) : null;
  if ( activity.damage?.parts?.some(choosing) || choosing(ammo?.system?.damage?.base) ) {
    return { refusal: "damage-type" };
  }

  let target = null;
  if ( command.target ) {
    target = targetOf(command.target);
    if ( !target ) return { refusal: "target" };
  }

  const slot = defaultSlot(activity);
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

  return { item, activity, target, usage, prepared, attackMode: defaultAttackMode(item, activity), ammunition };
}

/**
 * The spell slot a spell is cast with, as dnd5e's usage dialog picks it: its own level's, if any
 * are left; otherwise the first pool with any left, at or above its level, that its kind of
 * spellcasting may use. Nothing for a cantrip or a spell cast without slots.
 * @param {Activity} activity
 * @returns {string|null}
 */
export function defaultSlot(activity) {
  if ( !activity.requiresSpellSlot ) return null;
  const prepared = activity._prepareUsageConfig({});
  const configured = prepared.spell?.slot ?? null;
  if ( prepared.scaling === false ) return configured;
  const { actor, item } = activity;
  const spells = actor.system.spells ?? {};
  if ( spells[configured]?.value || !prepared.consume?.spellSlot ) return configured;
  const lowest = item.system.level ?? 1;
  const highest = Object.values(spells).reduce((max, pool) => pool.max ? Math.max(max, pool.level) : max, 0);
  const method = CONFIG.DND5E.spellcasting?.[item.system.method];
  for ( const [key, pool] of Object.entries(spells) ) {
    if ( !pool.max || (pool.level < lowest) || (pool.level > highest) || !pool.type ) continue;
    if ( method?.exclusive?.spells && (item.system.method !== pool.type) ) continue;
    if ( CONFIG.DND5E.spellcasting?.[pool.type]?.exclusive?.slots && (item.system.method !== pool.type) ) continue;
    if ( pool.value > 0 ) return key;
  }
  // None is left; the consumption check then says so.
  return configured;
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
 * The combatant an attack is made at, with its token and the token's actor.
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
 * A target as dnd5e describes it on an attack's card, as its own `getTargetDescriptors` would from
 * the Gamemaster's targets. Total cover leaves it no armor class to hit.
 * @param {{token: TokenDocument, actor: Actor}} target
 * @returns {{name: string, img: string, uuid: string, ac: number|null}}
 */
function targetDescriptor({ token, actor }) {
  const ac = actor.statuses?.has("coverTotal") ? null : (actor.system?.attributes?.ac?.value ?? null);
  return { name: token.name, img: actor.img, uuid: actor.uuid, ac };
}

/* -------------------------------------------- */

/**
 * Make an attack through dnd5e: use the item, posting its card, then roll the attack, linked to
 * the card, with the player's dice.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use   What `prepareAttack` found.
 * @returns {Promise<CommandResult>}
 */
async function dnd5eAttack(command, campaign, actor, use) {
  const { activity, target, usage, attackMode, ammunition } = use;
  const author = authorFor(actor);
  const targets = target ? [targetDescriptor(target)] : [];
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
  await storeAttack(card, {
    path: "dnd5e", attackMode: attackMode ?? null, ammunition: ammo?.id ?? null, critical, targets, preview
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
 * Keep what an attack's damage needs on its use's card, so that it can be rolled later, even
 * after the game is reloaded, and only once.
 * @param {ChatMessage} card
 * @param {object} attack
 * @returns {Promise<void>}
 */
async function storeAttack(card, attack) {
  await card.setFlag(MODULE_ID, "attack", attack);
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

/* -------------------------------------------- */
/*  Midi-QOL                                    */
/* -------------------------------------------- */

/**
 * Make an attack through Midi-QOL's workflow, one at a time: each sets the Gamemaster's targets
 * while it's rolled. An attack still waiting its turn when the app is told it took too long isn't
 * made at all.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use            What `prepareAttack` found.
 * @param {AbortSignal} [signal]
 * @returns {Promise<CommandResult>}
 */
function midiAttack(command, campaign, actor, use, signal) {
  const refusal = midiRefusal(use.activity, actor, use.target);
  if ( refusal ) return Promise.resolve(failedResult(command, refusal));
  const run = midiQueue.then(() => {
    if ( signal?.aborted ) return failedResult(command, "timeout");
    return midiAttackNow(command, campaign, actor, use);
  });
  midiQueue = run.catch(() => null);
  return run;
}

/**
 * Why Midi-QOL would stop to ask the Gamemaster something about this attack, or not make it, if
 * it would: Active Defence, which has the target roll instead; an activity that always opens Midi's
 * dialogs; a target that can't be targeted, or none where one is needed; or a reaction or bonus
 * action already used this round, where they're enforced.
 * @param {Activity} activity
 * @param {Actor} actor
 * @param {object|null} target   What `targetOf` found.
 * @returns {string|null}
 */
function midiRefusal(activity, actor, target) {
  const MidiQOL = globalThis.MidiQOL;
  if ( !MidiQOL?.Workflow ) return "midi";
  const settings = MidiQOL.configSettings?.() ?? {};
  if ( MidiQOL.checkRule?.("activeDefence") ) return "active-defence";
  const properties = activity.midiProperties ?? {};
  if ( (properties.forceRollDialog === "always") || (properties.forceConsumeDialog === "always") ) return "midi-dialog";

  if ( target ) {
    const token = target.token.object;
    if ( !token ) return "scene";
    if ( MidiQOL.isTargetable && !MidiQOL.isTargetable(token) ) return "target";
  }
  else if ( activity.target?.affects?.type ) {
    const rule = settings.requiresTargets;
    const needed = (rule === "always") || ((rule === "combat") && actor.inCombat)
      || ((rule === "tokens") && ((canvas?.scene?.tokens?.size ?? 0) > 0));
    if ( needed ) return "target";
  }

  if ( actor.inCombat ) {
    const enforced = setting => (settings[setting] === "all") || (settings[setting] === actor.type);
    const type = activity.effectiveActivationType ?? activity.activation?.type ?? "";
    const combat = game.combat;
    const ownTurn = combat?.combatant === combat?.getCombatantsByActor?.(actor)?.[0];
    const opportunity = !ownTurn && enforced("recordAOO") && (type !== "special");
    const reaction = (REACTIONS.has(type) && ((activity.activation?.cost ?? 1) > 0)) || opportunity;
    if ( reaction && enforced("enforceReactions") && MidiQOL.hasUsedReaction?.(actor) ) return "reaction";
    if ( (type === "bonus") && enforced("enforceBonusActions") && MidiQOL.hasUsedBonusAction?.(actor) ) {
      return "bonus-action";
    }
  }
  return null;
}

/**
 * Use the item through Midi-QOL, at the target the player picked, and wait for the attack its
 * workflow then rolls with the player's dice: until the workflow waits for damage, or ends.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use   What `prepareAttack` found.
 * @returns {Promise<CommandResult>}
 */
async function midiAttackNow(command, campaign, actor, use) {
  const { activity, target, usage, prepared, attackMode } = use;
  const token = target?.token.object ?? null;
  const targets = target ? [targetDescriptor(target)] : [];
  // Midi sets the Gamemaster's targets to the workflow's, and with none, takes theirs.
  const saved = Array.from(game.user.targets ?? []).map(t => t.id);
  setTargets(token ? [token.id] : []);
  try {
    const workflowOptions = {
      autoRollAttack: true,
      fastForwardAttack: true,
      autoFastAttack: true,
      autoRollDamage: "none",
      fastForwardDamage: true,
      targetConfirmation: "none",
      forceCompletion: true,
      autoConsumeResource: "both",
      attackMode,
      preSelectedTargetUuids: token ? [token.document.uuid] : [],
      // Dice So Nice holds Midi's workflow until a hidden tab is shown again.
      attackRollDSN: !document.hidden,
      damageRollDSN: !document.hidden,
      [ROLL_TAG]: command.id
    };
    const midiUsage = {
      ...usage,
      // Midi puts concentration off until its checks pass, then ends only what it's told to.
      ...(prepared.concentration ? { concentration: { begin: true, end: prepared.concentration.end ?? null } } : {}),
      midiOptions: { targetsToUse: new Set(token ? [token] : []), configureDialog: false, workflowOptions }
    };

    let card = null;
    let workflow = null;
    const state = await withPlan(command, async () => {
      const results = await activity.use(midiUsage, { configure: false }, {
        rollMode: PUBLIC,
        data: { flags: { [MODULE_ID]: { use: command.id } } }
      });
      card = results?.message ?? null;
      if ( !card ) return "aborted";
      workflow = midiUsage.workflow ?? globalThis.MidiQOL.Workflow.getWorkflow(card.uuid);
      if ( !workflow ) return "aborted";
      return attackRolled(workflow);
    });

    if ( (state === "aborted") || !card || !workflow ) return failedResult(command, "midi");
    if ( !workflow.attackRoll ) return failedResult(command, (state === "late") ? "timeout" : "no-attack");

    const critical = workflow.isCritical === true;
    const ammo = workflow.ammunition ?? null;
    const preview = (state === "waiting")
      ? previewDamage(workflow.activity, { attackMode: workflow.attackMode ?? attackMode, ammunition: ammo, isCritical: critical })
      : null;
    await storeAttack(card, {
      path: "midi", attackMode: workflow.attackMode ?? attackMode ?? null, ammunition: ammo?.id ?? null,
      critical, targets, preview
    });
    // As Midi shows players whether an attack hit.
    const settings = globalThis.MidiQOL.configSettings?.() ?? {};
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
 * Wait for a Midi-QOL workflow's attack: until the workflow waits for its damage, ends, or is
 * aborted, as it can be with no change of state, as for a weapon with no ammunition left.
 * @param {Workflow} workflow
 * @returns {Promise<"waiting"|"ended"|"aborted"|"late">}
 */
async function attackRolled(workflow) {
  const until = Date.now() + ATTACK_WITHIN;
  for ( ;; ) {
    if ( workflow.aborted || (workflow.currentAction === workflow.WorkflowState_Abort) ) return "aborted";
    if ( workflow.suspended && (workflow.currentAction === workflow.WorkflowState_WaitForDamageRoll) ) return "waiting";
    if ( [workflow.WorkflowState_Completed, workflow.WorkflowState_RollFinished, workflow.WorkflowState_Cleanup]
      .includes(workflow.currentAction) ) return "ended";
    if ( Date.now() >= until ) return "late";
    await new Promise(resolve => setTimeout(resolve, CHECK_EVERY));
  }
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
 * The dice an attack's damage will throw, worked out before it's rolled, for its player to roll
 * them in the app: as dnd5e will make up its rolls, for the attack mode and ammunition the attack
 * used, and with a critical hit's dice. dnd5e's own `getDamageConfig` is used, not Midi-QOL's,
 * which changes its workflow as it's called.
 * @param {Activity|null} activity
 * @param {object} config
 * @param {string} [config.attackMode]
 * @param {Item|null} [config.ammunition]
 * @param {boolean} config.isCritical
 * @returns {{critical: boolean, plannable: boolean, rolls: object[]}|null}   Null for no damage.
 */
export function previewDamage(activity, { attackMode, ammunition, isCritical }) {
  if ( !activity ) return null;
  const own = globalThis.dnd5e?.documents?.activity?.AttackActivity?.prototype?.getDamageConfig;
  const getDamageConfig = own ?? activity.getDamageConfig;
  const process = getDamageConfig.call(activity, { attackMode, ammunition: ammunition ?? undefined });
  if ( !process?.rolls?.length ) return null;
  const rolls = damageRollsFor({ ...process, isCritical });
  const planned = rolls.map(roll => plannedDice(roll));
  const plannable = planned.every(plan => plan.plannable);
  return {
    critical: isCritical,
    plannable,
    rolls: rolls.map((roll, index) => ({
      formula: roll.formula,
      type: damageLabel(roll.options.type),
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
 * Roll a player's attack's damage, with their dice, on the use the attack was made on: once, and
 * only with the dice the attack said it would throw.
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
  const stored = card?.flags?.[MODULE_ID]?.attack;
  if ( !card || !stored ) return failedResult(command, "gone");
  if ( card.getAssociatedActor?.()?.id !== actor.id ) return failedResult(command, "unknown");
  if ( card.flags[MODULE_ID].damage ) return failedResult(command, "damaged");
  if ( !stored.preview ) return failedResult(command, "not-waiting");
  if ( !matchesPreview(command.dice, stored.preview) ) return failedResult(command, "invalid", "dice");

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
 * Are these the dice an attack's damage throws, as its preview has them: the same dice, in order?
 * None, for damage that can't be planned or has no dice.
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
 * Roll damage through dnd5e, as its card's Damage button would: for the activity as the card used
 * it, in the attack's mode, with its ammunition, a critical hit's if the attack was one.
 * @param {object} command
 * @param {ChatMessage} card
 * @param {object} stored   What the attack kept on the card.
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
 * workflow goes on to apply it. The targets go in the roll's message rather than as the Gamemaster's,
 * which Midi would take.
 * @param {object} command
 * @param {ChatMessage} card
 * @param {object} stored   What the attack kept on the card.
 * @returns {Promise<Roll[]|string|undefined>}   The rolls, or why not.
 */
async function midiDamage(command, card, stored) {
  const workflow = globalThis.MidiQOL?.Workflow?.getWorkflow(card.uuid);
  if ( !workflow ) return "gone";
  const waiting = workflow.suspended && (workflow.currentAction === workflow.WorkflowState_WaitForDamageRoll);
  if ( !waiting ) return "not-waiting";
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
}
