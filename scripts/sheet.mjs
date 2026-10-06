import { hitPoints } from "./characters.mjs";
import { actionSections } from "./sheet-actions.mjs";
import { deathSavesOf, detailsOf, traitsOf } from "./sheet-details.mjs";
import { conditionsOf, effectSections } from "./sheet-effects.mjs";
import { classesOf, featureSections } from "./sheet-features.mjs";
import { inventoryOf } from "./sheet-inventory.mjs";
import { spellbookOf, spellcastingOf } from "./sheet-spells.mjs";
import { SheetTexts } from "./sheet-texts.mjs";
import { finite, localize } from "./sheet-values.mjs";

/**
 * Character sheets: what a campaign's player sees of their own character in the listener, and
 * rolls from. D&D Fifth Edition only; under another system a character has no sheet.
 *
 * Every number is the one dnd5e itself shows on its sheet, already including proficiency and
 * fixed bonuses. Bonuses that are dice, such as Bless or Guidance, are not in the totals: dnd5e
 * adds them only when it rolls.
 *
 * Descriptions are not in the sheet itself: it refers to each by hash, and they are sent apart.
 * See sheet-texts.mjs.
 */

/**
 * A campaign character's sheet, or null if its system doesn't model one the way dnd5e does.
 * Works with dnd5e 5.x and 6.x, which name some of the derived values differently.
 * @param {Actor} actor
 * @param {SheetTexts} [texts]  Collects the descriptions the sheet refers to.
 * @returns {object|null}
 */
export function characterSheet(actor, texts=new SheetTexts()) {
  const system = actor?.system;
  if ( !system?.abilities || !system.skills ) return null;
  const attributes = system.attributes ?? {};
  const details = system.details ?? {};
  return {
    img: actor.img ?? null,
    level: finite(details.level),
    classes: classesOf(actor),
    species: nameOf(details.race ?? details.species),
    background: nameOf(details.background),
    hp: hitPoints(actor),
    ac: finite(attributes.ac?.value),
    proficiency: finite(attributes.prof),
    initiative: finite(attributes.init?.total),
    speed: speedOf(attributes.movement),
    inspiration: attributes.inspiration === true,
    abilities: Object.entries(system.abilities).map(([id, ability]) => describeAbility(id, ability)),
    skills: Object.entries(system.skills)
      .map(([id, skill]) => describeSkill(actor, id, skill))
      .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
    conditions: conditionsOf(actor, texts),
    features: featureSections(actor, texts),
    effects: effectSections(actor, texts),
    inventory: inventoryOf(actor, texts),
    spellcasting: spellcastingOf(actor),
    spells: spellbookOf(actor, texts),
    traits: traitsOf(actor),
    deathSaves: deathSavesOf(actor),
    details: detailsOf(actor, texts),
    actions: actionSections(actor, texts)
  };
}

/* -------------------------------------------- */

/**
 * An ability: its score and modifier, and the modifiers for its check and its saving throw.
 * @param {string} id       Such as "str".
 * @param {object} ability  The prepared ability data.
 * @returns {object}
 */
function describeAbility(id, ability) {
  const config = CONFIG.DND5E?.abilities?.[id] ?? {};
  return {
    id,
    label: localize(config.label) || id,
    abbreviation: localize(config.abbreviation) || id,
    score: finite(ability.value),
    mod: finite(ability.mod) ?? 0,
    check: abilityCheck(ability),
    save: finite(ability.save?.value) ?? finite(ability.save) ?? finite(ability.mod) ?? 0,
    saveProficient: (ability.proficient ?? 0) >= 1,
    checkMode: rollMode(ability.check?.roll?.mode),
    saveMode: rollMode(ability.save?.roll?.mode)
  };
}

/**
 * The modifier for an ability check. dnd5e 6 works it out; dnd5e 5 leaves it to its sheet, which
 * adds the check bonus and any proficiency, as from Jack of All Trades, to the modifier.
 * @param {object} ability
 * @returns {number}
 */
function abilityCheck(ability) {
  const value = finite(ability.check?.value);
  if ( value !== null ) return value;
  const prof = ability.checkProf;
  const flat = isNumeric(prof?.term) ? (finite(prof.flat) ?? 0) : 0;
  return (finite(ability.mod) ?? 0) + (finite(ability.checkBonus) ?? 0) + flat;
}

/**
 * A skill: its modifier, passive score and proficiency, and whether its checks are rolled with
 * advantage or disadvantage, combining its own and its ability's, as dnd5e does.
 * @param {Actor} actor
 * @param {string} id       Such as "prc".
 * @param {object} skill    The prepared skill data.
 * @returns {object}
 */
function describeSkill(actor, id, skill) {
  return {
    id,
    label: localize(CONFIG.DND5E?.skills?.[id]?.label) || id,
    ability: skill.ability,
    total: finite(skill.total) ?? 0,
    passive: finite(skill.passive),
    proficiency: finite(skill.prof?.multiplier) ?? finite(skill.value) ?? 0,
    mode: combinedMode(actor, [`abilities.${skill.ability}.check.roll.mode`, `skills.${id}.roll.mode`])
  };
}

/* -------------------------------------------- */

/**
 * The walking speed, which dnd5e 5 and 6 both work out as movement.speed, in its units.
 * @param {object} [movement]
 * @returns {{value: number, units: string|null}|null}
 */
function speedOf(movement) {
  const value = finite(movement?.speed) ?? finite(movement?.walk) ?? finite(movement?.speeds?.walk);
  return value === null ? null : { value, units: movement.units ?? null };
}

/**
 * Whether a roll is made with advantage (1), disadvantage (-1) or neither (0), combining several
 * sources the way dnd5e does: any advantage and any disadvantage cancel out.
 * @param {Actor} actor
 * @param {string[]} keyPaths   Paths to each source's roll mode in the actor's system data.
 * @returns {number}
 */
function combinedMode(actor, keyPaths) {
  const field = globalThis.dnd5e?.dataModels?.fields?.AdvantageModeField;
  if ( field?.combineFields ) return rollMode(field.combineFields(actor.system, keyPaths)?.mode);
  const modes = keyPaths.map(path => rollMode(foundry.utils.getProperty(actor.system, path)));
  return Math.sign(modes.reduce((sum, mode) => sum + mode, 0));
}

/**
 * @param {unknown} mode
 * @returns {number}  -1, 0 or 1.
 */
function rollMode(mode) {
  return [-1, 0, 1].includes(mode) ? mode : 0;
}

/**
 * The name of an item the actor links to, such as its species or background, which older data
 * may hold as plain text.
 * @param {unknown} value
 * @returns {string|null}
 */
function nameOf(value) {
  if ( typeof value === "string" ) return value || null;
  return value?.name ?? null;
}

/**
 * Is a proficiency term a plain number, rather than a die as under the proficiency dice rule?
 * @param {unknown} term
 * @returns {boolean}
 */
function isNumeric(term) {
  return (term !== "") && (term !== null) && (term !== undefined) && Number.isFinite(Number(term));
}
