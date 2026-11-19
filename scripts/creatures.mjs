import { MOST_COMPANIONS, MOST_COMPANIONS_EACH } from "./constants.mjs";
import { activeForm, campaignActors, characterPlayers, transformed } from "./characters.mjs";
import { wildShapeReader } from "./wild-shape.mjs";

/**
 * A campaign's characters' companions, since 0.36.0: the creatures each summoned in Foundry, whose
 * tokens are on the active scene, and the NPCs its players own there by name (round 0.36.0 §2.1), its
 * players since 0.45.0 those who own it by name, else those it's assigned to (`characterPlayers`).
 * Since 0.51.0, for an app that reads them there (`"companions": 3`), on every scene, each saying
 * whether it's away, on another scene than the active one.
 * dnd5e has no companion, familiar or sidekick type; it marks a summoned creature with the item
 * that summoned it, `flags.dnd5e.summon.origin`, which this reads itself, as dnd5e's own registry
 * misses linked summons and fills lazily, per client.
 *
 * A creature is read as its live actor: a token's synthetic actor for an unlinked token, whose
 * flags, hit points and ownership are its delta's over its base's, and the world actor otherwise.
 * Nothing ever reads the base actor of a token's creature. Not "companions.mjs", which is the
 * author's other Foundry modules.
 *
 * It keeps, too, the format each campaign's app reads companions in, as its latest answer said it,
 * which creature-sync.mjs reads to send them: here, beside the rule of what's listed, so that the
 * rule can follow it.
 */

/**
 * The longest name a companion is listed by, and the longest portrait path, in characters.
 * @type {number}
 */
const LONGEST_NAME = 200;
const LONGEST_IMG = 2_000;

/**
 * The campaigns whose app's latest answer said it reads companions, `features.companions` 1 or more,
 * and the format it said, 2 or more since 0.41.0 for one that reads what the game asks of them.
 * @type {Map<string, number>}
 */
const readers = new Map();

/**
 * The format from which an app reads companions on every scene, each with `away`: since 0.51.0.
 * @type {number}
 */
const AWAY_FORMAT = 3;

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
 * @property {boolean} [away]         Since 0.51.0, to an app that reads companions on every scene
 *                                    only: none of its tokens is on the active scene, and one is on another.
 */

/* -------------------------------------------- */
/*  The listener's format                       */
/* -------------------------------------------- */

/**
 * Note the format a campaign's app reads companions in, from what it said in answer to its hello or
 * heartbeat: `features.companions`, an integer, 1 or more; none where it said anything else, or
 * nothing. The one writer of the formats.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {number}   The format it read them in before, 0 for none.
 */
export function noteCompanionFormat(campaignId, features) {
  const was = readers.get(campaignId) ?? 0;
  const format = features?.companions;
  if ( Number.isInteger(format) && (format >= 1) ) readers.set(campaignId, format);
  else readers.delete(campaignId);
  return was;
}

/**
 * The format a campaign's app reads companions in, as its latest answer said: 0 for none.
 * @param {string} campaignId
 * @returns {number}
 */
export function companionFormat(campaignId) {
  return readers.get(campaignId) ?? 0;
}

/**
 * Does a campaign's app read its companions on every scene, each with `away`, since 0.51.0: its
 * latest answer said `companions` 3 or more?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function awayReader(campaignId) {
  return companionFormat(campaignId) >= AWAY_FORMAT;
}

/* -------------------------------------------- */
/*  The list                                    */
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
 * The id a companion's prompts name it by, since 0.41.0: its token's for a token's creature, else its
 * world actor's, a plain id, where its key may hold a "-" that a prompt's id can't (round 0.41.0 §3.2).
 * Two wolves of one Wolf share their actor's id, never their tokens'.
 * @param {CompanionEntry} entry
 * @returns {string}
 */
export function companionPart(entry) {
  return entry.tokenId ?? entry.actorId;
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
 *
 * Since 0.51.0, `everywhere`, as for an app that reads them there: the tokens of every scene, each
 * entry ending with `away`, and both cuts keeping those not away first, in the list's order. An
 * unlinked token there is skipped before its actor is made up where neither its delta nor its base
 * actor could make it one, a summon or owned by one of the campaign's players by id
 * (`mayBeCompanion`), so that the NPCs of old maps cost nothing more than a look. Otherwise today's
 * list, of the active scene's tokens, byte for byte.
 * @param {Campaign} campaign
 * @param {object} [options]
 * @param {boolean} [options.everywhere]   Every scene, each with `away`: as the campaign's app reads them.
 * @returns {{entry: CompanionEntry, actor: Actor}[]}
 */
export function companionsOf(campaign, { everywhere=awayReader(campaign.id) }={}) {
  const characters = campaignActors(campaign);
  if ( !characters.length ) return [];
  const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const players = characters.map(character => ({ character, users: characterPlayers(character) }));
  const playerIds = Array.from(new Set(players.flatMap(({ users }) => users.map(user => user.id))));
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

  // The active scene's tokens, or since 0.51.0 every scene's: summoned ones of every kind, and owned
  // unlinked ones; and, on every scene, where each linked actor's tokens are, hidden or not.
  const active = game.scenes?.active ?? null;
  const scenes = everywhere ? Array.from(game.scenes ?? []) : [active].filter(Boolean);
  const places = new Map();
  for ( const scene of scenes ) {
    const here = Boolean(active) && (scene.id === active.id);
    for ( const token of scene.tokens ?? [] ) {
      if ( everywhere && token.actorLink ) {
        const place = places.get(token.actorId) ?? { here: false, elsewhere: false };
        if ( here ) place.here = true;
        else place.elsewhere = true;
        places.set(token.actorId, place);
      }
      if ( token.hidden ) continue;
      const base = game.actors.get(token.actorId);
      if ( base?.type !== "npc" ) continue;
      if ( everywhere && !token.actorLink && !mayBeCompanion(token, base, playerIds, owner) ) continue;
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
  }

  // The world's linked NPCs its players own, wherever their tokens are.
  const linked = game.actors.filter(actor => (actor.type === "npc") && (actor.prototypeToken?.actorLink === true));
  for ( const actor of linked ) {
    if ( campaign.characters.has(actor.id) || transformed(actor) || !ownable(actor) ) continue;
    note(actor.id, "owned", actor, null, ownersOf(actor));
  }

  // Since 0.51.0, where each is: a token's creature by its token's scene, a world actor's by its
  // tokens', away where none is on the active scene and one is on another. None is with no scene active.
  for ( const each of found.values() ) {
    const place = each.token ? null : places.get(each.actor.id);
    each.away = everywhere && Boolean(active)
      && (each.token ? (each.token.parent?.id !== active.id) : Boolean(place?.elsewhere && !place.here));
  }

  // Each character's, capped, then the campaign's, in its characters' order.
  const byName = (a, b) => (a.name.localeCompare(b.name, game.i18n.lang) || a.key.localeCompare(b.key));
  const listed = new Map();
  for ( const character of characters ) {
    const own = Array.from(found.values()).filter(each => each.of.includes(character))
      .map(each => ({ ...each, name: nameOf(each.actor, each.token) }));
    const kept = presentFirst([
      ...own.filter(each => each.kind === "owned").sort(byName),
      ...own.filter(each => each.kind === "summoned").sort(byName)
    ], MOST_COMPANIONS_EACH);
    for ( const each of kept ) {
      const entry = listed.get(each.key);
      if ( entry ) entry.of.push(character.id);
      else listed.set(each.key, { ...each, of: [character.id], summoner: (each.kind === "summoned") ? character : null });
    }
  }
  return presentFirst(Array.from(listed.values()), MOST_COMPANIONS).map(each => ({
    entry: entryOf(each, everywhere),
    actor: each.actor
  }));
}

/**
 * A campaign's list of companions, as the hello and `companions.listed` send it.
 * @param {Campaign} campaign
 * @param {object} [options]   As `companionsOf`'s.
 * @returns {CompanionEntry[]}
 */
export function companionList(campaign, options) {
  return companionsOf(campaign, options).map(({ entry }) => entry);
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
 * `default`? A companion none of their players owns goes without the Gamemaster's secrets. Since
 * 0.45.0 their players are as their companions are found (`characterPlayers`), so a character shared
 * with every player through its default doesn't show another's NPC its secrets.
 * @param {Actor} actor
 * @param {Iterable<string|Actor>} characters   The characters, or their actor ids.
 * @returns {boolean}
 */
export function ownedByPlayers(actor, characters) {
  const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return Array.from(characters ?? []).some(each => {
    const character = (typeof each === "string") ? game.actors.get(each) : each;
    return Boolean(character) && characterPlayers(character).some(user => actor?.ownership?.[user.id] === owner);
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
 * May an unlinked token's creature be a companion, by what its token holds, before its actor is made
 * up, since 0.51.0: a summon by its delta's or its base actor's `flags.dnd5e.summon.origin`, or owned
 * by one of the players given, by id, in its delta's or its base actor's `ownership`. Wider than the
 * rules themselves, which its live actor is then read by, so that it never leaves a companion out.
 * @param {TokenDocument} token
 * @param {Actor} base               Its world actor.
 * @param {string[]} playerIds       The campaign's characters' players, by user id.
 * @param {number} owner             Foundry's Owner level.
 * @returns {boolean}
 */
function mayBeCompanion(token, base, playerIds, owner) {
  const sources = [token.delta, base].filter(Boolean);
  if ( sources.some(source => typeof foundry.utils.getProperty(source, "flags.dnd5e.summon.origin") === "string") ) return true;
  return sources.some(source => playerIds.some(id => source.ownership?.[id] === owner));
}

/**
 * The first of a list, at most `most`, those not away kept first, in the list's own order: since
 * 0.51.0, so that a companion on the active scene is never left out for one on another. Where none
 * is away, the first `most`.
 * @template {{away?: boolean}} T
 * @param {T[]} list
 * @param {number} most
 * @returns {T[]}
 */
function presentFirst(list, most) {
  if ( list.length <= most ) return list;
  const kept = new Set([...list.filter(each => !each.away), ...list.filter(each => each.away)].slice(0, most));
  return list.filter(each => kept.has(each));
}

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
 * A creature found, as its entry lists it: since 0.51.0, for an app that reads companions on every
 * scene, ending with `away`.
 * @param {{key: string, kind: string, actor: Actor, token: TokenDocument|null, of: string[],
 *   name: string, summoner: Actor|null, away: boolean}} found
 * @param {boolean} everywhere
 * @returns {CompanionEntry}
 */
function entryOf({ key, kind, actor, token, of, name, summoner, away }, everywhere) {
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
    summon: summoner ? summonOf(actor, summoner) : null,
    ...(everywhere ? { away } : {})
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
