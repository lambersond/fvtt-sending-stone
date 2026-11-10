// Tidy 5e Sheets' journal (module 0.45.0; PROTOCOL.md's `journal.tidy` and "Tidy 5e Sheets'
// journal", the owner's T1 A, T3 B, T4 B, T5 A, T6 A): the hello's `features.notes.tidy`; nothing
// sent to an app answering `notes` below 3, and each character's entries once it answers 3, after a
// hello's books and in a heartbeat's answer; Tidy's order, ties in the flag's order, then the Classic
// sheet's boxes, the empty ones left out; what isn't of Tidy's shape skipped, a stray `-=<key>` among
// it; cuts; secrets kept with a player owner and left out with none, again on a change of ownership;
// Tidy's own writes heard, Tidy 13's and 14's deletes alike, a burst sent once 500 ms after its last;
// a token's actor, a Wild Shape form, a group and an actor of no campaign left be; the told map
// cleared by a hello, a change of what the app takes and a rise to 3; `tooLarge`, warned once, the
// character's own journal untouched; Tidy turned off and uninstalled; older apps and another system;
// one lost to a failure that might not last; and Tidy 5e Sheets in both module lists: the settings
// window's "Works with" and the hello's `settings.modules`. On tidy-core.mjs's stand-in for Tidy and
// Foundry 14's actor update, journal-core.mjs's journals, settings-app.mjs's window, stub.mjs's core
// and a stand-in app; the real module and its language file. Under DND5E6=1 the system says dnd5e
// 6.0.5 and Tidy 14.4.1, the Tidy for it, else Tidy 13.10.5: they're Tidy's flags, read alike under
// both. Timers of a second or more run a hundred times faster. Run with --import
// ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { find, openSettings, view } from './settings-app.mjs'
import { settings, user, users, actors } from './stub.mjs'
import { TidyActor, TIDY, JOURNAL, entry, foundry as V14, tidy } from './tidy-core.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
const TIDY_VERSION = DND5E6 ? '14.4.1' : '13.10.5'
let oks = 0
const ok = message => { oks++; console.log('ok -', message) }

const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...args)
const wait = ms => new Promise(resolve => realSetTimeout(resolve, ms))
// What the module logs, kept rather than printed: the stand-in characters have no sheets to describe.
const logged = []
console.warn = console.error = (...args) => logged.push(args.map(String).join(' '))
const warnings = []
ui.notifications.warn = message => warnings.push(message)

// ---- Foundry and the system ----
game.documentTypes = { Actor: ['character', 'npc', 'vehicle', 'group', 'encounter'] }
if (DND5E6) game.system.version = '6.0.5'
CONFIG.DND5E = {
  abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => [a, { label: a.toUpperCase(), abbreviation: a }])),
  currencies: Object.fromEntries(['pp', 'gp', 'ep', 'sp', 'cp'].map(id => [id, { label: `DND5E.Currency${id.toUpperCase()}`, abbreviation: id }])),
  weightUnits: { lb: { abbreviation: 'lb' } },
}
foundry.applications.ux.TextEditor = { implementation: { async enrichHTML(html) { return html } } }
const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (typeof value === 'object')
  ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])
const words = Object.fromEntries(flat(JSON.parse(readFileSync(`${MODULE}/lang/en.json`, 'utf8'))))
game.i18n.localize = key => words[key] ?? key
game.i18n.has = key => Object.hasOwn(words, key)
game.i18n.format = (key, data = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ''))
const J = await import('./journal-core.mjs')

// Tidy 5e Sheets, installed and active, the release for the system's version.
const tidyModule = { id: TIDY, title: 'Tidy 5e Sheets', version: TIDY_VERSION, active: true, authors: [{ name: 'kgar' }] }
game.modules.set(TIDY, tidyModule)

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
for (const [id, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['dave', 'Dave']]) user(id, name)
const add = fields => { const a = new TidyActor(fields); actors.set(a.id, a); return a }
const SECRET = '<section class="secret"><p>Smaug lives.</p></section>'
// Thorin (Alice): four journal entries, two of one sort, one untitled, one with a secret; and three
// Classic boxes that hold something, one emptied (`<p></p>`), one never written.
const thorin = add({
  id: 'thorin', name: 'Thorin', owners: ['alice'], flags: {
    [TIDY]: {
      [JOURNAL]: {
        aaaaaaaaaaaaaaa1: entry('aaaaaaaaaaaaaaa1', 'The road east', '<p>We left at dawn.</p>', 20),
        bbbbbbbbbbbbbbb2: entry('bbbbbbbbbbbbbbb2', '', '<p>Untitled.</p>', 10),
        ccccccccccccccc3: entry('ccccccccccccccc3', 'Tied, stored first', '<p>A</p>', 30),
        ddddddddddddddd4: entry('ddddddddddddddd4', 'Tied, stored second', `<p>B</p>${SECRET}`, 30),
      },
      notes1: { name: 'Allies', value: '<p>Balin, @UUID[Actor.balin]{Balin}</p>' },
      notes2: { name: 'Places', value: '<p></p>' },
      notes3: { value: '<p>Find the hidden door.</p>' },
      notes: { value: '<p>Day one.</p>' },
    },
  },
})
const vex = add({ id: 'vex', name: 'Vex', owners: ['bob'] })
// Ghost: no player owns it, so its secret stays in Foundry.
const ghost = add({ id: 'ghost', name: 'Ghost', flags: { [TIDY]: { [JOURNAL]: { eeeeeeeeeeeeeee5: entry('eeeeeeeeeeeeeee5', 'Seen', `<p>A shade.</p>${SECRET}`, 0) } } } })
// Bram (Dave): what isn't of Tidy's shape, a stray `-=<key>` among it; a title and a text too long.
const bram = add({
  id: 'bram', name: 'Bram', owners: ['dave'], flags: {
    [TIDY]: {
      [JOURNAL]: {
        '-=zzzzzzzzzzzzzzz9': null,
        'bad key!': entry('bad key!', 'Bad key', '', 1),
        ['k'.repeat(65)]: entry('k'.repeat(65), 'Too long a key', '', 1),
        notatitle0000001: { id: 'notatitle0000001', title: 5, value: '', sort: 1 },
        notavalue0000001: { id: 'notavalue0000001', title: 'No text', sort: 1 },
        nosort0000000001: { id: 'nosort0000000001', title: 'No sort', value: '' },
        nansort000000001: entry('nansort000000001', 'NaN', '', Number.NaN),
        textsort00000001: entry('textsort00000001', 'A sort as text', '', '5'),
        astring000000001: 'not an entry',
        long000000000001: entry('long000000000001', 'T'.repeat(201), 'v'.repeat(100_001), 5),
        empty00000000001: entry('empty00000000001', '', '', -3),
      },
      notes1: 'not a box',
      notes2: { name: 7, value: '<p>A name that is no string.</p>' },
      notes3: { value: 42 },
      notes4: { name: 'Spaces', value: '  <p>&nbsp;</p>\n<p> </p> ' },
      notes: { value: '<p><img src="map.webp"></p>' },
    },
  },
})
// The party, with entries of its own (it's never sent); Mara, in no campaign; Thorin's wolf, a
// form with his flags copied, in none either; and a token's own actor, sharing Thorin's id.
const company = add({ id: 'company', name: 'The Iron Company', type: 'group', flags: { [TIDY]: { [JOURNAL]: { party0000000001: entry('party0000000001', 'Party', '', 1) } } } })
Object.assign(company, { system: { members: [], description: { full: '', summary: '' }, currency: {} }, items: { get: () => undefined, [Symbol.iterator]: () => [][Symbol.iterator]() } })
const mara = add({ id: 'mara', name: 'Mara', owners: ['bob'], flags: { [TIDY]: { [JOURNAL]: { mara000000000001: entry('mara000000000001', 'Mine', '', 1) } } } })
const wolf = add({ id: 'wolf', name: 'Thorin (Wolf)', type: 'npc', owners: ['alice'], flags: structuredClone(thorin.flags) })
const token = new TidyActor({ id: 'thorin', name: 'Thorin', owners: ['alice'], isToken: true, flags: structuredClone(thorin.flags) })

// ---- The app ----
const app = { events: [], features: { erebor: { notes: 2, groups: 1 }, mirkwood: { notes: 2 }, shire: { notes: 3 } }, fail: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    if (app.fail?.(body)) return { ok: false, status: 503, statusText: 'Unavailable', headers: new Headers() }
    // A hello the app is slow to answer.
    if (app.holdHello && (body.type === 'bridge.hello')) await wait(app.holdHello)
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat', 'character.updated', 'group.updated'].includes(body.type)
    return announcing ? json({ features: app.features[body.campaign.id] ?? {} }) : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) return json({ commands: [] })
  throw new TypeError(`Unexpected fetch of ${url}`)
}
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
const isTidy = (e, campaignId, actorId) => (e.type === 'journal.tidy') && (e.campaign.id === campaignId) && (!actorId || (e.data.actorId === actorId))
const tidyOf = (campaignId, actorId, from = 0) => app.events.slice(from).filter(e => isTidy(e, campaignId, actorId)).map(e => e.data)
const lastTidy = (campaignId, actorId) => tidyOf(campaignId, actorId).at(-1)
const helloOf = campaignId => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === campaignId)).at(-1)
const since = from => app.events.slice(from)
const byId = (data, id) => data?.entries.find(e => e.id === id) ?? null
const beatAhead = ms => {
  const clockNow = Date.now
  Date.now = () => clockNow() + ms
  try { heartbeat() } finally { Date.now = clockNow }
}
let ahead = 0
/** A heartbeat to every campaign, as if each had been sent nothing for a while. */
const beat = () => beatAhead(ahead += 60_000)

/**
 * The app's schema for `journal.tidy`, as PROTOCOL.md has it: one entry it wouldn't take would fail
 * the whole event.
 */
function appTakes(data) {
  const ACTOR = /^[\dA-Za-z]{1,64}$/
  const whole = v => Number.isInteger(v) && (v >= 0)
  assert.ok(ACTOR.test(data.actorId), 'actorId')
  assert.deepEqual(Object.keys(data).filter(key => !['actorId', 'entries', 'withheld'].includes(key)), [], 'its keys')
  assert.ok(Array.isArray(data.entries) && (data.entries.length <= 400), 'at most 400 entries')
  if (data.withheld) {
    assert.deepEqual(data.entries, [], 'withheld: no entries')
    assert.ok((data.withheld.reason === 'tooLarge') && whole(data.withheld.bytes) && whole(data.withheld.limit), 'withheld')
    return true
  }
  const sorts = { journal: new Set(), classic: new Set() }
  for (const e of data.entries) {
    const what = `entry ${e.from}:${e.id}`
    assert.deepEqual(Object.keys(e), ['from', 'id', 'title', 'html', ...(e.cut ? ['cut'] : []), ...(e.secret ? ['secret'] : []), 'sort', 'rev'], `${what}: its keys, in order`)
    assert.ok(['journal', 'classic'].includes(e.from), `${what}: from`)
    assert.ok((e.from === 'journal') ? /^[A-Za-z0-9]{1,64}$/.test(e.id) : ['notes1', 'notes2', 'notes3', 'notes4', 'notes'].includes(e.id), `${what}: id`)
    assert.ok((typeof e.title === 'string') && (e.title.length <= 200), `${what}: title`)
    assert.ok((typeof e.html === 'string') && (e.html.length <= 100_000), `${what}: html`)
    assert.ok([undefined, true].includes(e.cut) && [undefined, true].includes(e.secret), `${what}: marks`)
    assert.ok(Number.isInteger(e.sort) && (e.sort >= 1) && !sorts[e.from].has(e.sort), `${what}: sort`)
    sorts[e.from].add(e.sort)
    assert.ok(/^[\da-f]{14}$/.test(e.rev), `${what}: rev`)
  }
  return true
}

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { erebor: 'e', mirkwood: 'm', shire: 's' })
settings.set('campaigns', [
  { id: 'erebor', title: 'Erebor', characters: ['thorin', 'vex', 'ghost', 'bram'], groups: ['company'] },
  { id: 'mirkwood', title: 'Mirkwood', characters: ['thorin'], groups: [] },
  { id: 'shire', title: 'The Shire', characters: ['vex'], groups: [] },
])
// Thorin's and Bram's own journals in Erebor, kept by Sending Stone, which Tidy's never touch.
const ownJournal = async actorId => {
  const made = await J.JournalEntry.create({ name: `${actorId}'s notes`, ownership: { default: 0 }, flags: { 'sending-stone': { journal: { kind: 'personal', actor: actorId, campaign: 'erebor', granted: [], default: 0 } } } })
  await made.createEmbeddedDocuments('JournalEntryPage', [{ _id: `page${actorId.padEnd(12, '0')}`, name: 'A note', type: 'text', sort: 100000, title: { show: true, level: 2 }, text: { format: 2, markdown: 'Ours.', content: '<p>Ours.</p>' } }], { keepId: true })
  return made
}
await ownJournal('thorin')
await ownJournal('bram')
await Hooks.callAll('ready')
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { tidyEntries, tidyHello } = await import(`${MODULE}/scripts/tidy-journal.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const { textHash } = await import(`${MODULE}/scripts/sheet-texts.mjs`)
const campaign = id => getCampaigns().find(c => c.id === id)
const rev = (from, title, value) => textHash(JSON.stringify(['tidy', from, title, value]))
await until(() => ['erebor', 'mirkwood', 'shire'].every(helloOf), 'the hellos')
await wait(300)

/* -------------------------------------------- */
/*  The hello, and an app answering below 3      */
/* -------------------------------------------- */

for (const id of ['erebor', 'mirkwood', 'shire']) {
  assert.deepEqual(Object.keys(helloOf(id).data.features.notes), ['enabled', 'kinds', 'reason', 'journals', 'orders', 'changes', 'tidy'])
}
assert.deepEqual(helloOf('erebor').data.features.notes.tidy, { active: true, version: TIDY_VERSION, actors: ['thorin', 'ghost', 'bram'] })
assert.deepEqual(helloOf('mirkwood').data.features.notes.tidy, { active: true, version: TIDY_VERSION, actors: ['thorin'] })
assert.deepEqual(helloOf('shire').data.features.notes.tidy, { active: true, version: TIDY_VERSION, actors: [] }, 'installed: said, with none holding entries')
ok("every hello's features.notes ends with `tidy`: Tidy active, its version, and the campaign's characters holding entries, in its order, never its group; `[]` where none does")

const settingsModule = id => helloOf(id).data.settings.modules.find(m => m.id === TIDY)
assert.deepEqual(helloOf('erebor').data.settings.modules.at(-1), { id: TIDY, title: 'Tidy 5e Sheets', version: TIDY_VERSION, active: true }, 'last, after the others')
ok("the hello's settings.modules lists Tidy 5e Sheets last, with its version, active")

assert.deepEqual(tidyOf('erebor').concat(tidyOf('mirkwood')), [], 'nothing to an app answering `notes: 2`')
assert.ok(app.events.some(e => (e.type === 'journal.updated') && (e.campaign.id === 'erebor') && (e.data.actorId === 'thorin')), "Thorin's own book went")
// The Shire answers 3, but Vex holds none: nothing to send.
assert.deepEqual(tidyOf('shire'), [])
ok('an app answering `notes: 2` is sent no journal.tidy, its own books as ever; one answering 3 is sent none for a character holding none')

/* -------------------------------------------- */
/*  A rise to 3 in a heartbeat's answer          */
/* -------------------------------------------- */

app.features.erebor = { notes: 3, groups: 1 }
let from = app.events.length
beat()
await until(() => tidyOf('erebor', null, from).length >= 3, "Erebor's characters' Tidy journals")
await wait(100)
assert.deepEqual(tidyOf('erebor', null, from).map(d => d.actorId), ['thorin', 'ghost', 'bram'], 'each holding entries, once')
assert.deepEqual(tidyOf('mirkwood', null, from), [], "Mirkwood's app still answers 2")
const thorinSent = lastTidy('erebor', 'thorin')
const T = thorin.flags[TIDY][JOURNAL]
assert.deepEqual(thorinSent, {
  actorId: 'thorin',
  entries: [
    { from: 'journal', id: 'bbbbbbbbbbbbbbb2', title: '', html: '<p>Untitled.</p>', sort: 1, rev: rev('journal', '', T.bbbbbbbbbbbbbbb2.value) },
    { from: 'journal', id: 'aaaaaaaaaaaaaaa1', title: 'The road east', html: '<p>We left at dawn.</p>', sort: 2, rev: rev('journal', 'The road east', T.aaaaaaaaaaaaaaa1.value) },
    { from: 'journal', id: 'ccccccccccccccc3', title: 'Tied, stored first', html: '<p>A</p>', sort: 3, rev: rev('journal', 'Tied, stored first', '<p>A</p>') },
    { from: 'journal', id: 'ddddddddddddddd4', title: 'Tied, stored second', html: `<p>B</p>${SECRET}`, sort: 4, rev: rev('journal', 'Tied, stored second', `<p>B</p>${SECRET}`) },
    { from: 'classic', id: 'notes1', title: 'Allies', html: '<p>Balin, @UUID[Actor.balin]{Balin}</p>', sort: 1, rev: rev('classic', 'Allies', '<p>Balin, @UUID[Actor.balin]{Balin}</p>') },
    { from: 'classic', id: 'notes3', title: '', html: '<p>Find the hidden door.</p>', sort: 3, rev: rev('classic', '', '<p>Find the hidden door.</p>') },
    { from: 'classic', id: 'notes', title: '', html: '<p>Day one.</p>', sort: 5, rev: rev('classic', '', '<p>Day one.</p>') },
  ],
})
ok("Thorin's entries in Tidy's order, by sort alone, the two of one sort in the flag's order, then the Classic boxes in theirs, the emptied one left out; links as written; `sort` each one's place, a box's among the five; `rev` of Tidy's own title and text")

assert.deepEqual(lastTidy('erebor', 'ghost').entries, [
  { from: 'journal', id: 'eeeeeeeeeeeeeee5', title: 'Seen', html: '<p>A shade.</p>', secret: true, sort: 1, rev: rev('journal', 'Seen', `<p>A shade.</p>${SECRET}`) },
])
ok('a character no player owns is sent without its secrets, marked `secret`, its revision of the text with them; one with a player owner, Thorin, with them')

const bramSent = lastTidy('erebor', 'bram')
assert.deepEqual(bramSent.entries.map(e => `${e.from}:${e.id}`), ['journal:empty00000000001', 'journal:long000000000001', 'classic:notes2', 'classic:notes'])
const [empty, long, unnamed, image] = bramSent.entries
assert.deepEqual(empty, { from: 'journal', id: 'empty00000000001', title: '', html: '', sort: 1, rev: rev('journal', '', '') })
assert.deepEqual([long.title, long.html.length, long.cut, long.rev], ['T'.repeat(200), 100_000, true, rev('journal', 'T'.repeat(201), 'v'.repeat(100_001))])
assert.deepEqual([unnamed.title, unnamed.sort, image.html, image.sort], ['', 2, '<p><img src="map.webp"></p>', 5])
ok("what isn't of Tidy's shape is skipped, a stray `-=<key>`, a bad or long key, a title, text or finite sort missing, a box that isn't one or holds only spaces; a title and a text too long cut and marked, their revision of the whole; a negative sort first; an image box kept")

for (const data of tidyOf('erebor')) appTakes(data)
// Staying at 3: nothing again.
from = app.events.length
beat()
await wait(200)
assert.deepEqual(tidyOf('erebor', null, from), [])
ok('every journal.tidy is one the app takes; a heartbeat answer staying at 3 sends none again')

/* -------------------------------------------- */
/*  After a hello                               */
/* -------------------------------------------- */

from = app.events.length
announce({ campaignId: 'erebor' })
await until(() => tidyOf('erebor', null, from).length >= 3, 'the Tidy journals after the hello')
await wait(100)
{
  const after = since(from)
  const hello = after.findIndex(e => (e.type === 'bridge.hello') && (e.campaign.id === 'erebor'))
  const book = after.findIndex(e => (e.type === 'journal.updated') && (e.campaign.id === 'erebor'))
  const tidies = after.map((e, n) => [e, n]).filter(([e]) => isTidy(e, 'erebor')).map(([, n]) => n)
  assert.ok((hello >= 0) && (book > hello) && tidies.every(n => n > book), 'the hello, its books, then the Tidy journals')
  assert.deepEqual(tidyOf('erebor', null, from).map(d => d.actorId), ['thorin', 'ghost', 'bram'])
  assert.deepEqual(lastTidy('erebor', 'thorin'), thorinSent, 'the same again: the hello forgot what was told')
}
ok("after an answered hello, each character it lists follows its books, the same as before, the hello forgetting what was told")

// Tidy's flags taken off Ghost whole, as a clean-up of a module's data would, while the hello that
// lists him is on its way: he follows it with `entries: []`, for the app to drop what it holds.
{
  const flags = ghost.flags[TIDY]
  app.holdHello = 200
  from = app.events.length
  announce({ campaignId: 'erebor' })
  await wait(50)
  delete ghost.flags[TIDY]
  await until(() => tidyOf('erebor', 'ghost', from).length, "Ghost's, after the hello")
  app.holdHello = 0
  assert.deepEqual(helloOf('erebor').data.features.notes.tidy.actors, ['thorin', 'ghost', 'bram'], 'the hello, built before, lists him')
  assert.deepEqual(lastTidy('erebor', 'ghost'), { actorId: 'ghost', entries: [] })
  ghost.flags[TIDY] = flags
  from = app.events.length
  announce({ campaignId: 'erebor' })
  await until(() => tidyOf('erebor', 'ghost', from).length, "Ghost's again")
  assert.equal(lastTidy('erebor', 'ghost').entries.length, 1)
}
ok('a character the answered hello listed that holds no entries by then follows it with `entries: []`')

/* -------------------------------------------- */
/*  Tidy's own writes                           */
/* -------------------------------------------- */

/** Make a write, and resolve once its burst has settled, with what Erebor was sent of Thorin by then. */
async function heard(write, ms = 700) {
  const at = app.events.length
  await write()
  await wait(ms)
  return tidyOf('erebor', 'thorin', at)
}
// An entry added, as Tidy's + does: sent once, 500 ms after.
{
  const at = app.events.length
  await tidy.add(thorin, 'fffffffffffffff6', { title: 'New Journal Entry' })
  await wait(400)
  assert.deepEqual(tidyOf('erebor', 'thorin', at), [], 'not before 500 ms')
  await until(() => tidyOf('erebor', 'thorin', at).length, 'the entry added', 1000)
  const sent = lastTidy('erebor', 'thorin')
  assert.deepEqual(byId(sent, 'fffffffffffffff6'), { from: 'journal', id: 'fffffffffffffff6', title: 'New Journal Entry', html: '', sort: 5, rev: rev('journal', 'New Journal Entry', '') })
  assert.equal(thorin.flags[TIDY][JOURNAL].fffffffffffffff6.sort, 40, 'the highest sort plus 10')
}
// Its edit dialog saving on every change and as it closes: one post, as the burst settles.
{
  const at = app.events.length
  await tidy.edit(thorin, 'fffffffffffffff6', { title: 'Erebor' })
  await wait(150)
  await tidy.edit(thorin, 'fffffffffffffff6', { value: '<p>The Lonely' })
  await wait(150)
  await tidy.edit(thorin, 'fffffffffffffff6', { title: 'Erebor', value: '<p>The Lonely Mountain.</p>' })
  await wait(700)
  const sent = tidyOf('erebor', 'thorin', at)
  assert.equal(sent.length, 1, 'once for the burst')
  assert.deepEqual([byId(sent[0], 'fffffffffffffff6').title, byId(sent[0], 'fffffffffffffff6').html], ['Erebor', '<p>The Lonely Mountain.</p>'])
  assert.equal(byId(sent[0], 'aaaaaaaaaaaaaaa1').rev, byId(thorinSent, 'aaaaaaaaaaaaaaa1').rev, "an entry not changed keeps its revision")
}
ok('an entry added in Tidy, and its title and text saved three times in a burst, are each sent once, 500 ms after the last write; only the changed entry\'s revision changes')

// A drag: the sorts alone.
{
  const sent = await heard(() => tidy.sort(thorin, { fffffffffffffff6: 5 }))
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].entries.filter(e => e.from === 'journal').map(e => [e.id, e.sort]), [
    ['fffffffffffffff6', 1], ['bbbbbbbbbbbbbbb2', 2], ['aaaaaaaaaaaaaaa1', 3], ['ccccccccccccccc3', 4], ['ddddddddddddddd4', 5],
  ])
}
// Tidy 13's delete, `-=<key>`, and Tidy 14's, `_del`: each gone, in its own post.
for (const [remove, id] of [[tidy.delete13, 'aaaaaaaaaaaaaaa1'], [tidy.delete14, 'fffffffffffffff6']]) {
  const sent = await heard(() => remove(thorin, id))
  assert.equal(sent.length, 1, `${remove.name}: once`)
  assert.equal(byId(sent[0], id), null, `${remove.name}: gone`)
  assert.equal(Object.hasOwn(thorin.flags[TIDY][JOURNAL], id), false)
}
// A Classic box written: its name, then its text.
{
  const sent = await heard(async () => {
    await tidy.classic(thorin, 'notes2', 'value', '<p>Dale, Esgaroth.</p>')
    await tidy.classic(thorin, 'notes2', 'name', 'Places of note')
  })
  assert.equal(sent.length, 1)
  assert.deepEqual(byId(sent[0], 'notes2'), { from: 'classic', id: 'notes2', title: 'Places of note', html: '<p>Dale, Esgaroth.</p>', sort: 2, rev: rev('classic', 'Places of note', '<p>Dale, Esgaroth.</p>') })
}
ok("a reorder, Tidy 13's `-=<key>` delete, Tidy 14's `_del` delete and a Classic box written are each heard and sent once")

// An early Foundry 14 keeping Tidy 13's `-=<key>` as a key of its own, and the entry with it: the
// stray key is skipped, and what's sent is what Foundry holds, unchanged, so nothing goes.
V14.strayDelete = true
{
  const sent = await heard(() => tidy.delete13(thorin, 'ccccccccccccccc3'))
  assert.ok(Object.hasOwn(thorin.flags[TIDY][JOURNAL], '-=ccccccccccccccc3') && Object.hasOwn(thorin.flags[TIDY][JOURNAL], 'ccccccccccccccc3'), 'the stand-in kept both')
  assert.deepEqual(sent, [], 'nothing changed of what the app is sent')
  assert.ok(byId(lastTidy('erebor', 'thorin'), 'ccccccccccccccc3'), 'the entry as Foundry kept it')
}
V14.strayDelete = false
delete thorin.flags[TIDY][JOURNAL]['-=ccccccccccccccc3']
ok("on an early Foundry 14 that keeps Tidy 13's `-=<key>` as a stray key with the entry, the stray is skipped and nothing new is sent")

/* -------------------------------------------- */
/*  Secrets and ownership                       */
/* -------------------------------------------- */

{
  const before = byId(lastTidy('erebor', 'thorin'), 'ddddddddddddddd4')
  const sent = await heard(() => thorin.update({ ownership: { alice: 0 } }))
  assert.equal(sent.length, 1, 'sent again as his ownership changed')
  assert.deepEqual(byId(sent[0], 'ddddddddddddddd4'), { ...before, html: '<p>B</p>', secret: true }, 'its secret left out, marked, the same revision')
  const back = await heard(() => thorin.update({ ownership: { alice: 3 } }))
  assert.deepEqual(byId(back[0], 'ddddddddddddddd4'), before, 'and with it again once Alice owns him')
}
ok("a change of the character's ownership sends its entries again: with no player owner, without their secrets, `secret` marked and `rev` unchanged; with one again, whole")

/* -------------------------------------------- */
/*  What's left be                              */
/* -------------------------------------------- */

{
  const at = app.events.length
  // Each changes Thorin's own flags quietly first, so a hook that wrongly took one for his would send.
  thorin.flags[TIDY][JOURNAL].bbbbbbbbbbbbbbb2.title = 'Changed quietly'
  await token.update({ [`flags.${TIDY}.${JOURNAL}.bbbbbbbbbbbbbbb2.title`]: 'From the token' })
  await wolf.update({ [`flags.${TIDY}.${JOURNAL}.bbbbbbbbbbbbbbb2.title`]: 'On the wolf' })
  await company.update({ [`flags.${TIDY}.${JOURNAL}.party0000000001.title`]: 'The party' })
  await mara.update({ [`flags.${TIDY}.${JOURNAL}.mara000000000001.title`]: 'Hers' })
  await thorin.update({ 'system.attributes.hp.value': 25 })
  await thorin.update({ 'flags.dnd5e.inspiration': true })
  await wait(700)
  assert.deepEqual(app.events.slice(at).filter(e => e.type === 'journal.tidy'), [], 'none sent')
  thorin.flags[TIDY][JOURNAL].bbbbbbbbbbbbbbb2.title = ''
}
ok("a token's own actor, a Wild Shape form with the character's flags, a group, an actor in no campaign, and a change that touches neither Tidy's flags nor ownership send nothing")

/* -------------------------------------------- */
/*  Two campaigns, and older apps               */
/* -------------------------------------------- */

app.features.mirkwood = { notes: 3 }
from = app.events.length
beat()
await until(() => tidyOf('mirkwood', 'thorin', from).length, "Thorin's Tidy journal in Mirkwood")
assert.deepEqual(lastTidy('mirkwood', 'thorin').entries, lastTidy('erebor', 'thorin').entries, 'the same entries, secrets and all, in each campaign')
{
  const sent = await heard(() => tidy.edit(thorin, 'bbbbbbbbbbbbbbb2', { value: '<p>Both.</p>' }))
  assert.equal(sent.length, 1)
  assert.equal(byId(lastTidy('mirkwood', 'thorin'), 'bbbbbbbbbbbbbbb2').html, '<p>Both.</p>', 'and to each, on a change')
}
ok('a character in two campaigns is sent its Tidy journal in each that reads it, the same entries')

for (const answer of [{ notes: 2 }, { notes: '3' }, { notes: 1 }, {}]) {
  app.features.mirkwood = answer
  beat()
  await wait(100)
  const at = app.events.length
  await tidy.edit(thorin, 'bbbbbbbbbbbbbbb2', { value: `<p>${JSON.stringify(answer)}</p>` })
  await wait(700)
  assert.deepEqual(tidyOf('mirkwood', 'thorin', at), [], `none for ${JSON.stringify(answer)}`)
  assert.equal(tidyOf('erebor', 'thorin', at).length, 1, 'Erebor still')
}
ok('an app whose answer falls to `notes: 2`, or says `"3"`, 1 or nothing, is sent no journal.tidy, another campaign\'s still is')

/* -------------------------------------------- */
/*  Too large                                    */
/* -------------------------------------------- */

{
  const many = Object.fromEntries(Array.from({ length: 401 }, (_, n) => {
    const id = `many${String(n).padStart(12, '0')}`
    return [`flags.${TIDY}.${JOURNAL}.${id}`, entry(id, `Entry ${n}`, '', n)]
  }))
  let at = app.events.length
  await bram.update(many)
  await until(() => tidyOf('erebor', 'bram', at).length, "Bram's withheld journal", 1500)
  const withheld = lastTidy('erebor', 'bram')
  assert.deepEqual([withheld.entries, withheld.withheld.reason, withheld.withheld.limit], [[], 'tooLarge', 1_000_000], 'more than 400 entries')
  assert.ok(withheld.withheld.bytes > 0)
  appTakes(withheld)
  assert.equal(warnings.filter(w => w.includes("Bram's Tidy 5e Sheets journal")).length, 1, 'the Gamemaster warned')
  assert.match(warnings.at(-1), /Erebor: 405 entries, 0\.\d MB, where the app takes 400 entries and 1\.0 MB/, 'his 4 and 401 more')
  // Still too large after another change: withheld again, not warned again.
  at = app.events.length
  await tidy.edit(bram, 'many000000000000', { value: '<p>x</p>' })
  await until(() => tidyOf('erebor', 'bram', at).length, 'withheld again', 1500)
  assert.equal(lastTidy('erebor', 'bram').withheld.reason, 'tooLarge')
  assert.equal(warnings.filter(w => w.includes("Bram's Tidy 5e Sheets journal")).length, 1, 'warned once a page load')
  // Back under 400, but larger than a post the app takes.
  await bram.update(Object.fromEntries(Object.keys(many).slice(12).map(key => [key, globalThis._del])))
  at = app.events.length
  await bram.update(Object.fromEntries(Array.from({ length: 11 }, (_, n) => [`flags.${TIDY}.${JOURNAL}.many${String(n).padStart(12, '0')}.value`, 'w'.repeat(100_000)])))
  await until(() => tidyOf('erebor', 'bram', at).length, 'withheld for its size', 1500)
  assert.ok(lastTidy('erebor', 'bram').withheld.bytes > 1_000_000, 'larger than a post the app takes')
  // His own journal goes as ever after a hello, the Tidy journal still withheld.
  at = app.events.length
  announce({ campaignId: 'erebor' })
  await until(() => tidyOf('erebor', 'bram', at).length, 'after the hello')
  const book = since(at).find(e => (e.type === 'journal.updated') && (e.data.actorId === 'bram'))
  assert.deepEqual(book.data.journal.notes.map(n => n.title), ['A note'], "Bram's own journal untouched")
  assert.equal(lastTidy('erebor', 'bram').withheld.reason, 'tooLarge')
  // The app taking larger posts, as a heartbeat's answer says: it goes whole; less again, withheld.
  app.features.erebor = { notes: 3, groups: 1, maxBytes: 4_000_000 }
  at = app.events.length
  beat()
  await until(() => tidyOf('erebor', 'bram', at).some(d => !d.withheld), 'whole, once the app takes larger posts', 2000)
  assert.equal(lastTidy('erebor', 'bram').entries.length, 16, 'his 4 and 12 more')
  assert.deepEqual(tidyOf('erebor', null, at).map(d => d.actorId).sort(), ['bram', 'ghost', 'thorin'], 'every character afresh: what was told forgotten')
  app.features.erebor = { notes: 3, groups: 1 }
  at = app.events.length
  beat()
  await until(() => tidyOf('erebor', 'bram', at).length, 'withheld again', 2000)
  assert.equal(lastTidy('erebor', 'bram').withheld.reason, 'tooLarge')
  assert.equal(warnings.filter(w => w.includes("Bram's Tidy 5e Sheets journal")).length, 1)
  await bram.update(Object.fromEntries(Object.keys(many).slice(0, 12).map(key => [key, globalThis._del])))
  await wait(700)
  assert.deepEqual(lastTidy('erebor', 'bram').entries.map(e => e.id), bramSent.entries.map(e => e.id), 'back to what it was')
}
ok("past 400 entries, or larger than the app takes, a Tidy journal is withheld `tooLarge` with its size and the limit, the Gamemaster warned once a page load, the character's own journal untouched; once the app takes larger posts it goes, every character afresh, and is withheld again once it takes less")

/* -------------------------------------------- */
/*  Tidy turned off, and uninstalled            */
/* -------------------------------------------- */

tidyModule.active = false
from = app.events.length
announce({ campaignId: 'erebor' })
await until(() => tidyOf('erebor', null, from).length >= 3, 'the Tidy journals with Tidy off')
assert.deepEqual(helloOf('erebor').data.features.notes.tidy, { active: false, version: TIDY_VERSION, actors: ['thorin', 'ghost', 'bram'] })
assert.deepEqual(settingsModule('erebor'), { id: TIDY, title: 'Tidy 5e Sheets', version: TIDY_VERSION, active: false })
assert.deepEqual(lastTidy('erebor', 'thorin').entries.map(e => e.id), ['bbbbbbbbbbbbbbb2', 'ccccccccccccccc3', 'ddddddddddddddd4', 'notes1', 'notes2', 'notes3', 'notes'])
ok("Tidy turned off: the hello says `active: false` and its version, settings.modules lists it not active, and the entries are still read and sent")

game.modules.delete(TIDY)
from = app.events.length
announce()
await until(() => tidyOf('erebor', null, from).length >= 3, 'the Tidy journals with Tidy uninstalled')
await until(() => helloOf('shire') && since(from).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'shire')), "the Shire's hello")
assert.deepEqual(helloOf('erebor').data.features.notes.tidy, { active: false, version: null, actors: ['thorin', 'ghost', 'bram'] })
assert.equal(settingsModule('erebor'), undefined, 'not in settings.modules')
assert.deepEqual(Object.keys(helloOf('shire').data.features.notes), ['enabled', 'kinds', 'reason', 'journals', 'orders', 'changes'], 'left out where none holds entries')
assert.equal(lastTidy('erebor', 'ghost').entries.length, 1)
// Read from Foundry's source data, should a Foundry keep an inactive module's flags out of `flags`.
const kept = { [JOURNAL]: { kept000000000001: entry('kept000000000001', 'Kept', '<p>Here.</p>', 1) } }
assert.deepEqual(tidyEntries(new TidyActor({ id: 'kili', name: 'Kili', owners: ['bob'], source: { [TIDY]: kept } })).map(e => e.title), ['Kept'])
ok("Tidy uninstalled: the hello says `version: null` where characters hold entries, nothing where none does, settings.modules leaves it out, and the entries are still read off the character, from its source data too")
game.modules.set(TIDY, Object.assign(tidyModule, { active: true }))

/* -------------------------------------------- */
/*  Another system                              */
/* -------------------------------------------- */

game.system.id = 'pf2e'
assert.deepEqual(tidyHello(campaign('erebor')), {}, 'no `tidy` in the hello')
{
  const at = app.events.length
  await tidy.edit(thorin, 'bbbbbbbbbbbbbbb2', { value: '<p>Under another system.</p>' })
  await wait(700)
  assert.deepEqual(tidyOf('erebor', null, at), [], 'nothing sent')
}
game.system.id = 'dnd5e'
ok('under a system other than D&D Fifth Edition the hello says no `tidy`, and nothing is sent')

/* -------------------------------------------- */
/*  No Gamemaster; one lost                     */
/* -------------------------------------------- */

await J.bridgeOff()
{
  const at = app.events.length
  await tidy.edit(thorin, 'bbbbbbbbbbbbbbb2', { value: '<p>While no GM was here.</p>' })
  await wait(700)
  assert.deepEqual(since(at), [], 'nothing sent with no Gamemaster')
  await J.bridgeOn()
  await until(() => tidyOf('erebor', 'thorin', at).length, 'after the hello')
  assert.equal(byId(lastTidy('erebor', 'thorin'), 'bbbbbbbbbbbbbbb2').html, '<p>While no GM was here.</p>')
  const after = since(at)
  assert.ok(after.findIndex(e => (e.type === 'bridge.hello') && (e.campaign.id === 'erebor')) < after.findIndex(e => isTidy(e, 'erebor', 'thorin')))
}
ok("a change made while no Gamemaster is connected is sent after the next hello")

{
  let failed = 0
  app.fail = body => (body.type === 'journal.tidy') && (++failed <= 3)
  const at = app.events.length
  await tidy.edit(thorin, 'bbbbbbbbbbbbbbb2', { value: '<p>Lost on its way.</p>' })
  await until(() => failed >= 3, 'three failures', 2000)
  await wait(200)
  app.fail = null
  assert.deepEqual(tidyOf('erebor', 'thorin', at), [], 'not delivered')
  beatAhead(ahead += 60_000)
  await until(() => tidyOf('erebor', 'thorin', at).length, 'sent again after a hello', 3000)
  assert.ok(since(at).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'erebor')), 'a hello first')
  assert.equal(byId(lastTidy('erebor', 'thorin'), 'bbbbbbbbbbbbbbb2').html, '<p>Lost on its way.</p>')
}
ok('a journal.tidy lost to failures that might not last sends the hello again a while later, which it follows')

/* -------------------------------------------- */
/*  The settings window's Works with            */
/* -------------------------------------------- */

const worksWith = async () => {
  const win = await openSettings()
  await view(win, 'modules')
  const group = [...win.element.querySelectorAll('.sending-stone-group')].find(g => g.querySelector('.sending-stone-group-heading').textContent === words['SENDINGSTONE.Modules.WorksWith'])
  const cards = [...group.querySelectorAll('.sending-stone-card')].map(card => ({
    title: card.querySelector('strong').textContent,
    hint: card.querySelector('.hint').textContent,
    icon: card.querySelector('.sending-stone-card-icon i').className,
    state: card.querySelector('.sending-stone-pill').textContent,
    tone: card.querySelector('.sending-stone-pill').dataset.tone,
  }))
  await win.close()
  return cards
}
const HINT = words['SENDINGSTONE.Modules.Tidy.Hint']
assert.ok(HINT && words['SENDINGSTONE.Modules.Tidy.Title'], 'the lang file has both strings')
{
  const cards = await worksWith()
  assert.equal(cards.length, 3, 'Midi-QOL, libWrapper and Tidy')
  assert.deepEqual(cards[2], { title: 'Tidy 5e Sheets', hint: HINT, icon: 'fa-solid fa-book-open', state: words['SENDINGSTONE.Modules.State.active'], tone: 'ok' })
  tidyModule.active = false
  assert.deepEqual((await worksWith())[2], { title: 'Tidy 5e Sheets', hint: HINT, icon: 'fa-solid fa-book-open', state: words['SENDINGSTONE.Modules.State.inactive'], tone: 'idle' })
  game.modules.delete(TIDY)
  assert.deepEqual((await worksWith())[2], { title: words['SENDINGSTONE.Modules.Tidy.Title'], hint: HINT, icon: 'fa-solid fa-book-open', state: words['SENDINGSTONE.Modules.State.missing'], tone: 'idle' })
  game.modules.set(TIDY, Object.assign(tidyModule, { active: true }))
}
ok('the settings window\'s Modules tab lists Tidy 5e Sheets under "Works with", after libWrapper: Active, Not enabled or Not installed, the last two in the neutral tone, with its title and hint from the lang file')

/* -------------------------------------------- */

const posted = app.events.filter(e => e.type === 'journal.tidy')
for (const e of posted) appTakes(e.data)
assert.ok(posted.every(e => ['erebor', 'mirkwood'].includes(e.campaign.id) && ['thorin', 'ghost', 'bram'].includes(e.data.actorId)), "only the campaigns' characters, never a group or anyone else")
assert.ok(posted.every(e => Number.isInteger(e.sequence)), 'part of the event stream')
assert.deepEqual(logged.filter(line => /tidy/i.test(line) && !/Could not deliver journal\.tidy .*HTTP 503/.test(line)), [], 'nothing of Tidy logged but the failures made on purpose')
ok(`every journal.tidy posted (${posted.length}) is one the app takes, part of the event stream, for the campaigns' characters alone`)

console.log(`tidy-journal${DND5E6 ? ' (dnd5e 6)' : ''}: ${oks} done`)
process.exit(0)
