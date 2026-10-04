import { CHAT_SCOPES, EVENTS_PATH, MODULE_ID, SETTINGS } from "./constants.mjs";

/**
 * Typed accessors for this module's settings.
 *
 * Every value is read from settings on each call rather than cached, so a change made by the
 * Gamemaster takes effect on the next event without any invalidation step.
 */

/**
 * Does a typed address start with a scheme, such as https://?
 * @type {RegExp}
 */
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/**
 * The destination events are posted to: the origin of the Sending Stone app, such as
 * https://sending-stone.vercel.app. An empty string means none is configured.
 * @returns {string}
 */
export function getDestination() {
  return parseDestination(game.settings.get(MODULE_ID, SETTINGS.DESTINATION))?.origin ?? "";
}

/**
 * The secret stored in this browser for a campaign: its own, or else the one from before each
 * campaign had its own. An empty string means none is configured.
 * @param {string} [campaignId]
 * @returns {string}
 */
export function getSecret(campaignId) {
  const own = campaignId ? getCampaignSecrets()[campaignId] : undefined;
  return String(own || game.settings.get(MODULE_ID, SETTINGS.SECRET) || "").trim();
}

/**
 * Every campaign's own secret stored in this browser, by campaign id.
 * @returns {Record<string, string>}
 */
export function getCampaignSecrets() {
  return { ...(game.settings.get(MODULE_ID, SETTINGS.CAMPAIGN_SECRETS) ?? {}) };
}

/**
 * Read a destination as typed. Only its origin matters: events always go to the same path under
 * it, so any path typed is dropped. Without a scheme, https is assumed, or http for localhost.
 * @param {string} value   The destination, such as "sending-stone.vercel.app" or
 *                         "http://localhost:3000".
 * @returns {URL|null}     The destination's origin, or null if it is not a web address.
 */
export function parseDestination(value) {
  let address = String(value ?? "").trim();
  if ( !address ) return null;
  if ( !HAS_SCHEME.test(address) ) {
    let probe;
    try {
      probe = new URL(`http://${address}`);
    } catch {
      return null;
    }
    address = `${isLoopback(probe.hostname) ? "http" : "https"}://${address}`;
  }

  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if ( !["http:", "https:"].includes(url.protocol) || !url.hostname ) return null;
  return new URL(url.origin);
}

/**
 * The address events are posted to at a destination.
 * @param {URL} destination   A parsed destination.
 * @returns {string}
 */
export function eventsUrl(destination) {
  return new URL(EVENTS_PATH, destination).href;
}

/**
 * Is a host this computer itself? Browsers treat these as potentially trustworthy even over http.
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopback(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  return (host === "localhost") || host.endsWith(".localhost") || (host === "::1")
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Will the browser refuse to post to this destination from the page Foundry is served on?
 *
 * A page served over https may not make plain http requests ("mixed content"), except to the
 * loopback addresses, which browsers treat as potentially trustworthy.
 * @param {URL} url   A parsed destination.
 * @returns {boolean}
 */
export function isMixedContent(url) {
  if ( globalThis.location?.protocol !== "https:" ) return false;
  if ( url.protocol !== "http:" ) return false;
  return !isLoopback(url.hostname);
}

/* -------------------------------------------- */

/**
 * Are chat message events switched on?
 * @returns {boolean}
 */
export function chatEnabled() {
  return game.settings.get(MODULE_ID, SETTINGS.CHAT_EVENTS) === true;
}

/**
 * Which chat messages are sent. One of CHAT_SCOPES.
 * @returns {string}
 */
export function chatScope() {
  const scope = game.settings.get(MODULE_ID, SETTINGS.CHAT_SCOPE);
  return Object.values(CHAT_SCOPES).includes(scope) ? scope : CHAT_SCOPES.ALL;
}

/**
 * Are combat tracker events switched on?
 * @returns {boolean}
 */
export function combatEnabled() {
  return game.settings.get(MODULE_ID, SETTINGS.COMBAT_EVENTS) === true;
}

/**
 * May information that only a Gamemaster can see be sent? When false, whispers no player can
 * read, blind rolls, hidden combatants and the statistics of unconnected actors are withheld.
 * @returns {boolean}
 */
export function includeGmContent() {
  return game.settings.get(MODULE_ID, SETTINGS.GM_CONTENT) === true;
}
