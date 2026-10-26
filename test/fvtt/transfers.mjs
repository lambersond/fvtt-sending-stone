// Moving items and coins from the app (module 0.31.0, its contract §2-§4, §4.10): the hello's
// `features.transfers`, the fetching it needs, apart from the rolls; the `transfer` command's
// checks, who may move what, items whole and in part, stacking, containers and their contents, coins
// (fractional under dnd5e 6), what's written in which order and what a failure leaves, the line in
// chat, the sheets ahead of the result, and two moves at once; Manage Campaigns' switch and the
// settings report's rows. The real module and its language file, dnd5e 5.3.3's real dice classes
// for its self-test, a stand-in Foundry core and app; the actors' items as Foundry's embedded
// documents, firing its hooks, with dnd5e's own createWithContents read from its source, 5.3.3's or
// with DND5E6=1 6.0.5's, whose coins may be fractional. Timers of a second or more run a hundred
// times faster, so the 60 s watchdog fires in 600 ms. Run with SLIM_CHECK=1 and
// --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settings, user, users, actors } from './stub.mjs'
import { click, find, openSettings, save, tick, view } from './settings-app.mjs'

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
for (const [id, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['cara', 'Cara'], ['dave', 'Dave'], ['eve', 'Eve']]) user(id, name)

/** A character, as dnd5e's, with its items and coins. */
function character(id, name, owners, { items = [], coins = {} } = {}) {
  const actor = new Actor5e({ id, name, owners })
  equip(actor, { items: [] })
  actor.documentName = 'Actor'
  actor.coins = coins
  actors.set(id, embed(actor, items))
  return actor
}
/** A Group actor, as dnd5e 5.3.3 prepares one (data/actor/group.mjs:148-172), with its items and coins. */
function group(id, name, { members = [], ownership = {}, items = [], coins = {} } = {}) {
  const list = members.map(member => ({ actor: member }))
  Object.defineProperty(list, 'ids', { value: new Set(members.map(member => member.id)), enumerable: false })
  const g = {
    documentName: 'Actor', id, name, type: 'group', uuid: `Actor.${id}`, img: `${id}.webp`, flags: {},
    ownership: { default: 0, ...ownership },
    system: { members: list, description: { full: '', summary: '' } },
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
const itemData = (name, type, system = {}, { id, source, legacySource, effects = [], ...fields } = {}) => ({
  _id: id ?? nextId(name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 8) || 'item'),
  name, type, img: 'icons/item.webp', sort: 0, flags: legacySource ? { core: { sourceId: legacySource } } : {},
  _stats: source ? { compendiumSource: source } : {}, effects,
  system: { quantity: 1, identified: true, description: { value: '' }, weight: { value: 1, units: 'lb' }, ...system },
  ...fields,
})
const potion = (quantity, fields = {}, options = {}) => itemData('Potion of Healing', 'consumable',
  { quantity, uses: { max: 1, spent: 0, recovery: [] }, ...fields }, { source: POTION, ...options })

const thorin = character('thorin', 'Thorin', ['alice'], { coins: { gp: 15 } })
const vex = character('vex', 'Vex', ['bob'], { coins: { gp: 3 } })
// Two player owners: Cara observes the party, Dave owns it; the higher counts (groups.mjs).
const twin = character('twin', 'Twin', ['cara', 'dave'])
// No player owner: a group's default counts.
const ghost = character('ghost', 'Ghost', [])
const stranger = character('stranger', 'Stranger', ['eve'])
const party = group('party', 'The Iron Company', {
  members: [thorin, vex], ownership: { alice: 3, bob: 2, cara: 2, dave: 3 },
  coins: { gp: DND5E6 ? 120.5 : 120, sp: 7 },
})
const silent = group('silent', 'The Silent Order', { members: [vex] })
const hall = group('hall', 'Open Hall', { ownership: { default: 3 } })
const lost = group('lost', 'The Lost Band', { ownership: { alice: 3 } })
let primary = 'party'
Object.defineProperty(actors, 'party', { get: () => actors.get(primary) ?? null, configurable: true })
users.get('alice').character = thorin
users.get('bob').character = vex

/* -------------------------------------------- */
/*  The app                                     */
/* -------------------------------------------- */

const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, transfers: 1, groups: 1 }, wait: 0 }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    if (body.type === 'bridge.hello') app.helloAt = performance.now()
    return announcing ? json({ features: app.features }) : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.polls.push({ at: performance.now(), body })
    const id = body.campaign.id
    if (!app.waiting.get(id)?.length) {
      // An app that answers at once, asking the module to wait, as before a hello is applied.
      if (app.wait) return json({ commands: [], wait: app.wait })
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
/** A move as the app hands it over: one of the module's own actors, an end of it. */
const move = (actorId, transfer, fields = {}) => ({
  id: `move-${++ids}`, actorId, kind: 'transfer', transfer, mode: 0, explicit: false, extras: [], dice: [], ...fields,
})
/** Hand the module commands in one fetch; resolve once each has its result, with what was posted meanwhile and the lines it made. */
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

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
const CAMPAIGN = { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'twin', 'ghost'], groups: ['party', 'silent', 'hall'], rolls: false, attacks: false, transfers: true }
const campaignAs = (change = {}) => settings.set('campaigns', [{ ...CAMPAIGN, ...change }])
campaignAs()
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { transferFeatures } = await import(`${MODULE}/scripts/command-transfers.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const { foundrySettings } = await import(`${MODULE}/scripts/foundry-settings.mjs`)
await until(() => app.events.some(e => e.type === 'bridge.hello'), 'the hello')
await wait(60)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
await until(() => app.events.some(e => e.type === 'bridge.hello'), 'the hello')
await wait(60)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.ok(characterSheet(thorin)?.inventory, 'a character sheet, as dnd5e has it')

/** Give an actor these items, and these coins, in place of what it had. */
function stock(actor, items = [], coins = null) {
  actor.items.clear()
  for (const data of items) actor.items.set(data._id, new HarnessItem(data, actor))
  if (coins) {
    actor._source.system.currency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...coins }
    actor.prepareCurrency()
  }
}
/** What an actor holds: each item's name, quantity as stored and container. */
const holds = actor => actor.items.map(item => [item.name, item._source.system.quantity, item._source.system.container ?? null])
const settle = () => wait(320)
const T = (from, to, parts) => ({ from, to, ...parts })
const one = (item, quantity = 1) => ({ items: [{ id: item._id ?? item.id, quantity }] })
const helloOf = () => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).at(-1)

/* -------------------------------------------- */
/*  Features                                    */
/* -------------------------------------------- */

assert.deepEqual(helloOf().data.features.transfers, { enabled: true, kinds: ['transfer'], reason: null, partySends: true, distribute: true })
assert.equal(helloOf().data.features.rolls.enabled, false, "the campaign's rolls are off")
const [campaign] = getCampaigns()
assert.equal(campaign.transfers, true)
assert.deepEqual(transferFeatures({ ...campaign, transfers: false }), { enabled: false, kinds: [], reason: 'off', partySends: false, distribute: false })
game.system.id = 'pf2e'
assert.deepEqual(transferFeatures(campaign), { enabled: false, kinds: [], reason: 'system', partySends: false, distribute: false })
game.system.id = 'dnd5e'
// Apart from the rolls and the dice: whatever they are.
diceStatus.ready = false
assert.deepEqual(transferFeatures({ ...campaign, rolls: true }), { enabled: true, kinds: ['transfer'], reason: null, partySends: true, distribute: true })
diceStatus.ready = true
campaignAs({ transfers: false })
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(helloOf().data.features.transfers, { enabled: false, kinds: [], reason: 'off', partySends: false, distribute: false })
campaignAs({ transfers: undefined })
assert.equal(getCampaigns()[0].transfers, false, 'a campaign saved before 0.31.0: off')
campaignAs()
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(helloOf().data.features.transfers, { enabled: true, kinds: ['transfer'], reason: null, partySends: true, distribute: true })
okay("the hello's features.transfers says whether players' moves are made here: off, under another system, or on, with the kind `transfer`, and since 0.32.0 whether a party's things may be sent and distributed, both with it; apart from the rolls and the dice; a campaign saved before reads as off")

/* -------------------------------------------- */
/*  Fetching                                    */
/* -------------------------------------------- */

const polling = async () => { const before = app.polls.length; await wait(150); return app.polls.length > before }
assert.equal(await polling(), true, 'fetched for moves alone, with rolls off')
for (const [features, why] of [
  [{ commands: true, transfers: true }, 'transfers: true'], [{ commands: true, transfers: '1' }, 'transfers: "1"'],
  [{ commands: true }, 'an answer without transfers'], [{ transfers: 1 }, 'without commands'],
]) {
  app.features = { ...features, groups: 1 }
  announce({ campaignId: 'camp-a' })
  await settle()
  assert.equal(await polling(), false, why)
}
app.features = { commands: true, transfers: 1, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), true, 'fetched again once the answer says so')
// A roll fetched while only moves are, as the app wouldn't hand over: refused as made while rolls are off.
const roll = (await fetched({ id: `roll-${++ids}`, actorId: 'thorin', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }] }))[0]
assert.deepEqual(refusal(roll), ['failed', 'off', null])
okay("with rolls off, a campaign whose players move things is fetched for only after an answer with features.transfers 1 and commands; true, \"1\" or none don't count, and an answer without it stops the fetching; a roll fetched then is refused, off")

// The wake: a fetch answered before the hello was applied, asking for a minute's wait, is made again
// once the hello is answered, not a minute later.
app.wait = 60_000
let asked = app.polls.length
await until(() => app.polls.length > asked, 'a fetch asked to wait')
await wait(50)
app.helloAt = null
app.wait = 0
asked = app.polls.length
announce({ campaignId: 'camp-a' })
await until(() => app.helloAt !== null, "the hello's answer")
await until(() => app.polls.length > asked, 'the next fetch', 1000)
const gap = app.polls[asked].at - app.helloAt
assert.ok(gap < 50, `the next fetch followed the hello's answer by ${Math.round(gap)} ms`)
await settle()
okay(`a fetch answered "wait a minute" before the hello was applied is made again as the hello is answered, ${Math.round(gap)} ms later`)

// Not fetched for while the switch is off, or under another system, whatever the app takes; rolls off.
campaignAs({ transfers: false })
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), false, 'the switch off')
campaignAs()
game.system.id = 'pf2e'
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), false, 'another system')
game.system.id = 'dnd5e'
// The first answer to say the app takes moves, a hello's, starts the fetching at once: it's noted
// before the pollers are synced, with no heartbeat to wait for.
app.features = { commands: true, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), false, 'an answer without transfers')
app.features = { commands: true, transfers: 1, groups: 1 }
app.helloAt = null
asked = app.polls.length
announce({ campaignId: 'camp-a' })
await until(() => app.helloAt !== null, "the hello's answer")
await until(() => app.polls.length > asked, 'the first fetch', 1000)
const started = app.polls[asked].at - app.helloAt
assert.ok(started < 50, `the first fetch followed the hello's answer by ${Math.round(started)} ms`)
await settle()
okay(`not fetched for with the switch off or under another system, though the app takes moves; fetched from the very answer that first says it does, ${Math.round(started)} ms after it`)

/* -------------------------------------------- */
/*  The command                                 */
/* -------------------------------------------- */

const rope = itemData('Rope', 'loot', { quantity: 5 }, { id: 'rope000000000001' })
stock(party, [rope], { gp: 120, sp: 7 })
stock(thorin, [], { gp: 15 })
let unchanged = writes.length
const take = (transfer, fields) => sent('thorin', { from: 'party', to: 'thorin', ...transfer }, fields)
for (const [transfer, fields, error] of [
  [one(rope), { item: 'rope000000000001' }, 'transfer'],
  [{ item: { id: rope._id, quantity: 1 } }, {}, 'transfer'],
  [{ ...one(rope), extra: true }, {}, 'transfer'],
  [{ ...one(rope), from: '' }, {}, 'transfer'],
  [{ ...one(rope), from: 'x'.repeat(65) }, {}, 'transfer'],
  [{ ...one(rope), from: 'thorin' }, {}, 'transfer'],
  [{}, {}, 'transfer'],
  [{ items: null, currency: null }, {}, 'transfer'],
  [{ items: [] }, {}, 'items'],
  [{ items: Array.from({ length: 11 }, (_, n) => ({ id: `rope00000000000${n}`, quantity: 1 })) }, {}, 'items'],
  [{ items: [{ id: rope._id, quantity: 1 }, { id: rope._id, quantity: 1 }] }, {}, 'items'],
  [one(rope, 0), {}, 'items'],
  [one(rope, 10_000_001), {}, 'items'],
  [one(rope, 1.5), {}, 'items'],
  [{ items: [{ id: rope._id, quantity: 1, container: null }] }, {}, 'items'],
  [{ items: [{ id: rope._id }] }, {}, 'items'],
  [{ items: 'rope' }, {}, 'items'],
  [{ currency: {} }, {}, 'currency'],
  [{ currency: { zz: 1 } }, {}, 'currency'],
  [{ currency: { gp: 0 } }, {}, 'currency'],
  [{ currency: { gp: 10_000_001 } }, {}, 'currency'],
  [{ currency: [5] }, {}, 'currency'],
  [one(rope), { mode: 1 }, 'dice'],
  [one(rope), { dice: [{ faces: 20, results: [3] }] }, 'dice'],
  [one(rope), { by: 'x' }, 'by'],
]) {
  assert.deepEqual(refusal(await take(transfer, fields)), ['failed', 'invalid', error], JSON.stringify({ transfer, fields }))
}
for (const [transfer, why] of [['rope', 'a string'], [null, 'null'], [[1], 'a list']]) {
  assert.deepEqual(refusal(await sent('thorin', transfer)), ['failed', 'invalid', 'transfer'], why)
}
// The most there may be, a coin and an item, passes as a command; there's none so many to move.
assert.deepEqual(refusal(await take({ ...one(rope, 10_000_000), currency: { gp: 10_000_000 } })), ['failed', 'short', null])
assert.equal(writes.length, unchanged, 'nothing written')
okay("refuses a move that names a roll's field, `item` in place of `items`, a field of its own besides from, to, items and currency, an end that isn't an id or is the other, nothing to move; 0 or 11 items, a repeated one, 0 or more than 10,000,000 of one, an entry of more or less than id and quantity; no coins, an unknown coin, 0 or too many of one; and dice: each `invalid` with its word")

/* -------------------------------------------- */
/*  Who may move what                           */
/* -------------------------------------------- */

const lamp = () => itemData('Lamp', 'loot', {}, { id: 'lamp000000000001' })
stock(party, [lamp()], { gp: 120 })
stock(silent, [itemData('Mask', 'loot', {}, { id: 'mask000000000001' })], { gp: 30 })
stock(hall, [itemData('Bell', 'loot', {}, { id: 'bell000000000001' })], { gp: 5 })
stock(lost, [lamp()], { gp: 5 })
stock(stranger, [lamp()], { gp: 5 })
const L = { items: [{ id: 'lamp000000000001', quantity: 1 }] }
unchanged = writes.length
for (const [actorId, transfer, fields, reason, why] of [
  ['thorin', T('stranger', 'thorin', L), {}, 'unknown', 'a character not in the campaign'],
  ['thorin', T('nobody0000000001', 'thorin', L), {}, 'unknown', 'a deleted actor'],
  ['thorin', T('lost', 'thorin', L), {}, 'unknown', 'a group the campaign doesn\'t list'],
  ['thorin', T('lost', 'thorin', L), { by: 'gm' }, 'unknown', 'a group the campaign doesn\'t list, for the Gamemaster'],
  ['party', T('party', 'thorin', L), {}, 'not-yours', 'a take made as the group'],
  ['thorin', T('vex', 'party', L), {}, 'not-yours', 'a player giving from another character'],
  ['thorin', T('vex', 'thorin', L), {}, 'not-yours', "a player taking from another's character"],
  ['thorin', T('silent', 'thorin', { items: [{ id: 'mask000000000001', quantity: 1 }] }), {}, 'unknown', 'a group their character can\'t see'],
  ['thorin', T('thorin', 'silent', { currency: { gp: 1 } }), {}, 'unknown', 'giving to a group their character can\'t see'],
  ['vex', T('party', 'vex', L), {}, 'not-owner', 'Observer'],
  ['vex', T('vex', 'party', { currency: { gp: 1 } }), {}, 'not-owner', 'Observer, giving'],
  ['ghost', T('party', 'ghost', L), {}, 'unknown', "a character no player owns, the group's default None"],
]) {
  const made = await sent(actorId, transfer, fields)
  assert.deepEqual(refusal(made), ['failed', reason, null], why)
  assert.deepEqual(sheetsIn(made), [], `${why}: no sheet sent`)
}
assert.equal(writes.length, unchanged, 'nothing written')
okay("refuses as `unknown` an end not in the campaign, deleted, or a group it doesn't list, and a group the player's character can't see; a take made as the group, and a player's move of another's character's things, as `not-yours`; Observer as `not-owner`; none sends a sheet; group to group, and an actorId that isn't an end, are now the Gamemaster's and an Owner's to send")

// Since 0.32.0 (its contract §11.3.1), made where 0.31.0 refused them `not-yours`: the Gamemaster's
// group to group, the Gamemaster's as a character that isn't an end, and an Owner's from the party
// to another character. Each a Sends line, as the character it's made as; the two ends' sheets, the
// party's first, and not the sender's where it isn't an end.
for (const [actorId, to, fields, author, why] of [
  ['thorin', 'silent', { by: 'gm' }, 'alice', 'the Gamemaster, group to group'],
  ['vex', 'thorin', { by: 'gm' }, 'bob', "the Gamemaster on Vex's page, party to Thorin"],
  ['thorin', 'vex', {}, 'alice', 'Thorin, an Owner, party to Vex'],
]) {
  stock(party, [lamp()], { gp: 120 })
  stock(silent, [], { gp: 30 })
  stock(thorin, [], { gp: 15 })
  stock(vex, [], { gp: 3 })
  await settle()
  const sends = await sent(actorId, T('party', to, L), fields)
  assert.equal(sends.result.status, 'done', `${why}: ${JSON.stringify(sends.result)}`)
  const receiver = actors.get(to)
  assert.equal(sends.line.content, `<p>Sends 1 Lamp from The Iron Company to ${receiver.name}</p>`, why)
  assert.deepEqual([sends.line.speaker.actor, sends.line.author.id], [actorId, author], `${why}: as ${actorId}`)
  assert.deepEqual(sends.line.flags['sending-stone'], { request: sends.command.id, ...((fields.by === 'gm') && { by: 'gm' }) }, why)
  assert.deepEqual([holds(receiver).map(([name]) => name), party.items.size], [['Lamp'], 0], why)
  // The Silent Order, which no campaign character may see, goes without its sheet, as it was told.
  assert.deepEqual(sheetsIn(sends).slice(0, 2), [['group.updated', 'party'], ...((to === 'silent') ? [] : [['character.updated', to]])], why)
  if (actorId !== to) assert.ok(!sheetsIn(sends).some(([, id]) => id === actorId), `${why}: the sender's sheet isn't sent`)
}
// The stock the checks after these were written for.
stock(party, [lamp()], { gp: 120 })
stock(silent, [itemData('Mask', 'loot', {}, { id: 'mask000000000001' })], { gp: 30 })
okay("since 0.32.0 the Gamemaster's group to group, the Gamemaster's as a character that isn't an end, and an Owner's from the party to another character are made: \"Sends 1 Lamp from The Iron Company to …\", as the character it's made as, the Gamemaster's flagged; the party's sheet and the receiver's ahead of the result (a party no one may see has no sheet to send), never the sender's that isn't an end")

// Owner through the higher of two player owners; a character no player owns, by the group's default.
let made = await sent('twin', T('party', 'twin', L))
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
made = await sent('ghost', T('hall', 'ghost', { items: [{ id: 'bell000000000001', quantity: 1 }] }))
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
// A send needs nothing of the receiver.
stock(thorin, [lamp()], { gp: 15 })
made = await sent('thorin', T('thorin', 'ghost', L))
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(holds(ghost).map(([name]) => name), ['Bell', 'Lamp'])
okay("a player takes from a party their character's players own: Owner through either of two player owners, the higher counting; a character no player owns, by the group's default Owner; and sends to a character that's no one's")

// The Gamemaster: anything between the campaign's characters and groups, as long as the switch is on.
made = await sent('vex', T('silent', 'vex', { items: [{ id: 'mask000000000001', quantity: 1 }] }), { by: 'gm' })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
// With the switch off, the campaign's rolls keep the fetching going: the move itself is refused.
campaignAs({ transfers: false, rolls: true })
assert.deepEqual(refusal(await sent('vex', T('vex', 'party', { currency: { gp: 1 } }), { by: 'gm' })), ['failed', 'transfers-off', null])
assert.deepEqual(refusal(await sent('thorin', T('thorin', 'party', { currency: { gp: 1 } }))), ['failed', 'transfers-off', null])
campaignAs({ rolls: true })
game.system.id = 'pf2e'
assert.deepEqual(refusal(await sent('vex', T('vex', 'party', { currency: { gp: 1 } }), { by: 'gm' })), ['failed', 'off', null])
game.system.id = 'dnd5e'
campaignAs()
okay("the Gamemaster moves anything between the campaign's characters and groups, needing no one's ownership; refused `transfers-off` with the switch off, theirs as a player's, and `off` under another system")

/* -------------------------------------------- */
/*  Items                                       */
/* -------------------------------------------- */

const writesSince = from => writes.slice(from).filter(([what]) => what !== 'updateActor' || true)
const onlyItem = actor => { assert.equal(actor.items.size, 1, holds(actor).join(' ')); return actor.items.first() }
const giveParty = (items, fields) => sent('thorin', T('thorin', 'party', { items }), fields)
const takeThorin = (items, fields) => sent('thorin', T('party', 'thorin', { items }), fields)

// Whole: a copy with a new id, then the original deleted.
stock(party, [itemData('Rope', 'loot', { quantity: 2 }, { id: 'rope000000000002' })])
stock(thorin, [])
let at = writes.length
made = await takeThorin([{ id: 'rope000000000002', quantity: 2 }])
let copy = onlyItem(thorin)
assert.deepEqual(made.result.transfer, { from: 'party', to: 'thorin', items: [{ id: 'rope000000000002', quantity: 2, created: copy.id, stacked: null }], currency: null })
assert.notEqual(copy.id, 'rope000000000002')
assert.deepEqual([copy.name, copy._source.system.quantity, copy._source.system.container], ['Rope', 2, null])
assert.equal(party.items.size, 0)
assert.deepEqual(writes.slice(at).map(([what, id]) => [what, id]), [['create', 'thorin'], ['delete', 'party']], 'the copy first')
okay('a whole stack is copied to its receiver under a new id, then deleted from its giver')

// Part: the origin keeps the rest under the same id, taken first; the part a new item.
stock(party, [itemData('Rope', 'loot', { quantity: 5 }, { id: 'rope000000000003' })])
stock(thorin, [])
at = writes.length
made = await takeThorin([{ id: 'rope000000000003', quantity: 2 }])
copy = onlyItem(thorin)
assert.deepEqual(holds(party), [['Rope', 3, null]])
assert.equal(party.items.first().id, 'rope000000000003')
assert.deepEqual([copy._source.system.quantity, made.result.transfer.items[0].created], [2, copy.id])
assert.deepEqual(writes.slice(at).map(([what, id, changes]) => [what, id, (what === 'updateItem') ? changes : undefined]),
  [['updateItem', 'rope000000000003', { 'system.quantity': 3 }], ['create', 'thorin', undefined]], 'the giver\'s stack first')
okay('part of a stack: the giver keeps the rest under its own id, taken before the part is made on the receiver')

// Stacking: an identified consumable of the same source and name, at the top.
stock(party, [potion(3, {}, { id: 'potp000000000001' })])
stock(thorin, [potion(1, {}, { id: 'pott000000000001' })])
made = await takeThorin([{ id: 'potp000000000001', quantity: 2 }])
assert.deepEqual(made.result.transfer.items, [{ id: 'potp000000000001', quantity: 2, created: null, stacked: 'pott000000000001' }])
assert.deepEqual([holds(thorin), holds(party)], [[['Potion of Healing', 3, null]], [['Potion of Healing', 1, null]]])
// And all of a stack: the giver's deleted.
made = await takeThorin([{ id: 'potp000000000001', quantity: 1 }])
assert.deepEqual([made.result.transfer.items[0].stacked, holds(thorin), party.items.size], ['pott000000000001', [['Potion of Healing', 4, null]], 0])
// The legacy source flag stacks as dnd5e's does.
stock(party, [potion(1, {}, { id: 'potp000000000002', source: null, legacySource: POTION })])
stock(thorin, [potion(1, {}, { id: 'pott000000000002', source: null, legacySource: POTION })])
made = await takeThorin([{ id: 'potp000000000002', quantity: 1 }])
assert.equal(made.result.transfer.items[0].stacked, 'pott000000000002')
okay("a consumable joins the receiver's stack of the same source and name, as dnd5e's drop stacks it, by compendium source or the legacy source flag: part of a stack or all of it, the giver's deleted")

const UNIDENTIFIED = { identified: false, unidentified: { name: 'Strange Vial', description: '' } }
const ENCHANTED = [{ _id: 'ench000000000001', name: 'Blessed', type: 'enchantment', changes: [] }]
const neverStacks = [
  ['the moved one unidentified', { system: UNIDENTIFIED }, {}],
  ['the receiver\'s unidentified', {}, { system: UNIDENTIFIED }],
  ['the moved one with a use spent', { system: { uses: { max: 1, spent: 1, recovery: [] } } }, {}],
  ['the moved one enchanted', { effects: ENCHANTED }, {}],
  ['the receiver\'s enchanted', {}, { effects: ENCHANTED }],
  ['another source', { source: 'Compendium.dnd5e.items.Item.other' }, {}],
  ['another name at the source', {}, { name: 'Healing Draught' }],
  ['not a consumable', { type: 'loot' }, { type: 'loot' }],
  ['the receiver\'s in a container', {}, { system: { container: 'pack000000000009' } }],
]
for (const [why, moved, theirs] of neverStacks) {
  const data = (fields, id) => {
    const made = potion(1, fields.system ?? {}, { id, ...(('source' in fields) && { source: fields.source }), ...(fields.effects && { effects: fields.effects }) })
    if (fields.type) made.type = fields.type
    if (fields.name) made.name = fields.name
    return made
  }
  stock(party, [data(moved, 'potp000000000003')])
  stock(thorin, [data(theirs, 'pott000000000003'), itemData('Pack', 'container', {}, { id: 'pack000000000009' })])
  made = await takeThorin([{ id: 'potp000000000003', quantity: 1 }])
  assert.equal(made.result.status, 'done', why)
  assert.deepEqual([made.result.transfer.items[0].stacked, typeof made.result.transfer.items[0].created], [null, 'string'], why)
  assert.equal(thorin.items.get('pott000000000003')._source.system.quantity, 1, `${why}: the receiver's as it was`)
  assert.equal(thorin.items.size, 3, why)
}
const vial = thorin.items.find(item => item.id !== 'pott000000000003' && item.type !== 'container')
assert.equal(vial._source.system.quantity, 1)
okay(`never stacks where ${neverStacks.map(([why]) => why).join(', ')}: a new item, the receiver's left as it was`)

// What a copy keeps and loses: as dnd5e's drop, unequipped and unattuned, and so all it holds.
const effect = { _id: 'glow000000000001', name: 'Glow', type: 'base', transfer: true, changes: [{ key: 'system.attributes.ac.bonus', value: '1', mode: 2 }] }
stock(thorin, [
  itemData('Backpack', 'container', { equipped: true }, { id: 'pack000000000001' }),
  itemData('Ring of Warmth', 'equipment', { container: 'pack000000000001', equipped: true, attuned: true, attunement: 'required', uses: { max: 3, spent: 1, recovery: [] } }, { id: 'ring000000000001', source: 'Compendium.dnd5e.items.Item.ring', effects: [effect] }),
  itemData('Wagon', 'equipment', { container: 'pack000000000001', crew: { value: 2, max: 4 } }, { id: 'wagn000000000001' }),
  itemData('Longsword', 'weapon', { equipped: true, prepared: true }, { id: 'swrd000000000001', legacySource: 'Compendium.dnd5e.items.Item.sword' }),
])
stock(party, [])
made = await giveParty([{ id: 'pack000000000001', quantity: 1 }, { id: 'swrd000000000001', quantity: 1 }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
const byName = (actor, name) => actor.items.find(item => item.name === name)
for (const name of ['Backpack', 'Ring of Warmth', 'Wagon', 'Longsword']) {
  const system = byName(party, name)._source.system
  assert.ok(!('equipped' in system) && !('attuned' in system) && !('prepared' in system) && !('value' in (system.crew ?? {})), `${name}: ${JSON.stringify(system)}`)
}
const ring = byName(party, 'Ring of Warmth')._source
assert.deepEqual([ring.system.uses, ring.effects, ring._stats.compendiumSource, ring.system.attunement], [{ max: 3, spent: 1, recovery: [] }, [effect], 'Compendium.dnd5e.items.Item.ring', 'required'])
assert.equal(byName(party, 'Longsword')._source.flags.core.sourceId, 'Compendium.dnd5e.items.Item.sword')
assert.equal(byName(party, 'Wagon')._source.system.crew.max, 4)
assert.equal(thorin.items.size, 0)
// Part of a stack too: the part arrives unequipped and unattuned, the rest as it was.
stock(thorin, [itemData('Arrows', 'consumable', { quantity: 20, equipped: true, attuned: true, attunement: 'optional' }, { id: 'arro000000000002' })])
stock(party, [])
made = await giveParty([{ id: 'arro000000000002', quantity: 5 }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
const partOf = onlyItem(party)._source.system
assert.ok(!('equipped' in partOf) && !('attuned' in partOf) && !('prepared' in partOf) && !('value' in (partOf.crew ?? {})), `the part: ${JSON.stringify(partOf)}`)
assert.deepEqual([partOf.quantity, partOf.attunement], [5, 'optional'])
const restOf = onlyItem(thorin)._source.system
assert.deepEqual([restOf.quantity, restOf.equipped, restOf.attuned], [15, true, true], 'the rest still equipped and attuned')
okay("every item moved, what a container holds too, and part of a stack, arrives unequipped, unattuned and unprepared, with no crew, as dnd5e's drop resets the one dropped; its uses, effects, attunement and source kept, the rest of a stack as it was")

// An item in a container: it arrives at the top, its rest staying in the container.
stock(party, [itemData('Quiver', 'container', {}, { id: 'quiv000000000001' }), itemData('Arrows', 'consumable', { quantity: 20, container: 'quiv000000000001' }, { id: 'arro000000000001' })])
stock(thorin, [])
made = await takeThorin([{ id: 'arro000000000001', quantity: 5 }])
assert.deepEqual([holds(thorin), holds(party)], [[['Arrows', 5, null]], [['Quiver', 1, null], ['Arrows', 15, 'quiv000000000001']]])
made = await takeThorin([{ id: 'arro000000000001', quantity: 15 }])
assert.deepEqual([holds(thorin).map(([n, q, c]) => [n, q, c]).sort(), holds(party)], [[['Arrows', 15, null], ['Arrows', 5, null]], [['Quiver', 1, null]]])
okay('an item in a container arrives at the top of the receiver\'s inventory; the rest of its stack stays in the container')

// What can't be named: gone.
const chain = depth => Array.from({ length: depth }, (_, n) => itemData(`Box ${n + 1}`, 'container', { container: n ? `box${String(n).padStart(13, '0')}` : null }, { id: `box${String(n + 1).padStart(13, '0')}` }))
stock(party, [
  itemData('Odd Chest', 'container', { identified: false, unidentified: { name: 'Chest' }, properties: ['unidentifiedContents'] }, { id: 'chst000000000001' }),
  itemData('Hidden Gem', 'loot', { container: 'chst000000000001' }, { id: 'hgem000000000001' }),
  // A pouch, which hides nothing, in the chest that does: what it holds can't be named either.
  itemData('Pouch', 'container', { container: 'chst000000000001' }, { id: 'pouc000000000002' }),
  itemData('Pouched Gem', 'loot', { container: 'pouc000000000002' }, { id: 'hgem000000000002' }),
  ...chain(6),
  itemData('Deep Gem', 'loot', { container: 'box0000000000006' }, { id: 'dgem000000000001' }),
  itemData('Shallow Gem', 'loot', { container: 'box0000000000005' }, { id: 'sgem000000000001' }),
], { gp: 120 })
stock(thorin, [itemData('Second Wind', 'feat', {}, { id: 'feat000000000001' })])
unchanged = writes.length
for (const [actorId, transfer, fields, why] of [
  ['thorin', T('party', 'thorin', { items: [{ id: 'none000000000001', quantity: 1 }] }), {}, 'an item not there'],
  ['thorin', T('thorin', 'party', { items: [{ id: 'feat000000000001', quantity: 1 }] }), {}, 'a feature'],
  ['thorin', T('party', 'thorin', { items: [{ id: 'hgem000000000001', quantity: 1 }] }), {}, 'in a container that hides its contents'],
  ['thorin', T('party', 'thorin', { items: [{ id: 'hgem000000000001', quantity: 1 }] }), { by: 'gm' }, 'in a container that hides its contents, the Gamemaster'],
  ['thorin', T('party', 'thorin', { items: [{ id: 'hgem000000000002', quantity: 1 }] }), {}, 'in a pouch in a container that hides its contents'],
  ['thorin', T('party', 'thorin', { items: [{ id: 'hgem000000000002', quantity: 1 }] }), { by: 'gm' }, 'in a pouch in a container that hides its contents, the Gamemaster'],
  ['thorin', T('party', 'thorin', { items: [{ id: 'dgem000000000001', quantity: 1 }] }), {}, 'below five containers'],
  ['thorin', T('party', 'thorin', { items: [{ id: 'dgem000000000001', quantity: 1 }] }), { by: 'gm' }, 'below five containers, the Gamemaster'],
]) assert.deepEqual(refusal(await sent(actorId, transfer, fields)), ['failed', 'gone', null], why)
assert.equal(writes.length, unchanged, 'nothing written')
made = await takeThorin([{ id: 'sgem000000000001', quantity: 1 }])
assert.equal(made.result.status, 'done', 'in five containers: listed')
okay("refuses as `gone` an item the giver hasn't, one that isn't in an inventory, and one the app's sheet can't list: in a container that hides what it holds, at any depth, or below five containers, for the Gamemaster as for players")

stock(party, [
  itemData('Rope', 'loot', { quantity: 2 }, { id: 'rope000000000004' }),
  itemData('Bag', 'container', { quantity: 2 }, { id: 'bagg000000000001' }),
  itemData('Gem', 'loot', { container: 'bagg000000000001' }, { id: 'gemm000000000001' }),
  itemData('Pouch', 'container', { container: 'bagg000000000001' }, { id: 'pouc000000000003' }),
  itemData('Pearl', 'loot', { container: 'pouc000000000003' }, { id: 'perl000000000001' }),
  itemData('Odd Box', 'container', { quantity: 2, identified: false, unidentified: { name: 'Box' }, properties: ['unidentifiedContents'] }, { id: 'oddb000000000001' }),
  itemData('Crate', 'container', { quantity: 3 }, { id: 'crat000000000001' }),
])
stock(thorin, [])
unchanged = writes.length
assert.deepEqual(refusal(await takeThorin([{ id: 'rope000000000004', quantity: 3 }])), ['failed', 'short', null])
assert.deepEqual(refusal(await takeThorin([{ id: 'bagg000000000001', quantity: 1 }])), ['failed', 'container', null], 'part of a container holding something')
assert.deepEqual(refusal(await takeThorin([{ id: 'oddb000000000001', quantity: 1 }])), ['failed', 'container', null], 'part of an empty one that hides its contents')
assert.deepEqual(refusal(await takeThorin([{ id: 'bagg000000000001', quantity: 2 }, { id: 'gemm000000000001', quantity: 1 }])), ['failed', 'nested', null])
assert.deepEqual(refusal(await takeThorin([{ id: 'bagg000000000001', quantity: 2 }, { id: 'perl000000000001', quantity: 1 }])), ['failed', 'nested', null], 'in a pouch in the bag')
assert.equal(writes.length, unchanged, 'nothing written')
made = await takeThorin([{ id: 'crat000000000001', quantity: 1 }])
assert.deepEqual([made.result.status, holds(thorin), holds(party).find(([name]) => name === 'Crate')], ['done', [['Crate', 1, null]], ['Crate', 2, null]])
okay('refuses more than the giver holds (`short`), part of a container that holds or may hold anything (`container`), and an item with the container it\'s in, at any depth (`nested`); an empty container that hides nothing splits as any item')

/* -------------------------------------------- */
/*  Containers                                  */
/* -------------------------------------------- */

stock(party, [
  itemData('Backpack', 'container', {}, { id: 'pack000000000002' }),
  itemData('Rope', 'loot', { container: 'pack000000000002' }, { id: 'rope000000000005' }),
  itemData('Pouch', 'container', { container: 'pack000000000002' }, { id: 'pouc000000000001' }),
  itemData('Gem', 'loot', { container: 'pouc000000000001' }, { id: 'gemm000000000002' }),
  itemData('Torch', 'loot', {}, { id: 'torc000000000001' }),
])
stock(thorin, [])
at = writes.length
made = await takeThorin([{ id: 'pack000000000002', quantity: 1 }])
const pack = byName(thorin, 'Backpack')
assert.deepEqual(made.result.transfer.items, [{ id: 'pack000000000002', quantity: 1, created: pack.id, stacked: null }], 'only the container, never what it holds')
assert.strictEqual(pack._source.system.container, null, 'at the top, null')
assert.deepEqual(holds(thorin).map(([name, , container]) => [name, container]).sort(), [
  ['Backpack', null], ['Gem', byName(thorin, 'Pouch').id], ['Pouch', pack.id], ['Rope', pack.id],
])
assert.ok(thorin.items.contents.every(item => !party.items.has(item.id) && !['pack000000000002', 'rope000000000005', 'pouc000000000001', 'gemm000000000002'].includes(item.id)), 'new ids')
const deletes = writes.slice(at).filter(([what, id]) => (what === 'delete') && (id === 'party'))
assert.equal(deletes.length, 1, 'one call')
assert.deepEqual([...deletes[0][2]].sort(), ['gemm000000000002', 'pack000000000002', 'pouc000000000001', 'rope000000000005'])
assert.deepEqual(holds(party), [['Torch', 1, null]])
assert.deepEqual(writes.slice(at).find(([what]) => what === 'create')[3], { keepId: true }, 'the ids createWithContents gave kept')
okay(`a whole container with two levels of contents arrives with new ids, each in its new container, the top at null (dnd5e ${DND5E6 ? '6.0.5' : '5.3.3'}'s createWithContents); the giver loses it and all it holds in one deleteEmbeddedDocuments`)

stock(party, [...chain(8)])
unchanged = writes.length
assert.deepEqual(refusal(await takeThorin([{ id: 'box0000000000001', quantity: 1 }])), ['failed', 'deep', null])
assert.equal(writes.length, unchanged, 'nothing written: what dnd5e would leave uncopied is never deleted')
assert.equal(party.items.size, 8)
okay('a container holding seven levels of containers, deeper than dnd5e copies, is refused as `deep`, with nothing written')

/* -------------------------------------------- */
/*  Coins                                       */
/* -------------------------------------------- */

const coinsOf = actor => ({ ...actor._source.system.currency })
const takeCoins = (currency, fields) => sent('thorin', T('party', 'thorin', { currency }), fields)
stock(thorin, [], { gp: 15 })
stock(party, [], { gp: 120 })
party.system.currency.gp = 40
assert.deepEqual(refusal(await takeCoins({ gp: 41 })), ['failed', 'short', null], 'more than the sheet shows, though stored')
party.prepareCurrency()
party._source.system.currency.gp = 30
assert.deepEqual(refusal(await takeCoins({ gp: 31 })), ['failed', 'short', null], 'more than stored, though shown')
stock(party, [], { gp: DND5E6 ? 10.5 : 10 })
made = await takeCoins({ gp: 10 })
assert.deepEqual([made.result.status, coinsOf(party).gp], ['done', DND5E6 ? 0.5 : 0])
if (DND5E6) {
  stock(party, [], { gp: 10.5 })
  assert.deepEqual(refusal(await takeCoins({ gp: 11 })), ['failed', 'short', null], 'dnd5e 6: 10.5 shows as 10')
}
stock(party, [], { gp: 120, sp: 7, ep: 5 })
stock(thorin, [], { gp: 15 })
delete thorin._source.system.currency.ep
thorin.prepareCurrency()
at = writes.length
made = await takeCoins({ gp: 50, sp: 2, ep: 0 })
assert.deepEqual(refusal(made), ['failed', 'invalid', 'currency'], 'a coin of nothing is no coin')
made = await takeCoins({ sp: 2, gp: 50 })
assert.deepEqual(made.result.transfer, { from: 'party', to: 'thorin', items: [], currency: { gp: 50, sp: 2 } }, "in dnd5e's order")
assert.deepEqual([coinsOf(party).gp, coinsOf(party).sp, coinsOf(thorin).gp, coinsOf(thorin).sp], [70, 5, 65, 2])
const coinWrites = writes.slice(at).filter(([what]) => what === 'updateActor')
assert.deepEqual(coinWrites, [
  ['updateActor', 'party', { 'system.currency.gp': 70, 'system.currency.sp': 5 }],
  ['updateActor', 'thorin', { 'system.currency.gp': 65, 'system.currency.sp': 2 }],
], 'one update for each, of the coins moved alone, the giver first')
made = await takeCoins({ ep: 3 })
assert.deepEqual([made.result.status, coinsOf(thorin).ep], ['done', 3], 'a coin the receiver has no key for')
okay(`coins: one update of each actor, of the coins moved alone, the giver's first, each from what it stores, so a coin the receiver lacks starts at none${DND5E6 ? ' and dnd5e 6\'s 10.5 gp less 10 leaves 0.5' : ''}; short where the sheet shows fewer, or fewer are stored`)

/* -------------------------------------------- */
/*  Failure                                     */
/* -------------------------------------------- */

const failing = (kind, test) => { faults[kind] = test }
// The coins' add fails: the giver's put back.
stock(party, [], { gp: 120 })
stock(thorin, [], { gp: 15 })
let linesBefore = messages.size
failing('failUpdate', target => target === thorin)
made = await takeCoins({ gp: 5 })
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'failUpdate of thorin refused'])
assert.equal('transfer' in made.result, false, 'nothing moved')
assert.deepEqual([coinsOf(party).gp, coinsOf(thorin).gp], [120, 15])
assert.equal(messages.size, linesBefore, 'no line')
// And the putting back too: lost, never made twice, both said.
let partyUpdates = 0
failing('failUpdate', target => (target === thorin) || ((target === party) && (++partyUpdates === 2)))
made = await takeCoins({ gp: 5 })
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'failUpdate of thorin refused / failUpdate of party refused'])
assert.deepEqual([coinsOf(party).gp, coinsOf(thorin).gp], [115, 15])
// The giver's can't be taken: nothing written, so no sheet sent, though the party's has changed
// since its last.
await settle()
stock(party, [itemData('Rope', 'loot', {}, { id: 'rope000000000018' })], { gp: 120 })
failing('failUpdate', target => target === party)
made = await takeCoins({ gp: 5 })
clearFaults()
assert.deepEqual([refusal(made), sheetsIn(made)], [['failed', 'error', 'failUpdate of party refused'], []])
okay("coins: where the receiver's can't be added, the giver's are put back and the move fails, `error`; where that fails too, both are said, and the coins are lost, never made twice; where the giver's can't be taken, nothing is written and no sheet sent")

// A part's create fails: the giver's stack put back.
stock(party, [itemData('Rope', 'loot', { quantity: 5 }, { id: 'rope000000000006' })])
stock(thorin, [])
failing('failCreate', target => target === thorin)
made = await takeThorin([{ id: 'rope000000000006', quantity: 2 }])
clearFaults()
assert.deepEqual([made.result.reason, holds(party), thorin.items.size], ['error', [['Rope', 5, null]], 0])
// A whole move's delete fails: the copy deleted, or a stack it joined put back.
stock(party, [itemData('Rope', 'loot', { quantity: 2 }, { id: 'rope000000000007' }), potion(2, {}, { id: 'potp000000000004' })])
stock(thorin, [potion(1, {}, { id: 'pott000000000004' })])
failing('failDelete', target => target === party)
made = await takeThorin([{ id: 'rope000000000007', quantity: 2 }])
assert.deepEqual([made.result.reason, holds(party).length, holds(thorin)], ['error', 2, [['Potion of Healing', 1, null]]], 'the copy deleted')
made = await takeThorin([{ id: 'potp000000000004', quantity: 2 }])
assert.deepEqual([made.result.reason, holds(thorin), holds(party).length], ['error', [['Potion of Healing', 1, null]], 2], 'the stack put back')
// And a container's: the copy of all it held deleted too.
stock(party, [itemData('Backpack', 'container', {}, { id: 'pack000000000005' }), itemData('Rope', 'loot', { container: 'pack000000000005' }, { id: 'rope000000000015' }),
  itemData('Gem', 'loot', { container: 'pack000000000005' }, { id: 'gemm000000000003' })])
stock(thorin, [])
made = await takeThorin([{ id: 'pack000000000005', quantity: 1 }])
clearFaults()
assert.deepEqual([made.result.reason, holds(party).length, holds(thorin)], ['error', 3, []], 'every copy deleted')
okay("items: where part of a stack can't be made, the giver's stack is put back; where a whole item's original can't be deleted, its copy is, a container's with all it held, or the stack it joined put back; each `error`")

// Writes a module's hook refuses, which Foundry leaves out without a word: each fails as one that
// throws, never taken as made.
const refusing = test => { faults.refuse = test }
const state = () => JSON.stringify([holds(party), coinsOf(party), holds(thorin), coinsOf(thorin)])
const packed = () => [itemData('Backpack', 'container', {}, { id: 'pack000000000006' }),
  itemData('Rope', 'loot', { container: 'pack000000000006' }, { id: 'rope000000000016' }), itemData('Gem', 'loot', { container: 'pack000000000006' }, { id: 'gemm000000000004' })]
const isUpdate = (what, target, id) => (what === 'update') && (target.id === id)
for (const [why, theirs, mine, test, transfer, error, writesNothing] of [
  ['a content of a container not created', packed(), [], (what, target, entry) => (what === 'create') && (target === thorin) && (entry.name === 'Gem'),
    { items: [{ id: 'pack000000000006', quantity: 1 }] }, 'Not every item was created', false],
  ["the giver's coins not taken", [], [], (what, target) => isUpdate(what, target, 'party'), { currency: { gp: 50 } }, 'An update was refused', true],
  ["the receiver's coins not added", [], [], (what, target) => isUpdate(what, target, 'thorin'), { currency: { gp: 50 } }, 'An update was refused', false],
  ["the giver's stack not lessened", [itemData('Rope', 'loot', { quantity: 5 }, { id: 'rope000000000017' })], [], (what, target) => isUpdate(what, target, 'rope000000000017'),
    { items: [{ id: 'rope000000000017', quantity: 2 }] }, 'An update was refused', true],
  ["the receiver's stack not added to", [potion(3, {}, { id: 'potp000000000006' })], [potion(1, {}, { id: 'pott000000000007' })], (what, target) => isUpdate(what, target, 'pott000000000007'),
    { items: [{ id: 'potp000000000006', quantity: 2 }] }, 'An update was refused', false],
  ["the giver's item not deleted", [lamp()], [], (what, target) => (what === 'delete') && (target === party),
    L, 'Not every item was deleted', false],
  ["the giver's item not deleted, a stack joined", [potion(2, {}, { id: 'potp000000000007' })], [potion(1, {}, { id: 'pott000000000008' })], (what, target) => (what === 'delete') && (target === party),
    { items: [{ id: 'potp000000000007', quantity: 2 }] }, 'Not every item was deleted', false],
]) {
  await settle()
  stock(party, theirs, { gp: 120 })
  stock(thorin, mine, { gp: 15 })
  const was = state()
  linesBefore = messages.size
  refusing(test)
  made = await sent('thorin', T('party', 'thorin', transfer))
  clearFaults()
  assert.deepEqual(refusal(made), ['failed', 'error', error], why)
  assert.ok(!('transfer' in made.result), `${why}: nothing said to have moved`)
  assert.equal(messages.size, linesBefore, `${why}: no line`)
  assert.equal(state(), was, `${why}: the giver as it was, nothing added to the receiver`)
  if (writesNothing) assert.deepEqual(sheetsIn(made), [], `${why}: nothing written, no sheet sent`)
}
// A content kept from being deleted stays the giver's, its copy deleted; what went keeps its copy.
stock(party, packed())
stock(thorin, [])
refusing((what, target, item) => (what === 'delete') && (target === party) && (item.name === 'Gem'))
made = await takeThorin([{ id: 'pack000000000006', quantity: 1 }])
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'Not every item was deleted'])
assert.deepEqual([holds(party).map(([name]) => name), holds(thorin).map(([name]) => name).sort()], [['Gem'], ['Backpack', 'Rope']], 'each on one end: none on both, none on neither')
// The putting back refused too: both said, the coins lost, never made twice.
stock(party, [], { gp: 120 })
stock(thorin, [], { gp: 15 })
partyUpdates = 0
refusing((what, target) => (what === 'update') && ((target === thorin) || ((target === party) && (++partyUpdates === 2))))
made = await takeCoins({ gp: 5 })
clearFaults()
assert.deepEqual([refusal(made), coinsOf(party).gp, coinsOf(thorin).gp], [['failed', 'error', 'An update was refused / An update was refused'], 115, 15])
// And a copy that can't be deleted: both said, the item on both ends, as the sheets show.
stock(party, [lamp()])
stock(thorin, [])
refusing(what => what === 'delete')
made = await takeThorin([{ id: 'lamp000000000001', quantity: 1 }])
clearFaults()
assert.deepEqual([refusal(made), holds(party).length, holds(thorin).length], [['failed', 'error', 'Not every item was deleted / Not every item was deleted'], 1, 1])
okay("a write a module's hook refuses, which Foundry leaves out without throwing, fails the move as one that throws: a container copied without one of its contents is deleted from the receiver; coins not taken, or not added, and a stack not lessened, or not added to, leave both ends as they were; an original not deleted has its copy deleted, or the stack it joined put back, and of a container only the copies of what stayed; never on both ends, never made from nothing")

// A move whose checks throw fails `error`, and the next is made as ever.
stock(party, [lamp()])
stock(thorin, [])
let throwing = true
party.items.get = function (id) {
  if (throwing && (id === 'lamp000000000001')) {
    throwing = false
    throw new Error('checks threw')
  }
  return Collection.prototype.get.call(this, id)
}
const [broken, next] = await fetched(move('thorin', T('party', 'thorin', L)), move('thorin', T('party', 'thorin', L)))
delete party.items.get
assert.deepEqual([refusal(broken), next.result.status, holds(thorin).map(([name]) => name)], [['failed', 'error', 'checks threw'], 'done', ['Lamp']])
okay('a move whose checks throw fails `error`, and the next is made as ever')

// A failure part way: what moved is said, and only that.
stock(party, [itemData('Rope', 'loot', {}, { id: 'rope000000000008' }), lamp()], { gp: 120 })
stock(thorin, [], { gp: 15 })
let creates = 0
failing('failCreate', target => (target === thorin) && (++creates === 2))
made = await takeThorin([{ id: 'rope000000000008', quantity: 1 }, { id: 'lamp000000000001', quantity: 1 }])
clearFaults()
assert.deepEqual([made.result.reason, made.result.transfer.items.map(({ id }) => id), made.line.content], ['error', ['rope000000000008'], '<p>Takes 1 Rope from The Iron Company</p>'])
stock(party, [itemData('Rope', 'loot', {}, { id: 'rope000000000008' }), lamp()], { gp: 120 })
stock(thorin, [], { gp: 15 })
creates = 0
failing('failCreate', target => (target === thorin) && (++creates === 2))
made = await sent('thorin', T('party', 'thorin', { items: [{ id: 'rope000000000008', quantity: 1 }, { id: 'lamp000000000001', quantity: 1 }], currency: { gp: 5 } }))
clearFaults()
assert.deepEqual(refusal(made), ['failed', 'error', 'failCreate of thorin refused'])
assert.deepEqual(made.result.transfer, {
  from: 'party', to: 'thorin', items: [{ id: 'rope000000000008', quantity: 1, created: byName(thorin, 'Rope').id, stacked: null }], currency: { gp: 5 },
})
assert.equal(made.line.content, '<p>Takes 1 Rope and 5 gp from The Iron Company</p>')
assert.deepEqual([holds(party).map(([name]) => name), coinsOf(party).gp, coinsOf(thorin).gp], [['Lamp'], 115, 20])
okay("a move that fails part way, its coins and first item moved, says what moved in `transfer`, and its line names only that; the rest isn't tried")

/* -------------------------------------------- */
/*  The line                                    */
/* -------------------------------------------- */

const lineOf = made => made.line?.content?.replace(/^<p>|<\/p>$/g, '')
stock(party, [potion(3, {}, { id: 'potp000000000005' }), itemData('Backpack', 'container', {}, { id: 'pack000000000003' }), itemData('Bedroll', 'loot', { container: 'pack000000000003' }, { id: 'bedr000000000001' }),
  itemData('Potion of Giant Strength', 'consumable', { quantity: 1, ...UNIDENTIFIED }, { id: 'vial000000000001', source: 'Compendium.dnd5e.items.Item.giant' })], { gp: 120 })
stock(thorin, [potion(4, {}, { id: 'pott000000000005' }), itemData('Rope', 'loot', { quantity: 3 }, { id: 'rope000000000009' }), itemData('Bead <b>of</b> Force & Fire', 'loot', {}, { id: 'bead000000000001' })], { gp: 80, sp: 9 })
stock(vex, [], { gp: 3 })
const lines = []
const check = async (made, text) => {
  assert.equal(made.result.status, 'done', JSON.stringify(made.result))
  assert.equal(lineOf(made), text)
  lines.push(made)
  return made
}
await check(await takeThorin([{ id: 'potp000000000005', quantity: 2 }]), 'Takes 2 Potion of Healing from The Iron Company')
await check(await giveParty([{ id: 'pott000000000005', quantity: 2 }]), 'Gives 2 Potion of Healing to The Iron Company')
await check(await takeCoins({ gp: 50 }), 'Takes 50 gp from The Iron Company')
await check(await sent('thorin', T('thorin', 'vex', { items: [{ id: 'rope000000000009', quantity: 1 }], currency: { gp: 50 } })), 'Gives 1 Rope and 50 gp to Vex')
await check(await sent('thorin', T('thorin', 'party', { items: [{ id: 'pott000000000005', quantity: 2 }, { id: 'rope000000000009', quantity: 1 }], currency: { sp: 5 } })),
  'Gives 2 Potion of Healing, 1 Rope, and 5 sp to The Iron Company')
const backpack = await check(await takeThorin([{ id: 'pack000000000003', quantity: 1 }]), 'Takes 1 Backpack from The Iron Company')
assert.deepEqual(backpack.result.transfer.items.map(({ id }) => id), ['pack000000000003'], "the container alone, never what it held")
const strange = await check(await takeThorin([{ id: 'vial000000000001', quantity: 1 }]), 'Takes 1 Strange Vial from The Iron Company')
const vialCopy = byName(thorin, 'Strange Vial')
assert.deepEqual([vialCopy._source.system.identified, vialCopy._source.name], [false, 'Potion of Giant Strength'], 'still unidentified')
assert.ok(!JSON.stringify(strange.after).includes('Giant Strength') && !JSON.stringify(strange.result).includes('Giant Strength') && !strange.line.content.includes('Giant'), 'its secret nowhere the app is told, nor in chat')
await check(await sent('thorin', T('thorin', 'party', { items: [{ id: 'bead000000000001', quantity: 1 }] })), 'Gives 1 Bead &lt;b&gt;of&lt;/b&gt; Force &amp; Fire to The Iron Company')
vex.name = 'Vex <i>the Bold</i>'
await check(await sent('thorin', T('thorin', 'vex', { currency: { sp: 1 } })), 'Gives 1 sp to Vex &lt;i&gt;the Bold&lt;/i&gt;')
vex.name = 'Vex'
for (const made of lines) {
  const take = made.command.transfer.from === 'party'
  assert.deepEqual([made.line.author.id, made.line.speaker.actor, made.line.whisper, made.line.blind], ['alice', 'thorin', [], false], 'as Thorin, by his player, for everyone')
  assert.deepEqual(made.line.flags['sending-stone'], { request: made.command.id })
  assert.equal(made.result.messageId, made.line.id)
  assert.equal(made.result.visible, true)
  assert.ok(!('messages' in made.result), "a player's result lists no messages")
  const names = ['Potion', 'Rope', 'Backpack', 'Bedroll', 'Vial', 'Bead', 'Iron', 'Vex', 'Thorin']
  assert.ok(names.every(name => !JSON.stringify(made.result.transfer).includes(name)), `no names in ${JSON.stringify(made.result.transfer)}`)
  assert.equal(made.result.transfer.from, take ? 'party' : 'thorin')
}
okay("each move posts its line in chat, public, as the character who moved it and by its player: \"Takes 2 Potion of Healing from The Iron Company\", \"Gives 1 Rope and 50 gp to Vex\", \"Gives 2 Potion of Healing, 1 Rope, and 5 sp to The Iron Company\", a container by itself, an unidentified item by the name its players see; names escaped; the result names nothing")

// The Gamemaster's, as the character: marked theirs, and listed in their result.
stock(party, [itemData('Rope', 'loot', {}, { id: 'rope000000000010' })])
stock(vex, [])
made = await sent('vex', T('party', 'vex', { items: [{ id: 'rope000000000010', quantity: 1 }] }), { by: 'gm' })
assert.equal(lineOf(made), 'Takes 1 Rope from The Iron Company')
assert.deepEqual([made.line.author.id, made.line.speaker.actor, made.line.flags['sending-stone']], ['bob', 'vex', { request: made.command.id, by: 'gm' }])
assert.deepEqual(made.result.messages, [made.line.id])
linesBefore = messages.size
assert.deepEqual(refusal(await sent('vex', T('party', 'vex', { items: [{ id: 'rope000000000010', quantity: 1 }] }), { by: 'gm' })), ['failed', 'gone', null])
assert.equal(messages.size, linesBefore, 'no line on a refusal')
okay("the Gamemaster's move posts as the character's player, flagged `by: \"gm\"` and listed in their result's messages; a refusal posts nothing")

/* -------------------------------------------- */
/*  The sheets before the result                */
/* -------------------------------------------- */

const order = made => made.after.filter(e => ['group.updated', 'character.updated'].includes(e.type))
  .map(e => [e.type, (e.data.group ?? e.data.character).id])
stock(party, [itemData('Backpack', 'container', {}, { id: 'pack000000000004' }), itemData('Bedroll', 'loot', { container: 'pack000000000004' }, { id: 'bedr000000000002' }), itemData('Torch', 'loot', {}, { id: 'torc000000000002' })])
stock(thorin, [itemData('Rope', 'loot', {}, { id: 'rope000000000011' })])
await settle()
made = await takeThorin([{ id: 'pack000000000004', quantity: 1 }])
assert.deepEqual(order(made).slice(0, 2), [['group.updated', 'party'], ['character.updated', 'thorin']], 'take: the giver, then the receiver')
const firstGroup = made.after.find(e => e.type === 'group.updated').data.group.sheet
const groupItems = [...firstGroup.inventory.sections.flatMap(s => s.items), ...firstGroup.inventory.containers, ...firstGroup.inventory.containers.flatMap(c => c.contents ?? [])]
assert.deepEqual(groupItems.map(item => item.id), ['torc000000000002'], 'the first sheet sent has neither the container nor what it held')
await settle()
made = await giveParty([{ id: 'rope000000000011', quantity: 1 }])
assert.deepEqual(order(made).slice(0, 2), [['character.updated', 'thorin'], ['group.updated', 'party']], 'give: the giver, then the receiver')
okay("both sheets go ahead of the result, the giver's first: a take's group.updated then character.updated, a give's character.updated then group.updated; the first sheet sent has none of a container moved whole")

/* -------------------------------------------- */
/*  Two at once                                 */
/* -------------------------------------------- */

// Thorin's player and the Gamemaster, into Vex, take the last Rope in one fetch: two actor ids.
const lastRope = () => itemData('Rope', 'loot', {}, { id: 'rope000000000012' })
stock(party, [lastRope()])
stock(thorin, [])
stock(vex, [])
let [mine, theirs] = await fetched(
  move('thorin', T('party', 'thorin', { items: [{ id: 'rope000000000012', quantity: 1 }] })),
  move('vex', T('party', 'vex', { items: [{ id: 'rope000000000012', quantity: 1 }] }), { by: 'gm' }),
)
assert.deepEqual([mine.result.status, refusal(theirs)], ['done', ['failed', 'gone', null]])
assert.deepEqual([thorin.items.size, vex.items.size, party.items.size], [1, 0, 0], 'one Rope, once')
stock(party, [itemData('Rope', 'loot', { quantity: 3 }, { id: 'rope000000000013' })])
stock(thorin, [])
;[mine, theirs] = await fetched(
  move('thorin', T('party', 'thorin', { items: [{ id: 'rope000000000013', quantity: 2 }] })),
  move('vex', T('party', 'vex', { items: [{ id: 'rope000000000013', quantity: 2 }] }), { by: 'gm' }),
)
assert.deepEqual([mine.result.status, refusal(theirs)], ['done', ['failed', 'short', null]])
assert.deepEqual([holds(party), holds(thorin), vex.items.size], [[['Rope', 1, null]], [['Rope', 2, null]], 0])
okay("two takes of the last Rope at once, by Thorin's player and the Gamemaster into Vex: one moves it, the other is `gone`; of 2 each from 3: one moves, the other is `short`; never more than there was")

// The watchdog: a move whose write hangs past 60 seconds is told as taking too long, and its late
// result sent; one fetched meanwhile, whose queues are let go then, starts only once its writes end.
stock(party, [lamp()])
stock(thorin, [])
stock(vex, [])
const hung = hold(target => target === thorin)
const slow = move('thorin', T('party', 'thorin', L))
app.waiting.set('camp-a', [slow])
app.wake?.()
await until(() => hung.held, 'the hang')
const second = move('vex', T('party', 'vex', L), { by: 'gm' })
const copiesThen = copiedBy.length
app.waiting.set('camp-a', [second])
app.wake?.()
await until(() => resultsOf(slow.id).length === 1, 'the watchdog', 2000)
assert.equal(resultsOf(slow.id)[0].reason, 'timeout')
await wait(200)
assert.equal(copiedBy.length, copiesThen, 'the second has not started its checks while the first still writes')
assert.equal(resultsOf(second.id).length, 0)
hung.release()
await until(() => (resultsOf(slow.id).length === 2) && (resultsOf(second.id).length === 1), 'both results')
assert.deepEqual([resultsOf(slow.id)[1].status, resultsOf(second.id)[0].reason], ['done', 'gone'])
assert.ok(resultIndex(second.id) > app.events.findLastIndex(e => (e.type === 'command.result') && (e.data.id === slow.id)), 'after the late done')
assert.deepEqual([thorin.items.size, vex.items.size, party.items.size], [1, 0, 0])
okay('a move whose create hangs past the watchdog is told `timeout`, and its late `done` sent; a second fetched meanwhile, its queues let go, waits for its writes and finds the Lamp gone')

// The campaign removed while a move waits: refused, as the switch is no more.
stock(party, [lamp(), itemData('Rope', 'loot', {}, { id: 'rope000000000014' })])
stock(thorin, [])
const waiting = hold(target => target === thorin)
const ahead = move('thorin', T('party', 'thorin', L))
const behind = move('thorin', T('party', 'thorin', { items: [{ id: 'rope000000000014', quantity: 1 }] }))
await (async () => {
  app.waiting.set('camp-a', [ahead, behind])
  app.wake?.()
  await until(() => waiting.held, 'the first write')
  settings.set('campaigns', [])
  waiting.release()
  await until(() => resultsOf(behind.id).length, 'its result')
})()
assert.deepEqual([resultsOf(ahead.id)[0].status, resultsOf(behind.id)[0].reason], ['done', 'transfers-off'])
campaignAs()
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), true)
okay('a move that waited while its campaign was removed is refused `transfers-off`')

// A give into Vex fetched after Vex spends a charge: made once the spend's result is posted.
campaignAs({ rolls: true, attacks: true })
vex.system.resources = { primary: { label: 'Superiority Dice', max: 4, value: 3, sr: true } }
stock(thorin, [potion(1, {}, { id: 'pott000000000006' })])
stock(vex, [])
const spending = hold((target, changes) => (target === vex) && ('system.resources.primary.value' in (changes ?? {})))
const spend = { id: `spend-${++ids}`, actorId: 'vex', kind: 'spend', counter: { resource: 'primary' }, count: 1, mode: 0, explicit: false, extras: [], dice: [] }
const gift = move('thorin', T('thorin', 'vex', { items: [{ id: 'pott000000000006', quantity: 1 }] }))
const copies = copiedBy.length
app.waiting.set('camp-a', [spend, gift])
app.wake?.()
await until(() => spending.held, 'the spend')
await wait(100)
assert.equal(copiedBy.length, copies, 'the give waits')
spending.release()
await until(() => resultsOf(gift.id).length, 'the give')
assert.deepEqual([resultsOf(spend.id)[0].status, resultsOf(gift.id)[0].status], ['done', 'done'])
const spendAt = resultIndex(spend.id)
assert.ok(app.events.findIndex((e, n) => (n > spendAt) && (e.type === 'character.updated') && (e.data.character.id === 'thorin')) > spendAt, "the give's sheets after the spend's result")
assert.ok(resultIndex(gift.id) > spendAt)
const vexUpdate = writes.findLastIndex(([what, id, changes]) => (what === 'updateActor') && (id === 'vex') && ('system.resources.primary.value' in changes))
assert.ok(writes.findIndex(([what, id], n) => (n > vexUpdate) && (what === 'create') && (id === 'vex')) > vexUpdate)
campaignAs()
okay("a give into Vex fetched after Vex's spend (rolls and attacks on) starts only once the spend is made and its result posted")

/* -------------------------------------------- */
/*  Manage Campaigns                            */
/* -------------------------------------------- */

const box = win => win.element.querySelector('[name="campaign.transfers"]')
const notes = win => [...win.element.querySelectorAll('.sending-stone-transfers .sending-stone-warning')].map(note => note.textContent.trim())
let win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
const fieldset = find(win, 'fieldset.sending-stone-transfers')
assert.equal(fieldset.querySelector('legend').textContent.trim(), 'Items and coins')
assert.equal(fieldset.querySelector('label[for="sending-stone-transfers"]').textContent.trim(), 'Players move items and coins')
assert.ok(fieldset.querySelector('.hint').textContent.startsWith('From the app, they take from and give to'))
assert.equal(box(win).checked, true)
assert.equal(box(win).disabled, false, 'not greyed, nor by the rolls, which are off')
assert.deepEqual(notes(win), [], 'no note: dnd5e, an app that takes moves')
const dirty = () => find(win, '[data-dirty]').dataset.dirty
assert.equal(dirty(), 'false')
tick(win, 'campaign.transfers', false)
assert.equal(dirty(), 'true', 'changed')
tick(win, 'campaign.transfers', true)
assert.equal(dirty(), 'false', 'as saved')
tick(win, 'campaign.transfers', false)
await save(win)
assert.equal(settings.get('campaigns')[0].transfers, false, 'saved')
win = await openSettings()
await click(win, '[data-action="addCampaign"]')
await click(win, '.sending-stone-tabs [data-tab="actions"]')
assert.equal(box(win).checked, false, 'a new campaign: off')
await win.close()
campaignAs()
// An app that has commands but takes no moves, as one before 0.31.0; and another system.
app.features = { commands: true, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.deepEqual(notes(win), ["The app this campaign sends to doesn't take moves yet."])
await win.close()
app.features = { commands: true, transfers: 1, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
game.system.id = 'pf2e'
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.deepEqual(notes(win), ['Not available in this game: it needs the D&D Fifth Edition system.'])
await win.close()
game.system.id = 'dnd5e'
okay("Manage Campaigns' Player actions tab has \"Players move items and coins\" in its own fieldset, not greyed by the rolls; ticked and unticked it shows the window changed or not, and saves; a new campaign's is off; a note where the app has commands but takes no moves, and under another system")

// Changed on purpose (round 0.38.0 §D8.3): the dish switch's notes, as the moves' above. Under dnd5e 6,
// or another system, that dishes need dnd5e 5; with the switch on, where the app has commands but takes
// no dishes, as one before 0.38.0, that it doesn't take them yet; neither once it does.
const NEEDS_5 = 'Dishes need dnd5e 5.x for now.'
const NOT_YET = "Your Sending Stone doesn't take dishes yet."
const dishNotes = async () => {
  const opened = await openSettings()
  await view(opened, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
  const found = [...opened.element.querySelectorAll('.sending-stone-dishes .sending-stone-warning')].map(note => note.textContent.trim())
  await opened.close()
  return found
}
const underSystem = DND5E6 ? [NEEDS_5] : []
assert.deepEqual(await dishNotes(), underSystem, `the switch off: ${DND5E6 ? 'dnd5e 6' : 'no note'}`)
campaignAs({ dishes: true })
assert.deepEqual(await dishNotes(), [...underSystem, NOT_YET], 'the switch on, an app with commands that takes no dishes')
app.features = { commands: true, transfers: 1, groups: 1, dishes: 1 }
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(await dishNotes(), underSystem, 'an app that takes dishes')
game.system.id = 'pf2e'
assert.deepEqual(await dishNotes(), [NEEDS_5], 'another system')
game.system.id = 'dnd5e'
app.features = { commands: true, transfers: 1, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
campaignAs()
okay(`Manage Campaigns' Dishes from the Magical Recipe Book notes: ${DND5E6 ? 'under dnd5e 6.0.5, that dishes need dnd5e 5' : 'none under dnd5e 5'}; under another system, that they need dnd5e 5; with the switch on, where the app has commands but takes no dishes, that it doesn't yet, and not once it does`)

/* -------------------------------------------- */
/*  The settings report                         */
/* -------------------------------------------- */

const report = () => foundrySettings(getCampaigns()[0])
const rowsOf = (settings, id) => settings.sections.find(section => section.id === id).rows
// Changed on purpose (round 0.36.0 §6.12): the campaign's companions' initiative after its moves.
// Changed on purpose (round 0.38.0 §D8.3): its dishes from the Magical Recipe Book after its moves, off.
// Changed on purpose (round 0.39.0 §1.9): whether its players change their own effects after its dishes, off.
assert.deepEqual(rowsOf(report(), 'campaign').map(row => row.id), ['rolls', 'attacks', 'prompts', 'manualDice', 'transfers', 'dishes', 'effects', 'companionInitiative', 'groups'])
assert.deepEqual(rowsOf(report(), 'campaign').find(row => row.id === 'dishes'), { id: 'dishes', label: 'Dishes from the Magical Recipe Book', value: false, text: 'Off' })
assert.deepEqual(rowsOf(report(), 'campaign').find(row => row.id === 'effects'), { id: 'effects', label: 'Allow Players to disable & remove their own active effects', value: false, text: 'Off' })
// Changed on purpose (round 0.38.0 §D8.3): on, it says why it does nothing under dnd5e 6 or another system.
campaignAs({ dishes: true })
assert.deepEqual(rowsOf(report(), 'campaign').find(row => row.id === 'dishes'),
  { id: 'dishes', label: 'Dishes from the Magical Recipe Book', value: true, text: 'On', ...(DND5E6 && { note: 'Dishes need dnd5e 5.x for now.' }) })
game.system.id = 'pf2e'
assert.equal(rowsOf(report(), 'campaign').find(row => row.id === 'dishes').note, 'Dishes need dnd5e 5.x for now.')
game.system.id = 'dnd5e'
campaignAs()
assert.deepEqual(rowsOf(report(), 'campaign').find(row => row.id === 'transfers'), { id: 'transfers', label: 'Players move items and coins', value: true, text: 'On' })
game.system.id = 'pf2e'
assert.deepEqual(rowsOf(report(), 'campaign').find(row => row.id === 'transfers').note, 'it needs the D&D Fifth Edition system.')
game.system.id = 'dnd5e'
campaignAs({ transfers: false })
assert.deepEqual(rowsOf(report(), 'campaign').find(row => row.id === 'transfers'), { id: 'transfers', label: 'Players move items and coins', value: false, text: 'Off' })
campaignAs()
assert.deepEqual(rowsOf(report(), 'sending-stone').map(row => row.id), ['chatEvents', 'chatScope', 'chatResults', 'combatEvents', 'gmContent'])
assert.deepEqual(rowsOf(report(), 'sending-stone')[2], { id: 'chatResults', label: 'Hit/miss and save results in the app', value: 'foundry', text: "Follow Foundry's visibility settings" })
settings.set('chatResults', 'always')
assert.deepEqual(rowsOf(report(), 'sending-stone')[2], { id: 'chatResults', label: 'Hit/miss and save results in the app', value: 'always', text: 'Always show them to players' })
settings.set('chatResults', 'sometimes')
assert.equal(rowsOf(report(), 'sending-stone')[2].value, 'foundry', 'any other value follows Foundry')
settings.delete('chatResults')
okay("the settings report has the campaign's `transfers` after `manualDice`, On or Off, with a note under another system, and its `dishes` after them, with a note under dnd5e 6 or another system; and the world's `chatResults` after `chatScope`, Follow or Always")

// ---- END ----
console.log(`transfers${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
