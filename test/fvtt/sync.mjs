// Big parties and smaller sheets (module 0.22.0, its contract §9 H1–H13): the hello as roster and state,
// each sheet in a post of its own once it's answered; what the app says it takes of sheets; the
// size of every post; slim format 1; and posts lost to failures that might not last, sent again.
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { actor, settings, user, users } from './stub.mjs'
import { ACTION_KEYS, expandSheet } from './slim-expand.mjs'

const MODULE = process.env.MODULE_DIR
const ok = msg => console.log('ok -', msg)
let now = Date.parse('2026-10-13T20:00:00Z')
Date.now = () => now
const advance = ms => { now += ms }
const realSetTimeout = globalThis.setTimeout
// A failed post is retried after 1 s and 3 s: here at once. Everything else waits as it would.
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, [1_000, 3_000].includes(ms) ? 1 : ms, ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
const size = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value))
foundry.utils.getProperty = (object, path) => path.split('.').reduce((o, key) => o?.[key], object)

// ---- The world ----
CONFIG.DND5E = {
  abilities: Object.fromEntries(['str', 'dex'].map(id => [id, { label: `DND5E.Ability${id}`, abbreviation: id.toUpperCase() }])),
  skills: { ath: { label: 'Athletics' } },
}
// Poisoned's rules: one description, the same for everyone poisoned.
CONFIG.statusEffects = [{ id: 'poisoned', name: 'Poisoned', img: 'poisoned.svg', reference: 'Compendium.dnd5e.rules.JournalEntryPage.poisoned' }]
globalThis.fromUuid = async uuid => ({ uuid, text: { content: '<p>A poisoned creature has disadvantage.</p>' } })
foundry.applications.ux.TextEditor = { implementation: { enrichHTML: async html => html } }
const warnings = []
ui.notifications.warn = message => warnings.push(message)
ui.notifications.info = () => {}
// What the module logs, kept rather than printed, so that a failing check is what's shown.
const logged = []
console.warn = console.error = (...args) => logged.push(args.map(String).join(' '))

users.activeGM = user('gm', 'Gamemaster', true)
user('alice', 'Alice'); user('bob', 'Bob'); user('cara', 'Cara')
const ability = (value, mod) => ({ value, mod, proficient: 0, checkBonus: 0, checkProf: { term: '0', flat: 0 }, save: { value: mod, roll: { mode: 0 } }, check: { roll: { mode: 0 } } })
const character = (id, name, owner, bio) => {
  const a = actor(id, name, [owner], 'character', { value: 30, max: 40, temp: 0 })
  a.documentName = 'Actor'
  a.statuses = new Set(['poisoned'])
  a.system = {
    abilities: { str: ability(14, 2), dex: ability(12, 1) },
    skills: { ath: { ability: 'str', total: 2, passive: 12, prof: { multiplier: 0 }, roll: { mode: 0 } } },
    attributes: { hp: { value: 30, max: 40, temp: 0 }, ac: { value: 15 }, prof: 2, init: { total: 1 }, movement: { walk: 30, speed: 30, units: 'ft' } },
    details: { level: 3, biography: { value: bio }, appearance: '' },
  }
  return a
}
const thorin = character('thorin', 'Thorin', 'alice', '<p>A dwarf of Erebor.</p>')
const vex = character('vex', 'Vex', 'bob', '<p>A tiefling of Mirkwood.</p>')
// Grim's sheet can't be described: his system data is broken.
const grim = actor('grim', 'Grim', ['cara'])
grim.documentName = 'Actor'
Object.defineProperty(grim, 'system', { get() { throw new Error('a broken actor') } })

// ---- The app ----
// It answers each post as its rules for the moment say, and holds what a listener holds: each
// campaign's descriptions since its hello, and its sheets, expanded where slim. A sheet that refers
// to a description it doesn't have is answered with a resend, as the app does.
const app = { events: [], fetched: 0, rules: [], features: null, featuresOnUpdate: false, texts: new Map(), sheets: new Map(), resends: 0, wanted: [] }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
const answer = status => ({ ok: (status >= 200) && (status < 300), status, statusText: '', headers: new Headers() })
const HASH = /^[0-9a-f]{14}$/
const refsOf = (value, refs = new Set()) => {
  if (Array.isArray(value)) value.forEach(v => refsOf(v, refs))
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (['text', 'biography'].includes(key) && typeof v === 'string' && HASH.test(v)) refs.add(v)
      else refsOf(v, refs)
    }
  }
  return refs
}
function take(envelope) {
  const campaign = envelope.campaign?.id
  if (envelope.type === 'bridge.hello') {
    app.texts.set(campaign, new Set())
    for (const key of app.sheets.keys()) if (key.startsWith(`${campaign}.`)) app.sheets.delete(key)
  }
  if (envelope.type === 'character.texts') for (const hash of Object.keys(envelope.data.texts)) app.texts.get(campaign)?.add(hash)
  if (envelope.type !== 'character.updated') return null
  const { sheet, ...entry } = envelope.data.character
  const full = expandSheet(sheet)
  const missing = [...refsOf(full)].filter(hash => !app.texts.get(campaign)?.has(hash))
  if (missing.length) {
    app.resends++
    return 'hello'
  }
  app.sheets.set(`${campaign}.${entry.id}`, { ...entry, sheet: full })
  return null
}
globalThis.fetch = async (url, init) => {
  const envelope = JSON.parse(init.body)
  app.fetched++
  const rule = app.rules.find(r => (r.times ?? 1) > 0 && r.test(envelope))
  if (rule) {
    if (rule.times !== undefined) rule.times--
    if (rule.hold) await rule.hold
  }
  const status = rule?.status ?? 204
  const event = { ...envelope, status, bytes: size(init.body) }
  app.events.push(event)
  if (status >= 300) return answer(status)
  const resend = rule?.resend ?? take(envelope)
  const answers = ['bridge.hello', 'bridge.heartbeat'].includes(envelope.type) || (app.featuresOnUpdate && (envelope.type === 'character.updated'))
  const features = rule?.features ?? (answers ? app.features : null)
  if (!features && !resend) return answer(204)
  event.status = 200
  return json({ ...(features && { features }), ...(resend && { resend }) })
}
// What the next matching posts get, `times` times (always, without): answered with `status`, after
// `hold` resolves, and with `features` or `resend`.
const when = (test, rule) => { const r = { test, ...rule }; app.rules.push(r); return r }
const isType = (type, id) => e => (e.type === type) && ((id === undefined) || (e.data.character?.id === id))
const held = () => { let release; const hold = new Promise(resolve => { release = resolve }); return { hold, release } }
const since = from => app.events.slice(from)
const describe = e => `${e.type} ${e.campaign?.title ?? '-'}${e.data?.character ? ` ${e.data.character.id}` : ''}`
const until = async (test, what, ms = 4000) => {
  const end = performance.now() + ms
  while (!test()) {
    if (performance.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
const quiet = () => wait(60)

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
const { characterSheet } = await import(`${MODULE}/scripts/sheet.mjs`)
const { slimSheet } = await import(`${MODULE}/scripts/sheet-slim.mjs`)
const transport = await import(`${MODULE}/scripts/transport.mjs`)
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { sendCharacter } = await import(`${MODULE}/scripts/character-sync.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const featuresHeard = []
Hooks.on('sendingStone.listenerFeatures', (id, features) => featuresHeard.push([id, features]))

settings.set('listenerUrl', 'https://stone.example')
settings.set('campaigns', [
  { id: 'camp-a', title: 'Ashlands', characters: ['thorin', 'vex'] },
  { id: 'camp-b', title: 'Mirkwood', characters: ['grim', 'vex'] },
])
const ashlands = () => getCampaigns().find(c => c.id === 'camp-a')
// The module's own check every 10 seconds is left to the harness, which moves the time itself.
const realSetInterval = globalThis.setInterval
globalThis.setInterval = () => 0
await Hooks.callAll('ready')
globalThis.setInterval = realSetInterval
await until(() => app.events.filter(isType('character.updated')).length >= 4, 'the sheets after the hellos')
await quiet()

// ---- H1: the hello lists the characters, without their sheets ----
const first = app.events
const hellos = first.filter(e => e.type === 'bridge.hello')
assert.deepEqual(hellos.map(e => e.campaign.title), ['Ashlands', 'Mirkwood'])
assert.equal(first[0].type, 'bridge.hello', 'nothing before the hello')
for (const hello of hellos) {
  assert.equal(hello.data.sheetsApart, true)
  for (const c of hello.data.characters) {
    assert.deepEqual(Object.keys(c), ['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice'])
    assert.equal(c.manualDice, false, 'since 0.32.0, whether its player may enter its dice results in the app: no stand-in user here has Make Manual Rolls')
  }
}
assert.deepEqual(hellos[0].data.characters.map(c => [c.id, c.uuid, c.name, c.img, c.type, c.owners]), [
  ['thorin', 'Actor.thorin', 'Thorin', 'thorin.webp', 'character', [{ id: 'alice', name: 'Alice' }]],
  ['vex', 'Actor.vex', 'Vex', 'vex.webp', 'character', [{ id: 'bob', name: 'Bob' }]],
])
assert.deepEqual(hellos[1].data.characters.map(c => c.id), ['grim', 'vex'])
// Module 0.30.0 (its contract §2.2): the hello also lists the campaign's groups and its settings.
// Changed on purpose (round 0.36.0 §4.1): and the characters' companions.
assert.deepEqual(Object.keys(hellos[0].data).sort(), ['bridge', 'characters', 'combats', 'companions', 'config', 'features', 'foundry', 'groups', 'module', 'prompts', 'settings', 'sheetsApart', 'system'])
// Grim's sheet, which can't be described, goes as none, and costs Vex nothing.
const mirkwood = first.filter(e => e.campaign.id === 'camp-b').map(describe)
assert.deepEqual(mirkwood.filter(d => d.startsWith('character.updated')), ['character.updated Mirkwood grim', 'character.updated Mirkwood vex'])
const grimSent = first.find(e => isType('character.updated', 'grim')(e)).data.character
assert.deepEqual(grimSent, { id: 'grim', uuid: 'Actor.grim', name: 'Grim', img: 'grim.webp', type: 'character', owners: [{ id: 'cara', name: 'Cara' }], manualDice: false, sheet: null })
// Since 0.32.0 character.updated says whether its player may enter its dice results, after its owners.
assert.deepEqual(Object.keys(grimSent), ['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice', 'sheet'])
ok("H1: bridge.hello says sheetsApart and lists each character as {id, uuid, name, img, type, owners}, nothing before it; a sheet that can't be described goes as null, the others after it")

// ---- H2: once answered, each character's descriptions, then its sheet ----
const ash = first.filter(e => e.campaign.id === 'camp-a')
assert.deepEqual(ash.map(describe), ['bridge.hello Ashlands', 'character.texts Ashlands', 'character.updated Ashlands thorin', 'character.texts Ashlands', 'character.updated Ashlands vex'])
const thorinUpdate = ash[2]
assert.equal(JSON.stringify(thorinUpdate.data.character.sheet), JSON.stringify(characterSheet(thorin)))
assert.equal(thorinUpdate.sequence, ash[0].sequence + 1)
assert.deepEqual([ash[1].sequence, ash[3].sequence], [null, null])
const poisoned = thorinUpdate.data.character.sheet.conditions[0].text
const thorinBio = thorinUpdate.data.character.sheet.details.biography
const vexBio = ash[4].data.character.sheet.details.biography
assert.deepEqual(Object.keys(ash[1].data.texts).sort(), [poisoned, thorinBio].sort())
assert.deepEqual(Object.keys(ash[3].data.texts), [vexBio], "Vex's texts: only what Ashlands wasn't sent already")
assert.equal(app.resends, 0)
ok("H2: an answered hello is followed by each character's descriptions, then its sheet, in roster order, the sheet as built, each description once")

// ---- H3: a refused hello is followed by nothing; asked for, it's sent with its sheets ----
let from = app.events.length
when(isType('bridge.hello'), { status: 404, times: 1 })
announce({ campaignId: 'camp-a' })
await quiet()
assert.deepEqual(since(from).map(e => `${describe(e)} ${e.status}`), ['bridge.hello Ashlands 404'])
await wait(300)
assert.deepEqual(since(from).length, 1)
from = app.events.length
when(e => (e.type === 'bridge.heartbeat') && (e.campaign.id === 'camp-a'), { resend: 'hello', times: 1 })
advance(30_000)
heartbeat()
await until(() => since(from).filter(isType('character.updated')).length >= 2, 'the sheets after the hello asked for')
await quiet()
assert.deepEqual(since(from).filter(e => e.campaign.id === 'camp-a').map(describe), [
  'bridge.heartbeat Ashlands', 'bridge.hello Ashlands', 'character.texts Ashlands', 'character.updated Ashlands thorin', 'character.texts Ashlands', 'character.updated Ashlands vex',
])
ok("H3: a hello refused (404) is followed by nothing; asked for in a heartbeat's answer, the hello goes again, every description and sheet after it")

// ---- H4: two hellos queued, the first's answer held open ----
from = app.events.length
const firstHello = held()
when(isType('bridge.hello'), { hold: firstHello.hold, times: 1 })
announce({ campaignId: 'camp-a' })
await wait(300)
announce({ campaignId: 'camp-a' })
await quiet()
assert.deepEqual(since(from).map(describe), [])
firstHello.release()
await until(() => since(from).filter(isType('character.updated')).length >= 4, 'the sheets after both hellos')
await quiet()
const afterBoth = since(from).filter(e => e.campaign.id === 'camp-a').map(describe)
assert.deepEqual(afterBoth.slice(0, 2), ['bridge.hello Ashlands', 'bridge.hello Ashlands'])
// After the second, every character's descriptions and sheet, whatever went after the first.
const afterSecond = afterBoth.slice(afterBoth.lastIndexOf('bridge.hello Ashlands') + 1)
assert.deepEqual(afterSecond.slice(-4), ['character.texts Ashlands', 'character.updated Ashlands thorin', 'character.texts Ashlands', 'character.updated Ashlands vex'])
assert.equal(app.resends, 0)
assert.deepEqual([...app.sheets.keys()].filter(k => k.startsWith('camp-a.')).sort(), ['camp-a.thorin', 'camp-a.vex'])
ok('H4: two hellos queued while the first is unanswered are each followed by every description and sheet; the app ends holding them all')

// ---- H5: a change while the hello is on its way rides with it ----
from = app.events.length
const pending = held()
when(isType('bridge.hello'), { hold: pending.hold, times: 1 })
announce({ campaignId: 'camp-a' })
await quiet()
assert.equal(transport.helloPending('camp-a'), true)
thorin.system.attributes.hp.value = 12
await Hooks.callAll('updateActor', thorin, { system: { attributes: { hp: { value: 12 } } } })
await wait(400)
assert.deepEqual(since(from).filter(e => e.campaign.id === 'camp-a').map(describe), [], 'nothing of Thorin alone while the hello is pending')
// Mirkwood, whose hello isn't pending, has no Thorin to be told of.
pending.release()
await until(() => since(from).filter(isType('character.updated')).length >= 2, 'the sheets after the hello')
await quiet()
const ridden = since(from).filter(isType('character.updated', 'thorin'))
assert.equal(ridden.length, 1)
assert.equal(ridden[0].data.character.sheet.hp.value, 12)
assert.equal(transport.helloPending('camp-a'), false)
ok("H5: a character changed while its campaign's hello is pending isn't sent alone; the sheet after the hello has the change")

// ---- H6: an app that expands slim sheets is sent them slim ----
from = app.events.length
app.features = { commands: true, slimSheets: 1, maxBytes: 4_000_000 }
app.featuresOnUpdate = true
announce({ campaignId: 'camp-a' })
await until(() => since(from).filter(isType('character.updated')).length >= 2, 'the slim sheets')
await quiet()
await quiet()
// The hello's answer, which also changes what the app takes, is followed by its burst alone: not
// by every sheet again for the change.
assert.deepEqual(since(from).map(describe), ['bridge.hello Ashlands', 'character.texts Ashlands', 'character.updated Ashlands thorin', 'character.texts Ashlands', 'character.updated Ashlands vex'])
const slimSent = since(from).filter(isType('character.updated'))
assert.ok(slimSent.every(e => e.data.character.sheet.slim === 1))
assert.deepEqual(expandSheet(slimSent[0].data.character.sheet), JSON.parse(JSON.stringify(characterSheet(thorin))))
assert.deepEqual(transport.termsOf('camp-a'), { slimSheets: 1, maxBytes: 4_000_000 })
assert.deepEqual(transport.termsOf('camp-b'), { slimSheets: null, maxBytes: 1_000_000 }, "Mirkwood's app hasn't said")
assert.equal(app.resends, 0)
ok("H6: answered {features: {commands, slimSheets: 1, maxBytes: 4000000}}, the hello's sheets go slim, each once, and expand to the sheets as built")

// ---- H7: what the app takes changes ----
// Rolled back to an app that doesn't expand them: a slim update answered 204 sends every character again, full, at once.
from = app.events.length
app.features = null
app.featuresOnUpdate = false
thorin.system.attributes.hp.value = 13
sendCharacter('thorin')
await until(() => since(from).filter(isType('character.updated')).length >= 3, 'every sheet again')
await quiet()
let sheets = since(from).filter(e => e.campaign.id === 'camp-a').filter(isType('character.updated'))
assert.deepEqual(sheets.map(e => [e.data.character.id, e.data.character.sheet.slim ?? 'full']), [['thorin', 1], ['thorin', 'full'], ['vex', 'full']])
assert.deepEqual(transport.termsOf('camp-a'), { slimSheets: null, maxBytes: 1_000_000 })
// The app says it expands them again, in a heartbeat's answer, as in every answer since: every
// character again, slim.
from = app.events.length
app.features = { commands: true, slimSheets: 1, maxBytes: 4_000_000 }
app.featuresOnUpdate = true
advance(30_000)
heartbeat()
await until(() => since(from).filter(isType('character.updated')).length >= 2, 'every sheet again, slim')
await quiet()
sheets = since(from).filter(e => e.campaign.id === 'camp-a').filter(isType('character.updated'))
assert.deepEqual(sheets.map(e => [e.data.character.id, e.data.character.sheet.slim ?? 'full']), [['thorin', 1], ['vex', 1]])
// A heartbeat's answer without slimSheets: full again.
from = app.events.length
app.features = { commands: true }
advance(30_000)
heartbeat()
await until(() => since(from).filter(isType('character.updated')).length >= 4, 'every sheet again, full')
await quiet()
assert.deepEqual(since(from).filter(e => e.campaign.id === 'camp-a').filter(isType('character.updated')).map(e => [e.data.character.id, e.data.character.sheet.slim ?? 'full']), [['thorin', 'full'], ['vex', 'full']])
// The answer to a character's update, which says nothing of commands, is read for sheets alone:
// slim sheets, said there, send every character again, slim.
const heard = featuresHeard.length
app.features = { slimSheets: 1, maxBytes: 4_000_000 }
from = app.events.length
thorin.system.attributes.hp.value = 14
sendCharacter('thorin')
await until(() => since(from).filter(isType('character.updated')).length >= 3, 'every sheet again, slim')
await quiet()
assert.deepEqual(since(from).map(e => `${describe(e)} ${e.data.character.sheet.slim ?? 'full'}`), [
  'character.updated Ashlands thorin full', 'character.updated Ashlands thorin 1', 'character.updated Ashlands vex 1',
])
assert.equal(featuresHeard.length, heard, "no answer but a hello's or heartbeat's is read for commands")
// Nothing is sent again while a hello is on its way, which they follow anyway: here an update's
// answer, 204, says full sheets while a hello waits behind it.
app.features = { commands: true }
app.featuresOnUpdate = false
from = app.events.length
const queued = held()
when(isType('character.updated', 'thorin'), { hold: queued.hold, times: 1 })
thorin.system.attributes.hp.value = 15
sendCharacter('thorin')
await quiet()
announce({ campaignId: 'camp-a' })
assert.equal(transport.helloPending('camp-a'), true)
queued.release()
await until(() => since(from).filter(isType('character.updated')).length >= 3, 'the sheets after the hello')
await quiet()
assert.deepEqual(since(from).filter(e => e.campaign.id === 'camp-a').map(describe), [
  'character.updated Ashlands thorin', 'bridge.hello Ashlands', 'character.texts Ashlands', 'character.updated Ashlands thorin', 'character.texts Ashlands', 'character.updated Ashlands vex',
])
ok('H7: an update answered 204 by an app rolled back, or a heartbeat answered without slimSheets, sends every character again full at once; said again, slim; nothing again while a hello is pending; commands read only from hellos and heartbeats')

// ---- H8: slim format 1, rule by rule ----
const part = (formula, type, healing = false) => ({ formula, type, healing })
const use = (id, type, targets = {}) => ({ id, type, targets: { self: false, area: false, count: null, perLevel: null, affects: null, ...targets } })
const NO_ROLLS = { toHit: null, attackId: null, activity: null, attackModes: null, ammunition: null, save: null, damage: [] }
const entry = (id, name, type, fields) => ({ id, name, type, activation: null, activationType: null, range: null, target: null, ...NO_ROLLS, uses: null, ...fields })
const itemRow = (id, name, type, fields = {}) => ({
  id, name, img: `${id}.webp`, type, quantity: 1, weight: null, price: null, equipped: null, attunement: null, attuned: false,
  uses: null, rarity: null, properties: [], identified: true, text: null, ...fields,
})
const rollsAs = (lead, activities) => ({
  activation: lead.activation, range: lead.range, target: lead.target, concentration: false,
  ...Object.fromEntries(Object.keys(NO_ROLLS).map(key => [key, lead[key]])), ...(activities && { activities }),
})
const charges = { value: 3, max: 7, recovery: 'Dawn' }
const strike = entry('strike', 'Strike', 'attack', { activation: 'Action', activationType: 'action', range: 'reach 5 ft', target: '1 Creature', toHit: 5, attackId: 'strike', damage: [part('1d6 + 2', 'Bludgeoning')] })
const barbs = entry('barbs', 'Silvery Barbs', 'cast', {
  activation: 'Reaction', activationType: 'reaction', range: '60 ft', target: '1 Creature', activity: use('barbs', 'utility', { count: 1, affects: 'creature' }),
  spellId: 'barbs-copy', cast: { level: 1, concentration: false, charges: 1, short: false, text: 'c0000000000001' }, uses: charges,
})
const asAction = (row, lead, fields = {}) => ({
  id: row.id, name: row.name, img: row.img, type: row.type, activation: lead.activation, activationType: lead.activationType, range: lead.range,
  target: lead.target, ...Object.fromEntries(Object.keys(NO_ROLLS).map(key => [key, lead[key]])), uses: row.uses, level: null, castFrom: null,
  concentration: false, identified: true, text: row.text, ...fields,
})
// A staff, equipped, that strikes as an action and casts Silvery Barbs as a reaction; another,
// unequipped, listed only for the spell it casts; a sword not identified yet; a potion in a bag of
// holding in a backpack; rope, which rolls nothing; an empty pouch.
const staff = { ...itemRow('staff', 'Staff of Barbs', 'weapon', { equipped: true, uses: charges, text: 'a0000000000001' }), ...rollsAs(strike, [strike, barbs]) }
const strike2 = { ...strike, id: 'strike2', attackId: 'strike2' }
const barbs2 = { ...barbs, id: 'barbs2', activity: use('barbs2', 'utility', { count: 1, affects: 'creature' }) }
const spare = { ...itemRow('spare', 'Spare Staff', 'weapon', { equipped: false, uses: charges, text: 'a0000000000002' }), ...rollsAs(strike2, [strike2, barbs2]) }
const strange = itemRow('strange', 'Strange Sword', 'weapon', { equipped: true, identified: false, text: 'a0000000000003' })
const drink = use('drink', 'heal', { self: true })
const potion = { ...itemRow('potion', 'Potion of Healing', 'consumable', { quantity: 2, uses: { value: 1, max: 1, recovery: null }, text: 'a0000000000004' }), ...rollsAs({ activation: 'Action', range: null, target: null, ...NO_ROLLS, activity: drink, damage: [part('2d4 + 2', 'Healing', true)] }) }
const bag = { ...itemRow('bag', 'Bag of Holding', 'container', { text: 'a0000000000005' }), capacity: { value: 1, max: 500, units: 'lb' }, contents: [potion] }
const rope = itemRow('rope', 'Rope', 'loot', { quantity: 50, weight: { value: 10, units: 'lb' } })
const backpack = { ...itemRow('backpack', 'Backpack', 'container'), capacity: null, contents: [rope, bag] }
const pouch = { ...itemRow('pouch', 'Pouch', 'container', { equipped: false }), capacity: { value: 0, max: 6, units: 'lb' }, contents: [] }
const spell = (id, name, fields) => ({
  id, name, img: `${id}.webp`, level: 0, school: 'Evocation', components: 'V, S', materials: null, concentration: false, ritual: false,
  activation: '1 Action', range: '120 ft', duration: null, target: null, prepared: null, uses: null, castFrom: null, text: null, ...fields,
})
const bolt = spell('bolt', 'Fire Bolt', { ...NO_ROLLS, toHit: 6, attackId: 'bolt-attack', damage: [part('2d10', 'Fire')], text: 'b0000000000001' })
const detect = spell('detect', 'Detect Magic', { level: 1, prepared: 0, ritual: true, school: 'Divination', text: 'b0000000000002' })
const surge = { id: 'surge', name: 'Action Surge', img: 'surge.webp', kind: 'Class Feature', requirements: 'Fighter 2', activation: '1 Free Action', passive: false, uses: { value: 1, max: 1, recovery: 'Short Rest' },
  range: null, target: null, concentration: false, ...NO_ROLLS, activity: use('surge', 'utility', { self: true }), text: null }
const tough = { id: 'tough', name: 'Tough', img: null, kind: 'Feat', requirements: null, activation: null, passive: true, uses: null, text: 'd0000000000001' }
const full = {
  img: 'grim.webp', level: 5,
  spells: [{ id: 'spell0', label: 'Cantrips', slots: null, spells: [bolt] }, { id: 'spell1', label: '1st Level', slots: { value: 2, max: 4, level: 1 }, spells: [detect] }],
  inventory: { sections: [{ id: 'weapons', label: 'Weapons', items: [staff, spare, strange] }], containers: [backpack, pouch], currency: [], encumbrance: null, attunement: null },
  features: [{ id: 'fighter', label: 'Fighter Features', text: null, features: [surge, tough] }],
  actions: [
    { id: 'action', label: 'Actions', actions: [
      asAction(staff, strike, { activities: [strike] }),
      asAction(strange, { activation: 'Action', activationType: 'action', range: 'reach 5 ft', target: '1 Creature', ...NO_ROLLS }, { uses: null, identified: false }),
      asAction(potion, { activation: 'Action', activationType: 'action', range: null, target: null, ...NO_ROLLS, activity: drink, damage: potion.damage }, { consumable: true }),
      // A class item Tidy 5e lists, which no tab lists: sent whole.
      { id: 'fighter', name: 'Fighter', img: 'fighter.webp', type: 'class', activation: 'Action', activationType: 'action', range: null, target: null, ...NO_ROLLS, uses: null, level: null, castFrom: null, concentration: false, identified: true, text: null },
    ] },
    { id: 'reaction', label: 'Reactions', actions: [
      asAction(staff, barbs, { activityName: 'Silvery Barbs', spellId: 'barbs-copy', cast: barbs.cast, activities: [barbs] }),
      asAction(spare, barbs2, { activityName: 'Silvery Barbs', spellId: 'barbs-copy', cast: barbs.cast }),
    ] },
  ],
  favorites: [{ ...strike, type: 'activity', id: 'strike', itemId: 'staff', itemType: 'weapon', itemName: 'Staff of Barbs', name: 'Strike', img: 'staff.webp' }],
}
const before8 = JSON.stringify(full)
const slim8 = slimSheet(full)
assert.equal(JSON.stringify(full), before8, 'the sheet given is left as it was')
assert.equal(slim8.slim, 1)
assert.deepEqual(expandSheet(JSON.parse(JSON.stringify(slim8))), full)
const [[staffAction, strangeAction, potionAction, classAction], [barbsAction, spareAction]] = slim8.actions.map(section => section.actions)
// The staff's Action row differs from its row in what it lists; its Reaction row in nearly all.
assert.deepEqual(Object.keys(staffAction).sort(), ['activationType', 'activities', 'castFrom', 'id', 'level', 'ref'])
assert.deepEqual(staffAction.activities.map(a => a.id), ['strike'])
assert.ok(['activityName', 'activation', 'activities', 'activity', 'cast', 'spellId'].every(key => key in barbsAction) && !('name' in barbsAction) && !('drop' in barbsAction))
assert.deepEqual([barbsAction.activityName, barbsAction.activation, barbsAction.activities.map(a => a.id)], ['Silvery Barbs', 'Reaction', ['barbs']])
// The unequipped staff's one Cast lists no activities, which its row does.
assert.deepEqual(spareAction.drop, ['activities'])
assert.equal(spareAction.ref, true)
// The unidentified sword's action has what its row hasn't.
assert.deepEqual([strangeAction.ref, strangeAction.activation, strangeAction.toHit, 'identified' in strangeAction, 'name' in strangeAction], [true, 'Action', null, false, false])
// The potion in the bag in the backpack is found.
assert.deepEqual(Object.keys(potionAction).sort(), ['activationType', 'castFrom', 'consumable', 'id', 'level', 'ref'])
// The class item, which no tab lists, goes whole.
assert.deepEqual(classAction, full.actions[0].actions[3])
// Defaults left out of rows; what isn't a default kept.
const [slimStaff, slimSpare] = slim8.inventory.sections[0].items
assert.deepEqual([slimSpare.equipped, 'quantity' in slimSpare, 'attuned' in slimSpare, 'properties' in slimSpare], [false, false, false, false])
assert.deepEqual(Object.keys(slimStaff.activities[1]).sort(), ['activation', 'activationType', 'activity', 'cast', 'id', 'name', 'range', 'spellId', 'target', 'type', 'uses'])
assert.deepEqual(slimStaff.activities[1].activity.targets, { count: 1, affects: 'creature' })
assert.deepEqual(slimStaff.damage, [{ formula: '1d6 + 2', type: 'Bludgeoning' }])
const [slimPack, slimPouch] = slim8.inventory.containers
assert.deepEqual([('capacity' in slimPack), slimPouch.contents, slimPouch.equipped], [false, [], false])
const [slimRope, slimBag] = slimPack.contents
assert.deepEqual(Object.keys(slimRope).sort(), ['id', 'img', 'name', 'quantity', 'type', 'weight'], 'rope rolls nothing: no damage, nothing to add')
const slimPotion = slimBag.contents[0]
assert.deepEqual([slimPotion.quantity, slimPotion.activity.targets, slimPotion.damage, 'range' in slimPotion, 'toHit' in slimPotion], [2, { self: true }, [{ formula: '2d4 + 2', type: 'Healing', healing: true }], false, false])
const [slimBolt] = slim8.spells[0].spells
const [slimDetect] = slim8.spells[1].spells
assert.deepEqual(['level' in slimBolt, 'prepared' in slimBolt, slimBolt.toHit, 'activity' in slimBolt], [false, false, 6, false])
assert.deepEqual([slimDetect.level, slimDetect.prepared, slimDetect.ritual, 'damage' in slimDetect, 'toHit' in slimDetect], [1, 0, true, false, false])
const [slimSurge, slimTough] = slim8.features[0].features
assert.deepEqual([slimSurge.damage, 'toHit' in slimSurge, 'range' in slimSurge, 'concentration' in slimSurge, slimSurge.activity.targets], [[], false, false, false, { self: true }])
assert.deepEqual(Object.keys(slimTough).sort(), ['id', 'kind', 'name', 'passive', 'text'])
const expandedTough = expandSheet(slim8).features[0].features[1]
assert.ok(!('damage' in expandedTough) && !('toHit' in expandedTough), 'a row without damage rolls nothing: nothing added')
// An activity favorite keeps its own keys; what it holds is slimmed.
assert.deepEqual([slim8.favorites[0].activity, slim8.favorites[0].attackModes, slim8.favorites[0].damage], [null, null, [{ formula: '1d6 + 2', type: 'Bludgeoning' }]])
ok('H8: slim format 1: a split staff row keeps its activityName, activation and activities; an unequipped staff\'s one Cast drops its row\'s activities; an unidentified item\'s action, and one in a container in a container, go by reference; a class item no tab lists goes whole; equipped false, prepared 0 and an empty container\'s contents are kept; a row without damage gets nothing added, one with damage [] keeps it; every key comes back')

// ---- H9: no post larger than the app takes ----
assert.deepEqual(transport.termsOf('camp-a'), { slimSheets: null, maxBytes: 1_000_000 }, "the app's last answer said nothing of it")
const chatOf = bytes => {
  const envelope = transport.buildEnvelope('chat.message.created', { message: { id: 'big', content: '' } }, { campaign: ashlands() })
  envelope.data.message.content = 'x'.repeat(bytes - size(envelope))
  assert.equal(size(envelope), bytes)
  return envelope
}
const chats = () => since(from).filter(e => e.type === 'chat.message.created').map(e => e.bytes)
warnings.length = 0
from = app.events.length
let fetched = app.fetched
const dropped = transport.status.dropped
transport.post(chatOf(1_000_001))
await quiet()
assert.equal(app.fetched, fetched, 'not fetched')
assert.equal(transport.status.dropped, dropped + 1)
assert.equal(warnings.length, 1)
// Since 0.23.0, as what went wrong and what to do (errors.mjs H5 has more).
assert.match(warnings[0], /^SENDINGSTONE\.Notify\.Problem .*SENDINGSTONE\.Problem\.tooLarge .*1\.1 MB.*1\.0 MB/)
assert.ok(logged.some(line => line.includes('Could not deliver chat.message.created')))
transport.post(chatOf(999_999))
transport.post(chatOf(1_000_000))
await quiet()
assert.deepEqual(chats(), [999_999, 1_000_000])
// Measured in bytes as sent: 400,000 characters of three bytes each come to 1.2 MB.
const euros = transport.buildEnvelope('chat.message.created', { message: { id: 'euros', content: '€'.repeat(400_000) } }, { campaign: ashlands() })
fetched = app.fetched
transport.post(euros)
await quiet()
assert.equal(app.fetched, fetched, 'not fetched')
// The app says it takes more, as it says in every answer from now on.
const beat = async features => {
  app.features = features
  app.featuresOnUpdate = true
  advance(30_000)
  heartbeat()
  await quiet()
  await quiet()
}
await beat({ commands: true, maxBytes: 4_000_000 })
assert.deepEqual(transport.termsOf('camp-a'), { slimSheets: null, maxBytes: 4_000_000 })
from = app.events.length
transport.post(chatOf(1_000_001))
await quiet()
assert.deepEqual(chats(), [1_000_001])
for (const maxBytes of ['4MB', 10, -1, 999_999, 4_000_000.5, null]) {
  await beat({ commands: true, maxBytes })
  assert.deepEqual(transport.termsOf('camp-a'), { slimSheets: null, maxBytes: 1_000_000 }, String(maxBytes))
  await beat({ commands: true, maxBytes: 4_000_000 })
}
await beat({ commands: true, maxBytes: '4MB' })
from = app.events.length
fetched = app.fetched
transport.post(chatOf(1_000_001))
await quiet()
assert.deepEqual([chats(), app.fetched], [[], fetched])
ok('H9: a post over the 1,000,000 bytes an app takes until it says more is never fetched, but dropped, counted and the Gamemaster warned once ("1.1 MB", "1.0 MB"); one of 999,999 or 1,000,000 is posted; after maxBytes 4000000, 1,000,001 too; "4MB", 10, -1 and the like mean 1,000,000')

// ---- H10: a sheet too large is withheld, never cut short ----
// Thorin's appearance, which his sheet carries as it is, makes his post as large as wanted.
const thorinPost = async (pad, bio) => {
  thorin.system.details.appearance = 'x'.repeat(pad)
  if (bio) thorin.system.details.biography.value = bio
  from = app.events.length
  sendCharacter('thorin')
  await until(() => since(from).some(isType('character.updated', 'thorin')), "Thorin's post")
  await quiet()
  return since(from).filter(e => e.campaign.id === 'camp-a')
}
let posted = await thorinPost(900_000)
const fits = 900_000 + (1_000_000 - posted.at(-1).bytes)
posted = await thorinPost(fits)
assert.deepEqual(posted.map(e => [describe(e), e.bytes, e.data.character?.sheet?.details.appearance.length]), [['character.updated Ashlands thorin', 1_000_000, fits]])
warnings.length = 0
const resends = app.resends
posted = await thorinPost(fits + 1, '<p>A dwarf of Erebor, and of the Lonely Mountain.</p>')
assert.deepEqual(posted.map(describe), ['character.updated Ashlands thorin'], 'no descriptions before a sheet withheld')
const withheld = posted[0].data.character
assert.deepEqual(withheld, { id: 'thorin', uuid: 'Actor.thorin', name: 'Thorin', img: 'thorin.webp', type: 'character', owners: [{ id: 'alice', name: 'Alice' }], manualDice: false, sheet: null, sheetWithheld: { reason: 'tooLarge', bytes: 1_000_001, limit: 1_000_000 } })
assert.deepEqual(Object.keys(withheld), ['id', 'uuid', 'name', 'img', 'type', 'owners', 'manualDice', 'sheet', 'sheetWithheld'])
assert.ok(posted[0].bytes < 1_000)
assert.equal(warnings.length, 1)
assert.match(warnings[0], /^SENDINGSTONE\.Notify\.SheetTooLargeUntold .*"name":"Thorin".*"campaign":"Ashlands".*"size":"1\.1 MB".*"limit":"1\.0 MB"/)
posted = await thorinPost(fits + 10)
assert.deepEqual([posted.map(describe), posted[0].data.character.sheetWithheld.bytes, warnings.length], [['character.updated Ashlands thorin'], 1_000_010, 1], 'warned once a page load')
// Unchanged, it isn't posted again, whether a change its sheet doesn't show or anything else asks.
from = app.events.length
logged.length = 0
await Hooks.callAll('updateActor', thorin, { flags: { 'sending-stone-test': { seen: 1 } } })
await wait(400)
sendCharacter('thorin')
await quiet()
assert.deepEqual([since(from).map(describe), logged.filter(line => line.includes('came to'))], [[], []], 'an unchanged sheet withheld is not posted again')
// Lost to failures that might not last, it's posted again at the check 30 seconds later.
when(isType('character.updated', 'thorin'), { status: 500, times: 3 })
posted = await thorinPost(fits + 20)
assert.deepEqual(posted.map(e => [e.status, e.data.character.sheetWithheld.bytes]), [[500, 1_000_020], [500, 1_000_020], [500, 1_000_020]])
from = app.events.length
advance(30_000)
heartbeat()
await until(() => since(from).some(isType('character.updated', 'thorin')), "Thorin's post again")
await quiet()
assert.deepEqual(since(from).filter(isType('character.updated', 'thorin')).map(e => [e.status, e.data.character.sheetWithheld.bytes]), [[200, 1_000_020]])
// Shrunk, the new biography goes first, then the sheet; the app has every description it refers to.
posted = await thorinPost(1_000)
assert.deepEqual(posted.map(describe), ['character.texts Ashlands', 'character.updated Ashlands thorin'])
const newBio = posted[1].data.character.sheet.details.biography
assert.deepEqual(Object.keys(posted[0].data.texts), [newBio])
assert.equal(app.resends, resends, 'the app checking descriptions asks for no resend')
// An app that shows the player why: the Gamemaster is told so. And once it takes 4 MB, a sheet of
// 1.5 MB withheld at 1 MB goes.
await beat({ commands: true, slimSheets: 1 })
from = app.events.length
warnings.length = 0
vex.system.details.appearance = 'y'.repeat(1_500_000)
sendCharacter('vex')
await until(() => since(from).filter(isType('character.updated', 'vex')).length >= 2, "Vex's posts")
await quiet()
const vexWithheld = since(from).filter(isType('character.updated', 'vex'))
assert.deepEqual(vexWithheld.map(e => [e.campaign.title, e.data.character.sheet, e.data.character.sheetWithheld.limit]), [['Ashlands', null, 1_000_000], ['Mirkwood', null, 1_000_000]])
assert.ok(vexWithheld.every(e => e.data.character.sheetWithheld.bytes > 1_500_000))
assert.deepEqual(warnings.map(w => w.split(' ')[0]), ['SENDINGSTONE.Notify.SheetTooLarge', 'SENDINGSTONE.Notify.SheetTooLarge'])
assert.match(warnings[0], /"name":"Vex".*"campaign":"Ashlands".*"size":"1\.6 MB".*"limit":"1\.0 MB"/)
from = app.events.length
await beat({ commands: true, slimSheets: 1, maxBytes: 4_000_000 })
const vexSent = since(from).filter(isType('character.updated', 'vex'))
assert.deepEqual(vexSent.map(e => [e.campaign.title, e.data.character.sheet?.slim, e.data.character.sheet?.details.appearance.length]), [['Ashlands', 1, 1_500_000], ['Mirkwood', 1, 1_500_000]])
assert.ok(vexSent.every(e => (e.bytes > 1_500_000) && !('sheetWithheld' in e.data.character)))
assert.equal(warnings.length, 2)
vex.system.details.appearance = ''
thorin.system.details.appearance = ''
sendCharacter('vex'); sendCharacter('thorin')
await quiet()
ok('H7, H10: a post of exactly 1,000,000 bytes is sent; at 1,000,001 the sheet is withheld, sheetWithheld saying why, its descriptions neither posted nor taken as sent, the Gamemaster warned once (Untold where the app doesn\'t say slimSheets, told otherwise; "1.1 MB", "1.0 MB"); unchanged, it isn\'t posted again, and lost to a 500, it is at the check; shrunk, its descriptions go before it; a 1.5 MB sheet withheld at 1 MB goes once the app says 4 MB')

// ---- H11: descriptions are split by bytes, not characters ----
const { sendTexts } = await import(`${MODULE}/scripts/sheet-texts.mjs`)
const sources = new Map(Array.from({ length: 6 }, (_, i) => [`e${i}`.padEnd(14, '0'), { html: `<p>${'€'.repeat(50_000)}</p>`, relativeTo: thorin }]))
from = app.events.length
sendTexts(ashlands(), sources)
await until(() => since(from).filter(e => e.type === 'character.texts').reduce((n, e) => n + Object.keys(e.data.texts).length, 0) === 6, 'every description')
const chunks = since(from).filter(e => e.type === 'character.texts')
const entry11 = Math.max(...chunks.flatMap(e => Object.entries(e.data.texts).map(([hash, html]) => size(hash) + size(JSON.stringify(html)) + 4)))
assert.ok(entry11 > 150_000)
assert.ok(chunks.length >= 3, `${chunks.length} posts`)
assert.ok(chunks.every(e => e.bytes <= 400_000 + entry11), chunks.map(e => e.bytes).join(', '))
ok('H11: descriptions of 150,000 bytes in characters of three bytes each go in posts of at most 400,000 bytes and one description')

// ---- H12: an app before 0.22.0 ----
// It answers as main does: commands in a hello's and heartbeat's answer, 204 to an update. It drops
// every sheet and description at a hello, and asks for a resend when a sheet refers to one it lacks.
await beat({ commands: true })
app.featuresOnUpdate = false
from = app.events.length
announce()
await until(() => since(from).filter(isType('character.updated')).length >= 4, 'every sheet after the hellos')
await quiet()
assert.deepEqual(since(from).filter(isType('character.updated')).map(e => [e.campaign.title, e.data.character.id, e.data.character.sheet?.slim ?? 'full']), [
  ['Ashlands', 'thorin', 'full'], ['Ashlands', 'vex', 'full'], ['Mirkwood', 'grim', 'full'], ['Mirkwood', 'vex', 'full'],
])
assert.deepEqual([...app.sheets.keys()].sort(), ['camp-a.thorin', 'camp-a.vex', 'camp-b.grim', 'camp-b.vex'])
for (const [key, held] of app.sheets) {
  const campaign = key.split('.')[0]
  assert.ok([...refsOf(held.sheet)].every(hash => app.texts.get(campaign).has(hash)), key)
}
assert.equal(app.resends, 0)
ok('H12: an app before 0.22.0, which drops every sheet and description at a hello, ends holding every sheet, full, and every description they refer to, and never asks for a resend')

// ---- H13: posts lost to failures that might not last are sent again ----
const updates = (id, campaign = 'camp-a') => since(from).filter(e => isType('character.updated', id)(e) && (e.campaign.id === campaign))
const check = async ms => {
  advance(ms)
  heartbeat()
  await quiet()
  await quiet()
}
// A sheet of the burst, lost.
from = app.events.length
when(e => isType('character.updated', 'thorin')(e) && (e.campaign.id === 'camp-a'), { status: 500, times: 3 })
announce({ campaignId: 'camp-a' })
await until(() => updates('vex').length, 'the burst')
await quiet()
assert.deepEqual(updates('thorin').map(e => e.status), [500, 500, 500])
await check(29_000)
assert.equal(updates('thorin').length, 3, 'not before 30 seconds')
await check(1_000)
assert.deepEqual(updates('thorin').map(e => e.status), [500, 500, 500, 204])
assert.ok(app.sheets.has('camp-a.thorin'))
await check(30_000)
assert.equal(updates('thorin').length, 4, 'kept: not sent again')
// A description and the sheet after it, both lost: both sent again, the description first.
from = app.events.length
when(e => (e.type === 'character.texts') && (e.campaign.id === 'camp-a'), { status: 503, times: 3 })
when(e => isType('character.updated', 'vex')(e) && (e.campaign.id === 'camp-a'), { status: 500, times: 3 })
vex.system.details.biography.value = '<p>A tiefling of Mirkwood, lately of the Ashlands.</p>'
sendCharacter('vex')
await until(() => updates('vex').length === 3, 'the sheet lost')
await quiet()
const lostBio = updates('vex')[0].data.character.sheet.details.biography
from = app.events.length
await check(30_000)
assert.deepEqual(since(from).filter(e => e.campaign.id === 'camp-a').filter(e => e.type !== 'bridge.heartbeat').map(e => `${describe(e)} ${e.status}`), ['character.texts Ashlands 204', 'character.updated Ashlands vex 204'])
assert.deepEqual(Object.keys(since(from).find(e => e.type === 'character.texts').data.texts), [lostBio])
// A hello, lost: it's sent again, its sheets after it.
from = app.events.length
when(e => (e.type === 'bridge.hello') && (e.campaign.id === 'camp-a'), { status: 503, times: 3 })
announce({ campaignId: 'camp-a' })
await quiet()
assert.deepEqual(since(from).map(e => `${describe(e)} ${e.status}`), ['bridge.hello Ashlands 503', 'bridge.hello Ashlands 503', 'bridge.hello Ashlands 503'])
from = app.events.length
await check(30_000)
assert.deepEqual(since(from).filter(e => e.campaign.id === 'camp-a').filter(e => e.type !== 'bridge.heartbeat').map(describe), [
  'bridge.hello Ashlands', 'character.texts Ashlands', 'character.updated Ashlands thorin', 'character.texts Ashlands', 'character.updated Ashlands vex',
])
// One the app refused isn't sent again.
from = app.events.length
when(e => isType('character.updated', 'thorin')(e), { status: 401, times: 1 })
thorin.system.attributes.hp.value = 20
sendCharacter('thorin')
await quiet()
assert.deepEqual(updates('thorin').map(e => e.status), [401])
await check(30_000)
await check(30_000)
assert.deepEqual(updates('thorin').map(e => e.status), [401])
// One pushed out of a full queue, by an app too slow to keep up, is sent again at the check 30
// seconds later: here a sheet waiting behind a post held open, and 500 posts after it.
await quiet()
const slow = held()
when(e => (e.type === 'chat.message.created') && (e.data.message.id === 'slow'), { hold: slow.hold, times: 1 })
const chat = id => transport.send('chat.message.created', { message: { id, content: '' } }, ashlands())
from = app.events.length
const droppedBefore = transport.status.dropped
chat('slow')
thorin.system.attributes.hp.value = 21
sendCharacter('thorin')
for (let i = 0; i < 500; i++) chat(`after-${i}`)
assert.equal(transport.status.dropped, droppedBefore + 1)
slow.release()
await until(() => since(from).filter(e => e.type === 'chat.message.created').length === 501, 'the posts after it', 20_000)
await quiet()
assert.deepEqual(updates('thorin'), [], 'pushed out')
await check(30_000)
assert.deepEqual(updates('thorin').map(e => [e.status, e.data.character.sheet.hp.value]), [[204, 21]])
assert.equal(app.resends, 0)
ok('H13: a sheet lost to a 500 three times is sent again at the check 30 seconds later, and kept; a description and its sheet lost go again in that order; a hello lost goes again with every sheet after it; a post refused (401) is not sent again; a sheet pushed out of a full queue is sent again')

console.log('\nall sync checks passed')
process.exit(0)
