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
// in midi-prompts.mjs, and the Players tab's mark in dialog.mjs. And since module 0.42.0 (its
// contract §8.2): the dice a character's effects add, listed on its sheet by the spell or item they
// come from (effects-core.mjs's effects, the stand-in's attack bonus as dnd5e's actorBonus), typed or
// skipped, by faces and sign; rerolls kept at the table where the roll says so; their self-tests,
// with dice-core.mjs's staleModifiers, nestNegative and freshTerms; a Midi-QOL save, and Midi's
// concentration checks, answered with them are in midi-prompts.mjs, and a shaped druid's in
// wildshape.mjs. Run with SLIM_CHECK=1 and --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

/* -------------------------------------------- */
/*  Module 0.42.0: the dice effects add         */
/* -------------------------------------------- */

// Round 0.42.0 §8.2: the dice a character's effects add listed on its sheet by the spell or item
// they come from, never an actor; a typed roll's values for them taken by faces and sign, after the
// player's own; rerolls kept at the table where the roll says so; the self-tests that gate both, and
// the hello's flags. Under DND5E6=1 dnd5e 6.0.5 says no effect's die, and rerolls are kept as under 5.
if (DND5E6) game.system.version = '6.0.5'
const effectsCore = await import('./effects-core.mjs')
const { PlainEffect, Embedded, effectOn, effectOnItem, itemOn, concentrateOn } = effectsCore
effectsCore.installEffectsCore()
const { Character, concentrationCardOf, withConcentrationChecks } = await import('./dnd5e-cards.mjs')
const { core: diceCore, seedRandom } = await import('./dice-core.mjs')
const { rollCombatInitiative } = await import('./actor5e.mjs')
const { effectDiceOf, EFFECT_TOKEN } = await import(`${MODULE}/scripts/sheet-effect-dice.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const { slimSheet } = await import(`${MODULE}/scripts/sheet-slim.mjs`)
const { selfTest, withPlan } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { ROLL_TAG } = await import(`${MODULE}/scripts/constants.mjs`)
CONFIG.DND5E.defaultAbilities.concentration = 'con'
const ATTACKS = ['mwak', 'rwak', 'msak', 'rsak']
const change = (key, value, type = 'add') => ({ key: `system.${key}`, type, value, phase: 'initial' })
const BLESS_FIELDS = ['bonuses.abilities.save', ...ATTACKS.map(kind => `bonuses.${kind}.attack`)]
const blessChanges = value => BLESS_FIELDS.map(key => change(key, value))
const BLESS_ON = ['attack', 'save', 'death', 'concentration']
const rounds = n => ({ rounds: n, value: n, units: 'rounds', remaining: n })
/** A die a roll threw, by faces: each term's results. */
const facesOf = (made, faces) => made.dice.filter(die => die.faces === faces).map(die => die.results.map(r => r.result))
/** Seed Foundry's dice so that the next die it throws of these faces shows this face. */
const nextFace = (faces, face) => {
  for (let seed = 1; seed < 100000; seed++) {
    seedRandom(seed)
    if (Math.ceil(CONFIG.Dice.randomUniform() * faces) === face) return seedRandom(seed)
  }
  throw new Error(`no seed throws a ${face} on a d${faces}`)
}
const sendTo = async (campaignId, command) => {
  app.waiting.set(campaignId, [...(app.waiting.get(campaignId) ?? []), command])
  app.wake?.()
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const hello = async campaignId => {
  const count = app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === campaignId)).length
  announce({ campaignId })
  await until(() => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === campaignId)).length > count, `${campaignId}'s hello`)
  await settle()
  return helloOf(campaignId).data.features.rolls
}

// The casters, in no campaign: Vex and Mira, players' characters, each concentrating on Bless as
// dnd5e does, the effect it applies having the concentration as its origin; and Grukk and Snag,
// goblin shamans no player owns, each on Bane.
const caster = (id, name, owners, spell) => {
  const actor = add(new Character({ id, name, owners }))
  if (!owners.length) actor.type = 'npc'
  const item = itemOn(actor, { _id: `${id}Spell`, name: spell, type: 'spell' })
  const concentration = concentrateOn(actor, effectOn(actor, {
    _id: `${id}Conc`, name: `Concentrating: ${spell}`, origin: item.uuid, flags: { dnd5e: { item: { id: item.id, type: 'spell' } } },
  }))
  return { actor, item, concentration }
}
const vexBless = caster('vexbard', 'Vex', ['bob'], 'Bless')
const miraBless = caster('mira', 'Mira', ['carol'], 'Bless')
const grukkBane = caster('grukk', 'Grukk', [], 'Bane')
const snagBane = caster('snag', 'Snag', [], 'Bane')
// A concentration whose spell is gone from its caster, as a scroll spent: its name kept in dnd5e's flags.
const scrollConc = effectOn(vexBless.actor, {
  _id: 'vexScrollConc', name: 'Concentrating: Bless', origin: `${vexBless.actor.uuid}.Item.spentScroll`,
  flags: { dnd5e: { item: { id: 'spentScroll', type: 'spell', data: { _id: 'spentScroll', name: 'Bless (Spell Scroll)' } } } },
})
concentrateOn(vexBless.actor, scrollConc)

// Thorin's effects, as the module reads them: his own, and his items' transferred ones, an item of
// no inventory's here; and his prepared fields, set as dnd5e would prepare them from those effects,
// which the stand-in doesn't apply.
thorin.documentName = 'Actor'
thorin.effects = []
const worn = []
thorin.allApplicableEffects = function* () {
  yield* thorin.effects
  for (const item of worn) for (const effect of item.effects) if (effect.transfer) yield effect
}
const prepared = ({ save = '', check = '', attack = '', death = '', concentration = '' } = {}) => {
  Object.assign(thorin.system.bonuses.abilities, { save, check })
  for (const kind of ATTACKS) thorin.system.bonuses[kind].attack = attack
  thorin.system.attributes.death.bonuses.save = death
  if (thorin.system.attributes.concentration?.bonuses) thorin.system.attributes.concentration.bonuses.save = concentration
}
const blessedBy = ({ concentration }, data = {}) => new PlainEffect(thorin, {
  _id: `blessedBy${concentration.parent.id}`.slice(0, 16), name: 'Blessed', origin: concentration.uuid, duration: rounds(10),
  system: { changes: blessChanges('1d4') }, ...data,
})
const baneBy = ({ concentration }, data = {}) => new PlainEffect(thorin, {
  _id: `baneBy${concentration.parent.id}`.slice(0, 16), name: 'Bane', origin: concentration.uuid, duration: rounds(10),
  system: { changes: blessChanges('-1d4') }, ...data,
})
const having = (effects, fields) => {
  thorin.effects = [...effects]
  prepared(fields)
}
const thorinSheet = async () => {
  sendCharacter('thorin')
  await settle()
  return updatedOf('thorin').sheet
}

/* -------------------------------------------- */
/*  1. The sheet                                */
/* -------------------------------------------- */

having([], {})
const plainKeys = Object.keys(await thorinSheet())
assert.ok(!plainKeys.includes('effectDice'), 'no effect, no effectDice')
const bless = blessedBy(vexBless)
having([bless], { save: '1d4', attack: '1d4' })
let blessed = await thorinSheet()
if (DND5E6) {
  assert.ok(!('effectDice' in blessed), 'dnd5e 6: no effectDice, Bless or not')
  assert.deepEqual(Object.keys(blessed), plainKeys)
} else {
  assert.deepEqual(blessed.effectDice, [{ name: 'Bless', effect: bless.id, faces: 4, count: 1, sign: 1, on: BLESS_ON }])
  assert.ok(!/Vex|Thorin/.test(JSON.stringify(blessed.effectDice)), "no actor's name")
  assert.deepEqual(slimSheet(blessed).effectDice, blessed.effectDice, 'kept by a slim sheet')
  // The same in the shape before Foundry v14: top-level changes of mode 2.
  const oldShape = blessedBy(vexBless, { system: {} })
  oldShape.changes = BLESS_FIELDS.map(key => ({ key: `system.${key}`, mode: 2, value: '1d4' }))
  having([oldShape], { save: '1d4', attack: '1d4' })
  assert.deepEqual(effectDiceOf(thorin), [{ name: 'Bless', effect: oldShape.id, faces: 4, count: 1, sign: 1, on: BLESS_ON }])
  // Named by its origin: the Bless item itself; a concentration whose spell is gone, by dnd5e's flags;
  // none, the effect's own name.
  for (const [origin, name] of [[vexBless.item.uuid, 'Bless'], [scrollConc.uuid, 'Bless (Spell Scroll)'], [null, 'Blessed'], [vexBless.actor.uuid, 'Blessed']]) {
    having([blessedBy(vexBless, { origin })], { save: '1d4', attack: '1d4' })
    assert.deepEqual(effectDiceOf(thorin).map(each => each.name), [name], String(origin))
  }
}
// Each entry's six keys are all a listener reads of one (round 0.42.0 §4.1 and §11.2, as amended in
// its review fixes): PROTOCOL.md says an entry with any other key is dropped, its die Foundry's, so
// that a key a later module adds is never asked as a die the game adds by an older listener. This
// checkout's PROTOCOL.md, the harness's own, so that a scratch copy of the scripts tests the same.
const sheetDiceRow = readFileSync(new URL('../../PROTOCOL.md', import.meta.url), 'utf8').split('\n').find(line => line.startsWith('| `effectDice` | Since module 0.42.0, under dnd5e 5'))
assert.match(sheetDiceRow, /reads an entry only where its keys are exactly these six, `name`, `effect`, `faces`, `count`, `sign` and `on`: an entry with any other key[^|]* is dropped and its die left to Foundry/)
having([], {})
assert.deepEqual(Object.keys(await thorinSheet()), plainKeys, "Bless gone: the sheet's keys as before")
ok((DND5E6 ? 'dnd5e 6.0.5: no effectDice on a sheet, Bless or not' : 'the sheet: Bless applied from Vex\'s concentration lists {name "Bless", effect, d4, count 1, sign 1, on attack, save, death, concentration}, no actor\'s name, kept by a slim sheet; the same from changes of mode 2; named "Bless" from the item itself, by dnd5e\'s flags for a spent scroll\'s concentration, "Blessed" with no origin or an actor\'s; no effect with a die, no effectDice key') + '; PROTOCOL.md says a listener reads an entry only with exactly its six keys, dropping one with any other')

/* -------------------------------------------- */
/*  2-3. Names, and what's read                 */
/* -------------------------------------------- */

if (!DND5E6) {
  // An enemy's Bane, beside another enemy's: "Bane" each, no shaman named anywhere.
  having([baneBy(grukkBane), baneBy(snagBane)], { save: '-1d4 - 1d4', attack: '-1d4 - 1d4' })
  let listed = effectDiceOf(thorin)
  assert.deepEqual(listed.map(({ name, sign }) => [name, sign]), [['Bane', -1], ['Bane', -1]])
  assert.ok(!/Grukk|Snag/.test(JSON.stringify((await thorinSheet()).effectDice)), "no enemy's name on the sheet")
  // Bless from two of the party: each by its caster.
  having([blessedBy(vexBless), blessedBy(miraBless)], { save: '1d4 + 1d4', attack: '1d4 + 1d4' })
  assert.deepEqual(effectDiceOf(thorin).map(each => each.name), ['Bless (Vex)', 'Bless (Mira)'])
  // Bless and Bane together, on `1d4 - 1d4`: one each, in effect order.
  having([blessedBy(vexBless), baneBy(grukkBane)], { save: '1d4 - 1d4', attack: '1d4 - 1d4' })
  listed = effectDiceOf(thorin)
  assert.deepEqual(listed.map(({ name, sign, on }) => [name, sign, on]), [['Bless', 1, BLESS_ON], ['Bane', -1, BLESS_ON]])
  ok("names: an enemy's Bane \"Bane\", never Grukk or Snag, two of them alike; Bless from Vex and from Mira, players' characters, \"Bless (Vex)\" and \"Bless (Mira)\"; Bless and Bane on 1d4 - 1d4, each its own, in effect order")

  // Sage, no campaign's, to read each kind of change on: Athletics and Acrobatics, Perception, a
  // smith's tools of Strength and thieves' tools of Dexterity.
  const sage = new Actor5e({
    id: 'sage', name: 'Sage', skills: { ath: { ability: 'str' }, acr: { ability: 'dex' }, prc: { ability: 'wis' } },
    tools: { smith: { ability: 'str' }, thieves_tools: { ability: 'dex' } },
  })
  sage.documentName = 'Actor'
  const sageItem = { id: 'amulet', _id: 'amulet', name: 'Periapt of Fortune', documentName: 'Item', parent: sage, get actor() { return sage }, system: {}, effects: new Embedded() }
  const read = (effects, fields = {}) => {
    for (const ability of Object.values(sage.system.abilities)) ability.bonuses = { check: '', save: '' }
    for (const entry of [...Object.values(sage.system.skills), ...Object.values(sage.system.tools)]) entry.bonuses = { check: '' }
    sage.system.bonuses = { abilities: { check: '', save: '', skill: '' }, ...Object.fromEntries(ATTACKS.map(kind => [kind, { attack: '' }])) }
    sage.system.attributes.init.bonus = ''
    sage.system.attributes.death.bonuses.save = ''
    foundry.utils.setProperty(sage.system, 'attributes.concentration.bonuses.save', '')
    for (const [path, value] of Object.entries(fields)) foundry.utils.setProperty(sage.system, path, value)
    sage.allApplicableEffects = function* () { yield* effects }
    return effectDiceOf(sage)
  }
  const on = (key, value, extra = {}) => new PlainEffect(sage, { name: 'Boon', system: { changes: [change(key, value)] }, ...extra })
  const tokens = (key, value = '1d4') => read([on(key, value)], { [key]: value }).map(each => each.on)
  assert.deepEqual(read([baneBy(grukkBane)], Object.fromEntries(BLESS_FIELDS.map(key => [key, '-1d4']))).map(each => each.sign), [-1])
  assert.deepEqual(tokens('skills.ath.bonuses.check'), [['skill.ath']], 'Athletic Guidance')
  assert.deepEqual(tokens('abilities.str.bonuses.check', '1d6'), [['check.str', 'skill.ath', 'tool.smith']])
  assert.deepEqual(tokens('abilities.dex.bonuses.check'), [['check.dex', 'skill.acr', 'tool.thieves_tools', 'initiative']])
  assert.deepEqual(tokens('abilities.con.bonuses.save'), [['save.con', 'concentration']])
  assert.deepEqual(tokens('abilities.wis.bonuses.save'), [['save.wis']])
  assert.deepEqual(tokens('bonuses.abilities.check'), [['check', 'skill', 'tool', 'initiative']])
  assert.deepEqual(tokens('bonuses.abilities.skill'), [['skill']])
  assert.deepEqual(tokens('tools.thieves_tools.bonuses.check'), [['tool.thieves_tools']])
  assert.deepEqual(tokens('attributes.init.bonus'), [['initiative']])
  assert.deepEqual(tokens('attributes.death.bonuses.save'), [['death']])
  assert.deepEqual(tokens('attributes.concentration.bonuses.save'), [['concentration']])
  assert.deepEqual(read([on('bonuses.abilities.save', '2d4')], { 'bonuses.abilities.save': '2d4' }).map(each => each.count), [2])
  // One effect's changes of one die merge, its kind-wide roll standing for each of its own.
  const merged = new PlainEffect(sage, { name: 'Boon', system: { changes: [change('abilities.dex.bonuses.save', '1d6'), change('bonuses.abilities.save', '1d6'), change('skills.ath.bonuses.check', '1d6')] } })
  assert.deepEqual(read([merged], { 'abilities.dex.bonuses.save': '1d6', 'bonuses.abilities.save': '1d6', 'skills.ath.bonuses.check': '1d6' }).map(each => each.on),
    [['save', 'skill.ath', 'death', 'concentration']])
  // Not listed: an attack kind alone; what isn't one plain die; a subtraction or an override; a field
  // that doesn't hold it as prepared; an effect off, suppressed or concealed.
  assert.deepEqual(read([on('bonuses.mwak.attack', '1d4')], { 'bonuses.mwak.attack': '1d4' }), [], 'melee weapon attacks alone')
  for (const value of ['1d4 + 1', '1d3', '1d20', '@scale.bard.inspiration', '1d4x', '21d4']) {
    assert.deepEqual(read([on('bonuses.abilities.save', value)], { 'bonuses.abilities.save': value }), [], value)
  }
  for (const type of ['subtract', 'override', 'custom']) {
    assert.deepEqual(read([new PlainEffect(sage, { name: 'Boon', system: { changes: [change('bonuses.abilities.save', '1d4', type)] } })], { 'bonuses.abilities.save': '1d4' }), [], type)
  }
  for (const field of ['', '2', '(1d4)', 'max(1d4, 2)']) {
    assert.deepEqual(read([on('bonuses.abilities.save', '1d4')], { 'bonuses.abilities.save': field }), [], `the field ${JSON.stringify(field)}`)
  }
  for (const [why, extra] of [['disabled', { disabled: true }], ['suppressed', { suppressed: true }], ['concealed', { system: { isConcealed: true, changes: [change('bonuses.abilities.save', '1d4')] } }]]) {
    assert.deepEqual(read([on('bonuses.abilities.save', '1d4', extra)], { 'bonuses.abilities.save': '1d4' }), [], why)
  }
  // An item's transferred effect, by its item.
  sageItem.effects.clear()
  const periapt = effectOnItem(sageItem, { _id: 'periaptBoon', name: 'Fortune', system: { changes: [change('bonuses.abilities.check', '1d4')] } })
  assert.deepEqual(read([periapt], { 'bonuses.abilities.check': '1d4' }).map(({ name, effect }) => [name, effect]), [['Periapt of Fortune', 'amulet.periaptBoon']])
  // At most ten, in effect order.
  const many = Array.from({ length: 12 }, (_, i) => on(`abilities.str.bonuses.check`, '1d4', { _id: `manyBoon${String(i).padStart(8, '0')}` }))
  const ten = read(many, { 'abilities.str.bonuses.check': Array(12).fill('1d4').join(' + ') })
  assert.deepEqual(ten.map(each => each.effect), many.slice(0, 10).map(each => each.id))
  const everyToken = [...ten, ...read([merged], { 'abilities.dex.bonuses.save': '1d6', 'bonuses.abilities.save': '1d6', 'skills.ath.bonuses.check': '1d6' })].flatMap(each => each.on)
  assert.ok(everyToken.every(token => EFFECT_TOKEN.test(token)), 'every token as the app reads them')
  ok("what's read: Bane sign -1; Athletic Guidance skill.ath; a Strength check bonus check.str with Athletics and the smith's tools, Dexterity's with initiative and tool.thieves_tools; a Constitution save bonus save.con and concentration; every check's check, skill, tool, initiative; the death save's death and the concentration check's concentration; 2d4 count 2; one effect's changes of one die merged; none for a melee-only attack bonus, 1d4 + 1, 1d3, 1d20, roll data, an explosion, 21d4, a subtraction, override or custom change, a field '' or '2' or holding it within parentheses or a function, an effect off, suppressed or concealed; an item's effect by its item; at most ten, in effect order; every token the app's")

  /* -------------------------------------------- */
  /*  4. Re-sends                                 */
  /* -------------------------------------------- */

  having([], { save: '1d4', attack: '1d4' })
  await thorinSheet()
  let from = app.events.length
  const cast = blessedBy(vexBless)
  thorin.effects.push(cast)
  await Hooks.callAll('createActiveEffect', cast, {}, 'gm')
  await settle()
  const thorinPosts = since => app.events.slice(since).filter(e => (e.type === 'character.updated') && (e.campaign.id === 'camp-a') && (e.data.character.id === 'thorin'))
  assert.deepEqual(thorinPosts(from).at(-1)?.data.character.sheet.effectDice?.map(each => each.name), ['Bless'], 'created: sent with it')
  from = app.events.length
  thorin.effects = []
  await Hooks.callAll('deleteActiveEffect', cast, {}, 'gm')
  await settle()
  assert.equal('effectDice' in (thorinPosts(from).at(-1)?.data.character.sheet ?? { effectDice: 0 }), false, 'deleted: sent without it')
  ok('re-sends: Bless created on Thorin sends his sheet with effectDice, deleted, without')
}

/* -------------------------------------------- */
/*  5. The hello and the self-tests             */
/* -------------------------------------------- */

assert.deepEqual([diceStatus.keptRerolls, diceStatus.effectDice, diceStatus.negativeDice, diceStatus.typedError], [true, true, true, null], 'the self-tests passed')
let flags = await hello('camp-a')
assert.deepEqual([flags.effectDice, flags.keptRerolls], [!DND5E6, true], 'camp-a, manual dice on')
assert.deepEqual(Object.keys(flags).slice(-3), ['companionPrompts', 'effectDice', 'keptRerolls'], 'last, after companionPrompts')
flags = await hello('camp-b')
assert.deepEqual([flags.effectDice, flags.keptRerolls], [false, false], 'camp-b, manual dice off')
// Each flag follows its own self-test.
Object.assign(diceStatus, { effectDice: false })
assert.deepEqual([(await hello('camp-a')).effectDice, (await hello('camp-a')).keptRerolls], [false, true], 'effectDice off with its self-test')
// And a typed save sent with Bless's d4 all the same, as by an app that saw an earlier hello: the d4
// Foundry's, the 3 unused.
having([blessedBy(vexBless)], { save: '1d4', attack: '1d4' })
nextFace(4, 2)
const unchecked = await roll({ kind: 'save', key: 'dex', typed: true, dice: [{ faces: 20, results: [12] }], effectDice: [{ faces: 4, sign: 1, results: [3] }] })
having([], {})
assert.deepEqual([unchecked.status, facesOf(messageOf(unchecked.id).rolls[0], 4)], ['done', [[2]]], "effectDice off: Bless's d4 Foundry's")
Object.assign(diceStatus, { effectDice: true, keptRerolls: false })
assert.deepEqual([(await hello('camp-a')).effectDice, (await hello('camp-a')).keptRerolls], [!DND5E6, false], 'keptRerolls off with its self-test')
Object.assign(diceStatus, { keptRerolls: true })
globalThis.countPrints = true
// A world whose dice keep a dropped reroll: kept rerolls off, effect dice on.
const fresh = () => Object.assign(diceStatus, { keptRerolls: false, effectDice: false, negativeDice: false, typedError: null })
fresh()
diceCore.staleModifiers = true
await selfTest()
const stale = [diceStatus.keptRerolls, diceStatus.effectDice, diceStatus.negativeDice, typeof diceStatus.typedError]
flags = await hello('camp-a')
diceCore.staleModifiers = false
// Its typed Halfling's 1 sent as kept is rerolled all the same, as before 0.42.0: by the module, the
// fault off again, which would reroll it whatever the module dropped.
thorin.flags.dnd5e.halflingLucky = true
const staleRoll = messageOf((await roll({ kind: 'save', key: 'dex', typed: true, rerolls: 'kept', dice: [{ faces: 20, results: [1] }] })).id).rolls[0]
thorin.flags.dnd5e.halflingLucky = false
assert.deepEqual(stale, [false, true, true, 'string'], `stale modifiers: ${diceStatus.typedError}`)
assert.deepEqual([flags.effectDice, flags.keptRerolls], [!DND5E6, false], "the hello says so")
assert.equal(staleRoll.dice[0].results[0].rerolled, true, 'a typed 1 sent as kept, rerolled where the self-test failed')
assert.ok(staleRoll.formula.includes('r1=1'), `made with r1=1: ${staleRoll.formula}`)
// A world whose parser nests a lone negative die: Bane left off the sheet, Bless kept.
fresh()
diceCore.nestNegative = true
await selfTest()
const nested = [diceStatus.keptRerolls, diceStatus.effectDice, diceStatus.negativeDice, typeof diceStatus.typedError]
having([blessedBy(vexBless), baneBy(grukkBane)], { save: '1d4 - 1d4', attack: '1d4 - 1d4' })
const nestedSheet = await thorinSheet()
diceCore.nestNegative = false
assert.deepEqual(nested, [true, true, false, 'string'], `nested negative dice: ${diceStatus.typedError}`)
if (!DND5E6) assert.deepEqual(nestedSheet.effectDice.map(each => each.name), ['Bless'], 'Bane left off, Bless listed')
// A world whose rolls throw copies of the dice they add, so the d4 a roll adds isn't the d4 noted:
// effect dice off, and the lone -1d4 never tried, though it would pass here; kept rerolls on. Under
// each of a dozen seeds, Foundry's copy showing another face than Bless's 3 under some and, by
// chance, the 3 itself under others, where only the 3 typed and left unused tells it from Bless's.
diceCore.freshTerms = true
const copied = []
for (let seed = 1; seed <= 12; seed++) {
  fresh()
  seedRandom(seed)
  await selfTest()
  copied.push([diceStatus.keptRerolls, diceStatus.effectDice, diceStatus.negativeDice, diceStatus.typedError])
}
diceCore.freshTerms = false
flags = await hello('camp-a')
for (const [kept, effect, negative, error] of copied) assert.deepEqual([kept, effect, negative, typeof error], [true, false, false, 'string'], `copied dice: ${error}`)
const copiedErrors = copied.map(([, , , error]) => error)
assert.ok(copiedErrors.some(error => /threw \[\[10\],\[[124]\],\[1\]\], not 10/.test(error)), `Foundry's copy another face under some seed: ${JSON.stringify(copiedErrors)}`)
assert.ok(copiedErrors.some(error => /threw \[\[10\],\[3\],\[1\]\] but left unused .*\(\+d4 3\)/.test(error)), `Foundry's copy Bless's 3 by chance under some seed, its 3 left unused: ${JSON.stringify(copiedErrors)}`)
assert.deepEqual([flags.effectDice, flags.keptRerolls], [false, true], "the hello says so")
// The attack self-test failing: both still checked and passed, ahead of it.
fresh()
diceCore.breakReroll = true
await selfTest()
const ahead = [diceStatus.attacks, diceStatus.keptRerolls, diceStatus.effectDice, diceStatus.negativeDice]
diceCore.breakReroll = false
globalThis.countPrints = false
assert.deepEqual(ahead, [false, true, true, true], 'placed before the attack self-test')
assert.ok(printed.every(line => line.startsWith("sending-stone | Players' attacks from Sending Stone can't be made")), `only the attack self-test's warning: ${JSON.stringify(printed)}`)
printed.length = 0
fresh()
await selfTest()
assert.deepEqual([diceStatus.attacks, diceStatus.keptRerolls, diceStatus.effectDice, diceStatus.negativeDice, diceStatus.typedError], [true, true, true, true, null])
having([], {})
await hello('camp-a')
ok(`the hello: features.rolls.effectDice ${DND5E6 ? 'false under dnd5e 6' : 'true'} and keptRerolls true in camp-a, both false in camp-b, last after companionPrompts, each off with its own self-test, a typed save's Bless d4 Foundry's while effectDice is off; dice keeping a dropped reroll: keptRerolls false, effectDice true, typedError set, the hello saying so, and a typed 1 kept rerolled all the same by the module, r1=1 kept; a nested lone -1d4: negativeDice false, effectDice true${DND5E6 ? '' : ', Bane left off the sheet and Bless on it'}; rolls throwing copies of the dice they add: effectDice false under each of 12 seeds, Foundry's copy showing Bless's 3 by chance under some (its typed 3 left unused) and another face under others, negativeDice not tried, keptRerolls true, the hello saying so; the attack self-test failing: both still true; nothing printed by them`)

/* -------------------------------------------- */
/*  6-8. Routing                                */
/* -------------------------------------------- */

const save = fields => roll({ kind: 'save', key: 'dex', typed: true, dice: [{ faces: 20, results: [12] }], ...fields })
const rollOf = made => messageOf(made.id)?.rolls[0]
if (!DND5E6) {
  const DEX = 4
  // 6. A typed Dexterity save with Bless's d4 typed: the card's d4 3.
  having([blessedBy(vexBless)], { save: '1d4', attack: '1d4' })
  let made = await save({ effectDice: [{ faces: 4, sign: 1, results: [3] }] })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual([facesOf(rollOf(made), 20), facesOf(rollOf(made), 4), rollOf(made).total], [[[12]], [[3]], 12 + DEX + 3])
  // Skipped, none sent: Foundry's.
  nextFace(4, 2)
  made = await save({})
  assert.deepEqual([facesOf(rollOf(made), 4), rollOf(made).total], [[[2]], 12 + DEX + 2], "skipped: Foundry's d4")
  // Bless and Bane: each its own, Bane's taken away.
  having([blessedBy(vexBless), baneBy(grukkBane)], { save: '1d4 - 1d4', attack: '1d4 - 1d4' })
  made = await save({ effectDice: [{ faces: 4, sign: -1, results: [1] }, { faces: 4, sign: 1, results: [3] }] })
  assert.deepEqual([facesOf(rollOf(made), 4), rollOf(made).total], [[[3], [1]], 12 + DEX + 3 - 1], 'Bless 3, Bane 1 taken away')
  // Bane alone, a lone -1d4: its 1 taken away.
  having([baneBy(grukkBane)], { save: '-1d4', attack: '-1d4' })
  made = await save({ effectDice: [{ faces: 4, sign: -1, results: [1] }] })
  assert.deepEqual([facesOf(rollOf(made), 4), rollOf(made).total], [[[1]], 12 + DEX - 1], 'Bane alone')
  // A die nested in parentheses takes no value typed for an effect: Foundry's.
  diceCore.nestNegative = true
  nextFace(4, 2)
  made = await save({ effectDice: [{ faces: 4, sign: 1, results: [3] }, { faces: 4, sign: -1, results: [1] }] })
  diceCore.nestNegative = false
  assert.deepEqual([made.status, rollOf(made).total], ['done', 12 + DEX - 2], 'a nested -1d4 Foundry\'s')
  // The player's own +1d4 first, then Bless's.
  having([blessedBy(vexBless)], { save: '1d4', attack: '1d4' })
  made = await save({ extras: [{ sign: 1, count: 1, sides: 4 }], dice: [{ faces: 20, results: [12] }, { faces: 4, results: [2] }], effectDice: [{ faces: 4, sign: 1, results: [3] }] })
  assert.deepEqual([facesOf(rollOf(made), 4), rollOf(made).total], [[[2], [3]], 12 + 2 + DEX + 3], "the situational d4 the player's 2, Bless's 3")
  // Values for a die the roll doesn't have: made, the values dropped.
  having([], {})
  made = await save({ effectDice: [{ faces: 4, sign: 1, results: [3] }, { faces: 6, sign: -1, results: [5] }] })
  assert.deepEqual([made.status, facesOf(rollOf(made), 4), rollOf(made).total], ['done', [], 12 + DEX])
  // Not typed, or the Gamemaster's: Foundry's.
  having([blessedBy(vexBless)], { save: '1d4', attack: '1d4' })
  nextFace(4, 2)
  made = await save({ typed: undefined, effectDice: [{ faces: 4, sign: 1, results: [3] }] })
  assert.deepEqual([made.status, facesOf(rollOf(made), 4)], ['done', [[2]]], 'untyped')
  nextFace(4, 2)
  made = await save({ by: 'gm', effectDice: [{ faces: 4, sign: 1, results: [3] }] })
  assert.deepEqual([made.status, facesOf(rollOf(made), 4)], ['done', [[2]]], "the Gamemaster's")
  ok("routing: a typed Dexterity save takes Bless's typed d4 (12 + 4 + 3); skipped, Foundry's; Bless and Bane each their own on 1d4 - 1d4, Bane's 1 taken away; Bane alone's 1 taken away; a die nested in parentheses Foundry's; the player's own +1d4 first, Bless's after; values with no die dropped, the roll made; untyped and the Gamemaster's, Foundry's")

  // 7. A death save, a concentration check dnd5e's card asks, and initiative.
  const { hp } = thorin.system.attributes
  thorin.system.attributes.hp = { ...hp, value: 0 }
  thorin.system.attributes.death = { ...thorin.system.attributes.death, success: 0, failure: 0 }
  made = await roll({ kind: 'death', key: undefined, typed: true, dice: [{ faces: 20, results: [12] }], effectDice: [{ faces: 4, sign: 1, results: [3] }] })
  assert.deepEqual([made.status, facesOf(rollOf(made), 4), rollOf(made).total], ['done', [[3]], 15], 'a death save adds the saving throws\' Bless')
  thorin.system.attributes.hp = { ...hp, value: 30 }
  thorin.system.attributes.death = { ...thorin.system.attributes.death, success: 0, failure: 0 }
  // Mirkwood asks its players for their saves: dnd5e's concentration card, answered typed there.
  withConcentrationChecks(thorin)
  thorin.concentration.effects.set('concBolt', { id: 'concBolt', statuses: new Set(['concentrating']), _stats: { createdTime: Date.now() - 1000 }, flags: { dnd5e: { item: { id: 'bolt', type: 'spell' } } } })
  settings.set('campaigns', [CAMPAIGNS[0], { ...CAMPAIGNS[1], prompts: true }])
  settings.set('challengeVisibility', 'all')
  having([], { concentration: '1d4' })
  const card = await concentrationCardOf(thorin, { dc: 10 })
  await until(() => app.events.some(e => (e.type === 'roll.prompt.opened') && (e.data.prompt.id === `${card.id}-thorin`)), 'the concentration prompt')
  made = await sendTo('camp-b', {
    id: `conc-${++ids}`, actorId: 'thorin', kind: 'save', key: 'con', prompt: `${card.id}-thorin`, mode: 0, explicit: false, extras: [],
    dice: [{ faces: 20, results: [15] }], typed: true, effectDice: [{ faces: 4, sign: 1, results: [3] }],
  })
  assert.deepEqual([made.status, made.outcome, facesOf(rollOf(made), 4), rollOf(made).total], ['done', 'success', [[3]], 15 + 2 + 3 + 3], 'its concentration bonus typed')
  settings.set('campaigns', CAMPAIGNS)
  thorin.concentration.effects.delete('concBolt')
  // Initiative, with every check's bonus.
  fight.rollInitiative = rollCombatInitiative
  having([], { check: '1d4' })
  made = await roll({ kind: 'initiative', key: undefined, combatId: 'fight', dice: [{ faces: 20, results: [11] }], typed: true, effectDice: [{ faces: 4, sign: 1, results: [3] }] })
  assert.deepEqual([made.status, facesOf(rollOf(made), 4), rollOf(made).total], ['done', [[3]], 11 + DEX + 3], 'initiative')
  // A skill, a tool and an ability check, with every check's bonus: its d4 typed, or Foundry's skipped.
  CONFIG.DND5E.tools.smith = { label: "Smith's Tools", ability: 'str' }
  for (const [kind, key] of [['skill', 'prc'], ['tool', 'smith'], ['ability', 'str']]) {
    made = await roll({ kind, key, typed: true, dice: [{ faces: 20, results: [12] }], effectDice: [{ faces: 4, sign: 1, results: [3] }] })
    assert.equal(made.status, 'done', `${kind} ${key}: ${JSON.stringify(made)}`)
    nextFace(4, 1)
    const skipped = await roll({ kind, key, typed: true, dice: [{ faces: 20, results: [12] }] })
    assert.deepEqual([facesOf(rollOf(made), 4), facesOf(rollOf(skipped), 4), rollOf(made).total - rollOf(skipped).total], [[[3]], [[1]], 2], `${kind} ${key}`)
  }
  delete CONFIG.DND5E.tools.smith
  ok("other d20 rolls: a typed death save takes Bless's d4; dnd5e's concentration card, answered typed, its concentration bonus's d4; initiative, a skill, a tool and an ability check, every check's bonus's d4, Foundry's where skipped")

  // 8. Attacks: the rapier with Bless on melee weapon attacks.
  having([blessedBy(vexBless)], { save: '1d4', attack: '1d4' })
  made = await attack({ typed: true, dice: [{ faces: 20, results: [15] }], effectDice: [{ faces: 4, sign: 1, results: [3] }] })
  assert.equal(made.status, 'done', JSON.stringify(made))
  thrown = attackRollOf(made)
  assert.deepEqual([d20sOf(thrown), facesOf(thrown, 4), thrown.total], [[15], [[3]], 15 + DEX + 3 + 3], `the rapier's Bless${MIDI ? ", through Midi-QOL's workflow" : ''}`)
  // Elven Accuracy, two d20s sent: the third Foundry's.
  made = await attack({ mode: 1, explicit: true, typed: true, dice: [{ faces: 20, results: [4, 17] }], effectDice: [{ faces: 4, sign: 1, results: [3] }] })
  thrown = attackRollOf(made)
  assert.deepEqual([made.status, d20sOf(thrown).slice(0, 2), d20sOf(thrown).length, facesOf(thrown, 4)], ['done', [4, 17], 3, [[3]]], "Elven Accuracy's third Foundry's")
  having([], {})
  ok(`attacks: the rapier takes Bless's typed d4 as its actor bonus${MIDI ? " through Midi-QOL's workflow" : ''}; with Elven Accuracy and two d20s sent, the third is Foundry's`)
}

/* -------------------------------------------- */
/*  9. Rerolls kept                             */
/* -------------------------------------------- */

thorin.flags.dnd5e.halflingLucky = true
const keptOne = await save({ rerolls: 'kept', dice: [{ faces: 20, results: [1] }] })
const keptRoll = rollOf(keptOne)
assert.deepEqual([keptOne.status, keptRoll.dice[0].results.map(r => [r.result, r.active, r.rerolled === true]), keptRoll.formula.includes('r1=1')], ['done', [[1, true, false]], false], keptRoll.formula)
for (const [why, fields] of [['typed without rerolls', {}], ['rerolls "other"', { rerolls: 'other' }], ['untyped', { typed: undefined, rerolls: 'kept' }], ["the Gamemaster's", { by: 'gm', rerolls: 'kept' }]]) {
  const again = rollOf(await save({ dice: [{ faces: 20, results: [1] }], ...fields }))
  assert.equal(again.dice[0].results[0].rerolled, true, why)
}
// One d20 typed, 1, the game giving advantage as the roll is made and Foundry's d20 a 1 too: a d20 of
// Foundry's in the term, so it keeps its reroll, and the 1 advantage keeps, the first, is rerolled.
const advantage = Hooks.on('dnd5e.postBuildRollConfig', (process, config) => {
  if (process?.hookNames?.includes('d20Test')) { config.options ??= {}; config.options.advantageMode = CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE }
})
nextFace(20, 1)
const withAdvantage = rollOf(await save({ rerolls: 'kept', dice: [{ faces: 20, results: [1] }] }))
Hooks.off('dnd5e.postBuildRollConfig', advantage)
thorin.flags.dnd5e.halflingLucky = false
assert.deepEqual([withAdvantage.formula.includes('r1=1'), withAdvantage.dice[0].results.slice(0, 2).map(r => r.result),
  withAdvantage.dice[0].results.filter(r => r.rerolled).length], [true, [1, 1], 1], withAdvantage.formula)
ok("rerolls kept: a Halfling's typed 1 sent with rerolls kept is one d20, 1, standing, its formula without r1=1; typed without it, with rerolls \"other\", untyped or the Gamemaster's, rerolled; one typed d20 where the game adds advantage, a d20 of Foundry's in the term, keeps r1=1 and rerolls a 1")

// Damage, typed, with rerolls kept: the greataxe's damage written as given.
const axe = thorin.items.get('greataxe')
const cleave = axe._source.activities.find(activity => activity.id === 'cleave')
const axeDamage = cleave.damage
const goblinHp = goblin.system.attributes.hp.value
const damageRollOf = (use, dealt) => (MIDI ? workflowOf(use)?.damageRolls?.[0] : messageOf(dealt.id)?.rolls[0])
const hewn = async (formula, results, fields = { typed: true, rerolls: 'kept' }) => {
  cleave.damage = [{ custom: formula, types: ['slashing'] }]
  axe.updateSource({})
  try {
    const swing = await attack({ item: 'greataxe', activity: 'cleave' })
    assert.equal(swing.status, 'done', JSON.stringify(swing))
    const dealt = await damage(swing.id, [{ faces: 6, results }], fields)
    assert.equal(dealt.status, 'done', `${formula}: ${JSON.stringify(dealt)}`)
    return { dealt, roll: damageRollOf(swing.id, dealt) }
  } finally {
    cleave.damage = axeDamage
    axe.updateSource({})
    goblin.system.attributes.hp.value = goblinHp
  }
}
const shown = die => die.results.map(r => [r.result, r.active, r.rerolled === true])
let hit = await hewn('2d6r<=2 + 2', [1, 5])
assert.deepEqual([shown(hit.roll.dice[0]), hit.dealt.rolls[0].total, hit.roll.formula.includes('r<=2')], [[[1, true, false], [5, true, false]], 8, false], '2d6r<=2 kept: 1 and 5, 6 + 2')
hit = await hewn('1d6rr<3', [1])
assert.deepEqual([shown(hit.roll.dice[0]), hit.dealt.rolls[0].total], [[[1, true, false]], 1], '1d6rr<3: no loop')
hit = await hewn('1d6x', [6])
assert.deepEqual([hit.roll.dice[0].results[0].exploded, hit.roll.dice[0].results.length > 1], [true, true], "1d6x: Foundry's die more")
hit = await hewn('2d6min3', [1, 5])
assert.equal(hit.dealt.rolls[0].total, 8, '2d6min3: 3 + 5')
hit = await hewn('4d6kh3', [1, 2, 3, 4])
assert.equal(hit.dealt.rolls[0].total, 9, '4d6kh3: the highest three')
hit = await hewn('2d6r<=2 + 2', [1, 5], { typed: true })
assert.deepEqual([hit.roll.dice[0].results[0].rerolled, hit.roll.formula.includes('r<=2')], [true, true], 'typed without rerolls kept: rerolled, as before')
ok(`typed damage with rerolls kept${MIDI ? ", through Midi-QOL's workflow" : ''}: 2d6r<=2 typed 1 and 5 stands, 6 + 2, its formula without r<=2; 1d6rr<3 typed 1 stands; 1d6x typed 6 still explodes, Foundry's die more; 2d6min3 typed 1 and 5 is 8; 4d6kh3 typed 1 to 4 is 9; typed without rerolls kept, rerolled as before`)

// Two terms of one size, each rerolling a 1, and one d6 typed, 1, sent as kept: the first term, every
// die of it typed, stands, and the second, Foundry's, keeps its reroll; where the first has a die of
// Foundry's, both keep theirs, the typed 1 rerolled too.
const madeKept = async (formula, results) => {
  const id = `terms-${++ids}`
  const made = new foundry.dice.Roll(formula, {}, { [ROLL_TAG]: id })
  await withPlan({ id, typed: true, rerolls: 'kept', dice: [{ faces: 6, results }] }, () => made.evaluate())
  return made
}
nextFace(6, 1)
let terms = await madeKept('1d6r1 + 1d6r1', [1])
assert.deepEqual([terms.formula, shown(terms.dice[0]), terms.dice[1].results[0].result, terms.dice[1].results[0].rerolled === true],
  ['1d6 + 1d6r1', [[1, true, false]], 1, true], '1d6r1 + 1d6r1, one d6 typed')
terms = await madeKept('2d6r1 + 1d6r1', [1])
assert.deepEqual([terms.formula, terms.dice[0].results[0].result, terms.dice[0].results[0].rerolled === true], ['2d6r1 + 1d6r1', 1, true], '2d6r1 + 1d6r1, one d6 typed')
ok("rerolls kept on terms of one size: one d6 typed 1 and kept, 1d6r1 + 1d6r1 is made 1d6 + 1d6r1, the typed 1 standing and Foundry's 1 rerolled; 2d6r1 + 1d6r1, its first term with a die of Foundry's, keeps both rerolls, the typed 1 rerolled")

/* -------------------------------------------- */
/*  10. Validation                              */
/* -------------------------------------------- */

const four = (results = [3]) => ({ faces: 4, sign: 1, results })
for (const [why, effectDice, fields] of [
  ['not a list', { faces: 4, sign: 1, results: [3] }], ['11 dice', Array.from({ length: 11 }, () => four())],
  ['faces 3', [{ faces: 3, sign: 1, results: [2] }]], ['faces 20', [{ faces: 20, sign: 1, results: [12] }]],
  ['sign 0', [{ faces: 4, sign: 0, results: [3] }]], ['a 0', [four([0])]], ['a 5 on a d4', [four([5])]], ['21 values', [four(Array(21).fill(1))]],
  ['no values', [four([])]], ['on a formula', [four()], { kind: 'formula', key: undefined, item: 'staff', activity: 'cast-guide' }],
  ['on damage', [four()], { kind: 'damage', key: undefined, use: 'atk-1', dice: [{ faces: 8, results: [5] }] }],
]) {
  const refused = await save({ effectDice, ...fields })
  assert.deepEqual([refused.status, refused.reason, refused.error], ['failed', 'invalid', 'effectDice'], why)
}
assert.equal((await save({ effectDice: null })).status, 'done', 'null, as none')
ok('validation: effectDice not a list, of 11, of faces 3 or 20, sign 0, a value 0 or 5 on a d4, 21 values or none, or on a formula or damage, refused "invalid", error "effectDice"; null as none')

/* -------------------------------------------- */
/*  11. Companions                              */
/* -------------------------------------------- */

const wolf = new Actor5e({ id: 'wolfCompanion', name: 'Wolf', mods: { str: 2, dex: 2 } })
wolf.type = 'npc'
wolf.documentName = 'Actor'
equip(wolf, { items: [] })
const wolfBless = new PlainEffect(wolf, { _id: 'wolfBlessed', name: 'Blessed', origin: vexBless.concentration.uuid, system: { changes: blessChanges('1d4') } })
wolf.allApplicableEffects = function* () { yield wolfBless }
wolf.system.bonuses.abilities.save = '1d4'
for (const kind of ATTACKS) wolf.system.bonuses[kind].attack = '1d4'
const companionSheet = characterSheet(wolf, undefined, { ops: false })
assert.deepEqual(companionSheet.effectDice, DND5E6 ? undefined : [{ name: 'Bless', effect: 'wolfBlessed', faces: 4, count: 1, sign: 1, on: BLESS_ON }])
ok(`a companion's sheet, built as the module builds one (ops: false), ${DND5E6 ? 'lists no effectDice under dnd5e 6' : 'lists Bless on it'}`)

console.log(`typed${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
