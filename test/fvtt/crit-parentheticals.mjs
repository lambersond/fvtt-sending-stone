// Foundry's parenthetical terms, as far as dnd5e's damage rolls and module 0.33.0 use them, for
// crit-rules.mjs alone (dice-core.mjs's parser makes none): `(1d6 + 2)` in a formula, not after a
// letter (a function's), one level deep, with its flavor after it, made a ParentheticalTerm whose
// `term` is what's inside; deterministic only where what's inside is; copied as dnd5e 6 copies a
// complex term for a critical hit (RollTerm.fromData of its toJSON); made of terms
// (`ParentheticalTerm.fromTerms`, as dnd5e 6 wraps a term bound by *, / or %, through
// `Roll.fromTerms`, which keeps the very terms, as Foundry's does); and evaluated, synchronously
// at its highest too, as dnd5e 6's Powerful Critical works out the most a term could roll.
// Install after dice-core.mjs and before dnd5e's dice, which take the class as they load.

/** Put Foundry's parentheticals in place of dice-core.mjs's. */
export function installParentheticals() {
  const terms = foundry.dice.terms
  const Base = terms.ParentheticalTerm
  const Roll = foundry.dice.Roll

  class ParentheticalTerm extends Base {
    constructor({ term, roll, options } = {}) {
      super({ term: roll ? roll.formula : term, options })
      /** The roll of what's inside, once made: Foundry's `roll`. */
      this.roll = roll ?? null
    }
    get isDeterministic() { return new Roll(this.term).isDeterministic }
    get dice() { return this.roll?.dice ?? [] }
    get total() { return this.roll?.total }
    async evaluate(options = {}) {
      this.roll ??= new Roll(this.term)
      if (!this.roll._evaluated) await this.roll.evaluate(options)
      this._evaluated = true
      return this
    }
    evaluateSync(options = {}) {
      this.roll ??= new Roll(this.term)
      if (!this.roll._evaluated) this.roll.evaluateSync(options)
      this._evaluated = true
      return this
    }
    static fromTerms(inner, options) {
      return new this({ roll: Roll.fromTerms(inner), options })
    }
  }
  terms.ParentheticalTerm = ParentheticalTerm

  // As Foundry's: a roll of the very terms given, its formula theirs.
  Roll.fromTerms ??= function (inner, options = {}) {
    const roll = new this('', {}, options)
    roll.terms = inner
    roll.resetFormula()
    return roll
  }

  // Each top-level group in parentheses read as one term: set aside while the rest is parsed, then
  // put back where its placeholder is read.
  const parse = Roll.parse
  const parseTerm = Roll.parseTerm
  let groups = null
  Roll.parse = function (formula, data) {
    const text = this.replaceFormulaData(String(formula), data, { missing: '0' })
    const outer = groups
    groups = []
    try {
      const marked = text.replace(/(?<![A-Za-z\d])\(([^()]*)\)(?:\[([^\]]+)\])?/g, (match, inner, flavor) => {
        groups.push({ inner: inner.trim(), flavor })
        return `§${groups.length - 1}`
      })
      return parse.call(this, marked, data)
    } finally {
      groups = outer
    }
  }
  Roll.parseTerm = function (piece) {
    const group = /^§(\d+)$/.exec(piece.trim())
    if (group && groups?.[group[1]]) {
      const { inner, flavor } = groups[group[1]]
      return new ParentheticalTerm({ term: inner, options: flavor ? { flavor } : {} })
    }
    return parseTerm.call(this, piece)
  }

  // As Foundry's: a group evaluated synchronously, at its highest or lowest, with its roll.
  const evaluateSync = Roll.prototype.evaluateSync
  Roll.prototype.evaluateSync = function (options = {}) {
    for (const term of this.terms) {
      if ((term instanceof ParentheticalTerm) && !term._evaluated) term.evaluateSync(options)
    }
    return evaluateSync.call(this, options)
  }
  return ParentheticalTerm
}
