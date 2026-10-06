import { usesOf } from "./sheet-features.mjs";
import { finite, localize } from "./sheet-values.mjs";

/**
 * A character's spellcasting and spellbook, as dnd5e's Spells tab shows them: sections built the
 * way dnd5e builds them, from its spellcasting methods, so they follow its labels and order.
 */

/**
 * The character's spellcasting: its spellcasting ability, spell save DC and spell attack bonus,
 * and each spellcasting class's. Null for a character with no spells and no spellcasting class.
 * @param {Actor} actor
 * @returns {object|null}
 */
export function spellcastingOf(actor) {
  const classes = Object.values(actor.spellcastingClasses ?? {}).map(item => {
    const spellcasting = item.spellcasting ?? {};
    return {
      name: item.name,
      ability: abilityLabel(spellcasting.ability),
      dc: finite(spellcasting.save),
      attack: finite(spellcasting.attack)
    };
  });
  if ( !classes.length && !(actor.itemTypes?.spell?.length) ) return null;
  const attributes = actor.system?.attributes ?? {};
  return {
    ability: abilityLabel(attributes.spellcasting),
    dc: finite(attributes.spell?.dc),
    attack: finite(attributes.spell?.attack),
    classes
  };
}

/**
 * The character's spellbook: its sections in dnd5e's order, such as At-Will, Cantrips, Pact Magic
 * and each spell level, each with its spell slots, if it uses them, and its spells.
 * @param {Actor} actor
 * @param {SheetTexts} texts    Collects the spells' descriptions.
 * @returns {object[]}
 */
export function spellbookOf(actor, texts) {
  const methods = CONFIG.DND5E?.spellcasting ?? {};
  const SingleLevel = globalThis.dnd5e?.dataModels?.spellcasting?.SingleLevelSpellcasting;
  const book = {};

  // As dnd5e's own sheet registers them.
  const register = (key, level, config) => {
    level = config?.slots ? level : 1;
    if ( key in book ) return;
    const usesSlots = Boolean(config?.slots) && (level !== 0);
    book[key] = {
      id: key,
      label: config?.getLabel?.({ level }) ?? localize("DND5E.CAST.SECTIONS.Spellbook"),
      order: (level === 0) ? 0 : (config?.order ?? 1000),
      slots: usesSlots ? slotsOf(actor, key) : null,
      spells: []
    };
  };
  for ( const config of Object.values(methods) ) {
    const levels = config.getAvailableLevels?.(actor) ?? [];
    if ( !levels.length ) continue;
    if ( config.cantrips ) register("spell0", 0, methods.spell);
    levels.forEach(level => register(config.getSpellSlotKey(level), level, config));
  }

  const spells = [...(actor.itemTypes?.spell ?? [])].sort((a, b) =>
    ((a.system?.level ?? 0) - (b.system?.level ?? 0))
    || ((a.sort ?? 0) - (b.sort ?? 0))
    || a.name.localeCompare(b.name, game.i18n.lang));
  for ( const spell of spells ) {
    let method = spell.system?.method;
    if ( !(method in methods) ) method = "innate";
    const config = methods[method];
    const level = (SingleLevel && (config instanceof SingleLevel) && (spell.system.level !== 0))
      ? null
      : (spell.system?.level || 0);
    let key = config?.getSpellSlotKey?.(level) ?? method;

    // Spells cast from items, such as a wand's.
    if ( spell.getFlag?.("dnd5e", "cachedFor") ) {
      if ( !spell.system.linkedActivity?.displayInSpellbook ) continue;
      key = "item";
      register(key);
    }
    else register(key, level, config);
    book[key].spells.push(describeSpell(spell, texts));
  }

  // By order, keeping the order sections were added in between those that share one, as spell
  // levels do.
  return Object.values(book)
    .map((section, index) => ({ section, index }))
    .sort((a, b) => (a.section.order - b.section.order) || (a.index - b.index))
    .map(({ section: { order, ...section } }) => section);
}

/* -------------------------------------------- */

/**
 * A spell: when and how it is cast, and whether it is prepared.
 * @param {Item} spell
 * @param {SheetTexts} texts
 * @returns {object}
 */
function describeSpell(spell, texts) {
  const system = spell.system ?? {};
  const labels = spell.labels ?? {};
  const level = finite(system.level) ?? 0;
  const canPrepare = system.canPrepare ?? (system.method === "spell");
  return {
    id: spell.id,
    name: spell.name,
    img: spell.img ?? null,
    level,
    school: labels.school || null,
    components: labels.components?.vsm || null,
    materials: labels.materials || null,
    concentration: system.properties?.has?.("concentration") ?? false,
    ritual: system.properties?.has?.("ritual") ?? false,
    activation: labels.activation || null,
    range: labels.range || null,
    // As dnd5e's spell cards put it, such as "Concentration, up to 1 minute".
    duration: labels.concentrationDuration || labels.duration || null,
    target: labels.target || null,
    // 0 unprepared, 1 prepared, 2 always prepared; null for a spell that isn't prepared, such as a
    // cantrip or one cast at will.
    prepared: (canPrepare && (level > 0)) ? (finite(system.prepared) ?? 0) : null,
    uses: usesOf(spell),
    text: texts.add({ html: system.description?.value, relativeTo: spell })
  };
}

/**
 * The spell slots a section uses: how many are left, of how many.
 * @param {Actor} actor
 * @param {string} key      Such as "spell3" or "pact".
 * @returns {{value: number, max: number}}
 */
function slotsOf(actor, key) {
  const slots = actor.system?.spells?.[key] ?? {};
  return { value: finite(slots.value) ?? 0, max: finite(slots.override) ?? finite(slots.max) ?? 0 };
}

/**
 * @param {string} [ability]    Such as "int".
 * @returns {string|null}
 */
function abilityLabel(ability) {
  if ( !ability ) return null;
  return localize(CONFIG.DND5E?.abilities?.[ability]?.label) || ability;
}
