import { EVENTS, MODULE_ID } from "./constants.mjs";
import { chatEnabled, chatScope, combatEnabled, getDestination, includeGmContent } from "./config.mjs";
import { forgetCombats, noteCombatSent } from "./campaign-combats.mjs";
import { forgetTold } from "./character-sync.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { removalFeatures, transferFeatures } from "./command-transfers.mjs";
import { rollFeatures, stopPollers, syncPollers } from "./commands.mjs";
import { roster } from "./characters.mjs";
import { involvesCampaign, snapshotCombat } from "./combat-data.mjs";
import { foundrySettings, noteSettingsSent } from "./foundry-settings.mjs";
import { campaignGroups, groupEntry } from "./groups.mjs";
import { noteFeatures } from "./journals.mjs";
import { releaseHeldCards } from "./midi-prompts.mjs";
import { openPrompts } from "./prompts.mjs";
import { forgetSent } from "./sheet-texts.mjs";
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
 * campaign and start afresh: its characters, the combats they are in, and the saves the game is
 * asking its players for. Since 0.22.0 the characters' sheets aren't in it, which for a large party
 * made one post larger than an app takes: once it's answered, each follows in a post of its own,
 * after its descriptions (see character-sync.mjs), and it says so with `sheetsApart`. Each says
 * whether its players' rolls in the app are made here; and fetching them starts afresh, so a
 * campaign whose fetch was refused is tried again. Since 0.30.0 it lists the campaign's groups,
 * each without its sheet, which follows it as its characters' do to an app that reads groups; and
 * says what the world's settings that decide what players see are, `settings`, for its Gamemaster.
 * Since 0.31.0 it says whether its players may move items and coins from the app, beside their
 * rolls, `features.transfers`, whatever the rolls. Since 0.33.0, whether an item may be removed from
 * a character from the app, `features.removals`, under dnd5e, with no switch. Since 0.34.0, whether
 * journal notes are kept here, `features.notes`, and which of the campaign's characters and parties
 * have a journal of them.
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
    // The listener starts afresh, so every sheet and description goes again after it.
    forgetTold(campaign.id);
    forgetSent(campaign.id);
    const settings = foundrySettings(campaign);
    noteSettingsSent(campaign.id, settings);
    send(EVENTS.HELLO, {
      ...shared,
      features: {
        rolls: rollFeatures(campaign), transfers: transferFeatures(campaign), removals: removalFeatures(),
        notes: noteFeatures(campaign)
      },
      sheetsApart: true,
      characters: roster(campaign),
      groups: campaignGroups(campaign).map(group => groupEntry(group, campaign)),
      settings,
      combats: combats.map(combat => snapshotCombat(combat, campaign)),
      prompts: openPrompts(campaign)
    }, campaign);
  }
  syncPollers({ retry: true });
}

/* -------------------------------------------- */

/**
 * Announce when this client takes over as the bridge: on load, or when the Gamemaster who held
 * the role disconnects; and since 0.27.0, roll as Midi-QOL would the concentration checks held for
 * the app that no client asks any more, as after a reload. A client that is no longer the bridge
 * stops fetching players' rolls.
 * @returns {void}
 */
export function checkBridge() {
  const bridge = isBridge();
  if ( bridge && !wasBridge ) {
    announce();
    releaseHeldCards();
  }
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
