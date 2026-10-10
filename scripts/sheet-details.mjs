import { combinedMode, finite, localize } from "./sheet-values.mjs";

/**
 * A character's details, traits and biography, as dnd5e's sheet shows them: who the character is,
 * what they sense, speak and resist, and their story.
 */

/**
 * Details a character's sheet lists about them, with the keys of their labels.
 * @type {[string, string][]}
 */
const ABOUT = [
  ["alignment", "DND5E.Alignment"],
  ["age", "DND5E.Age"],
  ["gender", "DND5E.Gender"],
  ["height", "DND5E.Height"],
  ["weight", "DND5E.Weight"],
  ["eyes", "DND5E.Eyes"],
  ["hair", "DND5E.Hair"],
  ["skin", "DND5E.Skin"],
  ["faith", "DND5E.Faith"]
];

/**
 * The parts of a character's personality, with the keys of their labels.
 * @type {[string, string][]}
 */
const PERSONALITY = [
  ["trait", "DND5E.PersonalityTraits"],
  ["ideal", "DND5E.Ideals"],
  ["bond", "DND5E.Bonds"],
  ["flaw", "DND5E.Flaws"]
];

/* -------------------------------------------- */

/**
 * The character's biography and the details that go with it: alignment, age and the like,
 * personality, appearance and experience.
 * @param {Actor} actor
 * @param {SheetTexts} texts    Collects the biography.
 * @returns {object}
 */
export function detailsOf(actor, texts) {
  const details = actor.system?.details ?? {};
  const entries = list => list
    .map(([id, key]) => ({ id, label: localize(key), value: plain(details[id]) }))
    .filter(entry => entry.value);
  const xp = finite(details.xp?.value);
  return {
    about: entries(ABOUT),
    personality: entries(PERSONALITY),
    appearance: plain(details.appearance),
    xp: xp === null ? null : { value: xp, max: finite(details.xp.max) },
    biography: texts.add({ html: details.biography?.value, relativeTo: actor })
  };
}

/**
 * The character's death saving throws, or null for a system without them.
 * @param {Actor} actor
 * @returns {{success: number, failure: number}|null}
 */
export function deathSavesOf(actor) {
  const death = actor.system?.attributes?.death;
  if ( !death ) return null;
  return { success: finite(death.success) ?? 0, failure: finite(death.failure) ?? 0 };
}

/* -------------------------------------------- */

/**
 * The character's traits, each with its label and values, in the order dnd5e's sheet has them:
 * size, senses, speeds, languages, then resistances, immunities and the like, and proficiencies.
 * Traits without values are left out.
 * @param {Actor} actor
 * @returns {{id: string, label: string, values: string[]}[]}
 */
export function traitsOf(actor) {
  const system = actor.system ?? {};
  const traits = [];
  const add = (id, label, values) => {
    if ( values.length ) traits.push({ id, label, values });
  };

  const size = CONFIG.DND5E?.actorSizes?.[system.traits?.size];
  if ( size ) add("size", localize("DND5E.Size"), [localize(size.label ?? size)]);
  add("senses", localize("DND5E.Senses"), sensesOf(system.attributes?.senses));
  add("speeds", localize("DND5E.Speed"), speedsOf(system.attributes?.movement));
  add("languages", localize("DND5E.Languages"), languagesOf(system.traits?.languages));

  for ( const [trait, config] of Object.entries(CONFIG.DND5E?.traits ?? {}) ) {
    if ( ["saves", "skills", "languages", "dm"].includes(trait) ) continue;
    const label = localize(config.labels?.title ?? config.label) || trait;
    if ( trait === "tool" ) {
      add(trait, label, toolsOf(system.tools));
      continue;
    }
    const data = foundry.utils.getProperty(actor, config.actorKeyPath ?? `system.traits.${trait}`);
    if ( !data ) continue;
    const values = Array.from(listOf(data.value), key => traitLabel(key, trait));
    add(trait, label, [...values, ...splitSemicolons(data.custom)]);
  }
  return traits;
}

/**
 * Senses, such as Darkvision 60 ft, and any described otherwise. dnd5e 5 labels senses with a
 * string, and dnd5e 6 with an object.
 * @param {object} [senses]
 * @returns {string[]}
 */
function sensesOf(senses) {
  if ( !senses ) return [];
  const units = movementUnit(senses.units);
  const ranges = Object.entries(CONFIG.DND5E?.senses ?? {}).flatMap(([key, config]) => {
    const value = finite(senses.ranges?.[key] ?? senses[key]);
    return value ? [`${localize(config?.label ?? config)} ${value} ${units}`.trim()] : [];
  });
  return [...ranges, ...splitSemicolons(senses.special)];
}

/**
 * Speeds, such as Walk 25 ft and Fly 60 ft. dnd5e 6 keeps them under movement.speeds.
 * @param {object} [movement]
 * @returns {string[]}
 */
function speedsOf(movement) {
  if ( !movement ) return [];
  const speeds = movement.speeds ?? movement;
  const units = movementUnit(movement.units);
  return Object.entries(CONFIG.DND5E?.movementTypes ?? {}).flatMap(([key, config]) => {
    const value = finite(speeds[key]);
    if ( !value ) return [];
    let label = localize(config?.label ?? config);
    if ( (key === "fly") && movement.hover ) label = game.i18n.format("DND5E.MOVEMENT.HoverSpeed", { speed: label });
    return [`${label} ${value} ${units}`.trim()];
  });
}

/**
 * Languages, and other ways of communicating, such as Telepathy 60 ft.
 * @param {object} [languages]
 * @returns {string[]}
 */
function languagesOf(languages) {
  if ( !languages ) return [];
  const labels = languages.labels?.languages
    ?? [...Array.from(listOf(languages.value), key => traitLabel(key, "languages")), ...splitSemicolons(languages.custom)];
  const communication = Object.entries(CONFIG.DND5E?.communicationTypes ?? {}).flatMap(([key, config]) => {
    const data = languages.communication?.[key];
    if ( !data?.value ) return [];
    return [`${localize(config.label)} ${data.value} ${movementUnit(data.units)}`.trim()];
  });
  return [...labels, ...communication];
}

/**
 * The tools the character is proficient with. dnd5e keeps each tool with its proficiency.
 * @param {object} [tools]
 * @returns {string[]}
 */
function toolsOf(tools) {
  return Object.entries(tools ?? {})
    .filter(([, tool]) => (tool?.value ?? 0) > 0)
    .map(([key]) => traitLabel(key, "tool"));
}

/**
 * A tool the character has, as dnd5e keeps it with its proficiency: its modifier, passive score
 * and proficiency, and whether its checks are rolled with advantage or disadvantage, combining its
 * own and its ability's, as a skill is described.
 * @param {Actor} actor
 * @param {string} id     Such as "thief".
 * @param {object} tool   The prepared tool data.
 * @returns {{id: string, name: string, ability: string|null, total: number, passive: number|null,
 *   proficiency: number, mode: number}}
 */
export function describeTool(actor, id, tool) {
  return {
    id,
    name: traitLabel(id, "tool"),
    ability: tool.ability ?? null,
    total: finite(tool.total) ?? 0,
    passive: finite(tool.passive),
    proficiency: finite(tool.prof?.multiplier) ?? finite(tool.value) ?? 0,
    mode: combinedMode(actor, [`abilities.${tool.ability}.check.roll.mode`, `tools.${id}.roll.mode`])
  };
}

/* -------------------------------------------- */

/**
 * What dnd5e calls a trait's value, such as "Fire" for fire damage.
 * @param {string} key
 * @param {string} trait
 * @returns {string}
 */
export function traitLabel(key, trait) {
  try {
    return globalThis.dnd5e?.documents?.Trait?.keyLabel?.(key, { trait }) ?? key;
  } catch {
    return key;
  }
}

/**
 * A movement unit's abbreviation, such as ft.
 * @param {string} [key]
 * @returns {string}
 */
function movementUnit(key) {
  const config = CONFIG.DND5E?.movementUnits?.[key];
  return localize(config?.abbreviation ?? config?.label ?? config) || key || "";
}

/**
 * @param {unknown} value   A Set, an array, a single value or nothing.
 * @returns {Iterable<string>}
 */
function listOf(value) {
  if ( !value ) return [];
  if ( (value instanceof Set) || Array.isArray(value) ) return value;
  return [value];
}

/**
 * The parts of a list the Gamemaster typed with semicolons between them.
 * @param {string} [text]
 * @returns {string[]}
 */
function splitSemicolons(text) {
  return String(text ?? "").split(";").map(part => part.trim()).filter(Boolean);
}

/**
 * Text kept as plain text, or null for none.
 * @param {unknown} value
 * @returns {string|null}
 */
function plain(value) {
  return (typeof value === "string") && value.trim() ? value.trim() : null;
}
