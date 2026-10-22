// A stand-in for the parts of Foundry VTT 14's journals the module keeps notes in (module 0.34.0):
// journal entries and their pages, folders, ownership as core reads it, `_stats`, the six document
// hooks, Foundry's showdown and its options, its Markdown sheet's registration, and `cleanHTML`. Load
// it after stub.mjs, whose `game`, `foundry`, `CONST`, `CONFIG` and `Hooks` it adds to; notes.mjs and
// the app's e2e suites (through e2e/fvtt) share it. Every write is made as the Gamemaster's client,
// unless `as(userId, …)` makes it as a player's in Foundry, which core's rules then apply to:
// `[core, unverified]` where the typings don't say (round 0.34.0 §13.8); and `dragPages`, a reorder
// made in Foundry (module 0.35.0).
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
/** showdown 2.1.0, from the module's devDependencies: what Foundry 13 and 14 carry. */
export const showdown = require('showdown')

export const LEVELS = Object.freeze({ INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 })
export const FORMATS = Object.freeze({ HTML: 1, MARKDOWN: 2 })
CONST.DOCUMENT_OWNERSHIP_LEVELS = { ...LEVELS }
CONST.JOURNAL_ENTRY_PAGE_FORMATS = { ...FORMATS }
// Foundry's own (T14 common/constants.d.mts:2073-2082).
CONST.SHOWDOWN_OPTIONS = {
  disableForced4SpacesIndentedSublists: true, noHeaderId: true, parseImgDimensions: true, strikethrough: true,
  tables: true, tablesHeaderId: true,
}
CONST.SORT_INTEGER_DENSITY = 100000
globalThis.showdown = showdown

// Core's text page sheets, as registered (`CONFIG.JournalEntryPage.sheetClasses.text`): the
// rich-text editor, the default, and the Markdown one.
class JournalEntryPageProseMirrorSheet {}
class JournalEntryPageMarkdownSheet {}
CONFIG.JournalEntryPage = {
  sheetClasses: {
    text: {
      'core.JournalEntryPageProseMirrorSheet': { id: 'core.JournalEntryPageProseMirrorSheet', cls: JournalEntryPageProseMirrorSheet, default: true },
      'core.JournalEntryPageMarkdownSheet': { id: 'core.JournalEntryPageMarkdownSheet', cls: JournalEntryPageMarkdownSheet, default: false },
    },
  },
}

/**
 * Foundry's cleanHTML, as far as these check it [core, unverified: its exact rules]: no `<script>`,
 * no `on…` attribute, and no `javascript:` link or source.
 */
function cleanHTML(html) {
  const doc = new DOMParser().parseFromString(`<body>${String(html)}</body>`, 'text/html')
  for (const script of doc.body.querySelectorAll('script')) script.remove()
  for (const el of doc.body.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      if (/^on/i.test(name) || (/^(href|src|action|formaction|xlink:href)$/i.test(name) && /^\s*javascript:/i.test(value))) el.removeAttribute(name)
    }
  }
  return doc.body.innerHTML
}
foundry.utils.cleanHTML = cleanHTML
/** Take `foundry.utils.cleanHTML` away, as a Foundry without it would be; and give it back. */
export const noCleaner = () => { delete foundry.utils.cleanHTML }
export const withCleaner = () => { foundry.utils.cleanHTML = cleanHTML }

// ---- Plain data ----

const isPlain = value => Boolean(value) && (typeof value === 'object') && !Array.isArray(value)
const clone = value => (value === undefined) ? undefined : structuredClone(value)
/** Foundry's update data: dotted keys spread into objects, which merge into what's there; arrays and the rest replace it. */
function expand(changes) {
  const out = {}
  for (const [key, value] of Object.entries(changes)) {
    const parts = key.split('.')
    let at = out
    for (const part of parts.slice(0, -1)) at = (at[part] = isPlain(at[part]) ? at[part] : {})
    const last = parts.at(-1)
    at[last] = (isPlain(value) && isPlain(at[last])) ? merge(at[last], value) : clone(value)
  }
  return out
}
function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (isPlain(value) && isPlain(target[key])) ? merge(target[key], value) : clone(value)
  }
  return target
}
export const getProperty = (object, path) => path.split('.').reduce((at, part) => at?.[part], object)

export class Collection extends Map {
  /** As Foundry's: its values, not its entries. */
  [Symbol.iterator]() { return this.values() }
  get contents() { return [...this.values()] }
  find(fn) { return this.contents.find(fn) }
  filter(fn) { return this.contents.filter(fn) }
  map(fn) { return this.contents.map(fn) }
  some(fn) { return this.contents.some(fn) }
}

// ---- Who writes, and when ----

let acting = null
/** The user a write is made as: a player's in Foundry inside `as`, else this client's, the Gamemaster's. */
export const actingUser = () => game.users.get(acting ?? game.user.id)
/**
 * Make a write as a user in Foundry, as from their own client: core's permissions apply to it. The
 * user holds only while `fn` starts its write, which reads who it's made by at once, so that the
 * module's own writes meanwhile stay the Gamemaster's.
 */
export async function as(userId, fn) {
  const before = acting
  acting = userId
  let made
  try { made = fn() } finally { acting = before }
  return await made
}
let last = 0
/** The server's time, in milliseconds: never the same twice, as two writes are never at the same instant here. */
const now = () => (last = Math.max(Date.now(), last + 1))
const stamp = (stats, user) => {
  const time = now()
  // Made once and never refreshed (FI#3653); a null one, as FI#10348 left some, stays null.
  const created = (stats && Object.hasOwn(stats, 'createdTime')) ? stats.createdTime : time
  return { ...(stats ?? {}), createdTime: created, modifiedTime: time, lastModifiedBy: user?.id ?? null }
}

/** Every write, in order, with what it wrote: `[what, id, data, options]`. */
export const writes = []

/**
 * The switches that make a write fail or wait, as transfers.mjs's do. `refuse(kind, when)`: a
 * module's pre-hook refuses each write of that kind it matches (`create`, `update`, `delete` of
 * pages; `journal` for a JournalEntry's create): Foundry leaves it out without throwing. `hold(kind,
 * when)`: the next such write waits until let go. `ignoreKeepId`: a page made with an id of its own.
 * `stripOptions`: the hooks are handed none of a write's own options, as a core that doesn't pass
 * them on would (module 0.35.0) [core, unverified].
 */
export const faults = { refusals: [], holds: [], ignoreKeepId: false, stripOptions: false }
export function refuse(kind, when = () => true) {
  const refusal = { kind, when }
  faults.refusals.push(refusal)
  return () => { faults.refusals = faults.refusals.filter(r => r !== refusal) }
}
export function hold(kind, when = () => true) {
  let release
  const held = { kind, when, until: new Promise(resolve => { release = resolve }), held: false }
  faults.holds.push(held)
  return { release: () => release(), get held() { return held.held } }
}
export function clearFaults() {
  faults.refusals = []
  faults.holds = []
  faults.ignoreKeepId = false
  faults.stripOptions = false
}
/** A write's options as its hooks are handed them: none with `faults.stripOptions`. */
const heard = options => (faults.stripOptions ? {} : options)
const refused = (kind, doc, data) => faults.refusals.some(r => (r.kind === kind) && r.when(doc, data))
async function holding(kind, doc, data) {
  const held = faults.holds.find(h => (h.kind === kind) && h.when(doc, data))
  if (!held) return
  faults.holds = faults.holds.filter(h => h !== held)
  held.held = true
  await held.until
}
const turn = () => new Promise(resolve => setImmediate(resolve))

// ---- Ownership ----

/** A user's recorded level on a document, as core's getUserLevel reads it; a page's INHERIT as its journal's. */
function levelOf(doc, user) {
  if (!user) return LEVELS.NONE
  const own = doc.ownership ?? {}
  const level = Object.hasOwn(own, user.id) ? own[user.id] : (own.default ?? LEVELS.NONE)
  if ((level === LEVELS.INHERIT) && doc.parent) return levelOf(doc.parent, user)
  return (level === LEVELS.INHERIT) ? LEVELS.NONE : level
}
function permitted(doc, user, level) {
  return Boolean(user?.isGM) || (levelOf(doc, user) >= ((typeof level === 'string') ? LEVELS[level] : level))
}
function mayWrite(doc, changes, user) {
  if (user?.isGM) return
  if (!permitted(doc, user, 'OWNER')) throw new Error(`${user?.name ?? 'Someone'} may not change ${doc.documentName} ${doc.id}`)
  // Ownership is the Gamemaster's alone (gmOnly).
  if ('ownership' in expand(changes)) throw new Error(`${user.name} may not change who owns ${doc.documentName} ${doc.id}`)
}

// ---- Documents ----

class Document {
  get id() { return this._id }
  get uuid() { return this.parent ? `${this.parent.uuid}.${this.documentName}.${this.id}` : `${this.documentName}.${this.id}` }
  getFlag(scope, key) { return getProperty(this.flags?.[scope] ?? {}, key) }
  getUserLevel(user) { return levelOf(this, user) }
  testUserPermission(user, level) { return permitted(this, user, level) }
  /** Apply update data as Foundry would, `_stats` and embedded pages aside: what changed, or null where nothing did. */
  _apply(changes, user) {
    const data = expand(changes)
    for (const key of ['_id', '_stats', 'pages']) delete data[key]
    const before = JSON.stringify(this._data())
    const after = merge(this._data(), data)
    if (JSON.stringify(after) === before) return null
    for (const key of Object.keys(data)) this[key] = after[key]
    this._stats = stamp(this._stats, user)
    return data
  }
}

export class JournalEntryPage extends Document {
  constructor(data, parent, { stats = true, user = null } = {}) {
    super()
    this.parent = parent
    Object.assign(this, {
      _id: data._id, name: data.name, type: data.type ?? 'text', sort: data.sort ?? 0,
      title: { show: true, level: 1, ...clone(data.title) },
      text: { format: FORMATS.HTML, content: '', markdown: '', ...clone(data.text) },
      image: clone(data.image), src: data.src ?? null,
      ownership: { default: LEVELS.INHERIT, ...clone(data.ownership) },
      flags: clone(data.flags) ?? {},
      // Pages made inside their journal's create had no `_stats` until 14.355 (FI#10348).
      _stats: stats ? stamp(data._stats?.duplicateSource ? { duplicateSource: data._stats.duplicateSource } : {}, user) : { createdTime: null, modifiedTime: null, lastModifiedBy: null },
    })
  }
  get documentName() { return 'JournalEntryPage' }
  _data() {
    const { _id, name, type, sort, title, text, image, src, ownership, flags } = this
    return clone({ _id, name, type, sort, title, text, image, src, ownership, flags })
  }
  toObject() { return { ...this._data(), _stats: clone(this._stats) } }
  async update(changes, options = {}) {
    const user = actingUser()
    mayWrite(this, changes, user)
    writes.push(['update', this.id, clone(changes)])
    await holding('update', this, changes)
    await turn()
    if (refused('update', this, changes)) return undefined
    const changed = this._apply(changes, user)
    if (!changed) return undefined
    await Hooks.callAll('updateJournalEntryPage', this, changed, heard(options), user?.id)
    return this
  }
  async delete(options = {}) {
    const [gone] = await this.parent.deleteEmbeddedDocuments('JournalEntryPage', [this.id], options)
    return gone
  }
}

export class JournalEntry extends Document {
  static get implementation() { return this }
  static async create(data, options = {}) {
    const user = actingUser()
    if (!user?.isGM) throw new Error('Only a Gamemaster makes journals here')
    writes.push(['journal', null, clone(data), clone(options)])
    await turn()
    if (refused('journal', null, data)) return undefined
    const entry = new JournalEntry(data, { ...options, user })
    game.journal.set(entry.id, entry)
    await Hooks.callAll('createJournalEntry', entry, heard(options), user?.id)
    return entry
  }
  constructor(data, options = {}) {
    super()
    const id = (options.keepId && data._id) ? data._id : foundry.utils.randomID()
    Object.assign(this, {
      _id: id, name: data.name, folder: data.folder ?? null, sort: data.sort ?? 0,
      ownership: { default: LEVELS.NONE, ...clone(data.ownership) },
      flags: clone(data.flags) ?? {},
      _stats: stamp(data._stats?.duplicateSource ? { duplicateSource: data._stats.duplicateSource } : {}, options.user),
    })
    this.pages = new Collection()
    for (const page of data.pages ?? []) {
      const made = new JournalEntryPage({ ...page, _id: (options.keepId && page._id) ? page._id : foundry.utils.randomID() }, this, { stats: false })
      this.pages.set(made.id, made)
    }
  }
  get documentName() { return 'JournalEntry' }
  _data() {
    const { _id, name, folder, sort, ownership, flags } = this
    return clone({ _id, name, folder, sort, ownership, flags })
  }
  toObject() { return { ...this._data(), _stats: clone(this._stats), pages: this.pages.map(page => page.toObject()) } }
  async update(changes, options = {}) {
    const user = actingUser()
    mayWrite(this, changes, user)
    writes.push(['updateJournal', this.id, clone(changes)])
    await turn()
    if (refused('updateJournal', this, changes)) return undefined
    const changed = this._apply(changes, user)
    if (!changed) return undefined
    await Hooks.callAll('updateJournalEntry', this, changed, heard(options), user?.id)
    return this
  }
  async delete(options = {}) {
    const user = actingUser()
    if (!user?.isGM && !permitted(this, user, 'OWNER')) throw new Error(`${user?.name} may not delete JournalEntry ${this.id}`)
    writes.push(['deleteJournal', this.id])
    await turn()
    game.journal.delete(this.id)
    await Hooks.callAll('deleteJournalEntry', this, heard(options), user?.id)
    return this
  }
  async createEmbeddedDocuments(type, list, options = {}) {
    const user = actingUser()
    // A player adds pages only where they own the journal [core, unverified: v14's #canCreate].
    if (!user?.isGM && !permitted(this, user, 'OWNER')) throw new Error(`${user?.name} may not add pages to JournalEntry ${this.id}`)
    writes.push(['create', this.id, list.map(data => data._id ?? null), { keepId: options.keepId === true }, clone(list)])
    await holding('create', this, list)
    await turn()
    const made = []
    for (const data of list) {
      if (refused('create', this, data)) continue
      const id = (options.keepId && data._id && !faults.ignoreKeepId) ? data._id : foundry.utils.randomID()
      if (this.pages.has(id)) throw new Error(`JournalEntryPage ${id} already exists`)
      const page = new JournalEntryPage({ ...data, _id: id }, this, { user })
      this.pages.set(id, page)
      made.push(page)
    }
    for (const page of made) await Hooks.callAll('createJournalEntryPage', page, heard(options), user?.id)
    return made
  }
  async updateEmbeddedDocuments(type, updates, options = {}) {
    const user = actingUser()
    writes.push(['updateMany', this.id, clone(updates)])
    for (const { _id, ...changes } of updates) {
      const page = this.pages.get(_id)
      if (!page) throw new Error(`JournalEntryPage ${_id} does not exist`)
      mayWrite(page, changes, user)
    }
    await holding('update', this, updates)
    await turn()
    const done = []
    for (const { _id, ...changes } of updates) {
      const page = this.pages.get(_id)
      if (refused('update', page, changes)) continue
      const changed = page._apply(changes, user)
      if (changed) done.push([page, changed])
    }
    for (const [page, changed] of done) await Hooks.callAll('updateJournalEntryPage', page, changed, heard(options), user?.id)
    return done.map(([page]) => page)
  }
  async deleteEmbeddedDocuments(type, ids, options = {}) {
    const user = actingUser()
    writes.push(['delete', this.id, [...ids]])
    // As Foundry's: one that isn't there refuses the whole call.
    const missing = ids.find(id => !this.pages.has(id))
    if (missing) throw new Error(`JournalEntryPage ${missing} does not exist`)
    for (const id of ids) {
      if (!user?.isGM && !permitted(this.pages.get(id), user, 'OWNER')) throw new Error(`${user?.name} may not delete JournalEntryPage ${id}`)
    }
    await holding('delete', this, ids)
    await turn()
    const gone = ids.map(id => this.pages.get(id)).filter(page => !refused('delete', page, page.id))
    for (const page of gone) this.pages.delete(page.id)
    for (const page of gone) await Hooks.callAll('deleteJournalEntryPage', page, heard(options), user?.id)
    return gone
  }
}

export class Folder extends Document {
  static get implementation() { return this }
  static async create(data) {
    writes.push(['folder', null, clone(data)])
    await turn()
    const folder = new Folder(data)
    game.folders.set(folder.id, folder)
    return folder
  }
  constructor(data) {
    super()
    Object.assign(this, { _id: foundry.utils.randomID(), name: data.name, type: data.type, sorting: data.sorting ?? 'a', folder: data.folder ?? null, flags: clone(data.flags) ?? {} })
  }
  get documentName() { return 'Folder' }
  _data() { return clone({ _id: this._id, name: this.name, type: this.type, sorting: this.sorting, folder: this.folder, flags: this.flags }) }
  toObject() { return this._data() }
  async delete() { game.folders.delete(this.id); return this }
}

globalThis.JournalEntry = JournalEntry
globalThis.JournalEntryPage = JournalEntryPage
globalThis.Folder = Folder
game.journal = new Collection()
game.folders = new Collection()

// ---- What's done in Foundry, as from its own sheets ----

/** Every journal, in the order made. */
export const journals = () => game.journal.contents
/** A journal's pages in Foundry's order. */
export const pagesOf = entry => entry.pages.contents.sort((a, b) => (a.sort - b.sort) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)))
/** The journal this module keeps for a book, if any: the earliest that claims it. */
export function journalOf(kind, actorId, campaignId) {
  return journals().filter(entry => {
    const flag = entry.flags?.['sending-stone']?.journal
    return (flag?.kind === kind) && (flag.actor === actorId) && (flag.campaign === campaignId)
  }).sort((a, b) => (a._stats.createdTime - b._stats.createdTime) || (a.id < b.id ? -1 : 1))[0] ?? null
}
/** A page by its id, in whichever journal holds it. */
export const pageById = id => journals().map(entry => entry.pages.get(id)).find(Boolean) ?? null

/**
 * Change a page as a user in Foundry, as its sheet would: its title, its level, and its text in
 * the Markdown editor (`markdown`, its HTML converted as Foundry's sheet converts it) or the
 * rich-text one (`html`, which clears the Markdown, MFJ §7).
 */
export function editPage(userId, page, { name, level, markdown, html } = {}) {
  const changes = {}
  if (name !== undefined) changes.name = name
  if (level !== undefined) changes['title.level'] = level
  if (markdown !== undefined) Object.assign(changes, { 'text.format': FORMATS.MARKDOWN, 'text.markdown': markdown, 'text.content': cleanHTML(new showdown.Converter({ ...CONST.SHOWDOWN_OPTIONS }).makeHtml(markdown)) })
  if (html !== undefined) Object.assign(changes, { 'text.format': FORMATS.HTML, 'text.markdown': '', 'text.content': html })
  return as(userId, () => page.update(changes))
}
/** Add a page to a journal as a user in Foundry: a text page at its default level 1 unless said. */
export async function addPage(userId, entry, data = {}) {
  const sort = Math.max(0, ...entry.pages.map(page => page.sort)) + CONST.SORT_INTEGER_DENSITY
  const [page] = await as(userId, () => entry.createEmbeddedDocuments('JournalEntryPage', [{ type: 'text', sort, ...data }]))
  return page
}
/**
 * Reorder pages as a user in Foundry, as dragging them in its sidebar does (module 0.35.0): the
 * listed pages take, in the listed order, the sorts of the slots they hold now, in one
 * `updateEmbeddedDocuments` of `{ _id, sort }` alone, as core's `sortRelative` writes a drag (T14
 * client/documents/abstract/client-document.d.mts:185-191) [core, types]. Only the pages whose sort
 * changes are written.
 */
export function dragPages(userId, entry, ids) {
  const slots = ids.map(id => entry.pages.get(id).sort).sort((a, b) => a - b)
  const updates = ids.map((id, n) => ({ _id: id, sort: slots[n] })).filter(({ _id, sort }) => entry.pages.get(_id).sort !== sort)
  return as(userId, () => entry.updateEmbeddedDocuments('JournalEntryPage', updates))
}
/** Delete a page, or a whole journal, as a user in Foundry. */
export const deletePage = (userId, page) => as(userId, () => page.parent.deleteEmbeddedDocuments('JournalEntryPage', [page.id]))
export const deleteJournal = (userId, entry) => as(userId, () => entry.delete())
/** Duplicate a page in its journal, as Foundry's Duplicate does: a new id, the same flags, `_stats.duplicateSource` the original. */
export async function duplicatePage(userId, page) {
  const { _id, _stats, ...data } = page.toObject()
  const [copy] = await as(userId, () => page.parent.createEmbeddedDocuments('JournalEntryPage', [{ ...data, sort: page.sort + 1, _stats: { duplicateSource: page.uuid } }]))
  return copy
}
/** Duplicate a journal with its pages, as Foundry's Duplicate does: new ids, the same flags. */
export async function duplicateJournal(userId, entry) {
  const { _id, _stats, pages, ...data } = entry.toObject()
  const copy = await as(userId, () => JournalEntry.create({ ...data, name: `${entry.name} (Copy)`, _stats: { duplicateSource: entry.uuid } }))
  await as(userId, () => copy.createEmbeddedDocuments('JournalEntryPage', pages.map(({ _id, _stats, ...page }) => page)))
  return copy
}

/** The Gamemaster leaves, so nothing listens or sends; and comes back, the bridge again. */
export async function bridgeOff() {
  game.user.isActiveGM = false
  await Hooks.callAll('userConnected', game.user, false)
}
export async function bridgeOn() {
  game.user.isActiveGM = true
  await Hooks.callAll('userConnected', game.user, true)
}
