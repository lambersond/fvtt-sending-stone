import { MODULE_ID, SETTINGS } from "./constants.mjs";

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
 * @property {boolean} rolls          Do its players' rolls in the app get made here, with their
 *                                    dice? Off until the Gamemaster turns it on.
 */

/**
 * The world's campaigns, in the order the Gamemaster listed them.
 * @returns {Campaign[]}
 */
export function getCampaigns() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.CAMPAIGNS) ?? [];
  return stored.map(({ id, title, characters, rolls }) => {
    return { id, title, characters: new Set(characters), rolls: rolls === true };
  });
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
