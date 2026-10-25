// An item removed from a character from the app (module 0.33.0, its contract §2-§3, §3.10):
// the hello's `features.removals`, with no switch, and the fetching it needs with the campaign's
// rolls and moves off; the `remove` command's checks; who may remove what; how many the app's sheet
// showed (`held`) and `changed`; part of a stack lowered, all of it deleted, a container with
// everything in it in one call; the Removes line, its speaker, author, marks and escaping, never a
// hidden or unidentified name; what a refused write leaves, a container kept or its contents; the
// sheet ahead of the result; `off` where the system has changed or the campaign is gone by the time
// it's made; and removals waiting for rolls and moves, by the queues and, past the 60 s watchdog, by
// the moves' chain alone. On transfers.mjs's stand-ins, as sends.mjs copies them: the real module
// and its language file, dnd5e 5.3.3's real dice classes for its self-test, a stand-in Foundry core
// and app; the actors' items as Foundry's embedded documents, firing its hooks, with dnd5e's own
// createWithContents read from its source, 5.3.3's or with DND5E6=1 6.0.5's. Timers of a second or
// more run a hundred times faster, so the 60 s watchdog fires in 600 ms. Run with SLIM_CHECK=1 and
// --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settings, user, users, actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'
const D = DND5E6 ? `${DND5E6_ROOT}/module` : `${DND5E5}/module`
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
game.documentTypes = { Actor: ['character', 'npc', 'vehicle', 'group', 'encounter'], Item: ['weapon', 'equipment', 'consumable', 'tool', 'loot', 'container', 'feat'] }
if (DND5E6) game.system.version = '6.0.5'

const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DICE}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DICE}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DICE}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DICE}/d20-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll })
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase(), abbreviation: key }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: { fire: { label: 'Fire' } },
  healingTypes: { healing: { label: 'Healing' } },
  // dnd5e's coins, in its order (config.mjs), each with its abbreviation as the sheet shows it.
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
// Foundry's escapeHTML (common/utils/helpers.mjs) and deleteProperty (common/utils/helpers.mjs).
foundry.utils.escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
foundry.utils.deleteProperty = (object, key) => {
  const parts = key.split('.')
  const parent = parts.slice(0, -1).reduce((o, part) => o?.[part], object)
  if (!parent || !(parts.at(-1) in parent)) return false
  delete parent[parts.at(-1)]
  return true
}
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return html } } }

/* -------------------------------------------- */
/*  Embedded items, as Foundry's documents      */
/* -------------------------------------------- */

export class Collection extends Map {
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

/** Every write made, in order: [what, actor or item id, changes or ids], and the switches that make one fail or wait. */
const writes = []
const faults = { failCreate: null, failDelete: null, failUpdate: null, hold: null, refuse: null }
const fault = (kind, target, changes) => {
  if (faults[kind]?.(target, changes)) throw new Error(`${kind} of ${target.id} refused`)
}
/**
 * Does a module's pre-hook refuse this write, as `refuse('create'|'update'|'delete', document, entry)`
 * says? Foundry then leaves it out without throwing: a create or delete makes the rest, an update
 * resolves to nothing, and no hook after fires for it.
 */
const refused = (what, target, entry) => faults.refuse?.(what, target, entry) === true
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
const clearFaults = () => Object.assign(faults, { failCreate: null, failDelete: null, failUpdate: null, hold: null, refuse: null })
const turn = () => new Promise(resolve => setImmediate(resolve))

/** An item a character or group holds, as Foundry's Item with dnd5e's data prepared: its name unidentified as dnd5e names it (identifiable.mjs:58-62), its uses' value, a container's contents. */
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
    const item = this
    this.type = source.type
    this.img = source.img ?? `${source._id}.webp`
    this.sort = source.sort ?? 0
    this.flags = structuredClone(source.flags ?? {})
    this._stats = structuredClone(source._stats ?? {})
    this.effects = new Collection((source.effects ?? []).map(effect => [effect._id, structuredClone(effect)]))
    const system = structuredClone(source.system ?? {})
    system.properties = new Set(source.system?.properties ?? [])
    if (system.uses) Object.defineProperty(system.uses, 'value', { get() { return Math.max((this.max ?? 0) - (this.spent ?? 0), 0) } })
    if (source.type === 'container') {
      // container.mjs:107-140: what it holds, from its actor's items, and all of it at any depth.
      Object.defineProperty(system, 'contents', {
        get: () => new Collection(item.parent.items.filter(other => other.system.container === item.id).map(other => [other.id, other])),
      })
      Object.defineProperty(system, 'allContainedItems', {
        get() {
          return this.contents.reduce((all, inner) => {
            all.set(inner.id, inner)
            if (inner.type === 'container') inner.system.allContainedItems.forEach(deeper => all.set(deeper.id, deeper))
            return all
          }, new Collection())
        },
      })
    }
    this.system = system
    this.name = ((system.identified === false) && system.unidentified?.name) ? system.unidentified.name : source.name
    this.labels = { properties: [] }
  }
  toObject() { return structuredClone(this._source) }
  getFlag(scope, key) { return foundry.utils.getProperty(this.flags?.[scope] ?? {}, key) }
  async update(changes) {
    writes.push(['updateItem', this.id, changes])
    await holding(this, changes)
    await turn()
    fault('failUpdate', this, changes)
    if (refused('update', this, changes)) return undefined
    for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(this._source, path, value)
    this.prepare()
    await Hooks.callAll('updateItem', this, foundry.utils.expandObject(changes), {}, 'gm')
    return this
  }
}
globalThis.Item = HarnessItem

/** dnd5e's Item5e, as far as moving uses it: its own createWithContents, read from its source. */
const PhysicalItemTemplate = { MAX_DEPTH: 5 }
const itemSource = readFileSync(`${D}/documents/item.mjs`, 'utf8').split('\n')
const [first, last] = DND5E6 ? [1303, 1335] : [1278, 1310]
const method = itemSource.slice(first - 1, last).join('\n')
assert.match(method, /^\s*static async createWithContents\(items, \{ container, keepId=false, transformAll, transformFirst \}=\{\}\) \{/)
const Item5e = new Function('Item', 'PhysicalItemTemplate', `return class Item5e extends Item {\n${method}\n}`)(HarnessItem, PhysicalItemTemplate)
CONFIG.Item = { documentClass: Item5e }
const copiedBy = []
const createWithContents = Item5e.createWithContents
Item5e.createWithContents = function (items, options) {
  copiedBy.push(items.map(item => item.id))
  return createWithContents.call(this, items, options)
}
// Foundry's WorldCollection#fromCompendium, as createWithContents calls it [core, unverified: what it keeps]:
// the document's data, its id, sort and ownership kept as asked.
game.items = {
  fromCompendium(document, { keepId = false, clearSort = true, clearOwnership = true } = {}) {
    const data = document.toObject()
    if (!keepId) delete data._id
    if (clearSort) delete data.sort
    if (clearOwnership) delete data.ownership
    return data
  },
}

/**
 * An actor's items and writes, as Foundry's: each write recorded, a create or delete as one call
 * with its ids, firing createItem, deleteItem or updateActor, as each client would.
 */
function embed(actor, items = []) {
  actor.items = new Collection()
  for (const data of items) actor.items.set(data._id, new HarnessItem(data, actor))
  actor._source ??= {}
  actor._source.name = actor.name
  actor._source.system = { currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...actor.coins } }
  delete actor.coins
  actor.prepareCurrency = function () {
    // dnd5e 6 rounds a coin down for the sheet, its source keeping the fraction (D6 data/shared/currency.mjs:43-47).
    this.system.currency = Object.fromEntries(Object.entries(this._source.system.currency).map(([key, value]) => [key, DND5E6 ? Math.floor(value) : value]))
  }
  actor.prepareCurrency()
  actor.update = async function (changes) {
    writes.push(['updateActor', this.id, changes])
    await holding(this, changes)
    await turn()
    fault('failUpdate', this, changes)
    if (refused('update', this, changes)) return undefined
    for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(this._source, path, value)
    for (const [path, value] of Object.entries(changes)) if (!path.startsWith('system.currency.')) foundry.utils.setProperty(this, path, value)
    this.prepareCurrency()
    await Hooks.callAll('updateActor', this, foundry.utils.expandObject(changes), {}, 'gm')
    return this
  }
  actor.createEmbeddedDocuments = async function (type, data, options = {}) {
    writes.push(['create', this.id, data.map(entry => entry._id ?? null), { keepId: options.keepId === true }])
    await holding(this, data)
    await turn()
    fault('failCreate', this, data)
    const made = data.filter(entry => !refused('create', this, entry)).map(entry => {
      const source = structuredClone(entry)
      source._id = (options.keepId && source._id) ? source._id : foundry.utils.randomID()
      const item = new HarnessItem(source, this)
      this.items.set(item.id, item)
      return item
    })
    for (const item of made) await Hooks.callAll('createItem', item, options, 'gm')
    return made
  }
  // The options it's called with are kept too: a removal never asks dnd5e to delete a container's
  // contents itself (`deleteContents`), as it names them.
  actor.deleteEmbeddedDocuments = async function (type, ids, options) {
    writes.push(['delete', this.id, [...ids], options ?? null])
    await holding(this, ids)
    await turn()
    fault('failDelete', this, ids)
    // As Foundry's: one that isn't there refuses the whole call.
    const missing = ids.find(id => !this.items.has(id))
    if (missing) throw new Error(`Item ${missing} does not exist`)
    const gone = ids.map(id => this.items.get(id)).filter(item => !refused('delete', this, item))
    for (const item of gone) this.items.delete(item.id)
    for (const item of gone) await Hooks.callAll('deleteItem', item, options ?? {}, 'gm')
    return gone
  }
  return actor
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
function character(id, name, owners, { items = [] } = {}) {
  const actor = new Actor5e({ id, name, owners })
  equip(actor, { items: [] })
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
/** A Group actor, with its items. */
function group(id, name, { members = [], ownership = {}, items = [] } = {}) {
  const g = {
    documentName: 'Actor', id, name, type: 'group', uuid: `Actor.${id}`, img: `${id}.webp`, flags: {},
    ownership: { default: 0, ...ownership },
    system: { members: membersOf(members), description: { full: '', summary: '' } },
    getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
    testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
  }
  actors.set(id, embed(g, items))
  return g
}

const POTION = 'Compendium.dnd5e.items.Item.phb-potion'
/** An item's data as Foundry stores it. */
const itemData = (name, type, system = {}, { id, source, ...fields } = {}) => ({
  _id: id, name, type, img: 'icons/item.webp', sort: 0, flags: {},
  _stats: source ? { compendiumSource: source } : {}, effects: [],
  system: { quantity: 1, identified: true, description: { value: '' }, weight: { value: 1, units: 'lb' }, ...system },
  ...fields,
})
const potion = (quantity, id = 'potion') => itemData('Potion of Healing', 'consumable',
  { quantity, uses: { max: 1, spent: 0, recovery: [] } }, { id, source: POTION })
/** Containers in containers, `depth` of them, the first at the top. */
const boxes = depth => Array.from({ length: depth }, (_, n) => itemData(`Box ${n + 1}`, 'container', { container: n ? `box${n}` : null }, { id: `box${n + 1}` }))

/**
 * What Thorin carries: a stack of potions, a rope, a backpack holding a bedroll and a pouch holding
 * a gem, an unidentified potion, a stack of no arrows, a worn ring, a chest that hides a letter, a
 * stack of two quivers holding a bolt case, three torches, an item whose name is HTML, a spell, and a
 * gem six containers deep.
 */
const thorinStock = () => [
  potion(3),
  itemData('Rope', 'loot', {}, { id: 'rope' }),
  itemData('Backpack', 'container', {}, { id: 'backpack' }),
  itemData('Bedroll', 'loot', { container: 'backpack' }, { id: 'bedroll' }),
  itemData('Pouch', 'container', { container: 'backpack' }, { id: 'pouch' }),
  itemData('Gem', 'loot', { container: 'pouch' }, { id: 'gem' }),
  itemData('Potion of Giant Strength', 'consumable', { identified: false, unidentified: { name: 'Strange Vial' } }, { id: 'vial', source: 'Compendium.dnd5e.items.Item.giant-strength' }),
  itemData('Arrows', 'consumable', { quantity: 0 }, { id: 'arrows' }),
  itemData('Ring of Protection', 'equipment', { equipped: true, attuned: true, attunement: 'required' }, { id: 'ring' }),
  itemData('Sealed Chest', 'container', { identified: false, properties: ['unidentifiedContents'] }, { id: 'chest' }),
  itemData('Letter', 'loot', { container: 'chest' }, { id: 'letter' }),
  itemData('Quiver', 'container', { quantity: 2 }, { id: 'quiver' }),
  itemData('Bolt Case', 'loot', { container: 'quiver' }, { id: 'boltcase' }),
  itemData('Torch', 'loot', { quantity: 3 }, { id: 'torch' }),
  itemData('Pick <b>Axe</b>', 'loot', {}, { id: 'pickaxe' }),
  itemData('Magic Missile', 'spell', { level: 1, school: 'evo', preparation: { mode: 'prepared', prepared: true }, properties: [] }, { id: 'missile' }),
  ...boxes(6),
  itemData('Deep Gem', 'loot', { container: 'box6' }, { id: 'deepgem' }),
]

// Thorin (Alice) and Vex (Bob), the campaign's characters, and Fallen, one whose actor is gone;
// Stranger (Eve), no character of the campaign's; The Iron Company, its party, Alice its Owner.
const thorin = character('thorin', 'Thorin', ['alice'], { items: thorinStock() })
const vex = character('vex', 'Vex', ['bob'], { items: [itemData('Lute', 'tool', {}, { id: 'lute' })] })
character('stranger', 'Stranger', ['eve'], { items: [itemData('Rope', 'loot', {}, { id: 'srope' })] })
const party = group('party', 'The Iron Company', {
  members: [thorin, vex], ownership: { alice: 3 }, items: [itemData('Rope', 'loot', {}, { id: 'prope' })],
})
Object.defineProperty(actors, 'party', { get: () => actors.get('party') ?? null, configurable: true })
users.get('alice').character = thorin
users.get('bob').character = vex

/* -------------------------------------------- */
/*  The app                                     */
/* -------------------------------------------- */

const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, removals: 1, groups: 1 } }
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
const lastResultIndex = id => app.events.findLastIndex(e => (e.type === 'command.result') && (e.data.id === id))
let ids = 0
/** A removal as the app hands it over: `held` the stack as stored now, unless given. */
const removal = (item, quantity, { held, actorId = 'thorin', ...fields } = {}) => ({
  id: `remove-${++ids}`, actorId, kind: 'remove',
  remove: { item, quantity, held: held ?? (actors.get(actorId)?.items?.get(item)?._source.system.quantity ?? quantity) },
  mode: 0, explicit: false, extras: [], dice: [], ...fields,
})
/** A move as the app hands it over. */
const move = (actorId, transfer, fields = {}) => ({
  id: `move-${++ids}`, actorId, kind: 'transfer', transfer, mode: 0, explicit: false, extras: [], dice: [], ...fields,
})
/** Hand the module commands in one fetch; resolve once each has its result, with what was posted meanwhile and the line it made. */
async function fetched(...commands) {
  const from = app.events.length
  const madeBefore = messages.size
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), ...commands])
  app.wake?.()
  await until(() => commands.every(command => resultIndex(command.id) >= 0), `the result of ${commands.map(c => c.id).join(', ')}`)
  const lines = [...messages.values()].slice(madeBefore)
  return commands.map(command => {
    const index = resultIndex(command.id)
    return {
      command, result: app.events[index].data, after: app.events.slice(from, index),
      line: lines.find(line => line.flags?.['sending-stone']?.request === command.id) ?? null,
    }
  })
}
/** Hand the module commands without waiting on them. */
const handOver = (...commands) => {
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), ...commands])
  app.wake?.()
}
const removed = async (...args) => (await fetched(removal(...args)))[0]
const refusal = ({ result }) => [result.status, result.reason, result.error]
/** The sheets sent between a command's fetch and its result. */
const sheetsIn = ({ after }) => after.filter(e => ['group.updated', 'character.updated'].includes(e.type)).map(e => [e.type, (e.data.group ?? e.data.character).id])
const lineOf = made => made.line?.content?.replace(/^<p>|<\/p>$/g, '') ?? null

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
const CAMPAIGN = { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'fallen'], groups: ['party'], rolls: false, attacks: false, transfers: false }
const campaignAs = (change = {}) => settings.set('campaigns', [{ ...CAMPAIGN, ...change }])
campaignAs()
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { removalFeatures, removalsOn } = await import(`${MODULE}/scripts/command-transfers.mjs`)
const { sendCharacter } = await import(`${MODULE}/scripts/character-sync.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
await until(() => app.events.some(e => e.type === 'bridge.hello'), 'the hello')
await wait(60)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
okay('the self-test still passes')

/** Give an actor these items in place of what it had, with no hook, as Foundry alone would. */
function stock(actor, items = []) {
  actor.items.clear()
  for (const data of items) actor.items.set(data._id, new HarnessItem(data, actor))
}
/** What an actor holds: each item's name, quantity as stored and container. */
const holds = actor => actor.items.map(item => [item.name, item._source.system.quantity, item._source.system.container ?? null])
const settle = () => wait(320)
/** Thorin as the world began, his sheet as the app was last told it, so that a sheet sent is one that changed. */
async function restock() {
  stock(thorin, thorinStock())
  stock(vex, [itemData('Lute', 'tool', {}, { id: 'lute' })])
  await settle()
  sendCharacter('thorin')
  sendCharacter('vex')
  await settle()
}
const helloOf = () => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).at(-1)
const sheet = characterSheet(thorin)
const listed = [...sheet.inventory.sections.flatMap(s => s.items), ...sheet.inventory.containers]
assert.ok(listed.some(item => item.id === 'potion') && listed.some(item => item.id === 'chest'), 'a character sheet, as dnd5e has it')

/* -------------------------------------------- */
/*  The hello                                   */
/* -------------------------------------------- */

const ON = { enabled: true, kinds: ['remove'], reason: null }
assert.deepEqual(helloOf().data.features.removals, ON)
// Changed on purpose (round 0.36.0 §4.1): and what its companions take.
// Changed on purpose (round 0.37.0 §6.7): and whether favorites are added and removed here.
// Changed on purpose (round 0.38.0 §D8.3): and whether dishes from the Magical Recipe Book are taken, after favorites.
assert.deepEqual(Object.keys(helloOf().data.features), ['rolls', 'transfers', 'removals', 'notes', 'companions', 'favorites', 'dishes'])
assert.deepEqual([helloOf().data.features.rolls.enabled, helloOf().data.features.transfers.enabled], [false, false], "the campaign's rolls and moves off")
// Apart from the rolls, the moves and the dice: whatever they are.
diceStatus.ready = false
assert.deepEqual(removalFeatures(), ON)
diceStatus.ready = true
game.system.id = 'pf2e'
assert.deepEqual(removalFeatures(), { enabled: false, kinds: [], reason: 'system' })
assert.equal(removalsOn(), false)
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(helloOf().data.features.removals, { enabled: false, kinds: [], reason: 'system' })
game.system.id = 'dnd5e'
campaignAs({ rolls: true, transfers: true })
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(helloOf().data.features.removals, ON, 'the same with rolls and moves on')
campaignAs()
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(helloOf().data.features.removals, ON)
okay("the hello's features.removals, after rolls and transfers, says items may be removed under dnd5e, kind `remove`, with rolls, moves and the self-test off or on; under another system `{ enabled: false, kinds: [], reason: 'system' }`")

/* -------------------------------------------- */
/*  Fetching                                    */
/* -------------------------------------------- */

const polling = async () => { const before = app.polls.length; await wait(150); return app.polls.length > before }
assert.equal(await polling(), true, 'fetched for removals alone, with rolls and moves off')
for (const [features, why] of [
  [{ commands: true }, 'an answer without removals'], [{ commands: true, removals: 0 }, 'removals: 0'],
  [{ commands: true, removals: '1' }, 'removals: "1"'], [{ commands: true, removals: true }, 'removals: true'],
  [{ removals: 1 }, 'without commands'],
]) {
  app.features = { ...features, groups: 1 }
  announce({ campaignId: 'camp-a' })
  await settle()
  assert.equal(await polling(), false, why)
}
app.features = { commands: true, removals: 1, groups: 1 }
game.system.id = 'pf2e'
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), false, 'another system')
game.system.id = 'dnd5e'
// The answer that first says `removals: 1` starts the fetching itself. A hello's own sync runs before
// its answer comes and reads what the answer before it said. Where that one said nothing of removals,
// only the new answer can start the fetching, and it does only if it notes them before it syncs.
app.features = { commands: true, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), false, 'stopped again by an answer without removals')
app.features = { commands: true, removals: 1, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), true, 'fetched again once the answer says so, started by that answer')
// A roll fetched while only removals are, as the app wouldn't hand over: refused as made while rolls are off.
const roll = (await fetched({ id: `roll-${++ids}`, actorId: 'thorin', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }] }))[0]
assert.deepEqual(refusal(roll), ['failed', 'off', null])
// And a move, with moves off.
const moving = (await fetched(move('thorin', { from: 'thorin', to: 'vex', items: [{ id: 'rope', quantity: 1 }] })))[0]
assert.deepEqual(refusal(moving), ['failed', 'transfers-off', null])
okay("with rolls and moves off, the campaign is fetched for only after an answer with features.removals 1 and commands, the first such answer starting it itself; 0, \"1\", true or none don't count, and an answer without it stops the fetching; never under another system; a roll fetched then is refused `off`, a move `transfers-off`")

/* -------------------------------------------- */
/*  The command                                 */
/* -------------------------------------------- */

await restock()
let unchanged = writes.length
let lines = messages.size
const base = { id: 'x', actorId: 'thorin', kind: 'remove', mode: 0, explicit: false, extras: [], dice: [] }
const rope = { item: 'rope', quantity: 1, held: 1 }
for (const [fields, error, why] of [
  [{ remove: undefined }, 'remove', 'remove missing'],
  [{ remove: [rope] }, 'remove', 'an array'],
  [{ remove: 'rope' }, 'remove', 'a string'],
  [{ remove: { ...rope, extra: true } }, 'remove', 'an extra field'],
  [{ remove: { item: 'rope', quantity: 1 } }, 'remove', 'held missing'],
  [{ remove: { ...rope, item: '' } }, 'remove', 'an empty id'],
  [{ remove: { ...rope, item: 5 } }, 'remove', 'an id not a string'],
  [{ remove: { ...rope, item: 'r'.repeat(65) } }, 'remove', 'an id too long'],
  [{ remove: rope, item: 'rope' }, 'remove', 'a top-level item'],
  [{ remove: rope, key: 'prc' }, 'remove', 'a key'],
  [{ remove: rope, transfer: { from: 'thorin', to: 'vex', items: [{ id: 'rope', quantity: 1 }] } }, 'remove', 'a transfer'],
  [{ remove: rope, typed: true }, 'remove', 'typed: true'],
  [{ remove: rope, typed: false }, 'remove', 'typed: false'],
  [{ remove: { ...rope, quantity: -1 } }, 'quantity', 'quantity -1'],
  [{ remove: { ...rope, quantity: 1.5, held: 2 } }, 'quantity', 'quantity 1.5'],
  [{ remove: { ...rope, quantity: '1' } }, 'quantity', "quantity '1'"],
  [{ remove: { ...rope, quantity: 10_000_001, held: 10_000_001 } }, 'quantity', 'quantity over the most'],
  [{ remove: { ...rope, held: -1 } }, 'quantity', 'held -1'],
  [{ remove: { ...rope, held: 1.5 } }, 'quantity', 'held 1.5'],
  [{ remove: { ...rope, held: '2' } }, 'quantity', "held '2'"],
  [{ remove: { ...rope, held: 10_000_001 } }, 'quantity', 'held over the most'],
  [{ remove: { item: 'potion', quantity: 3, held: 2 } }, 'quantity', 'more than held'],
  [{ remove: { item: 'potion', quantity: 0, held: 2 } }, 'quantity', 'none of a stack of some'],
  [{ remove: rope, dice: [{ faces: 20, results: [12] }] }, 'dice', 'a die'],
  [{ remove: rope, mode: 1 }, 'dice', 'advantage'],
  [{ remove: rope, extras: [{ sign: 1, count: 1, sides: 4 }] }, 'dice', 'something added'],
  [{ remove: rope, by: 'player' }, 'by', "by: 'player'"],
]) {
  const [made] = await fetched({ ...base, ...fields, id: `remove-${++ids}` })
  assert.deepEqual(refusal(made), ['failed', 'invalid', error], why)
  assert.deepEqual(sheetsIn(made), [], `${why}: no sheet`)
}
assert.deepEqual([writes.length, messages.size, thorin.items.has('rope')], [unchanged, lines, true], 'nothing written or posted')
okay("refuses as `invalid` a removal without `remove`, or one that's no object of item, quantity and held alone, an item not an id, a roll's field, a move or `typed` beside it (`remove`); a quantity or held not a whole number from 0 to 10,000,000, more than held, or none of a stack of some (`quantity`); dice, advantage or anything added (`dice`); a `by` but the Gamemaster's (`by`): nothing written, posted or sent")

/* -------------------------------------------- */
/*  Who, and what                               */
/* -------------------------------------------- */

for (const [actorId, why] of [['stranger', 'an actor outside the campaign'], ['party', 'the Company'], ['fallen', 'a character whose actor is gone']]) {
  const made = await removed(actorId === 'stranger' ? 'srope' : 'prope', 1, { actorId, held: 1 })
  assert.deepEqual(refusal(made), ['failed', 'unknown', null], why)
  assert.deepEqual(sheetsIn(made), [], `${why}: no sheet`)
}
for (const [item, quantity, held, reason, why] of [
  ['nothing', 1, 1, 'gone', 'an id not on Thorin'],
  ['prope', 1, 1, 'gone', "the Company's Rope"],
  ['lute', 1, 1, 'gone', "Vex's Lute"],
  ['missile', 1, 1, 'gone', 'a spell'],
  ['letter', 1, 1, 'gone', 'in a container that hides what it holds'],
  ['deepgem', 1, 1, 'gone', 'below five containers'],
  ['potion', 4, 4, 'short', 'four of three'],
  ['rope', 0, 0, 'changed', 'none of a Rope of one, as a stack of none'],
]) {
  const made = await removed(item, quantity, { held })
  assert.deepEqual(refusal(made), ['failed', reason, null], why)
  assert.deepEqual(sheetsIn(made), [], `${why}: no sheet`)
}
assert.deepEqual(refusal(await removed('letter', 1, { held: 1, by: 'gm' })), ['failed', 'gone', null], 'hidden from the Gamemaster too')
// The Company listed among the characters as well, as no Manage Campaigns lists it but a stored setting
// might: still no character to remove from, as one of the campaign's groups.
campaignAs({ characters: [...CAMPAIGN.characters, 'party'] })
assert.deepEqual(refusal(await removed('prope', 1, { actorId: 'party', held: 1 })), ['failed', 'unknown', null], 'the Company among the characters too')
assert.equal(party.items.has('prope'), true, "the Company's Rope kept")
campaignAs()
await settle()
assert.deepEqual([writes.length, messages.size], [unchanged, lines], 'nothing written or posted')
assert.deepEqual(holds(thorin), holds({ items: new Collection(thorinStock().map(data => [data._id, new HarnessItem(data, thorin)])) }), 'Thorin as he was')
okay("refuses as `unknown` a removal for an actor outside the campaign, its party, even one listed among its characters too, or a character whose actor is gone; as `gone` an item not Thorin's, the Company's, Vex's, a spell, one in a container that hides what it holds, the Gamemaster's too, or one below five containers; four of three potions as `short`; none of a Rope of one as `changed`: none writes, posts or sends a sheet")

/* -------------------------------------------- */
/*  Changed                                     */
/* -------------------------------------------- */

// The Torches lowered to 2 in Foundry alone, as a torch burnt there, the app's sheet still showing 3.
const torch = thorin.items.get('torch')
torch._source.system.quantity = 2
torch.prepare()
for (const [quantity, why] of [[2, 'two of three, a part as the app saw it, all there is now'], [1, 'one of three']]) {
  const made = await removed('torch', quantity, { held: 3 })
  assert.deepEqual(refusal(made), ['failed', 'changed', null], why)
  assert.deepEqual(sheetsIn(made), [], `${why}: no sheet`)
}
assert.deepEqual(writes.slice(unchanged), [], 'no write at all: no updateItem, no deleteItem')
assert.deepEqual([messages.size, thorin.items.get('torch')._source.system.quantity], [lines, 2], 'no line, the stack still 2')
let made = await removed('torch', 2, { held: 2 })
assert.equal(made.result.status, 'done')
assert.equal(lineOf(made), 'Removes 2 Torch')
assert.equal(thorin.items.has('torch'), false, 'deleted, as the app now sees it whole')
okay("where the Torches were burnt down to 2 in Foundry alone, a removal of 2, or 1, of the 3 the app showed is `changed`: nothing written, posted or sent, the stack still 2; 2 of the 2 shown deletes it, \"Removes 2 Torch\"")

/* -------------------------------------------- */
/*  Part of a stack, and all of it              */
/* -------------------------------------------- */

await restock()
let at = writes.length
const part = removal('potion', 2, { held: 3 })
;[made] = await fetched(part)
assert.deepEqual(writes.slice(at).filter(([what]) => what !== 'updateActor'), [['updateItem', 'potion', { 'system.quantity': 1 }]], 'one update of the stack')
assert.equal(thorin.items.get('potion')._source.system.quantity, 1)
assert.equal(lineOf(made), 'Removes 2 Potion of Healing')
assert.deepEqual([made.line.author.id, made.line.speaker.actor, made.line.whisper, made.line.blind], ['alice', 'thorin', [], false], 'as Thorin, by his player, for everyone')
assert.deepEqual(made.line.flags['sending-stone'], { request: part.id }, 'no typed, no by')
assert.deepEqual(made.result, {
  id: part.id, status: 'done', reason: null, error: null, messageId: made.line.id, visible: true, rolls: [],
  removed: { item: 'potion', quantity: 2 },
})
assert.ok(!('messages' in made.result), "a player's result lists no messages")
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin']], "Thorin's sheet before the result")
const sent = made.after.find(e => e.type === 'character.updated').data.character.sheet
const sentPotion = sent.inventory.sections.flatMap(s => s.items).find(item => item.id === 'potion')
assert.equal(sentPotion.quantity, 1, 'the sheet sent shows the stack lowered')
// The same command fetched again, as from a second fetch: taken once.
at = writes.length
lines = messages.size
handOver(part)
await wait(150)
assert.deepEqual([resultsOf(part.id).length, writes.length, messages.size], [1, at, lines], 'nothing more')
// The same removal sent again, as from a dialog left open: the stack isn't 3 now. Two of the one left
// are more than there are, `short`, checked first; one of the three the dialog showed, `changed`.
;[made] = await fetched(removal('potion', 2, { held: 3 }))
assert.deepEqual(refusal(made), ['failed', 'short', null])
;[made] = await fetched(removal('potion', 1, { held: 3 }))
assert.deepEqual(refusal(made), ['failed', 'changed', null], 'a part as the dialog had it, all there is now')
assert.deepEqual([writes.length, messages.size, thorin.items.get('potion')._source.system.quantity], [at, lines, 1], 'the Potion still 1')
okay("2 of 3 Potions lower the stack to 1 in one update: \"Removes 2 Potion of Healing\", public, as Thorin, by Alice, flagged with the request alone; `done` with `removed` `{ item: 'potion', quantity: 2 }`, its line's id, `visible`; Thorin's sheet, the stack at 1, ahead of the result; fetched again, nothing more; sent again with `held` 3, `short` for 2 of the 1 left and `changed` for 1, the Potion still 1")

made = await removed('rope', 1)
assert.deepEqual([made.result.status, made.result.removed, lineOf(made), thorin.items.has('rope')], ['done', { item: 'rope', quantity: 1 }, 'Removes 1 Rope', false])
okay('the whole of a Rope of one deletes it: "Removes 1 Rope"')

/* -------------------------------------------- */
/*  Containers                                  */
/* -------------------------------------------- */

// Something in a container alone, before the container: only it goes.
let from
at = writes.length
made = await removed('gem', 1)
assert.deepEqual(writes.slice(at).filter(([what]) => what === 'delete'), [['delete', 'thorin', ['gem'], null]])
assert.deepEqual([lineOf(made), thorin.items.has('pouch'), thorin.items.has('backpack')], ['Removes 1 Gem', true, true], 'the Pouch stays')
stock(thorin, thorinStock())
await settle()
at = writes.length
made = await removed('backpack', 1)
const deletes = writes.slice(at).filter(([what]) => what === 'delete')
assert.equal(deletes.length, 1, 'one deleteEmbeddedDocuments')
assert.deepEqual([deletes[0][0], deletes[0][1], deletes[0][2][0], [...deletes[0][2]].sort()], ['delete', 'thorin', 'backpack', ['backpack', 'bedroll', 'gem', 'pouch']])
assert.ok(!deletes[0][3]?.deleteContents, 'no deleteContents option: the contents are named')
assert.deepEqual([lineOf(made), made.result.removed], ['Removes 1 Backpack', { item: 'backpack', quantity: 1 }])
assert.ok(!made.line.content.includes('Bedroll') && !made.line.content.includes('Gem'), 'the container named alone')
assert.ok(['backpack', 'bedroll', 'pouch', 'gem'].every(id => !thorin.items.has(id)))
const after = made.after.find(e => e.type === 'character.updated').data.character.sheet.inventory
assert.ok(![...after.sections.flatMap(s => s.items), ...after.containers].some(item => ['backpack', 'bedroll', 'pouch', 'gem'].includes(item.id)), 'the sheet sent lists none of it')
// Part of a container's stack: its contents stay with the one left.
at = writes.length
made = await removed('quiver', 1, { held: 2 })
assert.deepEqual(writes.slice(at).filter(([what]) => what !== 'updateActor'), [['updateItem', 'quiver', { 'system.quantity': 1 }]])
assert.deepEqual([lineOf(made), holds(thorin).filter(([name]) => ['Quiver', 'Bolt Case'].includes(name))], ['Removes 1 Quiver', [['Quiver', 1, null], ['Bolt Case', 1, 'quiver']]])
// A container that hides what it holds, whole: it and what it hides, in one call, named alone.
from = app.events.length
at = writes.length
made = await removed('chest', 1)
assert.deepEqual(writes.slice(at).filter(([what]) => what === 'delete').map(([, , list]) => [...list].sort()), [['chest', 'letter']])
assert.equal(lineOf(made), 'Removes 1 Sealed Chest')
assert.ok(!JSON.stringify(app.events.slice(from)).includes('Letter') && !made.line.content.includes('Letter'), 'no "Letter" in any post or the line')
okay("the Gem alone, in the Pouch, deletes it alone, the Pouch kept; the Backpack, whole, deletes it, its Bedroll, Pouch and Gem in one deleteEmbeddedDocuments, without dnd5e's deleteContents, \"Removes 1 Backpack\", the sheet sent listing none of them; 1 of 2 Quivers lowers the stack, its Bolt Case kept; the Sealed Chest goes with the Letter it hides, in one call, \"Removes 1 Sealed Chest\", the Letter named nowhere")

/* -------------------------------------------- */
/*  Names, and what's worn                      */
/* -------------------------------------------- */

from = app.events.length
made = await removed('vial', 1)
assert.equal(lineOf(made), 'Removes 1 Strange Vial')
assert.ok(!JSON.stringify(app.events.slice(from)).includes('Giant') && !made.line.content.includes('Giant'), "the vial's secret in no post")
made = await removed('arrows', 0, { held: 0 })
assert.deepEqual([made.result.status, made.result.removed, lineOf(made), thorin.items.has('arrows')], ['done', { item: 'arrows', quantity: 0 }, 'Removes 0 Arrows', false])
made = await removed('ring', 1)
assert.deepEqual([made.result.status, lineOf(made), thorin.items.has('ring')], ['done', 'Removes 1 Ring of Protection', false], 'equipped and attuned: removed')
made = await removed('pickaxe', 1)
assert.equal(lineOf(made), 'Removes 1 Pick &lt;b&gt;Axe&lt;/b&gt;')
okay('an unidentified potion by the name its players see, "Removes 1 Strange Vial", its own nowhere; a stack of no Arrows deleted, "Removes 0 Arrows"; an equipped, attuned Ring of Protection removed; a name escaped, "Removes 1 Pick &lt;b&gt;Axe&lt;/b&gt;"')

/* -------------------------------------------- */
/*  The Gamemaster                              */
/* -------------------------------------------- */

const gm = removal('torch', 1, { by: 'gm' })
;[made] = await fetched(gm)
assert.equal(lineOf(made), 'Removes 1 Torch')
assert.deepEqual([made.line.author.id, made.line.speaker.actor, made.line.flags['sending-stone']], ['alice', 'thorin', { request: gm.id, by: 'gm' }])
assert.deepEqual(made.result.messages, [made.line.id])
assert.deepEqual(made.result.removed, { item: 'torch', quantity: 1 })
okay("the Gamemaster's removal posts as Thorin's player, flagged `by: \"gm\"` and listed in their result's messages")

/* -------------------------------------------- */
/*  Failures                                    */
/* -------------------------------------------- */

const refusing = test => { faults.refuse = test }
await restock()
lines = messages.size
refusing((what, target) => (what === 'update') && (target.id === 'potion'))
made = await removed('potion', 1)
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'An update was refused'])
assert.ok(!('removed' in made.result), 'nothing said to be removed')
assert.deepEqual([messages.size, sheetsIn(made), thorin.items.get('potion')._source.system.quantity], [lines, [], 3], 'no line; the sheet, as it was told, not sent')
refusing((what, target, entry) => (what === 'delete') && (entry?.id === 'rope'))
made = await removed('rope', 1)
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'Not every item was deleted'])
assert.ok(!('removed' in made.result))
assert.deepEqual([messages.size, sheetsIn(made), thorin.items.has('rope')], [lines, [], true], 'no line, the Rope kept')
// A module's hook keeps the Bedroll from going with the Backpack: what went is said; the Bedroll stays, at the top.
refusing((what, target, entry) => (what === 'delete') && (entry?.id === 'bedroll'))
made = await removed('backpack', 1)
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'Not every item was deleted'])
assert.deepEqual(made.result.removed, { item: 'backpack', quantity: 1 })
assert.equal(lineOf(made), 'Removes 1 Backpack')
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin']], 'the sheet sent')
assert.deepEqual([thorin.items.has('backpack'), thorin.items.has('bedroll'), thorin.items.has('pouch')], [false, true, false])
const top = made.after.find(e => e.type === 'character.updated').data.character.sheet.inventory.sections.flatMap(s => s.items)
assert.ok(top.some(item => item.id === 'bedroll'), 'the Bedroll at the top of the sheet sent')
// A module's hook keeps the Backpack itself, letting what it holds go. The Backpack is still there,
// so nothing is said to be removed and no line is posted; but a write was made, so the sheet, which
// no longer lists what went, goes ahead of the result all the same.
await restock()
lines = messages.size
refusing((what, target, entry) => (what === 'delete') && (entry?.id === 'backpack'))
made = await removed('backpack', 1)
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'Not every item was deleted'])
assert.ok(!('removed' in made.result), 'no removed: the Backpack kept')
assert.deepEqual([messages.size, made.line], [lines, null], 'no line')
assert.deepEqual(['backpack', 'bedroll', 'pouch', 'gem'].map(id => thorin.items.has(id)), [true, false, false, false])
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin']], 'the sheet ahead of the result')
const idsIn = list => list.flatMap(item => [item.id, ...idsIn(item.contents ?? [])])
const kept = made.after.find(e => e.type === 'character.updated').data.character.sheet.inventory
assert.deepEqual([kept.containers.find(item => item.id === 'backpack')?.contents, idsIn([...kept.sections.flatMap(s => s.items), ...kept.containers]).filter(id => ['bedroll', 'pouch', 'gem'].includes(id))],
  [[], []], 'the sheet sent lists the Backpack, empty, and nothing that went')
// What a container holds that can't be read is no write: nothing said, nor sent.
const pack = itemData('Satchel', 'container', {}, { id: 'satchel' })
stock(thorin, [...thorinStock(), pack])
await settle()
sendCharacter('thorin')
await settle()
const satchel = thorin.items.get('satchel')
satchel.system = { ...satchel.system, get allContainedItems() { throw new Error('No contents') } }
at = writes.length
lines = messages.size
made = await removed('satchel', 1)
assert.deepEqual(refusal(made), ['failed', 'error', 'No contents'])
assert.deepEqual([writes.length, messages.size, sheetsIn(made), 'removed' in made.result], [at, lines, [], false])
okay("a refused update of the Potion is `error` \"An update was refused\", with no `removed`, line or sheet; a refused delete of the Rope, \"Not every item was deleted\", no `removed` or line; the Backpack's Bedroll kept from deletion, \"Not every item was deleted\" with `removed`, \"Removes 1 Backpack\" and the sheet, the Bedroll at its top; the Backpack itself kept from deletion, its contents gone, \"Not every item was deleted\" with no `removed` or line, but the sheet ahead of the result; a container whose contents can't be read, its error, nothing written")

/* -------------------------------------------- */
/*  Off by the time it's made                   */
/* -------------------------------------------- */

// A removal is checked as it's made, not as it's fetched: one taken while another of Thorin's still
// writes, made after the system has changed or the Gamemaster has deleted the campaign, is `off`.
await restock()
for (const [change, undo, why] of [
  [() => { game.system.id = 'pf2e' }, () => { game.system.id = 'dnd5e' }, 'another system'],
  [() => settings.set('campaigns', []), () => campaignAs(), 'the campaign gone'],
]) {
  const ahead = hold(target => target.id === 'potion')
  const first = removal('potion', 1)
  handOver(first)
  await until(() => ahead.held, `the Potion's update (${why})`)
  const behind = removal('rope', 1)
  handOver(behind)
  // Taken once the fetch that handed it over is answered and the next fetch begins.
  await until(() => !app.waiting.get('camp-a')?.length, `the Rope's fetch (${why})`)
  const polls = app.polls.length
  await until(() => app.polls.length > polls, `the fetch after it (${why})`)
  change()
  ahead.release()
  await until(() => resultsOf(behind.id).length, `the Rope's result (${why})`)
  undo()
  assert.deepEqual([resultsOf(first.id)[0].status, refusal({ result: resultsOf(behind.id)[0] })], ['done', ['failed', 'off', null]], why)
  assert.deepEqual([thorin.items.has('rope'), [...messages.values()].some(line => line.flags?.['sending-stone']?.request === behind.id)], [true, false], `${why}: the Rope kept, no line`)
  announce({ campaignId: 'camp-a' })
  await settle()
}
okay("a removal taken while another of Thorin's still writes, made once the system isn't dnd5e or the campaign is gone, is `off`: the Rope kept, no line")

/* -------------------------------------------- */
/*  Queued with moves and rolls                 */
/* -------------------------------------------- */

// Moves turned on for the give: the Potions given to Vex, held at its first write, Vex's create.
await restock()
campaignAs({ transfers: true })
app.features = { commands: true, transfers: 1, removals: 1, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
let gift = move('thorin', { from: 'thorin', to: 'vex', items: [{ id: 'potion', quantity: 3 }] })
let held = hold(target => target === vex)
handOver(gift)
await until(() => held.held, "the give's first write")
at = writes.length
let taking = removal('potion', 3, { held: 3 })
handOver(taking)
await wait(100)
assert.deepEqual([writes.slice(at), resultsOf(taking.id).length], [[], 0], 'the removal waits')
held.release()
await until(() => resultsOf(gift.id).length && resultsOf(taking.id).length, 'both')
assert.deepEqual([resultsOf(gift.id)[0].status, resultsOf(taking.id)[0].reason], ['done', 'gone'])
assert.deepEqual([thorin.items.has('potion'), holds(vex).find(([name]) => name === 'Potion of Healing')], [false, ['Potion of Healing', 3, null]], 'given, never removed')
// The other order: a removal of 1 first, then the give of all 3, short.
await restock()
const [ahead, behind] = await fetched(removal('potion', 1, { held: 3 }), move('thorin', { from: 'thorin', to: 'vex', items: [{ id: 'potion', quantity: 3 }] }))
assert.deepEqual([ahead.result.status, refusal(behind)], ['done', ['failed', 'short', null]])
// A removal waits for Thorin's roll ahead of it: here his spend of a resource, keyed on him.
await restock()
campaignAs({ rolls: true, attacks: true, transfers: true })
thorin.system.resources = { primary: { label: 'Superiority Dice', max: 4, value: 4, sr: true } }
await settle()
const spending = hold((target, changes) => (target === thorin) && ('system.resources.primary.value' in (changes ?? {})))
const spend = { id: `spend-${++ids}`, actorId: 'thorin', kind: 'spend', counter: { resource: 'primary' }, count: 1, mode: 0, explicit: false, extras: [], dice: [] }
taking = removal('rope', 1)
handOver(spend, taking)
await until(() => spending.held, "Thorin's spend")
at = writes.length
await wait(100)
assert.deepEqual([writes.slice(at), resultsOf(taking.id).length], [[], 0], 'the removal waits for the spend')
spending.release()
await until(() => resultsOf(spend.id).length && resultsOf(taking.id).length, 'both')
assert.deepEqual([resultsOf(spend.id)[0].status, resultsOf(taking.id)[0].status], ['done', 'done'])
assert.ok(resultIndex(taking.id) > resultIndex(spend.id))
campaignAs({ transfers: true })
okay("a removal fetched while a give of the same Potions waits at its first write waits too, then is `gone`, the Potions on Vex alone; a removal of 1 ahead of a give of all 3 leaves the give `short`; a removal waits for Thorin's spend ahead of it: Thorin's queue, which the chain needn't keep")

/* -------------------------------------------- */
/*  The chain, past the watchdog                */
/* -------------------------------------------- */

// A give whose create hangs past the 60 s watchdog: told `timeout`, its queues let go; a removal
// fetched meanwhile waits for its writes all the same, then finds the Potions gone.
await restock()
let hung = hold(target => target === vex)
gift = move('thorin', { from: 'thorin', to: 'vex', items: [{ id: 'potion', quantity: 3 }] })
handOver(gift)
await until(() => hung.held, 'the hang')
taking = removal('potion', 3, { held: 3 })
handOver(taking)
await until(() => resultsOf(gift.id).length === 1, 'the watchdog', 2000)
assert.equal(resultsOf(gift.id)[0].reason, 'timeout')
at = writes.length
await wait(200)
assert.deepEqual([writes.slice(at), resultsOf(taking.id).length], [[], 0], 'the removal has not started its checks while the give still writes')
hung.release()
await until(() => (resultsOf(gift.id).length === 2) && (resultsOf(taking.id).length === 1), 'both results')
assert.deepEqual([resultsOf(gift.id)[1].status, resultsOf(taking.id)[0].reason], ['done', 'gone'])
assert.ok(resultIndex(taking.id) > lastResultIndex(gift.id), "after the give's late done")
assert.deepEqual([thorin.items.has('potion'), holds(vex).find(([name]) => name === 'Potion of Healing')], [false, ['Potion of Healing', 3, null]], 'the Potions on Vex alone')
// A removal whose delete hangs past the watchdog: a give fetched meanwhile waits, then is `gone`.
await restock()
const copies = copiedBy.length
hung = hold(target => target === thorin)
taking = removal('potion', 3, { held: 3 })
handOver(taking)
await until(() => hung.held, 'the hang')
gift = move('thorin', { from: 'thorin', to: 'vex', items: [{ id: 'potion', quantity: 3 }] })
handOver(gift)
await until(() => resultsOf(taking.id).length === 1, 'the watchdog', 2000)
assert.equal(resultsOf(taking.id)[0].reason, 'timeout')
at = writes.length
await wait(200)
assert.deepEqual([writes.slice(at), copiedBy.length, resultsOf(gift.id).length], [[], copies, 0], 'the give has not started its checks while the removal still writes')
hung.release()
await until(() => (resultsOf(taking.id).length === 2) && (resultsOf(gift.id).length === 1), 'both results')
assert.deepEqual([resultsOf(taking.id)[1].status, resultsOf(taking.id)[1].removed, resultsOf(gift.id)[0].reason], ['done', { item: 'potion', quantity: 3 }, 'gone'])
assert.ok(resultIndex(gift.id) > lastResultIndex(taking.id), "after the removal's late done")
assert.deepEqual([thorin.items.has('potion'), vex.items.has('potion'), holds(vex).some(([name]) => name === 'Potion of Healing')], [false, false, false], 'removed, never given')
campaignAs()
app.features = { commands: true, removals: 1, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
okay("past the watchdog, the moves' chain alone keeps a removal and a move of the same Potions apart: a removal fetched while a give hangs is made only after the give's late `done`, `gone`, the Potions on Vex alone; a give fetched while a removal's delete hangs, only after its late `done`, `gone`, the Potions removed and never given")

// ---- END ----
console.log(`removals${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
