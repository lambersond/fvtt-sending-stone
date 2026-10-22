// Midi-QOL's rules for a critical hit's damage, as texts.mjs ports them from its configureDamage
// (patching.ts:1306-1505), shared by typed.mjs and crit-rules.mjs (module 0.32.0): installed in
// place of dnd5e's own on the DamageRoll prototype, as Midi's MIXED wrapper sits there, each rule the
// Gamemaster's or the players' by `game.user.isGM` (utils.ts:8643-8645). Install it once the
// module's scripts are loaded, as Midi wraps dnd5e at its init, after they are, and before the
// module sets up its dice plans at `ready`, so the module's WRAPPER sits outside it.

/** Which rule each of the Gamemaster's and players' clients uses. */
export const midiCritical = { gm: 'default', player: 'default' }

/**
 * Put Midi's configureDamage in place of dnd5e's.
 * @param {typeof Roll} DamageRoll   dnd5e's.
 */
export function installMidiCritical(DamageRoll) {
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
