// Step 2 of the fuller sheet: inventory, spells, biography, traits and death saves, under dnd5e
// 5.3 and 6.0 shaped data.
import assert from 'node:assert/strict'
import { actor, posts, settings, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
const take = () => posts.splice(0).map(p => p.envelope)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
foundry.utils.getProperty = (object, path) => path.split('.').reduce((o, key) => o?.[key], object)

const translations = {
  'TYPES.Item.weaponPl': 'Weapons', 'TYPES.Item.equipmentPl': 'Equipment', 'TYPES.Item.consumablePl': 'Consumables',
  'TYPES.Item.toolPl': 'Tools', 'TYPES.Item.lootPl': 'Loot', 'DND5E.Items': 'Items',
  'DND5E.CurrencyPP': 'Platinum', 'DND5E.CurrencyAbbrPP': 'PP', 'DND5E.CurrencyGP': 'Gold', 'DND5E.CurrencyAbbrGP': 'GP',
  'DND5E.WeightUnitsLb': 'lb', 'DND5E.ItemRarityRare': 'Rare', 'DND5E.CAST.SECTIONS.Spellbook': 'Additional Spells',
  'DND5E.AbilityInt': 'Intelligence', 'DND5E.AbilityCha': 'Charisma',
  'DND5E.Alignment': 'Alignment', 'DND5E.Age': 'Age', 'DND5E.Gender': 'Gender', 'DND5E.Height': 'Height', 'DND5E.Weight': 'Weight',
  'DND5E.Eyes': 'Eyes', 'DND5E.Hair': 'Hair', 'DND5E.Skin': 'Skin', 'DND5E.Faith': 'Faith',
  'DND5E.PersonalityTraits': 'Personality Traits', 'DND5E.Ideals': 'Ideals', 'DND5E.Bonds': 'Bonds', 'DND5E.Flaws': 'Flaws',
  'DND5E.Size': 'Size', 'DND5E.SizeMedium': 'Medium', 'DND5E.Senses': 'Senses', 'DND5E.Speed': 'Speed', 'DND5E.Languages': 'Languages',
  'DND5E.SenseDarkvision': 'Darkvision', 'DND5E.MovementWalk': 'Walk', 'DND5E.MovementFly': 'Fly', 'DND5E.DistFtAbbr': 'ft',
  'DND5E.DamRes': 'Damage Resistances', 'DND5E.DamImm': 'Damage Immunities', 'DND5E.ConImm': 'Condition Immunities',
  'DND5E.TraitArmorProf': 'Armor Training', 'DND5E.TraitToolProf': 'Tool Proficiencies', 'DND5E.Telepathy': 'Telepathy',
}
game.i18n.localize = key => translations[key] ?? key
game.i18n.has = key => key in translations
game.i18n.format = (key, data) => key === 'DND5E.MOVEMENT.HoverSpeed' ? `${data.speed} (hover)` : key
const dnd5eSettings = { encumbrance: 'variant', metricWeightUnits: false }
const getSetting = game.settings.get.bind(game.settings)
game.settings.get = (module, key) => module === 'dnd5e'
  ? (key in dnd5eSettings ? dnd5eSettings[key] : (() => { throw new Error(`no setting ${key}`) })())
  : getSetting(module, key)

// Spellcasting methods, shaped as dnd5e's models: spell levels with slots and cantrips, pact magic
// at one level, and methods without slots.
class SingleLevelSpellcasting {}
const ordinal = n => ['Cantrips', '1st Level', '2nd Level', '3rd Level', '4th Level'][n] ?? `${n}th Level`
const multi = { key: 'spell', slots: true, cantrips: true, prepares: true, order: 20,
  getAvailableLevels: actor => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(l => (actor.system.spells[`spell${l}`]?.max ?? 0) > 0),
  getSpellSlotKey: level => `spell${level}`, getLabel: ({ level }) => ordinal(level) }
const pact = Object.assign(new SingleLevelSpellcasting(), { key: 'pact', slots: true, order: 10,
  getAvailableLevels: actor => actor.system.spells.pact?.max ? [actor.system.spells.pact.level] : [],
  getSpellSlotKey: () => 'pact', getLabel: () => 'Pact Magic' })
const plain = (key, label, order) => ({ key, order, getAvailableLevels: () => [], getSpellSlotKey: () => key, getLabel: () => label })
CONFIG.DND5E = {
  abilities: { int: { label: 'DND5E.AbilityInt', abbreviation: 'int' }, cha: { label: 'DND5E.AbilityCha', abbreviation: 'cha' } },
  skills: {},
  currencies: { pp: { label: 'DND5E.CurrencyPP', abbreviation: 'DND5E.CurrencyAbbrPP' }, gp: { label: 'DND5E.CurrencyGP', abbreviation: 'DND5E.CurrencyAbbrGP' } },
  weightUnits: { lb: { label: 'Pounds', abbreviation: 'DND5E.WeightUnitsLb' } },
  movementUnits: { ft: { label: 'Feet', abbreviation: 'DND5E.DistFtAbbr' } },
  encumbrance: { baseUnits: { default: { imperial: 'lb', metric: 'kg' } } },
  itemRarity: { rare: 'DND5E.ItemRarityRare' },
  spellcasting: { spell: multi, pact, atwill: plain('atwill', 'At-Will', -30), innate: plain('innate', 'Innate', -20), ritual: plain('ritual', 'Ritual', -10) },
  actorSizes: { med: { label: 'DND5E.SizeMedium' } },
  senses: { darkvision: 'DND5E.SenseDarkvision' },
  movementTypes: { walk: { label: 'DND5E.MovementWalk' }, fly: { label: 'DND5E.MovementFly' } },
  communicationTypes: { telepathy: { label: 'DND5E.Telepathy' } },
  traits: {
    saves: { labels: { title: 'DND5E.ClassSaves' } }, skills: { labels: { title: 'DND5E.Skills' } },
    languages: { labels: { title: 'DND5E.Languages' } },
    armor: { labels: { title: 'DND5E.TraitArmorProf' }, actorKeyPath: 'system.traits.armorProf' },
    tool: { labels: { title: 'DND5E.TraitToolProf' } },
    dr: { labels: { title: 'DND5E.DamRes' } }, di: { labels: { title: 'DND5E.DamImm' } },
    dm: { labels: { title: 'DND5E.DamMod' } }, ci: { labels: { title: 'DND5E.ConImm' } },
  },
  conditionTypes: {}, limitedUsePeriods: { lr: { label: 'Long Rest' } },
}
CONFIG.statusEffects = []
CONFIG.Item = { typeLabels: {}, dataModels: {
  weapon: { inventorySection: { id: 'weapons', order: 100, label: 'TYPES.Item.weaponPl' } },
  equipment: { inventorySection: { id: 'equipment', order: 200, label: 'TYPES.Item.equipmentPl' } },
  consumable: { inventorySection: { id: 'consumables', order: 300, label: 'TYPES.Item.consumablePl' } },
  tool: { inventorySection: { id: 'tool', order: 400, label: 'TYPES.Item.toolPl' } },
  container: { inventorySection: { id: 'containers', order: 500, label: 'TYPES.Item.containerPl' } },
  loot: { inventorySection: { id: 'loot', order: 600, label: 'TYPES.Item.lootPl' } },
  feat: {},
} }
const traitLabels = { fire: 'Fire', poison: 'Poison', charmed: 'Charmed', lgt: 'Light Armor', thief: "Thieves' Tools", herb: 'Herbalism Kit', dwarvish: 'Dwarvish' }
globalThis.dnd5e = {
  utils: { staticID: id => id },
  dataModels: { spellcasting: { SingleLevelSpellcasting } },
  documents: { Trait: { keyLabel: key => traitLabels[key] } },
}
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return html } } }
globalThis.fromUuid = async () => null
globalThis.fromUuidSync = () => null

// ---- Vex, a tiefling warlock and wizard, under dnd5e 5.3 ----
const gm = user('gm', 'Gamemaster', true)
users.activeGM = gm
user('bob', 'Bob')
const vex = actor('vex', 'Vex', ['bob'], 'character', { value: 0, max: 38, temp: 0 })
vex.documentName = 'Actor'
vex.statuses = new Set()
vex.allApplicableEffects = function* () {}
vex.system = {
  abilities: { int: { value: 17, mod: 3 }, cha: { value: 16, mod: 3 } },
  skills: {},
  attributes: {
    hp: { value: 0, max: 38, temp: 0 }, ac: { value: 13 }, prof: 3, init: { total: 3 },
    movement: { walk: 30, fly: 60, hover: true, speed: 30, units: 'ft' },
    senses: { ranges: { darkvision: 60 }, units: 'ft', special: 'Sees invisibility within 10 ft; Tremorsense 5 ft' },
    encumbrance: { value: 62.5, max: 255, thresholds: { encumbered: 85, heavilyEncumbered: 170 } },
    attunement: { value: 1, max: 3 },
    spellcasting: 'int', spell: { dc: 14, attack: 6, mod: 3 },
    death: { success: 1, failure: 2 },
  },
  currency: { pp: 2, gp: 41.5 },
  spells: { spell1: { value: 3, max: 4, level: 1 }, spell2: { value: 0, max: 2, override: 3, level: 2 }, pact: { value: 1, max: 2, level: 3 } },
  traits: {
    size: 'med',
    languages: { labels: { languages: ['Common', 'Infernal'] }, communication: { telepathy: { value: 30, units: 'ft' } } },
    armorProf: { value: new Set(['lgt']), custom: 'Bucklers' },
    dr: { value: new Set(['fire']), custom: '' },
    di: { value: new Set(), custom: 'Psychic (while raging)' },
    ci: { value: new Set(['charmed']) },
    dm: { amount: { fire: '-2' } },
  },
  tools: { thief: { value: 1 }, herb: { value: 0 } },
  details: {
    level: 5, alignment: 'Chaotic Good', age: '24', gender: '', height: "5' 9\"", weight: '140 lb', eyes: 'Gold', hair: 'Black', skin: 'Crimson', faith: '  ',
    trait: 'I idolize a hero of the old tales.', ideal: 'Freedom.', bond: '', flaw: 'I trust no one.',
    appearance: 'Curling horns and a tail.', xp: { value: 6500, max: 14000 },
    biography: { value: '<p>Born in the shadow of Mirkwood.</p>' },
  },
}
const items = new Map()
vex.items = { get: id => items.get(id), [Symbol.iterator]: () => items.values() }
const item = (id, type, name, { system = {}, labels = {}, flags = {}, ...fields } = {}) => {
  const it = {
    documentName: 'Item', id, uuid: `Actor.vex.Item.${id}`, type, name, img: `icons/${id}.webp`, sort: 0,
    parent: vex, actor: vex, labels, system: { description: { value: `<p>About ${name}.</p>` }, ...system },
    getFlag: (scope, key) => flags[scope]?.[key], getRollData: () => ({}), ...fields,
  }
  items.set(id, it)
  return it
}
const physical = (fields = {}) => ({ quantity: 1, weight: { value: 0, units: 'lb' }, priceLabel: null, identified: true, ...fields })
item('dagger', 'weapon', 'Dagger', { sort: 2, labels: { properties: [{ label: 'Finesse' }, { label: 'Light' }, { label: 'Thrown' }] },
  system: physical({ quantity: 2, weight: { value: 1, units: 'lb' }, priceLabel: '2 GP', equipped: true }) })
item('staff', 'weapon', 'Staff of Fire', { sort: 1, labels: { properties: [{ label: 'Magical' }] },
  system: physical({ weight: { value: 4, units: 'lb' }, priceLabel: '5000 GP', equipped: true, attunement: 'required', attuned: true, rarity: 'rare',
    uses: { max: 10, spent: 3, value: 7, recovery: [{ period: 'lr' }] } }) })
item('mystery', 'equipment', 'Plain Ring', { labels: { properties: [{ label: 'Magical' }] },
  system: physical({ identified: false, unidentified: { description: '<p>A plain iron ring.</p>' }, description: { value: '<p>A Ring of Three Wishes.</p>' },
    priceLabel: '50000 GP', attunement: 'required', rarity: 'rare', uses: { max: 3, value: 3, recovery: [] } }) })
item('potion', 'consumable', 'Potion of Healing', { system: physical({ quantity: 3, weight: { value: 0.5, units: 'lb' }, priceLabel: '50 GP' }) })
item('kit', 'tool', "Thieves' Tools", { system: physical({ weight: { value: 1, units: 'lb' } }) })
item('gem', 'loot', 'Ruby', { system: physical({ priceLabel: '500 GP' }) })
item('pack', 'container', 'Backpack', { system: physical({ weight: { value: 5, units: 'lb' }, capacity: { weight: { value: 30, units: 'lb' } }, contentsWeight: 12.25 }) })
item('rope', 'loot', 'Hempen Rope', { system: physical({ container: 'pack', weight: { value: 10, units: 'lb' } }) })
item('pouch', 'container', 'Pouch', { system: physical({ container: 'pack', capacity: { count: 6, weight: {} }, contentsCount: 2 }) })
item('coin', 'loot', 'Old Coin', { system: physical({ container: 'pouch', quantity: 2 }) })
item('box', 'container', 'Puzzle Box', { system: physical({ identified: false, properties: new Set(['unidentifiedContents']), unidentified: { description: '<p>A locked box.</p>' }, capacity: { count: 1, weight: {} }, contentsCount: 1 }) })
item('secret', 'loot', 'Map to the Hoard', { system: physical({ container: 'box' }) })
item('sack', 'container', 'Sack', { system: physical({ capacity: { weight: {} } }) })
const spell = (id, name, level, method, { prepared = 0, labels = {}, properties = [], ...fields } = {}) => item(id, 'spell', name, {
  labels: { school: 'Evocation', components: { vsm: 'V, S' }, activation: '1 Action', range: '120 ft', duration: 'Instantaneous', ...labels },
  system: { level, method, prepared, canPrepare: method === 'spell', properties: new Set(properties), uses: {} }, ...fields,
})
spell('fire-bolt', 'Fire Bolt', 0, 'spell')
spell('shield', 'Shield', 1, 'spell', { prepared: 1, labels: { activation: '1 Reaction' } })
spell('sleep', 'Sleep', 1, 'spell', { prepared: 0 })
spell('find', 'Find Familiar', 1, 'spell', { prepared: 2, properties: ['ritual'], labels: { components: { vsm: 'V, S, M' }, materials: 'Incense worth 10 GP' } })
spell('mirror', 'Mirror Image', 2, 'spell', { prepared: 1 })
spell('fireball', 'Fireball', 3, 'pact', { properties: [] })
spell('invisibility', 'Invisibility', 2, 'pact', { properties: ['concentration'], labels: { duration: '1 Hour', concentrationDuration: 'Concentration, up to 1 Hour' } })
spell('dim', 'Dimension Door', 4, 'spell', { prepared: 1 })
spell('disguise', 'Disguise Self', 1, 'atwill')
spell('hellish', 'Hellish Rebuke', 2, 'innate', { system: { level: 2, method: 'innate', properties: new Set(), uses: { max: 1, value: 1, recovery: [{ period: 'lr' }] } } })
spell('detect', 'Detect Magic', 1, 'ritual')
spell('odd', 'Strange Rite', 1, 'unknownmethod')
spell('wand-bolt', 'Magic Missile', 1, 'spell', { flags: { dnd5e: { cachedFor: 'wand' } }, system: { level: 1, method: 'spell', properties: new Set(), linkedActivity: { displayInSpellbook: true, item: { id: 'wand', name: 'Wand of Magic Missiles' } } } })
spell('hidden-cast', 'Hidden Spell', 1, 'spell', { flags: { dnd5e: { cachedFor: 'ring' } }, system: { level: 1, method: 'spell', properties: new Set(), linkedActivity: { displayInSpellbook: false } } })
// Spells cast from items that dnd5e's sheet leaves out: one its item casts though "Display in
// Spellbook" is off, one that needs attuning to its item, one its item can't cast for another
// reason, and the spells of an item not identified yet, and of a hidden one, left out.
const cached = (id, name, linkedActivity) => spell(id, name, 1, 'spell', { flags: { dnd5e: { cachedFor: `.Item.${linkedActivity.item.id}.Activity.cast` } }, system: { level: 1, method: 'spell', properties: new Set(), linkedActivity: { displayInSpellbook: false, ...linkedActivity } } })
cached('flame-barbs', 'Silvery Barbs', { canUse: true, item: { id: 'flame', name: 'Worn Bardic Eternal Flame', system: { identified: true } } })
cached('ring-charm', 'Charm Person', { canUse: false, visibility: { requireAttunement: true }, item: { id: 'charms', name: 'Ring of Charms', system: { identified: true, attuned: false } } })
cached('staff-light', 'Light', { canUse: false, visibility: { requireAttunement: false, level: { min: 5 } }, item: { id: 'staff', name: 'Old Staff', system: { identified: true } } })
cached('odd-sleep', 'Sleep', { canUse: true, item: { id: 'odd-wand', name: 'Odd Wand', system: { identified: false } } })
cached('hid-sleep', 'Sleep', { canUse: true, item: { id: 'hid-wand', name: 'Hidden Wand', isHidden: true, system: {} } })
const wizard = { name: 'Wizard', spellcasting: { ability: 'int', save: 14, attack: 6 } }
const warlock = { name: 'Warlock', spellcasting: { ability: 'cha', save: 14, attack: 6 } }
vex.spellcastingClasses = { wizard, warlock }
const byType = {}
for (const it of items.values()) (byType[it.type] ??= []).push(it)
vex.itemTypes = byType

await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaigns', [{ id: 'camp-a', title: 'Mirkwood', characters: ['vex'] }])
await Hooks.callAll('ready')
await wait(50)
const sent = take()
// The hello lists the character; its descriptions, then its sheet, follow once it's answered.
assert.deepEqual(sent.map(e => e.type).filter((type, i, all) => type !== all[i - 1]), ['bridge.hello', 'character.texts', 'character.updated'])
const texts = Object.assign({}, ...sent.filter(e => e.type === 'character.texts').map(e => e.data.texts))
const sheet = sent.find(e => e.type === 'character.updated').data.character.sheet
assert.deepEqual(JSON.parse(JSON.stringify(sheet)), sheet)
ok('the sheet stays plain JSON')

// ---- inventory ----
const inv = sheet.inventory
assert.deepEqual(inv.sections.map(s => [s.id, s.label, s.items.map(i => i.name)]), [
  ['weapons', 'Weapons', ['Staff of Fire', 'Dagger']],
  ['equipment', 'Equipment', ['Plain Ring']],
  ['consumables', 'Consumables', ['Potion of Healing']],
  ['tool', 'Tools', ["Thieves' Tools"]],
  ['loot', 'Loot', ['Ruby']],
])
ok("items are grouped by type in dnd5e's order and the player's own order, leaving out what's in containers")
const at = name => [...inv.sections.flatMap(s => s.items), ...inv.containers].find(i => i.name === name)
assert.deepEqual({ ...at('Staff of Fire'), text: undefined }, {
  id: 'staff', name: 'Staff of Fire', img: 'icons/staff.webp', type: 'weapon', quantity: 1, weight: { value: 4, units: 'lb' },
  price: '5000 GP', equipped: true, attunement: 'required', attuned: true, uses: { value: 7, max: 10, recovery: 'Long Rest', counter: { item: 'staff' }, spendable: true },
  rarity: 'Rare', properties: ['Magical'], identified: true, text: undefined,
})
assert.deepEqual([at('Dagger').quantity, at('Dagger').weight, at('Dagger').properties], [2, { value: 2, units: 'lb' }, ['Finesse', 'Light', 'Thrown']])
assert.equal(at("Thieves' Tools").equipped, null, 'a type that is never equipped says so')
ok('an item has its quantity, total weight, price, equipped and attunement, uses, rarity and properties')
const ring = at('Plain Ring')
assert.deepEqual([ring.identified, ring.price, ring.rarity, ring.uses, ring.properties, ring.attunement], [false, null, null, null, [], null])
assert.equal(texts[ring.text], '<p>A plain iron ring.</p>')
assert.ok(!Object.values(texts).some(html => html.includes('Wishes')), "the real description isn't sent")
ok('an unidentified item keeps its secrets, as dnd5e keeps them from players: its description, price, rarity, uses and properties')
const [pack, box, sack] = inv.containers
assert.deepEqual(inv.containers.map(c => c.name), ['Backpack', 'Puzzle Box', 'Sack'])
assert.deepEqual(pack.capacity, { value: 12.3, max: 30, units: 'lb' })
assert.deepEqual(pack.contents.map(c => c.name), ['Hempen Rope', 'Pouch'])
assert.deepEqual(pack.contents[1].capacity, { value: 2, max: 6, units: 'Items' })
assert.deepEqual(pack.contents[1].contents.map(c => [c.name, c.quantity]), [['Old Coin', 2]])
assert.deepEqual([box.capacity, box.contents], [null, null])
assert.deepEqual([sack.capacity, sack.contents], [null, []])
ok('containers hold their contents, containers within them too, with how full they are; an unidentified one with secret contents shows none')
assert.deepEqual(inv.currency, [{ id: 'pp', label: 'Platinum', abbreviation: 'PP', value: 2 }, { id: 'gp', label: 'Gold', abbreviation: 'GP', value: 41.5 }])
assert.deepEqual(inv.encumbrance, { value: 62.5, max: 255, units: 'lb', encumbered: 85, heavilyEncumbered: 170 })
assert.deepEqual(inv.attunement, { value: 1, max: 3 })
ok('currency, encumbrance with where the variant rule encumbers, and attunement')

// ---- spells ----
assert.deepEqual(sheet.spellcasting, { ability: 'Intelligence', dc: 14, attack: 6, classes: [
  { name: 'Wizard', ability: 'Intelligence', dc: 14, attack: 6 }, { name: 'Warlock', ability: 'Charisma', dc: 14, attack: 6 },
] })
ok('spellcasting: ability, save DC and attack bonus, overall and for each class')
assert.deepEqual(sheet.spells.map(s => [s.id, s.label, s.slots, s.spells.map(spell => spell.name)]), [
  ['atwill', 'At-Will', null, ['Disguise Self']],
  ['innate', 'Innate', null, ['Strange Rite', 'Hellish Rebuke']],
  ['ritual', 'Ritual', null, ['Detect Magic']],
  ['spell0', 'Cantrips', null, ['Fire Bolt']],
  ['pact', 'Pact Magic', { value: 1, max: 2, level: 3 }, ['Invisibility', 'Fireball']],
  ['spell1', '1st Level', { value: 3, max: 4, level: 1 }, ['Find Familiar', 'Shield', 'Sleep']],
  ['spell2', '2nd Level', { value: 0, max: 3, level: 2 }, ['Mirror Image']],
  // No slots of this level are prepared on the stand-in actor, so they have no level.
  ['spell4', '4th Level', { value: 0, max: 0, level: null }, ['Dimension Door']],
  ['item', 'Additional Spells', null, ['Charm Person', 'Light', 'Magic Missile', 'Silvery Barbs']],
])
ok("spells are grouped as dnd5e groups them: by casting method in dnd5e's order, then cantrips, pact magic and each level with its slots and the level they cast at")
const sp = name => sheet.spells.flatMap(s => s.spells).find(s => s.name === name)
assert.deepEqual({ ...sp('Find Familiar'), text: undefined }, {
  id: 'find', name: 'Find Familiar', img: 'icons/find.webp', level: 1, school: 'Evocation', components: 'V, S, M', materials: 'Incense worth 10 GP',
  concentration: false, ritual: true, activation: '1 Action', range: '120 ft', duration: 'Instantaneous', target: null, prepared: 2, uses: null, castFrom: null,
  text: undefined,
})
assert.deepEqual(sp('Magic Missile').castFrom, { id: 'wand', name: 'Wand of Magic Missiles' })
assert.deepEqual(sp('Silvery Barbs').castFrom, { id: 'flame', name: 'Worn Bardic Eternal Flame' })
assert.deepEqual(sp('Charm Person').castFrom, { id: 'charms', name: 'Ring of Charms', usable: false, attune: true })
assert.deepEqual(sp('Light').castFrom, { id: 'staff', name: 'Old Staff', usable: false, attune: false })
assert.deepEqual([sp('Silvery Barbs').prepared, sp('Charm Person').prepared], [null, null])
ok("every spell an item casts is listed, saying when its item can't cast it now and whether for want of attuning, but none of an item hidden or not identified")
assert.deepEqual([sp('Shield').prepared, sp('Sleep').prepared, sp('Fire Bolt').prepared, sp('Fireball').prepared], [1, 0, null, null])
assert.equal(sp('Invisibility').concentration, true)
assert.equal(sp('Invisibility').duration, 'Concentration, up to 1 Hour')
// A spell's own uses are its, but never spent from the app: casting it spends them (module 0.29.0).
assert.deepEqual(sp('Hellish Rebuke').uses, { value: 1, max: 1, recovery: 'Long Rest', counter: { item: 'hellish' } })
assert.equal(texts[sp('Shield').text], '<p>About Shield.</p>')
ok('a spell has its school, components, concentration, ritual, casting time, range and duration, whether it is prepared, and its uses, and one cast from an item names it')

// ---- details, traits, death saves ----
assert.deepEqual({ ...sheet.details, biography: undefined }, {
  about: [
    { id: 'alignment', label: 'Alignment', value: 'Chaotic Good' }, { id: 'age', label: 'Age', value: '24' },
    { id: 'height', label: 'Height', value: "5' 9\"" }, { id: 'weight', label: 'Weight', value: '140 lb' },
    { id: 'eyes', label: 'Eyes', value: 'Gold' }, { id: 'hair', label: 'Hair', value: 'Black' }, { id: 'skin', label: 'Skin', value: 'Crimson' },
  ],
  personality: [
    { id: 'trait', label: 'Personality Traits', value: 'I idolize a hero of the old tales.' },
    { id: 'ideal', label: 'Ideals', value: 'Freedom.' }, { id: 'flaw', label: 'Flaws', value: 'I trust no one.' },
  ],
  appearance: 'Curling horns and a tail.', xp: { value: 6500, max: 14000 }, biography: undefined,
})
assert.equal(texts[sheet.details.biography], '<p>Born in the shadow of Mirkwood.</p>')
ok('the biography, with what is filled in of alignment, age and the like, personality, appearance and experience')
assert.deepEqual(sheet.traits, [
  { id: 'size', label: 'Size', values: ['Medium'] },
  { id: 'senses', label: 'Senses', values: ['Darkvision 60 ft', 'Sees invisibility within 10 ft', 'Tremorsense 5 ft'] },
  { id: 'speeds', label: 'Speed', values: ['Walk 30 ft', 'Fly (hover) 60 ft'] },
  { id: 'languages', label: 'Languages', values: ['Common', 'Infernal', 'Telepathy 30 ft'] },
  { id: 'armor', label: 'Armor Training', values: ['Light Armor', 'Bucklers'] },
  { id: 'tool', label: 'Tool Proficiencies', values: ["Thieves' Tools"] },
  { id: 'dr', label: 'Damage Resistances', values: ['Fire'] },
  { id: 'di', label: 'Damage Immunities', values: ['Psychic (while raging)'] },
  { id: 'ci', label: 'Condition Immunities', values: ['Charmed'] },
])
ok('traits: size, senses, speeds, languages, proficiencies, resistances and immunities, with what the Gamemaster typed in')
assert.deepEqual(sheet.deathSaves, { success: 1, failure: 2 })
ok('death saves')

// ---- descriptions ----
const refs = [
  ...inv.sections.flatMap(s => s.items.map(i => i.text)),
  ...[pack, box, sack, pack.contents[0], pack.contents[1], pack.contents[1].contents[0]].map(i => i.text),
  ...sheet.spells.flatMap(s => s.spells.map(spell => spell.text)),
  sheet.details.biography,
]
assert.ok(refs.every(ref => ref in texts), 'every new description is sent with the sheet')
assert.ok(!Object.values(texts).some(html => html.includes('Map to the Hoard')), "a secret container's contents aren't described")
ok("every item's, spell's and the biography's description goes in character.texts before the sheet")

// ---- dnd5e 6.0 ----
CONFIG.DND5E.senses = { darkvision: { label: 'DND5E.SenseDarkvision' } }
vex.system.attributes.movement = { speeds: { walk: 35, fly: 0 }, units: 'ft', hover: false, walk: 99 }
items.get('staff').system.rarity = undefined
items.get('staff').system.rarities = { first: () => 'rare' }
dnd5eSettings.encumbrance = 'normal'
CONFIG.Item.dataModels = {}
const { sendCharacter } = await import(`${MODULE}/scripts/character-sync.mjs`)
sendCharacter('vex')
await wait(50)
const sheet6 = take().find(e => e.type === 'character.updated').data.character.sheet
assert.deepEqual(sheet6.traits.find(t => t.id === 'senses').values, ['Darkvision 60 ft', 'Sees invisibility within 10 ft', 'Tremorsense 5 ft'])
assert.deepEqual(sheet6.traits.find(t => t.id === 'speeds').values, ['Walk 35 ft'])
assert.equal(sheet6.inventory.sections[0].items[0].rarity, 'Rare')
assert.deepEqual([sheet6.inventory.encumbrance.encumbered, sheet6.inventory.encumbrance.heavilyEncumbered], [null, null])
assert.deepEqual(sheet6.inventory.sections.map(s => s.id), ['weapons', 'equipment', 'consumables', 'tool', 'loot'])
ok("dnd5e 6.0: senses labelled by objects, speeds under movement.speeds, rarity from its set; and without the variant rule, no thresholds")

// ---- nothing to show ----
dnd5eSettings.encumbrance = 'none'
vex.spellcastingClasses = {}
vex.itemTypes = { ...byType, spell: [] }
for (const id of [...items.keys()]) if (items.get(id).type === 'spell') items.delete(id)
delete vex.system.attributes.death
vex.system.spells = {}
sendCharacter('vex')
await wait(50)
const bare = take().find(e => e.type === 'character.updated').data.character.sheet
assert.deepEqual([bare.spellcasting, bare.spells, bare.inventory.encumbrance, bare.deathSaves], [null, [], null, null])
ok('a character with no spells or spell slots has no spellcasting; without encumbrance tracked, none is shown; a system without death saves has none')

console.log('\nall step 2 checks passed')
