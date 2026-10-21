// The verdict can't drift from the gates (module 0.30.0, its contract §3.6, §3.9): for every
// combination of the settings that decide what players see, each line of the verdict, what Manage
// Campaigns and the app show the Gamemaster, says exactly what the chat gates tell of a message of
// its kind. Shown: told to all; partial: told for the matching author, target or one-target case
// alone; hidden: not told, with no outcome, save, check or readers at all. X=1 without Midi-QOL;
// MIDI=1 with every Auto Check Hits, Auto Check Saves, Color code and Only highlight critical, and
// apart from them every GM Attack Roll Display and GM Damage Roll Display. The world is
// results-world.mjs. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
//
// Module 0.31.0 (its contract §4.7.4): each combination under "Hit/miss and save results in the app"
// Follow and Always; under Always with GM-only details off, every line but the Gamemaster's rolls,
// and Midi's saves where Midi checks none, says shown for Always, and the gates tell all; option B
// makes Midi's hits at two targets told with GM-only details on too, where Midi checks none.
import assert from 'node:assert/strict'
import {
  d20, damage, descriptor, goblin, MIDI, midiSettings, ok, orc, settings, speakerOf, start, thorin, tok, vex, withMidi,
  withSettings
} from './results-world.mjs'

const { told } = await start()
const { resultsVerdict } = await import(`${process.env.MODULE_DIR}/scripts/results.mjs`)

// ---- The messages, made once; told again under each combination ----
const attackAt = async targets => ChatMessage.create({
  author: 'gm', speaker: speakerOf(goblin),
  rolls: [await d20(15, { attack: true, target: (targets.length === 1) ? targets[0].ac : undefined })],
  flags: { dnd5e: { roll: { type: 'attack' }, targets } },
})
const atPc = await attackAt([descriptor(vex, 12)])
const atTwo = await attackAt([descriptor(vex, 12), descriptor(thorin, 14)])
const midiCard = async ({ author, by, targets, rolls = [], flags }) => ChatMessage.create({
  author, speaker: by ? speakerOf(by) : { actor: null, alias: 'Trap' }, rolls, content: '',
  flags: { 'midi-qol': { messageType: 'attack', ...flags }, dnd5e: { targets } },
})
const checked = { GMOnlyAttackRoll: false, isHit: true }
const h1 = await midiCard({
  author: 'alice', by: thorin, targets: [descriptor(goblin), descriptor(orc)], rolls: [await d20(14, { midi: true })],
  flags: { ...checked, hitTargetUuids: [tok.goblin], targets: [{ uuid: tok.goblin }, { uuid: tok.orc }] },
})
const oneTarget = (author, by, at, token) => d20(14, { midi: true, target: 15 }).then(roll => midiCard({
  author, by, targets: [descriptor(at)], rolls: [roll], flags: { ...checked, hitTargetUuids: [token], targets: [{ uuid: token }] },
}))
const h2p = await oneTarget('alice', thorin, orc, tok.orc)
const h2g = await oneTarget('gm', goblin, vex, tok.vex)
const saveCard = (author, by) => ChatMessage.create({ author, speaker: speakerOf(by), content: '<button data-action="rollSave" data-ability="dex" data-dc="13">DEX</button>', flags: { dnd5e: { messageType: 'usage' } } })
const rollFrom = async (card, type = 'save', roll = { ability: 'dex' }) => ChatMessage.create({
  author: 'alice', speaker: speakerOf(thorin), rolls: [await d20(14, { formula: '1d20 + 2', target: 13 })],
  flags: { dnd5e: { roll: { type, ...roll }, originatingMessage: card.id } },
})
const sGm = await rollFrom(await saveCard('gm', goblin))
const sPl = await rollFrom(await saveCard('bob', vex))
const request = await ChatMessage.create({ author: 'bob', speaker: { actor: null, alias: 'Request' }, content: '<button data-action="rollRequest" data-type="skill" data-skill="prc" data-ability="wis" data-dc="12">Perception</button>' })
const cPl = await rollFrom(request, 'skill', { skillId: 'prc', ability: 'wis' })
const mSaves = await midiCard({
  author: 'gm', by: goblin, targets: [descriptor(vex, 15, true), descriptor(orc, 15, false)],
  flags: { messageType: 'saves', saveUuids: [tok.vex], failedSaveUuids: [tok.orc] },
})
const m13g = await rollFrom(await midiCard({ author: 'gm', by: goblin, targets: [descriptor(thorin)], flags: { messageType: 'saves' } }))
const m13p = await rollFrom(await midiCard({ author: 'bob', by: vex, targets: [descriptor(thorin)], flags: { messageType: 'saves' } }))
const gmCard = await midiCard({
  author: 'gm', by: goblin, targets: [descriptor(vex)],
  rolls: [await d20(20, { midi: true, target: 15 }), await damage('1d6 + 2', 'fire', { thrown: [4] }), await damage('2d6', 'cold', { section: 'otherDamage', thrown: [2, 3] })],
  flags: { ...checked, hitTargetUuids: [tok.vex], targets: [{ uuid: tok.vex }], isCritical: true },
})

// ---- What each is told ----
const outcomes = message => told(message).dnd5e.targets.map(target => target.outcome ?? null)
const saves = message => told(message).dnd5e.targets.map(target => target.save ?? null)
const result = (message, field) => told(message).dnd5e[field] ?? null
const nothingOf = (message, field) => {
  const sent = told(message).dnd5e
  if (field === 'targets') return sent.targets.every(target => !('outcome' in target) && !('save' in target))
  return !sent[field] || (!('outcome' in sent[field]) && !('readers' in sent[field]))
}
const thorinSaved = { target: 'Actor.thorin', outcome: 'success' }
/** A save or check of Thorin's, as a line in its state tells it, from a Gamemaster's card or Bob's. */
function assertRoll(state, message, field, byGM, where) {
  const sent = result(message, field)
  if (state === 'shown') assert.deepEqual(sent, thorinSaved, where)
  else if (state.startsWith('partial') && byGM) assert.ok(nothingOf(message, field), where)
  else if (state === 'partial-players') assert.deepEqual(sent, thorinSaved, where)
  else if (state === 'partial-own') assert.deepEqual(sent, { ...thorinSaved, readers: ['vex'] }, where)
  else assert.ok(nothingOf(message, field), where)
}
const rollState = line => (line.state !== 'partial') ? line.state
  : line.text.includes(game.i18n.localize('SENDINGSTONE.Results.Where.PlayersOnly')) ? 'partial-players' : 'partial-own'

let combinations = 0
/** Every line of the verdict, against every message, as set now. */
function check(where) {
  combinations++
  const verdict = resultsVerdict()
  const lines = Object.fromEntries(verdict.map(line => [line.id, line]))
  assert.ok(verdict.length <= 6, where)
  assert.equal('gmRolls' in lines, MIDI, `${where}: gmRolls with Midi alone`)
  const gm = settings.get('gmContent') === true
  if (gm) assert.ok(verdict.every(line => (line.state === 'shown') && line.text.endsWith('(GM-only details: On)')), where)
  const always = !gm && (settings.get('chatResults') === 'always')
  if (always) {
    for (const line of verdict) {
      if (line.id === 'gmRolls') continue
      if ((line.id === 'midiSaves') && (midiSettings.autoCheckSaves === 'none')) {
        assert.deepEqual([line.state, line.text], ['hidden', "Saves on Midi-QOL's cards: hidden (Auto check Saves: Off)"], `${where}: Midi checks no saves`)
        continue
      }
      assert.equal(line.state, 'shown', `${where}: ${line.text}`)
      assert.ok(line.text.endsWith('(Hit/miss and save results in the app: Always show them to players)'), `${where}: ${line.text}`)
    }
  }
  const told = gm || always

  // dnd5e's own attacks.
  const hits = lines.hits.state
  if (told || (hits === 'shown')) {
    assert.deepEqual(outcomes(atPc), ['hit'], `${where} hits`)
    assert.deepEqual(outcomes(atTwo), ['hit', 'hit'], `${where} hits two`)
  } else if (hits === 'partial') {
    assert.ok(MIDI, where)
    assert.deepEqual(outcomes(atPc), ['hit'], `${where} hits one`)
    assert.ok(nothingOf(atTwo, 'targets'), `${where} hits two`)
  } else {
    assert.ok(nothingOf(atPc, 'targets') && nothingOf(atTwo, 'targets'), `${where} hits hidden`)
  }

  // Midi's cards.
  if (MIDI) {
    const line = lines.midiHits
    const display = midiSettings.gmAttackDisplay
    const decided = midiSettings.autoCheckHit !== 'none'
    if (told) {
      if (decided) assert.deepEqual(outcomes(h1), ['hit', 'miss'], `${where} midiHits H1`)
      // Module 0.31.0 option B (flipped from "Midi checked nothing of two"): by each armor class on its card.
      else assert.deepEqual(outcomes(h1), ['hit', 'hit'], `${where} midiHits: Midi checked nothing of two, judged by their armor class`)
      assert.deepEqual([outcomes(h2p), outcomes(h2g)], [['hit'], ['hit']], `${where} midiHits one`)
    } else if (line.state === 'shown') {
      assert.deepEqual([outcomes(h1), outcomes(h2p), outcomes(h2g)], [['hit', 'miss'], ['hit'], ['hit']], `${where} midiHits shown`)
    } else if (line.text.includes(game.i18n.localize('SENDINGSTONE.Results.Where.GmOneTarget'))) {
      assert.ok(nothingOf(h1, 'targets') && nothingOf(h2p, 'targets'), `${where} midiHits H3: no player's`)
      assert.deepEqual(outcomes(h2g), ['hit'], `${where} midiHits H3`)
    } else if (line.state === 'partial') {
      assert.ok(nothingOf(h1, 'targets'), `${where} midiHits H2: not at two`)
      assert.deepEqual(outcomes(h2p), ['hit'], `${where} midiHits H2`)
      // The Gamemaster's card under Hidden has no highlight; under Hit/Miss its words say the same.
      if (display === 'hidden') assert.ok(nothingOf(h2g, 'targets'), `${where} H2, Hidden`)
      else assert.deepEqual(outcomes(h2g), ['hit'], `${where} midiHits H2, the Gamemaster's`)
    } else {
      assert.ok([h1, h2p, h2g].every(message => nothingOf(message, 'targets')), `${where} midiHits hidden`)
    }

    const savesLine = lines.midiSaves
    if (told) {
      if (midiSettings.autoCheckSaves === 'none') assert.ok(nothingOf(mSaves, 'targets'), `${where} midiSaves: none checked`)
      else assert.deepEqual(saves(mSaves), ['success', 'failure'], `${where} midiSaves`)
    } else if (savesLine.state === 'shown') assert.deepEqual(saves(mSaves), ['success', 'failure'], `${where} midiSaves shown`)
    else if (savesLine.state === 'partial') assert.deepEqual(saves(mSaves), ['success', null], `${where} midiSaves PC`)
    else assert.ok(nothingOf(mSaves, 'targets'), `${where} midiSaves hidden`)
  }

  // Saves and checks, from the Gamemaster's cards and a player's, and Midi's per-target saves.
  const savesState = told ? 'shown' : rollState(lines.saves)
  assertRoll(savesState, sGm, 'save', true, `${where} save, GM's card`)
  assertRoll(savesState, sPl, 'save', false, `${where} save, Bob's card`)
  assertRoll(savesState, m13g, 'save', true, `${where} save, GM's Midi card`)
  assertRoll(savesState, m13p, 'save', false, `${where} save, Bob's Midi card`)
  assertRoll(told ? 'shown' : rollState(lines.checks), cPl, 'check', false, `${where} check, Bob's request`)
}

const ARV = ['all', 'hideAC', 'none', undefined]
const CV = ['all', 'player', 'none']
settings.set('chatEvents', true)
for (const [gm, results] of [[false, 'foundry'], [false, 'always'], [true, 'foundry'], [true, 'always']]) {
  for (const arv of ARV) {
    for (const cv of CV) {
      await withSettings({ gmContent: gm, chatResults: results, attackRollVisibility: arv, challengeVisibility: cv }, async () => {
        if (!MIDI) return check(`gm ${gm} results ${results} arv ${arv} cv ${cv}`)
        for (const autoCheckHit of ['none', 'all', 'whisper', 'gmOnly']) {
          for (const autoCheckSaves of ['none', 'allNoRoll', 'all', 'allShow', 'whisper', 'gmOnly']) {
            for (const highlightSuccess of [true, false]) {
              for (const highLightCriticalAttackOnly of [false, true]) {
                await withMidi({ autoCheckHit, autoCheckSaves, highlightSuccess, highLightCriticalAttackOnly }, () => {
                  check(`gm ${gm} results ${results} arv ${arv} cv ${cv} hits ${autoCheckHit} saves ${autoCheckSaves} color ${highlightSuccess} crit ${highLightCriticalAttackOnly}`)
                })
              }
            }
          }
        }
      })
    }
  }
}
ok(`in every one of ${combinations} combinations, Hit/miss and save results Follow and Always among them, each line of the verdict says what the gates tell of dnd5e's attacks${MIDI ? ', Midi-QOL\'s hits and saves,' : ''} and saves and checks from the Gamemaster's cards and players': shown to all, partly where it says, or not at all`)

// ---- A Gamemaster's rolls on Midi's card, under each GM display ----
if (MIDI) {
  const untrimmed = await withSettings({ gmContent: true }, () => told(gmCard).rolls)
  const TOTAL = { full: true, hideFormula: true, d20Only: false, attackTotal: true, hitMiss: false, hitMissCrit: false, hidden: false }
  let displays = 0
  for (const gm of [false, true]) {
    for (const arv of ['hideAC', 'none']) {
      for (const autoCheckHit of ['none', 'all', 'whisper']) {
        for (const highlightSuccess of [true, false]) {
          for (const gmAttackDisplay of Object.keys(TOTAL)) {
            for (const gmDamageDisplay of ['full', 'totalOnly', 'hidden']) {
              await withSettings({ gmContent: gm, attackRollVisibility: arv, challengeVisibility: 'player' }, () => withMidi({
                autoCheckHit, highlightSuccess, gmAttackDisplay, gmDamageDisplay, autoCheckSaves: 'all',
              }, () => {
                const where = `gm ${gm} arv ${arv} hits ${autoCheckHit} color ${highlightSuccess} attack ${gmAttackDisplay} damage ${gmDamageDisplay}`
                check(where)
                displays++
                const line = resultsVerdict().find(({ id }) => id === 'gmRolls')
                const rolls = told(gmCard).rolls
                // Module 0.31.0: Always trims the Gamemaster's rolls as Follow does, and says so alike.
                settings.set('chatResults', 'always')
                try {
                  assert.deepEqual(told(gmCard).rolls, rolls, `${where} Always: the rolls as Follow`)
                  if (!gm) assert.deepEqual(resultsVerdict().find(({ id }) => id === 'gmRolls'), line, `${where} Always: the line as Follow`)
                } finally { settings.delete('chatResults') }
                if (gm || (line.state === 'shown')) {
                  assert.deepEqual(rolls, untrimmed, `${where} untouched`)
                  return
                }
                const [attack, ...hurts] = rolls
                if (line.state === 'hidden') {
                  assert.ok(rolls.every(roll => (roll.formula === '') && !roll.dice.length && (roll.total === null)), `${where} hidden`)
                  return
                }
                assert.equal(attack.formula === '', gmAttackDisplay !== 'full', `${where} attack formula`)
                assert.equal(Number.isFinite(attack.total), TOTAL[gmAttackDisplay], `${where} attack total`)
                assert.equal(attack.dice.length, ['full', 'd20Only'].includes(gmAttackDisplay) ? 1 : 0, `${where} attack dice`)
                assert.ok(hurts.every(roll => (roll.formula === '') === (gmDamageDisplay !== 'full')), `${where} damage formula`)
                assert.ok(hurts.every(roll => Number.isFinite(roll.total) === (gmDamageDisplay !== 'hidden')), `${where} damage total`)
              }))
            }
          }
        }
      }
    }
  }
  ok(`under every one of ${displays} combinations of GM Attack Roll Display and GM Damage Roll Display, with the settings their marks and hits follow, the verdict's line of the Gamemaster's rolls says what's trimmed: untouched where shown, every attack and damage roll without its total, formula and dice where hidden, and as the F6 table where partly`)
}

// ---- Its words ----
await withSettings({ gmContent: false, attackRollVisibility: 'hideAC', challengeVisibility: 'player' }, () => withMidi({ autoCheckHit: 'all', autoCheckSaves: 'none' }, () => {
  const lines = Object.fromEntries(resultsVerdict().map(line => [line.id, line.text]))
  assert.equal(lines.saves, MIDI
    ? "Saves: shown on players' cards and rolls, hidden otherwise (Challenge Visibility: Show only from other players)"
    : "Saves: shown on players' cards and rolls, hidden otherwise (Challenge Visibility: Show only from other players)")
  assert.equal(lines.hits, MIDI
    ? "Hit and miss on dnd5e's cards: shown for an attack at one target, hidden otherwise (Attack Result Visibility: Show only results; Color code Hit/Miss/Save Display: On; Only highlight critical/fumble hits: Off)"
    : 'Hit and miss: shown (Attack Result Visibility: Show only results)')
}))
if (MIDI) {
  await withSettings({ attackRollVisibility: 'none' }, () => withMidi({ autoCheckHit: 'all' }, () => {
    assert.equal(resultsVerdict().find(({ id }) => id === 'midiHits').text,
      "Hit and miss on Midi-QOL's cards: hidden (Auto check if attack hits target: Check - all see result; Attack Result Visibility: Hide all)")
  }))
  await withSettings({ attackRollVisibility: 'none' }, () => withMidi({ autoCheckHit: 'none', gmAttackDisplay: 'hitMiss', gmDamageDisplay: 'totalOnly' }, () => {
    const lines = Object.fromEntries(resultsVerdict().map(line => [line.id, line.text]))
    assert.equal(lines.midiHits, "Hit and miss on Midi-QOL's cards: shown on the Gamemaster's attacks at one target, hidden otherwise (Auto check if attack hits target: None; Attack Result Visibility: Hide all; GM Attack Roll Display: Hit/Miss Only)")
    assert.equal(lines.gmRolls, "The Gamemaster's rolls on Midi-QOL's cards: shown as GM Attack Roll Display and GM Damage Roll Display allow, hidden otherwise (GM Attack Roll Display: Hit/Miss Only; GM Damage Roll Display: Damage Total Only)")
  }))
}
// Module 0.31.0: Always's words, one case each.
await withSettings({ gmContent: false, chatResults: 'always', attackRollVisibility: 'none', challengeVisibility: 'none' }, () => withMidi({ autoCheckHit: 'none', autoCheckSaves: 'all' }, () => {
  const lines = Object.fromEntries(resultsVerdict().map(line => [line.id, line.text]))
  const why = '(Hit/miss and save results in the app: Always show them to players)'
  assert.deepEqual(lines, {
    hits: `${MIDI ? "Hit and miss on dnd5e's cards" : 'Hit and miss'}: shown ${why}`,
    ...(MIDI && { midiHits: `Hit and miss on Midi-QOL's cards: shown ${why}` }),
    saves: `Saves: shown ${why}`,
    checks: `Checks: shown ${why}`,
    ...(MIDI && {
      midiSaves: `Saves on Midi-QOL's cards: shown ${why}`,
      gmRolls: "The Gamemaster's rolls on Midi-QOL's cards: shown (GM Attack Roll Display: Full Roll; GM Damage Roll Display: Full Roll)",
    }),
  })
}))
if (MIDI) {
  await withSettings({ gmContent: false, chatResults: 'always' }, () => withMidi({ autoCheckSaves: 'none' }, () => {
    assert.equal(resultsVerdict().find(({ id }) => id === 'midiSaves').text, "Saves on Midi-QOL's cards: hidden (Auto check Saves: Off)")
  }))
  await withSettings({ gmContent: true, chatResults: 'always' }, () => {
    assert.ok(resultsVerdict().every(line => line.text.endsWith('(GM-only details: On)')), 'GM-only details first, both on')
  })
}
await withSettings({ chatEvents: false }, () => {
  assert.deepEqual(resultsVerdict(), [{ id: 'chat', state: 'hidden', text: 'Chat: not sent (Chat messages: Off)' }])
})
game.system.id = 'pf2e'
assert.deepEqual(resultsVerdict(), [{ id: 'system', state: 'hidden', text: 'Hit and miss, saves and checks: not sent (they need D&D Fifth Edition)' }])
game.system.id = 'dnd5e'
ok("the verdict's lines read as the 0.30.0 contract has them, by dnd5e's and Midi-QOL's own words; with chat off, or under another system, one line says nothing is sent")

console.log(MIDI ? 'midi: done' : 'dnd5e: done')
process.exit(0)
