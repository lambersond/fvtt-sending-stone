import { enchantmentsOf } from "./sheet-enchant.mjs";
import { countedUses, finite, limitedUses, localize } from "./sheet-values.mjs";
import { rollsIfAny, usageOf } from "./sheet-rolls.mjs";

/**
 * A character's classes and features, as dnd5e's Features tab shows them.
 */

/**
 * The character's classes, highest level first, with their hit dice.
 * @param {Actor} actor
 * @returns {object[]}
 */
export function classesOf(actor) {
  const classes = actor.itemTypes?.class ?? [];
  return classes
    .map(item => ({
      id: item.id ?? null,
      identifier: item.identifier ?? null,
      name: item.name,
      levels: finite(item.system?.levels),
      subclass: item.subclass?.name ?? null,
      hitDice: hitDiceOf(item)
    }))
    .sort((a, b) => (b.levels ?? 0) - (a.levels ?? 0));
}

/**
 * A class's hit dice: their size, and how many are left of how many.
 * @param {Item} item
 * @returns {{die: string, value: number|null, max: number|null}|null}
 */
function hitDiceOf(item) {
  const hd = item.system?.hd;
  if ( !hd?.denomination ) return null;
  return { die: hd.denomination, value: finite(hd.value), max: finite(hd.max) };
}

/* -------------------------------------------- */

/**
 * The character's features, grouped as dnd5e groups them by default: by where each came from,
 * each class first, highest level first, then the species, the background, and anything else.
 * Empty groups are left out.
 * @param {Actor} actor
 * @param {SheetTexts} texts    Collects the descriptions the features refer to.
 * @returns {object[]}
 */
export function featureSections(actor, texts) {
  const { groups, sorted } = featureGroups(actor);
  const sections = new Map(groups.map(group => [group, {
    id: group.id,
    label: group.label,
    text: group.from ? texts.add({ html: group.from.system?.description?.value, relativeTo: group.from }) : null,
    features: []
  }]));
  // Described in the order they're sorted in, whatever group each is in, which is the order their
  // descriptions are collected in.
  for ( const [item, group] of sorted ) sections.get(group).features.push(describeFeature(item, texts));
  return [...sections.values()].filter(section => section.features.length);
}

/**
 * The features the sheet's `features` lists, in the order it lists them, group by group: for what
 * refers to a feature by its place on the sheet, such as the resource a favorite stands for.
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function listedFeatures(actor) {
  return featureGroups(actor).groups.flatMap(group => group.features);
}

/**
 * @typedef {object} FeatureGroup
 * @property {string} id        Its section's id, such as a class's identifier, or "other".
 * @property {string} label
 * @property {Item|null} from   The class, species or background it's named for, if any.
 * @property {Item[]} features
 */

/**
 * The groups `featureSections` lists features in, each with the item it's named for, if any, and
 * its features; and every feature, in the order the player keeps them, then by name, with its group.
 * @param {Actor} actor
 * @returns {{groups: FeatureGroup[], sorted: [Item, FeatureGroup][]}}
 */
function featureGroups(actor) {
  const types = actor.itemTypes ?? {};
  const classes = [...(types.class ?? [])].sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0));
  const details = actor.system?.details ?? {};
  const group = (id, label, from=null) => ({ id, label, from, features: [] });
  const groups = [
    ...classes.map(item => group(item.identifier, game.i18n.format("DND5E.FeaturesClass", { class: item.name }), item)),
    isItem(details.race) ? group("species", localize("DND5E.Species.Features"), details.race) : null,
    isItem(details.background) ? group("background", localize("DND5E.FeaturesBackground"), details.background) : null,
    group("other", localize("DND5E.FeaturesOther"))
  ].filter(Boolean);

  const features = [...(types.feat ?? []), ...(types.subclass ?? [])]
    .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name, game.i18n.lang));
  const sorted = features.map(item => {
    const id = originOf(actor, item);
    const found = groups.find(g => g.id === id) ?? groups.at(-1);
    found.features.push(item);
    return [item, found];
  });
  return { groups, sorted };
}

/**
 * Which group a feature belongs to: the class, species or background whose advancement granted
 * it, or "other".
 * @param {Actor} actor
 * @param {Item} item
 * @returns {string}
 */
function originOf(actor, item) {
  const flag = item.getFlag?.("dnd5e", "advancementRoot") ?? item.getFlag?.("dnd5e", "advancementOrigin");
  const [originId] = flag?.split(".") ?? [];
  const granter = originId ? actor.items?.get(originId) : null;
  switch ( granter?.type ) {
    case "race": return "species";
    case "background": return "background";
    case "class": return granter.identifier;
    case "subclass": return granter.class?.identifier ?? "other";
    default: return "other";
  }
}

/**
 * A feature: what kind it is, how it is used, how often, the enchantments it carries, and its
 * description.
 * @param {Item} item
 * @param {SheetTexts} texts
 * @returns {object}
 */
function describeFeature(item, texts) {
  const system = item.system ?? {};
  const kind = item.type === "subclass" ? localize(CONFIG.Item?.typeLabels?.subclass) : system.type?.label;
  return {
    id: item.id,
    name: item.name,
    img: item.img ?? null,
    kind: kind || null,
    requirements: system.requirements || null,
    activation: item.labels?.activation || null,
    // As dnd5e decides: a trait, or anything with nothing to use, is passive.
    passive: (system.properties?.has?.("trait") ?? false) || !(system.activities?.size > 0),
    uses: usesOf(item),
    ...usableFields(item, texts),
    ...enchantmentsOf(item),
    text: texts.add({ html: system.description?.value, relativeTo: item })
  };
}

/**
 * What a feature rolls, and its range, target and concentration, as an action has them, so it's
 * used or rolled from the Features tab as from Actions; nothing where it rolls nothing.
 * @param {Item} item
 * @param {SheetTexts} [texts]    Collects the descriptions of the spells it casts, and under dnd5e
 *                                6, of its activities.
 * @returns {object}
 */
function usableFields(item, texts) {
  const rolls = rollsIfAny(item, texts);
  if ( !rolls ) return {};
  const { range, target, concentration } = usageOf(item);
  return { range, target, concentration, ...rolls };
}

/**
 * An item's limited uses: how many are left of how many, and when they come back; and since
 * 0.29.0, that they're the item's, and whether its player may spend them directly, as
 * `countedUses` has it.
 * @param {Item} item
 * @returns {{value: number, max: number, recovery: string|null, counter?: object, spendable?: true}|null}
 */
export function usesOf(item) {
  return countedUses(limitedUses(item.system?.uses, item.labels), { item });
}

/* -------------------------------------------- */

/**
 * Is this an item, rather than older data's plain text?
 * @param {unknown} value
 * @returns {boolean}
 */
function isItem(value) {
  return value?.documentName === "Item";
}
