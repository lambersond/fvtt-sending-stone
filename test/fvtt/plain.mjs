// A plain roll of dice from the app's dice tray (module 0.44.0, the v0.44 plan's item 7): the hello's
// `"plainRoll"` among `features.rolls.kinds`, right after `"formula"`, wherever players' rolls are made,
// never among a companion's; the command's checks in their order, each refusal with nothing posted; the
// roll made by dnd5e's own BasicRoll.build with the player's dice, d100s and a number added or taken
// away among them, as the character's player, spoken by the character or, while she's shaped and the
// app takes Wild Shape, by her form, flavored "Dice roll"; its card as dnd5e 5 flags a generic roll, or
// with DND5E6=1 as dnd5e 6's own generic message; typed dice marked typed, the Gamemaster's marked GM;
// a hook that puts the player's dice out of reach refused "dice", one that calls it off "cancelled";
// "off" where the campaign's rolls are; and a command handed over twice made once. The real module and
// its language file; dnd5e 5.3.3's real dice classes, or 6.0.5's with DND5E6=1; dnd5e's actors ported
// (actor5e.mjs); with MIDI=1, midi-fake.mjs's Midi-QOL, which leaves a plain roll alone; with
// LIBWRAPPER=1, the dice wrapped through a stand-in libWrapper; a stand-in Foundry core and app.
// Timers of a second or more run a hundred times faster. Run with --import ./unref-timers.mjs
// --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'
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
const { window } = new JSDOM('', { pretendToBeVisual: true })
Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement })
if (DND5E6) game.system.version = '6.0.5'

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
  defaultAbilities: { initiative: 'dex' },
}
globalThis.dnd5e = { settings: { rulesVersion: 'modern' } }
settings.set('messageMode', 'gm') // The Gamemaster rolls privately; players' rolls are public all the same.

// The module's own words, from its language file, as Foundry's i18n gives them.
const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object')
  ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])
const words = Object.fromEntries(flat(JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))))
game.i18n.localize = key => words[key] ?? key
game.i18n.format = (key, data = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ''))

// libWrapper, when asked for: registers wrappers the way it would.
const wrapped = []
if (process.env.LIBWRAPPER) {
  globalThis.libWrapper = {
    register(pkg, target, fn, type) {
      wrapped.push({ pkg, target, type })
      const path = target.split('.')
      const owner = path.slice(0, -1).reduce((o, key) => o[key], globalThis)
      const original = owner[path.at(-1)]
      owner[path.at(-1)] = function (...args) { return fn.call(this, original.bind(this), ...args) }
    },
  }
  game.modules.set('lib-wrapper', { active: true })
}

const { Actor5e } = await import('./actor5e.mjs')
if (MIDI) {
  users.activeGM = user('gm', 'Gamemaster', true)
  users.get('gm').targets = new Set()
  const { installMidi } = await import('./midi-fake.mjs')
  installMidi()
}

// ---- The world: the Gamemaster, the bridge, and two players ----
users.activeGM ??= user('gm', 'Gamemaster', true)
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
const add = actor => { actors.set(actor.id, actor); return actor }
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], skills: { prc: { ability: 'wis' } } }))
thorin.documentName = 'Actor'
alice.character = thorin
const vex = add(new Actor5e({ id: 'vex', name: 'Vex', owners: ['bob'], skills: { prc: { ability: 'wis' } } }))
vex.documentName = 'Actor'
bob.character = vex

// ---- The app: commands and Wild Shape for Ashlands; Mirkwood's rolls off, fetched for its removals ----
const app = { events: [], waiting: new Map(), wake: null }
const FEATURES = { 'camp-a': { commands: true, wildShape: 1 }, 'camp-b': { commands: true, removals: 1 } }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const id = body.campaign?.id
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    return ['bridge.hello', 'bridge.heartbeat'].includes(body.type) ? json({ features: FEATURES[id] })
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
const resultsOf = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)

let ids = 0
/** A plain roll, as the app hands it over: 2d6 + 1d8 thrown as 3, 5 and 7, unless told otherwise. */
const plain = (fields = {}) => ({
  id: `plain-${++ids}`, actorId: 'thorin', kind: 'plainRoll',
  plainRoll: { terms: [{ faces: 6, count: 2 }, { faces: 8, count: 1 }] },
  mode: 0, explicit: false, extras: [], dice: [{ faces: 6, results: [3, 5] }, { faces: 8, results: [7] }], ...fields,
})
/** Hand the module a command, and what came of it: its result, and its message. */
async function made(command, campaignId = 'camp-a') {
  app.waiting.set(campaignId, [...(app.waiting.get(campaignId) ?? []), command])
  app.wake?.()
  await until(() => resultsOf(command.id).length, `the result of ${command.id}`)
  const [result] = resultsOf(command.id)
  return { result, message: messages.get(result.messageId) }
}
const refusal = ({ result }) => [result.status, result.reason, result.error]
const faces = roll => roll.dice.map(die => die.results.map(each => each.result))

// ---- Start-up, as Foundry would ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret', 'camp-b': 'mirkwood-secret' })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex'], rolls: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'], rolls: false },
])
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { markAppRoll } = await import(`${MODULE}/scripts/command-rolls.mjs`)
const { plainFormula } = await import(`${MODULE}/scripts/command-plain.mjs`)
await until(() => sent('bridge.hello').length && sent('bridge.hello', 'camp-b').length, 'the hellos')
await settle(80)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
if (process.env.LIBWRAPPER) assert.ok(wrapped.some(each => each.target === 'foundry.dice.terms.DiceTerm.prototype._roll'), 'the dice wrapped through libWrapper')

/* -------------------------------------------- */
/*  1. The hello                                */
/* -------------------------------------------- */

{
  const hello = sent('bridge.hello').at(-1).data.features
  const { kinds } = hello.rolls
  assert.equal(kinds.indexOf('plainRoll'), kinds.indexOf('formula') + 1, 'right after "formula"')
  assert.equal(kinds.filter(kind => kind === 'plainRoll').length, 1)
  assert.ok(!hello.companions.kinds.includes('plainRoll'), "never among a companion's kinds")
  const mirkwood = sent('bridge.hello', 'camp-b').at(-1).data.features.rolls
  assert.deepEqual([mirkwood.enabled, mirkwood.kinds, mirkwood.reason], [false, [], 'off'], 'none where rolls are off')
}
ok(`the hello: "plainRoll" among features.rolls.kinds right after "formula" wherever players' rolls are made, under dnd5e ${DND5E6 ? '6.0.5' : '5.3.3'}${MIDI ? ', Midi-QOL active' : ''}; never among features.companions.kinds; none where rolls are off`)

/* -------------------------------------------- */
/*  2. 2d6 + 1d8                                */
/* -------------------------------------------- */

{
  const mark = app.events.length
  const { result, message } = await made(plain())
  assert.deepEqual([result.status, result.reason, result.error, result.visible], ['done', null, null, true])
  assert.equal(result.messageId, message.id)
  assert.deepEqual(result.rolls.map(({ formula, total }) => [formula, total]), [['2d6 + 1d8', 15]], "Foundry's formula and total")
  assert.deepEqual(result.rolls[0].dice.map(die => [die.faces, die.results.map(each => each.result)]), [[6, [3, 5]], [8, [7]]], "the player's dice")
  const [roll] = message.rolls
  assert.deepEqual([roll.constructor.name, roll.formula, roll.total, faces(roll)], ['BasicRoll', '2d6 + 1d8', 15, [[3, 5], [7]]])
  assert.deepEqual([message.author.id, message.speaker.actor, message.speaker.alias, message.flavor], ['alice', 'thorin', 'Thorin', 'Dice roll'],
    "the player's, spoken by the character, flavored Dice roll")
  assert.deepEqual([message.whisper, message.blind], [[], false], 'for everyone to see, whatever the Gamemaster rolls')
  assert.deepEqual(message.flags['sending-stone'], { request: result.id })
  if (DND5E6) {
    assert.deepEqual([message.type, message.system], ['generic', { targets: [] }], "dnd5e 6's own generic message, naming no target")
    assert.equal(message.flags.dnd5e, undefined, "and none of dnd5e 5's roll flags, which dnd5e 6 migrates away")
  } else {
    assert.equal(message.type, 'base')
    assert.deepEqual(message.flags.dnd5e, { messageType: 'roll', roll: { type: 'generic' }, targets: [] }, "dnd5e 5's flags of a generic roll")
  }
  const chat = app.events.slice(mark).find(e => (e.type === 'chat.message.created') && (e.data.message.id === message.id))
  assert.ok(chat, 'its card in chat')
  assert.deepEqual([chat.data.message.character, chat.data.message.dnd5e?.messageType], ['thorin', DND5E6 ? 'generic' : 'roll'],
    "the campaign's character's, read as dnd5e's generic roll")
  assert.ok(app.events.indexOf(chat) < app.events.findIndex(e => (e.type === 'command.result') && (e.data.id === result.id)), 'ahead of the result')
}
ok(`2d6 + 1d8 thrown 3, 5 and 7: Foundry's 2d6 + 1d8 of 15 with the player's dice, as Alice, spoken by Thorin, flavored "Dice roll", public, flagged request; ${DND5E6 ? "dnd5e 6's generic message, type \"generic\" with no targets and no dnd5e 5 roll flags" : "dnd5e 5's generic roll flags, no targets"}; in chat as Thorin's, ahead of the result, done and visible with its roll`)

/* -------------------------------------------- */
/*  3. A number added, a d100, every size       */
/* -------------------------------------------- */

{
  const d20 = (bonus, value) => plain({ plainRoll: { terms: [{ faces: 20, count: 1 }], ...(bonus !== undefined && { bonus }) }, dice: [{ faces: 20, results: [value] }] })
  for (const [bonus, value, formula, total] of [[2, 14, '1d20 + 2', 16], [-1, 14, '1d20 - 1', 13], [0, 9, '1d20', 9], [null, 9, '1d20', 9], [100, 1, '1d20 + 100', 101], [-100, 20, '1d20 - 100', -80]]) {
    const { result, message } = await made(d20(bonus, value))
    assert.deepEqual([result.status, message.rolls[0].formula, message.rolls[0].total], ['done', formula, total], `a bonus of ${bonus}`)
  }
  const { result: hundred, message: centum } = await made(plain({ plainRoll: { terms: [{ faces: 100, count: 1 }] }, dice: [{ faces: 100, results: [73] }] }))
  assert.deepEqual([hundred.status, centum.rolls[0].formula, centum.rolls[0].total, faces(centum.rolls[0])], ['done', '1d100', 73, [[73]]], 'a d100 is one die of 100 faces')
  const SIZES = [4, 6, 8, 10, 12, 20, 100]
  const every = plain({ plainRoll: { terms: SIZES.map(size => ({ faces: size, count: 1 })), bonus: 3 }, dice: SIZES.map(size => ({ faces: size, results: [size] })) })
  const { result: all, message: allCard } = await made(every)
  assert.deepEqual([all.status, allCard.rolls[0].formula, allCard.rolls[0].total], ['done', '1d4 + 1d6 + 1d8 + 1d10 + 1d12 + 1d20 + 1d100 + 3', 163], 'every size at once, in the order sent')
  const twenty = plain({ plainRoll: { terms: [{ faces: 20, count: 12 }, { faces: 4, count: 8 }] }, dice: [{ faces: 20, results: Array(12).fill(10) }, { faces: 4, results: Array(8).fill(2) }] })
  const { result: most, message: mostCard } = await made(twenty)
  assert.deepEqual([most.status, mostCard.rolls[0].formula, mostCard.rolls[0].total], ['done', '12d20 + 8d4', 136], 'twenty dice, the most, the larger first as sent')
}
ok('a number added or taken away, 2, -1, 0, null, 100 and -100, in the formula and the total; a d100 made one die of 100 faces, "1d100"; all seven sizes at once with a bonus, in the order sent; and twenty dice, the most')

/* -------------------------------------------- */
/*  4. Refusals                                 */
/* -------------------------------------------- */

{
  const TERMS = [{ faces: 6, count: 2 }, { faces: 8, count: 1 }]
  const body = (plainRoll, dice = [{ faces: 6, results: [3, 5] }, { faces: 8, results: [7] }]) => ({ plainRoll, dice })
  const cases = [
    ['mode 1', { mode: 1 }, 'mode'],
    ['explicit', { explicit: true }, 'mode'],
    ['extras', { extras: [{ sign: 1, count: 1, sides: 4 }] }, 'extras'],
    ['no plainRoll', { plainRoll: undefined }, 'plainRoll'],
    ['plainRoll an array', { plainRoll: [] }, 'plainRoll'],
    ['empty terms', body({ terms: [] }, []), 'plainRoll'],
    ['eight terms', body({ terms: [4, 6, 8, 10, 12, 20, 100, 4].map(faces => ({ faces, count: 1 })) }), 'plainRoll'],
    ['a d3', body({ terms: [{ faces: 3, count: 1 }] }, [{ faces: 3, results: [2] }]), 'plainRoll'],
    ['a size twice', body({ terms: [{ faces: 6, count: 1 }, { faces: 6, count: 1 }] }), 'plainRoll'],
    ['count 0', body({ terms: [{ faces: 6, count: 0 }] }), 'plainRoll'],
    ['count 1.5', body({ terms: [{ faces: 6, count: 1.5 }] }), 'plainRoll'],
    ['21 dice', body({ terms: [{ faces: 6, count: 20 }, { faces: 8, count: 1 }] }), 'plainRoll'],
    ['bonus 101', body({ terms: TERMS, bonus: 101 }), 'plainRoll'],
    ['bonus 1.5', body({ terms: TERMS, bonus: 1.5 }), 'plainRoll'],
    ['bonus "2"', body({ terms: TERMS, bonus: '2' }), 'plainRoll'],
    ['an extra key in a term', body({ terms: [{ faces: 6, count: 2, sign: 1 }, { faces: 8, count: 1 }] }), 'plainRoll'],
    ['an extra key in the body', body({ terms: TERMS, label: 'Luck' }), 'plainRoll'],
    ["a description's text and link", { text: '0123456789abcd', link: 0 }, 'plainRoll'],
    ['a key', { key: 'prc' }, 'plainRoll'],
    ['a prompt', { prompt: 'card1-thorin' }, 'plainRoll'],
    ['a target', { target: { combatId: 'c', combatantId: 'x' } }, 'plainRoll'],
    ['a combat', { combatId: 'fight' }, 'plainRoll'],
    ['a denomination', { denomination: 'd6' }, 'plainRoll'],
    ['hit dice', { hitDice: [{ denomination: 'd6', count: 1 }] }, 'plainRoll'],
    ['a turn', { turn: { combatId: 'c', round: 1, combatantId: 'x' } }, 'plainRoll'],
    ['critical', { critical: true }, 'plainRoll'],
    ['an item and activity', { item: 'staff', activity: 'luck' }, 'item'],
    ['dice for one term', { dice: [{ faces: 6, results: [3, 5] }] }, 'dice'],
    ['dice of another size', { dice: [{ faces: 6, results: [3, 5] }, { faces: 10, results: [7] }] }, 'dice'],
    ['a wrong count of dice', { dice: [{ faces: 6, results: [3] }, { faces: 8, results: [7] }] }, 'dice'],
    ['a value its die cannot show', { dice: [{ faces: 6, results: [3, 7] }, { faces: 8, results: [7] }] }, 'dice'],
    ['dice in another order', { dice: [{ faces: 8, results: [7] }, { faces: 6, results: [3, 5] }] }, 'dice'],
    ['for a companion', { of: 'thorin', actorId: 'arena-wolf1' }, 'of'],
    ['effectDice', { effectDice: [{ faces: 4, sign: 1, results: [2] }] }, 'effectDice'],
    ['by anyone but the Gamemaster', { by: 'alice' }, 'by'],
  ]
  for (const [why, fields, error] of cases) {
    const before = messages.size
    const { result } = await made(plain(fields))
    assert.deepEqual(refusal({ result }), ['failed', 'invalid', error], why)
    assert.equal(messages.size, before, `${why}: nothing posted`)
  }
  // plainRoll on any other kind.
  for (const [kind, fields] of [['skill', { key: 'prc', dice: [{ faces: 20, results: [12] }] }], ['formula', { item: 'staff', activity: 'luck', dice: [] }]]) {
    const before = messages.size
    const { result } = await made({ ...plain(), kind, ...fields })
    assert.deepEqual(refusal({ result }), ['failed', 'invalid', 'plainRoll'], `on a ${kind}`)
    assert.equal(messages.size, before)
  }
  const stranger = await made(plain({ actorId: 'nobody' }))
  assert.deepEqual(refusal(stranger), ['failed', 'unknown', null], 'an actor not in the campaign')
  const before = messages.size
  const mirkwood = await made(plain({ actorId: 'vex' }), 'camp-b')
  assert.deepEqual([...refusal(mirkwood), messages.size], ['failed', 'off', null, before], "fetched where the campaign's rolls are off: \"off\", nothing posted")
}
ok('refused with nothing posted: "mode" for advantage or explicit, "extras", "plainRoll" for a body missing, malformed or with keys it has not (no terms, eight, a d3, a size twice, counts of 0 or 1.5, 21 dice, bonus 101, 1.5 or "2"), for what a roll names (a text and link, never made as a linked check; a key, prompt, target, combat, denomination, hit dice, turn, critical) and for plainRoll on a skill or formula; "item"; "dice" where they are not one entry per term of its size and count, in order; "of" for a companion; "effectDice"; "by"; "unknown"; and "off" where rolls are off')

/* -------------------------------------------- */
/*  5. Typed, and the Gamemaster's              */
/* -------------------------------------------- */

{
  const html = () => {
    const card = document.createElement('li')
    card.innerHTML = '<header class="message-header"><span class="message-metadata"></span></header>'
    return card
  }
  const typed = await made(plain({ typed: true, rerolls: 'kept' }))
  assert.deepEqual([typed.result.status, typed.message.flags['sending-stone'], typed.message.author.id], ['done', { request: typed.result.id, typed: true }, 'alice'])
  assert.deepEqual(faces(typed.message.rolls[0]), [[3, 5], [7]], 'its dice the values typed')
  const typedCard = html()
  markAppRoll(typed.message, typedCard)
  assert.ok(typedCard.querySelector('.sending-stone-badge.sending-stone-typed .fa-keyboard'), 'the keyboard badge')
  const gm = await made(plain({ by: 'gm', typed: true }))
  assert.deepEqual([gm.result.status, gm.message.flags['sending-stone'], gm.message.author.id, gm.message.speaker.actor],
    ['done', { request: gm.result.id, by: 'gm' }, 'alice', 'thorin'], "the Gamemaster's: as the player, marked by: gm, never typed")
  assert.deepEqual(gm.result.messages, [gm.message.id], 'its messages listed')
  const gmCard = html()
  markAppRoll(gm.message, gmCard)
  assert.equal(gmCard.querySelector('.sending-stone-badge.sending-stone-gm')?.textContent, 'GM', 'marked GM')
}
ok('typed dice: made with the values typed, flagged typed, marked with the keyboard, rerolls "kept" changing nothing; the Gamemaster\'s from the app as the character: made as the player, spoken by the character, flagged by: gm and never typed, marked GM, its message listed in the result')

/* -------------------------------------------- */
/*  6. Wild Shape                               */
/* -------------------------------------------- */

{
  // Thorin shaped into a wolf, as dnd5e makes a form of him: Alice's too, flagged his.
  const wolf = add(new Actor5e({ id: 'thorinWolf000000', name: 'Thorin (Wolf)', owners: ['alice'], flags: { isPolymorphed: true, originalActor: 'thorin', previousActorIds: [] } }))
  wolf.documentName = 'Actor'
  const mark = app.events.length
  const { result, message } = await made(plain())
  assert.deepEqual([result.status, message.speaker.actor, message.speaker.alias, message.author.id], ['done', wolf.id, 'Thorin (Wolf)', 'alice'],
    'spoken by her form, as the player')
  const chat = app.events.slice(mark).find(e => (e.type === 'chat.message.created') && (e.data.message.id === message.id))
  assert.equal(chat?.data.message.character, 'thorin', "chat reads the form's card as the character's")
  actors.delete(wolf.id)
}
ok("while shaped, for an app that takes Wild Shape: spoken by the form, as the player, its card the character's in chat")

/* -------------------------------------------- */
/*  7. Hooks                                    */
/* -------------------------------------------- */

{
  let before = messages.size
  const reach = Hooks.on('dnd5e.preRollV2', config => { config.rolls[0].parts = ['max(2d6, 1d8)'] })
  const outOfReach = await made(plain())
  Hooks.off('dnd5e.preRollV2', reach)
  assert.deepEqual([...refusal(outOfReach), messages.size], ['failed', 'dice', null, before], "a module's rewrite that puts the dice out of reach: \"dice\", nothing posted")
  before = messages.size
  const stop = Hooks.on('dnd5e.preRollV2', () => false)
  const stopped = await made(plain())
  Hooks.off('dnd5e.preRollV2', stop)
  assert.deepEqual([...refusal(stopped), messages.size], ['failed', 'cancelled', null, before], 'one a hook calls off: "cancelled"')
  const fine = await made(plain())
  assert.equal(fine.result.status, 'done', 'made again once the hooks are gone')
}
ok('a hook that rewrites the roll so the player\'s dice can\'t reach it, inside a function, is refused "dice", and one that returns false "cancelled", each with nothing posted')

/* -------------------------------------------- */
/*  8. Once                                     */
/* -------------------------------------------- */

{
  const before = messages.size
  const twice = plain()
  app.waiting.set('camp-a', [twice, twice])
  app.wake?.()
  await until(() => resultsOf(twice.id).length, 'the result')
  await settle(80)
  app.waiting.set('camp-a', [twice])
  app.wake?.()
  await settle(120)
  assert.deepEqual([resultsOf(twice.id).length, messages.size - before], [1, 1], 'handed over three times, made and told once')
}
ok('a plain roll handed over again is made and told once')

/* -------------------------------------------- */
/*  9. The formula                              */
/* -------------------------------------------- */

for (const [plainRoll, formula] of [
  [{ terms: [{ faces: 6, count: 2 }, { faces: 8, count: 1 }] }, '2d6 + 1d8'],
  [{ terms: [{ faces: 20, count: 1 }], bonus: 2 }, '1d20 + 2'],
  [{ terms: [{ faces: 20, count: 1 }], bonus: -1 }, '1d20 - 1'],
  [{ terms: [{ faces: 100, count: 1 }], bonus: 0 }, '1d100'],
  [{ terms: [{ faces: 4, count: 3 }], bonus: null }, '3d4'],
]) assert.equal(plainFormula(plainRoll), formula)
ok('plainFormula: each size\'s dice in order, then " + n" or " - n", none for 0 or null, a d100 as "1d100"')

assert.ok(oks >= 9)
process.exit(0)
