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
}
const MONSTER = name => Object.keys(CREATURES).find(uuid => CREATURES[uuid].name === name)

// ---- The characters ----
const add = actor => { actors.set(actor.id, actor); return actor }
const spells = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => [`spell${level}`, { value: 2, max: 2, level }]))
const profile = (_id, fields = {}) => ({ _id, count: '', cr: '', name: '', uuid: '', level: { min: null, max: null }, types: [], ...fields })
const summonSpell = (id, name, level, activity, system = {}) => ({
  id, name, type: 'spell', system: { level, method: 'spell', properties: [], ...system }, activities: [{ type: 'summon', affects: '', ...activity }],
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
// Vex, Bob's, with a saving throw to use.
const vex = add(new Actor5e({ id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3 } }))
equip(vex, { items: [{ id: 'sacredFlame', name: 'Sacred Flame', type: 'spell', system: { level: 0, method: 'spell', properties: [] },
  activities: [{ id: 'sfSave', type: 'save', save: ['dex'], dc: 13, affects: 'creature', count: 1, damage: [{ number: 1, denomination: 8, types: ['radiant'] }] }] }] })
bob.character = vex
// Elowen, Alice's druid, in the arena as a Wolf, dnd5e's form keeping her Find Familiar (transformInto's
// keepSpells): the form a world actor of its own, dnd5e's flags naming her.
const elowen = add(new Actor5e({ id: 'elowen', name: 'Elowen', owners: ['alice'], mods: { wis: 3 } }))
equip(elowen, { spells, items: [summonSpell('elowenFamiliar', 'Find Familiar', 1, { id: 'efSummon', ...FAMILIAR })] })
const elowenWolf = add(new Actor5e({ id: 'elowenWolf', name: 'Elowen (Wolf)', owners: ['alice'], mods: { str: 2 }, flags: { isPolymorphed: true, originalActor: 'elowen' } }))
equip(elowenWolf, { spells, items: [summonSpell('elowenFamiliar', 'Find Familiar', 1, { id: 'efSummon', ...FAMILIAR })] })

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
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'elowen'], rolls: true, attacks: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['thorin'], rolls: true, attacks: true },
])
await Hooks.callAll('ready')
const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
await until(() => sheetOf('thorin') && sheetOf('thorin', 'camp-b') && sheetOf('elowen'), "Thorin's and Elowen's sheets")
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
  // them; one that stops them, again without. Nothing else in the answer changes.
  for (const [answer, reads] of [[{ ...OLDER, summons: 1 }, true], [OLDER, false]]) {
    const from = app.events.length
    app.answers['camp-b'] = answer
    clock += 31_000
    heartbeat()
    await until(() => sheetOf('thorin', 'camp-b', from) && companionSheet('brakka', 'camp-b', from), `the sheets again, summons ${reads}`)
    await settle()
    assert.equal(activityOf(sheetOf('thorin', 'camp-b', from), 'findFamiliar')?.type ?? null, reads ? 'summon' : null, `Thorin's, summons ${reads}`)
    assert.equal(activityOf(companionSheet('brakka', 'camp-b', from), 'brakkaCall')?.type ?? null, reads ? 'summon' : null, `Brakka's, summons ${reads}`)
  }
  ok("a heartbeat's answer that starts summons sends Thorin's sheet and Brakka's again with their summons; one that stops them, again without")
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
  ok("no summon with no creature, or none to be found, nor the Steel Defender below the artificer's 3rd level; the staff's Cast row, Brakka's sheet and Elowen's form's each have theirs; a forward's what it summons at the level it casts at, no limits, nothing higher")
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
  // At most twenty.
  const swarm = summonOf('batSwarm').profiles
  assert.deepEqual([swarm.length, swarm[0].name, swarm.at(-1).name], [20, 'Bat 1', 'Bat 20'], 'twenty of twenty-one')
  ok("Summon Beast's limits, Air from the 3rd; Conjure Animals by Challenge Rating with dnd5e's labels, ½ and ¼, its counts 1, 2, 4 and 8 and each higher level's where it changes; Conjure Fey's Challenge Rating at each level; types and sizes only where there's a choice; twenty profiles at most")
}

console.log(`summons${MIDI ? ' (Midi)' : ''}${DND5E6 ? ' (dnd5e 6)' : ''}: done, ${oks} ok`)
process.exit(0)
