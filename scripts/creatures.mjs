import { MOST_COMPANIONS, MOST_COMPANIONS_EACH } from "./constants.mjs";
import { activeForm, campaignActors, characterPlayers, transformed } from "./characters.mjs";
import { wildShapeReader } from "./wild-shape.mjs";

/**
 * A campaign's characters' companions, since 0.36.0: the creatures each summoned in Foundry, whose
 * tokens are on the active scene, and the NPCs its players own there by name (round 0.36.0 §2.1), its
 * players since 0.45.0 those who own it by name, else those it's assigned to (`characterPlayers`).
 * Since 0.51.0, for an app that reads them there (`"companions": 3`), on every scene, each saying
 * whether it's away, on another scene than the active one. Since 0.54.0, to an app that answers
 * `companions` 4, the Gamemaster's constant companions too (`constantCopies`), each listed with a
 * token or without, last among its character's.
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
 * The format from which an app reads the Gamemaster's constant companions: since 0.54.0.
 * @type {number}
 */
const CONSTANT_FORMAT = 4;

/**
 * A companion as a campaign lists it, without its sheet, which follows to an app that reads them.
 * @typedef {object} CompanionEntry
 * @property {string} key             Its actor's id, or for a token's creature `<sceneId>-<tokenId>`.
 * @property {string[]} of            The campaign characters it's a companion of, by actor id.
 * @property {"owned"|"summoned"|"constant"} kind
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
 * @property {boolean} [placed]       Since 0.54.0, a constant companion's only, last: a token of it is
 *                                    on a scene.
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

/**
 * Does a campaign's app read the Gamemaster's constant companions, since 0.54.0: its latest answer
 * said `companions` 4 or more?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function constantReader(campaignId) {
  return companionFormat(campaignId) >= CONSTANT_FORMAT;
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
 * The copies of a campaign's constant companions now, since 0.54.0, by the NPC marked: what each is
 * listed as and acts on. Read from the campaign given, as saved or as being edited in Manage
 * Campaigns. A mark counts while its NPC is a world actor of type `npc`, not transformed and not a
 * campaign character, for those of its characters still in the campaign, in the campaign's order.
 *
 * Its copy is one of its tokens, hidden or not, of the marked actor or of dnd5e's copy of it (a world
 * actor flagged `isAutoImported`, or the older `summonedCopy`, whose `_stats.duplicateSource` is the
 * marked actor's uuid or whose `_stats.compendiumSource` is the marked actor's own): the active
 * scene's first, then each scene's in Foundry's order, each scene's tokens in order. A token whose
 * creature is a summon counts only where one of its characters, or her form, summoned it. A token of
 * no such actor is passed over by its actor's id alone, its creature never made up. With no token,
 * its copy is dnd5e's linked copy of it kept for a summon by one of its characters, where there is
 * one (dnd5e's `fetchExisting` makes one of a linked world actor, and `getTokenData` writes the
 * summon's flags and bonuses onto it, which it keeps between summons, with its hit points and uses);
 * else the marked actor.
 *
 * Each copy is one mark's only, as the Gamemaster may mark both an NPC and dnd5e's copy of it: a
 * token goes to the mark of its own actor first, then to the first in the campaign's order it counts
 * for, and the others go on to their next token, a linked one never to a second linked token of the
 * same actor, which is the same creature. Before any, a marked actor whose tokens may be another
 * mark's too, as dnd5e's copy of a marked NPC's may, takes its own linked token, wherever it is: that
 * is its world actor, then never the other mark's while its own takes an unlinked token of it. With
 * no token, a linked copy marked itself is left to its own mark, and one whose linked token is
 * another mark's copy to that one; a mark left with its own actor alone, while a linked token of that
 * is another mark's copy, is left out while it is.
 * @param {Campaign} campaign
 * @returns {Map<string, {marked: Actor, characters: Actor[], token: TokenDocument|null, actor: Actor}>}
 */
export function constantCopies(campaign) {
  const copies = new Map();
  const marks = Array.isArray(campaign.constantCompanions) ? campaign.constantCompanions : [];
  if ( !marks.length ) return copies;
  const characters = campaignActors(campaign);
  const forms = new Map(characters.map(character => [character.id, activeForm(character)?.id ?? null]));

  // The marks that count, by the NPC marked, each with its characters in the campaign's order.
  const chosen = new Map();
  for ( const { actorId, characterId } of marks ) {
    const marked = game.actors.get(actorId);
    if ( !marked || (marked.type !== "npc") || transformed(marked) || campaign.characters.has(marked.id) ) continue;
    if ( !chosen.has(marked.id) ) chosen.set(marked.id, new Set());
    chosen.get(marked.id).add(characterId);
  }
  for ( const [markedId, ids] of chosen ) {
    const theirs = characters.filter(character => ids.has(character.id));
    if ( theirs.length ) copies.set(markedId, { marked: game.actors.get(markedId), characters: theirs, token: null, actor: null });
  }
  if ( !copies.size ) return copies;

  // The world actors a mark's tokens may be of, in one pass: each marked actor and dnd5e's copies of
  // it; and its linked copies kept for a summon, should no token be placed.
  const bases = new Map();
  const linkedCopies = new Map();
  const base = (id, markedId) => {
    if ( !bases.has(id) ) bases.set(id, []);
    bases.get(id).push(markedId);
  };
  const isCopy = actor => (actor.flags?.dnd5e?.isAutoImported === true) || (actor.flags?.dnd5e?.summonedCopy === true);
  for ( const actor of game.actors.filter(each => copies.has(each.id) || isCopy(each)) ) {
    if ( copies.has(actor.id) ) base(actor.id, actor.id);
    if ( !isCopy(actor) ) continue;
    const stats = actor._stats ?? {};
    for ( const [markedId, { marked }] of copies ) {
      if ( actor.id === markedId ) continue;
      const source = marked._stats?.compendiumSource;
      const duplicate = Boolean(stats.duplicateSource) && (stats.duplicateSource === marked.uuid);
      if ( !duplicate && !(source && (stats.compendiumSource === source)) ) continue;
      base(actor.id, markedId);
      if ( duplicate && (actor.prototypeToken?.actorLink === true) ) {
        if ( !linkedCopies.has(markedId) ) linkedCopies.set(markedId, []);
        linkedCopies.get(markedId).push(actor);
      }
    }
  }

  // Its token, the first that passes, the active scene's first: each token one mark's, its own
  // actor's mark first (`bases` lists it first), then the first in the campaign's order it counts for.
  const active = game.scenes?.active ?? null;
  const scenes = [active, ...Array.from(game.scenes ?? []).filter(scene => scene !== active)].filter(Boolean);
  const origin = source => foundry.utils.getProperty(source, "flags.dnd5e.summon.origin");
  const taken = new Set();
  const claim = (token, markedIds) => {
    // A linked token is its world actor: once one is a mark's copy, its others are that one too.
    if ( token.actorLink && taken.has(token.actorId) ) return;
    const waiting = markedIds.filter(markedId => !copies.get(markedId).token);
    if ( !waiting.length ) return;
    const summon = (token.actorLink ? null : origin(token.delta)) ?? origin(game.actors.get(token.actorId));
    const markedId = waiting.find(id => (typeof summon !== "string") || summonerOf(summon, copies.get(id).characters, forms));
    if ( !markedId ) return;
    const actor = token.actor;
    if ( !actor || (actor.type !== "npc") || transformed(actor) ) return;
    Object.assign(copies.get(markedId), { token, actor });
    if ( token.actorLink ) taken.add(token.actorId);
  };
  // First, a marked actor whose tokens may be another mark's too, as dnd5e's copy of a marked NPC's
  // may, takes its own linked token, wherever it is: that is its world actor, then never the other
  // mark's while its own takes an unlinked token of it. Any other mark, the active scene's first.
  const shared = id => copies.has(id) && (bases.get(id).length > 1);
  for ( const scene of scenes ) {
    for ( const token of scene.tokens ?? [] ) if ( token.actorLink && shared(token.actorId) ) claim(token, [token.actorId]);
  }
  for ( const scene of scenes ) {
    for ( const token of scene.tokens ?? [] ) claim(token, bases.get(token.actorId) ?? []);
  }

  // With no token, dnd5e's linked copy kept for a summon by one of its characters, else the NPC
  // marked, neither another mark's.
  for ( const [markedId, copy] of copies ) {
    if ( copy.token ) continue;
    const kept = (linkedCopies.get(markedId) ?? []).filter(actor => !copies.has(actor.id) && !taken.has(actor.id));
    const by = character => kept.find(actor => summonerOf(origin(actor), [character], forms) === character);
    copy.actor = copy.characters.map(by).find(Boolean) ?? copy.marked;
    if ( taken.has(copy.actor.id) ) copies.delete(markedId);
  }
  return copies;
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
 *
 * Since 0.54.0, `constant`, as for an app that answers 4: the Gamemaster's constant companions,
 * keyed by the NPC marked and named and pictured by it, found before the scenes' tokens, each its
 * characters' and those whose players own its copy; its copy's token isn't looked at again, nor,
 * where it's linked, any other token of its actor, which is the same creature. Each character's
 * come last, after its summoned ones, and both cuts keep them first. Each entry of one ends with
 * `placed`.
 * @param {Campaign} campaign
 * @param {object} [options]
 * @param {boolean} [options.everywhere]   Every scene, each with `away`: as the campaign's app reads them.
 * @param {boolean} [options.constant]     The constant companions too: as the campaign's app reads them.
 * @returns {{entry: CompanionEntry, actor: Actor}[]}
 */
export function companionsOf(campaign, { everywhere=awayReader(campaign.id), constant=everywhere && constantReader(campaign.id) }={}) {
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
  const found = new Map();
  const note = (key, kind, actor, token, of, { marked=null, placedOn=null }={}) => {
    if ( !key || found.has(key) || !of.length ) return;
    found.set(key, { key, kind, actor, token, of, marked, placedOn });
  };

  // Since 0.54.0 the constant companions, first, so that nothing else takes their copies: each
  // claimed by its creature's key, a linked token's by its actor's id, as all its tokens are it.
  const claimed = new Set();
  if ( constant ) {
    for ( const [markedId, copy] of constantCopies(campaign) ) {
      const owners = ownable(copy.actor) ? ownersOf(copy.actor) : [];
      const of = characters.filter(character => copy.characters.includes(character) || owners.includes(character));
      const token = (copy.token && !copy.token.actorLink) ? copy.token : null;
      note(markedId, "constant", copy.actor, token, of, { marked: copy.marked, placedOn: copy.token?.parent ?? null });
      if ( copy.token ) claimed.add(creatureKey(copy.token));
    }
  }

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
      if ( claimed.has(creatureKey(token)) ) continue;
      if ( token.hidden ) continue;
      const base = game.actors.get(token.actorId);
      if ( base?.type !== "npc" ) continue;
      if ( everywhere && !token.actorLink && !mayBeCompanion(token, base, playerIds, owner) ) continue;
      const actor = token.actor;
      // A transformed actor is never one: dnd5e copies its original's type, ownership and flags onto it.
      if ( !actor || (actor.type !== "npc") || transformed(actor) || campaign.characters.has(actor.id) ) continue;
      const key = creatureKey(token);
      const summoner = summonerOf(foundry.utils.getProperty(actor, "flags.dnd5e.summon.origin"), characters, forms);
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
  // Since 0.54.0 a constant companion's by its copy's token alone, if it has one, and whether it does.
  for ( const each of found.values() ) {
    if ( each.kind === "constant" ) {
      each.away = everywhere && Boolean(active) && Boolean(each.placedOn) && (each.placedOn.id !== active.id);
      each.placed = Boolean(each.placedOn);
      continue;
    }
    const place = each.token ? null : places.get(each.actor.id);
    each.away = everywhere && Boolean(active)
      && (each.token ? (each.token.parent?.id !== active.id) : Boolean(place?.elsewhere && !place.here));
  }

  // Each character's, capped, then the campaign's, in its characters' order.
  const byName = (a, b) => (a.name.localeCompare(b.name, game.i18n.lang) || a.key.localeCompare(b.key));
  const listed = new Map();
  for ( const character of characters ) {
    const own = Array.from(found.values()).filter(each => each.of.includes(character))
      .map(each => ({ ...each, name: nameOf(each.marked ?? each.actor, each.marked ? null : each.token) }));
    const kept = keptFirst([
      ...own.filter(each => each.kind === "owned").sort(byName),
      ...own.filter(each => each.kind === "summoned").sort(byName),
      ...own.filter(each => each.kind === "constant").sort(byName)
    ], MOST_COMPANIONS_EACH);
    for ( const each of kept ) {
      const entry = listed.get(each.key);
      if ( entry ) entry.of.push(character.id);
      else listed.set(each.key, { ...each, of: [character.id], summoner: (each.kind === "summoned") ? character : null });
    }
  }
  return keptFirst(Array.from(listed.values()), MOST_COMPANIONS).map(each => ({
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
 * The campaign character, of those given, whose item a summon's origin names, or since 0.40.0 her
 * form's copy of it while she's shaped; null for none, or for no origin.
 * @param {unknown} origin                     A creature's `flags.dnd5e.summon.origin`.
 * @param {Actor[]} characters
 * @param {Map<string, string|null>} forms    Each character's form's id, by her id.
 * @returns {Actor|null}
 */
function summonerOf(origin, characters, forms) {
  if ( typeof origin !== "string" ) return null;
  const by = id => Boolean(id) && origin.startsWith(`Actor.${id}.Item.`);
  return characters.find(character => by(character.id) || by(forms.get(character.id))) ?? null;
}

/**
 * The first of a list, at most `most`, those not away kept first, in the list's own order: since
 * 0.51.0, so that a companion on the active scene is never left out for one on another. Since 0.54.0
 * the constant companions before them, so that the Gamemaster's marks are never left out for those
 * found on their own. Where none is constant or away, the first `most`.
 * @template {{kind: string, away?: boolean}} T
 * @param {T[]} list
 * @param {number} most
 * @returns {T[]}
 */
function keptFirst(list, most) {
  if ( list.length <= most ) return list;
  const constant = each => each.kind === "constant";
  const ranked = [
    ...list.filter(constant),
    ...list.filter(each => !constant(each) && !each.away),
    ...list.filter(each => !constant(each) && each.away)
  ];
  const kept = new Set(ranked.slice(0, most));
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
 * scene, ending with `away`; and since 0.54.0 a constant companion pictured by the NPC marked, ending
 * with `placed`.
 * @param {{key: string, kind: string, actor: Actor, token: TokenDocument|null, of: string[],
 *   name: string, summoner: Actor|null, away: boolean, marked: Actor|null, placed?: boolean}} found
 * @param {boolean} everywhere
 * @returns {CompanionEntry}
 */
function entryOf({ key, kind, actor, token, of, name, summoner, away, marked, placed }, everywhere) {
  const { img: portrait } = marked ?? actor;
  const img = (typeof portrait === "string") && portrait && (portrait.length <= LONGEST_IMG) ? portrait : null;
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
    ...(everywhere ? { away } : {}),
    ...((kind === "constant") ? { placed } : {})
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
