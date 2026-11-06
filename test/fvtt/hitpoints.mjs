// Hit points and temporary hit points set from the app (module 0.44.0, the v0.44 plan's item 4): the
// hello's `features.hitPoints`, last, after `wildShape`, by the campaign's own switch, on for a campaign
// saved without it, under D&D Fifth Edition; the fetching it needs with every other switch off; the
// `hitPoints` command's checks in their order, each refusal with nothing written; "unknown" for an actor
// not the campaign's, a group, a companion not `of`'s and an actor with no hit points; "changed" for a
// field that isn't what the app showed, the sheet sent ahead of it; one plain update of the character
// or a companion, a world actor's or a token's creature's, hit points within the maximum the sheet
// shows, temporary ones as given; nothing written for what's already so; a hook that stops the write,
// and Foundry's throw; the result's `hitPoints`, the sheet ahead of it; one at a time; and what dnd5e
// does around any change of hit points (hp-core.mjs): a concentration challenged where they go down,
// asked in the app where its prompts are, its floating numbers, its hooks, death saves reset on the
// way up from 0, and with DND5E6=1 dnd5e 6's downed conditions; Manage Campaigns and the settings
// row. With MIDI=1, midi-fake.mjs's Midi-QOL, which runs no workflow for it. A form's, and the end of
// a Wild Shape at 0, are in wildshape.mjs. The real module and its language file; dnd5e 5.3.3's real
// dice classes, or 6.0.5's with DND5E6=1; dnd5e's actors ported (actor5e.mjs, dnd5e-cards.mjs'
// concentration), scenes, tokens and their creatures as v14 has them (token-core.mjs); a stand-in
// Foundry core and app. Timers of a second or more run a hundred times faster. Run with SLIM_CHECK=1
// and --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'
import { find, openSettings, save, tick, view } from './settings-app.mjs'
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
const MIDI = Boolean(process.env.MIDI)
const DND5E = DND5E6 ? `${DND5E6_ROOT}/module/dice` : `${DND5E5}/module/dice`
let oks = 0
const ok = message => { oks++; console.log('ok -', message) }

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
const realSetInterval = globalThis.setInterval
globalThis.setInterval = (fn, ...args) => ((fn?.name === 'heartbeat') ? { unref() {}, ref() {} } : realSetInterval(fn, ...args))
foundry.utils.debounce = (fn, ms) => {
  let timer
  return (...args) => { clearTimeout(timer); timer = realSetTimeout(() => fn(...args), Math.max(1, ms / 10)) }
}
const { window } = new JSDOM('', { pretendToBeVisual: true })
Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement })
globalThis.DOMParser = window.DOMParser
if (DND5E6) game.system.version = '6.0.5'

const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex', concentration: 'con' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: { piercing: { label: 'Piercing' } },
  healingTypes: { healing: { label: 'Healing' } },
  actorSizes: { medium: { label: 'Medium' } },
  activityActivationTypes: { action: { label: 'Action' }, bonus: { label: 'Bonus Action' }, reaction: { label: 'Reaction' } },
  characterFlags: {},
}
CONFIG.specialStatusEffects = { CONCENTRATING: 'concentrating' }
globalThis.dnd5e = { settings: { rulesVersion: 'modern', autoApplyDowned: 'none' } }
settings.set('messageMode', 'public')
settings.set('challengeVisibility', 'player')
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))
foundry.utils.escapeHTML ??= value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return html } } }
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }

// The module's own words, from its language file, as Foundry's i18n gives them.
const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object')
  ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])
const words = Object.fromEntries(flat(JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))))
game.i18n.localize = key => words[key] ?? key
game.i18n.has = key => Object.hasOwn(words, key)
game.i18n.format = (key, data = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ''))
ui.notifications.error = () => {}
ui.notifications.info = () => {}

const { Actor5e } = await import('./actor5e.mjs')
await import('./activity5e.mjs')
const { Character } = await import('./dnd5e-cards.mjs')
const { companionActor, placeToken, scene } = await import('./token-core.mjs')
const { hpLog, withHitPoints } = await import('./hp-core.mjs')
const generation = DND5E6 ? 6 : 5

// ---- The world: the Gamemaster, the bridge, and two players ----
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
let midiQol = null
if (MIDI) {
  const fake = await import('./midi-fake.mjs')
  fake.installMidi()
  midiQol = globalThis.MidiQOL
}
const add = actor => { actors.set(actor.id, actor); return actor }
// Thorin, Alice's, 22 of 30 hit points and 3 temporary; Vex, Bob's; Shade, whose hit points are none.
const thorin = withHitPoints(add(new Character({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { con: 2 }, hp: { value: 22, max: 30, temp: 3 } })), { generation })
alice.character = thorin
const vex = withHitPoints(add(new Character({ id: 'vex', name: 'Vex', owners: ['bob'], hp: { value: 18, max: 18, temp: 0 } })), { generation })
bob.character = vex
const shade = add(new Character({ id: 'shade', name: 'Shade', owners: ['bob'], hp: { value: null, max: 10, temp: 0 } }))
for (const each of [thorin, vex, shade]) each.type = 'character'
// The Company, a Group actor of the campaign's.
const party = add({
  documentName: 'Actor', id: 'party', name: 'The Company', type: 'group', uuid: 'Actor.party', img: 'party.webp', flags: {},
  ownership: { default: 0, alice: 3 }, system: { members: [], description: { full: '', summary: '' }, attributes: { hp: { value: 5, max: 5, temp: 0 } } },
  effects: [], items: new Map(),
  getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
  testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
  *allApplicableEffects() { yield* this.effects },
})
// Thorin's companions: Brakka, a linked sidekick Alice owns, important; a wolf, unlinked, its token
// on the active scene, Alice's.
const arena = scene('arena', { active: true })
const brakka = withHitPoints(companionActor('brakka', 'Brakka', {
  owners: ['alice'], linked: true, spec: { mods: { str: 3 }, hp: { value: 30, max: 30, temp: 0 } }, system: { traits: { important: true } },
}), { generation })
const wolfBase = companionActor('wolf', 'Wolf', { owners: ['alice'], linked: false, spec: { mods: { dex: 2 }, hp: { value: 11, max: 11, temp: 0 } } })
const wolf1 = placeToken(arena, wolfBase, { id: 'wolf1', name: 'Wolf' })
const wolf = withHitPoints(wolf1.actor, { generation, coreHooks: false })

// ---- The app: commands, hit points and companions, unless told to say otherwise ----
const app = { events: [], polls: [], waiting: new Map(), wake: null, features: new Map() }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const id = body.campaign?.id
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    return ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
      ? json({ features: app.features.get(id) ?? { commands: true, hitPoints: 1, companions: 1 } })
      : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.polls.push(id)
    if (!app.waiting.get(id)?.length) {
      await new Promise(resolve => {
        const timer = realSetTimeout(resolve, 30)
        app.wake = () => { clearTimeout(timer); resolve() }
        init.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    const commands = app.waiting.get(id) ?? []
    app.waiting.set(id, [])
    return json({ commands, open: [] })
  }
  throw new TypeError(`Unexpected fetch of ${url}`)
}
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
const settle = (ms = 40) => new Promise(resolve => realSetTimeout(resolve, ms))
const sent = (type, id = 'camp-a') => app.events.filter(e => (e.type === type) && (e.campaign?.id === id))
const helloOf = (id = 'camp-a') => sent('bridge.hello', id).at(-1).data
const resultIndex = id => app.events.findIndex(e => (e.type === 'command.result') && (e.data.id === id))

let ids = 0
const BASE = { actorId: 'thorin', kind: 'hitPoints', mode: 0, explicit: false, extras: [], dice: [] }
/** Hit points set, as the app hands it over: the numbers wanted, from those the app showed. */
const setting = (to, from, fields = {}) => ({ id: `hp-${++ids}`, ...BASE, hitPoints: { op: 'set', ...to, from }, ...fields })
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
const made = async command => (await fetched(command))[0]
const refusal = ({ result }) => [result.status, result.reason, result.error]
const DONE = { status: 'done', reason: null, error: null, messageId: null, visible: true, rolls: [] }
const hpOf = actor => {
  const { value, temp, max } = actor.system.attributes.hp
  return { value, temp, max }
}
/** The sheets of a character, or a companion by its key, sent between a command's fetch and its result. */
const characterSheets = ({ after }, id = 'thorin') => after.filter(e => (e.type === 'character.updated') && (e.data.character.id === id))
const companionSheets = ({ after }, key) => after.filter(e => (e.type === 'companion.updated') && (e.data.companion?.key === key))
/** Every write of hit points made, as the actors' updates see them. */
const writes = []
Hooks.on('preUpdateActor', (actor, changes, options) => {
  if (changes.system?.attributes?.hp) writes.push({ actor: actor.id, changes: foundry.utils.deepClone(changes), options: { ...options } })
})
const damaged = []
Hooks.on('dnd5e.damageActor', (actor, changes) => damaged.push(['damage', actor.id, changes.total]))
Hooks.on('dnd5e.healActor', (actor, changes) => damaged.push(['heal', actor.id, changes.total]))

// ---- Start-up, as Foundry would ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
// Saved before 0.44.0: no hitPoints key, every other switch off.
const CAMPAIGN = { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'shade'], groups: ['party'], rolls: false, attacks: false, transfers: false, dishes: false, effects: false, wildShape: false }
settings.set('campaigns', [CAMPAIGN])
await Hooks.callAll('ready')
await until(() => sent('bridge.hello').length, 'the hello')
await settle(80)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { hitPointReader } = await import(`${MODULE}/scripts/command-hit-points.mjs`)
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)

/** Change the campaign, as Manage Campaigns saves it, and wait for the hello that follows. */
async function campaignAs(fields) {
  const hellos = sent('bridge.hello').length
  await game.settings.set('sending-stone', 'campaigns', getCampaigns().map(campaign => ({
    ...campaign, characters: [...campaign.characters], groups: [...campaign.groups], ...fields,
  })))
  await until(() => sent('bridge.hello').length > hellos, 'the hello after a change')
  await settle()
}
/** Send the campaign its hello, and wait for what follows it. */
async function hello() {
  const hellos = sent('bridge.hello').length
  announce({ campaignId: 'camp-a' })
  await until(() => sent('bridge.hello').length > hellos, 'the hello')
  await settle(80)
}
/** Set an actor's hit points as the Gamemaster would in Foundry, or as the case needs, with no hooks. */
const quietly = (actor, hp) => Object.assign(actor.system.attributes.hp, hp)

/* -------------------------------------------- */
/*  1. The hello                                */
/* -------------------------------------------- */

const ON = { enabled: true, kinds: ['hitPoints'], reason: null }
const OFF = { enabled: false, kinds: [], reason: 'off' }
const SYSTEM = { enabled: false, kinds: [], reason: 'system' }
assert.equal(Object.hasOwn(settings.get('campaigns')[0], 'hitPoints'), false, 'saved without the key')
assert.deepEqual(helloOf().features.hitPoints, ON, 'on for a campaign saved without the switch')
assert.deepEqual(Object.keys(helloOf().features).at(-1), 'hitPoints', 'last, after wildShape')
assert.deepEqual(Object.keys(helloOf().features).slice(-2), ['wildShape', 'hitPoints'])
assert.equal(helloOf().features.rolls.enabled, false, 'whatever the rolls')
await campaignAs({ hitPoints: false })
assert.deepEqual(helloOf().features.hitPoints, OFF, 'a saved switch sends the hello again, off')
game.system.id = 'pf2e'
await hello()
assert.deepEqual(helloOf().features.hitPoints, OFF, '"off" before "system"')
await campaignAs({ hitPoints: true })
assert.deepEqual(helloOf().features.hitPoints, SYSTEM, 'under another system')
game.system.id = 'dnd5e'
await hello()
assert.deepEqual(helloOf().features.hitPoints, ON)
await campaignAs({ rolls: true, attacks: true })
assert.ok(!helloOf().features.rolls.kinds.includes('hitPoints') && !helloOf().features.companions.kinds.includes('hitPoints'), "never among the rolls' kinds, nor a companion's")
await campaignAs({ rolls: false, attacks: false })
ok(`the hello's features.hitPoints, last, after wildShape: on for a campaign saved without the switch, whatever its rolls; off with it off, "off" before "system"; "system" with it on under another system; on under dnd5e ${DND5E6 ? '6.0.5' : '5.3.3'}; never among the rolls' or a companion's kinds`)

/* -------------------------------------------- */
/*  2. Fetching                                 */
/* -------------------------------------------- */

const pollsOf = () => app.polls.filter(id => id === 'camp-a').length
const polling = async () => { const before = pollsOf(); await settle(150); return pollsOf() > before + 1 }
assert.equal(await polling(), true, 'fetched for, every other switch off, the answer saying hitPoints: 1')
for (const [features, why] of [
  [{ hitPoints: 1 }, 'without commands'], [{ commands: true, hitPoints: 0 }, 'hitPoints: 0'], [{ commands: true, hitPoints: '1' }, 'hitPoints: "1"'],
  [{ commands: true, hitPoints: true }, 'hitPoints: true'], [{ commands: true, companions: 1 }, 'an answer without hitPoints'],
]) {
  app.features.set('camp-a', features)
  await hello()
  await settle(60)
  assert.equal(await polling(), false, why)
}
assert.equal(hitPointReader('camp-a'), false, 'the reader dropped by an answer without hitPoints')
app.features.delete('camp-a')
await hello()
assert.equal(await polling(), true, 'fetched again')
await campaignAs({ hitPoints: false })
assert.equal(await polling(), false, 'not with the switch off')
await campaignAs({ rolls: true })
const offRoll = await made(setting({ value: 21 }, { value: 22 }))
assert.deepEqual(refusal(offRoll), ['failed', 'off', null], 'fetched with the rolls, refused "off"')
await campaignAs({ rolls: false, hitPoints: true })
assert.equal(await polling(), true)
ok('fetched for with every other switch off where the answer says "hitPoints": 1 with "commands": true, never for 0, "1", true or none; stopped by an answer without it, or with the switch off; one fetched with the switch off is refused "off"')

/* -------------------------------------------- */
/*  3. The checks                               */
/* -------------------------------------------- */

{
  const mark = writes.length
  const was = hpOf(thorin)
  const cases = [
    ['the Gamemaster', setting({ value: 21 }, { value: 22 }, { by: 'gm' }), 'by'],
    ['by anyone else', setting({ value: 21 }, { value: 22 }, { by: 'alice' }), 'by'],
    ['of not an id', setting({ value: 21 }, { value: 22 }, { of: 7 }), 'of'],
    ['no body', { ...setting({ value: 21 }, { value: 22 }), hitPoints: undefined }, 'hitPoints'],
    ['a body of no field', setting({}, {}), 'hitPoints'],
    ['an unknown op', { ...setting({ value: 21 }, { value: 22 }), hitPoints: { op: 'damage', value: 21, from: { value: 22 } } }, 'hitPoints'],
    ['10000', setting({ value: 10000 }, { value: 22 }), 'hitPoints'],
    ['-1', setting({ temp: -1 }, { temp: 3 }), 'hitPoints'],
    ['1.5', setting({ value: 1.5 }, { value: 22 }), 'hitPoints'],
    ['"21"', setting({ value: '21' }, { value: 22 }), 'hitPoints'],
    ['a stale from of 10000', setting({ value: 21 }, { value: 10000 }), 'hitPoints'],
    ["from's keys not the fields set", setting({ value: 21 }, { value: 22, temp: 3 }), 'hitPoints'],
    ['from missing a field', setting({ value: 21, temp: 0 }, { value: 22 }), 'hitPoints'],
    ['no from', { ...setting({ value: 21 }, { value: 22 }), hitPoints: { op: 'set', value: 21 } }, 'hitPoints'],
    ['an extra key', { ...setting({ value: 21 }, { value: 22 }), hitPoints: { op: 'set', value: 21, max: 40, from: { value: 22 } } }, 'hitPoints'],
    ['null for a field', setting({ value: null }, { value: 22 }), 'hitPoints'],
    ["a roll's field", setting({ value: 21 }, { value: 22 }, { key: 'prc' }), 'hitPoints'],
    ['an item', setting({ value: 21 }, { value: 22 }, { item: 'a', activity: 'b' }), 'hitPoints'],
    ['an effect beside it', setting({ value: 21 }, { value: 22 }, { effect: { op: 'disable', id: 'x' } }), 'hitPoints'],
    ['a spell slot beside it', setting({ value: 21 }, { value: 22 }, { spellSlot: { op: 'spend', id: 'spell1', from: 1 } }), 'hitPoints'],
    ['typed', setting({ value: 21 }, { value: 22 }, { typed: true }), 'hitPoints'],
    ['rerolls', setting({ value: 21 }, { value: 22 }, { rerolls: 'kept' }), 'hitPoints'],
    ['a plain roll beside it', setting({ value: 21 }, { value: 22 }, { plainRoll: { terms: [{ faces: 6, count: 1 }] } }), 'plainRoll'],
    ['effect dice', setting({ value: 21 }, { value: 22 }, { effectDice: [{ faces: 4, sign: 1, results: [2] }] }), 'effectDice'],
    ['dice', setting({ value: 21 }, { value: 22 }, { dice: [{ faces: 20, results: [3] }] }), 'dice'],
    ['advantage', setting({ value: 21 }, { value: 22 }, { mode: 1 }), 'dice'],
  ]
  for (const [why, command, error] of cases) {
    assert.deepEqual(refusal(await made(command)), ['failed', 'invalid', error], why)
  }
  assert.deepEqual([writes.length - mark, hpOf(thorin)], [0, was], 'nothing written')
}
ok('refused "invalid" with nothing written: "by" for the Gamemaster\'s, or anyone\'s; "of" not an id; "hitPoints" for a body that isn\'t exactly { op: "set", value?, temp?, from } of whole numbers 0 to 9999, from naming exactly the fields set, and for a roll\'s field, an item, another kind\'s, typed or rerolls beside it; "plainRoll", "effectDice" and "dice" as every kind\'s')

{
  const mark = writes.length
  for (const [why, command] of [
    ['not one of the campaign\'s', setting({ value: 1 }, { value: 1 }, { actorId: 'nobody' })],
    ['a group', setting({ value: 1 }, { value: 5 }, { actorId: 'party' })],
    ['no hit points', setting({ value: 1 }, { value: 1 }, { actorId: 'shade' })],
    ['a companion not of\'s', setting({ value: 1 }, { value: 30 }, { actorId: 'brakka', of: 'vex' })],
    ['a companion of no campaign character', setting({ value: 1 }, { value: 30 }, { actorId: 'brakka', of: 'stranger' })],
    ['a token not listed', setting({ value: 1 }, { value: 11 }, { actorId: 'arena-wolf9', of: 'thorin' })],
  ]) {
    assert.deepEqual(refusal(await made(command)), ['failed', 'unknown', null], why)
  }
  assert.equal(writes.length, mark, 'nothing written')
}
ok('"unknown": an actor not the campaign\'s, one of its groups, a character with no hit points, a companion that isn\'t of\'s now, of a character not the campaign\'s, a token not listed')

{
  // The Gamemaster changed them in Foundry meanwhile: 20 and 3 now.
  quietly(thorin, { value: 20 })
  const mark = writes.length
  const stale = await made(setting({ value: 21 }, { value: 22 }))
  assert.deepEqual(refusal(stale), ['failed', 'changed', null], 'hit points not as the app showed')
  const sheet = characterSheets(stale).at(-1)?.data.character.sheet
  assert.deepEqual([sheet?.hp?.value, sheet?.hp?.temp], [20, 3], 'the sheet as it stands, ahead of the refusal')
  const staleTemp = await made(setting({ temp: 0 }, { temp: 4 }))
  assert.deepEqual(refusal(staleTemp), ['failed', 'changed', null], 'temporary ones not as shown')
  const one = await made(setting({ value: 21, temp: 0 }, { value: 20, temp: 4 }))
  assert.deepEqual(refusal(one), ['failed', 'changed', null], 'one of two fields not as shown: neither written')
  assert.deepEqual([writes.length - mark, hpOf(thorin)], [0, { value: 20, temp: 3, max: 30 }])
  quietly(thorin, { value: 22 })
}
ok('"changed": hit points, temporary ones, or either of both, not what the app showed, as when the Gamemaster changed them in Foundry meanwhile: nothing written, the sheet as it stands sent ahead of the refusal')

/* -------------------------------------------- */
/*  4. Setting them                             */
/* -------------------------------------------- */

{
  // "You fall through the floor and take 4 damage": 3 temporary gone, then 1.
  thorin.concentrateOn('Bless')
  const shown = hpLog.shown.length
  const challenged = hpLog.challenged.length
  const cards = messages.size
  let mark = writes.length
  let it = await made(setting({ value: 21, temp: 0 }, { value: 22, temp: 3 }))
  assert.deepEqual(it.result, { id: it.command.id, ...DONE, hitPoints: { value: 21, max: 30, temp: 0 } })
  assert.deepEqual(hpOf(thorin), { value: 21, temp: 0, max: 30 })
  assert.deepEqual(writes.slice(mark).map(each => [each.actor, each.changes, each.options.sendingStone, each.options.dnd5e?.concentrationCheck]),
    [['thorin', { system: { attributes: { hp: { value: 21, temp: 0 } } } }, 'hitPoints', undefined]], 'one plain update of both, marked, never sparing the concentration check')
  const sheets = characterSheets(it)
  assert.deepEqual([sheets.at(-1)?.data.character.sheet.hp.value, sheets.at(-1)?.data.character.sheet.hp.temp], [21, 0], 'the sheet ahead of the result')
  assert.deepEqual(hpLog.shown.slice(shown).map(each => [each.actor, each.changes]), [['thorin', { hp: -1, temp: -3, total: -4 }]], "dnd5e's floating numbers")
  assert.deepEqual(hpLog.challenged.slice(challenged).map(each => [each.actor, each.dc]), [['thorin', 10]], 'concentration challenged, DC 10')
  assert.ok([...messages.values()].slice(cards).some(m => m.content.includes('data-type="concentration"')), "dnd5e's concentration card posted")
  assert.equal(it.result.messageId, null, 'no line in chat of its own')
  assert.deepEqual(damaged.at(-1), ['damage', 'thorin', -4], 'dnd5e.damageActor')
  if (MIDI) assert.equal(midiQol.Workflow.workflows.size, 0, "no Midi-QOL workflow: a plain update, not dnd5e's damage")

  // Value alone, up; temporary alone; healing a temporary loss asks nothing.
  mark = writes.length
  const challengedNow = hpLog.challenged.length
  it = await made(setting({ value: 25 }, { value: 21 }))
  assert.deepEqual([it.result.status, it.result.hitPoints, damaged.at(-1)], ['done', { value: 25, max: 30, temp: 0 }, ['heal', 'thorin', 4]], 'hit points alone, up: healed')
  it = await made(setting({ temp: 8 }, { temp: 0 }))
  assert.deepEqual([it.result.status, it.result.hitPoints], ['done', { value: 25, max: 30, temp: 8 }], 'temporary ones alone, any number')
  assert.deepEqual(writes.slice(mark).map(each => each.changes.system.attributes.hp), [{ value: 25 }, { temp: 8 }], 'each field alone')
  assert.equal(hpLog.challenged.length, challengedNow, 'going up asks no concentration check')

  // Above the maximum the sheet shows, with a temporary change to it, as from Aid: within it.
  thorin.system.attributes.hp.tempmax = 5
  it = await made(setting({ value: 99 }, { value: 25 }))
  assert.deepEqual([it.result.status, it.result.hitPoints, hpOf(thorin).value], ['done', { value: 35, max: 35, temp: 8 }, 35], 'within its maximum, 35 with Aid\'s 5')
  thorin.system.attributes.hp.tempmax = 0
  quietly(thorin, { value: 30 })

  // Already so: done with nothing written.
  mark = writes.length
  it = await made(setting({ value: 30, temp: 8 }, { value: 30, temp: 8 }))
  assert.deepEqual([it.result.status, it.result.hitPoints, writes.length - mark], ['done', { value: 30, max: 30, temp: 8 }, 0], 'already so: done, nothing written')
  it = await made(setting({ value: 99 }, { value: 30 }))
  assert.deepEqual([it.result.status, writes.length - mark], ['done', 0], 'at its maximum already: done, nothing written')
}
ok('set: hit points and temporary ones at once by one plain update marked "hitPoints", the sheet ahead of the result, which says what they are now; dnd5e then shows its floating numbers, challenges the concentration at DC 10 and fires damageActor; hit points alone up, healActor, no concentration check; temporary ones alone, any number; within the maximum the sheet shows, its temporary change counted; already so, nothing written; no chat line' + (MIDI ? '; no Midi-QOL workflow' : ''))

{
  // Down to 0, and back up: dnd5e resets the death saves.
  thorin.system.attributes.death = { success: 1, failure: 2, roll: { mode: 0 }, bonuses: { save: '' } }
  let it = await made(setting({ value: 0, temp: 0 }, { value: 30, temp: 8 }))
  assert.deepEqual([it.result.status, it.result.hitPoints], ['done', { value: 0, max: 30, temp: 0 }], '0 is allowed')
  assert.deepEqual([thorin.system.attributes.death.success, thorin.system.attributes.death.failure], [1, 2], 'no death save added, none reset')
  it = await made(setting({ value: 5 }, { value: 0 }))
  assert.deepEqual([it.result.status, thorin.system.attributes.death.success, thorin.system.attributes.death.failure], ['done', 0, 0], 'back above 0: dnd5e resets the death saves')
  quietly(thorin, { value: 22, temp: 3 })
}
ok('0 is allowed, adding no death save; back above 0, dnd5e resets the death saves')

{
  // A hook that stops the write; Foundry's throw.
  const mark = writes.length
  const stop = Hooks.on('preUpdateActor', (actor, changes, options) => (options?.sendingStone === 'hitPoints') ? false : undefined)
  let it = await made(setting({ value: 21 }, { value: 22 }))
  Hooks.off('preUpdateActor', stop)
  assert.deepEqual([...refusal(it), hpOf(thorin).value, characterSheets(it).length], ['failed', 'cancelled', null, 22, 0], 'stopped: "cancelled", read again, no sheet')
  const own = thorin.update
  thorin.update = async () => { throw new Error('The server refused it') }
  it = await made(setting({ value: 21 }, { value: 22 }))
  thorin.update = own
  assert.deepEqual(refusal(it), ['failed', 'error', 'The server refused it'], "Foundry's throw, its words")
  assert.deepEqual([writes.length - mark, hpOf(thorin).value], [1, 22], 'nothing written but the one a hook stopped')
}
ok('a write a hook stops is "cancelled", read again, with no sheet; one Foundry throws on is "error", with what it said')

{
  // One at a time: the second from what the first leaves.
  const first = setting({ value: 20 }, { value: 22 })
  const second = setting({ value: 15 }, { value: 20 })
  const [a, b] = await fetched(first, second)
  assert.deepEqual([a.result.status, b.result.status, hpOf(thorin).value], ['done', 'done', 15], 'made in order, the second from the first\'s')
  assert.ok(resultIndex(first.id) < resultIndex(second.id))
  // Handed over twice, made once.
  const mark = writes.length
  const twice = setting({ value: 16 }, { value: 15 })
  await fetched(twice)
  app.waiting.set('camp-a', [twice])
  app.wake?.()
  await settle(120)
  assert.deepEqual([writes.length - mark, app.events.filter(e => (e.type === 'command.result') && (e.data.id === twice.id)).length], [1, 1], 'handed over again, made and told once')
  quietly(thorin, { value: 22, temp: 3 })
}
ok("one at a time, behind the character's earlier command, in order; handed over again, made once")

/* -------------------------------------------- */
/*  5. Companions                               */
/* -------------------------------------------- */

{
  const mark = writes.length
  let it = await made(setting({ value: 24 }, { value: 30 }, { actorId: 'brakka', of: 'thorin' }))
  assert.deepEqual(it.result, { id: it.command.id, ...DONE, hitPoints: { value: 24, max: 30, temp: 0 } })
  assert.deepEqual([hpOf(brakka).value, writes.slice(mark).map(each => each.actor)], [24, ['brakka']], "Brakka's own, a world actor's")
  assert.equal(companionSheets(it, 'brakka').at(-1)?.data.sheet?.hp?.value, 24, 'its sheet ahead of the result')
  // The wolf's token: its delta, never its world actor.
  const shown = hpLog.shown.length
  it = await made(setting({ value: 4, temp: 2 }, { value: 11, temp: 0 }, { actorId: 'arena-wolf1', of: 'thorin' }))
  assert.deepEqual(it.result, { id: it.command.id, ...DONE, hitPoints: { value: 4, max: 11, temp: 2 } })
  assert.deepEqual([hpOf(wolf).value, hpOf(wolf).temp, wolf1.delta.system.attributes.hp, wolfBase.system.attributes.hp.value], [4, 2, { value: 4, temp: 2 }, 11],
    "the token's creature's, written to its delta; the world Wolf's untouched")
  assert.equal(companionSheets(it, 'arena-wolf1').at(-1)?.data.sheet?.hp?.value, 4, 'its sheet ahead of the result')
  assert.deepEqual(hpLog.shown.slice(shown).map(each => [each.uuid, each.changes.total]), [['Scene.arena.Token.wolf1.Actor.wolf', -5]], "dnd5e's numbers over its token")
  // Stale, as for a character: hurt in Foundry meanwhile, to 3.
  quietly(wolf, { value: 3 })
  it = await made(setting({ value: 2 }, { value: 4 }, { actorId: 'arena-wolf1', of: 'thorin' }))
  assert.deepEqual([...refusal(it), hpOf(wolf).value], ['failed', 'changed', null, 3])
  assert.equal(companionSheets(it, 'arena-wolf1').at(-1)?.data.sheet?.hp?.value, 3, "its sheet as it stands, ahead of the refusal")
  quietly(wolf, { value: 4 })
  // A companion's command waits for its character's, and its character's for it.
  const own = setting({ value: 21 }, { value: 22 })
  const its = setting({ value: 30 }, { value: 24 }, { actorId: 'brakka', of: 'thorin' })
  const [x, y] = await fetched(own, its)
  assert.deepEqual([x.result.status, y.result.status], ['done', 'done'])
  assert.ok(resultIndex(own.id) < resultIndex(its.id), 'in the order sent')
  quietly(thorin, { value: 22, temp: 3 })
}
ok("a companion's, named by of: a linked one's on its world actor, a token's creature's on its delta alone, its world actor untouched, dnd5e's numbers over its token; its sheet ahead of the result or a \"changed\" refusal; queued with its character's commands")

/* -------------------------------------------- */
/*  6. Asked in the app                         */
/* -------------------------------------------- */

{
  await campaignAs({ rolls: true, prompts: true })
  const asked = sent('roll.prompt.opened').length
  const it = await made(setting({ value: 12 }, { value: 22 }))
  assert.equal(it.result.status, 'done')
  await until(() => sent('roll.prompt.opened').length > asked, 'the concentration check asked in the app')
  const prompt = sent('roll.prompt.opened').at(-1).data.prompt
  assert.deepEqual([prompt.actorId, prompt.type], ['thorin', 'concentration'], "dnd5e's concentration check, asked of Thorin's player in the app")
  await campaignAs({ rolls: false, prompts: false })
  quietly(thorin, { value: 22, temp: 3 })
}
ok("where the campaign asks its players for their saves in the app, the concentration check dnd5e asks after hit points set lower is asked there, as any other")

/* -------------------------------------------- */
/*  7. dnd5e 6's downed conditions              */
/* -------------------------------------------- */

if (DND5E6) {
  dnd5e.settings.autoApplyDowned = 'npcs'
  for (const each of [wolf, brakka]) Object.defineProperty(each, 'inCombat', { configurable: true, value: true })
  let it = await made(setting({ value: 0, temp: 0 }, { value: 4, temp: 2 }, { actorId: 'arena-wolf1', of: 'thorin' }))
  assert.deepEqual([it.result.status, [...wolf.downed]], ['done', ['dead']], 'the wolf at 0 in combat, an NPC not important: Dead, as dnd5e 6 applies it on the client that wrote')
  it = await made(setting({ value: 0 }, { value: 30 }, { actorId: 'brakka', of: 'thorin' }))
  assert.deepEqual([it.result.status, [...brakka.downed]], ['done', ['unconscious']], 'Brakka, important: Unconscious')
  it = await made(setting({ value: 6 }, { value: 0 }, { actorId: 'arena-wolf1', of: 'thorin' }))
  assert.deepEqual([it.result.status, [...wolf.downed], hpLog.undowned.at(-1)?.status], ['done', [], 'dead'], 'healed: its auto Dead removed')
  it = await made(setting({ value: 30 }, { value: 0 }, { actorId: 'brakka', of: 'thorin' }))
  dnd5e.settings.autoApplyDowned = 'none'
  it = await made(setting({ value: 0 }, { value: 30 }, { actorId: 'brakka', of: 'thorin' }))
  assert.deepEqual([...brakka.downed], [], 'nothing under "none", the default')
  await made(setting({ value: 30 }, { value: 0 }, { actorId: 'brakka', of: 'thorin' }))
  ok('dnd5e 6.0.5, autoApplyDowned "npcs", in combat: a companion NPC not important set to 0 is Dead, an important one Unconscious, as dnd5e 6 applies them on the client that writes; healed, its auto Dead goes; under "none", nothing')
}

/* -------------------------------------------- */
/*  8. Manage Campaigns and the settings row    */
/* -------------------------------------------- */

{
  const label = 'Allow Players to change their hit points from the app'
  let win = await openSettings()
  await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
  const fieldset = () => find(win, 'fieldset.sending-stone-hit-points')
  assert.equal(fieldset().querySelector('legend').textContent.trim(), 'Hit points')
  assert.equal(fieldset().querySelector('label[for="sending-stone-hit-points"]').textContent.trim(), label)
  assert.equal(fieldset().querySelector('.hint').textContent.trim(), words['SENDINGSTONE.Config.Actions.HitPointsHint'])
  assert.ok(words['SENDINGSTONE.Config.Actions.HitPointsHint'].startsWith('On by default.'))
  assert.equal(find(win, '[name="campaign.hitPoints"]').checked, true, 'ticked, as saved')
  assert.equal(fieldset().querySelectorAll('.sending-stone-warning').length, 0, 'no warning: the app takes them')
  tick(win, 'campaign.hitPoints', false)
  await save(win)
  assert.equal(settings.get('campaigns')[0].hitPoints, false, 'saved off')
  await until(() => !helloOf().features.hitPoints.enabled, 'the hello after the save')
  win = await openSettings()
  await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
  tick(win, 'campaign.hitPoints')
  await save(win)
  assert.equal(settings.get('campaigns')[0].hitPoints, true, 'saved on')
  await until(() => helloOf().features.hitPoints.enabled, 'the hello after the save')
  // An app with commands that doesn't take hit points: Manage Campaigns says so; then one that does.
  app.features.set('camp-a', { commands: true, companions: 1 })
  await hello()
  win = await openSettings()
  await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
  assert.deepEqual([...fieldset().querySelectorAll('.sending-stone-warning')].map(each => each.textContent.trim()), [words['SENDINGSTONE.Config.Actions.HitPointsApp']])
  await win.close()
  app.features.delete('camp-a')
  await hello()
  game.system.id = 'pf2e'
  win = await openSettings()
  await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
  assert.ok([...fieldset().querySelectorAll('.sending-stone-warning')].some(each => each.textContent.trim() === 'Not available in this game: it needs the D&D Fifth Edition system.'), 'under another system')
  await win.close()
  game.system.id = 'dnd5e'
  // The campaign's row in the hello's settings, after Wild Shape's.
  const rowsOf = () => helloOf().settings.sections.find(section => section.id === 'campaign').rows
  await hello()
  assert.deepEqual(rowsOf().map(each => each.id), ['rolls', 'attacks', 'prompts', 'manualDice', 'transfers', 'dishes', 'effects', 'wildShape', 'hitPoints', 'companionInitiative', 'groups'])
  assert.deepEqual(rowsOf().find(each => each.id === 'hitPoints'), { id: 'hitPoints', label, value: true, text: 'On' })
  game.system.id = 'pf2e'
  await hello()
  assert.deepEqual(rowsOf().find(each => each.id === 'hitPoints'), { id: 'hitPoints', label, value: true, text: 'On', note: 'it needs the D&D Fifth Edition system.' })
  game.system.id = 'dnd5e'
  await campaignAs({ hitPoints: false })
  assert.deepEqual(rowsOf().find(each => each.id === 'hitPoints'), { id: 'hitPoints', label, value: false, text: 'Off' })
  await campaignAs({ hitPoints: true })
}
ok("Manage Campaigns: the Hit points fieldset, the user's words, its hint saying it's on by default, ticked and saved either way, each save a hello; HitPointsApp with an app that has commands but no hitPoints; Not available under another system; the settings row after Wild Shape's, On or Off, with its note under another system")

assert.equal(oks, DND5E6 ? 13 : 12)
process.exit(0)
