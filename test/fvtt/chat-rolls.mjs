// What the module tells the app of each roll in a chat message, so that the app can show a
// message's damage as one card (module 0.28.0): whether the roll is damage, the words for its type,
// its part of Midi-QOL's item card, a bonus's name, and whether it's the attack. The real module,
// dnd5e 5.3.3's real dice classes (BasicRoll, D20Roll, DamageRoll and their dice), dnd5e's items and
// activities ported (activity5e.mjs), a stand-in Foundry core and app. MIDI=1 puts the stand-in
// Midi-QOL workflow in the world (midi-fake.mjs), which tags its rolls and writes every one on its
// card as Midi does. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { combat, combatant, settings, user, users, actors } from './stub.mjs'

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

// The module's long waits, shortened a hundredfold.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
globalThis.document = { hidden: false }

const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie

// dnd5e's labels, as keys in the game's language: German for piercing, so that a label sent is
// plainly the translation, neither the type nor the key; poison's with spaces about it, as a
// translation may have, which the label sent never has; healing's with their short labels, which
// dnd5e's damage card shows. Midi's, for the types it adds under MIDI=1.
const translations = {
  'DND5E.DAMAGE.Type.Piercing': 'Stich',
  'DND5E.DAMAGE.Type.Poison': ' Poison  ',
  'DND5E.DAMAGE.Type.Fire': 'Fire',
  'DND5E.HEAL.Type.Healing': 'Healing',
  'DND5E.HEAL.Type.HealingShort': 'Healing',
  'DND5E.HEAL.Type.Temporary': 'Temporary Hit Points',
  'DND5E.HEAL.Type.TemporaryShort': 'Temp HP',
  'midi-qol.noType': 'No Type',
  'midi-qol.midi-none': 'No Damage',
  'midi-qol.vitalityDamage': 'Vitality',
  'midi-qol.vitalityHealing': 'Vitality',
}
game.i18n.localize = key => translations[key] ?? key
game.i18n.has = key => Object.hasOwn(translations, key)
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(['piercing', 'poison', 'fire'].map(type => [type, { label: `DND5E.DAMAGE.Type.${type.capitalize()}` }])),
  healingTypes: {
    healing: { label: 'DND5E.HEAL.Type.Healing', labelShort: 'DND5E.HEAL.Type.HealingShort' },
    temphp: { label: 'DND5E.HEAL.Type.Temporary', labelShort: 'DND5E.HEAL.Type.TemporaryShort' },
  },
}
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, SaveActivity, DamageActivity, HealActivity, equip } = await import('./activity5e.mjs')
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  documents: { activity: { AttackActivity, SaveActivity, DamageActivity, HealActivity } },
  registry: {
    messages: {
      get(id, type) {
        return [...messages.values()].filter(m => (m.flags?.dnd5e?.originatingMessage === id) && (m.flags?.dnd5e?.roll?.type === type))
      },
    },
  },
}
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
if (MIDI) {
  installMidi()
  // Midi's own types, as it adds them to dnd5e's at init and ready, labels already translated
  // (midi-qol.ts:414-417, 699-700).
  const i18n = key => game.i18n.localize(key)
  Object.assign(CONFIG.DND5E.damageTypes, {
    none: { label: i18n('midi-qol.noType') },
    'midi-none': { label: i18n('midi-qol.midi-none') },
    vitality: { label: i18n('midi-qol.vitalityDamage') },
  })
  CONFIG.DND5E.healingTypes.vitality = { label: i18n('midi-qol.vitalityHealing') }
}

const add = actor => { actors.set(actor.id, actor); return actor }
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 3, dex: 2, wis: 2 } }))
alice.character = thorin
equip(thorin, {
  items: [
    // Corvin's dagger: piercing, and poison as part of its own damage.
    { id: 'dagger', name: 'Dagger (Melee)', type: 'weapon', system: { properties: ['fin'], quantity: 1, attackType: 'melee' },
      activities: [{ id: 'stab', damage: [
        { number: 1, denomination: 4, bonus: '@mod', types: ['piercing'] },
        { number: 2, denomination: 6, types: ['poison'] },
      ] }] },
    { id: 'vigor', name: 'False Life', type: 'spell', system: { level: 0, method: 'spell', properties: [] },
      activities: [{ id: 'bolster', type: 'heal', affects: 'self', range: 'self', healing: { number: 1, denomination: 4, bonus: '4', types: ['temphp'] } }] },
    // A utility with a roll of its own.
    { id: 'omen', name: 'Fey Omen', type: 'feat', system: { properties: [] },
      activities: [{ id: 'foresee', type: 'utility', affects: '', formula: '1d4' }] },
  ],
})

const goblin = add(new Actor5e({ id: 'goblin', name: 'Goblin', mods: {}, hp: { value: 99, max: 99, temp: 0 } }))
goblin.type = 'npc'
equip(goblin, { ac: 10 })
const goblinToken = { id: 'tok-goblin', name: 'Goblin', uuid: 'Scene.scene.Token.tok-goblin', actor: goblin, hidden: false }
const goblinPlaceable = { id: goblinToken.id, name: 'Goblin', document: goblinToken, actor: goblin }
goblinToken.object = goblinPlaceable
placeables.set(goblinToken.id, goblinPlaceable)
if (MIDI) canvas.scene.tokens.size = placeables.size
const fight = combat('fight')
combatant(fight, 'cb-thorin', thorin)
combatant(fight, 'cb-gob', goblin, { token: goblinToken })
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
const settle = () => new Promise(resolve => realSetTimeout(resolve, 30))
async function send(command) {
  queue(command)
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const attack = (fields = {}) => send({
  id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'dagger', activity: 'stab', target: { combatId: 'fight', combatantId: 'cb-gob' },
  mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [15] }], ...fields,
})
const use = (item, activity, fields = {}) => send({
  id: `use-${++ids}`, actorId: 'thorin', kind: 'use', item, activity, targets: [{ combatId: 'fight', combatantId: 'cb-gob' }], slot: null, ...fields,
})
const damage = (useId, dice) => send({ id: `dmg-${++ids}`, actorId: 'thorin', kind: 'damage', use: useId, dice })
const useCard = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.use === id)
const madeFor = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.request === id)
const workflowOf = id => midi.made.find(w => w.workflowOptions.sendingStone === id)

const chatEvents = id => app.events.filter(e => ['chat.message.created', 'chat.message.updated'].includes(e.type) && (e.data.message?.id === id))
/** The message as the app was last told of it, created or updated. */
const told = id => chatEvents(id).at(-1)?.data.message
/** The message as its last update told the app of it, with the fields that changed. */
const lastUpdate = id => chatEvents(id).filter(e => e.type === 'chat.message.updated').at(-1)?.data
const latest = () => [...messages.values()].at(-1)
/** The marks this round adds to a roll, as sent: only those it has. */
const MARKS = ['damage', 'damageLabel', 'section', 'flavor', 'attack']
const marks = roll => Object.fromEntries(MARKS.filter(key => Object.hasOwn(roll, key)).map(key => [key, roll[key]]))
const speaker = { actor: 'thorin', alias: 'Thorin' }
/** A message of rolls made by hand, as the app is told of it. */
async function posted(rolls) {
  for (const roll of rolls) if (!roll._evaluated) await roll.evaluate()
  const message = await ChatMessage.create({ speaker, rolls })
  await settle()
  return told(message.id)
}

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
settings.set('campaigns', [{ id: 'camp-a', title: 'Ashlands', characters: ['thorin'], rolls: true, attacks: true }])
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.equal(diceStatus.attacks, true, `attack self-test: ${diceStatus.attacksError}`)

// ---- dnd5e's own messages, under Midi too ----
const dagger = thorin.items.get('dagger').system.activities.get('stab')
await dagger.rollDamage({}, { configure: false })
await settle()
const twoParts = told(latest().id)
assert.deepEqual(twoParts.dnd5e.roll, { type: 'damage' })
assert.deepEqual(twoParts.rolls.map(roll => [roll.class, roll.damageType, marks(roll)]), [
  ['DamageRoll', 'piercing', { damage: true, damageLabel: 'Stich' }],
  ['DamageRoll', 'poison', { damage: true, damageLabel: 'Poison' }],
])
ok("dnd5e's damage of two parts, piercing then poison, is two rolls marked damage, each with its type's label in the game's language, and no section, flavor or attack")

await thorin.items.get('vigor').system.activities.get('bolster').rollDamage({}, { configure: false })
await settle()
const bolstered = told(latest().id)
assert.deepEqual(bolstered.rolls.map(roll => [roll.damageType, marks(roll)]), [['temphp', { damage: true, damageLabel: 'Temp HP' }]])
ok("temporary hit points are labelled with dnd5e's short label, as its damage card names them, not the long one")

const untyped = await posted([new CONFIG.Dice.DamageRoll('1d6 + 1', {}, {})])
assert.deepEqual(untyped.rolls.map(roll => [roll.class, 'damageType' in roll, marks(roll)]), [['DamageRoll', false, { damage: true }]])
const odd = await posted([new CONFIG.Dice.DamageRoll('1d6', {}, { type: 'constructor' }), new CONFIG.Dice.DamageRoll('1d6', {}, { type: 'midi-none' })])
assert.deepEqual(odd.rolls.map(roll => [roll.damageType, marks(roll)]), [
  ['constructor', { damage: true }],
  ['midi-none', { damage: true, ...(MIDI && { damageLabel: 'No Damage' }) }],
])
ok(`damage of no type is marked damage, with no type or label; a type the game lacks, even one any object answers to, has no label; Midi's midi-none ${MIDI ? 'has the label Midi gives it' : 'has none without Midi'}`)

// A flavor is a bonus's name only on Midi's bonus damage.
const flavored = await posted([new CONFIG.Dice.DamageRoll('1d6', {}, { type: 'fire', flavor: 'Flame Tongue' })])
assert.deepEqual(flavored.rolls.map(marks), [{ damage: true, damageLabel: 'Fire' }])
ok("a damage roll's flavor is sent only for Midi's bonus damage")

const plain = await posted([new Roll('1d20 + 2')])
await thorin.rollSkill({ skill: 'prc' }, { configure: false })
await settle()
const skill = told(latest().id)
assert.equal(skill.dnd5e.roll.type, 'skill')
assert.deepEqual([...plain.rolls, ...skill.rolls].map(roll => [roll.class, marks(roll)]), [['Roll', {}], ['D20Roll', {}]])
ok('a plain roll and a skill check carry none of the marks')

const swung = await dagger.rollAttack({}, { configure: false })
await settle()
const attackMessage = told(latest().id)
assert.equal(swung[0].options['midi-qol'], undefined, "dnd5e's own attack has no Midi tag")
assert.deepEqual(attackMessage.rolls.map(roll => [roll.class, marks(roll)]), [['D20Roll', { attack: true }]])
ok("dnd5e's own attack roll is marked the attack, by the kind of roll dnd5e copies to it")

// ---- A player's rolls from the app ----
game.user.targets = new Set()
if (!MIDI) {
  const hit = await attack()
  assert.equal(hit.status, 'done', JSON.stringify(hit))
  assert.deepEqual(hit.rolls.map(marks), [{ attack: true }])
  const dealt = await damage(hit.id, [{ faces: 4, results: [2] }, { faces: 6, results: [3, 4] }])
  assert.equal(dealt.status, 'done', JSON.stringify(dealt))
  const expected = [{ damage: true, damageLabel: 'Stich' }, { damage: true, damageLabel: 'Poison' }]
  assert.deepEqual(dealt.rolls.map(marks), expected)
  await settle()
  assert.deepEqual(told(madeFor(dealt.id).id).rolls.map(marks), expected)
  ok("a player's attack and damage from the app carry the marks in command.result as in their chat messages")
} else {
  // ---- Midi-QOL's item card ----
  const corvin = [
    ['D20Roll', { attack: true }],
    ['DamageRoll', { damage: true, damageLabel: 'Stich', section: 'damage' }],
    ['DamageRoll', { damage: true, damageLabel: 'Poison', section: 'damage' }],
    ['DamageRoll', { damage: true, damageLabel: 'Stich', section: 'bonus', flavor: 'Sneak Attack' }],
    ['DamageRoll', { damage: true, damageLabel: 'Stich', section: 'bonus' }],
    ['DamageRoll', { damage: true, damageLabel: 'Fire', section: 'bonus', flavor: "Hunter's Mark" }],
    ['DamageRoll', { damage: true, damageLabel: 'Poison', section: 'bonus' }],
    ['DamageRoll', { damage: true, damageLabel: 'Fire', section: 'bonus' }],
    ['Roll', { section: 'bonus', flavor: 'Colossus Slayer' }],
    ['DamageRoll', { damage: true, section: 'bonus' }],
    ['DamageRoll', { damage: true, damageLabel: 'Poison', section: 'other' }],
  ]
  // A macro's bonus that names itself; one that names nothing, which Midi gives its type as a
  // flavor; one whose name wants trimming; and two named after a type, a damage type and a healing
  // type, which are no name. Then two rolls of the macro's own, which Midi keeps as they are: a
  // plain Roll, which its section alone marks as damage, so that the app adds it to the card's
  // total; and a DamageRoll of a type the world lacks, named after its own type.
  midi.bonusDamage = [
    { formula: '1d6', type: 'piercing', flavor: 'Sneak Attack' },
    { formula: '2', type: 'piercing' },
    { formula: '1d6', type: 'fire', flavor: "  Hunter's Mark " },
    { formula: '1', type: 'poison', flavor: 'Fire' },
    { formula: '1', type: 'fire', flavor: 'Healing' },
    { roll: () => new Roll('1d8', {}, { flavor: 'Colossus Slayer' }) },
    { roll: () => new CONFIG.Dice.DamageRoll('1d4', {}, { type: 'sonic', flavor: 'Sonic' }) },
  ]
  midi.otherDamage = [{ formula: '2d6', type: 'poison' }]
  const card = async (useOther = false) => {
    const hit = await attack()
    assert.equal(hit.status, 'done', JSON.stringify(hit))
    assert.deepEqual(hit.rolls.map(marks), [{ attack: true }])
    if (useOther) workflowOf(hit.id).useOther = true
    const dealt = await damage(hit.id, [{ faces: 4, results: [2] }, { faces: 6, results: [3, 4] }])
    assert.equal(dealt.status, 'done', JSON.stringify(dealt))
    const message = useCard(hit.id)
    await until(() => lastUpdate(message.id)?.message.rolls.length === corvin.length, "the damage on Midi's card")
    return { hit, dealt, message }
  }

  const first = await card()
  assert.ok(chatEvents(first.message.id).some(e => e.data.changes?.includes('rolls')), "Midi's card is updated with its rolls")
  assert.deepEqual(lastUpdate(first.message.id).message.rolls.map(roll => [roll.class, marks(roll)]), corvin)
  assert.equal(first.message.rolls[1].options.flavor, '', "Midi clears its own damage's flavor")
  assert.equal(first.message.rolls.at(-3).constructor, Roll, "Midi keeps a macro's plain Roll as it is")
  ok("Midi's card, as its last update tells it, has the attack marked, then its own damage, a bonus macro's and its other damage, each by its section, a macro's plain Roll too; a bonus named by its macro, trimmed, and none named by a type, its own or any of the game's")

  assert.deepEqual(first.dealt.rolls.map(roll => [roll.damageType, marks(roll)]), [
    ['piercing', { damage: true, damageLabel: 'Stich', section: 'damage' }],
    ['poison', { damage: true, damageLabel: 'Poison', section: 'damage' }],
  ])
  ok("the command.result of a player's damage through Midi has its rolls in Midi's section for the item's own damage")

  const second = await card(true)
  assert.equal(workflowOf(second.hit.id).useOther, true)
  assert.deepEqual(lastUpdate(second.message.id).message.rolls.map(roll => [roll.class, marks(roll)]), corvin)
  ok("a workflow's useOther, which only Midi's own card shows, changes no roll's section")

  // Midi's own new attack roll, as its optional bonus dialog makes one (Workflow.ts:7101-7102),
  // has Midi's tag and nothing of dnd5e's.
  const workflow = workflowOf(second.hit.id)
  const redone = await new CONFIG.Dice.D20Roll('1d20 + 5', {}, {}).evaluate()
  workflow.setAttackRoll(redone)
  await workflow.displayDamageRolls()
  assert.equal(redone.options.rollType, undefined)
  const [rewritten] = lastUpdate(second.message.id).message.rolls
  assert.deepEqual([rewritten.formula, marks(rewritten)], [redone.formula, { attack: true }])
  ok("an attack Midi rolls anew, which carries only Midi's tag, is marked the attack")

  const omen = await use('omen', 'foresee', { targets: [] })
  assert.equal(omen.status, 'done', JSON.stringify(omen))
  const omenCard = useCard(omen.id)
  await until(() => lastUpdate(omenCard.id)?.message.rolls.length === 1, "the utility's roll on Midi's card")
  assert.deepEqual(lastUpdate(omenCard.id).message.rolls.map(roll => [roll.class, marks(roll)]), [['BasicRoll', {}]])
  assert.equal(omenCard.rolls[0].options['midi-qol'].rollType, 'utility')
  ok("a utility's own roll on Midi's card, tagged Midi's utility, carries none of the marks")

  // As after a reload, or on a Gamemaster's client that never ran the workflow: no workflow, and
  // the card's rolls rebuilt from what Foundry stored of them, as Roll.fromData rebuilds them.
  const before = lastUpdate(first.message.id).message.rolls
  globalThis.MidiQOL.Workflow.workflows.clear()
  midi.made.length = 0
  first.message.rolls = first.message.rolls.map(roll => {
    const rebuilt = new roll.constructor(roll.formula, {}, JSON.parse(JSON.stringify(roll.options)))
    return Object.assign(rebuilt, { terms: roll.terms, _total: roll._total, _evaluated: true, _formula: roll._formula })
  })
  await first.message.setFlag('world', 'seen', true)
  await settle()
  const resent = lastUpdate(first.message.id)
  assert.deepEqual(resent.changes, ['flags'])
  assert.deepEqual(resent.message.rolls, before)
  ok("Midi's card sent again with no workflow, its rolls rebuilt from what Foundry stored, says the same of every roll")
}

console.log(`${MIDI ? 'midi' : 'dnd5e'}: done`)
process.exit(0)
