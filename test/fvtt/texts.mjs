// The links in characters' descriptions, acted on from the app: asking the table for a saving throw
// or check on dnd5e's roll request card, a saving throw or check rolled against a description's DC,
// and a description's damage, healing and own roll, with the player's dice, its damage as a critical
// hit's and changed in the app, as the world's rules and the sheet's say; and how chat describes an
// ask.
// The real module; dnd5e 5.3.3's real dice classes (D20Roll, DamageRoll, BasicRoll and their dice)
// and simplifyRollFormula, which its damage links' formulas are written with; its activities' damage
// configurations, ported as far as these use them, as its own classes make them; dnd5e's
// concentration (dnd5e-cards.mjs); dnd5e's createRollLabel, ported from its enrichers.mjs;
// its roll-request-card.hbs, rendered by Handlebars with its dnd5e-dataset helper, ported from its
// utils.mjs; its English strings, read from its lang/en.json; jsdom's HTML parser; and a stand-in
// app. Links come from made-up descriptions, by hash, for their exact shapes: sheet-links.mjs's
// findLink is wrapped by texts-hooks.mjs to answer those, and passes any other hash to the real
// one; and from real ones on Thorin's sheet, in dnd5e 5.3.3's enriched markup, through the module's
// own normaliser and findLink: his biography, an item's, the copy of a spell an item casts, and an
// effect's. MIDI=1 adds Midi-QOL: its settings, its dnd5e.preRollDamage hook (Hooks.ts:917-927), its
// concentration hook (as prompts.mjs has it), a Gamemaster's Midi damage roll left open, with
// the dnd5e.rollDamage hook it waits on (MidiActivityMixin.ts:1070-1074), and its rules for a
// critical hit's damage, ported from its configureDamage (patching.ts:1306-1505), and its
// activities' getDamageConfig, which sets aside the attack mode outside a workflow
// (MidiActivityMixin.ts:1288-1290).
// Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, register } from 'node:module'
import { settings, user, users, actors } from './stub.mjs'

register('./texts-hooks.mjs', import.meta.url)

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
import { DND5E5 } from './paths.mjs'
const DND5E_ROOT = DND5E5
const DND5E = `${DND5E_ROOT}/module/dice`
const ok = message => console.log('ok -', message)

// Foundry's hooks: callAll and call run their handlers at once, as Foundry's do; once runs once.
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
const hooked = name => (registry.get(name) ?? []).length

// The module's long waits, shortened a hundredfold: a minute's watchdog takes 0.6 seconds.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
// The clock, which the harness moves on to test how often the table may be asked.
const realNow = Date.now
let skew = 0
Date.now = () => realNow() + skew
const wait = ms => { skew += ms }

const { core, messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
const { default: DamageRoll } = await import(`${DND5E}/damage-roll.mjs`)
const { default: simplifyRollFormula } = await import(`${DND5E}/simplify-roll-formula.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll, DamageRoll })
CONFIG.Dice.terms.d = BasicDie
const ABILITIES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }
// dnd5e 5.3.3's skills, tools and kinds of vehicle (config.mjs), as far as these use them,
// preLocalized; its enrichment lookup has its tools and, for each kind of vehicle, its label.
const THIEVES_TOOLS = 'Compendium.dnd5e.equipment24.Item.phbtulThievesToo'
CONFIG.DND5E = {
  skills: {
    prc: { label: 'Perception', ability: 'wis' }, ath: { label: 'Athletics', ability: 'str' },
    acr: { label: 'Acrobatics', ability: 'dex' }, slt: { label: 'Sleight of Hand', ability: 'dex' },
  },
  tools: { thief: { ability: 'dex', id: THIEVES_TOOLS } },
  vehicleTypes: { water: 'Water Vehicle' },
  abilities: Object.fromEntries(Object.entries(ABILITIES).map(([key, label]) => [key, { label, abbreviation: key.charAt(0).toUpperCase() + key.slice(1) }])),
  defaultAbilities: { initiative: 'dex', concentration: 'con' },
  enrichmentLookup: { tools: { thief: { ability: 'dex', id: THIEVES_TOOLS }, water: { label: 'Water Vehicle' } } },
  damageTypes: { fire: { label: 'Fire' }, cold: { label: 'Cold' }, slashing: { label: 'Slashing' } },
  healingTypes: { healing: { label: 'Healing' }, temphp: { label: 'Temporary' } },
}

// ---- dnd5e's English, its roll labels and its request card ----
const english = JSON.parse(readFileSync(`${DND5E_ROOT}/lang/en.json`, 'utf8'))
/** A string of dnd5e's en.json, whose keys are partly nested and partly dotted, as Foundry finds it. */
function translation(object, parts) {
  if (!parts.length) return object
  for (let i = parts.length; i > 0; i--) {
    const key = parts.slice(0, i).join('.')
    if ((object !== null) && (typeof object === 'object') && Object.hasOwn(object, key)) {
      const found = translation(object[key], parts.slice(i))
      if (found !== undefined) return found
    }
  }
  return undefined
}
game.i18n.localize = key => {
  const found = translation(english, key.split('.'))
  return (typeof found === 'string') ? found : key
}
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/{[^}]+}/g, match => data[match.slice(1, -1)] ?? match)
game.i18n.has = key => typeof translation(english, key.split('.')) === 'string'

// Foundry's escapeHTML (common/utils/helpers.mjs).
foundry.utils.escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch])

// dnd5e 5.3.3's createRollLabel, ported from module/enrichers.mjs:1446-1501; a tool's name is its
// base item's, from the compendium's index; and Trait.keyLabel, which names a tool the same way, or
// a kind of vehicle by its label.
const Trait = {
  getBaseItem: id => ((id === THIEVES_TOOLS) ? { name: "Thieves' Tools" } : null),
  keyLabel: (key, { trait } = {}) => ((trait === 'tool') ? ({ thief: "Thieves' Tools", water: 'Water Vehicle' })[key] : undefined) ?? key,
}
function createRollLabel(config) {
  const { label: ability, abbreviation } = CONFIG.DND5E.abilities[config.ability] ?? {}
  const skill = CONFIG.DND5E.skills[config.skill]?.label
  const toolUUID = CONFIG.DND5E.enrichmentLookup.tools[config.tool]
  const tool = toolUUID?.id ? Trait.getBaseItem(toolUUID.id, { indexOnly: true })?.name : toolUUID?.label ?? null
  const longSuffix = config.format === 'long' ? 'Long' : 'Short'
  const showDC = config.dc && !config.hideDC

  let label
  switch (config.type) {
    case 'check':
    case 'skill':
    case 'tool':
      if (ability && (skill || tool)) {
        label = game.i18n.format('EDITOR.DND5E.Inline.SpecificCheck', { ability, type: skill ?? tool })
      } else {
        label = ability
      }
      if (config.passive) {
        label = game.i18n.format(
          `EDITOR.DND5E.Inline.${showDC ? 'DC' : ''}Passive${longSuffix}`, { dc: config.dc, check: label },
        )
      } else {
        if (showDC) label = game.i18n.format('EDITOR.DND5E.Inline.DC', { dc: config.dc, check: label })
        label = game.i18n.format(`EDITOR.DND5E.Inline.Check${longSuffix}`, { check: label })
      }
      break
    case 'concentration':
    case 'save':
      if (config.type === 'save') label = ability
      else label = `${game.i18n.localize('DND5E.Concentration')} ${ability ? `(${abbreviation})` : ''}`
      if (showDC) label = game.i18n.format('EDITOR.DND5E.Inline.DC', { dc: config.dc, check: label })
      label = game.i18n.format(`EDITOR.DND5E.Inline.Save${longSuffix}`, { save: label })
      break
    default:
      return ''
  }

  if (config.icon) {
    switch (config.type) {
      case 'check':
      case 'skill':
        label = `<i class="dnd5e-icon" data-src="systems/dnd5e/icons/svg/ability-score-improvement.svg"></i>${label}`
        break
      case 'tool':
        label = `<i class="fas fa-hammer"></i>${label}`
        break
      case 'concentration':
      case 'save':
        label = `<i class="fas fa-shield-heart"></i>${label}`
        break
    }
  }

  return label
}

// Handlebars, with dnd5e's dnd5e-dataset helper (module/utils.mjs:920-934), rendering dnd5e's own
// templates as Foundry's renderTemplate does.
const Handlebars = createRequire(import.meta.url)('handlebars')
Handlebars.registerHelper('dnd5e-dataset', (object, options) => {
  const entries = []
  for (let [key, value] of Object.entries(object ?? {})) {
    if (value === undefined) continue
    key = key.replace(/[A-Z]+(?![a-z])|[A-Z]/g, (a, b) => (b ? '-' : '') + a.toLowerCase())
    entries.push(`data-${key}="${Handlebars.escapeExpression(value)}"`)
  }
  return new Handlebars.SafeString(entries.join(' '))
})
const rendered = []
foundry.applications.handlebars = {
  async renderTemplate(path, data) {
    rendered.push(path)
    const file = String(path).replace(/^systems\/dnd5e\//, `${DND5E_ROOT}/`)
    return Handlebars.compile(readFileSync(file, 'utf8'))(data)
  },
}
globalThis.dnd5e = { settings: { rulesVersion: 'modern' }, enrichers: { createRollLabel }, documents: { Trait } }

// jsdom's HTML parser, which stub.mjs puts in place of the browser's.
const parse = html => new DOMParser().parseFromString(html, 'text/html')

settings.set('messageMode', 'gm') // The Gamemaster rolls privately; players' rolls are public all the same.
settings.set('challengeVisibility', 'player')
settings.set('criticalDamageModifiers', false)
settings.set('criticalDamageMaxDice', false)

const { Character } = await import('./dnd5e-cards.mjs')

// ---- Midi-QOL ----
const midiSettings = { autoCheckSaves: 'allShow', doConcentrationCheck: 'chatOnly', removeConcentration: true }
const midiDamage = { called: 0 }
if (MIDI) {
  game.modules.set('midi-qol', { active: true })
  globalThis.MidiQOL = { configSettings: () => midiSettings }
  // Hooks.ts:917-927: a damage roll with a subject, a spell's, gets the actor's spell damage bonus.
  Hooks.on('dnd5e.preRollDamage', rollConfig => {
    if (!rollConfig.subject) return true
    midiDamage.subject = rollConfig.subject
    return true
  })
  // Midi's concentration hook, from its Hooks.ts: a failed check ends concentration.
  Hooks.on('dnd5e.rollConcentration', (rolls, { subject }) => {
    if (midiSettings.removeConcentration && rolls.some(roll => roll.isFailure)) subject.endConcentration()
  })
}

// dnd5e publishes its dice as its script loads, before any module's init: the module keeps dnd5e's
// own configureDamage as it loads, before Midi-QOL wraps it at its init (module 0.32.0). So the
// module's dice plans are loaded here, before Midi's stand-in replaces it.
globalThis.dnd5e.dice = { DamageRoll }
await import(`${MODULE}/scripts/dice-plan.mjs`)

// Midi's rules for a critical hit's damage: its configureDamage (patching.ts:1332-1505), wrapped
// round dnd5e's as Midi registers it (patching.ts:434), ported read-only for the rules these use:
// "default", dnd5e's settings alone; "maxAll", each die doubled and at its highest; "maxCritRoll", a
// critical hit's dice rolled apart, beside each die, at their highest, inline as its placeCritical
// places them (1306-1322) where no * / or % binds the die; "maxCrit", the most each die could roll
// added beside it, as a number; "maxDamage", each die at its highest; "doubleDice", each die's
// result doubled, by Midi's own "mx" modifier (1180-1190: here, the modifier alone); and
// "bestOfTwo", each die doubled and the highest half kept; and in each, a critical hit's critical
// damage added after it (1494-1502). Numbers are doubled only where the roll's options say so, which
// dnd5e's never do. The rule is the Gamemaster's
// (utils.ts:8643-8645: getCriticalDamage), as the bridge's client is. Installed from the start, so
// that the self-test rolls through it, under "default".
const midiCritical = { gm: 'default', player: 'default' }
if (MIDI) {
  const { DiceTerm, Die, NumericTerm, OperatorTerm } = foundry.dice.terms
  const dnd5eConfigure = DamageRoll.prototype.configureDamage
  const placeCritical = (terms, term, extras, index) => {
    const prev = terms[index - 1]
    const sign = prev instanceof OperatorTerm ? prev.operator : '+'
    return [term, ...extras.flatMap(extra => [new OperatorTerm({ operator: sign, options: { criticalBonusDamage: true } }), extra])]
  }
  DamageRoll.prototype.configureDamage = function (options = { critical: {} }) {
    const rule = game.user?.isGM ? midiCritical.gm : midiCritical.player
    this.terms = this.terms.filter(t => !t.options.criticalBonusDamage && !t.options.criticalFlatBonus)
    this.terms.forEach(term => {
      term.number = term.options.baseNumber ?? term.number
      if (term.options.baseModifiers) term.modifiers = foundry.utils.deepClone(term.options.baseModifiers)
    })
    this.resetFormula()
    const criticalNotAllowed = (this.options.critical?.allow === false) || (options.critical?.allow === false)
    if (criticalNotAllowed || !this.isCritical || (rule === 'default')) {
      const effectiveIsCritical = criticalNotAllowed ? false : this.isCritical
      options.critical.allow = effectiveIsCritical
      this.options.isCritical = effectiveIsCritical
      options.critical.multiplyNumeric ??= game.settings.get('dnd5e', 'criticalDamageModifiers')
      options.critical.powerfulCritical ??= game.settings.get('dnd5e', 'criticalDamageMaxDice')
      dnd5eConfigure.call(this, { critical: options.critical })
      return
    }
    const extras = new Map()
    const addExtra = (term, extra) => extras.set(term, [...(extras.get(term) ?? []), extra])
    for (const [i, term] of this.terms.entries()) {
      const cm = this.options.critical?.multiplier ?? 2
      const cb = (this.options.critical?.bonusDice && (i === 0)) ? this.options.critical.bonusDice : 0
      if (term.modifiers && !term.options.baseModifiers) term.options.baseModifiers = foundry.utils.deepClone(term.modifiers)
      if (term.modifiers) term.modifiers = foundry.utils.deepClone(term.options.baseModifiers)
      term.options.baseNumber = term.options.baseNumber ?? term.number
      term.number = term.options.baseNumber
      if (rule === 'maxCritRoll') {
        if (term instanceof DiceTerm) {
          const critTerm = new Die({ number: term.number + cb, faces: term.faces })
          critTerm.modifiers = foundry.utils.deepClone(term.modifiers)
          critTerm.modifiers.push(`min${term.faces}`)
          critTerm.options = foundry.utils.deepClone(term.options)
          critTerm.options.criticalBonusDamage = true
          addExtra(term, critTerm)
        } else if ((term instanceof NumericTerm) && options.multiplyNumeric) term.number *= cm
      } else if (rule === 'maxCrit') {
        if (term instanceof DiceTerm) {
          const critTerm = new NumericTerm({ number: (term.number + cb) * (term.faces ?? 1) })
          critTerm.options = foundry.utils.deepClone(term.options)
          critTerm.options.criticalBonusDamage = true
          addExtra(term, critTerm)
        } else if ((term instanceof NumericTerm) && options.multiplyNumeric) term.number *= cm
      } else if (rule === 'maxAll') {
        if (term instanceof DiceTerm) {
          term.alter(cm, cb)
          term.modifiers.push(`min${term.faces}`)
        } else if ((term instanceof NumericTerm) && this.options.multiplyNumeric) term.number *= cm
      } else if (rule === 'maxDamage') {
        if (term instanceof DiceTerm) term.modifiers.push(`min${term.faces}`)
      } else if (rule === 'doubleDice') {
        if (term instanceof DiceTerm) term.modifiers.push('mx2')
        else if ((term instanceof NumericTerm) && this.options.multiplyNumeric) term.number *= cm
      } else if (rule === 'bestOfTwo') {
        if (term instanceof DiceTerm) {
          term.modifiers.push(`kh${term.number !== 1 ? term.number : ''}`)
          term.number = (term.number ?? 1) * 2
        }
      }
    }
    if (extras.size) this.terms = this.terms.flatMap((term, i, terms) => (extras.has(term) ? placeCritical(terms, term, extras.get(term), i) : [term]))
    // 1494-1502: critical damage added after, in every rule, taking the first term's options where
    // it has no flavor of its own, marked.
    if (this.options.critical?.bonusDamage) {
      const extra = new Roll(this.options.critical.bonusDamage, this.data)
      for (const term of extra.terms) {
        if (((term instanceof DiceTerm) || (term instanceof NumericTerm)) && !term.options?.flavor) term.options = foundry.utils.deepClone(this.terms[0].options)
        term.options.criticalBonusDamage = true
      }
      if (!(extra.terms[0] instanceof OperatorTerm)) this.terms.push(new OperatorTerm({ operator: '+', options: { criticalBonusDamage: true } }))
      this.terms.push(...extra.terms)
    }
    while ((this.terms.length > 0) && (this.terms.at(-1) instanceof OperatorTerm)) this.terms.pop()
    this.resetFormula()
    this.options.configured = true
  }
}

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
const alice = user('alice', 'Alice')
const bob = user('bob', 'Bob')
user('carol', 'Carol')
user('dave', 'Dave')
const add = actor => { actors.set(actor.id, actor); return actor }
// Thorin is proficient in Athletics and Sleight of Hand, and with Thieves' Tools, at +3; not in
// Acrobatics or Perception. Vex has no tools.
const thorin = add(new Character({
  id: 'thorin', name: 'Thorin', owners: ['alice'], mods: { str: 4, dex: 1, wis: 2 },
  skills: { ath: { ability: 'str' }, slt: { ability: 'dex' }, acr: { ability: 'dex', value: 0 }, prc: { ability: 'wis', value: 0 } },
  tools: { thief: { ability: 'dex' } },
}))
alice.character = thorin
const vex = add(new Character({
  id: 'vex', name: 'Vex', owners: ['bob'], mods: { dex: 3, int: 2 }, concentration: 'int', skills: { ath: { ability: 'str', value: 0 } },
}))
bob.character = vex
// Two players own Pip, and neither has it as their character: its rolls are the Gamemaster's.
const pip = add(new Character({ id: 'pip', name: 'Pip', owners: ['carol', 'dave'] }))
add(new Character({ id: 'stranger', name: 'Stranger', owners: ['bob'] }))
// Thorin's biography, as dnd5e 5.3.3 enriches it (enrichers.mjs: enrichSave, createRequestLink,
// enrichDamage), with a span a player forged and a save in a section only the Gamemaster's players
// see. Foundry's enrichment hands it on as it is.
const BIOGRAPHY = `<p>Thorin swore an oath: <span class="roll-link-group" data-type="save" data-ability="dex" data-dc="15"><a class="roll-link" data-action="roll"><i class="fa-solid fa-dice-d20" inert=""></i>DC 15 Dexterity</a><a class="enricher-action" data-action="postRequest" data-tooltip="EDITOR.DND5E.Inline.RequestRoll" aria-label="Request Roll"><i class="fa-solid fa-comment-dots"></i></a></span> saving throw, or <a class="roll-link-group" data-action="roll" data-type="damage" data-formulas="2d6" data-damage-types="fire" data-roll-type="damage"><span class="roll-link"><i class="fa-solid fa-dice-d20" inert=""></i>2d6</span> Fire</a> damage.</p>
<p><span class="ss-damage roll" data-n="2" data-formulas="100d6" data-types="fire">A forged fire</span></p>
<section class="secret" id="secret-oath"><p>Its price: a <span class="roll-link-group" data-type="save" data-ability="wis" data-dc="13"><a class="roll-link" data-action="roll"><i class="fa-solid fa-dice-d20" inert=""></i>DC 13 Wisdom</a></span> saving throw.</p></section>`
thorin.system.details = { biography: { value: BIOGRAPHY } }
// Foundry's enrichment hands a description on as it is, but for dnd5e's link to an activity's damage,
// `[[/damage activity=<id>]]`, with the attack mode it may name, made as enrichDamage makes it
// (enrichers.mjs:922-943): with the formulas of the activity's damage configuration, as the
// activity's own getDamageConfig gives it, resolved and simplified by dnd5e's own
// simplifyRollFormula, which puts dice first and adds dice of a size together; their types; and its
// UUID.
foundry.applications.ux.TextEditor = {
  implementation: {
    async enrichHTML(html, { relativeTo } = {}) {
      return html.replace(/\[\[\/damage(?: activity=(\w+))?(?: ([\w-]+))?\]\]/g, (match, id, attackMode) => {
        // A bare `[[/damage]]`: the item's first attack, damage or save with damage (enrichers.mjs:922-929).
        const activity = id ? relativeTo?.system?.activities?.get?.(id) : [...(relativeTo?.system?.activities?.values?.() ?? [])]
          .find(each => ['attack', 'damage', 'save'].includes(each.type) && each.damage?.parts?.length)
        if (!activity) return match
        const { rolls } = activity.getDamageConfig({ attackMode })
        const formulas = rolls.map(roll => simplifyRollFormula(Roll.replaceFormulaData(roll.parts.join(' + '), roll.data))).join('&amp;')
        return ACTIVITY_DAMAGE(formulas, rolls.map(roll => roll.options.type).join('&amp;'), activity.uuid, attackMode)
      })
    },
  },
}
// dnd5e 5.3.3's enriched links (enrichers.mjs: createRequestLink with _addDataset, which writes
// hideDC as data-hide-d-c; enrichDamage) and Foundry's inline roll waiting to be rolled.
const SAVE_LINK = (ability, dc, label, hidden = false) => `<span class="roll-link-group" data-type="save" data-ability="${ability}" data-dc="${dc}"${hidden ? ' data-hide-d-c="true"' : ''}><a class="roll-link" data-action="roll"><i class="fa-solid fa-dice-d20" inert=""></i>${label}</a><a class="enricher-action" data-action="postRequest" data-tooltip="EDITOR.DND5E.Inline.RequestRoll" aria-label="Request Roll"><i class="fa-solid fa-comment-dots"></i></a></span>`
const DAMAGE_LINK = (formula, type, label) => `<a class="roll-link-group" data-action="roll" data-type="damage" data-formulas="${formula}" data-damage-types="${type}" data-roll-type="damage"><span class="roll-link"><i class="fa-solid fa-dice-d20" inert=""></i>${formula}</span> ${label}</a>`
const INLINE_ROLL = formula => `<a class="inline-roll roll" data-mode="roll" data-flavor="" data-formula="${formula}"><i class="fas fa-dice-d20"></i>${formula}</a>`
// Thorin's own items, as Foundry's collection of them iterates them, by value; and an effect on him.
class Items extends Map {
  [Symbol.iterator]() { return this.values() }
  get contents() { return [...this.values()] }
  filter(fn) { return this.contents.filter(fn) }
  find(fn) { return this.contents.find(fn) }
  some(fn) { return this.contents.some(fn) }
}
thorin.items = new Items()
Object.defineProperty(thorin, 'itemTypes', { get() { return Object.groupBy(this.items.contents, it => it.type) } })
const ownItem = (id, type, name, html, { system = {}, flags = {} } = {}) => {
  const it = {
    documentName: 'Item', id, type, name, img: `${id}.webp`, uuid: `Actor.thorin.Item.${id}`, parent: thorin, actor: thorin,
    sort: 0, labels: {}, flags, effects: { size: 0 },
    system: { identified: true, quantity: 1, description: { value: html }, activities: [], properties: new Set(), ...system },
    getFlag(scope, key) { return this.flags[scope]?.[key] },
  }
  thorin.items.set(id, it)
  return it
}
// A rod whose frost calls for a save, deals cold damage, and whose whisper's DC its author hid.
// Its checks, as dnd5e 5.3.3 enriches them (enrichers.mjs: enrichCheck): [[/skill ath 13]], and
// [[/tool thief 16 hideDC]], whose DC its author hid; and one in plain words.
const CHECK_LINK = (attrs, label) => `<span class="roll-link-group" ${attrs}><a class="roll-link" data-action="roll"><i class="fa-solid fa-dice-d20" inert=""></i>${label}</a><a class="enricher-action" data-action="postRequest" data-tooltip="EDITOR.DND5E.Inline.RequestRoll" aria-label="Request Roll"><i class="fa-solid fa-comment-dots"></i></a></span>`
ownItem('rod', 'equipment', 'Wand of Frost', `<p>Its frost calls for a ${SAVE_LINK('dex', 14, 'DC 14 Dexterity')} saving throw, or deals ${DAMAGE_LINK('2d6', 'cold', 'Cold')} damage. Its whisper, a ${SAVE_LINK('wis', 16, 'Wisdom', true)} saving throw.`
  + ` Climb it with a ${CHECK_LINK('data-type="skill" data-ability="str" data-skill="ath" data-dc="13"', 'DC 13 Strength (Athletics)')} check, pick its lock with`
  + ` ${CHECK_LINK('data-type="tool" data-ability="dex" data-tool="thief" data-dc="16" data-hide-d-c="true"', "Dexterity (Thieves' Tools)")}, or make a DC 11 Dexterity (Acrobatics) check.</p>`)
// A torch that casts Starry Wisp: dnd5e keeps a copy of the spell on Thorin, flagged for its Cast.
const torch = ownItem('torch', 'equipment', 'Everburning Torch', '<p>It never goes out.</p>')
ownItem('wisp-copy', 'spell', 'Starry Wisp', `<p>A mote of light: a ${SAVE_LINK('dex', 13, 'DC 13 Dexterity')} saving throw, or ${DAMAGE_LINK('1d8', 'fire', 'Fire')} damage, and ${INLINE_ROLL('1d4')} motes.</p>`, {
  flags: { dnd5e: { cachedFor: '.Item.torch.Activity.cast' } }, system: { level: 0, method: 'spell', linkedActivity: { item: torch, canUse: true } },
})
const blessed = {
  documentName: 'ActiveEffect', id: 'blessed', uuid: 'Actor.thorin.ActiveEffect.blessed', name: 'Blessed', img: 'blessed.webp', parent: thorin,
  description: `<p>Add ${INLINE_ROLL('1d4')} to a roll, or make a ${SAVE_LINK('wis', 12, 'DC 12 Wisdom')} saving throw.</p>`,
  statuses: new Set(), disabled: false, isTemporary: true, duration: {},
}
thorin.allApplicableEffects = function* () { yield blessed }
// Damage dnd5e's own link rolls through one of the item's activities, as it does `[[/damage]]`
// naming no formula of its own: enrichDamage gives its link the activity's UUID, and the attack
// mode it names, if any (enrichers.mjs:922-943, 1022-1024). Each activity's damage configuration is
// dnd5e 5.3.3's, as its own class makes it, which dnd5e.documents.activity has (base-activity.mjs:
// 744-791), as far as these use it: a roll for each part, with its roll data, and what each kind
// adds to a critical hit's: a save allows none (save-data.mjs:137-144), a damage activity as it's
// set, with its critical damage (damage-data.mjs:66-74), and an attack its critical damage on its
// first roll (attack-data.mjs:326-328) and, with a melee weapon, on its base damage, its first part,
// its wielder's extra dice, as Savage Attacks gives, but for a ranged weapon attack, as a thrown
// one is (attack-data.mjs:68-71, 410-413; base-activity.mjs:729-733). Under MIDI=1, each activity's
// own getDamageConfig is Midi's, which sets aside the attack mode it's given outside a workflow
// (MidiActivityMixin.ts:1288-1290), as dnd5e's enricher calls it. None of them can be used from the
// sheet, as dnd5e 5 says, so the sheet lists none.
thorin.flags = { dnd5e: {} }
class Activities extends Map {
  [Symbol.iterator]() { return this.values() }
  getByType(...types) { return [...this.values()].filter(activity => types.includes(activity.type)) }
}
class Activity5e {
  constructor(item, id, parts, { allow = false, bonus = '', melee = false } = {}) {
    Object.assign(this, { id, uuid: `${item.uuid}.Activity.${id}`, item, canUse: false, melee })
    this.damage = { parts: parts.map(([formula, kind]) => ({ formula, types: [kind] })), critical: { allow, bonus } }
  }
  get type() { return this.constructor.type }
  getActionType(attackMode = '') {
    const actionType = (this.type === 'attack') ? (this.melee ? 'mwak' : 'rwak') : 'other'
    return ((actionType === 'mwak') && (attackMode?.startsWith('thrown') || (attackMode === 'ranged'))) ? 'rwak' : actionType
  }
  getDamageConfig(config = {}) {
    const rollConfig = structuredClone(config)
    rollConfig.rolls = this.damage.parts.map(({ formula, types }, index) => {
      const roll = { data: { abilities: { str: { mod: 4 } }, mod: 4 }, parts: [formula], options: { type: types[0], types: [...types] } }
      // The character's damage bonus for its kind of action, on its first part, as Reduce's - 1d4
      // (base-activity.mjs:773-777).
      const bonus = (index === 0) ? foundry.utils.getProperty(this.item.actor ?? {}, `system.bonuses.${this.getActionType(rollConfig.attackMode)}.damage`) : null
      if (bonus && !/^0+$/.test(bonus)) roll.parts.push(bonus)
      const dice = thorin.flags.dnd5e.meleeCriticalDamageDice ?? 0
      if ((index === 0) && this.melee && (this.getActionType(rollConfig.attackMode) === 'mwak') && (parseInt(dice) !== 0)) {
        foundry.utils.setProperty(roll, 'options.critical.bonusDice', dice)
      }
      return roll
    })
    if (this.type === 'save') {
      rollConfig.critical ??= {}
      rollConfig.critical.allow ??= false
    } else if (this.type === 'damage') {
      rollConfig.critical ??= {}
      rollConfig.critical.allow ??= this.damage.critical.allow
      rollConfig.critical.bonusDamage ??= this.damage.critical.bonus
    } else if (this.damage.critical.bonus && !rollConfig.rolls[0].options?.critical?.bonusDamage) {
      foundry.utils.setProperty(rollConfig.rolls[0], 'options.critical.bonusDamage', this.damage.critical.bonus)
    }
    return rollConfig
  }
}
class AttackActivity extends Activity5e { static type = 'attack' }
class DamageActivity extends Activity5e { static type = 'damage' }
class SaveActivity extends Activity5e { static type = 'save' }
dnd5e.documents.activity = { AttackActivity, DamageActivity, SaveActivity }
const damageActivity = (item, id, type, parts, options) => {
  const activity = new ({ attack: AttackActivity, damage: DamageActivity, save: SaveActivity })[type](item, id, parts, options)
  if (MIDI) activity.getDamageConfig = function (config = {}) {
    return Object.getPrototypeOf(this).getDamageConfig.call(this, { ...config, attackMode: config.workflow?.attackMode })
  }
  return activity
}
/** An item whose activities dnd5e rolls its description's damage through, stored as dnd5e stores them. */
const activityItem = (id, name, html, activities) => {
  const it = ownItem(id, 'equipment', name, html)
  it.system.activities = new Activities(activities(it).map(activity => [activity.id, activity]))
  it._source = { system: { damage: null, activities: Object.fromEntries([...it.system.activities.values()].map(activity => [
    activity.id, { _id: activity.id, type: activity.type, damage: structuredClone(activity.damage) },
  ])) } }
  return it
}
/** dnd5e 5.3.3's link for an activity's damage, as enrichDamage makes it. */
function ACTIVITY_DAMAGE(formula, type, uuid, attackMode) {
  return `<a class="roll-link-group" data-action="roll" data-type="damage" data-formulas="${formula}" data-damage-types="${type}" data-roll-type="damage"${attackMode ? ` data-attack-mode="${attackMode}"` : ''} data-activity-uuid="${uuid}"><span class="roll-link"><i class="fa-solid fa-dice-d20" inert=""></i>${formula}</span> ${type}</a>`
}
// Basic Poison: a save's damage, never a critical hit's.
activityItem('poison', 'Basic Poison', '<p>A creature takes [[/damage activity=save]] damage.</p>',
  it => [damageActivity(it, 'save', 'save', [['1d4', 'cold']])])
// A javelin, a melee weapon thrown too: its critical damage is its wielder's Strength modifier.
activityItem('javelin', 'Javelin', '<p>It deals [[/damage activity=attack]] damage, or thrown, [[/damage activity=attack thrown]].</p>',
  it => [damageActivity(it, 'attack', 'attack', [['1d6 + 4', 'slashing']], { bonus: '@abilities.str.mod', melee: true })])
// A potion of damage activities: one allowing no critical hit, one whose critical damage throws dice,
// one adding a number to it, and one of two parts, each with the critical damage.
const potion = activityItem('potion', 'Potion of Pain', '<p>Drunk, [[/damage activity=drink]]; thrown, [[/damage activity=splash]];'
  + ' smeared, [[/damage activity=smear]]; sprayed, [[/damage activity=spray]].</p>',
  it => [
    damageActivity(it, 'drink', 'damage', [['2d6', 'cold']]),
    damageActivity(it, 'splash', 'damage', [['1d8', 'fire']], { allow: true, bonus: '1d6' }),
    damageActivity(it, 'smear', 'damage', [['1d6', 'fire']], { allow: true, bonus: '2' }),
    damageActivity(it, 'spray', 'damage', [['1d6', 'fire'], ['1d4', 'cold']], { allow: true, bonus: '1d4' }),
  ])
// A maul whose damage starts with a number, which dnd5e's link writes dice first; a flail with two of
// a die, which it adds together.
activityItem('maul', 'Maul', '<p>It deals [[/damage activity=pound]] damage.</p>',
  it => [damageActivity(it, 'pound', 'attack', [['2 + 1d6', 'slashing']], { melee: true })])
activityItem('flail', 'Flail', '<p>It deals [[/damage activity=lash]] damage.</p>',
  it => [damageActivity(it, 'lash', 'attack', [['1d8 + 4 + 1d8', 'slashing']], { melee: true })])
// A blade of a module's own kind, whose damage dnd5e's own class can't read, though its own can.
activityItem('cursed', 'Cursed Blade', '<p>It deals [[/damage activity=bite]] damage.</p>', it => {
  const bite = damageActivity(it, 'bite', 'attack', [], { melee: true })
  bite.damage.parts = null
  bite.getDamageConfig = (config = {}) => ({
    ...structuredClone(config), rolls: [{ data: {}, parts: ['1d6 + 4'], options: { type: 'slashing', types: ['slashing'] } }],
  })
  return [bite]
})
// A blade of a module's own kind whose own damage has two parts, though dnd5e's own class reads one.
activityItem('twin', 'Twin Blade', '<p>It deals [[/damage activity=slash]] damage.</p>', it => {
  const slash = damageActivity(it, 'slash', 'attack', [['1d6 + 4', 'slashing']], { melee: true })
  slash.getDamageConfig = (config = {}) => ({
    ...structuredClone(config), rolls: [
      { data: {}, parts: ['1d6 + 4'], options: { type: 'slashing', types: ['slashing'] } },
      { data: {}, parts: ['1d4'], options: { type: 'cold', types: ['cold'] } },
    ],
  })
  return [slash]
})
// A potion whose critical damage the app can't be sent: of a die no player rolls, more dice than a
// part may add, a number past 100, or dice a modifier changes, here Foundry's drop; and one whose
// flavor names a kind of damage, which is sent without it.
activityItem('ruin', 'Potion of Ruin', '<p>Thrown, [[/damage activity=trickle]], [[/damage activity=flood]], [[/damage activity=surge]],'
  + ' [[/damage activity=drop]] or [[/damage activity=blaze]].</p>',
  it => [
    damageActivity(it, 'trickle', 'damage', [['1d8', 'fire']], { allow: true, bonus: '1d3' }),
    damageActivity(it, 'flood', 'damage', [['1d8', 'fire']], { allow: true, bonus: '21d6' }),
    damageActivity(it, 'surge', 'damage', [['1d8', 'fire']], { allow: true, bonus: '200' }),
    damageActivity(it, 'drop', 'damage', [['1d8', 'fire']], { allow: true, bonus: '4d6d1' }),
    damageActivity(it, 'blaze', 'damage', [['1d8', 'fire']], { allow: true, bonus: '1d6[fire]' }),
  ])
// Items as a description's origin names them; the made-up descriptions need nothing more of them,
// so they're left off the sheet. Those on it are above.
const item = (actor, id, name, type) => ({ id, name, type, img: `${id}.webp`, uuid: `${actor.uuid}.Item.${id}`, actor, parent: actor })
const flame = item(thorin, 'flame', 'Worn Bardic Eternal Flame', 'equipment')
const wisp = item(thorin, 'wisp', 'Starry Wisp', 'spell')
const pipsDagger = item(pip, 'dagger', 'Dagger', 'weapon')
const vexBlade = item(vex, 'blade', 'Frost Brand', 'weapon')

// ---- Made-up descriptions: their links, by number, as findLink reads them ----
const fixtures = new Map()
globalThis.textFixtures = fixtures
let hashes = 0
/** A description on a character's sheet, with links to act on: its hash. */
function description(actor, origin, links) {
  const hash = (0xe00000 + ++hashes).toString(16).padStart(14, '0')
  fixtures.set(hash, (who, n) => {
    if (who.id !== actor.id) return { refusal: 'gone' }
    const link = links[n]
    return link ? { source: { html: '', relativeTo: origin.item ?? actor }, origin, link } : { refusal: 'link' }
  })
  return hash
}
/** A description edited or removed: no longer on the sheet. */
const remove = hash => fixtures.set(hash, () => ({ refusal: 'gone' }))
const save = (abilities, dc, fields = {}) => ({ kind: 'save', abilities, dc, secret: false, ...fields })
const concentration = (dc, abilities = []) => ({ kind: 'concentration', abilities, dc, secret: false })
const damage = (parts, healing = false) => ({ kind: 'damage', parts, healing })
const roll = formula => ({ kind: 'roll', formula })
const checkLink = (checks, dc, fields = {}) => ({ kind: 'check', checks, dc, secret: false, ...fields })
const athletics = { type: 'skill', ability: 'str', key: 'ath' }
const flameOrigin = { name: 'Worn Bardic Eternal Flame', item: flame }
const flameText = description(thorin, flameOrigin, [
  save(['dex'], 15),
  save(['str', 'dex'], 20),
  concentration(10),
  damage([{ formula: '2d6', types: ['fire'] }]),
  roll('1d4 + 2'),
  save(['wis'], 13, { secret: true }),
  save(['dex'], null),
  damage([{ formula: '1d6', types: ['fire', 'cold'] }, { formula: '1d4', types: ['cold'] }]),
  damage([{ formula: '2d4 + 2', types: ['healing'] }], true),
  damage([{ formula: '5', types: [] }]),
  damage([{ formula: '1d3', types: ['fire'] }]),
  concentration(12, ['con']),
  concentration(null),
  save(['dex'], 18, { hideDC: true }),
  checkLink([athletics], 15),
  checkLink([{ type: 'check', ability: 'int' }, { type: 'check', ability: 'wis' }], null),
  checkLink([athletics, { type: 'skill', ability: 'dex', key: 'acr' }], 12),
  checkLink([{ type: 'tool', ability: 'dex', key: 'thief' }], 15),
  checkLink([{ type: 'skill', ability: 'dex', key: 'slt' }], null, { usingTool: 'thief' }),
  checkLink([athletics], 18, { hideDC: true }),
  checkLink([{ type: 'check', ability: 'str' }], 14, { secret: true }),
  checkLink([{ type: 'tool', ability: 'int', key: 'water' }], 10),
  checkLink([{ type: 'skill', ability: 'dex', key: 'ath' }], 12),
  checkLink([{ type: 'check', ability: 'str' }, athletics, { type: 'tool', ability: 'dex', key: 'thief' }], 13),
  checkLink([{ type: 'skill', ability: 'dex', key: 'acr' }], 15, { usingTool: 'thief' }),
  damage([{ formula: '1d8 + 3', types: ['fire'] }]),
  damage([{ formula: '3', types: ['fire'] }, { formula: '1d6', types: ['cold'] }]),
])
// The copy of a spell an item casts, as findLink finds it: the item, and the spell's copy.
const wispText = description(thorin, { name: 'Starry Wisp (Worn Bardic Eternal Flame)', item: flame, spell: wisp }, [
  damage([{ formula: '1d8', types: ['radiant'] }]),
])
const biography = description(thorin, { name: 'Thorin' }, [save(['con'], 14), roll('1d6')])
const spoofed = description(thorin, { name: '<b>Fire & Ice</b>', item: wisp }, [save(['dex'], 11), damage([{ formula: '1d4', types: ['cold'] }])])
const pipText = description(pip, { name: 'Dagger', item: pipsDagger }, [save(['dex'], 15), checkLink([athletics], 15)])
const vexText = description(vex, { name: 'Frost Brand', item: vexBlade }, [
  save(['dex'], 12), damage([{ formula: '1d6', types: ['cold'] }]), roll('1d4'), concentration(10),
  checkLink([{ type: 'tool', ability: 'dex', key: 'thief' }], 13),
])

// Dice Foundry rolls again, keeps or counts (module 0.22.0): a Great Weapon Fighter's greatsword and
// a d8 more, an exploding d6, the highest three of four d6s.
const modifiedText = description(thorin, flameOrigin, [
  damage([{ formula: '2d6r<=2 + 1d8 + 7', types: ['fire'] }]),
  damage([{ formula: '1d6x', types: ['fire'] }]),
  roll('4d6kh3'),
])

// ---- The app ----
const app = { events: [], polls: [], waiting: new Map(), wake: null }
const json = body => ({
  ok: true, status: 200, statusText: 'OK',
  headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
})
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
const resultFor = id => app.events.find(e => (e.type === 'command.result') && (e.data.id === id))
async function until(test, what, ms = 4000) {
  const end = realNow() + ms
  while (!test()) {
    if (realNow() > end) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => realSetTimeout(resolve, 5))
  }
}
const settle = () => new Promise(resolve => realSetTimeout(resolve, 20))
/** A command from the app, and what came of it: its result, its message and its first roll. */
async function send(fields, campaignId = 'camp-a') {
  const command = { id: `req-${++ids}`, actorId: 'thorin', ...fields }
  app.waiting.set(campaignId, [...(app.waiting.get(campaignId) ?? []), command])
  app.wake?.()
  await until(() => resultFor(command.id), `the result of ${command.id}`)
  await settle()
  const result = resultFor(command.id).data
  const message = messages.get(result.messageId)
  return { command, result, message, roll: message?.rolls[0] }
}
const ask = (text, link, fields = {}, campaignId) => send({ kind: 'ask', text, link, ...fields }, campaignId)
const rollSave = (key, text, link, dice, fields = {}, campaignId) => send({
  kind: 'save', key, mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: dice }], text, link, ...fields,
}, campaignId)
const textDamage = (text, link, dice, fields = {}, campaignId) => send({
  kind: 'textDamage', text, link, mode: 0, explicit: false, extras: [], dice, ...fields,
}, campaignId)
const textRoll = (text, link, dice, fields = {}, campaignId) => send({
  kind: 'textRoll', text, link, mode: 0, explicit: false, extras: [], dice, ...fields,
}, campaignId)
const refused = made => [made.result.status, made.result.reason, made.result.error]
const opened = () => app.events.filter(e => e.type === 'roll.prompt.opened')
const chatted = (messageId, campaignId = 'camp-a') => app.events
  .find(e => (e.type === 'chat.message.created') && (e.campaign?.id === campaignId) && (e.data.message.id === messageId))?.data.message
const faces = made => made.dice.map(die => die.results.map(r => r.result))

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('chatEvents', true)
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret', 'camp-b': 'mirkwood-secret' })
const campaigns = [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex', 'pip'], rolls: true, attacks: true, prompts: true },
  { id: 'camp-b', title: 'Mirkwood', characters: ['vex'], rolls: true, attacks: false, prompts: true },
]
settings.set('campaigns', campaigns)
await Hooks.callAll('ready')
const { diceStatus, selfTest } = await import(`${MODULE}/scripts/dice-plan.mjs`)
await until(() => app.polls.length > 0, 'the first fetch')
assert.equal(diceStatus.ready, true, `self-test: ${diceStatus.error}`)
assert.equal(diceStatus.attacks, true, `attack self-test: ${diceStatus.attacksError}`)

const TEXT_KINDS = ['ask', 'textRoll', 'textDamage']
const textKinds = title => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.title === title)).at(-1)
  .data.features.rolls.kinds.filter(kind => TEXT_KINDS.includes(kind))
assert.deepEqual([textKinds('Ashlands'), textKinds('Mirkwood')], [['ask', 'textRoll', 'textDamage'], ['ask', 'textRoll']])
ok("offers asking the table and a description's own roll where players roll from the app, and a description's damage only where they may attack too")
assert.equal(diceStatus.modifiers, true, `modifiers self-test: ${diceStatus.modifiersError}`)
const rollsFeatures = title => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.title === title)).at(-1).data.features.rolls
assert.deepEqual([rollsFeatures('Ashlands').modifiers, rollsFeatures('Mirkwood').modifiers], [true, false])
ok(`the hello says players may change their damage in the app where a description's damage is rolled${MIDI ? ", even where Midi makes items' uses and its attacks aren't made through it" : ''}, and not where it isn't`)

// ---- Asking the table ----
let before = opened().length
let made = await ask(flameText, 0)
assert.deepEqual(made.result, { id: made.command.id, status: 'done', reason: null, error: null, messageId: made.message.id, visible: true, rolls: [] })
let card = made.message
assert.equal(rendered.at(-1), 'systems/dnd5e/templates/chat/roll-request-card.hbs')
assert.equal(card.author.id, 'alice')
assert.deepEqual(card.speaker, { actor: 'thorin', alias: 'Thorin' })
assert.deepEqual(card.whisper, [])
assert.equal(card.flavor, 'Roll Request: Worn Bardic Eternal Flame')
assert.deepEqual(card.flags, {
  'sending-stone': { request: made.command.id, ask: { actorId: 'thorin', text: flameText, link: 0 } },
  dnd5e: { item: { id: 'flame', uuid: 'Actor.thorin.Item.flame', type: 'equipment' } },
})
assert.match(card.content, /<button data-type="save" data-ability="dex" data-dc="15" data-format="long" data-action="rollRequest" data-visibility="all">/)
let buttons = [...parse(card.content).querySelectorAll('.request-card .card-buttons button')]
assert.deepEqual(buttons.map(b => [b.querySelector('.visible-dc').innerHTML, b.querySelector('.hidden-dc').innerHTML]), [
  ['<i class="fas fa-shield-heart"></i>DC 15 Dexterity saving throw', '<i class="fas fa-shield-heart"></i>Dexterity saving throw'],
])
assert.equal(opened().length, before)
let chat = chatted(card.id)
assert.deepEqual(chat.ask, { type: 'save', abilities: ['dex'], dc: 15, label: 'Worn Bardic Eternal Flame' })
assert.equal(chat.text, 'DC 15 Dexterity saving throw')
assert.equal(chat.character, 'thorin')
ok("asks the table on dnd5e's own roll request card, as the player, from their character, naming the item; prompts no one; and tells the app's chat what it asks")

wait(11_000)
made = await ask(flameText, 1)
card = made.message
buttons = [...parse(card.content).querySelectorAll('button')]
assert.deepEqual(buttons.map(b => ({ ...b.dataset })), ['str', 'dex'].map(ability => ({
  type: 'save', ability, dc: '20', format: 'long', action: 'rollRequest', visibility: 'all',
})))
assert.deepEqual(buttons.map(b => b.querySelector('.visible-dc').textContent), ['DC 20 Strength saving throw', 'DC 20 Dexterity saving throw'])
assert.deepEqual(chatted(card.id).ask, { type: 'save', abilities: ['str', 'dex'], dc: 20, label: 'Worn Bardic Eternal Flame' })
assert.equal(chatted(card.id).text, 'DC 20 Strength saving throw DC 20 Dexterity saving throw')

wait(11_000)
made = await ask(flameText, 2)
card = made.message
buttons = [...parse(card.content).querySelectorAll('button')]
assert.deepEqual(buttons.map(b => ({ ...b.dataset })), [{ type: 'concentration', dc: '10', format: 'short', action: 'rollRequest', visibility: 'all' }])
assert.deepEqual(buttons.map(b => [b.querySelector('.visible-dc').textContent, b.querySelector('.hidden-dc').textContent]), [['DC 10 Concentration ', 'Concentration ']])
assert.deepEqual(chatted(card.id).ask, { type: 'concentration', abilities: [], dc: 10, label: 'Worn Bardic Eternal Flame' })

wait(11_000)
made = await ask(flameText, 6)
buttons = [...parse(made.message.content).querySelectorAll('button')]
assert.deepEqual(buttons.map(b => ({ ...b.dataset })), [{ type: 'save', ability: 'dex', format: 'long', action: 'rollRequest', visibility: 'all' }])
assert.deepEqual(chatted(made.message.id).ask, { type: 'save', abilities: ['dex'], label: 'Worn Bardic Eternal Flame' })
assert.equal(opened().length, before)
// One whose author hid its DC: on its button, marked so, for rolls from the card to be judged by,
// and labelled without it either way, as dnd5e's request has it; the app's chat isn't told it.
wait(11_000)
made = await ask(flameText, 13)
buttons = [...parse(made.message.content).querySelectorAll('button')]
assert.deepEqual(buttons.map(b => ({ ...b.dataset })), [{ type: 'save', ability: 'dex', dc: '18', hideDc: 'true', format: 'long', action: 'rollRequest', visibility: 'all' }])
assert.deepEqual(buttons.map(b => [b.querySelector('.visible-dc').textContent, b.querySelector('.hidden-dc').textContent]), [['Dexterity saving throw', 'Dexterity saving throw']])
assert.deepEqual([chatted(made.message.id).ask, chatted(made.message.id).text], [{ type: 'save', abilities: ['dex'], label: 'Worn Bardic Eternal Flame' }, 'Dexterity saving throw'])
ok("a card for a choice of abilities has a button for each; concentration's, one with no DC and one whose DC its author hid are as dnd5e's request makes them")

wait(11_000)
made = await ask(spoofed, 0)
assert.equal(made.message.flavor, 'Roll Request: &lt;b&gt;Fire &amp; Ice&lt;/b&gt;')
assert.deepEqual(made.message.flags.dnd5e, { item: { id: 'wisp', uuid: 'Actor.thorin.Item.wisp', type: 'spell' } })
assert.equal(chatted(made.message.id).ask.label, '<b>Fire & Ice</b>')
wait(11_000)
made = await ask(biography, 0)
assert.equal(made.message.flavor, 'Roll Request: Thorin')
assert.equal(made.message.flags.dnd5e, undefined)
ok("escapes the name it gives in the card's flavor; a description of no item names its character, and no item")

// The Gamemaster makes Pip's rolls: nobody is prompted all the same, and the DC is hidden from
// players as dnd5e hides it on a Gamemaster's card.
before = opened().length
made = await ask(pipText, 0, { actorId: 'pip' })
assert.equal(made.result.status, 'done')
assert.equal(made.message.author.id, 'gm')
assert.deepEqual(made.message.speaker, { actor: 'pip', alias: 'Pip' })
assert.equal(opened().length, before)
assert.deepEqual(chatted(made.message.id).ask, { type: 'save', abilities: ['dex'], label: 'Dagger' })
assert.equal(chatted(made.message.id).text, 'Dexterity saving throw')
const pipCard = made.message
ok("posted as the Gamemaster, for a character no one player has, the card still prompts no one, and its DC is hidden from players")

settings.set('challengeVisibility', 'all')
await Hooks.callAll('createChatMessage', pipCard)
await settle()
let resent = app.events.filter(e => (e.type === 'chat.message.created') && (e.data.message.id === pipCard.id)).at(-1).data.message
assert.deepEqual([resent.ask.dc, resent.text], [15, 'DC 15 Dexterity saving throw'])
settings.set('challengeVisibility', 'none')
await Hooks.callAll('createChatMessage', messages.get(chat.id))
await settle()
resent = app.events.filter(e => (e.type === 'chat.message.created') && (e.data.message.id === chat.id)).at(-1).data.message
assert.deepEqual([resent.ask.dc, resent.text], [undefined, 'Dexterity saving throw'])
settings.set('challengeVisibility', 'player')
ok("the app's chat has an ask's DC, and its text one label, as dnd5e's Challenge Visibility shows players")

// ---- Asking the table for a check ----
// As dnd5e's request for a choice of checks makes its buttons (enrichers.mjs:
// createCheckRequestButtons, createRequestButton): one for each check, its kind, ability, skill or
// tool, DC and the short format, with the tool a skill is checked using; labelled by createRollLabel.
const ICON_CHECK = '<i class="dnd5e-icon" data-src="systems/dnd5e/icons/svg/ability-score-improvement.svg"></i>'
const ICON_TOOL = '<i class="fas fa-hammer"></i>'
const labelsOf = card => [...parse(card.content).querySelectorAll('button')].map(b => [b.querySelector('.visible-dc').innerHTML, b.querySelector('.hidden-dc').innerHTML])
const datasetsOf = card => [...parse(card.content).querySelectorAll('button')].map(b => ({ ...b.dataset }))
const REQUEST = { action: 'rollRequest', visibility: 'all' }
before = opened().length
wait(31_000)
made = await ask(flameText, 14)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(made.result, { id: made.command.id, status: 'done', reason: null, error: null, messageId: made.message.id, visible: true, rolls: [] })
assert.match(made.message.content, /<button data-type="skill" data-ability="str" data-skill="ath" data-dc="15" data-format="short" data-action="rollRequest" data-visibility="all">/)
assert.deepEqual(labelsOf(made.message), [[`${ICON_CHECK}DC 15 Strength (Athletics)`, `${ICON_CHECK}Strength (Athletics)`]])
assert.deepEqual([made.message.author.id, made.message.speaker, made.message.whisper, made.message.flavor], ['alice', { actor: 'thorin', alias: 'Thorin' }, [], 'Roll Request: Worn Bardic Eternal Flame'])
assert.deepEqual(made.message.flags, {
  'sending-stone': { request: made.command.id, ask: { actorId: 'thorin', text: flameText, link: 14 } },
  dnd5e: { item: { id: 'flame', uuid: 'Actor.thorin.Item.flame', type: 'equipment' } },
})
chat = chatted(made.message.id)
assert.deepEqual([chat.ask, chat.text], [{ type: 'check', checks: [{ type: 'skill', ability: 'str', skill: 'ath' }], dc: 15, label: 'Worn Bardic Eternal Flame' }, 'DC 15 Strength (Athletics)'])
// As often as a save: once every ten seconds a character, and the same link once every thirty.
assert.deepEqual(refused(await ask(flameText, 15)), ['failed', 'busy', null])
wait(11_000)
assert.deepEqual(refused(await ask(flameText, 14)), ['failed', 'busy', null])
// A choice of ability checks, with no DC.
wait(31_000)
made = await ask(flameText, 15)
assert.deepEqual(datasetsOf(made.message), [{ type: 'check', ability: 'int', format: 'short', ...REQUEST }, { type: 'check', ability: 'wis', format: 'short', ...REQUEST }])
assert.deepEqual(labelsOf(made.message), [[`${ICON_CHECK}Intelligence`, `${ICON_CHECK}Intelligence`], [`${ICON_CHECK}Wisdom`, `${ICON_CHECK}Wisdom`]])
chat = chatted(made.message.id)
assert.deepEqual([chat.ask, chat.text], [{ type: 'check', checks: [{ type: 'check', ability: 'int' }, { type: 'check', ability: 'wis' }], label: 'Worn Bardic Eternal Flame' }, 'Intelligence Wisdom'])
// A choice of skills, each with its own ability.
wait(31_000)
made = await ask(flameText, 16)
assert.deepEqual(datasetsOf(made.message), [
  { type: 'skill', ability: 'str', skill: 'ath', dc: '12', format: 'short', ...REQUEST }, { type: 'skill', ability: 'dex', skill: 'acr', dc: '12', format: 'short', ...REQUEST },
])
assert.equal(chatted(made.message.id).text, 'DC 12 Strength (Athletics) DC 12 Dexterity (Acrobatics)')
assert.deepEqual(chatted(made.message.id).ask.checks, [{ type: 'skill', ability: 'str', skill: 'ath' }, { type: 'skill', ability: 'dex', skill: 'acr' }])
// A tool, named by its base item; and a kind of vehicle, by its label.
wait(31_000)
made = await ask(flameText, 17)
assert.deepEqual(datasetsOf(made.message), [{ type: 'tool', ability: 'dex', tool: 'thief', dc: '15', format: 'short', ...REQUEST }])
assert.deepEqual(labelsOf(made.message), [[`${ICON_TOOL}DC 15 Dexterity (Thieves' Tools)`, `${ICON_TOOL}Dexterity (Thieves' Tools)`]])
assert.deepEqual(chatted(made.message.id).ask, { type: 'check', checks: [{ type: 'tool', ability: 'dex', tool: 'thief', name: "Thieves' Tools" }], dc: 15, label: 'Worn Bardic Eternal Flame' })
wait(31_000)
made = await ask(flameText, 21)
assert.deepEqual(datasetsOf(made.message), [{ type: 'tool', ability: 'int', tool: 'water', dc: '10', format: 'short', ...REQUEST }])
assert.deepEqual(labelsOf(made.message)[0][0], `${ICON_TOOL}DC 10 Intelligence (Water Vehicle)`)
assert.deepEqual(chatted(made.message.id).ask.checks, [{ type: 'tool', ability: 'int', tool: 'water', name: 'Water Vehicle' }])
// Sleight of Hand checked using Thieves' Tools, under the 2024 rules: the tool on its button.
wait(31_000)
made = await ask(flameText, 18)
assert.deepEqual(datasetsOf(made.message), [{ type: 'skill', ability: 'dex', skill: 'slt', usingTool: 'thief', format: 'short', ...REQUEST }])
assert.deepEqual(labelsOf(made.message), [[`${ICON_CHECK}Dexterity (Sleight of Hand)`, `${ICON_CHECK}Dexterity (Sleight of Hand)`]])
assert.deepEqual(chatted(made.message.id).ask.checks, [{ type: 'skill', ability: 'dex', skill: 'slt' }])
// One whose author hid its DC: on its button, marked so, labelled without it either way, and not
// in the app's chat.
wait(31_000)
made = await ask(flameText, 19)
assert.deepEqual(datasetsOf(made.message), [{ type: 'skill', ability: 'str', skill: 'ath', dc: '18', hideDc: 'true', format: 'short', ...REQUEST }])
assert.deepEqual(labelsOf(made.message), [[`${ICON_CHECK}Strength (Athletics)`, `${ICON_CHECK}Strength (Athletics)`]])
assert.deepEqual([chatted(made.message.id).ask, chatted(made.message.id).text], [{ type: 'check', checks: [{ type: 'skill', ability: 'str', skill: 'ath' }], label: 'Worn Bardic Eternal Flame' }, 'Strength (Athletics)'])
// An ability, a skill and a tool, side by side.
wait(31_000)
made = await ask(flameText, 23)
assert.deepEqual(datasetsOf(made.message).map(d => [d.type, d.ability, d.skill ?? d.tool ?? null, d.dc]), [['check', 'str', null, '13'], ['skill', 'str', 'ath', '13'], ['tool', 'dex', 'thief', '13']])
assert.deepEqual(chatted(made.message.id).ask.checks, [{ type: 'check', ability: 'str' }, { type: 'skill', ability: 'str', skill: 'ath' }, { type: 'tool', ability: 'dex', tool: 'thief', name: "Thieves' Tools" }])
// Posted as the Gamemaster, for Pip: its DC hidden from players, as dnd5e hides a Gamemaster's.
wait(31_000)
made = await ask(pipText, 1, { actorId: 'pip' })
assert.deepEqual([made.result.status, made.message.author.id], ['done', 'gm'])
assert.deepEqual([chatted(made.message.id).ask, chatted(made.message.id).text], [{ type: 'check', checks: [{ type: 'skill', ability: 'str', skill: 'ath' }], label: 'Dagger' }, 'Strength (Athletics)'])
// Not in a secret section; and no one is prompted for any of them.
wait(31_000)
assert.deepEqual(refused(await ask(flameText, 20)), ['failed', 'secret', null])
assert.equal(opened().length, before)
ok("asks the table for a check on dnd5e's own roll request card, as dnd5e's request makes its buttons: an ability, skill or tool, a choice, a tool used with a skill, a DC hidden; prompts no one; and tells the app's chat what it asks")

// ---- How often ----
wait(31_000)
made = await ask(vexText, 0, { actorId: 'vex' })
assert.equal(made.result.status, 'done')
made = await ask(flameText, 0)
assert.equal(made.result.status, 'done')
made = await ask(flameText, 1)
assert.deepEqual(refused(made), ['failed', 'busy', null])
made = await ask(vexText, 0, { actorId: 'vex' }, 'camp-b')
assert.deepEqual(refused(made), ['failed', 'busy', null])
wait(11_000)
made = await ask(flameText, 0)
assert.deepEqual(refused(made), ['failed', 'busy', null])
made = await ask(flameText, 1)
assert.equal(made.result.status, 'done')
wait(20_000)
made = await ask(flameText, 0)
assert.equal(made.result.status, 'done')
ok('asks once every ten seconds a character, and the same link once every thirty')

// ---- What isn't asked ----
wait(31_000)
assert.deepEqual(refused(await ask(flameText, 5)), ['failed', 'secret', null])
assert.deepEqual(refused(await ask(flameText, 3)), ['failed', 'link', null])
assert.deepEqual(refused(await ask(flameText, 4)), ['failed', 'link', null])
assert.deepEqual(refused(await ask(flameText, 40)), ['failed', 'link', null])
assert.deepEqual(refused(await ask(pipText, 0)), ['failed', 'gone', null])
assert.deepEqual(refused(await ask(flameText, 0, { actorId: 'stranger' })), ['failed', 'unknown', null])
assert.deepEqual(refused(await ask('not-a-hash', 0)), ['failed', 'invalid', 'text'])
assert.deepEqual(refused(await ask(flameText, -1)), ['failed', 'invalid', 'link'])
assert.deepEqual(refused(await ask(flameText, 200)), ['failed', 'invalid', 'link'])
assert.deepEqual(refused(await ask(flameText, '0')), ['failed', 'invalid', 'link'])
const stale = description(thorin, flameOrigin, [save(['dex'], 15)])
remove(stale)
assert.deepEqual(refused(await ask(stale, 0)), ['failed', 'gone', null])
made = await ask(flameText, 0)
assert.equal(made.result.status, 'done', 'none of those counted')
ok("refuses a save in a secret section, a link that isn't a save, another character's description, one no longer on the sheet, and what isn't a link")

// Under dnd5e 6, whose damage, healing and requests are messages of kinds of their own, a card for
// a description's damage would have no tray to apply it from: none of a description's links is
// offered or acted on.
game.system.version = '6.0.5'
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(textKinds('Ashlands'), [])
wait(31_000)
let posted = messages.size
assert.deepEqual(refused(await ask(flameText, 0)), ['failed', 'off', null])
assert.deepEqual(refused(await ask(flameText, 14)), ['failed', 'off', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3, 5] }])), ['failed', 'off', null])
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }])), ['failed', 'off', null])
assert.equal(messages.size, posted)
// A check rolled for a link is a check, rolled under dnd5e 6 as a save for a link is.
made = await send({ kind: 'skill', key: 'ath', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [10] }], text: flameText, link: 14 })
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 17, 15, 'success'])
game.system.version = '5.3.0'
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(textKinds('Ashlands'), TEXT_KINDS)
ok("under dnd5e 6 the table is neither offered nor asked, and a description's damage and rolls neither offered nor rolled; its checks are rolled")

// Where the self-test found that damage doesn't take the player's dice, a description's damage is
// neither offered nor rolled, though its campaign's players may attack.
diceStatus.attacks = false
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(textKinds('Ashlands'), ['ask', 'textRoll'])
assert.equal(rollsFeatures('Ashlands').modifiers, false)
posted = messages.size
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3, 5] }])), ['failed', 'self-test', null])
assert.equal(messages.size, posted)
diceStatus.attacks = true
announce({ campaignId: 'camp-a' })
await settle()
assert.deepEqual(textKinds('Ashlands'), TEXT_KINDS)
ok("where damage doesn't take the player's dice, a description's damage is neither offered nor rolled")

// A command fetched for a campaign whose rolls the Gamemaster turned off as it was fetched isn't
// made, of any of these kinds.
{
  const { runAskCommand, runTextDamageCommand, runTextRollCommand } = await import(`${MODULE}/scripts/command-texts.mjs`)
  const { runRollCommand } = await import(`${MODULE}/scripts/command-rolls.mjs`)
  const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
  const rollsOff = { ...getCampaigns().find(c => c.id === 'camp-a'), rolls: false }
  wait(31_000)
  posted = messages.size
  const offCommands = [
    [runAskCommand, { kind: 'ask', text: flameText, link: 0 }],
    [runTextDamageCommand, { kind: 'textDamage', text: flameText, link: 3, mode: 0, explicit: false, extras: [], dice: [{ faces: 6, results: [3, 5] }] }],
    [runTextRollCommand, { kind: 'textRoll', text: flameText, link: 4, mode: 0, explicit: false, extras: [], dice: [{ faces: 4, results: [3] }] }],
    [runAskCommand, { kind: 'ask', text: flameText, link: 14 }],
    [runRollCommand, { kind: 'skill', key: 'ath', text: flameText, link: 14, mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [10] }] }],
  ]
  for (const [run, fields] of offCommands) {
    const result = await run({ id: `off-${++ids}`, actorId: 'thorin', ...fields }, rollsOff)
    assert.deepEqual([fields.kind, result.status, result.reason], [fields.kind, 'failed', 'off'])
  }
  assert.equal(messages.size, posted)
}
ok('a campaign whose rolls are turned off has none of them made')

// ---- A save against a description's DC ----
made = await rollSave('dex', flameText, 0, [14])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.roll.total, made.roll.options.target, made.result.outcome], [15, 15, 'success'])
assert.deepEqual(faces(made.roll), [[14]])
assert.equal(made.message.flags.dnd5e.roll.type, 'save')
assert.equal(made.message.author.id, 'alice')
assert.deepEqual(made.message.flags['sending-stone'], { request: made.command.id })
made = await rollSave('dex', flameText, 0, [3])
assert.deepEqual([made.roll.total, made.result.outcome], [4, 'failure'])
made = await rollSave('str', flameText, 1, [10])
assert.deepEqual([made.roll.total, made.roll.options.target, made.result.outcome], [14, 20, 'failure'])
made = await rollSave('dex', flameText, 6, [10])
assert.deepEqual([made.result.status, made.roll.options.target, made.result.outcome], ['done', undefined, null])
made = await rollSave('dex', flameText, 0, [10], { text: undefined, link: undefined })
assert.equal(made.result.status, 'done')
assert.equal('outcome' in made.result, false)
// One whose author hid its DC is rolled against it all the same, as dnd5e rolls it, and its card
// shows its author whether they saved.
made = await rollSave('dex', flameText, 13, [14])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 15, 18, 'failure'])
made = await rollSave('dex', flameText, 13, [17])
assert.deepEqual([made.roll.options.target, made.result.outcome], [18, 'success'])
ok("rolls the player's save against the DC of the description it's from, even one its author hid, and says whether it met it; one without a DC, or without a link, has no outcome")

let checks = 0
Hooks.on('dnd5e.rollConcentration', () => { checks++ })
thorin.concentrateOn('Bless')
made = await rollSave('con', flameText, 2, [4])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.roll.total, made.roll.options.target, made.result.outcome, checks], [7, 10, 'failure', 1])
await settle()
assert.deepEqual(thorin.ended, MIDI ? ['Bless'] : [])
made = await rollSave('con', flameText, 11, [9])
assert.deepEqual([made.result.status, made.roll.total, made.result.outcome, checks], ['done', 12, 'success', 2])
// Vex concentrates with Intelligence: a concentration link naming no ability takes it, or
// Constitution, and is rolled with Intelligence either way, as dnd5e rolls it from the link (her
// Intelligence save is +2, her Constitution save +3).
made = await rollSave('int', vexText, 3, [10], { actorId: 'vex' })
assert.deepEqual([made.result.status, made.roll.total, made.result.outcome, checks], ['done', 12, 'success', 3])
made = await rollSave('con', vexText, 3, [10], { actorId: 'vex' })
assert.deepEqual([made.result.status, made.roll.total, made.result.outcome, checks], ['done', 12, 'success', 4])
assert.deepEqual(refused(await rollSave('wis', vexText, 3, [10], { actorId: 'vex' })), ['failed', 'link', null])
assert.deepEqual(refused(await rollSave('int', flameText, 11, [10])), ['failed', 'link', null])
// One with no DC is rolled against dnd5e's 10, and says whether it met it, as its card shows.
made = await rollSave('con', flameText, 12, [4])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome, checks], ['done', 7, 10, 'failure', 5])
made = await rollSave('con', flameText, 12, [9])
assert.deepEqual([made.roll.total, made.result.outcome], [12, 'success'])
ok(`a concentration link rolls dnd5e's concentration check, with the character's own ability where it names none, and against 10 where it has no DC; failed, its concentration is ${MIDI ? "ended by Midi, as Midi does" : 'left to the Gamemaster, as dnd5e leaves it'}`)

core.forceBlind = true
made = await rollSave('dex', flameText, 0, [19])
core.forceBlind = false
assert.deepEqual([made.result.status, made.result.visible, made.result.outcome, made.result.rolls], ['done', false, null, []])
ok('a save made blind, as a module may make it, says nothing of its outcome')

assert.deepEqual(refused(await rollSave('str', flameText, 0, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollSave('dex', flameText, 2, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollSave('dex', flameText, 3, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollSave('dex', stale, 0, [10])), ['failed', 'gone', null])
assert.deepEqual(refused(await rollSave('dex', flameText, 0, [10], { prompt: 'msg1-thorin' })), ['failed', 'invalid', 'prompt'])
assert.deepEqual(refused(await rollSave('dex', flameText, undefined, [10])), ['failed', 'invalid', 'link'])
assert.deepEqual(refused(await rollSave('dex', undefined, 0, [10])), ['failed', 'invalid', 'link'])
assert.deepEqual(refused(await rollSave('dex', 'ABC', 0, [10])), ['failed', 'invalid', 'text'])
// A check rolled for a link that's a save, and a death save, which no link calls for.
assert.deepEqual(refused(await send({ kind: 'skill', key: 'prc', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [5] }], text: flameText, link: 0 })), ['failed', 'link', null])
assert.deepEqual(refused(await send({ kind: 'death', mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: [5] }], text: flameText, link: 0 })), ['failed', 'invalid', 'text'])
assert.deepEqual(refused(await rollSave('str', flameText, 14, [10])), ['failed', 'link', null])
ok("refuses an ability the link doesn't name, a link that isn't a save, a description no longer on the sheet, a link with a prompt, and a link on anything but a save or check")

// ---- A check against a description's DC ----
const rollCheck = (kind, key, text, link, dice, fields = {}, campaignId) => send({
  kind, key, mode: 0, explicit: false, extras: [], dice: [{ faces: 20, results: dice }], text, link, ...fields,
}, campaignId)
// Thorin's Athletics: Strength +4 and proficiency +3, against the link's DC.
made = await rollCheck('skill', 'ath', flameText, 14, [10])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.roll.total, made.roll.options.target, made.result.outcome, faces(made.roll)], [17, 15, 'success', [[10]]])
assert.deepEqual(made.message.flags.dnd5e.roll, { skillId: 'ath', type: 'skill' })
assert.equal(made.message.author.id, 'alice')
assert.deepEqual(made.message.flags['sending-stone'], { request: made.command.id })
assert.deepEqual(made.result.rolls.map(r => r.total), [17])
made = await rollCheck('skill', 'ath', flameText, 14, [7])
assert.deepEqual([made.roll.total, made.result.outcome], [14, 'failure'])
// A choice: each check with its own ability. Acrobatics isn't Thorin's: Dexterity +1 alone.
made = await rollCheck('skill', 'acr', flameText, 16, [11])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 12, 12, 'success'])
made = await rollCheck('skill', 'ath', flameText, 16, [4])
assert.deepEqual([made.roll.total, made.result.outcome], [11, 'failure'])
// Athletics made with Dexterity, as the link names it: +1 and proficiency, not Strength's +4.
made = await rollCheck('skill', 'ath', flameText, 22, [8])
assert.deepEqual([made.result.status, made.roll.total, made.roll.data.abilityId, made.result.outcome], ['done', 12, 'dex', 'success'])
// Ability checks, with no DC: no outcome.
made = await rollCheck('ability', 'wis', flameText, 15, [10])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 12, undefined, null])
assert.deepEqual(made.message.flags.dnd5e.roll, { ability: 'wis', type: 'ability' })
made = await rollCheck('ability', 'str', flameText, 23, [9])
assert.deepEqual([made.roll.total, made.roll.options.target, made.result.outcome], [13, 13, 'success'])
// A tool: Thorin's own Thieves' Tools, +1 and proficiency; Vex has none, and rolls Dexterity +3.
made = await rollCheck('tool', 'thief', flameText, 17, [11])
assert.deepEqual([made.result.status, made.roll.total, made.result.outcome], ['done', 15, 'success'])
assert.deepEqual(made.message.flags.dnd5e.roll, { toolId: 'thief', type: 'tool' })
made = await rollCheck('tool', 'thief', vexText, 4, [10], { actorId: 'vex' })
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 13, 13, 'success'])
// A kind of vehicle, with the ability the link names: no proficiency, Intelligence +0.
made = await rollCheck('tool', 'water', flameText, 21, [9])
assert.deepEqual([made.result.status, made.roll.total, made.result.outcome], ['done', 9, 'failure'])
assert.deepEqual(made.message.flags.dnd5e.roll, { toolId: 'water', type: 'tool' })
// Sleight of Hand using Thieves' Tools, both Thorin's: dnd5e gives advantage, and Foundry rolls the
// second d20; the player's is the first.
made = await rollCheck('skill', 'slt', flameText, 18, [12])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.roll.hasAdvantage, faces(made.roll)[0].length, faces(made.roll)[0][0], made.result.outcome], [true, 2, 12, null])
// Acrobatics, which isn't Thorin's, using his Thieves' Tools: dnd5e adds the higher proficiency of
// the two, the tool's, +1 and +3, as the app does; with only one of them, no advantage.
made = await rollCheck('skill', 'acr', flameText, 24, [11])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.roll.total, made.roll.hasAdvantage, faces(made.roll), made.result.outcome], [15, false, [[11]], 'success'])
made = await rollCheck('skill', 'acr', flameText, 24, [10])
assert.deepEqual([made.roll.total, made.result.outcome], [14, 'failure'])
// With Tool Expertise, the tool's proficiency is doubled: +1 and +6, as its proficiency on the
// sheet says.
thorin.flags.dnd5e.toolExpertise = true
made = await rollCheck('skill', 'acr', flameText, 24, [8])
assert.deepEqual([made.roll.total, made.result.outcome], [15, 'success'])
delete thorin.flags.dnd5e.toolExpertise
// One whose author hid its DC is rolled against it all the same.
made = await rollCheck('skill', 'ath', flameText, 19, [10])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 17, 18, 'failure'])
made = await rollCheck('skill', 'ath', flameText, 19, [11])
assert.deepEqual([made.roll.total, made.result.outcome], [18, 'success'])
// One in a secret section is still the player's own to roll.
made = await rollCheck('ability', 'str', flameText, 20, [10])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 14, 14, 'success'])
// Made blind, as a module may make it, it says nothing of its outcome.
core.forceBlind = true
made = await rollCheck('skill', 'ath', flameText, 14, [19])
core.forceBlind = false
assert.deepEqual([made.result.status, made.result.visible, made.result.outcome, made.result.rolls], ['done', false, null, []])
// Without a link, a check is the character's own, as before, and has no outcome.
made = await rollCheck('skill', 'ath', undefined, undefined, [10])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, 'outcome' in made.result], ['done', 17, undefined, false])
ok("rolls the player's check against the DC of the description it's from, with the ability the link names for it, a tool they don't have or a kind of vehicle, a tool used with a skill, with the higher of their proficiencies, and a DC its author hid; and says whether it met it")

assert.deepEqual(refused(await rollCheck('skill', 'acr', flameText, 14, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollCheck('ability', 'str', flameText, 14, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollCheck('tool', 'thief', flameText, 14, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollCheck('ability', 'int', flameText, 16, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollCheck('skill', 'ath', flameText, 0, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollCheck('skill', 'ath', flameText, 3, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollCheck('skill', 'ath', flameText, 40, [10])), ['failed', 'link', null])
assert.deepEqual(refused(await rollCheck('skill', 'ath', stale, 0, [10])), ['failed', 'gone', null])
assert.deepEqual(refused(await rollCheck('skill', 'ath', pipText, 1, [10])), ['failed', 'gone', null])
assert.deepEqual(refused(await rollCheck('skill', 'ste', flameText, 14, [10])), ['failed', 'unknown', null])
assert.deepEqual(refused(await rollCheck('tool', 'water', undefined, undefined, [10])), ['failed', 'unknown', null])
assert.deepEqual(refused(await rollCheck('tool', 'constructor', flameText, 17, [10])), ['failed', 'link', null])
// A world's own tool keyed as a skill is: still not the skill check the link offers.
CONFIG.DND5E.tools.ath = { ability: 'str' }
assert.deepEqual(refused(await rollCheck('tool', 'ath', flameText, 14, [10])), ['failed', 'link', null])
delete CONFIG.DND5E.tools.ath
assert.deepEqual(refused(await rollCheck('skill', 'ath', flameText, 14, [10], { prompt: 'msg1-thorin' })), ['failed', 'invalid', 'prompt'])
assert.deepEqual(refused(await rollCheck('skill', 'ath', flameText, undefined, [10])), ['failed', 'invalid', 'link'])
assert.deepEqual(refused(await rollCheck('ability', 'str', undefined, 20, [10])), ['failed', 'invalid', 'link'])
assert.deepEqual(refused(await rollCheck('skill', 'ath', 'ABC', 14, [10])), ['failed', 'invalid', 'text'])
assert.deepEqual(refused(await rollCheck('skill', 'ath', flameText, 14, [10], { actorId: 'stranger' })), ['failed', 'unknown', null])
ok("refuses a check the link doesn't offer, a link that isn't a check, a description no longer on the sheet or another character's, a skill or tool dnd5e doesn't have, a kind of vehicle without a link, and a link with a prompt")

// ---- A description's damage ----
let rolledDamage = 0
Hooks.on('dnd5e.rollDamage', () => { rolledDamage++ })
const pending = MIDI ? Hooks.once('dnd5e.rollDamage', () => { midiDamage.called++ }) : null
globalThis.__dialogs = []
made = await textDamage(flameText, 3, [{ faces: 6, results: [3, 5] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(made.message.author.id, 'alice')
assert.deepEqual(made.message.speaker, { actor: 'thorin', alias: 'Thorin' })
assert.deepEqual(made.message.whisper, [])
assert.equal(made.message.flavor, 'Worn Bardic Eternal Flame - Damage Roll')
assert.deepEqual(made.message.flags, {
  dnd5e: { messageType: 'roll', roll: { type: 'damage' }, targets: [], item: { id: 'flame', uuid: 'Actor.thorin.Item.flame', type: 'equipment' } },
  'sending-stone': { request: made.command.id },
})
assert.ok(made.roll instanceof DamageRoll)
assert.deepEqual([faces(made.roll), made.roll.total, made.roll.options.type, made.roll.isCritical], [[[3, 5]], 8, 'fire', false])
assert.deepEqual(made.result.rolls.map(r => [r.formula, r.total, r.damageType]), [['2d6', 8, 'fire']])
assert.deepEqual(globalThis.__dialogs, [])
assert.equal(rolledDamage, 0)
if (MIDI) {
  assert.deepEqual([midiDamage.called, registry.get('dnd5e.rollDamage').includes(pending), midiDamage.subject], [0, true, undefined])
  Hooks.off('dnd5e.rollDamage', pending)
}
chat = chatted(made.message.id)
assert.deepEqual([chat.dnd5e.roll, chat.dnd5e.item.id, chat.ask, chat.rolls[0].damageType], [{ type: 'damage' }, 'flame', null, 'fire'])
ok(`rolls a description's damage with the player's dice, without a dialog, as the player, naming the item, at no target${MIDI ? "; Midi's damage roll waiting for its hook keeps it" : ''}; and fires no damage hook`)

// dnd5e heads a roll's card with its item in place of its flavor: a spell an item casts names no
// item, so that its card keeps the flavor naming both.
made = await textDamage(wispText, 0, [{ faces: 8, results: [6] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(made.message.flavor, 'Starry Wisp (Worn Bardic Eternal Flame) - Damage Roll')
assert.deepEqual(made.message.flags.dnd5e, { messageType: 'roll', roll: { type: 'damage' }, targets: [] })
made = await textDamage(spoofed, 1, [{ faces: 4, results: [2] }])
assert.equal(made.message.flavor, '&lt;b&gt;Fire &amp; Ice&lt;/b&gt; - Damage Roll')
made = await textDamage(biography, 1, [{ faces: 6, results: [2] }])
assert.deepEqual(refused(made), ['failed', 'link', null])
ok("a spell's damage an item casts names the spell and the item, in a flavor dnd5e keeps; names are escaped")

made = await textDamage(flameText, 7, [{ faces: 6, results: [4] }, { faces: 4, results: [2] }], { types: ['cold'] })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(made.message.rolls.map(r => [r.options.type, r.total]), [['cold', 4], ['cold', 2]])
made = await textDamage(flameText, 7, [{ faces: 6, results: [4] }, { faces: 4, results: [2] }])
assert.deepEqual(made.message.rolls.map(r => r.options.type), ['fire', 'cold'])
assert.deepEqual(refused(await textDamage(flameText, 7, [{ faces: 6, results: [4] }, { faces: 4, results: [2] }], { types: ['acid'] })), ['failed', 'type', null])
assert.deepEqual(refused(await textDamage(flameText, 7, [{ faces: 6, results: [4] }, { faces: 4, results: [2] }], { types: ['fire', 'fire'] })), ['failed', 'type', null])
assert.deepEqual(refused(await textDamage(flameText, 7, [{ faces: 6, results: [4] }, { faces: 4, results: [2] }], { types: ['fire', 'cold', 'cold'] })), ['failed', 'type', null])
ok("rolls each part as the kind the player chose of those it offers, else as dnd5e would, and refuses one it doesn't offer")

made = await textDamage(flameText, 8, [{ faces: 4, results: [1, 4] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.equal(made.message.flavor, 'Worn Bardic Eternal Flame - Healing Roll')
assert.deepEqual([made.message.flags.dnd5e.roll, made.roll.total, made.roll.options.type], [{ type: 'healing' }, 7, 'healing'])
made = await textDamage(flameText, 9, [])
assert.deepEqual([made.result.status, made.roll.total], ['done', 5])
ok('rolls healing as healing, and damage with no dice')

assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 8, results: [3, 5] }])), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3] }])), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [])), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 10, [])), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 0, [])), ['failed', 'link', null])
assert.deepEqual(refused(await textDamage(stale, 0, [])), ['failed', 'gone', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3, 5] }], { modifiers: { extra: 1 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3, 5] }], { critical: true })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3, 5] }], { mode: 1 })), ['failed', 'invalid', 'mode'])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3, 5] }], { extras: [{ sign: 1, flat: 2 }] })), ['failed', 'invalid', 'extras'])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3, 7] }])), ['failed', 'invalid', 'dice'])
assert.deepEqual(refused(await textDamage(vexText, 1, [{ faces: 6, results: [3] }], { actorId: 'vex' }, 'camp-b')), ['failed', 'attacks-off', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 6, results: [3, 5] }], { actorId: 'stranger' })), ['failed', 'unknown', null])
ok("refuses dice that aren't the damage's, a formula the player's dice can't reach, a link that isn't damage, a description no longer on the sheet, dice not changed as the player chose or not a critical hit's where they chose one, where players may not attack, and a character not in the campaign")

// ---- A description's damage: a critical hit's, and changed in the app ----
const d6 = (...results) => ({ faces: 6, results })
// Since 0.22.0 every sheet comes in character.updated, the hello's following it.
const sheetSent = () => app.events.filter(e => (e.campaign?.title === 'Ashlands') && (e.type === 'character.updated') && (e.data.character.id === 'thorin'))
  .at(-1).data.character.sheet
// A world setting changed, as Foundry stores it, the first time from its default, then changes it,
// calling its hook; and the sheets sent again.
const stored = new Set()
async function changeSetting(key, value) {
  const before = app.events.length
  if (key.startsWith('dnd5e.')) settings.set(key.slice('dnd5e.'.length), value)
  else midiCritical.gm = value
  await Hooks.callAll(stored.has(key) ? 'updateSetting' : 'createSetting', { key })
  stored.add(key)
  await new Promise(resolve => realSetTimeout(resolve, 300))
  return app.events.slice(before).filter(e => (e.type === 'character.updated') && (e.data.character.id === 'thorin')).length
}
// The self-test made again, as the Gamemaster's client would under these rules: damage changed in
// the app still changes as expected, a critical hit's extra dice and critical damage's among it.
async function modifiersHold() {
  await selfTest()
  assert.deepEqual([diceStatus.attacks, diceStatus.modifiers], [true, true], diceStatus.modifiersError ?? diceStatus.attacksError)
}
const DOUBLED = { perDie: 2, multiplyNumeric: false, powerfulCritical: false, altered: false, bonusDice: 'rolled' }
assert.deepEqual(sheetSent().critical, DOUBLED)
await modifiersHold()
ok("the sheet says how this world rolls a critical hit's damage: each die twice over, dnd5e's own way, a critical hit's extra dice thrown with the first")

made = await textDamage(flameText, 3, [d6(1, 2, 3, 4)], { critical: true })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([faces(made.roll), made.roll.formula, made.roll.total, made.roll.isCritical, made.roll.options.type], [[[1, 2, 3, 4]], '4d6', 10, true, 'fire'])
assert.deepEqual(made.result.rolls.map(r => [r.formula, r.total, r.critical, r.damageType]), [['4d6', 10, true, 'fire']])
assert.deepEqual([made.message.flavor, made.message.flags.dnd5e.roll, made.message.author.id], ['Worn Bardic Eternal Flame - Damage Roll', { type: 'damage' }, 'alice'])
assert.equal(chatted(made.message.id).rolls[0].critical, true)
// Each part a critical hit's, as the kind chosen.
made = await textDamage(flameText, 7, [d6(4, 5), { faces: 4, results: [2, 3] }], { critical: true, types: ['cold'] })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(made.message.rolls.map(r => [r.formula, r.total, r.isCritical, r.options.type]), [['2d6', 9, true, 'cold'], ['2d4', 5, true, 'cold']])
// Its numbers aren't doubled, and since module 0.33.0 never are, whatever dnd5e's Critical Damage
// Modifiers says: the sheet's rule says so under it too, so turning it on or off changes nothing in
// it (a sheet sent as it's turned on is for an earlier change, its spells').
made = await textDamage(flameText, 25, [{ faces: 8, results: [5, 7] }], { critical: true })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '2d8 + 3', 15])
await changeSetting('dnd5e.criticalDamageModifiers', true)
assert.deepEqual(sheetSent().critical, DOUBLED)
await modifiersHold()
made = await textDamage(flameText, 25, [{ faces: 8, results: [5, 7] }], { critical: true })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '2d8 + 3', 15])
assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', false), 0)
assert.deepEqual(sheetSent().critical, DOUBLED)
// dnd5e's Powerful Critical: its dice once, and the most they could come to; a die more is one more.
// The change of another setting doesn't send the sheets again, though they would say more now.
settings.set('criticalDamageMaxDice', true)
before = app.events.length
await Hooks.callAll('updateSetting', { key: 'dnd5e.rulesVersion' })
await new Promise(resolve => realSetTimeout(resolve, 300))
assert.equal(app.events.slice(before).filter(e => e.type === 'character.updated').length, 0)
assert.equal(await changeSetting('dnd5e.criticalDamageMaxDice', true), 1)
assert.deepEqual(sheetSent().critical, { perDie: 1, multiplyNumeric: false, powerfulCritical: true, altered: false, bonusDice: 'rolled' })
await modifiersHold()
made = await textDamage(flameText, 3, [d6(3, 4)], { critical: true })
assert.deepEqual([made.result.status, faces(made.roll), made.roll.total, made.roll.isCritical], ['done', [[3, 4]], 3 + 4 + 12, true])
made = await textDamage(flameText, 3, [d6(1, 2, 3)], { critical: true, modifiers: { extra: 1 } })
assert.deepEqual([made.result.status, faces(made.roll), made.roll.total], ['done', [[1, 2, 3]], 1 + 2 + 3 + 18])
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1, 2, 3, 4)], { critical: true })), ['failed', 'dice', null])
// Both of dnd5e's settings: its dice once, and the most its dice could roll, its numbers still not
// doubled (module 0.33.0; before, 5 + 6 + 8).
assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', true), 0)
assert.deepEqual(sheetSent().critical, { perDie: 1, multiplyNumeric: false, powerfulCritical: true, altered: false, bonusDice: 'rolled' })
await modifiersHold()
made = await textDamage(flameText, 25, [{ faces: 8, results: [5] }], { critical: true })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '1d8 + 3 + 8', 5 + 3 + 8])
assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', false), 0)
assert.equal(await changeSetting('dnd5e.criticalDamageMaxDice', false), 1)
assert.deepEqual(sheetSent().critical, DOUBLED)
ok("rolls a description's damage as a critical hit's, as the player chose, as this world's rules make it: its dice doubled, never its numbers, whatever dnd5e's Critical Damage Modifiers says (module 0.33.0), or with Powerful Critical its most, a critical hit's extra dice thrown either way; the sheet is sent again as those rules change, and not for Critical Damage Modifiers, which changes nothing; the card's rolls and the result say it's a critical hit's")

// A module's rule that throws a die more of a critical hit's first dice alone, as a melee weapon's
// extra dice: one die comes out three times over, but dice of two sizes not each as many times, so
// the sheet says nothing of how to plan one; and one that adds a number of its own to every critical
// hit, which none of dnd5e's settings make.
const dnd5eDamage = DamageRoll.prototype.configureDamage
const withCritical = added => function (options = {}) {
  return dnd5eDamage.call(this, { ...options, critical: { ...(options.critical ?? {}), ...added } })
}
DamageRoll.prototype.configureDamage = withCritical({ bonusDice: 1 })
assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', false), 1)
assert.equal(sheetSent().critical, null)
DamageRoll.prototype.configureDamage = dnd5eDamage
assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', false), 1)
assert.deepEqual(sheetSent().critical, DOUBLED)
DamageRoll.prototype.configureDamage = withCritical({ bonusDamage: '1' })
assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', false), 1)
assert.equal(sheetSent().critical, null)
// And one that throws its dice once, adding the most only its first dice could roll: one die and a
// number come out as Powerful Critical makes them, but dice of two sizes don't.
DamageRoll.prototype.configureDamage = function (options = {}) {
  withCritical({ multiplier: 1 }).call(this, options)
  if (!this.isCritical) return
  const { DiceTerm, NumericTerm, OperatorTerm } = foundry.dice.terms
  const first = this.terms.find(term => term instanceof DiceTerm)
  this.terms.push(new OperatorTerm({ operator: '+', options: { criticalFlatBonus: true } }),
    new NumericTerm({ number: first.number * first.faces, options: { criticalFlatBonus: true } }))
  this.resetFormula()
}
assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', false), 0)
assert.equal(sheetSent().critical, null)
DamageRoll.prototype.configureDamage = dnd5eDamage
assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', false), 1)
assert.deepEqual(sheetSent().critical, DOUBLED)
ok("the sheet says nothing of a rule that throws dice of one size otherwise than another's, or adds numbers none of dnd5e's settings would, to one die or to dice of two sizes")

// Changed in the app, as an attack's damage is: a die more is as many more as a critical hit
// throws of each.
made = await textDamage(flameText, 3, [d6(1, 2, 3, 4, 5, 6)], { critical: true, modifiers: { extra: 1 } })
assert.deepEqual([made.result.status, faces(made.roll), made.roll.formula, made.roll.total, made.roll.isCritical], ['done', [[1, 2, 3, 4, 5, 6]], '6d6', 21, true])
made = await textDamage(flameText, 3, [d6(1, 2, 3)], { modifiers: { extra: 1 } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '3d6', 6])
made = await textDamage(flameText, 3, [{ faces: 8, results: [7, 8] }], { modifiers: { faces: 8 } })
assert.deepEqual([made.result.status, faces(made.roll), made.roll.formula, made.roll.total], ['done', [[7, 8]], '2d8', 15])
made = await textDamage(flameText, 3, [{ faces: 10, results: [1, 2, 3, 4, 5, 6] }], { critical: true, modifiers: { extra: 1, faces: 10 } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '6d10', 21])
// Only the first part's first die.
made = await textDamage(flameText, 7, [d6(1, 2), { faces: 4, results: [3] }], { modifiers: { extra: 1 } })
assert.deepEqual([made.result.status, made.message.rolls.map(r => [r.formula, r.total])], ['done', [['2d6', 3], ['1d4', 3]]])
// Every die at its highest, Foundry's own too.
made = await textDamage(flameText, 3, [d6(1, 1)], { modifiers: { maximize: true } })
assert.deepEqual([made.result.status, made.roll.total, made.result.rolls[0].total], ['done', 12, 12])
made = await textDamage(flameText, 3, [d6(1, 1, 1, 1)], { critical: true, modifiers: { maximize: true } })
assert.deepEqual([made.result.status, made.roll.total, made.roll.isCritical], ['done', 24, true])
made = await textDamage(flameText, 26, [d6(1)], { modifiers: { maximize: true } })
assert.deepEqual([made.result.status, made.message.rolls.map(r => r.total)], ['done', [3, 6]])
// Healing may be changed, but is never a critical hit's.
made = await textDamage(flameText, 8, [{ faces: 4, results: [1, 1] }], { modifiers: { maximize: true } })
assert.deepEqual([made.result.status, made.roll.total, made.message.flavor], ['done', 10, 'Worn Bardic Eternal Flame - Healing Roll'])
made = await textDamage(flameText, 8, [{ faces: 4, results: [1, 2, 3] }], { modifiers: { extra: 1 } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '3d4 + 2', 8])
posted = messages.size
assert.deepEqual(refused(await textDamage(flameText, 8, [{ faces: 4, results: [1, 2, 3, 4] }], { critical: true })), ['failed', 'invalid', 'critical'])
assert.deepEqual(refused(await textDamage(flameText, 8, [{ faces: 4, results: [1, 2] }], { critical: true })), ['failed', 'invalid', 'critical'])
// Dice that aren't those changed as the player chose.
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1, 2)], { modifiers: { extra: 1 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1, 2, 3, 4, 5)], { critical: true, modifiers: { extra: 1 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1, 2, 3, 4)], { modifiers: { extra: 1 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1, 2)], { modifiers: { faces: 8 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 8, results: [1, 2] }], { critical: true, modifiers: { faces: 8 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1)], { modifiers: { maximize: true } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 8, [{ faces: 4, results: [1, 2] }], { modifiers: { extra: 1 } })), ['failed', 'dice', null])
// A first part with no die to change.
assert.deepEqual(refused(await textDamage(flameText, 9, [], { modifiers: { extra: 1 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 26, [d6(4)], { modifiers: { faces: 8 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(flameText, 26, [d6(4), d6(5)], { modifiers: { extra: 1 } })), ['failed', 'dice', null])
// What can't be read, and what a description's own roll never is.
for (const modifiers of [{ faces: 20 }, { faces: 3 }, { extra: -1 }, { extra: 1.5 }, { extra: 41 }, { maximize: 'yes' }, 'more']) {
  assert.deepEqual(refused(await textDamage(flameText, 3, [d6(3, 5)], { modifiers })), ['failed', 'invalid', 'modifiers'], JSON.stringify(modifiers))
}
for (const critical of ['yes', 1, {}]) {
  assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1, 2, 3, 4)], { critical })), ['failed', 'invalid', 'critical'], JSON.stringify(critical))
}
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { critical: true })), ['failed', 'invalid', 'critical'])
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { modifiers: { maximize: true } })), ['failed', 'invalid', 'modifiers'])
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { modifiers: {} })), ['failed', 'invalid', 'modifiers'])
assert.equal(messages.size, posted)
// Not a critical hit's, and changes that change nothing: rolled as it is.
made = await textDamage(flameText, 3, [d6(3, 5)], { critical: false, modifiers: { extra: 0, maximize: false } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total, made.roll.isCritical], ['done', '2d6', 8, false])
made = await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { critical: false, modifiers: null })
assert.deepEqual([made.result.status, made.roll.total], ['done', 5])
ok("changes a description's damage or healing as the player chose: a die more, as many more as a critical hit throws, another size of it, its first part's first die alone, every die at its highest; healing never a critical hit's; and refuses dice that aren't those, a first part with no die to change, what can't be read, and a description's own roll changed or a critical hit's")

// Where the self-test found damage isn't changed as expected, it isn't changed: the hello says so,
// and changes are refused; a critical hit's is still rolled.
diceStatus.modifiers = false
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(rollsFeatures('Ashlands').modifiers, false)
posted = messages.size
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1, 2, 3)], { modifiers: { extra: 1 } })), ['failed', 'self-test', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [{ faces: 8, results: [1, 2] }], { modifiers: { faces: 8 } })), ['failed', 'self-test', null])
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(3, 5)], { modifiers: { maximize: true } })), ['failed', 'self-test', null])
assert.equal(messages.size, posted)
made = await textDamage(flameText, 3, [d6(1, 2, 3, 4)], { critical: true })
assert.deepEqual([made.result.status, made.roll.total], ['done', 10])
made = await textDamage(flameText, 3, [d6(3, 5)], { modifiers: { extra: 0 } })
assert.deepEqual([made.result.status, made.roll.total], ['done', 8])
diceStatus.modifiers = true
announce({ campaignId: 'camp-a' })
await settle()
assert.equal(rollsFeatures('Ashlands').modifiers, true)
ok("where the self-test found damage isn't changed as expected, the hello says so and a description's changed damage is refused; its critical hit's is still rolled")

if (MIDI) {
  // Since 0.32.0 a description's critical hit's damage from the app is made as dnd5e makes it, whatever
  // Midi-QOL's rules for the Gamemaster say (the 0.32.0 contract §2.5, §3.7): under each of them, the sheet
  // still says dnd5e's rule, so none is sent again, and its damage is each die doubled, its numbers as
  // dnd5e's settings make them, a die more two more, never Midi's maximized, kept or doubled dice.
  for (const rule of ['maxAll', 'maxCritRoll', 'maxCrit', 'maxDamage', 'doubleDice', 'bestOfTwo', 'default']) {
    assert.equal(await changeSetting('midi-qol.ConfigSettings', rule), 0, `${rule}: no sheet sent`)
    assert.deepEqual(sheetSent().critical, DOUBLED, rule)
    await modifiersHold()
    made = await textDamage(flameText, 3, [d6(1, 2, 3, 4)], { critical: true })
    assert.equal(made.result.status, 'done', `${rule}: ${JSON.stringify(made.result)}`)
    assert.deepEqual([faces(made.roll), made.roll.formula, made.roll.total, made.roll.isCritical], [[[1, 2, 3, 4]], '4d6', 10, true], rule)
    made = await textDamage(flameText, 3, [d6(1, 2, 3, 4, 5, 6)], { critical: true, modifiers: { extra: 1 } })
    assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '6d6', 21], rule)
    made = await textDamage(flameText, 25, [{ faces: 8, results: [5, 7] }], { critical: true })
    assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '2d8 + 3', 15], rule)
    made = await textDamage(flameText, 3, [d6(3, 5)])
    assert.deepEqual([made.result.status, made.roll.formula, made.roll.total, made.roll.isCritical], ['done', '2d6', 8, false], rule)
    assert.deepEqual(refused(await textDamage(flameText, 3, [d6(1, 2), d6(3, 4)], { critical: true })), ['failed', 'dice', null], `${rule}: Midi's dice rolled apart are no part of it`)
  }
  // Since module 0.33.0 its numbers are never doubled under Midi's rules either, whatever dnd5e's
  // Critical Damage Modifiers says (before, `2d8 + 6`): under maxAll, and under default, whose own
  // rolls take dnd5e's settings; the sheet says so, and none is sent again.
  for (const rule of ['maxAll', 'default']) {
    assert.equal(await changeSetting('midi-qol.ConfigSettings', rule), 0, rule)
    assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', true), 0, rule)
    assert.deepEqual(sheetSent().critical, DOUBLED, rule)
    made = await textDamage(flameText, 25, [{ faces: 8, results: [5, 7] }], { critical: true })
    assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '2d8 + 3', 15], rule)
    assert.equal(await changeSetting('dnd5e.criticalDamageModifiers', false), 0, rule)
  }
  assert.equal(await changeSetting('midi-qol.ConfigSettings', 'default'), 0)
  ok("with Midi-QOL, since 0.32.0 a description's critical hit's damage is made as dnd5e makes it whatever the Gamemaster's rule for critical hits: maxAll, maxCritRoll, maxCrit, maxDamage, doubleDice, bestOfTwo or default, each die doubled, a die more two more, and since 0.33.0 its numbers never doubled, Critical Damage Modifiers on or off; the sheet says dnd5e's rule under each, and none is sent again")

  // With players' attacks not made through Midi's workflow, attacks aren't offered while Midi
  // makes items' uses; a description's damage, which isn't, still is, and may still be changed.
  const hellos = app.events.filter(e => e.type === 'bridge.hello').length
  await game.settings.set('sending-stone', 'midiIntegration', false)
  await until(() => app.events.filter(e => e.type === 'bridge.hello').length > hellos, 'a fresh hello')
  await settle()
  assert.deepEqual([textKinds('Ashlands'), rollsFeatures('Ashlands').kinds.includes('damage'), rollsFeatures('Ashlands').modifiers], [TEXT_KINDS, false, true])
  made = await textDamage(flameText, 3, [d6(1, 2, 3, 4, 5, 6)], { critical: true, modifiers: { extra: 1 } })
  assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '6d6', 21])
  await game.settings.set('sending-stone', 'midiIntegration', true)
  await settle()
  ok("with Make Players' Attacks Through Midi-QOL off, a description's damage may still be a critical hit's and changed, and the hello says so")
}

// ---- A description's own roll ----
made = await textRoll(flameText, 4, [{ faces: 4, results: [3] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.roll.constructor.name, faces(made.roll), made.roll.total], ['BasicRoll', [[3]], 5])
assert.equal(made.message.flavor, 'Worn Bardic Eternal Flame')
assert.deepEqual(made.message.flags, {
  dnd5e: { messageType: 'roll', roll: { type: 'generic' }, targets: [], item: { id: 'flame', uuid: 'Actor.thorin.Item.flame', type: 'equipment' } },
  'sending-stone': { request: made.command.id },
})
assert.equal(made.message.author.id, 'alice')
// Module 0.32.0: one whose die the player typed in from their own, its message marked so, the die
// used the same; `typed` anything but true, nothing marked and nothing refused.
made = await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { typed: true })
assert.deepEqual([made.result.status, faces(made.roll), made.roll.total, made.message.flags['sending-stone']], ['done', [[3]], 5, { request: made.command.id, typed: true }])
made = await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { typed: 'yes' })
assert.deepEqual([made.result.status, made.roll.total, made.message.flags['sending-stone']], ['done', 5, { request: made.command.id }])
made = await textRoll(vexText, 2, [{ faces: 4, results: [2] }], { actorId: 'vex' }, 'camp-b')
assert.deepEqual([made.result.status, made.roll.total], ['done', 2])
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 6, results: [3] }])), ['failed', 'dice', null])
assert.deepEqual(refused(await textRoll(flameText, 4, [])), ['failed', 'dice', null])
// Another module changes the roll, once planned, so that the player's dice can't reach it: it's
// called off, and nothing is posted.
posted = messages.size
Hooks.once('dnd5e.preRoll', config => { config.rolls[0].parts = ['1d6 + 2'] })
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }])), ['failed', 'dice', null])
assert.equal(messages.size, posted)
assert.deepEqual(refused(await textRoll(flameText, 3, [{ faces: 6, results: [3, 5] }])), ['failed', 'link', null])
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { types: ['fire'] })), ['failed', 'invalid', 'types'])
assert.deepEqual(refused(await textRoll(stale, 0, [])), ['failed', 'gone', null])
// Thorin isn't in Mirkwood: its commands can't roll his descriptions.
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }], {}, 'camp-b')), ['failed', 'unknown', null])
assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { actorId: 'stranger' })), ['failed', 'unknown', null])
// The app may send a description's roll without saying how it's rolled: it's rolled as it is.
made = await send({ kind: 'textRoll', text: biography, link: 1, dice: [{ faces: 6, results: [6] }] })
assert.deepEqual([made.result.status, made.roll.total, made.message.flavor, made.message.flags.dnd5e.item], ['done', 6, 'Thorin', undefined])
ok("rolls a description's own roll with the player's dice, naming where it's from, wherever players roll from the app, one they typed in marked `typed` (0.32.0); and refuses dice that aren't its own, or that a module made unreachable, and a character not in the campaign")

// ---- Dice with modifiers (module 0.22.0) ----
// The player's dice are each die's first throw; a reroll or an explosion is Foundry's, and the
// total the game's.
made = await textDamage(modifiedText, 0, [{ faces: 6, results: [1, 5] }, { faces: 8, results: [3] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
const [rerolledSixes, theEight] = made.roll.dice
const rerolledTo = rerolledSixes.results[2]?.result
assert.ok(Number.isInteger(rerolledTo), 'Foundry rerolled the 1')
assert.deepEqual([rerolledSixes.results.map(r => [r.result, r.active]), rerolledSixes.results[0].rerolled, faces(made.roll)[1]],
  [[[1, false], [5, true], [rerolledTo, true]], true, [3]])
assert.deepEqual([made.roll.formula, made.roll.total, made.result.rolls[0].total, theEight.results.length], ['2d6r<=2 + 1d8 + 7', 5 + rerolledTo + 3 + 7, 5 + rerolledTo + 3 + 7, 1])
made = await textDamage(modifiedText, 1, [{ faces: 6, results: [6] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
const [explodingSix] = made.roll.dice
assert.deepEqual([explodingSix.results[0].result, explodingSix.results[0].exploded, explodingSix.results.length > 1], [6, true, true])
assert.equal(made.roll.total, explodingSix.results.reduce((sum, r) => sum + r.result, 0))
made = await textRoll(modifiedText, 2, [{ faces: 6, results: [1, 2, 3, 4] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([faces(made.roll), made.roll.dice[0].results.map(r => r.active), made.roll.total], [[[1, 2, 3, 4]], [false, true, true, true], 9])
// At its highest, damage with a die that explodes would be rolled again by Foundry: refused,
// nothing posted; one whose die rerolls only lower faces is made.
posted = messages.size
assert.deepEqual(refused(await textDamage(modifiedText, 1, [{ faces: 6, results: [6] }], { modifiers: { maximize: true } })), ['failed', 'invalid', 'modifiers'])
assert.equal(messages.size, posted)
made = await textDamage(modifiedText, 0, [{ faces: 6, results: [6, 6] }, { faces: 8, results: [8] }], { modifiers: { maximize: true } })
assert.deepEqual([made.result.status, faces(made.roll), made.roll.total], ['done', [[6, 6], [8]], 27])
assert.deepEqual(refused(await textRoll(modifiedText, 2, [{ faces: 6, results: [1, 2, 3] }])), ['failed', 'dice', null])
ok("a description's damage and rolls with dice Foundry rolls again, keeps or counts take the player's dice as each die's first throw: a reroll or an explosion is Foundry's, and the total the game's; damage with a die that explodes isn't rolled at its highest")

// ---- A real description, as the module normalised and sent it ----
const thorinSheet = sheetSent
const bioHash = thorinSheet().details.biography
const bioHtml = app.events.filter(e => e.type === 'character.texts').map(e => e.data.texts[bioHash]).find(Boolean)
assert.ok(bioHtml, 'the biography was sent')
const links = [...parse(bioHtml).querySelectorAll('[data-n]')].map(el => ({ ...el.dataset, n: Number(el.dataset.n), cls: el.className }))
const linkOf = test => links.find(test)?.n
const bioSave = linkOf(l => l.cls.includes('ss-save') && (l.ability === 'dex'))
const bioDamage = linkOf(l => l.cls.includes('ss-damage'))
const bioSecret = linkOf(l => l.cls.includes('ss-save') && (l.ability === 'wis'))
assert.deepEqual([typeof bioSave, typeof bioDamage, typeof bioSecret], ['number', 'number', 'number'], bioHtml)
assert.ok(!bioHtml.includes('100d6'), 'the forged span acts on nothing')
wait(31_000)
made = await ask(bioHash, bioSave)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.message.flavor, made.message.flags.dnd5e, made.message.author.id], ['Roll Request: Thorin', undefined, 'alice'])
assert.deepEqual([...parse(made.message.content).querySelectorAll('button')].map(b => ({ ...b.dataset })), [
  { type: 'save', ability: 'dex', dc: '15', format: 'long', action: 'rollRequest', visibility: 'all' },
])
assert.deepEqual(chatted(made.message.id).ask, { type: 'save', abilities: ['dex'], dc: 15, label: 'Thorin' })
made = await rollSave('dex', bioHash, bioSave, [14])
assert.deepEqual([made.result.status, made.roll.options.target, made.result.outcome], ['done', 15, 'success'])
made = await textDamage(bioHash, bioDamage, [{ faces: 6, results: [3, 4] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.message.flavor, made.roll.total, made.roll.options.type, made.message.flags.dnd5e.item], ['Thorin - Damage Roll', 7, 'fire', undefined])
wait(31_000)
assert.deepEqual(refused(await ask(bioHash, bioSecret)), ['failed', 'secret', null])
made = await rollSave('wis', bioHash, bioSecret, [10])
assert.deepEqual([made.result.status, made.roll.options.target], ['done', 13], 'a secret save is still the player\'s own to roll')
assert.deepEqual(refused(await textDamage(bioHash, bioSecret, [])), ['failed', 'link', null])
assert.deepEqual(refused(await textDamage(bioHash, 150, [])), ['failed', 'link', null])
thorin.system.details.biography.value = BIOGRAPHY.replace('swore an oath', 'swore two oaths')
assert.deepEqual(refused(await ask(bioHash, bioSave)), ['failed', 'gone', null])
assert.deepEqual(refused(await textDamage(bioHash, bioDamage, [{ faces: 6, results: [3, 4] }])), ['failed', 'gone', null])
thorin.system.details.biography.value = BIOGRAPHY
ok("through the module's own normaliser: a description's save is asked and rolled against its DC, its damage rolled, its secret not asked, a forged link acts on nothing, and an edited description is gone")

// ---- Real descriptions of an item, of a spell an item casts, and of an effect ----
const sheetNow = thorinSheet()
const rodHash = sheetNow.inventory.sections.flatMap(section => section.items).find(it => it.id === 'rod')?.text
const wispHash = sheetNow.spells.flatMap(section => section.spells).find(spell => spell.id === 'wisp-copy')?.text
const blessedHash = sheetNow.effects.flatMap(section => section.effects).find(effect => effect.id === 'blessed')?.text
assert.deepEqual([rodHash, wispHash, blessedHash].map(hash => /^[0-9a-f]{14}$/.test(hash ?? '')), [true, true, true])
const sentText = hash => app.events.filter(e => e.type === 'character.texts').map(e => e.data.texts[hash]).find(Boolean)
const linksIn = hash => [...parse(sentText(hash)).querySelectorAll('[data-n]')].map(el => [Number(el.dataset.n), el.className, el.dataset.ability ?? el.dataset.checks ?? el.dataset.formulas ?? el.dataset.formula, el.dataset.dc])
assert.deepEqual(linksIn(rodHash), [
  [0, 'ss-save roll', 'dex', '14'], [1, 'ss-damage roll', '2d6', undefined], [2, 'ss-save roll', 'wis', undefined],
  [3, 'ss-check roll', 'skill:str:ath', '13'], [4, 'ss-check roll', 'tool:dex:thief', undefined], [5, 'ss-check roll', 'skill:dex:acr', '11'],
])
assert.ok(!sentText(rodHash).includes('16'), "a DC its author hid isn't sent")
assert.deepEqual(linksIn(wispHash), [[0, 'ss-save roll', 'dex', '13'], [1, 'ss-damage roll', '1d8', undefined], [2, 'ss-roll roll', '1d4', undefined]])
assert.deepEqual(linksIn(blessedHash), [[0, 'ss-roll roll', '1d4', undefined], [1, 'ss-save roll', 'wis', '12']])
const rodFlag = { id: 'rod', uuid: 'Actor.thorin.Item.rod', type: 'equipment' }
const torchFlag = { id: 'torch', uuid: 'Actor.thorin.Item.torch', type: 'equipment' }

// An item's: named for it, with it for dnd5e to head its cards with.
wait(31_000)
made = await ask(rodHash, 0)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.message.flavor, made.message.flags.dnd5e], ['Roll Request: Wand of Frost', { item: rodFlag }])
assert.deepEqual(chatted(made.message.id).ask, { type: 'save', abilities: ['dex'], dc: 14, label: 'Wand of Frost' })
made = await textDamage(rodHash, 1, [{ faces: 6, results: [2, 3] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.message.flavor, made.message.flags.dnd5e.item, made.roll.total, made.roll.options.type], ['Wand of Frost - Damage Roll', rodFlag, 5, 'cold'])
// Its save whose DC its author hid: asked with the DC on its button, shown no one, and rolled
// against it.
wait(31_000)
made = await ask(rodHash, 2)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([...parse(made.message.content).querySelectorAll('button')].map(b => ({ ...b.dataset })), [
  { type: 'save', ability: 'wis', dc: '16', hideDc: 'true', format: 'long', action: 'rollRequest', visibility: 'all' },
])
assert.deepEqual([chatted(made.message.id).ask, chatted(made.message.id).text], [{ type: 'save', abilities: ['wis'], label: 'Wand of Frost' }, 'Wisdom saving throw'])
made = await rollSave('wis', rodHash, 2, [13])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 15, 16, 'failure'])
// Its checks: dnd5e's skill link, asked and rolled against its DC; its tool link, whose DC its
// author hid, asked with the DC on its button, shown no one, and rolled against it; and one in plain
// words.
wait(31_000)
made = await ask(rodHash, 3)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(datasetsOf(made.message), [{ type: 'skill', ability: 'str', skill: 'ath', dc: '13', format: 'short', ...REQUEST }])
assert.deepEqual([made.message.flavor, made.message.flags.dnd5e], ['Roll Request: Wand of Frost', { item: rodFlag }])
assert.deepEqual(chatted(made.message.id).ask, { type: 'check', checks: [{ type: 'skill', ability: 'str', skill: 'ath' }], dc: 13, label: 'Wand of Frost' })
made = await rollCheck('skill', 'ath', rodHash, 3, [6])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 13, 13, 'success'])
wait(31_000)
made = await ask(rodHash, 4)
assert.deepEqual(datasetsOf(made.message), [{ type: 'tool', ability: 'dex', tool: 'thief', dc: '16', hideDc: 'true', format: 'short', ...REQUEST }])
assert.deepEqual([chatted(made.message.id).ask, chatted(made.message.id).text], [{ type: 'check', checks: [{ type: 'tool', ability: 'dex', tool: 'thief', name: "Thieves' Tools" }], label: 'Wand of Frost' }, "Dexterity (Thieves' Tools)"])
made = await rollCheck('tool', 'thief', rodHash, 4, [11])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 15, 16, 'failure'])
assert.deepEqual(refused(await rollCheck('skill', 'ath', rodHash, 4, [11])), ['failed', 'link', null])
made = await rollCheck('skill', 'acr', rodHash, 5, [10])
assert.deepEqual([made.result.status, made.roll.total, made.roll.options.target, made.result.outcome], ['done', 11, 11, 'success'])

// The copy of a spell an item casts: named for the spell and the item, asked with the item, and
// rolled with no item, so that its card keeps the flavor naming both.
wait(31_000)
made = await ask(wispHash, 0)
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.message.flavor, made.message.flags.dnd5e], ['Roll Request: Starry Wisp (Everburning Torch)', { item: torchFlag }])
made = await textDamage(wispHash, 1, [{ faces: 8, results: [6] }])
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.message.flavor, made.message.flags.dnd5e, made.roll.total], [
  'Starry Wisp (Everburning Torch) - Damage Roll', { messageType: 'roll', roll: { type: 'damage' }, targets: [] }, 6,
])
made = await textRoll(wispHash, 2, [{ faces: 4, results: [2] }])
assert.deepEqual([made.result.status, made.message.flavor, made.message.flags.dnd5e.item, made.roll.total], ['done', 'Starry Wisp (Everburning Torch)', undefined, 2])

// An effect's: named for it, with no item.
made = await textRoll(blessedHash, 0, [{ faces: 4, results: [4] }])
assert.deepEqual([made.result.status, made.message.flavor, made.message.flags.dnd5e.item, made.roll.total], ['done', 'Blessed', undefined, 4])
wait(31_000)
made = await ask(blessedHash, 1)
assert.deepEqual([made.result.status, made.message.flavor, made.message.flags.dnd5e], ['done', 'Roll Request: Blessed', undefined])
ok("through the module's own findLink, an item's description names its item, a spell an item casts the spell and the item, and an effect's the effect; its checks are asked and rolled; a DC its author hid is rolled against and shown no one")

// ---- Damage dnd5e's own link rolls through one of the item's activities ----
// A critical hit's only as that activity allows, with what it adds to each part, as the activity's
// own class reads it, both or neither of the span's attributes, marked never one too where that
// throws dice, for apps before 0.20.0; never where it allows none; the activity never sent.
const itemHash = id => sheetSent().inventory.sections.flatMap(section => section.items).find(it => it.id === id)?.text
const spansIn = hash => [...parse(sentText(hash)).querySelectorAll('[data-n]')].map(el => ({ ...el.dataset }))
const d8 = (...results) => ({ faces: 8, results })
const d4 = (...results) => ({ faces: 4, results })
let poisonHash = itemHash('poison')
assert.deepEqual(spansIn(poisonHash), [{ n: '0', formulas: '1d4', types: 'cold', critical: 'false' }])
assert.ok(!sentText(poisonHash).includes('Activity'), "the activity isn't sent")
made = await textDamage(poisonHash, 0, [{ faces: 4, results: [3] }])
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total, made.roll.isCritical], ['done', '1d4', 3, false])
posted = messages.size
assert.deepEqual(refused(await textDamage(poisonHash, 0, [{ faces: 4, results: [3, 4] }], { critical: true })), ['failed', 'invalid', 'critical'])
assert.deepEqual(refused(await textDamage(poisonHash, 0, [{ faces: 4, results: [3] }], { critical: true })), ['failed', 'invalid', 'critical'])
assert.equal(messages.size, posted)
// A javelin's critical damage, a number: what it adds, with nothing to say it's never a critical hit's.
let javelinHash = itemHash('javelin')
const JAVELIN = { formulas: '1d6 + 4', types: 'slashing', criticalDice: '0', criticalDamage: '4' }
assert.deepEqual(spansIn(javelinHash), [{ n: '0', ...JAVELIN }, { n: '1', ...JAVELIN }])
made = await textDamage(javelinHash, 0, [d6(2, 5)], { critical: true })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([made.roll.formula, made.roll.total, made.roll.isCritical], ['2d6 + 4 + 4', 2 + 5 + 4 + 4, true])
made = await textDamage(javelinHash, 0, [d6(2)])
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '1d6 + 4', 6])
// A potion: drunk, never a critical hit's; thrown, critical damage of a die, after the damage's own;
// smeared, of a number; sprayed, each of its parts with the critical damage.
const potionHash = itemHash('potion')
assert.deepEqual(spansIn(potionHash).map(({ formulas, critical, criticalDice, criticalDamage }) => [formulas, critical, criticalDice, criticalDamage]), [
  ['2d6', 'false', undefined, undefined], ['1d8', 'false', '0', '1d6'], ['1d6', undefined, '0', '2'], ['1d6&1d4', 'false', '0&0', '1d4&1d4'],
])
assert.deepEqual(refused(await textDamage(potionHash, 0, [d6(1, 2, 3, 4)], { critical: true })), ['failed', 'invalid', 'critical'])
made = await textDamage(potionHash, 1, [d8(1, 2), d6(3)], { critical: true })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([faces(made.roll), made.roll.formula, made.roll.total], [[[1, 2], [3]], '2d8 + 1d6', 6])
made = await textDamage(potionHash, 1, [d8(1, 2, 3, 4), d6(5)], { critical: true, modifiers: { extra: 1 } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '4d8 + 1d6', 15])
assert.deepEqual(refused(await textDamage(potionHash, 1, [d8(1, 2)], { critical: true })), ['failed', 'dice', null])
made = await textDamage(potionHash, 1, [{ faces: 8, results: [7] }])
assert.deepEqual([made.result.status, made.roll.total], ['done', 7])
made = await textDamage(potionHash, 2, [d6(1, 6)], { critical: true })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '2d6 + 2', 9])
// Changed in the app too, its critical damage added all the same.
made = await textDamage(potionHash, 2, [{ faces: 8, results: [1, 2, 3, 4] }], { critical: true, modifiers: { extra: 1, faces: 8 } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '4d8 + 2', 12])
made = await textDamage(potionHash, 3, [d6(1, 2), d4(3), d4(1, 2), d4(4)], { critical: true })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual(made.message.rolls.map(r => [r.formula, r.total, r.options.type]), [['2d6 + 1d4', 6, 'fire'], ['2d4 + 1d4', 7, 'cold']])
// An activity that has come to allow none since its description was sent: the description is new,
// and the one sent gone; the new one never a critical hit's.
potion.system.activities.get('smear').damage.critical.allow = false
assert.deepEqual(refused(await textDamage(potionHash, 2, [d6(1, 6)], { critical: true })), ['failed', 'gone', null])
potion.system.activities.get('smear').damage.critical.allow = true
ok("damage dnd5e's own link rolls through an activity is a critical hit's only as that activity allows, never a saving throw's or one allowing none, with what it adds to each part, such as an attack's critical damage or a damage activity's, of dice or a number, which the span says, thrown after the damage's own; the activity isn't sent; one changed since is a new description")

// A blade dnd5e's own class can't read the damage of: its sheet is sent all the same, its damage
// never a critical hit's.
const cursedHash = itemHash('cursed')
assert.deepEqual(spansIn(cursedHash), [{ n: '0', formulas: '1d6 + 4', types: 'slashing', critical: 'false' }])
assert.deepEqual(refused(await textDamage(cursedHash, 0, [d6(1, 2)], { critical: true })), ['failed', 'invalid', 'critical'])
made = await textDamage(cursedHash, 0, [d6(3)])
assert.deepEqual([made.result.status, made.roll.total], ['done', 7])
ok("an activity whose damage dnd5e's own class can't read has its description sent all the same, its damage never a critical hit's")

// Savage Attacks: a melee weapon's critical hit throws a die more on its first, which the span says,
// so its description is sent again, under a new hash, marked never a critical hit's for apps before
// 0.20.0; thrown, it throws none.
before = app.events.length
thorin.flags.dnd5e.meleeCriticalDamageDice = 1
await Hooks.callAll('updateActor', thorin, { flags: { dnd5e: { meleeCriticalDamageDice: 1 } } })
await new Promise(resolve => realSetTimeout(resolve, 300))
const savage = itemHash('javelin')
assert.notEqual(savage, javelinHash)
assert.equal(itemHash('poison'), poisonHash, "a description of no weapon's damage keeps its hash")
assert.deepEqual(spansIn(savage), [{ n: '0', ...JAVELIN, critical: 'false', criticalDice: '1' }, { n: '1', ...JAVELIN }])
assert.deepEqual(refused(await textDamage(javelinHash, 0, [d6(2, 5)], { critical: true })), ['failed', 'gone', null])
made = await textDamage(savage, 0, [d6(2, 5, 6)], { critical: true })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([faces(made.roll), made.roll.formula, made.roll.total], [[[2, 5, 6]], '3d6 + 4 + 4', 21])
made = await textDamage(savage, 0, [d8(1, 2, 3, 4, 5)], { critical: true, modifiers: { extra: 1, faces: 8 } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '5d8 + 4 + 4', 23])
assert.deepEqual(refused(await textDamage(savage, 0, [d6(2, 5)], { critical: true })), ['failed', 'dice', null])
made = await textDamage(savage, 1, [d6(2, 5)], { critical: true })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '2d6 + 4 + 4', 15])
if (MIDI) {
  // Since 0.32.0, whatever Midi's rule for the Gamemaster: the extra die thrown with its first, as
  // dnd5e throws it, never at its most beside it, left out, or each die at its highest.
  for (const rule of ['maxCrit', 'doubleDice', 'maxAll']) {
    assert.equal(await changeSetting('midi-qol.ConfigSettings', rule), 0, rule)
    made = await textDamage(savage, 0, [d6(2, 5, 6)], { critical: true })
    assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '3d6 + 4 + 4', 21], rule)
    assert.deepEqual(refused(await textDamage(savage, 0, [d6(3)], { critical: true })), ['failed', 'dice', null], rule)
  }
  assert.equal(await changeSetting('midi-qol.ConfigSettings', 'default'), 0)
}
ok(`a character's extra dice on a melee weapon's critical hit make its description new, the span saying them, marked never a critical hit's for older apps, and thrown with its first die${MIDI ? ', whatever Midi\'s rule for the Gamemaster' : ''}; thrown, it throws none`)

// A maul whose damage starts with a number: dnd5e throws no extra die on it, though its link writes
// its die first. A flail with two of a die: its link adds them together, and the extra die is thrown
// with them.
const maulHash = itemHash('maul')
assert.deepEqual(spansIn(maulHash), [{ n: '0', formulas: '1d6 + 2', types: 'slashing' }])
made = await textDamage(maulHash, 0, [d6(4, 5)], { critical: true })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '2d6 + 2', 11])
const flailHash = itemHash('flail')
assert.deepEqual(spansIn(flailHash), [{ n: '0', formulas: '2d8 + 4', types: 'slashing', critical: 'false', criticalDice: '1', criticalDamage: '' }])
made = await textDamage(flailHash, 0, [d8(1, 2, 3, 4, 5)], { critical: true })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '5d8 + 4', 19])
delete thorin.flags.dnd5e.meleeCriticalDamageDice
await Hooks.callAll('updateActor', thorin, { flags: { dnd5e: { '-=meleeCriticalDamageDice': null } } })
await new Promise(resolve => realSetTimeout(resolve, 300))
assert.equal(itemHash('javelin'), javelinHash)
ok("extra dice are thrown as dnd5e builds the activity's own roll: none on a part that starts with a number, though its link writes its die first; on dice of a size its link adds together, as many")

// What a critical hit adds that the app can't be sent: critical damage of a d3, of 21 dice, of 200,
// or of dice Foundry drops some of; extra dice of more than 20, or that aren't a number; and a
// configuration with another number of parts than the link. The link is never a critical hit's,
// and says nothing of what one adds. Critical damage with a flavor is sent without it, and rolled
// with it.
const ruinHash = itemHash('ruin')
const UNSENT = { formulas: '1d8', types: 'fire', critical: 'false' }
assert.deepEqual(spansIn(ruinHash), [
  { n: '0', ...UNSENT }, { n: '1', ...UNSENT }, { n: '2', ...UNSENT }, { n: '3', ...UNSENT },
  { n: '4', ...UNSENT, criticalDice: '0', criticalDamage: '1d6' },
])
posted = messages.size
for (const n of [0, 1, 2, 3]) {
  assert.deepEqual(refused(await textDamage(ruinHash, n, [d8(1, 2)], { critical: true })), ['failed', 'invalid', 'critical'], `link ${n}`)
}
assert.equal(messages.size, posted)
made = await textDamage(ruinHash, 4, [d8(1, 2), d6(3)], { critical: true })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([faces(made.roll), made.roll.formula, made.roll.total], [[[1, 2], [3]], '2d8 + 1d6[fire]', 6])
for (const dice of [21, '3']) {
  thorin.flags.dnd5e.meleeCriticalDamageDice = dice
  await Hooks.callAll('updateActor', thorin, { flags: { dnd5e: { meleeCriticalDamageDice: dice } } })
  await new Promise(resolve => realSetTimeout(resolve, 300))
  const unthrown = itemHash('javelin')
  assert.deepEqual(spansIn(unthrown), [{ n: '0', formulas: '1d6 + 4', types: 'slashing', critical: 'false' }, { n: '1', ...JAVELIN }], JSON.stringify(dice))
  assert.deepEqual(refused(await textDamage(unthrown, 0, [d6(1, 2, 3)], { critical: true })), ['failed', 'invalid', 'critical'], JSON.stringify(dice))
}
delete thorin.flags.dnd5e.meleeCriticalDamageDice
await Hooks.callAll('updateActor', thorin, { flags: { dnd5e: { '-=meleeCriticalDamageDice': null } } })
await new Promise(resolve => realSetTimeout(resolve, 300))
assert.equal(itemHash('javelin'), javelinHash)
const twinHash = itemHash('twin')
assert.deepEqual(spansIn(twinHash), [{ n: '0', formulas: '1d6 + 4&1d4', types: 'slashing&cold', critical: 'false' }])
assert.deepEqual(refused(await textDamage(twinHash, 0, [d6(1, 2), d4(3, 4)], { critical: true })), ['failed', 'invalid', 'critical'])
ok("what a critical hit adds that the app can't be sent, critical damage of a die no player rolls, of too many dice, past 100 or of dice dropped, extra dice past 20 or not a number, or a configuration of another number of parts, leaves its link never a critical hit's, saying nothing of it; critical damage with a flavor is sent without it, and rolled with it")

// ---- Damage that takes a die away (module 0.21.0) ----
// A literal link's `3 - 1d4 + 2d6`, as dnd5e enriches `[[/damage 3 - 1d4 + 2d6]]`: more dice, or
// another die, are its d6s', never the d4 it takes away; nor is it rolled at its highest, which would
// take the most away. A critical hit's doubles both, as dnd5e does. And a dice-less unarmed strike's
// bare `[[/damage]]` under Reduce's - 1d4 on melee weapon attacks: dnd5e's link writes its die first,
// `- 1d4 + 5`, which Foundry reads; it has no die of its own to change, nor any extra die.
ownItem('blight', 'equipment', 'Blighted Rod', `<p>It deals ${DAMAGE_LINK('3 - 1d4 + 2d6', 'fire', 'Fire')} damage.</p>`)
activityItem('fist', 'Unarmed Strike', '<p>It deals [[/damage]] damage.</p>',
  it => [damageActivity(it, 'punch', 'attack', [['1 + @mod', 'slashing']], { melee: true })])
thorin.system.bonuses.mwak = { damage: '- 1d4' }
await Hooks.callAll('updateActor', thorin, { system: { bonuses: { mwak: { damage: '- 1d4' } } } })
await new Promise(resolve => realSetTimeout(resolve, 300))
const blightHash = itemHash('blight')
assert.deepEqual(spansIn(blightHash), [{ n: '0', formulas: '3 - 1d4 + 2d6', types: 'fire' }])
posted = messages.size
made = await textDamage(blightHash, 0, [d4(2), d6(1, 2, 3)], { modifiers: { extra: 1 } })
assert.equal(made.result.status, 'done', JSON.stringify(made.result))
assert.deepEqual([faces(made.roll), made.roll.formula, made.roll.total], [[[2], [1, 2, 3]], '3 - 1d4 + 3d6', 3 - 2 + 6])
made = await textDamage(blightHash, 0, [d4(2), d8(3, 4)], { modifiers: { faces: 8 } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '3 - 1d4 + 2d8', 3 - 2 + 7])
posted = messages.size
assert.deepEqual(refused(await textDamage(blightHash, 0, [d4(1, 2), d6(1, 2)], { modifiers: { extra: 1 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(blightHash, 0, [d4(2), d6(3, 4)], { modifiers: { maximize: true } })), ['failed', 'invalid', 'modifiers'])
assert.equal(messages.size, posted)
made = await textDamage(blightHash, 0, [d4(1, 1), d6(1, 2, 3, 4, 5, 6)], { critical: true, modifiers: { extra: 1 } })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total, made.roll.isCritical], ['done', '3 - 2d4 + 6d6', 3 - 2 + 21, true])
const fistHash = itemHash('fist')
assert.deepEqual(spansIn(fistHash), [{ n: '0', formulas: '- 1d4 + 5', types: 'slashing' }])
made = await textDamage(fistHash, 0, [d4(3)])
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '- 1d4 + 5', 2])
posted = messages.size
assert.deepEqual(refused(await textDamage(fistHash, 0, [d4(1, 2)], { modifiers: { extra: 1 } })), ['failed', 'dice', null])
assert.deepEqual(refused(await textDamage(fistHash, 0, [d4(3)], { modifiers: { maximize: true } })), ['failed', 'invalid', 'modifiers'])
assert.equal(messages.size, posted)
made = await textDamage(fistHash, 0, [d4(1, 2)], { critical: true })
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total, made.roll.isCritical], ['done', '- 2d4 + 5', 2, true])
if (MIDI) {
  // Since 0.32.0 what the module plans for the app is dnd5e's critical, whatever Midi's rule for the
  // Gamemaster: under "Max Critical Dice (roll)" and "(flat number)" alike, each die doubled, the one
  // taken away too, and nothing beside them.
  const { plannedDamage, damageRollsFor } = await import(`${MODULE}/scripts/dice-plan.mjs`)
  midiCritical.gm = 'maxCritRoll'
  assert.deepEqual(plannedDamage({ rolls: [{ parts: ['1d8 - 1d4'], data: {}, options: {} }], isCritical: true }).rolls[0].dice, [
    { faces: 8, number: 2 }, { faces: 4, number: 2, subtracted: true },
  ])
  midiCritical.gm = 'maxCrit'
  assert.equal(damageRollsFor({ rolls: [{ parts: ['- 1d4 + 4'], data: {}, options: {} }], isCritical: true })[0].formula, '- 2d4 + 4')
  midiCritical.gm = 'default'
}
delete thorin.system.bonuses.mwak
thorin.items.delete('blight')
thorin.items.delete('fist')
await Hooks.callAll('updateActor', thorin, { system: { bonuses: { '-=mwak': null } } })
await new Promise(resolve => realSetTimeout(resolve, 300))
assert.equal(itemHash('javelin'), javelinHash)
// A description's damage this world can't plan for a player to throw, as a d3's, is no link at
// all, but its text: the game couldn't take its dice (module 0.21.0).
ownItem('murk', 'equipment', 'Murky Rod', `<p>It deals ${DAMAGE_LINK('1d3 + 2', 'cold', 'Cold')} damage.</p>`)
await Hooks.callAll('updateActor', thorin, {})
await new Promise(resolve => realSetTimeout(resolve, 300))
const murkHash = itemHash('murk')
assert.deepEqual(spansIn(murkHash), [])
assert.ok(sentText(murkHash).includes('1d3 + 2'), sentText(murkHash))
thorin.items.delete('murk')
await Hooks.callAll('updateActor', thorin, {})
await new Promise(resolve => realSetTimeout(resolve, 300))
{
  const { plannableDamage, plannedDice, subtractedTerms } = await import(`${MODULE}/scripts/dice-plan.mjs`)
  assert.deepEqual([plannableDamage('1d3 + 2'), plannableDamage('3 - 1d4 + 2d6'), plannableDamage('- 1d4 + 4')], [false, true, true])
  // As Foundry's parser may wrap a leading −1d4 (RollParser#_wrapNegativeTerm): never planned, so a
  // description's link of it isn't written, and an attack's is Foundry's to roll.
  const { OperatorTerm, ParentheticalTerm } = foundry.dice.terms
  const terms = [new ParentheticalTerm({ term: '1d4 * -1' }), new OperatorTerm({ operator: '+' }), new CONFIG.Dice.terms.d({ number: 2, faces: 6 })]
  assert.deepEqual(plannedDice({ terms }), { plannable: false, dice: [] })
  assert.equal(subtractedTerms(terms).size, 0)
}
ok(`a description's damage that takes a die away has more dice, or another die, of its first die it adds, never the one it takes away, and isn't rolled at its highest; a critical hit's doubles both; a dice-less attack's under Reduce, its link written with the die first, has no die to change${MIDI ? "; Midi's critical copies after a - are taken away too" : ''}; and damage this world can't plan, as a d3's, or a leading die in parentheses, is no link but its text`)

// Another module takes a die off the damage after the module planned it: built, it can't take every
// die the player rolled, so it's called off, and nothing is posted; rolled again, it's made.
posted = messages.size
Hooks.once('dnd5e.preRollDamageV2', config => { config.rolls[0].parts = ['4'] })
assert.deepEqual(refused(await textDamage(flameText, 3, [d6(3, 5)])), ['failed', 'dice', null])
assert.equal(messages.size, posted)
made = await textDamage(flameText, 3, [d6(3, 5)])
assert.deepEqual([made.result.status, made.roll.formula, made.roll.total], ['done', '2d6', 8])
ok("a description's damage another module changes once planned, so that it can't take the player's dice, is called off, and nothing posted")

// ---- The Gamemaster's, as the character (module 0.23.0) ----
// Asking the table, a description's own roll, its damage and a save and check against its DC: each
// made as the player's, by Thorin's player, and flagged the Gamemaster's; the player's never.
wait(31_000)
{
  const flagsOf = made => made.message?.flags['sending-stone']
  const gmAsk = await ask(flameText, 0, { by: 'gm' })
  assert.deepEqual([gmAsk.result.status, gmAsk.message.author.id], ['done', 'alice'])
  assert.deepEqual(flagsOf(gmAsk), { request: gmAsk.command.id, ask: { actorId: 'thorin', text: flameText, link: 0 }, by: 'gm' })
  assert.deepEqual([chatted(gmAsk.message.id).gmRoll, chatted(gmAsk.message.id).ask.abilities], [gmAsk.command.id, ['dex']])
  const gmMade = [
    await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { by: 'gm' }),
    await textDamage(flameText, 3, [d6(3, 5)], { by: 'gm' }),
    await rollSave('dex', flameText, 0, [14], { by: 'gm' }),
    await rollCheck('skill', 'ath', flameText, 14, [10], { by: 'gm' }),
  ]
  const playerMade = [
    await textRoll(flameText, 4, [{ faces: 4, results: [3] }]),
    await textDamage(flameText, 3, [d6(3, 5)]),
    await rollSave('dex', flameText, 0, [14]),
    await rollCheck('skill', 'ath', flameText, 14, [10]),
  ]
  for (const [index, made] of gmMade.entries()) {
    const player = playerMade[index]
    assert.equal(made.result.status, 'done', JSON.stringify(made.result))
    assert.deepEqual(flagsOf(made), { request: made.command.id, by: 'gm' })
    assert.deepEqual(flagsOf(player), { request: player.command.id })
    assert.deepEqual([made.message.author.id, made.message.speaker, made.message.flavor, made.roll.total, made.result.outcome], [player.message.author.id, player.message.speaker, player.message.flavor, player.roll.total, player.result.outcome])
    assert.equal(chatted(made.message.id).gmRoll, made.command.id)
    assert.equal('gmRoll' in chatted(player.message.id), false)
  }
  wait(31_000)
  const playerAsk = await ask(flameText, 0)
  assert.deepEqual(flagsOf(playerAsk), { request: playerAsk.command.id, ask: { actorId: 'thorin', text: flameText, link: 0 } })
  assert.equal('gmRoll' in chatted(playerAsk.message.id), false)
  posted = messages.size
  assert.deepEqual(refused(await textRoll(flameText, 4, [{ faces: 4, results: [3] }], { by: 'player' })), ['failed', 'invalid', 'by'])
  assert.deepEqual(refused(await textDamage(flameText, 3, [d6(3, 5)], { by: 1 })), ['failed', 'invalid', 'by'])
  wait(31_000)
  assert.deepEqual(refused(await ask(flameText, 0, { by: {} })), ['failed', 'invalid', 'by'])
  assert.equal(messages.size, posted)
}
ok(`the Gamemaster's ask, a description's roll and damage, and a save and check against its DC are made as the player's, flagged the Gamemaster's, the ask's card with what it asks, and sent with gmRoll; the player's are flagged as ever; another by is refused${MIDI ? ', with Midi-QOL' : ''}`)

assert.equal(opened().length, 0)
ok('nobody was prompted by any of it, though the campaigns prompt their players')

console.log(`${MIDI ? 'midi' : 'dnd5e'}: done`)
process.exit(0)
