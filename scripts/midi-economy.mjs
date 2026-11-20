import { MODULE_ID } from "./constants.mjs";

/**
 * Midi-QOL's action economy as the module reads and marks it, since 0.41.0 (round 0.41.0 §1.3):
 * whether Midi enforces a Bonus Action or reaction and one is used, marking one used, and since
 * 0.53.0 which encounter a creature fights in, which a use at its user reads too, and taking off at
 * the creature's next turn a mark the module wrote in an encounter the Gamemaster didn't have up. A
 * leaf but for `constants.mjs`, so that the uses, Wild Shape and damage on its own share it. Midi
 * keeps a Bonus Action or reaction used as a marker effect on the actor it was used by, which ends at
 * that actor's next turn; Midi itself refuses one used again only where its Enforce setting is "all"
 * or the actor's type, and marks one under those and "displayOnly".
 */

/**
 * Since 0.53.0, the marks the module wrote on creatures fighting in an encounter the Gamemaster
 * didn't have up as it marked them, which nothing may take off there (dnd5e 6 ends Midi's markers by
 * the encounter they began in, read from the one up): by actor uuid, the actor, its encounter and
 * combatant, and which it marked. On the client that marked them; gone on a reload.
 * @type {Map<string, {actor: Actor, combatId: string, combatantId: string, bonus: boolean, reaction: boolean}>}
 */
const unseenMarks = new Map();

/**
 * Does Midi-QOL make the uses of items' activities here: its activities in place of dnd5e's, each
 * use of one a workflow? Here since 0.41.0, from command-uses.mjs, which re-exports it.
 * @returns {boolean}
 */
export function midiActivities() {
  if ( game.modules.get("midi-qol")?.active !== true ) return false;
  try {
    return game.settings.get("midi-qol", "ReplaceDefaultActivities") !== false;
  } catch {
    return true;
  }
}

/**
 * The encounter a creature fights in, and its combatant there, since 0.53.0: the one the Gamemaster
 * has up, where Foundry's `Actor#inCombat` finds it there, as Midi-QOL reads it, its combatant as
 * core matches it (`getCombatantsByActor`), as Midi reads a turn; else the first, in Foundry's order,
 * that has begun and is its scene's chosen one (`started` and `active`), whichever scene, as an
 * initiative is rolled into one since 0.51.0. A token's creature by its token and scene; any other
 * by the actor its combatant stored or reads now. One elsewhere not begun counts for nothing: the
 * app can't tell which of two the Gamemaster means.
 * @param {Actor|null|undefined} actor
 * @returns {{combat: Combat, combatant: Combatant|null}|null}
 */
export function fightOf(actor) {
  if ( !actor ) return null;
  const token = actor.isToken ? actor.token : null;
  const stands = combatant => (token
    ? (combatant.tokenId === token.id) && (combatant.sceneId === token.parent?.id)
    : (combatant.actorId === actor.id) || (combatant.actor?.id === actor.id));
  const up = game.combat ?? null;
  if ( up && actor.inCombat ) {
    return { combat: up, combatant: up.getCombatantsByActor?.(actor)?.[0] ?? up.combatants?.find?.(stands) ?? null };
  }
  for ( const combat of game.combats?.values?.() ?? [] ) {
    if ( !combat.started || !combat.active ) continue;
    const combatant = combat.combatants?.find?.(stands);
    if ( combatant ) return { combat, combatant };
  }
  return null;
}

/**
 * Does Midi-QOL enforce this kind of action for this actor: "all", or the actor's type?
 * @param {"enforceBonusActions"|"enforceReactions"} setting
 * @param {Actor} actor
 * @returns {boolean}
 */
export function midiEnforces(setting, actor) {
  const value = globalThis.MidiQOL?.configSettings?.()?.[setting];
  return (value === "all") || (value === actor?.type);
}

/**
 * Does Midi-QOL refuse this actor a Bonus Action now: enforced for its type, and one used?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function midiBonusActionUsed(actor) {
  return midiEnforces("enforceBonusActions", actor) && (globalThis.MidiQOL?.hasUsedBonusAction?.(actor) === true);
}

/**
 * Does Midi-QOL refuse this actor a reaction now: enforced for its type, and one used?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function midiReactionUsed(actor) {
  return midiEnforces("enforceReactions", actor) && (globalThis.MidiQOL?.hasUsedReaction?.(actor) === true);
}

/**
 * Tell Midi-QOL a Bonus Action was used, as its own use does: once, and only under the settings Midi
 * marks under, which its own `setBonusActionUsed` checks. Since 0.53.0, given the encounter the
 * creature fights in (`fightOf`), one the Gamemaster doesn't have up, the mark is taken off at its
 * next turn there (`registerMidiMarkHooks`).
 * @param {Actor} actor
 * @param {{combat: Combat, combatant: Combatant|null}|null} [fight]
 * @returns {Promise<void>}
 */
export async function markMidiBonusAction(actor, fight = null) {
  const MidiQOL = globalThis.MidiQOL;
  if ( (typeof MidiQOL?.setBonusActionUsed !== "function") || (MidiQOL.hasUsedBonusAction?.(actor) === true) ) return;
  const before = midiUsedCount(actor, "bonus");
  await MidiQOL.setBonusActionUsed(actor);
  noteUnseenMark(actor, fight, "bonus", before);
}

/**
 * Tell Midi-QOL a reaction was used, likewise.
 * @param {Actor} actor
 * @param {{combat: Combat, combatant: Combatant|null}|null} [fight]
 * @returns {Promise<void>}
 */
export async function markMidiReaction(actor, fight = null) {
  const MidiQOL = globalThis.MidiQOL;
  if ( (typeof MidiQOL?.setReactionUsed !== "function") || (MidiQOL.hasUsedReaction?.(actor) === true) ) return;
  const before = midiUsedCount(actor, "reaction");
  await MidiQOL.setReactionUsed(actor);
  noteUnseenMark(actor, fight, "reaction", before);
}

/**
 * How many Bonus Actions or reactions Midi-QOL counts this actor as having used, since 0.53.0: the
 * count its marker writes (`flags.midi-qol.actions`), which its own `hasUsedBonusAction` and
 * `hasUsedReaction` read against the most it allows the actor a round; 0 where it writes none.
 * @param {Actor} actor
 * @param {"bonus"|"reaction"} kind
 * @returns {number}
 */
function midiUsedCount(actor, kind) {
  const actions = actor?.flags?.["midi-qol"]?.actions;
  const count = Number((kind === "bonus") ? actions?.bonusActionsUsed : actions?.reactionsUsed);
  return Number.isFinite(count) ? count : 0;
}

/**
 * Note, since 0.53.0, a mark just written on a creature fighting in an encounter the Gamemaster
 * doesn't have up, for its take-off at the creature's next turn there: only where it has a combatant
 * there and Midi wrote the mark, as it doesn't under a setting it never marks under: Midi now reads
 * the action used, or counts one more used than before, as for a creature it allows more than one a
 * round. The latest encounter wins; a second mark in the same one joins the first.
 * @param {Actor} actor
 * @param {{combat: Combat, combatant: Combatant|null}|null} fight
 * @param {"bonus"|"reaction"} kind
 * @param {number} before   Midi's count of that kind used before the mark (`midiUsedCount`).
 * @returns {void}
 */
function noteUnseenMark(actor, fight, kind, before) {
  if ( !fight?.combatant || (fight.combat === game.combat) ) return;
  const MidiQOL = globalThis.MidiQOL;
  const used = (kind === "bonus") ? MidiQOL?.hasUsedBonusAction?.(actor) : MidiQOL?.hasUsedReaction?.(actor);
  if ( (used !== true) && !(midiUsedCount(actor, kind) > before) ) return;
  const entry = unseenMarks.get(actor.uuid);
  const same = (entry?.combatId === fight.combat.id) && (entry?.combatantId === fight.combatant.id);
  unseenMarks.set(actor.uuid, {
    actor,
    combatId: fight.combat.id,
    combatantId: fight.combatant.id,
    bonus: (kind === "bonus") || (same && entry.bonus),
    reaction: (kind === "reaction") || (same && entry.reaction)
  });
}

/**
 * The creature a noted mark is on, if it's still there, since 0.53.0: a world actor the world still
 * holds, a token's creature whose token is still on its scene; else null.
 * @param {Actor} actor
 * @returns {Actor|null}
 */
function stillThere(actor) {
  if ( !actor.isToken ) return game.actors?.get?.(actor.id) ?? null;
  const token = actor.token;
  const kept = token?.parent?.tokens?.get?.(token.id);
  return kept ? (kept.actor ?? actor) : null;
}

/**
 * As a turn begins in an encounter, since 0.53.0, take off the marks the module wrote there on the
 * creature whose turn it is, each once, forced, as Midi's own `removeBonusActionUsed` and
 * `removeReactionUsed` take one off: never as a combatant is added mid-turn, which changes no turn.
 * One whose creature is gone is forgotten.
 * @param {Combat} combat
 * @param {{round: number, combatantId: string|null}} prior     The turn before, as core gives it.
 * @param {{round: number, combatantId: string|null}} current   The turn now.
 * @returns {Promise<void>}
 */
async function takeOffUnseenMarks(combat, prior, current) {
  const begun = current?.combatantId ?? null;
  if ( !begun || ((prior?.combatantId === begun) && (prior?.round === current.round)) ) return;
  for ( const [uuid, entry] of unseenMarks ) {
    if ( (entry.combatId !== combat?.id) || (entry.combatantId !== begun) ) continue;
    unseenMarks.delete(uuid);
    const actor = stillThere(entry.actor);
    if ( !actor ) continue;
    try {
      if ( entry.bonus ) await globalThis.MidiQOL?.removeBonusActionUsed?.(actor, true);
      if ( entry.reaction ) await globalThis.MidiQOL?.removeReactionUsed?.(actor, true);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not take Midi-QOL's marks off ${actor.name}`, err);
    }
  }
}

/**
 * Forget, since 0.53.0, the marks noted in an encounter deleted: Midi's own sweep of a deleted
 * encounter ends its markers that last until the encounter ends.
 * @param {Combat} combat
 * @returns {void}
 */
function forgetUnseenMarks(combat) {
  for ( const [uuid, entry] of unseenMarks ) {
    if ( entry.combatId === combat?.id ) unseenMarks.delete(uuid);
  }
}

/**
 * Take off, since 0.53.0, at that creature's next turn there, a mark the module wrote on a creature
 * fighting in an encounter the Gamemaster didn't have up: Midi-QOL and dnd5e read only the encounter
 * up, and may never end such a mark at that creature's turn. Called from `init`.
 * @returns {void}
 */
export function registerMidiMarkHooks() {
  Hooks.on("combatTurnChange", takeOffUnseenMarks);
  Hooks.on("deleteCombat", forgetUnseenMarks);
}
