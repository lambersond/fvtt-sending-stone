// Players' attacks from the app, made in the game: the real module, dnd5e 5.3.3's real dice classes
// (D20Roll, DamageRoll and their dice), dnd5e's items and attack activities ported (activity5e.mjs),
// a stand-in Foundry core and app. MIDI=1 puts a stand-in Midi-QOL workflow in the world
// (midi-fake.mjs). Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs, and
// LIBWRAPPER=1 or OMIT_ROOT=1 as rolls.mjs takes them.
import assert from 'node:assert/strict'
import { combat, combatant, settle, settings, user, users, actors, message as fakeMessage } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
import { DND5E5 } from './paths.mjs'
const DND5E = `${DND5E5}/module/dice`
const MIDI = !!process.env.MIDI
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

// The module's long waits, shortened a hundredfold: a minute's watchdog takes 0.6 seconds.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
globalThis.document = { hidden: false }

const { core, messages, seedRandom } = await import('./dice-core.mjs')
if (process.env.OMIT_ROOT) core.omitRoot = true

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
  damageTypes: Object.fromEntries(['slashing', 'piercing', 'bludgeoning', 'radiant', 'acid', 'fire']
    .map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' } },
}
settings.set('messageMode', 'gm') // The Gamemaster rolls privately; players' attacks are public all the same.
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, equip, screen } = await import('./activity5e.mjs')
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
// dnd5e's registry of messages linked to a use's card, and its own attack activity's prototype.
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
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

if (process.env.LIBWRAPPER) {
  globalThis.libWrapper = {
    register(pkg, target, fn) {
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
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
user('bob', 'Bob')
if (MIDI) installMidi()

const add = actor => { actors.set(actor.id, actor); return actor }
const weapon = (id, name, properties, activity, system = {}) => ({
  id, name, type: 'weapon', system: { properties, quantity: 1, attackType: 'melee', ...system }, activities: [activity],
})
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 3, dex: 2, wis: 2 } }))
alice.character = thorin
equip(thorin, {
  // dnd5e keeps the levels above 2nd too, with no slots.
  spells: {
    spell1: { value: 0, max: 2, level: 1 }, spell2: { value: 1, max: 1, level: 2 },
    ...Object.fromEntries([3, 4, 5, 6, 7, 8, 9].map(level => [`spell${level}`, { value: 0, max: 0, level }])),
  },
  items: [
    weapon('axe', 'Battleaxe', ['ver'], { id: 'axe-swing', versatile: 10, damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }] }),
    weapon('bow', 'Longbow', ['amm'], { id: 'bow-shot', ability: 'dex', actionType: 'rwak', damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['piercing'] }] }, { attackType: 'ranged' }),
    { id: 'arrows', name: 'Arrows', type: 'consumable', system: { type: { value: 'ammo' }, quantity: 2, properties: [] } },
    weapon('dagger', 'Dagger', ['thr', 'lgt'], { id: 'dagger-stab', damage: [{ number: 1, denomination: 4, bonus: '@mod', types: ['piercing'] }] }),
    weapon('fist', 'Brass Knuckle', [], { id: 'fist-punch', damage: [{ number: 1, denomination: 3, bonus: '@mod', types: ['bludgeoning'] }] }),
    weapon('unarmed', 'Unarmed Strike', [], { id: 'unarmed-strike', criticalBonus: '1d4', damage: [{ number: 0, bonus: '1 + @mod', types: ['bludgeoning'] }] }),
    // What a critical hit adds: a greataxe's critical damage, a handaxe's thrown or not, a feat's claws.
    weapon('greataxe', 'Greataxe', ['hvy', 'two'], { id: 'cleave', criticalBonus: '1d6', damage: [{ number: 1, denomination: 12, bonus: '@mod', types: ['slashing'] }] }),
    weapon('handaxe', 'Handaxe', ['lgt', 'thr'], { id: 'hack', damage: [{ number: 1, denomination: 6, bonus: '@mod', types: ['slashing'] }] }, { quantity: 10 }),
    { id: 'claws', name: 'Claws', type: 'feat', system: { properties: [] },
      activities: [{ id: 'claws-rake', damage: [{ number: 1, denomination: 6, bonus: '@mod', types: ['slashing'] }] }] },
    { id: 'bolt', name: 'Guiding Bolt', type: 'spell', system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'bolt-cast', ability: 'wis', damage: [{ number: 4, denomination: 6, types: ['radiant'], scaling: 1 }] }] },
    { id: 'orb', name: 'Chromatic Orb', type: 'spell', system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'orb-cast', ability: 'wis', damage: [{ number: 3, denomination: 8, types: ['acid', 'fire'] }] }] },
    { id: 'breath', name: 'Breath', type: 'feat', system: { properties: [] },
      activities: [{ id: 'breath-blast', template: 'cone', damage: [{ number: 2, denomination: 6, types: ['fire'] }] }] },
    // Area attacks: a spray that takes two at most, and a burst around its user, which Midi places itself.
    { id: 'acid', name: 'Acid Spray', type: 'feat', system: { properties: [] },
      activities: [{ id: 'acid-spray', template: 'sphere', count: 2, damage: [{ number: 1, denomination: 6, types: ['acid'] }] }] },
    { id: 'nova', name: 'Radiant Nova', type: 'feat', system: { properties: [] },
      activities: [{ id: 'nova-burst', template: 'radius', range: 'self', damage: [{ number: 1, denomination: 8, types: ['radiant'] }] }] },
    { id: 'charm', name: 'Lucky Charm', type: 'feat', system: { properties: [], uses: { max: 1, spent: 0 } },
      activities: [{ id: 'charm-zap', consumption: [{ type: 'itemUses', value: 1 }], damage: [{ number: 1, denomination: 6, types: ['fire'] }] }] },
    // Items that cast a spell higher for more charges (module 0.20.0), each before its spell's copy: a
    // staff that casts Guiding Bolt from 1st level up to 3rd; another that casts it from 2nd, up to
    // 3rd, whose copy dnd5e scales in cost and count but not in damage, its damage fixed at 2nd; and
    // a ring that casts Magic Missile at 2nd, its darts two and one more for each level cast at.
    { id: 'bolt-staff', name: 'Staff of Guiding', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 10, spent: 0 } },
      activities: [{ id: 'cast-guide', type: 'cast', spell: { level: 1 }, scaling: { allowed: true, max: '3' },
        consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'guide', name: 'Guiding Bolt', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.bolt-staff.Activity.cast-guide' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'guide-bolt', ability: 'wis', damage: [{ number: 4, denomination: 6, types: ['radiant'], scaling: 1 }] }] },
    { id: 'bright-staff', name: 'Staff of Bright Guiding', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 10, spent: 0 } },
      activities: [{ id: 'cast-bright', type: 'cast', spell: { level: 2 }, scaling: { allowed: true, max: '2' },
        consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'bright', name: 'Guiding Bolt', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.bright-staff.Activity.cast-bright' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'bright-bolt', ability: 'wis', damage: [{ number: 4, denomination: 6, types: ['radiant'], scaling: 1 }] }] },
    { id: 'mm-ring', name: 'Ring of Missiles', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 10, spent: 0 } },
      activities: [{ id: 'cast-ring-mm', type: 'cast', spell: { level: 2 }, scaling: { allowed: true, max: '' },
        consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'ring-mm', name: 'Magic Missile', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.mm-ring.Activity.cast-ring-mm' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'ring-darts', type: 'damage', affects: 'creature', count: '2 + @item.level', damage: [{ number: 1, denomination: 4, bonus: '1', types: ['force'] }] }] },
  ],
})
const vex = add(new Actor5e({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3 } }))
equip(vex, { items: [weapon('rapier', 'Rapier', [], { id: 'rapier-lunge', ability: 'dex', damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['piercing'] }] })] })

// The foes, with their tokens on the Gamemaster's canvas.
const foe = (id, name, ac, { hidden = false, onScene = true } = {}) => {
  const actor = add(new Actor5e({ id, name, mods: {}, hp: { value: 30, max: 30, temp: 0 } }))
  actor.type = 'npc'
  equip(actor, { ac })
  const token = { id: `tok-${id}`, name, uuid: `Scene.scene.Token.tok-${id}`, actor, hidden }
  const placeable = { id: token.id, name, document: token, actor }
  if (onScene) { token.object = placeable; placeables.set(token.id, placeable) }
  return { actor, token }
}
const goblin = foe('goblin', 'Goblin', 13)
const ogre = foe('ogre', 'Ogre', 20)
const kobold = foe('kobold', 'Kobold', 12, { hidden: true })
const ghost = foe('ghost', 'Ghost', 11, { onScene: false })
if (MIDI) canvas.scene.tokens.size = placeables.size

const fight = combat('fight')
combatant(fight, 'cb-thorin', thorin)
combatant(fight, 'cb-vex', vex)
for (const [id, { actor, token }] of [['cb-gob', goblin], ['cb-ogre', ogre], ['cb-kob', kobold], ['cb-ghost', ghost]]) {
  combatant(fight, id, actor, { token, hidden: token.hidden })
}
fight.getCombatantsByActor = actor => fight.combatants.filter(cb => cb.actor?.id === actor.id)
game.combat = fight

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
const target = (combatantId, combatId = 'fight') => ({ combatId, combatantId })
const attackCommand = (fields = {}) => ({
  id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'axe', activity: 'axe-swing', target: target('cb-gob'),
  mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [15] }], ...fields,
})
const queue = (...commands) => {
  app.waiting.set('camp-a', [...(app.waiting.get('camp-a') ?? []), ...commands])
  app.wake?.()
}
const results = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
async function send(command) {
  queue(command)
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const attack = fields => send(attackCommand(fields))
const damage = (use, dice, fields = {}) => send({ id: `dmg-${++ids}`, actorId: 'thorin', kind: 'damage', use, dice, ...fields })
const useCard = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.use === id)
const attackMessage = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.request === id)
const faces = roll => roll.dice.map(die => die.results.map(r => r.result))
const workflowOf = id => midi.made.find(w => w.workflowOptions.sendingStone === id)

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex'], rolls: true, attacks: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'], rolls: true, attacks: false },
])
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.equal(diceStatus.attacks, true, `attack self-test: ${diceStatus.attacksError}`)
assert.equal(diceStatus.modifiers, true, `modifiers self-test: ${diceStatus.modifiersError}`)
const hellos = Object.fromEntries(app.events.filter(e => e.type === 'bridge.hello').map(e => [e.campaign.title, e.data.features.rolls.kinds]))
const checks = ['skill', 'tool', 'ability', 'save', 'death', 'initiative', 'hitDie', 'hitDice', 'formula']
// A description's own roll everywhere, and its damage where players may attack; asking the table
// needs dnd5e's roll labels, which this world hasn't.
// Ending an enchantment wherever uses are made (module 0.21.0). Ending a concentration wherever
// rolls are made, and spending charges and Heroic Inspiration wherever players may attack (0.29.0).
// Changed on purpose (round 0.36.0 §3.1): damage on its own and recharges wherever players may attack.
// Changed on purpose (round 0.36.0 §6.13): ending a turn wherever rolls are made, after ending a concentration.
// Changed on purpose (round 0.36.0 §6.14): and taking one back, right after it.
assert.deepEqual(hellos, {
  Ashlands: [...checks, 'endConcentration', 'endTurn', 'undoEndTurn', 'attack', 'use', 'damage', 'endEnchantment', 'spend', 'inspiration', 'textRoll', 'textDamage', 'itemDamage', 'recharge'],
  Mirkwood: [...checks, 'endConcentration', 'endTurn', 'undoEndTurn', 'textRoll'],
})
const areas = Object.fromEntries(app.events.filter(e => e.type === 'bridge.hello').map(e => [e.campaign.title, e.data.features.rolls.areaAttacks]))
assert.deepEqual(areas, { Ashlands: true, Mirkwood: false })
ok("passes the attack self-test with dnd5e's damage rolls, and offers attacks, area attacks among them, only where the Gamemaster lets players attack")

// Each campaign's sheets follow its hello, each in a post of its own.
const updatedIn = title => app.events.filter(e => (e.type === 'character.updated') && (e.campaign.title === title)).map(e => e.data.character.id)
await until(() => updatedIn('Ashlands').length >= 2 && updatedIn('Mirkwood').length >= 1, 'the sheets after the hellos')
assert.deepEqual([updatedIn('Ashlands').slice(0, 2), updatedIn('Mirkwood').slice(0, 1)], [['thorin', 'vex'], ['vex']])
const sheet = app.events.find(e => (e.type === 'character.updated') && (e.campaign.title === 'Ashlands') && (e.data.character.id === 'thorin')).data.character.sheet
const feature = name => sheet.features.flatMap(section => section.features).find(f => f.name === name)
assert.deepEqual(feature('Breath').attackArea, { count: null, perLevel: null, affects: 'creature' })
assert.deepEqual(feature('Acid Spray').attackArea, { count: 2, perLevel: null, affects: 'creature' })
const axe = sheet.inventory.sections.flatMap(section => section.items).find(i => i.name === 'Battleaxe')
assert.deepEqual(['attackArea' in feature('Lucky Charm'), 'attackArea' in axe, axe.attackId], [false, false, 'axe-swing'])
ok("the sheet says whom an area attack is made at, and nothing of it for an attack at one target")

// ---- Dice damage takes away (module 0.21.0) ----
// Each die's sign as dnd5e reads damage's when it adds it up (aggregate-damage-rolls.mjs: chunkTerms),
// on terms built by hand, as Foundry's parse keeps runs of operators that this one folds: a + or a -
// ends a group, each - turns the sign over, and * keeps a group together.
{
  const { plannedDice, subtractedTerms } = await import(`${MODULE}/scripts/dice-plan.mjs`)
  const { NumericTerm, OperatorTerm } = foundry.dice.terms
  const op = operator => new OperatorTerm({ operator })
  const num = number => new NumericTerm({ number })
  const die = (number, faces) => new CONFIG.Dice.terms.d({ number, faces })
  const takenOf = terms => {
    const taken = subtractedTerms(terms)
    return terms.filter(term => taken.has(term)).map(term => `${term.number}d${term.faces}`)
  }
  for (const [terms, taken] of [
    [[die(1, 8), op('+'), op('-'), die(1, 4)], ['1d4']],
    [[op('-'), op('-'), die(1, 4)], []],
    [[num(5), op('-'), num(2), op('*'), die(1, 4)], ['1d4']],
    [[op('-'), die(1, 4), op('+'), die(2, 6)], ['1d4']],
    [[die(1, 6), op('-'), die(1, 4), op('*'), num(2), op('+'), die(1, 8)], ['1d4']],
  ]) assert.deepEqual(takenOf(terms), taken, terms.map(term => term.expression).join(' '))
  const planned = plannedDice(new CONFIG.Dice.DamageRoll('1d8 - 1d4 + 3'))
  const expected = { plannable: true, dice: [{ faces: 8, number: 1 }, { faces: 4, number: 1, subtracted: true }] }
  assert.deepEqual(planned, expected)
  assert.equal(JSON.stringify(planned), JSON.stringify(expected))
  ok("the dice damage takes away are those dnd5e reads as taken away: a - turns a group's sign over, a - after a - turns it back, and * keeps a die with the number it's taken away with; planned, they're marked so")

  // Damage whose dice can't be planned has none to mark: its formula, as written, says whether it
  // takes a die away, the app's own table (damage-modifiers.test.ts) reading each the same, at each
  // depth of parentheses, as the `(1d4 * -1)` Foundry's parser may make of a leading -1d4.
  const { formulaTakesAway } = await import(`${MODULE}/scripts/dice-plan.mjs`)
  for (const [formula, taken] of [
    ['1d3 + 3 - 1d4', true],
    ['1d3 + 3', false],
    ['1d3 - 1', false],
    ['1d3 + -1', false],
    ['-1 + 1d3', false],
    ['-1d4 + 2d6', true],
    ['(1d4 * -1) + 2d6', true],
    ['- - 1d4 + 1d3', false],
    ['5 - 2 * 1d4', true],
    ['1d6 - 1d4 * -1', false],
    ['1d6 - (1 - 1d4)', false],
    ['1d3 - (1d4 + 1)', true],
    ['(floor(3 / 2))d8 + 3 - 1d8', true],
    ['max(1d3 - 1, 1)', false],
    ['1d3[bludgeoning] + 3 - 1d4[necrotic]', true],
    ['1d3[non-magical] + 3', false],
    ['2d6r<=2 + 7 + 1d8', false],
  ]) assert.equal(formulaTakesAway(formula), taken, formula)
  assert.equal(formulaTakesAway(undefined), false)
  ok("damage whose dice can't be planned takes a die away where its formula has one in a group a - makes negative, as dnd5e reads signs, at each depth of parentheses")
}

// ---- What a critical hit adds ----
// Savage Attacks' extra die on a melee weapon's critical hit, and an attack's critical damage, as
// dnd5e makes them (attack-data.mjs:326-328, 410-413; damage-roll.mjs:160-230), planned and taken
// on dnd5e's path and Midi's, under dnd5e's rules for critical hits: Midi's own aren't stood in for
// on the attack path. Thorin's Strength modifier is 3.
async function criticalAdditions() {
  thorin.flags.dnd5e.meleeCriticalDamageDice = 1
  thorin.items.get('arrows').updateSource({ 'system.quantity': 5 })
  const crit = { dice: [{ faces: 20, results: [20] }] }
  const liveActivity = (use, item, id) => (MIDI ? workflowOf(use).activity : thorin.items.get(item).system.activities.get(id))
  const posted = () => messages.size
  const damageOf = (use, dealt) => (MIDI ? workflowOf(use).damageRolls?.[0] : attackMessage(dealt.id)?.rolls[0])

  // A greataxe's natural 20: its die three times over, and its critical damage after, marked added.
  const cleave = await attack({ item: 'greataxe', activity: 'cleave', ...crit })
  assert.equal(cleave.status, 'done', JSON.stringify(cleave))
  assert.equal(cleave.attack.critical, true)
  assert.deepEqual(cleave.damage.rolls.map(r => [r.formula, r.dice, r.perDie]), [['3d12 + 3 + 1d6', [{ faces: 12, number: 3 }, { faces: 6, number: 1, added: true }], 2]])
  const cleaved = await damage(cleave.id, [{ faces: 12, results: [2, 7, 11] }, { faces: 6, results: [5] }])
  assert.equal(cleaved.status, 'done', JSON.stringify(cleaved))
  assert.deepEqual([damageOf(cleave.id, cleaved).formula, faces(damageOf(cleave.id, cleaved)), cleaved.rolls[0].total], ['3d12 + 3 + 1d6', [[2, 7, 11], [5]], 2 + 7 + 11 + 5 + 3])
  // A die more, made a d10: the greataxe's own die, never its critical damage's.
  const more = await attack({ item: 'greataxe', activity: 'cleave', ...crit })
  const moreDealt = await damage(more.id, [{ faces: 10, results: [1, 2, 3, 4, 5] }, { faces: 6, results: [6] }], { modifiers: { extra: 1, faces: 10 } })
  assert.equal(moreDealt.status, 'done', JSON.stringify(moreDealt))
  assert.deepEqual([damageOf(more.id, moreDealt).formula, moreDealt.rolls[0].total], ['5d10 + 3 + 1d6', 15 + 6 + 3])
  // Powerful Critical: its die once more, the most it could roll, and its critical damage.
  settings.set('criticalDamageMaxDice', true)
  const powerful = await attack({ item: 'greataxe', activity: 'cleave', ...crit })
  settings.set('criticalDamageMaxDice', false)
  assert.deepEqual(powerful.damage.rolls.map(r => [r.formula, r.dice, r.perDie]), [['2d12 + 3 + 12 + 1d6', [{ faces: 12, number: 2 }, { faces: 6, number: 1, added: true }], 1]])
  const hit = await attack({ item: 'greataxe', activity: 'cleave' })
  assert.deepEqual(hit.damage.rolls.map(r => [r.formula, r.dice]), [['1d12 + 3', [{ faces: 12, number: 1 }]]])
  ok(`a melee weapon's critical hit throws its wielder's extra die and its critical damage, planned as dnd5e makes them, its critical damage's marked added and never changed${MIDI ? ', into Midi\'s workflow' : ''}; with Powerful Critical, its extra die thrown with its own`)

  // Only a melee weapon attack's base damage: not thrown, off-hand or not, not a bow's, not a feat's.
  const dice = async (item, activity, fields = {}) => (await attack({ item, activity, ...crit, ...fields })).damage.rolls[0].dice
  assert.deepEqual(await dice('handaxe', 'hack'), [{ faces: 6, number: 3 }])
  assert.deepEqual(await dice('handaxe', 'hack', { attackMode: 'thrown' }), [{ faces: 6, number: 2 }])
  assert.deepEqual(await dice('handaxe', 'hack', { attackMode: 'thrown-offhand' }), [{ faces: 6, number: 2 }])
  assert.deepEqual(await dice('bow', 'bow-shot'), [{ faces: 8, number: 2 }])
  assert.deepEqual(await dice('claws', 'claws-rake'), [{ faces: 6, number: 2 }])
  const cleaver = thorin.items.get('greataxe').system.activities.get('cleave')
  assert.deepEqual([cleaver.getActionType(), cleaver.getActionType('ranged'), cleaver.getActionType('thrown-offhand')], ['mwak', 'rwak', 'rwak'])
  ok("extra dice only on a melee weapon attack's base damage: not thrown, off-hand or not, nor a bow's, nor a feat's")

  // An unarmed strike of a number, with critical damage of a die: no extra die, as dnd5e throws none
  // on a number, and no die of its own to throw more of.
  const punch = await attack({ item: 'unarmed', activity: 'unarmed-strike', ...crit })
  assert.deepEqual(punch.damage.rolls.map(r => [r.formula, r.dice]), [['1 + 3 + 1d4', [{ faces: 4, number: 1, added: true }]]])
  let before = posted()
  const extra = await damage(punch.id, [{ faces: 4, results: [1, 2, 3] }], { modifiers: { extra: 1 } })
  assert.deepEqual([extra.status, extra.reason, extra.error], ['failed', 'invalid', 'dice'])
  assert.deepEqual([posted(), useCard(punch.id).flags['sending-stone'].damage], [before, undefined])
  if (MIDI) assert.equal(workflowOf(punch.id).damageRolls, null)
  const punched = await damage(punch.id, [{ faces: 4, results: [3] }])
  assert.equal(punched.status, 'done', JSON.stringify(punched))
  assert.deepEqual([damageOf(punch.id, punched).formula, punched.rolls[0].total], ['1 + 3 + 1d4', 7])
  ok('damage whose only die is its critical damage\'s has none to throw more of: refused, with no card and no roll, and rolled as it is')

  // Damage changed since its preview, so that it can't take the player's dice: refused once built,
  // nothing posted and no damage noted; rolled once it can.
  const guarded = await attack({ item: 'greataxe', activity: 'cleave', ...crit })
  const planned = [{ faces: 12, results: [3, 3, 3] }, { faces: 6, results: [4] }]
  liveActivity(guarded.id, 'greataxe', 'cleave').damage.critical.bonus = ''
  before = posted()
  const unplanned = await damage(guarded.id, planned)
  assert.deepEqual([unplanned.status, unplanned.reason, unplanned.error], ['failed', 'invalid', 'dice'])
  assert.deepEqual([posted(), useCard(guarded.id).flags['sending-stone'].damage], [before, undefined])
  if (MIDI) {
    const flow = workflowOf(guarded.id)
    assert.deepEqual([flow.damageRolls, flow.currentAction === flow.WorkflowState_WaitForDamageRoll], [null, true])
  }
  liveActivity(guarded.id, 'greataxe', 'cleave').damage.critical.bonus = '1d6'
  const retried = await damage(guarded.id, planned)
  assert.equal(retried.status, 'done', JSON.stringify(retried))
  assert.equal(retried.rolls[0].total, 9 + 4 + 3)
  ok(`damage that can't take the player's dice once built is refused as their dice, posting nothing${MIDI ? ', its workflow still waiting for it' : ''}; rolled again, it's made`)

  // A second damage roll made with the same plan, as Midi's other damage, is neither changed nor
  // checked: only the first is the player's.
  const { withPlan } = await import(`${MODULE}/scripts/dice-plan.mjs`)
  const twice = { id: 'twice', kind: 'damage', dice: [{ faces: 8, results: [1, 2, 3, 4] }], modifiers: { extra: 1 } }
  const config = () => ({ hookNames: ['damage'], isCritical: true, sendingStone: 'twice', rolls: [{ parts: ['1d8 + 2'], data: {}, options: {} }] })
  const builds = await withPlan(twice, async () => [
    await DamageRoll.build(config(), { configure: false }, { create: false }),
    await DamageRoll.build(config(), { configure: false }, { create: false }),
  ])
  assert.deepEqual(builds.map(rolls => rolls.map(roll => roll.formula)), [['4d8 + 2'], ['2d8 + 2']])
  assert.deepEqual(faces(builds[0][0]), [[1, 2, 3, 4]])
  ok("a second damage roll made with the player's, as Midi's other damage, is neither changed nor checked")
  delete thorin.flags.dnd5e.meleeCriticalDamageDice
}

// ---- Damage that takes a die away (module 0.21.0) ----
// Reduce's - 1d4 on melee weapon attacks: dnd5e builds a greataxe's `1d12 - 1d4 + 3`; this port keeps
// `@mod` in the part, so it builds `1d12 + 3 - 1d4`, its dice in the same order. More dice, or another
// die, are the damage's own that it adds, never the one it takes away; nor is it rolled at its
// highest, which would take the most away. A critical hit doubles the die taken away, as dnd5e does.
async function reducedDamage() {
  const reduced = thorin.system.bonuses.mwak
  thorin.system.bonuses.mwak = { damage: '- 1d4' }
  const crit = { dice: [{ faces: 20, results: [20] }] }
  const posted = () => messages.size
  const damageOf = (use, dealt) => (MIDI ? workflowOf(use).damageRolls?.[0] : attackMessage(dealt.id)?.rolls[0])
  const preview = made => made.damage.rolls.map(r => [r.formula, r.dice, r.perDie])
  const nothingPosted = (use, before) => {
    assert.deepEqual([posted(), useCard(use).flags['sending-stone'].damage], [before, undefined])
    if (MIDI) assert.equal(workflowOf(use).damageRolls, null)
  }
  const refusedAs = (made, error) => assert.deepEqual([made.status, made.reason, made.error], ['failed', 'invalid', error], JSON.stringify(made))

  // An unarmed strike of a number: its only die is the one it takes away, so it has none to change.
  const punch = await attack({ item: 'unarmed', activity: 'unarmed-strike' })
  assert.deepEqual(preview(punch), [['1 + 3 - 1d4', [{ faces: 4, number: 1, subtracted: true }], 1]])
  let before = posted()
  refusedAs(await damage(punch.id, [{ faces: 4, results: [1, 2] }], { modifiers: { extra: 1 } }), 'dice')
  refusedAs(await damage(punch.id, [{ faces: 4, results: [3] }], { modifiers: { maximize: true } }), 'modifiers')
  nothingPosted(punch.id, before)
  const punched = await damage(punch.id, [{ faces: 4, results: [3] }])
  assert.equal(punched.status, 'done', JSON.stringify(punched))
  assert.deepEqual([damageOf(punch.id, punched).formula, punched.rolls[0].total], ['1 + 3 - 1d4', 1])
  // Its critical hit: the die taken away doubled, its critical damage added, no extra die on a number.
  thorin.flags.dnd5e.meleeCriticalDamageDice = 1
  const critPunch = await attack({ item: 'unarmed', activity: 'unarmed-strike', ...crit })
  assert.deepEqual(preview(critPunch), [['1 + 3 - 2d4 + 1d4', [{ faces: 4, number: 2, subtracted: true }, { faces: 4, number: 1, added: true }], 2]])
  const critPunched = await damage(critPunch.id, [{ faces: 4, results: [1, 2] }, { faces: 4, results: [3] }])
  assert.equal(critPunched.status, 'done', JSON.stringify(critPunched))
  assert.equal(critPunched.rolls[0].total, 4)
  delete thorin.flags.dnd5e.meleeCriticalDamageDice
  ok(`damage whose only die it takes away, as a dice-less unarmed strike's under Reduce, has none to change, nor is it rolled at its highest: refused, with no card${MIDI ? ' and no roll in its workflow' : ''}; rolled as it is, and as a critical hit's, the die doubled`)

  // A greataxe: its own d12 changed, the d4 left as it is.
  const cleave = await attack({ item: 'greataxe', activity: 'cleave' })
  assert.deepEqual(preview(cleave), [['1d12 + 3 - 1d4', [{ faces: 12, number: 1 }, { faces: 4, number: 1, subtracted: true }], 1]])
  before = posted()
  refusedAs(await damage(cleave.id, [{ faces: 12, results: [5] }, { faces: 4, results: [1, 2] }], { modifiers: { extra: 1 } }), 'dice')
  refusedAs(await damage(cleave.id, [{ faces: 12, results: [5] }, { faces: 4, results: [2] }], { modifiers: { maximize: true } }), 'modifiers')
  nothingPosted(cleave.id, before)
  const cleaved = await damage(cleave.id, [{ faces: 10, results: [4, 5] }, { faces: 4, results: [2] }], { modifiers: { extra: 1, faces: 10 } })
  assert.equal(cleaved.status, 'done', JSON.stringify(cleaved))
  assert.deepEqual([damageOf(cleave.id, cleaved).formula, faces(damageOf(cleave.id, cleaved)), cleaved.rolls[0].total], ['2d10 + 3 - 1d4', [[4, 5], [2]], 10])
  // Its critical hit with Savage Attacks: the extra die on its d12, the d4 doubled, critical damage after.
  thorin.flags.dnd5e.meleeCriticalDamageDice = 1
  const savage = await attack({ item: 'greataxe', activity: 'cleave', ...crit })
  assert.deepEqual(preview(savage), [['3d12 + 3 - 2d4 + 1d6', [{ faces: 12, number: 3 }, { faces: 4, number: 2, subtracted: true }, { faces: 6, number: 1, added: true }], 2]])
  const savaged = await damage(savage.id, [{ faces: 12, results: [1, 2, 3, 4, 5] }, { faces: 4, results: [1, 1] }, { faces: 6, results: [6] }], { modifiers: { extra: 1 } })
  assert.equal(savaged.status, 'done', JSON.stringify(savaged))
  assert.deepEqual([damageOf(savage.id, savaged).formula, savaged.rolls[0].total], ['5d12 + 3 - 2d4 + 1d6', 22])
  delete thorin.flags.dnd5e.meleeCriticalDamageDice
  ok(`a weapon's damage under Reduce has its own die changed, never the one it takes away, as a critical hit's with its extra and critical dice too${MIDI ? ', into Midi\'s workflow' : ''}; at its highest it's refused`)

  // A brass knuckle's d3, which no player rolls: the game rolls its damage itself, with no dice to
  // mark; its formula takes the d4 away, so it isn't rolled at its highest either, which would take
  // the most away. Rolled as it is; and at its highest without Reduce.
  const knuckle = await attack({ item: 'fist', activity: 'fist-punch' })
  assert.deepEqual([knuckle.damage.plannable, preview(knuckle)], [false, [['1d3 + 3 - 1d4', [], 1]]])
  before = posted()
  refusedAs(await damage(knuckle.id, [], { modifiers: { maximize: true } }), 'modifiers')
  nothingPosted(knuckle.id, before)
  const knuckled = await damage(knuckle.id, [])
  assert.equal(knuckled.status, 'done', JSON.stringify(knuckled))
  assert.equal(damageOf(knuckle.id, knuckled).formula, '1d3 + 3 - 1d4')
  thorin.system.bonuses.mwak = reduced
  const brass = await attack({ item: 'fist', activity: 'fist-punch' })
  const brassed = await damage(brass.id, [], { modifiers: { maximize: true } })
  assert.equal(brassed.status, 'done', JSON.stringify(brassed))
  assert.deepEqual([damageOf(brass.id, brassed).formula, brassed.rolls[0].total], ['1d3 + 3', 6])
  thorin.system.bonuses.mwak = { damage: '- 1d4' }
  ok(`damage the game rolls itself whose formula takes a die away, as a d3's under Reduce, isn't rolled at its highest either: refused, with no card${MIDI ? ' and no roll in its workflow' : ''}; rolled as it is, and at its highest where it takes none away`)

  // Ray of Enfeeblement's - 1d8 on a dice-less unarmed strike: Foundry's total, below 0.
  thorin.system.bonuses.mwak = { damage: '- 1d8' }
  const feeble = await attack({ item: 'unarmed', activity: 'unarmed-strike' })
  const enfeebled = await damage(feeble.id, [{ faces: 8, results: [8] }])
  assert.equal(enfeebled.status, 'done', JSON.stringify(enfeebled))
  assert.equal(enfeebled.rolls[0].total, -4)
  ok("damage that takes away more than it adds comes to Foundry's own total, below 0")
  thorin.system.bonuses.mwak = reduced
}

// ---- Spells items cast higher (module 0.20.0) ----
// An attack spell a staff casts at the level chosen, for more charges, its damage as dnd5e scales its
// copy; and the targets a spell takes, cast from an item above its own level and higher again.
async function castsHigher() {
  const inventory = sheet.inventory.sections.flatMap(section => section.items)
  const owned = id => inventory.find(i => i.id === id)
  const charges = id => thorin.items.get(id).system.uses.spent
  const level = (level, charges) => ({ level, charges, short: false })
  assert.deepEqual(owned('bolt-staff').cast.levels, [level(1, 1), level(2, 2), level(3, 3)])
  const guided = await attack({ item: 'bolt-staff', activity: 'cast-guide', slot: 'spell3' })
  assert.equal(guided.status, 'done', JSON.stringify(guided))
  assert.deepEqual([charges('bolt-staff'), useCard(guided.id).system.scaling, guided.damage.rolls[0].dice], [3, 2, [{ faces: 6, number: 6 }]])
  ok(`a staff's Guiding Bolt attacks at the level chosen, for as many more charges, its damage a die more a level${MIDI ? ', through Midi\'s workflow' : ''}`)

  assert.deepEqual(owned('bright-staff').cast.levels, [level(2, 2), level(3, 3)])
  const bright = await attack({ item: 'bright-staff', activity: 'cast-bright', slot: 'spell3' })
  assert.equal(bright.status, 'done', JSON.stringify(bright))
  assert.deepEqual([charges('bright-staff'), bright.damage.rolls[0].dice], [3, [{ faces: 6, number: 5 }]])
  ok("cast from a Cast activity above its spell's level, and higher again, it costs more charges, but its damage stays at the Cast activity's level, as dnd5e scales the copy")

  assert.deepEqual(owned('mm-ring').activity.targets, { self: false, area: false, count: 4, perLevel: 1, affects: 'creature', fromSelf: false })
  // Its copy on the Spells tab counts from the level the ring casts it at too, as dnd5e scales the
  // copy: no longer nothing, as before module 0.20.0, for a Cast activity above the spell's level.
  const ringCopy = sheet.spells.flatMap(section => section.spells).find(spell => spell.id === 'ring-mm')
  assert.deepEqual(ringCopy.activity.targets, { self: false, area: false, count: 4, perLevel: 1, affects: 'creature', fromSelf: false })
  // Three rats join the fight, for five targets in all.
  const rats = ['rat1', 'rat2', 'rat3'].map(id => ({ id, ...foe(id, 'Rat', 10) }))
  for (const { id, actor, token } of rats) combatant(fight, `cb-${id}`, actor, { token })
  if (MIDI) canvas.scene.tokens.size = placeables.size
  const useDarts = (count, slot) => send({ id: `use-${++ids}`, actorId: 'thorin', kind: 'use', item: 'mm-ring', activity: 'cast-ring-mm',
    targets: ['cb-gob', 'cb-ogre', 'cb-rat1', 'cb-rat2', 'cb-rat3'].slice(0, count).map(id => target(id)), slot })
  const tooMany = await useDarts(5, 'spell2')
  assert.deepEqual([tooMany.status, tooMany.reason], ['failed', 'target'])
  const darts = await useDarts(5, 'spell3')
  for (const { id } of rats) { fight.combatants.delete(`cb-${id}`); placeables.delete(`tok-${id}`); actors.delete(id) }
  if (MIDI) canvas.scene.tokens.size = placeables.size
  assert.equal(darts.status, 'done', JSON.stringify(darts))
  assert.deepEqual([charges('mm-ring'), useCard(darts.id).system.scaling], [3, 2])
  assert.deepEqual(screen.notifications, [], 'nothing was said on the Gamemaster\'s screen')
  ok("Magic Missile from a ring at 2nd takes four darts' targets, one more a level: not five there, but five cast a level higher")
}

// ---- Dice with modifiers (module 0.22.0) ----
// Damage whose dice Foundry rolls again, keeps, raises or counts, as a Great Weapon Fighter's
// `2d6r<=2`: planned as each die's number, its first throw, which is the player's; a reroll or an
// explosion is Foundry's, and its total the game's. Damage with a die that explodes, or rerolls on
// its highest face, isn't rolled at its highest: Foundry would roll it again.
async function modifiedDamage() {
  const axe = thorin.items.get('greataxe')
  const source = axe._source.activities.find(activity => activity.id === 'cleave')
  const original = source.damage
  const hp = goblin.actor.system.attributes.hp.value
  const posted = () => messages.size
  const damageOf = (use, dealt) => (MIDI ? workflowOf(use).damageRolls?.[0] : attackMessage(dealt.id)?.rolls[0])
  const shown = die => die.results.map(r => [r.result, r.active])
  // The greataxe's damage written as given, an attack with it, and its damage with the dice given.
  const thrown = async (formula, dice, fields = {}) => {
    source.damage = [{ custom: formula, types: ['slashing'] }]
    axe.updateSource({})
    try {
      const made = await attack({ item: 'greataxe', activity: 'cleave' })
      assert.equal(made.status, 'done', JSON.stringify(made))
      const before = posted()
      const dealt = await damage(made.id, dice, fields)
      return { made, dealt, before, roll: (dealt.status === 'done') ? damageOf(made.id, dealt) : null }
    } finally {
      source.damage = original
      axe.updateSource({})
      goblin.actor.system.attributes.hp.value = hp
    }
  }

  // A d6 rerolled on a 2 or less, a d8 and 7: the player's 1 rerolled by Foundry, once, their 5 and 3.
  const gwf = await thrown('2d6r<=2 + 1d8 + 7', [{ faces: 6, results: [1, 5] }, { faces: 8, results: [3] }])
  assert.deepEqual(gwf.made.damage.rolls.map(r => [r.formula, r.dice]), [['2d6r<=2 + 1d8 + 7', [{ faces: 6, number: 2 }, { faces: 8, number: 1 }]]])
  assert.equal(gwf.dealt.status, 'done', JSON.stringify(gwf.dealt))
  const [sixes, eight] = gwf.roll.dice
  const seeded = sixes.results[2]?.result
  assert.ok(Number.isInteger(seeded), 'Foundry rerolled the 1')
  assert.deepEqual([shown(sixes), sixes.results[0].rerolled, shown(eight)], [[[1, false], [5, true], [seeded, true]], true, [[3, true]]])
  assert.equal(gwf.dealt.rolls[0].total, 5 + seeded + 3 + 7)
  assert.deepEqual(gwf.dealt.rolls[0].dice.map(die => [die.expression, die.results]), [
    ['2d6r<=2', [{ result: 1, active: false }, { result: 5, active: true }, { result: seeded, active: true }]], ['1d8', [{ result: 3, active: true }]],
  ])
  ok(`damage whose d6s reroll on a 2 or less is planned as its two dice, the player's first throw; the reroll of their 1 is Foundry's, once, and the total the game's${MIDI ? ', into Midi\'s workflow' : ''}`)

  // The highest three of four d6s; two d6s each counting at least 3; six d6s each counting 1 on a 5
  // or more; an exploding d6.
  for (const [formula, dice, total] of [
    ['4d6kh3', [{ faces: 6, results: [1, 2, 3, 4] }], 9],
    ['2d6min3', [{ faces: 6, results: [1, 5] }], 8],
    ['6d6cs>=5', [{ faces: 6, results: [5, 6, 1, 2, 3, 4] }], 2],
  ]) {
    const { made, dealt, roll } = await thrown(formula, dice)
    assert.deepEqual(made.damage.rolls[0].dice, dice.map(({ faces, results }) => ({ faces, number: results.length })), formula)
    assert.equal(dealt.status, 'done', JSON.stringify(dealt))
    assert.deepEqual([faces(roll), dealt.rolls[0].total], [dice.map(die => die.results), total], formula)
  }
  const boom = await thrown('1d6x', [{ faces: 6, results: [6] }])
  assert.equal(boom.dealt.status, 'done', JSON.stringify(boom.dealt))
  const [exploding] = boom.roll.dice
  assert.deepEqual([exploding.results[0].result, exploding.results[0].exploded, exploding.results.length > 1], [6, true, true])
  assert.equal(boom.dealt.rolls[0].total, exploding.results.reduce((sum, r) => sum + r.result, 0))
  ok(`damage that keeps the highest of its dice, raises them, counts them or explodes takes the player's dice as its first throw and comes to the game's total: 9 for 1 to 4 kept three, 8 for a 1 raised to 3 and a 5, 2 for a 5 and a 6 counted, their 6 and what Foundry rolls more${MIDI ? ', into Midi\'s workflow' : ''}`)

  // At its highest: refused where a die explodes, or rerolls on its highest face, nothing posted;
  // made where a die rerolls only lower faces.
  for (const [formula, dice] of [
    ['1d6x', [{ faces: 6, results: [6] }]],
    ['2d6xo + 1', [{ faces: 6, results: [6, 6] }]],
    ['1d6r6', [{ faces: 6, results: [6] }]],
    ['1d8 + 1d6rr>5', [{ faces: 8, results: [8] }, { faces: 6, results: [6] }]],
  ]) {
    const { made, dealt, before } = await thrown(formula, dice, { modifiers: { maximize: true } })
    assert.deepEqual([dealt.status, dealt.reason, dealt.error], ['failed', 'invalid', 'modifiers'], formula)
    assert.deepEqual([posted(), useCard(made.id).flags['sending-stone'].damage], [before, undefined], formula)
    if (MIDI) assert.equal(workflowOf(made.id).damageRolls, null)
  }
  const highest = await thrown('2d6r<=2 + 1d8 + 7', [{ faces: 6, results: [6, 6] }, { faces: 8, results: [8] }], { modifiers: { maximize: true } })
  assert.equal(highest.dealt.status, 'done', JSON.stringify(highest.dealt))
  assert.deepEqual([faces(highest.roll), highest.dealt.rolls[0].total], [[[6, 6], [8]], 27])
  ok(`damage with a die that explodes, or rerolls on its highest face, isn't rolled at its highest: refused, with no card${MIDI ? ' and no roll in its workflow' : ''}; one that rerolls only lower faces is`)
}

// ---- The Gamemaster's, as the character (module 0.23.0) ----
// An attack and its damage the Gamemaster made in the app as Thorin: made as his player's, with
// the same dice and the same outcome, every message they make flagged the Gamemaster's.
async function gmAttacks() {
  const mark = m => m.flags?.['sending-stone']?.by
  // A player's own message with the Gamemaster's roll's flags copied onto it, posted from their
  // browser as each message of the roll is made, or marked onto one of theirs (module 0.25.0):
  // never listed in its result.
  const forged = []
  const forge = (message, _options, userId) => {
    const flags = message.flags?.['sending-stone']
    if ((userId !== game.user.id) || (flags?.by !== 'gm')) return
    const copy = fakeMessage(`forged-${forged.length + 1}`, { author: users.get('alice'), speaker: message.speaker, flags: { 'sending-stone': { ...flags } } })
    forged.push(copy.id)
    Hooks.callAll('createChatMessage', copy, {}, 'alice')
    // Or an earlier message of theirs, marked with the roll's flags from their browser.
    const mine = fakeMessage(`marked-${forged.length + 1}`, { author: users.get('alice'), speaker: message.speaker })
    Hooks.callAll('createChatMessage', mine, {}, 'alice')
    forged.push(mine.id)
    Object.assign(mine.flags, { 'sending-stone': { ...flags } })
    Hooks.callAll('updateChatMessage', mine, { flags: { 'sending-stone': { ...flags } } }, {}, 'alice')
  }
  // The messages a result lists: each the Gamemaster's, flagged for its roll, in the order made.
  const ownOf = (posted, id) => posted.filter(m => {
    const flags = m.flags?.['sending-stone']
    return (flags?.by === 'gm') && [flags.request, flags.use, flags.outcome].includes(id)
  }).map(m => m.id)
  const hp = goblin.actor.system.attributes.hp.value
  const madeBy = async by => {
    const before = new Set(messages.keys())
    const made = await attack(by ? { by } : {})
    assert.equal(made.status, 'done', JSON.stringify(made))
    const dealt = await damage(made.id, [{ faces: 8, results: [4] }], by ? { by } : {})
    assert.equal(dealt.status, 'done', JSON.stringify(dealt))
    goblin.actor.system.attributes.hp.value = hp
    const posted = [...messages.values()].filter(m => !before.has(m.id))
    return { made, dealt, posted, ours: posted.filter(m => m.flags?.['sending-stone']) }
  }
  Hooks.on('createChatMessage', forge)
  const gm = await madeBy('gm')
  Hooks.off('createChatMessage', forge)
  const player = await madeBy(null)
  const card = useCard(gm.made.id)
  assert.deepEqual([card.flags['sending-stone'].use, mark(card), card.author.id], [gm.made.id, 'gm', useCard(player.made.id).author.id])
  assert.equal(mark(useCard(player.made.id)), undefined)
  if (!MIDI) {
    // dnd5e's path: the card, the attack roll and the damage roll.
    assert.deepEqual(attackMessage(gm.made.id).flags['sending-stone'], { request: gm.made.id, by: 'gm' })
    assert.deepEqual(attackMessage(gm.dealt.id).flags['sending-stone'], { request: gm.dealt.id, by: 'gm' })
    assert.deepEqual(attackMessage(player.made.id).flags['sending-stone'], { request: player.made.id })
    assert.deepEqual(attackMessage(player.dealt.id).flags['sending-stone'], { request: player.dealt.id })
    assert.deepEqual([gm.posted.length, gm.posted.every(m => mark(m) === 'gm'), attackMessage(gm.made.id).author.id], [3, true, 'alice'])
  } else {
    // Midi's: the attack and damage go on the card, which Midi writes; whatever else it posts is its own.
    assert.deepEqual([faces(workflowOf(gm.made.id).attackRoll), faces(workflowOf(gm.made.id).damageRolls[0])], [[[15]], [[4]]])
  }
  assert.ok(gm.ours.length >= 1 && gm.ours.every(m => mark(m) === 'gm'))
  assert.ok(player.ours.length === gm.ours.length && player.ours.every(m => mark(m) === undefined))
  const strip = ({ id, messageId, messages, ...rest }) => rest
  assert.deepEqual([strip(gm.made), strip(gm.dealt)], [strip(player.made), strip(player.dealt)])
  ok(`the Gamemaster's attack and its damage are made as the player's and told the app alike, every message they make flagged the Gamemaster's${MIDI ? ', through Midi' : ''}; the player's never`)

  // Each result lists the messages its own roll made, in order (module 0.25.0): the attack its card
  // and, by dnd5e, its attack roll; the damage its damage roll. Never the other's, nor a player's
  // copy; a player's result lists none.
  if (!MIDI) {
    assert.deepEqual(gm.made.messages, [card.id, attackMessage(gm.made.id).id])
    assert.deepEqual(gm.dealt.messages, [attackMessage(gm.dealt.id).id])
  } else assert.ok(gm.made.messages.includes(card.id))
  assert.deepEqual([gm.made.messages, gm.dealt.messages], [ownOf(gm.posted, gm.made.id), ownOf(gm.posted, gm.dealt.id)])
  assert.equal(gm.made.messages.length + gm.dealt.messages.length, gm.ours.length)
  assert.ok(forged.length >= 2 && forged.some(id => id.startsWith('marked')) && ![...gm.made.messages, ...gm.dealt.messages].some(id => forged.includes(id)))
  assert.deepEqual(['messages' in player.made, 'messages' in player.dealt], [false, false])
  ok(`the Gamemaster's attack and its damage each list the messages they made, in order, never the other's or a player's copy${MIDI ? ', through Midi' : ''}; the player's list none`)
}

if (!MIDI) {
  // ---- dnd5e's path ----
  const hit = await attack()
  assert.equal(hit.status, 'done', JSON.stringify(hit))
  assert.deepEqual(hit.attack, { critical: false, fumble: false, outcome: 'hit' })
  assert.deepEqual(hit.damage, { critical: false, plannable: true, healing: false, rolls: [{ formula: '1d8 + 3', type: 'Slashing', types: null, dice: [{ faces: 8, number: 1 }], perDie: 1 }] })
  const card = useCard(hit.id)
  const swing = attackMessage(hit.id)
  assert.equal(card.type, 'usage')
  assert.equal(card.author.id, 'alice')
  assert.equal(card.whisper.length, 0)
  assert.deepEqual(card.flags.dnd5e.targets, [{ name: 'Goblin', img: 'goblin.webp', uuid: 'Actor.goblin', ac: 13 }])
  assert.equal(swing.flags.dnd5e.originatingMessage, card.id)
  assert.equal(swing.author.id, 'alice')
  assert.deepEqual(faces(swing.rolls[0]), [[15]])
  assert.equal(swing.rolls[0].total, 21)
  assert.equal(swing.rolls[0].options.target, 13)
  assert.equal(hit.messageId, swing.id)
  assert.deepEqual(screen.subsequent, [], 'no attack dialog opened on the Gamemaster\'s screen')
  assert.equal(screen.templates, 0)
  assert.equal(thorin.items.get('axe').getFlag('dnd5e', 'last.axe-swing.attackMode'), 'oneHanded')
  ok('uses the item as the player, posts its card with the target, and attacks with the player\'s d20, linked to the card')

  const dealt = await damage(hit.id, [{ faces: 8, results: [6] }])
  assert.equal(dealt.status, 'done', JSON.stringify(dealt))
  const wound = [...messages.values()].find(m => m.flags?.['sending-stone']?.request === dealt.id)
  assert.equal(wound.flags.dnd5e.roll.type, 'damage')
  assert.equal(wound.flags.dnd5e.originatingMessage, card.id)
  assert.deepEqual(wound.flags.dnd5e.targets, card.flags.dnd5e.targets)
  assert.deepEqual(faces(wound.rolls[0]), [[6]])
  assert.equal(dealt.rolls[0].total, 9)
  assert.equal(card.flags['sending-stone'].damage, dealt.id)
  const again = await damage(hit.id, [{ faces: 8, results: [6] }])
  assert.deepEqual([again.status, again.reason], ['failed', 'damaged'])
  ok('rolls the damage on the same use with the player\'s dice, once')

  const crit = await attack({ dice: [{ faces: 20, results: [20] }] })
  assert.deepEqual(crit.attack, { critical: true, fumble: false, outcome: 'hit' })
  assert.deepEqual(crit.damage.rolls[0].dice, [{ faces: 8, number: 2 }])
  const critDamage = await damage(crit.id, [{ faces: 8, results: [5, 7] }])
  const critRoll = attackMessage(critDamage.id).rolls[0]
  assert.deepEqual(faces(critRoll), [[5, 7]])
  assert.equal(critRoll.total, 15)
  assert.equal(critRoll.isCritical, true)
  ok('a critical hit\'s damage takes the doubled dice the attack said it would, as dnd5e doubles them')

  const critMore = await attack({ dice: [{ faces: 20, results: [20] }] })
  assert.equal(critMore.damage.rolls[0].perDie, 2)
  const critMoreDamage = await damage(critMore.id, [{ faces: 10, results: [1, 2, 3, 4] }], { modifiers: { extra: 1, faces: 10 } })
  assert.equal(critMoreDamage.status, 'done', JSON.stringify(critMoreDamage))
  const critMoreRoll = attackMessage(critMoreDamage.id).rolls[0]
  assert.deepEqual(faces(critMoreRoll), [[1, 2, 3, 4]])
  assert.equal(critMoreRoll.total, 13)
  assert.equal(critMoreRoll.isCritical, true)
  settings.set('criticalDamageMaxDice', true)
  const brutal = await attack({ dice: [{ faces: 20, results: [20] }] })
  assert.deepEqual([brutal.damage.rolls[0].dice, brutal.damage.rolls[0].perDie], [[{ faces: 8, number: 1 }], 1])
  const brutalDamage = await damage(brutal.id, [{ faces: 8, results: [2, 3] }], { modifiers: { extra: 1 } })
  assert.equal(brutalDamage.status, 'done', JSON.stringify(brutalDamage))
  assert.equal(brutalDamage.rolls[0].total, 2 + 3 + 16 + 3, 'its two dice, the most they could come to, and the modifier')
  settings.set('criticalDamageMaxDice', false)
  ok('a critical hit\'s damage with a die more takes as many more as the world\'s rules for critical hits make of each: two d10s more, made d10s; or one, with dice maximized')

  const miss = await attack({ target: target('cb-ogre'), dice: [{ faces: 20, results: [5] }] })
  assert.deepEqual(miss.attack, { critical: false, fumble: false, outcome: 'miss' })
  settings.set('attackRollVisibility', 'none')
  const unseen = await attack({ target: target('cb-ogre'), dice: [{ faces: 20, results: [5] }] })
  assert.equal(unseen.attack.outcome, null)
  // Module 0.31.0: with Hit/miss and save results in the app Always, told under Hide all too, and
  // still with no armor class.
  settings.set('chatResults', 'always')
  const always = await attack({ target: target('cb-ogre'), dice: [{ faces: 20, results: [5] }] })
  assert.deepEqual(always.attack, { critical: false, fumble: false, outcome: 'miss' })
  assert.ok(!JSON.stringify(always).includes('"ac"'), 'no armor class')
  settings.delete('chatResults')
  settings.set('attackRollVisibility', 'hideAC')
  ok('says whether an attack hit only as dnd5e shows players, or always where the Gamemaster has players told so (0.31.0), and never the armor class')

  const adv = await attack({ mode: 1, explicit: true, extras: [{ sign: 1, count: 1, sides: 4 }], dice: [{ faces: 20, results: [4, 17] }, { faces: 4, results: [3] }] })
  const advRoll = attackMessage(adv.id).rolls[0]
  assert.deepEqual(faces(advRoll), [[4, 17], [3]])
  assert.equal(advRoll.total, 17 + 3 + 6)
  ok('rolls the attack as the player chose, with what they added, as checks are')

  const shot = await attack({ item: 'bow', activity: 'bow-shot' })
  assert.equal(shot.status, 'done', JSON.stringify(shot))
  assert.equal(thorin.items.get('arrows').system.quantity, 1)
  assert.equal(attackMessage(shot.id).flags.dnd5e.roll.ammunition, 'arrows')
  await attack({ item: 'bow', activity: 'bow-shot' })
  assert.equal(thorin.items.get('arrows').system.quantity, 0)
  const empty = await attack({ item: 'bow', activity: 'bow-shot' })
  assert.deepEqual([empty.status, empty.reason], ['failed', 'ammo'])
  ok('spends ammunition as dnd5e does, and refuses a weapon with none left')

  const bolt = await attack({ item: 'bolt', activity: 'bolt-cast' })
  assert.equal(bolt.status, 'done', JSON.stringify(bolt))
  assert.equal(thorin.system.spells.spell2.value, 0)
  assert.equal(thorin.system.spells.spell1.value, 0)
  assert.equal(useCard(bolt.id).system.scaling, 1)
  assert.deepEqual(bolt.damage.rolls[0].dice, [{ faces: 6, number: 5 }])
  const radiant = await damage(bolt.id, [{ faces: 6, results: [1, 2, 3, 4, 5] }])
  assert.equal(radiant.rolls[0].total, 15)
  const noSlot = await attack({ item: 'bolt', activity: 'bolt-cast' })
  assert.deepEqual([noSlot.status, noSlot.reason], ['failed', 'consume'])
  assert.match(noSlot.error, /SpellCastNoSlots/)
  assert.deepEqual(screen.notifications, [], 'nothing was said on the Gamemaster\'s screen')
  ok('casts with the first slot left, as dnd5e\'s dialog would pick it, scales the damage, and refuses with no slot left')

  const charm = await attack({ item: 'charm', activity: 'charm-zap' })
  assert.equal(charm.status, 'done')
  assert.equal(thorin.items.get('charm').system.uses.spent, 1)
  const spent = await attack({ item: 'charm', activity: 'charm-zap' })
  assert.deepEqual([spent.status, spent.reason], ['failed', 'consume'])
  ok('spends an item\'s uses, and refuses one used up')

  for (const [fields, reason] of [
    [{ item: 'axe', activity: 'nope' }, 'activity'],
    [{ item: 'nope', activity: 'axe-swing' }, 'item'],
    [{ target: target('cb-kob') }, 'target'],
    [{ target: target('cb-nobody') }, 'target'],
    [{ target: target('cb-gob', 'other') }, 'target'],
    [{ actorId: 'goblin' }, 'unknown'],
    [{ dice: [{ faces: 20, results: [21] }] }, 'invalid'],
    [{ target: { combatId: 'fight' } }, 'invalid'],
  ]) {
    const refused = await attack(fields)
    assert.deepEqual([refused.status, refused.reason], ['failed', reason], JSON.stringify(fields))
  }
  assert.equal(screen.templates, 0)
  ok('refuses what the character hasn\'t, and targets it can\'t see')

  // ---- Area attacks ----
  const area = (fields = {}) => attack({
    item: 'breath', activity: 'breath-blast', target: undefined, targets: [target('cb-gob'), target('cb-ogre')],
    dice: [{ faces: 20, results: [12] }], ...fields,
  })
  const picked = outcomes => outcomes.map(([combatantId, outcome]) => ({ combatId: 'fight', combatantId, outcome }))
  const breathed = await area()
  assert.equal(breathed.status, 'done', JSON.stringify(breathed))
  assert.deepEqual(breathed.attack, { critical: false, fumble: false, outcome: null, targets: picked([['cb-gob', 'hit'], ['cb-ogre', 'miss']]) })
  const blast = attackMessage(breathed.id)
  assert.deepEqual([faces(blast.rolls[0]), blast.rolls[0].total, blast.rolls[0].options.target ?? null], [[[12]], 18, null])
  assert.deepEqual([useCard(breathed.id).flags.dnd5e.targets.map(t => t.name), blast.flags.dnd5e.targets.map(t => t.name)], [['Goblin', 'Ogre'], ['Goblin', 'Ogre']])
  assert.deepEqual(breathed.damage.rolls[0].dice, [{ faces: 6, number: 2 }])
  const scorched = await damage(breathed.id, [{ faces: 6, results: [3, 4] }])
  assert.equal(scorched.status, 'done', JSON.stringify(scorched))
  assert.deepEqual([scorched.rolls[0].total, attackMessage(scorched.id).flags.dnd5e.targets.map(t => t.name)], [7, ['Goblin', 'Ogre']])
  assert.deepEqual([screen.templates, screen.subsequent, screen.notifications], [0, [], []])
  ok('an area attack is made at the targets picked, without a template, its roll against no armor class, and says whether it hit each, in the order picked')

  const alone = await area({ targets: [target('cb-gob')] })
  assert.deepEqual(alone.attack, { critical: false, fumble: false, outcome: 'hit', targets: picked([['cb-gob', 'hit']]) })
  assert.equal(attackMessage(alone.id).rolls[0].options.target, 13)
  const older = await area({ target: target('cb-ogre'), targets: undefined })
  assert.deepEqual(older.attack, { critical: false, fumble: false, outcome: 'miss', targets: picked([['cb-ogre', 'miss']]) })
  const nobody = await area({ targets: [] })
  assert.deepEqual(nobody.attack, { critical: false, fumble: false, outcome: null, targets: [] })
  settings.set('attackRollVisibility', 'none')
  const hidden = await area()
  settings.set('attackRollVisibility', 'hideAC')
  assert.deepEqual(hidden.attack.targets, picked([['cb-gob', null], ['cb-ogre', null]]))
  const sprayed = await area({ item: 'acid', activity: 'acid-spray' })
  assert.equal(sprayed.status, 'done', JSON.stringify(sprayed))
  ok("an area attack at one target is made against its armor class, as one at a single target is, an app's single target too; at none, it hit no one; and it says so only as dnd5e shows players")

  for (const [fields, reason, error] of [
    [{ item: 'acid', activity: 'acid-spray', targets: [target('cb-gob'), target('cb-ogre'), target('cb-ghost')] }, 'target'],
    [{ targets: [target('cb-gob'), target('cb-gob')] }, 'target'],
    [{ targets: [target('cb-kob')] }, 'target'],
    [{ item: 'axe', activity: 'axe-swing', targets: [target('cb-gob'), target('cb-ogre')] }, 'target'],
    [{ item: 'axe', activity: 'axe-swing', targets: [target('cb-gob')] }, 'target'],
    [{ target: target('cb-gob') }, 'invalid', 'target'],
    [{ targets: target('cb-gob') }, 'invalid', 'target'],
    [{ targets: Array.from({ length: 21 }, () => target('cb-gob')) }, 'invalid', 'target'],
  ]) {
    const refused = await area(fields)
    assert.deepEqual([refused.status, refused.reason, refused.error], ['failed', reason, error ?? null], JSON.stringify(fields))
  }
  ok("refuses an area attack at more than it takes, or at one twice, an attack at one target made at several, and one naming both its target and targets")

  const noTarget = await attack({ target: null, item: 'dagger', activity: 'dagger-stab' })
  assert.equal(noTarget.status, 'done')
  assert.equal(noTarget.attack.outcome, null)
  assert.deepEqual(useCard(noTarget.id).flags.dnd5e.targets, [])
  assert.equal(attackMessage(noTarget.id).flags.dnd5e.roll.attackMode, 'oneHanded')
  ok('attacks with no target, with the weapon\'s first attack mode')

  const knuckle = await attack({ item: 'fist', activity: 'fist-punch' })
  assert.equal(knuckle.damage.plannable, false)
  const thumped = await damage(knuckle.id, [])
  assert.equal(thumped.status, 'done')
  const punch = await attack({ item: 'unarmed', activity: 'unarmed-strike' })
  assert.deepEqual(punch.damage, { critical: false, plannable: true, healing: false, rolls: [{ formula: '1 + 3', type: 'Bludgeoning', types: null, dice: [], perDie: 1 }] })
  const pummel = await damage(punch.id, [])
  assert.equal(pummel.rolls[0].total, 4)
  ok("damage with a die no player rolls is Foundry's, and damage with no dice needs none")

  for (const [use, dice, fields, reason] of [
    [hit.id, [{ faces: 8, results: [6] }], { actorId: 'vex' }, 'unknown'],
    ['atk-none', [{ faces: 8, results: [6] }], {}, 'gone'],
    [miss.id, [{ faces: 6, results: [6] }], {}, 'invalid'],
    [miss.id, [], {}, 'invalid'],
  ]) {
    const refused = await damage(use, dice, fields)
    assert.deepEqual([refused.status, refused.reason], ['failed', reason], `${use} ${JSON.stringify(dice)}`)
  }
  ok("refuses damage for another's attack, an attack it can't find, or dice the attack didn't say")

  Hooks.once('dnd5e.preRollAttack', () => false)
  const called = await attack({ item: 'dagger', activity: 'dagger-stab' })
  assert.deepEqual([called.status, called.reason], ['failed', 'no-attack'])
  assert.ok(useCard(called.id), 'the use\'s card stays, for the Gamemaster to refund')
  ok('reports a use whose attack a module called off')

  await criticalAdditions()
  await reducedDamage()
  await castsHigher()
  await modifiedDamage()
  await gmAttacks()
} else {
  // ---- Midi-QOL's path ----
  // Midi whispers whether an attack hit while the Gamemaster's own rolls are private.
  settings.set('messageMode', 'public')
  const placed = id => placeables.get(id)
  game.user.targets = new Set([placed('tok-ogre')])
  const hit = await attack()
  assert.equal(hit.status, 'done', JSON.stringify(hit))
  const wf = workflowOf(hit.id)
  const card = useCard(hit.id)
  assert.equal(wf.chatCard, card)
  assert.equal(card.author.id, 'gm')
  assert.deepEqual([...wf.targets].map(t => t.id), ['tok-goblin'])
  assert.deepEqual(card.flags.dnd5e.targets.map(t => t.name), ['Goblin'])
  assert.deepEqual([...game.user.targets].map(t => t.id), ['tok-ogre'], 'the Gamemaster\'s targets are put back')
  assert.deepEqual(faces(wf.attackRoll), [[15]])
  assert.equal(hit.attack.outcome, 'hit')
  assert.deepEqual(hit.rolls.map(r => r.total), [21])
  assert.equal(wf.damageRollCount, 0, 'working out the damage didn\'t touch the workflow')
  assert.ok(wf.suspended && (wf.currentAction === wf.WorkflowState_WaitForDamageRoll))
  assert.deepEqual(hit.damage.rolls[0].dice, [{ faces: 8, number: 1 }])
  ok('makes the attack through Midi\'s workflow at the player\'s target, with their d20, and puts the Gamemaster\'s targets back')

  const before = goblin.actor.system.attributes.hp.value
  const dealt = await damage(hit.id, [{ faces: 8, results: [6] }])
  assert.equal(dealt.status, 'done', JSON.stringify(dealt))
  assert.equal(dealt.rolls[0].total, 9)
  assert.deepEqual(faces(wf.damageRolls[0]), [[6]])
  assert.equal(goblin.actor.system.attributes.hp.value, before - 9)
  assert.equal(wf.currentAction, wf.WorkflowState_Completed)
  const again = await damage(hit.id, [{ faces: 8, results: [6] }])
  assert.deepEqual([again.status, again.reason], ['failed', 'damaged'])
  ok('rolls the damage into the waiting workflow with the player\'s dice, which Midi then applies, once')

  const miss = await attack({ target: target('cb-ogre'), dice: [{ faces: 20, results: [5] }] })
  assert.equal(miss.attack.outcome, 'miss')
  assert.equal(miss.damage, null, 'a workflow whose attack missed every target ends, with no damage to roll')
  midi.settings.autoCheckHit = 'whisper'
  const whispered = await attack()
  assert.equal(whispered.attack.outcome, null)
  midi.settings.autoCheckHit = 'all'
  settings.set('messageMode', 'gm')
  const privately = await attack()
  assert.equal(privately.attack.outcome, null)
  settings.set('messageMode', 'public')
  // Module 0.31.0: with Hit/miss and save results in the app Always, as Midi checked it whatever it
  // whispers; and where it checks none, by the armor class on its card, never sent.
  settings.set('chatResults', 'always')
  midi.settings.autoCheckHit = 'whisper'
  assert.equal((await attack()).attack.outcome, 'hit', 'Always: whispered')
  midi.settings.autoCheckHit = 'all'
  settings.set('messageMode', 'gm')
  assert.equal((await attack()).attack.outcome, 'hit', 'Always: private')
  settings.set('messageMode', 'public')
  midi.settings.autoCheckHit = 'none'
  const unchecked = await attack()
  assert.equal(unchecked.attack.outcome, 'hit', "Always, Midi checking none: by the card's armor class")
  assert.equal((await attack({ target: target('cb-ogre'), dice: [{ faces: 20, results: [5] }] })).attack.outcome, 'miss')
  assert.ok(!JSON.stringify(unchecked).includes('"ac"'), 'no armor class')
  // A target under total cover, whose armor class Midi writes on its card as null: a miss, however
  // high the roll.
  ogre.actor.system.attributes.ac.value = null
  const covered = await attack({ target: target('cb-ogre'), dice: [{ faces: 20, results: [18] }] })
  ogre.actor.system.attributes.ac.value = 20
  assert.deepEqual(useCard(covered.id).flags.dnd5e.targets.map(({ ac }) => ac), [null], 'the card says total cover')
  assert.equal(covered.attack.outcome, 'miss', 'Always, Midi checking none: total cover a miss')
  assert.ok(!JSON.stringify(covered).includes('"ac"'), 'no armor class')
  // A target its card doesn't list tells nothing.
  const unlisted = Hooks.on('preCreateChatMessage', (message, source) => {
    const flags = source?.flags?.dnd5e ?? message.flags?.dnd5e
    if (Array.isArray(flags?.targets)) flags.targets = flags.targets.filter(({ uuid }) => uuid !== goblin.actor.uuid)
  })
  const unnamed = await attack()
  Hooks.off('preCreateChatMessage', unlisted)
  assert.deepEqual(useCard(unnamed.id).flags.dnd5e.targets, [], 'the card lists no target')
  assert.equal(unnamed.attack.outcome, null, 'Always, Midi checking none: a target the card doesn\'t list')
  assert.ok(!JSON.stringify(unnamed).includes('"ac"'), 'no armor class')
  settings.delete('chatResults')
  assert.equal((await attack()).attack.outcome, null, 'Follow, Midi checking none: nothing')
  midi.settings.autoCheckHit = 'all'
  ok("says whether an attack hit only as Midi shows players; or always where the Gamemaster has players told so (0.31.0), whatever Midi whispers, and where Midi checks none, by each armor class its card names, total cover a miss, and nothing of a target it doesn't list")

  const crit = await attack({ dice: [{ faces: 20, results: [20] }] })
  assert.equal(crit.attack.critical, true)
  assert.deepEqual(crit.damage.rolls[0].dice, [{ faces: 8, number: 2 }])
  const critDamage = await damage(crit.id, [{ faces: 8, results: [4, 4] }])
  assert.equal(critDamage.rolls[0].total, 11)
  ok('a critical hit\'s damage takes the doubled dice')

  const critMore = await attack({ dice: [{ faces: 20, results: [20] }] })
  assert.equal(critMore.damage.rolls[0].perDie, 2)
  const critMoreDamage = await damage(critMore.id, [{ faces: 10, results: [1, 2, 3, 4] }], { modifiers: { extra: 1, faces: 10 } })
  assert.equal(critMoreDamage.status, 'done', JSON.stringify(critMoreDamage))
  assert.equal(critMoreDamage.rolls[0].total, 13)
  ok('a critical hit\'s damage with a die more, made a d10, takes two d10s more into Midi\'s workflow')

  await criticalAdditions()
  await reducedDamage()
  await castsHigher()
  await modifiedDamage()
  await gmAttacks()

  game.user.targets = new Set([placed('tok-ogre')])
  const alone = await attack({ target: null })
  assert.deepEqual([...workflowOf(alone.id).targets], [], 'the Gamemaster\'s own target isn\'t taken')
  assert.deepEqual([...game.user.targets].map(t => t.id), ['tok-ogre'])
  ok('an attack with no target has none, whatever the Gamemaster has targeted')

  midi.abortNext = true
  const aborted = await attack()
  assert.deepEqual([aborted.status, aborted.reason], ['failed', 'midi'])
  ok('reports a workflow Midi aborted without a change of state')

  for (const [setup, fields, reason] of [
    [() => { midi.activeDefence = true }, {}, 'active-defence'],
    [() => { midi.settings.requiresTargets = 'always' }, { target: null }, 'target'],
    [() => {}, { target: target('cb-ghost') }, 'scene'],
    [() => { midi.settings.enforceBonusActions = 'all'; midi.usedBonus.add('thorin'); thorin.items.get('dagger').system.activities.get('dagger-stab').activation = { type: 'bonus', value: 1 } }, { item: 'dagger', activity: 'dagger-stab' }, 'bonus-action'],
  ]) {
    setup()
    const refused = await attack(fields)
    assert.deepEqual([refused.status, refused.reason], ['failed', reason], reason)
    Object.assign(midi, { activeDefence: false })
    Object.assign(midi.settings, { requiresTargets: 'none', enforceBonusActions: 'none' })
  }
  ok('refuses beforehand what would have Midi ask the Gamemaster, or not make the attack')

  // ---- Area attacks, through Midi ----
  const hp = foe => foe.actor.system.attributes.hp.value
  const area = (fields = {}) => attack({
    item: 'breath', activity: 'breath-blast', target: undefined, targets: [target('cb-gob'), target('cb-ogre')],
    dice: [{ faces: 20, results: [12] }], ...fields,
  })
  const picked = outcomes => outcomes.map(([combatantId, outcome]) => ({ combatId: 'fight', combatantId, outcome }))
  game.user.targets = new Set([placed('tok-kobold')])
  // Midi targeting an area itself, which waits for a template, leaves a cone the player's to pick.
  midi.settings.autoTarget = 'wallsBlock'
  const breathed = await area()
  assert.equal(breathed.status, 'done', JSON.stringify(breathed))
  const breathFlow = workflowOf(breathed.id)
  assert.deepEqual([...breathFlow.targets].map(t => t.id), ['tok-goblin', 'tok-ogre'])
  assert.deepEqual(breathed.attack, { critical: false, fumble: false, outcome: null, targets: picked([['cb-gob', 'hit'], ['cb-ogre', 'miss']]) })
  assert.deepEqual([...game.user.targets].map(t => t.id), ['tok-kobold'], 'the Gamemaster\'s targets are put back')
  // Back on its feet after the fight so far.
  goblin.actor.system.attributes.hp.value = 30
  const [goblinHp, ogreHp] = [hp(goblin), hp(ogre)]
  const scorched = await damage(breathed.id, [{ faces: 6, results: [3, 4] }])
  assert.equal(scorched.status, 'done', JSON.stringify(scorched))
  await until(() => breathFlow.currentAction === breathFlow.WorkflowState_Completed, 'the breath\'s workflow to complete')
  assert.deepEqual([hp(goblin), hp(ogre)], [goblinHp - 7, ogreHp])
  assert.deepEqual([...game.user.targets].map(t => t.id), ['tok-kobold'])
  assert.deepEqual([screen.templates, screen.notifications], [0, []])
  ok("an area attack goes through Midi's workflow at the targets picked, which checks the hit on each, as the app is told, and applies the damage to those hit")

  // A burst around its user, which Midi places and targets itself, unless it's told not to.
  const nova = { item: 'nova', activity: 'nova-burst', targets: [target('cb-gob')] }
  const placedNova = await area(nova)
  assert.deepEqual([placedNova.status, placedNova.reason], ['failed', 'area'])
  thorin.items.get('nova').system.activities.get('nova-burst')._data.midiProperties = { autoTargetAction: 'none' }
  const pickedNova = await area(nova)
  assert.equal(pickedNova.status, 'done', JSON.stringify(pickedNova))
  thorin.items.get('nova').system.activities.get('nova-burst')._data.midiProperties = {}
  midi.settings.autoTarget = 'none'
  const unplaced = await area(nova)
  assert.equal(unplaced.status, 'done', JSON.stringify(unplaced))
  ok("refuses an area attack whose targets Midi picks itself, around its user, unless it's told not to")

  await game.settings.set('sending-stone', 'offCanvasTargets', true)
  const away = await area({ targets: [target('cb-gob'), target('cb-ghost')] })
  await game.settings.set('sending-stone', 'offCanvasTargets', false)
  assert.equal(away.status, 'done', JSON.stringify(away))
  assert.deepEqual(away.attack.targets, picked([['cb-gob', 'hit'], ['cb-ghost', null]]))
  assert.deepEqual([...workflowOf(away.id).targets].map(t => t.id), ['tok-goblin'])
  game.user.targets = new Set()
  ok("an area attack at a target the Gamemaster isn't viewing says nothing of whether it hit that one, which Midi didn't check")

  // A Gamemaster answering what Midi asks them, after the app was told it took too long.
  midi.holdNext = 80_000
  const slow = attackCommand()
  queue(slow)
  await until(() => results(slow.id).length >= 2, 'the late result', 6000)
  assert.deepEqual(results(slow.id).map(r => [r.status, r.reason]), [['failed', 'timeout'], ['done', null]])
  ok('tells the app of an attack made after it was told the attack took too long')

  // One attack held for ever: the next, by another character, waits its turn, and is dropped
  // when its time is up rather than made long after.
  midi.holdNext = Infinity
  const stuck = attackCommand()
  const waiting = attackCommand({ actorId: 'vex', item: 'rapier', activity: 'rapier-lunge' })
  queue(stuck, waiting)
  await until(() => results(waiting.id).length, 'the waiting attack\'s timeout', 6000)
  assert.equal(results(waiting.id)[0].reason, 'timeout')
  await new Promise(resolve => realSetTimeout(resolve, 3500))
  assert.equal(useCard(waiting.id), undefined, 'the attack that waited too long was never made')
  ok('makes Midi attacks one at a time, and never one whose time was up before its turn')

  const ashlands = () => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.title === 'Ashlands'))
  const told = ashlands().length
  await game.settings.set('sending-stone', 'midiIntegration', false)
  await until(() => ashlands().length > told, 'a fresh hello')
  // A description's damage isn't made through Midi's workflow, so it stays, and may still be
  // changed in the app; and so do spending charges and Heroic Inspiration, which need no Midi
  // (module 0.29.0).
  // Changed on purpose (round 0.36.0 §3.1): nor are damage on its own and recharges, outside Midi's workflow.
  // Changed on purpose (round 0.36.0 §6.13): nor ending a turn, made wherever rolls are.
  // Changed on purpose (round 0.36.0 §6.14): nor taking one back.
  assert.deepEqual(ashlands().at(-1).data.features.rolls.kinds, [...checks, 'endConcentration', 'endTurn', 'undoEndTurn', 'spend', 'inspiration', 'textRoll', 'textDamage', 'itemDamage', 'recharge'])
  assert.equal(ashlands().at(-1).data.features.rolls.areaAttacks, false)
  assert.equal(ashlands().at(-1).data.features.rolls.modifiers, true)
  const off = await attack()
  assert.deepEqual([off.status, off.reason], ['failed', 'midi-off'])
  ok('with the integration off, attacks stay in the app while Midi makes items\' uses')
}

console.log(`${MIDI ? 'midi' : 'dnd5e'}: done`)
process.exit(0)
