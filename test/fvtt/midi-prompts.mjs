// Midi-QOL's own saves asked in the app (module 0.27.0): the real module, dnd5e 5.3.3's real dice
// classes, dnd5e's actors and concentration (actor5e.mjs, dnd5e-cards.mjs), dnd5e's activities
// (activity5e.mjs), midi-fake.mjs's workflow with midi-saves.mjs's saves on it (Midi's checkSaves,
// its branches, concentration and OverTime, modelled on its source), and a stand-in app that says
// which characters are open. MIDI=1 is the run that matters; with LIBWRAPPER=1 too, the module
// wraps through libWrapper. OLD_MIDI=1: a Midi without what the module needs. Without MIDI: no Midi
// at all. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors, combat, combatant } from './stub.mjs'
import { find, openSettings, view } from './settings-app.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
const OLD = Boolean(process.env.OLD_MIDI)
import { DND5E5 } from './paths.mjs'
const DND5E = `${DND5E5}/module/dice`
const ok = message => console.log('ok -', message)

// Foundry's hooks: callAll and call run their handlers at once, as Foundry's do; once removes itself.
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

// The module's long waits, shortened a hundredfold: a minute's wait takes 0.6 seconds. The clock
// itself can be moved on, for what's measured by it.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
const realNow = Date.now
let skew = 0
Date.now = () => realNow() + skew
globalThis.document ??= { hidden: false }

// The console's warnings, to count the module's own.
const warnings = []
console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }

globalThis.DOMParser = new JSDOM('').window.DOMParser
const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = {
  skills: {
    ath: { label: 'Athletics', ability: 'str' }, acr: { label: 'Acrobatics', ability: 'dex' },
    prc: { label: 'Perception', ability: 'wis' },
  },
  tools: { thief: { label: "Thieves' Tools", ability: 'dex' } },
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex', concentration: 'con' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: { fire: { label: 'Fire' } },
  healingTypes: { healing: { label: 'Healing' } },
}
settings.set('messageMode', 'gm')
settings.set('challengeVisibility', 'all')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)

const { Character, saveCard, requestCardHtml } = await import('./dnd5e-cards.mjs')
const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, SaveActivity, DamageActivity, HealActivity, equip } = await import('./activity5e.mjs')
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
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

// Documents by uuid, as far as these name them.
globalThis.fromUuidSync = uuid => {
  const [type, id, embedded, embeddedId] = String(uuid).split('.')
  if (type !== 'Actor') return null
  const actor = actors.get(id) ?? null
  if (!embedded) return actor
  return (embedded === 'Item') ? (actor?.items?.get?.(embeddedId) ?? null) : null
}

if (process.env.LIBWRAPPER) {
  globalThis.libWrapper = {
    registered: [],
    register(pkg, target, fn, type) {
      this.registered.push({ pkg, target, type })
      const path = target.split('.')
      const owner = path.slice(0, -1).reduce((o, key) => o[key], globalThis)
      const original = owner[path.at(-1)]
      owner[path.at(-1)] = function (...args) { return fn.call(this, original.bind(this), ...args) }
    },
  }
  game.modules.set('lib-wrapper', { active: true })
}

// ---- Midi-QOL ----
let midi, midiSaves, placeables, saveWorkflow, runSaves, saveActivity, checkActivity, RollModifierTracker
let itemConcentrationCheck, overTimeTurn, DummyWorkflow
if (MIDI) {
  const fake = await import('./midi-fake.mjs')
  ;({ midi, placeables } = fake)
  fake.installMidi()
  game.modules.set('midi-qol', { active: true, version: OLD ? '13.0.40' : '13.0.60' })
  const saves = await import('./midi-saves.mjs')
  ;({ midiSaves, saveWorkflow, runSaves, saveActivity, checkActivity, RollModifierTracker, itemConcentrationCheck, overTimeTurn } = saves)
  ;({ DummyWorkflow } = saves.installMidiSaves({ actorClasses: [Actor5e], concentrationClass: Character }))
  Object.assign(midi.settings, { autoCheckSaves: 'all', requiresTargets: 'none', gmAutoFastForward: ['save'] })
}
const midiOriginal = MIDI ? MidiQOL.Workflow.prototype.queueTargetSaveRoll : null
// An older Midi: without the workflow's queueTargetSaveRoll and socket, as the module looks for
// them at ready; the workflow has its own back for its saves, after.
const keptSocket = MIDI && MidiQOL.socket
if (OLD) {
  delete MidiQOL.Workflow.prototype.queueTargetSaveRoll
  delete MidiQOL.socket
}

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
const gm = users.get('gm')
gm.active = true
gm.targets = new Set()
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
const erin = user('erin', 'Erin')
for (const each of [alice, bob, erin]) each.active = false
const add = actor => { actors.set(actor.id, actor); return actor }
const thorin = add(new Character({
  id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 4, dex: 1, con: 2, wis: 2 },
  skills: { ath: { ability: 'str', value: 1 }, acr: { ability: 'dex', value: 0 } },
}))
alice.character = thorin
const vex = add(new Character({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3 } }))
bob.character = vex
const goblin = add(new Actor5e({ id: 'goblin', name: 'Goblin Shaman' }))
goblin.type = 'npc'
// Bruni casts from the app (a use, through Midi), at whoever he picks, himself among them.
const bruni = add(new Actor5e({ id: 'bruni', name: 'Bruni', owners: ['erin'], mods: { wis: 1 } }))
erin.character = bruni
equip(bruni, {
  spells: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => [`spell${level}`, { value: (level === 1) ? 2 : 0, max: (level === 1) ? 2 : 0, level }])),
  items: [{
    id: 'fog', name: 'Mind Fog', type: 'spell', system: { level: 1, method: 'spell', properties: [] },
    activities: [{ id: 'fog-save', type: 'save', ability: 'wis', affects: 'creature', count: 3, save: ['wis'], dc: 13 }],
  }],
})
// Cara casts from the app too, while Bruni's spell waits on his save.
const fran = user('fran', 'Fran')
fran.active = false
const cara = add(new Actor5e({ id: 'cara', name: 'Cara', owners: ['fran'], mods: { wis: 1 } }))
fran.character = cara
equip(cara, {
  spells: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => [`spell${level}`, { value: (level === 1) ? 2 : 0, max: (level === 1) ? 2 : 0, level }])),
  items: [{
    id: 'bane', name: 'Bane', type: 'spell', system: { level: 1, method: 'spell', properties: [] },
    activities: [{ id: 'bane-save', type: 'save', ability: 'cha', affects: 'creature', count: 3, save: ['cha'], dc: 13 }],
  }],
})
// The tokens on the Gamemaster's canvas, each its actor's speaker, as Foundry finds one on the scene.
const place = (actor, disposition) => {
  const token = { id: `tok-${actor.id}`, name: actor.name, uuid: `Scene.scene.Token.tok-${actor.id}`, actor, hidden: false, disposition, isLinked: true }
  const placeable = { id: token.id, name: actor.name, document: token, actor }
  token.object = placeable
  placeables?.set(token.id, placeable)
  actor.speakerToken = placeable
  return placeable
}
const tokens = { thorin: place(thorin, 1), vex: place(vex, 1), goblin: place(goblin, -1), bruni: place(bruni, 1), cara: place(cara, 1) }
if (MIDI) canvas.scene.tokens.size = placeables.size
const fight = combat('fight')
combatant(fight, 'cb-bruni', bruni, { token: tokens.bruni.document })
fight.getCombatantsByActor = actor => fight.combatants.filter(cb => cb.actor?.id === actor.id)
game.combat = fight

// ---- The app ----
// Which characters each campaign's app has open, by campaign; Greyhaven's is an older app, which
// says neither which are open nor that it reads Midi's prompts.
const app = {
  events: [], answered: new Map(), waiting: new Map(), wake: null, down: new Set(),
  open: new Map([['camp-a', new Set()], ['camp-b', new Set()]]),
  midi: new Set(['camp-a', 'camp-b']),
}
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const id = body.campaign?.id
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    return announcing
      ? json({ features: { commands: true, slimSheets: 1, maxBytes: 4_000_000, ...(app.midi.has(id) && { midiPrompts: 1 }) } })
      : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.pollStarted?.(id)
    if (app.down.has(id)) throw new TypeError('Failed to fetch')
    if (!app.waiting.get(id)?.length) {
      await new Promise(resolve => {
        const timer = realSetTimeout(resolve, 30)
        app.wake = () => { clearTimeout(timer); resolve() }
        init.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    const commands = app.waiting.get(id) ?? []
    app.waiting.set(id, [])
    app.answered.set(id, (app.answered.get(id) ?? 0) + 1)
    app.answering?.(id, [...(app.open.get(id) ?? [])])
    return json({ commands, ...(app.open.has(id) && { open: [...app.open.get(id)] }) })
  }
  throw new TypeError(`Unexpected fetch of ${url}`)
}

let ids = 0
const queue = (campaignId, ...commands) => {
  app.waiting.set(campaignId, [...(app.waiting.get(campaignId) ?? []), ...commands])
  app.wake?.()
}
const resultFor = id => app.events.find(e => (e.type === 'command.result') && (e.data.id === id))
async function until(test, what, ms = 4000) {
  const end = realNow() + ms
  while (!test()) {
    if (realNow() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
const settle = (ms = 20) => new Promise(resolve => realSetTimeout(resolve, ms))
const sent = (type, campaignId = 'camp-a') => app.events.filter(e => (e.type === type) && (e.campaign?.id === campaignId))
const opened = (campaignId = 'camp-a') => sent('roll.prompt.opened', campaignId).map(e => e.data.prompt)
const closed = (campaignId = 'camp-a') => sent('roll.prompt.closed', campaignId).map(e => e.data)
const closeOf = id => closed().find(c => c.id === id)
const iso = ms => new Date(ms).toISOString()
/** Wait for the app to answer a campaign's fetch this many times more, then for the module. */
async function fetched(campaignId = 'camp-a', times = 2) {
  const start = app.answered.get(campaignId) ?? 0
  await until(() => (app.answered.get(campaignId) ?? 0) >= start + times, `${campaignId}'s fetches`)
  await settle()
}
async function setOpen(list, campaignId = 'camp-a') {
  app.open.set(campaignId, new Set(list))
  await fetched(campaignId)
}
/** The next prompt opened for a campaign after `count` were. */
async function nextPrompt(count, campaignId = 'camp-a') {
  await until(() => opened(campaignId).length > count, 'a prompt to open')
  return opened(campaignId)[count]
}
const kindOf = type => ({ save: 'save', concentration: 'save', check: 'ability', skill: 'skill' }[type])
/** The app's answer to a prompt, as the banner sends it, and what came of it. */
async function answer(prompt, { key, d20s, command = {}, campaignId = 'camp-a' } = {}) {
  key ??= (prompt.type === 'skill') ? prompt.skills[0] : prompt.abilities[0]
  const mode = { adv: 1, dis: -1 }[prompt.advantage?.[key]] ?? 0
  const sent = {
    id: `ans-${++ids}`, actorId: prompt.actorId, kind: kindOf(prompt.type), key, prompt: prompt.id, mode, explicit: false,
    extras: [], dice: [{ faces: 20, results: d20s ?? (mode ? [15, 5] : [15]) }], ...command,
  }
  queue(campaignId, sent)
  await until(() => resultFor(sent.id), `the result of ${sent.id}`)
  const envelope = resultFor(sent.id)
  return { command: sent, result: envelope.data, envelope }
}
const refusal = ({ result }) => [result.status, result.reason, result.error]

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'a', 'camp-b': 'b', 'camp-c': 'c' })
const campaigns = [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'bruni', 'cara'], rolls: true, attacks: true, prompts: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'], rolls: true, prompts: false },
  { id: 'camp-c', title: 'Greyhaven', characters: ['thorin'], rolls: true, prompts: true },
]
settings.set('campaigns', campaigns)
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
await until(() => (app.answered.get('camp-a') ?? 0) > 0, 'the first fetch')
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
const rollsIn = title => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.title === title)).at(-1).data.features.rolls
const ownWarnings = () => warnings.filter(w => w.startsWith('sending-stone | ') && w.includes('Midi-QOL'))

if (!MIDI) {
  assert.deepEqual(['Ashlands', 'Mirkwood', 'Greyhaven'].map(title => rollsIn(title).midiPrompts), [false, false, false])
  assert.deepEqual(ownWarnings(), [])
  ok("without Midi-QOL, nothing is wrapped or warned of, and no campaign's hello says Midi's saves are asked in the app")
  process.exit(0)
}

if (OLD) {
  MidiQOL.Workflow.prototype.queueTargetSaveRoll = midiOriginal
  MidiQOL.socket = keptSocket
  assert.equal(MidiQOL.Workflow.prototype.queueTargetSaveRoll, midiOriginal, 'nothing was wrapped')
  assert.equal(ownWarnings().length, 1, ownWarnings().join('\n'))
  assert.match(ownWarnings()[0], /13\.0\.40/)
  assert.deepEqual(['Ashlands', 'Mirkwood', 'Greyhaven'].map(title => rollsIn(title).midiPrompts), [false, false, false])
  // Asked nothing, as before: a monster's save at Thorin, open in the app, and his concentration.
  await setOpen(['thorin'])
  const count = opened().length
  const item = { id: 'hold', name: 'Hold Person', type: 'spell', uuid: 'Actor.goblin.Item.hold', flags: {}, system: {} }
  const workflow = await saveWorkflow({ actor: goblin, item, activity: saveActivity({ item, abilities: ['wis'], dc: 14 }), targets: [tokens.thorin], token: tokens.goblin })
  await runSaves(workflow)
  assert.equal(midiSaves.queued.length, 1)
  thorin.concentrateOn('Bless')
  await thorin.challengeConcentration({ dc: 10 })
  await settle()
  assert.deepEqual(midiSaves.concentrationRolls.map(r => r.via), ['gm'])
  assert.equal(opened().length, count)
  const win = await openSettings()
  await view(win, 'modules')
  const note = find(win, '.sending-stone-module-note').textContent
  assert.match(note, /SENDINGSTONE\.Modules\.Midi\.Prompts/)
  assert.match(note, /13\.0\.40/)
  await win.close()
  ok('a Midi-QOL without what asking its saves needs is left to roll them, as before: warned of once, named with its version on the Modules card, and the hellos say no')
  process.exit(0)
}

// What the module's wrapper gives Midi for each save, to see each settled.
const proto = MidiQOL.Workflow.prototype
assert.notEqual(proto.queueTargetSaveRoll, midiOriginal, 'queueTargetSaveRoll is wrapped')
if (process.env.LIBWRAPPER) {
  assert.deepEqual(libWrapper.registered.filter(r => r.target.includes('queueTargetSaveRoll')).map(r => [r.target, r.type]),
    [['MidiQOL.Workflow.prototype.queueTargetSaveRoll', 'MIXED']])
}
const moduleWrapper = proto.queueTargetSaveRoll
const given = []
const givenFor = []
proto.queueTargetSaveRoll = function (options) {
  const out = moduleWrapper.call(this, options)
  given.push(out)
  givenFor.push({ item: this.item?.name, target: options?.target?.id, player: options?.playerInfo?.player?.id, chat: options?.playerInfo?.playerChat, dialog: options?.displayOptions?.showRollDialog, at: new Error().stack.split('\n').slice(2, 4).join(' | ') })
  return out
}
assert.deepEqual(['Ashlands', 'Mirkwood', 'Greyhaven'].map(title => rollsIn(title).midiPrompts), [true, false, true])
assert.deepEqual(ownWarnings(), [])
ok(`wraps Midi's queueTargetSaveRoll${process.env.LIBWRAPPER ? ' through libWrapper, MIXED' : ''}, and says so in the hello of each campaign that asks for saves`)

// ---- A monster's spell, as Midi asks its saves ----
let spells = 0
/** A spell of the goblin's at its targets, Midi's workflow at its saves, its card posted. */
async function spell({ name = 'Hold Person', abilities = ['wis'], dc = 14, targets = [tokens.thorin], by = goblin, token = tokens.goblin, activity: fields = {}, item: itemFields = {}, check = null, cls = null } = {}) {
  const slug = `spell${++spells}`
  const item = { id: slug, name, type: 'spell', uuid: `Actor.${by.id}.Item.${slug}`, flags: {}, system: { description: { value: '' } }, ...itemFields }
  const activity = check ? checkActivity({ item, dc, ...check, ...fields }) : saveActivity({ item, abilities, dc, ...fields })
  return saveWorkflow({ actor: by, item, activity, targets, token, cls })
}
/** What Midi asks for a target, as checkSaves asks it, without asking. */
async function optionsFor(workflow, target = tokens.thorin, { whisper = true, simulate = false } = {}) {
  workflow.targetSaveDetails ??= {}
  workflow.saveRequests ??= {}
  workflow.saveTimeouts ??= {}
  return workflow.targetSaveOptions(target, workflow.saveContext(whisper, simulate))
}
/** Midi's own request was made at once, in the same call, and the app told nothing. */
async function passesThrough(workflow, options, what) {
  const before = midiSaves.queued.length
  const prompts = opened().length
  const out = workflow.queueTargetSaveRoll(options)
  assert.equal(midiSaves.queued.length, before + 1, `${what}: Midi's own request is made at once`)
  assert.equal(midiSaves.queued.at(-1), options, what)
  await settle()
  assert.equal(opened().length, prompts, `${what}: nothing is asked in the app`)
  // What Midi then waits on, from another module or the Gamemaster in chat, answers.
  for (const [id, resolve] of Object.entries(workflow.saveRequests ?? {})) {
    delete workflow.saveRequests[id]
    resolve(await new D20Roll('1d20').evaluate())
  }
  return out
}

// Not open: Midi's own way, at once.
let workflow = await spell()
await passesThrough(workflow, await optionsFor(workflow), 'Thorin not open in the app')
ok('a save asked of a character not open in the app is Midi\'s at once, and the app told nothing')

// Open: asked in the app, and Midi's own way waits.
await setOpen(['thorin'])
let count = opened().length
workflow = await spell()
let running = runSaves(workflow)
let prompt = await nextPrompt(count)
assert.match(prompt.id, /^[A-Za-z0-9]{1,64}-thorin$/)
const key = prompt.id.split('-')[0]
assert.notEqual(key, workflow.chatCard.id)
assert.deepEqual(prompt, {
  id: prompt.id, actorId: 'thorin', messageId: workflow.chatCard.id, type: 'save', abilities: ['wis'], dc: 14,
  label: 'Hold Person', openedAt: prompt.openedAt, expiresAt: iso(Date.parse(prompt.openedAt) + 60_000), source: 'midi',
  advantage: {}, askedInFoundry: false,
})
assert.deepEqual([opened('camp-b').length, opened('camp-c').length], [0, 0], 'an older app, and a campaign that asks no saves, are told nothing')
let queuedBefore = midiSaves.queued.length
await settle(60)
assert.equal(midiSaves.queued.length, queuedBefore, "Midi's own request waits on the app")
ok("a save asked of a character open in the app is told to the campaigns that read Midi's prompts, its id the character's and a key of its own, and Midi's own way waits")

// Answered: Midi takes the player's roll, with their dice.
let made = await answer(prompt, { d20s: [16] })
await running
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(midiSaves.queued.length, queuedBefore, "Midi's own request is never made")
let processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.deepEqual(processed.results[0][0].dice[0].results.map(r => r.result), [16])
assert.equal(processed.results[0][0].options.sendingStone, made.command.id)
assert.equal(processed.results[0][0].total, 18)
assert.deepEqual([workflow.saves.has(tokens.thorin), workflow.failedSaves.has(tokens.thorin)], [true, false])
assert.deepEqual([made.result.outcome, made.result.visible, made.result.rolls[0].total], ['success', true, 18])
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'answered' })
const order = app.events.map(e => ((e.type === 'roll.prompt.closed') && (e.data.id === prompt.id)) ? 'closed'
  : (((e.type === 'command.result') && (e.data.id === made.command.id)) ? 'result' : null)).filter(Boolean)
assert.deepEqual(order, ['closed', 'result'])
// Midi's roll made no message: the Gamemaster's client rolls it, and Midi shows saves without one.
assert.equal(made.result.messageId, null)
made = await answer(prompt)
assert.deepEqual(refusal(made), ['failed', 'prompt', 'answered'])
ok("answered from the app, Midi takes the player's roll, with their d20, as the save; the app is told it's closed, then, with Midi's verdict, the result, done with no message where Midi makes none; a second answer is refused")

// Whispered saves, or a DC players may not see: no DC, and no outcome.
midi.settings.autoCheckSaves = 'whisper'
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.dc, null)
made = await answer(prompt, { d20s: [3] })
await running
processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.equal(processed.results[0][0].options.target, undefined, 'rolled against no DC of its own: Midi uses its own')
assert.deepEqual([made.result.status, made.result.outcome, workflow.failedSaves.has(tokens.thorin)], ['done', null, true])
midi.settings.autoCheckSaves = 'all'
settings.set('challengeVisibility', 'player')
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.dc, null, "a monster's DC, under Challenge Visibility for players' own")
made = await answer(prompt, { d20s: [19] })
await running
assert.deepEqual([made.result.outcome, midiSaves.processed.find(p => p.workflow === workflow).results[0][0].options.target], [null, undefined])
settings.set('challengeVisibility', 'all')
// Shown: on the prompt, and the roll's own DC is Midi's.
count = opened().length
workflow = await spell({ dc: 17 })
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.dc, 17)
made = await answer(prompt, { d20s: [10] })
await running
assert.deepEqual([midiSaves.processed.find(p => p.workflow === workflow).results[0][0].options.target, made.result.outcome], [17, 'failure'])
ok("the DC, and whether they saved, only where Midi shows players them: neither for whispered saves, nor where Challenge Visibility hides a monster's DC; the roll's DC is then Midi's own")

// Module 0.31.0: with Hit/miss and save results in the app Always, whether they saved is told for
// whispered saves and a DC kept from players too; the DC never is.
settings.set('chatResults', 'always')
midi.settings.autoCheckSaves = 'whisper'
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.dc, null, 'Always: still no DC')
made = await answer(prompt, { d20s: [3] })
await running
assert.deepEqual([made.result.status, made.result.outcome, workflow.failedSaves.has(tokens.thorin)], ['done', 'failure', true], 'Always: whispered, told')
midi.settings.autoCheckSaves = 'all'
settings.set('challengeVisibility', 'player')
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.dc, null)
made = await answer(prompt, { d20s: [19] })
await running
assert.deepEqual([made.result.outcome, JSON.stringify(made.result).includes('"dc"')], ['success', false], "Always: a monster's DC kept, the outcome told")
settings.set('challengeVisibility', 'all')
// The activity's own Save Display "None", though Midi checks the world's saves: nothing told.
count = opened().length
workflow = await spell({ activity: { saveDisplay: 'none' } })
running = runSaves(workflow)
prompt = await nextPrompt(count)
made = await answer(prompt, { d20s: [3] })
await running
assert.deepEqual([made.result.status, made.result.outcome, workflow.failedSaves.has(tokens.thorin)], ['done', null, true], "Always: the activity's own display None")
settings.delete('chatResults')
ok("with Hit/miss and save results in the app Always, whether they saved is told for whispered saves and where a monster's DC is kept from players, never where the activity's own Save Display is None, and the DC is never sent")

// Shown saves: Midi's roll makes a message, as its own would.
midi.settings.autoCheckSaves = 'allShow'
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
// Module 0.32.0: its d20 typed in from the player's own, so its message is marked `typed`.
made = await answer(prompt, { command: { typed: true } })
await running
let message = messages.get(made.result.messageId)
assert.ok(message, 'a roll message')
assert.deepEqual([message.flags['sending-stone'], message.speaker.token, message.author.id], [{ request: made.command.id, typed: true }, 'tok-thorin', 'alice'])
assert.equal(message.flags.dnd5e.originatingMessage, workflow.chatCard.id)
assert.deepEqual(message.rolls[0].dice[0].results.map(r => r.result), [15], 'its die used as any')
// Module 0.42.0 (its contract §8.2): Bless's d4 on Thorin's saves, typed in with the d20, taken by
// the save Midi asked for, as dnd5e adds it.
thorin.system.bonuses.abilities.save = '1d4'
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
// Foundry's own d4 would show a 1, as seeded.
const { seedRandom } = await import('./dice-core.mjs')
for (let seed = 1; ; seed++) {
  seedRandom(seed)
  if (Math.ceil(CONFIG.Dice.randomUniform() * 4) === 1) { seedRandom(seed); break }
}
made = await answer(prompt, { d20s: [12], command: { typed: true, effectDice: [{ faces: 4, sign: 1, results: [3] }] } })
await running
thorin.system.bonuses.abilities.save = ''
message = messages.get(made.result.messageId)
assert.deepEqual(message.rolls[0].dice.map(die => [die.faces, die.results.map(r => r.result)]), [[20, [12]], [4, [3]]], "Bless's d4 the player's 3")
midi.settings.autoCheckSaves = 'all'
ok("where Midi shows saves, the answer's roll message is made as Midi's own would be: the player's, on the item card, its speaker the token; one typed in from the player's own dice marked `typed` (0.32.0); and since 0.42.0 one typed with the dice its effects add, Bless's d4, takes them")

// The usual save, of one ability, that Midi gives advantage or disadvantage, as for Magic
// Resistance: shown, and rolled with both of the player's d20s.
for (const [flags, shown, mode, kept, total] of [
  [{ hasAdvantage: true }, 'adv', 1, 15, 17], [{ hasDisadvantage: true }, 'dis', -1, 5, 7],
]) {
  midiSaves.advantage.set('thorin', { wis: flags })
  count = opened().length
  workflow = await spell()
  running = runSaves(workflow)
  prompt = await nextPrompt(count)
  assert.deepEqual(prompt.advantage, { wis: shown })
  made = await answer(prompt, { d20s: [15, 5] })
  await running
  const roll = midiSaves.processed.find(p => p.workflow === workflow).results[0][0]
  assert.deepEqual([made.command.mode, made.command.dice[0].results], [mode, [15, 5]])
  assert.deepEqual([roll.options.advantageMode, roll.dice[0].results.map(r => [r.result, r.active])], [mode, [[15, kept === 15], [5, kept === 5]]])
  assert.equal(roll.total, total)
  midiSaves.advantage.delete('thorin')
}
ok("a save of one ability Midi gives advantage or disadvantage shows it, and is rolled with it, with both of the player's d20s")

// A long name is cut to what the app takes.
count = opened().length
workflow = await spell({ name: `${'Very '.repeat(50)}Long Spell` })
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.label, `${'Very '.repeat(50)}Long Spell`.slice(0, 200))
made = await answer(prompt)
await running
ok("an item's name over 200 characters is cut to 200 for the prompt's label")

// ---- Left to Midi ----
// The wait: Midi's own request then, once, not before; a later answer refused.
await game.settings.set('sending-stone', 'midiPromptWait', 1000)
count = opened().length
workflow = await spell()
running = runSaves(workflow)
queuedBefore = midiSaves.queued.length
prompt = await nextPrompt(count)
assert.equal(Date.parse(prompt.expiresAt) - Date.parse(prompt.openedAt), 1000, 'the hidden setting shortens the wait')
assert.equal(midiSaves.queued.length, queuedBefore)
await running
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'expired' })
assert.equal(midiSaves.queued.length, queuedBefore + 1, "Midi's own request, once")
await settle(60)
assert.equal(midiSaves.queued.length, queuedBefore + 1)
made = await answer(prompt)
assert.deepEqual(refusal(made), ['failed', 'prompt', 'expired'])
await game.settings.set('sending-stone', 'midiPromptWait', 60_000)
ok("left unanswered, the save is Midi's own after the wait, which a hidden setting shortens: its request made once, then and not before; closed as expired, and an answer then is refused")

// Closed in the app: Midi's way at the fetch that no longer lists the character.
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
queuedBefore = midiSaves.queued.length
// Midi's own request is made as the fetch's answer is read, before the next fetch starts.
let dropped = false
let atNextFetch = null
app.answering = (id, open) => { if ((id === 'camp-a') && !open.includes('thorin')) dropped = true }
app.pollStarted = id => { if ((id === 'camp-a') && dropped && (atNextFetch === null)) atNextFetch = midiSaves.queued.length }
await setOpen([])
app.answering = app.pollStarted = null
assert.equal(atNextFetch, queuedBefore + 1, "Midi's way at the fetch that no longer lists him")
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'expired' })
assert.ok(Date.now() < Date.parse(prompt.expiresAt), 'before the wait is over')
await running
assert.equal(midiSaves.queued.length, queuedBefore + 1)
ok("a character closed in the app has the save go Midi's way at the next fetch, before the wait is over")

// No fetch for 45 seconds: Midi's way.
await setOpen(['thorin'])
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
const openedReal = realNow()
app.down.add('camp-a')
await settle(60)
assert.equal(closeOf(prompt.id), undefined, 'not at a failed fetch')
skew = 46_000
await until(() => closeOf(prompt.id), 'the save to go Midi\'s way')
// Well before the wait, a minute, which takes 0.6 seconds here.
assert.ok(realNow() - openedReal < 450, `${realNow() - openedReal} ms`)
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'expired' })
await running
skew = 0
app.down.delete('camp-a')
await fetched()
ok("with no fetch answered for 45 seconds, the character counts as closed, and the save goes Midi's way")

// The workflow aborted while it waits, as Midi aborts one used again: gone.
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
workflow.aborted = true
await until(() => closeOf(prompt.id), 'the aborted workflow to close it')
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'gone' })
await running
made = await answer(prompt)
assert.deepEqual(refusal(made), ['failed', 'prompt', 'expired'])
ok("a save whose workflow Midi aborts while it waits closes as gone, and goes Midi's way")

// ---- Asked in Foundry too: Midi's chat request ----
alice.active = true
midi.settings.playerRollSaves = 'chat'
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.askedInFoundry, true)
await until(() => midiSaves.requestCards.some(c => c.whisper.includes('alice')), "Midi's request card")
// Foundry first: Thorin's player rolls it from his sheet.
let foundry = await thorin.rollSavingThrow({ ability: 'wis' }, { configure: false }, {})
await running
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'rolled' })
processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.equal(processed.results[0][0], foundry[0], "Midi takes Foundry's roll")
assert.equal(midiSaves.requestCards.at(-1).deleted, true, "Midi deletes its own request card, as it was given it")
made = await answer(prompt)
assert.deepEqual(refusal(made), ['failed', 'prompt', 'answered'])
ok("where Midi asks the player in Foundry too, in its chat request, a roll in Foundry first is the save: the app's closes as rolled, and its answer is refused")

// The app first: Midi's request taken from it before the roll, its card deleted once, and a roll
// in Foundry later is nothing.
midi.settings.playerSaveTimeout = 20
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(Date.parse(prompt.expiresAt) - Date.parse(prompt.openedAt), 20_000, "the wait ends with Midi's own")
await until(() => midiSaves.requestCards.length && (typeof workflow.saveRequests['tok-thorin'] === 'function'), "Midi's request")
const card = midiSaves.requestCards.at(-1)
let deletes = 0
const deleteCard = card.delete.bind(card)
card.delete = async () => { deletes++; return deleteCard() }
let atRoll = null
Hooks.once('dnd5e.preRollSavingThrowV2', () => { atRoll = [workflow.saveRequests['tok-thorin'], workflow.saveTimeouts['tok-thorin']] })
made = await answer(prompt, { d20s: [12] })
await running
assert.deepEqual(atRoll, [undefined, undefined], "Midi's request and its wait were taken before the roll")
assert.deepEqual([made.result.status, deletes, card.deleted], ['done', 1, true])
processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.deepEqual(processed.results[0][0].dice[0].results.map(r => r.result), [12])
foundry = await thorin.rollSavingThrow({ ability: 'wis' }, { configure: false }, {})
await settle(400)
assert.equal(midiSaves.timeoutRolls ?? 0, 0, "Midi's own wait never rolls")
assert.equal(workflow.saveTotals.get('tok-thorin').total, 14)
assert.equal(made.result.messageId !== null, true, "a player in Foundry has their roll's message, as Midi's would")
ok("answered in the app first, Midi's chat request and its wait are taken from it before the roll, its card deleted, once, by the module; a roll in Foundry later is nothing to it")

// The answer fails: Midi's request has its resolver back, and its wait, and Foundry's roll is the
// save, the wait then cleared.
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
await until(() => typeof workflow.saveRequests['tok-thorin'] === 'function', "Midi's request")
Hooks.once('dnd5e.preRollSavingThrowV2', config => { if (config.rolls?.[0]?.options?.sendingStone) throw new Error('A module broke the roll') })
made = await answer(prompt)
assert.deepEqual([made.result.status, made.result.reason], ['failed', 'error'])
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'expired' })
assert.equal(typeof workflow.saveRequests['tok-thorin'], 'function', 'the resolver is back')
assert.notEqual(workflow.saveTimeouts['tok-thorin'], undefined, 'and a wait')
const beforeFoundry = new Set(messages.keys())
foundry = await thorin.rollSavingThrow({ ability: 'wis' }, { configure: false }, {})
await running
assert.equal(midiSaves.processed.find(p => p.workflow === workflow).results[0][0], foundry[0])
assert.equal(workflow.saveTimeouts['tok-thorin'], undefined)
await settle(300)
assert.equal([...messages.values()].filter(m => !beforeFoundry.has(m.id) && (m.flags?.dnd5e?.roll?.type === 'save')).length, 1, 'no roll once the wait would have been up')
ok("an answer that fails gives Midi's chat request its resolver back, and its wait, closed as expired; Foundry's roll is then the save")

// The answer fails, and no one rolls in Foundry: Midi's own wait rolls it once its time is up, as
// Midi rolls it, with Foundry's dice; so the workflow goes on.
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
const failedFrom = Date.parse(prompt.openedAt)
await until(() => typeof workflow.saveRequests['tok-thorin'] === 'function', "Midi's request")
Hooks.once('dnd5e.preRollSavingThrowV2', config => { if (config.rolls?.[0]?.options?.sendingStone) throw new Error('A module broke the roll') })
made = await answer(prompt)
assert.deepEqual([made.result.status, closeOf(prompt.id)?.reason], ['failed', 'expired'])
let rolledAt = null
Hooks.once('dnd5e.preRollSavingThrowV2', () => { rolledAt = Date.now() })
const finished = await Promise.race([running.then(() => true), new Promise(resolve => realSetTimeout(() => resolve(false), 2000))])
assert.equal(finished, true, "Midi's own wait rolls the save once its time is up: the workflow goes on")
// Its time, a scaled 20 seconds from when Midi asked, as the harness counts it: 0.2 seconds of the
// clock, give or take.
assert.ok((rolledAt !== null) && (rolledAt - failedFrom >= 150) && (rolledAt - failedFrom < 450), `${rolledAt - failedFrom} ms`)
processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.deepEqual([processed.results[0][0].options.sendingStone, processed.results[0][0].options.target], [undefined, 14])
assert.deepEqual([workflow.saveRequests['tok-thorin'], workflow.saveTimeouts['tok-thorin'], midiSaves.requestCards.at(-1).deleted], [undefined, undefined, true])
midi.settings.playerSaveTimeout = 0
ok("an answer that fails, with no roll in Foundry after, has Midi's own wait roll the save once its time is up, with Midi's options and Foundry's dice: Midi's workflow goes on")

// ---- Asked in Foundry too: a roll dialog on the player's screen ----
// The app first: the dialog on the player's screen is closed, so Midi's own wait there, its Player
// Save Timeout, doesn't roll the save again and post it; the dialog's settling, after, is nothing.
midi.settings.playerRollSaves = 'noneDialogPublic'
midi.settings.playerSaveTimeout = 20
count = opened().length
let sockets = midiSaves.sockets.length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.askedInFoundry, true)
assert.equal(Date.parse(prompt.expiresAt) - Date.parse(prompt.openedAt), 20_000, "the wait ends with Midi's own")
await until(() => midiSaves.sockets.length > sockets, "Midi's socket roll on the player's client")
let dialog = midiSaves.sockets.at(-1)
assert.deepEqual([dialog.handler, dialog.userId, dialog.data.displayOptions.fastForward], ['rollAbility', 'alice', false])
assert.equal(globalThis.foundry.applications.instances.get(dialog.dialog.id), dialog.dialog, "the dialog is open on the player's screen")
const dialogFrom = new Set(messages.keys())
made = await answer(prompt, { d20s: [9] })
await running
assert.equal(made.result.status, 'done')
// Midi's request on the player's client settles as the dialog closes, after the answer: no
// second close.
assert.deepEqual(closed().filter(c => c.id === prompt.id), [{ id: prompt.id, reason: 'answered' }], "Midi's own settling after is no second close")
message = messages.get(made.result.messageId)
assert.deepEqual([message.author.id, message.whisper, message.flags['sending-stone'].midiAnswer],
  ['alice', [], { workflowId: workflow.id, actorUuid: thorin.uuid }], "the player's roll, public as Midi's would be")
assert.deepEqual([dialog.dialog.closed, globalThis.foundry.applications.instances.has(dialog.dialog.id), dialog.result], [true, false, {}],
  'the dialog closed, unrolled: Midi has no roll from it')
await settle(400)
assert.deepEqual(midiSaves.dialogTimeouts.filter(call => call === dialog), [], "Midi's wait on the player's client never rolls")
const saved = [...messages.values()].filter(m => !dialogFrom.has(m.id) && (m.flags?.dnd5e?.roll?.type === 'save'))
assert.deepEqual(saved.map(m => m.id), [made.result.messageId], 'no second save is posted')
await dialog.answer()
processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.deepEqual(processed.results[0][0].dice[0].results.map(r => r.result), [9])
assert.deepEqual(closed().filter(c => c.id === prompt.id), [{ id: prompt.id, reason: 'answered' }])
ok("where Midi has the player's roll dialog open in Foundry, the app's answer first is the save, and the dialog is closed on their screen: Midi's own wait there never rolls it again, nor posts a second save, and no second close is sent")

// The player first, in the dialog: rolled, and the app's answer refused.
midi.settings.playerSaveTimeout = 0
count = opened().length
sockets = midiSaves.sockets.length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
await until(() => midiSaves.sockets.length > sockets, "Midi's socket roll on the player's client")
dialog = midiSaves.sockets.at(-1)
await dialog.answer()
await running
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'rolled' })
assert.equal(midiSaves.processed.find(p => p.workflow === workflow).results[0][0], dialog.result[0])
made = await answer(prompt)
assert.deepEqual(refusal(made), ['failed', 'prompt', 'answered'])
// The player Midi asks isn't the one the character is assigned to: the answer is still theirs,
// so that their client sees it, and closes their dialog.
alice.character = null
thorin.owners = ['alice', 'bob']
count = opened().length
sockets = midiSaves.sockets.length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
await until(() => midiSaves.sockets.length > sockets, "Midi's socket roll on the player's client")
dialog = midiSaves.sockets.at(-1)
assert.equal(dialog.userId, 'alice')
made = await answer(prompt)
await running
assert.deepEqual([messages.get(made.result.messageId).author.id, dialog.dialog.closed], ['alice', true])
alice.character = thorin
thorin.owners = ['alice']
midi.settings.playerRollSaves = 'none'
alice.active = false
ok("the player rolling in Midi's dialog first is the save, and the app's answer is refused; the answer's roll is the player's Midi asks, whoever the character is assigned to")

// ---- Who's asked ----
// The Gamemaster's own chat request, for a player not in Foundry: held.
midi.settings.rollNPCLinkedSaves = 'none'
count = opened().length
const cards = midiSaves.requestCards.length
workflow = await spell()
queuedBefore = midiSaves.queued.length
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.askedInFoundry, false)
await settle(40)
assert.deepEqual([midiSaves.queued.length, midiSaves.requestCards.length], [queuedBefore, cards], 'no request to the Gamemaster meanwhile')
made = await answer(prompt)
await running
assert.equal(made.result.status, 'done')
midi.settings.rollNPCLinkedSaves = 'auto'
ok("Midi's chat request to the Gamemaster, for a player not in Foundry, waits on the app")

// The answer's message is as Midi's own roll would show it: whispered to the Gamemaster under the
// players' "none" Player Roll Saves, for a player in Foundry; and in the activity's own roll mode.
alice.active = true
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.equal(prompt.askedInFoundry, false)
made = await answer(prompt)
await running
message = messages.get(made.result.messageId)
assert.deepEqual([message.whisper, message.blind], [['gm'], false])
alice.active = false
midi.settings.autoCheckSaves = 'allShow'
count = opened().length
workflow = await spell({ activity: { midiProperties: { rollMode: 'blind' } } })
running = runSaves(workflow)
prompt = await nextPrompt(count)
made = await answer(prompt)
await running
message = messages.get(made.result.messageId)
assert.deepEqual([message.whisper, message.blind], [['gm'], true])
midi.settings.autoCheckSaves = 'all'
ok("the answer's message is whispered as Midi's own roll would be: to the Gamemaster under the players' none, and blind where the activity says so")

// What Midi decides itself, or another module asks, is Midi's at once.
for (const [module, value] of [['monks-tokenbar', 'mtb'], ['flash-rolls-5e', 'ftb'], ['epic-rolls-5e', 'rer']]) {
  midiSaves.modules.add(module)
  midi.settings.rollNPCLinkedSaves = value
  workflow = await spell()
  await passesThrough(workflow, await optionsFor(workflow), value)
  midi.settings.rollNPCLinkedSaves = 'auto'
  midiSaves.modules.delete(module)
}
workflow = await spell({ by: vex, token: tokens.vex, activity: { friendlySave: 'friendlyFail' } })
await passesThrough(workflow, await optionsFor(workflow), 'friendly, failed')
midiSaves.advantage.set('thorin', { wis: { tracker: new RollModifierTracker({ willFail: true }) } })
workflow = await spell()
await passesThrough(workflow, await optionsFor(workflow), 'failed by Midi')
midiSaves.advantage.set('thorin', { wis: { tracker: new RollModifierTracker({ willSucceed: true }) } })
workflow = await spell()
await passesThrough(workflow, await optionsFor(workflow), 'passed by Midi')
midiSaves.advantage.set('thorin', { str: { tracker: new RollModifierTracker({ willFail: true }) }, dex: { tracker: new RollModifierTracker({ willFail: true }) } })
workflow = await spell({ abilities: ['str', 'dex'] })
await passesThrough(workflow, await optionsFor(workflow), 'every choice failed by Midi')
midiSaves.advantage.set('thorin', { str: { tracker: new RollModifierTracker({ willSucceed: true }) } })
workflow = await spell({ abilities: ['str', 'dex'] })
await passesThrough(workflow, await optionsFor(workflow), 'a choice passed by Midi')
midiSaves.advantage.delete('thorin')
workflow = await spell({ check: { associated: ['thief'] } })
await passesThrough(workflow, await optionsFor(workflow), 'a tool check')
workflow = await spell({ check: { ability: '' } })
await passesThrough(workflow, await optionsFor(workflow), 'a check with no ability')
workflow = await spell()
await passesThrough(workflow, await optionsFor(workflow, tokens.thorin, { simulate: true }), "Midi's simulation")
workflow = await spell({ cls: DummyWorkflow })
await passesThrough(workflow, await optionsFor(workflow), "Midi's dummy workflow")
ok("what Monk's TokenBar, Flash Rolls or Epic Rolls ask, what Midi fails or passes itself, friendly or by its trackers, a tool check, a check with no ability, and Midi's simulations, are Midi's at once, and the app told nothing")

// Several choices: those Midi fails left out; advantage per choice.
midiSaves.advantage.set('thorin', { con: { tracker: new RollModifierTracker({ willFail: true }) }, str: { hasAdvantage: true }, dex: { hasDisadvantage: true } })
count = opened().length
workflow = await spell({ name: 'Grasping Vine', abilities: ['str', 'dex', 'con'] })
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.deepEqual([prompt.abilities, prompt.advantage], [['str', 'dex'], { str: 'adv', dex: 'dis' }])
// Midi's DEX cover counts for a DEX save, the ability chosen.
midiSaves.cover.set('tok-thorin', 2)
made = await answer(prompt, { key: 'dex', d20s: [15, 5] })
await running
processed = midiSaves.processed.find(p => p.workflow === workflow)
const [dexRoll] = processed.results[0]
assert.deepEqual([made.command.mode, dexRoll.options.advantageMode, dexRoll.dice[0].results.map(r => r.result)], [-1, -1, [15, 5]])
assert.deepEqual([dexRoll.total, dexRoll.options.midiChosenId], [6, 'dex'])
assert.deepEqual(workflow.saveTotals.get('tok-thorin'), { total: 8, dc: 14, ability: 'dex', cover: 2 })
assert.equal(made.result.outcome, 'failure')
// Strength, chosen: Midi's choice is Strength, with no cover.
count = opened().length
workflow = await spell({ name: 'Grasping Vine', abilities: ['str', 'dex', 'con'] })
running = runSaves(workflow)
prompt = await nextPrompt(count)
made = await answer(prompt, { key: 'str', d20s: [8, 14] })
await running
processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.deepEqual([processed.results[0][0].total, processed.results[0][0].options.midiChosenId], [18, 'str'])
assert.deepEqual(workflow.saveTotals.get('tok-thorin'), { total: 18, dc: 14, ability: 'str', cover: 0 })
// Of DEX and CON, DEX failed by Midi: CON alone is offered, and the roll still says it's CON, for
// Midi takes the first of its choices otherwise, and DEX's cover with it.
midiSaves.advantage.set('thorin', { dex: { tracker: new RollModifierTracker({ willFail: true }) } })
count = opened().length
workflow = await spell({ name: 'Ice Storm', abilities: ['dex', 'con'] })
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.deepEqual(prompt.abilities, ['con'])
made = await answer(prompt, { key: 'con', d20s: [11] })
await running
processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.equal(processed.results[0][0].options.midiChosenId, 'con')
assert.deepEqual(workflow.saveTotals.get('tok-thorin'), { total: 16, dc: 14, ability: 'con', cover: 0 })
midiSaves.cover.clear()
midiSaves.advantage.delete('thorin')
ok("of several choices, those Midi fails are left out; each choice's advantage is Midi's, and rolled with the player's d20s; the choice made is Midi's, stamped on the roll, with DEX cover for a DEX save only")

// A skill check, from an ordinary workflow: a choice of two, each with its own ability.
count = opened().length
workflow = await spell({ name: 'Web', check: { associated: ['ath', 'acr'] }, dc: 12 })
running = runSaves(workflow)
prompt = await nextPrompt(count)
assert.deepEqual([prompt.type, prompt.abilities, prompt.skills, prompt.source, prompt.dc], ['skill', [], ['ath', 'acr'], 'midi', 12])
made = await answer(prompt, { key: 'acr', d20s: [10] })
await running
processed = midiSaves.processed.find(p => p.workflow === workflow)
assert.deepEqual([made.command.kind, processed.results[0][0].total, processed.results[0][0].options.midiChosenId], ['skill', 11, 'acr'])
assert.deepEqual([made.result.outcome, workflow.failedSaves.has(tokens.thorin)], ['failure', true])
made = await answer(prompt, { key: 'ath' })
assert.deepEqual(refusal(made), ['failed', 'prompt', 'answered'])
ok("a skill check asks for the skills offered; Acrobatics chosen is rolled with Dexterity, its own, not Athletics' Strength")

// Answers of another kind, or rolled otherwise than Midi decides, are refused.
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
for (const [command, error] of [
  [{ kind: 'ability' }, 'ability'], [{ key: 'str' }, 'ability'], [{ explicit: true }, 'mode'],
  [{ extras: [{ sign: 1, count: 1, sides: 4 }], dice: [{ faces: 20, results: [10] }, { faces: 4, results: [2] }] }, 'mode'],
]) {
  made = await answer(prompt, { command })
  assert.deepEqual(refusal(made), ['failed', 'prompt', error], JSON.stringify(command))
}
made = await answer(prompt, { command: { actorId: 'vex', prompt: prompt.id } })
assert.deepEqual(refusal(made), ['failed', 'prompt', 'character'])
made = await answer(prompt)
await running
assert.equal(made.result.status, 'done')
ok("an answer of another kind, with another ability, or rolled otherwise than Midi decides, or another character's, is refused, and the prompt still waits")

// Thorin also in Greyhaven, whose app is older: asked only in Ashlands; and only while open in a
// campaign that reads Midi's prompts.
await setOpen([])
count = opened().length
workflow = await spell()
await passesThrough(workflow, await optionsFor(workflow), "open in no campaign that reads Midi's prompts")
await setOpen(['thorin'])
ok("a character open only in an older app's campaign isn't asked")

// ---- The hello, and nothing else closes it ----
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
announce({ campaignId: 'camp-a' })
await settle()
const hello = app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).at(-1)
assert.deepEqual(hello.data.prompts.filter(p => p.id === prompt.id), [prompt])
// A save rolled on the item card, as dnd5e's closeAnswered reads one, and the card deleted.
await thorin.rollSavingThrow({ ability: 'wis' }, { configure: false }, { data: { flags: { dnd5e: { originatingMessage: workflow.chatCard.id } } } })
const { deleteMessage } = await import('./dnd5e-cards.mjs')
await deleteMessage(workflow.chatCard)
await settle()
assert.equal(closeOf(prompt.id), undefined, 'still open')
made = await answer(prompt)
await running
assert.equal(made.result.status, 'done')
ok("a campaign's hello lists the Midi prompts waiting; a save rolled on the item card, and the card deleted, close none")

// ---- The player's own spell, from the app, asks them for a save ----
await setOpen(['thorin', 'bruni'])
count = opened().length
queuedBefore = midiSaves.queued.length
const use = { id: `use-${++ids}`, actorId: 'bruni', kind: 'use', item: 'fog', activity: 'fog-save', targets: [], self: true, slot: null }
queue('camp-a', use)
prompt = await nextPrompt(count)
assert.deepEqual([prompt.actorId, prompt.label, prompt.abilities], ['bruni', 'Mind Fog', ['wis']])
made = await answer(prompt, { d20s: [17] })
await until(() => resultFor(use.id), 'the use')
assert.deepEqual([made.result.status, resultFor(use.id).data.status], ['done', 'done'], JSON.stringify(resultFor(use.id).data))
assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'answered' })
assert.equal(midiSaves.queued.length, queuedBefore, "Midi's own way never taken")
const fogFlow = midiSaves.processed.at(-1)
assert.deepEqual(fogFlow.results[0][0].dice[0].results.map(r => r.result), [17])
ok("a player's own spell from the app that asks them for a save has their answer made at once, not after the spell: the spell's workflow takes it")

// Bruni's spell from the app waits on his save, asked there and not answered; Cara casts from the
// app meanwhile. Bruni's spell is made once it waits on the app, so the uses after it aren't held
// behind it a minute, and neither is told it took too long.
count = opened().length
const fogAgain = { id: `use-${++ids}`, actorId: 'bruni', kind: 'use', item: 'fog', activity: 'fog-save', targets: [], self: true, slot: null }
queue('camp-a', fogAgain)
const waiting = await nextPrompt(count)
assert.equal(waiting.actorId, 'bruni')
const bane = { id: `use-${++ids}`, actorId: 'cara', kind: 'use', item: 'bane', activity: 'bane-save', targets: [], self: true, slot: null }
queue('camp-a', bane)
await until(() => resultFor(fogAgain.id) && resultFor(bane.id), 'both uses', 3000)
assert.equal(closeOf(waiting.id), undefined, "both made while Bruni's save still waits on the app")
assert.deepEqual([resultFor(fogAgain.id).data.status, resultFor(bane.id).data.status], ['done', 'done'], JSON.stringify([resultFor(fogAgain.id).data, resultFor(bane.id).data]))
assert.equal(cara.system.spells.spell1.value, 1, "Cara's slot spent")
await until(() => closeOf(waiting.id), "Bruni's save to go Midi's way", 3000)
assert.deepEqual(closeOf(waiting.id), { id: waiting.id, reason: 'expired' })
await settle(200)
const useResults = app.events.filter(e => (e.type === 'command.result') && [fogAgain.id, bane.id].includes(e.data.id))
  .map(e => [e.data.id, e.data.status, e.data.reason])
assert.deepEqual(useResults, [[fogAgain.id, 'done', null], [bane.id, 'done', null]])
ok("a player's spell from the app whose save waits on the app is made once it waits, and another player's spell from the app is made meanwhile, not held behind it; neither is told it took too long")

// ---- Concentration, in Midi's "chat" mode ----
midi.settings.doConcentrationCheck = 'chat'
thorin.effects = []
thorin.ended = []
thorin.concentrateOn('Bless')
// War Caster, as dnd5e gives it: advantage on concentration checks.
thorin.system.attributes.concentration.roll.mode = 1
count = opened().length
let midiRolls = midiSaves.concentrationRolls.length
let conc = await thorin.challengeConcentration({ dc: 12 })
prompt = await nextPrompt(count)
assert.deepEqual([conc.flags['midi-qol'].concentrationRolled, conc.flags['sending-stone'].midiHeld], [true, true])
assert.equal(midiSaves.concentrationRolls.length, midiRolls, "Midi's Gamemaster doesn't roll it")
assert.deepEqual(prompt, {
  id: prompt.id, actorId: 'thorin', messageId: conc.id, type: 'concentration', abilities: ['con'], dc: 12, label: 'Bless',
  openedAt: prompt.openedAt, expiresAt: iso(Date.parse(prompt.openedAt) + 60_000), source: 'concentration', advantage: { con: 'adv' },
  askedInFoundry: false,
})
made = await answer(prompt, { d20s: [4, 2] })
assert.deepEqual([made.command.mode, made.result.status, made.result.outcome, made.result.rolls[0].total], [1, 'done', 'failure', 9])
assert.deepEqual(made.result.rolls[0].dice[0].results.map(r => [r.result, r.active]), [[4, true], [2, false]])
thorin.system.attributes.concentration.roll.mode = 0
message = messages.get(made.result.messageId)
assert.deepEqual([message.rolls[0].options.target, message.whisper, message.flags['sending-stone']], [12, ['gm'], { request: made.command.id }])
assert.deepEqual(thorin.ended, ['Bless'], "Midi's hook ends a failed check's concentration")
await settle()
assert.equal(conc.flags['sending-stone'].midiDone, true)
ok("Midi's concentration card, made here for a character open in the app, is held, so Midi doesn't roll it; asked in the app, it's rolled as Midi's Gamemaster would, with the player's d20, and a failed check ends concentration through Midi")

// Challenge Visibility hiding the DC: none on the prompt, nor whether they kept it.
settings.set('challengeVisibility', 'none')
thorin.effects = []
thorin.concentrateOn('Bless')
count = opened().length
conc = await thorin.challengeConcentration({ dc: 12 })
prompt = await nextPrompt(count)
assert.equal(prompt.dc, null)
made = await answer(prompt, { d20s: [18] })
assert.deepEqual([made.result.status, made.result.outcome, messages.get(made.result.messageId).rolls[0].options.target], ['done', null, 12])
settings.set('challengeVisibility', 'all')
ok("Midi's concentration card with Challenge Visibility hiding its DC is asked without it, and told without whether it was kept; it's rolled against Midi's DC")

// Midi's own flags: advantage on concentration checks, as a Midi-style War Caster gives it, or on
// the ability's saves; a "no advantage" flag cancelling it. Shown, and rolled with the player's
// d20s, as Midi rolls the check.
for (const [flags, shown, d20s, kept] of [
  [{ advantage: { concentration: true } }, 'adv', [4, 18], [false, true]],
  [{ advantage: { save: { con: true } } }, 'adv', [4, 18], [false, true]],
  [{ disadvantage: { concentration: true } }, 'dis', [18, 15], [false, true]],
  [{ advantage: { concentration: true }, noAdvantage: { concentration: true } }, undefined, [18], [true]],
]) {
  thorin.flags['midi-qol'] = flags
  thorin.effects = []
  thorin.concentrateOn('Bless')
  count = opened().length
  conc = await thorin.challengeConcentration({ dc: 12 })
  prompt = await nextPrompt(count)
  assert.deepEqual(prompt.advantage, shown ? { con: shown } : {}, JSON.stringify(flags))
  made = await answer(prompt, { d20s })
  assert.deepEqual(made.result.rolls[0].dice[0].results.map(r => [r.result, r.active]), d20s.map((d, i) => [d, kept[i]]), JSON.stringify(flags))
  delete thorin.flags['midi-qol']
}
ok("Midi's concentration card shows the advantage Midi's own flags give the check, for concentration or the ability's saves, as Midi rolls it, with the player's d20s")

// Left to Midi: to the player's client where they're in Foundry; else rolled here.
await game.settings.set('sending-stone', 'midiPromptWait', 1000)
for (const [active, via] of [[true, 'socket'], [false, 'gm']]) {
  alice.active = active
  thorin.concentrateOn('Bless')
  count = opened().length
  const socketsBefore = midiSaves.sockets.length
  const messagesBefore = messages.size
  conc = await thorin.challengeConcentration({ dc: 11 })
  prompt = await nextPrompt(count)
  await until(() => closeOf(prompt.id), 'the wait')
  assert.deepEqual(closeOf(prompt.id), { id: prompt.id, reason: 'expired' })
  await settle()
  assert.equal(conc.flags['sending-stone'].midiDone, true)
  if (via === 'socket') {
    assert.deepEqual(midiSaves.sockets.slice(socketsBefore).map(s => [s.handler, s.userId, s.data.target, s.data.rollMode]), [['rollConcentration', 'alice', 11, 'gm']])
  } else {
    const rolled = [...messages.values()].slice(messagesBefore).filter(m => m.flags?.dnd5e?.roll?.type === 'save')
    assert.deepEqual(rolled.map(m => [m.speaker.actor, m.rolls[0].options.target, m.whisper]), [['thorin', 11, ['gm']]])
  }
}
await game.settings.set('sending-stone', 'midiPromptWait', 60_000)
ok("a held concentration card left unanswered is rolled as Midi would: on the player's client, where they're in Foundry, or by the Gamemaster's, and marked done")

// Not open: Midi rolls it.
await setOpen([])
thorin.concentrateOn('Bless')
count = opened().length
midiRolls = midiSaves.concentrationRolls.length
conc = await thorin.challengeConcentration({ dc: 10 })
await settle()
assert.deepEqual([opened().length, midiSaves.concentrationRolls.length, conc.flags['sending-stone']], [count, midiRolls + 1, undefined])
ok("for a character not open in the app, Midi's concentration card is Midi's to roll, as ever")

// After the Gamemaster reloads: a card held, never answered, is rolled as Midi would. It's made
// here as one held before the reload is found: marked held, Midi kept from rolling it, and no
// prompt asked for it on this client since.
conc = await ChatMessage.create({
  content: '<div class="dnd5e chat-card request-card" data-action="concentration" data-dc="13" data-type="midi-concentration"></div>',
  speaker: ChatMessage.getSpeaker({ actor: thorin }), flags: { 'midi-qol': { concentrationRolled: true } },
})
conc.flags['sending-stone'] = { midiHeld: true }
const { checkBridge } = await import(`${MODULE}/scripts/bridge.mjs`)
gm.isActiveGM = false
checkBridge()
gm.isActiveGM = true
let messagesBefore = messages.size
checkBridge()
await settle(60)
assert.equal(conc.flags['sending-stone'].midiDone, true)
const reloaded = [...messages.values()].slice(messagesBefore).filter(m => m.flags?.dnd5e?.roll?.type === 'save')
assert.deepEqual(reloaded.map(m => [m.speaker.actor, m.rolls[0].options.target]), [['thorin', 13]])
await setOpen(['thorin'])
ok('a concentration card held for the app when the Gamemaster reloads is rolled as Midi would once their client is the bridge again')

// Midi's "item" mode: a workflow's save, asked as a concentration check.
midi.settings.doConcentrationCheck = 'item'
thorin.effects = []
thorin.concentrateOn('Hex')
count = opened().length
running = itemConcentrationCheck(thorin, tokens.thorin, 10)
prompt = await nextPrompt(count)
assert.deepEqual([prompt.type, prompt.source, prompt.abilities, prompt.label, prompt.dc], ['concentration', 'concentration', ['con'], 'Hex', 10])
made = await answer(prompt, { d20s: [2] })
workflow = await running
assert.deepEqual([made.result.outcome, workflow.failedSaves.has(tokens.thorin)], ['failure', true])
message = made.result.messageId && messages.get(made.result.messageId)
const concentrationRoll = midiSaves.processed.find(p => p.workflow === workflow).results[0][0]
assert.equal(concentrationRoll.options.sendingStone, made.command.id)
assert.equal(thorin.concentration.effects.size, 0, "Midi's item ends the concentration")
// Disadvantage on concentration checks from Midi's flags: shown, and rolled so.
thorin.flags['midi-qol'] = { disadvantage: { concentration: true } }
thorin.effects = []
thorin.concentrateOn('Hex')
count = opened().length
running = itemConcentrationCheck(thorin, tokens.thorin, 10)
prompt = await nextPrompt(count)
assert.deepEqual(prompt.advantage, { con: 'dis' })
made = await answer(prompt, { d20s: [15, 3] })
workflow = await running
const flagged = midiSaves.processed.find(p => p.workflow === workflow).results[0][0]
assert.deepEqual([made.command.mode, flagged.dice[0].results.map(r => [r.result, r.active])], [-1, [[15, false], [3, true]]])
assert.deepEqual([made.result.outcome, workflow.failedSaves.has(tokens.thorin)], ['failure', true])
delete thorin.flags['midi-qol']
midi.settings.doConcentrationCheck = 'chat'
ok("in Midi's item mode, the concentration check is a workflow's save, asked as a concentration check, and rolled as one, with the disadvantage Midi's flags give concentration checks")

// Module 0.42.0 (its contract §2.1, as amended in its review fixes): a die only concentration
// checks take, on `attributes.concentration.bonuses.save`, typed in with the d20, is taken by the
// checks Midi asks as by dnd5e's card, both of Midi's being dnd5e's rollConcentration: its card's,
// answered here with it, and its item mode's workflow save, which Midi's wrapper makes one. Foundry's
// own d4 would show a 1, as seeded, and a plain save takes no such die (the save prompt above).
const foundryD4Shows1 = () => {
  for (let seed = 1; ; seed++) {
    seedRandom(seed)
    if (Math.ceil(CONFIG.Dice.randomUniform() * 4) === 1) return seedRandom(seed)
  }
}
const concentrationDie = { typed: true, effectDice: [{ faces: 4, sign: 1, results: [3] }] }
const diceOf = roll => roll.dice.map(die => [die.faces, die.results.map(r => r.result)])
thorin.system.attributes.concentration.bonuses.save = '1d4'
thorin.effects = []
thorin.concentrateOn('Bless')
count = opened().length
conc = await thorin.challengeConcentration({ dc: 12 })
prompt = await nextPrompt(count)
assert.deepEqual([prompt.type, prompt.source], ['concentration', 'concentration'])
foundryD4Shows1()
made = await answer(prompt, { d20s: [12], command: concentrationDie })
await settle()
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(diceOf(messages.get(made.result.messageId).rolls[0]), [[20, [12]], [4, [3]]], "Midi's card: the concentration d4 the player's 3")
midi.settings.doConcentrationCheck = 'item'
thorin.effects = []
thorin.concentrateOn('Hex')
count = opened().length
running = itemConcentrationCheck(thorin, tokens.thorin, 10)
prompt = await nextPrompt(count)
assert.deepEqual([prompt.type, prompt.source], ['concentration', 'concentration'])
foundryD4Shows1()
made = await answer(prompt, { d20s: [12], command: concentrationDie })
workflow = await running
const typedCheck = midiSaves.processed.find(p => p.workflow === workflow).results[0][0]
assert.deepEqual([made.result.status, typedCheck.options.sendingStone], ['done', made.command.id])
assert.deepEqual(diceOf(typedCheck), [[20, [12]], [4, [3]]], "Midi's item mode: the concentration d4 the player's 3")
midi.settings.doConcentrationCheck = 'chat'
thorin.system.attributes.concentration.bonuses.save = ''
ok("since 0.42.0 a die only concentration checks take, typed in with the d20, is the player's on the checks Midi asks: its concentration card's and its item mode's workflow save, as on dnd5e's card")

// ---- OverTime turn saves ----
const overTime = (id, value) => ({ id, uuid: `Actor.thorin.ActiveEffect.${id}`, name: id, changes: [{ key: 'flags.midi-qol.OverTime', value }] })
for (const [effect, start, d20s, expect] of [
  [overTime('venom', 'turn=end,label=Venom,saveAbility=con,saveDC=13'), false, [11], { label: 'Venom', dc: 13, type: 'save', abilities: ['con'], kind: 'save', total: 16 }],
  [overTime('grapple', 'turn=start,label=Grappled,rollType=check,saveAbility=str,saveDC=12'), true, [9], { label: 'Grappled', dc: 12, type: 'check', abilities: ['str'], kind: 'ability', total: 13 }],
  [overTime('web', 'turn=start,label=Webbed,rollType=skill,saveAbility=ath|acr,saveDC=14'), true, [17], { label: 'Webbed', dc: 14, type: 'skill', skills: ['ath', 'acr'], kind: 'skill', key: 'ath', total: 24 }],
]) {
  thorin.effects = [effect]
  count = opened().length
  running = overTimeTurn(thorin, tokens.thorin, effect, { start })
  prompt = await nextPrompt(count)
  assert.deepEqual([prompt.type, prompt.source, prompt.label, prompt.dc], [expect.type, 'overtime', expect.label, expect.dc])
  if (expect.skills) assert.deepEqual([prompt.abilities, prompt.skills], [[], expect.skills])
  else assert.deepEqual(prompt.abilities, expect.abilities)
  made = await answer(prompt, { d20s, key: expect.key })
  workflow = await running
  const roll = midiSaves.processed.find(p => p.workflow === workflow).results[0][0]
  assert.deepEqual([made.command.kind, roll.total, workflow.saves.has(tokens.thorin)], [expect.kind, expect.total, true])
  assert.deepEqual(midiSaves.expired.at(-1), { actorId: 'thorin', effect: effect.name, reason: 'midi-qol:overTime' })
  assert.deepEqual(thorin.effects, [], "Midi's workflow removed the effect")
  const stamped = [...messages.values()].some(m => m.flags?.['midi-qol']?.overtimeActorUuid)
  assert.equal(stamped, false, 'nothing is stamped for an action save')
}
ok("OverTime turn saves are asked in the app: a save, an ability check and a skill check of two; Midi's own workflow then removes the effect on a success, and nothing is stamped as an action save")

// ---- Cards: Midi's own, and its OverTime action cards ----
const { midiActivities } = await import(`${MODULE}/scripts/command-uses.mjs`)
settings.set('ReplaceDefaultActivities', false)
assert.equal(midiActivities(), false)
count = opened().length
const blast = { id: 'blast', name: 'Burning Hands', img: 'b.webp', uuid: 'Actor.goblin.Item.blast' }
await saveCard({ by: goblin, item: blast, dc: 13, targets: [thorin], flags: { 'midi-qol': { messageType: 'attack' } } })
await settle()
assert.equal(opened().length, count, "Midi's workflow card asks no classic prompt")
await saveCard({ by: goblin, item: blast, dc: 13, targets: [thorin] })
await settle()
assert.equal(opened().length, count + 1, "dnd5e's own card, Midi's activities aside, still asks")
settings.delete('ReplaceDefaultActivities')
count = opened().length
await ChatMessage.create({
  author: 'gm', flavor: 'Action: Grappled Strength Saving Throw', speaker: ChatMessage.getSpeaker({ actor: thorin }), whisper: [],
  content: requestCardHtml([{ dataset: { type: 'save', ability: 'str', dc: 12, action: 'rollRequest', visibility: 'all', midiOvertimeActorUuid: thorin.uuid, midiRollMode: 'gm' }, buttonLabel: 'DC 12 STR', hiddenLabel: 'STR' }]),
})
await settle()
assert.equal(opened().length, count, "Midi's OverTime action card asks no one")
ok("a save card of Midi's workflow asks no classic prompt, even with Midi's activities off; nor does an OverTime action card")

// ---- An older app, and another Gamemaster's client ----
app.midi.delete('camp-a')
announce({ campaignId: 'camp-a' })
await settle(60)
workflow = await spell()
await passesThrough(workflow, await optionsFor(workflow), 'an app that no longer reads them')
app.midi.add('camp-a')
announce({ campaignId: 'camp-a' })
await settle(60)
gm.isActiveGM = false
checkBridge()
workflow = await spell()
await passesThrough(workflow, await optionsFor(workflow), 'not the bridge')
gm.isActiveGM = true
checkBridge()
await fetched()
ok("an app that says it no longer reads Midi's prompts is asked nothing, and a Gamemaster's client that isn't the bridge passes every save to Midi")

// ---- What Midi is given always settles ----
// Midi's own request failing, once left to it: the roll is null, never a rejection.
await game.settings.set('sending-stone', 'midiPromptWait', 1000)
midiSaves.rejectNext = true
const errorsBefore = midiSaves.errors.length
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
await running
assert.deepEqual([workflow.failedSaves.has(tokens.thorin), midiSaves.errors.length], [true, errorsBefore], 'taken as no roll')
// The answer's roll failing, held: Midi's own way.
await game.settings.set('sending-stone', 'midiPromptWait', 60_000)
count = opened().length
workflow = await spell()
running = runSaves(workflow)
prompt = await nextPrompt(count)
queuedBefore = midiSaves.queued.length
Hooks.once('dnd5e.preRollSavingThrowV2', config => { if (config.rolls?.[0]?.options?.sendingStone) throw new Error('A module broke the roll') })
made = await answer(prompt)
await running
assert.deepEqual([made.result.reason, closeOf(prompt.id)?.reason, midiSaves.queued.length], ['error', 'expired', queuedBefore + 1])
const settledIn = (promise, ms = 2000) => Promise.race([
  Promise.resolve(promise).then(() => 'resolved', () => 'rejected'),
  new Promise(resolve => realSetTimeout(() => resolve('pending'), ms)),
])
const outcomes = await Promise.all(given.map(async out => [await settledIn(out.promise), await settledIn(out.requestCard)]))
assert.ok(given.length > 25, `${given.length} saves`)
assert.ok(given.every(out => out?.promise && (typeof out.promise.then === 'function')), 'never a null promise')
const unsettled = outcomes.map((each, index) => [index, ...each]).filter(([, p, c]) => (p !== 'resolved') || (c !== 'resolved'))
if (process.env.DEBUG) console.log(unsettled, unsettled.map(([index]) => givenFor[index]))
assert.deepEqual(unsettled, [], 'every roll and card Midi was given settled, none rejected')
assert.deepEqual(midiSaves.errors, [])
ok(`the roll and the card Midi is given for each of ${given.length} saves always settle, the roll never rejected nor null: through an answer that fails and Midi's own request rejecting too`)

process.exit(0)
