// A world for module 0.30.0's runs of what players see (its contract §3.6-§3.7, §3.9): verdict,
// gmrolls, chat6 and foundry-settings. The real module, dnd5e 5.3.3's real dice classes (its 6.0.5
// typed messages modelled under DND5E6=1), a stand-in Foundry core and chat log, and the game's
// language in English: the module's own words, dnd5e's for its settings, from its lang file, and
// Midi-QOL's for its options as the 0.30.0 contract §3.6 has them, Midi's own files never being run or
// loaded. MIDI=1 puts Midi-QOL's settings in the world, at its defaults, with a switch that makes
// them unreadable, and dnd5e's aggregateDamageRolls as dnd5e has it for whole rolls, by type.
// Import first; then `await start()`.
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { actor, settings, user, users } from './stub.mjs'

export const MODULE = process.env.MODULE_DIR
export const MIDI = Boolean(process.env.MIDI)
export const DND5E6 = Boolean(process.env.DND5E6)
import { DND5E5, DND5E6 as DND5E6_ROOT } from './paths.mjs'
const DND5E = `${DND5E5}/module/dice`
export const ok = message => console.log('ok -', message)
export { settings, users }

globalThis.DOMParser = new JSDOM('').window.DOMParser
CONST.DOCUMENT_OWNERSHIP_LEVELS = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }
export const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = {
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])),
  skills: { prc: { label: 'Perception', ability: 'wis' } },
  damageTypes: { fire: { label: 'Fire' }, cold: { label: 'Cold' }, piercing: { label: 'Piercing' } },
  healingTypes: {},
}
// dnd5e's own aggregateDamageRolls splits rolls into parts by damage type; for the whole rolls made
// here, each of one type, that is a part per type, its total the sum of its rolls'.
globalThis.dnd5e = {
  settings: { rulesVersion: 'modern' },
  dice: {
    aggregateDamageRolls(rolls) {
      const types = new Map()
      for (const roll of rolls) {
        const type = roll.options?.type ?? ''
        types.set(type, (types.get(type) ?? 0) + roll.total)
      }
      return [...types].map(([type, total]) => ({ total, options: { type } }))
    },
  },
}
if (DND5E6) {
  game.system.version = '6.0.5'
}

// ---- The game's language ----
const flatten = (object, prefix = '', out = {}) => {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && (typeof value === 'object')) flatten(value, path, out)
    else out[path] = value
  }
  return out
}
const dnd5eLang = flatten(JSON.parse(readFileSync(`${DND5E6 ? DND5E6_ROOT : DND5E5}/lang/en.json`, 'utf8')))
export const words = {
  ...flatten(JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))),
  ...Object.fromEntries(Object.entries(dnd5eLang).filter(([key]) => /^SETTINGS\.DND5E\.(VISIBILITY|SUMMARIZECHAT)\./.test(key))),
}
/** Midi-QOL's words for its options, as the 0.30.0 contract §3.6 has them (MQX lang_en.json). */
export const MIDI_WORDS = {
  autoCheckHitOptions: { none: 'None', all: 'Check - all see result', whisper: 'Check - only GM sees results', gmOnly: 'Check - only GM sees anything' },
  autoCheckSavesOptions: { none: 'Off', allNoRoll: 'Save - All see result only', all: 'Save - All see result + save total', allShow: 'Save - All see Result + Rolls', whisper: 'Save - only GM sees results + rolls', gmOnly: 'Save - only GM sees anything' },
  gmAttackDisplayOptions: { full: 'Full Roll', hideFormula: 'Hide Formula', d20Only: 'D20 Only', attackTotal: 'Attack Total Only', hitMiss: 'Hit/Miss Only', hitMissCrit: 'Hit/Miss/Critical/Fumble', hidden: 'Hidden' },
  gmDamageDisplayOptions: { full: 'Full Roll', totalOnly: 'Damage Total Only', hidden: 'Hidden' },
  playerRollSavesOptions: { none: 'None (private roll)', nonePublic: 'None (public roll)', noneDialogPublic: 'Auto roll and show roll dialog (public roll)', noneDialogPrivate: 'Auto roll and show roll dialog (private roll)', noneDialogSelf: 'Auto roll and show roll dialog (self roll)', noneDialogBlind: 'Auto roll and show roll dialog (blind roll)', chat: 'Chat Message', mtb: 'Monks Token Bar', ftb: 'Flash Token Bar', rer: 'Rippers Epic Rolls' },
  rollNPCSavesOptions: { none: 'Chat Message', auto: 'Auto', autoDialog: 'Auto roll and show roll dialog', mtb: 'Monks Token Bar', ftb: 'Flash Token Bar', rer: 'Rippers Epic Rolls' },
  blindRollDisplayOptions: { hidden: 'Hidden (players see nothing)', obscured: 'Obscured (card shown, result ??)' },
}
/** Load Midi-QOL's words for its options into the game's language, or take them out again. */
export function midiLanguage(loaded) {
  for (const [prefix, options] of Object.entries(MIDI_WORDS)) {
    for (const [value, english] of Object.entries(options)) {
      const key = `midi-qol.${prefix}.${value}`
      if (loaded) words[key] = english
      else delete words[key]
    }
  }
}
midiLanguage(MIDI)
game.i18n.localize = key => words[key] ?? key
game.i18n.has = key => Object.hasOwn(words, key)
game.i18n.format = (key, data = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(data, name) ? String(data[name]) : match))

// ---- dnd5e's settings, as it registers them (D5 settings.mjs:538-578; D6 settings.mjs:226-233) ----
game.settings.settings = new Map([
  ['dnd5e.attackRollVisibility', {
    name: 'SETTINGS.DND5E.VISIBILITY.Attack.Name', scope: 'world', default: 'none',
    choices: { all: 'SETTINGS.DND5E.VISIBILITY.Attack.All', hideAC: 'SETTINGS.DND5E.VISIBILITY.Attack.HideAC', none: 'SETTINGS.DND5E.VISIBILITY.Attack.None' },
  }],
  ['dnd5e.challengeVisibility', {
    name: 'SETTINGS.DND5E.VISIBILITY.Challenge.Name', scope: 'world', default: 'player',
    choices: { all: 'SETTINGS.DND5E.VISIBILITY.Challenge.All', player: 'SETTINGS.DND5E.VISIBILITY.Challenge.Player', none: 'SETTINGS.DND5E.VISIBILITY.Challenge.None' },
  }],
  ...(DND5E6 ? [['dnd5e.chatCardSummary', { name: 'SETTINGS.DND5E.SUMMARIZECHAT.Name', scope: 'client', default: true, type: Boolean }]] : []),
])

// ---- Midi-QOL ----
/** Midi's settings, at its own defaults (MQX settings:117, 134-135, 182-185, 204, 209-210). */
export const midiDefaults = {
  autoCheckHit: 'none', autoCheckSaves: 'none', highlightSuccess: true, highLightCriticalAttackOnly: false,
  gmAttackDisplay: 'full', gmDamageDisplay: 'full', mergeCardMultiDamage: false, addFakeDice: false,
  playerRollSaves: 'none', rollNPCSaves: 'auto', rollNPCLinkedSaves: 'auto', rollSavesBlind: [], rollChecksBlind: [],
  rollSkillsBlind: [], blindRollDisplay: 'hidden',
  // Others of Midi's, which the module never sends.
  autoTarget: 'none', confirmAttackDamage: 'none',
}
export const midiSettings = { ...midiDefaults }
export const midiState = { throws: false }
if (MIDI) {
  game.modules.set('midi-qol', { id: 'midi-qol', title: 'Midi QOL', version: '14.1.2', active: true })
  globalThis.MidiQOL = { configSettings: () => { if (midiState.throws) throw new Error('unreadable'); return midiSettings } }
}
game.modules.set('lib-wrapper', { id: 'lib-wrapper', title: 'libWrapper', version: '1.12.13.0', active: false })

/** Run with these settings, then put each back as it was. */
export async function withSettings(changes, fn) {
  const before = Object.fromEntries(Object.keys(changes).map(key => [key, settings.has(key) ? settings.get(key) : undefined]))
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) settings.delete(key)
    else settings.set(key, value)
  }
  try { return await fn() } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) settings.delete(key)
      else settings.set(key, value)
    }
  }
}
/** Run with these Midi-QOL settings, then put each back. */
export async function withMidi(changes, fn) {
  const before = { ...midiSettings }
  Object.assign(midiSettings, changes)
  try { return await fn() } finally {
    for (const key of Object.keys(midiSettings)) if (!(key in before)) delete midiSettings[key]
    Object.assign(midiSettings, before)
  }
}

// ---- Dice ----
const faces = []
const { DiceTerm } = foundry.dice.terms
const randomFace = DiceTerm.prototype.randomFace
DiceTerm.prototype.randomFace = function () { return faces.length ? faces.shift() : randomFace.call(this) }
/** Throw these faces next, in order. */
export const throwing = (...values) => faces.push(...values)
/** A d20 roll of `formula`, these faces thrown; an attack as dnd5e marks it, or as Midi does. */
export async function d20(natural, { formula = '1d20 + 5', target, attack = false, midi = false, advantage, disadvantage, elvenAccuracy } = {}) {
  faces.push(...[natural].flat())
  const options = {
    criticalSuccess: 20, criticalFailure: 1,
    ...(Number.isFinite(target) && { target }),
    ...(attack && { rollType: 'attack' }),
    ...(midi && { 'midi-qol': { rollType: 'attack' } }),
    ...(advantage && { advantage: true }), ...(disadvantage && { disadvantage: true }), ...(elvenAccuracy && { elvenAccuracy: true }),
  }
  return new CONFIG.Dice.D20Roll(formula, {}, options).evaluate()
}
/** A damage roll of a type, on Midi's card in a section, its faces thrown. */
export async function damage(formula, type, { section = 'defaultDamage', thrown = [], flavor, critical = false } = {}) {
  faces.push(...thrown)
  const options = { type, ...(section && { 'midi-qol': { rollType: section } }), ...(flavor && { flavor }), ...(critical && { isCritical: true }) }
  return new CONFIG.Dice.DamageRoll(formula, {}, options).evaluate()
}

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
user('alice', 'Alice')
user('bob', 'Bob')
export const thorin = actor('thorin', 'Thorin', ['alice'])
export const vex = actor('vex', 'Vex', ['bob'])
export const goblin = actor('goblin', 'Goblin', [], 'npc')
export const orc = actor('orc', 'Orc', [], 'npc')
const tokens = new Map()
const place = (id, of) => { tokens.set(`Scene.s.Token.${id}`, { id, uuid: `Scene.s.Token.${id}`, actor: of }); return `Scene.s.Token.${id}` }
export const tok = { goblin: place('tgob', goblin), orc: place('torc', orc), vex: place('tvex', vex), thorin: place('tthorin', thorin) }
globalThis.fromUuidSync = uuid => tokens.get(uuid) ?? null

export const descriptor = (who, ac = 15, saved) => ({ name: who.name, img: '', uuid: who.uuid, ac, ...((saved !== undefined) && { saved }) })
export const speakerOf = who => ({ actor: who.id, alias: who.name })

/** Start the module, as Foundry does, with this listener answering. */
export async function start({ fetch } = {}) {
  globalThis.fetch = fetch ?? (async () => ({ ok: true, status: 204, statusText: 'No Content', headers: new Headers() }))
  await import(`${MODULE}/scripts/module.mjs`)
  await Hooks.callAll('init')
  settings.set('listenerUrl', 'https://stone.example')
  settings.set('campaignSecrets', { 'camp-a': 'emberfall-secret' })
  settings.set('secret', 'old-legacy-secret')
  settings.set('chatEvents', true)
  settings.set('campaigns', [{ id: 'camp-a', title: 'Emberfall', characters: ['thorin', 'vex'], groups: [] }])
  await Hooks.callAll('ready')
  const chat = await import(`${MODULE}/scripts/chat-data.mjs`)
  const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
  const [campaign] = getCampaigns()
  const told = message => JSON.parse(JSON.stringify(chat.serializeMessage(message, campaign)))
  return { ...chat, campaign, told }
}
