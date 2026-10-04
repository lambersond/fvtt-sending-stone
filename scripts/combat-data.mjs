import { includeGmContent } from "./config.mjs";
import { campaignCharacterId, hitPoints } from "./characters.mjs";

/**
 * Turning combats and combatants into plain data for the listener.
 */

/**
 * May the listener be told about this combatant? A hidden combatant is withheld unless
 * Gamemaster-only information is being sent, just as the combat tracker hides it from players.
 * @param {Combatant|null|undefined} combatant
 * @returns {boolean}
 */
export function isCombatantShared(combatant) {
  if ( !combatant ) return false;
  return !combatant.hidden || includeGmContent();
}

/**
 * Does a combat include any of a campaign's characters that the listener may be told about?
 * @param {Combat} combat
 * @param {Campaign} campaign
 * @param {string} [leaving]   The id of a combatant to leave out, as it is being removed.
 * @returns {boolean}
 */
export function involvesCampaign(combat, campaign, leaving) {
  return combat.combatants.some(combatant => (combatant.id !== leaving) && isCombatantShared(combatant)
    && campaign.characters.has(combatant.actorId));
}

/**
 * Describe a combatant for a campaign.
 *
 * Hit points are included for the campaign's characters, whose players can see them anyway, and
 * for everyone else only when Gamemaster-only information is being sent.
 * @param {Combatant} combatant
 * @param {Campaign} campaign
 * @returns {object}
 */
export function summarizeCombatant(combatant, campaign) {
  const actor = combatant.actor;
  const character = campaignCharacterId(actor, campaign);
  const gmContent = includeGmContent();
  const summary = {
    id: combatant.id,
    name: combatant.name,
    img: combatant.img,
    actorId: combatant.actorId ?? null,
    tokenId: combatant.tokenId ?? null,
    sceneId: combatant.sceneId ?? null,
    groupId: combatant._source.group ?? null,
    initiative: combatant.initiative ?? null,
    defeated: combatant.isDefeated,
    character,
    playerOwned: actor?.hasPlayerOwner ?? false
  };
  if ( gmContent ) summary.hidden = combatant.hidden;
  if ( character || gmContent ) summary.hp = hitPoints(actor);
  return summary;
}

/**
 * Describe a combatant for a campaign, if the listener may be told about it.
 * @param {Combatant|null|undefined} combatant
 * @param {Campaign} campaign
 * @returns {object|null}
 */
export function shareCombatant(combatant, campaign) {
  return isCombatantShared(combatant) ? summarizeCombatant(combatant, campaign) : null;
}

/**
 * Describe a combat for a campaign: its state and its combatants in turn order.
 *
 * Positions in the turn order are deliberately not given as indices. Hidden combatants are left
 * out, so an index would not match the list sent, and would reveal how many were left out.
 * @param {Combat} combat
 * @param {Campaign} campaign
 * @returns {object}
 */
export function snapshotCombat(combat, campaign) {
  const current = combat.combatant;
  return {
    id: combat.id,
    name: combat.name || null,
    sceneId: combat._source.scene ?? null,
    active: combat.active,
    started: combat.started,
    round: combat.round,
    // Before the first round the tracker may already point at someone, but it is nobody's turn.
    combatantId: (combat.started && isCombatantShared(current)) ? current.id : null,
    combatants: (combat.turns ?? []).filter(isCombatantShared).map(combatant => summarizeCombatant(combatant, campaign))
  };
}
