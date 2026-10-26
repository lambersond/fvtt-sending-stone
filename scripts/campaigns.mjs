import { COMPANION_INITIATIVE, MODULE_ID, SETTINGS } from "./constants.mjs";
import { manualDiceEnabled } from "./companions.mjs";
import { diceStatus } from "./dice-plan.mjs";

/**
 * Campaigns: groups of player characters, each with a title, that events are sent to.
 *
 * A world can run more than one campaign, such as two parties sharing a setting. Each event goes
 * to every campaign whose characters it involves, described for that campaign alone, so a
 * campaign's players never see whispers or hit points meant for another's. A character may belong
 * to more than one campaign.
 */

/**
 * A campaign as this module works with it.
 * @typedef {object} Campaign
 * @property {string} id              Generated when the campaign is created; never changes.
 * @property {string} title           Set by the Gamemaster, and how players find the campaign.
 * @property {Set<string>} characters The actor ids of its characters.
 * @property {Set<string>} groups     The actor ids of its Group actors, its parties, in the order
 *                                    the Gamemaster added them: see groups.mjs.
 * @property {boolean} rolls          Do its players' rolls in the app get made here, with their
 *                                    dice? Off until the Gamemaster turns it on.
 * @property {boolean} attacks        Do its players' attacks, spells and features in the app get
 *                                    made here too, using the item as in Foundry? Off until the
 *                                    Gamemaster turns it on, and only with `rolls`.
 * @property {boolean} prompts        Are its players asked in the app for the saving throws the game
 *                                    asks of their characters, such as concentration checks, to roll
 *                                    them there? Off until the Gamemaster turns it on, and only with
 *                                    `rolls`.
 * @property {boolean} manualDice     May its players enter what their own dice show in the app?
 *                                    Off until the Gamemaster turns it on, and counted only with
 *                                    `rolls` while Manual Dice is on: see manualDiceOn.
 * @property {boolean} transfers      May its players move items and coins from the app: take from
 *                                    and give to its groups they own in Foundry, and give to each
 *                                    other's characters? Off until the Gamemaster turns it on;
 *                                    apart from `rolls`.
 * @property {boolean} dishes         Does it take its players' dishes from the Magical Recipe Book,
 *                                    since 0.38.0, a card for the Gamemaster each? Off until the
 *                                    Gamemaster turns it on, apart from `rolls`, under dnd5e 5.
 * @property {boolean} effects        May its players turn off, turn on and delete their own
 *                                    characters' effects from the app, since 0.39.0, those their
 *                                    party put there? Off until the Gamemaster turns it on, apart
 *                                    from `rolls`, under dnd5e.
 * @property {string} companionInitiative  How its characters' companions enter initiative, since
 *                                    0.36.0: `"own"`, each rolls its own; or `"after"`, each in a
 *                                    combat with its character is kept right after it there, by
 *                                    creature-initiative.mjs. `"own"` until the Gamemaster chooses.
 */

/**
 * The world's campaigns, in the order the Gamemaster listed them.
 * @returns {Campaign[]}
 */
export function getCampaigns() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.CAMPAIGNS) ?? [];
  return stored.map(({
    id, title, characters, groups, rolls, attacks, prompts, manualDice, transfers, dishes, effects, companionInitiative
  }) => ({
    id,
    title,
    characters: new Set(characters),
    groups: new Set(groups ?? []),
    rolls: rolls === true,
    attacks: attacks === true,
    prompts: prompts === true,
    manualDice: manualDice === true,
    transfers: transfers === true,
    dishes: dishes === true,
    // A campaign saved before 0.39.0 has none: its players change no effects from the app.
    effects: effects === true,
    // A campaign saved before 0.36.0, or holding anything else, rolls its companions' own.
    companionInitiative: (companionInitiative === COMPANION_INITIATIVE.AFTER)
      ? COMPANION_INITIATIVE.AFTER : COMPANION_INITIATIVE.OWN
  }));
}

/**
 * May a campaign's players enter their own dice results in the app? Only while its players' rolls
 * in the app are made here, so not under another system or after a failed self-test, and Manual
 * Dice is on. A choice saved while Manual Dice was on is kept once it isn't, but counts for nothing
 * until it is again. Since 0.32.0 a character's player may then enter its dice results in the app
 * where they have Make Manual Rolls (typed-dice.mjs), as each character's `manualDice` says.
 * @param {{rolls: boolean, manualDice: boolean}} campaign
 * @returns {boolean}
 */
export function manualDiceOn(campaign) {
  return (campaign.rolls === true) && diceStatus.ready && (campaign.manualDice === true) && manualDiceEnabled();
}

/**
 * How a campaign is named in each envelope sent to it.
 * @param {Campaign} campaign
 * @returns {{id: string, title: string}}
 */
export function describeCampaign(campaign) {
  return { id: campaign.id, title: campaign.title };
}

/**
 * Before campaigns, the Gamemaster chose one set of connected characters. Move them into a
 * campaign named for the world, so an existing setup keeps sending. Done once, by the active
 * Gamemaster, and only while no campaign has been set up.
 * @returns {Promise<void>}
 */
export async function migrateConnectedCharacters() {
  if ( !game.user.isActiveGM ) return;
  const connected = Array.from(game.settings.get(MODULE_ID, SETTINGS.CHARACTERS) ?? []);
  if ( !connected.length || getCampaigns().length ) return;
  await game.settings.set(MODULE_ID, SETTINGS.CAMPAIGNS, [
    { id: foundry.utils.randomID(), title: game.world.title, characters: connected }
  ]);
  await game.settings.set(MODULE_ID, SETTINGS.CHARACTERS, []);
}
