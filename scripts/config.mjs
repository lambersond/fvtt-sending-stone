import { CHAT_SCOPES, MODULE_ID, SETTINGS } from "./constants.mjs";

/**
 * Typed accessors for this module's settings.
 *
 * Every value is read from settings on each call rather than cached, so a change made by the
 * Gamemaster takes effect on the next event without any invalidation step.
 */

/**
 * The configured listener URL, trimmed. An empty string means none is configured.
 * @returns {string}
 */
export function getListenerUrl() {
  return String(game.settings.get(MODULE_ID, SETTINGS.LISTENER_URL) ?? "").trim();
}

/**
 * The shared secret stored in this browser. An empty string means none is configured.
 * @returns {string}
 */
export function getSecret() {
  return String(game.settings.get(MODULE_ID, SETTINGS.SECRET) ?? "").trim();
}

/**
 * Parse a listener URL, accepting only http and https.
 * @param {string} value   The URL to parse.
 * @returns {URL|null}     The parsed URL, or null if it is missing or not a web address.
 */
export function parseListenerUrl(value) {
  if ( !value ) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return ["http:", "https:"].includes(url.protocol) ? url : null;
}

/**
 * Will the browser refuse to post to this URL from the page Foundry is served on?
 *
 * A page served over https may not make plain http requests ("mixed content"), except to the
 * loopback addresses, which browsers treat as potentially trustworthy.
 * @param {URL} url   A parsed listener URL.
 * @returns {boolean}
 */
export function isMixedContent(url) {
  if ( globalThis.location?.protocol !== "https:" ) return false;
  if ( url.protocol !== "http:" ) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const loopback = (host === "localhost") || host.endsWith(".localhost") || (host === "::1")
    || /^127(?:\.\d{1,3}){3}$/.test(host);
  return !loopback;
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

/**
 * The actor ids of the connected characters.
 * @returns {Set<string>}
 */
export function connectedIds() {
  return new Set(game.settings.get(MODULE_ID, SETTINGS.CHARACTERS) ?? []);
}
