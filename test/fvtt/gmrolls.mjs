// A Gamemaster's rolls on Midi-QOL's cards (module 0.30.0, its contract §1a M8, §3.7 F6): with
// Gamemaster-only information off, trimmed as Midi's GM Attack Roll Display and GM Damage Roll
// Display show them to players, and never more than those settings' own words promise. MIDI=1
// with Midi's settings; X=1 without Midi, where nothing is trimmed. The world is results-world.mjs.
// Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
//
// Module 0.31.0 (its contract §4.7.2): with GM-only details off, every card told here is told again
// under "Hit/miss and save results in the app: Always show them to players", whose rolls, content and
// text must be Follow's: the Gamemaster's Midi trim follows Midi.
import assert from 'node:assert/strict'
import {
  d20, damage, descriptor, goblin, midiSettings, midiState, MIDI, ok, orc, settings, speakerOf, start, thorin, tok,
  withMidi, withSettings
} from './results-world.mjs'

const { told: tell } = await start()
let alike = 0
const told = message => {
  const sent = tell(message)
  if (settings.get('gmContent') !== true) {
    settings.set('chatResults', 'always')
    try {
      const always = tell(message)
      assert.deepEqual([always.rolls, always.content, always.text], [sent.rolls, sent.content, sent.text], 'Always: the trim as Follow')
    } finally { settings.delete('chatResults') }
    alike++
  }
  return sent
}
const alikeOk = () => ok(`with "Hit/miss and save results in the app: Always show them to players", each card's rolls, content and text are Follow's (${alike} told): the Gamemaster's rolls trimmed as Midi has them`)
settings.set('attackRollVisibility', 'hideAC')
settings.set('challengeVisibility', 'player')
settings.set('gmContent', false)
const ATTACK = ['full', 'hideFormula', 'd20Only', 'attackTotal', 'hitMiss', 'hitMissCrit', 'hidden']
const DAMAGE = ['full', 'totalOnly', 'hidden']

/** A Midi card, as Workflow.ts writes it after it has checked hits: by the Gamemaster's goblin, at the Orc. */
async function card({ author = 'gm', by = goblin, rolls, flags = {}, content = '' } = {}) {
  return ChatMessage.create({
    author, speaker: speakerOf(by), rolls, content,
    flags: {
      'midi-qol': { messageType: 'attack', GMOnlyAttackRoll: false, hitTargetUuids: [tok.orc], targets: [{ uuid: tok.orc }], isHit: true, ...flags },
      dnd5e: { targets: [descriptor(orc, 15)] },
    },
  })
}
/** An attack with advantage, a natural 20 among its d20s; and its damage. */
const attack = (faces = [20, 7], options = {}) => d20(faces, { midi: true, target: 15, advantage: true, ...options })
const rollsOf = message => told(message).rolls
const attackOf = message => rollsOf(message).find(roll => roll.attack)

if (!MIDI) {
  const message = await card({ rolls: [await attack(), await damage('1d8 + 3', 'piercing', { thrown: [5] })] })
  const sent = rollsOf(message)
  assert.equal(sent[0].formula, message.rolls[0].formula)
  assert.match(sent[0].formula, /^1d20adv \+ 5$/)
  assert.ok(sent[0].dice.length && Number.isFinite(sent[0].total))
  assert.equal(sent[1].formula, '1d8 + 3')
  ok('without Midi-QOL, a Gamemaster\'s card of Midi\'s goes as it is: nothing is trimmed')
  alikeOk()
  console.log('dnd5e: done')
  process.exit(0)
}

// ---- Each GM Attack Roll Display value ----
// Marked: Auto Check Hits none or all, Show only results, and Color code on: Midi marks the total's
// critical. Unmarked: Color code off.
const expected = {
  full: { formula: 'rolled', dice: 'rolled', total: 25 },
  hideFormula: { formula: '', dice: [], total: 25 },
  d20Only: { formula: '', dice: [{ expression: 'd20', faces: 20, number: 1, results: [{ result: 20, active: true }] }], total: null },
  attackTotal: { formula: '', dice: [], total: 25 },
  hitMiss: { formula: '', dice: [], total: null },
  hitMissCrit: { formula: '', dice: [], total: null },
  hidden: { formula: '', dice: [], total: null },
}
for (const display of ATTACK) {
  for (const marked of [true, false]) {
    await withMidi({ gmAttackDisplay: display, autoCheckHit: 'none', highlightSuccess: marked }, async () => {
      const message = await card({ rolls: [await attack()] })
      const roll = attackOf(message)
      const want = expected[display]
      assert.equal(roll.formula, (want.formula === 'rolled') ? message.rolls[0].formula : want.formula, `${display} formula`)
      if (want.dice === 'rolled') assert.deepEqual(roll.dice[0].results.map(r => r.result), [20, 7], display)
      else assert.deepEqual(roll.dice, want.dice, `${display} dice`)
      assert.equal(roll.total, want.total, `${display} total`)
      const critical = (display === 'full') ? true
        : ['hitMiss', 'hidden'].includes(display) ? false
          : (display === 'hitMissCrit') ? marked : marked
      assert.equal(roll.critical, critical, `${display} ${marked ? 'marked' : 'unmarked'} critical`)
      assert.equal(roll.fumble, false, `${display} fumble`)
      assert.equal(roll.advantage, true, `${display}: the label says advantage`)
    })
  }
}
await withMidi({ gmAttackDisplay: 'hitMissCrit', autoCheckHit: 'none', highlightSuccess: false }, async () => {
  const forced = await card({ rolls: [await attack([12, 7])], flags: { isCritical: true } })
  assert.equal(attackOf(forced).critical, true, 'a critical Midi forced, no 20 rolled: "critically hits"')
  const fumbled = await card({ rolls: [await attack([12, 7])], flags: { isFumble: true, isHit: true } })
  assert.equal(attackOf(fumbled).fumble, true, '"badly misses"')
  assert.equal(attackOf(fumbled).critical, false)
})
ok("each GM Attack Roll Display value trims the Gamemaster's attack as the F6 table has it: formula, dice and total; critical and fumble only where Midi marks them, Hit/Miss/Critical/Fumble's from the card's words; advantage kept, as its label says it")

// ---- D20 Only: the one number, never the dice behind it ----
for (const [faces, options, why] of [[[20, 7], {}, '2d20kh'], [[3, 20, 9], { elvenAccuracy: true }, "elven accuracy's 3d20kh"]]) {
  await withMidi({ gmAttackDisplay: 'd20Only' }, async () => {
    const message = await card({ rolls: [await attack(faces, options)] })
    const roll = attackOf(message)
    assert.deepEqual(roll.dice, [{ expression: 'd20', faces: 20, number: 1, results: [{ result: 20, active: true }] }], why)
    const json = JSON.stringify(told(message).rolls.map(({ formula, dice }) => ({ formula, dice })))
    assert.ok(!/adv|[23]d20/.test(json), `${why}: no expression of several d20s`)
    assert.ok(!/"number":[2-9]/.test(json), `${why}: no number above 1`)
    assert.ok(!json.includes('"active":false'), `${why}: no inactive result`)
  })
}
ok('under D20 Only, the attack has exactly one d20 holding the one number Midi shows, with advantage and with elven accuracy: no expression, count or other result of the dice rolled')

// ---- Midi's fake dice ----
await withMidi({ addFakeDice: true }, async () => {
  for (const display of ATTACK) {
    await withMidi({ gmAttackDisplay: display }, async () => {
      const roll = attackOf(await card({ rolls: [await attack()] }))
      const kept = display === 'full'
      assert.equal(roll.advantage, kept, `${display} advantage`)
      assert.equal(roll.disadvantage, false, `${display} disadvantage`)
    })
  }
  const disadvantaged = attackOf(await card({ rolls: [await d20([20, 7], { midi: true, target: 15, disadvantage: true })] }))
  assert.equal(disadvantaged.disadvantage, true, 'Full Roll: kept')
})
ok("with Midi's fake dice, whose label always reads Attack, advantage and disadvantage are false under every display but Full Roll")

// ---- The hits section's ✓✓ ----
await withMidi({ autoCheckHit: 'all', highlightSuccess: false }, async () => {
  for (const display of ATTACK.filter(value => value !== 'full')) {
    await withMidi({ gmAttackDisplay: display }, async () => {
      const roll = attackOf(await card({ rolls: [await attack([12, 7])], flags: { isCritical: true } }))
      assert.equal(roll.critical, !['hitMiss', 'hidden'].includes(display), display)
    })
  }
})
ok("a critical card's hits section shows its ✓✓, so under Hide Formula, D20 Only and Attack Total Only the attack is a critical, unmarked; under Hit/Miss Only and Hidden it isn't")

// ---- Unreadable settings ----
midiState.throws = true
{
  const message = await card({ rolls: [await attack(), await damage('1d8 + 3', 'piercing', { thrown: [5] })] })
  const [roll, hurt] = rollsOf(message)
  assert.deepEqual([roll.formula, roll.dice, roll.total, roll.critical], ['', [], null, false])
  assert.deepEqual([hurt.formula, hurt.dice, hurt.total], ['', [], null])
}
midiState.throws = false
ok("with Midi's settings unreadable, a Gamemaster's card is trimmed as both displays Hidden")

// ---- Damage ----
/** Two damage rolls of different types in one section, the second below zero, and a bonus. */
const damageRolls = async ({ critical = false } = {}) => [
  await damage('1d6 + 2', 'fire', { thrown: [4], critical }),
  await damage('1d4 - 6', 'cold', { thrown: [1], critical }),
  await damage('2d6', 'piercing', { section: 'bonusDamage', thrown: [3, 5], flavor: 'Sneak Attack', critical }),
]
for (const display of DAMAGE) {
  for (const merge of [false, true]) {
    await withMidi({ gmDamageDisplay: display, mergeCardMultiDamage: merge }, async () => {
      const message = await card({ rolls: [await attack(), ...(await damageRolls())] })
      const hurts = rollsOf(message).filter(roll => roll.damage)
      if (display === 'full') {
        assert.deepEqual(hurts.map(roll => roll.total), [6, -5, 8], 'Full Roll')
        assert.ok(hurts.every(roll => roll.formula && roll.dice.length))
        return
      }
      assert.ok(hurts.every(roll => (roll.formula === '') && (roll.dice.length === 0)), `${display}: no formula or dice`)
      if (merge) {
        assert.deepEqual(hurts.map(roll => roll.total), (display === 'hidden') ? [null, null, null] : [6, 0, 8], `${display}, each apart`)
        assert.deepEqual(hurts.map(roll => roll.damageType), ['fire', 'cold', 'piercing'])
      } else {
        assert.equal(hurts.length, 2, `${display}: one per section`)
        const [own, bonus] = hurts
        assert.equal(own.total, (display === 'hidden') ? null : 6, `${display}: the section's sum, a part below zero none`)
        assert.ok(!('damageType' in own) && !('damageLabel' in own), 'two types: none')
        assert.equal(own.section, 'damage')
        assert.equal(own.class, 'DamageRoll')
        assert.equal(bonus.total, (display === 'hidden') ? null : 8)
        assert.equal(bonus.damageType, 'piercing', 'one type: kept')
        assert.equal(bonus.flavor, 'Sneak Attack')
      }
    })
  }
}
ok("each GM Damage Roll Display value trims the Gamemaster's damage: Damage Total Only folds each section into one total, a part below zero counted as none, of a type only where all are one, or with each roll shown apart totals each alone, a negative one 0; Hidden leaves no total")

// ---- Damage's critical follows the attack's ----
await withMidi({ gmAttackDisplay: 'hidden', gmDamageDisplay: 'full' }, async () => {
  const hurts = rollsOf(await card({ rolls: [await attack(), ...(await damageRolls({ critical: true }))] })).filter(roll => roll.damage)
  assert.ok(hurts.every(roll => roll.critical === false), 'the attack trimmed of its critical: so is its damage')
})
await withMidi({ gmAttackDisplay: 'attackTotal', gmDamageDisplay: 'totalOnly', autoCheckHit: 'none' }, async () => {
  const hurts = rollsOf(await card({ rolls: [await attack(), ...(await damageRolls({ critical: true }))] })).filter(roll => roll.damage)
  assert.ok(hurts.every(roll => roll.critical === true), 'the attack keeps its critical: so does its damage')
})
ok("a damage roll on a trimmed card is a critical only where its trimmed attack is")

// ---- Content and text ----
const content = `<div class="midi-qol-attack-roll"><div class="dice-roll"><div class="dice-formula">2d20kh + 5</div><h4 class="dice-total">25</h4></div><span class="midi-attribution-info">Advantage: Flanking</span></div>
<div class="midi-qol-attack-buttons"><button>Attack</button></div>
<div class="midi-qol-damage-roll"><div class="dice-roll"><div class="dice-formula">1d6 + 2</div><h4 class="dice-total">6</h4></div></div>
<div class="midi-qol-other-damage-roll"><div class="dice-roll"><div class="dice-formula">3d4</div></div></div>
<div class="midi-qol-bonus-damage-roll"><div class="dice-roll"><div class="dice-formula">2d6</div></div></div>
<div class="midi-qol-damage-buttons"><button>Critical</button></div><button class="midi-qol-otherDamage-button">Other</button>
<div class="card-footer">Longsword</div>`
const body = html => new DOMParser().parseFromString(html, 'text/html').body
for (const [attackDisplay, damageDisplay] of [['hideFormula', 'full'], ['full', 'totalOnly'], ['hidden', 'hidden']]) {
  await withMidi({ gmAttackDisplay: attackDisplay, gmDamageDisplay: damageDisplay }, async () => {
    const sent = told(await card({ rolls: [await attack()], content }))
    const doc = body(sent.content)
    assert.equal(doc.querySelectorAll('.midi-qol-attack-roll .dice-roll').length, (attackDisplay === 'full') ? 1 : 0)
    assert.equal(doc.querySelectorAll('.midi-attribution-info').length, (attackDisplay === 'full') ? 1 : 0)
    const damageRolls = doc.querySelectorAll('.midi-qol-damage-roll .dice-roll, .midi-qol-other-damage-roll .dice-roll, .midi-qol-bonus-damage-roll .dice-roll')
    assert.equal(damageRolls.length, (damageDisplay === 'full') ? 3 : 0)
    assert.equal(doc.querySelectorAll('.midi-qol-attack-buttons, .midi-qol-damage-buttons, .midi-qol-otherDamage-button').length, 0, 'buttons, always')
    assert.ok(sent.content.includes('Longsword'))
    if (attackDisplay !== 'full') assert.ok(!sent.text.includes('25') && !sent.text.includes('2d20kh'), sent.text)
    if (damageDisplay !== 'full') assert.ok(!sent.text.includes('1d6 + 2') && !sent.text.includes('3d4'), sent.text)
    assert.ok(!sent.text.includes('Critical'))
  })
}
ok("a trimmed card's content goes without the trimmed sections' dice rolls, Midi's attribution and its attack and damage buttons, and its text without their totals and formulas")

// ---- Untouched ----
const fullOf = async message => withSettings({ gmContent: true }, () => told(message).rolls)
for (const display of ATTACK) {
  await withMidi({ gmAttackDisplay: display, gmDamageDisplay: 'hidden' }, async () => {
    const player = await card({ author: 'alice', by: thorin, rolls: [await attack(), ...(await damageRolls())] })
    assert.deepEqual(rollsOf(player), await fullOf(player), `a player's card under ${display}`)
  })
}
await withMidi({ gmAttackDisplay: 'hidden', gmDamageDisplay: 'hidden' }, async () => {
  const dnd5eAttack = await ChatMessage.create({
    author: 'gm', speaker: speakerOf(goblin), rolls: [await d20([20, 7], { attack: true, advantage: true })],
    flags: { dnd5e: { roll: { type: 'attack' }, targets: [descriptor(orc, 15)] } },
  })
  assert.deepEqual(rollsOf(dnd5eAttack), await fullOf(dnd5eAttack), "a Gamemaster's dnd5e attack, not Midi's card")
  const gmCard = await card({ rolls: [await attack(), ...(await damageRolls())] })
  const raw = await fullOf(gmCard)
  assert.equal(raw[0].formula, gmCard.rolls[0].formula, 'Gamemaster-only information on: as rolled')
  assert.ok(raw.every(roll => Number.isFinite(roll.total)))
})
await withMidi({ gmAttackDisplay: 'full', gmDamageDisplay: 'full' }, async () => {
  const gmCard = await card({ rolls: [await attack(), ...(await damageRolls())] })
  assert.deepEqual(rollsOf(gmCard), await fullOf(gmCard), 'both displays Full Roll')
})
ok("nothing is trimmed on a player's card under any display, on a Gamemaster's dnd5e attack, with Gamemaster-only information on, or with both displays Full Roll")

// ---- What the app reads of a roll ----
await withMidi({ gmAttackDisplay: 'd20Only', gmDamageDisplay: 'hidden' }, async () => {
  for (const roll of rollsOf(await card({ rolls: [await attack(), ...(await damageRolls())] }))) {
    assert.equal(typeof roll.formula, 'string')
    assert.ok((roll.total === null) || Number.isFinite(roll.total))
    assert.ok(Array.isArray(roll.dice))
    for (const die of roll.dice) {
      assert.ok(Number.isFinite(die.faces))
      assert.ok(die.results.every(({ result, active }) => Number.isFinite(result) && (typeof active === 'boolean')))
    }
    assert.ok((typeof roll.class === 'string') && (roll.class.length <= 100))
    if ('flavor' in roll) assert.ok(roll.flavor.trim().length && (roll.flavor.length <= 100))
  }
})
ok("a trimmed roll keeps every key the app's rollSchema reads, of its type: a string formula, a number or null total, dice of faces and results")

alikeOk()
console.log('midi: done')
process.exit(0)
