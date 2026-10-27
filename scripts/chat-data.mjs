import { MODULE_ID } from "./constants.mjs";
import { includeGmContent } from "./config.mjs";
import { campaignActors, charactersSeenBy, speakerCharacterId } from "./characters.mjs";
import { outcomeOf as attackOutcome } from "./command-uses.mjs";
import { messageCompanion } from "./creature-sync.mjs";
import {
  attacksShown, challengeAudience, gmRollTrim, midiCard, midiHighlightShown, midiHitsShown, midiSaveSeen,
  midiTotalShown, readSetting, resultRules, resultsTold
} from "./results.mjs";
import { traitLabel } from "./sheet-details.mjs";
import { localize } from "./sheet-values.mjs";

/**
 * Turning chat messages into plain data for the listener.
 */

/**
 * The abilities a check the app is told of may be made with: the six it knows.
 * @type {string[]}
 */
const SIX_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * The most checks an ask the app is told of offers. A card that asks for more asks nothing of it.
 * @type {number}
 */
const MOST_CHECKS = 10;

/**
 * A key dnd5e names a skill or tool by, as the app accepts one.
 * @type {RegExp}
 */
const CHECK_KEY = /^[A-Za-z][\w-]{0,31}$/;

/**
 * A content link as stored, unenriched, such as `@UUID[Actor.abc]{Thorin}`, to reduce to its label.
 * Bounded, and never reading on past the next `@`, so that no message, which anyone may write, can
 * make it take long.
 * @type {RegExp}
 */
const CONTENT_LINK = /@\w{1,50}\[[^\]@]{0,500}\]\{([^}@]{0,500})\}/g;

/**
 * The part of Midi-QOL's item card a damage roll on it belongs to, by the tag Midi gives the roll
 * (`options["midi-qol"].rollType`), as the listener is told it: the item's own damage, a bonus
 * macro's, or its other damage, as on a failed save.
 * @type {Record<string, string>}
 */
const MIDI_SECTIONS = { defaultDamage: "damage", bonusDamage: "bonus", otherDamage: "other" };

/**
 * dnd5e 6's kinds of chat message, by their `type`, each with its data in `system` rather than
 * dnd5e's flags (D6 data/chat-message/_module.mjs).
 * @type {Set<string>}
 */
const SYSTEM_TYPES = new Set([
  "attack", "bastionAttack", "bastionOrder", "bastionTurn", "check", "damage", "generic", "healing", "hitDie",
  "hitPoints", "item", "prompt", "recharge", "request", "rest", "save", "timePassed", "turn", "usage"
]);

/**
 * Midi-QOL's GM Attack Roll Display, each value of it, and GM Damage Roll Display's (MQX
 * lang_en.json:403-430). A value it adds later is trimmed as "hidden", the strictest.
 * @type {Set<string>}
 */
const ATTACK_DISPLAYS = new Set(["full", "hideFormula", "d20Only", "attackTotal", "hitMiss", "hitMissCrit", "hidden"]);
const DAMAGE_DISPLAYS = new Set(["full", "totalOnly", "hidden"]);

/**
 * The longest flavor a Gamemaster's damage folded into one, on Midi-QOL's card, goes with.
 * @type {number}
 */
const LONGEST_FLAVOR = 100;

/**
 * Which players can read a message, and which of a campaign's characters those players own.
 *
 * Gamemasters are left out of the reader list: they can read everything, so including them would
 * make every message look like it had an audience. A message with no player readers is
 * Gamemaster-only, which covers whispers to the Gamemaster, private Gamemaster rolls and blind
 * rolls, whose own author is not allowed to see the result.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @returns {{public: boolean, gmOnly: boolean, users: string[], characters: string[]}}
 */
export function chatAudience(message, campaign) {
  const whisper = Array.from(message.whisper ?? []);
  if ( !whisper.length ) {
    return { public: true, gmOnly: false, users: [], characters: campaignActors(campaign).map(actor => actor.id) };
  }

  const readers = new Set(whisper);
  const authorId = message.author?.id ?? message._source.author;
  if ( authorId && !message.blind ) readers.add(authorId);

  const users = Array.from(readers).filter(id => {
    const user = game.users.get(id);
    return user && !user.isGM;
  });
  return { public: false, gmOnly: users.length === 0, users, characters: charactersSeenBy(users, campaign) };
}

/**
 * May the listener be told about a message with this audience?
 * @param {{gmOnly: boolean}} audience
 * @returns {boolean}
 */
export function isAudienceShared(audience) {
  return !audience.gmOnly || includeGmContent();
}

/* -------------------------------------------- */

/**
 * Describe a chat message for a campaign. Since 0.36.0, for an app that reads companions, which of
 * their characters' companions it's a message of, `companion`, as `messageCompanion` has it; and to
 * every app, `alone` on a card made for the app's damage on its own, by the module's own flag. That's
 * a claim, as any user may flag a message of theirs, and the app takes it as one: it shows words
 * that apply nothing.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @param {object} [audience]   The message's audience in that campaign, if already computed.
 * @returns {object}
 */
export function serializeMessage(message, campaign, audience=chatAudience(message, campaign)) {
  // What players see of its results, and of a Gamemaster's rolls on Midi-QOL's card, as set now.
  const rules = resultRules();
  const trim = gmRollTrim(rules, message);
  const author = message.author;
  const speaker = message.speaker ?? {};
  const content = sharedContent(message, rules, trim);
  const companion = messageCompanion(message, campaign);
  return {
    id: message.id,
    uuid: message.uuid,
    type: message.type,
    style: styleName(message.style),
    timestamp: message.timestamp,
    author: author ? { id: author.id, name: author.name } : null,
    speaker: {
      alias: message.alias,
      actorId: speaker.actor ?? null,
      tokenId: speaker.token ?? null,
      sceneId: speaker.scene ?? null
    },
    character: speakerCharacterId(message, campaign),
    ...((companion !== undefined) && { companion }),
    ...((message.flags?.[MODULE_ID]?.alone === true) && { alone: true }),
    title: message.title || null,
    flavor: message.flavor ?? "",
    content,
    text: htmlToText(content, { challenge: challengeShown(message) }),
    ask: askOf(message),
    blind: message.blind,
    audience,
    rolls: trimRolls(message, message.rolls.map(summarizeRoll), trim),
    system: systemData(message, rules),
    dnd5e: dnd5eData(message, campaign, rules),
    ...gmRollOf(message)
  };
}

/**
 * The roll a message says the campaign's Gamemaster made from the app as a character, by its id,
 * as `gmRoll`: the roll it was made for, the use whose card it is, or the death save whose outcome
 * it tells. Its author may change its flags, so this is a claim, which the app checks against the
 * rolls it handed over, and since 0.25.0 against the messages each roll's result lists; a message
 * that makes none has no `gmRoll`.
 * @param {ChatMessage} message
 * @returns {{gmRoll?: string}}
 */
export function gmRollOf(message) {
  const flags = message.flags?.[MODULE_ID];
  if ( flags?.by !== "gm" ) return {};
  const id = [flags.request, flags.use, flags.outcome].find(value => typeof value === "string");
  return (id === undefined) ? {} : { gmRoll: id };
}

/* -------------------------------------------- */

/**
 * The name of a chat message style, such as "IC" or "OOC".
 * @param {number} style   A value of CONST.CHAT_MESSAGE_STYLES.
 * @returns {string|null}
 */
function styleName(style) {
  return Object.entries(CONST.CHAT_MESSAGE_STYLES).find(([, value]) => value === style)?.[0] ?? null;
}

/**
 * Reduce message HTML to readable plain text.
 *
 * Parsed into an inert document: content set on an element of the live page would load its images
 * and run its event handler attributes. Content links are stored unenriched, so they are reduced
 * to their labels. dnd5e's cards, such as a roll request or a spell's saving throw, hold the label
 * of each button twice, with its DC and without, and show one: only that one is kept.
 * @param {string} html
 * @param {object} [options]
 * @param {boolean} [options.challenge]   Do players see the message's DCs? Its labels without them
 *                                        are kept where they don't.
 * @returns {string}
 */
function htmlToText(html, { challenge=true }={}) {
  if ( !html ) return "";
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.body?.querySelectorAll?.(challenge ? ".hidden-dc" : ".visible-dc").forEach(label => label.remove());
  return (parsed.body?.textContent ?? "")
    .replace(CONTENT_LINK, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * May players see the DCs on a message's cards, and whether a roll met them, as dnd5e shows them to
 * players other than its author: as its Challenge Visibility has it, on everyone's messages, on
 * players' but not the Gamemaster's, or on no one's.
 * @param {ChatMessage} message
 * @returns {boolean}
 */
function challengeShown(message) {
  const visibility = readSetting("dnd5e", "challengeVisibility");
  if ( visibility === "all" ) return true;
  if ( visibility === "player" ) return !message.author?.isGM;
  return false;
}

/**
 * A message's content as the listener is told it, since module 0.29.0: unless Gamemaster-only
 * information is being sent, without what dnd5e's and Midi-QOL's cards keep from players, which
 * the content holds for the Gamemaster's client to show and players' clients to hide. Parsed into
 * an inert document, as `htmlToText` parses it: Midi's sections of hits and saves are emptied,
 * being drawn on the client that ran its workflow, often the Gamemaster's, with armor classes and
 * DCs; every button's DC, `data-dc`, goes; and so do dnd5e's labels with DCs, where players may not
 * see them, as `challengeShown` has it. The module reads every card it acts on from the message
 * itself, never this. Since 0.30.0, a Gamemaster's card of Midi-QOL's goes without what its GM
 * Attack Roll Display and GM Damage Roll Display keep from players, as `trimContent` has it.
 * @param {ChatMessage} message
 * @param {ResultRules} [rules]
 * @param {object|null} [trim]   How a Gamemaster's rolls on it are trimmed, as `gmRollTrim` has it.
 * @returns {string}
 */
function sharedContent(message, rules=resultRules(), trim=null) {
  const content = message.content ?? "";
  if ( (typeof content !== "string") || !content || rules.gmContent ) return content;
  const body = new DOMParser().parseFromString(content, "text/html").body;
  if ( !body ) return "";
  for ( const section of body.querySelectorAll(".midi-qol-hits-display, .midi-qol-saves-display") ) {
    section.replaceChildren();
  }
  body.querySelectorAll("[data-dc]").forEach(element => element.removeAttribute("data-dc"));
  if ( !challengeShown(message) ) body.querySelectorAll(".visible-dc").forEach(label => label.remove());
  if ( trim ) trimContent(body, trim);
  return body.innerHTML;
}

/**
 * Take from a Gamemaster's card of Midi-QOL's what Midi keeps from players by its GM displays (MQX
 * ChatMessageMidi:600-620; templates_activity-card.hbs:121-160): each trimmed section's dice rolls,
 * which hold its formula, dice and total, and with the attack's, Midi's attribution. And always its
 * attack and damage buttons, which Midi hides from players who didn't write the card unless they
 * own its actor and save to it (:635-639), and whose damage button reads "Critical" on a critical.
 * What players do see of the rolls goes in `rolls`.
 * @param {HTMLElement} body
 * @param {{attack: string, damage: string}} trim
 * @returns {void}
 */
function trimContent(body, trim) {
  const remove = selector => body.querySelectorAll(selector).forEach(element => element.remove());
  if ( trim.attack !== "full" ) remove(".midi-qol-attack-roll .dice-roll, .midi-attribution-info");
  if ( trim.damage !== "full" ) {
    remove([".midi-qol-damage-roll", ".midi-qol-other-damage-roll", ".midi-qol-bonus-damage-roll"]
      .map(section => `${section} .dice-roll`).join(", "));
  }
  remove(".midi-qol-attack-buttons, .midi-qol-damage-buttons, .midi-qol-otherDamage-button");
}

/* -------------------------------------------- */
/*  Cards that ask for a save or check          */
/* -------------------------------------------- */

/**
 * A save a chat card asks for, as its buttons have it, before it's known whom it asks.
 * @typedef {object} AskedSave
 * @property {"concentration"|"save"|"request"} source   dnd5e's concentration card, a save's
 *                                                        card, or a request posted in chat.
 * @property {"save"|"concentration"} type
 * @property {string[]} abilities   The abilities its buttons offer; for concentration, the one it
 *                                  names, if any.
 * @property {number|null} dc
 * @property {boolean} hideDC       Does the card keep its DC from everyone, as dnd5e's request for a
 *                                  link whose author hid it does? Its DC is then for rolling against
 *                                  alone.
 */

/**
 * The save a chat card asks for, if it asks for one: as dnd5e's buttons for it say.
 * @param {ChatMessage} message
 * @returns {AskedSave|null}
 */
export function askedSave(message) {
  const content = message.content;
  if ( (game.system.id !== "dnd5e") || (typeof content !== "string") || !content.includes("data-action") ) return null;
  const parsed = new DOMParser().parseFromString(content, "text/html");
  const buttons = Array.from(parsed.querySelectorAll("button[data-action]"));
  const concentration = buttons.find(({ dataset }) => (dataset.action === "concentration")
    && (dataset.type === "concentration"));
  if ( concentration ) return asked("concentration", "concentration", [concentration]);
  const saves = buttons.filter(({ dataset }) => dataset.action === "rollSave");
  if ( saves.length ) return asked("save", "save", saves);
  const requests = buttons.filter(({ dataset }) => (dataset.action === "rollRequest")
    && ["save", "concentration"].includes(dataset.type));
  if ( requests.length ) {
    const type = requests[0].dataset.type;
    return asked("request", type, requests.filter(request => request.dataset.type === type));
  }
  return null;
}

/**
 * The save some buttons ask for: only the abilities dnd5e has, never a name any object answers to,
 * such as "constructor", which anyone posting a card could write in.
 * @param {AskedSave["source"]} source
 * @param {AskedSave["type"]} type
 * @param {HTMLButtonElement[]} buttons
 * @returns {AskedSave}
 */
function asked(source, type, buttons) {
  const abilities = buttons.map(({ dataset: { ability } }) => ability)
    .filter(ability => Object.hasOwn(CONFIG.DND5E?.abilities ?? {}, ability));
  const dc = Number.parseInt(buttons[0].dataset.dc);
  return {
    source, type,
    abilities: Array.from(new Set(abilities)),
    dc: Number.isFinite(dc) ? dc : null,
    hideDC: buttons.some(dcHidden)
  };
}

/**
 * Does a button keep its DC from everyone? As dnd5e's request for a link whose author hid its DC
 * does, marking it so, and labelling it without the DC both for those who may see DCs and for
 * those who may not; or as any card that labels it the same either way.
 * @param {HTMLButtonElement} button
 * @returns {boolean}
 */
function dcHidden(button) {
  if ( button.dataset.hideDc === "true" ) return true;
  const shown = button.querySelector(".visible-dc");
  const hidden = button.querySelector(".hidden-dc");
  return Boolean(shown && hidden) && (shown.textContent.trim() === hidden.textContent.trim());
}

/**
 * A check a roll request card asks the table for, as its buttons have it.
 * @typedef {object} AskedCheck
 * @property {{type: string, ability: string, skill?: string, tool?: string, name?: string}[]} checks
 *   The checks its buttons offer: an ability check, or a skill or tool check, with the ability
 *   it's made with; a tool with its name.
 * @property {number|null} dc
 * @property {boolean} hideDC   Does the card keep its DC from everyone? As for a save.
 */

/**
 * The check a roll request card asks for, if it asks for one: as dnd5e's buttons for it say, each
 * an ability, skill or tool check dnd5e has, by a key the app accepts, with one of the six
 * abilities, its own or else the skill's or tool's, as dnd5e's request makes it; each check once.
 * Never a name any object answers to, which anyone posting a card could write in. Null for any
 * other card, and for one that offers more checks than the app is told of.
 * @param {ChatMessage} message
 * @returns {AskedCheck|null}
 */
function askedCheck(message) {
  const content = message.content;
  if ( (game.system.id !== "dnd5e") || (typeof content !== "string") || !content.includes("rollRequest") ) return null;
  const parsed = new DOMParser().parseFromString(content, "text/html");
  const buttons = Array.from(parsed.querySelectorAll("button[data-action]")).filter(({ dataset }) => {
    return (dataset.action === "rollRequest") && ["check", "skill", "tool"].includes(dataset.type);
  });
  const config = CONFIG.DND5E ?? {};
  const own = (list, key) => ((typeof key === "string") && CHECK_KEY.test(key) && Object.hasOwn(list ?? {}, key))
    ? list[key] : null;
  const known = new Set();
  const checks = [];
  for ( const { dataset } of buttons ) {
    const { type } = dataset;
    const key = (type === "skill") ? dataset.skill : ((type === "tool") ? dataset.tool : null);
    const entry = (type === "skill") ? own(config.skills, key)
      : ((type === "tool") ? (own(config.tools, key) ?? own(config.vehicleTypes, key)) : true);
    const ability = dataset.ability || entry?.ability;
    if ( !entry || !SIX_ABILITIES.includes(ability) || !Object.hasOwn(config.abilities ?? {}, ability) ) continue;
    const id = (type === "check") ? `check:${ability}` : `${type}:${key}`;
    if ( known.has(id) ) continue;
    known.add(id);
    if ( type === "check" ) checks.push({ type, ability });
    else if ( type === "skill" ) checks.push({ type, ability, skill: key });
    else checks.push({ type, ability, tool: key, name: traitLabel(key, "tool") });
  }
  if ( !checks.length || (checks.length > MOST_CHECKS) ) return null;
  const dc = Number.parseInt(buttons[0].dataset.dc);
  return { checks, dc: Number.isFinite(dc) ? dc : null, hideDC: buttons.some(dcHidden) };
}

/**
 * The save or check a roll request card asks the table for, as the app shows it: the Gamemaster's,
 * posted from a description, or a player's, posted from the app. Its DC only where players may see
 * it, as dnd5e shows it: never one the card keeps from everyone; and for a player's, what asks for
 * it, such as their item. Null for any other message.
 * @param {ChatMessage} message
 * @returns {{type: string, abilities?: string[], checks?: object[], dc?: number, label?: string}|null}
 */
function askOf(message) {
  const save = askedSave(message);
  const check = save ? null : askedCheck(message);
  if ( (save?.source !== "request") && !check ) return null;
  const asked = save ?? check;
  const label = askLabel(message);
  return {
    ...(save ? { type: save.type, abilities: save.abilities } : { type: "check", checks: check.checks }),
    ...(((asked.dc !== null) && !asked.hideDC && challengeShown(message)) && { dc: asked.dc }),
    ...(label && { label })
  };
}

/**
 * The flavor of a roll request card posted for a player from the app: dnd5e's "Roll Request",
 * then what asks for the save or check, such as their item, its name escaped, being one players
 * may write.
 * @param {string} name
 * @returns {string}
 */
export function askFlavor(name) {
  return `${game.i18n.localize("EDITOR.DND5E.Inline.RollRequest")}: ${foundry.utils.escapeHTML(String(name))}`;
}

/**
 * What asks for the save or check on a roll request card posted for a player from the app, read
 * back from its flavor. Null for any other card.
 * @param {ChatMessage} message
 * @returns {string|null}
 */
function askLabel(message) {
  if ( !message.flags?.[MODULE_ID]?.ask ) return null;
  const prefix = `${game.i18n.localize("EDITOR.DND5E.Inline.RollRequest")}: `;
  const flavor = htmlToText(message.flavor);
  return flavor.startsWith(prefix) ? (flavor.slice(prefix.length) || null) : null;
}

/* -------------------------------------------- */

/**
 * Read a boolean getter from a roll, if the roll's class defines one. Some throw rather than
 * return when the roll is not of the shape they expect.
 * @param {Roll} roll
 * @param {string} property
 * @returns {boolean|undefined}
 */
function readFlag(roll, property) {
  try {
    const value = roll[property];
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Describe a roll: its formula, total and every die result; and since module 0.28.0, what it is
 * among the rolls of a message, so that a listener can show a message's damage as one: whether
 * it's damage, the words for its type, its part of Midi-QOL's item card and a bonus's name, and
 * whether it's the attack.
 *
 * Each of those is read from the roll alone, never from a Midi-QOL workflow, so a message sent
 * again after a reload, or by a Gamemaster's client that never ran the workflow, says the same:
 * Foundry keeps a roll's options in the message. Midi's `useOther`, which draws a card's own
 * damage as its other damage, lives only on the live workflow, so it's never followed.
 *
 * Success and failure against a target are deliberately left out: they reveal the difficulty,
 * which D&D Fifth Edition lets the Gamemaster keep from players.
 * @param {Roll} roll
 * @returns {object}
 */
export function summarizeRoll(roll) {
  const summary = {
    class: roll.constructor.name,
    formula: roll.formula,
    total: Number.isFinite(roll.total) ? roll.total : null,
    dice: roll.dice.map(die => ({
      expression: die.expression,
      faces: die.faces,
      number: die.number,
      results: (die.results ?? []).map(result => ({ result: result.result, active: result.active !== false }))
    }))
  };

  // Defined by D&D Fifth Edition's roll classes; absent, and so omitted, elsewhere.
  const flags = {
    advantage: "hasAdvantage",
    disadvantage: "hasDisadvantage",
    critical: "isCritical",
    fumble: "isFumble"
  };
  for ( const [key, property] of Object.entries(flags) ) {
    const value = readFlag(roll, property);
    if ( value !== undefined ) summary[key] = value;
  }
  const DamageRoll = CONFIG.Dice.DamageRoll;
  const damage = Boolean(DamageRoll) && (roll instanceof DamageRoll);
  if ( damage ) summary.damage = true;
  if ( damage && roll.options?.type ) {
    summary.damageType = roll.options.type;
    const label = damageLabel(roll.options.type);
    if ( label ) summary.damageLabel = label;
  }

  const options = roll.options ?? {};
  const midiType = options["midi-qol"]?.rollType;
  const section = Object.hasOwn(MIDI_SECTIONS, midiType) ? MIDI_SECTIONS[midiType] : null;
  if ( section ) summary.section = section;
  const flavor = (section === "bonus") ? bonusFlavor(options) : null;
  if ( flavor ) summary.flavor = flavor;
  if ( isAttackRoll(roll) ) summary.attack = true;
  return summary;
}

/**
 * Is a roll the attack among a message's rolls: by Midi-QOL's tag on the attack it writes on its
 * card, or dnd5e's own kind of roll, which it copies from its attack message's flags to each roll?
 * @param {Roll} roll
 * @returns {boolean}
 */
function isAttackRoll(roll) {
  const options = roll?.options ?? {};
  return (options["midi-qol"]?.rollType === "attack") || (options.rollType === "attack");
}

/**
 * The words dnd5e's damage card names a kind of damage or healing by, such as "Piercing" or "Temp
 * HP": its short label where it has one, as the card's breakdown has it, in the game's language.
 * Empty for a type dnd5e doesn't have, never one named after what any object answers to.
 * @param {string} type   dnd5e's key for it, such as "piercing" or "temphp".
 * @returns {string}
 */
function damageLabel(type) {
  if ( typeof type !== "string" ) return "";
  const own = list => (Object.hasOwn(list ?? {}, type) ? list[type] : undefined);
  const config = own(CONFIG.DND5E?.damageTypes) ?? own(CONFIG.DND5E?.healingTypes);
  const key = config?.labelShort ?? config?.label;
  if ( typeof key !== "string" ) return "";
  const label = localize(key);
  return (typeof label === "string") ? label.trim() : "";
}

/**
 * The name of the bonus a macro added to damage on Midi-QOL's card, such as "Sneak Attack", from
 * the roll's flavor. Midi fills in the damage's type where the macro names none, which is no name:
 * a flavor that is its own type, or any of dnd5e's damage or healing types, is left out.
 * @param {object} options   The roll's options.
 * @returns {string|null}
 */
function bonusFlavor(options) {
  const flavor = (typeof options.flavor === "string") ? options.flavor.trim() : "";
  if ( !flavor ) return null;
  const key = flavor.toLowerCase();
  const types = [CONFIG.DND5E?.damageTypes, CONFIG.DND5E?.healingTypes];
  if ( (key === options.type) || types.some(list => Object.hasOwn(list ?? {}, key)) ) return null;
  return flavor;
}

/* -------------------------------------------- */
/*  A Gamemaster's rolls on Midi-QOL's card     */
/* -------------------------------------------- */

/**
 * A message's rolls as the listener is told them, since module 0.30.0: on a Gamemaster's card of
 * Midi-QOL's, with Gamemaster-only information off, as Midi's GM Attack Roll Display and GM Damage
 * Roll Display show them to players (MQX ChatMessageMidi:297-367, 560-621), and never more than
 * their own words say they do. Every key stays, and its type: what's gone is an empty formula, no
 * dice, or no total. Every other message's rolls are as they were.
 * @param {ChatMessage} message
 * @param {object[]} summaries   Its rolls, as `summarizeRoll` describes them.
 * @param {object|null} trim     As `gmRollTrim` has it; null for none.
 * @returns {object[]}
 */
function trimRolls(message, summaries, trim) {
  if ( !trim ) return summaries;
  const rolls = message.rolls ?? [];
  const flags = message.flags?.["midi-qol"] ?? {};
  const trimmed = summaries.map((summary, index) => ((summary.attack === true)
    ? trimAttack(summary, rolls[index], trim, flags) : summary));
  // Midi draws no critical mark on damage: one shows only where the attack's does.
  const critical = trimmed.some(summary => (summary.attack === true) && (summary.critical === true));
  const damage = DAMAGE_DISPLAYS.has(trim.damage) ? trim.damage : "hidden";
  const shown = trimmed.map((summary, index) => {
    if ( summary.damage !== true ) return summary;
    const out = { ...summary };
    if ( "critical" in out ) out.critical = (out.critical === true) && critical;
    if ( damage === "full" ) return out;
    out.formula = "";
    out.dice = [];
    if ( damage === "hidden" ) out.total = null;
    else if ( trim.merge ) out.total = positiveTotal([rolls[index]]);
    return out;
  });
  if ( (damage === "full") || trim.merge ) return shown;
  return foldSections(shown, rolls, damage);
}

/**
 * An attack roll on a Gamemaster's card of Midi-QOL's, as its GM Attack Roll Display shows it:
 * its formula, dice and total, each where shown; its critical and fumble only where Midi marks the
 * total (`trim.marked`), or its hits section's ✓✓ shows a critical; and its advantage, which its
 * label shows, unless Midi's fake dice make the label read "Attack" whatever it was.
 * @param {object} summary
 * @param {Roll} roll
 * @param {{attack: string, marked: boolean, hits: boolean, fake: boolean}} trim
 * @param {object} flags   The card's Midi-QOL flags.
 * @returns {object}
 */
function trimAttack(summary, roll, trim, flags) {
  const display = ATTACK_DISPLAYS.has(trim.attack) ? trim.attack : "hidden";
  if ( display === "full" ) return summary;
  const out = { ...summary, formula: "", dice: [] };
  if ( display === "d20Only" ) {
    // The one number Midi shows: the first term's total, never how many d20s made it.
    const shown = Number(roll?.terms?.[0]?.total);
    out.dice = Number.isFinite(shown)
      ? [{ expression: "d20", faces: 20, number: 1, results: [{ result: shown, active: true }] }] : [];
    out.total = null;
  }
  else if ( ["hitMiss", "hitMissCrit", "hidden"].includes(display) ) out.total = null;

  const marked = value => trim.marked && (value === true);
  let critical = false;
  let fumble = false;
  if ( display === "hitMissCrit" ) {
    critical = (flags.isCritical === true) || marked(summary.critical);
    fumble = !critical && ((flags.isFumble === true) || marked(summary.fumble));
  }
  else if ( !["hitMiss", "hidden"].includes(display) ) {
    // The hits section draws a critical's rows ✓✓, outside Hit/Miss Only and Hidden (MQX Workflow:7465-7467).
    const aimed = Array.isArray(flags.targets) && (flags.targets.length > 0);
    critical = marked(summary.critical) || (trim.hits && aimed && (flags.isCritical === true));
    fumble = marked(summary.fumble);
  }
  if ( ("critical" in summary) || critical ) out.critical = critical;
  if ( ("fumble" in summary) || fumble ) out.fumble = fumble;
  if ( trim.fake ) {
    if ( "advantage" in out ) out.advantage = false;
    if ( "disadvantage" in out ) out.disadvantage = false;
  }
  return out;
}

/**
 * A Gamemaster's damage on Midi-QOL's card, each section of it one roll, as Midi draws a section
 * with GM Damage Roll Display trimming it and its rolls not each shown apart (MQX
 * ChatMessageMidi:303-313, 393-413): in its first roll's place, of its kind and section, its total
 * the section's, as Midi adds it, or none where hidden; its type only where every roll in it has
 * the one; and its bonuses' names.
 * @param {object[]} summaries   The rolls, as trimmed.
 * @param {Roll[]} rolls         The message's, in the same order.
 * @param {"totalOnly"|"hidden"} display
 * @returns {object[]}
 */
function foldSections(summaries, rolls, display) {
  const sections = new Map();
  summaries.forEach((summary, index) => {
    if ( summary.damage !== true ) return;
    const key = summary.section ?? null;
    if ( !sections.has(key) ) sections.set(key, []);
    sections.get(key).push(index);
  });
  const folded = new Map();
  for ( const indices of sections.values() ) {
    const parts = indices.map(index => summaries[index]);
    const [first] = parts;
    const types = new Set(parts.map(part => part.damageType ?? null));
    const flavor = parts.map(part => part.flavor).filter(Boolean).join(", ").slice(0, LONGEST_FLAVOR);
    const typed = (types.size === 1) && first.damageType;
    folded.set(indices[0], {
      class: first.class,
      formula: "",
      total: (display === "hidden") ? null : positiveTotal(indices.map(index => rolls[index])),
      dice: [],
      ...(("critical" in first) && { critical: parts.some(part => part.critical === true) }),
      damage: true,
      ...(typed && { damageType: first.damageType, ...(first.damageLabel && { damageLabel: first.damageLabel }) }),
      ...(first.section && { section: first.section }),
      ...(flavor && { flavor })
    });
    for ( const index of indices.slice(1) ) folded.set(index, null);
  }
  return summaries.flatMap((summary, index) => {
    if ( !folded.has(index) ) return [summary];
    const one = folded.get(index);
    return one ? [one] : [];
  });
}

/**
 * Damage as Midi-QOL adds it on its card: by type, as dnd5e's aggregateDamageRolls splits it, a part
 * below zero counted as none (MQX ChatMessageMidi:306-312). Null where a total isn't known.
 * @param {Roll[]} rolls
 * @returns {number|null}
 */
function positiveTotal(rolls) {
  let parts = null;
  try {
    parts = globalThis.dnd5e?.dice?.aggregateDamageRolls?.(rolls.filter(Boolean)) ?? null;
  } catch {
    parts = null;
  }
  const list = Array.isArray(parts) ? parts : rolls;
  let total = 0;
  for ( const part of list ) {
    if ( !Number.isFinite(part?.total) ) return null;
    total += Math.max(0, part.total);
  }
  return total;
}

/* -------------------------------------------- */

/**
 * The data of a system-defined message subtype, such as D&D Fifth Edition's usage, turn and rest
 * cards. Null for an ordinary message. Since 0.30.0, unless Gamemaster-only information is being
 * sent, without what dnd5e keeps from players there, as its content goes without it: each target's
 * armor class, each button's DC, a button's label with its DC where players may not see DCs, as
 * `challengeShown` has it, and a request's DC and target, whatever dnd5e's version. A button's DC
 * is in its dataset on a usage card, and on the button itself on dnd5e 6's prompts, its roll
 * requests and concentration checks (D6 data/chat-message/prompt-message-data.mjs:49-56), whose
 * labels each client draws for itself, with the DC only where it shows them (:96-103).
 * @param {ChatMessage} message
 * @param {ResultRules} rules
 * @returns {object|null}
 */
function systemData(message, rules) {
  if ( message.type === CONST.BASE_DOCUMENT_TYPE ) return null;
  let data;
  try {
    data = message.system?.toObject?.() ?? null;
  } catch {
    return null;
  }
  if ( !data || (typeof data !== "object") || rules.gmContent ) return data;
  const shared = foundry.utils.deepClone(data);
  const challenge = challengeShown(message);
  for ( const target of Array.isArray(shared.targets) ? shared.targets : [] ) {
    if ( target && (typeof target === "object") ) delete target.ac;
  }
  for ( const button of Array.isArray(shared.buttons) ? shared.buttons : [] ) {
    if ( !button || (typeof button !== "object") ) continue;
    delete button.dc;
    if ( button.dataset && (typeof button.dataset === "object") ) delete button.dataset.dc;
    const label = button.label;
    // As dnd5e draws it for them: the label it has without the DC, or where that's blank, its only
    // one (D6 usage-message-data.mjs:265-267).
    if ( !challenge && label && (typeof label === "object") ) label.value = label.hidden || label.value;
  }
  if ( shared.data && (typeof shared.data === "object") ) {
    delete shared.data.dc;
    delete shared.data.target;
  }
  return shared;
}

/* -------------------------------------------- */

/**
 * Where D&D Fifth Edition records what a message is: dnd5e 5's flags, or since 0.30.0 dnd5e 6's
 * typed message, which keeps it in `system` (D6 data/chat-message/_module.mjs).
 * @typedef {object} Dnd5eSource
 * @property {"flags"|"system"} from
 * @property {string|null} messageType
 * @property {{type: string|null}|null} roll   The kind of roll, as dnd5e 5's flags name it.
 * @property {object|null} item
 * @property {object|null} activity
 * @property {{name: string, uuid: string, ac: number|null}[]} targets
 * @property {ChatMessage|null} origin          The card it was rolled from, if still there.
 * @property {string|null} originatingMessage   That card's id.
 * @property {boolean} forceSuccess             A legendary resistance's forced success.
 */

/**
 * What D&D Fifth Edition records of a message: from dnd5e 5's flags where they say what it is, from
 * dnd5e 6's typed message otherwise, and from such flags as there are else. Null for none.
 * @param {ChatMessage} message
 * @returns {Dnd5eSource|null}
 */
export function dnd5eSource(message) {
  const flags = message.flags?.dnd5e;
  const own = (flags && (typeof flags === "object")) ? flags : null;
  const said = own && ["roll", "messageType", "targets"].some(key => own[key] !== undefined);
  if ( !said && systemTyped(message) ) return systemSource(message);
  if ( !own ) return null;
  const originatingMessage = (typeof own.originatingMessage === "string") ? own.originatingMessage : null;
  return {
    from: "flags",
    messageType: own.messageType ?? null,
    roll: own.roll ?? null,
    item: own.item ?? null,
    activity: own.activity ?? null,
    targets: Array.isArray(own.targets) ? own.targets : [],
    origin: originatingMessage ? (game.messages?.get(originatingMessage) ?? null) : null,
    originatingMessage,
    forceSuccess: own.roll?.forceSuccess === true
  };
}

/**
 * The armor class of each target a dnd5e card names, by its actor's uuid, as dnd5e and Midi-QOL
 * write it on the card, dnd5e 6's in `system`: null for one under total cover; none for one of no
 * armor class at all. Since 0.31.0, for judging the app's own attack through Midi-QOL where Midi
 * checks no hits, with the results told always.
 * @param {ChatMessage|null|undefined} message
 * @returns {Map<string, number|null>}
 */
export function cardTargetAcs(message) {
  const targets = (message ? dnd5eSource(message)?.targets : null) ?? [];
  return new Map(targets
    .map(({ uuid, ac }) => [uuid, (ac === null) ? null : (Number.isFinite(ac) ? ac : undefined)])
    .filter(([uuid, ac]) => (typeof uuid === "string") && (ac !== undefined)));
}

/**
 * Is a message one of dnd5e 6's typed ones, with what it is in `system`?
 * @param {ChatMessage} message
 * @returns {boolean}
 */
function systemTyped(message) {
  if ( !(Number.parseInt(game.system?.version) >= 6) ) return false;
  return SYSTEM_TYPES.has(message.type) && Boolean(message.system) && (typeof message.system === "object");
}

/**
 * What dnd5e 6 records of a typed message, as dnd5e 5's flags named it: the kind of roll by the
 * message's type, and the save's or check's own, its targets, the card it was rolled from
 * (`system.origin`, else dnd5e's flag, D6 documents/chat-message.mjs:770-772), and a legendary
 * resistance's forced success.
 * @param {ChatMessage} message
 * @returns {Dnd5eSource}
 */
function systemSource(message) {
  const system = message.system;
  const origin = system.origin;
  const flagged = message.flags?.dnd5e?.originatingMessage;
  const originatingMessage = (typeof origin === "string") ? origin
    : (origin?.id ?? ((typeof flagged === "string") ? flagged : null));
  const type = systemRollType(message.type, system);
  const roll = type ? {
    type,
    ...(system.ability && { ability: system.ability }),
    ...(system.skill && { skillId: system.skill }),
    ...(system.tool && { toolId: system.tool })
  } : null;
  return {
    from: "system",
    messageType: message.type,
    roll,
    item: system.item ?? null,
    activity: system.activity ?? null,
    targets: (Array.isArray(system.targets) ? system.targets : [])
      .map(target => ({ name: target?.name, uuid: target?.actor, ac: target?.ac })),
    origin: ((origin && (typeof origin === "object")) ? origin : null)
      ?? (originatingMessage ? (game.messages?.get(originatingMessage) ?? null) : null),
    originatingMessage,
    forceSuccess: system.forceSuccess === true
  };
}

/**
 * The kind of roll a dnd5e 6 message is, as dnd5e 5's flags name it: an attack, damage or healing;
 * a save, concentration's among them, or a death save; an ability, skill or tool check, never
 * initiative; or a hit die. Null for anything else.
 * @param {string} type     The message's.
 * @param {object} system   Its data.
 * @returns {string|null}
 */
function systemRollType(type, system) {
  switch ( type ) {
    case "attack": case "damage": case "healing": case "hitDie": return type;
    case "save": {
      const kind = system.type ?? "ability";
      if ( kind === "death" ) return "death";
      return ["ability", "concentration"].includes(kind) ? "save" : null;
    }
    case "check":
      if ( (system.type ?? "ability") !== "ability" ) return null;
      return system.skill ? "skill" : (system.tool ? "tool" : "ability");
    default: return null;
  }
}

/**
 * What D&D Fifth Edition records about where a message came from: the kind of roll, and the item,
 * activity and targets involved; and since module 0.29.0, whether an attack hit each target, and
 * whether each saved against Midi-QOL's card, and for a save, whose save it is and whether it
 * succeeded, as `targetResults` and `rollResult` have them: each only where players see it in
 * Foundry, unless Gamemaster-only information is being sent. Since 0.30.0, the same of a check, in
 * `check`; and under dnd5e 6 too. Null under any other system, or for a message it did not create.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @param {ResultRules} rules
 * @returns {object|null}
 */
function dnd5eData(message, campaign, rules) {
  if ( game.system.id !== "dnd5e" ) return null;
  const src = dnd5eSource(message);
  if ( !src ) return null;

  const resolve = getter => {
    try {
      return getter() ?? null;
    } catch {
      return null;
    }
  };
  const item = resolve(() => message.getAssociatedItem?.());
  const activity = resolve(() => message.getAssociatedActivity?.());

  // A target's armor class is shown only to the Gamemaster unless the world chooses otherwise.
  const gmContent = rules.gmContent;
  const results = targetResults(message, src, rules);
  const targets = src.targets.map(({ name, uuid, ac }, index) => ({
    ...(gmContent ? { name, uuid, ac: ac ?? null } : { name, uuid }),
    ...results[index]
  }));
  const result = rollResult(message, campaign, rules, src);

  return {
    messageType: src.messageType ?? null,
    roll: src.roll ? foundry.utils.deepClone(src.roll) : null,
    item: (src.item || item) ? {
      id: src.item?.id ?? item?.id ?? null,
      uuid: src.item?.uuid ?? item?.uuid ?? null,
      type: src.item?.type ?? item?.type ?? null,
      name: item?.name ?? null
    } : null,
    activity: (src.activity || activity) ? {
      id: src.activity?.id ?? activity?.id ?? null,
      uuid: src.activity?.uuid ?? activity?.uuid ?? null,
      type: src.activity?.type ?? activity?.type ?? null,
      name: activity?.name ?? null
    } : null,
    targets,
    originatingMessage: src.originatingMessage ?? null,
    ...(result && { [result.field]: result.value })
  };
}

/* -------------------------------------------- */
/*  Hits, misses, saves and checks              */
/* -------------------------------------------- */

/**
 * Whether players may see what Foundry decided of a message's targets, by the kind of check:
 * what's decided is sent only where it's so, and only where players see it in Foundry, unless
 * Gamemaster-only information is being sent, when everything decided is, as armor class is. The
 * settings are read as the message is sent: one changed later sends no message again.
 *
 * Each target of the message's own, in the order it names them: dnd5e's attack's, hit or missed,
 * `outcome`; or on Midi-QOL's card, hit or missed, and saved or not, `save`, as Midi draws them for
 * players (results.mjs). Nothing on a roll Midi shows players as "??".
 * @param {ChatMessage} message
 * @param {Dnd5eSource} src
 * @param {ResultRules} rules
 * @returns {object[]}   For each target, `{outcome?, save?}`.
 */
function targetResults(message, src, rules) {
  const targets = src.targets;
  const none = targets.map(() => ({}));
  if ( !targets.length || (!rules.gmContent && obscured(message)) ) return none;
  if ( !midiCard(message) ) return attackResults(message, src, rules) ?? none;
  const hits = midiHits(message, targets, rules);
  const saves = midiSaves(message, targets, rules);
  return targets.map((_, index) => ({ ...hits?.[index], ...saves?.[index] }));
}

/**
 * Whether a dnd5e attack hit each of its targets, as dnd5e's card draws it: a critical hit always
 * does; a fumble, or a total under its armor class, misses. One under total cover, of no armor
 * class, is drawn as dnd5e's version draws it (F5): dnd5e 5, comparing the total with null, as hit
 * unless a fumble (D5 documents/chat-message.mjs:463); dnd5e 6 as missed (D6
 * data/chat-message/attack-message-data.mjs:95). Seen by players only while dnd5e's Attack Result
 * Visibility shows them, "Show only results" or "Show results & target ACs". While Midi-QOL is
 * active, which draws no tray of targets on any message, only an attack at one target, by dnd5e's
 * own highlight of its total (F7). Since 0.31.0, told always, every target by its armor class, as
 * with GM-only details.
 * @param {ChatMessage} message
 * @param {Dnd5eSource} src
 * @param {ResultRules} rules
 * @returns {object[]|null}   Null where nothing is told.
 */
function attackResults(message, src, rules) {
  const [roll] = message.rolls ?? [];
  const D20Roll = CONFIG.Dice?.D20Roll;
  if ( (src.roll?.type !== "attack") || !D20Roll || !(roll instanceof D20Roll) ) return null;
  if ( !Number.isFinite(roll.total) || !attacksShown(rules) ) return null;
  if ( (rules.midi !== null) && !resultsTold(rules) ) return highlightedAttack(roll, src.targets, rules);
  return src.targets.map(({ ac }) => {
    if ( ac === null ) return { outcome: coveredOutcome(roll, src) };
    return Number.isFinite(ac) ? { outcome: attackOutcome(roll, { ac }) } : {};
  });
}

/**
 * Whether an attack hit a target under total cover, as dnd5e's card draws it, by its version: under
 * dnd5e 5's flags, its test `!critical && (total < null || fumble)`, as against 0; under dnd5e 6,
 * a miss. The app's own attacks are judged as Midi-QOL has it, a miss either way (`outcomeOf`).
 * @param {Roll} roll
 * @param {Dnd5eSource} src
 * @returns {"hit"|"miss"}
 */
function coveredOutcome(roll, src) {
  if ( src.from === "system" ) return "miss";
  const miss = !roll.isCritical && ((roll.total < 0) || roll.isFumble);
  return miss ? "miss" : "hit";
}

/**
 * A dnd5e attack in a world with Midi-QOL, as players see it: Midi draws no tray of targets on any
 * message (MQX ChatMessageMidi:194-219), which leaves dnd5e's highlight of the total, against the
 * one target it has (D5 documents/chat-message.mjs:236-246), as Midi leaves that (:494, 547-556).
 * So only an attack at one target, whose d20 has its armor class, of one d20 dnd5e judges; and none
 * under total cover, which gives the d20 no target.
 * @param {Roll} roll
 * @param {object[]} targets
 * @param {ResultRules} rules
 * @returns {object[]}
 */
function highlightedAttack(roll, targets, rules) {
  const none = targets.map(() => ({}));
  if ( !midiHighlightShown(rules) || (targets.length !== 1) ) return none;
  const ac = d20Target(roll);
  if ( (ac === null) || !plainD20(roll) ) return none;
  return [{ outcome: attackOutcome(roll, { ac }) }];
}

/**
 * The target of a roll's d20, its armor class or DC, where it has one, as dnd5e gives it one for an
 * attack at a single target (D5 documents/activity/attack.mjs:101; dice/d20-roll.mjs:236).
 * @param {Roll|null|undefined} roll
 * @returns {number|null}
 */
function d20Target(roll) {
  const target = roll?.dice?.[0]?.options?.target;
  return (Number.isFinite(target) && (target !== 0)) ? target : null;
}

/**
 * Is a roll's first die one d20, unmodified, as dnd5e tests a roll before it marks it (D5
 * documents/chat-message.mjs:227-234)?
 * @param {Roll} roll
 * @returns {boolean}
 */
function plainD20(roll) {
  const die = roll?.dice?.[0];
  if ( (die?.faces !== 20) || (die.values?.length !== 1) ) return false;
  const first = die.results?.[0];
  return Boolean(first) && !("success" in first) && !die.options?.marginSuccess && !die.options?.marginFailure;
}

/**
 * Does Midi-QOL mark a roll's total at all: one it takes for a d20 roll, and whose first die, where
 * a d20, kept one value (MQX ChatMessageMidi:516-521)?
 * @param {Roll|null} roll
 * @returns {boolean}
 */
function midiJudges(roll) {
  const D20Roll = CONFIG.Dice?.D20Roll;
  const die = roll?.dice?.[0];
  if ( !D20Roll || !die ) return false;
  let valid = false;
  try {
    valid = D20Roll.fromRoll(roll).validD20Roll === true;
  } catch {
    valid = false;
  }
  return valid && !((die.faces === 20) && (die.values?.length !== 1));
}

/**
 * Whom Midi-QOL's attack hit, as players see it on its card once it has checked, written after it
 * checked (`GMOnlyAttackRoll`), and where the card has its attack. By the three ways Midi shows
 * hits (results.mjs), in this order:
 * - H1, its hits section, where shown: each target as Midi checked it, by its hits and the targets
 *   it checked, by their tokens, each taken for its actor; nothing for a miss on a critical card,
 *   whose rows Midi draws all hit;
 * - H3, the Gamemaster's words in place of the total, under Hit/Miss Only or Hit/Miss/Critical/
 *   Fumble: for a card at one target, the word Midi writes, where it decides something of it;
 * - H2, the success or failure Midi marks on the total of an attack at one target, against its d20's
 *   target, where shown.
 * Told to every reader of the card, whatever its whispers, as Midi draws it. With Gamemaster-only
 * information on, or since 0.31.0 the results told always, everything Midi checked; and where it
 * checked nothing, H2's outcome for a card at one target, and for one at several, each target by the
 * armor class Midi writes on the card, one under total cover missed. Nothing for a target that can't
 * be found by its token, as one deleted since, nor where two tokens of one actor came out
 * differently.
 * @param {ChatMessage} message
 * @param {object[]} targets
 * @param {ResultRules} rules
 * @returns {object[]|null}   Null where nothing is told.
 */
function midiHits(message, targets, rules) {
  const flags = message.flags["midi-qol"];
  const check = rules.midi?.autoCheckHit;
  const rolls = message.rolls ?? [];
  if ( (flags.GMOnlyAttackRoll !== false) || (typeof check !== "string") || !rolls.some(isAttackRoll) ) return null;
  const attack = rolls.find(roll => roll?.options?.["midi-qol"]?.rollType === "attack") ?? null;
  const aimed = d20Target(attack);
  const one = targets.length === 1;
  const byTotal = () => [{ outcome: attackOutcome(attack, { ac: aimed }) }];

  if ( resultsTold(rules) ) {
    if ( check !== "none" ) return checkedHits(flags, targets);
    if ( one && (aimed !== null) && midiJudges(attack) ) return byTotal();
    if ( !attack || !midiJudges(attack) ) return null;
    return targets.map(({ ac }) => (ac === null) ? { outcome: "miss" }
      : (Number.isFinite(ac) ? { outcome: attackOutcome(attack, { ac }) } : {}));
  }
  if ( midiHitsShown(rules) ) return checkedHits(flags, targets, { critical: flags.isCritical === true });

  const display = rules.midi.gmAttackDisplay;
  const byGM = message.author?.isGM === true;
  const words = ["hitMiss", "hitMissCrit"].includes(display) && ["none", "all"].includes(check)
    && (typeof flags.isHit === "boolean") && ((check !== "none") || (aimed !== null));
  if ( one && byGM && words ) {
    let outcome = flags.isHit ? "hit" : "miss";
    if ( (display === "hitMissCrit") && (flags.isCritical === true) ) outcome = "hit";
    else if ( (display === "hitMissCrit") && (flags.isFumble === true) ) outcome = "miss";
    return [{ outcome }];
  }
  if ( one && midiTotalShown(rules) && (aimed !== null) && midiJudges(attack) && !(byGM && (display === "hidden")) ) {
    return byTotal();
  }
  return null;
}

/**
 * Each target as Midi-QOL checked it: hit, by its hits, a hit through EC alone among them, or
 * missed, by the targets it checked; each by its tokens, taken for their actors.
 * @param {object} flags   The card's Midi-QOL flags.
 * @param {object[]} targets
 * @param {object} [options]
 * @param {boolean} [options.critical]   Is the card a critical, whose rows Midi draws all hit, even
 *                                       one it didn't count as hit, as under total cover? Such a
 *                                       target is told nothing.
 * @returns {object[]}
 */
function checkedHits(flags, targets, { critical=false }={}) {
  const hit = new Set([...tokenUuids(flags.hitTargetUuids), ...tokenUuids(flags.hitECTargetUuids)]);
  const aimed = tokenUuids((Array.isArray(flags.targets) ? flags.targets : []).map(target => target?.uuid));
  const verdicts = verdictsByActor([...hit, ...aimed], token => (hit.has(token) ? "hit" : "miss"));
  return targets.map(({ uuid }) => {
    const verdict = verdicts.get(uuid)?.verdict;
    return (verdict && !(critical && (verdict === "miss"))) ? { outcome: verdict } : {};
  });
}

/**
 * Who saved against Midi-QOL's card, as its card records it once it has checked: by the tokens it
 * records as saved, or as failed, each taken for its actor, never by the card's targets' `saved`,
 * which a check made again leaves as it was. Only once Midi has checked saves, by its Auto Check
 * Saves, at all, and shown them, which alone marks a target `saved`: until then, it lists every
 * target as failed. Seen by players for each target as Midi draws it, by the target alone
 * (`midiSaveSeen`): neither the card's speaker, its DC, its whispers nor its activity's own Save
 * Display play any part.
 * @param {ChatMessage} message
 * @param {object[]} targets
 * @param {ResultRules} rules
 * @returns {object[]|null}   Null where nothing is told.
 */
function midiSaves(message, targets, rules) {
  const flags = message.flags["midi-qol"];
  const check = rules.midi?.autoCheckSaves;
  if ( (typeof check !== "string") || (check === "none") || !Array.isArray(flags.saveUuids) ) return null;
  if ( !targets.some(target => typeof target?.saved === "boolean") ) return null;
  const saved = new Set(tokenUuids(flags.saveUuids));
  const failed = tokenUuids(flags.failedSaveUuids);
  const verdicts = verdictsByActor([...saved, ...failed], token => (saved.has(token) ? "success" : "failure"));
  return targets.map(({ uuid }) => {
    const found = verdicts.get(uuid);
    return (found?.verdict && midiSaveSeen(rules, found.actor)) ? { save: found.verdict } : {};
  });
}

/**
 * Whose save or check a roll is, and whether it succeeded, as dnd5e highlights it for those who see
 * it (F1): `{target, outcome?, readers?}` in `save`, for a save of any kind but a death save, or in
 * `check`, for an ability, skill or tool check; `target` the uuid of its creature's actor, as cards
 * name their targets, `outcome` "success" or "failure", and `readers` the campaign's characters
 * whose players alone see it. From any card, Midi-QOL's among them, a request, a concentration card,
 * a link in a description, or none. Its outcome only once decided, against a DC, of one d20 dnd5e
 * doesn't count otherwise, a legendary resistance's forced success a success; and while Midi-QOL is
 * active, only where it leaves dnd5e's highlight. Seen by players as Challenge Visibility has it for
 * the card it was rolled from, or the roll itself: by everyone, on every card or on players'; by its
 * author's players alone; or by none.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @param {ResultRules} rules
 * @param {Dnd5eSource} src
 * @returns {{field: "save"|"check", value: {target: string, outcome?: string, readers?: string[]}}|null}
 */
function rollResult(message, campaign, rules, src) {
  const kind = src.roll?.type;
  const field = ["save", "concentration"].includes(kind) ? "save"
    : (["ability", "skill", "tool"].includes(kind) ? "check" : null);
  if ( !field ) return null;
  const target = message.speakerActor?.uuid;
  if ( typeof target !== "string" ) return null;
  if ( !rules.gmContent && obscured(message) ) return { field, value: { target } };
  const outcome = rollOutcome(message, src);
  if ( !outcome ) return { field, value: { target } };
  if ( !resultsTold(rules) && !midiHighlightShown(rules) ) return { field, value: { target } };
  const origin = src.origin ?? message;
  switch ( challengeAudience(rules, origin.author) ) {
    case "everyone": return { field, value: { target, outcome } };
    case "author": {
      const readers = charactersSeenBy([origin.author.id], campaign);
      return { field, value: readers.length ? { target, outcome, readers } : { target } };
    }
    default: return { field, value: { target } };
  }
}

/**
 * Whether a save or check succeeded, as dnd5e highlights it: its first roll a d20 roll against a DC,
 * whose first die is one d20, unmodified, as dnd5e tests it; a legendary resistance's forced
 * success a success. Null for any other.
 * @param {ChatMessage} message
 * @param {Dnd5eSource} src
 * @returns {"success"|"failure"|null}
 */
function rollOutcome(message, src) {
  const [roll] = message.rolls ?? [];
  const D20Roll = CONFIG.Dice?.D20Roll;
  if ( !D20Roll || !(roll instanceof D20Roll) || !Number.isNumeric(roll.options?.target) ) return null;
  if ( !plainD20(roll) ) return null;
  return (roll.isSuccess || src.forceSuccess) ? "success" : "failure";
}

/**
 * Does Midi-QOL show players a message's roll as "??", as it does a blind save or check it keeps
 * public?
 * @param {ChatMessage} message
 * @returns {boolean}
 */
function obscured(message) {
  return message.flags?.["midi-qol"]?.obscureRoll === true;
}

/**
 * The uuids of tokens a Midi-QOL card lists.
 * @param {unknown} list
 * @returns {string[]}
 */
function tokenUuids(list) {
  return Array.isArray(list) ? list.filter(uuid => typeof uuid === "string") : [];
}

/**
 * What Midi-QOL decided of each target, by its actor's uuid, as dnd5e's flags name targets, with
 * that actor; its verdict null where two of its tokens came out differently. A token that can't be
 * found, as one deleted since, counts for no one.
 * @param {string[]} tokens
 * @param {(token: string) => string} verdictOf
 * @returns {Map<string, {actor: Actor, verdict: string|null}>}
 */
function verdictsByActor(tokens, verdictOf) {
  const verdicts = new Map();
  for ( const token of new Set(tokens) ) {
    let actor = null;
    try {
      actor = fromUuidSync(token)?.actor ?? null;
    } catch {
      actor = null;
    }
    if ( typeof actor?.uuid !== "string" ) continue;
    const verdict = verdictOf(token);
    const known = verdicts.get(actor.uuid);
    if ( !known ) verdicts.set(actor.uuid, { actor, verdict });
    else if ( known.verdict !== verdict ) known.verdict = null;
  }
  return verdicts;
}
