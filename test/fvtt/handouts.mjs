// A character's coins handed out to the characters picked (module 0.49.0), and since 0.51.0 to the
// campaign's parties among them: the hello's `features.transfers.handOut`, `.change` and
// `.handOutParties`; the `transfer` command's `each`, its check and who may make it; the total paid
// as coins taken away are, exactly and with other coins, and what the campaign's setting off does;
// the writes and their order, and what a failure leaves; the whispers, one to each character given
// coins that has a player and one to the Gamemasters, both of the two at this table, none for
// everyone, but since 0.51.0 a party's line, and who the app is told may read each; the sheets
// ahead of the result; a fraction of a coin the giver or one given stores, and a coin a sheet shows
// more of than is stored; hand-outs and rolls, and since 0.51.0 a party's moves, waiting for one
// another, and the campaign read again as a hand-out's turn comes. On a copy of sends.mjs's
// stand-ins, with dnd5e's rates: the real module and its language file, dnd5e 5.3.3's real dice
// classes for its self-test, a stand-in Foundry core and app; 5.3.3's coins or with DND5E6=1
// 6.0.5's, which may be fractional and are shown rounded down. Run with SLIM_CHECK=1 and --import
// ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settings, user, users, actors, message as fakeMessage } from './stub.mjs'

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
// A second Gamemaster at the table, an Assistant, whose browser isn't the bridge: every Gamemaster is
// whispered what a character handed out, not the bridge's alone.
Object.assign(user('gm2', 'Assistant', true, 3), { isActiveGM: false, isSelf: false })
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
// The Assistant has Owner on Vex by name too, as a Gamemaster may be given: no player of hers for
// that, so what Vex receives is whispered to Bob alone.
vex.ownership = { default: 0, bob: 3, gm2: 3 }
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
const { queueBusy } = await import(`${MODULE}/scripts/commands.mjs`)
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
  wardens.system.members = membersOf([thorin, vex])
}
const holds = actor => actor.items.map(item => [item.name, item._source.system.quantity, item._source.system.container ?? null])
const coinsOf = actor => ({ ...actor._source.system.currency })
const settle = () => wait(320)
const helloOf = () => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).at(-1)
const { transferFeatures } = await import(`${MODULE}/scripts/command-transfers.mjs`)
/** The campaign's hello sent afresh, as a change to its settings sends it, and answered. */
async function hello() {
  const hellos = () => app.events.filter(e => e.type === 'bridge.hello').length
  const before = hellos()
  announce()
  await until(() => hellos() > before, 'the hello')
  await wait(60)
}
/** A hand-out as the app hands it over: so many of each coin to each of these, from the character it's made as. */
const handOut = (actorId, each, currency, fields = {}) => move(actorId, { from: actorId, each, currency }, fields)
const handed = async (...args) => (await fetched(handOut(...args)))[0]
/** Coins taken away, as the app hands the command over. */
const taking = (actorId, currency) => ({ id: `coins-${++ids}`, actorId, kind: 'coins', coins: { op: 'remove', currency }, mode: 0, explicit: false, extras: [], dice: [] })
/** The coins an actor stores, those it has any of. */
const purse = actor => Object.fromEntries(Object.entries(coinsOf(actor)).filter(([, n]) => n))
/** Every message a command made, in the order made, and what each says, to whom, as whom and by whom. */
const saidBy = made => [...messages.values()].filter(message => message.flags?.['sending-stone']?.request === made.command.id)
const told = message => [message.content.replace(/^<p>|<\/p>$/g, ''), [...message.whisper], message.speaker.actor, message.author.id]
/** The chat event the app was sent for a message, if it was sent one. */
const chatOf = id => app.events.find(e => (e.type === 'chat.message.created') && (e.data.message.id === id))
/** Both Gamemasters, whom the one message of a hand-out is whispered to. */
const GMS = ['gm', 'gm2']
const THREE = ['vex', 'bram', 'lia']
const RICH = { pp: 700, gp: 20 }
const EACH = { pp: 200, gp: 50 }

/* -------------------------------------------- */
/*  The hello                                   */
/* -------------------------------------------- */

const ON = { enabled: true, kinds: ['transfer'], reason: null, partySends: true, distribute: true, handOut: true, change: true, handOutParties: true }
const off = reason => ({ enabled: false, kinds: [], reason, partySends: false, distribute: false, handOut: false, change: false, handOutParties: false })
const KEYS = ['enabled', 'kinds', 'reason', 'partySends', 'distribute', 'handOut', 'change', 'handOutParties']
assert.deepEqual(helloOf().data.features.transfers, ON)
assert.deepEqual(Object.keys(helloOf().data.features.transfers), KEYS, 'ending with handOut, change and handOutParties')
const [campaign] = getCampaigns()
assert.deepEqual(transferFeatures({ ...campaign, coinChange: false }), { ...ON, change: false })
assert.deepEqual(transferFeatures({ ...campaign, coins: false }), ON, "whatever the switch for coins added and taken away")
assert.deepEqual([transferFeatures({ ...campaign, transfers: false }), Object.keys(transferFeatures({ ...campaign, transfers: false }))], [off('off'), KEYS])
game.system.id = 'pf2e'
assert.deepEqual([transferFeatures(campaign), Object.keys(transferFeatures(campaign))], [off('system'), KEYS])
game.system.id = 'dnd5e'
campaignAs({ coinChange: false })
await hello()
assert.deepEqual(helloOf().data.features.transfers, { ...ON, change: false })
campaignAs()
await hello()
okay("the hello's features.transfers ends with `handOut`, true wherever moves are made, `change`, the campaign's Pay with other coins there, and since 0.51.0 `handOutParties`, true wherever moves are made; all three false while moves are off or under another system, whatever the switch for coins added and taken away")

/* -------------------------------------------- */
/*  The command                                 */
/* -------------------------------------------- */

restock()
await settle()
let unchanged = writes.length
let lines = messages.size
const shaped = transfer => move('thorin', transfer)
for (const [command, error, why] of [
  [shaped({ from: 'thorin', each: ['vex'], to: 'bram', currency: { gp: 1 } }), 'transfer', 'each with to'],
  [shaped({ from: 'thorin', each: ['vex'], among: ['bram'], currency: { gp: 1 } }), 'transfer', 'each with among'],
  [shaped({ from: 'thorin', each: ['vex'], to: 'bram', among: ['lia'], currency: { gp: 1 } }), 'transfer', 'all three'],
  [shaped({ from: 'thorin', each: ['vex'], currency: { gp: 1 }, extra: true }), 'transfer', 'a field of its own besides'],
  [handOut('thorin', ['vex'], { gp: 1 }, { target: 'vex' }), 'transfer', "a roll's field beside it"],
  [handOut('thorin', [], { gp: 1 }), 'each', 'no one'],
  [handOut('thorin', Array.from({ length: 21 }, (_, n) => `char${String(n).padStart(12, '0')}`), { gp: 1 }), 'each', '21 of them'],
  [handOut('thorin', ['vex', 'bram', 'vex'], { gp: 1 }), 'each', 'one twice'],
  [handOut('thorin', ['vex', 'thorin'], { gp: 1 }), 'each', 'the giver among them'],
  [handOut('thorin', ['vex', ''], { gp: 1 }), 'each', 'an id that is none'],
  [handOut('thorin', 'vex', { gp: 1 }), 'each', 'no list'],
  [shaped({ from: 'thorin', each: ['vex'], currency: { gp: 1 }, items: [{ id: 'rope000000000001', quantity: 1 }] }), 'items', 'with items'],
  [shaped({ from: 'thorin', each: ['vex'] }), 'currency', 'no coins'],
  [handOut('thorin', ['vex'], {}), 'currency', 'no coin'],
  [handOut('thorin', ['vex'], { zz: 1 }), 'currency', 'a coin dnd5e has not'],
  [handOut('thorin', ['vex'], { gp: 0 }), 'currency', 'none of a coin'],
  [handOut('thorin', ['vex'], { gp: 1.5 }), 'currency', 'a fraction of a coin'],
  [handOut('thorin', ['vex'], { gp: 10_000_001 }), 'currency', 'more than 10,000,000 of a coin'],
  [handOut('thorin', ['vex'], { gp: 1 }, { dice: [{ faces: 20, results: [3] }] }), 'dice', 'dice'],
  [handOut('thorin', ['vex'], { gp: 1 }, { of: 'thorin' }), 'of', "a companion's"],
  [handOut('thorin', ['vex'], { gp: 1 }, { by: 'player' }), 'by', 'by anyone but the Gamemaster'],
]) {
  assert.deepEqual(refusal((await fetched(command))[0]), ['failed', 'invalid', error], why)
}
// Twenty is no more than a hand-out names: these twenty are no one's, which the check doesn't ask.
assert.deepEqual(refusal(await handed('thorin', Array.from({ length: 20 }, (_, n) => `char${String(n).padStart(12, '0')}`), { gp: 1 })), ['failed', 'unknown', null], 'twenty are taken')
assert.deepEqual([writes.length, messages.size], [unchanged, lines], 'nothing written or posted')
okay('refuses a hand-out with `to` or `among` too, a field of its own besides, or a roll\'s field, `transfer`; `each` empty, of 21, with one twice, the giver, one not an id, or no list, `each`; with items, `items`; without 1 or more of dnd5e\'s coins, each a whole number from 1 to 10,000,000, `currency`; `dice`, `of` and `by` as every move\'s; twenty are taken')

/* -------------------------------------------- */
/*  Who may                                     */
/* -------------------------------------------- */

restock()
stock(ash, [], { gp: 9 })
// A form of Ash's, as dnd5e's transformInto makes one.
const form = character('ashform', 'Ash (Wolf)', ['eve'], { coins: { gp: 3 } })
await settle()
unchanged = writes.length
lines = messages.size
const one = { gp: 1 }
for (const [actorId, transfer, fields, reason, why, before] of [
  ['thorin', { from: 'vex', each: ['bram'], currency: one }, {}, 'not-yours', "from another's character"],
  ['vex', { from: 'thorin', each: ['bram'], currency: one }, { by: 'gm' }, 'not-yours', "the Gamemaster's, made as another than the giver"],
  ['thorin', { from: 'party', each: ['vex'], currency: one }, {}, 'not-yours', 'from a party its player owns'],
  ['thorin', { from: 'party', each: ['vex'], currency: one }, { by: 'gm' }, 'not-yours', "the Gamemaster's from a party"],
  ['vex', { from: 'party', each: ['bram'], currency: one }, {}, 'not-owner', 'from a party its player observes'],
  ['thorin', { from: 'silent', each: ['vex'], currency: one }, {}, 'unknown', "from a party its player can't see"],
  ['vex', { from: 'vex', each: ['party'], currency: one }, {}, 'not-owner', 'to a party its player observes'],
  ['vex', { from: 'vex', each: ['bram', 'party'], currency: one }, {}, 'not-owner', 'a party its player observes among them'],
  ['thorin', { from: 'thorin', each: ['silent'], currency: one }, {}, 'unknown', "to a party its player can't see"],
  ['thorin', { from: 'thorin', each: ['vex', 'silent'], currency: one }, {}, 'unknown', "a party its player can't see among them"],
  ['thorin', { from: 'thorin', each: ['vex', 'stranger'], currency: one }, {}, 'unknown', 'an actor outside the campaign among them'],
  ['thorin', { from: 'thorin', each: ['vex', 'grumble'], currency: one }, {}, 'unknown', 'an NPC among them'],
  ['thorin', { from: 'thorin', each: ['vex', 'nobody'], currency: one }, {}, 'unknown', 'one that is none among them'],
  ['stranger', { from: 'stranger', each: ['vex'], currency: one }, {}, 'unknown', 'from an actor outside the campaign'],
  ['thorin', { from: 'thorin', each: ['vex', 'ash'], currency: one }, {}, 'shaped', 'to a character transformed', () => { form.flags.dnd5e = { isPolymorphed: true, originalActor: 'ash' } }],
  ['ash', { from: 'ash', each: ['vex'], currency: one }, {}, 'shaped', 'from a character transformed'],
  ['thorin', { from: 'thorin', each: ['vex', 'ashform'], currency: one }, {}, 'unknown', 'to her form'],
]) {
  before?.()
  const made = (await fetched(move(actorId, transfer, fields)))[0]
  assert.deepEqual([refusal(made), sheetsIn(made)], [['failed', reason, null], []], why)
}
assert.deepEqual([writes.length, messages.size, purse(thorin), purse(vex), coinsOf(party).gp], [unchanged, lines, { gp: 40 }, { gp: 12 }, COMPANY_GP], 'nothing written or posted')
actors.delete('ashform')
campaignAs({ transfers: false })
assert.deepEqual([refusal(await handed('thorin', ['vex'], one)), writes.length], [['failed', 'transfers-off', null], unchanged], 'moves off')
assert.deepEqual([refusal(await handed('thorin', ['vex'], one, { by: 'gm' })), writes.length, messages.size], [['failed', 'transfers-off', null], unchanged, lines], "moves off, the Gamemaster's too")
campaignAs({ coins: false })
let made = await handed('thorin', ['vex'], one)
assert.equal(made.result.status, 'done', 'made with coins added and taken away off: it follows Players move items and coins')
campaignAs()
okay("refuses a hand-out from another's character, or the Gamemaster's made as another than the giver, `not-yours`; from a party, `not-yours` where its player owns it and for the Gamemaster, `not-owner` where they observe it, `unknown` where they can't see it; to a party, or with one among those picked, `not-owner` where its player observes it and `unknown` where they can't see it; with an actor outside the campaign, an NPC or no one among those picked, `unknown`; to or from a character transformed, `shaped`; with moves off, `transfers-off`, the Gamemaster's too: none writes, posts or sends a sheet; and it's made whatever the switch for coins added and taken away")

// Since 0.51.0 a party its player owns may be among those picked: Thorin's to Vex and the Company is
// made, the Company given as Vex is, in the order named, its line for everyone.
restock()
await settle()
{
  const start = writes.length
  const given = await handed('thorin', ['vex', 'party'], one)
  assert.equal(given.result.status, 'done', JSON.stringify(given.result))
  assert.deepEqual(writes.slice(start).map(([, id, changes]) => [id, changes]), [
    ['thorin', { 'system.currency.gp': 38 }], ['vex', { 'system.currency.gp': 13 }], ['party', { 'system.currency.gp': COMPANY_GP + 1 }],
  ], "the giver's, then each one's in the order named, the party's too")
  assert.deepEqual(saidBy(given).map(told), [
    ['Vex received 1 gp from Thorin', ['bob'], 'thorin', 'alice'],
    ['Gives 1 gp to The Iron Company', [], 'thorin', 'alice'],
    ['Thorin handed out 1 gp each to Vex and The Iron Company: 2 gp in all', GMS, 'thorin', 'alice'],
  ])
  assert.deepEqual(given.result.transfer.each, ['vex', 'party'])
  // The Gamemaster's to the Order, which no player can see: made, its line for everyone, as any move to
  // it posts one; no sheet but the giver's, as the app is sent none of a party no player sees.
  const order = await handed('thorin', ['silent'], one, { by: 'gm' })
  assert.deepEqual([order.result.status, saidBy(order).map(told), sheetsIn(order), purse(silent)], [
    'done', [['Gives 1 gp to The Silent Order', [], 'thorin', 'alice']], [['character.updated', 'thorin']], { gp: 31 },
  ], JSON.stringify(order.result))
}
okay("since 0.51.0 a party its player owns may be among those picked: Thorin's 1 gp each to Vex and the Company writes his, then Vex's, then the Company's, whispers Vex, posts \"Gives 1 gp to The Iron Company\" for everyone in its place, and tells the Gamemasters of both; the Gamemaster's to the Silent Order, which no player sees, is made, its line for everyone and no sheet of it sent")

/* -------------------------------------------- */
/*  Handed out exactly                          */
/* -------------------------------------------- */

restock()
await settle()
let at = writes.length
lines = messages.size
made = await handed('thorin', ['vex', 'bram'], { gp: 10 })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([purse(thorin), purse(vex), purse(bram)], [{ gp: 20 }, { gp: 22 }, { gp: 10 }])
assert.deepEqual(writes.slice(at), [
  ['updateActor', 'thorin', { 'system.currency.gp': 20 }],
  ['updateActor', 'vex', { 'system.currency.gp': 22 }], ['updateActor', 'bram', { 'system.currency.gp': 10 }],
], "the giver's first, in one write, then each one's in the order named")
let said = saidBy(made)
assert.deepEqual(said.map(told), [
  ['Vex received 10 gp from Thorin', ['bob'], 'thorin', 'alice'],
  ['Bram received 10 gp from Thorin', ['carol'], 'thorin', 'alice'],
  ['Thorin handed out 10 gp each to Vex and Bram: 20 gp in all', GMS, 'thorin', 'alice'],
])
assert.equal(messages.size, lines + 3, 'and no other')
assert.ok(said.every(message => (message.whisper.length > 0) && (message.blind === false)), 'none for everyone')
// Every Gamemaster is whispered the one message, the Assistant as the bridge's own; and neither is
// whispered what a character received, though the Assistant has Owner on Vex by name.
assert.deepEqual([users.filter(u => u.isGM).map(u => u.id), game.user.id, users.activeGM.id], [GMS, 'gm', 'gm'], "two Gamemasters, the bridge's the first")
assert.deepEqual(said.at(-1).whisper, GMS, 'both Gamemasters, not the bridge\'s alone')
assert.ok(said.slice(0, -1).every(message => message.whisper.every(id => users.get(id).isGM === false)), "no Gamemaster among a receiver's players")
assert.ok(said.every(message => JSON.stringify(message.flags['sending-stone']) === JSON.stringify({ request: made.command.id })))
assert.deepEqual(made.result, {
  id: made.command.id, status: 'done', reason: null, error: null, messageId: said.at(-1).id, visible: true, rolls: [],
  transfer: { from: 'thorin', to: null, items: [], currency: { gp: 10 }, each: ['vex', 'bram'], used: null },
})
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin'], ['character.updated', 'vex'], ['character.updated', 'bram']], "the giver's, then each one's given, in order")
okay('Thorin hands out 10 gp each to Vex and Bram: 20 gp taken from him in one write, then 10 added to each in the order named; "Vex received 10 gp from Thorin" whispered to Bob alone, though the Assistant Gamemaster has Owner on her too, "Bram received 10 gp from Thorin" to Carol, and "Thorin handed out 10 gp each to Vex and Bram: 20 gp in all" to both Gamemasters, the bridge\'s and the Assistant, each as Thorin, by Alice, none for everyone; his sheet, then theirs, ahead of the result, whose `transfer` says what each was given, `each` and `used` null, its message the Gamemasters\'')

/* -------------------------------------------- */
/*  To parties and characters                   */
/* -------------------------------------------- */

// Since 0.51.0 a party is given coins as a character is, in its place in the order named: its line is
// for everyone, as a give to it posts one, spoken by the giver; each character is whispered theirs,
// and the Gamemasters are told of all of them.
restock()
await settle()
at = writes.length
lines = messages.size
made = await handed('thorin', ['party', 'vex', 'bram'], { gp: 2 })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(writes.slice(at), [
  ['updateActor', 'thorin', { 'system.currency.gp': 34 }],
  ['updateActor', 'party', { 'system.currency.gp': COMPANY_GP + 2 }],
  ['updateActor', 'vex', { 'system.currency.gp': 14 }], ['updateActor', 'bram', { 'system.currency.gp': 2 }],
], `the giver's first, then the party's and each character's in the order named${DND5E6 ? ", the party's half a gold kept" : ''}`)
said = saidBy(made)
assert.deepEqual(said.map(told), [
  ['Gives 2 gp to The Iron Company', [], 'thorin', 'alice'],
  ['Vex received 2 gp from Thorin', ['bob'], 'thorin', 'alice'],
  ['Bram received 2 gp from Thorin', ['carol'], 'thorin', 'alice'],
  ['Thorin handed out 2 gp each to The Iron Company, Vex, and Bram: 6 gp in all', GMS, 'thorin', 'alice'],
])
assert.equal(messages.size, lines + 4, 'and no other')
assert.deepEqual([said[0].blind, chatOf(said[0].id).data.message.audience.public], [false, true], "the party's line for everyone, and the app told so")
assert.deepEqual(made.result, {
  id: made.command.id, status: 'done', reason: null, error: null, messageId: said.at(-1).id, visible: true, rolls: [],
  transfer: { from: 'thorin', to: null, items: [], currency: { gp: 2 }, each: ['party', 'vex', 'bram'], used: null },
})
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin'], ['group.updated', 'party'], ['character.updated', 'vex'], ['character.updated', 'bram']], "the giver's, then each one's given, the party's as a group")
okay(`Thorin hands out 2 gp each to the Company, Vex and Bram: 6 gp taken from him, then 2 added to the Company${DND5E6 ? ' (105.5, its half a gold kept)' : ''}, Vex and Bram in the order named; "Gives 2 gp to The Iron Company" for everyone, as Thorin, by Alice, in its place, then each character whispered theirs, and the Gamemasters "Thorin handed out 2 gp each to The Iron Company, Vex, and Bram: 6 gp in all"; the sheets in order, the Company's as a group; the result's \`each\` names the Company too, its message the Gamemasters'`)

// A party alone: its line and nothing else, which the result's message is.
restock()
await settle()
lines = messages.size
made = await handed('thorin', ['party'], { gp: 2 })
said = saidBy(made)
assert.deepEqual([said.map(told), messages.size], [[['Gives 2 gp to The Iron Company', [], 'thorin', 'alice']], lines + 1], 'no whisper, and nothing for the Gamemasters')
assert.deepEqual([made.result.status, made.result.messageId, made.result.visible, made.result.transfer.each, purse(thorin), coinsOf(party).gp], ['done', said[0].id, true, ['party'], { gp: 38 }, COMPANY_GP + 2])
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin'], ['group.updated', 'party']])
okay("2 gp to the Company alone posts its line for everyone and nothing else, no Gamemasters' message: the result's message is the line, `visible` true")

// A party neither the giver nor any other given is a member of: no character's sheet sends it, so
// its own goes ahead of the result, in its place. Thorin, out of the Wardens for this, gives them
// and Bram 2 gp each; the Gamemaster gives Lia's 1 gp to the Wardens, of which she was never one.
restock()
wardens.system.members = membersOf([vex])
stock(lia, [], { gp: 5 })
await settle()
made = await handed('thorin', ['wardens', 'bram'], { gp: 2 })
assert.deepEqual([made.result.status, sheetsIn(made), purse(wardens)], [
  'done', [['character.updated', 'thorin'], ['group.updated', 'wardens'], ['character.updated', 'bram']], { gp: 12 },
], "the Wardens' sheet in its place, though Thorin is none of them")
made = await handed('lia', ['wardens'], { gp: 1 }, { by: 'gm' })
assert.deepEqual([made.result.status, sheetsIn(made), purse(wardens)], [
  'done', [['character.updated', 'lia'], ['group.updated', 'wardens']], { gp: 13 },
], "the Wardens' sheet after Lia's, though she is none of them")
okay("a party none of whose members gives or is given is sent for itself, ahead of the result: Thorin, out of the Wardens, gives them and Bram 2 gp each, his sheet, the Wardens' and Bram's sent in that order; the Gamemaster's 1 gp from Lia to the Wardens sends hers, then theirs")

// With other coins: the party is paid as a character is, the giver's platinum broken for the gold.
restock()
stock(thorin, [], RICH)
await settle()
at = writes.length
made = await handed('thorin', ['party', 'vex'], EACH)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(writes.slice(at).map(([, id, changes]) => [id, changes]), [
  ['thorin', { 'system.currency.pp': 292, 'system.currency.gp': 0 }],
  ['party', { 'system.currency.pp': 204, 'system.currency.gp': COMPANY_GP + 50 }],
  ['vex', { 'system.currency.pp': 200, 'system.currency.gp': 62 }],
])
assert.deepEqual(saidBy(made).map(message => told(message)[0]), [
  'Gives 200 pp and 50 gp to The Iron Company', 'Vex received 200 pp and 50 gp from Thorin',
  'Thorin handed out 200 pp and 50 gp each to The Iron Company and Vex: 400 pp and 100 gp in all',
])
assert.deepEqual(made.result.transfer, { from: 'thorin', to: null, items: [], currency: EACH, each: ['party', 'vex'], used: { pp: 8 } })
okay("700 pp and 20 gp, 200 pp and 50 gp each to the Company and Vex: 8 pp broken for the gold, 292 pp left, the Company given 200 pp and 50 gp as Vex is, `used: { pp: 8 }`")

// The party's write refused, the first: all of it goes back to Thorin in one write, Vex is given none,
// and nothing is posted.
restock()
await settle()
at = writes.length
lines = messages.size
faults.refuse = (what, target) => (what === 'update') && (target === party)
made = await handed('thorin', ['party', 'vex'], { gp: 2 })
clearFaults()
assert.deepEqual([refusal(made), 'transfer' in made.result, messages.size, sheetsIn(made)], [['failed', 'error', 'An update was refused'], false, lines, []])
assert.deepEqual(writes.slice(at).map(([, id, changes]) => [id, changes]), [
  ['thorin', { 'system.currency.gp': 36 }], ['party', { 'system.currency.gp': COMPANY_GP + 2 }], ['thorin', { 'system.currency.gp': 40 }],
], 'no write of Vex')
assert.deepEqual([purse(thorin), purse(vex), coinsOf(party).gp], [{ gp: 40 }, { gp: 12 }, COMPANY_GP])
// Vex's refused, after the party's: the party keeps its coins, what wasn't given goes back, its line is
// posted and no Gamemasters' message, as no character was given coins.
restock()
await settle()
at = writes.length
lines = messages.size
faults.refuse = (what, target) => (what === 'update') && (target === vex)
made = await handed('thorin', ['party', 'vex', 'bram'], { gp: 2 })
clearFaults()
assert.deepEqual([refusal(made), made.result.transfer.each], [['failed', 'error', 'An update was refused'], ['party']])
assert.deepEqual(writes.slice(at).map(([, id, changes]) => [id, changes]), [
  ['thorin', { 'system.currency.gp': 34 }], ['party', { 'system.currency.gp': COMPANY_GP + 2 }],
  ['vex', { 'system.currency.gp': 14 }], ['thorin', { 'system.currency.gp': 38 }],
], 'no write of Bram')
assert.deepEqual([purse(thorin), purse(vex), purse(bram), coinsOf(party).gp], [{ gp: 38 }, { gp: 12 }, {}, COMPANY_GP + 2])
assert.deepEqual([saidBy(made).map(told), messages.size], [[['Gives 2 gp to The Iron Company', [], 'thorin', 'alice']], lines + 1])
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin'], ['group.updated', 'party']])
okay("where the party's write is refused, the first, all goes back to the giver in one write and nothing is posted or sent; where Vex's is, after the party's, the party keeps its 2 gp, 4 gp go back, its line alone is posted, no Gamemasters' message, `transfer.each` the party alone")

/* -------------------------------------------- */
/*  With other coins                            */
/* -------------------------------------------- */

restock()
stock(thorin, [], RICH)
await settle()
at = writes.length
lines = messages.size
made = await handed('thorin', THREE, { gp: 50, pp: 200 })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([purse(thorin), purse(vex), purse(bram), purse(lia)], [{ pp: 87 }, { pp: 200, gp: 62 }, { pp: 200, gp: 50 }, { pp: 200, gp: 50 }])
assert.deepEqual(writes.slice(at), [
  ['updateActor', 'thorin', { 'system.currency.pp': 87, 'system.currency.gp': 0 }],
  ['updateActor', 'vex', { 'system.currency.pp': 200, 'system.currency.gp': 62 }],
  ['updateActor', 'bram', { 'system.currency.pp': 200, 'system.currency.gp': 50 }],
  ['updateActor', 'lia', { 'system.currency.pp': 200, 'system.currency.gp': 50 }],
])
said = saidBy(made)
assert.deepEqual(said.map(told), [
  ['Vex received 200 pp and 50 gp from Thorin', ['bob'], 'thorin', 'alice'],
  ['Bram received 200 pp and 50 gp from Thorin', ['carol'], 'thorin', 'alice'],
  ['Thorin handed out 200 pp and 50 gp each to Vex, Bram, and Lia: 600 pp and 150 gp in all', GMS, 'thorin', 'alice'],
], 'none for Lia, whom no player owns, though the Gamemaster is told of her')
assert.equal(messages.size, lines + 3)
assert.ok([...messages.values()].slice(-3).every(message => message.whisper.length > 0), 'none for everyone')
assert.deepEqual([Object.keys(made.result.transfer.currency), made.result.transfer], [['pp', 'gp'], { from: 'thorin', to: null, items: [], currency: EACH, each: THREE, used: { pp: 13 } }], 'what each was given, never the total')
assert.deepEqual([made.result.messageId, made.result.visible], [said.at(-1).id, true])
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin'], ...THREE.map(id => ['character.updated', id])])
// Who the app is told may read each: the one given and the giver, whose player wrote it; the Gamemasters' message, the giver alone.
assert.deepEqual(said.map(message => { const { audience } = chatOf(message.id).data.message; return [audience.public, audience.gmOnly, [...audience.users].sort(), [...audience.characters].sort()] }), [
  [false, false, ['alice', 'bob'], ['thorin', 'vex']], [false, false, ['alice', 'carol'], ['bram', 'thorin']], [false, false, ['alice'], ['thorin']],
])
okay("700 pp and 20 gp, 200 pp and 50 gp each to three: 13 pp broken for the gold, 87 pp left, `used: { pp: 13 }`; each written what they're given, in dnd5e's order however the app named the coins; a whisper to each one with a player and none for Lia, who has none, the Gamemaster told of all three and \"600 pp and 150 gp in all\"; the app told each whisper's readers are the one given and the giver, the Gamemaster's the giver alone")

restock()
stock(thorin, [], { gp: 10_000 })
made = await handed('thorin', THREE, { pp: 200 })
assert.deepEqual([made.result.status, purse(thorin), purse(lia), made.result.transfer.used], ['done', { gp: 4000 }, { pp: 200 }, { gp: 6000 }])
okay('10,000 gp, 200 pp each to three: with no platinum of his own, 6,000 gp pay for it, 4,000 left')

/* -------------------------------------------- */
/*  Too little                                  */
/* -------------------------------------------- */

restock()
await settle()
unchanged = writes.length
lines = messages.size
made = await handed('thorin', ['vex', 'bram'], { gp: 25 })
assert.deepEqual([refusal(made), sheetsIn(made), 'transfer' in made.result], [['failed', 'short', null], [], false], '50 gp of 40')
stock(thorin, [], { pp: 2, gp: 3 })
campaignAs({ coinChange: false })
made = await handed('thorin', ['vex', 'bram'], { gp: 2 })
assert.deepEqual([refusal(made), sheetsIn(made)], [['failed', 'short', null], []], '4 gp of 3, other coins not paying')
made = await handed('thorin', ['vex', 'bram'], { gp: 2 }, { by: 'gm' })
assert.deepEqual([refusal(made), sheetsIn(made)], [['failed', 'short', null], []], "nor for the Gamemaster's")
assert.deepEqual([writes.length, messages.size, purse(thorin)], [unchanged, lines, { pp: 2, gp: 3 }], 'nothing written or posted')
made = await handed('thorin', ['vex', 'bram'], { gp: 1 })
assert.deepEqual([made.result.status, purse(thorin), made.result.transfer.used], ['done', { pp: 2, gp: 1 }, null], 'an exact one is made')
campaignAs()
made = await handed('thorin', ['vex', 'bram'], { gp: 2 })
assert.deepEqual([made.result.status, purse(thorin), made.result.transfer.used], ['done', { pp: 1, gp: 7 }, { pp: 1 }], 'and with other coins paying, the same hand-out breaks a platinum')
okay('a total worth more than the giver holds is `short`, with nothing written, posted or sent; with Pay with other coins off, so is a total of more of a coin than he holds, the Gamemaster\'s hand-out too, though an exact one is made; on again, the same hand-out breaks a larger coin')

/* -------------------------------------------- */
/*  A fraction of a coin                        */
/* -------------------------------------------- */

const refusing = test => { faults.refuse = test }
// dnd5e 6 stores a fraction of a coin and shows the coin rounded down: a hand-out is written from what
// each actor stores, so the giver's fraction and those of the ones given stay. Under 5.3.3 the
// stand-in shows what it stores, so these writes are the same from either.
restock()
stock(thorin, [], { pp: 700.5, gp: 20.5 })
stock(vex, [], { gp: 12.5 })
await settle()
at = writes.length
made = await handed('thorin', THREE, EACH)
assert.deepEqual([made.result.status, made.result.transfer.used], ['done', { pp: 13 }], JSON.stringify(made.result))
assert.deepEqual(writes.slice(at), [
  ['updateActor', 'thorin', { 'system.currency.pp': 87.5, 'system.currency.gp': 0.5 }],
  ['updateActor', 'vex', { 'system.currency.pp': 200, 'system.currency.gp': 62.5 }],
  ['updateActor', 'bram', { 'system.currency.pp': 200, 'system.currency.gp': 50 }],
  ['updateActor', 'lia', { 'system.currency.pp': 200, 'system.currency.gp': 50 }],
], "the giver's half a platinum and half a gold, and Vex's half a gold, stay")
assert.deepEqual([purse(thorin), purse(vex)], [{ pp: 87.5, gp: 0.5 }, { pp: 200, gp: 62.5 }])
// What's put back after a write refused is added to what the giver then stores, its fraction with it.
restock()
stock(thorin, [], { pp: 700.5, gp: 20.5 })
stock(vex, [], { gp: 12.5 })
await settle()
at = writes.length
refusing((what, target) => (what === 'update') && (target === bram))
made = await handed('thorin', THREE, EACH)
clearFaults()
assert.deepEqual([refusal(made), made.result.transfer.each], [['failed', 'error', 'An update was refused'], ['vex']])
assert.deepEqual(writes.slice(at).map(([, id, changes]) => [id, changes]), [
  ['thorin', { 'system.currency.pp': 87.5, 'system.currency.gp': 0.5 }], ['vex', { 'system.currency.pp': 200, 'system.currency.gp': 62.5 }],
  ['bram', { 'system.currency.pp': 200, 'system.currency.gp': 50 }], ['thorin', { 'system.currency.pp': 487.5, 'system.currency.gp': 100.5 }],
], 'the put back keeps his fractions')
assert.deepEqual([purse(thorin), purse(vex), purse(bram), purse(lia)], [{ pp: 487.5, gp: 100.5 }, { pp: 200, gp: 62.5 }, {}, {}])
// A fraction stays as it's written, for the giver and each one given: floating point alone makes
// 20.700000000000003 of 40.7 less 20.
restock()
stock(thorin, [], { gp: 40.7 })
stock(vex, [], { gp: 0.56 })
await settle()
at = writes.length
made = await handed('thorin', ['vex', 'bram'], { gp: 10 })
assert.deepEqual([made.result.status, writes.slice(at).map(([, id, changes]) => [id, changes])], ['done', [
  ['thorin', { 'system.currency.gp': 20.7 }], ['vex', { 'system.currency.gp': 10.56 }], ['bram', { 'system.currency.gp': 10 }],
]], '40.7 gp less 20 leaves 20.7, and 0.56 gp and 10 is 10.56')
// Half a platinum is no coin to break: 3 gp and half a platinum can't hand out 4 gp.
restock()
stock(thorin, [], { pp: 0.5, gp: 3 })
await settle()
unchanged = writes.length
lines = messages.size
made = await handed('thorin', ['vex', 'bram'], { gp: 2 })
assert.deepEqual([refusal(made), writes.length, messages.size, purse(thorin)], [['failed', 'short', null], unchanged, lines, { pp: 0.5, gp: 3 }], 'half a platinum is never broken')
okay(`a fraction of a coin${DND5E6 ? ', as dnd5e 6 stores one,' : ''} stays in a hand-out: 700.5 pp and 20.5 gp, 200 pp and 50 gp each to three, leaves 87.5 pp and 0.5 gp, and Vex's 12.5 gp becomes 62.5, each written from what is stored; what is put back after a write refused is added to what the giver then stores, 487.5 pp and 100.5 gp; a fraction stays as it is written, 40.7 gp less 20 leaving 20.7; half a platinum is never broken for a hand-out, which is \`short\``)

// A coin a sheet shows more of than its actor stores, as an effect may add to it, under either
// release: no more than is stored is handed out, and every write is from what is stored, the giver's,
// each one's given and the put back, so the coins the sheet adds are never made real.
/** Have an actor's sheet show so many more of each coin than it stores, until the function returned is called. */
function showing(actor, more) {
  const prepare = actor.prepareCurrency
  actor.prepareCurrency = function () {
    prepare.call(this)
    for (const [key, n] of Object.entries(more)) this.system.currency[key] += n
  }
  actor.prepareCurrency()
  return () => { actor.prepareCurrency = prepare; actor.prepareCurrency() }
}
restock()
const shown = [showing(thorin, { gp: 5 }), showing(vex, { gp: 5 })]
assert.deepEqual([thorin.system.currency.gp, coinsOf(thorin).gp, vex.system.currency.gp, coinsOf(vex).gp], [45, 40, 17, 12], 'each sheet shows 5 gp more than is stored')
await settle()
unchanged = writes.length
made = await handed('thorin', ['bram'], { gp: 45 })
assert.deepEqual([refusal(made), writes.length], [['failed', 'short', null], unchanged], '45 gp shown, 40 stored: 45 are not his to hand out')
at = writes.length
refusing((what, target) => (what === 'update') && (target === bram))
made = await handed('thorin', ['vex', 'bram', 'lia'], { gp: 10 })
clearFaults()
assert.deepEqual([refusal(made), made.result.transfer.each], [['failed', 'error', 'An update was refused'], ['vex']])
assert.deepEqual(writes.slice(at).map(([, id, changes]) => [id, changes]), [
  ['thorin', { 'system.currency.gp': 10 }], ['vex', { 'system.currency.gp': 22 }],
  ['bram', { 'system.currency.gp': 10 }], ['thorin', { 'system.currency.gp': 30 }],
], "30 gp taken from the 40 he stores, 10 added to the 12 Vex stores, 20 put back on the 10 he then stores")
assert.deepEqual([coinsOf(thorin).gp, thorin.system.currency.gp, coinsOf(vex).gp, vex.system.currency.gp], [30, 35, 22, 27], 'and each sheet still shows 5 gp more')
for (const restore of shown) restore()
assert.deepEqual([thorin.system.currency.gp, vex.system.currency.gp], [30, 22])
okay("a coin a sheet shows more of than its actor stores is handed out only as far as it is stored, and the giver's write, each one's given and the put back are all from what is stored, under either release")

/* -------------------------------------------- */
/*  Whose players                               */
/* -------------------------------------------- */

// Ash, owned by Eve and by Bob: both her players are whispered, and no one else.
restock()
ash.ownership = { default: 0, eve: 3, bob: 3 }
await settle()
made = await handed('thorin', ['ash'], { gp: 1 })
assert.deepEqual(saidBy(made).map(told), [
  ['Ash received 1 gp from Thorin', ['bob', 'eve'], 'thorin', 'alice'], ['Thorin handed out 1 gp each to Ash: 1 gp in all', GMS, 'thorin', 'alice'],
])
// Ash herself, still owned by both and neither's own character, hands out, as a player's own: with
// no one player to write for her, her messages are the bridge's Gamemaster's, so neither of her
// players reads any of them, and the result says so.
stock(ash, [], { gp: 9 })
made = await handed('ash', ['bram'], { gp: 2 })
said = saidBy(made)
assert.deepEqual(said.map(told), [['Bram received 2 gp from Ash', ['carol'], 'ash', 'gm'], ['Ash handed out 2 gp each to Bram: 2 gp in all', GMS, 'ash', 'gm']])
assert.deepEqual([made.result.status, made.result.messageId, made.result.visible, coinsOf(ash).gp, coinsOf(bram).gp], ['done', said.at(-1).id, false, 7, 2])
assert.deepEqual([chatOf(said[0].id).data.message.audience.users, chatOf(said[0].id).data.message.audience.characters, chatOf(said[1].id)], [['carol'], ['bram'], undefined], "Bram's player alone is told of the whisper, and no one of the Gamemasters' message")
// Shared with every player through her default, she's still her own players' alone.
ash.ownership = { default: 3, eve: 3 }
made = await handed('thorin', ['ash'], { gp: 1 })
assert.deepEqual(saidBy(made).map(told)[0], ['Ash received 1 gp from Thorin', ['eve'], 'thorin', 'alice'])
ash.ownership = { default: 0, eve: 3 }
// The Gamemaster's, at Thorin's page: each message flagged theirs, and listed in their result.
made = await handed('thorin', ['vex'], { gp: 1 }, { by: 'gm' })
said = saidBy(made)
assert.deepEqual(said.map(told), [['Vex received 1 gp from Thorin', ['bob'], 'thorin', 'alice'], ['Thorin handed out 1 gp each to Vex: 1 gp in all', GMS, 'thorin', 'alice']])
assert.ok(said.every(message => JSON.stringify(message.flags['sending-stone']) === JSON.stringify({ request: made.command.id, by: 'gm' })))
assert.deepEqual([made.result.messages, made.result.messageId, made.result.visible], [said.map(message => message.id), said.at(-1).id, true])
// The Gamemasters' message stopped by a module's hook: the hand-out is made all the same, the whisper
// to the one given posted, and the result has no message, `visible` true, as for any line that can't
// be posted.
const unposted = Hooks.on('preCreateChatMessage', message => (message.whisper.includes('gm') ? false : undefined))
made = await handed('thorin', ['vex'], { gp: 1 })
Hooks.off('preCreateChatMessage', unposted)
said = saidBy(made)
assert.deepEqual(said.map(told), [['Vex received 1 gp from Thorin', ['bob'], 'thorin', 'alice']], "no Gamemasters' message")
assert.deepEqual([made.result.status, made.result.messageId, made.result.visible, made.result.transfer.each], ['done', null, true, ['vex']])
// Lia, whom no player owns, hands out: her messages are the bridge's Gamemaster's own, so the one
// for the Gamemasters is theirs alone, and no player may see it.
stock(lia, [], { sp: 5 })
await settle()
made = await handed('lia', ['vex', 'bram'], { sp: 2 }, { by: 'gm' })
said = saidBy(made)
assert.deepEqual(said.map(told), [
  ['Vex received 2 sp from Lia', ['bob'], 'lia', 'gm'], ['Bram received 2 sp from Lia', ['carol'], 'lia', 'gm'],
  ['Lia handed out 2 sp each to Vex and Bram: 4 sp in all', GMS, 'lia', 'gm'],
])
assert.deepEqual([made.result.status, made.result.messageId, made.result.visible, purse(lia)], ['done', said.at(-1).id, false, { sp: 1 }])
assert.deepEqual(said.slice(0, 2).map(message => { const { audience } = chatOf(message.id).data.message; return [audience.gmOnly, audience.users, audience.characters] }), [[false, ['bob'], ['vex']], [false, ['carol'], ['bram']]])
assert.equal(chatOf(said.at(-1).id), undefined, "the Gamemasters' own isn't sent to the app")
// Since 0.51.0 Lia, by the Gamemaster, gives the Company alone: its line, for everyone, is the
// bridge's Gamemaster's, listed as theirs, and everyone may read it.
stock(lia, [], { sp: 5 })
await settle()
made = await handed('lia', ['party'], { sp: 2 }, { by: 'gm' })
said = saidBy(made)
assert.deepEqual(said.map(told), [['Gives 2 sp to The Iron Company', [], 'lia', 'gm']])
assert.deepEqual([made.result.status, made.result.messages, made.result.messageId, made.result.visible, purse(lia), coinsOf(party).sp], ['done', [said[0].id], said[0].id, true, { sp: 3 }, 10])
okay("each whisper goes to exactly the character's own players: both of a character two players own, never a player she's only shared with through All Players; the Gamemaster's hand-out, at the giver's page, flags each message `by: \"gm\"` and lists them in the result; a giver with no one player of its own, none owning it or two with neither having it as their character, has the bridge's Gamemaster as its author, so the Gamemasters' message, whispered to both of them still, is theirs alone, the result's `visible` false, a player's own hand-out too, and the app is sent the whispers but not that; a Gamemasters' message a module's hook stops leaves the hand-out made, `messageId` null and `visible` true; Lia's to the Company alone, by the Gamemaster, posts its line for everyone as the bridge's Gamemaster, listed in the result, `visible` true")

/* -------------------------------------------- */
/*  The Gamemaster's hand-out to twenty         */
/* -------------------------------------------- */

// Module 0.53.0: a Gamemaster's hand-out to 20, characters and parties, makes 21 messages, the
// Gamemasters' own last, and lists them all to an app that says `gmRollMessages`; to one that
// doesn't, the first 20, as before, which an app before v0.53.0 would drop whole were it sent 21.
const EXTRAS = Array.from({ length: 14 }, (_, i) => character(`extra${String(i + 1).padStart(2, '0')}`, `Extra ${i + 1}`, ['carol']))
const TWENTY = ['vex', 'bram', 'ash', 'party', 'wardens', 'silent', ...EXTRAS.map(actor => actor.id)]
campaignAs({ characters: [...CAMPAIGN.characters, ...EXTRAS.map(actor => actor.id)] })
app.features = { ...app.features, gmRollMessages: 1 }
await hello()
restock()
await settle()
made = await handed('thorin', TWENTY, { gp: 1 }, { by: 'gm' })
said = saidBy(made)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([said.length, told(said.at(-1))], [21, ['Thorin handed out 1 gp each to Vex, Bram, Ash, The Iron Company, Wardens of the Vale, The Silent Order, Extra 1, Extra 2, Extra 3, Extra 4, Extra 5, Extra 6, Extra 7, Extra 8, Extra 9, Extra 10, Extra 11, Extra 12, Extra 13, and Extra 14: 20 gp in all', GMS, 'thorin', 'alice']])
assert.deepEqual(made.result.messages, said.map(message => message.id), 'all 21, in order')
// More made for it on this client, as a module posting messages of its own here: no more than 21.
const extra = []
const more = (message, _options, userId) => {
  const flags = message.flags?.['sending-stone']
  if ((userId !== game.user.id) || (flags?.by !== 'gm') || !message.whisper?.includes('gm') || extra.length) return
  for (let i = 1; i <= 2; i++) {
    const card = fakeMessage(`handout-extra${i}`, { author: message.author, speaker: message.speaker, flags: { 'sending-stone': { ...flags } } })
    extra.push(card.id)
    Hooks.callAll('createChatMessage', card, {}, game.user.id)
  }
}
Hooks.on('createChatMessage', more)
restock()
await settle()
made = await handed('thorin', TWENTY, { gp: 1 }, { by: 'gm' })
Hooks.off('createChatMessage', more)
said = saidBy(made)
assert.deepEqual([said.length, extra.length, made.result.messages], [21, 2, said.map(message => message.id)], '23 made, the first 21 listed')
/**
 * The hand-out to twenty held at the giver's write past its minute, then let go: its results, the
 * one that it took too long and the late one once it's made, and the messages it made.
 */
const tooLong = async () => {
  restock()
  await settle()
  const giving = hold((target, changes) => (target === thorin) && ('system.currency.gp' in (changes ?? {})))
  const slow = handOut('thorin', TWENTY, { gp: 1 }, { by: 'gm' })
  app.waiting.set('camp-a', [slow])
  app.wake?.()
  await until(() => resultsOf(slow.id).length, 'the result that it took too long')
  giving.release()
  await until(() => resultsOf(slow.id).length === 2, 'the late result')
  return [...resultsOf(slow.id), saidBy({ command: slow })]
}
// A late result is listed as the first: all 21 to this app, none made by the result that it took too long.
{
  const [early, late, lines] = await tooLong()
  assert.deepEqual([early.status, early.reason, early.messages, late.status, lines.length, late.messages],
    ['failed', 'timeout', [], 'done', 21, lines.map(message => message.id)], 'the late result, all 21')
}
// The app's answer is read only as a whole number of 1 or more, as `quiet` is: true, "1", 0 and 1.5
// are listed the first 20; 2, a later format, all 21.
for (const [reads, listed] of [[true, 20], ['1', 20], [0, 20], [1.5, 20], [2, 21]]) {
  app.features = { ...app.features, gmRollMessages: reads }
  await hello()
  restock()
  await settle()
  made = await handed('thorin', TWENTY, { gp: 1 }, { by: 'gm' })
  said = saidBy(made)
  assert.deepEqual([said.length, made.result.messages], [21, said.slice(0, listed).map(message => message.id)], `gmRollMessages ${JSON.stringify(reads)}: ${listed} listed`)
}
// An app that says nothing of it, as one before v0.53.0: the first 20, the Gamemasters' own not among them.
const { gmRollMessages: _reads, ...older } = app.features
app.features = older
await hello()
restock()
await settle()
made = await handed('thorin', TWENTY, { gp: 1 }, { by: 'gm' })
said = saidBy(made)
assert.deepEqual([said.length, made.result.messages], [21, said.slice(0, 20).map(message => message.id)], 'the first 20')
assert.ok(!made.result.messages.includes(said.at(-1).id), "the Gamemasters' own isn't listed")
// Its late result too: the first 20.
{
  const [early, late, lines] = await tooLong()
  assert.deepEqual([early.status, early.reason, early.messages, late.status, lines.length, late.messages],
    ['failed', 'timeout', [], 'done', 21, lines.slice(0, 20).map(message => message.id)], 'the late result, the first 20')
}
campaignAs()
await hello()
for (const actor of EXTRAS) actors.delete(actor.id)
okay("the Gamemaster's hand-out to 20, characters and parties, makes 21 messages, all listed, the Gamemasters' last, to an app that says `gmRollMessages`, a whole number of 1 or more (2 too, never true, \"1\", 0 or 1.5); no more than 21 when more are made; to an app that doesn't, the first 20, as before 0.53.0; a late result, held past its minute, is listed as the first")

/* -------------------------------------------- */
/*  A hand-out that fails                       */
/* -------------------------------------------- */

// Bram's refused, the second, as by a module's preUpdateActor hook: what wasn't given goes back to
// Thorin in one write, in the coins handed out, and Lia is given none.
restock()
stock(thorin, [], RICH)
await settle()
at = writes.length
lines = messages.size
refusing((what, target) => (what === 'update') && (target === bram))
made = await handed('thorin', THREE, EACH)
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'An update was refused'])
assert.deepEqual(made.result.transfer, { from: 'thorin', to: null, items: [], currency: EACH, each: ['vex'], used: null })
assert.deepEqual([purse(thorin), purse(vex), purse(bram), purse(lia)], [{ pp: 487, gp: 100 }, { pp: 200, gp: 62 }, {}, {}], '87 pp and the 400 pp and 100 gp not given')
assert.deepEqual(writes.slice(at).map(([, id, changes]) => [id, changes]), [
  ['thorin', { 'system.currency.pp': 87, 'system.currency.gp': 0 }], ['vex', { 'system.currency.pp': 200, 'system.currency.gp': 62 }],
  ['bram', { 'system.currency.pp': 200, 'system.currency.gp': 50 }], ['thorin', { 'system.currency.pp': 487, 'system.currency.gp': 100 }],
], 'no write of Lia')
assert.deepEqual(saidBy(made).map(told), [
  ['Vex received 200 pp and 50 gp from Thorin', ['bob'], 'thorin', 'alice'],
  ['Thorin handed out 200 pp and 50 gp each to Vex: 200 pp and 50 gp in all', GMS, 'thorin', 'alice'],
], 'only of those given')
assert.equal(messages.size, lines + 2)
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin'], ['character.updated', 'vex']])
// The putting back refused too: what wasn't given is lost, never made twice.
restock()
stock(thorin, [], RICH)
await settle()
let thorinUpdates = 0
refusing((what, target) => (what === 'update') && ((target === bram) || ((target === thorin) && (++thorinUpdates === 2))))
made = await handed('thorin', THREE, EACH)
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'An update was refused / An update was refused'])
assert.deepEqual([made.result.transfer.each, purse(thorin), purse(vex), purse(bram), purse(lia)], [['vex'], { pp: 87 }, { pp: 200, gp: 62 }, {}, {}])
assert.deepEqual(saidBy(made).map(message => told(message)[0]), ['Vex received 200 pp and 50 gp from Thorin', 'Thorin handed out 200 pp and 50 gp each to Vex: 200 pp and 50 gp in all'])
// Thorin's own refused: nothing written, said or sent.
restock()
stock(thorin, [], RICH)
await settle()
lines = messages.size
refusing((what, target) => (what === 'update') && (target === thorin))
made = await handed('thorin', THREE, EACH)
clearFaults()
assert.deepEqual([refusal(made), 'transfer' in made.result, messages.size, sheetsIn(made), purse(thorin), purse(vex)], [['failed', 'error', 'An update was refused'], false, lines, [], RICH, { gp: 12 }])
// Vex's refused, the first: all of it goes back, in the coins handed out; no message, and no one given.
restock()
stock(thorin, [], RICH)
await settle()
lines = messages.size
faults.failUpdate = target => target === vex
made = await handed('thorin', THREE, EACH)
clearFaults()
assert.deepEqual([refusal(made), 'transfer' in made.result, messages.size, purse(thorin), purse(vex), purse(bram)], [['failed', 'error', 'failUpdate of vex refused'], false, lines, { pp: 687, gp: 150 }, { gp: 12 }, {}])
assert.deepEqual(sheetsIn(made), [['character.updated', 'thorin']], "his sheet, whose coins are as much but not the same")
okay('where the second one\'s write is refused, what wasn\'t given goes back to the giver in one write, in the coins handed out (87 pp, then 487 pp and 100 gp), the third given none: `error`, `transfer.each` the first alone, the whisper and the Gamemaster\'s message naming only her; where the put back is refused too, both said and the coins lost, never made twice; where the giver\'s own write is refused, nothing is written, said or sent; where the first one\'s is, all goes back and no message is posted')

/* -------------------------------------------- */
/*  One at a time                               */
/* -------------------------------------------- */

// A hand-out waits for a command of one it gives to, and that one's next waits for it: here Bram's
// spends of a resource, keyed on him, as every roll of his is.
restock()
campaignAs({ rolls: true, attacks: true })
bram.system.resources = { primary: { label: 'Superiority Dice', max: 4, value: 4, sr: true } }
await settle()
const spending = hold((target, changes) => (target === bram) && ('system.resources.primary.value' in (changes ?? {})))
const spend = () => ({ id: `spend-${++ids}`, actorId: 'bram', kind: 'spend', counter: { resource: 'primary' }, count: 1, mode: 0, explicit: false, extras: [], dice: [] })
const [spendAhead, giving, spendBehind] = [spend(), handOut('thorin', ['vex', 'bram'], { gp: 5 }), spend()]
const queuedAt = writes.length
app.waiting.set('camp-a', [spendAhead, giving, spendBehind])
app.wake?.()
await until(() => spending.held, "Bram's spend")
await wait(100)
assert.ok(!writes.slice(queuedAt).some(([what, id]) => (what === 'updateActor') && (id === 'thorin')), 'the hand-out waits')
assert.equal(resultsOf(giving.id).length, 0)
spending.release()
await until(() => [spendAhead, giving, spendBehind].every(command => resultsOf(command.id).length), 'all three')
assert.deepEqual([spendAhead, giving, spendBehind].map(command => resultsOf(command.id)[0].status), ['done', 'done', 'done'])
const givenAt = writes.findLastIndex(([what, id, changes]) => (what === 'updateActor') && (id === 'bram') && ('system.currency.gp' in changes))
const spentAt = writes.findLastIndex(([what, id, changes]) => (what === 'updateActor') && (id === 'bram') && ('system.resources.primary.value' in changes))
assert.ok(spentAt > givenAt, "Bram's next spend after his coins")
assert.ok(resultIndex(spendBehind.id) > resultIndex(giving.id))
campaignAs()
// A hand-out and coins taken away of the same gold, fetched together: the second finds what's left.
restock()
await settle()
const [sooner, later] = await fetched(handOut('thorin', ['vex', 'bram'], { gp: 15 }), taking('thorin', { gp: 30 }))
assert.deepEqual([sooner.result.status, refusal(later), purse(thorin)], ['done', ['failed', 'short', null], { gp: 10 }])
const [earlier, afterwards] = await fetched(handOut('thorin', ['vex'], { gp: 6 }), handOut('thorin', ['bram'], { gp: 6 }))
assert.deepEqual([earlier.result.status, refusal(afterwards), purse(thorin)], ['done', ['failed', 'short', null], { gp: 4 }])
okay("a hand-out waits for a command of a character it gives to, and that one's next waits for it, as it's keyed on each of them; a hand-out and coins taken away of the same gold, or two hand-outs, are made one after the other, the second `short` where too little is left")

// Since 0.51.0 a hand-out to a party waits for a move of the party's fetched ahead of it, held at
// its write of the party, and a move of the party's fetched after it waits for it: the second send
// finds the gold the hand-out gave, which it needs. The sends are the Gamemaster's, as Vex and as
// Bram, so that the party is all the hand-out shares with them: the order is held by the one line
// every move stands in, and by the party's own key, which the hand-out takes as it does each
// character's.
restock()
await settle()
{
  const sending = hold((target, changes) => (target === party) && ('system.currency.gp' in (changes ?? {})))
  const [sendAhead, giving, sendBehind] = [
    move('vex', { from: 'party', to: 'vex', currency: { gp: 100 } }, { by: 'gm' }),
    handOut('thorin', ['party'], { gp: 5 }),
    move('bram', { from: 'party', to: 'bram', currency: { gp: 8 } }, { by: 'gm' }),
  ]
  const queued = writes.length
  app.waiting.set('camp-a', [sendAhead, giving, sendBehind])
  app.wake?.()
  await until(() => sending.held, "the send's write of the Company")
  await wait(100)
  assert.ok(!writes.slice(queued).some(([what, id]) => (what === 'updateActor') && (id === 'thorin')), 'the hand-out waits')
  assert.deepEqual([resultsOf(giving.id).length, resultsOf(sendBehind.id).length], [0, 0])
  sending.release()
  await until(() => [sendAhead, giving, sendBehind].every(command => resultsOf(command.id).length), 'all three')
  assert.deepEqual([sendAhead, giving, sendBehind].map(command => resultsOf(command.id)[0].status), ['done', 'done', 'done'])
  assert.ok((resultIndex(sendAhead.id) < resultIndex(giving.id)) && (resultIndex(giving.id) < resultIndex(sendBehind.id)), 'in the order fetched')
  assert.deepEqual([coinsOf(party).gp, purse(thorin), purse(vex), purse(bram)], [COMPANY_GP - 103, { gp: 35 }, { gp: 112 }, { gp: 8 }])
}
// The party's key itself: a hand-out to it alone, held at its write of the party, keeps the party's
// queue busy, as each character's it gives to, until it's made.
restock()
await settle()
{
  const giving = hold((target, changes) => (target === party) && ('system.currency.gp' in (changes ?? {})))
  const alone = handOut('thorin', ['party'], { gp: 2 })
  app.waiting.set('camp-a', [alone])
  app.wake?.()
  await until(() => giving.held, "the hand-out's write of the Company")
  assert.deepEqual([queueBusy('thorin'), queueBusy('party')], [true, true], "the giver's queue and the party's")
  giving.release()
  await until(() => resultsOf(alone.id).length, "the hand-out's result")
  await settle()
  assert.deepEqual([resultsOf(alone.id)[0].status, queueBusy('thorin'), queueBusy('party')], ['done', false, false])
}
okay("a hand-out to the Company waits for the Gamemaster's send of the Company's fetched ahead of it, and a send fetched after it waits for it, finding the 5 gp it gave: the party's queue is busy while a hand-out to it is made, as each character's is")

// The campaign is read again as a hand-out's turn comes, not as it was when fetched: one waiting in
// the line of moves behind another's move while the Gamemaster turns Pay with other coins off is
// made by the setting as it then is, and with moves turned off meanwhile it isn't made.
for (const [change, reason, why] of [[{ coinChange: false }, 'short', 'Pay with other coins turned off'], [{ transfers: false }, 'transfers-off', 'moves turned off']]) {
  restock()
  stock(thorin, [], { pp: 2, gp: 3 })
  stock(ash, [], { gp: 10 })
  await settle()
  const ahead = hold(target => target === ash)
  const [moving, waiting] = [move('ash', { from: 'ash', to: 'lia', currency: { gp: 1 } }), handOut('thorin', ['vex', 'bram'], { gp: 2 })]
  unchanged = writes.length
  lines = messages.size
  app.waiting.set('camp-a', [moving, waiting])
  app.wake?.()
  await until(() => ahead.held, "the move ahead's write")
  await wait(100)
  assert.equal(resultsOf(waiting.id).length, 0, 'the hand-out waits')
  campaignAs(change)
  ahead.release()
  await until(() => resultsOf(waiting.id).length, "the hand-out's result")
  assert.deepEqual([resultsOf(moving.id)[0].status, refusal({ result: resultsOf(waiting.id)[0] }), purse(thorin), purse(vex)], ['done', ['failed', reason, null], { pp: 2, gp: 3 }, { gp: 12 }], why)
  assert.ok(!writes.slice(unchanged).some(([, id]) => ['thorin', 'vex', 'bram'].includes(id)) && (messages.size === lines + 1), 'nothing of it written or posted')
  campaignAs()
}
made = await handed('thorin', ['vex', 'bram'], { gp: 2 })
assert.deepEqual([made.result.status, purse(thorin)], ['done', { pp: 1, gp: 9 }], 'and made as before once both are on again')
okay("the campaign is read again as a hand-out's turn comes: one that needs another coin, waiting behind a move while Pay with other coins is turned off, is `short`, and one waiting while moves are turned off `transfers-off`, with nothing written or posted")

/* -------------------------------------------- */
/*  Names with markup                           */
/* -------------------------------------------- */

restock()
await settle()
thorin.name = 'Thorin <b>&</b>'
vex.name = 'Vex <i>'
made = await handed('thorin', ['vex'], { gp: 1 })
assert.deepEqual(saidBy(made).map(message => told(message)[0]), [
  'Vex &lt;i&gt; received 1 gp from Thorin &lt;b&gt;&amp;&lt;/b&gt;', 'Thorin &lt;b&gt;&amp;&lt;/b&gt; handed out 1 gp each to Vex &lt;i&gt;: 1 gp in all',
])
// Since 0.51.0 a party's too, in its line for everyone and in the Gamemasters' message.
party.name = 'The <b>Company</b>'
made = await handed('thorin', ['vex', 'party'], { gp: 1 })
assert.deepEqual(saidBy(made).map(message => told(message)[0]), [
  'Vex &lt;i&gt; received 1 gp from Thorin &lt;b&gt;&amp;&lt;/b&gt;', 'Gives 1 gp to The &lt;b&gt;Company&lt;/b&gt;',
  'Thorin &lt;b&gt;&amp;&lt;/b&gt; handed out 1 gp each to Vex &lt;i&gt; and The &lt;b&gt;Company&lt;/b&gt;: 2 gp in all',
])
party.name = 'The Iron Company'
thorin.name = 'Thorin'
vex.name = 'Vex'
okay('every name is escaped in the whispers, the Gamemasters\' message and, since 0.51.0, a party\'s line')

// ---- END ----
console.log(`handouts${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
