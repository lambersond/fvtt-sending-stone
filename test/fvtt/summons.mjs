// Summon activities cast from the app (module 0.54.0): what a reader's sheet says of them, the
// creatures, types and sizes each offers at each level, labelled as dnd5e's dialog labels them; the
// cast, through dnd5e's own use with nothing placed, the slot or use spent and concentration begun;
// the player's choice of creature written on the card where dnd5e would ask, and chosen beforehand
// in dnd5e's dialog when the card's Summon button is clicked; and what an older app is sent. The real
// module; dnd5e 5.3.3's real dice classes, or 6.0.5's with DND5E6=1; dnd5e's actors, items and
// activities ported (actor5e.mjs, activity5e.mjs, its summon activity, card and usage dialog among
// them); scenes and tokens as v14 has them (token-core.mjs); with MIDI=1, midi-fake.mjs's workflow;
// a stand-in Foundry core and app. Run with --import ./unref-timers.mjs --import
// ./dnd5e-register.mjs, and SLIM_CHECK=1 (every full sheet posted slims and expands back).
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { settings, user, users, actors } from './stub.mjs'
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
const DND5E6 = Boolean(process.env.DND5E6)
const DND5E = DND5E6 ? `${DND5E6_ROOT}/module/dice` : `${DND5E5}/module/dice`
let oks = 0
const ok = message => { oks++; console.log('ok -', message) }

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
// The module's long waits, shortened a hundredfold; its 250 ms settling kept as it is.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
// A browser's document, for the cards drawn and the badge and line the module draws on them.
const { window } = new JSDOM('', { pretendToBeVisual: true })
Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement })
let clock = 0
const realNow = Date.now
Date.now = () => realNow() + clock

// ---- dnd5e ----
const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
if (DND5E6) game.system.version = '6.0.5'
CONFIG.DND5E = {
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  tools: {},
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  defaultAbilities: { initiative: 'dex' },
  spellcasting: { spell: { exclusive: { spells: false, slots: false } }, pact: { exclusive: { spells: false, slots: false } } },
  damageTypes: { radiant: { label: 'Radiant' }, slashing: { label: 'Slashing' } },
  healingTypes: { healing: { label: 'Healing' } },
  // config.mjs's, as dnd5e's dialog labels a summon's choices by them.
  creatureTypes: {
    beast: { label: 'Beast' }, celestial: { label: 'Celestial' }, elemental: { label: 'Elemental' }, fey: { label: 'Fey' },
    fiend: { label: 'Fiend' },
  },
  actorSizes: { tiny: { label: 'Tiny' }, sm: { label: 'Small' }, med: { label: 'Medium' }, lg: { label: 'Large' }, huge: { label: 'Huge' } },
  activityActivationTypes: { action: { label: 'Action' }, bonus: { label: 'Bonus Action' }, reaction: { label: 'Reaction' } },
  characterFlags: { elvenAccuracy: { abilities: ['dex', 'int', 'wis', 'cha'] } },
}
CONFIG.specialStatusEffects = { CONCENTRATING: 'concentrating' }
settings.set('messageMode', 'public')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)
settings.set('attackRollVisibility', 'hideAC')
// dnd5e's English (lang/en.json), as a summon's labels and the module's line are written in it; and
// core's Localization#format, filling a string's {names}.
Object.assign(game.i18n.translations, {
  'DND5E.SUMMON.Profile.ChallengeRatingLabel': 'Challenge Rating of {cr} or lower',
  'DND5E.SUMMON.Action.Summon': 'Summon',
  'SENDINGSTONE.Roll.SummonChoice': 'Chosen on Sending Stone: {choice}',
})
game.i18n.format = function (key, data = {}) {
  return this.localize(key).replace(/\{(\w+)\}/g, (match, name) => ((name in data) ? String(data[name]) : match))
}
globalThis._loc ??= (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key))

/**
 * Arithmetic as dnd5e's simplifyRollFormula and simplifyBonus work it out of the formulas these
 * summons have, their data put in already: numbers, + - * / and floor; anything else, such as dice,
 * kept as it is written.
 * @param {string} formula
 * @returns {number|null}
 */
const arithmetic = formula => {
  const text = String(formula ?? '').trim()
  if (!text || !/^[\d\s+\-*/().]*$/.test(text.replace(/floor/g, ''))) return null
  return Function('const floor = Math.floor; return (' + text + ')')()
}

const { Actor5e } = await import('./actor5e.mjs')
const {
  AttackActivity, SaveActivity, DamageActivity, HealActivity, Item5e, equip, port, screen, clickSummon, summonFromCard, summonCardHtml,
} = await import('./activity5e.mjs')
const { midi, installMidi } = await import('./midi-fake.mjs')
const { renderCard } = await import('./dish-core.mjs')
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  dice: {
    DamageRoll,
    // dice/simplify-roll-formula.mjs, for these formulas.
    simplifyRollFormula: formula => {
      const value = arithmetic(formula)
      return (value === null) ? String(formula ?? '').trim() : String(value)
    },
  },
  utils: {
    // utils.mjs:45-49 (5.3.3), formatNumber's whole numbers as they are.
    formatCR: value => ((value === null) ? '—' : ({ 0.125: '⅛', 0.25: '¼', 0.5: '½' }[value] ?? String(value))),
    // utils.mjs:434-444, for these formulas.
    simplifyBonus: (bonus, data = {}) => {
      if (!bonus) return 0
      if (/^-?\d+(\.\d+)?$/.test(String(bonus).trim())) return Number(bonus)
      return arithmetic(Roll.replaceFormulaData(String(bonus), data)) ?? 0
    },
  },
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
foundry.utils.escapeHTML ??= value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return String(html ?? '') } } }

const { companionActor, createToken, placeToken, scene } = await import('./token-core.mjs')

// ---- The users ----
users.activeGM = user('gm', 'Gamemaster', true)
users.get('gm').targets = new Set()
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
if (MIDI) installMidi()

// ---- The creatures summoned, as dnd5e's compendium and the world hold them ----
const CREATURES = {
  'Compendium.dnd5e.monsters.Actor.batCreature00000': { name: 'Bat' },
  'Compendium.dnd5e.monsters.Actor.catCreature00000': { name: 'Cat' },
  'Compendium.dnd5e.monsters.Actor.owlCreature00000': { name: 'Owl' },
  'Compendium.dnd5e.monsters.Actor.wolfCreature0000': { name: 'Wolf' },
  'Compendium.dnd5e.actors24.Actor.bestialSpirit000': { name: 'Bestial Spirit' },
  'Compendium.dnd5e.actors24.Actor.airSpirit0000000': { name: 'Air Elemental Spirit' },
  'Compendium.dnd5e.actors24.Actor.steedSpirit00000': { name: 'Otherworldly Steed' },
}
const MONSTER = name => Object.keys(CREATURES).find(uuid => CREATURES[uuid].name === name)

// ---- The characters ----
const add = actor => { actors.set(actor.id, actor); return actor }
// Slots enough for every case's casting, each at the level it names.
const spells = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => [`spell${level}`, { value: 9, max: 9, level }]))
const profile = (_id, fields = {}) => ({ _id, count: '', cr: '', name: '', uuid: '', level: { min: null, max: null }, types: [], ...fields })
// A spell whose summon activity's duration is the spell's, its concentration too (base-activity.mjs).
const summonSpell = (id, name, level, activity, system = {}) => ({
  id, name, type: 'spell', system: { level, method: 'spell', properties: [], ...system },
  activities: [{ type: 'summon', affects: '', duration: { override: false }, ...activity }],
})
// Find Familiar, 1st: a Bat, a Cat or an Owl, from dnd5e's Monsters, Celestial, Fey or Fiend (dnd5e's
// spells/1st-level/find-familiar.yml, shortened to three).
const FAMILIAR = {
  profiles: [profile('batProfile000000', { uuid: MONSTER('Bat') }), profile('catProfile000000', { uuid: MONSTER('Cat') }),
    profile('owlProfile000000', { uuid: MONSTER('Owl') })],
  creatureTypes: ['celestial', 'fey', 'fiend'],
}
const P = { bat: 'batProfile000000', cat: 'catProfile000000', owl: 'owlProfile000000' }
const thorin = add(new Actor5e({ id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { wis: 3, int: 2 }, skills: { prc: { ability: 'wis' } } }))
alice.character = thorin
// Thorin's levels, which a feature's summon is offered by (base-activity.mjs:209-213): his own, and
// his artificer class's, which a case changes.
const levels = { details: 5, artificer: 3 }
thorin.getRollData = function () {
  return { ...Actor5e.prototype.getRollData.call(this), details: { level: levels.details }, classes: { artificer: { levels: levels.artificer } } }
}
equip(thorin, {
  spells,
  items: [
    summonSpell('findFamiliar', 'Find Familiar', 1, { id: 'ffSummon', ...FAMILIAR }),
    // Summon Beast, 2nd, concentration: a Land or Sea spirit, and an Air one from 3rd.
    summonSpell('summonBeast', 'Summon Beast', 2, {
      id: 'sbSummon',
      profiles: [profile('landProfile00000', { name: 'Land', uuid: MONSTER('Bestial Spirit') }),
        profile('seaProfile000000', { name: 'Sea', uuid: MONSTER('Bestial Spirit') }),
        profile('airProfile000000', { name: 'Air', uuid: MONSTER('Bestial Spirit'), level: { min: 3, max: null } })],
    }, { properties: ['concentration'] }),
    // Summon Air Spirit, 2nd: its one spirit only from 3rd, an Elemental, Medium or Large.
    summonSpell('summonAir', 'Summon Air Spirit', 2, {
      id: 'saSummon', profiles: [profile('airSpiritProfile', { name: 'Air Spirit', uuid: MONSTER('Air Elemental Spirit'), level: { min: 3, max: null } })],
      creatureTypes: ['elemental'], creatureSizes: ['med', 'lg'],
    }),
    // Conjure Animals, 3rd, by Challenge Rating (spells/3rd-level/conjure-animals.yml).
    summonSpell('conjureAnimals', 'Conjure Animals', 3, {
      id: 'caSummon', summon: { mode: 'cr', prompt: true },
      profiles: [['caCr2', '2', 1], ['caCr1', '1', 2], ['caCrHalf', '0.5', 4], ['caCrQuarter', '0.25', 8]].map(([id, cr, n]) =>
        profile(id.padEnd(16, '0'), { cr, count: `${n} * floor((@item.level - 1) / 2)`, types: ['beast'] })),
    }, { properties: ['concentration'] }),
    // Conjure Fey, 6th, by Challenge Rating: one fey of the spell's level or lower.
    summonSpell('conjureFey', 'Conjure Fey', 6, { id: 'cfSummon', summon: { mode: 'cr', prompt: true }, profiles: [profile('cfProfile0000000', { cr: '@item.level', types: ['fey'] })] },
      { properties: ['concentration'] }),
    // Find Steed, 2nd: its one steed, Celestial, Fey or Fiend (dnd5e's 2024 spells/2nd-level/find-steed.yml).
    summonSpell('findSteed', 'Find Steed', 2, {
      id: 'fsSummon', profiles: [profile('steedProfile0000', { uuid: MONSTER('Otherworldly Steed') })], creatureTypes: ['celestial', 'fey', 'fiend'],
    }),
    // Call the Hunt, 2nd: as many wolves as the level it's cast at, to the 4th; and a creature whose
    // compendium is gone, left out.
    summonSpell('callHunt', 'Call the Hunt', 2, {
      id: 'chSummon', profiles: [profile('huntWolves000000', { count: '@item.level', uuid: MONSTER('Wolf'), level: { min: null, max: 4 } }),
        profile('huntLost00000000', { uuid: 'Compendium.gone.monsters.Actor.lostCreature0000' })],
    }),
    // Beast Bond, a feature: one wolf or one owl, each counted "1", which dnd5e's dialog then leaves out.
    { id: 'beastBond', name: 'Beast Bond', type: 'feat', system: {},
      activities: [{ id: 'bbSummon', type: 'summon', affects: '',
        profiles: [profile('bondWolf00000000', { count: '1', uuid: MONSTER('Wolf') }), profile('bondOwl000000000', { count: '1', uuid: MONSTER('Owl') })] }] },
    // Pack of Wolves, a feature: two wolves, once a day, its count a sum dnd5e makes a whole number.
    { id: 'packOfWolves', name: 'Pack of Wolves', type: 'feat', system: { uses: { max: 1, spent: 0, recovery: [{ period: 'lr' }] } },
      activities: [{ id: 'pwSummon', type: 'summon', affects: '', consumption: [{ type: 'itemUses', value: '1' }],
        profiles: [profile('wolvesProfile000', { count: '5 / 2', uuid: MONSTER('Wolf') })] }] },
    // An artificer's Steel Defender, a world NPC, from the 3rd level of the class.
    { id: 'steelDefender', name: 'Steel Defender', type: 'feat', system: {},
      activities: [{ id: 'sdSummon', type: 'summon', affects: '', classIdentifier: 'artificer',
        profiles: [profile('defenderProfile0', { uuid: 'Actor.steelDef', level: { min: 3, max: null } })] }] },
    // A summon with no creature at all, as a fixture may leave it; and a spell whose one creature
    // can't be found, its compendium gone.
    { id: 'oddCall', name: 'Odd Call', type: 'feat', system: {}, activities: [{ id: 'ocSummon', type: 'summon', affects: '' }] },
    summonSpell('lostCall', 'Call the Lost', 1, { id: 'lcSummon', profiles: [profile('lostProfile00000', { uuid: 'Compendium.gone.monsters.Actor.lostCreature0000' })] }),
    // A staff that casts Find Familiar, at 1st, from its charges, through the copy dnd5e keeps.
    { id: 'staffFamiliar', name: 'Staff of the Familiar', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 3, spent: 0 } },
      activities: [{ id: 'sfCast', type: 'cast', spell: { level: 1 }, consumption: [{ type: 'itemUses', value: '1' }] }] },
    { id: 'staffCopy', name: 'Find Familiar', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.staffFamiliar.Activity.sfCast' } },
      system: { level: 1, method: 'spell', properties: [] }, activities: [{ id: 'scSummon', type: 'summon', affects: '', ...FAMILIAR }] },
    // A wand that casts Summon Beast at the 3rd, a level above its own, from its charges, through the
    // copy dnd5e keeps, which dnd5e casts with the 3rd's slot as the Cast activity's level.
    { id: 'wandBeast', name: 'Wand of the Beast', type: 'consumable', system: { properties: [], quantity: 1, uses: { max: 3, spent: 0 } },
      activities: [{ id: 'wbCast', type: 'cast', spell: { level: 3 }, consumption: [{ type: 'itemUses', value: '1' }] }] },
    { id: 'wandCopy', name: 'Summon Beast', type: 'spell', flags: { dnd5e: { cachedFor: '.Item.wandBeast.Activity.wbCast' } },
      system: { level: 2, method: 'spell', properties: ['concentration'] },
      activities: [{ id: 'wcSummon', type: 'summon', affects: '', profiles: [profile('landProfile00000', { name: 'Land', uuid: MONSTER('Bestial Spirit') }),
        profile('seaProfile000000', { name: 'Sea', uuid: MONSTER('Bestial Spirit') }),
        profile('airProfile000000', { name: 'Air', uuid: MONSTER('Bestial Spirit'), level: { min: 3, max: null } })] }] },
    // Summon Beast as a feat's spell, cast free once a day through its forward at its own level.
    { id: 'beastTouched', name: 'Summon Beast (Wild Touched)', type: 'spell', system: { level: 2, method: 'innate', properties: ['concentration'] },
      activities: [{ id: 'btCall', type: 'summon', affects: '', profiles: [profile('landProfile00000', { name: 'Land', uuid: MONSTER('Bestial Spirit') }),
        profile('seaProfile000000', { name: 'Sea', uuid: MONSTER('Bestial Spirit') }),
        profile('airProfile000000', { name: 'Air', uuid: MONSTER('Bestial Spirit'), level: { min: 3, max: null } })] },
      { id: 'btFree', type: 'forward', name: 'Cast (free casting)', activity: { id: 'btCall' },
        consumption: [{ type: 'activityUses', value: '1' }], uses: { max: 1, spent: 0, recovery: [{ period: 'lr' }] } }] },
    // A swarm of twenty-one bats, more than a sheet lists.
    { id: 'batSwarm', name: 'Call the Swarm', type: 'feat', system: {}, activities: [{ id: 'bsSummon', type: 'summon', affects: '',
      profiles: Array.from({ length: 21 }, (_, i) => profile(`swarm${String(i).padStart(2, '0')}`.padEnd(16, '0'), { name: `Bat ${i + 1}`, uuid: MONSTER('Bat') })) }] },
    // Fey Touched's Find Familiar, cast free once a day through its forward.
    { id: 'feyFamiliar', name: 'Find Familiar (Fey Touched)', type: 'spell', system: { level: 1, method: 'innate', properties: [] },
      activities: [{ id: 'fyCall', type: 'summon', affects: '', ...FAMILIAR },
        { id: 'fyFree', type: 'forward', name: 'Cast (free casting)', activity: { id: 'fyCall' },
          consumption: [{ type: 'activityUses', value: '1' }], uses: { max: 1, spent: 0, recovery: [{ period: 'lr' }] } }] },
  ],
})
// Vex, Bob's, with a saving throw to use; and two features that summon Thorin's familiars: his Pact
// of the Chain's, whose activity has the id of Thorin's Find Familiar's, as dnd5e's compendium copies
// keep it, and his own Find Familiar, a character's copy with Thorin's item's id, its activity its own.
const vex = add(new Actor5e({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3 } }))
equip(vex, { items: [{ id: 'sacredFlame', name: 'Sacred Flame', type: 'spell', system: { level: 0, method: 'spell', properties: [] },
  activities: [{ id: 'sfSave', type: 'save', save: ['dex'], dc: 13, affects: 'creature', count: 1, damage: [{ number: 1, denomination: 8, types: ['radiant'] }] }] },
{ id: 'pactFamiliar', name: 'Pact of the Chain', type: 'feat', system: {}, activities: [{ id: 'ffSummon', type: 'summon', affects: '', ...FAMILIAR }] },
{ id: 'findFamiliar', name: 'Find Familiar', type: 'feat', system: {}, activities: [{ id: 'vfSummon', type: 'summon', affects: '', ...FAMILIAR }] }] })
bob.character = vex
// Elowen, Alice's druid, in the arena as a Wolf, dnd5e's form keeping her Find Familiar (transformInto's
// keepSpells): the form a world actor of its own, dnd5e's flags naming her.
const elowen = add(new Actor5e({ id: 'elowen', name: 'Elowen', owners: ['alice'], mods: { wis: 3 } }))
equip(elowen, { spells, items: [summonSpell('elowenFamiliar', 'Find Familiar', 1, { id: 'efSummon', ...FAMILIAR })] })
const elowenWolf = add(new Actor5e({ id: 'elowenWolf', name: 'Elowen (Wolf)', owners: ['alice'], mods: { str: 2 }, flags: { isPolymorphed: true, originalActor: 'elowen' } }))
equip(elowenWolf, { spells, items: [summonSpell('elowenFamiliar', 'Find Familiar', 1, { id: 'efSummon', ...FAMILIAR })] })

// Wren, Bob's warlock, her pact slots at the 3rd: Summon Beast and Call the Hunt, each a 2nd-level
// spell granted as a Pact Magic spell with a free casting a day, which dnd5e casts at her pact
// slots' level (spellcasting-model.mjs:254-257), a level above the spell's own, spending no slot.
const freeCasting = (id, target) => ({ id, type: 'forward', name: 'Cast (free casting)', activity: { id: target },
  consumption: [{ type: 'activityUses', value: '1' }], uses: { max: 1, spent: 0, recovery: [{ period: 'lr' }] } })
const wren = add(new Actor5e({ id: 'wren', name: 'Wren', owners: ['bob'], mods: { cha: 4 } }))
equip(wren, {
  spells: { pact: { value: 2, max: 2, level: 3 } },
  items: [
    { id: 'pactBeast', name: 'Summon Beast', type: 'spell', system: { level: 2, method: 'pact', properties: ['concentration'] },
      activities: [{ id: 'pbCall', type: 'summon', affects: '', profiles: [profile('landProfile00000', { name: 'Land', uuid: MONSTER('Bestial Spirit') }),
        profile('seaProfile000000', { name: 'Sea', uuid: MONSTER('Bestial Spirit') }),
        profile('airProfile000000', { name: 'Air', uuid: MONSTER('Bestial Spirit'), level: { min: 3, max: null } })] }, freeCasting('pbFree', 'pbCall')] },
    { id: 'pactHunt', name: 'Call the Hunt', type: 'spell', system: { level: 2, method: 'pact', properties: [] },
      activities: [{ id: 'phCall', type: 'summon', affects: '',
        profiles: [profile('pactWolves000000', { count: '@item.level', uuid: MONSTER('Wolf'), level: { min: null, max: 4 } })] }, freeCasting('phFree', 'phCall')] },
  ],
})

// The world NPC the Steel Defender summons, unlinked, no player's.
const steelDef = companionActor('steelDef', 'Steel Defender', { linked: false, spec: { mods: { str: 2 }, hp: { value: 20, max: 20, temp: 0 } } })

// ---- The arena ----
const arena = scene('arena', { active: true })
globalThis.canvas ??= {}
canvas.scene ??= arena
// Brakka, Alice's sidekick, linked and on the arena, with a summon of her own.
const brakka = companionActor('brakka', 'Brakka', {
  owners: ['alice'], linked: true, spec: { mods: { str: 3 }, hp: { value: 30, max: 30, temp: 0 } },
  gear: { items: [{ id: 'brakkaCall', name: 'Call the Pack', type: 'feat', system: {},
    activities: [{ id: 'bcSummon', type: 'summon', affects: '', profiles: [profile('brakkaWolves0000', { count: '2', uuid: MONSTER('Wolf') })] }] }] },
})
placeToken(arena, brakka, { id: 'brakkaToken00000', name: 'Brakka', actorLink: true })

// The creatures' documents, as fromUuidSync finds them: the compendium's, the world's NPC, then
// token-core's for a scene's.
const scenesSync = globalThis.fromUuidSync
globalThis.fromUuidSync = (uuid, options) => {
  if (CREATURES[uuid]) return CREATURES[uuid]
  if (uuid === 'Actor.steelDef') return steelDef
  return scenesSync?.(uuid, options) ?? null
}

// ---- The app ----
// Ashlands' app takes Wild Shape too, as a shaped character's sheet is her form's.
const READS = { commands: true, companions: 1, wildShape: 1, summons: 1 }
const OLDER = { commands: true, companions: 1 }
const app = { events: [], polls: [], waiting: new Map(), wake: null, answers: { 'camp-a': READS, 'camp-b': OLDER } }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    app.events.push(body)
    return json({ features: app.answers[body.campaign?.id] ?? OLDER })
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
async function until(test, what, ms = 4000) {
  const end = realNow() + ms
  while (!test()) {
    if (realNow() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
const settle = () => wait(320)
const since = from => app.events.slice(from)
const ofType = (events, type, campaign = 'camp-a') => events.filter(e => (e.type === type) && (e.campaign.id === campaign))
const sheetOf = (id, campaign = 'camp-a', from = 0) => ofType(since(from), 'character.updated', campaign)
  .filter(e => e.data.character.id === id).at(-1)?.data.character.sheet
const companionSheet = (key, campaign = 'camp-a', from = 0) => ofType(since(from), 'companion.updated', campaign)
  .filter(e => e.data.companion.key === key).at(-1)?.data.sheet

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'a-secret', 'camp-b': 'b-secret' })
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'elowen', 'wren'], rolls: true, attacks: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'], rolls: true, attacks: true },
])
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
await until(() => sheetOf('thorin') && sheetOf('thorin', 'camp-b') && sheetOf('elowen') && sheetOf('wren'), "Thorin's, Elowen's and Wren's sheets")
await until(() => companionSheet('brakka'), "Brakka's sheet")
await settle()
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)

// What a sheet lists: every row of its spells, features, actions and inventory, and each activity
// an item lists.
const rowsOf = sheet => [
  ...(sheet?.spells ?? []).flatMap(section => section.spells),
  ...(sheet?.features ?? []).flatMap(section => section.features),
  ...(sheet?.actions ?? []).flatMap(section => section.actions),
  ...(sheet?.inventory?.sections ?? []).flatMap(section => section.items),
]
const rowOf = (sheet, id) => rowsOf(sheet).find(row => row.id === id)
const activityOf = (sheet, id) => rowOf(sheet, id)?.activity ?? null

/* -------------------------------------------- */
/*  U1: the sheet, to a reader and to an older app */
/* -------------------------------------------- */

{
  const reader = sheetOf('thorin')
  const familiar = activityOf(reader, 'findFamiliar')
  assert.equal(familiar?.type, 'summon', `Find Familiar's activity: ${JSON.stringify(familiar)}`)
  assert.deepEqual(familiar.summon, {
    profiles: [['batProfile000000', 'Bat'], ['catProfile000000', 'Cat'], ['owlProfile000000', 'Owl']]
      .map(([id, name]) => ({ id, name, count: null, min: null, max: null, higher: [] })),
    types: [{ key: 'celestial', label: 'Celestial' }, { key: 'fey', label: 'Fey' }, { key: 'fiend', label: 'Fiend' }],
    sizes: [],
  })
  assert.deepEqual(activityOf(reader, 'packOfWolves')?.summon?.profiles.map(({ name, count }) => [name, count]), [['Wolf', '2']], 'two wolves, 2.5 made whole')
  // An older app's: no summon, and a sheet built as before, with no option.
  const older = sheetOf('thorin', 'camp-b')
  for (const id of ['findFamiliar', 'summonBeast', 'conjureAnimals', 'packOfWolves', 'steelDefender']) {
    assert.ok(rowOf(older, id), `${id} is listed to an older app`)
    assert.equal(activityOf(older, id), null, `${id} has no activity to an older app`)
  }
  assert.ok(!JSON.stringify(older).includes('"summon":{'), 'no summon block to an older app')
  const plain = characterSheet(thorin)
  assert.ok(!JSON.stringify(plain).includes('"summon":{') && (activityOf(plain, 'findFamiliar') === null), 'a sheet built with no option has none')
  assert.deepEqual(characterSheet(thorin, undefined, { summons: false }), plain, 'nor one built without summons')
  // The hello's rolls end with summons, true whatever the rolls.
  const hello = app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a')).at(-1)
  assert.deepEqual(Object.keys(hello.data.features.rolls).slice(-2), ['anyAbility', 'summons'], 'summons last')
  assert.equal(hello.data.features.rolls.summons, true)
  // Rolls off: still summons, true.
  const { rollFeatures } = await import(`${MODULE}/scripts/commands.mjs`)
  const off = rollFeatures({ ...settings.get('campaigns')[0], rolls: false })
  assert.deepEqual([off.enabled, off.reason, off.summons], [false, 'off', true], 'rolls off')
  ok("to an app that answers summons: 1, Find Familiar's activity is a summon with its Bat, Cat and Owl, no counts, its types Celestial, Fey and Fiend and no sizes; the Pack of Wolves' two; an older app's sheet the one built with no option, no summon in it; the hello's rolls end with summons, true, its rolls off too")
}
{
  // A heartbeat's answer that starts summons sends Mirkwood Thorin's sheet and Brakka's again, with
  // them; one that stops them, again without. Nothing else in the answer changes. The app's answer is
  // read only as a whole number of 1 or more, as `quiet` and `gmRollMessages` are: 2, a later format,
  // starts them; true, "1", 0 and 1.5, each after 1, stop them; and one that says nothing, as before.
  const { summonReader } = await import(`${MODULE}/scripts/sheet-summon.mjs`)
  const said = [[2, true], [true, false], [1, true], ['1', false], [1, true], [0, false], [1, true], [1.5, false], [1, true], [undefined, false]]
  for (const [summons, reads] of said) {
    const from = app.events.length
    app.answers['camp-b'] = (summons === undefined) ? OLDER : { ...OLDER, summons }
    clock += 31_000
    heartbeat()
    const why = `summons ${JSON.stringify(summons)}`
    await until(() => ofType(since(from), 'bridge.heartbeat', 'camp-b').length, `the heartbeat, ${why}`)
    await settle()
    assert.equal(summonReader('camp-b'), reads, `${why} read as ${reads}`)
    await until(() => sheetOf('thorin', 'camp-b', from) && companionSheet('brakka', 'camp-b', from), `the sheets again, ${why}`)
    await settle()
    assert.equal(activityOf(sheetOf('thorin', 'camp-b', from), 'findFamiliar')?.type ?? null, reads ? 'summon' : null, `Thorin's, ${why}`)
    assert.equal(activityOf(companionSheet('brakka', 'camp-b', from), 'brakkaCall')?.type ?? null, reads ? 'summon' : null, `Brakka's, ${why}`)
  }
  app.answers['camp-b'] = OLDER
  ok("a heartbeat's answer that starts summons, a whole number of 1 or more, 2 among them, sends Thorin's sheet and Brakka's again with their summons; one that stops them, saying true, \"1\", 0, 1.5 or nothing, again without")
}
{
  // A hello's answer that starts summons sends nothing again of its own: the hello's sheets follow
  // it anyway, with them, each once. Then a heartbeat's that stops them, as before.
  const { HELLO_WANTED_HOOK } = await import(`${MODULE}/scripts/constants.mjs`)
  const { summonReader } = await import(`${MODULE}/scripts/sheet-summon.mjs`)
  let from = app.events.length
  app.answers['camp-b'] = { ...OLDER, summons: 1 }
  await Hooks.callAll(HELLO_WANTED_HOOK, 'camp-b')
  await until(() => ofType(since(from), 'bridge.hello', 'camp-b').length, "Mirkwood's hello")
  await until(() => sheetOf('thorin', 'camp-b', from) && companionSheet('brakka', 'camp-b', from), "the hello's sheets")
  await settle()
  const posted = type => ofType(since(from), type, 'camp-b')
  assert.equal(summonReader('camp-b'), true, 'read from the hello')
  assert.equal(posted('character.updated').filter(e => e.data.character.id === 'thorin').length, 1, "Thorin's sheet once")
  assert.equal(posted('companion.updated').filter(e => e.data.companion.key === 'brakka').length, 1, "Brakka's once")
  assert.deepEqual([activityOf(sheetOf('thorin', 'camp-b', from), 'findFamiliar')?.type, activityOf(companionSheet('brakka', 'camp-b', from), 'brakkaCall')?.type],
    ['summon', 'summon'], 'with their summons')
  // A heartbeat's answer that says it again changes nothing, and sends nothing again.
  from = app.events.length
  clock += 31_000
  heartbeat()
  await until(() => ofType(since(from), 'bridge.heartbeat', 'camp-b').length, "Mirkwood's heartbeat")
  await settle()
  assert.deepEqual([posted('character.updated').length, posted('companion.updated').length], [0, 0], 'nothing sent again for the same answer')
  from = app.events.length
  app.answers['camp-b'] = OLDER
  clock += 31_000
  heartbeat()
  await until(() => sheetOf('thorin', 'camp-b', from) && companionSheet('brakka', 'camp-b', from), 'the sheets again, without')
  await settle()
  assert.equal(summonReader('camp-b'), false)
  ok("a hello's answer that starts summons: Thorin's sheet and Brakka's each posted once after the hello, with their summons, nothing sent again for the answer; a heartbeat's that says it again, nothing; one that stops them, again without")
}

/* -------------------------------------------- */
/*  U2: what may be cast, and from where          */
/* -------------------------------------------- */

{
  const reader = sheetOf('thorin')
  // A summon with no creature, listed with nothing to cast.
  assert.ok(rowOf(reader, 'oddCall'), 'the Odd Call is listed')
  assert.equal(activityOf(reader, 'oddCall'), null, 'with no creature, nothing to cast')
  assert.deepEqual([Boolean(rowOf(reader, 'lostCall')), activityOf(reader, 'lostCall')], [true, null], 'a spell whose creature is gone, nothing to cast')
  // The Steel Defender, from the artificer's 3rd level: offered at 3, not at 2.
  assert.deepEqual(activityOf(reader, 'steelDefender')?.summon?.profiles,
    [{ id: 'defenderProfile0', name: 'Steel Defender', count: null, min: null, max: null, higher: [] }], 'the Steel Defender at 3')
  levels.artificer = 2
  assert.equal(activityOf(characterSheet(thorin, undefined, { summons: true }), 'steelDefender'), null, 'not below 3')
  levels.artificer = 3
  // The staff's Cast row: its Find Familiar's, by the Cast's id.
  const staff = activityOf(reader, 'staffFamiliar')
  assert.deepEqual([staff?.type, staff?.id, staff?.summon?.profiles.map(each => each.name)], ['summon', 'sfCast', ['Bat', 'Cat', 'Owl']], 'the staff casts it')
  // The wand's, cast at the 3rd: the spell's own description, Air from the 3rd, with the level the
  // Cast activity casts it at, at which the app offers its Air.
  const wand = rowOf(reader, 'wandBeast')
  assert.deepEqual([wand?.activity?.id, wand?.cast?.level, wand?.activity?.summon?.profiles.map(({ name, min }) => [name, min])],
    ['wbCast', 3, [['Land', null], ['Sea', null], ['Air', 3]]], 'the wand casts it at the 3rd')
  // Brakka's own, and Elowen's as her Wolf, her form's.
  assert.deepEqual(activityOf(companionSheet('brakka'), 'brakkaCall')?.summon?.profiles.map(({ name, count }) => [name, count]), [['Wolf', '2']], "Brakka's")
  assert.deepEqual([activityOf(sheetOf('elowen'), 'elowenFamiliar')?.type, sheetOf('elowen')?.form?.name], ['summon', 'Wolf'], "Elowen's form's")
  // A forward casts it at its own level and no other: the 2nd's Land and Sea, no Air; the summon
  // itself every one.
  const touched = rowOf(reader, 'beastTouched')?.activities ?? []
  const free = touched.find(entry => entry.id === 'btFree')?.activity
  assert.deepEqual([free?.type, free?.id, free?.summon?.profiles], ['summon', 'btFree', [
    { id: 'landProfile00000', name: 'Land', count: null, min: null, max: null, higher: [] },
    { id: 'seaProfile000000', name: 'Sea', count: null, min: null, max: null, higher: [] },
  ]], 'the forward at the 2nd')
  assert.deepEqual(touched.find(entry => entry.id === 'btCall')?.activity?.summon?.profiles.map(({ name, min }) => [name, min]),
    [['Land', null], ['Sea', null], ['Air', 3]], 'the summon itself at any level')
  // Wren's free castings, which dnd5e casts at her pact slots' 3rd, a level above the spells' own:
  // what each summons there, Summon Beast's Air among them and Call the Hunt's wolves counted at the
  // 3rd, as the module casts them.
  const pact = sheetOf('wren')
  const freeOf = (id, forward) => (rowOf(pact, id)?.activities ?? []).find(entry => entry.id === forward)?.activity
  assert.deepEqual([freeOf('pactBeast', 'pbFree')?.id, freeOf('pactBeast', 'pbFree')?.summon?.profiles], ['pbFree', [
    { id: 'landProfile00000', name: 'Land', count: null, min: null, max: null, higher: [] },
    { id: 'seaProfile000000', name: 'Sea', count: null, min: null, max: null, higher: [] },
    { id: 'airProfile000000', name: 'Air', count: null, min: null, max: null, higher: [] },
  ]], "Wren's free casting at her pact slots' 3rd, its Air too")
  assert.deepEqual(freeOf('pactHunt', 'phFree')?.summon?.profiles, [{ id: 'pactWolves000000', name: 'Wolf', count: '3', min: null, max: null, higher: [] }],
    "Wren's Call the Hunt, three wolves at the 3rd")
  ok("no summon with no creature, or none to be found, nor the Steel Defender below the artificer's 3rd level; the staff's Cast row, the wand's at the 3rd, Brakka's sheet and Elowen's form's each have theirs; a forward's what it summons at the level it casts at, no limits, nothing higher: at the spell's own 2nd, Land and Sea, and at a warlock's pact slots' 3rd, Air too and three wolves")
}

/* -------------------------------------------- */
/*  U3: each profile's label, at each level        */
/* -------------------------------------------- */

{
  const reader = sheetOf('thorin')
  const summonOf = id => activityOf(reader, id)?.summon
  assert.deepEqual(summonOf('summonBeast').profiles.map(({ name, count, min, max, higher }) => [name, count, min, max, higher.length]),
    [['Land', null, null, null, 0], ['Sea', null, null, null, 0], ['Air', null, 3, null, 0]], "Summon Beast's limits")
  const cr = value => `Challenge Rating of ${value} or lower`
  const animals = summonOf('conjureAnimals').profiles
  assert.deepEqual(animals.map(({ name, count }) => [name, count]), [[cr(2), '1'], [cr(1), '2'], [cr('½'), '4'], [cr('¼'), '8']], 'Conjure Animals at the 3rd')
  assert.deepEqual(animals[0].higher, [[5, '2'], [6, '2'], [7, '3'], [8, '3'], [9, '4']].map(([level, count]) => ({ level, name: cr(2), count })),
    "CR 2's higher: none at the 4th, as at the 3rd")
  assert.deepEqual(animals[3].higher.map(({ level, count }) => [level, count]), [[5, '16'], [6, '16'], [7, '24'], [8, '24'], [9, '32']])
  const fey = summonOf('conjureFey').profiles
  assert.deepEqual(fey.map(({ name, count }) => [name, count]), [[cr(6), null]], 'Conjure Fey at the 6th')
  assert.deepEqual(fey[0].higher, [7, 8, 9].map(level => ({ level, name: cr(level), count: null })), 'Conjure Fey higher')
  // Types and sizes only where there's a choice.
  assert.deepEqual([summonOf('summonAir').types, summonOf('summonAir').sizes], [[], [{ key: 'med', label: 'Medium' }, { key: 'lg', label: 'Large' }]],
    "Summon Air Spirit's one type, two sizes")
  assert.deepEqual([summonOf('conjureAnimals').types, summonOf('conjureAnimals').sizes], [[], []], 'none')
  // A count by the level, offered to the 4th: higher only within it; the creature that's gone left out.
  assert.deepEqual(summonOf('callHunt').profiles, [{ id: 'huntWolves000000', name: 'Wolf', count: '2', min: null, max: 4,
    higher: [{ level: 3, name: 'Wolf', count: '3' }, { level: 4, name: 'Wolf', count: '4' }] }], "Call the Hunt's wolves to the 4th, its lost creature left out")
  // One steed, its three types.
  assert.deepEqual(summonOf('findSteed'), { profiles: [{ id: 'steedProfile0000', name: 'Otherworldly Steed', count: null, min: null, max: null, higher: [] }],
    types: [{ key: 'celestial', label: 'Celestial' }, { key: 'fey', label: 'Fey' }, { key: 'fiend', label: 'Fiend' }], sizes: [] }, 'Find Steed')
  // At most twenty.
  const swarm = summonOf('batSwarm').profiles
  assert.deepEqual([swarm.length, swarm[0].name, swarm.at(-1).name], [20, 'Bat 1', 'Bat 20'], 'twenty of twenty-one')
  ok("Summon Beast's limits, Air from the 3rd; Conjure Animals by Challenge Rating with dnd5e's labels, ½ and ¼, its counts 1, 2, 4 and 8 and each higher level's where it changes; Conjure Fey's Challenge Rating at each level; a count by the level higher only to its last level, a creature that's gone left out; types and sizes only where there's a choice, Find Steed's three types for its one steed; twenty profiles at most")
}

/* -------------------------------------------- */
/*  The cast                                     */
/* -------------------------------------------- */

let ids = 0
const queue = (campaign, ...commands) => {
  app.waiting.set(campaign, [...(app.waiting.get(campaign) ?? []), ...commands])
  app.wake?.()
}
const results = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
async function send(command, campaign = 'camp-a') {
  queue(campaign, command)
  await until(() => results(command.id).length, `the result of ${command.id}`)
  return results(command.id)[0]
}
const use = (item, activity, fields = {}) => send({ id: `use-${++ids}`, actorId: 'thorin', kind: 'use', item, activity, targets: [], slot: null, ...fields })
const useCard = id => [...messages.values()].find(m => m.flags?.['sending-stone']?.use === id) ?? null
const slots = actor => Object.fromEntries(Object.entries(actor.system.spells).map(([key, pool]) => [key, pool.value]))
const usesOf = (actor, item) => actor.items.get(item).system.uses.spent
const concentratingOn = (actor, item) => [...actor.concentration.effects.values()].filter(e => e.flags.dnd5e.item.id === item)
const refusalOf = made => [made.status, made.reason, made.error ?? null]
const cardsMade = () => messages.size
/** The Summon button on a card's content, as the card draws it under each release. */
const summonButton = card => /data-action="placeSummons"/.test(String(card?.content ?? ''))
// What the cards' Summon buttons have placed so far: a use from the app places nothing.
let placedSeen = 0
const nothingPlaced = () => { assert.equal(screen.summons, 0, 'dnd5e placed nothing as it was used'); assert.equal(screen.placed.length, placedSeen, 'nothing placed') }
const linesOf = html => [...html.querySelectorAll('.sending-stone-summon-choice')]
/** The summoning dialog something opens, once it's drawn, and the promise of its action's end. */
async function dialogOf(start) {
  const before = screen.summonDialogs.length
  const done = start()
  await until(() => (screen.summonDialogs.length > before) && (screen.summonDialogs.at(-1).renders > 0), 'the summoning dialog')
  return { dialog: screen.summonDialogs.at(-1), done }
}
const fieldOf = (dialog, name) => [...dialog.form.elements].find(element => element.name === name) ?? null
const choiceIn = dialog => ({ profile: fieldOf(dialog, 'summons.profile')?.value ?? null, type: fieldOf(dialog, 'summons.creatureType')?.value ?? null })
const sizeIn = dialog => fieldOf(dialog, 'summons.creatureSize')?.value ?? null
/** The words dnd5e's dialog writes for the creature chosen in it. */
const chosenWords = dialog => {
  const select = fieldOf(dialog, 'summons.profile')
  return select?.options?.[select.selectedIndex]?.textContent ?? null
}
/**
 * The Gamemaster clicks a card's Summon button, drawn for them: its dialog, with its configuration
 * as first drawn (`first`), Summon pressed in it.
 */
async function summonThrough(card, expected, why) {
  const { dialog, done } = await dialogOf(async () => clickSummon(card, await renderCard(card)))
  assert.equal(dialog.renders, 1, `${why}: drawn once`)
  if (expected) assert.deepEqual(choiceIn(dialog), expected, `${why}: its first form`)
  dialog.first = structuredClone(dialog.config.summons)
  await dialog.use()
  await done
  placedSeen = screen.placed.length
  return dialog
}

/* -------------------------------------------- */
/*  U4: the cast, nothing placed                   */
/* -------------------------------------------- */

let owlCard = null
let airCard = null
{
  // What dnd5e would do by default: the Gamemaster may summon, and a scene is up.
  const familiar = thorin.items.get('findFamiliar').system.activities.get('ffSummon')
  assert.equal(game.user.isGM, true)
  assert.equal(familiar.canSummon, true, "dnd5e's default would place")
  assert.ok(canvas.scene, 'a scene is up')
  const before = slots(thorin)
  const made = await use('findFamiliar', 'ffSummon', { summon: { profile: P.owl, type: 'fey' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual([made.use, made.damage], [{ type: 'summon' }, null])
  assert.equal(slots(thorin).spell1, before.spell1 - 1, 'a 1st-level slot spent')
  owlCard = useCard(made.id)
  assert.ok(owlCard, 'its card')
  assert.equal(made.messageId, owlCard.id)
  if (!MIDI) assert.equal(owlCard.author?.id ?? owlCard.author, 'alice', "authored by Thorin's player")
  assert.deepEqual(owlCard.flags['sending-stone'].summon, { item: 'findFamiliar', activity: 'ffSummon', profile: P.owl, label: 'Owl', type: 'fey' })
  assert.ok(summonButton(owlCard), "dnd5e's Summon button on it")
  nothingPlaced()
  // The card drawn, and drawn again on the same element: one line, before its buttons.
  const html = await renderCard(owlCard)
  await Hooks.callAll('dnd5e.renderChatMessage', owlCard, html)
  const lines = linesOf(html)
  assert.deepEqual(lines.map(line => line.textContent), ['Chosen on Sending Stone: Owl (Fey)'], 'one line')
  assert.ok(lines[0].nextElementSibling?.matches(DND5E6 ? 'section.icon-row' : '.card-buttons'), 'just before the buttons')
  ok("Find Familiar cast from the app as Owl, Fey, the Gamemaster able to summon and a scene up: a 1st-level slot spent, its card Alice's with dnd5e's Summon button, flagged with the Owl and Fey labelled \"Owl\", nothing placed; done, a summon's use, no damage; the card drawn twice says once, before its buttons, \"Chosen on Sending Stone: Owl (Fey)\"")
}

/* -------------------------------------------- */
/*  U5: the level it's cast at                      */
/* -------------------------------------------- */

{
  const before = slots(thorin)
  const cards = cardsMade()
  let made = await use('summonBeast', 'sbSummon', { slot: 'spell2', summon: { profile: 'airProfile000000' } })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'no Air at the 2nd')
  assert.deepEqual([slots(thorin), cardsMade()], [before, cards], 'nothing spent or posted')
  made = await use('summonBeast', 'sbSummon', { slot: 'spell3', summon: { profile: 'airProfile000000' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  airCard = useCard(made.id)
  assert.equal(slots(thorin).spell3, before.spell3 - 1, 'a 3rd-level slot spent')
  assert.equal(concentratingOn(thorin, 'summonBeast').length, 1, 'concentration begun')
  assert.deepEqual(useCard(made.id).flags['sending-stone'].summon, { item: 'summonBeast', activity: 'sbSummon', profile: 'airProfile000000', label: 'Air' })
  // Summon Air Spirit at the 2nd summons nothing: refused, chosen or not.
  const now = slots(thorin)
  made = await use('summonAir', 'saSummon', { slot: 'spell2' })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'nothing at the 2nd')
  assert.deepEqual([slots(thorin), cardsMade()], [now, cards + 1], 'nothing spent or posted')
  nothingPlaced()
  ok("Summon Beast's Air refused at the 2nd, nothing spent, and cast at the 3rd, concentration begun; Summon Air Spirit refused at the 2nd with nothing chosen, as it summons nothing there")
}

/* -------------------------------------------- */
/*  U6: what's refused                               */
/* -------------------------------------------- */

{
  const before = slots(thorin)
  const cards = cardsMade()
  for (const [summon, why] of [[{ profile: P.owl, colour: 1 }, 'another field'], [{ profile: 7 }, 'a profile not an id'], [{ profile: P.owl, type: 'a b' }, 'a type not a key']]) {
    const made = await use('findFamiliar', 'ffSummon', { summon })
    assert.deepEqual(refusalOf(made), ['failed', 'invalid', 'summon'], why)
  }
  // On a save activity, an attack, damage on its own and an end of concentration.
  let made = await send({ id: `use-${++ids}`, actorId: 'vex', kind: 'use', item: 'sacredFlame', activity: 'sfSave', targets: [], slot: null, summon: { profile: P.owl } })
  assert.deepEqual(refusalOf(made), ['failed', 'invalid', 'summon'], 'on a save')
  made = await send({ id: `atk-${++ids}`, actorId: 'thorin', kind: 'attack', item: 'findFamiliar', activity: 'ffSummon', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [12] }], summon: { profile: P.owl } })
  assert.deepEqual(refusalOf(made), ['failed', 'invalid', 'summon'], 'on an attack')
  made = await send({ id: `alone-${++ids}`, actorId: 'thorin', kind: 'itemDamage', item: 'findFamiliar', activity: 'ffSummon', mode: 0, explicit: false, extras: [], dice: [{ faces: 8, results: [5] }], summon: { profile: P.owl } })
  assert.deepEqual(refusalOf(made), ['failed', 'invalid', 'summon'], 'on damage on its own')
  // Its checks name it among what damage on its own and a recharge never name, behind the test of
  // its kind, as an enchantment is.
  const { checkItemDamageCommand, checkRechargeCommand } = await import(`${MODULE}/scripts/command-rolls.mjs`)
  const plainly = { mode: 0, explicit: false, extras: [] }
  const alone = { kind: 'itemDamage', item: 'findFamiliar', activity: 'ffSummon', ...plainly, dice: [{ faces: 8, results: [5] }] }
  const recharge = { kind: 'recharge', item: 'packOfWolves', ...plainly, dice: [{ faces: 6, results: [5] }] }
  assert.deepEqual([checkItemDamageCommand(alone), checkItemDamageCommand({ ...alone, summon: { profile: P.owl } })], [null, 'item'], 'damage on its own')
  assert.deepEqual([checkRechargeCommand(recharge), checkRechargeCommand({ ...recharge, summon: { profile: P.owl } })], [null, 'item'], 'a recharge')
  made = await send({ id: `end-${++ids}`, actorId: 'thorin', kind: 'endConcentration', concentration: { effect: 'conc' }, mode: 0, explicit: false, extras: [], dice: [], summon: { profile: P.owl } })
  assert.deepEqual([made.status, made.reason], ['failed', 'invalid'], 'on an end of concentration')
  // At a target, or its user; a type or size it doesn't offer.
  made = await use('findFamiliar', 'ffSummon', { targets: [{ combatId: 'fight', combatantId: 'cb-1' }], summon: { profile: P.owl } })
  assert.deepEqual(refusalOf(made), ['failed', 'target', null], 'at a target')
  made = await use('findFamiliar', 'ffSummon', { self: true })
  assert.deepEqual(refusalOf(made), ['failed', 'target', null], 'at its user')
  made = await use('packOfWolves', 'pwSummon', { summon: { profile: 'wolvesProfile000', type: 'beast' } })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'a type the wolves offer no choice of')
  made = await use('findFamiliar', 'ffSummon', { summon: { profile: P.owl, size: 'huge' } })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'a size Find Familiar offers none of')
  made = await use('summonAir', 'saSummon', { slot: 'spell3', summon: { profile: 'airSpiritProfile', type: 'elemental' } })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'the one type Summon Air Spirit gives, no choice')
  made = await use('findFamiliar', 'ffSummon', { summon: { profile: 'catProfile00000x' } })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'a profile it has not')
  // A type or size it has a choice of, but not that one; and the creature that can't be found.
  made = await use('findFamiliar', 'ffSummon', { summon: { profile: P.owl, type: 'beast' } })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'a type not among its three')
  made = await use('summonAir', 'saSummon', { slot: 'spell3', summon: { profile: 'airSpiritProfile', size: 'huge' } })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'a size not among its two')
  made = await use('callHunt', 'chSummon', { summon: { profile: 'huntLost00000000' } })
  assert.deepEqual(refusalOf(made), ['failed', 'creature', null], 'the creature that can\'t be found')
  assert.deepEqual([slots(thorin), usesOf(thorin, 'packOfWolves'), cardsMade()], [before, 0, cards], 'nothing spent or posted')
  ok("refused, nothing spent: a summon with another field, a profile not an id or a type not a key, invalid; one named on a save, an attack, damage on its own or an end of concentration; at a target or its user; a type the wolves offer no choice of, nor Summon Air Spirit with its one, a size Find Familiar offers none of, a type or size not among those offered, a profile it hasn't, or one whose creature can't be found")
}

/* -------------------------------------------- */
/*  U7: nothing to write                             */
/* -------------------------------------------- */

{
  let made = await use('findFamiliar', 'ffSummon')
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.equal(useCard(made.id).flags['sending-stone'].summon, undefined, 'nothing chosen, nothing noted')
  made = await use('packOfWolves', 'pwSummon', { summon: { profile: 'wolvesProfile000' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual([useCard(made.id).flags['sending-stone'].summon, usesOf(thorin, 'packOfWolves')], [undefined, 1], 'the one profile: nothing noted, its use spent')
  made = await use('steelDefender', 'sdSummon', { summon: { profile: 'defenderProfile0' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.equal(useCard(made.id).flags['sending-stone'].summon, undefined)
  nothingPlaced()
  ok("Find Familiar with nothing chosen, the Pack of Wolves and the Steel Defender with their one creature named: done, nothing noted on their cards, where dnd5e asks nothing")
}

/* -------------------------------------------- */
/*  U8: the Summon button, the choice in dnd5e's dialog */
/* -------------------------------------------- */

{
  const owl = await summonThrough(owlCard, { profile: P.owl, type: 'fey' }, 'the Owl')
  assert.deepEqual([owl.config.summons.profile, owl.config.summons.creatureType], [P.owl, 'fey'])
  assert.deepEqual(screen.placed.at(-1), { profile: P.owl, creatureType: 'fey', scaling: 0, item: 'findFamiliar', activity: 'ffSummon' }, 'the Owl, Fey, placed')
  // Summon Beast cast at the 3rd as Air: the dialog at the card's level, Air chosen.
  const air = await summonThrough(airCard, null, 'Summon Beast at the 3rd')
  assert.deepEqual([[...fieldOf(air, 'summons.profile').options].map(option => option.textContent), choiceIn(air).profile],
    [['Land', 'Sea', 'Air'], 'airProfile000000'], 'Air, offered at the 3rd, chosen')
  assert.equal(screen.placed.at(-1).scaling, 1, "at the card's level")
  // A card cast at the 2nd whose flag names Air: dnd5e's default kept, Air never set.
  let made = await use('summonBeast', 'sbSummon', { slot: 'spell2', summon: { profile: 'landProfile00000' } })
  const second = useCard(made.id)
  second.flags['sending-stone'].summon.profile = 'airProfile000000'
  const kept = await summonThrough(second, null, 'an Air at the 2nd')
  assert.notEqual(kept.first.profile, 'airProfile000000', 'not set where the dialog offers it not')
  assert.notEqual(kept.config.summons.profile, 'airProfile000000')
  assert.deepEqual([...fieldOf(kept, 'summons.profile').options].map(option => option.value), ['landProfile00000', 'seaProfile000000'])
  // Conjure Animals at the 5th as its Challenge Rating 1: the line by the count there, chosen.
  made = await use('conjureAnimals', 'caSummon', { slot: 'spell5', summon: { profile: 'caCr100000000000' } })
  const animals = useCard(made.id)
  assert.deepEqual(linesOf(await renderCard(animals)).map(line => line.textContent), ['Chosen on Sending Stone: 4 × Challenge Rating of 1 or lower'])
  let chosen = await summonThrough(animals, { profile: 'caCr100000000000', type: null }, 'Conjure Animals at the 5th')
  assert.equal(chosenWords(chosen), '4 × Challenge Rating of 1 or lower', "as dnd5e's dialog writes it")
  // Conjure Animals at the 3rd as its Challenge Rating 2: "1 × " kept, as the others' counts aren't 1;
  // Beast Bond's wolf and owl, each "1": "1 × " left out, as dnd5e's dialog leaves it out of all.
  made = await use('conjureAnimals', 'caSummon', { slot: 'spell3', summon: { profile: 'caCr200000000000' } })
  const one = useCard(made.id)
  assert.deepEqual(linesOf(await renderCard(one)).map(line => line.textContent), ['Chosen on Sending Stone: 1 × Challenge Rating of 2 or lower'])
  chosen = await summonThrough(one, { profile: 'caCr200000000000', type: null }, 'Conjure Animals at the 3rd')
  assert.equal(chosenWords(chosen), '1 × Challenge Rating of 2 or lower', "as dnd5e's dialog writes it")
  made = await use('beastBond', 'bbSummon', { summon: { profile: 'bondOwl000000000' } })
  const bond = useCard(made.id)
  assert.equal(bond.flags['sending-stone'].summon.label, 'Owl')
  assert.deepEqual(linesOf(await renderCard(bond)).map(line => line.textContent), ['Chosen on Sending Stone: Owl'])
  chosen = await summonThrough(bond, { profile: 'bondOwl000000000', type: null }, 'Beast Bond')
  assert.deepEqual([[...fieldOf(chosen, 'summons.profile').options].map(option => option.textContent), chosenWords(chosen)], [['Wolf', 'Owl'], 'Owl'],
    "as dnd5e's dialog writes them")
  // Summon Air Spirit at the 3rd, Large: its one spirit and the size, written and chosen.
  made = await use('summonAir', 'saSummon', { slot: 'spell3', summon: { profile: 'airSpiritProfile', size: 'lg' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  const large = useCard(made.id)
  assert.deepEqual(large.flags['sending-stone'].summon, { item: 'summonAir', activity: 'saSummon', profile: 'airSpiritProfile', label: 'Air Spirit', size: 'lg' })
  assert.deepEqual(linesOf(await renderCard(large)).map(line => line.textContent), ['Chosen on Sending Stone: Air Spirit (Large)'])
  chosen = await summonThrough(large, { profile: 'airSpiritProfile', type: null }, 'Summon Air Spirit')
  assert.deepEqual([sizeIn(chosen), chosen.first.creatureSize, chosen.config.summons.creatureSize], ['lg', 'lg', 'lg'], 'Large, in its first form')
  assert.deepEqual([screen.placed.at(-1).profile, screen.placed.at(-1).creatureSize, screen.placed.at(-1).scaling], ['airSpiritProfile', 'lg', 1], 'placed Large')
  // Find Steed, its one steed a Fiend: the type alone, written and chosen.
  made = await use('findSteed', 'fsSummon', { summon: { profile: 'steedProfile0000', type: 'fiend' } })
  const steed = useCard(made.id)
  assert.deepEqual(steed.flags['sending-stone'].summon, { item: 'findSteed', activity: 'fsSummon', profile: 'steedProfile0000', label: 'Otherworldly Steed', type: 'fiend' })
  assert.deepEqual(linesOf(await renderCard(steed)).map(line => line.textContent), ['Chosen on Sending Stone: Otherworldly Steed (Fiend)'])
  chosen = await summonThrough(steed, { profile: 'steedProfile0000', type: 'fiend' }, 'Find Steed')
  assert.equal(chosen.config.summons.creatureType, 'fiend')
  // A card whose flag names a type or a size its dialog doesn't offer, as only a card out of date
  // carries (written by the case): dnd5e's default kept, never that one.
  made = await use('findFamiliar', 'ffSummon', { summon: { profile: P.owl, type: 'fey' } })
  const beastly = useCard(made.id)
  beastly.flags['sending-stone'].summon.type = 'beast'
  chosen = await summonThrough(beastly, { profile: P.owl, type: '' }, 'a Beast named on Find Familiar')
  assert.deepEqual([chosen.first.creatureType ?? null, chosen.config.summons.creatureType], [null, ''], 'no Beast set')
  made = await use('summonAir', 'saSummon', { slot: 'spell3', summon: { profile: 'airSpiritProfile', size: 'lg' } })
  const huge = useCard(made.id)
  huge.flags['sending-stone'].summon.size = 'huge'
  chosen = await summonThrough(huge, { profile: 'airSpiritProfile', type: null }, 'a Huge size named on Summon Air Spirit')
  assert.deepEqual([chosen.first.creatureSize ?? null, chosen.config.summons.creatureSize, sizeIn(chosen)], [null, '', ''], 'no Huge set')
  // A card whose choice can't be read: no line.
  made = await use('findFamiliar', 'ffSummon', { summon: { profile: P.owl, type: 'fey' } })
  const odd = useCard(made.id)
  const good = structuredClone(odd.flags['sending-stone'].summon)
  for (const [bad, why] of [[{ type: 'a b' }, 'a type not a key'], [{ size: 'x y' }, 'a size not a key'], [{ label: '' }, 'no label'], [{ label: 7 }, 'a label not words'],
    [{ profile: 7 }, 'a profile not an id'], [{ item: '' }, 'no item'], [{ activity: null }, 'no activity']]) {
    odd.flags['sending-stone'].summon = { ...good, ...bad }
    assert.deepEqual(linesOf(await renderCard(odd)), [], `${why}: no line`)
  }
  odd.flags['sending-stone'].summon = good
  assert.equal(linesOf(await renderCard(odd)).length, 1, 'and the line once it can be read')
  ok("the Gamemaster clicks the Owl's Summon button: dnd5e's dialog drawn once with the Owl and Fey chosen, and placed so; Summon Beast at the 3rd offers its Air and has it chosen; an Air named at the 2nd is never set; Conjure Animals at the 5th says \"4 × Challenge Rating of 1 or lower\" and at the 3rd \"1 × Challenge Rating of 2 or lower\", Beast Bond's owl \"Owl\", each as dnd5e's dialog writes it, and has it chosen; Summon Air Spirit Large, its size written and chosen, and placed so; Find Steed's Fiend; a type or size its dialog doesn't offer never set; a choice that can't be read, a type or size not a key, no label, profile, item or activity, draws no line")
}

/* -------------------------------------------- */
/*  U9: the note, and what clears it               */
/* -------------------------------------------- */

{
  const familiar = thorin.items.get('findFamiliar').system.activities.get('ffSummon')
  const defaults = { profile: P.bat, type: '' }
  // A card cast in Foundry, no choice on it, clicked: dnd5e's defaults, even after another card's click.
  const plainClick = async card => (await renderCard(card)).querySelector('[data-action="placeSummons"]').click()
  await plainClick(owlCard)
  const foundryCard = (await familiar.use({ create: { summons: false }, spell: { slot: 'spell1' } }, { configure: false }, {})).message
  assert.equal(foundryCard.flags?.['sending-stone'], undefined, 'a card of Foundry\'s own')
  await summonThrough(foundryCard, defaults, "Foundry's card")
  // (a) dnd5e places a summoning: the note spent.
  await plainClick(owlCard)
  const wolves = [...messages.values()].find(m => m.flags?.['sending-stone']?.use && (m.getAssociatedActivity?.()?.id === 'pwSummon'))
  await summonFromCard(wolves)
  placedSeen = screen.placed.length
  let opened = await dialogOf(() => summonFromCard(owlCard))
  assert.deepEqual(choiceIn(opened.dialog), defaults, '(a) spent as dnd5e placed the wolves')
  await opened.dialog.use(); await opened.done; placedSeen = screen.placed.length
  // (b) another activity used from the app: kept.
  await plainClick(owlCard)
  const save = await send({ id: `use-${++ids}`, actorId: 'vex', kind: 'use', item: 'sacredFlame', activity: 'sfSave', targets: [], slot: null })
  assert.equal(save.status, 'done', JSON.stringify(save))
  Hooks.call('dnd5e.preUseActivity', vex.items.get('sacredFlame').system.activities.get('sfSave'), {}, { configure: true }, {})
  opened = await dialogOf(() => summonFromCard(owlCard))
  assert.deepEqual(choiceIn(opened.dialog), { profile: P.owl, type: 'fey' }, '(b) kept through a save, from the app or by hand')
  await opened.dialog.use(); await opened.done; placedSeen = screen.placed.length
  // (c) the same activity used from the app, with no dialog: kept.
  await plainClick(owlCard)
  const again = await use('findFamiliar', 'ffSummon')
  assert.equal(again.status, 'done', JSON.stringify(again))
  opened = await dialogOf(() => summonFromCard(owlCard))
  assert.deepEqual(choiceIn(opened.dialog), { profile: P.owl, type: 'fey' }, '(c) kept through the app\'s own use')
  await opened.dialog.use(); await opened.done; placedSeen = screen.placed.length
  // (d) the same activity used by hand, its dialog to open: forgotten.
  await plainClick(owlCard)
  Hooks.call('dnd5e.preUseActivity', familiar, {}, { configure: true }, {})
  opened = await dialogOf(() => summonFromCard(owlCard))
  assert.deepEqual(choiceIn(opened.dialog), defaults, '(d) forgotten as it\'s used by hand')
  await opened.dialog.use(); await opened.done; placedSeen = screen.placed.length
  // Vex's two: his Pact of the Chain, another item whose activity has the id of Thorin's Find
  // Familiar's, as dnd5e's compendium copies keep it; and his own Find Familiar, an item with Thorin's
  // item's id, its activity another. Their cards are Foundry's own.
  const pact = vex.items.get('pactFamiliar').system.activities.get('ffSummon')
  const copy = vex.items.get('findFamiliar').system.activities.get('vfSummon')
  const cardOf = async activity => (await activity.use({ create: { summons: false } }, { configure: false }, {})).message
  const vexCards = [[await cardOf(pact), "(e) another item's, its activity's id the same"], [await cardOf(copy), "(f) an item's of the same id, another activity's"]]
  for (const [card, why] of vexCards) {
    // Its dialog drawn first: it takes the note and sets nothing, its activity not the one noted.
    await plainClick(owlCard)
    opened = await dialogOf(() => summonFromCard(card))
    assert.deepEqual(choiceIn(opened.dialog), defaults, `${why}: nothing set`)
    await opened.dialog.close(); await opened.done
    opened = await dialogOf(() => summonFromCard(owlCard))
    assert.deepEqual(choiceIn(opened.dialog), defaults, `${why}: the note taken all the same`)
    await opened.dialog.close(); await opened.done
  }
  for (const [activity, why] of [[pact, "(g) another item's, its activity's id the same"], [copy, "(h) an item's of the same id, another activity's"]]) {
    // Used by hand: the note kept, as it isn't the activity noted.
    await plainClick(owlCard)
    Hooks.call('dnd5e.preUseActivity', activity, {}, { configure: true }, {})
    opened = await dialogOf(() => summonFromCard(owlCard))
    assert.deepEqual(choiceIn(opened.dialog), { profile: P.owl, type: 'fey' }, `${why}, used by hand: kept`)
    await opened.dialog.use(); await opened.done; placedSeen = screen.placed.length
  }
  // (i) A dialog already open, drawn again as the Gamemaster changes it, after a click: it takes
  // nothing, their change kept, and the note left for the dialog the click opens.
  opened = await dialogOf(() => summonFromCard(foundryCard))
  assert.deepEqual(choiceIn(opened.dialog), defaults, '(i) the open dialog')
  await plainClick(owlCard)
  await opened.dialog.choose('summons.profile', P.cat)
  assert.deepEqual([opened.dialog.renders, choiceIn(opened.dialog), opened.dialog.config.summons.profile], [2, { profile: P.cat, type: '' }, P.cat], '(i) the Cat kept')
  await opened.dialog.close(); await opened.done
  opened = await dialogOf(() => summonFromCard(owlCard))
  assert.deepEqual(choiceIn(opened.dialog), { profile: P.owl, type: 'fey' }, '(i) the note left for the next')
  await opened.dialog.use(); await opened.done; placedSeen = screen.placed.length
  ok("the note of a click: a card cast in Foundry clicked gets dnd5e's defaults; spent as dnd5e places a summoning; kept through another activity's use, from the app or by hand, and the same one's from the app; forgotten as that activity is used by hand; taken, with nothing set, by another item's dialog whose activity's id is the same, or another activity's of an item whose id is; kept through either's use by hand; never taken as an open dialog is drawn again, the Gamemaster's change kept")
}

/* -------------------------------------------- */
/*  U10: through Midi-QOL's workflow                 */
/* -------------------------------------------- */

if (MIDI) {
  midi.settings.autoRemoveSummonedCreature = true
  const made = await use('summonBeast', 'sbSummon', { slot: 'spell3', summon: { profile: 'seaProfile000000' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  const card = useCard(made.id)
  assert.deepEqual(card.flags['sending-stone'].summon, { item: 'summonBeast', activity: 'sbSummon', profile: 'seaProfile000000', label: 'Sea' })
  assert.ok(summonButton(card), "Midi's card keeps dnd5e's Summon button")
  nothingPlaced()
  const [concentration] = concentratingOn(thorin, 'summonBeast').slice(-1)
  assert.ok(concentration, 'concentration begun')
  assert.equal(concentration.flags.dnd5e.dependents, undefined, 'nothing tied to it, as nothing was placed')
  assert.equal(linesOf(await renderCard(card)).length, 1, 'the line on it')
  await summonThrough(card, { profile: 'seaProfile000000', type: null }, "Midi's card")
  delete midi.settings.autoRemoveSummonedCreature
  ok("through Midi-QOL's workflow: Summon Beast as Sea, nothing placed, the card flagged with dnd5e's Summon button and the line on it, concentration begun with nothing tied to it; its Summon button has the Sea chosen")
}

/* -------------------------------------------- */
/*  U11-U14: a staff, a forward, a companion, a form  */
/* -------------------------------------------- */

{
  const before = slots(thorin)
  let made = await use('staffFamiliar', 'sfCast', { summon: { profile: P.owl } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual(useCard(made.id).flags['sending-stone'].summon, { item: 'staffCopy', activity: 'scSummon', profile: P.owl, label: 'Owl' }, "the spell's copy's")
  assert.deepEqual([usesOf(thorin, 'staffFamiliar'), slots(thorin)], [1, before], "the staff's charge spent, no slot")
  await summonThrough(useCard(made.id), { profile: P.owl, type: '' }, "the staff's")
  // The wand's Summon Beast, cast at the 3rd as Air: checked there, a charge spent and no slot; its
  // Summon button's dialog at the 3rd.
  made = await use('wandBeast', 'wbCast', { summon: { profile: 'airProfile000000' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual(useCard(made.id).flags['sending-stone'].summon, { item: 'wandCopy', activity: 'wcSummon', profile: 'airProfile000000', label: 'Air' }, "the wand's copy's")
  assert.deepEqual([usesOf(thorin, 'wandBeast'), slots(thorin)], [1, before], "the wand's charge spent, no slot")
  const wand = await summonThrough(useCard(made.id), { profile: 'airProfile000000', type: null }, "the wand's")
  assert.deepEqual([[...fieldOf(wand, 'summons.profile').options].map(option => option.textContent), screen.placed.at(-1).scaling], [['Land', 'Sea', 'Air'], 1],
    'offered at the 3rd')
  made = await use('feyFamiliar', 'fyFree', { summon: { profile: P.cat } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual(useCard(made.id).flags['sending-stone'].summon, { item: 'feyFamiliar', activity: 'fyCall', profile: P.cat, label: 'Cat' }, "the summon's, not the forward's")
  assert.deepEqual([thorin.items.get('feyFamiliar').system.activities.get('fyFree').uses.spent, slots(thorin)], [1, before], "the free casting's use spent, no slot")
  await summonThrough(useCard(made.id), { profile: P.cat, type: '' }, 'the free casting\'s')
  ok("the staff's Find Familiar as Owl, its card the spell's copy's, flagged with it, a charge spent; the wand's Summon Beast as Air at the 3rd, a level above its own, a charge spent; Fey Touched's free casting as Cat, flagged with the summon activity, its use spent and no slot; each card's Summon button has its choice chosen, the wand's at the 3rd")
}
{
  // Wren's free casting of Summon Beast, cast at her pact slots' 3rd: Air, offered only from the 3rd,
  // checked and written there, her use spent and no pact slot; its Summon button's dialog at the 3rd.
  const pact = slots(wren)
  const made = await send({ id: `use-${++ids}`, actorId: 'wren', kind: 'use', item: 'pactBeast', activity: 'pbFree', targets: [], slot: null, summon: { profile: 'airProfile000000' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  const card = useCard(made.id)
  assert.deepEqual(card.flags['sending-stone'].summon, { item: 'pactBeast', activity: 'pbCall', profile: 'airProfile000000', label: 'Air' }, 'Air, at the 3rd')
  assert.deepEqual([wren.items.get('pactBeast').system.activities.get('pbFree').uses.spent, slots(wren)], [1, pact], "the free casting's use spent, no pact slot")
  const air = await summonThrough(card, { profile: 'airProfile000000', type: null }, "Wren's free casting")
  assert.deepEqual([...fieldOf(air, 'summons.profile').options].map(option => option.textContent), ['Land', 'Sea', 'Air'], 'offered at the 3rd')
  assert.equal(screen.placed.at(-1).scaling, 1, 'a level above its own')
  nothingPlaced()
  ok("Wren's free casting of Summon Beast as Air, cast at her pact slots' 3rd: done, flagged with the Air, her use spent and no pact slot; its Summon button's dialog offers Land, Sea and Air and has the Air chosen")
}
{
  let made = await send({ id: `use-${++ids}`, actorId: 'brakka', of: 'thorin', kind: 'use', item: 'brakkaCall', activity: 'bcSummon', targets: [], slot: null })
  assert.equal(made.status, 'done', JSON.stringify(made))
  if (!MIDI) assert.equal(useCard(made.id).author?.id ?? useCard(made.id).author, 'alice', "Brakka's player's")
  const hers = slots(elowen)
  const form = slots(elowenWolf)
  made = await send({ id: `use-${++ids}`, actorId: 'elowen', kind: 'use', item: 'elowenFamiliar', activity: 'efSummon', targets: [], slot: null, summon: { profile: P.bat, type: 'celestial' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.deepEqual(useCard(made.id).flags['sending-stone'].summon, { item: 'elowenFamiliar', activity: 'efSummon', profile: P.bat, label: 'Bat', type: 'celestial' })
  assert.deepEqual([slots(elowen), slots(elowenWolf).spell1], [hers, form.spell1 - 1], "the form's slot, hers untouched")
  nothingPlaced()
  ok("Brakka's Call the Pack cast from the app, its card Alice's; Elowen's Find Familiar as her Wolf, from the form's slots, hers untouched")
}

/* -------------------------------------------- */
/*  U15: whoever asks, and whatever may summon          */
/* -------------------------------------------- */

{
  settings.set('allowSummoning', false)
  alice.permissions = { TOKEN_CREATE: false, ACTOR_CREATE: false }
  assert.equal(alice.can('TOKEN_CREATE'), false)
  for (const by of ['gm', undefined]) {
    const made = await use('findFamiliar', 'ffSummon', { ...(by && { by }), summon: { profile: P.cat, type: 'fiend' } })
    assert.equal(made.status, 'done', JSON.stringify(made))
    const card = useCard(made.id)
    if (!MIDI) assert.equal(card.author?.id ?? card.author, 'alice')
    assert.deepEqual([card.flags['sending-stone'].by ?? null, card.flags['sending-stone'].summon.label], [by ?? null, 'Cat'])
  }
  alice.permissions = {}
  settings.delete('allowSummoning')
  nothingPlaced()
  ok("Allow Summoning off and Alice's role unable to create tokens or actors: the Gamemaster's command and Alice's own both cast, the card Alice's, the Gamemaster's marked by: gm")
}

/* -------------------------------------------- */
/*  U16, U17: the card as each release, and each viewer, draws it */
/* -------------------------------------------- */

if (DND5E6) {
  const html = await renderCard(owlCard)
  const button = html.querySelector('section.icon-row button[data-action="placeSummons"][data-index]')
  assert.ok(button, "6.0.5's Summon button, in its icon row")
  assert.equal(linesOf(html)[0]?.nextElementSibling, button.closest('section.icon-row'), 'the line before the row')
  ok("under dnd5e 6 the card's Summon button is 6.0.5's, in its icon row, the line before it; its click has the choice chosen (U8)")
}
{
  // Alice, who may not summon, is shown the card without the Summon button (hidden under 5.3.3,
  // left out under 6.0.5), and the line all the same.
  const content = await summonCardHtml(owlCard, { asGm: false })
  const html = await renderCard(Object.assign(Object.create(owlCard), { content }), { asGm: false })
  const lines = linesOf(html)
  assert.equal(lines.length, 1, 'one line')
  if (DND5E6) {
    assert.equal(html.querySelector('[data-action="placeSummons"]'), null, 'no Summon button')
    assert.equal(lines[0].parentElement, html.querySelector('.message-content .chat-card'), 'at the end of the card')
    assert.equal(html.querySelector('.message-content .chat-card').lastElementChild, lines[0])
  } else {
    assert.equal(html.querySelector('[data-action="placeSummons"]').hidden, true, 'its Summon button hidden')
    assert.ok(lines[0].nextElementSibling?.matches('.card-buttons'), 'before its buttons')
  }
  ok("drawn for Alice, who may not summon: the line once, before the hidden Summon button's row under dnd5e 5.3.3, at the end of the card under 6.0.5, which leaves the button out")
}

/* -------------------------------------------- */
/*  U18: summoning again                              */
/* -------------------------------------------- */

{
  const owl = companionActor('placedOwl', 'Owl', { linked: false, flags: { dnd5e: { summon: { origin: 'Actor.thorin.Item.findFamiliar' } } } })
  placeToken(arena, owl, { id: 'placedOwlToken00', name: 'Owl', delta: { flags: { dnd5e: { summon: { origin: 'Actor.thorin.Item.findFamiliar' } } } } })
  const made = await use('findFamiliar', 'ffSummon', { summon: { profile: P.owl, type: 'fey' } })
  assert.equal(made.status, 'done', JSON.stringify(made))
  assert.ok(arena.tokens.get('placedOwlToken00'), 'the Owl placed before stays')
  const flagged = [...messages.values()].filter(m => m.flags?.['sending-stone']?.summon?.profile === P.owl)
  assert.ok(flagged.length >= 2 && flagged.includes(owlCard) && flagged.includes(useCard(made.id)), 'two cards, each with its choice')
  ok("Find Familiar cast again while an Owl it placed is on the arena: the Owl stays, and both cards carry their choice, as dnd5e has it")
}

console.log(`summons${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
