import { finite, localize } from "./sheet-values.mjs";
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
  const types = actor.itemTypes ?? {};
  const classes = [...(types.class ?? [])].sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0));
  const details = actor.system?.details ?? {};
  const origin = (id, label, item) => ({
    id, label, text: item ? texts.add({ html: item.system?.description?.value, relativeTo: item }) : null, features: []
  });
  const sections = [
    ...classes.map(item => origin(item.identifier, game.i18n.format("DND5E.FeaturesClass", { class: item.name }), item)),
    isItem(details.race) ? origin("species", localize("DND5E.Species.Features"), details.race) : null,
    isItem(details.background) ? origin("background", localize("DND5E.FeaturesBackground"), details.background) : null,
    origin("other", localize("DND5E.FeaturesOther"))
  ].filter(Boolean);

  const features = [...(types.feat ?? []), ...(types.subclass ?? [])]
    .sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name, game.i18n.lang));
  for ( const item of features ) {
    const id = originOf(actor, item);
    const section = sections.find(s => s.id === id) ?? sections.at(-1);
    section.features.push(describeFeature(item, texts));
  }
  return sections.filter(section => section.features.length);
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
 * A feature: what kind it is, how it is used, how often, and its description.
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
    ...usableFields(item),
    text: texts.add({ html: system.description?.value, relativeTo: item })
  };
}

/**
 * What a feature rolls, and its range, target and concentration, as an action has them, so it's
 * used or rolled from the Features tab as from Actions; nothing where it rolls nothing.
 * @param {Item} item
 * @returns {object}
 */
function usableFields(item) {
  const rolls = rollsIfAny(item);
  if ( !rolls ) return {};
  const { range, target, concentration } = usageOf(item);
  return { range, target, concentration, ...rolls };
}

/**
 * An item's limited uses: how many are left of how many, and when they come back.
 * @param {Item} item
 * @returns {{value: number, max: number, recovery: string|null}|null}
 */
export function usesOf(item) {
  return limitedUses(item.system?.uses, item.labels);
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

/* -------------------------------------------- */

/**
 * Is this an item, rather than older data's plain text?
 * @param {unknown} value
 * @returns {boolean}
 */
function isItem(value) {
  return value?.documentName === "Item";
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
