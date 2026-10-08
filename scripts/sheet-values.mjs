/**
 * Small helpers for describing a sheet as plain JSON: dnd5e's data holds Sets, Infinity and
 * documents, which JSON.stringify would turn into {}, null or worse.
 */

/**
 * A number, or null for anything else, Infinity and NaN included.
 * @param {unknown} value
 * @returns {number|null}
 */
export function finite(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * A translation, or "" if there is no key.
 * @param {string|undefined} key
 * @returns {string}
 */
export function localize(key) {
  return key ? game.i18n.localize(key) : "";
}

/**
 * The translation of the first key the game knows, for labels whose key moved between dnd5e
 * versions.
 * @param {...string} keys
 * @returns {string}
 */
export function localizeFirst(...keys) {
  const key = keys.find(k => game.i18n.has?.(k));
  return localize(key ?? keys.at(-1));
}

/**
 * Whether a roll is made with advantage (1), disadvantage (-1) or neither (0), combining several
 * sources the way dnd5e does: any advantage and any disadvantage cancel out.
 * @param {Actor} actor
 * @param {string[]} keyPaths   Paths to each source's roll mode in the actor's system data.
 * @returns {number}
 */
export function combinedMode(actor, keyPaths) {
  const field = globalThis.dnd5e?.dataModels?.fields?.AdvantageModeField;
  if ( field?.combineFields ) return rollMode(field.combineFields(actor.system, keyPaths)?.mode);
  const modes = keyPaths.map(path => rollMode(foundry.utils.getProperty(actor.system, path)));
  return Math.sign(modes.reduce((sum, mode) => sum + mode, 0));
}

/**
 * @param {unknown} mode
 * @returns {number}  -1, 0 or 1.
 */
export function rollMode(mode) {
  return [-1, 0, 1].includes(mode) ? mode : 0;
}

/**
 * Limited uses, of an item or one of its activities, which dnd5e keeps alike.
 * @param {object} [uses]       Such as an item's system.uses.
 * @param {object} [labels]     Its labels, which name a recharge, such as "Recharge [5+]".
 * @returns {{value: number, max: number, recovery: string|null}|null}
 */
export function limitedUses(uses, labels) {
  const max = finite(uses?.max);
  if ( !max ) return null;
  const value = finite(uses.value) ?? Math.max(max - (finite(uses.spent) ?? 0), 0);
  const periods = (uses.recovery ?? []).map(recovery => {
    if ( recovery.period === "recharge" ) return labels?.recharge ?? null;
    return localize(CONFIG.DND5E?.limitedUsePeriods?.[recovery.period]?.label) || null;
  }).filter(Boolean);
  return { value, max, recovery: periods.length ? listFormat(periods) : null };
}

/**
 * Join words as a list in the game's language, such as "Short Rest, Long Rest".
 * @param {string[]} words
 * @returns {string}
 */
function listFormat(words) {
  try {
    return new Intl.ListFormat(game.i18n.lang, { style: "narrow" }).format(words);
  } catch {
    return words.join(", ");
  }
}
