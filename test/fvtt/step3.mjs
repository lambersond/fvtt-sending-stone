// Step 3 of the fuller sheet: actions, as Tidy 5e's Actions tab lists them, under dnd5e 5.3 and
// 6.0 shaped activities.
import assert from 'node:assert/strict'
import { actor, posts, settings, user, users } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
const take = () => posts.splice(0).map(p => p.envelope)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
foundry.utils.getProperty = (object, path) => path.split('.').reduce((o, key) => o?.[key], object)

const translations = {
  'DND5E.AbilityStr': 'Strength', 'DND5E.AbilityStrAbbr': 'str', 'DND5E.AbilityDex': 'Dexterity', 'DND5E.AbilityDexAbbr': 'dex',
  'DND5E.AbilityCon': 'Constitution', 'DND5E.AbilityConAbbr': 'con',
  'DND5E.ActionOther': 'Other', 'DND5E.AbbreviationDC': 'DC',
  'DND5E.Action': 'Action', 'DND5E.Actions': 'Actions', 'DND5E.BonusAction': 'Bonus Action', 'DND5E.BonusActions': 'Bonus Actions',
  'DND5E.Reaction': 'Reaction', 'DND5E.Reactions': 'Reactions', 'DND5E.Special': 'Special', 'DND5E.Minute': 'Minute', 'DND5E.Minutes': 'Minutes',
  'DND5E.LongRest': 'Long Rest', 'DND5E.ShortRest': 'Short Rest', 'DND5E.Dawn': 'Dawn',
  'DND5E.DamageSlashing': 'Slashing', 'DND5E.DamagePiercing': 'Piercing', 'DND5E.DamageFire': 'Fire', 'DND5E.DamageForce': 'Force',
  'DND5E.Healing': 'Healing', 'DND5E.HealingTemp': 'Temporary Hit Points',
  'DND5E.DamageBludgeoning': 'Bludgeoning', 'DND5E.DamageRadiant': 'Radiant', 'DND5E.DAMAGE.Title': 'Damage',
}
game.i18n.localize = key => translations[key] ?? key
game.i18n.has = key => key in translations
game.i18n.format = key => key
game.settings.get = ((get) => (module, key) => module === 'dnd5e' ? ({ encumbrance: 'none', metricWeightUnits: false, rulesVersion: 'modern' })[key] : get(module, key))(game.settings.get.bind(game.settings))

CONFIG.DND5E = {
  abilities: {
    str: { label: 'DND5E.AbilityStr', abbreviation: 'DND5E.AbilityStrAbbr' },
    dex: { label: 'DND5E.AbilityDex', abbreviation: 'DND5E.AbilityDexAbbr' },
    con: { label: 'DND5E.AbilityCon', abbreviation: 'DND5E.AbilityConAbbr' },
  },
  skills: {},
  conditionTypes: {},
  limitedUsePeriods: { lr: { label: 'DND5E.LongRest' }, sr: { label: 'DND5E.ShortRest' }, dawn: { label: 'DND5E.Dawn' } },
  spellcasting: {
    spell: { prepares: true, getAvailableLevels: () => [], getSpellSlotKey: level => `spell${level}`, getLabel: () => 'Spells' },
    pact: { prepares: true, getAvailableLevels: () => [], getSpellSlotKey: () => 'pact', getLabel: () => 'Pact Magic' },
    atwill: { getAvailableLevels: () => [], getSpellSlotKey: () => 'atwill', getLabel: () => 'At-Will' },
    innate: { getAvailableLevels: () => [], getSpellSlotKey: () => 'innate', getLabel: () => 'Innate' },
    ritual: { getAvailableLevels: () => [], getSpellSlotKey: () => 'ritual', getLabel: () => 'Ritual' },
  },
  activityActivationTypes: {
    action: { label: 'DND5E.Action', header: 'DND5E.Actions' },
    bonus: { label: 'DND5E.BonusAction', header: 'DND5E.BonusActions' },
    reaction: { label: 'DND5E.Reaction', header: 'DND5E.Reactions' },
    minute: { label: 'DND5E.Minute', header: 'DND5E.Minutes' },
    longRest: { label: 'DND5E.LongRest' },
    special: { label: 'DND5E.Special' },
  },
  damageTypes: {
    slashing: { label: 'DND5E.DamageSlashing' }, piercing: { label: 'DND5E.DamagePiercing' }, fire: { label: 'DND5E.DamageFire' }, force: { label: 'DND5E.DamageForce' },
    bludgeoning: { label: 'DND5E.DamageBludgeoning' }, radiant: { label: 'DND5E.DamageRadiant' },
  },
  healingTypes: { healing: { label: 'DND5E.Healing' }, temphp: { label: 'DND5E.HealingTemp' } },
}
CONFIG.statusEffects = []
// dnd5e's BasicRoll, as far as a formula's text goes: the roll data put in.
CONFIG.Dice.BasicRoll = class {
  constructor(formula, data) { this.formula = formula.replace(/@([\w.]+)/g, (match, path) => String(foundry.utils.getProperty(data, path) ?? 0)) }
}
CONFIG.Item = { typeLabels: {}, dataModels: {} }
globalThis.dnd5e = { utils: { staticID: id => id }, dataModels: { spellcasting: {} }, documents: { Trait: { keyLabel: key => key } } }
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return html } } }
globalThis.fromUuid = async () => null
globalThis.fromUuidSync = () => null

// An item's activities, as dnd5e's ActivityCollection holds them.
class Activities {
  constructor(list) { this.list = list }
  get size() { return this.list.length }
  get contents() { return this.list }
  getByType(type) { return this.list.filter(activity => activity.type === type) }
  get(id) { return this.list.find(activity => activity.id === id) }
  [Symbol.iterator]() { return this.list[Symbol.iterator]() }
}
// An activity as dnd5e 6 prepares it, or with dnd5e5: true, as dnd5e 5 does. Every activity dnd5e
// makes has an id, so one is made up for those that aren't given one.
let unnamed = 0
const activity = (type, activation, { labels = {}, dnd5e5 = false, hidden = false, ...fields } = {}) => ({
  id: `${type}-${++unnamed}`,
  type, activation: { type: activation }, labels: { activation: translations[CONFIG.DND5E.activityActivationTypes[activation]?.label] ?? activation, ...labels },
  ...(dnd5e5 ? { canUse: !hidden } : { isHidden: hidden }),
  ...fields,
})
const attack = (activation, modifier, damage, fields = {}) => activity('attack', activation, { labels: { modifier, toHit: `+${modifier}`, damage, target: '1 Creature' }, damage: { parts: damage.map(() => ({})) }, ...fields })
const hit = (formula, type) => ({ formula, label: `${formula} ${translations[CONFIG.DND5E.damageTypes[type]?.label ?? CONFIG.DND5E.healingTypes[type]?.label]}`, damageType: type })

// ---- Bruenor, a dwarf fighter and wizard ----
users.activeGM = user('gm', 'Gamemaster', true)
user('bob', 'Bob')
const bruenor = actor('bruenor', 'Bruenor', ['bob'], 'character', { value: 40, max: 52, temp: 0 })
bruenor.documentName = 'Actor'
bruenor.statuses = new Set()
bruenor.allApplicableEffects = function* () {}
bruenor.system = {
  abilities: { str: { value: 18, mod: 4 }, dex: { value: 12, mod: 1 }, con: { value: 16, mod: 3 } },
  skills: {},
  attributes: { hp: { value: 40, max: 52, temp: 0 }, ac: { value: 18 }, prof: 3, init: { total: 1 }, movement: { walk: 25, units: 'ft' } },
  details: { level: 6 },
  spells: {},
  currency: {},
  traits: {},
}
const items = new Map()
bruenor.items = { get: id => items.get(id), [Symbol.iterator]: () => items.values() }
const item = (id, type, name, { system = {}, flags = {}, activities = [], labels = {}, sort = 0, effects = 0, ...fields } = {}) => {
  const it = {
    documentName: 'Item', id, uuid: `Actor.bruenor.Item.${id}`, type, name, img: `icons/${id}.webp`, sort,
    parent: bruenor, actor: bruenor, labels, flags, effects: { size: effects },
    system: { description: { value: `<p>About ${name}.</p>` }, activities: new Activities(activities), properties: new Set(), ...system },
    getFlag: (scope, key) => flags[scope]?.[key], getRollData: () => ({}), ...fields,
  }
  items.set(id, it)
  return it
}

// Weapons: equipped ones only, unless the player says otherwise in Tidy 5e.
item('longsword', 'weapon', 'Longsword', { sort: 2, system: { equipped: true },
  activities: [attack('action', '7', [hit('1d8 + 4', 'slashing')], { id: 'swing', getRangeLabel: () => 'reach 5 ft' })] })
item('javelin', 'weapon', 'Javelin', { sort: 1, system: { equipped: true,
  attackModes: [{ value: 'oneHanded', label: 'One-Handed' }, { rule: true }, { value: 'thrown', label: 'Thrown' }] },
  activities: [attack('action', '7', [hit('1d6 + 4', 'piercing')], { getRangeLabel: () => 'reach 5 ft or range 30/120 ft' })] })
item('longbow', 'weapon', 'Longbow', { system: { equipped: false }, activities: [attack('action', '4', [hit('1d8 + 1', 'piercing')])] })
item('crossbow', 'weapon', 'Hand Crossbow', { system: { equipped: true, properties: new Set(['amm']),
  ammunitionOptions: [
    { value: 'bolts', label: 'Crossbow Bolts (20)', item: { name: 'Crossbow Bolts', system: { quantity: 20 } } },
    { value: 'silver', label: 'Silvered Bolts (0)', item: { name: 'Silvered Bolts', system: { quantity: 0 } }, disabled: true },
  ] },
  activities: [attack('action', '6', [hit('1d6 + 3', 'piercing')], { id: 'shoot' })] })
const dagger = item('dagger', 'weapon', 'Dagger', { system: { equipped: true }, flags: { 'tidy5e-sheet': { 'action-filter-override': false } },
  activities: [attack('action', '7', [hit('1d4 + 4', 'piercing')])] })
item('strange', 'weapon', 'Unidentified Sword', { sort: 3, system: { equipped: true, identified: false, unidentified: { description: '<p>A blade that hums.</p>' }, description: { value: '<p>A Vorpal Sword.</p>' } },
  activities: [attack('action', '10', [hit('2d6 + 7', 'slashing')], { id: 'hum', getRangeLabel: () => 'reach 5 ft' })] })

// Equipment: equipped, and used in a fight.
item('shield', 'equipment', 'Shield', { system: { equipped: true } })
item('cloak', 'equipment', 'Cloak of Displacement', { system: { equipped: false }, activities: [activity('utility', 'action')] })
item('boots', 'equipment', 'Winged Boots', { system: { equipped: true, uses: { max: 4, spent: 1, recovery: [{ period: 'dawn' }] } }, labels: {},
  activities: [activity('utility', 'bonus')] })

// Consumables: used in a fight.
item('potion', 'consumable', 'Potion of Healing', { sort: 5, activities: [activity('heal', 'action', { labels: { damage: [hit('2d4 + 2', 'healing')], range: 'Self' } })] })
item('antitoxin', 'consumable', 'Antitoxin', { activities: [activity('utility', 'minute')] })

// Features with an activation.
item('second-wind', 'feat', 'Second Wind', { system: { uses: { max: 1, spent: 0, recovery: [{ period: 'sr' }, { period: 'lr' }] } },
  activities: [activity('heal', 'bonus', { id: 'breather', labels: { damage: [hit('1d10 + 6', 'healing')], range: 'Self' }, target: { affects: { type: 'self' } } })] })
item('surge', 'feat', 'Action Surge', { system: { uses: { max: 1, spent: 1, recovery: [{ period: 'sr' }] } }, activities: [activity('utility', 'special')] })
item('style', 'feat', 'Fighting Style: Defense')
item('breath', 'feat', 'Breath Weapon', {
  activities: [activity('save', 'action', {
    labels: { damage: [{ formula: '2d6', label: '2d6 Fire or Force', damageType: null }], range: '15 ft', target: '15 ft Cone', recharge: 'Recharge [5+]' },
    save: { ability: new Set(['dex']), dc: { value: 13 } },
    uses: { max: 1, spent: 0, recovery: [{ period: 'recharge', formula: '5' }] },
  })],
})
item('hidden-first', 'feat', 'Arcane Strike', {
  activities: [activity('attack', 'reaction', { hidden: true, labels: { modifier: '9', damage: [hit('9d9', 'force')] } }), activity('save', 'bonus', {
    save: { ability: new Set(['str', 'con']), dc: { value: 15 } }, labels: { damage: [hit('1d10', 'force')] } })],
})
item('old-style', 'feat', 'Indomitable', { activities: [activity('utility', 'reaction', { dnd5e5: true, hidden: true }), activity('utility', 'special', { dnd5e5: true,
  id: 'grit', description: { chatFlavor: 'Grit your teeth.' }, labels: { duration: '1 Round' }, duration: { units: 'round', value: 1 } })] })
item('rest', 'feat', 'Arcane Recovery', { activities: [activity('utility', 'longRest')] })
// Its rage lasts a minute; its ward is taken in answer to a hit, at once, and under dnd5e 6 has a
// description of its own.
item('rage', 'feat', 'Battle Rage', { flags: { 'tidy5e-sheet': { actionSection: ' Barbarian ' } }, activities: [
  activity('utility', 'bonus', { id: 'rage-on', labels: { duration: '1 Minute', concentrationDuration: '1 Minute' }, duration: { units: 'minute', value: 1 } }),
  activity('utility', 'reaction', { id: 'rage-ward', name: 'Ward', activation: { type: 'reaction', condition: 'when a creature you can see hits you' },
    labels: { duration: 'Instantaneous', concentrationDuration: 'Instantaneous' }, duration: { units: 'inst' },
    description: { chatFlavor: '', value: '<p>Turn the blow aside.</p>' } }),
] })
// Midi-QOL's kinds of reaction are reactions; two actions are an action, but not just one.
item('dodge', 'feat', 'Uncanny Dodge', { activities: [activity('utility', 'reactiondamage', {
  id: 'dodge', roll: { formula: '1d4 + @abilities.con.mod', name: 'Luck', prompt: false, visible: false }, getRollData: () => ({ abilities: { con: { mod: 3 } } }),
})] })
item('quick', 'feat', 'Quickened Strike', { activities: [activity('utility', 'action', { id: 'quick', activation: { type: 'action', value: 2 } })] })
// A necklace whose beads never come back is used up, as a potion is; boots whose charges come back at
// dawn are kept.
item('beads', 'equipment', 'Necklace of Beads', { system: { equipped: true, uses: { max: 5, spent: 2, recovery: [] } }, activities: [activity('utility', 'action', { id: 'bead' })] })
item('gone', 'feat', 'Hidden Gift', { isHidden: true, activities: [activity('utility', 'action')] })

// Loot isn't listed, unless the player says so.
item('rope', 'loot', 'Hempen Rope', { flags: { 'tidy5e-sheet': { 'action-filter-override': true } } })

// Spells: castable ones that deal damage, are cast as a bonus action or reaction, last a minute or
// a round, or apply effects.
const spell = (id, name, level, method, { prepared = 1, canPrepare = method === 'spell' || method === 'pact', duration = { units: 'inst' }, activities = [], uses, effects = 0, properties = [], ...fields } = {}) =>
  item(id, 'spell', name, {
    system: { level, method, prepared, canPrepare, duration, properties: new Set(properties), ...(uses ? { uses, hasLimitedUses: true } : {}), ...(fields.system ?? {}) },
    activities, effects, ...fields,
  })
spell('fire-bolt', 'Fire Bolt', 0, 'spell', { prepared: 0, activities: [attack('action', '6', [hit('2d10', 'fire')], { id: 'bolt', getRangeLabel: () => '120 ft' })] })
spell('shield-spell', 'Shield', 1, 'spell', { activities: [activity('utility', 'reaction', { id: 'barrier', labels: { range: 'Self' }, range: { units: 'self' } })] })
spell('fireball', 'Fireball', 3, 'spell', { activities: [activity('save', 'action', {
  id: 'blast', labels: { damage: [hit('8d6', 'fire')], range: '150 ft', target: '20 ft Sphere' }, save: { ability: new Set(['dex']), dc: { value: 15 } }, damage: { parts: [{}] },
  target: { template: { type: 'sphere' }, affects: { type: 'creature' } } })] })
spell('sleep', 'Sleep', 1, 'spell', { duration: { units: 'minute', value: 1 }, activities: [activity('utility', 'action')] })
spell('armor', 'Mage Armor', 1, 'spell', { duration: { units: 'hour', value: 8 }, effects: 1,
  activities: [activity('utility', 'action', { id: 'ward', target: { affects: { type: 'willing', count: 1 } } })] })
spell('familiar', 'Find Familiar', 1, 'spell', { activities: [activity('summon', 'hour')] })
// Bless takes another creature for each level it's cast above 1st: its count is a formula of the
// spell's scaling, which dnd5e works out again for a copy of the spell cast higher.
const blessing = scaling => activity('utility', 'action', { id: 'bless', target: { affects: { type: 'ally', count: 3 + scaling } }, _source: { target: { affects: { count: '3 + @scaling' } } } })
spell('bless', 'Bless', 1, 'spell', { duration: { units: 'minute', value: 1 }, effects: 1, activities: [blessing(0)],
  clone: changes => ({ system: { activities: new Activities([blessing(changes['flags.dnd5e.scaling'] ?? 0)]) } }) })
spell('detect', 'Detect Magic', 1, 'spell', { prepared: 0, duration: { units: 'minute', value: 10 }, activities: [activity('utility', 'action')] })
spell('unprepared-bolt', 'Witch Bolt', 1, 'spell', { prepared: 0, activities: [attack('action', '6', [hit('1d12', 'force')])] })
spell('hex', 'Hex', 1, 'pact', { activities: [activity('utility', 'bonus')], properties: ['concentration'] })
spell('misty', 'Misty Step', 2, 'innate', { uses: { max: 1, value: 0, recovery: [{ period: 'lr' }] }, activities: [activity('utility', 'bonus')] })
spell('rebuke', 'Hellish Rebuke', 2, 'innate', { uses: { max: 1, value: 1, recovery: [{ period: 'lr' }] }, activities: [activity('save', 'reaction')] })
// The spells an item casts: dnd5e keeps a copy of each on the actor, flagged for the Cast activity,
// with the enchantment that makes it the item's, an effect.
// It may not be cast higher (cast-data.mjs:21-39), and its roll data is its item's.
const castOf = (owner, id, activation, copy, { cost = '1', canUse = true, labels = {}, level = null } = {}) => {
  const cast = activity('cast', activation, { id, name: copy?.name ?? 'Charm Person', canUse, labels, spell: { level },
    consumption: { targets: cost === null ? [] : [{ type: 'itemUses', target: '', value: cost }], scaling: { allowed: false, max: '' } },
    cachedSpell: copy, uses: { max: null }, getRollData: () => items.get(owner)?.getRollData() ?? {} })
  if (copy) {
    copy.flags.dnd5e = { cachedFor: `.Item.${owner}.Activity.${id}` }
    copy.system.linkedActivity = { item: items.get(owner), canUse, displayInSpellbook: canUse,
      visibility: { requireAttunement: items.get(owner)?.system?.attunement === 'required' } }
  }
  return cast
}
const cached = (id, name, level, lead, fields = {}) => spell(id, name, level, 'spell', { prepared: 0, effects: 1, activities: [lead], ...fields })
const missile = cached('missile', 'Magic Missile', 1, activity('damage', 'action', { id: 'darts', labels: { damage: [hit('3d4 + 3', 'force')] }, damage: { parts: [{}] }, target: { affects: { type: 'creature', count: 3 } } }))
const wand = item('wand', 'consumable', 'Wand of Magic Missiles', { system: { attunement: '', uses: { max: 7, spent: 2, recovery: [{ period: 'dawn' }] } } })
wand.system.activities = new Activities([castOf('wand', 'cast-missile', 'action', missile, { labels: { range: '120 ft' } })])
const ray = cached('ray', 'Ray of Frost', 0, attack('action', '6', [hit('1d8', 'fire')]))
const staff = item('staff', 'weapon', 'Staff of Frost', { system: { equipped: false, attunement: 'required', attuned: false } })
staff.system.activities = new Activities([castOf('staff', 'cast-ray', 'action', ray, { canUse: false })])
const blur = cached('blur', 'Blur', 2, activity('utility', 'action', { id: 'blur-on' }))
dagger.system.activities = new Activities([...dagger.system.activities, castOf('dagger', 'cast-blur', 'action', blur)])

// A bard's flame: a weapon that strikes, and casts spells of every kind of action, from its charges.
const wisp = cached('wisp', 'Starry Wisp', 0, attack('action', '6', [hit('1d8', 'radiant')], { id: 'wisp-shot' }))
const barbs = cached('barbs', 'Silvery Barbs', 1, activity('utility', 'reaction', { id: 'barbs-use', labels: { range: '60 ft' }, roll: { formula: '1d4', name: '' }, getRollData: () => ({}) }))
const healing = cached('mhw', 'Mass Healing Word', 3, activity('heal', 'bonus', { id: 'mhw-heal', labels: { damage: [hit('1d4 + 3', 'healing')], range: '60 ft' }, target: { affects: { type: 'ally', count: 6 } } }))
const speech = cached('speech', 'Motivational Speech', 3, activity('utility', 'minute', { id: 'speech-use' }), { properties: ['concentration'],
  duration: { units: 'hour', value: 1 }, labels: { duration: '1 Hour', concentrationDuration: 'Concentration, up to 1 hour' } })
const flame = item('flame', 'weapon', 'Bardic Flame', { system: { equipped: true, uses: { max: 10, spent: 8, recovery: [{ period: 'dawn' }] } },
  labels: { activation: 'Action', range: 'reach 5 ft', target: '1 Creature' } })
flame.system.activities = new Activities([
  attack('action', '5', [hit('1d6 + 1', 'bludgeoning')], { id: 'strike', getRangeLabel: () => 'reach 5 ft' }),
  castOf('flame', 'cast-wisp', 'action', wisp, { labels: { range: '60 ft' } }),
  castOf('flame', 'cast-barbs', 'reaction', barbs, { labels: { range: '60 ft' }, level: 1 }),
  castOf('flame', 'cast-charm', 'action', undefined),
  castOf('flame', 'cast-mhw', 'bonus', healing, { cost: '3', labels: { range: '60 ft' } }),
  castOf('flame', 'cast-speech', 'minute', speech, { labels: { range: '30 ft' } }),
])
flame.system.activities.get('cast-barbs').activation.condition = 'when a creature you can see succeeds on a roll'
// A wand of fireballs casts at 4th level, a charge more than its three for the level above, and
// once a day besides, which it has spent.
const fireball3 = cached('fire3', 'Fireball', 3, activity('save', 'action', { id: 'fire3-blast', save: { ability: new Set(['dex']), dc: { value: 15 } }, labels: { damage: [hit('9d6', 'fire')] } }))
const fireWand = item('fire-wand', 'consumable', 'Wand of Fireballs', { system: { uses: { max: 7, spent: 0, recovery: [{ period: 'dawn' }] } } })
const fireCast = castOf('fire-wand', 'cast-fire3', 'action', fireball3, { level: 4 })
fireCast.consumption.targets = [{ type: 'itemUses', target: '', value: '3', scaling: { mode: 'amount', formula: '' } }, { type: 'activityUses', target: '', value: '1' }]
fireCast.uses = { max: 1, spent: 1, value: 0, recovery: [{ period: 'day' }] }
fireWand.system.activities = new Activities([fireCast])
// A lute in the pack, in a section of the bard's own: listed there for what it casts alone.
const lute = item('lute', 'weapon', 'Lute of Charms', { system: { equipped: false }, flags: { 'tidy5e-sheet': { actionSection: 'Bard' } } })
const charm = cached('charm', 'Charm Person', 1, activity('save', 'action', { id: 'charm-save', save: { ability: new Set(['wis']), dc: { value: 13 } } }))
lute.system.activities = new Activities([attack('action', '2', [hit('1d4', 'bludgeoning')], { id: 'lute-hit' }), castOf('lute', 'cast-charm', 'reaction', charm)])
// A legacy whose powers each have uses of their own: darkness spent, a rebuke not.
item('legacy', 'feat', 'Fiendish Legacy', { activities: [
  activity('utility', 'action', { id: 'dark', name: 'Darkness', uses: { max: 1, spent: 1, value: 0, recovery: [{ period: 'lr' }] } }),
  activity('utility', 'reaction', { id: 'rebuke-use', name: 'Rebuke', uses: { max: 1, spent: 0, value: 1, recovery: [{ period: 'lr' }] } }),
] })
// A blade whose flourish has no activation of its own: dnd5e takes the blade's labels from its stab.
item('trick', 'weapon', 'Trick Blade', { system: { equipped: true }, labels: { activation: 'Action', range: 'reach 5 ft', target: '1 Creature' }, activities: [
  activity('utility', '', { id: 'flourish', name: 'Flourish', labels: { activation: '' } }),
  attack('action', '4', [hit('1d4 + 2', 'piercing')], { id: 'stab', name: 'Stab' }),
] })

// A hat left in the pack, and a cane not in hand: listed for what they cast, and that alone.
const disguise = cached('disguise', 'Disguise Self', 1, activity('utility', 'action', { id: 'disguise-on', labels: { range: 'Self' } }))
const hat = item('hat', 'equipment', 'Hat of Disguise', { system: { equipped: false } })
const familiar = cached('hat-familiar', 'Find Familiar', 1, activity('summon', 'hour', { id: 'familiar-call' }))
hat.system.activities = new Activities([castOf('hat', 'cast-disguise', 'action', disguise, { cost: null }), castOf('hat', 'cast-familiar', 'action', familiar, { cost: null })])
const fall = cached('fall', 'Feather Fall', 1, activity('utility', 'reaction', { id: 'fall-on' }))
const cane = item('cane', 'weapon', 'Cane of Feathers', { system: { equipped: false } })
cane.system.activities = new Activities([attack('action', '4', [hit('1d4', 'bludgeoning')], { id: 'cane-hit' }), castOf('cane', 'cast-fall', 'reaction', fall)])

// Items with more than one activity. Hunter's Mark marks a creature, then deals its damage on each
// hit and moves the mark, neither spending a slot; the damage has no name of its own, as dnd5e
// names it for its kind.
spell('mark', "Hunter's Mark", 1, 'spell', { duration: { units: 'hour', value: 1 }, properties: ['concentration'], activities: [
  activity('utility', 'bonus', { id: 'mark-on', name: 'Mark Creature', labels: { range: '90 ft' }, target: { affects: { type: 'creature', count: 1 } }, consumption: { spellSlot: true } }),
  activity('damage', 'special', { id: 'mark-hit', name: '', metadata: { title: 'DND5E.DAMAGE.Title' }, labels: { damage: [hit('1d6', 'force')] }, damage: { parts: [{}] }, consumption: { spellSlot: false } }),
  activity('utility', 'bonus', { id: 'mark-move', name: 'Move Mark', consumption: { spellSlot: false }, description: { chatFlavor: '', value: '<p>Move the mark to another creature.</p>' } }),
] })
// An unarmed strike hits, or grapples or shoves, its target choosing to save with Strength or
// Dexterity.
item('unarmed', 'weapon', 'Unarmed Strike', { sort: 4, system: { equipped: true }, activities: [
  attack('action', '7', [hit('1 + 4', 'bludgeoning')], { id: 'punch', name: 'Attack', getRangeLabel: () => 'reach 5 ft' }),
  activity('save', 'action', { id: 'grapple', name: 'Grapple/Shove', save: { ability: new Set(['str', 'dex']), dc: { value: 15 } }, labels: { range: '5 ft' }, target: { affects: { type: 'creature', count: 1 } } }),
] })
// Channel Divinity, its uses the item's: healing, or a save against radiant damage, or Turn Undead.
item('divinity', 'feat', 'Channel Divinity', { system: { uses: { max: 2, spent: 1, recovery: [{ period: 'sr' }] } }, activities: [
  activity('heal', 'action', { id: 'spark-heal', name: 'Divine Spark: Heal', labels: { damage: [hit('1d8 + 3', 'healing')], range: '30 ft' }, target: { affects: { type: 'creature', count: 1 } } }),
  activity('save', 'action', { id: 'spark-save', name: 'Divine Spark: Save', save: { ability: new Set(['con']), dc: { value: 14 } }, labels: { damage: [hit('1d8', 'radiant')] }, damage: { parts: [{}] } }),
  activity('save', 'action', { id: 'turn', name: 'Turn Undead', save: { ability: new Set(['wis']), dc: { value: 14 } }, target: { template: { type: 'radius' } } }),
] })
// Flaming Sphere is summoned, which the app can't do, then rams, which spends no slot.
spell('sphere', 'Flaming Sphere', 2, 'spell', { duration: { units: 'minute', value: 1 }, properties: ['concentration'], activities: [
  activity('summon', 'action', { id: 'sphere-call', name: 'Summon' }),
  activity('save', 'bonus', { id: 'ram', name: 'Ram', save: { ability: new Set(['dex']), dc: { value: 14 } }, labels: { damage: [hit('2d6', 'fire')] }, damage: { parts: [{}] }, consumption: { spellSlot: false } }),
] })
// A wand not yet identified keeps what each of its activities does to itself.
item('odd-wand', 'consumable', 'Strange Wand', { system: { identified: false, unidentified: { description: '<p>A wand.</p>' } }, activities: [
  activity('damage', 'action', { id: 'zap', name: 'Zap', labels: { damage: [hit('2d6', 'force')], duration: '1 Hour' }, duration: { units: 'hour', value: 1 },
    activation: { type: 'action', condition: 'when the secret word is spoken' }, description: { value: '<p>A secret power.</p>' } }),
  activity('heal', 'action', { id: 'soothe', name: 'Soothe', labels: { damage: [hit('1d4', 'healing')] } }),
  activity('cast', 'reaction', { id: 'odd-cast', name: 'Shield', canUse: true }),
] })

// Area attacks: a spitter in the pack, whose cone takes three; Acid Orbs, not prepared, which takes
// two and another for each level higher; and a ring the player took off the list, casting them.
item('spitter', 'weapon', 'Dragon Spitter', { system: { equipped: false }, activities: [attack('action', '5', [hit('2d6', 'fire')], {
  id: 'spit', target: { template: { type: 'cone' }, affects: { type: 'creature', count: 3 } } })] })
const orbs = scaling => attack('action', '6', [hit('2d4', 'fire')], {
  id: 'orbs-hurl', target: { template: { type: 'sphere' }, affects: { type: 'creature', count: 2 + scaling } }, _source: { target: { affects: { count: '2 + @scaling' } } } })
const orbsClone = changes => ({ system: { activities: new Activities([orbs(changes['flags.dnd5e.scaling'] ?? 0)]) } })
spell('orbs', 'Acid Orbs', 1, 'spell', { prepared: 0, activities: [orbs(0)], clone: orbsClone })
const orbsCopy = cached('orbs-copy', 'Acid Orbs', 1, orbs(0), { clone: orbsClone })
const ring = item('ring', 'equipment', 'Ring of Orbs', { system: { equipped: true }, flags: { 'tidy5e-sheet': { 'action-filter-override': false } } })
ring.system.activities = new Activities([castOf('ring', 'cast-orbs', 'action', orbsCopy)])

// A feat taken off the Actions tab that casts Misty Step; and one whose activities roll nothing,
// whose descriptions, which dnd5e 6 gives them, nothing refers to.
const feyStep = cached('fey-step', 'Misty Step', 2, activity('utility', 'bonus', { id: 'fey-step-use', labels: { range: 'Self' } }))
const fey = item('fey', 'feat', 'Fey Touched', { flags: { 'tidy5e-sheet': { 'action-filter-override': false } } })
fey.system.activities = new Activities([castOf('fey', 'cast-fey-step', 'bonus', feyStep, { cost: null })])
item('wild', 'feat', 'Wild Shape', { flags: { 'tidy5e-sheet': { 'action-filter-override': false } }, activities: [
  activity('transform', 'bonus', { id: 'shape', description: { value: '<p>Change shape.</p>' } }),
  activity('summon', 'bonus', { id: 'companion', description: { value: '<p>Call a wild companion.</p>' } }),
] })

const byType = {}
for (const it of items.values()) (byType[it.type] ??= []).push(it)
bruenor.itemTypes = byType
bruenor.spellcastingClasses = {}

await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaigns', [{ id: 'camp-a', title: 'Mithral Hall', characters: ['bruenor'] }])
await Hooks.callAll('ready')
await wait(50)
const sent = take()
// The hello lists the character; its descriptions, then its sheet, follow once it's answered.
assert.deepEqual(sent.map(e => e.type).filter((type, i, all) => type !== all[i - 1]), ['bridge.hello', 'character.texts', 'character.updated'])
const texts = Object.assign({}, ...sent.filter(e => e.type === 'character.texts').map(e => e.data.texts))
const sheet = sent.find(e => e.type === 'character.updated').data.character.sheet
assert.deepEqual(JSON.parse(JSON.stringify(sheet)), sheet)
ok('the sheet stays plain JSON')

const sections = sheet.actions
assert.deepEqual(sections.map(s => [s.id, s.label, s.actions.map(a => a.name)]), [
  ['action', 'Actions', ['Bardic Flame', 'Bless', 'Breath Weapon', 'Channel Divinity', 'Fiendish Legacy', 'Fire Bolt', 'Fireball', 'Flaming Sphere', 'Hand Crossbow', 'Hat of Disguise', 'Mage Armor', 'Necklace of Beads', 'Quickened Strike', 'Sleep', 'Strange Wand', 'Trick Blade', 'Wand of Fireballs', 'Wand of Magic Missiles', 'Javelin', 'Longsword', 'Unidentified Sword', 'Unarmed Strike', 'Potion of Healing']],
  ['bonus', 'Bonus Actions', ['Arcane Strike', 'Bardic Flame', 'Flaming Sphere', 'Hex', "Hunter's Mark", 'Second Wind', 'Winged Boots']],
  ['reaction', 'Reactions', ['Bardic Flame', 'Cane of Feathers', 'Fiendish Legacy', 'Hellish Rebuke', 'Shield', 'Uncanny Dodge']],
  ['special', 'Special', ['Action Surge', 'Indomitable']],
  ['other', 'Other', ['Arcane Recovery', 'Bardic Flame', 'Hempen Rope', 'Trick Blade']],
  ['Barbarian', 'Barbarian', ['Battle Rage']],
  ['Bard', 'Bard', ['Lute of Charms']],
])
ok("actions are listed as Tidy 5e lists them, in Tidy's sections and the player's own order: equipped weapons, used equipment and consumables, castable spells that matter in a fight, and activated features")
ok('left off: an unequipped weapon or cloak, a shield with nothing to use, an antitoxin that takes a minute, a passive feature, a hidden one, unprepared or spent spells, a spell taking an hour, a cantrip from a staff that needs attuning, and the copies dnd5e keeps of spells cast from items')
ok("a player's own choices in Tidy 5e hold: a dagger taken off the list, a rope put on it, and a feature in a section of its own")

const find = name => sections.flatMap(s => s.actions).find(a => a.name === name)
// Changed on purpose (round 0.36.0 §4.5): every action and activity row carries `tableDamage`, null where it can't be previewed (as here, with no dnd5e activities).
assert.deepEqual({ ...find('Longsword'), text: undefined }, {
  id: 'longsword', name: 'Longsword', img: 'icons/longsword.webp', type: 'weapon', activation: 'Action', activationType: 'action', range: 'reach 5 ft', target: '1 Creature',
  toHit: 7, attackId: 'swing', activity: null, attackModes: null, ammunition: null,
  save: null, damage: [{ formula: '1d8 + 4', type: 'Slashing', healing: false }], tableDamage: null, uses: null, level: null, castFrom: null,
  concentration: false, identified: true, text: undefined,
})
assert.equal(find('Javelin').range, 'reach 5 ft or range 30/120 ft')
assert.equal(texts[find('Longsword').text], '<p>About Longsword.</p>')
ok('a weapon has its activation, reach or range, target, bonus to hit and damage, ability modifier included, and its description')

assert.deepEqual(find('Potion of Healing').damage, [{ formula: '2d4 + 2', type: 'Healing', healing: true }])
assert.deepEqual(find('Second Wind').damage, [{ formula: '1d10 + 6', type: 'Healing', healing: true }])
assert.deepEqual(find('Second Wind').uses, { value: 1, max: 1, recovery: 'Short Rest, Long Rest', counter: { item: 'second-wind' }, spendable: true })
assert.deepEqual(find('Winged Boots').uses, { value: 3, max: 4, recovery: 'Dawn', counter: { item: 'boots' }, spendable: true })
ok("healing is marked as healing, and an item's uses come with it, saying since module 0.29.0 they're the item's, which may be spent")

const breath = find('Breath Weapon')
// Changed on purpose (round 0.36.0 §4.5): a recharge use says the lowest d6 that recharges it.
assert.deepEqual([breath.save, breath.damage, breath.uses, breath.range, breath.target], [
  { ability: 'dex', dc: 13 }, [{ formula: '2d6', type: 'Fire or Force', healing: false }],
  { value: 1, max: 1, recovery: 'Recharge [5+]', recharge: 5, counter: { item: 'breath', activity: breath.activity.id }, spendable: true }, '15 ft', '15 ft Cone',
])
ok("a saving throw's ability and DC, damage of a kind the target chooses, and an activity's own uses with its recharge")

const strike = find('Arcane Strike')
assert.deepEqual([strike.activation, strike.toHit, strike.save, strike.damage], ['Bonus Action', null, { ability: 'DC', dc: 15 }, [{ formula: '1d10', type: 'Force', healing: false }]])
assert.equal(find('Indomitable').activation, 'Special')
ok("an activity hidden from the player is passed over, as dnd5e 6 and dnd5e 5 hide it; a choice of abilities to save with is just a DC")

assert.deepEqual([find('Fire Bolt').level, find('Fire Bolt').toHit, find('Fire Bolt').range, find('Fire Bolt').attackId], [0, 6, '120 ft', 'bolt'])
assert.equal(strike.attackId, null)
assert.deepEqual([find('Fireball').save, find('Fireball').damage, find('Fireball').level], [{ ability: 'dex', dc: 15 }, [{ formula: '8d6', type: 'Fire', healing: false }], 3])
assert.equal(find('Hex').concentration, true)
assert.deepEqual([find('Fireball').castFrom, find('Wand of Magic Missiles').castFrom], [null, null])
ok("a spell has its level, and what it does: Fire Bolt's attack, Fireball's save and damage, Hex's concentration")

assert.deepEqual(find('Fireball').activity, { id: 'blast', type: 'save', targets: { self: false, area: true, count: null, perLevel: null, affects: 'creature', fromSelf: false } })
assert.deepEqual(find('Second Wind').activity, { id: 'breather', type: 'heal', targets: { self: true, area: false, count: null, perLevel: null, affects: 'self', fromSelf: false } })
assert.deepEqual(find('Mage Armor').activity, { id: 'ward', type: 'utility', targets: { self: false, area: false, count: 1, perLevel: null, affects: 'willing', fromSelf: false } })
assert.deepEqual(find('Bless').activity, { id: 'bless', type: 'utility', targets: { self: false, area: false, count: 3, perLevel: 1, affects: 'ally', fromSelf: false } })
assert.deepEqual(find('Shield').activity, { id: 'barrier', type: 'utility', targets: { self: true, area: false, count: null, perLevel: null, affects: null, fromSelf: true } })
// What casting it spends, since module 0.29.0: the Cast activity's charge of the wand, never its spell copy's.
assert.deepEqual(find('Wand of Magic Missiles').activity, { id: 'cast-missile', type: 'damage', targets: { self: false, area: false, count: 3, perLevel: null, affects: 'creature', fromSelf: false }, spends: [{ counter: { item: 'wand' }, amount: 1 }] })
assert.equal(find('Fire Bolt').activity, null)
ok("what else each action is used through, for the app to have it used here: Fireball's save at an area, Second Wind's healing on oneself, Mage Armor on one willing creature, Bless on three allies and one more a level, Shield on oneself, a wand's Magic Missile darts at three")

assert.deepEqual(find('Javelin').attackModes, [{ value: 'oneHanded', label: 'One-Handed' }, { value: 'thrown', label: 'Thrown' }])
assert.equal(find('Longsword').attackModes, null)
assert.deepEqual(find('Hand Crossbow').ammunition, [{ id: 'bolts', name: 'Crossbow Bolts', quantity: 20 }, { id: 'silver', name: 'Silvered Bolts', quantity: 0 }])
assert.deepEqual([find('Javelin').ammunition, find('Hand Crossbow').attackId], [null, 'shoot'])
ok("a weapon's ways to attack, when it has more than one, and the ammunition it fires, with how much is left")

const strange = find('Unidentified Sword')
assert.deepEqual([strange.identified, strange.toHit, strange.attackId, strange.activity, strange.attackModes, strange.ammunition, strange.save, strange.damage, strange.uses],
  [false, null, null, null, null, null, null, [], null])
assert.equal(texts[strange.text], '<p>A blade that hums.</p>')
assert.ok(!Object.values(texts).some(html => html.includes('Vorpal')))
ok("an unidentified weapon keeps its numbers and its true description to itself")

const refs = sections.flatMap(s => s.actions.map(a => a.text)).filter(Boolean)
assert.ok(refs.length >= 20 && refs.every(ref => ref in texts))
ok("every action's description goes in character.texts before the sheet")

// ---- Spells, features and inventory items carry what they roll ----
const spellOf = id => sheet.spells.flatMap(section => section.spells).find(spell => spell.id === id)
const featureOf = id => sheet.features.flatMap(section => section.features).find(feature => feature.id === id)
const everyItem = items => items.flatMap(item => [item, ...everyItem(item.contents ?? [])])
const itemOf = id => everyItem(sheet.inventory.sections.flatMap(section => section.items)).find(item => item.id === id)
const rollsIn = entry => ['toHit', 'attackId', 'activity', 'attackModes', 'ammunition', 'save', 'damage'].map(key => entry[key])
const fireball = spellOf('fireball')
assert.deepEqual(rollsIn(fireball).slice(0, 2), [null, null])
assert.equal(fireball.activity.type, 'save')
assert.deepEqual([fireball.save, fireball.damage], [find('Fireball').save, find('Fireball').damage])
const witch = spellOf('unprepared-bolt')
assert.deepEqual([witch.prepared, witch.toHit, witch.damage.map(part => part.formula)], [0, 6, ['1d12']])
assert.deepEqual([spellOf('fire-bolt').toHit, spellOf('fire-bolt').attackId], [6, 'bolt'])
assert.equal(spellOf('sleep').activity.type, 'utility')
assert.ok(!('activity' in spellOf('familiar')) && !('toHit' in spellOf('familiar')), 'a summoning rolls nothing the app uses')
assert.deepEqual([fireball.name, fireball.level, fireball.prepared], ['Fireball', 3, 1], 'a spell keeps its own fields')
ok('spells carry what they roll as actions do, prepared or not: Witch Bolt\'s attack, Fireball\'s saving throw and damage, Sleep\'s use')

const surge = featureOf('surge')
assert.deepEqual([surge.activity.type, surge.range, surge.target, surge.concentration], ['utility', find('Action Surge').range, find('Action Surge').target, false])
assert.deepEqual(rollsIn(featureOf('second-wind')), rollsIn(find('Second Wind')))
assert.ok(!('activity' in featureOf('style')) && !('range' in featureOf('style')), 'a passive feature rolls nothing')
ok('features carry what they roll, and how far and at whom they reach; a passive one stays as it was')

const longbow = itemOf('longbow')
assert.deepEqual([longbow.equipped, longbow.toHit, longbow.damage.map(part => part.formula)], [false, 4, ['1d8 + 1']])
assert.deepEqual(rollsIn(itemOf('potion')), rollsIn(find('Potion of Healing')))
assert.ok(!('toHit' in itemOf('strange')) && !('damage' in itemOf('strange')), 'an unidentified weapon keeps its numbers to itself')
assert.ok(!('activity' in itemOf('rope')), 'rope rolls nothing')
ok('inventory items carry what they roll, an unequipped bow too; an unidentified one keeps it to itself')

// ---- Items with more than one activity ----
const mark = find("Hunter's Mark")
assert.deepEqual([mark.activation, mark.toHit, mark.damage, 'consumesSlot' in mark], ['Bonus Action', null, [], false])
assert.deepEqual(mark.activity, { id: 'mark-on', type: 'utility', targets: { self: false, area: false, count: 1, perLevel: null, affects: 'creature', fromSelf: false } })
assert.deepEqual(mark.activities.map(a => [a.id, a.name, a.type, a.activation, a.consumesSlot]), [
  ['mark-on', 'Mark Creature', 'utility', 'Bonus Action', undefined],
  ['mark-hit', 'Damage', 'damage', 'Special', false],
  ['mark-move', 'Move Mark', 'utility', 'Bonus Action', false],
])
assert.deepEqual([mark.activities[1].activity.id, mark.activities[1].damage], ['mark-hit', [{ formula: '1d6', type: 'Force', healing: false }]])
assert.deepEqual(spellOf('mark').activities, mark.activities)
ok("an item with more than one activity is its first, as Hunter's Mark is its marking, and lists each: its damage on a hit, named for its kind, and moving the mark, neither spending a slot")

const unarmed = find('Unarmed Strike')
assert.deepEqual([unarmed.toHit, unarmed.attackId, unarmed.activity, unarmed.save, unarmed.range], [7, 'punch', null, null, 'reach 5 ft'])
assert.deepEqual(unarmed.activities.map(a => [a.name, a.type, a.toHit, a.attackId, a.save, a.activity?.type ?? null, a.range]), [
  ['Attack', 'attack', 7, 'punch', null, null, 'reach 5 ft'],
  ['Grapple/Shove', 'save', null, null, { ability: 'DC', dc: 15 }, 'save', '5 ft'],
])
ok('a weapon that also grapples attacks first, and lists the grapple, its saving throw a choice of two abilities')

const divinity = find('Channel Divinity')
assert.deepEqual([divinity.activity.type, divinity.damage, divinity.uses], ['heal', [{ formula: '1d8 + 3', type: 'Healing', healing: true }], { value: 1, max: 2, recovery: 'Short Rest', counter: { item: 'divinity' }, spendable: true }])
assert.deepEqual(divinity.activities.map(a => [a.name, a.save, a.damage.map(part => part.formula), a.uses]), [
  ['Divine Spark: Heal', null, ['1d8 + 3'], null],
  ['Divine Spark: Save', { ability: 'con', dc: 14 }, ['1d8'], null],
  ['Turn Undead', { ability: 'wis', dc: 14 }, [], null],
])
assert.deepEqual(featureOf('divinity').activities, divinity.activities)
ok("Channel Divinity's choices are listed each with what it does, its uses the feature's own")

const sphere = spellOf('sphere')
assert.deepEqual(rollsIn(sphere), [null, null, null, null, null, null, []])
assert.deepEqual(sphere.activities.map(a => [a.name, a.type, a.activity?.type ?? null, a.save, a.consumesSlot]), [
  ['Summon', 'summon', null, null, undefined],
  ['Ram', 'save', 'save', { ability: 'dex', dc: 14 }, false],
])
const sphereRows = sections.flatMap(s => s.actions.filter(a => a.id === 'sphere').map(a => [s.id, a.activityName, a.activationType, a.activities]))
assert.deepEqual(sphereRows, [['action', undefined, 'action', [sphere.activities[0]]], ['bonus', 'Ram', 'bonus', [sphere.activities[1]]]])
assert.deepEqual(rollsIn(sphereRows[1][3][0]).slice(2, 3), [{ id: 'ram', type: 'save', targets: { self: false, area: false, count: null, perLevel: null, affects: null, fromSelf: false } }])
ok('a spell first summoned, which rolls nothing here, still lists the ram that follows, under Bonus Actions, where it is used')

assert.ok(!('activities' in find('Longsword')) && !('activities' in spellOf('fireball')) && !('activities' in featureOf('second-wind')), 'one activity lists none')
const oddWand = find('Strange Wand')
assert.deepEqual([oddWand.identified, oddWand.damage, 'activities' in oddWand, 'activities' in itemOf('odd-wand')], [false, [], false, false])
ok('an item with one activity lists none, and one not identified keeps its activities to itself')

// ---- An item under each kind of action it has, and the spells it casts ----
const rowsFor = id => sections.flatMap(s => s.actions.filter(a => a.id === id).map(a => ({ section: s.id, ...a })))
const flameRows = rowsFor('flame')
assert.deepEqual(flameRows.map(a => [a.section, a.activityName, a.activationType, a.activation, a.range, a.activities.map(x => x.id)]), [
  ['action', undefined, 'action', 'Action', 'reach 5 ft', ['strike', 'cast-wisp', 'cast-charm']],
  ['bonus', 'Mass Healing Word', 'bonus', 'Bonus Action', '60 ft', ['cast-mhw']],
  ['reaction', 'Silvery Barbs', 'reaction', 'Reaction', '60 ft', ['cast-barbs']],
  ['other', 'Motivational Speech', null, 'Minute', '30 ft', ['cast-speech']],
])
assert.ok(flameRows.every(a => a.name === 'Bardic Flame' && a.type === 'weapon' && !a.consumable && a.uses.value === 2 && a.uses.max === 10))
ok('a weapon that casts spells is listed under each kind of action it has, as itself, each row with the activities of that kind, named for the first where it is not the weapon\'s own first')

const [strikeRow, healRow, barbsRow, speechRow] = flameRows
assert.deepEqual([strikeRow.toHit, strikeRow.attackId, strikeRow.cast], [5, 'strike', undefined])
const [, wispEntry, charmEntry] = strikeRow.activities
// Changed on purpose (round 0.36.0 §4.5): every action and activity row carries `tableDamage`, null where it can't be previewed (as here, with no dnd5e activities).
assert.deepEqual({ ...wispEntry, uses: undefined }, {
  id: 'cast-wisp', name: 'Starry Wisp', type: 'cast', activation: 'Action', activationType: 'action', range: '60 ft', target: null,
  toHit: 6, attackId: 'cast-wisp', activity: null, attackModes: null, ammunition: null, save: null,
  damage: [{ formula: '1d8', type: 'Radiant', healing: false }], tableDamage: null, spellId: 'wisp',
  cast: { level: 0, concentration: false, charges: 1, short: false, text: spellOf('wisp').text }, uses: undefined,
})
assert.deepEqual(wispEntry.uses, { value: 2, max: 10, recovery: 'Dawn' })
assert.deepEqual([charmEntry.type, charmEntry.toHit, charmEntry.attackId, charmEntry.activity, charmEntry.damage, charmEntry.range, charmEntry.uses, 'cast' in charmEntry, 'spellId' in charmEntry],
  ['cast', null, null, null, [], null, null, false, false])
ok("a spell cast from it rolls as the spell does, by the Cast activity's id, with the charges it spends from the weapon's; one dnd5e hasn't copied rolls nothing, and borrows nothing of the weapon's")

assert.deepEqual([healRow.attackId, healRow.activity, healRow.damage], [null,
  { id: 'cast-mhw', type: 'heal', targets: { self: false, area: false, count: 6, perLevel: null, affects: 'ally', fromSelf: false }, spends: [{ counter: { item: 'flame' }, amount: 3 }] },
  [{ formula: '1d4 + 3', type: 'Healing', healing: true }]])
assert.deepEqual({ ...healRow.cast, text: undefined }, { level: 3, concentration: false, charges: 3, short: true, text: undefined })
assert.equal(texts[healRow.cast.text], '<p>About Mass Healing Word.</p>')
assert.equal(texts[healRow.text], '<p>About Bardic Flame.</p>')
assert.deepEqual([barbsRow.cast.level, barbsRow.cast.charges, barbsRow.cast.short, barbsRow.activity.type], [1, 1, false, 'utility'])
assert.deepEqual([speechRow.cast.concentration, speechRow.concentration, strikeRow.concentration], [true, true, false])
ok("a row that casts a spell has its level, its cost in charges, whether there are that many, the spell's concentration, and the spell's description to open to")

const wandRow = find('Wand of Magic Missiles')
assert.deepEqual([wandRow.activityName, wandRow.consumable, wandRow.damage, wandRow.uses, wandRow.cast.charges, 'activities' in wandRow],
  [undefined, true, [{ formula: '3d4 + 3', type: 'Force', healing: false }], { value: 5, max: 7, recovery: 'Dawn', counter: { item: 'wand' }, spendable: true }, 1, false])
const hatRow = rowsFor('hat')
assert.deepEqual(hatRow.map(a => [a.section, a.activityName, a.activity?.id, a.cast?.charges]), [['action', undefined, 'cast-disguise', null]])
assert.deepEqual(rowsFor('cane').map(a => [a.section, a.activityName, a.toHit, a.activity?.id]), [['reaction', 'Feather Fall', null, 'cast-fall']])
assert.deepEqual([rowsFor('dagger'), rowsFor('staff')], [[], []])
for (const copy of ['missile', 'ray', 'blur', 'wisp', 'barbs', 'mhw', 'speech', 'disguise', 'fall']) assert.deepEqual(rowsFor(copy), [], copy)
ok("a wand casts its spell itself; a hat in the pack and a cane not in hand are listed for what they cast alone; a dagger taken off the list, and a staff that needs attuning, cast nothing; no copy of a spell is listed")

assert.deepEqual(rowsFor('odd-wand').map(a => [a.section, 'activities' in a, a.activityName]), [['action', false, undefined]])
assert.deepEqual(rowsFor('rage').map(a => [a.section, a.activities.map(x => x.id)]), [['Barbarian', ['rage-on', 'rage-ward']]])
assert.deepEqual(rowsFor('mark').map(a => [a.section, a.activities.map(x => x.id)]), [['bonus', ['mark-on', 'mark-hit', 'mark-move']]])
assert.deepEqual(rowsFor('dodge').map(a => [a.section, a.activationType]), [['reaction', 'reaction']])
assert.deepEqual(rowsFor('quick').map(a => [a.section, a.activationType]), [['action', null]])
ok("an unidentified wand and a feature in the player's own section are one row each; a follow-up of a special kind stays with its spell; Midi's reactions are reactions; two actions aren't one")

assert.deepEqual(['beads', 'potion', 'wand', 'boots', 'longsword', 'odd-wand', 'second-wind'].map(id => rowsFor(id)[0]?.consumable ?? false),
  [true, true, true, false, false, false, false])
ok('used up rather than kept: a potion, a wand, and a necklace whose beads never come back; not boots whose charges come back at dawn, a sword, an unidentified wand or a feature')

const [fireRow] = rowsFor('fire-wand')
assert.deepEqual([fireRow.cast.level, fireRow.cast.charges, fireRow.cast.short], [4, 4, true])
ok("a wand's spell cast a level higher costs a charge more, as dnd5e scales it, and is short where its daily use is spent, though the wand has charges")

// None of these Cast activities may be cast higher, so no cast anywhere on the sheet offers levels
// (module 0.20.0).
const castsIn = value => (Array.isArray(value) ? value.flatMap(castsIn)
  : (value && (typeof value === 'object')) ? [...(value.cast ? [value.cast] : []), ...Object.values(value).flatMap(castsIn)] : [])
const everyCast = castsIn(sheet)
assert.ok(everyCast.length > 20, String(everyCast.length))
assert.deepEqual(everyCast.filter(cast => 'levels' in cast), [])
ok("a Cast activity that can't be cast higher offers no levels, wherever the sheet has it")

// ---- Item details for the app's info dialog (module 0.17.0) ----
const copies = { 'cast-wisp': 'wisp', 'cast-barbs': 'barbs', 'cast-mhw': 'mhw', 'cast-speech': 'speech' }
const castEntries = list => list.filter(entry => entry.type === 'cast')
const castsAsCopied = (label, list) => {
  for (const entry of castEntries(list)) {
    const copy = copies[entry.id]
    if (!copy) {
      assert.deepEqual([entry.id, 'spellId' in entry, 'cast' in entry], ['cast-charm', false, false], label)
      continue
    }
    assert.equal(entry.spellId, copy, `${label} ${entry.id}`)
    assert.ok(entry.cast.text && entry.cast.text === spellOf(copy).text && entry.cast.text in texts, `${label} ${entry.id}`)
  }
}
const flameEntries = flameRows.flatMap(row => row.activities)
assert.deepEqual(castEntries(flameEntries).map(entry => entry.id).toSorted(), ['cast-barbs', 'cast-charm', 'cast-mhw', 'cast-speech', 'cast-wisp'])
castsAsCopied('action', flameEntries)
assert.deepEqual(castEntries(itemOf('flame').activities).map(entry => entry.id), ['cast-wisp', 'cast-barbs', 'cast-charm', 'cast-mhw', 'cast-speech'])
castsAsCopied('inventory', itemOf('flame').activities)
assert.deepEqual([healRow.spellId, barbsRow.spellId, speechRow.spellId, 'spellId' in strikeRow], ['mhw', 'barbs', 'speech', false])
ok("every Cast with a copy of its spell names the copy the Spells tab lists, and carries its description, the same text by the same hash, on the Actions tab's folded activities and the inventory's; one dnd5e hasn't copied names none")

assert.deepEqual([wandRow.spellId, wandRow.cast.text, itemOf('wand').spellId, itemOf('wand').cast.text],
  ['missile', spellOf('missile').text, 'missile', spellOf('missile').text])
const feyFeature = featureOf('fey')
assert.deepEqual([feyFeature.spellId, feyFeature.cast.text, feyFeature.activity.id, rowsFor('fey')], ['fey-step', spellOf('fey-step').text, 'cast-fey-step', []])
assert.equal(texts[feyFeature.cast.text], '<p>About Misty Step.</p>')
ok("an inventory item or a feature that casts a spell carries the spell's copy and description, as an action does")

const [hatAction] = rowsFor('hat')
const familiarEntry = hatAction.activities.find(entry => entry.id === 'cast-familiar')
assert.deepEqual([familiarEntry.type, familiarEntry.spellId, 'cast' in familiarEntry, familiarEntry.toHit, familiarEntry.activity, familiarEntry.damage],
  ['cast', 'hat-familiar', false, null, null, []])
assert.deepEqual(itemOf('hat').activities.find(entry => entry.id === 'cast-familiar').spellId, 'hat-familiar')
assert.deepEqual([spellOf('hat-familiar').name, spellOf('hat-familiar').castFrom], ['Find Familiar', { id: 'hat', name: 'Hat of Disguise' }])
ok("a Cast whose spell rolls nothing here, such as a familiar called, still names its spell's copy, which the Spells tab lists")

const speechEntry = speechRow.activities[0]
assert.deepEqual([speechEntry.id, speechEntry.duration, 'trigger' in speechEntry], ['cast-speech', 'Concentration, up to 1 hour', false])
assert.deepEqual([barbsRow.activities[0].trigger, 'duration' in barbsRow.activities[0], 'duration' in wispEntry, 'trigger' in wispEntry],
  ['when a creature you can see succeeds on a roll', false, false, false])
const [rageOn, rageWard] = rowsFor('rage')[0].activities
assert.deepEqual([rageOn.duration, 'trigger' in rageOn, 'text' in rageOn], ['1 Minute', false, false])
assert.deepEqual([rageWard.trigger, 'duration' in rageWard], ['when a creature you can see hits you', false])
assert.equal(texts[rageWard.text], '<p>Turn the blow aside.</p>')
assert.deepEqual(featureOf('rage').activities, rowsFor('rage')[0].activities)
ok("an activity says how long it lasts, as dnd5e labels it, a Cast as its spell's copy does, but nothing for an instant; a reaction says what it's taken in answer to; and under dnd5e 6, an activity has its own description")

const markMove = mark.activities.find(entry => entry.id === 'mark-move')
assert.equal(texts[markMove.text], '<p>Move the mark to another creature.</p>')
assert.equal(spellOf('mark').activities.find(entry => entry.id === 'mark-move').text, markMove.text)
ok("a spell's activity's own description is the same on the Spells tab as on the Actions tab")

const { describeActivity: describeOne } = await import(`${MODULE}/scripts/sheet-rolls.mjs`)
const { SheetTexts } = await import(`${MODULE}/scripts/sheet-texts.mjs`)
const collected = new SheetTexts()
const grit = describeOne(items.get('old-style'), items.get('old-style').system.activities.get('grit'), collected)
assert.deepEqual([grit.duration, 'text' in grit, collected.sources.size], ['1 Round', false, 0])
ok("under dnd5e 5, whose activities have only a line of chat flavor, an activity has no description of its own")

const oddWandItem = items.get('odd-wand')
const zap = describeOne(oddWandItem, oddWandItem.system.activities.get('zap'), collected)
assert.deepEqual(['duration', 'trigger', 'text', 'spellId', 'cast'].filter(key => key in zap), [])
assert.equal(collected.sources.size, 0)
assert.ok(!Object.values(texts).some(html => html.includes('secret power') || html.includes('A secret power')))
ok("an activity of an item not identified yet keeps how long it lasts, what it's taken in answer to and its description to itself")

assert.ok(!('activities' in featureOf('wild')))
assert.ok(!Object.values(texts).some(html => html.includes('Change shape') || html.includes('wild companion')))
ok("a feature whose activities roll nothing sends none of their descriptions, which nothing would refer to")

const wispAlone = describeOne(flame, flame.system.activities.get('cast-wisp'))
assert.deepEqual([wispAlone.spellId, 'text' in wispAlone.cast, wispAlone.cast.charges], ['wisp', false, 1])
ok("without the sheet's descriptions, as before, a Cast still names its spell's copy, and refers to no description")

assert.deepEqual(rowsFor('lute').map(a => [a.section, a.activityName, a.activity?.id, 'activities' in a]), [['Bard', 'Charm Person', 'cast-charm', false]])
ok("an item in the pack in the player's own section is listed there for what it casts alone, once")

assert.deepEqual(rowsFor('legacy').map(a => [a.section, a.activityName, a.uses]), [
  ['action', undefined, { value: 0, max: 1, recovery: 'Long Rest', counter: { item: 'legacy', activity: 'dark' }, spendable: true }],
  ['reaction', 'Rebuke', { value: 1, max: 1, recovery: 'Long Rest', counter: { item: 'legacy', activity: 'rebuke-use' }, spendable: true }],
])
ok("a row for a later activity has that activity's uses, not the first's")

assert.deepEqual(rowsFor('trick').map(a => [a.section, a.activityName, a.activation, a.range, a.target, a.activationType]), [
  ['action', 'Stab', 'Action', 'reach 5 ft', '1 Creature', 'action'],
  ['other', undefined, null, null, null, null],
])
ok("an item's labels are the activity's dnd5e takes them from, and no other's; one with no activation has no kind of action")

assert.deepEqual([spellOf('missile').prepared, spellOf('missile').castFrom, spellOf('wisp').prepared, spellOf('fireball').prepared],
  [null, { id: 'wand', name: 'Wand of Magic Missiles' }, null, 1])
assert.ok(sheet.spells.find(section => section.id === 'item').spells.some(spell => spell.id === 'barbs'))
ok("a spell cast from an item isn't one to prepare, on the Spells tab, as dnd5e's sheet has it, and is still listed there")

// The staff's Ray of Frost, which dnd5e's sheet leaves out until the staff is attuned, is listed,
// saying so, and rolls nothing; the Actions tab doesn't list it.
const frost = spellOf('ray')
assert.deepEqual(frost.castFrom, { id: 'staff', name: 'Staff of Frost', usable: false, attune: true })
assert.deepEqual(['toHit', 'attackId', 'activity', 'save', 'damage', 'activities'].filter(key => key in frost), [])
assert.ok(sheet.spells.find(section => section.id === 'item').spells.includes(frost))
assert.ok(!sheet.actions.flatMap(section => section.actions).some(action => action.attackId === 'cast-ray'))
// The wand's Magic Missile, which it can cast, rolls as before.
assert.deepEqual([spellOf('missile').activity?.id, spellOf('missile').damage.map(part => part.formula)], ['darts', ['3d4 + 3']])
ok("a spell its item can't cast now is listed, saying why, and rolls nothing")

// ---- Area attacks, and a utility's own roll ----
assert.equal(sheet.rules, 'modern')
assert.deepEqual(itemOf('spitter').attackArea, { count: 3, perLevel: null, affects: 'creature' })
assert.deepEqual(spellOf('orbs').attackArea, { count: 2, perLevel: 1, affects: 'creature' })
// Cast from the ring, since module 0.20.0, as many more a level higher as its copy takes.
assert.deepEqual([itemOf('ring').attackArea, itemOf('ring').attackId], [{ count: 2, perLevel: 1, affects: 'creature' }, 'cast-orbs'])
assert.deepEqual(['attackArea' in find('Longsword'), 'attackArea' in find('Fire Bolt'), 'attackArea' in find('Fireball'), 'attackArea' in strange],
  [false, false, false, false])
ok("the sheet says it plays by the modern rules, and whom an area attack is made at: as many as it takes, more a level higher, cast from an item too; nothing of it for an attack at one target, or a save at an area")

assert.deepEqual([find('Uncanny Dodge').rollFormula, featureOf('dodge').rollFormula], [{ formula: '1d4 + 3', name: 'Luck' }, { formula: '1d4 + 3', name: 'Luck' }])
assert.deepEqual([barbsRow.rollFormula, barbsRow.activity.id], [{ formula: '1d4', name: null }, 'cast-barbs'])
const { describeActivity } = await import(`${MODULE}/scripts/sheet-rolls.mjs`)
assert.deepEqual(describeActivity(items.get('dodge'), items.get('dodge').system.activities.get('dodge')).rollFormula, { formula: '1d4 + 3', name: 'Luck' })
assert.deepEqual(['rollFormula' in find('Action Surge'), 'rollFormula' in find('Longsword'), 'rollFormula' in strange], [false, false, false])
ok("a utility's own roll is on the sheet, with the character's numbers in it and its name, as an activity favorite has it too; a spell's cast from an item, by the Cast activity's id")

// ---- Spells an item casts higher (module 0.20.0) ----
// dnd5e works out the most levels a Cast activity may be cast at from a formula of the item's
// numbers, with Foundry's Roll: here as far as numbers, @ data, + and -, and min() and max() of two
// numbers go.
class FormulaRoll {
  constructor(formula, data = {}) {
    const text = String(formula).replace(/@([\w.]+)/g, (match, path) => String(foundry.utils.getProperty(data, path) ?? 0))
      .replace(/\b(min|max)\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, (match, fn, a, b) => String(Math[fn](Number(a), Number(b))))
    if (!/^[\d\s.+-]+$/.test(text)) throw new Error(`Can't read ${formula}`)
    this.total = text.replace(/\s/g, '').split(/(?=[+-])/).reduce((sum, part) => sum + Number(part), 0)
  }
  get isDeterministic() { return true }
  evaluateSync() { return this }
}
const StubRoll = foundry.dice.Roll
foundry.dice.Roll = FormulaRoll
// A wand of magic missiles that casts at 1st level, and a level higher for each charge more, up to
// 3rd, as many as it has left; its darts, two and one more for each level it's cast at.
const scalingCast = (owner, id, copy, { max, value = '1' }) => {
  const cast = castOf(owner, id, 'action', copy, { level: 1 })
  cast.consumption = {
    targets: [{ type: 'itemUses', target: '', value, scaling: { mode: 'amount', formula: '' } }],
    scaling: { allowed: true, max },
  }
  cast.getRollData = () => {
    const { max: most, spent } = items.get(owner).system.uses
    return { item: { level: 1, uses: { value: most - spent, max: most, spent } } }
  }
  return cast
}
const darts = scaling => activity('damage', 'action', { id: 'many-darts', requiresSpellSlot: true, labels: { damage: [hit('3d4 + 3', 'force')] },
  damage: { parts: [{}] }, target: { affects: { type: 'creature', count: 3 + scaling } }, _source: { target: { affects: { count: '2 + @item.level' } } } })
const manyCopy = cached('many-copy', 'Magic Missile', 1, darts(0), { clone: changes => ({ system: { activities: new Activities([darts(changes['flags.dnd5e.scaling'] ?? 0)]) } }) })
const manyWand = item('many-wand', 'consumable', 'Wand of Many Missiles', { system: { uses: { max: 7, spent: 2, recovery: [{ period: 'dawn' }] } } })
manyWand.system.activities = new Activities([scalingCast('many-wand', 'cast-many', manyCopy, { max: 'min(@item.uses.value,3)' })])
// Eyes that charm at any level, but have three charges at most; and a wand whose most can't be read.
const charmCopy = cached('eyes-charm', 'Charm Person', 1, activity('save', 'action', { id: 'eyes-charm-save', requiresSpellSlot: true,
  save: { ability: new Set(['wis']), dc: { value: 13 } } }))
const eyes = item('eyes', 'equipment', 'Eyes of Charming', { system: { equipped: true, uses: { max: 3, spent: 0, recovery: [{ period: 'dawn' }] } } })
eyes.system.activities = new Activities([scalingCast('eyes', 'cast-eyes', charmCopy, { max: '' })])
const oddCopy = cached('odd-missile', 'Magic Missile', 1, activity('damage', 'action', { id: 'odd-darts', requiresSpellSlot: true,
  labels: { damage: [hit('3d4 + 3', 'force')] }, damage: { parts: [{}] } }))
const oddScaler = item('odd-scaling', 'consumable', 'Wand of Odd Missiles', { system: { uses: { max: 7, spent: 0, recovery: [{ period: 'dawn' }] } } })
oddScaler.system.activities = new Activities([scalingCast('odd-scaling', 'cast-odd', oddCopy, { max: 'foo(' })])
// A cantrip a staff casts, whose second activity spends nothing, as a cantrip's never spends a slot.
const sparkCopy = cached('spark', 'Spark Lash', 0, attack('action', '6', [hit('1d10', 'lightning')], { id: 'lash' }), {
  activities: [attack('action', '6', [hit('1d10', 'lightning')], { id: 'lash' }),
    activity('damage', 'bonus', { id: 'arc', name: 'Arc', labels: { damage: [hit('1d6', 'lightning')] }, damage: { parts: [{}] }, consumption: { spellSlot: false } })],
})
const sparkStaff = item('spark-staff', 'weapon', 'Staff of Sparks', { system: { equipped: true, uses: { max: 5, spent: 0, recovery: [{ period: 'dawn' }] } } })
sparkStaff.system.activities = new Activities([castOf('spark-staff', 'cast-spark', 'action', sparkCopy)])
bruenor.itemTypes = Object.groupBy(items.values(), it => it.type)

const resend = async () => {
  sendCharacter('bruenor')
  await wait(50)
  return take().find(e => e.type === 'character.updated').data.character.sheet
}
const { sendCharacter } = await import(`${MODULE}/scripts/character-sync.mjs`)
let higher = await resend()
const rowOf = (id, of = higher) => of.actions.flatMap(section => section.actions).find(action => action.id === id)
const manyRow = rowOf('many-wand')
assert.deepEqual(manyRow.cast.levels, [{ level: 1, charges: 1, short: false }, { level: 2, charges: 2, short: false }, { level: 3, charges: 3, short: false }])
assert.deepEqual([manyRow.cast.level, manyRow.cast.charges, manyRow.cast.short], [1, 1, false])
// Its spends at the level it's cast at first, as its charges are (module 0.29.0).
assert.deepEqual(manyRow.activity, { id: 'cast-many', type: 'damage', targets: { self: false, area: false, count: 3, perLevel: 1, affects: 'creature', fromSelf: false }, spends: [{ counter: { item: 'many-wand' }, amount: 1 }] })
const manyCopyRow = higher.spells.flatMap(section => section.spells).find(spell => spell.id === 'many-copy')
assert.deepEqual([manyCopyRow.activity.targets.count, manyCopyRow.activity.targets.perLevel, 'cast' in manyCopyRow], [3, 1, false])
ok("a wand that casts higher for more charges offers each level its charges allow, up to its most, with what each costs; its darts, one more a level, on its row and its copy's")

const eyesRow = rowOf('eyes')
assert.deepEqual(eyesRow.cast.levels, [{ level: 1, charges: 1, short: false }, { level: 2, charges: 2, short: false }, { level: 3, charges: 3, short: false }])
assert.equal('levels' in rowOf('odd-scaling').cast, false)
assert.deepEqual([rowOf('odd-scaling').cast.level, rowOf('odd-scaling').cast.charges], [1, 1])
manyWand.system.uses.spent = 6
higher = await resend()
assert.deepEqual(rowOf('many-wand').cast, { level: 1, concentration: false, charges: 1, short: false, text: rowOf('many-wand').cast.text })
ok("levels it would cost more charges for than the item ever has are left out; with one charge left, or a most that can't be read, none are offered")

const lashRow = higher.spells.flatMap(section => section.spells).find(spell => spell.id === 'spark')
assert.deepEqual(lashRow.activities.map(entry => [entry.id, entry.consumesSlot]), [['lash', undefined], ['arc', false]])
assert.equal('consumesSlot' in rowOf('spark-staff'), false)
ok("a cantrip an item casts says its activity that spends nothing spends nothing, as a leveled spell's does")
foundry.dice.Roll = StubRoll
for (const id of ['many-wand', 'many-copy', 'eyes', 'eyes-charm', 'odd-scaling', 'odd-missile', 'spark-staff', 'spark']) items.delete(id)

// ---- Nothing to act with ----
items.clear()
bruenor.itemTypes = {}
sendCharacter('bruenor')
await wait(50)
const bare = take().find(e => e.type === 'character.updated').data.character.sheet
assert.deepEqual(bare.actions, [])
ok('a character with nothing to act with has no actions')

console.log('\nall step 3 checks passed')
