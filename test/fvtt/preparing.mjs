// A character's spells prepared and unprepared from the app (module 0.42.1, round 0.42.1 §P.2-§P.3,
// §P.6.1, with its amendment): `"prepare"` among the hello's `features.rolls.kinds`, right after the
// charge kinds wherever the Gamemaster lets players attack and cast, never a companion's; the
// `prepare` command's checks, in their order; dnd5e's `system.prepared` set to the state wanted,
// never toggled, on a spell whose casting prepares, as the sheet sends it (`preparedOf`), never a
// cantrip's, an always prepared one's, one whose method doesn't prepare or one an item casts; what's
// already so done with nothing written; a write that throws or that a hook stops; the sheet ahead of
// every `done`; nothing posted in chat; `off` where the campaign is gone by the time it's made. And
// each spellcasting class's count of prepared spells, `spellcasting.classes[].prepared`, as dnd5e's
// sheet shows "Prepared 5 / 6": a cleric's, past its limit too, a multiclass caster's each its own,
// none for a 2014 sorcerer's, moved by a Prepare from the app or from Foundry. On favoriting.mjs's
// stand-ins, as it copies removals.mjs's: the real module and its language file, dnd5e 5.3.3's real
// dice classes for its self-test, a stand-in Foundry core and app; the actors' items as Foundry's
// embedded documents, here with dnd5e's spell data prepared as plain data, `canPrepare` among it as
// dnd5e's getter gives it, and a linked activity found as dnd5e finds it; each checked against
// dnd5e's own source, 5.3.3's or with DND5E6=1 6.0.5's. Timers of a second or more run a hundred
// times faster. Run with SLIM_CHECK=1 and --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settings, user, users, actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'
const ROOT = DND5E6 ? DND5E6_ROOT : DND5E5
const D = `${ROOT}/module`
const DICE = `${DND5E5}/module/dice`
const ok = message => console.log('ok -', message)
let oks = 0
const okay = message => { oks++; ok(message) }

// ---- Foundry ----
const registry = new Map()
globalThis.Hooks = {
  on(name, fn) { if (!registry.has(name)) registry.set(name, []); registry.get(name).push(fn); return fn },
  once(name, fn) {
    const once = (...args) => { this.off(name, once); return fn(...args) }
    return this.on(name, once)
  },
  off(name, fn) { registry.set(name, (registry.get(name) ?? []).filter(f => f !== fn)) },
  call(name, ...args) {
    for (const fn of registry.get(name) ?? []) if (fn(...args) === false) return false
    return true
  },
  callAll(name, ...args) { return Promise.all((registry.get(name) ?? []).map(fn => fn(...args))).then(() => true) },
}
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
globalThis.document ??= { hidden: false }
CONST.DOCUMENT_OWNERSHIP_LEVELS = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }
CONST.SORT_INTEGER_DENSITY = 100000
game.documentTypes = { Actor: ['character', 'npc', 'vehicle', 'group', 'encounter'], Item: ['weapon', 'equipment', 'consumable', 'tool', 'loot', 'container', 'feat', 'spell', 'class'] }
if (DND5E6) game.system.version = '6.0.5'

const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DICE}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DICE}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DICE}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DICE}/d20-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll })
CONFIG.Dice.terms.d = BasicDie
// dnd5e's spellcasting methods as far as preparing reads them: `prepares` on `spell` and `pact`
// alone (config.mjs), none on `atwill` or `innate`.
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase(), abbreviation: key }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: {
    spell: { prepares: true, exclusive: { spells: false, slots: false } },
    pact: { prepares: true, exclusive: { spells: false, slots: false } },
    atwill: {},
    innate: {},
  },
  damageTypes: { fire: { label: 'Fire' } },
  healingTypes: { healing: { label: 'Healing' } },
  activityActivationTypes: { action: { label: 'Action', header: 'Actions' }, bonus: { label: 'Bonus Action', header: 'Bonus Actions' } },
  currencies: Object.fromEntries(['pp', 'gp', 'ep', 'sp', 'cp'].map(id => [id, { label: `DND5E.Currency${id.toUpperCase()}`, abbreviation: id }])),
  weightUnits: { lb: { abbreviation: 'lb' } },
}
globalThis.dnd5e = { settings: { rulesVersion: 'modern' } }
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)

// The module's own words, from its language file, as Foundry's i18n gives them.
const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object')
  ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])
const words = Object.fromEntries(flat(JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))))
game.i18n.localize = key => words[key] ?? key
game.i18n.has = key => Object.hasOwn(words, key)
game.i18n.format = (key, data = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ''))
// Foundry's escapeHTML (common/utils/helpers.mjs).
foundry.utils.escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return html } } }

// What this harness stands in for, as dnd5e has it, 5.3.3's or 6.0.5's: a spell's `canPrepare` and
// `countsPrepared`, its linked activity, its count toward its class's preparations; a class's and a
// subclass's count reset, its maximum from its formula, and the spellcasting an item gives, its
// subclass's where that has a progression; its sheet's Prepare and Unprepare, a toggle; and its
// sheet's "Prepared x / y", shown where either is above 0.
const source = path => readFileSync(`${ROOT}/${path}`, 'utf8')
for (const [path, lines] of [
  ['module/data/item/spell.mjs', [
    'get canPrepare() {\n    return !!CONFIG.DND5E.spellcasting[this.method]?.prepares;',
    'get countsPrepared() {\n    return !!CONFIG.DND5E.spellcasting[this.method]?.prepares\n      && (this.level > 0)\n      && (this.prepared === CONFIG.DND5E.spellPreparationStates.prepared.value);',
    'return relative.items.get(itemId)?.system.activities?.get(activityId) ?? null;',
    'if ( this.classIdentifier && this.countsPrepared ) {',
    'if ( sourceClass ) sourceClass.system.spellcasting.preparation.value++;',
    'if ( sourceSubclass ) sourceSubclass.system.spellcasting.preparation.value++;',
  ]],
  ['module/data/item/class.mjs', ['this.spellcasting.preparation.value = 0;']],
  ['module/data/item/subclass.mjs', ['this.spellcasting.preparation.value = 0;']],
  ['module/data/item/fields/spellcasting-field.mjs', ['this.spellcasting.preparation.max = simplifyBonus(this.spellcasting.preparation.formula, rollData);']],
  ['module/documents/item.mjs', ['( subclassSC && (subclassSC.progression !== "none") ) ? subclassSC : classSC']],
  ['module/applications/components/inventory.mjs', ['return item.update({ "system.prepared": Number(!item.system.prepared) });']],
  ['templates/actors/tabs/creature-spells.hbs', ['{{#if (or preparation.value preparation.max)}}', '{{#if preparation.max}}']],
]) {
  const text = source(path)
  for (const line of lines) assert.ok(text.includes(line), `dnd5e's ${path} has: ${line}`)
}
okay(`dnd5e ${DND5E6 ? '6.0.5' : '5.3.3'}'s canPrepare, countsPrepared, linked activity, class preparations, item spellcasting, Prepare toggle and "Prepared x / y" are as this harness stands in for them`)

/* -------------------------------------------- */
/*  Embedded items, as Foundry's documents      */
/* -------------------------------------------- */

class Collection extends Map {
  /** As Foundry's: its values, not its entries. */
  [Symbol.iterator]() { return this.values() }
  get contents() { return [...this.values()] }
  find(fn) { return this.contents.find(fn) }
  filter(fn) { return this.contents.filter(fn) }
  map(fn) { return this.contents.map(fn) }
  some(fn) { return this.contents.some(fn) }
  reduce(fn, start) { return this.contents.reduce(fn, start) }
  first() { return this.contents[0] }
}

/** The switch that holds the next write it matches, as favoriting.mjs's; and a write that throws. */
const faults = { hold: null, throwOnUpdate: null }
const holding = async (target, changes) => {
  const hold = faults.hold
  if (hold?.when(target, changes)) { faults.hold = null; hold.held = true; await hold.until }
}
/** Hold the next write this matches until let go. */
function hold(when) {
  let release
  faults.hold = { when, until: new Promise(resolve => { release = resolve }) }
  const held = faults.hold
  return { release: () => release(), get held() { return held.held === true } }
}
const turn = () => new Promise(resolve => setImmediate(resolve))
/** Every item update asked for, made or not: `[id, changes]`. */
const updates = []

/** An activity, as dnd5e's sheet reads one: a utility, shown, by dnd5e 6's `isHidden` or 5's `canUse`. */
const activity = (id, name) => ({
  id, type: 'utility', name, img: 'icons/activity.webp', activation: { type: 'action' }, labels: { activation: 'Action' },
  ...(DND5E6 ? { isHidden: false } : { canUse: true }),
})

/**
 * An item a character holds, as Foundry's Item with dnd5e's data prepared: its activities, each
 * knowing its item; for a spell, its linked activity, found from its `cachedFor` flag as dnd5e's
 * getter finds it (data/item/spell.mjs), among its actor's items. Its `canPrepare` is plain data,
 * set as dnd5e's getter gives it, `!!spellcasting[method]?.prepares`.
 */
class HarnessItem {
  constructor(data, parent) {
    this.parent = parent
    this._source = structuredClone(data)
    this.prepare()
  }
  get id() { return this._source._id }
  get _id() { return this._source._id }
  get documentName() { return 'Item' }
  get uuid() { return `${this.parent.uuid}.Item.${this.id}` }
  get actor() { return this.parent }
  get isEmbedded() { return true }
  get pack() { return null }
  prepare() {
    const source = this._source
    this.type = source.type
    this.img = source.img ?? `${source._id}.webp`
    this.sort = source.sort ?? 0
    this.flags = structuredClone(source.flags ?? {})
    this._stats = {}
    this.isHidden = source.isHidden === true
    this.effects = new Collection()
    const system = structuredClone(source.system ?? {})
    system.properties = new Set(source.system?.properties ?? [])
    system.activities = new Collection((source.system?.activities ?? []).map(data => [data.id, { ...structuredClone(data), item: this }]))
    if (this.type === 'spell') {
      const item = this
      Object.defineProperty(system, 'linkedActivity', {
        configurable: true,
        get() {
          const relative = item.actor
          const uuid = item.getFlag('dnd5e', 'cachedFor')
          if (!relative || !uuid) return null
          const parts = uuid.split('.')
          const itemId = parts[parts.indexOf('Item') + 1]
          const activityId = parts[parts.indexOf('Activity') + 1]
          return relative.items.get(itemId)?.system.activities?.get(activityId) ?? null
        },
      })
    }
    this.system = system
    this.name = source.name
    this.labels = { properties: [] }
  }
  toObject() { return structuredClone(this._source) }
  getFlag(scope, key) { return foundry.utils.getProperty(this.flags?.[scope] ?? {}, key) }
  getRollData() { return {} }
  /** As Foundry's: `preUpdateItem` first, whose `false` stops it, resolving with nothing written. */
  async update(changes) {
    updates.push([this.id, structuredClone(changes)])
    await holding(this, changes)
    await turn()
    if (faults.throwOnUpdate) throw new Error(faults.throwOnUpdate)
    if (Hooks.call('preUpdateItem', this, foundry.utils.expandObject(structuredClone(changes)), {}, 'gm') === false) return undefined
    for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(this._source, path, value)
    this.prepare()
    await Hooks.callAll('updateItem', this, foundry.utils.expandObject(changes), {}, 'gm')
    return this
  }
}
globalThis.Item = HarnessItem

/** An actor's items, as Foundry's embedded documents. */
function embed(actor, items = []) {
  actor.items = new Collection()
  for (const data of items) actor.items.set(data._id, new HarnessItem(data, actor))
  actor.system.currency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 }
  return actor
}

/**
 * A character's spellcasting classes, as dnd5e prepares them: each with its `spellcasting`, as
 * documents/item.mjs gives it, a copy, whose `preparation` is its formula's maximum (an empty formula
 * 0, as simplifyBonus gives it) and its count of prepared spells, each of the character's spells that
 * `countsPrepared` and whose class is this one, as data/item/spell.mjs counts them.
 */
function spellcasting(actor, classes) {
  const counted = spell => Boolean(CONFIG.DND5E.spellcasting[spell.system.method]?.prepares)
    && ((spell.system.level ?? 0) > 0) && (spell.system.prepared === 1)
  const items = classes.map(({ identifier, name, formula, ability }) => ({
    id: `${identifier}Class`, type: 'class', name, identifier,
    get spellcasting() {
      const value = actor.items.filter(item => (item.type === 'spell') && (item.system.classIdentifier === identifier) && counted(item)).length
      return structuredClone({
        progression: 'full', ability, attack: 7, save: 15,
        preparation: { formula, max: formula ? Number(formula) : 0, value },
      })
    },
  }))
  Object.defineProperty(actor, 'spellcastingClasses', {
    configurable: true, get: () => Object.fromEntries(items.map(item => [item.identifier, item])),
  })
}

/* -------------------------------------------- */
/*  The world                                   */
/* -------------------------------------------- */

const { Actor5e } = await import('./actor5e.mjs')
const { equip } = await import('./activity5e.mjs')
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
for (const [id, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['eve', 'Eve']]) user(id, name)

/** A character, as dnd5e's, with its items. */
function character(id, name, owners, { items = [], ...data } = {}) {
  const actor = new Actor5e({ id, name, owners, ...data })
  equip(actor, { items: [], spells: data.spells ?? {} })
  actor.documentName = 'Actor'
  actors.set(id, embed(actor, items))
  return actor
}
/** A Group actor's members, as dnd5e 5.3.3 prepares them (data/actor/group.mjs:148-172). */
function membersOf(members) {
  const list = members.map(member => ({ actor: member }))
  Object.defineProperty(list, 'ids', { value: new Set(members.map(member => member.id)), enumerable: false })
  return list
}

/** An item's data as Foundry stores it. */
const itemData = (name, type, system = {}, { id, activities = [], ...fields } = {}) => ({
  _id: id, name, type, img: 'icons/item.webp', sort: 0, flags: {}, effects: [],
  system: { quantity: 1, identified: true, description: { value: '' }, weight: { value: 1, units: 'lb' }, activities, ...system },
  ...fields,
})
/** A spell's data, as dnd5e prepares it: its level and method, `canPrepare` as dnd5e's getter gives it. */
const spellData = (id, name, level, method, prepared, { canPrepare = Boolean(CONFIG.DND5E.spellcasting[method]?.prepares), ...system } = {}, fields = {}) =>
  itemData(name, 'spell', { level, method, prepared, canPrepare, ...system }, { id, ...fields })

// Thorin (Alice): Witch Bolt unprepared, Bless prepared, a domain spell always prepared, Fire Bolt (a
// cantrip), a spell cast at will, Hex by Pact Magic unprepared, Shield of Faith whose method prepares
// but whose `canPrepare` says it doesn't, Magic Missile his Wand casts, a copy of Light whose item is
// gone, the Wand, and a Longsword. Mira (Bob), a cleric 5 and wizard 3, whose cleric may prepare 6 and
// has 5 prepared, beside an always prepared one, a cantrip and two unprepared, and whose wizard may
// prepare 4 and has 1; Sable (Bob), a 2014 sorcerer, whose class prepares none, with a spell of hers
// prepared she added by hand, of no class, and one of the class unprepared. Stranger (Eve), no
// character of the campaign's; The Company, its party; and Fallen, a character whose actor is gone.
const thorin = character('thorin', 'Thorin', ['alice'], {
  items: [
    spellData('witch', 'Witch Bolt', 1, 'spell', 0),
    spellData('bless', 'Bless', 1, 'spell', 1),
    spellData('domain', 'Sanctuary', 1, 'spell', 2),
    spellData('bolt', 'Fire Bolt', 0, 'spell', 1),
    spellData('wisp', 'Misty Step', 2, 'atwill', 0),
    spellData('hex', 'Hex', 1, 'pact', 0),
    spellData('nocan', 'Shield of Faith', 1, 'spell', 1, { canPrepare: false }),
    spellData('copy', 'Magic Missile', 1, 'spell', 0, {}, { flags: { dnd5e: { cachedFor: '.Item.wand.Activity.castMissile0001' } } }),
    spellData('orphan', 'Light', 1, 'spell', 0, {}, { flags: { dnd5e: { cachedFor: '.Item.gone.Activity.castLight000001' } } }),
    itemData('Wand of Magic Missiles', 'consumable', {}, { id: 'wand', activities: [activity('castMissile0001', 'Cast Magic Missile')] }),
    itemData('Longsword', 'weapon', { equipped: true }, { id: 'sword' }),
  ],
  spells: { spell1: { value: 2, max: 2, level: 1 }, pact: { value: 1, max: 1, level: 1 } },
})
const cleric = level => (id, name, prepared) => spellData(id, name, level, 'spell', prepared, { classIdentifier: 'cleric' })
const mira = character('mira', 'Mira', ['bob'], {
  items: [
    ...[['c1', 'Bane'], ['c2', 'Command'], ['c3', 'Cure Wounds'], ['c4', 'Guiding Bolt'], ['c5', 'Healing Word']].map(([id, name]) => cleric(1)(id, name, 1)),
    cleric(1)('c6', 'Inflict Wounds', 0),
    cleric(2)('c7', 'Spiritual Weapon', 0),
    cleric(1)('cAlways', 'Protection from Evil and Good', 2),
    cleric(0)('cCantrip', 'Sacred Flame', 1),
    spellData('w1', 'Shield', 1, 'spell', 1, { classIdentifier: 'wizard' }),
    spellData('w2', 'Sleep', 1, 'spell', 0, { classIdentifier: 'wizard' }),
  ],
})
spellcasting(mira, [{ identifier: 'cleric', name: 'Cleric', formula: '6', ability: 'wis' }, { identifier: 'wizard', name: 'Wizard', formula: '4', ability: 'int' }])
const sable = character('sable', 'Sable', ['bob'], {
  items: [
    spellData('s1', 'Chromatic Orb', 1, 'spell', 1),
    spellData('s2', 'Sleep', 1, 'spell', 0, { classIdentifier: 'sorcerer' }),
  ],
})
spellcasting(sable, [{ identifier: 'sorcerer', name: 'Sorcerer', formula: '', ability: 'cha' }])
character('stranger', 'Stranger', ['eve'], { items: [spellData('sbless', 'Bless', 1, 'spell', 0)] })
const party = embed({
  documentName: 'Actor', id: 'party', name: 'The Company', type: 'group', uuid: 'Actor.party', img: 'party.webp', flags: {},
  ownership: { default: 0, alice: 3 }, system: { members: membersOf([thorin, mira]), description: { full: '', summary: '' } },
  getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
  testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
}, [spellData('pbless', 'Bless', 1, 'spell', 0)])
actors.set('party', party)
users.get('alice').character = thorin
users.get('bob').character = mira

/* -------------------------------------------- */
/*  The app                                     */
/* -------------------------------------------- */

// An app that takes favorites too, so a campaign whose rolls are off is still fetched for, and its
// commands refused as made while rolls are off.
const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, favorites: 1, groups: 1 } }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    return announcing ? json({ features: app.features }) : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.polls.push({ at: performance.now(), body })
    const id = body.campaign.id
    if (!app.waiting.get(id)?.length) {
      await new Promise(resolve => {
        const timer = realSetTimeout(resolve, 30)
        app.wake = () => { clearTimeout(timer); resolve() }
        init.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    const commands = app.waiting.get(id) ?? []
    app.waiting.set(id, [])
    return json({ commands })
  }
  throw new TypeError(`Unexpected fetch of ${url}`)
}
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
const resultsOf = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
const resultIndex = id => app.events.findIndex(e => (e.type === 'command.result') && (e.data.id === id))
let ids = 0
/** A spell prepared or unprepared, as the app hands it over. */
const preparing = (op, id, fields = {}) => ({
  id: `prepare-${++ids}`, actorId: 'thorin', kind: 'prepare', prepare: { op, id }, mode: 0, explicit: false, extras: [], dice: [], ...fields,
})
const prepare = (id, fields) => preparing('prepare', id, fields)
const unprepare = (id, fields) => preparing('unprepare', id, fields)
/** Hand the module commands for a campaign in one fetch; resolve once each has its result, with what was posted meanwhile. */
async function fetchedFor(campaignId, ...commands) {
  const from = app.events.length
  app.waiting.set(campaignId, [...(app.waiting.get(campaignId) ?? []), ...commands])
  app.wake?.()
  await until(() => commands.every(command => resultIndex(command.id) >= 0), `the result of ${commands.map(c => c.id).join(', ')}`)
  return commands.map(command => {
    const index = resultIndex(command.id)
    return { command, result: app.events[index].data, after: app.events.slice(from, index) }
  })
}
/** Hand the module commands for Ashlands without waiting on them. */
const handOver = (...commands) => {
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), ...commands])
  app.wake?.()
}
const made = async (command, campaignId = 'camp-a') => (await fetchedFor(campaignId, command))[0]
const refusal = ({ result }) => [result.status, result.reason, result.error]
/** The sheets sent to Ashlands between a command's fetch and its result. */
const sheetsIn = ({ after }) => after.filter(e => ['group.updated', 'character.updated'].includes(e.type) && (e.campaign?.id === 'camp-a'))
  .map(e => [e.type, (e.data.group ?? e.data.character).id])
/** The last sheet of a character sent to Ashlands, in what's given, or of all. */
const lastSheet = (actorId, events = app.events) => events.findLast(e => (e.type === 'character.updated') && (e.campaign?.id === 'camp-a')
  && (e.data.character.id === actorId))?.data.character.sheet
/** A sheet's spells, by id: how each is prepared. */
const preparedIn = sheet => Object.fromEntries(sheet.spells.flatMap(section => section.spells).map(spell => [spell.id, spell.prepared]))
/** A sheet's spellcasting classes: each one's name and count, `prepared` where it's sent. */
const countsIn = sheet => sheet.spellcasting.classes.map(entry => [entry.name, entry.prepared ?? 'none'])
/** How Thorin's spells are prepared, as dnd5e keeps them. */
const stored = (actor = thorin) => Object.fromEntries(actor.items.filter(item => item.type === 'spell').map(item => [item.id, item.system.prepared]))
const DONE = { status: 'done', reason: null, error: null, messageId: null, visible: true, rolls: [] }
const done = made => assert.deepEqual(made.result, { id: made.command.id, ...DONE })

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret', 'camp-b': 'mirkwood-secret', 'camp-c': 'dale-secret' })
// Ashlands lets its players attack and cast from the app; Mirkwood makes their rolls but not that;
// Dale makes no rolls of theirs, attacks or not.
const ASHLANDS = { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'mira', 'sable', 'fallen'], groups: ['party'], rolls: true, attacks: true, transfers: false }
const CAMPAIGNS = [
  ASHLANDS,
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'], groups: [], rolls: true, attacks: false, transfers: false },
  { id: 'camp-c', title: 'Dale', characters: ['thorin'], groups: [], rolls: false, attacks: true, transfers: false },
]
const campaignsAs = (change = {}) => settings.set('campaigns', CAMPAIGNS.map(campaign => ((campaign.id === 'camp-a') ? { ...campaign, ...change } : campaign)))
campaignsAs()
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const { slimSheet } = await import(`${MODULE}/scripts/sheet-slim.mjs`)
const { rollFeatures } = await import(`${MODULE}/scripts/commands.mjs`)
await until(() => ['camp-a', 'camp-b', 'camp-c'].every(id => app.events.some(e => (e.type === 'bridge.hello') && (e.campaign.id === id))), 'the hellos')
await wait(60)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
const settle = () => wait(320)
await settle()
const helloOf = id => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === id)).at(-1)

/* -------------------------------------------- */
/*  1. Kinds                                    */
/* -------------------------------------------- */

const CHARGES = ['spend', 'inspiration', 'spellSlot']
const kindsOf = id => helloOf(id).data.features.rolls.kinds
const ashlands = kindsOf('camp-a')
const at = ashlands.indexOf('prepare')
assert.ok(at > 0, 'Ashlands lists it')
assert.deepEqual(ashlands.slice(at - CHARGES.length, at + 1), [...CHARGES, 'prepare'], 'right after the charge kinds')
assert.equal(ashlands.filter(kind => kind === 'prepare').length, 1, 'once')
assert.ok(!helloOf('camp-a').data.features.companions.kinds.includes('prepare'), "never a companion's")
assert.ok(helloOf('camp-a').data.features.companions.kinds.length > 0, "a companion's kinds are listed")
assert.ok(kindsOf('camp-b').length && !kindsOf('camp-b').some(kind => [...CHARGES, 'prepare'].includes(kind)), "Mirkwood, whose players may not attack, lists none with the charges")
assert.deepEqual(kindsOf('camp-c'), [], 'Dale, its rolls off, lists none')
diceStatus.ready = false
assert.deepEqual(rollFeatures(ASHLANDS).kinds, [], 'none before the dice are ready')
diceStatus.ready = true
assert.ok(rollFeatures(ASHLANDS).kinds.includes('prepare'), 'once they are')
for (const id of ['camp-a', 'camp-b', 'camp-c']) assert.ok(!helloOf(id).data.features.companions.kinds.includes('prepare'), `${id}: never a companion's`)
okay(`features.rolls.kinds lists "prepare" once, right after ${CHARGES.join(', ')}, where the Gamemaster lets players attack and cast; none where they may not, nor with rolls off, nor before the dice are ready; never among features.companions.kinds`)

/* -------------------------------------------- */
/*  11. The sheet as before                     */
/* -------------------------------------------- */

const BEFORE = { witch: 0, bless: 1, domain: 2, bolt: null, wisp: null, hex: 0, nocan: null, copy: null }
const firstSheet = lastSheet('thorin')
assert.deepEqual(preparedIn(firstSheet), BEFORE, "the hello's sheet: each spell's prepared as before 0.42.1, Light's orphaned copy left out")
assert.deepEqual(preparedIn(characterSheet(thorin)), BEFORE)
okay("the sheet sends each spell's prepared as before 0.42.1: Witch Bolt 0, Bless 1, the domain spell 2, Hex 0, and null for Fire Bolt (a cantrip), Misty Step (at will), Shield of Faith (canPrepare false though its method is spell) and the Wand's Magic Missile; Light's copy, its item gone, left out")

/* -------------------------------------------- */
/*  2. Prepare                                  */
/* -------------------------------------------- */

let it
let lines = messages.size
let count = updates.length
it = await made(prepare('witch'))
done(it)
assert.equal(thorin.items.get('witch').system.prepared, 1, 'Witch Bolt prepared')
assert.deepEqual(updates.slice(count), [['witch', { 'system.prepared': 1 }]], 'one update, of system.prepared to 1')
assert.deepEqual(sheetsIn(it), [['character.updated', 'thorin']], 'his sheet before the result')
assert.equal(preparedIn(lastSheet('thorin', it.after)).witch, 1, 'the sheet sent shows it prepared')
assert.equal(messages.size, lines, 'no chat message')
okay('Prepare of Witch Bolt sets its system.prepared to 1 in one update; his sheet, showing it prepared, goes ahead of the result, `done`, messageId null, visible, rolls [], nothing else; nothing posted in chat')

/* -------------------------------------------- */
/*  3. Unprepare; Pact Magic                    */
/* -------------------------------------------- */

await settle()
count = updates.length
done(it = await made(unprepare('bless')))
assert.deepEqual([thorin.items.get('bless').system.prepared, updates.slice(count)], [0, [['bless', { 'system.prepared': 0 }]]])
assert.equal(preparedIn(lastSheet('thorin', it.after)).bless, 0)
await settle()
done(it = await made(prepare('hex')))
assert.equal(thorin.items.get('hex').system.prepared, 1, 'Hex, by Pact Magic, prepared')
assert.equal(preparedIn(lastSheet('thorin', it.after)).hex, 1)
await settle()
done(it = await made(unprepare('hex')))
assert.equal(thorin.items.get('hex').system.prepared, 0, 'and unprepared')
assert.equal(preparedIn(lastSheet('thorin', it.after)).hex, 0)
await settle()
done(await made(prepare('bless')))
assert.equal(thorin.items.get('bless').system.prepared, 1, 'Bless prepared again')
assert.equal(messages.size, lines, 'no chat message')
okay('Unprepare of Bless sets it to 0, its sheet before the result; Hex, by Pact Magic, prepared and unprepared the same; Bless prepared again; nothing posted')

/* -------------------------------------------- */
/*  4. Already so                               */
/* -------------------------------------------- */

await settle()
count = updates.length
it = await made(prepare('bless'))
done(it)
assert.deepEqual([updates.length, sheetsIn(it)], [count, []], 'Bless, prepared already: nothing written, and an unchanged sheet not sent again')
// Witch Bolt unprepared in Foundry a moment before, its own resend not yet sent: the app's sheet
// still shows it prepared, so its player unprepares it. Nothing is written; the newer sheet goes first.
await settle()
thorin.items.get('witch')._source.system.prepared = 0
thorin.items.get('witch').prepare()
it = await made(unprepare('witch'))
done(it)
assert.equal(updates.length, count, 'nothing written')
assert.deepEqual(sheetsIn(it), [['character.updated', 'thorin']], 'the newer sheet before the result')
assert.equal(preparedIn(lastSheet('thorin', it.after)).witch, 0, 'which shows it unprepared')
assert.equal(messages.size, lines, 'no chat message')
okay("a Prepare of Bless, prepared already, is `done` with nothing written and no unchanged sheet sent again; an Unprepare of Witch Bolt, unprepared in Foundry a moment before, `done` with nothing written, the newer sheet, showing it unprepared, ahead of the result")

/* -------------------------------------------- */
/*  5. Refused: not one he prepares             */
/* -------------------------------------------- */

await settle()
let before = stored()
for (const [command, why] of [
  [prepare('domain'), 'Sanctuary, always prepared (2)'],
  [unprepare('domain'), 'Sanctuary, always prepared, unprepared'],
  [unprepare('bolt'), 'Fire Bolt, a cantrip'],
  [prepare('bolt'), 'Fire Bolt prepared'],
  [prepare('wisp'), 'Misty Step, cast at will'],
  [unprepare('nocan'), "Shield of Faith, whose canPrepare is false though its method is spell"],
  [prepare('copy'), "the Wand's Magic Missile"],
]) {
  it = await made(command)
  assert.deepEqual(refusal(it), ['failed', 'prepare', null], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
assert.deepEqual([updates.length, messages.size, stored()], [count, lines, before], 'nothing written or posted')
okay('refuses `prepare`, nothing written, posted or sent: the domain spell always prepared, either way; Fire Bolt, a cantrip, either way; Misty Step, cast at will; Shield of Faith, its canPrepare false over its method; the Magic Missile the Wand casts')

/* -------------------------------------------- */
/*  6. Refused: gone                            */
/* -------------------------------------------- */

for (const [command, why] of [
  [prepare('nope'), 'a spell he lacks'],
  [prepare('sword'), 'the Longsword, no spell'],
  [prepare('orphan'), "Light's copy, its item gone, which the sheet leaves out"],
  [prepare('sbless'), "the Stranger's Bless"],
  [prepare('pbless'), "the Company's Bless"],
]) {
  it = await made(command)
  assert.deepEqual(refusal(it), ['failed', 'gone', null], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
assert.deepEqual([updates.length, messages.size, stored()], [count, lines, before], 'nothing written or posted')
okay("refuses `gone`, nothing written: a spell Thorin lacks, his Longsword, Light's copy whose item is gone (as the sheet hides it), and the Stranger's and the Company's spells")

/* -------------------------------------------- */
/*  7. Refused: invalid                         */
/* -------------------------------------------- */

const shaped = field => ({ ...prepare('witch'), prepare: field })
for (const [command, error, why] of [
  [{ ...prepare('witch'), prepare: undefined }, 'prepare', 'no prepare'],
  [shaped(null), 'prepare', 'prepare null'],
  [shaped('witch'), 'prepare', 'a string'],
  [shaped([{ op: 'prepare', id: 'witch' }]), 'prepare', 'an array'],
  [shaped({ op: 'prepare' }), 'prepare', 'no id'],
  [shaped({ id: 'witch' }), 'prepare', 'no op'],
  [shaped({ op: 'prepare', id: 'witch', from: 0 }), 'prepare', 'an extra key'],
  [shaped({ op: 'toggle', id: 'witch' }), 'prepare', 'an op neither prepare nor unprepare'],
  [shaped({ op: 'prepare', id: '' }), 'prepare', 'an empty id'],
  [shaped({ op: 'prepare', id: 'a.b' }), 'prepare', 'an id with a dot'],
  [shaped({ op: 'prepare', id: 'w'.repeat(65) }), 'prepare', 'an id of 65 letters'],
  [shaped({ op: 'prepare', id: 7 }), 'prepare', 'an id not a string'],
  [{ ...prepare('witch'), item: 'witch' }, 'prepare', 'an item beside it'],
  [{ ...prepare('witch'), key: 'prc' }, 'prepare', 'a key beside it'],
  [{ ...prepare('witch'), effect: { op: 'disable', id: 'bless' } }, 'prepare', 'an effect beside it'],
  [{ ...prepare('witch'), spellSlot: { op: 'spend', id: 'spell1', from: 2 } }, 'prepare', 'a spell slot beside it'],
  [{ ...prepare('witch'), favorite: { op: 'add', type: 'item', id: 'witch' } }, 'prepare', 'a favorite beside it'],
  [{ ...prepare('witch'), transfer: { from: 'thorin', to: 'mira', items: [{ id: 'sword', quantity: 1 }] } }, 'prepare', 'a move beside it'],
  [{ ...prepare('witch'), counter: { item: 'wand' }, count: 1 }, 'prepare', 'a counter beside it'],
  [{ ...prepare('witch'), typed: true }, 'prepare', 'typed: true'],
  [{ ...prepare('witch'), mode: 1 }, 'dice', 'advantage'],
  [{ ...prepare('witch'), dice: [{ faces: 20, results: [12] }] }, 'dice', 'a die'],
  [{ ...prepare('witch'), extras: [{ sign: 1, count: 1, sides: 4 }] }, 'dice', 'something added'],
  [{ ...prepare('witch'), by: 'gm' }, 'by', "the Gamemaster's"],
  [{ ...prepare('witch'), by: 'x' }, 'by', "by: 'x'"],
  [{ ...prepare('witch'), of: 'wolf' }, 'of', "a companion's, by `of`"],
  [{ ...prepare('witch'), of: '' }, 'of', 'an `of` that is no id'],
]) {
  it = await made(command)
  assert.deepEqual(refusal(it), ['failed', 'invalid', error], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
assert.deepEqual([updates.length, messages.size, stored()], [count, lines, before], 'nothing written or posted')
okay("refuses as `invalid`, nothing written, posted or sent: `prepare` missing, null, a string, an array, without id or op, with an extra key, an op but prepare or unprepare, an id empty, dotted, of 65 letters or not a string, or a roll's field, an effect, a spell slot, a favorite, a move, a counter or `typed` beside it (`prepare`); advantage, a die or anything added (`dice`); the Gamemaster's or a `by` but theirs (`by`); a companion's, or an `of` that is no id (`of`)")

/* -------------------------------------------- */
/*  8. Refused: unknown, attacks-off, off       */
/* -------------------------------------------- */

for (const [actorId, id, why] of [['stranger', 'sbless', 'an actor outside the campaign'], ['party', 'pbless', 'the Company'], ['fallen', 'witch', 'a character whose actor is gone']]) {
  it = await made(prepare(id, { actorId }))
  assert.deepEqual(refusal(it), ['failed', 'unknown', null], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
// The Company listed among the characters as well, as a stored setting might: still no character.
campaignsAs({ characters: [...ASHLANDS.characters, 'party'] })
assert.deepEqual(refusal(await made(prepare('pbless', { actorId: 'party' }))), ['failed', 'unknown', null], 'the Company among the characters too')
campaignsAs()
await settle()
assert.deepEqual(refusal(await made(prepare('witch'), 'camp-b')), ['failed', 'attacks-off', null], 'Mirkwood, whose players may not attack')
assert.deepEqual(refusal(await made(prepare('witch'), 'camp-c')), ['failed', 'off', null], 'Dale, its rolls off')
diceStatus.ready = false
it = await made(prepare('witch'))
diceStatus.ready = true
assert.deepEqual(refusal(it), ['failed', 'off', null], 'before the dice are ready')
assert.deepEqual([updates.length, messages.size, stored()], [count, lines, before], 'nothing written or posted')
// A prepare is checked as it's made, not as it's fetched: one taken while an earlier prepare of
// Thorin's still writes, made after the Gamemaster has deleted the campaign, is `off`.
{
  const ahead = hold(target => target.id === 'hex')
  const first = prepare('hex')
  handOver(first)
  await until(() => ahead.held, "Hex's update")
  const behind = prepare('witch')
  handOver(behind)
  await until(() => !app.waiting.get('camp-a')?.length, "Witch Bolt's fetch")
  const polls = app.polls.length
  await until(() => app.polls.length > polls, 'the fetch after it')
  settings.set('campaigns', CAMPAIGNS.filter(campaign => campaign.id !== 'camp-a'))
  ahead.release()
  await until(() => resultsOf(behind.id).length, "Witch Bolt's result")
  campaignsAs()
  assert.deepEqual([resultsOf(first.id)[0].status, refusal({ result: resultsOf(behind.id)[0] })], ['done', ['failed', 'off', null]])
  assert.deepEqual([thorin.items.get('hex').system.prepared, thorin.items.get('witch').system.prepared], [1, 0], 'Hex prepared ahead of it, Witch Bolt not')
  announce({ campaignId: 'camp-a' })
  await settle()
  done(await made(unprepare('hex')))
  await settle()
}
count = updates.length
before = stored()
okay("refuses `unknown` an actor outside the campaign, its party, even listed among its characters, and a character whose actor is gone; `attacks-off` where the Gamemaster doesn't let players attack and cast; `off` with the campaign's rolls off, before the dice are ready, and for a prepare taken while an earlier one of Thorin's still wrote, made once the campaign is gone: nothing written but the earlier one, nothing posted")

/* -------------------------------------------- */
/*  9. The write                                */
/* -------------------------------------------- */

faults.throwOnUpdate = 'The spell is locked'
it = await made(prepare('witch'))
faults.throwOnUpdate = null
assert.deepEqual(refusal(it), ['failed', 'error', 'The spell is locked'])
assert.deepEqual([updates.length, thorin.items.get('witch').system.prepared, sheetsIn(it), messages.size], [count + 1, 0, [], lines], 'tried once, nothing written, no sheet, no line')
// A module's preUpdateItem hook stops the write, as Foundry's update then resolves with nothing written.
const stop = Hooks.on('preUpdateItem', item => (item.id === 'witch') ? false : undefined)
it = await made(prepare('witch'))
Hooks.off('preUpdateItem', stop)
assert.deepEqual(refusal(it), ['failed', 'cancelled', null])
assert.deepEqual([updates.length, thorin.items.get('witch').system.prepared, sheetsIn(it), messages.size], [count + 2, 0, [], lines], 'tried once, read again unprepared, no sheet, no line')
count = updates.length
okay("an update that throws is `error` with its message, and one a preUpdateItem hook stops, read again unchanged, `cancelled`: Witch Bolt still unprepared, no sheet, nothing posted")

/* -------------------------------------------- */
/*  10. Refusal order                           */
/* -------------------------------------------- */

for (const [command, campaignId, want, why] of [
  [shaped({ op: 'toggle', id: 'witch' }), 'camp-c', 'off', 'rolls off, before an invalid command'],
  [shaped({ op: 'toggle', id: 'witch' }), 'camp-b', 'attacks-off', 'attacks off, before an invalid command'],
  [{ ...shaped({ op: 'toggle', id: 'witch' }), actorId: 'stranger' }, 'camp-a', 'invalid', 'an invalid command, before an actor outside the campaign'],
  [prepare('nope', { actorId: 'party' }), 'camp-a', 'unknown', 'the Company, before a spell gone'],
  [prepare('orphan'), 'camp-a', 'gone', 'a hidden copy, gone before it is the copy an item casts'],
  [prepare('nope'), 'camp-a', 'gone', 'a spell gone, before whether it prepares'],
]) {
  assert.equal((await made(command, campaignId)).result.reason, want, why)
}
assert.deepEqual([updates.length, messages.size, stored()], [count, lines, before], 'nothing written or posted')
okay('refusals in order: `off` before `invalid`, `attacks-off` before `invalid`, `invalid` before `unknown`, `unknown` before `gone`, `gone` (a hidden copy, a spell he lacks) before `prepare`')

/* -------------------------------------------- */
/*  12. Each class's count                      */
/* -------------------------------------------- */

// Mira's sheet: each of her classes, counting only its own spells, an always prepared one and a
// cantrip not counted, as dnd5e counts them; Sable's sorcerer, whose class prepares none and has
// none of its spells prepared, shown nothing, as dnd5e's sheet shows nothing.
const counted = actorId => countsIn(lastSheet(actorId))
assert.deepEqual(counted('mira'), [['Cleric', { value: 5, max: 6 }], ['Wizard', { value: 1, max: 4 }]], "Mira's classes, each its own count")
assert.deepEqual(counted('sable'), [['Sorcerer', 'none']], "Sable's 2014 sorcerer: no count")
assert.ok(!Object.hasOwn(lastSheet('sable').spellcasting.classes[0], 'prepared'), 'no `prepared` key at all')
assert.deepEqual(lastSheet('mira').spellcasting.classes[0], { name: 'Cleric', ability: 'WIS', dc: 15, attack: 7, prepared: { value: 5, max: 6 } }, 'the class as before, `prepared` added')
assert.deepEqual(countsIn(characterSheet(thorin)), [], 'Thorin, with no spellcasting class, none')
// What dnd5e may give a class otherwise: no preparation, numbers that aren't, a fraction from a
// formula, a formula below 0. Each a whole number from 0, or nothing where either isn't a number.
const { spellcastingOf } = await import(`${MODULE}/scripts/sheet-spells.mjs`)
const classed = preparation => spellcastingOf({
  system: { attributes: {} }, itemTypes: { spell: [] },
  spellcastingClasses: { odd: { name: 'Odd', spellcasting: { ability: 'int', save: 12, attack: 4, ...(preparation !== undefined && { preparation }) } } },
}).classes[0].prepared ?? 'none'
assert.deepEqual([
  classed(undefined), classed(null), classed({}), classed({ value: '5', max: 6 }), classed({ value: 2, max: Number.NaN }),
  classed({ value: 3.7, max: 4.5 }), classed({ value: 3, max: -2 }), classed({ value: 0, max: -1 }), classed({ value: 0, max: 3 }),
], ['none', 'none', 'none', 'none', 'none', { value: 3, max: 4 }, { value: 3, max: 0 }, 'none', { value: 0, max: 3 }],
'none without numbers; whole numbers from 0; a maximum alone shown, as dnd5e shows it')
assert.deepEqual(slimSheet(lastSheet('mira')).spellcasting, lastSheet('mira').spellcasting, 'a slim sheet keeps it')
const mirasOwn = (op, id) => preparing(op, id, { actorId: 'mira' })
const counts = []
for (const [command, cleric, wizard, why] of [
  [mirasOwn('prepare', 'c6'), { value: 6, max: 6 }, { value: 1, max: 4 }, 'a sixth'],
  [mirasOwn('prepare', 'c7'), { value: 7, max: 6 }, { value: 1, max: 4 }, 'a seventh, past her limit, never refused nor capped'],
  [mirasOwn('prepare', 'w2'), { value: 7, max: 6 }, { value: 2, max: 4 }, "a wizard's, her cleric's count unchanged"],
  [mirasOwn('unprepare', 'c7'), { value: 6, max: 6 }, { value: 2, max: 4 }, 'the seventh unprepared'],
  [mirasOwn('unprepare', 'c6'), { value: 5, max: 6 }, { value: 2, max: 4 }, 'the sixth'],
  [mirasOwn('unprepare', 'w2'), { value: 5, max: 6 }, { value: 1, max: 4 }, "the wizard's"],
]) {
  await settle()
  it = await made(command)
  done(it)
  assert.deepEqual(sheetsIn(it), [['character.updated', 'mira']], `${why}: her sheet before the result`)
  assert.deepEqual(countsIn(lastSheet('mira', it.after)), [['Cleric', cleric], ['Wizard', wizard]], why)
  counts.push(countsIn(lastSheet('mira', it.after)).map(([, entry]) => `${entry.value}/${entry.max}`).join(' '))
}
// Prepared in Foundry, from dnd5e's own menu: the count moves with the next sheet.
await settle()
let mark = app.events.length
await mira.items.get('c6').update({ 'system.prepared': 1 })
await until(() => countsIn(lastSheet('mira', app.events.slice(mark)) ?? { spellcasting: { classes: [] } }).length, "Mira's sheet after Foundry's Prepare")
assert.deepEqual(countsIn(lastSheet('mira', app.events.slice(mark))), [['Cleric', { value: 6, max: 6 }], ['Wizard', { value: 1, max: 4 }]], "Foundry's Prepare: 6 / 6 with the next sheet")
await settle()
mark = app.events.length
await mira.items.get('c6').update({ 'system.prepared': 0 })
await until(() => lastSheet('mira', app.events.slice(mark)), "Mira's sheet after Foundry's Unprepare")
assert.deepEqual(countsIn(lastSheet('mira', app.events.slice(mark))), [['Cleric', { value: 5, max: 6 }], ['Wizard', { value: 1, max: 4 }]])
// Sable's sorcerer prepares none, yet counts one of its spells prepared, as a homebrew class may:
// shown alone, with a maximum of 0; then nothing again.
await settle()
it = await made(preparing('prepare', 's2', { actorId: 'sable' }))
done(it)
assert.deepEqual(countsIn(lastSheet('sable', it.after)), [['Sorcerer', { value: 1, max: 0 }]], 'one of its own prepared: 1, of 0')
await settle()
it = await made(preparing('unprepare', 's2', { actorId: 'sable' }))
done(it)
assert.deepEqual(countsIn(lastSheet('sable', it.after)), [['Sorcerer', 'none']], 'none again')
okay(`each spellcasting class's count, as dnd5e's sheet shows "Prepared x / y": Mira's cleric 5 / 6 and wizard 1 / 4, each counting only its own spells, never an always prepared one or a cantrip; from the app ${counts.join(', ')}, a seventh past her limit never refused nor capped, her sheet ahead of each result; a Prepare in Foundry moves it with the next sheet; Sable's 2014 sorcerer, whose formula is empty, sends no prepared key, and with one of its spells prepared 1 of 0; a slim sheet keeps it; Thorin, of no class, none; a class's preparation without numbers none, a fraction rounded down, below 0 taken as 0`)

// ---- END ----
console.log(`preparing${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
