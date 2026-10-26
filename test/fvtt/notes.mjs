// Journal notes (module 0.34.0, its contract §2-§5, §7): the hello's `features.notes`, with no
// switch, and the fetching it needs with the campaign's rolls, moves and removals off; the `note`
// command's checks; journals found by flag, made lazily per book and campaign, in their folder, with
// their ownership and flags; a page per chapter and per note, made with the app's id in a call of
// its own; who may change what, in the app's command and in Foundry; made at most once in effect,
// one at a time past the watchdog; Foundry's order; `journal.updated` before every result, and after
// every change heard of in Foundry, with only what's shared as the journal is, never a secret its
// readers couldn't read in Foundry, and nothing the app's schema wouldn't take, nor to an app that
// doesn't read it; ownership kept in step with the actors'; who changed a note in Foundry, through
// the module's own writes; what a journal holds, and who may write; and the safeguards against
// Foundry's own edits. Since module 0.35.0 (its contract §2-§6, §6.9): a group's notes put in order
// from the app by anyone who may see the party, Foundry's order kept with new and moved notes last,
// and who deleted or reordered a page in Foundry, told to an app that answers `notes: 2`. On
// journal-core.mjs's stand-in for Foundry's journals,
// stub.mjs's core and a stand-in app; the real module and its language file. Timers of a second or
// more run a hundred times faster, so the 60 s watchdog fires in 600 ms. Under DND5E6=1 the system
// says dnd5e 6.0.5: notes touch nothing of dnd5e, so the same cases pass. Run with --import
// ./unref-timers.mjs --import ./dnd5e-register.mjs.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { settings, user, users, actors } from './stub.mjs'

const MODULE = process.env.MODULE_DIR
const DND5E6 = Boolean(process.env.DND5E6)
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
const { showdown, faults, writes, as, editPage, addPage, deletePage, deleteJournal, duplicatePage, duplicateJournal, pagesOf, journalOf } = J
const markdownToContent = markdown => foundry.utils.cleanHTML(new showdown.Converter({ ...CONST.SHOWDOWN_OPTIONS }).makeHtml(markdown))

// ---- The world ----
users.activeGM = user('gm', 'Gamemaster', true)
for (const [id, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['carol', 'Carol'], ['dave', 'Dave']]) user(id, name)
/** A character, with its ownership as Foundry keeps it, which a test may change. */
function character(id, name, owners) {
  const a = {
    documentName: 'Actor', id, name, type: 'character', uuid: `Actor.${id}`, img: `${id}.webp`,
    ownership: { default: 0, ...Object.fromEntries(owners.map(u => [u, 3])) },
    system: { attributes: { hp: { value: 30, max: 40, temp: 0 } } },
    get hasPlayerOwner() { return users.some(u => !u.isGM && this.testUserPermission(u, 'OWNER')) },
    getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
    testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
  }
  actors.set(id, a)
  return a
}
// Thorin (Alice, assigned), Vex (Bob), Ghost (no player), Bram (Dave), Erebor's; Mara (Carol, a table
// player in no campaign). The Iron Company: Alice its Owner, Bob and Carol Observers, None to the rest.
const thorin = character('thorin', 'Thorin', ['alice'])
const vex = character('vex', 'Vex', ['bob'])
const ghost = character('ghost', 'Ghost', [])
const bram = character('bram', 'Bram', ['dave'])
character('mara', 'Mara', ['carol'])
users.get('alice').character = thorin
const members = [thorin, vex]
const list = members.map(m => ({ actor: m }))
Object.defineProperty(list, 'ids', { value: new Set(members.map(m => m.id)), enumerable: false })
const company = {
  documentName: 'Actor', id: 'company', name: 'The Iron Company', type: 'group', uuid: 'Actor.company', img: 'company.webp',
  ownership: { default: 0, alice: 3, bob: 2, carol: 2 }, flags: {},
  system: { members: list, description: { full: '', summary: '' }, currency: {} },
  items: { get: () => undefined, [Symbol.iterator]: () => [][Symbol.iterator]() },
  getUserLevel(u) { return u.isGM ? 3 : (this.ownership[u.id] ?? this.ownership.default ?? 0) },
  testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
}
actors.set('company', company)
/** Change an actor's ownership as the Gamemaster would in Foundry, and wait for what follows to settle. */
async function own(actor, changes) {
  Object.assign(actor.ownership, changes)
  await Hooks.callAll('updateActor', actor, { ownership: changes }, {}, 'gm')
  await wait(450)
}

// ---- The app ----
// The app reads who changed a journal in Foundry, and sends orders (module 0.35.0): `notes: 2`.
const NOTES = { commands: true, notes: 2, groups: 1 }
const app = { events: [], polls: [], waiting: new Map(), wakes: new Map(), features: { erebor: NOTES, mirkwood: NOTES }, fail: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    if (app.fail?.(body)) return { ok: false, status: 503, statusText: 'Unavailable', headers: new Headers() }
    // A hello the app is slow to answer, as when the Gamemaster comes back.
    if (app.holdHello && (body.type === 'bridge.hello')) await wait(app.holdHello)
    app.events.push(body)
    // As the app answers them (its src/app/api/events/route.ts, ANSWERED_WITH_FEATURES): a sheet's
    // post too, so that what it takes of posts holds after the sheets a change of it sends.
    const announcing = ['bridge.hello', 'bridge.heartbeat', 'character.updated', 'group.updated'].includes(body.type)
    return announcing ? json({ features: app.features[body.campaign.id] ?? {} }) : { ok: true, status: 204, statusText: 'No Content', headers: new Headers() }
  }
  if (String(url).endsWith('/api/bridge/commands')) {
    const id = body.campaign.id
    app.polls.push({ at: performance.now(), id })
    if (!app.waiting.get(id)?.length) {
      await new Promise(resolve => {
        const timer = realSetTimeout(resolve, 30)
        app.wakes.set(id, () => { clearTimeout(timer); resolve() })
        init.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    const commands = app.waiting.get(id) ?? []
    app.waiting.set(id, [])
    return json({ commands })
  }
  throw new TypeError(`Unexpected fetch of ${url}`)
}
async function until(test, what, ms = 4000) {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(5)
  }
}
const resultsOf = id => app.events.filter(e => (e.type === 'command.result') && (e.data.id === id)).map(e => e.data)
const resultIndex = id => app.events.findIndex(e => (e.type === 'command.result') && (e.data.id === id))
const isBook = (e, campaignId, kind, actorId) => (e.type === 'journal.updated') && (e.campaign.id === campaignId)
  && (!kind || (e.data.kind === kind)) && (!actorId || (e.data.actorId === actorId))
const booksOf = (campaignId, kind, actorId) => app.events.filter(e => isBook(e, campaignId, kind, actorId)).map(e => e.data)
const lastBook = (campaignId, kind, actorId) => booksOf(campaignId, kind, actorId).at(-1)
const noteIn = (book, id) => book?.journal?.notes.find(note => note.id === id) ?? null
const helloOf = campaignId => app.events.filter(e => (e.type === 'bridge.hello') && (e.campaign.id === campaignId)).at(-1)

/** Hand the module commands in one fetch, without waiting on them. */
function handOver(campaignId, ...commands) {
  app.waiting.set(campaignId, [...(app.waiting.get(campaignId) ?? []), ...commands])
  app.wakes.get(campaignId)?.()
}
/** Hand the module commands in one fetch; resolve once each has its result, with what was posted meanwhile. */
async function fetched(campaignId, ...commands) {
  const from = app.events.length
  const counts = commands.map(command => resultsOf(command.id).length)
  handOver(campaignId, ...commands)
  await until(() => commands.every((command, n) => resultsOf(command.id).length > counts[n]), `the result of ${commands.map(c => c.id).join(', ')}`)
  return commands.map((command, n) => {
    const index = app.events.findIndex((e, at) => (at >= from) && (e.type === 'command.result') && (e.data.id === command.id))
    return { command, result: app.events[index].data, before: app.events.slice(from, index), index }
  })
}
const made = async (campaignId, command) => (await fetched(campaignId, command))[0]
const refusal = ({ result }) => [result.status, result.reason, result.error]

let noteIds = 0
/** A note's id, as the app makes them: 16 letters and digits. */
const nid = () => `n${String(++noteIds).padStart(15, '0')}`
let clock = 1_000
/** A note command as the app hands it over (round §3.4): its id `<write id>.<seq>`. */
function command(actorId, note, { by, seq = 0 } = {}) {
  return { id: `${randomUUID()}.${seq}`, actorId, kind: 'note', ...(by && { by }), note, mode: 0, explicit: false, extras: [], dice: [] }
}
function create({ book = 'personal', actorId = 'thorin', role = 'entry', id = nid(), title = 'A note', markdown = 'Some text.', chapter = null, writer = actorId, by, at = ++clock, createdAt = at } = {}) {
  return command(actorId, { book, op: 'create', id, role, base: null, writer: by ? null : writer, at, title, ...((role === 'entry') && { markdown, chapter }), createdAt }, { by })
}
function update(page, { book = 'personal', actorId = 'thorin', title = page.name, markdown, chapter, writer = actorId, by, at = ++clock, base, role } = {}) {
  const flags = page.flags['sending-stone']
  role ??= flags?.role ?? (page.title.level === 1 ? 'chapter' : 'entry')
  const entry = role === 'entry'
  return command(actorId, {
    book, op: 'update', id: page.id, role, base: base ?? pageRev(page), writer: by ? null : writer, at, title,
    ...(entry && { markdown: markdown ?? page.text.markdown, chapter: (chapter === undefined) ? (flags?.chapter ?? null) : chapter }),
  }, { by })
}
function remove(page, { book = 'personal', actorId = 'thorin', writer = actorId, by, at = ++clock, base, role = 'entry' } = {}) {
  return command(actorId, { book, op: 'delete', id: page.id ?? page, role, base: base ?? pageRev(page), writer: by ? null : writer, at }, { by })
}

/**
 * The app's schema for `journal.updated` (its src/schemas/sending-stone.ts, round 0.34.0 §8.3),
 * as far as a note's caps go: one note it wouldn't take fails the whole event.
 */
function appTakes(data) {
  const ACTOR = /^[\dA-Za-z]{1,64}$/
  const NOTE = /^[A-Za-z0-9]{16}$/
  const whole = v => Number.isInteger(v) && (v >= 0)
  const text = (v, most, least = 0) => (typeof v === 'string') && (v.length >= least) && (v.length <= most)
  assert.ok(['personal', 'party'].includes(data.kind) && ACTOR.test(data.actorId), 'kind and actorId')
  if (data.withheld) {
    assert.equal(data.journal, null)
    assert.ok((data.withheld.reason === 'private') || ((data.withheld.reason === 'tooLarge') && whole(data.withheld.bytes) && whole(data.withheld.limit)))
    return true
  }
  if (data.journal === null) return true
  assert.ok(text(data.journal.name, 200) && (typeof data.journal.id === 'string'), 'the journal')
  // Who last deleted or reordered a page in Foundry (module 0.35.0), only where it's said.
  assert.deepEqual(Object.keys(data.journal).filter(key => !['id', 'name', 'notes', 'changed'].includes(key)), [], 'the journal\'s keys')
  if ('changed' in data.journal) {
    const { changed } = data.journal
    assert.deepEqual(Object.keys(changed), ['what', 'by', 'at'], 'changed: its keys')
    assert.ok(['delete', 'order'].includes(changed.what) && text(changed.by, 200, 1) && Number.isInteger(changed.at) && (changed.at > 0), 'changed')
  }
  assert.ok(Array.isArray(data.journal.notes) && (data.journal.notes.length <= 400), 'at most 400 notes')
  for (const note of data.journal.notes) {
    const what = `note ${note.id}`
    assert.ok(NOTE.test(note.id), `${what}: id`)
    assert.ok(['chapter', 'entry'].includes(note.role), `${what}: role`)
    assert.ok((note.chapter === null) || NOTE.test(note.chapter), `${what}: chapter`)
    assert.ok(text(note.title, 200, 1), `${what}: title`)
    assert.ok([1, 2].includes(note.format), `${what}: format`)
    assert.ok((note.format === 2) ? text(note.markdown, 100_000) : text(note.html, 100_000), `${what}: body`)
    assert.ok([undefined, true].includes(note.cut) && [undefined, true].includes(note.secret), `${what}: marks`)
    assert.ok(!note.secret || (note.format === 1), `${what}: a secret goes as HTML`)
    assert.ok(whole(note.createdAt) && whole(note.modifiedAt), `${what}: times`)
    assert.ok(text(note.modifiedBy, 200) && ['app', 'foundry'].includes(note.modifiedIn), `${what}: who`)
    assert.ok((note.author === null) || ((note.author.actorId === null || ACTOR.test(note.author.actorId)) && (typeof note.author.gm === 'boolean') && text(note.author.name, 200)), `${what}: author`)
    assert.ok(/^[\da-f]{14}$/.test(note.rev), `${what}: rev`)
  }
  return true
}

// ---- Start-up ----
await import(`${MODULE}/scripts/module.mjs`)
await Hooks.callAll('init')
settings.set('listenerUrl', 'https://stone.example')
settings.set('campaignSecrets', { erebor: 'erebor-secret', mirkwood: 'mirkwood-secret' })
settings.set('campaigns', [
  { id: 'erebor', title: 'Erebor', characters: ['thorin', 'vex', 'ghost', 'bram'], groups: ['company'], rolls: false, attacks: false, transfers: false },
  { id: 'mirkwood', title: 'Mirkwood', characters: ['thorin'], groups: [], rolls: false, attacks: false, transfers: false },
])
await Hooks.callAll('ready')
const { announce } = await import(`${MODULE}/scripts/bridge.mjs`)
const { heartbeat } = await import(`${MODULE}/scripts/heartbeat.mjs`)
const { checkCommand } = await import(`${MODULE}/scripts/command-rolls.mjs`)
const { checkNoteCommand, runNoteCommand } = await import(`${MODULE}/scripts/command-notes.mjs`)
const { flagsCount, noteFeatures, pageRev, pageRole, sharedLikeJournal } = await import(`${MODULE}/scripts/journals.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const erebor = () => getCampaigns().find(c => c.id === 'erebor')
await until(() => helloOf('erebor') && helloOf('mirkwood'), 'the hellos')

/* -------------------------------------------- */
/*  The hello and fetching                      */
/* -------------------------------------------- */

const NONE_YET = { enabled: true, kinds: ['personal', 'party'], reason: null, journals: [], orders: true, changes: true }
for (const id of ['erebor', 'mirkwood']) {
  assert.deepEqual(helloOf(id).data.features.notes, NONE_YET)
  // Changed on purpose (round 0.36.0 §4.1): and what its companions take.
  // Changed on purpose (round 0.37.0 §6.7): and whether favorites are added and removed here.
  // Changed on purpose (round 0.38.0 §D8.3): and whether dishes from the Magical Recipe Book are taken, after favorites.
  // Changed on purpose (round 0.39.0 §1.9): and whether its players change their own effects, after dishes.
  assert.deepEqual(Object.keys(helloOf(id).data.features), ['rolls', 'transfers', 'removals', 'notes', 'companions', 'favorites', 'dishes', 'effects'])
  assert.deepEqual(Object.keys(helloOf(id).data.features.notes), ['enabled', 'kinds', 'reason', 'journals', 'orders', 'changes'])
  assert.equal(helloOf(id).data.features.rolls.enabled, false)
}
game.system.id = 'pf2e'
assert.deepEqual(noteFeatures(erebor()), NONE_YET, 'under another system, notes still')
game.system.id = 'dnd5e'
ok("every hello's features.notes, after removals: kept here, both kinds, no reason, no journal yet, and since 0.35.0 orders and changes; under another system the same")

// Fetched with the campaigns' rolls, moves and removals off, where the app takes notes; not where it doesn't.
await until(() => app.polls.some(p => p.id === 'erebor') && app.polls.some(p => p.id === 'mirkwood'), 'fetching with rolls, moves and removals off')
const pollsSince = (id, at) => app.polls.filter(p => (p.id === id) && (p.at > at)).length
for (const answer of [{ commands: true }, { commands: true, notes: 0, groups: 1 }, { commands: true, notes: '1', groups: 1 }]) {
  app.features.erebor = answer
  announce({ campaignId: 'erebor' })
  await wait(120)
  const at = performance.now()
  await wait(150)
  assert.equal(pollsSince('erebor', at), 0, `no fetch for ${JSON.stringify(answer)}`)
}
app.features.erebor = NOTES
announce({ campaignId: 'erebor' })
await wait(150)
const at0 = performance.now()
await wait(150)
assert.ok(pollsSince('erebor', at0) > 0, 'fetched again')
ok('fetched for notes with rolls, moves and removals off where the app says `notes: 1`; not with `{ commands: true }` alone, `notes: 0` or `notes: "1"`')

/* -------------------------------------------- */
/*  The command's checks                        */
/* -------------------------------------------- */

const base14 = 'abcdef01234567'
const C = (note = {}, fields = {}) => ({ ...create(), ...fields, note: { ...create().note, ...note } })
const U = (note = {}, fields = {}) => {
  const c = create()
  return { ...c, ...fields, note: { book: 'personal', op: 'update', id: nid(), role: 'entry', base: base14, writer: 'thorin', at: 5, title: 'T', markdown: '', chapter: null, ...note } }
}
const without = (object, key) => { const copy = { ...object }; delete copy[key]; return copy }
const checks = [
  ['note', { ...create(), note: undefined }],
  ['note', { ...create(), note: [] }],
  ['note', C({}, { key: 'prc' })],
  ['note', C({}, { transfer: {} })],
  ['note', C({}, { remove: { item: 'x' } })],
  ['note', C({}, { typed: true })],
  ['note', C({ extra: 1 })],
  ['note', { ...create(), note: without(create().note, 'createdAt') }],
  ['note', C({ book: 'diary' })],
  ['note', C({ op: 'move' })],
  ['note', C({ role: 'page' })],
  ['note', { ...create(), note: { book: 'personal', op: 'delete', id: nid(), role: 'chapter', base: base14, writer: 'thorin', at: 5 } }],
  ['note', C({ id: 'n00000000000001' })],
  ['note', C({ id: 'n0000000000000001' })],
  ['note', C({ id: 'n00000000000-001' })],
  ['title', C({ title: '' })],
  ['title', C({ title: '   ' })],
  ['title', C({ title: 'x'.repeat(201) })],
  ['title', C({ title: 'two\nlines' })],
  ['title', C({ title: 'two\rlines' })],
  ['body', C({ markdown: 'x'.repeat(20_001) })],
  ['body', C({ markdown: null })],
  ['chapter', C({ chapter: 'a b' })],
  ['chapter', C({ chapter: 'n00000000000001' })],
  ['base', C({ base: base14 })],
  ['base', U({ base: null })],
  ['base', U({ base: 'ABCDEF01234567' })],
  ['base', U({ base: 'abcdef0123456' })],
  ['writer', C({ writer: null })],
  ['writer', C({ writer: 'vex' })],
  ['writer', C({ writer: 7 })],
  ['note', C({ at: 0 })],
  ['note', C({ createdAt: 1.5 })],
  ['dice', C({}, { dice: [{ faces: 20, value: 3 }] })],
  ['dice', C({}, { mode: 1 })],
]
for (const [word, cmd] of checks) assert.equal(checkNoteCommand(cmd), word, `${word}: ${JSON.stringify(cmd.note)?.slice(0, 120)}`)
for (const cmd of [C(), C({ title: 'x'.repeat(200) }), C({ title: '  padded  ' }), C({ markdown: 'x'.repeat(20_000) }), C({ markdown: '' }), C({ role: 'chapter', markdown: undefined, chapter: undefined }),
  U(), U({ role: 'chapter', markdown: undefined, chapter: undefined }), { ...create(), note: { book: 'personal', op: 'delete', id: nid(), role: 'entry', base: base14, writer: 'thorin', at: 5 } },
  C({ writer: null }, { by: 'gm' }), C({ book: 'party', writer: 'vex' }, { actorId: 'company' })]) {
  const clean = { ...cmd, note: Object.fromEntries(Object.entries(cmd.note).filter(([, v]) => v !== undefined)) }
  assert.equal(checkNoteCommand(clean), null, JSON.stringify(clean.note).slice(0, 120))
}
assert.equal(checkCommand(C({}, { by: 'player' })), 'by', 'by is checked first')
assert.equal(checkCommand(C({ title: '' })), 'title', 'checkCommand reaches the note check')
const invalid = await made('erebor', C({ title: '' }))
assert.deepEqual(refusal(invalid), ['failed', 'invalid', 'title'])
assert.equal(invalid.before.filter(e => e.type === 'journal.updated').length, 0, 'no journal before step 6')
ok('the note check: `note` for a missing or listed note, a roll field, a move, removal or typed dice, an extra or missing key, an unknown book, op or role, a chapter delete, an id of 15 or 17 characters or with a dash, a time not a positive whole number; `title` empty, 201 characters or two lines (200 passes, trimmed); `body` past 20,000; `chapter`; `base` on a create, or not 14 hex on an update; `writer` null without `by`, or not the book\'s; `dice`; `by` first; and through the pipe, `invalid`')

/* -------------------------------------------- */
/*  Create, personal                            */
/* -------------------------------------------- */

const writesBefore = writes.length
const chapterOne = create({ role: 'chapter', title: 'Session 1', markdown: undefined })
const BODY = '### Loot\n- 30 gp\n- a *strange* key\n\n| Who | What |\n|---|---|\n| Vex | rope |\n\n~~struck~~'
const cave = create({ title: 'The goblin cave', markdown: BODY, chapter: chapterOne.note.id })
const [madeChapter] = await fetched('erebor', chapterOne)
const madeCave = await made('erebor', cave)
const journal = journalOf('personal', 'thorin', 'erebor')
assert.ok(journal, 'a journal for Thorin in Erebor')
assert.equal(J.journals().length, 1)
const folders = [...game.folders.values()]
assert.equal(folders.length, 1, 'one folder, made once')
assert.deepEqual([folders[0].name, folders[0].type, folders[0].sorting, folders[0].flags['sending-stone']], ['Sending Stone notes', 'JournalEntry', 'a', { folder: 'notes' }])
assert.equal(journal.folder, folders[0].id)
assert.equal(journal.name, "Thorin's notes (Erebor)", 'named for the campaign too, as Thorin is in two')
assert.deepEqual(journal.flags.core, { viewMode: 2, locked: true })
assert.deepEqual(journal.flags['sending-stone'].journal, { kind: 'personal', actor: 'thorin', campaign: 'erebor', granted: ['alice'], default: 0 })
assert.deepEqual(journal.ownership, { default: 0, alice: 3 })
const made1 = writes.slice(writesBefore)
const journalWrite = made1.find(w => w[0] === 'journal')
assert.ok(journalWrite && !('pages' in journalWrite[2]), "no page made through the journal's own create")
const creates = made1.filter(w => w[0] === 'create')
assert.deepEqual(creates.map(w => [w[2], w[3]]), [[[chapterOne.note.id], { keepId: true }], [[cave.note.id], { keepId: true }]], 'two creates, each with its own id, keepId')
const chapterPage = journal.pages.get(chapterOne.note.id)
const cavePage = journal.pages.get(cave.note.id)
assert.ok(chapterPage && cavePage, "each page's id the note's")
assert.equal(made1.filter(w => w[0] === 'update').length, 0, 'no page update after either create')
assert.deepEqual([chapterPage.title, cavePage.title], [{ show: true, level: 1 }, { show: true, level: 2 }])
assert.deepEqual(cavePage.text, { format: 2, markdown: BODY, content: markdownToContent(BODY) })
assert.match(cavePage.text.content, /<table>/)
assert.match(cavePage.text.content, /<h3>Loot<\/h3>/)
assert.deepEqual(chapterPage.text, { format: 2, markdown: '', content: '' })
assert.equal(cavePage.flags.core.sheetClass, 'core.JournalEntryPageMarkdownSheet')
assert.deepEqual(cavePage.ownership, { default: -1 })
const caveFlags = cavePage.flags['sending-stone']
assert.deepEqual(caveFlags, {
  page: cave.note.id, role: 'entry', chapter: chapterOne.note.id, author: { actor: 'thorin', gm: false }, createdAt: cave.note.createdAt,
  modified: { actor: 'thorin', gm: false, at: cave.note.at }, hash: caveFlags.hash, granted: [],
})
assert.deepEqual(chapterPage.flags['sending-stone'], {
  page: chapterOne.note.id, role: 'chapter', chapter: null, author: { actor: 'thorin', gm: false }, createdAt: chapterOne.note.createdAt,
  modified: { actor: 'thorin', gm: false, at: chapterOne.note.at }, hash: pageRev(chapterPage), granted: [],
})
assert.equal(caveFlags.hash, pageRev(cavePage))
assert.ok(flagsCount(cavePage) && flagsCount(chapterPage))
// The book before the result, to Erebor alone.
const caveBookAt = madeCave.before.findLastIndex(e => isBook(e, 'erebor', 'personal', 'thorin'))
assert.ok(caveBookAt >= 0, 'the book before the result')
assert.equal(booksOf('mirkwood').length, 0, 'nothing to Mirkwood')
const caveBook = madeCave.before[caveBookAt].data
assert.deepEqual(madeCave.result, { id: cave.id, status: 'done', reason: null, error: null, messageId: null, visible: false, rolls: [], note: { id: cave.note.id, rev: pageRev(cavePage) } })
assert.deepEqual(madeChapter.result.note, { id: chapterOne.note.id, rev: pageRev(chapterPage) })
assert.deepEqual(Object.keys(caveBook), ['kind', 'actorId', 'journal'])
assert.deepEqual({ ...caveBook.journal, notes: undefined }, { id: journal.id, name: "Thorin's notes (Erebor)", notes: undefined })
assert.deepEqual(noteIn(caveBook, cave.note.id), {
  id: cave.note.id, role: 'entry', chapter: chapterOne.note.id, title: 'The goblin cave', format: 2, markdown: BODY,
  createdAt: cave.note.createdAt, modifiedAt: cave.note.at, modifiedBy: 'Thorin', modifiedIn: 'app',
  author: { actorId: 'thorin', gm: false, name: 'Thorin' }, rev: madeCave.result.note.rev,
})
assert.deepEqual(Object.keys(noteIn(caveBook, cave.note.id)), ['id', 'role', 'chapter', 'title', 'format', 'markdown', 'createdAt', 'modifiedAt', 'modifiedBy', 'modifiedIn', 'author', 'rev'])
assert.deepEqual(noteIn(caveBook, chapterOne.note.id), {
  id: chapterOne.note.id, role: 'chapter', chapter: null, title: 'Session 1', format: 2, markdown: '',
  createdAt: chapterOne.note.createdAt, modifiedAt: chapterOne.note.at, modifiedBy: 'Thorin', modifiedIn: 'app',
  author: { actorId: 'thorin', gm: false, name: 'Thorin' }, rev: madeChapter.result.note.rev,
})
// The hello lists Erebor's journal, and Mirkwood's none: it's another campaign's.
const hellosThen = app.events.length
announce()
await until(() => app.events.slice(hellosThen).filter(e => e.type === 'bridge.hello').length === 2, 'both hellos')
assert.deepEqual(helloOf('erebor').data.features.notes.journals, [{ kind: 'personal', actorId: 'thorin' }])
assert.deepEqual(helloOf('mirkwood').data.features.notes.journals, [])
const helloAt = app.events.indexOf(helloOf('erebor'))
await until(() => app.events.slice(helloAt).some(e => isBook(e, 'erebor', 'personal', 'thorin')), 'the book after the hello')
const afterHello = app.events.slice(helloAt).filter(e => e.campaign.id === 'erebor')
assert.ok(afterHello.findIndex(e => isBook(e, 'erebor', 'personal', 'thorin')) > afterHello.findLastIndex(e => ['character.updated', 'group.updated'].includes(e.type)), "after the hello's sheets and groups")
assert.equal(booksOf('mirkwood').length, 0, 'Mirkwood, with no journal, is sent no book')
// The same character in Mirkwood: a journal of its own there.
await wait(100)
const ereborBooks = booksOf('erebor', 'personal', 'thorin').length
const away = await made('mirkwood', create({ title: 'Elsewhere', markdown: 'In the forest.' }))
assert.equal(away.result.status, 'done')
const mirkwood = journalOf('personal', 'thorin', 'mirkwood')
assert.ok(mirkwood && (mirkwood !== journal))
assert.equal(mirkwood.name, "Thorin's notes (Mirkwood)")
assert.equal(mirkwood.flags['sending-stone'].journal.campaign, 'mirkwood')
assert.equal(mirkwood.folder, folders[0].id, 'the same folder')
assert.equal(game.folders.size, 1)
assert.equal(booksOf('erebor', 'personal', 'thorin').length, ereborBooks, "Erebor's book doesn't change")
assert.deepEqual(lastBook('mirkwood', 'personal', 'thorin').journal.notes.map(n => n.title), ['Elsewhere'])
ok("the hello's journals list each campaign's books with a journal for that campaign, each book following its sheets and groups; Thorin's first notes: one journal per campaign, \"Thorin's notes (Erebor)\" in the folder Sending Stone notes (made once, flagged), in multi-page view and locked, flagged with its book, Owner to Alice alone; a chapter at level 1 and a note at level 2, each made in a call of its own with the note's id, the note's Markdown and its HTML, the Markdown sheet, and its flags, nothing written after; the book to Erebor before the result, which carries the note's revision; from Mirkwood a second journal")


/* -------------------------------------------- */
/*  Made at most once                           */
/* -------------------------------------------- */

let mark = writes.length
let again = await made('erebor', cave)
assert.deepEqual([again.result.status, again.result.note], ['done', { id: cave.note.id, rev: pageRev(cavePage) }])
assert.equal(writes.length, mark, 'nothing written')
again = await made('erebor', cave)
assert.equal(again.result.status, 'done')
assert.equal(journal.pages.size, 2, 'one page still')
const edit = update(cavePage, { title: 'Goblin cave', markdown: 'Changed once.' })
const first = await made('erebor', edit)
assert.equal(first.result.status, 'done')
assert.deepEqual([cavePage.name, cavePage.text.markdown], ['Goblin cave', 'Changed once.'])
mark = writes.length
const second = await made('erebor', edit)
assert.deepEqual([second.result.status, second.result.reason], ['done', null], 'the same change after it was made, from the old revision: done, not changed')
assert.equal(writes.length, mark, 'written once')
const doomed = await made('erebor', create({ title: 'Doomed' }))
const doomedId = doomed.command.note.id
const gone1 = await made('erebor', remove(journal.pages.get(doomedId)))
assert.deepEqual(gone1.result.note, { id: doomedId, rev: null, deleted: true })
mark = writes.length
const gone2 = await made('erebor', gone1.command)
assert.deepEqual([gone2.result.status, gone2.result.note], ['done', { id: doomedId, rev: null, deleted: true }])
assert.equal(writes.length, mark)
ok('made at most once in effect: a create handed over again, as after a reload, writes nothing and is done with its revision; an update handed twice is written once, the second from the old revision done, not `changed`; a delete of a page already gone is done')

/* -------------------------------------------- */
/*  In flight, and the chain                    */
/* -------------------------------------------- */

let slow = create({ title: 'Held' })
let held = J.hold('create', (entry, data) => data.some(d => d._id === slow.note.id))
handOver('erebor', slow)
await until(() => held.held, 'the held create')
handOver('erebor', slow)
await wait(100)
held.release()
await until(() => resultsOf(slow.id).length === 1, 'its result')
await wait(150)
assert.equal(resultsOf(slow.id).length, 1, 'one result')
assert.equal(journal.pages.filter(p => p.id === slow.note.id).length, 1, 'one page')
// Past the watchdog: told `timeout`, handed over again meanwhile, still the one run.
slow = create({ title: 'Held long' })
held = J.hold('create', (entry, data) => data.some(d => d._id === slow.note.id))
handOver('erebor', slow)
await until(() => held.held, 'the held create')
await until(() => resultsOf(slow.id).length === 1, 'the watchdog', 2000)
assert.deepEqual([resultsOf(slow.id)[0].status, resultsOf(slow.id)[0].reason], ['failed', 'timeout'])
handOver('erebor', slow)
await wait(150)
// The chain: a note command of another journal fetched meanwhile waits for the first's writes.
const behind = create({ actorId: 'vex', title: 'Behind', writer: 'vex' })
handOver('erebor', behind)
await wait(250)
assert.equal(resultsOf(behind.id).length, 0, 'the next note command has not started while the first still writes')
assert.equal(journalOf('personal', 'vex', 'erebor'), null)
held.release()
await until(() => (resultsOf(slow.id).length >= 2) && (resultsOf(behind.id).length === 1), 'the late done and the next', 3000)
await wait(250)
assert.deepEqual(resultsOf(slow.id).map(r => r.status), ['failed', 'done'], 'exactly two results: the timeout and the late done')
assert.equal(journal.pages.filter(p => p.id === slow.note.id).length, 1)
assert.ok(resultIndex(behind.id) > app.events.findLastIndex(e => (e.type === 'command.result') && (e.data.id === slow.id)), 'after the late done')
ok('a note command being made is made once: handed over again while it writes, it is ignored, and past the watchdog too, `timeout` then its late `done`; one of another journal fetched meanwhile waits on the chain until it settles')

// A result lost for good: the next hand-over of the same command is made again and answered.
const lost = create({ title: 'Lost answer' })
app.fail = envelope => (envelope.type === 'command.result') && (envelope.data.id === lost.id)
handOver('erebor', lost)
await until(() => journal.pages.has(lost.note.id), 'the page')
await wait(150)
app.fail = null
assert.equal(resultsOf(lost.id).length, 0, 'the result was lost')
mark = writes.length
const found = await made('erebor', lost)
assert.deepEqual([found.result.status, found.result.note.rev], ['done', pageRev(journal.pages.get(lost.note.id))])
assert.equal(writes.length, mark, 'nothing written')
ok("a result lost on its way: the same command handed over again is made again, writing nothing, and answered")

/* -------------------------------------------- */
/*  Update and delete                           */
/* -------------------------------------------- */

const chapterTwo = await made('erebor', create({ role: 'chapter', title: 'Session 2', markdown: undefined }))
const two = journal.pages.get(chapterTwo.command.note.id)
const moved = await made('erebor', update(cavePage, { chapter: two.id }))
assert.equal(moved.result.status, 'done')
assert.equal(cavePage.flags['sending-stone'].chapter, two.id, 'moved by flag')
const order = () => pagesOf(journal).map(p => p.name)
assert.ok(order().indexOf('Goblin cave') > order().indexOf('Session 2'), 'and by sort, under its new chapter')
// A stale change: the page changed in Foundry meanwhile.
await editPage('alice', cavePage, { markdown: 'Changed in Foundry.' })
mark = writes.length
const stale = await made('erebor', update(cavePage, { markdown: 'Mine.', base: moved.result.note.rev }))
assert.deepEqual(refusal(stale), ['failed', 'changed', null])
assert.equal(stale.result.note.rev, pageRev(cavePage), "Foundry's revision now")
assert.equal(writes.length, mark, 'nothing written')
assert.equal(cavePage.text.markdown, 'Changed in Foundry.')
const staleBook = stale.before.filter(e => isBook(e, 'erebor', 'personal', 'thorin')).at(-1)
assert.ok(staleBook, 'the book before the refusal')
assert.deepEqual(noteIn(staleBook.data, cavePage.id).markdown, 'Changed in Foundry.')
const doomed2 = await made('erebor', create({ title: 'Deleted there' }))
const deletedThere = journal.pages.get(doomed2.command.note.id)
const late = update(deletedThere, { markdown: 'Too late.' })
await deletePage('gm', deletedThere)
assert.deepEqual(refusal(await made('erebor', late)), ['failed', 'gone', null])
assert.deepEqual(refusal(await made('erebor', update(cavePage, { role: 'chapter', markdown: undefined, chapter: undefined }))), ['failed', 'changed', null], 'a chapter that is a note')
const del = await made('erebor', remove(cavePage))
assert.deepEqual([del.result.status, del.result.note], ['done', { id: cave.note.id, rev: null, deleted: true }])
assert.equal(journal.pages.has(cave.note.id), false)
assert.equal(noteIn(lastBook('erebor', 'personal', 'thorin'), cave.note.id), null)
ok("a note's title and Markdown changed; moved to another chapter, by flag and sort; a change from a revision Foundry has moved on from refused `changed`, nothing written, Foundry's version sent first; a change of a page deleted there `gone`; a chapter's change of a note `changed`; a delete, `deleted`")

/* -------------------------------------------- */
/*  Order in Foundry                            */
/* -------------------------------------------- */

const V = (fields = {}) => create({ actorId: 'vex', writer: 'vex', ...fields })
const vexOrder = () => pagesOf(journalOf('personal', 'vex', 'erebor')).map(p => p.name)
const alpha = await made('erebor', V({ role: 'chapter', title: 'Alpha', createdAt: 100, markdown: undefined }))
const beta = await made('erebor', V({ role: 'chapter', title: 'Beta', createdAt: 200, markdown: undefined }))
for (const [title, createdAt] of [['A3', 103], ['A1', 101], ['A2', 102]]) await made('erebor', V({ title, createdAt, chapter: alpha.command.note.id }))
assert.deepEqual(vexOrder(), ['Behind', 'Alpha', 'A3', 'A1', 'A2', 'Beta'], 'in the order made, each last in its chapter, whenever it was written; an entry of the first chapter before the second')
const vexJournal = journalOf('personal', 'vex', 'erebor')
const image = await addPage('gm', vexJournal, { name: 'Map', type: 'image', sort: vexJournal.pages.get(alpha.command.note.id).sort + 1 })
await made('erebor', V({ title: 'A0', createdAt: 100, chapter: alpha.command.note.id }))
assert.deepEqual(vexOrder(), ['Behind', 'Alpha', 'Map', 'A3', 'A1', 'A2', 'A0', 'Beta'], "an image page stays after the page it followed")
// 18 notes into the notes in no chapter, before the first chapter, each last there: no whole number
// fits by the 17th, and every page is renumbered once.
const renumbers = () => writes.filter(w => w[0] === 'updateMany').length
await made('erebor', V({ title: 'Zero', createdAt: 1 }))
const before18 = renumbers()
for (let n = 0; n < 18; n++) await made('erebor', V({ title: `Early ${n}`, createdAt: 99 - n }))
assert.equal(renumbers() - before18, 1, 'one renumber, in one call')
const lastMany = writes.filter(w => w[0] === 'updateMany').at(-1)
assert.ok(lastMany[2].every(u => Number.isInteger(u.sort) && (u.sort % 100000 === 0)), 'a step apart')
assert.deepEqual(vexOrder().slice(0, 21), ['Behind', 'Zero', ...Array.from({ length: 18 }, (_, n) => `Early ${n}`), 'Alpha'])
assert.equal(new Set(pagesOf(vexJournal).map(p => p.sort)).size, vexJournal.pages.size)
// A note naming a chapter that isn't there yet sits at the top, until the chapter comes.
const gammaId = nid()
await made('erebor', V({ title: 'G1', createdAt: 301, chapter: gammaId }))
assert.ok(vexOrder().indexOf('G1') < vexOrder().indexOf('Alpha'), 'among the notes in no chapter')
assert.equal(noteIn(lastBook('erebor', 'personal', 'vex'), [...vexJournal.pages.values()].find(p => p.name === 'G1').id).chapter, null, 'no chapter while it isn\'t there')
await made('erebor', V({ role: 'chapter', id: gammaId, title: 'Gamma', createdAt: 300, markdown: undefined }))
assert.deepEqual(vexOrder().slice(-3), ['Beta', 'Gamma', 'G1'], 'gathered under its chapter once it comes')
assert.equal(noteIn(lastBook('erebor', 'personal', 'vex'), [...vexJournal.pages.values()].find(p => p.name === 'G1').id).chapter, gammaId)
// The module's own sorts leave a note as the app last wrote it.
assert.equal(noteIn(lastBook('erebor', 'personal', 'vex'), alpha.command.note.id).modifiedIn, 'app')
ok("Foundry's order: notes in no chapter first, then each chapter by when it was written, followed by its notes; each group's notes in the order Foundry holds them, a note made or moved last in its group; a page that isn't text keeps its place; a page midway between its neighbours, and one renumbering, in one call, where none fits; a note made before its chapter waits among the notes in none and is gathered under it; the module's sorts aren't edits")

/* -------------------------------------------- */
/*  Orders and who changed a journal (0.35.0)   */
/* -------------------------------------------- */

// Module 0.35.0 (its contract §2-§6): a group's notes put in order from the app by anyone who may
// see the party, `op: "order"`, made as far as the group is as it was; Foundry's order kept, a note
// made or moved last in its group; and who deleted or reordered a page the app is sent in Foundry,
// kept on the journal and told to an app that answers `notes: 2`. Thorin's journal in Mirkwood, the
// Iron Company's journal and Ghost's are made or used here; the party's and Ghost's are deleted
// again at the end, so the cases after these start as they did.

/** An order of a group's notes as the app hands it over (round 0.35.0 §3.4). */
function orderOf({ book = 'personal', actorId = 'thorin', chapter = null, ids, was, writer = actorId, by, at = ++clock, seq = 0 } = {}) {
  return { id: `${randomUUID()}.${seq}`, actorId, kind: 'note', ...(by && { by }), note: { book, op: 'order', chapter, ids, was, writer: by ? null : writer, at }, mode: 0, explicit: false, extras: [], dice: [] }
}
/** A party note's create, by Vex unless said. */
const ironNote = (fields = {}) => create({ book: 'party', actorId: 'company', writer: 'vex', ...fields })
/** A party order, by Vex unless said. */
const ironOrder = (fields = {}) => orderOf({ book: 'party', actorId: 'company', writer: 'vex', ...fields })
/** The id of the note a command made. */
const madeId = async (campaignId, cmd) => (await made(campaignId, cmd)).command.note.id
/** A page's text in Markdown, as Foundry's Markdown sheet keeps it. */
const markdownText = markdown => ({ format: 2, markdown, content: markdownToContent(markdown) })
/** A journal's pages' names in Foundry's order. */
const namesOf = entry => pagesOf(entry).map(page => page.name)
/** The ids of a group's entries in a book, in its order. */
const groupIn = (book, chapter) => book.journal.notes.filter(note => (note.role === 'entry') && (note.chapter === chapter)).map(note => note.id)
/** The writes of pages since a mark. */
const pageWritesSince = from => writes.slice(from).filter(w => ['create', 'update', 'updateMany', 'delete'].includes(w[0]))
/** The writes of who changed a journal in Foundry since a mark. */
const changedWritesSince = from => writes.slice(from).filter(w => (w[0] === 'updateJournal') && Object.hasOwn(w[2], 'flags.sending-stone.changed'))
/** Who changed a journal in Foundry, as its flag keeps it. */
const changedOn = entry => entry.flags['sending-stone']?.changed ?? null
/** A heartbeat, its clock this far ahead, so that it goes. */
const beatAhead = ms => {
  const clockNow = Date.now
  Date.now = () => clockNow() + ms
  try { heartbeat() } finally { Date.now = clockNow }
}
// Every page and journal update the hooks hear, with the options they're handed.
const pageHooks = []
Hooks.on('updateJournalEntryPage', (page, change, options, userId) => pageHooks.push({ id: page.id, change, options, userId }))
const journalHooks = []
Hooks.on('updateJournalEntry', (entry, change, options, userId) => journalHooks.push({ id: entry.id, change, options, userId }))

/* -------------------------------------------- */
/*  The order's check                           */
/* -------------------------------------------- */

{
  const O = (note = {}, fields = {}) => {
    const c = orderOf({ ids: [nid()], was: [] })
    return { ...c, ...fields, note: { ...c.note, ...note } }
  }
  const many = count => Array.from({ length: count }, () => nid())
  const twice = () => { const id = nid(); return [id, nid(), id] }
  const checksOfOrders = [
    ['note', O({ id: nid() })],
    ['note', O({ role: 'entry' })],
    ['note', O({ base: base14 })],
    ['note', { ...O(), note: without(O().note, 'was') }],
    ['note', O({ ids: [] })],
    ['note', O({ ids: many(401) })],
    ['note', O({ was: many(401) })],
    ['note', O({ ids: twice() })],
    ['note', O({ was: twice() })],
    ['note', O({ ids: ['n00000000000001'] })],
    ['note', O({ was: ['n00000000000001'] })],
    ['note', O({ was: 'n000000000000001' })],
    ['note', O({ was: null })],
    ['note', O({ book: 'diary' })],
    ['note', O({ at: 0 })],
    ['note', O({ at: 1.5 })],
    ['note', O({ title: 'A title' })],
    ['note', O({}, { key: 'prc' })],
    ['note', O({}, { transfer: {} })],
    ['chapter', O({ chapter: 'a b' })],
    ['chapter', O({ chapter: 'n00000000000001' })],
    ['writer', O({ writer: null })],
    ['writer', O({ writer: 'vex' })],
    ['writer', O({ writer: 7 })],
    ['dice', O({}, { dice: [{ faces: 20, value: 3 }] })],
    ['dice', O({}, { mode: 1 })],
  ]
  for (const [word, cmd] of checksOfOrders) assert.equal(checkNoteCommand(cmd), word, `${word}: ${JSON.stringify(cmd.note)?.slice(0, 120)}`)
  for (const cmd of [O({ ids: many(400), was: many(400) }), O(), O({ chapter: nid() }), O({ writer: null }, { by: 'gm' }), ironOrder({ ids: [nid()], was: [nid()] })]) {
    assert.equal(checkNoteCommand(cmd), null, JSON.stringify(cmd.note).slice(0, 120))
  }
  assert.equal(checkCommand(O({}, { by: 'player' })), 'by', 'by is checked first')
  assert.equal(checkCommand(O({ ids: [] })), 'note', 'checkCommand reaches the order check')
  const refusedOrder = await made('erebor', O({ ids: [] }))
  assert.deepEqual(refusal(refusedOrder), ['failed', 'invalid', 'note'])
  assert.equal(refusedOrder.before.filter(e => e.type === 'journal.updated').length, 0, 'no journal before the lookup')
  assert.equal('order' in refusedOrder.result, false, 'no order before the lookup')
  ok("the order check: `{ book, op: \"order\", chapter, ids, was, writer, at }` exactly, 400 ids and 400 in `was` taken; `note` for an extra id, role, base or title, `was` missing or not an array, `ids` empty or 401 long, `was` 401 long, a duplicate, a 15-character id, an unknown book, a time not a positive whole number, a roll's field or a move; `chapter`; `writer` null without `by`, or not the book's; `dice`; `by` first; through the pipe `invalid`, with no book and no order")
}

/* -------------------------------------------- */
/*  An order, personal                          */
/* -------------------------------------------- */

// Thorin's journal in Mirkwood, its note from the first cases deleted from the app, holds this case's
// pages alone: L1, L2; Alpha with A1, A2, A3, made in that order; and an image after A1.
await made('mirkwood', remove(mirkwood.pages.find(page => page.name === 'Elsewhere')))
const mL1 = await madeId('mirkwood', create({ title: 'L1' }))
const mL2 = await madeId('mirkwood', create({ title: 'L2' }))
const mAlpha = await madeId('mirkwood', create({ role: 'chapter', title: 'Alpha', markdown: undefined }))
const mA1 = await madeId('mirkwood', create({ title: 'A1', chapter: mAlpha }))
const mA2 = await madeId('mirkwood', create({ title: 'A2', chapter: mAlpha }))
const mA3 = await madeId('mirkwood', create({ title: 'A3', chapter: mAlpha }))
const mMap = await addPage('gm', mirkwood, { name: 'Map', type: 'image', sort: mirkwood.pages.get(mA1).sort + 1 })
assert.deepEqual(namesOf(mirkwood), ['L1', 'L2', 'Alpha', 'A1', 'Map', 'A2', 'A3'])
// Every page a sort that isn't a whole step, as the Gamemaster's own sorts could leave it, so that a
// renumber would write them all.
await mirkwood.updateEmbeddedDocuments('JournalEntryPage', pagesOf(mirkwood).map((page, n) => ({ _id: page.id, sort: (n + 1) * 10 })))
await wait(700)
const alphaOrder = orderOf({ chapter: mAlpha, ids: [mA3, mA1, mA2], was: [mA1, mA2, mA3] })
const looseOrder = orderOf({ chapter: null, ids: [mL2, mL1], was: [mL1, mL2] })
{
  const revs = () => Object.fromEntries(pagesOf(mirkwood).filter(page => page.type === 'text').map(page => [page.id, pageRev(page)]))
  const revsBefore = revs()
  mark = writes.length
  const hooksFrom = pageHooks.length
  const ordered = await made('mirkwood', alphaOrder)
  assert.deepEqual(ordered.result, {
    id: alphaOrder.id, status: 'done', reason: null, error: null, messageId: null, visible: false, rolls: [], order: { chapter: mAlpha, ids: [mA3, mA1, mA2] },
  }, 'done, with the group as Foundry holds it now, and no note')
  assert.deepEqual(namesOf(mirkwood), ['L1', 'L2', 'Alpha', 'A3', 'A1', 'Map', 'A2'], 'in the order asked, the image still following A1')
  const ordering = pageWritesSince(mark)
  assert.deepEqual(ordering.map(w => w[0]), ['updateMany'], 'one write')
  assert.deepEqual(ordering[0][2], [{ _id: mA3, sort: 40 }, { _id: mA1, sort: 50 }, { _id: mMap.id, sort: 60 }, { _id: mA2, sort: 70 }], 'each moved page takes the sort of the slot it moved into; L1, L2 and Alpha not written')
  const heardThen = pageHooks.slice(hooksFrom)
  assert.deepEqual(heardThen.map(h => h.id), [mA3, mA1, mMap.id, mA2])
  assert.ok(heardThen.every(h => h.options['sending-stone'] === true), "the write's options carry the module's own mark")
  assert.deepEqual(revs(), revsBefore, 'no revision moved')
  const orderedBook = ordered.before.filter(e => isBook(e, 'mirkwood', 'personal', 'thorin')).at(-1)
  assert.ok(orderedBook, 'the book before the result')
  assert.deepEqual(orderedBook.data.journal.notes.map(note => note.title), ['L1', 'L2', 'Alpha', 'A3', 'A1', 'A2'])
  mark = writes.length
  const loose = await made('mirkwood', looseOrder)
  assert.deepEqual([...refusal(loose), loose.result.order], ['done', null, null, { chapter: null, ids: [mL2, mL1] }])
  assert.deepEqual(pageWritesSince(mark)[0][2], [{ _id: mL2, sort: 10 }, { _id: mL1, sort: 20 }])
  assert.deepEqual(namesOf(mirkwood), ['L2', 'L1', 'Alpha', 'A3', 'A1', 'Map', 'A2'])
  ok("Thorin's order of Alpha, A3 A1 A2: done, the image still following A1, only the pages whose place changed written, each taking the sort of the slot it moved into, in one update carrying the module's own mark; L1, L2 and Alpha untouched; no revision moved; the book first, in that order; the result's `order` the group as Foundry holds it; then the notes in no chapter, L2 L1")
}

/* -------------------------------------------- */
/*  An order made at most once                  */
/* -------------------------------------------- */

{
  mark = writes.length
  const again1 = await made('mirkwood', looseOrder)
  assert.deepEqual([...refusal(again1), again1.result.order], ['done', null, null, { chapter: null, ids: [mL2, mL1] }], 'the same order handed again')
  const again2 = await made('mirkwood', alphaOrder)
  assert.deepEqual([...refusal(again2), again2.result.order], ['done', null, null, { chapter: mAlpha, ids: [mA3, mA1, mA2] }], 'made from Foundry as it was before it: done, not changed')
  assert.equal(pageWritesSince(mark).length, 0, 'nothing written')
  // A reload: the note commands' memory forgotten, the same order made afresh.
  const reloaded = await import(`${MODULE}/scripts/command-notes.mjs?reload`)
  const afresh = await reloaded.runNoteCommand(alphaOrder, getCampaigns().find(c => c.id === 'mirkwood'))
  assert.deepEqual([afresh.status, afresh.reason, afresh.order], ['done', null, { chapter: mAlpha, ids: [mA3, mA1, mA2] }])
  assert.equal(pageWritesSince(mark).length, 0, 'nothing written after a reload either')
  ok('an order handed over again, after it was made, as after a lost result or a reload, is done, writing nothing, and never `changed`, though its `was` is the order before it')
}

/* -------------------------------------------- */
/*  Anyone in the party orders                  */
/* -------------------------------------------- */

// The Iron Company's journal: a chapter of Bob's holding Alice's note, the Gamemaster's, and one
// written in Foundry that Carol, made its Owner, changed there last.
const ironRoad = await madeId('erebor', ironNote({ role: 'chapter', title: 'The road', markdown: undefined }))
const ironByThorin = await madeId('erebor', ironNote({ title: 'By Thorin', writer: 'thorin', chapter: ironRoad }))
const ironByGm = await madeId('erebor', ironNote({ title: 'By the Gamemaster', by: 'gm', chapter: ironRoad }))
const ironJournal = journalOf('party', 'company', 'erebor')
const ironFoundry = await addPage('gm', ironJournal, { name: 'Written in Foundry', title: { level: 2 }, text: markdownText('By hand.'), ownership: { default: -1, carol: 3 } })
await editPage('carol', ironFoundry, { markdown: 'Carol was here.' })
await wait(700)
const ironGroup = () => groupIn(lastBook('erebor', 'party', 'company'), ironRoad)
{
  assert.deepEqual(ironGroup(), [ironByThorin, ironByGm, ironFoundry.id])
  const others = () => Object.fromEntries([ironRoad, ironByThorin, ironByGm, ironFoundry.id].map(id => {
    const page = ironJournal.pages.get(id)
    const { foundry, ...flags } = page.flags['sending-stone'] ?? {}
    return [id, structuredClone({ name: page.name, text: page.text, title: page.title, ownership: page.ownership, flags })]
  }))
  const othersBefore = others()
  const thorinsLine = () => { const note = noteIn(lastBook('erebor', 'party', 'company'), ironByThorin); return [note.modifiedBy, note.modifiedIn, note.modifiedAt] }
  const foundryLine = () => { const note = noteIn(lastBook('erebor', 'party', 'company'), ironFoundry.id); return [note.modifiedBy, note.modifiedIn, note.modifiedAt] }
  const thorinsBefore = thorinsLine()
  const foundryBefore = foundryLine()
  assert.deepEqual([thorinsBefore.slice(0, 2), foundryBefore.slice(0, 2)], [['Thorin', 'app'], ['Carol', 'foundry']])
  mark = writes.length
  const byBob = await made('erebor', ironOrder({ chapter: ironRoad, ids: [ironByGm, ironFoundry.id, ironByThorin], was: [ironByThorin, ironByGm, ironFoundry.id] }))
  assert.deepEqual([...refusal(byBob), byBob.result.order], ['done', null, null, { chapter: ironRoad, ids: [ironByGm, ironFoundry.id, ironByThorin] }], 'no `not-yours`')
  assert.deepEqual(ironGroup(), [ironByGm, ironFoundry.id, ironByThorin])
  const sorting = pageWritesSince(mark)
  assert.deepEqual(sorting.map(w => w[0]), ['updateMany'])
  for (const update of sorting[0][2]) {
    assert.deepEqual(Object.keys(update).filter(key => !['_id', 'sort', 'flags.sending-stone.foundry'].includes(key)), [], `only its place: ${Object.keys(update)}`)
  }
  assert.ok(sorting[0][2].find(u => u._id === ironFoundry.id)['flags.sending-stone.foundry'], 'who changed the Foundry note there, kept')
  assert.equal(ironFoundry._stats.lastModifiedBy, 'gm', "the sort Foundry counts as the Gamemaster's change")
  assert.deepEqual(thorinsLine(), thorinsBefore, "Alice's note still last changed by Thorin, in the app")
  assert.deepEqual(foundryLine(), foundryBefore, 'the Foundry note still last changed by Carol, in Foundry, then')
  assert.deepEqual(others(), othersBefore, "no page's title, text, level, ownership or flags but who changed it in Foundry")
  ok("Bob orders the party's chapter holding Thorin's note, the Gamemaster's and one written in Foundry: done, no `not-yours`; every update only `_id`, `sort` and the kept `foundry` flag; Thorin's note still his, changed in the app; the Foundry note still Carol's change there; nothing else of any page changed")
}

/* -------------------------------------------- */
/*  An order and who may see the party          */
/* -------------------------------------------- */

{
  await own(company, { bob: 0 })
  await wait(300)
  mark = writes.length
  const locked = await made('erebor', ironOrder({ chapter: ironRoad, ids: [ironByThorin, ironByGm, ironFoundry.id], was: ironGroup() }))
  assert.deepEqual(refusal(locked), ['failed', 'not-member', null])
  assert.equal('order' in locked.result, false)
  assert.equal(locked.before.filter(e => e.type === 'journal.updated').length, 0, 'no book: refused before the journal is looked for')
  assert.equal(pageWritesSince(mark).length, 0, 'nothing written')
  await own(company, { bob: 2 })
  await wait(300)
  const byGm = await made('erebor', ironOrder({ by: 'gm', chapter: ironRoad, ids: [ironByThorin, ironByGm, ironFoundry.id], was: ironGroup() }))
  assert.deepEqual([...refusal(byGm), byGm.result.messages], ['done', null, null, []])
  assert.deepEqual(ironGroup(), [ironByThorin, ironByGm, ironFoundry.id])
  ok("Bob's order once he may no longer see the party in Foundry: `not-member`, nothing written, no book; the Gamemaster's, as no character: done, with no messages")
}

/* -------------------------------------------- */
/*  Merged with what changed meanwhile          */
/* -------------------------------------------- */

{
  // A note the Gamemaster added in Foundry since the order was made from the group: merged after it.
  const was = ironGroup()
  const added = await addPage('gm', ironJournal, { name: 'Added in Foundry', title: { level: 2 }, text: markdownText('Late.') })
  await wait(700)
  assert.deepEqual(ironGroup(), [...was, added.id])
  const withAdded = await made('erebor', ironOrder({ chapter: ironRoad, ids: [...was].reverse(), was }))
  assert.deepEqual([...refusal(withAdded), withAdded.result.order.ids], ['done', null, null, [...[...was].reverse(), added.id]], 'the notes as asked, the one added after them')
  // One of them deleted in Foundry since.
  const was2 = ironGroup()
  await deletePage('gm', ironJournal.pages.get(ironByGm))
  await wait(700)
  const withDeleted = await made('erebor', ironOrder({ chapter: ironRoad, ids: [added.id, ironByThorin, ironByGm, ironFoundry.id], was: was2 }))
  assert.deepEqual([...refusal(withDeleted), withDeleted.result.order.ids], ['done', null, null, [added.id, ironByThorin, ironFoundry.id]])
  // A note the journal doesn't hold: left out.
  const stranger = nid()
  const withStranger = await made('erebor', ironOrder({ chapter: ironRoad, ids: [ironFoundry.id, stranger, added.id, ironByThorin], was: ironGroup() }))
  assert.deepEqual([...refusal(withStranger), withStranger.result.order.ids], ['done', null, null, [ironFoundry.id, added.id, ironByThorin]])
  ok('merged with what changed meanwhile, never asked: a note the Gamemaster added in Foundry after the order was made comes after the notes it orders; one deleted there since, or one the journal never held, is left out; each done')
}

/* -------------------------------------------- */
/*  Reordered in both places                    */
/* -------------------------------------------- */

{
  // Handed over at once, before the drag's book has settled: the order's own book goes first.
  const was = ironGroup()
  const dragged = [was[1], was[0], ...was.slice(2)]
  await J.dragPages('gm', ironJournal, dragged)
  mark = writes.length
  const both = await made('erebor', ironOrder({ chapter: ironRoad, ids: [...was].reverse(), was }))
  assert.deepEqual([...refusal(both), both.result.order], ['failed', 'changed', null, { chapter: ironRoad, ids: dragged }], "Foundry's order stays, and the result says it")
  assert.equal(pageWritesSince(mark).length, 0, 'nothing written')
  assert.deepEqual(groupIn(both.before.filter(e => isBook(e, 'erebor', 'party', 'company')).at(-1).data, ironRoad), dragged, 'the book first, in Foundry\'s order')
  await wait(700)
  ok("the same notes reordered in Foundry since the order was made from them (the Gamemaster's drag): `changed`, nothing written, the book first, the result's `order` Foundry's")
}

/* -------------------------------------------- */
/*  An order refused                            */
/* -------------------------------------------- */

{
  // Its write refused by a module's hook: `error`, nothing moved, the book first, the result's order
  // Foundry's. Handed over at once after the Gamemaster renames a note there, so that the order's
  // own book goes first.
  const group = ironGroup()
  const sorts = () => pagesOf(ironJournal).map(page => [page.id, page.sort])
  await editPage('gm', ironJournal.pages.get(group[0]), { name: 'Renamed in Foundry' })
  const sortsBefore = sorts()
  mark = writes.length
  const allowAgain = J.refuse('update')
  let failedWrite
  try {
    failedWrite = await made('erebor', ironOrder({ chapter: ironRoad, ids: [...group].reverse(), was: group }))
  } finally {
    allowAgain()
  }
  assert.deepEqual([...refusal(failedWrite), failedWrite.result.order], ['failed', 'error', 'A write was refused', { chapter: ironRoad, ids: group }], "Foundry's order, as it was")
  assert.deepEqual(pageWritesSince(mark).map(w => w[0]), ['updateMany'], 'the one write, tried')
  assert.deepEqual(sorts(), sortsBefore, 'nothing moved')
  const bookFirst = failedWrite.before.filter(e => isBook(e, 'erebor', 'party', 'company')).at(-1)
  assert.ok(bookFirst, 'the book before the result')
  assert.deepEqual([noteIn(bookFirst.data, group[0]).title, groupIn(bookFirst.data, ironRoad)], ['Renamed in Foundry', group])
  await wait(700)

  // Refused before the journal is looked for: no book first, and no order.
  const noBookNoOrder = (answered, what) => {
    assert.equal(answered.before.filter(e => e.type === 'journal.updated').length, 0, `${what}: no book`)
    assert.equal('order' in answered.result, false, `${what}: no order`)
  }
  const an = (fields = {}) => ironOrder({ chapter: ironRoad, ids: group, was: group, ...fields })
  // `off`: the campaign gone between the fetch and the run, or no journals here.
  const from = app.events.length
  const offGone = await runNoteCommand(an(), { ...erebor(), id: 'gondor', title: 'Gondor' })
  const journalsHere = game.journal
  let offNoJournals
  game.journal = null
  try {
    offNoJournals = await runNoteCommand(an(), erebor())
  } finally {
    game.journal = journalsHere
  }
  await wait(50)
  for (const [off, what] of [[offGone, 'a campaign gone'], [offNoJournals, 'no journals']]) {
    assert.deepEqual([off.status, off.reason, 'order' in off], ['failed', 'off', false], what)
  }
  assert.equal(app.events.slice(from).filter(e => e.type === 'journal.updated').length, 0, 'off: no book')
  // `unknown`: a writer outside the campaign, or a book whose character isn't in it, the Gamemaster's too.
  const byStranger = await made('erebor', an({ writer: 'mara' }))
  assert.deepEqual(refusal(byStranger), ['failed', 'unknown', null], 'a writer outside the campaign')
  noBookNoOrder(byStranger, 'a writer outside the campaign')
  const ofStranger = await made('erebor', orderOf({ actorId: 'mara', by: 'gm', chapter: null, ids: [nid()], was: [] }))
  assert.deepEqual(refusal(ofStranger), ['failed', 'unknown', null], "a book outside the campaign, the Gamemaster's order")
  noBookNoOrder(ofStranger, 'a book outside the campaign')
  // `private`: a party no campaign character may see, the Gamemaster's order too.
  await own(company, { alice: 0, bob: 0 })
  await wait(300)
  mark = writes.length
  const unseen = await made('erebor', an({ by: 'gm' }))
  assert.deepEqual(refusal(unseen), ['failed', 'private', null], 'a party no one may see')
  noBookNoOrder(unseen, 'a party no one may see')
  assert.equal(pageWritesSince(mark).length, 0, 'nothing written')
  await own(company, { alice: 3, bob: 2 })
  await wait(300)
  await until(() => lastBook('erebor', 'party', 'company').journal, 'the party seen again')
  assert.deepEqual(ironGroup(), group)
  ok("an order whose write a module's hook refuses: `error`, nothing moved, the book first, the result's order Foundry's; one refused before the journal is looked for, `off` (its campaign gone, or no journals here), `unknown` (a writer or a book outside the campaign) and `private` (a party no campaign character may see): no book first, and no order")
}

/* -------------------------------------------- */
/*  Pages the app isn't sent                    */
/* -------------------------------------------- */

{
  const [first, second] = ironGroup()
  const gap = (ironJournal.pages.get(second).sort - ironJournal.pages.get(first).sort) / 3
  const hiddenGm = await addPage('gm', ironJournal, { name: 'For the GM alone', title: { level: 2 }, text: markdownText('Hidden.'), ownership: { default: 0 }, sort: ironJournal.pages.get(first).sort + Math.floor(gap) })
  const hiddenAlice = await addPage('gm', ironJournal, { name: 'For Alice alone', title: { level: 2 }, text: markdownText('Whispered.'), ownership: { default: 0, alice: 2 }, sort: ironJournal.pages.get(first).sort + Math.floor(2 * gap) })
  await wait(700)
  const group = ironGroup()
  assert.equal(group.includes(hiddenGm.id) || group.includes(hiddenAlice.id), false, 'neither sent')
  const hiddenSorts = [hiddenGm.sort, hiddenAlice.sort]
  mark = writes.length
  const around = await made('erebor', ironOrder({ chapter: ironRoad, ids: [...group].reverse(), was: group }))
  assert.deepEqual(refusal(around), ['done', null, null])
  assert.deepEqual(ironGroup(), [...group].reverse())
  const written = pageWritesSince(mark).flatMap(w => w[2].map(u => u._id))
  assert.equal(written.includes(hiddenGm.id) || written.includes(hiddenAlice.id), false, 'never written')
  assert.deepEqual([hiddenGm.sort, hiddenAlice.sort], hiddenSorts, 'their places as they were')
  ok('a page only the Gamemaster sees, and one shown to Alice alone, between the chapter\'s notes: never written by its order, their places as they were')
}

/* -------------------------------------------- */
/*  A group that's gone                         */
/* -------------------------------------------- */

{
  const lostRoad = await madeId('erebor', ironNote({ role: 'chapter', title: 'A lost road', markdown: undefined }))
  const onIt = await madeId('erebor', ironNote({ title: 'On the lost road', chapter: lostRoad }))
  const hiddenRoad = await madeId('erebor', ironNote({ role: 'chapter', title: 'A hidden road', markdown: undefined }))
  const onHidden = await madeId('erebor', ironNote({ title: 'On the hidden road', chapter: hiddenRoad }))
  await wait(700)
  mark = writes.length
  // Each handed over at once after the change in Foundry, so the order's own book goes first.
  const deleteIt = () => deletePage('gm', ironJournal.pages.get(lostRoad))
  const hideIt = () => ironJournal.pages.get(hiddenRoad).update({ ownership: { default: 0 } })
  for (const [chapter, ids, change, what] of [[lostRoad, [onIt], deleteIt, 'a chapter deleted'], [hiddenRoad, [onHidden], hideIt, 'a chapter made the Gamemaster\'s alone']]) {
    await change()
    const gone = await made('erebor', ironOrder({ chapter, ids, was: ids }))
    assert.deepEqual(refusal(gone), ['failed', 'gone', null], what)
    assert.equal('order' in gone.result, false, `${what}: no order`)
    assert.ok(gone.before.some(e => isBook(e, 'erebor', 'party', 'company')), `${what}: the book first`)
  }
  await wait(700)
  assert.equal(journalOf('personal', 'bram', 'erebor'), null)
  const noJournal = await made('erebor', orderOf({ actorId: 'bram', by: 'gm', chapter: null, ids: [nid()], was: [] }))
  assert.deepEqual(refusal(noJournal), ['failed', 'gone', null], 'no journal')
  assert.equal(journalOf('personal', 'bram', 'erebor'), null, 'none made')
  assert.equal(pageWritesSince(mark).filter(w => !((w[0] === 'delete') && (w[2][0] === lostRoad)) && !((w[0] === 'update') && (w[1] === hiddenRoad))).length, 0, 'nothing written but the Gamemaster\'s own changes')
  ok('an order of a chapter deleted in Foundry, or made the Gamemaster\'s alone, or of a book with no journal: `gone`, nothing written, with no order, the book first')
}

/* -------------------------------------------- */
/*  A chapter only the Gamemaster sees          */
/* -------------------------------------------- */

{
  // Foundry: Visible, Later, GM plot, Clue. The app is shown Clue in Visible, the chapter before the
  // one it's in, so its group is Later, Clue; an order can't put Clue before the hidden chapter.
  const visible = await madeId('erebor', create({ actorId: 'ghost', by: 'gm', role: 'chapter', title: 'Visible', markdown: undefined }))
  const ghostsJournal = journalOf('personal', 'ghost', 'erebor')
  await addPage('gm', ghostsJournal, { name: 'GM plot', title: { level: 1 }, text: markdownText(''), ownership: { default: 0 } })
  const clue = await addPage('gm', ghostsJournal, { name: 'Clue', title: { level: 2 }, text: markdownText('Under the mat.') })
  const later = await madeId('erebor', create({ actorId: 'ghost', by: 'gm', title: 'Later', chapter: visible }))
  await wait(700)
  assert.deepEqual(namesOf(ghostsJournal), ['Visible', 'Later', 'GM plot', 'Clue'])
  assert.deepEqual(groupIn(lastBook('erebor', 'personal', 'ghost'), visible), [later, clue.id])
  mark = writes.length
  const split = await made('erebor', orderOf({ actorId: 'ghost', by: 'gm', chapter: visible, ids: [clue.id, later], was: [later, clue.id] }))
  assert.deepEqual([...refusal(split), split.result.order], ['done', null, null, { chapter: visible, ids: [later, clue.id] }], 'made as far as the hidden chapter allows: not at all')
  assert.equal(pageWritesSince(mark).length, 0, 'nothing written')
  assert.deepEqual(namesOf(ghostsJournal), ['Visible', 'Later', 'GM plot', 'Clue'])
  await J.deleteJournal('gm', ghostsJournal)
  await wait(700)
  ok("an order across a chapter only the Gamemaster sees is made within each of its own groups, here not at all: done, nothing written, the result's order as Foundry holds it")
}
{
  // Foundry: Visible, A, B, GM plot, C, D; the app's group A, B, C, D. Made as far as the hidden
  // chapter allows, the order is never the one asked, so the same order handed over again (a result
  // lost, or a reload) finds Foundry in another order than its `was`, by the module's own write.
  const visible = await madeId('erebor', create({ actorId: 'ghost', by: 'gm', role: 'chapter', title: 'Visible', markdown: undefined }))
  const a = await madeId('erebor', create({ actorId: 'ghost', by: 'gm', title: 'A', chapter: visible }))
  const b = await madeId('erebor', create({ actorId: 'ghost', by: 'gm', title: 'B', chapter: visible }))
  const ghostsJournal = journalOf('personal', 'ghost', 'erebor')
  await addPage('gm', ghostsJournal, { name: 'GM plot', title: { level: 1 }, text: markdownText(''), ownership: { default: 0 } })
  const c = (await addPage('gm', ghostsJournal, { name: 'C', title: { level: 2 }, text: markdownText('Third.') })).id
  const d = (await addPage('gm', ghostsJournal, { name: 'D', title: { level: 2 }, text: markdownText('Fourth.') })).id
  await wait(700)
  assert.deepEqual(namesOf(ghostsJournal), ['Visible', 'A', 'B', 'GM plot', 'C', 'D'])
  assert.deepEqual(groupIn(lastBook('erebor', 'personal', 'ghost'), visible), [a, b, c, d])
  const split = orderOf({ actorId: 'ghost', by: 'gm', chapter: visible, ids: [d, c, b, a], was: [a, b, c, d] })
  const asMade = { chapter: visible, ids: [b, a, d, c] }
  const first = await made('erebor', split)
  assert.deepEqual([...refusal(first), first.result.order], ['done', null, null, asMade], 'made within each of its chapters')
  assert.deepEqual(namesOf(ghostsJournal), ['Visible', 'B', 'A', 'GM plot', 'D', 'C'])
  mark = writes.length
  const again = await made('erebor', split)
  assert.deepEqual([...refusal(again), again.result.order], ['done', null, null, asMade], 'handed over again: done, not `changed`')
  // A reload: the note commands' memory forgotten, the same order made afresh.
  const reloaded = await import(`${MODULE}/scripts/command-notes.mjs?reload-split`)
  const afresh = await reloaded.runNoteCommand(split, erebor())
  assert.deepEqual([afresh.status, afresh.reason, afresh.order], ['done', null, asMade], 'after a reload: done')
  assert.equal(pageWritesSince(mark).length, 0, 'nothing written')
  await J.deleteJournal('gm', ghostsJournal)
  await wait(700)
  ok("an order made only as far as a chapter only the Gamemaster sees allows, handed over again after a lost result or a reload, is done, writing nothing, never `changed`")
}

/* -------------------------------------------- */
/*  Where a note goes                           */
/* -------------------------------------------- */

const mBeta = await madeId('mirkwood', create({ role: 'chapter', title: 'Beta', markdown: undefined }))
const mB1 = await madeId('mirkwood', create({ title: 'B1', chapter: mBeta }))
const mB2 = await madeId('mirkwood', create({ title: 'B2', chapter: mBeta }))
{
  const thorinsBook = () => lastBook('mirkwood', 'personal', 'thorin')
  // A create lands last in its group, whenever it was written: in no chapter, then in Alpha, whose
  // order was set from the app, which it keeps.
  await made('mirkwood', create({ title: 'Old loose', createdAt: 5 }))
  assert.deepEqual(namesOf(mirkwood).slice(0, 4), ['L2', 'L1', 'Old loose', 'Alpha'], 'last in no chapter, the order there kept')
  await made('mirkwood', create({ title: 'Old alpha', createdAt: 6, chapter: mAlpha }))
  assert.deepEqual(namesOf(mirkwood).slice(3, 9), ['Alpha', 'A3', 'A1', 'Map', 'A2', 'Old alpha'], 'last in Alpha, its order kept')
  assert.deepEqual(groupIn(thorinsBook(), null).map(id => mirkwood.pages.get(id).name), ['L2', 'L1', 'Old loose'])
  // A move lands last in its chapter: L1, older than Beta's notes, from no chapter into Beta, after them.
  await made('mirkwood', update(mirkwood.pages.get(mL1), { chapter: mBeta }))
  assert.deepEqual(namesOf(mirkwood).slice(-4), ['Beta', 'B1', 'B2', 'L1'])
  // With no room: a note an image follows, moved from no chapter into Beta, is still last there, and
  // the image goes with it, both placed by the sort after the note's update.
  const withMap = await madeId('mirkwood', create({ title: 'With map' }))
  await addPage('gm', mirkwood, { name: 'Map 2', type: 'image', sort: mirkwood.pages.get(withMap).sort + 1 })
  mark = writes.length
  await made('mirkwood', update(mirkwood.pages.get(withMap), { chapter: mBeta }))
  assert.equal(pageWritesSince(mark).filter(w => w[0] === 'update').some(w => 'sort' in w[2]), false, 'its place left for the sort after it')
  assert.deepEqual(namesOf(mirkwood).slice(-6), ['Beta', 'B1', 'B2', 'L1', 'With map', 'Map 2'], 'last in Beta, the image after it')
  // After an order, the next create and the next move keep it.
  await made('mirkwood', orderOf({ chapter: mBeta, ids: [withMap, mB2, mL1, mB1], was: [mB1, mB2, mL1, withMap] }))
  assert.deepEqual(groupIn(thorinsBook(), mBeta).map(id => mirkwood.pages.get(id).name), ['With map', 'B2', 'L1', 'B1'])
  await made('mirkwood', create({ title: 'B3', chapter: mBeta }))
  const oldLoose = mirkwood.pages.find(page => page.name === 'Old loose')
  await made('mirkwood', update(oldLoose, { chapter: mBeta }))
  assert.deepEqual(groupIn(thorinsBook(), mBeta).map(id => mirkwood.pages.get(id).name), ['With map', 'B2', 'L1', 'B1', 'B3', 'Old loose'], 'the order kept, each last')
  // A reorder the Gamemaster makes in Foundry is kept by the next create.
  const alphaNow = groupIn(thorinsBook(), mAlpha)
  const draggedAlpha = [alphaNow[2], alphaNow[0], alphaNow[3], alphaNow[1]]
  await J.dragPages('gm', mirkwood, draggedAlpha)
  await wait(700)
  assert.deepEqual(groupIn(thorinsBook(), mAlpha), draggedAlpha)
  const a4 = await madeId('mirkwood', create({ title: 'A4', createdAt: 7, chapter: mAlpha }))
  assert.deepEqual(groupIn(thorinsBook(), mAlpha), [...draggedAlpha, a4], "the Gamemaster's order kept, the new note last")
  ok('a note made lands last in its group, in no chapter or a chapter, though written before every note there; a note moved lands last in its chapter, from no chapter into a later one, though older than its notes, and with no room too, an image following it going with it; after an order, and after a reorder the Gamemaster makes in Foundry, the next create and move keep it')
}
{
  // Ghost's journal, made by the Gamemaster a step apart: K1 with k1; K2 with m1, m2 (an image after
  // it) and m3. m2 moved into K1, the earlier chapter, where its own place would fit: the image goes
  // with it, never left under K2.
  const ghostCreate = fields => madeId('erebor', create({ actorId: 'ghost', by: 'gm', ...fields }))
  const k1 = await ghostCreate({ role: 'chapter', title: 'K1', markdown: undefined })
  await ghostCreate({ title: 'k1', chapter: k1 })
  const k2 = await ghostCreate({ role: 'chapter', title: 'K2', markdown: undefined })
  await ghostCreate({ title: 'm1', chapter: k2 })
  const m2 = await ghostCreate({ title: 'm2', chapter: k2 })
  const m3 = await ghostCreate({ title: 'm3', chapter: k2 })
  const ghostsJournal = journalOf('personal', 'ghost', 'erebor')
  await addPage('gm', ghostsJournal, { name: 'Map of m2', type: 'image', sort: ghostsJournal.pages.get(m2).sort + 1 })
  assert.deepEqual(pagesOf(ghostsJournal).map(page => [page.name, page.sort]), [
    ['K1', 100000], ['k1', 200000], ['K2', 300000], ['m1', 400000], ['m2', 500000], ['Map of m2', 500001], ['m3', 600000],
  ])
  const ghostsBook = () => lastBook('erebor', 'personal', 'ghost')
  await made('erebor', update(ghostsJournal.pages.get(m2), { actorId: 'ghost', by: 'gm', chapter: k1 }))
  assert.deepEqual(namesOf(ghostsJournal), ['K1', 'k1', 'm2', 'Map of m2', 'K2', 'm1', 'm3'], 'last in K1, the image after it')
  assert.deepEqual(groupIn(ghostsBook(), k1).map(id => ghostsJournal.pages.get(id).name), ['k1', 'm2'])
  // And with no room at all: m3, no image after it, moved into K1, whose last page K2 now follows by
  // a sort of 1, keeps its place in its update, and the journal is renumbered, m3 last in K1.
  await ghostsJournal.updateEmbeddedDocuments('JournalEntryPage', [{ _id: k2, sort: ghostsJournal.pages.find(page => page.name === 'Map of m2').sort + 1 }])
  await wait(700)
  mark = writes.length
  await made('erebor', update(ghostsJournal.pages.get(m3), { actorId: 'ghost', by: 'gm', chapter: k1 }))
  const moving = pageWritesSince(mark)
  assert.deepEqual(moving.map(w => w[0]), ['update', 'updateMany'])
  assert.equal('sort' in moving[0][2], false, 'no room: its place left for the renumber')
  assert.ok(moving[1][2].every(u => u.sort % 100000 === 0), 'renumbered')
  assert.deepEqual(namesOf(ghostsJournal), ['K1', 'k1', 'm2', 'Map of m2', 'm3', 'K2', 'm1'], 'last in K1')
  await J.deleteJournal('gm', ghostsJournal)
  await wait(700)
  ok('a note an image follows, moved into an earlier chapter where its own place would fit, lands last there with the image after it, never leaving it under the chapter it left; with no room, the journal renumbered, the note last')
}

/* -------------------------------------------- */
/*  Who changed the journal in Foundry          */
/* -------------------------------------------- */

// Foundry's server time, which the stand-in lacks, a while off this clock, so that a time read from
// it shows.
game.time = { get serverTime() { return Date.now() + 12_345 } }
{
  const thorinsBook = () => lastBook('mirkwood', 'personal', 'thorin')
  const until500 = (test, what) => until(test, what, 3000)
  // The Gamemaster deletes a note in Foundry.
  const doomedThere = mirkwood.pages.get(mB1)
  mark = writes.length
  const hooksFrom = journalHooks.length
  const t0 = Date.now() + 12_345
  await deletePage('gm', doomedThere)
  const t1 = Date.now() + 12_345
  await wait(200)
  assert.ok(!changedOn(mirkwood) || (changedOn(mirkwood).at < t0), 'not before it settles')
  await until500(() => changedOn(mirkwood)?.at >= t0, 'the flag')
  const deleted = changedOn(mirkwood)
  assert.deepEqual({ ...deleted, at: 0 }, { what: 'delete', by: 'gm', at: 0 })
  assert.ok((deleted.at >= t0 - 50) && (deleted.at <= t1 + 50), `Foundry's server time, read: ${deleted.at} in ${t0}-${t1}`)
  const flagHook = journalHooks.slice(hooksFrom).find(h => h.change?.flags?.['sending-stone']?.changed)
  assert.deepEqual([flagHook.options.render, flagHook.options['sending-stone']], [false, true], "written without redrawing the journal, as the module's own")
  assert.equal(changedWritesSince(mark).length, 1)
  await until500(() => thorinsBook().journal.changed?.at === deleted.at, 'the book')
  assert.deepEqual(thorinsBook().journal.changed, { what: 'delete', by: 'Gamemaster', at: deleted.at })
  assert.deepEqual(Object.keys(thorinsBook().journal), ['id', 'name', 'notes', 'changed'])
  // Alice, Owner of Thorin's journal, deletes her note there.
  await deletePage('alice', mirkwood.pages.find(page => page.name === 'Old alpha'))
  await until500(() => thorinsBook().journal.changed?.by === 'Thorin', "Alice's delete")
  assert.deepEqual([changedOn(mirkwood).what, changedOn(mirkwood).by], ['delete', 'alice'])
  // Carol, a table player outside the app, deletes a party page she's been made Owner of.
  await deletePage('carol', ironFoundry)
  await until500(() => lastBook('erebor', 'party', 'company').journal.changed?.by === 'Carol', "Carol's delete")
  assert.deepEqual([changedOn(ironJournal).what, changedOn(ironJournal).by], ['delete', 'carol'])
  // The Gamemaster drags two notes: one change, one write of the flag for the drag.
  mark = writes.length
  const beta = groupIn(thorinsBook(), mBeta)
  const pageHooksFrom = pageHooks.length
  await J.dragPages('gm', mirkwood, [beta[1], beta[0]])
  assert.equal(pageHooks.slice(pageHooksFrom).length, 2, 'two pages written')
  await until500(() => changedOn(mirkwood)?.what === 'order', 'the drag')
  await wait(700)
  assert.equal(changedWritesSince(mark).length, 1, 'one write of the flag for the drag')
  assert.deepEqual([changedOn(mirkwood).by, thorinsBook().journal.changed.what, thorinsBook().journal.changed.by], ['gm', 'order', 'Gamemaster'])
  // A chapter's place, and a title, changed in Foundry: neither counts.
  const kept = structuredClone(changedOn(mirkwood))
  mark = writes.length
  await mirkwood.updateEmbeddedDocuments('JournalEntryPage', [{ _id: mBeta, sort: mirkwood.pages.get(mBeta).sort + 1 }])
  await editPage('alice', mirkwood.pages.find(page => page.name === 'B2'), { name: 'B2, renamed' })
  await wait(700)
  assert.deepEqual([changedOn(mirkwood), changedWritesSince(mark).length], [kept, 0], "a chapter's sort, and a title, change nothing")
  ok("who changed the journal in Foundry: the Gamemaster's delete kept on the journal 500 ms later, `{ what: 'delete', by: 'gm', at }` at Foundry's server time, written with `render: false` as the module's own, and sent as `changed`, by \"Gamemaster\"; Alice's own delete by \"Thorin\"; Carol's of a party page she owns by her name; a drag of two notes one `order`, one write; a chapter's sort, and a title, nothing")
}

/* -------------------------------------------- */
/*  The module's own writes                     */
/* -------------------------------------------- */

{
  const ownWrites = async label => {
    const kept = structuredClone(changedOn(mirkwood))
    // Beta put before Alpha by the Gamemaster, which a chapter's place doesn't count for: the next
    // create's sort puts it back.
    await mirkwood.updateEmbeddedDocuments('JournalEntryPage', [{ _id: mBeta, sort: mirkwood.pages.get(mAlpha).sort - 1 }])
    await wait(700)
    mark = writes.length
    let hooksFrom = pageHooks.length
    const sorted = await madeId('mirkwood', create({ title: `${label}: sorted` }))
    const putBack = pageWritesSince(mark).filter(w => w[0] === 'updateMany')
    assert.ok(putBack.length && putBack[0][2].some(u => u._id === mBeta), `${label}: a create's sort`)
    const heardOwn = pageHooks.slice(hooksFrom)
    // Beta right after Alpha's last page: no room for a note last in Alpha, so the journal is renumbered.
    const pages = pagesOf(mirkwood)
    await mirkwood.updateEmbeddedDocuments('JournalEntryPage', [{ _id: mBeta, sort: pages[pages.findIndex(page => page.id === mBeta) - 1].sort + 1 }])
    await wait(700)
    hooksFrom = pageHooks.length
    const renumberFrom = writes.length
    const squeezed = await madeId('mirkwood', create({ title: `${label}: squeezed`, chapter: mAlpha }))
    assert.ok(pageWritesSince(renumberFrom).some(w => (w[0] === 'updateMany') && w[2].every(u => u.sort % 100000 === 0)), `${label}: a renumber`)
    // A move, an order and a delete.
    await made('mirkwood', update(mirkwood.pages.get(squeezed), { chapter: mBeta }))
    const betaNow = groupIn(lastBook('mirkwood', 'personal', 'thorin'), mBeta)
    await made('mirkwood', orderOf({ chapter: mBeta, ids: [...betaNow].reverse(), was: betaNow }))
    await made('mirkwood', remove(mirkwood.pages.get(sorted)))
    await wait(700)
    assert.deepEqual(changedOn(mirkwood), kept, `${label}: nothing recorded`)
    assert.equal(changedWritesSince(mark).length, 0, `${label}: no write of the flag`)
    return [...heardOwn, ...pageHooks.slice(hooksFrom)]
  }
  const marked = await ownWrites('with the option')
  assert.ok(marked.length >= 4 && marked.every(h => h.options['sending-stone'] === true), 'every update of a page heard with the module\'s own mark')
  faults.stripOptions = true
  const unmarked = await ownWrites('with the option stripped')
  faults.stripOptions = false
  assert.ok(unmarked.length >= 4 && unmarked.every(h => !('sending-stone' in h.options)), 'the hooks handed none of the options')
  ok("the module's own writes, a create's sort, a renumber, a move, an order and a delete, record nothing, by the option they carry; and where core doesn't hand a write's options to its hooks, by the pages it's writing")
}

/* -------------------------------------------- */
/*  Pages the app isn't sent, deleted           */
/* -------------------------------------------- */

{
  const gmAlone = await addPage('gm', ironJournal, { name: 'Notes for the GM', title: { level: 2 }, text: markdownText('Mine.'), ownership: { default: 0 } })
  const aliceAlone = await addPage('gm', ironJournal, { name: 'A letter to Alice', title: { level: 2 }, text: markdownText('Yours.'), ownership: { default: 0, alice: 2 } })
  const picture = await addPage('gm', ironJournal, { name: 'A picture', type: 'image', title: { level: 2 } })
  await wait(700)
  const kept = structuredClone(changedOn(ironJournal))
  mark = writes.length
  for (const page of [gmAlone, aliceAlone, picture]) await deletePage('gm', page)
  await wait(700)
  assert.deepEqual([changedOn(ironJournal), changedWritesSince(mark).length], [kept, 0])
  ok("a page only the Gamemaster sees, one shown to Alice alone in the party's journal, and an image, deleted in Foundry: nothing recorded")
}

/* -------------------------------------------- */
/*  Kept on the journal                         */
/* -------------------------------------------- */

{
  const kept = structuredClone(changedOn(mirkwood))
  const told = { what: kept.what, by: 'Gamemaster', at: kept.at }
  assert.equal(kept.by, 'gm')
  // A reload: the module's memory forgotten, the book read afresh from the journal.
  const fresh = await import(`${MODULE}/scripts/journals.mjs?reload`)
  fresh.noteNotesReader('mirkwood', NOTES, 'bridge.hello')
  const from = app.events.length
  fresh.sendBook('personal', 'thorin', 'mirkwood')
  assert.deepEqual(app.events.slice(from).find(e => isBook(e, 'mirkwood', 'personal', 'thorin'))?.data.journal.changed, told, 'after a reload')
  // A hello.
  const helloFrom = app.events.length
  announce({ campaignId: 'mirkwood' })
  await until(() => app.events.slice(helloFrom).some(e => isBook(e, 'mirkwood', 'personal', 'thorin')), 'the book after the hello')
  assert.deepEqual(app.events.slice(helloFrom).find(e => isBook(e, 'mirkwood', 'personal', 'thorin')).data.journal.changed, told, 'after a hello')
  // A clock behind: a change heard as older than the one kept doesn't replace it.
  const serverTime = game.time
  game.time = { get serverTime() { return Date.now() - 3_600_000 } }
  mark = writes.length
  await deletePage('gm', mirkwood.pages.find(page => page.name === 'B3'))
  await wait(700)
  game.time = serverTime
  assert.deepEqual([changedOn(mirkwood), changedWritesSince(mark).length], [kept, 0], 'an older change kept out')
  ok('who changed the journal in Foundry is kept on it: after a reload, the module\'s memory gone, and after a hello, the book says it again; a change heard as older than it, a clock behind, doesn\'t replace it')
}

/* -------------------------------------------- */
/*  No Gamemaster                               */
/* -------------------------------------------- */

{
  const kept = structuredClone(changedOn(mirkwood))
  const hers = mirkwood.pages.find(page => page.name === 'L2')
  await J.bridgeOff()
  await deletePage('alice', hers)
  await wait(700)
  assert.deepEqual(changedOn(mirkwood), kept, 'nothing recorded')
  const backFrom = app.events.length
  await J.bridgeOn()
  await until(() => app.events.slice(backFrom).some(e => isBook(e, 'mirkwood', 'personal', 'thorin')), 'the book after the hello')
  const backBook = app.events.slice(backFrom).find(e => isBook(e, 'mirkwood', 'personal', 'thorin')).data
  assert.equal(noteIn(backBook, hers.id), null, 'the page gone')
  assert.deepEqual(backBook.journal.changed, { what: kept.what, by: 'Gamemaster', at: kept.at }, 'the change before it')
  ok("with no Gamemaster connected, Alice's delete in Foundry is recorded by no one: once one is back, the hello's book lacks the page and says the change before it")
}

// The party's journal goes, so the party cases after these start as they did, and Foundry's time is
// the stand-in's again.
await J.deleteJournal('gm', ironJournal)
delete game.time
await wait(700)

/* -------------------------------------------- */
/*  The hello, and the app's notes format       */
/* -------------------------------------------- */

{
  assert.deepEqual(Object.keys(helloOf('erebor').data.features.notes), ['enabled', 'kinds', 'reason', 'journals', 'orders', 'changes'])
  assert.deepEqual({ ...noteFeatures(erebor()), journals: [] }, NONE_YET)
  assert.ok(changedOn(journal), "Thorin's journal in Erebor has a change recorded (a note the Gamemaster deleted in Foundry, above)")
  // An app answering `notes: 1`, as before 0.35.0: no `changed`.
  app.features.erebor = { ...NOTES, notes: 1 }
  const helloFrom = app.events.length
  announce({ campaignId: 'erebor' })
  await until(() => app.events.slice(helloFrom).some(e => isBook(e, 'erebor', 'personal', 'thorin')), 'the book after the hello')
  assert.equal('changed' in app.events.slice(helloFrom).find(e => isBook(e, 'erebor', 'personal', 'thorin')).data.journal, false, 'no `changed` for `notes: 1`')
  // Its heartbeat's answer rising to 2: every book afresh, `changed` in it.
  await wait(200)
  app.features.erebor = NOTES
  const risen = app.events.length
  beatAhead(60_000)
  const books = noteFeatures(erebor()).journals.map(book => `${book.kind}:${book.actorId}`).sort()
  await until(() => app.events.slice(risen).filter(e => isBook(e, 'erebor')).length >= books.length, 'every book', 2000)
  assert.deepEqual(app.events.slice(risen).filter(e => isBook(e, 'erebor')).map(e => `${e.data.kind}:${e.data.actorId}`).sort(), books)
  assert.deepEqual(lastBook('erebor', 'personal', 'thorin').journal.changed, { what: changedOn(journal).what, by: 'Gamemaster', at: changedOn(journal).at }, '`changed` for `notes: 2`')
  // Staying at 2: none.
  await wait(200)
  const stayed = app.events.length
  beatAhead(120_000)
  await wait(300)
  assert.equal(app.events.slice(stayed).filter(e => isBook(e, 'erebor')).length, 0, 'none when it stays at 2')
  ok("the hello's features.notes ends with `orders` and `changes`; an app answering `notes: 1` is sent no `changed`, one answering 2 is; a heartbeat's answer rising from 1 to 2 sends every book afresh, one staying at 2 none")
}

/* -------------------------------------------- */
/*  Party                                       */
/* -------------------------------------------- */

const P = (fields = {}) => create({ book: 'party', actorId: 'company', writer: 'vex', ...fields })
const road = await made('erebor', P({ role: 'chapter', title: 'Road to Erebor', markdown: undefined }))
const wolves = await made('erebor', P({ title: 'Wolves', markdown: 'Grey ones.', chapter: road.command.note.id }))
const party = journalOf('party', 'company', 'erebor')
assert.equal(party.name, 'The Iron Company: party notes')
assert.deepEqual(party.ownership, { default: 0, alice: 2, bob: 2, carol: 2 }, 'Observer to who may see the party, a table player outside the app among them')
assert.deepEqual(party.flags['sending-stone'].journal, { kind: 'party', actor: 'company', campaign: 'erebor', granted: ['alice', 'bob', 'carol'], default: 0 })
const wolvesPage = party.pages.get(wolves.command.note.id)
const roadPage = party.pages.get(road.command.note.id)
assert.deepEqual(wolvesPage.ownership, { default: -1, bob: 3 }, "Owner to its writer's players")
assert.deepEqual(wolvesPage.flags['sending-stone'].granted, ['bob'])
assert.deepEqual(roadPage.ownership, { default: -1 })
assert.equal(wolvesPage.testUserPermission(users.get('alice'), 'OWNER'), false, 'Alice reads it, never changes it, in Foundry')
assert.equal(wolvesPage.testUserPermission(users.get('alice'), 'OBSERVER'), true)
await assert.rejects(() => editPage('alice', wolvesPage, { markdown: 'Hers.' }))
assert.deepEqual(refusal(await made('erebor', update(wolvesPage, { book: 'party', actorId: 'company', writer: 'thorin', markdown: 'Hers.' }))), ['failed', 'not-yours', null])
const rename = await made('erebor', update(roadPage, { book: 'party', actorId: 'company', writer: 'thorin', title: 'The road east' }))
assert.equal(rename.result.status, 'done', 'any member renames a chapter')
assert.deepEqual(noteIn(lastBook('erebor', 'party', 'company'), roadPage.id).modifiedBy, 'Thorin')
const byGm = await made('erebor', update(wolvesPage, { book: 'party', actorId: 'company', by: 'gm', markdown: 'Grey and many.' }))
assert.equal(byGm.result.status, 'done')
assert.deepEqual(byGm.result.messages, [], "the Gamemaster's result lists no messages")
assert.deepEqual(wolvesPage.flags['sending-stone'].modified, { actor: null, gm: true, at: byGm.command.note.at })
assert.deepEqual(wolvesPage.flags['sending-stone'].author, { actor: 'vex', gm: false }, 'still written by Vex')
assert.deepEqual(noteIn(lastBook('erebor', 'party', 'company'), wolvesPage.id).modifiedBy, 'Gamemaster')
// Bob may no longer see the party in Foundry.
await own(company, { bob: 0 })
assert.equal(party.ownership.bob, 0, 'None on the journal')
const notMember = await made('erebor', P({ title: 'Locked out' }))
assert.deepEqual(refusal(notMember), ['failed', 'not-member', null])
assert.ok(!lastBook('erebor', 'party', 'company').withheld, 'the party still goes to Erebor while Alice sees it')
await own(company, { bob: 2 })
assert.equal(party.ownership.bob, 2)
ok("party notes: Bob's note makes \"The Iron Company: party notes\", Observer to Alice, Bob and Carol, the note Owner to Bob alone and a chapter to no one; Alice can't change Bob's note, in Foundry or the app (`not-yours`), and renames his chapter; the Gamemaster changes any, marked theirs; Bob without the party in Foundry is `not-member`")

// A party no campaign character may see in Foundry.
await own(company, { alice: 0, bob: 0 })
assert.deepEqual(lastBook('erebor', 'party', 'company'), { kind: 'party', actorId: 'company', journal: null, withheld: { reason: 'private' } })
assert.deepEqual(refusal(await made('erebor', P({ title: 'Anyone?', by: 'gm' }))), ['failed', 'private', null])
assert.deepEqual(party.ownership, { default: 0, alice: 0, bob: 0, carol: 2 })
await own(company, { alice: 3, bob: 2 })
assert.equal(lastBook('erebor', 'party', 'company').journal.notes.length, 2)
ok('a party no campaign character may see: its book `withheld: private`, a write `private`; seen again, sent again')

/* -------------------------------------------- */
/*  Sharing as the journal does                 */
/* -------------------------------------------- */

const ghostNote = await made('erebor', create({ actorId: 'ghost', by: 'gm', title: 'Ghostly' }))
const ghostJournal = journalOf('personal', 'ghost', 'erebor')
assert.deepEqual(ghostJournal.ownership, { default: 0 }, 'a character no player owns: no one but the Gamemaster')
assert.ok(noteIn(lastBook('erebor', 'personal', 'ghost'), ghostNote.command.note.id), '(1) a module page in a journal no player can see: sent')
const md = markdown => ({ format: 2, markdown, content: markdownToContent(markdown) })
const gmOnly = await addPage('gm', journal, { name: 'For the GM', title: { level: 2 }, text: md('Hidden.'), ownership: { default: 0 } })
const gmOnly2 = await addPage('gm', ghostJournal, { name: 'For the GM', title: { level: 2 }, text: md('Hidden.'), ownership: { default: 0 } })
const toAlice = await addPage('gm', party, { name: 'Alice alone', title: { level: 2 }, text: md('Whispered.'), ownership: { default: 0, alice: 2 } })
const personalAlice = await addPage('gm', journal, { name: 'Her own', title: { level: 2 }, text: md('Shown.'), ownership: { default: 0, alice: 2 } })
await wait(600)
assert.equal(sharedLikeJournal(gmOnly), false)
assert.equal(noteIn(lastBook('erebor', 'personal', 'thorin'), gmOnly.id), null, "(2) a page for the GM in Thorin's journal: never sent")
assert.equal(noteIn(lastBook('erebor', 'personal', 'ghost'), gmOnly2.id), null, '(3) the same in a journal no player can see: never sent, GM-only')
assert.equal(noteIn(lastBook('erebor', 'party', 'company'), toAlice.id), null, '(4) a party page shown to Alice alone, Bob reading the journal: never sent')
assert.ok(noteIn(lastBook('erebor', 'personal', 'thorin'), personalAlice.id), "(5) a personal page shown to Alice, its only owner: sent")
const bobsHidden = await made('erebor', P({ title: 'Soon hidden' }))
const hiddenPage = party.pages.get(bobsHidden.command.note.id)
await hiddenPage.update({ ownership: { default: 0, alice: 2, bob: 0 } })
assert.deepEqual(refusal(await made('erebor', update(hiddenPage, { book: 'party', actorId: 'company', writer: 'vex', markdown: 'Mine.' }))), ['failed', 'gone', null], "Bob's change of a page he can no longer see: `gone`")
// A journal's ownership changed in Foundry: its book goes again.
const sentBefore = booksOf('erebor', 'personal', 'thorin').length
await journal.update({ ownership: { carol: 2 } })
await until(() => booksOf('erebor', 'personal', 'thorin').length > sentBefore, 'the book again', 1500)
assert.equal(noteIn(lastBook('erebor', 'personal', 'thorin'), personalAlice.id), null, 'Carol now reads the journal, not the page')
await journal.update({ ownership: { carol: 0 } })
await wait(600)
assert.ok(noteIn(lastBook('erebor', 'personal', 'thorin'), personalAlice.id))
ok('only pages shared as their journal is are sent: (1) a module page where no player sees the journal; never (2) a GM-only page, (3) nor one in a journal no player sees, (4) nor a party page shown to some of its members; (5) a personal page shown to its owner; a change of a hidden page `gone`; the journal\'s ownership changed in Foundry sends the book again')

// "Add it again" after that `gone`: the app makes the same note again, over the page the Gamemaster
// hid rather than deleted. It's gone to Bob, so it's never taken as made already, which would lose
// what he wrote.
mark = writes.length
const readd = await made('erebor', P({ id: hiddenPage.id, title: 'Soon hidden', markdown: 'Mine, again.' }))
assert.deepEqual([...refusal(readd), readd.result.note], ['failed', 'gone', null, { id: hiddenPage.id, rev: null }], 'a create over a hidden page: `gone`, not done')
assert.equal(writes.filter((w, n) => (n >= mark) && ['create', 'update', 'updateMany', 'journal'].includes(w[0])).length, 0, 'nothing written')
assert.equal(hiddenPage.text.markdown, 'Some text.', 'the hidden page as it was')
assert.equal(noteIn(lastBook('erebor', 'party', 'company'), hiddenPage.id), null)
ok("a note made again from the app over a page the Gamemaster has hidden, not deleted, is `gone`, never done with nothing written")

/* -------------------------------------------- */
/*  Ownership kept in step                      */
/* -------------------------------------------- */

await journal.update({ ownership: { dave: 2 } })
await journal.update({ 'ownership.default': 2 })
await own(thorin, { bob: 3 })
assert.equal(journal.ownership.bob, 3)
assert.equal(mirkwood.ownership.bob, 3, 'both of his journals')
assert.deepEqual([journal.ownership.dave, journal.ownership.default], [2, 2], "a user the GM gave a level by hand, and the GM's default, kept")
assert.deepEqual(journal.flags['sending-stone'].journal.granted.sort(), ['alice', 'bob'])
await own(thorin, { bob: 0 })
assert.deepEqual([journal.ownership.bob, mirkwood.ownership.bob], [0, 0])
await journal.update({ 'ownership.default': 0, ownership: { dave: 0 } })
await own(vex, { dave: 3, bob: 0 })
assert.deepEqual(wolvesPage.ownership, { default: -1, dave: 3, bob: -1 }, 'back to inheriting, never None')
assert.deepEqual(wolvesPage.flags['sending-stone'].granted, ['dave'])
assert.equal(wolvesPage.testUserPermission(users.get('bob'), 'OBSERVER'), true, 'Bob still reads it while he sees the party')
assert.ok(noteIn(lastBook('erebor', 'party', 'company'), wolvesPage.id))
await own(vex, { dave: 0, bob: 3 })
assert.deepEqual(wolvesPage.ownership, { default: -1, dave: -1, bob: 3 })
ok("ownership kept in step: Bob made Thorin's owner is Owner of both his journals, and None once taken off; Vex given to Dave makes Dave Owner of Vex's party notes and Bob inherit; a user the Gamemaster added by hand, and a default they changed, kept")

// Bob changes his note in Foundry, and then who owns it is set again: Foundry counts the module's
// write as the Gamemaster's change, now, but the note was last changed by Vex's player, then.
await editPage('bob', wolvesPage, { markdown: 'Grey, and Bob counted nine.' })
await wait(600)
const wolvesNow = () => { const note = noteIn(lastBook('erebor', 'party', 'company'), wolvesPage.id); return [note.modifiedIn, note.modifiedBy, note.modifiedAt] }
const bobsEdit = wolvesNow()
assert.deepEqual(bobsEdit, ['foundry', 'Vex', wolvesPage._stats.modifiedTime])
await own(vex, { dave: 3 })
assert.deepEqual([wolvesPage.ownership.dave, wolvesPage._stats.lastModifiedBy], [3, 'gm'], "set again, which Foundry counts as the Gamemaster's change")
assert.deepEqual(wolvesNow(), bobsEdit, 'still changed in Foundry by Vex, when Bob changed it')
await own(vex, { dave: 0 })
assert.deepEqual([wolvesPage.ownership.dave, ...wolvesNow()], [-1, ...bobsEdit])
ok("a note changed in Foundry keeps who changed it there, and when, through the module's writes of who owns it")

/* -------------------------------------------- */
/*  Reading pages written in Foundry            */
/* -------------------------------------------- */

const s2 = await addPage('gm', party, { name: 'Session 2', title: { level: 1 }, text: md('') })
const there = await addPage('gm', party, { name: 'Found in Foundry', title: { level: 2 }, text: md('By hand.'), ownership: { default: -1, bob: 3, carol: 3 } })
await wait(600)
let book = lastBook('erebor', 'party', 'company')
assert.deepEqual([noteIn(book, s2.id).role, noteIn(book, there.id).role, noteIn(book, there.id).chapter], ['chapter', 'entry', s2.id], 'by level, in the chapter before it')
assert.deepEqual([noteIn(book, there.id).author, noteIn(book, there.id).modifiedIn, noteIn(book, there.id).modifiedBy], [null, 'foundry', 'Gamemaster'])
for (const [who, name] of [['bob', 'Vex'], ['carol', 'Carol'], ['gm', 'Gamemaster']]) {
  await editPage(who, there, { markdown: `Changed by ${who}.` })
  await wait(600)
  book = lastBook('erebor', 'party', 'company')
  assert.deepEqual([noteIn(book, there.id).modifiedBy, noteIn(book, there.id).modifiedAt], [name, there._stats.modifiedTime], `${who}'s change`)
}
const rich = await addPage('gm', party, { name: 'Rich', title: { level: 2 }, text: { format: 1, content: '<p>rich</p><section class="secret"><p>hidden plan</p></section>' } })
const long = await addPage('gm', journal, { name: 'n'.repeat(201), title: { level: 2 }, text: md('y'.repeat(100_001)) })
await addPage('gm', party, { name: 'Picture', type: 'image', title: { level: 2 } })
const copy = await duplicatePage('gm', wolvesPage)
await wait(600)
book = lastBook('erebor', 'party', 'company')
assert.deepEqual([noteIn(book, rich.id).format, noteIn(book, rich.id).html, 'markdown' in noteIn(book, rich.id), noteIn(book, rich.id).secret], [1, '<p>rich</p>', false, undefined], "an HTML page as HTML, a party's secret taken out")
assert.equal(book.journal.notes.some(n => n.title === 'Picture'), false, 'an image page skipped')
assert.deepEqual([noteIn(book, copy.id).author, noteIn(book, copy.id).modifiedIn, flagsCount(copy)], [null, 'foundry', false], "a duplicated page is a Foundry note of its own, its copied flags counting for nothing")
assert.equal(noteIn(book, copy.id).modifiedBy, 'Gamemaster', "made by the Gamemaster's Duplicate: never who changed the original in Foundry, though its flags keep that")
assert.equal(noteIn(book, wolvesPage.id).author.name, 'Vex', 'the original keeps its author')
const longNote = noteIn(lastBook('erebor', 'personal', 'thorin'), long.id)
assert.deepEqual([longNote.title.length, longNote.markdown.length, longNote.cut], [200, 100_000, true])
// A duplicated journal: the earliest wins.
const twin = await duplicateJournal('gm', mirkwood)
await wait(600)
assert.equal(journalOf('personal', 'thorin', 'mirkwood'), mirkwood)
assert.equal(lastBook('mirkwood', 'personal', 'thorin').journal.id, mirkwood.id)
assert.equal(noteFeatures(getCampaigns()[1]).journals.length, 1)
await deleteJournal('gm', twin)
await deletePage('gm', copy)
ok("pages written in Foundry: a chapter by its level 1, a note in the chapter before it, written in Foundry, changed by Vex (Bob's one character), Carol by her own name, or the Gamemaster; an HTML page as HTML, a party's secret out; a page or title too long cut and marked; an image skipped; a duplicated page a note of its own; a duplicated journal ignored, the earliest kept")

// Pages no schema of the app's would take as written: read as written in Foundry, and the book still goes.
const odd = await addPage('gm', journal, { name: 'Odd chapter flag', title: { level: 2 }, text: md('One.') })
await odd.update({ flags: { 'sending-stone': { page: odd.id, role: 'entry', chapter: 'a b', author: { actor: 'vex', gm: false }, createdAt: 5, modified: { actor: 'vex', gm: false, at: 5 }, hash: 'abcdef01234567' } } })
const odd2 = await addPage('gm', journal, { name: 'Odd time', title: { level: 2 }, text: md('Two.') })
await odd2.update({ flags: { 'sending-stone': { page: odd2.id, role: 'entry', chapter: null, author: { actor: 'vex', gm: false }, createdAt: 'yesterday', modified: { actor: 'vex', gm: false, at: 5 }, hash: 'abcdef01234567' } } })
const odd3 = await addPage('gm', journal, { name: 'No time', title: { level: 2 }, text: md('Three.') })
odd3._stats.createdTime = null
await odd3.update({ name: 'No time at all' })
await wait(600)
book = lastBook('erebor', 'personal', 'thorin')
for (const page of [odd, odd2, odd3]) {
  const note = noteIn(book, page.id)
  assert.deepEqual([note.author, note.modifiedIn], [null, 'foundry'], page.name)
}
assert.equal(noteIn(book, odd3.id).createdAt, odd3._stats.modifiedTime, 'no createdTime: when it was changed')
assert.ok(appTakes(book))
ok("a page whose flags are hand-edited (a chapter \"a b\", a createdAt that's a string) or whose createdTime is null: read as written in Foundry, its times from _stats, and every note of the book is one the app's schema takes")

/* -------------------------------------------- */
/*  Secrets, edits, headings, unsafe HTML       */
/* -------------------------------------------- */

const plot = await addPage('gm', party, { name: 'Plot', title: { level: 2 }, text: md('Nothing yet.') })
await editPage('gm', plot, { markdown: 'Watch them.\n\n<section class="secret"><p>the traitor</p></section>' })
const ownSecret = await made('erebor', P({ title: 'My secret', markdown: '<section class="secret"><p>my own</p></section>' }))
await wait(600)
book = lastBook('erebor', 'party', 'company')
assert.equal(JSON.stringify(app.events).includes('traitor'), false, 'the secret in nothing posted')
assert.deepEqual([noteIn(book, plot.id).format, noteIn(book, plot.id).secret, 'markdown' in noteIn(book, plot.id), noteIn(book, plot.id).html?.includes('Watch them')], [1, true, false, true])
assert.equal(JSON.stringify(app.events).includes('hidden plan'), false)
assert.deepEqual([noteIn(book, ownSecret.command.note.id).format, noteIn(book, ownSecret.command.note.id).markdown], [2, '<section class="secret"><p>my own</p></section>'], "Bob's own, unchanged in Foundry, as he wrote it")
assert.deepEqual(refusal(await made('erebor', update(plot, { book: 'party', actorId: 'company', by: 'gm', markdown: 'Plain.' }))), ['failed', 'foundry-only', null], 'changed only in Foundry')
assert.deepEqual(refusal(await made('erebor', update(rich, { book: 'party', actorId: 'company', by: 'gm', markdown: 'Plain.' }))), ['failed', 'foundry-only', null])
assert.deepEqual(refusal(await made('erebor', update(long, { title: 'Short', markdown: 'Short.' }))), ['failed', 'foundry-only', null])
ok("a party page with a secret, changed in Foundry, goes as its HTML without the secret, never its Markdown, and nothing posted holds it; a member's own raw secret, unchanged in Foundry, as written; an HTML page, one sent for its secret, or one too long changes only in Foundry")

// A secret the Gamemaster writes under a party chapter in Foundry's Markdown editor. A chapter's
// revision is its title alone, so its text never reads as changed: under the module's own chapter,
// and under one written in Foundry once a member renames it from the app, which gives it flags.
await editPage('gm', roadPage, { markdown: 'Chapter intro.\n\n<section class="secret"><p>the betrayer</p></section>' })
await editPage('gm', s2, { markdown: 'Session notes.\n\n<section class="secret"><p>the turncoat</p></section>' })
await wait(600)
const s2Renamed = await made('erebor', update(s2, { book: 'party', actorId: 'company', writer: 'thorin', title: 'Session two' }))
assert.equal(s2Renamed.result.status, 'done', 'a member renames a chapter written in Foundry')
assert.ok(flagsCount(s2) && flagsCount(roadPage) && (pageRev(s2) === s2.flags['sending-stone'].hash), 'both chapters with flags that count, unchanged by their revision')
book = lastBook('erebor', 'party', 'company')
for (const [page, intro] of [[roadPage, 'Chapter intro.'], [s2, 'Session notes.']]) {
  const note = noteIn(book, page.id)
  assert.deepEqual([note.role, note.title, note.format, note.secret, 'markdown' in note, note.html.includes(intro)], ['chapter', page.name, 1, true, false, true], page.name)
}
const chapterSecrets = () => ['betrayer', 'turncoat'].filter(word => JSON.stringify(app.events).includes(word))
assert.deepEqual(chapterSecrets(), [], 'neither secret in anything posted')
assert.equal((await made('erebor', update(roadPage, { book: 'party', actorId: 'company', writer: 'vex', title: 'The road east, again' }))).result.status, 'done', 'still renamed from the app')
assert.deepEqual(chapterSecrets(), [])
ok("a party chapter's text holding a secret goes as its HTML without the secret, never its Markdown: the module's chapter, and one written in Foundry after a member renames it; still renamed from the app")

// A character's page whose secrets its player can't read in Foundry, where a page's secrets show to
// its Owners alone: one the Gamemaster made Alice an Observer of, and then the journal itself.
const observed = await addPage('gm', journal, { name: 'Handout', title: { level: 2 }, text: md('For Thorin.\n\n<section class="secret"><p>the sealed vault</p></section>'), ownership: { default: 0, alice: 2 } })
const observedHtml = await addPage('gm', journal, { name: 'Handout in HTML', title: { level: 2 }, text: { format: 1, content: '<p>Also for Thorin.</p><section class="secret"><p>the hidden stair</p></section>' }, ownership: { default: 0, alice: 2 } })
const owned = await addPage('gm', journal, { name: 'Owned handout', title: { level: 2 }, text: md('Hers to read.\n\n<section class="secret"><p>the owner reads this</p></section>') })
await wait(600)
assert.deepEqual([observed, observedHtml, owned].map(page => page.testUserPermission(users.get('alice'), 'OWNER')), [false, false, true])
book = lastBook('erebor', 'personal', 'thorin')
const observedNote = noteIn(book, observed.id)
assert.deepEqual([observedNote.format, observedNote.secret, 'markdown' in observedNote, observedNote.html.includes('For Thorin.')], [1, true, false, true], "an Observer's Markdown page: its HTML without the secret")
assert.deepEqual([noteIn(book, observedHtml.id).format, noteIn(book, observedHtml.id).html], [1, '<p>Also for Thorin.</p>'], "an Observer's HTML page without its secret")
assert.ok(noteIn(book, owned.id).markdown.includes('the owner reads this'), 'a page Alice owns keeps its secret, which Foundry shows her')
const observerSecrets = () => ['the sealed vault', 'the hidden stair'].filter(words => JSON.stringify(app.events).includes(words))
assert.deepEqual(observerSecrets(), [], 'neither secret in anything posted')
assert.deepEqual(refusal(await made('erebor', update(observed, { by: 'gm', markdown: 'Plain.' }))), ['failed', 'foundry-only', null], 'sent for its secret, it changes only in Foundry')
await journal.update({ ownership: { alice: 2 } })
await wait(600)
const ownedNow = () => noteIn(lastBook('erebor', 'personal', 'thorin'), owned.id)
assert.deepEqual([ownedNow().format, ownedNow().secret, ownedNow().html?.includes('Hers to read.'), ownedNow().html?.includes('the owner reads this')], [1, true, true, false], 'Alice an Observer of the journal: its pages go without their secrets')
await journal.update({ ownership: { alice: 3 } })
await wait(600)
assert.ok(ownedNow().markdown.includes('the owner reads this'), 'an Owner again')
assert.deepEqual(observerSecrets(), [])
ok("a character's page whose player is only an Observer of it, or of the journal, goes without its secrets: as HTML, never its Markdown, read only; one they own keeps them")

// Alice edits her own note in Foundry.
const herNote = await made('erebor', create({ title: 'Hers', markdown: 'As written.' }))
const herPage = journal.pages.get(herNote.command.note.id)
await editPage('alice', herPage, { markdown: 'Rewritten in Foundry.' })
await wait(600)
assert.deepEqual([noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id).modifiedIn, noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id).modifiedBy, noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id).modifiedAt], ['foundry', 'Thorin', herPage._stats.modifiedTime])
assert.equal(noteIn(lastBook('erebor', 'personal', 'thorin'), chapterOne.note.id).modifiedIn, 'app', 'the module\'s own sorts and flags are no edit')
ok('an edit in Foundry by Alice reads as changed in Foundry by Thorin, at her write\'s time; the module\'s own writes never do')

// The module's own sorts keep who changed a note in Foundry, and when, though Foundry counts them as
// the Gamemaster's change, now: Alice's own page, put last among the notes in no chapter, right
// before the first chapter, so that the next note made there has no room and the journal is
// renumbered (module 0.35.0 keeps Foundry's order, so only a renumber moves pages there), and her
// edit of her note, both moved when it is.
const hersToo = await addPage('alice', journal, { name: 'Her own page', title: { level: 2 }, text: md('Written by Alice.'), sort: journal.pages.get(chapterOne.note.id).sort - 1 })
await wait(600)
const seen = () => [herPage, hersToo].map(page => {
  const note = noteIn(lastBook('erebor', 'personal', 'thorin'), page.id)
  return [note.modifiedIn, note.modifiedBy, note.modifiedAt]
})
const seenBefore = seen()
assert.deepEqual(seenBefore, [['foundry', 'Thorin', herPage._stats.modifiedTime], ['foundry', 'Thorin', hersToo._stats.modifiedTime]])
mark = writes.length
await made('erebor', create({ title: 'Renumbered' }))
const moves = writes.slice(mark).filter(w => w[0] === 'updateMany').flatMap(w => w[2].map(u => u._id))
assert.ok(moves.includes(herPage.id) && moves.includes(hersToo.id), 'a renumber that moves both')
assert.deepEqual([herPage._stats.lastModifiedBy, hersToo._stats.lastModifiedBy], ['gm', 'gm'], "which Foundry counts as the Gamemaster's change")
assert.deepEqual(seen(), seenBefore, 'still changed in Foundry by Thorin, when Alice changed them')
assert.deepEqual([flagsCount(hersToo), noteIn(lastBook('erebor', 'personal', 'thorin'), hersToo.id).author], [false, null], 'a page written in Foundry is still one')
// Changed from the app, and then in Foundry by the Gamemaster back to what Alice had: theirs, now.
const herText = herPage.text.markdown
assert.equal((await made('erebor', update(herPage, { markdown: 'From the app.' }))).result.status, 'done')
await editPage('gm', herPage, { markdown: herText })
await wait(600)
assert.deepEqual(seen()[0], ['foundry', 'Gamemaster', herPage._stats.modifiedTime], 'what was kept of her change goes with the next from the app')
ok("the module's sorts keep who changed a note in Foundry, and when, of a page written there and a note changed there; a change from the app ends it")

// A note under a chapter only the Gamemaster sees, changed from the app: the app was told it's in
// the chapter before, as players see it in Foundry, and names that again. It isn't moved, by the
// change or by a later sort.
const visible = await made('erebor', create({ actorId: 'ghost', by: 'gm', role: 'chapter', title: 'Visible', markdown: undefined }))
const visibleId = visible.command.note.id
const gmPlot = await addPage('gm', ghostJournal, { name: 'GM plot', title: { level: 1 }, text: md(''), ownership: { default: 0 } })
const clue = await addPage('gm', ghostJournal, { name: 'Clue', title: { level: 2 }, text: md('The kye is under the mat.') })
await wait(600)
const ghostOrder = () => pagesOf(ghostJournal).filter(p => p.type === 'text').map(p => p.name)
const ghostBefore = ghostOrder()
assert.deepEqual(ghostBefore.slice(-3), ['Visible', 'GM plot', 'Clue'])
const shownClue = noteIn(lastBook('erebor', 'personal', 'ghost'), clue.id)
assert.deepEqual([shownClue.chapter, noteIn(lastBook('erebor', 'personal', 'ghost'), gmPlot.id)], [visibleId, null], 'told it is in the chapter before; the hidden one not sent')
const typo = await made('erebor', update(clue, { actorId: 'ghost', by: 'gm', markdown: 'The key is under the mat.', chapter: shownClue.chapter }))
assert.equal(typo.result.status, 'done')
assert.deepEqual(ghostOrder(), ghostBefore, 'not moved out of the hidden chapter')
assert.deepEqual([clue.text.markdown, clue.flags['sending-stone'].chapter], ['The key is under the mat.', gmPlot.id], 'its flag the chapter it is in')
assert.equal(noteIn(lastBook('erebor', 'personal', 'ghost'), clue.id).chapter, visibleId, 'still told it is in the one before')
await made('erebor', create({ actorId: 'ghost', by: 'gm', title: 'Later', chapter: visibleId }))
assert.deepEqual(ghostOrder().slice(-4), ['Visible', 'Later', 'GM plot', 'Clue'], 'a later sort keeps it there')
ok("a note under a chapter only the Gamemaster sees is told as in the chapter before it; a change from the app naming that keeps it in its own, in Foundry and through later sorts")

mark = writes.length
for (const markdown of ['#loot', 'Title\n-', '> ## x', '##', 'Fine\n\nTitle\n===']) {
  const refused = await made('erebor', create({ title: 'Heading', markdown }))
  assert.deepEqual(refusal(refused), ['failed', 'headings', null], markdown)
}
assert.equal(writes.filter((w, n) => (n >= mark) && ['create', 'update', 'journal'].includes(w[0])).length, 0, 'nothing written')
for (const markdown of ['```\n# not\n```', '### fine', '#### deeper\n\n- a\n- b']) {
  assert.equal((await made('erebor', create({ title: 'Fine', markdown }))).result.status, 'done', markdown)
}
const blockHtml = new showdown.Converter({ ...CONST.SHOWDOWN_OPTIONS }).makeHtml('<div>\n#x\n</div>')
const block = await made('erebor', create({ title: 'Block', markdown: '<div>\n#x\n</div>' }))
assert.equal(block.result.status, /<h1/.test(blockHtml) ? 'failed' : 'done', 'a raw HTML block: as showdown makes it')
ok('a note with a level 1 or 2 heading as showdown reads them (#tag, an underlined title, in a quote, ## alone, ===) refused `headings`, nothing written; in a fence, ### and deeper made; a raw HTML block as showdown makes it')

const unsafe = await made('erebor', create({ title: 'Unsafe', markdown: '<img src=x onerror="alert(1)">\n\n[a](javascript:alert(1))' }))
const unsafePage = journal.pages.get(unsafe.command.note.id)
assert.equal(unsafe.result.status, 'done')
assert.ok(!/onerror/i.test(unsafePage.text.content) && !/javascript:/i.test(unsafePage.text.content), unsafePage.text.content)
J.noCleaner()
const sizeThen = journal.pages.size
const noClean = await made('erebor', create({ title: 'Raw', markdown: '<img src=x onerror="alert(1)">' }))
assert.deepEqual(refusal(noClean), ['failed', 'error', 'Foundry’s HTML cleaner wasn’t found'])
assert.equal(journal.pages.size, sizeThen, 'no page')
J.withCleaner()
ok("a note's HTML is cleaned before it's written: no onerror, no javascript: link; without Foundry's cleaner, refused, never written raw")

/* -------------------------------------------- */
/*  Hearing Foundry                             */
/* -------------------------------------------- */

let from = booksOf('erebor', 'personal', 'thorin').length
for (const n of [1, 2, 3]) {
  await editPage('alice', herPage, { markdown: `Quick ${n}.` })
  await wait(100)
}
await wait(250)
assert.equal(booksOf('erebor', 'personal', 'thorin').length, from, 'not before it settles')
await wait(400)
assert.equal(booksOf('erebor', 'personal', 'thorin').length, from + 1, 'once, 500 ms after the last of three')
assert.equal(noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id).markdown, 'Quick 3.')
from = booksOf('erebor', 'personal', 'thorin').length
const once = await made('erebor', create({ title: 'Once' }))
await wait(700)
assert.equal(booksOf('erebor', 'personal', 'thorin').length, from + 1, "the module's own write sent once")
assert.ok(once.before.some(e => isBook(e, 'erebor', 'personal', 'thorin')))
// No Gamemaster: nothing sent; back, the hello and then the book with what changed.
await J.bridgeOff()
const offAt = app.events.length
await editPage('alice', herPage, { markdown: 'While no GM was here.' })
await wait(700)
assert.equal(app.events.length, offAt, 'nothing sent with the bridge off')
await J.bridgeOn()
await until(() => app.events.slice(offAt).some(e => isBook(e, 'erebor', 'personal', 'thorin')), 'the book after the hello')
const back = app.events.slice(offAt)
assert.ok(back.findIndex(e => e.type === 'bridge.hello') < back.findIndex(e => isBook(e, 'erebor', 'personal', 'thorin')))
assert.deepEqual(back.find(e => (e.type === 'bridge.hello') && (e.campaign.id === 'erebor')).data.features.notes.journals.map(j => j.kind + ':' + j.actorId).sort(), ['party:company', 'personal:ghost', 'personal:thorin', 'personal:vex'])
assert.equal(noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id).markdown, 'While no GM was here.')
await until(() => app.polls.some(p => p.at > performance.now() - 100), 'fetching again')
// A deleted journal: no journal.
await deleteJournal('gm', mirkwood)
await until(() => lastBook('mirkwood', 'personal', 'thorin').journal === null, 'journal: null')
assert.deepEqual(lastBook('mirkwood', 'personal', 'thorin'), { kind: 'personal', actorId: 'thorin', journal: null })
// An app that starts to read notes in a heartbeat's answer: every book at once.
app.features.erebor = { commands: true, groups: 1 }
announce({ campaignId: 'erebor' })
await wait(200)
app.features.erebor = NOTES
const hbAt = app.events.length
const realNow = Date.now
Date.now = () => realNow() + 60_000
heartbeat()
Date.now = realNow
await until(() => app.events.slice(hbAt).filter(e => isBook(e, 'erebor')).length >= 4, 'every book', 2000)
assert.deepEqual(app.events.slice(hbAt).filter(e => isBook(e, 'erebor')).map(e => `${e.data.kind}:${e.data.actorId}`).sort(), ['party:company', 'personal:ghost', 'personal:thorin', 'personal:vex'])
ok('Foundry heard: three quick edits send the book once, 500 ms after the last; the module\'s own write once; with no Gamemaster nothing, and once one is back, the hello listing every journal then each book as it now is; a deleted journal `journal: null`; a first `notes: 1` in a heartbeat\'s answer sends every book')

// A change that waited while no Gamemaster was here, fetched as one comes back and made before the
// hello is answered: the book still goes ahead of its result, after the hello.
await J.bridgeOff()
const waited = update(herPage, { markdown: 'Mine, from the app.', base: '0'.repeat(14) })
handOver('erebor', waited)
const backAt = app.events.length
app.holdHello = 300
await J.bridgeOn()
await until(() => resultsOf(waited.id).length, 'the waiting change answered', 3000)
app.holdHello = 0
const backOrder = app.events.slice(backAt).map(e => ((e.type === 'bridge.hello') && (e.campaign.id === 'erebor')) ? 'hello'
  : isBook(e, 'erebor', 'personal', 'thorin') ? 'book' : ((e.type === 'command.result') && (e.data.id === waited.id)) ? 'result' : null).filter(Boolean)
assert.deepEqual(backOrder, ['hello', 'book', 'result'], JSON.stringify(backOrder))
assert.deepEqual(refusal({ result: resultsOf(waited.id)[0] }), ['failed', 'changed', null])
ok('a change fetched as the Gamemaster comes back, before the hello is answered: the hello, then the book, then its result')

/* -------------------------------------------- */
/*  Too large, and failures                     */
/* -------------------------------------------- */

const bramFirst = await made('erebor', create({ actorId: 'bram', writer: 'bram', title: 'First' }))
const bramJournal = journalOf('personal', 'bram', 'erebor')
await bramJournal.createEmbeddedDocuments('JournalEntryPage', Array.from({ length: 400 }, (_, n) => ({ name: `Page ${n}`, type: 'text', sort: (n + 2) * 100000, title: { level: 2 }, text: md('x') })))
await wait(600)
assert.deepEqual({ ...lastBook('erebor', 'personal', 'bram').withheld, bytes: 0, limit: 0 }, { reason: 'tooLarge', bytes: 0, limit: 0 })
assert.equal(lastBook('erebor', 'personal', 'bram').journal, null)
assert.equal(warnings.filter(w => w.includes("Bram's notes")).length, 1, 'one warning')
await bramJournal.deleteEmbeddedDocuments('JournalEntryPage', [...bramJournal.pages.keys()].filter(id => id !== bramFirst.command.note.id))
await wait(600)
assert.equal(lastBook('erebor', 'personal', 'bram').journal.notes.length, 1)
await bramJournal.createEmbeddedDocuments('JournalEntryPage', Array.from({ length: 11 }, (_, n) => ({ name: `Big ${n}`, type: 'text', sort: (n + 2) * 100000, title: { level: 2 }, text: md('z'.repeat(99_000)) })))
await wait(600)
const big = lastBook('erebor', 'personal', 'bram').withheld
assert.deepEqual([big.reason, big.limit, big.bytes > 1_000_000], ['tooLarge', 1_000_000, true], 'past the most the app takes')
assert.equal(warnings.filter(w => w.includes("Bram's notes")).length, 1, 'warned once a page load')
assert.match(warnings.find(w => w.includes("Bram's notes")), /more than Erebor takes, so its notes aren’t sent/)
ok('a journal of 401 notes, or past the most the app takes, goes `withheld: tooLarge` with its size, and the Gamemaster is warned once')

// A write a module's hook refuses.
let off = J.refuse('create')
const refusedCreate = await made('erebor', create({ title: 'Refused' }))
off()
assert.deepEqual(refusal(refusedCreate), ['failed', 'error', 'A write was refused'])
assert.equal(journal.pages.has(refusedCreate.command.note.id), false)
// The sort refused after the page is made: the note is there, the result says what failed, the book went first.
// T1 goes last in Tight, between T2 and the next chapter, Gamma, put right after T2: no room there,
// so it's made at the journal's end, to be renumbered.
const tight = await made('erebor', V({ role: 'chapter', title: 'Tight', createdAt: 250, markdown: undefined }))
const tightAfter = await made('erebor', V({ title: 'T2', createdAt: 402, chapter: tight.command.note.id }))
await vexJournal.updateEmbeddedDocuments('JournalEntryPage', [{ _id: gammaId, sort: vexJournal.pages.get(tightAfter.command.note.id).sort + 1 }])
off = J.refuse('update', () => true)
const squeezed = await made('erebor', V({ title: 'T1', createdAt: 401, chapter: tight.command.note.id }))
off()
assert.deepEqual(refusal(squeezed), ['failed', 'error', 'A write was refused'])
assert.ok(vexJournal.pages.has(squeezed.command.note.id), 'the note made')
assert.equal(squeezed.result.note.rev, pageRev(vexJournal.pages.get(squeezed.command.note.id)))
assert.ok(noteIn(squeezed.before.filter(e => isBook(e, 'erebor', 'personal', 'vex')).at(-1)?.data, squeezed.command.note.id), 'the book, with it, before the result')
// Foundry ignoring keepId: the stray page deleted again.
faults.ignoreKeepId = true
const sizeBefore = journal.pages.size
const stray = await made('erebor', create({ title: 'Stray' }))
faults.ignoreKeepId = false
assert.deepEqual(refusal(stray), ['failed', 'error', 'Foundry didn’t keep the note’s id'])
assert.equal(journal.pages.size, sizeBefore, 'no stray page left')
ok("a create a module's hook refuses fails, no page; a sort refused after the page is made fails, the note there and the book first; a page made with another id is deleted again and fails")

/* -------------------------------------------- */
/*  What a journal holds, and who writes        */
/* -------------------------------------------- */

// Bram's journal holds more than 1,000,000 characters (above): a note more is refused, and so is a
// longer change of one in it.
const bramPage = bramJournal.pages.get(bramFirst.command.note.id)
mark = writes.length
assert.deepEqual(refusal(await made('erebor', create({ actorId: 'bram', writer: 'bram', title: 'One more', markdown: 'x' }))), ['failed', 'full', null], 'past the most text')
assert.deepEqual(refusal(await made('erebor', update(bramPage, { actorId: 'bram', writer: 'bram', markdown: 'A little longer now.' }))), ['failed', 'full', null], 'a change past it')
assert.equal(writes.filter((w, n) => (n >= mark) && ['create', 'update', 'journal'].includes(w[0])).length, 0, 'nothing written')
// 50 chapters and 300 notes: the 50th and the 300th made, the next of each refused.
const ofRole = role => ghostJournal.pages.filter(page => (page.type === 'text') && (pageRole(page) === role)).length
const fill = (role, count) => ghostJournal.createEmbeddedDocuments('JournalEntryPage', Array.from({ length: count }, (_, n) => ({
  name: `${role} ${n}`, type: 'text', sort: (Math.max(...ghostJournal.pages.map(p => p.sort)) + ((n + 1) * 100000)), title: { level: (role === 'chapter') ? 1 : 2 }, text: md(''),
})))
const ghostCreate = (role, title) => made('erebor', create({ actorId: 'ghost', by: 'gm', role, title, ...((role === 'chapter') && { markdown: undefined }) }))
await fill('chapter', 49 - ofRole('chapter'))
assert.equal((await ghostCreate('chapter', 'The fiftieth')).result.status, 'done', 'the 50th chapter')
assert.deepEqual(refusal(await ghostCreate('chapter', 'The fifty-first')), ['failed', 'full', null], 'the 51st')
await fill('entry', 299 - ofRole('entry'))
assert.equal((await ghostCreate('entry', 'The three hundredth')).result.status, 'done', 'the 300th note')
assert.deepEqual(refusal(await ghostCreate('entry', 'One too many')), ['failed', 'full', null], 'the 301st')
assert.deepEqual([ofRole('chapter'), ofRole('entry')], [50, 300])
await wait(600)
ok('a journal holding 50 chapters, 300 notes, or 1,000,000 characters is full: the 50th and 300th made, the next refused `full`, and a change past the text too, nothing written')

// The app taking larger posts, as a heartbeat's answer says: a book held back as too large goes.
let ahead = 120_000
const heartbeatNow = () => {
  const realNow = Date.now
  ahead += 60_000
  Date.now = () => realNow() + ahead
  try { heartbeat() } finally { Date.now = realNow }
}
assert.equal(lastBook('erebor', 'personal', 'bram').withheld?.reason, 'tooLarge')
app.features.erebor = { ...NOTES, maxBytes: 4_000_000 }
let at = app.events.length
heartbeatNow()
await until(() => app.events.slice(at).some(e => isBook(e, 'erebor', 'personal', 'bram') && e.data.journal), "Bram's book", 2000)
assert.equal(lastBook('erebor', 'personal', 'bram').journal.notes.length, 12)
app.features.erebor = NOTES
at = app.events.length
heartbeatNow()
await until(() => app.events.slice(at).some(e => isBook(e, 'erebor', 'personal', 'bram')), "Bram's book again", 2000)
assert.equal(lastBook('erebor', 'personal', 'bram').withheld?.reason, 'tooLarge', 'held back again once it takes less')
ok('a book held back as too large goes once the app says it takes larger posts, and is held back again once it takes less')

// Who may write: a writer outside the campaign, and a book of a character or party outside it.
const byMara = await made('erebor', P({ writer: 'mara', title: 'By Mara' }))
assert.deepEqual(refusal(byMara), ['failed', 'unknown', null], "a party note by a character who isn't the campaign's")
for (const cmd of [create({ actorId: 'mara', writer: 'mara', title: 'Her own' }), create({ book: 'party', actorId: 'thorin', writer: 'thorin', title: 'Not a party' })]) {
  const outside = await made('erebor', cmd)
  assert.deepEqual(refusal(outside), ['failed', 'unknown', null], `${cmd.note.book} ${cmd.actorId}`)
  assert.equal(outside.before.filter(e => e.type === 'journal.updated').length, 0, 'no book before the journal is looked for')
}
assert.deepEqual([journalOf('personal', 'mara', 'erebor'), party.pages.some(p => p.name === 'By Mara')], [null, false])
// The campaign gone between the fetch and the run, or no JournalEntry here: `off`.
const offGone = await runNoteCommand(create({ title: 'Nowhere' }), { ...erebor(), id: 'gondor', title: 'Gondor' })
assert.deepEqual([offGone.status, offGone.reason], ['failed', 'off'], 'a campaign gone')
await wait(50)
const journalsHere = game.journal
let offNoJournals
game.journal = null
try {
  offNoJournals = await runNoteCommand(create({ title: 'No journals' }), erebor())
} finally {
  game.journal = journalsHere
}
assert.deepEqual([offNoJournals.status, offNoJournals.reason], ['failed', 'off'], 'no journals')
ok("a note by a writer outside the campaign, or for a book whose character or party isn't in it, is `unknown`, with no book first; one whose campaign has gone, or with no journals here, `off`")

// A book lost to failures that might not last: the hello again, a while later, and every book after it.
app.fail = e => (e.type === 'journal.updated') && (e.campaign.id === 'erebor') && (e.data.actorId === 'thorin')
at = app.events.length
await editPage('alice', herPage, { markdown: 'Lost on its way.' })
await until(() => logged.some(line => line.includes('Could not deliver journal.updated')), 'the book dropped', 3000)
app.fail = null
assert.equal(app.events.slice(at).some(e => isBook(e, 'erebor', 'personal', 'thorin')), false, 'not taken')
at = app.events.length
heartbeatNow()
const lostBook = e => isBook(e, 'erebor', 'personal', 'thorin') && (noteIn(e.data, herPage.id)?.markdown === 'Lost on its way.')
await until(() => app.events.slice(at).some(lostBook), 'the book again', 3000)
const resent = app.events.slice(at).filter(e => e.campaign.id === 'erebor')
assert.ok(resent.findIndex(e => e.type === 'bridge.hello') >= 0, 'the hello again')
assert.ok(resent.findIndex(e => e.type === 'bridge.hello') < resent.findIndex(lostBook), 'and the book after it')
// Its failure said in the console, as any post's is, with nothing of the note in it.
const dropped = logged.filter(line => line.includes('Could not deliver journal.updated'))
assert.equal(dropped.some(line => line.includes('Lost on its way')), false)
logged.splice(0, logged.length, ...logged.filter(line => !dropped.includes(line)))
ok('a book lost to failures that might not last sends the hello again a while later, and the book after it')

// A hello that listed a journal deleted before the hello was answered: `journal: null` after it.
await made('mirkwood', create({ title: 'Mirk again', markdown: 'Trees.' }))
const mirkAgain = journalOf('personal', 'thorin', 'mirkwood')
assert.ok(mirkAgain)
await wait(600)
let letGo
const gate = new Promise(resolve => { letGo = resolve })
let heldHello = null
const standIn = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (!heldHello && String(url).endsWith('/api/events') && (body.type === 'bridge.hello') && (body.campaign.id === 'mirkwood')) {
    heldHello = body
    await gate
  }
  return standIn(url, init)
}
at = app.events.length
announce({ campaignId: 'mirkwood' })
await until(() => heldHello, 'the held hello')
assert.deepEqual(heldHello.data.features.notes.journals, [{ kind: 'personal', actorId: 'thorin' }])
await deleteJournal('gm', mirkAgain)
await wait(700)
letGo()
await until(() => app.events.slice(at).some(e => isBook(e, 'mirkwood', 'personal', 'thorin')), "Mirkwood's book", 2000)
globalThis.fetch = standIn
assert.deepEqual(lastBook('mirkwood', 'personal', 'thorin'), { kind: 'personal', actorId: 'thorin', journal: null })
ok('a journal a hello listed, deleted before the hello was answered, is sent `journal: null` after it')

// An app that doesn't say it reads notes, as one rolled back: no book after its hello, nor after a
// change in Foundry; once it says so again, the books.
app.features.erebor = { commands: true, groups: 1 }
at = app.events.length
announce({ campaignId: 'erebor' })
await until(() => app.events.slice(at).some(e => (e.type === 'bridge.hello') && (e.campaign.id === 'erebor')), 'the hello')
await wait(300)
await editPage('alice', herPage, { markdown: 'To an older app.' })
await wait(700)
assert.equal(app.events.slice(at).filter(e => isBook(e, 'erebor')).length, 0, 'no journal.updated to an app that reads none')
app.features.erebor = NOTES
announce({ campaignId: 'erebor' })
await until(() => noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id)?.markdown === 'To an older app.', 'the book once it reads them', 2000)
ok("an app whose answer doesn't say `notes: 1` is sent no journal.updated, after its hello or a change in Foundry; once it says so, the books")

/* -------------------------------------------- */
/*  Nothing but what the app takes              */
/* -------------------------------------------- */

const posted = app.events.filter(e => e.type === 'journal.updated')
assert.ok(posted.length > 40)
for (const event of posted) appTakes(event.data)
assert.equal(app.events.some(e => e.type.startsWith('chat.')), false, 'no note goes to chat')
const ofNotes = line => /journal|note|Could not (make|report) a roll/i.test(line)
assert.equal(logged.filter(ofNotes).length, 0, `nothing of notes logged: ${logged.filter(ofNotes).slice(0, 2)}`)
for (const result of app.events.filter(e => (e.type === 'command.result') && e.data.note)) {
  assert.deepEqual(Object.keys(result.data.note).filter(key => !['id', 'rev', 'deleted'].includes(key)), [], 'a result never carries a title or text')
}
ok(`every journal.updated posted (${posted.length}) is one the app's schema takes; no note in chat or the console; no result carries a note's title or text`)

console.log(`notes${DND5E6 ? ' (dnd5e 6)' : ''}: ${oks} done`)
process.exit(0)
