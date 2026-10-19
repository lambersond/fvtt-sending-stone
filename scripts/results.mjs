import { chatEnabled, includeGmContent } from "./config.mjs";
import { OUTCOME_SHOWN } from "./midi-prompts.mjs";

/**
 * What players see in chat of hits, misses, saves and checks, and of a Gamemaster's rolls on
 * Midi-QOL's cards: since 0.30.0 the one place every rule of it is, as dnd5e 5.3.3 and 6.0.5 and
 * Midi-QOL v14 draw their cards for a player who isn't a Gamemaster. chat-data.mjs tells each
 * message by these, and the verdict says the same of the world's settings, by the very same
 * functions, so that the two can't drift apart.
 *
 * Every setting is read as it's set now, once per message, or once for a verdict.
 */

/**
 * dnd5e's Attack Result Visibility under which players see whether an attack hit: "Show only
 * results" and "Show results & target ACs".
 * @type {Set<string>}
 */
const ATTACKS_SHOWN = new Set(["hideAC", "all"]);

/**
 * Midi-QOL's Auto Check Hits under which it marks an attack's total for players at all: off, or
 * checked for everyone. Its other two say only the Gamemaster sees results.
 * @type {Set<string>}
 */
const MIDI_MARKS = new Set(["none", "all"]);

/**
 * The prefix of Midi-QOL's own words for each of its settings that's a choice, as it registers them
 * (`midi-qol.<prefix>.<value>`).
 * @type {Record<string, string>}
 */
export const MIDI_OPTIONS = Object.freeze({
  autoCheckHit: "autoCheckHitOptions",
  autoCheckSaves: "autoCheckSavesOptions",
  gmAttackDisplay: "gmAttackDisplayOptions",
  gmDamageDisplay: "gmDamageDisplayOptions",
  playerRollSaves: "playerRollSavesOptions",
  rollNPCSaves: "rollNPCSavesOptions",
  rollNPCLinkedSaves: "rollNPCSavesOptions",
  blindRollDisplay: "blindRollDisplayOptions"
});

/**
 * What stands for a value that isn't there.
 * @type {string}
 */
export const MISSING = "—";

/* -------------------------------------------- */
/*  Reading the settings                        */
/* -------------------------------------------- */

/**
 * The rules what players see is told by, as the world has them now.
 * @typedef {object} ResultRules
 * @property {boolean} gmContent                         Is Gamemaster-only information sent?
 * @property {string|undefined} attackRollVisibility     dnd5e's.
 * @property {string|undefined} challengeVisibility      dnd5e's.
 * @property {{autoCheckHit: string|undefined, autoCheckSaves: string|undefined, highlightSuccess: unknown,
 *   highLightCriticalAttackOnly: unknown, gmAttackDisplay: string, gmDamageDisplay: string,
 *   mergeCardMultiDamage: boolean, addFakeDice: boolean}|null} midi
 *   Midi-QOL's, while it's active; null otherwise. Where its settings can't be read, both GM
 *   displays are "hidden" and `addFakeDice` true, the strictest it has.
 */

/**
 * The rules, as set now.
 * @returns {ResultRules}
 */
export function resultRules() {
  return {
    gmContent: includeGmContent(),
    attackRollVisibility: asString(readSetting("dnd5e", "attackRollVisibility")),
    challengeVisibility: asString(readSetting("dnd5e", "challengeVisibility")),
    midi: (game.modules.get("midi-qol")?.active === true) ? midiRules() : null
  };
}

/**
 * Midi-QOL's rules, as it reads them from its settings (MQX ChatMessageMidi:566-567).
 * @returns {NonNullable<ResultRules["midi"]>}
 */
function midiRules() {
  let config = null;
  try {
    config = globalThis.MidiQOL?.configSettings?.() ?? null;
  } catch {
    config = null;
  }
  if ( !config || (typeof config !== "object") ) {
    return {
      autoCheckHit: undefined, autoCheckSaves: undefined, highlightSuccess: undefined,
      highLightCriticalAttackOnly: undefined, gmAttackDisplay: "hidden", gmDamageDisplay: "hidden",
      mergeCardMultiDamage: false, addFakeDice: true
    };
  }
  return {
    autoCheckHit: asString(config.autoCheckHit),
    autoCheckSaves: asString(config.autoCheckSaves),
    highlightSuccess: config.highlightSuccess,
    highLightCriticalAttackOnly: config.highLightCriticalAttackOnly,
    gmAttackDisplay: asString(config.gmAttackDisplay) ?? "full",
    gmDamageDisplay: asString(config.gmDamageDisplay) ?? "full",
    mergeCardMultiDamage: config.mergeCardMultiDamage === true,
    addFakeDice: config.addFakeDice === true
  };
}

/**
 * A setting of the game's or of another module's, as it's set now; undefined where it can't be
 * read, as where its module isn't there, which counts as keeping from players what it would show.
 * @param {string} namespace
 * @param {string} key
 * @returns {unknown}
 */
export function readSetting(namespace, key) {
  try {
    return game.settings.get(namespace, key);
  } catch {
    return undefined;
  }
}

/**
 * Midi-QOL's settings, as it reads them; none where it isn't there, or they can't be read.
 * @returns {object}
 */
export function midiSettings() {
  try {
    return globalThis.MidiQOL?.configSettings?.() ?? {};
  } catch {
    return {};
  }
}

/**
 * A string, or undefined for anything else.
 * @param {unknown} value
 * @returns {string|undefined}
 */
function asString(value) {
  return (typeof value === "string") ? value : undefined;
}

/**
 * Is a message one of Midi-QOL's workflow cards, as Midi marks it?
 * @param {ChatMessage} message
 * @returns {boolean}
 */
export function midiCard(message) {
  return typeof message?.flags?.["midi-qol"]?.messageType === "string";
}

/* -------------------------------------------- */
/*  The rules                                   */
/* -------------------------------------------- */

/**
 * Do players see whether dnd5e's attack hit, as its Attack Result Visibility has it (D5
 * documents/chat-message.mjs:208, 442-444)?
 * @param {ResultRules} rules
 * @returns {boolean}
 */
export function attacksShown(rules) {
  return rules.gmContent || ATTACKS_SHOWN.has(rules.attackRollVisibility);
}

/**
 * Does Midi-QOL leave dnd5e's success and failure on a roll? It strips them from every roll message
 * unless Color code Hit/Miss/Save Display is on and Only highlight critical/fumble hits is off (MQX
 * ChatMessageMidi:453-495, 547-556); on any value of the second but none, as its own test reads it.
 * Always, without Midi.
 * @param {ResultRules} rules
 * @returns {boolean}
 */
export function midiHighlightShown(rules) {
  return (rules.midi === null) || ((rules.midi.highlightSuccess === true) && !rules.midi.highLightCriticalAttackOnly);
}

/**
 * Do players see the hits section of Midi-QOL's card, its ✓ and ✗ for each target (H1)? Under Auto
 * Check Hits "all" with dnd5e's Attack Result Visibility showing results (MQX ChatMessageMidi:758-765).
 * @param {ResultRules} rules
 * @returns {boolean}
 */
export function midiHitsShown(rules) {
  return rules.gmContent || ((rules.midi?.autoCheckHit === "all") && ATTACKS_SHOWN.has(rules.attackRollVisibility));
}

/**
 * Do players see the success or failure Midi-QOL marks on its card's attack total, against its one
 * target (H2: MQX ChatMessageMidi:524-527, 543-556)?
 * @param {ResultRules} rules
 * @returns {boolean}
 */
export function midiTotalShown(rules) {
  return MIDI_MARKS.has(rules.midi?.autoCheckHit) && ATTACKS_SHOWN.has(rules.attackRollVisibility)
    && midiHighlightShown(rules);
}

/**
 * Do players see the critical and fumble marks on Midi-QOL's attack total (MQX ChatMessageMidi:522-523,
 * 531-532, 543-549)?
 * @param {ResultRules} rules
 * @returns {boolean}
 */
export function midiMarked(rules) {
  return MIDI_MARKS.has(rules.midi?.autoCheckHit) && ATTACKS_SHOWN.has(rules.attackRollVisibility)
    && (rules.midi?.highlightSuccess === true);
}

/**
 * Who sees whether a save or check against a card succeeded, by the card's author, as dnd5e's
 * Challenge Visibility has it (D5 documents/chat-message.mjs:60-67): everyone, on every card or on
 * players'; only the player whose card it is; or no player.
 * @param {ResultRules} rules
 * @param {{isGM: boolean}|null|undefined} author   The user who made the card, or the roll itself.
 * @returns {"everyone"|"author"|"none"}
 */
export function challengeAudience(rules, author) {
  if ( rules.gmContent ) return "everyone";
  const visibility = rules.challengeVisibility;
  if ( visibility === "all" ) return "everyone";
  const player = Boolean(author) && !author.isGM;
  if ( (visibility === "player") && player ) return "everyone";
  return player ? "author" : "none";
}

/**
 * Do players see whether a target saved against Midi-QOL's card? By the target, as Midi keys each
 * result on it (MQX ChatMessageMidi:694-748): one a player owns under Challenge Visibility "Show
 * all" or "Show only from other players", any other under "Show all" alone; and only where Auto
 * Check Saves shows players results.
 * @param {ResultRules} rules
 * @param {Actor|null|undefined} actor   The target's.
 * @returns {boolean}
 */
export function midiSaveSeen(rules, actor) {
  if ( rules.gmContent ) return true;
  if ( !OUTCOME_SHOWN.has(rules.midi?.autoCheckSaves) ) return false;
  const visibility = rules.challengeVisibility;
  return (actor?.hasPlayerOwner === true) ? ["all", "player"].includes(visibility) : (visibility === "all");
}

/**
 * How a Gamemaster's rolls on Midi-QOL's card are trimmed for players, as its GM Attack Roll Display
 * and GM Damage Roll Display trim them (MQX ChatMessageMidi:297-367, 560-621). Null where nothing is:
 * with Gamemaster-only information sent, without Midi, on another card, one by a player, or with
 * both displays in full.
 * @param {ResultRules} rules
 * @param {ChatMessage} message
 * @returns {{attack: string, damage: string, marked: boolean, hits: boolean, fake: boolean,
 *   merge: boolean}|null}
 */
export function gmRollTrim(rules, message) {
  const midi = rules.midi;
  if ( rules.gmContent || (midi === null) || !midiCard(message) || (message.author?.isGM !== true) ) return null;
  if ( (midi.gmAttackDisplay === "full") && (midi.gmDamageDisplay === "full") ) return null;
  return {
    attack: midi.gmAttackDisplay,
    damage: midi.gmDamageDisplay,
    marked: midiMarked(rules),
    hits: midiHitsShown(rules),
    fake: midi.addFakeDice,
    merge: midi.mergeCardMultiDamage
  };
}

/* -------------------------------------------- */
/*  The verdict                                 */
/* -------------------------------------------- */

/**
 * What players see in chat, said in a line for each kind of result, by the same rules as each
 * message is told by: for the campaign's Gamemaster in the app and in Manage Campaigns.
 * @param {ResultRules} [rules]
 * @returns {{id: string, state: "shown"|"partial"|"hidden", text: string}[]}
 */
export function resultsVerdict(rules=resultRules()) {
  if ( !chatEnabled() ) return [{ id: "chat", state: "hidden", text: localize("SENDINGSTONE.Results.ChatOff") }];
  if ( game.system?.id !== "dnd5e" ) return [{ id: "system", state: "hidden", text: localize("SENDINGSTONE.Results.System") }];
  const midi = rules.midi !== null;
  const lines = [];
  const line = (id, what, state, why, where) => lines.push({ id, state, text: verdictText(what, state, why, where) });
  const arv = dnd5eReason("attackRollVisibility", rules.attackRollVisibility);
  const cv = dnd5eReason("challengeVisibility", rules.challengeVisibility);
  const highlight = midi ? [midiReason("highlightSuccess", rules.midi.highlightSuccess),
    midiReason("highLightCriticalAttackOnly", rules.midi.highLightCriticalAttackOnly)] : [];

  if ( rules.gmContent ) {
    const why = [localize("SENDINGSTONE.Results.GmContent")];
    line("hits", midi ? "HitsDnd5e" : "Hits", "shown", why);
    if ( midi ) line("midiHits", "HitsMidi", "shown", why);
    line("saves", "Saves", "shown", why);
    line("checks", "Checks", "shown", why);
    if ( midi ) {
      line("midiSaves", "SavesMidi", "shown", why);
      line("gmRolls", "GmRolls", "shown", why);
    }
    return lines;
  }

  // dnd5e's own attack cards: with Midi, which never draws their tray, only an attack at one target.
  if ( !midi ) line("hits", "Hits", attacksShown(rules) ? "shown" : "hidden", [arv]);
  else {
    const shown = attacksShown(rules) && midiHighlightShown(rules);
    line("hits", "HitsDnd5e", shown ? "partial" : "hidden", [arv, ...highlight], "OneTarget");
  }

  if ( midi ) {
    const base = [midiReason("autoCheckHit", rules.midi.autoCheckHit), arv];
    const display = rules.midi.gmAttackDisplay;
    if ( midiHitsShown(rules) ) line("midiHits", "HitsMidi", "shown", base);
    else if ( midiTotalShown(rules) ) line("midiHits", "HitsMidi", "partial", [...base, ...highlight], "OneTarget");
    else if ( ["hitMiss", "hitMissCrit"].includes(display) && MIDI_MARKS.has(rules.midi.autoCheckHit) ) {
      line("midiHits", "HitsMidi", "partial", [...base, midiReason("gmAttackDisplay", display)], "GmOneTarget");
    }
    else line("midiHits", "HitsMidi", "hidden", base);
  }

  for ( const [id, what] of [["saves", "Saves"], ["checks", "Checks"]] ) {
    if ( midi && !midiHighlightShown(rules) ) {
      line(id, what, "hidden", highlight);
      continue;
    }
    const gm = challengeAudience(rules, { isGM: true });
    const player = challengeAudience(rules, { isGM: false });
    if ( gm === "everyone" ) line(id, what, "shown", [cv]);
    else if ( player === "everyone" ) line(id, what, "partial", [cv], "PlayersOnly");
    else if ( player === "author" ) line(id, what, "partial", [cv], "OwnOnly");
    else line(id, what, "hidden", [cv]);
  }

  if ( midi ) {
    const why = [midiReason("autoCheckSaves", rules.midi.autoCheckSaves), cv];
    // As midiSaveSeen has it for a target a player owns, and one no player does.
    const pc = midiSaveSeen(rules, { hasPlayerOwner: true });
    const npc = midiSaveSeen(rules, { hasPlayerOwner: false });
    if ( pc && npc ) line("midiSaves", "SavesMidi", "shown", why);
    else if ( pc ) line("midiSaves", "SavesMidi", "partial", why, "PlayerTargets");
    else line("midiSaves", "SavesMidi", "hidden", why);

    const { gmAttackDisplay: attack, gmDamageDisplay: damage } = rules.midi;
    const reasons = [midiReason("gmAttackDisplay", attack), midiReason("gmDamageDisplay", damage)];
    const state = ((attack === "full") && (damage === "full")) ? "shown"
      : ((attack === "hidden") && (damage === "hidden")) ? "hidden" : "partial";
    line("gmRolls", "GmRolls", state, reasons, "GmTrimmed");
  }
  return lines;
}

/**
 * A verdict's line: what it's of, shown, hidden, or shown only somewhere, and why.
 * @param {string} what      The key under SENDINGSTONE.Results of what it's of.
 * @param {"shown"|"partial"|"hidden"} state
 * @param {string[]} why     The settings it's so by, each as "{setting}: {value}".
 * @param {string} [where]   The key under SENDINGSTONE.Results.Where of where it's shown, if partly.
 * @returns {string}
 */
function verdictText(what, state, why, where) {
  const data = { what: localize(`SENDINGSTONE.Results.${what}`), why: why.join("; ") };
  if ( state === "partial" ) {
    return game.i18n.format("SENDINGSTONE.Results.Partial", { ...data, where: localize(`SENDINGSTONE.Results.Where.${where}`) });
  }
  return game.i18n.format(`SENDINGSTONE.Results.${(state === "shown") ? "Shown" : "Hidden"}`, data);
}

/**
 * One of dnd5e's settings, and its value, as a reason, in dnd5e's own words as it registers them.
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
export function dnd5eReason(key, value) {
  const { label, text } = dnd5eChoice(key, value);
  return reason(label, text);
}

/**
 * One of dnd5e's settings that's a choice, in dnd5e's words: its name, and the value chosen.
 * @param {string} key
 * @param {unknown} value
 * @returns {{label: string, text: string}}
 */
export function dnd5eChoice(key, value) {
  const config = game.settings?.settings?.get?.(`dnd5e.${key}`);
  const label = (typeof config?.name === "string") ? localize(config.name) : key;
  const choice = ((typeof value === "string") && Object.hasOwn(config?.choices ?? {}, value)) ? config.choices[value] : null;
  const text = (typeof choice === "string") ? localize(choice) : ((typeof value === "string") ? value : MISSING);
  return { label, text };
}

/**
 * One of Midi-QOL's settings, and its value, as a reason, by the setting's own label.
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
export function midiReason(key, value) {
  return reason(localize(`SENDINGSTONE.Settings.Midi.${key}`), midiValueText(key, value));
}

/**
 * One of Midi-QOL's values in words: a choice in Midi's own, where its language has them, else as
 * it's stored; a switch On or Off; a list of ids All, None or the ids.
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
export function midiValueText(key, value) {
  if ( typeof value === "boolean" ) return localize(`SENDINGSTONE.Settings.${value ? "On" : "Off"}`);
  if ( Array.isArray(value) ) {
    return value.length ? value.map(String).join(", ") : localize("SENDINGSTONE.Settings.None");
  }
  if ( (value === undefined) || (value === null) || (value === "") ) return MISSING;
  if ( (value === "all") && !Object.hasOwn(MIDI_OPTIONS, key) ) return localize("SENDINGSTONE.Settings.All");
  const prefix = MIDI_OPTIONS[key];
  const words = prefix ? `midi-qol.${prefix}.${value}` : null;
  if ( words && (game.i18n.has?.(words) === true) ) return localize(words);
  return String(value);
}

/**
 * A reason: a setting and its value.
 * @param {string} setting
 * @param {string} value
 * @returns {string}
 */
function reason(setting, value) {
  return game.i18n.format("SENDINGSTONE.Results.Why", { setting, value });
}

/**
 * Words in the game's language.
 * @param {string} key
 * @returns {string}
 */
function localize(key) {
  return game.i18n.localize(key);
}
