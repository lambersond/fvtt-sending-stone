// Players' spells and features from the app, made in the game, and the choices they make with them:
// the real module, dnd5e 5.3.3's real dice classes (D20Roll, DamageRoll and their dice), dnd5e's
// items and activities ported (activity5e.mjs), a stand-in Foundry core and app. MIDI=1 puts a
// stand-in Midi-QOL workflow in the world (midi-fake.mjs). Run with --import ./unref-timers.mjs
// --import ./dnd5e-register.mjs, and LIBWRAPPER=1 or OMIT_ROOT=1 as rolls.mjs takes them.
import assert from 'node:assert/strict'
import { combat, combatant, settings, user, actors, message as fakeMessage } from './stub.mjs'

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

const { core, messages } = await import('./dice-core.mjs')
if (process.env.OMIT_ROOT) core.omitRoot = true

const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
const TYPES = ['slashing', 'piercing', 'bludgeoning', 'radiant', 'acid', 'cold', 'fire', 'lightning', 'poison', 'thunder', 'force', 'psychic', 'necrotic']
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(TYPES.map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' }, temphp: { label: 'Temporary HP' } },
}
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')

const { Actor5e } = await import('./actor5e.mjs')
const { AttackActivity, SaveActivity, DamageActivity, HealActivity, equip, screen } = await import('./activity5e.mjs')
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
// dnd5e's registry of messages linked to a use's card, and its own activities' prototypes.
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
const users = game.users
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
user('bob', 'Bob')
if (MIDI) installMidi()

const add = actor => { actors.set(actor.id, actor); return actor }
const spell = (id, name, level, activity, system = {}) => ({
  id, name, type: 'spell', system: { level, method: 'spell', properties: [], ...system }, activities: [activity],
})
const weapon = (id, name, properties, activity, system = {}) => ({
  id, name, type: 'weapon', system: { properties, quantity: 1, attackType: 'melee', ...system }, activities: [activity],
})
const ELEMENTS = ['acid', 'cold', 'fire', 'lightning', 'poison']

// Thorin, a cleric with a sword: wisdom +3, and slots up to 4th level; dnd5e keeps the levels above,
// with none.
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 3, dex: 2, wis: 3 }, hp: { value: 20, max: 40, temp: 0 } }))
alice.character = thorin
equip(thorin, {
  spells: {
    spell1: { value: 6, max: 6, level: 1 }, spell2: { value: 5, max: 5, level: 2 },
    spell3: { value: 2, max: 2, level: 3 }, spell4: { value: 1, max: 1, level: 4 },
    ...Object.fromEntries([5, 6, 7, 8, 9].map(level => [`spell${level}`, { value: 0, max: 0, level }])),
  },
  items: [
    spell('fireball', 'Fireball', 3, {
      id: 'blast', type: 'save', ability: 'wis', template: 'sphere', affects: 'creature', save: ['dex'], dc: 15,
      damage: [{ number: 8, denomination: 6, types: ['fire'], scaling: 1 }],
    }),
    spell('cure', 'Cure Wounds', 1, {
      id: 'mend', type: 'heal', ability: 'wis', affects: 'ally', count: 1,
      healing: { number: 2, denomination: 8, bonus: '@mod', types: ['healing'], scaling: 2 },
    }),
    spell('bless', 'Bless', 1, { id: 'blessing', type: 'utility', affects: 'ally', count: '3 + @scaling', concentration: true, effects: ['Bless'] }),
    spell('shield', 'Shield', 1, { id: 'barrier', type: 'utility', affects: 'self', range: 'self', activation: { type: 'reaction', value: 1 } }),
    spell('missile', 'Magic Missile', 1, {
      id: 'darts', type: 'damage', affects: 'creature', count: 3,
      damage: [{ number: 3, denomination: 4, bonus: '3', types: ['force'], scaling: 1 }],
    }),
    spell('hold', 'Hold Person', 2, {
      id: 'grip', type: 'save', ability: 'wis', affects: 'creature', count: '1 + @scaling', save: ['wis'], dc: 15,
      concentration: true, effects: ['Paralyzed'],
    }),
    spell('orb', 'Chromatic Orb', 1, { id: 'orb-cast', ability: 'wis', damage: [{ number: 3, denomination: 8, types: ELEMENTS, scaling: 1 }] }),
    spell('breath', "Dragon's Breath", 2, {
      id: 'exhale', type: 'save', template: 'cone', affects: 'creature', save: ['dex'], dc: 15,
      damage: [{ number: 3, denomination: 6, types: ELEMENTS, scaling: 1 }],
    }),
    spell('misty', 'Misty Step', 2, { id: 'step', type: 'utility', affects: 'self', range: 'self' }, { method: 'innate' }),
    spell('familiar', 'Find Familiar', 1, { id: 'call', type: 'summon', affects: '' }),
    // Spirit Guardians is cast, then its save is used each turn without spending a slot, its
    // damage scaled to the level chosen.
    { id: 'guardians', name: 'Spirit Guardians', type: 'spell', system: { level: 3, method: 'spell', properties: [] }, activities: [
      { id: 'guard', type: 'utility', affects: 'self', range: 'self' },
      { id: 'aura', type: 'save', ability: 'wis', affects: 'creature', save: ['wis'], dc: 15, spellSlot: false,
        damage: [{ number: 3, denomination: 8, types: ['radiant'], scaling: 1 }] },
    ] },
    { id: 'wind', name: 'Second Wind', type: 'feat', system: { properties: [], uses: { max: 2, spent: 0 } },
      activities: [{ id: 'breather', type: 'heal', affects: 'self', range: 'self', consumption: [{ type: 'itemUses', value: 1 }],
        healing: { number: 1, denomination: 10, bonus: '5', types: ['healing'] } }] },
    // Damage whose first die it takes away, as a hand-typed formula may have it (module 0.21.0).
    { id: 'withering', name: 'Withering Touch', type: 'feat', system: { properties: [] },
      activities: [{ id: 'withering-touch', type: 'damage', affects: 'creature', count: 1, damage: [{ custom: '-1d4 + 2d6', types: ['necrotic'] }] }] },
    { id: 'luck', name: 'Lucky Charm', type: 'feat', system: { properties: [] },
      activities: [{ id: 'lucky', type: 'utility', affects: '', formula: '1d6' }] },
    // Utilities with rolls of their own: a named one with Thorin's wisdom in it, one with a die no
    // player rolls, and one of an item not identified yet.
    { id: 'omen', name: 'Fey Omen', type: 'feat', system: { properties: [] },
      activities: [{ id: 'foresee', type: 'utility', affects: '', formula: '1d4 + @abilities.wis.mod', rollName: 'Omen' }] },
    { id: 'trinket', name: 'Odd Trinket', type: 'feat', system: { properties: [] },
      activities: [{ id: 'fiddle', type: 'utility', affects: '', formula: '1d3' }] },
    { id: 'murky', name: 'Murky Vial', type: 'consumable', system: { properties: [], identified: false, quantity: 1 },
      activities: [{ id: 'sip', type: 'utility', affects: '', formula: '1d6' }] },
    // A stone that casts Guidance, whose roll is a d4.
    { id: 'stone', name: 'Luckstone', type: 'equipment', system: { properties: [] }, activities: [{ id: 'cast-guidance', type: 'cast' }] },
    { id: 'guidance', name: 'Guidance', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.stone.Activity.cast-guidance' } }, system: { level: 0, method: 'spell', properties: [] },
      activities: [{ id: 'guide', type: 'utility', affects: 'creature', count: 1, formula: '1d4' }] },
    weapon('sword', 'Longsword', ['ver'], { id: 'swing', versatile: 10, damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }] }),
    weapon('dagger', 'Dagger', ['thr', 'lgt'], { id: 'stab', damage: [{ number: 1, denomination: 4, bonus: '@mod', types: ['piercing'] }] }, { quantity: 2 }),
    weapon('bow', 'Longbow', ['amm'], { id: 'shoot', ability: 'dex', actionType: 'rwak', damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['piercing'] }] }, { attackType: 'ranged' }),
    { id: 'arrows', name: 'Arrows', type: 'consumable', system: { type: { value: 'ammo' }, quantity: 5, properties: [] } },
    { id: 'silver', name: 'Silvered Arrows', type: 'consumable', system: { type: { value: 'ammo' }, quantity: 3, properties: [] } },
    { id: 'spent', name: 'Broken Arrows', type: 'consumable', system: { type: { value: 'ammo' }, quantity: 0, properties: [] } },
    // A bard's flame strikes, and casts spells from its charges, through the copies of them dnd5e
    // keeps on the actor; one it hasn't copied yet can't be cast from here.
    { id: 'flame', name: 'Bardic Flame', type: 'weapon', system: { properties: ['mgc'], quantity: 1, attackType: 'melee', uses: { max: 6, spent: 0 } }, activities: [
      { id: 'strike', damage: [{ number: 1, denomination: 6, bonus: '@mod', types: ['bludgeoning'] }] },
      { id: 'cast-barbs', type: 'cast', spell: { level: 1 }, activation: { type: 'reaction', value: 1 }, consumption: [{ type: 'itemUses', value: '1' }] },
      { id: 'cast-wisp', type: 'cast', consumption: [{ type: 'itemUses', value: '1' }] },
      { id: 'cast-mhw', type: 'cast', activation: { type: 'bonus', value: 1 }, consumption: [{ type: 'itemUses', value: '3' }] },
      { id: 'cast-charm', type: 'cast', consumption: [{ type: 'itemUses', value: '1' }] },
      { id: 'cast-hex', type: 'cast', spell: { level: 1 }, activation: { type: 'bonus', value: 1 }, consumption: [{ type: 'itemUses', value: '1' }] },
    ] },
    { id: 'barbs', name: 'Silvery Barbs', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.flame.Activity.cast-barbs' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'barbs-use', type: 'utility', affects: 'creature', count: 1, activation: { type: 'reaction', value: 1 } }] },
    { id: 'wisp', name: 'Starry Wisp', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.flame.Activity.cast-wisp' } }, system: { level: 0, method: 'spell', properties: [] },
      activities: [{ id: 'wisp-shot', ability: 'wis', damage: [{ number: 1, denomination: 8, types: ['radiant'] }] }] },
    { id: 'mhw', name: 'Mass Healing Word', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.flame.Activity.cast-mhw' } }, system: { level: 3, method: 'spell', properties: [] },
      activities: [{ id: 'mhw-heal', type: 'heal', ability: 'wis', affects: 'ally', count: 6, healing: { number: 1, denomination: 4, bonus: '@mod', types: ['healing'], scaling: 1 } }] },
    // A staff that needs attuning, and isn't: its magic isn't available.
    { id: 'staff', name: 'Staff of Frost', type: 'weapon', system: { properties: ['mgc'], quantity: 1, magicAvailable: false, uses: { max: 3, spent: 0 } },
      activities: [{ id: 'cast-ray', type: 'cast', consumption: [{ type: 'itemUses', value: '1' }] }] },
    { id: 'ray', name: 'Ray of Frost', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.staff.Activity.cast-ray' } }, system: { level: 0, method: 'spell', properties: [] },
      activities: [{ id: 'ray-shot', ability: 'wis', damage: [{ number: 1, denomination: 8, types: ['cold'] }] }] },
    // A scroll casts its spell once.
    { id: 'scroll', name: 'Spell Scroll: Shield', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 1, spent: 0 } },
      activities: [{ id: 'cast-shield', type: 'cast', spell: { level: 1 }, activation: { type: 'reaction', value: 1 }, consumption: [{ type: 'itemUses', value: '1' }] }] },
    { id: 'scroll-shield', name: 'Shield', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.scroll.Activity.cast-shield' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'scroll-barrier', type: 'utility', affects: 'self', range: 'self', activation: { type: 'reaction', value: 1 } }] },
    // Hex, cast from the flame: its curse spends a charge, and its damage, which spends no slot, none.
    { id: 'hex', name: 'Hex', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.flame.Activity.cast-hex' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [
        { id: 'hex-curse', type: 'utility', affects: 'creature', count: 1, activation: { type: 'bonus', value: 1 } },
        { id: 'hex-dmg', name: 'Bonus Hex Damage', type: 'damage', affects: 'creature', count: 1, spellSlot: false, damage: [{ number: 1, denomination: 6, types: ['necrotic'] }] },
      ] },
    // Items that cast a spell higher for more of their charges (module 0.20.0), each before the copy
    // of its spell dnd5e keeps, as the copy's level is worked out from its Cast activity's. A wand of
    // magic missiles, from 1st level and a level higher for each charge more, as many levels as it
    // has charges left, up to three; its darts two, and one more for each level they're cast at.
    { id: 'mm-wand', name: 'Wand of Magic Missiles', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 7, spent: 0 } },
      activities: [{ id: 'cast-mm', type: 'cast', spell: { level: 1 }, scaling: { allowed: true, max: 'min(@item.uses.value,3)' },
        consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'mm', name: 'Magic Missile', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.mm-wand.Activity.cast-mm' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'mm-darts', type: 'damage', affects: 'creature', count: '2 + @item.level', damage: [{ number: 1, denomination: 4, bonus: '1', types: ['force'] }] }] },
    // A wand of fireballs, the same from 3rd level.
    { id: 'fb-wand', name: 'Wand of Fireballs', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 7, spent: 0 } },
      activities: [{ id: 'cast-fb', type: 'cast', spell: { level: 3 }, scaling: { allowed: true, max: 'min(@item.uses.value,3)' },
        consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'fb', name: 'Fireball', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.fb-wand.Activity.cast-fb' } }, system: { level: 3, method: 'spell', properties: [] },
      activities: [{ id: 'fb-save', type: 'save', template: 'sphere', affects: 'creature', save: ['dex'], dc: 15, damage: [{ number: 8, denomination: 6, types: ['fire'], scaling: 1 }] }] },
    // A staff of healing, up to 4th level, with two of its ten charges left.
    { id: 'heal-staff', name: 'Staff of Healing', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 10, spent: 8 } },
      activities: [{ id: 'cast-cure', type: 'cast', spell: { level: 1 }, scaling: { allowed: true, max: '4' }, consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'staff-cure', name: 'Cure Wounds', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.heal-staff.Activity.cast-cure' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'staff-mend', type: 'heal', ability: 'wis', affects: 'ally', count: 1, healing: { number: 2, denomination: 8, bonus: '@mod', types: ['healing'], scaling: 2 } }] },
    // Eyes that charm at any level, with three charges.
    { id: 'charm-eyes', name: 'Eyes of Charming', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 3, spent: 0 } },
      activities: [{ id: 'cast-charm-eyes', type: 'cast', spell: { level: 1 }, scaling: { allowed: true, max: '' }, consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'eyes-charm', name: 'Charm Person', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.charm-eyes.Activity.cast-charm-eyes' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'eyes-save', type: 'save', affects: 'creature', count: 1, save: ['wis'], dc: 13 }] },
    // A wand that casts Fireball at 4th level only, for three charges and one more for the level
    // above the spell's own, with three left.
    { id: 'fire4', name: 'Wand of Greater Fireballs', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 7, spent: 4 } },
      activities: [{ id: 'cast-fire4', type: 'cast', spell: { level: 4 }, consumption: [{ type: 'itemUses', value: '3', scaling: { mode: 'amount' } }] }] },
    { id: 'fire4-copy', name: 'Fireball', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.fire4.Activity.cast-fire4' } }, system: { level: 3, method: 'spell', properties: [] },
      activities: [{ id: 'fire4-blast', type: 'save', template: 'sphere', affects: 'creature', save: ['dex'], dc: 15, damage: [{ number: 8, denomination: 6, types: ['fire'], scaling: 1 }] }] },
    // A staff that casts Spirit Guardians from 3rd level up: casting it spends charges, and its save
    // each turn none, at the level chosen.
    { id: 'sg-staff', name: 'Staff of Guardians', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 10, spent: 0 } },
      activities: [{ id: 'cast-sg', type: 'cast', spell: { level: 3 }, scaling: { allowed: true, max: '' }, consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'sg', name: 'Spirit Guardians', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.sg-staff.Activity.cast-sg' } }, system: { level: 3, method: 'spell', properties: [] }, activities: [
      { id: 'sg-cast', type: 'utility', affects: 'self', range: 'self' },
      { id: 'sg-save', type: 'save', ability: 'wis', affects: 'creature', save: ['wis'], dc: 15, spellSlot: false,
        damage: [{ number: 3, denomination: 8, types: ['radiant'], scaling: 1 }] },
    ] },
    // A ring whose Cast activity says 1st level, for a 2nd-level spell; and a wand whose most levels
    // can't be read.
    { id: 'low-cast', name: 'Ring of Blurring', type: 'equipment', system: { properties: [], quantity: 1, uses: { max: 9, spent: 0 } },
      activities: [{ id: 'cast-low', type: 'cast', spell: { level: 1 }, scaling: { allowed: true, max: '' }, consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'low-copy', name: 'Blur', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.low-cast.Activity.cast-low' } }, system: { level: 2, method: 'spell', properties: [] },
      activities: [{ id: 'low-blur', type: 'utility', affects: 'self', range: 'self' }] },
    { id: 'bad-max', name: 'Wand of Odd Missiles', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 7, spent: 0 } },
      activities: [{ id: 'cast-bad', type: 'cast', spell: { level: 1 }, scaling: { allowed: true, max: 'foo(' }, consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'bad-copy', name: 'Magic Missile', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.bad-max.Activity.cast-bad' } }, system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'bad-darts', type: 'damage', affects: 'creature', count: 3, damage: [{ number: 1, denomination: 4, bonus: '1', types: ['force'] }] }] },
    // A wand whose Cast activity would let it be cast higher, for a cantrip, which has no level to
    // choose; and a scroll of a spell written at 3rd level, two above its own, whose activity spends
    // a use more for each, as dnd5e scales a scroll's spell by the level it's written at.
    { id: 'flare-wand', name: 'Wand of Sacred Flame', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 3, spent: 0 } },
      activities: [{ id: 'cast-flare', type: 'cast', scaling: { allowed: true, max: '' }, consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    { id: 'flare', name: 'Sacred Flame', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.flare-wand.Activity.cast-flare' } }, system: { level: 0, method: 'spell', properties: [] },
      activities: [{ id: 'flare-burn', type: 'damage', affects: 'creature', count: 1, damage: [{ number: 1, denomination: 8, types: ['radiant'] }] }] },
    { id: 'scroll3', name: 'Spell Scroll: Blur', type: 'consumable', flags: { dnd5e: { scaling: 2, spellLevel: { value: 3, base: 1 } } },
      system: { properties: [], quantity: 1, uses: { max: 2, spent: 0 } },
      activities: [{ id: 'scroll-blur', type: 'utility', affects: 'self', range: 'self', consumption: [{ type: 'itemUses', value: '1', scaling: { mode: 'amount' } }] }] },
    // Range Self, at a creature (module 0.22.0): a potion, drunk or given, and Wild Shape, as dnd5e
    // writes them; neither is its user's alone.
    { id: 'potion', name: 'Potion of Healing', type: 'consumable', system: { properties: [], quantity: 2, type: { value: 'potion' } },
      activities: [{ id: 'quaff', type: 'heal', affects: 'creature', range: 'self', healing: { number: 2, denomination: 4, bonus: '2', types: ['healing'] } }] },
    { id: 'wild', name: 'Wild Shape', type: 'feat', system: { properties: [] },
      activities: [{ id: 'shift', type: 'utility', affects: 'creature', count: 1, range: 'self', activation: { type: 'bonus', value: 1 } }] },
  ],
})
const vex = add(new Actor5e({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3 }, hp: { value: 10, max: 30, temp: 0 } }))
equip(vex, {})

// The tokens on the Gamemaster's canvas: Thorin's and Vex's, and the foes'.
const place = (actor, { hidden = false, onScene = true } = {}) => {
  const token = { id: `tok-${actor.id}`, name: actor.name, uuid: `Scene.scene.Token.tok-${actor.id}`, actor, hidden }
  const placeable = { id: token.id, name: actor.name, document: token, actor }
  if (onScene) { token.object = placeable; placeables.set(token.id, placeable) }
  return token
}
const foe = (id, name, ac, options) => {
  const actor = add(new Actor5e({ id, name, mods: {}, hp: { value: 40, max: 40, temp: 0 } }))
  actor.type = 'npc'
  equip(actor, { ac })
  return { actor, token: place(actor, options) }
}
const tokens = { thorin: place(thorin), vex: place(vex) }
const goblin = foe('goblin', 'Goblin', 13)
const hobgoblin = foe('hobgoblin', 'Hobgoblin', 18)
const ogre = foe('ogre', 'Ogre', 11)
const kobold = foe('kobold', 'Kobold', 12, { hidden: true })
// On a level the Gamemaster isn't viewing: their canvas draws no token for it.
const wraith = foe('wraith', 'Wraith', 12, { onScene: false })
if (MIDI) canvas.scene.tokens.size = placeables.size

const fight = combat('fight')
combatant(fight, 'cb-thorin', thorin, { token: tokens.thorin })
combatant(fight, 'cb-vex', vex, { token: tokens.vex })
for (const [id, { actor, token }] of [['cb-gob', goblin], ['cb-hob', hobgoblin], ['cb-ogre', ogre], ['cb-kob', kobold], ['cb-wraith', wraith]]) {
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
const use = (item, activity, fields = {}) => send({
  id: `use-${++ids}`, actorId: 'thorin', kind: 'use', item, activity, targets: [], slot: null, ...fields,
})
const attack = (item, activity, fields = {}) => send({
  id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item, activity, target: target('cb-gob'),
  mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [18] }], ...fields,
})
const damage = (useId, dice, fields = {}) => send({ id: `dmg-${++ids}`, actorId: 'thorin', kind: 'damage', use: useId, dice, ...fields })
// The dice a preview says, each showing the value given, or its highest.
const diceFor = (preview, value) => preview.rolls.flatMap(roll => roll.dice)
  .map(({ faces, number }) => ({ faces, results: Array.from({ length: number }, () => Math.min(value ?? faces, faces)) }))
const useCard = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.use === id)
const rollMessage = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.request === id)
const faces = roll => roll.dice.map(die => die.results.map(r => r.result))
const workflowOf = id => midi.made.find(w => w.workflowOptions.sendingStone === id)
const slots = () => Object.fromEntries(Object.entries(thorin.system.spells).filter(([, pool]) => pool.max).map(([key, pool]) => [key, pool.value]))
const gmTargets = () => [...game.user.targets].map(t => t.id)
const nothingAsked = () => {
  assert.deepEqual(screen.notifications, [], 'nothing was said on the Gamemaster\'s screen')
  assert.deepEqual(globalThis.__dialogs ?? [], [], 'no dialog opened on the Gamemaster\'s screen')
  assert.equal(screen.templates, 0, 'no template was placed')
  assert.deepEqual(screen.subsequent, [], 'nothing followed the use on the Gamemaster\'s screen')
}

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
assert.deepEqual(hellos, {
  Ashlands: [...checks, 'endConcentration', 'attack', 'use', 'damage', 'endEnchantment', 'spend', 'inspiration', 'textRoll', 'textDamage', 'itemDamage', 'recharge'],
  Mirkwood: [...checks, 'endConcentration', 'textRoll'],
})
ok('offers uses alongside attacks, only where the Gamemaster lets players attack and cast')
// Each campaign's sheets follow its hello, each in a post of its own.
const updatedIn = title => app.events.filter(e => (e.type === 'character.updated') && (e.campaign.title === title)).map(e => e.data.character.id)
await until(() => updatedIn('Ashlands').length >= 2 && updatedIn('Mirkwood').length >= 1, 'the sheets after the hellos')
assert.deepEqual([updatedIn('Ashlands').slice(0, 2), updatedIn('Mirkwood').slice(0, 1)], [['thorin', 'vex'], ['vex']])

// ---- Both paths ----
const fireball = await use('fireball', 'blast', { targets: [target('cb-gob'), target('cb-hob')] })
assert.equal(fireball.status, 'done', JSON.stringify(fireball))
assert.deepEqual(fireball.use, { type: 'save' })
assert.deepEqual(fireball.damage, {
  critical: false, plannable: true, healing: false,
  rolls: [{ formula: '8d6', type: 'Fire', types: null, dice: [{ faces: 6, number: 8 }], perDie: 1 }],
})
assert.deepEqual(fireball.rolls, [])
assert.equal(slots().spell3, 1, 'cast with its own level\'s slot')
const fireCard = useCard(fireball.id)
assert.equal(fireCard.flags['sending-stone'].usage.type, 'save')
nothingAsked()
ok('casts Fireball at the two goblins picked, with its own level\'s slot, without a template, and says the dice its damage throws')

const upcast = await use('fireball', 'blast', { targets: [target('cb-gob')], slot: 'spell4' })
assert.equal(upcast.status, 'done', JSON.stringify(upcast))
assert.deepEqual(upcast.damage.rolls[0].dice, [{ faces: 6, number: 9 }])
assert.equal(useCard(upcast.id).system.scaling, 1)
assert.deepEqual([slots().spell3, slots().spell4], [1, 0])
for (const [slot, why] of [['spell2', 'below its level'], ['spell4', 'none left'], ['spell9', 'no such slots'], ['pact', 'no pact magic']]) {
  const refused = await use('fireball', 'blast', { slot })
  assert.deepEqual([refused.status, refused.reason], ['failed', 'slot'], why)
}
assert.deepEqual(slots(), { spell1: 6, spell2: 5, spell3: 1, spell4: 0 }, 'a refused slot spends nothing')
const step = await use('misty', 'step', { slot: 'spell3' })
assert.equal(step.status, 'done', JSON.stringify(step))
assert.equal(useCard(step.id).system?.scaling, undefined, 'an innate spell isn\'t cast higher for a slot it doesn\'t spend')
assert.equal(slots().spell3, 1)
nothingAsked()
ok('casts with the slot chosen, scaling the damage; refuses a slot below the spell, used up or not the character\'s; ignores one for a spell cast without slots')

const aura = await use('guardians', 'aura', { targets: [target('cb-gob')], slot: 'spell4' })
assert.equal(aura.status, 'done', JSON.stringify(aura))
assert.deepEqual(aura.damage.rolls[0].dice, [{ faces: 8, number: 4 }])
const auraOwn = await use('guardians', 'aura', { targets: [target('cb-gob')] })
assert.equal(auraOwn.status, 'done', JSON.stringify(auraOwn))
assert.deepEqual(auraOwn.damage.rolls[0].dice, [{ faces: 8, number: 3 }])
assert.deepEqual([slots().spell3, slots().spell4], [1, 0], 'no slot spent')
const guard = await use('guardians', 'guard', { slot: 'spell4' })
assert.deepEqual([guard.status, guard.reason], ['failed', 'slot'], 'casting it takes a slot left')
nothingAsked()
ok("a spell's activity used after it's cast, as Spirit Guardians' save each turn, spends no slot, at the level chosen, one with none left too; casting it takes one")

const cure = await use('cure', 'mend', { targets: [target('cb-vex')] })
assert.equal(cure.status, 'done', JSON.stringify(cure))
assert.deepEqual(cure.use, { type: 'heal' })
assert.deepEqual(cure.damage, {
  critical: false, plannable: true, healing: true,
  rolls: [{ formula: '2d8 + 3', type: 'Healing', types: null, dice: [{ faces: 8, number: 2 }], perDie: 1 }],
})
const higher = await use('cure', 'mend', { targets: [target('cb-vex')], slot: 'spell2' })
assert.deepEqual(higher.damage.rolls[0].dice, [{ faces: 8, number: 4 }])
const twoAllies = await use('cure', 'mend', { targets: [target('cb-vex'), target('cb-thorin')] })
assert.deepEqual([twoAllies.status, twoAllies.reason], ['failed', 'target'])
ok('Cure Wounds on an ally says its healing\'s dice, more for a higher slot, and refuses a second target')

const wind = await use('wind', 'breather')
assert.equal(wind.status, 'done', JSON.stringify(wind))
assert.deepEqual(wind.damage.rolls, [{ formula: '1d10 + 5', type: 'Healing', types: null, dice: [{ faces: 10, number: 1 }], perDie: 1 }])
assert.equal(thorin.items.get('wind').system.uses.spent, 1)
const windAt = await use('wind', 'breather', { targets: [target('cb-vex')] })
assert.deepEqual([windAt.status, windAt.reason], ['failed', 'target'], 'Second Wind is its user\'s alone')
ok('Second Wind spends a use, and heals its user, at no one else')

const blessed = await use('bless', 'blessing', { targets: [target('cb-thorin'), target('cb-vex'), target('cb-gob')] })
assert.equal(blessed.status, 'done', JSON.stringify(blessed))
assert.deepEqual([blessed.use, blessed.damage], [{ type: 'utility' }, null])
const tooMany = await use('bless', 'blessing', { targets: [target('cb-thorin'), target('cb-vex'), target('cb-gob'), target('cb-hob')] })
assert.deepEqual([tooMany.status, tooMany.reason], ['failed', 'target'])
const blessedHigher = await use('bless', 'blessing', { targets: [target('cb-thorin'), target('cb-vex'), target('cb-gob'), target('cb-hob')], slot: 'spell2' })
assert.equal(blessedHigher.status, 'done', JSON.stringify(blessedHigher))
await until(() => thorin.concentration.effects.size === 1, 'concentration on the second Bless')
assert.equal(thorin.concentration.effects.size, 1, 'the second Bless ends the first\'s concentration')
ok('Bless takes three, and a fourth when cast a level higher, and concentration goes to the latest')

const shielded = await use('shield', 'barrier')
assert.equal(shielded.status, 'done', JSON.stringify(shielded))
assert.equal(shielded.damage, null)
ok('Shield is cast on its user, with nothing to roll')

const missile = await use('missile', 'darts', { targets: [target('cb-gob'), target('cb-ogre')] })
assert.equal(missile.status, 'done', JSON.stringify(missile))
assert.deepEqual(missile.use, { type: 'damage' })
assert.deepEqual(missile.damage.rolls, [{ formula: '3d4 + 3', type: 'Force', types: null, dice: [{ faces: 4, number: 3 }], perDie: 1 }])
ok('Magic Missile, damage alone, at the creatures picked')

const held = await use('hold', 'grip', { targets: [target('cb-gob')] })
assert.equal(held.status, 'done', JSON.stringify(held))
assert.deepEqual([held.use, held.damage], [{ type: 'save' }, null])
const heldTwo = await use('hold', 'grip', { targets: [target('cb-gob'), target('cb-hob')] })
assert.deepEqual([heldTwo.status, heldTwo.reason], ['failed', 'target'])
const heldHigher = await use('hold', 'grip', { targets: [target('cb-gob'), target('cb-hob')], slot: 'spell3' })
assert.equal(heldHigher.status, 'done', JSON.stringify(heldHigher))
ok('Hold Person, a saving throw with no damage, at one, or two from a level higher')

const orb = await attack('orb', 'orb-cast')
assert.equal(orb.status, 'done', JSON.stringify(orb))
const orbTypes = ELEMENTS.map(key => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1) }))
assert.deepEqual(orb.damage.rolls, [{ formula: '3d8', type: 'Acid', types: orbTypes, dice: [{ faces: 8, number: 3 }], perDie: 1 }])
for (const types of [['psychic'], [null, 'fire'], ['fire!']]) {
  const refused = await damage(orb.id, diceFor(orb.damage, 4), { types })
  assert.deepEqual([refused.status, refused.reason], ['failed', types[0] === 'fire!' ? 'invalid' : 'type'], JSON.stringify(types))
}
const burned = await damage(orb.id, diceFor(orb.damage, 4), { types: ['fire'] })
assert.equal(burned.status, 'done', JSON.stringify(burned))
assert.equal(burned.rolls[0].total, 12)
nothingAsked()
ok('Chromatic Orb\'s damage offers its kinds, and is rolled as the one chosen, without asking the Gamemaster; one it doesn\'t offer is refused')

const breath = await use('breath', 'exhale', { targets: [target('cb-gob'), target('cb-hob')] })
assert.equal(breath.status, 'done', JSON.stringify(breath))
assert.deepEqual(breath.damage.rolls[0].types.map(t => t.key), ELEMENTS)
const chilled = await damage(breath.id, diceFor(breath.damage, 2), { types: ['cold'] })
assert.equal(chilled.status, 'done', JSON.stringify(chilled))
assert.equal(chilled.rolls[0].total, 6)
nothingAsked()
ok("Dragon's Breath, a saving throw at an area, rolls the kind of damage chosen")

const twoHanded = await attack('sword', 'swing', { attackMode: 'twoHanded' })
assert.equal(twoHanded.status, 'done', JSON.stringify(twoHanded))
assert.deepEqual(twoHanded.damage.rolls[0].dice, [{ faces: 10, number: 1 }])
const oneHanded = await attack('sword', 'swing', { attackMode: 'oneHanded' })
assert.deepEqual(oneHanded.damage.rolls[0].dice, [{ faces: 8, number: 1 }])
const notThrown = await attack('sword', 'swing', { attackMode: 'thrown' })
assert.deepEqual([notThrown.status, notThrown.reason], ['failed', 'mode'])
const thrown = await attack('dagger', 'stab', { attackMode: 'thrown' })
assert.equal(thrown.status, 'done', JSON.stringify(thrown))
ok('attacks in the mode chosen, two-handed with the versatile die or thrown, and refuses a mode the weapon hasn\'t')

const silvered = await attack('bow', 'shoot', { ammunition: 'silver' })
assert.equal(silvered.status, 'done', JSON.stringify(silvered))
assert.deepEqual([thorin.items.get('silver').system.quantity, thorin.items.get('arrows').system.quantity], [2, 5])
for (const ammunition of ['spent', 'nope', 'sword']) {
  const refused = await attack('bow', 'shoot', { ammunition })
  assert.deepEqual([refused.status, refused.reason], ['failed', 'ammo'], ammunition)
}
ok('fires the ammunition chosen, and refuses ammunition used up or not the weapon\'s')

for (const [label, make, reason] of [
  ['a summoning', () => use('familiar', 'call'), 'activity'],
  ['an attack as a use', () => use('orb', 'orb-cast'), 'activity'],
  ['a use as an attack', () => attack('cure', 'mend'), 'activity'],
  ['a hidden target', () => use('missile', 'darts', { targets: [target('cb-kob')] }), 'target'],
  ['a target twice', () => use('missile', 'darts', { targets: [target('cb-gob'), target('cb-gob')] }), 'target'],
  ['four darts\' targets', () => use('missile', 'darts', { targets: ['cb-gob', 'cb-hob', 'cb-ogre', 'cb-vex'].map(id => target(id)) }), 'target'],
  ['Shield at another', () => use('shield', 'barrier', { targets: [target('cb-vex')] }), 'target'],
  ['a slot that isn\'t one', () => use('fireball', 'blast', { slot: 'spell 3' }), 'invalid'],
  ['targets that aren\'t a list', () => use('fireball', 'blast', { targets: target('cb-gob') }), 'invalid'],
  ['another\'s character', () => use('cure', 'mend', { actorId: 'goblin' }), 'unknown'],
]) {
  const refused = await make()
  assert.deepEqual([refused.status, refused.reason], ['failed', reason], label)
}
nothingAsked()
ok('refuses activities it doesn\'t use, targets it can\'t, and anything malformed')

// ---- A utility's own roll ----
// The sheet that followed Ashlands' hello.
const sheet = app.events.find(e => (e.type === 'character.updated') && (e.campaign.title === 'Ashlands') && (e.data.character.id === 'thorin')).data.character.sheet
const feature = name => sheet.features.flatMap(section => section.features).find(f => f.name === name)
const owned = name => sheet.inventory.sections.flatMap(section => section.items).find(i => i.name === name)
assert.deepEqual(feature('Fey Omen').rollFormula, { formula: '1d4 + 3', name: 'Omen' })
assert.deepEqual(feature('Lucky Charm').rollFormula, { formula: '1d6', name: null })
assert.deepEqual([owned('Luckstone').rollFormula, owned('Luckstone').activity.id], [{ formula: '1d4', name: null }, 'cast-guidance'])
assert.deepEqual(['rollFormula' in feature('Second Wind'), 'rollFormula' in owned('Longsword'), 'rollFormula' in owned('Murky Vial')], [false, false, false])
ok("the sheet says a utility's own roll, with the character's numbers in it, and its name: a spell's cast from an item, by the Cast activity's id; not an unidentified item's")

const formula = (item, activity, dice, fields = {}) => send({
  id: `fml-${++ids}`, actorId: 'thorin', kind: 'formula', item, activity, mode: 0, explicit: false, extras: [], dice, ...fields,
})
// The Gamemaster has the ogre targeted, the utility prompts for its roll, and a module asks for dnd5e's dialog.
game.user.targets = new Set([placeables.get('tok-ogre')])
const foresee = thorin.items.get('omen').system.activities.get('foresee')
foresee.roll.prompt = true
const asking = (config, dialog) => { dialog.configure = true }
Hooks.on('dnd5e.preRollFormulaV2', asking)
const foreseen = await formula('omen', 'foresee', [{ faces: 4, results: [2] }])
Hooks.off('dnd5e.preRollFormulaV2', asking)
foresee.roll.prompt = false
game.user.targets = new Set()
assert.equal(foreseen.status, 'done', JSON.stringify(foreseen))
assert.deepEqual(foreseen.rolls.map(r => [r.formula, r.total]), [['1d4 + 3', 5]])
const omenRoll = rollMessage(foreseen.id)
assert.deepEqual(faces(omenRoll.rolls[0]), [[2]])
assert.deepEqual([omenRoll.flags.dnd5e.roll.type, omenRoll.flags.dnd5e.targets], ['generic', []])
assert.deepEqual([omenRoll.flags.dnd5e.item.id, omenRoll.flags.dnd5e.activity.id], ['omen', 'foresee'])
assert.deepEqual([omenRoll.author.id, omenRoll.whisper], ['alice', []])
assert.equal(MIDI ? workflowOf(foreseen.id) : undefined, undefined, 'no Midi workflow')
const guided = await formula('stone', 'cast-guidance', [{ faces: 4, results: [3] }])
assert.equal(guided.status, 'done', JSON.stringify(guided))
assert.equal(guided.rolls[0].total, 3)
assert.deepEqual([rollMessage(guided.id).flags.dnd5e.item.id, rollMessage(guided.id).flags.dnd5e.activity.id], ['guidance', 'guide'])
nothingAsked()
ok("rolls a utility's own roll with the player's dice, as its card's button would, without a dialog, naming no one the Gamemaster has targeted; a spell's cast from an item too")

// A module setting the formula out of the player's reach, inside a function.
const hiding = config => { config.rolls[0].parts = ['max(1, 1d4 + @abilities.wis.mod)'] }
Hooks.on('dnd5e.preRollFormulaV2', hiding)
const messagesBefore = messages.size
const hidden = await formula('omen', 'foresee', [{ faces: 4, results: [2] }])
Hooks.off('dnd5e.preRollFormulaV2', hiding)
assert.deepEqual([hidden.status, hidden.reason, messages.size], ['failed', 'dice', messagesBefore])
for (const [label, make, reason] of [
  ['another die', () => formula('omen', 'foresee', [{ faces: 8, results: [3] }]), 'dice'],
  ['two of it', () => formula('omen', 'foresee', [{ faces: 4, results: [3, 1] }]), 'dice'],
  ['no dice', () => formula('omen', 'foresee', []), 'dice'],
  ['an attack', () => formula('sword', 'swing', [{ faces: 8, results: [3] }]), 'activity'],
  ['a utility with no roll', () => formula('shield', 'barrier', []), 'activity'],
  ['a die no player rolls', () => formula('trinket', 'fiddle', [{ faces: 4, results: [1] }]), 'activity'],
  ['no such activity', () => formula('omen', 'nope', [{ faces: 4, results: [1] }]), 'activity'],
  ['an unidentified item', () => formula('murky', 'sip', [{ faces: 6, results: [1] }]), 'item'],
  ['no such item', () => formula('nope', 'foresee', [{ faces: 4, results: [1] }]), 'item'],
  // Guidance's copy, while the Luckstone can't cast it, as when it needs attuning.
  ['a spell its item can\'t cast now', async () => {
    const cast = thorin.items.get('stone').system.activities.get('cast-guidance')
    cast._data.canUse = false
    try { return await formula('guidance', 'guide', [{ faces: 4, results: [1] }]) } finally { delete cast._data.canUse }
  }, 'item'],
  ['advantage', () => formula('omen', 'foresee', [{ faces: 4, results: [1] }], { mode: 1 }), 'invalid'],
  ['something added', () => formula('omen', 'foresee', [{ faces: 4, results: [1] }], { extras: [{ sign: 1, flat: 2 }] }), 'invalid'],
  ['a die no player has', () => formula('omen', 'foresee', [{ faces: 7, results: [1] }]), 'invalid'],
]) {
  const refused = await make()
  assert.deepEqual([refused.status, refused.reason], ['failed', reason], label)
}
assert.equal(messages.size, messagesBefore)
nothingAsked()
ok("refuses a utility's roll with other dice, another kind of activity, a die no player rolls, an unidentified item, a spell its item can't cast now, or one a module set out of the player's reach")

// ---- Self (module 0.22.0) ----
// The sheet says whether an activity's range is Self, which may still name a creature, as a potion's
// and Wild Shape's do; the hello says a use may be made at its user, wherever uses are made.
const spellOf = name => sheet.spells.flatMap(section => section.spells).find(s => s.name === name)
assert.deepEqual(owned('Potion of Healing').activity.targets, { self: false, area: false, count: null, perLevel: null, affects: 'creature', fromSelf: true })
assert.deepEqual(feature('Wild Shape').activity.targets, { self: false, area: false, count: 1, perLevel: null, affects: 'creature', fromSelf: true })
assert.deepEqual(['Second Wind', 'Fey Omen'].map(name => feature(name).activity.targets.fromSelf), [true, false])
assert.deepEqual(['Shield', 'Misty Step', 'Cure Wounds', 'Fireball', 'Bless'].map(name => spellOf(name).activity.targets.fromSelf), [true, true, false, false, false])
const rollsIn = title => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.title === title)).at(-1).data.features.rolls
assert.deepEqual(['Ashlands', 'Mirkwood'].map(title => [rollsIn(title).selfTargets, rollsIn(title).areaAttacks]), [[true, true], [false, false]])
// The Gamemaster's rolls as a character wherever rolls are made, attacks or not (module 0.23.0).
assert.deepEqual(['Ashlands', 'Mirkwood'].map(title => rollsIn(title).gmRolls), [true, true])
// And that their results list the messages they made, wherever that is (module 0.25.0).
assert.deepEqual(['Ashlands', 'Mirkwood'].map(title => rollsIn(title).gmRollMessages), [true, true])
ok('the sheet says which activities have a range of Self, a potion and Wild Shape at a creature among them; the hello says a use may be made at its user where attacks and uses are made')

// A use at its user too, `self`: in combat, their combatant's token.
const named = id => useCard(id).flags.dnd5e.targets.map(t => t.name)
const flowTargets = id => [...workflowOf(id).targets].map(t => t.id)
const thorinHp = thorin.system.attributes.hp.value
const quaffed = await use('potion', 'quaff', { self: true })
assert.equal(quaffed.status, 'done', JSON.stringify(quaffed))
assert.deepEqual([named(quaffed.id), quaffed.damage.healing], [['Thorin'], true])
if (MIDI) assert.deepEqual(flowTargets(quaffed.id), ['tok-thorin'])
const quaffHealed = await damage(quaffed.id, diceFor(quaffed.damage, 1))
assert.equal(quaffHealed.status, 'done', JSON.stringify(quaffHealed))
if (MIDI) await until(() => thorin.system.attributes.hp.value === thorinHp + 4, 'Thorin to be healed by the potion')
else assert.deepEqual(rollMessage(quaffHealed.id).flags.dnd5e.targets.map(t => t.name), ['Thorin'])
thorin.system.attributes.hp.value = thorinHp
// Wild Shape at its user, who counts among the one creature it takes.
const shifted = await use('wild', 'shift', { self: true, targets: [] })
assert.equal(shifted.status, 'done', JSON.stringify(shifted))
assert.deepEqual(named(shifted.id), ['Thorin'])
if (MIDI) assert.deepEqual(flowTargets(shifted.id), ['tok-thorin'])
// One used on its user alone is, all the same, named once.
const stepped = await use('misty', 'step', { self: true })
assert.equal(stepped.status, 'done', JSON.stringify(stepped))
assert.deepEqual(named(stepped.id), ['Thorin'])
if (MIDI) assert.deepEqual(flowTargets(stepped.id), ['tok-thorin'])
// The potion given to Vex and drunk too: both.
const shared = await use('potion', 'quaff', { self: true, targets: [target('cb-vex')] })
assert.equal(shared.status, 'done', JSON.stringify(shared))
assert.deepEqual(named(shared.id), ['Thorin', 'Vex'])
if (MIDI) assert.deepEqual(flowTargets(shared.id), ['tok-thorin', 'tok-vex'])
nothingAsked()
ok(`a use at its user too, as a player's Self, is made at their combatant's token${MIDI ? ', which Midi targets' : ', which the card names'}, beside those picked; one used on its user alone names them once`)
if (MIDI) {
  // Where Midi requires targets, Wild Shape at no one is refused; at its user, it's made.
  const required = midi.settings.requiresTargets
  midi.settings.requiresTargets = 'always'
  try {
    const unaimed = await use('wild', 'shift', { targets: [] })
    assert.deepEqual([unaimed.status, unaimed.reason], ['failed', 'target'])
    const aimed = await use('wild', 'shift', { self: true, targets: [] })
    assert.equal(aimed.status, 'done', JSON.stringify(aimed))
    assert.deepEqual(flowTargets(aimed.id), ['tok-thorin'])
  } finally {
    midi.settings.requiresTargets = required
  }
  nothingAsked()
  ok("where Midi requires targets, Wild Shape at no one is refused beforehand, and at its user is made")
}

// Out of combat: their token on the scene the Gamemaster views; else the character alone, whom the
// card names. Midi, which can't target them then, uses it at no one, as it did before a player
// could pick themselves (0.21.0), and refuses it only where it needs a target anyway.
const fighting = game.combat
game.combat = null
try {
  const alone = await use('potion', 'quaff', { self: true })
  assert.equal(alone.status, 'done', JSON.stringify(alone))
  assert.deepEqual(useCard(alone.id).flags.dnd5e.targets.map(t => [t.name, t.uuid]), [['Thorin', thorin.uuid]])
  if (MIDI) {
    assert.deepEqual(flowTargets(alone.id), [])
    // Its healing is rolled all the same, for the Gamemaster to apply from the card.
    const aloneHealed = await damage(alone.id, diceFor(alone.damage, 1))
    assert.equal(aloneHealed.status, 'done', JSON.stringify(aloneHealed))
    const shiftedAlone = await use('wild', 'shift', { self: true, targets: [] })
    assert.equal(shiftedAlone.status, 'done', JSON.stringify(shiftedAlone))
    assert.deepEqual([named(shiftedAlone.id), flowTargets(shiftedAlone.id)], [['Thorin'], []])
    // Whether or not the Gamemaster lets Midi uses name targets they aren't viewing.
    await game.settings.set('sending-stone', 'offCanvasTargets', true)
    const allowed = await use('potion', 'quaff', { self: true }).finally(() => game.settings.set('sending-stone', 'offCanvasTargets', false))
    assert.equal(allowed.status, 'done', JSON.stringify(allowed))
    assert.deepEqual([named(allowed.id), flowTargets(allowed.id)], [['Thorin'], []])
    // Where Midi requires targets, it's refused, as at no one it was; in combat alone, it isn't.
    const required = midi.settings.requiresTargets
    const inCombat = Object.getOwnPropertyDescriptor(thorin, 'inCombat')
    try {
      midi.settings.requiresTargets = 'always'
      const needed = await use('potion', 'quaff', { self: true })
      assert.deepEqual([needed.status, needed.reason], ['failed', 'scene'])
      midi.settings.requiresTargets = 'combat'
      Object.defineProperty(thorin, 'inCombat', { configurable: true, value: false })
      const peaceful = await use('wild', 'shift', { self: true, targets: [] })
      assert.equal(peaceful.status, 'done', JSON.stringify(peaceful))
      assert.deepEqual([named(peaceful.id), flowTargets(peaceful.id)], [['Thorin'], []])
    } finally {
      midi.settings.requiresTargets = required
      if (inCombat) Object.defineProperty(thorin, 'inCombat', inCombat)
      else delete thorin.inCombat
    }
  }
  // Their token on a level the Gamemaster isn't viewing, which their canvas doesn't draw.
  thorin.getActiveTokens = (linked, document) => ((linked && document) ? [{ ...tokens.thorin, object: undefined }] : [])
  const below = await use('potion', 'quaff', { self: true })
  assert.equal(below.status, 'done', JSON.stringify(below))
  assert.deepEqual(named(below.id), ['Thorin'])
  if (MIDI) assert.deepEqual(flowTargets(below.id), [])
  thorin.getActiveTokens = (linked, document) => ((linked && document) ? [tokens.thorin] : [])
  const near = await use('potion', 'quaff', { self: true })
  assert.equal(near.status, 'done', JSON.stringify(near))
  assert.deepEqual(named(near.id), ['Thorin'])
  if (MIDI) assert.deepEqual(flowTargets(near.id), ['tok-thorin'])
} finally {
  delete thorin.getActiveTokens
  game.combat = fighting
}
nothingAsked()
ok(`out of combat, a use at its user is made at their token on the scene the Gamemaster views, or else names the character alone${MIDI ? ', made by Midi at no one unless it needs a target' : ''}`)

for (const [label, make, reason, error] of [
  ['its user twice', () => use('potion', 'quaff', { self: true, targets: [target('cb-thorin')] }), 'target', null],
  ['more than Wild Shape takes', () => use('wild', 'shift', { self: true, targets: [target('cb-vex')] }), 'target', null],
  ['a Self that isn\'t true or false', () => use('potion', 'quaff', { self: 'yes' }), 'invalid', 'self'],
  ['an attack at its user', () => attack('sword', 'swing', { self: true }), 'invalid', 'self'],
]) {
  const refused = await make()
  assert.deepEqual([refused.status, refused.reason, refused.error], ['failed', reason, error], label)
}
const notSelf = await attack('sword', 'swing', { self: false })
assert.equal(notSelf.status, 'done', JSON.stringify(notSelf))
nothingAsked()
ok('refuses a use at its user who is among its targets too, or more than it takes with them, a Self that isn\'t true or false, and an attack at its user')

if (!MIDI) {
  // ---- dnd5e's path ----
  assert.deepEqual(fireCard.flags.dnd5e.targets.map(t => t.name), ['Goblin', 'Hobgoblin'])
  assert.equal(fireCard.author.id, 'alice')
  const fire = await damage(fireball.id, diceFor(fireball.damage, 3))
  assert.equal(fire.status, 'done', JSON.stringify(fire))
  assert.equal(fire.rolls[0].total, 24)
  const fireRoll = rollMessage(fire.id)
  assert.equal(fireRoll.flags.dnd5e.originatingMessage, fireCard.id)
  assert.equal(fireRoll.flags.dnd5e.roll.damageOnSave, 'half')
  assert.deepEqual(fireRoll.flags.dnd5e.targets.map(t => t.name), ['Goblin', 'Hobgoblin'])
  assert.deepEqual(faces(fireRoll.rolls[0]), [[3, 3, 3, 3, 3, 3, 3, 3]])
  const twice = await damage(fireball.id, diceFor(fireball.damage, 3))
  assert.deepEqual([twice.status, twice.reason], ['failed', 'damaged'])
  ok('Fireball\'s damage is rolled with the player\'s dice on the card, for the Gamemaster to apply, halved for a saving throw made, once')

  const upcastFire = await damage(upcast.id, diceFor(upcast.damage, 1))
  assert.equal(upcastFire.rolls[0].total, 9)

  const healing = await damage(cure.id, diceFor(cure.damage, 5))
  assert.equal(healing.rolls[0].total, 13)
  assert.equal(rollMessage(healing.id).flags.dnd5e.roll.type, 'healing')
  assert.deepEqual(rollMessage(healing.id).flags.dnd5e.targets.map(t => t.name), ['Vex'])
  ok('Cure Wounds\' healing is rolled as healing, on Vex')

  assert.deepEqual(useCard(wind.id).flags.dnd5e.targets.map(t => t.name), ['Thorin'])
  const winded = await damage(wind.id, diceFor(wind.damage, 7))
  assert.equal(winded.rolls[0].total, 12)
  assert.deepEqual(rollMessage(winded.id).flags.dnd5e.targets.map(t => t.name), ['Thorin'])
  ok('Second Wind\'s card names its user, so its healing goes to them')

  assert.deepEqual(useCard(blessed.id).flags.dnd5e.targets.map(t => t.name), ['Thorin', 'Vex', 'Goblin'])
  assert.deepEqual(useCard(shielded.id).flags.dnd5e.targets.map(t => t.name), ['Thorin'])
  assert.deepEqual(useCard(held.id).flags.dnd5e.targets.map(t => t.name), ['Goblin'])
  assert.ok([...thorin.concentration.effects.values()].some(e => e.flags.dnd5e.item.data === 'grip'), 'concentrating on Hold Person')
  ok('the cards of Bless, Shield and Hold Person name their targets, for their effects')

  const darts = await damage(missile.id, diceFor(missile.damage, 2))
  assert.equal(darts.rolls[0].total, 9)
  assert.equal(rollMessage(darts.id).flags.dnd5e.roll.damageOnSave, undefined)
  ok('Magic Missile\'s damage is rolled as plain damage')
} else {
  // ---- Midi-QOL's path ----
  const placed = id => placeables.get(id)
  const hp = actor => actor.system.attributes.hp.value
  const fireFlow = workflowOf(fireball.id)
  assert.deepEqual([...fireFlow.targets].map(t => t.id), ['tok-goblin', 'tok-hobgoblin'])
  assert.ok(fireFlow.suspended && (fireFlow.currentAction === fireFlow.WorkflowState_WaitForDamageRoll))
  assert.equal(fireFlow.workflowOptions.ignoreUserTargets, true)

  // The goblin makes its saving throw; the hobgoblin doesn't. The Gamemaster has the ogre targeted.
  midi.saves.set('tok-goblin', true)
  game.user.targets = new Set([placed('tok-ogre')])
  const [goblinHp, hobHp, ogreHp] = [hp(goblin.actor), hp(hobgoblin.actor), hp(ogre.actor)]
  const savesBefore = midi.rolledSaves.length
  const fire = await damage(fireball.id, diceFor(fireball.damage, 3))
  assert.equal(fire.status, 'done', JSON.stringify(fire))
  await until(() => fireFlow.currentAction === fireFlow.WorkflowState_Completed, 'Fireball\'s workflow to complete')
  assert.deepEqual([hp(goblin.actor), hp(hobgoblin.actor), hp(ogre.actor)], [goblinHp - 12, hobHp - 24, ogreHp])
  assert.deepEqual(midi.rolledSaves.slice(savesBefore).map(s => [s.target, s.success]), [['tok-goblin', true], ['tok-hobgoblin', false]])
  assert.deepEqual(gmTargets(), ['tok-ogre'], 'the Gamemaster\'s targets are put back')
  ok('Fireball\'s damage goes into Midi\'s workflow, which rolls the goblins\' saving throws and halves it for one made, at the area the player picked, not the Gamemaster\'s target')

  // Midi targeting an area itself waits for its template, which isn't placed: it takes the player's.
  midi.settings.autoTarget = 'wallsBlock'
  midi.saves.clear()
  const breathed = await use('breath', 'exhale', { targets: [target('cb-ogre')] })
  assert.equal(breathed.status, 'done', JSON.stringify(breathed))
  const breathFlow = workflowOf(breathed.id)
  assert.deepEqual([...breathFlow.targets].map(t => t.id), ['tok-ogre'])
  assert.ok(breathFlow.suspended && (breathFlow.currentAction === breathFlow.WorkflowState_WaitForDamageRoll))
  const ogreBefore = hp(ogre.actor)
  const frost = await damage(breathed.id, diceFor(breathed.damage, 1), { types: ['cold'] })
  assert.equal(frost.status, 'done', JSON.stringify(frost))
  await until(() => breathFlow.currentAction === breathFlow.WorkflowState_Completed, 'the breath\'s workflow to complete')
  assert.equal(hp(ogre.actor), ogreBefore - 3)
  assert.equal(breathFlow.damageRolls[0].options.type, 'cold')
  midi.settings.autoTarget = 'none'
  assert.deepEqual(gmTargets(), ['tok-ogre'])
  nothingAsked()
  ok('an area Midi targets itself goes on without its template, and the kind of damage chosen is rolled without Midi\'s dialog')

  const vexBefore = hp(vex)
  const healing = await damage(cure.id, diceFor(cure.damage, 5))
  assert.equal(healing.status, 'done', JSON.stringify(healing))
  await until(() => hp(vex) === Math.min(30, vexBefore + 13), 'Vex to be healed')
  const thorinBefore = hp(thorin)
  assert.deepEqual([...workflowOf(wind.id).targets].map(t => t.id), ['tok-thorin'])
  const winded = await damage(wind.id, diceFor(wind.damage, 7))
  assert.equal(winded.status, 'done', JSON.stringify(winded))
  await until(() => hp(thorin) === thorinBefore + 12, 'Thorin to be healed')
  ok('Midi applies Cure Wounds\' healing to Vex, and Second Wind\'s to Thorin')

  // Bless, Hold Person and Shield go through Midi's workflow at once, with nothing to roll.
  assert.equal(workflowOf(blessed.id).currentAction, workflowOf(blessed.id).WorkflowState_Completed)
  assert.deepEqual(midi.effects.filter(e => e.effect === 'Bless').map(e => e.target).slice(0, 3), ['tok-thorin', 'tok-vex', 'tok-goblin'])
  const holdFlow = workflowOf(held.id)
  assert.equal(holdFlow.currentAction, holdFlow.WorkflowState_Completed)
  assert.ok(midi.effects.some(e => (e.effect === 'Paralyzed') && (e.target === 'tok-goblin')))
  assert.ok([...thorin.concentration.effects.values()].some(e => e.flags.dnd5e.item.data === 'grip'), 'concentrating on Hold Person')
  ok('Bless and Hold Person go through Midi, which applies their effects to the targets picked, and concentration begins')

  const goblinBefore = hp(goblin.actor)
  const darts = await damage(missile.id, diceFor(missile.damage, 2))
  assert.equal(darts.status, 'done', JSON.stringify(darts))
  await until(() => hp(goblin.actor) === goblinBefore - 9, 'the darts to hit')
  ok('Midi applies Magic Missile\'s damage')

  const lucky = await use('luck', 'lucky')
  assert.equal(lucky.status, 'done', JSON.stringify(lucky))
  const luckFlow = workflowOf(lucky.id)
  assert.equal(luckFlow.currentAction, luckFlow.WorkflowState_Completed)
  assert.equal(luckFlow.utilityRolls.length, 1)
  ok('a utility\'s own roll is Midi\'s, and its workflow completes')

  for (const [label, setup, make, reason] of [
    ['no target where Midi needs one', () => { midi.settings.requiresTargets = 'always' }, () => use('cure', 'mend'), 'target'],
    ['Midi asking which effects to apply', () => { thorin.items.get('bless').system.activities.get('blessing')._data.midiProperties = { chooseEffects: true } },
      () => use('bless', 'blessing', { targets: [target('cb-vex')] }), 'midi-dialog'],
    ['Midi\'s damage dialog always shown', () => { thorin.items.get('missile').system.activities.get('darts')._data.midiProperties = { forceDamageDialog: 'always' } },
      () => use('missile', 'darts', { targets: [target('cb-gob')] }), 'midi-dialog'],
    ['a utility prompting for its roll', () => { thorin.items.get('luck').system.activities.get('lucky').roll.prompt = true }, () => use('luck', 'lucky'), 'midi-dialog'],
  ]) {
    setup()
    const refused = await make()
    assert.deepEqual([refused.status, refused.reason], ['failed', reason], label)
    midi.settings.requiresTargets = 'none'
  }
  nothingAsked()
  ok('refuses beforehand what would have Midi ask the Gamemaster, or not make the use')
}

// ---- Spells cast from an item ----
const linkedHooks = []
Hooks.on('dnd5e.preUseLinkedSpell', cast => { linkedHooks.push(['pre', cast.id]) })
Hooks.on('dnd5e.postUseLinkedSpell', (cast, usage, used) => { linkedHooks.push(['post', cast.id, used?.message?.flags?.dnd5e?.item?.id]) })
const charges = () => thorin.items.get('flame').system.uses.spent
const slotsBefore = slots()
const barbs = await use('flame', 'cast-barbs', { targets: [target('cb-gob')] })
assert.equal(barbs.status, 'done', JSON.stringify(barbs))
assert.deepEqual(barbs.use, { type: 'utility' })
assert.equal(charges(), 1)
assert.deepEqual(slots(), slotsBefore, 'no slot spent')
assert.deepEqual([useCard(barbs.id).flags.dnd5e.item.id, useCard(barbs.id).flags.dnd5e.activity.id], ['barbs', 'barbs-use'])
assert.deepEqual(linkedHooks, [['pre', 'cast-barbs'], ['post', 'cast-barbs', 'barbs']])
nothingAsked()
ok("a weapon casts Silvery Barbs from its Cast activity, through the copy of the spell dnd5e keeps: a charge spent, no slot, the spell's card, and dnd5e's hooks for a spell cast from an item called")

const direct = await use('barbs', 'barbs-use', { targets: [target('cb-gob')] })
assert.equal(direct.status, 'done', JSON.stringify(direct))
assert.equal(charges(), 2)
assert.equal(linkedHooks.length, 2, 'cast from the spellbook, as dnd5e casts it there, without the Cast activity\'s hooks')
const wispAttack = await attack('flame', 'cast-wisp')
assert.equal(wispAttack.status, 'done', JSON.stringify(wispAttack))
assert.equal(charges(), 3)
assert.deepEqual(wispAttack.damage.rolls.map(roll => roll.dice), [[{ faces: 8, number: 1 }]])
const wispDamage = await damage(wispAttack.id, diceFor(wispAttack.damage, 5))
assert.equal(wispDamage.status, 'done', JSON.stringify(wispDamage))
assert.equal(wispDamage.rolls[0].total, 5)
nothingAsked()
ok("its spell cast from the spellbook spends the weapon's charge too; an attack spell cast from it is an attack, with the player's d20, and its damage with their dice")

const mass = await use('flame', 'cast-mhw', { targets: [target('cb-vex')] })
assert.equal(mass.status, 'done', JSON.stringify(mass))
assert.equal(charges(), 6)
assert.deepEqual(mass.damage.rolls[0].dice, [{ faces: 4, number: 1 }])
for (const [item, activity, what] of [['flame', 'cast-mhw', 'three charges'], ['flame', 'cast-barbs', 'one'], ['barbs', 'barbs-use', 'from the spellbook']]) {
  const short = await use(item, activity, { targets: [target('cb-vex')] })
  assert.deepEqual([short.status, short.reason], ['failed', 'consume'], what)
}
assert.deepEqual([charges(), slots()], [6, slotsBefore])
nothingAsked()
ok('Mass Healing Word spends three charges; with none left, it and Silvery Barbs are refused before anything is spent')

const missing = await use('flame', 'cast-charm')
assert.deepEqual([missing.status, missing.reason], ['failed', 'activity'], "a spell dnd5e hasn't copied")
const frozen = await attack('staff', 'cast-ray')
assert.deepEqual([frozen.status, frozen.reason], ['failed', 'activity'], 'a staff that needs attuning')
const frozenCopy = await attack('ray', 'ray-shot')
assert.deepEqual([frozenCopy.status, frozenCopy.reason], ['failed', 'item'], 'its spell, from the spellbook')
const notAnAttack = await attack('flame', 'cast-barbs')
assert.deepEqual([notAnAttack.status, notAnAttack.reason], ['failed', 'activity'], "a spell that isn't an attack, as one")
// A module that lets the cast go ahead without its cost, as dnd5e's pre-use hook lets one.
const free = (cast, usage) => { usage.consume = false }
Hooks.on('dnd5e.preUseLinkedSpell', free)
const freely = await use('flame', 'cast-barbs', { targets: [target('cb-gob')] })
Hooks.off('dnd5e.preUseLinkedSpell', free)
assert.equal(freely.status, 'done', JSON.stringify(freely))
assert.equal(charges(), 6, 'nothing spent, as the module had it')
const veto = () => false
Hooks.on('dnd5e.preUseLinkedSpell', veto)
const stopped = await use('scroll', 'cast-shield')
Hooks.off('dnd5e.preUseLinkedSpell', veto)
assert.deepEqual([stopped.status, stopped.reason], ['failed', 'cancelled'])
assert.equal(thorin.items.get('scroll').system.uses.spent, 0)
const read = await use('scroll', 'cast-shield')
assert.equal(read.status, 'done', JSON.stringify(read))
assert.equal(thorin.items.get('scroll').system.uses.spent, 1)
const again = await use('scroll', 'cast-shield')
assert.deepEqual([again.status, again.reason], ['failed', 'consume'])
nothingAsked()
ok("refused: a spell dnd5e hasn't copied, a staff's that needs attuning, from it or from the spellbook, and a spell as an attack it isn't; a module may stop a cast, or let it go ahead without its cost; a scroll casts once")

// ---- Spells items cast higher, and the later activities of a spell cast from an item (module 0.20.0) ----
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const sheetNow = () => JSON.parse(JSON.stringify(characterSheet(thorin)))
// How an item casts its spell, as the sheet has it, but for its description.
const castOn = id => {
  const { text, ...cast } = sheetNow().inventory.sections.flatMap(section => section.items).find(i => i.id === id)?.cast ?? {}
  return cast
}
const levelsOf = id => castOn(id)?.levels
const spentOf = id => thorin.items.get(id).system.uses.spent
const setSpent = (id, spent) => thorin.items.get(id).updateSource({ 'system.uses.spent': spent })
const level = (level, charges, short = false) => ({ level, charges, short })
// What dnd5e's hook for a spell cast from an item is told of the level it's cast at.
const castHooks = []
Hooks.on('dnd5e.preUseLinkedSpell', (cast, usage) => { castHooks.push([cast.id, usage.spell?.slot, usage.scaling]) })
const refusedFor = async (why, item, activity, fields) => {
  const refused = await use(item, activity, fields)
  assert.deepEqual([refused.status, refused.reason], ['failed', why], `${item}/${activity} ${JSON.stringify(fields)}`)
  return refused
}
const three = ['cb-gob', 'cb-hob', 'cb-ogre'].map(id => target(id))

// H1: the wand of magic missiles with seven charges offers 1st to 3rd, its darts one more a level.
const mmItem = owned('Wand of Magic Missiles')
assert.deepEqual(castOn('mm-wand'), { level: 1, concentration: false, charges: 1, short: false, levels: [level(1, 1), level(2, 2), level(3, 3)] })
assert.deepEqual([mmItem.activity.targets.count, mmItem.activity.targets.perLevel], [3, 1])
ok('a wand that casts higher for more charges offers each level its charges allow, with what each costs, and its targets a level higher')

// H2: cast at 1st by default, a charge spent, dnd5e's hook told the slot and scaling.
const mm1 = await use('mm-wand', 'cast-mm', { targets: three })
assert.equal(mm1.status, 'done', JSON.stringify(mm1))
assert.deepEqual([spentOf('mm-wand'), useCard(mm1.id).system.scaling, castHooks.at(-1)], [1, undefined, ['cast-mm', 'spell1', 0]])
// H3: at 2nd, four darts, two charges, the card scaled a level.
const mm2 = await use('mm-wand', 'cast-mm', { targets: [...three, target('cb-vex')], slot: 'spell2' })
assert.equal(mm2.status, 'done', JSON.stringify(mm2))
assert.deepEqual([spentOf('mm-wand'), useCard(mm2.id).system.scaling, castHooks.at(-1)], [3, 1, ['cast-mm', 'spell2', 1]])
assert.deepEqual(mm2.damage.rolls.map(roll => roll.dice), [[{ faces: 4, number: 1 }]])
// H16: Midi's use is given the slot and scaling, as dnd5e's.
if (MIDI) {
  const given = midi.usages.filter(entry => entry.activity.id === 'mm-darts').at(-1).usage
  assert.deepEqual([given.scaling, given.spell.slot], [1, 'spell2'])
}
await refusedFor('target', 'mm-wand', 'cast-mm', { targets: [...three, target('cb-vex'), target('cb-thorin')], slot: 'spell2' })
// H4: a level it doesn't offer, or Pact Magic's slot, spends nothing.
await refusedFor('slot', 'mm-wand', 'cast-mm', { slot: 'spell4' })
await refusedFor('slot', 'mm-wand', 'cast-mm', { slot: 'pact' })
assert.equal(spentOf('mm-wand'), 3)
nothingAsked()
ok(`casts from the wand at the level chosen, or its own, for as many charges, and as many targets, dnd5e's hook told the slot and scaling${MIDI ? ', and Midi too' : ''}; refuses a level it doesn't offer, and more targets than it takes there`)

// H13: a module that has it cast higher, in dnd5e's hook, is heeded: 3rd, three charges.
const castHigher = (cast, usage) => { if (cast.id === 'cast-mm') usage.spell.slot = 'spell3' }
Hooks.on('dnd5e.preUseLinkedSpell', castHigher)
const mm3 = await use('mm-wand', 'cast-mm', { targets: [target('cb-gob')] })
Hooks.off('dnd5e.preUseLinkedSpell', castHigher)
assert.equal(mm3.status, 'done', JSON.stringify(mm3))
assert.deepEqual([spentOf('mm-wand'), useCard(mm3.id).system.scaling], [6, 2])
// H5: with two charges left, 1st and 2nd; 3rd isn't offered any longer.
setSpent('mm-wand', 5)
assert.deepEqual(levelsOf('mm-wand'), [level(1, 1), level(2, 2)])
await refusedFor('slot', 'mm-wand', 'cast-mm', { slot: 'spell3' })
// H6: with one, none to choose, and 1st only; with none, short, and refused.
setSpent('mm-wand', 6)
assert.equal(levelsOf('mm-wand'), undefined)
await refusedFor('slot', 'mm-wand', 'cast-mm', { slot: 'spell2' })
const last = await use('mm-wand', 'cast-mm', { targets: [target('cb-gob')], slot: 'spell1' })
assert.equal(last.status, 'done', JSON.stringify(last))
assert.deepEqual([spentOf('mm-wand'), castOn('mm-wand').short, levelsOf('mm-wand')], [7, true, undefined])
await refusedFor('consume', 'mm-wand', 'cast-mm', { targets: [target('cb-gob')] })
assert.equal(spentOf('mm-wand'), 7)
nothingAsked()
ok("a module's change of level in dnd5e's hook holds; as charges run low, fewer levels are offered, and one no longer offered is refused, as one with none left is")

// H7: the wand of fireballs, from 3rd: at 5th, three charges and ten dice.
assert.deepEqual(levelsOf('fb-wand'), [level(3, 1), level(4, 2), level(5, 3)])
const fb5 = await use('fb-wand', 'cast-fb', { targets: [target('cb-gob')], slot: 'spell5' })
assert.equal(fb5.status, 'done', JSON.stringify(fb5))
assert.deepEqual([spentOf('fb-wand'), useCard(fb5.id).system.scaling, fb5.damage.rolls[0].dice], [3, 2, [{ faces: 6, number: 10 }]])
await refusedFor('slot', 'fb-wand', 'cast-fb', { slot: 'spell6' })
await refusedFor('slot', 'fb-wand', 'cast-fb', { slot: 'spell2' })
setSpent('fb-wand', 5)
assert.deepEqual(levelsOf('fb-wand').map(each => each.level), [3, 4])
setSpent('fb-wand', 6)
assert.equal(levelsOf('fb-wand'), undefined)
ok("a wand of fireballs cast at 5th spends three charges, and its damage throws ten dice; it's refused below its level or above what its charges allow")

// H8: a staff of healing with two charges left offers to 4th, but 3rd and up are short.
assert.deepEqual(levelsOf('heal-staff'), [level(1, 1), level(2, 2), level(3, 3, true), level(4, 4, true)])
const short = await refusedFor('consume', 'heal-staff', 'cast-cure', { targets: [target('cb-vex')], slot: 'spell3' })
assert.match(short.error, /NotEnough/)
assert.equal(spentOf('heal-staff'), 8)
// H9: eyes with three charges offer no level above three, though dnd5e's dialog does, and refuse it.
assert.deepEqual(levelsOf('charm-eyes').map(each => each.level), [1, 2, 3])
await refusedFor('consume', 'charm-eyes', 'cast-charm-eyes', { targets: [target('cb-gob')], slot: 'spell5' })
assert.equal(spentOf('charm-eyes'), 0)
// H10: a wand that casts at 4th only, for four charges with three left: short, and refused, as dnd5e
// would spend four; 4th is its own level, 5th it doesn't offer.
assert.deepEqual(castOn('fire4'), { level: 4, concentration: false, charges: 4, short: true })
await refusedFor('consume', 'fire4', 'cast-fire4', { targets: [target('cb-gob')] })
await refusedFor('slot', 'fire4', 'cast-fire4', { slot: 'spell5' })
await refusedFor('consume', 'fire4', 'cast-fire4', { slot: 'spell4' })
assert.equal(spentOf('fire4'), 4)
nothingAsked()
ok("levels the item's charges can't pay for are short, those it never has enough for aren't offered, and either is refused before anything is spent; a Cast fixed above its spell's level costs what dnd5e charges")

// H11: Hex from the flame, its charges back: the curse cast through the Cast activity, then its
// damage, through the copy, spending nothing and calling none of the Cast activity's hooks.
setSpent('flame', 0)
const hexRow = sheetNow().spells.flatMap(section => section.spells).find(spell => spell.id === 'hex')
assert.deepEqual(hexRow.activities.map(entry => [entry.id, entry.consumesSlot]), [['hex-curse', undefined], ['hex-dmg', false]])
const hooksBefore = linkedHooks.length
const hexed = await use('flame', 'cast-hex', { targets: [target('cb-gob')] })
assert.equal(hexed.status, 'done', JSON.stringify(hexed))
assert.deepEqual([charges(), linkedHooks.slice(hooksBefore)], [1, [['pre', 'cast-hex'], ['post', 'cast-hex', 'hex']]])
const hexDamage = await use('hex', 'hex-dmg', { targets: [target('cb-gob')] })
assert.equal(hexDamage.status, 'done', JSON.stringify(hexDamage))
assert.deepEqual([charges(), linkedHooks.length - hooksBefore, hexDamage.damage.rolls[0].dice], [1, 2, [{ faces: 6, number: 1 }]])
const curse = await use('hex', 'hex-curse', { targets: [target('cb-hob')] })
assert.equal(curse.status, 'done', JSON.stringify(curse))
assert.deepEqual([charges(), linkedHooks.length - hooksBefore], [2, 2])
nothingAsked()
ok("Hex's damage, after it's cast from the flame, is used through its copy, spending no charge; its curse from the copy spends one; neither calls the Cast activity's hooks")

// H12: Spirit Guardians' save each turn at 5th: nothing spent, its damage two levels higher; below
// the level it's cast from the staff, refused; cast from the staff at 5th, three charges.
const aura5 = await use('sg', 'sg-save', { targets: [target('cb-gob')], slot: 'spell5' })
assert.equal(aura5.status, 'done', JSON.stringify(aura5))
assert.deepEqual([spentOf('sg-staff'), useCard(aura5.id).system.scaling, aura5.damage.rolls[0].dice], [0, 2, [{ faces: 8, number: 5 }]])
await refusedFor('slot', 'sg', 'sg-save', { targets: [target('cb-gob')], slot: 'spell2' })
const sg5 = await use('sg-staff', 'cast-sg', { slot: 'spell5' })
assert.equal(sg5.status, 'done', JSON.stringify(sg5))
assert.deepEqual([spentOf('sg-staff'), useCard(sg5.id).system.scaling], [3, 2])
// H14: a Cast activity's level below its spell's is the spell's.
assert.deepEqual(levelsOf('low-cast').slice(0, 2), [level(2, 1), level(3, 2)])
await refusedFor('slot', 'low-cast', 'cast-low', { slot: 'spell1' })
const blurred = await use('low-cast', 'cast-low')
assert.equal(blurred.status, 'done', JSON.stringify(blurred))
assert.equal(spentOf('low-cast'), 1)
// H15: a most that can't be read offers none, and casts at its own level.
assert.deepEqual(castOn('bad-max'), { level: 1, concentration: false, charges: 1, short: false })
const odd = await use('bad-max', 'cast-bad', { targets: [target('cb-gob')] })
assert.equal(odd.status, 'done', JSON.stringify(odd))
assert.equal(spentOf('bad-max'), 1)
nothingAsked()
ok("a spell's later activity is used at any level its Cast activity offers, spending nothing where it spends no slot; a Cast's level is never below its spell's; a most that can't be read offers no levels")

// A cantrip cast from an item has no level to choose, even where its Cast activity would scale: any
// slot named is refused, through the Cast activity or the copy, and nothing is spent; without one,
// it's cast, for its one charge.
assert.deepEqual(castOn('flare-wand'), { level: 0, concentration: false, charges: 1, short: false })
const cantripBefore = [slots(), messages.size]
await refusedFor('slot', 'guidance', 'guide', { slot: 'spell1' })
await refusedFor('slot', 'stone', 'cast-guidance', { slot: 'spell1' })
await refusedFor('slot', 'flare-wand', 'cast-flare', { targets: [target('cb-gob')], slot: 'spell1' })
await refusedFor('slot', 'flare', 'flare-burn', { targets: [target('cb-gob')], slot: 'spell0' })
assert.deepEqual([slots(), messages.size, spentOf('flare-wand')], [...cantripBefore, 0], 'nothing spent or posted')
const flared = await use('flare-wand', 'cast-flare', { targets: [target('cb-gob')] })
assert.equal(flared.status, 'done', JSON.stringify(flared))
assert.equal(spentOf('flare-wand'), 1)
// A scroll's spell written two levels above its own costs what dnd5e will charge for it there.
const scrolled = await refusedFor('consume', 'scroll3', 'scroll-blur')
assert.match(scrolled.error, /NotEnough/)
assert.equal(spentOf('scroll3'), 0)
nothingAsked()
ok("a cantrip cast from an item, through its Cast activity or its copy, refuses any slot and spends nothing, though its Cast activity would scale; a scroll's spell written higher is checked at the cost dnd5e will charge")

// ---- A target on a level the Gamemaster isn't viewing ----
const hpOf = actor => actor.system.attributes.hp.value
thorin.items.get('missile').system.activities.get('darts')._data.midiProperties = {}
// After a long fight, a rest: Magic Missile's slots are back.
thorin.system.spells.spell1.value = 6
if (MIDI) {
  const away = await use('missile', 'darts', { targets: [target('cb-gob'), target('cb-wraith')] })
  assert.deepEqual([away.status, away.reason], ['failed', 'scene'])
  await game.settings.set('sending-stone', 'offCanvasTargets', true)
  const [appliedBefore, wraithBefore] = [midi.applied.length, hpOf(wraith.actor)]
  const spread = await use('missile', 'darts', { targets: [target('cb-gob'), target('cb-wraith')] })
  assert.equal(spread.status, 'done', JSON.stringify(spread))
  const card = useCard(spread.id)
  assert.deepEqual(card.flags.dnd5e.targets.map(t => t.name), ['Goblin', 'Wraith'], 'the card names both targets')
  assert.deepEqual(card.flags['sending-stone'].usage.targets.map(t => t.name), ['Goblin', 'Wraith'])
  assert.deepEqual(card.flags['sending-stone'].usage.tokenIds, ['tok-goblin'])
  assert.deepEqual([...workflowOf(spread.id).targets].map(t => t.id), ['tok-goblin'], 'Midi works on the goblin alone')
  const hits = await damage(spread.id, diceFor(spread.damage, 2))
  assert.equal(hits.status, 'done', JSON.stringify(hits))
  await until(() => midi.applied.length > appliedBefore, 'the darts to hit the goblin')
  assert.deepEqual(midi.applied.slice(appliedBefore).map(a => [a.target, a.amount]), [['tok-goblin', 9]])
  assert.equal(hpOf(wraith.actor), wraithBefore, 'the wraith is left for the Gamemaster to apply')
  midi.settings.requiresTargets = 'always'
  const unseen = await use('missile', 'darts', { targets: [target('cb-wraith')] })
  assert.deepEqual([unseen.status, unseen.reason], ['failed', 'scene'], 'none Midi can target, where it needs one')
  midi.settings.requiresTargets = 'none'
  await game.settings.set('sending-stone', 'offCanvasTargets', false)
  ok('a target the Gamemaster isn\'t viewing is refused, unless they allow it: then the card names it, and Midi works on the others')
} else {
  const away = await use('missile', 'darts', { targets: [target('cb-wraith')] })
  assert.equal(away.status, 'done', JSON.stringify(away))
  assert.deepEqual(useCard(away.id).flags.dnd5e.targets.map(t => t.name), ['Wraith'])
  ok('dnd5e\'s cards name a target on a level the Gamemaster isn\'t viewing, needing no token for it')
}

// ---- Damage changed in the app: more dice, another die, every die at its highest ----
thorin.system.spells.spell1.value = 6
thorin.system.spells.spell3.value = 2
const told = app.events.filter(e => e.type === 'bridge.hello').map(e => [e.campaign.title, e.data.features.rolls.modifiers])
assert.deepEqual(Object.fromEntries(told), { Ashlands: true, Mirkwood: false })
const more = await use('missile', 'darts', { targets: [target('cb-gob')] })
assert.equal(more.status, 'done', JSON.stringify(more))
assert.equal(more.damage.rolls[0].perDie, 1)
const unchanged = await damage(more.id, diceFor(more.damage, 2), { modifiers: { extra: 2, faces: 6 } })
assert.deepEqual([unchanged.status, unchanged.reason, unchanged.error], ['failed', 'invalid', 'dice'], 'the dice it said, unchanged')
for (const modifiers of [{ faces: 20 }, { faces: 3 }, { extra: -1 }, { extra: 1.5 }, { extra: 41 }, { maximize: 'yes' }, 'more']) {
  const bad = await damage(more.id, diceFor(more.damage, 2), { modifiers })
  assert.deepEqual([bad.status, bad.reason, bad.error], ['failed', 'invalid', 'modifiers'], JSON.stringify(modifiers))
}
const changed = await damage(more.id, [{ faces: 6, results: [2, 3, 4, 5, 6] }], { modifiers: { extra: 2, faces: 6 } })
assert.equal(changed.status, 'done', JSON.stringify(changed))
assert.equal(changed.rolls[0].total, 23)
if (!MIDI) assert.deepEqual(faces(rollMessage(changed.id).rolls[0]), [[2, 3, 4, 5, 6]])
ok('damage with more dice, of another size, takes the player\'s dice for them all; the dice it said unchanged, or changes it can\'t read, are refused')

const highest = await use('fireball', 'blast', { targets: [target('cb-gob')] })
assert.equal(highest.status, 'done', JSON.stringify(highest))
const maxed = await damage(highest.id, diceFor(highest.damage, 1), { modifiers: { maximize: true } })
assert.equal(maxed.status, 'done', JSON.stringify(maxed))
assert.equal(maxed.rolls[0].total, 48)
ok('damage at its highest has every die at its highest, whatever the dice')

// ---- Damage whose first die it takes away (module 0.21.0) ----
// Withering Touch's `-1d4 + 2d6`, Foundry reading its leading - as an operator: more dice, or another
// die, are its d6s', the first die it adds, never the d4 it takes away; nor is it rolled at its
// highest, which would take the most away.
{
  const posted = () => messages.size
  const rolled = (useId, dealt) => (MIDI ? workflowOf(useId).damageRolls?.[0] : rollMessage(dealt.id)?.rolls[0])
  const touch = () => use('withering', 'withering-touch', { targets: [target('cb-gob')] })
  const withered = await touch()
  assert.equal(withered.status, 'done', JSON.stringify(withered))
  assert.deepEqual(withered.damage.rolls.map(r => [r.formula, r.dice, r.perDie]), [['- 1d4 + 2d6', [{ faces: 4, number: 1, subtracted: true }, { faces: 6, number: 2 }], 1]])
  const before = posted()
  for (const [dice, modifiers, error] of [
    [[{ faces: 4, results: [1, 2] }, { faces: 6, results: [3, 4] }], { extra: 1 }, 'dice'],
    [[{ faces: 4, results: [2] }, { faces: 6, results: [3, 4] }], { maximize: true }, 'modifiers'],
  ]) {
    const refused = await damage(withered.id, dice, { modifiers })
    assert.deepEqual([refused.status, refused.reason, refused.error], ['failed', 'invalid', error], JSON.stringify(modifiers))
  }
  assert.deepEqual([posted(), useCard(withered.id).flags['sending-stone'].damage], [before, undefined])
  if (MIDI) assert.equal(workflowOf(withered.id).damageRolls, null)
  const more = await damage(withered.id, [{ faces: 4, results: [2] }, { faces: 6, results: [1, 2, 3] }], { modifiers: { extra: 1 } })
  assert.equal(more.status, 'done', JSON.stringify(more))
  assert.deepEqual([rolled(withered.id, more).formula, more.rolls[0].total], ['- 1d4 + 3d6', 4])
  const again = await touch()
  const larger = await damage(again.id, [{ faces: 4, results: [2] }, { faces: 12, results: [5, 6] }], { modifiers: { faces: 12 } })
  assert.equal(larger.status, 'done', JSON.stringify(larger))
  assert.deepEqual([rolled(again.id, larger).formula, larger.rolls[0].total], ['- 1d4 + 2d12', 9])
  ok(`damage whose first die it takes away has a die more, or another die, of the first die it adds; the die taken away changed, or the damage at its highest, is refused, nothing posted${MIDI ? ', its workflow still waiting' : ''}`)
}

// ---- The Gamemaster's, as the character (module 0.23.0) ----
// A use, its damage and a utility's own roll: every message they make is the player's, flagged the
// Gamemaster's; the player's never are.
{
  const mark = m => m.flags?.['sending-stone']?.by
  const goblinHp = goblin.actor.system.attributes.hp.value
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
  const castBy = async by => {
    thorin.system.spells.spell3.value = 2
    const before = new Set(messages.keys())
    const used = await use('fireball', 'blast', { targets: [target('cb-gob')], ...(by && { by }) })
    assert.equal(used.status, 'done', JSON.stringify(used))
    const dealt = await damage(used.id, diceFor(used.damage, 3), by ? { by } : {})
    assert.equal(dealt.status, 'done', JSON.stringify(dealt))
    const luck = await formula('omen', 'foresee', [{ faces: 4, results: [2] }], by ? { by } : {})
    assert.equal(luck.status, 'done', JSON.stringify(luck))
    goblin.actor.system.attributes.hp.value = goblinHp
    const posted = [...messages.values()].filter(m => !before.has(m.id))
    return { used, dealt, luck, posted, ours: posted.filter(m => m.flags?.['sending-stone']) }
  }
  Hooks.on('createChatMessage', forge)
  const gm = await castBy('gm')
  Hooks.off('createChatMessage', forge)
  const player = await castBy(null)
  const card = useCard(gm.used.id)
  assert.deepEqual([card.flags['sending-stone'].use, mark(card), card.author.id], [gm.used.id, 'gm', useCard(player.used.id).author.id])
  assert.deepEqual(rollMessage(gm.luck.id).flags['sending-stone'], { request: gm.luck.id, by: 'gm' })
  assert.deepEqual(rollMessage(player.luck.id).flags['sending-stone'], { request: player.luck.id })
  assert.equal(rollMessage(gm.luck.id).author.id, 'alice')
  if (!MIDI) {
    // dnd5e's path: the card, the damage roll and the utility's roll, every one flagged.
    assert.deepEqual(rollMessage(gm.dealt.id).flags['sending-stone'], { request: gm.dealt.id, by: 'gm' })
    assert.deepEqual(rollMessage(player.dealt.id).flags['sending-stone'], { request: player.dealt.id })
    assert.deepEqual([gm.posted.length, gm.posted.every(m => mark(m) === 'gm')], [3, true])
  } else {
    // Midi's: the damage goes on the use's card, which Midi writes; whatever else Midi posts is its own.
    assert.deepEqual(faces(workflowOf(gm.used.id).damageRolls[0]), faces(workflowOf(player.used.id).damageRolls[0]))
  }
  assert.ok(gm.ours.length >= 2 && gm.ours.every(m => mark(m) === 'gm'))
  assert.ok(player.ours.length === gm.ours.length && player.ours.every(m => mark(m) === undefined))
  const strip = ({ id, messageId, messages, ...rest }) => rest
  assert.deepEqual([strip(gm.used), strip(gm.dealt), strip(gm.luck)], [strip(player.used), strip(player.dealt), strip(player.luck)])
  ok(`the Gamemaster's use, its damage and a utility's roll are made as the player's and told the app alike, every message they make flagged the Gamemaster's${MIDI ? ', through Midi' : ''}; the player's never`)

  // Each result lists the messages its own roll made, in order (module 0.25.0): the use its card,
  // the damage, by dnd5e, its damage roll, the utility its roll. Never another's, nor a player's
  // copy; a player's result lists none.
  const lists = [gm.used, gm.dealt, gm.luck].map(result => result.messages)
  if (!MIDI) assert.deepEqual(lists, [[card.id], [rollMessage(gm.dealt.id).id], [rollMessage(gm.luck.id).id]])
  else assert.deepEqual([lists[0].includes(card.id), lists[2]], [true, [rollMessage(gm.luck.id).id]])
  assert.deepEqual(lists, [gm.used, gm.dealt, gm.luck].map(result => ownOf(gm.posted, result.id)))
  assert.equal(lists.flat().length, gm.ours.length)
  assert.ok(forged.length >= 4 && forged.some(id => id.startsWith('marked')) && !lists.flat().some(id => forged.includes(id)))
  assert.deepEqual([player.used, player.dealt, player.luck].map(result => 'messages' in result), [false, false, false])
  ok(`the Gamemaster's use, its damage and a utility's roll each list the messages they made, in order, never another's or a player's copy${MIDI ? ', through Midi' : ''}; the player's list none`)
}

console.log(`${MIDI ? 'midi' : 'dnd5e'}: done`)
process.exit(0)
