import {
  CHAT_SCOPES, COMPANION_INITIATIVE, EVENTS, HELLO_DELIVERED_HOOK, MODULE_ID, RESULTS_MODES, SETTINGS
} from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { dishSystem } from "./command-dishes.mjs";
import { attacksUnavailable } from "./command-uses.mjs";
import { MANUAL_DICE, moduleState } from "./companions.mjs";
import { chatEnabled, chatScope, combatEnabled, includeGmContent, resultsAlways } from "./config.mjs";
import { diceStatus } from "./dice-plan.mjs";
import { campaignGroups } from "./groups.mjs";
import { dnd5eChoice, midiSettings, midiValueText, MISSING, readSetting, resultsVerdict } from "./results.mjs";
import { helloPending, send } from "./transport.mjs";

/**
 * What Foundry says of itself for a campaign, since 0.30.0, for its Gamemaster to see on the
 * campaign in the app: the modules Sending Stone works with and their versions, the campaign's own
 * switches and every campaign's, the dnd5e and Midi-QOL settings that decide what players see in
 * chat, and what players then see, the verdict of results.mjs.
 *
 * It's an allowlist, never a whole settings object: no secret, address or token is ever in it, nor
 * any free-text error. It goes in the campaign's hello, `settings`, and since a change to one of
 * dnd5e's or Midi-QOL's settings tells nothing else afresh, in `bridge.settings` when one changes,
 * to an app that says it reads it, in its answers' `features.settings`.
 */

/**
 * The format of the settings sent.
 * @type {number}
 */
const FORMAT = 1;

/**
 * The modules listed, where installed, in this order.
 * @type {readonly string[]}
 */
const MODULES = Object.freeze(["midi-qol", "lib-wrapper", MANUAL_DICE, "combat-focus"]);

/**
 * Midi-QOL's settings shown, all among its configSettings() (MQ settings:1675-1679), by their
 * keys there.
 * @type {readonly string[]}
 */
const MIDI_ROWS = Object.freeze([
  "autoCheckHit", "autoCheckSaves", "gmAttackDisplay", "gmDamageDisplay", "highlightSuccess",
  "highLightCriticalAttackOnly", "playerRollSaves", "rollNPCSaves", "rollNPCLinkedSaves", "rollSavesBlind",
  "rollChecksBlind", "rollSkillsBlind", "blindRollDisplay"
]);

/**
 * Midi-QOL's own settings shown, each world-wide, or kept in each browser and read here as the
 * Gamemaster's (MQX settings:1779-1838).
 * @type {readonly {key: string, client: boolean}[]}
 */
const MIDI_PLAIN = Object.freeze([
  { key: "showGM", client: false },
  { key: "ReplaceDefaultActivities", client: false },
  { key: "ForceHideRoll", client: true },
  { key: "EnableWorkflow", client: true }
]);

/**
 * The world's settings that change what's said here, and that tell nothing else afresh when they
 * do: dnd5e's visibility, Midi-QOL's, and this module's own for targets off screen and, since
 * 0.31.0, for hit/miss and save results in the app. Every other one of this module's sends a hello,
 * which says it.
 * @type {ReadonlySet<string>}
 */
export const WATCHED_SETTINGS = Object.freeze(new Set([
  "dnd5e.attackRollVisibility", "dnd5e.challengeVisibility",
  "midi-qol.ConfigSettings", "midi-qol.showGM", "midi-qol.ReplaceDefaultActivities",
  `${MODULE_ID}.${SETTINGS.OFF_CANVAS_TARGETS}`, `${MODULE_ID}.${SETTINGS.CHAT_RESULTS}`
]));

/**
 * The longest string sent, and the longest string a value is, as the app takes them.
 * @type {number}
 */
const LONGEST = 300;
const LONGEST_VALUE = 100;

/**
 * The campaigns whose app reads `bridge.settings`, by id, as their latest answer to a hello or
 * heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * What each campaign was last told of the settings, as JSON, in a hello or `bridge.settings`, by
 * campaign id.
 * @type {Map<string, string>}
 */
const told = new Map();

/* -------------------------------------------- */

/**
 * What Foundry says of itself for a campaign.
 * @param {Campaign} campaign
 * @returns {{format: 1, modules: object[], sections: object[], results: object[]}}
 */
export function foundrySettings(campaign) {
  const midi = game.modules.get("midi-qol")?.active === true;
  const sections = [
    section("campaign", localize("SENDINGSTONE.Settings.Campaign"), campaignRows(campaign)),
    section("sending-stone", localize("SENDINGSTONE.Settings.World"), worldRows(midi))
  ];
  if ( game.system?.id === "dnd5e" ) sections.push(section("dnd5e", game.system.title, dnd5eRows()));
  if ( midi ) sections.push(section("midi-qol", localize("SENDINGSTONE.Settings.MidiTitle"), midiRows()));
  return {
    format: FORMAT,
    modules: MODULES.flatMap(id => {
      const module = game.modules.get(id);
      if ( !module ) return [];
      return [{
        id,
        title: cut(String(module.title ?? id)),
        version: (typeof module.version === "string") ? cut(module.version, LONGEST_VALUE) : null,
        active: module.active === true
      }];
    }),
    sections,
    results: resultsVerdict().map(({ id, state, text }) => ({ id, state, text: cut(text) }))
  };
}

/**
 * A section of settings.
 * @param {string} id
 * @param {string} title
 * @param {object[]} rows
 * @returns {{id: string, title: string, rows: object[]}}
 */
function section(id, title, rows) {
  return { id, title: cut(String(title ?? id)), rows };
}

/**
 * A setting, as shown: its label, its value as stored, its value in words, and a note on why it
 * doesn't do what it says, if it doesn't.
 * @param {string} id
 * @param {string} label
 * @param {unknown} value
 * @param {string} text
 * @param {string|null} [note]
 * @returns {{id: string, label: string, value: boolean|string|number|null, text: string, note?: string}}
 */
function row(id, label, value, text, note=null) {
  const plain = ((typeof value === "boolean") || Number.isFinite(value)) ? value
    : ((typeof value === "string") ? cut(value, LONGEST_VALUE) : null);
  return { id, label: cut(label), value: plain, text: cut(text || MISSING), ...(note && { note: cut(note) }) };
}

/**
 * A switch, On or Off.
 * @param {string} id
 * @param {string} label
 * @param {boolean} value
 * @param {string|null} [note]
 * @returns {object}
 */
function toggle(id, label, value, note=null) {
  return row(id, label, value === true, onOff(value === true), note);
}

/**
 * The campaign's own switches, since 0.31.0 whether its players move items and coins among them,
 * since 0.38.0 whether it takes their dishes from the Magical Recipe Book, since 0.39.0 whether they
 * may turn off and delete their own effects, since 0.36.0 how its characters' companions enter
 * initiative, and its groups.
 * @param {Campaign} campaign
 * @returns {object[]}
 */
function campaignRows(campaign) {
  const rollsWhy = (campaign.rolls && !diceStatus.ready && ["system", "self-test"].includes(diceStatus.reason))
    ? localize(`SENDINGSTONE.Config.Actions.RollsReason.${diceStatus.reason}`) : null;
  const attacks = campaign.attacks ? attacksUnavailable() : null;
  const attacksWhy = ["self-test", "midi-off"].includes(attacks)
    ? localize(`SENDINGSTONE.Config.Actions.AttacksReason.${attacks}`) : null;
  const dice = moduleState(MANUAL_DICE);
  const diceWhy = (campaign.manualDice && (dice !== "active")) ? localize(`SENDINGSTONE.Config.Actions.ManualDice.${dice}`) : null;
  const groups = campaignGroups(campaign);
  const transfersWhy = (campaign.transfers && (game.system?.id !== "dnd5e"))
    ? localize("SENDINGSTONE.Config.Actions.RollsReason.system") : null;
  const dishesWhy = (campaign.dishes && !dishSystem()) ? localize("SENDINGSTONE.Config.Actions.DishesSystem") : null;
  const effectsWhy = (campaign.effects && (game.system?.id !== "dnd5e"))
    ? localize("SENDINGSTONE.Config.Actions.RollsReason.system") : null;
  return [
    toggle("rolls", localize("SENDINGSTONE.Config.Actions.Rolls"), campaign.rolls, rollsWhy),
    toggle("attacks", localize("SENDINGSTONE.Config.Actions.Attacks"), campaign.attacks, attacksWhy),
    toggle("prompts", localize("SENDINGSTONE.Config.Actions.Prompts"), campaign.prompts),
    toggle("manualDice", localize("SENDINGSTONE.Config.Actions.DicePlayers"), campaign.manualDice, diceWhy),
    toggle("transfers", localize("SENDINGSTONE.Config.Actions.TransfersPlayers"), campaign.transfers, transfersWhy),
    toggle("dishes", localize("SENDINGSTONE.Config.Actions.DishesPlayers"), campaign.dishes, dishesWhy),
    toggle("effects", localize("SENDINGSTONE.Config.Actions.EffectsPlayers"), campaign.effects, effectsWhy),
    row("companionInitiative", localize("SENDINGSTONE.Config.Actions.CompanionInitiative"), campaign.companionInitiative,
      localize(`SENDINGSTONE.Config.Actions.CompanionInitiative${(campaign.companionInitiative === COMPANION_INITIATIVE.AFTER) ? "After" : "Own"}`)),
    row("groups", localize("SENDINGSTONE.Settings.Groups"), groups.length,
      groups.length ? groups.map(group => group.name).join(", ") : localize("SENDINGSTONE.Settings.None"))
  ];
}

/**
 * What's sent for every campaign, since 0.31.0 whether hit/miss and save results are told as Foundry
 * shows them or always, and with Midi-QOL, how players' attacks are made.
 * @param {boolean} midi   Is Midi-QOL active?
 * @returns {object[]}
 */
function worldRows(midi) {
  const scope = chatScope();
  const mode = resultsAlways() ? RESULTS_MODES.ALWAYS : RESULTS_MODES.FOUNDRY;
  const rows = [
    toggle("chatEvents", localize("SENDINGSTONE.Config.General.Chat"), chatEnabled()),
    row("chatScope", localize("SENDINGSTONE.Config.General.Scope"), scope,
      localize(`SENDINGSTONE.Config.General.${(scope === CHAT_SCOPES.CONNECTED) ? "ScopeConnected" : "ScopeAll"}`)),
    row("chatResults", localize("SENDINGSTONE.Config.General.Results"), mode,
      localize(`SENDINGSTONE.Config.General.${(mode === RESULTS_MODES.ALWAYS) ? "ResultsAlways" : "ResultsFoundry"}`)),
    toggle("combatEvents", localize("SENDINGSTONE.Config.General.Combat"), combatEnabled()),
    toggle("gmContent", localize("SENDINGSTONE.Config.General.GmContent"), includeGmContent())
  ];
  if ( midi ) {
    rows.push(
      toggle("midiIntegration", localize("SENDINGSTONE.Config.General.MidiIntegration"),
        readSetting(MODULE_ID, SETTINGS.MIDI_INTEGRATION) !== false),
      toggle("offCanvasTargets", localize("SENDINGSTONE.Config.General.OffCanvas"),
        readSetting(MODULE_ID, SETTINGS.OFF_CANVAS_TARGETS) === true)
    );
  }
  return rows;
}

/**
 * dnd5e's settings that decide what players see, in its own words; and under dnd5e 6, its summary
 * cards, which change where results are drawn, as set in this browser.
 * @returns {object[]}
 */
function dnd5eRows() {
  const rows = ["attackRollVisibility", "challengeVisibility"].map(key => {
    const value = readSetting("dnd5e", key);
    const { label, text } = dnd5eChoice(key, value);
    return row(key, label, value, text);
  });
  const summary = game.settings?.settings?.get?.("dnd5e.chatCardSummary");
  if ( (Number.parseInt(game.system?.version) >= 6) && summary ) {
    const label = (typeof summary.name === "string") ? localize(summary.name) : "chatCardSummary";
    rows.push(toggle("chatCardSummary", thisBrowser(label), readSetting("dnd5e", "chatCardSummary")));
  }
  return rows;
}

/**
 * Midi-QOL's settings that decide what players see, each by Midi's own label; a choice in Midi's
 * words where its language has them.
 * @returns {object[]}
 */
function midiRows() {
  const config = midiSettings();
  const rows = MIDI_ROWS.map(key => {
    const value = config?.[key];
    return row(key, localize(`SENDINGSTONE.Settings.Midi.${key}`), listValue(value), midiValueText(key, value));
  });
  for ( const { key, client } of MIDI_PLAIN ) {
    const label = localize(`SENDINGSTONE.Settings.Midi.${key}`);
    const value = readSetting("midi-qol", key);
    rows.push(row(key, client ? thisBrowser(label) : label, value, midiValueText(key, value)));
  }
  return rows;
}

/**
 * A list's value, as it can be sent: "all" as it is, else how many it names.
 * @param {unknown} value
 * @returns {unknown}
 */
function listValue(value) {
  return Array.isArray(value) ? value.length : value;
}

/**
 * A label for a setting read as this browser, the Gamemaster's, has it.
 * @param {string} label
 * @returns {string}
 */
function thisBrowser(label) {
  return game.i18n.format("SENDINGSTONE.Settings.ThisBrowser", { label });
}

/**
 * On or Off, in words.
 * @param {boolean} value
 * @returns {string}
 */
function onOff(value) {
  return localize(`SENDINGSTONE.Settings.${value ? "On" : "Off"}`);
}

/**
 * A string no longer than the app takes.
 * @param {string} text
 * @param {number} [longest]
 * @returns {string}
 */
function cut(text, longest=LONGEST) {
  const string = String(text ?? "");
  return (string.length > longest) ? `${string.slice(0, longest - 1)}…` : string;
}

/**
 * Words in the game's language.
 * @param {string} key
 * @returns {string}
 */
function localize(key) {
  return game.i18n.localize(key);
}

/* -------------------------------------------- */
/*  Sending                                     */
/* -------------------------------------------- */

/**
 * Note what a campaign was told of the settings, in its hello.
 * @param {string} campaignId
 * @param {object} settings
 * @returns {void}
 */
export function noteSettingsSent(campaignId, settings) {
  told.set(campaignId, JSON.stringify(settings));
}

/**
 * Note whether a campaign's app reads `bridge.settings`, from what it said in answer to its hello or
 * heartbeat: `features.settings`, the format it reads, 1 or later. One that starts to in a
 * heartbeat's answer, as an app deployed mid-session does, is sent the settings at once; after a
 * hello's, the hello said them. One that says nothing of it is sent none.
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteSettingsReader(campaignId, features, type) {
  const format = features?.settings;
  if ( !(Number.isInteger(format) && (format >= 1)) ) {
    readers.delete(campaignId);
    return;
  }
  const was = readers.has(campaignId);
  readers.add(campaignId);
  if ( was || (type !== EVENTS.HEARTBEAT) ) return;
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( campaign ) sendSettings(campaign, { always: true });
}

/**
 * Does a campaign's app read `bridge.settings`?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function settingsReader(campaignId) {
  return readers.has(campaignId);
}

/**
 * Tell each campaign whose app reads them what the settings now are, once one that changes them
 * changes, as each client sees: only the bridge, and only once a burst of changes settles. A
 * campaign's groups are among them by name, so a group it lists renamed or deleted counts too. And
 * once a campaign's hello is answered, it's told them again if they've changed since the hello was
 * queued, as when one changed while it was on its way, which says them as they were.
 * @returns {void}
 */
export function registerSettingsWatch() {
  const changed = foundry.utils.debounce(() => {
    if ( !canSend() ) return;
    for ( const campaign of getCampaigns() ) sendSettings(campaign);
  }, 250);
  for ( const hook of ["createSetting", "updateSetting"] ) {
    Hooks.on(hook, setting => {
      if ( WATCHED_SETTINGS.has(setting?.key) && canSend() ) changed();
    });
  }
  const listed = actor => (actor?.type === "group") && getCampaigns().some(campaign => campaign.groups.has(actor.id));
  Hooks.on("updateActor", (actor, changes) => {
    if ( changes && (typeof changes === "object") && ("name" in changes) && canSend() && listed(actor) ) changed();
  });
  Hooks.on("deleteActor", actor => {
    if ( canSend() && listed(actor) ) changed();
  });
  Hooks.on(HELLO_DELIVERED_HOOK, campaignId => {
    const campaign = getCampaigns().find(c => c.id === campaignId);
    if ( campaign ) sendSettings(campaign);
  });
}

/**
 * Send a campaign whose app reads them the settings, in `bridge.settings`, unless they're what it
 * was last told. Not while a hello is on its way, which says them as they were when it was queued:
 * they follow it, once it's answered, if they've changed since.
 * @param {Campaign} campaign
 * @param {object} [options]
 * @param {boolean} [options.always]   Send them even if they're what it was last told, as to an app
 *                                     that has just started to read them.
 * @returns {void}
 */
function sendSettings(campaign, { always=false }={}) {
  if ( !canSend() || !readers.has(campaign.id) || helloPending(campaign.id) ) return;
  const settings = foundrySettings(campaign);
  const json = JSON.stringify(settings);
  if ( !always && (told.get(campaign.id) === json) ) return;
  told.set(campaign.id, json);
  send(EVENTS.BRIDGE_SETTINGS, { settings }, campaign);
}
