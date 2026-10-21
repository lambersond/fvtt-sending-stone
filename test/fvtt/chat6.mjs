// dnd5e 6.0.5's chat messages (module 0.30.0, its contract §3.7 F4): typed, with what they are in
// `system` rather than dnd5e's flags (D6 data/chat-message/_module.mjs), told as dnd5e 5's are, and
// their raw `system` without what dnd5e keeps from players. Run with DND5E6=1, which makes the
// system 6.0.5, and --import ./unref-timers.mjs --import ./dnd5e-register.mjs. The world is
// results-world.mjs; each message stands in for dnd5e 6's data model: `system` with its getters and
// `toObject()`, its origin a document as prepared, an id as stored. Module 0.31.0: with Hit/miss and
// save results in the app Always, outcomes told and `system` as under Follow.
import assert from 'node:assert/strict'
import { d20, DND5E6, ok, settings, speakerOf, start, thorin, vex, withSettings } from './results-world.mjs'

assert.ok(DND5E6, 'run with DND5E6=1')
const { told } = await start()
assert.equal(game.system.version, '6.0.5')
settings.set('gmContent', false)
settings.set('attackRollVisibility', 'hideAC')
settings.set('challengeVisibility', 'player')

/** dnd5e 6's typed message, as its data model has it. */
function typed(type, system, fields = {}) {
  const { origin, ...stored } = system
  const model = {
    ...structuredClone(stored), origin: origin ?? null,
    get forceSuccess() { return (type === 'save') && (this.resisted === true) },
    toObject: () => ({ ...structuredClone(stored), origin: origin?.id ?? null }),
  }
  return ChatMessage.create({ type, system: model, flags: {}, ...fields })
}
const target = (who, ac) => ({ ac, actor: who.uuid, img: `${who.id}.webp`, name: who.name, token: `Scene.s.Token.t${who.id}` })

// ---- An attack ----
const attack = await typed('attack', {
  activity: { id: 'atk', name: 'Attack', type: 'attack', uuid: 'Actor.thorin.Item.axe.Activity.atk' },
  item: { id: 'axe', name: 'Battleaxe', type: 'weapon', uuid: 'Actor.thorin.Item.axe' },
  targets: [target(vex, 14), target(thorin, 20), target(vex, null)],
}, { author: 'alice', speaker: speakerOf(thorin), rolls: [await d20(12, { attack: true })] })
let sent = told(attack)
assert.equal(sent.dnd5e.messageType, 'attack')
assert.deepEqual(sent.dnd5e.roll, { type: 'attack' })
assert.deepEqual(sent.dnd5e.item, { id: 'axe', uuid: 'Actor.thorin.Item.axe', type: 'weapon', name: null })
assert.deepEqual(sent.dnd5e.targets, [
  { name: 'Vex', uuid: 'Actor.vex', outcome: 'hit' },
  { name: 'Thorin', uuid: 'Actor.thorin', outcome: 'miss' },
  { name: 'Vex', uuid: 'Actor.vex', outcome: 'miss' },
], 'total cover a miss, as dnd5e 6 draws it')
await withSettings({ attackRollVisibility: 'none' }, () => assert.ok(told(attack).dnd5e.targets.every(t => !('outcome' in t)), 'Hide all'))
ok("a dnd5e 6 attack is told from `system`: its kind, item and targets, each hit or missed under Show only results, total cover a miss; nothing under Hide all")

// ---- A save, by its origin ----
const gmCard = await ChatMessage.create({ author: 'gm', speaker: { actor: null, alias: 'Gamemaster' }, content: '' })
const aliceCard = await ChatMessage.create({ author: 'alice', speaker: speakerOf(thorin), content: '' })
const save = (origin, natural, fields = {}) => d20(natural, { formula: '1d20 + 2', target: 13 })
  .then(roll => typed('save', { ability: 'dex', type: 'ability', origin, targets: [], ...fields }, { author: 'alice', speaker: speakerOf(thorin), rolls: [roll] }))
assert.deepEqual(told(await save(aliceCard, 15)).dnd5e.save, { target: 'Actor.thorin', outcome: 'success' }, "a player's card")
assert.deepEqual(told(await save(gmCard, 15)).dnd5e.save, { target: 'Actor.thorin' }, "the Gamemaster's, under player")
assert.equal(told(await save(gmCard, 15)).dnd5e.originatingMessage, gmCard.id)
assert.deepEqual(told(await save(null, 15)).dnd5e.save, { target: 'Actor.thorin', outcome: 'success' }, 'no origin: the roll itself, a player\'s')
const concentration = await save(gmCard, 15, { type: 'concentration', ability: 'con' })
await withSettings({ challengeVisibility: 'all' }, () => assert.deepEqual(told(concentration).dnd5e.save, { target: 'Actor.thorin', outcome: 'success' }, 'concentration'))
const death = await save(null, 15, { type: 'death', ability: undefined })
assert.equal(told(death).dnd5e.roll.type, 'death')
assert.equal(told(death).dnd5e.save, undefined, 'a death save is no save')
ok("a dnd5e 6 save is told by `system.origin`, as dnd5e 5's by its card: a player's card shows everyone, the Gamemaster's no player under Show only from other players, and none, the roll itself; concentration's among them, never a death save")

// ---- A check ----
const skill = await d20(16, { target: 15 }).then(roll => typed('check', { ability: 'wis', skill: 'prc', tool: null, type: 'ability', origin: aliceCard, targets: [] }, { author: 'alice', speaker: speakerOf(thorin), rolls: [roll] }))
sent = told(skill)
assert.deepEqual(sent.dnd5e.roll, { type: 'skill', ability: 'wis', skillId: 'prc' })
assert.deepEqual(sent.dnd5e.check, { target: 'Actor.thorin', outcome: 'success' })
assert.equal(sent.dnd5e.save, undefined)
const tool = await d20(3, { target: 15 }).then(roll => typed('check', { ability: 'dex', skill: null, tool: 'thief', type: 'ability', origin: aliceCard, targets: [] }, { author: 'alice', speaker: speakerOf(thorin), rolls: [roll] }))
assert.deepEqual(told(tool).dnd5e.roll, { type: 'tool', ability: 'dex', toolId: 'thief' })
assert.deepEqual(told(tool).dnd5e.check, { target: 'Actor.thorin', outcome: 'failure' })
const initiative = await d20(10).then(roll => typed('check', { ability: 'dex', type: 'initiative', targets: [] }, { speaker: speakerOf(thorin), rolls: [roll] }))
assert.equal(told(initiative).dnd5e.roll, null, 'initiative is no check')
assert.equal(told(initiative).dnd5e.check, undefined)
ok("a dnd5e 6 check with `system.skill` is a skill's, with `system.tool` a tool's, told in `check` as a save is; initiative is none")

// ---- What `system` keeps from players ----
const usage = await typed('usage', {
  buttons: [
    { action: 'rollSave', dataset: { dc: 15, ability: 'dex' }, label: { hidden: 'DEX Saving Throw', value: 'DC 15 DEX Saving Throw' }, icon: 'x' },
    { action: 'rollDamage', label: { value: 'Damage' } },
  ],
  targets: [target(vex, 14)],
}, { author: 'gm', speaker: { actor: null, alias: 'Gamemaster' } })
sent = told(usage)
assert.ok(!('ac' in sent.system.targets[0]), 'no armor class')
assert.ok(!('dc' in sent.system.buttons[0].dataset), 'no DC')
assert.equal(sent.system.buttons[0].label.value, 'DEX Saving Throw', 'labelled without its DC')
assert.equal(sent.system.buttons[1].label.value, 'Damage')
assert.ok(!JSON.stringify(sent.system).includes('15'), JSON.stringify(sent.system))
const shown = await withSettings({ gmContent: true }, () => told(usage))
assert.equal(shown.system.targets[0].ac, 14)
assert.equal(shown.system.buttons[0].dataset.dc, 15)
assert.equal(shown.system.buttons[0].label.value, 'DC 15 DEX Saving Throw')
await withSettings({ challengeVisibility: 'all' }, () => assert.equal(told(usage).system.buttons[0].label.value, 'DC 15 DEX Saving Throw', 'where players see DCs'))
assert.ok(!('ac' in told(attack).system.targets[0]))
// A label with nothing kept from it is the one dnd5e draws for players, as its `||` has it (D6
// usage-message-data.mjs:265-267): never blanked.
const plain = await typed('usage', { buttons: [{ action: 'rollDamage', label: { hidden: '', value: 'Damage' } }], targets: [] }, { author: 'gm', speaker: { actor: null, alias: 'Gamemaster' } })
assert.equal(told(plain).system.buttons[0].label.value, 'Damage', 'a blank label without the DC: the label')
ok("a dnd5e 6 message's raw `system` goes without targets' armor class, buttons' DCs, and labels with DCs players don't see, with Gamemaster-only information off; as it is with it on")

// ---- dnd5e 6's prompts: a roll request and a concentration check ----
// Each keeps its DC on the button itself, not in a dataset (D6 data/chat-message/
// prompt-message-data.mjs:49-56; enrichers.mjs:1801-1809), and has no label stored: each client
// draws it, with the DC only where it shows them (:96-103). Posted by the Gamemaster, as a request
// is (enrichers.mjs:1773-1792), and whispered to the owners of a concentrating actor, as dnd5e
// whispers its check (documents/actor/actor.mjs:1188-1197).
const prompt = (system, fields) => ChatMessage.create({ type: 'prompt', system: { ...structuredClone(system), toObject: () => structuredClone(system) }, flags: {}, content: '', ...fields })
const requested = await prompt({ broadcast: true, buttons: [
  { type: 'save', ability: 'dex', dc: 17, format: 'long', visibility: 'all' },
  { type: 'skill', ability: 'wis', skill: 'prc', dc: 12, format: 'long', visibility: 'all' },
] }, { author: 'gm', speaker: { actor: null, alias: 'Gamemaster' } })
const concentrating = await prompt({ broadcast: false, buttons: [{ dc: 13, format: 'short', type: 'concentration', ability: 'con' }] },
  { author: 'gm', speaker: speakerOf(thorin), whisper: ['alice'] })
for (const challengeVisibility of ['none', 'player', 'all']) {
  await withSettings({ challengeVisibility }, () => {
    sent = told(requested)
    assert.deepEqual(sent.system, { broadcast: true, buttons: [
      { type: 'save', ability: 'dex', format: 'long', visibility: 'all' },
      { type: 'skill', ability: 'wis', skill: 'prc', format: 'long', visibility: 'all' },
    ] }, `a request under ${challengeVisibility}: no DC`)
    sent = told(concentrating)
    assert.deepEqual(sent.audience.characters, ['thorin'], 'whispered to its owner')
    assert.deepEqual(sent.system, { broadcast: false, buttons: [{ format: 'short', type: 'concentration', ability: 'con' }] }, `a concentration check under ${challengeVisibility}: no DC`)
    for (const message of [requested, concentrating]) assert.ok(!/1[237]/.test(JSON.stringify(told(message).system)), JSON.stringify(told(message).system))
  })
}
await withSettings({ gmContent: true }, () => {
  assert.deepEqual(told(requested).system.buttons.map(button => button.dc), [17, 12])
  assert.equal(told(concentrating).system.buttons[0].dc, 13)
})
ok("dnd5e 6's prompts, a request and a concentration check, go without each button's DC, kept on the button itself, with Gamemaster-only information off, whatever Challenge Visibility; with it on, with them")

// ---- A legendary resistance ----
const resisted = await save(aliceCard, 4, { resisted: true })
assert.deepEqual(told(resisted).dnd5e.save, { target: 'Actor.thorin', outcome: 'success' })
assert.deepEqual(told(await save(aliceCard, 4)).dnd5e.save, { target: 'Actor.thorin', outcome: 'failure' })
ok('a dnd5e 6 save resisted with a legendary resistance is a success')

// ---- Module 0.31.0: Hit/miss and save results in the app, Always ----
await withSettings({ chatResults: 'always', attackRollVisibility: 'none', challengeVisibility: 'none' }, async () => {
  sent = told(attack)
  assert.deepEqual(sent.dnd5e.targets, [
    { name: 'Vex', uuid: 'Actor.vex', outcome: 'hit' },
    { name: 'Thorin', uuid: 'Actor.thorin', outcome: 'miss' },
    { name: 'Vex', uuid: 'Actor.vex', outcome: 'miss' },
  ], 'every target told, under Hide all')
  assert.ok(sent.system.targets.every(t => !('ac' in t)), 'no armor class in `system`')
  assert.deepEqual(told(await save(gmCard, 15)).dnd5e.save, { target: 'Actor.thorin', outcome: 'success' }, "the Gamemaster's card, under Hide all: to everyone")
  assert.deepEqual(told(skill).dnd5e.check, { target: 'Actor.thorin', outcome: 'success' }, 'a check, to everyone')
  sent = told(usage)
  assert.ok(!('ac' in sent.system.targets[0]) && !('dc' in sent.system.buttons[0].dataset), 'no armor class or DC')
  assert.equal(sent.system.buttons[0].label.value, 'DEX Saving Throw')
  assert.ok(!JSON.stringify(sent.system).includes('15'))
  assert.ok(!/1[237]/.test(JSON.stringify(told(requested).system)) && !/1[237]/.test(JSON.stringify(told(concentrating).system)), 'prompts: no DC')
})
const follow = told(usage).system
await withSettings({ chatResults: 'always' }, () => assert.deepEqual(told(usage).system, follow, '`system` as under Follow'))
ok('dnd5e 6, with Hit/miss and save results in the app Always and GM-only details off: every attack target told, and saves and checks to everyone, under Hide all; `system` as under Follow, with no armor class or DC, prompts too')

console.log('dnd5e 6: done')
process.exit(0)
