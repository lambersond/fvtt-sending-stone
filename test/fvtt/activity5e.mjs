// dnd5e's items and activities, as far as players' attacks, spells and features from the app use
// them: ported from dnd5e 5.3.3's module/documents/activity/mixin.mjs (use, consume,
// _prepareUsageConfig, _prepareUsageUpdates, _prepareUsageScaling, _createUsageMessage,
// rollDamage), attack.mjs (rollAttack, _buildAttackConfig), save.mjs, damage.mjs, heal.mjs and
// utility.mjs (rollDamage, rollFormula), module/data/activity/base-activity.mjs, attack-data.mjs,
// save-data.mjs, damage-data.mjs and heal-data.mjs (getDamageConfig, _processDamagePart),
// attack-data.mjs's base damage, action type and extra critical dice (prepareFinalData,
// actionType, getActionType), module/data/shared/target-field.mjs (the number of targets, a formula
// of the scaling) and module/data/item/weapon.mjs (attackModes, ammunitionOptions), cast.mjs
// (cachedSpell) and the linked activities of mixin.mjs (getLinkedActivity, a cast spell's cause),
// with what the app's uses don't touch left out: templates, summons, enchantments and the usage
// dialog; and check.mjs and check-data.mjs (a check activity's checks, DC and card buttons),
// forward.mjs and forward-data.mjs (a forward, used through the activity it names), with mixin.mjs's
// cause on the card and the slot each method of spellcasting casts with by default; and
// activities-field.mjs's order, by sort, and base-activity.mjs's duration, a spell's concentration
// in it unless the activity overrides it; and an activity's own uses, spent as
// consumption-targets-field.mjs's consumeActivityUses spends them. Line references are to 5.3.3. The rolls are dnd5e's own
// D20Roll and DamageRoll, loaded for real. Since module 0.36.0 also uses-field.mjs's rollRecharge
// (5.3.3 and 6.0.5's message), an activation's own consumption, as a legendary action spends its
// pool (mixin.mjs:426-437, 539-563, where the world's config says so), an attribute's consumption
// (consumption-targets-field.mjs:152-179), and, where a harness asks (`port.targets`), a card's
// targets as the Gamemaster's, as mixin.mjs:136-142 has them.

const { mergeObject, deepClone, getProperty, setProperty, isEmpty } = foundry.utils

export class Collection extends Map {
  /** As Foundry's: its values, not its entries. */
  [Symbol.iterator]() { return this.values() }
  get contents() { return [...this.values()] }
  find(fn) { return this.contents.find(fn) }
  filter(fn) { return this.contents.filter(fn) }
  map(fn) { return this.contents.map(fn) }
  some(fn) { return this.contents.some(fn) }
  first() { return this.contents[0] }
}

/** How many concentration effects have been made, for their ids. */
let concentrations = 0

/** What happened on the Gamemaster's screen that shouldn't: dialogs, warnings, placements. */
export const screen = { notifications: [], subsequent: [], templates: 0, summons: 0 }

/**
 * What a harness turns on of dnd5e that the port leaves out by default, so that every other
 * harness's cards stay as they were (module 0.36.0): `targets`, a use's and a roll's card naming the
 * Gamemaster's targets, as mixin.mjs:136-142's getTargetDescriptors does.
 */
export const port = { targets: false }

/**
 * mixin.mjs (getTargetDescriptors): the Gamemaster's targets, as a card names them.
 * @returns {object[]}
 */
function targetDescriptors() {
  return [...(game.user?.targets ?? [])].map(target => {
    const token = target.document ?? target
    const actor = token.actor
    return { name: token.name ?? actor?.name, img: actor?.img, uuid: actor?.uuid, ac: actor?.system?.attributes?.ac?.value ?? null }
  }).filter(target => target.uuid)
}

/**
 * uses-field.mjs:206-277 (5.3.3), and 6.0.5's (:269-347), whose message is typed `recharge` and names
 * its item or activity: a spent recharge rolled, with dnd5e's own BasicRoll process, its d6 against
 * the recovery's formula, and the uses recharged on a success, unless dnd5e's hooks say not.
 * @this {Item5e|Activity}
 */
async function rollRecharge(config = {}, dialog = {}, message = {}) {
  const isItem = this instanceof Item5e
  const uses = isItem ? this.system.uses : this.uses
  const recharge = Array.from(uses?.recovery ?? []).find(({ period }) => period === 'recharge')
  if (!recharge || !uses?.spent) return
  const sixth = String(game.system.version).startsWith('6')
  const rollConfig = mergeObject({
    rolls: [{
      parts: ['1d6'],
      data: this.getRollData(),
      options: {
        delta: isItem ? { item: this.id, keyPath: 'system.uses.spent' } : { item: this.item.id, keyPath: `system.activities.${this.id}.uses.spent` },
        target: parseInt(recharge.formula ?? '6'),
      },
    }],
  }, config)
  rollConfig.hookNames = [...(config.hookNames ?? []), 'recharge']
  rollConfig.subject = this
  const dialogConfig = mergeObject({ configure: false }, dialog)
  const sources = isItem
    ? { item: { id: this.id, img: this.img, name: this.name, type: this.type, uuid: this.uuid } }
    : { activity: { id: this.id, name: this.name, type: this.type, uuid: this.uuid }, item: { id: this.item.id, name: this.item.name, type: this.item.type, uuid: this.item.uuid } }
  const messageConfig = mergeObject({
    create: true,
    data: { speaker: ChatMessage.getSpeaker({ actor: this.actor, token: this.actor.token }), ...(sixth && { system: sources, type: 'recharge' }) },
    rollMode: CONFIG.Dice.BasicRoll.getMessageMode(),
  }, message)
  const rolls = await CONFIG.Dice.BasicRoll.buildConfigure(rollConfig, dialogConfig, messageConfig)
  await CONFIG.Dice.BasicRoll.buildEvaluate(rolls, rollConfig, messageConfig)
  if (!rolls.length) return
  messageConfig.data.flavor = `${this.name} recharge check - ${rolls[0].isSuccess ? 'Success' : 'Failure'}`
  await CONFIG.Dice.BasicRoll.buildPost(rolls, rollConfig, messageConfig)
  const updates = {}
  if (rolls[0].isSuccess) {
    if (isItem) updates['system.uses.spent'] = 0
    else updates['uses.spent'] = 0
  }
  if (Hooks.call('dnd5e.rollRecharge', rolls, { subject: this, updates }) === false) return rolls
  if (Hooks.call('dnd5e.rollRechargeV2', rolls, { subject: this, updates }) === false) return rolls
  if ((rollConfig.apply !== false) && !isEmpty(updates)) await this.update(updates)
  Hooks.callAll('dnd5e.postRollRecharge', rolls, { subject: this })
  return { rolls, updates }
}

/**
 * uses-field.mjs:44-69: `rollRecharge` on uses that recharge, bound to what has them, as dnd5e
 * defines it on its prepared uses; not enumerable, so the uses read as before.
 * @param {object|undefined} uses
 * @param {Item5e|Activity} subject
 */
function prepareRecharge(uses, subject) {
  if (!uses || !Array.from(uses.recovery ?? []).some(recovery => recovery?.period === 'recharge')) return
  Object.defineProperty(uses, 'rollRecharge', { value: rollRecharge.bind(subject), configurable: true, enumerable: false })
}

/** The activity class each use makes, by type, as dnd5e's CONFIG.DND5E.activityTypes has it. Midi swaps them. */
export const activityTypes = {}

/**
 * What else prepares an item, after its own data and activities, each given the item: as
 * enchant5e.mjs gives it its effects and applies its enchantments, as dnd5e's prepareData does.
 * @type {((item: Item5e) => void)[]}
 */
export const itemPreparers = []

/**
 * spellcasting-model.mjs:254-257, 420-422: the slot each method of spellcasting casts a spell of a
 * level with by default: a leveled spell its level's, and Pact Magic its pact slots, whatever the
 * spell's level, but for a cantrip.
 */
const SPELLCASTING = {
  spell: { getSpellSlotKey: level => `spell${level}` },
  pact: { getSpellSlotKey: level => ((level === 0) ? 'spell0' : 'pact') },
}

/* -------------------------------------------- */
/*  Damage parts                                */
/* -------------------------------------------- */

/**
 * A part of an activity's damage or healing, as dnd5e's DamageData: a number of dice, their
 * denomination and a bonus, its types, and how many dice each level of scaling adds.
 */
class DamageData {
  constructor({ number = 1, denomination = 8, bonus = '', types = ['slashing'], scaling = 0, custom = null }) {
    // damage-field.mjs:35-38: a custom formula as dnd5e keeps it, `{ enabled, formula }`; a fixture's
    // string is one enabled.
    const own = (typeof custom === 'string') ? { enabled: true, formula: custom } : { enabled: custom?.enabled === true, formula: custom?.formula ?? '' }
    Object.assign(this, { number, denomination, bonus, custom: own, scalingNumber: scaling })
    this.types = new Set(types)
  }
  get formula() {
    if (this.custom.enabled) return this.custom.formula
    const dice = this.number ? `${this.number}d${this.denomination}` : ''
    return [dice, this.bonus].filter(Boolean).join(' + ')
  }
  /** module/data/shared/damage-field.mjs:84-112, for whole scaling: more dice per level. */
  scaledFormula(increase) {
    if (this.custom.enabled || !increase || !this.scalingNumber) return this.formula
    const dice = `${this.number + (this.scalingNumber * increase)}d${this.denomination}`
    return [dice, this.bonus].filter(Boolean).join(' + ')
  }
  clone() { return new DamageData({ ...this, types: [...this.types], scaling: this.scalingNumber }) }
}

/**
 * A count as dnd5e's prepareFormulaValue works it out: a number, or a sum of numbers, @scaling and
 * @item.level, the spell's level as it's cast (spell.mjs:650-654).
 * @param {number|string|undefined} formula
 * @param {object} rollData
 * @returns {number|null}
 */
function countOf(formula, rollData) {
  if ((formula === undefined) || (formula === null) || (formula === '')) return null
  if (typeof formula === 'number') return formula
  const values = { '@scaling': rollData.scaling ?? 0, '@item.level': rollData.item?.level ?? 0 }
  const terms = formula.split('+').map(term => term.trim()).map(term => (term in values) ? values[term] : Number(term))
  return terms.every(Number.isFinite) ? terms.reduce((sum, n) => sum + n, 0) : null
}

/**
 * An object's values by their paths, as Foundry's flattenObject gives them.
 * @param {object} object
 * @param {string} [prefix]
 * @returns {object}
 */
function flatten(object, prefix = '') {
  return Object.entries(object ?? {}).reduce((flat, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && (typeof value === 'object') && !Array.isArray(value)) Object.assign(flat, flatten(value, path))
    else flat[path] = value
    return flat
  }, {})
}

/* -------------------------------------------- */
/*  Items                                       */
/* -------------------------------------------- */

export class Item5e {
  /**
   * @param {Actor} actor
   * @param {object} data   { id, name, type, img, flags, system: {...}, activities: [{...}] }
   */
  constructor(actor, data) {
    this.actor = actor
    this.parent = actor
    this._source = deepClone(data)
    this.#prepare()
  }

  #prepare() {
    const data = this._source
    Object.assign(this, { id: data.id, _id: data.id, name: data.name, type: data.type, img: data.img ?? `${data.id}.webp` })
    this.flags = data.flags ?? {}
    const system = data.system ?? {}
    const item = this
    this.system = {
      ...system,
      properties: new Set(system.properties ?? []),
      identified: system.identified !== false,
      get isVersatile() { return this.properties.has('ver') },
      /** weapon.mjs:181-215, a thrown light weapon thrown off-hand too (:203-206) */
      get attackModes() {
        if (item.type !== 'weapon') return []
        const modes = []
        const thrownRanged = this.properties.has('thr') && (this.attackType === 'ranged')
        if (!thrownRanged) {
          if (this.isVersatile || !this.properties.has('two')) modes.push({ value: 'oneHanded', label: 'One-Handed' })
          if (this.isVersatile || this.properties.has('two')) modes.push({ value: 'twoHanded', label: 'Two-Handed' })
        }
        if (this.properties.has('lgt')) modes.push({ value: 'offhand', label: 'Off-Hand' })
        if (this.properties.has('thr')) {
          if (modes.length) modes.push({ rule: true })
          modes.push({ value: 'thrown', label: 'Thrown' })
          if (this.properties.has('lgt')) modes.push({ value: 'thrown-offhand', label: 'Offhand Throw' })
        }
        return modes
      },
      /** weapon.mjs:144-156 */
      get ammunitionOptions() {
        if (!item.actor || !this.properties.has('amm')) return []
        return item.actor.itemTypes.consumable
          .filter(i => i.system.type?.value === 'ammo')
          .map(ammo => ({ item: ammo, value: ammo.id, label: `${ammo.name} (${ammo.system.quantity})`, disabled: !ammo.system.quantity }))
          .sort((a, b) => a.label.localeCompare(b.label))
      },
    }
    if (system.damage?.base) this.system.damage = { ...system.damage, base: new DamageData(system.damage.base) }
    /** spell.mjs:251-260: the Cast activity a spell dnd5e keeps for an item is cast by. */
    if (data.type === 'spell') {
      Object.defineProperty(this.system, 'linkedActivity', {
        configurable: true,
        get() { return linkedActivity(item.actor, item.getFlag('dnd5e', 'cachedFor')) },
      })
      /**
       * spell.mjs:275-280, for a leveled spell: how far above its own level its Cast activity casts
       * it, or null. A cantrip's scaling with its caster's level isn't ported.
       */
      Object.defineProperty(this.system, 'scalingIncrease', {
        configurable: true,
        get() {
          if (!(this.level > 0)) return null
          const activity = this.linkedActivity
          if (!activity?.spell?.level || (activity.spell.level <= this.level)) return null
          return activity.spell.level - this.level
        },
      })
    }
    // activities-field.mjs:17-18: in order of their sort, 0 where none is given; a stable sort, so
    // that those of the same sort keep the order they're given in.
    const activities = (data.activities ?? []).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    this.system.activities = new Collection(activities.map(a => {
      const type = a.type ?? 'attack'
      const Activity = activityTypes[type] ?? ACTIVITIES[type]
      return [a.id, new Activity(this, a)]
    }))
    prepareRecharge(this.system.uses, this)
    for (const prepare of itemPreparers) prepare(this)
  }

  get uuid() { return `${this.actor.uuid}.Item.${this.id}` }
  get isEmbedded() { return true }
  get isOwner() { return true }
  get inCompendium() { return false }
  get pack() { return null }
  /** item.mjs:405-407: a spell's own increase, from its Cast activity's level, before the flag. */
  get scalingIncrease() { return this.system?.scalingIncrease ?? this.flags.dnd5e?.scaling ?? 0 }
  getFlag(scope, key) { return getProperty(this.flags?.[scope] ?? {}, key) }
  async setFlag(scope, key, value) {
    this._source.flags ??= {}
    this._source.flags[scope] ??= {}
    setProperty(this._source.flags[scope], key, value)
    this.#prepare()
    return this
  }
  /** As Foundry's: a copy, with changes, given as dotted keys or nested objects, merged in. */
  clone(changes = {}) {
    const data = mergeObject(deepClone(this._source), foundry.utils.expandObject(deepClone(changes)))
    return new Item5e(this.actor, data)
  }
  updateSource(changes = {}) {
    const expanded = foundry.utils.expandObject(deepClone(changes))
    // dnd5e keeps an item's activities in system.activities, by id, as an activity's own uses are
    // spent (mixin.mjs:1213-1220); this keeps them in a list, each changed where its id is.
    const activities = expanded.system?.activities
    if (activities) {
      delete expanded.system.activities
      for (const [id, change] of Object.entries(activities)) {
        const source = this._source.activities?.find(activity => activity.id === id)
        if (source) mergeObject(source, change)
      }
    }
    mergeObject(this._source, expanded)
    this.#prepare()
  }
  async update(changes = {}) { this.updateSource(changes) }
  /** item.mjs:942-946: an activity's changes, as an update of the item, as dnd5e's sheet makes them. */
  async updateActivity(id, updates) {
    if (!this.system.activities.has(id)) throw new Error(`Activity of ID ${id} could not be found to update`)
    return this.update({ [`system.activities.${id}`]: foundry.utils.expandObject(updates) })
  }
  prepareFinalAttributes() {}
  toObject() { return deepClone(this._source) }
  /**
   * item.mjs:856-866: the actor's roll data, with the item's level and uses, and its scaling; a
   * spell's level as it's cast, its own and its scaling flag, or else its Cast activity's increase
   * (spell.mjs:650-654).
   */
  getRollData() {
    const level = this.system.level ?? 0
    const item = {
      level: (this.type === 'spell')
        ? level + (this.flags.dnd5e?.scaling ?? ((level !== 0) ? (this.system.scalingIncrease ?? 0) : 0))
        : level,
    }
    const uses = this.system.uses
    if (uses) {
      const max = Number(uses.max) || 0
      const spent = Number(uses.spent) || 0
      item.uses = { value: Math.max(max - spent, 0), max, spent }
    }
    return { ...this.actor.getRollData(), item, scaling: this.scalingIncrease }
  }
}

/* -------------------------------------------- */
/*  Actors                                      */
/* -------------------------------------------- */

/**
 * Give an actor what uses need: items, spell slots, armor class, statuses, concentration and combat.
 * @param {Actor5e} actor
 * @param {object} gear   { items: [...], spells: {spell1: {value, max, level}}, ac }
 */
export function equip(actor, { items = [], spells = {}, ac = 15, concentrationLimit = 1 } = {}) {
  actor.items = new Collection()
  for (const data of items) actor.items.set(data.id, new Item5e(actor, data))
  Object.defineProperty(actor, 'itemTypes', {
    configurable: true,
    get() {
      const types = { weapon: [], consumable: [], spell: [], feat: [] }
      for (const item of actor.items.values()) (types[item.type] ??= []).push(item)
      return types
    },
  })
  actor.system.spells = Object.fromEntries(Object.entries(spells).map(([key, slot]) => [key, {
    type: key === 'pact' ? 'pact' : 'leveled', label: key, ...slot,
  }]))
  actor.system.attributes.ac = { value: ac }
  actor.system.attributes.concentration = { limit: concentrationLimit }
  // Since module 0.42.0 each attack kind's bonus to hit too, which a case sets after this, as this
  // replaces each kind's bonuses.
  actor.system.bonuses.mwak = { attack: '', damage: '' }
  actor.system.bonuses.rwak = { attack: '', damage: '' }
  actor.system.bonuses.msak = { attack: '', damage: '' }
  actor.system.bonuses.rsak = { attack: '', damage: '' }
  actor.system.bonuses.save = { damage: '' }
  actor.system.bonuses.heal = { damage: '' }
  actor.system.bonuses.other = { damage: '' }
  actor.statuses ??= new Set()
  // As dnd5e-cards.mjs's Character has it since module 0.29.0: each effect with the Concentrating
  // status, the item it's on, the time it was made and its actor; the items, those on the actor.
  const effects = new Collection()
  actor.concentration = {
    effects,
    get items() { return new Set(effects.map(effect => actor.items.get(effect.flags.dnd5e.item.id)).filter(Boolean)) },
  }
  /** actor.mjs: the effect concentration on an activity makes. */
  actor.beginConcentrating = async activity => {
    const id = `conc-${activity.id}-${++concentrations}`
    const effect = {
      id, name: `Concentrating: ${activity.item.name}`, documentName: 'ActiveEffect', parent: actor,
      statuses: new Set(['concentrating']), _stats: { createdTime: Date.now() },
      // `data` is the activity's id here, which the harnesses look concentrations up by.
      flags: { dnd5e: { item: { id: activity.item.id, data: activity.id } } },
      getFlag(scope, key) { return foundry.utils.getProperty(this.flags?.[scope] ?? {}, key) },
    }
    effects.set(id, effect)
    return effect
  }
  /** actor.mjs:1065-1108, by an effect's id: then the deletion hook, as Foundry's. */
  actor.endConcentration = async id => {
    const effect = effects.get(id)
    effects.delete(id)
    if (effect) await Hooks.callAll('deleteActiveEffect', effect, {}, game.user?.id)
    return effect ? [effect] : []
  }
  actor.updateEmbeddedDocuments = async (type, updates) => {
    for (const { _id, ...changes } of updates) {
      const item = actor.items.get(_id)
      if (item) item.updateSource(changes)
    }
  }
  actor.deleteEmbeddedDocuments = async (type, ids) => { for (const id of ids) actor.items.delete(id) }
  actor.createEmbeddedDocuments = async () => {}
  if (!Object.getOwnPropertyDescriptor(actor, 'inCombat')) {
    Object.defineProperty(actor, 'inCombat', {
      configurable: true,
      get() { return [...game.combats.values()].some(c => c.combatants.some?.(cb => cb.actorId === actor.id)) },
    })
  }
  return actor
}

/* -------------------------------------------- */
/*  Activities                                  */
/* -------------------------------------------- */

/**
 * base-activity.mjs:579,829-841 and spell.mjs:414: whether an activity takes concentration, as its
 * duration has it once prepared: its own where it overrides its item's, or else its item's, a
 * spell's being whether the spell has the concentration property. A fixture's flat `concentration`
 * decides where it's given; one with neither takes none.
 * @param {Item5e} item
 * @param {object} data   The activity's: `concentration`, or `duration: { override, concentration }`.
 * @returns {boolean}
 */
function concentrationOf(item, data) {
  if (data.concentration !== undefined) return data.concentration === true
  const duration = data.duration
  if (!duration) return false
  if (!duration.override && (item.type === 'spell')) return item.system.properties?.has('concentration') === true
  return duration.concentration === true
}

/**
 * What every kind of activity has, as dnd5e's ActivityMixin over BaseActivityData.
 */
export class Activity {
  static type = 'utility'

  constructor(item, data) {
    this.item = item
    this._data = data
    Object.assign(this, { id: data.id, type: this.constructor.type, name: data.name ?? 'Use' })
    this.activation = data.activation ?? { type: 'action', value: 1 }
    // What dnd5e prepares for the sheet: the bonus to hit and the damage, as labelled.
    this.labels = deepClone(data.labels ?? {})
    this.range = { units: data.range ?? 'ft' }
    this.duration = { concentration: concentrationOf(item, data) }
    // target-field.mjs:47-60: the count is a formula of the scaling, worked out as the item is prepared.
    this.target = {
      template: { type: data.template ?? '' },
      affects: { type: data.affects ?? 'creature', count: countOf(data.count, item.getRollData()) },
      prompt: true,
    }
    this._source = { target: { affects: { count: (data.count === undefined) ? '' : String(data.count) } } }
    this.damage = {
      parts: (data.damage ?? []).map(part => new DamageData(part)),
      critical: { bonus: data.criticalBonus ?? '', allow: data.criticalAllow === true },
      onSave: data.onSave ?? 'half',
    }
    this.consumption = {
      targets: (data.consumption ?? []).map(target => new ConsumptionTarget(this, target)),
      spellSlot: data.spellSlot !== false,
      // An item's activity used at a level chosen, such as the Hat of Many Spells' check.
      scaling: { allowed: data.scaling?.allowed === true },
    }
    // base-activity.mjs:81 and uses-field.mjs:43-45: its own uses, such as a forward's once a day,
    // with how many are left; none where it's given none.
    if (data.uses) {
      const max = Number(data.uses.max) || 0
      const spent = Number(data.uses.spent) || 0
      this.uses = { ...deepClone(data.uses), max, spent, value: max ? Math.min(Math.max(max - spent, 0), max) : 0 }
      prepareRecharge(this.uses, this)
    }
    this.metadata = { usage: { dialog: null, chatCard: 'activity-card.hbs', actions: {} } }
  }

  get actor() { return this.item.actor }
  get uuid() { return `${this.item.uuid}.Activity.${this.id}` }
  get relativeUUID() { return `.Item.${this.item.id}.Activity.${this.id}` }
  get canUse() { return this._data.canUse !== false }
  get isSpell() { return this.item.type === 'spell' }
  /** spell.mjs:193-195: a leveled spell of a method with slots. */
  get canScale() { return this.isSpell && (this.item.system.level > 0) && (this.item.system.method !== 'innate') }
  /** base-activity.mjs:231-234 */
  get requiresSpellSlot() { return this.isSpell && this.canScale }
  /** base-activity.mjs:221-223 */
  get requiresConcentration() { return this.duration.concentration }
  get applicableEffects() { return this._data.effects ?? [] }
  get ability() { return this._data.ability ?? 'str' }
  /** mixin.mjs:136-142 */
  get messageFlags() {
    return {
      activity: { type: this.type, id: this.id, uuid: this.uuid },
      item: { type: this.item.type, id: this.item.id, uuid: this.item.uuid },
      targets: port.targets ? targetDescriptors() : [],
    }
  }
  /** base-activity.mjs: an activity's changes, through its item's (item.mjs:942-946). */
  async update(changes = {}) { return this.item.updateActivity(this.id, changes) }
  /** mixin.mjs:1174-1178 */
  getLinkedActivity(relativeUUID) {
    if (!this.actor) return null
    relativeUUID ??= this.item.getFlag('dnd5e', 'cachedFor')
    return linkedActivity(this.actor, relativeUUID)
  }
  getActionType() { return this._data.actionType ?? 'other' }
  getRollData() { return this.item.getRollData() }
  get damageFlavor() { return 'Damage Roll' }

  /* -------------------------------------------- */
  /*  Use                                         */
  /* -------------------------------------------- */

  /** mixin.mjs:177-283 */
  async use(usage = {}, dialog = {}, message = {}) {
    if (!this.item.isEmbedded || this.item.pack) return
    if (!this.canUse) {
      screen.notifications.push('DND5E.ACTIVITY.Warning.UsageNotAllowed')
      return
    }
    const item = this.item.clone({}, { keepId: true })
    let activity = item.system.activities.get(this.id)
    const usageConfig = activity._prepareUsageConfig(usage)
    const dialogConfig = mergeObject({ configure: true, applicationClass: this.metadata.usage.dialog }, dialog)
    const messageConfig = mergeObject({
      create: true,
      data: { flags: { dnd5e: this.messageFlags }, system: { effects: this.applicableEffects } },
      hasConsumption: usageConfig.hasConsumption,
    }, message)

    if (Hooks.call('dnd5e.preUseActivity', activity, usageConfig, dialogConfig, messageConfig) === false) return
    if (dialogConfig.configure) {
      screen.notifications.push('usage dialog')
      return
    }

    await activity._prepareUsageScaling(usageConfig, messageConfig, item)
    activity = item.system.activities.get(this.id)

    const updates = await activity.consume(usageConfig, messageConfig)
    if (updates === false) return
    const results = { effects: [], templates: [], updates }

    // mixin.mjs:239-250
    if (usageConfig.concentration?.begin) {
      const effect = await item.actor.beginConcentrating(activity, { 'flags.dnd5e.scaling': usageConfig.scaling })
      if (effect) {
        results.effects.push(effect)
        setProperty(messageConfig.data, 'system.concentration', effect.id)
      }
      if (usageConfig.concentration?.end) {
        const deleted = await item.actor.endConcentration(usageConfig.concentration.end)
        results.effects.push(...deleted)
      }
    }

    // mixin.mjs:257
    activity._finalizeMessageConfig(usageConfig, messageConfig, results)
    results.message = await activity._createUsageMessage(messageConfig)
    await activity._finalizeUsage(usageConfig, results)

    if (Hooks.call('dnd5e.postUseActivity', activity, usageConfig, results) === false) return results
    if (usageConfig.subsequentActions !== false) activity._triggerSubsequentActions(usageConfig, results)
    return results
  }

  /** mixin.mjs:293-342 */
  async consume(usageConfig, messageConfig) {
    if (Hooks.call('dnd5e.preActivityConsumption', this, usageConfig, messageConfig) === false) return false
    const updates = await this._prepareUsageUpdates(usageConfig)
    if (!updates) return false
    if (Hooks.call('dnd5e.activityConsumption', this, usageConfig, messageConfig, updates) === false) return false
    const consumed = await this.#applyUsageUpdates(updates)
    if (!isEmpty(consumed)) setProperty(messageConfig, 'data.system.deltas', consumed)
    // mixin.mjs:325-327: the card names what it was used for, such as a forward.
    if (usageConfig.cause?.activity) setProperty(messageConfig, 'data.system.cause', usageConfig.cause.activity)
    if (Hooks.call('dnd5e.postActivityConsumption', this, usageConfig, messageConfig, updates) === false) return false
    return updates
  }

  /** mixin.mjs:386-405, with deltas as a plain record of what changed. */
  async #applyUsageUpdates(updates) {
    this._mergeActivityUpdates(updates)
    const deltas = { actor: [], item: {} }
    // Foundry's mergeObject expanded the actor's changes; they're applied by path.
    updates.actor = flatten(updates.actor)
    for (const [path, value] of Object.entries(updates.actor)) {
      deltas.actor.push({ keyPath: path, delta: value - getProperty(this.actor, path) })
    }
    // deltas-field.mjs:91-106: an activity's, such as its uses spent, from the activity itself.
    for (const { _id, ...changes } of updates.item) {
      const item = this.actor.items.get(_id)
      deltas.item[_id] = Object.entries(flatten(changes)).map(([keyPath, value]) => {
        const [, id, path] = /^system\.activities\.([^.]+)\.(.+)$/.exec(keyPath) ?? []
        const current = id ? getProperty(item.system.activities.get(id) ?? {}, path) : getProperty(item._source, keyPath)
        return { keyPath, delta: value - current }
      })
    }
    if (!isEmpty(updates.actor)) await this.actor.update(updates.actor)
    // :392, 400: those used up and destroyed, that are still there.
    updates.delete = (updates.delete ?? []).filter(id => this.actor.items.has(id))
    if (updates.delete.length) await this.actor.deleteEmbeddedDocuments('Item', updates.delete)
    if (updates.item.length) await this.actor.updateEmbeddedDocuments('Item', updates.item)
    return (deltas.actor.length || !isEmpty(deltas.item)) ? deltas : {}
  }

  /** mixin.mjs:415-488; since module 0.41.0 a scroll's fixed level and a target spent only in a fight too. */
  _prepareUsageConfig(config) {
    config = deepClone(config)
    const linked = this.getLinkedActivity(config.cause?.activity)
    if (config.create !== false) {
      config.create ??= {}
      config.create.measuredTemplate ??= !!this.target.template.type && this.target.prompt
    }
    const ignoreLinkedConsumption = this.isSpell && !this.consumption.spellSlot
    if (config.consume !== false) {
      const hasResourceConsumption = this.consumption.targets.length > 0
      const hasLinkedConsumption = (linked?.consumption.targets.length > 0) && !ignoreLinkedConsumption
      const hasSpellSlotConsumption = this.requiresSpellSlot && this.consumption.spellSlot
      config.consume ??= {}
      // mixin.mjs:426-437: an activation that spends a pool of the creature's, as a legendary action.
      const activationConfig = CONFIG.DND5E.activityActivationTypes?.[this.activation.type] ?? {}
      config.consume.action ??= !!activationConfig.consume && (activationConfig.consume.canConsume?.(this) !== false)
      // mixin.mjs:435-437: a target spent only in a fight left out of one (module 0.41.0).
      config.consume.resources ??= Array.from(this.consumption.targets.entries())
        .filter(([, target]) => !target.combatOnly || this.actor.inCombat)
        .map(([index]) => index)
      config.consume.spellSlot ??= !linked && hasSpellSlotConsumption
      config.hasConsumption = hasResourceConsumption || hasLinkedConsumption || (!linked && hasSpellSlotConsumption)
    }
    // mixin.mjs:443-448: a scroll's spell at the level it's written at, fixed (module 0.41.0).
    const levelingFlag = this.item.getFlag('dnd5e', 'spellLevel')
    if (levelingFlag) {
      config.scaling = false
      config.spell ??= {}
      config.spell.slot = levelingFlag.value
    } else {
      const canScale = linked ? linked.consumption.scaling.allowed : this.canScale
      const linkedDelta = (linked?.spell?.level ?? Infinity) - this.item.system.level
      if (!canScale) config.scaling = false
      else if (Number.isFinite(linkedDelta)) config.scaling ??= linkedDelta
      if (this.requiresSpellSlot) {
        const { level, method } = this.item.system
        config.spell ??= {}
        config.spell.slot ??= linked?.spell?.level ? `spell${linked.spell.level}`
          : (SPELLCASTING[method]?.getSpellSlotKey(level) ?? `spell${level}`)
        const scaling = (this.actor.system.spells?.[config.spell.slot]?.level ?? 0) - this.item.system.level
        if (scaling > 0) config.scaling ??= scaling
      }
      config.scaling ??= 0
    }
    // mixin.mjs:470-479
    if (this.requiresConcentration && !game.settings.get('dnd5e', 'disableConcentration')) {
      config.concentration ??= {}
      config.concentration.begin ??= true
      const { effects } = this.actor.concentration
      const limit = this.actor.system.attributes?.concentration?.limit ?? 0
      if (limit && (limit <= effects.size)) {
        config.concentration.end ??= effects.find(e => e.flags.dnd5e?.item?.data === this.id)?.id ?? effects.first()?.id ?? null
      }
    }
    // mixin.mjs:481-485
    if (linked) {
      config.cause ??= {}
      config.cause.activity ??= linked.relativeUUID
      config.cause.resources ??= (linked.consumption.targets.length > 0) && !ignoreLinkedConsumption
    }
    return config
  }

  /** mixin.mjs:533-649, without action consumption. */
  async _prepareUsageUpdates(config, { returnErrors = false } = {}) {
    const updates = { activity: {}, actor: {}, create: [], delete: [], item: [], rolls: [] }
    if (config.consume === false) return updates
    const errors = []
    // mixin.mjs:539-563
    const activationConfig = CONFIG.DND5E.activityActivationTypes?.[this.activation.type]
    if (((config.consume === true) || config.consume.action) && activationConfig?.consume) {
      const { property } = activationConfig.consume
      const containsConsumption = this.consumption.targets.find(t => (t.type === 'attribute') && (t.target === `${property}.value`))
      const count = this.activation.value ?? 1
      const current = getProperty(this.actor.system, property)
      if (current && !containsConsumption) {
        if (current.value < 1) errors.push(new ConsumptionError('DND5E.ACTIVATION.Warning.NoActions'))
        else if (count > current.value) errors.push(new ConsumptionError('DND5E.ACTIVATION.Warning.NotEnoughActions'))
        else updates.actor[`system.${property}.spent`] = current.spent + count
      }
    }
    if ((config.consume === true) || config.consume.resources) {
      const indexes = (config.consume === true) || (config.consume.resources === true)
        ? this.consumption.targets.keys() : config.consume.resources
      for (const index of indexes) {
        try {
          await this.consumption.targets[index].consume(config, updates)
        } catch (err) {
          if (err instanceof ConsumptionError) errors.push(err)
          else throw err
        }
      }
    }
    // mixin.mjs:579-606: a spell cast from an item spends what its Cast activity spends.
    if (config.cause) {
      const linked = this.getLinkedActivity(config.cause.activity)
      if (linked) {
        const resources = (config.consume === true) || (config.cause?.resources === true)
          ? [...linked.consumption.targets.keys()] : (config.cause?.resources || [])
        const results = await linked._prepareUsageUpdates({ ...config, consume: { resources, spellSlot: false }, cause: false }, { returnErrors: true })
        if (Array.isArray(results)) errors.push(...results)
        else if (results) {
          linked._mergeActivityUpdates(results)
          mergeObject(updates.actor, results.actor)
          updates.item.push(...results.item)
        }
      }
    } else if (((config.consume === true) || config.consume.spellSlot) && this.requiresSpellSlot && this.consumption.spellSlot) {
      // mixin.mjs:611-613
      const slot = config.spell?.slot
        ?? SPELLCASTING[this.item.system.method]?.getSpellSlotKey(this.item.system.level + (config.scaling ?? 0))
        ?? this.item.system.method
      const slotData = this.actor.system.spells?.[slot]
      if (slotData) {
        if (slotData.value) {
          mergeObject(updates.actor, { [`system.spells.${slot}.value`]: Math.max(slotData.value - 1, 0) })
        } else {
          errors.push(new ConsumptionError(`DND5E.SpellCastNoSlots ${this.item.name} ${slotData.label}`))
        }
      }
    }
    // mixin.mjs:627-641
    if (config.concentration?.begin) {
      const { effects } = this.actor.concentration
      if (config.concentration.end) {
        if (!effects.find(e => e.id === config.concentration.end)) errors.push(new ConsumptionError('DND5E.ConcentratingMissingItem'))
      } else if (effects.size >= this.actor.system.attributes?.concentration?.limit) {
        errors.push(new ConsumptionError('DND5E.ConcentratingLimited'))
      }
    }
    if (!returnErrors) errors.forEach(err => screen.notifications.push(err.message))
    return errors.length ? (returnErrors ? errors : false) : updates
  }

  /** mixin.mjs:1213-1220: what's spent of the activity's own, as its item's update. */
  _mergeActivityUpdates(updates) {
    if (isEmpty(updates.activity ?? {})) return
    const index = updates.item.findIndex(update => update._id === this.item.id)
    const keyPath = `system.activities.${this.id}`
    const activityUpdates = foundry.utils.expandObject(updates.activity)
    if (index === -1) updates.item.push({ _id: this.item.id, [keyPath]: activityUpdates })
    else updates.item[index][keyPath] = activityUpdates
  }

  /** mixin.mjs:499-520 */
  async _prepareUsageScaling(usageConfig, messageConfig, item) {
    // A scroll's spell, written at a level above its own.
    const levelingFlag = this.item.getFlag('dnd5e', 'spellLevel')
    if (levelingFlag) {
      usageConfig.scaling = Math.max(0, levelingFlag.value - levelingFlag.base)
    } else if (this.isSpell) {
      const level = this.actor.system.spells?.[usageConfig.spell?.slot]?.level
      if (level) {
        usageConfig.scaling = level - item.system.level
        setProperty(messageConfig, 'data.system.spellLevel', level)
      }
    }
    if (usageConfig.scaling) {
      setProperty(messageConfig, 'data.system.scaling', usageConfig.scaling)
      if (usageConfig.scaling !== item.flags.dnd5e?.scaling) {
        item.updateSource({ 'flags.dnd5e.scaling': usageConfig.scaling })
      }
    }
  }

  /** mixin.mjs:718-722: the rolls consumption made and the effects are on the card already. */
  _finalizeMessageConfig(usageConfig, messageConfig, results) {}

  /** mixin.mjs:732-758, without the buttons to place a template or spend what wasn't spent. */
  _usageChatButtons(message) { return [] }

  /** mixin.mjs:787-824, the card's buttons rendered as activity-card.hbs:18-25 renders them. */
  async _createUsageMessage(message) {
    const buttons = this._usageChatButtons(message)
    const dataset = data => Object.entries(data)
      .map(([key, value]) => `data-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${value}"`).join(' ')
    const messageConfig = mergeObject({
      data: {
        content: buttons.length
          ? `<div class="activity-card"><div class="card-buttons">${buttons.map(button =>
            `<button type="button" ${dataset(button.dataset)}>${button.icon}<span>${button.label}</span></button>`).join('')}</div></div>`
          : '<div class="activity-card"></div>',
        flags: { core: { canPopout: true } },
        speaker: ChatMessage.getSpeaker({ actor: this.item.actor }),
        title: `${this.item.name} - ${this.name}`,
        type: 'usage',
      },
      rollMode: CONFIG.Dice.BasicRoll.getMessageMode(),
    }, message)
    Hooks.callAll('dnd5e.preCreateUsageMessage', this, messageConfig)
    ChatMessage.applyRollMode(messageConfig.data, messageConfig.rollMode)
    const card = messageConfig.create === false ? messageConfig.data : await ChatMessage.create(messageConfig.data)
    Hooks.callAll('dnd5e.postCreateUsageMessage', this, card)
    return card
  }

  /** mixin.mjs:845-848: templates are placed on the Gamemaster's canvas, which waits for them. */
  async _finalizeUsage(config, results) {
    if (config.create?.measuredTemplate) {
      screen.templates++
      results.templates = ['template']
    }
  }

  /** mixin.mjs:842: nothing follows a use but for the kinds that roll at once. */
  _triggerSubsequentActions(config, results) {}

  /** mixin.mjs:1138-1150 */
  createConsumedFlag(actor, deltas) {
    if (!actor || !deltas) return
    return undefined
  }

  /* -------------------------------------------- */
  /*  Damage                                      */
  /* -------------------------------------------- */

  /** base-activity.mjs:744-755 */
  getDamageConfig(config = {}) {
    if (!this.damage?.parts) return mergeObject({ rolls: [] }, config)
    const rollConfig = deepClone(config)
    const rollData = this.getRollData()
    rollConfig.rolls = this.damage.parts
      .map((d, index) => this._processDamagePart(d, rollConfig, rollData, index))
      .filter(d => d.parts.length)
      .concat(config.rolls ?? [])
    return rollConfig
  }

  /** base-activity.mjs:768-791 */
  _processDamagePart(damage, rollConfig, rollData, index = 0) {
    const scaledFormula = damage.scaledFormula(rollConfig.scaling ?? rollData.scaling)
    const parts = scaledFormula ? [scaledFormula] : []
    const data = { ...rollData, mod: this.actor.system.abilities[this.ability].mod }
    if (index === 0) {
      const bonus = getProperty(this.actor ?? {}, `system.bonuses.${this.getActionType(rollConfig.attackMode)}.damage`)
      if (bonus && !/^0+$/.test(bonus)) parts.push(bonus)
    }
    const lastType = this.item.getFlag('dnd5e', `last.${this.id}.damageType.${index}`)
    return {
      data, parts,
      options: {
        type: (damage.types.has(lastType) ? lastType : null) ?? [...damage.types][0],
        types: [...damage.types],
        properties: [],
      },
    }
  }

  /** mixin.mjs:869-929 */
  async rollDamage(config = {}, dialog = {}, message = {}) {
    const rollConfig = this.getDamageConfig(config)
    rollConfig.hookNames = [...(config.hookNames ?? []), 'damage']
    rollConfig.subject = this
    const dialogConfig = mergeObject({ options: {} }, dialog)
    const messageConfig = mergeObject({
      create: true,
      data: {
        flavor: `${this.item.name} - ${this.damageFlavor}`,
        flags: { dnd5e: { ...this.messageFlags, messageType: 'roll', roll: { type: 'damage' } } },
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      },
    }, message)
    const rolls = await CONFIG.Dice.DamageRoll.build(rollConfig, dialogConfig, messageConfig)
    if (!rolls?.length) return
    const lastDamageTypes = rolls.reduce((obj, roll, index) => {
      if (roll.options.type) obj[index] = roll.options.type
      return obj
    }, {})
    if (!isEmpty(lastDamageTypes) && this.actor?.items.has(this.item.id)) {
      await this.actor.items.get(this.item.id).setFlag('dnd5e', `last.${this.id}.damageType`, lastDamageTypes)
    }
    Hooks.callAll('dnd5e.rollDamage', rolls, { subject: this })
    return rolls
  }
}

/* -------------------------------------------- */
/*  Attack activities                           */
/* -------------------------------------------- */

export class AttackActivity extends Activity {
  static type = 'attack'

  constructor(item, data) {
    super(item, { ...data, name: data.name ?? 'Attack' })
    // attack-data.mjs:199-205: a weapon's own damage, here its attack's first part, is its base
    // damage, which its attacks include unless told not to.
    if ((item.type === 'weapon') && (data.includeBase !== false) && this.damage.parts[0]) this.damage.parts[0].base = true
  }

  /** attack-data.mjs:123-132 */
  get criticalThreshold() { return this._data.criticalThreshold ?? 20 }

  /** attack-data.mjs's `attack`, as far as its ability: where it's given, as module 0.32.0's harness gives it. */
  get attack() { return { ability: this._data.attack?.ability ?? '' } }

  /**
   * attack-data.mjs:51-63, where its attack names an ability: none; its spellcasting ability; that
   * one; or else the best of those it may use, a finesse weapon's Strength or Dexterity, a ranged
   * one's Dexterity, any other's Strength. As before for one that names none.
   */
  get ability() {
    const chosen = this._data.attack?.ability
    if (chosen === undefined) return super.ability
    if (chosen === 'none') return null
    if (chosen === 'spellcasting') return this.actor?.system.attributes?.spellcasting ?? 'int'
    if (chosen in (CONFIG.DND5E.abilities ?? {})) return chosen
    const available = this.item.system.properties?.has?.('fin') ? ['str', 'dex']
      : (this.actionType.startsWith('r') ? ['dex'] : ['str'])
    const abilities = this.actor?.system.abilities ?? {}
    return available.reduce((best, key) => ((abilities[key]?.mod ?? -Infinity) > (abilities[best]?.mod ?? -Infinity) ? key : best), available[0])
  }

  /**
   * attack-data.mjs:68-71, with the type and classification prepareData gives it from its item
   * (:190-194): a weapon's, a spell's attack ranged unless its activity says otherwise, as Guiding
   * Bolt's does, and anything else's melee.
   */
  get actionType() {
    const value = this._data.attackType ?? this.item.system.attackType ?? (this.isSpell ? 'ranged' : 'melee')
    const classification = this._data.attackClassification ?? this.item.system.attackClassification
      ?? (this.isSpell ? 'spell' : 'weapon')
    return `${value === 'ranged' ? 'r' : 'm'}${classification === 'spell' ? 'sak' : 'wak'}`
  }

  /** base-activity.mjs:729-733: a melee weapon thrown, or made a ranged attack, is a ranged weapon attack. */
  getActionType(attackMode = '') {
    const actionType = this._data.actionType ?? this.actionType
    if ((actionType === 'mwak') && (attackMode?.startsWith('thrown') || (attackMode === 'ranged'))) return 'rwak'
    return actionType
  }

  /**
   * attack-data.mjs:259-279, simplified: the ability modifier and proficiency, and a magic bonus; and
   * since module 0.42.0 the actor's own bonus to its kind of attack, `actorBonus` (:271), where it has
   * one, as an effect such as Bless adds it, for the attack mode's kind (base-activity.mjs:729-733).
   */
  getAttackData({ attackMode } = {}) {
    const rollData = this.getRollData()
    const parts = ['@mod', '@prof']
    if (this._data.magic) parts.push(String(this._data.magic))
    const data = { ...rollData, mod: this.actor.system.abilities[this.ability].mod }
    const actorBonus = this.actor?.system.bonuses?.[this.getActionType(attackMode)]?.attack
    if (actorBonus) {
      parts.push('@actorBonus')
      data.actorBonus = actorBonus
    }
    return { parts, data }
  }

  /** attack.mjs:70-72: opens the attack dialog on the Gamemaster's screen. */
  _triggerSubsequentActions(config, results) {
    screen.subsequent.push(results.message?.id ?? null)
  }

  /** attack.mjs:85-235 */
  async rollAttack(config = {}, dialog = {}, message = {}) {
    // The Gamemaster's own targets, which a use from the app mustn't take.
    const targets = [...(game.user.targets ?? [])].map(t => ({ name: t.name, uuid: t.actor.uuid, ac: t.actor.system.attributes.ac.value }))
    if ((this.item.type === 'weapon') && (this.item.system.quantity === 0)) {
      screen.notifications.push('DND5E.ATTACK.Warning.NoQuantity')
    }
    const buildConfig = this._buildAttackConfig.bind(this)
    const rollConfig = mergeObject({
      ammunition: this.item.getFlag('dnd5e', `last.${this.id}.ammunition`),
      attackMode: this.item.getFlag('dnd5e', `last.${this.id}.attackMode`),
      // attack.mjs:97-98, as dnd5e decides it, from the actor's flag and the attack's ability.
      elvenAccuracy: Boolean(this.actor?.getFlag('dnd5e', 'elvenAccuracy'))
        && (CONFIG.DND5E.characterFlags?.elvenAccuracy?.abilities ?? []).includes(this.ability),
      halflingLucky: this.actor?.getFlag('dnd5e', 'halflingLucky'),
      mastery: this.item.getFlag('dnd5e', `last.${this.id}.mastery`),
      target: targets.length === 1 ? targets[0].ac : undefined,
    }, config)

    const ammunitionOptions = this.item.system.ammunitionOptions ?? []
    if (ammunitionOptions.length) ammunitionOptions.unshift({ value: '', label: '' })
    if (rollConfig.ammunition === undefined) rollConfig.ammunition = ammunitionOptions?.[1]?.value
    else if (!ammunitionOptions?.find(m => m.value === rollConfig.ammunition)) {
      rollConfig.ammunition = ammunitionOptions?.[0]?.value
    }
    const attackModeOptions = this.item.system.attackModes
    if (!attackModeOptions?.find(m => m.value === rollConfig.attackMode)) {
      rollConfig.attackMode = attackModeOptions?.[0]?.value
    }

    rollConfig.hookNames = [...(config.hookNames ?? []), 'attack', 'd20Test']
    rollConfig.rolls = [CONFIG.Dice.D20Roll.mergeConfigs({
      options: {
        ammunition: rollConfig.ammunition,
        attackMode: rollConfig.attackMode,
        criticalSuccess: this.criticalThreshold,
        mastery: rollConfig.mastery,
        // dnd5e 6 puts it on the roll's own options (attack.mjs:263-265); 5.3.3 takes it from the process.
        ...(rollConfig.elvenAccuracy && { elvenAccuracy: true }),
      },
    }, config.rolls?.shift())].concat(config.rolls ?? [])
    rollConfig.subject = this

    const dialogConfig = mergeObject({
      options: {
        ammunitionOptions: rollConfig.ammunition !== false ? ammunitionOptions : [],
        attackModeOptions,
        buildConfig,
      },
    }, dialog)
    const messageConfig = mergeObject({
      create: true,
      data: {
        flavor: `${this.item.name} - Attack Roll`,
        flags: { dnd5e: { ...this.messageFlags, messageType: 'roll', roll: { type: 'attack' } } },
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      },
    }, message)

    const rolls = await CONFIG.Dice.D20Roll.buildConfigure(rollConfig, dialogConfig, messageConfig)
    await CONFIG.Dice.D20Roll.buildEvaluate(rolls, rollConfig, messageConfig)
    if (!rolls.length) return null
    for (const key of ['ammunition', 'attackMode', 'mastery']) {
      if (!rolls[0].options[key]) continue
      setProperty(messageConfig.data, `flags.dnd5e.roll.${key}`, rolls[0].options[key])
    }
    await CONFIG.Dice.D20Roll.buildPost(rolls, rollConfig, messageConfig)

    const flags = {}
    let ammoUpdate = null
    if (rolls[0].options.ammunition) {
      const ammo = this.actor?.items.get(rolls[0].options.ammunition)
      if (ammo) {
        if (!ammo.system.properties?.has('ret')) {
          ammoUpdate = { id: ammo.id, quantity: Math.max(0, ammo.system.quantity - 1) }
          ammoUpdate.destroy = ammo.system.uses?.autoDestroy && (ammoUpdate.quantity === 0)
        }
        flags.ammunition = rolls[0].options.ammunition
      }
    } else if (rolls[0].options.attackMode?.startsWith('thrown') && !this.item.system.properties?.has('ret')) {
      ammoUpdate = { id: this.item.id, quantity: Math.max(0, this.item.system.quantity - 1) }
    }
    if (rolls[0].options.attackMode) flags.attackMode = rolls[0].options.attackMode
    else if (rollConfig.attackMode) rolls[0].options.attackMode = rollConfig.attackMode
    if (!isEmpty(flags) && this.actor?.items.has(this.item.id)) {
      await this.actor.items.get(this.item.id).setFlag('dnd5e', `last.${this.id}`, flags)
    }
    Hooks.callAll('dnd5e.rollAttack', rolls, { subject: this, ammoUpdate })
    if (ammoUpdate?.destroy) {
      const data = this.actor.items.get(ammoUpdate.id).toObject()
      const messageId = messageConfig.data?.flags?.dnd5e?.originatingMessage
      const attackMessage = dnd5e.registry.messages.get(messageId, 'attack')?.pop()
      await attackMessage?.setFlag('dnd5e', 'roll.ammunitionData', data)
      await this.actor.deleteEmbeddedDocuments('Item', [ammoUpdate.id])
    } else if (ammoUpdate) {
      await this.actor.updateEmbeddedDocuments('Item', [{ _id: ammoUpdate.id, 'system.quantity': ammoUpdate.quantity }])
    }
    Hooks.callAll('dnd5e.postRollAttack', rolls, { subject: this })
    return rolls
  }

  /** attack.mjs:247-261 */
  _buildAttackConfig(process, config, formData, index) {
    const { ammunition, attackMode, mastery } = process
    const { parts, data } = this.getAttackData({ ammunition, attackMode })
    const options = config.options ?? {}
    if (ammunition !== undefined) options.ammunition = ammunition
    if (attackMode !== undefined) options.attackMode = attackMode
    if (mastery !== undefined) options.mastery = mastery
    config.parts = [...(config.parts ?? []), ...parts]
    config.data = { ...data, ...(config.data ?? {}) }
    config.options = options
  }

  /** base-activity.mjs:744-755, then attack-data.mjs:288-330 */
  getDamageConfig(config = {}) {
    const rollConfig = super.getDamageConfig(config)
    const ammo = config.ammunition?.system
    if (ammo?.damage?.base?.formula) {
      const basePartIndex = rollConfig.rolls.findIndex(i => i.base)
      const damage = ammo.damage.base.clone()
      rollConfig.rolls.splice(basePartIndex + 1, 0, this._processDamagePart(damage, rollConfig, this.getRollData(), basePartIndex + 1))
    }
    if (this.damage.critical.bonus && rollConfig.rolls[0] && !rollConfig.rolls[0].options?.critical?.bonusDamage) {
      setProperty(rollConfig.rolls[0], 'options.critical.bonusDamage', this.damage.critical.bonus)
    }
    return rollConfig
  }

  /**
   * base-activity.mjs:768-791, and attack-data.mjs:371-416 for the base part: its versatile die for
   * two hands, and, for a melee weapon attack, its wielder's extra dice on a critical hit (:410-413).
   */
  _processDamagePart(damage, rollConfig, rollData, index = 0) {
    if (!damage.base) return super._processDamagePart(damage, rollConfig, rollData, index)
    let part = damage
    if ((rollConfig.attackMode === 'twoHanded') && this._data.versatile) {
      part = new DamageData({ ...damage, types: [...damage.types], denomination: this._data.versatile })
    }
    const roll = super._processDamagePart(part, rollConfig, rollData, index)
    roll.base = true
    // attack-data.mjs:385-392: an off-hand attack's damage without its wielder's modifier, unless it's
    // less than nothing. The fixtures write the @mod dnd5e adds into the part itself (module 0.41.0).
    if ((this.item.type === 'weapon') && rollConfig.attackMode?.endsWith('offhand') && !(roll.data.mod < 0)) {
      roll.parts = roll.parts.map(each => each.replace(/\s*\+\s*@mod\b/g, '').replace(/^@mod\s*\+\s*/, '')).filter(each => each && (each !== '@mod'))
    }
    const criticalBonusDice = this.actor?.getFlag('dnd5e', 'meleeCriticalDamageDice') ?? 0
    if ((this.getActionType(rollConfig.attackMode) === 'mwak') && (parseInt(criticalBonusDice) !== 0)) {
      setProperty(roll, 'options.critical.bonusDice', criticalBonusDice)
    }
    return roll
  }
}

/* -------------------------------------------- */
/*  Save, damage, healing and utility           */
/* -------------------------------------------- */

/** save.mjs and save-data.mjs */
export class SaveActivity extends Activity {
  static type = 'save'

  constructor(item, data) {
    super(item, data)
    this.save = { ability: new Set(data.save ?? ['dex']), dc: { value: data.dc ?? 13 } }
  }

  getActionType() { return this._data.actionType ?? 'save' }

  /** save-data.mjs:137-144 */
  getDamageConfig(config = {}) {
    const rollConfig = super.getDamageConfig(config)
    rollConfig.critical ??= {}
    rollConfig.critical.allow ??= false
    return rollConfig
  }

  /** save.mjs:79-86 */
  async rollDamage(config = {}, dialog = {}, message = {}) {
    message = mergeObject({ 'data.flags.dnd5e.roll': { damageOnSave: this.damage.onSave } }, message)
    return super.rollDamage(config, dialog, message)
  }
}

/** damage.mjs and damage-data.mjs */
export class DamageActivity extends Activity {
  static type = 'damage'

  /** damage-data.mjs:66-74 */
  getDamageConfig(config = {}) {
    const rollConfig = super.getDamageConfig(config)
    rollConfig.critical ??= {}
    rollConfig.critical.allow ??= this.damage.critical.allow
    rollConfig.critical.bonusDamage ??= this.damage.critical.bonus
    return rollConfig
  }

  /** damage.mjs:52-54: rolls the damage at once, opening its dialog on the Gamemaster's screen. */
  _triggerSubsequentActions(config, results) {
    screen.subsequent.push(results.message?.id ?? null)
  }
}

/** heal.mjs and heal-data.mjs */
export class HealActivity extends Activity {
  static type = 'heal'

  constructor(item, data) {
    super(item, data)
    this.healing = new DamageData({ types: ['healing'], ...(data.healing ?? {}) })
  }

  get damageFlavor() { return 'Healing Roll' }
  getActionType() { return this._data.actionType ?? 'heal' }

  /** heal-data.mjs:49-58 */
  getDamageConfig(config = {}) {
    if (!this.healing.formula) return mergeObject({ rolls: [] }, config)
    const rollConfig = mergeObject({ critical: { allow: false } }, config)
    rollConfig.rolls = [this._processDamagePart(this.healing, rollConfig, this.getRollData())].concat(config.rolls ?? [])
    return rollConfig
  }

  /** heal.mjs:56-58 */
  _triggerSubsequentActions(config, results) {
    screen.subsequent.push(results.message?.id ?? null)
  }

  /** heal.mjs:67-72 */
  async rollDamage(config = {}, dialog = {}, message = {}) {
    const messageConfig = mergeObject({ 'data.flags.dnd5e.roll.type': 'healing' }, message)
    return super.rollDamage(config, dialog, messageConfig)
  }
}

/** utility.mjs and utility-data.mjs */
export class UtilityActivity extends Activity {
  static type = 'utility'

  constructor(item, data) {
    super(item, data)
    this.roll = { formula: data.formula ?? '', prompt: data.prompt === true, name: data.rollName ?? '', visible: data.rollVisible === true }
  }

  /** utility.mjs:66-118 */
  async rollFormula(config = {}, dialog = {}, message = {}) {
    if (!this.roll.formula) return
    const rollConfig = deepClone(config)
    rollConfig.hookNames = [...(config.hookNames ?? []), 'formula']
    rollConfig.rolls = [{ parts: [this.roll.formula], data: this.getRollData() }].concat(config.rolls ?? [])
    rollConfig.subject = this
    const dialogConfig = mergeObject({ configure: this.roll.prompt }, dialog)
    // mixin.mjs:136-142: messageFlags names the Gamemaster's own targets, as getTargetDescriptors finds them.
    const targets = [...(game.user.targets ?? [])].map(t => ({ name: t.name, uuid: t.actor.uuid, ac: t.actor.system.attributes.ac.value }))
    const messageConfig = mergeObject({
      create: true,
      data: { flavor: `${this.item.name} - Other Formula`, flags: { dnd5e: { ...this.messageFlags, targets, messageType: 'roll', roll: { type: 'generic' } } } },
    }, message)
    const rolls = await CONFIG.Dice.BasicRoll.build(rollConfig, dialogConfig, messageConfig)
    if (!rolls.length) return
    Hooks.callAll('dnd5e.rollFormula', rolls, { subject: this })
    Hooks.callAll('dnd5e.rollFormulaV2', rolls, { subject: this })
    return rolls
  }
}

/** summon.mjs: summoning places tokens, which dnd5e asks the Gamemaster about. */
export class SummonActivity extends Activity {
  static type = 'summon'
  async use(...args) {
    screen.summons++
    return super.use(...args)
  }
}

/**
 * cast.mjs: an item's activity that casts a spell, through the copy of it dnd5e keeps on the actor,
 * flagged for it. Its own use opens the spell's dialogs, so the module never uses it.
 */
export class CastActivity extends Activity {
  static type = 'cast'
  constructor(item, data) {
    super(item, data)
    this.spell = { uuid: data.spell?.uuid ?? `Compendium.spells.${data.id}`, level: data.spell?.level ?? null, spellbook: true }
    this.visibility = { requireMagic: true }
    // cast-data.mjs:21-39: whether it may be cast higher, and how many levels at most, a formula.
    this.consumption.scaling = { allowed: data.scaling?.allowed ?? (data.scaling === true), max: data.scaling?.max ?? '' }
    if (data.uses) this.uses = data.uses
  }
  /** mixin.mjs:1187-1190: the item's roll data, as the usage dialog works out the most levels from. */
  getRollData({ deterministic = false } = {}) { return this.item.getRollData({ deterministic }) }
  /** mixin.mjs:98-108: a magic item casts only while its magic is available, as attuned. */
  get canUse() { return super.canUse && (this.item.system.magicAvailable !== false) }
  /** cast.mjs:51-54 */
  get cachedSpell() { return this.actor.items.find(i => i.getFlag('dnd5e', 'cachedFor') === this.relativeUUID) }
  /** cast.mjs:62-64 */
  get displayInSpellbook() { return this.canUse && this.spell.spellbook }
  async use() {
    screen.notifications.push('a Cast activity used directly: its spell\'s dialogs on the Gamemaster\'s screen')
  }
}

/* -------------------------------------------- */
/*  Checks and forwards                         */
/* -------------------------------------------- */

/**
 * A DC as dnd5e's simplifyBonus works it out of a formula of numbers, @scaling and @item.level: 0
 * for anything else.
 * @param {string} formula
 * @param {object} rollData
 * @returns {number}
 */
const simplified = (formula, rollData) => (formula ? (countOf(formula, rollData) ?? 0) : 0)

/** check.mjs and check-data.mjs: an activity calling for checks, a button on its card for each. */
export class CheckActivity extends Activity {
  static type = 'check'

  constructor(item, data) {
    super(item, data)
    // check-data.mjs:21-28: `associated` is a SetField, which casts one key, as Maze's
    // `associated: inv`, to a set of it.
    const associated = data.check?.associated ?? []
    this.check = {
      ability: data.check?.ability ?? '',
      associated: new Set((typeof associated === 'string') ? [associated] : associated),
      dc: { calculation: data.check?.dc?.calculation ?? '', formula: String(data.check?.dc?.formula ?? '') },
    }
    this.prepareFinalData()
  }

  /** base-activity.mjs:242-246, a spell's own ability, or its caster's. */
  get spellcastingAbility() {
    return (this.isSpell && this.item.system.ability) || this.actor?.system.attributes?.spellcasting || null
  }

  /** check-data.mjs:37-41 */
  get ability() {
    if (this.check.dc.calculation in CONFIG.DND5E.abilities) return this.check.dc.calculation
    if (this.check.dc.calculation === 'spellcasting') return this.spellcastingAbility
    return this.check.ability
  }

  /** check-data.mjs:61-74 */
  prepareFinalData() {
    if (this.check.ability === 'spellcasting') this.check.ability = this.spellcastingAbility
    let ability
    if (this.check.dc.calculation) ability = this.ability
    else this.check.dc.value = simplified(this.check.dc.formula, this.getRollData())
    if (ability) this.check.dc.value = this.actor?.system.abilities?.[ability]?.dc ?? 8 + (this.actor?.system.attributes?.prof ?? 0)
    if (!this.check.dc.value) this.check.dc.value = null
  }

  /** check-data.mjs:85-93 */
  getAbility(associated) {
    if (this.check.ability) return this.check.ability
    if (associated in CONFIG.DND5E.skills) return CONFIG.DND5E.skills[associated]?.ability ?? null
    else if (associated in (CONFIG.DND5E.tools ?? {})) {
      if ((this.item.type === 'tool') && this.item.system.ability) return this.item.system.ability
      return CONFIG.DND5E.tools[associated]?.ability ?? null
    }
    return null
  }

  /** check.mjs:41-81, labelled in English. */
  _usageChatButtons(message) {
    const buttons = []
    const dc = this.check.dc.value
    const wrap = check => `${check} check`
    const createButton = (abilityKey, associated) => {
      const ability = CONFIG.DND5E.abilities[abilityKey]?.label
      const checkType = (associated in CONFIG.DND5E.skills) ? 'skill'
        : (associated in (CONFIG.DND5E.tools ?? {})) ? 'tool' : 'ability'
      const dataset = { ability: abilityKey, action: 'rollCheck', visibility: 'all' }
      if (dc) dataset.dc = dc
      if (checkType !== 'ability') dataset[checkType] = associated
      const type = (checkType === 'skill') ? CONFIG.DND5E.skills[associated]?.label
        : (checkType === 'tool') ? (CONFIG.DND5E.tools[associated]?.label ?? associated) : null
      const label = type ? `${ability} (${type})` : ability
      buttons.push({
        label: dc ? `<span class="visible-dc">DC ${dc} ${wrap(label)}</span><span class="hidden-dc">${wrap(label)}</span>` : wrap(label),
        icon: (checkType === 'tool') ? '<i class="fa-solid fa-hammer" inert></i>' : '<i class="dnd5e-icon" inert></i>',
        dataset,
      })
    }
    const associated = Array.from(this.check.associated)
    if (!associated.length && (this.item.type === 'tool')) associated.push(this.item.system.type?.baseItem)
    if (associated.length) associated.forEach(a => {
      const ability = this.getAbility(a)
      if (ability) createButton(ability, a)
    })
    else if (this.check.ability) createButton(this.check.ability)
    return buttons.concat(super._usageChatButtons(message))
  }

  /**
   * check.mjs:94-120: a button on its card clicked, rolling for the user's character, or else each
   * of the tokens they target.
   */
  async rollCheck(dataset, actors = [game.user.character].filter(Boolean)) {
    let { ability, dc, skill, tool } = dataset
    dc = parseInt(dc)
    const rollData = { target: Number.isFinite(dc) ? dc : this.check.dc.value }
    if (ability in CONFIG.DND5E.abilities) rollData.ability = ability
    for (const actor of actors) {
      if (skill) await actor.rollSkill({ ...rollData, skill }, {}, {})
      else if (tool) {
        rollData.tool = tool
        if ((this.item.type === 'tool') && (!this.item.system.type?.baseItem || (tool === this.item.system.type.baseItem))) {
          rollData.bonus = this.item.system.bonus
          rollData.prof = this.item.system.prof
          rollData.item = this.item
        }
        await actor.rollToolCheck(rollData, {}, {})
      } else await actor.rollAbilityCheck(rollData, {}, {})
    }
  }
}

/** forward.mjs and forward-data.mjs: an activity used through another of its item's. */
export class ForwardActivity extends Activity {
  static type = 'forward'

  constructor(item, data) {
    super(item, data)
    // forward-data.mjs:18-21: no duration, effects, range or target of its own.
    delete this.duration
    delete this.range
    delete this.target
    this.activity = { id: data.activity?.id ?? null }
    // forward-data.mjs:35-46: the activation of the activity it names, where that one sets its own.
    const own = this.activation
    Object.defineProperty(this, 'activation', {
      configurable: true,
      enumerable: true,
      get: () => {
        const named = this.item.system.activities?.get(this.activity.id)
        return named?._data.activation?.override ? deepClone(named._data.activation) : own
      },
    })
  }

  get applicableEffects() { return [] }

  /** forward.mjs:34-48 */
  async use(usage = {}, dialog = {}, message = {}) {
    const usageConfig = mergeObject({
      cause: { activity: this.relativeUUID },
      consume: { resources: false, spellSlot: false },
    }, usage)
    const activity = this.item.system.activities.get(this.activity.id)
    if (!activity) screen.notifications.push('DND5E.FORWARD.Warning.NoActivity')
    return activity?.use(usageConfig, dialog, message)
  }
}

/** dnd5e's own classes, by type: CONFIG.DND5E.activityTypes. */
export const ACTIVITIES = {
  attack: AttackActivity, save: SaveActivity, damage: DamageActivity, heal: HealActivity, utility: UtilityActivity,
  summon: SummonActivity, cast: CastActivity, check: CheckActivity, forward: ForwardActivity,
}

/* -------------------------------------------- */
/*  Consumption                                 */
/* -------------------------------------------- */

export class ConsumptionError extends Error {}

/**
 * An activity's consumption target, as dnd5e's ConsumptionTargetData, for item uses and the
 * activity's own only (consumption-targets-field.mjs, consumeItemUses and consumeActivityUses): its
 * value of the uses per use, more for each level of scaling where it scales by amount.
 */
class ConsumptionTarget {
  constructor(activity, { type = 'itemUses', target = '', value = 1, scaling = {}, combatOnly = false } = {}) {
    // consumption-targets-field.mjs: `combatOnly`, spent only in a fight (module 0.41.0).
    Object.assign(this, { activity, type, target, value, combatOnly: combatOnly === true })
    this.scaling = { mode: scaling.mode ?? '', formula: scaling.formula ?? '' }
  }

  /** consumption-targets-field.mjs:709-711 */
  resolveCost({ config = {} } = {}) {
    return this._resolveScaledRoll(this.value, (this.scaling.mode === 'amount') ? (config.scaling ?? 0) : 0)
  }

  /**
   * consumption-targets-field.mjs:743-773: its formula's dice and numbers grown by the scaling, or
   * the scaling formula, multiplied by it, added.
   */
  _resolveScaledRoll(formula, scaling) {
    const { DiceTerm, NumericTerm, OperatorTerm } = foundry.dice.terms
    const rollData = this.activity.getRollData()
    const roll = new Roll(formula ? `0 + ${formula}` : '0', rollData)
    if (scaling) {
      if (this.scaling.formula) {
        const scalingRoll = new Roll(this.scaling.formula, rollData)
        // Roll#alter(scaling, undefined, { multiplyNumeric: true })
        for (const term of scalingRoll.terms) {
          if (term instanceof DiceTerm) term.alter(scaling)
          else if (term instanceof NumericTerm) term.number *= scaling
        }
        roll.terms.push(new OperatorTerm({ operator: '+' }), ...scalingRoll.terms)
      } else {
        roll.terms = roll.terms.map(term => {
          if (term instanceof DiceTerm) return term.alter(undefined, scaling)
          if (term instanceof NumericTerm) term.number += (term.number > 0) ? scaling : (term.number < 0) ? -scaling : 0
          return term
        })
      }
      roll.resetFormula()
    }
    return roll
  }

  /**
   * consumption-targets-field.mjs:240-270 (consumeItemUses), through _usesConsumption (:357-367):
   * its cost, which may be less than nothing, spent from its uses; a used-up item that destroys
   * itself, as an oil or a scroll, one fewer, its uses back, or deleted with its last (:254-264).
   */
  async consume(config, updates) {
    if (this.type === 'activityUses') return this.#consumeActivityUses(config, updates)
    if (this.type === 'attribute') return this.#consumeAttribute(config, updates)
    const item = this.target ? this.activity.actor.items.get(this.target) : this.activity.item
    const spent = Number(item.system.uses?.spent) || 0
    const value = Math.max((Number(item.system.uses?.max) || 0) - spent, 0)
    const roll = this.resolveCost({ config })
    const cost = roll.isDeterministic ? roll.evaluateSync().total : (await roll.evaluate()).total
    let warning
    if ((cost > 0) && !value) warning = 'DND5E.CONSUMPTION.Warning.None'
    else if (cost > value) warning = 'DND5E.CONSUMPTION.Warning.NotEnough'
    if (warning) throw new ConsumptionError(`${warning} ${item.name} ${cost}/${value}`)
    const itemUpdate = { 'system.uses.spent': spent + cost }
    if (item.system.uses?.autoDestroy && ((spent + cost) === (Number(item.system.uses.max) || 0))) {
      const quantity = (Number(item.system.quantity) || 0) - 1
      if (quantity === 0) {
        updates.delete.push(item.id)
        return
      }
      Object.assign(itemUpdate, { 'system.uses.spent': 0, 'system.quantity': quantity })
    }
    const index = updates.item.findIndex(update => update._id === item.id)
    if (index === -1) updates.item.push({ _id: item.id, ...itemUpdate })
    else Object.assign(updates.item[index], itemUpdate)
  }

  /**
   * consumption-targets-field.mjs:152-179: its cost from an attribute of the actor's, as a legendary
   * action's pool: where the attribute's value is worked out from what's spent, its spent raised.
   */
  async #consumeAttribute(config, updates) {
    const actor = this.activity.actor
    const keyPath = `system.${this.target}`
    const roll = this.resolveCost({ config })
    const cost = roll.isDeterministic ? roll.evaluateSync().total : (await roll.evaluate()).total
    if (getProperty(actor, keyPath) === undefined) throw new ConsumptionError('DND5E.CONSUMPTION.Warning.MissingAttribute')
    let current = getProperty(actor, keyPath)
    let warning
    if ((cost > 0) && !current) warning = 'DND5E.CONSUMPTION.Warning.None'
    else if (current < cost) warning = 'DND5E.CONSUMPTION.Warning.NotEnough'
    if (warning) throw new ConsumptionError(`${warning} ${this.target} ${cost}/${current}`)
    const adjustedKeyPath = keyPath.replace(/\.value$/, '.spent')
    if ((adjustedKeyPath !== keyPath) && (getProperty(actor, adjustedKeyPath) !== undefined)) {
      current = getProperty(actor, adjustedKeyPath)
      updates.actor[adjustedKeyPath] = current + cost
    } else updates.actor[keyPath] = current - cost
  }

  /**
   * consumption-targets-field.mjs:131-141, through _usesConsumption (:357-367): its cost spent from
   * the uses of the activity it's on, such as a forward's own, apart from any other's.
   */
  async #consumeActivityUses(config, updates) {
    const uses = this.activity.uses ?? { value: 0, spent: 0 }
    const roll = this.resolveCost({ config })
    const cost = roll.isDeterministic ? roll.evaluateSync().total : (await roll.evaluate()).total
    let warning
    if ((cost > 0) && !uses.value) warning = 'DND5E.CONSUMPTION.Warning.None'
    else if (cost > uses.value) warning = 'DND5E.CONSUMPTION.Warning.NotEnough'
    if (warning) throw new ConsumptionError(`${warning} ${this.activity.name} ${cost}/${uses.value}`)
    mergeObject(updates.activity, { uses: { spent: uses.spent + cost } })
  }
}

/**
 * The activity a relative UUID on an actor names, such as ".Item.staff.Activity.cast-barbs", as
 * fromUuidSync finds it relative to the actor.
 * @param {Actor5e} actor
 * @param {string} [uuid]
 * @returns {Activity|null}
 */
function linkedActivity(actor, uuid) {
  const [, item, activity] = /^\.Item\.([^.]+)\.Activity\.([^.]+)$/.exec(uuid ?? '') ?? []
  return (item && actor?.items?.get(item)?.system.activities.get(activity)) || null
}
