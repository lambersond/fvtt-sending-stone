// Hits, misses and saves in chat messages (module 0.29.0), and their cards' content as the app is
// told it: dnd5e's attacks, judged against each target's armor class; Midi-QOL's card, as its flags
// record its hits and saves once it has checked them; and a save rolled from dnd5e's card, whose it
// is and whether it succeeded. Each only where Foundry shows players it, under dnd5e's Attack Roll
// and Challenge Visibility and Midi's Auto Check Hits and Saves, unless Gamemaster-only information
// is on. The real module, dnd5e 5.3.3's real dice classes, a stand-in Foundry core and chat log,
// jsdom's HTML parser. Midi's cards are made as its Workflow.ts writes their flags, from flags alone,
// as after a reload: MIDI=1 puts Midi-QOL's settings in the world; without it, a Midi card tells
// nothing of what it decided. Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
//
// Module 0.30.0 (its contract §3.7, §3.9): each gate made to match what Foundry draws for players, as
// dnd5e 5.3.3 and 6.0.5 and Midi-QOL v14 do (§1a); the checks of 0.29.0's gates that §3.7 changes
// are flipped, each with a comment naming its F item; and one case per row of the audit (A1-A7,
// S1-S13, M1-M18, P1-P2), with §1a's verdict where it differs, then §1a's own cases and the new ones.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { actor, settings, user, users } from './stub.mjs'
CONST.DOCUMENT_OWNERSHIP_LEVELS = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }

const MODULE = process.env.MODULE_DIR
const MIDI = Boolean(process.env.MIDI)
// Module 0.30.0, as tagged, read only: what GM-only details told before 0.31.0.
import { DND5E5, oldModule } from './paths.mjs'
const OLD = oldModule('0.30.0')
const DND5E = `${DND5E5}/module/dice`
const ok = message => console.log('ok -', message)

globalThis.DOMParser = new JSDOM('').window.DOMParser
const { messages } = await import('./dice-core.mjs')
const { default: BasicDie } = await import(`${DND5E}/basic-die.mjs`)
const { default: BasicRoll } = await import(`${DND5E}/basic-roll.mjs`)
const { default: D20Die } = await import(`${DND5E}/d20-die.mjs`)
const { default: D20Roll } = await import(`${DND5E}/d20-roll.mjs`)
Object.assign(CONFIG.Dice, { BasicDie, BasicRoll, D20Die, D20Roll })
CONFIG.Dice.terms.d = BasicDie
CONFIG.DND5E = { abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => [key, { label: key.toUpperCase() }])) }
globalThis.dnd5e = { settings: { rulesVersion: 'modern' } }

// The d20s rolled, in order, as the player rolled them.
const faces = []
const { DiceTerm } = foundry.dice.terms
const randomFace = DiceTerm.prototype.randomFace
DiceTerm.prototype.randomFace = function () { return faces.length ? faces.shift() : randomFace.call(this) }
/** A d20 roll: this natural d20, plus `bonus`; an attack marked as dnd5e marks it, or Midi. */
async function d20(natural, { bonus = 5, target, attack = false, midi = false } = {}) {
  faces.push(natural)
  // As dnd5e's fromConfig gives a d20 roll its thresholds (d20-roll.mjs:51-52).
  const options = {
    criticalSuccess: 20, criticalFailure: 1,
    ...(Number.isFinite(target) && { target }),
    ...(attack && { rollType: 'attack' }),
    ...(midi && { 'midi-qol': { rollType: 'attack' } }),
  }
  return new CONFIG.Dice.D20Roll(`1d20 ${(bonus < 0) ? '-' : '+'} ${Math.abs(bonus)}`, {}, options).evaluate()
}

// ---- Midi-QOL's settings ----
// Module 0.30.0: with the keys results.mjs reads, at Midi's own defaults (MQX settings:117, 182-185,
// 204, 209-210), and a switch that makes them unreadable.
const midiSettings = {
  autoCheckHit: 'all', autoCheckSaves: 'all', highlightSuccess: true, highLightCriticalAttackOnly: false,
  gmAttackDisplay: 'full', gmDamageDisplay: 'full', mergeCardMultiDamage: false, addFakeDice: false,
}
const midiState = { throws: false }
if (MIDI) {
  game.modules.set('midi-qol', { active: true })
  globalThis.MidiQOL = { configSettings: () => { if (midiState.throws) throw new Error('unreadable'); return midiSettings } }
}

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
user('alice', 'Alice')
user('bob', 'Bob')
user('carol', 'Carol')
const thorin = actor('thorin', 'Thorin', ['alice'])
const vex = actor('vex', 'Vex', ['bob'])
const goblin = actor('goblin', 'Goblin', [], 'npc')
const orc = actor('orc', 'Orc', [], 'npc')
const ogre = actor('ogre', 'Ogre', [], 'npc')
const bat = actor('bat', 'Bat', [], 'npc')
const lone = actor('lone', 'Lone Wolf', ['carol'])
// Each caster's save spell, whose activity's Save Display Midi reads.
const spells = new Map()
for (const caster of [thorin, goblin, lone]) {
  const activities = new Map([['blast', { id: 'blast', type: 'save', saveDisplay: 'default' }], ['swing', { id: 'swing', type: 'attack' }]])
  caster.items = new Map([['spell', { id: 'spell', name: 'Burning Hands', system: { activities } }]])
  spells.set(caster.id, activities)
}
// Tokens on the scene, by uuid, as Midi names them: a second goblin of the same actor, and one
// deleted since.
const tokens = new Map()
const place = (id, of) => { tokens.set(`Scene.s.Token.${id}`, { id, uuid: `Scene.s.Token.${id}`, actor: of }); return `Scene.s.Token.${id}` }
const tok = { goblin: place('tgob', goblin), goblin2: place('tgob2', goblin), orc: place('torc', orc), ogre: place('togre', ogre), vex: place('tvex', vex), thorin: place('tthorin', thorin) }
const goneToken = 'Scene.s.Token.gone'
globalThis.fromUuidSync = uuid => tokens.get(uuid) ?? null

// ---- Start-up ----
globalThis.fetch = async () => ({ ok: true, status: 204, statusText: 'No Content', headers: new Headers() })
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { 'camp-a': 'ashlands-secret' })
settings.set('campaigns', [{ id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex'] }])
await Hooks.callAll('ready')
const { chatAudience, isAudienceShared, serializeMessage } = await import(`${MODULE}/scripts/chat-data.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const [campaign] = getCampaigns()
const serialized = message => JSON.parse(JSON.stringify(serializeMessage(message, campaign)))
// Module 0.31.0 (its contract §4.7.2): every message told here is told again under Follow, GM-only
// details and "Hit/miss and save results in the app: Always show them to players", and the
// invariant checked: under Always every outcome, save and check is GM-only details', except that
// no armor class goes with them and a roll Midi obscures tells nothing; and all else, the content,
// `system`, `rolls`, the audience and the text, is Follow's, byte for byte.
let twins = 0
function asIf(mode, message) {
  const before = ['gmContent', 'chatResults'].map(key => [key, settings.has(key), settings.get(key)])
  settings.set('gmContent', mode === 'gm')
  settings.set('chatResults', (mode === 'always') ? 'always' : 'foundry')
  try { return serialized(message) } finally {
    for (const [key, had, value] of before) { if (had) settings.set(key, value); else settings.delete(key) }
  }
}
function twin(message) {
  const [follow, gmOn, always] = ['follow', 'gm', 'always'].map(mode => asIf(mode, message))
  const { dnd5e: followData, ...followRest } = follow
  const { dnd5e: alwaysData, ...alwaysRest } = always
  assert.deepEqual(alwaysRest, followRest, `Always: all but dnd5e as Follow (${message.id})`)
  if (!followData) return assert.equal(alwaysData, followData)
  const told = (message.flags?.['midi-qol']?.obscureRoll === true) ? followData : gmOn.dnd5e
  const { targets, save, check, ...rest } = alwaysData
  const { targets: _t, save: _s, check: _c, ...followOther } = followData
  assert.deepEqual(rest, followOther, `Always: dnd5e's other fields as Follow (${message.id})`)
  assert.deepEqual(targets, told.targets.map(({ name, uuid, outcome, save }) => ({
    name, uuid, ...((outcome !== undefined) && { outcome }), ...((save !== undefined) && { save }),
  })), `Always: each target as GM-only details tells it, with no armor class (${message.id})`)
  assert.ok(targets.every(target => !('ac' in target)))
  assert.deepEqual([save, check], [told.save, told.check], `Always: the save or check as GM-only details tells it (${message.id})`)
  twins++
}
const told = message => { twin(message); return serialized(message) }
const targetsOf = message => told(message).dnd5e.targets
const results = message => targetsOf(message).map(({ name, outcome, save }) => [name, outcome ?? null, save ?? null])
const gm = (on, fn) => async (...args) => { settings.set('gmContent', on); try { return await fn(...args) } finally { settings.set('gmContent', false) } }
/** Module 0.31.0: as `gm`, with "Hit/miss and save results in the app" Always, or Follow. */
const always = (on, fn) => async (...args) => { settings.set('chatResults', on ? 'always' : 'foundry'); try { return await fn(...args) } finally { settings.delete('chatResults') } }
const descriptor = (who, ac = 15, saved) => ({ name: who.name, img: '', uuid: who.uuid, ac, ...((saved !== undefined) && { saved }) })
const speakerOf = who => ({ actor: who.id, alias: who.name })
settings.set('gmContent', false)

// ---- dnd5e's attacks ----
/**
 * dnd5e's attack message, its targets in its flags, as attack.mjs:149-158 has them; its d20 given the
 * one target's armor class, as dnd5e gives it for an attack at a single target (attack.mjs:101).
 */
const attackMessage = async (natural, targets, { bonus = 5, flags = {}, ...fields } = {}) => ChatMessage.create({
  author: 'alice', speaker: speakerOf(thorin),
  rolls: [await d20(natural, { bonus, attack: true, target: (targets.length === 1) ? (targets[0].ac ?? undefined) : undefined })],
  flags: { dnd5e: { roll: { type: 'attack' }, targets, item: { id: 'spell' }, activity: { id: 'swing' } }, ...flags }, ...fields,
})
const three = [descriptor(goblin, 15), descriptor(orc, 12), descriptor(ogre, null)]
let message = await attackMessage(9, three)
settings.set('attackRollVisibility', 'none')
assert.deepEqual(results(message), [['Goblin', null, null], ['Orc', null, null], ['Ogre', null, null]])
settings.delete('attackRollVisibility')
assert.deepEqual(results(message), [['Goblin', null, null], ['Orc', null, null], ['Ogre', null, null]], 'unreadable, as hidden')
for (const visibility of ['hideAC', 'all']) {
  settings.set('attackRollVisibility', visibility)
  // §3.7 F5 (flipped from 0.29.0's "total cover a miss"): under dnd5e 5 the Ogre, under total cover,
  // is told as dnd5e's card draws it, hit. §3.7 F7: with Midi-QOL active, which draws no tray, an
  // attack at three targets tells nothing.
  const expected = MIDI ? [['Goblin', null, null], ['Orc', null, null], ['Ogre', null, null]]
    : [['Goblin', 'miss', null], ['Orc', 'hit', null], ['Ogre', 'hit', null]]
  assert.deepEqual(results(message), expected, visibility)
  assert.ok(targetsOf(message).every(target => !('ac' in target)), 'no armor class')
}
// dnd5e's own card's test (chat-message.mjs:463) compares the total with null, as with 0, and so
// draws the Ogre as hit, of armor class ∞, as the module now tells it; PROTOCOL.md must say so.
const cardMisses = (roll, ac) => !roll.isCritical && ((roll.total < ac) || roll.isFumble)
assert.deepEqual(three.map(({ ac }) => cardMisses(message.rolls[0], ac)), [true, false, false], "dnd5e's card: the Ogre hit")
const outcomeRow = readFileSync(`${MODULE}/PROTOCOL.md`, 'utf8').split('\n').find(line => line.startsWith('| `targets[].outcome` |'))
assert.match(outcomeRow, /a target under total cover \(`ac` `null`\) is drawn as dnd5e's version draws it: a hit under dnd5e 5 unless the attack is a fumble, a miss under dnd5e 6/)
assert.doesNotMatch(outcomeRow, /one under total cover \(`ac` `null`\) misses\. dnd5e's card differs/)
message = await attackMessage(15, [descriptor(goblin, 20)])
assert.deepEqual(results(message), [['Goblin', 'hit', null]])
ok(MIDI ? "with Midi-QOL active, dnd5e's attack at several targets tells nothing, Midi drawing no tray (F7); at one, whether it hit; never the armor class"
  : "dnd5e's attack says whether it hit each target, one or several, total cover a hit as dnd5e 5's card draws it (F5, as PROTOCOL.md says), where its Attack Result Visibility shows players, Show only results or Show results & target ACs; nothing under Hide all, or where it can't be read; never the armor class")

message = await attackMessage(20, [descriptor(goblin, 15)], { bonus: -10 })
assert.deepEqual(results(message), [['Goblin', 'hit', null]], 'a critical hit, under the armor class')
message = await attackMessage(1, [descriptor(goblin, 15)], { bonus: 20 })
assert.deepEqual(results(message), [['Goblin', 'miss', null]], 'a fumble, over it')
message = await attackMessage(10, [{ name: 'Odd', uuid: 'Actor.odd' }])
assert.deepEqual(results(message), [['Odd', null, null]], 'no armor class at all says nothing')
message = await ChatMessage.create({
  author: 'alice', speaker: speakerOf(thorin), rolls: [await d20(19, { attack: true })],
  flags: { dnd5e: { roll: { type: 'damage' }, targets: [descriptor(goblin, 15)] } },
})
assert.deepEqual(results(message), [['Goblin', null, null]], 'a roll that is no attack')
message = await attackMessage(19, [descriptor(goblin, 15)], { flags: { 'midi-qol': { obscureRoll: true } } })
assert.deepEqual(results(message), [['Goblin', null, null]], 'a roll shown players as ??')
ok('a critical hit hits, a fumble misses; nothing for a target of no armor class, a roll that is no attack, or one Midi-QOL obscures')

settings.set('attackRollVisibility', 'none')
message = await attackMessage(9, three)
const allSent = await gm(true, targetsOf)(message)
// §3.7 F5 (flipped): with Gamemaster-only information on, total cover as dnd5e 5 draws it, hit.
assert.deepEqual(allSent.map(({ name, ac, outcome }) => [name, ac, outcome]), [['Goblin', 15, 'miss'], ['Orc', 12, 'hit'], ['Ogre', null, 'hit']])
message = await attackMessage(9, three, { flags: { 'midi-qol': { obscureRoll: true } } })
assert.deepEqual((await gm(true, targetsOf)(message)).map(t => t.outcome), ['miss', 'hit', 'hit'])
settings.set('attackRollVisibility', 'hideAC')
ok('with Gamemaster-only information on, every outcome is sent, as armor class is, whatever Foundry shows players')

// ---- A save rolled from dnd5e's card ----
const saveButtons = dc => `<div class="card-buttons"><button type="button" data-action="rollSave" data-ability="dex" data-dc="${dc}" data-visibility="all">
  <span class="visible-dc">DC ${dc} DEX</span><span class="hidden-dc">DEX Saving Throw</span></button></div>`
/** dnd5e's save card, as its activity's: by its caster, whose user posted it. */
const saveCard = (by, author, { flags = {}, content = saveButtons(13), activity = 'blast' } = {}) => ChatMessage.create({
  author, speaker: speakerOf(by), content,
  flags: { dnd5e: { messageType: 'usage', item: { id: 'spell' }, activity: { id: activity }, targets: [descriptor(orc), descriptor(vex)] }, ...flags },
})
/** A creature's save from a card, as basic-roll.mjs:171-173 links it. */
const saveFrom = async (card, who, natural, { target = 13, roll = {}, flags = {}, speaker = speakerOf(who) } = {}) => ChatMessage.create({
  author: 'gm', speaker, rolls: [await d20(natural, { bonus: 2, target })],
  flags: { dnd5e: { roll: { type: 'save', ability: 'dex', ...roll }, ...(card && { originatingMessage: card.id }) }, ...flags },
})
const saveOf = message => told(message).dnd5e.save
const gmCard = await saveCard(goblin, 'gm')
const aliceCard = await saveCard(thorin, 'alice')
const carolCard = await saveCard(lone, 'carol')
const orcFails = card => saveFrom(card, orc, 5)
const orcSaves = card => saveFrom(card, orc, 15)
for (const [visibility, card, expected] of [
  ['all', gmCard, { target: 'Actor.orc', outcome: 'failure' }],
  ['player', gmCard, { target: 'Actor.orc' }],
  ['player', aliceCard, { target: 'Actor.orc', outcome: 'failure' }],
  ['none', aliceCard, { target: 'Actor.orc', outcome: 'failure', readers: ['thorin'] }],
  ['none', gmCard, { target: 'Actor.orc' }],
  ['none', carolCard, { target: 'Actor.orc' }],
]) {
  settings.set('challengeVisibility', visibility)
  assert.deepEqual(saveOf(await orcFails(card)), expected, `${visibility} ${card.author.id}`)
}
settings.set('challengeVisibility', 'all')
assert.deepEqual(saveOf(await orcSaves(gmCard)), { target: 'Actor.orc', outcome: 'success' })
assert.deepEqual(saveOf(await saveFrom(gmCard, vex, 15)), { target: 'Actor.vex', outcome: 'success' })
ok("a save from dnd5e's card names its creature, as the card's targets do, and says whether it succeeded as Challenge Visibility shows it: to everyone, on every card or players'; to the card's author's characters alone; or to none, when only its creature is named")

assert.deepEqual(saveOf(await saveFrom(gmCard, orc, 5, { roll: { forceSuccess: true } })), { target: 'Actor.orc', outcome: 'success' }, 'a legendary resistance')
message = await saveFrom(gmCard, orc, 15)
message.rolls[0].dice[0].options.marginSuccess = true
assert.deepEqual(saveOf(message), { target: 'Actor.orc' }, 'a modified d20')
assert.deepEqual(saveOf(await saveFrom(gmCard, orc, 15, { target: null })), { target: 'Actor.orc' }, 'no DC')
assert.deepEqual(saveOf(await saveFrom(gmCard, orc, 15, { flags: { 'midi-qol': { obscureRoll: true } } })), { target: 'Actor.orc' }, 'obscured')
ok("a legendary resistance's forced success succeeds; a modified d20, a save against no DC, or one shown as ?? tells no outcome")

// §3.7 F1 (flipped from 0.29.0's "no save is told of ..."): a save from any origin is told, as dnd5e
// highlights it by the card it was rolled from, or by the roll itself where there's none: here
// under Show all, to everyone. Only a save of no creature still tells nothing.
const told0 = { target: 'Actor.orc', outcome: 'success' }
assert.deepEqual(saveOf(await saveFrom(null, orc, 15)), told0, 'no card: the roll itself')
const gone = await saveCard(goblin, 'gm')
messages.delete(gone.id)
assert.deepEqual(saveOf(await saveFrom(gone, orc, 15)), told0, 'a card no longer there: the roll itself')
const concentrationCard = await ChatMessage.create({
  author: 'gm', speaker: speakerOf(thorin), content: '<button data-action="concentration" data-type="concentration" data-dc="10">Concentration</button>',
  flags: {},
})
assert.deepEqual(saveOf(await saveFrom(concentrationCard, thorin, 15, { target: 10 })), { target: 'Actor.thorin', outcome: 'success' }, 'a concentration check')
const request = await ChatMessage.create({ author: 'gm', content: '<button data-action="rollRequest" data-type="save" data-ability="dex" data-dc="12">DEX</button>', speaker: { actor: null, alias: 'Gamemaster' } })
assert.deepEqual(saveOf(await saveFrom(request, orc, 15)), told0, 'a request')
const midiSaveCard = await saveCard(goblin, 'gm', { flags: { 'midi-qol': { messageType: 'saves' } } })
assert.deepEqual(saveOf(await saveFrom(midiSaveCard, orc, 15)), told0, "Midi's card")
const attackCard = await saveCard(goblin, 'gm', { activity: 'swing' })
assert.deepEqual(saveOf(await saveFrom(attackCard, orc, 15)), told0, "a card that's no save's")
assert.equal(saveOf(await saveFrom(gmCard, orc, 15, { speaker: { actor: 'nobody', alias: 'Nobody' } })), undefined, 'no creature')
ok("a save is told from any origin (F1): no card, one no longer there, a concentration card, a request, Midi-QOL's card, one of no save; never one of no creature")

settings.set('challengeVisibility', 'none')
assert.deepEqual(await gm(true, saveOf)(await orcFails(gmCard)), { target: 'Actor.orc', outcome: 'failure' })
assert.deepEqual(await gm(true, saveOf)(await orcFails(aliceCard)), { target: 'Actor.orc', outcome: 'failure' }, 'no readers')
message = await saveFrom(gmCard, orc, 15)
message.rolls[0].dice[0].options.marginSuccess = true
assert.deepEqual(await gm(true, saveOf)(message), { target: 'Actor.orc' }, 'still decided only as dnd5e decides')
settings.set('challengeVisibility', 'player')
ok('with Gamemaster-only information on, every decided save is told, to everyone; one not decided still is not')

// ---- Out of the box ----
// dnd5e's defaults, as its settings.mjs registers them (:538-577): no hit or miss for players, but a
// save against a player's card told to everyone; and README.md must say so, not that nothing shows.
const dnd5eSettings = readFileSync(`${DND5E5}/module/settings.mjs`, 'utf8')
const defaultOf = key => dnd5eSettings.match(new RegExp(`register\\("dnd5e", "${key}", \\{[^}]*?default: "(\\w+)"`))?.[1]
const defaults = { attackRollVisibility: defaultOf('attackRollVisibility'), challengeVisibility: defaultOf('challengeVisibility') }
assert.deepEqual(defaults, { attackRollVisibility: 'none', challengeVisibility: 'player' })
for (const [key, value] of Object.entries(defaults)) settings.set(key, value)
assert.deepEqual(results(await attackMessage(15, [descriptor(goblin, 12)])), [['Goblin', null, null]], 'no hit')
assert.deepEqual(saveOf(await orcFails(aliceCard)), { target: 'Actor.orc', outcome: 'failure' }, "a save against a player's card")
assert.deepEqual(saveOf(await orcFails(gmCard)), { target: 'Actor.orc' }, "none against the Gamemaster's")
settings.set('attackRollVisibility', 'hideAC')
const readme = readFileSync(`${MODULE}/README.md`, 'utf8')
const [from, to] = ['### Hit, miss and save results', '### Saves the game asks for'].map(heading => readme.indexOf(heading))
assert.ok((from >= 0) && (to > from), "README.md's section of results")
const resultsSaid = readme.slice(from, to).replace(/\s+/g, ' ')
assert.doesNotMatch(resultsSaid, /defaults[^.]*show players none/, 'not that nothing shows out of the box')
assert.match(resultsSaid, /default Challenge Visibility \("Show only from other players"\) already shows everyone whether each creature saved against a save card a player posted/)
ok("out of the box, as dnd5e registers its settings, no hit or miss is told, and a save against a player's card is told to everyone, as README.md says")

// ---- Content ----
settings.set('challengeVisibility', 'player')
let sent = told(gmCard)
assert.ok(!sent.content.includes('data-dc') && !sent.content.includes('visible-dc') && !sent.content.includes('DC 13'), sent.content)
assert.ok(sent.content.includes('DEX Saving Throw') && sent.content.includes('data-action="rollSave"'))
assert.ok(!sent.text.includes('DC 13') && sent.text.includes('DEX Saving Throw'), sent.text)
sent = told(aliceCard)
assert.ok(!sent.content.includes('data-dc') && sent.content.includes('DC 13 DEX'), sent.content)
assert.equal(gmCard.content, saveButtons(13), "the module's own copy is the message's, untouched")
ok("a card's content goes without any DC on its buttons, and without its labels with DCs where players may not see them; kept where they may; and the text so")

const midiContent = `<div class="midi-qol-attack-roll">Attack</div>
<div class="midi-qol-hits-display"><div class="midi-qol-single-hit-card">Goblin hits (AC 15)</div></div>
<div class="midi-qol-saves-display"><div data-item-id="spell"><span data-tooltip="12 vs DC 15">Orc fails</span><div class="end-midi-qol-saves-display"></div></div></div>
<div class="card-buttons"><button data-action="rollDamage">Damage</button></div>`
const midiCard = await ChatMessage.create({ author: 'gm', speaker: speakerOf(goblin), content: midiContent, flags: { 'midi-qol': { messageType: 'attack' }, dnd5e: { targets: [] } } })
sent = told(midiCard)
assert.ok(!/AC 15|vs DC|Goblin hits|Orc fails/.test(sent.content), sent.content)
assert.ok(sent.content.includes('class="midi-qol-hits-display"') && sent.content.includes('class="midi-qol-saves-display"') && sent.content.includes('Damage'))
assert.equal(sent.text, 'Attack Damage')
ok("Midi-QOL's sections of hits and saves are emptied, and the text has none of their words")

const raw = await gm(true, told)(gmCard)
assert.equal(raw.content, gmCard.content)
assert.equal(raw.text, 'DEX Saving Throw', 'the text as before: the DC label hidden where challenge is')
assert.equal((await gm(true, told)(midiCard)).content, midiContent)
ok('with Gamemaster-only information on, the content is sent as it is')

// ---- Module 0.30.0: one case per row of the audit (the 0.30.0 results audit, §5), §1a's verdict where it differs ----
/** Run with these settings, then put each back as it was. */
async function withSettings(changes, fn) {
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
const row = (id, text) => ok(`${id}: ${text}`)
/** A save or check its roller rolled: from a card, or from a link in a description, with none. */
const rollOf = async ({ author = 'alice', who = thorin, type = 'save', card = null, natural = 15, target = 13, roll = {}, flags = {}, ...fields } = {}) => ChatMessage.create({
  author, speaker: speakerOf(who), rolls: [await d20(natural, { bonus: 2, target })],
  flags: { dnd5e: { roll: { type, ...roll }, ...(card && { originatingMessage: card.id }) }, ...flags }, ...fields,
})
const checkOf = message => told(message).dnd5e.check
const thorinTold = { target: 'Actor.thorin', outcome: 'success' }
const thorinOnly = { target: 'Actor.thorin' }
const requestBy = (author, type = 'save') => ChatMessage.create({
  author, speaker: { actor: null, alias: 'Request' },
  content: (type === 'save') ? '<button data-action="rollRequest" data-type="save" data-ability="dex" data-dc="12">DEX</button>'
    : '<button data-action="rollRequest" data-type="skill" data-skill="prc" data-ability="wis" data-dc="12">Perception</button>',
})
/** dnd5e 6's typed message, as its data models keep it: `system` with `toObject`, and its getters. */
const typed = (type, system, fields = {}) => {
  const data = structuredClone(Object.fromEntries(Object.entries(system).filter(([key]) => key !== 'origin')))
  const model = { ...system, forceSuccess: system.resisted === true, toObject: () => ({ ...structuredClone(data), origin: system.origin?.id ?? null }) }
  return ChatMessage.create({ type, system: model, flags: {}, ...fields })
}
const asSix = async fn => { const version = game.system.version; game.system.version = '6.0.5'; try { return await fn() } finally { game.system.version = version } }

if (!MIDI) {
  await withSettings({ attackRollVisibility: 'none' }, async () => {
    const own = await attackMessage(15, [descriptor(goblin, 12)])
    assert.deepEqual(results(own), [['Goblin', null, null]])
  })
  row('A1', "dnd5e's attack under Attack Result Visibility Hide all tells nothing, not even its attacker")

  await withSettings({ attackRollVisibility: 'hideAC' }, async () => {
    assert.deepEqual(results(await attackMessage(15, [descriptor(goblin, 12)])), [['Goblin', 'hit', null]], 'one target')
    assert.deepEqual(results(await attackMessage(12, [descriptor(goblin, 12), descriptor(orc, 20)])), [['Goblin', 'hit', null], ['Orc', 'miss', null]], 'two')
    const whispered = await attackMessage(15, [descriptor(goblin, 12)], { whisper: ['alice'] })
    assert.deepEqual(results(whispered), [['Goblin', 'hit', null]], 'whispered to its reader')
    assert.ok(targetsOf(whispered).every(target => !('ac' in target)))
  })
  row('A2', "under Show only results, each target of dnd5e's attack, one or several, public or whispered to its reader, told hit or missed, without its armor class")

  await withSettings({ attackRollVisibility: 'all' }, async () => {
    const message = await attackMessage(12, [descriptor(goblin, 12), descriptor(orc, 20)])
    assert.deepEqual(results(message), [['Goblin', 'hit', null], ['Orc', 'miss', null]])
    assert.ok(targetsOf(message).every(target => !('ac' in target)), 'the armor class is still withheld')
  })
  row('A3', "under Show results & target ACs, as A2, armor class still withheld (A3, minor, unchanged)")

  await withSettings({ attackRollVisibility: 'hideAC' }, async () => {
    const cover = [descriptor(goblin, 12), descriptor(ogre, null)]
    assert.deepEqual(results(await attackMessage(10, cover)), [['Goblin', 'hit', null], ['Ogre', 'hit', null]], 'total cover: hit')
    assert.deepEqual(results(await attackMessage(1, cover, { bonus: 20 })), [['Goblin', 'miss', null], ['Ogre', 'miss', null]], 'a fumble misses')
    assert.deepEqual(results(await attackMessage(2, cover, { bonus: -5 })), [['Goblin', 'miss', null], ['Ogre', 'miss', null]], 'a total below 0 misses, as dnd5e compares it with null')
    assert.deepEqual(results(await attackMessage(20, cover, { bonus: -30 })), [['Goblin', 'hit', null], ['Ogre', 'hit', null]], 'a critical hits')
  })
  row('A4', "dnd5e 5's attack at a target under total cover is told as its card draws it: a hit unless a fumble, or a total below 0 (F5)")

  await withSettings({ attackRollVisibility: 'hideAC' }, () => asSix(async () => {
    const roll = await d20(15, { attack: true })
    const message = await typed('attack', { targets: [{ name: 'Goblin', actor: 'Actor.goblin', ac: 12, token: 'Scene.s.Token.tgob' }, { name: 'Ogre', actor: 'Actor.ogre', ac: null, token: null }] }, { author: 'alice', speaker: speakerOf(thorin), rolls: [roll] })
    assert.deepEqual(results(message), [['Goblin', 'hit', null], ['Ogre', 'miss', null]], "dnd5e 6: total cover a miss")
    assert.equal(told(message).dnd5e.roll.type, 'attack')
    await withSettings({ attackRollVisibility: 'none' }, () => assert.deepEqual(results(message), [['Goblin', null, null], ['Ogre', null, null]]))
  }))
  row('A5', "dnd5e 6's typed attack message is told from its system data: each target hit or missed under Show only results, total cover a miss as dnd5e 6 draws it (F4, F5); nothing under Hide all")

  await asSix(async () => {
    const message = await typed('attack', { targets: [{ name: 'Goblin', actor: 'Actor.goblin', ac: 12, token: null }] }, { rolls: [await d20(15, { attack: true })] })
    for (const visibility of ['none', 'hideAC', 'all']) {
      await withSettings({ attackRollVisibility: visibility }, () => {
        assert.ok(!('ac' in told(message).system.targets[0]), visibility)
      })
    }
    assert.equal((await gm(true, told)(message)).system.targets[0].ac, 12, 'with Gamemaster-only information on, as it is')
  })
  row('A6', "dnd5e 6's raw system data goes without each target's armor class, under every setting, unless Gamemaster-only information is on (F4)")
}

// Saves and checks of dnd5e's, by the card they were rolled from: under Midi-QOL too, whose
// highlight settings are at its defaults here.
const aliceSaveCard = await saveCard(thorin, 'alice')
for (const [id, visibility, card, expected] of [
  ['S1', 'player', aliceSaveCard, thorinTold], ['S1', 'all', aliceSaveCard, thorinTold],
  ['S2', 'player', gmCard, thorinOnly],
  ['S3', 'all', gmCard, thorinTold],
  ['S4', 'none', aliceSaveCard, { ...thorinTold, readers: ['thorin'] }],
  ['S5', 'none', gmCard, thorinOnly],
]) {
  await withSettings({ challengeVisibility: visibility }, async () => {
    assert.deepEqual(saveOf(await rollOf({ card })), expected, `${id} ${visibility}`)
  })
}
row('S1-S5', "a save from a save card: everyone sees it on a player's card under Show only from other players or Show all; on the Gamemaster's, under Show all alone; under Hide all, the player's card's author's characters, or no one")

const gmRequest = await requestBy('gm')
const aliceRequest = await requestBy('alice')
await withSettings({ challengeVisibility: 'all' }, async () => assert.deepEqual(saveOf(await rollOf({ card: gmRequest })), thorinTold, 'all'))
await withSettings({ challengeVisibility: 'player' }, async () => {
  assert.deepEqual(saveOf(await rollOf({ card: gmRequest })), thorinOnly, "the Gamemaster's request: not its roller")
  assert.deepEqual(saveOf(await rollOf({ card: aliceRequest, who: vex, author: 'bob' })), { target: 'Actor.vex', outcome: 'success' }, "a player's request: everyone")
})
row('S6', "a save from a roll request card is told by the request's author (F1): under Show all, everyone; under Show only from other players, everyone for a player's request, no one for the Gamemaster's, not even its roller")

await withSettings({ challengeVisibility: 'none' }, async () => {
  assert.deepEqual(saveOf(await rollOf()), { ...thorinTold, readers: ['thorin'] }, 'its roller, always')
  assert.deepEqual(saveOf(await rollOf({ author: 'gm' })), thorinOnly, "the Gamemaster's: no player")
})
await withSettings({ challengeVisibility: 'player' }, async () => assert.deepEqual(saveOf(await rollOf()), thorinTold, "a player's, under player: everyone"))
row('S7', 'a save from a link in a description, of no card, is told by the roll itself: its roller always sees it, others as Challenge Visibility has it for them (F1)')

const concentration = await ChatMessage.create({
  author: 'gm', speaker: speakerOf(thorin), whisper: ['alice'],
  content: '<button data-action="concentration" data-type="concentration" data-dc="10">Concentration</button>',
})
await withSettings({ challengeVisibility: 'all' }, async () => assert.deepEqual(saveOf(await rollOf({ card: concentration, target: 10 })), thorinTold))
await withSettings({ challengeVisibility: 'player' }, async () => assert.deepEqual(saveOf(await rollOf({ card: concentration, target: 10 })), thorinOnly))
row('S8', "a concentration save from dnd5e's card, the Gamemaster's, whispered to its owners, is told under Show all, not under Show only from other players (F1)")

const checkCard = await saveCard(thorin, 'alice', { content: '<button data-action="rollCheck" data-ability="wis" data-dc="12">WIS</button>' })
const perception = { type: 'skill', roll: { skillId: 'prc', ability: 'wis' } }
await withSettings({ challengeVisibility: 'player' }, async () => {
  assert.deepEqual(checkOf(await rollOf({ ...perception, card: checkCard })), thorinTold, "a player's check card")
  assert.deepEqual(checkOf(await rollOf({ ...perception, card: await requestBy('gm', 'check') })), thorinOnly, "the Gamemaster's request")
  const ability = await rollOf({ type: 'ability', roll: { ability: 'str' } })
  assert.deepEqual(checkOf(ability), thorinTold, 'an ability check from a link')
  assert.equal(saveOf(ability), undefined, 'a check is no save')
})
await withSettings({ challengeVisibility: 'none' }, async () => {
  assert.deepEqual(checkOf(await rollOf({ type: 'tool', roll: { toolId: 'thief', ability: 'dex' } })), { ...thorinTold, readers: ['thorin'] }, 'a tool check from a link')
})
row('S9', "a check, ability, skill or tool, is told in `check`, by the same rule as a save: from a check card, a request, or a link (F1)")

const goneGm = await saveCard(goblin, 'gm')
messages.delete(goneGm.id)
await withSettings({ challengeVisibility: 'player' }, async () => {
  assert.deepEqual(saveOf(await rollOf({ card: gmCard })), thorinOnly, "the Gamemaster's card")
  assert.deepEqual(saveOf(await rollOf({ card: goneGm })), thorinTold, 'its card deleted: the roll itself, a player\'s')
})
row('S10', "a save whose card was deleted is told by the roll itself, as dnd5e falls back to it (F1)")

await withSettings({ challengeVisibility: 'all' }, async () => {
  const death = await rollOf({ type: 'death', target: 10 })
  assert.equal(saveOf(death), undefined)
  assert.equal(checkOf(death), undefined)
  assert.equal(saveOf(await rollOf({ type: 'initiative' })), undefined, 'nor initiative')
})
row('S11', 'a death save is no `save` (out of scope: the app shows its own), nor is initiative')

await withSettings({ challengeVisibility: 'player' }, () => asSix(async () => {
  const save = await typed('save', { type: 'ability', ability: 'dex', origin: gmCard, targets: [] }, { author: 'alice', speaker: speakerOf(thorin), rolls: [await d20(15, { target: 13 })] })
  assert.deepEqual(saveOf(save), thorinOnly, "by its origin, the Gamemaster's card")
  assert.equal(told(save).dnd5e.originatingMessage, gmCard.id)
  const check = await typed('check', { type: 'ability', ability: 'wis', skill: 'prc', tool: null, targets: [] }, { author: 'alice', speaker: speakerOf(thorin), rolls: [await d20(15, { target: 13 })] })
  assert.deepEqual(checkOf(check), thorinTold)
  assert.deepEqual(told(check).dnd5e.roll, { type: 'skill', ability: 'wis', skillId: 'prc' })
  const resisted = await typed('save', { type: 'ability', ability: 'dex', origin: aliceSaveCard, resisted: true, targets: [] }, { speaker: speakerOf(thorin), rolls: [await d20(2, { target: 13 })] })
  assert.deepEqual(saveOf(resisted), thorinTold, 'a legendary resistance')
}))
row('S12', "dnd5e 6's saves and checks, of any origin, as S1-S9: by `system.origin`, `system.skill`, and `resisted` a success (F4)")

await asSix(async () => {
  const buttons = [{ action: 'rollSave', dataset: { dc: 15, ability: 'dex' }, label: { hidden: 'DEX Saving Throw', value: 'DC 15 DEX' } }]
  const gmUsage = await typed('usage', { buttons: structuredClone(buttons), targets: [] }, { author: 'gm' })
  const aliceUsage = await typed('usage', { buttons: structuredClone(buttons), targets: [] }, { author: 'alice' })
  await withSettings({ challengeVisibility: 'player' }, async () => {
    assert.deepEqual(told(gmUsage).system.buttons[0], { action: 'rollSave', dataset: { ability: 'dex' }, label: { hidden: 'DEX Saving Throw', value: 'DEX Saving Throw' } })
    assert.deepEqual(told(aliceUsage).system.buttons[0].label.value, 'DC 15 DEX', "a player's card, whose DC players see")
    assert.ok(!('dc' in told(aliceUsage).system.buttons[0].dataset))
    assert.deepEqual((await gm(true, told)(gmUsage)).system.buttons[0], buttons[0], 'Gamemaster-only information on: as it is')
  })
  const request = await typed('request', { handler: 'skill', data: { skill: 'prc', dc: 14, target: 14 }, targets: [] }, { author: 'gm' })
  assert.deepEqual(told(request).system.data, { skill: 'prc' }, "a request's DC and target")
})
row('S13', "dnd5e 6's usage card's buttons go without their DC, and labelled without it where players don't see it; a request's DC and target go too (F4)")

await withSettings({ challengeVisibility: 'all' }, async () => {
  const gmPrivate = await rollOf({ author: 'gm', whisper: ['gm'] })
  assert.equal(isAudienceShared(chatAudience(gmPrivate, campaign)), false, "the Gamemaster's private roll")
  const blind = await rollOf({ author: 'alice', whisper: ['gm'], blind: true })
  assert.equal(isAudienceShared(chatAudience(blind, campaign)), false, 'a blind roll')
  const toBob = await rollOf({ author: 'gm', who: vex, whisper: ['bob'] })
  assert.deepEqual(chatAudience(toBob, campaign).characters, ['vex'], "a whisper to another player is never Thorin's")
})
row('P1', "a Gamemaster's private roll and a blind roll go to no player, and a whisper only to whom it's whispered, as before")

// ---- Midi-QOL's card ----
/** Midi's card, as Workflow.ts writes it: its kind, its rolls, its own flags, and dnd5e's targets. */
const midiCardOf = async ({ targets, rolls = [], flags = {}, by = goblin, author = 'gm', ...fields }) => ChatMessage.create({
  author, speaker: speakerOf(by), rolls, content: '',
  flags: { 'midi-qol': { messageType: 'attack', ...flags }, dnd5e: { item: { id: 'spell' }, activity: { id: 'blast' }, targets } }, ...fields,
})
const hitFlags = { GMOnlyAttackRoll: false, hitTargetUuids: [tok.goblin], hitECTargetUuids: [], targets: [{ uuid: tok.goblin }, { uuid: tok.orc }, { uuid: goneToken }] }
const hitTargets = [descriptor(goblin), descriptor(orc), descriptor(bat)]
const attackRoll = () => d20(14, { midi: true })

/**
 * Module 0.31.0 (its contract §4.7.2): "Hit/miss and save results in the app: Always show them to
 * players", with GM-only details off, beside every case above, each of which was told again under it
 * (`twin`): here what Always shows that Follow doesn't, what it still keeps, and option B.
 */
async function alwaysCases() {
  const saved = ['attackRollVisibility', 'challengeVisibility'].map(key => [key, settings.get(key)])
  settings.set('attackRollVisibility', 'none')
  settings.set('challengeVisibility', 'none')
  const atThree = await attackMessage(9, three)
  assert.deepEqual(results(atThree), [['Goblin', null, null], ['Orc', null, null], ['Ogre', null, null]], 'Follow, Hide all: nothing')
  assert.deepEqual(await always(true, results)(atThree), [['Goblin', 'miss', null], ['Orc', 'hit', null], ['Ogre', 'hit', null]],
    MIDI ? "dnd5e's own attack in a Midi world, at three targets" : 'every target')
  assert.ok((await always(true, targetsOf)(atThree)).every(target => !('ac' in target)), 'no armor class')
  const saveOfAlways = always(true, message => told(message).dnd5e.save)
  const fromGm = await saveFrom(await saveCard(goblin, 'gm'), orc, 5)
  assert.deepEqual(await saveOfAlways(fromGm), { target: 'Actor.orc', outcome: 'failure' }, "a save from the Gamemaster's card, to everyone")
  const fromAlice = await saveFrom(await saveCard(thorin, 'alice'), orc, 5)
  assert.deepEqual(await saveOfAlways(fromAlice), { target: 'Actor.orc', outcome: 'failure' }, 'to everyone, with no readers')
  assert.deepEqual(await saveOfAlways(await saveFrom(gmCard, orc, 15, { flags: { 'midi-qol': { obscureRoll: true } } })), { target: 'Actor.orc' }, 'obscured: nothing')
  assert.ok(!(await always(true, told)(gmCard)).content.includes('data-dc'), 'no DC on its buttons')
  settings.set('attackRollVisibility', 'hideAC')
  if (MIDI) {
    for (const check of ['whisper', 'gmOnly']) {
      await withMidiNow({ autoCheckHit: check }, async () => {
        const card = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags, whisper: ['gm'] })
        assert.deepEqual(outcomes(card), [null, null, null], `${check}, Follow`)
        assert.deepEqual(await always(true, outcomes)(card), ['hit', 'miss', null], `${check}, Always`)
      })
    }
    // Option B: Auto Check Hits none at several targets, each by the armor class Midi writes on its
    // card, total cover a miss; at one, as before, by its d20's target.
    await withMidiNow({ autoCheckHit: 'none' }, async () => {
      const two = await midiCardOf({ targets: [descriptor(goblin, 20), descriptor(orc, 15), descriptor(bat, null)], rolls: [await attackRoll()], flags: { ...hitFlags, hitTargetUuids: [], targets: [] } })
      assert.deepEqual(outcomes(two), [null, null, null], 'Follow: Midi checked nothing')
      assert.deepEqual(await always(true, outcomes)(two), ['miss', 'hit', 'miss'], 'Always: option B')
      assert.deepEqual(await gm(true, outcomes)(two), ['miss', 'hit', 'miss'], 'GM-only details: option B')
      const single = await midiCardOf({ targets: [descriptor(goblin, 15)], rolls: [await d20(14, { midi: true, target: 15 })], flags: { ...hitFlags, hitTargetUuids: [], targets: [] } })
      const { serializeMessage: before } = await import(`${OLD}/scripts/chat-data.mjs`)
      settings.set('gmContent', true)
      try {
        assert.equal(JSON.stringify(serializeMessage(single, campaign)), JSON.stringify(before(single, campaign)), "one target: GM-only details as 0.30.0's, byte for byte")
      } finally { settings.set('gmContent', false) }
      assert.deepEqual(await always(true, outcomes)(single), ['hit'])
    })
    const blind = await midiCardOf({ author: 'alice', by: thorin, whisper: ['gm'], blind: true, targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
    assert.equal(await always(true, () => isAudienceShared(chatAudience(blind, campaign)))(), false, 'a blind card: never sent')
  }
  for (const [key, value] of saved) settings.set(key, value)
  ok(`Always, GM-only details off: every message above told again under it (${twins} times), each outcome, save and check as GM-only details tells it, with no armor class, nothing of an obscured roll, and all else as Follow; dnd5e's attack at three targets${MIDI ? " in a Midi world, Midi's hits under whisper and gmOnly, option B at several targets (one as 0.30.0's), a blind card never sent" : ''}; saves to everyone; no DC`)
}
/** Run with these Midi-QOL settings, then put each back. */
async function withMidiNow(changes, fn) {
  const before = { ...midiSettings }
  Object.assign(midiSettings, changes)
  try { return await fn() } finally { Object.assign(midiSettings, before) }
}
message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
if (!MIDI) {
  assert.deepEqual(results(message), [['Goblin', null, null], ['Orc', null, null], ['Bat', null, null]])
  assert.deepEqual(await gm(true, results)(message), [['Goblin', null, null], ['Orc', null, null], ['Bat', null, null]])
  ok("without Midi-QOL, whose settings can't be read, its card tells nothing it decided, Gamemaster-only information on or off")
  await alwaysCases()
  console.log('dnd5e: done')
  process.exit(0)
}

assert.deepEqual(results(message), [['Goblin', 'hit', null], ['Orc', 'miss', null], ['Bat', null, null]])
// Midi's Challenge Mode Armor: a total that meets a target's EC but not its AC is a hit, which Midi
// damages (Workflow.ts:7319, 7356, 2578) and records in hitECTargetUuids alone (748-749).
message = await midiCardOf({
  targets: [descriptor(goblin), descriptor(orc)], rolls: [await attackRoll()],
  flags: { ...hitFlags, hitTargetUuids: [], hitECTargetUuids: [tok.orc], targets: [{ uuid: tok.goblin }, { uuid: tok.orc }] },
})
assert.deepEqual(results(message).map(r => r[1]), ['miss', 'hit'], 'a hit only through EC')
ok("Midi's card says whom its attack hit and missed, by its tokens taken for their actors, once it has checked and with Auto Check Hits all, a hit through EC alone a hit; nothing for a token since deleted")

for (const [fields, why] of [
  [{ flags: { ...hitFlags, GMOnlyAttackRoll: true } }, 'written before Midi checked'],
  [{ flags: { ...hitFlags, GMOnlyAttackRoll: undefined } }, 'not marked checked'],
  [{ flags: { ...hitFlags, obscureRoll: true } }, 'obscured'],
  [{ rolls: [] }, 'a use with no attack, every target listed as hit'],
]) {
  message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags, ...fields })
  assert.deepEqual(results(message).map(r => r[1]), [null, null, null], why)
}
for (const check of ['none', 'whisper']) {
  midiSettings.autoCheckHit = check
  message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
  assert.deepEqual(results(message).map(r => r[1]), [null, null, null], check)
}
midiSettings.autoCheckHit = 'all'
message = await midiCardOf({
  targets: [descriptor(goblin), descriptor(orc)], rolls: [await attackRoll()],
  flags: { ...hitFlags, targets: [{ uuid: tok.goblin }, { uuid: tok.goblin2 }, { uuid: tok.orc }] },
})
assert.deepEqual(results(message).map(r => r[1]), [null, 'miss'], 'two goblins of one actor, one hit')
// §3.7 F2 (flipped from 0.29.0's "a card players can't all read or see"): Midi draws hits for every
// reader of its card, whispers or not (§1a M6, M7), so a whispered card tells them. A blind one is
// told too, but never sent: no player reads it.
for (const [fields, why] of [[{ whisper: ['gm'] }, 'whispered'], [{ blind: true, whisper: ['gm'] }, 'blind']]) {
  message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags, ...fields })
  assert.deepEqual(results(message).map(r => r[1]), ['hit', 'miss', null], why)
}
assert.equal(isAudienceShared(chatAudience(message, campaign)), false, 'a blind card is never sent')
ok("nothing of Midi's hits before it has checked, unmarked, obscured, Auto Check Hits none or whisper, a use with no attack, or for an actor whose tokens came out differently; a whispered card tells them, as Midi draws them for every reader (F2), and a blind one is never sent")

midiSettings.autoCheckHit = 'whisper'
message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags, whisper: ['gm'] })
assert.deepEqual((await gm(true, results)(message)).map(r => r[1]), ['hit', 'miss', null])
midiSettings.autoCheckHit = 'none'
// Module 0.31.0 option B (flipped from "not checked"): where Midi checks no hits, each target is
// judged by the armor class Midi writes on its card, the Goblin, Orc and Bat's 15 against 19.
assert.deepEqual((await gm(true, results)(message)).map(r => r[1]), ['hit', 'hit', 'hit'], 'not checked: by each armor class')
midiSettings.autoCheckHit = 'all'
message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: { ...hitFlags, GMOnlyAttackRoll: true } })
assert.deepEqual((await gm(true, results)(message)).map(r => r[1]), [null, null, null], 'written before it checked')
ok("with Gamemaster-only information on, Midi's hits are sent whispered, but still only once it has checked them")

// Saves, as Midi's displaySaves writes them (Workflow.ts:4991-5018).
const saveFlags = { messageType: 'saves', saveUuids: [tok.goblin], failedSaveUuids: [tok.orc] }
const saveTargets = [descriptor(goblin, 15, true), descriptor(orc, 15, false), descriptor(ogre, 15, false)]
settings.set('challengeVisibility', 'all')
const saveCardOf = (fields = {}) => midiCardOf({ targets: saveTargets, flags: saveFlags, ...fields })
message = await saveCardOf()
assert.deepEqual(results(message), [['Goblin', null, 'success'], ['Orc', null, 'failure'], ['Ogre', null, null]])
ok("Midi's card says who saved and who failed, by the tokens it records, once it has shown its saves; nothing for a target it decided nothing of")

// SaveToChatCard writes every target as failed before anyone rolls, with no `saved` (Workflow.ts:430-432, 3431-3440).
message = await midiCardOf({ targets: [descriptor(goblin), descriptor(orc)], flags: { messageType: 'saves', saveUuids: [], failedSaveUuids: [tok.goblin, tok.orc] } })
assert.deepEqual(results(message).map(r => r[2]), [null, null])
assert.deepEqual((await gm(true, results)(message)).map(r => r[2]), [null, null], 'nor with Gamemaster-only information on')
// Shown again, `saved` as it was (Workflow.ts:4994-4995): the sets say what Midi now decided.
message = await midiCardOf({ targets: [descriptor(goblin, 15, true), descriptor(orc, 15, true)], flags: { messageType: 'saves', saveUuids: [tok.goblin], failedSaveUuids: [tok.orc] } })
assert.deepEqual(results(message).map(r => r[2]), ['success', 'failure'])
ok("nothing of Midi's saves before it has shown them, whatever it seeded; and shown again, what its sets say, not a stale `saved`")

const spell = spells.get('goblin').get('blast')
// §3.7 F3 (flipped): Midi draws its card's saves by the world's Auto Check Saves alone (CMM:696),
// the activity's own Save Display shaping only the workflow; and with no whisper test.
for (const [own, global, expected] of [
  ['default', 'all', 'success'], ['default', 'allNoRoll', 'success'], ['default', 'allShow', 'success'], ['default', 'whisper', null],
  ['allShow', 'whisper', null], ['whisper', 'all', 'success'], ['gmOnly', 'all', 'success'], ['all', 'none', null], ['default', 'gmOnly', null],
]) {
  spell.saveDisplay = own
  midiSettings.autoCheckSaves = global
  assert.equal(results(await saveCardOf())[0][2], expected, `${own} ${global}`)
}
spell.saveDisplay = 'default'
midiSettings.autoCheckSaves = 'all'
assert.equal(results(await saveCardOf({ whisper: ['gm'] }))[0][2], 'success', 'whispered: told, as Midi draws it for every reader')
assert.equal(results(await saveCardOf({ flags: { ...saveFlags, obscureRoll: true } }))[0][2], null, 'obscured')
ok("Midi's saves are told where its Auto Check Saves shows players whether they saved, whatever the activity's own Save Display, never with Auto Check Saves none, whisper or gmOnly; whispered or not (F3); never obscured")

// Challenge Visibility for Midi's card: its speaker's, and an NPC target's only under Show all.
const mixed = { targets: [descriptor(vex, 15, true), descriptor(orc, 15, false)], flags: { messageType: 'saves', saveUuids: [tok.vex], failedSaveUuids: [tok.orc] } }
settings.set('challengeVisibility', 'player')
// §3.7 F3 (flipped, §1a M11): Midi keys each result on its target, not the card's speaker: a player
// character's save shows on an NPC's card under Show only from other players.
assert.deepEqual(results(await midiCardOf({ ...mixed })).map(r => r[2]), ['success', null], "an NPC's card: the player character's told, the NPC's withheld")
assert.deepEqual(results(await midiCardOf({ ...mixed, by: thorin, author: 'gm' })).map(r => r[2]), ['success', null], "a player character's card: the NPC's withheld")
settings.set('challengeVisibility', 'all')
assert.deepEqual(results(await midiCardOf({ ...mixed })).map(r => r[2]), ['success', 'failure'], 'Show all')
settings.set('challengeVisibility', 'none')
assert.deepEqual(results(await midiCardOf({ ...mixed, by: thorin })).map(r => r[2]), [null, null], 'None')
settings.set('challengeVisibility', 'player')
spell.saveDisplay = 'whisper'
assert.deepEqual((await gm(true, results)(await midiCardOf({ ...mixed, whisper: ['gm'] }))).map(r => r[2]), ['success', 'failure'], 'Gamemaster-only information on')
spell.saveDisplay = 'default'
midiSettings.autoCheckSaves = 'none'
assert.deepEqual((await gm(true, results)(await midiCardOf({ ...mixed }))).map(r => r[2]), [null, null], 'not checked')
midiSettings.autoCheckSaves = 'all'
ok("Midi's saves follow Challenge Visibility for each target, a player character's under Show all or Show only from other players, an NPC's only under Show all, whoever's card it is (F3); with Gamemaster-only information on, all are told, but only once checked")

// ---- Module 0.30.0: Midi-QOL's rows of the audit, as §1a settles them from Midi v14's source ----
/** Run with these Midi-QOL settings, then put each back. */
async function withMidi(changes, fn) {
  const before = { ...midiSettings }
  Object.assign(midiSettings, changes)
  try { return await fn() } finally {
    for (const key of Object.keys(midiSettings)) if (!(key in before)) delete midiSettings[key]
    Object.assign(midiSettings, before)
  }
}
/** Midi's attack, its d20 given a target where the card has one, as dnd5e gives it. */
const midiAttack = (natural, { target, bonus = 5 } = {}) => d20(natural, { midi: true, bonus, target })
/** Midi's card at one target, the Goblin (AC 15), after Midi checked: hit or missed as `isHit` says. */
const oneTarget = async ({ natural = 14, target = 15, author = 'gm', by = goblin, flags = {}, targets = [descriptor(orc, 15)], ...fields } = {}) => midiCardOf({
  author, by, targets, rolls: [await midiAttack(natural, { target })],
  flags: { GMOnlyAttackRoll: false, hitTargetUuids: [], hitECTargetUuids: [], targets: [{ uuid: tok.orc }], isHit: true, ...flags }, ...fields,
})
const outcomes = message => results(message).map(r => r[1])
const saves = message => results(message).map(r => r[2])
await withSettings({ attackRollVisibility: 'hideAC', challengeVisibility: 'player' }, async () => {

  // M1-M3: the hits section.
  await withMidi({ autoCheckHit: 'all' }, async () => {
    message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
    assert.deepEqual(outcomes(message), ['hit', 'miss', null], 'Show only results')
    await withSettings({ attackRollVisibility: 'all' }, () => assert.deepEqual(outcomes(message), ['hit', 'miss', null], 'Show results & target ACs'))
    await withSettings({ attackRollVisibility: 'none' }, () => assert.deepEqual(outcomes(message), [null, null, null], 'Hide all'))
  })
  row('M1', "Midi's hits section is told under Auto Check Hits all with Attack Result Visibility showing results, and no longer under Hide all, which strips it (H1, flipped)")

  for (const check of ['whisper', 'gmOnly']) {
    await withMidi({ autoCheckHit: check }, async () => {
      message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
      assert.deepEqual(outcomes(message), [null, null, null], check)
    })
  }
  row('M2', 'Auto Check Hits whisper or gmOnly tells nothing: its rows have no result, or no section')

  await withMidi({ autoCheckHit: 'none' }, async () => {
    message = await midiCardOf({ targets: [descriptor(goblin), descriptor(orc)], rolls: [await attackRoll()], flags: { ...hitFlags, targets: [{ uuid: tok.goblin }, { uuid: tok.orc }] } })
    assert.deepEqual(outcomes(message), [null, null])
  })
  row('M3', "Midi draws no dnd5e tray on its card: at two targets under Auto Check Hits none, nothing")

  // A7: dnd5e's own attack while Midi is active.
  assert.deepEqual(outcomes(await attackMessage(12, [descriptor(goblin, 12), descriptor(orc, 20)])), [null, null], 'two targets')
  // §3.7 F7: one target, by the card, whatever its d20 has: one at two whose d20 has a target anyway.
  const aimedAtTwo = await attackMessage(12, [descriptor(goblin, 12), descriptor(orc, 20)])
  aimedAtTwo.rolls[0].dice[0].options.target = 12
  assert.deepEqual(outcomes(aimedAtTwo), [null, null], 'two targets, though its d20 has one')
  assert.deepEqual(outcomes(await attackMessage(12, [descriptor(goblin, 12)])), ['hit'], 'one, whose d20 has its armor class')
  assert.deepEqual(outcomes(await attackMessage(5, [descriptor(goblin, 12)])), ['miss'])
  assert.deepEqual(outcomes(await attackMessage(12, [descriptor(goblin, null)])), [null], 'total cover gives the d20 no target')
  await withMidi({ highlightSuccess: false }, async () => assert.deepEqual(outcomes(await attackMessage(12, [descriptor(goblin, 12)])), [null], 'highlight off'))
  await withMidi({ highLightCriticalAttackOnly: true }, async () => assert.deepEqual(outcomes(await attackMessage(12, [descriptor(goblin, 12)])), [null], 'critical only'))
  faces.push(3, 4)
  const tens = await ChatMessage.create({
    author: 'alice', speaker: speakerOf(thorin), rolls: [await new CONFIG.Dice.D20Roll('2d10 + 5', {}, { target: 12, rollType: 'attack' }).evaluate()],
    flags: { dnd5e: { roll: { type: 'attack' }, targets: [descriptor(goblin, 12)] } },
  })
  assert.deepEqual(outcomes(tens), [null], "a 2d10 in the d20's place, which dnd5e doesn't mark")
  const counted = await attackMessage(12, [descriptor(goblin, 12)])
  counted.rolls[0].dice[0].results[0].success = true
  assert.deepEqual(outcomes(counted), [null], 'a die counting successes')
  row('A7', "with Midi active, dnd5e's own attack is told only at one target, by dnd5e's highlight of its total against its d20's target, while Midi keeps it: never at two, under total cover, with Color code off or Only highlight critical on, or of a die dnd5e doesn't mark (F7)")

  // M4: H2, the attack total's highlight, at one target.
  await withMidi({ autoCheckHit: 'none' }, async () => {
    const card = () => oneTarget({ author: 'alice', by: thorin, natural: 14 })
    assert.deepEqual(outcomes(await card()), ['hit'], "a player's card")
    assert.deepEqual(outcomes(await oneTarget({ author: 'alice', by: thorin, natural: 3 })), ['miss'])
    await withMidi({ highLightCriticalAttackOnly: true }, async () => assert.deepEqual(outcomes(await card()), [null], 'critical only'))
    await withSettings({ attackRollVisibility: 'none' }, async () => assert.deepEqual(outcomes(await card()), [null], 'Hide all'))
    const two = await oneTarget({ author: 'alice', by: thorin, targets: [descriptor(orc), descriptor(goblin)], target: null })
    assert.deepEqual(outcomes(two), [null, null], 'two targets')
    // §1a H2: one target, by the card, whatever its d20 has.
    assert.deepEqual(outcomes(await oneTarget({ author: 'alice', by: thorin, targets: [descriptor(orc), descriptor(goblin)] })), [null, null], 'two targets, though its d20 has one')
    await withSettings({ attackRollVisibility: 'none' }, async () => assert.deepEqual(await gm(true, outcomes)(await card()), ['hit'], 'Gamemaster-only information on'))
  })
  row('M4', "Midi's attack total at one target is told as its highlight reads it, under Auto Check Hits none, Show only results and Color code on, for every reader; not with Only highlight critical on, under Hide all, or at two targets; with Gamemaster-only information on, whatever its settings (H2)")

  // M5: H3, the Gamemaster's words.
  await withMidi({ autoCheckHit: 'none', gmAttackDisplay: 'hitMiss' }, () => withSettings({ attackRollVisibility: 'none' }, async () => {
    assert.deepEqual(outcomes(await oneTarget({ flags: { isHit: true } })), ['hit'], 'hits')
    assert.deepEqual(outcomes(await oneTarget({ natural: 18, flags: { isHit: false } })), ['miss'], 'misses, as isHit says')
    await withMidi({ autoCheckHit: 'whisper' }, async () => assert.deepEqual(outcomes(await oneTarget()), [null], 'only the GM sees results'))
    assert.deepEqual(outcomes(await oneTarget({ targets: [descriptor(orc), descriptor(goblin)] })), [null, null], 'two targets: about the card')
    assert.deepEqual(outcomes(await oneTarget({ target: null, flags: { isHit: false } })), [null], 'none with no d20 target: isSuccess decides nothing')
    assert.deepEqual(outcomes(await oneTarget({ author: 'alice', by: thorin })), [null], "a player's card: no words")
    await withMidi({ gmAttackDisplay: 'hidden' }, () => withSettings({ attackRollVisibility: 'hideAC' }, async () => {
      assert.deepEqual(outcomes(await oneTarget()), [null], 'Hidden: no words, and no H2')
    }))
    await withMidi({ gmAttackDisplay: 'hitMissCrit' }, async () => {
      assert.deepEqual(outcomes(await oneTarget({ natural: 3, flags: { isHit: false, isCritical: true } })), ['hit'], 'critically hits')
      assert.deepEqual(outcomes(await oneTarget({ natural: 18, flags: { isHit: true, isFumble: true } })), ['miss'], 'badly misses')
    })
  }))
  row('M5', "a Gamemaster's card at one target under Hit/Miss Only or Hit/Miss/Critical/Fumble tells the word Midi writes in place of the total, whatever Attack Result Visibility; never under only the GM sees results, at two targets, under Auto Check Hits none with no d20 target, on a player's card, or under Hidden (H3)")

  await withMidi({ autoCheckHit: 'all' }, async () => {
    const self = await midiCardOf({ author: 'alice', by: thorin, whisper: ['alice'], targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
    assert.deepEqual(outcomes(self), ['hit', 'miss', null])
    assert.deepEqual(chatAudience(self, campaign).characters, ['thorin'])
  })
  row('M6', "a player's Self Roll card tells its author its hits, and goes to them alone (F2)")

  await withMidi({ autoCheckHit: 'all' }, async () => {
    const privateGm = await midiCardOf({ author: 'alice', by: thorin, whisper: ['gm'], targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
    assert.deepEqual(outcomes(privateGm), ['hit', 'miss', null])
    assert.deepEqual(chatAudience(privateGm, campaign).characters, ['thorin'], "told to its author's characters")
    const blind = await midiCardOf({ author: 'alice', by: thorin, whisper: ['gm'], blind: true, targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
    assert.equal(isAudienceShared(chatAudience(blind, campaign)), false, 'blind: never sent')
  })
  row('M7', "a player's Private GM card tells its author its hits; a blind one is never sent (F2)")

  await withMidi({ gmAttackDisplay: 'hideFormula' }, async () => {
    const card = await oneTarget()
    const [attack] = told(card).rolls
    assert.equal(attack.formula, '')
    assert.deepEqual(attack.dice, [])
    assert.ok(Number.isFinite(attack.total))
    assert.ok(told(await oneTarget({ author: 'alice', by: thorin })).rolls[0].formula.length, "a player's card is untouched")
  })
  row('M8', "a Gamemaster's roll on Midi's card is trimmed as GM Attack Roll Display shows it to players (F6; gmrolls.mjs has the rest)")

  // Saves on Midi's card, by their targets.
  const both = { targets: [descriptor(vex, 15, true), descriptor(orc, 15, false)], flags: { messageType: 'saves', saveUuids: [tok.vex], failedSaveUuids: [tok.orc] } }
  assert.deepEqual(saves(await midiCardOf({ ...both, by: thorin, author: 'alice' })), ['success', null], 'a player caster')
  row('M9', "Midi's card tells a player character's save under Show only from other players (F3)")
  assert.deepEqual(saves(await midiCardOf({ ...both, by: thorin, author: 'alice' })), ['success', null])
  await withSettings({ challengeVisibility: 'all' }, async () => assert.deepEqual(saves(await midiCardOf({ ...both })), ['success', 'failure']))
  row('M10', "an NPC target's save only under Show all (F3)")
  assert.deepEqual(saves(await midiCardOf({ ...both, by: goblin, author: 'gm' })), ['success', null])
  row('M11', "the Gamemaster's card tells a player character's save under Show only from other players, as Midi keys it on the target (F3, flipped)")
  await withSettings({ challengeVisibility: 'none' }, async () => assert.deepEqual(saves(await midiCardOf({ ...both, by: thorin })), [null, null]))
  row('M12', 'Challenge Visibility Hide all tells no save on Midi\'s card')

  // M13, M14, M17: dnd5e's saves rolled from Midi's card, and Midi's per-target ones.
  const gmMidiCard = await midiCardOf({ targets: [descriptor(thorin)], flags: { messageType: 'saves' } })
  const aliceMidiCard = await midiCardOf({ by: thorin, author: 'alice', targets: [descriptor(orc)], flags: { messageType: 'saves' } })
  await withSettings({ challengeVisibility: 'all' }, async () => {
    assert.deepEqual(saveOf(await rollOf({ card: gmMidiCard })), thorinTold, "with its DC, from the Gamemaster's card")
    assert.deepEqual(saveOf(await rollOf({ card: gmMidiCard, target: null })), thorinOnly, 'without its DC')
    await withMidi({ highlightSuccess: false }, async () => assert.deepEqual(saveOf(await rollOf({ card: gmMidiCard })), thorinOnly, 'Color code off'))
    await withMidi({ highLightCriticalAttackOnly: true }, async () => assert.deepEqual(saveOf(await rollOf({ card: gmMidiCard })), thorinOnly, 'critical only'))
  })
  await withSettings({ challengeVisibility: 'player' }, async () => {
    assert.deepEqual(saveOf(await rollOf({ card: gmMidiCard })), thorinOnly, "the Gamemaster's card, under player")
    assert.deepEqual(saveOf(await rollOf({ card: aliceMidiCard, who: orc, author: 'gm' })), told0, "a player's card")
  })
  row('M13', "Midi's per-target save with its DC is told by its card's author, as dnd5e highlights it, only while Midi keeps that highlight (F1); without its DC, its creature alone")

  await withMidi({ autoCheckSaves: 'none' }, () => withSettings({ challengeVisibility: 'player' }, async () => {
    assert.deepEqual(saveOf(await rollOf({ card: aliceMidiCard, who: orc, author: 'gm' })), told0, "dnd5e's button on a player's card")
    assert.deepEqual(saveOf(await rollOf({ card: gmMidiCard })), thorinOnly, "on the Gamemaster's")
  }))
  row('M14', "under Auto Check Saves none, a save from dnd5e's button on Midi's card is told by the card's author (F1)")

  assert.deepEqual(saves(await midiCardOf({ ...both, flags: { ...both.flags, obscureRoll: true } })), [null, null])
  assert.deepEqual(saveOf(await rollOf({ card: gmMidiCard, flags: { 'midi-qol': { obscureRoll: true } } })), thorinOnly)
  row('M15', 'a card or save Midi shows as ?? tells nothing')

  const nobody = await ChatMessage.create({ author: 'gm', speaker: { actor: null, alias: 'Trap' }, content: '', flags: { 'midi-qol': { ...both.flags }, dnd5e: { targets: both.targets } } })
  assert.deepEqual(saves(nobody), ['success', null])
  row('M16', 'a card with no speaker tells a player character\'s save under Show only from other players (F3)')

  const midiRequest = await requestBy('gm')
  messages.delete(midiRequest.id)
  assert.deepEqual(saveOf(await rollOf({ card: midiRequest })), thorinTold, 'its request deleted: the roll itself')
  row('M17', "Midi's chat request, deleted once rolled, leaves the roll its own origin: its roller's (F1)")

  await withMidi({ autoCheckHit: 'all' }, async () => {
    message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: { ...hitFlags, messageType: 'hits' } })
    assert.deepEqual(outcomes(message), ['hit', 'miss', null], 'any kind of Midi card, one card')
  })
  row('M18', "Midi has no separate hits or saves cards: every card of its, whatever its kind, is told by the same rules")

  await withMidi({ autoCheckHit: 'all' }, async () => {
    message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: { ...hitFlags, GMOnlyAttackRoll: true } })
    assert.deepEqual(outcomes(message), [null, null, null], 'hits written before Midi checked')
    message = await midiCardOf({ targets: [descriptor(goblin), descriptor(orc)], flags: { messageType: 'saves', saveUuids: [], failedSaveUuids: [tok.goblin, tok.orc] } })
    assert.deepEqual(saves(message), [null, null], 'saves seeded before anyone rolled')
  })
  row('P2', 'what Midi writes before it checks tells nothing')

  // §1a's own cases.
  await withMidi({ autoCheckHit: 'all' }, async () => {
    message = await midiCardOf({ targets: [descriptor(goblin), descriptor(orc)], rolls: [await attackRoll()], flags: { ...hitFlags, isCritical: true, hitTargetUuids: [tok.goblin], targets: [{ uuid: tok.goblin }, { uuid: tok.orc }] } })
    assert.deepEqual(outcomes(message), ['hit', null], 'a critical: the Orc under total cover, drawn hit, is told nothing')
  })
  row('§1a H1', "on a critical card Midi draws every row hit, so a target it didn't count as hit is told nothing")

  await withMidi({ autoCheckHit: 'none' }, () => withSettings({ challengeVisibility: 'player' }, async () => {
    const nobodySave = await rollOf({ card: nobody })
    assert.deepEqual(saveOf(nobodySave), thorinOnly, "a save from the Gamemaster's card with no speaker, under player")
  }))
  midiState.throws = true
  message = await midiCardOf({ targets: hitTargets, rolls: [await attackRoll()], flags: hitFlags })
  assert.deepEqual(outcomes(message), [null, null, null], "Midi's settings unreadable: no hits")
  assert.deepEqual(saves(await midiCardOf({ ...both })), [null, null], 'nor saves')
  assert.deepEqual(saveOf(await rollOf({ card: aliceSaveCard })), thorinOnly, "nor dnd5e's highlight, which Midi's settings decide")
  midiState.throws = false
  row('unreadable', "with Midi's settings unreadable, nothing Midi decides is told, nor dnd5e's highlight it may strip")

  await withSettings({ challengeVisibility: 'player' }, async () => {
    const toBob = await rollOf({ author: 'bob', who: vex, card: aliceRequest, whisper: ['bob'] })
    assert.deepEqual(saveOf(toBob), { target: 'Actor.vex', outcome: 'success' })
    assert.deepEqual(chatAudience(toBob, campaign).characters, ['vex'], 'never told to Thorin')
  })
  row('whispered', 'a save whispered to another player is never told to the first')
})

await alwaysCases()
console.log('midi: done')
process.exit(0)
