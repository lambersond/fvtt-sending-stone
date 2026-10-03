import { CHAT_SCOPES, EVENTS } from "./constants.mjs";
import { chatEnabled, chatScope } from "./config.mjs";
import { canSend } from "./bridge.mjs";
import { connectedId } from "./characters.mjs";
import { chatAudience, isAudienceShared, serializeMessage } from "./chat-data.mjs";
import { send } from "./transport.mjs";

/**
 * Chat message events.
 */

/**
 * Set while a clear of the whole chat log is being reported, so that it is reported once rather
 * than once per message. Core deletes every message in one operation and calls the deletion hook
 * for each of them in turn, synchronously.
 * @type {boolean}
 */
let clearing = false;

/**
 * Register the chat hooks.
 * @returns {void}
 */
export function registerChatHooks() {
  Hooks.on("createChatMessage", onCreateMessage);
  Hooks.on("updateChatMessage", onUpdateMessage);
  Hooks.on("deleteChatMessage", onDeleteMessage);
}

/**
 * Should chat events be posted from this client right now?
 * @returns {boolean}
 */
function active() {
  return canSend() && chatEnabled();
}

/**
 * Is this message one the listener should hear about?
 * @param {ChatMessage} message
 * @param {object} audience   The message's audience.
 * @returns {boolean}
 */
function isInScope(message, audience) {
  if ( !isAudienceShared(audience) ) return false;
  if ( chatScope() === CHAT_SCOPES.CONNECTED ) return connectedId(message.speakerActor) !== null;
  return true;
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage} message
 */
function onCreateMessage(message) {
  if ( !active() ) return;
  const audience = chatAudience(message);
  if ( !isInScope(message, audience) ) return;
  send(EVENTS.CHAT_CREATED, { message: serializeMessage(message, audience) });
}

/**
 * Report a change to a message, with the message as it now stands.
 *
 * A message can become visible after it was created, as when a Gamemaster reveals a blind roll, so
 * the listener may receive an update for a message it never saw created. It can also become
 * private, in which case the listener is told to delete it.
 * @param {ChatMessage} message
 * @param {object} changed   The differential data that was written.
 */
function onUpdateMessage(message, changed) {
  if ( !active() ) return;
  const changes = Object.keys(changed).filter(key => key !== "_id");
  if ( !changes.length ) return;

  const audience = chatAudience(message);
  if ( isInScope(message, audience) ) {
    send(EVENTS.CHAT_UPDATED, { changes, message: serializeMessage(message, audience) });
  }
  else if ( ("whisper" in changed) || ("blind" in changed) ) {
    send(EVENTS.CHAT_DELETED, { id: message.id });
  }
}

/**
 * @param {ChatMessage} message
 * @param {object} options     The deletion operation.
 */
function onDeleteMessage(message, options) {
  if ( !active() ) return;

  if ( options?.deleteAll ) {
    if ( clearing ) return;
    clearing = true;
    setTimeout(() => clearing = false, 0);
    send(EVENTS.CHAT_CLEARED, {});
    return;
  }

  // Never reveal that a message the listener was not allowed to see existed.
  if ( !isInScope(message, chatAudience(message)) ) return;
  send(EVENTS.CHAT_DELETED, { id: message.id });
}
