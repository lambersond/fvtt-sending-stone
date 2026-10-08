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
 * must adapt to; adding a field is not one of them. Version 2 sends each event to campaigns.
 * @type {number}
 */
export const PROTOCOL_VERSION = 2;

/**
 * Where events are posted, under the destination the Gamemaster sets.
 * @type {string}
 */
export const EVENTS_PATH = "/api/events";

/**
 * Where what players ask the game to do, such as their rolls, is fetched, under the destination.
 * Fetched only from an app that says it has them, in its answer to a hello or heartbeat.
 * @type {string}
 */
export const COMMANDS_PATH = "/api/bridge/commands";

/**
 * Keys for the settings and setting menus this module registers.
 * @type {Readonly<Record<string, string>>}
 */
export const SETTINGS = Object.freeze({
  /** World-scope destination: the origin of the app events are posted to. The key is from when
   *  this held a full listener URL; only the origin of what it holds is used. */
  DESTINATION: "listenerUrl",

  /** Client-scope secret of each campaign, by campaign id, sent as a bearer token with its events.
   *  Client scope so that it never leaves the Gamemaster's browser: world settings are readable
   *  by every connected user. */
  CAMPAIGN_SECRETS: "campaignSecrets",

  /** Client-scope secret from before each campaign had its own. Sent for a campaign that has
   *  none. */
  SECRET: "secret",

  /** World-scope switch for chat message events. */
  CHAT_EVENTS: "chatEvents",

  /** World-scope choice of which chat messages are sent. One of CHAT_SCOPES. */
  CHAT_SCOPE: "chatScope",

  /** World-scope switch for combat tracker events. */
  COMBAT_EVENTS: "combatEvents",

  /** World-scope switch for sending information only a Gamemaster can see. */
  GM_CONTENT: "gmContent",

  /** World-scope switch for making players' attacks from the app through Midi-QOL's workflow.
   *  Shown only while Midi-QOL is active. */
  MIDI_INTEGRATION: "midiIntegration",

  /** World-scope switch for letting players' attacks and spells through Midi-QOL be made at
   *  targets the Gamemaster's canvas doesn't show, such as on another level. Shown only while
   *  Midi-QOL is active. */
  OFF_CANVAS_TARGETS: "offCanvasTargets",

  /** Setting menu key for the campaigns dialog. */
  CAMPAIGNS_MENU: "campaignsMenu",

  /** World-scope list of campaigns: {id, title, characters, rolls, attacks}, characters being
   *  actor ids. */
  CAMPAIGNS: "campaigns",

  /** World-scope set of the actor ids of connected characters, from before campaigns. Read once,
   *  to move them into a campaign. */
  CHARACTERS: "characters"
});

/**
 * Which chat messages are sent while chat events are on.
 * @type {Readonly<Record<string, string>>}
 */
export const CHAT_SCOPES = Object.freeze({
  /** Every message, subject to the Gamemaster-only rule. */
  ALL: "all",

  /** Only messages spoken by one of a campaign's characters. */
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

  /** The bridge is still connected. Sent to a campaign that has been sent nothing else lately. */
  HEARTBEAT: "bridge.heartbeat",

  /** One of a campaign's characters changed, such as taking damage or gaining a condition. */
  CHARACTER_UPDATED: "character.updated",

  /** Descriptions that characters' sheets refer to by hash. Sent before the sheets that refer to
   *  them, and only those the campaign has not been sent since its last hello. */
  CHARACTER_TEXTS: "character.texts",

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
  COMBATANT_REMOVED: "combat.combatant.removed",

  /** What became of a command fetched from the app, such as a player's roll. Not part of the event
   *  stream. */
  COMMAND_RESULT: "command.result"
});

/**
 * The rolls a player can have made here from the app, with the dice they rolled there: a skill
 * check, a tool check, an ability check, a saving throw, a death saving throw, or initiative.
 * @type {readonly string[]}
 */
export const ROLL_KINDS = Object.freeze(["skill", "tool", "ability", "save", "death", "initiative"]);

/**
 * What a player can have made here from the app by using an item, as in Foundry: an attack, with the
 * dice they rolled there; the use of a spell or feature, such as one that calls for a saving throw
 * or heals; then the damage or healing of either, on the same use, with their dice. Offered only
 * for a campaign whose Gamemaster lets its players attack and cast from the app.
 * @type {readonly string[]}
 */
export const ATTACK_KINDS = Object.freeze(["attack", "use", "damage"]);

/**
 * The roll option naming the player's roll a roll is made for, so that its dice can be the ones
 * the player rolled.
 * @type {string}
 */
export const ROLL_TAG = "sendingStone";

/**
 * The dice a player can roll in the app.
 * @type {ReadonlySet<number>}
 */
export const DIE_FACES = Object.freeze(new Set([4, 6, 8, 10, 12, 20, 100]));

/**
 * The name of the hook this module calls whenever delivery status changes. Called with the status
 * object.
 * @type {string}
 */
export const STATUS_HOOK = "sendingStone.status";

/**
 * The name of the hook called when the listener asks for a campaign's full state again, answering
 * an event for it with `{"resend": "hello"}`. Called with the campaign's id.
 * @type {string}
 */
export const HELLO_WANTED_HOOK = "sendingStone.helloWanted";

/**
 * The name of the hook called with what the listener does beyond taking events, as it answers a
 * campaign's hello or heartbeat: such as `{commands: true}`, or null when it says nothing. Called
 * with the campaign's id and that.
 * @type {string}
 */
export const LISTENER_FEATURES_HOOK = "sendingStone.listenerFeatures";
