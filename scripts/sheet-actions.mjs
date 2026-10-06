import { limitedUses, usesOf } from "./sheet-features.mjs";
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
  const save = activities.find(activity => activity.type === "save");
  // The damage that goes with the attack, or else the first there is: a save's, or healing.
  const damaging = attack ?? activities.find(activity => activity.labels?.damage?.length);
  return {
    id: item.id,
    name: item.name,
    img: item.img ?? null,
    type: item.type,
    activation: first?.labels?.activation || item.labels?.activation || null,
    range: rangeOf(item, attack ?? first),
    target: first?.labels?.target || item.labels?.target || null,
    toHit: identified ? toHitOf(attack) : null,
    save: identified ? saveOf(save) : null,
    damage: identified ? damageOf(damaging) : [],
    uses: identified ? (usesOf(item) ?? limitedUses(first?.uses, first?.labels)) : null,
    level: (item.type === "spell") ? (finite(system.level) ?? 0) : null,
    concentration: (system.properties?.has?.("concentration") ?? false) || (first?.duration?.concentration === true),
    identified,
    text: texts.add({
      html: identified ? system.description?.value : system.unidentified?.description,
      relativeTo: item
    })
  };
}

/**
 * Where an action reaches, as dnd5e's sheet puts it: for a weapon, its reach or range, such as
 * "reach 5 ft" or "range 20/60 ft"; otherwise its activity's range, such as "30 ft" or "Self".
 * @param {Item} item
 * @param {Activity} [activity]
 * @returns {string|null}
 */
function rangeOf(item, activity) {
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
function toHitOf(attack) {
  const value = Number.parseInt(attack?.labels?.modifier);
  return Number.isFinite(value) ? value : null;
}

/**
 * The saving throw an activity calls for: the ability's abbreviation, or "DC" when the target
 * chooses between several, and the DC.
 * @param {Activity} [activity]
 * @returns {{ability: string, dc: number|null}|null}
 */
function saveOf(activity) {
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
function damageOf(activity) {
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

/* -------------------------------------------- */

/**
 * An item's activities that its player can see and use, in their order. dnd5e 6 hides those that
 * don't apply; dnd5e 5 says they can't be used.
 * @param {Item} item
 * @returns {Activity[]}
 */
function visibleActivities(item) {
  return Array.from(item.system?.activities ?? []).filter(activity => ("isHidden" in activity)
    ? !activity.isHidden
    : (activity.canUse !== false));
}

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
