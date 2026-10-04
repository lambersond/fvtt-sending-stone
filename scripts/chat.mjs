import { CHAT_SCOPES, EVENTS } from "./constants.mjs";
import { chatEnabled, chatScope } from "./config.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { campaignCharacterId } from "./characters.mjs";
import { chatAudience, isAudienceShared, serializeMessage } from "./chat-data.mjs";
import { send } from "./transport.mjs";

/**
 * Chat message events, sent to each campaign a message belongs to.
 */

/**
 * Set while a clear of the whole chat log is being reported, so that it is reported once rather
 * than once per message. Core deletes every message in one operation and calls the deletion hook
 * for each of them in turn, synchronously.
 * @type {boolean}
 */
let clearing = false;

/**
 * Register the chat hooks.
 * @returns {void}
 */
export function registerChatHooks() {
  Hooks.on("createChatMessage", onCreateMessage);
  Hooks.on("updateChatMessage", onUpdateMessage);
  Hooks.on("deleteChatMessage", onDeleteMessage);
}

/**
 * Should chat events be posted from this client right now?
 * @returns {boolean}
 */
function active() {
  return canSend() && chatEnabled();
}

/**
 * Does a message belong to a campaign? It does when one of the campaign's characters said it, or
 * when the player of one of its characters can read it, as everyone can a public message.
 * @param {ChatMessage} message
 * @param {object} audience     The message's audience in the campaign.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function isInScope(message, audience, campaign) {
  if ( !isAudienceShared(audience) ) return false;
  const spokenByCampaign = campaignCharacterId(message.speakerActor, campaign) !== null;
  if ( chatScope() === CHAT_SCOPES.CONNECTED ) return spokenByCampaign;
  return spokenByCampaign || (audience.characters.length > 0);
}

/**
 * Every campaign, with the message's audience there and whether the message belongs to it.
 * @param {ChatMessage} message
 * @returns {{campaign: Campaign, audience: object, inScope: boolean}[]}
 */
function campaignsFor(message) {
  return getCampaigns().map(campaign => {
    const audience = chatAudience(message, campaign);
    return { campaign, audience, inScope: isInScope(message, audience, campaign) };
  });
}

/* -------------------------------------------- */

/**
 * @param {ChatMessage} message
 */
function onCreateMessage(message) {
  if ( !active() ) return;
  for ( const { campaign, audience, inScope } of campaignsFor(message) ) {
    if ( inScope ) send(EVENTS.CHAT_CREATED, { message: serializeMessage(message, campaign, audience) }, campaign);
  }
}

/**
 * Report a change to a message, with the message as it now stands.
 *
 * A message can become visible after it was created, as when a Gamemaster reveals a blind roll, so
 * a campaign may receive an update for a message it never saw created. It can also become private,
 * in which case the campaign is told to delete it.
 * @param {ChatMessage} message
 * @param {object} changed   The differential data that was written.
 */
function onUpdateMessage(message, changed) {
  if ( !active() ) return;
  const changes = Object.keys(changed).filter(key => key !== "_id");
  if ( !changes.length ) return;

  const visibilityChanged = ("whisper" in changed) || ("blind" in changed);
  for ( const { campaign, audience, inScope } of campaignsFor(message) ) {
    if ( inScope ) {
      send(EVENTS.CHAT_UPDATED, { changes, message: serializeMessage(message, campaign, audience) }, campaign);
    }
    else if ( visibilityChanged ) send(EVENTS.CHAT_DELETED, { id: message.id }, campaign);
  }
}

/**
 * @param {ChatMessage} message
 * @param {object} options     The deletion operation.
 */
function onDeleteMessage(message, options) {
  if ( !active() ) return;

  if ( options?.deleteAll ) {
    if ( clearing ) return;
    clearing = true;
    setTimeout(() => clearing = false, 0);
    for ( const campaign of getCampaigns() ) send(EVENTS.CHAT_CLEARED, {}, campaign);
    return;
  }

  // Never reveal to a campaign that a message it was not allowed to see existed.
  for ( const { campaign, inScope } of campaignsFor(message) ) {
    if ( inScope ) send(EVENTS.CHAT_DELETED, { id: message.id }, campaign);
  }
}
