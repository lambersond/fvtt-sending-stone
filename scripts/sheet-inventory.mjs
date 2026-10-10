import { usesOf } from "./sheet-features.mjs";
import { rollsIfAny, usageOf } from "./sheet-rolls.mjs";
import { finite, localize } from "./sheet-values.mjs";

/**
 * A character's inventory, as dnd5e's Inventory tab shows it to the character's player: items by
 * type, containers with what they hold, currency, encumbrance and attunement.
 *
 * The bridge is a Gamemaster's browser, and dnd5e conceals some of an item not yet identified
 * only from players: its description, price, rarity, uses and properties. Those are concealed
 * here as for a player.
 */

/**
 * The inventory's sections, in dnd5e's order, for its item types that have none of their own:
 * their type, section id and label key. Containers are listed apart.
 * @type {[string, string, string][]}
 */
const SECTIONS = [
  ["weapon", "weapons", "TYPES.Item.weaponPl"],
  ["equipment", "equipment", "TYPES.Item.equipmentPl"],
  ["consumable", "consumables", "TYPES.Item.consumablePl"],
  ["tool", "tool", "TYPES.Item.toolPl"],
  ["loot", "loot", "TYPES.Item.lootPl"]
];

/**
 * How deep containers within containers are followed.
 * @type {number}
 */
const DEEPEST = 5;

/* -------------------------------------------- */

/**
 * The character's inventory.
 * @param {Actor} actor
 * @param {SheetTexts} texts    Collects the items' descriptions.
 * @returns {object}
 */
export function inventoryOf(actor, texts) {
  const items = Array.from(actor.items ?? []);
  const topLevel = items.filter(item => !containerOf(actor, item));
  const sort = list => list.sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name, game.i18n.lang));

  const sections = inventorySections()
    .map(({ type, id, label }) => ({
      id, label,
      items: sort(topLevel.filter(item => item.type === type)).map(item => describeItem(item, texts))
    }))
    .filter(section => section.items.length);
  const containers = sort(topLevel.filter(item => item.type === "container"))
    .map(container => describeContainer(actor, container, texts, 1));

  const attributes = actor.system?.attributes ?? {};
  return {
    sections,
    containers,
    currency: Object.entries(CONFIG.DND5E?.currencies ?? {}).map(([id, config]) => ({
      id,
      label: localize(config.label) || id,
      abbreviation: localize(config.abbreviation) || id.toUpperCase(),
      value: finite(actor.system?.currency?.[id]) ?? 0
    })),
    encumbrance: encumbranceOf(actor),
    attunement: attributes.attunement
      ? { value: finite(attributes.attunement.value) ?? 0, max: finite(attributes.attunement.max) }
      : null
  };
}

/**
 * The inventory's sections, in order: from each item type's own section where dnd5e defines one,
 * as it does from 4.0, otherwise from its 4.0 to 6.0 defaults.
 * @returns {{type: string, id: string, label: string}[]}
 */
function inventorySections() {
  const models = Object.entries(CONFIG.Item?.dataModels ?? {})
    .filter(([type, model]) => (type !== "container") && model?.inventorySection)
    .map(([type, model]) => ({ type, ...model.inventorySection }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if ( models.length ) return models.map(({ type, id, label }) => ({ type, id, label: localize(label) }));
  return SECTIONS.map(([type, id, label]) => ({ type, id, label: localize(label) }));
}

/* -------------------------------------------- */

/**
 * An item as its owner sees it: an unidentified one keeps its secrets.
 * @param {Item} item
 * @param {SheetTexts} texts
 * @returns {object}
 */
function describeItem(item, texts) {
  const system = item.system ?? {};
  const identified = system.identified !== false;
  return {
    id: item.id,
    name: item.name,
    img: item.img ?? null,
    type: item.type,
    quantity: finite(system.quantity) ?? 1,
    weight: weightOf(item),
    price: identified ? (system.priceLabel || null) : null,
    equipped: ("equipped" in system) ? (system.equipped === true) : null,
    attunement: (identified && ["required", "optional"].includes(system.attunement)) ? system.attunement : null,
    attuned: system.attuned === true,
    uses: identified ? usesOf(item) : null,
    rarity: identified ? rarityOf(system) : null,
    properties: identified ? Array.from(item.labels?.properties ?? [], property => property.label).filter(Boolean) : [],
    identified,
    // What it rolls, and how it's used, so it's used or rolled from Inventory as from Actions.
    ...usableFields(item, texts),
    text: texts.add({
      html: identified ? system.description?.value : system.unidentified?.description,
      relativeTo: item
    })
  };
}

/**
 * What an item rolls, and how it's used, as an action has them; nothing where it rolls nothing,
 * or isn't identified yet.
 * @param {Item} item
 * @param {SheetTexts} [texts]    Collects the descriptions of the spells it casts, and under dnd5e
 *                                6, of its activities.
 * @returns {object}
 */
function usableFields(item, texts) {
  const rolls = rollsIfAny(item, texts);
  return rolls ? { ...usageOf(item), ...rolls } : {};
}

/**
 * A container, with what it holds and how much more it can, unless what it holds is part of what
 * isn't identified yet.
 * @param {Actor} actor
 * @param {Item} container
 * @param {SheetTexts} texts
 * @param {number} depth        How deep in other containers it is.
 * @returns {object}
 */
function describeContainer(actor, container, texts, depth) {
  const system = container.system ?? {};
  const hidden = (system.identified === false) && (system.properties?.has?.("unidentifiedContents") ?? false);
  const contents = (hidden || (depth > DEEPEST)) ? null : Array.from(actor.items ?? [])
    .filter(item => containerOf(actor, item) === container)
    .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name, game.i18n.lang))
    .map(item => (item.type === "container")
      ? describeContainer(actor, item, texts, depth + 1)
      : describeItem(item, texts));
  return { ...describeItem(container, texts), capacity: hidden ? null : capacityOf(system), contents };
}

/**
 * The container an item is in, if it is in one the character has.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {Item|null}
 */
function containerOf(actor, item) {
  const id = item.system?.container;
  return id ? (actor.items?.get(id) ?? null) : null;
}

/**
 * How full a container is, by count or by weight, as dnd5e works it out; null for one without a
 * limit.
 * @param {object} system   The container's system data.
 * @returns {{value: number, max: number, units: string}|null}
 */
function capacityOf(system) {
  const capacity = system.capacity ?? {};
  let value;
  let max;
  let units;
  if ( capacity.count ) {
    value = system.contentsCount;
    max = capacity.count;
    units = localize("DND5E.Items");
  } else if ( capacity.weight?.value ) {
    value = system.contentsWeight;
    max = capacity.weight.value;
    units = weightUnit(capacity.weight.units);
  }
  // A container in a compendium would answer with a promise; one a character holds never does.
  if ( !Number.isFinite(value) || !Number.isFinite(max) ) return null;
  return { value: Math.round(value * 10) / 10, max, units };
}

/* -------------------------------------------- */

/**
 * How much the item and its quantity weigh, if anything.
 * @param {Item} item
 * @returns {{value: number, units: string}|null}
 */
function weightOf(item) {
  const weight = item.system?.weight;
  const each = finite(weight?.value ?? weight);
  if ( !each ) return null;
  const quantity = finite(item.system.quantity) ?? 1;
  return { value: Math.round(each * quantity * 100) / 100, units: weightUnit(weight?.units) };
}

/**
 * A weight unit's abbreviation, such as lb.
 * @param {string} [key]
 * @returns {string}
 */
function weightUnit(key) {
  const config = CONFIG.DND5E?.weightUnits?.[key];
  return localize(config?.abbreviation ?? config?.label) || key || "";
}

/**
 * An item's rarity: dnd5e 5 keeps one, and dnd5e 6 a set of them, the first of which it shows.
 * @param {object} system
 * @returns {string|null}
 */
function rarityOf(system) {
  const key = system.rarity ?? system.rarities?.first?.() ?? Array.from(system.rarities ?? [])[0];
  if ( !key ) return null;
  const config = CONFIG.DND5E?.itemRarity?.[key];
  return localize(config?.label ?? config) || null;
}

/**
 * The character's encumbrance: what it carries of the most it can, in its weight unit, and where
 * being encumbered begins under the variant rule.
 * @param {Actor} actor
 * @returns {object|null}
 */
function encumbranceOf(actor) {
  const encumbrance = actor.system?.attributes?.encumbrance;
  if ( !Number.isFinite(encumbrance?.value) ) return null;
  const rule = setting("encumbrance");
  if ( rule === "none" ) return null;
  const units = CONFIG.DND5E?.encumbrance?.baseUnits?.[actor.type] ?? CONFIG.DND5E?.encumbrance?.baseUnits?.default;
  const unit = units?.[setting("metricWeightUnits") ? "metric" : "imperial"];
  const variant = rule === "variant";
  return {
    value: encumbrance.value,
    max: finite(encumbrance.max),
    units: weightUnit(unit),
    encumbered: variant ? finite(encumbrance.thresholds?.encumbered) : null,
    heavilyEncumbered: variant ? finite(encumbrance.thresholds?.heavilyEncumbered) : null
  };
}

/**
 * A dnd5e setting, or undefined if it has none by that name.
 * @param {string} key
 * @returns {unknown}
 */
function setting(key) {
  try {
    return game.settings.get("dnd5e", key);
  } catch {
    return undefined;
  }
}
