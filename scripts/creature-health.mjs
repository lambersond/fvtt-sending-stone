/**
 * How hurt a creature is, by dnd5e's own rule, for the app's Combat tab, since 0.50.0; and whether a
 * campaign's app reads it and its Gamemaster shows it. A script of its own, as the hello,
 * combat-data.mjs's descriptions and the settings window each ask it.
 */

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
