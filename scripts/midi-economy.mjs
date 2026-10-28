/**
 * Midi-QOL's action economy as the module reads and marks it, since 0.41.0 (round 0.41.0 §1.3): a
 * leaf, importing nothing, so that the uses, Wild Shape and damage on its own share it. Midi keeps a
 * Bonus Action or reaction used as a marker effect on the actor it was used by, which ends at that
 * actor's next turn; Midi itself refuses one used again only where its Enforce setting is "all" or the
 * actor's type, and marks one under those and "displayOnly".
 */

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
 * marks under, which its own `setBonusActionUsed` checks.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function markMidiBonusAction(actor) {
  const MidiQOL = globalThis.MidiQOL;
  if ( (typeof MidiQOL?.setBonusActionUsed !== "function") || (MidiQOL.hasUsedBonusAction?.(actor) === true) ) return;
  await MidiQOL.setBonusActionUsed(actor);
}

/**
 * Tell Midi-QOL a reaction was used, likewise.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function markMidiReaction(actor) {
  const MidiQOL = globalThis.MidiQOL;
  if ( (typeof MidiQOL?.setReactionUsed !== "function") || (MidiQOL.hasUsedReaction?.(actor) === true) ) return;
  await MidiQOL.setReactionUsed(actor);
}
