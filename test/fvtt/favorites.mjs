// Favorites: what dnd5e's sheet shows under Favorites, as the module sends it, under dnd5e 6 and
// 5 shaped data.
import assert from 'node:assert/strict'
import { actor, posts, settings, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
const take = () => posts.splice(0).map(p => p.envelope)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
foundry.utils.getProperty = (object, path) => path.split('.').reduce((o, key) => o?.[key], object)

const translations = {
  'DND5E.AbilityDex': 'Dexterity', 'DND5E.AbilityDexAbbr': 'dex', 'DND5E.AbilityWis': 'Wisdom', 'DND5E.AbilityWisAbbr': 'wis',
  'DND5E.SkillPrc': 'Perception', 'DND5E.SkillSte': 'Stealth', 'DND5E.AbbreviationDC': 'DC',
  'DND5E.Action': 'Action', 'DND5E.Actions': 'Actions', 'DND5E.BonusAction': 'Bonus Action', 'DND5E.BonusActions': 'Bonus Actions',
  'DND5E.ShortRest': 'Short Rest', 'DND5E.LongRest': 'Long Rest', 'DND5E.Dawn': 'Dawn',
  'DND5E.DamageFire': 'Fire', 'DND5E.DamagePiercing': 'Piercing', 'DND5E.ActionOther': 'Other',
}
game.i18n.localize = key => translations[key] ?? key
game.i18n.has = key => key in translations
game.i18n.format = key => key
game.settings.get = ((get) => (module, key) => module === 'dnd5e' ? ({ encumbrance: 'none', metricWeightUnits: false })[key] : get(module, key))(game.settings.get.bind(game.settings))

const ordinal = n => ['Cantrips', '1st Level', '2nd Level', '3rd Level'][n] ?? `${n}th Level`
CONFIG.DND5E = {
  abilities: {
    dex: { label: 'DND5E.AbilityDex', abbreviation: 'DND5E.AbilityDexAbbr' },
    wis: { label: 'DND5E.AbilityWis', abbreviation: 'DND5E.AbilityWisAbbr' },
  },
  skills: { prc: { label: 'DND5E.SkillPrc' }, ste: { label: 'DND5E.SkillSte' } },
  conditionTypes: {},
  limitedUsePeriods: { lr: { label: 'DND5E.LongRest' }, sr: { label: 'DND5E.ShortRest' }, dawn: { label: 'DND5E.Dawn' } },
  spellcasting: {
    spell: { slots: true, getAvailableLevels: () => [], getSpellSlotKey: level => `spell${level}`, getLabel: ({ level } = {}) => ordinal(level) },
    pact: { slots: true, getAvailableLevels: () => [], getSpellSlotKey: () => 'pact', getLabel: ({ level } = {}) => level ? `Pact Magic — ${ordinal(level)}` : 'Pact Magic' },
  },
  activityActivationTypes: { action: { label: 'DND5E.Action', header: 'DND5E.Actions' }, bonus: { label: 'DND5E.BonusAction', header: 'DND5E.BonusActions' } },
  damageTypes: { fire: { label: 'DND5E.DamageFire' }, piercing: { label: 'DND5E.DamagePiercing' } },
  healingTypes: {},
}
CONFIG.statusEffects = []
CONFIG.Item = { typeLabels: {}, dataModels: {} }
globalThis.dnd5e = {
  utils: { staticID: id => id }, dataModels: { spellcasting: {} },
  documents: { Trait: { keyLabel: (key, { trait }) => ({ thief: "Thieves' Tools", herb: 'Herbalism Kit', disg: 'Disguise Kit' })[key] ?? `${trait}:${key}` } },
}
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return html } } }
globalThis.fromUuid = async () => null
globalThis.fromUuidSync = () => null

// Collections, as Foundry's and dnd5e's hold documents: by id, and in order.
class Holder {
  constructor(list = []) { this.list = list }
  get size() { return this.list.length }
  get contents() { return this.list }
  get(id) { return this.list.find(entry => entry.id === id) }
  getByType(type) { return this.list.filter(entry => entry.type === type) }
  [Symbol.iterator]() { return this.list[Symbol.iterator]() }
}
const activity = (id, type, activation, { labels = {}, dnd5e5 = false, hidden = false, ...fields } = {}) => ({
  id, type, name: fields.name ?? '', img: `systems/dnd5e/icons/svg/activity/${type}.svg`, activation: { type: activation },
  labels: { activation: translations[CONFIG.DND5E.activityActivationTypes[activation]?.label] ?? activation, ...labels },
  ...(dnd5e5 ? { canUse: !hidden } : { isHidden: hidden }),
  ...fields,
})
const hit = (formula, type) => ({ formula, label: `${formula} ${translations[CONFIG.DND5E.damageTypes[type]?.label]}`, damageType: type })

// ---- Rielle, a battle master with a staff of fire ----
users.activeGM = user('gm', 'Gamemaster', true)
user('cass', 'Cass')
const rielle = actor('rielle', 'Rielle', ['cass'], 'character', { value: 44, max: 52, temp: 0 })
rielle.documentName = 'Actor'
rielle.statuses = new Set()
rielle.system = {
  abilities: { dex: { value: 16, mod: 3 }, wis: { value: 12, mod: 1 } },
  skills: { prc: { ability: 'wis', total: 4, passive: 14, value: 1 }, ste: { ability: 'dex', total: 6, passive: 16, value: 1 } },
  tools: {
    thief: { ability: 'dex', total: 5, prof: { multiplier: 1 }, value: 1, roll: { mode: 1 } },
    disg: { ability: 'cha', total: 0, passive: 10, prof: { multiplier: 0 }, value: 0, roll: { mode: 0 } },
  },
  attributes: { hp: { value: 44, max: 52, temp: 0 }, ac: { value: 17 }, prof: 3, init: { total: 3 }, movement: { walk: 30, units: 'ft' } },
  details: { level: 7 },
  spells: { spell1: { value: 3, max: 4, level: 1, type: 'spell' }, pact: { value: 1, max: 2, level: 3, type: 'pact' } },
  resources: {
    primary: { label: 'Superiority Dice', value: 3, max: 4, sr: true, lr: false },
    secondary: { label: '', value: 1, max: 2, sr: false, lr: true },
    tertiary: { label: 'Luck Points', value: 0, max: 0, sr: false, lr: true },
  },
  currency: {},
  traits: {},
  favorites: [],
}

const items = new Map()
rielle.items = { get: id => items.get(id), [Symbol.iterator]: () => items.values() }
const item = (id, type, name, { system = {}, activities = [], effects = [], ...fields } = {}) => {
  const it = {
    documentName: 'Item', id, uuid: `Actor.rielle.Item.${id}`, type, name, img: `icons/${id}.webp`, sort: 0,
    parent: rielle, actor: rielle, labels: {}, flags: {}, effects: new Holder(effects),
    system: { description: { value: `<p>About ${name}.</p>` }, activities: new Holder(activities), properties: new Set(), ...system },
    getFlag: () => undefined, getRollData: () => ({}), ...fields,
  }
  for (const effect of effects) effect.parent = it
  items.set(id, it)
  return it
}
const effect = (id, name, { disabled = false, suppressed = false, ...fields } = {}) => ({
  id, name, img: `icons/${id}.webp`, disabled, isSuppressed: suppressed, isTemporary: false, statuses: new Set(),
  duration: {}, description: '', system: {}, ...fields,
})

item('rapier', 'weapon', 'Rapier', { system: { equipped: true },
  activities: [activity('stab', 'attack', 'action', { labels: { modifier: '7', damage: [hit('1d8 + 4', 'piercing')] }, getRangeLabel: () => 'reach 5 ft' })] })
// The staff casts Fire Bolt through the copy of it dnd5e keeps on the actor, for two charges.
const boltCopy = item('bolt-copy', 'spell', 'Fire Bolt', { system: { level: 0 }, flags: { dnd5e: { cachedFor: '.Item.staff.Activity.castbolt' } },
  activities: [activity('boltshot', 'attack', 'action', { labels: { modifier: '6', damage: [hit('2d10', 'fire')] } })] })
item('staff', 'weapon', 'Staff of Fire', { system: { equipped: true, uses: { max: 10, spent: 3, recovery: [{ period: 'dawn' }] } }, activities: [
  activity('castbolt', 'cast', 'action', { name: 'Fire Bolt', canUse: true, labels: { range: '120 ft' }, spell: { level: null },
    consumption: { targets: [{ type: 'itemUses', target: '', value: '2' }] }, cachedSpell: boltCopy }),
  activity('castfire', 'save', 'action', { name: 'Cast Fireball', labels: { damage: [hit('8d6', 'fire')], range: '150 ft', target: '20 ft Sphere' },
    save: { ability: new Set(['dex']), dc: { value: 15 } }, uses: { max: 3, spent: 1, recovery: [{ period: 'dawn' }] } }),
  activity('parry', 'utility', 'reaction', { name: 'Parry', activation: { type: 'reaction', condition: 'when a creature hits you with a melee attack' },
    labels: { duration: '1 Round', concentrationDuration: '1 Round' }, duration: { units: 'round', value: 1 },
    description: { chatFlavor: '', value: '<p>Turn the blade aside.</p>' } }),
  activity('hidden', 'utility', 'bonus', { name: 'Old Power', hidden: true }),
  activity('older', 'utility', 'bonus', { name: 'Older Power', dnd5e5: true, hidden: true }),
] })
item('strange', 'weapon', 'Unidentified Blade', { system: { equipped: true, identified: false },
  activities: [activity('strike', 'attack', 'action', { labels: { modifier: '9', damage: [hit('2d6 + 5', 'piercing')], duration: '1 Minute' }, uses: { max: 1, spent: 0, recovery: [] },
    activation: { type: 'action', condition: 'when you speak its name' }, duration: { units: 'minute', value: 1 }, description: { value: '<p>The blade sings.</p>' } })] })
item('cloak', 'equipment', 'Cloak of Displacement', { system: { equipped: true }, effects: [effect('blur', 'Displaced')] })
item('ring', 'equipment', 'Plain Ring', { system: { identified: false }, effects: [effect('wish', 'Wishing')] })
// A staff of frost, not attuned, so it can't cast Ray of Frost through its copy now.
const frostStaff = item('frost', 'weapon', 'Staff of Frost', { system: { equipped: true, attunement: 'required', attuned: false } })
const rayCopy = item('ray-copy', 'spell', 'Ray of Frost', { system: { level: 0 }, flags: { dnd5e: { cachedFor: '.Item.frost.Activity.castray' } },
  activities: [activity('rayshot', 'attack', 'action', { labels: { modifier: '6', damage: [hit('1d8', 'cold')] } })] })
rayCopy.system.linkedActivity = { item: frostStaff, canUse: false, displayInSpellbook: false, visibility: { requireAttunement: true } }
item('secret', 'feat', 'Secret Gift', { isHidden: true })
item('veiled', 'feat', 'Veiled Gift')
rielle.hiddenItems = new Set(['veiled'])
const bless = effect('bless', 'Bless', { parent: rielle, origin: null })
rielle.effects = new Holder([bless])
rielle.allApplicableEffects = function* () {
  yield bless
  for (const it of items.values()) yield* it.effects
}
rielle.itemTypes = {}
rielle.spellcastingClasses = {}

// In the order the player arranged them, which isn't the order they were made favorites in.
rielle.system.favorites = [
  { type: 'skill', id: 'prc', sort: 300000 },
  { type: 'item', id: '.Item.rapier', sort: 100000 },
  { type: 'activity', id: '.Item.staff.Activity.castfire', sort: 200000 },
  { type: 'activity', id: '.Item.staff.Activity.castbolt', sort: 210000 },
  { type: 'activity', id: '.Item.staff.Activity.parry', sort: 220000 },
  { type: 'effect', id: '.ActiveEffect.bless', sort: 400000 },
  { type: 'effect', id: '.Item.cloak.ActiveEffect.blur', sort: 450000 },
  { type: 'tool', id: 'thief', sort: 500000 },
  { type: 'slots', id: 'pact', sort: 600000 },
  { type: 'slots', id: 'spell1', sort: 650000 },
  { type: 'activity', id: '.Item.strange.Activity.strike', sort: 660000 },
  // The spellbook lists Ray of Frost, muted, so it stays a favorite; its attack, which does
  // nothing while the staff can't cast it, is left out, as before.
  { type: 'item', id: '.Item.ray-copy', sort: 670000 },
  { type: 'activity', id: '.Item.ray-copy.Activity.rayshot', sort: 680000 },
  // Left out: gone, hidden from the sheet or from the player, or of a kind dnd5e doesn't make.
  { type: 'item', id: '.Item.gone', sort: 700000 },
  { type: 'item', id: '.Item.secret', sort: 710000 },
  { type: 'item', id: '.Item.veiled', sort: 715000 },
  { type: 'effect', id: '.Item.ring.ActiveEffect.wish', sort: 720000 },
  { type: 'activity', id: '.Item.staff.Activity.hidden', sort: 730000 },
  { type: 'activity', id: '.Item.staff.Activity.older', sort: 735000 },
  { type: 'activity', id: '.Item.staff.Activity.nothing', sort: 740000 },
  { type: 'item', id: '.Item.staff.Activity.castfire', sort: 750000 },
  { type: 'item', id: '.Item.bolt-copy', sort: 760000 },
  { type: 'skill', id: 'xyz', sort: 800000 },
  { type: 'tool', id: 'herb', sort: 810000 },
  { type: 'slots', id: 'spell9', sort: 820000 },
  { type: 'facility', id: '.Item.forge', sort: 900000 },
]

await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaigns', [{ id: 'camp-a', title: 'The Sword Coast', characters: ['rielle'] }])
await Hooks.callAll('ready')
await wait(50)
const sent = take()
// The hello lists Rielle; her descriptions, then her sheet, follow once it's answered.
assert.deepEqual(sent.map(e => e.type), ['bridge.hello', 'character.texts', 'character.updated'])
ok("the hello lists the character; its descriptions, then its sheet, follow once it's answered")
const sheet = sent.find(e => e.type === 'character.updated').data.character.sheet
const texts = Object.assign({}, ...sent.filter(e => e.type === 'character.texts').map(e => e.data.texts))
assert.deepEqual(JSON.parse(JSON.stringify(sheet)), sheet)
ok('the sheet stays plain JSON')

const favorites = sheet.favorites
assert.deepEqual(favorites.map(f => [f.type, f.id]), [
  ['resource', 'primary'],
  ['item', 'rapier'],
  ['activity', 'castfire'],
  ['activity', 'castbolt'],
  ['activity', 'parry'],
  ['skill', 'prc'],
  ['effect', 'bless'],
  ['effect', 'cloak.blur'],
  ['tool', 'thief'],
  ['slots', 'pact'],
  ['slots', 'spell1'],
  ['activity', 'strike'],
  ['item', 'ray-copy'],
])
ok("favorites come in dnd5e's order: its named resources, then the player's own, in the order they arranged them")
ok("left out: a favorite whose item is gone, an item hidden from the sheet or by an effect, an unidentified item's effect, hidden activities under dnd5e 6 and 5, a missing activity, a reference of the wrong kind, an unknown skill or tool, and a kind dnd5e doesn't favorite")

const find = (type, id) => favorites.find(f => f.type === type && f.id === id)
assert.deepEqual(find('resource', 'primary'), { type: 'resource', id: 'primary', name: 'Superiority Dice', uses: { value: 3, max: 4, recovery: 'Short Rest', counter: { resource: 'primary' }, spendable: true }, itemId: null })
ok('a named resource with a maximum, with its uses and when it comes back, from module 0.23.0 no feature it stands for, where the sheet has none, and from 0.29.0 its counter, which may be spent')

assert.deepEqual(find('item', 'rapier'), { type: 'item', id: 'rapier', itemType: 'weapon', name: 'Rapier', img: 'icons/rapier.webp' })
ok('an item by the id the sheet lists it by, with its type')

// Changed on purpose (round 0.36.0 §4.5): every action and activity row carries `tableDamage`, null where it can't be previewed (as here, with no dnd5e activities).
assert.deepEqual(find('activity', 'castfire'), {
  type: 'activity', id: 'castfire', itemId: 'staff', itemType: 'weapon', itemName: 'Staff of Fire', name: 'Cast Fireball',
  img: 'systems/dnd5e/icons/svg/activity/save.svg', activation: 'Action', activationType: 'action', range: '150 ft', target: '20 ft Sphere', toHit: null,
  attackId: null, activity: { id: 'castfire', type: 'save', targets: { self: false, area: false, count: null, perLevel: null, affects: null, fromSelf: false } },
  attackModes: null, ammunition: null,
  save: { ability: 'dex', dc: 15 }, damage: [{ formula: '8d6', type: 'Fire', healing: false }], tableDamage: null,
  uses: { value: 2, max: 3, recovery: 'Dawn', counter: { item: 'staff', activity: 'castfire' }, spendable: true },
})
ok("an activity on its own, as an action is described: the staff's Fireball, with its save, damage and uses, its own, which may be spent")

// Changed on purpose (round 0.36.0 §4.5): every action and activity row carries `tableDamage`, null where it can't be previewed (as here, with no dnd5e activities).
assert.deepEqual(find('activity', 'castbolt'), {
  type: 'activity', id: 'castbolt', itemId: 'staff', itemType: 'weapon', itemName: 'Staff of Fire', name: 'Fire Bolt',
  img: 'systems/dnd5e/icons/svg/activity/cast.svg', activation: 'Action', activationType: 'action', range: '120 ft', target: null, toHit: 6,
  attackId: 'castbolt', activity: null, attackModes: null, ammunition: null, save: null,
  damage: [{ formula: '2d10', type: 'Fire', healing: false }], tableDamage: null, spellId: 'bolt-copy',
  cast: { level: 0, concentration: false, charges: 2, short: false, text: find('activity', 'castbolt').cast.text }, uses: { value: 7, max: 10, recovery: 'Dawn' },
})
assert.equal(texts[find('activity', 'castbolt').cast.text], '<p>About Fire Bolt.</p>')
ok("a spell the staff casts, made a favorite, rolls as the spell does, by the Cast activity's id, with the staff's charges it spends")

const strike = find('activity', 'strike')
assert.deepEqual([strike.name, strike.itemName, strike.activation, strike.toHit, strike.attackId, strike.activity, strike.save, strike.damage, strike.uses],
  ['Unidentified Blade', 'Unidentified Blade', 'Action', null, null, null, null, [], null])
ok("an unidentified weapon's activity keeps its secrets, and is named for the item, as it has no name of its own")

const parry = find('activity', 'parry')
assert.deepEqual([parry.name, parry.duration, parry.trigger, texts[parry.text]],
  ['Parry', '1 Round', 'when a creature hits you with a melee attack', '<p>Turn the blade aside.</p>'])
assert.deepEqual(['duration', 'trigger', 'text'].filter(key => key in find('activity', 'castfire')), [])
assert.deepEqual(['duration', 'trigger', 'text', 'spellId', 'cast'].filter(key => key in strike), [])
assert.ok(!Object.values(texts).some(html => html.includes('The blade sings')))
ok("an activity favorite says how long it lasts, what it's taken in answer to, and under dnd5e 6 has its own description; an unidentified one keeps them to itself")

const { describeActivity } = await import(`${MODULE}/scripts/sheet-rolls.mjs`)
const rapier = items.get('rapier')
const stab = describeActivity(rapier, rapier.system.activities.get('stab'))
assert.deepEqual([stab.attackId, stab.activity, stab.attackModes, stab.ammunition], ['stab', null, null, null])
const staff = items.get('staff')
const boltAlone = describeActivity(staff, staff.system.activities.get('castbolt'))
assert.deepEqual([boltAlone.spellId, boltAlone.cast.charges, 'text' in boltAlone.cast], ['bolt-copy', 2, false])
ok('an attack activity names itself, so the app can have it made in the game')

assert.deepEqual(find('effect', 'bless'), { type: 'effect', id: 'bless', name: 'Bless', img: 'icons/bless.webp', disabled: false, suppressed: false })
assert.deepEqual(find('effect', 'cloak.blur'), { type: 'effect', id: 'cloak.blur', name: 'Displaced', img: 'icons/blur.webp', disabled: false, suppressed: false })
assert.deepEqual(sheet.effects.flatMap(section => section.effects.map(e => e.id)).toSorted(), ['bless', 'cloak.blur'])
ok("effects by the ids the sheet lists them by, the character's own and an item's")

assert.deepEqual(find('skill', 'prc'), { type: 'skill', id: 'prc', name: 'Perception' })
assert.deepEqual(find('tool', 'thief'), { type: 'tool', id: 'thief', name: "Thieves' Tools", ability: 'dex', total: 5, passive: null, proficiency: 1, mode: 1 })
// Since module 0.18.0 the sheet has the character's tools too, described alike, by name, whether
// proficient or not.
assert.deepEqual(sheet.tools, [
  { id: 'disg', name: 'Disguise Kit', ability: 'cha', total: 0, passive: 10, proficiency: 0, mode: 0 },
  { id: 'thief', name: "Thieves' Tools", ability: 'dex', total: 5, passive: null, proficiency: 1, mode: 1 },
])
ok("a skill by its id; a tool as a skill is described, with its roll mode, as the sheet's tools are")

assert.deepEqual(find('slots', 'pact'), { type: 'slots', id: 'pact', name: 'Pact Magic — 3rd Level', value: 1, max: 2, level: 3 })
assert.deepEqual(find('slots', 'spell1'), { type: 'slots', id: 'spell1', name: '1st Level', value: 3, max: 4, level: 1 })
ok('spell slots by their section of the spellbook, with what is left and the level they cast at')

// ---- A spell an item casts higher, made a favorite (module 0.20.0) ----
// A wand of magic missiles that casts at 1st level, and a level higher for each charge more, up to
// 3rd; the player made its Cast activity a favorite.
const missileCopy = item('missile-copy', 'spell', 'Magic Missile', { system: { level: 1 }, flags: { dnd5e: { cachedFor: '.Item.mm-wand.Activity.cast-mm' } },
  activities: [activity('mm-darts', 'damage', 'action', { requiresSpellSlot: true, labels: { damage: [hit('3d4 + 3', 'fire')] }, target: { affects: { type: 'creature', count: 3 } } })] })
const missileWand = item('mm-wand', 'consumable', 'Wand of Magic Missiles', { system: { uses: { max: 7, spent: 2, recovery: [{ period: 'dawn' }] } }, activities: [
  activity('cast-mm', 'cast', 'action', { name: 'Magic Missile', canUse: true, spell: { level: 1 }, cachedSpell: missileCopy,
    consumption: { targets: [{ type: 'itemUses', target: '', value: '1', scaling: { mode: 'amount', formula: '' } }], scaling: { allowed: true, max: '3' } },
    getRollData: () => ({ item: { uses: { value: 5, max: 7, spent: 2 } } }) }),
] })
missileCopy.system.linkedActivity = { item: missileWand, canUse: true, displayInSpellbook: true, visibility: {} }
rielle.system.favorites.push({ type: 'activity', id: '.Item.mm-wand.Activity.cast-mm', sort: 950000 })
const { sendCharacter } = await import(`${MODULE}/scripts/character-sync.mjs`)
sendCharacter('rielle')
await wait(50)
const withWand = take().find(e => e.type === 'character.updated').data.character.sheet
const wandFavorite = withWand.favorites.find(f => (f.type === 'activity') && (f.id === 'cast-mm'))
const wandAction = withWand.actions.flatMap(section => section.actions).find(action => action.id === 'mm-wand')
assert.deepEqual(wandFavorite.cast.levels, [{ level: 1, charges: 1, short: false }, { level: 2, charges: 2, short: false }, { level: 3, charges: 3, short: false }])
assert.deepEqual([wandFavorite.spellId, wandFavorite.cast.levels], [wandAction.spellId, wandAction.cast.levels])
assert.equal(wandFavorite.spellId, 'missile-copy')
ok("a wand's Cast activity made a favorite offers the levels it may be cast at, as its row on the Actions tab does, and names its spell's copy")
rielle.system.favorites.pop()
items.delete('mm-wand')
items.delete('missile-copy')

// ---- A change of favorites in Foundry ----
rielle.system.favorites = [{ type: 'skill', id: 'ste', sort: 100 }, { type: 'item', id: '.Item.rapier', sort: 200 }]
rielle.system.resources.primary.value = 2
await Hooks.callAll('updateActor', rielle, { system: { favorites: rielle.system.favorites } })
await wait(400)
const updated = take().filter(e => e.type === 'character.updated').at(-1)?.data.character.sheet
assert.deepEqual(updated?.favorites.map(f => [f.type, f.id]), [['resource', 'primary'], ['skill', 'ste'], ['item', 'rapier']])
assert.equal(updated.favorites[0].uses.value, 2)
ok('when the player changes their favorites, the character is sent again with them')

// ---- Resources that stand for features (module 0.23.0) ----
// A resource names the feature it stands for, by its id in `features` and `actions`: one of its
// name, compared folded, preferring one that spends it, or else the only feature whose activity
// spends it; null for none. A feature stands for one resource at most.
const { slimSheet } = await import(`${MODULE}/scripts/sheet-slim.mjs`)
const made = []
const feat = (id, name, activities = [], fields = {}) => {
  const it = item(id, 'feat', name, { activities, ...fields })
  made.push(it)
  return it
}
// An activity that spends a resource, as dnd5e makes of an older item's consumption of one.
const spender = (id, key, fields = {}) => activity(id, 'utility', 'bonus', {
  consumption: { targets: [{ type: 'attribute', target: `resources.${key}.value`, value: '1', scaling: {} }] }, ...fields,
})
const pool = (label, value = 1, max = 2) => ({ label, value, max, sr: true, lr: false })
let lastSheet
// The resources' links, once the character is sent again with these resources and features.
const linksFor = async (resources, feats, types = {}) => {
  rielle.system.resources = resources
  rielle.itemTypes = { feat: feats, ...types }
  sendCharacter('rielle')
  await wait(50)
  lastSheet = take().filter(e => e.type === 'character.updated').at(-1)?.data.character.sheet
  assert.ok(lastSheet, 'the character is sent again')
  return Object.fromEntries(lastSheet.favorites.filter(f => f.type === 'resource').map(f => [f.id, f.itemId]))
}
const listed = () => lastSheet.features.flatMap(section => section.features.map(f => f.id))
const clear = () => {
  for (const it of made.splice(0)) items.delete(it.id)
  rielle.itemTypes = {}
}

// H1, H2: a feature of the resource's name, exactly, and folded: curly apostrophe, two spaces, lower case.
const wind = feat('wind', 'Second Wind', [activity('breather', 'heal', 'bonus', { labels: { damage: [hit('1d10 + 7', 'healing')] } })])
const ward = feat('ward', "Warden's Ward")
assert.deepEqual(await linksFor({ primary: pool('Superiority Dice'), secondary: pool('Second Wind', 0, 1), tertiary: pool('Warden’s  ward') }, [wind, ward]),
  { primary: null, secondary: 'wind', tertiary: 'ward' })
assert.deepEqual(lastSheet.favorites[1], { type: 'resource', id: 'secondary', name: 'Second Wind', uses: { value: 0, max: 1, recovery: 'Short Rest', counter: { resource: 'secondary' }, spendable: true }, itemId: 'wind' })
assert.deepEqual(listed(), ['wind', 'ward'])
assert.ok(lastSheet.actions.some(section => section.actions.some(action => action.id === 'wind')))
ok("a resource stands for the feature of its name, by the id `features` and `actions` list it by, its name compared without case, spacing or curly apostrophes; one with none stands for nothing")
clear()

// H3: no feature of its name, and one feature that spends it, also under the id dnd5e gives the
// activity it makes of an older item's consumption.
for (const id of ['flurry-go', 'dnd5eactivity000']) {
  const flurry = feat('flurry', 'Flurry of Blows', [spender(id, 'primary')])
  const step = feat('step', 'Step of the Wind')
  assert.deepEqual(await linksFor({ primary: pool('Ki') }, [step, flurry]), { primary: 'flurry' })
  clear()
}
ok('a resource with no feature of its name stands for the only feature that spends it, an older item made over by dnd5e too')

// H4: several spend it, and none has its name.
const trip = feat('trip', 'Trip Attack', [spender('trip-go', 'primary')])
const riposte = feat('riposte', 'Riposte', [spender('riposte-go', 'primary')])
assert.deepEqual(await linksFor({ primary: pool('Superiority Dice') }, [trip, riposte]), { primary: null })
clear()
ok('a resource several features spend, none of its name, stands for none of them')

// H5: its name wins over a feature that spends it, whichever the sheet lists first.
const convert = feat('convert', 'Convert Sorcery Points', [spender('convert-go', 'primary')], { sort: 1 })
const points = feat('points', 'Sorcery Points', [activity('points-go', 'utility', 'action')], { sort: 2 })
assert.deepEqual(await linksFor({ primary: pool('Sorcery Points') }, [convert, points]), { primary: 'points' })
assert.deepEqual(listed(), ['convert', 'points'])
clear()
ok('a feature of its name stands for a resource, rather than one that spends it')

// H6: two features of its name: the one that spends it; where neither does, the first the sheet
// lists, by its groups' order, the class's before the rest, not by the order the player keeps them.
const fighter = item('fighter-cls', 'class', 'Fighter', { identifier: 'fighter', system: { levels: 5, description: { value: '' } } })
made.push(fighter)
const fromFighter = { getFlag: (scope, key) => (key === 'advancementOrigin') ? 'fighter-cls.adv' : undefined }
const divineA = feat('divine-a', 'Channel Divinity', [], { sort: 900, ...fromFighter })
const divineB = feat('divine-b', 'Channel Divinity', [spender('divine-go', 'tertiary')], { sort: 1 })
assert.deepEqual(await linksFor({ tertiary: pool('Channel Divinity') }, [divineB, divineA], { class: [fighter] }), { tertiary: 'divine-b' })
divineB.system.activities = new Holder([])
assert.deepEqual(await linksFor({ tertiary: pool('Channel Divinity') }, [divineB, divineA], { class: [fighter] }), { tertiary: 'divine-a' })
assert.deepEqual(listed(), ['divine-a', 'divine-b'])
clear()
ok("of two features of its name, the one that spends it stands for a resource, or else the first the sheet's features list")

// H7: a feature stands for one resource at most.
const rage = feat('rage', 'Rage')
assert.deepEqual(await linksFor({ primary: pool('Rage'), secondary: pool('Rage') }, [rage]), { primary: 'rage', secondary: null })
clear()
ok('a feature stands for the first resource it would, and a later one of the same name for none')

// H8: what isn't a feature never stands for one, nor a feature that spends it through an activity
// its player doesn't see, under dnd5e 6 or 5.
const blade = item('moonblade', 'weapon', 'Moonblade', { system: { equipped: true },
  activities: [activity('moon-cut', 'attack', 'action', { labels: { modifier: '7', damage: [hit('1d8 + 4', 'piercing')] },
    consumption: { targets: [{ type: 'attribute', target: 'resources.primary.value', value: '1' }] } })] })
made.push(blade)
const veiledStrike = feat('veiled-strike', 'Psionic Strike', [spender('strike-go', 'secondary', { hidden: true })])
const olderStep = feat('older-step', 'Psionic Step', [spender('step-go', 'secondary', { hidden: true, dnd5e5: true })])
const focusSeen = feat('focus-seen', 'Focused Aim', [spender('aim-go', 'tertiary')])
const focusHidden = feat('focus-hidden', 'Focused Guard', [spender('guard-go', 'tertiary', { hidden: true })])
assert.deepEqual(await linksFor({ primary: pool('Moonblade'), secondary: pool('Psi Dice'), tertiary: pool('Focus') },
  [veiledStrike, olderStep, focusSeen, focusHidden], { weapon: [blade] }), { primary: null, secondary: null, tertiary: 'focus-seen' })
clear()
ok("a weapon of a resource's name, or one that spends it, stands for nothing, and an activity its player doesn't see spends nothing")

// H9: an item's own `system.consume` is no longer dnd5e's: only its activities' consumption counts.
const notes = feat('notes', 'Song Notes', [], { system: { description: { value: '' }, activities: new Holder([]), properties: new Set(),
  consume: { type: 'attribute', target: 'resources.secondary.value', amount: 1 } } })
assert.deepEqual(await linksFor({ secondary: pool('Bardic Notes') }, [notes]), { secondary: null })
clear()
ok("an item's old consumption, which dnd5e reads only as it makes its activities, links nothing of itself")

// H10: the link follows the feature through Foundry's hooks: renamed, it stands for none; named
// back, for it again; deleted, for none.
const surge = feat('surge', 'Second Wind', [activity('surge-go', 'heal', 'bonus')])
assert.deepEqual(await linksFor({ primary: pool('Second Wind', 1, 1) }, [surge]), { primary: 'surge' })
const resent = async (hook, document) => {
  await Hooks.callAll(hook, document, {})
  await wait(400)
  const sheet = take().filter(e => e.type === 'character.updated').at(-1)?.data.character.sheet
  assert.ok(sheet, `the character is sent again after ${hook}`)
  return sheet.favorites.find(f => f.type === 'resource').itemId
}
surge.name = 'Second Breath'
assert.equal(await resent('updateItem', surge), null)
surge.name = 'Second Wind'
assert.equal(await resent('updateItem', surge), 'surge')
items.delete('surge')
rielle.itemTypes.feat = []
assert.equal(await resent('deleteItem', surge), null)
clear()
ok('a renamed feature stands for its resource no longer, and a deleted one for nothing, as the character is sent again')

// H11: a slim sheet keeps every resource's link, null included, as slim leaves resources be.
assert.deepEqual(await linksFor({ primary: pool('Second Wind', 1, 1), secondary: pool('Ki') }, [feat('wind2', 'Second Wind')]),
  { primary: 'wind2', secondary: null })
const slimmed = slimSheet(lastSheet)
assert.deepEqual(slimmed.favorites.filter(f => f.type === 'resource'), lastSheet.favorites.filter(f => f.type === 'resource'))
assert.deepEqual(slimmed.favorites.filter(f => f.type === 'resource').map(f => 'itemId' in f), [true, true])
clear()
ok("a slim sheet's resources keep the features they stand for, and null")

// ---- A character without favorites, or resources ----
delete rielle.system.favorites
delete rielle.system.resources
sendCharacter('rielle')
await wait(50)
assert.deepEqual(take().find(e => e.type === 'character.updated').data.character.sheet.favorites, [])
ok('a character with no favorites, as an older system has none, has an empty list')

console.log('\nall favorites checks passed')
process.exit(0)
