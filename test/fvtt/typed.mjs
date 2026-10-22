// Players typing in what their own dice show (module 0.32.0, its contract §2.1-§2.4, §3.2-§3.6,
// §3.10): who may, as each character's `manualDice` says in the hello and since 0.32.0 in
// character.updated (the campaign's allow, Manual Dice on, and the character's primary player's Make
// Manual Rolls); sent again when that may have changed, roles' permissions, a user's role, assigned
// Character or own permissions, or a user added or removed, and only where it did; the `typed` mark
// on every message a typed command makes, and its badge; and Elven Accuracy: the sheet saying which
// attacks dnd5e gives it, a third d20 the player sent taken, and the surplus dropped where the roll
// throws fewer. The real module; dnd5e 5.3.3's real dice classes, or 6.0.5's with DND5E6=1; dnd5e's
// items and attack activities ported (activity5e.mjs, as dnd5e decides an attack's ability and Elven
// Accuracy); with MIDI=1, midi-fake.mjs's workflow and Midi's rules for critical hits
// (midi-critical.mjs); stand-in users with roles and core's hasPermission (stub.mjs); jsdom for the
// badge; a stand-in Foundry core and app. A text roll's mark is checked in texts.mjs, a Midi answer's
// in midi-prompts.mjs, and the Players tab's mark in dialog.mjs. Run with SLIM_CHECK=1 and
// --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors, combat, combatant } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
const DND5E6 = Boolean(process.env.DND5E6)
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'
const DND5E = DND5E6 ? `${DND5E6_ROOT}/module/dice` : `${DND5E5}/module/dice`
let oks = 0
const ok = message => { oks++; console.log('ok -', message) }

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
globalThis.document = { hidden: false }

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
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(['slashing', 'piercing', 'radiant'].map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' } },
  // config.mjs:4292-4298: the abilities Elven Accuracy is for.
  characterFlags: { elvenAccuracy: { abilities: ['dex', 'int', 'wis', 'cha'] } },
}
settings.set('messageMode', 'gm')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, equip } = await import('./activity5e.mjs')
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
const { midiCritical, installMidiCritical } = await import('./midi-critical.mjs')
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  dice: { DamageRoll },
  documents: { activity: { AttackActivity } },
  registry: {
    messages: {
      get(id, type) {
        return [...messages.values()].filter(m => (m.flags?.dnd5e?.originatingMessage === id) && (m.flags?.dnd5e?.roll?.type === type))
      },
    },
  },
}
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }

// Manual Dice, installed, active and on: "missing", "inactive", "off" or "active".
let manualDiceOn = true
const storedGet = game.settings.get
game.settings.get = (module, key) => (module === 'manual-dice') ? manualDiceOn : storedGet(module, key)
game.settings.settings = new Map()
const manualDice = state => {
  if (state === 'missing') {
    game.modules.delete('manual-dice')
    game.settings.settings.delete('manual-dice.enabled')
  } else {
    game.modules.set('manual-dice', { id: 'manual-dice', title: 'Manual Dice', active: state !== 'inactive', authors: [] })
    game.settings.settings.set('manual-dice.enabled', {})
  }
  manualDiceOn = state !== 'off'
}
manualDice('active')

// ---- The users ----
// Roles: 1 Player, 2 Trusted, 3 Assistant GM, 4 Gamemaster; Make Manual Rolls is Trusted and above's.
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice', false, 2)
const bob = user('bob', 'Bob', false, 1)
user('carol', 'Carol', false, 2)
user('dave', 'Dave', false, 1)
const erin = user('erin', 'Erin', false, 2)
user('frank', 'Frank', false, 1)
const asst = user('asst', 'Assistant', true, 3)
asst.isActiveGM = false
const gina = user('gina', 'Gina', false, 1)
gina.permissions = { MANUAL_ROLLS: true }
const hank = user('hank', 'Hank', false, 2)
delete hank.hasPermission
const ivy = user('ivy', 'Ivy', false, 2)
ivy.hasPermission = () => { throw new Error('no permissions here') }

// ---- The characters ----
if (MIDI) installMidi()
const add = actor => { actors.set(actor.id, actor); return actor }
const weapon = (id, name, properties, activity, system = {}) => ({
  id, name, type: 'weapon', system: { properties, quantity: 1, attackType: 'melee', ...system }, activities: [activity],
})
// Thorin, Alice's, an elf with Elven Accuracy: Dexterity 18 over Strength 10, Wisdom his spellcasting.
const thorin = add(new Actor5e({
  id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 0, dex: 4, wis: 3, con: 2 }, flags: { elvenAccuracy: true },
  skills: { prc: { ability: 'wis' } }, hp: { value: 10, max: 40, temp: 0 },
  classes: [{ identifier: 'ranger', denomination: 'd10', levels: 4 }],
}))
thorin.system.attributes.spellcasting = 'wis'
alice.character = thorin
equip(thorin, {
  spells: { spell1: { value: 2, max: 2, level: 1 } },
  items: [
    // dnd5e's attack ability "" (attack-data.mjs:51-63): a finesse weapon's best of Strength and Dexterity.
    weapon('rapier', 'Rapier', ['fin'], { id: 'rapier-lunge', attack: { ability: '' }, damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['piercing'] }] }),
    weapon('greataxe', 'Greataxe', ['hvy', 'two'], { id: 'cleave', attack: { ability: 'str' }, damage: [{ number: 1, denomination: 12, bonus: '@mod', types: ['slashing'] }] }),
    { id: 'bolt', name: 'Guiding Bolt', type: 'spell', system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'bolt-cast', attack: { ability: 'spellcasting' }, damage: [{ number: 4, denomination: 6, types: ['radiant'] }] }] },
    // A staff that casts it, before its spell's copy, as dnd5e keeps one.
    { id: 'staff', name: 'Staff of Guiding', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 10, spent: 0 } },
      activities: [{ id: 'cast-guide', type: 'cast', spell: { level: 1 }, consumption: [{ type: 'itemUses', value: '1' }] }] },
    { id: 'guide', name: 'Guiding Bolt', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.staff.Activity.cast-guide' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'guide-bolt', attack: { ability: 'spellcasting' }, damage: [{ number: 4, denomination: 6, types: ['radiant'] }] }] },
  ],
})
const character = (id, name, owners) => {
  const actor = add(new Actor5e({ id, name, owners, skills: { prc: { ability: 'wis' } } }))
  equip(actor, { items: [] })
  return actor
}
// Vex: assigned to Bob, a Player, whose co-owner Carol is Trusted: Bob's alone counts (Q8).
const vex = character('vex', 'Vex', ['bob', 'carol'])
bob.character = vex
// Bram: assigned to no one; of his owners, Dave a Player and Erin Trusted.
const bram = character('bram', 'Bram', ['dave', 'erin'])
// Lia: no player at all.
const lia = character('lia', 'Lia', [])
// Kael: Frank's, a Player, and assigned to the Assistant GM, who is skipped.
const kael = character('kael', 'Kael', ['frank'])
asst.character = kael
// Pip: Gina's, a Player with Make Manual Rolls of her own.
const pip = character('pip', 'Pip', ['gina'])
gina.character = pip
// Odd and Weird: assigned to a user with no hasPermission, and to one whose throws.
const odd = character('odd', 'Odd', ['hank'])
hank.character = odd
const weird = character('weird', 'Weird', ['ivy'])
ivy.character = weird
// Grim: the Gamemaster's own, assigned to them: no player.
const grim = character('grim', 'Grim', ['gm'])
users.get('gm').character = grim
// Bram's sheet too large to send, by an item whose name is longer than the listener takes.
const goblin = add(new Actor5e({ id: 'goblin', name: 'Goblin', mods: {}, hp: { value: 30, max: 30, temp: 0 } }))
goblin.type = 'npc'
equip(goblin, { ac: 13 })
const token = { id: 'tok-goblin', name: 'Goblin', uuid: 'Scene.scene.Token.tok-goblin', actor: goblin, hidden: false }
token.object = { id: token.id, name: 'Goblin', document: token, actor: goblin }
placeables.set(token.id, token.object)
if (MIDI) canvas.scene.tokens.size = placeables.size
const fight = combat('fight')
combatant(fight, 'cb-thorin', thorin)
combatant(fight, 'cb-gob', goblin, { token })
fight.getCombatantsByActor = actor => fight.combatants.filter(cb => cb.actor?.id === actor.id)
game.combat = fight

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), wake: null, holdHello: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    if ((body.type === 'bridge.hello') && app.holdHello) await app.holdHello
    return announcing ? json({ features: { commands: true } }) : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.polls.push(body)
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
let ids = 0
const results = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
async function send(command) {
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), command])
  app.wake?.()
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const roll = (fields = {}) => send({ id: `req-${++ids}`, actorId: 'thorin', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [14] }], ...fields })
const attack = (fields = {}) => send({
  id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'rapier', activity: 'rapier-lunge', target: { combatId: 'fight', combatantId: 'cb-gob' },
  mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [15] }], ...fields,
})
const damage = (use, dice, fields = {}) => send({ id: `dmg-${++ids}`, actorId: 'thorin', kind: 'damage', use, dice, ...fields })
const messageOf = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.request === id)
const cardsOf = id => [...messages.values()].filter(m => m.flags?.['sending-stone']?.request === id)
const useCard = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.use === id)
const workflowOf = id => midi.made.find(w => w.workflowOptions.sendingStone === id)
/** The roll an attack made: its own message's under dnd5e, the workflow's under Midi-QOL. */
const attackRollOf = made => (MIDI ? workflowOf(made.id)?.attackRoll : messageOf(made.id)?.rolls[0])
const d20sOf = roll => roll.dice[0].results.map(r => r.result)
const flagsOf = message => message?.flags?.['sending-stone']

// The console, counted: the gate prints nothing, a stand-in that throws included.
const printed = []
for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
  const real = console[method]
  console[method] = (...args) => { if (globalThis.countPrints) printed.push(args.map(String).join(' ')); else real(...args) }
}

// A world setting changed as core changes it (MD scripts/module.mjs:15-17): the hook first, its
// value after, as `game.permissions` is refreshed after updateSetting fires; created the first time.
const stored = new Set()
async function changeSetting(key, value) {
  const hook = stored.has(key) ? 'updateSetting' : 'createSetting'
  stored.add(key)
  await Hooks.callAll(hook, { key, value })
  if (key === 'core.permissions') game.permissions = value
}
const ALL = ['thorin', 'vex', 'bram', 'lia', 'kael', 'pip', 'odd', 'weird', 'grim']
const posted = from => app.events.slice(from).filter(e => e.type === 'character.updated' && e.campaign.id === 'camp-a').map(e => [e.data.character.id, e.data.character.manualDice])
const settle = () => wait(320)

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
if (MIDI) {
  installMidiCritical(DamageRoll)
  Object.assign(midiCritical, { gm: 'doubleDice', player: 'default' })
}
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret', 'camp-b': 'mirkwood-secret' })
const CAMPAIGNS = [
  { id: 'camp-a', title: 'Ashlands', characters: ALL, rolls: true, attacks: true, manualDice: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'], rolls: true, attacks: true, manualDice: false },
]
settings.set('campaigns', CAMPAIGNS)
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { typesDice, typedDiceState, primaryPlayers } = await import(`${MODULE}/scripts/typed-dice.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
await settle()
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
ok('the self-test still passes')

/* -------------------------------------------- */
/*  The gate                                    */
/* -------------------------------------------- */

const helloOf = id => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === id)).at(-1)
const GATE = [['thorin', true], ['vex', false], ['bram', true], ['lia', false], ['kael', false], ['pip', true], ['odd', false], ['weird', false], ['grim', false]]
globalThis.countPrints = true
assert.deepEqual(helloOf('camp-a').data.characters.map(c => [c.id, c.manualDice]), GATE)
assert.deepEqual(helloOf('camp-b').data.characters.map(c => [c.id, c.manualDice]), [['thorin', false]], "Mirkwood doesn't allow it")
const [ashlands] = getCampaigns()
assert.deepEqual(ALL.map(id => [id, typesDice(actors.get(id), ashlands)]), GATE)
assert.deepEqual([typedDiceState(vex), typedDiceState(lia), typedDiceState(grim)].map(({ state, player }) => [state, player?.id ?? null]),
  [['permission', 'bob'], ['none', null], ['none', null]])
assert.deepEqual([typedDiceState(thorin), typedDiceState(bram), typedDiceState(kael)].map(({ state, player }) => [state, player?.id ?? null]),
  [['allowed', 'alice'], ['allowed', 'erin'], ['permission', 'frank']])
assert.deepEqual(primaryPlayers(kael).map(u => u.id), ['frank'], 'the Assistant GM assigned it is skipped')
for (const [why, change] of [
  ['not allowed', { manualDice: false }], ['rolls off', { rolls: false }],
]) assert.equal(typesDice(thorin, { ...ashlands, ...change }), false, why)
Object.assign(diceStatus, { ready: false, reason: 'self-test' })
assert.equal(typesDice(thorin, ashlands), false, "the self-test hasn't passed")
Object.assign(diceStatus, { ready: true, reason: null })
for (const state of ['missing', 'inactive', 'off']) {
  manualDice(state)
  assert.equal(typesDice(thorin, ashlands), false, `Manual Dice ${state}`)
}
manualDice('active')
globalThis.countPrints = false
assert.deepEqual(printed, [], 'nothing printed')
ok("the gate: true for an assigned Trusted player (Thorin), any of no-one-assigned's owners with it (Bram), a Player with Make Manual Rolls of her own (Pip); false for an assigned Player whatever a co-owner has (Vex), no player (Lia), a GM's own (Grim), the Assistant GM assigned skipped (Kael), a user with no hasPermission or one that throws (Odd, Weird), nothing printed; and false while the campaign doesn't allow it, rolls are off, the self-test hasn't passed, or Manual Dice is missing, inactive or off")

/* -------------------------------------------- */
/*  The wire                                    */
/* -------------------------------------------- */

for (const entry of helloOf('camp-a').data.characters) {
  assert.deepEqual(Object.keys(entry), ['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice'])
}
const updatedOf = id => app.events.filter(e => (e.type === 'character.updated') && (e.campaign.id === 'camp-a') && (e.data.character.id === id)).at(-1)?.data.character
assert.deepEqual(Object.keys(updatedOf('thorin')), ['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice', 'sheet'])
assert.deepEqual(ALL.map(id => [id, updatedOf(id).manualDice]), GATE, 'each sheet after the hello says it too')
// A sheet that can't be described goes as none; one too large is withheld: each says it all the same.
Object.defineProperty(weird.system, 'details', { configurable: true, get() { throw new Error('a broken sheet') } })
bram.items.set('huge', new (thorin.items.get('rapier').constructor)(bram, { id: 'huge', name: 'x'.repeat(1_100_000), type: 'loot', system: { quantity: 1 } }))
let from = app.events.length
const { sendCharacter } = await import(`${MODULE}/scripts/character-sync.mjs`)
sendCharacter('weird')
sendCharacter('bram')
await settle()
const broken = updatedOf('weird')
const withheld = updatedOf('bram')
assert.deepEqual([Object.keys(broken), broken.manualDice, broken.sheet], [['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice', 'sheet'], false, null])
assert.deepEqual([Object.keys(withheld), withheld.manualDice, withheld.sheet, withheld.sheetWithheld?.reason],
  [['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice', 'sheet', 'sheetWithheld'], true, null, 'tooLarge'])
delete weird.system.details
bram.items.delete('huge')
sendCharacter('weird')
sendCharacter('bram')
await settle()
// Nothing flipped, nothing posted.
from = app.events.length
for (const id of ALL) sendCharacter(id)
await settle()
assert.deepEqual(posted(from), [])
ok("the hello's roster lists id, uuid, name, img, type, owners and manualDice; character.updated says manualDice after owners, with a sheet, a sheet that can't be described (null) and one withheld as too large alike; nothing is posted where nothing changed")

/* -------------------------------------------- */
/*  Re-sends                                    */
/* -------------------------------------------- */

const GRANT = { MANUAL_ROLLS: [1, 2, 3, 4] }
const DEFAULT = { MANUAL_ROLLS: [2, 3, 4] }
const hellos = () => app.events.filter(e => e.type === 'bridge.hello').length
// The first change of the roles' permissions creates the setting: Players may now, so Vex and Kael flip.
let helloCount = hellos()
from = app.events.length
await changeSetting('core.permissions', GRANT)
await settle()
assert.deepEqual(posted(from), [['vex', true], ['kael', true]], 'createSetting: the two flipped, with the new value')
assert.equal(hellos(), helloCount, 'no hello')
from = app.events.length
await changeSetting('core.permissions', DEFAULT)
await settle()
assert.deepEqual(posted(from), [['vex', false], ['kael', false]], 'updateSetting: back')
from = app.events.length
await changeSetting('core.permissions', GRANT)
await settle()
assert.deepEqual(posted(from), [['vex', true], ['kael', true]], 'updateSetting: granted again')
await changeSetting('core.permissions', DEFAULT)
await settle()
assert.equal(hellos(), helloCount, 'no hello')
// Another setting: nothing.
from = app.events.length
await Hooks.callAll('updateSetting', { key: 'core.other' })
await settle()
assert.deepEqual(posted(from), [])
ok('the roles\' permissions changed, created the first time and updated after: once its changes settle, each character whose answer flipped is sent in character.updated with it, and only those; no hello')

// A user's role, assigned Character or own permissions: re-checked.
const userChanged = async (u, changes) => {
  const at = app.events.length
  await Hooks.callAll('updateUser', u, changes, {}, 'gm')
  await settle()
  return posted(at)
}
bob.role = 2
assert.deepEqual(await userChanged(bob, { role: 2 }), [['vex', true]], 'role')
bob.role = 1
assert.deepEqual(await userChanged(bob, { role: 1 }), [['vex', false]])
bob.character = null
assert.deepEqual(await userChanged(bob, { character: null }), [['vex', true]], "character: Vex's owners now, Carol among them")
bob.character = vex
assert.deepEqual(await userChanged(bob, { character: 'vex' }), [['vex', false]])
erin.permissions = { MANUAL_ROLLS: false }
assert.deepEqual(await userChanged(erin, { permissions: { MANUAL_ROLLS: false } }), [['bram', false]], 'permissions of her own')
erin.permissions = {}
assert.deepEqual(await userChanged(erin, { permissions: {} }), [['bram', true]])
// Only a name or a colour: nothing posted, and no character looked up, after the settle or before.
let lookups = 0
const realGet = Map.prototype.get
actors.get = function (id) { lookups++; return realGet.call(this, id) }
assert.deepEqual(await userChanged(bob, { name: 'Bob' }), [])
assert.deepEqual(await userChanged(bob, { color: '#ff0000' }), [])
assert.equal(lookups, 0, 'no character looked up')
delete actors.get
// A user added or removed: re-checked. Jill, Trusted, is given Lia.
const jill = user('jill', 'Jill', false, 2)
jill.character = lia
from = app.events.length
await Hooks.callAll('createUser', jill, {}, 'gm')
await settle()
assert.deepEqual(posted(from), [['lia', true]], 'createUser')
users.delete('jill')
from = app.events.length
await Hooks.callAll('deleteUser', jill, {}, 'gm')
await settle()
assert.deepEqual(posted(from), [['lia', false]], 'deleteUser')
ok("a user's role, assigned Character or own permissions changed: re-checked, the character whose answer flipped sent; only a name or a colour: nothing posted, no character looked up; a user added or removed: re-checked")

// Not the bridge: nothing.
users.get('gm').isActiveGM = false
from = app.events.length
await changeSetting('core.permissions', GRANT)
bob.role = 2
await Hooks.callAll('updateUser', bob, { role: 2 }, {}, 'gm')
await settle()
users.get('gm').isActiveGM = true
assert.deepEqual(posted(from), [], 'a client that is not the bridge sends nothing')
bob.role = 1
await changeSetting('core.permissions', DEFAULT)
await settle()
// A campaign whose hello is on its way: nothing until the hello is answered; then the sheets carry it.
let answer
app.holdHello = new Promise(resolve => { answer = resolve })
announce({ campaignId: 'camp-a' })
await until(() => app.events.at(-1)?.type === 'bridge.hello', 'the hello')
from = app.events.length
await changeSetting('core.permissions', GRANT)
await settle()
assert.deepEqual(posted(from), [], 'nothing while the hello is on its way')
app.holdHello = null
answer()
await until(() => posted(from).length >= ALL.length, 'the sheets after the hello')
assert.deepEqual(posted(from).filter(([id]) => ['vex', 'kael', 'thorin'].includes(id)), [['thorin', true], ['vex', true], ['kael', true]], 'carried by the sheets that follow the hello')
await changeSetting('core.permissions', DEFAULT)
await settle()
ok('a client that is not the bridge sends nothing; a campaign whose hello is on its way is sent nothing, its sheets after the hello saying the new value')

/* -------------------------------------------- */
/*  The mark                                    */
/* -------------------------------------------- */

const typedFlags = id => ({ request: id, typed: true })
// A check, its message marked; the dice used as without the mark.
let made = await roll({ typed: true, dice: [{ faces: 20, results: [17] }] })
assert.equal(made.status, 'done', JSON.stringify(made))
const typedRoll = messageOf(made.id)
assert.deepEqual([flagsOf(typedRoll), d20sOf(typedRoll.rolls[0]), typedRoll.rolls[0].total], [typedFlags(made.id), [17], 17 + 3 + 3])
const plainCheck = await roll({ dice: [{ faces: 20, results: [17] }] })
assert.deepEqual([flagsOf(messageOf(plainCheck.id)), d20sOf(messageOf(plainCheck.id).rolls[0]), plainCheck.rolls[0].total], [{ request: plainCheck.id }, [17], made.rolls[0].total], 'the same dice and total, unmarked')
// `typed` anything but true: nothing marked, nothing refused.
for (const typed of ['yes', false, 1]) {
  made = await roll({ typed })
  assert.deepEqual([made.status, flagsOf(messageOf(made.id))], ['done', { request: made.id }], JSON.stringify(typed))
}
// The Gamemaster's: their own mark, never typed.
made = await roll({ typed: true, by: 'gm' })
assert.deepEqual([made.status, flagsOf(messageOf(made.id))], ['done', { request: made.id, by: 'gm' }])
// Hit dice, each card; and 5.3's death-save outcome, its own message.
made = await send({ id: `hd-${++ids}`, actorId: 'thorin', kind: 'hitDice', hitDice: [{ denomination: 'd10', count: 2 }], mode: 0, explicit: false, extras: [], dice: [{ faces: 10, results: [3, 4] }], typed: true })
assert.equal(made.status, 'done', JSON.stringify(made))
assert.deepEqual(cardsOf(made.id).map(flagsOf), [typedFlags(made.id), typedFlags(made.id)])
Object.assign(thorin.system.attributes, { hp: { ...thorin.system.attributes.hp, value: 0 }, death: { ...thorin.system.attributes.death, success: 0, failure: 0 } })
let before = messages.size
made = await roll({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [20] }], typed: true })
const outcome = [...messages.values()].slice(before).find(m => /DeathSave/.test(m.content ?? ''))
assert.deepEqual([made.status, flagsOf(messageOf(made.id)), outcome?.content, flagsOf(outcome)], ['done', typedFlags(made.id), 'DND5E.DeathSaveCriticalSuccess', { outcome: made.id, typed: true }])
// An attack and its damage: every message the typed attack makes marked, its card too, which under
// Midi-QOL holds the attack's roll; and the damage's.
made = await attack({ typed: true })
assert.equal(made.status, 'done', JSON.stringify(made))
const markOf = flags => Object.fromEntries(['use', 'by', 'typed'].filter(key => key in (flags ?? {})).map(key => [key, flags[key]]))
assert.deepEqual(markOf(flagsOf(useCard(made.id))), { use: made.id, typed: true }, "the attack's card")
if (!MIDI) assert.deepEqual(flagsOf(messageOf(made.id)), typedFlags(made.id), "the attack's roll")
const dealt = await damage(made.id, [{ faces: 8, results: [5] }], { typed: true })
assert.equal(dealt.status, 'done', JSON.stringify(dealt))
if (!MIDI) assert.deepEqual(flagsOf(messageOf(dealt.id)), typedFlags(dealt.id), 'its damage')
made = await attack()
assert.deepEqual(markOf(flagsOf(useCard(made.id))), { use: made.id }, 'an attack not typed: its card unmarked')
ok(`a typed command's messages are marked \`typed\`: a check's, an attack's card${MIDI ? ', its roll on it' : ", its roll's and its damage's"}, each card of hit dice, dnd5e 5.3's death-save outcome; its dice used as any; \`typed\` "yes", false or 1 marks nothing and is never refused; the Gamemaster's is theirs alone`)

// The badge: the keyboard, "Entered by hand on Sending Stone"; the Gamemaster's as ever; none on an outcome.
{
  const { window } = new JSDOM('')
  const kept = globalThis.document
  Object.assign(globalThis, { HTMLElement: window.HTMLElement, document: window.document })
  try {
    const { markAppRoll } = await import(`${MODULE}/scripts/command-rolls.mjs`)
    const badgeOf = flags => {
      const html = window.document.createElement('li')
      html.innerHTML = '<header class="message-header"><span class="message-metadata"><time>now</time></span></header>'
      markAppRoll({ flags: { 'sending-stone': flags } }, html)
      const badge = html.querySelector('.sending-stone-badge')
      return badge && [badge.className, badge.dataset.tooltip, badge.getAttribute('aria-label'), badge.querySelector('i')?.className, badge.querySelector('i')?.hasAttribute('inert')]
    }
    assert.deepEqual(badgeOf({ request: 'r', typed: true }), ['sending-stone-badge sending-stone-typed', 'SENDINGSTONE.Roll.BadgeTyped', 'SENDINGSTONE.Roll.BadgeTyped', 'fa-solid fa-keyboard', true])
    assert.deepEqual(badgeOf({ request: 'r' }), ['sending-stone-badge', 'SENDINGSTONE.Roll.Badge', 'SENDINGSTONE.Roll.Badge', 'fa-solid fa-mobile-screen-button', true])
    assert.equal(badgeOf({ request: 'r', by: 'gm', typed: true })[0], 'sending-stone-badge sending-stone-gm', "the Gamemaster's wins")
    assert.equal(badgeOf({ outcome: 'o', typed: true }), null, 'no badge on an outcome')
  } finally {
    delete globalThis.HTMLElement
    globalThis.document = kept
  }
}
ok("a typed roll's card has the keyboard badge, \"Entered by hand on Sending Stone\", as its tooltip and name; the phone as ever on another; the Gamemaster's badge wins; a death save's outcome has none")

/* -------------------------------------------- */
/*  Elven Accuracy: the sheet                   */
/* -------------------------------------------- */

const sheetOf = () => updatedOf('thorin').sheet
const rowsOf = sheet => JSON.parse(JSON.stringify(sheet), (key, value) => value)
const allRows = sheet => {
  const found = []
  const walk = value => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && (typeof value === 'object')) {
      if (typeof value.attackId === 'string') found.push(value)
      Object.values(value).forEach(walk)
    }
  }
  walk(rowsOf(sheet))
  return found
}
const accuracyOf = (sheet, attackId) => {
  const rows = allRows(sheet).filter(row => row.attackId === attackId)
  assert.ok(rows.length > 0, `a row for ${attackId}`)
  const values = new Set(rows.map(row => row.elvenAccuracy))
  assert.equal(values.size, 1, `every row of ${attackId} alike`)
  return [...values][0]
}
await settle()
let sheet = sheetOf()
assert.deepEqual(['rapier-lunge', 'cleave', 'bolt-cast', 'cast-guide'].map(id => accuracyOf(sheet, id)), [true, undefined, true, true])
assert.ok(allRows(sheet).every(row => row.elvenAccuracy !== false), 'never false')
const lunge = allRows(sheet).find(row => row.attackId === 'rapier-lunge')
assert.deepEqual(Object.keys(lunge).slice(Object.keys(lunge).indexOf('attackId'), Object.keys(lunge).indexOf('attackId') + 2), ['attackId', 'elvenAccuracy'], 'beside attackId')
thorin.flags.dnd5e.elvenAccuracy = false
await Hooks.callAll('updateActor', thorin, { flags: { dnd5e: { elvenAccuracy: false } } }, {}, 'gm')
await settle()
sheet = sheetOf()
assert.deepEqual(['rapier-lunge', 'cleave', 'bolt-cast', 'cast-guide'].map(id => accuracyOf(sheet, id)), [undefined, undefined, undefined, undefined])
thorin.flags.dnd5e.elvenAccuracy = true
await Hooks.callAll('updateActor', thorin, { flags: { dnd5e: { elvenAccuracy: true } } }, {}, 'gm')
await settle()
assert.equal(accuracyOf(sheetOf(), 'rapier-lunge'), true)
ok("the sheet says `elvenAccuracy: true` beside attackId only where dnd5e would give the attack Elven Accuracy: the rapier, a finesse weapon made with Dexterity; Guiding Bolt, a spell attack of Wisdom; and the same cast from the staff, its cached copy; never the greataxe, of Strength; none with the flag off, and never false")

/* -------------------------------------------- */
/*  Elven Accuracy: the roll                    */
/* -------------------------------------------- */

Object.assign(thorin.system.attributes, { hp: { ...thorin.system.attributes.hp, value: 30 } })
const kept = roll => roll.dice[0].total
// Explicit advantage with three d20s: all three the player's.
made = await attack({ mode: 1, explicit: true, dice: [{ faces: 20, results: [4, 17, 9] }] })
assert.equal(made.status, 'done', JSON.stringify(made))
let thrown = attackRollOf(made)
assert.deepEqual([d20sOf(thrown), kept(thrown)], [[4, 17, 9], 17])
// The same where a module, after this one, turns the advantage off as the roll is built: put back,
// three again, before the surplus is reckoned.
const normal = Hooks.on('dnd5e.postBuildRollConfig', (process, config) => {
  if (process?.hookNames?.includes('attack')) { config.options ??= {}; config.options.advantageMode = CONFIG.Dice.D20Roll.ADV_MODE.NORMAL }
})
made = await attack({ mode: 1, explicit: true, dice: [{ faces: 20, results: [4, 17, 9] }] })
Hooks.off('dnd5e.postBuildRollConfig', normal)
thrown = attackRollOf(made)
assert.deepEqual([made.status, d20sOf(thrown), kept(thrown)], ['done', [4, 17, 9], 17])
// The flag off by the time it's rolled, with +1d20 added: two d20s, and the added one keeps its own.
thorin.flags.dnd5e.elvenAccuracy = false
made = await attack({ mode: 1, explicit: true, extras: [{ sign: 1, count: 1, sides: 20 }], dice: [{ faces: 20, results: [4, 17, 9] }, { faces: 20, results: [11] }] })
thorin.flags.dnd5e.elvenAccuracy = true
thrown = attackRollOf(made)
assert.equal(made.status, 'done', JSON.stringify(made))
assert.deepEqual([d20sOf(thrown), thrown.dice[1].results.map(r => r.result)], [[4, 17], [11]], 'the surplus 9 dropped, the added d20 its 11')
// No advantage, two sent, +1d20: one, and the added one its 8.
made = await attack({ mode: 0, explicit: true, extras: [{ sign: 1, count: 1, sides: 20 }], dice: [{ faces: 20, results: [12, 5] }, { faces: 20, results: [8] }] })
thrown = attackRollOf(made)
assert.deepEqual([made.status, d20sOf(thrown), thrown.dice[1].results.map(r => r.result)], ['done', [12], [8]])
// Not chosen in the app, but given by dnd5e, adv2: all three taken.
const given = Hooks.on('dnd5e.postBuildRollConfig', (process, config) => {
  if (process?.hookNames?.includes('attack')) { config.options ??= {}; config.options.advantageMode = CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE }
})
made = await attack({ mode: 0, explicit: false, dice: [{ faces: 20, results: [4, 17, 9] }] })
Hooks.off('dnd5e.postBuildRollConfig', given)
thrown = attackRollOf(made)
assert.deepEqual([made.status, d20sOf(thrown), kept(thrown)], ['done', [4, 17, 9], 17])
ok(`Elven Accuracy${MIDI ? ", through Midi-QOL's workflow" : ''}${DND5E6 ? ' on dnd5e 6.0.5' : ''}: three d20s sent with explicit advantage are the three it throws, 17 kept, even where a module turned the advantage off as it was built; where it throws two, as with the flag off by then, the surplus is dropped so a d20 added keeps its own (11, not 9), and one throws one of two (the added its 8); one dnd5e gives advantage of itself takes all three`)

console.log(`typed${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
