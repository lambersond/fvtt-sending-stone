// A player's own effects (module 0.39.0, its contract §1.9), for the harness and the app's e2e
// (through e2e/fvtt): Active Effects as Foundry v14 keeps them, on a character and on its items, each
// updated and deleted as Foundry does, its pre-hook first (`false` stops the write, which resolves
// with nothing, and what a pre-hook adds to the changes is written with them), then the hook every
// client hears; dnd5e's `isTemporary`, from the duration and still so while turned off; the effects
// a character's concentrations keep up; who an effect came from, by Foundry's fromUuidSync over the
// world's actors, their items and effects; and the fixtures of the contract's §1.2. Written from
// Foundry's behaviour and dnd5e's, not ported; built on dish-core.mjs's withDishes, which creates
// and deletes a character's own effects through createEmbeddedDocuments and deleteEmbeddedDocuments.
// Import after stub.mjs, dice-core.mjs and dish-core.mjs's installDishCore.
import { withDishes } from './dish-core.mjs'

const { getProperty, setProperty } = foundry.utils

/** A flat change, `{"a.b": 1}`, or a nested one, as the paths it sets. */
function flatten(object, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(object ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && (typeof value === 'object') && !Array.isArray(value) && !(value instanceof Set) && (value.constructor === Object)) {
      flatten(value, path, out)
    } else out[path] = value
  }
  return out
}

/**
 * What the harness switches per effect, by its id: `throwOn` makes its next write throw, before it
 * changes anything (`'before'`) or once it's gone (`'gone'`, a delete only: as one deleted meanwhile
 * by what kept it up); `cancel` stops its writes as a module's pre-hook returning `false` would.
 * @type {{throwOn: Map<string, "before"|"gone">, cancel: Set<string>}}
 */
export const faults = { throwOn: new Map(), cancel: new Set() }

/** Every write made, in order: `{op, id, changes, options}`, for the harness to count. */
export const writes = []

/** Foundry's embedded collection, as far as effects and items use one: by id, iterating its documents. */
export class Embedded extends Map {
  *[Symbol.iterator]() { yield* this.values() }
  get contents() { return [...this.values()] }
  find(fn) { return this.contents.find(fn) }
  filter(fn) { return this.contents.filter(fn) }
  some(fn) { return this.contents.some(fn) }
  map(fn) { return this.contents.map(fn) }
}

let effectIds = 0

/**
 * An Active Effect as Foundry v14 keeps one, on an actor or on an item: its source, and what's
 * prepared from it. dnd5e's `isTemporary` (D5 documents/active-effect.mjs:135-137): a duration in
 * rounds, turns or seconds, or dnd5e's own flag, unless concealed, and still so while turned off;
 * suppressed once expired, as core's expiry leaves it, or where its source says so (an unequipped
 * item's); `dependentOrigin` as dnd5e reads a rider's, where its source names one.
 */
export class PlainEffect {
  constructor(parent, data = {}) {
    this.id = data._id ?? `plainfx${String(++effectIds).padStart(9, '0')}`
    this._id = this.id
    this.parent = parent
    this.documentName = 'ActiveEffect'
    this._source = { transfer: parent?.documentName === 'Item', ...structuredClone({ ...data, _id: this.id }) }
    this._stats = { createdTime: Date.now() }
    /** The effects a concentration keeps up, as dnd5e's flags name them: see concentrateOn. */
    this.dependents = []
    this.prepare()
  }

  get uuid() { return `${this.parent.uuid}.ActiveEffect.${this.id}` }
  get isTemporary() {
    if (this.system?.isConcealed) return false
    const { rounds, turns, seconds, value } = this.duration ?? {}
    return [rounds, turns, seconds, value].some(each => Number(each) > 0) || (this.getFlag('dnd5e', 'isTemporary') === true)
  }
  get isSuppressed() { return (this.duration?.expired === true) || (this._source.suppressed === true) }
  get active() { return !this.disabled && !this.isSuppressed }

  prepare() {
    const source = this._source
    Object.assign(this, {
      name: source.name, type: source.type ?? 'base', img: source.img ?? null, description: source.description ?? '',
      origin: source.origin ?? null, transfer: source.transfer === true, disabled: source.disabled === true,
      statuses: new Set(source.statuses ?? []), start: structuredClone(source.start ?? null),
      duration: { expired: false, ...structuredClone(source.duration ?? {}) },
      system: structuredClone(source.system ?? {}), flags: structuredClone(source.flags ?? {}),
      dependentOrigin: source.dependentOrigin ?? null,
    })
  }

  getFlag(scope, key) { return getProperty(this.flags?.[scope] ?? {}, key) }
  getDependents() { return [...this.dependents] }
  toObject() { return structuredClone(this._source) }

  /**
   * As Foundry's: the changes expanded, as a pre-hook reads them, and its hook first, whose `false`
   * stops the write, resolving with nothing, and whatever it adds is written too; then the source
   * changed, prepared again, and every client's hook.
   */
  async update(changes = {}, options = {}) {
    writes.push({ op: 'update', id: this.id, changes: structuredClone(changes), options: structuredClone(options) })
    if (faults.throwOn.has(this.id)) throw new Error(`${this.name} could not be updated`)
    const expanded = foundry.utils.expandObject(flatten(changes))
    if (faults.cancel.has(this.id)) return undefined
    if ((typeof Hooks.call === 'function') && (Hooks.call('preUpdateActiveEffect', this, expanded, options, game.user?.id) === false)) return undefined
    for (const [path, value] of Object.entries(flatten(expanded))) setProperty(this._source, path, value)
    this.prepare()
    await Hooks.callAll('updateActiveEffect', this, expanded, options, game.user?.id)
    return this
  }

  /**
   * As Foundry's: its pre-hook first, whose `false` stops it; then gone from its parent, an item's
   * effects or the actor's own through deleteEmbeddedDocuments, which throws for one not held, and
   * every client's hook.
   */
  async delete(options = {}) {
    writes.push({ op: 'delete', id: this.id, options: structuredClone(options) })
    const fault = faults.throwOn.get(this.id)
    if (fault === 'gone') {
      faults.throwOn.delete(this.id)
      await removeFrom(this, options)
      throw new Error(`ActiveEffect ${this.id} does not exist`)
    }
    if (fault) throw new Error(`${this.name} could not be deleted`)
    if (faults.cancel.has(this.id)) return undefined
    if ((typeof Hooks.call === 'function') && (Hooks.call('preDeleteActiveEffect', this, options, game.user?.id) === false)) return undefined
    await removeFrom(this, options)
    return this
  }
}

/** Take an effect from its parent as Foundry deletes one, firing deleteActiveEffect. */
async function removeFrom(effect, options) {
  const parent = effect.parent
  if (parent?.documentName === 'Item') {
    if (!parent.effects.has(effect.id)) throw new Error(`ActiveEffect ${effect.id} does not exist`)
    parent.effects.delete(effect.id)
    await Hooks.callAll('deleteActiveEffect', effect, options, game.user?.id)
    return
  }
  await parent.deleteEmbeddedDocuments('ActiveEffect', [effect.id])
}

/**
 * Give a character what its effects need (round 0.39.0 §1.9): withDishes' own effects, created and
 * deleted through the actor; items, each with effects of its own; `allApplicableEffects` yielding the
 * actor's effects and its items' transferred ones, as core's does, leaving out what dnd5e drops, an
 * item's riders (D5 documents/actor/actor.mjs:361-367); `hasPlayerOwner`, as core's says whether a
 * player owns it; and a concentration, where the actor has none, as dnd5e's getter has it.
 * @param {object} actor
 * @param {object} [options]   As withDishes takes them.
 * @returns {object}   withDishes' port.
 */
export function withEffects(actor, options = {}) {
  const port = withDishes(actor, options)
  if (!(actor.items instanceof Map)) actor.items = new Embedded()
  actor.hasPlayerOwner ??= (actor.owners ?? []).length > 0
  actor.allApplicableEffects = function* () {
    yield* actor.effects
    for (const item of actor.items.values()) {
      const riders = item.getFlag?.('dnd5e', 'riders.effect') ?? []
      for (const effect of item.effects ?? []) if (effect.transfer && !riders.includes(effect.id)) yield effect
    }
  }
  if (!('concentration' in actor)) {
    Object.defineProperty(actor, 'concentration', {
      configurable: true,
      get() { return { items: new Set(), effects: new Set(actor.effects.filter(effect => effect.statuses?.has('concentrating'))) } },
    })
  }
  return port
}

/**
 * An item on a character, as Foundry's embedded Item, as far as an effect reads one: its actor, its
 * uuid, whether it's identified, its flags, and its effects.
 * @param {object} actor
 * @param {{_id: string, name: string, type?: string, identified?: boolean, flags?: object}} data
 * @returns {object}
 */
export function itemOn(actor, { _id, name, type = 'feat', identified = true, flags = {} }) {
  const item = {
    id: _id, _id, name, type, documentName: 'Item', parent: actor, img: `icons/${_id}.webp`,
    get actor() { return actor },
    get uuid() { return `${actor.uuid}.Item.${_id}` },
    system: { identified, description: { value: '' } },
    flags: structuredClone(flags),
    effects: new Embedded(),
    getFlag(scope, key) { return getProperty(this.flags?.[scope] ?? {}, key) },
  }
  actor.items.set(_id, item)
  return item
}

/**
 * An effect on an item, transferred to its actor unless said otherwise.
 * @param {object} item
 * @param {object} data
 * @returns {PlainEffect}
 */
export function effectOnItem(item, data) {
  const effect = new PlainEffect(item, { transfer: true, ...data })
  item.effects.set(effect.id, effect)
  return effect
}

/**
 * An effect on a character itself, as one already there: no hook fires.
 * @param {object} actor
 * @param {object} data
 * @returns {PlainEffect}
 */
export function effectOn(actor, data) {
  const effect = new PlainEffect(actor, data)
  actor.effects.push(effect)
  return effect
}

/**
 * Make an effect a concentration of its actor's, as dnd5e's createConcentrationEffectData does: the
 * Concentrating status, and the effects it keeps up, as its `getDependents()` lists them, wherever
 * they are.
 * @param {object} actor
 * @param {PlainEffect} effect   On `actor`.
 * @param {PlainEffect[]} [dependents]
 * @returns {PlainEffect}
 */
export function concentrateOn(actor, effect, dependents = []) {
  effect._source.statuses = [...new Set([...(effect._source.statuses ?? []), 'concentrating'])]
  effect.prepare()
  effect.dependents = [...dependents]
  if (!actor.effects.includes(effect)) actor.effects.push(effect)
  return effect
}

/**
 * Foundry's fromUuidSync, for the world's actors, their items and their effects, an item's among
 * them: `Actor.<id>`, `….Item.<id>`, `….ActiveEffect.<id>`. Anything else, or nothing there, throws
 * where it's strict, as core's does, else is null.
 * @param {string} uuid
 * @param {{strict?: boolean}} [options]
 * @returns {object|null}
 */
export function fromUuidSync(uuid, { strict = true } = {}) {
  const parts = String(uuid ?? '').split('.')
  let found = (parts[0] === 'Actor') ? (game.actors.get(parts[1]) ?? null) : null
  for (let i = 2; found && (i < parts.length); i += 2) {
    const [type, id] = [parts[i], parts[i + 1]]
    if (type === 'Item') found = found.items?.get?.(id) ?? null
    else if (type === 'ActiveEffect') found = Array.from(found.effects ?? []).find(effect => effect.id === id) ?? null
    else found = null
  }
  if (!found && strict) throw new Error(`No document ${uuid}`)
  return found ?? null
}

/**
 * Put in place what the module's effect code calls on Foundry and dnd5e: fromUuidSync, where the
 * world has none; and dnd5e's staticID (D5 utils.mjs:455-458), which names its conditions' effects.
 * @returns {void}
 */
export function installEffectsCore() {
  globalThis.fromUuidSync ??= fromUuidSync
  globalThis.dnd5e ??= {}
  dnd5e.utils ??= {}
  dnd5e.utils.staticID ??= id => ((id.length >= 16) ? id.substring(0, 16) : id.padEnd(16, '0'))
}

/**
 * The contract's §1.2 fixtures: on `thorin`, Alice's, every effect of its table, with Vex's, Bob's,
 * spells and concentration, the bandit's and the cultist's, NPCs no player owns; and Boots of Speed's
 * temporary effect, suppressed on its item. Each by its name, its items' too. With `dnd5e6`, Prone is a `type: "condition"` effect, as dnd5e 6 makes one, and so is
 * its concentration; and Invisibility gives a `type: "condition"` Invisible of its own, which no rule
 * but the condition one keeps from its player.
 * @param {{thorin: object, vex: object, bandit: object, cultist: object}} actors   Each given withEffects.
 * @param {{dnd5e6?: boolean}} [options]
 * @returns {Record<string, PlainEffect|object>}
 */
export function partyEffects({ thorin, vex, bandit, cultist }, { dnd5e6 = false } = {}) {
  const spell = (actor, id, name) => actor.items.get(id) ?? itemOn(actor, { _id: id, name, type: 'spell' })
  const rounds = n => ({ rounds: n, value: n, units: 'rounds', remaining: n, label: `${n} Rounds` })
  const minutes = n => ({ seconds: n * 60, value: n, units: 'minutes', remaining: n * 60, label: `${n} Minute${(n === 1) ? '' : 's'}` })
  const hours = n => ({ seconds: n * 3600, value: n, units: 'hours', remaining: n * 3600, label: `${n} Hour${(n === 1) ? '' : 's'}` })
  const fx = {}
  for (const [id, name] of [['blessSpell', 'Bless'], ['invisibility', 'Invisibility'], ['shieldOfFaith', 'Shield of Faith'], ['heroism', 'Heroism']]) {
    fx[`${id}Item`] = spell(vex, id, name)
  }
  fx.baneItem = spell(bandit, 'bane', 'Bane')
  fx.holdPersonItem = spell(cultist, 'holdPerson', 'Hold Person')
  fx.mageArmorItem = spell(thorin, 'mageArmor', 'Mage Armor')
  fx.hasteItem = spell(thorin, 'haste', 'Haste')

  // Vex concentrates on Bless, which keeps Thorin's Bless up.
  fx.vexConcentration = concentrateOn(vex, effectOn(vex, {
    _id: 'vexBlessConc', name: 'Concentrating: Bless', type: dnd5e6 ? 'condition' : 'base', duration: minutes(1),
    origin: fx.blessSpellItem.uuid, flags: { dnd5e: { item: { id: 'blessSpell', type: 'spell' } } },
  }))
  fx.bless = effectOn(thorin, { _id: 'bless', name: 'Bless', duration: rounds(9), origin: fx.vexConcentration.uuid, flags: { dnd5e: { dependentOn: fx.vexConcentration.uuid } } })
  fx.vexConcentration.dependents.push(fx.bless)
  fx.invisibility = effectOn(thorin, { _id: 'invisibility', name: 'Invisibility', duration: hours(1), statuses: ['invisible'], origin: fx.invisibilityItem.uuid })
  fx.shieldOfFaith = effectOn(thorin, {
    _id: 'shieldOfFaith', name: 'Shield of Faith', duration: minutes(10), disabled: true, origin: fx.shieldOfFaithItem.uuid,
    flags: { 'sending-stone': { offByPlayer: true } },
  })
  fx.heroism = effectOn(thorin, { _id: 'heroism', name: 'Heroism', duration: minutes(1), disabled: true, origin: fx.heroismItem.uuid })
  fx.ember = effectOn(thorin, {
    _id: 'emberSkewers', name: 'Ember Skewers (Boon)', duration: hours(24), img: 'modules/sending-stone/icons/dish-boon.svg',
    flags: { 'sending-stone': { dish: { id: 'cmh-ember', app: 'cmrow-ember', card: 'msg-ember', recipe: 'Ember Skewers', outcome: 'boon', cook: 'Thorin', appliedAt: 0, expiresAt: 86_400, seconds: 86_400, maxHp: 0, healed: 0, exhaustion: 0, replaced: null, skipped: [] } } },
  })
  // Turned off from the app before it ran out, so only the rule for one expired keeps Turn on from it.
  fx.mageArmor = effectOn(thorin, {
    _id: 'mageArmor', name: 'Mage Armor', duration: { ...hours(8), remaining: 0, expired: true }, disabled: true, origin: fx.mageArmorItem.uuid,
    flags: { 'sending-stone': { offByPlayer: true } },
  })
  fx.rageItem = thorin.items.get('rage') ?? itemOn(thorin, { _id: 'rage', name: 'Rage', type: 'feat' })
  fx.rage = effectOnItem(fx.rageItem, { _id: 'rageEffect', name: 'Rage', duration: rounds(10), disabled: true })
  fx.ringItem = thorin.items.get('ring') ?? itemOn(thorin, { _id: 'ring', name: 'Ring of Protection', type: 'equipment' })
  fx.ring = effectOnItem(fx.ringItem, { _id: 'ringEffect', name: 'Ring of Protection' })
  // Temporary, on, and on an item whose effects dnd5e suppresses, as it does an unequipped item's:
  // listed as unavailable, and never turned off from the app, which would leave it off once worn.
  fx.bootsItem = thorin.items.get('boots') ?? itemOn(thorin, { _id: 'boots', name: 'Boots of Speed', type: 'equipment' })
  fx.boots = effectOnItem(fx.bootsItem, { _id: 'bootsHaste', name: 'Boots of Speed', duration: rounds(10), suppressed: true })
  fx.ravenQueen =effectOn(thorin, { _id: 'ravenQueen', name: 'Blessing of the Raven Queen', origin: thorin.uuid })
  fx.bane = effectOn(thorin, { _id: 'bane', name: 'Bane', duration: minutes(1), origin: fx.baneItem.uuid })
  fx.holdPerson = effectOn(thorin, { _id: 'holdPerson', name: 'Hold Person', duration: minutes(1), statuses: ['paralyzed'], origin: fx.holdPersonItem.uuid })
  fx.prone = dnd5e6
    ? effectOn(thorin, { _id: 'proneCondition', name: 'Prone', type: 'condition', statuses: ['prone'], duration: rounds(1) })
    : effectOn(thorin, { _id: dnd5e.utils.staticID('dnd5eprone'), name: 'Prone', statuses: ['prone'], duration: rounds(1) })
  fx.thorinConcentration = concentrateOn(thorin, effectOn(thorin, {
    _id: 'hasteConc', name: 'Concentrating: Haste', type: dnd5e6 ? 'condition' : 'base', duration: minutes(1), origin: fx.hasteItem.uuid,
    flags: { dnd5e: { item: { id: 'haste', type: 'spell' } } },
  }))
  fx.haste = effectOn(thorin, { _id: 'haste', name: 'Haste', duration: rounds(10), origin: fx.thorinConcentration.uuid, flags: { dnd5e: { dependentOn: fx.thorinConcentration.uuid } } })
  fx.thorinConcentration.dependents.push(fx.haste)
  if (dnd5e6) {
    fx.invisible = effectOn(thorin, { _id: 'invisibleCond', name: 'Invisible', type: 'condition', statuses: ['invisible'], duration: hours(1), origin: fx.invisibilityItem.uuid })
  }
  return fx
}

/**
 * What §1.2's table says each fixture's `ops` are, at the recommended answers, by fixture name: Rage
 * as it starts, off as dnd5e keeps it.
 * @type {Record<string, string[]>}
 */
export const EXPECTED_OPS = Object.freeze({
  bless: ['disable', 'delete'],
  invisibility: ['disable', 'delete'],
  shieldOfFaith: ['enable', 'delete'],
  heroism: ['delete'],
  ember: ['disable', 'delete'],
  mageArmor: ['delete'],
  rage: [],
  ring: [],
  boots: [],
  ravenQueen: [],
  bane: [],
  holdPerson: [],
  prone: [],
  thorinConcentration: [],
  haste: [],
})
