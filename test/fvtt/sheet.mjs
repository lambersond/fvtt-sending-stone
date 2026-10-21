// Character sheets: what character.updated carries for each character under dnd5e 5.3 and 6.0
// data, after each bridge.hello, which lists the characters without them, and when one changes.
import assert from 'node:assert/strict'
import { actor, posts, settings, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
const take = () => posts.splice(0).map(p => p.envelope)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
foundry.utils.getProperty = (object, path) => path.split('.').reduce((o, key) => o?.[key], object)

CONFIG.DND5E = {
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(id => [id, { label: `DND5E.Ability${id}`, abbreviation: id.toUpperCase() }])),
  skills: {
    ath: { label: 'Athletics' }, prc: { label: 'Perception' }, ste: { label: 'Stealth' }, arc: { label: 'Arcana' },
  },
}
const translations = { 'DND5E.Abilitystr': 'Strength', 'DND5E.Abilitydex': 'Dexterity', 'DND5E.Abilitywis': 'Wisdom' }
game.i18n.localize = key => translations[key] ?? key

const gm = user('gm', 'Gamemaster', true)
users.activeGM = gm
user('alice', 'Alice'); user('bob', 'Bob')

// dnd5e 5.3: no check.value; the check is the modifier, the check bonus and any check proficiency.
const ability53 = (value, { proficient = 0, checkBonus = 0, checkProf = { term: '0', flat: 0 }, save, checkMode = 0, saveMode = 0 } = {}) => {
  const mod = Math.floor((value - 10) / 2)
  return { value, mod, proficient, checkBonus, checkProf, save: { value: save ?? mod, roll: { mode: saveMode } }, check: { roll: { mode: checkMode } } }
}
const thorin = actor('thorin', 'Thorin', ['alice'], 'character', { value: 31, max: 44, temp: 0 })
thorin.img = 'worlds/erebor/thorin.webp'
thorin.system = {
  abilities: {
    str: ability53(18, { proficient: 1, save: 7, checkMode: -1 }),
    dex: ability53(12, { checkBonus: 1, checkProf: { term: '1', flat: 1 }, checkMode: -1 }),
    con: ability53(16, { proficient: 1, save: 6 }),
    int: ability53(8), wis: ability53(13), cha: ability53(10),
  },
  skills: {
    ath: { ability: 'str', total: 7, passive: 17, prof: { multiplier: 1 }, roll: { mode: 0 } },
    prc: { ability: 'wis', total: 4, passive: 14, prof: { multiplier: 2 }, roll: { mode: 0 } },
    ste: { ability: 'dex', total: 2, passive: 12, prof: { multiplier: 0.5 }, roll: { mode: 1 } },
  },
  attributes: {
    hp: { value: 31, max: 44, temp: 0 }, ac: { value: 18 }, prof: 3, init: { total: 2 },
    movement: { walk: 25, speed: 25, units: 'ft' }, inspiration: true,
  },
  details: { level: 5, race: { name: 'Dwarf' }, background: { name: 'Soldier' } },
}
thorin.itemTypes = { class: [
  { name: 'Rogue', system: { levels: 1 }, subclass: null },
  { name: 'Fighter', system: { levels: 4 }, subclass: { name: 'Champion' } },
] }

// dnd5e 6.0: check.value is worked out, and speeds live under movement.speeds.
const vex = actor('vex', 'Vex', ['bob'], 'character', { value: 12, max: 38, temp: 0 })
vex.system = {
  abilities: {
    int: { value: 17, mod: 3, proficient: 1, check: { value: 5, roll: { mode: 0 } }, save: { value: 6, roll: { mode: 0 } } },
  },
  skills: { arc: { ability: 'int', total: 6, passive: 16, value: 1, roll: { mode: 0 } } },
  attributes: { hp: { value: 12, max: 38, temp: 0 }, ac: { value: 13 }, prof: 3, init: { total: 3 }, movement: { speeds: { walk: 30 }, speed: 30, units: 'ft' } },
  details: { level: 5, species: { name: 'Tiefling' } },
}
const goblin = actor('goblin', 'Goblin', [], 'npc')
for (const a of [thorin, vex, goblin]) a.documentName = 'Actor'

await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
// dnd5e's own setting: the world is played by the 2014 rules.
settings.set('rulesVersion', 'legacy')
settings.set('campaigns', [
  { id: 'camp-a', title: 'Erebor', characters: ['thorin'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin', 'vex'] },
])
await Hooks.callAll('ready')
await wait(20)

// ---- bridge.hello lists each character; its sheet follows in a post of its own ----
const hellos = take()
const helloTo = id => hellos.find(e => e.type === 'bridge.hello' && e.campaign.id === id)
const sheetTo = (campaign, id) => hellos.find(e => (e.type === 'character.updated') && (e.campaign.id === campaign) && (e.data.character.id === id)).data.character.sheet
assert.deepEqual(hellos.map(e => `${e.type} → ${e.campaign.id}${e.data.character ? ` (${e.data.character.id})` : ''}`), [
  'bridge.hello → camp-a', 'bridge.hello → camp-b',
  'character.updated → camp-a (thorin)', 'character.updated → camp-b (thorin)', 'character.updated → camp-b (vex)',
])
// Since 0.26.0 each also says whether its player enters its dice results in the app; since 0.32.0
// by the gate, which no campaign here meets: Manual Dice isn't on, and no player has Make Manual Rolls.
assert.deepEqual(helloTo('camp-b').data.characters.map(c => Object.keys(c)), [['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice'], ['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice']])
assert.deepEqual(helloTo('camp-b').data.characters.map(c => c.manualDice), [false, false])
assert.deepEqual(helloTo('camp-b').data.characters.map(c => [c.id, c.owners]), [['thorin', [{ id: 'alice', name: 'Alice' }]], ['vex', [{ id: 'bob', name: 'Bob' }]]])
assert.equal(helloTo('camp-b').data.sheetsApart, true)
ok("bridge.hello lists each character, without its sheet, which follows once it's answered, in roster order")
const sheet = sheetTo('camp-a', 'thorin')
assert.equal(sheet.img, 'worlds/erebor/thorin.webp')
assert.deepEqual(
  [sheet.level, sheet.species, sheet.background, sheet.ac, sheet.proficiency, sheet.initiative, sheet.inspiration],
  [5, 'Dwarf', 'Soldier', 18, 3, 2, true],
)
assert.deepEqual(sheet.speed, { value: 25, units: 'ft' })
assert.deepEqual(sheet.hp, { value: 31, max: 44, temp: 0 })
assert.deepEqual(sheet.classes, [
  { id: null, identifier: null, name: 'Fighter', levels: 4, subclass: 'Champion', hitDice: null },
  { id: null, identifier: null, name: 'Rogue', levels: 1, subclass: null, hitDice: null },
])
assert.deepEqual([sheet.conditions, sheet.features, sheet.effects], [[], [], []])
assert.equal(sheet.rules, 'legacy')
ok("the character's sheet: the rules it plays by, level, classes highest first, species, AC, speed and the like")

const str = sheet.abilities.find(a => a.id === 'str')
assert.deepEqual(str, { id: 'str', label: 'Strength', abbreviation: 'STR', score: 18, mod: 4, check: 4, save: 7, saveProficient: true, checkMode: -1, saveMode: 0 })
const dex = sheet.abilities.find(a => a.id === 'dex')
assert.equal(dex.check, 1 + 1 + 1, 'dnd5e 5.3: modifier + check bonus + check proficiency')
assert.equal(dex.save, 1)
assert.deepEqual(sheet.abilities.map(a => a.id), ['str', 'dex', 'con', 'int', 'wis', 'cha'])
ok('dnd5e 5.3: each ability has its score, modifier, check and save, as dnd5e shows them')

assert.deepEqual(sheet.skills.map(s => s.label), ['Athletics', 'Perception', 'Stealth'])
assert.deepEqual(sheet.skills.find(s => s.id === 'prc'), { id: 'prc', label: 'Perception', ability: 'wis', total: 4, passive: 14, proficiency: 2, mode: 0 })
assert.equal(sheet.skills.find(s => s.id === 'ath').mode, -1, "a skill takes its ability's disadvantage")
assert.equal(sheet.skills.find(s => s.id === 'ste').mode, 0, 'advantage and disadvantage cancel out')
assert.equal(sheet.skills.find(s => s.id === 'ste').proficiency, 0.5)
ok('skills are sorted by name, with total, passive, proficiency and roll mode')

const vexSheet = sheetTo('camp-b', 'vex')
assert.deepEqual(vexSheet.abilities, [{ id: 'int', label: 'DND5E.Abilityint', abbreviation: 'INT', score: 17, mod: 3, check: 5, save: 6, saveProficient: true, checkMode: 0, saveMode: 0 }])
assert.deepEqual([vexSheet.species, vexSheet.speed.value, vexSheet.skills[0].proficiency, vexSheet.background], ['Tiefling', 30, 1, null])
ok("dnd5e 6.0: the check comes from check.value; species and speeds from 6.0's fields")

assert.equal(sheetTo('camp-b', 'thorin').abilities.length, 6)
ok('a character in two campaigns has its sheet in both')

// ---- character.updated ----
thorin.system.attributes.hp.value = 20
await Hooks.callAll('updateActor', thorin, { system: { attributes: { hp: { value: 20 } } } })
await Hooks.callAll('updateActor', thorin, {})
await Hooks.callAll('updateActor', thorin, {})
assert.equal(take().length, 0, 'nothing until the changes settle')
await wait(300)
let sent = take()
assert.deepEqual(sent.map(e => `${e.type} → ${e.campaign.id}`).sort(), ['character.updated → camp-a', 'character.updated → camp-b'])
assert.equal(sent[0].data.character.sheet.hp.value, 20)
assert.equal(sent[0].data.character.id, 'thorin')
assert.ok(sent.every(e => Number.isInteger(e.sequence)))
ok('a burst of changes to a character is sent once, to each of its campaigns, in their event streams')

await Hooks.callAll('updateActor', thorin, { name: 'Thorin' })
await wait(300)
assert.equal(take().length, 0)
ok('a change that leaves the character as each campaign was told is not sent')

thorin.itemTypes.class[1].system.levels = 5
thorin.system.details.level = 6
await Hooks.callAll('updateItem', { documentName: 'Item', parent: thorin })
await wait(300)
sent = take()
assert.equal(sent.length, 2)
assert.deepEqual(sent[0].data.character.sheet.classes[0], { id: null, identifier: null, name: 'Fighter', levels: 5, subclass: 'Champion', hitDice: null })
ok("a change to the character's items is sent")

thorin.system.abilities.dex.check.roll.mode = 0
thorin.system.skills.ste.roll.mode = 0
const effectOnItem = { documentName: 'ActiveEffect', parent: { documentName: 'Item', parent: thorin } }
await Hooks.callAll('deleteActiveEffect', effectOnItem)
await wait(300)
sent = take()
assert.equal(sent.length, 2)
assert.equal(sent[0].data.character.sheet.skills.find(s => s.id === 'ste').mode, 0)
ok("a change to an effect on one of the character's items is sent")

vex.system.attributes.ac.value = 15
await Hooks.callAll('updateActor', vex, {})
goblin.name = 'Goblin Boss'
await Hooks.callAll('updateActor', goblin, {})
await wait(300)
sent = take()
assert.deepEqual(sent.map(e => `${e.type} → ${e.campaign.id} (${e.data.character.id})`), ['character.updated → camp-b (vex)'])
ok('only the campaigns a character is in hear of it, and an actor in none is not sent')

// ---- dnd5e's own combining of roll modes, where it offers it ----
globalThis.dnd5e = { dataModels: { fields: { AdvantageModeField: { combineFields: (system, paths) => ({ mode: paths.some(p => p.startsWith('skills.prc')) ? 1 : 0 }) } } } }
thorin.system.attributes.ac.value = 19
await Hooks.callAll('updateActor', thorin, {})
await wait(300)
sent = take()
assert.equal(sent[0].data.character.sheet.skills.find(s => s.id === 'prc').mode, 1)
assert.equal(sent[0].data.character.sheet.skills.find(s => s.id === 'ath').mode, 0)
ok("dnd5e's own AdvantageModeField.combineFields decides a skill's roll mode when available")

// ---- other systems, and other clients ----
assert.equal(helloTo('camp-a').data.characters.length, 1)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
assert.equal(characterSheet(goblin), null)
ok('an actor whose system has no abilities and skills has no sheet')

// dnd5e keeps a temporary change to the maximum apart, as tempmax, and heals up to, shows and
// clamps the hit points to their sum, effectiveMax: Aid's +5, or a wraith's Life Drain.
const hp = thorin.system.attributes.hp
Object.assign(hp, { value: 49, max: 44, temp: 3, tempmax: 5, effectiveMax: 49 })
assert.deepEqual(characterSheet(thorin).hp, { value: 49, max: 49, temp: 3 })
Object.assign(hp, { value: 31, max: 44, temp: 0, tempmax: -10, effectiveMax: 34 })
assert.deepEqual(characterSheet(thorin).hp, { value: 31, max: 34, temp: 0 })
Object.assign(hp, { value: 34, max: 44, temp: 0, tempmax: -10, effectiveMax: 34 })
const drained = characterSheet(thorin).hp
assert.equal(drained.value, drained.max, 'full at the lowered maximum')
const { hitPoints } = await import(`${MODULE}/scripts/characters.mjs`)
assert.deepEqual(hitPoints({ system: { attributes: { hp: { value: 31, max: 44, temp: 0 } } } }), { value: 31, max: 44, temp: 0 })
assert.deepEqual(hitPoints({ system: { attributes: { hp: { value: 31, max: null, temp: 0 } } } }), { value: 31, max: null, temp: 0 })
Object.assign(hp, { value: 20, max: 44, temp: 0, tempmax: 0, effectiveMax: 44 })
ok("the hit points' maximum is the one dnd5e shows and heals up to, its temporary change included, so a character drained to 34 of 44 is at full; without one, the maximum as it is")

const readSetting = game.settings.get
game.settings.get = (module, key) => { if (module === 'dnd5e') throw new Error(`${key} is not a registered game setting`); return readSetting.call(game.settings, module, key) }
assert.equal(characterSheet(thorin).rules, null)
game.settings.get = readSetting
settings.set('rulesVersion', 'homebrew')
assert.equal(characterSheet(thorin).rules, null)
settings.set('rulesVersion', 'modern')
assert.equal(characterSheet(thorin).rules, 'modern')
ok("the rules are null where dnd5e's setting can't be read, or names neither")

// How a critical hit's damage is rolled is found by building damage rolls: here there are none to
// build, so the sheet says nothing of it. texts.mjs builds dnd5e's own.
assert.equal(sheet.critical, null)
assert.equal(characterSheet(thorin).critical, null)
ok("the sheet says nothing of a critical hit's damage where no damage roll can be built")

gm.isActiveGM = false
thorin.system.attributes.ac.value = 20
await Hooks.callAll('updateActor', thorin, {})
await wait(300)
assert.equal(take().length, 0)
ok('a client that is not the bridge sends nothing')

console.log('\nall sheet checks passed')
