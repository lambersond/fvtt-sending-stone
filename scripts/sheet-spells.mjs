import { usesOf } from "./sheet-features.mjs";
import { rollsIfAny } from "./sheet-rolls.mjs";
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

    // Spells cast from items, such as a wand's: every one, whether dnd5e's sheet lists it or not,
    // and whether the item can cast it now or not, but none of an item hidden or not identified.
    if ( castCopy(spell) ) {
      if ( hiddenCopy(spell) ) continue;
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
  const from = castFrom(spell);
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
    // cantrip, one cast at will, or one cast from an item, as dnd5e's sheet has it.
    prepared: (canPrepare && (level > 0) && !system.linkedActivity) ? (finite(system.prepared) ?? 0) : null,
    uses: usesOf(spell),
    castFrom: from,
    // What it rolls, so it's cast or rolled from the Spells tab as from Actions; nothing for one its
    // item can't cast now.
    ...((from?.usable !== false) && rollsIfAny(spell)),
    text: texts.add({ html: system.description?.value, relativeTo: spell })
  };
}

/**
 * The item a spell is cast from, with one of its Cast activities, such as a wand or a hat that casts
 * Disguise Self; null for a spell of the character's own. One the item can't cast now says so, and
 * whether that's for want of attuning to it, as dnd5e has it.
 * @param {Item} spell
 * @returns {{id: string, name: string, usable?: false, attune?: boolean}|null}
 */
export function castFrom(spell) {
  const linked = spell.system?.linkedActivity;
  const item = linked?.item;
  if ( !item ) return null;
  if ( linked.canUse !== false ) return { id: item.id, name: item.name };
  return {
    id: item.id,
    name: item.name,
    usable: false,
    attune: (linked.visibility?.requireAttunement === true) && (item.system?.attuned !== true)
  };
}

/**
 * Is this the copy of a spell dnd5e keeps for an item that casts it, such as a wand's?
 * @param {Item} spell
 * @returns {boolean}
 */
export function castCopy(spell) {
  return (spell.type === "spell") && Boolean(spell.getFlag?.("dnd5e", "cachedFor") ?? spell.flags?.dnd5e?.cachedFor);
}

/**
 * Is this the copy of a spell an item casts, of an item gone, hidden from the character's sheet, as
 * dnd5e 6 hides some, or not identified yet? Its spells are left out with it, giving nothing away.
 * @param {Item} spell
 * @returns {boolean}
 */
export function hiddenCopy(spell) {
  if ( !castCopy(spell) ) return false;
  const item = spell.system?.linkedActivity?.item;
  return !item || (item.system?.identified === false) || (item.isHidden === true)
    || (item.actor?.hiddenItems?.has?.(item.id) === true);
}

/**
 * The spell slots a section uses: how many are left, of how many, and the level a spell is cast
 * at with one, which for Pact Magic is its slots' level. A pool without slots may have no level.
 * @param {Actor} actor
 * @param {string} key      Such as "spell3" or "pact".
 * @returns {{value: number, max: number, level: number|null}}
 */
function slotsOf(actor, key) {
  const slots = actor.system?.spells?.[key] ?? {};
  return {
    value: finite(slots.value) ?? 0,
    max: finite(slots.override) ?? finite(slots.max) ?? 0,
    level: finite(slots.level) || null
  };
}

/**
 * @param {string} [ability]    Such as "int".
 * @returns {string|null}
 */
function abilityLabel(ability) {
  if ( !ability ) return null;
  return localize(CONFIG.DND5E?.abilities?.[ability]?.label) || ability;
}
