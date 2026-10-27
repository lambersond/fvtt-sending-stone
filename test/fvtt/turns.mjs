// Ending a turn from the app (module 0.36.0, its contract §2.8, §4.7-§4.10, §5.5, §6.11, §6.13):
// `endTurn`, the character's command, naming the turn it was shown by its combat, round and current
// combatant, made by core's own `nextTurn` on the bridge where that turn is still the current one and
// it's the character's or one of its companions' now; refused `not-started`, `moved` or `not-turn`
// where not, and nothing more moves. And `undoEndTurn` (its contract §2.8 v6, §6.11 v6, §6.14):
// the turn an End Turn just ended, taken back for the character whose command ended it, from the
// module's memory of it, while the combat stands where it left it, by one update of the turn back to
// the combatant whose turn it ended, found by its id, with Foundry's turn events off; refused
// `not-undoable`, `moved` or `not-turn` where not, and nothing written. The real module; dnd5e
// 5.3.3's real dice classes, or 6.0.5's with DND5E6=1; dnd5e's actors, items and activities ported
// (actor5e.mjs, activity5e.mjs); scenes, tokens and a combat whose turns move as Next Turn moves
// them, and are written as core's update writes them (token-core.mjs); with MIDI=1,
// midi-fake.mjs's workflow, its Gamemaster's confirmation of damage and its release of their targets
// when the turn changes; a stand-in Foundry core and app. The module's long waits are a hundredfold
// shorter, as companions.mjs has them, but the Midi wait's 10 seconds take 1 s and a command's
// watchdog 3 s, and its clock moves on where a case says. Run with --import ./unref-timers.mjs
// --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { settings, user, users, actors } from './stub.mjs'
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
const DND5E6 = Boolean(process.env.DND5E6)
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
// The module's long waits, shortened a hundredfold; its 250 ms settling kept as it is. Two are kept
// apart. The Midi wait's 10 s (TURN_MIDI_WAIT) takes 1 s, well clear of pastTargeting's 100 ms polls
// (CHECK_EVERY, too short to be shortened), so a case can tell a wait that ends as Midi's queue
// settles, or at once with nothing queued, from one that runs its course. And a command's 60 s
// watchdog takes 3 s, to stay past that wait. The module's only other 10 s timeout, midi-prompts'
// VERDICT_WAIT, is never reached here.
const LONGER = new Map([[10_000, 1_000], [60_000, 3_000]])
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, LONGER.get(ms) ?? (ms >= 1000 ? ms / 100 : ms), ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
globalThis.document = { hidden: false }
// A clock a case moves on, past the minute a Midi area's damage holds the Gamemaster's targets.
let clock = 0
const realNow = Date.now
Date.now = () => realNow() + clock

// ---- dnd5e ----
const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
if (DND5E6) game.system.version = '6.0.5'
const TYPES = ['slashing', 'piercing', 'fire']
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(TYPES.map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' } },
  actorSizes: { tiny: { label: 'Tiny' }, medium: { label: 'Medium' } },
  activityActivationTypes: { action: { label: 'Action' }, bonus: { label: 'Bonus Action' }, reaction: { label: 'Reaction' } },
  characterFlags: { elvenAccuracy: { abilities: ['dex', 'int', 'wis', 'cha'] } },
}
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')
settings.set('initiativeDexTiebreaker', true)
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, SaveActivity, DamageActivity, HealActivity, equip, port } = await import('./activity5e.mjs')
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  dice: { DamageRoll },
  documents: { activity: { AttackActivity, SaveActivity, DamageActivity, HealActivity } },
  registry: {
    messages: {
      get(id, type) {
        return [...messages.values()].filter(m => (m.flags?.dnd5e?.originatingMessage === id) && (m.flags?.dnd5e?.roll?.type === type))
      },
    },
  },
}
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }
foundry.utils.escapeHTML ??= value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return String(html ?? '') } } }
port.targets = true

const { changeActor, changeDelta, combatOf, companionActor, faults, placeToken, scene } = await import('./token-core.mjs')

// ---- The users ----
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
const carol = user('carol', 'Carol')
if (MIDI) installMidi()

// ---- The world ----
const add = actor => { actors.set(actor.id, actor); return actor }
const noSlots = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => [`spell${level}`, { value: 0, max: 0, level }]))
// Thorin, Alice's: Find Familiar, which summoned the Bat, and a longsword.
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 3, dex: 2, wis: 2 }, skills: { prc: { ability: 'wis' } } }))
alice.character = thorin
equip(thorin, {
  items: [
    { id: 'findFamiliar', name: 'Find Familiar', type: 'spell', system: { level: 1, method: 'spell', properties: [] }, activities: [{ id: 'ff-summon', type: 'summon' }] },
    { id: 'longsword', name: 'Longsword', type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee' },
      activities: [{ id: 'ls-swing', damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }] }] },
  ],
})
// Vex, Bob's, with a Fireball for the area that holds the Gamemaster's targets under Midi-QOL.
const vex = add(new Actor5e({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3, wis: 3 } }))
bob.character = vex
equip(vex, {
  spells: { ...noSlots, spell3: { value: 3, max: 3, level: 3 } },
  items: [{ id: 'fireball', name: 'Fireball', type: 'spell', system: { level: 3, method: 'spell', properties: [] },
    activities: [{ id: 'blast', type: 'save', ability: 'wis', template: 'sphere', affects: 'creature', save: ['dex'], dc: 15, damage: [{ number: 8, denomination: 6, types: ['fire'], scaling: 1 }] }] }],
})
// Pip, Carol's, in campaigns of their own.
const pip = add(new Actor5e({ id: 'pip', name: 'Pip', owners: ['carol'], mods: { dex: 1 } }))
carol.character = pip
equip(pip, { items: [] })

const arena = scene('arena', { active: true })
scene('den')
const creature = (mods = {}) => ({ mods, skills: { prc: { ability: 'wis' } }, hp: { value: 12, max: 12, temp: 0 } })
// Brakka, Thorin's sidekick: linked, Alice's by id.
const brakka = companionActor('brakka', 'Brakka', { owners: ['alice'], linked: true, spec: creature({ str: 3 }) })
// The Bat, Thorin's familiar: a token Find Familiar summoned, no player's in Foundry.
const bat = companionActor('bat', 'Bat', { linked: false, spec: creature({ dex: 2 }), system: { traits: { size: 'tiny' } } })
const bat1 = placeToken(arena, bat, { id: 'bat1', name: 'Bat', delta: { flags: { dnd5e: { summon: { origin: 'Actor.thorin.Item.findFamiliar', activity: 'ff-summon' } } } } })
// Vex's wolf: a token of the Gamemaster's Wolf whose delta gives Bob Owner.
const wolf = companionActor('wolf', 'Wolf', { linked: false, spec: creature({ str: 2 }) })
const wolf1 = placeToken(arena, wolf, { id: 'wolf1', name: 'Wolf', delta: { ownership: { bob: 3 } } })
// A goblin and an orc, no one's.
const foe = (id, name) => {
  const actor = add(new Actor5e({ id, name, mods: { dex: 2 }, hp: { value: 300, max: 300, temp: 0 } }))
  actor.type = 'npc'
  equip(actor, { ac: 13 })
  const token = placeToken(arena, actor, { id: `${id}1`, name, actorLink: true })
  placeables.set(token.id, token.object)
  return { actor, token }
}
const goblin = foe('goblin', 'Goblin')
const orc = foe('orc', 'Orc')
if (MIDI) canvas.scene.tokens.size = placeables.size

// The fight, started at round 1 on Thorin; one elsewhere none of the campaign's are in; one beside it,
// on another scene, started on Thorin, which the campaign is told of while the Gamemaster has the
// fight up; and one not started.
const fight = combatOf('fight', [
  { id: 'cb-thorin', actor: thorin, fields: { initiative: 20 } },
  { id: 'cb-brakka', actor: brakka, fields: { initiative: 18 } },
  { id: 'cb-bat', token: bat1, fields: { initiative: 15 } },
  { id: 'cb-gob', actor: goblin.actor, token: goblin.token, fields: { initiative: 12 } },
  { id: 'cb-vex', actor: vex, fields: { initiative: 10 } },
  { id: 'cb-wolf', token: wolf1, fields: { initiative: 8 } },
])
Object.assign(fight, { round: 1, turn: 0 })
game.combat = fight
const elsewhere = combatOf('elsewhere', [
  { id: 'cb-e-gob', actor: goblin.actor, token: goblin.token, fields: { initiative: 14 } },
  { id: 'cb-e-orc', actor: orc.actor, token: orc.token, fields: { initiative: 9 } },
])
Object.assign(elsewhere, { round: 1, turn: 0 })
const beside = combatOf('beside', [
  { id: 'cb-b-thorin', actor: thorin, fields: { initiative: 15 } },
  { id: 'cb-b-vex', actor: vex, fields: { initiative: 5 } },
])
Object.assign(beside, { round: 1, turn: 0 })
beside._source.scene = 'den'
const waiting = combatOf('waiting', [{ id: 'cb-w-thorin', actor: thorin, fields: { initiative: 11 } }])
// What this client hears of turns moving, before each write.
const heard = { combatTurn: 0, combatRound: 0 }
Hooks.on('combatTurn', () => { heard.combatTurn++ })
Hooks.on('combatRound', () => { heard.combatRound++ })

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), wake: null, features: { commands: true, companions: 1 } }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    return json({ features: app.features })
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
  const end = realNow() + ms
  while (!test()) {
    if (realNow() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
const settle = () => wait(320)
let ids = 0
const results = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
const queue = (commands, campaign = 'camp-a') => {
  app.waiting.set(campaign, [...(app.waiting.get(campaign) ?? []), ...commands])
  app.wake?.()
}
async function send(command, campaign = 'camp-a') {
  queue([command], campaign)
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
/** Commands queued at once, their results awaited together. */
async function sendAll(commands, campaign = 'camp-a') {
  queue(commands, campaign)
  await until(() => commands.every(command => results(command.id).length), 'their results')
  return commands.map(command => results(command.id)[0])
}
/** Wait until the app has handed over everything it held for a campaign. */
const taken = (campaign = 'camp-a') => until(() => !app.waiting.get(campaign)?.length, 'the commands taken')
const plain = { mode: 0, explicit: false, extras: [] }
const NO_DICE = { ...plain, dice: [] }
/** The turn the app is shown: the combat, its round and its current combatant. */
const shown = (combat = fight) => ({ combatId: combat.id, round: combat.round, combatantId: combat.combatant?.id ?? null })
const endTurn = (turn, fields = {}) => ({ id: `turn-${++ids}`, actorId: 'thorin', kind: 'endTurn', turn, ...NO_DICE, ...fields })
const refusal = result => [result.status, result.reason, result.error]
const DONE = id => ({ id, status: 'done', reason: null, error: null, messageId: null, visible: true, rolls: [] })
/** The Gamemaster's own Next Turn to a combatant, made on another client. */
const turnTo = (combatantId, round = fight.round, combat = fight) => combat.setTurn(round, combat.turns.findIndex(cb => cb.id === combatantId))
const ofType = (from, type, campaign = 'camp-a') => app.events.slice(from).filter(e => (e.type === type) && (e.campaign?.id === campaign))
const helloOf = id => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === id)).at(-1)
const gmTargets = () => [...game.user.targets].map(t => t.id)

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'a-secret', 'camp-b': 'b-secret', 'camp-c': 'c-secret' })
settings.set('combatEvents', true)
settings.set('chatEvents', true)
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex'], rolls: true, attacks: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['pip'], rolls: true, attacks: false },
  { id: 'camp-c', title: 'Coldwater', characters: ['pip'], rolls: false, attacks: true },
])
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { rollFeatures, syncPollers } = await import(`${MODULE}/scripts/commands.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { runEndTurnCommand, runUndoTurnCommand } = await import(`${MODULE}/scripts/command-turn.mjs`)
const { companionList } = await import(`${MODULE}/scripts/creatures.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
await settle()
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
const ashlands = () => getCampaigns().find(c => c.id === 'camp-a')
assert.deepEqual(companionList(ashlands()).map(entry => [entry.key, entry.of]), [['brakka', ['thorin']], ['arena-bat1', ['thorin']], ['arena-wolf1', ['vex']]])

/* -------------------------------------------- */
/*  Offered                                     */
/* -------------------------------------------- */

{
  const kinds = id => helloOf(id).data.features.rolls.kinds
  const after = list => list[list.indexOf('endConcentration') + 1]
  assert.equal(after(kinds('camp-a')), 'endTurn', 'right after ending a concentration, attacks on')
  assert.ok(kinds('camp-a').includes('attack'))
  assert.equal(after(kinds('camp-b')), 'endTurn', 'and attacks off')
  assert.ok(!kinds('camp-b').includes('attack'))
  assert.deepEqual(kinds('camp-c'), [], 'none with rolls off')
  diceStatus.ready = false
  assert.ok(!rollFeatures(ashlands()).kinds.includes('endTurn'), 'none before the dice are ready')
  diceStatus.ready = true
  for (const id of ['camp-a', 'camp-b']) {
    assert.ok(!helloOf(id).data.features.companions.kinds.includes('endTurn'), `never a companion's in ${id}`)
  }
  ok("features.rolls.kinds has endTurn right after endConcentration wherever rolls are made, attacks on or off; none with rolls off or before the dice are ready; features.companions.kinds never has it")
}
{
  const kinds = id => helloOf(id).data.features.rolls.kinds
  for (const id of ['camp-a', 'camp-b']) {
    assert.equal(kinds(id)[kinds(id).indexOf('endTurn') + 1], 'undoEndTurn', `right after endTurn in ${id}`)
    const theirs = helloOf(id).data.features.companions.kinds
    assert.ok(!theirs.includes('endTurn') && !theirs.includes('undoEndTurn'), `neither a companion's in ${id}`)
  }
  assert.ok(!kinds('camp-c').includes('undoEndTurn'), 'none with rolls off')
  ok("features.rolls.kinds has undoEndTurn right after endTurn, attacks on or off; features.companions.kinds has neither")
}

/* -------------------------------------------- */
/*  Ends                                        */
/* -------------------------------------------- */

{
  const from = app.events.length
  const was = { ...heard, advances: fight.advances }
  const named = shown()
  assert.deepEqual(named, { combatId: 'fight', round: 1, combatantId: 'cb-thorin' })
  const sent = realNow()
  const made = await send(endTurn(named))
  const took = realNow() - sent
  assert.deepEqual(made, DONE(made.id))
  // No Midi use on its way, Midi-QOL or not: the wait ends at once, far short of its 1 s here.
  assert.ok(took < 200, `made at once, with nothing for the Midi wait to wait for (${took} ms)`)
  assert.deepEqual([heard.combatTurn - was.combatTurn, heard.combatRound - was.combatRound], [1, 0], 'combatTurn heard once on this client')
  assert.equal(fight.advances, was.advances + 1, 'one advance')
  assert.equal(fight.combatant.id, 'cb-brakka')
  const posted = app.events.slice(from).filter(e => e.campaign?.id === 'camp-a')
  const turnAt = posted.findIndex(e => (e.type === 'combat.turn') && (e.data.combatant?.id === 'cb-brakka'))
  const resultAt = posted.findIndex(e => (e.type === 'command.result') && (e.data.id === made.id))
  assert.ok((turnAt >= 0) && (turnAt < resultAt), `combat.turn posted before the result (${turnAt}, ${resultAt})`)
  assert.deepEqual([posted[turnAt].data.round, posted[turnAt].data.newRound, posted[turnAt].data.previousCombatantId], [1, false, 'cb-thorin'])
  ok("Thorin's turn, named as the app was shown it, ends by Next Turn: done at once, nothing on its way through Midi, one advance, combatTurn heard once, Brakka current; combat.turn with Brakka posted before the result")
}
{
  const made = await send(endTurn(shown()))
  assert.deepEqual(made, DONE(made.id))
  assert.equal(fight.combatant.id, 'cb-bat')
  const familiar = await send(endTurn(shown()))
  assert.deepEqual(familiar, DONE(familiar.id))
  assert.equal(fight.combatant.id, 'cb-gob')
  ok("Brakka's turn, by Thorin's endTurn, ends, the Bat current; the Bat's, a token's creature found by its token and scene, the Gamemaster's in Foundry, ends too")
}
{
  // Changed on purpose (round 0.40.0 §10.2): a shaped character's turn ends. Thorin transformed, as
  // dnd5e's Wild Shape makes him, a world actor of his own that names him its original, and the
  // combatant of its token the form's: his to end, as its character's.
  const form = add(new Actor5e({ id: 'thorinWolf000000', name: 'Thorin (Wolf)', owners: ['alice'], mods: { dex: 2 }, flags: { isPolymorphed: true, originalActor: 'thorin' } }))
  const shaped = combatOf('shaped', [
    { id: 'cb-s-form', actor: form, fields: { initiative: 15 } },
    { id: 'cb-s-gob', actor: goblin.actor, token: goblin.token, fields: { initiative: 9 } },
  ])
  Object.assign(shaped, { round: 1, turn: 0 })
  const made = await send(endTurn(shown(shaped)))
  assert.deepEqual(made, DONE(made.id))
  assert.deepEqual([shaped.advances, shaped.combatant.id], [1, 'cb-s-gob'], "the form's turn ended, the goblin current")
  game.combats.delete('shaped')
  actors.delete(form.id)
  ok("Thorin transformed, his form's combatant current: his End Turn ends its turn, a form's turn its character's")
}
{
  await turnTo('cb-thorin')
  fight.settings = { skipDefeated: true }
  for (const cb of fight.combatants.values()) if (cb.id !== 'cb-thorin') cb.isDefeated = true
  const from = app.events.length
  const was = { ...heard, round: fight.round }
  const made = await send(endTurn(shown()))
  for (const cb of fight.combatants.values()) cb.isDefeated = false
  delete fight.settings
  assert.deepEqual(made, DONE(made.id))
  assert.deepEqual([fight.round, fight.combatant.id], [was.round + 1, 'cb-thorin'], 'the next round, Thorin again')
  assert.deepEqual([heard.combatRound - was.combatRound, heard.combatTurn - was.combatTurn], [1, 0], 'combatRound heard')
  const [turn] = ofType(from, 'combat.turn')
  assert.deepEqual([turn.data.round, turn.data.newRound, turn.data.direction], [was.round + 1, true, 'forward'])
  ok("Thorin last in the round, the rest defeated and the tracker skipping them: the next round begins on him, combatRound heard, combat.turn newRound")
}

/* -------------------------------------------- */
/*  Moved                                       */
/* -------------------------------------------- */

{
  await turnTo('cb-thorin')
  const named = shown()
  await turnTo('cb-brakka')
  const was = fight.advances
  const late = await send(endTurn(named))
  assert.deepEqual(refusal(late), ['failed', 'moved', null], 'the Gamemaster moved on first')
  assert.deepEqual([fight.advances, fight.combatant.id], [was, 'cb-brakka'], 'nothing more moves')

  await turnTo('cb-thorin')
  const last = shown()
  await fight.setTurn(fight.round + 1, fight.turn)
  assert.equal(fight.combatant.id, 'cb-thorin')
  const stale = await send(endTurn(last))
  assert.deepEqual(refusal(stale), ['failed', 'moved', null], "Thorin again, a round later, with the last round's turn named")
  assert.equal(fight.advances, was)
  ok("a turn that moved on is refused moved, and nothing moves: the Gamemaster's Next Turn made first; the same combatant current a round later, the earlier round named")
}
{
  const named = shown()
  const was = fight.advances
  const [first, second] = await sendAll([endTurn(named), endTurn(named)])
  assert.deepEqual([first.status, refusal(second)], ['done', ['failed', 'moved', null]])
  assert.equal(fight.advances, was + 1, 'one advance')
  assert.equal(fight.combatant.id, 'cb-brakka', "Brakka's turn not skipped")
  ok("two endTurns for Thorin's turn at once, as a double press: one done, one moved, one advance, Brakka's turn not skipped")
}
{
  // Vex's wolf made Alice's too, by its token's delta: a companion of both, either player's to end.
  const wolfOf = () => companionList(ashlands()).find(entry => entry.key === 'arena-wolf1')?.of
  await changeDelta(wolf1, { ownership: { alice: 3 } })
  await settle()
  assert.deepEqual(wolfOf(), ['thorin', 'vex'], 'a companion of both')
  await turnTo('cb-wolf')
  const named = shown()
  const was = { ...heard, advances: fight.advances, round: fight.round }
  const [thorins, vexes] = await sendAll([endTurn(named), endTurn(named, { actorId: 'vex' })])
  assert.deepEqual([thorins.status, refusal(vexes)], ['done', ['failed', 'moved', null]], 'the later finds it ended')
  assert.equal(fight.advances, was.advances + 1, 'one advance')
  assert.deepEqual([heard.combatRound - was.combatRound, heard.combatTurn - was.combatTurn], [1, 0], 'combatRound heard once')
  assert.deepEqual([fight.round, fight.combatant.id], [was.round + 1, 'cb-thorin'], 'the next round, on Thorin')
  await changeDelta(wolf1, { ownership: { alice: 0 } })
  await settle()
  assert.deepEqual(wolfOf(), ['vex'], "Vex's alone again")
  ok("the wolf both players own, its turn ended by Thorin's and Vex's players at once: one done, one moved, one advance, combatRound heard once")
}
{
  await turnTo('cb-thorin')
  // An initiative written mid-round, as Right after its character writes them, sorts the goblin first:
  // Thorin is current still, at another index.
  await fight.updateEmbeddedDocuments('Combatant', [{ _id: 'cb-gob', initiative: 25 }])
  assert.deepEqual([fight.turn, fight.combatant.id], [1, 'cb-thorin'])
  const shifted = await send(endTurn(shown()))
  assert.deepEqual(shifted, DONE(shifted.id))
  assert.equal(fight.combatant.id, 'cb-brakka')
  await fight.updateEmbeddedDocuments('Combatant', [{ _id: 'cb-gob', initiative: 12 }])
  assert.equal(fight.combatant.id, 'cb-brakka')
  // The Gamemaster's Previous Turn back to Thorin, in the same round: his turn again, to end again.
  await turnTo('cb-thorin')
  const rewound = await send(endTurn(shown()))
  assert.deepEqual(rewound, DONE(rewound.id))
  assert.equal(fight.combatant.id, 'cb-brakka')
  ok("Thorin's index shifted by an initiative written mid-round, he still current: done; a rewind to Thorin in the same round: done again")
}
{
  await turnTo('cb-thorin')
  const thorinCb = fight.combatants.get('cb-thorin')
  thorinCb.hidden = true
  const was = fight.advances
  const answers = []
  for (const gmContent of [false, true]) {
    settings.set('gmContent', gmContent)
    answers.push(refusal(await send(endTurn({ combatId: 'fight', round: fight.round, combatantId: 'cb-thorin' }))))
  }
  settings.set('gmContent', false)
  thorinCb.hidden = false
  assert.deepEqual(answers, [['failed', 'moved', null], ['failed', 'moved', null]])
  assert.deepEqual([fight.advances, fight.combatant.id], [was, 'cb-thorin'])
  ok('the current combatant hidden: moved, with Gamemaster-only information off and on, as the app is never shown a hidden one as current')
}

/* -------------------------------------------- */
/*  Not the seat's                              */
/* -------------------------------------------- */

{
  const was = fight.advances
  const answers = []
  for (const id of ['cb-gob', 'cb-vex', 'cb-wolf']) {
    await turnTo(id)
    answers.push([id, refusal(await send(endTurn(shown())))])
  }
  assert.deepEqual(answers, ['cb-gob', 'cb-vex', 'cb-wolf'].map(id => [id, ['failed', 'not-turn', null]]))
  assert.equal(fight.advances, was)
  // Vex's player ends his wolf's turn, as its token's delta makes it his.
  const vexes = await send(endTurn(shown(), { actorId: 'vex' }))
  assert.deepEqual(vexes, DONE(vexes.id))
  ok("Thorin's player can't end the goblin's turn, Vex's, or Vex's wolf's: not-turn, nothing moves; Vex's player ends his wolf's")
}
{
  await turnTo('cb-bat')
  const from = app.events.length
  await bat1.update({ hidden: true })
  await wait(10)
  const was = fight.advances
  const hidden = await send(endTurn(shown()))
  assert.deepEqual(refusal(hidden), ['failed', 'not-turn', null])
  assert.equal(fight.advances, was)
  const listed = ofType(from, 'companions.listed')
  const resultAt = app.events.findIndex(e => (e.type === 'command.result') && (e.data.id === hidden.id))
  assert.ok(!listed.length || (app.events.indexOf(listed[0]) > resultAt), 'before the list told the app of it')
  await bat1.update({ hidden: false })
  await settle()
  ok("the Bat's turn with its token hidden 10 ms before, before the list told the app: not-turn, by the rule now")
}

/* -------------------------------------------- */
/*  The combat named: started, the campaign's   */
/* -------------------------------------------- */

{
  const was = fight.advances
  const made = await send(endTurn(shown(beside)))
  assert.deepEqual(made, DONE(made.id))
  assert.deepEqual([beside.advances, beside.combatant.id, fight.advances], [1, 'cb-b-vex', was], 'the combat named, not the one the Gamemaster has up')
  ok("the combat beside the one the Gamemaster has up, on another scene, named: it advances, and the fight doesn't")
}
{
  const unstarted = await send(endTurn({ combatId: 'waiting', round: 1, combatantId: 'cb-w-thorin' }))
  assert.deepEqual(refusal(unstarted), ['failed', 'not-started', null])
  assert.deepEqual([waiting.advances, waiting.round, waiting.started], [0, 0, false], 'Next Turn never called: no round 1 by the back door')
  const notOurs = await send(endTurn(shown(elsewhere)))
  assert.deepEqual(refusal(notOurs), ['failed', 'not-in-combat', null])
  assert.equal(elsewhere.advances, 0)
  const nowhere = await send(endTurn({ combatId: 'nowhere', round: 1, combatantId: 'cb-thorin' }))
  assert.deepEqual(refusal(nowhere), ['failed', 'not-in-combat', null])
  await turnTo('cb-thorin')
  const was = fight.advances
  settings.set('combatEvents', false)
  const off = await send(endTurn(shown()))
  settings.set('combatEvents', true)
  assert.deepEqual(refusal(off), ['failed', 'not-in-combat', null], 'combat events off')
  assert.equal(fight.advances, was)
  ok('an unstarted combat: not-started, Next Turn never called; a combat none of the campaign are in, no such combat, and combat events off: not-in-combat; nothing moves')
}
{
  const was = fight.advances
  diceStatus.ready = false
  const notReady = await send(endTurn(shown()))
  diceStatus.ready = true
  // The fetching stopped with the dice not ready, as it does; it starts again as they are.
  syncPollers()
  assert.deepEqual(refusal(notReady), ['failed', 'off', null])
  const direct = await runEndTurnCommand(endTurn(shown()), { ...ashlands(), rolls: false })
  assert.deepEqual([direct.status, direct.reason], ['failed', 'off'])
  assert.equal(fight.advances, was)
  ok("rolls off, or the dice not ready: off, nothing moves")
}

/* -------------------------------------------- */
/*  Malformed                                   */
/* -------------------------------------------- */

{
  const named = shown()
  const was = fight.advances
  const answers = []
  for (const [fields, why] of [
    [{ actorId: 'brakka', of: 'thorin' }, 'of'],
    [{ by: 'gm' }, 'by'],
    [{ item: 'longsword' }, 'turn'],
    [{ combatId: 'fight' }, 'turn'],
    [{ dice: [{ faces: 20, results: [10] }] }, 'dice'],
    [{ mode: 1 }, 'dice'],
    [{ turn: { ...named, round: 0 } }, 'turn'],
    [{ turn: { combatId: named.combatId, round: named.round } }, 'turn'],
    [{ turn: { ...named, turn: 0 } }, 'turn'],
    [{ turn: [named.combatId, named.round, named.combatantId] }, 'turn'],
  ]) answers.push([JSON.stringify(fields), refusal(await send(endTurn(named, fields))), ['failed', 'invalid', why]])
  for (const [what, got, want] of answers) assert.deepEqual(got, want, what)
  const stranger = await send(endTurn(named, { actorId: 'pip' }))
  assert.deepEqual(refusal(stranger), ['failed', 'unknown', null], "another campaign's character")
  assert.equal(fight.advances, was)
  ok("refused invalid: with of, as a companion's turn is its character's to end; the Gamemaster's (by); naming an item or a combat beside the turn (turn); with dice (dice); a round of 0, no combatant, an extra key, a list (turn); another campaign's character, unknown; nothing moves")
}

/* -------------------------------------------- */
/*  The queue                                   */
/* -------------------------------------------- */

{
  await turnTo('cb-thorin')
  const realRollAttack = AttackActivity.prototype.rollAttack
  AttackActivity.prototype.rollAttack = async function (...args) {
    if (this.actor?.id === 'thorin') await wait(200)
    return realRollAttack.apply(this, args)
  }
  const swing = {
    id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'longsword', activity: 'ls-swing', target: { combatId: 'fight', combatantId: 'cb-gob' },
    ...plain, dice: [{ faces: 20, results: [15] }],
  }
  const from = app.events.length
  const [swung, ended] = await sendAll([swing, endTurn(shown())])
  AttackActivity.prototype.rollAttack = realRollAttack
  assert.deepEqual([swung.status, ended.status], ['done', 'done'], JSON.stringify(swung))
  const at = type => app.events.findIndex((e, index) => (index >= from) && type(e))
  assert.ok(at(e => (e.type === 'command.result') && (e.data.id === swing.id)) < at(e => e.type === 'combat.turn'), "the attack's result, then the turn")

  await turnTo('cb-thorin')
  const realRollSkill = Actor5e.prototype.rollSkill
  Actor5e.prototype.rollSkill = async function (...args) {
    if (this.id === 'bat') await wait(150)
    return realRollSkill.apply(this, args)
  }
  const perceive = { id: `skill-${++ids}`, actorId: 'arena-bat1', of: 'thorin', kind: 'skill', key: 'prc', ...plain, dice: [{ faces: 20, results: [11] }] }
  const next = app.events.length
  const [perceived, endedAgain] = await sendAll([perceive, endTurn(shown())])
  Actor5e.prototype.rollSkill = realRollSkill
  assert.deepEqual([perceived.status, endedAgain.status], ['done', 'done'], JSON.stringify(perceived))
  const atNext = type => app.events.findIndex((e, index) => (index >= next) && type(e))
  assert.ok(atNext(e => (e.type === 'command.result') && (e.data.id === perceive.id)) < atNext(e => e.type === 'combat.turn'), "the Bat's skill's result, then the turn")
  ok("an endTurn waits for the character's earlier commands: Thorin's attack, 200 ms slow, made and answered before the turn ends; the Bat's skill (of: thorin) the same")
}

/* -------------------------------------------- */
/*  Cancelled                                   */
/* -------------------------------------------- */

{
  await turnTo('cb-thorin')
  const was = fight.advances
  fight.refuseNext = true
  const kept = await send(endTurn(shown()))
  assert.deepEqual(refusal(kept), ['failed', 'cancelled', null])
  assert.deepEqual([fight.advances, fight.combatant.id], [was, 'cb-thorin'])
  ok('a turn a module keeps from moving: cancelled, no advance')
}

/* -------------------------------------------- */
/*  Undo: taken back                            */
/* -------------------------------------------- */

/** A taking back of the End Turn given, the turn named as the app shows it. */
const undoTurn = (ended, turn, fields = {}) => ({ id: `undo-${++ids}`, actorId: 'thorin', kind: 'undoEndTurn', undo: ended.id, turn, ...NO_DICE, ...fields })
/** Thorin's End Turn, made on his turn in the round as it stands: done, Brakka's turn next. */
async function endThorins() {
  await turnTo('cb-thorin')
  const ended = await send(endTurn(shown()))
  assert.deepEqual(ended, DONE(ended.id))
  assert.equal(fight.combatant.id, 'cb-brakka')
  return ended
}
/** The writes of the fight's round and turn the module made, by update. */
const written = () => fight.updates.length

{
  // The fight back at round 1, on Thorin.
  await fight.setTurn(1, 0)
  assert.equal(fight.combatant.id, 'cb-thorin')
  const ended = await endThorins()
  assert.equal(fight.round, 1)
  const from = app.events.length
  const was = { ...heard, advances: fight.advances, turnEvents: fight.turnEvents, updates: written() }
  const back = await send(undoTurn(ended, shown()))
  assert.deepEqual(back, DONE(back.id))
  assert.deepEqual([fight.round, fight.combatant.id], [1, 'cb-thorin'], 'Thorin current, round 1')
  assert.deepEqual(fight.updates.slice(was.updates), [
    { data: { round: 1, turn: 0 }, options: { direction: -1, turnEvents: false, worldTime: { delta: 0 } } },
  ], "one update, back to Thorin's index, with the turn events off")
  assert.equal(fight.advances, was.advances, 'no advance')
  assert.deepEqual([heard.combatTurn - was.combatTurn, heard.combatRound - was.combatRound], [0, 0], 'neither combatTurn nor combatRound heard')
  assert.equal(fight.turnEvents, was.turnEvents, "core's turn events not run")
  const posted = app.events.slice(from).filter(e => e.campaign?.id === 'camp-a')
  const turns = posted.filter(e => e.type === 'combat.turn')
  assert.equal(turns.length, 1, 'combat.turn posted once')
  const [turn] = turns
  assert.deepEqual([turn.data.combatant?.id, turn.data.round, turn.data.newRound, turn.data.direction, turn.data.previousCombatantId], ['cb-thorin', 1, false, 'backward', 'cb-brakka'])
  const resultAt = posted.findIndex(e => (e.type === 'command.result') && (e.data.id === back.id))
  assert.ok(posted.indexOf(turn) < resultAt, `combat.turn posted before the result (${posted.indexOf(turn)}, ${resultAt})`)
  ok("Thorin's End Turn taken back: done; Thorin current in round 1 again by one update to his index, direction -1, turnEvents false, no world time; no advance, neither combatTurn nor combatRound heard, no turn events run; combat.turn with Thorin, backward, posted once before the result")
}
{
  fight.settings = { skipDefeated: true }
  for (const cb of fight.combatants.values()) if (cb.id !== 'cb-thorin') cb.isDefeated = true
  const ended = await send(endTurn(shown()))
  assert.deepEqual(ended, DONE(ended.id))
  assert.deepEqual([fight.round, fight.combatant.id], [2, 'cb-thorin'], 'Thorin last in round 1: round 2 begins on him')
  const from = app.events.length
  const was = written()
  const back = await send(undoTurn(ended, shown()))
  for (const cb of fight.combatants.values()) cb.isDefeated = false
  delete fight.settings
  assert.deepEqual(back, DONE(back.id))
  assert.deepEqual([fight.round, fight.combatant.id], [1, 'cb-thorin'], 'back in round 1, on Thorin')
  assert.deepEqual(fight.updates.slice(was).map(({ data, options }) => [data, options.worldTime]), [[{ round: 1, turn: 0 }, { delta: -6 }]], "the round's 6 seconds of world time back")
  const [turn] = ofType(from, 'combat.turn')
  assert.deepEqual([turn.data.round, turn.data.newRound, turn.data.direction], [1, false, 'backward'])
  ok("an End Turn that began round 2 taken back: round 1 on Thorin again, world time 6 s back, combat.turn backward and no new round")
}
{
  await turnTo('cb-thorin')
  // The goblin, defeated, between Thorin and Brakka, and the tracker skipping the defeated.
  await fight.updateEmbeddedDocuments('Combatant', [{ _id: 'cb-gob', initiative: 19 }])
  fight.combatants.get('cb-gob').isDefeated = true
  fight.settings = { skipDefeated: true }
  assert.deepEqual(fight.turns.slice(0, 3).map(cb => cb.id), ['cb-thorin', 'cb-gob', 'cb-brakka'])
  const ended = await send(endTurn(shown()))
  assert.equal(fight.combatant.id, 'cb-brakka', 'End Turn skips the goblin')
  const back = await send(undoTurn(ended, shown()))
  fight.combatants.get('cb-gob').isDefeated = false
  delete fight.settings
  assert.deepEqual(back, DONE(back.id))
  assert.equal(fight.combatant.id, 'cb-thorin', 'Thorin, not the goblin')
  await fight.updateEmbeddedDocuments('Combatant', [{ _id: 'cb-gob', initiative: 12 }])
  assert.equal(fight.combatant.id, 'cb-thorin')

  const again = await endThorins()
  // Thorin's initiative written after it, as Right after its character writes them: Brakka still
  // current, and Thorin after her now.
  await fight.updateEmbeddedDocuments('Combatant', [{ _id: 'cb-thorin', initiative: 17 }])
  assert.deepEqual([fight.turns[0].id, fight.turns[1].id, fight.combatant.id], ['cb-brakka', 'cb-thorin', 'cb-brakka'])
  const from = app.events.length
  const moved = await send(undoTurn(again, shown()))
  assert.deepEqual(moved, DONE(moved.id))
  assert.deepEqual([fight.turn, fight.combatant.id], [1, 'cb-thorin'], 'Thorin at his new index')
  const [turn] = ofType(from, 'combat.turn')
  assert.equal(turn.data.direction, 'forward', 'forward, as his index is after the one the End Turn left')
  await fight.updateEmbeddedDocuments('Combatant', [{ _id: 'cb-thorin', initiative: 20 }])
  assert.deepEqual([fight.turn, fight.combatant.id], [0, 'cb-thorin'])
  ok("taken back to the combatant by its id: past a defeated goblin End Turn skipped, Thorin's turn, not the goblin's; after an initiative written that moved Thorin's index, Thorin at his new index")
}

/* -------------------------------------------- */
/*  Undo: refused                               */
/* -------------------------------------------- */

{
  const ended = await endThorins()
  const left = shown()
  const was = written()
  // The Gamemaster's Next Turn first, the app still showing Brakka's turn.
  await turnTo('cb-bat')
  const past = await send(undoTurn(ended, left))
  assert.deepEqual(refusal(past), ['failed', 'moved', null], 'the Bat current')
  // Then their Previous Turns back to Thorin: the combat named as it now stands.
  await turnTo('cb-thorin')
  const rewound = await send(undoTurn(ended, shown()))
  assert.deepEqual(refusal(rewound), ['failed', 'moved', null], 'not where that End Turn left it')
  await turnTo('cb-brakka')
  const otherRound = await send(undoTurn(ended, { ...left, round: left.round + 1 }))
  assert.deepEqual(refusal(otherRound), ['failed', 'moved', null], 'another round named')
  const brakkaCb = fight.combatants.get('cb-brakka')
  brakkaCb.hidden = true
  const hidden = []
  for (const gmContent of [false, true]) {
    settings.set('gmContent', gmContent)
    hidden.push(refusal(await send(undoTurn(ended, left))))
  }
  settings.set('gmContent', false)
  brakkaCb.hidden = false
  assert.deepEqual(hidden, [['failed', 'moved', null], ['failed', 'moved', null]], 'Brakka current but hidden, with Gamemaster-only information off and on')
  assert.deepEqual([written(), fight.combatant.id], [was, 'cb-brakka'], 'nothing written')
  // The combat where that End Turn left it again, it's taken back.
  const back = await send(undoTurn(ended, left))
  assert.deepEqual(back, DONE(back.id))
  assert.deepEqual([written(), fight.combatant.id], [was + 1, 'cb-thorin'])
  ok("Undo refused moved, nothing written: the Gamemaster moved on first; a rewind back to Thorin, named as the combat now stands; another round named; Brakka current but hidden, Gamemaster-only information off and on; then, where the End Turn left it, taken back")
}
{
  // A whole round on and back to Brakka within the minute, so only the round tells it apart: named
  // as the app was shown it, the live combat's round is another; named as it now stands, it's not
  // the round that End Turn left. Either check alone refuses one of the two, never both.
  const ended = await endThorins()
  const left = shown()
  const was = written()
  await turnTo('cb-brakka', left.round + 1)
  const stale = await send(undoTurn(ended, left))
  const now = await send(undoTurn(ended, shown()))
  assert.deepEqual([refusal(stale), refusal(now)], [['failed', 'moved', null], ['failed', 'moved', null]], 'a round on')
  assert.deepEqual([written(), fight.combatant.id], [was, 'cb-brakka'], 'nothing written')
  // Back in the round that End Turn left, it's taken back.
  await turnTo('cb-brakka', left.round)
  const back = await send(undoTurn(ended, left))
  assert.deepEqual(back, DONE(back.id))
  assert.deepEqual([written(), fight.round, fight.combatant.id], [was + 1, left.round, 'cb-thorin'])
  ok("Undo refused moved a whole round on, on Brakka again, named as the app was shown it or as the combat now stands, nothing written; then, back in the round that End Turn left, taken back")
}
{
  const ended = await endThorins()
  const back = await send(undoTurn(ended, shown()))
  assert.deepEqual(back, DONE(back.id))
  const was = written()
  const again = await send(undoTurn(ended, shown()))
  assert.deepEqual(refusal(again), ['failed', 'not-undoable', null], 'taken back already')

  const thorins = await endThorins()
  const vexes = await send(undoTurn(thorins, shown(), { actorId: 'vex' }))
  assert.deepEqual(refusal(vexes), ['failed', 'not-undoable', null], "Vex's command, naming Thorin's End Turn")
  // Vex's wolf made Alice's too, and its turn ended by Thorin's player: Vex's player may end its
  // turn, but not take back Thorin's End Turn of it.
  await changeDelta(wolf1, { ownership: { alice: 3 } })
  await settle()
  await turnTo('cb-wolf')
  const wolfs = await send(endTurn(shown()))
  assert.deepEqual(wolfs, DONE(wolfs.id))
  const shared = await send(undoTurn(wolfs, shown(), { actorId: 'vex' }))
  assert.deepEqual(refusal(shared), ['failed', 'not-undoable', null], "Vex's command, naming Thorin's End Turn of the wolf they share")
  const own = await send(undoTurn(wolfs, shown()))
  assert.deepEqual(own, DONE(own.id))
  assert.equal(fight.combatant.id, 'cb-wolf')
  await changeDelta(wolf1, { ownership: { alice: 0 } })
  await settle()

  const none = await send(undoTurn({ id: 'turn-never' }, shown()))
  assert.deepEqual(refusal(none), ['failed', 'not-undoable', null], 'an End Turn there never was')
  assert.equal(written(), was + 1, "nothing written but Thorin's own taking back")
  ok("Undo refused not-undoable, nothing written: a second after the first was done; Vex's command naming Thorin's End Turn, of Thorin's turn or of the wolf they share, which Thorin's own takes back; an End Turn there never was")
}
{
  const first = await endThorins()
  // Thorin's player ends Brakka's turn too: the later End Turn is the one remembered.
  const second = await send(endTurn(shown()))
  assert.deepEqual(second, DONE(second.id))
  assert.equal(fight.combatant.id, 'cb-bat')
  const was = written()
  const firsts = await send(undoTurn(first, shown()))
  assert.deepEqual(refusal(firsts), ['failed', 'not-undoable', null], 'the first, replaced')
  assert.equal(written(), was)
  const seconds = await send(undoTurn(second, shown()))
  assert.deepEqual(seconds, DONE(seconds.id))
  assert.equal(fight.combatant.id, 'cb-brakka', "Brakka's turn back")

  const late = await endThorins()
  clock += 61_000
  const after = await send(undoTurn(late, shown()))
  assert.deepEqual(refusal(after), ['failed', 'not-undoable', null], 'a minute on')
  assert.deepEqual([written(), fight.combatant.id], [was + 1, 'cb-brakka'])
  ok("Undo refused not-undoable: the first of two End Turns of the combat, the later remembered in its place, which is taken back, Brakka current; one more than a minute old")
}
{
  const gone = []
  for (const how of ['deleted', 'hidden']) {
    const ended = await endThorins()
    const thorinCb = fight.combatants.get('cb-thorin')
    const current = fight.combatant
    if (how === 'deleted') {
      fight.combatants.delete('cb-thorin')
      // As core keeps the current combatant current.
      fight.turn = fight.turns.indexOf(current)
    } else thorinCb.hidden = true
    const was = written()
    gone.push([how, refusal(await send(undoTurn(ended, shown()))), written() - was])
    if (how === 'deleted') {
      fight.combatants.set('cb-thorin', thorinCb)
      fight.turn = fight.turns.indexOf(current)
    } else thorinCb.hidden = false
    assert.equal(fight.combatant.id, 'cb-brakka')
  }
  assert.deepEqual(gone, [['deleted', ['failed', 'not-undoable', null], 0], ['hidden', ['failed', 'not-undoable', null], 0]])
  ok("Undo refused not-undoable, nothing written, with Thorin's combatant deleted from the combat, or hidden, after his End Turn")
}
{
  await endThorins()
  // Brakka's turn, by Thorin's command; then Alice's Owner taken from Brakka.
  const brakkas = await send(endTurn(shown()))
  assert.deepEqual(brakkas, DONE(brakkas.id))
  assert.equal(fight.combatant.id, 'cb-bat')
  await changeActor(brakka, { ownership: { alice: 0 } })
  await settle()
  const was = written()
  const theirs = await send(undoTurn(brakkas, shown()))
  await changeActor(brakka, { ownership: { alice: 3 } })
  await settle()
  assert.deepEqual(refusal(theirs), ['failed', 'not-turn', null])
  assert.deepEqual([written(), fight.combatant.id], [was, 'cb-bat'], 'nothing written')
  ok("Undo of Brakka's turn, ended by Thorin's command, refused not-turn once Alice's Owner is taken from Brakka, nothing written")
}
{
  const ended = await endThorins()
  const named = shown()
  const was = { updates: written(), advances: fight.advances }
  const answers = []
  for (const [fields, why] of [
    [{ actorId: 'brakka', of: 'thorin' }, 'of'],
    [{ by: 'gm' }, 'by'],
    [{ undo: undefined }, 'undo'],
    [{ undo: 12 }, 'undo'],
    [{ undo: 'u'.repeat(65) }, 'undo'],
    [{ undo: 'turn 1' }, 'undo'],
    [{ turn: { combatId: named.combatId, round: named.round } }, 'turn'],
    [{ turn: { ...named, turn: 1 } }, 'turn'],
    [{ turn: { ...named, round: 0 } }, 'turn'],
    [{ item: 'longsword' }, 'turn'],
    [{ combatId: 'fight' }, 'turn'],
    [{ dice: [{ faces: 20, results: [10] }] }, 'dice'],
    [{ mode: 1 }, 'dice'],
  ]) answers.push([JSON.stringify(fields), refusal(await send(undoTurn(ended, named, fields))), ['failed', 'invalid', why]])
  for (const [what, got, want] of answers) assert.deepEqual(got, want, what)
  // An End Turn naming one to take back is no End Turn either.
  const both = await send(endTurn(named, { undo: ended.id }))
  assert.deepEqual(refusal(both), ['failed', 'invalid', 'turn'], 'an endTurn with undo')
  const stranger = await send(undoTurn(ended, named, { actorId: 'pip' }))
  assert.deepEqual(refusal(stranger), ['failed', 'unknown', null], "another campaign's character")
  assert.deepEqual([written(), fight.advances, fight.combatant.id], [was.updates, was.advances, 'cb-brakka'], 'nothing written, nothing ended')
  const back = await send(undoTurn(ended, named))
  assert.deepEqual(back, DONE(back.id))
  ok("Undo refused invalid: with of; the Gamemaster's (by); no undo, a number, 65 characters, not an id (undo); a turn without its combatant, with an extra key, of round 0, or an item or combat beside it (turn); with dice (dice); an endTurn naming undo (turn); another campaign's character, unknown; nothing written, and the End Turn still taken back")
}
{
  const ended = await endThorins()
  const was = written()
  settings.set('combatEvents', false)
  const off = await send(undoTurn(ended, shown()))
  settings.set('combatEvents', true)
  const nowhere = await send(undoTurn(ended, { ...shown(), combatId: 'nowhere' }))
  const notOurs = await send(undoTurn(ended, shown(elsewhere)))
  assert.deepEqual([off, nowhere, notOurs].map(refusal), [0, 1, 2].map(() => ['failed', 'not-in-combat', null]), 'combat events off; no such combat; one none of the campaign are in')
  const rollsOff = await runUndoTurnCommand(undoTurn(ended, shown()), { ...ashlands(), rolls: false })
  diceStatus.ready = false
  const notReady = await runUndoTurnCommand(undoTurn(ended, shown()), ashlands())
  diceStatus.ready = true
  assert.deepEqual([rollsOff, notReady].map(refusal), [['failed', 'off', null], ['failed', 'off', null]], 'rolls off, or the dice not ready')
  // The combat beside, ended by Vex's player, then reset in Foundry before its taking back.
  const vexes = await send(endTurn(shown(beside), { actorId: 'vex' }))
  assert.deepEqual(vexes, DONE(vexes.id))
  const left = shown(beside)
  Object.assign(beside, { round: 0, turn: null })
  const reset = await send(undoTurn(vexes, left, { actorId: 'vex' }))
  Object.assign(beside, { round: left.round, turn: beside.turns.findIndex(cb => cb.id === left.combatantId) })
  assert.deepEqual(refusal(reset), ['failed', 'not-started', null], 'the combat reset')
  assert.deepEqual([written(), beside.updates.length, fight.combatant.id], [was, 0, 'cb-brakka'], 'nothing written')
  const back = await send(undoTurn(ended, shown()))
  assert.deepEqual(back, DONE(back.id))
  ok("Undo refused, nothing written: not-in-combat with combat events off, no such combat or one none of the campaign are in; off with rolls off or the dice not ready; not-started for a combat reset since its End Turn")
}
{
  const ended = await endThorins()
  fight.refuseNext = true
  const kept = await send(undoTurn(ended, shown()))
  assert.deepEqual(refusal(kept), ['failed', 'cancelled', null], 'a module kept the turn from moving back')
  assert.equal(fight.combatant.id, 'cb-brakka')
  const back = await send(undoTurn(ended, shown()))
  assert.deepEqual(back, DONE(back.id), 'the End Turn still remembered')
  assert.equal(fight.combatant.id, 'cb-thorin')
  ok('an Undo a module keeps from writing: cancelled, the End Turn still remembered and taken back after')
}

/* -------------------------------------------- */
/*  Undo: told once; the queue                  */
/* -------------------------------------------- */

{
  const ended = await endThorins()
  faults.turnEventsNotify = true
  const from = app.events.length
  const back = await send(undoTurn(ended, shown()))
  faults.turnEventsNotify = false
  assert.deepEqual(back, DONE(back.id))
  assert.equal(fight.combatant.id, 'cb-thorin')
  const turns = ofType(from, 'combat.turn')
  assert.deepEqual(turns.map(e => [e.data.combatant?.id, e.data.direction]), [['cb-thorin', 'backward']], 'combat.turn posted once, not twice')
  ok("under a core that fires combatTurnChange with the turn events off: combat.turn posted once, by core's hook, not again by the module")
}
{
  await turnTo('cb-thorin')
  const ending = endTurn(shown())
  const was = { advances: fight.advances, updates: written(), turnEvents: fight.turnEvents }
  const from = app.events.length
  const [ended, back] = await sendAll([ending, undoTurn(ending, { ...shown(), combatantId: 'cb-brakka' })])
  assert.deepEqual([ended, back], [DONE(ending.id), DONE(back.id)])
  assert.deepEqual([fight.advances - was.advances, written() - was.updates, fight.turnEvents - was.turnEvents, fight.combatant.id], [1, 1, 1, 'cb-thorin'], 'one advance, one step back')
  const at = id => app.events.findIndex((e, index) => (index >= from) && (e.type === 'command.result') && (e.data.id === id))
  assert.ok(at(ending.id) < at(back.id), "the End Turn's result, then the Undo's")
  ok("an End Turn and its Undo sent at once: the End Turn's done, then the Undo's; one advance, one step back, Thorin current")
}
{
  // Vex's wolf made Alice's too. Thorin's player ends the Bat's turn, the goblin and Vex defeated
  // and skipped: the wolf's turn, which either player may end.
  await changeDelta(wolf1, { ownership: { alice: 3 } })
  await settle()
  await turnTo('cb-bat')
  fight.settings = { skipDefeated: true }
  for (const id of ['cb-gob', 'cb-vex']) fight.combatants.get(id).isDefeated = true
  const bats = await send(endTurn(shown()))
  for (const id of ['cb-gob', 'cb-vex']) fight.combatants.get(id).isDefeated = false
  delete fight.settings
  assert.deepEqual(bats, DONE(bats.id))
  assert.equal(fight.combatant.id, 'cb-wolf')
  const was = { advances: fight.advances, updates: written(), round: fight.round }
  // Vex's player ends the wolf's turn as Thorin's takes back the Bat's: one after the other, by the
  // combat's own queue, though they're two characters' commands.
  const [vexes, back] = await sendAll([endTurn(shown(), { actorId: 'vex' }), undoTurn(bats, shown())])
  await changeDelta(wolf1, { ownership: { alice: 0 } })
  await settle()
  assert.deepEqual([vexes, refusal(back)], [DONE(vexes.id), ['failed', 'not-undoable', null]], "the Undo after Vex's End Turn, which replaced the one it names")
  assert.deepEqual([fight.advances - was.advances, written() - was.updates, fight.round, fight.combatant.id], [1, 0, was.round + 1, 'cb-thorin'], 'one advance, nothing written')
  ok("Vex's End Turn of the wolf they share and Thorin's Undo of the Bat's turn that left it current, sent at once: the combat's End Turns and Undos one at a time, whoever's; Vex's done, then the Undo not-undoable, nothing written")
}

/* -------------------------------------------- */
/*  Midi-QOL                                    */
/* -------------------------------------------- */

if (MIDI) {
  midi.autoRemoveTargets = 'allGM'
  midi.settings.confirmAttackDamage = 'onlyGM'
  const workflowOf = id => midi.made.find(w => w.workflowOptions.sendingStone === id)
  const diceFor = preview => preview.rolls.flatMap(roll => roll.dice).map(({ faces, number }) => ({ faces, results: Array.from({ length: number }, () => 3) }))
  // Vex's Fireball at the goblin, its damage rolled into Midi's workflow and waiting for the
  // Gamemaster to confirm it, the area's targets theirs meanwhile. Each case sets the turn first:
  // a change of turn releases the Gamemaster's targets.
  const held = async () => {
    const cast = await send({ id: `use-${++ids}`, actorId: 'vex', kind: 'use', item: 'fireball', activity: 'blast', targets: [{ combatId: 'fight', combatantId: 'cb-gob' }], slot: null })
    assert.equal(cast.status, 'done', JSON.stringify(cast))
    const flow = workflowOf(cast.id)
    game.user.targets = new Set([placeables.get('orc1')])
    const damage = { id: `dmg-${++ids}`, actorId: 'vex', kind: 'damage', use: cast.id, dice: diceFor(cast.damage) }
    queue([damage])
    await until(() => flow.suspended && (flow.currentAction === flow.WorkflowState_ConfirmRoll), 'the damage waiting for the Gamemaster')
    assert.deepEqual(gmTargets(), ['goblin1'], "the area's targets the Gamemaster's")
    return { flow, damage }
  }
  {
    await turnTo('cb-thorin')
    const { flow, damage } = await held()
    const was = fight.advances
    const ending = endTurn(shown())
    queue([ending])
    await taken()
    await wait(25)
    assert.deepEqual([fight.advances, results(ending.id).length], [was, 0], 'not made while the area holds the targets')
    assert.deepEqual(gmTargets(), ['goblin1'], 'the targets the area\'s still')
    const confirmed = realNow()
    await flow.confirmDamage()
    await until(() => results(ending.id).length, 'the end of the turn')
    const after = realNow() - confirmed
    assert.deepEqual(results(ending.id)[0], DONE(ending.id))
    // As Midi's queue settles, within pastTargeting's next 100 ms poll, never at the wait's 1 s here.
    assert.ok(after < 300, `made once the damage is done, not when the wait runs out (${after} ms)`)
    assert.deepEqual([...flow.targets].map(t => t.id), ['goblin1'], "the area's damage at its own targets")
    assert.equal(results(damage.id)[0]?.status, 'done', 'the damage made first')
    assert.equal(fight.advances, was + 1)
    assert.deepEqual(gmTargets(), [], 'then the turn changes, and Midi releases the Gamemaster\'s targets')
    ok("under Midi-QOL, an area damage of Vex's holding the Gamemaster's targets, then Thorin's endTurn: made once the damage is done, the targets the area's until then")
  }
  {
    await turnTo('cb-thorin')
    const { flow, damage } = await held()
    const ending = endTurn(shown())
    const sent = realNow()
    queue([ending])
    await until(() => results(ending.id).length, 'the end of the turn')
    const took = realNow() - sent
    assert.deepEqual(results(ending.id)[0], DONE(ending.id))
    assert.ok((took >= 900) && (took < 1500), `made at TURN_MIDI_WAIT, 1 s here (${took} ms)`)
    assert.ok(flow.suspended && (flow.currentAction === flow.WorkflowState_ConfirmRoll), 'the area still waiting')
    assert.deepEqual(gmTargets(), [], 'released, as the Gamemaster\'s own Next Turn would')
    // The minute the area may hold the targets passes.
    clock += 61_000
    await until(() => results(damage.id).length, 'the damage, past its minute')
    await flow.confirmDamage()
    ok("one held past TURN_MIDI_WAIT: the turn ends at 10 s all the same (1 s here), the area still waiting for the Gamemaster")
  }
  {
    await turnTo('cb-thorin')
    const { flow } = await held()
    const ending = endTurn(shown())
    queue([ending])
    await taken()
    await wait(25)
    await turnTo('cb-brakka')
    const was = fight.advances
    await flow.confirmDamage()
    await until(() => results(ending.id).length, 'the end of the turn')
    assert.deepEqual(refusal(results(ending.id)[0]), ['failed', 'moved', null], 'the checks made after the wait')
    assert.deepEqual([fight.advances, fight.combatant.id], [was, 'cb-brakka'], "Brakka's turn not ended")
    ok("the Gamemaster's Next Turn during the wait: moved after it, Brakka's turn not ended")
  }
  {
    // The End Turn first: a change of turn releases the Gamemaster's targets. Vex has cast his three
    // Fireballs above, and has his slots back.
    const ended = await endThorins()
    vex.system.spells.spell3.value = vex.system.spells.spell3.max
    const { flow, damage } = await held()
    const was = written()
    const back = undoTurn(ended, shown())
    queue([back])
    await taken()
    await wait(25)
    assert.deepEqual([written(), results(back.id).length], [was, 0], 'not written while the area holds the targets')
    assert.deepEqual(gmTargets(), ['goblin1'], "the targets the area's still")
    const confirmed = realNow()
    await flow.confirmDamage()
    await until(() => results(back.id).length, 'the taking back')
    const after = realNow() - confirmed
    assert.deepEqual(results(back.id)[0], DONE(back.id))
    assert.ok(after < 300, `written once the damage is done, not when the wait runs out (${after} ms)`)
    assert.deepEqual([...flow.targets].map(t => t.id), ['goblin1'], "the area's damage at its own targets")
    assert.equal(results(damage.id)[0]?.status, 'done', 'the damage made first')
    assert.deepEqual([written(), fight.combatant.id], [was + 1, 'cb-thorin'])
    assert.deepEqual(gmTargets(), [], "then the turn is written back, and Midi releases the Gamemaster's targets")
    ok("under Midi-QOL, an area damage of Vex's holding the Gamemaster's targets, then Thorin's Undo: written once the damage is done, the targets the area's until then")
  }
  midi.settings.confirmAttackDamage = 'none'
  midi.autoRemoveTargets = 'dead'
}

console.log(`turns${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
