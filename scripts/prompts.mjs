import { EVENTS, MODULE_ID } from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { campaignCharacterId, playerOwners } from "./characters.mjs";
import { askedSave, chatAudience } from "./chat-data.mjs";
import { midiActivities } from "./command-uses.mjs";
import { diceStatus } from "./dice-plan.mjs";
import { send } from "./transport.mjs";

/**
 * Asking players in the Sending Stone app for the saving throws the game asks of their characters,
 * where Foundry waits for a player to click one on a chat card: dnd5e's concentration check after
 * damage, a save that a spell or feature calls for at them, and a save the Gamemaster requests in
 * chat. The player rolls it in the app, and it's made here with their dice, linked to the card, as
 * if they had clicked it. Where Midi-QOL rolls saves itself, it still does, and no one is asked.
 *
 * Whether a prompt is open is read from the chat log: its card is there, less than ten minutes
 * old, and its character hasn't rolled the save from it. So a prompt can still be answered, and a
 * campaign told which are open, after the Gamemaster reloads.
 */

/**
 * How long a prompt waits for its player, in milliseconds.
 * @type {number}
 */
export const PROMPT_LIFETIME = 10 * 60_000;

/**
 * A saving throw the game asks of one of a campaign's characters.
 * @typedef {object} RollPrompt
 * @property {string} id                       The card's id and the character's, joined by "-".
 * @property {string} actorId
 * @property {string} messageId                The card that asks.
 * @property {"save"|"concentration"} type
 * @property {string[]} abilities              The abilities it may be rolled with, one for
 *                                             concentration.
 * @property {number|null} dc
 * @property {boolean} hideDC                  Does its card keep its DC from everyone, as dnd5e's
 *                                             request for a link whose author hid it does?
 * @property {boolean} showsDc                 May its player see the DC, unless the card hides it,
 *                                             and whether they saved?
 * @property {string|null} label               What asks, such as the spell, or what the character
 *                                             is concentrating on.
 * @property {number} openedAt                 When its card was posted, in milliseconds.
 * @property {number} expiresAt                When it stops waiting, in milliseconds.
 */

/**
 * The prompts each campaign has been told are open, by prompt id, with the campaigns told and when
 * each stops waiting.
 * @type {Map<string, {prompt: RollPrompt, campaignIds: Set<string>, timer: number}>}
 */
const open = new Map();

/* -------------------------------------------- */

/**
 * Register the hooks that find the saves the game asks for, and those rolled.
 * @returns {void}
 */
export function registerPromptHooks() {
  Hooks.on("createChatMessage", onCreateMessage);
  Hooks.on("deleteChatMessage", onDeleteMessage);
}

/**
 * Does a campaign ask its players for their saves now: its Gamemaster lets it, and its players'
 * rolls can be made here?
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function prompting(campaign) {
  return campaign.rolls && campaign.prompts && diceStatus.ready;
}

/* -------------------------------------------- */
/*  Reading cards                               */
/* -------------------------------------------- */

/**
 * Does Midi-QOL roll the saves this card asks for itself? It does a save's, as items' uses go
 * through its workflow, unless the Gamemaster has it leave saves to the card's buttons; and with
 * the setting unreadable, it's assumed to. It leaves dnd5e's concentration card, which it posts
 * only to leave the check to the player, and requests in chat to the player.
 * @param {AskedSave} save
 * @returns {boolean}
 */
function leftToMidi(save) {
  if ( (save.source !== "save") || !midiActivities() ) return false;
  return globalThis.MidiQOL?.configSettings?.()?.autoCheckSaves !== "none";
}

/**
 * The campaign's characters a card asks a save of, of those whose players can read it: the one
 * concentrating, for dnd5e's concentration card; the targets of a save's card; and, for a request
 * a Gamemaster posts in chat, every one.
 * @param {ChatMessage} message
 * @param {AskedSave} save
 * @param {Campaign} campaign
 * @returns {string[]}   Their actor ids.
 */
function askedOf(message, save, campaign) {
  const readers = new Set(chatAudience(message, campaign).characters);
  let ids = [];
  switch ( save.source ) {
    case "concentration":
      ids = [campaignCharacterId(message.speakerActor, campaign)];
      break;
    case "save":
      ids = (message.flags?.dnd5e?.targets ?? []).map(target => campaignCharacterId(actorOf(target?.uuid), campaign));
      break;
    case "request":
      if ( message.author?.isGM ) ids = Array.from(readers);
      break;
  }
  return Array.from(new Set(ids.filter(id => id && readers.has(id))));
}

/**
 * The actor a target of a card is, from its uuid.
 * @param {unknown} uuid
 * @returns {Actor|null}
 */
function actorOf(uuid) {
  if ( typeof uuid !== "string" ) return null;
  try {
    const found = fromUuidSync(uuid);
    return (found?.documentName === "Actor") ? found : (found?.actor ?? null);
  } catch {
    return null;
  }
}

/**
 * The prompts a chat card opens in a campaign: one for each of its characters it asks a save of,
 * while the campaign asks its players for their saves. A roll request a player posts from the app
 * asks no one, whoever it's posted as: it's for the Gamemaster, to roll for the creatures it names,
 * and anyone in Foundry may click it.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @returns {RollPrompt[]}
 */
export function promptsOf(message, campaign) {
  if ( !prompting(campaign) || message.flags?.[MODULE_ID]?.ask ) return [];
  const save = askedSave(message);
  if ( !save || leftToMidi(save) ) return [];
  return askedOf(message, save, campaign).flatMap(actorId => {
    const actor = game.actors.get(actorId);
    const prompt = actor ? describePrompt(message, save, actor) : null;
    return prompt ? [prompt] : [];
  });
}

/**
 * A save a card asks of a character.
 * @param {ChatMessage} message
 * @param {AskedSave} save
 * @param {Actor} actor
 * @returns {RollPrompt|null}   Null for a save with no ability to roll.
 */
function describePrompt(message, save, actor) {
  const abilities = (save.type === "concentration") ? [concentrationAbility(actor, save)] : save.abilities;
  if ( !abilities.length ) return null;
  const openedAt = Number.isFinite(message.timestamp) ? message.timestamp : Date.now();
  return {
    id: promptId(message.id, actor.id),
    actorId: actor.id,
    messageId: message.id,
    type: save.type,
    abilities,
    dc: save.dc,
    hideDC: save.hideDC === true,
    showsDc: showsChallenge(message, actor),
    label: labelOf(message, save, actor),
    openedAt,
    expiresAt: openedAt + PROMPT_LIFETIME
  };
}

/**
 * The ability a character's concentration check is rolled with: the one the card names, or else
 * the character's own, as dnd5e rolls it.
 * @param {Actor} actor
 * @param {AskedSave} save
 * @returns {string}
 */
function concentrationAbility(actor, save) {
  if ( save.abilities.length ) return save.abilities[0];
  const own = actor.system.attributes?.concentration?.ability;
  return (own in CONFIG.DND5E.abilities) ? own : (CONFIG.DND5E.defaultAbilities?.concentration ?? "con");
}

/**
 * May a character's player see a card's DC, and whether they saved against it? As dnd5e shows
 * them: on their own card, and on others' as its Challenge Visibility has it.
 * @param {ChatMessage} message
 * @param {Actor} actor
 * @returns {boolean}
 */
function showsChallenge(message, actor) {
  const author = message.author;
  if ( author && playerOwners(actor).some(user => user.id === author.id) ) return true;
  let visibility;
  try {
    visibility = game.settings.get("dnd5e", "challengeVisibility");
  } catch {
    return false;
  }
  if ( visibility === "all" ) return true;
  if ( visibility === "player" ) return author?.isGM === false;
  return false;
}

/**
 * What asks a character for a save: the spell or feature whose card it is, or what they're
 * concentrating on.
 * @param {ChatMessage} message
 * @param {AskedSave} save
 * @param {Actor} actor
 * @returns {string|null}
 */
function labelOf(message, save, actor) {
  if ( save.source === "save" ) {
    const uuid = message.flags?.dnd5e?.item?.uuid;
    try {
      return (uuid && fromUuidSync(uuid)?.name) || null;
    } catch {
      return null;
    }
  }
  if ( save.type !== "concentration" ) return null;
  const names = Array.from(actor.concentration?.items ?? [], item => item.name).filter(Boolean);
  return names.length ? names.join(", ") : null;
}

/**
 * A prompt's id: its card's and its character's, which Foundry's ids never contain a "-" to blur.
 * @param {string} messageId
 * @param {string} actorId
 * @returns {string}
 */
function promptId(messageId, actorId) {
  return `${messageId}-${actorId}`;
}

/**
 * The character a save was rolled for, as its message's speaker.
 * @param {ChatMessage} message
 * @returns {string|null}
 */
function speakerId(message) {
  return message.speakerActor?.id ?? message.speaker?.actor ?? null;
}

/**
 * Has a character rolled a save from a card, here or in the app?
 * @param {string} messageId
 * @param {string} actorId
 * @returns {boolean}
 */
function answered(messageId, actorId) {
  return game.messages.contents.some(message => (message.flags?.dnd5e?.originatingMessage === messageId)
    && (message.flags?.dnd5e?.roll?.type === "save") && (speakerId(message) === actorId));
}

/**
 * A prompt as a campaign is told of it: its DC only where its player may see it, and never where its
 * card keeps it from everyone.
 * @param {RollPrompt} prompt
 * @returns {object}
 */
function summarizePrompt(prompt) {
  return {
    id: prompt.id,
    actorId: prompt.actorId,
    messageId: prompt.messageId,
    type: prompt.type,
    abilities: prompt.abilities,
    dc: (prompt.showsDc && !prompt.hideDC) ? prompt.dc : null,
    label: prompt.label,
    openedAt: new Date(prompt.openedAt).toISOString(),
    expiresAt: new Date(prompt.expiresAt).toISOString()
  };
}

/* -------------------------------------------- */
/*  Answering                                   */
/* -------------------------------------------- */

/**
 * The open prompt a player's save answers, read from its card; or why it can't be answered: the
 * campaign doesn't ask its players for their saves (`off`), it's another character's
 * (`character`), its card is gone or asks no save of the character (`gone`), it waited too long
 * (`expired`), or the character has rolled it (`answered`).
 * @param {string} id       The prompt's id, as the app has it.
 * @param {Actor} actor     The character whose save it is.
 * @param {Campaign} campaign
 * @returns {{prompt?: RollPrompt, refusal?: string}}
 */
export function findPrompt(id, actor, campaign) {
  if ( !prompting(campaign) ) return { refusal: "off" };
  const [messageId, actorId] = id.split("-");
  if ( actorId !== actor.id ) return { refusal: "character" };
  const message = game.messages.get(messageId);
  const prompt = message ? promptsOf(message, campaign).find(each => each.actorId === actor.id) : null;
  if ( !prompt ) return { refusal: "gone" };
  if ( Date.now() >= prompt.expiresAt ) return { refusal: "expired" };
  if ( answered(messageId, actor.id) ) return { refusal: "answered" };
  return { prompt };
}

/**
 * Whether a save answering a prompt succeeded, where its player may know: as the card would show
 * them. Null where they may not, or for a save against no DC.
 * @param {RollPrompt} prompt
 * @param {Roll[]} rolls     The save's rolls, as made.
 * @returns {"success"|"failure"|null}
 */
export function outcomeOf(prompt, rolls) {
  const [roll] = rolls ?? [];
  if ( !prompt.showsDc || !roll || !Number.isNumeric(roll.options?.target) ) return null;
  return (roll.isSuccess || (roll.options.success === true)) ? "success" : "failure";
}

/* -------------------------------------------- */
/*  Telling campaigns                           */
/* -------------------------------------------- */

/**
 * Tell each campaign of the saves a new card asks of its characters, and of a prompt its character
 * has now rolled.
 * @param {ChatMessage} message
 */
function onCreateMessage(message) {
  if ( !canSend() ) return;
  closeAnswered(message);
  for ( const campaign of getCampaigns() ) {
    for ( const prompt of promptsOf(message, campaign) ) {
      if ( remember(prompt, campaign) ) send(EVENTS.PROMPT_OPENED, { prompt: summarizePrompt(prompt) }, campaign);
    }
  }
}

/**
 * Close the prompt a save rolled from its card answers: from the app, or clicked in Foundry.
 * @param {ChatMessage} message
 */
function closeAnswered(message) {
  const origin = message.flags?.dnd5e?.originatingMessage;
  const actorId = speakerId(message);
  if ( !origin || !actorId || (message.flags?.dnd5e?.roll?.type !== "save") ) return;
  closePrompt(promptId(origin, actorId), message.flags?.[MODULE_ID]?.request ? "answered" : "rolled");
}

/**
 * Close the prompts of a card that's deleted.
 * @param {ChatMessage} message
 */
function onDeleteMessage(message) {
  if ( !canSend() ) return;
  for ( const [id, { prompt }] of open ) {
    if ( prompt.messageId === message.id ) closePrompt(id, "gone");
  }
}

/**
 * Remember that a campaign has been told a prompt is open, until it closes.
 * @param {RollPrompt} prompt
 * @param {Campaign} campaign
 * @returns {boolean}   Is this the first the campaign is told of it?
 */
function remember(prompt, campaign) {
  let entry = open.get(prompt.id);
  if ( !entry ) {
    const timer = setTimeout(() => closePrompt(prompt.id, "expired"), Math.max(prompt.expiresAt - Date.now(), 0));
    entry = { prompt, campaignIds: new Set(), timer };
    open.set(prompt.id, entry);
  }
  if ( entry.campaignIds.has(campaign.id) ) return false;
  entry.campaignIds.add(campaign.id);
  return true;
}

/**
 * Tell each campaign told of a prompt that it's closed, and why: its character rolled it from the
 * app (`answered`) or in Foundry (`rolled`), its card was deleted (`gone`), or it waited too long
 * (`expired`).
 * @param {string} id
 * @param {"answered"|"rolled"|"gone"|"expired"} reason
 * @returns {void}
 */
function closePrompt(id, reason) {
  const entry = open.get(id);
  if ( !entry ) return;
  open.delete(id);
  clearTimeout(entry.timer);
  if ( !canSend() ) return;
  for ( const campaign of getCampaigns() ) {
    if ( entry.campaignIds.has(campaign.id) ) send(EVENTS.PROMPT_CLOSED, { id, reason }, campaign);
  }
}

/**
 * The prompts open in a campaign, read from the chat log, for its hello; from then on, it's told as
 * each closes, and of no other it was told of before.
 * @param {Campaign} campaign
 * @returns {object[]}
 */
export function openPrompts(campaign) {
  const since = Date.now() - PROMPT_LIFETIME;
  const recent = prompting(campaign) ? game.messages.contents.filter(message => !(message.timestamp < since)) : [];
  const found = recent.flatMap(message => promptsOf(message, campaign))
    .filter(prompt => (Date.now() < prompt.expiresAt) && !answered(prompt.messageId, prompt.actorId));
  const ids = new Set(found.map(prompt => prompt.id));
  for ( const [id, entry] of open ) {
    if ( ids.has(id) ) continue;
    entry.campaignIds.delete(campaign.id);
    if ( entry.campaignIds.size ) continue;
    clearTimeout(entry.timer);
    open.delete(id);
  }
  for ( const prompt of found ) remember(prompt, campaign);
  return found.map(summarizePrompt);
}
