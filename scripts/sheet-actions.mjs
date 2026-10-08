import { limitedUses, usesOf } from "./sheet-features.mjs";
import {
  ammunitionOf, attackModesOf, damageOf, describeUse, rangeOf, rollsOf, saveOf, toHitOf, USES, visibleActivities
} from "./sheet-rolls.mjs";
import { castFrom } from "./sheet-spells.mjs";
import { finite, localize } from "./sheet-values.mjs";

/**
 * What a character can do in a fight, listed as Tidy 5e's Actions tab lists it, by default:
 * equipped weapons; equipped equipment and consumables that are used in a fight; spells that can
 * be cast now and deal damage, are cast as a bonus action or reaction, last a minute or a round, or
 * apply effects; and features that are activated. A player who uses Tidy 5e can add an item to
 * the list, take one off it, or give one a section of its own, and that holds here too.
 *
 * Each action is grouped by how it is activated, and carries what dnd5e works out for it as it
 * prepares the character: its bonus to hit, the saving throw it calls for, and its damage or
 * healing, ability modifier included.
 */

/** Tidy 5e's flags. */
const TIDY = "tidy5e-sheet";

/** The sections, in Tidy 5e's order. Actions activated any other way go under Other. */
const SECTIONS = ["action", "bonus", "reaction", "legendary", "mythic", "lair", "crew", "special"];

/** Activations that take too long to be used in a fight. */
const SLOW = ["minute", "hour", "day", "none"];

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
    .filter(item => (item.isHidden !== true) && inActionList(item))
    .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name, game.i18n.lang));
  for ( const item of items ) {
    const custom = tidyFlag(item, "actionSection");
    const named = (typeof custom === "string") ? custom.trim() : "";
    const id = named || sectionOf(firstActivity(item));
    if ( !sections.has(id) ) sections.set(id, { id, label: named ? localize(named) : sectionLabel(id), actions: [] });
    sections.get(id).actions.push(describeAction(item, texts));
  }
  return Array.from(sections.values()).filter(section => section.actions.length);
}

/* -------------------------------------------- */

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
 * cast, unless it's cast from an item the character must be attuned to and isn't.
 * @param {Item} spell
 * @param {Activity} [first]    Its first activity.
 * @returns {boolean}
 */
function spellInList(spell, first) {
  const system = spell.system ?? {};
  const cantrip = (finite(system.level) ?? 0) === 0;
  const source = system.linkedActivity?.item;
  const sourceUsable = Boolean(source) && ((source.system?.attunement !== "required") || (source.system?.attuned === true));
  if ( !cantrip && !(canCast(spell) || sourceUsable) ) return false;
  if ( source && cantrip && !sourceUsable ) return false;

  const type = first?.activation?.type;
  if ( (type === "bonus") || (type === "reaction") ) return true;
  if ( dealsDamage(spell) ) return true;
  const duration = system.duration ?? {};
  if ( ["minute", "round"].includes(duration.units) && (Number(duration.value) === 1) ) return true;
  return (spell.effects?.size ?? 0) > 0;
}

/**
 * Can a spell above cantrip level be cast now, by how it's cast: prepared, or always prepared,
 * at will or innately without limit, with uses left, or from an item.
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
  if ( limited && ((finite(system.uses?.value) ?? 0) > 0) ) return true;
  return Boolean(system.linkedActivity?.item);
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
 * An action: how it's activated, its range and target, its bonus to hit, the saving throw it calls
 * for, its damage or healing, and its uses. An item not identified yet keeps them to itself.
 * @param {Item} item
 * @param {SheetTexts} texts
 * @returns {object}
 */
function describeAction(item, texts) {
  const system = item.system ?? {};
  const identified = system.identified !== false;
  const activities = visibleActivities(item);
  const [first] = activities;
  const attack = activities.find(activity => activity.type === "attack");
  return {
    id: item.id,
    name: item.name,
    img: item.img ?? null,
    type: item.type,
    activation: first?.labels?.activation || item.labels?.activation || null,
    range: rangeOf(item, attack ?? first),
    target: first?.labels?.target || item.labels?.target || null,
    ...rollsOf(item),
    uses: identified ? (usesOf(item) ?? limitedUses(first?.uses, first?.labels)) : null,
    level: (item.type === "spell") ? (finite(system.level) ?? 0) : null,
    castFrom: (item.type === "spell") ? castFrom(item) : null,
    concentration: (system.properties?.has?.("concentration") ?? false) || (first?.duration?.concentration === true),
    identified,
    text: texts.add({
      html: identified ? system.description?.value : system.unidentified?.description,
      relativeTo: item
    })
  };
}

/**
 * One of an item's activities on its own, as a player made it a favorite: how it's activated, its
 * range and target, its bonus to hit, the saving throw it calls for, its damage or healing, and its
 * uses. An item not identified yet keeps them to itself, as for an action.
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
    toHit: identified ? toHitOf(activity) : null,
    attackId: (identified && (activity.type === "attack")) ? activity.id : null,
    activity: (identified && USES.has(activity.type)) ? describeUse(item, activity) : null,
    attackModes: (identified && (activity.type === "attack")) ? attackModesOf(item) : null,
    ammunition: (identified && (activity.type === "attack")) ? ammunitionOf(item) : null,
    save: identified ? saveOf(activity) : null,
    damage: identified ? damageOf(activity) : [],
    uses: identified ? limitedUses(activity.uses, activity.labels) : null
  };
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
  const type = activity?.activation?.type;
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
