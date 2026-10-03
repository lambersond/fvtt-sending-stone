import { EVENTS, MODULE_ID } from "./constants.mjs";
import { chatEnabled, chatScope, combatEnabled, getListenerUrl, includeGmContent } from "./config.mjs";
import { roster } from "./characters.mjs";
import { snapshotCombat } from "./combat-data.mjs";
import { send } from "./transport.mjs";

/**
 * The bridge: the single client that talks to the listener.
 *
 * Document hooks fire on every connected client, so if every client posted what it saw the
 * listener would receive each event once per user. Only the active Gamemaster posts. They can see
 * every message and combatant, which is what lets this module decide what players may see rather
 * than being limited to it. With no Gamemaster connected, nothing is sent.
 */

/**
 * Was this client the bridge when last checked? Used to notice the role arriving here.
 * @type {boolean}
 */
let wasBridge = false;

/**
 * Is this client the one that posts events?
 * @returns {boolean}
 */
export function isBridge() {
  return (game.ready === true) && (game.user?.isActiveGM === true);
}

/**
 * Should this client post events right now? It must be the bridge and have somewhere to post.
 * @returns {boolean}
 */
export function canSend() {
  return isBridge() && (getListenerUrl() !== "");
}

/* -------------------------------------------- */

/**
 * Send the full current state, so the listener can discard whatever it held and start afresh.
 * @returns {void}
 */
export function announce() {
  if ( !canSend() ) return;
  const module = game.modules.get(MODULE_ID);
  send(EVENTS.HELLO, {
    module: { id: MODULE_ID, version: module?.version ?? null },
    foundry: { version: game.version, generation: game.release?.generation ?? null },
    system: { id: game.system.id, title: game.system.title, version: game.system.version },
    bridge: { userId: game.user.id, name: game.user.name },
    config: {
      chat: chatEnabled(),
      chatScope: chatScope(),
      combat: combatEnabled(),
      gmContent: includeGmContent()
    },
    characters: roster(),
    combats: combatEnabled() ? game.combats.map(snapshotCombat) : []
  });
}

/**
 * Tell the listener the connected characters changed.
 * @returns {void}
 */
export function announceCharacters() {
  if ( !canSend() ) return;
  send(EVENTS.CHARACTERS_UPDATED, { characters: roster() });
}

/* -------------------------------------------- */

/**
 * Announce when this client takes over as the bridge: on load, or when the Gamemaster who held
 * the role disconnects.
 * @returns {void}
 */
export function checkBridge() {
  const bridge = isBridge();
  if ( bridge && !wasBridge ) announce();
  wasBridge = bridge;
}
