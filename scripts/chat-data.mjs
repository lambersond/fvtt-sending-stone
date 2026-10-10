import { MODULE_ID } from "./constants.mjs";
import { includeGmContent } from "./config.mjs";
import { campaignActors, campaignCharacterId, charactersSeenBy } from "./characters.mjs";

/**
 * Turning chat messages into plain data for the listener.
 */

/**
 * A content link as stored, unenriched, such as `@UUID[Actor.abc]{Thorin}`, to reduce to its label.
 * Bounded, and never reading on past the next `@`, so that no message, which anyone may write, can
 * make it take long.
 * @type {RegExp}
 */
const CONTENT_LINK = /@\w{1,50}\[[^\]@]{0,500}\]\{([^}@]{0,500})\}/g;

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
    content: message.content ?? "",
    text: htmlToText(message.content, { challenge: challengeShown(message) }),
    ask: askOf(message),
    blind: message.blind,
    audience,
    rolls: message.rolls.map(summarizeRoll),
    system: systemData(message),
    dnd5e: dnd5eData(message)
  };
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
  let visibility;
  try {
    visibility = game.settings.get("dnd5e", "challengeVisibility");
  } catch {
    return false;
  }
  if ( visibility === "all" ) return true;
  if ( visibility === "player" ) return !message.author?.isGM;
  return false;
}

/* -------------------------------------------- */
/*  Cards that ask for a save                   */
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
 * The save a roll request card asks the table for, as the app shows it: the Gamemaster's, posted
 * from a description, or a player's, posted from the app. Its DC only where players may see it,
 * as dnd5e shows it: never one the card keeps from everyone; and for a player's, what asks for it,
 * such as their item. Null for any other message.
 * @param {ChatMessage} message
 * @returns {{type: string, abilities: string[], dc?: number, label?: string}|null}
 */
function askOf(message) {
  const save = askedSave(message);
  if ( save?.source !== "request" ) return null;
  const label = askLabel(message);
  return {
    type: save.type,
    abilities: save.abilities,
    ...(((save.dc !== null) && !save.hideDC && challengeShown(message)) && { dc: save.dc }),
    ...(label && { label })
  };
}

/**
 * The flavor of a roll request card posted for a player from the app: dnd5e's "Roll Request",
 * then what asks for the save, such as their item, its name escaped, being one players may write.
 * @param {string} name
 * @returns {string}
 */
export function askFlavor(name) {
  return `${game.i18n.localize("EDITOR.DND5E.Inline.RollRequest")}: ${foundry.utils.escapeHTML(String(name))}`;
}

/**
 * What asks for the save on a roll request card posted for a player from the app, read back from
 * its flavor. Null for any other card.
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
 * Describe a roll: its formula, total and every die result.
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
  if ( DamageRoll && (roll instanceof DamageRoll) && roll.options?.type ) summary.damageType = roll.options.type;
  return summary;
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
 * activity and targets involved. Null under any other system, or for a message it did not create.
 * @param {ChatMessage} message
 * @returns {object|null}
 */
function dnd5eData(message) {
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
  const targets = (flags.targets ?? []).map(({ name, uuid, ac }) => {
    return gmContent ? { name, uuid, ac: ac ?? null } : { name, uuid };
  });

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
    originatingMessage: flags.originatingMessage ?? null
  };
}
