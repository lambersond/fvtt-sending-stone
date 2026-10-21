// A stand-in for Foundry VTT v14's core dice, as far as dnd5e's roll classes and the module use
// them: Roll and its terms, the roll -> _roll -> randomFace path, interactive resolvers, the
// _root a term knows its roll by, Foundry v14's Die modifiers (rerolls, explosions, keep and drop,
// min and max, counting successes and failures) with its own loops, Foundry's extensions of
// built-ins, and chat messages. Import after stub.mjs and before dnd5e's dice. Switches in `core`
// let a test leave _root off top-level terms, configure interactive (manual) dice, make rolls blind,
// have the min modifier do nothing, or roll rerolls and explosions as first throws.

export const core = {
  /** Leave `_root` off a roll's own dice, as Foundry might. */
  omitRoot: false,
  /** The Gamemaster configured manual dice: a roll that allows it asks for its results. */
  interactive: false,
  /** Every chat message is made blind, as Midi-QOL can make a player's check. */
  forceBlind: false,
  /** The min modifier does nothing, as a Foundry that rolled dice otherwise might. */
  breakMinimum: false,
  /** A reroll or an explosion is rolled without saying so, as a first throw, as a Foundry that rolled them otherwise might. */
  breakReroll: false,
}

/** Rolls that asked the Gamemaster for their dice. */
export const prompts = []

// A seeded random source, so a run can be repeated.
let seed = 12345
export function seedRandom(value) { seed = value }
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/* -------------------------------------------- */
/*  Foundry's extensions of built-ins           */
/* -------------------------------------------- */

const define = (target, name, value) =>
  Object.defineProperty(target, name, { value, configurable: true, writable: true })
define(Array.prototype, 'partition', function (rule) {
  return this.reduce((parts, value) => { parts[Number(!!rule(value))].push(value); return parts }, [[], []])
})
define(Array.prototype, 'findSplice', function (find, replace) {
  const index = this.findIndex(find)
  if (index === -1) return null
  const [item] = replace === undefined ? this.splice(index, 1) : this.splice(index, 1, replace)
  return item
})
define(String.prototype, 'capitalize', function () { return this.charAt(0).toUpperCase() + this.slice(1) })
// common/utils/primitives/array.mjs: the values that are something, joined.
define(Array.prototype, 'filterJoin', function (sep) { return this.filter(p => !!p).join(sep) })
// Foundry's extensions of Set, which dnd5e's hit dice use (common/utils/primitives/set.mjs).
define(Set.prototype, 'find', function (test) { for (const value of this) if (test(value)) return value; return undefined })
define(Set.prototype, 'some', function (test) { for (const value of this) if (test(value)) return true; return false })
define(Set.prototype, 'reduce', function (reducer, accumulator) {
  for (const value of this) accumulator = reducer(accumulator, value)
  return accumulator
})
Number.isNumeric = value => (typeof value === 'number' ? Number.isFinite(value)
  : (typeof value === 'string') && (value.trim() !== '') && Number.isFinite(Number(value)))
Math.clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const isPlain = value => value?.constructor === Object
function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain)
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clonePlain(v)]))
  return value
}
function mergeObject(original = {}, other = {}, { inplace = true } = {}, _d = 0) {
  // As Foundry's: keys in dot notation are expanded at the top.
  if ((_d === 0) && Object.keys(other ?? {}).some(key => key.includes('.'))) other = foundry.utils.expandObject(other)
  if ((_d === 0) && Object.keys(original ?? {}).some(key => key.includes('.'))) {
    const expanded = foundry.utils.expandObject(original)
    if (inplace) { for (const key of Object.keys(original)) delete original[key]; Object.assign(original, expanded) }
    else original = expanded
  }
  const target = inplace ? (original ?? {}) : clonePlain(original ?? {})
  for (const [key, value] of Object.entries(other ?? {})) {
    if (isPlain(value) && isPlain(target[key])) target[key] = mergeObject(target[key], value, {}, _d + 1)
    else target[key] = isPlain(value) ? mergeObject({}, value, {}, _d + 1) : value
  }
  return target
}
Object.assign(foundry.utils, {
  mergeObject,
  deepClone: clonePlain,
  getType(value) {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'Array'
    if (typeof value === 'object') return isPlain(value) ? 'Object' : value.constructor.name
    return typeof value
  },
  getProperty: (object, path) => path.split('.').reduce((o, key) => o?.[key], object),
  setProperty(object, path, value) {
    const keys = path.split('.')
    let o = object
    for (const key of keys.slice(0, -1)) o = (o[key] ??= {})
    o[keys.at(-1)] = value
    return true
  },
  isEmpty: value => (value == null) || ((typeof value === 'object') && (Object.keys(value).length === 0)),
})

/* -------------------------------------------- */
/*  Terms                                       */
/* -------------------------------------------- */

class RollTerm {
  /** Foundry's: a term's flavor, in brackets after it, as "1d6[fire]". */
  static FLAVOR_REGEXP_STRING = '(?:\\[([^\\]]+)\\])'
  static FLAVOR_REGEXP = new RegExp(RollTerm.FLAVOR_REGEXP_STRING, 'g')

  constructor({ options = {} } = {}) {
    this.options = options
    this._evaluated = false
  }
  get resolver() { return this._root?._resolver }
  get isDeterministic() { return true }
  /** As Foundry's: its expression, and its flavor after it, if any. */
  get formula() { return this.flavor ? `${this.expression}[${this.flavor}]` : this.expression }
  get flavor() { return this.options.flavor ?? '' }
  /** What a term of its class is made of, beside its options, for toJSON. */
  _data() { return {} }
  /**
   * As Foundry's: a term as plain data, its class by name; and a term made again of it, as
   * dnd5e 6 copies a modified die for a critical hit and module 0.32.0 copies a critical hit's
   * terms as they were without it.
   */
  toJSON() { return { class: this.constructor.name, options: this.options, evaluated: this._evaluated, ...this._data() } }
  static fromData(data) {
    const classes = [...Object.values(foundry.dice.terms), ...Object.values(CONFIG.Dice.terms ?? {}), ...Object.values(CONFIG.Dice)]
    const Cls = classes.find(cls => cls?.name === data.class)
    if (!Cls) throw new Error(`No term class ${data.class}`)
    const term = new Cls({ ...data })
    term._evaluated = data.evaluated === true
    return term
  }
}

/** Text in a formula that isn't a term of its own, such as a lone "d8": none is made here. */
class StringTerm extends RollTerm {
  constructor({ term, options } = {}) { super({ options }); this.term = term }
  _data() { return { term: this.term } }
  get expression() { return this.term }
}

/** A term in parentheses: none is made here, but dnd5e's damage rolls look for them. */
class ParentheticalTerm extends RollTerm {
  constructor({ term, options } = {}) { super({ options }); this.term = term }
  _data() { return { term: this.term } }
  get expression() { return `(${this.term})` }
}

/** A function of terms, such as max(1d4, 2): none is made here, but dnd5e's damage rolls look for them. */
class FunctionTerm extends RollTerm {
  constructor({ fn, terms = [], options } = {}) { super({ options }); this.fn = fn; this.terms = terms }
  _data() { return { fn: this.fn, terms: [...this.terms] } }
  get expression() { return `${this.fn}(${this.terms.join(', ')})` }
}

class NumericTerm extends RollTerm {
  constructor({ number, options } = {}) { super({ options }); this.number = Number(number) }
  _data() { return { number: this.number } }
  get total() { return this.number }
  get expression() { return String(this.number) }
  async evaluate() { this._evaluated = true; return this }
}

class OperatorTerm extends RollTerm {
  constructor({ operator, options } = {}) { super({ options }); this.operator = operator }
  _data() { return { operator: this.operator } }
  get expression() { return this.operator }
  async evaluate() { this._evaluated = true; return this }
}

class DiceTerm extends RollTerm {
  /** Foundry's: a DiceTerm knows no modifiers of its own; Die's are below. */
  static MODIFIERS = {}

  constructor({ number = 1, faces = 6, modifiers = [], results = [], options = {}, method } = {}) {
    super({ options })
    this._number = number
    this._faces = faces
    this.modifiers = [...modifiers]
    this.results = [...results]
    this.method = method
  }
  _data() { return { number: this._number, faces: this._faces, modifiers: [...this.modifiers], results: this.results.map(r => ({ ...r })), method: this.method } }
  get number() { return this._number }
  set number(value) { this._number = value }
  get faces() { return this._faces }
  set faces(value) { this._faces = value }
  get expression() { return `${this._number}d${this._faces}${this.modifiers.join('')}` }
  /** Foundry's: a result raised or lowered by a modifier, or counted as a success, counts as its count. */
  get total() { return this.results.reduce((total, r) => (r.active ? total + (r.count ?? r.result) : total), 0) }
  /** Foundry's: the values of the active results, as dnd5e's success highlight counts them. */
  get values() { return this.results.filter(r => r.active).map(r => r.result) }
  get isDeterministic() { return false }

  /** Foundry's: multiply the number of dice, then add some, as a critical hit does. */
  alter(multiply, add) {
    if (this._evaluated) throw new Error('An evaluated DiceTerm cannot be altered')
    if (multiply !== undefined) this._number = Math.floor(this._number * multiply)
    if (add !== undefined) this._number += add
    return this
  }

  async evaluate(options = {}) {
    if (this._evaluated) throw new Error('This term has already been evaluated')
    await this._evaluateAsync(options)
    this._evaluated = true
    return this
  }
  async _evaluateAsync(options = {}) {
    for (let n = this.results.length; n < this.number; n++) await this.roll(options)
    await this._evaluateModifiers()
    return this
  }

  /** Foundry's: the die's fulfillment first, then a random face. */
  async roll({ minimize = false, maximize = false, ...rest } = {}) {
    let result = await this._roll({ minimize, maximize, ...rest })
    if (minimize) result = 1
    else if (maximize) result = this.faces
    if (result === undefined) result = this.randomFace()
    const roll = { result, active: true }
    this.results.push(roll)
    return roll
  }
  /** Interactive dice are asked of their roll's resolver, as manual dice would be. */
  _roll() { return this.resolver?.resolveResult(this) }
  randomFace() { return Math.ceil(random() * this.faces) }

  /**
   * Foundry's: each modifier is the command its letters name, applied with it; or, for letters no
   * command is, each command they start with in turn, longest first, applied bare. Unlike Foundry's,
   * the modifiers are left as written, which only the term's expression after evaluation would show.
   */
  async _evaluateModifiers() {
    const cls = this.constructor
    const all = Object.keys(cls.MODIFIERS).sort((a, b) => b.length - a.length)
    for (const modifier of [...this.modifiers]) {
      let command = (modifier.match(/[A-z]+/)?.[0] ?? '').toLowerCase()
      if (command in cls.MODIFIERS) {
        await this._evaluateModifier(command, modifier)
        continue
      }
      while (command) {
        const known = all.find(each => command.startsWith(each))
        if (!known) break
        await this._evaluateModifier(known, known)
        command = command.replace(known, '')
      }
    }
  }
  async _evaluateModifier(command, modifier) {
    let fn = this.constructor.MODIFIERS[command]
    if (typeof fn === 'string') fn = this[fn]
    if (fn instanceof Function) await fn.call(this, modifier)
  }

  /** Foundry's DiceTerm.compareResult: any other comparison, such as "==", matches nothing. */
  static compareResult(result, comparison, target) {
    switch (comparison) {
      case '=': return result === target
      case '<': return result < target
      case '<=': return result <= target
      case '>': return result > target
      case '>=': return result >= target
    }
    return false
  }

  /**
   * Foundry's DiceTerm._keepOrDrop: the active results on the wrong side of the cut are discarded,
   * then ties at the cut, in order, until as many are discarded as should be.
   */
  static _keepOrDrop(results, number, { keep = true, highest = true } = {}) {
    const ascending = keep === highest
    const values = results.filter(r => r.active).map(r => r.result).sort((a, b) => (ascending ? a - b : b - a))
    number = Math.clamp(keep ? values.length - number : number, 0, values.length)
    const cut = values[number]
    let discarded = 0
    const ties = []
    const comparison = ascending ? '<' : '>'
    for (const r of results) {
      if (!r.active) continue
      if (this.compareResult(r.result, comparison, cut)) {
        r.discarded = true
        r.active = false
        discarded++
      } else if (r.result === cut) ties.push(r)
    }
    for (const r of ties) {
      if (discarded < number) {
        r.discarded = true
        r.active = false
        discarded++
      }
    }
    return discarded
  }

  /** Foundry's DiceTerm._applyCount: every result, active or not, counts 1 or 0. */
  static _applyCount(results, comparison, target, { flagSuccess = false, flagFailure = false } = {}) {
    for (const r of results) {
      const success = this.compareResult(r.result, comparison, target)
      if (flagSuccess) {
        r.success = success
        if (success) delete r.failure
      } else if (flagFailure) {
        r.failure = success
        if (success) delete r.success
      }
      r.count = success ? 1 : 0
    }
  }
}

class Die extends DiceTerm {
  static DENOMINATION = 'd'

  /** Foundry v14's, as far as the app reads them: the rest (even, odd, df, sf, ms) are left out. */
  static MODIFIERS = {
    r: 'reroll', rr: 'rerollRecursive', x: 'explode', xo: 'explodeOnce',
    k: 'keep', kh: 'keep', kl: 'keep', d: 'drop', dh: 'drop', dl: 'drop',
    min: 'minimum', max: 'maximum', cs: 'countSuccess', cf: 'countFailures',
  }

  /**
   * Foundry's Die#reroll: the results walked in order from the first, each active one that meets
   * the condition rerolled, once (`r`), only the term's own first throw being checked, or
   * recursively (`rr`), its rerolls checked in their turn; `rM…` rerolls M at most.
   */
  async reroll(modifier, { recursive = false } = {}) {
    const match = modifier.match(/rr?([0-9]+)?([<>=]+)?([0-9]+)?/i)
    if (!match) return false
    let [max, comparison, target] = match.slice(1)
    if (max && !(target || comparison)) { target = max; max = null }
    max = Number.isNumeric(max) ? parseInt(max) : null
    target = Number.isNumeric(target) ? parseInt(target) : 1
    comparison = comparison || '='
    let checked = 0
    const initial = this.results.length
    while (checked < this.results.length) {
      const r = this.results[checked]
      checked++
      if (!r.active) continue
      if ((max !== null) && (max <= 0)) break
      if (DiceTerm.compareResult(r.result, comparison, target)) {
        r.rerolled = true
        r.active = false
        await this.roll(core.breakReroll ? {} : { reroll: true })
        if (max !== null) max -= 1
      }
      if (!recursive && (checked === initial)) break
      if (checked > 1000) throw new Error('Maximum recursion depth for exploding dice roll exceeded')
    }
  }
  async rerollRecursive(modifier) { return this.reroll(modifier, { recursive: true }) }

  /**
   * Foundry's Die#explode: one more die for each active result that meets the condition, the highest
   * face where it names none, recursively (`x`) or for the term's own first throw alone (`xo`).
   */
  async explode(modifier, { recursive = true } = {}) {
    const match = modifier.match(/xo?([0-9]+)?([<>=]+)?([0-9]+)?/i)
    if (!match) return false
    let [max, comparison, target] = match.slice(1)
    if (max && !(target || comparison)) { target = max; max = null }
    target = Number.isNumeric(target) ? parseInt(target) : this.faces
    comparison = comparison || '='
    max = Number.isNumeric(max) ? parseInt(max) : null
    let checked = 0
    const initial = this.results.length
    while (checked < this.results.length) {
      const r = this.results[checked]
      checked++
      if (!r.active) continue
      if ((max !== null) && (max <= 0)) break
      if (DiceTerm.compareResult(r.result, comparison, target)) {
        r.exploded = true
        await this.roll(core.breakReroll ? {} : { explode: true })
        if (max !== null) max -= 1
      }
      if (!recursive && (checked === initial)) break
      if (checked > 1000) throw new Error('Maximum recursion depth for exploding dice roll exceeded')
    }
  }
  async explodeOnce(modifier) { return this.explode(modifier, { recursive: false }) }

  /** Foundry's Die#keep: the highest (default) or lowest N, one where it names none or 0. */
  keep(modifier) {
    const match = modifier.match(/k([hl])?([0-9]+)?/i)
    if (!match) return false
    let [direction, number] = match.slice(1)
    direction = direction ? direction.toLowerCase() : 'h'
    number = parseInt(number) || 1
    DiceTerm._keepOrDrop(this.results, number, { keep: true, highest: direction === 'h' })
  }
  /** Foundry's Die#drop: the lowest (default) or highest N, one where it names none or 0. */
  drop(modifier) {
    const match = modifier.match(/d([hl])?([0-9]+)?/i)
    if (!match) return false
    let [direction, number] = match.slice(1)
    direction = direction ? direction.toLowerCase() : 'l'
    number = parseInt(number) || 1
    DiceTerm._keepOrDrop(this.results, number, { keep: false, highest: direction !== 'l' })
  }

  /** Foundry's Die#minimum: no higher than the die's faces, and the result kept, counting as the minimum. */
  async minimum(modifier) {
    if (core.breakMinimum) return
    const match = modifier.match(/(?:min)([0-9]+)/i)
    if (!match) return false
    const target = Math.min(parseInt(match[1]), this.faces)
    for (const r of this.results) if (r.result < target) r.count = target
  }
  /** Foundry's Die#maximum: no lower than 1, and the result kept, counting as the maximum. */
  async maximum(modifier) {
    const match = modifier.match(/(?:max)([0-9]+)/i)
    if (!match) return false
    const target = Math.max(parseInt(match[1]), 1)
    for (const r of this.results) if (r.result > target) r.count = target
  }

  /** Foundry's Die#countSuccess: a target it names none of is NaN, and counts nothing. */
  countSuccess(modifier) {
    const match = modifier.match(/(?:cs)([<>=]+)?([0-9]+)?/i)
    if (!match) return false
    const [comparison, target] = match.slice(1)
    DiceTerm._applyCount(this.results, comparison || '=', parseInt(target) ?? this.faces, { flagSuccess: true })
  }
  /** Foundry's Die#countFailures, the same. */
  countFailures(modifier) {
    const match = modifier.match(/(?:cf)([<>=]+)?([0-9]+)?/i)
    if (!match) return false
    const [comparison, target] = match.slice(1)
    DiceTerm._applyCount(this.results, comparison || '=', parseInt(target) ?? 1, { flagFailure: true })
  }
}

/* -------------------------------------------- */
/*  Roll                                        */
/* -------------------------------------------- */

const ROLL = Symbol('roll')

class Roll {
  constructor(formula, data = {}, options = {}) {
    this.data = data
    this.options = options
    this.terms = this.constructor.parse(formula, data)
    this._evaluated = false
    this._total = undefined
    this.resetFormula()
  }

  static parse(formula, data) {
    // Foundry's Math functions, as far as min() and max() of two numbers, which dnd5e's wands use for
    // the most levels they cast at (`min(@item.uses.value, 3)`): any other function is invalid here.
    const number = '\\s*(-?\\d+(?:\\.\\d+)?)\\s*'
    const text = this.replaceFormulaData(String(formula), data, { missing: '0' })
      .replace(new RegExp(`\\b(min|max)\\(${number},${number}\\)`, 'gi'), (match, fn, a, b) => String(Math[fn.toLowerCase()](Number(a), Number(b))))
      .replace(/\+\s*-/g, '-').replace(/-\s*-/g, '+')
    const terms = []
    for (const piece of text.split(/([+-])/).map(p => p.trim()).filter(Boolean)) {
      if ((piece === '+') || (piece === '-')) terms.push(new OperatorTerm({ operator: piece }))
      else terms.push(this.parseTerm(piece))
    }
    return terms
  }

  static parseTerm(piece) {
    // As Foundry's: a term's flavor, in brackets after it, kept in its options, as "1d6[fire]".
    const [, body, flavor] = /^(.*?)(?:\[([^\]]+)\])?$/s.exec(piece)
    const options = flavor ? { flavor } : {}
    const dice = body.match(/^(\d*)d(\d+)(.*)$/i)
    if (!dice) return new NumericTerm({ number: body, options })
    // Its modifiers, split as Foundry splits them (DiceTerm.MODIFIER_REGEXP): letters, then what
    // follows them up to the next letter, as "r<=2", "kh3" or "cs>=5".
    const modifiers = Array.from(dice[3].matchAll(/([A-z]+)([^A-z\s()+\-*/]+)?/g), ([text]) => text)
    const Cls = CONFIG.Dice.terms?.d ?? Die
    return new Cls({ number: Number(dice[1] || 1), faces: Number(dice[2]), modifiers, options })
  }

  static replaceFormulaData(formula, data, { missing } = {}) {
    return formula.replace(/@([a-z0-9_.-]+)/gi, (match, path) => {
      const value = foundry.utils.getProperty(data, path)
      return (value === undefined) || (value === null) ? (missing ?? match) : String(value)
    })
  }

  static create(formula, data = {}, options = {}) { return new this(formula, data, options) }

  // As Foundry's: whether a formula can be rolled, with any data in it taken as 1. This parser
  // reads only dice, with their modifiers' comparisons (module 0.22.0), numbers, + and -, so
  // anything else it can't read is invalid here. As Foundry's,
  // which evaluates it: a leading sign is accepted, as in dnd5e's "- 1d4 + 4" for a dice-less attack
  // less Reduce's d4 (module 0.21.0). This parser reads it as an operator, as dnd5e's own terms have
  // it; Foundry's may wrap a leading die in parentheses instead (RollParser#_wrapNegativeTerm), which
  // texts.mjs checks by hand.
  static validate(formula) {
    const text = String(formula).replace(/@([a-z.0-9_-]+)/gi, '1')
    if (!text.trim() || /[^\w\s+\-*/().,[\]<>=]/.test(text)) return false
    try {
      const terms = this.parse(text, {})
      const leading = (terms[0] instanceof OperatorTerm) && ['+', '-'].includes(terms[0].operator)
      if (leading && (terms.length > 1) && !(terms[1] instanceof OperatorTerm)) terms.shift()
      if (!terms.length || (terms[0] instanceof OperatorTerm) || (terms.at(-1) instanceof OperatorTerm)) return false
      return terms.every((term, index) => (term instanceof OperatorTerm) ? !(terms[index + 1] instanceof OperatorTerm)
        : (term instanceof DiceTerm) || ((term instanceof NumericTerm) && Number.isFinite(term.number)))
    } catch {
      return false
    }
  }

  static getFormula(terms) { return terms.map(term => term.formula).join(' ') }
  // As Foundry's: no leading + and no trailing operator; this parser makes no string terms to merge.
  static simplifyTerms(terms) {
    const simplified = [...terms]
    if ((simplified[0] instanceof OperatorTerm) && (simplified[0].operator === '+')) simplified.shift()
    while (simplified.at(-1) instanceof OperatorTerm) simplified.pop()
    return simplified
  }
  // As Foundry's: arithmetic of numbers and operators, as dnd5e's simplifyRollFormula adds them up.
  static safeEval(expression) {
    const result = new Function(`return (${expression})`)()
    if (!Number.isFinite(result)) throw new Error(`Roll.safeEval produced a non-numeric result from expression "${expression}"`)
    return result
  }
  // As Foundry's: the formula as last reset, which evaluating doesn't change.
  get formula() { return this._formula }
  resetFormula() { return (this._formula = this.constructor.getFormula(this.terms)) }
  get dice() { return this.terms.filter(term => term instanceof DiceTerm) }
  get total() { return this._total }
  get isDeterministic() { return this.terms.every(term => term.isDeterministic) }

  async evaluate(options = {}) {
    if (this._evaluated) throw new Error(`The ${this.constructor.name} has already been evaluated`)
    this._evaluated = true
    const { allowInteractive = true, minimize = false, maximize = false } = options
    // Manual dice ask the Gamemaster for every die of the roll, in a dialog.
    if (!this._root && (allowInteractive !== false) && !minimize && !maximize && core.interactive) {
      prompts.push(this.formula)
      this._resolver = { addTerm: async () => {}, resolveResult: term => term.faces }
    }
    for (const term of this.terms) {
      if (!(core.omitRoot && (term instanceof DiceTerm))) term._root = this._root ?? this
      if (!term._evaluated) await term.evaluate(options)
    }
    let sign = 1
    let total = 0
    for (const term of this.terms) {
      if (term instanceof OperatorTerm) sign = term.operator === '-' ? -1 : 1
      else total += sign * term.total
    }
    this._total = total
    return this
  }

  /** Evaluate a roll whose dice are all maximized or minimized, as Foundry allows synchronously. */
  evaluateSync({ maximize = false, minimize = false } = {}) {
    if (this._evaluated) throw new Error(`The ${this.constructor.name} has already been evaluated`)
    this._evaluated = true
    let sign = 1
    let total = 0
    for (const term of this.terms) {
      if (term instanceof OperatorTerm) { sign = term.operator === '-' ? -1 : 1; continue }
      if (term instanceof DiceTerm) {
        if (!maximize && !minimize) throw new Error('Only deterministic rolls can be evaluated synchronously')
        const value = maximize ? term.faces : 1
        for (let n = 0; n < term.number; n++) term.results.push({ result: value, active: true })
        term._evaluated = true
      }
      total += sign * term.total
    }
    this._total = total
    return this
  }

  clone() { return new this.constructor(this._formula, this.data, this.options) }

  toJSON() {
    return { class: this.constructor.name, formula: this.formula, options: this.options, total: this._total, [ROLL]: this }
  }
  static fromData(data) { return data[ROLL] ?? new this(data.formula, {}, data.options) }
}

globalThis.Roll = Roll
foundry.dice = { Roll, terms: { RollTerm, DiceTerm, Die, NumericTerm, OperatorTerm, StringTerm, ParentheticalTerm, FunctionTerm } }
CONFIG.Dice = { ...CONFIG.Dice, terms: {}, randomUniform: random }
CONFIG.sounds = { dice: 'sounds/dice.wav' }
globalThis.CONST.DICE_ROLL_MODES = { PUBLIC: 'publicroll', PRIVATE: 'gmroll', BLIND: 'blindroll', SELF: 'selfroll' }
foundry.applications.instances = new Map()

/* -------------------------------------------- */
/*  Chat messages                               */
/* -------------------------------------------- */

class Collection extends Map {
  get contents() { return [...this.values()] }
  filter(fn) { return this.contents.filter(fn) }
  find(fn) { return this.contents.find(fn) }
}
export const messages = new Collection()
game.messages = messages
let messageIds = 0

/** A message's visibility, by roll or message mode. */
function applyMode(data, mode) {
  const gms = game.users.filter(user => user.isGM).map(user => user.id)
  if (core.forceBlind || ['blind', 'blindroll'].includes(mode)) { data.whisper = gms; data.blind = true }
  else if (['gm', 'gmroll'].includes(mode)) data.whisper = gms
  else if (['self', 'selfroll'].includes(mode)) data.whisper = [data.author]
}

/**
 * What a chat message can be asked, as dnd5e's ChatMessage5e has it: its flags, and the actor,
 * activity and rolls a use's card is associated with.
 */
const messageMethods = {
  getFlag(scope, key) { return foundry.utils.getProperty(this.flags?.[scope] ?? {}, key) },
  /** As Foundry's: an update of the flag, so the update hook fires with it. */
  async setFlag(scope, key, value) {
    return this.update({ [`flags.${scope}.${key}`]: value })
  },
  getAssociatedActor() { return game.actors.get(this.speaker?.actor) ?? null },
  getAssociatedActivity() {
    const { item, activity } = this.flags?.dnd5e ?? {}
    return this.getAssociatedActor()?.items?.get(item?.id)?.system.activities.get(activity?.id) ?? null
  },
  getAssociatedRolls(type) {
    return [...messages.values()].filter(m => (m.flags?.dnd5e?.originatingMessage === this.id)
      && (m.flags?.dnd5e?.roll?.type === type))
  },
  async delete() { messages.delete(this.id); this.deleted = true; return this },
  /** As Foundry's, before a message is made: changes, flat or nested, merged into what's made. */
  updateSource(changes = {}) {
    const changed = foundry.utils.expandObject(changes)
    foundry.utils.mergeObject(this, changed)
    return changed
  },
  /** As Foundry's: changes, flat or nested, merged into the message, then the update hook. */
  async update(changes = {}) {
    const changed = foundry.utils.expandObject(changes)
    foundry.utils.mergeObject(this, changed)
    Hooks.callAll('updateChatMessage', this, changed, {}, game.user.id)
    return this
  },
}

class ChatMessage {
  constructor(data = {}) { this._data = data }
  toObject() { return { ...this._data } }
  applyRollMode(mode) { applyMode(this._data, mode) }
  /** Foundry v14's, as dnd5e 6's BasicRoll#toMessage calls it (basic-roll.mjs:273). */
  applyMode(mode) { applyMode(this._data, mode) }
  /**
   * As Foundry's: the actor, and the token given, or else the actor's own as a token's synthetic
   * actor has it, or the one a harness says Foundry would find on the Gamemaster's scene
   * (`speakerToken`); none, as before, for an actor with none of them.
   */
  static getSpeaker({ actor, token } = {}) {
    const tokenId = (token ?? actor?.token ?? actor?.speakerToken)?.id
    return { actor: actor?.id ?? null, ...(tokenId && { token: tokenId }), alias: actor?.name ?? null }
  }
  static applyRollMode(data, mode) { applyMode(data, mode) }
  static async create(data, options = {}) {
    const source = { author: game.user.id, whisper: [], blind: false, ...data }
    applyMode(source, options.rollMode ?? options.messageMode ?? source.rollMode ?? 'public')
    const id = `msg${String(++messageIds).padStart(13, '0')}`
    const now = Date.now()
    const message = Object.assign(Object.create(messageMethods), {
      // Foundry's: when it was made, by the server's clock, which its timestamp is too.
      id, uuid: `ChatMessage.${id}`, type: source.type ?? 'base', style: 0, timestamp: now, _stats: { createdTime: now },
      author: game.users.get(source.author), _source: { author: source.author },
      speaker: source.speaker ?? {}, speakerActor: game.actors.get(source.speaker?.actor) ?? null,
      alias: source.speaker?.alias ?? '', whisper: source.whisper, blind: source.blind, title: source.title ?? '',
      flavor: source.flavor ?? '', content: source.content ?? '', rolls: source.rolls ?? [],
      flags: source.flags ?? {}, system: source.system ?? null,
    })
    // As Foundry's: the creating client's own hook first, which may change what's made, through
    // updateSource, or stop it; only where the harness's hooks can be called so.
    if ((typeof Hooks.call === 'function') && (Hooks.call('preCreateChatMessage', message, source, options, game.user.id) === false)) return undefined
    messages.set(id, message)
    // As Foundry's: with the options it was created with, and who created it, this client's user.
    Hooks.callAll('createChatMessage', message, options, game.user.id)
    return message
  }
}
ChatMessage.implementation = ChatMessage
globalThis.ChatMessage = ChatMessage
globalThis.getDocumentClass = name => (name === 'ChatMessage' ? ChatMessage : undefined)
