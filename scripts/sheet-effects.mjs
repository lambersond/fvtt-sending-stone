import { finite, localize, localizeFirst } from "./sheet-values.mjs";

/**
 * A character's conditions and active effects, as dnd5e's Effects tab shows them to the
 * character's player.
 *
 * The bridge is a Gamemaster's browser, and dnd5e hides some effects from players only when the
 * user isn't a Gamemaster, such as those of an item not yet identified. Those rules are applied
 * here as for a player.
 */

/**
 * The categories effects are sorted into, in the order dnd5e lists them, with the keys of their
 * labels in dnd5e 6 and 5.
 * @type {[string, string, string][]}
 */
const CATEGORIES = [
  ["temporary", "DND5E.EFFECT.Category.Temporary", "DND5E.EffectTemporary"],
  ["passive", "DND5E.EFFECT.Category.Passive", "DND5E.EffectPassive"],
  ["inactive", "DND5E.EFFECT.Category.Inactive", "DND5E.EffectInactive"],
  ["suppressed", "DND5E.EFFECT.Category.Unavailable", "DND5E.EffectUnavailable"]
];

/* -------------------------------------------- */

/**
 * The character's statuses that the game names: conditions such as Poisoned, and others such as
 * Concentrating or Dead. Exhaustion has its level, and concentration what it's on.
 * @param {Actor} actor
 * @param {SheetTexts} texts    Collects the rules each refers to.
 * @returns {object[]}
 */
export function conditionsOf(actor, texts) {
  const conditions = [];
  for ( const id of actor.statuses ?? [] ) {
    const config = statusEffect(id);
    if ( !config ) continue;
    const condition = {
      id,
      name: localize(config.name) || id,
      img: config.img ?? null,
      level: null,
      detail: null,
      text: config.reference ? texts.add({ reference: config.reference }) : null
    };
    if ( Number.isFinite(CONFIG.DND5E?.conditionTypes?.[id]?.levels) ) {
      condition.level = finite(actor.system?.attributes?.[id]) ?? finite(actor.system?.conditions?.[id]);
    }
    if ( id === CONFIG.specialStatusEffects?.CONCENTRATING ) {
      const names = Array.from(actor.concentration?.items ?? [], item => item.name);
      condition.detail = names.length ? names.join(", ") : null;
    }
    conditions.push(condition);
  }
  return conditions.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/**
 * How the game describes a status, from CONFIG.statusEffects: a list under dnd5e 5, and an
 * object keyed by id under dnd5e 6.
 * @param {string} id
 * @returns {object|undefined}
 */
function statusEffect(id) {
  const effects = CONFIG.statusEffects ?? [];
  return Array.isArray(effects) ? effects.find(effect => effect.id === id) : effects[id];
}

/* -------------------------------------------- */

/**
 * The effects on the character and from its items, sorted into dnd5e's categories: temporary,
 * passive, inactive, and unavailable (suppressed, as by an unequipped item). Empty categories
 * are left out, as are enchantments, which change items rather than the character.
 * @param {Actor} actor
 * @param {SheetTexts} texts    Collects the effects' descriptions.
 * @returns {object[]}
 */
export function effectSections(actor, texts) {
  const conditionIds = conditionEffectIds();
  const categories = Object.fromEntries(CATEGORIES.map(([id]) => [id, []]));
  for ( const effect of actor.allApplicableEffects?.() ?? [] ) {
    if ( hiddenFromPlayer(effect) || effect.isAppliedEnchantment || (effect.type === "enchantment") ) continue;
    effect.updateDuration?.();
    // Conditions are listed as conditions. dnd5e 6 marks their effects; dnd5e 5 gives them fixed
    // ids, and lists one that has a duration among effects too.
    const concentrating = effect.statuses?.has?.(CONFIG.specialStatusEffects?.CONCENTRATING);
    if ( (effect.type === "condition") && !concentrating ) continue;
    if ( conditionIds.has(effect.id) && !effect.duration?.remaining ) continue;
    categories[categoryOf(effect)].push(describeEffect(effect, texts));
  }
  return CATEGORIES
    .map(([id, ...keys]) => ({ id, label: localizeFirst(...keys), effects: categories[id] }))
    .filter(category => category.effects.length);
}

/**
 * Would dnd5e hide this effect from the character's player?
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function hiddenFromPlayer(effect) {
  if ( effect.system?.isConcealed ) return true;
  if ( effect.dependentOrigin?.active === false ) return true;
  const item = (effect.parent?.documentName === "Item") ? effect.parent : null;
  return item?.system?.identified === false;
}

/**
 * Which of dnd5e's categories an effect is in.
 * @param {ActiveEffect} effect
 * @returns {string}
 */
function categoryOf(effect) {
  if ( effect.duration?.expired === true ) return "inactive";
  if ( effect.isSuppressed ) return "suppressed";
  if ( effect.disabled ) return "inactive";
  return effect.isTemporary ? "temporary" : "passive";
}

/**
 * An effect: where it comes from, how long it has left, and its description.
 * @param {ActiveEffect} effect
 * @param {SheetTexts} texts
 * @returns {object}
 */
function describeEffect(effect, texts) {
  return {
    id: effectIdOf(effect),
    name: effect.name,
    img: effect.img ?? null,
    source: sourceOf(effect),
    duration: durationOf(effect),
    disabled: effect.disabled === true,
    text: texts.add({ html: effect.description, relativeTo: effect })
  };
}

/**
 * An effect's id in the sheet: its own on the character, or for one on an item, whose id is only
 * unique among that item's effects, the item's and its own.
 * @param {ActiveEffect} effect
 * @returns {string}
 */
export function effectIdOf(effect) {
  const parent = effect.parent;
  return (parent?.documentName === "Item") ? `${parent.id}.${effect.id}` : effect.id;
}

/**
 * The name of what an effect comes from: the item that carries it, or whatever applied it, such
 * as the spell another character cast.
 * @param {ActiveEffect} effect
 * @returns {string|null}
 */
function sourceOf(effect) {
  if ( effect.parent?.documentName === "Item" ) return effect.parent.name;
  if ( !effect.origin ) return null;
  let source = null;
  try {
    source = fromUuidSync(effect.origin, { strict: false });
  } catch {
    return null;
  }
  // An effect applied from another effect comes from what that effect is on.
  if ( source?.documentName === "ActiveEffect" ) source = source.parent;
  return source?.name ?? null;
}

/**
 * How long an effect has left, as dnd5e shows it, such as "9 Rounds" or "End of Your Next Turn",
 * or null for one without a duration.
 * @param {ActiveEffect} effect
 * @returns {string|null}
 */
function durationOf(effect) {
  const duration = effect.duration ?? {};
  const shown = effect.expirySupportsDuration
    ? !effect.expirySupportsDuration() || Number.isFinite(duration.value)
    : Number.isFinite(duration.value);
  if ( !shown ) return null;
  const special = effect.specialDuration;
  if ( special ) return localize(`DND5E.EFFECT.Expiry.Type.${special.charAt(0).toUpperCase()}${special.slice(1)}`);
  const parts = effect.getDurationParts?.()
    ?? (duration.remaining ? String(duration.label ?? "").split(", ") : []);
  const label = parts.filter(Boolean).join(", ");
  return label || null;
}

/**
 * The fixed ids dnd5e 5 gives the effects that apply its conditions.
 * @returns {Set<string>}
 */
function conditionEffectIds() {
  const staticID = globalThis.dnd5e?.utils?.staticID;
  if ( !staticID ) return new Set();
  return new Set(Object.keys(CONFIG.DND5E?.conditionTypes ?? {}).map(id => staticID(`dnd5e${id}`)));
}
