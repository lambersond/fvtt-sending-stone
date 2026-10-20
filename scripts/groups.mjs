import { EVENTS } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { groupsWanted } from "./character-sync.mjs";
import { campaignActors, playerOwners } from "./characters.mjs";

/**
 * Groups: since 0.30.0, the Group actors, parties, a campaign's Gamemaster adds to it, whose sheets
 * its players see in the app as Foundry lets them.
 *
 * Only D&D Fifth Edition has them, as its "group" Actor type, apart from its encounters. Who may see
 * one mirrors Foundry: a campaign character whose player has Observer or Owner on the group, Limited
 * or less counting as none. Each is sent only to an app that says it reads them, in its answers'
 * `features.groups`: an older one has nowhere to put them.
 */

/**
 * The campaigns whose app reads groups, by id, as their latest answer to a hello or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/* -------------------------------------------- */

/**
 * Are there groups in this world at all: under D&D Fifth Edition, with its Group Actor type?
 * @returns {boolean}
 */
export function groupsAvailable() {
  return (game.system?.id === "dnd5e") && (game.documentTypes?.Actor?.includes("group") === true);
}

/**
 * The Group actors a campaign can be given, the primary party first, then by name. Never an
 * encounter, which dnd5e keeps as an Actor type of its own.
 * @returns {Actor[]}
 */
export function candidateGroups() {
  if ( !groupsAvailable() ) return [];
  const primary = primaryPartyId();
  const lang = game.i18n.lang;
  return game.actors.filter(actor => actor.type === "group")
    .sort((a, b) => (Number(b.id === primary) - Number(a.id === primary)) || a.name.localeCompare(b.name, lang));
}

/**
 * A campaign's groups that still exist as groups, in the order the Gamemaster added them.
 * @param {Campaign} campaign
 * @returns {Actor[]}
 */
export function campaignGroups(campaign) {
  if ( !groupsAvailable() ) return [];
  return Array.from(campaign.groups ?? [], id => game.actors.get(id)).filter(actor => actor?.type === "group");
}

/**
 * A group as a campaign is told of it, without its sheet: who it is, whether it's the world's
 * primary party, and which of the campaign's characters may see it, by their players' ownership of
 * it in Foundry.
 * @param {Actor} group
 * @param {Campaign} campaign
 * @returns {{id: string, uuid: string, name: string, img: string|null, type: "group", primary: boolean,
 *   access: Record<string, "observer"|"owner">}}
 */
export function groupEntry(group, campaign) {
  return {
    id: group.id,
    uuid: group.uuid,
    name: group.name,
    img: group.img ?? null,
    type: "group",
    primary: primaryPartyId() === group.id,
    access: accessOf(group, campaign)
  };
}

/**
 * Which of a campaign's characters may see a group, as Foundry lets their players: each by the
 * highest ownership of the group among its players, or for one no player owns, the group's default.
 * Observer or Owner; Limited or less leaves it out. A Gamemaster sees every group, and isn't asked.
 * @param {Actor} group
 * @param {Campaign} campaign
 * @returns {Record<string, "observer"|"owner">}
 */
function accessOf(group, campaign) {
  const access = {};
  for ( const actor of campaignActors(campaign) ) {
    const level = accessFor(group, actor);
    if ( level ) access[actor.id] = level;
  }
  return access;
}

/**
 * What one character may do with a group, as Foundry lets its players: by the highest ownership of
 * the group among them, or for one no player owns, the group's default. Owner, Observer, or none for
 * Limited or less. Since 0.31.0 also who may move items and coins with a group from the app, so that
 * the module and the app, which is told `access`, can't disagree.
 * @param {Actor} group
 * @param {Actor} actor
 * @returns {"owner"|"observer"|null}
 */
export function accessFor(group, actor) {
  const { OBSERVER, OWNER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const owners = playerOwners(actor);
  const level = owners.length
    ? Math.max(...owners.map(user => Number(group.getUserLevel(user)) || 0))
    : (Number(group.ownership?.default) || 0);
  if ( level >= OWNER ) return "owner";
  if ( level >= OBSERVER ) return "observer";
  return null;
}

/**
 * Every campaign group an actor is a member of, as the group was last prepared: one deleted since
 * is still found, the group not being prepared again for it.
 * @param {string} actorId
 * @returns {{campaign: Campaign, group: Actor}[]}
 */
export function groupsListing(actorId) {
  const found = [];
  for ( const campaign of getCampaigns() ) {
    for ( const group of campaignGroups(campaign) ) {
      if ( memberIds(group).has(actorId) ) found.push({ campaign, group });
    }
  }
  return found;
}

/**
 * How many members a group has, as dnd5e last prepared it.
 * @param {Actor} group
 * @returns {number}
 */
export function memberCount(group) {
  return memberIds(group).size;
}

/**
 * A group's members that are the campaign's characters, as dnd5e last prepared it, in its order:
 * those a party's coin is distributed among, since 0.32.0.
 * @param {Actor} group
 * @param {Campaign} campaign
 * @returns {Actor[]}
 */
export function campaignMembers(group, campaign) {
  return Array.from(memberIds(group), id => game.actors.get(id))
    .filter(actor => actor && campaign.characters.has(actor.id));
}

/**
 * The ids of a group's members, as dnd5e prepares them (data/actor/group.mjs).
 * @param {Actor} group
 * @returns {Set<string>}
 */
function memberIds(group) {
  const members = group.system?.members;
  if ( members?.ids instanceof Set ) return members.ids;
  return new Set(Array.from(members ?? [], member => member?.actor?.id).filter(Boolean));
}

/**
 * The world's primary party, as dnd5e's actors directory sets it; none where it can't be read.
 * @returns {string|null}
 */
export function primaryPartyId() {
  try {
    return game.actors.party?.id ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------- */

/**
 * Note whether a campaign's app reads groups, from what it said in answer to its hello or heartbeat:
 * `features.groups`, the format it reads, 1 or later. One that starts to in a heartbeat's answer, as
 * an app deployed mid-session does, is sent every group at once; after a hello's, they follow its
 * characters. One that says nothing of them, as an older or rolled back app, is sent none.
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteGroupReader(campaignId, features, type) {
  const format = features?.groups;
  if ( !(Number.isInteger(format) && (format >= 1)) ) {
    readers.delete(campaignId);
    return;
  }
  const was = readers.has(campaignId);
  readers.add(campaignId);
  if ( !was && (type === EVENTS.HEARTBEAT) ) groupsWanted(campaignId);
}

/**
 * Does a campaign's app read groups?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function groupReader(campaignId) {
  return readers.has(campaignId);
}
