import { finite, limitedUses, localize } from "./sheet-values.mjs";

/**
 * What an item rolls, or is used through, as the sheet tells the app: its bonus to hit and the
 * attack it's for, the saving throw it calls for, its damage or healing, and the activity it's
 * otherwise used through. Actions carry them, and so do the spells, features and inventory items
 * that have any, so that the app can roll them, or have them made in the game, from any tab.
 *
 * An item's own are its first activity's, in dnd5e's order: for a spell, how it's cast. An item
 * with more than one activity, such as Hex, with its Bonus Hex Damage, or a weapon that also
 * grapples, lists each of them besides, so that the app can roll or use each.
 */

/** The kinds of activity a player can use from the app other than an attack. */
export const USES = new Set(["save", "damage", "heal", "utility"]);

/* -------------------------------------------- */

/**
 * An item's activities that its player can see and use, in their order. dnd5e 6 hides those that
 * don't apply; dnd5e 5 says they can't be used.
 * @param {Item} item
 * @returns {Activity[]}
 */
export function visibleActivities(item) {
  return Array.from(item.system?.activities ?? []).filter(activity => ("isHidden" in activity)
    ? !activity.isHidden
    : (activity.canUse !== false));
}

/** What an activity rolls, when it rolls nothing, or isn't to be told. */
const NO_ROLLS = Object.freeze({
  toHit: null, attackId: null, activity: null, attackModes: null, ammunition: null, save: null, damage: []
});

/**
 * What an item rolls, as its first activity does: an attack's bonus to hit and the attack's id,
 * with its modes and ammunition, or else the activity it's used through, such as a save or
 * healing; the saving throw it calls for; and its damage or healing. An item with more than one
 * activity lists each, as `describeActivity` describes it, with its id, name and kind. An item not
 * identified yet keeps them all to itself.
 * @param {Item} item
 * @returns {{toHit: number|null, attackId: string|null, activity: object|null,
 *   attackModes: object[]|null, ammunition: object[]|null, save: object|null, damage: object[],
 *   consumesSlot?: false, activities?: object[]}}
 */
export function rollsOf(item) {
  if ( item.system?.identified === false ) return { ...NO_ROLLS, damage: [] };
  const activities = visibleActivities(item);
  return {
    ...activityRolls(item, activities[0]),
    ...((activities.length > 1) && { activities: activities.map(activity => activityEntry(item, activity)) })
  };
}

/**
 * What a spell, feature or inventory item rolls, where it, or any of its activities, rolls or is
 * used through anything; the app takes one with none as nothing to roll.
 * @param {Item} item
 * @returns {object|null}   As `rollsOf`, or null.
 */
export function rollsIfAny(item) {
  const rolls = rollsOf(item);
  return (rollsAnything(rolls) || rolls.activities?.some(rollsAnything)) ? rolls : null;
}

/**
 * One of an item's activities on its own, as a player made it a favorite, and as an item with more
 * than one lists each: how it's activated, its range and target, its bonus to hit, the saving
 * throw it calls for, its damage or healing, and its uses. An item not identified yet keeps them
 * to itself.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {object}
 */
export function describeActivity(item, activity) {
  const identified = item.system?.identified !== false;
  return {
    activation: activity.labels?.activation || null,
    range: rangeOf(item, activity),
    target: activity.labels?.target || null,
    ...(identified ? activityRolls(item, activity) : { ...NO_ROLLS, damage: [] }),
    uses: identified ? limitedUses(activity.uses, activity.labels) : null
  };
}

/**
 * How an item is used, as an action's is: its activation, range and target, as its first activity
 * labels them, and whether it takes concentration.
 * @param {Item} item
 * @returns {{activation: string|null, range: string|null, target: string|null, concentration: boolean}}
 */
export function usageOf(item) {
  const [first] = visibleActivities(item);
  return {
    activation: first?.labels?.activation || item.labels?.activation || null,
    range: rangeOf(item, first),
    target: first?.labels?.target || item.labels?.target || null,
    concentration: (item.system?.properties?.has?.("concentration") ?? false)
      || (first?.duration?.concentration === true)
  };
}

/* -------------------------------------------- */

/**
 * What an activity rolls, or is used through: an attack's bonus to hit, by the attack's id, with
 * its weapon's attack modes and ammunition; or else the activity itself, such as a save or
 * healing; the saving throw it calls for; and its damage or healing. A spell's activity that
 * spends no spell slot, as one used after the spell is cast does, such as Hex's Bonus Hex Damage,
 * says so.
 * @param {Item} item
 * @param {Activity} [activity]
 * @returns {object}
 */
function activityRolls(item, activity) {
  if ( !activity ) return { ...NO_ROLLS, damage: [] };
  const attack = activity.type === "attack";
  return {
    toHit: attack ? toHitOf(activity) : null,
    // The attack the bonus is for, so the app can have it made here.
    attackId: attack ? activity.id : null,
    // What else it's used through, such as a save or healing, so the app can have it used here.
    activity: USES.has(activity.type) ? describeUse(item, activity) : null,
    attackModes: attack ? attackModesOf(item) : null,
    ammunition: attack ? ammunitionOf(item) : null,
    save: saveOf(activity),
    damage: damageOf(activity),
    ...(spendsNoSlot(item, activity) && { consumesSlot: false })
  };
}

/**
 * One of an item's activities, as an item with more than one lists it: its id, its name, such as
 * "Bonus Hex Damage", or else its kind's, such as "Attack", its kind, and what it does.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {object}
 */
function activityEntry(item, activity) {
  return {
    id: activity.id,
    name: activity.name || localize(activity.metadata?.title) || activity.type,
    type: activity.type,
    ...describeActivity(item, activity)
  };
}

/**
 * Does anything roll, or is anything used through, as `activityRolls` tells it?
 * @param {object} rolls
 * @returns {boolean}
 */
function rollsAnything(rolls) {
  return (rolls.toHit !== null) || Boolean(rolls.attackId || rolls.activity || rolls.save || rolls.damage?.length);
}

/**
 * Is this one of a spell's activities that's used without spending a spell slot, as one used after
 * the spell is cast is, such as Spirit Guardians' save each turn? dnd5e still asks the level it's
 * used at, which its damage may scale with.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {boolean}
 */
function spendsNoSlot(item, activity) {
  return (item.type === "spell") && ((finite(item.system?.level) ?? 0) > 0)
    && (activity.consumption?.spellSlot === false);
}

/**
 * An activity a player can use from the app, by its id, with whom it's used at: its user alone, an
 * area, or a number of targets, and of what kind, such as allies or enemies.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {{id: string, type: string, targets: {self: boolean, area: boolean, count: number|null,
 *   perLevel: number|null, affects: string|null}}}
 */
export function describeUse(item, activity) {
  const target = activity.target ?? {};
  const affects = target.affects?.type || null;
  const area = Boolean(target.template?.type);
  const count = finite(target.affects?.count);
  return {
    id: activity.id,
    type: activity.type,
    targets: {
      self: (affects === "self") || (!area && !affects && (activity.range?.units === "self")),
      area,
      count: (count > 0) ? count : null,
      perLevel: (count > 0) ? countPerLevel(item, activity, count) : null,
      affects
    }
  };
}

/**
 * How many more targets a spell takes for each level it's cast above its own, as Bless or Hold
 * Person do: its number of targets is a formula of the spell's scaling. Null for none.
 * @param {Item} item
 * @param {Activity} activity
 * @param {number} count   How many it takes at its own level.
 * @returns {number|null}
 */
function countPerLevel(item, activity, count) {
  if ( (item.type !== "spell") || !((finite(item.system?.level) ?? 0) > 0) ) return null;
  // The formula as typed: the activity's own, or the spell's, which it takes unless it overrides it.
  const typed = activity.target?.override
    ? activity._source?.target?.affects?.count
    : (item.system._source?.target?.affects?.count ?? activity._source?.target?.affects?.count);
  if ( (typeof typed !== "string") || !/[^\d\s.]/.test(typed) ) return null;
  try {
    const scaling = (finite(item.flags?.dnd5e?.scaling) ?? 0) + 1;
    const scaled = item.clone({ "flags.dnd5e.scaling": scaling }, { keepId: true });
    const more = (finite(scaled.system.activities?.get(activity.id)?.target?.affects?.count) ?? count) - count;
    return (more > 0) ? more : null;
  } catch {
    return null;
  }
}

/**
 * The ways a weapon attacks, when there's more than one, such as one- or two-handed, or thrown.
 * @param {Item} item
 * @returns {{value: string, label: string}[]|null}
 */
export function attackModesOf(item) {
  const modes = Array.from(item.system?.attackModes ?? []).filter(mode => mode.value);
  if ( modes.length < 2 ) return null;
  return modes.map(({ value, label }) => ({ value, label: localize(label) || value }));
}

/**
 * The ammunition a weapon fires, with how much of each is left.
 * @param {Item} item
 * @returns {{id: string, name: string, quantity: number}[]|null}
 */
export function ammunitionOf(item) {
  if ( !item.system?.properties?.has?.("amm") ) return null;
  return Array.from(item.system.ammunitionOptions ?? []).map(option => ({
    id: option.value,
    name: option.item?.name ?? option.label,
    quantity: finite(option.item?.system?.quantity) ?? 0
  }));
}

/**
 * Where an item reaches, as dnd5e's sheet puts it: for a weapon, its reach or range, such as
 * "reach 5 ft" or "range 20/60 ft"; otherwise its activity's range, such as "30 ft" or "Self".
 * @param {Item} item
 * @param {Activity} [activity]
 * @returns {string|null}
 */
export function rangeOf(item, activity) {
  try {
    const label = activity?.getRangeLabel?.();
    if ( label ) return label;
  } catch {
    // Fall back on the labels.
  }
  return activity?.labels?.range || item.labels?.range || null;
}

/**
 * An attack's bonus to hit, as a number. Bonuses that are dice, such as +1d4, are left out, as
 * dnd5e's sheets leave them out of the number they show.
 * @param {Activity} [attack]
 * @returns {number|null}
 */
export function toHitOf(attack) {
  const value = Number.parseInt(attack?.labels?.modifier);
  return Number.isFinite(value) ? value : null;
}

/**
 * The saving throw an activity calls for: the ability's abbreviation, or "DC" when the target
 * chooses between several, and the DC.
 * @param {Activity} [activity]
 * @returns {{ability: string, dc: number|null}|null}
 */
export function saveOf(activity) {
  if ( !activity?.save ) return null;
  const abilities = Array.from(activity.save.ability ?? []);
  if ( !abilities.length ) return null;
  const ability = (abilities.length === 1)
    ? (localize(CONFIG.DND5E?.abilities?.[abilities[0]]?.abbreviation) || abilities[0])
    : localize("DND5E.AbbreviationDC");
  return { ability, dc: finite(activity.save.dc?.value) };
}

/**
 * An activity's damage or healing, in parts as dnd5e labels them, each with its formula, such as
 * "1d8 + 4", and its kind.
 * @param {Activity} [activity]
 * @returns {{formula: string, type: string|null, healing: boolean}[]}
 */
export function damageOf(activity) {
  const healingTypes = CONFIG.DND5E?.healingTypes ?? {};
  return Array.from(activity?.labels?.damage ?? []).flatMap(part => {
    const formula = String(part.formula ?? "").trim();
    if ( !formula ) return [];
    let type = localize(CONFIG.DND5E?.damageTypes?.[part.damageType]?.label ?? healingTypes[part.damageType]?.label) || null;
    // A part of several kinds has none of its own; its label names them after the formula.
    if ( !type && part.label?.startsWith(formula) ) type = part.label.slice(formula.length).trim() || null;
    return [{ formula, type, healing: part.damageType in healingTypes }];
  });
}
