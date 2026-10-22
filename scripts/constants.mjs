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

  /** World-scope choice of whether players are told hit/miss and save results whatever Foundry
   *  shows them. One of RESULTS_MODES. */
  CHAT_RESULTS: "chatResults",

  /** World-scope switch for making players' attacks from the app through Midi-QOL's workflow.
   *  Shown only while Midi-QOL is active. */
  MIDI_INTEGRATION: "midiIntegration",

  /** World-scope switch for letting players' attacks and spells through Midi-QOL be made at
   *  targets the Gamemaster's canvas doesn't show, such as on another level. Shown only while
   *  Midi-QOL is active. */
  OFF_CANVAS_TARGETS: "offCanvasTargets",

  /** World-scope wait, in milliseconds, before Midi-QOL's own way is taken with a save asked in
   *  the app (see midi-prompts.mjs). Never shown: only tests shorten it. */
  MIDI_PROMPT_WAIT: "midiPromptWait",

  /** Setting menu key for the settings window, where every setting is edited. The key is from when
   *  it held the campaigns alone. */
  CAMPAIGNS_MENU: "campaignsMenu",

  /** World-scope list of campaigns: {id, title, characters, groups, rolls, attacks, prompts,
   *  manualDice, transfers}, characters and groups being actor ids. */
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
 * Whether players are told hit/miss and save results in the app: since 0.31.0, as Foundry shows
 * them, or always, armor class and DCs aside.
 * @type {Readonly<Record<string, string>>}
 */
export const RESULTS_MODES = Object.freeze({
  /** Where Foundry shows players them, by dnd5e's and Midi-QOL's settings, as 0.30.0 did. */
  FOUNDRY: "foundry",

  /** For every target, save and check, whatever those settings show players. */
  ALWAYS: "always"
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

  /** One of a campaign's Group actors, its party, changed, as its sheet or who may see it: sent
   *  only to an app that says it reads them, `features.groups`. */
  GROUP_UPDATED: "group.updated",

  /** One of a campaign's Group actors was deleted. */
  GROUP_REMOVED: "group.removed",

  /** A character's or a party's journal of notes as Foundry holds it, whole, since 0.34.0: sent
   *  only to an app that says it reads them, `features.notes`. */
  JOURNAL_UPDATED: "journal.updated",

  /** What the world's settings that decide what players see now are, for the campaign's
   *  Gamemaster: sent only to an app that says it reads them, `features.settings`. */
  BRIDGE_SETTINGS: "bridge.settings",

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

  /** The game asks one of a campaign's characters for a saving throw that its player rolls, such
   *  as a concentration check: on a chat card, where Foundry waits for the player's click. */
  PROMPT_OPENED: "roll.prompt.opened",

  /** A saving throw the game asked for no longer waits on its player: they rolled it, here or from
   *  the app, its card was deleted, or it was left too long. */
  PROMPT_CLOSED: "roll.prompt.closed",

  /** What became of a command fetched from the app, such as a player's roll. Not part of the event
   *  stream. */
  COMMAND_RESULT: "command.result"
});

/**
 * The rolls a player can have made here from the app, with the dice they rolled there: a skill
 * check, a tool check, an ability check, a saving throw, a death saving throw, or initiative; a hit
 * die spent, or several, of one size or more, at once, offered once the self-test has checked a hit
 * die; or a utility's own roll, such as a d4 of luck.
 * @type {readonly string[]}
 */
export const ROLL_KINDS = Object.freeze([
  "skill", "tool", "ability", "save", "death", "initiative", "hitDie", "hitDice", "formula"
]);

/**
 * The most hit dice a player can spend at once from the app: a character of 20th level's.
 * @type {number}
 */
export const MOST_HIT_DICE = 20;

/**
 * What a player can have made here from the app by using an item, as in Foundry: an attack, with the
 * dice they rolled there; the use of a spell or feature, such as one that calls for a saving throw
 * or heals; then the damage or healing of either, on the same use, with their dice. Offered only
 * for a campaign whose Gamemaster lets its players attack and cast from the app.
 * @type {readonly string[]}
 */
export const ATTACK_KINDS = Object.freeze(["attack", "use", "damage"]);

/**
 * What a player can have done here from the app to an enchantment of theirs: end it, as the ⟲ on
 * dnd5e's card does. Offered where `ATTACK_KINDS` are, as the enchantments are applied by uses.
 * @type {readonly string[]}
 */
export const ENCHANT_KINDS = Object.freeze(["endEnchantment"]);

/**
 * What a player can have done here from the app to a concentration of their character's: end it,
 * as dnd5e's Break Concentration does, with what depends on it, such as Bless on their allies.
 * Offered wherever their rolls are made, as their concentration checks are: it throws no dice and
 * uses nothing.
 * @type {readonly string[]}
 */
export const CONCENTRATION_KINDS = Object.freeze(["endConcentration"]);

/**
 * What a player, or their Gamemaster as them, can have done here from the app to what their
 * character spends: spend charges of a feature, an item, an activity or a resource directly, as
 * they would on dnd5e's sheet, such as two Sorcery Points; and use or gain Heroic Inspiration.
 * Each posts a line in chat saying so. Offered wherever the Gamemaster lets the campaign's players
 * attack and cast from the app, whether or not those can be made here now: neither throws dice or
 * goes through Midi-QOL.
 * @type {readonly string[]}
 */
export const CHARGE_KINDS = Object.freeze(["spend", "inspiration"]);

/**
 * What a player, or their Gamemaster, can have done here from the app with what their character
 * carries, since module 0.31.0: move items and coins between the character and a party of the
 * campaign's, or to another of its characters. Each posts a line in chat saying so. Offered wherever
 * the Gamemaster lets the campaign's players move items and coins, apart from their rolls: it
 * throws no dice.
 * @type {readonly string[]}
 */
export const TRANSFER_KINDS = Object.freeze(["transfer"]);

/**
 * What a player, or their Gamemaster, can have done here from the app with what their character
 * carries, since module 0.33.0: remove one of its items, or part of a stack. It posts a line in chat
 * saying so. Offered wherever the system is D&D Fifth Edition, with no switch of its own, apart from
 * the rolls and the moves: it throws no dice.
 * @type {readonly string[]}
 */
export const REMOVE_KINDS = Object.freeze(["remove"]);

/**
 * What a player, or their Gamemaster, can have done here from the app with journal notes, since
 * module 0.34.0: a note or chapter added to a journal, changed, or a note deleted. Offered under any
 * system, with no switch of its own: it throws no dice.
 * @type {readonly string[]}
 */
export const NOTE_KINDS = Object.freeze(["note"]);

/** The journals notes are kept in, since 0.34.0: a character's own, and a party's. */
export const NOTE_BOOKS = Object.freeze(["personal", "party"]);

/** The most a note's title, body and a journal may hold, since 0.34.0 (round 0.34.0 §5.4). */
export const MOST_NOTE_TITLE = 200;
export const MOST_NOTE_BODY = 20_000;
export const MOST_NOTE_TEXT = 100_000;
export const MOST_ENTRIES = 300;
export const MOST_CHAPTERS = 50;
export const MOST_BOOK_TEXT = 1_000_000;
export const MOST_NOTES = 400;

/** A note's id, as the app makes it and Foundry makes a page's: 16 letters and digits. */
export const NOTE_ID = /^[A-Za-z0-9]{16}$/;

/**
 * The most charges a player can spend at once from the app.
 * @type {number}
 */
export const MOST_SPENT = 999;

/**
 * The most of an item, or of a coin, a player can move at once from the app.
 * @type {number}
 */
export const MOST_MOVED = 10_000_000;

/**
 * The most items, and the most kinds of coin, one move from the app names.
 * @type {number}
 */
export const MOST_MOVED_ITEMS = 10;

/**
 * The most characters one distribution shares a coin among.
 * @type {number}
 */
export const MOST_AMONG = 20;

/**
 * The roll option naming the player's roll a roll is made for, so that its dice can be the ones
 * the player rolled.
 * @type {string}
 */
export const ROLL_TAG = "sendingStone";

/**
 * The roll option marking a damage roll this module builds to plan or preview a player's damage
 * from the app, never posted, whose critical hit is made as dnd5e makes one, as the player's own
 * roll is, since 0.32.0.
 * @type {string}
 */
export const CRITICAL_AS_DND5E = "sendingStoneCritical";

/**
 * The dice a player can roll in the app.
 * @type {ReadonlySet<number>}
 */
export const DIE_FACES = Object.freeze(new Set([4, 6, 8, 10, 12, 20, 100]));

/**
 * The dice a player can make a die of damage in the app, such as a versatile weapon's d10 for its
 * d8.
 * @type {ReadonlySet<number>}
 */
export const DAMAGE_FACES = Object.freeze(new Set([4, 6, 8, 10, 12]));

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
 * with the campaign's id and that, and since 0.30.0 the type of the event answered.
 * @type {string}
 */
export const LISTENER_FEATURES_HOOK = "sendingStone.listenerFeatures";

/**
 * The name of the hook called when a campaign's bridge.hello is answered with a 2xx, for its
 * characters' sheets to follow it, each in a post of its own. Called with the campaign's id, and
 * since 0.30.0 the hello's envelope.
 * @type {string}
 */
export const HELLO_DELIVERED_HOOK = "sendingStone.helloDelivered";

/**
 * The name of the hook called when what the listener takes of a campaign's sheets changes, as an
 * answer says it: the slim format it expands, or the largest post it takes. Called with the
 * campaign's id.
 * @type {string}
 */
export const SHEET_TERMS_HOOK = "sendingStone.sheetTerms";

/**
 * The name of the hook called when an event is dropped: called with its envelope and
 * `{temporary}`, whether it was lost to failures that might not last, such as the app being
 * unreachable for a while, rather than refused.
 * @type {string}
 */
export const EVENT_DROPPED_HOOK = "sendingStone.eventDropped";

/**
 * The slim format of sheets this module sends to a listener that says it expands it, in its
 * answers' `features.slimSheets`: see sheet-slim.mjs.
 * @type {number}
 */
export const SLIM_SHEETS = 1;

/**
 * The largest post a listener takes, in bytes, until it says otherwise in its answers'
 * `features.maxBytes`: the least the protocol asks of one.
 * @type {number}
 */
export const DEFAULT_MAX_BYTES = 1_000_000;
