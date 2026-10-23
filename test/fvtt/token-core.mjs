// Scenes and tokens as Foundry v14 has them, as far as module 0.36.0's companions meet them (its
// contract §2.1-§2.3, §6.11): scenes in `game.scenes`, the active one among them; tokens placed on
// them, linked to their world actor or not; and for an unlinked token its synthetic actor, an
// Actor5e of its own with its base actor's id, whose flags, hit points, ownership and items are its
// ActorDelta's over its base's, and whose uuid names its scene and token. A companion's world actor
// is made by `companionActor`, the only maker of an actor's `ownership` in the harness, so no world
// before 0.36.0 lists one. Hooks fire as a fault picks them, so that each way core tells of a token's
// creature changing is proved alone: `updateToken` with its delta, `updateActorDelta`, `updateActor`
// with the synthetic actor; its items' hooks with the synthetic actor as their parent, its delta, or
// none at all. And a combat whose combatants' initiative the module writes as core does, each write
// counted, firing `updateCombatant` and `createCombatant` after it, as core fires them on every client
// (T14/client/hooks.d.mts:1564-1580, 1605-1624); and, for End Turn, whose turns move as Next Turn
// moves them. Shared with the e2e through AE/fvtt. Import it after stub.mjs, actor5e.mjs and
// activity5e.mjs.
import { actors, combat, combatant } from './stub.mjs'
import { Actor5e } from './actor5e.mjs'
import { equip } from './activity5e.mjs'

const { deepClone, getProperty, mergeObject, setProperty } = foundry.utils
const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER

/**
 * What a case makes core do: `deltaHooks`, which hooks a token's delta changing fires ("token":
 * `updateToken` with `delta` in its change; "delta": `updateActorDelta`; "both"; "actor": `updateActor`
 * with the synthetic actor, as a core that told only that would); `syntheticItemParent`, the parent
 * a token's creature's item hooks give ("actor", "delta", or "none", where only `updateActorDelta`
 * fires); `canvasScene`, the scene the Gamemaster is viewing, null for the active one, whose tokens
 * alone a synthetic actor's `getActiveTokens` finds; `speakerNoToken`, a speaker of a synthetic actor
 * given without its token, its speaker's actor then the base.
 */
export const faults = { deltaHooks: 'both', syntheticItemParent: 'actor', canvasScene: null, speakerNoToken: false }

/** As Foundry's: its values, not its entries, and a collection's finders. */
export class Collection extends Map {
  [Symbol.iterator]() { return this.values() }
  get contents() { return [...this.values()] }
  filter(fn) { return this.contents.filter(fn) }
  find(fn) { return this.contents.find(fn) }
  map(fn) { return this.contents.map(fn) }
  some(fn) { return this.contents.some(fn) }
}

const userId = () => game.user?.id ?? 'gm'

/* -------------------------------------------- */
/*  Scenes                                      */
/* -------------------------------------------- */

/** The world's scenes; `active` the one players are on. */
class Scenes extends Collection {
  get active() { return this.find(scene => scene.active) ?? null }
}
export const scenes = new Scenes()
game.scenes = scenes

/**
 * A scene, into `game.scenes`.
 * @param {string} id
 * @param {object} [options]
 * @param {boolean} [options.active]
 * @returns {object}
 */
export function scene(id, { active = false, name = id } = {}) {
  const made = {
    id, name, active, documentName: 'Scene', uuid: `Scene.${id}`, tokens: new Collection(),
    /** As core's: the change written, then `updateScene` on every client. */
    async update(changes) {
      Object.assign(this, changes)
      await Hooks.callAll('updateScene', this, changes, {}, userId())
      return this
    },
    /** As core's: its tokens gone with it, then `deleteScene`. */
    async delete() {
      scenes.delete(this.id)
      await Hooks.callAll('deleteScene', this, {}, userId())
      return this
    },
  }
  scenes.set(id, made)
  return made
}

/**
 * Make a scene the active one, as core's `activate`: the one that was active updated first.
 * @param {object} next
 */
export async function activate(next) {
  const was = scenes.active
  if (was && (was !== next)) await was.update({ active: false })
  await next.update({ active: true })
}

/* -------------------------------------------- */
/*  Actors                                      */
/* -------------------------------------------- */

/**
 * A companion's world actor: an Actor5e of type `npc`, its `ownership` by user id, `{ default: 0 }`
 * and each owner given Owner, or as given whole, and whether its prototype token is linked. Its
 * `make` builds it afresh, as a token's synthetic actor is built from it.
 * @param {string} id
 * @param {string} name
 * @param {object} [options]
 * @param {string[]} [options.owners]       Users given Owner by id.
 * @param {object} [options.ownership]      Its ownership whole, in place of `owners`.
 * @param {boolean} [options.linked]        Is its prototype token linked?
 * @param {string} [options.type]           "npc", or another.
 * @param {object} [options.flags]          Its flags, `dnd5e`'s among them.
 * @param {object} [options.spec]           Actor5e's options: mods, hp, skills, prof, npc (hit dice).
 * @param {object} [options.gear]           equip()'s: items, spells, ac.
 * @param {object} [options.system]         Merged into its system: details, resources, traits.
 * @returns {Actor5e}
 */
export function companionActor(id, name, { owners = [], ownership, linked = true, type = 'npc', flags = {}, spec = {}, gear = {}, system = {}, img } = {}) {
  const make = () => {
    // Its own copy of what it's made of, as each document has its own data.
    const actor = new Actor5e({ id, name, npc: { denomination: 8, max: 0, spent: 0 }, ...deepClone(spec) })
    actor.type = type
    actor.documentName = 'Actor'
    if (img !== undefined) actor.img = img
    equip(actor, deepClone(gear))
    mergeObject(actor.system, deepClone(system))
    actor.flags = mergeObject(actor.flags, deepClone(flags))
    actor.ownership = deepClone(ownership ?? { default: 0, ...Object.fromEntries(owners.map(user => [user, OWNER])) })
    actor.prototypeToken = { actorLink: linked }
    // Core's testUserPermission, by its ownership: the user's own level, else its default.
    actor.testUserPermission = user => ((actor.ownership[user.id] ?? actor.ownership.default ?? 0) >= OWNER)
    Object.defineProperty(actor, 'hasPlayerOwner', {
      configurable: true,
      get: () => game.users.some(user => !user.isGM && actor.testUserPermission(user)),
    })
    actor.getActiveTokens = () => scenes.active?.tokens.filter(token => token.actorLink && (token.actorId === actor.id)) ?? []
    actor.allApplicableEffects = function* () { yield* actor.effectsMade ?? [] }
    return actor
  }
  const actor = make()
  actor.make = make
  actors.set(id, actor)
  return actor
}

/**
 * Change a world actor as core does: the change written, then `updateActor`.
 * @param {Actor} actor
 * @param {object} changes   Nested, as core's.
 */
export async function changeActor(actor, changes) {
  mergeObject(actor, deepClone(changes))
  await Hooks.callAll('updateActor', actor, changes, {}, userId())
}

/**
 * Change an item of a world actor as core does: the change written into it, and into the same item
 * of each of its unlinked tokens' synthetic actors made so far whose delta keeps none of its own, as
 * core's `_onUpdateBaseActor` makes them again (T14/client/documents/token.d.mts:3393-3405); then
 * `updateItem` for the world actor's item alone, as core fires no hook for the synthetic actors.
 * @param {Actor} base
 * @param {string} itemId
 * @param {object} changes
 */
export async function changeBaseItem(base, itemId, changes) {
  const item = base.items.get(itemId)
  item.updateSource(changes)
  for (const each of scenes) {
    for (const token of each.tokens) {
      if (token.actorLink || (token.actorId !== base.id) || !token._synthetic || token.delta.items[itemId]) continue
      token._synthetic.items.get(itemId)?.updateSource(deepClone(changes))
    }
  }
  await Hooks.callAll('updateItem', item, changes, {}, userId())
}

/* -------------------------------------------- */
/*  Tokens                                      */
/* -------------------------------------------- */

/**
 * A token placed on a scene, as core's TokenDocument: an unlinked one with its delta and synthetic
 * actor, made up the first time it's read, as core makes it; a linked one standing for its world
 * actor. Placed as the world was before the module was ready; `createToken` places one as core
 * does after, firing its hook.
 * @param {object} on        The scene.
 * @param {Actor} base       Its world actor, made by companionActor.
 * @param {object} [options]
 * @returns {object}
 */
export function placeToken(on, base, { id, actorLink = false, hidden = false, name, delta = {} } = {}) {
  const token = {
    id, documentName: 'Token', parent: on, actorLink, actorId: base.id, hidden, name: name ?? base.name,
    uuid: `Scene.${on.id}.Token.${id}`, texture: { src: base.img },
    get baseActor() { return game.actors.get(this.actorId) ?? null },
    get isLinked() { return this.actorLink },
    get actor() {
      if (this.actorLink) return this.baseActor
      this._synthetic ??= synthesize(this)
      return this._synthetic
    },
    /** As core's: what changes written, then `updateToken`; a delta's own change as `changeDelta`'s. */
    async update(changes) {
      Object.assign(this, changes)
      await Hooks.callAll('updateToken', this, changes, {}, userId())
      return this
    },
    /** As core's: off its scene, then `deleteToken`. */
    async delete() {
      on.tokens.delete(this.id)
      await Hooks.callAll('deleteToken', this, {}, userId())
      return this
    },
  }
  token.object = { id, name: token.name, document: token, get actor() { return token.actor } }
  token.delta = {
    documentName: 'ActorDelta', parent: token, id: `delta-${id}`,
    system: deepClone(delta.system ?? {}), flags: deepClone(delta.flags ?? {}),
    ownership: deepClone(delta.ownership ?? {}), items: deepClone(delta.items ?? {}),
  }
  on.tokens.set(id, token)
  return token
}

/**
 * A token placed as core places one: then `createToken`.
 * @returns {Promise<object>}
 */
export async function createToken(on, base, options) {
  const token = placeToken(on, base, options)
  await Hooks.callAll('createToken', token, {}, userId())
  return token
}

/**
 * A token's synthetic actor, as core's: an actor of its own, made from its base's data with its
 * delta's over it, keeping its base's id; `isToken`; its own items, whose parent its item hooks give
 * as `faults.syntheticItemParent` says; found on the Gamemaster's canvas only while they view its
 * scene.
 * @param {object} token
 * @returns {Actor5e}
 */
function synthesize(token) {
  const base = token.baseActor
  const actor = base.make()
  const { delta } = token
  mergeObject(actor.system, deepClone(delta.system))
  actor.flags = mergeObject(actor.flags, deepClone(delta.flags))
  actor.ownership = { ...actor.ownership, ...deepClone(delta.ownership) }
  for (const [itemId, changes] of Object.entries(delta.items)) actor.items.get(itemId)?.updateSource(changes)
  Object.defineProperty(actor, 'isToken', { configurable: true, value: true })
  actor.token = token
  actor.uuid = `${token.uuid}.Actor.${base.id}`
  Object.defineProperty(actor, 'speakerNoToken', { configurable: true, get: () => faults.speakerNoToken })
  actor.getActiveTokens = () => (((faults.canvasScene ?? scenes.active?.id) === token.parent.id) ? [token.object] : [])
  for (const item of actor.items) {
    Object.defineProperty(item, 'parent', {
      configurable: true, get: () => ((faults.syntheticItemParent === 'delta') ? token.delta : actor),
    })
  }
  // Its items changed as a use changes them: the change written, then the hooks the fault picks.
  actor.updateEmbeddedDocuments = async (type, updates) => {
    for (const { _id, ...changes } of updates) {
      const item = actor.items.get(_id)
      if (!item) continue
      item.updateSource(changes)
      token.delta.items[_id] = mergeObject(token.delta.items[_id] ?? {}, deepClone(changes))
      if (faults.syntheticItemParent === 'none') await Hooks.callAll('updateActorDelta', token.delta, { items: [{ _id, ...changes }] }, {}, userId())
      else await Hooks.callAll('updateItem', item, changes, {}, userId())
    }
  }
  // dnd5e's actor update, as a use spends a legendary action: written into the delta, as core's.
  actor.update = async changes => {
    for (const [path, value] of Object.entries(changes)) {
      setProperty(actor, path, value)
      if (path.startsWith('system.')) setProperty(token.delta, path, value)
    }
    await deltaHooks(token, { system: foundry.utils.expandObject(changes).system ?? {} })
  }
  return actor
}

/**
 * The hooks a change of a token's delta fires, as `faults.deltaHooks` picks them.
 * @param {object} token
 * @param {object} changes   The delta's change, nested.
 */
async function deltaHooks(token, changes) {
  const which = faults.deltaHooks
  if ((which === 'token') || (which === 'both')) await Hooks.callAll('updateToken', token, { delta: changes }, {}, userId())
  if ((which === 'delta') || (which === 'both')) await Hooks.callAll('updateActorDelta', token.delta, changes, {}, userId())
  if (which === 'actor') await Hooks.callAll('updateActor', token.actor, changes, {}, userId())
}

/**
 * Change a token's delta, as damage dealt to its creature does: written into its delta and its
 * synthetic actor, then the hooks the fault picks.
 * @param {object} token
 * @param {object} changes   Nested: `{ system: {...} }`, `{ flags }`, `{ ownership }`.
 */
export async function changeDelta(token, changes) {
  const actor = token.actorLink ? null : token.actor
  for (const key of ['system', 'flags', 'ownership']) {
    if (!changes[key]) continue
    mergeObject(token.delta[key], deepClone(changes[key]))
    if (actor) {
      if (key === 'ownership') Object.assign(actor.ownership, deepClone(changes.ownership))
      else mergeObject(actor[key], deepClone(changes[key]))
    }
  }
  await deltaHooks(token, changes)
}

/* -------------------------------------------- */
/*  Uuids                                       */
/* -------------------------------------------- */

/**
 * Core's fromUuidSync, for what lives on a scene: a token, its actor, an item of its actor's and an
 * item's activity; anything else as the harness's own, if it set one, else a world actor's.
 * @param {string} uuid
 * @returns {object|null}
 */
function sceneDocument(uuid) {
  const match = /^Scene\.([^.]+)\.Token\.([^.]+)(?:\.Actor\.([^.]+))?(?:\.Item\.([^.]+))?(?:\.Activity\.([^.]+))?$/.exec(uuid ?? '')
  if (!match) return undefined
  const [, sceneId, tokenId, actorId, itemId, activityId] = match
  const token = scenes.get(sceneId)?.tokens.get(tokenId)
  if (!token) return null
  if (!actorId) return token
  const actor = token.actor
  if (!itemId) return actor
  const item = actor?.items?.get(itemId) ?? null
  return activityId ? (item?.system?.activities?.get(activityId) ?? null) : item
}
const theirSync = globalThis.fromUuidSync
const theirs = globalThis.fromUuid
globalThis.fromUuidSync = (uuid, options) => {
  const found = sceneDocument(uuid)
  if (found !== undefined) return found
  if (theirSync) return theirSync(uuid, options)
  const [, id] = /^Actor\.([^.]+)$/.exec(uuid ?? '') ?? []
  return id ? (game.actors.get(id) ?? null) : null
}
globalThis.fromUuid = async (uuid, options) => {
  const found = sceneDocument(uuid)
  if (found !== undefined) return found
  if (theirs) return theirs(uuid, options)
  return globalThis.fromUuidSync(uuid, options)
}

/* -------------------------------------------- */
/*  Combats                                     */
/* -------------------------------------------- */

/**
 * A combat, stub.mjs's, whose combatants' initiative is written as core writes it: through
 * `updateEmbeddedDocuments`, each change written and then `updateCombatant` fired for each, with the
 * write's options and this client's user; `writes` counts those calls, the module's writes. Combatants
 * created through `createEmbeddedDocuments` fire `createCombatant`. `rollInitiative` is core's with
 * dnd5e's Combatant5e (actor5e.mjs's), written the same way but uncounted; `setInitiative` stands for
 * a change made on another client, as the Gamemaster typing one or a player's roll in Foundry.
 *
 * Since module 0.36.0's End Turn (its contract §6.11, §6.13), its turns move as core's are
 * remembered to [core, unverified shape]: `nextTurn` as the bridge's Next Turn, `combatTurn` or, at
 * a round's change, `combatRound` fired before the write, then `updateCombat` and `combatTurnChange`
 * after it, `advances` counting the calls that wrote, `refuseNext` making the next write nothing, as
 * a module's `preUpdateCombat` may; `setTurn` as the Gamemaster's Next Turn made on another client,
 * and `update` as core's own update, each writing and firing the hooks after a write but neither
 * `combatTurn` nor `combatRound`, uncounted. `started` follows `round`. While started, an initiative
 * written keeps the current combatant current, as core does [core, unverified], its index moved
 * with it, firing nothing more; stub.mjs's `combatant` is otherwise whoever sorts at the index.
 * @param {string} id
 * @param {object[]} combatants   `{ id, actor, token?, fields? }`, a token's creature by its token.
 * @returns {object}
 */
export function combatOf(id, combatants = []) {
  const made = combat(id)
  made.writes = 0
  made.written = []
  made.advances = 0
  made.refuseNext = false
  Object.defineProperty(made, 'started', { configurable: true, enumerable: true, get() { return this.round > 0 } })
  const add = ({ id: combatantId, actor, token = null, fields = {} }) => combatant(made, combatantId, token ? token.actor : actor, {
    ...(token && { token, tokenId: token.id, sceneId: token.parent.id, actorId: token.actorId }),
    ...fields,
  })
  for (const each of combatants) add(each)
  const write = async (updates, options = {}) => {
    // The combatant whose turn it is stays so, wherever the write sorts it.
    const current = made.started ? made.combatant : null
    const changed = []
    for (const { _id, ...changes } of updates) {
      const cb = made.combatants.get(_id)
      if (!cb) continue
      // Its flags merged into those it has, as core's update merges them.
      const { flags, ...rest } = changes
      Object.assign(cb, rest)
      if (flags) cb.flags = mergeObject(cb.flags ?? {}, deepClone(flags))
      changed.push([cb, changes])
    }
    if (current) made.turn = made.turns.indexOf(current)
    for (const [cb, changes] of changed) await Hooks.callAll('updateCombatant', cb, changes, options, userId())
  }
  made.updateEmbeddedDocuments = async (type, updates, options = {}) => {
    made.writes++
    made.written.push({ type, updates: deepClone(updates), options: deepClone(options) })
    await write(updates, options)
  }
  made.createEmbeddedDocuments = async (type, data, options = {}) => {
    const created = data.map(add)
    for (const cb of created) await Hooks.callAll('createCombatant', cb, options, userId())
    return created
  }
  made.setInitiative = (cb, initiative) => write([{ _id: cb.id, initiative }])
  made.getCombatantsByActor = actor => made.combatants.filter(cb => cb.actor?.id === actor.id)
  /** Core's Combat#rollInitiative, with dnd5e's Combatant5e#getInitiativeRoll, written as core writes it. */
  made.rollInitiative = async (ids, { messageOptions = {}, messageMode } = {}) => {
    const updates = []
    for (const cbId of ids) {
      const cb = made.combatants.get(cbId)
      const roll = cb.actor.getInitiativeRoll()
      await roll.evaluate()
      updates.push({ _id: cb.id, initiative: roll.total })
      const data = mergeObject({
        speaker: ChatMessage.getSpeaker({ actor: cb.actor, token: cb.token ?? undefined }),
        flavor: `${cb.name} rolls for Initiative!`, flags: { 'core.initiativeRoll': true },
      }, messageOptions)
      await ChatMessage.create({ ...data, rolls: [roll] }, { messageMode: messageMode ?? messageOptions.rollMode })
    }
    await write(updates)
    return made
  }

  /** Core's HistoryData of the turn as it stands (T14/client/documents/combat.d.mts:1026-1031). */
  const history = () => {
    const cb = made.combatant ?? null
    return { round: made.round, turn: made.turn, tokenId: cb?.tokenId ?? null, combatantId: cb?.id ?? null }
  }
  /** The turn written, then what core fires on every client after the write. */
  const moveTo = async ({ round, turn }, options = {}) => {
    const prior = history()
    made.round = round
    made.turn = turn
    await Hooks.callAll('updateCombat', made, { round, turn }, options, userId())
    await Hooks.callAll('combatTurnChange', made, prior, history())
  }
  /**
   * Core's Combat#nextTurn: the next combatant in the order, past the defeated where the tracker
   * skips them; at round 0, or past the last, the next round from the first not defeated.
   */
  made.nextTurn = async () => {
    const skip = made.settings?.skipDefeated === true
    const turns = made.turns
    const from = made.turn ?? -1
    let next = null
    for (const [index, cb] of turns.entries()) {
      if ((index > from) && !(skip && cb.isDefeated)) { next = index; break }
    }
    const newRound = (made.round === 0) || (next === null)
    const update = newRound
      ? { round: made.round + 1, turn: Math.max(turns.findIndex(cb => !(skip && cb.isDefeated)), 0) }
      : { round: made.round, turn: next }
    const options = { direction: 1, worldTime: { delta: newRound ? 6 : 0 } }
    await Hooks.callAll(newRound ? 'combatRound' : 'combatTurn', made, update, options)
    if (made.refuseNext) {
      made.refuseNext = false
      return made
    }
    made.advances++
    await moveTo(update, options)
    return made
  }
  /** The Gamemaster's own Next Turn, made on another client: the write and its hooks here. */
  made.setTurn = (round, turn) => moveTo({ round, turn }, { direction: 1 })
  /** Core's Combat#update of its round and turn: the write and its hooks, never combatTurn or combatRound. */
  made.update = async (data, options = {}) => {
    await moveTo({ round: data.round ?? made.round, turn: data.turn ?? made.turn }, options)
    return made
  }
  return made
}

/** Read a nested value, as core's getProperty. */
export const read = (object, path) => getProperty(object, path)
