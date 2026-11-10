// A stand-in for what Tidy 5e Sheets keeps on a character and how it writes it (module 0.45.0), and
// for as much of Foundry 14's actor update as those writes need. Tidy's side is from its source, read
// and never run (v13.10.5 and v14.4.1, src/features/journal/JournalQuadrone.svelte.ts and
// src/foundry/TidyFlags.ts, TidyFlags.types.ts): the current sheet's journal in
// `flags["tidy5e-sheet"]["document-journal"]`, a record of `{ id, title, value, sort }` by key, each
// add a new key with the highest sort plus 10, an edit `.title` and `.value` alone, a reorder the
// sorts alone; Tidy 13's delete the legacy `-=<key>: null`, Tidy 14's `<key>: _del`; and the Classic
// sheet's boxes, `notes1` to `notes4` (`{ name, value }`) and `notes` (`{ value }`), written a field
// at a time. Foundry's side [core, unverified]: dotted keys expanded, objects merged, `-=<key>` and
// `_del` deleting the key, and the hook handed the expanded change, a delete as its key; and, with
// `foundry.strayDelete`, an early Foundry 14 (14.365 to 14.368) that keeps `-=<key>` as a key of its
// own and the entry with it. Load it after stub.mjs.

export const TIDY = 'tidy5e-sheet'
export const JOURNAL = 'document-journal'

/** Foundry 14's deletion operator, a global Tidy 14 deletes with (its foundry-and-system.d.ts:213). */
class ForcedDeletion {}
globalThis._del ??= Object.freeze(new ForcedDeletion())

/** How this Foundry applies Tidy 13's `-=<key>`: deleted, or, early in V14, kept as a stray key. */
export const foundry = { strayDelete: false }

const isPlain = value => Boolean(value) && (typeof value === 'object') && !Array.isArray(value) && (value !== globalThis._del)
const leaf = value => ((value === globalThis._del) || (value === null) || (typeof value !== 'object')) ? value : structuredClone(value)

/** Foundry's update data: dotted keys spread into objects, the values themselves kept, `_del` among them. */
function expand(changes) {
  const out = {}
  for (const [key, value] of Object.entries(changes)) {
    const parts = key.split('.')
    let at = out
    for (const part of parts.slice(0, -1)) at = (at[part] = isPlain(at[part]) ? at[part] : {})
    at[parts.at(-1)] = isPlain(value) ? merge(isPlain(at[parts.at(-1)]) ? at[parts.at(-1)] : {}, value, { keep: true }) : value
  }
  return out
}

/** Merge update data into what's there, as Foundry does; `keep` merges data into data, deleting nothing. */
function merge(target, source, { keep = false } = {}) {
  for (const [key, value] of Object.entries(source)) {
    if (!keep && (value === globalThis._del)) { delete target[key]; continue }
    if (!keep && key.startsWith('-=') && !foundry.strayDelete) { delete target[key.slice(2)]; continue }
    target[key] = isPlain(value) ? merge(isPlain(target[key]) ? target[key] : {}, value, { keep }) : leaf(value)
  }
  return target
}

const OWNER = 3

/**
 * An actor as far as the module reads one for Tidy's journal: its flags, `_source` too where given,
 * its ownership as core reads it, whether it's a token's own, and `update`, which applies the change
 * and calls `updateActor` with it, as the Gamemaster's client unless `userId` says whose.
 */
export class TidyActor {
  constructor({ id, name, owners = [], type = 'character', flags = {}, isToken = false, source }) {
    Object.assign(this, {
      documentName: 'Actor', id, name, type, isToken, uuid: `Actor.${id}`, img: `${id}.webp`,
      ownership: { default: 0, ...Object.fromEntries(owners.map(u => [u, OWNER])) },
      flags: structuredClone(flags),
      system: { attributes: { hp: { value: 30, max: 40, temp: 0 } } },
      items: [], effects: [],
    })
    if (source) this._source = { flags: structuredClone(source) }
  }
  get hasPlayerOwner() { return game.users.some(u => !u.isGM && this.testUserPermission(u, 'OWNER')) }
  getUserLevel(u) { return u.isGM ? OWNER : (this.ownership[u.id] ?? this.ownership.default ?? 0) }
  testUserPermission(u, level) { return this.getUserLevel(u) >= CONST.DOCUMENT_OWNERSHIP_LEVELS[level] }
  getFlag(scope, key) { return key.split('.').reduce((at, part) => at?.[part], this.flags?.[scope]) }
  async update(changes, options = {}, userId = 'gm') {
    const data = expand(changes)
    for (const [key, value] of Object.entries(data)) this[key] = isPlain(value) ? merge(isPlain(this[key]) ? this[key] : {}, value) : leaf(value)
    await Hooks.callAll('updateActor', this, data, options, userId)
    return this
  }
}

/** A Tidy journal entry as Tidy stores it. */
export const entry = (id, title, value, sort) => ({ id, title, value, sort })

/** The current sheet's journal of an actor, as Tidy reads it: `{}` where it has none. */
const journalOf = actor => actor.flags?.[TIDY]?.[JOURNAL] ?? {}
const path = (...parts) => ['flags', TIDY, ...parts].join('.')

/** Tidy's own writes, as each Tidy makes them (JournalQuadrone, TidyFlags). */
export const tidy = {
  /** Add, as its + does: the id given, the highest sort plus 10. */
  add(actor, id, { title = 'New Journal Entry', value = '' } = {}) {
    const sort = Math.max(0, ...Object.values(journalOf(actor)).map(e => e.sort ?? 0)) + 10
    return actor.update({ [path(JOURNAL, id)]: { title, value, id, sort } })
  },
  /** Its edit dialog's save, on every change and again as it closes: the title and the text. */
  edit(actor, id, { title, value }) {
    return actor.update({
      ...((title !== undefined) && { [path(JOURNAL, id, 'title')]: title }),
      ...((value !== undefined) && { [path(JOURNAL, id, 'value')]: value }),
    })
  },
  /** A drag, by performIntegerSort: the sorts alone of the entries it moves. */
  sort(actor, sorts) {
    return actor.update(Object.fromEntries(Object.entries(sorts).map(([id, sort]) => [path(JOURNAL, id), { sort }])))
  },
  /** Tidy 13.10.5's delete: the legacy deletion key. */
  delete13(actor, id) { return actor.update({ [`${path(JOURNAL)}.-=${id}`]: null }) },
  /** Tidy 14's delete: Foundry 14's deletion operator. */
  delete14(actor, id) { return actor.update({ [path(JOURNAL, id)]: globalThis._del }) },
  /** The Classic sheet's Journal tab: a box's name, or its text, a field at a time. */
  classic(actor, key, field, text) { return actor.update({ [path(key, field)]: text }) },
}
