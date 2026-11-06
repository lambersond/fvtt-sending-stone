// dnd5e's own handling of a change of hit points, for the harnesses (module 0.44.0): ported from
// dnd5e 5.3.3's AttributesFields.preUpdateHP and onUpdateHP (module/data/actor/templates/
// attributes.mjs:514-567) and, with `generation: 6`, dnd5e 6.0.5's (attributes.mjs:664-703), whose
// onUpdateHP also runs Actor5e#updateDowned (module/documents/actor/actor.mjs:3649-3680) and
// applyFallProne, which does nothing without `options.dnd5e.fall` (rules/falling.mjs:80-81) and so
// isn't ported. Around the actor's own update, as Foundry runs them: `preUpdateActor`, which may stop
// the write, and dnd5e's _preUpdate, then the write, then dnd5e's _onUpdate and `updateActor`; for a
// token's creature (`coreHooks: false`), whose own update fires its delta's hooks, only dnd5e's. What
// it does is noted in `hpLog`: the floating numbers over the token (`_displayTokenEffect`), each
// concentration challenged with its DC, and each condition updateDowned would apply or remove, kept
// on the actor's `downed` Set rather than made as an effect. Bloodied isn't ported. Import it after
// stub.mjs.

/** What dnd5e did around each change of hit points, in order. */
export const hpLog = { shown: [], challenged: [], downed: [], undowned: [] }

/**
 * dnd5e's getConcentrationDC (actor.mjs:471-475): half the damage, at least 10, and under the modern
 * rules at most 30.
 * @param {number} damage
 * @returns {number}
 */
const concentrationDC = damage => Math.min(Math.max(Math.floor(damage / 2), 10),
  (globalThis.dnd5e?.settings?.rulesVersion === 'modern') ? 30 : Infinity)

/**
 * Give an actor dnd5e's handling of its hit points around its own update.
 * @param {object} actor
 * @param {object} [options]
 * @param {5|6} [options.generation]     dnd5e's, 5.3.3's or 6.0.5's.
 * @param {boolean} [options.coreHooks]  Fire core's `preUpdateActor` and `updateActor` around it, as
 *                                       for a world actor whose own update fires none.
 * @returns {object}   The actor.
 */
export function withHitPoints(actor, { generation = 5, coreHooks = true } = {}) {
  const own = actor.update.bind(actor)
  actor.downed ??= new Set()
  actor.update = async (changes = {}, options = {}) => {
    const userId = game.user?.id
    const expanded = foundry.utils.expandObject(changes)
    if (coreHooks && (Hooks.call('preUpdateActor', actor, expanded, options, userId) === false)) return undefined
    const flatChanges = { ...changes }
    preUpdateHP(actor, flatChanges, expanded, options)
    await own(flatChanges, options)
    if (expanded.system?.attributes?.hp) await onUpdateHP(actor, expanded, options, userId, generation)
    if (coreHooks) await Hooks.callAll('updateActor', actor, expanded, options, userId)
    return actor
  }
  return actor
}

/**
 * attributes.mjs:514-521: death saves reset where a character at 0 comes above it, and the hit points
 * as they were kept on the options.
 */
function preUpdateHP(actor, flatChanges, expanded, options) {
  const hp = actor.system.attributes.hp
  if ( (hp.value <= 0) && (expanded.system?.attributes?.hp?.value > 0) ) {
    flatChanges['system.attributes.death.success'] = 0
    flatChanges['system.attributes.death.failure'] = 0
  }
  foundry.utils.setProperty(options, 'dnd5e.hp', { value: hp.value, temp: hp.temp ?? 0, max: hp.max })
}

/**
 * attributes.mjs:532-567 (5.3.3), 664-703 (6.0.5): on the client that wrote it, dnd5e 6's downed
 * conditions; then, where the total changed, the token's floating numbers, a concentration challenged
 * where it went down and below the maximum or the temporary hit points went down, and dnd5e's damage
 * or healing hook.
 */
async function onUpdateHP(actor, changed, options, userId, generation) {
  if ( (generation >= 6) && (userId === game.user?.id) ) updateDowned(actor)
  const hp = options.dnd5e?.hp
  if ( !hp || options.isRest || options.isAdvancement ) return
  const curr = actor.system.attributes.hp
  const changes = { hp: curr.value - hp.value, temp: (curr.temp ?? 0) - hp.temp }
  changes.total = changes.hp + changes.temp
  if ( !Number.isInteger(changes.total) || (changes.total === 0) ) return
  hpLog.shown.push({ actor: actor.id, uuid: actor.uuid, changes: { ...changes } })
  const effectiveMax = Number.isFinite(curr.effectiveMax) ? curr.effectiveMax : curr.max
  if ( (options.dnd5e?.concentrationCheck !== false) && (userId === game.user?.id) && (changes.total < 0)
    && ((changes.temp < 0) || (curr.value < effectiveMax)) ) {
    const dc = concentrationDC(-changes.total)
    hpLog.challenged.push({ actor: actor.id, uuid: actor.uuid, dc })
    await actor.challengeConcentration?.({ dc })
  }
  await Hooks.callAll(`dnd5e.${(changes.total > 0) ? 'heal' : 'damage'}Actor`, actor, changes, changed, userId)
}

/**
 * actor.mjs:3649-3680: with autoApplyDowned not "none", above 0 its auto conditions removed; at 0, in
 * combat and not already dead, an NPC not important Dead, an important one Unconscious (unless
 * "deadOnly"), a character Unconscious under "all", Dead after three failed death saves.
 */
function updateDowned(actor) {
  const mode = globalThis.dnd5e?.settings?.autoApplyDowned ?? 'none'
  const hp = actor.system.attributes?.hp
  if ( (mode === 'none') || !hp ) return
  if ( hp.value ) {
    for ( const status of actor.downed ) hpLog.undowned.push({ actor: actor.id, uuid: actor.uuid, status })
    actor.downed.clear()
    return
  }
  if ( !actor.inCombat || actor.downed.has('dead') ) return
  const failed = (actor.system.attributes.death?.failure ?? 0) >= 3
  let status = null
  if ( actor.type === 'npc' ) {
    if ( !actor.system.traits?.important ) status = 'dead'
    else if ( mode !== 'deadOnly' ) status = failed ? 'dead' : 'unconscious'
  } else if ( (actor.type === 'character') && (mode === 'all') ) status = failed ? 'dead' : 'unconscious'
  if ( !status || actor.downed.has(status) ) return
  actor.downed.add(status)
  hpLog.downed.push({ actor: actor.id, uuid: actor.uuid, status })
}
