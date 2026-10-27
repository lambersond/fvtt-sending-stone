import { MOST_COMPANIONS, MOST_COMPANIONS_EACH } from "./constants.mjs";
import { activeForm, campaignActors, playerOwners, transformed } from "./characters.mjs";
import { wildShapeReader } from "./command-wildshape.mjs";

/**
 * A campaign's characters' companions, since 0.36.0: the creatures each summoned in Foundry, whose
 * tokens are on the active scene, and the NPCs its players own there by name (round 0.36.0 §2.1).
 * dnd5e has no companion, familiar or sidekick type; it marks a summoned creature with the item
 * that summoned it, `flags.dnd5e.summon.origin`, which this reads itself, as dnd5e's own registry
 * misses linked summons and fills lazily, per client.
 *
 * A creature is read as its live actor: a token's synthetic actor for an unlinked token, whose
 * flags, hit points and ownership are its delta's over its base's, and the world actor otherwise.
 * Nothing ever reads the base actor of a token's creature. Not "companions.mjs", which is the
 * author's other Foundry modules.
 */

/**
 * The longest name a companion is listed by, and the longest portrait path, in characters.
 * @type {number}
 */
const LONGEST_NAME = 200;
const LONGEST_IMG = 2_000;

/**
 * A companion as a campaign lists it, without its sheet, which follows to an app that reads them.
 * @typedef {object} CompanionEntry
 * @property {string} key             Its actor's id, or for a token's creature `<sceneId>-<tokenId>`.
 * @property {string[]} of            The campaign characters it's a companion of, by actor id.
 * @property {"owned"|"summoned"} kind
 * @property {string} actorId         Its world actor's id; for a token's creature, its base actor's.
 * @property {string|null} tokenId    A token's creature only.
 * @property {string|null} sceneId    A token's creature only.
 * @property {string} uuid            Its live actor's uuid.
 * @property {string} name            The token's name for a token's creature, else the actor's.
 * @property {string|null} img        Its live actor's portrait, where it has one short enough.
 * @property {{itemId: string, item: string, activityId: string|null}|null} summon
 *                                    For a summoned one: the item that summoned it, and its activity.
 */

/* -------------------------------------------- */

/**
 * The key a creature is listed by: its actor's id, or a token's `<sceneId>-<tokenId>` (round 0.36.0 §2.2).
 * A hyphen never occurs in Foundry's ids, so the key is a plain path segment that names one token.
 * @param {TokenDocument|Actor|null|undefined} tokenOrActor   A token, or an actor, a token's own among them.
 * @returns {string|null}
 */
export function creatureKey(tokenOrActor) {
  const token = (tokenOrActor?.documentName === "Token") ? tokenOrActor
    : (tokenOrActor?.isToken ? tokenOrActor.token : null);
  if ( token && !token.actorLink ) {
    const sceneId = token.parent?.id;
    return (sceneId && token.id) ? `${sceneId}-${token.id}` : null;
  }
  return (token ? token.actorId : tokenOrActor?.id) ?? null;
}

/**
 * A campaign's characters' companions now, by round 0.36.0 §2.1: each listed entry and its live
 * actor, in the list's order, at most MOST_COMPANIONS.
 *
 * Each character's are its owned ones first, then its summoned ones, each by name, then key, at
 * most MOST_COMPANIONS_EACH; the campaign's are its characters' in the order the Gamemaster listed
 * them, one of several characters' listed once, at the first, naming each it's a companion of. A
 * token is looked at once, summoned before owned, and is skipped by what its source says before its
 * actor is read, which makes up a delta Foundry keeps unread until then.
 * @param {Campaign} campaign
 * @returns {{entry: CompanionEntry, actor: Actor}[]}
 */
export function companionsOf(campaign) {
  const characters = campaignActors(campaign);
  if ( !characters.length ) return [];
  const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const players = characters.map(character => ({ character, users: playerOwners(character) }));
  // The characters whose players own a live actor in Foundry by name, never through its default.
  const ownersOf = actor => players
    .filter(({ users }) => users.some(user => actor.ownership?.[user.id] === owner))
    .map(({ character }) => character);
  // The campaign character whose item summoned a live actor, if one did. Since 0.40.0 one summoned
  // by her form's copy of the item, while she's shaped, is hers too, while the form exists.
  const forms = new Map(characters.map(character => [character.id, activeForm(character)?.id ?? null]));
  const summonerOf = actor => {
    const origin = foundry.utils.getProperty(actor, "flags.dnd5e.summon.origin");
    if ( typeof origin !== "string" ) return null;
    const by = id => Boolean(id) && origin.startsWith(`Actor.${id}.Item.`);
    return characters.find(character => by(character.id) || by(forms.get(character.id))) ?? null;
  };
  const found = new Map();
  const note = (key, kind, actor, token, of) => {
    if ( !key || found.has(key) || !of.length ) return;
    found.set(key, { key, kind, actor, token, of });
  };

  // The active scene's tokens: summoned ones of every kind, and owned unlinked ones.
  const tokens = game.scenes?.active?.tokens ?? [];
  for ( const token of tokens ) {
    if ( token.hidden ) continue;
    if ( game.actors.get(token.actorId)?.type !== "npc" ) continue;
    const actor = token.actor;
    // A transformed actor is never one: dnd5e copies its original's type, ownership and flags onto it.
    if ( !actor || (actor.type !== "npc") || transformed(actor) || campaign.characters.has(actor.id) ) continue;
    const key = creatureKey(token);
    const summoner = summonerOf(actor);
    if ( summoner ) {
      note(key, "summoned", actor, token.actorLink ? null : token, [summoner]);
      continue;
    }
    if ( token.actorLink || !ownable(actor) ) continue;
    note(key, "owned", actor, token, ownersOf(actor));
  }

  // The world's linked NPCs its players own, wherever their tokens are.
  const linked = game.actors.filter(actor => (actor.type === "npc") && (actor.prototypeToken?.actorLink === true));
  for ( const actor of linked ) {
    if ( campaign.characters.has(actor.id) || transformed(actor) || !ownable(actor) ) continue;
    note(actor.id, "owned", actor, null, ownersOf(actor));
  }

  // Each character's, capped, then the campaign's, in its characters' order.
  const byName = (a, b) => (a.name.localeCompare(b.name, game.i18n.lang) || a.key.localeCompare(b.key));
  const listed = new Map();
  for ( const character of characters ) {
    const own = Array.from(found.values()).filter(each => each.of.includes(character))
      .map(each => ({ ...each, name: nameOf(each.actor, each.token) }));
    const kept = [
      ...own.filter(each => each.kind === "owned").sort(byName),
      ...own.filter(each => each.kind === "summoned").sort(byName)
    ].slice(0, MOST_COMPANIONS_EACH);
    for ( const each of kept ) {
      const entry = listed.get(each.key);
      if ( entry ) entry.of.push(character.id);
      else listed.set(each.key, { ...each, of: [character.id], summoner: (each.kind === "summoned") ? character : null });
    }
  }
  return Array.from(listed.values()).slice(0, MOST_COMPANIONS).map(each => ({
    entry: entryOf(each),
    actor: each.actor
  }));
}

/**
 * A campaign's list of companions, as the hello and `companions.listed` send it.
 * @param {Campaign} campaign
 * @returns {CompanionEntry[]}
 */
export function companionList(campaign) {
  return companionsOf(campaign).map(({ entry }) => entry);
}

/**
 * The companion of a campaign character by its key, now, within the capped list; null where it
 * isn't one now: read by §2.1's rule as it is this moment, never by what was last sent, so that a
 * token hidden or deleted a moment ago is no one's companion at once.
 * @param {Campaign} campaign
 * @param {string} key
 * @param {string} characterId
 * @returns {{entry: CompanionEntry, actor: Actor}|null}
 */
export function findCompanion(campaign, key, characterId) {
  if ( typeof key !== "string" ) return null;
  return companionsOf(campaign).find(({ entry }) => (entry.key === key) && entry.of.includes(characterId)) ?? null;
}

/**
 * The companion a live actor is, by its uuid, among the entries given; null for none.
 * @param {CompanionEntry[]} entries
 * @param {Actor|null|undefined} actor
 * @returns {CompanionEntry|null}
 */
export function companionOfActor(entries, actor) {
  const uuid = actor?.uuid;
  if ( !uuid || !Array.isArray(entries) ) return null;
  return entries.find(entry => entry.uuid === uuid) ?? null;
}

/**
 * The key a combatant is listed by, if it's among the entries given: its token's for an unlinked
 * token, else its actor's.
 * @param {CompanionEntry[]} entries
 * @param {Combatant} combatant
 * @returns {string|null}
 */
export function companionKeyOf(entries, combatant) {
  if ( !Array.isArray(entries) || !combatant ) return null;
  const linked = combatant.token?.actorLink ?? true;
  const entry = entries.find(each => (each.tokenId
    ? ((each.tokenId === combatant.tokenId) && (each.sceneId === combatant.sceneId))
    : (linked && (each.actorId === combatant.actorId))));
  return entry?.key ?? null;
}

/**
 * Does a player of one of these characters own this live actor in Foundry, by id, never through
 * `default`? A companion none of their players owns goes without the Gamemaster's secrets.
 * @param {Actor} actor
 * @param {Iterable<string|Actor>} characters   The characters, or their actor ids.
 * @returns {boolean}
 */
export function ownedByPlayers(actor, characters) {
  const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return Array.from(characters ?? []).some(each => {
    const character = (typeof each === "string") ? game.actors.get(each) : each;
    return Boolean(character) && playerOwners(character).some(user => actor?.ownership?.[user.id] === owner);
  });
}

/**
 * The actor a fetched command is made for, and the character whose player makes it: a campaign
 * character's own, or since 0.36.0 one of its companions, named by `of` (round 0.36.0 §4.7). The
 * companion's key is the command's `actorId`, never a campaign character's, so a module before
 * 0.36.0, which ignores `of`, refuses it as unknown rather than making it as the character.
 *
 * Since 0.40.0, for a campaign whose app takes Wild Shape, a character shaped acts as her form, its
 * `form`, whose sheet that app was sent under her id, so its rolls and item ids are the form's; the
 * result is still hers, and queued by her id. Any other app was sent her own sheet, and gets her own.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {{actor: Actor, character: Actor, companion: CompanionEntry|null, form: Actor|null}|null}
 */
export function commandActor(command, campaign) {
  if ( (command.of === undefined) || (command.of === null) ) {
    const character = game.actors.get(command.actorId);
    if ( !character || !campaign.characters.has(character.id) ) return null;
    const form = wildShapeReader(campaign.id) ? activeForm(character) : null;
    return { actor: form ?? character, character, companion: null, form };
  }
  if ( !campaign.characters.has(command.of) ) return null;
  const character = game.actors.get(command.of);
  if ( !character ) return null;
  const found = findCompanion(campaign, command.actorId, command.of);
  return found ? { actor: found.actor, character, companion: found.entry, form: null } : null;
}

/* -------------------------------------------- */

/**
 * May a live actor be an owned companion: neither a summon nor a summon's template?
 * @param {Actor} actor
 * @returns {boolean}
 */
function ownable(actor) {
  if ( foundry.utils.getProperty(actor, "flags.dnd5e.summon") ) return false;
  return foundry.utils.getProperty(actor, "flags.dnd5e.isAutoImported") !== true;
}

/**
 * The name a creature is listed by: its token's, for a token's creature, else its actor's.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 * @returns {string}
 */
function nameOf(actor, token) {
  return String((token ? token.name : null) ?? actor.name ?? "").slice(0, LONGEST_NAME);
}

/**
 * A creature found, as its entry lists it.
 * @param {{key: string, kind: string, actor: Actor, token: TokenDocument|null, of: string[],
 *   name: string, summoner: Actor|null}} found
 * @returns {CompanionEntry}
 */
function entryOf({ key, kind, actor, token, of, name, summoner }) {
  const img = (typeof actor.img === "string") && actor.img && (actor.img.length <= LONGEST_IMG) ? actor.img : null;
  return {
    key,
    of,
    kind,
    actorId: token ? token.actorId : actor.id,
    tokenId: token ? token.id : null,
    sceneId: token ? (token.parent?.id ?? null) : null,
    uuid: actor.uuid,
    name,
    img,
    summon: summoner ? summonOf(actor, summoner) : null
  };
}

/**
 * The item that summoned a creature, of its summoner's, and the activity it was summoned with.
 * @param {Actor} actor
 * @param {Actor} summoner
 * @returns {{itemId: string, item: string, activityId: string|null}}
 */
function summonOf(actor, summoner) {
  const flag = foundry.utils.getProperty(actor, "flags.dnd5e.summon") ?? {};
  // Since 0.40.0 the origin may name her form, whose copy of the item has the item's own id.
  const itemId = String(flag.origin).split(".")[3] ?? "";
  return {
    itemId,
    item: summoner.items?.get?.(itemId)?.name ?? "",
    activityId: (typeof flag.activity === "string") ? flag.activity : null
  };
}
