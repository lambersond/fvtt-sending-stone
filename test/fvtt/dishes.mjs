// Dishes from the Magical Recipe Book (module 0.38.0, its contract D§3, D§8.2): the hello's
// `features.dishes`, after `favorites`, by the campaign's own switch under dnd5e 5; the fetching it
// needs with every other switch off; the `dish` command handed over until answered, posted once as a
// card whispered to the Gamemasters; its checks; the card's words and buttons; the dialog's content;
// each character's Active Effect, its changes on dnd5e 5.3.3's paths, its one-offs, one dish at a
// time; the app told in `dish.applied` and `dish.dismissed`, again after a temporary drop, after a
// hello, each campaign its own, and after a heartbeat that starts the app reading them; a card
// deleted kept as a tombstone, decided or not, its write held as a server's answer; enricher syntax
// made inert; two Gamemasters; the long rest; and the expiry sweep. With
// DND5E6=1, dnd5e 6.0.5: off, and a 5.x dish effect still ends. The real module and its language
// file; dnd5e 5.3.3's real dice classes for the self-test; a stand-in Foundry core and app; the
// characters dnd5e-cards.mjs's, given dishes by dish-core.mjs. Timers of a second or more run a
// hundred times faster, and the clock may be moved on. Run with SLIM_CHECK=1 and --import
// ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
import { DND5E5 } from './paths.mjs'
const DICE = `${DND5E5}/module/dice`
const ok = message => console.log('ok -', message)

// ---- The clock: real, but movable forward, as `later(ms)` moves it. ----
const RealDate = Date
let offset = 0
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + offset) }
  static now() { return RealDate.now() + offset }
}
const later = ms => { offset += ms }

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
// The heartbeat's own timer is left off: this run sends heartbeats, and resends what was lost, itself.
const realSetInterval = globalThis.setInterval
globalThis.setInterval = (fn, ...args) => ((fn?.name === 'heartbeat') ? { unref() {}, ref() {} } : realSetInterval(fn, ...args))
// Foundry's debounce, a tenth as long, so that a burst still goes as one.
foundry.utils.debounce = (fn, ms) => {
  let timer
  return (...args) => { clearTimeout(timer); timer = realSetTimeout(() => fn(...args), Math.max(1, ms / 10)) }
}
const { window } = new JSDOM('', { pretendToBeVisual: true })
Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement })
if (DND5E6) game.system.version = '6.0.5'

const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DICE}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DICE}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DICE}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DICE}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DICE}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = { tools: {}, defaultAbilities: { initiative: 'dex', concentration: 'con' } }
CONFIG.specialStatusEffects = { CONCENTRATING: 'concentrating' }
globalThis.dnd5e = { settings: { rulesVersion: 'modern' } }
globalThis.fromUuidSync = () => null
settings.set('messageMode', 'public')
settings.set('challengeVisibility', 'player')

// The module's own words, from its language file, as Foundry's i18n gives them.
const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object')
  ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])
const words = Object.fromEntries(flat(JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))))
game.i18n.localize = key => words[key] ?? key
game.i18n.has = key => Object.hasOwn(words, key)
game.i18n.format = (key, data = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ''))
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return html } } }
const notices = []
ui.notifications.error = (message, options) => notices.push({ message, options })
ui.notifications.info = () => {}

const core = await import('./dish-core.mjs')
const { withDishes, dishPort, holdCreate, setWorldTime, renderCard, deleteCards, restCompleted, created } = core
core.installDishCore()

// ---- The world: two Gamemasters, the first the bridge, and two players ----
users.activeGM = user('gm', 'Gamemaster', true)
const gm = users.get('gm')
const gm2 = user('gm2', 'Second Gamemaster', true)
gm2.isActiveGM = false
user('alice', 'Alice')
user('bob', 'Bob')
const { Character } = await import('./dnd5e-cards.mjs')
const SKILLS = { prc: { ability: 'wis' }, ste: { ability: 'dex' }, ath: { ability: 'str' } }
const add = (data, dishes) => {
  const actor = new Character({ skills: SKILLS, ...data })
  actor.img = `icons/${data.id}.webp`
  actors.set(actor.id, actor)
  withDishes(actor, dishes)
  return actor
}
const thorin = add({ id: 'thorin', name: 'Thorin Oakenshield', owners: ['alice'] }, { hp: { value: 30, max: 40 } })
const vex = add({ id: 'vex', name: 'Vex', owners: ['bob'] }, { hp: { value: 20, max: 40 }, senses: { units: 'm', ranges: {} } })
const bree = add({ id: 'bree', name: 'Bree', owners: ['alice'] }, { hp: { value: 30, max: 30 }, ci: ['exhaustion'] })
/** Who's this client's user while `fn` runs: as another Gamemaster's client would be. */
function asUser(who, fn) {
  const was = Object.getOwnPropertyDescriptor(game, 'user')
  Object.defineProperty(game, 'user', { configurable: true, get: () => who })
  try { return fn() } finally { Object.defineProperty(game, 'user', was) }
}

// ---- The app: it says it takes dishes, unless told to say otherwise for a campaign ----
const app = { events: [], polls: [], failed: [], waiting: new Map(), wake: null, features: new Map(), failing: null, refusing: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const id = body.campaign?.id
  if (String(url).endsWith('/api/events')) {
    if (app.failing?.(body)) {
      app.failed.push(body)
      return { ok: false, status: 503, statusText: 'Service Unavailable', headers: new Headers() }
    }
    if (app.refusing?.(body)) {
      app.failed.push(body)
      return { ok: false, status: 400, statusText: 'Bad Request', headers: new Headers() }
    }
    app.events.push(body)
    return ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
      ? json({ features: app.features.get(id) ?? { commands: true, dishes: 1 } })
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
const queue = (...commands) => {
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), ...commands])
  app.wake?.()
}
const results = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
const sent = (type, id = 'camp-a') => app.events.filter(e => (e.type === type) && (e.campaign?.id === id))
const dishEvents = (card, since = 0) => app.events.slice(since).filter(e => e.type.startsWith('dish.') && (e.data.card === card))
const helloOf = (id = 'camp-a') => sent('bridge.hello', id).at(-1).data
async function until(test, what, ms = 4000) {
  const end = RealDate.now() + ms
  while (!test()) {
    if (RealDate.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
const settle = (ms = 30) => new Promise(resolve => realSetTimeout(resolve, ms))
/** Wait until nothing more reaches the app for a while: what was queued has all gone. */
async function quiet() {
  let seen
  do { seen = app.events.length; await settle(40) } while (app.events.length !== seen)
}

// ---- Dishes, as the cookbook builds them (DOC-M:944-957), each its own id ----
let fixtures = 0
const cuid = () => `cmh${String(++fixtures).padStart(22, '0')}`
function body({ recipe, outcome = 'boon', status = outcome, message = 'A dish to remember.', ingredients, changes = [], seconds = 86_400, cook = 'Thorin', id = cuid() }) {
  return {
    version: 1,
    dish: { id, recipe, status, outcome, cookedOnDay: 4, consumedOnDay: 4 },
    cook: { name: cook },
    message,
    effect: (outcome === 'standard') ? null : {
      name: `${recipe} (${outcome === 'boon' ? 'Boon' : 'Bane'})`,
      ingredients: ingredients ?? [{ name: 'Fireberries', text: 'Gain 3+1d6 Maximum Hit Points and resistance to fire damage.' }],
      duration: { seconds }, stacks: false, changes,
    },
  }
}
const SKEWERS = { recipe: 'Fireberry Glazed Skewers', message: 'Perfectly charred with a bite of heat, leaving you feeling invincible.',
  changes: [{ type: 'maxHitPoints', value: 7, formula: '3+1d6' }, { type: 'damageResistance', damageType: 'fire' }] }
const BOON = () => body(SKEWERS)
const BANE = () => body({ recipe: 'Ashcakes with Fireberry Jam', outcome: 'bane', ingredients: [{ name: 'Fireberry Jam', text: 'Lose 3+1d6 Maximum Hit Points and become vulnerable to fire damage.' }],
  changes: [{ type: 'maxHitPoints', value: -9, formula: '3+1d6' }, { type: 'damageVulnerability', damageType: 'fire' }] })
const TWO = () => body({ recipe: 'Shadowleaf Mushroom Skewers', ingredients: [{ name: 'Shadowleaf', text: 'Advantage on Stealth checks.' }, { name: 'Troll Moss', text: 'Advantage on Athletics checks.' }],
  changes: [{ type: 'rollMode', roll: 'skill', skill: 'ste', mode: 'advantage' }, { type: 'rollMode', roll: 'skill', skill: 'ath', mode: 'advantage' }] })
const SENSE = () => body({ recipe: 'Glowlure Fritters', ingredients: [{ name: 'Glowlure', text: 'Darkvision 60 ft. and advantage on Perception checks.' }],
  changes: [{ type: 'sense', sense: 'darkvision', range: 60 }, { type: 'rollMode', roll: 'skill', skill: 'prc', mode: 'advantage' }] })
const BONUSES = () => body({ recipe: 'Ashen Root Stew', outcome: 'bane', ingredients: [{ name: 'Ashen Root', text: '-1 to ability checks and saving throws.' }],
  changes: [{ type: 'rollBonus', roll: 'check', value: -1 }, { type: 'rollBonus', roll: 'save', value: -1 }] })
const RISOTTO = (levels = 1) => body({ recipe: 'Kraken Ink Risotto', outcome: 'bane', ingredients: [{ name: 'Kraken Ink', text: '-4 Intelligence and a level of exhaustion.' }],
  changes: [{ type: 'abilityScore', ability: 'int', value: -4 }, { type: 'exhaustion', levels }] })
const STANDARD = () => body({ recipe: 'Fireberry Glazed Skewers', outcome: 'standard', status: 'success', message: 'Tasty, if nothing more.' })
const FAILURE = () => body({ recipe: 'Ashen Root Stew', outcome: 'standard', status: 'failure', message: 'Burnt.' })
const UNKNOWN = () => body({ ...SKEWERS, changes: [...SKEWERS.changes, { type: 'tempHitPoints', value: 5 }] })
const MALFORMED = () => body({ ...SKEWERS, changes: [...SKEWERS.changes, { type: 'abilityScore', ability: 'str', value: 0 }] })
const ATTACKS = () => body({ recipe: 'Ember Skewers', ingredients: [{ name: 'Ember', text: '+2 to attack rolls and +1 to their damage.' }],
  changes: [{ type: 'rollBonus', roll: 'attack', value: 2 }, { type: 'rollBonus', roll: 'damage', value: 1 }] })

let rows = 0
/** A dish as the app hands it over: `dish-<row>`, for the cook's character, sent `ago` ms ago. */
const dishOf = (dishBody, { ago = 0, ...fields } = {}) => ({
  id: `dish-cmrow${String(++rows).padStart(20, '0')}`, actorId: 'thorin', kind: 'dish',
  dish: { queuedAt: Date.now() - ago, body: dishBody }, mode: 0, explicit: false, extras: [], dice: [], ...fields,
})
/** Hand a dish over and wait for its result: the command, the result, and its card. */
async function serve(command) {
  const before = results(command.id).length
  queue(command)
  await until(() => results(command.id).length > before, `the result of ${command.id}`)
  const result = results(command.id).at(-1)
  return { command, result, card: messages.get(result.messageId) ?? null }
}
const flagsOf = card => messages.get(card.id).flags['sending-stone'].dish
const dishEffects = actor => actor.effects.filter(effect => effect.getFlag?.('sending-stone', 'dish'))
const madeFor = (card, actor) => created.filter(each => (each.actor === actor) && (each.data.flags['sending-stone'].dish.card === card.id)).at(-1)?.data
const cardText = card => {
  const doc = new JSDOM(card.content).window.document
  const all = selector => [...doc.querySelectorAll(selector)].map(each => each.textContent.trim())
  return { recipe: all('h3')[0], chip: all('.sending-stone-dish-chip')[0], lines: all('p'), doc }
}

// ---- Start-up, as Foundry would ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret', 'camp-b': 'mirkwood-secret' })
const CAMPAIGNS = [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'bree'], rolls: false },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'], rolls: false },
]
settings.set('campaigns', CAMPAIGNS)
await Hooks.callAll('ready')
await until(() => sent('bridge.hello').length && sent('bridge.hello', 'camp-b').length, 'the hellos')
await settle(60)
const { announce, checkBridge } = await import(`${MODULE}/scripts/bridge.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { runDishCommand, dishReader } = await import(`${MODULE}/scripts/command-dishes.mjs`)
const { applyDish, dismissDish, dishDialogContent, dishRows, dishTombstone, postDishCard } = await import(`${MODULE}/scripts/dish-card.mjs`)
const { deleteHeld, expireDishEffects, inert, rolledOf } = await import(`${MODULE}/scripts/dish-effects.mjs`)
const { resendLost } = await import(`${MODULE}/scripts/character-sync.mjs`)
const { send } = await import(`${MODULE}/scripts/transport.mjs`)
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)

/** Change the campaigns, as Manage Campaigns saves them, and wait for camp-a's hello that follows. */
async function campaignAs(fields, id = 'camp-a') {
  const hellos = sent('bridge.hello', id).length
  await game.settings.set('sending-stone', 'campaigns', getCampaigns().map(campaign => ({
    ...campaign, characters: [...campaign.characters], groups: [...campaign.groups], ...((campaign.id === id) ? fields : {}),
  })))
  await until(() => sent('bridge.hello', id).length > hellos, 'the hello after a change')
  await settle()
}
/** Send a campaign its hello, and wait for what follows it. */
async function hello(id = 'camp-a') {
  const hellos = sent('bridge.hello', id).length
  announce({ campaignId: id })
  await until(() => sent('bridge.hello', id).length > hellos, 'the hello')
  await settle(60)
}

/* -------------------------------------------- */
/*  1. The hello                                */
/* -------------------------------------------- */

const OFF = { enabled: false, kinds: [], reason: 'off', versions: [] }
const ON = { enabled: true, kinds: ['dish'], reason: null, versions: [1] }
const SYSTEM = { enabled: false, kinds: [], reason: 'system', versions: [] }
assert.deepEqual(helloOf().features.dishes, OFF, 'off by default')
assert.deepEqual(Object.keys(helloOf().features), ['rolls', 'transfers', 'removals', 'notes', 'companions', 'favorites', 'dishes'])
await campaignAs({ dishes: true })
assert.deepEqual(helloOf().features.dishes, DND5E6 ? SYSTEM : ON)
assert.deepEqual(helloOf('camp-b').features.dishes, OFF, "another campaign's switch is its own")
game.system.id = 'pf2e'
await hello()
assert.deepEqual(helloOf().features.dishes, SYSTEM, 'under another system')
game.system.id = 'dnd5e'
await hello()
assert.deepEqual(helloOf().features.dishes, DND5E6 ? SYSTEM : ON)
ok(`the hello's features.dishes, last, after favorites: off with the switch off; ${DND5E6 ? '"system" with it on, under dnd5e 6.0.5' : 'on with it on, under dnd5e 5'}; "system" under another system`)

if (DND5E6) {
  /* ------------------------------------------ */
  /*  23. dnd5e 6.0.5                           */
  /* ------------------------------------------ */
  const polls = app.polls.filter(id => id === 'camp-a').length
  await settle(150)
  assert.equal(app.polls.filter(id => id === 'camp-a').length, polls, 'not fetched for, the app taking dishes though it does')
  const command = dishOf(BOON())
  const answer = await runDishCommand(command, getCampaigns()[0])
  assert.deepEqual(answer, { id: command.id, status: 'failed', reason: 'off', error: null, messageId: null, visible: false, rolls: [] })
  assert.equal(messages.filter(message => message.flags?.['sending-stone']?.dish).length, 0, 'no card')
  const card = await postDishCard(dishOf(BOON()), getCampaigns()[0])
  const drawn = await renderCard(card, { asGm: true })
  assert.equal(drawn.querySelectorAll('.sending-stone-dish-actions button').length, 0, 'no controls for a Gamemaster')
  ok('dnd5e 6.0.5: not fetched for; a dish handed over anyway answers "off" and posts no card; a card shows a Gamemaster no controls')
  // A dish effect left from a dnd5e 5 world still ends: the sweep is never gated on the system.
  await setWorldTime(1000)
  await ActiveEffect.implementation.create({
    name: 'Fireberry Glazed Skewers (Boon)', type: 'base', duration: { value: 24, units: 'hours', expiry: null },
    start: { time: 1000 }, system: { changes: [] },
    flags: { 'sending-stone': { dish: { id: 'old', app: 'old', card: 'x', recipe: 'Fireberry Glazed Skewers', appliedAt: 1000, expiresAt: 87_400, seconds: 86_400, maxHp: 7 } } },
  }, { parent: thorin })
  assert.equal(dishEffects(thorin).length, 1)
  await setWorldTime(87_399)
  await settle()
  assert.equal(dishEffects(thorin).length, 1, 'not before its time')
  await setWorldTime(87_400)
  await until(() => !dishEffects(thorin).length, 'the old dish to end')
  ok('dnd5e 6.0.5: a dish effect left from a dnd5e 5 world still ends at its time')
  process.exit(0)
}

/* -------------------------------------------- */
/*  2. Fetching                                 */
/* -------------------------------------------- */

const pollsOf = id => app.polls.filter(each => each === id).length
await until(() => pollsOf('camp-a') > 1, 'fetching for dishes alone')
assert.deepEqual([getCampaigns()[0].rolls, getCampaigns()[0].transfers], [false, false], "the campaign's rolls and moves off")
assert.equal(pollsOf('camp-b'), 0, 'a campaign whose switch is off is fetched for nothing')
app.features.set('camp-a', { commands: true })
await hello()
let polls = pollsOf('camp-a')
await settle(150)
assert.ok(pollsOf('camp-a') <= polls + 1, 'an app that says nothing of dishes is fetched from for them no longer')
assert.equal(dishReader('camp-a'), false)
app.features.delete('camp-a')
await hello()
polls = pollsOf('camp-a')
await until(() => pollsOf('camp-a') > polls + 1, 'fetching again')
ok('a campaign whose only switch is dishes is fetched for where the app says dishes: 1, and not where it says nothing of them')

/* -------------------------------------------- */
/*  3. The card                                 */
/* -------------------------------------------- */

const boonBody = BOON()
const first = await serve(dishOf(boonBody))
const card = first.card
assert.ok(card, 'a card')
assert.deepEqual(first.result, {
  id: first.command.id, status: 'done', reason: null, error: null, messageId: card.id, visible: false, rolls: [],
  dish: { card: card.id, state: 'waiting' },
})
assert.equal(messages.filter(message => message.flags?.['sending-stone']?.dish?.command === first.command.id).length, 1, 'one card')
assert.deepEqual([...card.whisper].sort(), ['gm', 'gm2'], 'whispered to both Gamemasters')
assert.equal(card._source.author, 'gm', "authored by the bridge's user")
assert.deepEqual(card.speaker, { actor: 'thorin', alias: 'Thorin Oakenshield' })
assert.deepEqual(flagsOf(card), {
  command: first.command.id, app: first.command.id.slice(5), campaignId: 'camp-a', cookId: 'thorin',
  queuedAt: first.command.dish.queuedAt, body: boonBody, state: 'waiting', applied: [], decided: null,
})
ok("one card per dish, whispered to every Gamemaster, authored by the bridge's user, the whole dish in its flags; the result done, not visible, its card waiting")

/* -------------------------------------------- */
/*  4. The card's words                         */
/* -------------------------------------------- */

let text = cardText(card)
assert.equal(text.recipe, 'Fireberry Glazed Skewers')
assert.equal(text.chip, 'Boon')
assert.deepEqual(text.lines, [
  'Cooked by Thorin in the Magical Recipe Book · sent just now',
  "Sent through Thorin Oakenshield's Magical Recipe Book link",
  'Perfectly charred with a bite of heat, leaving you feeling invincible.',
  'Fireberries. Gain 3+1d6 Maximum Hit Points and resistance to fire damage.',
  'Rolled once for everyone: Maximum Hit Points +7 (3+1d6).',
  'Lasts 24 hours of game time. Replaces any earlier dish.',
])
const standardCard = (await serve(dishOf(STANDARD(), { ago: 2 * 3600_000 + 5000 }))).card
text = cardText(standardCard)
assert.equal(text.chip, 'Standard dish')
assert.deepEqual(text.lines, ['Cooked by Thorin in the Magical Recipe Book · sent 2 hours ago', "Sent through Thorin Oakenshield's Magical Recipe Book link", 'Tasty, if nothing more.'],
  'a standard dish: no duration, nothing replaced')
const notApplied = cardText((await serve(dishOf(UNKNOWN(), { ago: 90_000 }))).card).lines
assert.ok(notApplied.includes('Not applied automatically: tempHitPoints.'))
assert.ok(notApplied.includes('Cooked by Thorin in the Magical Recipe Book · sent 1 minute ago'))
const daysAgo = cardText((await serve(dishOf(MALFORMED(), { ago: 3 * 86_400_000 }))).card).lines
assert.ok(daysAgo.includes('Not applied automatically: abilityScore.'))
assert.ok(daysAgo.includes('Cooked by Thorin in the Magical Recipe Book · sent 3 days ago'), 'in days past a day')
const attacksLines = cardText((await serve(dishOf(ATTACKS()))).card).lines
assert.ok(attacksLines.includes('Adds to attack damage only.'))
assert.ok(!attacksLines.includes('Token vision is up to the Gamemaster.'))
assert.ok(cardText((await serve(dishOf(SENSE()))).card).lines.includes('Token vision is up to the Gamemaster.'))
const gone = await serve(dishOf(FAILURE(), { actorId: 'stranger' }))
text = cardText(gone.card)
assert.ok(text.lines.includes('Sent through the link of a character no longer in this campaign'))
assert.deepEqual([gone.card.speaker.alias, flagsOf(gone.card).cookId], ['Thorin', null], "spoken for by the cookbook's cook")
assert.equal(gone.result.status, 'done', 'never "unknown"')
assert.equal(cardText((await serve(dishOf(body({ ...SKEWERS, seconds: 5400 })))).card).lines.at(-1), 'Lasts 5400 seconds of game time. Replaces any earlier dish.')
assert.equal(cardText((await serve(dishOf(body({ ...SKEWERS, seconds: 3600 })))).card).lines.at(-1), 'Lasts 1 hour of game time. Replaces any earlier dish.', 'one hour, in the singular')
ok("the card's words: the rolled line, nothing applied by itself, attack damage, vision, how long ago it was sent, whose link, how long it lasts; a standard dish neither lasts nor replaces")

/* -------------------------------------------- */
/*  5. Made at most once                        */
/* -------------------------------------------- */

queue(first.command)
await until(() => results(first.command.id).length === 2, 'the same command again')
assert.deepEqual(results(first.command.id)[1], first.result, 'answered the same')
assert.equal(messages.filter(message => message.flags?.['sending-stone']?.dish?.command === first.command.id).length, 1, 'no second card')
// A second hand-over while the first is being made is the same dish: skipped.
const render = foundry.applications.handlebars.renderTemplate
let gate
const reached = new Promise(resolve => {
  foundry.applications.handlebars.renderTemplate = async (...args) => {
    foundry.applications.handlebars.renderTemplate = render
    resolve()
    await new Promise(release => { gate = release })
    return render(...args)
  }
})
const twice = dishOf(BOON())
queue(twice)
await reached
queue(twice)
await settle(120)
gate()
await until(() => results(twice.id).length, 'the dish made once')
await settle(120)
assert.equal(results(twice.id).length, 1, 'a hand-over while it was made was skipped')
assert.equal(messages.filter(message => message.flags?.['sending-stone']?.dish?.command === twice.id).length, 1)
ok('the same dish again posts no second card and answers the same; a hand-over while it is made is skipped')

// A dish waits for no roll of its cook's: one held in Foundry, the dish goes ahead of it.
await campaignAs({ rolls: true })
thorin.hang = true
const roll = { id: 'roll-held', actorId: 'thorin', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }] }
queue(roll)
await settle(60)
const ahead = dishOf(TWO())
queue(ahead)
await until(() => results(ahead.id).length, 'the dish while the roll is held')
assert.equal(results(roll.id).length, 0, 'the roll is still held')
await until(() => results(roll.id).length, "the held roll's watchdog")
thorin.hang = false
await campaignAs({ rolls: false })
ok("a dish runs while its cook's roll command is held: its own queue")

// A decided card handed over again answers its choice and tells the app again.
const decided = await serve(dishOf(BOON()))
await applyDish(decided.card, ['vex'])
await until(() => dishEvents(decided.card.id).length === 1, 'dish.applied')
queue(decided.command)
await until(() => results(decided.command.id).length === 2, 'the decided dish again')
assert.deepEqual(results(decided.command.id)[1].dish, { card: decided.card.id, state: 'applied' })
await until(() => dishEvents(decided.card.id).length === 2, 'its event again')
assert.equal(dishEvents(decided.card.id)[1].type, 'dish.applied')
// One whose card was deleted undecided answers from its tombstone, and posts nothing.
const deleted = await serve(dishOf(BANE()))
await deleteCards([deleted.card])
await until(() => dishEvents(deleted.card.id).length === 1, 'the deletion')
queue(deleted.command)
await until(() => results(deleted.command.id).length === 2, 'the deleted dish again')
assert.deepEqual(results(deleted.command.id)[1], {
  id: deleted.command.id, status: 'done', reason: null, error: null, messageId: deleted.card.id, visible: false, rolls: [],
  dish: { card: deleted.card.id, state: 'dismissed' },
})
assert.equal(messages.filter(message => message.flags?.['sending-stone']?.dish?.command === deleted.command.id).length, 0, 'no card posted again')
await until(() => dishEvents(deleted.card.id).length === 2, 'its deletion again')
assert.equal(dishEvents(deleted.card.id)[1].data.reason, 'deleted')
ok('a decided card handed over again answers its state and sends its event again; one deleted undecided answers set aside from its tombstone, sends its deletion again, and posts no card')

/* -------------------------------------------- */
/*  6. Refusals                                 */
/* -------------------------------------------- */

const ashlands = () => getCampaigns()[0]
const refusedAs = async (command, error) => {
  assert.deepEqual(await runDishCommand(command, ashlands()), {
    id: command.id, status: 'failed', reason: 'invalid', error, messageId: null, visible: false, rolls: [],
  }, `${error}: ${JSON.stringify(command).slice(0, 200)}`)
}
const fine = () => dishOf(BOON())
const withBody = change => { const command = fine(); change(command.dish.body); return command }
const cards = () => messages.filter(message => message.flags?.['sending-stone']?.dish).length
const before = cards()
for (const field of ['item', 'key', 'prompt', 'transfer', 'remove', 'typed', 'note', 'favorite']) await refusedAs({ ...fine(), [field]: { x: 1 } }, 'dish')
await refusedAs({ ...fine(), by: 'gm' }, 'by')
await refusedAs({ ...fine(), by: 'player' }, 'by')
await refusedAs({ ...fine(), of: 'wolf' }, 'of')
await refusedAs({ ...fine(), dish: null }, 'dish')
await refusedAs({ ...fine(), dish: { queuedAt: 0, body: BOON() } }, 'dish')
await refusedAs({ ...fine(), dish: { queuedAt: 1, body: 'soup' } }, 'dish')
await refusedAs(withBody(b => { b.version = 2 }), 'version')
await refusedAs(withBody(b => { b.dish.id = '' }), 'body.dish')
await refusedAs(withBody(b => { b.dish.recipe = 'x'.repeat(201) }), 'body.dish')
await refusedAs(withBody(b => { b.dish.outcome = 'great' }), 'body.dish')
await refusedAs(withBody(b => { b.cook = { name: 7 } }), 'body.cook')
await refusedAs(withBody(b => { b.message = null }), 'body.message')
await refusedAs(withBody(b => { b.effect = null }), 'body.effect')
await refusedAs(withBody(b => { b.dish.outcome = 'standard' }), 'body.effect')
await refusedAs(withBody(b => { b.effect.name = '' }), 'body.effect')
await refusedAs(withBody(b => { b.effect.name = 'x'.repeat(301) }), 'body.effect')
await refusedAs(withBody(b => { b.effect.ingredients = Array.from({ length: 21 }, () => ({ name: 'a', text: 'b' })) }), 'body.effect')
await refusedAs(withBody(b => { b.effect.ingredients = [{ name: 'a' }] }), 'body.effect')
await refusedAs(withBody(b => { b.effect.duration = { seconds: 1.5 } }), 'body.effect')
await refusedAs(withBody(b => { b.effect.stacks = true }), 'body.effect')
await refusedAs(withBody(b => { b.effect.changes = {} }), 'body.changes')
await refusedAs(withBody(b => { b.effect.changes = Array.from({ length: 101 }, () => ({ type: 'x' })) }), 'body.changes')
await refusedAs(withBody(b => { b.effect.changes = [{ value: 1 }] }), 'body.changes')
await refusedAs({ ...fine(), mode: 1 }, 'dice')
await refusedAs({ ...fine(), dice: [{ faces: 20, results: [3] }] }, 'dice')
assert.equal(cards(), before, 'no card for any')
// Turned off once fetched: "off", and no card.
await campaignAs({ dishes: false })
const late = fine()
assert.deepEqual(await runDishCommand(late, { id: 'camp-a' }), { id: late.id, status: 'failed', reason: 'off', error: null, messageId: null, visible: false, rolls: [] })
assert.equal(cards(), before)
await campaignAs({ dishes: true })
ok('each of the dish check\'s errors, a blank effect name and a favorite among them; "of" from the command check; "off" with the switch turned off once it was fetched; no card for any')

/* -------------------------------------------- */
/*  7. The effect                               */
/* -------------------------------------------- */

await setWorldTime(1000)
const add_ = (key, value, type = 'add') => ({ key, type, value, phase: 'initial' })
const EXPECTED = [
  [BOON, thorin, [add_('system.attributes.hp.tempmax', '7'), add_('system.traits.dr.value', 'fire')], 7],
  [BANE, thorin, [add_('system.attributes.hp.tempmax', '-9'), add_('system.traits.dv.value', 'fire')], -9],
  [TWO, thorin, [add_('system.skills.ste.roll.mode', '1'), add_('system.skills.ath.roll.mode', '1')], 0],
  [SENSE, thorin, [add_('system.attributes.senses.ranges.darkvision', '60', 'upgrade'), add_('system.skills.prc.roll.mode', '1')], 0],
  [SENSE, vex, [add_('system.attributes.senses.ranges.darkvision', '18', 'upgrade'), add_('system.skills.prc.roll.mode', '1')], 0],
  [BONUSES, thorin, [add_('system.bonuses.abilities.check', '-1'), add_('system.bonuses.abilities.save', '-1'), add_('system.attributes.death.bonuses.save', '-1')], 0],
  [ATTACKS, thorin, [...['mwak', 'rwak', 'msak', 'rsak'].map(kind => add_(`system.bonuses.${kind}.attack`, '2')),
    ...['mwak', 'rwak', 'msak', 'rsak'].map(kind => add_(`system.bonuses.${kind}.damage`, '1'))], 0],
  [() => RISOTTO(1), thorin, [add_('system.abilities.int.value', '-4')], 0],
]
for (const [make, actor, changes, maxHp] of EXPECTED) {
  const dishBody = make()
  const { card: served } = await serve(dishOf(dishBody))
  const prior = dishEffects(actor)[0]?.getFlag('sending-stone', 'dish')
  await applyDish(served, [actor.id])
  const data = madeFor(served, actor)
  assert.ok(data, `${dishBody.dish.recipe} on ${actor.name}`)
  assert.deepEqual(data.system, { changes }, dishBody.dish.recipe)
  assert.equal('changes' in data, false, 'no top-level changes')
  assert.deepEqual(data.duration, { value: 24, units: 'hours', expiry: null })
  assert.deepEqual(data.start, { time: 1000, combat: null, combatant: null, initiative: null, round: null, turn: null })
  assert.deepEqual([data.name, data.type, data.img, data.origin, data.transfer, data.disabled, data.statuses],
    [dishBody.effect.name, 'base', `modules/sending-stone/icons/dish-${dishBody.dish.outcome}.svg`, null, false, false, []])
  const flags = data.flags['sending-stone'].dish
  assert.deepEqual(Object.keys(flags).sort(), ['app', 'appliedAt', 'card', 'cook', 'exhaustion', 'expiresAt', 'healed', 'id', 'maxHp', 'outcome', 'recipe', 'replaced', 'seconds', 'skipped'])
  assert.deepEqual([flags.id, flags.app, flags.card, flags.recipe, flags.outcome, flags.cook, flags.appliedAt, flags.expiresAt, flags.seconds, flags.maxHp, flags.replaced],
    [dishBody.dish.id, flagsOf(served).app, served.id, dishBody.dish.recipe, dishBody.dish.outcome, 'Thorin', 1000, 87_400, 86_400, maxHp, prior ? { id: prior.id, recipe: prior.recipe } : null])
}
assert.equal(madeFor(card, thorin), undefined, 'nothing made from a card no one was served')
const boonDescription = created.find(each => each.data.name === 'Fireberry Glazed Skewers (Boon)').data.description
assert.equal(boonDescription, '<p><strong>Fireberries.</strong> Gain 3+1d6 Maximum Hit Points and resistance to fire damage.</p><p><em>Rolled once for everyone: Maximum Hit Points +7 (3+1d6).</em></p>')
ok("each dish's effect: its system.changes, their keys, types and string values, on dnd5e 5.3.3's paths, a sense in the character's own units; 24 hours from its start, the world time when applied; no origin; every flag, its seconds among them; no top-level changes")

/* -------------------------------------------- */
/*  8. Dice                                     */
/* -------------------------------------------- */

const rolled = []
const evaluate = Roll.prototype.evaluate
Roll.prototype.evaluate = function (...args) { rolled.push(this.formula); return evaluate.apply(this, args) }
const both = (await serve(dishOf(BOON()))).card
let mark = app.events.length
await applyDish(both, ['thorin', 'vex'])
Roll.prototype.evaluate = evaluate
assert.deepEqual(rolled, [], 'nothing rolls')
for (const actor of [thorin, vex]) {
  assert.deepEqual(madeFor(both, actor).system.changes[0], add_('system.attributes.hp.tempmax', '7'), `${actor.name}: the value rolled once`)
}
await until(() => dishEvents(both.id, mark).length, 'dish.applied')
assert.deepEqual(dishEvents(both.id, mark)[0].data.rolled, [{ type: 'maxHitPoints', value: 7, formula: '3+1d6' }], 'rolled once')
const formula = '1d4+1d4+1d4+1d4+1d4+1d4+1d4+1d4+1d4+1234'
assert.equal(formula.length, 40)
const odd = body({ ...SKEWERS, changes: [...SKEWERS.changes, { type: 'luck', value: 1.5, formula: '1d4' }, { type: 'tempHitPoints', value: 5, formula }] })
assert.deepEqual(rolledOf(odd.effect.changes), [{ type: 'maxHitPoints', value: 7, formula: '3+1d6' }, { type: 'tempHitPoints', value: 5, formula: formula.slice(0, 32) }])
assert.equal(rolledOf(Array.from({ length: 101 }, (_, i) => ({ type: 'luck', value: i, formula: '1d4' }))).length, 100, 'at most 100')
const oddCard = (await serve(dishOf(odd))).card
assert.deepEqual(cardText(oddCard).lines.filter(line => line.startsWith('Rolled')), [
  'Rolled once for everyone: Maximum Hit Points +7 (3+1d6).', `Rolled once for everyone: tempHitPoints +5 (${formula.slice(0, 32)}).`,
])
await applyDish(oddCard, ['bree'])
assert.ok(madeFor(oddCard, bree).description.endsWith(`<p><em>Rolled once for everyone: tempHitPoints +5 (${formula.slice(0, 32)}).</em></p>`))
assert.ok(!madeFor(oddCard, bree).description.includes('luck'))
ok('a boon served to two characters gives both the value rolled once, nothing rolled here; rolled lists it once; a change whose value is no whole number left out, a 40-character formula cut to 32, at most 100')

/* -------------------------------------------- */
/*  9. One dish at a time                       */
/* -------------------------------------------- */

const port = dishPort(thorin)
const held = dishEffects(thorin)
assert.equal(held.length, 1, 'Thorin holds one dish effect')
const was = held[0].getFlag('sending-stone', 'dish')
const nextBody = BANE()
const next = (await serve(dishOf(nextBody))).card
const logAt = port.log.length
await applyDish(next, ['thorin'])
const made = dishEffects(thorin)[0].id
const steps = port.log.slice(logAt).filter(step => [held[0].id, made].includes(step.id))
assert.deepEqual(steps.map(step => [step.op, step.held]), [['delete', 0], ['create', 1]], 'the earlier dish deleted before the new one is created')
assert.deepEqual(madeFor(next, thorin).flags['sending-stone'].dish.replaced, { id: was.id, recipe: was.recipe })
assert.deepEqual(flagsOf(next).applied[0].replaced, { id: was.id, recipe: was.recipe })
assert.equal(dishEffects(thorin).length, 1)
// The same dish, from another card, is skipped.
const again = (await serve(dishOf(structuredClone(nextBody)))).card
const creates = port.creates
assert.deepEqual(await applyDish(again, ['thorin']), [], 'skipped')
assert.equal(port.creates, creates, 'nothing created')
assert.equal(dishEffects(thorin)[0].getFlag('sending-stone', 'dish').id, nextBody.dish.id)
// A standard dish replaces nothing.
const plain = (await serve(dishOf(STANDARD()))).card
await applyDish(plain, ['thorin'])
assert.equal(dishEffects(thorin)[0].getFlag('sending-stone', 'dish').id, nextBody.dish.id, 'the earlier dish stays')
assert.deepEqual(flagsOf(plain).applied, [{ actorId: 'thorin', name: 'Thorin Oakenshield', effectId: null, replaced: null, healed: 0, exhaustion: 0, skipped: [] }])
ok("a second dish deletes the first's effect before creating its own, replaced naming it; the same dish again is skipped; a standard dish replaces nothing")

/* -------------------------------------------- */
/*  10. One-offs                                */
/* -------------------------------------------- */

await vex.update({ 'system.attributes.exhaustion': 5 })
const tired = (await serve(dishOf(RISOTTO(2)))).card
await applyDish(tired, ['vex', 'bree'])
assert.equal(vex.system.attributes.exhaustion, 6, 'capped at 6')
const tiredFlags = flagsOf(tired).applied
assert.equal(tiredFlags.find(entry => entry.actorId === 'vex').exhaustion, 1, 'the level added')
assert.equal(bree.system.attributes.exhaustion, 0, 'immune')
assert.deepEqual(tiredFlags.find(entry => entry.actorId === 'bree').skipped, [{ type: 'exhaustion', reason: 'immune' }])
assert.deepEqual(madeFor(tired, bree).flags['sending-stone'].dish.skipped, [{ type: 'exhaustion', reason: 'immune' }])
// +7 and -3: heals the net 4 at most.
const mixed = body({ recipe: 'Mixed Grill', changes: [{ type: 'maxHitPoints', value: 7, formula: '3+1d6' }, { type: 'maxHitPoints', value: -3 }] })
await vex.update({ 'system.attributes.hp.value': 20 })
const grill = (await serve(dishOf(mixed))).card
await applyDish(grill, ['vex'])
assert.deepEqual([vex.system.attributes.hp.value, vex.system.attributes.hp.effectiveMax], [24, 44], 'healed 4, the new maximum 44')
assert.equal(flagsOf(grill).applied[0].healed, 4)
assert.equal(madeFor(grill, vex).flags['sending-stone'].dish.maxHp, 4)
// Never past the new maximum: a character whose hit points stand above it, as one not yet prepared again.
const full = add({ id: 'full', name: 'Fuller', owners: ['bob'] }, { hp: { value: 40, max: 40 } })
await campaignAs({ characters: ['thorin', 'vex', 'bree', 'full'] })
dishPort(full).source.hp.value = 45
full.system.attributes.hp.value = 45
const grill2 = (await serve(dishOf(structuredClone(mixed)))).card
const updates = dishPort(full).actorUpdates
await applyDish(grill2, ['full'])
assert.equal(flagsOf(grill2).applied[0].healed, 0, 'nothing healed past the new maximum')
assert.equal(dishPort(full).actorUpdates, updates, 'no hit points written')
// Hit points read once the earlier dish is gone, as it no longer raises the maximum: Fuller's 45
// stands above the 44 his +4 dish allows; with it gone the maximum is 40, so a +7 dish heals 7, to
// 47, never 44 + 7.
const grill3 = (await serve(dishOf(BOON()))).card
await applyDish(grill3, ['full'])
assert.equal(flagsOf(grill3).applied[0].healed, 7)
assert.deepEqual([dishPort(full).source.hp.value, full.system.attributes.hp.value, full.system.attributes.hp.effectiveMax], [47, 47, 47],
  'healed from the maximum without the dish it replaces')
ok('exhaustion capped at 6, skipped "immune" for a character immune to it; +7 and -3 heal the net 4 at most, never past the new maximum, worked out once the dish it replaces is gone')

/* -------------------------------------------- */
/*  11. What isn't applied by itself           */
/* -------------------------------------------- */

for (const [make, skipped] of [[UNKNOWN, { type: 'tempHitPoints', reason: 'unknown' }], [MALFORMED, { type: 'abilityScore', reason: 'invalid' }]]) {
  const served = (await serve(dishOf(make()))).card
  await applyDish(served, ['thorin'])
  const data = madeFor(served, thorin)
  assert.deepEqual(data.system.changes, [add_('system.attributes.hp.tempmax', '7'), add_('system.traits.dr.value', 'fire')], 'everything else applied')
  assert.deepEqual(data.flags['sending-stone'].dish.skipped, [skipped])
  assert.deepEqual(flagsOf(served).applied[0].skipped, [skipped])
  assert.ok(cardText(served).lines.includes(`Not applied automatically: ${skipped.type}.`))
}
ok('an unknown kind and a malformed known one: everything else applied, each skip on the card, in the effect\'s flags and in skipped')

/* -------------------------------------------- */
/*  12. Telling the app                         */
/* -------------------------------------------- */

const told = (await serve(dishOf(BOON()))).card
mark = app.events.length
await setWorldTime(2000)
await applyDish(told, ['thorin'])
await until(() => dishEvents(told.id, mark).length, 'dish.applied')
let event = dishEvents(told.id, mark)[0]
const thorinEntry = flagsOf(told).applied[0]
assert.deepEqual(event.data, {
  dish: flagsOf(told).app, id: flagsOf(told).body.dish.id, card: told.id, outcome: 'boon', characters: [thorinEntry],
  rolled: [{ type: 'maxHitPoints', value: 7, formula: '3+1d6' }], by: { userId: 'gm', name: 'Gamemaster' },
  at: { time: flagsOf(told).decided.at, worldTime: 2000 },
})
assert.equal(typeof event.sequence, 'number', 'sequenced')
const long = add({ id: 'long', name: 'L'.repeat(300), owners: ['bob'] }, {})
await campaignAs({ characters: ['thorin', 'vex', 'bree', 'full', 'long'] })
mark = app.events.length
await applyDish(told, ['long'])
await until(() => dishEvents(told.id, mark).length, 'the next dish.applied')
event = dishEvents(told.id, mark)[0]
assert.deepEqual(event.data.characters.map(entry => entry.actorId), ['thorin', 'long'], 'everyone so far')
assert.equal(event.data.characters[1].name, 'L'.repeat(200), 'cut to 200')
// Another change to a decided card, not to its choice, sends nothing.
mark = app.events.length
await messages.get(told.id).update({ content: `${messages.get(told.id).content}<!-- edited -->` })
await settle(60)
assert.equal(dishEvents(told.id, mark).length, 0, 'a change to the card alone sends nothing')
// Its characters cut to 200, and each one's skipped changes to 100, as another client might write them.
const crowd = (await serve(dishOf(STANDARD()))).card
await applyDish(crowd, ['vex'])
const crowdVex = flagsOf(crowd).applied[0]
const strangers = Array.from({ length: 200 }, (_, i) => ({ actorId: `stranger${i}`, name: `Stranger ${i}`, effectId: null, replaced: null, healed: 0, exhaustion: 0,
  skipped: (i === 0) ? Array.from({ length: 101 }, () => ({ type: 'tempHitPoints', reason: 'unknown' })) : [] }))
mark = app.events.length
await messages.get(crowd.id).update({ 'flags.sending-stone.dish.applied': [crowdVex, ...strangers] })
await until(() => dishEvents(crowd.id, mark).length, 'dish.applied for 201 characters')
const crowded = dishEvents(crowd.id, mark)[0].data.characters
assert.deepEqual([crowded.length, crowded[0], crowded[1].skipped.length, crowded.at(-1).actorId], [200, crowdVex, 100, 'stranger198'], '200 characters, 100 skipped')
// Set aside: by the other Gamemaster's client, which sends nothing; the bridge's sends it.
const aside = (await serve(dishOf(BOON()))).card
mark = app.events.length
await asUser(gm2, () => dismissDish(aside))
await settle(80)
assert.equal(dishEvents(aside.id, mark).length, 0, 'sent by the bridge alone')
// Foundry tells every client of the write: the bridge's sends it.
await Hooks.callAll('updateChatMessage', messages.get(aside.id), { flags: { 'sending-stone': { dish: { state: 'dismissed' } } } }, {}, 'gm2')
await until(() => dishEvents(aside.id, mark).length, 'dish.dismissed')
assert.deepEqual(dishEvents(aside.id, mark)[0].data, {
  dish: flagsOf(aside).app, id: flagsOf(aside).body.dish.id, card: aside.id, reason: 'dismissed',
  by: { userId: 'gm2', name: 'Second Gamemaster' }, at: { time: flagsOf(aside).decided.at, worldTime: 2000 },
})
// Lost for a while: sent again 30 seconds later, from the card.
const dropped = (await serve(dishOf(BOON()))).card
app.failing = envelope => envelope.type === 'dish.applied'
const failures = app.failed.length
await applyDish(dropped, ['vex'])
await until(() => app.failed.length >= failures + 3, 'the post given up on')
app.failing = null
await settle()
mark = app.events.length
resendLost()
await settle()
assert.equal(dishEvents(dropped.id, mark).length, 0, 'not before 30 seconds')
later(31_000)
resendLost()
await until(() => dishEvents(dropped.id, mark).length, 'dish.applied again')
assert.equal(dishEvents(dropped.id, mark)[0].data.characters[0].actorId, 'vex')
ok("dish.applied and dish.dismissed as the app reads them, sequenced; everyone served so far; a 300-character name cut to 200, the characters to 200 and each one's skipped to 100; another change to the card sends nothing; sent by the bridge alone; again 30 seconds after a temporary drop")

/* -------------------------------------------- */
/*  2b. A heartbeat that starts the app reading */
/* -------------------------------------------- */

app.features.set('camp-a', { commands: true })
send('bridge.heartbeat', {}, ashlands(), { sequenced: false })
await until(() => !dishReader('camp-a'), 'the reader off')
app.features.delete('camp-a')
mark = app.events.length
send('bridge.heartbeat', {}, ashlands(), { sequenced: false })
await until(() => dishReader('camp-a'), 'the reader on')
await until(() => dishEvents(told.id, mark).length, "the decided card's event at once")
assert.equal(sent('bridge.hello').filter(e => app.events.indexOf(e) >= mark).length, 0, 'with no hello')
// The next heartbeat, whose answer says dishes again, sends none.
await quiet()
mark = app.events.length
send('bridge.heartbeat', {}, ashlands(), { sequenced: false })
await until(() => sent('bridge.heartbeat').some(e => app.events.indexOf(e) >= mark), 'the next heartbeat')
await settle(60)
assert.equal(app.events.slice(mark).filter(e => e.type.startsWith('dish.')).length, 0, 'a heartbeat that says dishes again sends nothing')
ok("an app that starts taking dishes in a heartbeat's answer is sent the decided cards' events at once, and the next heartbeat sends none")

/* -------------------------------------------- */
/*  13. After a hello                           */
/* -------------------------------------------- */

const missed = (await serve(dishOf(BOON()))).card
app.refusing = envelope => (envelope.type === 'dish.applied') && (envelope.data.card === missed.id)
const refusals = app.failed.length
await applyDish(missed, ['thorin'])
await until(() => app.failed.length > refusals, 'the refusal')
app.refusing = null
later(31_000)
resendLost()
await settle()
assert.equal(dishEvents(missed.id).length, 0, 'a refused event is never kept to send again')
const waitingCard = (await serve(dishOf(BOON()))).card
const old = (await serve(dishOf(BOON()))).card
await applyDish(old, ['vex'])
messages.get(old.id).flags['sending-stone'].dish.decided.at = new Date(Date.now() - 31 * 86_400_000).toISOString()
mark = app.events.length
await hello()
assert.equal(dishEvents(missed.id, mark).length, 1, 'the missed decision goes again, its earlier send refused or not')
assert.equal(dishEvents(waitingCard.id, mark).length, 0, 'a waiting card: nothing')
assert.equal(dishEvents(old.id, mark).length, 0, 'decided over 30 days ago: nothing')
// An app that doesn't take dishes is sent none.
app.features.set('camp-a', { commands: true })
mark = app.events.length
await hello()
assert.equal(app.events.slice(mark).filter(e => e.type.startsWith('dish.')).length, 0, 'an app without dishes: nothing')
app.features.delete('camp-a')
// At most 50, the newest first.
const many = []
for (let i = 0; i < 55; i++) {
  const each = await postDishCard(dishOf(BOON()), ashlands())
  await dismissDish(each)
  many.push(each)
}
const base = Date.now() + 60_000
many.forEach((each, i) => { messages.get(each.id).flags['sending-stone'].dish.decided.at = new Date(base + (i * 60_000)).toISOString() })
mark = app.events.length
await hello()
const again50 = app.events.slice(mark).filter(e => e.type.startsWith('dish.'))
assert.equal(again50.length, 50, 'at most 50')
assert.deepEqual(new Set(again50.map(e => e.data.card)), new Set(many.slice(5).map(each => each.id)), 'the newest 50')
// Deleted, decided, they say nothing, and leave the hello's 50 to the rest.
mark = app.events.length
await deleteCards(many.map(each => messages.get(each.id)))
await settle()
assert.equal(app.events.slice(mark).filter(e => e.type.startsWith('dish.')).length, 0, 'a decided card deleted: nothing')
ok('after a hello, every decision of the last 30 days goes again, one refused before among them, the newest first, at most 50; a waiting card, one decided over 30 days ago, and an app without dishes get nothing')

/* -------------------------------------------- */
/*  14. Tombstones                              */
/* -------------------------------------------- */

let writes = 0
const realSet = game.settings.set
game.settings.set = async (module, key, value) => { if (key === 'dishTombstones') writes++; return realSet.call(game.settings, module, key, value) }
const stones = () => settings.get('dishTombstones') ?? []
const lost = (await serve(dishOf(BOON()))).card
app.failing = envelope => (envelope.type === 'dish.dismissed') && (envelope.data.card === lost.id)
let tries = app.failed.length
await deleteCards([lost])
await until(() => app.failed.length >= tries + 3, 'the deletion given up on')
app.failing = null
await settle()
mark = app.events.length
later(31_000)
resendLost()
await until(() => dishEvents(lost.id, mark).length, 'the deletion again, from the event kept')
assert.equal(dishEvents(lost.id, mark)[0].data.reason, 'deleted')
// A world with no chat log, as the stand-ins without dice-core.mjs are: a hello still answered, its
// resend throwing nothing, and the tombstone, which needs no card, still sent.
const chatLog = game.messages
delete game.messages
mark = app.events.length
try { await hello() } finally { game.messages = chatLog }
assert.ok(sent('bridge.hello').some(e => app.events.indexOf(e) >= mark), 'the hello, with no chat log')
assert.deepEqual(dishEvents(lost.id, mark).map(e => [e.type, e.data.reason]), [['dish.dismissed', 'deleted']], 'its tombstone, with no chat log')
assert.equal(dishEvents(told.id, mark).length, 0, 'no decided card, with no chat log to find it in')
// Again, with a reload before then: the next hello sends it once, from its tombstone.
const reload = (await serve(dishOf(BANE()))).card
app.failing = envelope => (envelope.type === 'dish.dismissed') && (envelope.data.card === reload.id)
tries = app.failed.length
await deleteCards([reload])
await until(() => app.failed.length >= tries + 3, 'the deletion given up on')
app.failing = null
await until(() => stones().some(stone => stone.data.card === reload.id), 'its tombstone written')
mark = app.events.length
await hello()
assert.deepEqual(dishEvents(reload.id, mark).map(e => [e.type, e.data.reason]), [['dish.dismissed', 'deleted']], 'one, from the tombstone')
const stone = stones().find(each => each.data.card === reload.id)
assert.deepEqual(Object.keys(stone).sort(), ['app', 'at', 'campaignId', 'data'])
assert.deepEqual(Object.keys(stone.data).sort(), ['at', 'by', 'card', 'dish', 'id', 'reason'])
const kept = JSON.stringify(stones())
for (const dishText of ['Ashcakes', 'Fireberr', 'Thorin', 'vulnerable', 'invincible']) assert.ok(!kept.includes(dishText), `no dish text: ${dishText}`)
// Kept for 30 days, the newest 50.
const fill = Array.from({ length: 55 }, (_, i) => ({
  app: `fill${i}`, campaignId: 'camp-a', at: new Date(Date.now() - ((i < 5) ? 31 * 86_400_000 : (i * 60_000))).toISOString(),
  data: { dish: `fill${i}`, id: `fill${i}`, card: `card${i}`, reason: 'deleted', by: null, at: { time: null, worldTime: 0 } },
}))
settings.set('dishTombstones', fill)
const newest = (await serve(dishOf(BOON()))).card
await deleteCards([newest])
await until(() => stones().some(each => each.data.card === newest.id), 'the newest tombstone')
assert.equal(stones().length, 50, 'the newest 50')
assert.ok(stones().every(each => Date.parse(each.at) >= Date.now() - 30 * 86_400_000), 'none older than 30 days')
assert.equal(stones()[0].data.card, newest.id, 'newest first')
ok("a waiting card deleted while the app is away: the event kept goes 30 seconds later; after a reload, the next hello sends it once, from its tombstone; tombstones hold ids, the Gamemaster's name and the time, never the dish, for 30 days, the newest 50")

// 14b. Each campaign's own. Mirkwood's app takes dishes, though its switch is off: after its hello it
// hears of its own decided card and tombstone alone, never Ashlands'; and Ashlands' hello sends none
// of Mirkwood's.
assert.equal(dishReader('camp-b'), true, "Mirkwood's app takes dishes")
const mirkwood = () => getCampaigns().find(({ id }) => id === 'camp-b')
const mirkSet = await postDishCard(dishOf(STANDARD(), { actorId: 'vex' }), mirkwood())
await dismissDish(mirkSet)
const mirkGone = await postDishCard(dishOf(BOON(), { actorId: 'vex' }), mirkwood())
await deleteCards([mirkGone])
await quiet()
mark = app.events.length
await hello('camp-b')
await quiet()
assert.deepEqual(app.events.slice(mark).filter(e => e.type.startsWith('dish.')).map(e => [e.campaign.id, e.data.card, e.data.reason ?? null]).sort(),
  [['camp-b', mirkGone.id, 'deleted'], ['camp-b', mirkSet.id, 'dismissed']].sort(), "Mirkwood's hello: its own card and tombstone alone")
mark = app.events.length
await hello()
await quiet()
const toAshlands = app.events.slice(mark).filter(e => e.type.startsWith('dish.'))
assert.ok(toAshlands.some(e => e.data.reason === 'deleted') && toAshlands.some(e => e.type === 'dish.applied'), "Ashlands' cards and tombstones")
assert.ok(toAshlands.every(e => (e.campaign.id === 'camp-a') && ![mirkSet.id, mirkGone.id].includes(e.data.card)), "Ashlands' hello: none of Mirkwood's")
ok("after a campaign's hello, its own decided cards and tombstones alone: never another campaign's, whose app takes dishes too")

// 14c. While a tombstone write is on its way, as a world setting's waits for the server: the
// tombstones in it still count, so the same dish handed over again posts no card; a second burst's
// write waits for it, so neither loses the other's whichever answer would come back first; and one
// refused is kept for the next write, no rejection left unhandled.
const countedSet = game.settings.set
const onTheirWay = []
let refuseNext = false
game.settings.set = async (module, key, value) => {
  if (key !== 'dishTombstones') return countedSet.call(game.settings, module, key, value)
  await new Promise(resolve => onTheirWay.push(resolve))
  if (refuseNext) { refuseNext = false; throw new Error('The server refused the write') }
  return countedSet.call(game.settings, module, key, value)
}
const landNext = async (what, newest = false) => { await until(() => onTheirWay.length, what); (newest ? onTheirWay.pop() : onTheirWay.shift())(); await settle() }
const unhandled = []
const noteUnhandled = reason => unhandled.push(reason)
process.on('unhandledRejection', noteUnhandled)
const onItsWay = await serve(dishOf(BOON()))
await deleteCards([onItsWay.card])
await until(() => onTheirWay.length, 'its tombstone on its way')
queue(onItsWay.command)
await until(() => results(onItsWay.command.id).length === 2, 'the dish handed over again')
assert.deepEqual(results(onItsWay.command.id)[1].dish, { card: onItsWay.card.id, state: 'dismissed' }, 'answered from the tombstone on its way')
assert.equal(messages.filter(message => message.flags?.['sending-stone']?.dish?.command === onItsWay.command.id).length, 0, 'no card posted again')
await landNext('its tombstone written')
const burstX = (await serve(dishOf(BOON()))).card
const burstY = (await serve(dishOf(BOON()))).card
await deleteCards([burstX])
await until(() => onTheirWay.length, "the first burst's write")
await deleteCards([burstY])
await settle(60)
await landNext('the newest write on its way', true)
await landNext('the newest write on its way', true)
assert.deepEqual([burstX, burstY].map(each => stones().some(stone => stone.data.card === each.id)), [true, true], "both bursts' tombstones written")
const refused = await serve(dishOf(BOON()))
await deleteCards([refused.card])
refuseNext = true
await landNext('the refused write')
assert.equal(dishTombstone(refused.command.id.slice('dish-'.length))?.data.card, refused.card.id, 'kept, its write refused')
const afterRefusal = (await serve(dishOf(BOON()))).card
await deleteCards([afterRefusal])
await landNext('the next write')
assert.deepEqual([refused.card, afterRefusal].map(each => stones().some(stone => stone.data.card === each.id)), [true, true], 'written with the next')
process.off('unhandledRejection', noteUnhandled)
assert.deepEqual(unhandled, [], 'no rejection left unhandled')
game.settings.set = countedSet
ok("a tombstone on its way to the server still counts, so the same dish handed over again posts no card; a burst's write waits for the last, so none loses another's; one refused is kept, and written with the next")

// 14d. A decided card deleted while its event waits to go again, as a Gamemaster clearing the chat
// log while the app is away: that event goes 30 seconds later as the card last said it, and the
// deletion itself sends nothing, not after a hello either; the same dish handed over again, its
// result lost, answers its choice and posts nothing, from the card's tombstone, which keeps its ids,
// choice and the Gamemaster's name alone.
const eaten = await serve(dishOf(BOON()))
app.failing = envelope => (envelope.type === 'dish.applied') && (envelope.data.card === eaten.card.id)
tries = app.failed.length
await applyDish(eaten.card, ['vex'])
await until(() => app.failed.length >= tries + 3, 'dish.applied given up on')
app.failing = null
const eatenBy = flagsOf(eaten.card).applied
const eatenApp = flagsOf(eaten.card).app
mark = app.events.length
await deleteCards([eaten.card])
await until(() => stones().some(stone => stone.data.card === eaten.card.id), 'its tombstone')
await hello()
await quiet()
assert.equal(dishEvents(eaten.card.id, mark).length, 0, 'a decided card deleted sends nothing, nor after a hello')
later(31_000)
resendLost()
await until(() => dishEvents(eaten.card.id, mark).length, 'dish.applied again, its card gone')
assert.deepEqual(dishEvents(eaten.card.id, mark).map(e => [e.type, e.data.characters]), [['dish.applied', eatenBy]], 'as its card last said it')
const eatenStone = stones().find(stone => stone.data.card === eaten.card.id)
assert.deepEqual([Object.keys(eatenStone).sort(), Object.keys(eatenStone.data).sort(), eatenStone.state, eatenStone.app],
  [['app', 'at', 'campaignId', 'data', 'state'], ['at', 'by', 'card', 'dish', 'id'], 'applied', eatenApp], 'ids, its choice, who and when')
for (const dishText of ['Fireberr', 'Thorin', 'Vex', 'invincible', 'maxHitPoints']) assert.ok(!JSON.stringify(eatenStone).includes(dishText), `no dish text: ${dishText}`)
mark = app.events.length
queue(eaten.command)
await until(() => results(eaten.command.id).length === 2, 'the eaten dish again')
assert.deepEqual(results(eaten.command.id)[1].dish, { card: eaten.card.id, state: 'applied' }, 'its choice')
assert.equal(messages.filter(message => message.flags?.['sending-stone']?.dish?.command === eaten.command.id).length, 0, 'no card posted again')
await until(() => dishEvents(eaten.card.id, mark).length, 'its decision again')
assert.deepEqual(dishEvents(eaten.card.id, mark)[0].data.characters, eatenBy)
// After a reload, as this session never saw them deleted: an eaten one answers its choice and sends
// nothing, the tombstone not saying who ate it; a set aside one answers and sends its event.
const ghostEaten = dishOf(BOON())
const ghostSet = dishOf(BOON())
const ghostAt = { time: new Date().toISOString(), worldTime: 0 }
const ghostBy = { userId: 'gm2', name: 'Second Gamemaster' }
settings.set('dishTombstones', [...stones(),
  { app: ghostEaten.id.slice(5), campaignId: 'camp-a', at: ghostAt.time, state: 'applied', data: { dish: ghostEaten.id.slice(5), id: 'x', card: 'msgghosteaten', by: ghostBy, at: ghostAt } },
  { app: ghostSet.id.slice(5), campaignId: 'camp-a', at: ghostAt.time, state: 'dismissed', data: { dish: ghostSet.id.slice(5), id: 'y', card: 'msgghostset', reason: 'dismissed', by: ghostBy, at: ghostAt } },
])
mark = app.events.length
const before14d = cards()
for (const ghost of [ghostEaten, ghostSet]) await serve(ghost)
await quiet()
assert.deepEqual([ghostEaten, ghostSet].map(ghost => results(ghost.id)[0].dish), [{ card: 'msgghosteaten', state: 'applied' }, { card: 'msgghostset', state: 'dismissed' }])
assert.equal(cards(), before14d, 'no card for either')
assert.deepEqual(app.events.slice(mark).filter(e => e.type.startsWith('dish.')).map(e => [e.type, e.data.card, e.data.reason]),
  [['dish.dismissed', 'msgghostset', 'dismissed']], 'the set aside one alone sent')
// A log cleared of many decided cards pushes out no deletion the app must hear of: the newest 50 of each.
const crowdAt = i => new Date(Date.now() - 60_000 + i).toISOString()
settings.set('dishTombstones', [...stones(), ...Array.from({ length: 51 }, (_, i) => ({
  app: `eaten${i}`, campaignId: 'camp-a', at: crowdAt(i), state: 'applied',
  data: { dish: `eaten${i}`, id: `eaten${i}`, card: `eatencard${i}`, by: null, at: { time: crowdAt(i), worldTime: 0 } },
}))])
const pushing = (await serve(dishOf(BOON()))).card
await deleteCards([pushing])
await until(() => stones().some(stone => stone.data.card === pushing.id), 'its tombstone')
assert.deepEqual([stones().filter(stone => !stone.state).length, stones().filter(stone => stone.state).length], [50, 50], 'the newest 50 of each')
ok("a decided card deleted while its event waits: the event goes 30 seconds later as the card last said it, the deletion sending nothing; the same dish handed over again answers its choice from the card's tombstone, its ids, choice and the Gamemaster's name, and posts nothing, after a reload too; the newest 50 tombstones of each kind kept")

// 14e. A deletion names the user the hook names; on a client that isn't the bridge, it keeps no
// tombstone and sends nothing.
const byOther = (await serve(dishOf(BOON()))).card
mark = app.events.length
messages.delete(byOther.id)
await Hooks.callAll('deleteChatMessage', byOther, {}, 'gm2')
await until(() => dishEvents(byOther.id, mark).length, 'its deletion')
assert.deepEqual(dishEvents(byOther.id, mark)[0].data.by, { userId: 'gm2', name: 'Second Gamemaster' }, 'by the user the hook names')
const elsewhere = (await serve(dishOf(BOON()))).card
const elsewhereApp = flagsOf(elsewhere).app
mark = app.events.length
gm.isActiveGM = false
await deleteCards([elsewhere])
await settle(60)
assert.equal(dishTombstone(elsewhereApp), null, 'not the bridge: no tombstone')
assert.equal(dishEvents(elsewhere.id, mark).length, 0, 'and nothing sent')
gm.isActiveGM = true
await hello()
ok('a deletion names the user the hook names; on a client that is not the bridge, it keeps no tombstone')

/* -------------------------------------------- */
/*  15. Escaping and enricher syntax            */
/* -------------------------------------------- */

const NASTY = '<img src=x onerror=alert(1)> [[/award 100gp]] [[/r 1d20]] [[[/r 1d20]]] @Custom_1[x] @UUID[Actor.x]{y} @Embed[JournalEntry.x] &Reference[blinded]'
const whole = textOf => [/\[\[/.test(textOf), /\]\]/.test(textOf), /@\w+\[/.test(textOf), /&\w+\[/.test(textOf)]
const nasty = body({ recipe: `Soup ${NASTY}`, cook: NASTY, message: NASTY, ingredients: [{ name: NASTY, text: NASTY }],
  changes: [{ type: 'maxHitPoints', value: 2, formula: '1d4' }, { type: `<img src=x onerror=alert(1)>[[/r 1d20]]@Custom_1[x]` },
    // A formula is the cookbook's too: one of a kind unknown here, and a known kind's that fails its check, each rolled.
    { type: 'luck', value: 1, formula: '[[/award 100gp]]' }, { type: 'maxHitPoints', value: 3, formula: '@UUID[Actor.x]{y}' }] })
const soup = (await serve(dishOf(nasty))).card
const drawnSoup = new JSDOM(soup.content).window.document
assert.equal(drawnSoup.querySelectorAll('img').length, 0, 'no markup from the cookbook on the card')
assert.ok(soup.content.includes('&lt;img src'), 'escaped')
assert.deepEqual(whole(drawnSoup.body.textContent), [false, false, false, false], 'inert on the card')
const unbroken = textOf => textOf.replaceAll('\u200B', '')
assert.ok(['Rolled once for everyone: luck +1 ([[/award 100gp]]).', 'Rolled once for everyone: Maximum Hit Points +3 (@UUID[Actor.x]{y}).']
  .every(line => unbroken(drawnSoup.body.textContent).includes(line)), 'each formula on the card, rolled')
assert.ok(drawnSoup.body.textContent.includes('<img src=x onerror=alert(1)>'), 'shown as text')
await applyDish(soup, ['bree'])
const soupData = madeFor(soup, bree)
const described = new JSDOM(soupData.description).window.document
assert.equal(described.querySelectorAll('img').length, 0, "no markup from the cookbook in the effect's description")
assert.deepEqual(whole(described.body.textContent), [false, false, false, false], "inert in the effect's description")
assert.ok(['luck +1 ([[/award 100gp]])', 'Maximum Hit Points +3 (@UUID[Actor.x]{y})'].every(line => unbroken(described.body.textContent).includes(line)),
  "each formula in the effect's description, rolled")
assert.ok(soupData.name.includes('<img src=x onerror=alert(1)>'), 'the name plain, never escaped')
assert.deepEqual(whole(soupData.name), [false, false, false, false], 'the name inert')
assert.equal(soupData.name.replaceAll('\u200B', ''), nasty.effect.name, 'the name as sent, but for the breaks')
assert.equal(inert('[[[/r 1d20]]]').replaceAll('\u200B', '|'), '[|[|[/r 1d20]|]|]')
const dialog = dishDialogContent({ recipe: `Soup ${NASTY}`, rows: [
  { actorId: 'bree', name: NASTY, img: 'icons/bree.webp', owners: NASTY, ticked: true, disabled: true, note: `Replaces Soup ${NASTY}` },
], notice: null })
const drawnDialog = new JSDOM(dialog).window.document
assert.deepEqual([...drawnDialog.querySelectorAll('img')].map(img => img.getAttribute('src')), ['icons/bree.webp'], 'the portrait alone')
assert.deepEqual(whole(drawnDialog.querySelector('legend').textContent), [false, false, false, false], 'the recipe inert in the dialog')
assert.deepEqual(whole(drawnDialog.querySelector('.sending-stone-dish-note').textContent), [false, false, false, false], 'a replaced recipe inert')
assert.ok(drawnDialog.querySelector('.sending-stone-dish-name').textContent.includes('<img src=x'), 'a name as text')
assert.deepEqual([drawnDialog.querySelector('input').checked, drawnDialog.querySelector('input').disabled], [true, true])
ok("a cookbook string's markup and enricher syntax, [[…]], [[[…]]], @Word[…], @Custom_1[…] and &Reference[…], a change's formula among them, escaped and inert on the card, in the dialog and in the effect's description; the effect's name plain, inert")

/* -------------------------------------------- */
/*  16. Failures                                */
/* -------------------------------------------- */

dishPort(vex).faults.throwOnCreate = true
const failing = (await serve(dishOf(BOON()))).card
notices.length = 0
const servedNow = await applyDish(failing, ['bree', 'vex'])
dishPort(vex).faults.throwOnCreate = false
assert.deepEqual(servedNow.map(entry => entry.actorId), ['bree'], 'the others served')
assert.deepEqual(flagsOf(failing).applied.map(entry => entry.actorId), ['bree'], 'on the card; the one that failed left out')
assert.deepEqual(notices, [{ message: 'SENDINGSTONE.Dish.FailedRemoved', options: { localize: true, format: { recipe: 'Fireberry Glazed Skewers', names: 'Vex' } } }],
  'named in one notification, its earlier dish removed')
assert.equal(dishEffects(vex).length, 0)
const failing2 = (await serve(dishOf(BOON()))).card
dishPort(vex).faults.throwOnCreate = true
notices.length = 0
await applyDish(failing2, ['vex'])
dishPort(vex).faults.throwOnCreate = false
assert.deepEqual(notices.map(notice => notice.message), ['SENDINGSTONE.Dish.Failed'], 'none removed this time')
assert.deepEqual(flagsOf(failing2).applied, [], 'nothing written')
assert.equal(flagsOf(failing2).state, 'waiting')
ok('one character whose effect fails: the others served and on the card, it left out and named in one notification')

/* -------------------------------------------- */
/*  17. Two Gamemasters                         */
/* -------------------------------------------- */

const shared = (await serve(dishOf(STANDARD()))).card
mark = app.events.length
const runA = applyDish(shared, ['thorin'])
const runB = asUser(gm2, () => applyDish(shared, ['vex']))
await Promise.all([runA, runB])
assert.deepEqual(flagsOf(shared).applied.map(entry => entry.actorId).sort(), ['thorin', 'vex'], 'the card lists both')
// The other Gamemaster's write, as the bridge's client hears of it.
await Hooks.callAll('updateChatMessage', messages.get(shared.id), { flags: { 'sending-stone': { dish: { applied: flagsOf(shared).applied } } } }, {}, 'gm2')
await until(() => dishEvents(shared.id, mark).some(e => e.data.characters.length === 2), 'dish.applied with both')
ok("two Gamemasters' runs, each writing the card: it and the next dish.applied list both")

// 17a. Another Gamemaster's write that left out a character holding the dish's effect, as one made
// from the card as it stood before the bridge's own write landed: the bridge adds it back, as its
// effect's flags say, in one write of its own, before it tells the app; a client not the bridge
// writes nothing.
await thorin.update({ 'system.attributes.hp.value': 30 })
const raced = (await serve(dishOf(body({ ...SKEWERS, recipe: 'Ember Stew', changes: [...SKEWERS.changes, { type: 'tempHitPoints', value: 5 }, { type: 'exhaustion', levels: 1 }] })))).card
await applyDish(raced, ['thorin'])
await asUser(gm2, () => applyDish(raced, ['vex']))
const [racedThorin, racedVex] = ['thorin', 'vex'].map(id => flagsOf(raced).applied.find(entry => entry.actorId === id))
const racedEffect = dishEffects(thorin).find(effect => effect.getFlag('sending-stone', 'dish').card === raced.id)
const fromEffect = (({ healed, exhaustion, replaced, skipped }) => ({ actorId: 'thorin', name: thorin.name, effectId: racedEffect.id, replaced, healed, exhaustion, skipped }))(racedEffect.getFlag('sending-stone', 'dish'))
assert.deepEqual(racedThorin, fromEffect, "Thorin's entry is what his effect's flags say")
assert.ok((racedThorin.healed > 0) && (racedThorin.exhaustion > 0) && racedThorin.replaced && racedThorin.skipped.length, 'every field of it worth rebuilding')
const writesTo = card => {
  const message = messages.get(card.id)
  const list = []
  const update = message.update
  message.update = function (changes) { list.push(structuredClone(changes)); return update.call(this, changes) }
  return { list, done() { delete message.update } }
}
let watched = writesTo(raced)
mark = app.events.length
await messages.get(raced.id).update({ 'flags.sending-stone.dish.applied': [racedVex] })
await until(() => dishEvents(raced.id, mark).length, 'dish.applied after the repair')
await quiet()
watched.done()
assert.deepEqual(watched.list, [{ 'flags.sending-stone.dish.applied': [racedVex] }, { 'flags.sending-stone.dish.applied': [racedVex, racedThorin] }],
  'the stale write, then the bridge writes the list back once')
assert.deepEqual(flagsOf(raced).applied, [racedVex, racedThorin])
assert.deepEqual(dishEvents(raced.id, mark).map(e => e.data.characters), [[racedVex, racedThorin]], 'the next dish.applied lists both')
gm.isActiveGM = false
watched = writesTo(raced)
await messages.get(raced.id).update({ 'flags.sending-stone.dish.applied': [racedVex] })
await settle(60)
watched.done()
assert.equal(watched.list.length, 1, 'not the bridge: only the stale write')
gm.isActiveGM = true
await hello()
ok("another Gamemaster's write that left out a character holding the dish's effect: the bridge writes it back once, as the effect's flags say, and the next dish.applied lists both; a client not the bridge writes nothing")

// One client, one card: a second Apply while the first still serves serves no one, and a character
// the card says ate it is skipped, a standard dish's too.
const twiceClicked = (await serve(dishOf(BONUSES()))).card
const madeBefore = created.filter(each => each.data.flags['sending-stone'].dish.card === twiceClicked.id).length
const clicks = [applyDish(twiceClicked, ['bree']), applyDish(twiceClicked, ['bree'])]
const [firstClick, secondClick] = await Promise.all(clicks)
assert.deepEqual([firstClick.map(entry => entry.actorId), secondClick], [['bree'], []], 'the second click serves no one')
assert.equal(created.filter(each => each.data.flags['sending-stone'].dish.card === twiceClicked.id).length, madeBefore + 1, 'one effect made')
const ateOnce = (await serve(dishOf(STANDARD()))).card
await applyDish(ateOnce, ['bree'])
assert.deepEqual(await applyDish(ateOnce, ['bree']), [], 'a standard dish: the card says it was eaten')
ok("a second Apply on one client while the first serves serves no one; one the card says has eaten it is skipped, a standard dish's too")

// 17b. Two runs for one character at once, of two dishes: the bridge keeps the newer effect.
for (const effect of dishEffects(bree)) await effect.delete()
const cardX = (await serve(dishOf(TWO()))).card
const cardY = (await serve(dishOf(BONUSES()))).card
const holdY = holdCreate(data => data.flags['sending-stone'].dish.card === cardY.id)
const runX = applyDish(cardX, ['bree'])
const runY = asUser(gm2, () => applyDish(cardY, ['bree']))
await until(() => holdY.held, "the second's create held")
await until(() => dishEffects(bree).length === 1, "the first's effect")
holdY.release()
await Promise.all([runX, runY])
await until(() => dishEffects(bree).length === 1, 'one dish effect')
assert.equal(dishEffects(bree)[0].getFlag('sending-stone', 'dish').card, cardY.id, 'the newer')
// On a client that isn't the bridge, the rule deletes nothing.
for (const effect of dishEffects(bree)) await effect.delete()
const cardZ = (await serve(dishOf(SENSE()))).card
const cardW = (await serve(dishOf(RISOTTO(1)))).card
const holdW = holdCreate(data => data.flags['sending-stone'].dish.card === cardW.id)
gm.isActiveGM = false
const runZ = applyDish(cardZ, ['bree'])
const runW = applyDish(cardW, ['bree'])
await until(() => holdW.held && (dishEffects(bree).length === 1), 'the first landed, the second held')
holdW.release()
await Promise.all([runZ, runW])
await settle()
assert.equal(dishEffects(bree).length, 2, 'not the bridge: both stay')
gm.isActiveGM = true
for (const effect of dishEffects(bree)) await effect.delete()
// Fetching stopped while this client wasn't the bridge: its next hello starts it again.
await hello()
ok('two runs for one character at once, both having read it before either created: the bridge deletes all but the newer dish effect; a client not the bridge deletes nothing')

/* -------------------------------------------- */
/*  18. A standard dish                         */
/* -------------------------------------------- */

const { rows: sharedRows } = dishRows(shared)
assert.deepEqual(sharedRows.find(row => row.actorId === 'thorin'),
  { actorId: 'thorin', name: 'Thorin Oakenshield', img: 'icons/thorin.webp', owners: 'Alice', ticked: true, disabled: true, note: 'Already has it' })
assert.deepEqual(sharedRows.find(row => row.actorId === 'bree'), { actorId: 'bree', name: 'Bree', img: 'icons/bree.webp', owners: 'Alice', ticked: false, disabled: false, note: null },
  'a standard dish replaces nothing')
assert.equal(created.filter(each => each.data.flags['sending-stone'].dish.card === shared.id).length, 0, 'no effect')
assert.equal(dishEffects(thorin).length, 1, 'Thorin holds a dish')
const { rows: plainRows } = dishRows((await serve(dishOf(STANDARD()))).card)
assert.deepEqual(plainRows.find(row => row.actorId === 'thorin'),
  { actorId: 'thorin', name: 'Thorin Oakenshield', img: 'icons/thorin.webp', owners: 'Alice', ticked: true, disabled: false, note: null },
  'a standard dish replaces nothing, though the character holds a dish')
const { rows: boonRows } = dishRows((await serve(dishOf(ATTACKS()))).card)
assert.equal(boonRows.find(row => row.actorId === 'thorin').note, `Replaces ${dishEffects(thorin)[0].getFlag('sending-stone', 'dish').recipe}`)
assert.equal(boonRows.find(row => row.actorId === 'thorin').ticked, true, "the cook's ticked")
ok('a standard dish: "Already has it" from the card\'s list, no effect, and nothing replaced, a dish held or not; a boon: "Replaces" what a character holds, the cook ticked')

/* -------------------------------------------- */
/*  19. The buttons                             */
/* -------------------------------------------- */

const controls = async (message, asGm = true) => {
  const html = await renderCard(messages.get(message.id), { asGm })
  return [...html.querySelectorAll('.sending-stone-dish-actions > *')].map(each => [each.tagName, each.textContent])
}
const fresh = (await serve(dishOf(BOON()))).card
assert.deepEqual(await controls(fresh), [['BUTTON', 'Apply…'], ['BUTTON', 'Set aside']])
assert.deepEqual(await controls((await serve(dishOf(STANDARD()))).card), [['BUTTON', 'Who ate it…'], ['BUTTON', 'Set aside']])
assert.deepEqual(await controls(tired), [['P', 'Eaten by Vex, Bree'], ['P', 'Vex gained 1 exhaustion'], ['P', 'Bree is immune to exhaustion'], ['BUTTON', 'Apply to others…']])
assert.deepEqual(await controls(grill), [['P', 'Eaten by Vex'], ['P', 'Vex regained 4 HP'], ['BUTTON', 'Apply to others…']])
assert.deepEqual(await controls(aside), [['P', 'Set aside by Second Gamemaster']])
for (const each of [fresh, tired, aside]) assert.deepEqual(await controls(each, false), [], 'none for a player')
const badge = (await renderCard(messages.get(fresh.id), { asGm: false })).querySelector('.sending-stone-badge')
assert.deepEqual([badge?.className, badge?.getAttribute('aria-label')], ['sending-stone-badge sending-stone-dish-badge', 'Magical Recipe Book link'])
const drawn = await renderCard(messages.get(fresh.id), { asGm: true })
drawn.querySelector('[data-action="dishSetAside"]').click()
await until(() => flagsOf(fresh).state === 'dismissed', 'set aside from its button')
ok("each state's controls for a Gamemaster, none for a player; the badge; Set aside sets it aside")

/* -------------------------------------------- */
/*  20. A long rest                             */
/* -------------------------------------------- */

await applyDish((await serve(dishOf(BOON()))).card, ['vex'])
assert.ok(dishEffects(vex).some(effect => effect.getFlag('sending-stone', 'dish').maxHp > 0), 'Vex holds a dish that raised its maximum')
const vexMax = vex.system.attributes.hp.effectiveMax
await restCompleted(vex, { updateData: { 'system.attributes.hp.value': 30 } })
assert.equal(vex.system.attributes.hp.value, 30, 'a short rest tops nothing up')
await restCompleted(vex, { updateData: { 'system.attributes.hp.tempmax': 0, 'system.attributes.hp.value': 40 } })
assert.deepEqual([vex.system.attributes.hp.value, vex.system.attributes.hp.effectiveMax], [vexMax, vexMax], 'woken at the raised maximum')
assert.equal(dishEffects(full).length, 1)
for (const effect of dishEffects(full)) await effect.delete()
await restCompleted(full, { updateData: { 'system.attributes.hp.tempmax': 0, 'system.attributes.hp.value': 40 } })
assert.equal(full.system.attributes.hp.value, 40, 'no dish: as dnd5e left it')
ok('after a long rest a character holding a dish that raised its maximum wakes at that maximum; a short rest, or no dish, changes nothing')

/* -------------------------------------------- */
/*  21. A cleared chat log                      */
/* -------------------------------------------- */

const clearA = (await serve(dishOf(BOON()))).card
const clearB = (await serve(dishOf(STANDARD()))).card
const clearC = (await serve(dishOf(BOON()))).card
await applyDish(clearC, ['bree'])
await settle(60)
writes = 0
mark = app.events.length
await deleteCards([clearA, clearB, clearC].map(each => messages.get(each.id)), { deleteAll: true })
await until(() => app.events.slice(mark).filter(e => e.type === 'dish.dismissed').length === 2, 'two deletions')
await settle(60)
assert.deepEqual(app.events.slice(mark).filter(e => e.type.startsWith('dish.')).map(e => [e.data.card, e.data.reason]).sort(),
  [[clearA.id, 'deleted'], [clearB.id, 'deleted']].sort(), 'each waiting card its own; the decided one nothing')
assert.equal(writes, 1, 'one tombstone write')
ok('clearing the chat log: each waiting card sends its own "deleted", a decided one nothing, and the tombstones are written once')

/* -------------------------------------------- */
/*  22. The expiry sweep                        */
/* -------------------------------------------- */

for (const actor of [thorin, vex, bree]) for (const effect of dishEffects(actor)) await effect.delete()
await setWorldTime(10_000)
const sweep = (await serve(dishOf(BOON()))).card
await applyDish(sweep, ['thorin'])
await setWorldTime(10_000 + 86_399)
await settle()
assert.equal(dishEffects(thorin).length, 1, 'not before its time')
await setWorldTime(10_000 + 86_400)
await until(() => !dishEffects(thorin).length, 'deleted at its time')
// Only on the bridge, and once on taking over.
const takeover = (await serve(dishOf(BOON()))).card
await applyDish(takeover, ['thorin'])
gm.isActiveGM = false
checkBridge()
await setWorldTime(10_000 + 86_400 * 3)
await settle()
assert.equal(dishEffects(thorin).length, 1, 'not on a client that is not the bridge')
gm.isActiveGM = true
checkBridge()
await until(() => !dishEffects(thorin).length, 'swept on taking over')
await settle(60)
// With the switch off.
const switched = (await serve(dishOf(BOON()))).card
await applyDish(switched, ['thorin'])
await campaignAs({ dishes: false })
await setWorldTime(game.time.worldTime + 86_400)
await until(() => !dishEffects(thorin).length, 'swept with the switch off')
await campaignAs({ dishes: true })
// One already deleted meanwhile, as dnd5e 6 or Times Up may: skipped, never a throw.
const two = (await serve(dishOf(BOON()))).card
await applyDish(two, ['thorin', 'vex'])
const vexEffect = dishEffects(vex)[0]
const meanwhile = Hooks.on('deleteActiveEffect', effect => ((effect.parent === thorin) ? vex.deleteEmbeddedDocuments('ActiveEffect', [vexEffect.id]) : undefined))
game.time.worldTime += 86_400
const swept = await expireDishEffects()
Hooks.off('deleteActiveEffect', meanwhile)
await settle()
assert.deepEqual(swept.failed, [], 'no throw')
assert.deepEqual([dishEffects(thorin).length, dishEffects(vex).length], [0, 0])
// Deleting those still held: one gone meanwhile is done, never a throw.
const heldOne = (await serve(dishOf(BOON()))).card
await applyDish(heldOne, ['thorin'])
await deleteHeld(thorin, ['gone-meanwhile', dishEffects(thorin)[0].id])
assert.equal(dishEffects(thorin).length, 0, 'the one still held deleted')
// Lengthened by hand to 48 hours: kept at 24, deleted at 48. Shortened, marked expired: deleted.
const lengthened = (await serve(dishOf(BOON()))).card
const start = game.time.worldTime
await applyDish(lengthened, ['thorin', 'bree'])
await dishEffects(thorin)[0].update({ 'duration.value': 48 })
await dishEffects(bree)[0].update({ 'duration.expired': true })
await setWorldTime(start + 1)
await until(() => !dishEffects(bree).length, 'the shortened one')
await setWorldTime(start + 86_400)
await settle()
assert.equal(dishEffects(thorin).length, 1, 'lengthened: kept at 24 hours')
await setWorldTime(start + 2 * 86_400)
await until(() => !dishEffects(thorin).length, 'deleted at 48 hours')
// Taken out of the campaign after eating, still loses it.
const leaving = (await serve(dishOf(BOON()))).card
await applyDish(leaving, ['bree'])
await campaignAs({ characters: ['thorin', 'vex', 'full', 'long'] })
await setWorldTime(game.time.worldTime + 86_400)
await until(() => !dishEffects(bree).length, "a character no longer the campaign's")
ok("the sweep deletes a dish effect at its time, not before; only on the bridge, and once on taking over; with the switch off; one already deleted skipped without a throw; lengthened by hand, at its new time; marked expired, at once; a character taken out of its campaign's too")

process.exit(0)
