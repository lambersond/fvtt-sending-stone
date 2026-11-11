import { CHAT_SCOPES, EVENTS, MODULE_ID } from "./constants.mjs";
import { chatEnabled, chatScope } from "./config.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { speakerCharacterId } from "./characters.mjs";
import { chatAudience, isAudienceShared, serializeMessage } from "./chat-data.mjs";
import { involvesCampaign } from "./combat-data.mjs";
import { messageCompanion } from "./creature-sync.mjs";
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
 * when the player of one of its characters can read it, as everyone can a public message. Since
 * 0.36.0, for an app that reads companions, one of their companions' messages counts as said by one
 * of its characters, under every chat scope. Since 0.39.0 a dish's card belongs to its own campaign
 * alone: whispered to its players, it would otherwise reach another campaign one of them plays in.
 * Since 0.45.0 a public message that belongs only to other campaigns (`belongsElsewhere`) doesn't.
 * @param {ChatMessage} message
 * @param {object} audience     The message's audience in the campaign.
 * @param {Campaign} campaign
 * @param {Speakers} speakers   Whose the message is, among every campaign.
 * @returns {boolean}
 */
function isInScope(message, audience, campaign, speakers) {
  const dish = message.flags?.[MODULE_ID]?.dish;
  if ( dish && (dish.campaignId !== campaign.id) ) return false;
  if ( !isAudienceShared(audience) ) return false;
  const spokenByCampaign = speakers.campaigns.has(campaign.id);
  if ( chatScope() === CHAT_SCOPES.CONNECTED ) return spokenByCampaign;
  if ( spokenByCampaign ) return true;
  if ( !audience.characters.length ) return false;
  return !audience.public || !belongsElsewhere(campaign, speakers);
}

/**
 * Whose a message is: the campaigns that said it, by one of their characters or, for an app that
 * reads companions, one of their companions; and since 0.45.0 the combats its speaker fights in,
 * read once it's asked for.
 * @typedef {object} Speakers
 * @property {Campaign[]} all          Every campaign.
 * @property {Set<string>} campaigns   The ids of those that said it.
 * @property {() => Combat[]} fights   The combats its speaker is a combatant of.
 */

/**
 * Whose a message is, among every campaign.
 * @param {ChatMessage} message
 * @param {Campaign[]} all
 * @returns {Speakers}
 */
function speakersOf(message, all) {
  const campaigns = new Set(all.filter(campaign => (speakerCharacterId(message, campaign) !== null)
    || Boolean(messageCompanion(message, campaign))).map(campaign => campaign.id));
  let fights = null;
  return { all, campaigns, fights: () => (fights ??= speakerFights(message)) };
}

/**
 * Does a public message belong only to other campaigns, since 0.45.0? Never where its speaker is a
 * combatant of a fight this campaign is in: every card of a fight both are in is both's. Else it
 * does, for a campaign that didn't say it, when another campaign's character or companion said it,
 * or when its speaker is a combatant of a fight another campaign is in, as a fight's goblin is the
 * fight's. Every other, such as the Gamemaster's narration or an NPC in no fight, belongs to every
 * campaign, and in a world with one campaign none belongs elsewhere.
 * @param {Campaign} campaign   A campaign that didn't say it.
 * @param {Speakers} speakers
 * @returns {boolean}
 */
function belongsElsewhere(campaign, speakers) {
  const others = speakers.all.filter(other => other.id !== campaign.id);
  if ( !others.length ) return false;
  const fights = speakers.fights();
  if ( fights.some(combat => involvesCampaign(combat, campaign)) ) return false;
  if ( speakers.campaigns.size ) return true;
  return fights.some(combat => others.some(other => involvesCampaign(combat, other)));
}

/**
 * The combats a message's speaker is a combatant of: by its token, on its scene, as a token speaks;
 * or by its actor, for a linked actor, as one speaks without its token.
 * @param {ChatMessage} message
 * @returns {Combat[]}
 */
function speakerFights(message) {
  const { actor, token, scene } = message.speaker ?? {};
  const byActor = Boolean(actor) && !message.speakerActor?.isToken;
  const speaks = combatant => (Boolean(token) && (combatant.tokenId === token) && (!scene || (combatant.sceneId === scene)))
    || (byActor && (combatant.actorId === actor) && (combatant.token?.actorLink ?? true));
  return (game.combats ?? []).filter(combat => combat.combatants.some(speaks));
}

/**
 * Every campaign, with the message's audience there and whether the message belongs to it.
 * @param {ChatMessage} message
 * @returns {{campaign: Campaign, audience: object, inScope: boolean}[]}
 */
function campaignsFor(message) {
  const all = getCampaigns();
  const speakers = speakersOf(message, all);
  return all.map(campaign => {
    const audience = chatAudience(message, campaign);
    return { campaign, audience, inScope: isInScope(message, audience, campaign, speakers) };
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
