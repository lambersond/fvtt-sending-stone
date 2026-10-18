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
 * The old-style resources a sheet's counter may name.
 * @type {string[]}
 */
export const RESOURCES = ["primary", "secondary", "tertiary"];

/**
 * Limited uses as the sheet sends them, since module 0.29.0 saying which counter they are,
 * `counter`: an item's own uses, `{item}`, one of its activities', `{item, activity}`, or an
 * old-style resource, `{resource}`; and whether a player may spend them directly from the app,
 * `spendable`, as `spendsDirectly` has it for an item's or an activity's, and always for a
 * resource's. Given no counter, as for what a Cast or forward spends of another, they're sent as
 * they are. Built here alone, so that an action and its row say the same.
 * @param {{value: number, max: number, recovery: string|null}|null} uses   As `limitedUses` has them.
 * @param {object} [of]
 * @param {Item} [of.item]           Whose uses they are, or whose activity's.
 * @param {Activity} [of.activity]   Whose they are, of the item's.
 * @param {string} [of.resource]     Which resource's they are.
 * @returns {object|null}
 */
export function countedUses(uses, { item, activity, resource }={}) {
  if ( !uses ) return null;
  if ( RESOURCES.includes(resource) ) return { ...uses, counter: { resource }, spendable: true };
  if ( !item?.id ) return uses;
  const counter = activity?.id ? { item: item.id, activity: activity.id } : { item: item.id };
  return { ...uses, counter, ...(spendsDirectly(item) && { spendable: true }) };
}

/**
 * May a player spend an item's uses, or one of its activities', directly from the app, as dnd5e's
 * sheet lets them be changed? Not one not identified yet, which keeps them to itself; nor a spell's,
 * which casting it spends; nor those of an item used up as they run out, such as a potion or a
 * scroll, which only using it should spend, so that dnd5e takes it away.
 * @param {Item} item
 * @returns {boolean}
 */
export function spendsDirectly(item) {
  return (item?.system?.identified !== false) && (item?.type !== "spell") && (item?.system?.uses?.autoDestroy !== true);
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
