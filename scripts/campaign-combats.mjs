import { EVENTS } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { involvesCampaign, snapshotCombat } from "./combat-data.mjs";
import { send } from "./transport.mjs";

/**
 * Which campaigns each combat has been sent to.
 *
 * A campaign hears about a combat while any of its characters are in it. When the first of them
 * joins, the combat reaches the campaign as combat.created, with everything up to that moment;
 * when the last of them leaves, as combat.ended, since for that campaign the fight is over. Both
 * need to know what each campaign was last told, which is kept here.
 *
 * This lives only in the browser that sends events. Whichever browser takes over sending starts
 * with bridge.hello, which tells every campaign about its combats afresh, so nothing is lost.
 */

/**
 * The ids of the campaigns each combat has been sent to, by combat id.
 * @type {Map<string, Set<string>>}
 */
const told = new Map();

/**
 * Forget what campaigns were told, before bridge.hello tells them afresh.
 * @param {string} [campaignId]   The one campaign to forget for. Every campaign if omitted.
 * @returns {void}
 */
export function forgetCombats(campaignId) {
  if ( campaignId === undefined ) told.clear();
  else for ( const campaigns of told.values() ) campaigns.delete(campaignId);
}

/**
 * Record that a campaign has been told about a combat.
 * @param {string} combatId
 * @param {string} campaignId
 * @returns {void}
 */
export function noteCombatSent(combatId, campaignId) {
  if ( !told.has(combatId) ) told.set(combatId, new Set());
  told.get(combatId).add(campaignId);
}

/**
 * Send a combat event to each campaign it concerns. A campaign whose characters have just joined
 * the fight is sent the whole combat instead; one whose last character has just left is told the
 * fight is over for it.
 * @param {Combat} combat           The combat the event is about.
 * @param {string} type             One of EVENTS.
 * @param {(campaign: Campaign) => object} payload   The event's payload for a campaign.
 * @param {object} [options]
 * @param {string} [options.leaving]   The id of a combatant being removed, to count as gone.
 * @returns {void}
 */
export function sendCombatEvent(combat, type, payload, { leaving }={}) {
  for ( const campaign of getCampaigns() ) {
    const involved = involvesCampaign(combat, campaign, leaving);
    const knows = told.get(combat.id)?.has(campaign.id) ?? false;
    if ( involved && !knows ) {
      send(EVENTS.COMBAT_CREATED, { combat: snapshotCombat(combat, campaign) }, campaign);
      noteCombatSent(combat.id, campaign.id);
    }
    else if ( !involved && knows ) {
      send(EVENTS.COMBAT_ENDED, { combat: snapshotCombat(combat, campaign) }, campaign);
      told.get(combat.id).delete(campaign.id);
    }
    else if ( involved ) send(type, payload(campaign), campaign);
  }
}

/**
 * Check a campaign's combats again, as its characters' companions change, since 0.36.0: one it
 * would be told of now and hasn't been, as a fight with only a familiar in it, reaches it as
 * combat.created; one it has been and wouldn't now leaves it, as combat.ended; and one it has been
 * told of, a combatant of which it would be told of otherwise now, as a familiar listed since, goes
 * again whole, as combat.created, which the app takes as the combat as it now is.
 * @param {Campaign} campaign
 * @param {(combatant: Combatant) => boolean} [changed]   Is a combatant described otherwise now?
 * @returns {void}
 */
export function recheckCombats(campaign, changed=() => false) {
  for ( const combat of game.combats?.filter?.(() => true) ?? [] ) {
    const involved = involvesCampaign(combat, campaign);
    const knows = told.get(combat.id)?.has(campaign.id) ?? false;
    if ( involved && !knows ) {
      send(EVENTS.COMBAT_CREATED, { combat: snapshotCombat(combat, campaign) }, campaign);
      noteCombatSent(combat.id, campaign.id);
    }
    else if ( !involved && knows ) {
      send(EVENTS.COMBAT_ENDED, { combat: snapshotCombat(combat, campaign) }, campaign);
      told.get(combat.id).delete(campaign.id);
    }
    else if ( involved && combat.combatants.some(changed) ) {
      send(EVENTS.COMBAT_CREATED, { combat: snapshotCombat(combat, campaign) }, campaign);
    }
  }
}

/**
 * Tell every campaign that has heard about a combat that it has ended, as it is being deleted.
 * @param {Combat} combat
 * @returns {void}
 */
export function sendCombatEnded(combat) {
  for ( const campaign of getCampaigns() ) {
    const knows = told.get(combat.id)?.has(campaign.id) ?? false;
    if ( knows || involvesCampaign(combat, campaign) ) {
      send(EVENTS.COMBAT_ENDED, { combat: snapshotCombat(combat, campaign) }, campaign);
    }
  }
  told.delete(combat.id);
}
