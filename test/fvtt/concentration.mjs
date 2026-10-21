// Ending a concentration from the app (module 0.29.0): the sheet's `concentration`, the
// endConcentration command, its refusals, and the concentration checks dnd5e's cards ask, which
// close once the character no longer concentrates on what they asked about. The real module,
// dnd5e 5.3.3's real dice classes, a stand-in Foundry core and dnd5e actor with dnd5e's
// concentration ported from its actor.mjs and active-effect.mjs (dnd5e-cards.mjs), and a stand-in
// app. MIDI=1 adds the Midi-QOL stand-ins: its concentration card in "chat" mode, held for the app,
// which ending a concentration leaves to Midi's own way. Run with --import ./unref-timers.mjs
// --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
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

// The module's long waits, shortened a hundredfold.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
globalThis.document ??= { hidden: false }
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
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex', concentration: 'con' },
}
CONFIG.specialStatusEffects = { CONCENTRATING: 'concentrating' }
// dnd5e 5.3.3's words for a concentration whose item can't be found; dnd5e 6 has its own key.
const translations = { 'DND5E.ConcentratingItemless': 'Concentration With No Source' }
game.i18n.localize = key => translations[key] ?? key
game.i18n.has = key => Object.hasOwn(translations, key)
globalThis.dnd5e = { settings: { rulesVersion: 'modern' } }
settings.set('messageMode', 'gm')
settings.set('challengeVisibility', 'player')

const { Actor5e } = await import('./actor5e.mjs')
const { Character, ConcentrationEffect, requestCard } = await import('./dnd5e-cards.mjs')
globalThis.fromUuidSync = uuid => {
  const [type, id] = String(uuid).split('.')
  return (type === 'Actor') ? (actors.get(id) ?? null) : null
}

// ---- Midi-QOL ----
let midi, midiSaves
if (MIDI) {
  const fake = await import('./midi-fake.mjs')
  ;({ midi } = fake)
  fake.installMidi()
  game.modules.set('midi-qol', { active: true, version: '13.0.60' })
  const saves = await import('./midi-saves.mjs')
  ;({ midiSaves } = saves)
  saves.installMidiSaves({ actorClasses: [Actor5e], concentrationClass: Character })
  // dnd5e's own concentration card, its check left to the player, until the Midi case below.
  Object.assign(midi.settings, { autoCheckSaves: 'none', doConcentrationCheck: 'chatOnly', removeConcentration: true })
}

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').active = true
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
alice.active = false
bob.active = false
const add = actor => { actors.set(actor.id, actor); return actor }
const thorin = add(new Character({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { con: 2 } }))
alice.character = thorin
const vex = add(new Character({ id: 'vex', name: 'Vex', owners: ['bob'] }))
bob.character = vex
const stranger = add(new Character({ id: 'stranger', name: 'Stranger', owners: ['bob'] }))

// Who ends a concentration, and how: dnd5e's endConcentration, by what it's given; and any delete
// of a concentration effect made outside it.
const ends = []
const outside = []
let ending = 0
const realEnd = Character.prototype.endConcentration
Character.prototype.endConcentration = async function (target) {
  ends.push([this.id, target])
  ending++
  try { return await realEnd.call(this, target) } finally { ending-- }
}
const realDelete = ConcentrationEffect.prototype.delete
ConcentrationEffect.prototype.delete = function () {
  if (!ending) outside.push(this.id)
  return realDelete.call(this)
}

// ---- The app ----
const app = { events: [], waiting: new Map(), wake: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const id = body.campaign?.id
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    return announcing
      ? json({ features: { commands: true, ...(MIDI && { midiPrompts: 1 }) } })
      : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    if (!app.waiting.get(id)?.length) {
      await new Promise(resolve => {
        const timer = realSetTimeout(resolve, 30)
        app.wake = () => { clearTimeout(timer); resolve() }
        init.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    const commands = app.waiting.get(id) ?? []
    app.waiting.set(id, [])
    return json({ commands, open: ['thorin', 'vex'] })
  }
  throw new TypeError(`Unexpected fetch of ${url}`)
}
let ids = 0
const queue = (...commands) => {
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), ...commands])
  app.wake?.()
}
const resultIndex = id => app.events.findIndex(e => (e.type === 'command.result') && (e.data.id === id))
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
const settle = (ms = 20) => new Promise(resolve => realSetTimeout(resolve, ms))
/** The player's end of a concentration, as the app sends it, and what came of it. */
async function end(effect, fields = {}) {
  const command = {
    id: `end-${++ids}`, actorId: 'thorin', kind: 'endConcentration', concentration: { effect },
    mode: 0, explicit: false, extras: [], dice: [], ...fields,
  }
  const from = app.events.length
  queue(command)
  await until(() => resultIndex(command.id) >= 0, `the result of ${command.id}`)
  const index = resultIndex(command.id)
  return { command, result: app.events[index].data, after: app.events.slice(from, index) }
}
const refusal = ({ result }) => [result.status, result.reason, result.error]
const sent = type => app.events.filter(e => (e.type === type) && (e.campaign?.id === 'camp-a'))
const opened = () => sent('roll.prompt.opened').map(e => e.data.prompt)
const closed = () => sent('roll.prompt.closed').map(e => e.data)
const closeOf = id => closed().find(c => c.id === id)
const ids_ = actor => [...actor.concentration.effects].map(effect => effect.id)
const startAfresh = actor => { actor.effects.length = 0 }

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
// The campaign's players may roll in the app, and are asked for their saves, but may not attack.
const campaigns = [{ id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex'], rolls: true, attacks: false, prompts: true }]
settings.set('campaigns', campaigns)
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
await until(() => app.events.some(e => e.type === 'bridge.hello'), 'the hello')
await settle(60)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const { runEndConcentrationCommand } = await import(`${MODULE}/scripts/command-concentration.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const hello = () => sent('bridge.hello').at(-1).data

const kinds = hello().features.rolls.kinds
assert.ok(kinds.includes('endConcentration'), kinds.join())
assert.deepEqual(['attack', 'use', 'endEnchantment', 'spend', 'inspiration'].filter(kind => kinds.includes(kind)), [])
ok("the hello offers ending a concentration wherever players' rolls are made, though they may not attack; not spending charges or Heroic Inspiration, which need attacks")

// ---- The sheet ----
const bless = thorin.concentrateOn('Bless')
// A scroll, spent to cast Hold Person, not yet identified: dnd5e keeps its source, true name and
// all, on the effect, and prepares a copy of it under its unidentified name.
const scroll = thorin.concentrateOn('Unidentified Scroll', {
  id: 'scroll', data: { _id: 'scroll', name: 'Spell Scroll: Hold Person', system: { identified: false, unidentified: { name: 'Unidentified Scroll' } } },
})
const sourceless = new ConcentrationEffect(thorin, { name: 'Something' })
sourceless.flags.dnd5e.item = undefined
thorin.effects.push(sourceless)
assert.deepEqual(characterSheet(thorin).concentration, {
  effects: [
    { id: bless.id, name: 'Bless', item: 'bless' },
    { id: scroll.id, name: 'Unidentified Scroll', item: null },
    { id: sourceless.id, name: 'Concentration With No Source', item: null },
  ],
})
thorin.system.attributes.concentration.limit = 0
assert.deepEqual(characterSheet(thorin).concentration, { effects: [] })
thorin.system.attributes.concentration.limit = 1
assert.deepEqual(characterSheet(vex).concentration, { effects: [] })
ok("the sheet lists each concentration by the effect's id, named as dnd5e prepares its item, a spent scroll by its unidentified name and no item, never the source's true name; one with no item as dnd5e names it; none at limit 0, nor where there's none")

// ---- Ending one of three ----
let made = await end(scroll.id)
assert.deepEqual(made.result, { id: made.command.id, status: 'done', reason: null, error: null, messageId: null, visible: true, rolls: [] })
assert.deepEqual(ends, [['thorin', scroll.id]])
assert.deepEqual(outside, [])
assert.deepEqual(ids_(thorin), [bless.id, sourceless.id])
const sheetsAfter = made.after.filter(e => (e.type === 'character.updated') && (e.data.character.id === 'thorin'))
assert.ok(sheetsAfter.length >= 1, 'the sheet is posted before the result')
assert.deepEqual(sheetsAfter[0].data.character.sheet.concentration.effects.map(e => e.id), [bless.id, sourceless.id])
assert.ok(!made.after.some(e => e.type === 'chat.message.created'), 'no chat message')
ok("ends the one concentration asked, through dnd5e's endConcentration with its id, never deleting the effect itself; the others stay; done with no message, though the campaign doesn't let its players attack; the sheet goes before the result")

// ---- Refusals ----
const before = [ends.length, ids_(thorin)]
made = await end(scroll.id)
assert.deepEqual(refusal(made), ['failed', 'concentration', null])
const blessed = { id: 'blessed000000001', name: 'Blessed', statuses: new Set(['blessed']), getFlag: () => undefined, _stats: { createdTime: 0 } }
thorin.effects.push(blessed)
made = await end(blessed.id)
assert.deepEqual(refusal(made), ['failed', 'concentration', null])
thorin.effects.splice(thorin.effects.indexOf(blessed), 1)
assert.deepEqual([ends.length, ids_(thorin)], before)
ok('refuses a concentration that has ended, and an effect that is none, before asking dnd5e')

const keep = Hooks.on('dnd5e.preEndConcentration', () => false)
made = await end(bless.id)
Hooks.off('dnd5e.preEndConcentration', keep)
assert.deepEqual(refusal(made), ['failed', 'cancelled', null])
assert.deepEqual(ids_(thorin), [bless.id, sourceless.id])
ok("refuses as cancelled one a module's preEndConcentration hook keeps, which stays")

for (const [fields, error] of [
  [{ by: 'gm' }, 'by'],
  [{ by: 'player' }, 'by'],
  [{ concentration: undefined }, 'concentration'],
  [{ concentration: { effect: '' } }, 'concentration'],
  [{ concentration: [bless.id] }, 'concentration'],
  [{ item: 'bless' }, 'concentration'],
  [{ targets: [] }, 'concentration'],
  [{ prompt: 'card-thorin' }, 'concentration'],
  [{ mode: 1 }, 'dice'],
  [{ explicit: true }, 'dice'],
  [{ dice: [{ faces: 20, results: [10] }] }, 'dice'],
  [{ extras: [{ sign: 1, flat: 1 }] }, 'dice'],
]) {
  made = await end(bless.id, fields)
  assert.deepEqual(refusal(made), ['failed', 'invalid', error], JSON.stringify(fields))
}
assert.deepEqual(ids_(thorin), [bless.id, sourceless.id])
ok("refuses the Gamemaster's end, which would leave no mark of theirs, and one that names anything else, or throws dice")

made = await end(bless.id, { actorId: 'stranger' })
assert.deepEqual(refusal(made), ['failed', 'unknown', null])
diceStatus.ready = false
made = await end(bless.id)
diceStatus.ready = true
assert.deepEqual(refusal(made), ['failed', 'off', null])
const [ashlands] = getCampaigns()
const direct = await runEndConcentrationCommand({ ...made.command, id: 'direct' }, { ...ashlands, rolls: false })
assert.deepEqual([direct.status, direct.reason], ['failed', 'off'])
assert.deepEqual(ids_(thorin), [bless.id, sourceless.id])
ok("refuses a character not in the campaign, and an end where players' rolls aren't made, or the dice aren't ready")

// ---- dnd5e's concentration card ----
startAfresh(thorin)
let effect = thorin.concentrateOn('Bless')
let card = await thorin.challengeConcentration({ dc: 12 })
await settle()
const first = `${card.id}-thorin`
assert.equal(opened().at(-1)?.id, first)
// As if another client deleted it: Foundry's deletion hook, with no command.
await effect.delete()
await settle()
assert.deepEqual(closeOf(first), { id: first, reason: 'gone' })
announce({ campaignId: 'camp-a' })
await settle(60)
assert.ok(!hello().prompts.some(p => p.id === first))
const answer = async (prompt, d20 = 15) => {
  const command = {
    id: `ans-${++ids}`, actorId: 'thorin', kind: 'save', key: 'con', prompt, mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [d20] }],
  }
  queue(command)
  await until(() => resultIndex(command.id) >= 0, `the result of ${command.id}`)
  return { result: app.events[resultIndex(command.id)].data }
}
assert.deepEqual(refusal(await answer(first)), ['failed', 'prompt', 'gone'])
ok("a concentration card's prompt closes as gone once its last concentration is deleted, by any client; the hello leaves it out after, and an answer is refused")

// Concentrating on something new since the card asks nothing of the card.
thorin.concentrateOn('Hex', { createdTime: card._stats.createdTime + 1000 })
const openedBefore = opened().length
announce({ campaignId: 'camp-a' })
await settle(60)
assert.ok(!hello().prompts.some(p => p.id === first))
assert.deepEqual(refusal(await answer(first)), ['failed', 'prompt', 'gone'])
assert.equal(opened().length, openedBefore)
ok("concentrating on something new after the card doesn't bring its prompt back, in a hello or to answer")

// Two concentrations the card asked about: ending one leaves it open; ending the other closes it.
startAfresh(thorin)
const shield = thorin.concentrateOn('Shield of Faith')
effect = thorin.concentrateOn('Bless')
card = await thorin.challengeConcentration({ dc: 12 })
await settle()
const second = `${card.id}-thorin`
assert.equal(opened().at(-1)?.id, second)
// A Gamemaster's request for a concentration check, which asks it of everyone, whatever they concentrate on.
const request = await requestCard({ type: 'concentration', dc: 10 })
await settle()
const requested = `${request.id}-thorin`
assert.ok(opened().some(p => p.id === requested))
made = await end(effect.id)
assert.equal(made.result.status, 'done')
await settle()
assert.equal(closeOf(second), undefined)
announce({ campaignId: 'camp-a' })
await settle(60)
assert.ok(hello().prompts.some(p => p.id === second))
made = await end(shield.id)
await settle()
assert.deepEqual(closeOf(second), { id: second, reason: 'gone' })
assert.equal(closeOf(requested), undefined)
ok("with two concentrations, ending one from the app leaves the card's prompt open; ending the other closes it as gone; a Gamemaster's request stays open")

// ---- Midi-QOL's own concentration card ----
if (MIDI) {
  midi.settings.doConcentrationCheck = 'chat'
  startAfresh(thorin)
  effect = thorin.concentrateOn('Bless')
  const count = opened().length
  const rolls = midiSaves.concentrationRolls.length
  const sockets = midiSaves.sockets.length
  card = await thorin.challengeConcentration({ dc: 12 })
  await until(() => opened().length > count, "Midi's prompt")
  const prompt = opened()[count]
  assert.deepEqual([prompt.type, prompt.source, card.flags['sending-stone']?.midiHeld], ['concentration', 'concentration', true])
  made = await end(effect.id)
  assert.equal(made.result.status, 'done')
  await settle(60)
  assert.equal(closeOf(prompt.id), undefined, "Midi's prompt isn't closed or released")
  assert.equal(card.flags['sending-stone']?.midiDone, undefined, "nor marked done")
  assert.deepEqual([midiSaves.concentrationRolls.length, midiSaves.sockets.length], [rolls, sockets], "nor rolled as Midi would")
  announce({ campaignId: 'camp-a' })
  await settle(60)
  assert.ok(hello().prompts.some(p => p.id === prompt.id), 'still open in the hello')
  midi.settings.doConcentrationCheck = 'chatOnly'
  ok("Midi-QOL's own concentration card held for the app is left as it is when the concentration ends: not closed, released or rolled")
}

console.log(`${MIDI ? 'midi' : 'dnd5e'}: done`)
process.exit(0)
