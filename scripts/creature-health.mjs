import { dnd5eGeneration } from "./dnd5e-generation.mjs";
import { readSetting } from "./results.mjs";

/**
 * How hurt a creature is, by dnd5e's own rule, for the app's Combat tab, since 0.50.0; and whether a
 * campaign's app reads it and its Gamemaster shows it. A script of its own, as the hello,
 * combat-data.mjs's descriptions and the settings window each ask it.
 */

/**
 * How hurt a creature is, least first, as the app reads it, since 0.50.0.
 * @type {Readonly<{UNHURT: "unhurt", HURT: "hurt", BLOODIED: "bloodied", DOWN: "down"}>}
 */
export const HEALTH = Object.freeze({ UNHURT: "unhurt", HURT: "hurt", BLOODIED: "bloodied", DOWN: "down" });

/**
 * The campaigns whose app reads how hurt other creatures are, by id, as their latest answer to a hello
 * or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * Note whether a campaign's app reads how hurt other creatures are, since 0.50.0: `features.health`,
 * 1 or later. One that says nothing of it, as an older or rolled back app, is described every
 * combatant as before, from its next description.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {void}
 */
export function noteHealthReader(campaignId, features) {
  const format = features?.health;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
}

/**
 * Does a campaign's app read how hurt other creatures are, since 0.50.0?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function healthReader(campaignId) {
  return readers.has(campaignId);
}

/**
 * May a campaign's players see how hurt other creatures in a fight are, since 0.50.0: by its own
 * switch, under dnd5e.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function healthOn(campaign) {
  return (campaign.health === true) && (game.system?.id === "dnd5e");
}

/**
 * What a campaign tells the app of other creatures' health in its hello, since 0.50.0: whether its
 * players see it, and if not, why not, its switch off or the system; and wherever they do, whether
 * their hit points show too (`hitPoints`), as its Gamemaster has set it. It isn't a command: nothing
 * is fetched for it.
 * @param {Campaign} campaign
 * @returns {{enabled: boolean, reason: "off"|"system"|null, hitPoints: boolean}}
 */
export function healthFeatures(campaign) {
  if ( campaign.health !== true ) return { enabled: false, reason: "off", hitPoints: false };
  if ( game.system?.id !== "dnd5e" ) return { enabled: false, reason: "system", hitPoints: false };
  return { enabled: true, reason: null, hitPoints: campaign.healthHitPoints === true };
}

/**
 * How hurt a creature is, since 0.50.0, from its actor's hit points as dnd5e models them: down at 0
 * or below; unhurt at its maximum (with any temporary change to it, as `hitPoints` reads it) or
 * over; bloodied by dnd5e's own rule; else hurt. Temporary hit points don't count, as in dnd5e.
 * Null where it has no hit points as dnd5e models them, or no maximum above 0.
 * @param {Actor|null|undefined} actor
 * @returns {"unhurt"|"hurt"|"bloodied"|"down"|null}
 */
export function healthOf(actor) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !Number.isFinite(hp.value) ) return null;
  if ( hp.value <= 0 ) return HEALTH.DOWN;
  const max = Number.isFinite(hp.effectiveMax) ? hp.effectiveMax : hp.max;
  if ( !Number.isFinite(max) || (max <= 0) ) return null;
  if ( hp.value >= max ) return HEALTH.UNHURT;
  return isBloodied(hp, max) ? HEALTH.BLOODIED : HEALTH.HURT;
}

/**
 * Is a creature below its maximum bloodied, by dnd5e's own `updateBloodied`, since 0.50.0? Never
 * where dnd5e's Bloodied Status is Never Display, as dnd5e then applies none. Under dnd5e 6, at or
 * below the creature's own `hp.bloodied` percent, which an effect can change, and never for an actor
 * that has none, such as a vehicle; under dnd5e 5, at or below its maximum times the threshold,
 * half unless the world's configuration says otherwise.
 * @param {{value: number, bloodied?: number}} hp
 * @param {number} max   Its maximum, above 0.
 * @returns {boolean}
 */
function isBloodied(hp, max) {
  if ( readSetting("dnd5e", "bloodied") === "none" ) return false;
  if ( dnd5eGeneration() >= 6 ) return Number.isFinite(hp.bloodied) && (((hp.value / max) * 100) <= hp.bloodied);
  return hp.value <= (max * (CONFIG.DND5E?.bloodied?.threshold ?? 0.5));
}

/**
 * May a campaign's players see how hurt a combatant is, since 0.50.0, as far as the combatant
 * itself says: not a hidden combatant, nor a creature a player owns, which the app counts as the
 * party; and with no token, or a token not hidden from players whose disposition is Hostile,
 * Neutral or Friendly. So never a Secret token, nor one of any other disposition. Whether it's one
 * of the campaign's own characters or companions is the caller's to ask.
 * @param {Combatant} combatant
 * @param {Actor|null} actor   The actor it's described by.
 * @returns {boolean}
 */
export function isHealthShown(combatant, actor) {
  if ( !combatant || (combatant.hidden === true) ) return false;
  if ( actor?.hasPlayerOwner ) return false;
  const token = combatant.token;
  if ( !token ) return true;
  const dispositions = CONST.TOKEN_DISPOSITIONS;
  if ( (token.hidden === true) || !dispositions ) return false;
  return [dispositions.HOSTILE, dispositions.NEUTRAL, dispositions.FRIENDLY].includes(token.disposition);
}
