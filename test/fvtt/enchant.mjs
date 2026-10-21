// Players' enchant activities from the app (module 0.21.0): Magic Weapon (2014 and 2024, and a
// scroll of it), Shillelagh, True Strike, Sacred Weapon, Pact of the Blade, a Flame Tongue's Engulf
// in Flames, a Dagger of Venom's Coat Blade, an Oil of Sharpness, Flame Blade, Darkness and
// Sequester; what the sheet says of them and of the enchantments items carry, items not identified
// yet included; using them, through dnd5e or Midi-QOL, and ending what they applied, anyone's. The real
// module, dnd5e 5.3.3's real dice classes, its items and activities ported (activity5e.mjs) and its
// enchantments (enchant5e.mjs), a stand-in Foundry core and app. MIDI=1 puts a stand-in Midi-QOL
// workflow in the world (midi-fake.mjs). Run with --import ./unref-timers.mjs --import
// ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { combat, combatant, settings, user, actors } from './stub.mjs'

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

const { messages } = await import('./dice-core.mjs')
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
CONFIG.specialStatusEffects = { CONCENTRATING: 'concentrating' }
// The kinds of item dnd5e lets be enchanted (data/item/*.mjs metadata), with none of the inventory
// sections 4.0 gives them, so the sheet lists its defaults.
CONFIG.Item = {
  dataModels: Object.fromEntries([
    ...['weapon', 'equipment', 'consumable', 'tool', 'loot', 'container', 'spell', 'feat'].map(type => [type, { metadata: { enchantable: true } }]),
    ['class', { metadata: {} }], ['background', { metadata: {} }],
  ]),
  typeLabels: {},
}
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')

const { Actor5e } = await import('./actor5e.mjs')
const { activityTypes, equip, screen } = await import('./activity5e.mjs')
const { midi, installMidi, MidiActivity } = await import('./midi-fake.mjs')
const {
  ActiveEffect5e, EnchantActivity, createRules, effectReads, effectsMade, midiEnchant, midiEnchantActivity, registry: enchantments,
  staticID, withEffects,
} = await import('./enchant5e.mjs')
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  documents: { activity: { EnchantActivity, CastActivity: { ENCHANTMENT_ID: staticID('dnd5espellchanges') } } },
  utils: { staticID },
  registry: {
    enchantments,
    messages: {
      get(id, type) {
        return [...messages.values()].filter(m => (m.flags?.dnd5e?.originatingMessage === id) && (m.flags?.dnd5e?.roll?.type === type))
      },
    },
  },
}
globalThis.Item = { implementation: class { constructor(data) { Object.assign(this, data); this.system ??= {} } } }

// ---- The world ----
const users = game.users
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
user('bob', 'Bob')
if (MIDI) {
  installMidi()
  activityTypes.enchant = midiEnchantActivity(MidiActivity)
}

const add = actor => { actors.set(actor.id, actor); actor.documentName = 'Actor'; return actor }
const P = {
  mw1: 'SLSudYaACjmmmZsU', mw2: '8OhsRxK3dF1JeQXO', mw3: '7L1wKfaEdN85IA0Z',
  sh1: 'QPsqj6jfS0iXSrTs', sh2: 'Oy8fnNNzPmehxXio', sh3: 'advnpQaBnsbuv02y', sh4: 'X9xoN8qHUiCc4SZR',
  tsMelee: 'SouQfUgwb9LlUraq', tsRanged: 'Zsx8UvC9DmdrA1E1', ablaze: 'MHnAqxEXBhUbnjPq', coat: 'f0WvHHwmTfdkF3OP',
  sacred: 'sEWDFOuWn47L5860', pact: 'QElum2XYhYUYQ5l2', dark: 'darknessprofile1', sequester: 'sequesterprof001',
  fb: ['flamebladescim1', 'flamebladescim2', 'flamebladescim3', 'flamebladescim4'].map(id => id.padEnd(16, '0')),
  mw24: ['IMt1nMPrWppyRYMT', '9zA6SFF8HKk9xNn2', 'AJQwm1dgXz7D333k'], oiled: 'qwUNBZRXUAvDcqDw',
  edgeA: 'edgeprofilea0001', edgeB: 'edgeprofileb0001', mfAblaze: 'mfablazeprofile1',
}
const mgc = { key: 'system.properties', mode: 2, value: 'mgc' }
const rename = value => ({ key: 'name', mode: 5, value })
const suffix = value => ({ key: 'name', mode: 2, value })
const bonus = value => ({ key: 'system.magicalBonus', mode: 5, value: String(value) })
const enchantment = (_id, name, changes = [], extra = {}) => ({ _id, name, type: 'enchantment', changes, transfer: false, flags: {}, ...extra })
const weapon = (id, name, sort, category, properties = [], { system = {}, activities = [], effects = [] } = {}) => ({
  id, name, sort, type: 'weapon',
  system: { type: { value: category }, properties, quantity: 1, attackType: 'melee', ...system },
  activities: [{ id: `${id}-swing`, damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }] }, ...activities],
  effects,
})
const attack = (id, name) => ({ id, name, ability: 'cha', damage: [{ number: 1, denomination: 8, types: ['radiant'] }] })
// Magic Weapon, 2014: a 2nd-level spell taking concentration, +1 to 3rd level, +2 at 4th and 5th,
// +3 from 6th (spells/2nd-level/magic-weapon.yml).
const magicWeapon = (id, activity, sort = 20) => ({
  id, name: 'Magic Weapon', sort, type: 'spell', system: { level: 2, method: 'spell', properties: ['concentration'] },
  activities: [{
    id: activity, type: 'enchant', name: 'Enchant Weapon', concentration: true, restrictionType: 'weapon', allowMagical: false,
    profiles: [{ _id: P.mw1, level: { max: 3 } }, { _id: P.mw2, level: { min: 4, max: 5 } }, { _id: P.mw3, level: { min: 6 } }],
  }],
  effects: [[P.mw1, 1], [P.mw2, 2], [P.mw3, 3]].map(([_id, plus]) => enchantment(_id, `Magic Weapon, +${plus}`, [rename(`{}, +${plus}`), mgc, bonus(plus)])),
})

// Ari, a 5th-level wizard who has picked up a paladin's and a warlock's tricks, with two paladin
// levels: slots to 4th level, and one of 7th for Sequester; concentration on one thing at once.
const ari = add(new Actor5e({ id: 'ari', name: 'Ari', owners: ['alice'], mods: { str: 1, int: 3, cha: 2 } }))
alice.character = ari
equip(ari, {
  spells: {
    spell1: { value: 4, max: 4, level: 1 }, spell2: { value: 12, max: 12, level: 2 }, spell3: { value: 4, max: 4, level: 3 },
    spell4: { value: 2, max: 2, level: 4 },
    ...Object.fromEntries([5, 6, 8, 9].map(level => [`spell${level}`, { value: 0, max: 0, level }])),
    spell7: { value: 1, max: 1, level: 7 },
  },
  items: [
    weapon('longsword', 'Longsword', 1, 'martialM'),
    // Bryn's Magic Weapon on Ari's club, for as long as Bryn concentrates on it.
    weapon('club', 'Club', 2, 'simpleM', [], {
      effects: [enchantment('brynmwonclub0001', 'Magic Weapon, +1', [rename('{}, +1'), mgc, bonus(1)], {
        origin: 'Actor.bryn.Item.brynmw.Activity.bryn-mw',
        flags: { dnd5e: { enchantmentProfile: P.mw1, dependentOn: 'Actor.bryn.ActiveEffect.brynconc00000001' } },
      })],
    }),
    weapon('quarterstaff', 'Quarterstaff', 3, 'simpleM'),
    // A magical longsword, with Ari's True Strike on it as dnd5e 6 keeps one whose time is up.
    weapon('swordplus', 'Longsword +1', 4, 'martialM', ['mgc'], {
      effects: [enchantment('truestrikeover01', 'True Strike', [], {
        system: { origin: { activity: 'Actor.ari.Item.truestrike.Activity.strike-enchant' } }, transfer: true,
        duration: { turns: 1, expired: true }, flags: { dnd5e: { enchantmentProfile: P.tsMelee } },
      })],
    }),
    // A Flame Tongue: its template's enchantment, made once, and Engulf in Flames on itself, a switch
    // (equipment24/weapons/magical/flame-tongue.yml).
    weapon('flametongue', 'Flame Tongue Longsword', 5, 'martialM', ['mgc'], {
      system: { attunement: 'required', attuned: true },
      activities: [
        { id: 'ft-template', type: 'enchant', name: 'Flame Tongue', activation: { type: '', value: null }, restrictionType: '', profiles: [{ _id: 'VtBOwsAVipxkP2f5' }] },
        { id: 'engulf', type: 'enchant', name: 'Engulf in Flames', activation: { type: 'bonus', value: 1 }, self: true, range: 'self',
          restrictionType: 'weapon', allowMagical: true, categories: ['simpleM', 'martialM'], profiles: [{ _id: P.ablaze }] },
      ],
      effects: [
        enchantment('VtBOwsAVipxkP2f5', 'Flame Tongue', [rename('Flame Tongue {}'), mgc]),
        enchantment(P.ablaze, 'Ablaze', [rename('{} (Ablaze)')]),
      ],
    }),
    // A Dagger of Venom: Coat Blade with Poison, on itself, for its one use a day, adding its Poison
    // Save (equipment24/weapons/magical/dagger-of-venom.yml).
    weapon('venom', 'Dagger of Venom', 6, 'simpleM', ['fin', 'lgt', 'mgc', 'thr'], {
      system: { uses: { max: 1, spent: 0 } },
      activities: [
        { id: 'coat', type: 'enchant', name: 'Coat Blade with Poison', activation: { type: 'bonus', value: 1 }, self: true,
          consumption: [{ type: 'itemUses', value: '1', target: '' }], restrictionType: 'weapon', allowMagical: true, categories: ['simpleM'],
          properties: ['fin', 'lgt', 'mgc', 'thr'], profiles: [{ _id: P.coat, riders: { activity: ['venom-save'] } }] },
        { id: 'venom-save', type: 'save', name: 'Poison Save', save: ['con'], dc: 15, affects: 'creature', count: 1 },
      ],
      effects: [
        enchantment(P.coat, 'Poison Coat', [], { duration: { seconds: 60 } }),
        // Ari's Shillelagh on the dagger, as dnd5e 6 keeps it: its origin in `system.origin` alone.
        enchantment('sixshillelagh001', 'Shillelagh (1d10)', [rename('{} Shillelagh')], {
          system: { origin: { activity: 'Actor.ari.Item.shillelagh.Activity.imbue' } }, transfer: true,
          duration: { seconds: 60 }, flags: { dnd5e: { enchantmentProfile: P.sh2 } },
        }),
      ],
    }),
    // A greataxe a magic item's template made a +1 weapon, from the compendium.
    weapon('greataxe', 'Greataxe', 7, 'martialM', [], {
      effects: [enchantment('weaponplusone001', 'Weapon +1', [rename('{} +1'), mgc, bonus(1)], {
        origin: 'Compendium.dnd5e.equipment24.Item.x.Activity.y', flags: { dnd5e: { enchantmentProfile: 'weaponplusone001' } },
      })],
    }),
    // A magic item's template: a shield to be made +1, +2 or +3.
    { id: 'shieldtpl', name: 'Shield, +1, +2, or +3', sort: 8, type: 'equipment', system: { type: { value: 'shield' }, properties: [], quantity: 1 },
      activities: [{ id: 'shield-tpl', type: 'enchant', name: 'Enchant Shield', restrictionType: '', profiles: [{ _id: 'shieldplusone001' }] }],
      effects: [enchantment('shieldplusone001', 'Shield +1', [rename('{} +1'), mgc])] },
    magicWeapon('mweapon', 'mw'),
    // Magic Weapon, 2024: no concentration, an hour, +1 at 2nd level only, +2 at 3rd to 5th, +3 from
    // 6th (spells24/2nd-level/magic-weapon.yml).
    { id: 'mw24', name: 'Magic Weapon', sort: 26, type: 'spell', system: { level: 2, method: 'spell', properties: [] },
      activities: [{ id: 'mw24-enchant', type: 'enchant', name: 'Enchant Weapon', concentration: false, restrictionType: 'weapon', allowMagical: false,
        profiles: [{ _id: P.mw24[0], level: { min: 2, max: 2 } }, { _id: P.mw24[1], level: { min: 3, max: 5 } }, { _id: P.mw24[2], level: { min: 6 } }] }],
      effects: P.mw24.map((_id, index) => enchantment(_id, `Magic Weapon +${index + 1}`, [rename(`Magic {} +${index + 1}`), mgc, bonus(index + 1)], { duration: { seconds: 3600 } })) },
    // A scroll of the 2014 Magic Weapon: the spell's enchant activity on a consumable, used up as it's
    // read, taking concentration; its profile by Ari's level, as dnd5e's scrolls have it.
    { id: 'mwscroll', name: 'Spell Scroll: Magic Weapon', sort: 11, type: 'consumable',
      system: { type: { value: 'scroll' }, properties: [], quantity: 1, uses: { max: 1, spent: 0, autoDestroy: true } },
      activities: [{ id: 'scroll-mw', type: 'enchant', name: 'Enchant Weapon', concentration: true, restrictionType: 'weapon', allowMagical: false,
        consumption: [{ type: 'itemUses', value: '1', target: '' }],
        profiles: [{ _id: P.mw1, level: { max: 3 } }, { _id: P.mw2, level: { min: 4, max: 5 } }, { _id: P.mw3, level: { min: 6 } }] }],
      effects: [[P.mw1, 1], [P.mw2, 2], [P.mw3, 3]].map(([_id, plus]) => enchantment(_id, `Magic Weapon, +${plus}`, [rename(`{}, +${plus}`), mgc, bonus(plus)])) },
    // An Oil of Sharpness, gone once applied (equipment24/consumables/oil-of-sharpness.yml).
    { id: 'oil', name: 'Oil of Sharpness', sort: 12, type: 'consumable',
      system: { type: { value: 'potion' }, properties: [], quantity: 1, uses: { max: 1, spent: 0, autoDestroy: true } },
      activities: [{ id: 'apply-oil', type: 'enchant', name: 'Apply Oil to Weapon', activation: { type: 'minute', value: 1 },
        consumption: [{ type: 'itemUses', value: '1', target: '' }], restrictionType: 'weapon', allowMagical: false, categories: ['simpleM', 'martialM'],
        profiles: [{ _id: P.oiled }] }],
      effects: [enchantment(P.oiled, 'Oiled', [rename('{} Oiled'), mgc, bonus(3)], { duration: { seconds: 60 } })] },
    // A magic sword not identified yet, known as a Strange Sword.
    weapon('mystblade', 'Vorpal Sword', 13, 'martialM', ['mgc'], { system: { identified: false, unidentified: { name: 'Strange Sword' } } }),
    // A Flame Tongue not identified yet, alight, its own Ablaze telling what it is.
    weapon('mystflame', 'Flame Tongue Shortsword', 14, 'martialM', ['mgc'], {
      system: { identified: false, unidentified: { name: 'Warm Shortsword' } },
      activities: [{ id: 'mf-engulf', type: 'enchant', name: 'Engulf in Flames', activation: { type: 'bonus', value: 1 }, self: true, range: 'self',
        restrictionType: 'weapon', allowMagical: true, profiles: [{ _id: P.mfAblaze }] }],
      effects: [
        enchantment(P.mfAblaze, 'Ablaze', [rename('{} (Ablaze)')]),
        enchantment('mfablazeapplied1', 'Ablaze', [rename('{} (Ablaze)')], {
          origin: 'Actor.ari.Item.mystflame.Activity.mf-engulf', flags: { dnd5e: { enchantmentProfile: P.mfAblaze } },
        }),
      ],
    }),
    // A battleaxe made +1 by an activity whose item is gone, for good; with, for a minute, one dragged
    // onto it from a scroll since used up, as dnd5e's item sheet makes one, with no profile; and one
    // with the id of the changes dnd5e makes to a spell's copy, though with a profile.
    weapon('oldplus', 'Battleaxe', 15, 'martialM', [], {
      effects: [
        enchantment('oldplusone000001', 'Weapon +1', [rename('{} +1'), mgc, bonus(1)], {
          origin: 'Actor.ari.Item.gone.Activity.x', flags: { dnd5e: { enchantmentProfile: 'oldplusprofile01' } },
        }),
        enchantment('draggedplusone01', 'Dragged +1', [], { origin: 'Actor.ari.Item.usedscroll', duration: { seconds: 60 } }),
        enchantment(staticID('dnd5espellchanges'), 'Spell Changes', [], {
          origin: 'Actor.ari.Item.gone.Activity.x', duration: { seconds: 60 }, flags: { dnd5e: { enchantmentProfile: 'oldplusprofile01' } },
        }),
      ],
    }),
    // Shillelagh, 2024: a cantrip whose profile is by character level (spells24/cantrips/shillelagh.yml).
    { id: 'shillelagh', name: 'Shillelagh', sort: 21, type: 'spell', system: { level: 0, method: 'spell', properties: [] },
      activities: [
        { id: 'imbue', type: 'enchant', name: 'Imbue Weapon', restrictionType: 'weapon', allowMagical: true, categories: ['simpleM'],
          profiles: [{ _id: P.sh1, level: { max: 4 } }, { _id: P.sh2, level: { min: 5, max: 10 } }, { _id: P.sh3, level: { min: 11, max: 16 } }, { _id: P.sh4, level: { min: 17 } }] },
        attack('shill-attack', 'Spellcasting Attack'),
      ],
      effects: [[P.sh1, '1d8'], [P.sh2, '1d10'], [P.sh3, '1d12'], [P.sh4, '2d6']].map(([_id, die]) =>
        enchantment(_id, `Shillelagh (${die})`, [rename('{} Shillelagh')], { duration: { seconds: 60 } })) },
    // True Strike, 2024: two profiles, each adding an attack (spells24/cantrips/true-strike.yml).
    { id: 'truestrike', name: 'True Strike', sort: 22, type: 'spell', system: { level: 0, method: 'spell', properties: [] },
      activities: [
        { id: 'strike-enchant', type: 'enchant', name: 'Enchant Weapon', restrictionType: 'weapon', allowMagical: true,
          profiles: [{ _id: P.tsMelee, riders: { activity: ['ts-melee'] } }, { _id: P.tsRanged, riders: { activity: ['ts-ranged'] } }] },
        attack('ts-melee', 'Spellcasting Attack'), attack('ts-ranged', 'Spellcasting Attack'),
      ],
      effects: [enchantment(P.tsMelee, 'True Strike', [], { duration: { turns: 1 } }), enchantment(P.tsRanged, 'Ranged Weapon', [], { duration: { turns: 1 } })] },
    // Flame Blade, as dnd5e 6 makes it: on itself, for a slot, with concentration, four profiles.
    { id: 'flameblade', name: 'Flame Blade', sort: 23, type: 'spell', system: { level: 2, method: 'spell', properties: ['concentration'] },
      activities: [{ id: 'fb-enchant', type: 'enchant', name: 'Evoke Blade', activation: { type: 'bonus', value: 1 }, self: true, concentration: true,
        range: 'self', allowMagical: true, profiles: P.fb.map(_id => ({ _id })) }],
      effects: P.fb.map((_id, index) => enchantment(_id, `Flame Blade (Scimitar ${index + 1})`, [suffix(` ${index + 1}`)])) },
    // Darkness, as dnd5e 6 makes it: cast, then put on an object, of any kind.
    { id: 'darkness', name: 'Darkness', sort: 24, type: 'spell', system: { level: 2, method: 'spell', properties: ['concentration'] },
      activities: [
        { id: 'dark-cast', type: 'utility', name: 'Cast', affects: '' },
        { id: 'dark-object', type: 'enchant', name: 'Darken Object', restrictionType: '', profiles: [{ _id: P.dark }] },
      ],
      effects: [enchantment(P.dark, 'Darkness', [suffix(' (Darkness)')])] },
    // Sequester, as dnd5e 6 makes it: at a creature.
    { id: 'sequester', name: 'Sequester', sort: 25, type: 'spell', system: { level: 7, method: 'spell', properties: [] },
      activities: [{ id: 'seq-enchant', type: 'enchant', name: 'Sequester', affects: 'creature', count: 1, restrictionType: '', profiles: [{ _id: P.sequester }] }],
      effects: [enchantment(P.sequester, 'Sequestered', [])] },
    // Sacred Weapon, a 6.x-style activity, for a use of Channel Divinity (classes24/.../sacred-weapon.yml).
    { id: 'sacred', name: 'Sacred Weapon', sort: 30, type: 'feat', system: { properties: [] },
      activities: [{ id: 'sacred-enchant', type: 'enchant', name: 'Sacred Weapon', style6: true, activation: { type: 'special', value: null }, range: 'self',
        consumption: [{ type: 'itemUses', value: '1', target: 'chdiv' }], restrictionType: 'weapon', allowMagical: true, categories: ['simpleM', 'martialM'],
        profiles: [{ _id: P.sacred }] }],
      effects: [enchantment(P.sacred, 'Sacred Weapon', [suffix(', Sacred Weapon')], { duration: { seconds: 600 } })] },
    { id: 'chdiv', name: 'Channel Divinity', sort: 31, type: 'feat', system: { properties: [], uses: { max: 1, spent: 0 } }, activities: [] },
    // Pact of the Blade, whose weapon gets a Spellcasting Attack (classes24/.../pact-of-the-blade.yml).
    { id: 'pact', name: 'Pact of the Blade', sort: 32, type: 'feat', system: { properties: [] },
      activities: [
        { id: 'forge', type: 'enchant', name: 'Forge Pact Weapon', activation: { type: 'bonus', value: 1 }, range: 'self',
          restrictionType: 'weapon', allowMagical: true, categories: ['simpleM', 'martialM'], profiles: [{ _id: P.pact, riders: { activity: ['pact-attack'] } }] },
        attack('pact-attack', 'Spellcasting Attack'),
      ],
      effects: [enchantment(P.pact, 'Pact Weapon', [suffix(', Pact Weapon'), { key: 'system.properties', mode: 2, value: 'foc' }])] },
    // Eldritch Spear: a choice made once, with no activation.
    { id: 'spear', name: 'Eldritch Spear', sort: 33, type: 'feat', system: { properties: [] },
      activities: [{ id: 'spear-enchant', type: 'enchant', name: 'Eldritch Spear', activation: { type: '', value: null }, restrictionType: 'spell', profiles: [{ _id: 'spearprofile0001' }] }],
      effects: [enchantment('spearprofile0001', 'Eldritch Spear', [])] },
    // A self enchantment needing concentration, though it spends nothing: no switch.
    { id: 'glow', name: 'Glowing Focus', sort: 34, type: 'feat', system: { properties: [] },
      activities: [{ id: 'glow-on', type: 'enchant', name: 'Glow', activation: { type: 'bonus', value: 1 }, self: true, concentration: true,
        allowMagical: true, profiles: [{ _id: 'glowprofile00001' }] }],
      effects: [enchantment('glowprofile00001', 'Glowing', [suffix(' (Glowing)')])] },
    // A paladin's feature offering its profiles by paladin level, not character level.
    { id: 'edge', name: 'Blessed Edge', sort: 35, type: 'feat', system: { properties: [] },
      activities: [{ id: 'edge-enchant', type: 'enchant', name: 'Bless Weapon', activation: { type: 'bonus', value: 1 }, identifier: 'paladin',
        restrictionType: 'weapon', allowMagical: true, profiles: [{ _id: P.edgeA, level: { max: 2 } }, { _id: P.edgeB, level: { min: 3 } }] }],
      effects: [enchantment(P.edgeA, 'Blessed Edge', [suffix(' (Blessed)')]), enchantment(P.edgeB, 'Holy Edge', [suffix(' (Holy)')])] },
    // A ring not identified yet, with Ari's Darkness on it, and Bryn's Magic Weapon, as no player would see.
    { id: 'mystery', name: 'Plain Ring', sort: 10, type: 'equipment', system: { type: { value: 'trinket' }, properties: [], quantity: 1, identified: false },
      effects: [
        enchantment('ringdarkness0001', 'Darkness', [suffix(' (Darkness)')], {
          origin: 'Actor.ari.Item.darkness.Activity.dark-object', flags: { dnd5e: { enchantmentProfile: P.dark } },
        }),
        enchantment('ringbrynmw000001', 'Magic Weapon, +1', [], { origin: 'Actor.bryn.Item.brynmw.Activity.bryn-mw', flags: { dnd5e: { enchantmentProfile: P.mw1 } } }),
        // Ari's, from another item not identified yet, which would tell what that is.
        enchantment('ringmystflame001', 'Ablaze', [], { origin: 'Actor.ari.Item.mystflame.Activity.mf-engulf', flags: { dnd5e: { enchantmentProfile: P.mfAblaze } } }),
      ] },
    // A wand of magic missiles, as step3's: its spell's copy carries the enchantment dnd5e gives it.
    { id: 'mm-wand', name: 'Wand of Magic Missiles', sort: 9, type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 7, spent: 0 } },
      activities: [{ id: 'cast-mm', type: 'cast', spell: { level: 1 }, consumption: [{ type: 'itemUses', value: '1' }] }] },
    { id: 'mm', name: 'Magic Missile', sort: 40, type: 'spell', flags: { dnd5e: { cachedFor: '.Item.mm-wand.Activity.cast-mm' } },
      system: { level: 1, method: 'spell', properties: [] },
      activities: [{ id: 'mm-darts', type: 'damage', affects: 'creature', count: 3, damage: [{ number: 1, denomination: 4, bonus: '1', types: ['force'] }] }],
      effects: [enchantment(staticID('dnd5espellchanges'), 'Spell Changes', [], { origin: 'Actor.ari.Item.mm-wand.Activity.cast-mm' })] },
  ],
})
withEffects(ari, { level: 5, classes: { wizard: { levels: 5 }, paladin: { levels: 2 } } })

// Bryn, whose Magic Weapon is on Ari's club.
const bryn = add(new Actor5e({ id: 'bryn', name: 'Bryn', owners: ['bob'], mods: { wis: 3 } }))
// Ari's Magic Weapon is on Bryn's sword, applied from its card's tray.
equip(bryn, {
  spells: { spell2: { value: 2, max: 3, level: 2 } },
  items: [
    weapon('brynsword', 'Bryn\'s Sword', 1, 'martialM', [], {
      effects: [enchantment('arimwonbryn00001', 'Magic Weapon, +1', [rename('{}, +1'), mgc, bonus(1)], {
        origin: 'Actor.ari.Item.mweapon.Activity.mw', flags: { dnd5e: { enchantmentProfile: P.mw1 } },
      })],
    }),
    magicWeapon('brynmw', 'bryn-mw'),
  ],
})
withEffects(bryn, { level: 5 })
bryn.effects.set('brynconc00000001', new ActiveEffect5e({
  _id: 'brynconc00000001', name: 'Concentrating: Magic Weapon', statuses: ['concentrating'], origin: 'Actor.bryn.Item.brynmw',
  flags: { dnd5e: { item: { data: 'bryn-mw' } } },
}, bryn))

// A fight with Bryn in it, whom a use could be made at.
const fight = combat('fight')
combatant(fight, 'cb-bryn', bryn, { token: { id: 'tok-bryn', name: 'Bryn', uuid: 'Scene.scene.Token.tok-bryn', actor: bryn, hidden: false } })

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), wake: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
    // An app that takes moves too (module 0.31.0): a campaign that lets its players move things is
    // fetched for while its rolls aren't made here, and the rolls fetched then are refused.
    return announcing ? json({ features: { commands: true, transfers: 1 } }) : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
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
const pause = (ms = 20) => new Promise(resolve => realSetTimeout(resolve, ms))
async function send(command) {
  queue(command)
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const use = (item, activity, fields = {}) => send({
  id: `use-${++ids}`, actorId: 'ari', kind: 'use', item, activity, targets: [], slot: null, ...fields,
})
const end = (item, effect, fields = {}) => send({
  id: `end-${++ids}`, actorId: 'ari', kind: 'endEnchantment', mode: 0, explicit: false, extras: [], dice: [],
  enchantment: { item, effect }, ...fields,
})
const useCard = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.use === id)
const slots = () => Object.fromEntries(Object.entries(ari.system.spells).filter(([, pool]) => pool.max).map(([key, pool]) => [key, pool.value]))
const item = id => ari.items.get(id)
const enchantmentsOn = (id, origin) => [...item(id).effects.values()].filter(e => e.isAppliedEnchantment && (!origin || (e.origin === origin)))
const ORIGIN = { mw: 'Actor.ari.Item.mweapon.Activity.mw', engulf: 'Actor.ari.Item.flametongue.Activity.engulf', fb: 'Actor.ari.Item.flameblade.Activity.fb-enchant' }
const concentration = () => [...ari.effects.values()].filter(e => e.statuses.has('concentrating'))
const madeEnchantments = () => effectsMade.filter(made => made.data.type === 'enchantment').length
const workflowOf = id => midi.made.find(w => w.workflowOptions.sendingStone === id)
const nothingAsked = () => {
  assert.deepEqual(screen.notifications, [], 'nothing was said on the Gamemaster\'s screen')
  assert.deepEqual(globalThis.__dialogs ?? [], [], 'no dialog opened on the Gamemaster\'s screen')
  assert.deepEqual(screen.subsequent, [], 'nothing followed the use on the Gamemaster\'s screen')
}

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['ari', 'bryn'], rolls: true, attacks: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['bryn'], rolls: true, attacks: false },
])
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.equal(diceStatus.attacks, true, `attack self-test: ${diceStatus.attacksError}`)

const kinds = Object.fromEntries(app.events.filter(e => e.type === 'bridge.hello').map(e => [e.campaign.title, e.data.features.rolls.kinds]))
for (const [title, offered] of Object.entries(kinds)) {
  assert.equal(offered.includes('endEnchantment'), offered.includes('use'), title)
}
assert.ok(kinds.Ashlands.includes('endEnchantment') && !kinds.Mirkwood.includes('endEnchantment'))
ok('offers ending an enchantment exactly where uses are made')

// ---- The sheet ----
const sheetOf = () => characterSheet(ari)
const spells = sheet => sheet.spells.flatMap(section => section.spells)
const features = sheet => sheet.features.flatMap(section => section.features)
const inventory = sheet => [...sheet.inventory.sections.flatMap(section => section.items), ...sheet.inventory.containers]
const find = (list, id) => list.find(entry => entry.id === id)
let sheet = sheetOf()
// Ari's sheet follows Ashlands' hello in a post of its own.
const firstUpdate = () => app.events.find(e => (e.type === 'character.updated') && (e.campaign.title === 'Ashlands') && (e.data.character.id === 'ari'))
await until(firstUpdate, 'the sheet after the hello')
const hello = firstUpdate().data.character.sheet
assert.deepEqual(find(spells(hello), 'mweapon').activity, find(spells(sheet), 'mweapon').activity, 'the sheet after the hello is the same')

const weaponIds = ['longsword', 'club', 'quarterstaff', 'swordplus', 'flametongue', 'venom', 'greataxe', 'mystblade', 'mystflame', 'oldplus']
const mwActivity = find(spells(sheet), 'mweapon').activity
assert.deepEqual(mwActivity, {
  id: 'mw', type: 'enchant',
  targets: { self: false, area: false, count: null, perLevel: null, affects: null, fromSelf: false },
  enchant: {
    self: false, toggle: false,
    profiles: [
      { id: P.mw1, name: 'Magic Weapon, +1', min: null, max: 3 },
      { id: P.mw2, name: 'Magic Weapon, +2', min: 4, max: 5 },
      { id: P.mw3, name: 'Magic Weapon, +3', min: 6, max: null },
    ],
    items: ['longsword', 'quarterstaff'],
    applied: [],
  },
})
ok('Magic Weapon: every profile with its spell levels, and only the weapons that aren\'t magical, Bryn\'s club and a template\'s greataxe being so, nor the shield or Bryn\'s sword')

const shillelagh = find(spells(sheet), 'shillelagh')
assert.deepEqual(shillelagh.activity.enchant.profiles, [{ id: P.sh2, name: 'Shillelagh (1d10)', min: null, max: null }])
assert.deepEqual(shillelagh.activity.enchant.items, ['club', 'quarterstaff', 'venom'])
const trueStrike = find(spells(sheet), 'truestrike').activity.enchant
assert.equal(trueStrike.profiles.length, 2)
assert.deepEqual(trueStrike.items, weaponIds)
ok('Shillelagh offers its profile at Ari\'s level, on simple melee weapons, magical ones too; True Strike on any of Ari\'s ten weapons')

const flameTongue = find(inventory(sheet), 'flametongue')
assert.equal(flameTongue.activities[1].activity, null, 'the template\'s own enchantment, made once, is left to Foundry')
assert.deepEqual(flameTongue.activities[2].activity.enchant, {
  self: true, toggle: true, profiles: [{ id: P.ablaze, name: 'Ablaze', min: null, max: null }], items: [], applied: [],
})
assert.equal(find(inventory(sheet), 'venom').activities[1].activity.enchant.toggle, false, 'Coat Blade spends a use')
const flameBlade = find(spells(sheet), 'flameblade').activity.enchant
assert.equal(flameBlade.toggle, false, 'Flame Blade takes a slot and concentration')
assert.deepEqual(flameBlade.profiles.map(({ min, max }) => [min, max]), [[null, null], [null, null], [null, null], [null, null]])
ok('Engulf in Flames is a switch; Coat Blade and Flame Blade, which spend something, aren\'t')

const darkness = find(spells(sheet), 'darkness').activities[1].activity.enchant
const listed = new Set(inventory(sheet).map(entry => entry.id))
assert.ok(darkness.items.length && darkness.items.every(id => listed.has(id)), JSON.stringify(darkness.items))
assert.deepEqual(darkness.items, ['longsword', 'quarterstaff', 'shieldtpl', 'mm-wand', 'mystery', 'mwscroll', 'oil'])
assert.equal(find(features(sheet), 'glow').activity.enchant.toggle, false, 'one taking concentration is no switch')
const sacred = find(features(sheet), 'sacred').activity
assert.equal(sacred.targets.self, true)
assert.equal(sacred.enchant.self, false)
assert.deepEqual(sacred.enchant.items, weaponIds)
assert.ok(!find(features(sheet), 'spear').activity, 'Eldritch Spear, chosen once, is left to Foundry')
assert.ok(!find(inventory(sheet), 'shieldtpl').activity, 'a magic item\'s template is left to Foundry')
ok('Darkness offers only what the Inventory tab lists; Sacred Weapon enchants a weapon, though used on its user; no activity for Eldritch Spear or a template')

assert.deepEqual(find(inventory(sheet), 'club').enchantments, [{
  id: 'brynmwonclub0001', name: 'Magic Weapon, +1', source: 'Magic Weapon', concentration: true, duration: null, expired: false, endable: true,
}])
assert.equal(find(inventory(sheet), 'greataxe').enchantments[0].endable, false)
assert.equal(find(inventory(sheet), 'greataxe').enchantments[0].source, null)
assert.equal(find(spells(sheet), 'mm').enchantments, undefined, 'the wand\'s Magic Missile carries none an enchant activity applied')
assert.equal(find(inventory(sheet), 'longsword').enchantments, undefined)
assert.deepEqual(find(inventory(sheet), 'mystery').enchantments.map(e => [e.id, e.endable]), [['ringdarkness0001', true]],
  'on a ring not identified yet, Ari\'s own from an item she knows is listed; Bryn\'s not, nor hers from an item not identified yet')
assert.equal(effectReads.count, 0, 'no 6.x profile\'s effect was read')
// Sacred Weapon is listed among the features and the actions: each item is asked about once a sheet.
const asked = new Map()
const count = (activity, enchanted) => {
  if (activity.id !== 'sacred-enchant') return
  asked.set(enchanted.id, (asked.get(enchanted.id) ?? 0) + 1)
}
Hooks.on('dnd5e.canEnchant', count)
const twice = sheetOf()
Hooks.off('dnd5e.canEnchant', count)
assert.ok(find(features(twice), 'sacred').activity && twice.actions.some(section => section.actions.some(action => action.id === 'sacred')))
assert.ok(asked.size >= weaponIds.length)
assert.ok([...asked.values()].every(times => times === 1), JSON.stringify([...asked]))
ok('the club carries Bryn\'s Magic Weapon, tied to Bryn\'s concentration, which Ari may end as its owner; not the greataxe\'s template; the spell copy\'s changes aren\'t one; Ari\'s Magic Weapon on Bryn\'s sword isn\'t Ari\'s to list; a ring not identified yet shows only Ari\'s own')

// Magic Weapon 2024's profiles by the level it's cast at; the scroll's by Ari's level, as dnd5e's
// scrolls have it; a paladin's feature's by paladin level.
assert.deepEqual(find(spells(sheet), 'mw24').activity.enchant.profiles.map(({ id, min, max }) => [id, min, max]),
  [[P.mw24[0], 2, 2], [P.mw24[1], 3, 5], [P.mw24[2], 6, null]])
assert.equal(find(spells(sheet), 'mw24').activity.enchant.toggle, false)
assert.deepEqual(find(inventory(sheet), 'mwscroll').activity.enchant.profiles, [{ id: P.mw2, name: 'Magic Weapon, +2', min: null, max: null }])
assert.deepEqual(find(features(sheet), 'edge').activity.enchant.profiles, [{ id: P.edgeA, name: 'Blessed Edge', min: null, max: null }])
ok('Magic Weapon 2024 offers each profile with its spell levels; its scroll the +2 at Ari\'s 5th level; a paladin\'s feature by Ari\'s two paladin levels, not the character\'s five')

// What's on the items: a +1 whose activity is gone for good, a dnd5e 6 Shillelagh, items not
// identified yet.
const { ownPrior } = await import(`${MODULE}/scripts/sheet-enchant.mjs`)
assert.deepEqual(find(inventory(sheet), 'oldplus').enchantments, [{
  id: 'oldplusone000001', name: 'Weapon +1', source: null, concentration: false, duration: null, expired: false, endable: false,
}], 'not one with no profile, nor one with a spell copy\'s changes\' id')
assert.deepEqual(find(inventory(sheet), 'swordplus').enchantments.map(e => [e.id, e.expired, e.endable]), [['truestrikeover01', true, true]],
  'one dnd5e 6 says is over, though its turn is left')
const venomEntry = find(inventory(sheet), 'venom')
assert.deepEqual(find(venomEntry.enchantments, 'sixshillelagh001'), {
  id: 'sixshillelagh001', name: 'Shillelagh (1d10)', source: 'Shillelagh', concentration: false, duration: '1 Minute', expired: false, endable: true,
})
assert.deepEqual(ownPrior(item('shillelagh').system.activities.get('imbue'), item('venom')).map(e => e.id), ['sixshillelagh001'])
assert.deepEqual(find(spells(sheet), 'shillelagh').activity.enchant.applied, [{ item: 'venom', effect: 'sixshillelagh001', profile: P.sh2 }])
assert.ok(find(features(sheet), 'pact').activity.enchant.items.includes('mystblade'), 'Pact of the Blade on the sword not identified yet')
assert.equal(find(inventory(sheet), 'mystblade').name, 'Strange Sword')
assert.equal(find(inventory(sheet), 'mystflame').enchantments, undefined, 'its own Ablaze would tell what it is')
for (const told of [sheet, hello]) {
  const text = JSON.stringify(told)
  for (const secret of ['Vorpal Sword', 'Flame Tongue Shortsword']) assert.ok(!text.includes(secret), secret)
}
ok('a +1 whose activity is gone for good can\'t be ended, and none no enchant activity applied is listed; a dnd5e 6 Shillelagh is Ari\'s, endable and replaced as it\'s cast again; a dnd5e 6 True Strike that\'s over says so; items not identified yet keep their names, the Flame Tongue its Ablaze')

// ---- Using them ----
const updatedSheets = () => app.events.filter(e => (e.type === 'character.updated') && (e.data.character.id === 'ari'))
// Ari's sheet as the app last had it when it was told what became of a command.
const sheetBefore = id => {
  const told = app.events.findIndex(e => (e.type === 'command.result') && (e.data.id === id))
  return app.events.slice(0, told).filter(e => (e.type === 'character.updated') && (e.data.character.id === 'ari')).at(-1)?.data.character.sheet
}
const engulfApplied = told => find(inventory(told), 'flametongue').activities[2].activity.enchant.applied
if (!MIDI) {
  const oiled = await use('oil', 'apply-oil', { enchant: { profile: P.oiled, item: 'longsword' } })
  assert.equal(oiled.status, 'done', JSON.stringify(oiled))
  assert.equal(item('oil'), undefined, 'the oil, used up, is gone')
  const [oil] = enchantmentsOn('longsword', 'Actor.ari.Item.oil.Activity.apply-oil')
  assert.deepEqual(oiled.enchantment, {
    enchanted: { item: 'longsword', itemName: 'Longsword', effect: oil.id, profile: P.oiled, name: 'Oiled' }, ended: null,
  })
  assert.equal(item('longsword').name, 'Longsword Oiled')
  assert.deepEqual(find(inventory(sheetOf()), 'longsword').enchantments, [{
    id: oil.id, name: 'Oiled', source: null, concentration: false, duration: '1 Minute', expired: false, endable: true,
  }])
  assert.equal(find(inventory(sheetOf()), 'oil'), undefined)
  const unoiled = await end('longsword', oil.id)
  assert.equal(unoiled.status, 'done', JSON.stringify(unoiled))
  assert.deepEqual(unoiled.enchantment.ended, { item: 'longsword', itemName: 'Longsword', effect: oil.id, name: 'Oiled' })
  assert.equal(item('longsword').name, 'Longsword')
  ok('an Oil of Sharpness on the longsword is used up, and its Oiled, whose oil is gone, is listed for a minute and ended from the app')

  const mw = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'longsword' } })
  assert.equal(mw.status, 'done', JSON.stringify(mw))
  const card = useCard(mw.id)
  assert.equal(mw.messageId, card.id)
  assert.equal(mw.visible, true)
  assert.deepEqual([mw.use, mw.damage, mw.rolls], [{ type: 'enchant' }, null, []])
  const [applied] = enchantmentsOn('longsword', ORIGIN.mw)
  assert.deepEqual(mw.enchantment, {
    enchanted: { item: 'longsword', itemName: 'Longsword', effect: applied.id, profile: P.mw1, name: 'Magic Weapon, +1' }, ended: null,
  })
  assert.equal(applied.getFlag('dnd5e', 'enchantmentProfile'), P.mw1)
  const [focus] = concentration()
  assert.equal(applied.getFlag('dnd5e', 'dependentOn'), focus.uuid, 'tied to the live concentration on Ari')
  assert.equal(card.system.concentration, focus.id)
  assert.equal(effectsMade.find(made => made.data._id === applied.id).options.chatMessageOrigin, card.id)
  assert.equal(card.getFlag('dnd5e', 'use.enchantmentProfile'), P.mw1)
  assert.deepEqual(card.flags.dnd5e.targets, [])
  assert.equal(slots().spell2, 11)
  assert.equal(item('longsword').name, 'Longsword, +1')
  sheet = sheetOf()
  assert.deepEqual(find(inventory(sheet), 'longsword').enchantments, [{
    id: applied.id, name: 'Magic Weapon, +1', source: 'Magic Weapon', concentration: true, duration: null, expired: false, endable: true,
  }])
  assert.equal(find(inventory(sheet), 'longsword').name, 'Longsword, +1')
  assert.deepEqual(find(spells(sheet), 'mweapon').activity.enchant.applied, [{ item: 'longsword', effect: applied.id, profile: P.mw1 }])
  assert.deepEqual(find(spells(sheet), 'mweapon').activity.enchant.items, ['longsword', 'quarterstaff'], 'cast again, it replaces its own')
  await until(() => updatedSheets().some(e => inventory(e.data.character.sheet).some(entry => entry.name === 'Longsword, +1')), 'the sheet sent again')
  nothingAsked()
  ok('Magic Weapon on the longsword: its card, its slot, tied to Ari\'s concentration, as the tray would apply it, and the sheet shows Longsword, +1')

  const tooHigh = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw2, item: 'longsword' } })
  assert.deepEqual([tooHigh.status, tooHigh.reason], ['failed', 'profile'])
  assert.equal(useCard(tooHigh.id), undefined)
  assert.equal(slots().spell2, 11)
  ok('a profile not offered at the level cast is refused before anything is spent')

  const again = await use('mweapon', 'mw', { slot: 'spell3', enchant: { profile: P.mw1, item: 'longsword' } })
  assert.equal(again.status, 'done', JSON.stringify(again))
  await pause()
  const left = enchantmentsOn('longsword', ORIGIN.mw)
  assert.equal(left.length, 1, 'replaced, not stacked')
  assert.equal(left[0].id, again.enchantment.enchanted.effect)
  assert.deepEqual(again.enchantment.ended, { item: 'longsword', itemName: 'Longsword', effect: applied.id, name: 'Magic Weapon, +1' })
  assert.equal(slots().spell3, 3)
  assert.equal(concentration().length, 1)
  assert.equal(left[0].getFlag('dnd5e', 'dependentOn'), concentration()[0].uuid)
  ok('Magic Weapon cast again at 3rd level on the longsword replaces the first, its concentration with it')

  const before = slots()
  for (const [fields, reason] of [
    [{ enchant: { profile: P.mw1, item: 'swordplus' } }, 'enchant-target'],
    [{ enchant: { profile: P.mw1, item: 'brynsword' } }, 'enchant-target'],
    [{ enchant: { profile: P.mw1, item: 'quarterstaff' }, targets: [{ combatId: 'fight', combatantId: 'cb-bryn' }] }, 'target'],
    // An enchantment is used at no one, its user neither (module 0.22.0).
    [{ enchant: { profile: P.mw1, item: 'quarterstaff' }, self: true }, 'target'],
    [{ enchant: { profile: P.mw1, item: 'shieldtpl' } }, 'enchant-target'],
  ]) {
    const refused = await use('mweapon', 'mw', { slot: 'spell2', ...fields })
    assert.deepEqual([refused.status, refused.reason], ['failed', reason], JSON.stringify(fields))
    assert.equal(useCard(refused.id), undefined)
  }
  assert.deepEqual(slots(), before, 'nothing spent')
  const otherItem = await use('flametongue', 'engulf', { enchant: { profile: P.ablaze, item: 'longsword' } })
  assert.deepEqual([otherItem.status, otherItem.reason], ['failed', 'enchant-target'], 'one on its own item takes no other')
  ok('a magical sword, Bryn\'s sword, a shield or any target is refused, spending nothing')

  const made = madeEnchantments()
  const onCard = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1 } })
  assert.equal(onCard.status, 'done', JSON.stringify(onCard))
  assert.ok(useCard(onCard.id))
  assert.equal(onCard.messageId, useCard(onCard.id).id)
  assert.deepEqual(onCard.enchantment, { enchanted: null, ended: null })
  assert.equal(madeEnchantments(), made, 'nothing applied')
  ok('Magic Weapon with no item chosen posts its card, with its tray, for an ally\'s weapon')

  const crafted = await use('mweapon', 'mw', { slot: 'spell4' })
  assert.equal(crafted.status, 'done', JSON.stringify(crafted))
  assert.equal(useCard(crafted.id).getFlag('dnd5e', 'use.enchantmentProfile'), P.mw2, 'dnd5e\'s own choice at 4th level, +2')
  assert.deepEqual(crafted.enchantment, { enchanted: null, ended: null })
  const third = await use('mweapon', 'mw', { slot: 'spell3', enchant: { profile: P.mw1 } })
  assert.equal(third.status, 'done', JSON.stringify(third))
  const spentBefore = slots()
  const fourth = await use('mweapon', 'mw', { slot: 'spell4', enchant: { profile: P.mw1 } })
  assert.deepEqual([fourth.status, fourth.reason], ['failed', 'profile'])
  assert.equal(useCard(fourth.id), undefined)
  assert.deepEqual(slots(), spentBefore, 'no slot spent')
  const low24 = await use('mw24', 'mw24-enchant', { slot: 'spell2', enchant: { profile: P.mw24[1] } })
  assert.deepEqual([low24.status, low24.reason], ['failed', 'profile'])
  assert.deepEqual(slots(), spentBefore)
  const mw24 = await use('mw24', 'mw24-enchant', { slot: 'spell3' })
  assert.equal(mw24.status, 'done', JSON.stringify(mw24))
  assert.equal(useCard(mw24.id).getFlag('dnd5e', 'use.enchantmentProfile'), P.mw24[1])
  ok('a use with no profile has dnd5e\'s own at its level; a profile is offered only at the levels it\'s for, the 2014 +1 to 3rd, the 2024 +2 from 3rd, refused otherwise, spending nothing')

  settings.set('disableConcentration', true)
  const free = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'quarterstaff' } })
  settings.set('disableConcentration', false)
  assert.equal(free.status, 'done', JSON.stringify(free))
  const [unlinked] = enchantmentsOn('quarterstaff', ORIGIN.mw)
  assert.equal(unlinked.getFlag('dnd5e', 'dependentOn'), undefined)
  ok('with concentration turned off, Magic Weapon is applied tied to none')

  const refuse = Hooks.on('dnd5e.preBeginConcentrating', () => false)
  const unfocused = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'longsword' } })
  Hooks.off('dnd5e.preBeginConcentrating', refuse)
  assert.equal(unfocused.status, 'done', JSON.stringify(unfocused))
  assert.equal(enchantmentsOn('longsword', ORIGIN.mw)[0].getFlag('dnd5e', 'dependentOn'), undefined)
  assert.equal(useCard(unfocused.id).system?.concentration, undefined)
  Hooks.once('dnd5e.postUseActivity', (activity, config, used) => { ari.effects.get(used.message?.system?.concentration)?.delete() })
  const spent = slots().spell2
  const broken = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'quarterstaff' } })
  assert.deepEqual([broken.status, broken.reason], ['failed', 'enchant'], JSON.stringify(broken))
  // dnd5e's card shows no tray once the concentration it names has ended, and its tray refuses it:
  // the Gamemaster can't apply it from there either, so the player is told of no card.
  assert.ok(useCard(broken.id), 'its card is posted')
  assert.deepEqual([broken.messageId, broken.visible], [null, true], 'no card to apply it from')
  assert.deepEqual([broken.use, broken.enchantment], [{ type: 'enchant' }, null])
  assert.equal(slots().spell2, spent - 1, 'spent')
  assert.equal(enchantmentsOn('quarterstaff', ORIGIN.mw)[0].id, unlinked.id, 'the quarterstaff keeps what it had')
  ok('a module stopping the concentration applies it tied to none; one the card names that has ended isn\'t applied, as dnd5e\'s tray has it, nor named as a card to apply it from')

  const quiet = (activity, config) => { config.create = false }
  Hooks.on('dnd5e.preCreateUsageMessage', quiet)
  const madeBefore = madeEnchantments()
  const cardless = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'quarterstaff' } })
  Hooks.off('dnd5e.preCreateUsageMessage', quiet)
  assert.deepEqual(cardless, {
    id: cardless.id, status: 'failed', reason: 'enchant', error: null, messageId: null, visible: true, rolls: [],
    use: { type: 'enchant' }, damage: null, enchantment: null,
  })
  assert.equal(madeEnchantments(), madeBefore, 'nothing applied with no card for its riders')
  assert.equal(enchantmentsOn('quarterstaff', ORIGIN.mw)[0].id, unlinked.id)
  ok('a module stopping dnd5e\'s card leaves the enchantment unapplied, the player told so with no card')

  const sacredUse = await use('sacred', 'sacred-enchant', { enchant: { profile: P.sacred, item: 'longsword' } })
  assert.equal(sacredUse.status, 'done', JSON.stringify(sacredUse))
  assert.equal(item('chdiv').system.uses.spent, 1, 'Channel Divinity 1 → 0')
  assert.deepEqual(enchantmentsOn('longsword', 'Actor.ari.Item.sacred.Activity.sacred-enchant').map(e => e.name), ['Sacred Weapon'])
  assert.equal(effectReads.count, 0, 'no 6.x profile\'s effect was read')
  ok('Sacred Weapon on the longsword spends Channel Divinity, its 6.x profile found by its uuid')

  // Deleted by something else, as Times Up or the Gamemaster would.
  const [holy] = enchantmentsOn('longsword', 'Actor.ari.Item.sacred.Activity.sacred-enchant')
  const sentBefore = updatedSheets().length
  await item('longsword').effects.get(holy.id).delete()
  sheet = sheetOf()
  assert.equal(find(find(inventory(sheet), 'longsword').enchantments ?? [], holy.id), undefined)
  assert.deepEqual(find(features(sheet), 'sacred').activity.enchant.applied, [])
  await until(() => updatedSheets().length > sentBefore, 'the sheet sent again')
  assert.equal(find(find(inventory(updatedSheets().at(-1).data.character.sheet), 'longsword').enchantments ?? [], holy.id), undefined)
  ok('an enchantment deleted in Foundry, as Times Up would, is gone from the next sheet')

  const pact = await use('pact', 'forge', { enchant: { profile: P.pact, item: 'quarterstaff' } })
  assert.equal(pact.status, 'done', JSON.stringify(pact))
  const pactWeapon = enchantmentsOn('quarterstaff', 'Actor.ari.Item.pact.Activity.forge')[0]
  const rider = item('quarterstaff')._source.activities.find(data => data.flags?.dnd5e?.dependentOn === pactWeapon.id)
  assert.equal(rider?.name, 'Spellcasting Attack', 'the rider attack is on the quarterstaff')
  assert.ok(item('quarterstaff').system.activities.get(rider.id))
  const pactEnded = await end('quarterstaff', pactWeapon.id)
  assert.equal(pactEnded.status, 'done', JSON.stringify(pactEnded))
  assert.equal(item('quarterstaff').effects.has(pactWeapon.id), false)
  ok('Pact of the Blade adds its attack to the quarterstaff, from its card; ending it takes it away')

  const strange = await use('pact', 'forge', { enchant: { profile: P.pact, item: 'mystblade' } })
  assert.equal(strange.status, 'done', JSON.stringify(strange))
  assert.equal(strange.enchantment.enchanted.itemName, 'Strange Sword')
  assert.ok(!JSON.stringify(strange).includes('Vorpal'), JSON.stringify(strange))
  const strangeEnded = await end('mystblade', strange.enchantment.enchanted.effect)
  assert.equal(strangeEnded.status, 'done', JSON.stringify(strangeEnded))
  assert.equal(strangeEnded.enchantment.ended.itemName, 'Strange Sword')
  assert.ok(!JSON.stringify(strangeEnded).includes('Vorpal'))
  ok('Pact of the Blade on a sword not identified yet names it as its player knows it, a Strange Sword')

  const ablaze = await use('flametongue', 'engulf', { enchant: { profile: P.ablaze } })
  assert.equal(ablaze.status, 'done', JSON.stringify(ablaze))
  assert.ok(useCard(ablaze.id))
  const [fire] = enchantmentsOn('flametongue', ORIGIN.engulf)
  assert.deepEqual(ablaze.enchantment, {
    enchanted: { item: 'flametongue', itemName: 'Flame Tongue Longsword', effect: fire.id, profile: P.ablaze, name: 'Ablaze' }, ended: null,
  })
  assert.equal(item('flametongue').name, 'Flame Tongue Longsword (Ablaze)')
  assert.deepEqual(find(inventory(sheetOf()), 'flametongue').activities[2].activity.enchant.applied, [{ item: 'flametongue', effect: fire.id, profile: P.ablaze }])
  // The app has the sheet with it alight before it's told so, so a switch turned straight back is
  // checked against that.
  assert.deepEqual(engulfApplied(sheetBefore(ablaze.id)), [{ item: 'flametongue', effect: fire.id, profile: P.ablaze }])
  const out = await end('flametongue', fire.id)
  assert.deepEqual(out, {
    id: out.id, status: 'done', reason: null, error: null, messageId: null, visible: true, rolls: [],
    enchantment: { enchanted: null, ended: { item: 'flametongue', itemName: 'Flame Tongue Longsword', effect: fire.id, name: 'Ablaze' } },
  })
  assert.deepEqual(engulfApplied(sheetBefore(out.id)), [], 'and with it out before it\'s told that')
  const relit = await use('flametongue', 'engulf', { enchant: { profile: P.ablaze } })
  assert.equal(relit.status, 'done')
  const [flame] = enchantmentsOn('flametongue', ORIGIN.engulf)
  for (const fields of [{ enchant: { profile: P.ablaze } }, {}]) {
    const lit = await use('flametongue', 'engulf', fields)
    assert.deepEqual(lit, { id: lit.id, status: 'failed', reason: 'applied', error: null, messageId: null, visible: false, rolls: [] })
    assert.equal(useCard(lit.id), undefined, 'no card')
    assert.deepEqual(enchantmentsOn('flametongue', ORIGIN.engulf).map(e => e.id), [flame.id], 'still alight')
  }
  ok('Engulf in Flames lights the Flame Tongue, with a card, the sheet with it alight sent first; ended from the app, the sheet first again; lit again; and a use with its profile, chosen or dnd5e\'s, is refused, never putting it out')

  const coat = await use('venom', 'coat', { enchant: { profile: P.coat } })
  assert.equal(coat.status, 'done', JSON.stringify(coat))
  assert.equal(item('venom').system.uses.spent, 1)
  const [poison] = enchantmentsOn('venom', 'Actor.ari.Item.venom.Activity.coat')
  assert.equal(poison.name, 'Poison Coat')
  const coated = await use('venom', 'coat', { enchant: { profile: P.coat } })
  assert.deepEqual([coated.status, coated.reason], ['failed', 'applied'], 'refused for being on it, before what it spends is looked at')
  item('venom').updateSource({ 'system.uses.spent': 0 })
  const recovered = await use('venom', 'coat', { enchant: { profile: P.coat } })
  assert.deepEqual([recovered.status, recovered.reason], ['failed', 'applied'])
  assert.equal(item('venom').system.uses.spent, 0, 'its use kept')
  assert.equal(useCard(recovered.id), undefined)
  assert.deepEqual(enchantmentsOn('venom', 'Actor.ari.Item.venom.Activity.coat').map(e => e.id), [poison.id])
  assert.equal((await end('venom', poison.id)).status, 'done')
  item('venom').updateSource({ 'system.uses.spent': 1 })
  const empty = await use('venom', 'coat', { enchant: { profile: P.coat } })
  assert.deepEqual([empty.status, empty.reason], ['failed', 'consume'])
  ok('Coat Blade spends the dagger\'s use; used again while on, even with its use back, it\'s refused, spending nothing; ended from the app; with no use left it\'s refused')

  const blade = await use('flameblade', 'fb-enchant', { slot: 'spell2', enchant: { profile: P.fb[0] } })
  assert.equal(blade.status, 'done', JSON.stringify(blade))
  const [first] = enchantmentsOn('flameblade', ORIGIN.fb)
  Hooks.once('dnd5e.preUseActivity', () => { ari.items.get('flameblade').effects.get(first.id)?.delete() })
  const swapped = await use('flameblade', 'fb-enchant', { slot: 'spell2', enchant: { profile: P.fb[1] } })
  assert.equal(swapped.status, 'done', JSON.stringify(swapped))
  await pause()
  assert.deepEqual(enchantmentsOn('flameblade', ORIGIN.fb).map(e => e.getFlag('dnd5e', 'enchantmentProfile')), [P.fb[1]])
  assert.equal(swapped.enchantment.ended.effect, first.id)
  const swappedAgain = await use('flameblade', 'fb-enchant', { slot: 'spell2', enchant: { profile: P.fb[2] } })
  assert.equal(swappedAgain.status, 'done', JSON.stringify(swappedAgain))
  await pause()
  assert.deepEqual(enchantmentsOn('flameblade', ORIGIN.fb).map(e => e.getFlag('dnd5e', 'enchantmentProfile')), [P.fb[2]])
  ok('Flame Blade with another profile replaces its own, even where it\'s gone already, or going with the concentration it ends')

  let failing = false
  const fail = (activity, enchanted, errors) => { if (failing) errors.push(new Error('not now')) }
  Hooks.on('dnd5e.canEnchant', fail)
  Hooks.once('dnd5e.postUseActivity', () => { failing = true })
  const late = await use('shillelagh', 'imbue', { enchant: { profile: P.sh2, item: 'club' } })
  Hooks.off('dnd5e.canEnchant', fail)
  assert.deepEqual([late.status, late.reason], ['failed', 'enchant'], JSON.stringify(late))
  assert.equal(late.messageId, useCard(late.id).id)
  // Under dnd5e 6, whose effects aren't asked again as they're made, the module's own asking stops it.
  createRules.checkCanEnchant = false
  failing = false
  Hooks.on('dnd5e.canEnchant', fail)
  Hooks.once('dnd5e.postUseActivity', () => { failing = true })
  const late6 = await use('shillelagh', 'imbue', { enchant: { profile: P.sh2, item: 'club' } })
  Hooks.off('dnd5e.canEnchant', fail)
  createRules.checkCanEnchant = true
  assert.deepEqual([late6.status, late6.reason], ['failed', 'enchant'], JSON.stringify(late6))
  // A module that changes the profile as it's used: the card's tray is for that one, not the player's.
  Hooks.once('dnd5e.preUseActivity', (activity, config) => { config.enchantmentProfile = P.tsRanged })
  const changed = await use('truestrike', 'strike-enchant', { enchant: { profile: P.tsMelee, item: 'longsword' } })
  assert.deepEqual([changed.status, changed.reason], ['failed', 'enchant'], JSON.stringify(changed))
  assert.equal(useCard(changed.id).getFlag('dnd5e', 'use.enchantmentProfile'), P.tsRanged)
  assert.equal(enchantmentsOn('longsword', 'Actor.ari.Item.truestrike.Activity.strike-enchant').length, 0)
  Hooks.once('dnd5e.preApplyEnchantment', () => false)
  const stopped = await use('shillelagh', 'imbue', { enchant: { profile: P.sh2, item: 'club' } })
  assert.deepEqual([stopped.status, stopped.reason], ['failed', 'enchant'], JSON.stringify(stopped))
  assert.equal(stopped.messageId, useCard(stopped.id).id)
  assert.equal(enchantmentsOn('club', 'Actor.ari.Item.shillelagh.Activity.imbue').length, 0)
  ok('an item dnd5e no longer lets take it once the card is posted, under dnd5e 5 or 6, a card for another profile, or a module stopping it, leaves it on the card')

  const club = await use('shillelagh', 'imbue', { enchant: { profile: P.sh2, item: 'club' } })
  assert.equal(club.status, 'done', JSON.stringify(club))
  const [stick] = enchantmentsOn('club', 'Actor.ari.Item.shillelagh.Activity.imbue')
  let listedStick = find(find(inventory(sheetOf()), 'club').enchantments, stick.id)
  assert.deepEqual(listedStick, { id: stick.id, name: 'Shillelagh (1d10)', source: 'Shillelagh', concentration: false, duration: '1 Minute', expired: false, endable: true })
  item('club')._source.effects.find(data => data._id === stick.id).duration.remaining = 0
  item('club').updateSource({})
  listedStick = find(find(inventory(sheetOf()), 'club').enchantments, stick.id)
  assert.equal(listedStick.expired, true)
  ok('Shillelagh on the club lasts a minute; one whose time is up, which dnd5e 5 leaves, says so')

  const again6 = await use('shillelagh', 'imbue', { enchant: { profile: P.sh2, item: 'venom' } })
  assert.equal(again6.status, 'done', JSON.stringify(again6))
  assert.equal(again6.enchantment.ended.effect, 'sixshillelagh001')
  assert.deepEqual(enchantmentsOn('venom', 'Actor.ari.Item.shillelagh.Activity.imbue').map(e => e.id), [again6.enchantment.enchanted.effect])
  ok('Shillelagh cast again on the dagger replaces the one dnd5e 6 made, its origin in system.origin alone')

  // Ari concentrates on the spell's +1 on the longsword, then reads a scroll of the same spell.
  const spell = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'longsword' } })
  assert.equal(spell.status, 'done', JSON.stringify(spell))
  const plusOne = spell.enchantment.enchanted.effect
  assert.equal(item('longsword').name, 'Longsword, +1')
  sheet = sheetOf()
  assert.ok(find(inventory(sheet), 'mwscroll').activity.enchant.items.includes('longsword'), 'its +1 goes with the concentration the scroll ends')
  // The +1 on its way out as the active Gamemaster deletes what's tied to the concentration the
  // scroll ends, as soon as it ends, without waiting (active-effect.mjs:669): still on the longsword
  // a while, as the deletion goes to the server and back, deleting it again meanwhile refused.
  const deleteOf = ActiveEffect5e.prototype.delete
  let going = null
  let deletedAgain = 0
  ActiveEffect5e.prototype.delete = function (options) {
    if (this.id !== plusOne) return deleteOf.call(this, options)
    if (going) {
      deletedAgain++
      return Promise.reject(new Error(`ActiveEffect ${this.id} is being deleted`))
    }
    const { parent, id } = this
    going = new Promise(resolve => realSetTimeout(resolve, 300)).then(() => deleteOf.call(parent.effects.get(id) ?? this, options))
    return going
  }
  const ending = effect => {
    if (effect.statuses?.has('concentrating')) item('longsword').effects.get(plusOne)?.delete().catch(() => null)
  }
  Hooks.on('deleteActiveEffect', ending)
  let applying = null
  const fromScrollMade = enchanted => { if (enchanted.origin === 'Actor.ari.Item.mwscroll.Activity.scroll-mw') applying ??= item('longsword').effects.has(plusOne) }
  Hooks.on('createActiveEffect', fromScrollMade)
  let scroll
  try {
    scroll = await use('mwscroll', 'scroll-mw', { enchant: { profile: P.mw2, item: 'longsword' } })
  } finally {
    ActiveEffect5e.prototype.delete = deleteOf
    Hooks.off('deleteActiveEffect', ending)
    Hooks.off('createActiveEffect', fromScrollMade)
  }
  assert.equal(scroll.status, 'done', JSON.stringify(scroll))
  assert.ok(deletedAgain > 0, 'the +1 was still going as the scroll\'s was to be applied')
  assert.equal(applying, false, 'the scroll\'s applied once the +1 had gone')
  await pause()
  assert.equal(item('mwscroll'), undefined, 'the scroll, read, is gone')
  assert.deepEqual(scroll.enchantment.ended, { item: 'longsword', itemName: 'Longsword', effect: plusOne, name: 'Magic Weapon, +1' })
  assert.equal(item('longsword').effects.has(plusOne), false)
  const fromScroll = enchantmentsOn('longsword', 'Actor.ari.Item.mwscroll.Activity.scroll-mw')
  assert.deepEqual(fromScroll.map(e => e.id), [scroll.enchantment.enchanted.effect])
  assert.equal(enchantmentsOn('longsword', ORIGIN.mw).length, 0)
  assert.equal(concentration().length, 1)
  assert.equal(fromScroll[0].getFlag('dnd5e', 'dependentOn'), concentration()[0].uuid)
  assert.equal(item('longsword').name, 'Longsword, +2')
  assert.deepEqual(find(find(inventory(sheetOf()), 'longsword').enchantments, fromScroll[0].id), {
    id: fromScroll[0].id, name: 'Magic Weapon, +2', source: null, concentration: true, duration: null, expired: false, endable: true,
  })
  ok('a scroll of Magic Weapon read while concentrating on the spell\'s +1 on the longsword makes it +2, the +1 going with the concentration it ends, as in Foundry, waited for while it goes')
}

// ---- Through Midi-QOL ----
if (MIDI) {
  const mw = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'longsword' } })
  assert.equal(mw.status, 'done', JSON.stringify(mw))
  const card = useCard(mw.id)
  const workflow = workflowOf(mw.id)
  assert.ok(workflow, 'a workflow')
  const [focus] = concentration()
  assert.equal(card.system.concentration, focus.id, 'the workflow named the concentration it began on the card')
  const [applied] = enchantmentsOn('longsword', ORIGIN.mw)
  assert.equal(applied.getFlag('dnd5e', 'dependentOn'), focus.uuid)
  assert.deepEqual(midi.usages.at(-1).usage.concentration, { begin: true, end: null })
  ok('Magic Weapon through Midi-QOL: its workflow begins concentration once its checks pass, and the enchantment is tied to it')

  const made = madeEnchantments()
  midiEnchant.skipPreamble = true
  const skipped = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'quarterstaff' } })
  midiEnchant.skipPreamble = false
  assert.deepEqual([skipped.status, skipped.reason], ['failed', 'midi'], JSON.stringify(skipped))
  assert.equal(skipped.messageId, useCard(skipped.id).id)
  assert.equal(madeEnchantments(), made)
  ok('a workflow that never begins the concentration it needs leaves the enchantment on the card')

  // The concentration the workflow begins ended at once, as by another module: its card has no tray.
  Hooks.once('dnd5e.beginConcentrating', (actor, item, effect) => { effect.delete() })
  const ended = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'quarterstaff' } })
  assert.deepEqual([ended.status, ended.reason], ['failed', 'midi'], JSON.stringify(ended))
  const endedCard = useCard(ended.id)
  assert.ok(endedCard?.system?.concentration && !ari.effects.has(endedCard.system.concentration), 'its card names a concentration gone')
  assert.deepEqual([ended.messageId, ended.visible], [null, true], 'no card to apply it from')
  assert.equal(madeEnchantments(), made)
  ok('a workflow whose concentration has ended by the time it\'s done leaves it unapplied, naming no card to apply it from')

  midiEnchant.selfApply = item('quarterstaff')
  const twice = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'quarterstaff' } })
  midiEnchant.selfApply = null
  assert.equal(twice.status, 'done', JSON.stringify(twice))
  const once = enchantmentsOn('quarterstaff', ORIGIN.mw)
  assert.equal(once.length, 1, 'applied once')
  assert.equal(twice.enchantment.enchanted.effect, once[0].id)
  ok('one Midi-QOL applies itself is reported, not applied again')

  const lit = await use('flametongue', 'engulf', { enchant: { profile: P.ablaze } })
  assert.equal(lit.status, 'done', JSON.stringify(lit))
  assert.equal(enchantmentsOn('flametongue', ORIGIN.engulf).length, 1)
  assert.equal(engulfApplied(sheetBefore(lit.id)).length, 1, 'the sheet with it alight sent first')
  const usages = midi.usages.length
  const again = await use('flametongue', 'engulf', {})
  assert.deepEqual([again.status, again.reason, again.messageId], ['failed', 'applied', null], JSON.stringify(again))
  assert.equal(midi.usages.length, usages, 'no workflow')
  assert.equal(enchantmentsOn('flametongue', ORIGIN.engulf).length, 1, 'still alight')
  ok('Engulf in Flames lit through Midi-QOL; used again with its profile, refused before any workflow')

  const madeBefore = madeEnchantments()
  midiEnchant.abortDeleting = true
  const deleted = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'quarterstaff' } })
  midiEnchant.abortDeleting = false
  assert.deepEqual(deleted, {
    id: deleted.id, status: 'failed', reason: 'midi', error: null, messageId: null, visible: true, rolls: [],
    use: { type: 'enchant' }, damage: null, enchantment: null,
  })
  assert.equal(useCard(deleted.id), undefined, 'its card deleted')
  assert.equal(madeEnchantments(), madeBefore)
  ok('a workflow aborted once its card is posted, deleting it, leaves nothing applied and names no card')

  midi.settings.requiresTargets = 'always'
  const sequester = await use('sequester', 'seq-enchant', { slot: 'spell7', enchant: { profile: P.sequester } })
  midi.settings.requiresTargets = 'none'
  assert.deepEqual([sequester.status, sequester.reason], ['failed', 'target'])
  assert.equal(slots().spell7, 1)
  ok('Sequester, at a creature, is refused where Midi-QOL requires targets, spending nothing')
}

// ---- Either way ----
for (const [itemId, effect, reason, why] of [
  ['longsword', 'nosucheffect0000', 'enchantment', 'no such enchantment'],
  ['longsword', 'brynmwonclub0001', 'enchantment', 'one the club carries, endable there'],
  ['greataxe', 'weaponplusone001', 'enchantment', 'a template\'s'],
  ['oldplus', 'oldplusone000001', 'enchantment', 'one whose activity is gone, for good'],
  ['mm', staticID('dnd5espellchanges'), 'enchantment', 'a spell copy\'s changes'],
  ['mystflame', 'mfablazeapplied1', 'enchantment', 'one the sheet doesn\'t list, on an item not identified yet'],
  ['mystery', 'ringmystflame001', 'enchantment', 'one cast from another item not identified yet'],
  ['oldplus', 'draggedplusone01', 'enchantment', 'one with no profile, as dragged onto it'],
  ['oldplus', staticID('dnd5espellchanges'), 'enchantment', 'one with the id of a spell copy\'s changes'],
  ['brynsword', 'x', 'item', 'not Ari\'s item'],
]) {
  const refused = await end(itemId, effect)
  assert.deepEqual([refused.status, refused.reason], ['failed', reason], why)
}
assert.ok(item('mystflame').effects.has('mfablazeapplied1') && item('oldplus').effects.has('oldplusone000001'))
assert.ok(item('mystery').effects.has('ringmystflame001') && item('oldplus').effects.has('draggedplusone01')
  && item('oldplus').effects.has(staticID('dnd5espellchanges')))
ok('ends only an enchantment the sheet lists as endable, on that item')

// An end fetched as the Gamemaster has since changed the campaign, or that isn't as an end is sent:
// refused, Bryn's Magic Weapon staying on Ari's club.
// Nor one the Gamemaster made in the app (module 0.23.0): no roll, it would leave no mark of theirs.
for (const [fields, error] of [[{ mode: 1 }, 'dice'], [{ explicit: true }, 'dice'], [{ extras: [{ kind: 'bonus', value: 1 }] }, 'dice'], [{ by: 'gm' }, 'by'], [{ by: 'player' }, 'by']]) {
  const refused = await end('club', 'brynmwonclub0001', fields)
  assert.deepEqual([refused.status, refused.reason, refused.error], ['failed', 'invalid', error], JSON.stringify(fields))
}
const campaigns = settings.get('campaigns')
const changed = change => campaigns.map(campaign => (campaign.id === 'camp-a') ? { ...campaign, ...change } : campaign)
settings.set('campaigns', changed({ attacks: false }))
const attacksOff = await end('club', 'brynmwonclub0001')
settings.set('campaigns', changed({ characters: ['bryn'] }))
const notIn = await end('club', 'brynmwonclub0001')
// Since 0.31.0 only a campaign whose players move items and coins is fetched for while the dice
// aren't ready: what's fetched then is refused, as fetched while rolls are off.
settings.set('campaigns', changed({ transfers: true }))
diceStatus.ready = false
const diceOff = await end('club', 'brynmwonclub0001')
diceStatus.ready = true
settings.set('campaigns', campaigns)
assert.deepEqual([attacksOff, notIn, diceOff].map(r => [r.status, r.reason]), [['failed', 'attacks-off'], ['failed', 'unknown'], ['failed', 'off']])
assert.ok(item('club').effects.has('brynmwonclub0001'))
ok('an end isn\'t made where the campaign no longer takes attacks and spells, the character isn\'t in it, or the dice aren\'t ready; nor one with a mode, explicit or extras, nor the Gamemaster\'s')

// Bryn's Magic Weapon on Ari's club: Ari may end it, as its owner; Bryn's concentration goes on.
const brynsEnded = await end('club', 'brynmwonclub0001')
assert.equal(brynsEnded.status, 'done', JSON.stringify(brynsEnded))
assert.deepEqual(brynsEnded.enchantment, {
  enchanted: null, ended: { item: 'club', itemName: 'Club', effect: 'brynmwonclub0001', name: 'Magic Weapon, +1' },
})
assert.equal(item('club').effects.has('brynmwonclub0001'), false)
assert.ok(bryn.effects.has('brynconc00000001'), 'Bryn still concentrates')
ok('Ari ends Bryn\'s Magic Weapon on Ari\'s club, as its owner may in Foundry, and Bryn\'s concentration goes on')

const malformed = [
  [{ id: `atk-${++ids}`, actorId: 'ari', kind: 'attack', item: 'longsword', activity: 'longsword-swing', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [10] }], enchant: { profile: P.mw1 } }, 'enchant'],
  [{ id: `use-${++ids}`, actorId: 'ari', kind: 'use', item: 'mweapon', activity: 'mw', targets: [], enchant: { profile: 42 } }, 'enchant'],
  [{ id: `use-${++ids}`, actorId: 'ari', kind: 'use', item: 'mweapon', activity: 'mw', targets: [], enchant: { profile: P.mw1, item: 7 } }, 'enchant'],
  [{ id: `use-${++ids}`, actorId: 'ari', kind: 'use', item: 'darkness', activity: 'dark-cast', targets: [], enchant: { profile: P.dark } }, 'enchant'],
  [{ id: `end-${++ids}`, actorId: 'ari', kind: 'endEnchantment', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [3] }], enchantment: { item: 'club', effect: 'brynmwonclub0001' } }, 'dice'],
  [{ id: `end-${++ids}`, actorId: 'ari', kind: 'endEnchantment', mode: 0, explicit: false, extras: [], dice: [], enchantment: { item: 'club' } }, 'enchantment'],
  [{ id: `skl-${++ids}`, actorId: 'ari', kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [3] }], enchant: { profile: P.mw1 } }, 'enchant'],
]
for (const [command, error] of malformed) {
  const refused = await send(command)
  assert.deepEqual([refused.status, refused.reason, refused.error], ['failed', 'invalid', error], JSON.stringify(command))
}
ok('refuses an enchantment on anything but a use of one, and an end that names no enchantment or throws dice')

// The Gamemaster's enchantment as the character (module 0.23.0): made as the player's, its card
// flagged the Gamemaster's; the player's never.
{
  const mark = m => m.flags?.['sending-stone']?.by
  const castBy = async by => {
    const before = new Set(messages.keys())
    const made = await use('mweapon', 'mw', { slot: 'spell2', enchant: { profile: P.mw1, item: 'quarterstaff' }, ...(by && { by }) })
    assert.equal(made.status, 'done', JSON.stringify(made))
    const posted = [...messages.values()].filter(m => !before.has(m.id))
    return { made, posted, ours: posted.filter(m => m.flags?.['sending-stone']) }
  }
  const gm = await castBy('gm')
  const player = await castBy(null)
  const card = useCard(gm.made.id)
  assert.deepEqual([card.flags['sending-stone'].use, mark(card), card.author.id], [gm.made.id, 'gm', useCard(player.made.id).author.id])
  assert.deepEqual([gm.made.enchantment.enchanted?.item, player.made.enchantment.enchanted?.item], ['quarterstaff', 'quarterstaff'])
  assert.ok(gm.ours.length >= 1 && gm.ours.every(m => mark(m) === 'gm'))
  assert.ok(player.ours.length === gm.ours.length && player.ours.every(m => mark(m) === undefined))
  if (!MIDI) assert.equal(gm.posted.length, gm.ours.length)
  ok(`the Gamemaster's enchantment is made as the player's, its card flagged the Gamemaster's${MIDI ? ', through Midi' : ''}; the player's never`)
}

// A magic item's template, or a choice made once, which the sheet leaves to Foundry, is refused if
// a command names it anyway, applying nothing and posting no card.
const madeBefore = madeEnchantments()
const cardsBefore = messages.size
for (const [named, activity, enchant] of [
  ['flametongue', 'ft-template', { profile: 'VtBOwsAVipxkP2f5', item: 'longsword' }],
  ['shieldtpl', 'shield-tpl', { profile: 'shieldplusone001', item: 'quarterstaff' }],
  ['spear', 'spear-enchant', { profile: 'spearprofile0001', item: 'mweapon' }],
  ['spear', 'spear-enchant', { profile: 'spearprofile0001' }],
]) {
  const refused = await use(named, activity, { enchant })
  assert.deepEqual([refused.status, refused.reason], ['failed', 'activity'], `${named} ${activity}`)
}
assert.equal(madeEnchantments(), madeBefore, 'no enchantment was made')
assert.equal(messages.size, cardsBefore, 'no card was posted')
ok('a magic item\'s template or a choice made once, left to Foundry, is refused if named anyway, applying nothing')

const stranger = await send({ id: `end-${++ids}`, actorId: 'bryn', kind: 'endEnchantment', mode: 0, explicit: false, extras: [], dice: [], enchantment: { item: 'club', effect: 'brynmwonclub0001' } })
assert.deepEqual([stranger.status, stranger.reason], ['failed', 'item'], 'Bryn has no club')
nothingAsked()
assert.equal(effectReads.count, 0, 'no 6.x profile\'s effect was read')
ok('nothing was asked of the Gamemaster')

console.log(`${MIDI ? 'midi' : 'dnd5e'}: all enchant checks passed`)
process.exit(0)
