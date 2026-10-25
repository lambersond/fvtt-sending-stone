// A character's favorites added and removed from the app (module 0.37.0, its contract §4-§6, §6.7):
// the hello's `features.favorites`, with no switch, after `companions`, and the fetching it needs
// with the campaign's rolls, moves, removals and notes off; the `favorite` command's checks, in
// their order; who may change whose favorites, never a group's, a companion's (`of`), nor a
// character's without dnd5e's favorites; each of dnd5e's types stored by the id dnd5e's own menus
// build, through dnd5e's own addFavorite and removeFavorite, a new one last; two wands' activities
// of one id kept apart by their items; what's already so done with nothing written; a Remove of
// something gone; what the sheet doesn't show refused `gone`; dnd5e's throw; the sheet ahead of
// every `done`; no chat message; `off` where the system has changed or the campaign is gone by the
// time it's made; and favorites made in their order behind the character's other commands. On
// removals.mjs's stand-ins, as it copies transfers.mjs's: the real module and its language file,
// dnd5e 5.3.3's real dice classes for its self-test, a stand-in Foundry core and app; the actors'
// items as Foundry's embedded documents, here with their activities and effects; and dnd5e's
// favorites ported in favorites-core.mjs, checked against dnd5e's own source, 5.3.3's or with
// DND5E6=1 6.0.5's. Timers of a second or more run a hundred times faster. Run with SLIM_CHECK=1
// and --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settings, user, users, actors } from './stub.mjs'
import { withFavorites } from './favorites-core.mjs'

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
CONST.SORT_INTEGER_DENSITY = 100000
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
  skills: { prc: { label: 'Perception', ability: 'wis' }, ste: { label: 'Stealth', ability: 'dex' } },
  tools: { thief: { ability: 'dex' } },
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase(), abbreviation: key }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: { fire: { label: 'Fire' } },
  healingTypes: { healing: { label: 'Healing' } },
  activityActivationTypes: { action: { label: 'Action', header: 'Actions' }, bonus: { label: 'Bonus Action', header: 'Bonus Actions' } },
  currencies: Object.fromEntries(['pp', 'gp', 'ep', 'sp', 'cp'].map(id => [id, { label: `DND5E.Currency${id.toUpperCase()}`, abbreviation: id }])),
  weightUnits: { lb: { abbreviation: 'lb' } },
}
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  documents: { Trait: { keyLabel: (key, { trait }) => ({ thief: "Thieves' Tools" })[key] ?? `${trait}:${key}` } },
}
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

// dnd5e's own favorites, which favorites-core.mjs ports: the same here, 5.3.3's or 6.0.5's.
const characterData = readFileSync(`${D}/data/actor/character.mjs`, 'utf8')
for (const line of [
  'return !!this.favorites.find(f => f.id === favoriteId);',
  'if ( this.hasFavorite(favorite.id) ) return Promise.resolve(this.parent);',
  'if ( favorite.id.startsWith(".") && fromUuidSync(favorite.id, { relative: this.parent }) === null ) {',
  'favorites.push({ ...favorite, sort: maxSort + CONST.SORT_INTEGER_DENSITY });',
  'return this.parent.update({ "system.favorites": favorites });',
  'if ( favoriteId.startsWith("resources.") ) return this.parent.update({ [`system.${favoriteId}.max`]: 0 });',
  'const favorites = this.favorites.filter(f => f.id !== favoriteId);',
]) assert.ok(characterData.includes(line), `dnd5e's CharacterData has: ${line}`)
okay(`dnd5e ${DND5E6 ? '6.0.5' : '5.3.3'}'s hasFavorite, addFavorite and removeFavorite are as favorites-core.mjs ports them`)

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

/** The switch that holds the next write it matches, as removals.mjs's. */
const faults = { hold: null }
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

/** An activity, as dnd5e's sheet reads one: a utility, shown or not, by dnd5e 6's `isHidden` or 5's `canUse`. */
const activity = (id, name, { hidden = false } = {}) => ({
  id, type: 'utility', name, img: 'icons/activity.webp', activation: { type: 'action' }, labels: { activation: 'Action' },
  ...(DND5E6 ? { isHidden: hidden } : { canUse: !hidden }),
})
/** An effect, as Foundry's ActiveEffect, on the actor or on an item. */
const effectOn = (parent, { _id, name, ...fields }) => ({
  id: _id, _id, name, img: 'icons/effect.webp', documentName: 'ActiveEffect', parent, origin: null,
  disabled: false, isSuppressed: false, isTemporary: false, statuses: new Set(), duration: {}, description: '', system: {}, ...fields,
})

/**
 * An item a character holds, as Foundry's Item with dnd5e's data prepared: its activities, each
 * knowing its item, and its effects, each its parent's, by id; whether dnd5e hides it from the sheet.
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
    this.effects = new Collection((source.effects ?? []).map(effect => [effect._id, effectOn(this, structuredClone(effect))]))
    const system = structuredClone(source.system ?? {})
    system.properties = new Set(source.system?.properties ?? [])
    system.activities = new Collection((source.system?.activities ?? []).map(data => [data.id, { ...structuredClone(data), item: this }]))
    this.system = system
    this.name = source.name
    this.labels = { properties: [] }
  }
  toObject() { return structuredClone(this._source) }
  getFlag(scope, key) { return foundry.utils.getProperty(this.flags?.[scope] ?? {}, key) }
  getRollData() { return {} }
  async update(changes) {
    await holding(this, changes)
    await turn()
    for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(this._source, path, value)
    this.prepare()
    await Hooks.callAll('updateItem', this, foundry.utils.expandObject(changes), {}, 'gm')
    return this
  }
}
globalThis.Item = HarnessItem

/** An actor's items and deletions, as Foundry's, firing deleteItem, as each client would. */
function embed(actor, items = []) {
  actor.items = new Collection()
  for (const data of items) actor.items.set(data._id, new HarnessItem(data, actor))
  actor.system.currency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 }
  actor.deleteEmbeddedDocuments = async function (type, ids, options) {
    await holding(this, ids)
    await turn()
    const missing = ids.find(id => !this.items.has(id))
    if (missing) throw new Error(`Item ${missing} does not exist`)
    const gone = ids.map(id => this.items.get(id))
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
/** The id dnd5e gives the first activity of an item it migrates, the same for every one (staticID). */
const STATIC = 'dnd5eactivity000'

/**
 * What Thorin carries: a Longsword, a Rope, a Staff with two activities and one its player can't
 * see, two Wands whose one activity each has the same id, as migrated items do, a Cloak with an
 * effect on it, three Potions, a Torch, a Veiled Gift dnd5e hides from the sheet, and a Pick Axe.
 */
const thorinStock = () => [
  itemData('Longsword', 'weapon', { equipped: true }, { id: 'sword' }),
  itemData('Rope', 'loot', {}, { id: 'rope' }),
  itemData('Staff of Power', 'weapon', { equipped: true }, {
    id: 'staff', activities: [activity('strike', 'Strike'), activity('fireball', 'Cast Fireball'), activity('secret', 'Old Power', { hidden: true })],
  }),
  itemData('Wand of Light', 'consumable', {}, { id: 'wandA', activities: [activity(STATIC, 'Light')] }),
  itemData('Wand of Sparks', 'consumable', {}, { id: 'wandB', activities: [activity(STATIC, 'Sparks')] }),
  itemData('Cloak of Protection', 'equipment', { equipped: true }, { id: 'cloak', effects: [{ _id: 'ward', name: 'Cloak of Protection' }] }),
  itemData('Potion of Healing', 'consumable', { quantity: 3 }, { id: 'potion' }),
  itemData('Torch', 'loot', {}, { id: 'torch' }),
  itemData('Veiled Gift', 'feat', {}, { id: 'veiled', isHidden: true }),
  itemData('Pick Axe', 'loot', {}, { id: 'pickaxe' }),
]

// Thorin (Alice), with dnd5e's favorites: a Rope and his pact slots already, the pact's first in the
// list but sorted after, and a resource, Ki; Vex (Bob), a campaign character whose actor has no
// favorites API; Stranger (Eve), no character of the campaign's; The Company, its party; a Wolf
// Alice owns, Thorin's companion, an NPC; and Fallen, a character whose actor is gone.
const thorin = character('thorin', 'Thorin', ['alice'], {
  items: thorinStock(), skills: { prc: { ability: 'wis' } }, tools: { thief: { ability: 'dex' } },
  spells: { spell1: { value: 2, max: 2, level: 1 }, pact: { value: 1, max: 1, level: 3 } },
})
thorin.system.resources = { primary: { label: 'Ki', value: 4, max: 4, sr: true } }
const bless = effectOn(thorin, { _id: 'bless', name: 'Bless', isTemporary: true })
thorin.effects = new Collection([['bless', bless]])
thorin.allApplicableEffects = function* () {
  yield* this.effects
  for (const item of this.items) yield* item.effects
}
const port = withFavorites(thorin, { favorites: [{ type: 'slots', id: 'pact', sort: 400000 }, { type: 'item', id: '.Item.rope', sort: 250000 }] })
const vex = character('vex', 'Vex', ['bob'], { items: [itemData('Lute', 'tool', {}, { id: 'lute' })] })
character('stranger', 'Stranger', ['eve'], { items: [itemData('Rope', 'loot', {}, { id: 'srope' })] })
const party = embed({
  documentName: 'Actor', id: 'party', name: 'The Company', type: 'group', uuid: 'Actor.party', img: 'party.webp', flags: {},
  ownership: { default: 0, alice: 3 }, system: { members: membersOf([thorin, vex]), description: { full: '', summary: '' } },
  getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
  testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
}, [itemData('Rope', 'loot', {}, { id: 'prope' })])
actors.set('party', party)
const wolf = new Actor5e({ id: 'wolf', name: 'Wolf', owners: ['alice'], npc: { max: 2, spent: 0, denomination: 'd8' } })
Object.assign(wolf, { documentName: 'Actor', ownership: { default: 0, alice: 3 }, prototypeToken: { actorLink: true } })
equip(wolf, {})
actors.set('wolf', wolf)
users.get('alice').character = thorin
users.get('bob').character = vex

/* -------------------------------------------- */
/*  The app                                     */
/* -------------------------------------------- */

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
const BASE = { actorId: 'thorin', kind: 'favorite', mode: 0, explicit: false, extras: [], dice: [] }
/** A favorite added or removed, as the app hands it over: `item` only where given. */
const favoring = (op, type, id, { item, ...fields } = {}) => ({
  id: `favorite-${++ids}`, ...BASE, favorite: { op, type, id, ...(item === undefined ? {} : { item }) }, ...fields,
})
const add = (type, id, options) => favoring('add', type, id, options)
const drop = (type, id, options) => favoring('remove', type, id, options)
/** A removal as the app hands it over. */
const removal = (item, quantity, held = quantity) => ({
  id: `remove-${++ids}`, actorId: 'thorin', kind: 'remove', remove: { item, quantity, held }, mode: 0, explicit: false, extras: [], dice: [],
})
/** Hand the module commands in one fetch; resolve once each has its result, with what was posted meanwhile. */
async function fetched(...commands) {
  const from = app.events.length
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), ...commands])
  app.wake?.()
  await until(() => commands.every(command => resultIndex(command.id) >= 0), `the result of ${commands.map(c => c.id).join(', ')}`)
  return commands.map(command => {
    const index = resultIndex(command.id)
    return { command, result: app.events[index].data, after: app.events.slice(from, index) }
  })
}
/** Hand the module commands without waiting on them. */
const handOver = (...commands) => {
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), ...commands])
  app.wake?.()
}
const made = async command => (await fetched(command))[0]
const refusal = ({ result }) => [result.status, result.reason, result.error]
/** The sheets sent between a command's fetch and its result. */
const sheetsIn = ({ after }) => after.filter(e => ['group.updated', 'character.updated'].includes(e.type)).map(e => [e.type, (e.data.group ?? e.data.character).id])
/** The favorites of the sheet sent ahead of a result, as the sheet names them. */
const sentFavorites = ({ after }) => after.findLast(e => e.type === 'character.updated').data.character.sheet.favorites
  .map(f => [f.type, f.id, f.itemId ?? null])
/** Thorin's favorites as dnd5e stores them. */
const stored = () => thorin.system.favorites.map(({ type, id, sort }) => [type, id, sort])
const highest = () => Math.max(0, ...thorin.system.favorites.map(f => f.sort))
const DONE = { status: 'done', reason: null, error: null, messageId: null, visible: true, rolls: [] }
const done = (made, favorited) => assert.deepEqual(made.result, { id: made.command.id, ...DONE, favorited })

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
const { favoriteFeatures, favoritesOn } = await import(`${MODULE}/scripts/command-favorites.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
await until(() => app.events.some(e => e.type === 'bridge.hello'), 'the hello')
await wait(60)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
const settle = () => wait(320)
await settle()
const helloOf = () => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).at(-1)
const sheet = characterSheet(thorin)
assert.deepEqual(sheet.favorites.map(f => [f.type, f.id]), [['resource', 'primary'], ['item', 'rope'], ['slots', 'pact']], 'Ki, then by sort')
assert.ok(sheet.effects.flatMap(section => section.effects).some(effect => effect.id === 'cloak.ward'), "the Cloak's effect, as the sheet names it")
assert.ok(helloOf().data.companions.some(entry => entry.actorId === 'wolf'), 'the Wolf, a companion of Thorin')
okay("a character sheet, as dnd5e has it: Ki, then the Rope and the pact slots by their sort; the Cloak's effect `cloak.ward`; the Wolf among the campaign's companions")

/* -------------------------------------------- */
/*  1. The hello                                */
/* -------------------------------------------- */

const ON = { enabled: true, kinds: ['favorite'], reason: null }
assert.deepEqual(helloOf().data.features.favorites, ON)
// Changed on purpose (round 0.38.0 §D8.3): dishes from the Magical Recipe Book after favorites, `"off"` with
// the switch off, under dnd5e 6 too.
assert.deepEqual(Object.keys(helloOf().data.features), ['rolls', 'transfers', 'removals', 'notes', 'companions', 'favorites', 'dishes'], 'after companions')
assert.deepEqual([helloOf().data.features.rolls.enabled, helloOf().data.features.transfers.enabled], [false, false], "the campaign's rolls and moves off")
// Apart from the rolls, the moves and the dice: whatever they are.
diceStatus.ready = false
assert.deepEqual(favoriteFeatures(), ON)
diceStatus.ready = true
campaignAs({ rolls: true, attacks: true, transfers: true })
announce({ campaignId: 'camp-a' })
await settle()
const on = helloOf().data.features
assert.deepEqual([on.favorites, on.rolls.enabled], [ON, true], 'the same with rolls, attacks and moves on')
assert.ok(on.rolls.kinds.length && !on.rolls.kinds.includes('favorite'), "never among the rolls' kinds")
assert.ok(on.companions.kinds.length && !on.companions.kinds.includes('favorite'), "nor a companion's")
game.system.id = 'pf2e'
assert.deepEqual(favoriteFeatures(), { enabled: false, kinds: [], reason: 'system' })
assert.equal(favoritesOn(), false)
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(helloOf().data.features.favorites, { enabled: false, kinds: [], reason: 'system' })
game.system.id = 'dnd5e'
campaignAs()
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(helloOf().data.features.favorites, ON)
okay("the hello's features.favorites, after companions, says favorites are added and removed under dnd5e, kind `favorite`, with rolls, moves and the self-test off or on, and never among the rolls' or a companion's kinds; under another system `{ enabled: false, kinds: [], reason: 'system' }`")

/* -------------------------------------------- */
/*  2. Fetching                                 */
/* -------------------------------------------- */

const polling = async () => { const before = app.polls.length; await wait(150); return app.polls.length > before }
assert.equal(await polling(), true, 'fetched for favorites alone, with rolls, moves, removals and notes off')
for (const [features, why] of [
  [{ commands: true }, 'an answer without favorites'], [{ commands: true, favorites: 0 }, 'favorites: 0'],
  [{ commands: true, favorites: '1' }, 'favorites: "1"'], [{ commands: true, favorites: true }, 'favorites: true'],
  [{ favorites: 1 }, 'without commands'],
]) {
  app.features = { ...features, groups: 1 }
  announce({ campaignId: 'camp-a' })
  await settle()
  assert.equal(await polling(), false, why)
}
app.features = { commands: true, favorites: 1, groups: 1 }
game.system.id = 'pf2e'
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), false, 'another system')
game.system.id = 'dnd5e'
// The answer that first says `favorites: 1` starts the fetching itself, as removals.mjs's does: a
// hello's own sync runs before its answer comes, reading what the answer before it said.
app.features = { commands: true, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), false, 'stopped again by an answer without favorites')
app.features = { commands: true, favorites: 1, groups: 1 }
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(await polling(), true, 'fetched again once the answer says so, started by that answer')
// A roll fetched while only favorites are, as the app wouldn't hand over: refused as made while rolls are off.
const roll = await made({ id: `roll-${++ids}`, actorId: 'thorin', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }] })
assert.deepEqual(refusal(roll), ['failed', 'off', null])
okay('with rolls, moves, removals and notes off, the campaign is fetched for only after an answer with features.favorites 1 and commands, the first such answer starting it itself; 0, "1", true or none don\'t count, and an answer without it stops the fetching; never under another system; a roll fetched then is refused `off`')

/* -------------------------------------------- */
/*  3. Add, each type                           */
/* -------------------------------------------- */

let it
let lines = messages.size
for (const [command, entry, listed, why] of [
  [add('item', 'sword'), ['item', '.Item.sword'], ['item', 'sword', null], 'the Longsword'],
  [add('activity', 'fireball', { item: 'staff' }), ['activity', '.Item.staff.Activity.fireball'], ['activity', 'fireball', 'staff'], "the Staff's Cast Fireball"],
  [add('effect', 'bless'), ['effect', '.ActiveEffect.bless'], ['effect', 'bless', null], 'Bless, on Thorin'],
  [add('effect', 'cloak.ward'), ['effect', '.Item.cloak.ActiveEffect.ward'], ['effect', 'cloak.ward', null], "the Cloak's effect"],
  [add('skill', 'prc'), ['skill', 'prc'], ['skill', 'prc', null], 'Perception'],
  [add('tool', 'thief'), ['tool', 'thief'], ['tool', 'thief', null], "Thieves' Tools"],
  [add('slots', 'spell1'), ['slots', 'spell1'], ['slots', 'spell1', null], '1st-level slots'],
]) {
  const sort = highest() + CONST.SORT_INTEGER_DENSITY
  const updates = port.updates
  it = await made(command)
  done(it, true)
  assert.deepEqual(stored().at(-1), [...entry, sort], `${why}: stored last, as dnd5e's menus store it, its sort the highest and more`)
  assert.equal(port.updates, updates + 1, `${why}: one update`)
  assert.deepEqual(sheetsIn(it), [['character.updated', 'thorin']], `${why}: the sheet before the result`)
  assert.deepEqual(sentFavorites(it).at(-1), listed, `${why}: last in the sheet sent`)
  await settle()
}
assert.equal(messages.size, lines, 'no chat message')
okay("an Add of an item, an activity, an effect on Thorin or on his Cloak, a skill, a tool and a pool of slots stores each as dnd5e's menus do (`.Item.sword`, `.Item.staff.Activity.fireball`, `.ActiveEffect.bless`, `.Item.cloak.ActiveEffect.ward`, `prc`, `thief`, `spell1`), last, its sort the highest plus SORT_INTEGER_DENSITY, in one update; Thorin's sheet, listing it last, goes ahead of the result, `done` with `favorited: true`, no message, visible; nothing posted in chat")

/* -------------------------------------------- */
/*  4. The wands                                */
/* -------------------------------------------- */

done(await made(add('activity', STATIC, { item: 'wandA' })), true)
await settle()
it = await made(add('activity', STATIC, { item: 'wandB' }))
done(it, true)
assert.deepEqual(stored().slice(-2).map(([type, id]) => [type, id]), [['activity', `.Item.wandA.Activity.${STATIC}`], ['activity', `.Item.wandB.Activity.${STATIC}`]])
assert.deepEqual(sentFavorites(it).filter(([type, id]) => (type === 'activity') && (id === STATIC)), [['activity', STATIC, 'wandA'], ['activity', STATIC, 'wandB']], 'the sheet sent lists both')
okay(`the two Wands' activities, of one id (${STATIC}), are two favorites, \`.Item.wandA.Activity.${STATIC}\` and \`.Item.wandB.Activity.${STATIC}\`, and the sheet lists both`)

/* -------------------------------------------- */
/*  5. Already so                               */
/* -------------------------------------------- */

// The Cloak made a favorite in Foundry a moment before, its own resend not yet sent: the app's
// sheet doesn't show it, so its player adds it. Nothing is written; the newer sheet goes first.
await settle()
let updates = port.updates
thorin.system.favorites.push({ type: 'item', id: '.Item.cloak', sort: highest() + CONST.SORT_INTEGER_DENSITY })
it = await made(add('item', 'cloak'))
done(it, true)
assert.equal(port.updates, updates, 'an Add of a favorite: nothing written')
assert.deepEqual(sheetsIn(it), [['character.updated', 'thorin']], 'the sheet, which now lists it, before the result')
assert.deepEqual(sentFavorites(it).at(-1), ['item', 'cloak', null])
assert.equal(thorin.system.favorites.filter(f => f.id === '.Item.cloak').length, 1, 'once')
// And taken out in Foundry again a moment before its player removes it.
await settle()
thorin.system.favorites = thorin.system.favorites.filter(f => f.id !== '.Item.cloak')
it = await made(drop('item', 'cloak'))
done(it, false)
assert.equal(port.updates, updates, 'a Remove of none: nothing written')
assert.deepEqual(sheetsIn(it), [['character.updated', 'thorin']], 'the sheet, which no longer lists it, before the result')
assert.ok(!sentFavorites(it).some(([type, id]) => (type === 'item') && (id === 'cloak')))
// Where the app's sheet is already as it is, an unchanged sheet isn't sent again.
await settle()
it = await made(add('item', 'sword'))
done(it, true)
assert.deepEqual([port.updates, sheetsIn(it)], [updates, []], 'the Longsword again: nothing written, nothing new to send')
for (const command of [drop('skill', 'ste'), drop('item', 'nothing'), drop('activity', 'strike', { item: 'staff' })]) {
  done(await made(command), false)
}
assert.equal(port.updates, updates, 'a Remove of what never was one, or of nothing there: nothing written')
// dnd5e's update cancelled, as a preUpdateActor hook may: its method resolves with nothing written,
// so `favorited` is what dnd5e now has, not what was asked.
port.faults.dropUpdate = true
const cancelled = [await made(add('item', 'potion')), await made(drop('item', 'rope'))]
port.faults.dropUpdate = false
done(cancelled[0], false)
done(cancelled[1], true)
assert.deepEqual([port.updates, thorin.system.hasFavorite('.Item.potion'), thorin.system.hasFavorite('.Item.rope')], [updates + 2, false, true], 'each update tried, nothing written')
assert.deepEqual(cancelled.map(sheetsIn), [[], []], 'nothing changed, nothing new to send')
okay("an Add of what's a favorite already, as one made in Foundry a moment before, is `done`, `favorited: true`, with nothing written, the newer sheet ahead of the result; a Remove of what isn't, as one taken out in Foundry a moment before, `done`, `favorited: false`, nothing written, the sheet ahead; an unchanged sheet isn't sent again; a Remove of Stealth, of an item that isn't there, or an activity never made one, `done`, nothing written; an Add and a Remove whose update is cancelled, `done`, `favorited` as dnd5e now has it, `false` and `true`")

/* -------------------------------------------- */
/*  6. Remove                                   */
/* -------------------------------------------- */

await settle()
updates = port.updates
it = await made(drop('item', 'sword'))
done(it, false)
assert.ok(!thorin.system.favorites.some(f => f.id === '.Item.sword'), '`.Item.sword` removed by `sword`')
assert.deepEqual([port.updates, sheetsIn(it)], [updates + 1, [['character.updated', 'thorin']]], 'one update, the sheet before the result')
assert.ok(!sentFavorites(it).some(([type, id]) => (type === 'item') && (id === 'sword')))
done(await made(drop('effect', 'cloak.ward')), false)
assert.ok(!thorin.system.favorites.some(f => f.id === '.Item.cloak.ActiveEffect.ward'), "the Cloak's effect removed by `cloak.ward`")
done(await made(drop('activity', STATIC, { item: 'wandA' })), false)
assert.deepEqual(thorin.system.favorites.filter(f => f.id.endsWith(`.Activity.${STATIC}`)).map(f => f.id), [`.Item.wandB.Activity.${STATIC}`], "the other wand's kept")
// The Torch made a favorite, then deleted in Foundry with its favorite left, as dnd5e leaves it on
// a client that didn't delete it: its favorite can still go.
done(await made(add('item', 'torch')), true)
await settle()
thorin.items.delete('torch')
it = await made(drop('item', 'torch'))
done(it, false)
assert.ok(!thorin.system.favorites.some(f => f.id === '.Item.torch'), "the deleted Torch's favorite removed")
okay("a Remove passes the stored id: `.Item.sword` by `sword`, the Cloak's effect by `cloak.ward`, one Wand's activity, the other's kept, each in one update with the sheet ahead of the result, `done`, `favorited: false`; a favorite of a Torch deleted since goes too")

/* -------------------------------------------- */
/*  7. Refusals                                 */
/* -------------------------------------------- */

await settle()
// A crafted entry of a resource's id, as no dnd5e menu stores one: were a Remove of it ever made,
// dnd5e would zero Ki's maximum.
thorin.system.favorites.push({ type: 'tool', id: 'resources.primary', sort: 1 })
updates = port.updates
lines = messages.size
const before = stored()
const shaped = favorite => ({ id: `favorite-${++ids}`, ...BASE, favorite })
for (const [command, error, why] of [
  [{ ...add('item', 'rope'), of: 'wolf' }, 'of', "the Wolf's, by `of`"],
  [{ ...add('item', 'rope'), by: 'gm' }, 'by', "the Gamemaster's"],
  [{ ...add('item', 'rope'), by: 'player' }, 'by', "by: 'player'"],
  [shaped(undefined), 'favorite', 'favorite missing'],
  [shaped([{ op: 'add', type: 'item', id: 'rope' }]), 'favorite', 'an array'],
  [shaped('rope'), 'favorite', 'a string'],
  [shaped({ op: 'toggle', type: 'item', id: 'rope' }), 'favorite', 'an op neither add nor remove'],
  [shaped({ op: 'add', type: 'resource', id: 'primary' }), 'favorite', 'a `resource` type'],
  [shaped({ op: 'add', type: 'facility', id: 'forge' }), 'favorite', 'a type dnd5e has no menu for'],
  [shaped({ op: 'add', type: 'item', id: 'rope', item: 'rope' }), 'favorite', '`item` on an item'],
  [shaped({ op: 'add', type: 'activity', id: 'strike' }), 'favorite', 'no `item` on an activity'],
  [shaped({ op: 'add', type: 'item', id: 'rope', sort: 1 }), 'favorite', 'an extra key'],
  [shaped({ op: 'add', type: 'item' }), 'favorite', 'no id'],
  [shaped({ op: 'add', type: 'item', id: '.Item.rope' }), 'favorite', 'an id as stored'],
  [shaped({ op: 'add', type: 'item', id: '' }), 'favorite', 'an empty id'],
  [shaped({ op: 'add', type: 'item', id: 5 }), 'favorite', 'an id not a string'],
  [shaped({ op: 'add', type: 'item', id: 'r'.repeat(65) }), 'favorite', 'an id too long'],
  [shaped({ op: 'add', type: 'activity', id: 'strike', item: '.Item.staff' }), 'favorite', "an activity's item not an id"],
  [shaped({ op: 'add', type: 'effect', id: 'cloak.ward.x' }), 'favorite', 'a two-dot effect id'],
  [shaped({ op: 'add', type: 'effect', id: 'cloak.' }), 'favorite', 'an effect id ending in a dot'],
  [shaped({ op: 'remove', type: 'tool', id: 'resources.primary' }), 'favorite', 'a `tool` id `resources.primary`'],
  [shaped({ op: 'remove', type: 'slots', id: 'resources.primary' }), 'favorite', 'a `slots` id `resources.primary`'],
  [shaped({ op: 'add', type: 'skill', id: 'p rc' }), 'favorite', 'a skill not a key'],
  [{ ...add('item', 'rope'), item: 'rope' }, 'favorite', 'a top-level item'],
  [{ ...add('item', 'rope'), key: 'prc' }, 'favorite', 'a key'],
  [{ ...add('item', 'rope'), remove: { item: 'rope', quantity: 1, held: 1 } }, 'favorite', 'a removal'],
  [{ ...add('item', 'rope'), transfer: { from: 'thorin', to: 'vex', items: [{ id: 'rope', quantity: 1 }] } }, 'favorite', 'a move'],
  [{ ...add('item', 'rope'), typed: true }, 'favorite', 'typed: true'],
  [{ ...add('item', 'rope'), typed: false }, 'favorite', 'typed: false'],
  [{ ...add('item', 'rope'), dice: [{ faces: 20, results: [12] }] }, 'dice', 'a die'],
  [{ ...add('item', 'rope'), mode: 1 }, 'dice', 'advantage'],
  [{ ...add('item', 'rope'), extras: [{ sign: 1, count: 1, sides: 4 }] }, 'dice', 'something added'],
]) {
  it = await made(command)
  assert.equal(thorin.system.resources.primary.max, 4, `${why}: Ki's maximum still 4`)
  assert.deepEqual(refusal(it), ['failed', 'invalid', error], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
assert.deepEqual([port.updates, messages.size, stored()], [updates, lines, before], 'nothing written or posted')
thorin.system.favorites = thorin.system.favorites.filter(f => f.id !== 'resources.primary')
okay("refuses as `invalid` a favorite for a companion (`of`), the Gamemaster's or a `by` but theirs (`by`); one without `favorite`, or one not `{op, type, id}` of add or remove and dnd5e's six types, with `item` for an activity alone, an id not as the sheet names it, a `resource` or a `resources.primary` key among them, or a roll's field, a removal, a move or `typed` beside it (`favorite`); dice, advantage or anything added (`dice`): nothing written, posted or sent, Ki's maximum still 4")

for (const [actorId, why] of [['stranger', 'an actor outside the campaign'], ['party', 'the Company'], ['wolf', 'the Wolf, an NPC'], ['fallen', 'a character whose actor is gone'], ['vex', "Vex, whose actor has no dnd5e favorites"]]) {
  it = await made(add('item', { stranger: 'srope', party: 'prope', wolf: 'nothing', fallen: 'rope', vex: 'lute' }[actorId], { actorId }))
  assert.deepEqual(refusal(it), ['failed', 'unknown', null], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
// The Company listed among the characters as well, as a stored setting might: still no character.
campaignAs({ characters: [...CAMPAIGN.characters, 'party'] })
assert.deepEqual(refusal(await made(add('item', 'prope', { actorId: 'party' }))), ['failed', 'unknown', null], 'the Company among the characters too')
campaignAs()
await settle()
for (const [command, why] of [
  [add('item', 'veiled'), 'the Veiled Gift, which dnd5e hides from the sheet'],
  [add('item', 'nothing'), 'an item Thorin lacks'],
  [add('item', 'lute'), "Vex's Lute"],
  [add('activity', 'secret', { item: 'staff' }), "the Staff's Old Power, which its player can't see"],
  [add('activity', 'strike', { item: 'wandA' }), "the Staff's Strike, named on a Wand"],
  [add('activity', 'nothing', { item: 'staff' }), 'an activity the Staff lacks'],
  [add('effect', 'nothing'), 'an effect Thorin lacks'],
  [add('effect', 'nothing.ward'), 'an effect of an item Thorin lacks'],
  [add('effect', 'rope.ward'), "the Cloak's effect, named on the Rope"],
  [add('skill', 'ste'), 'Stealth, not his'],
  [add('tool', 'herb'), 'a tool he lacks'],
  [add('slots', 'spell9'), 'a pool he lacks'],
  // Keys every object has, as dnd5e's skills, tools and spells are plain objects: dnd5e's own sheet
  // can't draw a tool or a skill favorite of one.
  [add('tool', 'constructor'), 'a tool `constructor`'],
  [add('slots', 'toString'), 'a pool `toString`'],
  [add('skill', 'hasOwnProperty'), 'a skill `hasOwnProperty`'],
]) {
  it = await made(command)
  assert.deepEqual(refusal(it), ['failed', 'gone', null], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
assert.deepEqual([port.updates, messages.size, stored()], [updates, lines, before.filter(([, id]) => id !== 'resources.primary')], 'nothing written or posted')
// Such a favorite stored by other means, as no menu stores one, isn't in the sheet either.
const proto = [{ type: 'tool', id: 'constructor', sort: 1 }, { type: 'slots', id: 'toString', sort: 2 }, { type: 'skill', id: 'hasOwnProperty', sort: 3 }]
thorin.system.favorites.push(...proto)
assert.deepEqual(characterSheet(thorin).favorites.filter(f => proto.some(({ id }) => id === f.id)), [], 'none of them in the sheet')
thorin.system.favorites = thorin.system.favorites.filter(f => !proto.includes(f))
okay("refuses as `unknown` a favorite of an actor outside the campaign, its party, even listed among its characters, the Wolf, a character whose actor is gone, and Vex, a campaign character whose actor has no dnd5e favorites; as `gone` an Add of what Thorin's sheet doesn't list: an item he lacks, one dnd5e hides, Vex's, an activity hidden, on another item or missing, an effect missing or of an item he lacks or another, a skill, tool or pool he lacks, among them a tool `constructor`, a pool `toString` and a skill `hasOwnProperty`, which every object has: nothing written, posted or sent; and the sheet lists none of those three stored by other means")

port.faults.throwOnAdd = true
it = await made(add('item', 'potion'))
port.faults.throwOnAdd = false
assert.deepEqual(refusal(it), ['failed', 'error', 'The item with id .Item.potion is not owned by actor thorin'])
assert.deepEqual([sheetsIn(it), port.updates, messages.size, thorin.system.hasFavorite('.Item.potion')], [[], updates, lines, false], 'nothing written or posted')
okay("dnd5e's addFavorite throwing is `error` with its message: nothing written, no sheet, no line")

// A favorite is checked as it's made, not as it's fetched: one taken while a removal of Thorin's
// still writes, made after the system has changed or the Gamemaster has deleted the campaign, is `off`.
for (const [change, undo, why] of [
  [() => { game.system.id = 'pf2e' }, () => { game.system.id = 'dnd5e' }, 'another system'],
  [() => settings.set('campaigns', []), () => campaignAs(), 'the campaign gone'],
]) {
  const ahead = hold(target => target.id === 'potion')
  const first = removal('potion', 1, thorin.items.get('potion').system.quantity)
  handOver(first)
  await until(() => ahead.held, `the Potion's update (${why})`)
  const behind = add('item', 'pickaxe')
  handOver(behind)
  await until(() => !app.waiting.get('camp-a')?.length, `the favorite's fetch (${why})`)
  const polls = app.polls.length
  await until(() => app.polls.length > polls, `the fetch after it (${why})`)
  change()
  ahead.release()
  await until(() => resultsOf(behind.id).length, `the favorite's result (${why})`)
  undo()
  assert.deepEqual([resultsOf(first.id)[0].status, refusal({ result: resultsOf(behind.id)[0] })], ['done', ['failed', 'off', null]], why)
  assert.equal(thorin.system.hasFavorite('.Item.pickaxe'), false, `${why}: not made a favorite`)
  announce({ campaignId: 'camp-a' })
  await settle()
}
okay("a favorite taken while a removal of Thorin's still writes, made once the system isn't dnd5e or the campaign is gone, is `off`, the Pick Axe not made a favorite")

/* -------------------------------------------- */
/*  8. Order                                    */
/* -------------------------------------------- */

await settle()
updates = port.updates
const [adding, removing] = await fetched(add('item', 'potion'), drop('item', 'potion'))
done(adding, true)
done(removing, false)
assert.ok(resultIndex(adding.command.id) < resultIndex(removing.command.id), 'in the order fetched')
assert.deepEqual([port.updates, thorin.system.hasFavorite('.Item.potion')], [updates + 2, false], 'made, then removed')
const [potion, staff] = await fetched(add('item', 'potion'), add('item', 'staff'))
done(potion, true)
done(staff, true)
const sortOf = id => thorin.system.favorites.find(f => f.id === id).sort
assert.ok(sortOf('.Item.staff') > sortOf('.Item.potion'), 'the second last')
assert.deepEqual(stored().slice(-2).map(([, id]) => id), ['.Item.potion', '.Item.staff'])
const [taken, rope] = await fetched(removal('rope', 1), add('item', 'rope'))
assert.equal(taken.result.status, 'done')
assert.deepEqual(refusal(rope), ['failed', 'gone', null], 'the Rope removed first: gone')
okay("an Add and a Remove of the Potion fetched together are made in that order, ending not a favorite; two Adds fetched together, the second last, its sort the higher; a removal of the Rope ahead of an Add of it leaves the Add `gone`")

// ---- END ----
console.log(`favoriting${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
