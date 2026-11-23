import { given } from "./command-rolls.mjs";
import { asksOnCard, offeredProfiles, summonLabel } from "./sheet-summon.mjs";

/**
 * Summoning from the app, since 0.54.0: the creature, creature type and size a use names, checked
 * at the level the summon activity is cast at; written on its card where dnd5e's card would ask,
 * which nothing places from the app. The Gamemaster places the creature from the card's Summon
 * button in Foundry, as when a player casts it there.
 *
 * A script of its own beside command-uses.mjs, which casts the activity, for what a summoning alone
 * asks of a use: its check, and the flag its card carries.
 */

/**
 * The player's choice of creature for a summon activity's use, as its card notes it, or why the use
 * is refused, spending nothing: it's cast at no one, so any target, or the user, is `"target"`; it
 * must summon something at the level it's cast at, a creature dnd5e offers there that can be found,
 * or dnd5e would spend the slot and post a card with no Summon button, `"creature"`; and the
 * creature, type and size named must be among those offered there, a type or size only where it
 * offers more than one, else `"creature"`, as only a sheet out of date sends. Without `summon` it's
 * cast as dnd5e casts it, nothing chosen beforehand; and where dnd5e's card would ask nothing, as
 * for one creature and no choice, nothing is noted.
 * @param {object} command
 * @param {Activity} activity   The activity used, its item the one the card is of.
 * @param {Activity} scaled     The activity as it's cast, at the level it's cast at.
 * @returns {{refusal: string}|{item: string, activity: string, profile: string, label: string,
 *   type?: string, size?: string}|null}
 */
export function summonChoice(command, activity, scaled) {
  if ( (Array.isArray(command.targets) && command.targets.length) || (command.self === true) ) return { refusal: "target" };
  const offered = offeredProfiles(scaled);
  if ( !offered.length ) return { refusal: "creature" };
  const summon = command.summon;
  if ( (summon === undefined) || (summon === null) ) return null;
  const profile = offered.find(each => each._id === summon.profile);
  if ( !profile ) return { refusal: "creature" };
  if ( !offers(scaled.creatureTypes, summon.type) || !offers(scaled.creatureSizes, summon.size) ) return { refusal: "creature" };
  if ( !asksOnCard(scaled) ) return null;
  return {
    item: activity.item.id,
    activity: activity.id,
    profile: profile._id,
    label: summonLabel(scaled, profile),
    ...(given(summon.type) && { type: summon.type }),
    ...(given(summon.size) && { size: summon.size })
  };
}

/**
 * Does a summon activity offer this creature type or size: none named, or one of more than one?
 * @param {Set<string>|undefined} keys
 * @param {string|undefined|null} key
 * @returns {boolean}
 */
function offers(keys, key) {
  if ( !given(key) ) return true;
  return ((keys?.size ?? 0) > 1) && keys.has(key);
}

/**
 * What a summon activity's card carries of the player's choice, beside the app's own flags: the
 * choice `summonChoice` noted, where it noted one.
 * @param {object} use   What the use is made with.
 * @returns {{summon?: object}}
 */
export function summonFlag(use) {
  return use?.summoning ? { summon: use.summoning } : {};
}
