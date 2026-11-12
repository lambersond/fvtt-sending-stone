import {
  EFFECT_ID, FAVORITE_KINDS, FAVORITE_OPS, FAVORITE_ORDER, FAVORITE_TYPES, MOST_FAVORITE_ORDER
} from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { activeForm } from "./characters.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import { checkCommand, failedResult, isKey, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { campaignGroups } from "./groups.mjs";
import { listedFavorite, storedFavorites } from "./sheet-favorites.mjs";

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
 *
 * Since module 0.47.0 the favorites are put in order from the app too, as dnd5e's sheet does when
 * one is dragged among them: their `sort`s written in one update, so that Foundry's sheet shows the
 * order the app sent. The old-style resources dnd5e lists first aren't among its favorites, so they
 * stay first.
 */

/**
 * dnd5e's favorites' sorts, as Foundry spaces them (`CONST.SORT_INTEGER_DENSITY`).
 * @type {number}
 */
const DENSITY = 100_000;

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
 * they may be added and removed here, and if not, why not, another system; and since 0.47.0
 * `orders`, whether they may be put in order here, wherever they may be added.
 * @returns {{enabled: boolean, kinds: string[], reason: "system"|null, orders: boolean}}
 */
export function favoriteFeatures() {
  if ( game.system?.id !== "dnd5e" ) return { enabled: false, kinds: [], reason: "system", orders: false };
  return { enabled: true, kinds: [...FAVORITE_KINDS], reason: null, orders: true };
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
 * dnd5e keeps, named by its id as the sheet names it, and an activity by its item's too, or since
 * 0.47.0 puts them in order (`validOrder`); and names nothing else, nothing a roll names, no move,
 * removal or anything typed in, and throws no dice. Only its player adds or removes one from the
 * app: it posts nothing, so would leave no mark of the Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
export function checkFavoriteCommand(command) {
  if ( command.by === "gm" ) return "by";
  const favorite = command.favorite;
  const given = value => (value !== undefined) && (value !== null);
  if ( namesRollFields(command) || given(command.transfer) || given(command.remove) || given(command.typed)
    || !isObject(favorite) ) return "favorite";
  const valid = (favorite.op === FAVORITE_ORDER) ? validOrder(favorite)
    : (FAVORITE_OPS.includes(favorite.op) && namesFavorite(favorite, ["op"]));
  if ( !valid ) return "favorite";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Is this a favorite as the sheet names one: an object of `type` and `id`, `item` beside them for
 * an activity alone, and the other fields given; one of dnd5e's types, its ids as `validId` has
 * them?
 * @param {unknown} favorite
 * @param {string[]} [more]   Its other fields, such as `op`.
 * @returns {boolean}
 */
function namesFavorite(favorite, more=[]) {
  if ( !isObject(favorite) ) return false;
  const { type, id, item } = favorite;
  if ( !FAVORITE_TYPES.includes(type) ) return false;
  const fields = [...((type === "activity") ? ["id", "item", "type"] : ["id", "type"]), ...more].sort().join();
  if ( Object.keys(favorite).sort().join() !== fields ) return false;
  return validId(type, id) && ((type !== "activity") || isText(ID, item));
}

/**
 * Is this an order of the favorites, since 0.47.0: `{op: "order", order, was}` and nothing else,
 * `was` the favorites the app showed, in their order, and `order` the same in the order wanted;
 * each 1 to `MOST_FAVORITE_ORDER` favorites as the sheet names them, none twice.
 * @param {object} favorite
 * @returns {boolean}
 */
function validOrder(favorite) {
  if ( Object.keys(favorite).sort().join() !== "op,order,was" ) return false;
  const { order, was } = favorite;
  const listed = list => Array.isArray(list) && (list.length > 0) && (list.length <= MOST_FAVORITE_ORDER)
    && list.every(each => namesFavorite(each));
  if ( !listed(order) || !listed(was) || (order.length !== was.length) ) return false;
  const shown = new Set(was.map(favoriteKey));
  return (shown.size === was.length) && order.every(each => shown.has(favoriteKey(each)))
    && (new Set(order.map(favoriteKey)).size === order.length);
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
  // Since 0.40.0 none while she's transformed: her form's favorites are a copy her return loses.
  if ( activeForm(actor) ) return failed("shaped");
  if ( command.favorite.op === FAVORITE_ORDER ) return orderFavorites(command, actor, failed);
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

/**
 * Put a character's favorites in the order the app sent, since 0.47.0, as dnd5e's sheet does when
 * one is dragged among them: refused `"changed"` where the favorites the sheet lists now, in their
 * order, aren't those the app showed (`was`), as when one was added, removed or moved in Foundry
 * meanwhile, the sheet as it stands first. Otherwise those it lists take the places they held among
 * dnd5e's favorites in the order wanted, any it leaves out, as one hidden from the player, keeping
 * theirs, and every one's `sort` is written afresh, `DENSITY` apart, in one update; already in that
 * order, nothing is written. Then the sheet, as it then stands, ahead of the result.
 * @param {object} command                         `{favorite: {op: "order", order, was}}`.
 * @param {Actor} actor                           The character, checked.
 * @param {(reason: string, error?: string|null) => CommandResult} failed
 * @returns {Promise<CommandResult>}
 */
async function orderFavorites(command, actor, failed) {
  const { order, was } = command.favorite;
  const stored = storedFavorites(actor);
  const shown = stored.filter(({ listed }) => listed);
  const keys = shown.map(({ listed }) => favoriteKey(sheetName(listed)));
  if ( keys.join("\n") !== was.map(favoriteKey).join("\n") ) {
    sheetFirst(actor);
    return failed("changed");
  }
  const byKey = new Map(shown.map(({ stored }, index) => [keys[index], stored]));
  const wanted = order.map(each => byKey.get(favoriteKey(each)));
  let next = 0;
  const favorites = stored.map(({ stored, listed }) => (listed ? wanted[next++] : stored));
  if ( favorites.some((favorite, index) => favorite !== stored[index].stored) ) {
    try {
      await actor.update({
        "system.favorites": favorites.map((favorite, index) => ({ ...favorite, sort: (index + 1) * DENSITY }))
      });
    } catch (err) {
      // Foundry's update writes whole or not at all: nothing was written.
      return failed("error", messageOf(err));
    }
  }
  sheetFirst(actor);
  return { id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [] };
}

/* -------------------------------------------- */

/**
 * A favorite the sheet lists, as the app names it back: `{type, id}`, and an activity's `item`.
 * @param {{type: string, id: string, itemId?: string}} listed   As `favoritesOf` lists it.
 * @returns {{type: string, id: string, item?: string}}
 */
function sheetName({ type, id, itemId }) {
  return (type === "activity") ? { type, id, item: itemId } : { type, id };
}

/**
 * A favorite's key, as the sheet names it: an activity's by its item's id too, as two items may
 * hold activities of one id.
 * @param {{type: string, id: string, item?: string}} favorite
 * @returns {string}
 */
function favoriteKey({ type, id, item }) {
  return (type === "activity") ? `activity:${item}.${id}` : `${type}:${id}`;
}

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
