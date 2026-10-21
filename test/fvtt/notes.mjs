// Journal notes (module 0.34.0, its contract §2-§5, §7): the hello's `features.notes`, with no
// switch, and the fetching it needs with the campaign's rolls, moves and removals off; the `note`
// command's checks; journals found by flag, made lazily per book and campaign, in their folder, with
// their ownership and flags; a page per chapter and per note, made with the app's id in a call of
// its own; who may change what, in the app's command and in Foundry; made at most once in effect,
// one at a time past the watchdog; Foundry's order; `journal.updated` before every result, and after
// every change heard of in Foundry, with only what's shared as the journal is, never a party's
// secret, and nothing the app's schema wouldn't take; ownership kept in step with the actors'; and
// the safeguards against Foundry's own edits. On journal-core.mjs's stand-in for Foundry's journals,
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
const NOTES = { commands: true, notes: 1, groups: 1 }
const app = { events: [], polls: [], waiting: new Map(), wakes: new Map(), features: { erebor: NOTES, mirkwood: NOTES }, fail: null }
const json = body => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  if (String(url).endsWith('/api/events')) {
    if (app.fail?.(body)) return { ok: false, status: 503, statusText: 'Unavailable', headers: new Headers() }
    app.events.push(body)
    const announcing = ['bridge.hello', 'bridge.heartbeat'].includes(body.type)
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
const { checkNoteCommand } = await import(`${MODULE}/scripts/command-notes.mjs`)
const { flagsCount, noteFeatures, pageRev, sharedLikeJournal } = await import(`${MODULE}/scripts/journals.mjs`)
const { getCampaigns } = await import(`${MODULE}/scripts/campaigns.mjs`)
const erebor = () => getCampaigns().find(c => c.id === 'erebor')
await until(() => helloOf('erebor') && helloOf('mirkwood'), 'the hellos')

/* -------------------------------------------- */
/*  The hello and fetching                      */
/* -------------------------------------------- */

const NONE_YET = { enabled: true, kinds: ['personal', 'party'], reason: null, journals: [] }
for (const id of ['erebor', 'mirkwood']) {
  assert.deepEqual(helloOf(id).data.features.notes, NONE_YET)
  assert.deepEqual(Object.keys(helloOf(id).data.features), ['rolls', 'transfers', 'removals', 'notes'])
  assert.deepEqual(Object.keys(helloOf(id).data.features.notes), ['enabled', 'kinds', 'reason', 'journals'])
  assert.equal(helloOf(id).data.features.rolls.enabled, false)
}
game.system.id = 'pf2e'
assert.deepEqual(noteFeatures(erebor()), NONE_YET, 'under another system, notes still')
game.system.id = 'dnd5e'
ok("every hello's features.notes, after removals: kept here, both kinds, no reason, no journal yet; under another system the same")

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
assert.deepEqual(vexOrder(), ['Behind', 'Alpha', 'A1', 'A2', 'A3', 'Beta'], 'by when each was written, an entry of the first chapter before the second')
const vexJournal = journalOf('personal', 'vex', 'erebor')
const image = await addPage('gm', vexJournal, { name: 'Map', type: 'image', sort: vexJournal.pages.get(alpha.command.note.id).sort + 1 })
await made('erebor', V({ title: 'A0', createdAt: 100, chapter: alpha.command.note.id }))
assert.deepEqual(vexOrder(), ['Behind', 'Alpha', 'Map', 'A0', 'A1', 'A2', 'A3', 'Beta'], "an image page stays after the page it followed")
// 18 notes into one place, each between the first and the one before it: no whole number fits by
// the 17th, and every page is renumbered once.
const renumbers = () => writes.filter(w => w[0] === 'updateMany').length
await made('erebor', V({ title: 'Zero', createdAt: 1 }))
const before18 = renumbers()
for (let n = 0; n < 18; n++) await made('erebor', V({ title: `Early ${n}`, createdAt: 99 - n }))
assert.equal(renumbers() - before18, 1, 'one renumber, in one call')
const lastMany = writes.filter(w => w[0] === 'updateMany').at(-1)
assert.ok(lastMany[2].every(u => Number.isInteger(u.sort) && (u.sort % 100000 === 0)), 'a step apart')
assert.deepEqual(vexOrder().slice(0, 20), ['Zero', ...Array.from({ length: 18 }, (_, n) => `Early ${17 - n}`), 'Behind'])
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
ok("Foundry's order follows the app's: notes in no chapter first, then each chapter followed by its notes, each by when it was written; a page that isn't text keeps its place; a page midway between its neighbours, and one renumbering, in one call, where none fits; a note made before its chapter waits at the top and is gathered under it; the module's sorts aren't edits")

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

// Alice edits her own note in Foundry.
const herNote = await made('erebor', create({ title: 'Hers', markdown: 'As written.' }))
const herPage = journal.pages.get(herNote.command.note.id)
await editPage('alice', herPage, { markdown: 'Rewritten in Foundry.' })
await wait(600)
assert.deepEqual([noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id).modifiedIn, noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id).modifiedBy, noteIn(lastBook('erebor', 'personal', 'thorin'), herPage.id).modifiedAt], ['foundry', 'Thorin', herPage._stats.modifiedTime])
assert.equal(noteIn(lastBook('erebor', 'personal', 'thorin'), chapterOne.note.id).modifiedIn, 'app', 'the module\'s own sorts and flags are no edit')
ok('an edit in Foundry by Alice reads as changed in Foundry by Thorin, at her write\'s time; the module\'s own writes never do')

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
const tight = await made('erebor', V({ role: 'chapter', title: 'Tight', createdAt: 400, markdown: undefined }))
const tightAfter = await made('erebor', V({ title: 'T2', createdAt: 402, chapter: tight.command.note.id }))
const tightPage = vexJournal.pages.get(tight.command.note.id)
await vexJournal.updateEmbeddedDocuments('JournalEntryPage', [{ _id: tightAfter.command.note.id, sort: tightPage.sort + 1 }])
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
