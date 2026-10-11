import { EVENTS } from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { summarizeCharacter } from "./characters.mjs";
import { sendTexts, SheetTexts, takeUnsent } from "./sheet-texts.mjs";
import { send } from "./transport.mjs";

/**
 * Keeping each campaign's copy of its characters current between hellos. When a character
 * changes, as when it takes damage, levels up, equips armor or gains a condition, each campaign
 * it is in is sent `character.updated` with the character as it now stands, sheet included.
 *
 * A change to an actor's items or effects changes what its sheet shows, so those count too, as
 * does time passing in the game or a new round of combat, which runs effects down, and a change to
 * the world's rules for a critical hit's damage, which every sheet says. A burst of changes, such
 * as a level up, is sent once it settles, and a change that leaves what a campaign was told as it
 * was is not sent at all. Any description the campaign has not been sent goes first, in
 * character.texts.
 */

/**
 * How long to wait for a burst of changes to one character to settle before sending it, in
 * milliseconds.
 * @type {number}
 */
const SETTLE_AFTER = 250;

/**
 * What each campaign was last told about each of its characters, as JSON, keyed by the campaign's
 * id and the actor's, as `${campaignId}.${actorId}`.
 * @type {Map<string, string>}
 */
const told = new Map();

/**
 * Characters with changes waiting to settle, and their timers, by actor id.
 * @type {Map<string, number>}
 */
const settling = new Map();

/**
 * The world's settings that change how a critical hit's damage is rolled: dnd5e's, and Midi-QOL's,
 * which keeps its rules for critical hits among its own.
 * @type {Set<string>}
 */
const CRITICAL_SETTINGS = new Set([
  "dnd5e.criticalDamageModifiers", "dnd5e.criticalDamageMaxDice", "midi-qol.ConfigSettings"
]);

/* -------------------------------------------- */

/**
 * Listen for changes to actors, and to the items and effects they hold.
 * @returns {void}
 */
export function registerCharacterHooks() {
  Hooks.on("updateActor", actor => characterChanged(actor));
  for ( const hook of [
    "createItem", "updateItem", "deleteItem",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"
  ] ) {
    Hooks.on(hook, document => characterChanged(owningActor(document)));
  }
  Hooks.on("updateWorldTime", () => effectsRunningDown());
  Hooks.on("updateCombat", (combat, changes) => {
    if ( ("round" in changes) || ("turn" in changes) ) effectsRunningDown();
  });
  // A world setting is stored the first time it's changed from its default, and updated after.
  for ( const hook of ["createSetting", "updateSetting"] ) {
    Hooks.on(hook, setting => criticalRulesChanged(setting));
  }
}

/**
 * Record what a campaign was told about its characters in a bridge.hello, replacing what it was
 * told before.
 * @param {Campaign} campaign
 * @param {object[]} characters   The campaign's characters, as sent.
 * @returns {void}
 */
export function noteCharactersSent(campaign, characters) {
  for ( const key of told.keys() ) {
    if ( key.startsWith(`${campaign.id}.`) ) told.delete(key);
  }
  for ( const character of characters ) told.set(`${campaign.id}.${character.id}`, JSON.stringify(character));
}

/**
 * Send each campaign a character is in the character as it now stands, unless that is what the
 * campaign was last told.
 * @param {string} actorId
 * @returns {void}
 */
export function sendCharacter(actorId) {
  if ( !canSend() ) return;
  const actor = game.actors.get(actorId);
  if ( !actor ) return;
  for ( const campaign of getCampaigns() ) {
    if ( !campaign.characters.has(actorId) ) continue;
    const texts = new SheetTexts();
    const character = summarizeCharacter(actor, texts);
    const json = JSON.stringify(character);
    const key = `${campaign.id}.${actorId}`;
    if ( told.get(key) === json ) continue;
    told.set(key, json);
    sendTexts(campaign, takeUnsent(campaign, texts));
    send(EVENTS.CHARACTER_UPDATED, { character }, campaign);
  }
}

/* -------------------------------------------- */

/**
 * Note that a character may have changed, and send it once its changes settle. Only the bridge
 * sends; every other client ignores the change.
 * @param {Actor|null} actor
 * @returns {void}
 */
function characterChanged(actor) {
  if ( !actor?.id || !canSend() ) return;
  const id = actor.id;
  clearTimeout(settling.get(id));
  settling.set(id, setTimeout(() => {
    settling.delete(id);
    sendCharacter(id);
  }, SETTLE_AFTER));
}

/**
 * Note that every campaign character with a temporary effect may have changed, since the time it
 * has left is on its sheet.
 * @returns {void}
 */
function effectsRunningDown() {
  if ( !canSend() ) return;
  for ( const actor of campaignCharacters() ) {
    const effects = Array.from(actor.allApplicableEffects?.() ?? []);
    if ( effects.some(effect => effect.isTemporary) ) characterChanged(actor);
  }
}

/**
 * Note that every campaign character may have changed when one of the world's settings for critical
 * hits does, since its sheet says how their damage is rolled.
 * @param {Setting} setting   The setting stored or changed.
 * @returns {void}
 */
function criticalRulesChanged(setting) {
  if ( !CRITICAL_SETTINGS.has(setting?.key) || !canSend() ) return;
  for ( const actor of campaignCharacters() ) characterChanged(actor);
}

/**
 * Every character in a campaign, once each.
 * @returns {Actor[]}
 */
function campaignCharacters() {
  const ids = new Set(getCampaigns().flatMap(campaign => Array.from(campaign.characters)));
  return Array.from(ids, id => game.actors.get(id)).filter(Boolean);
}

/**
 * The actor an embedded document, such as an item or an effect, ultimately belongs to.
 * @param {Document} document
 * @returns {Actor|null}
 */
function owningActor(document) {
  let parent = document?.parent;
  while ( parent && (parent.documentName !== "Actor") ) parent = parent.parent;
  return parent ?? null;
}
