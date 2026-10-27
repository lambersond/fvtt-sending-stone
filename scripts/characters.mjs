import { MODULE_ID } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { characterSheet } from "./sheet.mjs";
import { typesDice } from "./typed-dice.mjs";

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
  // Since 0.40.0 never a transformed actor, as "Elowen (Wolf)": dnd5e makes it of its original's type.
  return game.actors
    .filter(actor => (hasCharacterType ? (actor.type === "character") : actor.hasPlayerOwner) && !transformed(actor))
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
 * speaking through an unlinked token still resolves. Since 0.40.0 a transformed actor stands for
 * its original, as dnd5e records it (a form dnd5e made, `originalOf`), so a form's combatant, chat
 * and saves are its character's; and so does a form deleted since, by `endedForms`, as a chat card
 * or combatant may still name it.
 * @param {Actor|null|undefined} actor
 * @param {Campaign} campaign
 * @returns {string|null}
 */
export function campaignCharacterId(actor, campaign) {
  if ( !actor ) return null;
  const id = originalOf(actor)?.id ?? endedForms.get(actor.id) ?? actor.id;
  return campaign.characters.has(id) ? id : null;
}

/**
 * The id of the campaign character a chat message was spoken by, if one: as its speaker's actor
 * stands for one (`campaignCharacterId`), or since 0.40.0, where that actor is gone, as the form
 * its speaker names was hers. Foundry finds a message's speaker's actor each time it's read, by its
 * token and then its id, so a card a form spoke with no token in its speaker names no actor once
 * the form is deleted; it stays hers.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @returns {string|null}
 */
export function speakerCharacterId(message, campaign) {
  const found = campaignCharacterId(message?.speakerActor, campaign);
  if ( found ) return found;
  const id = endedForms.get(message?.speaker?.actor);
  return (id && campaign.characters.has(id)) ? id : null;
}

/**
 * The id of the campaign character a combatant is, if one: as its actor stands for one
 * (`campaignCharacterId`), or since 0.40.0, where that actor is gone, as the form whose id it keeps
 * was the character's. Core reads a combatant's actor through its token, and with none, as one made
 * from an actor or one whose token was deleted, by the id it keeps, which names no actor once the
 * form is deleted; it stays the character's, its turn the character's to end.
 * @param {Combatant} combatant
 * @param {Campaign} campaign
 * @returns {string|null}
 */
export function combatantCharacterId(combatant, campaign) {
  const found = campaignCharacterId(combatant?.actor, campaign);
  if ( found || combatant?.actor ) return found;
  const id = endedForms.get(combatant?.actorId);
  return (id && campaign.characters.has(id)) ? id : null;
}

/**
 * The id of the world actor an actor's id stands for, since 0.40.0: a form's, or a form's deleted
 * since, its original's; any other its own. A combatant made from a form's token keeps the form's
 * id.
 * @param {string|null|undefined} id
 * @returns {string|null}
 */
export function standingFor(id) {
  if ( !id ) return null;
  return originalOf(game.actors.get(id))?.id ?? endedForms.get(id) ?? id;
}

/* -------------------------------------------- */
/*  Transformed actors                          */
/* -------------------------------------------- */

/**
 * Each deleted form's id, by the id of the world actor it stood for, since 0.40.0: kept on every
 * client, for the session, so that what still names a form returned since, a chat card or a
 * combatant, stays its character's.
 * @type {Map<string, string>}
 */
export const endedForms = new Map();

/**
 * Note a form as it's deleted, on every client: one dnd5e transformed or the module recorded, by
 * the original dnd5e names (a player's own return in Foundry unflags `isPolymorphed` and leaves
 * it), where it's one dnd5e made of her (`madeForm`).
 * @param {Actor} actor
 * @returns {void}
 */
export function noteFormDeleted(actor) {
  const original = actor?.getFlag?.("dnd5e", "originalActor");
  if ( (typeof original !== "string") || (original === actor.id) ) return;
  if ( !madeForm(actor, game.actors.get(original)) ) return;
  if ( transformed(actor) || actor.getFlag?.(MODULE_ID, "form") ) endedForms.set(actor.id, original);
}

/**
 * Is a live actor transformed, as Wild Shape or Polymorph make one? Since 0.40.0 here, from
 * creatures.mjs, where a transformed actor is never a companion either.
 * @param {Actor|null|undefined} actor
 * @returns {boolean}
 */
export function transformed(actor) {
  return actor?.flags?.dnd5e?.isPolymorphed === true;
}

/**
 * The world actor a transformed one stands for, its first original as dnd5e records it, or null;
 * and since a player may write those flags on an actor of their own, only for a form dnd5e made of
 * it (`madeForm`): any other stands for itself.
 * @param {Actor|null|undefined} actor
 * @returns {Actor|null}
 */
export function originalOf(actor) {
  if ( !transformed(actor) ) return null;
  const original = game.actors.get(actor.getFlag("dnd5e", "originalActor")) ?? null;
  return madeForm(actor, original) ? original : null;
}

/**
 * The world actor a character is transformed into now, if any: the newest of a chain, dnd5e listing
 * each earlier form in `previousActorIds`, and of two or more forms made apart, the newest by its
 * record's start, then by its creation. A token's own transformation makes no world actor, and is
 * never one.
 * @param {Actor} character
 * @returns {Actor|null}
 */
export function activeForm(character) {
  if ( !character?.id ) return null;
  const forms = game.actors.filter(actor => transformed(actor) && !actor.isToken
    && (actor.getFlag("dnd5e", "originalActor") === character.id) && madeForm(actor, character));
  const earlier = new Set(forms.flatMap(form => form.getFlag("dnd5e", "previousActorIds") ?? []));
  const started = actor => actor.getFlag(MODULE_ID, "form")?.startedAt ?? -Infinity;
  const newest = (a, b) => ((started(b) - started(a)) || ((b._stats?.createdTime ?? 0) - (a._stats?.createdTime ?? 0)));
  return forms.filter(form => !earlier.has(form.id)).sort(newest)[0] ?? null;
}

/**
 * Does an actor look like a form dnd5e made of this character, as `transformInto` makes one: never
 * the character itself, one of a campaign's characters, nor a copy of an actor (Foundry's Duplicate
 * notes its source); owned by no player who doesn't own her, as dnd5e copies her ownership onto it;
 * and each earlier form it names (dnd5e's `previousActorIds`) she, a form of hers, or one gone. A
 * player owns their own actor and may write dnd5e's flags on it, so nothing else that names her is
 * taken for her form: the bridge, as a Gamemaster, follows, ends, returns, deletes and carries back
 * only what dnd5e made (since 0.40.0).
 * @param {Actor|null|undefined} form
 * @param {Actor|null|undefined} original
 * @returns {boolean}
 */
export function madeForm(form, original) {
  if ( !form?.id || !original?.id || (form.id === original.id) ) return false;
  if ( form.getFlag?.("dnd5e", "originalActor") !== original.id ) return false;
  const named = actor => getCampaigns().some(campaign => campaign.characters.has(actor.id)) || Boolean(actor._stats?.duplicateSource);
  if ( named(form) ) return false;
  const hers = new Set(playerOwners(original).map(user => user.id));
  if ( playerOwners(form).some(user => !hers.has(user.id)) ) return false;
  const earlier = form.getFlag("dnd5e", "previousActorIds") ?? [];
  if ( !Array.isArray(earlier) ) return false;
  return earlier.every(id => {
    if ( id === original.id ) return true;
    const actor = game.actors.get(id);
    return !actor || (transformed(actor) && (actor.getFlag("dnd5e", "originalActor") === original.id) && !named(actor));
  });
}

/**
 * The actor a character acts as now: its active form, or itself.
 * @param {Actor} character
 * @returns {Actor}
 */
export function seatActor(character) {
  return activeForm(character) ?? character;
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
 * its player may enter its dice results in the app, `manualDice`; since 0.32.0 that's so where the
 * campaign lets its players and its primary player has Make Manual Rolls (typed-dice.mjs).
 * @param {Campaign} campaign
 * @returns {object[]}
 */
export function roster(campaign) {
  return campaignActors(campaign).map(actor => ({ ...rosterEntry(actor), manualDice: typesDice(actor, campaign) }));
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
