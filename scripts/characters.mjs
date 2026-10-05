import { characterSheet } from "./sheet.mjs";

/**
 * Player characters, as campaigns see them.
 *
 * A campaign's characters decide whose details it receives: their combatants carry hit points,
 * their chat messages can be singled out, and every event says which of them may see it, so the
 * listener can route each one to the right player.
 */

/**
 * The actors offered when choosing a campaign's characters, sorted by name.
 *
 * Under a system with a "character" actor type, as D&D Fifth Edition has, those are the player
 * characters. Under any other, the best available signal is an actor that a player owns.
 * @returns {Actor[]}
 */
export function candidateActors() {
  const hasCharacterType = game.documentTypes?.Actor?.includes("character") ?? false;
  return game.actors
    .filter(actor => hasCharacterType ? (actor.type === "character") : actor.hasPlayerOwner)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/**
 * A campaign's characters that still exist, in the order they were chosen.
 * @param {Campaign} campaign
 * @returns {Actor[]}
 */
export function campaignActors(campaign) {
  return Array.from(campaign.characters, id => game.actors.get(id)).filter(Boolean);
}

/**
 * The id of the campaign character an actor represents, if it represents one.
 *
 * A token's synthetic actor shares the id of the world actor it was made from, so a character
 * speaking through an unlinked token still resolves.
 * @param {Actor|null|undefined} actor
 * @param {Campaign} campaign
 * @returns {string|null}
 */
export function campaignCharacterId(actor, campaign) {
  if ( !actor ) return null;
  return campaign.characters.has(actor.id) ? actor.id : null;
}

/**
 * The non-Gamemaster users who own an actor.
 * @param {Actor} actor
 * @returns {User[]}
 */
export function playerOwners(actor) {
  return game.users.filter(user => !user.isGM && actor.testUserPermission(user, "OWNER"));
}

/**
 * A campaign's characters owned by any of the given users.
 * @param {Iterable<string>} userIds   Ids of the users who can see something.
 * @param {Campaign} campaign
 * @returns {string[]}                  Actor ids of the campaign characters those users own.
 */
export function charactersSeenBy(userIds, campaign) {
  const users = Array.from(userIds, id => game.users.get(id)).filter(Boolean);
  return campaignActors(campaign)
    .filter(actor => users.some(user => actor.testUserPermission(user, "OWNER")))
    .map(actor => actor.id);
}

/* -------------------------------------------- */

/**
 * Describe a character for the listener.
 * @param {Actor} actor
 * @returns {object}
 */
export function summarizeCharacter(actor) {
  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    type: actor.type,
    owners: playerOwners(actor).map(user => ({ id: user.id, name: user.name })),
    sheet: characterSheet(actor)
  };
}

/**
 * Describe every character in a campaign for the listener.
 * @param {Campaign} campaign
 * @returns {object[]}
 */
export function roster(campaign) {
  return campaignActors(campaign).map(summarizeCharacter);
}

/**
 * An actor's hit points, if its system models them the way D&D Fifth Edition does.
 * @param {Actor|null|undefined} actor
 * @returns {{value: number, max: number, temp: number}|null}
 */
export function hitPoints(actor) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !Number.isFinite(hp.value) ) return null;
  return {
    value: hp.value,
    max: Number.isFinite(hp.max) ? hp.max : null,
    temp: Number.isFinite(hp.temp) ? hp.temp : 0
  };
}
