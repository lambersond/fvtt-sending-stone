// Players' rolls from the app, made in the game: the real module, dnd5e 5.3.3's real dice classes
// (D20Roll, D20Die, BasicRoll, BasicDie), a stand-in Foundry core and dnd5e actor, and a stand-in
// app. Run with --import ./dnd5e-register.mjs. LIBWRAPPER=1 wraps through a stand-in libWrapper;
// OMIT_ROOT=1 leaves _root off a roll's own dice; BREAK_MIN=1 has the min modifier do nothing, so
// that the hit die self-test fails; BREAK_REROLL=1 rolls a reroll or an explosion as a first throw,
// with dnd5e's damage rolls in the world, so that the attack self-test fails (module 0.22.0).
import assert from 'node:assert/strict'
import { combat, combatant, settle, settings, user, users, actors, message as fakeMessage } from './stub.mjs'
import { JSDOM } from 'jsdom'
import { find, openSettings, view } from './settings-app.mjs'

const MODULE = process.env.MODULE_DIR
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

// The module's long waits, shortened a hundredfold: a minute's watchdog takes 0.6 seconds.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)

const { core, prompts, messages, seedRandom } = await import('./dice-core.mjs')
if (process.env.OMIT_ROOT) core.omitRoot = true
if (process.env.BREAK_MIN) core.breakMinimum = true
if (process.env.BREAK_REROLL) core.breakReroll = true

const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll })
// dnd5e's damage rolls, for the attack self-test to reach its dice with modifiers; this world has
// none otherwise, so its attacks are never offered.
if (process.env.BREAK_REROLL) CONFIG.Dice.DamageRoll = (await import(`${DND5E}/damage-roll.mjs`)).default
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = {
  skills: {
    prc: { label: 'Perception', ability: 'wis' },
    ste: { label: 'Stealth', ability: 'dex' },
    ath: { label: 'Athletics', ability: 'str' },
  },
  tools: { thief: { label: "Thieves' Tools", ability: 'dex' } },
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
}
globalThis.dnd5e = { settings: { rulesVersion: 'modern' } }
settings.set('messageMode', 'gm') // The Gamemaster rolls privately; players' rolls are public all the same.
// What dnd5e tells the Gamemaster when a roll can't be made, which a player's roll never should.
const gmErrors = []
ui.notifications.error = message => { gmErrors.push(message) }

const { Actor5e, deathWarnings, rollCombatInitiative } = await import('./actor5e.mjs')

// libWrapper, when asked for: registers wrappers the way it would, and says what it was given.
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

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
user('carol', 'Carol')
user('dave', 'Dave')
const add = actor => { actors.set(actor.id, actor); return actor }
const thorin = add(new Actor5e({
  id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 4, dex: 1, wis: 2 },
  skills: { prc: { ability: 'wis' }, ste: { ability: 'dex', value: 0 }, ath: { ability: 'str', mode: 1 } },
  tools: { thief: { ability: 'dex' } },
}))
alice.character = thorin
const vex = add(new Actor5e({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3 }, skills: { prc: { ability: 'wis' } } }))
// Two players own Pip, and neither has it as their character.
const pip = add(new Actor5e({ id: 'pip', name: 'Pip', owners: ['carol', 'dave'], skills: { prc: { ability: 'wis' } } }))
const stranger = add(new Actor5e({ id: 'stranger', name: 'Stranger', owners: ['bob'] }))
// Gimli, a fighter and wizard, spends hit dice: three d10s and six d6s.
const gimli = add(new Actor5e({
  id: 'gimli', name: 'Gimli', owners: ['carol'], mods: { con: 2 }, hp: { value: 10, max: 40, temp: 0 },
  skills: { prc: { ability: 'wis' } },
  classes: [{ identifier: 'fighter', denomination: 'd10', levels: 3 }, { identifier: 'wizard', denomination: 'd6', levels: 6 }],
}))
// An ogre a player runs, its hit dice spent.
add(new Actor5e({ id: 'ogre', name: 'Ogre', owners: ['dave'], mods: { con: 3 }, npc: { denomination: 10, max: 7, spent: 7 } }))
// Eowyn, a fighter and paladin, has d10s of two classes: one of the fighter's two left, and the
// paladin's three.
const eowyn = add(new Actor5e({
  id: 'eowyn', name: 'Eowyn', owners: ['dave'], mods: { con: 1 }, hp: { value: 1, max: 60, temp: 0 },
  classes: [{ identifier: 'fighter', denomination: 'd10', levels: 2, spent: 1 }, { identifier: 'paladin', denomination: 'd10', levels: 3 }],
}))

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), refuse: new Map(), features: true, wake: null }
const json = body => ({
  ok: true, status: 200, statusText: 'OK',
  headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
})
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    return (announcing && app.features) ? json({ features: { commands: true } })
      : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    app.polls.push({ body, auth: init.headers.Authorization })
    const refused = app.refuse.get(body.campaign.id)
    if (refused) return { ok: false, status: refused, statusText: '', headers: new Headers() }
    // Held open briefly, unless a roll is waiting or comes.
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
/** A player's roll, as the app hands it over. */
const command = (fields = {}) => ({
  id: `req-${++ids}`, actorId: 'thorin', kind: 'skill', key: 'prc', mode: 0, explicit: false,
  extras: [], dice: [{ faces: 20, results: [14] }], ...fields,
})
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
/** Make a roll from the app, and what came of it. */
async function roll(fields, campaignId = 'camp-a') {
  const asked = command(fields)
  queue(campaignId, asked)
  await until(() => resultFor(asked.id), `the result of ${asked.id}`)
  const result = resultFor(asked.id)
  const message = messages.get(result.data.messageId)
  return { asked, result: result.data, envelope: result, message, roll: message?.rolls[0] }
}
const faces = roll => roll.dice.map(die => die.results.map(r => r.result))

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('combatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret', 'camp-b': 'mirkwood-secret' })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'pip', 'gimli', 'ogre', 'eowyn'], rolls: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'], rolls: false },
])
if (process.env.BREAK_ROLL) {
  // A Foundry whose dice don't go through _roll, as another version's might not.
  foundry.dice.terms.DiceTerm.prototype.roll = async function () {
    const rolled = { result: this.randomFace(), active: true }
    this.results.push(rolled)
    return rolled
  }
}
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
if (process.env.BREAK_ROLL) {
  await settle(); await settle()
  assert.deepEqual([diceStatus.ready, diceStatus.reason], [false, 'self-test'])
  const said = app.events.filter(e => e.type === 'bridge.hello').map(e => e.data.features.rolls)
  assert.deepEqual(said[0], { enabled: false, kinds: [], reason: 'self-test', modifiers: false, areaAttacks: false, prompts: false, activityChecks: false, signedDice: false, selfTargets: false, gmRolls: false, gmRollMessages: false, manualDice: false, midiPrompts: false })
  assert.equal(app.polls.length, 0)
  // The settings window says why on each campaign's Player actions tab.
  const win = await openSettings()
  await view(win, 'campaign', { campaignId: 'camp-a', tab: 'actions' })
  assert.match(find(win, '.sending-stone-warning').textContent, /Config\.Actions\.Unavailable.*Config\.Actions\.RollsReason\.self-test/)
  assert.match((await win._prepareContext()).campaign.rollsUnavailable, /Config\.Actions\.Unavailable.*RollsReason\.self-test/)
  await win.close()
  ok("a failed self-test keeps players' rolls in the app, saying why in the hello and in the settings window")
  process.exit(0)
}
await until(() => app.polls.length > 0, 'the first fetch')

const checks = ['skill', 'tool', 'ability', 'save', 'death', 'initiative', 'hitDie', 'hitDice', 'formula']
// Ending a concentration is offered wherever rolls are made (module 0.29.0); spending charges and
// Heroic Inspiration only where the campaign lets its players attack, which this one doesn't.
// Changed on purpose (round 0.36.0 §6.13): ending a turn is offered wherever rolls are made, right
// after ending a concentration.
// Changed on purpose (round 0.36.0 §6.14): and taking one back, right after it.
const concentration = ['endConcentration', 'endTurn', 'undoEndTurn']
// A description's own roll is offered with the rest; asking the table needs dnd5e's roll labels, and
// a description's damage the attack self-test, which this world has neither of.
const texts = ['textRoll']
const hellos = Object.fromEntries(app.events.filter(e => e.type === 'bridge.hello').map(e => [e.campaign.title, e.data.features]))
if (process.env.BREAK_MIN) {
  // A Foundry whose min modifier does nothing can't raise a hit die to the least it heals.
  assert.deepEqual([diceStatus.ready, diceStatus.hitDice], [true, false])
  assert.match(diceStatus.hitDiceError, /hit die, 1d8min4 - 3, came to -1/)
  assert.deepEqual(hellos.Ashlands.rolls.kinds, [...checks.filter(kind => !['hitDie', 'hitDice'].includes(kind)), ...concentration, 'textRoll'])
  const spent = await roll({ actorId: 'gimli', kind: 'hitDie', key: undefined, denomination: 'd10', dice: [{ faces: 10, results: [5] }] })
  assert.deepEqual([spent.result.status, spent.result.reason, spent.message], ['failed', 'self-test', undefined])
  const many = await roll({
    actorId: 'gimli', kind: 'hitDice', key: undefined, hitDice: [{ denomination: 'd10', count: 2 }], dice: [{ faces: 10, results: [5, 6] }],
  })
  assert.deepEqual([many.result.status, many.result.reason, many.result.spent, many.message], ['failed', 'self-test', undefined, undefined])
  assert.deepEqual([gimli.classes.fighter.system.hd.spent, gimli.system.attributes.hp.value], [0, 10])
  const checked = await roll({ dice: [{ faces: 20, results: [14] }] })
  assert.equal(checked.result.status, 'done')
  ok("a failed hit die self-test keeps hit dice in the app, one or several at once, and only them")
  process.exit(0)
}
if (process.env.BREAK_REROLL) {
  // A Foundry that rolls a reroll or an explosion as a first throw gives it the player's next die,
  // which belongs to the dice after: the 6 for the exploding d6 goes to the reroll of the 1, so the
  // exploding d6 is thrown with the player's next die, a 1, and nothing explodes.
  assert.deepEqual([diceStatus.ready, diceStatus.hitDice, diceStatus.attacks, diceStatus.modifiers], [true, true, false, false])
  assert.equal(diceStatus.attacksError, '2d6r<=2 + 1d8 + 1d6x + 4d6kh3 threw [1] for its exploding d6, not the player\'s 6, exploded')
  assert.deepEqual(hellos.Ashlands.rolls.kinds, [...checks, ...concentration, ...texts])
  ok("a Foundry that rolls a reroll or an explosion as a first throw fails the attack self-test: players' checks are still made here, their attacks and damage aren't")
  process.exit(0)
}
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.equal(diceStatus.hitDice, true, `hit die self-test: ${diceStatus.hitDiceError}`)
// Under dnd5e 5.x, a check activity's checks may be rolled for it (module 0.21.0); attacks needn't be.
// Since module 0.32.0 `features.transfers` says whether a party's things may be sent and distributed,
// and since 0.33.0 `features.removals` that an item may be removed from a character, with no switch;
// since 0.34.0 `features.notes` that journal notes are kept, under any system, with none made yet.
// Changed on purpose (round 0.36.0 §4.1, §6.12): `features.companions` says the kinds a companion's
// rolls take, the campaign's less the seven only a character takes, and that each rolls its own
// initiative; attacks are off here, so there's no damage on its own or recharge.
// Changed on purpose (round 0.36.0 §6.13): nor ending a turn, which is the character's to do.
// Changed on purpose (round 0.36.0 §6.14): nor taking one back.
// Changed on purpose (round 0.37.0 §6.7): `features.favorites` says favorites are added and removed
// here, under dnd5e, with no switch, whatever the rolls.
// Changed on purpose (round 0.38.0 §D8.3): `features.dishes` says no dishes from the Magical Recipe
// Book are taken, the campaign's switch off, after favorites.
// Changed on purpose (round 0.39.0 §1.9): `features.effects` says its players change none of their
// own effects, the campaign's switch off, after dishes.
// Changed on purpose (round 0.40.0 §10.2): `features.wildShape` says its players use no Wild Shape
// from the app, the campaign's switch off, after effects.
const UNTAKEN = ['inspiration', 'hitDie', 'hitDice', 'spend', 'transfer', 'remove', 'note', 'endTurn', 'undoEndTurn']
assert.deepEqual(hellos, {
  Ashlands: { rolls: { enabled: true, kinds: [...checks, ...concentration, ...texts], reason: null, modifiers: false, areaAttacks: false, prompts: false, activityChecks: true, signedDice: true, selfTargets: false, gmRolls: true, gmRollMessages: true, manualDice: false, midiPrompts: false }, transfers: { enabled: false, kinds: [], reason: 'off', partySends: false, distribute: false }, removals: { enabled: true, kinds: ['remove'], reason: null }, notes: { enabled: true, kinds: ['personal', 'party'], reason: null, journals: [], orders: true, changes: true }, companions: { kinds: [...checks, ...concentration, ...texts].filter(kind => !UNTAKEN.includes(kind)), initiative: 'own' }, favorites: { enabled: true, kinds: ['favorite'], reason: null }, dishes: { enabled: false, kinds: [], reason: 'off', versions: [] }, effects: { enabled: false, kinds: [], reason: 'off' }, wildShape: { enabled: false, kinds: [], reason: 'off' } },
  Mirkwood: { rolls: { enabled: false, kinds: [], reason: 'off', modifiers: false, areaAttacks: false, prompts: false, activityChecks: false, signedDice: false, selfTargets: false, gmRolls: false, gmRollMessages: false, manualDice: false, midiPrompts: false }, transfers: { enabled: false, kinds: [], reason: 'off', partySends: false, distribute: false }, removals: { enabled: true, kinds: ['remove'], reason: null }, notes: { enabled: true, kinds: ['personal', 'party'], reason: null, journals: [], orders: true, changes: true }, companions: { kinds: [], initiative: 'own' }, favorites: { enabled: true, kinds: ['favorite'], reason: null }, dishes: { enabled: false, kinds: [], reason: 'off', versions: [] }, effects: { enabled: false, kinds: [], reason: 'off' }, wildShape: { enabled: false, kinds: [], reason: 'off' } },
})
ok("passes its self-test, hit dice's too, and tells each campaign whether its players' rolls are made here: a utility's formula always, a hit die once its self-test has passed, a check activity's checks under dnd5e 5, and the Gamemaster's as a character wherever rolls are made")
if (process.env.LIBWRAPPER) {
  assert.deepEqual(wrapped, [
    { pkg: 'sending-stone', target: 'foundry.dice.terms.DiceTerm.prototype._roll', type: 'MIXED' },
    { pkg: 'sending-stone', target: 'foundry.dice.Roll.prototype.evaluate', type: 'WRAPPER' },
  ])
  ok('wraps the dice through libWrapper when it is active')
}

await settle()
assert.ok(app.polls.every(p => p.body.campaign.id === 'camp-a'))
assert.deepEqual(app.polls[0].body, {
  protocol: 2, session: app.events[0].session, campaign: { id: 'camp-a', title: 'Ashlands' },
})
assert.equal(app.polls[0].auth, 'Bearer ashlands-secret')
ok("fetches only for a campaign that takes players' rolls, once the app says it has them, with its secret")

// ---- Checks and saves ----
let made = await roll({ dice: [{ faces: 20, results: [14] }] })
assert.equal(made.result.status, 'done')
assert.deepEqual(faces(made.roll), [[14]])
assert.equal(made.roll.formula, '1d20 + 2 + 3')
assert.equal(made.roll.total, 19)
assert.equal(made.message.author.id, 'alice')
assert.equal(made.message.speaker.actor, 'thorin')
assert.deepEqual(made.message.flags['sending-stone'], { request: made.asked.id })
assert.deepEqual(made.message.whisper, [])
assert.equal(made.envelope.sequence, null)
assert.deepEqual(made.result.rolls.map(r => [r.formula, r.total, r.dice[0].results]), [['1d20 + 2 + 3', 19, [{ result: 14, active: true }]]])
assert.equal(made.result.visible, true)
assert.equal(made.result.messageId, made.message.id)
const order = app.events.map(e => e.type === 'chat.message.created' ? `chat ${e.data.message.id}` : e.type === 'command.result' ? `result ${e.data.id}` : null).filter(Boolean)
assert.ok(order.indexOf(`chat ${made.message.id}`) < order.indexOf(`result ${made.asked.id}`))
ok("makes a skill check with the player's d20, as the player, shown to all, and tells the app after the chat")

made = await roll({ mode: 1, explicit: true, dice: [{ faces: 20, results: [17, 3] }] })
assert.deepEqual(faces(made.roll), [[17, 3]])
assert.equal(made.roll.hasAdvantage, true)
assert.equal(made.roll.total, 22)
ok('rolls with advantage when the player chose it, with both their d20s')

made = await roll({ key: 'ath', mode: 0, explicit: true, dice: [{ faces: 20, results: [12] }] })
assert.equal(made.roll.hasAdvantage, false)
assert.deepEqual(faces(made.roll), [[12]])
ok("rolls normally when the player chose to, whatever advantage the sheet gives")

made = await roll({ key: 'ath', mode: 0, explicit: false, dice: [{ faces: 20, results: [9] }] })
assert.equal(made.roll.hasAdvantage, true)
assert.equal(made.roll.dice[0].results.length, 2)
assert.equal(made.roll.dice[0].results[0].result, 9)
ok('a tap rolls as the sheet in the game has it: advantage the app missed takes a second d20 from Foundry')

made = await roll({ mode: 1, explicit: false, dice: [{ faces: 20, results: [17, 3] }] })
assert.equal(made.roll.hasAdvantage, false)
assert.deepEqual(faces(made.roll), [[17]])
ok("advantage the game doesn't give leaves the player's second d20 unused")

thorin.system.bonuses.abilities.check = '1d4'
made = await roll({
  explicit: true,
  extras: [{ sign: 1, count: 1, sides: 4 }, { sign: -1, flat: 1 }, { sign: 1, count: 2, sides: 6 }],
  dice: [{ faces: 20, results: [10] }, { faces: 4, results: [2] }, { faces: 6, results: [5, 1] }],
})
thorin.system.bonuses.abilities.check = ''
assert.match(made.roll.formula, /^1d20 \+ 1d4 - 1 \+ 2d6 \+ 2 \+ 3 \+ 1d4$/)
assert.deepEqual(faces(made.roll).slice(0, 3), [[10], [2], [5, 1]])
assert.equal(made.roll.dice[3].results.length, 1)
assert.equal(made.roll.total, 10 + 2 - 1 + 6 + 2 + 3 + made.roll.dice[3].results[0].result)
ok("adds what the player added, with their dice, ahead of the game's own bonus dice, such as Bless's d4, which Foundry rolls")

thorin.flags.dnd5e.halflingLucky = true
made = await roll({ dice: [{ faces: 20, results: [1] }] })
thorin.flags.dnd5e.halflingLucky = false
assert.deepEqual(made.roll.dice[0].results.map(r => [r.result, r.active]).slice(0, 1), [[1, false]])
assert.equal(made.roll.dice[0].results.length, 2)
assert.equal(made.roll.dice[0].results[1].active, true)
ok("a Halfling's reroll of the player's 1 is Foundry's")

thorin.flags.dnd5e.elvenAccuracy = true
made = await roll({ mode: 1, explicit: true, dice: [{ faces: 20, results: [6, 4] }] })
thorin.flags.dnd5e.elvenAccuracy = false
assert.equal(made.roll.dice[0].results.length, 3)
assert.deepEqual(made.roll.dice[0].results.slice(0, 2).map(r => r.result), [6, 4])
ok("Elven Accuracy's third d20 is Foundry's")

made = await roll({ kind: 'tool', key: 'thief', dice: [{ faces: 20, results: [8] }] })
assert.deepEqual([made.result.status, made.message.flags.dnd5e.roll.type, faces(made.roll)], ['done', 'tool', [[8]]])
made = await roll({ kind: 'ability', key: 'str', dice: [{ faces: 20, results: [5] }] })
assert.deepEqual([made.message.flags.dnd5e.roll.type, made.roll.total], ['ability', 9])
made = await roll({ kind: 'save', key: 'con', dice: [{ faces: 20, results: [11] }] })
assert.deepEqual([made.message.flags.dnd5e.roll.type, made.roll.formula, made.roll.total], ['save', '1d20 + 0 + 3', 14])
ok('makes tool checks, ability checks and saving throws')

made = await roll({ actorId: 'vex', dice: [{ faces: 20, results: [3] }] })
assert.equal(made.message.author.id, 'bob')
made = await roll({ actorId: 'pip', dice: [{ faces: 20, results: [3] }] })
assert.equal(made.message.author.id, 'gm')
ok("is made as the character's player: the one it's assigned to, else its only player, else the Gamemaster")

// ---- Death saving throws ----
thorin.system.attributes.hp.value = 0
thorin.system.attributes.death.success = 1
made = await roll({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [15] }] })
assert.deepEqual(faces(made.roll), [[15]])
assert.equal(made.message.flags.dnd5e.roll.type, 'death')
assert.equal(thorin.system.attributes.death.success, 2)
made = await roll({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [20] }] })
assert.equal(thorin.system.attributes.hp.value, 1)
ok('makes death saving throws, which mark successes and revive on a 20, as dnd5e does')

made = await roll({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [15] }] })
assert.deepEqual([made.result.status, made.result.reason], ['failed', 'not-dying'])
assert.deepEqual(deathWarnings, [])
ok("refuses a death saving throw a character doesn't need, without dnd5e warning the Gamemaster")

// ---- Initiative ----
const fight = combat('cmbt1')
const goblin = combatant(fight, 'c-gob', null, { initiative: 15 })
const thorinTurn = combatant(fight, 'c-thorin', thorin)
fight.rollInitiative = rollCombatInitiative
Object.defineProperty(game, 'combat', { get: () => game.combats.get('cmbt1'), configurable: true })
made = await roll({ kind: 'initiative', key: undefined, combatId: 'cmbt1', mode: 1, explicit: true, dice: [{ faces: 20, results: [4, 16] }] })
assert.equal(made.result.status, 'done')
assert.deepEqual(faces(made.roll), [[4, 16]])
assert.equal(thorinTurn.initiative, 17)
assert.equal(made.message.author.id, 'alice')
assert.equal(made.message.flags['core.initiativeRoll'], true)
assert.deepEqual(made.message.whisper, [])
assert.equal(thorin._cachedInitiativeRoll, undefined)
assert.equal(goblin.initiative, 15)
ok("rolls initiative in the combat, with the player's dice, as dnd5e's initiative dialog would")

made = await roll({ kind: 'initiative', key: undefined, combatId: 'cmbt1', dice: [{ faces: 20, results: [9] }] })
assert.deepEqual([made.result.status, made.result.reason], ['failed', 'already-rolled'])
made = await roll({ kind: 'initiative', key: undefined, combatId: 'cmbt-other', dice: [{ faces: 20, results: [9] }] })
assert.deepEqual([made.result.status, made.result.reason], ['failed', 'not-in-combat'])
made = await roll({ actorId: 'vex', kind: 'initiative', key: undefined, combatId: 'cmbt1', dice: [{ faces: 20, results: [9] }] })
assert.deepEqual([made.result.status, made.result.reason], ['failed', 'not-in-combat'])
ok('refuses initiative already rolled, or for a combat the character is not in')

// ---- Hit dice ----
const hitDie = (denomination, rolled, fields = {}) => roll({
  actorId: 'gimli', kind: 'hitDie', key: undefined, denomination, dice: [{ faces: Number(denomination.slice(1)), results: [rolled] }], ...fields,
})
const spentOf = () => [gimli.classes.fighter.system.hd.spent, gimli.classes.wizard.system.hd.spent]
const hpOf = actor => actor.system.attributes.hp.value
// A module asking for dnd5e's roll dialog, which a player's hit die never opens.
const ask = (config, dialog) => { dialog.configure = true }
Hooks.on('dnd5e.preRollHitDieV2', ask)
made = await hitDie('d10', 7)
Hooks.off('dnd5e.preRollHitDieV2', ask)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.roll.formula, made.roll.total, faces(made.roll)], ['1d10 + 2', 9, [[7]]])
assert.deepEqual([made.result.healed, made.result.hitDie, hpOf(gimli), spentOf()], [9, undefined, 19, [1, 0]])
assert.deepEqual(made.result.rolls.map(r => [r.formula, r.total, r.dice[0].results]), [['1d10 + 2', 9, [{ result: 7, active: true }]]])
assert.equal(made.message.flags.dnd5e.roll.type, 'hitDie')
assert.equal(made.roll.options.rollType, 'hitDie')
assert.deepEqual(made.message.flags['sending-stone'], { request: made.asked.id })
assert.deepEqual([made.message.author.id, made.message.speaker.actor, made.message.whisper], ['carol', 'gimli', []])
assert.deepEqual([globalThis.__dialogs ?? [], gmErrors], [[], []])
ok("spends a hit die with the player's die, healing the character as dnd5e does, as its player, shown to all, without dnd5e's dialog; its card says it's a hit die")

gimli.system.abilities.con.mod = -3
made = await hitDie('d6', 1)
assert.deepEqual([made.roll.formula, made.roll.total, faces(made.roll), made.result.healed], ['1d6min4 - 3', 1, [[1]], 1])
made = await hitDie('d6', 6)
assert.deepEqual([made.roll.total, made.result.healed], [3, 3])
dnd5e.settings.rulesVersion = 'legacy'
made = await hitDie('d6', 2)
dnd5e.settings.rulesVersion = 'modern'
assert.deepEqual([made.roll.formula, made.roll.total, made.result.healed], ['1d6min3 - 3', 0, 0])
assert.deepEqual([hpOf(gimli), spentOf()], [23, [1, 3]])
gimli.system.abilities.con.mod = 2
ok("a hit die heals at least 1, or 0 under the legacy rules, as dnd5e's does, its die raised to reach it")

// A module raising the least a hit die heals, as the Durable feat does.
const durable = config => { config.rolls[0].parts = ['max(5, 1d6 + @abilities.con.mod)'] }
Hooks.on('dnd5e.preRollHitDieV2', durable)
made = await hitDie('d6', 1)
Hooks.off('dnd5e.preRollHitDieV2', durable)
assert.deepEqual([made.roll.formula, made.roll.total, made.result.healed], ['1d6min3 + 2', 5, 5])
// A module setting the hit die's roll out of the player's reach, inside a function.
const hidden = config => { config.rolls[0].parts = ['max(1, 1d6 + @abilities.con.mod) + 1d4'] }
Hooks.on('dnd5e.preRollHitDieV2', hidden)
const unhealed = [hpOf(gimli), spentOf(), messages.size]
made = await hitDie('d6', 4)
Hooks.off('dnd5e.preRollHitDieV2', hidden)
assert.deepEqual([made.result.status, made.result.reason, made.message], ['failed', 'dice', undefined])
assert.deepEqual([hpOf(gimli), spentOf(), messages.size], unhealed)
// A module keeping dnd5e from healing and spending, as its hook lets one.
const keep = () => false
Hooks.on('dnd5e.rollHitDieV2', keep)
made = await hitDie('d6', 4)
Hooks.off('dnd5e.rollHitDieV2', keep)
assert.deepEqual([made.result.status, made.result.healed, made.roll.total], ['done', 0, 6])
assert.deepEqual([hpOf(gimli), spentOf()], unhealed.slice(0, 2))
ok("a module's change to the hit die is kept where the player's die still reaches it; one that keeps it from it calls the roll off; one that keeps dnd5e from healing heals nothing")

gimli.system.attributes.hp.value = 38
made = await hitDie('d10', 10)
assert.deepEqual([made.roll.total, made.result.healed, hpOf(gimli)], [12, 2, 40])
ok("tells the app the hit points a hit die gained, no more than the character had lost")

const last = [command({ actorId: 'gimli', kind: 'hitDie', key: undefined, denomination: 'd10', dice: [{ faces: 10, results: [3] }] }),
  command({ actorId: 'gimli', kind: 'hitDie', key: undefined, denomination: 'd10', dice: [{ faces: 10, results: [4] }] })]
queue('camp-a', ...last)
await until(() => resultFor(last[0].id) && resultFor(last[1].id), 'two hit dice')
assert.deepEqual(last.map(asked => [resultFor(asked.id).data.status, resultFor(asked.id).data.reason]), [['done', null], ['failed', 'no-hit-dice']])
for (const [fields, why] of [[{ denomination: 'd8', dice: [{ faces: 8, results: [3] }] }, "a size it hasn't"], [{ actorId: 'ogre' }, "an NPC's, spent"]]) {
  made = await hitDie('d10', 5, fields)
  assert.deepEqual([made.result.status, made.result.reason, made.message], ['failed', 'no-hit-dice', undefined], why)
}
assert.deepEqual([spentOf()[0], gmErrors], [3, []])
ok("refuses a hit die the character hasn't left, before dnd5e would tell the Gamemaster so")

for (const [fields, error] of [
  [{ dice: [{ faces: 8, results: [3] }] }, 'dice'],
  [{ dice: [{ faces: 10, results: [3, 4] }] }, 'dice'],
  [{ dice: [{ faces: 10, results: [3] }, { faces: 4, results: [1] }] }, 'dice'],
  [{ dice: [] }, 'dice'],
  [{ denomination: 'd7', dice: [{ faces: 7, results: [3] }] }, 'denomination'],
  [{ denomination: undefined }, 'denomination'],
  [{ mode: 1 }, 'mode'],
  [{ explicit: true }, 'mode'],
  [{ extras: [{ sign: 1, flat: 1 }] }, 'extras'],
  [{ prompt: 'abc-def' }, 'prompt'],
]) {
  made = await hitDie('d10', 5, fields)
  assert.deepEqual([made.result.status, made.result.reason, made.result.error], ['failed', 'invalid', error], JSON.stringify(fields))
}
ok("refuses a hit die without the one die of its size, or with advantage or anything added")

// ---- Hit dice spent at once ----
const fighter = gimli.classes.fighter.system.hd
const wizard = gimli.classes.wizard.system.hd
/** Gimli's hit dice, spent at once: each size with the dice rolled of it, such as ['d10', [7, 3]]. */
const hitDice = (sizes, fields = {}) => roll({
  actorId: 'gimli', kind: 'hitDice', key: undefined,
  hitDice: sizes.map(([denomination, results]) => ({ denomination, count: results.length })),
  dice: sizes.map(([denomination, results]) => ({ faces: Number(denomination.slice(1)), results })), ...fields,
})
const cardsOf = id => [...messages.values()].filter(m => m.flags['sending-stone']?.request === id)
const resultsOf = id => results().filter(e => e.data.id === id)
/** Gimli as each check starts: no dice spent, 10 hit points of 40, a Constitution of +2, the modern rules. */
const rested = (hp = 10) => {
  Object.assign(fighter, { spent: 0 })
  Object.assign(wizard, { spent: 0 })
  gimli.system.attributes.hp.value = hp
  gimli.system.abilities.con.mod = 2
  dnd5e.settings.rulesVersion = 'modern'
}
rested()
let many = await hitDice([['d10', [7, 3]], ['d6', [5]]])
let cards = cardsOf(many.asked.id)
assert.deepEqual(cards.map(m => [m.flags['sending-stone'], m.flags.dnd5e.roll.type, m.author.id, m.rolls.length, m.rolls[0].formula, m.rolls[0].total, faces(m.rolls[0])]), [
  [{ request: many.asked.id }, 'hitDie', 'carol', 1, '1d10 + 2', 9, [[7]]],
  [{ request: many.asked.id }, 'hitDie', 'carol', 1, '1d10 + 2', 5, [[3]]],
  [{ request: many.asked.id }, 'hitDie', 'carol', 1, '1d6 + 2', 7, [[5]]],
])
assert.deepEqual([spentOf(), hpOf(gimli)], [[2, 1], 31])
assert.deepEqual(
  [many.result.status, many.result.reason, many.result.error, many.result.visible, many.result.healed, many.result.spent, many.result.messageId],
  ['done', null, null, true, 21, { count: 3, made: 3 }, cards[2].id],
)
assert.deepEqual(many.result.rolls.map(r => [r.formula, r.total, r.dice[0].results.map(d => d.result)]), [['1d10 + 2', 9, [7]], ['1d10 + 2', 5, [3]], ['1d6 + 2', 7, [5]]])
await settle()
assert.deepEqual([resultsOf(many.asked.id).length, gmErrors], [1, []])
ok("spends hit dice of two sizes at once, a die at a time, each on a card of its own with the player's die, in the order rolled, and tells the app once, with every roll, the hit points gained and how many were spent")

// Refused before any is spent: more of a size than are left, a size it hasn't, an NPC's spent, or at full hit points.
fighter.spent = 2
const unspent = [spentOf(), hpOf(gimli), messages.size]
for (const [sizes, fields, reason, why] of [
  [[['d10', [5, 5]]], {}, 'no-hit-dice', 'more than it has left'],
  [[['d8', [5]]], {}, 'no-hit-dice', "a size it hasn't"],
  [[['d10', [5]]], { actorId: 'ogre' }, 'no-hit-dice', "an NPC's, spent"],
  [[['d10', [5, 5]], ['d6', [5]]], {}, 'no-hit-dice', 'more of one of its sizes than it has left'],
]) {
  many = await hitDice(sizes, fields)
  assert.deepEqual([many.result.status, many.result.reason, many.message, 'spent' in many.result, 'healed' in many.result], ['failed', reason, undefined, false, false], why)
}
assert.deepEqual([spentOf(), hpOf(gimli), messages.size], unspent)
gimli.system.attributes.hp.value = 40
many = await hitDice([['d6', [5]]])
assert.deepEqual([many.result.status, many.result.reason, many.message, 'spent' in many.result], ['failed', 'full-hp', undefined, false])
assert.deepEqual([spentOf(), messages.size, gmErrors], [unspent[0], unspent[2], []])
ok("refuses hit dice the character hasn't all left, or at full hit points, before any is spent or dnd5e would tell the Gamemaster so")

for (const [fields, error] of [
  [{ denomination: 'd10' }, 'denomination'],
  [{ hitDice: undefined }, 'hit-dice'],
  [{ hitDice: [] }, 'hit-dice'],
  [{ hitDice: [{ denomination: 'd7', count: 1 }], dice: [{ faces: 7, results: [3] }] }, 'hit-dice'],
  [{ hitDice: [{ denomination: 10, count: 1 }] }, 'hit-dice'],
  [{ hitDice: [{ denomination: 'd10', count: 0 }], dice: [] }, 'hit-dice'],
  [{ hitDice: [{ denomination: 'd10', count: 1.5 }] }, 'hit-dice'],
  [{ hitDice: [{ denomination: 'd10', count: 1 }, { denomination: 'd10', count: 1 }], dice: [{ faces: 10, results: [3] }, { faces: 10, results: [4] }] }, 'hit-dice'],
  [{ hitDice: [{ denomination: 'd10', count: 11 }, { denomination: 'd6', count: 10 }], dice: [{ faces: 10, results: Array(11).fill(3) }, { faces: 6, results: Array(10).fill(3) }] }, 'hit-dice'],
  [{ hitDice: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'd4'].map(denomination => ({ denomination, count: 1 })) }, 'hit-dice'],
  [{ dice: [] }, 'dice'],
  [{ dice: [{ faces: 10, results: [3] }, { faces: 6, results: [3] }] }, 'dice'],
  [{ dice: [{ faces: 8, results: [3] }] }, 'dice'],
  [{ dice: [{ faces: 10, results: [3, 4] }] }, 'dice'],
  [{ dice: [{ faces: 10, results: [11] }] }, 'dice'],
  [{ hitDice: [{ denomination: 'd10', count: 1 }, { denomination: 'd6', count: 1 }], dice: [{ faces: 6, results: [3] }, { faces: 10, results: [4] }] }, 'dice'],
  [{ mode: 1 }, 'mode'],
  [{ explicit: true }, 'mode'],
  [{ extras: [{ sign: 1, flat: 1 }] }, 'extras'],
  [{ prompt: 'abc-def' }, 'prompt'],
]) {
  many = await hitDice([['d10', [5]]], fields)
  assert.deepEqual([many.result.status, many.result.reason, many.result.error, 'spent' in many.result], ['failed', 'invalid', error, false], JSON.stringify(fields))
}
assert.deepEqual([spentOf(), messages.size], [unspent[0], unspent[2]])
ok("refuses hit dice without each size once, its count and the dice rolled of it, more than 20 at once, or with a size of their own, advantage or anything added")

// A module calling the second die off, as dnd5e's hook lets one.
rested()
let calls = 0
const offSecond = () => (++calls === 2) ? false : undefined
Hooks.on('dnd5e.preRollHitDieV2', offSecond)
many = await hitDice([['d6', [4, 5, 6]]])
Hooks.off('dnd5e.preRollHitDieV2', offSecond)
assert.deepEqual([many.result.status, many.result.reason, many.result.spent, many.result.rolls.length, many.result.healed], ['failed', 'cancelled', { count: 3, made: 1 }, 1, 6])
assert.deepEqual([spentOf(), hpOf(gimli), cardsOf(many.asked.id).length, many.result.messageId], [[0, 1], 16, 1, cardsOf(many.asked.id)[0].id])
// A module setting the second die out of the player's reach, inside a function.
calls = 0
const hideSecond = config => { if (++calls === 2) config.rolls[0].parts = ['max(1, 1d6 + @abilities.con.mod) + 1d4'] }
Hooks.on('dnd5e.preRollHitDieV2', hideSecond)
many = await hitDice([['d6', [2, 3]]])
Hooks.off('dnd5e.preRollHitDieV2', hideSecond)
assert.deepEqual([many.result.status, many.result.reason, many.result.spent, many.result.healed], ['failed', 'dice', { count: 2, made: 1 }, 4])
assert.deepEqual([spentOf(), hpOf(gimli), cardsOf(many.asked.id).length], [[0, 2], 20, 1])
// A module keeping dnd5e from spending them: the first die's card is posted, and no more.
const keepAll = () => false
Hooks.on('dnd5e.rollHitDieV2', keepAll)
many = await hitDice([['d6', [4, 5]]])
Hooks.off('dnd5e.rollHitDieV2', keepAll)
assert.deepEqual([many.result.status, many.result.reason, many.result.spent, many.result.healed, many.result.rolls.length], ['failed', 'cancelled', { count: 2, made: 1 }, 0, 1])
assert.deepEqual([spentOf(), hpOf(gimli), cardsOf(many.asked.id).length, gmErrors], [[0, 2], 20, 1, []])
ok("stops at a die a module calls off, sets out of the player's reach or keeps dnd5e from spending, telling the app of those spent before it")

// A module adding a die of the same size to each hit die, in its roll or as a roll of its own: it's
// Foundry's, never the player's next die.
for (const [hook, form] of [
  [config => { config.rolls[0].parts.push('1d10') }, 'in its roll'],
  [config => { config.rolls.push({ parts: ['1d10'] }) }, 'as a roll of its own'],
]) {
  rested(1)
  seedRandom(4242)
  const [[first], [second]] = faces(await new BasicRoll('1d10 + 1d10').evaluate())
  const own = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(value => ![first, second].includes(value)).slice(0, 2)
  seedRandom(4242)
  Hooks.on('dnd5e.preRollHitDieV2', hook)
  many = await hitDice([['d10', own]])
  Hooks.off('dnd5e.preRollHitDieV2', hook)
  cards = cardsOf(many.asked.id)
  const thrown = cards.map(m => m.rolls.flatMap(r => faces(r)))
  assert.deepEqual(thrown, [[[own[0]], [first]], [[own[1]], [second]]], form)
  assert.equal(many.result.status, 'done', form)
  const rolls = cards.flatMap(m => m.rolls)
  assert.equal(many.result.rolls.length, rolls.length, form)
  if (form === 'as a roll of its own') assert.equal(many.result.rolls.length, 2 * many.result.spent.made)
  assert.equal(many.result.healed, Math.min(rolls.reduce((total, r) => total + r.total, 0), 39), form)
  assert.deepEqual([spentOf(), hpOf(gimli)], [[2, 0], 1 + many.result.healed], form)
}
ok("a die of the same size a module adds to each hit die, in its roll or as a roll of its own, is Foundry's, never the player's next; every roll is told the app, and heals")

rested()
gimli.system.abilities.con.mod = -3
dnd5e.settings.rulesVersion = 'legacy'
many = await hitDice([['d6', [2, 5]]])
assert.deepEqual(cardsOf(many.asked.id).map(m => [m.rolls[0].formula, m.rolls[0].total]), [['1d6min3 - 3', 0], ['1d6min3 - 3', 2]])
assert.deepEqual([many.result.status, many.result.healed, spentOf()], ['done', 2, [0, 2]])
rested()
ok("each hit die spent at once heals at least as dnd5e's does, under either rules, its die raised to reach it")

// Hit dice of one size from two classes, as dnd5e spends them: from the first with any left, then the next.
many = await roll({ actorId: 'eowyn', kind: 'hitDice', key: undefined, hitDice: [{ denomination: 'd10', count: 4 }], dice: [{ faces: 10, results: [6, 7, 8, 9] }] })
assert.deepEqual([many.result.status, many.result.spent, many.result.healed], ['done', { count: 4, made: 4 }, 34])
assert.deepEqual([eowyn.classes.fighter.system.hd.spent, eowyn.classes.paladin.system.hd.spent, hpOf(eowyn), cardsOf(many.asked.id).length], [2, 3, 35, 4])
many = await roll({ actorId: 'eowyn', kind: 'hitDice', key: undefined, hitDice: [{ denomination: 'd10', count: 1 }], dice: [{ faces: 10, results: [6] }] })
assert.deepEqual([many.result.status, many.result.reason, many.message, gmErrors], ['failed', 'no-hit-dice', undefined, []])
ok("spends hit dice of one size from each class with them, as dnd5e does, and counts them together beforehand")

rested(38)
many = await hitDice([['d10', [5, 6]]])
assert.deepEqual([many.result.status, many.result.reason, many.result.spent, many.result.healed, many.result.rolls.length], ['failed', 'full-hp', { count: 2, made: 1 }, 2, 1])
assert.deepEqual([spentOf(), hpOf(gimli), cardsOf(many.asked.id).length], [[1, 0], 40, 1])
ok("stops spending hit dice once the character is at full hit points, as dnd5e does on a rest")

// Full as far as dnd5e heals: to the effective maximum, above the maximum under Aid, below it when
// lowered. And a character short of the dice at full hit points hasn't them, first.
rested(40)
gimli.system.attributes.hp.tempmax = 5
many = await hitDice([['d6', [4]]])
assert.deepEqual([many.result.status, many.result.healed, many.result.spent, hpOf(gimli), spentOf()], ['done', 5, { count: 1, made: 1 }, 45, [0, 1]])
rested(30)
gimli.system.attributes.hp.tempmax = -10
many = await hitDice([['d6', [4]]])
assert.deepEqual([many.result.status, many.result.reason, many.message, 'spent' in many.result, hpOf(gimli), spentOf()], ['failed', 'full-hp', undefined, false, 30, [0, 0]])
delete gimli.system.attributes.hp.tempmax
rested(40)
fighter.spent = 3
many = await hitDice([['d10', [5]]])
assert.deepEqual([many.result.status, many.result.reason, many.message, spentOf()], ['failed', 'no-hit-dice', undefined, [3, 0]])
assert.deepEqual(gmErrors, [])
ok("hit dice are full at the effective maximum of hit points, as dnd5e heals them, and refused for want of dice before for being full")

// An NPC a player runs: its own one size, as many as it has left; asked for more, or another size
// besides, refused before any is spent, as dnd5e would tell the Gamemaster it hasn't one part way.
const ogre = actors.get('ogre').system.attributes.hd
ogre.spent = ogre.max - 1
const npcBefore = messages.size
for (const [hitDice, dice, why] of [
  [[{ denomination: 'd10', count: 2 }], [{ faces: 10, results: [3, 4] }], 'more than it has left'],
  [[{ denomination: 'd10', count: 1 }, { denomination: 'd6', count: 1 }], [{ faces: 10, results: [3] }, { faces: 6, results: [4] }], 'another size besides'],
]) {
  many = await roll({ actorId: 'ogre', kind: 'hitDice', key: undefined, hitDice, dice })
  assert.deepEqual([many.result.status, many.result.reason, many.message, 'spent' in many.result], ['failed', 'no-hit-dice', undefined, false], why)
}
assert.deepEqual([ogre.spent, messages.size, gmErrors], [ogre.max - 1, npcBefore, []])
ogre.spent = ogre.max - 2
many = await roll({ actorId: 'ogre', kind: 'hitDice', key: undefined, hitDice: [{ denomination: 'd10', count: 2 }], dice: [{ faces: 10, results: [3, 4] }] })
assert.deepEqual([many.result.status, many.result.spent, many.result.healed, ogre.spent, cardsOf(many.asked.id).map(m => m.rolls[0].total)], ['done', { count: 2, made: 2 }, 10, ogre.max, [6, 7]])
ok("an NPC's hit dice at once are its own size, as many as it has left, or refused before any is spent")

// A card made blind among them, as Midi-QOL can make one: none of their rolls is told the app.
rested()
let blinding = 0
const blindSecond = () => { core.forceBlind = (++blinding === 2) }
Hooks.on('dnd5e.preRollHitDieV2', blindSecond)
many = await hitDice([['d6', [4, 5, 6]]])
Hooks.off('dnd5e.preRollHitDieV2', blindSecond)
core.forceBlind = false
assert.deepEqual(cardsOf(many.asked.id).map(m => m.blind === true), [false, true, false])
assert.deepEqual([many.result.status, many.result.visible, many.result.rolls, many.result.spent, many.result.healed], ['done', false, [], { count: 3, made: 3 }, 21])
ok("hit dice spent at once, one of whose cards the player may not see, are told the app without any of their rolls")

// Stops part way the app is told of all the same: the game failing to save a die, a die spent
// elsewhere meanwhile, the first die called off; and hit points lost meanwhile heal nothing less.
rested()
let saves = 0
gimli.update = async function (changes) {
  if (++saves === 2) throw new Error('The game would not save it')
  return Actor5e.prototype.update.call(this, changes)
}
many = await hitDice([['d6', [4, 5, 6]]])
delete gimli.update
assert.deepEqual(
  [many.result.status, many.result.reason, many.result.error, many.result.spent, many.result.healed, many.result.rolls.length, many.result.messageId],
  ['failed', 'error', 'The game would not save it', { count: 3, made: 1 }, 6, 1, cardsOf(many.asked.id)[0].id],
)
assert.deepEqual([spentOf(), hpOf(gimli), resultsOf(many.asked.id).length], [[0, 1], 16, 1])
rested()
wizard.spent = 4
let elsewhere = 0
const spentElsewhere = () => { if (++elsewhere === 1) wizard.spent += 1 }
Hooks.on('dnd5e.postRollHitDie', spentElsewhere)
many = await hitDice([['d6', [4, 5]]])
Hooks.off('dnd5e.postRollHitDie', spentElsewhere)
assert.deepEqual([many.result.status, many.result.reason, many.result.spent, many.result.healed, spentOf(), gmErrors], ['failed', 'no-hit-dice', { count: 2, made: 1 }, 6, [0, 6], []])
rested()
const offFirst = () => false
Hooks.on('dnd5e.preRollHitDieV2', offFirst)
many = await hitDice([['d6', [4, 5]]])
Hooks.off('dnd5e.preRollHitDieV2', offFirst)
assert.deepEqual(
  [many.result.status, many.result.reason, many.result.spent, 'healed' in many.result, many.result.messageId, many.message, cardsOf(many.asked.id).length],
  ['failed', 'cancelled', { count: 2, made: 0 }, false, null, undefined, 0],
)
assert.deepEqual([spentOf(), hpOf(gimli)], [[0, 0], 10])
rested()
let blows = 0
const struck = () => { if (++blows === 2) gimli.system.attributes.hp.value = 1 }
Hooks.on('dnd5e.preRollHitDieV2', struck)
many = await hitDice([['d6', [1, 1]]])
Hooks.off('dnd5e.preRollHitDieV2', struck)
assert.deepEqual([many.result.status, many.result.healed, hpOf(gimli), spentOf()], ['done', 0, 4, [0, 2]])
rested()
ok("hit dice that stop at an error, at a die spent elsewhere meanwhile or at their first are told the app with how many were spent, and heal no less than nothing")

// Hit dice that take longer than the watchdog: the app is told so, then of those spent before they stopped.
rested()
let slowed = false
gimli.update = async function (changes) {
  if (!slowed) { slowed = true; await new Promise(resolve => realSetTimeout(resolve, 900)) }
  return Actor5e.prototype.update.call(this, changes)
}
const slow = command({ actorId: 'gimli', kind: 'hitDice', key: undefined, hitDice: [{ denomination: 'd6', count: 3 }], dice: [{ faces: 6, results: [2, 3, 4] }] })
queue('camp-a', slow)
await until(() => resultFor(slow.id), 'hit dice taking too long')
const timedOut = resultFor(slow.id).data
assert.deepEqual([timedOut.status, timedOut.reason, 'spent' in timedOut], ['failed', 'timeout', false])
await until(() => resultsOf(slow.id).length === 2, 'the hit dice spent before they stopped')
delete gimli.update
const late = resultsOf(slow.id)[1].data
assert.deepEqual([late.status, late.reason, late.spent, late.healed, late.rolls.length, late.messageId], ['failed', 'timeout', { count: 3, made: 1 }, 4, 1, cardsOf(slow.id)[0].id])
assert.deepEqual([spentOf(), hpOf(gimli), cardsOf(slow.id).length], [[0, 1], 14, 1])
ok("hit dice that take over a minute are told the app as such, stop before their next die, and those spent before are told it after")

// Hit dice then another roll: the roll waits for every hit die.
rested()
const spending = command({ actorId: 'gimli', kind: 'hitDice', key: undefined, hitDice: [{ denomination: 'd6', count: 2 }], dice: [{ faces: 6, results: [1, 2] }] })
const looking = command({ actorId: 'gimli', dice: [{ faces: 20, results: [11] }] })
queue('camp-a', spending, looking)
await until(() => resultFor(spending.id) && resultFor(looking.id), 'hit dice and a check')
assert.deepEqual([resultFor(spending.id).data.status, resultFor(looking.id).data.status], ['done', 'done'])
const posted = [...messages.values()]
const lastCard = Math.max(...cardsOf(spending.id).map(m => posted.indexOf(m)))
assert.ok(lastCard < posted.findIndex(m => m.flags['sending-stone']?.request === looking.id))
assert.equal(cardsOf(spending.id).length, 2)
rested()
ok("a character's roll after hit dice spent at once waits for all of them")

// ---- The Gamemaster's rolls as a character (module 0.23.0) ----
{
  const { findMessage } = await import(`${MODULE}/scripts/command-rolls.mjs`)
  const flagsOf = message => message?.flags['sending-stone']
  const chatOf = (type, id) => app.events.filter(e => e.type === type && e.campaign.id === 'camp-a' && e.data.message?.id === id).map(e => e.data.message)
  const bare = ({ id, messageId, messages, ...rest }) => rest

  // The same check, the player's and then the Gamemaster's, with the same die: only the flags differ.
  const mine = await roll({ dice: [{ faces: 20, results: [12] }] })
  const theirs = await roll({ by: 'gm', dice: [{ faces: 20, results: [12] }] })
  assert.deepEqual(flagsOf(mine.message), { request: mine.asked.id })
  assert.deepEqual(flagsOf(theirs.message), { request: theirs.asked.id, by: 'gm' })
  assert.equal(theirs.message.author.id, 'alice')
  assert.deepEqual(
    [theirs.message.author.id, theirs.message.speaker, theirs.message.flavor, theirs.message.whisper, theirs.message.blind, theirs.roll.total],
    [mine.message.author.id, mine.message.speaker, mine.message.flavor, mine.message.whisper, mine.message.blind, mine.roll.total],
  )
  assert.deepEqual(bare(theirs.result), bare(mine.result))
  assert.deepEqual([theirs.result.messages, 'messages' in mine.result], [[theirs.message.id], false])
  assert.notEqual(theirs.result.messageId, mine.result.messageId)
  const nulled = await roll({ by: null, dice: [{ faces: 20, results: [12] }] })
  assert.deepEqual([nulled.result.status, flagsOf(nulled.message)], ['done', { request: nulled.asked.id }])
  ok("makes the Gamemaster's check as a character as the player's own, the same author, speaker and total, told the app alike, and flags it by the Gamemaster; a by of null is the player's")

  // Its chat event says whose roll it is; a player's says nothing of it.
  assert.deepEqual(chatOf('chat.message.created', theirs.message.id).map(m => m.gmRoll), [theirs.asked.id])
  assert.deepEqual(chatOf('chat.message.created', mine.message.id).map(m => 'gmRoll' in m), [false])
  ok("sends the Gamemaster's roll in chat with gmRoll, its id, and a player's without")

  const before = messages.size
  for (const by of ['player', 'GM', 1, {}, true, '']) {
    made = await roll({ by, dice: [{ faces: 20, results: [12] }] })
    assert.deepEqual([made.result.status, made.result.reason, made.result.error, made.message], ['failed', 'invalid', 'by', undefined], JSON.stringify(by))
  }
  assert.equal(messages.size, before)
  ok('refuses a roll whose by is anything but "gm", absent or null, posting nothing')

  // Every kind here, the Gamemaster's and the player's.
  const kinds = [
    ['save', { kind: 'save', key: 'wis', dice: [{ faces: 20, results: [9] }] }],
    ['tool', { kind: 'tool', key: 'thief', dice: [{ faces: 20, results: [9] }] }],
    ['ability', { kind: 'ability', key: 'str', dice: [{ faces: 20, results: [9] }] }],
  ]
  for (const [what, fields] of kinds) {
    const gm = await roll({ ...fields, by: 'gm' })
    const player = await roll(fields)
    assert.deepEqual([gm.result.status, flagsOf(gm.message)], ['done', { request: gm.asked.id, by: 'gm' }], what)
    assert.deepEqual([player.result.status, flagsOf(player.message)], ['done', { request: player.asked.id }], what)
  }

  // Initiative, in the combat: Vex's, as Bob's, then Pip's player's own.
  const vexTurn = combatant(fight, 'c-vex', vex)
  const pipTurn = combatant(fight, 'c-pip', pip)
  made = await roll({ actorId: 'vex', kind: 'initiative', key: undefined, combatId: 'cmbt1', dice: [{ faces: 20, results: [11] }], by: 'gm' })
  assert.deepEqual([made.result.status, flagsOf(made.message), made.message.author.id, made.message.flags['core.initiativeRoll'], vexTurn.initiative], ['done', { request: made.asked.id, by: 'gm' }, 'bob', true, 14])
  made = await roll({ actorId: 'pip', kind: 'initiative', key: undefined, combatId: 'cmbt1', dice: [{ faces: 20, results: [11] }] })
  assert.deepEqual([made.result.status, flagsOf(made.message), pipTurn.initiative !== null], ['done', { request: made.asked.id }, true])

  // A hit die, and each card of hit dice spent at once.
  rested()
  made = await hitDie('d10', 6, { by: 'gm' })
  assert.deepEqual([made.result.status, flagsOf(made.message), made.message.author.id, made.message.flags.dnd5e.roll.type], ['done', { request: made.asked.id, by: 'gm' }, 'carol', 'hitDie'])
  made = await hitDie('d10', 6)
  assert.deepEqual(flagsOf(made.message), { request: made.asked.id })
  rested()
  many = await hitDice([['d10', [4, 5]], ['d6', [3]]], { by: 'gm' })
  assert.deepEqual([many.result.status, many.result.spent], ['done', { count: 3, made: 3 }])
  assert.deepEqual(cardsOf(many.asked.id).map(flagsOf), Array(3).fill({ request: many.asked.id, by: 'gm' }))
  rested()
  many = await hitDice([['d10', [4]], ['d6', [3]]])
  assert.deepEqual(cardsOf(many.asked.id).map(flagsOf), Array(2).fill({ request: many.asked.id }))
  rested()
  ok("flags the Gamemaster's save, tool and ability checks, initiative, hit die and every card of hit dice spent at once by them, and none of the player's")

  // Death saves: dnd5e 5.3 tells what came of one in a message of its own, which is the
  // Gamemaster's too; the roll is still the message the command made.
  const dying = (failure = 0) => Object.assign(thorin.system.attributes, { hp: { ...thorin.system.attributes.hp, value: 0 }, death: { ...thorin.system.attributes.death, success: 0, failure } })
  const outcomeOf = made => {
    const all = [...messages.values()]
    return all.slice(all.indexOf(made.message) + 1).find(m => m.speaker?.actor === 'thorin' && /DeathSave/.test(m.content))
  }
  dying()
  made = await roll({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [20] }], by: 'gm' })
  let outcome = outcomeOf(made)
  assert.deepEqual([made.result.status, thorin.system.attributes.hp.value, outcome?.content], ['done', 1, 'DND5E.DeathSaveCriticalSuccess'])
  assert.deepEqual(flagsOf(made.message), { request: made.asked.id, by: 'gm' })
  assert.deepEqual(flagsOf(outcome), { outcome: made.asked.id, by: 'gm' })
  assert.equal(findMessage(made.asked.id), made.message)
  assert.equal(made.result.messageId, made.message.id)
  assert.deepEqual(chatOf('chat.message.updated', outcome.id).map(m => m.gmRoll), [made.asked.id])
  const told = app.events.findIndex(e => e.type === 'command.result' && e.data.id === made.asked.id)
  assert.ok(app.events.findIndex(e => e.type === 'chat.message.updated' && e.data.message?.id === outcome.id) < told)
  dying(2)
  made = await roll({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [4] }], by: 'gm' })
  outcome = outcomeOf(made)
  assert.deepEqual([made.result.status, thorin.system.attributes.death.failure, outcome?.content], ['done', 3, 'DND5E.DeathSaveFailure'])
  assert.deepEqual([flagsOf(made.message), flagsOf(outcome), findMessage(made.asked.id)], [{ request: made.asked.id, by: 'gm' }, { outcome: made.asked.id, by: 'gm' }, made.message])
  // One that ends nothing has no message of its own.
  dying()
  const quiet = messages.size
  made = await roll({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [12] }], by: 'gm' })
  assert.deepEqual([made.result.status, thorin.system.attributes.death.success, messages.size, flagsOf(made.message)], ['done', 1, quiet + 1, { request: made.asked.id, by: 'gm' }])
  // The player's: their roll flagged as ever, and dnd5e's message left as dnd5e made it.
  dying()
  made = await roll({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [20] }] })
  outcome = outcomeOf(made)
  assert.deepEqual([flagsOf(made.message), outcome?.content, flagsOf(outcome), findMessage(made.asked.id)], [{ request: made.asked.id }, 'DND5E.DeathSaveCriticalSuccess', undefined, made.message])
  assert.deepEqual(chatOf('chat.message.created', outcome.id).map(m => 'gmRoll' in m), [false])
  assert.equal(registry.get('dnd5e.postRollDeathSave')?.length ?? 0, 0)
  ok("the Gamemaster's death save marks dnd5e 5.3's message of a revival or a death as theirs too, by its outcome, before the app is told, and its roll is still the command's message; the player's is left as dnd5e makes it")

  // ---- The messages a Gamemaster's roll made, listed in its result (module 0.25.0) ----
  // Every message it made, in the order made, as each is sent with gmRoll: its roll, each card of
  // hit dice, a death save's outcome, and on a late result those made by then. Never a player's own
  // message with the roll's flags copied, posted or marked from their browser as each is made, nor
  // another roll's; none at all on a player's roll's result.
  const forged = []
  const forge = (message, _options, userId) => {
    const flags = flagsOf(message)
    if ((userId !== game.user.id) || (flags?.by !== 'gm')) return
    const copy = fakeMessage(`forged${forged.length + 1}`, {
      author: users.get('alice'), speaker: message.speaker, speakerActor: message.speakerActor, flags: { 'sending-stone': { ...flags } },
    })
    forged.push(copy.id)
    Hooks.callAll('createChatMessage', copy, {}, 'alice')
    // The Gamemaster's client may change any message after, as a module may: still not the roll's.
    Hooks.callAll('updateChatMessage', copy, { content: '<p>Seen</p>' }, {}, game.user.id)
    // A player may change their own message's flags too: an earlier one of theirs, marked with the
    // roll's flags from their browser while it's made, isn't the roll's either.
    const mine = fakeMessage(`marked${forged.length + 1}`, { author: users.get('alice'), speaker: message.speaker, speakerActor: message.speakerActor })
    Hooks.callAll('createChatMessage', mine, {}, 'alice')
    forged.push(mine.id)
    Object.assign(mine.flags, { 'sending-stone': { ...flags } })
    Hooks.callAll('updateChatMessage', mine, { flags: { 'sending-stone': { ...flags } } }, {}, 'alice')
  }
  Hooks.on('createChatMessage', forge)
  const gmResults = []
  const byGm = async fields => {
    const done = await roll({ ...fields, by: 'gm' })
    gmResults.push(done.result)
    return done
  }
  made = await byGm({ dice: [{ faces: 20, results: [12] }] })
  assert.deepEqual(made.result.messages, [made.message.id])
  assert.deepEqual(chatOf('chat.message.created', 'forged1').map(m => m.gmRoll), [made.asked.id], 'the copy reaches the app, claiming the roll')
  for (const fields of [{}, { kind: 'save', key: 'wis' }, { kind: 'death', key: undefined }]) {
    const player = await roll({ ...fields, dice: [{ faces: 20, results: [12] }] })
    assert.equal('messages' in player.result, false, JSON.stringify(fields))
  }
  // A death save that ends nothing; one whose outcome dnd5e 5.3 posts, marked after.
  dying()
  made = await byGm({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [12] }] })
  assert.deepEqual(made.result.messages, [made.message.id])
  dying()
  made = await byGm({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [20] }] })
  assert.deepEqual(made.result.messages, [made.message.id, outcomeOf(made).id])
  // Refused, it made none.
  made = await byGm({ kind: 'death', key: undefined, dice: [{ faces: 20, results: [20] }] })
  assert.deepEqual([made.result.status, made.result.reason, made.result.messages], ['failed', 'not-dying', []])
  // Hit dice spent at once: every card, in order.
  rested()
  many = await hitDice([['d10', [4, 5]], ['d6', [3]]], { by: 'gm' })
  gmResults.push(many.result)
  assert.deepEqual(many.result.messages, cardsOf(many.asked.id).map(m => m.id))
  assert.equal(many.result.messages.length, 3)
  rested()
  // Two characters' rolls by the Gamemaster made at once, and a player's: each its own.
  const together = [
    command({ by: 'gm', dice: [{ faces: 20, results: [7] }] }),
    command({ actorId: 'vex', by: 'gm', dice: [{ faces: 20, results: [8] }] }),
    command({ actorId: 'pip', dice: [{ faces: 20, results: [9] }] }),
  ]
  queue('camp-a', ...together)
  await until(() => together.every(asked => resultFor(asked.id)), 'three rolls at once')
  const [ownA, ownB, playerOwn] = together.map(asked => resultFor(asked.id).data)
  gmResults.push(ownA, ownB)
  assert.deepEqual([ownA.messages, ownB.messages, 'messages' in playerOwn], [[ownA.messageId], [ownB.messageId], false])
  assert.notEqual(ownA.messageId, ownB.messageId)
  // Hit dice that take over a minute: the late result lists every card.
  let held = false
  gimli.update = async function (changes) {
    if (!held) { held = true; await new Promise(resolve => realSetTimeout(resolve, 900)) }
    return Actor5e.prototype.update.call(this, changes)
  }
  const slowGm = command({ actorId: 'gimli', kind: 'hitDice', key: undefined, hitDice: [{ denomination: 'd6', count: 3 }], dice: [{ faces: 6, results: [2, 3, 4] }], by: 'gm' })
  queue('camp-a', slowGm)
  await until(() => resultsOf(slowGm.id).length === 2, "the Gamemaster's hit dice, late")
  delete gimli.update
  const [early, lateGm] = resultsOf(slowGm.id).map(e => e.data)
  gmResults.push(early, lateGm)
  assert.deepEqual([early.reason, lateGm.spent, cardsOf(slowGm.id).length], ['timeout', { count: 3, made: 1 }, 1])
  assert.ok(Array.isArray(early.messages) && early.messages.every(id => lateGm.messages.includes(id)))
  assert.deepEqual(lateGm.messages, cardsOf(slowGm.id).map(m => m.id))
  rested()
  // One that made more than 20 messages, as a module posting cards of its own for it here: the
  // first 20, in order.
  const extra = []
  const more = (message, _options, userId) => {
    const flags = flagsOf(message)
    if ((userId !== game.user.id) || (flags?.by !== 'gm') || extra.length) return
    for (let i = 1; i <= 24; i++) {
      const card = fakeMessage(`extra${i}`, { author: users.get('alice'), speaker: message.speaker, flags: { 'sending-stone': { ...flags } } })
      extra.push(card.id)
      Hooks.callAll('createChatMessage', card, {}, game.user.id)
    }
  }
  Hooks.on('createChatMessage', more)
  made = await byGm({ dice: [{ faces: 20, results: [6] }] })
  Hooks.off('createChatMessage', more)
  assert.deepEqual(made.result.messages, [made.message.id, ...extra.slice(0, 19)])
  gmResults.pop()
  Hooks.off('createChatMessage', forge)
  assert.ok((forged.length >= 16) && forged.some(id => id.startsWith('marked')))
  assert.ok(gmResults.every(result => result.messages.every(id => !forged.includes(id) && messages.get(id) && flagsOf(messages.get(id)).by === 'gm')))
  ok("a Gamemaster's roll's result lists every message it made, in order, at most 20: its roll, a death save's outcome, each card of hit dice, those made by its late result, none when refused; never a player's copy posted as it's made, nor another roll's made at once; a player's has none")

  // serializeMessage: gmRoll is the request, use or outcome a message flagged the Gamemaster's names.
  const { serializeMessage } = await import(`${MODULE}/scripts/chat-data.mjs`)
  const { getCampaigns: campaignsNow } = await import(`${MODULE}/scripts/campaigns.mjs`)
  const ashlands = campaignsNow().find(campaign => campaign.id === 'camp-a')
  for (const [flags, gmRoll] of [
    [{ request: 'r-1', by: 'gm' }, 'r-1'], [{ use: 'u-1', by: 'gm' }, 'u-1'], [{ outcome: 'o-1', by: 'gm' }, 'o-1'],
    [{ request: 'r-2', ask: { actorId: 'thorin', text: 'abc', link: 0 }, by: 'gm' }, 'r-2'],
    [{ request: 'r-3' }, undefined], [{ use: 'u-3' }, undefined], [{ by: 'gm' }, undefined], [{ request: 'r-4', by: 'player' }, undefined],
    [{ request: 7, by: 'gm' }, undefined], [null, undefined],
  ]) {
    const serialized = serializeMessage(fakeMessage('m-gm', { flags: flags ? { 'sending-stone': flags } : {} }), ashlands)
    assert.deepEqual(['gmRoll' in serialized, serialized.gmRoll], [gmRoll !== undefined, gmRoll], JSON.stringify(flags))
  }
  ok("a message flagged the Gamemaster's is serialized with gmRoll, the roll, use or outcome it names; a player's or a plain one has none")

  // The badge on the card: "GM" for the Gamemaster's, set as text; the player's as ever; none on another.
  const { window } = new JSDOM('')
  Object.assign(globalThis, { HTMLElement: window.HTMLElement, document: window.document })
  try {
    const { markAppRoll } = await import(`${MODULE}/scripts/command-rolls.mjs`)
    const card = () => {
      const html = window.document.createElement('li')
      html.innerHTML = '<header class="message-header"><span class="message-metadata"><time>now</time></span></header>'
      return html
    }
    const badgeOf = flags => {
      const html = card()
      markAppRoll({ flags: flags ? { 'sending-stone': flags } : {} }, html)
      markAppRoll({ flags: flags ? { 'sending-stone': flags } : {} }, html)
      const badges = html.querySelectorAll('.sending-stone-badge')
      assert.ok(badges.length <= 1)
      const [badge] = badges
      return badge && [badge.className, badge.dataset.tooltip, badge.getAttribute('aria-label'), badge.textContent, badge.querySelector('i') !== null, badge.parentElement.className]
    }
    const gm = ['sending-stone-badge sending-stone-gm', 'SENDINGSTONE.Roll.BadgeGM', 'SENDINGSTONE.Roll.BadgeGM', 'SENDINGSTONE.Roll.GM', true, 'message-metadata']
    const player = ['sending-stone-badge', 'SENDINGSTONE.Roll.Badge', 'SENDINGSTONE.Roll.Badge', '', true, 'message-metadata']
    assert.deepEqual(badgeOf({ request: 'r', by: 'gm' }), gm)
    assert.deepEqual(badgeOf({ use: 'u', by: 'gm' }), gm)
    assert.deepEqual(badgeOf({ outcome: 'o', by: 'gm' }), gm)
    assert.deepEqual(badgeOf({ request: 'r' }), player)
    assert.deepEqual(badgeOf({ use: 'u' }), player)
    assert.equal(badgeOf({}), undefined)
    assert.equal(badgeOf(null), undefined)
    // A translation is set as text, never as markup.
    const localize = game.i18n.localize
    game.i18n.localize = key => (key === 'SENDINGSTONE.Roll.GM') ? '<b>GM</b>' : key
    const html = card()
    markAppRoll({ flags: { 'sending-stone': { request: 'r', by: 'gm' } } }, html)
    game.i18n.localize = localize
    assert.deepEqual([html.querySelector('b'), html.querySelector('.sending-stone-gm span').textContent], [null, '<b>GM</b>'])
  } finally {
    delete globalThis.HTMLElement
    delete globalThis.document
  }
  ok('marks the Gamemaster\'s card "GM", its label theirs, as text; the player\'s as ever; and no card without the flags')
}

// ---- What the player sees ----
core.forceBlind = true
made = await roll({ dice: [{ faces: 20, results: [7] }] })
core.forceBlind = false
assert.deepEqual([made.result.status, made.result.visible, made.result.rolls], ['done', false, []])
assert.equal(made.message.blind, true)
ok('reports a roll made blind, as Midi-QOL can, as made, without its roll')

// ---- Refusals ----
for (const [fields, reason] of [
  [{ actorId: 'stranger' }, 'unknown'],
  [{ actorId: 'nobody' }, 'unknown'],
  [{ key: 'xyz' }, 'unknown'],
  [{ kind: 'tool', key: 'lute' }, 'unknown'],
  [{ dice: [{ faces: 20, results: [21] }] }, 'invalid'],
  [{ dice: [{ faces: 7, results: [3] }] }, 'invalid'],
  [{ extras: [{ sign: 1, count: 1, sides: 4, formula: '99' }, { sign: 1, flat: 101 }] }, 'invalid'],
  [{ kind: 'spell' }, 'invalid'],
  // An attack, for a campaign whose players may roll but not attack from the app.
  [{ kind: 'attack', item: 'axe', activity: 'swing' }, 'attacks-off'],
  [{ mode: 2 }, 'invalid'],
]) {
  made = await roll(fields)
  assert.deepEqual([made.result.status, made.result.reason], ['failed', reason], JSON.stringify(fields))
  assert.equal(made.message, undefined)
}
ok("refuses a character outside the campaign, what it can't roll, and dice no player could roll")

// ---- Only the player's roll gets their dice ----
const before = messages.size
seedRandom(777)
const expected = faces(await new D20Roll('1d20 + 1d4', {}, {}).evaluate())
const old = [...messages.values()].find(m => m.flags['sending-stone']?.request === 'req-1').rolls[0]
seedRandom(777)
const again = old.clone()
assert.equal(again.options.sendingStone, 'req-1')
await again.evaluate()
assert.deepEqual(faces(again)[0], expected[0])
assert.equal(messages.size, before)
ok("a roll whose player's roll was made, rolled again, is Foundry's")

core.interactive = true
const gmRoll = await new D20Roll('1d20', {}, {}).evaluate()
assert.equal(prompts.length, 1)
// Manual dice reach a die through its roll, as in Foundry, so only while the die knows it.
if (!core.omitRoot) assert.deepEqual(faces(gmRoll), [[20]])
made = await roll({ dice: [{ faces: 20, results: [6] }] })
core.interactive = false
assert.equal(prompts.length, 1)
assert.deepEqual(faces(made.roll), [[6]])
ok("a Gamemaster's manual dice don't ask for a player's roll, which has its dice")

// ---- Fetching ----
const twice = command({ dice: [{ faces: 20, results: [13] }] })
queue('camp-a', twice, { ...twice })
await until(() => resultFor(twice.id), 'the duplicate')
await settle(); await settle()
assert.equal(results().filter(e => e.data.id === twice.id).length, 1)
assert.equal([...messages.values()].filter(m => m.flags['sending-stone']?.request === twice.id).length, 1)
ok('makes a roll handed over twice once')

const first = command({ dice: [{ faces: 20, results: [2] }] })
const second = command({ kind: 'save', key: 'wis', dice: [{ faces: 20, results: [19] }] })
const other = command({ actorId: 'vex', dice: [{ faces: 20, results: [18] }] })
queue('camp-a', first, second, other)
await until(() => resultFor(first.id) && resultFor(second.id) && resultFor(other.id), 'three rolls')
const madeAt = id => [...messages.values()].findIndex(m => m.flags['sending-stone']?.request === id)
assert.ok(madeAt(first.id) < madeAt(second.id))
ok("makes a character's rolls in the order they came")

thorin.hang = true
const stuck = command({ dice: [{ faces: 20, results: [2] }] })
const next = command({ kind: 'save', key: 'str', dice: [{ faces: 20, results: [12] }] })
queue('camp-a', stuck, next)
await until(() => resultFor(next.id), 'the roll after a stuck one')
thorin.hang = false
assert.deepEqual([resultFor(stuck.id).data.status, resultFor(stuck.id).data.reason], ['failed', 'timeout'])
assert.equal(resultFor(next.id).data.status, 'done')
ok("tells the app of a roll that takes over a minute, as one a module stopped to ask the Gamemaster about, and goes on")

app.refuse.set('camp-a', 401)
await until(() => app.polls.at(-1).body.campaign.id === 'camp-a' && app.refuse.size && app.polls.length, 'a refused fetch')
await settle(); await settle()
const refusedAt = app.polls.length
await settle(); await settle(); await settle()
assert.equal(app.polls.length, refusedAt)
ok('stops fetching for a campaign the app refuses')

app.refuse.set('camp-a', 500)
const { syncPollers } = await import(`${MODULE}/scripts/commands.mjs`)
syncPollers({ retry: true })
await until(() => app.polls.length >= refusedAt + 3, 'fetches after a failure')
app.refuse.clear()
made = await roll({ dice: [{ faces: 20, results: [16] }] })
assert.equal(made.result.status, 'done')
ok('retries a refused campaign when asked afresh, backs off after failures, and recovers')

// Turned off, its hello says so and its fetching stops; a roll fetched anyway isn't made.
await game.settings.set('sending-stone', 'campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'pip'], rolls: false },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'], rolls: false },
])
await settle(); await settle()
const off = app.events.filter(e => e.type === 'bridge.hello' && e.campaign.id === 'camp-a').at(-1)
// Changed on purpose (round 0.36.0 §4.1, §6.12): with `features.companions`, none taken, each its own roll.
// Changed on purpose (round 0.37.0 §6.7): with `features.favorites`, offered under dnd5e with rolls off.
// Changed on purpose (round 0.38.0 §D8.3): with `features.dishes`, off, after favorites.
// Changed on purpose (round 0.39.0 §1.9): with `features.effects`, off, after dishes.
// Changed on purpose (round 0.40.0 §10.2): with `features.wildShape`, off, after effects.
assert.deepEqual(off.data.features, { rolls: { enabled: false, kinds: [], reason: 'off', modifiers: false, areaAttacks: false, prompts: false, activityChecks: false, signedDice: false, selfTargets: false, gmRolls: false, gmRollMessages: false, manualDice: false, midiPrompts: false }, transfers: { enabled: false, kinds: [], reason: 'off', partySends: false, distribute: false }, removals: { enabled: true, kinds: ['remove'], reason: null }, notes: { enabled: true, kinds: ['personal', 'party'], reason: null, journals: [], orders: true, changes: true }, companions: { kinds: [], initiative: 'own' }, favorites: { enabled: true, kinds: ['favorite'], reason: null }, dishes: { enabled: false, kinds: [], reason: 'off', versions: [] }, effects: { enabled: false, kinds: [], reason: 'off' }, wildShape: { enabled: false, kinds: [], reason: 'off' } })
const offAt = app.polls.length
await settle(); await settle()
assert.equal(app.polls.length, offAt)
const { runRollCommand } = await import(`${MODULE}/scripts/command-rolls.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const refusedRoll = await runRollCommand(command(), getCampaigns()[0])
assert.deepEqual([refusedRoll.status, refusedRoll.reason], ['failed', 'off'])
ok("turned off, a campaign says so in its hello, isn't fetched for, and its rolls aren't made")

// An app that stops saying it has commands isn't fetched from.
await game.settings.set('sending-stone', 'campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'pip'], rolls: true },
])
await until(() => app.polls.length > offAt, 'fetching again')
app.features = false
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const now = Date.now
Date.now = () => now() + 60_000
heartbeat()
Date.now = now
await settle(); await settle()
const silentAt = app.polls.length
await settle(); await settle(); await settle()
assert.ok(app.polls.length <= silentAt + 1)
ok("stops fetching from an app that no longer says it has players' rolls")

// ---- Foundry's dice modifiers, as this stand-in replays them (module 0.22.0) ----
// Each die's first throw, then what its modifiers roll again, in the order Foundry rolls them: the
// sequences the app's own replay of them is checked against (dice-modifiers.test.ts).
{
  const replay = async (formula, first, more) => {
    const roll = new Roll(formula)
    const queue = [...first, ...more]
    roll.terms[0]._roll = () => queue.shift()
    await roll.evaluate({ allowInteractive: false })
    assert.equal(queue.length, 0, `${formula}: every value thrown`)
    return roll.total
  }
  for (const [formula, first, more, total] of [
    ['2d6r<=2', [1, 5], [4], 9], ['2d6r1=1', [1, 1], [3], 4], ['1d6rr<3', [1], [2, 5], 5], ['2d6x', [6, 3], [6, 2], 17],
    ['1d6xo', [6], [6], 12], ['4d6kh3', [1, 2, 3, 4], [], 9], ['3d6dl', [4, 1, 4], [], 8], ['2d6kl', [5, 2], [], 2],
    ['2d6min3', [1, 5], [], 8], ['2d6max4', [6, 2], [], 6], ['6d6cs>=5', [5, 6, 1, 2, 3, 4], [], 2], ['3d6cf<3', [1, 2, 6], [], 2],
    ['2d6kh0', [3, 5], [], 5], ['2d6cs', [6, 6], [], 0],
  ]) assert.equal(await replay(formula, first, more), total, formula)
}
ok("the stand-in replays Foundry's dice modifiers: a reroll once or recursively, an explosion recursively or once, keeping, dropping, raising, lowering and counting")

process.exit(0)
