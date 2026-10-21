// dnd5e's enchantments, as far as players' enchant activities from the app use them: ported from
// dnd5e 5.3.3's module/documents/activity/enchant.mjs (existingEnchantment, enchantableTypes,
// _prepareUsageConfig, _finalizeMessageConfig, _triggerSubsequentActions, applyEnchantment,
// canEnchant), module/data/activity/enchant-data.mjs (profiles, enchant, restrictions,
// availableEnchantments, appliedEnchantments) and base-activity.mjs's relevantLevel, with
// fields/applied-effect-field.mjs's `effect`; module/documents/active-effect.mjs (isAppliedEnchantment,
// dependentOrigin, _preCreate's canEnchant, _onCreate's riders and createRiderEnchantments,
// _onDelete's dependents deleted by the active Gamemaster without waiting); registry.mjs's
// EnchantmentRegisty; actor.mjs's beginConcentrating and endConcentration, with concentration as
// effects on the actor; an item's own effects and the enchantments applied to it, as prepareData
// applies their changes to its name, properties and magical bonus; and Foundry's fromUuid and
// fromUuidSync, for the documents these name. A 6.x-style activity (`style6`) has profiles with a
// `uuid` and an `effect` that throws, as dnd5e 6 warns on each read, and offers profiles by level
// alone, as 6.0.5's applicableEffects; a 6.x-style enchantment (`system.origin.activity`, no
// `origin`) has the origin 6.0.5's prepareBaseData gives it. An item not identified yet takes its
// unidentified name, once its enchantments have renamed it, as identifiable.mjs's
// prepareIdentifiable has it. Import after activity5e.mjs; Midi-QOL's enchant activity is made with
// midiEnchantActivity. Line references are to 5.3.3.

import { ACTIVITIES, Activity, Collection, Item5e, itemPreparers, screen } from './activity5e.mjs'

const { mergeObject, deepClone, getProperty, setProperty } = foundry.utils

/** utils.mjs: staticID */
export const staticID = id => ((id.length >= 16) ? id.substring(0, 16) : id.padEnd(16, '0'))

/** Every effect made, as made: { effect, data, options }. */
export const effectsMade = []

/** Every effect deleted, by uuid. */
export const effectsDeleted = []

/** Every enchantment _preCreate refused: { data, errors }. */
export const effectsRefused = []

/** How many times a 6.x-style profile's `effect` was read. */
export const effectReads = { count: 0 }

/**
 * Which dnd5e an enchantment is made under: 5.3.3's _preCreate asks canEnchant again, refusing it
 * quietly; 6.0.5's no longer does (active-effect.mjs:739-763).
 */
export const createRules = { checkCanEnchant: true }

/* -------------------------------------------- */
/*  Documents by uuid                           */
/* -------------------------------------------- */

/**
 * Foundry's fromUuidSync, for the world's actors, their items, effects and activities. Anything else,
 * as a compendium's, isn't to be had: null, or with strict, an error.
 * @param {string} uuid
 * @param {object} [options]
 * @param {boolean} [options.strict]
 * @returns {object|null}
 */
export function fromUuidSync(uuid, { strict = true } = {}) {
  if (typeof uuid !== 'string') return null
  const parts = uuid.split('.')
  let document = (parts[0] === 'Actor') ? game.actors.get(parts[1]) : null
  for (let index = 2; document && (index < parts.length); index += 2) {
    const [type, id] = [parts[index], parts[index + 1]]
    if (type === 'Item') document = document.items?.get(id)
    else if (type === 'ActiveEffect') document = document.effects?.get(id)
    else if (type === 'Activity') document = document.system?.activities?.get(id)
    else document = null
  }
  if (!document && strict) throw new Error(`No document ${uuid}`)
  return document ?? null
}
globalThis.fromUuidSync = fromUuidSync
globalThis.fromUuid = async uuid => fromUuidSync(uuid, { strict: false })

/* -------------------------------------------- */
/*  Effects                                     */
/* -------------------------------------------- */

/**
 * How long an effect lasts, as Foundry's duration gives it: in seconds, or in turns or rounds, and
 * what's left of it, which a fixture may set, as one that's run out.
 * @param {object} [duration]
 * @returns {object}
 */
function durationOf(duration = {}) {
  const { seconds, rounds, turns } = duration
  if (seconds) {
    const label = (seconds % 3600 === 0) ? `${seconds / 3600} Hour${(seconds === 3600) ? '' : 's'}`
      : (seconds % 60 === 0) ? `${seconds / 60} Minute${(seconds === 60) ? '' : 's'}` : `${seconds} Seconds`
    return { type: 'seconds', value: seconds, duration: seconds, remaining: duration.remaining ?? seconds, label, expired: duration.expired }
  }
  if (rounds || turns) {
    const value = rounds || turns
    const unit = rounds ? 'Round' : 'Turn'
    return { type: 'turns', value, duration: value, remaining: duration.remaining ?? value, label: `${value} ${unit}${(value === 1) ? '' : 's'}`, expired: duration.expired }
  }
  return { type: 'none', value: null, duration: null, remaining: null, label: '' }
}

/** active-effect.mjs: an effect on an actor or an item. */
export class ActiveEffect5e {
  constructor(data, parent) {
    this._source = data
    this.parent = parent
    // 6.0.5 active-effect.mjs:333-335: the origin, where dnd5e 6 keeps it, as `system.origin`.
    Object.assign(this, {
      id: data._id, _id: data._id, name: data.name ?? '', type: data.type ?? 'base', img: data.img ?? null,
      origin: data.system?.origin?.activity ?? data.origin ?? null, disabled: data.disabled === true,
      transfer: data.transfer === true, description: data.description ?? '',
    })
    this.system = data.system ?? {}
    this.flags = data.flags ?? {}
    this.changes = data.changes ?? []
    this.statuses = new Set(data.statuses ?? [])
    this.duration = durationOf(data.duration)
  }

  get documentName() { return 'ActiveEffect' }
  get uuid() { return `${this.parent.uuid}.ActiveEffect.${this.id}` }
  /** :98-100 */
  get isAppliedEnchantment() { return (this.type === 'enchantment') && !!this.origin && (this.origin !== this.parent.uuid) }
  /** :87-90 */
  get dependentOrigin() {
    if (!(this.parent instanceof Item5e)) return null
    return this.parent.effects.get(this.flags.dnd5e?.dependentOn) ?? null
  }
  get isSuppressed() { return false }
  get active() { return !this.disabled && !this.isSuppressed }
  get isTemporary() { return this.duration.type !== 'none' }
  getFlag(scope, key) { return getProperty(this.flags?.[scope] ?? {}, key) }
  toObject() { return deepClone(this._source) }

  /** As Foundry's: a copy, with changes, and without its id unless it's kept. */
  clone(changes = {}, { keepId = false } = {}) {
    const data = mergeObject(deepClone(this._source), foundry.utils.expandObject(deepClone(changes)))
    if (!keepId) delete data._id
    return new ActiveEffect5e(data, this.parent)
  }

  /**
   * Foundry's ActiveEffect.create, with dnd5e's _preCreate (:584-603) and _onCreate (:607-618).
   * @param {object} data
   * @param {object} options   { parent, keepId, keepOrigin, chatMessageOrigin }
   * @returns {Promise<ActiveEffect5e|undefined>}   Nothing where _preCreate refused it.
   */
  static async create(data, options = {}) {
    const { parent } = options
    data = deepClone(data)
    if (!options.keepId || !data._id) data._id = foundry.utils.randomID()
    const made = new ActiveEffect5e(data, parent)
    if ((made.type === 'enchantment') && !(parent instanceof Item5e)) {
      screen.notifications.push('DND5E.ENCHANTMENT.Warning.NotOnActor')
      return undefined
    }
    if (made.isAppliedEnchantment && createRules.checkCanEnchant) {
      const origin = await fromUuid(made.origin)
      const errors = origin?.canEnchant?.(parent)
      if (errors?.length) {
        effectsRefused.push({ data, errors })
        return undefined
      }
      data.disabled = false
    }
    if (parent instanceof Item5e) {
      parent._source.effects = [...(parent._source.effects ?? []), data]
      parent.updateSource({})
    } else parent.effects.set(data._id, made)
    const effect = parent.effects.get(data._id)
    effectsMade.push({ effect, data: deepClone(data), options: { ...options, parent: parent.uuid } })
    if (effect.isAppliedEnchantment) await effect.createRiderEnchantments(options)
    Hooks.callAll('createActiveEffect', effect, options, game.user.id)
    return effect
  }

  /**
   * :489-563: the activities and effects an enchantment's profile adds to the item it's on, from
   * the card named, or else the profile and activity given. Rider items aren't ported.
   * @param {object} options
   */
  async createRiderEnchantments(options = {}) {
    let item
    let profile
    const { chatMessageOrigin } = options
    const { enchantmentProfile, activityId } = options.dnd5e ?? {}
    if (chatMessageOrigin) {
      const message = game.messages.get(chatMessageOrigin)
      const activity = message?.getAssociatedActivity()
      item = activity?.item
      profile = activity?.effects.find(e => e._id === message?.getFlag('dnd5e', 'use.enchantmentProfile'))
    } else if (enchantmentProfile && activityId) {
      const origin = await fromUuid(this.origin)
      const activity = (origin instanceof EnchantActivity) ? origin : origin?.system?.activities?.get(activityId)
      item = activity?.item
      profile = activity?.effects.find(e => e._id === enchantmentProfile)
    }
    if (!profile || !item) return
    const riders = [...profile.riders.activity].flatMap(id => {
      const data = item._source.activities?.find(a => a.id === id)
      if (!data) return []
      const rider = deepClone(data)
      rider.id = foundry.utils.randomID()
      setProperty(rider, 'flags.dnd5e.dependentOn', this.id)
      return [rider]
    })
    if (riders.length) this.parent.updateSource({ activities: [...(this.parent._source.activities ?? []), ...riders] })
    const effects = [...profile.riders.effect].flatMap(id => {
      const data = item.effects.get(id)?.toObject()
      if (!data) return []
      delete data._id
      data.origin = this.origin
      setProperty(data, 'flags.dnd5e.dependentOn', this.id)
      return [data]
    })
    for (const data of effects) await ActiveEffect5e.create(data, { parent: this.parent, keepId: true })
  }

  /**
   * Foundry's delete, with dnd5e's _onDelete (:667-673): gone at once, then what depends on it, as
   * enchantments on a concentration, deleted by the active Gamemaster without waiting for them.
   * @returns {Promise<ActiveEffect5e>}
   */
  async delete(options = {}) {
    const parent = this.parent
    if (!parent.effects?.has(this.id)) throw new Error(`ActiveEffect ${this.id} does not exist`)
    if (parent instanceof Item5e) {
      parent._source.effects = (parent._source.effects ?? []).filter(data => data._id !== this.id)
      parent.updateSource({})
    } else parent.effects.delete(this.id)
    effectsDeleted.push(this.uuid)
    // Later, as the Gamemaster's client gets to them: whoever deletes one first does.
    for (const dependent of this.getDependents()) setTimeout(() => dependent.delete().catch(() => null), 0)
    if (this.isAppliedEnchantment) registry.untrack(this.origin, this.uuid)
    Hooks.callAll('deleteActiveEffect', this, options, game.user.id)
    return this
  }

  /** :902-923: the effects that name it as what they depend on. */
  getDependents() {
    const dependents = []
    for (const actor of game.actors.values()) {
      for (const effect of actor.effects?.values?.() ?? []) {
        if (effect.flags?.dnd5e?.dependentOn === this.uuid) dependents.push(effect)
      }
      for (const item of actor.items?.values?.() ?? []) {
        for (const effect of item.effects?.values?.() ?? []) {
          const on = effect.flags?.dnd5e?.dependentOn
          if ((on === this.uuid) || ((item === this.parent) && (on === this.id))) dependents.push(effect)
        }
      }
    }
    return dependents
  }
}

/* -------------------------------------------- */
/*  The registry of enchantments applied        */
/* -------------------------------------------- */

const tracked = new Map()

/** registry.mjs: the enchantments each enchant activity applied, by the activity's uuid. */
export const registry = {
  applied(uuid) {
    return Array.from(tracked.get(uuid) ?? []).map(enchanted => fromUuidSync(enchanted, { strict: false }))
      .filter(effect => effect?.isAppliedEnchantment)
  },
  track(source, enchanted) {
    if (enchanted.startsWith('Compendium.')) return
    if (!tracked.has(source)) tracked.set(source, new Set())
    tracked.get(source).add(enchanted)
  },
  untrack(source, enchanted) { tracked.get(source)?.delete(enchanted) },
}

/* -------------------------------------------- */
/*  Items                                       */
/* -------------------------------------------- */

/**
 * An item's effects, and the enchantments applied to it, as dnd5e prepares it: their changes to its
 * name ("{}" for its name before, or added on), its properties and its magical bonus, each tracked
 * in the registry (active-effect.mjs:418). Its sort, which the sheet orders items by, and its
 * document name, by which the module tells an item's effects from an actor's.
 */
itemPreparers.push(item => {
  item.documentName = 'Item'
  item.sort = item._source.sort ?? 0
  item.effects = new Collection((item._source.effects ?? []).map(data => [data._id, new ActiveEffect5e(data, item)]))
  for (const effect of item.effects.values()) {
    if (!effect.isAppliedEnchantment || effect.disabled) continue
    for (const { key, mode, value } of effect.changes) {
      if (key === 'name') item.name = (mode === 5) ? String(value).replace('{}', item.name) : `${item.name}${value}`
      else if ((key === 'system.properties') && (mode === 2)) item.system.properties.add(value)
      else if (key === 'system.magicalBonus') item.system.magicalBonus = Number(value)
    }
    registry.track(effect.origin, effect.uuid)
  }
  // identifiable.mjs:58-62, as weapon.mjs:475 and the like call it once the enchantments are applied.
  if ((item.system.identified === false) && item.system.unidentified?.name) item.name = item.system.unidentified.name
})

/* -------------------------------------------- */
/*  Actors                                      */
/* -------------------------------------------- */

/**
 * Give an actor what enchantments need, after `equip`: effects of its own, concentration as one of
 * them (actor.mjs:1026-1104, active-effect.mjs:690-725), as its `concentration.effects` lists them,
 * and roll data with its level and classes' levels, as relevantLevel reads them.
 * @param {Actor5e} actor
 * @param {object} [options]
 * @param {number} [options.level]
 * @param {object} [options.classes]   Such as { wizard: { levels: 5 } }.
 * @returns {Actor5e}
 */
export function withEffects(actor, { level = 1, classes = {} } = {}) {
  actor.effects = new Collection()
  actor.system.details = { ...actor.system.details, level }
  const rollData = actor.getRollData.bind(actor)
  actor.getRollData = () => ({ ...rollData(), details: { level }, classes: deepClone(classes) })
  const concentrating = CONFIG.specialStatusEffects.CONCENTRATING
  actor.concentration = {
    get effects() {
      return new Collection(actor.effects.filter(effect => effect.statuses.has(concentrating)).map(effect => [effect.id, effect]))
    },
  }
  actor.beginConcentrating = async (activity, effectData = {}) => {
    const item = activity.item
    const data = mergeObject({
      name: `Concentrating: ${item.name}`,
      statuses: [concentrating],
      origin: item.uuid,
      flags: { dnd5e: { activity: { type: activity.type, id: activity.id, uuid: activity.uuid }, item: { type: item.type, id: item.id, uuid: item.uuid, data: activity.id } } },
    }, effectData)
    if (Hooks.call('dnd5e.preBeginConcentrating', actor, item, data, activity) === false) return
    const effect = await ActiveEffect5e.create(data, { parent: actor })
    Hooks.callAll('dnd5e.beginConcentrating', actor, item, effect, activity)
    return effect
  }
  actor.endConcentration = async target => {
    const effect = (typeof target === 'string') ? actor.effects.get(target) : target
    if (!effect || !actor.effects.has(effect.id)) return []
    if (Hooks.call('dnd5e.preEndConcentration', actor, effect) === false) return []
    await effect.delete()
    Hooks.callAll('dnd5e.endConcentration', actor, effect)
    return [effect]
  }
  return actor
}

/* -------------------------------------------- */
/*  Enchant activities                          */
/* -------------------------------------------- */

export class EnchantmentError extends Error {}

/**
 * enchant.mjs and enchant-data.mjs. Its data: `profiles` [{ _id, level: { min, max }, riders: {
 * activity: [] } }], `self`, `allowMagical`, `categories`, `properties`, `restrictionType`, and
 * `identifier` for a class's levels; `style6` for dnd5e 6's profiles.
 */
export class EnchantActivity extends Activity {
  static type = 'enchant'

  constructor(item, data) {
    super(item, { ...data, affects: data.affects ?? '' })
    const style6 = data.style6 === true
    this.effects = (data.profiles ?? []).map(profile => {
      const value = {
        _id: profile._id,
        level: { min: profile.level?.min ?? null, max: profile.level?.max ?? null },
        riders: { activity: new Set(profile.riders?.activity ?? []), effect: new Set(profile.riders?.effect ?? []), item: new Set() },
      }
      if (style6) value.uuid = `${item.uuid}.ActiveEffect.${profile._id}`
      // applied-effect-field.mjs: 5.3.3's `effect`; 6.x warns on each read, and here throws.
      Object.defineProperty(value, 'effect', {
        get() {
          if (!style6) return item.effects?.get(this._id)
          effectReads.count++
          throw new Error('A 6.x profile\'s effect was read')
        },
        configurable: true,
      })
      return value
    })
    this.style6 = style6
    this.enchant = { self: data.self === true }
    this.restrictions = {
      allowMagical: data.allowMagical === true,
      categories: new Set(data.categories ?? []),
      properties: new Set(data.properties ?? []),
      type: data.restrictionType ?? '',
    }
    this.visibility = { identifier: data.identifier ?? '' }
  }

  /** enchant-data.mjs:56-58 */
  get applicableEffects() { return null }

  /** base-activity.mjs:209-213 */
  get relevantLevel() {
    const keyPath = ((this.item.type === 'spell') && (this.item.system.level > 0)) ? 'item.level'
      : this.visibility.identifier ? `classes.${this.visibility.identifier}.levels` : 'details.level'
    return getProperty(this.getRollData(), keyPath) ?? 0
  }

  /** enchant-data.mjs:64-66 */
  get appliedEnchantments() { return dnd5e.registry.enchantments.applied(this.uuid) }

  /** enchant-data.mjs:73-77; 6.0.5's base-activity.mjs:164-169 by level alone. */
  get availableEnchantments() {
    const level = this.relevantLevel
    return this.effects.filter(e => (this.style6 || e.effect)
      && ((e.level.min ?? -Infinity) <= level) && (level <= (e.level.max ?? Infinity)))
  }

  /** enchant.mjs:42-48 */
  get enchantableTypes() {
    return Object.entries(CONFIG.Item.dataModels).reduce((set, [k, v]) => {
      if (v.metadata?.enchantable) set.add(k)
      return set
    }, new Set())
  }

  /** enchant.mjs:56-59 */
  get existingEnchantment() {
    return this.enchant.self ? this.item.effects.find(e => e.isAppliedEnchantment && (e.origin === this.uuid)) : undefined
  }

  /** enchant.mjs:66-72; 6.0.5's :66-72 for its profiles. */
  _prepareUsageConfig(config) {
    config = super._prepareUsageConfig(config)
    const existingProfile = this.existingEnchantment?.flags.dnd5e?.enchantmentProfile
    const exists = this.style6 ? this.effects.find(p => p._id === existingProfile) : this.item.effects.has(existingProfile)
    config.enchantmentProfile ??= exists ? existingProfile : this.availableEnchantments[0]?._id
    return config
  }

  /** enchant.mjs:84-99 */
  _finalizeMessageConfig(usageConfig, messageConfig, results) {
    super._finalizeMessageConfig(usageConfig, messageConfig, results)
    if (usageConfig.enchantmentProfile) {
      setProperty(messageConfig, 'data.flags.dnd5e.use.enchantmentProfile', usageConfig.enchantmentProfile)
    }
    if (this.existingEnchantment?.flags.dnd5e?.enchantmentProfile === usageConfig.enchantmentProfile) {
      messageConfig.create = false
    }
  }

  /** enchant.mjs:120-134 */
  async _triggerSubsequentActions(config, results) {
    if (!this.enchant.self) return
    const existingEnchantment = this.existingEnchantment
    if (existingEnchantment) await existingEnchantment.delete({ chatMessageOrigin: results.message?.id })
    if (!existingEnchantment || (existingEnchantment.flags.dnd5e?.enchantmentProfile !== config.enchantmentProfile)) {
      const concentration = results.effects.find(e => e.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING))
      this.applyEnchantment(config.enchantmentProfile, this.item, { chatMessage: results.message, concentration, strict: false })
    }
  }

  /** enchant.mjs:153-219, for items on the actor; 6.0.5 finds a profile's effect by its uuid. */
  async applyEnchantment(profile, item, { chatMessage, concentration, strict = true } = {}) {
    const found = this.effects.find(p => p._id === profile)
    const effect = found?.uuid ? fromUuidSync(found.uuid, { strict: false }) : this.item.effects.get(profile)
    if (!effect) return null
    if (strict) {
      const errors = this.canEnchant(item)
      if (errors?.length) {
        errors.forEach(err => screen.notifications.push(err.message))
        return null
      }
    }
    const flags = { enchantmentProfile: profile }
    if (concentration) flags.dependentOn = concentration.uuid
    const enchantmentData = effect.clone({ origin: this.uuid, 'flags.dnd5e': flags }).toObject()
    if (Hooks.call('dnd5e.preApplyEnchantment', item, enchantmentData, { activity: this }) === false) return null
    const enchantment = await ActiveEffect5e.create(enchantmentData, {
      parent: item, keepId: true, keepOrigin: true, chatMessageOrigin: chatMessage?.id,
    })
    Hooks.callAll('dnd5e.applyEnchantment', item, enchantment, { activity: this })
    return enchantment
  }

  /** enchant.mjs:228-288, its errors in English. */
  canEnchant(item) {
    const errors = []
    if (!this.restrictions.allowMagical && item.system.properties?.has('mgc') && ('quantity' in item.system)) {
      errors.push(new EnchantmentError('Magical items can\'t be enchanted'))
    }
    if (this.restrictions.type && (item.type !== this.restrictions.type)) {
      errors.push(new EnchantmentError(`A ${item.type} can't be enchanted, only a ${this.restrictions.type}`))
    }
    if (this.restrictions.categories.size && !this.restrictions.categories.has(item.system.type?.value)) {
      errors.push(new EnchantmentError(`Only ${[...this.restrictions.categories].join(' or ')}`))
    }
    if (this.restrictions.properties.size
      && ![...this.restrictions.properties].some(p => item.system.properties?.has(p))) {
      errors.push(new EnchantmentError(`Missing ${[...this.restrictions.properties].join(' or ')}`))
    }
    Hooks.callAll('dnd5e.canEnchant', this, item, errors)
    return errors.length ? errors : true
  }
}
ACTIVITIES.enchant = EnchantActivity

/* -------------------------------------------- */
/*  Midi-QOL                                    */
/* -------------------------------------------- */

/**
 * What Midi-QOL's enchant activity may do that the module must cope with, none of it in Midi's
 * source to hand: `skipPreamble`, its workflow going straight from its start to RollFinished, as
 * ValidateRoll may (Workflow.ts:2101, 2111), so that the concentration it put off is never begun;
 * `selfApply`, an item it applies the enchantment to itself, once its workflow is done, as the
 * card's profile and concentration have it; `abortDeleting`, its workflow aborted once its card is
 * posted, the card deleted, as Workflow.ts:3175-3181 does.
 */
export const midiEnchant = { skipPreamble: false, selfApply: null, abortDeleting: false }

/**
 * Invented: Midi's enchant activity, its own source not being available: as its other activities
 * (MidiActivityMixin.ts), concentration put off until its workflow's PreambleComplete.
 * @param {(Base: typeof Activity) => typeof Activity} MidiActivity   midi-fake.mjs's mixin.
 * @returns {typeof EnchantActivity}
 */
export function midiEnchantActivity(MidiActivity) {
  return class MidiEnchantActivity extends MidiActivity(EnchantActivity) {
    async use(usage = {}, dialog = {}, message = {}) {
      const skip = (activity) => {
        if ((activity.uuid === this.uuid) && midiEnchant.skipPreamble && usage.workflow) {
          usage.workflow.WorkflowState_Start = function () { return this.WorkflowState_RollFinished }
        }
        if ((activity.uuid === this.uuid) && midiEnchant.abortDeleting && usage.workflow) {
          usage.workflow.WorkflowState_Start = async function () {
            await this.chatCard?.delete()
            return this.WorkflowState_Abort
          }
        }
        return true
      }
      Hooks.on('dnd5e.preUseActivity', skip)
      let results
      try {
        results = await super.use(usage, dialog, message)
      } finally {
        Hooks.off('dnd5e.preUseActivity', skip)
      }
      const target = midiEnchant.selfApply
      if (results?.message?.id && target) {
        const card = results.message
        const concentration = this.actor.effects.get(card.system?.concentration)
        await this.applyEnchantment(card.getFlag('dnd5e', 'use.enchantmentProfile'), target, { chatMessage: card, concentration, strict: false })
      }
      return results
    }
  }
}
