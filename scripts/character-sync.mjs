import { EVENTS, MODULE_ID } from "./constants.mjs";
import { canSend, resendHello } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { campaignActors, rosterEntry } from "./characters.mjs";
import {
  companionsDelivered, companionTermsChanged, creatureChanged, forgetListed, listingDropped, listsChanged,
  resendCompanion, toldCompanions
} from "./creature-sync.mjs";
import { noteSheetSent, noteWithheld } from "./delivery-status.mjs";
import { campaignGroups, groupEntry, groupReader, groupsListing } from "./groups.mjs";
import { forgetBooks, journalOwnershipChanged, sendBooks } from "./journals.mjs";
import { groupSheet } from "./sheet-group.mjs";
import { characterSheet } from "./sheet.mjs";
import { slimSheet } from "./sheet-slim.mjs";
import { forgetSent, sendTexts, SheetTexts, takeUnsent } from "./sheet-texts.mjs";
import { buildEnvelope, helloPending, inMegabytes, post, send, termsOf } from "./transport.mjs";
import { typesDice } from "./typed-dice.mjs";

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
 *
 * Since 0.30.0 a campaign's groups, its parties, are kept current the same way, in `group.updated`,
 * to an app that says it reads them (groups.mjs): when the group or its items change, when one of
 * its members is renamed or given a new portrait, and when who may see it does, as when a campaign
 * character's ownership changes; and `group.removed` when one is deleted.
 *
 * Since 0.32.0 each character says whether its player may enter its dice results in the app,
 * `manualDice` (typed-dice.mjs), so it's sent again when who may could have changed: the world's
 * roles' permissions, or a user's role, assigned Character or own permissions, or a user added or
 * removed. Only those whose answer changed are posted.
 *
 * Since 0.36.0 a campaign's characters' companions are kept current the same way, to an app that
 * reads them (creature-sync.mjs): their sheets in the same maps, each keyed `c:<key>`, so that two
 * tokens of one actor never share one.
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
 * id and the actor's, as `${campaignId}.${actorId}`; since 0.36.0 a companion's by its key, as
 * `${campaignId}.c:${key}`.
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
 * The actors settling whose ownership changed, which changes who may see every group of their
 * campaigns.
 * @type {Set<string>}
 */
const ownershipChanged = new Set();

/**
 * The hellos and characters lost to failures that might not last, to be sent again, by
 * `hello:${campaignId}` or `${campaignId}.${actorId}`, with when they were lost; since 0.36.0 a
 * campaign's companions' list, by `companions:${campaignId}`, and a companion's sheet, by
 * `${campaignId}.c:${key}`.
 * @type {Map<string, {campaignId: string, actorId: string|null, companions?: boolean,
 *   companionKey?: string, at: number}>}
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
 * which keeps its rules for critical hits among its own. Since 0.32.0 the app's rolls follow
 * dnd5e's rules whatever Midi's say, so a change to Midi's leaves every sheet as it was, and none is
 * posted.
 * @type {Set<string>}
 */
const CRITICAL_SETTINGS = new Set([
  "dnd5e.criticalDamageModifiers", "dnd5e.criticalDamageMaxDice", "midi-qol.ConfigSettings"
]);

/* -------------------------------------------- */

/**
 * What changing on a user may change who may type a character's dice: their role, their assigned
 * Character, or a permission of their own.
 * @type {string[]}
 */
const USER_KEYS = ["role", "character", "permissions"];

/* -------------------------------------------- */

/**
 * Listen for changes to actors, and to the items and effects they hold; and since 0.32.0, to the
 * world's roles' permissions and to its users, which decide who may type a character's dice.
 * @returns {void}
 */
export function registerCharacterHooks() {
  Hooks.on("updateActor", (actor, changes) => characterChanged(actor, changes));
  Hooks.on("deleteActor", actor => actorDeleted(actor));
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
    Hooks.on(hook, setting => primaryPartyChanged(setting));
    Hooks.on(hook, setting => permissionsChanged(setting));
  }
  Hooks.on("updateUser", (user, changes) => usersChanged(changes));
  Hooks.on("createUser", () => usersChanged());
  Hooks.on("deleteUser", () => usersChanged());
}

/**
 * Forget what a campaign was told of its characters, so that each is sent again, as after a hello;
 * since 0.36.0 of its companions too, their sheets and, but where the listener's terms alone
 * changed, their list.
 * @param {string} campaignId
 * @param {object} [options]
 * @param {boolean} [options.lists]   Forget what it was told of its companions' list.
 * @returns {void}
 */
export function forgetTold(campaignId, { lists=true }={}) {
  for ( const key of told.keys() ) {
    if ( !key.startsWith(`${campaignId}.`) ) continue;
    told.delete(key);
    built.delete(key);
  }
  if ( lists ) forgetListed(campaignId);
}

/**
 * Forget what a campaign was told of one actor's sheet, by its key, as of a companion no longer
 * listed: what was built, lost and warned of it too, and that it was withheld.
 * @param {string} campaignId
 * @param {string} key   An actor's id, or a companion's `c:<key>`.
 * @returns {void}
 */
export function forgetActorKey(campaignId, key) {
  const full = `${campaignId}.${key}`;
  told.delete(full);
  built.delete(full);
  lost.delete(full);
  warned.delete(full);
  noteSheetSent(campaignId, key);
}

/**
 * Forget only that a campaign was told an actor's sheet, by its key, so that it's sent again as it
 * now stands however it's built: since 0.36.0 a companion's that went after a list its app never
 * took, which ignored it as one it didn't list. What was warned of it stays warned.
 * @param {string} campaignId
 * @param {string} key   A companion's `c:<key>`.
 * @returns {void}
 */
export function forgetSheetTold(campaignId, key) {
  told.delete(`${campaignId}.${key}`);
}

/**
 * Send each campaign a character is in the character as it now stands, unless that is what the
 * campaign was last told. A campaign whose hello is on its way is left be: every character follows
 * the hello once it's answered, sent as its answer says the listener takes them.
 *
 * Since 0.30.0, then every group the change may show in, to each campaign whose app reads groups:
 * the actor itself as a group; each group it's a member of, for its name and portrait; and where
 * its ownership changed and it's a campaign character, every group of its campaigns, for who may
 * see them. Each goes only where it isn't what the campaign was last told, so a member's hit points
 * changing sends no group. The character goes first, as a command's result follows its sheet. Since
 * 0.34.0, where its ownership changed, who may see its journals of notes is set again, and they're
 * sent (journals.mjs).
 * @param {string} actorId
 * @param {object} [options]
 * @param {boolean} [options.ownership]   Did its ownership change?
 * @returns {void}
 */
export function sendCharacter(actorId, { ownership=false }={}) {
  if ( !canSend() ) return;
  const actor = game.actors.get(actorId);
  if ( actor ) {
    for ( const campaign of getCampaigns() ) {
      if ( !campaign.characters.has(actorId) || helloPending(campaign.id) ) continue;
      sendSheet(campaign, actor);
    }
  }
  const groups = new Map();
  const add = (campaign, group) => groups.set(`${campaign.id}.${group.id}`, { campaign, group });
  for ( const campaign of getCampaigns() ) {
    if ( !groupsTaken(campaign) ) continue;
    const listed = campaignGroups(campaign);
    const own = listed.find(group => group.id === actorId);
    if ( own ) add(campaign, own);
    if ( ownership && campaign.characters.has(actorId) ) listed.forEach(group => add(campaign, group));
  }
  for ( const { campaign, group } of groupsListing(actorId) ) {
    if ( groupsTaken(campaign) ) add(campaign, group);
  }
  for ( const { campaign, group } of groups.values() ) sendGroup(campaign, group);
  if ( ownership ) void journalOwnershipChanged(actorId);
}

/**
 * Does a campaign's app read groups, with no hello on its way, which its groups follow anyway?
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function groupsTaken(campaign) {
  return groupReader(campaign.id) && !helloPending(campaign.id);
}

/**
 * Send a campaign whose app has just said it reads groups, in answer to a heartbeat, as an app
 * deployed mid-session does, every group afresh. After a hello's answer, they follow its
 * characters instead.
 * @param {string} campaignId
 * @returns {void}
 */
export function groupsWanted(campaignId) {
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( !campaign || !canSend() || helloPending(campaign.id) ) return;
  for ( const group of campaignGroups(campaign) ) {
    const key = `${campaign.id}.${group.id}`;
    told.delete(key);
    built.delete(key);
  }
  sendGroups(campaign);
}

/**
 * Send a campaign whose app reads groups each of its groups as it now stands, in the order the
 * Gamemaster listed them.
 * @param {Campaign} campaign
 * @returns {void}
 */
function sendGroups(campaign) {
  if ( !groupReader(campaign.id) ) return;
  for ( const group of campaignGroups(campaign) ) sendGroup(campaign, group);
}

/**
 * Send a campaign whose hello was answered every character, in the order the hello listed them,
 * each in a post of its own after the descriptions its sheet refers to. Every description goes
 * again, as every sheet does: the listener started afresh, and another hello may have followed the
 * one that was answered. Then its groups, and since the hello was built when it was queued, the
 * removal of any group it listed that has been deleted since; since 0.36.0 its companions, to an
 * app that reads them, as creature-sync.mjs sends them; and since 0.34.0, every journal of notes the
 * campaign has, to an app that reads them.
 * @param {string} campaignId
 * @param {object} [hello]    The hello answered.
 * @returns {void}
 */
export function helloDelivered(campaignId, hello) {
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( !campaign || !canSend() ) return;
  forgetTold(campaign.id);
  forgetSent(campaign.id);
  forgetBooks(campaign.id);
  for ( const actor of campaignActors(campaign) ) sendSheet(campaign, actor);
  sendGroups(campaign);
  removedSince(campaign, hello);
  companionsDelivered(campaign, hello);
  sendBooks(campaign, hello);
}

/**
 * Tell a campaign whose app reads groups, in `group.removed`, of each group its hello listed that
 * no longer exists: one deleted while the hello was on its way, which `actorDeleted` leaves to it.
 * The app keeps each group the hello lists, and nothing after it would say this one is gone. One
 * that exists but isn't listed any more was taken out in Manage Campaigns, which says so in a
 * hello of its own.
 * @param {Campaign} campaign
 * @param {object} [hello]
 * @returns {void}
 */
function removedSince(campaign, hello) {
  const listed = hello?.data?.groups;
  if ( !groupReader(campaign.id) || !Array.isArray(listed) ) return;
  for ( const id of listed.map(entry => entry?.id) ) {
    if ( (typeof id !== "string") || (game.actors.get(id)?.type === "group") ) continue;
    send(EVENTS.GROUP_REMOVED, { id }, campaign);
  }
}

/**
 * Send a campaign every character again as its listener now takes them, as when it says it expands
 * slim sheets, says so no longer, or takes larger posts than before, which a sheet withheld as too
 * large may now fit in. Not while a hello is on its way, which they follow anyway. Since 0.34.0 its
 * journals of notes too, which a larger post may now take; and since 0.36.0 its companions' sheets.
 * @param {string} campaignId
 * @returns {void}
 */
export function sheetTermsChanged(campaignId) {
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( !campaign || !canSend() || helloPending(campaign.id) ) return;
  forgetTold(campaign.id, { lists: false });
  for ( const actor of campaignActors(campaign) ) sendSheet(campaign, actor);
  sendGroups(campaign);
  companionTermsChanged(campaign);
  forgetBooks(campaign.id);
  sendBooks(campaign);
}

/**
 * Send a campaign a character as it now stands, unless that is what the campaign was last told:
 * in `character.updated`, as `sendActor` sends it. Since 0.32.0 with whether its player may enter
 * its dice results in the app, `manualDice`, as the hello's roster says it, read as it's built.
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @returns {void}
 */
function sendSheet(campaign, actor) {
  sendActor(campaign, actor, {
    event: EVENTS.CHARACTER_UPDATED,
    build: ({ sheet=true }={}) => {
      const texts = new SheetTexts();
      const manualDice = typesDice(actor, campaign);
      return { texts, data: { character: sheet
        ? { ...rosterEntry(actor), manualDice, sheet: characterSheet(actor, texts) }
        : { ...rosterEntry(actor), manualDice, sheet: null } } };
    }
  });
}

/**
 * Send a campaign one of its groups as it now stands, unless that is what the campaign was last
 * told: in `group.updated`, as `sendActor` sends it, its descriptions enriched without secrets or
 * links to act on. One no campaign character may see in Foundry goes without its sheet or any
 * description, saying it's private.
 * @param {Campaign} campaign
 * @param {Actor} group
 * @returns {void}
 */
function sendGroup(campaign, group) {
  sendActor(campaign, group, {
    event: EVENTS.GROUP_UPDATED,
    build: ({ sheet=true }={}) => {
      const entry = groupEntry(group, campaign);
      if ( !Object.keys(entry.access).length ) {
        return { texts: new SheetTexts(), data: { group: { ...entry, sheet: null, sheetWithheld: { reason: "private" } } } };
      }
      const texts = new SheetTexts({ secrets: false, actionable: false });
      return { texts, data: { group: { ...entry, sheet: sheet ? groupSheet(group, texts, campaign) : null } } };
    }
  });
}

/**
 * Send a campaign an actor as it now stands, a character or since 0.30.0 a group, unless that is
 * what the campaign was last told: after any description its sheet refers to that the campaign
 * hasn't been sent, in the slim format the listener expands, if it does. A sheet that can't be
 * described goes as null, so that one actor can't cost the others theirs; one that makes a post
 * larger than the listener takes is withheld, the post saying so, and its descriptions wait for a
 * sheet that fits. Since 0.36.0 a companion's too, by the key it's told by, its sheet beside its
 * entry in `companion.updated` (`apart`), where a withheld one's entry says so.
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} kind
 * @param {string} kind.event   The event it goes in.
 * @param {(options?: {sheet?: boolean}) => {texts: SheetTexts, data: object}} kind.build
 *   Builds the event's data, its one key the actor with its sheet, and the descriptions the sheet
 *   refers to; with `sheet: false`, the actor with a null sheet, and none.
 * @param {string} [kind.key]     What it's told by: its actor's id, or a companion's `c:<key>`.
 * @param {string} [kind.name]    What the Gamemaster is told it's called: its actor's name.
 * @param {boolean} [kind.apart]  Is its sheet beside its entry, `{companion, sheet}`, not in it?
 * @returns {void}
 */
export function sendActor(campaign, actor, { event, build, key: id=actor.id, name=actor.name, apart=false }) {
  try {
    let made;
    try {
      made = build();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not describe the sheet of ${name}`, err);
      made = build({ sheet: false });
    }
    const { texts, data } = made;
    const [[field, entry]] = Object.entries(data);
    const holder = apart ? data : entry;
    const { slimSheets, maxBytes } = termsOf(campaign.id);
    if ( slimSheets && holder.sheet ) {
      try {
        holder.sheet = slimSheet(holder.sheet);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not make the sheet of ${name} smaller; sending it in full`, err);
      }
    }
    const json = JSON.stringify(apart ? data : entry);
    const key = `${campaign.id}.${id}`;
    // Nothing new if built as it was when the campaign was last told of it, sheet withheld or not.
    if ( told.has(key) && (built.get(key) === json) ) return;

    // Measured as it will be posted.
    const envelope = buildEnvelope(event, data, { campaign });
    const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
    if ( bytes <= maxBytes ) {
      told.set(key, json);
      built.set(key, json);
      sendTexts(campaign, takeUnsent(campaign, texts));
      post(envelope);
      noteSheetSent(campaign.id, id);
      return;
    }
    const sheetWithheld = { reason: "tooLarge", bytes, limit: maxBytes };
    const { sheet, ...rest } = entry;
    envelope.data = apart ? { [field]: { ...entry, sheetWithheld }, sheet: null }
      : { [field]: { ...rest, sheet: null, sheetWithheld } };
    told.set(key, JSON.stringify(apart ? envelope.data : envelope.data[field]));
    built.set(key, json);
    post(envelope);
    warnTooLarge(campaign, { id, name }, bytes, maxBytes);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not send ${campaign.title} the sheet of ${name}`, err);
  }
}

/**
 * Tell the Gamemaster, once a page load for each character and campaign, that a sheet was too large
 * to send; and whether its player is told why, as an app that expands slim sheets tells them. Manage
 * Campaigns shows it withheld until it's sent. Since 0.36.0 a companion's by its key, and its name.
 * @param {Campaign} campaign
 * @param {{id: string, name: string}} withheld   The key it's told by, and its name.
 * @param {number} bytes    The post's size.
 * @param {number} limit    The largest the listener takes.
 * @returns {void}
 */
function warnTooLarge(campaign, { id, name }, bytes, limit) {
  const key = `${campaign.id}.${id}`;
  const size = inMegabytes(bytes, Math.ceil);
  noteWithheld(campaign.id, id, { name, bytes, limit });
  console.warn(`${MODULE_ID} | The sheet of ${name} came to ${size}, more than ${campaign.title} takes`);
  if ( warned.has(key) ) return;
  warned.add(key);
  const notice = termsOf(campaign.id).slimSheets ? "SENDINGSTONE.Notify.SheetTooLarge" : "SENDINGSTONE.Notify.SheetTooLargeUntold";
  ui.notifications.warn(game.i18n.format(notice, {
    name, campaign: campaign.title, size, limit: inMegabytes(limit, Math.floor)
  }));
}

/* -------------------------------------------- */

/**
 * Note a post that was dropped, to send it again later if it was lost to failures that might not
 * last, such as the app restarting: a hello, which the app may have taken with its answer lost, and
 * no sheet followed; a character, which the campaign is no longer taken to have been told; or
 * descriptions, which go again with the next sheet that refers to them. Since 0.30.0 a group as a
 * character; and a group's removal, or what the world's settings are, as the hello, which says both
 * again; and since 0.34.0 a journal of notes, as the hello, which every journal follows. Since
 * 0.36.0 a campaign's companions' list, which is taken as untold and compared again; and a
 * companion's sheet, as a character's. What the app refused would be refused again, and isn't.
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
    case EVENTS.CHARACTER_UPDATED:
    case EVENTS.GROUP_UPDATED: {
      const entry = (envelope.type === EVENTS.GROUP_UPDATED) ? envelope.data?.group : envelope.data?.character;
      if ( !entry?.id ) return;
      const key = `${campaignId}.${entry.id}`;
      if ( told.get(key) === JSON.stringify(entry) ) told.delete(key);
      lost.set(key, { campaignId, actorId: entry.id, at: Date.now() });
      break;
    }
    case EVENTS.COMPANIONS_LISTED:
      listingDropped(campaignId, envelope);
      lost.set(`companions:${campaignId}`, { campaignId, actorId: null, companions: true, at: Date.now() });
      break;
    case EVENTS.COMPANION_UPDATED: {
      const companionKey = envelope.data?.companion?.key;
      if ( typeof companionKey !== "string" ) return;
      const key = `${campaignId}.c:${companionKey}`;
      if ( told.get(key) === JSON.stringify(envelope.data) ) told.delete(key);
      lost.set(key, { campaignId, actorId: null, companionKey, at: Date.now() });
      break;
    }
    case EVENTS.GROUP_REMOVED:
    case EVENTS.BRIDGE_SETTINGS:
    case EVENTS.JOURNAL_UPDATED:
      lost.set(`hello:${campaignId}`, { campaignId, actorId: null, at: Date.now() });
      break;
    case EVENTS.CHARACTER_TEXTS:
      forgetSent(campaignId, Object.keys(envelope.data?.texts ?? {}));
      break;
  }
}

/**
 * Send again what was lost long enough ago: a hello, with every character after it, or a character
 * or group, which `sendCharacter` sends where it now belongs; since 0.36.0 a companions' list, by
 * comparing it again, and a companion's sheet, where it's still listed.
 * @returns {void}
 */
export function resendLost() {
  const now = Date.now();
  for ( const [key, { campaignId, actorId, companions, companionKey, at }] of lost ) {
    if ( now - at < RESEND_AFTER ) continue;
    lost.delete(key);
    if ( companions ) listsChanged({ now: true });
    else if ( companionKey ) resendCompanion(campaignId, companionKey);
    else if ( actorId ) sendCharacter(actorId);
    else resendHello(campaignId);
  }
}

/* -------------------------------------------- */

/**
 * Note that a character may have changed, and send it once its changes settle. Only the bridge
 * sends; every other client ignores the change. Since 0.30.0 it's noted whether any of the changes
 * settling was to its ownership, which changes who may see its campaigns' groups. Since 0.36.0 any
 * actor heard of may be a companion, as a token's synthetic actor is, which is sent as one
 * (creature-sync.mjs).
 * @param {Actor|null} actor
 * @param {object} [changes]   What an update of the actor changed.
 * @returns {void}
 */
function characterChanged(actor, changes) {
  if ( !actor?.id || !canSend() ) return;
  creatureChanged(actor);
  const id = actor.id;
  if ( changes && (typeof changes === "object") && ("ownership" in changes) ) ownershipChanged.add(id);
  clearTimeout(settling.get(id));
  settling.set(id, setTimeout(() => {
    settling.delete(id);
    const ownership = ownershipChanged.delete(id);
    sendCharacter(id, { ownership });
  }, SETTLE_AFTER));
}

/**
 * Tell each campaign whose app reads groups of an actor deleted: a group of its own is removed, in
 * `group.removed`, and forgotten; and every group the actor was in is sent again without it, as is
 * every group of a campaign it was a character of, whose players may see them no longer through
 * it. A group isn't prepared again for a member deleted, so it's still found as one. A campaign
 * whose hello is on its way is told once it's answered: of the group by `helloDelivered`, as the
 * hello lists it, and of the rest as they then are.
 * @param {Actor} actor
 * @returns {void}
 */
function actorDeleted(actor) {
  if ( !actor?.id || !canSend() ) return;
  const id = actor.id;
  for ( const campaign of getCampaigns() ) {
    if ( !campaign.groups.has(id) || !groupsTaken(campaign) ) continue;
    const key = `${campaign.id}.${id}`;
    told.delete(key);
    built.delete(key);
    send(EVENTS.GROUP_REMOVED, { id }, campaign);
  }
  const groups = new Map();
  for ( const { campaign, group } of groupsListing(id) ) groups.set(`${campaign.id}.${group.id}`, { campaign, group });
  for ( const campaign of getCampaigns() ) {
    if ( !campaign.characters.has(id) ) continue;
    for ( const group of campaignGroups(campaign) ) groups.set(`${campaign.id}.${group.id}`, { campaign, group });
  }
  for ( const { campaign, group } of groups.values() ) {
    if ( groupsTaken(campaign) ) sendGroup(campaign, group);
  }
}

/**
 * Send every campaign's groups again when the world's primary party changes, which each says it is
 * or isn't. Nothing of the party's experience or level is read.
 * @param {Setting} setting   The setting stored or changed.
 * @returns {void}
 */
function primaryPartyChanged(setting) {
  if ( (setting?.key !== "dnd5e.primaryParty") || !canSend() ) return;
  for ( const campaign of getCampaigns() ) {
    if ( groupsTaken(campaign) ) sendGroups(campaign);
  }
}

/**
 * Note that every campaign character with a temporary effect, or an item of theirs with a temporary
 * enchantment, may have changed, since the time it has left is on its sheet; since 0.36.0 every
 * companion listed with one too.
 * @returns {void}
 */
function effectsRunningDown() {
  if ( !canSend() ) return;
  const running = actor => {
    const effects = Array.from(actor.allApplicableEffects?.() ?? []);
    const enchanted = Array.from(actor.items ?? []).some(item => (typeof item.effects?.some === "function")
      && item.effects.some(effect => effect.isAppliedEnchantment && effect.isTemporary));
    return enchanted || effects.some(effect => effect.isTemporary);
  };
  for ( const actor of campaignCharacters() ) {
    if ( running(actor) ) characterChanged(actor);
  }
  for ( const actor of toldCompanions() ) {
    if ( running(actor) ) creatureChanged(actor);
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
  for ( const actor of toldCompanions() ) creatureChanged(actor);
}

/**
 * Note that every campaign character may have changed when the world's roles' permissions do,
 * since its player's Make Manual Rolls decides whether they may type its dice. Core refreshes the
 * permissions after this hook, in the same update; each character is built once its changes
 * settle, by when it has.
 * @param {Setting} setting   The setting stored or changed.
 * @returns {void}
 */
function permissionsChanged(setting) {
  if ( (setting?.key !== "core.permissions") || !canSend() ) return;
  for ( const actor of campaignCharacters() ) characterChanged(actor);
  for ( const actor of toldCompanions() ) creatureChanged(actor);
}

/**
 * Note that every campaign character may have changed when a user is added, removed, or changed
 * in a way that changes who may type its dice.
 * @param {object} [changes]   What an update of the user changed; none for one added or removed.
 * @returns {void}
 */
function usersChanged(changes) {
  if ( !canSend() ) return;
  if ( changes && !USER_KEYS.some(key => Object.hasOwn(changes, key)) ) return;
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
 * The actor an embedded document, such as an item or an effect, ultimately belongs to. Since 0.36.0
 * one an unlinked token's ActorDelta holds belongs to the token's synthetic actor, whichever parent
 * core gives it.
 * @param {Document} document
 * @returns {Actor|null}
 */
function owningActor(document) {
  let parent = document?.parent;
  while ( parent && (parent.documentName !== "Actor") ) {
    if ( parent.documentName === "ActorDelta" ) return parent.parent?.actor ?? null;
    parent = parent.parent;
  }
  return parent ?? null;
}
