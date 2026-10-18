import { MODULE_ID } from "./constants.mjs";
import { includeGmContent } from "./config.mjs";
import { campaignActors, campaignCharacterId, charactersSeenBy } from "./characters.mjs";
import { outcomeOf as attackOutcome } from "./command-uses.mjs";
import { midiChallengeShown, OUTCOME_SHOWN } from "./midi-prompts.mjs";
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
 * Describe a chat message for a campaign.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @param {object} [audience]   The message's audience in that campaign, if already computed.
 * @returns {object}
 */
export function serializeMessage(message, campaign, audience=chatAudience(message, campaign)) {
  const author = message.author;
  const speaker = message.speaker ?? {};
  const content = sharedContent(message);
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
    character: campaignCharacterId(message.speakerActor, campaign),
    title: message.title || null,
    flavor: message.flavor ?? "",
    content,
    text: htmlToText(content, { challenge: challengeShown(message) }),
    ask: askOf(message),
    blind: message.blind,
    audience,
    rolls: message.rolls.map(summarizeRoll),
    system: systemData(message),
    dnd5e: dnd5eData(message, campaign),
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
 * A setting of the game's or of another module's, as it's set now; undefined where it can't be
 * read, as where its module isn't there, which counts as keeping from players what it would show.
 * @param {string} namespace
 * @param {string} key
 * @returns {unknown}
 */
function readSetting(namespace, key) {
  try {
    return game.settings.get(namespace, key);
  } catch {
    return undefined;
  }
}

/**
 * A message's content as the listener is told it, since module 0.29.0: unless Gamemaster-only
 * information is being sent, without what dnd5e's and Midi-QOL's cards keep from players, which
 * the content holds for the Gamemaster's client to show and players' clients to hide. Parsed into
 * an inert document, as `htmlToText` parses it: Midi's sections of hits and saves are emptied,
 * being drawn on the client that ran its workflow, often the Gamemaster's, with armor classes and
 * DCs; every button's DC, `data-dc`, goes; and so do dnd5e's labels with DCs, where players may not
 * see them, as `challengeShown` has it. The module reads every card it acts on from the message
 * itself, never this.
 * @param {ChatMessage} message
 * @returns {string}
 */
function sharedContent(message) {
  const content = message.content ?? "";
  if ( (typeof content !== "string") || !content || includeGmContent() ) return content;
  const body = new DOMParser().parseFromString(content, "text/html").body;
  if ( !body ) return "";
  for ( const section of body.querySelectorAll(".midi-qol-hits-display, .midi-qol-saves-display") ) {
    section.replaceChildren();
  }
  body.querySelectorAll("[data-dc]").forEach(element => element.removeAttribute("data-dc"));
  if ( !challengeShown(message) ) body.querySelectorAll(".visible-dc").forEach(label => label.remove());
  return body.innerHTML;
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

/**
 * The data of a system-defined message subtype, such as D&D Fifth Edition's usage, turn and rest
 * cards. Null for an ordinary message.
 * @param {ChatMessage} message
 * @returns {object|null}
 */
function systemData(message) {
  if ( message.type === CONST.BASE_DOCUMENT_TYPE ) return null;
  try {
    return message.system?.toObject?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * What D&D Fifth Edition records about where a message came from: the kind of roll, and the item,
 * activity and targets involved; and since module 0.29.0, whether an attack hit each target, and
 * whether each saved against Midi-QOL's card, and for a save rolled from dnd5e's card, whose save it
 * is and whether it succeeded, as `targetResults` and `saveResult` have them: each only where
 * players see it in Foundry, unless Gamemaster-only information is being sent. Null under any other
 * system, or for a message it did not create.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @returns {object|null}
 */
function dnd5eData(message, campaign) {
  if ( game.system.id !== "dnd5e" ) return null;
  const flags = message.flags?.dnd5e;
  if ( !flags ) return null;

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
  const gmContent = includeGmContent();
  const described = flags.targets ?? [];
  const results = targetResults(message, described, activity, gmContent);
  const targets = described.map(({ name, uuid, ac }, index) => ({
    ...(gmContent ? { name, uuid, ac: ac ?? null } : { name, uuid }),
    ...results[index]
  }));
  const save = saveResult(message, campaign, gmContent);

  return {
    messageType: flags.messageType ?? null,
    roll: flags.roll ? foundry.utils.deepClone(flags.roll) : null,
    item: (flags.item || item) ? {
      id: flags.item?.id ?? item?.id ?? null,
      uuid: flags.item?.uuid ?? item?.uuid ?? null,
      type: flags.item?.type ?? item?.type ?? null,
      name: item?.name ?? null
    } : null,
    activity: (flags.activity || activity) ? {
      id: flags.activity?.id ?? activity?.id ?? null,
      uuid: flags.activity?.uuid ?? activity?.uuid ?? null,
      type: flags.activity?.type ?? activity?.type ?? null,
      name: activity?.name ?? null
    } : null,
    targets,
    originatingMessage: flags.originatingMessage ?? null,
    ...(save && { save })
  };
}

/* -------------------------------------------- */
/*  Hits, misses and saves                      */
/* -------------------------------------------- */

/**
 * Whether players may see what Foundry decided of a message's targets, by the kind of check:
 * what's decided is sent only where it's so, and only where players see it in Foundry, unless
 * Gamemaster-only information is being sent, when everything decided is, as armor class is. The
 * settings are read as the message is sent: one changed later sends no message again.
 *
 * Each target of the message's own, in the order it names them: dnd5e's attack's, hit or missed,
 * `outcome`, as the app's own attacks are judged; or on Midi-QOL's card, hit or missed, and saved
 * or not, `save`, as Midi decided them. Nothing on a roll Midi shows players as "??".
 * @param {ChatMessage} message
 * @param {object[]} targets   The message's, as dnd5e's flags describe them.
 * @param {Activity|null} activity   The message's.
 * @param {boolean} gmContent
 * @returns {object[]}   For each target, `{outcome?, save?}`.
 */
function targetResults(message, targets, activity, gmContent) {
  const none = targets.map(() => ({}));
  if ( !targets.length || (!gmContent && obscured(message)) ) return none;
  if ( !midiCard(message) ) return attackResults(message, targets, gmContent) ?? none;
  const hits = midiHits(message, targets, gmContent);
  const saves = midiSaves(message, targets, activity, gmContent);
  return targets.map((_, index) => ({ ...hits?.[index], ...saves?.[index] }));
}

/**
 * Whether a dnd5e attack hit each of its targets, as `outcomeOf` has it: a critical hit always
 * does; a fumble, or a total under its armor class, misses; and one under total cover, of no armor
 * class, misses. dnd5e's card differs there alone: comparing the total with null, it draws that
 * target as hit, of armor class ∞, unless the attack is a fumble. Seen by players only while
 * dnd5e's Attack Result Visibility shows them, "Show only results" or "Show results & target ACs"
 * (hideAC or all), as dnd5e's card draws its
 * targets for them.
 * @param {ChatMessage} message
 * @param {object[]} targets
 * @param {boolean} gmContent
 * @returns {object[]|null}   Null where nothing is told.
 */
function attackResults(message, targets, gmContent) {
  const [roll] = message.rolls ?? [];
  const D20Roll = CONFIG.Dice?.D20Roll;
  if ( (message.flags?.dnd5e?.roll?.type !== "attack") || !D20Roll || !(roll instanceof D20Roll) ) return null;
  if ( !Number.isFinite(roll.total) ) return null;
  const visibility = readSetting("dnd5e", "attackRollVisibility");
  if ( !gmContent && ((typeof visibility !== "string") || (visibility === "none")) ) return null;
  return targets.map(({ ac }) => {
    return ((ac === null) || Number.isFinite(ac)) ? { outcome: attackOutcome(roll, { ac }) } : {};
  });
}

/**
 * Whom Midi-QOL's attack hit, as its card records it once it has checked: its hits, and the targets
 * it checked, by their tokens, each taken for its actor, as the card's targets are. Only once Midi
 * has checked hits, by its Auto Check Hits, at all, and its card says so, it having written them
 * once before it checked (`GMOnlyAttackRoll`); and where the card has its attack, a use with none
 * listing every target as hit. Seen by players only where Midi shows them, Auto Check Hits "all",
 * on a card everyone may read. Nothing for a target that can't be found by its token, as one deleted
 * since, nor where two tokens of one actor came out differently.
 * @param {ChatMessage} message
 * @param {object[]} targets
 * @param {boolean} gmContent
 * @returns {object[]|null}   Null where nothing is told.
 */
function midiHits(message, targets, gmContent) {
  const flags = message.flags["midi-qol"];
  const check = midiSettings().autoCheckHit;
  if ( (flags.GMOnlyAttackRoll !== false) || (typeof check !== "string") || (check === "none") ) return null;
  if ( !(message.rolls ?? []).some(isAttackRoll) ) return null;
  if ( !gmContent && ((check !== "all") || !publicMessage(message)) ) return null;
  const hit = new Set([...tokenUuids(flags.hitTargetUuids), ...tokenUuids(flags.hitECTargetUuids)]);
  const aimed = tokenUuids((Array.isArray(flags.targets) ? flags.targets : []).map(target => target?.uuid));
  const verdicts = verdictsByActor([...hit, ...aimed], token => (hit.has(token) ? "hit" : "miss"));
  return targets.map(({ uuid }) => {
    const verdict = verdicts.get(uuid)?.verdict;
    return verdict ? { outcome: verdict } : {};
  });
}

/**
 * Who saved against Midi-QOL's card, as its card records it once it has checked: by the tokens it
 * records as saved, or as failed, each taken for its actor, never by the card's targets' `saved`,
 * which a check made again leaves as it was. Only once Midi has checked saves, by its Auto Check
 * Saves, at all, and shown them, which alone marks a target `saved`: until then, it lists every
 * target as failed. Seen by players only where Midi shows them whether they saved, by the card's
 * activity's own Save Display or else Auto Check Saves, and its DC, as Challenge Visibility has it
 * for the card's speaker; on a card everyone may read; and a target no player owns only under
 * Challenge Visibility "Show all", as Midi keeps an NPC's save from players otherwise.
 * @param {ChatMessage} message
 * @param {object[]} targets
 * @param {Activity|null} activity
 * @param {boolean} gmContent
 * @returns {object[]|null}   Null where nothing is told.
 */
function midiSaves(message, targets, activity, gmContent) {
  const flags = message.flags["midi-qol"];
  const check = midiSettings().autoCheckSaves;
  if ( (typeof check !== "string") || (check === "none") || !Array.isArray(flags.saveUuids) ) return null;
  if ( !targets.some(target => typeof target?.saved === "boolean") ) return null;
  let seen = () => true;
  if ( !gmContent ) {
    const own = activity?.saveDisplay;
    const display = ((own ?? "default") === "default") ? check : own;
    if ( !OUTCOME_SHOWN.has(display) || !midiChallengeShown(message.speakerActor) ) return null;
    if ( !publicMessage(message) ) return null;
    const all = readSetting("dnd5e", "challengeVisibility") === "all";
    seen = actor => all || (actor?.hasPlayerOwner === true);
  }
  const saved = new Set(tokenUuids(flags.saveUuids));
  const failed = tokenUuids(flags.failedSaveUuids);
  const verdicts = verdictsByActor([...saved, ...failed], token => (saved.has(token) ? "success" : "failure"));
  return targets.map(({ uuid }) => {
    const found = verdicts.get(uuid);
    return (found?.verdict && seen(found.actor)) ? { save: found.verdict } : {};
  });
}

/**
 * Whose save a save rolled from dnd5e's card is, and whether it succeeded, as dnd5e highlights it
 * for those who see it: `{target, outcome?, readers?}`, `target` the uuid of its creature's actor,
 * as the card names its targets, `outcome` "success" or "failure", and `readers` the campaign's
 * characters whose players alone see it. Only for a save of a save activity's card, not Midi-QOL's,
 * which shows its own, nor dnd5e's concentration card or a request in chat. Its outcome only once
 * decided, against a DC, of one d20 dnd5e doesn't count otherwise, a legendary resistance's forced
 * success a success. Seen by players as the card's Challenge Visibility has it: by everyone, on
 * every card or on players'; or by its author's players alone; or by none.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @param {boolean} gmContent
 * @returns {{target: string, outcome?: string, readers?: string[]}|null}
 */
function saveResult(message, campaign, gmContent) {
  const flags = message.flags.dnd5e;
  if ( flags.roll?.type !== "save" ) return null;
  const card = flags.originatingMessage ? (game.messages?.get(flags.originatingMessage) ?? null) : null;
  if ( !card || (card.id === message.id) || midiCard(card) ) return null;
  let activity = null;
  try {
    activity = card.getAssociatedActivity?.() ?? null;
  } catch {
    activity = null;
  }
  const target = message.speakerActor?.uuid;
  if ( (activity?.type !== "save") || (typeof target !== "string") ) return null;
  const outcome = saveOutcome(message);
  if ( !outcome ) return { target };
  if ( gmContent ) return { target, outcome };
  if ( obscured(message) ) return { target };
  const visibility = readSetting("dnd5e", "challengeVisibility");
  const byGM = card.author?.isGM === true;
  if ( (visibility === "all") || ((visibility === "player") && !byGM) ) return { target, outcome };
  if ( byGM || !card.author?.id ) return { target };
  const readers = charactersSeenBy([card.author.id], campaign);
  return readers.length ? { target, outcome, readers } : { target };
}

/**
 * Whether a save succeeded, as dnd5e highlights it: its first roll a d20 roll against a DC, whose
 * first die is one d20, unmodified, as dnd5e tests it; a legendary resistance's forced success a
 * success. Null for any other.
 * @param {ChatMessage} message
 * @returns {"success"|"failure"|null}
 */
function saveOutcome(message) {
  const [roll] = message.rolls ?? [];
  const D20Roll = CONFIG.Dice?.D20Roll;
  if ( !D20Roll || !(roll instanceof D20Roll) || !Number.isNumeric(roll.options?.target) ) return null;
  const die = roll.dice?.[0];
  if ( (die?.faces !== 20) || (die.values?.length !== 1) ) return null;
  const first = die.results?.[0];
  if ( !first || ("success" in first) || die.options?.marginSuccess || die.options?.marginFailure ) return null;
  return (roll.isSuccess || (message.flags.dnd5e.roll.forceSuccess === true)) ? "success" : "failure";
}

/**
 * Is a message one of Midi-QOL's workflow cards, as Midi marks it?
 * @param {ChatMessage} message
 * @returns {boolean}
 */
function midiCard(message) {
  return typeof message.flags?.["midi-qol"]?.messageType === "string";
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
 * May every player read a message: whispered to no one, and not blind?
 * @param {ChatMessage} message
 * @returns {boolean}
 */
function publicMessage(message) {
  return !Array.from(message.whisper ?? []).length && !message.blind;
}

/**
 * Midi-QOL's settings, as it reads them; none where it isn't there, or they can't be read.
 * @returns {object}
 */
function midiSettings() {
  try {
    return globalThis.MidiQOL?.configSettings?.() ?? {};
  } catch {
    return {};
  }
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
