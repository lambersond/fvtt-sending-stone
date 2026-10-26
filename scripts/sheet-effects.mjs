import { MODULE_ID } from "./constants.mjs";
import { finite, localize, localizeFirst } from "./sheet-values.mjs";

/**
 * A character's conditions and active effects, as dnd5e's Effects tab shows them to the
 * character's player.
 *
 * The bridge is a Gamemaster's browser, and dnd5e hides some effects from players only when the
 * user isn't a Gamemaster, such as those of an item not yet identified. Those rules are applied
 * here as for a player.
 *
 * Since module 0.39.0 each effect says what its player may do to it from the app, `ops`, wherever
 * the campaign lets them: turn it off, turn it back on, delete it, or none of these (`opsOf`). The
 * same in every campaign, as the sheet is built without one; the hello says whether a campaign takes
 * them. None on a companion's sheet, whose effects take no commands.
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
 * What the character concentrates on, since module 0.29.0, so that its player may end each from the
 * app: each of dnd5e's concentration effects on them, in dnd5e's order, by the id dnd5e ends it by;
 * named for its item as dnd5e prepares it, with the name its player knows it by, an unidentified
 * scroll's as unidentified, never the name the effect keeps of the item's source; and that item's
 * id, while it's on the character, as a scroll spent to cast it isn't. None while the character
 * can't concentrate on anything, as dnd5e has it.
 * @param {Actor} actor
 * @returns {{effects: {id: string, name: string, item: string|null}[]}}
 */
export function concentrationOf(actor) {
  const { effects, items } = actor.concentration ?? {};
  const prepared = Array.from(items ?? []);
  return {
    effects: Array.from(effects ?? [], effect => {
      const id = (effect.getFlag?.("dnd5e", "item") ?? effect.flags?.dnd5e?.item)?.id;
      const item = (typeof id === "string") ? prepared.find(each => each?.id === id) : undefined;
      return {
        id: effect.id,
        name: item?.name || localizeFirst("DND5E.CONCENTRATION.NoSource", "DND5E.ConcentratingItemless"),
        item: ((typeof id === "string") && (actor.items?.has?.(id) === true)) ? id : null
      };
    })
  };
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
 * are left out, as are enchantments, which change items rather than the character. Since 0.39.0
 * each with what its player may do to it from the app, none at all with `ops: false`, as on a
 * companion's sheet; what's known of the character for that is read once a sheet.
 * @param {Actor} actor
 * @param {SheetTexts} texts    Collects the effects' descriptions.
 * @param {object} [options]
 * @param {boolean} [options.ops]   Does each say what its player may do to it, as `opsOf` has it?
 * @returns {object[]}
 */
export function effectSections(actor, texts, { ops=true }={}) {
  const known = knownOf(actor);
  const conditionIds = known.conditionIds;
  const categories = Object.fromEntries(CATEGORIES.map(([id]) => [id, []]));
  for ( const effect of actor.allApplicableEffects?.() ?? [] ) {
    if ( hiddenFromPlayer(effect) || effect.isAppliedEnchantment || (effect.type === "enchantment") ) continue;
    effect.updateDuration?.();
    // Conditions are listed as conditions. dnd5e 6 marks their effects; dnd5e 5 gives them fixed
    // ids, and lists one that has a duration among effects too.
    const concentrating = effect.statuses?.has?.(CONFIG.specialStatusEffects?.CONCENTRATING);
    if ( (effect.type === "condition") && !concentrating ) continue;
    if ( conditionIds.has(effect.id) && !effect.duration?.remaining ) continue;
    categories[categoryOf(effect)].push(describeEffect(effect, texts, ops ? opsOf(effect, actor, known) : []));
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
 * An effect: where it comes from, how long it has left, what its player may do to it from the app,
 * and its description.
 * @param {ActiveEffect} effect
 * @param {SheetTexts} texts
 * @param {("disable"|"enable"|"delete")[]} ops
 * @returns {object}
 */
function describeEffect(effect, texts, ops) {
  return {
    id: effectIdOf(effect),
    name: effect.name,
    img: effect.img ?? null,
    source: sourceOf(effect),
    duration: durationOf(effect),
    disabled: effect.disabled === true,
    ops,
    text: texts.add({ html: effect.description, relativeTo: effect })
  };
}

/* -------------------------------------------- */
/*  What its player may do to it                */
/* -------------------------------------------- */

/**
 * What the character's player may do to an effect from the app, since module 0.39.0, wherever the
 * campaign lets them (`features.effects`). On the character itself, only an effect the party put
 * there (`fromTheParty`): turned off, deleted, and turned back on only where its player turned it
 * off from the app. On one of its items, only a temporary effect, such as Rage: turned off, and on
 * again as above, never deleted, which would change the item for good. Never a condition, a
 * concentration or what the character's own concentration keeps up, which End ends; nothing hidden
 * from the player, nor an enchantment. One that has expired may only be deleted.
 * @param {ActiveEffect} effect
 * @param {Actor} actor
 * @param {{conditionIds: Set<string>, heldIds: Set<string>}} [known]   Built once a sheet.
 * @returns {("disable"|"enable"|"delete")[]}
 */
export function opsOf(effect, actor, known=knownOf(actor)) {
  if ( hiddenFromPlayer(effect) || effect.isAppliedEnchantment || (effect.type === "enchantment") ) return [];
  if ( (effect.type === "condition") || known.conditionIds.has(effect.id) ) return [];
  if ( known.heldIds.has(effect.id) ) return [];
  const onItem = effect.parent?.documentName === "Item";
  if ( onItem && (!effect.isTemporary || effect.isSuppressed) ) return [];
  if ( !onItem && !fromTheParty(effect) ) return [];
  if ( effect.duration?.expired === true ) return onItem ? [] : ["delete"];
  const toggle = !effect.disabled ? ["disable"] : (offByPlayer(effect) ? ["enable"] : []);
  return onItem ? toggle : [...toggle, "delete"];
}

/**
 * Did the party put this effect on the character: a dish's, or one from a spell or feature of a
 * character a player owns, the character's own or an ally's? Read from its origin as dnd5e records
 * it, a caster's concentration or the effect applied from, else what it was applied from. An effect
 * whose origin is an actor itself was made on that actor's sheet, as dnd5e names the sheet's own
 * actor, so a Gamemaster's boon or curse made there stays the Gamemaster's; so does one naming no
 * origin, or one whose origin has no actor, as a compendium's or a world item's. Reads no campaign.
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function fromTheParty(effect) {
  if ( effect.flags?.[MODULE_ID]?.dish ) return true;
  if ( !effect.origin ) return false;
  let source = null;
  try {
    source = fromUuidSync(effect.origin, { strict: false });
  } catch {
    return false;
  }
  if ( !source || (source.documentName === "Actor") ) return false;
  // An effect applied from another effect comes from what that effect is on.
  if ( source.documentName === "ActiveEffect" ) source = source.parent;
  const caster = (source?.documentName === "Actor") ? source : source?.actor;
  return caster?.hasPlayerOwner === true;
}

/**
 * Did its player turn this effect off from the app, and has nothing turned it on or off since?
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function offByPlayer(effect) {
  return effect.flags?.[MODULE_ID]?.offByPlayer === true;
}

/**
 * What `opsOf` reads of the character, once a sheet: the fixed ids of dnd5e 5's condition effects,
 * and the effects its concentrations are, with those each keeps up on this same character, as Haste
 * cast on themself, which End ends with it.
 * @param {Actor} actor
 * @returns {{conditionIds: Set<string>, heldIds: Set<string>}}
 */
export function knownOf(actor) {
  const heldIds = new Set();
  for ( const concentration of actor.concentration?.effects ?? [] ) {
    heldIds.add(concentration.id);
    let dependents = [];
    try {
      dependents = concentration.getDependents?.() ?? [];
    } catch {
      // What it keeps up can't be read: only the concentration itself is known.
    }
    for ( const dependent of dependents ) {
      if ( (dependent?.documentName === "ActiveEffect") && (dependent.parent === actor) ) heldIds.add(dependent.id);
    }
  }
  return { conditionIds: conditionEffectIds(), heldIds };
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
export function durationOf(effect) {
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
