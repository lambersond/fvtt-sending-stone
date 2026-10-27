// dnd5e's transformation, for the harness and the app's e2e (through e2e/fvtt), as module 0.40.0's
// Wild Shape meets it (its contract §10.1): ported from dnd5e 5.3.3's Actor5e#transformInto and
// #revertOriginalForm (module/documents/actor/actor.mjs:2770-3250), its `wildshape` and `polymorph`
// presets (module/config.mjs:3415-3540), TransformationSetting (module/data/settings/
// transformation-setting.mjs) and the Transform activity's data (module/data/activity/
// transform-data.mjs), as far as the module meets them; with 6.0.5's differences where it differs
// (a token's `level` kept, conditions made `type: "condition"`, CONFIG.statusEffects an object).
// Around them, written from dnd5e's and Foundry's behaviour, not ported: actors made from their
// source data and prepared from it (abilities, saves and skills, merged with an original's as
// dnd5e merges them, armor class, proficiency by level or Challenge Rating, a druid's scale values by
// her level, P/classes24/druid/druid.yml:337-387), updated, created and deleted as Foundry does, each
// firing its hooks, its pre-hooks first where Foundry has them; their items (activity5e.mjs's,
// updated through the actor, `preUpdateItem` first); their effects (effects-core.mjs's), a condition
// toggled by its status's static id as core's toggleStatusEffect does, its implied statuses with it;
// scenes' tokens updated in a batch (token-core.mjs's scenes); a canvas showing one scene; and
// compendiums with their indexes, folders and documents, holding dnd5e 5.3.3's own 2024 Beasts, each
// fixture's numbers read from its P file (packs/_source), its art from dnd5e's own mapping
// (json/fa-token-mapping.json); and the contract's druids. Import after stub.mjs, dice-core.mjs and
// the dnd5e dice classes, then call installTransformCore() before the module's scripts start.
import { actors } from './stub.mjs'
import { Character } from './dnd5e-cards.mjs'
import { Activity, Collection, Item5e, activityTypes, itemPreparers } from './activity5e.mjs'
import { PlainEffect, fromUuidSync as worldUuidSync, installEffectsCore } from './effects-core.mjs'
import { installDishCore, setWorldTime } from './dish-core.mjs'
import { faults as tokenFaults, scenes } from './token-core.mjs'
import { DND5E5 } from './paths.mjs'

const { default: HitDice } = await import(`${DND5E5}/module/documents/actor/hit-dice.mjs`)
const { deepClone, getProperty, mergeObject, setProperty } = foundry.utils
const userId = () => game.user?.id ?? 'gm'
const sixth = () => String(game.system?.version ?? '').startsWith('6')

/**
 * What the harness reads and switches: each transformInto and revertOriginalForm called, with what;
 * each TransformationSetting made; each fromUuid asked; each pack index read; each token batch
 * written; and faults: `throwOnTransform` makes the next transformInto throw before it creates
 * anything, `throwOnTokens` the next scenes' token batch, `refuseRevert` the next revert do nothing
 * (as a module's hook might stop it), `moonSpellList` registers Circle of the Moon's spell list.
 */
export const port = {
  transforms: [], reverts: [], settings: [], fromUuid: [], indexes: [], tokenWrites: [], created: [], deleted: [],
  faults: { throwOnTransform: false, throwOnTokens: false, refuseRevert: false, moonSpellList: true },
}

/** A turn of the event loop, as a server's round trip takes at least. */
const turn = () => new Promise(resolve => setImmediate(resolve))

/** Foundry's flat changes, `{"a.b": 1}`, or nested ones, as the paths they set; `-=key` as deletions. */
function flatten(object, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(object ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && (typeof value === 'object') && !Array.isArray(value) && !(value instanceof Set) && (value.constructor === Object) && Object.keys(value).length) {
      flatten(value, path, out)
    } else out[path] = value
  }
  return out
}

/** Write changes into a source as Foundry's update does: each path set, a `-=key` deleting its key. */
function write(source, changes) {
  for (const [path, value] of Object.entries(flatten(changes))) {
    const parts = path.split('.')
    const last = parts.at(-1)
    if (last.startsWith('-=')) {
      const owner = getProperty(source, parts.slice(0, -1).join('.'))
      if (owner && (typeof owner === 'object')) delete owner[last.slice(2)]
      continue
    }
    setProperty(source, path, deepClone(value))
  }
}

/* -------------------------------------------- */
/*  dnd5e's configuration                       */
/* -------------------------------------------- */

/** config.mjs:3415-3540: the categories of a transformation's settings, and its presets. */
const TRANSFORMATION = {
  effects: {
    all: {}, origin: { default: true }, otherOrigin: { default: true }, background: { default: true },
    class: { default: true }, feat: { default: true }, equipment: { default: true }, spell: { default: true },
  },
  keep: {
    physical: {}, mental: {}, saves: {}, skills: {}, gearProf: {}, languages: {}, class: {}, feats: {}, items: {},
    spells: {}, bio: {}, type: {}, hp: {}, tempHP: {}, resistances: {}, vision: { default: true }, self: {},
  },
  merge: { saves: {}, skills: {} },
  other: {},
  presets: {
    wildshape: {
      label: 'Wild Shape',
      settings: {
        effects: new Set(['otherOrigin', 'origin', 'feat', 'spell', 'class', 'background']),
        keep: new Set(['bio', 'class', 'feats', 'hp', 'languages', 'mental', 'tempHP', 'type']),
        merge: new Set(['saves', 'skills']),
        minimumAC: '(13 + @abilities.wis.mod) * sign(@subclasses.moon.levels)',
        spellLists: new Set(['subclass:moon']),
        tempFormula: 'max(@classes.druid.levels, @subclasses.moon.levels * 3)',
      },
    },
    polymorph: {
      label: 'Polymorph',
      settings: {
        effects: new Set(['otherOrigin', 'origin', 'spell']),
        keep: new Set(['hp', 'type']),
        tempFormula: '@source.attributes.hp.max',
      },
    },
  },
}

/**
 * transformation-setting.mjs:15-35: a transformation's settings, its categories as Sets (the defaults
 * those marked so), its formulas, its preset, its spell lists, and whether tokens change (true unless
 * said); `toObject()` with the Sets as arrays, as transformInto's options keep them.
 */
export class TransformationSetting {
  constructor(data = {}) {
    const initial = category => Object.entries(TRANSFORMATION[category]).filter(([, config]) => config.default).map(([key]) => key)
    for (const category of ['effects', 'keep', 'merge', 'other']) this[category] = new Set(data[category] ?? initial(category))
    this.minimumAC = String(data.minimumAC ?? '')
    this.tempFormula = String(data.tempFormula ?? '')
    this.preset = data.preset ?? null
    this.spellLists = new Set(data.spellLists ?? [])
    this.transformTokens = data.transformTokens ?? true
    port.settings.push(this)
  }

  toObject() {
    return {
      effects: [...this.effects], keep: [...this.keep], merge: [...this.merge], other: [...this.other],
      minimumAC: this.minimumAC, preset: this.preset, spellLists: [...this.spellLists], tempFormula: this.tempFormula,
      transformTokens: this.transformTokens,
    }
  }
}

/**
 * utils.mjs:434-444's simplifyBonus, for the formulas transformations use: numbers, `@` paths of the
 * roll data, + - * /, parentheses, `max`, `min` and `sign`. A path the roll data hasn't, as a druid's
 * `@subclasses.moon.levels` outside the Moon, counts as 0 [core, unverified: how core's Roll treats an
 * unmatched key, map §1.8]; anything else unreadable is 0, as simplifyBonus answers a parse error.
 */
export function simplifyBonus(formula, data = {}) {
  const text = String(formula ?? '').trim()
  if (!text) return 0
  const replaced = text.replace(/@([\w.-]+)/g, (_, path) => {
    const value = Number(getProperty(data, path))
    return Number.isFinite(value) ? `(${value})` : '(0)'
  })
  if (!/^[\d\s+\-*/().,a-z]*$/i.test(replaced) || /[a-z]/i.test(replaced.replace(/\b(max|min|sign)\b/g, ''))) return 0
  try {
    const value = Function('max', 'min', 'sign', `"use strict"; return (${replaced});`)(Math.max, Math.min, Math.sign)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/** dnd5e's skills, each with its ability (config.mjs). */
const SKILLS = {
  acr: 'dex', ani: 'wis', arc: 'int', ath: 'str', dec: 'cha', his: 'int', ins: 'wis', itm: 'cha', inv: 'int', med: 'wis',
  nat: 'int', prc: 'wis', prf: 'cha', per: 'cha', rel: 'int', slt: 'dex', ste: 'dex', sur: 'wis',
}

/** config.mjs's conditions and the statuses dnd5e gives them, with the two status effects the module ends at. */
const STATUSES = {
  blinded: {}, charmed: {}, deafened: {}, exhaustion: {}, frightened: {}, grappled: {}, incapacitated: {}, invisible: {},
  paralyzed: { statuses: ['incapacitated'] }, petrified: { statuses: ['incapacitated'] }, poisoned: {}, prone: {},
  restrained: {}, stunned: { statuses: ['incapacitated'] }, unconscious: { statuses: ['incapacitated'], riders: ['prone'] },
}
const STATUS_EFFECTS = { dead: {}, sleeping: { statuses: ['incapacitated', 'unconscious'] }, concentrating: {} }

/**
 * dnd5e.mjs:421-437 (6.0.5's :447-468): each status effect with its static id, `staticID("dnd5e<id>")`;
 * a list under dnd5e 5, an object by id under 6.
 * @returns {object[]}
 */
function statusEffects() {
  const list = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {})
  return list
}

/**
 * Put in place what dnd5e's transformation and the module's Wild Shape call on Foundry and dnd5e, as
 * far as each world hasn't: dish-core's clock, rest and tables; effects-core's fromUuidSync and
 * staticID; dnd5e's transformation config and TransformationSetting, sizes, creature types, movement
 * and senses, status effects (a list under dnd5e 5, an object under 6) and the abilities' types;
 * dnd5e's default units and `utils.defaultUnits`, its metric settings off;
 * Actor.implementation; a canvas showing token-core's viewed scene; `game.packs`; fromUuid and
 * fromUuidSync for compendium documents; escapeHTML.
 * @returns {void}
 */
export function installTransformCore() {
  installDishCore()
  installEffectsCore()
  const DND5E = CONFIG.DND5E
  DND5E.transformation = TRANSFORMATION
  // dnd5e's (D5/config.mjs:2500-2508, D5/utils.mjs:775-778), its metric settings off: the units a
  // creature's speeds saved with none (`units: null`, as every 2024 Beast's are) are prepared with.
  DND5E.defaultUnits = { length: { imperial: 'ft', metric: 'm' }, travel: { imperial: 'mph', metric: 'kph' }, ...(DND5E.defaultUnits ?? {}) }
  dnd5e.utils.defaultUnits ??= type => CONFIG.DND5E.defaultUnits[type]?.imperial
  DND5E.actorSizes = {
    tiny: { label: 'Tiny' }, sm: { label: 'Small' }, med: { label: 'Medium' }, lg: { label: 'Large' }, huge: { label: 'Huge' },
    grg: { label: 'Gargantuan' }, ...(DND5E.actorSizes ?? {}),
  }
  DND5E.creatureTypes = {
    beast: { label: 'Beast' }, celestial: { label: 'Celestial' }, humanoid: { label: 'Humanoid' }, giant: { label: 'Giant' },
    ...(DND5E.creatureTypes ?? {}),
  }
  DND5E.movementTypes = { walk: 'Walk', burrow: 'Burrow', climb: 'Climb', fly: 'Fly', swim: 'Swim', ...(DND5E.movementTypes ?? {}) }
  DND5E.movementUnits = { ft: { label: 'Feet', abbreviation: 'ft' }, ...(DND5E.movementUnits ?? {}) }
  DND5E.senses = { blindsight: 'Blindsight', darkvision: 'Darkvision', tremorsense: 'Tremorsense', truesight: 'Truesight' }
  DND5E.abilities ??= {}
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    DND5E.abilities[key] = { label: key.toUpperCase(), abbreviation: key, ...(DND5E.abilities[key] ?? {}),
      type: ['str', 'dex', 'con'].includes(key) ? 'physical' : 'mental' }
  }
  DND5E.skills = { ...Object.fromEntries(Object.entries(SKILLS).map(([key, ability]) => [key, { label: key, ability }])), ...(DND5E.skills ?? {}) }
  DND5E.conditionTypes = { ...Object.fromEntries(Object.keys(STATUSES).map(key => [key, { label: key }])), ...(DND5E.conditionTypes ?? {}) }
  const effects = Object.entries({ ...STATUS_EFFECTS, ...STATUSES }).map(([id, data]) => ({
    id, _id: dnd5e.utils.staticID(`dnd5e${id}`), name: id.charAt(0).toUpperCase() + id.slice(1), img: `systems/dnd5e/icons/svg/statuses/${id}.svg`, ...data,
  }))
  CONFIG.statusEffects = sixth() ? Object.fromEntries(effects.map(effect => [effect.id, effect])) : effects
  CONFIG.specialStatusEffects = { CONCENTRATING: 'concentrating', ...(CONFIG.specialStatusEffects ?? {}) }
  dnd5e.dataModels ??= {}
  dnd5e.dataModels.settings = { ...(dnd5e.dataModels.settings ?? {}), TransformationSetting }
  dnd5e.registry ??= {}
  dnd5e.registry.spellLists = {
    forType: id => ((id === 'subclass:moon') && port.faults.moonSpellList ? MOON_SPELLS : null),
  }
  foundry.utils.escapeHTML ??= value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
  foundry.utils.randomID ??= () => Math.random().toString(36).slice(2, 18).padEnd(16, '0')
  foundry.utils.isEmpty ??= value => !value || !Object.keys(value).length
  globalThis.Actor = { implementation: { create: TActor.create, deleteDocuments: TActor.deleteDocuments, updateDocuments: TActor.updateDocuments } }

  // The Gamemaster's canvas, ready, showing token-core's viewed scene (its faults.canvasScene, else the active one).
  const canvas = globalThis.canvas ?? {}
  Object.defineProperty(canvas, 'ready', { configurable: true, get: () => true })
  Object.defineProperty(canvas, 'scene', { configurable: true, get: () => viewedScene() })
  globalThis.canvas = canvas

  game.packs = packs
  const before = globalThis.fromUuidSync
  const beforeAsync = globalThis.fromUuid
  globalThis.fromUuidSync = (uuid, options = {}) => {
    const found = packDocument(uuid)
    if (found !== undefined) return found
    if (String(uuid ?? '').startsWith('Scene.')) return before?.(uuid, options) ?? null
    return worldUuidSync(uuid, { strict: false }) ?? before?.(uuid, options) ?? null
  }
  globalThis.fromUuid = async (uuid, options = {}) => {
    port.fromUuid.push(String(uuid))
    await turn()
    const found = packDocument(uuid)
    if (found !== undefined) return found
    return beforeAsync ? beforeAsync(uuid, options) : globalThis.fromUuidSync(uuid, options)
  }
  activityTypes.transform = TransformActivity
  if (!itemPreparers.includes(prepareItem)) itemPreparers.push(prepareItem)
}

/** The scene the Gamemaster is viewing: token-core's `faults.canvasScene`, else the active one. */
function viewedScene() {
  const viewed = tokenFaults.canvasScene
  return (viewed ? scenes.get(viewed) : null) ?? scenes.active ?? null
}

/* -------------------------------------------- */
/*  Items and activities                        */
/* -------------------------------------------- */

/**
 * The Transform activity, as transform-data.mjs keeps it: its profiles (movement, sizes and types as
 * Sets), its mode, "cr" by default, and preset, and the settings prepareFinalData makes of the preset.
 */
export class TransformActivity extends Activity {
  static type = 'transform'

  constructor(item, data) {
    super(item, { ...data, name: data.name ?? 'Transform' })
    this.profiles = (data.profiles ?? []).map(profile => ({
      ...deepClone(profile), movement: new Set(profile.movement ?? []), sizes: new Set(profile.sizes ?? []), types: new Set(profile.types ?? []),
    }))
    this.transform = { customize: false, mode: 'cr', preset: '', ...deepClone(data.transform ?? {}) }
    this.settings = new TransformationSetting({ ...(TRANSFORMATION.presets[this.transform.preset]?.settings ?? {}), preset: this.transform.preset })
    port.settings.pop()
  }
}

/**
 * An item's data as dnd5e keeps it, its activities in `system.activities` by id, as activity5e's Item5e
 * takes it, its activities a list each with its `id`; a list given as such is taken as it is.
 * @param {object} data
 * @returns {object}
 */
function toItem5e(data) {
  const { system = {}, activities, ...rest } = deepClone(data)
  const list = Array.isArray(activities) ? activities
    : Object.entries(system.activities ?? {}).map(([id, activity]) => ({ ...activity, id: activity._id ?? id }))
  delete system.activities
  return { ...rest, id: data._id ?? data.id, system, activities: list }
}

/**
 * An Item5e's data as dnd5e keeps it, as `toObject()` gives it: its activities in `system.activities`
 * by id, each with its `_id`.
 * @param {Item5e} item
 * @returns {object}
 */
function fromItem5e(item) {
  const { activities = [], id, ...rest } = deepClone(item._source)
  const system = { ...(rest.system ?? {}), activities: Object.fromEntries(activities.map(activity => [activity.id, { ...activity, _id: activity.id }])) }
  return { ...rest, _id: item.id, system }
}

/** Marks an actor of this stand-in's, whose items it prepares as dnd5e does. */
const OWN = Symbol('transform5e')

/**
 * What dnd5e prepares of an item of these actors' that activity5e's Item5e leaves as its source: its
 * sort, labels and identifier; its uses' maximum, a scale value's formula worked out, and what's left;
 * a class's hit dice from its levels; a class's subclass and a subclass's class; and its update and
 * flags written through its actor, as Foundry's, with their hooks.
 * @param {Item5e} item
 */
function prepareItem(item) {
  const actor = item.actor
  if (!actor?.[OWN]) return
  const source = item._source
  item.sort = source.sort ?? 0
  item.labels = deepClone(source.labels ?? {})
  item.identifier = source.system?.identifier ?? null
  item.documentName = 'Item'
  item.effects ??= new Collection()
  const uses = source.system?.uses
  if (uses) {
    item.system.uses = {
      ...deepClone(uses),
      get max() { return Number(simplifyBonus(uses.max, actor.getRollData())) || 0 },
      get spent() { return Number(uses.spent) || 0 },
      get value() { return Math.max(this.max - this.spent, 0) },
    }
  }
  if (item.type === 'class') {
    const levels = Number(source.system.levels) || 0
    const hd = source.system.hd ?? {}
    item.system.levels = levels
    item.system.hd = { denomination: hd.denomination ?? 'd8', spent: Number(hd.spent) || 0, max: levels, get value() { return Math.max(this.max - this.spent, 0) } }
    Object.defineProperty(item, 'subclass', {
      configurable: true, get: () => [...actor.items].find(each => (each.type === 'subclass') && (each._source.system?.classIdentifier === item.identifier)) ?? null,
    })
  }
  if (item.type === 'subclass') {
    Object.defineProperty(item, 'class', {
      configurable: true, get: () => [...actor.items].find(each => (each.type === 'class') && (each.identifier === source.system?.classIdentifier)) ?? null,
    })
  }
  item.update = (changes, options = {}) => actor.updateEmbeddedDocuments('Item', [{ _id: item.id, ...changes }], options).then(() => item)
  item.setFlag = (scope, key, value) => item.update({ [`flags.${scope}.${key}`]: value })
  item.getFlag = (scope, key) => getProperty(item.flags?.[scope] ?? {}, key)
  item.toObject = () => fromItem5e(item)
}

/* -------------------------------------------- */
/*  Actors                                      */
/* -------------------------------------------- */

let created = 0

/**
 * An actor of dnd5e's, made from its source data and prepared from it as dnd5e prepares one, its
 * items and effects as Foundry keeps them: a druid, a character, a creature in a compendium, or a form
 * dnd5e made. dnd5e-cards.mjs's Character, so it concentrates and rolls as the harness's others do.
 */
export class TActor extends Character {
  constructor(source, { pack = null } = {}) {
    super({ id: source._id, name: source.name, owners: [] })
    this[OWN] = true
    this.documentName = 'Actor'
    this._source = normalised(source)
    this._stats = { createdTime: source._stats?.createdTime ?? (Date.now() + (++created)) }
    this.compendium = pack
    this.sheet = { rendered: false, async close() {}, render() {} }
    this.items = new Collection()
    for (const data of this._source.items ?? []) {
      const item = new Item5e(this, toItem5e(data))
      this.items.set(item.id, item)
    }
    delete this._source.items
    this.effects = []
    Object.defineProperty(this.effects, 'get', { value: id => this.effects.find(effect => effect.id === id) ?? null })
    for (const data of this._source.effects ?? []) this.effects.push(new PlainEffect(this, data))
    delete this._source.effects
    this.prepare()
  }

  // Actor5e's constructor writes these, which are read here: the writes are let go.
  get uuid() { return this.compendium ? `Compendium.${this.compendium.collection}.Actor.${this.id}` : `Actor.${this.id}` }
  set uuid(_) {}
  get pack() { return this.compendium?.collection ?? null }
  get isToken() { return false }
  get isPolymorphed() { return this.getFlag('dnd5e', 'isPolymorphed') === true }
  get isOwner() { return Boolean(game.user?.isGM) || ((this.ownership?.[game.user?.id] ?? this.ownership?.default ?? 0) >= 3) }
  get hasPlayerOwner() { return game.users.some(user => !user.isGM && this.testUserPermission(user, 'OWNER')) }
  set hasPlayerOwner(_) {}
  get folder() {
    const id = this._source.folder ?? null
    return (this.compendium ? this.compendium.folders.get(id) : null) ?? null
  }
  get statuses() {
    return new Set(this.effects.filter(effect => effect.active !== false).flatMap(effect => [...(effect.statuses ?? [])]))
  }
  get classes() { return Object.fromEntries([...this.items].filter(item => item.type === 'class').map(item => [item.identifier, item])) }
  get itemTypes() {
    const types = { weapon: [], consumable: [], spell: [], feat: [], class: [], subclass: [], equipment: [] }
    for (const item of this.items) (types[item.type] ??= []).push(item)
    return types
  }
  get identifiedItems() {
    return { get: (identifier, type) => new Set([...this.items].filter(item => (item.identifier === identifier) && (item.type === type))) }
  }

  testUserPermission(user, level = 'OWNER') {
    if (user?.isGM) return true
    const want = CONST.DOCUMENT_OWNERSHIP_LEVELS[level] ?? 3
    return (this.ownership?.[user?.id] ?? this.ownership?.default ?? 0) >= want
  }

  getFlag(scope, key) { return getProperty(this.flags?.[scope] ?? {}, key) }
  async setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }) }

  /** As core's: its own effects, then those its items transfer. */
  *allApplicableEffects() {
    yield* this.effects
    for (const item of this.items) {
      for (const effect of item.effects ?? []) if (effect.transfer) yield effect
    }
  }

  /**
   * Prepare from the source as dnd5e does, as far as the module reads: abilities, their saves and
   * checks; skills, merged with an original's where transformed with mergeSkills (creature.mjs:234-265);
   * saves merged with mergeSaves (common.mjs:143-160); hit points, their effective maximum; armor
   * class, ten and Dexterity by default or its flat value; initiative; proficiency by level, or by
   * Challenge Rating for a creature; a druid's scale values by her druid levels; details, traits,
   * spell slots, favorites.
   */
  prepare() {
    const source = this._source
    Object.assign(this, { name: source.name, type: source.type, img: source.img ?? null })
    this.flags = deepClone(source.flags ?? {})
    this.ownership = deepClone(source.ownership ?? { default: 0 })
    this.prototypeToken = deepClone(source.prototypeToken ?? {})
    const system = deepClone(source.system)
    const classes = [...this.items].filter(item => item.type === 'class')
    const level = classes.reduce((sum, item) => sum + (Number(item._source.system?.levels) || 0), 0)
    const cr = system.details?.cr
    const prof = (this.type === 'npc') && !classes.length
      ? Math.max(Math.floor((Math.max(Number(cr) || 0, 1) + 7) / 4), 2)
      : Math.floor((Math.max(level, 1) + 7) / 4)
    const options = this.flags.dnd5e?.transformOptions ?? {}
    const original = this.isPolymorphed ? game.actors?.get(this.flags.dnd5e?.originalActor) : null
    const originalSaves = (original && options.mergeSaves) ? original.system.abilities : null
    const originalSkills = (original && options.mergeSkills) ? original.system.skills : null
    const proficiency = (multiplier = 0) => {
      const flat = Math.floor(multiplier * prof)
      return { multiplier, flat, hasProficiency: (prof > 0) && (multiplier > 0), term: String(flat), clone() { return { ...this } } }
    }

    const abilities = {}
    for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      const given = system.abilities?.[key] ?? {}
      const value = Number(given.value ?? 10)
      const mod = Math.floor((value - 10) / 2)
      const originalAbility = originalSaves?.[key]
      const proficient = originalAbility?.proficient ? originalAbility.proficient : (Number(given.proficient) || 0)
      const saveProf = originalAbility?.proficient ? { ...originalAbility.saveProf } : proficiency(proficient)
      abilities[key] = {
        value, mod, proficient, max: given.max ?? null, merged: Boolean(originalAbility?.proficient),
        check: { roll: { mode: 0, min: null, max: null } },
        save: { roll: { mode: 0, min: null, max: null }, value: mod + (saveProf.hasProficiency ? saveProf.flat : 0) },
        checkProf: proficiency(0), saveProf, bonuses: { check: '', save: '' },
      }
    }
    const skills = {}
    for (const [key, ability] of Object.entries(SKILLS)) {
      const given = system.skills?.[key] ?? {}
      const originalSkill = originalSkills?.[key]
      const value = (originalSkill?.value >= 1) ? originalSkill.value : (Number(given.value) || 0)
      const skillProf = proficiency(value)
      const mod = abilities[ability].mod
      let total = mod + skillProf.flat
      if (originalSkill && ((originalSkill.total ?? 0) > total)) total = originalSkill.total
      skills[key] = {
        ability, value, effectValue: value, proficient: value, prof: skillProf, mod, total, passive: 10 + total,
        roll: { mode: 0, min: null, max: null }, bonuses: { check: '', passive: '' },
      }
    }
    const attributes = system.attributes ?? {}
    const hpSource = attributes.hp ?? {}
    const hp = {
      value: Number(hpSource.value ?? 0), max: Number(hpSource.max ?? 0), temp: Number(hpSource.temp) || 0, tempmax: Number(hpSource.tempmax) || 0,
      get effectiveMax() { return Math.max(this.max + this.tempmax, 0) },
    }
    const acSource = attributes.ac ?? {}
    const calc = acSource.calc ?? 'default'
    const ac = { calc, flat: acSource.flat ?? null, value: ['natural', 'flat'].includes(calc) ? Number(acSource.flat) : 10 + abilities.dex.mod }
    const movement = { units: attributes.movement?.units ?? 'ft', hover: attributes.movement?.hover === true }
    for (const key of ['walk', 'burrow', 'climb', 'fly', 'swim']) {
      const speed = Number(attributes.movement?.[key])
      if (Number.isFinite(speed) && (speed > 0)) movement[key] = speed
    }
    movement.speed = movement.walk ?? 0
    const typeValue = system.details?.type?.value ?? null
    this.system = {
      ...system,
      abilities,
      skills,
      tools: {},
      attributes: {
        ...attributes, prof, hp, ac, movement,
        senses: { units: 'ft', special: '', ...(attributes.senses ?? {}), ranges: { ...(attributes.senses?.ranges ?? {}) } },
        init: { ability: 'dex', mod: abilities.dex.mod, total: abilities.dex.mod, prof: { hasProficiency: false }, bonus: 0, roll: { mode: 0 } },
        exhaustion: Number(attributes.exhaustion) || 0,
        inspiration: attributes.inspiration === true,
        death: { success: Number(attributes.death?.success) || 0, failure: Number(attributes.death?.failure) || 0, roll: { mode: 0 }, bonuses: { save: '' } },
        concentration: { ability: 'con', limit: 1, roll: { mode: 0, max: null, min: null }, bonuses: { save: '' } },
      },
      details: {
        ...(system.details ?? {}), level,
        type: { ...(system.details?.type ?? {}), value: typeValue, label: CONFIG.DND5E.creatureTypes?.[typeValue]?.label ?? null },
        biography: { value: '', public: '', ...(system.details?.biography ?? {}) },
      },
      traits: {
        ...(system.traits ?? {}),
        languages: { value: new Set(system.traits?.languages?.value ?? []), custom: system.traits?.languages?.custom ?? '' },
        ci: { value: new Set() }, dr: { value: new Set() }, dv: { value: new Set() }, di: { value: new Set() },
      },
      spells: deepClone(system.spells ?? {}),
      scale: scaleOf(this),
      favorites: deepClone(system.favorites ?? []),
      bonuses: {
        abilities: { check: '', save: '', skill: '' }, mwak: { damage: '' }, rwak: { damage: '' }, msak: { damage: '' }, rsak: { damage: '' },
        save: { damage: '' }, heal: { damage: '' }, other: { damage: '' }, spell: { dc: '' },
      },
    }
    if (this.type === 'npc') this.system.details.cr = cr ?? null
    Object.defineProperty(this.system.attributes, 'hd', { configurable: true, get: () => new HitDice(this) })
  }

  /**
   * creature.mjs:310-323: the roll data, with each class's levels and each subclass's, by identifier;
   * the scale values; the abilities, attributes and details.
   */
  getRollData() {
    const classes = {}
    const subclasses = {}
    for (const [identifier, item] of Object.entries(this.classes)) {
      classes[identifier] = { levels: item.system.levels }
      const sub = item.subclass
      if (sub) subclasses[sub.identifier] = { levels: item.system.levels }
    }
    return {
      abilities: deepClone(this.system.abilities), attributes: deepClone(this.system.attributes), details: deepClone(this.system.details),
      prof: this.system.attributes.prof, classes, subclasses, scale: deepClone(this.system.scale),
    }
  }

  /** As Foundry's: the source, its items and effects too. */
  toObject() {
    return deepClone({
      ...this._source, _id: this.id, name: this.name, type: this.type, img: this.img,
      flags: this.flags, ownership: this.ownership, prototypeToken: this.prototypeToken,
      items: [...this.items].map(item => item.toObject()),
      effects: this.effects.map(effect => effect.toObject()),
    })
  }

  /** Foundry's getTokenDocument, as far as `toObject()`: the prototype token's data, the actor's own. */
  async getTokenDocument() {
    const data = { ...deepClone(this.prototypeToken), actorId: this.id, actorLink: this.prototypeToken.actorLink ?? true }
    return { toObject: () => deepClone(data) }
  }

  /** The token images a creature's prototype token may take: its own, as dnd5e's art mapping resolves a wildcard. */
  async getTokenImages() { return [this.prototypeToken?.texture?.src].filter(Boolean) }

  /** As core's: tokens of this actor, linked, on the viewed scene. */
  getActiveTokens() {
    const viewed = viewedScene()
    return viewed ? viewed.tokens.filter(token => token.actorLink && (token.actorId === this.id)).map(token => token.object) : []
  }

  /**
   * As Foundry's update: the changes expanded, as a pre-hook reads them, whose `false` stops the write;
   * then the source written, a `-=key` deleting it, prepared again, and every client's updateActor.
   */
  async update(changes = {}, options = {}) {
    const expanded = foundry.utils.expandObject(flatten(changes))
    if ((typeof Hooks.call === 'function') && (Hooks.call('preUpdateActor', this, expanded, options, userId()) === false)) return undefined
    await turn()
    write(this._source, expanded)
    this.prepare()
    await Hooks.callAll('updateActor', this, expanded, options, userId())
    return this
  }

  /** As Foundry's: its items each through `preUpdateItem`, whose `false` stops that one, then written, then `updateItem`. */
  async updateEmbeddedDocuments(type, updates = [], options = {}) {
    if (type !== 'Item') throw new Error(`No ${type} here`)
    await turn()
    const done = []
    for (const { _id, ...changes } of updates) {
      const item = this.items.get(_id)
      if (!item) continue
      const expanded = foundry.utils.expandObject(flatten(changes))
      if ((typeof Hooks.call === 'function') && (Hooks.call('preUpdateItem', item, expanded, options, userId()) === false)) continue
      item.updateSource(expanded)
      done.push([item, expanded])
    }
    if (done.length) this.prepare()
    for (const [item, expanded] of done) await Hooks.callAll('updateItem', item, expanded, options, userId())
    return done.map(([item]) => item)
  }

  /** As Foundry's: each effect with the id it's given, kept, then createActiveEffect. */
  async createEmbeddedDocuments(type, list = [], options = {}) {
    if (type !== 'ActiveEffect') throw new Error(`No ${type} here`)
    await turn()
    const made = list.map(data => new PlainEffect(this, data))
    this.effects.push(...made)
    for (const effect of made) await Hooks.callAll('createActiveEffect', effect, options, userId())
    return made
  }

  /** As Foundry's: one not held throws before anything's deleted; then each gone, then deleteActiveEffect. */
  async deleteEmbeddedDocuments(type, ids = [], options = {}) {
    if (type !== 'ActiveEffect') throw new Error(`No ${type} here`)
    for (const id of ids) if (!this.effects.some(effect => effect.id === id)) throw new Error(`ActiveEffect ${id} does not exist`)
    await turn()
    const gone = []
    for (const id of ids) {
      const index = this.effects.findIndex(effect => effect.id === id)
      if (index >= 0) gone.push(...this.effects.splice(index, 1))
    }
    for (const effect of gone) await Hooks.callAll('deleteActiveEffect', effect, options, userId())
    return gone
  }

  /**
   * Core's toggleStatusEffect (v12-14) for a status with a static id: the effect of that id, deleted to
   * turn it off; else created with that id, its status and those it implies, dnd5e 6's of type
   * "condition".
   */
  async toggleStatusEffect(statusId, { active } = {}) {
    const status = statusEffects().find(each => each.id === statusId)
    if (!status) throw new Error(`Invalid status ID "${statusId}" provided to Actor#toggleStatusEffect`)
    const existing = this.effects.filter(effect => effect.id === status._id)
    if (existing.length) {
      if (active) return true
      for (const effect of existing) await effect.delete()
      return false
    }
    if (active === false) return false
    const [effect] = await this.createEmbeddedDocuments('ActiveEffect', [{
      _id: status._id, name: status.name, img: status.img, statuses: [status.id, ...(status.statuses ?? [])],
      ...(sixth() ? { type: 'condition', system: { type: status.id } } : {}),
    }], { keepId: true })
    return effect
  }

  /** actor.mjs:1065-1108: one concentration ended, by its effect, deleting what it keeps up. */
  async endConcentration(target) {
    const effect = (typeof target === 'string') ? this.effects.find(each => each.id === target) : target
    if (!effect || !this.effects.includes(effect)) return []
    if (Hooks.call('dnd5e.preEndConcentration', this, effect) === false) return []
    await effect.delete()
    for (const dependent of effect.getDependents?.() ?? []) {
      const holder = dependent.parent
      if (holder?.effects?.includes?.(dependent)) await dependent.delete()
    }
    this.ended.push(effect.name)
    Hooks.callAll('dnd5e.endConcentration', this, effect)
    return [effect]
  }

  /** As Foundry's: through Actor.implementation.deleteDocuments. */
  async delete(options = {}) {
    await TActor.deleteDocuments([this.id], options)
    return this
  }

  /** As Foundry's Actor.create: a world actor of its own, with a new id, then createActor on every client. */
  static async create(data, options = {}) {
    const source = deepClone(data)
    source._id = (options.keepId && source._id) ? source._id : foundry.utils.randomID()
    // The character type's schema has no Challenge Rating, which a creature's data brings.
    if ((source.type === 'character') && source.system?.details) delete source.system.details.cr
    await turn()
    const actor = new TActor(source)
    actors.set(actor.id, actor)
    port.created.push(actor.id)
    await Hooks.callAll('createActor', actor, options, userId())
    return actor
  }

  /** As Foundry's: each gone from the world, then deleteActor for each, with the options given. */
  static async deleteDocuments(ids = [], options = {}) {
    await turn()
    const gone = ids.map(id => game.actors.get(id)).filter(Boolean)
    for (const actor of gone) actors.delete(actor.id)
    port.deleted.push(...gone.map(actor => actor.id))
    for (const actor of gone) await Hooks.callAll('deleteActor', actor, options, userId())
    return gone
  }

  /** As Foundry's: each update made through its actor. */
  static async updateDocuments(updates = [], options = {}) {
    const done = []
    for (const { _id, ...changes } of updates) {
      const actor = game.actors.get(_id)
      if (actor) done.push(await actor.update(changes, options))
    }
    return done
  }

  /**
   * actor.mjs:2770-3126, for a world actor: a non-Gamemaster without Allow Polymorphing gets nothing;
   * the form's data built from hers and the source's as the settings say, with "{name} ({source})",
   * its flags naming her (`originalActor`, `isPolymorphed`, `previousActorIds`); dnd5e.transformActor
   * and dnd5e.transformActorV2 told of it, the data by reference, before it's created; then, unless
   * `transformTokens` is false, her linked tokens on the viewed scene alone switched to it. Returns the
   * tokens updated, never the form. Faults: `throwOnTransform` throws before anything's made. A
   * token's own transformation isn't ported: it returns null.
   */
  async transformInto(source, settings = new TransformationSetting(), options = {}) {
    port.transforms.push({ host: this.id, source: source?.uuid ?? null, settings: settings.toObject(), options: deepClone(options) })
    if (port.faults.throwOnTransform) {
      port.faults.throwOnTransform = false
      throw new Error('The transformation failed')
    }
    const allowed = game.settings.get('dnd5e', 'allowPolymorphing')
    if (!allowed && !game.user.isGM) return null
    if (this.isToken) return null

    const o = this.toObject()
    o.flags.dnd5e = o.flags.dnd5e || {}
    o.flags.dnd5e.transformOptions = { ...settings.toObject(), mergeSaves: settings.merge.has('saves'), mergeSkills: settings.merge.has('skills') }
    const sourceData = source.toObject()
    const rollData = { ...this.getRollData(), source: source.getRollData() }
    if (settings.keep.has('self')) {
      o.img = sourceData.img
      o.name = `${o.name} (Appearance)`
    }
    const d = mergeObject(deepClone({
      type: o.type, name: `${o.name} (${sourceData.name})`, system: sourceData.system, items: sourceData.items,
      effects: o.effects.concat(sourceData.effects), img: sourceData.img, ownership: o.ownership, folder: o.folder,
      flags: o.flags, prototypeToken: { texture: {}, sight: {}, detectionModes: [] },
    }), settings.keep.has('self') ? o : {})
    delete d.system.resources
    delete d.system.currency
    delete d.system.bonuses
    if (settings.keep.has('spells') || settings.spellLists.size) d.system.attributes.spellcasting = o.system.attributes.spellcasting
    d.system.details.alignment = o.system.details.alignment
    d.system.attributes.exhaustion = o.system.attributes.exhaustion
    d.system.attributes.inspiration = o.system.attributes.inspiration
    d.system.spells = o.system.spells
    d.system.attributes.ac.flat = source.system.attributes.ac.value

    for (const k of TOKEN_FROM_SOURCE) d.prototypeToken[k] = sourceData.prototypeToken[k]
    for (const k of TEXTURE_FROM_SOURCE) d.prototypeToken.texture[k] = sourceData.prototypeToken.texture?.[k]
    for (const k of TOKEN_FROM_SELF) d.prototypeToken[k] = o.prototypeToken[k]

    if (!settings.keep.has('self')) {
      const sightSource = settings.keep.has('vision') ? o.prototypeToken : sourceData.prototypeToken
      for (const k of ['range', 'angle', 'visionMode', 'color', 'attenuation', 'brightness', 'saturation', 'contrast']) {
        d.prototypeToken.sight[k] = sightSource.sight?.[k]
      }
      d.prototypeToken.sight.enabled = o.prototypeToken.sight?.enabled
      d.prototypeToken.detectionModes = sightSource.detectionModes

      const abilities = d.system.abilities
      for (const k of Object.keys(abilities)) {
        const oa = o.system.abilities[k]
        const prof = abilities[k].proficient
        const type = CONFIG.DND5E.abilities[k]?.type
        if (settings.keep.has('physical') && (type === 'physical')) abilities[k] = oa
        else if (settings.keep.has('mental') && (type === 'mental')) abilities[k] = oa
        if (settings.keep.has('saves') && oa) abilities[k].proficient = oa.proficient
        else if (settings.merge.has('saves') && oa) abilities[k].proficient = Math.max(prof, oa.proficient)
        else abilities[k].proficient = sourceData.system.abilities[k].proficient
      }
      if (settings.keep.has('skills')) d.system.skills = o.system.skills
      else if (settings.merge.has('skills')) {
        for (const [k, s] of Object.entries(d.system.skills)) s.value = Math.max(s.value, o.system.skills[k]?.value ?? 0)
      }
      if (settings.keep.has('gearProf')) {
        d.system.traits.armorProf = o.system.traits.armorProf
        d.system.traits.weaponProf = o.system.traits.weaponProf
        d.system.tools = o.system.tools
      }
      if (settings.keep.has('languages')) d.system.traits.languages = o.system.traits.languages

      const spellIdentifiers = settings.spellLists.size ? new Set(
        Array.from(settings.spellLists)
          .map(id => dnd5e.registry.spellLists.forType(id))
          .filter(list => this.identifiedItems.get(list?.metadata.identifier, list?.metadata.type)?.size)
          .flatMap(list => Array.from(list.identifiers)),
      ) : null
      const profDiff = source.system.attributes.prof - this.system.attributes.prof
      d.items = d.items.map(i => {
        if (settings.keep.has('class') && ((i.type === 'feat') || (i.type === 'weapon')) && profDiff) {
          Object.values(i.system.activities).forEach(activity => {
            if (activity.type === 'attack') {
              activity.attack ??= {}
              activity.attack.bonus ??= ''
              activity.attack.bonus += ` ${profDiff < 0 ? '' : '+'}${profDiff}`
            }
          })
        }
        return i
      }).concat(o.items.filter(i => {
        switch (i.type) {
          case 'class':
          case 'subclass': return settings.keep.has('class') || settings.keep.has('hp')
          case 'feat': return settings.keep.has('feats')
          case 'spell': return spellIdentifiers?.has(i.system.identifier) || (!spellIdentifiers && settings.keep.has('spells'))
          case 'race': return settings.keep.has('type')
          default: return settings.keep.has('items')
        }
      }))

      if (!settings.keep.has('class') && ('cr' in d.system.details)) {
        if (settings.keep.has('hp')) {
          // Foundry's Array#findSplice, and a plain effect's data for ActiveEffect.implementation's.
          const at = d.effects.findIndex(e => e._id === dnd5e.utils.staticID('dnd5eTransformProf'))
          const profOverride = (at >= 0) ? d.effects.splice(at, 1)[0]
            : { _id: dnd5e.utils.staticID('dnd5eTransformProf'), name: 'Proficiency', img: 'icons/skills/social/diplomacy-peace-alliance.webp', disabled: false }
          profOverride.changes = [{ key: 'system.attributes.prof', mode: CONST.ACTIVE_EFFECT_MODES?.OVERRIDE ?? 5, value: source.system.attributes.prof }]
          d.effects.push(profOverride)
        } else {
          d.items.push({ _id: foundry.utils.randomID(), type: 'class', name: 'Temporary Class', system: { identifier: 'temporary', levels: d.system.details.cr } })
        }
      }
      if (settings.keep.has('bio')) d.system.details.biography = o.system.details.biography
      if (settings.keep.has('vision')) d.system.traits.senses = o.system.traits.senses
      if (settings.keep.has('type')) d.system.details.type = o.system.details.type
      if (settings.keep.has('hp')) d.system.attributes.hp = { ...o.system.attributes.hp, max: this.system.attributes.hp.max }
      if (settings.keep.has('resistances')) {
        d.system.traits.di = o.system.traits.di
        d.system.traits.dr = o.system.traits.dr
        d.system.traits.dv = o.system.traits.dv
        d.system.traits.dm = o.system.traits.dm
      }
      const tempHp = simplifyBonus(settings.tempFormula, rollData)
      if (tempHp) d.system.attributes.hp.temp = tempHp
      const minimumAC = simplifyBonus(settings.minimumAC, rollData)
      if (minimumAC > source.system.attributes.ac.value) {
        d.system.attributes.ac.calc = 'natural'
        d.system.attributes.ac.flat = minimumAC
      }

      const originEffectIds = new Set(deepClone(d.effects).filter(effect => !effect.origin || (effect.origin === this.uuid)).map(e => e._id))
      d.effects = d.effects.filter(e => {
        if (settings.effects.has('all')) return true
        if (settings.keep.has('hp') && !settings.keep.has('class') && (e._id === dnd5e.utils.staticID('dnd5eTransformProf'))) return true
        const origin = (e.origin?.startsWith('Actor') || e.origin?.startsWith('Item')) ? globalThis.fromUuidSync(e.origin) : {}
        const originIsSelf = origin?.parent?.uuid === this.uuid
        const isOriginEffect = originEffectIds.has(e._id)
        if (isOriginEffect) return settings.effects.has('origin')
        if (!isOriginEffect && !originIsSelf) return settings.effects.has('otherOrigin')
        switch (origin.type) {
          case 'spell': return settings.effects.has('spell')
          case 'feat': return settings.effects.has('feat')
          case 'background': return settings.effects.has('background')
          case 'class':
          case 'subclass': return settings.effects.has('class')
          case 'equipment':
          case 'weapon':
          case 'tool':
          case 'loot':
          case 'container': return settings.effects.has('equipment')
          default: return true
        }
      })
      // Foundry's parseUuid, as far as a favorite's relative uuid names an item.
      if ('favorites' in o.system) {
        d.system.favorites = o.system.favorites.filter(f => {
          if (!['activity', 'item'].includes(f.type)) return true
          const itemId = /\.Item\.([^.]+)/.exec(String(f.id))?.[1]
          return d.items.find(i => i._id === itemId)
        })
      }
    }

    if (sourceData.prototypeToken.randomImg) {
      const images = await source.getTokenImages()
      d.prototypeToken.texture.src = images[Math.floor(Math.random() * images.length)]
    }
    if (!this.isPolymorphed || !d.flags.dnd5e.originalActor) d.flags.dnd5e.originalActor = this.id
    d.flags.dnd5e.isPolymorphed = true
    const previousActorIds = deepClone(this.getFlag('dnd5e', 'previousActorIds') || [])
    previousActorIds.push(this.id)
    setProperty(d.flags, 'dnd5e.previousActorIds', previousActorIds)
    options.renderSheet ??= this.sheet?.rendered ?? false
    await this.sheet?.close()

    // As core's Hooks.callAll, which doesn't wait: what each hook writes into the data, it writes now.
    void Hooks.callAll('dnd5e.transformActor', this, source, d, settings, options)
    void Hooks.callAll('dnd5e.transformActorV2', this, source, d, settings, options)
    const newActor = await this.constructor.create(d, options)

    if (!settings.transformTokens) return undefined
    const tokens = this.getActiveTokens(true)
    const updates = tokens.map(t => {
      const newTokenData = deepClone(d.prototypeToken)
      newTokenData._id = t.id
      newTokenData.actorId = newActor.id
      newTokenData.actorLink = true
      for (const k of TOKEN_FROM_SELF) newTokenData[k] = t.document[k]
      newTokenData.name = settings.keep.has('self') ? `${t.document.name} (Appearance)` : `${t.document.name} (${sourceData.name})`
      setProperty(newTokenData, 'flags.dnd5e.originalActor', getProperty(d, 'flags.dnd5e.originalActor'))
      setProperty(newTokenData, 'flags.dnd5e.isPolymorphed', true)
      if (!t.document.flags?.dnd5e?.previousTokenData) {
        const previousTokenData = { texture: {} }
        for (const k of [...TOKEN_FROM_SOURCE, ...TOKEN_FROM_SELF, 'name']) previousTokenData[k] = t.document[k]
        for (const k of TEXTURE_FROM_SOURCE) previousTokenData.texture[k] = t.document.texture?.[k]
        setProperty(newTokenData, 'flags.dnd5e.previousTokenData', previousTokenData)
      }
      return newTokenData
    })
    return canvas.scene?.updateEmbeddedDocuments('Token', updates)
  }

  /**
   * actor.mjs:3138-3250, for a world actor: dnd5e.revertOriginalForm first, on this client alone; her
   * hit points and temporary ones copied back where the transformation kept them, and her spell
   * slots; the viewed scene's tokens put back; a Gamemaster deletes every form of the chain with no
   * options, a player unflags them; then her update, with no concentration check. Faults:
   * `refuseRevert` makes the next one do nothing, as a module's hook might stop it.
   */
  async revertOriginalForm(options = {}) {
    if (!this.isPolymorphed) return undefined
    if (!this.isOwner) return null
    port.reverts.push({ form: this.id, user: game.user?.id ?? null, options: deepClone(options) })
    if (port.faults.refuseRevert) {
      port.faults.refuseRevert = false
      return null
    }
    options.renderSheet ??= true
    void Hooks.callAll('dnd5e.revertOriginalForm', this, options)
    const transformOptions = this.getFlag('dnd5e', 'transformOptions')
    const previousActorIds = this.getFlag('dnd5e', 'previousActorIds') ?? []
    const original = game.actors.get(this.getFlag('dnd5e', 'originalActor'))
    const update = {}
    if (transformOptions?.keep?.includes('hp')) setProperty(update, 'system.attributes.hp.value', this.system.attributes.hp.value)
    if (transformOptions?.keep?.includes('tempHP')) setProperty(update, 'system.attributes.hp.temp', this.system.attributes.hp.temp)
    if (transformOptions?.keep?.includes('spells') || transformOptions?.spellLists?.length) {
      Object.entries(this.system.spells ?? {}).forEach(([k, v]) => {
        if (v.max) update[`system.spells.${k}.value`] = v.value
      })
    }
    if (!original) return undefined
    if (canvas.ready) {
      const tokens = this.getActiveTokens(true)
      const tokenData = (await original.getTokenDocument()).toObject()
      const tokenUpdates = tokens.map(t => {
        const each = deepClone(tokenData)
        each._id = t.id
        each.elevation = t.document.elevation
        each.hidden = t.document.hidden
        each.rotation = t.document.rotation
        mergeObject(each, deepClone(t.document.flags?.dnd5e?.previousTokenData ?? {}))
        delete each.x
        delete each.y
        return each
      })
      await canvas.scene.updateEmbeddedDocuments('Token', tokenUpdates, { diff: false, recursive: false })
    }
    const polymorphedActorIds = previousActorIds.filter(id => (id !== original.id) && game.actors?.get(id)).concat([this.id])
    if (game.user.isGM) await Actor.implementation.deleteDocuments(polymorphedActorIds)
    else {
      const actorUpdates = polymorphedActorIds.filter(id => game.actors.get(id).isOwner)
        .map(p => ({ _id: p, 'flags.dnd5e': { '-=isPolymorphed': null, '-=previousActorIds': null } }))
      await Actor.implementation.updateDocuments(actorUpdates)
    }
    if (!foundry.utils.isEmpty(update)) await original.update(update, { dnd5e: { concentrationCheck: false } })
    return original
  }
}

/** actor.mjs:2829-2833: the token props a form takes from its source, its texture's, and those it keeps of hers. */
const TOKEN_FROM_SOURCE = ['width', 'height', 'alpha', 'lockRotation', 'ring']
const TEXTURE_FROM_SOURCE = ['offsetX', 'offsetY', 'scaleX', 'scaleY', 'src', 'tint']
const TOKEN_FROM_SELF = ['bar1', 'bar2', 'displayBars', 'displayName', 'actorLink', 'disposition', 'rotation', 'elevation', 'hidden']

/**
 * An actor's source data as dnd5e's schema fills it, as far as these actors read it: every ability
 * with its proficiency, 0 where none is given; every skill, as `{ value }`; hit points, armor class,
 * movement, details and traits; a prototype token with its sight, detection modes and flags, and the
 * light and occlusion Foundry's schema gives every token, which no partial token data dnd5e builds
 * for a change carries.
 * @param {object} source
 * @returns {object}
 */
function normalised(source) {
  const data = deepClone(source)
  data.flags ??= {}
  data.ownership ??= { default: 0 }
  data.effects ??= []
  data.items ??= []
  const system = (data.system ??= {})
  system.abilities ??= {}
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const given = system.abilities[key] ?? {}
    system.abilities[key] = { value: 10, ...given, proficient: Number(given.proficient) || 0 }
  }
  system.skills ??= {}
  for (const [key, ability] of Object.entries(SKILLS)) {
    const given = system.skills[key]
    system.skills[key] = { ability, ...((typeof given === 'object') ? given : {}), value: Number((typeof given === 'object') ? given?.value : given) || 0 }
  }
  system.attributes ??= {}
  system.attributes.hp = { value: 0, max: 0, temp: 0, tempmax: 0, ...(system.attributes.hp ?? {}) }
  system.attributes.ac = { calc: 'default', ...(system.attributes.ac ?? {}) }
  system.attributes.movement = { units: 'ft', ...(system.attributes.movement ?? {}) }
  system.attributes.exhaustion ??= 0
  system.attributes.inspiration ??= false
  system.details ??= {}
  system.details.biography ??= { value: '', public: '' }
  system.traits ??= {}
  system.traits.languages ??= { value: [], custom: '' }
  data.prototypeToken = {
    name: data.name, actorLink: data.type === 'character', texture: { src: data.img ?? null }, sight: { enabled: data.type === 'character' },
    detectionModes: [], flags: {}, light: { dim: 0, bright: 0, angle: 360 }, occlusion: { modes: 0, alpha: 0 },
    ...(data.prototypeToken ?? {}),
  }
  return data
}

/**
 * A druid's scale values by her druid levels, as P/classes24/druid/druid.yml:337-387 (map) and
 * P/classes/druid.yml give them: `wild-shape`, the Challenge Rating; `wild-shape-uses`; and, for the
 * 2024 druid alone, `known-forms`. A class marked `source.rules: "2014"` is the 2014 druid's.
 * @param {TActor} actor
 * @returns {object}
 */
function scaleOf(actor) {
  const druid = [...actor.items].find(item => (item.type === 'class') && (item._source.system?.identifier === 'druid'))
  if (!druid) return {}
  const level = Number(druid._source.system.levels) || 0
  const step = table => table.reduce((value, [at, each]) => ((level >= at) ? each : value), null)
  const modern = druid._source.system?.source?.rules !== '2014'
  const scale = {
    'wild-shape': new ScaleValue(step([[2, 0.25], [4, 0.5], [8, 1]])),
    'wild-shape-uses': new ScaleValue(modern ? step([[2, 2], [6, 3], [17, 4]]) : step([[2, 2], [20, 99]])),
  }
  if (modern) scale['known-forms'] = new ScaleValue(step([[2, 4], [4, 6], [8, 8]]))
  return { druid: scale }
}

/** dnd5e's ScaleValueType, as far as roll data reads one: its `value`, and its value in a formula. */
class ScaleValue {
  constructor(value) { this.value = value }
  toString() { return String(this.value) }
  valueOf() { return this.value }
}

/** dnd5e's registry's Circle of the Moon spell list, as far as transformInto reads it: whose spells a Moon druid keeps. */
const MOON_SPELLS = {
  metadata: { identifier: 'moon', type: 'subclass' },
  identifiers: new Set(['cure-wounds', 'moonbeam', 'starry-wisp', 'conjure-animals', 'fount-of-moonlight', 'mass-cure-wounds']),
}

/* -------------------------------------------- */
/*  Scenes' tokens                              */
/* -------------------------------------------- */

/**
 * Give a scene of token-core's what transformations write with: core's `updateEmbeddedDocuments`
 * for its tokens, a batch, each written and then `updateToken` for each on every client; recursive
 * by default, merging; with `{ recursive: false }` (dnd5e's return's), each key given replacing the
 * token's own. Faults: `throwOnTokens` throws before anything's written.
 * @param {object} scene
 * @returns {object}
 */
export function withTokenBatches(scene) {
  scene.updateEmbeddedDocuments = async (type, updates = [], options = {}) => {
    if (type !== 'Token') throw new Error(`No ${type} here`)
    port.tokenWrites.push({ scene: scene.id, updates: deepClone(updates), options: deepClone(options) })
    if (port.faults.throwOnTokens) {
      port.faults.throwOnTokens = false
      throw new Error('The tokens could not be updated')
    }
    await turn()
    const done = []
    for (const { _id, ...changes } of updates) {
      const token = scene.tokens.get(_id)
      if (!token) continue
      if (options.recursive === false) Object.assign(token, deepClone(changes))
      else mergeObject(token, deepClone(changes))
      done.push([token, changes])
    }
    for (const [token, changes] of done) await Hooks.callAll('updateToken', token, changes, options, userId())
    return done.map(([token]) => token)
  }
  return scene
}

/* -------------------------------------------- */
/*  Compendiums                                 */
/* -------------------------------------------- */

/** The fields every Actor compendium's index has, as Foundry's base index and dnd5e's add to it. */
const BASE_INDEX = ['_id', 'name', 'type', 'img', 'folder']

/**
 * A compendium of Actors, as Foundry's CompendiumCollection, as far as the module reads one: its
 * `collection`, title and package; who sees it (`visible`, a Gamemaster-only one hidden from players);
 * its folders, each with its parent; its index, holding each entry's base fields and any `fields`
 * `getIndex` was asked for since, as Foundry's merges them; and `getDocument`, a prepared TActor.
 */
export class PackStandIn {
  constructor({ collection, title, packageType = 'system', folders = [], documents = [], gmOnly = false }) {
    const [packageName, name] = collection.split('.')
    this.collection = collection
    this.title = title
    this.documentName = 'Actor'
    this.metadata = { id: collection, name, label: title, type: 'Actor', packageType, packageName, ownership: gmOnly ? { PLAYER: 'NONE', ASSISTANT: 'OWNER' } : { PLAYER: 'OBSERVER', ASSISTANT: 'OWNER' } }
    this.gmOnly = gmOnly
    this.folders = new Collection()
    for (const { _id, name: folderName, folder = null } of folders) this.folders.set(_id, { id: _id, _id, name: folderName, type: 'Actor', parentId: folder })
    for (const folder of this.folders) Object.defineProperty(folder, 'folder', { configurable: true, get: () => this.folders.get(folder.parentId) ?? null })
    this.sources = new Map(documents.map(data => [data._id, normalised(data)]))
    this.index = new Collection()
    this.indexed = new Set(BASE_INDEX)
    this.#index()
  }

  get visible() { return Boolean(game.user?.isGM) || !this.gmOnly }

  /** As Foundry's: a Gamemaster has every level of it; a player Observer, or none of a Gamemaster's own. */
  testUserPermission(user, level = 'OBSERVER') {
    if (user?.isGM) return true
    const want = CONST.DOCUMENT_OWNERSHIP_LEVELS[level] ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
    return (this.gmOnly ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE : CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) >= want
  }

  /** Every entry with the fields indexed so far. */
  #index() {
    this.index.clear()
    for (const [id, source] of this.sources) {
      const entry = { uuid: `Compendium.${this.collection}.Actor.${id}` }
      for (const field of this.indexed) {
        const value = getProperty(source, field)
        if (value !== undefined) setProperty(entry, field, deepClone(value))
      }
      this.index.set(id, entry)
    }
  }

  /** As Foundry's: the index, with the fields asked for added to it for good. */
  async getIndex({ fields = [] } = {}) {
    port.indexes.push({ pack: this.collection, fields: [...fields] })
    await turn()
    for (const field of fields) this.indexed.add(field)
    this.#index()
    return this.index
  }

  /** As Foundry's: the document, prepared, or null where it's gone. */
  async getDocument(id) {
    await turn()
    return this.document(id)
  }

  /** The document now, as fromUuidSync finds one loaded. */
  document(id) {
    const source = this.sources.get(id)
    return source ? new TActor(source, { pack: this }) : null
  }

  /** An entry deleted, as from its compendium by a Gamemaster. */
  remove(id) {
    this.sources.delete(id)
    this.#index()
  }
}

/** The world's compendiums, `game.packs`. */
export const packs = new Collection()

/**
 * A compendium document by uuid, `Compendium.<package>.<pack>.Actor.<id>`: undefined for any other
 * uuid, null where the compendium or the entry isn't there.
 * @param {string} uuid
 * @returns {TActor|null|undefined}
 */
function packDocument(uuid) {
  const parts = String(uuid ?? '').split('.')
  if (parts[0] !== 'Compendium') return undefined
  if ((parts.length !== 5) || (parts[3] !== 'Actor')) return null
  return packs.get(`${parts[1]}.${parts[2]}`)?.document(parts[4]) ?? null
}

/** dnd5e 5.3.3's own Beasts and creatures, each from its P file under packs/_source (actors24, monsters). */
export const BEASTS = [
  // P/actors24/beast/rat.yml
  {"_id": "mmRat00000000000", "name": "Rat", "type": "npc", "img": "systems/dnd5e/tokens/beast/Rat.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 2}, "dex": {"value": 11}, "con": {"value": 9}, "int": {"value": 2}, "wis": {"value": 10}, "cha": {"value": 4}}, "skills": {"prc": {"value": 1}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 1, "max": 1}, "movement": {"climb": "20", "walk": "20", "units": null, "hover": false}, "senses": {"ranges": {"darkvision": 30}}}, "details": {"cr": 0, "type": {"value": "beast"}}, "traits": {"size": "tiny"}}, "prototypeToken": {"name": "Rat", "width": 0.5, "height": 0.5, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/Rat.webp", "scaleX": 1, "scaleY": 1, "tint": "#ffffff"}}, "items": [{"_id": "mmAgile000000000", "name": "Agile", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmBite0000000000", "name": "Bite", "type": "weapon", "sort": 1, "activities": [{"id": "xWlMeXFjELfSUWX9", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+2", "toHit": "+2", "damage": [{"formula": "1", "damageType": "piercing", "label": "1 Piercing"}]}, "damage": [{"number": 0, "denomination": 0, "bonus": "1", "types": ["piercing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/spider.yml
  {"_id": "mmSpider00000000", "name": "Spider", "type": "npc", "img": "systems/dnd5e/tokens/beast/Spider.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 2}, "dex": {"value": 14}, "con": {"value": 8}, "int": {"value": 1}, "wis": {"value": 10}, "cha": {"value": 2}}, "skills": {"ste": {"value": 1}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 1, "max": 1}, "movement": {"climb": "20", "walk": "20", "units": "ft", "hover": false}, "senses": {"ranges": {"darkvision": 30}}}, "details": {"cr": 0, "type": {"value": "beast"}}, "traits": {"size": "tiny"}}, "prototypeToken": {"name": "Spider", "width": 0.5, "height": 0.5, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/Spider.webp", "scaleX": 0.8, "scaleY": 0.8, "tint": "#ffffff"}}, "items": [{"_id": "mmSpiderClimb000", "name": "Spider Climb", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmWebWalker00000", "name": "Web Walker", "type": "feat", "sort": 1, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmBite0000000000", "name": "Bite", "type": "weapon", "sort": 2, "activities": [{"id": "xWlMeXFjELfSUWX9", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+4", "toHit": "+4", "damage": [{"formula": "1d4", "damageType": "poison", "label": "1d4 Poison"}]}, "damage": [{"number": 1, "denomination": 4, "bonus": "", "types": ["poison"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/wolf.yml
  {"_id": "mmWolf0000000000", "name": "Wolf", "type": "npc", "img": "systems/dnd5e/tokens/beast/Wolf.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 14}, "dex": {"value": 15}, "con": {"value": 12}, "int": {"value": 3}, "wis": {"value": 12}, "cha": {"value": 6}}, "skills": {"prc": {"value": 2}, "ste": {"value": 1}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 11, "max": 11}, "movement": {"walk": "40", "units": null, "hover": false}, "senses": {"ranges": {"darkvision": 60}}}, "details": {"cr": 0.25, "type": {"value": "beast"}}, "traits": {"size": "med"}}, "prototypeToken": {"name": "Wolf", "width": 1, "height": 1, "randomImg": true, "texture": {"src": "systems/dnd5e/tokens/beast/Wolf.webp", "scaleX": 1, "scaleY": 1, "tint": "#ffffff"}}, "items": [{"_id": "mmPackTactics000", "name": "Pack Tactics", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmBite0000000000", "name": "Bite", "type": "weapon", "sort": 1, "activities": [{"id": "xWlMeXFjELfSUWX9", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+4", "toHit": "+4", "damage": [{"formula": "1d6 + 2", "damageType": "piercing", "label": "1d6 + 2 Piercing"}]}, "damage": [{"number": 1, "denomination": 6, "bonus": "2", "types": ["piercing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/riding-horse.yml
  {"_id": "mmRidingHorse000", "name": "Riding Horse", "type": "npc", "img": "systems/dnd5e/tokens/thumbs/beast/RidingHorse.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 16}, "dex": {"value": 13}, "con": {"value": 12}, "int": {"value": 2}, "wis": {"value": 11}, "cha": {"value": 7}}, "skills": {}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 13, "max": 13}, "movement": {"walk": "60", "units": null, "hover": false}, "senses": {"ranges": {}}}, "details": {"cr": 0.25, "type": {"value": "beast"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Riding Horse", "width": 2, "height": 2, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/RidingHorse.webp", "scaleX": 2, "scaleY": 2, "tint": "#ffffff"}}, "items": [{"_id": "mmHooves00000000", "name": "Hooves", "type": "weapon", "sort": 0, "activities": [{"id": "6U2Wc2qWocyuASbe", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d8 + 3", "damageType": "bludgeoning", "label": "1d8 + 3 Bludgeoning"}]}, "damage": [{"number": 1, "denomination": 8, "bonus": "3", "types": ["bludgeoning"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/panther.yml
  {"_id": "mmPanther0000000", "name": "Panther", "type": "npc", "img": "systems/dnd5e/tokens/beast/Panther.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 14}, "dex": {"value": 16}, "con": {"value": 10}, "int": {"value": 3}, "wis": {"value": 14}, "cha": {"value": 7}}, "skills": {"prc": {"value": 1}, "ste": {"value": 2}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 13, "max": 13}, "movement": {"climb": "40", "walk": "50", "units": null, "hover": false}, "senses": {"ranges": {"darkvision": 60}}}, "details": {"cr": 0.25, "type": {"value": "beast"}}, "traits": {"size": "med"}}, "prototypeToken": {"name": "Panther", "width": 1, "height": 1, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/Panther.webp", "scaleX": 2, "scaleY": 2, "tint": "#ffffff"}}, "items": [{"_id": "mmRend0000000000", "name": "Rend", "type": "weapon", "sort": 0, "activities": [{"id": "VP3t6lmmuXKGCRwX", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d6 + 3", "damageType": "slashing", "label": "1d6 + 3 Slashing"}]}, "damage": [{"number": 1, "denomination": 6, "bonus": "3", "types": ["slashing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}, {"_id": "mmNimbleEscape00", "name": "Nimble Escape", "type": "feat", "sort": 1, "activities": [{"id": "CcMi6Alf0pup7o81", "type": "utility", "activation": {"type": "bonus", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}]},
  // P/actors24/beast/giant-bat.yml
  {"_id": "mmGiantBat000000", "name": "Giant Bat", "type": "npc", "img": "systems/dnd5e/tokens/thumbs/beast/GiantBat.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 15}, "dex": {"value": 16}, "con": {"value": 11}, "int": {"value": 2}, "wis": {"value": 12}, "cha": {"value": 6}}, "skills": {}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 22, "max": 22}, "movement": {"fly": "60", "walk": "10", "units": null, "hover": false}, "senses": {"ranges": {"blindsight": 120}}}, "details": {"cr": 0.25, "type": {"value": "beast"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Giant Bat", "width": 2, "height": 2, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/GiantBat.webp", "scaleX": 3, "scaleY": 3, "tint": "#ffffff"}}, "items": [{"_id": "mmBite0000000000", "name": "Bite", "type": "weapon", "sort": 0, "activities": [{"id": "xWlMeXFjELfSUWX9", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d6 + 3", "damageType": "piercing", "label": "1d6 + 3 Piercing"}]}, "damage": [{"number": 1, "denomination": 6, "bonus": "3", "types": ["piercing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/black-bear.yml
  {"_id": "mmBlackBear00000", "name": "Black Bear", "type": "npc", "img": "systems/dnd5e/tokens/beast/BlackBear.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 15}, "dex": {"value": 12}, "con": {"value": 14}, "int": {"value": 2}, "wis": {"value": 12}, "cha": {"value": 7}}, "skills": {"prc": {"value": 2}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 19, "max": 19}, "movement": {"climb": "30", "swim": "30", "walk": "30", "units": null, "hover": false}, "senses": {"ranges": {"darkvision": 60}}}, "details": {"cr": 0.5, "type": {"value": "beast"}}, "traits": {"size": "med"}}, "prototypeToken": {"name": "Black Bear", "width": 1, "height": 1, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/BlackBear.webp", "scaleX": 1.5, "scaleY": 1.5, "tint": "#ffffff"}}, "items": [{"_id": "mmMultiattack000", "name": "Multiattack", "type": "feat", "sort": 0, "activities": [{"id": "Ms63W7e3Mv2Margn", "type": "utility", "activation": {"type": "action", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "mmRend0000000000", "name": "Rend", "type": "weapon", "sort": 1, "activities": [{"id": "VP3t6lmmuXKGCRwX", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+4", "toHit": "+4", "damage": [{"formula": "1d6 + 2", "damageType": "slashing", "label": "1d6 + 2 Slashing"}]}, "damage": [{"number": 1, "denomination": 6, "bonus": "2", "types": ["slashing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/crocodile.yml
  {"_id": "mmCrocodile00000", "name": "Crocodile", "type": "npc", "img": "systems/dnd5e/tokens/thumbs/beast/Crocodile.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 15}, "dex": {"value": 10}, "con": {"value": 13, "proficient": 1}, "int": {"value": 2}, "wis": {"value": 10}, "cha": {"value": 5}}, "skills": {"ste": {"value": 1}}, "attributes": {"ac": {"calc": "natural", "flat": 12}, "hp": {"value": 13, "max": 13}, "movement": {"swim": "30", "walk": "20", "units": null, "hover": false}, "senses": {"ranges": {}}}, "details": {"cr": 0.5, "type": {"value": "beast"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Crocodile", "width": 2, "height": 2, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/Crocodile.webp", "scaleX": 1.2, "scaleY": 1.2, "tint": "#ffffff"}}, "items": [{"_id": "mmHoldBreath0000", "name": "Hold Breath", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmBite0000000000", "name": "Bite", "type": "weapon", "sort": 1, "activities": [{"id": "xWlMeXFjELfSUWX9", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+4", "toHit": "+4", "damage": [{"formula": "1d8 + 2", "damageType": "piercing", "label": "1d8 + 2 Piercing"}]}, "damage": [{"number": 1, "denomination": 8, "bonus": "2", "types": ["piercing"]}]}, {"id": "kPgRugxvd6oDkyKw", "type": "check", "activation": {"type": "special", "value": 1}}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/reef-shark.yml
  {"_id": "mmReefShark00000", "name": "Reef Shark", "type": "npc", "img": "systems/dnd5e/tokens/beast/ReefShark.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 14}, "dex": {"value": 15}, "con": {"value": 13}, "int": {"value": 1}, "wis": {"value": 10}, "cha": {"value": 4}}, "skills": {"prc": {"value": 1}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 22, "max": 22}, "movement": {"swim": "30", "walk": "5", "units": null, "hover": false}, "senses": {"ranges": {"blindsight": 30}}}, "details": {"cr": 0.5, "type": {"value": "beast"}}, "traits": {"size": "med"}}, "prototypeToken": {"name": "Reef Shark", "width": 1, "height": 1, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/ReefShark.webp", "scaleX": 1.5, "scaleY": 1.5, "tint": "#ffffff"}}, "items": [{"_id": "mmPackTactics000", "name": "Pack Tactics", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmWaterBreathing", "name": "Water Breathing", "type": "feat", "sort": 1, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmBite0000000000", "name": "Bite", "type": "weapon", "sort": 2, "activities": [{"id": "xWlMeXFjELfSUWX9", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+4", "toHit": "+4", "damage": [{"formula": "2d4 + 2", "damageType": "piercing", "label": "2d4 + 2 Piercing"}]}, "damage": [{"number": 2, "denomination": 4, "bonus": "2", "types": ["piercing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/giant-wasp.yml
  {"_id": "mmGiantWasp00000", "name": "Giant Wasp", "type": "npc", "img": "systems/dnd5e/tokens/beast/GiantWasp.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 10}, "dex": {"value": 14}, "con": {"value": 10}, "int": {"value": 1}, "wis": {"value": 10}, "cha": {"value": 3}}, "skills": {}, "attributes": {"ac": {"calc": "natural", "flat": 13}, "hp": {"value": 22, "max": 22}, "movement": {"fly": "50", "walk": "10", "units": null, "hover": false}, "senses": {"ranges": {}}}, "details": {"cr": 0.5, "type": {"value": "beast"}}, "traits": {"size": "med"}}, "prototypeToken": {"name": "Giant Wasp", "width": 1, "height": 1, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/GiantWasp.webp", "scaleX": 1, "scaleY": 1, "tint": "#ffffff"}}, "items": [{"_id": "mmFlyby000000000", "name": "Flyby", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmSting000000000", "name": "Sting", "type": "weapon", "sort": 1, "activities": [{"id": "ExJB3aZAPF3shVJA", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+4", "toHit": "+4", "damage": [{"formula": "1d6 + 2", "damageType": "piercing", "label": "1d6 + 2 Piercing"}, {"formula": "2d4", "damageType": "poison", "label": "2d4 Poison"}]}, "damage": [{"number": 1, "denomination": 6, "bonus": "2", "types": ["piercing"]}, {"number": 2, "denomination": 4, "bonus": "", "types": ["poison"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/brown-bear.yml
  {"_id": "mmBrownBear00000", "name": "Brown Bear", "type": "npc", "img": "systems/dnd5e/tokens/thumbs/beast/BrownBear.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 17}, "dex": {"value": 12}, "con": {"value": 15}, "int": {"value": 2}, "wis": {"value": 13}, "cha": {"value": 7}}, "skills": {"prc": {"value": 1}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 22, "max": 22}, "movement": {"climb": "30", "walk": "40", "units": null, "hover": false}, "senses": {"ranges": {"darkvision": 60}}}, "details": {"cr": 1, "type": {"value": "beast"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Brown Bear", "width": 2, "height": 2, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/BrownBear.webp", "scaleX": 1.5, "scaleY": 1.5, "tint": "#ffffff"}}, "items": [{"_id": "mmMultiattack000", "name": "Multiattack", "type": "feat", "sort": 0, "activities": [{"id": "Ms63W7e3Mv2Margn", "type": "utility", "activation": {"type": "action", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "mmBite0000000000", "name": "Bite", "type": "weapon", "sort": 1, "activities": [{"id": "xWlMeXFjELfSUWX9", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d8 + 3", "damageType": "piercing", "label": "1d8 + 3 Piercing"}]}, "damage": [{"number": 1, "denomination": 8, "bonus": "3", "types": ["piercing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}, {"_id": "mmClaw0000000000", "name": "Claw", "type": "weapon", "sort": 2, "activities": [{"id": "W1T7dZnG8GMMwyEP", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d4 + 3", "damageType": "slashing", "label": "1d4 + 3 Slashing"}]}, "damage": [{"number": 1, "denomination": 4, "bonus": "3", "types": ["slashing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/dire-wolf.yml
  {"_id": "mmDireWolf000000", "name": "Dire Wolf", "type": "npc", "img": "systems/dnd5e/tokens/beast/DireWolf.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 17}, "dex": {"value": 15}, "con": {"value": 15}, "int": {"value": 3}, "wis": {"value": 12}, "cha": {"value": 7}}, "skills": {"prc": {"value": 2}, "ste": {"value": 1}}, "attributes": {"ac": {"calc": "natural", "flat": 14}, "hp": {"value": 22, "max": 22}, "movement": {"walk": "50", "units": null, "hover": false}, "senses": {"ranges": {"darkvision": 60}}}, "details": {"cr": 1, "type": {"value": "beast"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Dire Wolf", "width": 2, "height": 2, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/DireWolf.webp", "scaleX": 1, "scaleY": 1, "tint": "#ffffff"}}, "items": [{"_id": "mmPackTactics000", "name": "Pack Tactics", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmBite0000000000", "name": "Bite", "type": "weapon", "sort": 1, "activities": [{"id": "xWlMeXFjELfSUWX9", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d10 + 3", "damageType": "piercing", "label": "1d10 + 3 Piercing"}]}, "damage": [{"number": 1, "denomination": 10, "bonus": "3", "types": ["piercing"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/beast/giant-ape.yml
  {"_id": "mmGiantApe000000", "name": "Giant Ape", "type": "npc", "img": "systems/dnd5e/tokens/thumbs/beast/GiantApe.webp", "folder": "TMBlXc3bnF7vL2Oy", "system": {"abilities": {"str": {"value": 23}, "dex": {"value": 14}, "con": {"value": 18}, "int": {"value": 5}, "wis": {"value": 12}, "cha": {"value": 7}}, "skills": {"ath": {"value": 1}, "prc": {"value": 1}, "sur": {"value": 1}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 168, "max": 168}, "movement": {"climb": "40", "walk": "40", "units": null, "hover": false}, "senses": {"ranges": {}}}, "details": {"cr": 7, "type": {"value": "beast"}}, "traits": {"size": "huge"}}, "prototypeToken": {"name": "Giant Ape", "width": 3, "height": 3, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/GiantApe.webp", "scaleX": 1.5, "scaleY": 1.5, "tint": "#ffffff"}}, "items": [{"_id": "mmMultiattack000", "name": "Multiattack", "type": "feat", "sort": 0, "activities": [{"id": "Ms63W7e3Mv2Margn", "type": "utility", "activation": {"type": "action", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "mmFist0000000000", "name": "Fist", "type": "weapon", "sort": 1, "activities": [{"id": "PklEq9HUdtd7Vghz", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+9", "toHit": "+9", "damage": [{"formula": "3d10 + 6", "damageType": "bludgeoning", "label": "3d10 + 6 Bludgeoning"}]}, "damage": [{"number": 3, "denomination": 10, "bonus": "6", "types": ["bludgeoning"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}, {"_id": "mmBoulderToss000", "name": "Boulder Toss", "type": "feat", "sort": 2, "activities": [{"id": "jpC3fk7LJlhH4CDr", "type": "save", "activation": {"type": "action", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "mmLeap0000000000", "name": "Leap", "type": "feat", "sort": 3, "activities": [{"id": "C28C43DeD8iFtZMe", "type": "utility", "activation": {"type": "bonus", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}]},
  // P/actors24/celestial/giant-eagle.yml
  {"_id": "mmGiantEagle0000", "name": "Giant Eagle", "type": "npc", "img": "systems/dnd5e/tokens/thumbs/beast/GiantEagle.webp", "folder": "B4jgCSN5ycmyM4ak", "system": {"abilities": {"str": {"value": 16}, "dex": {"value": 17}, "con": {"value": 13}, "int": {"value": 8}, "wis": {"value": 14}, "cha": {"value": 10}}, "skills": {"prc": {"value": 2}}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 26, "max": 26}, "movement": {"fly": "80", "walk": "10", "units": null, "hover": false}, "senses": {"ranges": {}}}, "details": {"cr": 1, "type": {"value": "celestial"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Giant Eagle", "width": 2, "height": 2, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/GiantEagle.webp", "scaleX": 1.5, "scaleY": 1.5, "tint": "#ffffff"}}, "items": [{"_id": "mmMultiattack000", "name": "Multiattack", "type": "feat", "sort": 0, "activities": [{"id": "Ms63W7e3Mv2Margn", "type": "utility", "activation": {"type": "action", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "mmRend0000000000", "name": "Rend", "type": "weapon", "sort": 1, "activities": [{"id": "VP3t6lmmuXKGCRwX", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d4 + 3", "damageType": "slashing", "label": "1d4 + 3 Slashing"}, {"formula": "1d6", "damageType": "radiant", "label": "1d6 Radiant"}]}, "damage": [{"number": 1, "denomination": 4, "bonus": "3", "types": ["slashing"]}, {"number": 1, "denomination": 6, "bonus": "", "types": ["radiant"]}]}], "system": {"type": {"value": "natural"}, "properties": []}}]},
  // P/actors24/swarm/swarm-of-rats.yml
  {"_id": "mmSwarmOfRats000", "name": "Swarm of Rats", "type": "npc", "img": "systems/dnd5e/tokens/beast/SwarmRats.webp", "folder": "LK5iEx8W2Y5YxDHM", "system": {"abilities": {"str": {"value": 9}, "dex": {"value": 11, "proficient": 1}, "con": {"value": 9}, "int": {"value": 2}, "wis": {"value": 10}, "cha": {"value": 3}}, "skills": {}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 14, "max": 14}, "movement": {"climb": "30", "walk": "30", "units": null, "hover": false}, "senses": {"ranges": {"darkvision": 30}}}, "details": {"cr": 0.25, "type": {"value": "beast", "swarm": "tiny"}}, "traits": {"size": "med"}}, "prototypeToken": {"name": "Swarm of Rats", "width": 1, "height": 1, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/SwarmRats.webp", "scaleX": 1.5, "scaleY": 1.5, "tint": "#ffffff"}}, "items": [{"_id": "mmSwarm000000000", "name": "Swarm", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": ["trait"]}}, {"_id": "mmBites000000000", "name": "Bites", "type": "weapon", "sort": 1, "activities": [{"id": "nrOPHKjj59hG1On3", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+2", "toHit": "+2", "damage": [{"formula": "2d4", "damageType": "piercing", "label": "2d4 Piercing"}]}, "damage": [{"number": 2, "denomination": 4, "bonus": "", "types": ["piercing"]}]}, {"id": "3Yo83eZUNwX51AcE", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+2", "toHit": "+2", "damage": [{"formula": "1d4", "damageType": "piercing", "label": "1d4 Piercing"}]}, "damage": [{"number": 1, "denomination": 4, "bonus": "", "types": ["piercing"]}]}], "system": {"type": {"value": "natural"}, "properties": ["spc"]}}]},
  // P/actors24/summons/summon-templates/giant-insect.yml
  {"_id": "phbmobGiantInsec", "name": "Giant Insect", "type": "npc", "img": null, "folder": "4Lxoa4gitE28qJLk", "system": {"abilities": {"str": {"value": 17}, "dex": {"value": 13}, "con": {"value": 15}, "int": {"value": 4}, "wis": {"value": 14}, "cha": {"value": 3}}, "skills": {}, "attributes": {"ac": {"calc": "natural", "flat": 11}, "hp": {"value": 30, "max": 30}, "movement": {"climb": "40", "walk": "40", "units": null, "hover": false}, "senses": {"ranges": {"darkvision": 60}}}, "details": {"cr": null, "type": {"value": "beast"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Giant Insect", "width": 2, "height": 2, "randomImg": false, "texture": {"src": null, "scaleX": 1, "scaleY": 1, "tint": "#ffffff"}}, "items": [{"_id": "phbaoiSpiderClim", "name": "Spider Climb", "type": "feat", "sort": 0, "activities": [], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "phbaoiMultiattac", "name": "Multiattack", "type": "feat", "sort": 0, "activities": [{"id": "dnd5eactivity000", "type": "utility", "activation": {"type": "action", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "phbaoiPoisonJab0", "name": "Poison Jab", "type": "feat", "sort": 0, "activities": [{"id": "dnd5eactivity000", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d6 + 3", "damageType": "piercing", "label": "1d6 + 3 Piercing"}, {"formula": "1d4", "damageType": "poison", "label": "1d4 Poison"}]}, "damage": [{"number": 1, "denomination": 6, "bonus": "3", "types": ["piercing"]}, {"number": 1, "denomination": 4, "bonus": "", "types": ["poison"]}]}], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "phbaoiWebBoltSpi", "name": "Web Bolt", "type": "feat", "sort": 0, "activities": [{"id": "dnd5eactivity000", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+3", "toHit": "+3", "damage": [{"formula": "1d10 + 1", "damageType": "bludgeoning", "label": "1d10 + 1 Bludgeoning"}]}, "damage": [{"number": 1, "denomination": 10, "bonus": "1", "types": ["bludgeoning"]}]}], "system": {"type": {"value": "monster"}, "properties": []}}, {"_id": "phbaoiVenomousSp", "name": "Venomous Spew", "type": "feat", "sort": 0, "activities": [{"id": "dnd5eactivity000", "type": "save", "activation": {"type": "action", "value": 1}}], "system": {"type": {"value": "monster"}, "properties": []}}]},
  // P/actors24/conjurations/phantom-steed.yml
  {"_id": "phbsumPhantomSte", "name": "Phantom Steed", "type": "npc", "img": null, "folder": "9mmdDqYZFLIJBacj", "system": {"abilities": {"str": {"value": 16}, "dex": {"value": 13}, "con": {"value": 12}, "int": {"value": 2}, "wis": {"value": 11}, "cha": {"value": 7}}, "skills": {}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 13, "max": 13}, "movement": {"walk": "100", "units": null, "hover": false}, "senses": {"ranges": {}}}, "details": {"cr": 0.25, "type": {"value": "beast"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Riding Horse", "width": 2, "height": 2, "randomImg": false, "texture": {"src": null, "scaleX": 1, "scaleY": 1, "tint": "#ffffff"}}, "items": [{"_id": "phbaoiHooves0000", "name": "Hooves", "type": "weapon", "sort": 0, "activities": [{"id": "dnd5eactivity000", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d8 + 3", "damageType": "bludgeoning", "label": "1d8 + 3 Bludgeoning"}]}, "damage": [{"number": 1, "denomination": 8, "bonus": "3", "types": ["bludgeoning"]}]}], "system": {"type": {"value": "natural"}, "properties": ["fin"]}}]},
  // P/actors24/magic-items/goat-of-traveling.yml
  {"_id": "dmgGoatofTraveli", "name": "Goat of Traveling", "type": "npc", "img": null, "folder": "2AjZvlZWDCwSd0ry", "system": {"abilities": {"str": {"value": 16}, "dex": {"value": 13}, "con": {"value": 12}, "int": {"value": 2}, "wis": {"value": 11}, "cha": {"value": 7}}, "skills": {}, "attributes": {"ac": {"calc": "default"}, "hp": {"value": 13, "max": 13}, "movement": {"walk": "60", "units": null, "hover": false}, "senses": {"ranges": {}}}, "details": {"cr": 0.25, "type": {"value": "beast"}}, "traits": {"size": "lg"}}, "prototypeToken": {"name": "Goat of Traveling", "width": 2, "height": 2, "randomImg": false, "texture": {"src": null, "scaleX": 1, "scaleY": 1, "tint": "#ffffff"}}, "items": [{"_id": "phbaoiHooves0000", "name": "Hooves", "type": "weapon", "sort": 0, "activities": [{"id": "dnd5eactivity000", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "str"}, "labels": {"modifier": "+5", "toHit": "+5", "damage": [{"formula": "1d8 + 3", "damageType": "bludgeoning", "label": "1d8 + 3 Bludgeoning"}]}, "damage": [{"number": 1, "denomination": 8, "bonus": "3", "types": ["bludgeoning"]}]}], "system": {"type": {"value": "natural"}, "properties": ["fin"]}}]},
  // P/monsters/beast/wolf.yml
  {"_id": "yawTeS8u2FCfzzZH", "name": "Wolf", "type": "npc", "img": "systems/dnd5e/tokens/beast/Wolf.webp", "folder": "g8DmtGW2tiBpzCMk", "system": {"abilities": {"str": {"value": 12}, "dex": {"value": 15}, "con": {"value": 12}, "int": {"value": 3}, "wis": {"value": 12}, "cha": {"value": 6}}, "skills": {"prc": {"value": 1}, "ste": {"value": 1}}, "attributes": {"ac": {"calc": "natural", "flat": 13}, "hp": {"value": 11, "max": 11}, "movement": {"burrow": 0, "climb": 0, "fly": 0, "swim": 0, "walk": 40, "units": "ft", "hover": false}, "senses": {"ranges": {}}}, "details": {"cr": 0.25, "type": {"value": "beast"}}, "traits": {"size": "med"}}, "prototypeToken": {"name": "Wolf", "width": 1, "height": 1, "randomImg": false, "texture": {"src": "systems/dnd5e/tokens/beast/Wolf.webp", "scaleX": 1, "scaleY": 1, "tint": "#ffffff"}}, "items": [{"_id": "z1WFJdHb8OXvW2yy", "name": "Keen Hearing and Smell", "type": "feat", "sort": 0, "activities": []}, {"_id": "GtradZW0Fk8JKMAe", "name": "Pack Tactics", "type": "feat", "sort": 0, "activities": []}, {"_id": "MuH5aMoKOyZanrFf", "name": "Bite", "type": "weapon", "sort": 0, "activities": [{"id": "dnd5eactivity000", "type": "attack", "activation": {"type": "action", "value": 1}, "attack": {"ability": "dex"}, "labels": {"modifier": "+4", "toHit": "+4", "damage": [{"formula": "2d4 + 2", "damageType": "piercing", "label": "2d4 + 2 Piercing"}]}, "damage": [{"number": 2, "denomination": 4, "bonus": "2", "types": ["piercing"]}]}, {"id": "dnd5eactivity100", "type": "save", "activation": {"type": "action", "value": 1}}], "system": {"type": {"value": "natural"}, "properties": ["fin"]}}]},
]

// Each Beast's natural weapon is equipped in its P file (`system.equipped: true`, as
// P/actors24/beast/wolf.yml:729 has its Bite), so a form's sheet lists it among its actions, as dnd5e's does.
for (const beast of BEASTS) for (const item of beast.items) if (item.type === 'weapon') item.system.equipped = true

/** The 2014 Wolf of dnd5e's Monsters (SRD), P/monsters/beast/wolf.yml; the rest are the 2024 Actors'. */
const MONSTERS = new Set(['yawTeS8u2FCfzzZH'])

/** The 2024 Actors' folders, from their _folder.yml files, each with its parent; and the Monsters' Beast. */
const ACTORS24_FOLDERS = [
  { _id: 'TMBlXc3bnF7vL2Oy', name: 'Beast' }, { _id: 'B4jgCSN5ycmyM4ak', name: 'Celestial' },
  { _id: 'LK5iEx8W2Y5YxDHM', name: 'Swarm' }, { _id: 'UkOGmZEiXrlLv29I', name: 'Summons' },
  { _id: '4Lxoa4gitE28qJLk', name: 'Summon Templates', folder: 'UkOGmZEiXrlLv29I' },
  { _id: '9mmdDqYZFLIJBacj', name: 'Conjurations' }, { _id: '2AjZvlZWDCwSd0ry', name: 'Magic Items' },
]
const MONSTERS_FOLDERS = [{ _id: 'g8DmtGW2tiBpzCMk', name: 'Beast' }]

/** The Gamemaster's own world compendium's one Beast, synthetic, which players never see. */
const SECRET_BEAST = {
  _id: 'secretHare000000', name: 'Moon Hare', type: 'npc', img: 'icons/creatures/mammals/rabbit-movement-glowing-green.webp',
  system: {
    abilities: { str: { value: 4 }, dex: { value: 16 }, con: { value: 10 }, int: { value: 2 }, wis: { value: 12 }, cha: { value: 6 } },
    attributes: { ac: { calc: 'natural', flat: 13 }, hp: { value: 3, max: 3 }, movement: { walk: 50 } },
    details: { cr: 0, type: { value: 'beast' } }, traits: { size: 'tiny' },
  },
}

/* -------------------------------------------- */
/*  The druids                                  */
/* -------------------------------------------- */

/** The 2024 Wild Shape's three Challenge Rating profiles, as P/classes24/druid/class-features/wild-shape.yml has them. */
export const CR_PROFILES = Object.freeze(['xUPf0uISOwKy3mhO', 'yu86xk21fVzHg9r5', 'ZFqKHYlY9JhLYnx0'])

/**
 * The 2024 Wild Shape, P/classes24/druid/class-features/wild-shape.yml: a feat, `wild-shape`, its
 * uses its scale value, regained at a rest, and its one Transform activity, `FsDnynyqno8XNHgf`, of the
 * `wildshape` preset with no mode, by Challenge Rating; or the 2014 one, swK0r5TOIxredxWS
 * (P/classfeatures/druid/druid-features/wild-shape.yml), the same but for its id.
 * @param {object} [options]
 * @param {number} [options.spent]
 * @param {boolean} [options.legacy]   The 2014 one.
 * @returns {object}
 */
export function wildShapeItem({ spent = 0, legacy = false } = {}) {
  const profile = (_id, cr, name, movement, min, max) => ({ _id, cr, name, uuid: '', sizes: [], types: ['beast'], movement, level: { min, max } })
  return {
    _id: legacy ? 'swK0r5TOIxredxWS' : 'phbdrdWildShape0', name: 'Wild Shape', type: 'feat', sort: 300000,
    img: 'icons/creatures/mammals/bull-horns-eyes-glowin-orange.webp',
    system: {
      identifier: 'wild-shape', type: { value: 'class' }, source: { rules: legacy ? '2014' : '2024' },
      uses: { max: '@scale.druid.wild-shape-uses', spent, recovery: [{ period: 'lr', type: 'recoverAll' }, { period: 'sr', type: 'formula', formula: '1' }] },
      activities: {
        FsDnynyqno8XNHgf: {
          _id: 'FsDnynyqno8XNHgf', type: 'transform', activation: { type: 'bonus', value: 1 },
          consumption: [{ type: 'itemUses', value: '1', target: '' }], uses: { spent: 0, max: '' },
          profiles: [
            profile(CR_PROFILES[0], '0.25', 'CR ¼', ['fly'], null, 3), profile(CR_PROFILES[1], '0.5', 'CR ½', ['fly'], 4, 7),
            profile(CR_PROFILES[2], '1', 'CR 1', [], 8, null),
          ],
          transform: { customize: false, identifier: 'druid', preset: 'wildshape' },
        },
      },
    },
  }
}

/** An actor's ownership: Owner for each user given. */
const owned = owners => ({ default: 0, ...Object.fromEntries(owners.map(id => [id, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER])) })

/**
 * A character's source data: a druid of her level, Wisdom and circle, her 2024 (or 2014) Wild Shape,
 * and what else she's given; or, with no level, another class's.
 * @returns {object}
 */
function character({ id, name, owners, level, className = 'druid', hd = 'd8', wis = 16, con = 14, str = 10, subclass = null, rules = '2024', hp, items = [], wildShape = true }) {
  const isDruid = className === 'druid'
  return {
    _id: id, name, type: 'character', img: `icons/${id}.webp`, ownership: owned(owners),
    system: {
      abilities: {
        str: { value: str }, dex: { value: 14 }, con: { value: con }, int: { value: 12, proficient: isDruid ? 1 : 0 },
        wis: { value: wis, proficient: isDruid ? 1 : 0 }, cha: { value: 10 },
      },
      skills: isDruid ? { nat: { value: 1 }, prc: { value: 1 }, ani: { value: 1 } } : { ath: { value: 1 }, prc: { value: 1 } },
      attributes: { hp: { value: hp, max: hp, temp: 0 }, ac: { calc: 'default' }, movement: { walk: 30 }, spellcasting: isDruid ? 'wis' : '' },
      details: { alignment: 'Neutral Good', biography: { value: `<p>${name}'s story.</p>`, public: '' } },
      traits: { size: 'med', languages: { value: isDruid ? ['common', 'druidic'] : ['common', 'dwarvish'] } },
      spells: isDruid ? { spell1: { value: 4, max: 4 }, spell2: { value: 3, max: 3 }, spell3: { value: 2, max: 2 } } : {},
    },
    items: [
      { _id: `${id}Class`.padEnd(16, '0'), name: isDruid ? 'Druid' : 'Fighter', type: 'class', sort: 100000,
        system: { identifier: className, levels: level, hd: { denomination: hd, spent: 0 }, source: { rules } } },
      ...(subclass ? [{ _id: `${id}Subclass`.padEnd(16, '0'), name: 'Circle of the Moon', type: 'subclass', sort: 200000,
        system: { identifier: subclass, classIdentifier: 'druid' } }] : []),
      ...((isDruid && wildShape) ? [wildShapeItem({ legacy: rules === '2014' })] : []),
      ...items,
    ],
  }
}

/**
 * The world the contract's §10.1 sets: Elowen, a druid 5 with the 2024 Wild Shape (2 of 2 uses), Wild
 * Resurgence, Lucky (3 uses), Fey Step (an activity of 2 uses), Moonbeam and a quarterstaff; Rowan, a
 * druid 6 of the Circle of the Moon, Wisdom 17, with Moonbeam, Shillelagh and Bless; Oak, a druid 8; Fern, a 2014 druid 4;
 * Thorin, a fighter 5; and a hidden Ogre, a world NPC no player sees. Each a world actor, linked; and
 * the compendiums: dnd5e's 2024 Actors, its Monsters (SRD) and the Gamemaster's own Secret Beasts.
 * @param {object} [options]
 * @param {Record<string, string[]>} [options.owners]   Each character's owners by its id.
 * @returns {Record<string, TActor>}
 */
export function transformWorld({ owners = {} } = {}) {
  const make = data => {
    const actor = new TActor(data)
    actors.set(actor.id, actor)
    return actor
  }
  const spell = (id, name, level, concentration = false) => ({
    _id: id, name, type: 'spell', sort: 400000, system: { identifier: name.toLowerCase().replace(/\W+/g, '-'), level, properties: concentration ? ['concentration'] : [] },
  })
  const elowen = make(character({
    id: 'elowen', name: 'Elowen', owners: owners.elowen ?? ['alice'], level: 5, hp: 38,
    items: [
      { _id: 'phbdrdWildResurg', name: 'Wild Resurgence', type: 'feat', sort: 310000, system: { identifier: 'wild-resurgence', type: { value: 'class' } } },
      { _id: 'elowenLucky00000', name: 'Lucky', type: 'feat', sort: 320000,
        system: { identifier: 'lucky', uses: { max: '3', spent: 0, recovery: [{ period: 'lr', type: 'recoverAll' }] } } },
      { _id: 'elowenFeyStep000', name: 'Fey Step', type: 'feat', sort: 330000, system: { identifier: 'fey-step' },
        activities: [{ id: 'feyStepUse000000', type: 'utility', name: 'Step', uses: { max: '2', spent: 0, recovery: [{ period: 'lr', type: 'recoverAll' }] } }] },
      spell('elowenMoonbeam00', 'Moonbeam', 2, true),
      { _id: 'elowenStaff00000', name: 'Quarterstaff', type: 'weapon', sort: 500000, system: { type: { value: 'simpleM' }, properties: ['ver'] },
        activities: [{ id: 'staffAttack00000', type: 'attack', attack: { ability: 'str' }, labels: { modifier: '+3', toHit: '+3' }, damage: [{ number: 1, denomination: 6, bonus: '', types: ['bludgeoning'] }] }] },
    ],
  }))
  const rowan = make(character({
    id: 'rowan', name: 'Rowan', owners: owners.rowan ?? ['bob'], level: 6, wis: 17, subclass: 'moon', hp: 45,
    items: [spell('rowanMoonbeam000', 'Moonbeam', 2, true), spell('rowanShillelagh0', 'Shillelagh', 0), spell('rowanBless000000', 'Bless', 1, true)],
  }))
  const oak = make(character({ id: 'oak', name: 'Oak', owners: owners.oak ?? ['bob'], level: 8, hp: 59 }))
  const fern = make(character({ id: 'fern', name: 'Fern', owners: owners.fern ?? ['alice'], level: 4, rules: '2014', hp: 31 }))
  const thorin = make(character({ id: 'thorin', name: 'Thorin', owners: owners.thorin ?? ['carol'], level: 5, className: 'fighter', hd: 'd10', str: 16, con: 16, hp: 49 }))
  const ogre = make(normalised({
    _id: 'hiddenOgre000000', name: 'Ogre', type: 'npc', img: 'icons/ogre.webp', ownership: { default: 0 },
    system: { abilities: { str: { value: 19 } }, attributes: { ac: { calc: 'natural', flat: 11 }, hp: { value: 68, max: 68 }, movement: { walk: 40 } },
      details: { cr: 2, type: { value: 'giant' } }, traits: { size: 'lg' } },
    prototypeToken: { actorLink: false },
  }))
  packs.clear()
  for (const pack of [
    new PackStandIn({ collection: 'dnd5e.actors24', title: 'Actors', folders: ACTORS24_FOLDERS, documents: BEASTS.filter(beast => !MONSTERS.has(beast._id)) }),
    new PackStandIn({ collection: 'dnd5e.monsters', title: 'Monsters (SRD)', folders: MONSTERS_FOLDERS, documents: BEASTS.filter(beast => MONSTERS.has(beast._id)) }),
    new PackStandIn({ collection: 'world.secret-beasts', title: 'Secret Beasts', packageType: 'world', documents: [SECRET_BEAST], gmOnly: true }),
  ]) packs.set(pack.collection, pack)
  return { elowen, rowan, oak, fern, thorin, ogre }
}

/** A compendium Beast's uuid, by its name: the 2024 Actors' unless `pack` says. */
export function beastUuid(name, pack = 'dnd5e.actors24') {
  const found = [...(packs.get(pack)?.sources.values() ?? [])].find(source => source.name === name)
  if (!found) throw new Error(`No ${name} in ${pack}`)
  return `Compendium.${pack}.Actor.${found._id}`
}

/* -------------------------------------------- */
/*  Rests                                       */
/* -------------------------------------------- */

/**
 * A rest, as dnd5e's makes one on the client that rests (actor.mjs:2264-2332), as far as these
 * actors have it: on a Long Rest every use and activity use that a rest regains back, every hit die,
 * hit points to the maximum and temporary ones to 0, and every spell slot (spell and pact) to its
 * maximum (`_getRestSpellRecovery`, actor.mjs:2528-2538; config.mjs's restTypes); on a Short Rest the
 * uses a Short Rest regains, by their formula, and pact slots; then dnd5e.restCompleted, with
 * `longRest`.
 * @param {TActor} actor
 * @param {{type?: "long"|"short"}} [options]
 * @returns {Promise<object>}
 */
export async function rest(actor, { type = 'long' } = {}) {
  const longRest = type === 'long'
  const updateItems = []
  for (const item of actor.items) {
    const update = {}
    const uses = item._source.system?.uses
    const spent = Number(uses?.spent) || 0
    if (spent) {
      const recovery = Array.from(uses.recovery ?? [])
      const all = recovery.some(each => ((each.period === 'lr') && longRest) || ((each.period === 'sr') && (each.type === 'recoverAll')))
      const formula = recovery.find(each => (each.period === 'sr') && (each.type === 'formula'))
      if (all) update['system.uses.spent'] = 0
      else if (formula) update['system.uses.spent'] = Math.max(spent - (Number(formula.formula) || 0), 0)
    }
    for (const activity of item._source.activities ?? []) {
      if (longRest && (Number(activity.uses?.spent) > 0) && (activity.uses.recovery ?? []).some(each => each.period === 'lr')) {
        update[`system.activities.${activity.id}.uses.spent`] = 0
      }
    }
    if ((item.type === 'class') && longRest && (Number(item._source.system?.hd?.spent) > 0)) update['system.hd.spent'] = 0
    if (Object.keys(update).length) updateItems.push({ _id: item.id, ...update })
  }
  const updateData = {}
  if (longRest) {
    const hp = actor.system.attributes.hp
    if (hp.value !== hp.effectiveMax) updateData['system.attributes.hp.value'] = hp.effectiveMax
    if (hp.temp) updateData['system.attributes.hp.temp'] = 0
  }
  // Each pool's type, as dnd5e prepares it: spell1-9 "spell", pact "pact".
  const recovered = longRest ? ['spell', 'pact'] : ['pact']
  for (const [key, slot] of Object.entries(actor.system.spells ?? {})) {
    const type = slot.type ?? ((key === 'pact') ? 'pact' : (/^spell\d$/.test(key) ? 'spell' : null))
    if (recovered.includes(type) && Number.isFinite(Number(slot.max)) && (Number(slot.value) !== Number(slot.max))) {
      updateData[`system.spells.${key}.value`] = Number(slot.max)
    }
  }
  if (updateItems.length) await actor.updateEmbeddedDocuments('Item', updateItems, { isRest: true })
  if (Object.keys(updateData).length) await actor.update(updateData, { isRest: true })
  const result = { type, longRest, newDay: longRest, updateData, updateItems, deltas: {} }
  await Hooks.callAll('dnd5e.restCompleted', actor, result, { type })
  return result
}

/**
 * A party, a Group actor, whose rest rests each member's own actor and then, for a Gamemaster,
 * advances dish-core's clock by the rest's length, as group.mjs:315-353.
 * @param {string} id
 * @param {string} name
 * @param {TActor[]} members
 * @returns {object}
 */
export function partyOf(id, name, members) {
  return {
    id, name, type: 'group', documentName: 'Actor', uuid: `Actor.${id}`,
    system: { members: members.map(member => ({ actor: member })) },
    async rest({ type = 'long', duration = (type === 'long') ? 480 : 60 } = {}) {
      for (const { actor } of this.system.members) await rest(game.actors.get(actor.id) ?? actor, { type })
      if (game.user.isGM && (duration > 0)) await setWorldTime((game.time.worldTime ?? 0) + (60 * duration))
    },
  }
}
