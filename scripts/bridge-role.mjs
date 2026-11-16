import { getDestination } from "./config.mjs";

/**
 * Which client sends: whether this one is the bridge, and whether it has somewhere to post.
 *
 * bridge.mjs says what the bridge is, and sends each campaign its hello. These two questions are in
 * a file of their own, importing only config.mjs, because the files the hello is built from ask
 * them too: asked of bridge.mjs, each of those files would import the file that imports it.
 */

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
  return isBridge() && (getDestination() !== "");
}
