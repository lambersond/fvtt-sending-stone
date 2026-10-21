// What Foundry says of itself for a campaign (module 0.30.0, its contract §2.5-§2.6, §3.6): the
// hello's `settings`, and `bridge.settings` when one of the settings it says changes, to an app
// that says it reads them. Its exact shape, by an allowlist that never holds a secret, an address or
// a token; dnd5e's and Midi-QOL's settings in their own words; and the verdict, by the same rules as
// the chat gates (verdict.mjs). X=1 without Midi-QOL, MIDI=1 with it. The world is results-world.mjs.
// Run with --import ./unref-timers.mjs --import ./dnd5e-register.mjs.
//
// Module 0.31.0 (its contract §2.7, §4.7.5): the campaign's `transfers` row after `manualDice`, and
// the world's `chatResults` after `chatScope`, which sends one bridge.settings when it changes, no
// hello.
import assert from 'node:assert/strict'
import {
  MIDI, midiLanguage, midiSettings, ok, settings, start, users, withMidi, withSettings, words
} from './results-world.mjs'
import { actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
// The app: it answers each post with the features set for it now; a hello it holds on its way until
// it's let go.
const app = { features: null, posts: [], hold: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
const settle = () => new Promise(resolve => setTimeout(resolve, 30))
const fetch = async (url, init) => {
  const envelope = JSON.parse(init.body)
  if (app.hold && (envelope.type === 'bridge.hello')) { const held = app.hold; app.hold = null; await held }
  app.posts.push(envelope)
  return app.features ? json({ features: app.features }) : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
}
settings.set('attackRollVisibility', 'hideAC')
settings.set('challengeVisibility', 'player')
await start({ fetch })
await settle()
const { foundrySettings } = await import(`${MODULE}/scripts/foundry-settings.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const campaign = () => getCampaigns()[0]
const take = type => app.posts.splice(0).filter(envelope => envelope.type === type)

// ---- The hello's ----
let [hello] = take('bridge.hello')
assert.ok(hello, 'a hello')
let sent = hello.data.settings
assert.deepEqual(sent, foundrySettings(campaign()), "the hello's settings")
assert.deepEqual(Object.keys(sent), ['format', 'modules', 'sections', 'results'])
assert.equal(sent.format, 1)
for (const module of sent.modules) {
  assert.deepEqual(Object.keys(module), ['id', 'title', 'version', 'active'])
  assert.ok(['midi-qol', 'lib-wrapper', 'manual-dice', 'combat-focus'].includes(module.id))
}
assert.deepEqual(sent.modules.map(module => [module.id, module.active]), [...(MIDI ? [['midi-qol', true]] : []), ['lib-wrapper', false]], 'only those installed, in order, with whether each is active')
assert.ok(!sent.modules.some(module => module.id === 'sending-stone'), "Sending Stone's own is the hello's `module`")
for (const section of sent.sections) {
  assert.deepEqual(Object.keys(section), ['id', 'title', 'rows'])
  for (const row of section.rows) {
    assert.ok(Object.keys(row).every(key => ['id', 'label', 'value', 'text', 'note'].includes(key)), JSON.stringify(row))
    assert.ok(['boolean', 'string', 'number'].includes(typeof row.value) || (row.value === null), JSON.stringify(row))
    assert.ok((typeof row.label === 'string') && (typeof row.text === 'string') && row.text.length)
  }
}
for (const line of sent.results) {
  assert.deepEqual(Object.keys(line), ['id', 'state', 'text'])
  assert.ok(['shown', 'partial', 'hidden'].includes(line.state))
}
ok('the hello says what Foundry says of itself in its exact shape: format 1, the modules Sending Stone works with that are installed, sections of rows, and what players see')

// ---- Sections ----
const sectionsOf = value => value.sections.map(section => section.id)
assert.deepEqual(sectionsOf(sent), ['campaign', 'sending-stone', 'dnd5e', ...(MIDI ? ['midi-qol'] : [])])
const rowsOf = (value, id) => value.sections.find(section => section.id === id)?.rows.map(row => row.id)
assert.deepEqual(rowsOf(sent, 'campaign'), ['rolls', 'attacks', 'prompts', 'manualDice', 'transfers', 'groups'])
assert.deepEqual(rowsOf(sent, 'sending-stone'), ['chatEvents', 'chatScope', 'chatResults', 'combatEvents', 'gmContent', ...(MIDI ? ['midiIntegration', 'offCanvasTargets'] : [])])
assert.deepEqual(rowsOf(sent, 'dnd5e'), ['attackRollVisibility', 'challengeVisibility'])
assert.equal(sent.sections[0].title, 'This campaign')
assert.equal(sent.sections[1].title, 'Sending Stone, for every campaign')
assert.equal(sent.sections[2].title, game.system.title)
game.system.id = 'pf2e'
const other = foundrySettings(campaign())
assert.deepEqual(sectionsOf(other), ['campaign', 'sending-stone', ...(MIDI ? ['midi-qol'] : [])], 'another system: no dnd5e section')
assert.deepEqual(other.results.map(line => line.id), ['system'])
game.system.id = 'dnd5e'
// dnd5e 6's summary cards, read in this browser.
const version = game.system.version
game.system.version = '6.0.5'
game.settings.settings.set('dnd5e.chatCardSummary', { name: 'SETTINGS.DND5E.SUMMARIZECHAT.Name', scope: 'client', default: true })
words['SETTINGS.DND5E.SUMMARIZECHAT.Name'] = 'Summary Chat Cards'
settings.set('chatCardSummary', true)
const six = foundrySettings(campaign())
assert.deepEqual(six.sections.find(section => section.id === 'dnd5e').rows[2], { id: 'chatCardSummary', label: 'Summary Chat Cards (this browser)', value: true, text: 'On' })
game.system.version = version
game.settings.settings.delete('dnd5e.chatCardSummary')
ok(`each section where it belongs: this campaign's, every campaign's, dnd5e's under it alone, with its summary cards as this browser has them under dnd5e 6${MIDI ? ', and Midi-QOL\'s' : ''}`)

// ---- In their own words ----
const row = (value, section, id) => value.sections.find(s => s.id === section).rows.find(r => r.id === id)
assert.deepEqual(row(sent, 'dnd5e', 'attackRollVisibility'), { id: 'attackRollVisibility', label: 'Attack Result Visibility', value: 'hideAC', text: 'Show only results' })
assert.deepEqual(row(sent, 'dnd5e', 'challengeVisibility'), { id: 'challengeVisibility', label: 'Challenge Visibility', value: 'player', text: 'Show only from other players' })
await withSettings({ challengeVisibility: undefined }, () => {
  assert.deepEqual(row(foundrySettings(campaign()), 'dnd5e', 'challengeVisibility'), { id: 'challengeVisibility', label: 'Challenge Visibility', value: null, text: '—' }, 'unset')
})
assert.deepEqual(row(sent, 'campaign', 'rolls'), { id: 'rolls', label: 'Players roll in the app', value: false, text: 'Off' })
assert.deepEqual(row(sent, 'campaign', 'groups'), { id: 'groups', label: 'Party sheets', value: 0, text: 'None' })
assert.deepEqual(row(sent, 'sending-stone', 'chatScope'), { id: 'chatScope', label: 'Which messages', value: 'all', text: 'All its players can read' })
assert.deepEqual(row(sent, 'sending-stone', 'gmContent'), { id: 'gmContent', label: 'GM-only details', value: false, text: 'Off' })
assert.deepEqual(row(sent, 'sending-stone', 'chatResults'), { id: 'chatResults', label: 'Hit/miss and save results in the app', value: 'foundry', text: "Follow Foundry's visibility settings" })
await withSettings({ chatResults: 'always' }, () => {
  assert.deepEqual(row(foundrySettings(campaign()), 'sending-stone', 'chatResults'), { id: 'chatResults', label: 'Hit/miss and save results in the app', value: 'always', text: 'Always show them to players' })
})
assert.deepEqual(row(sent, 'campaign', 'transfers'), { id: 'transfers', label: 'Players move items and coins', value: false, text: 'Off' })
await withSettings({ campaigns: [{ ...settings.get('campaigns')[0], transfers: true }] }, () => {
  assert.deepEqual(row(foundrySettings(campaign()), 'campaign', 'transfers'), { id: 'transfers', label: 'Players move items and coins', value: true, text: 'On' })
  game.system.id = 'pf2e'
  assert.equal(row(foundrySettings(campaign()), 'campaign', 'transfers').note, words['SENDINGSTONE.Config.Actions.RollsReason.system'])
  game.system.id = 'dnd5e'
})
// A note on why a switch that's on does nothing here.
await withSettings({ campaigns: [{ ...settings.get('campaigns')[0], rolls: true, manualDice: true }] }, async () => {
  const { diceStatus } = await import(`${MODULE}/scripts/dice-plan.mjs`)
  const before = { ...diceStatus }
  Object.assign(diceStatus, { ready: false, reason: 'self-test' })
  const value = foundrySettings(campaign())
  Object.assign(diceStatus, before)
  assert.equal(row(value, 'campaign', 'rolls').note, words['SENDINGSTONE.Config.Actions.RollsReason.self-test'])
  assert.equal(row(value, 'campaign', 'manualDice').note, words['SENDINGSTONE.Config.Actions.ManualDice.missing'])
})
ok("dnd5e's settings in dnd5e's own words, read from how it registers them; the module's in its own; a value that isn't there a dash; and a note where a switch that's on can't do what it says here")

if (MIDI) {
  const MIDI_LABELS = {
    autoCheckHit: 'Auto check if attack hits target', autoCheckSaves: 'Auto check Saves', gmAttackDisplay: 'GM Attack Roll Display',
    gmDamageDisplay: 'GM Damage Roll Display', highlightSuccess: 'Color code Hit/Miss/Save Display',
    highLightCriticalAttackOnly: 'Only highlight critical/fumble hits', playerRollSaves: 'Prompt Players to Roll Saves',
    rollNPCSaves: 'Prompt GM to Roll Saves (Unlinked)', rollNPCLinkedSaves: 'Prompt GM to Roll Saves (Linked)',
    rollSavesBlind: 'Which ability saves are rolled blind', rollChecksBlind: 'Which ability checks are rolled blind',
    rollSkillsBlind: 'Which skill checks are rolled blind', blindRollDisplay: 'Blind roll display',
    showGM: 'GM Sees all whispered messages', ReplaceDefaultActivities: 'Replace dnd5e activities with midi-qol equivalents',
    ForceHideRoll: 'Really Hide private/blind/self-rolls (this browser)', EnableWorkflow: 'Enable roll automation support (this browser)',
  }
  const midiRows = sent.sections.find(section => section.id === 'midi-qol').rows
  assert.equal(sent.sections.find(section => section.id === 'midi-qol').title, 'Midi-QOL')
  assert.deepEqual(Object.fromEntries(midiRows.map(r => [r.id, r.label])), MIDI_LABELS, "Midi's own labels, exactly")
  assert.deepEqual(row(sent, 'midi-qol', 'autoCheckHit'), { id: 'autoCheckHit', label: MIDI_LABELS.autoCheckHit, value: 'none', text: 'None' })
  assert.deepEqual(row(sent, 'midi-qol', 'autoCheckSaves').text, 'Off')
  assert.deepEqual(row(sent, 'midi-qol', 'rollNPCSaves').text, 'Auto')
  assert.deepEqual(row(sent, 'midi-qol', 'highlightSuccess'), { id: 'highlightSuccess', label: MIDI_LABELS.highlightSuccess, value: true, text: 'On' })
  assert.deepEqual(row(sent, 'midi-qol', 'rollSavesBlind'), { id: 'rollSavesBlind', label: MIDI_LABELS.rollSavesBlind, value: 0, text: 'None' })
  await withMidi({ rollChecksBlind: 'all', rollSkillsBlind: ['prc', 'ste'] }, () => {
    const value = foundrySettings(campaign())
    assert.deepEqual([row(value, 'midi-qol', 'rollChecksBlind').text, row(value, 'midi-qol', 'rollSkillsBlind').text], ['All', 'prc, ste'])
  })
  assert.deepEqual(row(sent, 'midi-qol', 'showGM'), { id: 'showGM', label: MIDI_LABELS.showGM, value: null, text: '—' })
  midiLanguage(false)
  const raw = foundrySettings(campaign())
  assert.deepEqual([row(raw, 'midi-qol', 'autoCheckHit').text, row(raw, 'midi-qol', 'gmAttackDisplay').text], ['none', 'full'], "without Midi's language, as stored")
  midiLanguage(true)
  // The verdict's reasons name Midi's settings by those labels too.
  await withMidi({ autoCheckHit: 'all' }, () => withSettings({ attackRollVisibility: 'none' }, () => {
    const line = foundrySettings(campaign()).results.find(l => l.id === 'midiHits')
    assert.equal(line.text, "Hit and miss on Midi-QOL's cards: hidden (Auto check if attack hits target: Check - all see result; Attack Result Visibility: Hide all)")
  }))
  ok("Midi-QOL's rows each by Midi's own label, its choices in Midi's own words where its language has them, else as stored; lists All, None or their ids; and the verdict's reasons by the same labels")
}

// ---- The verdict ----
const ids = value => value.results.map(line => line.id)
assert.deepEqual(ids(sent), MIDI ? ['hits', 'midiHits', 'saves', 'checks', 'midiSaves', 'gmRolls'] : ['hits', 'saves', 'checks'])
assert.ok(sent.results.length <= 6)
ok(`the results are the verdict's lines, ${MIDI ? 'with the Gamemaster\'s rolls among them, six in all' : 'without the Gamemaster\'s rolls of Midi-QOL'}`)

// ---- Nothing secret, by construction ----
const allowed = new Set(['format', 'modules', 'sections', 'results', 'id', 'title', 'version', 'active', 'rows', 'label', 'value', 'text', 'note', 'state'])
const keysOf = (value, keys = new Set()) => {
  if (Array.isArray(value)) value.forEach(entry => keysOf(entry, keys))
  else if (value && (typeof value === 'object')) for (const [key, entry] of Object.entries(value)) { keys.add(key); keysOf(entry, keys) }
  return keys
}
for (const value of [sent, foundrySettings(campaign())]) {
  const text = JSON.stringify(value)
  for (const secret of ['emberfall-secret', 'old-legacy-secret', 'stone.example', 'https://']) assert.ok(!text.includes(secret), secret)
  assert.ok([...keysOf(value)].every(key => allowed.has(key)), [...keysOf(value)].join(' '))
  assert.ok(!text.includes('midiPromptWait') && !text.includes(users.get('gm').id + '"'), 'no wait, no bridge')
}
ok("never a secret, the legacy secret, the app's address, or any key outside the allowlist")

// ---- bridge.settings ----
const watched = key => Hooks.callAll('updateSetting', { key })
// An app that doesn't read them is sent none.
await watched('dnd5e.challengeVisibility')
await settle()
assert.equal(take('bridge.settings').length, 0, "an app that doesn't read them")
// It starts to, in a hello's answer: the hello said them, and nothing more goes.
app.features = { settings: 1 }
settings.set('campaigns', [...settings.get('campaigns')])
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
announce()
await settle()
assert.equal(take('bridge.hello').length, 1)
await watched('dnd5e.challengeVisibility')
await settle()
assert.equal(take('bridge.settings').length, 0, "a watched setting stored as it was: nothing new to say, the hello's recorded as sent")
// A real change goes once.
settings.set('challengeVisibility', 'all')
await watched('dnd5e.challengeVisibility')
await watched('dnd5e.challengeVisibility')
await settle()
let changes = take('bridge.settings')
assert.equal(changes.length, 1, 'one change, one post')
assert.equal(changes[0].sequence !== null, true, 'sequenced')
assert.equal(row(changes[0].data.settings, 'dnd5e', 'challengeVisibility').value, 'all')
assert.deepEqual(Object.keys(changes[0].data), ['settings'])
// An unrelated setting, of Midi's or anyone's, sends nothing.
await withMidi({ autoTarget: 'always' }, async () => {
  await watched('midi-qol.ConfigSettings')
  await settle()
})
await watched('core.messageMode')
await settle()
assert.equal(take('bridge.settings').length, 0, "an unrelated change to Midi's settings, or another setting")
// The bridge alone sends.
users.get('gm').isActiveGM = false
settings.set('challengeVisibility', 'none')
await watched('dnd5e.challengeVisibility')
await settle()
assert.equal(take('bridge.settings').length, 0, 'a client that is not the bridge')
users.get('gm').isActiveGM = true
await watched('dnd5e.challengeVisibility')
await settle()
assert.equal(take('bridge.settings').length, 1, 'the bridge again')
if (MIDI) {
  // Sending Stone's own Allow targets off your screen has no onChange, and is now watched.
  settings.set('offCanvasTargets', true)
  await watched('sending-stone.offCanvasTargets')
  await settle()
  changes = take('bridge.settings')
  assert.equal(changes.length, 1, 'offCanvasTargets noticed')
  assert.equal(row(changes[0].data.settings, 'sending-stone', 'offCanvasTargets').value, true)
  await withMidi({ gmAttackDisplay: 'hidden' }, async () => {
    await watched('midi-qol.ConfigSettings')
    await settle()
  })
  assert.equal(take('bridge.settings').length, 1, "a change to one of Midi's shown settings")
}
// Module 0.31.0: Hit/miss and save results in the app, Always, has no onChange: noticed as watched,
// one bridge.settings with its row and the Always verdict, and no hello.
settings.set('chatResults', 'always')
await watched('sending-stone.chatResults')
await watched('sending-stone.chatResults')
await settle()
changes = take('bridge.settings')
assert.equal(changes.length, 1, 'chatResults noticed, once')
assert.equal(row(changes[0].data.settings, 'sending-stone', 'chatResults').value, 'always')
assert.ok(changes[0].data.settings.results.find(line => line.id === 'saves').text.endsWith('(Hit/miss and save results in the app: Always show them to players)'))
assert.equal(take('bridge.hello').length, 0, 'no hello')
settings.delete('chatResults')
await watched('sending-stone.chatResults')
await settle()
assert.equal(take('bridge.settings').length, 1, 'and back')
ok(`bridge.settings goes to an app that reads them, once per real change to a watched setting${MIDI ? ', Allow targets off your screen and Midi\'s among them' : ''}, Hit/miss and save results in the app among them, with no hello; never when nothing it says changed, from the bridge alone; the hello's settings count as sent`)

// ---- An app deployed mid-session: a heartbeat's answer turning it on sends them once ----
app.features = null
announce()
await settle()
take('bridge.hello')
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const realNow = Date.now
Date.now = () => realNow() + 60_000
app.features = { settings: 1 }
heartbeat()
await settle()
assert.equal(take('bridge.settings').length, 1, 'turned on by a heartbeat')
Date.now = () => realNow() + 120_000
heartbeat()
await settle()
assert.equal(take('bridge.settings').length, 0, 'once')
Date.now = realNow
ok("an app that starts to read them in a heartbeat's answer, as one deployed mid-session, is sent them at once, and once")

// ---- A watched setting changed while the hello is on its way ----
// The hello says them as they were when it was queued; a change before it's answered follows it,
// once, to an app that read them, and to one whose answer to that hello is the first to say so.
const { helloPending } = await import(`${MODULE}/scripts/transport.mjs`)
const challengeIn = value => row(value, 'dnd5e', 'challengeVisibility').value
for (const [why, before] of [['an app that read them', { settings: 1 }], ['an app whose answer to the hello first says it reads them', null]]) {
  app.features = before
  announce()
  await settle()
  take('bridge.hello')
  app.features = { settings: 1 }
  let release
  app.hold = new Promise(resolve => { release = resolve })
  announce()
  await settle()
  assert.ok(helloPending('camp-a'), 'the hello on its way')
  const was = settings.get('challengeVisibility')
  const now = (was === 'all') ? 'player' : 'all'
  settings.set('challengeVisibility', now)
  await watched('dnd5e.challengeVisibility')
  await settle()
  assert.equal(app.posts.filter(e => e.type === 'bridge.settings').length, 0, 'not while the hello is on its way')
  release()
  await settle()
  const posts = app.posts.splice(0)
  const at = type => posts.findIndex(e => e.type === type)
  assert.equal(challengeIn(posts[at('bridge.hello')].data.settings), was, 'the hello says them as they were')
  const after = posts.filter(e => e.type === 'bridge.settings')
  assert.equal(after.length, 1, why)
  assert.ok(at('bridge.settings') > at('bridge.hello'), 'after the hello')
  assert.equal(challengeIn(after[0].data.settings), now)
}
announce()
await settle()
assert.equal(take('bridge.settings').length, 0, 'a hello whose settings are still so: nothing after it')
ok('a watched setting changed while the hello is on its way, which says them as they were, follows it in one bridge.settings, to an app that read them and to one whose answer to that hello first says so; nothing follows a hello still right')

// ---- The campaign's groups, by name ----
game.documentTypes = { Actor: ['character', 'npc', 'group'] }
const group = (id, name) => {
  const made = { documentName: 'Actor', id, name, type: 'group', uuid: `Actor.${id}`, img: null, ownership: { default: 0 }, system: { members: [] }, getUserLevel: () => 0 }
  actors.set(id, made)
  return made
}
const company = group('company', 'The Company')
const unlisted = group('unlisted', 'Elsewhere')
settings.set('campaigns', settings.get('campaigns').map(c => ({ ...c, groups: ['company'] })))
announce()
await settle()
assert.deepEqual(row(take('bridge.hello')[0].data.settings, 'campaign', 'groups'), { id: 'groups', label: 'Party sheets', value: 1, text: 'The Company' })
company.name = 'The Band'
await Hooks.callAll('updateActor', company, { name: 'The Band' })
await settle()
changes = take('bridge.settings')
assert.equal(changes.length, 1, 'a listed group renamed')
assert.deepEqual(row(changes[0].data.settings, 'campaign', 'groups').text, 'The Band')
await Hooks.callAll('updateActor', company, { system: { currency: { gp: 3 } } })
unlisted.name = 'Far Away'
await Hooks.callAll('updateActor', unlisted, { name: 'Far Away' })
await settle()
assert.equal(take('bridge.settings').length, 0, "another change to it, or a group the campaign doesn't list renamed")
actors.delete('company')
await Hooks.callAll('deleteActor', company)
await settle()
changes = take('bridge.settings')
assert.equal(changes.length, 1, 'a listed group deleted')
assert.deepEqual(row(changes[0].data.settings, 'campaign', 'groups'), { id: 'groups', label: 'Party sheets', value: 0, text: 'None' })
ok("the campaign's groups among them by name: a group it lists renamed or deleted sends bridge.settings; another change, or another group, nothing")

console.log(MIDI ? 'midi: done' : 'dnd5e: done')
process.exit(0)
