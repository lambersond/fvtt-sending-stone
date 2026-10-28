import { MODULE_ID, MOST_DISH_LIST } from "./constants.mjs";
import { isBridge } from "./bridge.mjs";

/**
 * The effect a dish from the Magical Recipe Book leaves on each character a Gamemaster serves it to,
 * since module 0.38.0: one Active Effect holding every change the module can map, written in Foundry
 * v14's own form, `system.changes`, on dnd5e 5.3.3's paths; and at most two one-off changes, healing
 * and exhaustion, made once when it's applied. A change the module can't map is never applied but
 * kept, and shown on the card, so the Gamemaster can make it by hand; one bad change never refuses
 * the dish.
 *
 * Its dice were rolled once, in the cookbook, so every character gets the same value, and nothing
 * here rolls. It lasts the time the cookbook says, 24 hours of game time today, and the module
 * deletes it when that has passed, on the bridge, as nothing else here does: core marks it expired,
 * and dnd5e 5.3.3 has no expiry code. One character holds one dish effect at a time: a new dish's
 * replaces it. What the cookbook sends is anyone's who holds a link code, so each of its strings is
 * made inert for Foundry's and dnd5e's enrichers wherever it's shown.
 */

/* -------------------------------------------- */
/*  The cookbook's strings                      */
/* -------------------------------------------- */

/**
 * A string from the Magical Recipe Book made inert for Foundry's and dnd5e's enrichers, since
 * 0.38.0: anyone holding a link code may send any string, and the effect's description is enriched
 * with the Gamemaster's rights for the app, so `[[…]]`, `@Word[…]` and `&Reference[…]` are broken
 * with a zero-width space, which shows as nothing. Escape it after, where it goes into HTML.
 * @param {*} value
 * @returns {string}
 */
export function inert(value) {
  return String(value ?? "")
    .replace(/\[(?=\[)/g, "[\u200B")
    .replace(/\](?=\])/g, "]\u200B")
    .replace(/@(?=\w+\[)/g, "@\u200B")
    .replace(/&(?=\w+\[)/g, "&\u200B");
}

/**
 * A string from the Magical Recipe Book as it goes into HTML built here: inert, then escaped.
 * @param {*} value
 * @returns {string}
 */
function shown(value) {
  return foundry.utils.escapeHTML(inert(value));
}

/* -------------------------------------------- */
/*  Duration                                    */
/* -------------------------------------------- */

/**
 * A dish effect's duration, from the seconds the cookbook gives it: whole hours as hours, as dnd5e's
 * sheet shows them, anything else in seconds; ending with its duration alone, at no combat event.
 * Not sheet-effects.mjs's `durationOf`, which says how long an effect has left.
 * @param {number} seconds
 * @returns {{value: number, units: "hours"|"seconds", expiry: null}}
 */
export function durationOf(seconds) {
  if ( Number.isInteger(seconds) && (seconds > 0) && (seconds % 3600 === 0) ) {
    return { value: seconds / 3600, units: "hours", expiry: null };
  }
  return { value: seconds, units: "seconds", expiry: null };
}

/**
 * The seconds of game time a duration of time lasts, by its units; none for one of rounds, turns or
 * anything else, which only core's own expiry ends.
 * @param {{value?: number, units?: string}|undefined} duration
 * @returns {number|null}
 */
function secondsOf(duration) {
  const per = { seconds: 1, minutes: 60, hours: 3600, days: 86_400 }[duration?.units];
  return (per && Number.isFinite(duration?.value)) ? duration.value * per : null;
}

/* -------------------------------------------- */
/*  Mapping a dish's changes                    */
/* -------------------------------------------- */

/**
 * Is this an integer from -10 to 10, other than 0: an ability score's change, a roll's bonus, or a
 * maximum's change with no formula?
 * @param {unknown} value
 * @returns {boolean}
 */
function smallChange(value) {
  return Number.isInteger(value) && (value >= -10) && (value <= 10) && (value !== 0);
}

/**
 * Is this a key of one of dnd5e's tables, as `CONFIG.DND5E` holds them?
 * @param {string} table
 * @param {unknown} key
 * @returns {boolean}
 */
function keyOf(table, key) {
  const entries = CONFIG.DND5E?.[table];
  return (typeof key === "string") && Boolean(entries) && Object.hasOwn(entries, key);
}

/** The attack kinds dnd5e keeps a bonus for each: melee and ranged, weapon and spell. */
const ATTACKS = ["mwak", "rwak", "msak", "rsak"];

/** A cookbook formula, as the cookbook's own schema has it: such as `3+1d6`. */
const FORMULA = /^(\d+\+)?\d*d\d+(\+\d+)?$/;

/**
 * One change of a dish as dnd5e 5.3.3's effect changes, every value a string and every change of the
 * initial phase; none for exhaustion, which is a one-off; or, for a kind this module doesn't know or
 * one that fails its check, why it's skipped.
 * @param {object} change
 * @param {string} units   The character's units of distance, for a sense's range.
 * @returns {{changes: object[], maxHp?: number, exhaustion?: number}|{skip: "unknown"|"invalid"}}
 */
function mapChange(change, units) {
  const add = (key, value) => ({ key, type: "add", value: String(value), phase: "initial" });
  const invalid = { skip: "invalid" };
  switch ( change.type ) {
    case "abilityScore":
      if ( !keyOf("abilities", change.ability) || !smallChange(change.value) ) return invalid;
      return { changes: [add(`system.abilities.${change.ability}.value`, change.value)] };
    case "rollMode": {
      const mode = { advantage: 1, disadvantage: -1 }[change.mode];
      if ( !mode ) return invalid;
      if ( change.roll === "skill" ) {
        if ( !keyOf("skills", change.skill) ) return invalid;
        return { changes: [add(`system.skills.${change.skill}.roll.mode`, mode)] };
      }
      if ( !["check", "save"].includes(change.roll) || !keyOf("abilities", change.ability) ) return invalid;
      return { changes: [add(`system.abilities.${change.ability}.${change.roll}.roll.mode`, mode)] };
    }
    case "rollBonus": {
      if ( !smallChange(change.value) ) return invalid;
      // No one key holds every attack's bonus: one for each kind of attack. A damage bonus is added
      // only to an attack's first damage part, which the card says.
      if ( ["attack", "damage"].includes(change.roll) ) {
        return { changes: ATTACKS.map(kind => add(`system.bonuses.${kind}.${change.roll}`, change.value)) };
      }
      if ( change.roll === "check" ) return { changes: [add("system.bonuses.abilities.check", change.value)] };
      // A death save adds the saving throws' bonus as well as its own (D5 documents/actor/actor.mjs:1490,
      // :1613), so one key adds it once to each.
      if ( change.roll === "save" ) return { changes: [add("system.bonuses.abilities.save", change.value)] };
      return invalid;
    }
    case "maxHitPoints": {
      const { value, formula } = change;
      if ( !Number.isInteger(value) || (value < -1000) || (value > 1000) ) return invalid;
      if ( formula === undefined ) {
        if ( !smallChange(value) ) return invalid;
      } else if ( (typeof formula !== "string") || (formula.length > 32) || !FORMULA.test(formula) ) return invalid;
      // The value the cookbook rolled, never its formula, which would roll again at every roll.
      return { changes: [add("system.attributes.hp.tempmax", value)], maxHp: value };
    }
    case "damageResistance":
    case "damageVulnerability": {
      if ( !keyOf("damageTypes", change.damageType) ) return invalid;
      const trait = (change.type === "damageResistance") ? "dr" : "dv";
      return { changes: [add(`system.traits.${trait}.value`, change.damageType)] };
    }
    case "conditionImmunity":
      if ( !keyOf("conditionTypes", change.condition) ) return invalid;
      return { changes: [add("system.traits.ci.value", change.condition)] };
    case "sense": {
      const { sense, range } = change;
      if ( !keyOf("senses", sense) || !Number.isInteger(range) || (range < 1) || (range > 5280) ) return invalid;
      const converted = Math.round(dnd5e.utils.convertLength(range, "ft", units, { strict: false }));
      // The larger range is kept, the character's own or the dish's.
      return { changes: [{ ...add(`system.attributes.senses.ranges.${sense}`, converted), type: "upgrade" }] };
    }
    case "exhaustion":
      if ( !Number.isInteger(change.levels) || (change.levels < 1) || (change.levels > 6) ) return invalid;
      // dnd5e works exhaustion out from its own effect, overwriting any change: a one-off instead.
      return { changes: [], exhaustion: change.levels };
    default:
      return { skip: "unknown" };
  }
}

/**
 * A dish's changes as one character's effect writes them, each as sent, two on one key among them;
 * what's skipped, and why; what was rolled; the net change of the maximum hit points; and the
 * exhaustion asked for. A sense's range is in the character's own units; with no character, as the
 * card reads them, in feet.
 * @param {object[]} changes   The body's `effect.changes`.
 * @param {Actor|null} [actor]
 * @returns {{changes: object[], skipped: {type: string, reason: string}[], rolled: object[], maxHp: number,
 *   exhaustion: number}}
 */
export function dishChanges(changes, actor=null) {
  const units = actor?.system?.attributes?.senses?.units || "ft";
  const result = { changes: [], skipped: [], rolled: rolledOf(changes), maxHp: 0, exhaustion: 0 };
  for ( const change of changes ?? [] ) {
    const mapped = mapChange(change, units);
    if ( mapped.skip ) {
      result.skipped.push({ type: String(change.type), reason: mapped.skip });
      continue;
    }
    result.changes.push(...mapped.changes);
    result.maxHp += mapped.maxHp ?? 0;
    result.exhaustion += mapped.exhaustion ?? 0;
  }
  return result;
}

/**
 * What was rolled once for everyone, in the cookbook: each change that carried a formula, with the
 * whole-number value it rolled, whatever its kind, the formula cut to 32 characters, at most 100;
 * the same on the card, in the effect's description and in `dish.applied`.
 * @param {object[]} changes
 * @returns {{type: string, value: number, formula: string}[]}
 */
export function rolledOf(changes) {
  return (changes ?? [])
    .filter(change => (typeof change?.formula === "string") && Number.isInteger(change.value))
    .slice(0, MOST_DISH_LIST)
    .map(change => ({ type: String(change.type), value: change.value, formula: change.formula.slice(0, 32) }));
}

/**
 * A roll's line, as the card and the effect's description say it: "Rolled once for everyone: Maximum
 * Hit Points +7 (3+1d6).", another kind by its own name, the value signed. Plain text, from the
 * cookbook: made inert, and escaped where it goes into HTML.
 * @param {{type: string, value: number, formula: string}} rolled
 * @returns {string}
 */
export function rolledLine({ type, value, formula }) {
  const change = (type === "maxHitPoints") ? game.i18n.localize("SENDINGSTONE.Dish.MaxHitPoints") : type;
  return game.i18n.format("SENDINGSTONE.Dish.Rolled", { change, value: (value < 0) ? String(value) : `+${value}`, formula });
}

/* -------------------------------------------- */
/*  The effect                                  */
/* -------------------------------------------- */

/**
 * The Active Effect a dish leaves on a character, as Foundry v14 writes one: its name the cookbook's,
 * plain, as dnd5e and the module show an effect's name; its description each ingredient's words and
 * what was rolled, inert and escaped; no origin, a cookbook id being no document's; and in its flags
 * what the module reads back: which dish it is, which card, when it ends, and what it did once.
 * @param {object} body       The cookbook's body, as the card keeps it.
 * @param {object} context
 * @param {string} context.app      The app's row id.
 * @param {string} context.card     The card's id.
 * @param {number} context.now      The world time it's applied at.
 * @param {object[]} context.changes   The mapped changes.
 * @param {object[]} context.rolled
 * @param {number} context.maxHp
 * @param {number} context.healed
 * @param {number} context.exhaustion
 * @param {{id: string, recipe: string}|null} context.replaced
 * @param {{type: string, reason: string}[]} context.skipped
 * @returns {object}
 */
export function dishEffectData(body, { app, card, now, changes, rolled, maxHp, healed, exhaustion, replaced, skipped }) {
  const { effect, dish } = body;
  const seconds = effect.duration.seconds;
  return {
    name: inert(effect.name),
    type: "base",
    img: `modules/${MODULE_ID}/icons/dish-${dish.outcome}.svg`,
    description: effect.ingredients.map(i => `<p><strong>${shown(i.name)}.</strong> ${shown(i.text)}</p>`).join("")
      + rolled.map(r => `<p><em>${shown(rolledLine(r))}</em></p>`).join(""),
    origin: null,
    transfer: false,
    disabled: false,
    statuses: [],
    duration: durationOf(seconds),
    system: { changes },
    flags: { [MODULE_ID]: { dish: {
      id: dish.id, app, card, recipe: dish.recipe, outcome: dish.outcome, cook: body.cook.name,
      appliedAt: now, expiresAt: now + seconds, seconds, maxHp, healed, exhaustion, replaced, skipped
    } } }
  };
}

/**
 * The dish effects a character holds: its own, never its items'. Read as both Foundry's embedded
 * collection and a plain list allow.
 * @param {Actor} actor
 * @returns {ActiveEffect[]}
 */
export function dishEffectsOf(actor) {
  return (actor?.effects?.filter?.(effect => effect?.getFlag?.(MODULE_ID, "dish")) ?? []);
}

/**
 * Delete those of these effects a character still holds, in one go: one already gone, as dnd5e 6 or
 * Times Up may delete an expired effect on the active Gamemaster's client, is done.
 * @param {Actor} actor
 * @param {string[]} ids
 * @returns {Promise<void>}
 */
export async function deleteHeld(actor, ids) {
  const held = ids.filter(id => actor.effects.some(effect => effect.id === id));
  if ( held.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", held);
}

/* -------------------------------------------- */
/*  Expiry                                      */
/* -------------------------------------------- */

/**
 * When a dish effect is due to end, in world time: when the module set it to, while its duration
 * is still the one set; or, where a Gamemaster changed its duration by hand, its start and its new
 * duration, never for one of rounds or turns, which only core's own expiry ends. Its source duration
 * is compared by value and units alone: the prepared one carries more.
 * @param {ActiveEffect} effect
 * @returns {number}
 */
function dueAt(effect) {
  const flags = effect.getFlag(MODULE_ID, "dish") ?? {};
  const set = durationOf(flags.seconds);
  const source = effect._source?.duration ?? effect.duration ?? {};
  if ( (source.value === set.value) && (source.units === set.units) && Number.isFinite(flags.expiresAt) ) {
    return flags.expiresAt;
  }
  const lasts = secondsOf(source);
  const start = effect.start?.time ?? flags.appliedAt;
  return ((lasts === null) || !Number.isFinite(start)) ? Infinity : start + lasts;
}

/**
 * End every dish effect whose time has passed, on every world actor, a character taken out of its
 * campaign since among them: on the bridge alone, as world time moves and when this client takes
 * over as the bridge, as time may have moved while no client looked. Whatever the campaign's switch
 * or the system, so a world whose switch went off, or a dnd5e 6 world holding a dish from a 5.x one,
 * still loses its dishes. Core marks an expired effect and suppresses it (expiryAction `update`);
 * the module deletes it, as nothing else here does: the module shows an expired effect as inactive,
 * and dnd5e 5.3.3 has no expiry code. One deleted meanwhile is done, and a delete that throws never
 * stops the rest.
 * @returns {Promise<{deleted: string[], failed: string[]}>}   The effects deleted, and those whose
 *   delete threw, by id.
 */
export async function expireDishEffects() {
  const outcome = { deleted: [], failed: [] };
  if ( !isBridge() ) return outcome;
  const holders = game.actors.filter(actor => dishEffectsOf(actor).length);
  if ( !holders.length ) return outcome;
  const now = game.time.worldTime;
  const due = [];
  for ( const actor of holders ) {
    for ( const effect of dishEffectsOf(actor) ) {
      if ( (effect.duration?.expired === true) || (dueAt(effect) <= now) ) due.push({ actor, id: effect.id });
    }
  }
  for ( const { actor, id } of due ) {
    if ( !actor.effects.some(effect => effect.id === id) ) continue;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
      outcome.deleted.push(id);
    } catch {
      outcome.failed.push(id);
    }
  }
  return outcome;
}

/* -------------------------------------------- */
/*  A long rest                                 */
/* -------------------------------------------- */

/**
 * After a long rest, wake a character holding a dish that raised its maximum hit points at that
 * raised maximum: dnd5e's rest zeroes the source's temporary maximum and refills to the usual one,
 * leaving the dish's out (D5 documents/actor/actor.mjs:2487-2491). On the client that rested, which
 * has just updated the character, so a player resting with no Gamemaster connected is covered too.
 * @param {Actor} actor
 * @param {object} result   dnd5e's rest result.
 * @returns {Promise<void>}
 */
export async function topUpAfterRest(actor, result) {
  if ( result?.updateData?.["system.attributes.hp.tempmax"] !== 0 ) return;
  if ( !dishEffectsOf(actor).some(effect => (effect.getFlag(MODULE_ID, "dish")?.maxHp ?? 0) > 0) ) return;
  const hp = actor.system.attributes?.hp;
  if ( !Number.isFinite(hp?.effectiveMax) || (hp.value >= hp.effectiveMax) ) return;
  await actor.update({ "system.attributes.hp.value": hp.effectiveMax });
}
