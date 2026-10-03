/**
 * Shared identifiers used across the module.
 */

/**
 * The module id. Must match both the manifest "id" and the folder name under Data/modules.
 * @type {string}
 */
export const MODULE_ID = "sending-stone";

/**
 * The version of the event envelope and payload shapes. Incremented only for changes a listener
 * must adapt to; adding a field is not one of them.
 * @type {number}
 */
export const PROTOCOL_VERSION = 1;

/**
 * Keys for the settings and setting menus this module registers.
 * @type {Readonly<Record<string, string>>}
 */
export const SETTINGS = Object.freeze({
  /** Setting menu key for the listener connection dialog. */
  CONNECTION: "connection",

  /** World-scope URL that every event is posted to. */
  LISTENER_URL: "listenerUrl",

  /** Client-scope shared secret, sent as a bearer token. Client scope so that it never leaves the
   *  Gamemaster's browser: world settings are readable by every connected user. */
  SECRET: "secret",

  /** World-scope switch for chat message events. */
  CHAT_EVENTS: "chatEvents",

  /** World-scope choice of which chat messages are sent. One of CHAT_SCOPES. */
  CHAT_SCOPE: "chatScope",

  /** World-scope switch for combat tracker events. */
  COMBAT_EVENTS: "combatEvents",

  /** World-scope switch for sending information only a Gamemaster can see. */
  GM_CONTENT: "gmContent",

  /** Setting menu key for the connected characters dialog. */
  CHARACTERS_MENU: "charactersMenu",

  /** World-scope set of the actor ids of connected characters. */
  CHARACTERS: "characters"
});

/**
 * Which chat messages are sent while chat events are on.
 * @type {Readonly<Record<string, string>>}
 */
export const CHAT_SCOPES = Object.freeze({
  /** Every message, subject to the Gamemaster-only rule. */
  ALL: "all",

  /** Only messages spoken by a connected character. */
  CONNECTED: "connected"
});

/**
 * The type of every event this module sends. The listener routes on these, so they are part of
 * the protocol: renaming one is a breaking change.
 * @type {Readonly<Record<string, string>>}
 */
export const EVENTS = Object.freeze({
  /** The full current state. Sent when a client becomes the bridge and when configuration changes. */
  HELLO: "bridge.hello",

  /** A connection test from the configuration dialog. Carries no game data. */
  PING: "bridge.ping",

  /** The set of connected characters changed. */
  CHARACTERS_UPDATED: "characters.updated",

  CHAT_CREATED: "chat.message.created",
  CHAT_UPDATED: "chat.message.updated",
  CHAT_DELETED: "chat.message.deleted",

  /** The whole chat log was cleared. Sent once in place of a deletion per message. */
  CHAT_CLEARED: "chat.cleared",

  COMBAT_CREATED: "combat.created",
  COMBAT_STARTED: "combat.started",
  COMBAT_TURN: "combat.turn",
  COMBAT_UPDATED: "combat.updated",
  COMBAT_ENDED: "combat.ended",

  COMBATANT_ADDED: "combat.combatant.added",
  COMBATANT_UPDATED: "combat.combatant.updated",
  COMBATANT_REMOVED: "combat.combatant.removed"
});

/**
 * The name of the hook this module calls whenever delivery status changes, so that an open
 * connection dialog can refresh. Called with the status object.
 * @type {string}
 */
export const STATUS_HOOK = "sendingStone.status";
