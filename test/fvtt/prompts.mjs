// Saving throws the game asks players for, and their answers from the app: the real module, dnd5e
// 5.3.3's real dice classes, a stand-in Foundry core and dnd5e actor with dnd5e's concentration
// (challengeConcentration, rollConcentration, endConcentration, ported from its actor.mjs), the
// chat cards dnd5e posts for a save's activity and for a Gamemaster's request (as its templates
// render them), jsdom's HTML parser, and a stand-in app. MIDI=1 adds Midi-QOL: its settings, its
// concentration card and its concentration hook (ported from its Hooks.ts and patching.ts).
// Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
import { DND5E5 } from './paths.mjs'
const DND5E = `${DND5E5}/module/dice`
const ok = message => console.log('ok -', message)

// Foundry's hooks: callAll and call run their handlers at once, as Foundry's do.
const registry = new Map()
globalThis.Hooks = {
  on(name, fn) { if (!registry.has(name)) registry.set(name, []); registry.get(name).push(fn); return fn },
  once(name, fn) { return this.on(name, fn) },
  off(name, fn) { registry.set(name, (registry.get(name) ?? []).filter(f => f !== fn)) },
  call(name, ...args) {
    for (const fn of registry.get(name) ?? []) if (fn(...args) === false) return false
    return true
  },
  callAll(name, ...args) { return Promise.all((registry.get(name) ?? []).map(fn => fn(...args))).then(() => true) },
}

// The module's long waits, shortened a hundredfold: a prompt's ten minutes take six seconds.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)

// A browser's HTML parser, for the module to read dnd5e's cards with.
globalThis.DOMParser = new JSDOM('').window.DOMParser

const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll })
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex', concentration: 'con' },
}
globalThis.dnd5e = { settings: { rulesVersion: 'modern' } }
settings.set('messageMode', 'gm')
// dnd5e's default: players see the DC, and whether they saved, on their own cards and other players'.
settings.set('challengeVisibility', 'player')

const { Character, saveCard, requestCard, requestCardHtml, midiConcentrationCard, deleteMessage } = await import('./dnd5e-cards.mjs')

// Documents by uuid, as far as the cards name them.
globalThis.fromUuidSync = uuid => {
  const [type, id, embedded, embeddedId] = String(uuid).split('.')
  if (type !== 'Actor') return null
  const actor = actors.get(id) ?? null
  if (!embedded) return actor
  return (embedded === 'Item') ? (actor?.items?.get(embeddedId) ?? null) : null
}

// ---- Midi-QOL ----
const midiSettings = { autoCheckSaves: 'none', doConcentrationCheck: 'chatOnly', removeConcentration: true }
if (MIDI) {
  game.modules.set('midi-qol', { active: true })
  globalThis.MidiQOL = { configSettings: () => midiSettings }
  // Midi's concentration hook, from its Hooks.ts: a failed check ends concentration, when its
  // Gamemaster has it remove concentration.
  Hooks.on('dnd5e.rollConcentration', (rolls, { subject }) => {
    const failed = rolls.some(roll => roll.isFailure)
    if (midiSettings.doConcentrationCheck === 'item') return
    if (midiSettings.removeConcentration && failed) subject.endConcentration()
  })
}

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
user('carol', 'Carol')
user('dave', 'Dave')
const add = actor => { actors.set(actor.id, actor); return actor }
const thorin = add(new Character({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 4, dex: 1, wis: 2 } }))
alice.character = thorin
const vex = add(new Character({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3, int: 2 }, concentration: 'int' }))
bob.character = vex
const pip = add(new Character({ id: 'pip', name: 'Pip', owners: ['carol', 'dave'] }))
const stranger = add(new Character({ id: 'stranger', name: 'Stranger', owners: ['bob'] }))
const goblin = add(new Character({ id: 'goblin', name: 'Goblin Shaman' }))
const burningHands = { id: 'burning', name: 'Burning Hands', img: 'burning.webp', uuid: 'Actor.goblin.Item.burning' }
goblin.items.set('burning', burningHands)
const sleet = { id: 'sleet', name: 'Sleet Storm', img: 'sleet.webp', uuid: 'Actor.thorin.Item.sleet' }
thorin.items.set('sleet', sleet)

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), wake: null }
const json = body => ({
  ok: true, status: 200, statusText: 'OK',
  headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
})
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
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
let ids = 0
const queue = (campaignId, ...commands) => {
  app.waiting.set(campaignId, [...(app.waiting.get(campaignId) ?? []), ...commands])
  app.wake?.()
}
const results = () => app.events.filter(e => e.type === 'command.result')
const resultFor = id => results().find(e => e.data.id === id)
async function until(test, what, ms = 3000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
/** A player's save from the app, and what came of it. */
async function save(fields) {
  const asked = {
    id: `req-${++ids}`, actorId: 'thorin', kind: 'save', key: 'dex', mode: 0, explicit: false,
    extras: [], dice: [{ faces: 20, results: [14] }], ...fields,
  }
  queue('camp-a', asked)
  await until(() => resultFor(asked.id), `the result of ${asked.id}`)
  const result = resultFor(asked.id)
  const message = messages.get(result.data.messageId)
  return { asked, result: result.data, envelope: result, message, roll: message?.rolls[0] }
}
const sent = (type, campaignId = 'camp-a') => app.events.filter(e => (e.type === type) && (e.campaign?.id === campaignId))
const opened = (campaignId = 'camp-a') => sent('roll.prompt.opened', campaignId).map(e => e.data.prompt)
const closed = (campaignId = 'camp-a') => sent('roll.prompt.closed', campaignId).map(e => e.data)
const iso = ms => new Date(ms).toISOString()
const settle = () => new Promise(resolve => realSetTimeout(resolve, 20))

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret', 'camp-b': 'mirkwood-secret', 'camp-c': 'greyhaven-secret' })
const campaigns = [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'pip'], rolls: true, prompts: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'], rolls: true, prompts: false },
  { id: 'camp-c', title: 'Greyhaven', characters: ['thorin'], rolls: false, prompts: true },
]
settings.set('campaigns', campaigns)
await Hooks.callAll('ready')
await until(() => app.polls.length > 0, 'the first fetch')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)

const hellos = () => Object.fromEntries(app.events.filter(e => e.type === 'bridge.hello')
  .map(e => [e.campaign.title, { prompts: e.data.features.rolls.prompts, open: e.data.prompts }]))
assert.deepEqual(hellos(), {
  Ashlands: { prompts: true, open: [] },
  Mirkwood: { prompts: false, open: [] },
  Greyhaven: { prompts: false, open: [] },
})
ok("says in each campaign's hello whether its players are asked for their saves, only where its rolls are made here")

// ---- dnd5e's concentration check ----
thorin.concentrateOn('Bless')
let card = await thorin.challengeConcentration({ dc: 12 })
await settle()
let prompt = opened().at(-1)
const blessPrompt = `${card.id}-thorin`
assert.deepEqual(prompt, {
  id: blessPrompt, actorId: 'thorin', messageId: card.id, type: 'concentration', abilities: ['con'], dc: null,
  label: 'Bless', openedAt: iso(card.timestamp), expiresAt: iso(card.timestamp + 600_000),
})
assert.notEqual(sent('roll.prompt.opened').at(-1).sequence, null)
assert.deepEqual([opened('camp-b'), opened('camp-c')], [[], []])
ok("asks a concentrating character's player for the check dnd5e's card asks for, naming what they concentrate on, DC hidden as dnd5e hides a Gamemaster's")

let made = await save({ key: 'con', prompt: blessPrompt, dice: [{ faces: 20, results: [4] }] })
assert.equal(made.result.status, 'done')
assert.equal(made.roll.total, 7)
assert.deepEqual(made.roll.dice[0].results.map(r => r.result), [4])
assert.equal(made.roll.options.target, 12)
assert.equal(made.message.flags.dnd5e.originatingMessage, card.id)
assert.equal(made.message.flags.dnd5e.roll.type, 'save')
assert.deepEqual(made.message.flags['sending-stone'], { request: made.asked.id })
assert.equal(made.message.author.id, 'alice')
assert.equal(made.result.outcome, null)
assert.deepEqual(thorin.ended, ['Bless'])
assert.deepEqual(closed().at(-1), { id: blessPrompt, reason: 'answered' })
const order = app.events.map(e => (e.type === 'roll.prompt.closed') ? 'closed' : ((e.data?.id === made.asked.id) ? 'result' : null)).filter(Boolean)
assert.deepEqual(order.slice(-2), ['closed', 'result'])
ok(`rolls the check from the app with the player's d20, on the card, against its DC; failed, ends their concentration${MIDI ? ', through Midi' : ''}; and closes the prompt`)

made = await save({ key: 'con', prompt: blessPrompt })
// Its concentration ended, the card asks Thorin nothing more (module 0.29.0): gone, before answered.
assert.deepEqual([made.result.status, made.result.reason, made.result.error], ['failed', 'prompt', 'gone'])
ok('refuses a second answer to the same prompt')

settings.set('challengeVisibility', 'all')
thorin.concentrateOn('Hex')
card = await thorin.challengeConcentration({ dc: 10 })
await settle()
prompt = opened().at(-1)
assert.equal(prompt.dc, 10)
made = await save({ key: 'con', prompt: prompt.id, dice: [{ faces: 20, results: [15] }] })
assert.deepEqual([made.result.status, made.result.outcome, made.roll.total], ['done', 'success', 18])
assert.deepEqual(thorin.ended, ['Bless'])
assert.equal(thorin.concentration.effects.size, 1)
settings.set('challengeVisibility', 'player')
ok('shows the DC and whether they saved where dnd5e shows players; a check made keeps concentration')

// ---- A save's card ----
card = await saveCard({ by: goblin, item: burningHands, dc: 13, targets: [thorin, vex, stranger] })
await settle()
const burning = opened().slice(-2)
assert.deepEqual(burning.map(p => [p.id, p.type, p.abilities, p.dc, p.label]), [
  [`${card.id}-thorin`, 'save', ['dex'], null, 'Burning Hands'],
  [`${card.id}-vex`, 'save', ['dex'], null, 'Burning Hands'],
])
assert.deepEqual(opened('camp-b').length, 0)
ok("asks each targeted character's player for the save a spell's card calls for, in each campaign that asks, and no one else")

await vex.rollSavingThrow({ ability: 'dex', target: 13 }, { configure: false }, { data: { flags: { dnd5e: { originatingMessage: card.id } } } })
await settle()
assert.deepEqual(closed().at(-1), { id: `${card.id}-vex`, reason: 'rolled' })
made = await save({ actorId: 'vex', key: 'dex', prompt: `${card.id}-vex` })
assert.deepEqual([made.result.status, made.result.reason, made.result.error], ['failed', 'prompt', 'answered'])
ok('closes a prompt whose save is rolled from its card in Foundry, and refuses it from the app then')

made = await save({ key: 'str', prompt: `${card.id}-thorin` })
assert.deepEqual([made.result.status, made.result.reason, made.result.error], ['failed', 'prompt', 'ability'])
made = await save({ key: 'dex', prompt: `${card.id}-vex` })
assert.deepEqual([made.result.status, made.result.reason, made.result.error], ['failed', 'prompt', 'character'])
made = await save({ key: 'dex', prompt: `${card.id}-thorin`, dice: [{ faces: 20, results: [10] }] })
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 11, 13, null])
assert.equal(made.message.flags.dnd5e.originatingMessage, card.id)
assert.deepEqual(closed().at(-1), { id: `${card.id}-thorin`, reason: 'answered' })
ok("refuses an ability the card doesn't offer and another character's prompt; makes the save on the card")

// Module 0.31.0: with Hit/miss and save results in the app Always, the outcome is told though the
// card keeps its DC from players; the DC itself is never sent.
settings.set('chatResults', 'always')
card = await saveCard({ by: goblin, item: burningHands, dc: 13, targets: [thorin] })
await settle()
assert.equal(opened().at(-1).dc, null, 'no DC, Always or not')
made = await save({ key: 'dex', prompt: `${card.id}-thorin`, dice: [{ faces: 20, results: [10] }] })
assert.deepEqual([made.result.status, made.roll.total, made.result.outcome], ['done', 11, 'failure'])
assert.ok(!JSON.stringify(made.result).includes('"dc"'), JSON.stringify(made.result))
settings.delete('chatResults')
ok("with Hit/miss and save results in the app Always, a save answering a card that keeps its DC from players says whether it saved, and never the DC")

// The Gamemaster answers Thorin's from the app (module 0.23.0): made on the card as his player's,
// flagged the Gamemaster's, and the prompt closes as answered; his player's answer is then refused.
card = await saveCard({ by: goblin, item: burningHands, dc: 13, targets: [thorin] })
await settle()
made = await save({ key: 'dex', prompt: `${card.id}-thorin`, dice: [{ faces: 20, results: [10] }], by: 'gm' })
assert.deepEqual([made.result.status, made.roll.total, made.message.author.id], ['done', 11, 'alice'])
assert.deepEqual(made.message.flags['sending-stone'], { request: made.asked.id, by: 'gm' })
assert.equal(made.message.flags.dnd5e.originatingMessage, card.id)
assert.deepEqual(closed().at(-1), { id: `${card.id}-thorin`, reason: 'answered' })
made = await save({ key: 'dex', prompt: `${card.id}-thorin`, dice: [{ faces: 20, results: [10] }] })
assert.deepEqual([made.result.status, made.result.reason, made.result.error], ['failed', 'prompt', 'answered'])
ok("makes the Gamemaster's answer to a prompt on its card as the player's, flagged the Gamemaster's, closing it as answered")

card = await saveCard({ by: thorin, item: sleet, dc: 14, targets: [vex], author: 'alice' })
await settle()
assert.deepEqual([opened().at(-1).id, opened().at(-1).dc], [`${card.id}-vex`, 14])
made = await save({ actorId: 'vex', key: 'dex', prompt: `${card.id}-vex`, dice: [{ faces: 20, results: [5] }] })
assert.deepEqual([made.result.status, made.roll.total, made.result.outcome], ['done', 8, 'failure'])
ok("shows the DC, and the outcome, of another player's card, as dnd5e shows them")

const before = opened().length
card = await saveCard({ by: goblin, item: burningHands, dc: 13, targets: [thorin], whisper: ['gm'] })
await settle()
assert.equal(opened().length, before)
ok("asks no one for a save on a card its player can't read")

// ---- A request in chat ----
card = await requestCard({ abilities: ['dex', 'str'], dc: 15 })
await settle()
const requested = opened().slice(-3)
assert.deepEqual(requested.map(p => [p.actorId, p.type, p.abilities, p.dc, p.label]), [
  ['thorin', 'save', ['dex', 'str'], null, null],
  ['vex', 'save', ['dex', 'str'], null, null],
  ['pip', 'save', ['dex', 'str'], null, null],
])
const publicRequest = card
card = await requestCard({ abilities: ['wis'], dc: 12, whisper: ['bob'] })
await settle()
assert.deepEqual(opened().slice(-1).map(p => [p.actorId, p.abilities]), [['vex', ['wis']]])
const whispered = opened().length
await requestCard({ abilities: ['wis'], dc: 12, author: 'alice' })
await settle()
assert.equal(opened().length, whispered)
card = await requestCard({ type: 'concentration', dc: 10 })
await settle()
assert.deepEqual(opened().slice(-3).map(p => [p.actorId, p.type, p.abilities]), [
  ['thorin', 'concentration', ['con']], ['vex', 'concentration', ['int']], ['pip', 'concentration', ['con']],
])
made = await save({ actorId: 'vex', key: 'int', prompt: `${card.id}-vex`, dice: [{ faces: 20, results: [12] }] })
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target], ['done', 14, 10])
ok("asks every character whose player can read a Gamemaster's request, with each one's own concentration ability; not a player's")

// A Gamemaster's request for a check, as dnd5e's handlePostRequest makes it for [[/check
// skill=ath/acr dc=12]] and [[/check int]]: it asks the table, but prompts no one, as before.
const promptedBefore = opened().length
for (const buttons of [
  [{ type: 'skill', ability: 'str', skill: 'ath', dc: 12 }, { type: 'skill', ability: 'dex', skill: 'acr', dc: 12 }],
  [{ type: 'check', ability: 'int' }],
]) {
  await ChatMessage.create({
    author: 'gm', flavor: 'Roll Request', speaker: { actor: null, alias: 'Gamemaster' },
    content: requestCardHtml(buttons.map(dataset => ({
      dataset: { ...dataset, format: 'short', action: 'rollRequest', visibility: 'all' }, buttonLabel: dataset.ability, hiddenLabel: dataset.ability,
    }))),
  })
}
await settle()
assert.equal(opened().length, promptedBefore)
ok("prompts no one for a Gamemaster's request for a check")

// A request from a link whose author hid its DC: dnd5e shows it no one, under Show all too, but
// rolls against it, and shows whether they saved as Challenge Visibility has it.
settings.set('challengeVisibility', 'all')
const hiddenRequest = await requestCard({ abilities: ['dex'], dc: 16, hideDC: true })
await settle()
assert.deepEqual(opened().slice(-3).map(p => [p.actorId, p.dc]), [['thorin', null], ['vex', null], ['pip', null]])
made = await save({ actorId: 'vex', key: 'dex', prompt: `${hiddenRequest.id}-vex`, dice: [{ faces: 20, results: [14] }] })
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 17, 16, 'success'])
const shownRequest = await requestCard({ abilities: ['dex'], dc: 16 })
await settle()
assert.deepEqual(opened().slice(-3).map(p => [p.actorId, p.dc]), [['thorin', 16], ['vex', 16], ['pip', 16]])
settings.set('challengeVisibility', 'player')
await deleteMessage(hiddenRequest)
await deleteMessage(shownRequest)
await settle()
ok("a Gamemaster's request that hides its DC tells the app no DC, under Show all too, but is rolled against it, saying whether they saved, as dnd5e does")

// ---- Closing ----
await deleteMessage(publicRequest)
await settle()
assert.deepEqual(closed().slice(-3), ['thorin', 'vex', 'pip'].map(id => ({ id: `${publicRequest.id}-${id}`, reason: 'gone' })))
made = await save({ key: 'dex', prompt: `${publicRequest.id}-thorin` })
assert.deepEqual([made.result.reason, made.result.error], ['prompt', 'gone'])
ok("closes a deleted card's prompts, and refuses them then")

// A card from nearly ten minutes ago, so that its prompt runs out at once: its timestamp is the
// first time it reads the clock.
const realNow = Date.now
let early = true
Date.now = () => (early ? (early = false, realNow() - 600_000 + 300) : realNow())
card = await requestCard({ abilities: ['con'], dc: 11, whisper: ['alice'] })
Date.now = realNow
await settle()
const stale = `${card.id}-thorin`
assert.equal(opened().at(-1).id, stale)
await until(() => closed().some(c => c.id === stale), 'the prompt to run out')
assert.deepEqual(closed().find(c => c.id === stale), { id: stale, reason: 'expired' })
made = await save({ key: 'con', prompt: stale })
assert.deepEqual([made.result.reason, made.result.error], ['prompt', 'expired'])
ok('closes a prompt left ten minutes, and refuses it then')

// Since module 0.27.0 a check or skill check may answer a prompt, as Midi-QOL asks for them; a
// card's prompt is still a save's alone.
made = await save({ kind: 'tool', key: 'thief', prompt: blessPrompt })
assert.deepEqual([made.result.reason, made.result.error], ['invalid', 'prompt'])
made = await save({ kind: 'ability', key: 'con', prompt: blessPrompt })
// Bless ended, and Hex begun since its card, it asks Thorin nothing (module 0.29.0).
assert.deepEqual([made.result.reason, made.result.error], ['prompt', 'gone'])
card = await requestCard({ abilities: ['con'], dc: 10, whisper: ['alice'] })
await settle()
made = await save({ kind: 'ability', key: 'con', prompt: `${card.id}-thorin` })
assert.deepEqual([made.result.reason, made.result.error], ['prompt', 'ability'])
made = await save({ key: 'con', prompt: 'not a prompt' })
assert.deepEqual([made.result.reason, made.result.error], ['invalid', 'prompt'])
made = await save({ key: 'con', prompt: `${card.id}-thorin`, dice: [{ faces: 20, results: [18] }] })
assert.equal(made.result.status, 'done')
ok("refuses a prompt on anything but a save, an ability check or a skill check, and a card's prompt on anything but a save; and one that is no prompt")

// ---- Its hello ----
thorin.concentrateOn('Bless')
card = await thorin.challengeConcentration({ dc: 10 })
await settle()
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
announce({ campaignId: 'camp-a' })
await settle()
const shut = new Set(closed().map(c => c.id))
const stillOpen = opened().filter(p => !shut.has(p.id))
assert.deepEqual(stillOpen.map(p => [p.actorId, p.type]), [
  ['vex', 'save'], ['thorin', 'concentration'], ['pip', 'concentration'], ['thorin', 'concentration'],
])
assert.deepEqual(hellos().Ashlands.open.map(p => p.id), stillOpen.map(p => p.id))
// Read afresh, a concentration check names all the character concentrates on now.
assert.deepEqual(hellos().Ashlands.open.find(p => p.id === stillOpen[1].id).label, 'Hex, Bless')
ok("tells a campaign's hello the prompts still open, read from the chat log")

await game.settings.set('sending-stone', 'campaigns', campaigns.map(c => ({ ...c, prompts: false })))
await settle()
assert.deepEqual(hellos().Ashlands, { prompts: false, open: [] })
made = await save({ key: 'con', prompt: `${card.id}-thorin` })
assert.deepEqual([made.result.reason, made.result.error], ['prompt', 'off'])
const quiet = opened().length
await thorin.challengeConcentration({ dc: 10 })
await settle()
assert.equal(opened().length, quiet)
await game.settings.set('sending-stone', 'campaigns', campaigns)
await settle()
ok('turned off, a campaign asks no more, says no prompt is open, and refuses answers')

// ---- Midi-QOL ----
if (MIDI) {
  midiSettings.autoCheckSaves = 'allShow'
  let count = opened().length
  await saveCard({ by: goblin, item: burningHands, dc: 13, targets: [thorin] })
  await settle()
  assert.equal(opened().length, count)
  midiSettings.autoCheckSaves = 'none'
  card = await saveCard({ by: goblin, item: burningHands, dc: 13, targets: [thorin] })
  await settle()
  assert.equal(opened().at(-1).id, `${card.id}-thorin`)
  ok("leaves to Midi-QOL the saves it rolls itself; asks for those it leaves to the card's buttons")

  count = opened().length
  await midiConcentrationCard(thorin, 10)
  await settle()
  assert.equal(opened().length, count)
  ok("leaves Midi-QOL's own concentration card, which it rolls itself, to it")

  thorin.effects = []
  thorin.ended = []
  thorin.concentrateOn('Bane')
  card = await thorin.challengeConcentration({ dc: 15 })
  await settle()
  made = await save({ key: 'con', prompt: `${card.id}-thorin`, dice: [{ faces: 20, results: [2] }] })
  assert.equal(made.result.status, 'done')
  await settle()
  assert.deepEqual(thorin.ended, ['Bane'])
  midiSettings.removeConcentration = false
  thorin.concentrateOn('Bless')
  card = await thorin.challengeConcentration({ dc: 15 })
  await settle()
  made = await save({ key: 'con', prompt: `${card.id}-thorin`, dice: [{ faces: 20, results: [2] }] })
  await settle()
  assert.deepEqual([made.result.status, thorin.ended, thorin.concentration.effects.size], ['done', ['Bane'], 1])
  ok('with Midi-QOL, a failed check ends concentration once, as Midi does, and not where its Gamemaster keeps it')
}
process.exit(0)
