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
 * A character as a campaign's roster lists it: who it is and who plays it, without its sheet.
 * @param {Actor} actor
 * @returns {{id: string, uuid: string, name: string, img: string, type: string, owners: object[]}}
 */
export function rosterEntry(actor) {
  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    type: actor.type,
    owners: playerOwners(actor).map(user => ({ id: user.id, name: user.name }))
  };
}

/**
 * Describe a character for the listener, sheet included.
 * @param {Actor} actor
 * @param {SheetTexts} [texts]  Collects the descriptions its sheet refers to.
 * @returns {object}
 */
export function summarizeCharacter(actor, texts) {
  return { ...rosterEntry(actor), sheet: characterSheet(actor, texts) };
}

/**
 * Every character in a campaign, as its roster lists them: since 0.22.0, a bridge.hello's
 * characters, their sheets following it, each in a post of its own. Since 0.26.0 each says whether
 * its player enters its dice results in the app, `manualDice`: none does yet, since nothing per
 * character is set up for it.
 * @param {Campaign} campaign
 * @returns {object[]}
 */
export function roster(campaign) {
  return campaignActors(campaign).map(actor => ({ ...rosterEntry(actor), manualDice: false }));
}

/**
 * An actor's hit points, if its system models them the way D&D Fifth Edition does. The maximum is
 * the one dnd5e shows on its sheet and token bar, and heals up to: with any temporary change to it,
 * such as Aid's or a wraith's Life Drain, which dnd5e keeps apart from the maximum itself.
 * @param {Actor|null|undefined} actor
 * @returns {{value: number, max: number|null, temp: number}|null}
 */
export function hitPoints(actor) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !Number.isFinite(hp.value) ) return null;
  return {
    value: hp.value,
    max: Number.isFinite(hp.effectiveMax) ? hp.effectiveMax : (Number.isFinite(hp.max) ? hp.max : null),
    temp: Number.isFinite(hp.temp) ? hp.temp : 0
  };
}
