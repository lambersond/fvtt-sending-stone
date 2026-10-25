import { FAVORITE_KINDS, FAVORITE_OPS, FAVORITE_TYPES } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import { checkCommand, failedResult, isKey, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { campaignGroups } from "./groups.mjs";
import { listedFavorite } from "./sheet-favorites.mjs";

/**
 * Adding to and removing from a character's favorites from the Sending Stone app, since module
 * 0.37.0, as dnd5e's sheet's menus do: through dnd5e's own `addFavorite` and `removeFavorite`, by the
 * same relative id its menus use, so that a new one goes last, as dnd5e adds it, and Foundry's
 * sheet, Tidy 5e's and the app all show the same list. The Gamemaster's client writes it, as it
 * writes every command. Nothing is posted in chat, as dnd5e posts nothing; so only a character's
 * player does it from the app, never the Gamemaster as them, which would leave no mark.
 *
 * Offered wherever the system is D&D Fifth Edition, with no switch of its own, whether or not the
 * campaign's players' rolls are made here: it throws no dice and uses nothing.
 */

/**
 * The campaigns whose app takes favorites, by id, as their latest answer to a hello or heartbeat
 * said.
 * @type {Set<string>}
 */
const favorers = new Set();

/**
 * An id dnd5e gives an item, an activity or an effect.
 * @type {RegExp}
 */
const ID = /^[A-Za-z0-9]{1,64}$/;

/**
 * An effect's id as the sheet names it: its own, on the character, or its item's and its own.
 * @type {RegExp}
 */
const EFFECT_ID = /^[A-Za-z0-9]{1,64}(\.[A-Za-z0-9]{1,64})?$/;

/* -------------------------------------------- */
/*  Whether favorites are made here             */
/* -------------------------------------------- */

/**
 * May a character's favorites be changed from the app here: under D&D Fifth Edition, with no switch,
 * apart from the campaign's rolls and the dice self-test.
 * @returns {boolean}
 */
export function favoritesOn() {
  return game.system?.id === "dnd5e";
}

/**
 * What a campaign tells the app of its characters' favorites in its hello, beside its rolls: whether
 * they may be added and removed here, and if not, why not, another system.
 * @returns {{enabled: boolean, kinds: string[], reason: "system"|null}}
 */
export function favoriteFeatures() {
  if ( game.system?.id !== "dnd5e" ) return { enabled: false, kinds: [], reason: "system" };
  return { enabled: true, kinds: [...FAVORITE_KINDS], reason: null };
}

/**
 * Note whether a campaign's app takes favorites: `features.favorites`, 1 or later. One that says
 * nothing of them, as an older or rolled back app, is fetched from for them no longer.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {void}
 */
export function noteFavoriteReader(campaignId, features) {
  const format = features?.favorites;
  if ( Number.isInteger(format) && (format >= 1) ) favorers.add(campaignId);
  else favorers.delete(campaignId);
}

/**
 * Does a campaign's app take favorites?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function favoriteReader(campaignId) {
  return favorers.has(campaignId);
}

/* -------------------------------------------- */
/*  A favorite                                  */
/* -------------------------------------------- */

/**
 * Why a fetched favorite isn't one to make, if it isn't: it adds or removes one favorite, of a type
 * dnd5e keeps, named by its id as the sheet names it, and an activity by its item's too; and names
 * nothing else, nothing a roll names, no move, removal or anything typed in, and throws no dice.
 * Only its player adds or removes one from the app: it posts nothing, so would leave no mark of the
 * Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
export function checkFavoriteCommand(command) {
  if ( command.by === "gm" ) return "by";
  const favorite = command.favorite;
  const given = value => (value !== undefined) && (value !== null);
  if ( namesRollFields(command) || given(command.transfer) || given(command.remove) || given(command.typed)
    || !isObject(favorite) ) return "favorite";
  const { op, type, id, item } = favorite;
  if ( !FAVORITE_OPS.includes(op) || !FAVORITE_TYPES.includes(type) ) return "favorite";
  const fields = (type === "activity") ? "id,item,op,type" : "id,op,type";
  if ( Object.keys(favorite).sort().join() !== fields ) return "favorite";
  if ( !validId(type, id) || ((type === "activity") && !isText(ID, item)) ) return "favorite";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Add a favorite to a character's, or remove one, fetched from the app: every check before any
 * write, as the character is now. One added must be something the sheet would list; one removed
 * needn't still be there, so a favorite of something gone can go. One that's already so, a favorite
 * added or none removed, is done with nothing written: the app may have been showing an older sheet.
 * Then the sheet, as it then stands, written or not, ahead of the result, which says whether it's a
 * favorite now.
 * @param {object} command      `{favorite: {op, type, id, item?}}`, as fetched.
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
export async function runFavoriteCommand(command, passed) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !favoritesOn() ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const groups = new Set(campaignGroups(campaign).map(group => group.id));
  const actor = (campaign.characters.has(command.actorId) && !groups.has(command.actorId))
    ? (game.actors.get(command.actorId) ?? null) : null;
  // Only a character's data has dnd5e's favorites, never an NPC's or a group's.
  const api = ["addFavorite", "removeFavorite", "hasFavorite"].every(name => typeof actor?.system?.[name] === "function");
  if ( !api ) return failed("unknown");
  const { op, type } = command.favorite;
  const stored = storedId(command.favorite);

  try {
    if ( op === "add" ) {
      if ( !listedFavorite(actor, { type, id: stored }) ) return failed("gone");
      if ( !actor.system.hasFavorite(stored) ) await actor.system.addFavorite({ type, id: stored });
    } else if ( actor.system.hasFavorite(stored) ) await actor.system.removeFavorite(stored);
  } catch (err) {
    // dnd5e throws, if at all, before its one update, or the update fails whole: nothing was written.
    return failed("error", messageOf(err));
  }

  sheetFirst(actor);
  return {
    id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [],
    favorited: actor.system.hasFavorite(stored)
  };
}

/* -------------------------------------------- */

/**
 * The id dnd5e keeps a favorite by, built as its sheet's menus build it: an item, an activity and an
 * effect by its relative UUID, `.Item.<id>`, `.Item.<item>.Activity.<id>`, `.ActiveEffect.<id>` or
 * `.Item.<item>.ActiveEffect.<id>`; a skill, a tool or a pool of spell slots by its key. The same
 * string adds it and removes it, as dnd5e's menus match it.
 * @param {{type: string, id: string, item?: string}} favorite   As fetched.
 * @returns {string}
 */
function storedId({ type, id, item }) {
  switch ( type ) {
    case "item": return `.Item.${id}`;
    case "activity": return `.Item.${item}.Activity.${id}`;
    case "effect": {
      const [first, second] = id.split(".");
      return (second === undefined) ? `.ActiveEffect.${first}` : `.Item.${first}.ActiveEffect.${second}`;
    }
    default: return id;
  }
}

/**
 * Is this a favorite's id as the sheet names one of its type: an item's or an activity's own id, an
 * effect's as `effectIdOf` names it, a skill's, a tool's or a pool's key? Never `resources.<key>`,
 * which dnd5e's `removeFavorite` would take for an old-style resource, and zero its maximum.
 * @param {string} type
 * @param {unknown} id
 * @returns {boolean}
 */
function validId(type, id) {
  if ( (type === "item") || (type === "activity") ) return isText(ID, id);
  if ( type === "effect" ) return isText(EFFECT_ID, id);
  return isKey(id);
}

/**
 * Is this a string the pattern matches?
 * @param {RegExp} pattern
 * @param {unknown} value
 * @returns {boolean}
 */
function isText(pattern, value) {
  return (typeof value === "string") && pattern.test(value);
}

/**
 * What went wrong, in words.
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  return (err instanceof Error) ? err.message : String(err);
}
