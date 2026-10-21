// Check and forward activities from the app (module 0.21.0): what the sheet says of a character's
// check activities and forwards, using them from the app, and rolling a check activity's checks as
// its card's button does. The real module, dnd5e 5.3.3's real dice classes (D20Roll, DamageRoll and
// their dice), dnd5e's activities ported (activity5e.mjs, with check.mjs, check-data.mjs,
// forward.mjs and forward-data.mjs), its actor (actor5e.mjs), a stand-in Foundry core and app.
// MIDI=1 puts a stand-in Midi-QOL workflow in the world (midi-fake.mjs). Run with
// --import ./unref-timers.mjs --import ./dnd5e-register.mjs, and LIBWRAPPER=1 or OMIT_ROOT=1 as
// uses.mjs takes them. The items are dnd5e's own, from packs/_source: classes24 Fast Hands,
// equipment24 Thieves' Tools, Manacles, Rope of Entanglement and Hat of Many Spells, the 2014 Pipes of
// the Sewers, spells24 Maze, the 2014 Silent Image, Disguise Self, Minor Illusion and Entangle (in
// its pack's order, its check first by sort); spells granted with uses of their own, as
// spell-config.mjs:84-123 gives them a forward; and Perrin's Bless and Krusk's Divine Smite, from
// actors24's premades, with the forwards dnd5e gave them, each spending the spell's use.
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
const skill = (label, ability) => ({ label, ability })
CONFIG.DND5E = {
  skills: {
    slt: skill('Sleight of Hand', 'dex'), inv: skill('Investigation', 'int'), acr: skill('Acrobatics', 'dex'),
    ath: skill('Athletics', 'str'), prc: skill('Perception', 'wis'), arc: skill('Arcana', 'int'), ste: skill('Stealth', 'dex'),
    his: skill('History', 'int'), ins: skill('Insight', 'wis'), itm: skill('Intimidation', 'cha'), nat: skill('Nature', 'int'),
    rel: skill('Religion', 'int'), prf: skill('Performance', 'cha'),
  },
  tools: { thief: { label: "Thieves' Tools", ability: 'dex' }, herb: { label: 'Herbalism Kit', ability: 'wis' } },
  vehicleTypes: { water: { label: 'Water Vehicle' } },
  abilities: {
    ...Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase(), abbreviation: key.toUpperCase() }])),
    // A world's own ability, which the app doesn't know.
    san: { label: 'Sanity', abbreviation: 'SAN' },
  },
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: Object.fromEntries(TYPES.map(type => [type, { label: type.charAt(0).toUpperCase() + type.slice(1) }])),
  healingTypes: { healing: { label: 'Healing' }, temphp: { label: 'Temporary HP' } },
  limitedUsePeriods: { lr: { label: 'Long Rest' } },
}
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')

const { Actor5e } = await import('./actor5e.mjs')
const activity5e = await import('./activity5e.mjs')
const { AttackActivity, SaveActivity, DamageActivity, HealActivity, Activity, ACTIVITIES, activityTypes, equip, screen } = activity5e
const { midi, placeables, installMidi } = await import('./midi-fake.mjs')
// An enchant activity, for a forward to name, where the port has none of its own.
if (!ACTIVITIES.enchant) activityTypes.enchant ??= class extends Activity { static type = 'enchant' }
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
const bob = user('bob', 'Bob')
const carol = user('carol', 'Carol')
const dave = user('dave', 'Dave')
if (MIDI) installMidi()
const add = actor => { actors.set(actor.id, actor); return actor }

// dnd5e's check activity as its pack has it: `check` with its ability, the skills or tools it's
// associated with, and its DC's formula or calculation.
const check = (id, name, checkData, fields = {}) => ({ id, name, type: 'check', affects: '', range: 'self', check: checkData, ...fields })
// A spell's free casting, as spell-config.mjs:98-111 adds it: a forward to the activity, spending a
// use of the spell.
const free = (id, target, fields = {}) => ({
  id, name: 'Cast (free casting)', type: 'forward', activity: { id: target },
  consumption: [{ type: 'itemUses', target: '', value: '1' }], ...fields,
})
const spell = (id, name, level, activities, system = {}) => ({
  id, name, type: 'spell', system: { level, method: 'spell', properties: [], ...system }, activities,
})

// Rook, a 3rd-level Thief: Dexterity 16, proficient in Sleight of Hand and thieves' tools, each +5.
const rook = add(new Actor5e({
  id: 'rook', name: 'Rook', owners: ['alice'], mods: { dex: 3, str: 0 }, prof: 2,
  skills: { slt: { ability: 'dex' }, acr: { ability: 'dex', value: 0 }, ath: { ability: 'str', value: 0 }, arc: { ability: 'int', value: 0 } },
  tools: { thief: { ability: 'dex' } },
}))
alice.character = rook
const ELEVEN = ['slt', 'inv', 'acr', 'ath', 'prc', 'arc', 'ste', 'his', 'ins', 'itm', 'nat']
equip(rook, {
  items: [
    { id: 'hands', name: 'Fast Hands', type: 'feat', system: { properties: [] }, activities: [
      check('slt-check', 'Sleight of Hand', { associated: ['slt'], ability: '', dc: { formula: '' } }, { activation: { type: 'bonus', value: null } }),
      check('thief-check', "Thieves' Tools", { associated: ['thief'], ability: 'dex', dc: { formula: '' } }, { activation: { type: 'bonus', value: null } }),
      { id: 'use-object', name: 'Use an Object', type: 'utility', affects: '', range: 'self', activation: { type: 'bonus', value: null } },
    ] },
    // A tool item checks its own tool, with no skill or tool named: its base item's.
    { id: 'tools', name: "Thieves' Tools", type: 'tool', system: { properties: [], quantity: 1, type: { value: '', baseItem: 'thief' }, ability: 'dex', bonus: '', prof: { multiplier: 1 } },
      activities: [check('pick', 'Pick a Lock/Disarm a Trap', { ability: 'dex', associated: [], dc: { formula: '15' } })] },
    { id: 'manacles', name: 'Manacles', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 1, spent: 0 } }, activities: [
      check('bind', 'Bind', { associated: ['slt'], ability: '', dc: { formula: '13' } }, { affects: 'creature', count: 1, range: 'ft', consumption: [{ type: 'itemUses', target: '', value: '1' }] }),
      check('burst', 'Burst Check', { associated: ['ath'], ability: '', dc: { formula: '25' } }),
    ] },
    { id: 'rope', name: 'Rope of Entanglement', type: 'equipment', system: { properties: ['mgc'], quantity: 1 }, activities: [
      check('escape-rope', 'Escape', { associated: ['acr', 'ath'], ability: '', dc: { formula: '15' } }, { affects: 'creature', count: 1 }),
    ] },
    // The 2014 Pipes of the Sewers: a check that names none.
    { id: 'pipes', name: 'Pipes of the Sewers', type: 'consumable', system: { properties: ['mgc'], quantity: 1, uses: { max: 3, spent: 0 } }, activities: [
      check('pipe', '', { ability: '', dc: {} }, { activation: { type: 'bonus', value: 1 }, consumption: [{ type: 'itemUses', target: '', value: '1' }] }),
    ] },
    // A check whose DC is worked out from the level the hat is used at.
    { id: 'hat', name: 'Hat of Many Spells', type: 'equipment', system: { properties: ['foc', 'mgc'] }, activities: [
      check('unknown-spell', 'Unknown Spell Check', { associated: ['arc'], ability: '', dc: { formula: '10 + @scaling' } }, { affects: 'self', scaling: { allowed: true, max: '9' } }),
    ] },
    { id: 'sanity', name: 'Sanity Test', type: 'feat', system: { properties: [] }, activities: [check('mad', 'Keep Your Wits', { ability: 'san', associated: [], dc: { formula: '12' } })] },
    { id: 'eleven', name: 'Jack of Many Trades', type: 'feat', system: { properties: [] }, activities: [check('many', 'Many Things', { ability: '', associated: ELEVEN, dc: { formula: '10' } })] },
    { id: 'helm', name: "Pilot's Helm", type: 'feat', system: { properties: [] }, activities: [check('steer', 'Steer', { ability: 'str', associated: ['water'], dc: { formula: '10' } })] },
    { id: 'gem', name: 'Odd Gem', type: 'consumable', system: { properties: [], identified: false, quantity: 1 }, activities: [check('glint', 'Glint', { associated: ['arc'], ability: '', dc: { formula: '12' } })] },
    // A homebrew charm whose forward is used through its own check, and another forward the same.
    { id: 'charm', name: 'Slippery Charm', type: 'feat', system: { properties: [] }, activities: [
      check('slip', 'Slip Free', { associated: ['acr'], ability: '', dc: { formula: '12' } }, { affects: 'self' }),
      { id: 'slip-fwd', name: 'Slip (charm)', type: 'forward', activity: { id: 'slip' } },
      { id: 'slip-again', name: 'Slip (again)', type: 'forward', activity: { id: 'slip' } },
    ] },
    // A homebrew feature whose first activity, by sort, is a forward, to the one after it.
    { id: 'knack', name: 'Knack', type: 'feat', system: { properties: [] }, activities: [
      { id: 'knack-use', name: 'Steady Hands', type: 'utility', sort: 1, affects: 'self', range: 'self', activation: { type: 'bonus', value: 1 } },
      { id: 'knack-fwd', name: 'Knack (forward)', type: 'forward', sort: 0, activity: { id: 'knack-use' }, activation: { type: 'bonus', value: 1 } },
    ] },
    // Two homebrew forwards to one activity, each with uses of its own, as dnd5e's forward sheet
    // makes them, spending its own (activity-sheet.mjs:470-478): dnd5e spends each from that
    // forward's alone (consumption-targets-field.mjs:131-141), so neither repeats the other.
    { id: 'twins', name: 'Twin Knack', type: 'feat', system: { properties: [] }, activities: [
      { id: 'tw-use', name: 'Steady', type: 'utility', affects: 'self', range: 'self', activation: { type: 'bonus', value: 1 } },
      { id: 'tw-a', name: 'Twin A', type: 'forward', activity: { id: 'tw-use' }, activation: { type: 'bonus', value: 1 },
        uses: { max: 1, spent: 1, recovery: [{ period: 'lr' }] }, consumption: [{ type: 'activityUses', target: '', value: '1' }] },
      { id: 'tw-b', name: 'Twin B', type: 'forward', activity: { id: 'tw-use' }, activation: { type: 'bonus', value: 1 },
        uses: { max: 1, spent: 0, recovery: [{ period: 'lr' }] }, consumption: [{ type: 'activityUses', target: '', value: '1' }] },
    ] },
    // Homebrew forwards to one activity, each but the last differing from the first in one thing
    // only: how it's activated, how many uses it spends, or whose; the last is the first again.
    { id: 'pairs', name: 'Many Ways', type: 'feat', system: { properties: [], uses: { max: 4, spent: 0 } }, activities: [
      { id: 'pr-use', name: 'Do It', type: 'utility', affects: 'self', range: 'self', activation: { type: 'action', value: 1 } },
      { id: 'pr-one', name: 'Do It (once)', type: 'forward', activity: { id: 'pr-use' }, activation: { type: 'action', value: 1 }, consumption: [{ type: 'itemUses', target: '', value: '1' }] },
      { id: 'pr-act', name: 'Do It (reaction)', type: 'forward', activity: { id: 'pr-use' }, activation: { type: 'reaction', value: 1 }, consumption: [{ type: 'itemUses', target: '', value: '1' }] },
      { id: 'pr-val', name: 'Do It (twice)', type: 'forward', activity: { id: 'pr-use' }, activation: { type: 'action', value: 1 }, consumption: [{ type: 'itemUses', target: '', value: '2' }] },
      { id: 'pr-tgt', name: 'Do It (pipes)', type: 'forward', activity: { id: 'pr-use' }, activation: { type: 'action', value: 1 }, consumption: [{ type: 'itemUses', target: 'pipes', value: '1' }] },
      { id: 'pr-again', name: 'Do It (again)', type: 'forward', activity: { id: 'pr-use' }, activation: { type: 'action', value: 1 }, consumption: [{ type: 'itemUses', target: '', value: '1' }] },
    ] },
    // A check, a forward to one, and a utility's roll that its player can't use, as dnd5e 5 says of
    // an item's that needs attunement, unattuned (mixin.mjs:98-108); and a check that it can.
    { id: 'locked', name: 'Locked Trick', type: 'feat', system: { properties: [] }, activities: [
      check('locked-check', 'Locked', { associated: ['slt'], ability: '', dc: { formula: '12' } }, { canUse: false }),
      check('open-check', 'Open', { associated: ['slt'], ability: '', dc: { formula: '12' } }),
      { id: 'locked-fwd', name: 'Open (forward)', type: 'forward', activity: { id: 'open-check' }, canUse: false },
      { id: 'locked-luck', name: 'Locked Luck', type: 'utility', affects: 'self', range: 'self', formula: '1d4', canUse: false },
    ] },
    // A check whose DC is more than the app shows.
    { id: 'vault', name: 'Impossible Vault', type: 'feat', system: { properties: [] }, activities: [
      check('vault-check', 'Vault', { associated: ['ath'], ability: '', dc: { formula: '150' } }, { activation: { type: 'action', value: 1 } }),
    ] },
  ],
})

// Zanna, a 15th-level wizard: Intelligence +5, proficiency +5, spell save DC 18; an 8th-level slot,
// and the 1st-level slots spent.
const zanna = add(new Actor5e({ id: 'zanna', name: 'Zanna', owners: ['bob'], mods: { int: 5, dex: 2 }, prof: 5, skills: { inv: { ability: 'int' } } }))
bob.character = zanna
zanna.system.abilities.int.dc = 18
zanna.system.attributes.spellcasting = 'int'
// The 2014 spells' checks to see through them: no activation of their own, and a duration of their
// own, which takes no concentration.
const investigate = (id, name, fields = {}) => check(id, name, { associated: ['inv'], ability: '', dc: { calculation: 'spellcasting', formula: '' } },
  { activation: { type: '', override: true }, duration: { override: true, concentration: false }, range: 'spec', affects: 'creature', count: 1, ...fields })
// Perrin's Bless (actors24/premades/level-1/perrin.yml): seven forwards, each a free casting of the
// spell, one naming another, two or three hops long, each spending its use.
const perrin = (id, name, sort, target, fields = {}) => ({ ...free(id, target, fields), name, sort })
equip(zanna, {
  spells: {
    spell1: { value: 0, max: 4, level: 1 }, spell2: { value: 3, max: 3, level: 2 }, spell3: { value: 2, max: 2, level: 3 },
    spell8: { value: 1, max: 1, level: 8 },
  },
  items: [
    // Its check takes the spell's concentration, its duration not its own.
    spell('maze', 'Maze', 8, [check('banish', 'Banish to Maze', { associated: 'inv', ability: '', dc: { formula: '20' } }, { affects: 'creature', count: 1, duration: { override: false } })], { properties: ['concentration'] }),
    // Granted with a use a day: dnd5e gives each of its activities that spends a slot a free casting,
    // its check's too, which would spend the use on a check that doesn't cast it.
    spell('silent', 'Silent Image', 1, [
      { id: 'silent-cast', name: 'Cast', type: 'utility', affects: '', duration: { override: false } },
      investigate('silent-check', 'Investigate Illusion Check'),
      { ...free('silent-cast-free', 'silent-cast'), sort: 1 },
      { ...free('silent-check-free', 'silent-check'), name: 'Investigate Illusion Check (free casting)', sort: 1 },
    ], { properties: ['concentration'], uses: { max: 1, spent: 0 } }),
    spell('disguise', 'Disguise Self', 1, [
      { id: 'disguise-cast', name: 'Cast', type: 'utility', affects: 'self', range: 'self' },
      investigate('disguise-check', 'Investigate Disguise Check'),
    ]),
    spell('illusion', 'Minor Illusion', 0, [
      { id: 'illusion-cast', name: 'Cast', type: 'utility', affects: '' },
      investigate('illusion-check', 'Investigate Illusion Check'),
    ]),
    // In its pack's order: its check first, by sort, and the spell cast after; prepared, lasting a
    // minute, so that the Actions tab lists it.
    spell('entangle', 'Entangle', 1, [
      check('escape-plants', 'Escape Plants Check', { associated: [], ability: 'str', dc: { calculation: 'spellcasting', formula: '' } },
        { sort: 0, activation: { type: '', override: true }, duration: { override: true, concentration: false }, range: 'spec', affects: 'creature', count: 1, spellSlot: false }),
      { id: 'entangle-cast', name: 'Cast', type: 'save', sort: 100000, save: ['str'], dc: 18, duration: { override: false } },
    ], { properties: ['concentration'], canPrepare: true, prepared: 1, duration: { value: '1', units: 'minute' } }),
    // A homebrew spell whose check is activated as the spell is cast: dnd5e spends its slot.
    spell('probe', 'Mind Probe', 2, [
      { id: 'probe-cast', name: 'Cast', type: 'utility', affects: 'creature', count: 1 },
      check('probe-check', 'Probe Mind', { associated: ['ins'], ability: '', dc: { calculation: 'spellcasting', formula: '' } },
        { activation: { type: 'action', value: 1 }, range: 'ft', affects: 'creature', count: 1 }),
    ]),
    // A homebrew spell whose only activity is a check with no activation of its own: it leads the
    // spell, so it's how it's cast, spending a slot, as dnd5e spends one for any leveled spell's.
    spell('solo', 'Lone Riddle', 2, [investigate('solo-check', 'Riddle Check')]),
    // Spells granted with a use a day, each with its free casting, its forward.
    spell('bless', 'Bless', 1, [
      { id: 'dnd5eactivity000', name: 'Cast', type: 'utility', sort: 0, affects: 'ally', count: '3 + @scaling', duration: { override: false }, effects: ['Bless'],
        labels: { activation: 'Action', range: '30 ft', target: '3 Allies', concentrationDuration: 'Concentration, up to 1 minute' } },
      perrin('2QtNAQPwdzdUtbif', 'Use (free casting)', 1, 'dnd5eactivity000', { labels: { activation: 'Action (free)' } }),
      perrin('j9kXvrOVzEMbdKJW', 'Use (free casting)', 1, 'dnd5eactivity000'),
      perrin('KWxuRvbiJlyFpkRk', 'Use (free casting) (free casting)', 2, '2QtNAQPwdzdUtbif'),
      perrin('8jvv7dRIQY9yURrH', 'Use (free casting)', 1, 'dnd5eactivity000'),
      perrin('sInDcKwhmsmPRTmO', 'Use (free casting) (free casting)', 2, '2QtNAQPwdzdUtbif'),
      perrin('BkF3ZsSb7nG1EGip', 'Use (free casting) (free casting)', 2, 'j9kXvrOVzEMbdKJW'),
      perrin('hV0VpciDU83310XO', 'Use (free casting) (free casting) (free casting)', 3, 'KWxuRvbiJlyFpkRk'),
    ], { properties: ['concentration'], uses: { max: 1, spent: 0, recovery: [{ period: 'lr' }] } }),
    spell('rebuke', 'Hellish Rebuke', 1, [
      { id: 'rebuke-cast', name: 'Cast', type: 'save', activation: { type: 'reaction', value: 1 }, affects: 'creature', count: 1, save: ['dex'], dc: 18,
        damage: [{ number: 2, denomination: 10, types: ['fire'], scaling: 1 }], labels: { damage: [{ formula: '2d10', damageType: 'fire', label: '2d10 Fire' }] } },
      free('rebuke-free', 'rebuke-cast', { activation: { type: 'reaction', value: 1 } }),
    ], { uses: { max: 1, spent: 0 } }),
    // Krusk's Divine Smite (actors24/premades/level-17/krusk.yml), granted with a use a day: a free
    // casting of each of its two activities, each spending the use, activated as the spell is.
    spell('smite', 'Divine Smite', 1, [
      { id: 'dnd5eactivity000', name: 'Unholy Creature Damage', type: 'damage', sort: 200000, activation: { type: 'bonus', value: 1 }, affects: 'creature', count: 1,
        damage: [{ number: 3, denomination: 8, types: ['radiant'], scaling: 1 }] },
      { id: 'dnd5eactivity200', name: 'Cast', type: 'damage', sort: 100000, activation: { type: 'bonus', value: 1 }, affects: 'creature', count: 1,
        damage: [{ number: 2, denomination: 8, types: ['radiant'], scaling: 1 }] },
      { ...free('lqXTpzQQmzAndrCr', 'dnd5eactivity000', { activation: { type: 'bonus', value: 1 } }), name: 'Unholy Creature Damage (free casting)', sort: 200001 },
      { ...free('mCRcgG9uenXYe54m', 'dnd5eactivity200', { activation: { type: 'bonus', value: 1 } }), name: 'Cast (free casting)', sort: 100001 },
    ], { uses: { max: 1, spent: 0, recovery: [{ period: 'lr' }] } }),
    spell('bolt', 'Guiding Bolt', 1, [
      { id: 'bolt-shot', name: 'Attack', type: 'attack', ability: 'int', labels: { modifier: '10' }, damage: [{ number: 4, denomination: 6, types: ['radiant'], scaling: 1 }] },
      free('bolt-free', 'bolt-shot'),
    ], { uses: { max: 1, spent: 0 } }),
    spell('steed', 'Find Steed', 2, [{ id: 'steed-call', name: 'Summon Steed', type: 'summon', affects: '' }, free('steed-free', 'steed-call')], { uses: { max: 1, spent: 0 } }),
    // A chain of three forwards; two naming each other; one naming nothing; one that scales; and
    // one its player can't use.
    spell('chain', 'Thunderous Chain', 1, [
      { id: 'chain-cast', name: 'Cast', type: 'utility', affects: 'creature', count: 2 },
      { id: 'chain-a', name: 'Chain A', type: 'forward', activity: { id: 'chain-b' }, consumption: [{ type: 'itemUses', target: '', value: '1' }] },
      { id: 'chain-b', name: 'Chain B', type: 'forward', activity: { id: 'chain-c' } },
      { id: 'chain-c', name: 'Chain C', type: 'forward', activity: { id: 'chain-cast' } },
      { id: 'loop-a', name: 'Loop A', type: 'forward', activity: { id: 'loop-b' }, consumption: [{ type: 'itemUses', target: '', value: '1' }] },
      { id: 'loop-b', name: 'Loop B', type: 'forward', activity: { id: 'loop-a' } },
      free('lost', 'nowhere'),
      free('scaled-fwd', 'chain-cast', { scaling: { allowed: true, max: '3' } }),
      free('blocked-fwd', 'chain-cast', { canUse: false }),
      // A chain through a forward its player can't use.
      { id: 'hidden-a', name: 'Hidden A', type: 'forward', activity: { id: 'hidden-b' }, consumption: [{ type: 'itemUses', target: '', value: '1' }] },
      { id: 'hidden-b', name: 'Hidden B', type: 'forward', activity: { id: 'chain-cast' }, canUse: false },
    ], { uses: { max: 2, spent: 0 } }),
    // Spirit Guardians' aura, used after the spell is cast, spends no slot: dnd5e spends none of the
    // forward's either.
    spell('guardians', 'Spirit Guardians', 3, [
      { id: 'guard-cast', name: 'Cast', type: 'utility', affects: 'self', range: 'self', concentration: true },
      { id: 'guard-aura', name: 'Aura', type: 'save', affects: 'creature', save: ['wis'], dc: 18, spellSlot: false, damage: [{ number: 3, denomination: 8, types: ['radiant'], scaling: 1 }] },
      free('aura-free', 'guard-aura'),
    ], { properties: ['concentration'], uses: { max: 1, spent: 0 } }),
    // Blur's free casting, spent.
    spell('blur', 'Blur', 2, [{ id: 'blur-cast', name: 'Cast', type: 'utility', affects: 'self', range: 'self' }, free('blur-free', 'blur-cast')], { uses: { max: 1, spent: 1 } }),
    // A homebrew free casting spending as many uses as the caster's proficiency bonus: a formula.
    spell('sanctuary', 'Sanctuary', 1, [
      { id: 'sanct-cast', name: 'Cast', type: 'utility', affects: 'creature', count: 1, activation: { type: 'bonus', value: 1 } },
      free('sanct-prof', 'sanct-cast', { activation: { type: 'bonus', value: 1 }, consumption: [{ type: 'itemUses', target: '', value: '@prof' }] }),
    ], { uses: { max: 6, spent: 0 } }),
    // An enchantment, and a wand's Cast activity, each named by a forward.
    spell('weapon', 'Magic Weapon', 2, [{ id: 'weapon-ench', name: 'Enchant', type: 'enchant', affects: '' }, free('weapon-fwd', 'weapon-ench')], { uses: { max: 1, spent: 0 } }),
    { id: 'wand', name: 'Wand of Webs', type: 'consumable', system: { properties: ['mgc'], quantity: 1, uses: { max: 7, spent: 0 } }, activities: [
      { id: 'cast-web', type: 'cast', consumption: [{ type: 'itemUses', value: '1' }] },
      { id: 'wand-fwd', name: 'Web (forward)', type: 'forward', activity: { id: 'cast-web' }, consumption: [{ type: 'itemUses', target: '', value: '1' }] },
    ] },
  ],
})

// Wren, a warlock whose pact slots are 3rd level: Faerie Fire, granted as a Pact Magic spell with a
// use a day, is cast through its forward at the pact slots' level, which dnd5e scales it to.
const wren = add(new Actor5e({ id: 'wren', name: 'Wren', owners: ['carol'], mods: { cha: 4 }, prof: 3 }))
carol.character = wren
equip(wren, {
  spells: { pact: { value: 2, max: 2, level: 3 } },
  items: [spell('fire', 'Faerie Fire', 1, [
    { id: 'fire-cast', name: 'Cast', type: 'utility', affects: 'creature', concentration: true },
    free('fire-free', 'fire-cast'),
  ], { method: 'pact', properties: ['concentration'], uses: { max: 1, spent: 0 } })],
})

// Gorm, a 4th-level fighter with no spell slots, granted Misty Step by Fey Touched.
const gorm = add(new Actor5e({ id: 'gorm', name: 'Gorm', owners: ['dave'], mods: { str: 3 }, prof: 2 }))
dave.character = gorm
equip(gorm, {
  items: [spell('misty', 'Misty Step', 2, [
    { id: 'misty-step', name: 'Cast', type: 'utility', affects: 'self', range: 'self', activation: { type: 'bonus', value: 1 } },
    free('misty-free', 'misty-step', { activation: { type: 'bonus', value: 1 } }),
  ], { uses: { max: 1, spent: 0 } })],
})

// The tokens on the Gamemaster's canvas, and the fight.
const place = actor => {
  const token = { id: `tok-${actor.id}`, name: actor.name, uuid: `Scene.scene.Token.tok-${actor.id}`, actor, hidden: false }
  const placeable = { id: token.id, name: actor.name, document: token, actor }
  token.object = placeable
  placeables.set(token.id, placeable)
  return token
}
const foe = (id, name, ac) => {
  const actor = add(new Actor5e({ id, name, mods: {}, hp: { value: 40, max: 40, temp: 0 } }))
  actor.type = 'npc'
  equip(actor, { ac })
  return { actor, token: place(actor) }
}
const tokens = Object.fromEntries([rook, zanna, wren, gorm].map(actor => [actor.id, place(actor)]))
const foes = { gob: foe('goblin', 'Goblin', 13), hob: foe('hobgoblin', 'Hobgoblin', 18), ogre: foe('ogre', 'Ogre', 11), orc: foe('orc', 'Orc', 13) }
if (MIDI) canvas.scene.tokens.size = placeables.size
const fight = combat('fight')
for (const actor of [rook, zanna, wren, gorm]) combatant(fight, `cb-${actor.id}`, actor, { token: tokens[actor.id] })
for (const [id, { actor, token }] of Object.entries(foes)) combatant(fight, `cb-${id}`, actor, { token })
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
const target = combatantId => ({ combatId: 'fight', combatantId })
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
const use = (actorId, item, activity, fields = {}) => send({
  id: `use-${++ids}`, actorId, kind: 'use', item, activity, targets: [], slot: null, ...fields,
})
const attack = (actorId, item, activity, fields = {}) => send({
  id: `atk-${++ids}`, actorId, kind: 'attack', item, activity, target: target('cb-gob'),
  mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [15] }], ...fields,
})
const damage = (actorId, useId, dice) => send({ id: `dmg-${++ids}`, actorId, kind: 'damage', use: useId, dice })
const roll = (actorId, kind, key, fields = {}) => send({
  id: `req-${++ids}`, actorId, kind, key, mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }], ...fields,
})
const diceFor = (preview, value) => preview.rolls.flatMap(r => r.dice)
  .map(({ faces, number }) => ({ faces, results: Array.from({ length: number }, () => Math.min(value ?? faces, faces)) }))
const useCard = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.use === id)
const rollMessage = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.request === id)
const faces = r => r.dice.map(die => die.results.map(result => result.result))
const workflowOf = id => midi.made.find(w => w.workflowOptions.sendingStone === id)
const usesOf = (actor, item) => {
  const uses = actor.items.get(item).system.uses
  return Math.max((Number(uses.max) || 0) - (Number(uses.spent) || 0), 0)
}
const refill = (actor, item, spent = 0) => actor.items.get(item).updateSource({ 'system.uses.spent': spent })
const slots = actor => Object.fromEntries(Object.entries(actor.system.spells).map(([key, pool]) => [key, pool.value]))
const concentrating = actor => [...actor.concentration.effects.values()].map(effect => effect.flags.dnd5e.item.data)
const nothingAsked = () => {
  assert.deepEqual(screen.notifications, [], 'nothing was said on the Gamemaster\'s screen')
  assert.equal(screen.templates, 0, 'no template was placed')
  assert.deepEqual(screen.subsequent, [], 'nothing followed the use on the Gamemaster\'s screen')
}
const refused = async (made, reason, label) => {
  const result = await made
  assert.deepEqual([result.status, result.reason], ['failed', reason], `${label}: ${JSON.stringify(result)}`)
  return result
}

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
const campaigns = [{ id: 'camp-a', title: 'Ashlands', characters: ['rook', 'zanna', 'wren', 'gorm'], rolls: true, attacks: true }]
settings.set('campaigns', campaigns)
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.equal(diceStatus.attacks, true, `attack self-test: ${diceStatus.attacksError}`)
const { describeActivity, rollsOf } = await import(`${MODULE}/scripts/sheet-rolls.mjs`)
const { favoritesOf } = await import(`${MODULE}/scripts/sheet-favorites.mjs`)
const { serializeMessage } = await import(`${MODULE}/scripts/chat-data.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)

const hellos = () => app.events.filter(e => e.type === 'bridge.hello')
assert.equal(hellos().at(-1).data.features.rolls.activityChecks, true)
ok('the hello says a check activity\'s checks may be rolled for it under dnd5e 5')

// ---- The sheet: check activities ----
const entryOf = (actor, itemId, activityId) => {
  const item = actor.items.get(itemId)
  return rollsOf(item, undefined, { list: true }).activities.find(entry => entry.id === activityId)
}
const hands = entryOf(rook, 'hands', 'slt-check')
assert.equal(hands.type, 'check')
assert.deepEqual(hands.activity, { id: 'slt-check', type: 'check', targets: { self: true, area: false, count: null, perLevel: null, affects: null, fromSelf: true } })
assert.deepEqual(hands.check, { checks: [{ type: 'skill', ability: 'dex', key: 'slt' }], dc: null, own: true })
assert.equal(hands.activationType, 'bonus')
assert.deepEqual(entryOf(rook, 'hands', 'thief-check').check, { checks: [{ type: 'tool', ability: 'dex', key: 'thief' }], dc: null, own: true }, 'a feat\'s tool check adds no bonus')
const object = entryOf(rook, 'hands', 'use-object')
assert.deepEqual([object.activity.type, 'check' in object], ['utility', false])
// The sheets follow the hello, each character's in a post of its own, in the hello's order; Rook's
// lists Fast Hands' checks among its features.
const updatedAfterHello = () => app.events.slice(app.events.lastIndexOf(hellos().at(-1))).filter(e => e.type === 'character.updated').map(e => e.data.character.id)
await until(() => updatedAfterHello().length === 4, 'the sheets after the hello')
assert.deepEqual(updatedAfterHello(), ['rook', 'zanna', 'wren', 'gorm'])
const sheetOf = id => app.events.filter(e => (e.type === 'character.updated') && (e.data.character.id === id)).at(-1).data.character.sheet
const fastHands = sheetOf('rook').features.flatMap(section => section.features).find(f => f.name === 'Fast Hands')
assert.deepEqual(fastHands.activities.map(entry => [entry.id, entry.activity?.type ?? null, entry.check?.checks.length ?? null]),
  [['slt-check', 'check', 1], ['thief-check', 'check', 1], ['use-object', 'utility', null]])
ok('Fast Hands: its Sleight of Hand and Thieves\' Tools checks are used and rolled from the app, the character\'s own; Use an Object as before')

const tools = () => rollsOf(rook.items.get('tools'))
assert.deepEqual(tools().check, { checks: [{ type: 'tool', ability: 'dex', key: 'thief' }], dc: 15, own: true })
assert.equal(tools().activity.id, 'pick')
rook.items.get('tools').updateSource({ 'system.bonus': '1' })
assert.deepEqual(tools().check.checks, [{ type: 'tool', ability: 'dex', key: 'thief', bonus: 1 }])
rook.items.get('tools').updateSource({ 'system.bonus': '1d4' })
assert.deepEqual([tools().check, tools().activity?.id], [undefined, 'pick'], 'a bonus that throws dice leaves the check out, not the use')
rook.items.get('tools').updateSource({ 'system.bonus': '1' })
ok('a tool item\'s check is of its own tool, as dnd5e\'s card has it, with the item\'s bonus; one whose bonus throws dice is only used')

const maze = rollsOf(zanna.items.get('maze'))
assert.deepEqual(maze.check, { checks: [{ type: 'skill', ability: 'int', key: 'inv' }], dc: 20, own: false })
assert.deepEqual([maze.activity.type, 'consumesSlot' in maze], ['check', false])
for (const [itemId, activityId] of [['silent', 'silent-check'], ['disguise', 'disguise-check']]) {
  const found = entryOf(zanna, itemId, activityId)
  assert.deepEqual(found.check, { checks: [{ type: 'skill', ability: 'int', key: 'inv' }], dc: 18, own: false }, itemId)
  assert.equal(found.consumesSlot, false, `${itemId}'s check doesn't cast the spell`)
}
assert.equal('consumesSlot' in entryOf(zanna, 'illusion', 'illusion-check'), false, 'a cantrip spends no slot anyway')
const plants = entryOf(zanna, 'entangle', 'escape-plants')
assert.deepEqual([plants.check, plants.consumesSlot], [{ checks: [{ type: 'check', ability: 'str' }], dc: 18, own: false }, false])
assert.deepEqual(rollsOf(rook.items.get('rope')).check, { checks: [{ type: 'skill', ability: 'dex', key: 'acr' }, { type: 'skill', ability: 'str', key: 'ath' }], dc: 15, own: true })
ok('a spell\'s checks are its targets\', at its DC: Maze\'s, and the 2014 Silent Image\'s, Disguise Self\'s and Entangle\'s, which spend no slot; the rope\'s two')

// Entangle, in its pack's order, its Escape Plants check first by sort: the spell leads with how
// it's cast, the check after it, and both on its Action row, the check having no activation.
const entangle = rollsOf(zanna.items.get('entangle'))
assert.deepEqual([entangle.activity.id, entangle.activity.type, entangle.save, 'consumesSlot' in entangle], ['entangle-cast', 'save', { ability: 'STR', dc: 18 }, false])
assert.deepEqual(entangle.activities.map(entry => entry.id), ['entangle-cast', 'escape-plants'])
assert.deepEqual([entangle.activities[1].check, entangle.activities[1].consumesSlot], [{ checks: [{ type: 'check', ability: 'str' }], dc: 18, own: false }, false])
const rowsFor = (actorId, itemId) => sheetOf(actorId).actions.flatMap(section => section.actions
  .filter(action => action.id === itemId).map(action => [section.id, action.activities?.map(entry => entry.id) ?? null]))
assert.deepEqual(rowsFor('zanna', 'entangle'), [['action', ['entangle-cast', 'escape-plants']]])
// A spell's check activated as it's cast isn't one called for after: dnd5e spends its slot.
const probe = entryOf(zanna, 'probe', 'probe-check')
assert.deepEqual([probe.check, 'consumesSlot' in probe], [{ checks: [{ type: 'skill', ability: 'wis', key: 'ins' }], dc: 18, own: false }, false])
ok('Entangle in its pack\'s order leads with its save, its Escape Plants check after it, spending no slot, on the one Action row; a homebrew spell\'s check activated as it\'s cast spends one')

const edge = (actor, itemId) => rollsOf(actor.items.get(itemId))
assert.deepEqual([edge(rook, 'sanity').activity?.type, edge(rook, 'sanity').check], ['check', undefined], 'an ability the app doesn\'t know')
assert.deepEqual([edge(rook, 'eleven').activity?.type, edge(rook, 'eleven').check], ['check', undefined], 'eleven checks')
assert.deepEqual([edge(rook, 'pipes').activity?.type, edge(rook, 'pipes').check], ['check', undefined], 'a check that names none')
assert.deepEqual(edge(rook, 'helm').check, { checks: [{ type: 'check', ability: 'str' }], dc: 10, own: true }, 'a vehicle is an ability check')
assert.deepEqual([edge(rook, 'gem').activity, edge(rook, 'gem').check], [null, undefined], 'an unidentified item')
assert.deepEqual([edge(rook, 'hat').activity, edge(rook, 'hat').check], [null, undefined], 'a check that scales')
assert.deepEqual(edge(rook, 'vault').check, { checks: [{ type: 'skill', ability: 'str', key: 'ath' }], dc: null, own: true }, 'a DC above 99 isn\'t shown')
game.system.version = '6.0.5'
assert.deepEqual([entryOf(rook, 'hands', 'slt-check').activity, entryOf(rook, 'hands', 'slt-check').check], [null, undefined], 'dnd5e 6')
game.system.version = '5.3.0'
ok('no check where the app can\'t roll one; no use for an unidentified item, a check that scales, or under dnd5e 6')

// ---- The sheet: forwards ----
const bless = entryOf(zanna, 'bless', '2QtNAQPwdzdUtbif')
assert.equal(bless.type, 'forward')
// What it spends is the forward's, the spell's own once a day, never the activity's it's used
// through (module 0.29.0).
assert.deepEqual(bless.activity, { id: '2QtNAQPwdzdUtbif', type: 'utility', targets: { self: false, area: false, count: 3, perLevel: null, affects: 'ally', fromSelf: false }, spends: [{ counter: { item: 'bless' }, amount: 1 }] })
assert.deepEqual([bless.consumesSlot, bless.forward, bless.uses], [false, { charges: 1, short: false }, { value: 1, max: 1, recovery: 'Long Rest' }])
assert.deepEqual([bless.range, bless.target, bless.duration, bless.activation], ['30 ft', '3 Allies', 'Concentration, up to 1 minute', 'Action (free)'])
assert.deepEqual(entryOf(zanna, 'bless', 'dnd5eactivity000').activity.targets.perLevel, 1, 'Bless itself takes another for each level higher')
const chain = entryOf(zanna, 'chain', 'chain-a')
assert.deepEqual([chain.activity, chain.forward, chain.consumesSlot], [
  { id: 'chain-a', type: 'utility', targets: { self: false, area: false, count: 2, perLevel: null, affects: 'creature', fromSelf: false }, spends: [{ counter: { item: 'chain' }, amount: 1 }] },
  { charges: 1, short: false }, false])
for (const [itemId, activityId, why] of [['chain', 'loop-a', 'a cycle'], ['chain', 'lost', 'a missing target'], ['steed', 'steed-free', 'a summoning'],
  ['wand', 'wand-fwd', 'a Cast'], ['weapon', 'weapon-fwd', 'an enchantment'], ['chain', 'scaled-fwd', 'one that scales'],
  ['chain', 'hidden-a', 'through one not to be used'], ['silent', 'silent-check-free', 'a check called for once the spell is cast']]) {
  const found = entryOf(zanna, itemId, activityId)
  assert.deepEqual([found.activity, found.attackId, 'forward' in found, 'check' in found], [null, null, false, false], why)
}
const rebuke = entryOf(zanna, 'rebuke', 'rebuke-free')
assert.deepEqual([rebuke.activity.type, rebuke.save, rebuke.damage, rebuke.activationType],
  ['save', { ability: 'DEX', dc: 18 }, [{ formula: '2d10', type: 'Fire', healing: false }], 'reaction'])
const bolt = entryOf(zanna, 'bolt', 'bolt-free')
assert.deepEqual([bolt.attackId, bolt.toHit, bolt.activity], ['bolt-free', 10, null])
assert.deepEqual(entryOf(zanna, 'guardians', 'aura-free').forward, { charges: 0, short: false }, 'dnd5e spends none of the forward\'s for the aura')
assert.deepEqual(entryOf(zanna, 'sanctuary', 'sanct-prof').forward, { charges: null, short: false }, 'a formula isn\'t counted')
assert.deepEqual(entryOf(zanna, 'blur', 'blur-free').forward, { charges: 1, short: true })
assert.deepEqual(entryOf(rook, 'charm', 'slip-fwd').check, { checks: [{ type: 'skill', ability: 'dex', key: 'acr' }], dc: 12, own: true })
const pact = entryOf(wren, 'fire', 'fire-free')
assert.deepEqual([pact.activity.targets.count, pact.consumesSlot, pact.forward], [null, false, { charges: 1, short: false }])
ok('a forward rolls as the activity it names, by its own id: a spell\'s free casting spends its use, no slot, at the spell\'s own level; through a chain; not where it names nothing usable, or scales')

// Perrin's Bless: of its seven free castings, each a use of the spell, through one, two or three
// forwards, the first alone is listed; a chain's forward that repeats the one before it is left
// out; one through a forward its player can't use is listed, rolling nothing. Silent Image's free
// casting of its check rolls nothing either.
assert.deepEqual(rollsOf(zanna.items.get('bless')).activities.map(entry => [entry.id, entry.forward ?? null]),
  [['dnd5eactivity000', null], ['2QtNAQPwdzdUtbif', { charges: 1, short: false }]])
assert.deepEqual(rollsOf(zanna.items.get('chain')).activities.map(entry => entry.id),
  ['chain-cast', 'chain-a', 'chain-b', 'loop-a', 'loop-b', 'lost', 'scaled-fwd', 'hidden-a'])
assert.deepEqual(rollsOf(zanna.items.get('silent')).activities.map(entry => entry.id),
  ['silent-cast', 'silent-cast-free', 'silent-check-free', 'silent-check'])
// A feature whose first activity, by sort, is a forward: it rolls as the one the forward names.
const knack = rollsOf(rook.items.get('knack'))
assert.deepEqual([knack.activity, knack.forward, knack.activities.map(entry => entry.id)], [
  { id: 'knack-fwd', type: 'utility', targets: { self: true, area: false, count: null, perLevel: null, affects: 'self', fromSelf: true } },
  { charges: 0, short: false }, ['knack-fwd', 'knack-use']])
assert.deepEqual(rowsFor('rook', 'knack'), [['bonus', ['knack-fwd', 'knack-use']]])
ok('repeats of a free casting are listed once, Perrin\'s seven as one; a forward through a hidden one, or to a check called for once its spell is cast, rolls nothing; a feature led by a forward rolls as what it names')

// A forward repeats another only through the same activity, activated the same, for the same cost
// of uses they share: Krusk's Divine Smite's two free castings, each through its own activity, are
// both listed; so are forwards through one activity activated otherwise, spending more, or another
// item's uses; and two spending each its own uses, one with none left, the other with its use.
assert.deepEqual(rollsOf(zanna.items.get('smite')).activities.map(entry => [entry.id, entry.forward ?? null]), [
  ['dnd5eactivity200', null], ['mCRcgG9uenXYe54m', { charges: 1, short: false }],
  ['dnd5eactivity000', null], ['lqXTpzQQmzAndrCr', { charges: 1, short: false }]])
assert.deepEqual(rollsOf(rook.items.get('pairs')).activities.map(entry => [entry.id, entry.forward ?? null]), [
  ['pr-use', null], ['pr-one', { charges: 1, short: false }], ['pr-act', { charges: 1, short: false }],
  ['pr-val', { charges: 2, short: false }], ['pr-tgt', { charges: 1, short: false }]])
assert.deepEqual(rollsOf(rook.items.get('twins')).activities.map(entry => [entry.id, entry.forward ?? null, entry.uses]), [
  ['tw-use', null, null],
  ['tw-a', { charges: 1, short: true }, { value: 0, max: 1, recovery: 'Long Rest' }],
  ['tw-b', { charges: 1, short: false }, { value: 1, max: 1, recovery: 'Long Rest' }]])
ok('a forward repeats another only through the same activity, activated the same, for the same cost of shared uses: Divine Smite\'s two free castings listed, and forwards differing in activation, cost or whose uses, or each spending its own')

// A spell led by its check, with no other activity, is cast by it: it spends a slot.
const solo = rollsOf(zanna.items.get('solo'))
assert.deepEqual([solo.activity?.id, solo.check, 'consumesSlot' in solo], ['solo-check', { checks: [{ type: 'skill', ability: 'int', key: 'inv' }], dc: 18, own: false }, false])
ok('a spell whose only activity is a check with no activation of its own is cast by it, spending a slot')

// Favorites carry them too.
rook.system.favorites = [{ type: 'activity', id: '.Item.hands.Activity.slt-check', sort: 1 }]
// A forward the item's list leaves out as a repeat is still a favorite, as the player made it.
zanna.system.favorites = [{ type: 'activity', id: '.Item.bless.Activity.2QtNAQPwdzdUtbif', sort: 1 }, { type: 'activity', id: '.Item.bless.Activity.j9kXvrOVzEMbdKJW', sort: 2 }]
assert.deepEqual(favoritesOf(rook)[0].check, { checks: [{ type: 'skill', ability: 'dex', key: 'slt' }], dc: null, own: true })
assert.deepEqual(favoritesOf(zanna).map(favorite => [favorite.id, favorite.forward, favorite.activity.id]),
  [['2QtNAQPwdzdUtbif', { charges: 1, short: false }, '2QtNAQPwdzdUtbif'], ['j9kXvrOVzEMbdKJW', { charges: 1, short: false }, 'j9kXvrOVzEMbdKJW']])
ok('a favorite check activity carries its checks, and a favorite forward what it spends, one the list leaves out as a repeat too')

// ---- Using check activities ----
const bindBefore = messages.size
await refused(use('rook', 'manacles', 'bind', { targets: [target('cb-gob'), target('cb-hob')] }), 'target', 'two targets')
assert.equal(usesOf(rook, 'manacles'), 1)
const bind = await use('rook', 'manacles', 'bind', { targets: [target('cb-gob')] })
assert.equal(bind.status, 'done', JSON.stringify(bind))
assert.deepEqual([bind.use, bind.damage, bind.rolls], [{ type: 'check' }, null, []])
assert.equal(usesOf(rook, 'manacles'), 0)
const bindCard = useCard(bind.id)
const buttons = [...new DOMParser().parseFromString(bindCard.content, 'text/html').querySelectorAll('button[data-action="rollCheck"]')]
assert.deepEqual(buttons.map(button => ({ ...button.dataset })), [{ ability: 'dex', action: 'rollCheck', visibility: 'all', dc: '13', skill: 'slt' }])
assert.equal(messages.size, bindBefore + 1, 'the card alone')
await refused(use('rook', 'manacles', 'bind', { targets: [target('cb-gob')] }), 'consume', 'no use left')
const chat = serializeMessage(bindCard, getCampaigns()[0])
assert.deepEqual([chat.ask, chat.dnd5e.activity.type, chat.text], [null, 'check', 'DEX (Sleight of Hand) check'], 'a use card, not an ask')
const handsChecked = midi.rolledChecks.length
const sleight = await use('rook', 'hands', 'slt-check')
assert.equal(sleight.status, 'done', JSON.stringify(sleight))
assert.deepEqual(sleight.use, { type: 'check' })
assert.ok(useCard(sleight.id).content.includes('data-action="rollCheck"'))
// With Midi-QOL, a feature's check at no one is its card alone: no target rolls it.
assert.equal(midi.rolledChecks.length, handsChecked, 'no check rolled for Fast Hands')
nothingAsked()
ok('asks the table with a check activity: dnd5e\'s card, a button for each check, spending what it spends, a use card in the app\'s chat; refused when there\'s nothing to spend')

await refused(use('zanna', 'maze', 'banish', { targets: [target('cb-gob'), target('cb-hob')] }), 'target', 'Maze takes one')
assert.equal(slots(zanna).spell8, 1)
const checked = midi.rolledChecks.length
const banished = await use('zanna', 'maze', 'banish', { targets: [target('cb-gob')] })
assert.equal(banished.status, 'done', JSON.stringify(banished))
assert.equal(slots(zanna).spell8, 0)
if (MIDI) await until(() => concentrating(zanna).includes('banish'), 'Midi to begin concentrating')
assert.deepEqual(concentrating(zanna), ['banish'])
if (MIDI) {
  await until(() => midi.rolledChecks.length > checked, 'the goblin\'s check')
  assert.deepEqual(midi.rolledChecks.slice(checked).map(r => [r.target, r.dc, r.success]), [['tok-goblin', 20, false]])
  assert.deepEqual([midi.rolledChecks[checked].rollType, midi.rolledChecks[checked].keys], ['skill', ['inv']])
  ok('Maze cast through Midi-QOL: its slot spent, concentration begun, the goblin\'s check Midi\'s')
} else ok('Maze cast: its 8th-level slot spent, concentration begun')

// The 2014 Silent Image's check doesn't cast the spell: it spends no slot, though dnd5e would
// unless its slot is unticked, but is used at the level of the slot chosen, as dnd5e's dialog uses
// it with its slot unticked, one with none left too; one the dialog doesn't offer is refused.
const spell1 = slots(zanna).spell1
const seen = await use('zanna', 'silent', 'silent-check', { targets: [target('cb-gob')], slot: 'spell1' })
assert.equal(seen.status, 'done', JSON.stringify(seen))
assert.equal(slots(zanna).spell1, spell1)
assert.deepEqual([useCard(seen.id).system?.scaling, useCard(seen.id).system?.spellLevel], [undefined, 1])
const seenHigher = await use('zanna', 'silent', 'silent-check', { targets: [target('cb-gob')], slot: 'spell3' })
assert.equal(seenHigher.status, 'done', JSON.stringify(seenHigher))
assert.deepEqual([slots(zanna).spell1, slots(zanna).spell3], [spell1, 2])
assert.deepEqual([useCard(seenHigher.id).system?.scaling, useCard(seenHigher.id).system?.spellLevel], [2, 3])
await refused(use('zanna', 'silent', 'silent-check', { targets: [target('cb-gob')], slot: 'spell5' }), 'slot', 'a level the dialog doesn\'t offer')
ok('Silent Image\'s check, at the 1st-level slot an app sent while none is left, and at the 3rd: used at that level, spending none; at none offered, refused')

// Entangle in its pack's order: its Escape Plants check, with a 2nd-level slot an app sent while the
// 1st-level ones are spent, is used at the 2nd level, spending none, and takes no concentration; the
// spell cast with no slot sent is cast with the dialog's own, the 2nd level's, and takes it.
const plantsBefore = { slots: slots(zanna), checks: midi.rolledChecks.length, concentration: concentrating(zanna) }
const escaped = await use('zanna', 'entangle', 'escape-plants', { targets: [target('cb-gob')], slot: 'spell2' })
assert.equal(escaped.status, 'done', JSON.stringify(escaped))
assert.deepEqual([escaped.use, slots(zanna), useCard(escaped.id).system?.scaling], [{ type: 'check' }, plantsBefore.slots, 1])
assert.deepEqual(concentrating(zanna), plantsBefore.concentration, 'no concentration begun')
if (MIDI) {
  await until(() => midi.rolledChecks.length > plantsBefore.checks, 'the goblin\'s Strength check')
  assert.deepEqual(midi.rolledChecks.slice(plantsBefore.checks).map(r => [r.target, r.rollType, r.keys, r.dc]), [['tok-goblin', 'check', ['str'], 18]])
}
const entangled = await use('zanna', 'entangle', 'entangle-cast', { targets: [target('cb-gob')] })
assert.equal(entangled.status, 'done', JSON.stringify(entangled))
assert.deepEqual([entangled.use, slots(zanna).spell1, slots(zanna).spell2], [{ type: 'save' }, 0, plantsBefore.slots.spell2 - 1])
if (MIDI) await until(() => concentrating(zanna).includes('entangle-cast'), 'Midi to begin concentrating')
assert.deepEqual(concentrating(zanna), ['entangle-cast'])
// A homebrew spell's check activated as it's cast spends a slot, as dnd5e's dialog has it.
const probed = await use('zanna', 'probe', 'probe-check', { targets: [target('cb-gob')] })
assert.equal(probed.status, 'done', JSON.stringify(probed))
assert.deepEqual([slots(zanna).spell2, useCard(probed.id).system?.scaling], [plantsBefore.slots.spell2 - 2, undefined])
// A spell led by its check with no activation of its own, having no other, is cast by it: dnd5e
// spends its slot.
const riddled = await use('zanna', 'solo', 'solo-check', { targets: [target('cb-gob')] })
assert.equal(riddled.status, 'done', JSON.stringify(riddled))
assert.deepEqual([riddled.use, slots(zanna).spell2], [{ type: 'check' }, plantsBefore.slots.spell2 - 3])
ok('Entangle\'s Escape Plants check spends no slot, used at the level sent, nor takes concentration; Entangle cast spends the dialog\'s slot and takes it; a check activated as its spell is cast spends one, as does a spell led by its only check')

if (MIDI) {
  await refused(use('rook', 'tools', 'pick'), 'activity', 'Midi has a tool\'s user check at themselves')
  midi.settings.requiresTargets = 'always'
  await refused(use('rook', 'rope', 'escape-rope'), 'target', 'Midi needs a check\'s target')
  midi.settings.requiresTargets = 'none'
  // Workflow.ts:5509-5594: a check naming only skills is rolled as a skill check of those skills.
  const ropeChecked = midi.rolledChecks.length
  const roped = await use('rook', 'rope', 'escape-rope', { targets: [target('cb-gob')] })
  assert.equal(roped.status, 'done', JSON.stringify(roped))
  await until(() => midi.rolledChecks.length > ropeChecked, 'the goblin\'s check')
  assert.deepEqual(midi.rolledChecks.slice(ropeChecked).map(r => [r.target, r.rollType, r.keys, r.dc]), [['tok-goblin', 'skill', ['acr', 'ath'], 15]])
  ok('under Midi-QOL, a tool\'s check isn\'t used, its user its target; a check needs its targets where Midi says; the rope\'s is rolled as Midi rolls skills')
} else {
  const picked = await use('rook', 'tools', 'pick')
  assert.equal(picked.status, 'done', JSON.stringify(picked))
  const pickButtons = [...new DOMParser().parseFromString(useCard(picked.id).content, 'text/html').querySelectorAll('button')]
  assert.deepEqual(pickButtons.map(button => ({ ...button.dataset })), [{ ability: 'dex', action: 'rollCheck', visibility: 'all', dc: '15', tool: 'thief' }])
  ok('a tool\'s check: its card\'s button checks its own tool')
}
game.system.version = '6.0.5'
await refused(use('rook', 'hands', 'slt-check'), 'activity', 'dnd5e 6')
game.system.version = '5.3.0'
nothingAsked()

// ---- Using forwards ----
zanna.concentration.effects.clear()
await refused(use('zanna', 'bless', '2QtNAQPwdzdUtbif', { targets: ['cb-gob', 'cb-hob', 'cb-ogre', 'cb-orc'].map(target) }), 'target', 'a fourth')
assert.equal(usesOf(zanna, 'bless'), 1)
const blessed = await use('zanna', 'bless', '2QtNAQPwdzdUtbif', { targets: ['cb-gob', 'cb-hob', 'cb-ogre'].map(target) })
assert.equal(blessed.status, 'done', JSON.stringify(blessed))
assert.deepEqual(blessed.use, { type: 'utility' })
assert.deepEqual([slots(zanna).spell1, usesOf(zanna, 'bless')], [0, 0])
const blessCard = useCard(blessed.id)
assert.equal(blessCard.system.cause, '.Item.bless.Activity.2QtNAQPwdzdUtbif')
assert.equal(blessCard.system.scaling, undefined)
assert.equal(blessCard.flags.dnd5e.activity.id, 'dnd5eactivity000', 'the card is Bless\'s own')
if (MIDI) {
  // Midi's workflow is Bless's, used with the forward as its cause, as dnd5e's forward has it used.
  assert.equal(workflowOf(blessed.id)?.activity.id, 'dnd5eactivity000')
  assert.deepEqual(midi.usages.at(-1).usage.cause, { activity: '.Item.bless.Activity.2QtNAQPwdzdUtbif' })
  assert.deepEqual(midi.usages.at(-1).usage.consume, { resources: false, spellSlot: false })
}
if (MIDI) await until(() => concentrating(zanna).includes('dnd5eactivity000'), 'Midi to begin concentrating')
assert.deepEqual(concentrating(zanna), ['dnd5eactivity000'])
await refused(use('zanna', 'bless', '2QtNAQPwdzdUtbif'), 'consume', 'the use spent')
assert.deepEqual([slots(zanna).spell1, usesOf(zanna, 'bless')], [0, 0])
// What an older app sends: any slot, even the 1st level's, none of which is left, which its picker
// chose for a spell that spends no slot.
for (const slot of ['spell3', 'pact', 'spell1']) {
  refill(zanna, 'bless')
  const old = await use('zanna', 'bless', '2QtNAQPwdzdUtbif', { slot })
  assert.equal(old.status, 'done', `${slot}: ${JSON.stringify(old)}`)
  assert.deepEqual([slots(zanna).spell1, slots(zanna).spell3, usesOf(zanna, 'bless'), useCard(old.id).system.scaling], [0, 2, 0, undefined], slot)
}
nothingAsked()
ok('Bless\'s free casting: no slot, though none is left, its use spent, as cast for it; at its own level, whatever slot an older app sends; then nothing left')

// Perrin's Bless: a free casting the sheet doesn't list, three forwards from the spell, is used as
// dnd5e uses it: the spell's card names it its cause, and it spends its one use, not three.
refill(zanna, 'bless')
zanna.concentration.effects.clear()
const relayed = await use('zanna', 'bless', 'hV0VpciDU83310XO', { targets: ['cb-gob', 'cb-hob'].map(target) })
assert.equal(relayed.status, 'done', JSON.stringify(relayed))
assert.deepEqual([relayed.use, slots(zanna).spell1, usesOf(zanna, 'bless')], [{ type: 'utility' }, 0, 0])
assert.deepEqual([useCard(relayed.id).system.cause, useCard(relayed.id).flags.dnd5e.activity.id], ['.Item.bless.Activity.hV0VpciDU83310XO', 'dnd5eactivity000'])
if (MIDI) {
  assert.deepEqual([workflowOf(relayed.id)?.activity.id, midi.usages.at(-1).usage.cause, midi.usages.at(-1).usage.consume],
    ['dnd5eactivity000', { activity: '.Item.bless.Activity.hV0VpciDU83310XO' }, { resources: false, spellSlot: false }])
  await until(() => concentrating(zanna).includes('dnd5eactivity000'), 'Midi to begin concentrating')
}
assert.deepEqual(concentrating(zanna), ['dnd5eactivity000'])
const blessedOnce = JSON.stringify([slots(zanna), usesOf(zanna, 'bless'), concentrating(zanna)])
await refused(use('zanna', 'bless', '2QtNAQPwdzdUtbif'), 'consume', 'the one use spent')
assert.equal(JSON.stringify([slots(zanna), usesOf(zanna, 'bless'), concentrating(zanna)]), blessedOnce)
nothingAsked()
ok(`Perrin's Bless through three forwards: the spell's card, the outermost its cause, its one use spent, concentration begun${MIDI ? ', through Midi\'s workflow' : ''}; then nothing left`)

const fire = await use('wren', 'fire', 'fire-free')
assert.equal(fire.status, 'done', JSON.stringify(fire))
assert.deepEqual([slots(wren).pact, usesOf(wren, 'fire'), useCard(fire.id).system.scaling], [2, 0, 2])
const step = await use('gorm', 'misty', 'misty-free')
assert.equal(step.status, 'done', JSON.stringify(step))
assert.equal(usesOf(gorm, 'misty'), 0)
ok('a Pact Magic spell\'s free casting spends no pact slot, but is cast at its level, as dnd5e casts it; a fighter with no slots casts Misty Step')

const struck = await attack('zanna', 'bolt', 'bolt-free')
assert.equal(struck.status, 'done', JSON.stringify(struck))
assert.equal(usesOf(zanna, 'bolt'), 0)
assert.deepEqual([struck.rolls[0].total, struck.attack.outcome], [25, 'hit'])
if (!MIDI) assert.deepEqual(faces(rollMessage(struck.id).rolls[0]), [[15]])
assert.equal(useCard(struck.id).flags.dnd5e.activity.id, 'bolt-shot')
const radiant = await damage('zanna', struck.id, diceFor(struck.damage, 3))
assert.equal(radiant.status, 'done', JSON.stringify(radiant))
assert.equal(radiant.rolls[0].total, 12)
ok('Guiding Bolt\'s free casting: the attack rolled with the player\'s d20, then its damage with their dice, on the spell\'s own card')

const rebuked = await use('zanna', 'rebuke', 'rebuke-free', { targets: [target('cb-gob')] })
assert.equal(rebuked.status, 'done', JSON.stringify(rebuked))
assert.deepEqual([rebuked.use, rebuked.damage.rolls[0].dice], [{ type: 'save' }, [{ faces: 10, number: 2 }]])
const burnt = await damage('zanna', rebuked.id, diceFor(rebuked.damage, 4))
assert.equal(burnt.status, 'done', JSON.stringify(burnt))
assert.equal(burnt.rolls[0].total, 8)
if (MIDI) assert.deepEqual(midi.rolledSaves.filter(r => r.target === 'tok-goblin').map(r => [r.ability, r.dc]).at(-1), ['dex', 18])
ok(`Hellish Rebuke's free casting at the goblin, its damage after${MIDI ? ', the goblin\'s save Midi\'s' : ''}`)

// Divine Smite's second free casting, which a forward through its other activity at the same cost
// doesn't repeat: its own activity's card and damage, the spell's use spent.
const smote = await use('zanna', 'smite', 'lqXTpzQQmzAndrCr', { targets: [target('cb-gob')] })
assert.equal(smote.status, 'done', JSON.stringify(smote))
assert.deepEqual([smote.use, smote.damage.rolls[0].dice, usesOf(zanna, 'smite')], [{ type: 'damage' }, [{ faces: 8, number: 3 }], 0])
assert.deepEqual([useCard(smote.id).flags.dnd5e.activity.id, useCard(smote.id).system.cause], ['dnd5eactivity000', '.Item.smite.Activity.lqXTpzQQmzAndrCr'])
const radiance = await damage('zanna', smote.id, diceFor(smote.damage, 4))
assert.equal(radiance.status, 'done', JSON.stringify(radiance))
assert.equal(radiance.rolls[0].total, 12)
await refused(use('zanna', 'smite', 'mCRcgG9uenXYe54m', { targets: [target('cb-gob')] }), 'consume', 'the spell\'s use spent')
// Two forwards each spending its own uses: the one with a use left spends it, and not the other's.
const twinUses = () => ['tw-a', 'tw-b'].map(id => rook.items.get('twins').system.activities.get(id).uses.value)
await refused(use('rook', 'twins', 'tw-a'), 'consume', 'none of its own left')
const twinned = await use('rook', 'twins', 'tw-b')
assert.equal(twinned.status, 'done', JSON.stringify(twinned))
assert.deepEqual([twinned.use, twinUses(), useCard(twinned.id).system.cause], [{ type: 'utility' }, [0, 0], '.Item.twins.Activity.tw-b'])
await refused(use('rook', 'twins', 'tw-b'), 'consume', 'its own use spent')
nothingAsked()
ok('Divine Smite\'s free casting through its other activity: that activity\'s card and damage, the use spent; a forward spending its own use, beside one with none left, spends it')

const spentNow = () => JSON.stringify([slots(zanna), usesOf(zanna, 'chain'), usesOf(zanna, 'steed'), usesOf(zanna, 'silent'), zanna.items.get('wand').system.uses.spent])
const before = spentNow()
for (const [itemId, activityId, why] of [['chain', 'lost', 'a missing target'], ['chain', 'loop-a', 'a cycle'], ['chain', 'blocked-fwd', 'one not to be used'],
  ['wand', 'wand-fwd', 'a Cast'], ['steed', 'steed-free', 'a summoning'], ['chain', 'scaled-fwd', 'one that scales'], ['weapon', 'weapon-fwd', 'an enchantment'],
  ['chain', 'hidden-a', 'through one not to be used'], ['silent', 'silent-check-free', 'a check called for once the spell is cast']]) {
  await refused(use('zanna', itemId, activityId, { targets: [target('cb-gob')] }), 'activity', why)
}
await refused(attack('zanna', 'bless', '2QtNAQPwdzdUtbif'), 'activity', 'a use as an attack')
assert.equal(spentNow(), before)
assert.equal(usesOf(zanna, 'silent'), 1)
const chained = await use('zanna', 'chain', 'chain-a', { targets: [target('cb-gob')] })
assert.equal(chained.status, 'done', JSON.stringify(chained))
assert.deepEqual([usesOf(zanna, 'chain'), useCard(chained.id).system.cause], [1, '.Item.chain.Activity.chain-a'])
nothingAsked()
ok('refuses a forward naming nothing, going round, not to be used or through one that isn\'t, a Cast, a summoning, an enchantment, a check called for once its spell is cast, or one that scales, spending nothing; follows a chain of them')

// ---- Rolling a check activity's checks ----
const quiet = messages.size
const slick = await roll('rook', 'skill', 'slt', { item: 'hands', activity: 'slt-check' })
assert.equal(slick.status, 'done', JSON.stringify(slick))
assert.deepEqual([slick.rolls[0].total, slick.outcome], [17, null])
assert.deepEqual(faces(rollMessage(slick.id).rolls[0]), [[12]])
assert.equal(rollMessage(slick.id).rolls[0].options.target, undefined, 'against no DC')
assert.equal(messages.size, quiet + 1, 'the roll alone, no card')
ok('Fast Hands\' Sleight of Hand rolled with the player\'s d20: +5, against no DC, spending nothing and posting no card')

const configs = []
const watch = config => { configs.push(config) }
Hooks.on('dnd5e.preRollAbilityCheckV2', watch)
const unlocked = await roll('rook', 'tool', 'thief', { item: 'tools', activity: 'pick', dice: [{ faces: 20, results: [9] }] })
assert.equal(unlocked.status, 'done', JSON.stringify(unlocked))
assert.deepEqual([unlocked.rolls[0].total, unlocked.outcome], [15, 'success'])
assert.deepEqual([configs.at(-1).bonus, configs.at(-1).item?.id, configs.at(-1).target], ['1', 'tools', 15])
assert.equal(rollMessage(unlocked.id).rolls[0].data.extraBonus, '1')
const stuck = await roll('rook', 'tool', 'thief', { item: 'tools', activity: 'pick', dice: [{ faces: 20, results: [8] }] })
assert.deepEqual([stuck.rolls[0].total, stuck.outcome], [14, 'failure'])
Hooks.off('dnd5e.preRollAbilityCheckV2', watch)
const forwarded = await roll('rook', 'skill', 'acr', { item: 'charm', activity: 'slip-fwd', dice: [{ faces: 20, results: [10] }] })
assert.deepEqual([forwarded.status, forwarded.rolls[0]?.total, forwarded.outcome], ['done', 13, 'success'])
// One the sheet leaves out as a repeat of another is still rolled for, by its id.
assert.deepEqual(rollsOf(rook.items.get('charm')).activities.map(entry => entry.id), ['slip', 'slip-fwd'])
const again = await roll('rook', 'skill', 'acr', { item: 'charm', activity: 'slip-again', dice: [{ faces: 20, results: [6] }] })
assert.deepEqual([again.status, again.rolls[0]?.total, again.outcome], ['done', 9, 'failure'])
ok('Pick a Lock: 9 + 5 + the tools\' 1 = 15 against DC 15, a success, 8 a failure, rolled as the card\'s button rolls it; a forward to a check rolls it, one left out as a repeat too')

// A DC the sheet doesn't show, above 99, isn't rolled against: as the sheet has it, none.
const vaulted = await roll('rook', 'skill', 'ath', { item: 'vault', activity: 'vault-check', dice: [{ faces: 20, results: [20] }] })
assert.equal(vaulted.status, 'done', JSON.stringify(vaulted))
assert.deepEqual([vaulted.rolls[0].total, vaulted.outcome, rollMessage(vaulted.id).rolls[0].options.target], [20, null, undefined])
ok('a check against a DC of 150, which the sheet shows as none, is rolled against none, with no outcome')

for (const [label, made, reason] of [
  ['a spell\'s check', roll('zanna', 'ability', 'str', { item: 'entangle', activity: 'escape-plants' }), 'activity'],
  ['Maze\'s', roll('zanna', 'skill', 'inv', { item: 'maze', activity: 'banish' }), 'activity'],
  ['a check it doesn\'t offer', roll('rook', 'skill', 'acr', { item: 'hands', activity: 'slt-check' }), 'activity'],
  ['a tool it doesn\'t offer', roll('rook', 'tool', 'herb', { item: 'tools', activity: 'pick' }), 'activity'],
  ['not a check', roll('rook', 'skill', 'slt', { item: 'hands', activity: 'use-object' }), 'activity'],
  ['a check that scales', roll('rook', 'skill', 'arc', { item: 'hat', activity: 'unknown-spell' }), 'activity'],
  // One its player can't use, though a stored sheet may still list it: a check, one through a
  // forward, and a utility's roll.
  ['a check not to be used', roll('rook', 'skill', 'slt', { item: 'locked', activity: 'locked-check' }), 'activity'],
  ['through a forward not to be used', roll('rook', 'skill', 'slt', { item: 'locked', activity: 'locked-fwd' }), 'activity'],
  ['a roll not to be used', send({ id: `fml-${++ids}`, actorId: 'rook', kind: 'formula', item: 'locked', activity: 'locked-luck', mode: 0, explicit: false, extras: [], dice: [{ faces: 4, results: [3] }] }), 'activity'],
  ['no such item', roll('rook', 'skill', 'slt', { item: 'nothing', activity: 'slt-check' }), 'item'],
  ['an unidentified item', roll('rook', 'skill', 'arc', { item: 'gem', activity: 'glint' }), 'item'],
]) await refused(made, reason, label)
for (const [label, fields] of [
  ['an item alone', { kind: 'skill', key: 'slt', item: 'hands' }],
  ['an activity alone', { kind: 'skill', key: 'slt', activity: 'slt-check' }],
  ['with a description\'s link', { kind: 'skill', key: 'slt', item: 'hands', activity: 'slt-check', text: '0123456789abcd', link: 0 }],
  ['a saving throw', { kind: 'save', key: 'dex', item: 'hands', activity: 'slt-check' }],
  ['a death saving throw', { kind: 'death', key: undefined, item: 'hands', activity: 'slt-check' }],
  ['an id that isn\'t one', { kind: 'skill', key: 'slt', item: '', activity: 'slt-check' }],
]) {
  const made = await refused(send({ id: `req-${++ids}`, actorId: 'rook', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }], ...fields }), 'invalid', label)
  assert.equal(made.error, 'item', label)
}
game.system.version = '6.0.5'
await refused(roll('rook', 'skill', 'slt', { item: 'hands', activity: 'slt-check' }), 'activity', 'dnd5e 6')
await game.settings.set('sending-stone', 'campaigns', campaigns.map(c => ({ ...c })))
await until(() => hellos().at(-1).data.features.rolls.activityChecks === false, 'a hello under dnd5e 6')
game.system.version = '5.3.0'
nothingAsked()
const opened = await roll('rook', 'skill', 'slt', { item: 'locked', activity: 'open-check', dice: [{ faces: 20, results: [7] }] })
assert.deepEqual([opened.status, opened.rolls[0]?.total, opened.outcome], ['done', 12, 'success'], 'the one beside them that\'s to be used')
ok('refuses another\'s check, one not offered, one not to be used, a check activity that isn\'t one made here, an item not the character\'s, and anything malformed; the hello under dnd5e 6 says no')

console.log(`${MIDI ? 'midi' : 'dnd5e'}: done`)
process.exit(0)
