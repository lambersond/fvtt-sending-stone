// The dice the game rolls later, asked of a player typing in theirs (module 0.45.0, PROTOCOL.md's
// "Dice the game rolls later"): the real module; dnd5e 5.3.3's real dice classes, or 6.0.5's with
// DND5E6=1; dnd5e's items, activities and consumption ported (activity5e.mjs), its consumption
// targets handed to the module as dnd5e's ConsumptionTargetData, whose resolveCost it wraps; with MIDI=1,
// midi-fake.mjs's workflow, its attack paired with its item's other activity as Midi pairs dnd5e's own
// Ice Knife (its spells24 pack, 1st-level/ice-knife.yml, identical at release-5.3.3 and 6.0.5: an
// attack of 1d10 piercing and a save, Shard Explosion, of 2d6 cold, 1d6 more a level above 1st), an
// other activity that spends something deferred until saves are checked, healing and an ammunition's
// own activity rolled with the damage, a utility's formula, and bonus damage macros rolled through
// callMacros and rollBonusDamage, one after another, and a homebrew macro rolling more as Midi
// finishes the roll (midi.postActiveEffects); a companion of Thorin's and a Wild Shape form of his;
// Mira, another player's character, whose use spends what Thorin's charm does, and whose dagger
// rolls Midi's bonus damage beside his; a stand-in
// app that answers asks, says which characters are open, and whether it reads asks (OLD_APP=1: an
// app before them), and may be slow to answer fetches of commands; a DialogV2 for the Gamemaster's window, who rolls their own dice with Manual
// Dice; and a clock run a hundred times as fast, timers and Date.now alike, so that a minute's wait
// takes 0.6 seconds. BREAK_ASK=1: a core whose die doesn't wait for a value its
// fulfillment promises (dice-core.mjs's unawaitedRoll), which fails the self-test. LIBWRAPPER=1:
// the module wraps through libWrapper. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { combat, combatant, settings, user, actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
const DND5E6 = Boolean(process.env.DND5E6)
const OLD_APP = Boolean(process.env.OLD_APP)
const BREAK_ASK = Boolean(process.env.BREAK_ASK)
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'
const DND5E = DND5E6 ? `${DND5E6_ROOT}/module/dice` : `${DND5E5}/module/dice`
const ok = message => console.log('ok -', message)

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

// A clock a hundred times as fast: every timer a hundredth as long, and Date.now as far on, so that
// what the module measures by the clock agrees with what it waits by timers.
const SCALE = 100
const realSetTimeout = globalThis.setTimeout
const realSetInterval = globalThis.setInterval
const realNow = Date.now
const start = realNow()
// While `throttled`, as a browser throttles a tab in the background, a timer of a second or more
// fires two minutes on at the soonest; fetches go on as they come.
let throttled = false
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ((throttled && (ms >= 1000)) ? Math.max(ms, 120_000) : ms) / SCALE, ...args)
globalThis.setInterval = (fn, ms = 0, ...args) => realSetInterval(fn, Math.max(ms / SCALE, 1), ...args)
Date.now = () => start + ((realNow() - start) * SCALE)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
/** Wait this long on the module's clock. */
const pass = ms => wait(ms / SCALE)
globalThis.document = { hidden: false }

const { core, messages, prompts } = await import('./dice-core.mjs')
if (BREAK_ASK) core.unawaitedRoll = true
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
const TYPES = ['slashing', 'piercing', 'cold', 'fire', 'lightning', 'force']
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(TYPES.map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' } },
}
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')
if (DND5E6) game.system.version = '6.0.5'
// dnd5e 6's dice read their labels through its global _loc.
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))
// Foundry's escapeHTML (common/utils/helpers.mjs), as the Gamemaster's window escapes names.
foundry.utils.escapeHTML ??= value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])

const { Actor5e } = await import('./actor5e.mjs')
const { Activity, AttackActivity, SaveActivity, DamageActivity, HealActivity, ConsumptionTarget, equip } = await import('./activity5e.mjs')
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  dice: { DamageRoll },
  documents: { activity: { AttackActivity, SaveActivity, DamageActivity, HealActivity } },
  // dnd5e's consumption targets, whose resolveCost the module wraps (module 0.45.0).
  dataModels: { activity: { ConsumptionTargetData: ConsumptionTarget } },
  registry: {
    messages: {
      get(id, type) {
        return [...messages.values()].filter(m => (m.flags?.dnd5e?.originatingMessage === id) && (m.flags?.dnd5e?.roll?.type === type))
      },
    },
  },
}
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }

const wrapped = []
if (process.env.LIBWRAPPER) {
  globalThis.libWrapper = {
    register(pkg, target, fn) {
      wrapped.push(target)
      const path = target.split('.')
      const owner = path.slice(0, -1).reduce((o, key) => o[key], globalThis)
      const original = owner[path.at(-1)]
      owner[path.at(-1)] = function (...args) { return fn.call(this, original.bind(this), ...args) }
    },
  }
  game.modules.set('lib-wrapper', { active: true })
}

// Manual Dice, installed, active and on.
const storedGet = game.settings.get
game.settings.get = (module, key) => (module === 'manual-dice') ? true : storedGet(module, key)
game.settings.settings = new Map([['manual-dice.enabled', {}]])
game.modules.set('manual-dice', { id: 'manual-dice', title: 'Manual Dice', active: true, authors: [] })

// The Gamemaster's window: DialogV2, as far as the module draws one [core, unverified]. While
// `takesKeyboard`, drawing it takes the keyboard to its button, as a window may as it opens.
const dialogs = []
let takesKeyboard = false
foundry.applications.api.DialogV2 = class {
  constructor(options) { Object.assign(this, { options, rendered: false, closed: false }); dialogs.push(this) }
  async render() {
    this.rendered = true
    if (takesKeyboard) document.activeElement = { tagName: 'BUTTON', isConnected: true, focus() { document.activeElement = this } }
    return this
  }
  async close() { this.closed = true; return this }
  get element() { return null }
}

// ---- The world ----
const users = game.users
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice', false, 2)
if (MIDI) {
  installMidi()
  midi.settings.defaultOtherActivity = 'auto'
  midi.ammunitionActivities = true
}
const add = actor => { actors.set(actor.id, actor); return actor }

// Thorin, Alice's, a wizard who types in his dice: Intelligence his spellcasting.
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 1, dex: 3, int: 4, wis: 1 }, skills: { prc: { ability: 'wis' } }, hp: { value: 20, max: 30, temp: 0 } }))
thorin.system.attributes.spellcasting = 'int'
alice.character = thorin
equip(thorin, {
  spells: { spell1: { value: 12, max: 12, level: 1 }, spell2: { value: 3, max: 3, level: 2 } },
  items: [
    // dnd5e's own Ice Knife (spells24): its attack, and its save Midi pairs with it, which spends no slot.
    { id: 'ice-knife', name: 'Ice Knife', type: 'spell', system: { level: 1, method: 'spell', properties: [] }, activities: [
      { id: 'ice-attack', name: 'Ice Knife', attack: { ability: 'spellcasting' }, damage: [{ number: 1, denomination: 10, types: ['piercing'] }] },
      { id: 'ice-burst', name: 'Shard Explosion', type: 'save', save: ['dex'], dc: 14, onSave: 'none', spellSlot: false,
        damage: [{ number: 2, denomination: 6, types: ['cold'], scaling: 1 }] },
    ] },
    // A homebrew blade whose other activity is damage of two parts that may be a critical hit's.
    { id: 'flame-knife', name: 'Flame Knife', type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee' }, activities: [
      { id: 'flame-attack', name: 'Stab', attack: { ability: 'dex' }, damage: [{ number: 1, denomination: 10, types: ['piercing'] }] },
      { id: 'flame-burst', name: 'Burst', type: 'damage', criticalAllow: true,
        damage: [{ number: 2, denomination: 6, types: ['fire'] }, { number: 1, denomination: 4, types: ['cold'] }] },
    ] },
    // A homebrew brand whose other activity spends 1d4 of its charges: Midi defers it until saves.
    { id: 'frost-brand', name: 'Frost Brand', type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee', uses: { max: 20, spent: 0 } }, activities: [
      { id: 'frost-attack', name: 'Cut', attack: { ability: 'str' }, damage: [{ number: 1, denomination: 8, types: ['slashing'] }] },
      { id: 'frost-burst', name: 'Rime', type: 'save', save: ['con'], dc: 13, damage: [{ number: 2, denomination: 6, types: ['cold'] }],
        consumption: [{ type: 'itemUses', value: '1d4' }] },
    ] },
    // A charm whose use spends 1d4 of its charges.
    { id: 'charm', name: 'Charm of Sparks', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 200, spent: 0 } }, activities: [
      { id: 'charm-zap', name: 'Zap', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['lightning'] }], consumption: [{ type: 'itemUses', value: '1d4' }] },
    ] },
    // A charm whose use spends 1d4 of its charges, exploding: a die thrown again in a roll asked.
    { id: 'wild-charm', name: 'Wild Charm', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 200, spent: 0 } }, activities: [
      { id: 'wild-zap', name: 'Zap', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['lightning'] }], consumption: [{ type: 'itemUses', value: '1d4x' }] },
    ] },
    // A charm whose use spends 1d4 and 1d6 of its charges, each exploding: a term left out of an answer.
    { id: 'twin-charm', name: 'Twin Charm', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 500, spent: 0 } }, activities: [
      { id: 'twin-zap', name: 'Zap', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['lightning'] }], consumption: [{ type: 'itemUses', value: '1d4x + 1d6x' }] },
    ] },
    // A staff that casts Spark, spending 1d4 of its charges: the spell's own use spends the staff's.
    { id: 'staff', name: 'Staff of Sparks', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 10, spent: 0 } },
      activities: [{ id: 'cast-spark', type: 'cast', spell: { level: 1 }, consumption: [{ type: 'itemUses', value: '1d4' }] }] },
    { id: 'spark', name: 'Spark', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.staff.Activity.cast-spark' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'spark-bolt', attack: { ability: 'spellcasting' }, damage: [{ number: 1, denomination: 6, types: ['lightning'] }] }] },
    // A wand whose roll explodes, for a die thrown again.
    { id: 'wand', name: 'Wand of Luck', type: 'equipment', system: { properties: [], quantity: 1 }, activities: [{ id: 'wand-roll', type: 'utility', formula: '1d6x' }] },
    // Another of his items.
    { id: 'dagger', name: 'Dagger', type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee' }, activities: [
      { id: 'dagger-stab', attack: { ability: 'dex' }, damage: [{ number: 1, denomination: 4, types: ['piercing'] }] },
    ] },
    // A homebrew blade whose other activity heals him: Midi rolls its healing with the cut's damage.
    { id: 'leech', name: 'Leech Blade', type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee' }, activities: [
      { id: 'leech-cut', name: 'Cut', attack: { ability: 'dex' }, damage: [{ number: 1, denomination: 6, types: ['slashing'] }] },
      { id: 'leech-drink', name: 'Drink', type: 'heal', healing: { number: 1, denomination: 4 } },
    ] },
    // A charm whose utility formula Midi rolls itself, in the use's workflow.
    { id: 'luck', name: 'Charm of Luck', type: 'equipment', system: { properties: [], quantity: 1 }, activities: [{ id: 'luck-roll', name: 'Luck', type: 'utility', formula: '1d4' }] },
    // A longbow, and arrows whose own activity Midi rolls with the bow's damage.
    { id: 'bow', name: 'Longbow', type: 'weapon', system: { properties: ['amm'], quantity: 1, attackType: 'ranged' }, activities: [
      { id: 'bow-shot', name: 'Shot', attack: { ability: 'dex' }, damage: [{ number: 1, denomination: 8, types: ['piercing'] }] },
    ] },
    { id: 'arrows', name: 'Arrows of Frost', type: 'consumable', system: { type: { value: 'ammo' }, quantity: 20, properties: [] }, activities: [
      { id: 'arrows-frost', name: 'Frost', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['cold'] }] },
    ] },
  ],
})

// Brakka, Alice's sidekick, linked: a companion of Thorin's, whose charm spends 1d4 of its charges.
const brakka = add(new Actor5e({ id: 'brakka', name: 'Brakka', mods: { str: 2 }, hp: { value: 15, max: 15, temp: 0 } }))
Object.assign(brakka, { type: 'npc', ownership: { default: 0, alice: 3 }, prototypeToken: { actorLink: true } })
brakka.testUserPermission = user => ((brakka.ownership[user.id] ?? brakka.ownership.default) >= 3)
equip(brakka, { items: [
  { id: 'brakka-charm', name: 'Brakka\'s Charm', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 50, spent: 0 } }, activities: [
    { id: 'brakka-zap', name: 'Zap', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['lightning'] }], consumption: [{ type: 'itemUses', value: '1d4' }] },
  ] },
] })

// Mira, Bob's, who types in her dice too: her charm spends 1d4 of its charges, as Thorin's does.
const bob = user('bob', 'Bob', false, 2)
const mira = add(new Actor5e({ id: 'mira', name: 'Mira', owners: ['bob'], mods: { dex: 2 }, hp: { value: 18, max: 18, temp: 0 } }))
bob.character = mira
equip(mira, { items: [
  { id: 'mira-charm', name: 'Mira\'s Charm', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 50, spent: 0 } }, activities: [
    { id: 'mira-zap', name: 'Zap', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['lightning'] }], consumption: [{ type: 'itemUses', value: '1d4' }] },
  ] },
  { id: 'mira-dagger', name: 'Mira\'s Dagger', type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee' }, activities: [
    { id: 'mira-stab', attack: { ability: 'dex' }, damage: [{ number: 1, denomination: 4, types: ['piercing'] }] },
  ] },
] })

const place = actor => {
  const token = { id: `tok-${actor.id}`, name: actor.name, uuid: `Scene.scene.Token.tok-${actor.id}`, actor, hidden: false }
  const placeable = { id: token.id, name: actor.name, document: token, actor }
  token.object = placeable
  placeables.set(token.id, placeable)
  return token
}
const goblin = add(new Actor5e({ id: 'goblin', name: 'Goblin', mods: {}, hp: { value: 40, max: 40, temp: 0 } }))
goblin.type = 'npc'
equip(goblin, { ac: 12, items: [{ id: 'club', name: 'Club', type: 'weapon', system: { properties: [], quantity: 1 }, activities: [{ id: 'club-hit', damage: [{ number: 1, denomination: 4, types: ['slashing'] }] }] }] })
const tokens = { thorin: place(thorin), goblin: place(goblin) }
if (MIDI) canvas.scene.tokens.size = placeables.size
const fight = combat('fight')
combatant(fight, 'cb-thorin', thorin, { token: tokens.thorin })
combatant(fight, 'cb-gob', goblin, { token: tokens.goblin })
fight.getCombatantsByActor = actor => fight.combatants.filter(cb => cb.actor?.id === actor.id)
game.combat = fight

// ---- The app ----
// `holding`, while set, as a listener slow to answer: each fetch of commands hangs until let go, or
// given up on (its abort).
const app = { events: [], waiting: new Map(), wake: null, open: new Set(['thorin']), polls: 0, features: {}, holding: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    // When it came, by the module's clock (the envelope's own time is Foundry's real clock).
    body.at = Date.now()
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    return announcing
      ? json({ features: { commands: true, ...(!OLD_APP && { diceAsks: 1 }), ...app.features } })
      : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.polls++
    const id = body.campaign.id
    if (app.holding) {
      await new Promise((resolve, reject) => {
        app.holding.push(resolve)
        init.signal?.addEventListener('abort', () => reject(new DOMException('The fetch was given up on.', 'AbortError')), { once: true })
      })
    }
    if (!app.waiting.get(id)?.length) {
      await new Promise(resolve => {
        const timer = realSetTimeout(resolve, 20)
        app.wake = () => { clearTimeout(timer); resolve() }
        init.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    const commands = app.waiting.get(id) ?? []
    app.waiting.set(id, [])
    return json({ commands, open: [...app.open] })
  }
  throw new TypeError(`Unexpected fetch of ${url}`)
}
/** Hold the fetches of commands from now on, as a listener slow to answer, until let go. */
const holdFetches = () => { app.holding = [] }
const letGoFetches = () => {
  const holding = app.holding ?? []
  app.holding = null
  for (const resolve of holding) resolve()
}
async function until(test, what, ms = 6000) {
  const end = realNow() + ms
  while (!test()) {
    if (realNow() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(2)
  }
}
let ids = 0
const queue = (campaignId, ...commands) => {
  app.waiting.set(campaignId, [...(app.waiting.get(campaignId) ?? []), ...commands])
  app.wake?.()
}
const resultsOf = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
/** Hand a command over, and its result once it comes. */
const make = (command, campaignId = 'camp-a') => {
  queue(campaignId, command)
  return until(() => resultsOf(command.id).length, `the result of ${command.id}`, 12000).then(() => resultsOf(command.id)[0])
}
const typed = fields => ({ actorId: 'thorin', mode: 0, explicit: false, extras: [], typed: true, ...fields })
const attack = (item, activity, d20, fields = {}) => make(typed({
  id: `atk-${++ids}`, kind: 'attack', item, activity, target: { combatId: 'fight', combatantId: 'cb-gob' }, dice: [{ faces: 20, results: [d20] }], ...fields,
}))
const damage = (use, dice, fields = {}) => make(typed({ id: `dmg-${++ids}`, kind: 'damage', use, dice, ...fields }))
const asked = () => app.events.filter(e => e.type === 'roll.dice.asked').map(e => ({ ...e.data.ask, campaign: e.campaign.id }))
const closed = () => app.events.filter(e => e.type === 'roll.dice.closed').map(e => e.data)
const closeOf = id => closed().find(entry => entry.id === id)
/** When an ask's close came, by the module's clock. */
const closedAt = id => app.events.find(e => (e.type === 'roll.dice.closed') && (e.data.id === id))?.at
/** Did it close well before its own minute was out, half a minute at least: not by its wait? */
const early = (ask, at) => (typeof at === 'number') && (at <= Date.parse(ask.expiresAt) - 30_000)
/** The next ask after `count` were made. */
async function nextAsk(count) {
  await until(() => asked().length > count, 'an ask')
  return asked()[count]
}
/** The app's answer to an ask. */
const answerOf = (ask, dice, fields = {}) => ({
  id: `ans-${++ids}`, actorId: ask.actorId, kind: 'dice', diceAsk: ask.id, dice, mode: 0, explicit: false, extras: [], typed: true, ...fields,
})
const refusal = result => [result.status, result.reason, result.error]
const faces = roll => roll.dice.map(die => die.results.map(r => r.result))
const workflowOf = id => midi.made.find(w => w.workflowOptions?.sendingStone === id)
/** Are these rolls thrown at once, rather than held on an ask? */
const atOnce = rolls => Promise.race([Promise.all(rolls).then(() => 'thrown'), wait(100).then(() => 'held')])
const usesOf = id => thorin.items.get(id).system.uses.spent

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'a', 'camp-b': 'b' })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'mira'], rolls: true, attacks: true, manualDice: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'], rolls: true, attacks: true, manualDice: true },
])
// The Gamemaster rolls their own dice with Manual Dice from the start: the self-tests ask them nothing.
core.interactive = true
await Hooks.callAll('ready')
const { diceStatus, withPlan } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const later = await import(`${MODULE}/scripts/later-dice.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
await until(() => app.polls > 2, 'the fetches')
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.equal(diceStatus.attacks, true, `attack self-test: ${diceStatus.attacksError}`)
const helloOf = id => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === id)).at(-1)
const rollsOf = id => helloOf(id).data.features.rolls
// Neither self-test asks the Gamemaster's manual dice at start-up: since module 0.45.0 not even
// dice-plan.mjs's roll made earlier, which it throws away (bugs-found.md, 049-typed-mod fix 3).
assert.deepEqual(prompts.splice(0), [], "the self-tests never ask the Gamemaster's manual dice")

/* -------------------------------------------- */
/*  The hello, and where nothing is asked       */
/* -------------------------------------------- */

if (DND5E6) {
  // dnd5e 6: off, said so, and nothing asked or opened; Ice Knife's later dice are Foundry's as before.
  assert.deepEqual([rollsOf('camp-a').diceAsks, rollsOf('camp-a').diceAsksReason, rollsOf('camp-a').kinds.includes('dice')], [false, 'system', false])
  assert.deepEqual(later.laterDiceStatus.reason, 'system')
  assert.deepEqual(helloOf('camp-a').data.diceAsks, [])
  const knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
  assert.equal(knife.status, 'done', JSON.stringify(knife))
  const dealt = await damage(knife.id, [{ faces: 10, results: [7] }])
  assert.equal(dealt.status, 'done', JSON.stringify(dealt))
  await wait(30)
  if (MIDI) {
    const workflow = workflowOf(knife.id)
    assert.deepEqual(faces(workflow.damageRolls[0]), [[7]], 'the 1d10 typed')
    assert.equal(workflow.otherDamageRolls?.length, 1, 'the 2d6 rolled with it')
    assert.equal(workflow.otherDamageRolls[0].dice[0].number, 2)
  }
  // The Gamemaster configured manual dice for their own rolls: the cost is theirs, as before 0.45.0,
  // but the module's own check of it beforehand, thrown away, is Foundry's computer dice.
  core.interactive = true
  prompts.splice(0)
  const charm = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
  assert.equal(charm.status, 'done', JSON.stringify(charm))
  assert.ok(usesOf('charm') >= 1 && usesOf('charm') <= 4, `the charm's 1d4 spent: ${usesOf('charm')}`)
  assert.deepEqual([asked(), dialogs.length, prompts.splice(0), MIDI && (midi.consumeChecks.at(-1) === 'charm-zap')], [[], 0, ['0 + 1d4'], MIDI],
    "nothing asked, no window; the Gamemaster's manual dice for the cost alone, never its checks")
  ok(`under dnd5e 6${MIDI ? ' with Midi-QOL' : ''}: features.rolls.diceAsks false, diceAsksReason "system", no "dice" kind and the hello's diceAsks []; a typed Ice Knife${MIDI ? "'s 1d10 typed and its 2d6 rolled by Foundry with it" : ' and its damage made as before'}, the charm's 1d4 cost the Gamemaster's manual dice as before, the module's own check of it${MIDI ? ", and Midi-QOL's own as its use began," : ''} Foundry's computer dice; nothing asked, no window`)
  process.exit(0)
}

if (BREAK_ASK) {
  assert.deepEqual([later.laterDiceStatus.ready, later.laterDiceStatus.reason], [false, 'self-test'])
  assert.match(later.laterDiceStatus.error, /1d6x, its dice given, threw/)
  assert.deepEqual([rollsOf('camp-a').diceAsks, rollsOf('camp-a').diceAsksReason, rollsOf('camp-a').kinds.includes('dice')], [false, 'self-test', false])
  // The Gamemaster configured manual dice for their own rolls: the cost is rolled as before 0.45.0,
  // with their dice; the module's own check of it beforehand, thrown away, Foundry's computer dice.
  core.interactive = true
  prompts.splice(0)
  const charm = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
  assert.equal(charm.status, 'done', JSON.stringify(charm))
  assert.deepEqual([asked(), prompts.splice(0), dialogs.length, MIDI && (midi.consumeChecks.at(-1) === 'charm-zap')], [[], ['0 + 1d4'], 0, MIDI],
    "nothing asked; the cost the Gamemaster's manual dice, as before 0.45.0, never its checks")
  ok(`a core whose die doesn't wait for its fulfillment${MIDI ? ', with Midi-QOL' : ''}: the self-test fails (${later.laterDiceStatus.error}), features.rolls.diceAsks false, diceAsksReason "self-test", no "dice" kind; a typed use's dice cost rolled as before 0.45.0, with the Gamemaster's own manual dice, its check beforehand${MIDI ? ", and Midi-QOL's own as its use began," : ''} Foundry's computer dice, nothing asked, no window`)
  process.exit(0)
}

assert.deepEqual([later.laterDiceStatus.ready, later.laterDiceStatus.error], [true, null], 'the self-test passed')
const keys = Object.keys(rollsOf('camp-a'))
assert.deepEqual(keys.slice(keys.indexOf('keptRerolls')), ['keptRerolls', 'diceAsks', 'diceAsksReason'])
assert.deepEqual([rollsOf('camp-a').diceAsks, rollsOf('camp-a').diceAsksReason, rollsOf('camp-a').kinds.at(-1)], [true, null, 'dice'])
assert.equal(helloOf('camp-a').data.features.companions.kinds.at(-1), 'dice', "among companions' kinds")
assert.deepEqual(helloOf('camp-a').data.diceAsks, [], 'none open')
ok(`the hello: features.rolls.diceAsks true and diceAsksReason null, last after keptRerolls; "dice" last among the rolls' and companions' kinds; diceAsks [] while none is open; the self-test passed${process.env.LIBWRAPPER ? ', wrapping through libWrapper' : ''}; neither self-test asked the Gamemaster's manual dice at start-up`)

// The Gamemaster configured manual dice for their own rolls: none of the player's is ever asked of them,
// nor, since module 0.45.0, the module's own check of what a use spends, beforehand, which it throws
// away (ROADMAP item 22): Foundry's computer dice.
core.interactive = true
/** The Gamemaster's manual dice asked since last looked at: none of a typed use's. */
const checks = () => prompts.splice(0)

if (OLD_APP) {
  // An app that doesn't read asks: nothing asked, the later dice Foundry's computer dice in the run.
  const charm = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
  assert.equal(charm.status, 'done', JSON.stringify(charm))
  assert.ok(usesOf('charm') >= 1 && usesOf('charm') <= 4, `the charm's 1d4 spent: ${usesOf('charm')}`)
  const formula = await make(typed({ id: `fml-${++ids}`, kind: 'formula', item: 'wand', activity: 'wand-roll', dice: [{ faces: 6, results: [6] }] }))
  assert.equal(formula.status, 'done', JSON.stringify(formula))
  assert.deepEqual([asked(), checks(), helloOf('camp-a').data.diceAsks], [[], [], []], "nothing asked, never the Gamemaster's manual dice, the module's own check of the cost among them, the hello's list empty")
  ok("an app that doesn't answer diceAsks 1: nothing asked; a typed use's 1d4 cost, the module's own check of it and a typed 1d6x's explosion thrown by Foundry's computer dice, never the Gamemaster's manual dice; the hello lists no asks")
  process.exit(0)
}

/* -------------------------------------------- */
/*  Dice a use spends                           */
/* -------------------------------------------- */

// A typed use of the charm: its 1d4 cost asked once, typed 3, spent so. The Gamemaster is typing in
// the chat as it's asked.
const chat = { tagName: 'TEXTAREA', isConnected: true, focus() { document.activeElement = this } }
document.activeElement = chat
takesKeyboard = true
let count = asked().length
let using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
let ask = await nextAsk(count)
assert.deepEqual(
  [ask.campaign, ask.actorId, 'of' in ask, ask.purpose, ask.label, ask.critical, ask.rolls, 'again' in ask],
  ['camp-a', 'thorin', false, 'cost', 'Charm of Sparks: Zap', false, [{ formula: '0 + 1d4', terms: [{ faces: 4, number: 1 }] }], false])
assert.match(ask.command, /^use-/)
assert.ok(Date.parse(ask.expiresAt) - Date.parse(ask.askedAt) === 60_000, 'a minute')
// Shown to the Gamemaster, with Roll it now.
const window = dialogs.at(-1)
assert.equal(window.rendered, true)
assert.equal(window.options.modal, false, 'not in their way')
assert.equal(window.options.buttons[0].label, 'SENDINGSTONE.DiceAsk.RollNow')
assert.match(window.options.content, /SENDINGSTONE\.DiceAsk\.Waiting \{"name":"Thorin","label":"Charm of Sparks: Zap","dice":"1d4"\}/)
// Never in the way of their typing: Roll it now isn't the default button, and the keyboard the
// window took as it was drawn goes back to the chat, so Enter never chooses Roll it now.
await until(() => document.activeElement === chat, 'the keyboard back in the chat')
assert.deepEqual([window.options.buttons.length, window.options.buttons[0].default ?? false], [1, false], 'Roll it now not the default button')
takesKeyboard = false
delete document.activeElement
// With Midi-QOL, Midi's own use has worked out what it would spend before dnd5e spends it, and thrown
// that away (its checkAutoConsume): Foundry's computer dice, never the Gamemaster's manual dice, not
// even while the player's ask waits (ROADMAP item 22).
assert.deepEqual([MIDI ? midi.consumeChecks.at(-1) : null, checks()], [MIDI ? 'charm-zap' : null, []], "no check of the cost the Gamemaster's manual dice")
// Listed by a hello sent meanwhile, as when the settings change, which closes nothing.
announce({ campaignId: 'camp-a' })
await until(() => helloOf('camp-a').data.diceAsks.length, 'a hello listing it')
assert.deepEqual(helloOf('camp-a').data.diceAsks.map(each => each.id), [ask.id])
assert.deepEqual(helloOf('camp-b').data.diceAsks, [], "another campaign's hello lists none")
let answer = await make(answerOf(ask, [{ roll: 0, term: 0, results: [3] }]))
assert.deepEqual([answer.status, answer.messageId, answer.visible, answer.rolls.map(roll => [roll.formula, roll.total])], ['done', null, true, [['0 + 1d4', 3]]])
let used = await using
assert.equal(used.status, 'done', JSON.stringify(used))
assert.deepEqual([usesOf('charm'), closeOf(ask.id), window.closed, asked().length - count, checks()], [3, { id: ask.id, reason: 'answered' }, true, 1, []])
ok(`a typed use's 1d4 cost: asked once of camp-a alone, purpose cost, label Charm of Sparks: Zap, its terms, a minute to wait; the Gamemaster's window, not modal, with Roll it now, not its default button, the keyboard it took given back to the chat they were typing in; a hello sent meanwhile lists it and closes nothing, another campaign's lists none; answered 3: closed answered, the window closed, the result done with the roll as thrown, 3 charges spent; the Gamemaster's manual dice never asked, not even for the module's own check of the cost beforehand${MIDI ? ", nor Midi-QOL's own as its use began, while the ask waited" : ''} (ROADMAP item 22)`)

// A linked activity's: Spark cast from the staff spends the staff's 1d4, asked once.
count = asked().length
using = attack('spark', 'spark-bolt', 14)
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.label, ask.rolls[0].formula], ['cost', 'Spark: Attack', '0 + 1d4'], 'its activity named by dnd5e as it names one with no name of its own')
// A d20 roll is never asked: while the cost waits, the Gamemaster's own code rolls Spark's attack, no
// click, its subject the very activity whose attack is being made: their own manual dice, at once.
const sparkAttack = thorin.items.get('spark').system.activities.get('spark-bolt').rollAttack({}, { configure: false }, { create: false })
assert.equal(await atOnce([sparkAttack]), 'thrown', 'never held')
const [gmD20] = await sparkAttack
assert.deepEqual([gmD20 instanceof D20Roll, asked().length - count, checks()], [true, 1, [gmD20.formula]], "the Gamemaster's d20, their manual dice, never asked")
answer = await make(answerOf(ask, [{ roll: 0, term: 0, results: [2] }]))
used = await using
assert.deepEqual([answer.status, used.status, usesOf('staff'), asked().length - count, checks()], ['done', 'done', 2, 1, []])
ok("a spell cast from an item, its Cast activity's 1d4 cost: asked once, as the spell's use spends it, typed 2, 2 of the staff's charges spent; while it waits, the Gamemaster's code's d20 attack roll of that very activity, no click, never asked, their manual dice at once")

// Damage on its own, spending what its use would: the module works out what it spends twice, before
// and as it's spent, each thrown away, Foundry's computer dice; the cost dnd5e spends asked once.
count = asked().length
const aloneBefore = usesOf('charm')
using = make(typed({ id: `alone-${++ids}`, kind: 'itemDamage', item: 'charm', activity: 'charm-zap', consume: true, dice: [{ faces: 6, results: [4] }] }))
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.label, ask.rolls[0].formula, ask.command], ['cost', 'Charm of Sparks: Zap', '0 + 1d4', `alone-${ids}`])
answer = await make(answerOf(ask, [{ roll: 0, term: 0, results: [3] }]))
used = await using
assert.deepEqual([answer.status, used.status, usesOf('charm') - aloneBefore, asked().length - count, checks()], ['done', 'done', 3, 1, []], JSON.stringify(used))
ok("damage on its own spending what its use would, typed: the module's two checks of what it spends Foundry's computer dice, never the Gamemaster's manual dice; dnd5e's 1d4 cost asked once, typed 3, 3 charges spent")

// Skipped: [] leaves the die to the game; closed skipped.
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
let before = usesOf('charm')
answer = await make(answerOf(ask, []))
used = await using
assert.deepEqual([answer.status, used.status, closeOf(ask.id)], ['done', 'done', { id: ask.id, reason: 'skipped' }])
assert.ok((usesOf('charm') - before >= 1) && (usesOf('charm') - before <= 4), `Foundry's d4 spent: ${usesOf('charm') - before}`)
assert.deepEqual(checks(), [], "never the Gamemaster's manual dice")
ok("skipped, dice []: closed skipped, Foundry's computer d4 spent, never the Gamemaster's manual dice")

// The wait shortened: no answer, closed expired, the computer's die; the command done, not timed out.
settings.set('diceAskWait', 1000)
count = asked().length
before = usesOf('charm')
used = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = asked()[count]
assert.deepEqual([used.status, closeOf(ask.id), Date.parse(ask.expiresAt) - Date.parse(ask.askedAt), checks()], ['done', { id: ask.id, reason: 'expired' }, 1000, []])
// By its own wait, a few seconds at most past it: not by its run's five minutes.
assert.ok(closedAt(ask.id) - Date.parse(ask.expiresAt) <= 5_000, `closed ${closedAt(ask.id) - Date.parse(ask.expiresAt)} ms past its wait`)
assert.ok(usesOf('charm') > before)
// Foundry's tab in the background, its timers throttled to two minutes: left past its wait, it
// still closes at the next fetch's look, a few seconds past it, not when its own timer fires.
throttled = true
count = asked().length
used = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
throttled = false
ask = asked()[count]
assert.deepEqual([used.status, closeOf(ask.id), checks()], ['done', { id: ask.id, reason: 'expired' }, []])
assert.ok(closedAt(ask.id) - Date.parse(ask.expiresAt) <= 5_000, `throttled: closed ${closedAt(ask.id) - Date.parse(ask.expiresAt)} ms past its wait`)
settings.set('diceAskWait', 60_000)
ok("left past its wait (a second, by the hidden setting): closed expired as its wait ends, Foundry's computer die spent, the use done, never the Gamemaster's manual dice; with Foundry's timers throttled, as in a tab in the background, closed at the next fetch's look all the same, a few seconds past its wait")

// Its own minute closes it, with no fetch coming, the listener slow to answer, and the look every 5
// seconds put off for two minutes, Foundry's timers throttled once the ask is open: as its minute
// ends, a few seconds past it at most.
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
holdFetches()
throttled = true
await pass(6000)
await until(() => closeOf(ask.id), 'the ask closing', 12_000)
throttled = false
letGoFetches()
used = await using
assert.deepEqual([used.status, closeOf(ask.id), checks()], ['done', { id: ask.id, reason: 'expired' }, []])
assert.ok(Math.abs(closedAt(ask.id) - Date.parse(ask.expiresAt)) <= 5_000, `closed ${closedAt(ask.id) - Date.parse(ask.expiresAt)} ms past its minute`)
ok("left a minute, with no fetch coming and the look every 5 seconds put off for two minutes: closed expired by its own minute, as it ends, Foundry's computer die spent, the use done")

// Roll it now: closed rolled, Foundry's die.
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
dialogs.at(-1).options.buttons[0].callback()
used = await using
assert.deepEqual([used.status, closeOf(ask.id), checks()], ['done', { id: ask.id, reason: 'rolled' }, []])
const late = await make(answerOf(ask, [{ roll: 0, term: 0, results: [1] }]))
assert.deepEqual(refusal(late), ['failed', 'diceAsk', 'answered'], 'answered after it was rolled')
ok("the Gamemaster's Roll it now: closed rolled, Foundry's die, an answer after refused diceAsk answered")

// What waits: a roll whose run waits on an ask isn't timed out meanwhile. The module's own check of
// the use's cost held 5 seconds, as a slow Foundry's might be, so that its one ask opens 5 seconds
// in: still open at the use's minute, none closed before it, answered 58 seconds after it was asked,
// 63 into the use: the use done, its one result, never a timeout first.
/** When a command's first result came, by the module's clock. */
const resultAt = id => app.events.find(e => (e.type === 'command.result') && (e.data.id === id))?.at
const prepareUpdates = Activity.prototype._prepareUsageUpdates
Activity.prototype._prepareUsageUpdates = async function (config, options, ...rest) {
  if (options?.returnErrors && (this.item?.id === 'charm')) await pass(5000)
  return prepareUpdates.call(this, config, options, ...rest)
}
count = asked().length
const acrossId = `use-${++ids}`
using = make(typed({ id: acrossId, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
const handed = Date.now()
ask = await nextAsk(count)
Activity.prototype._prepareUsageUpdates = prepareUpdates
assert.ok(Date.parse(ask.askedAt) - handed >= 5_000, `asked ${Date.parse(ask.askedAt) - handed} ms into the use`)
await pass(58_000)
await make(answerOf(ask, [{ roll: 0, term: 0, results: [2] }]))
used = await using
await pass(2000)
assert.deepEqual([resultsOf(acrossId).map(result => result.status), closeOf(ask.id), checks()], [['done'], { id: ask.id, reason: 'answered' }, []], 'never a timeout first')
assert.ok(resultAt(acrossId) - handed >= 60_000, `done ${resultAt(acrossId) - handed} ms into the use, past its minute`)
// Its ask answered at 50 seconds, then the use goes on 15 seconds more, its card written slowly: 65
// seconds in all, 50 of them waiting on its ask, which its minute doesn't count: never timed out.
count = asked().length
const slowId = `use-${++ids}`
const slowCard = Hooks.on('createChatMessage', message => {
  if (message.flags?.['sending-stone']?.use !== slowId) return
  const setFlag = message.setFlag
  message.setFlag = async function (scope, key, value) {
    if (key === 'usage') await pass(15_000)
    return setFlag.call(this, scope, key, value)
  }
})
using = make(typed({ id: slowId, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
await pass(50_000)
await make(answerOf(ask, [{ roll: 0, term: 0, results: [2] }]))
used = await using
Hooks.off('createChatMessage', slowCard)
await pass(2000)
assert.deepEqual([resultsOf(slowId).map(result => result.status), checks()], [['done'], []], 'never a timeout first')
assert.ok(resultAt(slowId) - Date.parse(ask.askedAt) >= 65_000, `done ${resultAt(slowId) - Date.parse(ask.askedAt)} ms after its ask, past its minute`)
ok("a roll whose run waits on an ask isn't timed out: its one ask, asked 5 seconds in, open across the use's minute with none closed before it, answered 63 seconds in, the use done, never a timeout first; an ask answered at 50 seconds, the use going on 15 seconds more, done at 65 seconds, its minute not counting the 50 its ask waited")

// The character not open in the app: nothing asked, the computer's die.
app.open = new Set()
await pass(1000)
count = asked().length
used = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
assert.deepEqual([used.status, asked().length - count, checks()], ['done', 0, []])
app.open = new Set(['thorin'])
await pass(1000)
// And closed once he's no longer open: expired, at the next fetch's list, well before its minute is out.
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
app.open = new Set()
used = await using
assert.deepEqual([used.status, closeOf(ask.id), checks(), early(ask, closedAt(ask.id))], ['done', { id: ask.id, reason: 'expired' }, [], true],
  `closed at ${closedAt(ask.id) - Date.parse(ask.askedAt)} ms of its ${Date.parse(ask.expiresAt) - Date.parse(ask.askedAt)}`)
app.open = new Set(['thorin'])
await pass(1000)
ok("the character not open in the app: nothing asked, the computer's die; closed once he's no longer open, expired, well before its minute is out, the computer's die")

// Untyped, and the Gamemaster's own from the app: no run, nothing asked; the cost the Gamemaster's dice, as before.
count = asked().length
for (const fields of [{ typed: false }, { by: 'gm' }]) {
  const consumeChecks = midi.consumeChecks.length
  used = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null, ...fields }))
  assert.equal(used.status, 'done', JSON.stringify(used))
  assert.deepEqual([checks(), midi.consumeChecks.length - consumeChecks], [['0 + 1d4'], MIDI ? 1 : 0],
    `${JSON.stringify(fields)}: the cost the Gamemaster's manual dice, as before; its checks beforehand Foundry's computer dice`)
}
assert.equal(asked().length, count, 'nothing asked')
ok(`an untyped use, and the Gamemaster's own from the app: no run, nothing asked, the cost rolled by the Gamemaster's own manual dice once, as before 0.45.0; the module's own check of it beforehand${MIDI ? ", and Midi-QOL's own as its use began," : ''} Foundry's computer dice`)

// Rolls of the cost's formula made as dnd5e begins spending, which aren't the use's own spending: a
// plain roll, a BasicRoll without its delta, and one built just as dnd5e builds a cost, delta and
// all, are the Gamemaster's at once: a cost is told by the use's spending, never by its formula.
count = asked().length
const strangers = []
const spending = Hooks.on('dnd5e.preActivityConsumption', () => {
  strangers.push(new foundry.dice.Roll('0 + 1d4').evaluate(), new BasicRoll('0 + 1d4', {}, { flavor: 'Mine' }).evaluate(),
    new BasicRoll('0 + 1d4', {}, { delta: { item: 'charm', keyPath: 'system.uses.spent' } }).evaluate())
})
before = usesOf('charm')
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
Hooks.off('dnd5e.preActivityConsumption', spending)
assert.equal(await atOnce(strangers), 'thrown', 'never held')
assert.deepEqual([ask.purpose, ask.rolls, asked().length - count, checks()],
  ['cost', [{ formula: '0 + 1d4', terms: [{ faces: 4, number: 1 }] }], 1, ['0 + 1d4', '0 + 1d4', '0 + 1d4']], "the three others, the Gamemaster's, while the cost waits")
await make(answerOf(ask, [{ roll: 0, term: 0, results: [2] }]))
used = await using
assert.deepEqual([used.status, usesOf('charm') - before, checks()], ['done', 2, []], 'dnd5e\'s cost took the answer')
ok("as dnd5e begins spending, a plain roll, a BasicRoll of the cost's formula without dnd5e's delta, and one built as dnd5e builds a cost, delta and all: never the cost, the Gamemaster's manual dice at once; dnd5e's cost of the use's own spending alone asked")

if (!MIDI) {
  // Two runs spend a cost of one formula at once: Thorin's charm and Mira's, each spending 1d4, made
  // from one fetch. Each is checked first; then Thorin's begins spending, but his cost's roll is built
  // only once Mira's is spent, so that hers is rolled while both are spending. Each cost is told by
  // its own use's spending, never by its formula: each asked of its own player, under its own use,
  // and spent as answered; never the Gamemaster's manual dice. (Without Midi: through it, uses from
  // the app are made one at a time.)
  app.open = new Set(['thorin', 'mira'])
  await pass(1000)
  let miraSpent
  const spent = new Promise(resolve => { miraSpent = resolve })
  const prepare = Activity.prototype._prepareUsageUpdates
  let thorinSpending = false
  Activity.prototype._prepareUsageUpdates = async function (...args) {
    if ((this.item?.id === 'charm') && thorinSpending) {
      thorinSpending = false
      await spent
    }
    return prepare.apply(this, args)
  }
  const watching = [
    Hooks.on('dnd5e.preActivityConsumption', activity => { if (activity.item?.id === 'charm') thorinSpending = true }),
    Hooks.on('dnd5e.activityConsumption', activity => { if (activity.item?.id === 'mira-charm') miraSpent() }),
  ]
  count = asked().length
  before = usesOf('charm')
  const miraBefore = mira.items.get('mira-charm').system.uses.spent
  const both = [
    typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }),
    typed({ id: `use-${++ids}`, actorId: 'mira', kind: 'use', item: 'mira-charm', activity: 'mira-zap', targets: [], slot: null }),
  ]
  queue('camp-a', ...both)
  const miraAsk = await nextAsk(count)
  assert.deepEqual([miraAsk.actorId, miraAsk.command, miraAsk.purpose, miraAsk.label], ['mira', both[1].id, 'cost', "Mira's Charm: Zap"])
  await make(answerOf(miraAsk, [{ roll: 0, term: 0, results: [2] }]))
  const thorinAsk = await nextAsk(count + 1)
  assert.deepEqual([thorinAsk.actorId, thorinAsk.command, thorinAsk.purpose, thorinAsk.label], ['thorin', both[0].id, 'cost', 'Charm of Sparks: Zap'])
  await make(answerOf(thorinAsk, [{ roll: 0, term: 0, results: [4] }]))
  await until(() => both.every(command => resultsOf(command.id).length), 'both uses', 12000)
  const [thorinUsed, miraUsed] = both.map(command => resultsOf(command.id)[0])
  Activity.prototype._prepareUsageUpdates = prepare
  Hooks.off('dnd5e.preActivityConsumption', watching[0])
  Hooks.off('dnd5e.activityConsumption', watching[1])
  app.open = new Set(['thorin'])
  await pass(1000)
  const spentBy = [usesOf('charm') - before, mira.items.get('mira-charm').system.uses.spent - miraBefore]
  assert.deepEqual([thorinUsed.status, miraUsed.status, asked().length - count, spentBy, checks()], ['done', 'done', 2, [4, 2], []])
  ok("two runs spending a 1d4 cost at once, Thorin's and Mira's from one fetch, hers rolled while his is spending: each told by its own use's spending, never by its formula, asked of its own player under its own use, Mira's 2 and Thorin's 4 spent; never the Gamemaster's manual dice")
}

/* -------------------------------------------- */
/*  What's never asked                          */
/* -------------------------------------------- */

// While a typed use waits on its cost: rolls that aren't its run's, each thrown by Foundry at once.
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
const charmZap = thorin.items.get('charm').system.activities.get('charm-zap')
const quiet = { configure: false }
const unposted = { create: false }
const clicked = await charmZap.rollDamage({ event: { type: 'click', target: { closest: () => null } } }, quiet, unposted)
const dagger = await thorin.items.get('dagger').system.activities.get('dagger-stab').rollDamage({}, quiet, unposted)
const club = await goblin.items.get('club').system.activities.get('club-hit').rollDamage({}, quiet, unposted)
const maxed = Hooks.on('dnd5e.postBuildDamageRollConfig', (process, config) => { config.options.maximize = true })
const maximized = await charmZap.rollDamage({}, quiet, unposted)
Hooks.off('dnd5e.postBuildDamageRollConfig', maxed)
const minned = Hooks.on('dnd5e.postBuildDamageRollConfig', (process, config) => { config.options.minimize = true })
const minimized = await charmZap.rollDamage({}, quiet, unposted)
Hooks.off('dnd5e.postBuildDamageRollConfig', minned)
const fixed = Hooks.on('dnd5e.postBuildDamageRollConfig', (process, config) => { config.parts = ['3'] })
const numbers = await charmZap.rollDamage({}, quiet, unposted)
Hooks.off('dnd5e.postBuildDamageRollConfig', fixed)
const outside = await new DamageRoll('1d6', {}, { type: 'fire' }).evaluate()
// The Gamemaster's own use of the very charm meanwhile, in Foundry: a use of its own, on dnd5e's copy
// of the item, whose spending names no run: its 1d4 cost theirs, never the waiting run's.
const gmUseBefore = usesOf('charm')
await charmZap.use({}, { configure: false }, { create: false })
assert.equal(usesOf('charm') - gmUseBefore, 4, "the Gamemaster's own cost, their manual dice, the highest face")
assert.deepEqual([clicked, dagger, club, maximized, minimized, numbers].map(rolls => rolls?.length), [1, 1, 1, 1, 1, 1])
assert.deepEqual([maximized[0].options.maximize, minimized[0].options.minimize, numbers[0].isDeterministic, numbers[0].total], [true, true, true, 3])
assert.ok(outside.total >= 1)
assert.equal(asked().length - count, 1, 'none of them asked')
// The one way left to ask wrongly: the same item of the same character, no click, while its roll is made.
const residual = charmZap.rollDamage({}, quiet, unposted)
const wrongly = await nextAsk(count + 1)
assert.deepEqual([wrongly.purpose, wrongly.label, wrongly.command], ['damage', 'Charm of Sparks: Zap', ask.command])
await pass(20_000)
await make(answerOf(wrongly, [{ roll: 0, term: 0, results: [4] }]))
assert.deepEqual(faces((await residual)[0]), [[4]])
await make(answerOf(ask, [{ roll: 0, term: 0, results: [1] }]))
used = await using
assert.equal(used.status, 'done')
// Its two asks waited together for 20 seconds: the watchdog counts that time once.
const { held: waitedFor } = later.heldFor(ask.command)
assert.ok((waitedFor >= 20_000) && (waitedFor <= Date.now() - Date.parse(ask.askedAt)), `held ${waitedFor}, the use's asks open ${Date.now() - Date.parse(ask.askedAt)}`)
// The click's, the dagger's, the club's, the roll of no run's: the Gamemaster's dice, as ever; the
// maximized and minimized ones throw none.
assert.deepEqual(checks(), [clicked[0].formula, dagger[0].formula, club[0].formula, outside.formula, '0 + 1d4'])
ok("never asked while a typed use waits on its cost: the same item's damage rolled with a click, another item of his, another actor's, one whose dice are maximized or minimized, one all numbers, a roll of no run, and the Gamemaster's own use of the very item, its cost their manual dice; the one way left to ask wrongly, the same item's damage with no click while the use is made, is asked as the run's; the two asks waiting together counted once by the watchdog")

/* -------------------------------------------- */
/*  A die thrown again                          */
/* -------------------------------------------- */

// A typed 1d6x: its 6 explodes, asked one die at a time, 6 then 2, each at 40 seconds: done, never
// timed out, the watchdog not counting the time they waited.
count = asked().length
const exploding = make(typed({ id: `fml-${++ids}`, kind: 'formula', item: 'wand', activity: 'wand-roll', dice: [{ faces: 6, results: [6] }] }))
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.again, ask.label, ask.rolls.map(roll => roll.terms)], ['again', 'explode', 'Wand of Luck: Use', [[{ faces: 6, number: 1 }]]])
await pass(40_000)
await make(answerOf(ask, [{ roll: 0, term: 0, results: [6] }]))
const second = await nextAsk(count + 1)
await pass(40_000)
await make(answerOf(second, [{ roll: 0, term: 0, results: [2] }]))
const exploded = await exploding
assert.deepEqual([exploded.status, exploded.rolls[0].total, exploded.rolls[0].dice[0].results.map(r => r.result)], ['done', 14, [6, 6, 2]], JSON.stringify(exploded))
assert.equal(resultsOf(exploded.id).length, 1, 'never a timeout first')
// A typed save's Halfling 1, not kept: its reroll asked.
thorin.flags.dnd5e = { ...(thorin.flags.dnd5e ?? {}), halflingLucky: true }
count = asked().length
const lucky = make(typed({ id: `sv-${++ids}`, kind: 'save', key: 'dex', dice: [{ faces: 20, results: [1] }] }))
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.again, ask.rolls[0].terms], ['again', 'reroll', [{ faces: 20, number: 1 }]])
await make(answerOf(ask, [{ roll: 0, term: 0, results: [15] }]))
const saved = await lucky
assert.deepEqual([saved.status, saved.rolls[0].dice[0].results.map(r => [r.result, r.active])], ['done', [[1, false], [15, true]]])
// Kept at the table: no reroll, nothing asked.
count = asked().length
const kept = await make(typed({ id: `sv-${++ids}`, kind: 'save', key: 'dex', rerolls: 'kept', dice: [{ faces: 20, results: [1] }] }))
assert.deepEqual([kept.status, asked().length - count], ['done', 0])
// Thorin not open in the app: the reroll is Foundry's computer die at once, nothing asked.
app.open = new Set()
await pass(1000)
count = asked().length
const unseen = await make(typed({ id: `sv-${++ids}`, kind: 'save', key: 'dex', dice: [{ faces: 20, results: [1] }] }))
const unseenDice = unseen.rolls[0].dice[0].results
assert.deepEqual([unseen.status, asked().length - count, unseenDice.length, unseenDice[0].result, unseenDice[0].active, dialogs.filter(d => !d.closed).length],
  ['done', 0, 2, 1, false, 0], JSON.stringify(unseen))
app.open = new Set(['thorin'])
await pass(1000)
thorin.flags.dnd5e.halflingLucky = false
assert.deepEqual(checks(), [], "never the Gamemaster's manual dice")
ok("a die thrown again: a typed 1d6x's 6 explodes and each die after is asked one at a time, purpose again, label Wand of Luck: Use, 6 then 2, answered at 40 seconds each, the roll 14 and done, never timed out; a typed save's Halfling 1 rerolled is asked, 15 kept; kept at the table, nothing asked; with Thorin not open in the app, the reroll Foundry's computer die at once, nothing asked, never the Gamemaster's manual dice")

// A die thrown again in a roll asked: Wild Charm's 1d4x cost, answered 4, explodes; its next die is
// asked as the cost's, purpose again, under the use's command, answered 2: 6 charges spent. (The
// module's own check of the cost beforehand is Foundry's computer dice, which the Gamemaster's manual
// dice, answering the stand-in's highest face, would have exploded for ever before 0.45.0.)
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'wild-charm', activity: 'wild-zap', targets: [], slot: null }))
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.label, ask.rolls.map(roll => [roll.formula, roll.terms])], ['cost', 'Wild Charm: Zap', [['0 + 1d4x', [{ faces: 4, number: 1 }]]]])
await make(answerOf(ask, [{ roll: 0, term: 0, results: [4] }]))
const boom = await nextAsk(count + 1)
assert.deepEqual([boom.purpose, boom.again, boom.label, boom.command, boom.rolls.map(roll => roll.terms)],
  ['again', 'explode', 'Wild Charm: Zap', ask.command, [[{ faces: 4, number: 1 }]]])
await make(answerOf(boom, [{ roll: 0, term: 0, results: [2] }]))
used = await using
assert.deepEqual([used.status, usesOf('wild-charm'), asked().length - count, closeOf(boom.id), checks()], ['done', 6, 2, { id: boom.id, reason: 'answered' }, []])
ok("a die thrown again in a roll asked: Wild Charm's 1d4x cost answered 4 explodes, the next die asked as the cost's, purpose again, explode, label Wild Charm: Zap, its command the use's; answered 2, 6 charges spent; never the Gamemaster's manual dice")

// A die Foundry's computer threw is never asked again: Wild Charm's 1d4x cost, its ask closed by the
// Gamemaster's Roll it now, skipped, or left past its wait, its computer die a 4, explodes into a 1,
// Foundry's computer dice, never asked; nor the explosion of a die thrown again whose own ask the
// Gamemaster rolled. (Foundry's computer dice are made to give 4 then 1, once the use's own check of
// its cost, Foundry's computer dice too, is done.)
const { DiceTerm } = foundry.dice.terms
const ownFace = DiceTerm.prototype.randomFace
/** Foundry's computer dice give these faces next, in order, then their own again. */
const computerGives = faces => {
  const next = [...faces]
  DiceTerm.prototype.randomFace = function () { return next.length ? next.shift() : ownFace.call(this) }
  return () => { DiceTerm.prototype.randomFace = ownFace; return next.length }
}
const wildUse = () => make(typed({ id: `use-${++ids}`, kind: 'use', item: 'wild-charm', activity: 'wild-zap', targets: [], slot: null }))
settings.set('diceAskWait', 5000)
for (const [how, close] of [
  ['rolled', ask => { dialogs.at(-1).options.buttons[0].callback() }],
  ['skipped', ask => make(answerOf(ask, []))],
  ['expired', () => null],
]) {
  count = asked().length
  before = usesOf('wild-charm')
  using = wildUse()
  ask = await nextAsk(count)
  const restore = computerGives([4, 1])
  await close(ask)
  used = await using
  assert.deepEqual([restore(), used.status, usesOf('wild-charm') - before, asked().slice(count).map(each => each.purpose), closeOf(ask.id)],
    [0, 'done', 5, ['cost'], { id: ask.id, reason: how }], how)
}
settings.set('diceAskWait', 60_000)
// The die thrown again whose own ask the Gamemaster rolled: its computer 4 explodes into a 1, never
// asked. (The cost's answer is done once its roll is thrown, after the die thrown again.)
count = asked().length
before = usesOf('wild-charm')
using = wildUse()
ask = await nextAsk(count)
const answering = make(answerOf(ask, [{ roll: 0, term: 0, results: [4] }]))
const rolledAgain = await nextAsk(count + 1)
assert.deepEqual([rolledAgain.purpose, rolledAgain.again], ['again', 'explode'])
let restore = computerGives([4, 1])
dialogs.at(-1).options.buttons[0].callback()
await answering
used = await using
assert.deepEqual([restore(), used.status, usesOf('wild-charm') - before, asked().length - count, closeOf(rolledAgain.id)],
  [0, 'done', 9, 2, { id: rolledAgain.id, reason: 'rolled' }])
// Twin Charm's 1d4x + 1d6x cost answered for the 1d4 alone, 4: its explosion asked, answered 1; the
// 1d6 left out, Foundry's computer 6, explodes into a 2, never asked.
count = asked().length
before = usesOf('twin-charm')
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'twin-charm', activity: 'twin-zap', targets: [], slot: null }))
ask = await nextAsk(count)
assert.deepEqual(ask.rolls.map(roll => [roll.formula, roll.terms]), [['0 + 1d4x + 1d6x', [{ faces: 4, number: 1 }, { faces: 6, number: 1 }]]])
restore = computerGives([6, 2])
await make(answerOf(ask, [{ roll: 0, term: 0, results: [4] }]))
const twinAgain = await nextAsk(count + 1)
assert.deepEqual([twinAgain.purpose, twinAgain.again, twinAgain.rolls[0].terms], ['again', 'explode', [{ faces: 4, number: 1 }]])
await make(answerOf(twinAgain, [{ roll: 0, term: 0, results: [1] }]))
used = await using
assert.deepEqual([restore(), used.status, usesOf('twin-charm') - before, asked().length - count], [0, 'done', 13, 2])
assert.deepEqual(checks(), [], "never the Gamemaster's manual dice")
ok("a die Foundry's computer threw is never asked again: Wild Charm's 1d4x cost whose ask closed rolled, skipped or expired, its computer 4 exploding into a 1, never asked; the explosion of a die thrown again whose own ask was rolled, never asked; Twin Charm's 1d4x + 1d6x answered for the 1d4 alone, its 4's explosion asked, the 1d6 left out, Foundry's 6, exploding into a 2, never asked")

/* -------------------------------------------- */
/*  Answers refused                             */
/* -------------------------------------------- */

count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
const one = [{ roll: 0, term: 0, results: [2] }]
for (const [why, fields, expected] of [
  ['by', { by: 'gm' }, ['invalid', 'by']],
  ['not an id', { diceAsk: 'not an id!' }, ['invalid', 'diceAsk']],
  ['dice not a list', { dice: { roll: 0 } }, ['invalid', 'diceAsk']],
  ['a roll not listed', { dice: [{ roll: 1, term: 0, results: [2] }] }, ['invalid', 'diceAsk']],
  ['a term not listed', { dice: [{ roll: 0, term: 1, results: [2] }] }, ['invalid', 'diceAsk']],
  ['a term twice', { dice: [...one, ...one] }, ['invalid', 'diceAsk']],
  ['too many values', { dice: [{ roll: 0, term: 0, results: [2, 3] }] }, ['invalid', 'diceAsk']],
  ['a value its die lacks', { dice: [{ roll: 0, term: 0, results: [5] }] }, ['invalid', 'diceAsk']],
  ['not whole', { dice: [{ roll: 0, term: 0, results: [2.5] }] }, ['invalid', 'diceAsk']],
  ['not typed', { typed: false }, ['invalid', 'diceAsk']],
  ['a mode', { mode: 1 }, ['invalid', 'diceAsk']],
  ['extras', { extras: [{ sign: 1, count: 1, sides: 4 }] }, ['invalid', 'diceAsk']],
  ['effect dice', { effectDice: [] }, ['invalid', 'diceAsk']],
  ['rerolls', { rerolls: 'kept' }, ['invalid', 'diceAsk']],
  ['no such ask', { diceAsk: 'nothing' }, ['diceAsk', 'gone']],
  ['another character', { actorId: 'goblin' }, ['diceAsk', 'character']],
  ['a companion of his', { of: 'thorin' }, ['diceAsk', 'character']],
]) {
  const result = await make(answerOf(ask, one, fields))
  assert.deepEqual(refusal(result), ['failed', ...expected], why)
}
const elsewhere = await make(answerOf(ask, one), 'camp-b')
assert.deepEqual(refusal(elsewhere), ['failed', 'diceAsk', 'character'], 'fetched for another campaign')
assert.equal(closeOf(ask.id), undefined, 'still waiting')
// The first answer is taken; another, as from a second device, refused.
const [first, again] = await Promise.all([make(answerOf(ask, one)), make(answerOf(ask, [{ roll: 0, term: 0, results: [4] }]))])
assert.deepEqual([first.status, refusal(again)], ['done', ['failed', 'diceAsk', 'answered']])
used = await using
assert.equal(used.status, 'done')
// Expired, and after a reload, gone.
settings.set('diceAskWait', 1000)
count = asked().length
used = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
settings.set('diceAskWait', 60_000)
const expired = await make(answerOf(asked()[count], one))
assert.deepEqual(refusal(expired), ['failed', 'diceAsk', 'expired'])
ok('answers refused, nothing taken: by (invalid by); not an id, dice not a list, a roll or term not listed, a term twice, too many values, a value its die lacks, not whole, not typed, a mode, extras, effect dice, rerolls (invalid diceAsk); no such ask (diceAsk gone); another character, a companion of his, or fetched for another campaign (diceAsk character); a second answer (answered); one past its wait (expired)')

// An answer while the character's queue is busy: made at once, before the commands queued after his use.
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
ask = await nextAsk(count)
const behind = make(typed({ id: `chk-${++ids}`, kind: 'skill', key: 'prc', dice: [{ faces: 20, results: [11] }] }))
await pass(2000)
assert.equal(resultsOf(`chk-${ids}`).length, 0, 'the check waits behind the use')
answer = await make(answerOf(ask, one))
const [usedNow, checked] = await Promise.all([using, behind])
assert.deepEqual([answer.status, usedNow.status, checked.status], ['done', 'done', 'done'], JSON.stringify(checked))
ok("an answer while the character's queue is busy with the use it answers, a check waiting behind: made at once, the use done, then the check")

/* -------------------------------------------- */
/*  How an ask closes before its minute is out  */
/* -------------------------------------------- */

// Each way an ask closes before its wait is out, closed well before it: so a way taken out would
// leave it to its minute, and fail here. (Answered, skipped, rolled, the wait itself and the
// character no longer open are above; a Midi workflow aborted is below.)
/** Thorin's typed use of his charm, and its cost's ask. */
const charmAsk = async () => {
  const at = asked().length
  const made = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
  return [made, await nextAsk(at)]
}
/** A hello sent to camp-a again, and answered. */
const helloAgain = async () => {
  const before = app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).length
  announce({ campaignId: 'camp-a' })
  await until(() => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).length > before, 'a hello')
  await wait(30)
}
const reopen = async () => {
  await helloAgain()
  await pass(1000)
}
/** Wait, by the module's clock, until a command's asks no longer wait, and say when. */
const unheld = async command => {
  await until(() => !later.heldFor(command).waiting, 'the ask closing')
  return Date.now()
}

// The campaign no longer asks: its players no longer type in their dice (Manual Dice turned off for
// it): closed expired at the next look, told; with the listener slow to answer, no fetch coming,
// at the look every 5 seconds, 5 seconds at most after the change.
const campaignsBefore = game.settings.get('sending-stone', 'campaigns')
let made
;[made, ask] = await charmAsk()
holdFetches()
await pass(3000)
const turnedOff = Date.now()
settings.set('campaigns', campaignsBefore.map(campaign => (campaign.id === 'camp-a') ? { ...campaign, manualDice: false } : campaign))
used = await made
letGoFetches()
assert.deepEqual([used.status, closeOf(ask.id), early(ask, closedAt(ask.id))], ['done', { id: ask.id, reason: 'expired' }, true], 'Manual Dice off')
assert.ok(closedAt(ask.id) - turnedOff <= 6_000, `closed ${closedAt(ask.id) - turnedOff} ms after Manual Dice was turned off, no fetch coming`)
settings.set('campaigns', campaignsBefore)
await reopen()

// The listener's answer no longer says "diceAsks": 1: closed expired at once, untold, as the
// listener no longer reads asks; an answer after refused expired. At once, as the answer comes: the
// listener slow to answer fetches, no fetch coming, and Foundry's timers throttled, as in a tab in
// the background, the look every 5 seconds put off for two minutes.
;[made, ask] = await charmAsk()
holdFetches()
throttled = true
await pass(6000)
app.features = { diceAsks: 0 }
await helloAgain()
const unread = await unheld(ask.command)
throttled = false
letGoFetches()
used = await made
assert.deepEqual([used.status, closeOf(ask.id), early(ask, unread)], ['done', undefined, true], 'no longer read')
app.features = {}
await reopen()
assert.deepEqual(refusal(await make(answerOf(ask, [{ roll: 0, term: 0, results: [1] }]))), ['failed', 'diceAsk', 'expired'])

// The roll whose run it's in is made without waiting for it: the Gamemaster's own code rolls the
// charm's damage, no click, while the use's cost waits, so it's asked as the run's (the one way left
// to ask wrongly); the cost answered, the use is made, and that ask closes gone at once.
// (Under Midi-QOL the use's run goes on with its workflow, waiting for its damage: no such close.)
if (!MIDI) {
  ;[made, ask] = await charmAsk()
  count = asked().length
  const codeRoll = thorin.items.get('charm').system.activities.get('charm-zap').rollDamage({}, { configure: false }, { create: false })
  const stray = await nextAsk(count)
  assert.deepEqual([stray.purpose, stray.command], ['damage', ask.command])
  await make(answerOf(ask, [{ roll: 0, term: 0, results: [2] }]))
  used = await made
  await until(() => closeOf(stray.id), 'the stray ask closing')
  assert.deepEqual([used.status, closeOf(stray.id), early(stray, closedAt(stray.id))], ['done', { id: stray.id, reason: 'gone' }, true], 'its run made')
  assert.ok((await codeRoll)?.[0]?.total >= 1, "the Gamemaster's code's roll thrown by Foundry's computer dice")
}

// Its run is over, five minutes after its roll: Wild Charm's 1d4x cost answered 4, each die thrown
// again answered 4 three-quarters of a minute after it's asked, until five minutes are past: the ask
// then waiting closes expired, well before its own minute is out.
count = asked().length
using = wildUse()
ask = await nextAsk(count)
for (let k = 1; k <= 6; k++) {
  await pass(45_000)
  void make(answerOf(ask, [{ roll: 0, term: 0, results: [4] }]))
  ask = await nextAsk(count + k)
}
assert.deepEqual([ask.purpose, closeOf(ask.id)], ['again', undefined])
await until(() => closeOf(ask.id), 'the last ask closing', 12_000)
used = await using
assert.deepEqual([used.status, closeOf(ask.id), early(ask, closedAt(ask.id)) || (closedAt(ask.id) <= Date.parse(ask.expiresAt) - 20_000)], ['done', { id: ask.id, reason: 'expired' }, true],
  `closed at ${closedAt(ask.id) - Date.parse(ask.askedAt)} ms of its ${Date.parse(ask.expiresAt) - Date.parse(ask.askedAt)}`)

// This Foundry is no longer the bridge, as with no listener set: closed expired at the next look,
// untold, as nothing can be sent.
;[made, ask] = await charmAsk()
// (Its use's result, made meanwhile, may never come: nothing waits on it.)
made.catch(() => null)
settings.set('listenerUrl', '')
const unbridged = await unheld(ask.command)
settings.set('listenerUrl', 'https://stone.example')
assert.equal(early(ask, unbridged), true, `closed at ${unbridged - Date.parse(ask.askedAt)} ms`)
assert.equal(closeOf(ask.id), undefined, 'untold')
await until(() => app.polls > 0, 'the fetches')
await reopen()
assert.deepEqual(checks(), [], "never the Gamemaster's manual dice")
ok(`an ask closed well before its minute is out: expired, told, once its campaign's players no longer type in their dice, by the look every 5 seconds with no fetch coming; expired, untold, once the listener's answer no longer says diceAsks 1, at once, with no fetch coming and Foundry's timers throttled, an answer after refused expired;${MIDI ? '' : " gone once the roll whose run it's in is made without waiting for it, as for the Gamemaster's own code's roll of the same item;"} expired once its run is over, five minutes after its roll; expired, untold, once this Foundry is no longer the bridge`)

/* -------------------------------------------- */
/*  Companions and Wild Shape                   */
/* -------------------------------------------- */

// Brakka's typed use of her charm, of Thorin: its cost asked under her key, of thorin, while Thorin
// is open; an answer without of refused, one with it taken, spent from her charm.
assert.deepEqual(checks(), [], "the charm's three uses above: never the Gamemaster's manual dice")
const brakkaUse = () => typed({ id: `use-${++ids}`, actorId: 'brakka', of: 'thorin', kind: 'use', item: 'brakka-charm', activity: 'brakka-zap', targets: [], slot: null })
count = asked().length
using = make(brakkaUse())
ask = await nextAsk(count)
assert.deepEqual([ask.actorId, ask.of, ask.purpose, ask.label, ask.rolls[0].formula], ['brakka', 'thorin', 'cost', "Brakka's Charm: Zap", '0 + 1d4'])
const unnamed = await make(answerOf(ask, one))
assert.deepEqual(refusal(unnamed), ['failed', 'diceAsk', 'character'], 'without of')
answer = await make(answerOf(ask, [{ roll: 0, term: 0, results: [3] }], { of: 'thorin' }))
used = await using
assert.deepEqual([answer.status, used.status, closeOf(ask.id), brakka.items.get('brakka-charm').system.uses.spent, checks()],
  ['done', 'done', { id: ask.id, reason: 'answered' }, 3, []])
// Open by her character alone: Brakka open and Thorin not, nothing asked, the computer's die.
app.open = new Set(['brakka'])
await pass(1000)
count = asked().length
used = await make(brakkaUse())
assert.deepEqual([used.status, asked().length - count, checks()], ['done', 0, []])
app.open = new Set(['thorin'])
await pass(1000)
ok("a companion's typed use, Brakka's of thorin: its 1d4 cost asked with actorId brakka and of thorin while Thorin is open; an answer without of refused diceAsk character, one with it taken, 3 of her charges spent; Brakka open and Thorin not, nothing asked")

// Thorin shaped into a wolf, for an app that takes Wild Shape: the wolf's own charm's cost asked as
// Thorin's, with no of.
const hellos = () => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).length
const reannounce = async () => {
  const before = hellos()
  announce({ campaignId: 'camp-a' })
  await until(() => hellos() > before, 'a hello')
  await wait(30)
}
const wolf = add(new Actor5e({ id: 'thorinWolf', name: 'Thorin (Wolf)', owners: ['alice'], flags: { isPolymorphed: true, originalActor: 'thorin', previousActorIds: [] } }))
wolf.documentName = 'Actor'
equip(wolf, { items: [
  { id: 'wolf-charm', name: 'Wolf Charm', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 50, spent: 0 } }, activities: [
    { id: 'wolf-zap', name: 'Zap', type: 'damage', damage: [{ number: 1, denomination: 6, types: ['lightning'] }], consumption: [{ type: 'itemUses', value: '1d4' }] },
  ] },
] })
app.features = { wildShape: 1 }
await reannounce()
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'wolf-charm', activity: 'wolf-zap', targets: [], slot: null }))
ask = await nextAsk(count)
assert.deepEqual([ask.actorId, 'of' in ask, ask.purpose, ask.label], ['thorin', false, 'cost', 'Wolf Charm: Zap'])
answer = await make(answerOf(ask, [{ roll: 0, term: 0, results: [4] }]))
used = await using
assert.deepEqual([answer.status, used.status, wolf.items.get('wolf-charm').system.uses.spent, checks()], ['done', 'done', 4, []])
actors.delete(wolf.id)
app.features = {}
await reannounce()
ok("shaped into a wolf, for an app that takes Wild Shape: the form's own charm's 1d4 cost asked as Thorin's, actorId thorin and no of, typed 4, spent from the wolf's charm")

/* -------------------------------------------- */
/*  Midi-QOL                                    */
/* -------------------------------------------- */

if (!MIDI) {
  // Under dnd5e alone, Ice Knife's save is a use of its own, typed: its damage is the roll's own.
  count = asked().length
  const knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
  const dealt = await damage(knife.id, [{ faces: 10, results: [7] }])
  assert.deepEqual([knife.status, dealt.status, asked().length - count], ['done', 'done', 0])
  ok("under dnd5e alone, a typed Ice Knife's attack and damage ask nothing more: its save is a use of its own")
  process.exit(0)
}

// Ice Knife: the d20 and the 1d10 typed; the 2d6 cold of Shard Explosion asked within the damage.
count = asked().length
let knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
assert.equal(knife.status, 'done', JSON.stringify(knife))
assert.deepEqual(knife.damage.rolls.map(roll => roll.dice), [[{ faces: 10, number: 1 }]], 'its preview: the 1d10 alone')
let dealing = damage(knife.id, [{ faces: 10, results: [7] }])
ask = await nextAsk(count)
assert.deepEqual(
  [ask.purpose, ask.label, ask.critical, ask.rolls],
  ['damage', 'Ice Knife: Shard Explosion', false, [{ formula: ask.rolls[0].formula, type: 'cold', terms: [{ faces: 6, number: 2 }] }]])
assert.match(ask.command, /^dmg-/)
assert.match(dialogs.at(-1).options.content, /"dice":"2d6 Cold"/)
// A d20 roll is never asked: while the 2d6 waits, Thorin's own Dexterity save is rolled in his run's
// very workflow, no click, as Midi may roll a save of the caster caught in his own area: the
// Gamemaster's manual dice at once.
const caught = thorin.rollSavingThrow({ ability: 'dex', workflow: workflowOf(knife.id) }, { configure: false }, { create: false })
assert.equal(await atOnce([caught]), 'thrown', 'never held')
const [caughtSave] = await caught
assert.deepEqual([caughtSave instanceof D20Roll, asked().length - count, checks()], [true, 1, [caughtSave.formula]], "his save in his run's workflow")
answer = await make(answerOf(ask, [{ roll: 0, term: 0, results: [3, 5] }]))
let dealt = await dealing
let workflow = workflowOf(knife.id)
assert.deepEqual([dealt.status, faces(workflow.damageRolls[0]), faces(workflow.otherDamageRolls[0]), workflow.otherDamageRolls[0].total], ['done', [[7]], [[3, 5]], 8])
assert.deepEqual(answer.rolls.map(roll => roll.total), [8])
assert.deepEqual(checks(), [])
ok("Midi-QOL's Ice Knife: the d20 and the 1d10 typed; Shard Explosion's 2d6 cold asked within the damage, purpose damage, label Ice Knife: Shard Explosion, type cold, 2d6, the Gamemaster's window saying 2d6 Cold; typed 3 and 5, the workflow's other damage 8; meanwhile his own Dexterity save rolled in his run's workflow, a d20, never asked, the Gamemaster's manual dice at once")

// At 2nd level: 3d6, as dnd5e scales it.
count = asked().length
knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell2' })
dealing = damage(knife.id, [{ faces: 10, results: [2] }])
ask = await nextAsk(count)
assert.deepEqual(ask.rolls[0].terms, [{ faces: 6, number: 3 }], '3d6 at 2nd level')
// Two terms' answer, per term: a term left out is Foundry's.
await make(answerOf(ask, [{ roll: 0, term: 0, results: [1, 1, 1] }]))
dealt = await dealing
assert.deepEqual(faces(workflowOf(knife.id).otherDamageRolls[0]), [[1, 1, 1]])
ok('at 2nd level, Shard Explosion asked as 3d6, typed 1, 1, 1')

// Damage Midi-QOL averages, as its Average Damage setting has it for characters: a typed Ice Knife
// attack's workflow rolls its damage itself, its 1d10 and Shard Explosion's 2d6, which Midi averages
// once thrown: never asked.
midi.settings.averageDamage = 'character'
count = asked().length
knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
workflow = workflowOf(knife.id)
await until(() => workflow.otherDamageRolls?.length, 'the averaged damage')
midi.settings.averageDamage = 'none'
await pass(3000)
assert.deepEqual([knife.status, asked().length - count, workflow.damageRolls?.length, workflow.otherDamageRolls[0].dice[0].number], ['done', 0, 1, 2])
checks()
ok("damage Midi-QOL averages for characters: a typed Ice Knife attack's workflow rolls its 1d10 and Shard Explosion's 2d6 itself, never asked")

// A typed attack's damage that opens no run, the Gamemaster's from the app or the player's own
// untyped one, thrown with the app's 3D dice: the workflow leaves the attack's run, so Shard
// Explosion's 2d6, rolled within that damage, is Foundry's computer dice, as before 0.45.0: never
// asked, nor the Gamemaster's manual dice.
for (const fields of [{ by: 'gm', typed: false }, { typed: false }]) {
  checks()
  count = asked().length
  knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
  dealt = await damage(knife.id, [{ faces: 10, results: [7] }], fields)
  workflow = workflowOf(knife.id)
  await until(() => workflow.otherDamageRolls?.length, 'the other damage')
  assert.deepEqual([knife.status, dealt.status, asked().length - count, faces(workflow.damageRolls[0]), workflow.otherDamageRolls[0].dice[0].number],
    ['done', 'done', 0, [[7]], 2], JSON.stringify(fields))
  assert.deepEqual(checks(), [], `${JSON.stringify(fields)}: never the Gamemaster's manual dice`)
}
ok("a typed Ice Knife attack's damage that opens no run, the Gamemaster's from the app (by gm) or the player's own untyped one: its 1d10 the app's 7, Shard Explosion's 2d6 Foundry's computer dice within it, as before 0.45.0, never asked")

// The Gamemaster rolls a typed attack's damage in Foundry, from Midi's card, with a click: theirs,
// the 1d10 and Shard Explosion's 2d6 their own dice, never asked; the workflow leaves the run.
checks()
count = asked().length
knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
workflow = workflowOf(knife.id)
// First the Gamemaster's own code rolls the item's damage, no click and no workflow, once the attack
// is made, its run open with its workflow waiting for his damage: no roll of his is being made, so
// it's theirs, never asked.
const coded = await thorin.items.get('ice-knife').system.activities.get('ice-attack').rollDamage({}, { configure: false }, { create: false })
assert.deepEqual([coded?.length, asked().length - count, checks()], [1, 0, [coded[0].formula]], "the Gamemaster's code's damage once the attack is made")
const byClick = await thorin.items.get('ice-knife').system.activities.get('ice-attack').rollDamage(
  { workflow, event: { type: 'click', target: { closest: () => null } } }, { configure: false }, { create: false })
await until(() => workflow.otherDamageRolls?.length, 'the other damage')
assert.deepEqual([byClick?.length, asked().length - count, workflow.otherDamageRolls[0].dice[0].number], [1, 0, 2])
assert.deepEqual(checks(), [byClick[0].formula, workflow.otherDamageRolls[0].formula], "the 1d10 and the 2d6 the Gamemaster's manual dice")
ok("the Gamemaster's own code's damage of the item, no click and no workflow, once a typed Ice Knife attack is made, its run open with its workflow: theirs, never asked; and their damage for its workflow, rolled in Foundry with a click, as from Midi's card: the 1d10 and Shard Explosion's 2d6 their own manual dice, never asked")

// A workflow fed by a later roll is that roll's run from then on: the Gamemaster's click roll in a
// typed Ice Knife attack's workflow, one that doesn't feed it, takes it out of the attack's run; the
// player's typed damage then feeds it, and it's the damage's run: Shard Explosion's 2d6 asked.
checks()
count = asked().length
knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
workflow = workflowOf(knife.id)
const aside = await thorin.items.get('ice-knife').system.activities.get('ice-attack').rollDamage(
  { workflow, event: { type: 'click', target: { closest: () => null } }, midiOptions: { updateWorkflow: false } }, { configure: false }, { create: false })
assert.deepEqual([aside?.length, asked().length - count, checks(), workflow.damageRolls ?? null], [1, 0, [aside[0].formula], null], "the click's roll the Gamemaster's, the workflow still waiting for its damage")
dealing = damage(knife.id, [{ faces: 10, results: [7] }])
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.label, ask.command, ask.rolls[0].terms], ['damage', 'Ice Knife: Shard Explosion', `dmg-${ids}`, [{ faces: 6, number: 2 }]])
await make(answerOf(ask, [{ roll: 0, term: 0, results: [6, 1] }]))
dealt = await dealing
assert.deepEqual([dealt.status, faces(workflow.damageRolls[0]), faces(workflow.otherDamageRolls[0]), checks()], ['done', [[7]], [[6, 1]], []])
ok("a typed Ice Knife attack's workflow taken out of its run by the Gamemaster's click roll in it, one that doesn't feed it, then fed by the player's typed damage: the damage's run from then on, Shard Explosion's 2d6 asked of the player, typed 6 and 1")

// The same click while the player's typed dagger attack is still being made, held as the module
// writes its card, so its run is open: Sneak Attack's bonus 2d6, rolled after the click's 1d4, is no
// run's either, though the use from the app tags the workflow still. The Gamemaster's dice, both.
checks()
midi.bonusDamage = [{ formula: '2d6', type: 'piercing', flavor: 'Sneak Attack' }]
count = asked().length
const heldId = `atk-${++ids}`
let letGo
let writing = false
const holding = new Promise(resolve => { letGo = resolve })
const hold = Hooks.on('createChatMessage', message => {
  if (message.flags?.['sending-stone']?.use !== heldId) return
  const own = message.setFlag
  message.setFlag = async function (scope, key, value) {
    if (key === 'usage') {
      writing = true
      await holding
    }
    return own.call(this, scope, key, value)
  }
})
const stabbing = make(typed({ id: heldId, kind: 'attack', item: 'dagger', activity: 'dagger-stab', target: { combatId: 'fight', combatantId: 'cb-gob' }, dice: [{ faces: 20, results: [16] }] }))
await until(() => writing, 'the attack writing its card')
workflow = workflowOf(heldId)
const stabbed = await thorin.items.get('dagger').system.activities.get('dagger-stab').rollDamage(
  { workflow, event: { type: 'click', target: { closest: () => null } } }, { configure: false }, { create: false })
await until(() => workflow.bonusDamageRolls?.length, 'the bonus damage')
letGo()
Hooks.off('createChatMessage', hold)
const stabResult = await stabbing
midi.bonusDamage = null
assert.deepEqual([stabResult.status, stabbed?.length, asked().length - count], ['done', 1, 0], JSON.stringify(stabResult))
assert.deepEqual(checks(), [stabbed[0].formula, '2d6'], "the click's 1d4 and Sneak Attack's 2d6 the Gamemaster's manual dice")
ok("the Gamemaster's click in a typed dagger attack's workflow while the attack is still being made, its run open: Sneak Attack's bonus 2d6 after it no run's, though the use tags the workflow; the 1d4 and the 2d6 the Gamemaster's own dice, never asked")

// A critical hit's: Flame Knife's Burst, a damage activity of two parts, one ask for both rolls, its
// dice doubled, critical; the fire answered, the cold left out, Foundry's.
count = asked().length
const flame = await attack('flame-knife', 'flame-attack', 20)
assert.equal(flame.attack.critical, true)
dealing = damage(flame.id, flame.damage.rolls.flatMap(roll => roll.dice).map(({ faces: f, number }) => ({ faces: f, results: Array(number).fill(1) })))
ask = await nextAsk(count)
assert.deepEqual([ask.critical, ask.label, ask.rolls.map(roll => [roll.type, roll.terms])],
  [true, 'Flame Knife: Burst', [['fire', [{ faces: 6, number: 4 }]], ['cold', [{ faces: 4, number: 2 }]]]])
answer = await make(answerOf(ask, [{ roll: 0, term: 0, results: [6, 6, 6, 6] }]))
dealt = await dealing
const burst = workflowOf(flame.id).otherDamageRolls
assert.deepEqual([dealt.status, burst.length, burst[0].total, burst[1].dice[0].results.length, answer.rolls.length, asked().length - count], ['done', 2, 24, 2, 2, 1])
ok("a critical hit's other damage, Flame Knife's Burst of two parts: one ask for both rolls, critical, its dice already doubled as dnd5e doubles them, 4d6 fire and 2d4 cold; the fire typed 6s, 24, the cold left out and Foundry's; the result both rolls as thrown")

// Bonus damage macros: each formula asked in turn, purpose bonus; a macro's own Roll never. While
// Sneak Attack's waits, the Gamemaster's own rolls of Hunter's Mark's formula, a plain one and a
// damage roll of its very type and flavor, are theirs at once; so are those made in the instant
// before Midi builds Hunter's Mark's, a plain roll, a damage roll of another flavor, and one of its
// very flavor but another type.
checks()
midi.bonusDamage = [
  { formula: '2d6', type: 'piercing', flavor: 'Sneak Attack' },
  { formula: '1d6', type: 'force', flavor: "Hunter's Mark" },
  { roll: () => new DamageRoll('1d4', {}, { type: 'fire' }) },
]
const instant = []
midi.beforeBonusRoll = index => {
  if (index !== 1) return
  instant.push(new foundry.dice.Roll('1d6').evaluate(), new DamageRoll('1d6', {}, { type: 'force', flavor: 'Hex' }).evaluate())
  // Another player's own typed roll of that very formula, type and flavor, made with its plan: its
  // own dice, never the bonus.
  instant.push(withPlan({ id: 'miraOwn', typed: true, kind: 'damage', dice: [{ faces: 6, results: [5] }] },
    () => new DamageRoll('1d6', {}, { type: 'force', flavor: "Hunter's Mark", sendingStone: 'miraOwn' }).evaluate()))
  instant.push(new DamageRoll('1d6', {}, { type: 'fire', flavor: "Hunter's Mark" }).evaluate())
}
count = asked().length
const sneak = await attack('dagger', 'dagger-stab', 16)
dealing = damage(sneak.id, [{ faces: 4, results: [3] }])
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.label, ask.rolls.map(roll => [roll.type, roll.flavor, roll.terms])], ['bonus', 'Dagger: Attack', [['piercing', 'Sneak Attack', [{ faces: 6, number: 2 }]]]])
assert.equal(await atOnce([new foundry.dice.Roll('1d6'), new DamageRoll('1d6', {}, { type: 'force', flavor: "Hunter's Mark" })].map(roll => roll.evaluate())), 'thrown', 'never held')
assert.deepEqual([asked().length - count, checks()], [1, ['1d6', '1d6']], "the Gamemaster's two while Sneak Attack's waits: theirs, never asked")
await make(answerOf(ask, [{ roll: 0, term: 0, results: [4, 4] }]))
const mark = await nextAsk(count + 1)
assert.equal(await atOnce(instant), 'thrown', 'never held')
assert.equal((await instant[2]).total, 5, "the other player's own roll took its own die")
assert.deepEqual([mark.purpose, mark.rolls.map(roll => [roll.type, roll.flavor, roll.terms]), checks()],
  ['bonus', [['force', "Hunter's Mark", [{ faces: 6, number: 1 }]]], ['1d6', '1d6', '1d6']], "Hunter's Mark's asked; the instant's three the Gamemaster's")
await make(answerOf(mark, [{ roll: 0, term: 0, results: [1] }]))
dealt = await dealing
await until(() => workflowOf(sneak.id).bonusDamageRolls?.length === 3, 'the bonus damage')
assert.deepEqual(workflowOf(sneak.id).bonusDamageRolls.slice(0, 2).map(faces), [[[4, 4]], [[1]]])
await pass(5000)
assert.deepEqual([asked().length - count, checks()], [2, ['1d4']], "the macro's own 1d4 never asked: the Gamemaster's manual dice")
midi.bonusDamage = null
midi.beforeBonusRoll = null
ok("Midi bonus damage macros' formulas, Sneak Attack's 2d6 piercing and Hunter's Mark's 1d6 force: each asked in turn once the macros returned, purpose bonus, label Dagger: Attack, typed 4 and 4, then 1; while the first waits, the Gamemaster's own 1d6, plain and of Hunter's Mark's very type and flavor, theirs at once; in the instant before Hunter's Mark's is built, a plain 1d6, a 1d6 force of another flavor and a 1d6 fire of its very flavor, theirs, and another player's own typed 1d6 force of Hunter's Mark's very flavor, made with its plan, its own 5; a macro's own Roll never asked")

// A bonus damage macro returning a formula alone, `{ damageRoll: '1d8' }`, no type and no flavor:
// Midi builds it a damage roll of type "none", flavored so (Workflow.ts:4090-4098), asked as the
// run's. Made in the instant before Midi builds it, a plain Roll of that formula, a plain Roll
// carrying that very type and flavor, and a damage roll of it with no type are never it, nothing on
// them as Midi builds its own: the Gamemaster's at once, their manual dice.
checks()
midi.bonusDamage = [{ formula: '1d8' }]
const bare = []
midi.beforeBonusRoll = index => {
  if (index !== 0) return
  bare.push(new foundry.dice.Roll('1d8').evaluate(), new foundry.dice.Roll('1d8', {}, { type: 'none', flavor: 'none' }).evaluate(),
    new DamageRoll('1d8').evaluate())
}
count = asked().length
const bareStab = await attack('dagger', 'dagger-stab', 16)
dealing = damage(bareStab.id, [{ faces: 4, results: [3] }])
ask = await nextAsk(count)
assert.equal(await atOnce(bare), 'thrown', 'never held')
assert.deepEqual([ask.purpose, ask.rolls.map(roll => [roll.type, roll.flavor, roll.terms]), asked().length - count, checks()],
  ['bonus', [['none', 'none', [{ faces: 8, number: 1 }]]], 1, ['1d8', '1d8', '1d8']], "Midi's own asked; the instant's three the Gamemaster's")
await make(answerOf(ask, [{ roll: 0, term: 0, results: [7] }]))
dealt = await dealing
await until(() => workflowOf(bareStab.id).bonusDamageRolls?.length === 1, 'the bonus damage')
assert.deepEqual([dealt.status, faces(workflowOf(bareStab.id).bonusDamageRolls[0]), asked().length - count, checks()], ['done', [[7]], 1, []])
midi.bonusDamage = null
midi.beforeBonusRoll = null
ok("a bonus macro's bare formula, 1d8 with no type nor flavor: Midi's damage roll of it, type and flavor \"none\", asked and typed 7; in the instant before, a plain 1d8, a plain 1d8 carrying that very type and flavor, and a damage roll of it with no type, the Gamemaster's at once, their manual dice")

// Two runs' workflows await bonus rolls of one formula at once: Thorin's dagger's and Mira's, each
// rolling Sneak Attack's 2d6 and Hunter's Mark's 1d6. Thorin's 2d6 is asked; while it waits, Mira's
// damage is made, her workflow expecting Hunter's Mark's 1d6 too: which 1d6 is whose can't be told,
// so from then on neither's 1d6 is asked, hers nor his once his 2d6 is answered: Foundry's computer
// dice, never the Gamemaster's manual dice. Her 2d6, which his workflow no longer awaits, his taken,
// is hers alone: asked of her, her 1d6 after it unasked. Once hers are rolled,
// while his 2d6 still waits, the Gamemaster's own damage roll of Hunter's Mark's very formula, type
// and flavor is theirs, their manual dice: his workflow rolls nothing else meanwhile, so it's taken
// for neither. And one made just so in the instant before his 1d6 is built (the residual PROTOCOL
// names) is Foundry's computer dice, and uses up nothing: his own 1d6 after it is still Foundry's
// computer dice, never the Gamemaster's manual dice.
midi.bonusDamage = [
  { formula: '2d6', type: 'piercing', flavor: 'Sneak Attack' },
  { formula: '1d6', type: 'force', flavor: "Hunter's Mark" },
]
app.open = new Set(['thorin', 'mira'])
await pass(1000)
checks()
count = asked().length
const thorinStab = await attack('dagger', 'dagger-stab', 16)
const miraStab = await make(typed({ id: `atk-${++ids}`, actorId: 'mira', kind: 'attack', item: 'mira-dagger', activity: 'mira-stab', target: { combatId: 'fight', combatantId: 'cb-gob' }, dice: [{ faces: 20, results: [16] }] }))
assert.deepEqual([thorinStab.status, miraStab.status], ['done', 'done'], JSON.stringify(miraStab))
const thorinDealing = damage(thorinStab.id, [{ faces: 4, results: [3] }])
const sneakAsk = await nextAsk(count)
assert.deepEqual([sneakAsk.actorId, sneakAsk.purpose, sneakAsk.rolls.map(roll => roll.flavor)], ['thorin', 'bonus', ['Sneak Attack']])
const miraDealing = make(typed({ id: `dmg-${++ids}`, actorId: 'mira', kind: 'damage', use: miraStab.id, dice: [{ faces: 4, results: [2] }] }))
const miraSneak = await nextAsk(count + 1)
assert.deepEqual([miraSneak.actorId, miraSneak.purpose, miraSneak.rolls.map(roll => [roll.flavor, roll.terms])], ['mira', 'bonus', [['Sneak Attack', [{ faces: 6, number: 2 }]]]],
  'her own 2d6, a formula his workflow no longer awaits, asked of her')
await make(answerOf(miraSneak, [{ roll: 0, term: 0, results: [3, 3] }]))
const miraDealt = await miraDealing
await until(() => workflowOf(miraStab.id)?.bonusDamageRolls?.length === 2, "Mira's bonus damage")
assert.deepEqual([miraDealt.status, faces(workflowOf(miraStab.id).bonusDamageRolls[0]), asked().length - count, checks()], ['done', [[3, 3]], 2, []],
  "her 2d6 as she typed it, her 1d6 never asked, never the Gamemaster's manual dice")
const gmMark = new DamageRoll('1d6', {}, { type: 'force', flavor: "Hunter's Mark" }).evaluate()
assert.equal(await atOnce([gmMark]), 'thrown', 'never held')
assert.deepEqual([asked().length - count, checks()], [2, ['1d6']], "the Gamemaster's own Hunter's Mark while his 2d6 waits: theirs, their manual dice")
let instantMark = null
midi.beforeBonusRoll = (index, flow) => {
  if ((index !== 1) || (flow !== workflowOf(thorinStab.id))) return
  instantMark = new DamageRoll('1d6', {}, { type: 'force', flavor: "Hunter's Mark" }).evaluate()
}
await make(answerOf(sneakAsk, [{ roll: 0, term: 0, results: [5, 5] }]))
assert.equal((await thorinDealing).status, 'done')
await until(() => workflowOf(thorinStab.id).bonusDamageRolls?.length === 2, "Thorin's bonus damage")
midi.beforeBonusRoll = null
assert.ok(instantMark, 'a roll made in the instant before his 1d6')
assert.equal(await atOnce([instantMark]), 'thrown', 'never held')
await pass(5000)
assert.deepEqual([asked().length - count, faces(workflowOf(thorinStab.id).bonusDamageRolls[0]), checks()], [2, [[5, 5]], []],
  "his 1d6, and the Gamemaster's in the instant before it, Foundry's computer dice, never their manual dice")
midi.bonusDamage = null
app.open = new Set(['thorin'])
await pass(1000)
ok("two runs' bonus rolls of one formula at once, Thorin's and Mira's daggers' Sneak Attack 2d6 and Hunter's Mark 1d6: Thorin's 2d6 asked first, typed 5 and 5; once Mira's workflow expects Hunter's Mark's 1d6 beside his, neither's 1d6 is asked, Foundry's computer dice, never the Gamemaster's manual dice; her 2d6, which his no longer awaits, asked of her alone, typed 3 and 3; the Gamemaster's own Hunter's Mark of that very formula, type and flavor while his 2d6 waits is theirs, their manual dice, taken for neither; one made in the instant before his 1d6, Foundry's computer dice, uses up nothing, his own 1d6 still Foundry's computer dice")

// Deferred: Frost Brand's Rime spends 1d4 charges, so Midi rolls it once saves are checked, after
// the damage's result: its cost asked once (Midi's check of it beforehand thrown away, Foundry's
// computer dice), then its 2d6.
checks()
count = asked().length
const brand = await attack('frost-brand', 'frost-attack', 17)
const brandUses = usesOf('frost-brand')
dealt = await damage(brand.id, [{ faces: 8, results: [5] }])
assert.equal(dealt.status, 'done', 'the damage done before its other damage is rolled')
const cost = await nextAsk(count)
assert.deepEqual([cost.purpose, cost.label, cost.rolls[0].formula, cost.command], ['cost', 'Frost Brand: Rime', '0 + 1d4', dealt.id])
await make(answerOf(cost, [{ roll: 0, term: 0, results: [4] }]))
const rime = await nextAsk(count + 1)
assert.deepEqual([rime.purpose, rime.label, rime.rolls[0].terms], ['damage', 'Frost Brand: Rime', [{ faces: 6, number: 2 }]])
await make(answerOf(rime, [{ roll: 0, term: 0, results: [2, 2] }]))
await until(() => workflowOf(brand.id).otherDamageRolls?.length, 'the deferred damage')
assert.deepEqual([usesOf('frost-brand') - brandUses, faces(workflowOf(brand.id).otherDamageRolls[0]), midi.otherConsumed, checks()], [4, [[2, 2]], ['frost-burst'], []])
ok("Midi's deferred other damage, Frost Brand's Rime: after the damage's result and the targets' saves, its 1d4 cost asked once, Midi's check of it beforehand, thrown away, Foundry's computer dice, never the Gamemaster's manual dice; typed 4, 4 charges spent, then its 2d6 asked and typed")

// The Gamemaster's own spending of Rime while Thorin's typed Frost Brand attack's workflow, bound to
// his run, waits for his damage, Rime its other activity: their own use of Rime in Foundry, and their
// own Midi use of Frost Brand, whose deferred Rime Midi spends within their own workflow, are never
// asked, their costs their own manual dice. Then Thorin's damage: his deferred Rime's cost asked of
// him, within his workflow's own check of its other activity's consumption; while it waits, the
// Gamemaster's own use of Rime again, never asked; his answered, spent as he typed it.
const fast = { midiOptions: { workflowOptions: { autoRollAttack: true, fastForwardAttack: true, autoRollDamage: 'always', fastForwardDamage: true, forceCompletion: true } } }
const rimeOf = () => thorin.items.get('frost-brand').system.activities.get('frost-burst')
checks()
count = asked().length
const held = await attack('frost-brand', 'frost-attack', 17)
assert.equal(held.status, 'done', JSON.stringify(held))
let spentBefore = usesOf('frost-brand')
await rimeOf().use(fast, { configure: false }, { create: true })
await pass(3000)
assert.deepEqual([asked().length - count, usesOf('frost-brand') - spentBefore, checks().filter(formula => formula === '0 + 1d4')], [0, 4, ['0 + 1d4']],
  "the Gamemaster's own use of Rime: never asked, its cost their manual dice, the highest face")
const madeBefore = midi.made.length
spentBefore = usesOf('frost-brand')
await thorin.items.get('frost-brand').system.activities.get('frost-attack').use(fast, { configure: false }, { create: true })
const gmBrand = midi.made[madeBefore]
await until(() => gmBrand?.aborted || (gmBrand?.currentAction === gmBrand?.WorkflowState_Completed), "the Gamemaster's Frost Brand workflow")
await pass(3000)
assert.deepEqual([asked().length - count, midi.otherConsumed.filter(id => id === 'frost-burst').length], [0, 2],
  "the Gamemaster's own Frost Brand: its deferred Rime spent in their own workflow, never asked")
assert.deepEqual(checks().filter(formula => formula === '0 + 1d4'), ['0 + 1d4', '0 + 1d4'], "Midi's check of the cost and the cost itself, both the Gamemaster's manual dice")
spentBefore = usesOf('frost-brand')
dealt = await damage(held.id, [{ faces: 8, results: [5] }])
const heldCost = await nextAsk(count)
assert.deepEqual([heldCost.purpose, heldCost.label, heldCost.command, heldCost.actorId], ['cost', 'Frost Brand: Rime', dealt.id, 'thorin'])
await rimeOf().use(fast, { configure: false }, { create: true })
await pass(3000)
assert.deepEqual([asked().length - count, checks().filter(formula => formula === '0 + 1d4')], [1, ['0 + 1d4']],
  "the Gamemaster's own use of Rime while his cost waits: never asked, their manual dice; Midi's own check of Thorin's cost beforehand, thrown away, Foundry's computer dice")
const gmSpent = usesOf('frost-brand') - spentBefore
const heldPaid = await make(answerOf(heldCost, [{ roll: 0, term: 0, results: [1] }]))
const heldRime = await nextAsk(count + 1)
assert.deepEqual([heldRime.purpose, heldRime.command], ['damage', dealt.id])
await make(answerOf(heldRime, [{ roll: 0, term: 0, results: [3, 3] }]))
await until(() => workflowOf(held.id).otherDamageRolls?.length, 'the deferred damage')
// (What each spends is worked out from the uses each read before rolling: two spending at once may
// write over each other, as dnd5e's would; each one's own cost roll is what's checked.)
assert.deepEqual([gmSpent, heldPaid.rolls.map(roll => [roll.formula, roll.total]), faces(workflowOf(held.id).otherDamageRolls[0]), asked().length - count],
  [4, [['0 + 1d4', 1]], [[3, 3]], 2])
ok("while Thorin's typed Frost Brand attack waits for his damage, Rime its other activity: the Gamemaster's own use of Rime in Foundry, and their own Midi use of Frost Brand, whose deferred Rime Midi spends in their workflow, never asked, their costs their own manual dice; Thorin's own deferred Rime cost asked of him within his workflow's own check of its other activity's consumption, Midi's check of it beforehand Foundry's computer dice, and while it waits the Gamemaster's own use of Rime again never asked; his answered 1, his cost roll 1, his 2d6 then asked")

// Within Thorin's own workflow's check of Rime's consumption, before Midi spends it, as Midi works out
// what it would spend (or its usage dialog is open), the Gamemaster uses Rime in Foundry: a use of its
// own, on its own copy of the item, never his, their manual dice. Then Midi spends his: asked of him,
// once; and while it waits, the very Rime his workflow spends is spent again by other code, as a world
// script answering his spending might: only Midi's own spending, the first within the check, is his,
// so that one is never asked, their manual dice.
const ownPrepare = Activity.prototype._prepareUsageUpdates
checks()
count = asked().length
const inside = await attack('frost-brand', 'frost-attack', 17)
let gmInside = null
Activity.prototype._prepareUsageUpdates = async function (config, options, ...rest) {
  if (!gmInside && options?.returnErrors && (this === workflowOf(inside.id)?.otherActivity)) {
    const gmBefore = usesOf('frost-brand')
    gmInside = rimeOf().use(fast, { configure: false }, { create: true }).then(() => [usesOf('frost-brand') - gmBefore, asked().length - count])
    await gmInside
  }
  return ownPrepare.call(this, config, options, ...rest)
}
let spentAgain = null
const spendingAgain = Hooks.on('dnd5e.preActivityConsumption', activity => {
  if (spentAgain || (activity !== workflowOf(inside.id)?.otherActivity)) return
  spentAgain = Promise.resolve().then(() => activity.consume(activity._prepareUsageConfig({ consume: { resources: true, spellSlot: false, action: false } }), { data: {} }))
})
dealt = await damage(inside.id, [{ faces: 8, results: [5] }])
const insideCost = await nextAsk(count)
assert.deepEqual([insideCost.purpose, insideCost.command, insideCost.actorId, await gmInside], ['cost', dealt.id, 'thorin', [4, 0]],
  "the Gamemaster's own use of Rime within his check, before Midi spends his: never asked, their manual dice, the highest face")
await spentAgain
await pass(3000)
assert.deepEqual([asked().length - count, checks().filter(formula => formula === '0 + 1d4')], [1, ['0 + 1d4', '0 + 1d4']],
  "the Gamemaster's use inside, and the very Rime spent again while his cost waits: their manual dice, never asked; Midi's check of his Foundry's computer dice")
const insidePaid = await make(answerOf(insideCost, [{ roll: 0, term: 0, results: [1] }]))
const insideRime = await nextAsk(count + 1)
await make(answerOf(insideRime, [{ roll: 0, term: 0, results: [2, 2] }]))
await until(() => workflowOf(inside.id).otherDamageRolls?.length, 'the deferred damage')
Activity.prototype._prepareUsageUpdates = ownPrepare
Hooks.off('dnd5e.preActivityConsumption', spendingAgain)
assert.deepEqual([insidePaid.rolls.map(roll => [roll.formula, roll.total]), insideRime.purpose, asked().length - count, checks().filter(formula => formula === '0 + 1d4')], [[['0 + 1d4', 1]], 'damage', 2, []])
ok("within Thorin's own workflow's check of Rime's consumption: the Gamemaster's use of Rime before Midi spends his, never asked, their manual dice; Midi's own spending of his asked once, typed 1; the very Rime his workflow spends, spent again by other code while his waits, never asked, their manual dice; his 2d6 then asked")

// Thorin's workflow aborted within its check of Rime's consumption, before Midi spends it: no longer
// his run's, so its cost is never asked, nor its damage after.
checks()
count = asked().length
const aborting = await attack('frost-brand', 'frost-attack', 17)
const consumedBefore = midi.otherConsumed.length
Activity.prototype._prepareUsageUpdates = async function (config, options, ...rest) {
  const worked = await ownPrepare.call(this, config, options, ...rest)
  // Aborted as Midi's check returns, just before Midi spends it.
  const flow = workflowOf(aborting.id)
  if (flow && !flow.aborted && options?.returnErrors && (this === flow.otherActivity)) flow.aborted = true
  return worked
}
dealt = await damage(aborting.id, [{ faces: 8, results: [5] }])
await until(() => workflowOf(aborting.id).otherDamageRolls?.length, 'the deferred damage')
Activity.prototype._prepareUsageUpdates = ownPrepare
await pass(3000)
assert.deepEqual([dealt.status, midi.otherConsumed.length - consumedBefore, asked().length - count, checks()],
  ['done', 1, 0, ['0 + 1d4', workflowOf(aborting.id).otherDamageRolls[0].formula]])
ok("a typed Frost Brand attack's workflow aborted within its check of Rime's consumption: its cost and its 2d6 after never asked, as Midi rolls them, the Gamemaster's dice")

// Healing Midi rolls with the damage: Leech Blade's Drink, purpose healing.
checks()
count = asked().length
const leech = await attack('leech', 'leech-cut', 15)
dealing = damage(leech.id, [{ faces: 6, results: [4] }])
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.label, ask.rolls.map(roll => [roll.type, roll.terms])], ['healing', 'Leech Blade: Drink', [['healing', [{ faces: 4, number: 1 }]]]])
await make(answerOf(ask, [{ roll: 0, term: 0, results: [3] }]))
dealt = await dealing
assert.deepEqual([dealt.status, faces(workflowOf(leech.id).otherDamageRolls[0]), checks()], ['done', [[3]], []])
ok("Midi's other healing, Leech Blade's Drink, rolled with the cut's damage: asked, purpose healing, label Leech Blade: Drink, type healing, 1d4, typed 3")

// A utility's formula Midi rolls itself, in the use's workflow: purpose formula. While it waits, the
// Gamemaster's own code rolls the charm's formula, no click and no workflow, while the use is being
// made: asked as the run's (the one way left to ask wrongly). Once the use is made and its workflow
// completes, its run is over: that ask closes expired, well before its minute is out.
count = asked().length
using = make(typed({ id: `use-${++ids}`, kind: 'use', item: 'luck', activity: 'luck-roll', targets: [], slot: null }))
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.label, ask.rolls.map(roll => roll.terms)], ['formula', 'Charm of Luck: Luck', [[{ faces: 4, number: 1 }]]])
const luckCode = thorin.items.get('luck').system.activities.get('luck-roll').rollFormula({}, { configure: false }, { create: false })
const luckStray = await nextAsk(count + 1)
assert.deepEqual([luckStray.purpose, luckStray.command], ['formula', ask.command])
await make(answerOf(ask, [{ roll: 0, term: 0, results: [4] }]))
used = await using
await until(() => closeOf(luckStray.id), 'the stray ask closing', 12_000)
assert.ok((await luckCode)?.[0]?.total >= 1)
assert.deepEqual([used.status, workflowOf(used.id)?.utilityRolls?.map(roll => roll.total), closeOf(luckStray.id), early(luckStray, closedAt(luckStray.id)), checks()],
  ['done', [4], { id: luckStray.id, reason: 'expired' }, true, []])
ok("a utility's formula Midi rolls in the use's workflow, Charm of Luck's 1d4: asked, purpose formula, label Charm of Luck: Luck, typed 4, the workflow's utility roll 4; the Gamemaster's code's roll of the same formula meanwhile asked as the run's, closed expired once the use is made and its workflow completed, well before its minute is out")

// Ammunition's own activity, which Midi rolls with the bow's damage: Arrows of Frost's 1d6 cold.
count = asked().length
const shot = await attack('bow', 'bow-shot', 16, { ammunition: 'arrows' })
assert.equal(shot.status, 'done', JSON.stringify(shot))
dealing = damage(shot.id, [{ faces: 8, results: [5] }])
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.label, ask.rolls.map(roll => [roll.type, roll.terms])], ['damage', 'Arrows of Frost: Frost', [['cold', [{ faces: 6, number: 1 }]]]])
await make(answerOf(ask, [{ roll: 0, term: 0, results: [6] }]))
dealt = await dealing
assert.deepEqual([dealt.status, faces(workflowOf(shot.id).damageRolls[0]), faces(workflowOf(shot.id).otherDamageRolls[0]), checks()], ['done', [[5]], [[6]], []])
ok("an ammunition's own activity, Arrows of Frost's Frost, which Midi rolls with the Longbow's damage: asked within the damage, label Arrows of Frost: Frost, 1d6 cold, typed 6, the bow's 1d8 typed 5")

// The Gamemaster's own Midi use of Ice Knife while the player's waits: never asked.
count = asked().length
knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
dealing = damage(knife.id, [{ faces: 10, results: [7] }])
ask = await nextAsk(count)
const gmKnife = thorin.items.get('ice-knife').system.activities.get('ice-attack')
await gmKnife.use({ midiOptions: { workflowOptions: { autoRollAttack: true, fastForwardAttack: true, autoRollDamage: 'always', fastForwardDamage: true, forceCompletion: true } } }, { configure: false }, { create: true })
const gmWorkflow = midi.made.at(-1)
await until(() => gmWorkflow.otherDamageRolls?.length || gmWorkflow.aborted || (gmWorkflow.currentAction === gmWorkflow.WorkflowState_Completed), "the Gamemaster's workflow")
assert.equal(asked().length - count, 1, "the Gamemaster's own never asked")
// A roll of another actor's in the player's very workflow, as a target's: the Gamemaster's, never asked.
checks()
const intruder = await goblin.items.get('club').system.activities.get('club-hit').rollDamage(
  { workflow: workflowOf(knife.id), midiOptions: { updateWorkflow: false } }, { configure: false }, { create: false })
assert.deepEqual([intruder?.length, asked().length - count, checks()], [1, 1, [intruder?.[0]?.formula]], "the goblin's club in the player's workflow")
await make(answerOf(ask, [{ roll: 0, term: 0, results: [6, 6] }]))
dealt = await dealing
assert.deepEqual([dealt.status, faces(workflowOf(knife.id).otherDamageRolls[0])], ['done', [[6, 6]]])
ok("the Gamemaster's own Midi use of the same Ice Knife, its damage rolled automatically with no click, while the player's 2d6 waits: another workflow, never asked; the goblin's club rolled in the player's very workflow: another actor's, the Gamemaster's manual dice, never asked; the player's answered as asked")

// A homebrew macro of the dagger's rolls more of its dice as Midi finishes the roll (its
// postActiveEffects macros), in the workflow: still the run's, asked; the run lasts until Midi cleans
// up, so the answer, ten seconds on, is taken.
count = asked().length
const venom = await attack('dagger', 'dagger-stab', 16)
let venomRolls = null
midi.postActiveEffects = async flow => {
  if (flow !== workflowOf(venom.id)) return
  midi.postActiveEffects = null
  venomRolls = await thorin.items.get('dagger').system.activities.get('dagger-stab').rollDamage(
    { workflow: flow, midiOptions: { updateWorkflow: false } }, { configure: false }, { create: false })
}
dealing = damage(venom.id, [{ faces: 4, results: [2] }])
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.command, ask.rolls.map(roll => roll.terms)], ['damage', `dmg-${ids}`, [[{ faces: 4, number: 1 }]]])
await pass(10_000)
answer = await make(answerOf(ask, [{ roll: 0, term: 0, results: [4] }]))
await until(() => venomRolls, "the macro's roll")
dealt = await dealing
assert.deepEqual([dealt.status, answer.status, closeOf(ask.id), faces(venomRolls[0])], ['done', 'done', { id: ask.id, reason: 'answered' }, [[4]]])
ok("a homebrew macro's roll as Midi finishes a typed dagger's workflow (its postActiveEffects macros): asked as the run's, the run open until Midi cleans up, answered ten seconds on, 4")

// Aborted while it waits: closed gone, well before its minute is out, Foundry's dice.
count = asked().length
knife = await attack('ice-knife', 'ice-attack', 15, { slot: 'spell1' })
dealing = damage(knife.id, [{ faces: 10, results: [7] }])
ask = await nextAsk(count)
workflowOf(knife.id).aborted = true
dealt = await dealing
assert.deepEqual([dealt.status, closeOf(ask.id), early(ask, closedAt(ask.id))], ['done', { id: ask.id, reason: 'gone' }, true])
const gone = await make(answerOf(ask, [{ roll: 0, term: 0, results: [1, 1] }]))
assert.deepEqual(refusal(gone), ['failed', 'diceAsk', 'gone'])
ok("a workflow aborted while its ask waits: closed gone, well before its minute is out, Foundry's dice, an answer after refused diceAsk gone")
// A spending of a run's that a later hook of the world's stops, as dnd5e lets any hook of
// dnd5e.preActivityConsumption: once Midi's check of Thorin's deferred Rime returns, its spending
// stopped so, that spending is over, so a roll of its cost made with its configuration afterwards in
// his workflow, as a macro reusing it might, is no run's: the Gamemaster's manual dice, never asked.
checks()
count = asked().length
const stopped = await attack('frost-brand', 'frost-attack', 17)
let stoppedConfig = null
const stopper = Hooks.on('dnd5e.preActivityConsumption', (activity, config) => {
  if (stoppedConfig || (activity !== workflowOf(stopped.id)?.otherActivity)) return true
  stoppedConfig = config
  return false
})
let strayCost = null
midi.postActiveEffects = async flow => {
  if (flow !== workflowOf(stopped.id)) return
  midi.postActiveEffects = null
  strayCost = await flow.otherActivity.consumption.targets[0].resolveCost({ config: stoppedConfig })
}
const consumedBefore2 = midi.otherConsumed.length
const stoppedUses = usesOf('frost-brand')
dealt = await damage(stopped.id, [{ faces: 8, results: [5] }])
await until(() => strayCost, 'the roll with the stopped spending')
Hooks.off('dnd5e.preActivityConsumption', stopper)
await pass(3000)
assert.deepEqual([dealt.status, midi.otherConsumed.length - consumedBefore2, usesOf('frost-brand') - stoppedUses, workflowOf(stopped.id).otherDamageRolls ?? null, asked().length - count, checks()],
  ['done', 0, 0, null, 0, [strayCost.formula]], "Rime's spending stopped: nothing spent, no 2d6; its configuration's cost after, the Gamemaster's manual dice")
ok("a typed Frost Brand attack's deferred Rime, its spending stopped by a later hook: nothing spent, never asked; once Midi's check returns, a roll of its cost with that spending's configuration in his workflow is no run's, the Gamemaster's manual dice")

// A run spends one use at a time: a spending of its own that a later hook stopped is over once its
// next begins. Two spendings of the charm named for Thorin's open dagger run, as the module names its
// own use's: the first stopped by a later hook; once the second has begun, a roll of the cost with
// the first's configuration is no run's, the Gamemaster's manual dice; the second's asked of him.
checks()
count = asked().length
const twice = await attack('dagger', 'dagger-stab', 16)
const zap = thorin.items.get('charm').system.activities.get('charm-zap')
let firstSpending = null
const stopFirst = Hooks.on('dnd5e.preActivityConsumption', (activity, config) => {
  if (firstSpending || (activity !== zap)) return true
  firstSpending = config
  return false
})
assert.equal(await zap.consume(zap._prepareUsageConfig({ sendingStone: twice.id }), { data: {} }), false, 'the first stopped')
Hooks.off('dnd5e.preActivityConsumption', stopFirst)
before = usesOf('charm')
const secondSpending = zap.consume(zap._prepareUsageConfig({ sendingStone: twice.id }), { data: {} })
ask = await nextAsk(count)
assert.deepEqual([ask.purpose, ask.command], ['cost', twice.id])
const strayFirst = await zap.consumption.targets[0].resolveCost({ config: firstSpending })
assert.deepEqual([asked().length - count, checks()], [1, [strayFirst.formula]], "the first's configuration once the second began: no run's, the Gamemaster's manual dice")
await make(answerOf(ask, [{ roll: 0, term: 0, results: [2] }]))
await secondSpending
dealt = await damage(twice.id, [{ faces: 4, results: [1] }])
assert.deepEqual([usesOf('charm') - before, dealt.status, asked().length - count, checks()], [2, 'done', 1, []])
ok("two spendings named for one run, the first stopped by a later hook: once the second begins, the first's configuration's cost is no run's, the Gamemaster's manual dice; the second's asked of him, typed 2")

// A typed use whose own spending a later hook stops: the use isn't made, and once its call returns,
// that spending is over, though its run waits on the workflow Midi began for it: a roll of the cost
// with its configuration then is no run's, the Gamemaster's manual dice, never asked.
checks()
count = asked().length
let stoppedOwn = null
const stopOwn = Hooks.on('dnd5e.preActivityConsumption', (activity, config) => {
  if (stoppedOwn || (activity.id !== 'charm-zap')) return true
  stoppedOwn = config
  return false
})
before = usesOf('charm')
const stoppedUse = await make(typed({ id: `use-${++ids}`, kind: 'use', item: 'charm', activity: 'charm-zap', targets: [], slot: null }))
Hooks.off('dnd5e.preActivityConsumption', stopOwn)
const strayOwn = await thorin.items.get('charm').system.activities.get('charm-zap').consumption.targets[0].resolveCost({ config: stoppedOwn })
assert.deepEqual([stoppedUse.status, usesOf('charm') - before, asked().length - count, checks()], ['failed', 0, 0, [strayOwn.formula]],
  `${JSON.stringify(stoppedUse)}: not made, nothing spent; its configuration's cost after, the Gamemaster's manual dice`)
ok(`a typed use whose own spending a later hook stops: not made (${stoppedUse.reason}), nothing spent, never asked; once its call returns, a roll of its cost with that spending's configuration is no run's, the Gamemaster's manual dice`)

if (process.env.LIBWRAPPER) {
  assert.ok(['MidiQOL.Workflow.prototype.rollBonusDamage', 'MidiQOL.Workflow.prototype.callMacros'].every(target => wrapped.includes(target)), JSON.stringify(wrapped))
  ok("through libWrapper: Midi's rollBonusDamage and callMacros wrapped by it")
}

console.log(`later-dice${MIDI ? ' (Midi)' : ''}: done`)
process.exit(0)
