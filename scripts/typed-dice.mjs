import { manualDiceOn } from "./campaigns.mjs";
import { playerOwners } from "./characters.mjs";

/**
 * Who may type in what their own dice show for a character's rolls in the app, since 0.32.0: the
 * character's primary player, where the campaign lets its players enter their dice results and
 * Manual Dice is on. The app's own switch then decides, per player; Foundry only says who may.
 *
 * A character's primary player is the Gamemaster's choice in Foundry, its assigned Character
 * (User Configuration); a character no player is assigned is played by its owners. Whether they may
 * is core's Make Manual Rolls permission, which Manual Dice's roles set. A player's own Manual Dice
 * toggle in Foundry lives in their browser alone, so it plays no part.
 */

/** Core's permission Manual Dice's roles set (MD scripts/manual-dice.mjs:54). */
const MANUAL_ROLLS = "MANUAL_ROLLS";

/**
 * A character's primary players: the non-Gamemaster users whose assigned Character it is; failing
 * any, its player owners.
 * @param {Actor} actor
 * @returns {User[]}
 */
export function primaryPlayers(actor) {
  const assigned = game.users.filter(user => !user.isGM && (user.character?.id === actor.id));
  return assigned.length ? assigned : playerOwners(actor);
}

/**
 * May this user make manual rolls? False where it can't be told.
 * @param {User} user
 * @returns {boolean}
 */
export function mayEnterDice(user) {
  try {
    return user?.hasPermission?.(MANUAL_ROLLS) === true;
  } catch {
    return false;
  }
}

/**
 * Where a character stands for typed dice, apart from the campaign: "allowed", with the player who
 * may; "permission", with the first primary player, none of whom may; or "none", with no player.
 * @param {Actor} actor
 * @returns {{state: "allowed"|"permission"|"none", player: User|null}}
 */
export function typedDiceState(actor) {
  const players = primaryPlayers(actor);
  if ( !players.length ) return { state: "none", player: null };
  const permitted = players.find(mayEnterDice);
  return permitted ? { state: "allowed", player: permitted } : { state: "permission", player: players[0] };
}

/**
 * May the character's player enter its dice results in the app, in this campaign?
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function typesDice(actor, campaign) {
  return manualDiceOn(campaign) && (typedDiceState(actor).state === "allowed");
}
