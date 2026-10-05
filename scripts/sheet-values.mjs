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
