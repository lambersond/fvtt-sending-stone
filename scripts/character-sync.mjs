import { EVENTS, MODULE_ID } from "./constants.mjs";
import { canSend, resendHello } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { campaignActors, rosterEntry, summarizeCharacter } from "./characters.mjs";
import { slimSheet } from "./sheet-slim.mjs";
import { forgetSent, sendTexts, SheetTexts, takeUnsent } from "./sheet-texts.mjs";
import { buildEnvelope, helloPending, inMegabytes, post, termsOf } from "./transport.mjs";

/**
 * Keeping each campaign's copy of its characters current. Since 0.22.0 a bridge.hello lists a
 * campaign's characters without their sheets, and once it's answered each character follows in
 * `character.updated`, a post of its own, so that a large party's sheets never make one post too
 * large to take. After that, when a character changes, as when it takes damage, levels up, equips
 * armor or gains a condition, each campaign it is in is sent `character.updated` with the
 * character as it now stands, sheet included.
 *
 * A change to an actor's items or effects changes what its sheet shows, so those count too, as
 * does time passing in the game or a new round of combat, which runs effects down, and a change to
 * the world's rules for a critical hit's damage, which every sheet says. A burst of changes, such
 * as a level up, is sent once it settles, and a change that leaves what a campaign was told as it
 * was is not sent at all. Any description the campaign has not been sent goes first, in
 * character.texts.
 *
 * Each sheet is sent as the campaign's listener last said it takes them: slim, as sheet-slim.mjs
 * makes it, where it expands them, and never in a post larger than it takes. A sheet too large is
 * withheld, the listener and the Gamemaster told so, rather than cut short. And a sheet, or the
 * hello it follows, lost to failures that might not last is sent again a while later.
 */

/**
 * How long to wait for a burst of changes to one character to settle before sending it, in
 * milliseconds.
 * @type {number}
 */
const SETTLE_AFTER = 250;

/**
 * How long after a post is lost to failures that might not last it is sent again, in milliseconds,
 * as the heartbeat's check finds it due.
 * @type {number}
 */
const RESEND_AFTER = 30_000;

/**
 * What each campaign was last told about each of its characters, as JSON, keyed by the campaign's
 * id and the actor's, as `${campaignId}.${actorId}`.
 * @type {Map<string, string>}
 */
const told = new Map();

/**
 * Each character as it was built when its campaign was last told of it, as JSON, by the same
 * keys: the same as what it was told, unless its sheet was withheld, so that a sheet still too
 * large isn't posted again each time it's looked at.
 * @type {Map<string, string>}
 */
const built = new Map();

/**
 * Characters with changes waiting to settle, and their timers, by actor id.
 * @type {Map<string, number>}
 */
const settling = new Map();

/**
 * The hellos and characters lost to failures that might not last, to be sent again, by
 * `hello:${campaignId}` or `${campaignId}.${actorId}`, with when they were lost.
 * @type {Map<string, {campaignId: string, actorId: string|null, at: number}>}
 */
const lost = new Map();

/**
 * The characters whose sheets the Gamemaster has been told were too large to send this page load,
 * as `${campaignId}.${actorId}`.
 * @type {Set<string>}
 */
const warned = new Set();

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
 * Forget what a campaign was told of its characters, so that each is sent again, as after a hello.
 * @param {string} campaignId
 * @returns {void}
 */
export function forgetTold(campaignId) {
  for ( const key of told.keys() ) {
    if ( !key.startsWith(`${campaignId}.`) ) continue;
    told.delete(key);
    built.delete(key);
  }
}

/**
 * Send each campaign a character is in the character as it now stands, unless that is what the
 * campaign was last told. A campaign whose hello is on its way is left be: every character follows
 * the hello once it's answered, sent as its answer says the listener takes them.
 * @param {string} actorId
 * @returns {void}
 */
export function sendCharacter(actorId) {
  if ( !canSend() ) return;
  const actor = game.actors.get(actorId);
  if ( !actor ) return;
  for ( const campaign of getCampaigns() ) {
    if ( !campaign.characters.has(actorId) || helloPending(campaign.id) ) continue;
    sendSheet(campaign, actor);
  }
}

/**
 * Send a campaign whose hello was answered every character, in the order the hello listed them,
 * each in a post of its own after the descriptions its sheet refers to. Every description goes
 * again, as every sheet does: the listener started afresh, and another hello may have followed the
 * one that was answered.
 * @param {string} campaignId
 * @returns {void}
 */
export function helloDelivered(campaignId) {
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( !campaign || !canSend() ) return;
  forgetTold(campaign.id);
  forgetSent(campaign.id);
  for ( const actor of campaignActors(campaign) ) sendSheet(campaign, actor);
}

/**
 * Send a campaign every character again as its listener now takes them, as when it says it expands
 * slim sheets, says so no longer, or takes larger posts than before, which a sheet withheld as too
 * large may now fit in. Not while a hello is on its way, which they follow anyway.
 * @param {string} campaignId
 * @returns {void}
 */
export function sheetTermsChanged(campaignId) {
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( !campaign || !canSend() || helloPending(campaign.id) ) return;
  forgetTold(campaign.id);
  for ( const actor of campaignActors(campaign) ) sendSheet(campaign, actor);
}

/**
 * Send a campaign a character as it now stands, unless that is what the campaign was last told:
 * in `character.updated`, after any description its sheet refers to that the campaign hasn't been
 * sent, in the slim format the listener expands, if it does. A sheet that can't be described goes
 * as null, so that one character can't cost the others theirs; one that makes a post larger than
 * the listener takes is withheld, the post saying so, and its descriptions wait for a sheet that
 * fits.
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @returns {void}
 */
function sendSheet(campaign, actor) {
  try {
    let texts = new SheetTexts();
    let character;
    try {
      character = summarizeCharacter(actor, texts);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not describe the sheet of ${actor.name}`, err);
      texts = new SheetTexts();
      character = { ...rosterEntry(actor), sheet: null };
    }
    const { slimSheets, maxBytes } = termsOf(campaign.id);
    if ( slimSheets && character.sheet ) {
      try {
        character.sheet = slimSheet(character.sheet);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not make the sheet of ${actor.name} smaller; sending it in full`, err);
      }
    }
    const json = JSON.stringify(character);
    const key = `${campaign.id}.${actor.id}`;
    // Nothing new if built as it was when the campaign was last told of it, sheet withheld or not.
    if ( told.has(key) && (built.get(key) === json) ) return;

    // Measured as it will be posted.
    const envelope = buildEnvelope(EVENTS.CHARACTER_UPDATED, { character }, { campaign });
    const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
    if ( bytes <= maxBytes ) {
      told.set(key, json);
      built.set(key, json);
      sendTexts(campaign, takeUnsent(campaign, texts));
      post(envelope);
      return;
    }
    const { sheet, ...entry } = character;
    const withheld = { ...entry, sheet: null, sheetWithheld: { reason: "tooLarge", bytes, limit: maxBytes } };
    envelope.data = { character: withheld };
    told.set(key, JSON.stringify(withheld));
    built.set(key, json);
    post(envelope);
    warnTooLarge(campaign, actor, bytes, maxBytes);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not send ${campaign.title} the sheet of ${actor.name}`, err);
  }
}

/**
 * Tell the Gamemaster, once a page load for each character and campaign, that a sheet was too large
 * to send; and whether its player is told why, as an app that expands slim sheets tells them.
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {number} bytes    The post's size.
 * @param {number} limit    The largest the listener takes.
 * @returns {void}
 */
function warnTooLarge(campaign, actor, bytes, limit) {
  const key = `${campaign.id}.${actor.id}`;
  const size = inMegabytes(bytes, Math.ceil);
  console.warn(`${MODULE_ID} | The sheet of ${actor.name} came to ${size}, more than ${campaign.title} takes`);
  if ( warned.has(key) ) return;
  warned.add(key);
  const notice = termsOf(campaign.id).slimSheets ? "SENDINGSTONE.Notify.SheetTooLarge" : "SENDINGSTONE.Notify.SheetTooLargeUntold";
  ui.notifications.warn(game.i18n.format(notice, {
    name: actor.name, campaign: campaign.title, size, limit: inMegabytes(limit, Math.floor)
  }));
}

/* -------------------------------------------- */

/**
 * Note a post that was dropped, to send it again later if it was lost to failures that might not
 * last, such as the app restarting: a hello, which the app may have taken with its answer lost, and
 * no sheet followed; a character, which the campaign is no longer taken to have been told; or
 * descriptions, which go again with the next sheet that refers to them. What the app refused would
 * be refused again, and isn't.
 * @param {object} envelope
 * @param {{temporary: boolean}} options
 * @returns {void}
 */
export function eventDropped(envelope, { temporary }={}) {
  const campaignId = envelope?.campaign?.id;
  if ( !temporary || !campaignId ) return;
  switch ( envelope.type ) {
    case EVENTS.HELLO:
      lost.set(`hello:${campaignId}`, { campaignId, actorId: null, at: Date.now() });
      break;
    case EVENTS.CHARACTER_UPDATED: {
      const character = envelope.data?.character;
      if ( !character?.id ) return;
      const key = `${campaignId}.${character.id}`;
      if ( told.get(key) === JSON.stringify(character) ) told.delete(key);
      lost.set(key, { campaignId, actorId: character.id, at: Date.now() });
      break;
    }
    case EVENTS.CHARACTER_TEXTS:
      forgetSent(campaignId, Object.keys(envelope.data?.texts ?? {}));
      break;
  }
}

/**
 * Send again what was lost long enough ago: a hello, with every character after it, or a character.
 * @returns {void}
 */
export function resendLost() {
  const now = Date.now();
  for ( const [key, { campaignId, actorId, at }] of lost ) {
    if ( now - at < RESEND_AFTER ) continue;
    lost.delete(key);
    if ( actorId ) sendCharacter(actorId);
    else resendHello(campaignId);
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
 * Note that every campaign character with a temporary effect, or an item of theirs with a temporary
 * enchantment, may have changed, since the time it has left is on its sheet.
 * @returns {void}
 */
function effectsRunningDown() {
  if ( !canSend() ) return;
  for ( const actor of campaignCharacters() ) {
    const effects = Array.from(actor.allApplicableEffects?.() ?? []);
    const enchanted = Array.from(actor.items ?? []).some(item => (typeof item.effects?.some === "function")
      && item.effects.some(effect => effect.isAppliedEnchantment && effect.isTemporary));
    if ( enchanted || effects.some(effect => effect.isTemporary) ) characterChanged(actor);
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
