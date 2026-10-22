// A party's things sent elsewhere by its Owner, party to party, and a party's coin distributed among
// its characters (module 0.32.0, its contract §11.2-§11.3, §11.10): the hello's
// `features.transfers.partySends` and `.distribute`; the `transfer` command's `among`; who may send
// a party's things and distribute its coin, the Gamemaster too; the Sends and Distributes lines,
// their speakers and authors; what a distribution writes, in which order, what a failure leaves,
// and what its line then says; the sheets ahead of the result; and moves and rolls waiting for one
// another. On transfers.mjs's stand-ins: the real module and its language file, dnd5e 5.3.3's real
// dice classes for its self-test, a stand-in Foundry core and app; the actors' items as Foundry's
// embedded documents, firing its hooks, with dnd5e's own createWithContents read from its source,
// 5.3.3's or with DND5E6=1 6.0.5's, whose coins may be fractional. Run with SLIM_CHECK=1 and
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

const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, transfers: 1, groups: 1 } }
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
const { transferFeatures } = await import(`${MODULE}/scripts/command-transfers.mjs`)
const { campaignMembers } = await import(`${MODULE}/scripts/groups.mjs`)
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
const FOUR = ['bram', 'lia', 'thorin', 'vex']
const share = (currency, among = FOUR, from = 'party') => ({ from, among, currency })

/* -------------------------------------------- */
/*  The hello                                   */
/* -------------------------------------------- */

assert.deepEqual(helloOf().data.features.transfers, { enabled: true, kinds: ['transfer'], reason: null, partySends: true, distribute: true })
const [campaign] = getCampaigns()
assert.deepEqual(transferFeatures({ ...campaign, transfers: false }), { enabled: false, kinds: [], reason: 'off', partySends: false, distribute: false })
game.system.id = 'pf2e'
assert.deepEqual(transferFeatures(campaign), { enabled: false, kinds: [], reason: 'system', partySends: false, distribute: false })
game.system.id = 'dnd5e'
assert.deepEqual(campaignMembers(party, campaign).map(actor => actor.id), ['thorin', 'vex', 'bram', 'lia'], "the Company's characters, in its order, Grumble left out")
okay("the hello's features.transfers says a party's things may be sent and distributed, `partySends` and `distribute`, wherever moves are made, both false while they're off or under another system")

/* -------------------------------------------- */
/*  The command                                 */
/* -------------------------------------------- */

restock()
let unchanged = writes.length
for (const [transfer, error, why] of [
  [{ ...share({ gp: 4 }), to: 'vex' }, 'transfer', 'among with to'],
  [{ from: 'party', currency: { gp: 4 } }, 'transfer', 'neither'],
  [share({ gp: 4 }, []), 'among', 'among empty'],
  [share({ gp: 40 }, Array.from({ length: 21 }, (_, n) => `char${String(n).padStart(12, '0')}`)), 'among', 'among 21 long'],
  [share({ gp: 4 }, ['bram', 'bram', 'lia']), 'among', 'a repeated id'],
  [share({ gp: 4 }, ['bram', 'party']), 'among', 'among containing from'],
  [share({ gp: 4 }, ['bram', '']), 'among', 'an id that is none'],
  [share({ gp: 4 }, 'bram'), 'among', 'among not a list'],
  [{ ...share({ gp: 4 }), items: [{ id: 'rope000000000001', quantity: 1 }] }, 'items', 'with items'],
  [share({ gp: 4, sp: 4 }), 'currency', 'two coin keys'],
  [share({}), 'currency', 'no coin'],
  [share({ zz: 4 }), 'currency', 'an unknown coin'],
  [share({ gp: 0 }), 'currency', 'none of a coin'],
  [{ ...share({ gp: 4 }), extra: true }, 'transfer', 'an unknown field'],
]) {
  assert.deepEqual(refusal(await sent('thorin', transfer)), ['failed', 'invalid', error], why)
}
assert.equal(writes.length, unchanged, 'nothing written')
okay('refuses a distribution with `to` too, or a move with neither, `transfer`; `among` empty, of 21, with a repeated id, one not an id or the party itself, `among`; with items, `items`; with other than one coin, `currency`; a field of its own besides from, to, among, items and currency, `transfer`')

/* -------------------------------------------- */
/*  A party's things sent                       */
/* -------------------------------------------- */

restock()
await settle()
let made = await sent('thorin', { from: 'party', to: 'vex', currency: { gp: 2 } })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([coinsOf(vex).gp, coinsOf(party).gp], [14, COMPANY_GP - 2])
assert.equal(lineOf(made), 'Sends 2 gp from The Iron Company to Vex')
assert.deepEqual([made.line.speaker.actor, made.line.author.id, made.line.whisper, made.line.blind], ['thorin', 'alice', [], false])
assert.deepEqual(made.line.flags['sending-stone'], { request: made.command.id })
assert.deepEqual(made.result.transfer, { from: 'party', to: 'vex', items: [], currency: { gp: 2 } })
assert.deepEqual([made.result.messageId, made.result.visible], [made.line.id, true])
assert.deepEqual(sheetsIn(made), [['group.updated', 'party'], ['character.updated', 'vex']], "the party's and Vex's, in that order; never Thorin's")
okay('Thorin, an Owner of the Company, sends 2 gp of its coins to Vex: "Sends 2 gp from The Iron Company to Vex", as Thorin, by Alice, for everyone; the party\'s sheet then Vex\'s ahead of the result, never Thorin\'s')

await settle()
made = await sent('thorin', { from: 'party', to: 'thorin', items: [{ id: 'rope000000000001', quantity: 1 }] })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(lineOf(made), 'Takes 1 Rope from The Iron Company')
assert.deepEqual([made.line.speaker.actor, made.line.author.id], ['thorin', 'alice'])
okay('sent into his own character, a party\'s Rope is a take: "Takes 1 Rope from The Iron Company", as Thorin')

// Party to party: a part of a stack, a container whole with what it holds, and a potion that stacks.
await settle()
const rope = await sent('thorin', { from: 'party', to: 'wardens', items: [{ id: 'rope000000000001', quantity: 1 }] })
const pack = await sent('thorin', { from: 'party', to: 'wardens', items: [{ id: 'pack000000000001', quantity: 1 }] })
const potions = await sent('thorin', { from: 'party', to: 'wardens', items: [{ id: 'potc000000000001', quantity: 1 }] })
for (const each of [rope, pack, potions]) assert.equal(each.result.status, 'done', JSON.stringify(each.result))
assert.equal(lineOf(rope), 'Sends 1 Rope from The Iron Company to Wardens of the Vale')
assert.equal(lineOf(pack), 'Sends 1 Backpack from The Iron Company to Wardens of the Vale')
assert.equal(lineOf(potions), 'Sends 1 Potion of Healing from The Iron Company to Wardens of the Vale')
const theirPack = wardens.items.find(item => item.name === 'Backpack')
assert.equal(wardens.items.find(item => item.name === 'Bedroll')?._source.system.container, theirPack.id, "the Bedroll in the Wardens' copy")
assert.deepEqual(potions.result.transfer.items, [{ id: 'potc000000000001', quantity: 1, created: null, stacked: 'potw000000000001' }])
assert.equal(wardens.items.get('potw000000000001')._source.system.quantity, 2, "the Wardens' potions, two")
assert.deepEqual(holds(party).map(([name, quantity]) => [name, quantity]), [['Potion of Healing', 2]], "the Company's Rope taken, then the rest")
assert.deepEqual(sheetsIn(rope), [['group.updated', 'party'], ['group.updated', 'wardens']])
okay('party to party, by an Owner of both: "Sends 1 Rope from The Iron Company to Wardens of the Vale", then the Backpack whole, the Bedroll inside the Wardens\' copy; a Potion of Healing joins the Wardens\' stack (`stacked`)')

/* -------------------------------------------- */
/*  Who may                                     */
/* -------------------------------------------- */

restock()
await settle()
unchanged = writes.length
let lines = messages.size
for (const [actorId, transfer, fields, reason, why] of [
  ['vex', { from: 'party', to: 'vex', currency: { gp: 1 } }, {}, 'not-owner', 'Bob from the Company, which he observes'],
  ['vex', { from: 'wardens', to: 'party', currency: { gp: 1 } }, {}, 'not-owner', 'Bob from the Wardens to the Company, which he observes'],
  ['thorin', { from: 'party', to: 'silent', currency: { gp: 1 } }, {}, 'unknown', 'Thorin to The Silent Order, which he can\'t see'],
  ['thorin', { from: 'vex', to: 'thorin', currency: { gp: 1 } }, {}, 'not-yours', "Thorin giving from Vex's character"],
  ['party', { from: 'party', to: 'thorin', currency: { gp: 1 } }, {}, 'not-yours', 'made as the party'],
  ['stranger', { from: 'party', to: 'thorin', currency: { gp: 1 } }, {}, 'not-yours', 'made as an actor outside the campaign'],
]) {
  made = await sent(actorId, transfer, fields)
  assert.deepEqual(refusal(made), ['failed', reason, null], why)
  assert.deepEqual(sheetsIn(made), [], `${why}: no sheet sent`)
}
assert.equal(writes.length, unchanged, 'nothing written')
assert.equal(messages.size, lines, 'no line')
okay("refuses a send from a party its player only observes, and into one he observes, `not-owner`; to a party Thorin can't see, `unknown`; from another's character, and as the party or an actor outside the campaign, `not-yours`; none writes, posts or sends a sheet")

/* -------------------------------------------- */
/*  The Gamemaster                              */
/* -------------------------------------------- */

restock()
await settle()
made = await sent('vex', { from: 'party', to: 'silent', items: [{ id: 'potc000000000001', quantity: 1 }] }, { by: 'gm' })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(lineOf(made), 'Sends 1 Potion of Healing from The Iron Company to The Silent Order')
assert.deepEqual([made.line.speaker.actor, made.line.author.id, made.line.flags['sending-stone']], ['vex', 'bob', { request: made.command.id, by: 'gm' }])
assert.deepEqual(made.result.messages, [made.line.id])
await settle()
made = await sent('vex', share({ pp: 4 }), { by: 'gm' })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(lineOf(made), 'Distributes 4 pp among Bram, Lia, Thorin, and Vex (1 pp each); none stays with The Iron Company')
assert.deepEqual([made.line.speaker.actor, made.line.author.id, made.line.flags['sending-stone']], ['vex', 'bob', { request: made.command.id, by: 'gm' }])
assert.deepEqual(made.result.messages, [made.line.id])
assert.deepEqual([coinsOf(party).pp, ...FOUR.map(id => coinsOf(actors.get(id)).pp)], [0, 1, 1, 1, 1])
unchanged = writes.length
lines = messages.size
assert.deepEqual(refusal(await sent('vex', { from: 'thorin', to: 'bram', currency: { gp: 1 } }, { by: 'gm' })), ['failed', 'not-yours', null], "Thorin's coins to Bram, as Vex")
assert.deepEqual(refusal(await sent('party', { from: 'party', to: 'bram', currency: { gp: 1 } }, { by: 'gm' })), ['failed', 'not-yours', null], 'made as the party')
assert.deepEqual([writes.length, messages.size], [unchanged, lines], 'nothing written or posted')
okay("the Gamemaster, on Vex's page: a Potion from the Company to The Silent Order, \"Sends … to The Silent Order\", and the Company's 4 pp distributed, \"Distributes 4 pp among Bram, Lia, Thorin, and Vex (1 pp each); none stays with The Iron Company\", each as Vex, by Bob, flagged `by: \"gm\"` and listed in the result's messages; but never Thorin's coins to Bram as Vex, nor as the party, `not-yours`")

/* -------------------------------------------- */
/*  Distribute                                  */
/* -------------------------------------------- */

restock()
await settle()
let at = writes.length
made = await sent('thorin', share({ gp: 103 }))
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(FOUR.map(id => coinsOf(actors.get(id)).gp), [25, 25, 65, 37], 'each 25 more')
assert.equal(coinsOf(party).gp, DND5E6 ? 3.5 : 3, "what's left with the party, as stored")
assert.equal(lineOf(made), 'Distributes 100 gp among Bram, Lia, Thorin, and Vex (25 gp each); 3 gp stays with The Iron Company')
assert.deepEqual([made.line.speaker.actor, made.line.author.id, made.line.flags['sending-stone']], ['thorin', 'alice', { request: made.command.id }])
assert.deepEqual(made.result.transfer, { from: 'party', to: null, items: [], currency: { gp: 100 }, among: FOUR })
assert.deepEqual([made.result.messageId, made.result.visible], [made.line.id, true])
assert.deepEqual(sheetsIn(made), [['group.updated', 'party'], ...FOUR.map(id => ['character.updated', id])], 'the party, then each in order')
assert.deepEqual(writes.slice(at).map(([what, id, changes]) => [what, id, changes]), [
  ['updateActor', 'party', { 'system.currency.gp': DND5E6 ? 3.5 : 3 }],
  ['updateActor', 'bram', { 'system.currency.gp': 25 }], ['updateActor', 'lia', { 'system.currency.gp': 25 }],
  ['updateActor', 'thorin', { 'system.currency.gp': 65 }], ['updateActor', 'vex', { 'system.currency.gp': 37 }],
], "the party's first, then each in turn")
okay(`a distribution of the Company's ${COMPANY_GP} gp among its four characters: 25 each, the party's written first, 3 left with it${DND5E6 ? ' (3.5 stored, of dnd5e 6\'s 103.5)' : ''}; "Distributes 100 gp among Bram, Lia, Thorin, and Vex (25 gp each); 3 gp stays with The Iron Company", as Thorin, by Alice; the result says to: null and who was given a share; the party's sheet, then each one's, in order, ahead of it`)

await settle()
made = await sent('thorin', share({ sp: 8 }))
assert.equal(lineOf(made), 'Distributes 8 sp among Bram, Lia, Thorin, and Vex (2 sp each); none stays with The Iron Company')
assert.deepEqual([coinsOf(party).sp, ...FOUR.map(id => coinsOf(actors.get(id)).sp)], [0, 2, 2, 2, 2])
okay('8 sp among four: 2 each, "…; none stays with The Iron Company"')

// Refused: nothing written, posted, or sent.
restock()
await settle()
unchanged = writes.length
lines = messages.size
for (const [actorId, transfer, reason, why] of [
  ['thorin', share({ gp: 103 }, ['bram', 'thorin', 'vex']), 'members', 'without Lia'],
  ['thorin', share({ gp: 103 }, ['ash', 'bram', 'thorin', 'vex']), 'members', 'Lia swapped for Ash, a campaign character outside the Company: as many, not the same'],
  ['thorin', share({ gp: 103 }, [...FOUR, 'grumble']), 'unknown', 'with Grumble, an NPC'],
  ['thorin', share({ gp: 103 }, [...FOUR, 'wardens']), 'unknown', 'with the Wardens, a party Thorin owns'],
  ['thorin', share({ gp: 103 }, [...FOUR, 'silent']), 'unknown', "with The Silent Order, which Thorin can't see"],
  ['thorin', share({ gp: 104 }), 'short', 'more than the party holds'],
  ['thorin', share({ cp: 3 }), 'split', 'fewer than one each'],
  ['vex', share({ gp: 103 }), 'not-owner', "Bob's, an Observer"],
  ['thorin', share({ gp: 40 }, ['bram', 'lia', 'vex'], 'thorin'), 'not-yours', "from Thorin's character"],
  ['thorin', share({ gp: 10 }, FOUR, 'silent'), 'unknown', "from The Silent Order, which Thorin can't see"],
]) {
  made = await sent(actorId, transfer)
  assert.deepEqual(refusal(made), ['failed', reason, null], why)
  assert.deepEqual(sheetsIn(made), [], `${why}: no sheet`)
}
assert.deepEqual([writes.length, messages.size], [unchanged, lines], 'nothing written or posted')
// Lia leaves the Company after the distribution is fetched, before it's made.
const waiting = hold(target => target === thorin)
const ahead = move('thorin', { from: 'thorin', to: 'vex', currency: { gp: 1 } })
const behind = move('thorin', share({ gp: 103 }))
app.waiting.set('camp-a', [ahead, behind])
app.wake?.()
await until(() => waiting.held, "the move ahead's write")
party.system.members = membersOf([thorin, vex, bram, grumble])
waiting.release()
await until(() => resultsOf(behind.id).length, 'its result')
assert.deepEqual([resultsOf(ahead.id)[0].status, resultsOf(behind.id)[0].reason], ['done', 'members'])
assert.equal(coinsOf(party).gp, COMPANY_GP, 'nothing shared')
// With Lia gone, one naming her in Vex's place names as many as the Company has, not the same.
unchanged = writes.length
lines = messages.size
made = await sent('thorin', share({ gp: 103 }, ['bram', 'lia', 'thorin']))
assert.deepEqual([refusal(made), sheetsIn(made), writes.length, messages.size], [['failed', 'members', null], [], unchanged, lines], 'Lia in place of Vex')
okay("refuses a distribution without Lia, `members`; with Ash in Lia's place, as many characters but not the Company's, `members`; with Grumble, the Wardens, or The Silent Order, `unknown` alike; more than the party holds, `short`; fewer coins than characters, `split`; Bob's, `not-owner`; from Thorin's character, `not-yours`; from a party Thorin can't see, `unknown`; and one fetched before Lia left the Company in Foundry, `members`, as is one naming her in Vex's place once she's gone: none writes, posts or sends a sheet")

/* -------------------------------------------- */
/*  A distribution that fails                   */
/* -------------------------------------------- */

const refusing = test => { faults.refuse = test }
// Lia's share refused, as by a module's preUpdateActor hook: the shares not given go back to the party.
restock()
await settle()
refusing((what, target) => (what === 'update') && (target === lia))
made = await sent('thorin', share({ gp: 103 }))
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'An update was refused'])
assert.deepEqual(made.result.transfer, { from: 'party', to: null, items: [], currency: { gp: 25 }, among: ['bram'] })
assert.deepEqual([coinsOf(party).gp, coinsOf(bram).gp, coinsOf(lia).gp, coinsOf(thorin).gp], [DND5E6 ? 78.5 : 78, 25, 0, 40], '3 + 75 back')
assert.equal(lineOf(made), 'Distributes 25 gp among Bram (25 gp each); 78 gp stays with The Iron Company')
assert.deepEqual(sheetsIn(made), [['group.updated', 'party'], ['character.updated', 'bram']])
// The putting back refused too: the shares not given lost, never made twice; the line says what stays.
restock()
await settle()
let partyUpdates = 0
refusing((what, target) => (what === 'update') && ((target === lia) || ((target === party) && (++partyUpdates === 2))))
made = await sent('thorin', share({ gp: 103 }))
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'An update was refused / An update was refused'])
assert.deepEqual(made.result.transfer, { from: 'party', to: null, items: [], currency: { gp: 25 }, among: ['bram'] })
assert.deepEqual([coinsOf(party).gp, coinsOf(bram).gp, coinsOf(lia).gp], [DND5E6 ? 3.5 : 3, 25, 0])
assert.equal(lineOf(made), 'Distributes 25 gp among Bram (25 gp each); 3 gp stays with The Iron Company')
// The party's own update refused: nothing written, said or sent.
restock()
await settle()
lines = messages.size
refusing((what, target) => (what === 'update') && (target === party))
made = await sent('thorin', share({ gp: 103 }))
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'An update was refused'])
assert.ok(!('transfer' in made.result), 'nothing said to have moved')
assert.deepEqual([messages.size, sheetsIn(made), coinsOf(party).gp, coinsOf(bram).gp], [lines, [], COMPANY_GP, 0])
// Bram's own refused, the first: the party's coins all put back, no line, the party's sheet alone.
restock()
await settle()
lines = messages.size
refusing((what, target) => (what === 'update') && (target === bram))
made = await sent('thorin', share({ gp: 103 }))
clearFaults()
assert.deepEqual([refusal(made), 'transfer' in made.result, messages.size, coinsOf(party).gp], [['failed', 'error', 'An update was refused'], false, lines, COMPANY_GP])
// The party's sheet is looked at again, its coins having been written, but is as it was told: none posted.
assert.deepEqual(sheetsIn(made), [])
okay('where Lia\'s share is refused, the three shares not given go back to the party in one write (3 + 75 = 78 gp): `error`, `transfer` naming Bram\'s alone, "Distributes 25 gp among Bram (25 gp each); 78 gp stays with The Iron Company", the party\'s and Bram\'s sheets; where that\'s refused too, both said, the party left at 3 and the line says 3 stays; where the party\'s own write is refused, nothing is written, said or sent; where the first share is, all goes back: no line, and the party\'s sheet, as it was, isn\'t posted')

/* -------------------------------------------- */
/*  Two at once                                 */
/* -------------------------------------------- */

// Two distributions of the gold fetched together: the second finds too little.
restock()
await settle()
const [sooner, later] = await fetched(move('thorin', share({ gp: 103 })), move('thorin', share({ gp: 103 })))
assert.deepEqual([sooner.result.status, refusal(later)], ['done', ['failed', 'short', null]])
assert.deepEqual(FOUR.map(id => coinsOf(actors.get(id)).gp), [25, 25, 65, 37], 'shared once')
// A distribution waits for Bram's roll ahead of it, and Bram's next waits for it: here his spends of a
// resource, keyed on him, as every roll of his is.
restock()
campaignAs({ rolls: true, attacks: true })
bram.system.resources = { primary: { label: 'Superiority Dice', max: 4, value: 4, sr: true } }
await settle()
const spending = hold((target, changes) => (target === bram) && ('system.resources.primary.value' in (changes ?? {})))
const spend = () => ({ id: `spend-${++ids}`, actorId: 'bram', kind: 'spend', counter: { resource: 'primary' }, count: 1, mode: 0, explicit: false, extras: [], dice: [] })
const [spendAhead, sharing, spendBehind] = [spend(), move('thorin', share({ gp: 103 })), spend()]
const queuedAt = writes.length
app.waiting.set('camp-a', [spendAhead, sharing, spendBehind])
app.wake?.()
await until(() => spending.held, "Bram's spend")
await wait(100)
assert.ok(!writes.slice(queuedAt).some(([what, id]) => (what === 'updateActor') && (id === 'party')), 'the distribution waits')
assert.equal(resultsOf(sharing.id).length, 0)
spending.release()
await until(() => [spendAhead, sharing, spendBehind].every(command => resultsOf(command.id).length), 'all three')
assert.deepEqual([spendAhead, sharing, spendBehind].map(command => resultsOf(command.id)[0].status), ['done', 'done', 'done'])
const shared = writes.findLastIndex(([what, id, changes]) => (what === 'updateActor') && (id === 'bram') && ('system.currency.gp' in changes))
const spent = writes.findLastIndex(([what, id, changes]) => (what === 'updateActor') && (id === 'bram') && ('system.resources.primary.value' in changes))
assert.ok(spent > shared, "Bram's next spend after his share")
assert.ok(resultIndex(spendBehind.id) > resultIndex(sharing.id))
campaignAs()
okay("two distributions of the gold fetched at once: the first shares it, the second is `short`; a distribution waits for Bram's command ahead of it, and his next waits for it, as it's keyed on each character it shares among")

// ---- END ----
console.log(`sends${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
