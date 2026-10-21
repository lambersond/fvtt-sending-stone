// A critical hit's damage made for a player from the app, or planned for one, as dnd5e makes it,
// whatever Midi-QOL's rules for critical hits say (module 0.32.0, its contract §2.5, §3.7, §3.10, C1-C12;
// and the x2 bug's report): each die term's count doubled, never Midi's `mx2`; dnd5e's own settings, an item's
// extra dice and critical damage still applied; a die more made from the roll's terms as they were
// without its critical, so it never doubles what was doubled; and the Gamemaster's own rolls in
// Foundry left to Midi's rule. The real module; dnd5e 5.3.3's real dice classes, or 6.0.5's with
// DND5E6=1; dnd5e's items and attack activities ported (activity5e.mjs); with MIDI=1, midi-fake.mjs's
// workflow and Midi's rules for critical hits from midi-critical.mjs, the Gamemaster's rule
// `doubleDice` and the players' `default`, as the bug's world has them; a stand-in Foundry core and
// app; and a made-up description's damage link (texts-hooks.mjs). Since module 0.33.0 (C13-C16,
// and the 0.33.0 decisions) only a critical hit's dice are doubled for the app, never a number, whatever
// dnd5e's Critical Damage Modifiers, Midi-QOL's rules or the roll's own options say: a flat bonus,
// two numbers, a number in parentheses, which dnd5e 6 copies with a group's dice, a die with
// modifiers beside a number, typed dice, a description's, the Gamemaster's as the character, more
// dice, another die, versatile and every plan of one; Foundry's parentheses stood in for by
// crit-parentheticals.mjs. Since fix-033crit also a function of dice and a number, which dnd5e 6
// copies whole, Foundry's functions stood in for by withFunctions below; critical damage after a
// group; a group's sign; a group within a group; and Powerful Critical's most for a group's extra
// dice. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { settings, user, users, actors } from './stub.mjs'

register('./texts-hooks.mjs', import.meta.url)

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
const DND5E6 = Boolean(process.env.DND5E6)
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'
const DND5E = DND5E6 ? `${DND5E6_ROOT}/module/dice` : `${DND5E5}/module/dice`
const V = (v5, v6) => (DND5E6 ? v6 : v5)
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
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
globalThis.document = { hidden: false }

const { messages } = await import('./dice-core.mjs')
// Foundry's parentheses, before dnd5e's dice take the class as they load (module 0.33.0).
const { installParentheticals } = await import('./crit-parentheticals.mjs')
installParentheticals()
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
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(['slashing', 'piercing', 'fire'].map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' } },
  characterFlags: { elvenAccuracy: { abilities: ['dex', 'int', 'wis', 'cha'] } },
}
settings.set('messageMode', 'gm')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, equip } = await import('./activity5e.mjs')
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
const { midiCritical, installMidiCritical } = await import('./midi-critical.mjs')
// dnd5e publishes its dice as its script loads (dnd5e.mjs:38-43), before any module's init.
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  dice: { DamageRoll },
  documents: { activity: { AttackActivity } },
  registry: {
    messages: {
      get(id, type) {
        return [...messages.values()].filter(m => (m.flags?.dnd5e?.originatingMessage === id) && (m.flags?.dnd5e?.roll?.type === type))
      },
    },
  },
}
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }
// dnd5e 6's localize, as its dnd5e.mjs puts it on globalThis.
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))
foundry.utils.escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
if (MIDI) {
  installMidi()
  // The bug's world: Midi's "Double Rolled Damage" for the Gamemaster, dnd5e's own for players.
  Object.assign(midiCritical, { gm: 'doubleDice', player: 'default' })
}
const add = actor => { actors.set(actor.id, actor); return actor }
const weapon = (id, name, activity, system = {}) => ({
  id, name, type: 'weapon', system: { properties: [], quantity: 1, attackType: 'melee', ...system }, activities: [activity],
})
// Strength 4: a shortsword's 1d6 + 4.
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 4, dex: 2 } }))
alice.character = thorin
equip(thorin, {
  items: [
    weapon('sword', 'Shortsword', { id: 'sword-cut', damage: [{ number: 1, denomination: 6, bonus: '@mod', types: ['slashing'] }] }),
    // A versatile weapon with a flat bonus beside the ability modifier: 1d8 + 4 + 1, or 1d10 + 4 + 1
    // two-handed (module 0.33.0).
    weapon('axe', 'Battleaxe', { id: 'axe-swing', versatile: 10, damage: [{ number: 1, denomination: 8, bonus: '@mod + 1', types: ['slashing'] }] }, { properties: ['ver'] }),
  ],
})
const goblin = add(new Actor5e({ id: 'goblin', name: 'Goblin', mods: {}, hp: { value: 30, max: 30, temp: 0 } }))
goblin.type = 'npc'
equip(goblin, { ac: 13 })
const token = { id: 'tok-goblin', name: 'Goblin', uuid: 'Scene.scene.Token.tok-goblin', actor: goblin, hidden: false }
const placeable = { id: token.id, name: 'Goblin', document: token, actor: goblin }
token.object = placeable
placeables.set(token.id, placeable)
if (MIDI) canvas.scene.tokens.size = placeables.size
const { combat, combatant } = await import('./stub.mjs')
const fight = combat('fight')
combatant(fight, 'cb-thorin', thorin)
combatant(fight, 'cb-gob', goblin, { token })
fight.getCombatantsByActor = actor => fight.combatants.filter(cb => cb.actor?.id === actor.id)
game.combat = fight

// A description of Thorin's, whose link deals a shortsword's damage, by its hash (texts-hooks.mjs).
const fixtures = new Map()
globalThis.textFixtures = fixtures
const TEXT = 'e00000000000c1'
const origin = { name: 'Shortsword', item: thorin.items.get('sword') }
fixtures.set(TEXT, (who, n) => {
  if (who.id !== 'thorin') return { refusal: 'gone' }
  // Since module 0.33.0 also two numbers, and a die with modifiers beside a number.
  const links = ['1d6 + 4', '1d6 + 4 + 2', '1d6r1 + 3'].map(formula => ({ kind: 'damage', parts: [{ formula, types: ['slashing'] }], healing: false }))
  return links[n] ? { source: { html: '', relativeTo: origin.item }, origin, link: links[n] } : { refusal: 'link' }
})

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), wake: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
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
const results = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
async function send(command) {
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), command])
  app.wake?.()
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const attack = (fields = {}) => send({
  id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'sword', activity: 'sword-cut', target: { combatId: 'fight', combatantId: 'cb-gob' },
  mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [20] }], ...fields,
})
const damage = (use, dice, fields = {}) => send({ id: `dmg-${++ids}`, actorId: 'thorin', kind: 'damage', use, dice, ...fields })
const textDamage = (dice, fields = {}) => send({
  id: `txt-${++ids}`, actorId: 'thorin', kind: 'textDamage', text: TEXT, link: 0, mode: 0, explicit: false, extras: [], dice, ...fields,
})
const messageOf = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.request === id)
const MIDI_TEXT = /mx\d|\dx\d/

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
// Midi wraps dnd5e's configureDamage at its init, once the module's scripts are loaded; the module
// sets up its dice plans at ready, its own WRAPPER outside Midi's.
if (MIDI) installMidiCritical(DamageRoll)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
settings.set('campaigns', [{ id: 'camp-a', title: 'Ashlands', characters: ['thorin'], rolls: true, attacks: true }])
await Hooks.callAll('ready')
const plan = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { diceStatus, damageRollsFor, plannedDice, plannedDamage, modifiedDice, criticalRule, reshapeDamage } = plan
await until(() => app.polls.length > 0, 'the first fetch')
assert.deepEqual([diceStatus.ready, diceStatus.attacks], [true, true], diceStatus.error ?? diceStatus.attacksError)
// The self-test of damage changed in the app passes under dnd5e 6 too, which marks none of a critical
// hit's critical damage as it adds it: the module marks it as dnd5e 5.3 and Midi-QOL do, so its die is
// never planned as one of the damage's own (fix-032 1; before it, under dnd5e 6 `modifiers` was false,
// 'a die more was planned of damage with none of its own', and with it every damage change in the app).
assert.equal(diceStatus.modifiers, true, diceStatus.modifiersError)
ok(`the self-tests pass${MIDI ? " under Midi-QOL's rule for the Gamemaster, doubleDice" : ''}, the modifiers' too${DND5E6 ? ', under dnd5e 6 as under 5.3' : ''}`)

/** An app's critical hit's damage, as the module builds it to plan or preview one. */
const built = (formula, critical = {}, isCritical = true) => damageRollsFor({
  rolls: [{ parts: [formula], data: {}, options: { type: 'slashing', critical } }], isCritical,
})[0]
const diceOf = roll => plannedDice(roll).dice.map(({ faces, number }) => ({ faces, number }))
const withSettings = async (changes, test) => {
  const was = Object.fromEntries(Object.keys(changes).map(key => [key, settings.get(key)]))
  for (const [key, value] of Object.entries(changes)) settings.set(key, value)
  try { return await test() } finally { for (const [key, value] of Object.entries(was)) settings.set(key, value) }
}

// ---- C1: an attack's critical hit, previewed ----
const crit = await attack()
assert.equal(crit.status, 'done', JSON.stringify(crit))
assert.equal(crit.attack.critical, true)
const preview = crit.damage.rolls[0]
assert.deepEqual({ formula: preview.formula, dice: preview.dice, perDie: preview.perDie }, { formula: '2d6 + 4', dice: [{ faces: 6, number: 2 }], perDie: 2 })
assert.doesNotMatch(JSON.stringify(crit.damage), MIDI_TEXT)
ok("C1: an attack's critical hit previews its damage as dnd5e makes it, 1d6 + 4 as 2d6 + 4, two d6 and two for each die more")

// ---- C2, C3 ----
assert.equal(built('1d8 + 1d6 + 3').formula, '2d8 + 2d6 + 3')
assert.deepEqual(diceOf(built('1d8 + 1d6 + 3')), [{ faces: 8, number: 2 }, { faces: 6, number: 2 }])
ok('C2: 1d8 + 1d6 + 3 is 2d8 + 2d6 + 3, each die term doubled')
assert.deepEqual(criticalRule(), { perDie: 2, multiplyNumeric: false, powerfulCritical: false, altered: false, bonusDice: 'rolled' })
ok("C3: the sheet's rule for a critical hit is dnd5e's: each die twice over, its extra dice thrown, nothing altered")

// ---- C4: the damage rolled, dnd5e's way and Midi's ----
const paths = MIDI ? [['dnd5e', false], ['midi', true]] : [['dnd5e', null]]
for (const [path, replace] of paths) {
  if (replace !== null) settings.set('ReplaceDefaultActivities', replace)
  const hit = await attack()
  assert.equal(hit.status, 'done', `${path}: ${JSON.stringify(hit)}`)
  assert.deepEqual(hit.damage.rolls[0].dice, [{ faces: 6, number: 2 }], path)
  const dealt = await damage(hit.id, [{ faces: 6, results: [3, 5] }])
  assert.equal(dealt.status, 'done', `${path}: ${JSON.stringify(dealt)}`)
  assert.deepEqual([dealt.rolls[0].formula, dealt.rolls[0].total], ['2d6 + 4', 12], path)
  assert.doesNotMatch(JSON.stringify(dealt), MIDI_TEXT, path)
}
settings.delete('ReplaceDefaultActivities')
ok(`C4: the player's two d6, 3 and 5, roll the critical hit's damage as 2d6 + 4, coming to 12, on ${MIDI ? "dnd5e's path and Midi-QOL's workflow" : "dnd5e's path"}, with no mx or x anywhere`)

// ---- C5: a description's critical hit ----
const described = await textDamage([{ faces: 6, results: [3, 5] }], { critical: true })
assert.equal(described.status, 'done', JSON.stringify(described))
assert.deepEqual([described.rolls[0].formula, described.rolls[0].total, described.rolls[0].critical], ['2d6 + 4', 12, true])
ok("C5: a description's damage as a critical hit's, 1d6 + 4, is 2d6 + 4")

// ---- C6: dnd5e's settings, an item's extra dice and critical damage ----
// Since module 0.33.0 Critical Damage Modifiers doubles no number of the app's (before, 2d6 + 8).
await withSettings({ criticalDamageModifiers: true }, () => assert.equal(built('1d6 + 4').formula, '2d6 + 4'))
await withSettings({ criticalDamageMaxDice: true }, () => assert.equal(built('1d6 + 4').formula, V('1d6 + 4 + 6', '1d6 + 6 + 4')))
assert.equal(built('1d6 + 4', { bonusDice: 1 }).formula, '3d6 + 4')
assert.equal(built('1d6 + 4', { bonusDamage: '1d4' }).formula, '2d6 + 4 + 1d4')
ok(`C6: dnd5e's settings apply but for its numbers: Critical Damage Modifiers on, still 2d6 + 4 (module 0.33.0); Powerful critical ${V('1d6 + 4 + 6', '1d6 + 6 + 4')}; an extra die 3d6 + 4; critical damage 2d6 + 4 + 1d4`)

// A critical hit's critical damage is planned `added`, as PROTOCOL's attack `damage` says, never as
// one of the damage's own dice; so damage whose only die is its critical damage's has none to change,
// as the modifiers' self-test asks. dnd5e 6 marks none of it itself; the module marks it.
const marks = what => {
  assert.deepEqual(plannedDice(built('1d6 + 4', { bonusDamage: '1d4' })).dice, [{ faces: 6, number: 2 }, { faces: 4, number: 1, added: true }], what)
  const flat = { rolls: [{ parts: ['3'], data: {}, options: { critical: { bonusDamage: '1d6' } } }], isCritical: true }
  assert.equal(modifiedDice(plannedDamage(flat), { extra: 1 }), null, what)
  const configured = built('1d6 + 4', { bonusDamage: '1d4' })
  configured.configureDamage()
  assert.deepEqual(plannedDice(configured).dice, [{ faces: 6, number: 2 }, { faces: 4, number: 1, added: true }], `${what}, configured twice`)
}
marks('the first rule')
ok(`C6: a critical hit's critical damage, 1d4, is planned added beside its 2d6${DND5E6 ? ', under dnd5e 6 too, which leaves it unmarked' : ''}, configured once or twice; damage of 3 with critical damage of 1d6 has no die of its own for a die more`)

// ---- C7: a die more ----
const more = async (formula, critical, expected, changes = {}) => withSettings(changes, () => {
  const roll = built(formula, critical)
  reshapeDamage(roll, { extra: 1 })
  assert.equal(roll.formula, expected, `${formula} ${JSON.stringify({ critical, changes })}`)
  // As the app plans it: two more of the first die for each die more, as the world's rule says.
  const planned = modifiedDice(plannedDamage({ rolls: [{ parts: [formula], data: {}, options: { type: 'slashing', critical } }], isCritical: true }), { extra: 1 })
  const count = dice => dice.reduce((all, { faces, number }) => ({ ...all, [faces]: (all[faces] ?? 0) + number }), {})
  // dnd5e 6 copies a modified die for a critical hit where 5.3.3 doubles it, so the two read
  // `2d6r<=2 + 2d6r<=2` and plan [3d6, 1d6]: as many d6 alike, which is what the module takes.
  if (DND5E6 && /r<=/.test(formula)) assert.deepEqual(count(diceOf(roll)), count(planned), formula)
  else assert.deepEqual(diceOf(roll), planned.map(({ faces, number }) => ({ faces, number })), formula)
})
await more('1d6 + 4', {}, '4d6 + 4')
// Since module 0.33.0 its number never doubled (before, 4d6 + 8).
await more('1d6 + 4', {}, '4d6 + 4', { criticalDamageModifiers: true })
await more('1d6 + 4', {}, V('2d6 + 4 + 12', '2d6 + 12 + 4'), { criticalDamageMaxDice: true })
await more('1d6 + 4', { bonusDice: 1 }, '5d6 + 4')
await more('1d6 + 4', { bonusDamage: '1d4' }, '4d6 + 4 + 1d4')
await more('1d6r<=2 + 4', {}, V('4d6r<=2 + 4', '2d6r<=2 + 2d6r<=2 + 4'))
ok(`C7: a die more of a critical hit is dnd5e's critical of one die more: 4d6 + 4; 4d6 + 4 under Critical Damage Modifiers too (module 0.33.0); ${V('2d6 + 4 + 12', '2d6 + 12 + 4')}; 5d6 + 4; 4d6 + 4 + 1d4; ${V('4d6r<=2 + 4', '2d6r<=2 + 2d6r<=2 + 4')}; never what was doubled doubled again; the dice the app plans those the roll throws`)

// ---- C8: configured twice ----
const twice = built('1d6 + 4', { bonusDamage: '1d4' })
twice.configureDamage()
assert.equal(twice.formula, '2d6 + 4 + 1d4')
ok('C8: configured twice, a critical hit with critical damage is as it was, 2d6 + 4 + 1d4')

// ---- C9: the Gamemaster's own rolls ----
const own = new CONFIG.Dice.DamageRoll('1d6 + 4', {}, { isCritical: true })
assert.equal(own.formula, MIDI ? '1d6mx2 + 4' : '2d6 + 4')
ok(MIDI ? "C9: the Gamemaster's own critical hit in Foundry, neither tagged nor marked the app's, keeps Midi's rule: 1d6mx2 + 4" : "C9: the Gamemaster's own critical hit in Foundry is dnd5e's, as ever")

// ---- C10: Midi's other rules for the Gamemaster ----
if (MIDI) {
  for (const rule of ['maxAll', 'maxCrit', 'maxCritRoll', 'maxDamage', 'bestOfTwo']) {
    midiCritical.gm = rule
    const roll = built('1d6 + 4')
    assert.deepEqual([roll.formula, diceOf(roll)], ['2d6 + 4', [{ faces: 6, number: 2 }]], rule)
    assert.deepEqual(criticalRule(), { perDie: 2, multiplyNumeric: false, powerfulCritical: false, altered: false, bonusDice: 'rolled' }, rule)
    const hit = await attack()
    assert.deepEqual([hit.damage.rolls[0].formula, hit.damage.rolls[0].dice, hit.damage.rolls[0].perDie], ['2d6 + 4', [{ faces: 6, number: 2 }], 2], rule)
  }
  midiCritical.gm = 'doubleDice'
  ok("C10: under each of Midi's other rules for the Gamemaster, maxAll, maxCrit, maxCritRoll, maxDamage and bestOfTwo, the app's critical hit is 2d6 + 4 all the same, previewed and planned")
  // Damage changed in the app is offered under every one of them, Midi's default too: the self-tests
  // made again under each, with the critical damage planned added.
  for (const rule of ['default', 'doubleDice', 'maxAll', 'maxCrit', 'maxCritRoll', 'maxDamage', 'bestOfTwo']) {
    midiCritical.gm = rule
    marks(rule)
    await plan.selfTest()
    assert.deepEqual([diceStatus.ready, diceStatus.attacks, diceStatus.modifiers], [true, true, true], `${rule}: ${diceStatus.modifiersError ?? diceStatus.attacksError ?? diceStatus.error}`)
  }
  midiCritical.gm = 'doubleDice'
  ok(`C10: under each of Midi's rules for the Gamemaster, default, doubleDice, maxAll, maxCrit, maxCritRoll, maxDamage and bestOfTwo, the self-tests pass, the modifiers' too, and a critical hit's critical damage is planned added${DND5E6 ? ', under dnd5e 6 too' : ''}`)
} else {
  // ---- C11: no Midi ----
  assert.deepEqual([built('1d6 + 4').formula, built('1d8 + 1d6 + 3').formula, built('1d6 + 4', { bonusDice: 1 }).formula], ['2d6 + 4', '2d8 + 2d6 + 3', '3d6 + 4'])
  ok(`C11: without Midi-QOL, every first build is dnd5e's, as before; and a critical hit's die more is right on dnd5e ${V('5.3.3, as it was', '6.0.5, where it was 2d6 + 4 before')}`)
}

// ---- C12: a die more, no critical hit ----
const plain = built('1d6 + 4', {}, false)
reshapeDamage(plain, { extra: 1 })
assert.deepEqual([plain.formula, diceOf(plain)], ['2d6 + 4', [{ faces: 6, number: 2 }]])
ok(`C12: a die more of damage that isn't a critical hit's says so in its formula, 2d6 + 4${DND5E6 ? ", where dnd5e 6 left it 1d6 + 4" : ''}`)

// The app's rolls as dnd5e makes them: a critical hit's damage rolled with the player's dice, all of
// them taken, its total theirs and its numbers'; damage may be changed in the app under dnd5e 6 too.
{
  const rolled = await attack()
  const taken = await damage(rolled.id, [{ faces: 6, results: [6, 6, 1, 2] }], { modifiers: { extra: 1 } })
  assert.equal(taken.status, 'done', JSON.stringify(taken))
  assert.deepEqual([taken.rolls[0].formula, taken.rolls[0].total], ['4d6 + 4', 19])
  ok(`a critical hit's damage with a die more takes the player's four d6, 4d6 + 4, coming to their 15 and the 4${DND5E6 ? ', under dnd5e 6 too' : ''}`)
}

// ---- Module 0.33.0: a critical hit's dice doubled, never its numbers ----
// The user: "It doubles all the static modifiers as well and it should not do that it should only
// double the dice." Each case under dnd5e's Critical Damage Modifiers off and on, and with Midi-QOL
// under each of its rules for the Gamemaster that its stand-in has; before 0.33.0 the setting on
// doubled every number (`2d6 + 8`), and so did a roll's own `critical.multiplyNumeric`, and dnd5e 6
// copied a group's numbers with its dice (`(1d6 + 2) + (1d6 + 2)`).
const MIDI_RULES = MIDI ? ['default', 'doubleDice', 'maxAll', 'maxCrit', 'maxCritRoll', 'maxDamage', 'bestOfTwo'] : [null]
const eachWorld = async test => {
  for (const modifiers of [false, true]) {
    for (const rule of MIDI_RULES) {
      if (rule) midiCritical.gm = rule
      const world = `Critical Damage Modifiers ${modifiers ? 'on' : 'off'}${rule ? `, Midi's ${rule}` : ''}`
      await withSettings({ criticalDamageModifiers: modifiers }, () => test(world))
    }
  }
  midiCritical.gm = 'doubleDice'
}
// [formula, its critical options, as the app's critical hit makes it]
const NUMBERS = [
  ['1d6 + 4', {}, '2d6 + 4'],
  // A flat bonus beside the ability modifier, two numbers; a flat bonus alone; a number taken away.
  ['1d8 + 4 + 1', {}, '2d8 + 4 + 1'],
  ['5', {}, '5'],
  ['1d6 - 1', {}, '2d6 - 1'],
  // A die with modifiers beside a number: doubled, or under dnd5e 6 copied, never the number.
  ['1d6r1 + 3', {}, V('2d6r1 + 3', '1d6r1 + 1d6r1 + 3')],
  // A group in parentheses with a number: dnd5e 5.3 leaves it as it is; dnd5e 6 copies its dice,
  // its number left out of the copy (before, `(1d6 + 2) + (1d6 + 2) + 4`).
  ['(1d6 + 2) + 4', {}, V('(1d6 + 2) + 4', '(1d6 + 2) + (1d6) + 4')],
  ['(2 + 1d6) - 1', {}, V('(2 + 1d6) - 1', '(2 + 1d6) + (1d6) - 1')],
  ['1d8 - (1d4 + 1)', {}, V('2d8 - (1d4 + 1)', '2d8 - (1d4 + 1) - (1d4)')],
  // A number in parentheses, never a die's.
  ['1d6 + (2)', {}, '2d6 + (2)'],
  // The roll's own options asking for numbers doubled, as an activity's or another module's may.
  ['1d6 + 4', { multiplyNumeric: true }, '2d6 + 4'],
  // An item's extra dice and critical damage, which is added as it is, its numbers too.
  ['1d6 + 4', { bonusDice: 1 }, '3d6 + 4'],
  ['1d6 + 4', { bonusDamage: '1d4 + 2' }, '2d6 + 4 + 1d4 + 2'],
  // Critical damage after a group or a number in parentheses: added as it is, never taken for a
  // group's copy, its dice alone, or Powerful Critical's most (fix-033crit 2; a number, a group).
  ['1d6 + (1d4 + 1)', { bonusDamage: '2' }, V('2d6 + (1d4 + 1) + 2', '2d6 + (1d4 + 1) + (1d4) + 2')],
  ['1d6 + (1d4 + 1)', { bonusDamage: '(1d4 + 2)' }, V('2d6 + (1d4 + 1) + (1d4 + 2)', '2d6 + (1d4 + 1) + (1d4) + (1d4 + 2)')],
  ['1d6 + (2)', { bonusDamage: '3' }, '2d6 + (2) + 3'],
  // A group whose die is taken away: dnd5e 6's copy takes it away too, its sign kept (fix-033crit 4).
  ['(2 - 1d4) + 1d6', {}, V('(2 - 1d4) + 2d6', '(2 - 1d4) + (- 1d4) + 2d6')],
]
// Under Powerful Critical: the most its dice could roll, never a number's (dnd5e 6 adds a group's
// most of the whole of it, `(1d6 + 2) + 8`, and a number's in parentheses, `(2) + 2`); a group's
// for its extra dice too, as dnd5e 6 multiplies it, an item's extra dice and a multiplier of 3
// (fix-033crit 3). [formula, its critical options, as the app's critical hit makes it]
const POWERFUL = [
  ['1d6 + 4', {}, V('1d6 + 4 + 6', '1d6 + 6 + 4')],
  ['1d8 + 4 + 1', {}, V('1d8 + 4 + 1 + 8', '1d8 + 8 + 4 + 1')],
  ['(1d6 + 2) + 4', {}, V('(1d6 + 2) + 4', '(1d6 + 2) + 6 + 4')],
  ['1d6 + (2)', {}, V('1d6 + (2) + 6', '1d6 + 6 + (2)')],
  ['(1d6 + 2) + 4', { bonusDice: 1 }, V('(1d6 + 2) + 4', '(1d6 + 2) + 12 + 4')],
  ['(1d8 + 1) + 3', { bonusDice: 2 }, V('(1d8 + 1) + 3', '(1d8 + 1) + 24 + 3')],
  ['(1d6 + 2) + 4', { multiplier: 3 }, V('(1d6 + 2) + 4', '(1d6 + 2) + 12 + 4')],
]
// An app's critical hit's damage made of terms, as Foundry parses a formula this stand-in can't:
// built as the module builds one to plan, its terms put in place, and configured as a critical hit's.
const madeOf = (terms, critical = {}) => {
  const roll = built('1d6', critical, false)
  roll.terms = terms
  Object.assign(roll.options, { isCritical: true, configured: false })
  roll.configureDamage()
  return roll.formula
}
// A group bound by *, which dnd5e 6 wraps with its copy: built as Foundry parses `2 * (1d6 + 1)`.
const boundGroup = () => {
  const { NumericTerm, OperatorTerm, ParentheticalTerm } = foundry.dice.terms
  return madeOf([new NumericTerm({ number: 2 }), new OperatorTerm({ operator: '*' }), new ParentheticalTerm({ term: '1d6 + 1' })])
}
// Foundry's functions of dice, for the cases below alone (dice-core.mjs reads none, and its
// FunctionTerm is always deterministic; fix-033crit 1): `max(1d6 + 4, 1d4)` in a formula read as a
// FunctionTerm of its arguments, a group deep within them, a group around one kept as written;
// deterministic only where each argument is, as Foundry's FunctionTerm#isDeterministic; and
// evaluated synchronously, at its highest too, each argument at its own, as dnd5e 6's Powerful
// Critical works out the most a term could roll. Put back as it was after.
const withFunctions = test => {
  const { FunctionTerm, ParentheticalTerm } = foundry.dice.terms
  const Roll = foundry.dice.Roll
  const was = { parse: Roll.parse, parseTerm: Roll.parseTerm, evaluateSync: Roll.prototype.evaluateSync }
  let calls = null
  Roll.parse = function (formula, data) {
    const outer = calls
    calls = []
    try {
      const marked = String(formula).replace(/\b([a-z]+)\(((?:[^()]|\([^()]*\))*)\)/gi, (text, fn, args) => {
        calls.push({ text, fn, args: args.split(',').map(arg => arg.trim()) })
        return `ƒ${calls.length - 1}`
      })
      const terms = was.parse.call(this, marked, data)
      for (const term of terms) {
        if (term instanceof ParentheticalTerm) term.term = term.term.replace(/ƒ(\d+)/g, (text, at) => calls[at].text)
      }
      return terms
    } finally {
      calls = outer
    }
  }
  Roll.parseTerm = function (piece) {
    const call = /^ƒ(\d+)(?:\[([^\]]+)\])?$/.exec(piece.trim())
    if (call && calls?.[call[1]]) {
      const { fn, args } = calls[call[1]]
      return new FunctionTerm({ fn, terms: args, options: call[2] ? { flavor: call[2] } : {} })
    }
    return was.parseTerm.call(this, piece)
  }
  Object.defineProperty(FunctionTerm.prototype, 'isDeterministic', { get() { return this.terms.every(arg => new Roll(arg).isDeterministic) }, configurable: true })
  Object.defineProperty(FunctionTerm.prototype, 'total', { get() { return this.result }, configurable: true })
  Roll.prototype.evaluateSync = function (options = {}) {
    for (const term of this.terms) {
      if (!(term instanceof FunctionTerm) || term._evaluated) continue
      term.result = Math[term.fn](...term.terms.map(arg => new Roll(arg).evaluateSync(options).total))
      term._evaluated = true
    }
    return was.evaluateSync.call(this, options)
  }
  try {
    return test()
  } finally {
    Object.assign(Roll, { parse: was.parse, parseTerm: was.parseTerm })
    Roll.prototype.evaluateSync = was.evaluateSync
    delete FunctionTerm.prototype.isDeterministic
    delete FunctionTerm.prototype.total
  }
}
// A function of dice and a number, which dnd5e 6 copies whole, its number with it: made again with
// its dice thrown as a die is, the number once (before, `2d8 + max(1d6 + 4, 1d4) + max(1d6 + 4, 1d4)`),
// a group's within it too; the item's extra dice on it as the first term; within a group dnd5e 6
// copies, of its dice alone; bound by *, wrapped, with a multiplier of 3. Each made of the terms
// Foundry parses it to, under withFunctions. [formula, its critical options, as the app's critical
// hit makes it]
const FUNCTIONS = [
  ['1d8 + max(1d6 + 4, 1d4)', {}, V('2d8 + max(1d6 + 4, 1d4)', '2d8 + max(2d6 + 4, 2d4)')],
  ['max(1d6 + 4, 1d4) + 1d8', { bonusDice: 1 }, V('max(1d6 + 4, 1d4) + 2d8', 'max(3d6 + 4, 3d4) + 2d8')],
  ['1d8 + max(1d6 + (1d4 + 1), 2)', {}, V('2d8 + max(1d6 + (1d4 + 1), 2)', '2d8 + max(2d6 + (2d4 + 1), 2)')],
  ['1d8 + (max(1d6 + 4, 1d4) + 1)', {}, V('2d8 + (max(1d6 + 4, 1d4) + 1)', '2d8 + (max(1d6 + 4, 1d4) + 1) + (max(1d6, 1d4))')],
  ['2 * max(1d6 + 4, 1d4)', { multiplier: 3 }, V('2 * max(1d6 + 4, 1d4)', '2 * (max(3d6 + 4, 3d4))')],
]
// Under Powerful Critical, the most of its dice alone, never its number's: the 2 of max(…, 2) says
// what it does, and is kept (before, under dnd5e 6, the whole function's, `+ 10`, `+ 11`, `+ 20`).
const POWERFUL_FUNCTIONS = [
  ['1d8 + max(1d6 + 4, 1d4)', {}, V('1d8 + max(1d6 + 4, 1d4) + 8', '1d8 + 8 + max(1d6 + 4, 1d4) + 6')],
  ['1d8 + max(1d6 + (1d4 + 1), 2)', {}, V('1d8 + max(1d6 + (1d4 + 1), 2) + 8', '1d8 + 8 + max(1d6 + (1d4 + 1), 2) + 10')],
  ['1d8 + (max(1d6 + 4, 1d4) + 1)', {}, V('1d8 + (max(1d6 + 4, 1d4) + 1) + 8', '1d8 + 8 + (max(1d6 + 4, 1d4) + 1) + 6')],
  ['max(1d6 + 4, 1d4) + 1d8', { bonusDice: 1 }, V('max(1d6 + 4, 1d4) + 1d8 + 8', 'max(1d6 + 4, 1d4) + 12 + 1d8 + 8')],
]
// A formula's terms as Foundry parses it: this stand-in's, with a number bound by * before them.
const termsOf = formula => {
  const bound = /^(\d+) \* (.*)$/.exec(formula)
  if (!bound) return new Roll(formula).terms
  const { NumericTerm, OperatorTerm } = foundry.dice.terms
  return [new NumericTerm({ number: Number(bound[1]) }), new OperatorTerm({ operator: '*' }), ...termsOf(bound[2])]
}

// ---- C13: every plan and preview of an app's critical hit (damageRollsFor), and the sheet's rule ----
await eachWorld(async world => {
  for (const [formula, critical, expected] of NUMBERS) {
    assert.equal(built(formula, critical).formula, expected, `${world}: ${formula} ${JSON.stringify(critical)}`)
  }
  // Configured as dnd5e's process gives it, its `critical.multiplyNumeric` filled in from the setting.
  const [process] = damageRollsFor({ critical: { multiplyNumeric: true }, rolls: [{ parts: ['1d6 + 4'], data: {}, options: {} }], isCritical: true })
  assert.equal(process.formula, '2d6 + 4', world)
  assert.equal(boundGroup(), V('2 * (1d6 + 1)', '2 * ((1d6 + 1) + (1d6))'), world)
  // A group within a group, which dnd5e 6 copies with the outer one: the copy its dice alone at each
  // depth (fix-033crit 4; crit-parentheticals.mjs reads one, so made of terms).
  {
    const { OperatorTerm, ParentheticalTerm } = foundry.dice.terms
    const nested = [...new Roll('1d8').terms, new OperatorTerm({ operator: '+' }), new ParentheticalTerm({ term: '1d6 + (1d4 + 1)' })]
    assert.equal(madeOf(nested), V('2d8 + (1d6 + (1d4 + 1))', '2d8 + (1d6 + (1d4 + 1)) + (1d6 + (1d4))'), `${world}: a group within a group`)
  }
  withFunctions(() => {
    const [, , fn] = termsOf('1d8 + max(1d6 + 4, 1d4)')
    assert.deepEqual([fn instanceof foundry.dice.terms.FunctionTerm, fn.isDeterministic, termsOf('max(2, 3)')[0].isDeterministic], [true, false, true], 'the stand-in for functions')
    for (const [formula, critical, expected] of FUNCTIONS) {
      assert.equal(madeOf(termsOf(formula), critical), expected, `${world}: ${formula} ${JSON.stringify(critical)}`)
    }
  })
  assert.deepEqual(criticalRule(), { perDie: 2, multiplyNumeric: false, powerfulCritical: false, altered: false, bonusDice: 'rolled' }, world)
  // A die more, another die, and both, of a number's critical hit.
  for (const [modifiers, expected] of [[{ extra: 1 }, '4d6 + 4'], [{ faces: 8 }, '2d8 + 4'], [{ extra: 2, faces: 10 }, '6d10 + 4']]) {
    const roll = built('1d6 + 4')
    reshapeDamage(roll, modifiers)
    assert.equal(roll.formula, expected, `${world}: ${JSON.stringify(modifiers)}`)
  }
  await withSettings({ criticalDamageMaxDice: true }, () => {
    for (const [formula, critical, expected] of POWERFUL) {
      assert.equal(built(formula, critical).formula, expected, `${world}, Powerful Critical: ${formula} ${JSON.stringify(critical)}`)
    }
    withFunctions(() => {
      for (const [formula, critical, expected] of POWERFUL_FUNCTIONS) {
        assert.equal(madeOf(termsOf(formula), critical), expected, `${world}, Powerful Critical: ${formula} ${JSON.stringify(critical)}`)
      }
    })
    assert.deepEqual(criticalRule(), { perDie: 1, multiplyNumeric: false, powerfulCritical: true, altered: false, bonusDice: V('rolled', null) }, world)
  })
})
const listed = cases => cases.map(([f, c, e]) => `${f}${Object.keys(c).length ? ` ${JSON.stringify(c)}` : ''} as ${e}`).join('; ')
ok(`C13: under Critical Damage Modifiers off and on${MIDI ? ", and each of Midi's rules for the Gamemaster" : ''}, every plan of an app's critical hit doubles its dice alone: ${listed(NUMBERS)}; ${V('2 * (1d6 + 1)', '2 * ((1d6 + 1) + (1d6))')} bound by *; a group within a group as ${V('2d8 + (1d6 + (1d4 + 1))', '2d8 + (1d6 + (1d4 + 1)) + (1d6 + (1d4))')}; functions ${listed(FUNCTIONS)}; a die more, another die, both; Powerful Critical ${listed(POWERFUL)}, and of functions ${listed(POWERFUL_FUNCTIONS)}; and the sheet's rule says multiplyNumeric false${DND5E6 ? ', under dnd5e 6' : ''}`)

// ---- C14: the app's rolls, its numbers its own ----
const d6 = (...results) => ({ faces: 6, results })
await eachWorld(async world => {
  const paths = MIDI ? [['dnd5e', false], ['midi', true]] : [['dnd5e', null]]
  for (const [path, replace] of paths) {
    if (replace !== null) settings.set('ReplaceDefaultActivities', replace)
    const where = `${world}, ${path}`
    const rolled = async (fields, dice, damageFields = {}) => {
      const hit = await attack(fields)
      assert.equal(hit.status, 'done', `${where}: ${JSON.stringify(hit)}`)
      const dealt = await damage(hit.id, dice, damageFields)
      assert.equal(dealt.status, 'done', `${where}: ${JSON.stringify(dealt)}`)
      return [hit.damage.rolls[0].formula, dealt.rolls[0].formula, dealt.rolls[0].total]
    }
    assert.deepEqual(await rolled({}, [d6(3, 5)]), ['2d6 + 4', '2d6 + 4', 12], `${where}: an attack's`)
    assert.deepEqual(await rolled({}, [d6(3, 5)], { typed: true }), ['2d6 + 4', '2d6 + 4', 12], `${where}: typed`)
    assert.deepEqual(await rolled({}, [d6(3, 5)], { by: 'gm' }), ['2d6 + 4', '2d6 + 4', 12], `${where}: the Gamemaster's as the character`)
    assert.deepEqual(await rolled({}, [d6(3, 5, 1, 1)], { modifiers: { extra: 1 } }), ['2d6 + 4', '4d6 + 4', 14], `${where}: a die more`)
    assert.deepEqual(await rolled({}, [{ faces: 8, results: [7, 8] }], { modifiers: { faces: 8 } }), ['2d6 + 4', '2d8 + 4', 19], `${where}: another die`)
    assert.deepEqual(await rolled({}, [d6(1, 1)], { modifiers: { maximize: true } }), ['2d6 + 4', '2d6 + 4', 16], `${where}: at its highest`)
    assert.deepEqual(await rolled({ item: 'axe', activity: 'axe-swing', attackMode: 'twoHanded' }, [{ faces: 10, results: [9, 10] }]),
      ['2d10 + 4 + 1', '2d10 + 4 + 1', 24], `${where}: versatile, with a flat bonus`)
    await withSettings({ criticalDamageMaxDice: true }, async () => {
      assert.deepEqual(await rolled({}, [d6(3)]), [V('1d6 + 4 + 6', '1d6 + 6 + 4'), V('1d6 + 4 + 6', '1d6 + 6 + 4'), 13], `${where}: Powerful Critical`)
    })
    assert.doesNotMatch(JSON.stringify(app.events.slice(-12)), MIDI_TEXT, where)
  }
  settings.delete('ReplaceDefaultActivities')
  // A description's: two numbers, and a die with modifiers beside a number.
  for (const [link, dice, expected] of [
    [0, [d6(3, 5)], ['2d6 + 4', 12]],
    [1, [d6(3, 5)], ['2d6 + 4 + 2', 14]],
    [2, V([d6(3, 5)], [d6(3), d6(5)]), [V('2d6r1 + 3', '1d6r1 + 1d6r1 + 3'), 11]],
  ]) {
    const made = await textDamage(dice, { link, critical: true })
    assert.equal(made.status, 'done', `${world}: ${JSON.stringify(made)}`)
    assert.deepEqual([made.rolls[0].formula, made.rolls[0].total], expected, `${world}: description ${link}`)
  }
})
ok(`C14: under Critical Damage Modifiers off and on${MIDI ? ", and each of Midi's rules for the Gamemaster, on dnd5e's path and Midi's workflow" : ''}, the app's critical hits double their dice alone: an attack's 1d6 + 4 previewed and rolled as 2d6 + 4, 12, typed or the Gamemaster's as the character too; a die more 4d6 + 4, another die 2d8 + 4, at its highest 16; versatile 2d10 + 4 + 1, 24; Powerful Critical ${V('1d6 + 4 + 6', '1d6 + 6 + 4')}, 13; a description's 2d6 + 4, 2d6 + 4 + 2 and ${V('2d6r1 + 3', '1d6r1 + 1d6r1 + 3')}`)

// ---- C15: the Gamemaster's own rolls keep dnd5e's and Midi's rules ----
{
  const own = rule => {
    if (rule) midiCritical.gm = rule
    const roll = new CONFIG.Dice.DamageRoll('1d6 + 4', {}, { isCritical: true, critical: { multiplyNumeric: true } })
    midiCritical.gm = 'doubleDice'
    return roll.formula
  }
  assert.equal(own(MIDI && 'default'), '2d6 + 8')
  if (MIDI) assert.equal(own('doubleDice'), '1d6mx2 + 4')
  ok(`C15: the Gamemaster's own critical hit in Foundry, not the app's, keeps its numbers doubled where it asks: 2d6 + 8${MIDI ? "; under Midi's doubleDice, Midi's own, 1d6mx2 + 4" : ''}`)
}

// ---- C16: the roll says so, and keeps it ----
{
  const roll = built('1d6 + 4', { multiplyNumeric: true })
  assert.equal(roll.options.critical.multiplyNumeric, false)
  roll.configureDamage({ critical: { multiplyNumeric: true } })
  assert.equal(roll.formula, '2d6 + 4')
  assert.equal(roll.clone().formula, '2d6 + 4')
  assert.equal(CONFIG.Dice.DamageRoll.fromData(roll.toJSON()).formula, '2d6 + 4')
  ok("C16: an app's critical hit says multiplyNumeric false in its own options, so configured again, even asked to double its numbers, cloned or made again of its data, it's still 2d6 + 4")
}

console.log(`crit-rules${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
