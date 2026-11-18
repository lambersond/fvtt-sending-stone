// Coins added to a character and taken away (module 0.48.0): the rule of paying in coins
// (coin-change.mjs) on its own, by worked cases and many random ones, in whole numbers, at dnd5e's
// rates, at a world's own that don't divide one another or that floating point doesn't divide
// exactly, and with a coin worth the same as another; the hello's `features.coins` and each coin's
// rate in a sheet; fetching for coins alone; the `coins` command's check, who it's made for, what
// it writes, its line, its sheet and its result; what the campaign's setting off does, and its
// switch, for the Gamemaster's changes too; a coin with no rate; dnd5e 6's fraction of a coin;
// coins waiting in the line of moves, and for their own character's rolls; and the campaign read
// again as a change's turn comes. On a copy of sends.mjs's stand-ins, with dnd5e's rates: the real
// module and its language file, dnd5e 5.3.3's real dice classes for its self-test, a stand-in
// Foundry core and app; the actors' coins as stored and as prepared, 5.3.3's or with DND5E6=1
// 6.0.5's, whose coins may be fractional. Run with SLIM_CHECK=1 and --import ./unref-timers.mjs
// --import ./dnd5e-register.mjs.
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
  // dnd5e's coins, in its order, each with its abbreviation as the sheet shows it and its rate, how
  // many make one gp (config.mjs, `conversion`, the same in 5.3.3 and 6.0.5).
  currencies: Object.fromEntries(Object.entries({ pp: 0.1, gp: 1, ep: 2, sp: 10, cp: 100 })
    .map(([id, conversion]) => [id, { label: `DND5E.Currency${id.toUpperCase()}`, abbreviation: id, conversion }])),
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
  actor.deleteEmbeddedDocuments = async function (type, ids) {
    writes.push(['delete', this.id, [...ids]])
    await holding(this, ids)
    await turn()
    fault('failDelete', this, ids)
    // As Foundry's: one that isn't there refuses the whole call.
    const missing = ids.find(id => !this.items.has(id))
    if (missing) throw new Error(`Item ${missing} does not exist`)
    const gone = ids.map(id => this.items.get(id)).filter(item => !refused('delete', this, item))
    for (const item of gone) this.items.delete(item.id)
    for (const item of gone) await Hooks.callAll('deleteItem', item, {}, 'gm')
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
for (const [id, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['carol', 'Carol'], ['eve', 'Eve']]) user(id, name)

/** A character, as dnd5e's, with its items and coins. */
function character(id, name, owners, { items = [], coins = {}, npc = null } = {}) {
  const actor = new Actor5e({ id, name, owners, npc })
  equip(actor, { items: [] })
  actor.documentName = 'Actor'
  actor.coins = coins
  actors.set(id, embed(actor, items))
  return actor
}
/** A Group actor's members, as dnd5e 5.3.3 prepares them (data/actor/group.mjs:148-172). */
function membersOf(members) {
  const list = members.map(member => ({ actor: member }))
  Object.defineProperty(list, 'ids', { value: new Set(members.map(member => member.id)), enumerable: false })
  return list
}
/** A Group actor, with its items and coins. */
function group(id, name, { members = [], ownership = {}, items = [], coins = {} } = {}) {
  const g = {
    documentName: 'Actor', id, name, type: 'group', uuid: `Actor.${id}`, img: `${id}.webp`, flags: {},
    ownership: { default: 0, ...ownership },
    system: { members: membersOf(members), description: { full: '', summary: '' } },
    coins,
    getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
    testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
  }
  actors.set(id, embed(g, items))
  return g
}

let serial = 0
const nextId = prefix => `${prefix}${String(++serial).padStart(16 - prefix.length, '0')}`
const POTION = 'Compendium.dnd5e.items.Item.phb-potion'
/** An item's data as Foundry stores it. */
const itemData = (name, type, system = {}, { id, source, effects = [], ...fields } = {}) => ({
  _id: id ?? nextId(name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8) || 'item'),
  name, type, img: 'icons/item.webp', sort: 0, flags: {},
  _stats: source ? { compendiumSource: source } : {}, effects,
  system: { quantity: 1, identified: true, description: { value: '' }, weight: { value: 1, units: 'lb' }, ...system },
  ...fields,
})
const potion = (quantity, options = {}) => itemData('Potion of Healing', 'consumable',
  { quantity, uses: { max: 1, spent: 0, recovery: [] } }, { source: POTION, ...options })

// Thorin (Alice), Vex (Bob), Bram (Carol) and Lia, whom no player owns: the campaign's characters.
// Grumble, an NPC, is a member of the Company but none of the campaign's characters. Ash (Eve) is one
// of the campaign's characters but no member of any party, so that a distribution naming as many
// characters as the Company has, but not the same ones, can be told from one naming its own.
const thorin = character('thorin', 'Thorin', ['alice'], { coins: { gp: 40 } })
const vex = character('vex', 'Vex', ['bob'], { coins: { gp: 12 } })
const bram = character('bram', 'Bram', ['carol'])
const lia = character('lia', 'Lia', [])
const grumble = character('grumble', 'Grumble', [], { npc: { max: 2, spent: 0, denomination: 'd8' } })
const stranger = character('stranger', 'Stranger', ['eve'], { coins: { gp: 5 } })
const ash = character('ash', 'Ash', ['eve'])
// The Company's coins: dnd5e 6 keeps a fraction of a coin, its sheet showing it rounded down.
const COMPANY_GP = DND5E6 ? 103.5 : 103
const companyStock = () => [
  itemData('Rope', 'loot', { quantity: 2 }, { id: 'rope000000000001' }),
  potion(3, { id: 'potc000000000001' }),
  itemData('Backpack', 'container', {}, { id: 'pack000000000001' }),
  itemData('Bedroll', 'loot', { container: 'pack000000000001' }, { id: 'bedr000000000001' }),
]
const COMPANY_COINS = { pp: 4, gp: COMPANY_GP, sp: 8, cp: 3 }
const party = group('party', 'The Iron Company', {
  members: [thorin, vex, bram, lia, grumble], ownership: { alice: 3, bob: 2 },
  items: companyStock(), coins: COMPANY_COINS,
})
const wardens = group('wardens', 'Wardens of the Vale', {
  members: [thorin, vex], ownership: { alice: 3, bob: 3 }, items: [potion(1, { id: 'potw000000000001' })], coins: { gp: 10 },
})
const silent = group('silent', 'The Silent Order', { members: [vex], items: [], coins: { gp: 30 } })
Object.defineProperty(actors, 'party', { get: () => actors.get('party') ?? null, configurable: true })
users.get('alice').character = thorin
users.get('bob').character = vex
users.get('carol').character = bram

/* -------------------------------------------- */
/*  The app                                     */
/* -------------------------------------------- */

const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, transfers: 1, groups: 1, coins: 1 } }
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
const sent = async (...args) => (await fetched(move(...args)))[0]
const refusal = ({ result }) => [result.status, result.reason, result.error]
/** The sheets a move sent between its fetch and its result. */
const sheetsIn = ({ after }) => after.filter(e => ['group.updated', 'character.updated'].includes(e.type)).map(e => [e.type, (e.data.group ?? e.data.character).id])
const lineOf = made => made.line?.content?.replace(/^<p>|<\/p>$/g, '') ?? null

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
const CAMPAIGN = { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'bram', 'lia', 'ash'], groups: ['party', 'wardens', 'silent'], rolls: false, attacks: false, transfers: true }
const campaignAs = (change = {}) => settings.set('campaigns', [{ ...CAMPAIGN, ...change }])
campaignAs()
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
await until(() => app.events.some(e => e.type === 'bridge.hello'), 'the hello')
await wait(60)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
okay('the self-test still passes')

/** Give an actor these items, and these coins, in place of what it had. */
function stock(actor, items = [], coins = null) {
  actor.items.clear()
  for (const data of items) actor.items.set(data._id, new HarnessItem(data, actor))
  if (coins) {
    actor._source.system.currency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...coins }
    actor.prepareCurrency()
  }
}
/** Everyone as the world began. */
function restock() {
  stock(party, companyStock(), COMPANY_COINS)
  stock(wardens, [potion(1, { id: 'potw000000000001' })], { gp: 10 })
  stock(silent, [], { gp: 30 })
  stock(thorin, [], { gp: 40 })
  stock(vex, [], { gp: 12 })
  stock(bram, [], {})
  stock(lia, [], {})
  stock(ash, [], {})
  party.system.members = membersOf([thorin, vex, bram, lia, grumble])
}
const holds = actor => actor.items.map(item => [item.name, item._source.system.quantity, item._source.system.container ?? null])
const coinsOf = actor => ({ ...actor._source.system.currency })
const settle = () => wait(320)
const helloOf = () => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).at(-1)
const { coinFeatures, coinReader } = await import(`${MODULE}/scripts/command-coins.mjs`)
const { coinRates, coinUpdate, heldCoins, NEVER_CHANGE, payCoins } = await import(`${MODULE}/scripts/coin-change.mjs`)
const FEATURES = { ...app.features }
/** The campaign's hello sent afresh, as a change to its settings sends it, and answered. */
async function hello() {
  const hellos = () => app.events.filter(e => e.type === 'bridge.hello').length
  const before = hellos()
  announce()
  await until(() => hellos() > before, 'the hello')
  await wait(60)
}
/** Coins added or taken away, as the app hands the command over. */
const change = (actorId, op, currency, fields = {}) => ({
  id: `coins-${++ids}`, actorId, kind: 'coins', coins: { op, currency }, mode: 0, explicit: false, extras: [], dice: [], ...fields,
})
const changed = async (...args) => (await fetched(change(...args)))[0]
/** The coins an actor stores, those it has any of. */
const purse = actor => Object.fromEntries(Object.entries(coinsOf(actor)).filter(([, n]) => n))
const COINS = ['pp', 'gp', 'ep', 'sp', 'cp']
const say = coins => COINS.filter(key => coins[key]).map(key => `${coins[key].toLocaleString('en')} ${key}`)
const listed = parts => new Intl.ListFormat('en', { type: 'conjunction' }).format(parts)

/* -------------------------------------------- */
/*  The rule                                    */
/* -------------------------------------------- */

const rates = coinRates()
assert.deepEqual(rates, [{ key: 'pp', conversion: 0.1 }, { key: 'gp', conversion: 1 }, { key: 'ep', conversion: 2 }, { key: 'sp', conversion: 10 }, { key: 'cp', conversion: 100 }])
assert.deepEqual(NEVER_CHANGE, ['ep'])
okay("dnd5e's coins with a rate, the largest first; change never comes back in electrum, unless electrum is the coin paid")

// Each row: what's held, what's taken away, what's left and which of the coins held went beyond those
// asked for; null where it's refused. The dagger rows are those smaller coins pay. The two rows of
// electrum paid beside another coin are the ones that tell the order of paying: paid the smallest
// first, the first would leave 8 gp, 1 ep and 9 sp, and the second would use 3 gp.
const TABLE = [
  [{ pp: 2, gp: 3 }, { gp: 5 }, { pp: 1, gp: 8 }, { pp: 1 }],
  [{ gp: 12 }, { sp: 5 }, { gp: 11, sp: 5 }, { gp: 1 }],
  [{ gp: 12 }, { cp: 3 }, { gp: 11, sp: 9, cp: 7 }, { gp: 1 }],
  [{ pp: 1 }, { cp: 1 }, { gp: 9, sp: 9, cp: 9 }, { pp: 1 }],
  [{ gp: 1, ep: 1 }, { sp: 7 }, { sp: 8 }, { gp: 1, ep: 1 }],
  [{ ep: 3 }, { sp: 7 }, { ep: 1, sp: 3 }, { ep: 2 }],
  [{ gp: 1 }, { ep: 1 }, { ep: 1 }, { gp: 1 }],
  [{ pp: 1, gp: 1 }, { gp: 1, sp: 1 }, { gp: 9, sp: 9 }, { pp: 1 }],
  [{ pp: 1 }, { gp: 1, sp: 1 }, { gp: 8, sp: 9 }, { pp: 1 }],
  [{ pp: 3, gp: 4, cp: 2 }, { gp: 4, sp: 3, cp: 5 }, { pp: 2, gp: 9, sp: 6, cp: 7 }, { pp: 1 }],
  [{ pp: 1 }, { ep: 1, sp: 1 }, { gp: 9, sp: 4 }, { pp: 1 }],
  [{ pp: 8, gp: 3, ep: 1, cp: 7 }, { ep: 3, sp: 7, cp: 5 }, { pp: 8, gp: 1, sp: 3, cp: 2 }, { gp: 2 }],
  [{ pp: 700, gp: 20 }, { pp: 600, gp: 150 }, { pp: 87 }, { pp: 13 }],
  [{ pp: 2, gp: 3, sp: 500 }, { gp: 5 }, { pp: 1, gp: 8, sp: 500 }, { pp: 1 }],
  [{ gp: 2, sp: 40 }, { gp: 5 }, { sp: 10 }, { sp: 30 }],
  [{ sp: 20 }, { gp: 1 }, { sp: 10 }, { sp: 10 }],
  [{ pp: 1, gp: 2, sp: 400 }, { gp: 20 }, { sp: 320 }, { pp: 1, sp: 80 }],
  [{ ep: 1, sp: 6 }, { gp: 1 }, { sp: 1 }, { ep: 1, sp: 5 }],
  [{ gp: 10000 }, { pp: 600 }, { gp: 4000 }, { gp: 6000 }],
  [{ pp: 2, gp: 3 }, { gp: 25 }, null],
  [{ sp: 9, cp: 5 }, { gp: 1 }, null],
  [{ gp: 1, sp: 14 }, { gp: 1, sp: 15 }, null],
]
const whole = coins => Object.fromEntries(COINS.map(key => [key, coins[key] ?? 0]))
const some = coins => Object.fromEntries(Object.entries(coins).filter(([, n]) => n))
for (const [held, pay, left, used] of TABLE) {
  const before = whole(held)
  const out = payCoins(before, pay, rates)
  assert.deepEqual(before, whole(held), `what's held isn't changed: ${say(held)} less ${say(pay)}`)
  if (!left) assert.deepEqual(out, { refusal: 'short' }, `${say(held)} less ${say(pay)}`)
  else assert.deepEqual([some(out.left), out.used], [left, used], `${say(held)} less ${say(pay)}`)
  // Where other coins may not pay, each of these is refused: none is paid from its own coins alone.
  assert.deepEqual(payCoins(whole(held), pay, rates, { change: false }), { refusal: 'short' }, `${say(held)} less ${say(pay)}, other coins not paying`)
}
assert.deepEqual(payCoins(whole({ gp: 12, sp: 3 }), { gp: 5, sp: 3 }, rates, { change: false }), { left: whole({ gp: 7 }), used: {} })
assert.deepEqual(payCoins(whole({ gp: 12 }), { gp: 5 }, rates), { left: whole({ gp: 7 }), used: {} })
// The largest coin paid first, however the coins are named: the rule sorts them itself.
const backwards = coins => Object.fromEntries(Object.entries(coins).reverse())
assert.deepEqual(Object.keys(backwards({ ep: 1, sp: 1 })), ['sp', 'ep'])
for (const [held, pay, left, used] of TABLE) {
  const out = payCoins(whole(held), backwards(pay), rates)
  assert.deepEqual(left ? [some(out.left), out.used] : out, left ? [left, used] : { refusal: 'short' }, `${say(held)} less ${say(pay)}, named the smallest first`)
}
okay(`the rule, by ${TABLE.length} worked cases: the coins asked for paid from the largest to the smallest, however they are named, 1 pp less 1 ep and 1 sp leaving 9 gp and 4 sp; a coin paid from its own first; then the nearest larger coin broken, as few as cover it, the change back in the fewest coins and never in electrum unless electrum is paid; then smaller coins, the largest first; refused only where all the coins are worth too little; \`used\` only what was held; and with other coins not paying, every one of them refused, an exact payment made`)

// Many random cases, the same each run: no worth is made or lost, no coin goes below none or to a
// fraction, nothing is counted as used that wasn't held, and a payment is refused exactly where the
// coins together are worth too little.
{
  let seed = 0x5eed
  const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const below = max => Math.floor(random() * max)
  const CP = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 }
  const worth = coins => COINS.reduce((sum, key) => sum + ((coins[key] ?? 0) * CP[key]), 0)
  let paid = 0
  let refused = 0
  let exact = 0
  const CASES = 200_000
  for (let i = 0; i < CASES; i++) {
    const most = below(4) ? 6 : 200
    const held = Object.fromEntries(COINS.map(key => [key, below(4) ? below(most) : 0]))
    const pay = Object.fromEntries(COINS.map(key => [key, below(3) ? 0 : 1 + below(below(5) ? 30 : 600)]).filter(([, n]) => n))
    if (!Object.keys(pay).length) continue
    const before = { ...held }
    const out = payCoins(held, pay, rates)
    const why = () => JSON.stringify([before, pay, out])
    assert.deepEqual(held, before, `what's held is changed: ${why()}`)
    assert.deepEqual(payCoins(held, backwards(pay), rates), out, `paid another way where the coins are named the smallest first: ${why()}`)
    assert.equal(!out.refusal, worth(held) >= worth(pay), `refused, or not, against what the coins are worth: ${why()}`)
    const strict = payCoins(held, pay, rates, { change: false })
    const covered = Object.entries(pay).every(([key, n]) => n <= held[key])
    assert.equal(!strict.refusal, covered, `other coins not paying: ${why()}`)
    if (covered) {
      exact++
      assert.deepEqual(strict, { left: Object.fromEntries(COINS.map(key => [key, held[key] - (pay[key] ?? 0)])), used: {} }, `an exact payment: ${why()}`)
      assert.deepEqual(out, strict, `an exact payment is made the same either way: ${why()}`)
    }
    if (out.refusal) { refused++; continue }
    paid++
    assert.equal(worth(out.left) + worth(pay), worth(held), `worth made or lost: ${why()}`)
    assert.ok(COINS.every(key => Number.isInteger(out.left[key]) && (out.left[key] >= 0)), `a coin below none, or no whole number: ${why()}`)
    assert.deepEqual(Object.keys(out.left), COINS, `a coin that isn't one: ${why()}`)
    for (const key of COINS) {
      const beyond = held[key] - out.left[key] - (pay[key] ?? 0)
      assert.equal(out.used[key] ?? 0, Math.max(beyond, 0), `used isn't what was held, less what's left, less what was paid: ${why()}`)
      assert.ok((out.used[key] ?? 0) <= held[key], `more used than held: ${why()}`)
    }
  }
  assert.ok((paid > 20_000) && (refused > 20_000) && (exact > 1_000), `enough of each: ${paid} paid, ${refused} refused, ${exact} exact`)
  okay(`the rule, by ${CASES.toLocaleString('en')} random cases, the same each run (${paid.toLocaleString('en')} paid, ${refused.toLocaleString('en')} refused, ${exact.toLocaleString('en')} exact): no worth made or lost, never a coin below none or a fraction, nothing counted as used that wasn't held, refused exactly where the coins are worth too little, paid the same however the coins are named, and with other coins not paying exactly where one coin is short`)
}

// A world's own rates that don't divide one another: coins of 1, 4 and 6 to the gp. Every sum is made
// in whole coins, so a coin pays for another only where it's worth a whole number of it, and a
// payment the coins are worth can be refused; worth is still never made or lost, nor a coin taken
// below none. The same cases each run.
{
  const own = [{ key: 'gp', conversion: 1 }, { key: 'shard', conversion: 4 }, { key: 'bit', conversion: 6 }]
  const KEYS = own.map(rate => rate.key)
  // Worth in twelfths of a gp, which both smaller coins are a whole number of.
  const TWELFTHS = { gp: 12, shard: 3, bit: 2 }
  const worth = coins => KEYS.reduce((sum, key) => sum + ((coins[key] ?? 0) * TWELFTHS[key]), 0)
  assert.deepEqual(payCoins({ gp: 1, shard: 26, bit: 0 }, { gp: 3 }, own), { refusal: 'short' }, '3 gp from 1 gp and 26 shards, worth 7.5 gp: a shard is no whole number of bits')
  assert.deepEqual(payCoins({ gp: 1, shard: 0, bit: 26 }, { gp: 3 }, own), { left: { gp: 0, shard: 0, bit: 14 }, used: { bit: 12 } }, 'bits pay: 6 make a gp')
  assert.deepEqual(payCoins({ gp: 2, shard: 0, bit: 0 }, { shard: 3 }, own), { left: { gp: 1, shard: 1, bit: 0 }, used: { gp: 1 } }, 'a gp is broken for shards, 4 to it')
  assert.deepEqual(payCoins({ gp: 0, shard: 5, bit: 0 }, { bit: 3 }, own), { refusal: 'short' }, 'a shard is never broken for bits: it is worth one and a half')
  let seed = 0xd1ce
  const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const below = max => Math.floor(random() * max)
  const CASES = 50_000
  let paid = 0
  let worthIt = 0
  for (let i = 0; i < CASES; i++) {
    const held = Object.fromEntries(KEYS.map(key => [key, below(3) ? below(40) : 0]))
    const pay = Object.fromEntries(KEYS.map(key => [key, below(2) ? 0 : 1 + below(30)]).filter(([, n]) => n))
    if (!Object.keys(pay).length) continue
    const before = { ...held }
    const out = payCoins(held, pay, own)
    const why = () => JSON.stringify([before, pay, out])
    assert.deepEqual(held, before, `what's held is changed: ${why()}`)
    if (out.refusal) { if (worth(held) >= worth(pay)) worthIt++; continue }
    paid++
    assert.equal(worth(out.left) + worth(pay), worth(held), `worth made or lost: ${why()}`)
    assert.ok(KEYS.every(key => Number.isInteger(out.left[key]) && (out.left[key] >= 0)), `a coin below none, or no whole number: ${why()}`)
    for (const key of KEYS) assert.ok((out.used[key] ?? 0) <= held[key], `more used than held: ${why()}`)
  }
  assert.ok((paid > 5_000) && (worthIt > 500), `enough of each: ${paid} paid, ${worthIt} refused though the coins were worth it`)
  okay(`with a world's own rates that don't divide one another (coins of 1, 4 and 6 to the gp), every sum is still made in whole coins: 3 gp from 1 gp and 26 of the coin of 4, worth 7.5 gp, is \`short\`, where 26 of the coin of 6 pay; and by ${CASES.toLocaleString('en')} random cases, the same each run (${paid.toLocaleString('en')} paid, ${worthIt.toLocaleString('en')} refused though the coins were worth it), no worth is made or lost and no coin goes below none`)
}

// A world's own rates that floating point doesn't divide exactly: coins of 0.1 and 0.3 to the gp, a
// noble worth three marks, though 0.3 ÷ 0.1 is 2.9999999999999996. A noble is still broken for
// marks, and marks still pay for a noble.
{
  const own = [{ key: 'noble', conversion: 0.1 }, { key: 'mark', conversion: 0.3 }]
  assert.equal(0.3 / 0.1, 2.9999999999999996, 'what floating point alone makes of it')
  assert.deepEqual(payCoins({ noble: 1, mark: 0 }, { mark: 2 }, own), { left: { noble: 0, mark: 1 }, used: { noble: 1 } }, 'a noble broken for 2 marks, 1 back as change')
  assert.deepEqual(payCoins({ noble: 0, mark: 4 }, { noble: 1 }, own), { left: { noble: 0, mark: 1 }, used: { mark: 3 } }, '3 marks pay for a noble')
  okay("with a world's own rates that floating point doesn't divide exactly, coins of 0.1 and 0.3 to the gp, where 0.3 ÷ 0.1 is 2.9999999999999996, the one is still worth a whole 3 of the other: one broken for 2 of the smaller gives 1 back as change, and 3 of the smaller pay for one")
}

// A world's own coin worth the same as another: a crown, 1 to the gp, listed after gp or before it.
// Neither larger nor smaller, it pays for gold as a smaller coin does, one for one, and gold for it,
// once no larger coin is left; the last of the change is in the coin paid, never in its like.
// Wherever else the two could both go, the one the world lists first does: paid first, broken first,
// given as change first and paying first, so what's left never turns on the order the coins are
// named in. And wherever each coin is worth a whole number of every coin worth less, two of the same
// worth among them, a payment is refused exactly where the coins together are worth too little: with
// the crown, whichever of the two the world lists first, and at rates wholly a world's own, coins of
// 0.01, 0.05, 1, 3, 12, 12 and 60 to the gp. The same cases each run.
{
  const dnd5es = CONFIG.DND5E.currencies
  const CROWNS = { pp: 0.1, gp: 1, crown: 1, ep: 2, sp: 10, cp: 100 }
  const WORLDS = [
    [['pp', 'gp', 'crown', 'ep', 'sp', 'cp'], CROWNS, 'crown listed after gp'],
    [['pp', 'crown', 'gp', 'ep', 'sp', 'cp'], CROWNS, 'crown listed before gp'],
    [['mithril', 'star', 'gp', 'third', 'groat', 'penny', 'mite'], { mithril: 0.01, star: 0.05, gp: 1, third: 3, groat: 12, penny: 12, mite: 60 }, "a world's own rates"],
  ]
  let cases = 0
  let paid = 0
  let refused = 0
  let alike = 0
  let both = 0
  for (const [KEYS, RATE, why] of WORLDS) {
    CONFIG.DND5E.currencies = Object.fromEntries(KEYS.map(key => [key, { label: key, abbreviation: key, conversion: RATE[key] }]))
    const own = coinRates()
    assert.deepEqual(own.map(rate => rate.key), KEYS, 'as the world lists them, the largest first')
    // Each coin's worth in the smallest, a whole number, and a whole number of every coin worth less.
    const smallest = Math.max(...Object.values(RATE))
    const UNITS = Object.fromEntries(KEYS.map(key => [key, Math.round(smallest / RATE[key])]))
    assert.ok(KEYS.every(a => KEYS.every(b => (UNITS[a] < UNITS[b]) || Number.isInteger(UNITS[a] / UNITS[b]))), `${why}: each a whole number of every coin worth less`)
    const all = coins => Object.fromEntries(KEYS.map(key => [key, coins[key] ?? 0]))
    const worth = coins => KEYS.reduce((sum, key) => sum + ((coins[key] ?? 0) * UNITS[key]), 0)
    if (RATE === CROWNS) {
      const pays = (held, pay, options) => { const out = payCoins(all(held), pay, own, options); return out.refusal ? out.refusal : [some(out.left), out.used] }
      assert.deepEqual(pays({ crown: 5 }, { gp: 1 }), [{ crown: 4 }, { crown: 1 }], `a crown pays for a gp: ${why}`)
      assert.deepEqual(pays({ gp: 5 }, { crown: 2 }), [{ gp: 3 }, { gp: 2 }], `and gp for crowns: ${why}`)
      assert.deepEqual(pays({ pp: 1 }, { gp: 5 }), [{ gp: 5 }, { pp: 1 }], `change in the coin paid, never in crowns: ${why}`)
      assert.deepEqual(pays({ pp: 1 }, { crown: 5 }), [{ crown: 5 }, { pp: 1 }], `nor in gp where crowns are paid: ${why}`)
      assert.deepEqual(pays({ pp: 1, crown: 3 }, { gp: 5 }), [{ gp: 5, crown: 3 }, { pp: 1 }], `a larger coin is broken first: ${why}`)
      assert.deepEqual(pays({ crown: 3, sp: 50 }, { gp: 2 }), [{ crown: 1, sp: 50 }, { crown: 2 }], `crowns before smaller coins: ${why}`)
      assert.deepEqual(pays({ crown: 3, sp: 25 }, { gp: 5 }), [{ sp: 5 }, { crown: 3, sp: 20 }], `then the smaller ones: ${why}`)
      // Wherever else the two could both go, the one the world lists first does.
      const [first, second] = KEYS.filter(key => RATE[key] === RATE.gp)
      assert.deepEqual([first, second].sort(), ['crown', 'gp'])
      assert.deepEqual(pays({ pp: 1 }, { gp: 1, crown: 1 }), [{ [first]: 8 }, { pp: 1 }], `both paid from one platinum, the first listed first, its change then paying for the other: ${why}`)
      assert.deepEqual(pays({ pp: 1 }, { crown: 1, gp: 1 }), [{ [first]: 8 }, { pp: 1 }], `and so however the two are named: ${why}`)
      assert.deepEqual(pays({ gp: 1, crown: 1 }, { sp: 1 }), [{ [second]: 1, sp: 9 }, { [first]: 1 }], `the first listed is broken first: ${why}`)
      assert.deepEqual(pays({ pp: 1 }, { sp: 1 }), [{ [first]: 9, sp: 9 }, { pp: 1 }], `change above the coin paid comes in the first listed: ${why}`)
      assert.deepEqual(pays({ gp: 6, crown: 6 }, { pp: 1 }), [{ [second]: 2 }, { [first]: 6, [second]: 4 }], `and the first listed pays first for a larger coin: ${why}`)
      assert.deepEqual(pays({ crown: 1, sp: 9 }, { gp: 2 }), 'short', `worth 1.9 gp: ${why}`)
      assert.deepEqual(pays({ crown: 5 }, { gp: 1 }, { change: false }), 'short', `other coins not paying: ${why}`)
    }
    let seed = 0xc0195 + WORLDS.findIndex(world => world[0] === KEYS)
    const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const below = max => Math.floor(random() * max)
    for (let i = 0; i < 50_000; i++) {
      const held = Object.fromEntries(KEYS.map(key => [key, below(3) ? below(below(4) ? 6 : 200) : 0]))
      const pay = Object.fromEntries(KEYS.map(key => [key, below(3) ? 0 : 1 + below(below(5) ? 30 : 600)]).filter(([, n]) => n))
      if (!Object.keys(pay).length) continue
      cases++
      const before = { ...held }
      const out = payCoins(held, pay, own)
      const said = () => `${why}: ${JSON.stringify([before, pay, out])}`
      assert.deepEqual(held, before, `what's held is changed, ${said()}`)
      assert.deepEqual(payCoins(held, backwards(pay), own), out, `paid another way where the coins are named the other way round, ${said()}`)
      if ((new Set(Object.keys(pay).map(key => RATE[key])).size < Object.keys(pay).length) && !out.refusal) both++
      assert.equal(!out.refusal, worth(held) >= worth(pay), `refused, or not, against what the coins are worth, ${said()}`)
      if (out.refusal) { refused++; continue }
      paid++
      assert.equal(worth(out.left) + worth(pay), worth(held), `worth made or lost, ${said()}`)
      assert.ok(KEYS.every(key => Number.isInteger(out.left[key]) && (out.left[key] >= 0)), `a coin below none, or no whole number, ${said()}`)
      for (const key of KEYS) assert.equal(out.used[key] ?? 0, Math.max(held[key] - out.left[key] - (pay[key] ?? 0), 0), `used isn't what was held, less what's left, less what was paid, ${said()}`)
      // One coin paid alone: no other coin worth the same comes back as change.
      const [only, more] = Object.keys(pay)
      const likes = more ? [] : KEYS.filter(key => (key !== only) && (RATE[key] === RATE[only]))
      if (likes.length) alike++
      for (const like of likes) assert.ok(out.left[like] <= held[like], `change in a coin worth the same as the one paid, ${said()}`)
    }
  }
  CONFIG.DND5E.currencies = dnd5es
  assert.deepEqual(coinRates(), rates, "dnd5e's own again")
  assert.ok((paid > 30_000) && (refused > 30_000) && (alike > 2_000) && (both > 2_000), `enough of each: ${paid} paid, ${refused} refused, ${alike} of one of two alike alone, ${both} of two alike together`)
  okay(`a world's own coin worth the same as another, a crown of 1 to the gp, listed after gp or before it: crowns pay for gold one for one and gold for crowns, once no larger coin is left and ahead of smaller ones; the last of the change is in the coin paid, never in its like; wherever else the two could both go, the one the world lists first is paid first, broken first, given as change first and pays first; and by ${cases.toLocaleString('en')} random cases, the same each run (${paid.toLocaleString('en')} paid, ${refused.toLocaleString('en')} refused), with the crown and at rates wholly a world's own that divide one another, two of them the same, a payment is refused exactly where the coins are worth too little, with no worth made or lost and no coin below none, and paid the same however the coins are named`)
}

/* -------------------------------------------- */
/*  The hello and the sheet                     */
/* -------------------------------------------- */

const ON = { enabled: true, kinds: ['coins'], reason: null, change: true }
const OFF = { enabled: false, kinds: [], reason: 'off', change: false }
assert.ok(!Object.hasOwn(settings.get('campaigns')[0], 'coins') && !Object.hasOwn(settings.get('campaigns')[0], 'coinChange'), 'a campaign saved before 0.48.0, with neither key')
assert.deepEqual(helloOf().data.features.coins, ON, 'on for a campaign saved without it')
assert.deepEqual(Object.keys(helloOf().data.features).slice(-2), ['hitPoints', 'coins'], 'last, after hitPoints')
const [campaign] = getCampaigns()
assert.deepEqual([campaign.coins, campaign.coinChange], [true, true], 'each read as on')
assert.deepEqual(coinFeatures({ ...campaign, coins: false }), OFF)
assert.deepEqual(coinFeatures({ ...campaign, coinChange: false }), { ...ON, change: false })
assert.deepEqual(coinFeatures({ ...campaign, coins: false, coinChange: true }), OFF, 'no change said while it is off')
game.system.id = 'pf2e'
assert.deepEqual(coinFeatures(campaign), { enabled: false, kinds: [], reason: 'system', change: false })
assert.deepEqual(coinFeatures({ ...campaign, coins: false }), OFF, '"off" before "system"')
game.system.id = 'dnd5e'
campaignAs({ coinChange: false })
await hello()
assert.deepEqual(helloOf().data.features.coins, { ...ON, change: false })
campaignAs({ coins: false })
await hello()
assert.deepEqual(helloOf().data.features.coins, OFF)
campaignAs({ rolls: true, attacks: true })
await hello()
assert.ok(!helloOf().data.features.rolls.kinds.includes('coins') && !helloOf().data.features.companions.kinds.includes('coins'), "never among the rolls' kinds, nor a companion's")
campaignAs()
await hello()
okay("the hello's features.coins, last, after hitPoints: on for a campaign saved without the switch, with `change` as its setting is; off with it off, \"off\" before \"system\", and `change` false then; \"system\" with it on under another system; never among the rolls' kinds, nor a companion's")

const sheetOf = id => app.events.filter(e => (e.type === 'character.updated') && (e.data.character.id === id)).at(-1)?.data.character.sheet
assert.deepEqual(sheetOf('thorin').inventory.currency.map(coin => [coin.id, coin.conversion]), [['pp', 0.1], ['gp', 1], ['ep', 2], ['sp', 10], ['cp', 100]])
okay("each coin's rate in a character's sheet, `conversion`, as dnd5e's configuration has it")

/* -------------------------------------------- */
/*  Fetching                                    */
/* -------------------------------------------- */

const polling = async () => { const before = app.polls.length; await wait(150); return app.polls.length > before + 1 }
campaignAs({ transfers: false })
await hello()
assert.equal(await polling(), true, 'fetched for, every other switch off, the answer saying coins: 1')
for (const [features, why] of [
  [{ coins: 1 }, 'without commands'], [{ commands: true, coins: 0 }, 'coins: 0'], [{ commands: true, coins: '1' }, 'coins: "1"'],
  [{ commands: true, coins: true }, 'coins: true'], [{ commands: true, transfers: 1 }, 'an answer without coins'],
]) {
  app.features = features
  await hello()
  assert.equal(await polling(), false, why)
}
assert.equal(coinReader('camp-a'), false, 'the reader dropped by an answer without coins')
app.features = FEATURES
await hello()
assert.equal(await polling(), true, 'fetched again')
campaignAs({ transfers: false, coins: false })
await hello()
assert.equal(await polling(), false, 'not with the switch off')
game.system.id = 'pf2e'
campaignAs({ transfers: false })
await hello()
assert.equal(await polling(), false, 'nor under another system')
game.system.id = 'dnd5e'
campaignAs()
await hello()
assert.equal(await polling(), true)
okay('fetched for coins alone, every other switch off, from an app whose answer says `"coins": 1` besides commands; never from one that says anything else of them, or nothing; nor with the switch off, nor under another system')

/* -------------------------------------------- */
/*  The command                                 */
/* -------------------------------------------- */

restock()
await settle()
let unchanged = writes.length
let lines = messages.size
const body = coins => ({ ...change('thorin', 'add', { gp: 5 }), coins })
for (const [command, error, why] of [
  [change('thorin', 'add', { gp: 5 }, { by: 'player' }), 'by', 'by anyone but the Gamemaster'],
  [change('thorin', 'add', { gp: 5 }, { of: 'thorin' }), 'of', "a companion's"],
  [change('thorin', 'add', { gp: 5 }, { of: 7 }), 'of', '`of` no id'],
  [body(undefined), 'coins', 'no coins'],
  [body(null), 'coins', 'coins null'],
  [body('add'), 'coins', 'a string'],
  [body([{ op: 'add', currency: { gp: 5 } }]), 'coins', 'an array'],
  [body({ op: 'add' }), 'coins', 'no currency'],
  [body({ currency: { gp: 5 } }), 'coins', 'no op'],
  [body({ op: 'set', currency: { gp: 5 } }), 'coins', 'an op neither add nor remove'],
  [body({ op: 'add', currency: { gp: 5 }, from: { gp: 40 } }), 'coins', 'a field of its own besides op and currency'],
  [change('thorin', 'add', { gp: 5 }, { target: 'vex' }), 'coins', "a roll's field beside it"],
  [change('thorin', 'add', { gp: 5 }, { key: 'prc' }), 'coins', "a roll's key beside it"],
  [change('thorin', 'add', { gp: 5 }, { transfer: { from: 'thorin', to: 'vex', currency: { gp: 5 } } }), 'coins', 'a move beside it'],
  [change('thorin', 'add', { gp: 5 }, { remove: { item: 'rope000000000001', quantity: 1, held: 1 } }), 'coins', 'a removal beside it'],
  [change('thorin', 'add', { gp: 5 }, { hitPoints: { op: 'set', value: 1, from: { value: 2 } } }), 'coins', 'hit points beside it'],
  [change('thorin', 'add', { gp: 5 }, { typed: true }), 'coins', 'typed'],
  [change('thorin', 'add', { gp: 5 }, { count: 0 }), 'coins', "another kind's field of 0"],
  [change('thorin', 'add', {}), 'currency', 'no coin'],
  [change('thorin', 'add', { zz: 5 }), 'currency', 'a coin dnd5e has not'],
  [change('thorin', 'add', { gp: 0 }), 'currency', 'none of a coin'],
  [change('thorin', 'add', { gp: -5 }), 'currency', 'fewer than none'],
  [change('thorin', 'add', { gp: 1.5 }), 'currency', 'a fraction of a coin'],
  [change('thorin', 'add', { gp: '5' }), 'currency', 'a count that is no number'],
  [change('thorin', 'add', { gp: 10_000_001 }), 'currency', 'more than 10,000,000 of a coin'],
  [change('thorin', 'add', [['gp', 5]]), 'currency', 'a list'],
  [change('thorin', 'add', { gp: 5 }, { dice: [{ faces: 20, results: [3] }] }), 'dice', 'dice'],
  [change('thorin', 'add', { gp: 5 }, { mode: 1 }), 'dice', 'advantage'],
  [change('thorin', 'add', { gp: 5 }, { extras: [{ faces: 4, count: 1, results: [2] }] }), 'dice', 'something added'],
  [change('thorin', 'add', { gp: 5 }, { plainRoll: { terms: [{ faces: 6, count: 1 }] } }), 'plainRoll', 'a plain roll beside it'],
  [change('thorin', 'add', { gp: 5 }, { effectDice: [{ faces: 4, sign: 1, results: [2] }] }), 'effectDice', "a typed roll's effect dice beside it"],
]) {
  assert.deepEqual(refusal((await fetched(command))[0]), ['failed', 'invalid', error], why)
}
// Every field of a roll's and of another kind's that the protocol names, each beside the coins.
const ROLLS_OWN = ['item', 'activity', 'target', 'targets', 'self', 'slot', 'enchant', 'prompt', 'text', 'link', 'key']
const OTHER_KINDS = [
  'transfer', 'remove', 'typed', 'rerolls', 'favorite', 'note', 'dish', 'effect', 'wildShape', 'spellSlot', 'counter',
  'count', 'inspiration', 'concentration', 'enchantment', 'prepare', 'turn', 'undo', 'hitPoints',
]
const beside = await fetched(...[...ROLLS_OWN, ...OTHER_KINDS].map(key => change('thorin', 'add', { gp: 5 }, { [key]: 1 })))
assert.deepEqual(beside.map(made => [Object.keys(made.command).find(key => made.command[key] === 1), ...refusal(made)]),
  [...ROLLS_OWN, ...OTHER_KINDS].map(key => [key, 'failed', 'invalid', 'coins']), "each of a roll's fields and of another kind's beside it")
assert.deepEqual([writes.length, messages.size, purse(thorin)], [unchanged, lines, { gp: 40 }], 'nothing written or posted')
okay('refused "invalid" with nothing written: "by" for anyone\'s but the Gamemaster\'s; "of", as no companion\'s coins are changed; "coins" for a body that isn\'t exactly { op: "add" | "remove", currency }, and for each of a roll\'s fields or another kind\'s beside it, every one the protocol names, hit points\' too; "currency" unless it\'s 1 or more of dnd5e\'s coins, each a whole number from 1 to 10,000,000; "dice", "plainRoll" and "effectDice" as every kind\'s')

/* -------------------------------------------- */
/*  Coins added                                 */
/* -------------------------------------------- */

restock()
await settle()
let at = writes.length
let made = await changed('thorin', 'add', { gp: 5 })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(purse(thorin), { gp: 45 })
assert.equal(lineOf(made), 'Thorin received 5 gp')
assert.deepEqual([made.line.speaker.actor, made.line.author.id, made.line.whisper, made.line.blind], ['thorin', 'alice', [], false])
assert.deepEqual(made.line.flags['sending-stone'], { request: made.command.id })
assert.deepEqual(writes.slice(at), [['updateActor', 'thorin', { 'system.currency.gp': 45 }]], 'one write, of the coin that changes alone')
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin']], 'the sheet ahead of the result')
assert.equal(made.after.find(e => e.type === 'character.updated').data.character.sheet.inventory.currency.find(coin => coin.id === 'gp').value, 45)
assert.deepEqual(made.result, {
  id: made.command.id, status: 'done', reason: null, error: null, messageId: made.line.id, visible: true, rolls: [],
  coins: { op: 'add', currency: { gp: 5 }, used: null },
})
okay('Thorin is given 5 gp: one write of his gold alone, 40 to 45; "Thorin received 5 gp", as Thorin, by Alice, for everyone; his sheet ahead of the result, which says `coins: { op: "add", currency: { gp: 5 }, used: null }`')

await settle()
at = writes.length
made = await changed('thorin', 'add', { sp: 3, pp: 2, gp: 1_000 })
assert.equal(lineOf(made), 'Thorin received 2 pp, 1,000 gp, and 3 sp')
assert.deepEqual(purse(thorin), { pp: 2, gp: 1045, sp: 3 })
assert.deepEqual(writes.slice(at), [['updateActor', 'thorin', { 'system.currency.pp': 2, 'system.currency.gp': 1045, 'system.currency.sp': 3 }]])
assert.deepEqual([Object.keys(made.result.coins.currency), made.result.coins], [['pp', 'gp', 'sp'], { op: 'add', currency: { pp: 2, gp: 1000, sp: 3 }, used: null }], "in dnd5e's order, however the app named them")
okay('several coins added at once, in one write: "Thorin received 2 pp, 1,000 gp, and 3 sp", in dnd5e\'s order, as the result names them')

/* -------------------------------------------- */
/*  Coins taken away                            */
/* -------------------------------------------- */

restock()
await settle()
at = writes.length
made = await changed('thorin', 'remove', { gp: 5 })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(lineOf(made), 'Thorin paid 5 gp')
assert.deepEqual([made.line.speaker.actor, made.line.author.id, made.line.whisper, made.line.flags['sending-stone']], ['thorin', 'alice', [], { request: made.command.id }])
assert.deepEqual(writes.slice(at), [['updateActor', 'thorin', { 'system.currency.gp': 35 }]])
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin']])
assert.deepEqual(made.result.coins, { op: 'remove', currency: { gp: 5 }, used: null })
assert.deepEqual([made.result.messageId, made.result.visible, made.result.rolls], [made.line.id, true, []])
okay('5 gp taken away from Thorin\'s 40: one write, 35 left; "Thorin paid 5 gp", as Thorin, by Alice, for everyone; `used` null, nothing else having gone')

// Every worked case through the command: one write, of exactly the coins that change; the line says
// what was asked, never what else went; the result says what did.
for (const [held, pay, left, used] of TABLE) {
  stock(thorin, [], held)
  at = writes.length
  lines = messages.size
  made = await changed('thorin', 'remove', pay)
  const why = `${say(held)} less ${say(pay)}`
  if (!left) {
    assert.deepEqual([refusal(made), writes.length, messages.size, purse(thorin), 'coins' in made.result], [['failed', 'short', null], at, lines, held, false], why)
    continue
  }
  assert.equal(made.result.status, 'done', `${why}: ${JSON.stringify(made.result)}`)
  assert.deepEqual(purse(thorin), left, why)
  assert.deepEqual(made.result.coins, { op: 'remove', currency: pay, used }, why)
  assert.equal(lineOf(made), `Thorin paid ${listed(say(pay))}`, why)
  const differ = COINS.filter(key => (held[key] ?? 0) !== (left[key] ?? 0))
  assert.deepEqual(writes.slice(at), [['updateActor', 'thorin', Object.fromEntries(differ.map(key => [`system.currency.${key}`, left[key] ?? 0]))]], `${why}: one write, of the coins that change`)
}
okay(`each of the ${TABLE.length} worked cases through the command: a larger coin broken and its change given back, smaller coins paying, in one write of exactly the coins that change; "Thorin paid …" says the coins asked for alone, and the result's \`used\` which of his others went; one worth more than all he holds is \`short\`, with nothing written or posted`)

/* -------------------------------------------- */
/*  The setting off                             */
/* -------------------------------------------- */

campaignAs({ coinChange: false })
await hello()
unchanged = writes.length
lines = messages.size
for (const [held, pay] of [[{ pp: 2, gp: 3 }, { gp: 5 }], [{ gp: 2, sp: 40 }, { gp: 5 }], [{ gp: 12 }, { sp: 5 }], [{ gp: 12, sp: 2 }, { gp: 12, sp: 3 }]]) {
  stock(thorin, [], held)
  made = await changed('thorin', 'remove', pay)
  assert.deepEqual([refusal(made), sheetsIn(made), purse(thorin)], [['failed', 'short', null], [], held], `${say(held)} less ${say(pay)}`)
}
stock(thorin, [], { pp: 2, gp: 3 })
made = await changed('thorin', 'remove', { gp: 5 }, { by: 'gm' })
assert.deepEqual([refusal(made), sheetsIn(made), purse(thorin)], [['failed', 'short', null], [], { pp: 2, gp: 3 }], "the Gamemaster's too")
assert.deepEqual([writes.length, messages.size], [unchanged, lines], 'nothing written or posted')
made = await changed('thorin', 'remove', { pp: 1, gp: 3 })
assert.deepEqual([made.result.status, purse(thorin), made.result.coins.used], ['done', { pp: 1 }, null], 'an exact payment is still made')
made = await changed('thorin', 'add', { cp: 4 })
assert.deepEqual([made.result.status, purse(thorin)], ['done', { pp: 1, cp: 4 }], 'and coins still added')
campaignAs()
await hello()
okay("with Pay with other coins off, more of a coin than the character holds is `short`, a larger coin never broken and smaller ones never paying, the Gamemaster's change too, nothing written or posted; an exact payment and an addition are made as before")

/* -------------------------------------------- */
/*  A coin with no rate                         */
/* -------------------------------------------- */

CONFIG.DND5E.currencies.zz = { label: 'Zed', abbreviation: 'zz' }
stock(thorin, [], { gp: 100, zz: 3 })
unchanged = writes.length
assert.deepEqual(refusal(await changed('thorin', 'remove', { zz: 5 })), ['failed', 'short', null], 'no other coin pays for it')
stock(thorin, [], { zz: 500 })
assert.deepEqual(refusal(await changed('thorin', 'remove', { gp: 1 })), ['failed', 'short', null], 'it pays for no other coin')
assert.equal(writes.length, unchanged, 'nothing written')
stock(thorin, [], { pp: 1, zz: 3 })
await settle()
made = await changed('thorin', 'remove', { zz: 2, sp: 1 })
assert.deepEqual([made.result.status, coinsOf(thorin), made.result.coins.used], ['done', { pp: 0, gp: 9, ep: 0, sp: 9, cp: 0, zz: 1 }, { pp: 1 }], 'paid from its own, and never given as change')
assert.equal(lineOf(made), 'Thorin paid 1 sp and 2 zz')
assert.deepEqual(made.after.find(e => e.type === 'character.updated').data.character.sheet.inventory.currency.at(-1), { id: 'zz', label: 'Zed', abbreviation: 'zz', value: 1, conversion: null })
delete CONFIG.DND5E.currencies.zz
okay("a world's own coin with no rate: taken away only from its own coins, no other paying for it; never paying for another, nor coming back as change; its `conversion` in the sheet null")

// And one worth the same as gold, a crown: it pays for gold he's short of, one for one.
CONFIG.DND5E.currencies.crown = { label: 'Crown', abbreviation: 'cr', conversion: 1 }
stock(thorin, [], { gp: 1, crown: 5 })
await settle()
at = writes.length
made = await changed('thorin', 'remove', { gp: 3 })
assert.deepEqual([made.result.status, purse(thorin), made.result.coins], ['done', { crown: 3 }, { op: 'remove', currency: { gp: 3 }, used: { crown: 2 } }], JSON.stringify(made.result))
assert.deepEqual([lineOf(made), writes.slice(at)], ['Thorin paid 3 gp', [['updateActor', 'thorin', { 'system.currency.gp': 0, 'system.currency.crown': 3 }]]])
assert.deepEqual(made.after.find(e => e.type === 'character.updated').data.character.sheet.inventory.currency.at(-1), { id: 'crown', label: 'Crown', abbreviation: 'cr', value: 3, conversion: 1 })
stock(thorin, [], { pp: 1 })
made = await changed('thorin', 'remove', { gp: 4 })
assert.deepEqual([made.result.status, purse(thorin), made.result.coins.used], ['done', { gp: 6 }, { pp: 1 }], 'the change in gold, the coin paid, none of it in crowns')
delete CONFIG.DND5E.currencies.crown
okay("a world's own coin worth the same as gold pays for gold the character is short of, one for one: 3 gp from 1 gp and 5 crowns leaves 3 crowns, `used: { crown: 2 }`, in one write of the two; and a platinum broken for gold gives its change in gold, none in crowns")

/* -------------------------------------------- */
/*  A fraction of a coin                        */
/* -------------------------------------------- */

// dnd5e 6 stores a fraction of a coin and shows the coin rounded down; under 5.3.3 a fraction shown is
// no whole coin either.
stock(thorin, [], { gp: 10.5 })
assert.deepEqual(heldCoins(thorin), { pp: 0, gp: 10, ep: 0, sp: 0, cp: 0 }, 'whole coins alone')
at = writes.length
made = await changed('thorin', 'remove', { gp: 10 })
assert.deepEqual([made.result.status, coinsOf(thorin).gp], ['done', 0.5], '10.5 gp less 10 leaves 0.5')
assert.deepEqual(writes.slice(at), [['updateActor', 'thorin', { 'system.currency.gp': 0.5 }]])
stock(thorin, [], { pp: 1, gp: 10.5 })
made = await changed('thorin', 'remove', { gp: 11 })
assert.deepEqual([made.result.status, purse(thorin), made.result.coins.used], ['done', { gp: 9.5 }, { pp: 1 }], '10.5 gp and 1 pp less 11 gp leaves 9.5 gp')
stock(thorin, [], { pp: 0.5, gp: 3 })
unchanged = writes.length
assert.deepEqual([refusal(await changed('thorin', 'remove', { gp: 5 })), writes.length, purse(thorin)], [['failed', 'short', null], unchanged, { pp: 0.5, gp: 3 }], 'half a platinum is never broken')
made = await changed('thorin', 'add', { pp: 2 })
assert.deepEqual([made.result.status, coinsOf(thorin).pp], ['done', 2.5], 'coins added to what is stored')
// A coin its sheet shows more of than it stores, as an effect may add to it: no more than is stored.
stock(thorin, [], { gp: 4.5 })
thorin.system.currency.gp = 9
assert.equal(heldCoins(thorin).gp, 4, 'what is stored, in whole coins')
assert.deepEqual(refusal(await changed('thorin', 'remove', { gp: 5 })), ['failed', 'short', null])
thorin.system.currency.gp = -3
assert.equal(heldCoins(thorin).gp, 0, 'never below none')
thorin.prepareCurrency()
okay(`a fraction of a coin${DND5E6 ? ', as dnd5e 6 stores one,' : ''} stays: 10.5 gp less 10 leaves 0.5, written from what is stored; 10.5 gp and 1 pp less 11 gp leaves 9.5 gp; half a platinum is never broken; a coin the sheet shows more of than is stored counts as what is stored, and never below none`)

// A fraction stays as it's written. Floating point alone makes 0.6999999999999993 of 10.7 less 10,
// which dnd5e 6 shows as 0.69 in a world that shows two decimals of a coin (its `roundCurrency`
// rounds down), and 7.5600000000000005 of 0.56 and 7: neither is what is stored.
assert.deepEqual([10.7 - 10, 0.56 + 7], [0.6999999999999993, 7.5600000000000005], 'what floating point alone makes of them')
stock(thorin, [], { gp: 10.7, sp: 0.56 })
at = writes.length
made = await changed('thorin', 'remove', { gp: 10 })
assert.deepEqual([made.result.status, writes.slice(at), coinsOf(thorin).gp], ['done', [['updateActor', 'thorin', { 'system.currency.gp': 0.7 }]], 0.7], '10.7 gp less 10 leaves 0.7')
made = await changed('thorin', 'add', { sp: 7 })
assert.deepEqual([made.result.status, coinsOf(thorin).sp], ['done', 7.56], '0.56 sp and 7 is 7.56')
stock(thorin, [], { pp: 1, gp: 20.3 })
made = await changed('thorin', 'remove', { gp: 25 })
assert.deepEqual([made.result.status, purse(thorin), made.result.coins.used], ['done', { gp: 5.3 }, { pp: 1 }], '20.3 gp and 1 pp less 25 gp leaves 5.3 gp')
stock(thorin, [], { gp: 9_999_999.7 })
made = await changed('thorin', 'remove', { gp: 9_999_999 })
assert.deepEqual([made.result.status, coinsOf(thorin).gp], ['done', 0.7], 'of nearly 10,000,000 too')
// By many random cases, the same each run: a count written with up to four decimals, changed by a
// whole number, is stored as exactly that decimal, and a whole count as exactly the sum.
{
  let seed = 0xc01
  const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const below = max => Math.floor(random() * max)
  const CASES = 200_000
  let noisy = 0
  let wholes = 0
  for (let i = 0; i < CASES; i++) {
    const digits = below(5)
    const whole = below(below(3) ? 200 : 20_000_000)
    const fraction = digits ? `.${String(below(10 ** digits)).padStart(digits, '0')}` : ''
    const stored = Number(`${whole}${fraction}`)
    const n = below(2) ? below(20_000_000) : -below(whole + 1)
    const want = Number(`${whole + n}${fraction}`)
    if (Number.isInteger(stored)) wholes++
    if ((stored + n) !== want) noisy++
    assert.equal(coinUpdate({ _source: { system: { currency: { gp: stored } } } }, { gp: n })['system.currency.gp'], want, `${stored} and ${n}`)
  }
  assert.ok((noisy > 10_000) && (wholes > 10_000), `enough of each: ${noisy} that floating point alone gets wrong, ${wholes} whole`)
  assert.deepEqual(coinUpdate({ _source: { system: { currency: {} } } }, { gp: 3 }), { 'system.currency.gp': 3 }, 'a coin with no key starts at none')
  okay(`a fraction stays as it is written: 10.7 gp less 10 leaves 0.7, never the 0.6999999999999993 of floating point alone, 0.56 sp and 7 is 7.56, 20.3 gp and 1 pp less 25 gp leaves 5.3 gp; and by ${CASES.toLocaleString('en')} random cases, the same each run, a count written with up to four decimals and changed by a whole number is stored as exactly that decimal (${noisy.toLocaleString('en')} of them wrong by floating point alone), a whole count as exactly the sum`)
}

/* -------------------------------------------- */
/*  The Gamemaster, and who it's made for       */
/* -------------------------------------------- */

restock()
await settle()
made = await changed('thorin', 'remove', { gp: 45 }, { by: 'gm' })
assert.deepEqual(refusal(made), ['failed', 'short', null], "the Gamemaster's is paid by the same rule")
made = await changed('vex', 'add', { gp: 8 }, { by: 'gm' })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(lineOf(made), 'Vex received 8 gp')
assert.deepEqual([made.line.speaker.actor, made.line.author.id, made.line.flags['sending-stone']], ['vex', 'bob', { request: made.command.id, by: 'gm' }])
assert.deepEqual([made.result.messages, coinsOf(vex).gp], [[made.line.id], 20])
made = await changed('vex', 'remove', { gp: 20 }, { by: 'gm' })
assert.deepEqual([lineOf(made), made.line.flags['sending-stone'].by, made.result.messages, coinsOf(vex).gp], ['Vex paid 20 gp', 'gm', [made.line.id], 0])
// Lia, whom no player owns: her line is the bridge's Gamemaster's.
made = await changed('lia', 'add', { sp: 3 })
assert.deepEqual([made.result.status, lineOf(made), made.line.speaker.actor, made.line.author.id, made.result.visible], ['done', 'Lia received 3 sp', 'lia', 'gm', true])
okay("the Gamemaster, at Vex's page, adds 8 gp and takes away 20: \"Vex received 8 gp\", \"Vex paid 20 gp\", as Vex, by Bob, flagged `by: \"gm\"` and listed in the result's messages; one worth more than the character holds is `short` for them too; a character no player owns is changed too, its line the Gamemaster's own")

// A form of Ash's, as dnd5e's transformInto makes one.
const form = character('ashform', 'Ash (Wolf)', ['eve'], { coins: { gp: 3 } })
form.flags.dnd5e = { isPolymorphed: true, originalActor: 'ash' }
stock(ash, [], { gp: 9 })
unchanged = writes.length
lines = messages.size
for (const [actorId, reason, why] of [
  ['party', 'unknown', "a party's coins"], ['stranger', 'unknown', 'an actor outside the campaign'], ['nobody', 'unknown', 'no such actor'],
  ['grumble', 'unknown', 'an NPC'], ['ash', 'shaped', 'a character transformed'], ['ashform', 'unknown', 'her form'],
]) {
  for (const op of ['add', 'remove']) {
    made = await changed(actorId, op, { gp: 1 })
    assert.deepEqual([refusal(made), sheetsIn(made)], [['failed', reason, null], []], `${why}, ${op}`)
  }
}
// The Company listed among the characters as well, as no Manage Campaigns lists it but a stored setting
// might: still no character's coins, as one of the campaign's groups.
campaignAs({ characters: [...CAMPAIGN.characters, 'party'] })
for (const op of ['add', 'remove']) {
  made = await changed('party', op, { gp: 1 })
  assert.deepEqual([refusal(made), sheetsIn(made)], [['failed', 'unknown', null], []], `the Company among the characters too, ${op}`)
}
campaignAs()
assert.deepEqual([writes.length, messages.size, coinsOf(ash).gp, coinsOf(form).gp, coinsOf(party).gp], [unchanged, lines, 9, 3, COMPANY_GP], 'nothing written or posted')
actors.delete('ashform')
campaignAs({ coins: false })
await hello()
made = await changed('thorin', 'add', { gp: 1 })
assert.deepEqual([refusal(made), writes.length], [['failed', 'off', null], unchanged], 'the switch off')
made = await fetched({ ...change('thorin', 'add', { gp: 1 }), coins: null })
assert.deepEqual(refusal(made[0]), ['failed', 'off', null], '"off" before "invalid"')
// The switch counts for the Gamemaster's own changes from the app too.
for (const op of ['add', 'remove']) {
  made = await changed('thorin', op, { gp: 1 }, { by: 'gm' })
  assert.deepEqual([refusal(made), sheetsIn(made), writes.length, messages.size, purse(thorin)], [['failed', 'off', null], [], unchanged, lines, { gp: 40 }], `the Gamemaster's ${op}, the switch off`)
}
// Under another system nothing is fetched for coins: one handed over by a fetch already on its way.
campaignAs()
await hello()
game.system.id = 'pf2e'
const elsewhere = await fetched(change('thorin', 'add', { gp: 1 }), change('thorin', 'add', { gp: 1 }, { by: 'gm' }))
assert.deepEqual([...elsewhere.map(refusal), writes.length, messages.size], [['failed', 'off', null], ['failed', 'off', null], unchanged, lines], "another system, the Gamemaster's too")
game.system.id = 'dnd5e'
await hello()
okay("refused, with nothing written, posted or sent: a party's coins, even one listed among the campaign's characters too, an actor outside the campaign, one that's none and an NPC, `unknown`; a character transformed, `shaped`, and her form `unknown`; and with the switch off, or under another system, `off`, before `invalid`, the Gamemaster's own changes too")

/* -------------------------------------------- */
/*  A write that fails                          */
/* -------------------------------------------- */

restock()
await settle()
lines = messages.size
faults.refuse = (what, target) => (what === 'update') && (target === thorin)
made = await changed('thorin', 'remove', { gp: 5 })
clearFaults()
assert.deepEqual([refusal(made), 'coins' in made.result, messages.size, sheetsIn(made), purse(thorin)], [['failed', 'error', 'An update was refused'], false, lines, [], { gp: 40 }])
faults.failUpdate = target => target === thorin
made = await changed('thorin', 'add', { gp: 5 })
clearFaults()
assert.deepEqual([refusal(made), 'coins' in made.result, messages.size, sheetsIn(made), purse(thorin)], [['failed', 'error', 'failUpdate of thorin refused'], false, lines, [], { gp: 40 }])
// A line that can't be posted is no failure of the change, which is made.
const silence = Hooks.on('preCreateChatMessage', () => false)
made = await changed('thorin', 'add', { gp: 5 })
Hooks.off('preCreateChatMessage', silence)
assert.deepEqual([made.result.status, made.result.messageId, made.result.visible, made.result.coins, purse(thorin)], ['done', null, true, { op: 'add', currency: { gp: 5 }, used: null }, { gp: 45 }])
// A line another module's hook hides from its own author, as a blind whisper to the Gamemaster: the
// change is made all the same, and the result says its player can't see the line.
const hiding = Hooks.on('preCreateChatMessage', message => { message.whisper = ['gm']; message.blind = true })
made = await changed('thorin', 'add', { gp: 5 })
Hooks.off('preCreateChatMessage', hiding)
assert.deepEqual([made.result.status, made.result.messageId, made.result.visible, made.line.whisper, purse(thorin)], ['done', made.line.id, false, ['gm'], { gp: 50 }])
okay("an update a module's hook refuses, or one that throws, is `error` with what went wrong: no line, no sheet, no `coins`, the coins as they were; a line that can't be posted leaves the change made, `messageId` null and `visible` true; and one another module's hook hides from its own author is the result's message still, `visible` false")

/* -------------------------------------------- */
/*  One at a time                               */
/* -------------------------------------------- */

// Coins stand in the line of moves: Thorin's change waits for a move between two others on its way, as
// a move does, whoever made it.
restock()
stock(bram, [], { gp: 10 })
await settle()
let waiting = hold(target => target === bram)
const ahead = move('bram', { from: 'bram', to: 'lia', currency: { gp: 1 } })
const behind = change('thorin', 'remove', { gp: 5 })
at = writes.length
app.waiting.set('camp-a', [ahead, behind])
app.wake?.()
await until(() => waiting.held, "the move ahead's write")
await wait(100)
assert.ok(!writes.slice(at).some(([, id]) => id === 'thorin'), "Thorin's coins wait")
assert.equal(resultsOf(behind.id).length, 0)
waiting.release()
await until(() => resultsOf(behind.id).length, 'its result')
assert.deepEqual([resultsOf(ahead.id)[0].status, resultsOf(behind.id)[0].status, purse(thorin)], ['done', 'done', { gp: 35 }])
assert.ok(resultIndex(behind.id) > resultIndex(ahead.id))
// And the next move waits for it.
restock()
stock(bram, [], { gp: 10 })
await settle()
waiting = hold(target => target === thorin)
const leading = change('thorin', 'add', { gp: 5 })
const next = move('bram', { from: 'bram', to: 'lia', currency: { gp: 1 } })
at = writes.length
app.waiting.set('camp-a', [leading, next])
app.wake?.()
await until(() => waiting.held, "Thorin's write")
await wait(100)
assert.ok(!writes.slice(at).some(([, id]) => id === 'bram'), "Bram's move waits")
waiting.release()
await until(() => resultsOf(next.id).length, 'its result')
assert.deepEqual([resultsOf(leading.id)[0].status, resultsOf(next.id)[0].status, purse(bram), purse(lia)], ['done', 'done', { gp: 9 }, { gp: 1 }])
// Two changes of the same coins fetched together: the second reads what the first left.
restock()
await settle()
const [sooner, later] = await fetched(change('thorin', 'remove', { gp: 30 }), change('thorin', 'remove', { gp: 30 }))
assert.deepEqual([sooner.result.status, refusal(later), purse(thorin)], ['done', ['failed', 'short', null], { gp: 10 }])
// A move of his coins on its way, then coins taken away: the change finds what the move left.
restock()
await settle()
const [given, taken] = await fetched(move('thorin', { from: 'thorin', to: 'vex', currency: { gp: 30 } }), change('thorin', 'remove', { gp: 30 }))
assert.deepEqual([given.result.status, refusal(taken), purse(thorin), purse(vex)], ['done', ['failed', 'short', null], { gp: 10 }, { gp: 42 }])
okay("coins stand in the line of moves: a change waits for a move on its way, another character's too, and the next move for it; two changes of the same coins, or a move of them and a change, are made one after the other, the second `short` where too little is left")

// A change waits too for a roll of its own character's on its way, and his next roll for it: here
// Thorin's spends of a resource, keyed on him as every roll of his is, which stand in no line of moves.
restock()
campaignAs({ rolls: true, attacks: true })
thorin.system.resources = { primary: { label: 'Superiority Dice', max: 4, value: 4, sr: true } }
await settle()
const spending = hold((target, changes) => (target === thorin) && ('system.resources.primary.value' in (changes ?? {})))
const spend = () => ({ id: `spend-${++ids}`, actorId: 'thorin', kind: 'spend', counter: { resource: 'primary' }, count: 1, mode: 0, explicit: false, extras: [], dice: [] })
const [spendAhead, paying, spendBehind] = [spend(), change('thorin', 'remove', { gp: 5 }), spend()]
const queuedAt = writes.length
app.waiting.set('camp-a', [spendAhead, paying, spendBehind])
app.wake?.()
await until(() => spending.held, "Thorin's spend")
await wait(100)
const coinWrite = ([what, id, changes]) => (what === 'updateActor') && (id === 'thorin') && ('system.currency.gp' in changes)
assert.ok(!writes.slice(queuedAt).some(coinWrite), 'his coins wait for his spend')
assert.equal(resultsOf(paying.id).length, 0)
spending.release()
await until(() => [spendAhead, paying, spendBehind].every(command => resultsOf(command.id).length), 'all three')
assert.deepEqual([spendAhead, paying, spendBehind].map(command => resultsOf(command.id)[0].status), ['done', 'done', 'done'])
const spentAt = writes.findLastIndex(([what, id, changes]) => (what === 'updateActor') && (id === 'thorin') && ('system.resources.primary.value' in changes))
assert.ok(spentAt > writes.findLastIndex(coinWrite), 'his next spend after his coins')
assert.ok((resultIndex(spendBehind.id) > resultIndex(paying.id)) && (resultIndex(paying.id) > resultIndex(spendAhead.id)), 'answered in the order handed over')
assert.deepEqual([purse(thorin), thorin.system.resources.primary.value], [{ gp: 35 }, 2])
campaignAs()
okay("a change waits for a roll of its own character's on its way, and his next roll for it: a spend, 5 gp taken away and a spend, handed over together, are made in that order")

// The campaign is read again as a change's turn comes, not as it was when fetched: one waiting in the
// line of moves while the Gamemaster turns the switch off, or deletes the campaign, isn't made, and one
// waiting while Pay with other coins is turned off is paid by the setting as it then is.
for (const [setting, pay, reason, left, why] of [
  [{ coins: false }, { gp: 1 }, 'off', { pp: 2, gp: 3 }, 'the switch turned off'],
  [null, { gp: 1 }, 'off', { pp: 2, gp: 3 }, 'the campaign gone'],
  [{ coinChange: false }, { gp: 5 }, 'short', { pp: 2, gp: 2 }, 'Pay with other coins turned off'],
]) {
  restock()
  stock(bram, [], { gp: 10 })
  stock(thorin, [], { pp: 2, gp: 3 })
  await settle()
  waiting = hold(target => target === bram)
  const [moving, queued, exact] = [move('bram', { from: 'bram', to: 'lia', currency: { gp: 1 } }), change('thorin', 'remove', pay), change('thorin', 'remove', { gp: 1 })]
  at = writes.length
  lines = messages.size
  app.waiting.set('camp-a', [moving, queued, exact])
  app.wake?.()
  await until(() => waiting.held, "the move ahead's write")
  await wait(100)
  assert.deepEqual([resultsOf(queued.id).length, resultsOf(exact.id).length], [0, 0], 'both changes wait')
  if (setting) campaignAs(setting)
  else settings.set('campaigns', [])
  waiting.release()
  await until(() => resultsOf(exact.id).length, 'their results')
  assert.deepEqual([resultsOf(moving.id)[0].status, refusal({ result: resultsOf(queued.id)[0] })], ['done', ['failed', reason, null]], why)
  // With the switch off the exact change behind it isn't made either; with Pay with other coins off it is.
  assert.deepEqual([resultsOf(exact.id)[0].status, purse(thorin)], [(reason === 'off') ? 'failed' : 'done', left], why)
  assert.equal(writes.slice(at).filter(([, id]) => id === 'thorin').length, (reason === 'off') ? 0 : 1, 'nothing of the one refused written')
  assert.equal(messages.size, lines + ((reason === 'off') ? 1 : 2), 'nor posted')
  campaignAs()
  if (!setting) await hello()
}
okay("the campaign is read again as a change's turn comes: one waiting behind a move while the switch is turned off, or the campaign is deleted, is `off`, and one that needs another coin, waiting while Pay with other coins is turned off, is `short`, an exact one behind it still made; nothing of the one refused is written or posted")

/* -------------------------------------------- */
/*  A name with markup                          */
/* -------------------------------------------- */

restock()
await settle()
thorin.name = 'Thorin <b>&</b>'
made = await changed('thorin', 'add', { gp: 1 })
assert.equal(lineOf(made), 'Thorin &lt;b&gt;&amp;&lt;/b&gt; received 1 gp')
made = await changed('thorin', 'remove', { gp: 1 })
assert.equal(lineOf(made), 'Thorin &lt;b&gt;&amp;&lt;/b&gt; paid 1 gp')
thorin.name = 'Thorin'
okay("a character's name is escaped in both lines")

// ---- END ----
console.log(`coins${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
