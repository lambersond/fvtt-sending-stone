// dnd5e's favorites, for the stand-in characters (module 0.37.0, its contract §6.7): a character's
// `system.favorites`, `{type, id, sort}` each, and its hasFavorite, addFavorite and removeFavorite,
// ported from dnd5e 5.3.3's CharacterData (module/data/actor/character.mjs:298-346; 6.0.5's are the
// same, :323-364). An entry is matched by its exact id, as dnd5e matches it; addFavorite does nothing
// for one there already, throws at once for a relative id that refers to nothing on the actor, and
// otherwise adds it last, its sort the highest plus CONST.SORT_INTEGER_DENSITY, in one update;
// removeFavorite filters out every entry of that id in one update, even where there's none, or for
// an old-style resource's id, `resources.<key>`, sets its maximum to 0 instead.
//
// Foundry's fromUuidSync(id, { relative: actor }) [core, unverified] is a lookup here, written apart
// from the module's own reading of these ids (sheet-favorites.mjs): `.Item.<id>`,
// `.Item.<id>.Activity.<id>`, `.ActiveEffect.<id>` and `.Item.<id>.ActiveEffect.<id>`, among the
// actor's items and effects and an item's activities and effects, each a collection with `get` or a
// list. Each update sets what it changes on the actor and then fires updateActor, as Foundry tells
// every client. The app's e2e uses this too, through e2e/fvtt.

/**
 * What a document holds, by id: from a Foundry or dnd5e collection, a Map, or a list.
 * @param {Map|object[]|{get: Function}|undefined} collection
 * @param {string} id
 * @returns {object|null}
 */
function byId(collection, id) {
  if (!collection || !id) return null
  if (typeof collection.get === 'function') return collection.get(id) ?? null
  for (const each of collection) if ((each?.id ?? each?._id) === id) return each
  return null
}

/**
 * What a relative UUID refers to on the actor, as Foundry's fromUuidSync with `relative` finds it,
 * or null: for these four shapes only.
 * @param {object} actor
 * @param {string} uuid
 * @returns {object|null}
 */
function relative(actor, uuid) {
  const parts = String(uuid).split('.')
  if (parts[0] !== '') return null
  if ((parts[1] === 'ActiveEffect') && (parts.length === 3)) return byId(actor.effects, parts[2])
  if (parts[1] !== 'Item') return null
  const item = byId(actor.items, parts[2])
  if (parts.length === 3) return item
  if (!item || (parts.length !== 5)) return null
  if (parts[3] === 'Activity') return byId(item.system?.activities, parts[4])
  if (parts[3] === 'ActiveEffect') return byId(item.effects, parts[4])
  return null
}

/** Set a value at a dotted path, making what's missing on the way. */
function setPath(object, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  let at = object
  for (const key of keys) at = (at[key] ??= {})
  at[last] = value
}

/** A flat change, `{"system.favorites": […]}`, as Foundry hands it to its hooks, expanded. */
function expand(changes) {
  const out = {}
  for (const [path, value] of Object.entries(changes)) setPath(out, path, value)
  return out
}

/**
 * Give a stand-in character dnd5e's favorites: `system.favorites`, copies of those given, and
 * `system.hasFavorite`, `addFavorite` and `removeFavorite`, as dnd5e's CharacterData has them.
 * @param {object} actor
 * @param {object} [options]
 * @param {{type: string, id: string, sort?: number}[]} [options.favorites]
 * @returns {{faults: {throwOnAdd: boolean, dropUpdate: boolean}, updates: number}}   What the harness
 *   may switch and read: `faults.throwOnAdd` makes addFavorite throw as it does for a relative id it
 *   can't find; `faults.dropUpdate` makes each update write nothing and fire nothing, resolving to
 *   undefined, as Foundry's does when a preUpdateActor hook cancels it; and `updates` counts the
 *   updates made, dropped or not.
 */
export function withFavorites(actor, { favorites = [] } = {}) {
  const port = { faults: { throwOnAdd: false, dropUpdate: false }, updates: 0 }
  const system = actor.system
  // As dnd5e's schema prepares an entry: its sort an integer, 0 where none was given.
  system.favorites = favorites.map(({ type, id, sort }) => ({ type, id, sort: Number.isInteger(sort) ? sort : 0 }))

  /** Actor#update, as far as favorites write it, firing updateActor. */
  const update = async changes => {
    port.updates++
    if (port.faults.dropUpdate) return undefined
    for (const [path, value] of Object.entries(changes)) setPath(actor, path, value)
    await Hooks.callAll('updateActor', actor, expand(changes), {}, game.user?.id)
    return actor
  }

  const methods = {
    // character.mjs:305-307
    hasFavorite(favoriteId) {
      return !!system.favorites.find(f => f.id === favoriteId)
    },
    // character.mjs:318-333
    addFavorite(favorite) {
      if (system.hasFavorite(favorite.id)) return Promise.resolve(actor)
      if (port.faults.throwOnAdd || (favorite.id.startsWith('.') && (relative(actor, favorite.id) === null))) {
        throw new Error(`The item with id ${favorite.id} is not owned by actor ${actor.id}`)
      }
      let maxSort = 0
      const list = system.favorites.map(f => {
        if (f.sort > maxSort) maxSort = f.sort
        return { ...f }
      })
      list.push({ ...favorite, sort: maxSort + (CONST.SORT_INTEGER_DENSITY ?? 100000) })
      return update({ 'system.favorites': list })
    },
    // character.mjs:341-346
    removeFavorite(favoriteId) {
      if (favoriteId.startsWith('resources.')) return update({ [`system.${favoriteId}.max`]: 0 })
      const list = system.favorites.filter(f => f.id !== favoriteId)
      return update({ 'system.favorites': list })
    },
  }
  // Methods of the data model, not data: kept out of anything that copies the actor's system.
  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(system, name, { value: fn, configurable: true, writable: true, enumerable: false })
  }
  return port
}
