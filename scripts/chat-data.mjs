import { includeGmContent } from "./config.mjs";
import { campaignActors, campaignCharacterId, charactersSeenBy } from "./characters.mjs";

/**
 * Turning chat messages into plain data for the listener.
 */

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
    text: htmlToText(message.content),
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
 * to their labels.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  if ( !html ) return "";
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return (parsed.body?.textContent ?? "")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

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
function summarizeRoll(roll) {
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
