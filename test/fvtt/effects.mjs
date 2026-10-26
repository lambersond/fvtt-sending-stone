// A player's own effects turned off, on and deleted from the app (module 0.39.0, its contract §1.2,
// §1.4, §1.5, §1.9): the hello's `features.effects`, last, after `dishes`, by the campaign's own
// switch under D&D Fifth Edition; the fetching it needs with every other switch off; each effect
// row's `ops`, the party's effects by who put them there, an item's temporary ones toggled, never a
// condition, a concentration or what it keeps up; the `effect` command's checks in their order; the
// write, with the module's option, and the mark it leaves; what's already so; reading again after a
// hook stops a write; Foundry's throws; the sheet ahead of every `done` that wrote; the queue; Manage
// Campaigns and the settings row; and the mark cleared by any other change. With DND5E6=1, dnd5e
// 6.0.5's condition effects. The real module and its language file; dnd5e 5.3.3's real dice classes
// for the self-test; a stand-in Foundry core and app; the characters dnd5e-cards.mjs's, given effects
// by effects-core.mjs on dish-core.mjs's withDishes, with the contract's §1.2 fixtures. Timers of a
// second or more run a hundred times faster. Run with SLIM_CHECK=1 and --import
// ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'
import { click, find, openSettings, save, tick, view } from './settings-app.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
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
CONST.DOCUMENT_OWNERSHIP_LEVELS = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }
game.documentTypes = { Actor: ['character', 'npc', 'group'], Item: ['weapon', 'equipment', 'consumable', 'feat', 'spell'] }
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

const dishCore = await import('./dish-core.mjs')
dishCore.installDishCore()
const core = await import('./effects-core.mjs')
const { PlainEffect, withEffects, itemOn, effectOn, effectOnItem, partyEffects, faults, writes, EXPECTED_OPS } = core
core.installEffectsCore()

// ---- The world: the Gamemaster, the bridge, and two players ----
users.activeGM = user('gm', 'Gamemaster', true)
user('alice', 'Alice')
user('bob', 'Bob')
const { Character } = await import('./dnd5e-cards.mjs')
const SKILLS = { prc: { ability: 'wis' }, ste: { ability: 'dex' } }
const add = (data, type = 'character') => {
  const actor = new Character({ skills: SKILLS, ...data })
  actor.type = type
  actor.img = `icons/${data.id}.webp`
  actors.set(actor.id, actor)
  withEffects(actor, { hp: { value: 30, max: 40 } })
  return actor
}
// Thorin, Alice's; Vex, Bob's; a bandit and a cultist, NPCs no player owns.
const thorin = add({ id: 'thorin', name: 'Thorin Oakenshield', owners: ['alice'] })
const vex = add({ id: 'vex', name: 'Vex', owners: ['bob'] })
const bandit = add({ id: 'bandit', name: 'Bandit', owners: [] }, 'npc')
const cultist = add({ id: 'cultist', name: 'Cultist', owners: [] }, 'npc')
assert.deepEqual([thorin, vex, bandit, cultist].map(actor => actor.hasPlayerOwner), [true, true, false, false])
const fx = partyEffects({ thorin, vex, bandit, cultist }, { dnd5e6: DND5E6 })
// What the sheet never shows Thorin's player: an effect dnd5e conceals; a cursed amulet's, not yet
// identified; a flame tongue's rider whose origin is inactive, and another rider dnd5e drops from
// allApplicableEffects; and dnd5e 5's Poisoned with no time left, a condition listed as one.
const veiled = effectOn(thorin, { _id: 'veiled', name: 'Veiled Doom', origin: fx.blessSpellItem.uuid, duration: { rounds: 3, value: 3, units: 'rounds', remaining: 3 }, system: { isConcealed: true } })
const amulet = itemOn(thorin, { _id: 'amulet', name: 'Cursed Amulet', type: 'equipment', identified: false })
effectOnItem(amulet, { _id: 'curse', name: 'Curse', duration: { rounds: 3, value: 3, units: 'rounds', remaining: 3 } })
const tongue = itemOn(thorin, { _id: 'tongue', name: 'Flame Tongue', type: 'weapon', flags: { dnd5e: { riders: { effect: ['dropped'] } } } })
effectOnItem(tongue, { _id: 'ember', name: 'Ember', duration: { rounds: 3, value: 3, units: 'rounds', remaining: 3 }, dependentOrigin: { active: false } })
effectOnItem(tongue, { _id: 'dropped', name: 'Flare', duration: { rounds: 3, value: 3, units: 'rounds', remaining: 3 } })
const poisoned = DND5E6 ? null : effectOn(thorin, { _id: dnd5e.utils.staticID('dnd5epoisoned'), name: 'Poisoned', statuses: ['poisoned'] })
// The Company, a Group actor of the campaign's, whose own effect a dish put there.
const party = {
  documentName: 'Actor', id: 'party', name: 'The Company', type: 'group', uuid: 'Actor.party', img: 'party.webp', flags: {},
  ownership: { default: 0, alice: 3 }, system: { members: [], description: { full: '', summary: '' } }, effects: [], items: new Map(),
  getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
  testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
  *allApplicableEffects() { yield* this.effects },
}
party.effects.push(new PlainEffect(party, { _id: 'feast', name: 'Feast', duration: { seconds: 3600, value: 1, units: 'hours', remaining: 3600 }, flags: { 'sending-stone': { dish: { id: 'x' } } } }))
actors.set('party', party)

// ---- The app: it says it takes effects, unless told to say otherwise ----
const app = { events: [], polls: [], waiting: new Map(), wake: null, features: new Map() }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const id = body.campaign?.id
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    return ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
      ? json({ features: app.features.get(id) ?? { commands: true, effects: 1 } })
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
const resultsOf = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)

let ids = 0
const BASE = { actorId: 'thorin', kind: 'effect', mode: 0, explicit: false, extras: [], dice: [] }
/** An effect turned off, on or deleted, as the app hands it over. */
const effecting = (op, id, fields = {}) => ({ id: `effect-${++ids}`, ...BASE, effect: { op, id }, ...fields })
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
/** The sheets of Thorin sent between a command's fetch and its result. */
const sheetsIn = ({ after }) => after.filter(e => (e.type === 'character.updated') && (e.data.character.id === 'thorin'))
/** An effect's row in a sheet, by its id as the sheet names it. */
const rowOf = (sheet, id) => sheet.effects.flatMap(section => section.effects).find(row => row.id === id) ?? null
const markOf = effect => effect.flags?.['sending-stone']?.offByPlayer
/** The writes made since a mark, as `[op, id]`. */
const writesSince = mark => writes.slice(mark).map(each => [each.op, each.id])
const updated = []
Hooks.on('updateActiveEffect', (effect, changes, options) => updated.push({ id: effect.id, changes, options }))

// ---- Start-up, as Foundry would ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
const CAMPAIGN = { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex'], groups: [], rolls: false, attacks: false, transfers: false, dishes: false }
settings.set('campaigns', [CAMPAIGN])
await Hooks.callAll('ready')
await until(() => sent('bridge.hello').length, 'the hello')
await settle(80)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { effectReader, runEffectCommand } = await import(`${MODULE}/scripts/command-effects.mjs`)
const { opsOf } = await import(`${MODULE}/scripts/sheet-effects.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
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

/* -------------------------------------------- */
/*  1. The hello                                */
/* -------------------------------------------- */

const OFF = { enabled: false, kinds: [], reason: 'off' }
const ON = { enabled: true, kinds: ['effect'], reason: null }
const SYSTEM = { enabled: false, kinds: [], reason: 'system' }
assert.deepEqual(helloOf().features.effects, OFF, 'off by default, a campaign saved without the field')
assert.deepEqual(Object.keys(helloOf().features), ['rolls', 'transfers', 'removals', 'notes', 'companions', 'favorites', 'dishes', 'effects'])
await campaignAs({ effects: true })
assert.deepEqual(helloOf().features.effects, ON, 'a saved switch sends the hello again, on')
assert.ok(!helloOf().features.rolls.kinds.includes('effect') && !helloOf().features.companions.kinds.includes('effect'), "never among the rolls' kinds, nor a companion's")
game.system.id = 'pf2e'
await hello()
assert.deepEqual(helloOf().features.effects, SYSTEM, 'under another system')
game.system.id = 'dnd5e'
await campaignAs({ effects: false })
game.system.id = 'pf2e'
await hello()
assert.deepEqual(helloOf().features.effects, OFF, '"off" before "system"')
game.system.id = 'dnd5e'
await campaignAs({ effects: true })
assert.deepEqual(helloOf().features.effects, ON)
ok(`the hello's features.effects, last, after dishes: off with the switch off, a campaign saved without it among them; "system" with it on under another system, "off" before it; on with it on under dnd5e ${DND5E6 ? '6.0.5' : '5.3.3'}; a saved switch sends the hello again; never among the rolls' or a companion's kinds`)

if (DND5E6) {
  /* ------------------------------------------ */
  /*  11. dnd5e 6.0.5                           */
  /* ------------------------------------------ */
  const sheet = characterSheet(thorin)
  const rows = sheet.effects.flatMap(section => section.effects)
  assert.equal(rowOf(sheet, 'proneCondition'), null, "a condition's effect is listed as a condition, not an effect")
  assert.deepEqual([opsOf(fx.prone, thorin), opsOf(fx.invisible, thorin)], [[], []], 'a type: "condition" effect, even one the party put there')
  assert.deepEqual(rowOf(sheet, 'hasteConc').ops, [], 'a concentration, type "condition" and concentrating, listed and given nothing')
  for (const [name, ops] of Object.entries(EXPECTED_OPS)) {
    if (name === 'prone') continue
    const id = (fx[name].parent?.documentName === 'Item') ? `${fx[name].parent.id}.${fx[name].id}` : fx[name].id
    assert.deepEqual(rowOf(sheet, id)?.ops, ops, `${name}: ${JSON.stringify(ops)}`)
  }
  assert.ok(rows.every(row => Array.isArray(row.ops)))
  let it = await made(effecting('disable', 'bless'))
  assert.deepEqual(it.result, { id: it.command.id, ...DONE, effect: { id: 'bless', disabled: true, deleted: false } })
  assert.equal(markOf(fx.bless), true, 'marked')
  it = await made(effecting('delete', 'bless'))
  assert.deepEqual(it.result, { id: it.command.id, ...DONE, effect: { id: 'bless', disabled: null, deleted: true } })
  assert.ok(!thorin.effects.includes(fx.bless), 'gone')
  for (const id of ['proneCondition', 'invisibleCond', 'hasteConc']) {
    assert.deepEqual(refusal(await made(effecting('disable', id))), ['failed', 'effect', null], id)
  }
  ok('dnd5e 6.0.5: a type "condition" effect gives no ops, even one an ally put there, and a concentration none; every other fixture as under dnd5e 5; Bless turned off and deleted; Turn off of a condition or a concentration refused "effect"')
  process.exit(0)
}

/* -------------------------------------------- */
/*  2. Fetching                                 */
/* -------------------------------------------- */

const pollsOf = () => app.polls.filter(id => id === 'camp-a').length
const polling = async () => { const before = pollsOf(); await settle(150); return pollsOf() > before + 1 }
const campaign = () => getCampaigns()[0]
assert.deepEqual([campaign().rolls, campaign().transfers, campaign().dishes], [false, false, false], "the campaign's rolls, moves and dishes off")
assert.equal(await polling(), true, 'fetched for, the answer {commands: true, effects: 1} alone')
for (const [features, why] of [
  [{ effects: 1 }, 'without commands'], [{ commands: true, effects: 0 }, 'effects: 0'], [{ commands: true, effects: '1' }, 'effects: "1"'],
  [{ commands: true, effects: true }, 'effects: true'], [{ commands: true }, 'an answer without effects'],
]) {
  app.features.set('camp-a', features)
  await hello()
  await settle(60)
  assert.equal(await polling(), false, why)
}
assert.equal(effectReader('camp-a'), false, 'the reader dropped by an answer without effects')
app.features.delete('camp-a')
await hello()
assert.equal(await polling(), true, 'fetched again once the answer says so')
assert.equal(effectReader('camp-a'), true)
await campaignAs({ effects: false })
await settle(60)
assert.equal(await polling(), false, 'the switch off: not fetched for, the app taking effects though it does')
await campaignAs({ effects: true })
await settle(60)
assert.equal(await polling(), true)
ok('with every other switch off, the campaign is fetched for where its switch is on and the answer says effects: 1 with commands; 0, "1", true, none or no commands don\'t count, and an answer without it drops the reader; the switch off, not fetched for')

/* -------------------------------------------- */
/*  3. ops                                      */
/* -------------------------------------------- */

const sheetIdOf = effect => ((effect.parent?.documentName === 'Item') ? `${effect.parent.id}.${effect.id}` : effect.id)
let sheet = characterSheet(thorin)
for (const [name, ops] of Object.entries(EXPECTED_OPS)) {
  assert.deepEqual(rowOf(sheet, sheetIdOf(fx[name]))?.ops, ops, `${name}: ${JSON.stringify(ops)}`)
  assert.deepEqual(opsOf(fx[name], thorin), ops, `${name}, by opsOf alone`)
}
const row = rowOf(sheet, 'bless')
assert.deepEqual(Object.keys(row), ['id', 'name', 'img', 'source', 'duration', 'disabled', 'ops', 'text'], 'ops after disabled')
assert.deepEqual([row.name, row.source, row.disabled], ['Bless', 'Vex', false])
for (const id of ['veiled', 'amulet.curse', 'tongue.ember', 'tongue.dropped', poisoned.id]) assert.equal(rowOf(sheet, id), null, `${id} isn't listed`)
// Rage, in each of its three states: off as dnd5e keeps it; on, turned on in Foundry; off again from the app.
await fx.rage.update({ disabled: false })
assert.deepEqual(rowOf(characterSheet(thorin), 'rage.rageEffect').ops, ['disable'], 'Rage turned on in Foundry')
await fx.rage.update({ disabled: true, 'flags.sending-stone.offByPlayer': true }, { sendingStone: 'effect' })
assert.deepEqual(rowOf(characterSheet(thorin), 'rage.rageEffect').ops, ['enable'], 'Rage turned off from the app')
await fx.rage.update({ disabled: false })
await fx.rage.update({ disabled: true })
assert.deepEqual([rowOf(characterSheet(thorin), 'rage.rageEffect').ops, markOf(fx.rage)], [[], false], 'Rage as dnd5e keeps it again')
// The sheet the app is sent says the same.
await hello()
const told = sent('character.updated').filter(e => e.data.character.id === 'thorin').at(-1).data.character.sheet
assert.deepEqual(rowOf(told, 'bless').ops, ['disable', 'delete'], 'in the sheet sent after the hello')
assert.deepEqual(rowOf(told, 'rage.rageEffect').ops, [])
// A companion's sheet is built without them (creature-sync.mjs; companions.mjs checks the one it sends).
const noOps = characterSheet(thorin, undefined, { ops: false }).effects.flatMap(section => section.effects)
assert.ok(noOps.length && noOps.every(each => (Array.isArray(each.ops) && !each.ops.length)), "a companion's rows: ops []")
ok("each of §1.2's fixtures gives its ops, in the sheet and by opsOf, Rage in each of its three states, and a suppressed item's temporary effect none; ops after disabled in the row's exact keys; an effect dnd5e conceals, an unidentified item's, an inactive rider, a rider dnd5e drops and Poisoned with no time left aren't listed; the sheet sent says the same; with ops: false, as a companion's is built, every row's ops []")

/* -------------------------------------------- */
/*  4. Turn off                                 */
/* -------------------------------------------- */

let mark = writes.length
let marks = updated.length
let it = await made(effecting('disable', 'bless'))
assert.deepEqual(it.result, { id: it.command.id, ...DONE, effect: { id: 'bless', disabled: true, deleted: false } })
assert.deepEqual(writes.slice(mark).map(({ op, id, changes, options }) => [op, id, changes, options]),
  [['update', 'bless', { disabled: true, 'flags.sending-stone.offByPlayer': true }, { sendingStone: 'effect' }]], 'one update, with the mark and the option')
assert.deepEqual(updated.slice(marks).map(each => [each.id, each.options]), [['bless', { sendingStone: 'effect' }]], 'updateActiveEffect fired')
assert.equal(sheetsIn(it).length, 1, 'the sheet before the result')
assert.deepEqual([rowOf(sheetsIn(it)[0].data.character.sheet, 'bless').ops, rowOf(sheetsIn(it)[0].data.character.sheet, 'bless').disabled], [['enable', 'delete'], true], 'off in the sheet sent, Turn on offered')
assert.equal(markOf(fx.bless), true, 'marked')
mark = writes.length
it = await made(effecting('disable', 'bless'))
assert.deepEqual(it.result, { id: it.command.id, ...DONE, effect: { id: 'bless', disabled: true, deleted: false } }, 'again: done')
assert.deepEqual(writesSince(mark), [], 'nothing written')
assert.equal(messages.size, 0, 'no chat message')
ok('Turn off of Bless: one update, disabled and marked, with the module\'s option, updateActiveEffect fired, the sheet ahead of the result, done with effect {id, disabled: true, deleted: false}; Turn on offered; again, done with nothing written; no chat message')

/* -------------------------------------------- */
/*  5. Turn on                                  */
/* -------------------------------------------- */

mark = writes.length
it = await made(effecting('enable', 'bless'))
assert.deepEqual(it.result, { id: it.command.id, ...DONE, effect: { id: 'bless', disabled: false, deleted: false } })
assert.deepEqual(writes.slice(mark).map(({ id, changes, options }) => [id, changes, options]),
  [['bless', { disabled: false, 'flags.sending-stone.offByPlayer': false }, { sendingStone: 'effect' }]])
assert.deepEqual([fx.bless.disabled, markOf(fx.bless)], [false, false], 'on, the mark false')
assert.deepEqual(rowOf(sheetsIn(it)[0].data.character.sheet, 'bless').ops, ['disable', 'delete'])
it = await made(effecting('enable', 'shieldOfFaith'))
assert.deepEqual([it.result.effect, fx.shieldOfFaith.disabled, markOf(fx.shieldOfFaith)], [{ id: 'shieldOfFaith', disabled: false, deleted: false }, false, false], 'Shield of Faith the same')
mark = writes.length
assert.deepEqual(refusal(await made(effecting('enable', 'heroism'))), ['failed', 'effect', null], 'Heroism, turned off in Foundry: refused')
assert.deepEqual([writesSince(mark), fx.heroism.disabled], [[], true])
await fx.rage.update({ disabled: false })
it = await made(effecting('disable', 'rage.rageEffect'))
assert.deepEqual([it.result.effect, opsOf(fx.rage, thorin)], [{ id: 'rage.rageEffect', disabled: true, deleted: false }, ['enable']], "Rage, on its feature: off, Turn on alone")
it = await made(effecting('enable', 'rage.rageEffect'))
assert.deepEqual([it.result.effect, fx.rage.disabled, opsOf(fx.rage, thorin)], [{ id: 'rage.rageEffect', disabled: false, deleted: false }, false, ['disable']], 'and on again')
ok('Turn on of Bless and of Shield of Faith, each marked off from the app: on, the mark false, done with disabled: false; Heroism, turned off in Foundry, refused "effect"; Rage, turned on in Foundry, then off from the app, offers Turn on alone, which turns it on again')

/* -------------------------------------------- */
/*  6. Delete                                   */
/* -------------------------------------------- */

mark = writes.length
it = await made(effecting('delete', 'invisibility'))
assert.deepEqual(it.result, { id: it.command.id, ...DONE, effect: { id: 'invisibility', disabled: null, deleted: true } })
assert.deepEqual(writes.slice(mark).map(({ op, id, options }) => [op, id, options]), [['delete', 'invisibility', { sendingStone: 'effect' }]])
assert.ok(!thorin.effects.includes(fx.invisibility), 'gone from Thorin')
assert.equal(rowOf(sheetsIn(it)[0].data.character.sheet, 'invisibility'), null, 'gone from the sheet sent ahead of the result')
mark = writes.length
it = await made(effecting('delete', 'invisibility'))
assert.deepEqual([it.result.effect, writesSince(mark)], [{ id: 'invisibility', disabled: null, deleted: true }, []], 'again: done, nothing deleted')
const lines = messages.size
it = await made(effecting('delete', 'emberSkewers'))
assert.deepEqual([it.result.effect, thorin.effects.includes(fx.ember), messages.size], [{ id: 'emberSkewers', disabled: null, deleted: true }, false, lines], "the dish's effect deleted, no card touched")
mark = writes.length
assert.deepEqual(refusal(await made(effecting('delete', 'rage.rageEffect'))), ['failed', 'effect', null], "Rage, an item's: never deleted")
assert.deepEqual([writesSince(mark), fx.rageItem.effects.has('rageEffect')], [[], true])
ok("Delete of Invisibility: one delete with the module's option, gone, done with effect {disabled: null, deleted: true}, the sheet ahead; again, done, nothing deleted; the dish's effect deleted, no card touched; Rage, an item's, refused \"effect\"")

/* -------------------------------------------- */
/*  7. Refusals                                 */
/* -------------------------------------------- */

mark = writes.length
const shaped = (effect, fields = {}) => ({ id: `effect-${++ids}`, ...BASE, effect, ...fields })
for (const [command, error, why] of [
  [effecting('disable', 'bless', { by: 'gm' }), 'by', "the Gamemaster's"],
  [effecting('disable', 'bless', { by: 'player' }), 'by', "by: 'player'"],
  [effecting('disable', 'bless', { of: 'wolf' }), 'of', "a companion's, by `of`"],
  [effecting('disable', 'bless', { favorite: { op: 'add', type: 'effect', id: 'bless' } }), 'effect', 'a favorite beside it'],
  [effecting('disable', 'bless', { key: 'prc' }), 'effect', "a roll's field"],
  [effecting('disable', 'bless', { remove: { item: 'x', quantity: 1, held: 1 } }), 'effect', 'a removal'],
  [effecting('disable', 'bless', { typed: false }), 'effect', 'typed'],
  [effecting('disable', 'bless', { note: { op: 'add' } }), 'effect', 'a note'],
  [effecting('disable', 'bless', { dish: { queuedAt: 1 } }), 'effect', 'a dish'],
  [shaped(undefined), 'effect', 'no effect'],
  [shaped('bless'), 'effect', 'a string'],
  [shaped([{ op: 'disable', id: 'bless' }]), 'effect', 'an array'],
  [shaped({ op: 'toggle', id: 'bless' }), 'effect', 'a toggle'],
  [shaped({ op: 'disable', id: 'bless', name: 'Bless' }), 'effect', 'an extra key'],
  [shaped({ op: 'disable' }), 'effect', 'no id'],
  [shaped({ op: 'disable', id: 'a.b.c' }), 'effect', 'a two-dot id'],
  [shaped({ op: 'disable', id: 'b'.repeat(65) }), 'effect', 'an id too long'],
  [shaped({ op: 'disable', id: 5 }), 'effect', 'an id not a string'],
  [effecting('disable', 'bless', { dice: [{ faces: 20, results: [12] }] }), 'dice', 'a die'],
  [effecting('disable', 'bless', { mode: 1 }), 'dice', 'advantage'],
]) {
  it = await made(command)
  assert.deepEqual(refusal(it), ['failed', 'invalid', error], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
// Turned off once fetched, as a queue's wait may leave it: the campaign is read again.
const stale = campaign()
await campaignAs({ effects: false })
let answer = await runEffectCommand(effecting('disable', 'bless'), stale)
assert.deepEqual([answer.status, answer.reason], ['failed', 'off'], 'the switch off after it was fetched')
await campaignAs({ effects: true })
game.system.id = 'pf2e'
answer = await runEffectCommand(effecting('disable', 'bless'), campaign())
game.system.id = 'dnd5e'
assert.deepEqual([answer.status, answer.reason], ['failed', 'off'], 'another system')
assert.deepEqual([answer.status, answer.reason], ['failed', 'off'])
// Not the campaign's character: an actor outside it, and the Company, its group, listed among its characters too.
assert.deepEqual(refusal(await made(effecting('disable', 'bane', { actorId: 'bandit' }))), ['failed', 'unknown', null], 'an actor outside the campaign')
await campaignAs({ characters: ['thorin', 'vex', 'party'], groups: ['party'] })
assert.deepEqual(refusal(await made(effecting('disable', 'feast', { actorId: 'party' }))), ['failed', 'unknown', null], 'the Company, a group')
assert.equal(party.effects[0].disabled, false)
await campaignAs({ characters: ['thorin', 'vex'], groups: [] })
// What its player may not change, or not that way now.
for (const [id, op, why] of [
  ['ring.ringEffect', 'disable', 'Ring of Protection, passive, on an item'],
  ['boots.bootsHaste', 'disable', 'a suppressed item effect, Boots of Speed temporary but not worn'],
  ['ravenQueen', 'disable', 'Blessing of the Raven Queen, made on the sheet'],
  ['ravenQueen', 'delete', 'Blessing of the Raven Queen, deleted'],
  ['bane', 'disable', "Bane, the bandit's"],
  ['holdPerson', 'delete', "Hold Person, the cultist's"],
  [fx.prone.id, 'disable', 'Prone, a condition'],
  ['haste', 'disable', 'Haste, kept up by his own concentration'],
  ['hasteConc', 'delete', 'Concentrating: Haste'],
  ['mageArmor', 'enable', 'Turn on of Mage Armor, expired'],
  ['veiled', 'disable', 'a concealed effect'],
  ['amulet.curse', 'delete', "an unidentified item's"],
  ['tongue.ember', 'disable', 'an inactive rider'],
  [poisoned.id, 'delete', 'Poisoned, with no time left'],
]) {
  it = await made(effecting(op, id))
  assert.deepEqual(refusal(it), ['failed', 'effect', null], why)
  assert.deepEqual(sheetsIn(it), [], `${why}: no sheet`)
}
for (const [id, why] of [['nothing', 'an id not there'], ['tongue.dropped', 'a rider dnd5e leaves out of allApplicableEffects'], ['amulet.nothing', 'none on that item']]) {
  assert.deepEqual(refusal(await made(effecting('disable', id))), ['failed', 'gone', null], why)
}
assert.deepEqual(writesSince(mark), [], 'nothing written for any')
ok('refuses as "invalid" the Gamemaster\'s (`by`), a companion\'s (`of`), one naming anything else or not exactly {op, id} of disable, enable or delete and an id as the sheet names it (`effect`), and dice (`dice`); "off" with the switch off after it was fetched, the campaign read again, and under another system; "unknown" for an actor outside the campaign and its group; "effect" for the Ring, the suppressed Boots of Speed, the Raven Queen, Bane, Hold Person, Prone, Haste and its concentration, Turn on of an expired Mage Armor, and crafted ids the sheet never lists; "gone" for one not there, a rider dnd5e leaves out; nothing written')

/* -------------------------------------------- */
/*  8. Failures                                 */
/* -------------------------------------------- */

faults.throwOn.set('bless', 'before')
it = await made(effecting('disable', 'bless'))
assert.deepEqual([refusal(it), sheetsIn(it)], [['failed', 'error', 'Bless could not be updated'], []], 'an update that throws')
it = await made(effecting('delete', 'bless'))
faults.throwOn.delete('bless')
assert.deepEqual([refusal(it), thorin.effects.includes(fx.bless)], [['failed', 'error', 'Bless could not be deleted'], true], 'a delete that throws, the effect still there')
faults.throwOn.set('shieldOfFaith', 'gone')
it = await made(effecting('delete', 'shieldOfFaith'))
assert.deepEqual([it.result.status, it.result.effect, thorin.effects.includes(fx.shieldOfFaith)], ['done', { id: 'shieldOfFaith', disabled: null, deleted: true }, false],
  'a delete that throws, the effect gone meanwhile: done')
const stopUpdate = Hooks.on('preUpdateActiveEffect', effect => ((effect.id === 'bless') ? false : undefined))
it = await made(effecting('disable', 'bless'))
Hooks.off('preUpdateActiveEffect', stopUpdate)
assert.deepEqual([refusal(it), fx.bless.disabled, markOf(fx.bless), sheetsIn(it)], [['failed', 'cancelled', null], false, false, []], "an update a module's hook stops: cancelled, nothing changed, no sheet")
const stopDelete = Hooks.on('preDeleteActiveEffect', effect => ((effect.id === 'bless') ? false : undefined))
it = await made(effecting('delete', 'bless'))
Hooks.off('preDeleteActiveEffect', stopDelete)
assert.deepEqual([refusal(it), thorin.effects.includes(fx.bless), sheetsIn(it)], [['failed', 'cancelled', null], true, []], "a delete a module's hook stops: cancelled")
faults.cancel.add('bless')
it = await made(effecting('disable', 'bless'))
faults.cancel.delete('bless')
assert.deepEqual(refusal(it), ['failed', 'cancelled', null], 'stopped as by a hook of its own')
ok("an update or a delete that throws, the effect still there: \"error\" with Foundry's message; a delete that throws once the effect is gone meanwhile: done; a write a preUpdateActiveEffect or preDeleteActiveEffect hook stops: \"cancelled\", read again, nothing changed and no sheet sent")

/* -------------------------------------------- */
/*  9. Queue                                    */
/* -------------------------------------------- */

await campaignAs({ rolls: true })
thorin.hang = true
const held = { id: 'roll-held', actorId: 'thorin', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }] }
const behind = effecting('disable', 'bless')
const [first, second] = await fetched(held, behind)
thorin.hang = false
assert.equal(first.result.reason, 'timeout', "the held roll's watchdog")
assert.ok(resultIndex(held.id) < resultIndex(behind.id), "the effect waits behind Thorin's held roll")
assert.deepEqual(second.result.effect, { id: 'bless', disabled: true, deleted: false })
// The next roll waits for it.
let release
const gate = new Promise(resolve => { release = resolve })
const update = fx.bless.update
fx.bless.update = async function (...args) { await gate; return update.apply(this, args) }
const turnOn = effecting('enable', 'bless')
const next = { ...held, id: 'roll-next' }
app.waiting.set('camp-a', [turnOn, next])
app.wake?.()
await settle(120)
assert.deepEqual([resultIndex(turnOn.id), resultIndex(next.id)], [-1, -1], 'the next roll waits while the effect is written')
release()
await until(() => resultIndex(next.id) >= 0, 'the next roll')
delete fx.bless.update
assert.ok(resultIndex(turnOn.id) < resultIndex(next.id), 'after it')
assert.deepEqual([resultsOf(turnOn.id)[0].effect, resultsOf(next.id)[0].status], [{ id: 'bless', disabled: false, deleted: false }, 'done'])
await campaignAs({ rolls: false })
ok("an effect command waits behind the same character's held roll, by its actorId, and the next roll waits for it")

/* -------------------------------------------- */
/*  10. Manage Campaigns and the settings row   */
/* -------------------------------------------- */

const label = 'Allow Players to disable & remove their own active effects'
let win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
const fieldset = () => find(win, 'fieldset.sending-stone-effects')
assert.equal(fieldset().querySelector('legend').textContent.trim(), 'Active effects')
assert.equal(fieldset().querySelector('label[for="sending-stone-effects"]').textContent.trim(), label, "the user's words")
assert.equal(fieldset().querySelector('.hint').textContent.trim(), words['SENDINGSTONE.Config.Actions.EffectsHint'])
const order = [...win.element.querySelectorAll('fieldset')].map(each => each.className)
assert.deepEqual(order.slice(order.indexOf('sending-stone-dishes'), order.indexOf('sending-stone-dishes') + 3),
  ['sending-stone-dishes', 'sending-stone-effects', 'sending-stone-companions'], 'between Magical Recipe Book and Companions')
assert.equal(find(win, '[name="campaign.effects"]').checked, true, 'ticked, as saved')
assert.equal(fieldset().querySelectorAll('.sending-stone-warning').length, 0, 'no warning: the app takes effects')
tick(win, 'campaign.effects', false)
await save(win)
assert.equal(settings.get('campaigns')[0].effects, false, 'saved off')
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.equal(find(win, '[name="campaign.effects"]').checked, false)
tick(win, 'campaign.effects')
await save(win)
assert.equal(settings.get('campaigns')[0].effects, true, 'saved on')
await until(() => helloOf().features.effects.enabled, 'the hello after the save')
// An app with commands that doesn't take effects: Manage Campaigns says so; then one that does.
app.features.set('camp-a', { commands: true })
await hello()
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.deepEqual([...fieldset().querySelectorAll('.sending-stone-warning')].map(each => each.textContent.trim()), [words['SENDINGSTONE.Config.Actions.EffectsApp']])
await win.close()
app.features.delete('camp-a')
await hello()
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.equal(fieldset().querySelectorAll('.sending-stone-warning').length, 0, 'none once it says effects: 1')
await win.close()
game.system.id = 'pf2e'
win = await openSettings()
await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
assert.ok([...fieldset().querySelectorAll('.sending-stone-warning')].some(each => each.textContent.trim() === 'Not available in this game: it needs the D&D Fifth Edition system.'), 'under another system')
await win.close()
game.system.id = 'dnd5e'
// The campaign's rows in the hello's settings: after dishes, its note under another system where it's on.
const rowsOf = () => helloOf().settings.sections.find(section => section.id === 'campaign').rows
await hello()
assert.deepEqual(rowsOf().map(each => each.id), ['rolls', 'attacks', 'prompts', 'manualDice', 'transfers', 'dishes', 'effects', 'companionInitiative', 'groups'])
assert.deepEqual(rowsOf().find(each => each.id === 'effects'), { id: 'effects', label, value: true, text: 'On' })
game.system.id = 'pf2e'
await hello()
assert.deepEqual(rowsOf().find(each => each.id === 'effects'), { id: 'effects', label, value: true, text: 'On', note: 'it needs the D&D Fifth Edition system.' })
game.system.id = 'dnd5e'
await campaignAs({ effects: false })
assert.deepEqual(rowsOf().find(each => each.id === 'effects'), { id: 'effects', label, value: false, text: 'Off' })
await campaignAs({ effects: true })
ok("Manage Campaigns: the Active effects fieldset, the user's words, between Magical Recipe Book and Companions, ticked and saved either way; EffectsApp with an app that has commands but no effects, none once it says effects: 1; Not available under another system; the settings row after dishes, On or Off, with its note under another system")

/* -------------------------------------------- */
/*  12. The mark                                */
/* -------------------------------------------- */

it = await made(effecting('disable', 'bless'))
assert.deepEqual([fx.bless.disabled, markOf(fx.bless)], [true, true], 'turned off from the app, marked')
await fx.bless.update({ disabled: false })
assert.deepEqual([fx.bless.disabled, markOf(fx.bless)], [false, false], 'turned on by the Gamemaster: the mark cleared in the same write')
await fx.bless.update({ disabled: true })
assert.deepEqual([fx.bless.disabled, markOf(fx.bless), opsOf(fx.bless, thorin)], [true, false, ['delete']], 'turned off again by the Gamemaster: Delete… alone')
mark = writes.length
assert.deepEqual(refusal(await made(effecting('enable', 'bless'))), ['failed', 'effect', null], 'Turn on refused')
assert.deepEqual([writesSince(mark), fx.bless.disabled], [[], true])
// A change to anything else leaves the mark.
await fx.heroism.update({ disabled: false })
it = await made(effecting('disable', 'heroism'))
await fx.heroism.update({ name: 'Heroism (renamed)' })
assert.deepEqual([markOf(fx.heroism), opsOf(fx.heroism, thorin)], [true, ['enable', 'delete']], 'a rename keeps the mark')
ok('the mark: Bless turned off from the app, then on by the Gamemaster, clears it in the same write; off again by the Gamemaster, Delete… alone, and Turn on refused "effect"; a change to anything but whether it\'s on keeps it')

process.exit(0)
