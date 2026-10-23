// A stand-in for Midi-QOL 14's workflow, as far as players' attacks, spells and features from the
// app meet it, modelled on Midi-QOL's v14 source: its activities' use and
// setupTargets (MidiActivityMixin.ts:697-910, 1538-1600), preChatChecks' target rules (1795-1860),
// its attack activity's rollAttack with a workflow (AttackActivity.ts:358-600), its rollDamage and
// getDamageConfig (MidiActivityMixin.ts:979-1110, 1255-1295), and the workflow's states from Start
// to Completed (Workflow.ts:1990-2420). It reproduces what the module must cope with: use()
// resolving before the attack is rolled, the Gamemaster's targets rewritten and read again (for an
// area once its damage is rolled, and when its saving throws are, unless told not to), a workflow
// waiting for a template, an abort with no change of state, the card deleted on abort, the card's
// rolls written late, getDamageConfig's side effects, the damage dialog forced for a choice of
// types, deferred concentration and placeable hit targets. Its rolls are tagged as Midi tags them
// (Workflow.ts:7590-7760) and written on its card as displayDamageRolls writes them, every roll in
// chatRolls' order, through an update of the card (module 0.28.0). It can't stand for Midi itself.
// Install it before the module is imported.

import {
  AttackActivity, CheckActivity, DamageActivity, ForwardActivity, HealActivity, SaveActivity, SummonActivity, UtilityActivity,
  activityTypes, screen,
} from './activity5e.mjs'

export const midi = {
  settings: {
    autoCheckHit: 'all',
    autoTarget: 'none',
    requiresTargets: 'none',
    enforceReactions: 'none',
    enforceBonusActions: 'none',
    recordAOO: 'none',
    gmAutoAttack: false,
    gmAutoDamage: 'none',
    averageDamage: 'none',
    // Module 0.30.0 reads these to tell what Midi shows players (the 0.30.0 contract §3.6, §3.9): at Midi's
    // own defaults (MQX settings:117, 182-185, 204, 209-210), which a world keeps unless changed.
    highlightSuccess: true,
    highLightCriticalAttackOnly: false,
    gmAttackDisplay: 'full',
    gmDamageDisplay: 'full',
    mergeCardMultiDamage: false,
    addFakeDice: false,
  },
  activeDefence: false,
  usedReaction: new Set(),
  usedBonus: new Set(),
  /** Abort the next attack without a change of state, as Midi does for a weapon with no ammunition. */
  abortNext: false,
  /** Hold the next attack this long, in milliseconds, as a prompt to the Gamemaster would; or for ever. */
  holdNext: 0,
  /** Every workflow made, in order. */
  made: [],
  /** The usage each of Midi's activities was used with, as given, in order: { activity, usage }. */
  usages: [],
  /** Damage applied: { target, amount }. */
  applied: [],
  /** Healing applied: { target, amount }. */
  healed: [],
  /** Each target's saving throw, by token id: true for a success. A target not named fails. */
  saves: new Map(),
  /** Saving throws rolled: { target, ability, dc, success }. */
  rolledSaves: [],
  /** Each target's check, by token id: true for a success. A target not named fails. */
  checks: new Map(),
  /** Checks rolled, as below: { target, rollType, keys, dc, success }. */
  rolledChecks: [],
  /** Effects applied: { target, effect }. */
  effects: [],
  /**
   * Damage a bonus macro adds to each workflow's damage, as Sneak Attack's: [{ formula, type, flavor? }
   * or { roll }], or none. Made as rollBonusDamage makes a macro's (Workflow.ts:4066-4098), its
   * flavor the type where the macro names none; `roll` makes a Roll of the macro's own, which Midi
   * keeps as it is, so that a plain Roll stays a plain Roll (4073-4074, 7697-7718).
   */
  bonusDamage: null,
  /** Other damage each workflow rolls with its damage, as a poisoned blade's on a failed save: [{ formula, type }], or none. */
  otherDamage: null,
  /**
   * The ammunition each attack activity last fired in a workflow, by its uuid, as Midi keeps it on the
   * activity (AttackActivity.ts:535-536, 576) and adds to its damage rolled after (:268-279), module
   * 0.36.0's damage on its own among them.
   */
  ammunition: new Map(),
}

/**
 * MidiActivityMixin.ts:1297-1320 (getDamageRollModifiers): the damage roll modifiers the actor's
 * effects give a roll, `flags.midi-qol.rollModifiers.damage.<action or item type>.<damage type>`, by
 * priority.
 * @param {Activity} activity
 * @param {object} roll   A roll's configuration.
 * @returns {string[]}
 */
function damageRollModifiers(activity, roll) {
  const actionType = activity.actionType ?? activity.getActionType?.()
  const itemType = activity.item?.type
  const types = roll.options?.types ?? []
  const changes = []
  for (const effect of activity.actor?.allApplicableEffects?.() ?? []) {
    if (effect.disabled || effect.isSuppressed) continue
    for (const change of effect.system?.changes ?? []) {
      if (change.key.startsWith('flags.midi-qol.rollModifiers.damage.')) changes.push(change)
    }
  }
  changes.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  return changes.filter(change => {
    const [, , , , actionOrItem, damageType] = change.key.split('.')
    return ['all', actionType, itemType].includes(actionOrItem) && ((damageType === 'all') || types.includes(damageType))
  }).map(change => change.value)
}

/**
 * patching.ts:1198-1208, 1347 (applyDamageModifiers, from Midi's configureDamage wrapper): a
 * roll's Midi modifiers added to each of its dice. Install it once the module's scripts are loaded
 * and before it sets up its dice plans, as midi-critical.mjs is.
 * @param {typeof Roll} DamageRoll   dnd5e's.
 */
export function installMidiDamageModifiers(DamageRoll) {
  const configure = DamageRoll.prototype.configureDamage
  DamageRoll.prototype.configureDamage = function (...args) {
    const modifiers = this.options?.['midi-qol']?.modifiers ?? []
    if (modifiers.length && !this.options['midi-qol'].applied) {
      for (const term of this.terms) {
        if (term instanceof foundry.dice.terms.DiceTerm) term.modifiers = [...(term.modifiers ?? []), ...modifiers]
      }
      this.options['midi-qol'].applied = true
      this.resetFormula?.()
    }
    return configure.apply(this, args)
  }
}

/** Midi's tag on a roll it keeps, which message.rolls keeps with it (Workflow.ts:293-296). */
const tag = (roll, rollType) => foundry.utils.setProperty(roll, 'options.midi-qol.rollType', rollType)

/** Damage of Midi's own making, a macro's bonus or an item's other damage, rolled as a DamageRoll. */
const damageRolls = (activity, entries, options) => Promise.all(entries.map(entry =>
  new CONFIG.Dice.DamageRoll(entry.formula, activity.getRollData(), options(entry)).evaluate()))

/** The token placeables on the Gamemaster's canvas, by id. */
export const placeables = new Map()

function setTargets(ids) {
  game.user.targets = new Set(ids.map(id => placeables.get(id)).filter(Boolean))
}

/** utils.ts:9543-9545 */
const hasArea = activity => !!activity.target?.template?.type

class Workflow {
  static workflows = new Map()
  static getWorkflow(id) { return Workflow.workflows.get(id) }
  static addWorkflow(workflow) { Workflow.workflows.set(workflow.id, workflow) }
  static removeWorkflow(id) { Workflow.workflows.delete(id) }

  constructor(actor, activity, { workflowOptions = {} } = {}) {
    Object.assign(this, { actor, activity, id: activity.uuid })
    this.rollOptions = {}
    this.workflowOptions = {
      autoRollAttack: midi.settings.gmAutoAttack,
      autoRollDamage: midi.settings.gmAutoDamage,
      ...workflowOptions,
    }
    this.targets = new Set()
    this.hitTargets = new Set()
    this.hitTargetsEC = new Set()
    this.failedSaves = new Set()
    this.saves = new Set()
    this.suspended = false
    this.currentAction = null
    this.aborted = false
    this.damageRollCount = 0
    this.isCritical = false
    this.isFumble = false
    this.attackRoll = null
    this.damageRolls = null
    this.bonusDamageRolls = null
    this.otherDamageRolls = null
    this.utilityRolls = null
    // Workflow.ts:1395: draws the card's own damage as its other damage (4691-4704, 4736-4741),
    // and is never set in the source to hand; a harness may set it, to show it changes no roll.
    this.useOther = undefined
    this.whisperAttackCard = false
    this.chatCard = null
    this.itemUseComplete = false
    this.deferredConcentration = null
    // Workflow.ts:1541-1545: an area without a template placed for it waits for one.
    this.needTemplate = hasArea(activity)
    midi.made.push(this)
  }

  setTargets(targets) { this.targets = new Set(targets) }

  /** Workflow.ts:7590-7596 */
  setAttackRoll(roll) {
    this.attackRoll = roll
    tag(roll, 'attack')
  }

  /** Workflow.ts:7598-7610 */
  setUtilityRolls(rolls) {
    this.utilityRolls = rolls
    for (const roll of rolls) tag(roll, 'utility')
  }

  /**
   * Workflow.ts:938-942: Midi merges its utility rolls into one with the first's options
   * (utils.ts:9086); a utility here rolls one.
   */
  get utilityRoll() { return this.utilityRolls?.[0] }

  /** Workflow.ts:7663-7695: its flavor cleared. */
  setDamageRolls(rolls) {
    this.damageRolls = rolls
    for (const roll of rolls) {
      tag(roll, 'defaultDamage')
      foundry.utils.setProperty(roll, 'options.flavor', '')
    }
  }

  /** Workflow.ts:7697-7724: a roll not yet evaluated is evaluated, and none is made a DamageRoll. */
  async setBonusDamageRolls(rolls) {
    for (let i = 0; i < rolls.length; i++) if (!rolls[i]._evaluated) rolls[i] = await rolls[i].evaluate()
    this.bonusDamageRolls = rolls
    for (const roll of rolls) tag(roll, 'bonusDamage')
  }

  /** Workflow.ts:7730-7757 */
  setOtherDamageRolls(rolls) {
    this.otherDamageRolls = rolls
    for (const roll of rolls) tag(roll, 'otherDamage')
  }

  /** Workflow.ts:5028-5036: every roll the card holds, in order. */
  get chatRolls() {
    const rolls = []
    if (this.attackRoll) rolls.push(this.attackRoll)
    if (this.utilityRoll) rolls.push(this.utilityRoll)
    if (this.damageRolls) rolls.push(...this.damageRolls)
    if (this.bonusDamageRolls) rolls.push(...this.bonusDamageRolls)
    if (this.otherDamageRolls) rolls.push(...this.otherDamageRolls)
    return rolls
  }

  /** Workflow.ts:4066-4118: a bonus macro's damage, here midi.bonusDamage's, in its order. */
  async rollAllBonusDamage() {
    if (!midi.bonusDamage?.length) return
    const made = await damageRolls(this.activity, midi.bonusDamage.filter(entry => !entry.roll), ({ type, flavor }) => ({ type, flavor: flavor ?? type }))
    await this.setBonusDamageRolls(midi.bonusDamage.map(entry => entry.roll?.() ?? made.shift()))
  }

  /**
   * Workflow.ts:4672-4760, as far as its rolls: the card's rolls rewritten, every one it holds,
   * through an update of the card. Its content and Midi's flags, which useOther changes, aren't
   * modelled.
   */
  async displayDamageRolls() {
    const card = this.chatCard
    if (!card || card.deleted || (typeof card.update !== 'function')) return
    await card.update({ rolls: this.chatRolls })
  }

  /** Workflow.ts:4568-4592: the same, for a utility's roll. */
  displayUtilityRolls() { return this.displayDamageRolls() }

  async performState(state, context = {}) {
    let current = state
    while (current) {
      this.currentAction = current
      const next = await current.call(this, context)
      context = {}
      if (next === this.WorkflowState_Suspend) { this.suspended = true; return }
      current = next
    }
  }

  /** Workflow.ts:1733-1743: the state goes on, and isn't waited for. */
  unSuspend(context = {}) {
    if (context.itemUseComplete) this.itemUseComplete = true
    if (this.suspended) {
      this.suspended = false
      this.performState(this.currentAction, context)
    }
  }

  WorkflowState_Suspend() { return null }

  /** Workflow.ts:1990-2008: an area auto-targeted waits for its template. */
  WorkflowState_Start() {
    if ((midi.settings.autoTarget !== 'none') && hasArea(this.activity)) return this.WorkflowState_AwaitTemplate
    return this.WorkflowState_AoETargetConfirmation
  }

  /** Workflow.ts:2024-2036 */
  WorkflowState_AwaitTemplate(context) {
    if (context.itemUseComplete || !this.needTemplate) return this.WorkflowState_AoETargetConfirmation
    return this.WorkflowState_Suspend
  }

  /** Workflow.ts:2060-2077 and activityHelpers.ts:314-339: an area's targets are the Gamemaster's. */
  WorkflowState_AoETargetConfirmation() {
    if (hasArea(this.activity)) this.setTargets(new Set(game.user.targets))
    const allowed = Number(this.activity.target?.affects?.count)
    if (allowed && (this.targets.size > allowed)) {
      screen.notifications.push('midi-qol.wrongNumberTargets')
      return this.WorkflowState_Abort
    }
    return this.WorkflowState_PreambleComplete
  }

  /**
   * Workflow.ts:2111-2131: concentration begins once the checks have passed; 3149-3172 names it on
   * the card, then ends the one it replaces.
   */
  async WorkflowState_PreambleComplete() {
    if (this.deferredConcentration) {
      const deferred = this.deferredConcentration
      this.deferredConcentration = null
      const effect = await this.actor.beginConcentrating(this.activity)
      if (effect) {
        if (this.chatCard) this.chatCard.system = { ...this.chatCard.system, concentration: effect.id }
        if (deferred.end) await this.actor.endConcentration(deferred.end)
      }
    }
    return this.WorkflowState_WaitForAttackRoll
  }

  /** Workflow.ts:2139-2185: the attack is rolled, not awaited, and the workflow suspends. */
  WorkflowState_WaitForAttackRoll(context) {
    if (context.attackRoll) return this.WorkflowState_AttackRollComplete
    if (this.activity.type !== 'attack') {
      this.hitTargets = new Set(this.targets)
      this.hitTargetsEC = new Set()
      if (this.activity.roll?.formula) return this.WorkflowState_WaitForUtilityRoll
      return this.WorkflowState_WaitForDamageRoll
    }
    const isFastRoll = this.rollOptions.fastForwardAttack ?? this.workflowOptions.fastForwardAttack ?? false
    this.rollOptions.fastForwardAttack ||= isFastRoll
    if (this.workflowOptions.autoRollAttack) {
      this.activity.rollAttack({ workflow: this, midiOptions: { ...this.rollOptions, workflowOptions: this.workflowOptions } }, {}, {})
    }
    return this.WorkflowState_Suspend
  }

  /** Workflow.ts:2186-2245: hits are checked, then the workflow waits for damage, unless all missed. */
  WorkflowState_AttackRollComplete() {
    if (midi.settings.autoCheckHit !== 'none') {
      for (const token of this.targets) {
        const ac = token.actor.system.attributes.ac.value
        const hit = (ac !== null) && (this.isCritical || (!this.isFumble && (this.attackRoll.total >= ac)))
        if (hit) this.hitTargets.add(token)
      }
      this.whisperAttackCard = (midi.settings.autoCheckHit === 'whisper')
        || ['blind', 'gm'].includes(game.settings.get('core', 'messageMode'))
    }
    const allMissed = (this.hitTargets.size === 0) && (this.targets.size !== 0) && (midi.settings.autoCheckHit !== 'none')
    if (allMissed && this.workflowOptions.forceCompletion) return this.WorkflowState_RollFinished
    return this.WorkflowState_WaitForDamageRoll
  }

  /** Workflow.ts:2355-2366: a utility's roll is rolled where damage would be, or waited for. */
  async WorkflowState_WaitForUtilityRoll(context) {
    if (!this.activity.roll?.formula || context.utilityRolls) return this.WorkflowState_UtilityRollComplete
    if (this.workflowOptions.autoRollDamage !== 'none') {
      const rolls = await this.activity.rollFormula({ workflow: this }, {}, { create: false })
      if (!rolls) return this.WorkflowState_Abort
      this.setUtilityRolls(rolls)
      return this.WorkflowState_UtilityRollComplete
    }
    return this.WorkflowState_Suspend
  }

  /** Workflow.ts:2367-2372: its roll is written on the card, and not waited for. */
  WorkflowState_UtilityRollComplete() {
    if (this.utilityRolls) this.displayUtilityRolls()
    return this.WorkflowState_WaitForDamageRoll
  }

  /** Workflow.ts:2263-2306 */
  WorkflowState_WaitForDamageRoll(context) {
    if (context.damageRoll) return this.WorkflowState_ConfirmRoll
    const hasDamage = (this.activity.damage?.parts?.length > 0) || !!this.activity.healing?.formula
    if (!hasDamage) return this.WorkflowState_WaitForSaves
    // Workflow.ts:1272 (shouldRollDamage): averaged for every actor, or for actors of one type, as
    // "npc" averages every NPC's, companions' among them (module 0.36.0).
    const average = (midi.settings.averageDamage === 'all') || (midi.settings.averageDamage === this.actor?.type)
    const auto = this.workflowOptions.autoRollDamage
    if (average || (auto === 'always') || ((auto !== 'none') && !this.activity.attack)) {
      this.rollOptions.isCritical = this.isCritical
      this.activity.rollDamage({ workflow: this, midiOptions: { ...this.rollOptions, workflowOptions: this.workflowOptions } }, {}, { create: false })
    }
    return this.WorkflowState_Suspend
  }

  WorkflowState_ConfirmRoll() { return this.WorkflowState_DamageRollStarted }

  /**
   * Workflow.ts:2320-2332: an area not auto-targeted takes the Gamemaster's targets once its damage
   * is rolled; then a bonus macro's damage is rolled.
   */
  async WorkflowState_DamageRollStarted() {
    if ((midi.settings.autoTarget === 'none') && hasArea(this.activity) && (this.activity.type !== 'attack')) {
      this.targets = new Set(game.user.targets)
      this.hitTargets = new Set(game.user.targets)
      this.hitTargetsEC = new Set()
    }
    await this.rollAllBonusDamage()
    return this.WorkflowState_DamageRollComplete
  }

  /** Workflow.ts:2334-2353: the damage is written on the card. */
  async WorkflowState_DamageRollComplete() {
    await this.displayDamageRolls()
    return this.WorkflowState_WaitForSaves
  }

  /** Workflow.ts:2373-2420: the targets roll their saving throws, the Gamemaster's unless told not to. */
  WorkflowState_WaitForSaves() {
    const self = this.activity.target?.affects?.type === 'self'
    if (!this.workflowOptions.ignoreUserTargets && (this.activity.type !== 'attack') && !self) {
      this.targets = new Set(game.user.targets)
      this.hitTargets = new Set(this.targets)
    }
    this.failedSaves = new Set(this.hitTargets)
    this.saves = new Set()
    if (this.activity.save) {
      for (const token of this.hitTargets) {
        const success = midi.saves.get(token.id) === true
        midi.rolledSaves.push({ target: token.id, ability: [...this.activity.save.ability][0], dc: this.activity.save.dc.value, success })
        if (success) {
          this.saves.add(token)
          this.failedSaves.delete(token)
        }
      }
    }
    // Workflow.ts:1254: a check's targets roll it, as a save's roll that, the roll as
    // determineRollTypeAndAction has it (below). Invented: whether each succeeds, which midi.checks
    // says; how Midi decides the roll isn't modelled.
    if (this.activity.check) {
      const { rollType, keys } = midiCheckRoll(this.activity)
      for (const token of this.hitTargets) {
        const success = midi.checks.get(token.id) === true
        midi.rolledChecks.push({ target: token.id, rollType, keys, dc: this.activity.check.dc.value, success })
        if (success) {
          this.saves.add(token)
          this.failedSaves.delete(token)
        }
      }
    }
    return this.WorkflowState_AllRollsComplete
  }

  /** The damage applied, halved on a saving throw made, as Midi's damage calculations do. */
  WorkflowState_AllRollsComplete() {
    if (this.damageRolls) {
      const total = this.damageRolls.reduce((sum, roll) => sum + roll.total, 0)
      const attack = this.activity.type === 'attack'
      const targets = (attack && (midi.settings.autoCheckHit === 'none')) ? this.targets : this.hitTargets
      for (const token of targets) {
        const hp = token.actor.system.attributes.hp
        if (this.activity.type === 'heal') {
          hp.value = Math.min(hp.max, hp.value + total)
          midi.healed.push({ target: token.id, amount: total })
          continue
        }
        const saved = this.saves.has(token)
        const amount = !saved ? total : ((this.activity.damage.onSave === 'half') ? Math.floor(total / 2) : 0)
        hp.value = Math.max(0, hp.value - amount)
        midi.applied.push({ target: token.id, amount })
      }
    }
    return this.WorkflowState_ApplyDynamicEffects
  }

  /** Effects go on those who failed their saving throws, or every target with none to make. */
  WorkflowState_ApplyDynamicEffects() {
    for (const effect of this.activity.applicableEffects ?? []) {
      for (const token of this.failedSaves) midi.effects.push({ target: token.id, effect })
    }
    return this.WorkflowState_RollFinished
  }

  WorkflowState_RollFinished() { return this.WorkflowState_Cleanup }
  WorkflowState_Cleanup() { return this.WorkflowState_Completed }
  WorkflowState_Completed() { return null }
  WorkflowState_Abort() {
    this.aborted = true
    return null
  }
}

/** The target descriptors Midi puts on its card, from the workflow's targets. */
const descriptors = targets => [...targets].map(token => ({
  name: token.name, img: token.actor.img, uuid: token.actor.uuid, ac: token.actor.system.attributes.ac.value,
}))

/** What each of Midi's activities does in place of dnd5e's. */
export const MidiActivity = Base => class extends Base {
  get midiProperties() { return this._data.midiProperties ?? {} }
  get effectiveActivationType() { return this.activation.type }
  get hasDamage() { return this.damage?.parts?.length > 0 }
  get hasHealing() { return !!this.healing?.formula }
  get hasSave() { return !!this.save }

  /** The mark of one of Midi's activities. */
  async setupTargets() { return true }

  /** MidiActivityMixin.ts:697-910 */
  async use(usage = {}, dialog = {}, message = {}) {
    // As given, before Midi adds to it: Midi reads its scaling for the level cast at (:860, :902-903).
    midi.usages.push({ activity: this, usage: { ...usage, spell: usage.spell && { ...usage.spell } } })
    usage.midiOptions = { ...usage.midiOptions }
    usage.midiOptions.workflowOptions = { ...usage.midiOptions.workflowOptions }
    usage.midiOptions.workflowOptions.preSelectedTargetUuids ??= [...(game.user.targets ?? [])].map(t => t.document.uuid)
    const workflowOptions = { ...usage.midiOptions, ...usage.midiOptions.workflowOptions }
    delete workflowOptions.workflowOptions
    const workflow = new Workflow(this.actor, this, { workflowOptions })
    usage.workflow = workflow
    Workflow.addWorkflow(workflow)

    // setupTargets, 1538-1600: the Gamemaster's targets become the workflow's; one used on oneself
    // targets its user's token; an area ignores the targets it's given, and takes those picked before.
    // 799-801: so does a tool's activity with no kind of target.
    const self = (this.target?.affects?.type === 'self') || ((this.item.type === 'tool') && !this.target?.affects?.type)
    const targetsToUse = usage.midiOptions.targetsToUse
    if (self) {
      const own = [...placeables.values()].find(token => token.actor?.id === this.actor.id)
      workflow.setTargets(own ? [own] : [])
    } else if (targetsToUse?.size && !hasArea(this)) {
      setTargets([...targetsToUse].map(t => t.id))
      workflow.setTargets(targetsToUse)
    } else {
      const uuids = usage.midiOptions.workflowOptions.preSelectedTargetUuids
      const snapshot = uuids?.length
        ? new Set(uuids.map(uuid => [...placeables.values()].find(p => p.document.uuid === uuid)).filter(Boolean))
        : new Set(game.user.targets)
      workflow.setTargets(snapshot)
    }
    setTargets([...workflow.targets].map(t => t.id))

    // preChatChecks, 1801-1860: a creature to target is needed, where Midi requires targets.
    const rule = midi.settings.requiresTargets
    const needed = (rule === 'always') || ((rule === 'combat') && this.actor.inCombat)
    const creatures = ['creature', 'enemy', 'ally', 'willing'].includes(this.target?.affects?.type)
    if (needed && creatures && !self && !hasArea(this) && !workflow.targets.size) {
      screen.notifications.push('midi-qol.noTargets')
      Workflow.removeWorkflow(workflow.id)
      return false
    }

    // 867-881: concentration is put off until the workflow's checks pass.
    const defer = this.requiresConcentration
    if (defer) usage.concentration = { begin: false, end: usage.concentration?.end ?? null }

    const preUse = (activity, usageConfig, dialogConfig, messageConfig) => {
      if (workflow.activity.uuid !== activity.uuid) return true
      workflow.activity = activity
      const flags = messageConfig?.data?.flags?.dnd5e
      if (flags) flags.targets = descriptors(workflow.targets)
      return true
    }
    // 822-828: once dnd5e has scaled the activity for its slot, it's the workflow's.
    const consumption = (activity, usageConfig) => {
      if (workflow.activity.uuid !== activity.uuid) return
      workflow.activity = activity
      usageConfig.workflow = workflow
    }
    Hooks.on('dnd5e.preUseActivity', preUse)
    Hooks.on('dnd5e.activityConsumption', consumption)
    let results
    try {
      results = await super.use(usage, dialog, message)
    } finally {
      Hooks.off('dnd5e.preUseActivity', preUse)
      Hooks.off('dnd5e.activityConsumption', consumption)
    }
    if (!results) {
      Workflow.removeWorkflow(workflow.id)
      return false
    }
    if (defer) workflow.deferredConcentration = { end: usage.concentration?.end ?? undefined }
    Workflow.workflows.delete(this.uuid)
    workflow.id = results.message.uuid
    workflow.itemCardUuid = results.message.uuid
    workflow.chatCard = results.message
    Workflow.addWorkflow(workflow)
    workflow.itemUseComplete = true
    await workflow.performState(workflow.WorkflowState_Start, {})
    return results
  }

  /** dnd5e's damage dialog stays shut: the workflow rolls damage. */
  _triggerSubsequentActions() {}

  /**
   * MidiActivityMixin.ts:1288-1294, 1323-1335: Midi's own getDamageConfig, whoever calls it, adds the
   * actor's damage roll modifiers to each roll (here only where it has some).
   */
  getDamageConfig(config = {}) {
    const rollConfig = super.getDamageConfig(config)
    for (const roll of rollConfig.rolls ?? []) {
      const modifiers = damageRollModifiers(this, roll)
      if (!modifiers.length) continue
      roll.options ??= {}
      roll.options['midi-qol'] ??= {}
      roll.options['midi-qol'].modifiers = [...(roll.options['midi-qol'].modifiers ?? []), ...modifiers]
    }
    return rollConfig
  }

  /** MidiActivityMixin.ts:979-1110 */
  async rollDamage(config = {}, dialog = {}, message = {}) {
    const workflow = config.workflow
    if (!workflow) return super.rollDamage(config, dialog, message)
    config.midiOptions ??= workflow.workflowOptions
    config.isCritical ??= config.midiOptions.isCritical
    if (dialog.configure === undefined) dialog.configure = !config.midiOptions.fastForwardDamage
    // 1040-1063: a choice of damage types always opens the damage dialog.
    const forced = this.damage?.parts?.some(part => part.types.size > 1)
      || ((config.ammunition?.system?.damage?.base?.types?.size ?? 0) > 1)
      || ((this.healing?.types?.size ?? 0) > 1)
    const hook = Hooks.once('dnd5e.preRollDamage', (rollConfig, dialogConfig) => {
      if (forced) dialogConfig.configure = true
      return true
    })
    message.create ??= false
    let result
    try {
      result = await super.rollDamage(config, dialog, message)
    } finally {
      Hooks.off('dnd5e.preRollDamage', hook)
    }
    if (!result) {
      workflow.currentAction = workflow.WorkflowState_WaitForDamageRoll
      return
    }
    workflow.setDamageRolls(result)
    // 1087-1095 and 1242: the item's other damage is rolled with its damage, here midi.otherDamage.
    if (midi.otherDamage?.length) workflow.setOtherDamageRolls(await damageRolls(this, midi.otherDamage, ({ type }) => ({ type })))
    if (workflow.suspended) workflow.unSuspend({ damageRoll: result[0] })
    return result
  }
}

export class MidiAttackActivity extends MidiActivity(AttackActivity) {
  /** AttackActivity.ts:358-600 */
  async rollAttack(config = {}, dialog = {}, message = {}) {
    const workflow = config.workflow
    if (!workflow) return super.rollAttack(config, dialog, message)
    if (workflow.aborted) return []
    if (midi.abortNext) {
      midi.abortNext = false
      // Aborted, with no change of state, and its card deleted.
      workflow.aborted = true
      await workflow.chatCard?.delete()
      return null
    }
    if (midi.holdNext) {
      const hold = midi.holdNext
      midi.holdNext = 0
      await new Promise(resolve => { if (hold !== Infinity) setTimeout(resolve, hold) })
    }
    dialog.configure = !(workflow.rollOptions.fastForwardAttack ?? workflow.workflowOptions.autoFastAttack ?? false)
    const supplied = config.midiOptions?.workflowOptions?.attackMode
    if (supplied) config.attackMode = supplied
    if (this.item.system.properties.has('thr') && !supplied) dialog.configure = true
    message.create ??= false
    const rolls = await super.rollAttack(config, dialog, message)
    if (!rolls?.length) return null
    workflow.attackMode = rolls[0].options.attackMode ?? config.attackMode
    workflow.ammunition = this.actor.items.get(rolls[0].options.ammunition) ?? null
    if (rolls[0].options.ammunition) midi.ammunition.set(this.uuid, rolls[0].options.ammunition)
    workflow.setAttackRoll(rolls[0])
    workflow.isCritical = rolls[0].isCritical === true
    workflow.isFumble = rolls[0].isFumble === true
    // The card is written later, through a throttled update, with every roll it holds by then
    // (Workflow.ts:4669), so never without damage written on it first.
    setTimeout(() => { if (workflow.chatCard) workflow.chatCard.rolls = workflow.chatRolls }, 200)
    if (workflow.suspended) workflow.unSuspend({ attackRoll: rolls[0] })
    return rolls
  }

  /**
   * AttackActivity.ts:268-279: damage rolled with no ammunition given takes the ammunition the
   * activity last fired, as its sheet's Damage button rolls it; here outside a workflow alone, which
   * otherwise takes the workflow's.
   */
  async rollDamage(config = {}, dialog = {}, message = {}) {
    if (!config.workflow && !config.ammunition && midi.ammunition.has(this.uuid)) {
      config.ammunition = this.actor.items.get(midi.ammunition.get(this.uuid)) ?? undefined
    }
    return super.rollDamage(config, dialog, message)
  }

  /** MidiActivityMixin.ts:1255-1295: counts damage rolls, and takes the attack mode from the workflow. */
  getDamageConfig(config = {}) {
    if (config.workflow) config.workflow.damageRollCount += 1
    config.attackMode = config.workflow?.attackMode
    return super.getDamageConfig(config)
  }
}

/**
 * Workflow.ts:5509-5594 (determineRollTypeAndAction): the check a check activity's targets roll,
 * as the kind of roll and the skills, tools or ability it's rolled with: a tool item's own tool
 * where it names none; then a skill check of the skills where it names only skills, a tool check
 * of what it names where it names no skill, or else the first it names, a skill's or a tool's; and
 * where it names nothing, an ability check of the ability it names.
 * @param {CheckActivity} activity
 * @returns {{rollType: string, keys: string[]}}
 */
function midiCheckRoll(activity) {
  const associated = Array.from(activity.check.associated)
  if (!associated.length && (activity.item.type === 'tool')) {
    const baseItem = activity.item.system.type?.baseItem
    if (baseItem) associated.push(baseItem)
  }
  if (!associated.length) return { rollType: 'check', keys: [activity.check.ability].filter(Boolean) }
  const skills = associated.filter(key => !!CONFIG.DND5E.skills[key])
  if (skills.length === associated.length) return { rollType: 'skill', keys: skills }
  if (!skills.length) return { rollType: 'tool', keys: associated }
  const [first] = associated
  return { rollType: CONFIG.DND5E.skills[first] ? 'skill' : 'tool', keys: [first] }
}

export class MidiSaveActivity extends MidiActivity(SaveActivity) {}
export class MidiDamageActivity extends MidiActivity(DamageActivity) {}
export class MidiHealActivity extends MidiActivity(HealActivity) {}
export class MidiUtilityActivity extends MidiActivity(UtilityActivity) {}
export class MidiSummonActivity extends MidiActivity(SummonActivity) {}
/**
 * Midi's activity over dnd5e's check activity: its workflow has its targets roll the check as
 * `midiCheckRoll` has it, above. Its own class isn't in Midi's source to hand; the mixin's is.
 */
export class MidiCheckActivity extends MidiActivity(CheckActivity) {}
/**
 * Invented: Midi's source for its forward activity isn't available. It forwards as dnd5e's does,
 * to Midi's activity it names, which makes the workflow.
 */
export class MidiForwardActivity extends ForwardActivity {
  async setupTargets() { return true }
}

/** Put Midi in the world: its activities in place of dnd5e's, and its API. */
export function installMidi() {
  Object.assign(activityTypes, {
    attack: MidiAttackActivity, save: MidiSaveActivity, damage: MidiDamageActivity, heal: MidiHealActivity,
    utility: MidiUtilityActivity, summon: MidiSummonActivity, check: MidiCheckActivity, forward: MidiForwardActivity,
  })
  game.modules.set('midi-qol', { active: true })
  globalThis.MidiQOL = {
    Workflow,
    configSettings: () => midi.settings,
    checkRule: rule => (rule === 'activeDefence') && midi.activeDefence,
    isTargetable: token => !token.document.hidden,
    hasUsedReaction: actor => midi.usedReaction.has(actor.id),
    hasUsedBonusAction: actor => midi.usedBonus.has(actor.id),
  }
  globalThis.canvas = {
    scene: { tokens: { size: placeables.size } },
    tokens: { setTargets },
  }
}
