import { formulaRoll } from "./dice-plan.mjs";
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

/** The activations Midi-QOL counts as using a reaction, besides dnd5e's own. */
export const REACTIONS = new Set(["reaction", "reactiondamage", "reactionmanual", "reactionpreattack"]);

/** The kinds of action the Actions tab has a section for, in Tidy 5e's order. */
export const ACTION_KINDS = ["action", "bonus", "reaction", "legendary", "mythic", "lair", "crew", "special"];

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
 * with its modes and ammunition, and its area, if any, or else the activity it's used through, such
 * as a save or healing; the saving throw it calls for; its damage or healing; and a utility's own
 * roll, if it has one. An item with more than one activity lists each, as `describeActivity`
 * describes it, with its id, name and kind. An item not identified yet keeps them all to itself.
 *
 * An action lists only some of an item's activities, those activated as its section of the
 * Actions tab has it, and rolls as the first of them; it lists them even when there's one, where
 * the item is listed in other sections too, so that the item can be put together again.
 * @param {Item} item
 * @param {Activity[]} [activities]   Those to list; all its player can see, by default.
 * @param {object} [options]
 * @param {boolean} [options.list]    List them even when there's only one.
 * @returns {{toHit: number|null, attackId: string|null, activity: object|null,
 *   attackModes: object[]|null, ammunition: object[]|null, save: object|null, damage: object[],
 *   attackArea?: object, rollFormula?: object, consumesSlot?: false, cast?: object, activities?: object[]}}
 */
export function rollsOf(item, activities=visibleActivities(item), { list=false }={}) {
  if ( item.system?.identified === false ) return { ...NO_ROLLS, damage: [] };
  return {
    ...activityRolls(item, activities[0]),
    ...(((activities.length > 1) || (list && activities.length))
      && { activities: activities.map(activity => activityEntry(item, activity)) })
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
  const rolls = identified ? activityRolls(item, activity) : { ...NO_ROLLS, damage: [] };
  return {
    activation: activity.labels?.activation || null,
    activationType: activationTypeOf(activity),
    range: rangeOf(item, activity),
    target: activity.labels?.target || null,
    ...rolls,
    uses: identified ? activityUses(item, activity) : null
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
 * its weapon's attack modes and ammunition, and whom it's made at, for one at an area; or else the
 * activity itself, such as a save or healing; the saving throw it calls for; its damage or
 * healing; and a utility's own roll, such as a d4 of luck. A spell's activity that spends no spell
 * slot, as one used after the spell is cast does, such as Hex's Bonus Hex Damage, says so.
 * @param {Item} item
 * @param {Activity} [activity]
 * @returns {object}
 */
function activityRolls(item, activity) {
  if ( !activity ) return { ...NO_ROLLS, damage: [] };
  if ( activity.type === "cast" ) return castRolls(item, activity);
  const attack = activity.type === "attack";
  const area = attack ? attackAreaOf(item, activity) : null;
  const roll = formulaRoll(activity);
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
    ...(area && { attackArea: area }),
    // With the character's numbers in it, so the app can roll its dice and have it made here.
    ...(roll && { rollFormula: { formula: roll.formula, name: activity.roll.name || null } }),
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
    name: activityName(activity),
    type: activity.type,
    ...describeActivity(item, activity)
  };
}

/**
 * An activity's name, such as "Bonus Hex Damage", or else its kind's, such as "Attack". A Cast
 * activity is named for its spell.
 * @param {Activity} activity
 * @returns {string}
 */
export function activityName(activity) {
  return activity.name || localize(activity.metadata?.title) || activity.type;
}

/**
 * The kind of action an activity is activated with, such as "action", "bonus" or "reaction", as the
 * Actions tab heads its sections, where it takes just one of them; null for any other, such as two
 * actions, a Legendary Action that costs two, or a minute. Midi-QOL's kinds of reaction are
 * reactions.
 * @param {Activity} [activity]
 * @returns {string|null}
 */
export function activationTypeOf(activity) {
  const { type, value } = activity?.activation ?? {};
  const kind = REACTIONS.has(type) ? "reaction" : type;
  if ( !ACTION_KINDS.includes(kind) ) return null;
  return ([undefined, null, ""].includes(value) || (Number(value) === 1)) ? kind : null;
}

/**
 * Are an item's own labels, such as its activation and range, this activity's? dnd5e gives an
 * item the labels of its first activity with an activation that can be used, and a spell has its
 * own, its first activity's.
 * @param {Item} item
 * @param {Activity} [activity]
 * @returns {boolean}
 */
export function ownLabels(item, activity) {
  if ( !activity ) return true;
  if ( item.type === "spell" ) return activity.id === visibleActivities(item)[0]?.id;
  const labelled = Array.from(item.system?.activities ?? [])
    .find(other => other.activation?.type && (other.canUse !== false));
  return activity.id === labelled?.id;
}

/**
 * An activity's uses, or for a Cast activity, those casting its spell spends, such as the item's
 * charges, as dnd5e's sheet shows them by the spell.
 * @param {Item} item
 * @param {Activity} [activity]
 * @returns {{value: number, max: number, recovery: string|null}|null}
 */
export function activityUses(item, activity) {
  if ( !activity ) return null;
  return ((activity.type === "cast") && castCost(item, activity)?.uses) || limitedUses(activity.uses, activity.labels);
}

/* -------------------------------------------- */

/**
 * The spell a Cast activity casts, as dnd5e keeps a copy of it on the actor, and the activity of
 * that spell casting it from the item uses: the spell's first its player can see, as dnd5e would
 * use it. Nothing while the item can't cast it, such as one that needs attuning and isn't, or
 * dnd5e hasn't made the spell's copy yet.
 * @param {Activity} cast
 * @returns {{spell: Item, lead: Activity}|null}
 */
export function castSpellOf(cast) {
  if ( (cast?.type !== "cast") || !cast.canUse ) return null;
  const spell = cast.cachedSpell;
  const [lead] = spell ? visibleActivities(spell) : [];
  return lead ? { spell, lead } : null;
}

/**
 * What a Cast activity rolls, or is used through: its spell's, as the spell's own activity has
 * them, but by the Cast activity's id, through which the app has it cast from the item; and how
 * it's cast: the level it's cast at, whether it takes concentration, and how many of the item's
 * uses it spends, and whether there are that many left.
 * @param {Item} item
 * @param {Activity} cast
 * @returns {object}
 */
function castRolls(item, cast) {
  const found = castSpellOf(cast);
  if ( !found ) return { ...NO_ROLLS, damage: [] };
  const { spell, lead } = found;
  // Cast from the item, a spell's activity spends no slot; there's no level to choose.
  const { consumesSlot, ...rolls } = activityRolls(spell, lead);
  if ( !rollsAnything(rolls) ) return { ...NO_ROLLS, damage: [] };
  const cost = castCost(item, cast);
  return {
    ...rolls,
    attackId: rolls.attackId && cast.id,
    activity: rolls.activity && { ...rolls.activity, id: cast.id, targets: { ...rolls.activity.targets, perLevel: null } },
    ...(rolls.attackArea && { attackArea: { ...rolls.attackArea, perLevel: null } }),
    cast: {
      level: Math.max(finite(spell.system?.level) ?? 0, finite(cast.spell?.level) ?? 0),
      concentration: (spell.system?.properties?.has?.("concentration") ?? false)
        || (lead.duration?.concentration === true),
      charges: cost?.amount ?? null,
      short: cost?.short ?? false
    }
  };
}

/**
 * What casting a spell from an item spends, as its Cast activity has it: so many of the item's
 * uses, or another item's, or the activity's own; the first of them, and those uses, and whether
 * any of them hasn't that many left. A spell cast above its own level spends more, where its cost
 * scales with the level, as dnd5e scales it. Nothing where it spends no uses, only a number that's a
 * formula, or where its spell's activity spends nothing, as one used after the spell is cast does,
 * for which dnd5e spends nothing of the item's either.
 * @param {Item} item
 * @param {Activity} cast
 * @returns {{amount: number, uses: {value: number, max: number, recovery: string|null},
 *   short: boolean}|null}
 */
export function castCost(item, cast) {
  const found = castSpellOf(cast);
  if ( !found || (found.lead.consumption?.spellSlot === false) ) return null;
  const base = finite(found.spell.system?.level) ?? 0;
  // dnd5e casts a leveled spell from the item at its Cast activity's level, and scales its cost by
  // how far above the spell's own that is.
  const above = (base > 0) ? Math.max((finite(cast.spell?.level) ?? base) - base, 0) : 0;
  const costs = (cast.consumption?.targets ?? []).flatMap(target => {
    const uses = (target.type === "itemUses") ? usesOfItem(item, target.target)
      : (target.type === "activityUses") ? limitedUses(cast.uses, cast.labels) : undefined;
    if ( uses === undefined ) return [];
    const amount = scaledCost(target, above);
    return ((amount !== null) && (amount > 0) && uses) ? [{ amount, uses }] : [];
  });
  if ( !costs.length ) return null;
  return { ...costs[0], short: costs.some(({ amount, uses }) => uses.value < amount) };
}

/**
 * The uses of an item a Cast activity spends: its own, or the other item it names.
 * @param {Item} item
 * @param {string} [id]
 * @returns {{value: number, max: number, recovery: string|null}|null}
 */
function usesOfItem(item, id) {
  const source = id ? item.actor?.items?.get(id) : item;
  return limitedUses(source?.system?.uses, source?.labels);
}

/**
 * How much a consumption target spends, as a whole number, its scaling by amount for a spell cast
 * that many levels higher added, as dnd5e's resolveCost adds it; null for a formula.
 * @param {object} target
 * @param {number} above
 * @returns {number|null}
 */
function scaledCost(target, above) {
  const amount = Number(target.value);
  if ( !Number.isInteger(amount) ) return null;
  if ( !above || (target.scaling?.mode !== "amount") ) return amount;
  const formula = target.scaling.formula;
  if ( !formula ) return amount + ((amount > 0) ? above : 0);
  const step = Number(formula);
  return Number.isInteger(step) ? amount + (step * above) : null;
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
 * Whom an attack at an area, such as a breath weapon's cone, is made at, as a use's targets are
 * told: as many as it takes, or any number, and more for each level a spell is cast above its own.
 * Null for an attack at one target.
 * @param {Item} item
 * @param {Activity} activity
 * @returns {{count: number|null, perLevel: number|null, affects: string|null}|null}
 */
function attackAreaOf(item, activity) {
  if ( !activity.target?.template?.type ) return null;
  const { count, perLevel, affects } = describeUse(item, activity).targets;
  return { count, perLevel, affects };
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
  // dnd5e gives the item one activity's labels, which aren't another activity's.
  return activity?.labels?.range || (ownLabels(item, activity) && item.labels?.range) || null;
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
