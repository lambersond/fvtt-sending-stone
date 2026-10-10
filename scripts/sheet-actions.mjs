import { usesOf } from "./sheet-features.mjs";
import {
  ACTION_KINDS, activationTypeOf, activityName, activityUses, castSpellOf, ownLabels, rangeOf, REACTIONS,
  rollsOf, visibleActivities
} from "./sheet-rolls.mjs";
import { castCopy, castFrom } from "./sheet-spells.mjs";
import { finite, localize } from "./sheet-values.mjs";

/**
 * What a character can do in a fight, listed as Tidy 5e's Actions tab lists it, by default:
 * equipped weapons; equipped equipment and consumables that are used in a fight; spells that can
 * be cast now and deal damage, are cast as a bonus action or reaction, last a minute or a round, or
 * apply effects; and features that are activated. A player who uses Tidy 5e can add an item to
 * the list, take one off it, or give one a section of its own, and that holds here too.
 *
 * An item is listed in each section for how its activities are activated, such as a staff that
 * strikes as an action and casts a spell as a reaction, under Actions and under Reactions; there it
 * carries what dnd5e works out for the first of those activities as it prepares the character: its
 * bonus to hit, the saving throw it calls for, and its damage or healing, ability modifier
 * included; and lists each of them, where there's more than one. An activity used after another,
 * with no activation of its own, such as Hex's Bonus Hex Damage, goes with the item's first. The
 * spells an item casts are cast from the item: the copies dnd5e keeps of them aren't listed.
 */

/** Tidy 5e's flags. */
const TIDY = "tidy5e-sheet";

/** The sections, in Tidy 5e's order. Actions activated any other way go under Other. */
const SECTIONS = ACTION_KINDS;

/** Activations that take too long to be used in a fight. */
const SLOW = ["minute", "hour", "day", "none"];

/**
 * Activations of an activity used along with another, such as damage done when a curse's target is
 * hit, rather than by an action of its own.
 */
const FOLLOWING = ["", "none", "special"];

/* -------------------------------------------- */

/**
 * The character's actions, in sections by how they are activated, each in the player's own order.
 * @param {Actor} actor
 * @param {SheetTexts} texts    Collects the actions' descriptions.
 * @returns {{id: string, label: string, actions: object[]}[]}
 */
export function actionSections(actor, texts) {
  const sections = new Map(SECTIONS.map(id => [id, { id, label: sectionLabel(id), actions: [] }]));
  const items = Array.from(actor.items ?? [])
    // Not the copies of spells items cast, which their items' rows cast.
    .filter(item => (item.isHidden !== true) && !castCopy(item))
    .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name, game.i18n.lang));
  for ( const item of items ) {
    const rows = rowsOf(item);
    for ( const { id, named, activities } of rows ) {
      if ( !sections.has(id) ) sections.set(id, { id, label: named ? localize(id) : sectionLabel(id), actions: [] });
      sections.get(id).actions.push(describeAction(item, texts, activities, { split: rows.length > 1 }));
    }
  }
  return Array.from(sections.values()).filter(section => section.actions.length);
}

/**
 * The rows an item is listed in, each a section and the activities in it, the first of which the
 * row rolls as: one in each section for how its activities are activated, an activity with none
 * of its own going with its first. An item the player gave a section of its own, or one not
 * identified yet, has one row, all of it. An item that Tidy 5e's rules leave off the list has rows
 * only for the spells it casts, which are cast from nowhere else.
 * @param {Item} item
 * @returns {{id: string, named: boolean, activities: Activity[]}[]}
 */
function rowsOf(item) {
  const activities = visibleActivities(item);
  const listed = inActionList(item);
  const custom = tidyFlag(item, "actionSection");
  const named = (typeof custom === "string") ? custom.trim() : "";
  if ( item.system?.identified === false ) {
    return listed ? [{ id: named || sectionOf(activities[0]), named: Boolean(named), activities }] : [];
  }
  if ( listed && !activities.length ) return [{ id: named || sectionOf(), named: Boolean(named), activities }];
  // Tidy 5e's choice to leave it off holds for its spells too.
  const casts = (tidyFlag(item, "action-filter-override") === false) ? []
    : activities.filter(activity => castSpellOf(activity));
  const shown = listed ? activities : casts;
  if ( named ) return shown.length ? [{ id: named, named: true, activities: shown }] : [];
  const rows = new Map();
  for ( const activity of shown ) {
    const own = FOLLOWING.includes(activity.activation?.type ?? "") && (activity !== shown[0]) ? null : sectionOf(activity);
    const id = own ?? sectionOf(shown[0]);
    if ( !rows.has(id) ) rows.set(id, { id, named: false, activities: [] });
    rows.get(id).activities.push(activity);
  }
  return Array.from(rows.values());
}

/**
 * Does Tidy 5e list this item on its Actions tab, by default or as the player chose?
 * @param {Item} item
 * @returns {boolean}
 */
function inActionList(item) {
  const override = tidyFlag(item, "action-filter-override");
  if ( (override !== undefined) && (override !== null) ) return Boolean(override);
  const system = item.system ?? {};
  const first = firstActivity(item);
  switch ( item.type ) {
    case "weapon": return system.equipped === true;
    case "equipment": return (system.equipped === true) && usedInAFight(first);
    case "consumable": return usedInAFight(first);
    case "spell": return spellInList(item, first);
    case "feat": return Boolean(first?.activation?.type);
    default: return false;
  }
}

/**
 * Is a spell one to list: one the character can cast now, that deals damage, is cast as a bonus
 * action or a reaction, lasts a minute or a round, or applies effects? A cantrip can always be
 * cast.
 * @param {Item} spell
 * @param {Activity} [first]    Its first activity.
 * @returns {boolean}
 */
function spellInList(spell, first) {
  const system = spell.system ?? {};
  const cantrip = (finite(system.level) ?? 0) === 0;
  if ( !cantrip && !canCast(spell) ) return false;

  const type = first?.activation?.type;
  if ( (type === "bonus") || (type === "reaction") ) return true;
  if ( dealsDamage(spell) ) return true;
  const duration = system.duration ?? {};
  if ( ["minute", "round"].includes(duration.units) && (Number(duration.value) === 1) ) return true;
  return (spell.effects?.size ?? 0) > 0;
}

/**
 * Can a spell above cantrip level be cast now, by how it's cast: prepared, or always prepared,
 * at will or innately without limit, or with uses left.
 * @param {Item} spell
 * @returns {boolean}
 */
function canCast(spell) {
  const system = spell.system ?? {};
  const methods = CONFIG.DND5E?.spellcasting ?? {};
  const method = (system.method in methods) ? system.method : "innate";
  const limited = (system.hasLimitedUses ?? (finite(system.uses?.max) > 0)) && ((system.uses?.recovery?.length ?? 0) > 0);
  if ( (system.canPrepare ?? false) && [1, 2].includes(system.prepared) ) return true;
  if ( ["atwill", "innate"].includes(method) && !limited ) return true;
  return limited && ((finite(system.uses?.value) ?? 0) > 0);
}

/**
 * Does an item's first attack, or else its first damage or saving throw, deal damage?
 * @param {Item} item
 * @returns {boolean}
 */
function dealsDamage(item) {
  const activities = item.system?.activities;
  const activity = activities?.getByType?.("attack")?.[0]
    ?? activities?.getByType?.("damage")?.[0]
    ?? activities?.getByType?.("save")?.[0];
  return (activity?.damage?.parts?.length ?? 0) > 0;
}

/**
 * Is an activity one used in a fight, rather than over minutes or more?
 * @param {Activity} [activity]
 * @returns {boolean}
 */
function usedInAFight(activity) {
  const type = activity?.activation?.type;
  return Boolean(type) && !SLOW.includes(type);
}

/* -------------------------------------------- */

/**
 * An action: an item as one section of the Actions tab lists it, rolling as the first of the
 * activities it lists there: how that's activated, its range and target, its bonus to hit, the
 * saving throw it calls for, its damage or healing; and the item's uses, and each of those
 * activities, where there's more than one, or where the item is listed in other sections too. One
 * that isn't the item's first activity is named, such as a staff's Silvery Barbs under Reactions.
 * An item not identified yet keeps them to itself.
 * @param {Item} item
 * @param {SheetTexts} texts
 * @param {Activity[]} [activities]   Those it lists; all the item's, by default.
 * @param {object} [options]
 * @param {boolean} [options.split]   Whether the item is listed in other sections too.
 * @returns {object}
 */
function describeAction(item, texts, activities=visibleActivities(item), { split=false }={}) {
  const system = item.system ?? {};
  const identified = system.identified !== false;
  const lead = activities[0];
  const first = visibleActivities(item)[0];
  // dnd5e gives the item one activity's labels, which aren't another activity's.
  const labels = ownLabels(item, lead) ? (item.labels ?? {}) : {};
  // A spell cast from the item opens to the spell's description; under dnd5e 6, an activity to its own.
  const rolls = rollsOf(item, activities, { list: split, texts });
  return {
    id: item.id,
    name: item.name,
    img: item.img ?? null,
    type: item.type,
    ...((identified && lead && (lead !== first)) && { activityName: activityName(lead) }),
    activation: lead?.labels?.activation || labels.activation || null,
    activationType: activationTypeOf(lead),
    range: rangeOf(item, lead),
    target: lead?.labels?.target || labels.target || null,
    ...rolls,
    // The item's, or else those of the activity it's listed for.
    uses: identified ? (usesOf(item) ?? activityUses(item, lead)) : null,
    level: (item.type === "spell") ? (finite(system.level) ?? 0) : null,
    castFrom: (item.type === "spell") ? castFrom(item) : null,
    concentration: rolls.cast?.concentration ?? ((system.properties?.has?.("concentration") ?? false)
      || (lead?.duration?.concentration === true)),
    identified,
    ...(consumable(item) && { consumable: true }),
    text: texts.add({
      html: identified ? system.description?.value : system.unidentified?.description,
      relativeTo: item
    })
  };
}

/**
 * Is an item one of the consumables: one dnd5e's inventory has among them, such as a potion, a
 * scroll or a wand, or another with uses that never come back, such as a necklace's beads? Spells
 * and features aren't, and an item not identified yet doesn't say.
 * @param {Item} item
 * @returns {boolean}
 */
function consumable(item) {
  if ( ["spell", "feat"].includes(item.type) || (item.system?.identified === false) ) return false;
  if ( item.type === "consumable" ) return true;
  const uses = item.system?.uses;
  return ((finite(uses?.max) ?? 0) > 0) && !(uses.recovery?.length > 0);
}

/* -------------------------------------------- */

/**
 * An item's first activity that its player can see.
 * @param {Item} item
 * @returns {Activity|undefined}
 */
function firstActivity(item) {
  return visibleActivities(item)[0];
}

/**
 * The section for an activity's activation: one of Tidy 5e's, or Other.
 * @param {Activity} [activity]
 * @returns {string}
 */
function sectionOf(activity) {
  let type = activity?.activation?.type;
  if ( REACTIONS.has(type) ) type = "reaction";
  return SECTIONS.includes(type) ? type : "other";
}

/**
 * A section's heading, such as "Bonus Actions", as dnd5e's sheets head them.
 * @param {string} id
 * @returns {string}
 */
function sectionLabel(id) {
  if ( id === "other" ) return localize("DND5E.ActionOther");
  const config = CONFIG.DND5E?.activityActivationTypes?.[id];
  return localize(config?.header ?? config?.label) || id;
}

/**
 * One of Tidy 5e's flags on an item.
 * @param {Item} item
 * @param {string} key
 * @returns {unknown}
 */
function tidyFlag(item, key) {
  return item.flags?.[TIDY]?.[key];
}
