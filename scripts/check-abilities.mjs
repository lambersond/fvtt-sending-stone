/**
 * Which abilities a check sent to a campaign's app may be made with: dnd5e's six to an app before
 * 0.52.0, and since 0.52.0 any the game has, by a key the app takes, to one that says `anyAbility`;
 * and which apps say so. A script of its own, below every script that sends a check, a
 * description's, a check activity's or a request card's, so that each asks the one rule.
 */

/**
 * dnd5e's six abilities, the only ones an app before 0.52.0 takes a check on.
 * @type {string[]}
 */
export const SIX_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * A key dnd5e names a skill or tool by, and since 0.52.0 an ability past the six, as the app accepts
 * one: never ":" or "|", which separate the checks a span offers.
 * @type {RegExp}
 */
export const CHECK_KEY = /^[A-Za-z][\w-]{0,31}$/;

/**
 * Is a check on this ability, one the game has, sent to a campaign's app: one of the six; or, to an
 * app that reads checks on any ability, since 0.52.0, any whose key the app takes, so that none it
 * would drop alone is sent and cuts a choice short. The caller asks first whether the game has it.
 * @param {string} ability
 * @param {boolean} anyAbility   Does the app read checks on any ability?
 * @returns {boolean}
 */
export function isAbilitySent(ability, anyAbility) {
  if ( SIX_ABILITIES.includes(ability) ) return true;
  return (anyAbility === true) && (typeof ability === "string") && CHECK_KEY.test(ability);
}

/**
 * The campaigns whose app reads checks on any ability the game has, by id, as their latest answer
 * to a hello or heartbeat said: `anyAbility` 1 or later, since 0.52.0.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * Note whether a campaign's app reads checks on any ability the game has, from what it said in
 * answer to its hello or heartbeat: `features.anyAbility`, an integer, 1 or more; not where it said
 * anything else, or nothing. The one writer of the readers.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {boolean}   Did it read them before?
 */
export function noteAnyAbilityFormat(campaignId, features) {
  const was = readers.has(campaignId);
  const format = features?.anyAbility;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
  return was;
}

/**
 * Does a campaign's app read checks on any ability the game has, as its latest answer said?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function anyAbilityReader(campaignId) {
  return readers.has(campaignId);
}
