import { EVENTS, MODULE_ID } from "./constants.mjs";
import { chatEnabled, chatScope, combatEnabled, getDestination, includeGmContent } from "./config.mjs";
import { forgetCombats, noteCombatSent } from "./campaign-combats.mjs";
import { noteCharactersSent } from "./character-sync.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { rollFeatures, stopPollers, syncPollers } from "./commands.mjs";
import { roster } from "./characters.mjs";
import { involvesCampaign, snapshotCombat } from "./combat-data.mjs";
import { openPrompts } from "./prompts.mjs";
import { noteTextsSent, sendTexts, SheetTexts } from "./sheet-texts.mjs";
import { send } from "./transport.mjs";

/**
 * The bridge: the single client that talks to the listener.
 *
 * Document hooks fire on every connected client, so if every client posted what it saw the
 * listener would receive each event once per user. Only the active Gamemaster posts. They can see
 * every message and combatant, which is what lets this module decide what players may see rather
 * than being limited to it. With no Gamemaster connected, nothing is sent.
 */

/**
 * Was this client the bridge when last checked? Used to notice the role arriving here.
 * @type {boolean}
 */
let wasBridge = false;

/**
 * Is this client the one that posts events?
 * @returns {boolean}
 */
export function isBridge() {
  return (game.ready === true) && (game.user?.isActiveGM === true);
}

/**
 * Should this client post events right now? It must be the bridge and have somewhere to post.
 * @returns {boolean}
 */
export function canSend() {
  return isBridge() && (getDestination() !== "");
}

/* -------------------------------------------- */

/**
 * How long to wait before resending a campaign's state when the listener asks for it again, in
 * milliseconds. Every answer while the first resend is on its way would otherwise ask again.
 * @type {number}
 */
const RESEND_AFTER = 30_000;

/**
 * When each campaign's state was last resent at the listener's request, by campaign id.
 * @type {Map<string, number>}
 */
const resent = new Map();

/* -------------------------------------------- */

/**
 * Send each campaign its full current state, so the listener can discard whatever it held for the
 * campaign and start afresh: its characters with their sheets, the combats they are in, and the
 * saves the game is asking its players for. The sheets' descriptions go first, in character.texts.
 * Each says whether its players' rolls in the app are made here; and fetching them starts afresh,
 * so a campaign whose fetch was refused is tried again.
 * @param {object} [options]
 * @param {string} [options.campaignId]   Send only this campaign its state.
 * @returns {void}
 */
export function announce({ campaignId }={}) {
  if ( !canSend() ) return;
  const module = game.modules.get(MODULE_ID);
  const shared = {
    module: { id: MODULE_ID, version: module?.version ?? null },
    foundry: { version: game.version, generation: game.release?.generation ?? null },
    system: { id: game.system.id, title: game.system.title, version: game.system.version },
    bridge: { userId: game.user.id, name: game.user.name },
    config: {
      chat: chatEnabled(),
      chatScope: chatScope(),
      combat: combatEnabled(),
      gmContent: includeGmContent()
    }
  };

  forgetCombats(campaignId);
  for ( const campaign of getCampaigns() ) {
    if ( (campaignId !== undefined) && (campaign.id !== campaignId) ) continue;
    const combats = combatEnabled() ? game.combats.filter(combat => involvesCampaign(combat, campaign)) : [];
    for ( const combat of combats ) noteCombatSent(combat.id, campaign.id);
    const texts = new SheetTexts();
    const characters = roster(campaign, texts);
    noteCharactersSent(campaign, characters);
    noteTextsSent(campaign, texts.sources.keys());
    sendTexts(campaign, texts.sources);
    send(EVENTS.HELLO, {
      ...shared,
      features: { rolls: rollFeatures(campaign) },
      characters,
      combats: combats.map(combat => snapshotCombat(combat, campaign)),
      prompts: openPrompts(campaign)
    }, campaign);
  }
  syncPollers({ retry: true });
}

/* -------------------------------------------- */

/**
 * Announce when this client takes over as the bridge: on load, or when the Gamemaster who held
 * the role disconnects. A client that is no longer the bridge stops fetching players' rolls.
 * @returns {void}
 */
export function checkBridge() {
  const bridge = isBridge();
  if ( bridge && !wasBridge ) announce();
  if ( !bridge && wasBridge ) stopPollers();
  wasBridge = bridge;
}

/* -------------------------------------------- */

/**
 * Resend a campaign its full state because the listener asked for it, for instance because the
 * campaign was set up there after its bridge.hello was refused.
 * @param {string} campaignId
 * @returns {void}
 */
export function resendHello(campaignId) {
  const last = resent.get(campaignId) ?? -Infinity;
  if ( Date.now() - last < RESEND_AFTER ) return;
  resent.set(campaignId, Date.now());
  announce({ campaignId });
}
