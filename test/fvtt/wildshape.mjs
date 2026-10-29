// Wild Shape from the app (module 0.40.0, its contract §2, §3, §4.1, §6, §10.2): the hello's
// `features.wildShape`, after `effects`, by the campaign's own switch under D&D Fifth Edition; the
// fetching it needs with every other switch off, and the app's answer `wildShape: 1`; a 2024 druid's
// `wildShape` block and a shaped character's sheet, its form's, under her own id with `form`; the
// Beasts she may learn from the campaign's compendiums (`forms`), learning one (`learn`) and replacing
// one after a Long Rest; changing (`transform`) with dnd5e's own Wild Shape preset, the use spent on
// her own feature, the record on the form, her tokens on every scene, and the chat line; the module's
// temporary hit points and Circle of the Moon's armor class floor; returning (`revert`) and what comes
// back, as sums, of what she spent and gained in form; a party's Long Rest while shaped; changing
// while shaped; the endings (time, 0 hit points, Incapacitated) on the bridge alone; transformations
// made in Foundry, the deletion safety net and a player's leftover form; the refusals, the queue; the
// seat while shaped (case 10: rolls, attacks, initiative, End Turn, chat, prompts, charges, the cook,
// concentration and combats follow the form, for the character's seat, and favorites, effects, moves
// and removals wait); Manage Campaigns and the settings row; and with DND5E6=1, dnd5e 6.0.5's
// condition effects and a token's `level`. The real module and its language file; dnd5e 5.3.3's real
// dice classes for the self-test; a stand-in Foundry core and app; dnd5e's transformation ported in
// transform5e.mjs, with dnd5e 5.3.3's own Beasts. MIDI=1 adds the Midi-QOL stand-ins, midi-fake.mjs's
// workflow with midi-saves.mjs's saves, and with them case 10's Midi save and concentration card asked
// of a form, the seat's (round 0.40.0 §4.2). Timers of a second or more run a hundred times faster.
// Run with SLIM_CHECK=1 and --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'
import { find, openSettings, save, tick, view } from './settings-app.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
const MIDI = Boolean(process.env.MIDI)
import { DND5E5 } from './paths.mjs'
const DICE = `${DND5E5}/module/dice`
const ok = message => console.log('ok -', message)

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
game.documentTypes = { Actor: ['character', 'npc', 'group'], Item: ['weapon', 'equipment', 'consumable', 'feat', 'spell', 'class', 'subclass'] }
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
ui.notifications.error = () => {}
ui.notifications.info = () => {}

if (MIDI) {
  const fake = await import('./midi-fake.mjs')
  fake.installMidi()
  game.modules.set('midi-qol', { active: true, version: '13.0.60' })
  // Midi's saves on its workflow, and its concentration card, so that case 10 asks one of a form.
  globalThis.DOMParser ??= window.DOMParser
  const { Actor5e } = await import('./actor5e.mjs')
  const { Character } = await import('./dnd5e-cards.mjs')
  const saves = await import('./midi-saves.mjs')
  saves.installMidiSaves({ actorClasses: [Actor5e], concentrationClass: Character })
}

const tokenCore = await import('./token-core.mjs')
const { scene, placeToken, combatOf, faults: tokenFaults } = tokenCore
const t5 = await import('./transform5e.mjs')
const { port, installTransformCore, transformWorld, withTokenBatches, beastUuid, packs, rest, partyOf, TransformationSetting, CR_PROFILES } = t5
installTransformCore()
const { setWorldTime } = await import('./dish-core.mjs')

// ---- The world: the Gamemaster, the bridge, three players, two scenes ----
users.activeGM = user('gm', 'Gamemaster', true)
const alice = user('alice', 'Alice')
user('bob', 'Bob')
user('carol', 'Carol')
const { elowen, rowan, oak, fern, thorin, ogre } = transformWorld()
const hall = withTokenBatches(scene('hall', { active: true, name: 'The Hall' }))
const forest = withTokenBatches(scene('forest', { name: 'The Forest' }))
// The Gamemaster views the Forest, so dnd5e's own switch reaches the Forest's tokens alone.
tokenFaults.canvasScene = 'forest'
const tokenOf = (on, base, id) => {
  const token = placeToken(on, base, { id, actorLink: true })
  Object.assign(token, { bar1: { attribute: 'attributes.hp' }, displayBars: 40, disposition: 1, rotation: 0, elevation: 0, flags: {}, ...(DND5E6 && { level: 2 }) })
  return token
}
const elowenHall = tokenOf(hall, elowen, 'elowenHallToken0')
const elowenForest = tokenOf(forest, elowen, 'elowenForestTkn0')
tokenOf(hall, rowan, 'rowanHallToken00')
tokenOf(hall, thorin, 'thorinHallToken0')
const fight = combatOf('fight', [{ id: 'cbElowen', actor: elowen, token: elowenHall, fields: { follows: elowenHall } }])
fight.round = 1
fight.turn = 0

// ---- The app: it says it takes Wild Shape, unless told to say otherwise ----
const app = { events: [], polls: [], waiting: new Map(), wake: null, features: new Map(), open: new Map() }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const id = body.campaign?.id
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    return ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
      ? json({ features: app.features.get(id) ?? { commands: true, wildShape: 1 } })
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
    return json({ commands, open: app.open.get(id) ?? [] })
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
const BASE = { actorId: 'elowen', kind: 'wildShape', mode: 0, explicit: false, extras: [], dice: [] }
/** A Wild Shape, as the app hands it over. */
const shaping = (wildShape, fields = {}) => ({ id: `shape-${++ids}`, ...BASE, wildShape, ...fields })
const transform = (form, fields) => shaping({ op: 'transform', form }, fields)
const revert = fields => shaping({ op: 'revert' }, fields)
const learn = (uuid, replace = null, fields) => shaping({ op: 'learn', uuid, replace }, fields)
const listing = fields => shaping({ op: 'forms' }, fields)
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
const DONE = { status: 'done', reason: null, error: null, rolls: [] }
const DONE_NOT_SHAPED = ['done', null, null]
/** The sheets of a character sent between a command's fetch and its result. */
const sheetsIn = ({ after }, id = 'elowen') => after.filter(e => (e.type === 'character.updated') && (e.data.character.id === id))
/** The last sheet sent of a character. */
const lastSheet = (id = 'elowen') => sent('character.updated').filter(e => e.data.character.id === id).at(-1)?.data.character.sheet
/** The uuid of a Beast of the 2024 Actors. */
const uuidOf = name => beastUuid(name)
/** A character's Wild Shape item, and its known forms' profiles. */
const WILD_SHAPE = 'phbdrdWildShape0'
const ACTIVITY = 'FsDnynyqno8XNHgf'
const shapeItem = (actor = elowen) => actor.items.get(WILD_SHAPE)
const profilesOf = (actor = elowen) => shapeItem(actor).system.activities.get(ACTIVITY).profiles
const formOf = (actor = elowen) => game.actors.find(each => (each.flags?.dnd5e?.isPolymorphed === true) && (each.flags.dnd5e.originalActor === actor.id)
  && !game.actors.some(other => (other.flags?.dnd5e?.previousActorIds ?? []).includes(each.id)))
const recordOf = form => form?.flags?.['sending-stone']?.form
const endedOf = (actor = elowen) => shapeItem(actor).flags?.['sending-stone']?.wildShape?.ended ?? null
const linesSince = mark => [...messages.values()].slice(mark).filter(m => m.flags?.['sending-stone']?.wildShape).map(m => m.content)
/** Become the Gamemaster again, or another user, as that user's client. */
const as = who => Object.defineProperty(game, 'user', { configurable: true, get: () => users.get(who) })

// ---- Start-up, as Foundry would ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
const CAMPAIGN = {
  id: 'camp-a', title: 'Ashlands', characters: ['elowen', 'rowan', 'oak', 'fern', 'thorin'], groups: [],
  rolls: false, attacks: false, transfers: false, dishes: false, effects: false,
}
settings.set('campaigns', [CAMPAIGN])
await Hooks.callAll('ready')
await until(() => sent('bridge.hello').length, 'the hello')
await settle(80)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { wildShapeReader } = await import(`${MODULE}/scripts/command-wildshape.mjs`)
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { campaignCharacterId, candidateActors, activeForm } = await import(`${MODULE}/scripts/characters.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const { eligible, wildShapeRules } = await import(`${MODULE}/scripts/wild-shape.mjs`)
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

/* -------------------------------------------- */
/*  1. The hello                                */
/* -------------------------------------------- */

const OFF = { enabled: false, kinds: [], reason: 'off' }
const ON = { enabled: true, kinds: ['wildShape'], reason: null }
const SYSTEM = { enabled: false, kinds: [], reason: 'system' }
assert.deepEqual(helloOf().features.wildShape, OFF, 'off by default, a campaign saved without the field')
assert.deepEqual(Object.keys(helloOf().features), ['rolls', 'transfers', 'removals', 'notes', 'companions', 'favorites', 'dishes', 'effects', 'wildShape'])
await campaignAs({ wildShape: true })
assert.deepEqual(helloOf().features.wildShape, ON, 'a saved switch sends the hello again, on')
assert.ok(!helloOf().features.rolls.kinds.includes('wildShape') && !helloOf().features.companions.kinds.includes('wildShape'), "never among the rolls' kinds, nor a companion's")
game.system.id = 'pf2e'
await hello()
assert.deepEqual(helloOf().features.wildShape, SYSTEM, 'under another system')
game.system.id = 'dnd5e'
await campaignAs({ wildShape: false })
game.system.id = 'pf2e'
await hello()
assert.deepEqual(helloOf().features.wildShape, OFF, '"off" before "system"')
game.system.id = 'dnd5e'
await campaignAs({ wildShape: true })
assert.deepEqual(helloOf().features.wildShape, ON)
ok(`the hello's features.wildShape, last, after effects: off with the switch off, a campaign saved without it among them; "system" with it on under another system, "off" before it; on under dnd5e ${DND5E6 ? '6.0.5' : '5.3.3'}; a saved switch sends the hello again; never among the rolls' or a companion's kinds`)

/**
 * Round 0.42.1 §U.7.1 case 10, under dnd5e 5.3.3 (11c) and 6.0.5 (18): one of her spell slots spent
 * from the app, for an app that takes Wild Shape, is refused while she's shaped, neither her own pool
 * nor the form's changed and nothing posted; once she's back, it's spent from her own. The campaign,
 * her Wild Shape's uses, hit points and slots are left as they were.
 * @param {string} formId   The known form she takes.
 */
async function slotWhileShaped(formId) {
  await campaignAs({ rolls: true, attacks: true })
  const was = { spent: shapeItem().system.uses.spent, hp: elowen.system.attributes.hp.value, temp: elowen.system.attributes.hp.temp }
  await shapeItem().update({ 'system.uses.spent': 0 })
  const slot = from => ({ id: `slot-${++ids}`, actorId: 'elowen', kind: 'spellSlot', spellSlot: { op: 'spend', id: 'spell1', from }, mode: 0, explicit: false, extras: [], dice: [] })
  assert.equal((await made(transform(formId))).result.status, 'done')
  const form = formOf()
  const pools = () => [elowen.system.spells.spell1.value, form.system.spells?.spell1?.value]
  const before = pools()
  const mark = messages.size
  const shaped = await made(slot(elowen.system.spells.spell1.value))
  assert.deepEqual(refusal(shaped), ['failed', 'shaped', null])
  assert.deepEqual([pools(), messages.size], [before, mark], "neither her pool nor the form's changed, and nothing posted")
  assert.equal((await made(revert())).result.status, 'done')
  const left = elowen.system.spells.spell1.value
  const back = await made(slot(left))
  assert.deepEqual([back.result.status, elowen.system.spells.spell1.value, messages.get(back.result.messageId)?.content],
    ['done', left - 1, '<p>Spends a spell slot · spell1</p>'], 'spent from her own once she is back')
  await elowen.update({ 'system.spells.spell1.value': left, 'system.attributes.hp.value': was.hp, 'system.attributes.hp.temp': was.temp })
  await shapeItem().update({ 'system.uses.spent': was.spent })
  await campaignAs({ rolls: false, attacks: false })
}

if (DND5E6) {
  /* ------------------------------------------ */
  /*  18. dnd5e 6.0.5                           */
  /* ------------------------------------------ */
  {
    const learned = await made(learn(uuidOf('Wolf')))
    assert.equal(learned.result.status, 'done')
    const wolf6Id = profilesOf()[0]._id
    const tokenMark6 = port.tokenWrites.length
    const changed6 = await made(transform(wolf6Id))
    const wolf6 = formOf()
    assert.deepEqual([changed6.result.status, wolf6?.name, elowenHall.actorId, elowenForest.actorId], ['done', 'Elowen (Wolf)', wolf6.id, wolf6.id], 'transformed, both tokens switched')
    assert.ok(port.tokenWrites.slice(tokenMark6).every(each => each.updates.every(update => update.level === 2)), "each token's level kept in the switch")
    assert.deepEqual([elowenHall.level, elowenForest.level], [2, 2])
    await wolf6.toggleStatusEffect('prone', { active: true })
    const prone6 = wolf6.effects.find(effect => effect.statuses.has('prone'))
    assert.equal(prone6.type, 'condition', "dnd5e 6's Prone, a condition effect")
    // While she is the Wolf, the Hall's token, on the scene not viewed, moved to another level and hidden.
    assert.ok(!('level' in elowenHall.flags.dnd5e.previousTokenData) && !('hidden' in elowenHall.flags.dnd5e.previousTokenData), "where it stands not kept at the change, as dnd5e 6's")
    Object.assign(elowenHall, { level: 3, hidden: true })
    const reverted6 = await made(revert())
    assert.deepEqual([reverted6.result.status, formOf(), elowenHall.actorId, elowenForest.actorId], ['done', undefined, 'elowen', 'elowen'], 'returned, her tokens hers')
    assert.deepEqual([elowenHall.level, elowenHall.hidden, elowenForest.level], [3, true, 2], 'each level kept as it is now, the Hall\'s hidden still')
    const prones = elowen.effects.filter(effect => effect.statuses.has('prone'))
    assert.deepEqual([prones.length, prones[0]?.type, prones[0]?.id], [1, 'condition', dnd5e.utils.staticID('dnd5eprone')], 'the type "condition" Prone carried back, one effect')
    assert.deepEqual(lastSheet().form, undefined)
  }
  ok('dnd5e 6.0.5: transform and return as cases 7 and 11, each token keeping its level, and on the return the level and visibility it has then; a type "condition" Prone gained in form carried back as one condition effect')
  await slotWhileShaped(profilesOf()[0]._id)
  ok('dnd5e 6.0.5, since 0.42.1: a spell slot spent from the app while she is shaped "shaped", her pool and the form\'s unchanged, nothing posted; once she is back, spent from her own')
  process.exit(0)
}


/* -------------------------------------------- */
/*  2. Fetching                                 */
/* -------------------------------------------- */

const { send } = await import(`${MODULE}/scripts/transport.mjs`)
const pollsOf = () => app.polls.filter(id => id === 'camp-a').length
const polling = async () => { const before = pollsOf(); await settle(150); return pollsOf() > before + 1 }
const campaign = () => getCampaigns()[0]
assert.deepEqual([campaign().rolls, campaign().transfers, campaign().dishes, campaign().effects], [false, false, false, false], 'every other switch off')
assert.equal(await polling(), true, 'fetched for, the answer {commands: true, wildShape: 1} alone')
for (const [features, why] of [
  [{ wildShape: 1 }, 'without commands'], [{ commands: true, wildShape: 0 }, 'wildShape: 0'], [{ commands: true, wildShape: '1' }, 'wildShape: "1"'],
  [{ commands: true, wildShape: true }, 'wildShape: true'], [{ commands: true }, 'an answer without wildShape'],
]) {
  app.features.set('camp-a', features)
  await hello()
  await settle(60)
  assert.equal(await polling(), false, why)
}
assert.equal(wildShapeReader('camp-a'), false, 'the reader dropped by an answer without wildShape')
// A heartbeat's answer that gains it sends the campaign's sheets again, with no hello.
let mark = app.events.length
app.features.delete('camp-a')
send('bridge.heartbeat', {}, campaign(), { sequenced: false })
await until(() => wildShapeReader('camp-a'), 'the reader on')
await until(() => sent('character.updated').filter(e => app.events.indexOf(e) >= mark).length >= 5, "the campaign's sheets again")
assert.deepEqual(new Set(sent('character.updated').filter(e => app.events.indexOf(e) >= mark).map(e => e.data.character.id)),
  new Set(['elowen', 'rowan', 'oak', 'fern', 'thorin']), 'every character')
assert.equal(sent('bridge.hello').filter(e => app.events.indexOf(e) >= mark).length, 0, 'with no hello')
assert.ok(lastSheet('elowen').wildShape, 'with her Wild Shape now')
assert.equal(await polling(), true, 'fetched again')
await campaignAs({ wildShape: false })
await settle(60)
assert.equal(await polling(), false, 'the switch off: not fetched for, the app taking Wild Shape though it does')
await campaignAs({ wildShape: true })
await settle(60)
assert.equal(await polling(), true)
ok('with every other switch off, the campaign is fetched for where its switch is on and the answer says wildShape: 1 with commands; 0, "1", true, none or no commands don\'t count, and an answer without it drops the reader; a heartbeat\'s answer gaining it sends every character\'s sheet again with no hello; the switch off, not fetched for')

/* -------------------------------------------- */
/*  3. The block                                */
/* -------------------------------------------- */

const blockOf = id => lastSheet(id).wildShape
const ELOWEN_BLOCK = {
  item: WILD_SHAPE, uses: { value: 2, max: 2 }, level: 5, circle: null, limits: { count: 6, cr: 0.5, fly: false }, hours: 2, temp: 5,
  acFloor: null, known: [], swap: false, resurgence: true, ended: null,
}
assert.deepEqual(blockOf('elowen'), ELOWEN_BLOCK, "Elowen's")
assert.deepEqual(Object.keys(blockOf('elowen')), Object.keys(ELOWEN_BLOCK), 'its keys in their order')
const rowanBlock = blockOf('rowan')
assert.deepEqual([rowanBlock.level, rowanBlock.circle, rowanBlock.limits, rowanBlock.hours, rowanBlock.temp, rowanBlock.acFloor, rowanBlock.uses, rowanBlock.resurgence],
  [6, 'moon', { count: 6, cr: 2, fly: false }, 3, 18, 16, { value: 3, max: 3 }, false], "Rowan's, of the Moon")
assert.deepEqual([blockOf('oak').limits, blockOf('oak').hours, blockOf('oak').temp], [{ count: 8, cr: 1, fly: true }, 4, 8], "Oak's")
assert.equal(blockOf('fern'), undefined, "Fern's, a 2014 druid's: none")
assert.equal(blockOf('thorin'), undefined, "Thorin's: none")
assert.equal(lastSheet('elowen').form, undefined, 'no form while she is herself')
app.features.set('camp-a', { commands: true })
await hello()
assert.equal(blockOf('elowen'), undefined, 'to an app that takes no Wild Shape: none')
app.features.delete('camp-a')
await hello()
assert.deepEqual(blockOf('elowen'), ELOWEN_BLOCK)
ok("the wildShape block: Elowen's {level 5, limits {count 6, cr 0.5, fly false}, hours 2, temp 5, acFloor null, known [], swap false, resurgence true, ended null}, its keys in order; Rowan's of the Moon {cr 2, temp 18, acFloor 16}; Oak's {fly true, count 8}; none for Fern (2014) or Thorin, nor to an app that takes no Wild Shape")

/* -------------------------------------------- */
/*  4. forms                                    */
/* -------------------------------------------- */

const ELOWEN_FORMS = ['Rat', 'Spider', 'Panther', 'Riding Horse', 'Wolf', 'Black Bear', 'Crocodile', 'Reef Shark']
let writes = port.tokenWrites.length
let items = 0
const countItems = Hooks.on('updateItem', () => { items++ })
let it = await made(listing())
assert.deepEqual(it.result, { id: it.command.id, ...DONE, messageId: null, visible: true, wildShape: it.result.wildShape })
assert.deepEqual(Object.keys(it.result.wildShape), ['op', 'forms', 'more', 'limits'])
assert.deepEqual([it.result.wildShape.op, it.result.wildShape.more, it.result.wildShape.limits], ['forms', false, { count: 6, cr: 0.5, fly: false }])
assert.deepEqual(it.result.wildShape.forms.map(form => form.name), ELOWEN_FORMS, 'by Challenge Rating, then name')
const wolfRow = it.result.wildShape.forms.find(form => form.name === 'Wolf')
assert.deepEqual(wolfRow, {
  uuid: uuidOf('Wolf'), name: 'Wolf', img: 'systems/dnd5e/tokens/beast/Wolf.webp', size: 'Medium', cr: 0.25, ac: 12, speeds: ['Walk 40 ft'], known: false,
}, "the Wolf's row, its armor class worked out from its Dexterity")
assert.ok(it.result.wildShape.forms.every(form => Number.isFinite(form.ac) && form.speeds.length), 'each with its armor class and speeds')
// Read from the index as dnd5e 5.3.3 saves every 2024 Beast's speeds (wolf.yml:353-356): each a formula,
// "40", and no units, which only a prepared document has as 40 and "ft".
const wolfSaved = packs.get('dnd5e.actors24').index.get(uuidOf('Wolf').split('.').at(-1)).system.attributes.movement
assert.deepEqual([wolfSaved.walk, wolfSaved.units], ['40', null], "the Wolf's index entry as saved")
assert.deepEqual(it.result.wildShape.forms.find(form => form.name === 'Black Bear').speeds, ['Walk 30 ft', 'Climb 30 ft', 'Swim 30 ft'],
  "the Black Bear's three speeds, as dnd5e labels them")
assert.equal(it.result.wildShape.forms.find(form => form.name === 'Crocodile').ac, 12, "the Crocodile's natural armor")
assert.deepEqual([sheetsIn(it), items, port.tokenWrites.length - writes], [[], 0, 0], 'nothing written, no sheet sent')
it = await made(listing({ actorId: 'oak' }))
const oakForms = it.result.wildShape.forms.map(form => form.name)
assert.deepEqual(oakForms, ['Rat', 'Spider', 'Giant Bat', 'Panther', 'Riding Horse', 'Wolf', 'Black Bear', 'Crocodile', 'Giant Wasp', 'Reef Shark', 'Brown Bear', 'Dire Wolf'],
  "Oak's adds the Giant Bat and Giant Wasp (fly at level 8), the Brown Bear and Dire Wolf (CR 1)")
assert.ok(!oakForms.includes('Giant Eagle'), 'still no Giant Eagle, a Celestial')
assert.deepEqual(it.result.wildShape.limits, { count: 8, cr: 1, fly: true })
// The Giant Insect, a Beast with no Challenge Rating, is in the Summons' folder too: by its CR alone, outside it, never.
const insect = packs.get('dnd5e.actors24').index.get('phbmobGiantInsec')
assert.deepEqual([eligible(insect, wildShapeRules(oak), packs.get('dnd5e.actors24')), eligible({ ...insect, folder: null }, wildShapeRules(oak), null)], [false, false],
  'a Beast with no Challenge Rating, in a summon\'s folder or not')
Hooks.off('updateItem', countItems)
// A flying Beast saved under dnd5e 6, its speeds under movement.speeds as a compendium the Gamemaster
// built holds them, the index unmigrated: never listed, learned or taken below level 8.
const HAWK = {
  _id: 'hawkSix000000000', name: 'Hawk Six', type: 'npc', img: 'icons/hawk.webp',
  system: {
    abilities: { str: { value: 5 }, dex: { value: 16 }, con: { value: 8 }, int: { value: 2 }, wis: { value: 14 }, cha: { value: 6 } },
    attributes: { ac: { calc: 'natural', flat: 13 }, hp: { value: 1, max: 1 }, movement: { speeds: { fly: '60', walk: '10' } } },
    details: { cr: 0, type: { value: 'beast' } }, traits: { size: 'tiny' },
  },
}
const homebrew = new t5.PackStandIn({ collection: 'world.homebrew', title: 'Homebrew', packageType: 'world', documents: [HAWK] })
packs.set(homebrew.collection, homebrew)
await campaignAs({ wildShapePacks: ['dnd5e.actors24', 'world.homebrew'] })
const hawk = 'Compendium.world.homebrew.Actor.hawkSix000000000'
await homebrew.getIndex({ fields: ['system.attributes.movement', 'system.details.cr', 'system.details.type'] })
assert.deepEqual(homebrew.index.get(HAWK._id).system.attributes.movement.speeds, { fly: '60', walk: '10' }, 'its index as saved, dnd5e 6\'s shape')
assert.deepEqual([eligible(homebrew.index.get(HAWK._id), wildShapeRules(elowen), homebrew), eligible(homebrew.index.get(HAWK._id), wildShapeRules(oak), homebrew)], [false, true],
  "a Fly Speed under movement.speeds: refused below level 8, Oak's at 8")
assert.ok(!(await made(listing())).result.wildShape.forms.some(form => form.name === 'Hawk Six'), "not among Elowen's Beasts")
assert.ok((await made(listing({ actorId: 'oak' }))).result.wildShape.forms.some(form => form.name === 'Hawk Six'), "among Oak's")
assert.deepEqual(refusal(await made(learn(hawk))), ['failed', 'form', null], 'not learned by Elowen')
// More than MOST_FORMS Beasts in the ticked compendiums: the first 200 by Challenge Rating then name, and more.
const HORDE = Array.from({ length: 205 }, (_, n) => ({
  _id: `hordeBeast${String(n).padStart(6, '0')}`, name: `Horde Beast ${String(n).padStart(3, '0')}`, type: 'npc',
  system: { attributes: { movement: { walk: 30 } }, details: { cr: 0.125, type: { value: 'beast' } }, traits: { size: 'sm' } },
}))
const horde = new t5.PackStandIn({ collection: 'world.horde', title: 'Horde', packageType: 'world', documents: HORDE })
packs.set(horde.collection, horde)
await campaignAs({ wildShapePacks: ['dnd5e.actors24', 'world.horde'] })
it = await made(listing())
assert.deepEqual([it.result.wildShape.forms.length, it.result.wildShape.more], [200, true], 'at most 200, more: true past it')
assert.deepEqual(it.result.wildShape.forms.map(form => form.name), ['Rat', 'Spider', ...HORDE.slice(0, 198).map(beast => beast.name)],
  'the first 200 by Challenge Rating (0, then ⅛), then name')
await campaignAs({ wildShapePacks: ['dnd5e.actors24'] })
packs.delete('world.homebrew')
packs.delete('world.horde')
// A forms sent while a roll of Elowen's is held is answered before it: its own queue.
await campaignAs({ rolls: true })
elowen.hang = true
const held = { id: 'roll-held', actorId: 'elowen', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }] }
const behind = listing()
app.waiting.set('camp-a', [held, behind])
app.wake?.()
await until(() => resultIndex(behind.id) >= 0, 'the forms behind the held roll')
assert.equal(resultIndex(held.id), -1, 'answered while the roll is still held')
await until(() => resultIndex(held.id) >= 0, "the held roll's watchdog", 8000)
elowen.hang = false
await campaignAs({ rolls: false })
ok("forms: Elowen's eight Beasts by Challenge Rating then name, each with its armor class (the Wolf's 12, worked out) and speeds, read from the index as dnd5e 5.3.3 saves them (\"40\", no units) and labelled as a prepared sheet's (\"Walk 40 ft\"), none flying, above CR ½, a Celestial, a swarm, CR-less, in a spell's, an item's or a summon's folder, or from dnd5e.monsters; Oak's adds the Giant Bat, Giant Wasp, Brown Bear and Dire Wolf, never the Giant Eagle; a flying Beast saved in dnd5e 6's shape (movement.speeds.fly) refused below level 8, listed for Oak, never learned by Elowen; past 200 Beasts, the first 200 by CR then name and more: true; nothing written, no sheet sent; answered while a roll of Elowen's is held, on its own queue")

/* -------------------------------------------- */
/*  5. learn                                    */
/* -------------------------------------------- */

const itemWrites = []
Hooks.on('updateItem', (item, changes, options) => itemWrites.push({ actor: item.actor?.id, item: item.id, changes, options }))
const knownOf = (id = 'elowen') => lastSheet(id).wildShape.known
mark = itemWrites.length
it = await made(learn(uuidOf('Wolf')))
const wolfId = profilesOf()[0]?._id
assert.deepEqual(it.result, { id: it.command.id, ...DONE, messageId: null, visible: true,
  wildShape: { op: 'learn', form: { id: wolfId, name: 'Wolf', uuid: uuidOf('Wolf') }, replaced: null } })
const activity = shapeItem().system.activities.get(ACTIVITY)
assert.equal(activity.transform.mode, '', 'her Wild Shape now links its forms')
assert.deepEqual(activity.profiles.map(profile => [profile.name, profile.uuid]), [['Wolf', uuidOf('Wolf')]], 'one profile, the CR profiles gone')
assert.ok(!activity.profiles.some(profile => CR_PROFILES.includes(profile._id)))
assert.match(wolfId, /^[A-Za-z0-9]{16}$/)
assert.deepEqual(itemWrites.slice(mark).map(each => [each.item, each.options.sendingStone]), [[WILD_SHAPE, 'wildShape']], 'one write of her Wild Shape, marked')
assert.ok(sheetsIn(it).length >= 1, 'the sheet before the result')
assert.deepEqual(sheetsIn(it).at(-1).data.character.sheet.wildShape.known.map(each => each.name), ['Wolf'])
await until(() => knownOf()[0]?.ac === 12, "the Wolf's summary, once loaded")
assert.deepEqual(knownOf()[0], {
  id: wolfId, uuid: uuidOf('Wolf'), name: 'Wolf', img: 'systems/dnd5e/tokens/beast/Wolf.webp', size: 'Medium', cr: 0.25, ac: 12,
  speeds: ['Walk 40 ft'], attack: { name: 'Bite', toHit: 4, damage: '1d6 + 2' }, pool: true, fits: true,
}, "known[0], the Wolf, as dnd5e's own stat block has it")
for (const name of ['Black Bear', 'Panther', 'Rat', 'Spider', 'Reef Shark']) {
  it = await made(learn(uuidOf(name)))
  assert.equal(it.result.status, 'done', name)
}
assert.deepEqual(profilesOf().map(profile => profile.name), ['Wolf', 'Black Bear', 'Panther', 'Rat', 'Spider', 'Reef Shark'], 'six, in the order learned')
assert.equal(profilesOf()[0]._id, wolfId, "the Wolf's id kept")
const profileId = name => profilesOf().find(profile => profile.name === name)._id
mark = itemWrites.length
for (const [command, reason, why] of [
  [learn(uuidOf('Crocodile')), 'full', 'the seventh'],
  [learn(uuidOf('Brown Bear')), 'form', 'the Brown Bear, CR 1'],
  [learn(uuidOf('Giant Bat')), 'form', 'the Giant Bat, flying'],
  [learn(uuidOf('Giant Eagle')), 'form', 'the Giant Eagle, a Celestial'],
  [learn(uuidOf('Swarm of Rats')), 'form', 'a swarm'],
  [learn(uuidOf('Phantom Steed')), 'form', "a spell's creature"],
  [learn(uuidOf('Giant Insect')), 'form', 'a summon with no CR'],
  [learn(beastUuid('Wolf', 'dnd5e.monsters')), 'form', 'the 2014 Wolf, not among the packs'],
  [learn('Compendium.dnd5e.actors24.Actor.nothing000000000'), 'gone', 'an id not in the pack'],
  [learn(uuidOf('Crocodile'), profileId('Panther')), 'swap', 'a replacement with no Long Rest'],
]) {
  it = await made(command)
  assert.deepEqual(refusal(it), ['failed', reason, null], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
it = await made(learn(uuidOf('Wolf')))
assert.deepEqual(it.result.wildShape, { op: 'learn', form: { id: wolfId, name: 'Wolf', uuid: uuidOf('Wolf') }, replaced: null }, 'the Wolf again: done')
assert.deepEqual([itemWrites.slice(mark), sheetsIn(it)], [[], []], 'nothing written for any, no sheet')
ok('learn: the first Wolf switches her Wild Shape to linked forms with one profile {name, uuid}, the CR profiles gone, one write marked, the sheet before the result and then known[0] with ac 12 and the Bite; six learned in order; the seventh "full"; CR 1, flying, a Celestial, a swarm, a spell\'s or CR-less creature and dnd5e.monsters\' Wolf "form"; an id not in the pack "gone"; a replacement with no Long Rest "swap"; the Wolf again done; nothing written for any')

/* -------------------------------------------- */
/*  6. The Long Rest                            */
/* -------------------------------------------- */

const swapOf = (actor = elowen) => shapeItem(actor).flags?.['sending-stone']?.wildShape?.swap
await rest(elowen, { type: 'short' })
await settle()
assert.notEqual(swapOf(), true, 'a short rest: no replacement')
await rest(elowen, { type: 'long' })
await until(() => swapOf() === true, 'the replacement after a Long Rest')
await until(() => lastSheet().wildShape.swap === true, 'swap: true on her sheet')
// A druid of no campaign, with known forms, the switch on: nothing written.
const willow = new t5.TActor({ ...oak.toObject(), _id: 'willow', name: 'Willow' })
actors.set('willow', willow)
await willow.items.get(WILD_SHAPE).update({ [`system.activities.${ACTIVITY}.transform.mode`]: '', [`system.activities.${ACTIVITY}.profiles`]: [{ _id: 'willowWolf000000', name: 'Wolf', uuid: uuidOf('Wolf') }] })
mark = itemWrites.length
await rest(willow, { type: 'long' })
await settle()
assert.deepEqual([itemWrites.slice(mark).filter(each => each.options?.sendingStone), swapOf(willow)], [[], undefined], 'a druid of no campaign: nothing written')
actors.delete('willow')
const pantherId = profileId('Panther')
mark = itemWrites.length
it = await made(learn(uuidOf('Riding Horse'), pantherId))
assert.deepEqual(it.result.wildShape, { op: 'learn', form: { id: pantherId, name: 'Riding Horse', uuid: uuidOf('Riding Horse') }, replaced: { id: pantherId, name: 'Panther' } })
assert.deepEqual(profilesOf().map(profile => [profile._id, profile.name]).find(([id]) => id === pantherId), [pantherId, 'Riding Horse'], "the profile's id kept")
assert.equal(profilesOf().length, 6)
const written = itemWrites.slice(mark).filter(each => each.item === WILD_SHAPE)
assert.equal(written.length, 1, 'one write')
assert.equal(written[0].changes.flags['sending-stone'].wildShape.swap, false, 'swap: false in the same update')
assert.ok(written[0].changes.system.activities[ACTIVITY].profiles, '…as the profiles')
assert.deepEqual(refusal(await made(learn(uuidOf('Crocodile'), profileId('Rat')))), ['failed', 'swap', null], 'a second replacement')
ok('the Long Rest: a short rest gives no replacement; a Long Rest sets swap, on her sheet too; a druid of no campaign, the switch on, gets nothing written; Panther replaced by the Riding Horse keeps its profile\'s id, swap false in the same update; a second replacement "swap"')

/* -------------------------------------------- */
/*  7. transform                                */
/* -------------------------------------------- */

const { PlainEffect, concentrateOn } = await import('./effects-core.mjs')
// Before her first change: Elowen Prone, and concentrating on Moonbeam, which keeps up a glow on Thorin.
await elowen.toggleStatusEffect('prone', { active: true })
await elowen.update({ 'system.attributes.inspiration': true })
const PRONE = dnd5e.utils.staticID('dnd5eprone')
const MOONBEAM = 'moonbeamConc0000'
const glow = new PlainEffect(thorin, { _id: 'moonbeamGlow0000', name: 'Moonbeam (Glow)', origin: 'Actor.elowen.Item.elowenMoonbeam00' })
thorin.effects.push(glow)
concentrateOn(elowen, new PlainEffect(elowen, {
  _id: MOONBEAM, name: 'Concentrating: Moonbeam', origin: 'Actor.elowen.Item.elowenMoonbeam00',
  flags: { dnd5e: { item: { id: 'elowenMoonbeam00', type: 'spell', uuid: 'Actor.elowen.Item.elowenMoonbeam00' } } },
}), [glow])
// And Bless from Rowan, Bob's, an effect the party put on her, which her own sheet lets her player turn off.
const BLESS = 'rowanBlessOnElow'
elowen.effects.push(new PlainEffect(elowen, { _id: BLESS, name: 'Bless', origin: 'Actor.rowan.Item.rowanBless000000', duration: { rounds: 10, value: 10, units: 'rounds', remaining: 10 } }))
await settle(80)
assert.deepEqual(characterSheet(elowen).effects.flatMap(section => section.effects).find(row => row.id === BLESS)?.ops, ['disable', 'delete'], 'Bless offered on her own sheet')
const order = []
const orderItem = Hooks.on('updateItem', (item, changes) => { if ((item.actor?.id === 'elowen') && changes.system?.uses) order.push(`spent ${item.system.uses.spent}`) })
const orderCreate = Hooks.on('createActor', actor => order.push(`created ${actor.name}`))
let tokenMark = port.tokenWrites.length
let messageMark = messages.size
const combatMark = app.events.length
const started = game.time.worldTime
it = await made(transform(wolfId))
Hooks.off('updateItem', orderItem)
Hooks.off('createActor', orderCreate)
const wolf = formOf()
assert.ok(wolf, 'a form')
assert.equal(wolf.name, 'Elowen (Wolf)')
assert.deepEqual(order, ['spent 1', 'created Elowen (Wolf)'], 'one use spent on her own Wild Shape, 2 → 1, before the form exists')
assert.deepEqual([shapeItem().system.uses.value, wolf.items.get(WILD_SHAPE).system.uses.value], [1, 1], 'one left, on hers and on the form\'s copy')
const call = port.transforms.at(-1)
assert.deepEqual([call.host, call.source], ['elowen', uuidOf('Wolf')])
assert.deepEqual(call.settings, {
  effects: ['otherOrigin', 'origin', 'feat', 'spell', 'class', 'background'], keep: ['bio', 'class', 'feats', 'hp', 'languages', 'mental', 'tempHP', 'type'],
  merge: ['saves', 'skills'], other: [], minimumAC: '0', preset: 'wildshape', spellLists: ['subclass:moon'], tempFormula: '5', transformTokens: false,
}, "dnd5e's Wild Shape preset, the module's numbers, no token switch of dnd5e's")
assert.deepEqual(call.options, { renderSheet: false, sendingStone: { request: it.command.id, profile: wolfId } })
const record = recordOf(wolf)
assert.deepEqual(Object.keys(record), ['kind', 'uuid', 'name', 'img', 'cr', 'type', 'size', 'startedAt', 'hours', 'endsAt', 'profile', 'request', 'baseline'])
assert.deepEqual({ ...record, baseline: undefined }, {
  kind: 'wildShape', uuid: uuidOf('Wolf'), name: 'Wolf', img: 'systems/dnd5e/tokens/beast/Wolf.webp', cr: 0.25, type: 'Beast', size: 'Medium',
  startedAt: started, hours: 2, endsAt: started + 7200, profile: wolfId, request: it.command.id, baseline: undefined,
})
assert.deepEqual(record.baseline, {
  hp: 38, temp: 0,
  items: {
    elowenClass00000: { spent: 0, activities: {} }, [WILD_SHAPE]: { spent: 1, activities: { [ACTIVITY]: 0 } }, phbdrdWildResurg: { spent: 0, activities: {} },
    elowenLucky00000: { spent: 0, activities: {} }, elowenFeyStep000: { spent: 0, activities: { feyStepUse000000: 0 } },
  },
  hd: { elowenClass00000: 0 }, inspiration: true, exhaustion: 0, death: { success: 0, failure: 0 }, effects: [PRONE, MOONBEAM, BLESS],
  spells: { spell1: 4, spell2: 3, spell3: 2 },
}, 'what she had going in: her uses, hit dice, hit points, the effects the form carries and her spell slots')
// Her tokens on both scenes, from dnd5e's own partial token data.
const tokenWrites = port.tokenWrites.slice(tokenMark)
assert.deepEqual(tokenWrites.map(each => each.scene).sort(), ['forest', 'hall'], 'one write on each scene: the viewed one and the other')
for (const { updates } of tokenWrites) {
  for (const update of updates) {
    assert.deepEqual([update.actorId, update.actorLink, update.name], [wolf.id, true, 'Elowen (Wolf)'])
    assert.ok(!('light' in update) && !('occlusion' in update), "no light or occlusion from the form's prototype")
    assert.ok(update.flags.dnd5e.previousTokenData && update.flags.dnd5e.isPolymorphed && (update.flags.dnd5e.originalActor === 'elowen'))
    assert.equal(update.texture.src, 'systems/dnd5e/tokens/beast/Wolf.webp')
  }
}
assert.deepEqual([elowenHall.actorId, elowenForest.actorId], [wolf.id, wolf.id], 'both her tokens are the Wolf')
assert.equal(elowenHall.flags.dnd5e.previousTokenData.name, 'Elowen')
// The combat again, her combatant hers.
const combats = app.events.slice(combatMark).filter(e => (e.type === 'combat.created') && (e.campaign?.id === 'camp-a'))
assert.ok(combats.length >= 1, 'the combat sent again')
assert.equal(combats.at(-1).data.combat.combatants.find(cb => cb.id === 'cbElowen').character, 'elowen', 'her combatant, the Wolf\'s token, hers')
assert.deepEqual(linesSince(messageMark), ['<p>Elowen uses Wild Shape and becomes a Wolf.</p>'], 'the chat line')
const line = [...messages.values()].at(-1)
assert.deepEqual([line.author?.id, line.speaker.actor, line.flags['sending-stone'].wildShape], ['alice', 'elowen', { op: 'transform', form: 'Wolf', why: null }])
// Her sheet, under her own id, is the form's.
const shaped = sheetsIn(it).at(-1)?.data.character
assert.ok(shaped, 'the sheet before the result')
assert.deepEqual([shaped.id, shaped.name], ['elowen', 'Elowen'], 'under her own id and name')
assert.deepEqual([shaped.sheet.ac, shaped.sheet.speed, shaped.sheet.hp.value, shaped.sheet.hp.temp], [12, { value: 40, units: 'ft' }, 38, 5], "the Wolf's AC and speed, her hit points, 5 temporary")
assert.deepEqual(shaped.sheet.form, {
  kind: 'wildShape', name: 'Wolf', img: 'systems/dnd5e/tokens/beast/Wolf.webp', size: 'Medium', cr: 0.25, type: 'Beast', profile: wolfId,
  hours: 2, minutesLeft: 120, flooredAc: false, beast: shaped.sheet.form.beast,
})
assert.deepEqual(shaped.sheet.form.beast.abilities, ['str', 'dex', 'con'])
assert.ok(shaped.sheet.form.beast.skills.includes('ste'), 'Stealth the Wolf\'s, above hers')
assert.equal(shaped.sheet.wildShape.uses.value, 1, 'her Wild Shape on the form\'s sheet, one use left')
const rows = shaped.sheet.effects.flatMap(section => section.effects)
assert.ok(rows.some(row => row.id === BLESS) && rows.every(row => Array.isArray(row.ops) && !row.ops.length), "ops [] on every effect, Rowan's Bless on the form among them")
assert.deepEqual(it.result, { id: it.command.id, ...DONE, messageId: line.id, visible: true,
  wildShape: { op: 'transform', form: { id: wolfId, name: 'Wolf', uuid: uuidOf('Wolf') }, temp: 5, hours: 2 } })
// Time left, in whole minutes: a sheet at most once a world minute.
const sheetsSince = from => sent('character.updated').filter(e => (app.events.indexOf(e) >= from) && (e.data.character.id === 'elowen'))
await setWorldTime(started + 1)
await until(() => lastSheet().form.minutesLeft === 119, '119 minutes left')
await settle(80)
mark = app.events.length
await setWorldTime(started + 31)
await settle(120)
assert.equal(sheetsSince(mark).length, 0, '30 s on: no new sheet, minutesLeft unchanged')
await setWorldTime(started + 91)
await until(() => sheetsSince(mark).length, 'a sheet a minute on')
await settle(120)
assert.deepEqual(sheetsSince(mark).map(e => e.data.character.sheet.form.minutesLeft), [118], 'one, a minute on')
// A replacement of the form she's in.
await shapeItem().update({ 'flags.sending-stone.wildShape.swap': true })
assert.deepEqual(refusal(await made(learn(uuidOf('Crocodile'), wolfId))), ['failed', 'shaped', null], "the Wolf's profile, while she's the Wolf: shaped")
await shapeItem().update({ 'flags.sending-stone.wildShape.swap': false })
ok('transform into the Wolf: one use spent on her own Wild Shape (2 → 1) before the form exists; transformInto with the preset, tempFormula "5", minimumAC "0", transformTokens false, renderSheet false; "Elowen (Wolf)" with its record {kind, name, hours 2, endsAt startedAt + 7200, profile, request, baseline}; her tokens switched on both scenes from dnd5e\'s partial token data with previousTokenData; the combat sent again, her combatant hers; the chat line; her sheet under her own id the form\'s (AC 12, walk 40, her hit points, 5 temporary) with form {minutesLeft 120, flooredAc false, beast} and no effect ops; done {form, temp 5, hours 2}; a sheet a world minute, not 30 s, on; a replacement of the form she\'s in "shaped"')

/* -------------------------------------------- */
/*  11. revert                                  */
/* -------------------------------------------- */

// In form: Lucky spent, a hit die spent, Fey Step's own use spent, Heroic Inspiration used, 8 damage
// taken; her own Prone gone and Blinded gained; Moonbeam's concentration broken.
await wolf.items.get('elowenLucky00000').update({ 'system.uses.spent': 1 })
await wolf.items.get('elowenClass00000').update({ 'system.hd.spent': 1 })
await wolf.items.get('elowenFeyStep000').update({ 'system.activities.feyStepUse000000.uses.spent': 1 })
await wolf.update({ 'system.attributes.inspiration': false, 'system.attributes.hp.value': 30 })
await wolf.toggleStatusEffect('prone', { active: false })
await wolf.toggleStatusEffect('blinded', { active: true })
await wolf.effects.get(MOONBEAM).delete()
await settle(80)
assert.ok(elowen.effects.get(MOONBEAM) && thorin.effects.includes(glow), 'her own concentration still there while she is shaped')
// While she is the Wolf, the Gamemaster hides and turns her token on the Hall, the scene not viewed, and
// turns the Forest's: kept so on the return, never what they were at the change.
assert.ok(['rotation', 'elevation', 'hidden', 'level'].every(key => !(key in elowenHall.flags.dnd5e.previousTokenData)), 'where it stands not kept at the change')
Object.assign(elowenHall, { hidden: true, rotation: 90, elevation: 10 })
Object.assign(elowenForest, { hidden: true, rotation: 45 })
const BLINDED = dnd5e.utils.staticID('dnd5eblinded')
const deletes = []
const onDelete = Hooks.on('deleteActor', (actor, options) => deletes.push({ id: actor.id, options }))
tokenMark = port.tokenWrites.length
messageMark = messages.size
it = await made(revert())
Hooks.off('deleteActor', onDelete)
assert.equal(game.actors.get(wolf.id), undefined, 'the form deleted')
assert.deepEqual(deletes, [{ id: wolf.id, options: {} }], "by dnd5e's own return, with no options")
assert.deepEqual([elowenHall.actorId, elowenForest.actorId, elowenHall.name, elowenForest.name], ['elowen', 'elowen', 'Elowen', 'Elowen'], 'her tokens hers again on both scenes')
assert.equal(elowenHall.flags?.dnd5e?.previousTokenData, undefined, 'and their previous token data gone')
assert.deepEqual([elowenHall.hidden, elowenHall.rotation, elowenHall.elevation, elowenForest.hidden, elowenForest.rotation], [true, 90, 10, true, 45],
  'each where it stands now: the Hall\'s hidden and turned by the module, the Forest\'s turned by dnd5e')
Object.assign(elowenHall, { hidden: false, rotation: 0, elevation: 0 })
Object.assign(elowenForest, { hidden: false, rotation: 0 })
assert.deepEqual(port.tokenWrites.slice(tokenMark).map(each => [each.scene, each.options]).sort(),
  [['forest', { diff: false, recursive: false }], ['hall', { diff: false, recursive: false }]], "dnd5e's on the viewed scene, the module's on the other, as dnd5e writes them")
const hp = elowen.system.attributes.hp
assert.deepEqual([hp.value, hp.temp], [30, 5], 'her hit points as the form had them, and the 5 temporary kept')
assert.deepEqual([shapeItem().system.uses.spent, elowen.items.get('elowenLucky00000').system.uses.spent, elowen.items.get('elowenClass00000').system.hd.spent,
  elowen.items.get('elowenFeyStep000').system.activities.get('feyStepUse000000').uses.spent, elowen.system.attributes.inspiration],
[1, 1, 1, 1, false], "her Wild Shape's use as spent, Lucky's, a hit die, Fey Step's and her Heroic Inspiration carried back")
assert.deepEqual([elowen.effects.some(effect => effect.id === PRONE), elowen.effects.filter(effect => effect.id === BLINDED).length], [false, 1],
  'her Prone, removed in form, gone from her; Blinded, gained in form, hers, one effect')
assert.deepEqual([elowen.effects.some(effect => effect.id === MOONBEAM), thorin.effects.includes(glow), elowen.ended.at(-1)], [false, false, 'Concentrating: Moonbeam'],
  'Moonbeam broken in form: her own concentration ended, with what it kept up')
const ended = endedOf()
assert.deepEqual({ ...ended, at: undefined }, { form: 'Wolf', why: 'app', at: undefined, formId: wolf.id })
assert.ok(Math.abs(ended.at - Date.now()) < 5000, 'at the real time')
await settle(80)
assert.deepEqual(endedOf(), ended, 'after FORM_GONE_SETTLE still "app": no "foundry" written over it')
assert.deepEqual(linesSince(messageMark), ['<p>Elowen is no longer a Wolf: Wild Shape ends.</p>'])
const back = sheetsIn(it).at(-1)?.data.character.sheet
assert.ok(back && (back.form === undefined) && (back.ac === 12) && (back.speed.value === 30), 'her own sheet before the result, no form')
assert.deepEqual(back.wildShape.ended, { form: 'Wolf', why: 'app', at: ended.at, formId: wolf.id })
assert.deepEqual(it.result.wildShape, { op: 'revert', form: { name: 'Wolf' } })
it = await made(revert())
assert.deepEqual([it.result.status, it.result.wildShape, sheetsIn(it)], ['done', { op: 'revert', form: null }, []], 'again: done, form null')
ok('revert: the form deleted by dnd5e with no options, then her tokens back on both scenes, each hidden and turned as the Gamemaster left it while she was shaped; her hit points as the form had them, 5 temporary kept; the uses, the hit die and the activity\'s use she spent in form and her Heroic Inspiration used carried back; Prone, removed in form, gone from her; Blinded, gained in form, one effect on her; Moonbeam broken in form ends her concentration and its glow on Thorin; ended {form: Wolf, why: app, formId}, still after FORM_GONE_SETTLE; the chat line; her own sheet before the result; again, done with form null')

/* -------------------------------------------- */
/*  8. The higher temporary hit points          */
/* -------------------------------------------- */

await elowen.toggleStatusEffect('blinded', { active: false })
const reset = async (actor = elowen) => {
  await actor.items.get(WILD_SHAPE).update({ 'system.uses.spent': 0 })
  await actor.update({ 'system.attributes.hp.value': actor.system.attributes.hp.max, 'system.attributes.hp.temp': 0 })
}
for (const [temp, formula] of [[9, '9'], [2, '5']]) {
  await reset()
  await elowen.update({ 'system.attributes.hp.temp': temp })
  it = await made(transform(wolfId))
  assert.equal(port.transforms.at(-1).settings.tempFormula, formula, `with ${temp}: "${formula}"`)
  assert.deepEqual([it.result.wildShape.temp, formOf().system.attributes.hp.temp], [Number(formula), Number(formula)])
  assert.equal((await made(revert())).result.status, 'done')
}
ok('the higher temporary hit points: Elowen with 9 changes with tempFormula "9", with 2 "5"; done says which')

/* -------------------------------------------- */
/*  9. The Moon                                 */
/* -------------------------------------------- */

for (const name of ['Black Bear', 'Brown Bear']) assert.equal((await made(learn(uuidOf(name), null, { actorId: 'rowan' }))).result.status, 'done', name)
const bearId = profilesOf(rowan).find(profile => profile.name === 'Black Bear')._id
const brownId = profilesOf(rowan).find(profile => profile.name === 'Brown Bear')._id
it = await made(transform(bearId, { actorId: 'rowan' }))
const bear = formOf(rowan)
assert.deepEqual([port.transforms.at(-1).settings.minimumAC, port.transforms.at(-1).settings.tempFormula], ['16', '18'], "the Moon's floor, 13 + Wis 3, and three times his level")
assert.deepEqual([bear.system.attributes.ac.value, bear.system.attributes.ac.calc, bear.system.attributes.hp.temp], [16, 'natural', 18])
assert.ok(bear.items.some(item => item.name === 'Moonbeam') && !bear.items.some(item => item.name === 'Shillelagh'), 'the Moon\'s spells kept, no other')
const rowanSheet = sheetsIn(it, 'rowan').at(-1).data.character.sheet
assert.deepEqual([rowanSheet.ac, rowanSheet.form.flooredAc, rowanSheet.form.name, rowanSheet.hp.temp], [16, true, 'Black Bear', 18], "his sheet: AC 16, the Moon's floor")
assert.deepEqual(it.result.wildShape, { op: 'transform', form: { id: bearId, name: 'Black Bear', uuid: uuidOf('Black Bear') }, temp: 18, hours: 3 })
it = await made(transform(brownId, { actorId: 'rowan' }))
assert.deepEqual([it.result.status, formOf(rowan).name], ['done', 'Rowan (Brown Bear)'], 'the Brown Bear, CR 1 within his 2')
assert.equal((await made(revert({ actorId: 'rowan' }))).result.status, 'done')
ok('the Moon: Rowan into the Black Bear (AC 11) with minimumAC "16": AC 16, flooredAc true, 18 temporary, the Moon\'s spells kept; into the Brown Bear, CR 1 within his 2, allowed')

/* -------------------------------------------- */
/*  11b. A party's Long Rest while shaped        */
/* -------------------------------------------- */

const LUCKY = 'elowenLucky00000'
const CLASS = 'elowenClass00000'
const spentOf = (actor, id) => actor.items.get(id).system.uses.spent
const hdOf = actor => actor.items.get(CLASS).system.hd.spent
await reset()
await elowen.items.get(LUCKY).update({ 'system.uses.spent': 2 })
await elowen.items.get(CLASS).update({ 'system.hd.spent': 1 })
await elowen.update({ 'system.attributes.hp.temp': 3, 'system.spells.spell1.value': 2, 'system.spells.spell2.value': 1 })
it = await made(transform(wolfId))
let form = formOf()
await form.items.get(LUCKY).update({ 'system.uses.spent': 3 })
await form.items.get(CLASS).update({ 'system.hd.spent': 2 })
await form.update({ 'system.attributes.hp.value': 30, 'system.spells.spell1.value': 1 })
messageMark = messages.size
const party = partyOf('party', 'The Company', [elowen, thorin])
const clock = game.time.worldTime
await party.rest({ type: 'long' })
assert.equal(game.time.worldTime, clock + 8 * 3600, 'the clock advanced 8 hours')
await until(() => !formOf(), 'the time ending the clock reached')
await settle(80)
assert.deepEqual([spentOf(elowen, LUCKY), hdOf(elowen), shapeItem().system.uses.spent], [1, 1, 0],
  'rested, less only what she spent in form: Lucky 0 + (3 − 2), a hit die 0 + (2 − 1); her Wild Shape back')
assert.deepEqual([elowen.system.attributes.hp.value, elowen.system.attributes.hp.temp], [30, 0], 'her maximum less the 8 taken in form; temp 0, as the rest left it')
assert.deepEqual([elowen.system.spells.spell1.value, elowen.system.spells.spell2.value, elowen.system.spells.spell3.value], [3, 3, 2],
  "her spell slots rested, less the one spent in form: 4 + (1 − 2), 3 + (1 − 1), the third's as it was")
await elowen.update({ 'system.spells.spell1.value': 4 })
assert.deepEqual([endedOf().why, linesSince(messageMark)], ['time', ["<p>Elowen's Wild Shape ends: its 2 hours ran out.</p>"]])
ok("a party's Long Rest while shaped rests her own actor and advances the clock 8 hours to the time ending: after it she is rested, less only what she spent in form (sums, not values), her hit points her maximum less the damage taken in form, temp 0, her spell slots rested less the one spent in form")

/* -------------------------------------------- */
/*  11c. A spell slot while shaped (0.42.1)      */
/* -------------------------------------------- */

await slotWhileShaped(wolfId)
ok('0.42.1: a spell slot spent from the app while she is shaped, for an app that takes Wild Shape, "shaped", her pool and the form\'s unchanged, nothing posted; once she is back, spent from her own')

/* -------------------------------------------- */
/*  12. Change while shaped                     */
/* -------------------------------------------- */

await elowen.items.get(LUCKY).update({ 'system.uses.spent': 0 })
await elowen.items.get(CLASS).update({ 'system.hd.spent': 0 })
await reset()
await shapeItem().update({ 'system.uses.spent': 1 })
it = await made(transform(wolfId))
const wolf3 = formOf()
assert.equal(shapeItem().system.uses.value, 0, 'her last use spent on the Wolf')
// Wild Resurgence in form: a use back on the form's copy, which the change's return carries back first.
await wolf3.items.get(WILD_SHAPE).update({ 'system.uses.spent': 1 })
const blackBearId = profileId('Black Bear')
messageMark = messages.size
it = await made(transform(blackBearId))
const blackBear = formOf()
assert.equal(game.actors.get(wolf3.id), undefined, "the Wolf's form returned")
assert.deepEqual([blackBear.name, game.actors.filter(actor => recordOf(actor) && (actor.flags.dnd5e.originalActor === 'elowen')).length], ['Elowen (Black Bear)', 1],
  'one form, of her own, never "(Wolf) (Black Bear)"')
assert.deepEqual([shapeItem().system.uses.spent, shapeItem().system.uses.value], [2, 0], "the Wolf's carry-back awaited (a use back), then one spent: 1 → 0")
assert.deepEqual(linesSince(messageMark), ['<p>Elowen uses Wild Shape again and becomes a Black Bear.</p>'])
assert.deepEqual([...messages.values()].at(-1).flags['sending-stone'].wildShape, { op: 'transform', form: 'Black Bear', why: 'change' })
assert.equal(endedOf(), null, 'no ending noted')
assert.equal(it.result.wildShape.form.name, 'Black Bear')
assert.deepEqual(refusal(await made(transform(blackBearId))), ['failed', 'form', null], 'the current form')
assert.deepEqual(refusal(await made(transform(wolfId))), ['failed', 'consume', null], 'no use left')
assert.equal((await made(revert())).result.status, 'done')
// Polymorphed by Thorin's ally into the Giant Ape: a transform is refused, the ape stays, no use spent.
await reset()
const polymorph = new TransformationSetting({ ...CONFIG.DND5E.transformation.presets.polymorph.settings, preset: 'polymorph' })
await elowen.transformInto(await fromUuid(uuidOf('Giant Ape')), polymorph)
const ape = formOf()
assert.deepEqual([ape.name, recordOf(ape).kind, recordOf(ape).hours], ['Elowen (Giant Ape)', 'other', null])
it = await made(transform(wolfId))
assert.deepEqual([refusal(it), formOf()?.id, shapeItem().system.uses.spent], [['failed', 'transformed', null], ape.id, 0], 'transformed: the ape stays, no use spent')
assert.deepEqual(refusal(await made(revert())), ['failed', 'transformed', null], "a Polymorph's return is Foundry's")
await ape.revertOriginalForm()
await settle(80)
ok('change while shaped: the Wolf to the Black Bear returns the Wolf first, its carry-back awaited (a use Wild Resurgence gave back in form), then spends one use (1 → 0), one form "Elowen (Black Bear)", the BecameAgain line, ended null; the current form "form"; no use left "consume"; Polymorphed into the Giant Ape, a transform "transformed", the ape kept and no use spent, and its revert "transformed"')

/* -------------------------------------------- */
/*  13. Endings                                 */
/* -------------------------------------------- */

const endsWith = async (why, act, line) => {
  await reset()
  it = await made(transform(wolfId))
  const shape = formOf()
  messageMark = messages.size
  await act(shape)
  await until(() => !game.actors.get(shape.id), `the ${why} ending`)
  await settle(80)
  assert.deepEqual([endedOf().why, linesSince(messageMark)], [why, [line]], why)
  return shape
}
await endsWith('time', () => setWorldTime(game.time.worldTime + 7200), "<p>Elowen's Wild Shape ends: its 2 hours ran out.</p>")
await endsWith('hp', shape => shape.update({ 'system.attributes.hp.value': 0 }), "<p>Elowen's Wild Shape ends at 0 hit points.</p>")
const PARALYZED = dnd5e.utils.staticID('dnd5eparalyzed')
const INCAPACITATED = dnd5e.utils.staticID('dnd5eincapacitated')
await endsWith('incapacitated', shape => shape.toggleStatusEffect('paralyzed', { active: true }), "<p>Elowen's Wild Shape ends: Elowen is Incapacitated.</p>")
assert.deepEqual([elowen.effects.filter(effect => effect.id === PARALYZED).length, elowen.effects.some(effect => effect.id === INCAPACITATED), elowen.statuses.has('incapacitated')],
  [1, false, true], 'on her, one Paralyzed effect and no separate Incapacitated')
assert.deepEqual(refusal(await made(transform(wolfId))), ['failed', 'incapacitated', null], 'no Wild Shape while Paralyzed')
await elowen.toggleStatusEffect('paralyzed', { active: false })
assert.equal((await made(transform(wolfId))).result.status, 'done', 'once it is removed, she can again')
assert.equal((await made(revert())).result.status, 'done')
// A druid of level 2: its hour.
await oak.items.get('oakClass00000000').update({ 'system.levels': 2 })
assert.equal((await made(learn(uuidOf('Rat'), null, { actorId: 'oak' }))).result.status, 'done')
await reset(oak)
it = await made(transform(profilesOf(oak).find(profile => profile.name === 'Rat')._id, { actorId: 'oak' }))
assert.equal(it.result.wildShape.hours, 1)
messageMark = messages.size
await setWorldTime(game.time.worldTime + 3600)
await until(() => !formOf(oak), "Oak's hour")
await settle(80)
assert.deepEqual(linesSince(messageMark), ["<p>Oak's Wild Shape ends: its hour ran out.</p>"])
await oak.items.get('oakClass00000000').update({ 'system.levels': 8 })
// On the bridge alone: a second Gamemaster's client does nothing; the bridge, once.
const gm2 = user('gm2', 'Second Gamemaster', true)
gm2.isActiveGM = false
await reset()
await made(transform(wolfId))
let shape = formOf()
let reverts = port.reverts.length
messageMark = messages.size
as('gm2')
await setWorldTime(game.time.worldTime + 7200)
await settle(80)
assert.ok(game.actors.get(shape.id), "a second Gamemaster's client ends nothing")
as('gm')
await Hooks.callAll('updateWorldTime', game.time.worldTime, 0, {}, 'gm2')
await until(() => !game.actors.get(shape.id), 'the bridge ending it')
await settle(80)
assert.deepEqual([port.reverts.length - reverts, linesSince(messageMark).length], [1, 1], 'once')
// Its fetching stopped while this client wasn't the bridge: the next hello starts it again.
await hello()
// Time run out while no bridge: ended once one is.
await reset()
await made(transform(wolfId))
shape = formOf()
users.get('gm').isActiveGM = false
await Hooks.callAll('userConnected', users.get('gm'), false)
await setWorldTime(game.time.worldTime + 7200 + 600)
await settle(80)
assert.ok(game.actors.get(shape.id), 'no bridge: nothing ends')
const { formBlock } = await import(`${MODULE}/scripts/sheet-wild-shape.mjs`)
assert.equal(formBlock(shape, elowen, campaign()).minutesLeft, 0, 'ten minutes past its end, never below 0 minutes left')
users.get('gm').isActiveGM = true
await Hooks.callAll('userConnected', users.get('gm'), true)
await until(() => !game.actors.get(shape.id), 'ended at checkBridge')
await until(() => wildShapeReader('camp-a'), 'the reader again after the hello')
await settle(120)
// 0 hit points while a roll of hers is held: ended once that roll is done.
await campaignAs({ rolls: true })
await reset()
await made(transform(wolfId))
shape = formOf()
elowen.hang = true
shape.hang = true
const heldRoll = { id: 'roll-held-2', actorId: 'elowen', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }] }
app.waiting.set('camp-a', [heldRoll])
app.wake?.()
await settle(60)
await shape.update({ 'system.attributes.hp.value': 0 })
await settle(80)
assert.ok(game.actors.get(shape.id), 'not while her roll is held')
await until(() => resultIndex(heldRoll.id) >= 0, "the held roll's watchdog", 8000)
await until(() => !game.actors.get(shape.id), 'ended once the roll is done')
elowen.hang = false
await campaignAs({ rolls: false })
await settle(80)
// The switch off: nothing ends.
await reset()
await made(transform(wolfId))
shape = formOf()
const offMark = app.events.length
await campaignAs({ wildShape: false })
await until(() => sheetsSince(offMark).length, 'her sheet after the switch is off')
const offSheet = sheetsSince(offMark).at(-1).data.character.sheet
assert.deepEqual([offSheet.form?.kind, offSheet.form?.hours, offSheet.form?.minutesLeft, Boolean(offSheet.wildShape)], ['wildShape', 2, null, true],
  'the switch off: her sheet still the form\'s, untimed (minutesLeft null), her Wild Shape on it')
await setWorldTime(game.time.worldTime + 7200)
await shape.update({ 'system.attributes.hp.value': 0 })
await settle(120)
assert.ok(game.actors.get(shape.id), 'the switch off: nothing ends')
await campaignAs({ wildShape: true })
await shape.revertOriginalForm()
await settle(80)
// Fern's 2014 Wild Shape, made in Foundry: never ended here, no time left on her sheet.
const wildshape = () => new TransformationSetting({ ...CONFIG.DND5E.transformation.presets.wildshape.settings, preset: 'wildshape' })
await fern.transformInto(await fromUuid(uuidOf('Wolf')), wildshape())
const fernWolf = formOf(fern)
assert.deepEqual([recordOf(fernWolf).kind, recordOf(fernWolf).hours], ['wildShape', null])
await fernWolf.toggleStatusEffect('stunned', { active: true })
await setWorldTime(game.time.worldTime + 7200)
await settle(120)
assert.ok(game.actors.get(fernWolf.id), 'Fern, Stunned: not returned')
await until(() => lastSheet('fern')?.form, "Fern's form on her sheet")
assert.deepEqual([lastSheet('fern').form.kind, lastSheet('fern').form.hours, lastSheet('fern').form.minutesLeft], ['wildShape', null, null])
await fernWolf.revertOriginalForm()
await settle(80)
ok('endings: 2 hours of world time ("time"), 0 hit points ("hp") and Paralyzed ("incapacitated", one Paralyzed effect on her after, no separate Incapacitated, and Wild Shape again once it is gone), each with its line; a druid of level 2 "its hour ran out"; on the bridge alone, a second Gamemaster\'s client ending nothing, once; time run out with no bridge ended at checkBridge, minutesLeft 0 and never below past its end; 0 hit points while her roll is held ended once it is done; the switch off, nothing ends, her sheet the form\'s with minutesLeft null and her Wild Shape; Fern\'s 2014 Wild Shape Stunned not returned, minutesLeft null')

/* -------------------------------------------- */
/*  14. Made in Foundry                         */
/* -------------------------------------------- */

const bridgeTokens = () => [elowenHall.actorId, elowenForest.actorId]
// dnd5e's own Wild Shape by the Gamemaster: recorded, followed, timed, returnable from the app.
await reset()
await elowen.transformInto(await fromUuid(uuidOf('Wolf')), wildshape())
form = formOf()
assert.deepEqual([recordOf(form).kind, recordOf(form).hours, recordOf(form).profile, recordOf(form).request], ['wildShape', 2, wolfId, null])
assert.deepEqual(bridgeTokens(), ['elowen', form.id], "dnd5e's own switch: the viewed scene's token alone")
await until(() => lastSheet().form?.minutesLeft === 120, 'followed and timed')
assert.equal(lastSheet().form.kind, 'wildShape')
it = await made(revert())
assert.deepEqual([it.result.status, formOf(), bridgeTokens()], ['done', undefined, ['elowen', 'elowen']], 'returned from the app')
// A Polymorph: another kind, untimed, its return Foundry's.
await elowen.transformInto(await fromUuid(uuidOf('Giant Ape')), polymorph)
form = formOf()
await until(() => lastSheet().form?.name === 'Giant Ape', "the ape on Elowen's sheet")
assert.deepEqual([lastSheet().form.kind, lastSheet().form.hours, lastSheet().form.minutesLeft], ['other', null, null])
assert.deepEqual(refusal(await made(revert())), ['failed', 'transformed', null])
await form.revertOriginalForm()
await settle(80)
// A Moon druid's Wild Shape made in Foundry into a Beast from outside the campaign's compendiums, the
// Gamemaster's own pack's: its armor class the Moon's floor, the Beast never loaded on the bridge to
// compare its own against the floor.
const hareUuid = 'Compendium.world.secret-beasts.Actor.secretHare000000'
const hare = await fromUuid(hareUuid)
const askedHare = port.fromUuid.length
await rowan.transformInto(hare, wildshape())
const rowanHare = formOf(rowan)
await until(() => lastSheet('rowan').form?.name === 'Moon Hare', "the hare on Rowan's sheet")
await settle(80)
assert.deepEqual([rowanHare.system.attributes.ac.calc, rowanHare.system.attributes.ac.value, lastSheet('rowan').ac, lastSheet('rowan').form.flooredAc],
  ['natural', 16, 16, true], "the Moon's floor over the hare's 13, flooredAc")
assert.ok(!port.fromUuid.slice(askedHare).includes(hareUuid), 'the hare never loaded on the bridge')
await rowanHare.revertOriginalForm()
await settle(80)
// The sidebar's return by the Gamemaster of an app-made form with tokens on two scenes.
await reset()
await made(transform(wolfId))
form = formOf()
assert.deepEqual(bridgeTokens(), [form.id, form.id])
await form.items.get(LUCKY).update({ 'system.uses.spent': 1 })
await form.toggleStatusEffect('prone', { active: true })
await elowen.items.get(LUCKY).update({ 'system.uses.spent': 0 })
// A slot spent in form, and her own second level's spent on her own actor meanwhile.
await form.update({ 'system.spells.spell1.value': 3 })
await elowen.update({ 'system.spells.spell2.value': 2 })
await form.revertOriginalForm()
await settle(120)
assert.deepEqual([spentOf(elowen, LUCKY), elowen.effects.filter(effect => effect.id === PRONE).length], [1, 1], 'carried back once: Lucky, and one Prone where the form had one')
assert.deepEqual([elowen.system.spells.spell1.value, elowen.system.spells.spell2.value], [3, 2],
  "her slots: the form's spent first level as dnd5e copied it, her own second level's spent meanwhile kept over dnd5e's copy")
await elowen.update({ 'system.spells.spell1.value': 4, 'system.spells.spell2.value': 3 })
assert.deepEqual(bridgeTokens(), ['elowen', 'elowen'], "both tokens hers: dnd5e's on the viewed scene, the module's on the other")
assert.deepEqual([endedOf().why, endedOf().formId], ['foundry', form.id], "'foundry', written by that client's hook")
await elowen.toggleStatusEffect('prone', { active: false })
await elowen.items.get(LUCKY).update({ 'system.uses.spent': 0 })
// The Gamemaster's sidebar Restore of Thorin's Polymorph: his temporary hit points untouched.
await thorin.transformInto(await fromUuid(uuidOf('Giant Ape')), polymorph)
const thorinApe = formOf(thorin)
assert.ok(thorinApe.system.attributes.hp.temp > 0, "the ape's temporary hit points on the form")
await thorinApe.revertOriginalForm()
await settle(120)
assert.equal(thorin.system.attributes.hp.temp, 0, "Thorin's own temporary hit points as they were")
// A player's own return in Foundry: the leftover form deleted by the bridge, no "foundry" written over.
await reset()
await made(transform(wolfId))
form = formOf()
await form.update({ 'system.attributes.hp.value': 31 })
as('alice')
await form.revertOriginalForm()
await settle(40)
as('gm')
assert.ok(game.actors.get(form.id) && !form.flags.dnd5e.isPolymorphed, "her player's return unflags the form, which stays")
const playerEnded = endedOf()
assert.deepEqual([playerEnded.why, playerEnded.formId], ['foundry', form.id], "noted by her player's client")
await Hooks.callAll('updateActor', form, { flags: { dnd5e: { '-=isPolymorphed': null, '-=previousActorIds': null } } }, {}, 'alice')
await until(() => !game.actors.get(form.id), 'the leftover form deleted by the bridge')
await settle(120)
assert.equal(elowen.system.attributes.hp.value, 31, 'her hit points as dnd5e copied them')
assert.deepEqual(endedOf(), playerEnded, 'no "foundry" written over it')
assert.deepEqual(bridgeTokens(), ['elowen', 'elowen'])
// Its fetching stopped while this client was her player's: the next hello starts it again.
await hello()
// The form deleted by hand from the sidebar: tokens put back, hit points and temporary ones carried back.
await reset()
await made(transform(wolfId))
form = formOf()
await form.update({ 'system.attributes.hp.value': 30, 'system.spells.spell1.value': 3 })
await form.delete()
await settle(120)
assert.deepEqual(bridgeTokens(), ['elowen', 'elowen'], 'tokens put back on both scenes')
assert.deepEqual([elowen.system.attributes.hp.value, elowen.system.attributes.hp.temp], [30, 5], "the form's hit points and temporary ones carried back")
assert.equal(elowen.system.spells.spell1.value, 3, 'and the slot it spent, as dnd5e\'s return would have copied it')
await elowen.update({ 'system.spells.spell1.value': 4 })
assert.deepEqual([endedOf().why, endedOf().formId], ['foundry', form.id])
// dnd5e's chain: the newest is the active form, with the first's baseline; past the first's end, before the newest's, nothing ends.
await reset()
await made(transform(wolfId))
const first = formOf()
const firstRecord = recordOf(first)
await setWorldTime(game.time.worldTime + 3600)
await first.transformInto(await fromUuid(uuidOf('Black Bear')), wildshape())
const second = game.actors.find(actor => actor.flags?.dnd5e?.previousActorIds?.includes(first.id))
assert.ok(second && game.actors.get(first.id), 'the chain: both forms in the world')
assert.equal(activeForm(elowen)?.id, second.id, 'activeForm the newest')
assert.deepEqual(recordOf(second).baseline, firstRecord.baseline, "its baseline the first's")
const hpBefore = elowen.system.attributes.hp.value
await setWorldTime(firstRecord.endsAt + 60)
await settle(120)
assert.ok(game.actors.get(first.id) && game.actors.get(second.id), "past the first's end and before the newest's: nothing ends")
assert.equal(elowen.system.attributes.hp.value, hpBefore, 'her hit points stay')
assert.equal((await made(revert())).result.status, 'done')
assert.deepEqual([game.actors.get(first.id), game.actors.get(second.id), bridgeTokens()], [undefined, undefined, ['elowen', 'elowen']], 'both gone, her tokens hers')
// The clock set back between the two changes: still the chain's newest, by dnd5e's own previousActorIds.
await reset()
await made(transform(wolfId))
const early = formOf()
const clockThen = game.time.worldTime
await setWorldTime(clockThen - 600)
await early.transformInto(await fromUuid(uuidOf('Black Bear')), wildshape())
const late = game.actors.find(actor => actor.flags?.dnd5e?.previousActorIds?.includes(early.id))
assert.ok(recordOf(late).startedAt < recordOf(early).startedAt, 'the newest started earlier by the clock')
assert.equal(activeForm(elowen)?.id, late.id, 'with the clock set back: still the newest of the chain')
assert.equal((await made(revert())).result.status, 'done')
await setWorldTime(clockThen)
// A chain returned in Foundry: the Wolf from the app, Lucky, a hit die, 5 hit points and a slot spent in it,
// then a Black Bear made from it by dnd5e's own Wild Shape, then the Gamemaster's sidebar Restore of
// the Bear, which deletes both: carried back once, from the Bear, which holds the Wolf's spending.
const spentInWolf = async shape => {
  await shape.items.get(LUCKY).update({ 'system.uses.spent': 1 })
  await shape.items.get(CLASS).update({ 'system.hd.spent': 1 })
  await shape.update({ 'system.attributes.hp.value': 33, 'system.spells.spell1.value': 3 })
}
const afterChain = () => [spentOf(elowen, LUCKY), hdOf(elowen), elowen.system.attributes.hp.value, elowen.system.spells.spell1.value]
const unspend = async () => {
  await elowen.items.get(LUCKY).update({ 'system.uses.spent': 0 })
  await elowen.items.get(CLASS).update({ 'system.hd.spent': 0 })
  await elowen.update({ 'system.spells.spell1.value': 4 })
}
await reset()
await made(transform(wolfId))
let chainWolf = formOf()
await spentInWolf(chainWolf)
await chainWolf.transformInto(await fromUuid(uuidOf('Black Bear')), wildshape())
let chainBear = game.actors.find(actor => actor.flags?.dnd5e?.previousActorIds?.includes(chainWolf.id))
await chainBear.revertOriginalForm()
await settle(120)
assert.deepEqual([game.actors.get(chainWolf.id), game.actors.get(chainBear.id), bridgeTokens()], [undefined, undefined, ['elowen', 'elowen']], 'both deleted, her tokens hers')
assert.deepEqual(afterChain(), [1, 1, 33, 3], "a chain's Foundry return: Lucky, the hit die, the damage and the slot carried back once")
assert.deepEqual([endedOf().form, endedOf().why, endedOf().formId], ['Black Bear', 'foundry', chainBear.id], 'the ending the Bear\'s, never the Wolf\'s over it')
await unspend()
// The same with a Polymorph cast on the shaped Wolf: the Wolf's spending carried back once (the ape
// keeps none of her features), her hit points as dnd5e copied the ape's, never the damage again.
await reset()
await made(transform(wolfId))
chainWolf = formOf()
await spentInWolf(chainWolf)
await chainWolf.transformInto(await fromUuid(uuidOf('Giant Ape')), polymorph)
const chainApe = game.actors.find(actor => actor.flags?.dnd5e?.previousActorIds?.includes(chainWolf.id))
assert.deepEqual([recordOf(chainApe).kind, chainApe.system.attributes.hp.value], ['other', 33], "a Polymorph on the Wolf, the Wolf's hit points kept")
await chainApe.revertOriginalForm()
await settle(120)
assert.deepEqual(afterChain(), [1, 1, 33, 3], "a Polymorph on the Wolf returned: Lucky, the hit die and the Wolf's slot once (the ape's return copies no slots), the ape's hit points as dnd5e copied them")
assert.deepEqual([endedOf().form, endedOf().why], ['Wolf', 'foundry'])
await unspend()
// The Gamemaster deletes the chain's Wolf by hand while she is the Bear: nothing carried back nor
// noted yet; the Bear's return from the app carries everything back once.
await reset()
await made(transform(wolfId))
chainWolf = formOf()
await spentInWolf(chainWolf)
await chainWolf.transformInto(await fromUuid(uuidOf('Black Bear')), wildshape())
chainBear = game.actors.find(actor => actor.flags?.dnd5e?.previousActorIds?.includes(chainWolf.id))
await chainWolf.delete()
await settle(120)
assert.deepEqual([afterChain(), endedOf(), activeForm(elowen)?.id], [[0, 0, 38, 4], null, chainBear.id], "the Wolf deleted while she's the Bear: nothing carried back, no ending")
assert.equal((await made(revert())).result.status, 'done')
assert.deepEqual(afterChain(), [1, 1, 33, 3], 'the Bear returned: everything carried back once')
assert.equal(endedOf().why, 'app')
await unspend()
// A token dnd5e itself switched on the scene then viewed, which the Gamemaster hides once viewing
// another: put back by the module, hidden still, over the visibility dnd5e kept of it at the change.
await reset()
await elowen.transformInto(await fromUuid(uuidOf('Wolf')), wildshape())
form = formOf()
assert.equal(elowenForest.flags.dnd5e.previousTokenData.hidden, false, "dnd5e 5.3.3's own switch keeps where it stood")
tokenFaults.canvasScene = 'hall'
Object.assign(elowenForest, { hidden: true, rotation: 90 })
assert.equal((await made(revert())).result.status, 'done')
assert.deepEqual([elowenForest.actorId, elowenForest.hidden, elowenForest.rotation], ['elowen', true, 90], 'put back on the Forest, hidden and turned still')
tokenFaults.canvasScene = 'forest'
Object.assign(elowenForest, { hidden: false, rotation: 0 })
// A player's own return while no Gamemaster is connected: the leftover stays until one connects,
// then the bridge deletes it and puts back her token on the scene the player wasn't viewing.
await reset()
await made(transform(wolfId))
form = formOf()
users.get('gm').isActiveGM = false
await Hooks.callAll('userConnected', users.get('gm'), false)
as('alice')
await form.revertOriginalForm()
await settle(40)
as('gm')
assert.ok(game.actors.get(form.id) && !form.flags.dnd5e.isPolymorphed, 'the leftover, unflagged')
assert.deepEqual(bridgeTokens(), [form.id, 'elowen'], "the Hall's token, on the scene the player wasn't viewing, still the form's")
users.get('gm').isActiveGM = true
await Hooks.callAll('userConnected', users.get('gm'), true)
await until(() => !game.actors.get(form.id), 'the leftover deleted once a Gamemaster connects')
await settle(120)
assert.deepEqual(bridgeTokens(), ['elowen', 'elowen'], 'both tokens hers')
await until(() => wildShapeReader('camp-a'), 'the reader again after the hello')
await settle(120)
ok('made in Foundry: dnd5e\'s own Wild Shape by the Gamemaster recorded "wildShape" with its hours, followed, timed and returned from the app; a Polymorph "other", minutesLeft null, revert "transformed"; a Moon druid\'s Wild Shape into a Beast of the Gamemaster\'s own pack, flooredAc at the floor, the Beast never loaded on the bridge; the sidebar\'s return of an app-made form carried back once, both tokens hers, "foundry" by that client\'s hook, one Prone; Thorin\'s Polymorph restored, his temporary hit points untouched; a player\'s return leaves a form the bridge deletes, her hit points as dnd5e copied them, no "foundry" over it; a form deleted by hand puts back her tokens, hit points and temporary ones, "foundry"; dnd5e\'s chain: activeForm the newest with the first\'s baseline, even with the clock set back between, nothing ending past the first\'s end, her hit points kept; a chain returned in Foundry (a Black Bear, or a Polymorph, on the Wolf) carried back once, the ending the newest\'s, the damage counted once; its Wolf deleted by hand while she\'s the Bear carries nothing back until the Bear returns; her slots carried back as sums on a Foundry return and by hand; a token dnd5e switched, hidden on a scene no longer viewed, put back hidden; a player\'s return with no Gamemaster connected leaves a leftover the bridge deletes once one connects, both tokens hers')

/* -------------------------------------------- */
/*  14b. Forms dnd5e didn't make                */
/* -------------------------------------------- */

// A player owns their own actor, and may write dnd5e's flags on it: what names her as its original but
// isn't a form dnd5e made of her is never followed, ended, returned, deleted or carried back by the
// bridge, a Gamemaster.
{
  await reset()
  const revertsBefore = port.reverts.length
  const deletedBefore = port.deleted.length
  const heard = async (actor, changes, who) => {
    as('gm')
    await Hooks.callAll('updateActor', actor, changes, {}, who)
    await setWorldTime(game.time.worldTime + 1)
    await settle(120)
  }
  const forged = (previous, hp) => ({
    'flags.dnd5e.isPolymorphed': true, 'flags.dnd5e.originalActor': 'elowen', 'flags.dnd5e.previousActorIds': previous,
    'flags.dnd5e.transformOptions': { keep: ['hp', 'tempHP'], spellLists: [] },
    'flags.sending-stone.form': { kind: 'wildShape', name: 'Wolf', hours: 2, startedAt: 0, endsAt: 0, profile: null, request: null, baseline: {
      hp: 38, temp: 0, items: { elowenLucky00000: { spent: 3, activities: {} } }, hd: {}, inspiration: false, exhaustion: 0, death: { success: 0, failure: 0 }, effects: [], spells: {},
    } },
    'system.attributes.hp.value': hp,
  })
  // Carol's Thorin flagged as a form of Elowen, naming the hidden Ogre among her earlier forms, its time run out.
  as('carol')
  const thorinChanges = forged(['elowen', 'hiddenOgre000000'], 1)
  await thorin.update(thorinChanges)
  await heard(thorin, thorinChanges, 'carol')
  // A decoy of Carol's, no campaign's character, at 0 hit points, naming Bob's Rowan.
  const decoy = new t5.TActor({ _id: 'carolDecoy000000', name: 'Decoy', type: 'character', ownership: { default: 0, carol: 3 }, system: { attributes: { hp: { value: 5, max: 5 } } } })
  actors.set(decoy.id, decoy)
  as('carol')
  const decoyChanges = forged(['rowan'], 0)
  await decoy.update(decoyChanges)
  await heard(decoy, decoyChanges, 'carol')
  // Alice's own decoy, naming her as its first and Rowan as an earlier form: not hers either.
  const own = new t5.TActor({ _id: 'aliceDecoy000000', name: 'Elowen (Wolf)', type: 'character', ownership: { default: 0, alice: 3 }, system: { attributes: { hp: { value: 0, max: 5 } } } })
  actors.set(own.id, own)
  as('alice')
  const ownChanges = forged(['elowen', 'rowan'], 0)
  await own.update(ownChanges)
  await heard(own, ownChanges, 'alice')
  // Carol's own decoy naming only Elowen before it, at 0 hit points: not owned as hers.
  const carols = new t5.TActor({ _id: 'carolDecoy200000', name: 'Elowen (Rat)', type: 'character', ownership: { default: 0, carol: 3 }, system: { attributes: { hp: { value: 5, max: 5 } } } })
  actors.set(carols.id, carols)
  as('carol')
  const carolsChanges = forged(['elowen'], 0)
  await carols.update(carolsChanges)
  await heard(carols, carolsChanges, 'carol')
  // Alice's other character, Fern, flagged as Elowen's form: a campaign's character is never one.
  as('alice')
  const fernChanges = forged(['elowen'], 0)
  await fern.update(fernChanges)
  await heard(fern, fernChanges, 'alice')
  assert.equal(activeForm(elowen), null, 'none of them her active form')
  assert.deepEqual([campaignCharacterId(thorin, campaign()), campaignCharacterId(fern, campaign()), campaignCharacterId(own, campaign())], ['thorin', 'fern', null],
    "each stands for itself: Thorin's and Fern's chat, saves and combatants their own, never Elowen's")
  assert.equal(lastSheet().form, undefined, 'her sheet her own')
  assert.deepEqual([port.reverts.length - revertsBefore, port.deleted.length - deletedBefore], [0, 0], 'nothing returned, nothing deleted')
  assert.ok(['hiddenOgre000000', 'thorin', 'rowan', 'fern', decoy.id, own.id, carols.id].every(id => game.actors.get(id)),
    'the Ogre, Thorin, Rowan, Fern and the decoys all there')
  assert.deepEqual([elowen.system.attributes.hp.value, spentOf(elowen, LUCKY)], [38, 0], "her hit points and Lucky untouched")
  // Its fetching stopped while this client was a player's: the next hello starts it again.
  await hello()
  assert.deepEqual(refusal(await made(revert())), DONE_NOT_SHAPED, 'a return from the app finds no form of hers')
  // Unflagged as dnd5e's player return leaves one: never deleted as a leftover either.
  as('carol')
  const unflag = { 'flags.dnd5e.-=isPolymorphed': null, 'flags.dnd5e.-=previousActorIds': null }
  await thorin.update(unflag)
  await heard(thorin, unflag, 'carol')
  assert.ok(game.actors.get('thorin'), 'Thorin, unflagged with the record left on him, never deleted as a leftover')
  as('carol')
  await thorin.update({ 'flags.dnd5e.-=originalActor': null, 'flags.dnd5e.-=transformOptions': null, 'flags.sending-stone.-=form': null, 'system.attributes.hp.value': 49 })
  as('alice')
  await fern.update({ 'flags.dnd5e.-=isPolymorphed': null, 'flags.dnd5e.-=previousActorIds': null, 'flags.dnd5e.-=originalActor': null,
    'flags.dnd5e.-=transformOptions': null, 'flags.sending-stone.-=form': null, 'system.attributes.hp.value': 31 })
  as('gm')
  for (const each of [decoy, own, carols]) actors.delete(each.id)
  await hello()
  // A copy of her form, as the Gamemaster's sidebar Duplicate makes one, newer: never her active form.
  await made(transform(wolfId))
  const wolf = formOf()
  const copy = new t5.TActor({ ...wolf.toObject(), _id: 'wolfCopy00000000', name: 'Elowen (Wolf) (Copy)' })
  copy._stats.duplicateSource = wolf.uuid
  copy._stats.createdTime = wolf._stats.createdTime + 1000
  actors.set(copy.id, copy)
  await Hooks.callAll('createActor', copy, {}, 'gm')
  assert.equal(activeForm(elowen)?.id, wolf.id, 'the duplicate never her active form')
  actors.delete(copy.id)
  assert.equal((await made(revert())).result.status, 'done')
}
ok("forms dnd5e didn't make: Carol's Thorin flagged as Elowen's form naming the hidden Ogre, decoys of Carol's at 0 hit points naming Rowan or Elowen alone, Alice's own decoy naming Rowan, and Alice's Fern, another of the campaign's characters, are never her active form, ended, returned or deleted, nor anything they name; her hit points and uses untouched; Thorin unflagged is no leftover to delete; a sidebar duplicate of her form is never her active form")

/* -------------------------------------------- */
/*  15. Refusals                                */
/* -------------------------------------------- */

await reset()
for (const [command, error, why] of [
  [transform(wolfId, { by: 'gm' }), 'by', "the Gamemaster's"],
  [transform(wolfId, { of: 'wolf' }), 'of', "a companion's"],
  [shaping({ op: 'transform', form: wolfId, extra: 1 }), 'wildShape', 'an extra key'],
  [shaping({ op: 'polymorph', form: wolfId }), 'wildShape', 'a bad op'],
  [shaping({ op: 'transform', form: 'short' }), 'wildShape', 'not a profile id'],
  [shaping({ op: 'revert', form: wolfId }), 'wildShape', 'a revert naming a form'],
  [learn('Actor.hiddenOgre000000'), 'wildShape', "a world actor's uuid in learn"],
  [shaping({ op: 'learn', uuid: uuidOf('Rat') }), 'wildShape', 'learn without replace'],
  [shaping('transform'), 'wildShape', 'a string'],
  [transform(wolfId, { key: 'prc' }), 'wildShape', "a roll's field"],
  [transform(wolfId, { effect: { op: 'disable', id: 'x' } }), 'wildShape', 'an effect beside it'],
  [transform(wolfId, { dice: [{ faces: 20, results: [12] }] }), 'dice', 'a die'],
]) {
  it = await made(command)
  assert.deepEqual(refusal(it), ['failed', 'invalid', error], why)
}
const { runWildShapeCommand } = await import(`${MODULE}/scripts/command-wildshape.mjs`)
const stale = campaign()
await campaignAs({ wildShape: false })
let answer = await runWildShapeCommand(transform(wolfId), stale)
assert.deepEqual([answer.status, answer.reason], ['failed', 'off'], 'the switch off after it was fetched')
await campaignAs({ wildShape: true })
game.system.id = 'pf2e'
answer = await runWildShapeCommand(transform(wolfId), campaign())
game.system.id = 'dnd5e'
assert.deepEqual([answer.status, answer.reason], ['failed', 'off'], 'another system')
const company = {
  documentName: 'Actor', id: 'company', name: 'The Company', type: 'group', uuid: 'Actor.company', img: 'company.webp', flags: {},
  ownership: { default: 0, alice: 3 }, system: { members: [], description: { full: '', summary: '' } }, effects: [], items: new Map(),
  getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
  testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
  getFlag() { return undefined }, *allApplicableEffects() {},
}
actors.set('company', company)
await campaignAs({ characters: [...CAMPAIGN.characters, 'company'], groups: ['company'] })
assert.deepEqual(refusal(await made(listing({ actorId: 'company' }))), ['failed', 'unknown', null], 'a group')
await campaignAs({ characters: CAMPAIGN.characters, groups: [] })
actors.delete('company')
assert.deepEqual(refusal(await made(listing({ actorId: 'hiddenOgre000000' }))), ['failed', 'unknown', null], 'an actor not in the campaign')
assert.deepEqual(refusal(await made(listing({ actorId: 'thorin' }))), ['failed', 'gone', null], 'Thorin, no Wild Shape')
assert.deepEqual(refusal(await made(transform(wolfId, { actorId: 'fern' }))), ['failed', 'gone', null], "Fern's 2014 Wild Shape")
await elowen.toggleStatusEffect('incapacitated', { active: true })
assert.deepEqual(refusal(await made(transform(wolfId))), ['failed', 'incapacitated', null], 'Incapacitated')
await elowen.toggleStatusEffect('incapacitated', { active: false })
await elowen.update({ 'system.attributes.hp.value': 0 })
assert.deepEqual(refusal(await made(transform(wolfId))), ['failed', 'incapacitated', null], 'at 0 hit points')
await reset()
// A known form whose pack entry was deleted.
const actors24 = packs.get('dnd5e.actors24')
const crocodile = uuidOf('Crocodile')
const crocodileId = crocodile.split('.').at(-1)
const crocodileSource = actors24.sources.get(crocodileId)
const withProfiles = async extra => shapeItem().update({ [`system.activities.${ACTIVITY}.profiles`]: [...profilesOf().map(profile => ({ ...profile, movement: [], sizes: [], types: [] })), ...extra] })
const before = profilesOf().map(profile => ({ ...profile, movement: [], sizes: [], types: [] }))
await withProfiles([{ _id: 'crocProfile00000', name: 'Crocodile', uuid: crocodile }])
actors24.remove(crocodileId)
assert.deepEqual(refusal(await made(transform('crocProfile00000'))), ['failed', 'gone', null], 'a known form whose pack entry was deleted')
actors24.sources.set(crocodileId, crocodileSource)
await actors24.getIndex()
await shapeItem().update({ [`system.activities.${ACTIVITY}.profiles`]: before })
// A hook stopping the use's update: cancelled, no form.
const stop = Hooks.on('preUpdateItem', item => ((item.id === WILD_SHAPE) ? false : undefined))
it = await made(transform(wolfId))
Hooks.off('preUpdateItem', stop)
assert.deepEqual([refusal(it), formOf(), shapeItem().system.uses.spent], [['failed', 'cancelled', null], undefined, 0], 'cancelled, no form')
// transformInto throwing: the use refunded.
port.faults.throwOnTransform = true
it = await made(transform(wolfId))
assert.deepEqual([refusal(it), formOf(), shapeItem().system.uses.spent], [['failed', 'error', 'The transformation failed'], undefined, 0], 'error, the use refunded')
// A throw in switchTokens once the form exists: done, the use kept, the line and her sheet all the same.
port.faults.throwOnTokens = true
messageMark = messages.size
it = await made(transform(wolfId))
assert.deepEqual([it.result.status, Boolean(formOf()), shapeItem().system.uses.spent], ['done', true, 1], 'done, the use kept')
assert.deepEqual(linesSince(messageMark), ['<p>Elowen uses Wild Shape and becomes a Wolf.</p>'], 'its chat line all the same')
assert.equal(it.result.messageId, [...messages.values()].at(-1).id)
assert.ok(sheetsIn(it).some(e => e.data.character.sheet.form?.name === 'Wolf'), 'her shaped sheet before the result all the same')
assert.equal((await made(revert())).result.status, 'done')
await reset()
// Known forms put there in Foundry from outside the campaign's compendiums, or outside the rules.
const OUTSIDE = [
  { _id: 'thorinProfile000', name: 'Thorin', uuid: 'Actor.thorin' },
  { _id: 'ogreProfile00000', name: 'Ogre', uuid: 'Actor.hiddenOgre000000' },
  { _id: 'hareProfile00000', name: 'Moon Hare', uuid: 'Compendium.world.secret-beasts.Actor.secretHare000000' },
  { _id: 'apeProfile000000', name: 'Giant Ape', uuid: uuidOf('Giant Ape') },
]
const asked = port.fromUuid.length
await withProfiles(OUTSIDE)
await until(() => knownOf().find(each => each.id === 'apeProfile000000')?.ac !== undefined, "the Giant Ape's summary")
const outside = knownOf().filter(each => OUTSIDE.some(profile => profile._id === each.id))
assert.deepEqual(outside.slice(0, 3), [
  { id: 'thorinProfile000', name: 'Thorin', pool: false }, { id: 'ogreProfile00000', name: 'Ogre', pool: false }, { id: 'hareProfile00000', name: 'Moon Hare', pool: false },
], 'listed by name alone: no stats or art')
assert.deepEqual([outside[3].pool, outside[3].fits, outside[3].cr], [true, false, 7], 'the pack beast above her CR: fits false')
assert.ok(!port.fromUuid.slice(asked).some(uuid => ['Actor.thorin', 'Actor.hiddenOgre000000', OUTSIDE[2].uuid].includes(uuid)), 'never loaded on the bridge')
for (const { _id, name } of OUTSIDE) {
  assert.deepEqual(refusal(await made(transform(_id))), ['failed', 'form', null], `transform into ${name}`)
}
assert.ok(!port.fromUuid.slice(asked).some(uuid => ['Actor.thorin', 'Actor.hiddenOgre000000', OUTSIDE[2].uuid].includes(uuid)), 'nor by a transform')
assert.equal(formOf(), undefined)
await shapeItem().update({ [`system.activities.${ACTIVITY}.profiles`]: before })
// Known forms added as dnd5e's own sheet adds a dropped creature, with no name: named as the player
// could see them already, never blank, never loaded for it.
const FROM_FOUNDRY = words['SENDINGSTONE.WildShape.FromFoundry']
// A bare name, as a Beast's is: the app puts "a" or "an" before any form's name ("Replace a Wolf").
assert.ok(FROM_FOUNDRY && !/^(a|an|the)\s/i.test(FROM_FOUNDRY), `"${FROM_FOUNDRY}": a bare name, no article of its own`)
await rowan.update({ 'ownership.alice': CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER })
const DROPPED = [
  { _id: 'dropThorin000000', uuid: 'Actor.thorin' }, { _id: 'dropRowan0000000', uuid: 'Actor.rowan' },
  { _id: 'dropHare00000000', uuid: OUTSIDE[2].uuid }, { _id: 'dropMonWolf00000', uuid: beastUuid('Wolf', 'dnd5e.monsters') },
  { _id: 'dropDire00000000', uuid: uuidOf('Dire Wolf') }, { _id: 'dropCroc00000000', uuid: uuidOf('Crocodile') },
  { _id: 'dropGone00000000', uuid: 'Compendium.dnd5e.actors24.Actor.nothing000000000' },
]
const askedDropped = port.fromUuid.length
const droppedMark = app.events.length
await withProfiles(DROPPED)
await until(() => knownOf().find(each => each.id === 'dropGone00000000')?.found === false, 'the gone one, once its load fails')
const nameOf = (sheet, id) => sheet.wildShape.known.find(each => each.id === id)?.name
const sheetsAfter = sheetsSince(droppedMark).map(e => e.data.character.sheet).filter(sheet => sheet.wildShape?.known?.some(each => each.id === 'dropDire00000000'))
assert.ok(sheetsAfter.length && sheetsAfter.every(sheet => sheet.wildShape.known.every(each => (typeof each.name === 'string') && each.name.trim())), 'never a blank name, from the first sheet on')
assert.equal(nameOf(sheetsAfter[0], 'dropDire00000000'), 'Dire Wolf', "a pool form's from its compendium's index, before its summary loads")
assert.deepEqual(DROPPED.map(({ _id }) => nameOf(sheetsAfter.at(-1), _id)), [FROM_FOUNDRY, 'Rowan', FROM_FOUNDRY, 'Wolf', 'Dire Wolf', 'Crocodile', FROM_FOUNDRY],
  "Carol's Thorin and the Gamemaster's own Beast as a form from Foundry; Rowan, whom Alice may observe, and the Monsters' Wolf by name; the gone one as a form from Foundry")
assert.ok(!port.fromUuid.slice(askedDropped).some(uuid => ['Actor.thorin', 'Actor.rowan', OUTSIDE[2].uuid, beastUuid('Wolf', 'dnd5e.monsters')].includes(uuid)), 'never loaded for its name')
it = await made(learn(uuidOf('Crocodile')))
assert.deepEqual(it.result.wildShape, { op: 'learn', form: { id: 'dropCroc00000000', name: 'Crocodile', uuid: uuidOf('Crocodile') }, replaced: null }, 'known already: named')
await shapeItem().update({ 'flags.sending-stone.wildShape.swap': true })
it = await made(learn(uuidOf('Panther'), 'dropThorin000000'))
assert.deepEqual(it.result.wildShape.replaced, { id: 'dropThorin000000', name: FROM_FOUNDRY }, 'a replaced one: named')
await shapeItem().update({ [`system.activities.${ACTIVITY}.profiles`]: before, 'flags.sending-stone.wildShape.swap': false })
await rowan.update({ 'ownership.-=alice': null })
ok('refusals: "invalid" for the Gamemaster\'s (by), a companion\'s (of), an extra key, a bad op, a world actor\'s uuid in learn, anything else beside it (wildShape) and dice (dice); "off" with the switch off after it was fetched and under another system; "unknown" for a group or an actor outside the campaign; "gone" for Thorin and Fern\'s 2014 Wild Shape, and a known form whose pack entry was deleted; "incapacitated" Incapacitated or at 0 hit points; "cancelled" for a hook stopping the use, no form; "error" for transformInto throwing, the use refunded; done for a throw in switchTokens, the use kept; known forms put there in Foundry naming Thorin, the hidden Ogre and a Beast of the Gamemaster\'s own pack listed by name alone and never loaded, the Giant Ape fits false, and a transform into each "form"; known forms with no name, as dnd5e\'s drop adds them, named as her player could see them already (an index entry, an actor or compendium they may observe) or "Foundry form", a bare name with no article of its own, never blank, never loaded, in learn\'s result too; a throw in switchTokens leaves the line and her sheet sent')

/* -------------------------------------------- */
/*  16. Queue                                   */
/* -------------------------------------------- */

await campaignAs({ rolls: true })
elowen.hang = true
const held2 = { ...held, id: 'roll-held-3' }
const change = transform(wolfId)
const [heldResult, changed] = await fetched(held2, change)
elowen.hang = false
assert.equal(heldResult.result.reason, 'timeout', "the held roll's watchdog")
assert.ok(resultIndex(held2.id) < resultIndex(change.id), "the transform waits behind Elowen's held roll")
assert.equal(changed.result.status, 'done')
assert.equal((await made(revert())).result.status, 'done')
await campaignAs({ rolls: false })
ok("queue: a transform waits behind the same character's held roll, by its actorId (a forms doesn't, case 4)")

/* -------------------------------------------- */
/*  10. The seat while shaped                   */
/* -------------------------------------------- */

{
  // Every switch the seat's commands need, chat for the campaign's own speakers alone, and the fight up.
  await campaignAs({ rolls: true, attacks: true, prompts: true, transfers: true, effects: true, dishes: true })
  settings.set('chatEvents', true)
  settings.set('combatEvents', true)
  settings.set('chatScope', 'connected')
  game.combat = fight
  await reset()
  // Elowen concentrating on Moonbeam as herself, which her form then holds a copy of.
  const moonGlow = new PlainEffect(thorin, { _id: 'moonGlowTen00000', name: 'Moonbeam (Glow)', origin: 'Actor.elowen.Item.elowenMoonbeam00' })
  thorin.effects.push(moonGlow)
  const MOON = 'moonbeamConcTen0'
  concentrateOn(elowen, new PlainEffect(elowen, {
    _id: MOON, name: 'Concentrating: Moonbeam', origin: 'Actor.elowen.Item.elowenMoonbeam00',
    flags: { dnd5e: { item: { id: 'elowenMoonbeam00', type: 'spell', uuid: 'Actor.elowen.Item.elowenMoonbeam00' } } },
  }), [moonGlow])
  await settle(60)
  assert.equal((await made(transform(wolfId))).result.status, 'done')
  const wolf = formOf()
  const roll = (fields, d20 = 10) => ({ id: `seat-${++ids}`, actorId: 'elowen', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [d20] }], ...fields })
  const speakerOf = result => messages.get(result.messageId)?.speaker?.actor ?? null
  const chatOf = id => sent('chat.message.created').find(e => e.data.message.id === id)?.data.message
  // Foundry's ChatMessage#speakerActor, read each time (the stand-in's is fixed when it's made): the
  // actor of its speaker's token on its scene, else the world actor of its id.
  const foundryLike = (message, { tokenless = false, token = null } = {}) => {
    if (tokenless) { delete message.speaker.token; delete message.speaker.scene }
    if (token) Object.assign(message.speaker, { token: token.id, scene: token.parent.id })
    Object.defineProperty(message, 'speakerActor', { configurable: true, get() {
      const { scene: sceneId, token: tokenId, actor: actorId } = this.speaker ?? {}
      const placed = (sceneId && tokenId) ? game.scenes.get(sceneId)?.tokens?.get(tokenId) : null
      return placed?.actor ?? game.actors.get(actorId) ?? null
    } })
    return message
  }

  // A skill and a save, on the form: its Stealth and Strength, the Wolf's, above hers.
  assert.ok(wolf.system.skills.ste.total > elowen.system.skills.ste.total, "the Wolf's Stealth above hers")
  it = await made(roll({ kind: 'skill', key: 'ste' }))
  assert.deepEqual([it.result.status, it.result.rolls[0].total, speakerOf(it.result)], ['done', 10 + wolf.system.skills.ste.total, wolf.id], 'Stealth, rolled on the form')
  assert.notEqual(wolf.system.abilities.str.save.value, elowen.system.abilities.str.save.value)
  it = await made(roll({ kind: 'save', key: 'str' }))
  assert.deepEqual([it.result.status, it.result.rolls[0].total, speakerOf(it.result)], ['done', 10 + wolf.system.abilities.str.save.value, wolf.id], 'a Strength save, rolled on the form')
  // Module 0.42.0 (its contract §8.2.11): Bless on the form, adding its d4 to the form's saves, is
  // listed on her seat's sheet, the form's; and a save she types in, made on the form, takes it.
  if (!DND5E6) {
    const formBless = new PlainEffect(wolf, {
      _id: 'formBlessed00000', name: 'Blessed', origin: 'Actor.rowan.Item.rowanBless000000',
      system: { changes: [{ key: 'system.bonuses.abilities.save', type: 'add', value: '1d4', phase: 'initial' }] },
    })
    wolf.effects.push(formBless)
    wolf.system.bonuses.abilities.save = '1d4'
    await Hooks.callAll('createActiveEffect', formBless, {}, 'gm')
    await until(() => lastSheet()?.effectDice?.some(each => each.effect === formBless.id), "her seat's sheet with the form's Bless")
    assert.deepEqual(lastSheet().effectDice, [{ name: 'Bless', effect: formBless.id, faces: 4, count: 1, sign: 1, on: ['save', 'death', 'concentration'] }])
    it = await made(roll({ kind: 'save', key: 'str', typed: true, effectDice: [{ faces: 4, sign: 1, results: [3] }] }))
    const blessedSave = messages.get(it.result.messageId)?.rolls[0]
    assert.deepEqual([it.result.status, blessedSave?.dice.filter(die => die.faces === 4).map(die => die.results.map(r => r.result)), it.result.rolls[0].total],
      ['done', [[3]], 10 + wolf.system.abilities.str.save.value + 3], "a typed save on the form takes Bless's d4")
    wolf.effects.splice(wolf.effects.indexOf(formBless), 1)
    wolf.system.bonuses.abilities.save = ''
    await Hooks.callAll('deleteActiveEffect', formBless, {}, 'gm')
    await settle(60)
  }
  // A chat card the form speaks is hers, in scope under Connected.
  const card = chatOf(it.result.messageId)
  assert.deepEqual([card?.speaker.actorId, card?.character], [wolf.id, 'elowen'], "the form's card, hers, under Connected")
  const formCard = foundryLike(messages.get(it.result.messageId), { tokenless: true })
  // The Wolf's Bite, the form's item, as the form's sheet names it.
  const bite = [...wolf.items].find(item => item.name === 'Bite')
  const biting = [...bite.system.activities].find(activity => activity.type === 'attack')
  assert.ok(bite && !elowen.items.get(bite.id), 'a Bite of the form\'s, none of hers')
  it = await made(roll({ kind: 'attack', item: bite.id, activity: biting.id }, 15))
  assert.equal(it.result.status, 'done', JSON.stringify(it.result))
  assert.equal(speakerOf(it.result), wolf.id, "the Bite, the form's")
  // Initiative: the form's combatant, its token's.
  const cb = fight.combatants.get('cbElowen')
  assert.equal(cb.actor?.id, wolf.id, "her combatant's actor the form, as its token's")
  cb.initiative = null
  it = await made(roll({ kind: 'initiative', combatId: 'fight' }, 12))
  assert.deepEqual([it.result.status, cb.initiative], ['done', 12 + wolf.system.attributes.init.total], "the form's combatant's initiative")
  // End Turn on the form's turn: the old Known limit gone.
  const turnWas = { round: fight.round, combatantId: fight.combatant?.id }
  assert.equal(turnWas.combatantId, 'cbElowen')
  it = await made({ id: `seat-${++ids}`, actorId: 'elowen', kind: 'endTurn', turn: { combatId: 'fight', ...turnWas }, mode: 0, explicit: false, extras: [], dice: [] })
  assert.deepEqual([it.result.status, it.result.reason, fight.round], ['done', null, turnWas.round + 1], "the form's turn ended from her seat")
  // A familiar her form summoned with its copy of her Wild Shape, as Wild Companion does: hers while the form exists.
  const { companionsOf } = await import(`${MODULE}/scripts/creatures.mjs`)
  const owl = tokenCore.companionActor('wildOwl000000000', 'Owl', { linked: false })
  placeToken(hall, owl, { id: 'wildOwlToken0000', name: 'Owl', delta: { flags: { dnd5e: { summon: { origin: `Actor.${wolf.id}.Item.${WILD_SHAPE}`, activity: ACTIVITY } } } } })
  const familiar = companionsOf(campaign()).find(({ entry }) => entry.actorId === owl.id)?.entry
  assert.deepEqual([familiar?.of, familiar?.kind, familiar?.summon], [['elowen'], 'summoned', { itemId: WILD_SHAPE, item: 'Wild Shape', activityId: ACTIVITY }],
    'a familiar her form summoned, hers')
  hall.tokens.delete('wildOwlToken0000')
  actors.delete(owl.id)
  // A dnd5e save card targeting the form: asked of Elowen, answered from her seat, the save the form's.
  // Under Midi-QOL its saves are left to the card's buttons for this one, as dnd5e's own.
  const midiSettings = MIDI ? MidiQOL.configSettings() : {}
  const checkSaves = midiSettings.autoCheckSaves
  midiSettings.autoCheckSaves = 'none'
  const { saveCard } = await import('./dnd5e-cards.mjs')
  const net = { id: 'thorinNet0000000', name: 'Net', img: 'icons/net.webp', uuid: 'Actor.thorin.Item.thorinNet0000000' }
  const opened = () => sent('roll.prompt.opened').map(e => e.data.prompt)
  const closed = id => sent('roll.prompt.closed').find(e => e.data.id === id)?.data
  let asked = opened().length
  const netCard = await saveCard({ by: thorin, item: net, dc: 13, abilities: ['str'], targets: [wolf] })
  await until(() => opened().length > asked, 'the prompt of the card at the form')
  let prompt = opened().at(-1)
  assert.deepEqual([prompt.id, prompt.actorId, prompt.messageId], [`${netCard.id}-elowen`, 'elowen', netCard.id], 'asked of Elowen, by her id')
  it = await made(roll({ kind: 'save', key: 'str', prompt: prompt.id }, 9))
  assert.deepEqual([it.result.status, it.result.reason, it.result.error], ['done', null, null], 'answered from her seat')
  assert.deepEqual([it.result.rolls[0].total, speakerOf(it.result), messages.get(it.result.messageId).flags.dnd5e.originatingMessage],
    [9 + wolf.system.abilities.str.save.value, wolf.id, netCard.id], 'the save rolled on the form, from the card')
  await until(() => closed(prompt.id), 'the prompt closed')
  assert.deepEqual(closed(prompt.id), { id: prompt.id, reason: 'answered' })
  await hello()
  assert.ok(!helloOf().prompts.some(each => each.id === prompt.id), 'closed in the open list')
  midiSettings.autoCheckSaves = checkSaves
  // A concentration card the form speaks, of the Moonbeam it holds a copy of: hers, answered the same.
  // Under Midi-QOL, in its "chat" mode, it's Midi's own card, asked in the app as Midi's, while she's
  // open there in an app that reads Midi's prompts.
  if (MIDI) {
    app.features.set('camp-a', { commands: true, wildShape: 1, midiPrompts: 1 })
    app.open.set('camp-a', ['elowen'])
    await hello()
    const polled = pollsOf()
    await until(() => pollsOf() >= polled + 2, 'the open list taken')
  }
  asked = opened().length
  const concentration = await wolf.challengeConcentration({ dc: 10 })
  await until(() => opened().length > asked, 'the prompt of the concentration card')
  prompt = opened().at(-1)
  assert.deepEqual([prompt.id.endsWith('-elowen'), prompt.actorId, prompt.messageId, prompt.type], [true, 'elowen', concentration.id, 'concentration'],
    MIDI ? "Midi's concentration card, asked of Elowen" : "dnd5e's concentration card, asked of Elowen")
  if (!MIDI) assert.equal(prompt.id, `${concentration.id}-elowen`)
  it = await made(roll({ kind: 'save', key: prompt.abilities[0], prompt: prompt.id }, 15))
  assert.deepEqual([it.result.status, speakerOf(it.result)], ['done', wolf.id], "the concentration check, the form's")
  await until(() => closed(prompt.id), 'the concentration prompt closed')
  if (MIDI) {
    // Midi's save asked of the form's token reaches the app as Elowen's, is taken, and rolled on the form.
    const { midiSaves, runSaves, saveActivity, saveWorkflow } = await import('./midi-saves.mjs')
    midiSettings.autoCheckSaves = 'all'
    const hold = { id: 'thorinHold000000', name: 'Hold Beast', type: 'spell', uuid: 'Actor.thorin.Item.thorinHold000000', flags: {}, system: { description: { value: '' } } }
    const token = { id: elowenForest.id, name: wolf.name, uuid: `Scene.forest.Token.${elowenForest.id}`, actor: wolf, hidden: false, disposition: 1, isLinked: true }
    const placeable = { id: token.id, name: wolf.name, document: token, actor: wolf }
    token.object = placeable
    asked = opened().length
    const workflow = await saveWorkflow({ actor: thorin, item: hold, activity: saveActivity({ item: hold, abilities: ['str'], dc: 14 }), targets: [placeable] })
    const running = runSaves(workflow)
    await until(() => opened().length > asked, "Midi's save asked in the app")
    prompt = opened().at(-1)
    assert.deepEqual([prompt.id.endsWith('-elowen'), prompt.actorId, prompt.source, prompt.abilities], [true, 'elowen', 'midi', ['str']], "Midi's save at the form, asked of Elowen")
    it = await made(roll({ kind: 'save', key: 'str', prompt: prompt.id }, 11))
    await running
    assert.deepEqual([it.result.status, it.result.reason], ['done', null], 'taken')
    const processed = midiSaves.processed.find(each => each.workflow === workflow)
    assert.equal(processed.results[0][0].total, 11 + wolf.system.abilities.str.save.value, "the roll Midi waited on, the form's")
    midiSettings.autoCheckSaves = checkSaves
    app.features.delete('camp-a')
    app.open.delete('camp-a')
    await hello()
  }
  // Refused while shaped, whatever else: a favorite, an effect, a move to her and from her, a removal.
  const { withFavorites } = await import('./favorites-core.mjs')
  withFavorites(elowen)
  const STAFF = 'elowenStaff00000'
  const plain = { mode: 0, explicit: false, extras: [], dice: [] }
  for (const [command, why] of [
    [{ kind: 'favorite', favorite: { op: 'add', type: 'item', id: STAFF } }, 'a favorite added'],
    [{ kind: 'effect', effect: { op: 'disable', id: 'rowanBlessOnElow' } }, 'an effect turned off'],
    [{ kind: 'transfer', transfer: { from: 'elowen', to: 'thorin', items: [{ id: STAFF, quantity: 1 }] } }, 'a move from her'],
    [{ kind: 'transfer', transfer: { from: 'thorin', to: 'elowen', items: [{ id: 'thorinClass00000', quantity: 1 }] }, actorId: 'thorin' }, 'a move to her'],
    [{ kind: 'remove', remove: { item: STAFF, quantity: 1, held: 1 } }, 'a removal'],
  ]) {
    it = await made({ id: `seat-${++ids}`, actorId: 'elowen', ...plain, ...command })
    assert.deepEqual(refusal(it), ['failed', 'shaped', null], why)
  }
  // End concentration: the form's copy, then her own, with what it kept up.
  assert.ok(wolf.concentration.effects.size && elowen.effects.get(MOON), 'two copies of Moonbeam')
  it = await made({ id: `seat-${++ids}`, actorId: 'elowen', kind: 'endConcentration', concentration: { effect: MOON }, ...plain })
  assert.equal(it.result.status, 'done')
  assert.deepEqual([wolf.effects.some(effect => effect.id === MOON), elowen.effects.some(effect => effect.id === MOON), thorin.effects.includes(moonGlow)],
    [false, false, false], 'both copies ended, and the glow it kept up on Thorin')
  // Charges spent by hand on the form's copies, an item's and an activity's, her sheet before the result.
  const LUCKY = 'elowenLucky00000'
  const FEY = 'elowenFeyStep000'
  const STEP = 'feyStepUse000000'
  it = await made({ id: `seat-${++ids}`, actorId: 'elowen', kind: 'spend', counter: { item: LUCKY }, count: 1, ...plain })
  assert.deepEqual([it.result.status, wolf.items.get(LUCKY).system.uses.spent, elowen.items.get(LUCKY).system.uses.spent], ['done', 1, 0], "Lucky's use spent on the form's copy")
  assert.ok(sheetsIn(it).length, 'her sheet before the result')
  it = await made({ id: `seat-${++ids}`, actorId: 'elowen', kind: 'spend', counter: { item: FEY, activity: STEP }, count: 1, ...plain })
  assert.deepEqual([it.result.status, wolf.items.get(FEY).system.activities.get(STEP).uses.spent, elowen.items.get(FEY).system.activities.get(STEP).uses.spent],
    ['done', 1, 0], "Fey Step's own use spent on the form's copy")
  // Heroic Inspiration used from the app on the form's copy, hers untouched until the return.
  await wolf.update({ 'system.attributes.inspiration': true })
  await elowen.update({ 'system.attributes.inspiration': true })
  it = await made({ id: `seat-${++ids}`, actorId: 'elowen', kind: 'inspiration', inspiration: 'use', ...plain })
  assert.deepEqual([it.result.status, wolf.system.attributes.inspiration, elowen.system.attributes.inspiration], ['done', false, true],
    "Heroic Inspiration used on the form, hers kept")
  await elowen.update({ 'system.attributes.inspiration': false })
  // The form's concentration ended in Foundry closes the prompt its card asked of her; her own copy
  // ended alone, the form still concentrating, leaves it open.
  if (!MIDI) {
    const HELD = 'heldConcTen00000'
    const held = () => ({ _id: HELD, name: 'Concentrating: Moonbeam', origin: 'Actor.elowen.Item.elowenMoonbeam00',
      flags: { dnd5e: { item: { id: 'elowenMoonbeam00', type: 'spell', uuid: 'Actor.elowen.Item.elowenMoonbeam00' } } } })
    concentrateOn(elowen, new PlainEffect(elowen, held()))
    concentrateOn(wolf, new PlainEffect(wolf, held()))
    asked = opened().length
    const heldCard = await wolf.challengeConcentration({ dc: 10 })
    await until(() => opened().length > asked, 'the prompt of the held concentration card')
    const heldPrompt = opened().at(-1)
    assert.equal(heldPrompt.id, `${heldCard.id}-elowen`)
    await elowen.effects.get(HELD).delete()
    await settle(60)
    assert.equal(closed(heldPrompt.id), undefined, 'her own copy ended, the form still concentrating: still open')
    await wolf.effects.get(HELD).delete()
    await until(() => closed(heldPrompt.id), "the prompt closed as the form's concentration ends")
    assert.deepEqual(closed(heldPrompt.id), { id: heldPrompt.id, reason: 'gone' }, "the form's concentration ended in Foundry: gone")
  }
  // A dish cooked while shaped: its card spoken by Elowen, her id the cook's.
  const dishBody = {
    version: 1, dish: { id: 'cmhwildshape00000000000001', recipe: 'Fireberry Glazed Skewers', status: 'success', outcome: 'standard', cookedOnDay: 4, consumedOnDay: 4 },
    cook: { name: 'Elowen' }, message: 'Tasty, if nothing more.', effect: null,
  }
  it = await made({ id: 'dish-cmrowwildshape00000000001', actorId: 'elowen', kind: 'dish', dish: { queuedAt: Date.now(), body: dishBody }, ...plain })
  const dishCard = messages.get(it.result.messageId)
  assert.deepEqual([it.result.status, dishCard?.speaker.actor, dishCard?.speaker.alias, dishCard?.flags['sending-stone'].dish.cookId],
    ['done', 'elowen', 'Elowen', 'elowen'], 'the dish card spoken by Elowen, her id the cook')
  // To an app that takes no Wild Shape, which was sent her own sheet: a skill rolled on her own actor.
  app.features.set('camp-a', { commands: true })
  await hello()
  it = await made(roll({ kind: 'skill', key: 'ste' }))
  assert.deepEqual([it.result.status, it.result.rolls[0].total, speakerOf(it.result)], ['done', 10 + elowen.system.skills.ste.total, 'elowen'], 'on her own actor')
  // Its End concentration ends both copies, as for any app; its spend is on her own item, the sheet it shows.
  const FRESH = 'freshConcTen0000'
  const fresh = () => ({ _id: FRESH, name: 'Concentrating: Moonbeam', origin: 'Actor.elowen.Item.elowenMoonbeam00',
    flags: { dnd5e: { item: { id: 'elowenMoonbeam00', type: 'spell', uuid: 'Actor.elowen.Item.elowenMoonbeam00' } } } })
  concentrateOn(elowen, new PlainEffect(elowen, fresh()))
  concentrateOn(wolf, new PlainEffect(wolf, fresh()))
  it = await made({ id: `seat-${++ids}`, actorId: 'elowen', kind: 'endConcentration', concentration: { effect: FRESH }, ...plain })
  assert.deepEqual([it.result.status, wolf.effects.some(effect => effect.id === FRESH), elowen.effects.some(effect => effect.id === FRESH)], ['done', false, false],
    'to an app that takes no Wild Shape: End concentration ends both copies')
  const luckyWolf = wolf.items.get(LUCKY).system.uses.spent
  const luckyHers = elowen.items.get(LUCKY).system.uses.spent
  it = await made({ id: `seat-${++ids}`, actorId: 'elowen', kind: 'spend', counter: { item: LUCKY }, count: 1, ...plain })
  assert.deepEqual([it.result.status, wolf.items.get(LUCKY).system.uses.spent, elowen.items.get(LUCKY).system.uses.spent], ['done', luckyWolf, luckyHers + 1],
    'to an app that takes no Wild Shape: Lucky spent on her own item')
  await elowen.items.get(LUCKY).update({ 'system.uses.spent': luckyHers })
  // Its initiative still the form's combatant's, and a card's save at the form still rolled on the form.
  cb.initiative = null
  it = await made(roll({ kind: 'initiative', combatId: 'fight' }, 8))
  assert.deepEqual([it.result.status, cb.initiative], ['done', 8 + wolf.system.attributes.init.total], "the form's combatant found from her own actor")
  midiSettings.autoCheckSaves = 'none'
  asked = opened().length
  const netAgain = await saveCard({ by: thorin, item: net, dc: 13, abilities: ['str'], targets: [wolf] })
  await until(() => opened().length > asked, 'the prompt of the second card at the form')
  prompt = opened().at(-1)
  it = await made(roll({ kind: 'save', key: 'str', prompt: prompt.id }, 9))
  assert.deepEqual([prompt.id, it.result.status, it.result.rolls[0].total, speakerOf(it.result)], [`${netAgain.id}-elowen`, 'done', 9 + wolf.system.abilities.str.save.value, wolf.id],
    'answered from her seat and rolled on the form, for an app that takes no Wild Shape too')
  midiSettings.autoCheckSaves = checkSaves
  app.features.delete('camp-a')
  await hello()
  // A concentration card the form speaks through her token, answered from the app, its save message
  // with no token, as the bridge's are where its canvas doesn't show her: after the return, Foundry's
  // speaker of that save is no actor, yet it's hers, so the prompt stays answered.
  let throughToken = null
  if (!MIDI) {
    const KEEP = 'keepConcTen00000'
    const keep = () => ({ _id: KEEP, name: 'Concentrating: Moonbeam', origin: 'Actor.elowen.Item.elowenMoonbeam00',
      flags: { dnd5e: { item: { id: 'elowenMoonbeam00', type: 'spell', uuid: 'Actor.elowen.Item.elowenMoonbeam00' } } } })
    concentrateOn(elowen, new PlainEffect(elowen, keep()))
    concentrateOn(wolf, new PlainEffect(wolf, keep()))
    asked = opened().length
    const keepCard = foundryLike(await wolf.challengeConcentration({ dc: 10 }), { token: elowenForest })
    await until(() => opened().length > asked, 'the prompt of the card through her token')
    throughToken = opened().at(-1)
    assert.equal(throughToken.id, `${keepCard.id}-elowen`)
    it = await made(roll({ kind: 'save', key: throughToken.abilities[0], prompt: throughToken.id }, 15))
    assert.equal(it.result.status, 'done')
    foundryLike(messages.get(it.result.messageId), { tokenless: true })
  }
  // Fights whose only combatant is the Wolf's, its actor read as core's reads it: from its token on
  // the scene the bridge isn't viewing, which names the form until the module puts it back after the
  // return; and from no token at all (one made by its actor), which reads its stored id.
  const lair = combatOf('lair', [])
  Object.assign(lair, { round: 1, turn: 0 })
  const tokenless = { get actor() { return game.actors.get(wolf.id) ?? null } }
  await lair.createEmbeddedDocuments('Combatant', [
    { id: 'cbLairHall', actor: wolf, token: elowenHall, fields: { followsOnly: elowenHall } },
  ])
  const nest = combatOf('nest', [])
  Object.assign(nest, { round: 1, turn: 0 })
  await nest.createEmbeddedDocuments('Combatant', [{ id: 'cbNestWolf', actor: wolf, fields: { followsOnly: tokenless, tokenId: 'noSuchToken00000', sceneId: 'forest' } }])
  await until(() => ['lair', 'nest'].every(id => sent('combat.created').some(e => e.data.combat.id === id)), 'the fights told to the campaign')
  // A combatant made from the Wolf's token while shaped, in a fight of its own: the 0 hit points ending
  // returns her, her token on the viewed scene hers again before the form is deleted, and the fight
  // stays the campaign's throughout.
  const den = combatOf('den', [])
  Object.assign(den, { round: 1, turn: 0 })
  const combatFrom = app.events.length
  await den.createEmbeddedDocuments('Combatant', [{ id: 'cbDenWolf', actor: wolf, token: elowenForest, fields: { follows: elowenForest } }])
  await until(() => sent('combat.created').some(e => e.data.combat.id === 'den'), 'the fight told to the campaign')
  const denWolf = den.combatants.get('cbDenWolf')
  assert.deepEqual([denWolf.actorId, denWolf.actor?.id], [wolf.id, wolf.id], "the combatant the form's")
  assert.equal(sent('combat.created').filter(e => e.data.combat.id === 'den').at(-1).data.combat.combatants[0].character, 'elowen', 'hers')
  await wolf.update({ 'system.attributes.hp.value': 0 })
  await until(() => !game.actors.get(wolf.id), 'the 0 hit points ending')
  await settle(120)
  assert.equal(denWolf.actor?.id, 'elowen', 'her token hers again, its combatant hers')
  assert.deepEqual(app.events.slice(combatFrom).filter(e => (e.type === 'combat.ended') && (e.campaign?.id === 'camp-a') && (e.data.combat.id === 'den')), [],
    'the fight never ended for the campaign')
  await hello()
  assert.equal(helloOf().combats.find(each => each.id === 'den')?.combatants[0].character, 'elowen', "still the campaign's, her combatant hers")
  game.combats.delete('den')
  const endedOfFight = id => app.events.slice(combatFrom).filter(e => (e.type === 'combat.ended') && (e.campaign?.id === 'camp-a') && (e.data.combat.id === id))
  assert.deepEqual([endedOfFight('lair'), endedOfFight('nest')], [[], []], "the fights whose combatant's token names the deleted form, or that has none, never ended")
  assert.ok(['lair', 'nest'].every(id => helloOf().combats.some(each => each.id === id)), "still the campaign's at the next hello")
  assert.equal(helloOf().combats.find(each => each.id === 'lair').combatants[0].character, 'elowen', 'the combatant whose token is hers again, hers')
  // The one with no token still names the deleted form, which core reads as no actor: hers all the
  // same, with her hit points, and its turn hers to end.
  const nestWolf = helloOf().combats.find(each => each.id === 'nest').combatants[0]
  assert.deepEqual([nest.combatants.get('cbNestWolf').actor, nestWolf.character, nestWolf.hp?.value], [null, 'elowen', elowen.system.attributes.hp.value],
    'the combatant with no token, naming the deleted form, hers')
  it = await made({ id: `seat-${++ids}`, actorId: 'elowen', kind: 'endTurn', turn: { combatId: 'nest', round: 1, combatantId: 'cbNestWolf' }, mode: 0, explicit: false, extras: [], dice: [] })
  assert.deepEqual([it.result.status, it.result.reason, nest.round], ['done', null, 2], 'its turn ended from her seat')
  game.combats.delete('lair')
  game.combats.delete('nest')
  if (throughToken) assert.ok(!helloOf().prompts.some(each => each.id === throughToken.id), 'the card through her token, answered by the form: not open again')
  // The form's card with no token, once the form is gone: still hers, updated and deleted in the app.
  const chatFrom = app.events.length
  await formCard.update({ flavor: 'A Strength save, after the return' })
  const updated = sent('chat.message.updated').filter(e => (app.events.indexOf(e) >= chatFrom) && (e.data.message.id === formCard.id))
  assert.deepEqual(updated.map(e => e.data.message.character), ['elowen'], "updated under Connected, still hers")
  await formCard.delete()
  await Hooks.callAll('deleteChatMessage', formCard, {}, 'gm')
  assert.ok(sent('chat.message.deleted').some(e => (app.events.indexOf(e) >= chatFrom) && (e.data.id === formCard.id)), 'its deletion sent')
  // The form deleted by hand from the sidebar, a fight's only combatant its token's on the viewed
  // scene: still the campaign's.
  await reset()
  assert.equal((await made(transform(wolfId))).result.status, 'done')
  const byHandWolf = formOf()
  const cave = combatOf('cave', [])
  Object.assign(cave, { round: 1, turn: 0 })
  await cave.createEmbeddedDocuments('Combatant', [{ id: 'cbCaveWolf', actor: byHandWolf, token: elowenForest, fields: { followsOnly: elowenForest } }])
  await until(() => sent('combat.created').some(e => e.data.combat.id === 'cave'), 'the cave told to the campaign')
  const caveFrom = app.events.length
  await byHandWolf.delete()
  await settle(120)
  assert.deepEqual(app.events.slice(caveFrom).filter(e => (e.type === 'combat.ended') && (e.data.combat.id === 'cave')), [], 'the form deleted by hand: its fight never ended')
  game.combats.delete('cave')
  // As it was: her hit points and uses, the campaign's switches, chat and the fight.
  await reset()
  await campaignAs({ rolls: false, attacks: false, prompts: false, transfers: false, effects: false, dishes: false })
  for (const key of ['chatEvents', 'chatScope', 'combatEvents']) settings.delete(key)
  game.combat = null
}
ok(`the seat while shaped: a skill and a save rolled on the form, its card hers under Connected${DND5E6 ? '' : "; since 0.42.0 Bless on the form listed on her seat's sheet, the form's, its d4 taken by a save typed on the form"}; the Bite on the form's item; initiative its combatant's; End Turn on its turn done; a familiar her form summoned hers; a dnd5e save card at the form asked of Elowen (<card>-elowen), answered from her seat, the save the form's, closed and gone from the open list; the form's concentration card answered the same${MIDI ? "; Midi-QOL's save asked of the form reaches the app as Elowen's, is answered, and rolled on the form" : ''}; a favorite, an effect, a move to and from her and a removal "shaped"; End concentration ends both copies and what they kept up; charges and an activity's use spent on the form's copies, her sheet first; a dish's card spoken by Elowen, her id the cook's; to an app that takes no Wild Shape, a skill on her own actor, End concentration on both copies, a spend on her own item, her initiative the form's combatant's and a card's save at the form rolled on it; Heroic Inspiration used on the form's copy${MIDI ? '' : "; the form's concentration ended in Foundry closes its card's prompt, her own copy alone leaves it open; a card through her token answered by the form stays answered after the return"}; a fight with only the Wolf's combatant stays the campaign's through the 0 hit points ending, the combatant hers, as do fights whose combatant's token names the deleted form or that has none, that combatant with no token hers with her hit points and its turn hers to end, and one whose form is deleted by hand; the form's card with no token stays hers after the return, updated and deleted`)

/* -------------------------------------------- */
/*  17. Manage Campaigns and the settings row   */
/* -------------------------------------------- */

const label = 'Allow Players to use Wild Shape from the app'
let win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
const fieldset = () => find(win, 'fieldset.sending-stone-wild-shape')
assert.equal(fieldset().querySelector('legend').textContent.trim(), 'Wild Shape')
assert.equal(fieldset().querySelector('label[for="sending-stone-wild-shape"]').textContent.trim(), label)
const order2 = [...win.element.querySelectorAll('fieldset')].map(each => each.className)
assert.deepEqual(order2.slice(order2.indexOf('sending-stone-effects'), order2.indexOf('sending-stone-effects') + 3),
  ['sending-stone-effects', 'sending-stone-wild-shape', 'sending-stone-companions'], 'between Active effects and Companions')
assert.equal(find(win, '[name="campaign.wildShape"]').checked, true, 'ticked, as saved')
const boxes = () => [...fieldset().querySelectorAll('.sending-stone-wild-shape-packs input[type="checkbox"]')].map(box => [box.name, box.checked])
assert.deepEqual(boxes(), [
  ['campaign.wildShapePacks.dnd5e.actors24', true], ['campaign.wildShapePacks.dnd5e.monsters', false], ['campaign.wildShapePacks.world.secret-beasts', false],
], "the world's Actor compendiums, the system's first, the 2024 Actors ticked by default")
const group = fieldset().querySelector('.sending-stone-wild-shape-packs')
assert.deepEqual([group.getAttribute('role'), group.getAttribute('aria-labelledby')], ['group', 'sending-stone-wild-shape-packs'])
assert.equal(fieldset().querySelectorAll('.sending-stone-warning').length, 0, 'no warning: the app takes Wild Shape')
tick(win, 'campaign.wildShapePacks.world.secret-beasts')
await save(win)
assert.deepEqual(settings.get('campaigns')[0].wildShapePacks, ['dnd5e.actors24', 'world.secret-beasts'], "saved by prefix, a pack id's dots kept")
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
tick(win, 'campaign.wildShape', false)
tick(win, 'campaign.wildShapePacks.world.secret-beasts', false)
await save(win)
assert.deepEqual([settings.get('campaigns')[0].wildShape, settings.get('campaigns')[0].wildShapePacks], [false, ['dnd5e.actors24']], 'saved off, the pack unticked')
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.equal(find(win, '[name="campaign.wildShape"]').checked, false)
tick(win, 'campaign.wildShape')
await save(win)
assert.equal(settings.get('campaigns')[0].wildShape, true, 'saved on')
await until(() => helloOf().features.wildShape.enabled, 'the hello after the save')
// An app with commands that doesn't take Wild Shape: Manage Campaigns says so; then one that does.
app.features.set('camp-a', { commands: true })
await hello()
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.deepEqual([...fieldset().querySelectorAll('.sending-stone-warning')].map(each => each.textContent.trim()), [words['SENDINGSTONE.Config.Actions.WildShapeApp']])
await win.close()
app.features.delete('camp-a')
await hello()
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.equal(fieldset().querySelectorAll('.sending-stone-warning').length, 0, "none once it says wildShape: 1")
await win.close()
game.system.id = 'pf2e'
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.ok([...fieldset().querySelectorAll('.sending-stone-warning')].some(each => each.textContent.trim() === 'Not available in this game: it needs the D&D Fifth Edition system.'), 'under another system')
await win.close()
game.system.id = 'dnd5e'
const rowsOf = () => helloOf().settings.sections.find(section => section.id === 'campaign').rows
await hello()
assert.deepEqual(rowsOf().map(each => each.id), ['rolls', 'attacks', 'prompts', 'manualDice', 'transfers', 'dishes', 'effects', 'wildShape', 'companionInitiative', 'groups'])
assert.deepEqual(rowsOf().find(each => each.id === 'wildShape'), { id: 'wildShape', label, value: true, text: 'On' })
game.system.id = 'pf2e'
await hello()
assert.deepEqual(rowsOf().find(each => each.id === 'wildShape'), { id: 'wildShape', label, value: true, text: 'On', note: 'it needs the D&D Fifth Edition system.' })
game.system.id = 'dnd5e'
await hello()
// A form is no candidate character.
await made(transform(wolfId))
assert.ok(formOf() && !candidateActors().includes(formOf()), 'a form is never offered as a character')
assert.ok(candidateActors().includes(elowen))
assert.equal(campaignCharacterId(formOf(), campaign()), 'elowen', "a form stands for its character")
assert.equal((await made(revert())).result.status, 'done')
ok("Manage Campaigns: the Wild Shape fieldset, the user's words, between Active effects and Companions, ticked and saved either way; the packs' boxes for every Actor compendium, the 2024 Actors ticked by default, saved by prefix so a pack id's dots survive; WildShapeApp with an app that has commands but no wildShape, none once it says wildShape: 1; Not available under another system; the settings row after effects, with its note; a form is no candidate character")

/* -------------------------------------------- */
/*  19. Midi-QOL's Bonus Actions (0.41.0)       */
/* -------------------------------------------- */

// Round 0.41.0 §8.2.1: where Midi-QOL makes uses and enforces Bonus Actions, a change and a return
// are refused once one is used in a fight, and mark one used: on the form, or on her once back.
{
  const leaf = readFileSync(`${MODULE}/scripts/midi-economy.mjs`, 'utf8')
  assert.ok(!/^\s*import\b/m.test(leaf) && !/\bimport\s*\(/.test(leaf), 'midi-economy.mjs imports nothing')
  const uses = await import(`${MODULE}/scripts/command-uses.mjs`)
  assert.equal(typeof uses.midiActivities, 'function', 'command-uses.mjs still exports midiActivities')
  ok('the economy is a leaf: midi-economy.mjs imports nothing, and command-uses.mjs still exports midiActivities')
}
if (MIDI) {
  const { midi } = await import('./midi-fake.mjs')
  const viewed = game.combat
  game.combat = fight
  await reset()
  assert.equal(formOf(), undefined, 'herself to begin with')
  const blackBearId = profileId('Black Bear')
  const used = (...ids) => { midi.usedBonus.clear(); for (const id of ids) midi.usedBonus.add(id) }
  const marks = () => [...midi.bonusMarks]
  const back = async () => {
    used()
    if (formOf()) assert.equal((await made(revert())).result.status, 'done', 'back to herself')
    used()
    await reset()
  }
  // 1. Enforced for all, her Bonus Action used: refused, nothing written.
  midi.settings.enforceBonusActions = 'all'
  used('elowen')
  let writes = 0
  const counting = Hooks.on('updateItem', item => { if (item.actor?.id === 'elowen') writes++ })
  let shape = await made(transform(wolfId))
  Hooks.off('updateItem', counting)
  assert.deepEqual(refusal(shape), ['failed', 'bonus-action', null], 'her Bonus Action used: refused')
  assert.deepEqual([formOf(), shapeItem().system.uses.spent, elowenHall.actorId, elowenForest.actorId, writes], [undefined, 0, 'elowen', 'elowen', 0],
    'no form, no use spent, her tokens hers, no item written')
  // 2. Unused: changed, the Bonus Action marked on the form, never on her.
  used()
  let from = marks().length
  shape = await made(transform(wolfId))
  const wolf = formOf()
  assert.equal(shape.result.status, 'done', JSON.stringify(shape.result))
  assert.deepEqual(marks().slice(from), [wolf.id], "marked once, on the form, never 'elowen'")
  // 3. Returning in the same turn, the form's Bonus Action used: refused, still a Wolf.
  shape = await made(revert())
  assert.deepEqual([refusal(shape), formOf()?.id], [['failed', 'bonus-action', null], wolf.id], 'Return refused, still a Wolf')
  // 4. At her next turn: returned, marked on her once back.
  used()
  from = marks().length
  shape = await made(revert())
  assert.deepEqual([shape.result.status, formOf(), marks().slice(from)], ['done', undefined, ['elowen']], 'returned, marked on her')
  ok("Midi-QOL's Enforce bonus actions \"all\" in a fight: her Bonus Action used, a change refused \"bonus-action\" with nothing written (no form, no use spent, her tokens hers, no item update); unused, the change made and marked once, on the form; a Return in the same turn refused, the Wolf kept; at her next turn returned and marked on her")

  // 5. "displayOnly": never refused, the form marked once.
  await reset()
  midi.settings.enforceBonusActions = 'displayOnly'
  used('elowen')
  from = marks().length
  shape = await made(transform(wolfId))
  assert.deepEqual([shape.result.status, marks().slice(from)], ['done', [formOf().id]], 'displayOnly: changed, the form marked once')
  await back()
  // 6. "character": enforced for her; "npc": neither refused nor marked.
  midi.settings.enforceBonusActions = 'character'
  used('elowen')
  assert.deepEqual(refusal(await made(transform(wolfId))), ['failed', 'bonus-action', null], '"character": enforced for her')
  midi.settings.enforceBonusActions = 'npc'
  from = marks().length
  shape = await made(transform(wolfId))
  assert.deepEqual([shape.result.status, marks().slice(from)], ['done', []], '"npc": neither refused nor marked')
  await back()
  // 7. Out of a fight: neither checked nor marked.
  midi.settings.enforceBonusActions = 'all'
  game.combat = null
  used('elowen')
  from = marks().length
  shape = await made(transform(wolfId))
  assert.deepEqual([shape.result.status, marks().slice(from)], ['done', []], 'out of a fight: neither')
  shape = await made(revert())
  assert.deepEqual([shape.result.status, marks().slice(from)], ['done', []], 'nor its return')
  game.combat = fight
  await reset()
  ok('"displayOnly": never refused, the form marked once; "character" enforced for her; "npc" neither refused nor marked; out of a fight, neither checked nor marked, a change or a return')

  // 8. A change while shaped: the Wolf's Bonus Action used, refused, the Wolf kept and no use spent;
  // at its next turn the Black Bear, one Bonus Action and one mark, on the new form.
  used()
  shape = await made(transform(wolfId))
  const wolf2 = formOf()
  assert.equal(shape.result.status, 'done')
  const spentThen = shapeItem().system.uses.spent
  shape = await made(transform(blackBearId))
  assert.deepEqual([refusal(shape), formOf()?.id, shapeItem().system.uses.spent], [['failed', 'bonus-action', null], wolf2.id, spentThen], 'the Wolf marked: refused, kept, no use spent')
  used()
  from = marks().length
  shape = await made(transform(blackBearId))
  const bear = formOf()
  assert.deepEqual([shape.result.status, bear?.name, marks().slice(from)], ['done', 'Elowen (Black Bear)', [bear.id]], 'one mark, on the new form')
  await back()
  // 9. "none": no refusal, no mark.
  midi.settings.enforceBonusActions = 'none'
  used('elowen')
  from = marks().length
  shape = await made(transform(wolfId))
  assert.deepEqual([shape.result.status, marks().slice(from)], ['done', []], '"none": neither')
  await back()
  // 10. No uses left and her Bonus Action used: "consume", the use's check first.
  midi.settings.enforceBonusActions = 'all'
  await shapeItem().update({ 'system.uses.spent': shapeItem().system.uses.max })
  used('elowen')
  assert.deepEqual(refusal(await made(transform(wolfId))), ['failed', 'consume', null], 'no uses left: consume, not bonus-action')
  await reset()
  ok('a change while shaped: the Wolf\'s Bonus Action used, refused, the Wolf kept and no use spent; next turn the Black Bear, one mark, on the new form; "none" neither; no uses left "consume" before "bonus-action"')

  // 11. Core matching a combatant by the actor it stored (her own), not its token's (the form's):
  // a change while shaped still checked, her own actor in the fight.
  port.faults.storedActorId = true
  used()
  shape = await made(transform(wolfId))
  assert.equal(shape.result.status, 'done')
  assert.deepEqual([formOf().inCombat, elowen.inCombat], [false, true], "the form not in the fight by core's reading, she is")
  shape = await made(transform(blackBearId))
  assert.deepEqual([refusal(shape), formOf()?.name], [['failed', 'bonus-action', null], 'Elowen (Wolf)'], 'still checked, by her own actor in the fight')
  port.faults.storedActorId = false
  await back()
  // 12. Midi not making uses (ReplaceDefaultActivities off): neither checked nor marked.
  settings.set('ReplaceDefaultActivities', false)
  used('elowen')
  from = marks().length
  shape = await made(transform(wolfId))
  assert.deepEqual([shape.result.status, marks().slice(from)], ['done', []], "Midi's activities off: neither")
  settings.delete('ReplaceDefaultActivities')
  await back()
  ok("core matching a combatant by its stored actor: a change while shaped still checked, by her own actor in the fight; Midi-QOL not making uses: neither checked nor marked")

  // 13. Midi with no marker effect (enforcement turned on without a reload): done, nothing marked.
  midi.noMarker = true
  used()
  from = marks().length
  shape = await made(transform(wolfId))
  assert.deepEqual([shape.result.status, marks().slice(from), midi.usedBonus.size], ['done', [], 0], 'no marker: done, nothing marked')
  midi.noMarker = false
  await back()
  // 14. Midi throwing as it marks: done, the form made, the failure logged.
  const errors = []
  const logged = console.error
  console.error = (...args) => errors.push(args.map(String).join(' '))
  const setter = MidiQOL.setBonusActionUsed
  MidiQOL.setBonusActionUsed = async () => { throw new Error('Midi broke') }
  shape = await made(transform(wolfId))
  MidiQOL.setBonusActionUsed = setter
  console.error = logged
  assert.deepEqual([shape.result.status, formOf()?.name], ['done', 'Elowen (Wolf)'], 'done, the form made')
  assert.ok(errors.some(line => line.includes("Could not mark Elowen's Bonus Action for Midi-QOL")), 'the failure logged')
  await back()
  // A change that fails once checked (transformInto throwing): refunded, nothing marked.
  used()
  from = marks().length
  port.faults.throwOnTransform = true
  shape = await made(transform(wolfId))
  assert.deepEqual([refusal(shape)[1], formOf(), shapeItem().system.uses.spent, marks().slice(from)], ['error', undefined, 0, []], 'refunded, nothing marked')
  midi.settings.enforceBonusActions = 'none'
  used()
  game.combat = viewed
  ok('Midi-QOL with no marker effect: done, nothing marked; Midi throwing as it marks: done, the form made, the failure logged; a change that fails once checked: refunded, nothing marked')

  // Damage on its own from the form, with consume (round 0.41.0 §2.5.3.2, §2.6.6): a Bonus Action of
  // the form's is checked and marked on the form, where Midi keeps it, never on Elowen, even where core
  // finds only Elowen's own actor in the fight, by the id the form's combatant stores.
  const activity5e = await import('./activity5e.mjs')
  const documents = globalThis.dnd5e.documents
  globalThis.dnd5e.documents = { activity: { AttackActivity: activity5e.AttackActivity, SaveActivity: activity5e.SaveActivity, DamageActivity: activity5e.DamageActivity, HealActivity: activity5e.HealActivity } }
  await campaignAs({ rolls: true, attacks: true })
  game.combat = fight
  midi.settings.enforceBonusActions = 'all'
  port.faults.storedActorId = true
  used()
  shape = await made(transform(wolfId))
  assert.equal(shape.result.status, 'done', JSON.stringify(shape.result))
  const shaped = formOf()
  assert.deepEqual([shaped.inCombat, elowen.inCombat], [false, true], "the form not in the fight by core's reading, Elowen is")
  const bite = [...shaped.items].find(item => item.name === 'Bite')
  const biting = [...bite.system.activities].find(activity => activity.type === 'attack')
  biting.activation = { type: 'bonus', value: 1 }
  const alone = () => ({ id: `alone-${++ids}`, actorId: 'elowen', kind: 'itemDamage', item: bite.id, activity: biting.id, consume: true, mode: 0, explicit: false, extras: [], dice: [{ faces: 6, results: [3] }] })
  used(shaped.id)
  assert.deepEqual(refusal(await made(alone())), ['failed', 'bonus-action', null], "the form's Bonus Action used: refused")
  used('elowen')
  from = marks().length
  shape = await made(alone())
  assert.deepEqual([shape.result.status, marks().slice(from)], ['done', [shaped.id]], "only Elowen's own used: rolled, marked once, on the form")
  port.faults.storedActorId = false
  await back()
  midi.settings.enforceBonusActions = 'none'
  if (documents === undefined) delete globalThis.dnd5e.documents
  else globalThis.dnd5e.documents = documents
  await campaignAs({ rolls: false, attacks: false })
  game.combat = viewed
  ok("damage on its own from the form, a Bonus Action with consume, under Enforce bonus actions \"all\" and core matching the form's combatant by Elowen's stored id: refused \"bonus-action\" while the form's is used; with only Elowen's own used, rolled and marked once, on the form")
} else {
  // 15. Without Midi-QOL: changed and returned in a fight as before, nothing asked of it.
  const viewed = game.combat
  game.combat = fight
  await reset()
  assert.equal(globalThis.MidiQOL, undefined, 'no Midi-QOL')
  assert.equal((await made(transform(wolfId))).result.status, 'done')
  assert.equal((await made(revert())).result.status, 'done')
  game.combat = viewed
  ok('without Midi-QOL: a change and a return in a fight as before')
}

process.exit(0)
