import { COMPANION_INITIATIVE, FOLLOW_GAP, MODULE_ID } from "./constants.mjs";
import { isBridge } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { companionKeyOf, companionsOf } from "./creatures.mjs";

/**
 * Companions kept right after their characters in initiative, since 0.36.0, in each campaign whose
 * Gamemaster chose "Right after its character" for its companions' initiative in Manage Campaigns
 * (round 0.36.0 §2.7, §6.12): whenever one of its characters' initiative is set, rerolled or
 * cleared, from the app or in Foundry, each of that character's companions that is a combatant of
 * the same combat is set to just below it, so that dnd5e, which sorts by initiative first, sorts it
 * straight after its character. Under "Its own roll", the default, nothing here writes anything.
 *
 * It's a Foundry behaviour the Gamemaster chose, whatever app the campaign sends to, or none: only
 * the active Gamemaster's client writes, as only it posts, whether or not an app's address is set.
 * Each write is an initiative update, not a roll, so dnd5e's recoveries on rolling initiative don't
 * run for a companion placed so. Its own writes are marked and remembered, so that its hooks never
 * take them for a character's change: two NPCs, each a character of one campaign and the other's
 * companion in another, would otherwise move each other down for ever. The value it last wrote is
 * kept on each companion's combatant, so that a Gamemaster's page load, which places what was
 * missed while none was connected, never undoes what the Gamemaster set on a companion since.
 */

/**
 * The latest placing of each combat's companions, which its next waits for, by combat id: so two
 * hooks never write one combat at once, each reading it as it is when its turn comes.
 * @type {Map<string, Promise<void>>}
 */
const queues = new Map();

/**
 * The initiative this client is writing for each companion's combatant, by combatant id, from
 * before the write until after it: an update to it heard meanwhile is this module's own.
 * @type {Map<string, number|null>}
 */
const writing = new Map();

/**
 * How each campaign's companions enter initiative as this client last read it, by campaign id,
 * from the world's ready on: so that a save of Manage Campaigns places companions only in the
 * campaigns it switched to "Right after its character", never in one it left so, where the
 * Gamemaster's own change to a companion's initiative stands. Null until first read.
 * @type {Map<string, string>|null}
 */
let chosen = null;

/* -------------------------------------------- */

/**
 * A companion's initiative right after its character's: FOLLOW_GAP below, to thousandths (round
 * 0.36.0 §2.7). Below the character's, and above every initiative dnd5e makes below it, whose
 * Dexterity tiebreaker adds hundredths: 18.14 makes 18.139, 16 makes 15.999.
 * @param {number} initiative   Its character's.
 * @returns {number}
 */
export function followValue(initiative) {
  return Math.round((initiative - FOLLOW_GAP) * 1000) / 1000;
}

/**
 * Keep the companions of each campaign set to "Right after its character" right after their
 * character in combats, from the active Gamemaster's client alone (round 0.36.0 §2.7): a
 * character's initiative changed, or a character or companion added to a combat. A companion's own
 * change stands until its character's next; one removed, or its combat deleted, keeps its value.
 * Every client notes how each campaign's companions enter initiative once the world is ready, so
 * that whichever writes knows which a save of Manage Campaigns switches.
 * @returns {void}
 */
export function registerFollowHooks() {
  Hooks.once("ready", () => {
    chosen ??= initiativeModes();
  });
  Hooks.on("updateCombatant", (combatant, changes, options) => {
    if ( !isBridge() || !changes || (typeof changes !== "object") || !("initiative" in changes) ) return;
    if ( ownWrite(combatant, changes, options) || !leads(combatant.actorId) ) return;
    void followCharacter(combatant.parent, combatant.actorId, { cleared: changes.initiative === null });
  });
  Hooks.on("createCombatant", (combatant, options) => {
    if ( !isBridge() || (options?.[MODULE_ID]?.follows === true) ) return;
    const combat = combatant.parent;
    if ( !combat ) return;
    if ( leads(combatant.actorId) ) {
      if ( (combatant.initiative !== null) && (combatant.initiative !== undefined) ) {
        void followCharacter(combat, combatant.actorId);
      }
      return;
    }
    const leader = leaderOf(combat, combatant);
    if ( leader ) void followCharacter(combat, leader);
  });
}

/**
 * Place a character's companions in a combat after their leaders, in one write; with `cleared`,
 * clear those no one leads now. Queued per combat, each run reading the combat as it is then.
 * @param {Combat} combat
 * @param {string} characterId
 * @param {object} [options]
 * @param {boolean} [options.cleared]   Was the character's initiative cleared?
 * @returns {Promise<void>}
 */
export function followCharacter(combat, characterId, { cleared=false }={}) {
  if ( !isBridge() || !combat?.id ) return Promise.resolve();
  return queued(combat.id, () => place(combat.id, { characterId, cleared }));
}

/**
 * Place every companion whose leader has an initiative, in every combat, never clearing. Of the
 * campaigns named, every one, as when they're switched to "Right after its character". Of none
 * named, as when this client becomes the one that writes, on a page load or a Gamemaster's
 * leaving, only what was missed while no Gamemaster was connected: a companion this module placed
 * last, or one with none, so that one whose initiative the Gamemaster or a roll set since stands
 * until its character's next change (round 0.36.0 §2.7 rules 5 and 6).
 * @param {object} [options]
 * @param {string[]} [options.campaignIds]   The campaigns just switched to "Right after its character".
 * @returns {Promise<void>}
 */
export async function followAll({ campaignIds }={}) {
  if ( !isBridge() ) return;
  const combats = game.combats?.filter?.(() => true) ?? [];
  await Promise.all(combats.map(combat => queued(combat.id, () => place(combat.id, { campaignIds }))));
}

/**
 * Note how each campaign's companions enter initiative, as the campaigns setting now says, and place
 * those of each campaign switched to "Right after its character" since it was last noted, as a save
 * of Manage Campaigns switches one. A save that switched none, one that renamed a campaign or
 * changed another, places none, and one switched back writes nothing (round 0.36.0 §2.7 rule 6).
 * Every client notes it; only the one that writes places them.
 * @returns {Promise<void>}
 */
export function initiativeChosen() {
  const before = chosen;
  chosen = initiativeModes();
  if ( !before ) return Promise.resolve();
  const campaignIds = Array.from(chosen)
    .filter(([id, mode]) => (mode === COMPANION_INITIATIVE.AFTER) && (before.get(id) !== COMPANION_INITIATIVE.AFTER))
    .map(([id]) => id);
  return campaignIds.length ? followAll({ campaignIds }) : Promise.resolve();
}

/* -------------------------------------------- */

/**
 * How each campaign's companions enter initiative now, by campaign id.
 * @returns {Map<string, string>}
 */
function initiativeModes() {
  return new Map(getCampaigns().map(campaign => [campaign.id, campaign.companionInitiative]));
}

/**
 * Was a companion's combatant last placed by this module, or has it no initiative: one whose
 * leader's change, missed while no Gamemaster was connected, it's to follow now? The value it last
 * wrote is kept on the combatant, so that a page load knows it; any other value someone set since,
 * the Gamemaster's edit or its own roll, which stands.
 * @param {Combatant} combatant
 * @returns {boolean}
 */
function placedHere(combatant) {
  const initiative = combatant.initiative ?? null;
  return (initiative === null) || (initiative === combatant.flags?.[MODULE_ID]?.followed);
}

/**
 * Is an actor a character of a campaign set to "Right after its character", whose changes its
 * companions follow?
 * @param {string|null} actorId
 * @returns {boolean}
 */
function leads(actorId) {
  return getCampaigns().some(campaign => (campaign.companionInitiative === COMPANION_INITIATIVE.AFTER)
    && campaign.characters.has(actorId));
}

/**
 * The character a combatant follows, where it's a listed companion of a campaign set to "Right after
 * its character": the first of its characters with an initiative in its combat.
 * @param {Combat} combat
 * @param {Combatant} combatant
 * @returns {string|null}
 */
function leaderOf(combat, combatant) {
  for ( const campaign of getCampaigns() ) {
    if ( campaign.companionInitiative !== COMPANION_INITIATIVE.AFTER ) continue;
    for ( const { entry } of companionsOf(campaign) ) {
      if ( companionKeyOf([entry], combatant) === null ) continue;
      const leader = leaderIn(combat, entry);
      if ( leader ) return leader.actorId;
    }
  }
  return null;
}

/**
 * A companion's leader in a combat: the combatant of the first of its characters, in the campaign's
 * order, that has an initiative there.
 * @param {Combat} combat
 * @param {CompanionEntry} entry
 * @returns {Combatant|null}
 */
function leaderIn(combat, entry) {
  for ( const id of entry.of ) {
    const leader = combat.combatants.find(combatant => (combatant.actorId === id)
      && (combatant.initiative !== null) && (combatant.initiative !== undefined));
    if ( leader ) return leader;
  }
  return null;
}

/**
 * Is an update to a combatant's initiative one this module made itself: marked so, or, should core
 * not hand the writing client's hooks its own options, the value it's writing for that combatant?
 * @param {Combatant} combatant
 * @param {object} changes
 * @param {object} [options]
 * @returns {boolean}
 */
function ownWrite(combatant, changes, options) {
  if ( options?.[MODULE_ID]?.follows === true ) return true;
  return writing.has(combatant.id) && (writing.get(combatant.id) === changes.initiative);
}

/**
 * Run something for a combat once whatever ran for it before has finished.
 * @param {string} combatId
 * @param {() => Promise<void>} run
 * @returns {Promise<void>}
 */
function queued(combatId, run) {
  const next = (queues.get(combatId) ?? Promise.resolve()).then(run).catch(() => null);
  queues.set(combatId, next);
  void next.finally(() => {
    if ( queues.get(combatId) === next ) queues.delete(combatId);
  });
  return next;
}

/**
 * Place the companions of the campaigns set to "Right after its character" in a combat, as it is
 * now: of one character, where named; else of the campaigns named, every one; else of every
 * campaign, only what was missed (`followAll`). Each campaign in Manage Campaigns' order, each
 * companion once, by the rule now, capped (creatures.mjs): one not in the combat is left alone; one
 * with a leader there is set just below it; one with none is cleared only where its character's
 * initiative was. One write for the combat, of what differs, marked as this module's, each value it
 * writes kept on its combatant, `flags["sending-stone"].followed`, so that what was missed is told
 * apart from what someone set since even after a page load. A write that fails is left, as its
 * character's next change places it again.
 * @param {string} combatId
 * @param {object} options
 * @param {string|null} [options.characterId]   The character whose companions to place.
 * @param {boolean} [options.cleared]           Was its initiative cleared?
 * @param {string[]} [options.campaignIds]      The campaigns whose companions to place, every one.
 * @returns {Promise<void>}
 */
async function place(combatId, { characterId=null, cleared=false, campaignIds=null }) {
  const combat = game.combats?.get(combatId);
  if ( !combat || !isBridge() ) return;
  const missed = !characterId && !campaignIds;
  const values = new Map();
  const placed = new Set();
  for ( const campaign of getCampaigns() ) {
    if ( campaign.companionInitiative !== COMPANION_INITIATIVE.AFTER ) continue;
    if ( characterId && !campaign.characters.has(characterId) ) continue;
    if ( campaignIds && !campaignIds.includes(campaign.id) ) continue;
    for ( const { entry } of companionsOf(campaign) ) {
      if ( (characterId && !entry.of.includes(characterId)) || placed.has(entry.key) ) continue;
      placed.add(entry.key);
      const own = combat.combatants.filter(combatant => companionKeyOf([entry], combatant) !== null);
      if ( !own.length ) continue;
      const leader = leaderIn(combat, entry);
      const value = leader ? followValue(leader.initiative) : (cleared ? null : undefined);
      if ( value === undefined ) continue;
      for ( const combatant of own ) {
        if ( missed && !placedHere(combatant) ) continue;
        if ( (combatant.initiative ?? null) !== value ) values.set(combatant.id, value);
      }
    }
  }
  if ( !values.size ) return;
  const updates = Array.from(values, ([_id, initiative]) => ({
    _id, initiative, flags: { [MODULE_ID]: { followed: initiative } }
  }));
  for ( const { _id, initiative } of updates ) writing.set(_id, initiative);
  try {
    await combat.updateEmbeddedDocuments("Combatant", updates, { [MODULE_ID]: { follows: true } });
  } catch {
    // Left as it was: its character's next change places it again.
  } finally {
    for ( const { _id, initiative } of updates ) {
      if ( writing.get(_id) === initiative ) writing.delete(_id);
    }
  }
}
