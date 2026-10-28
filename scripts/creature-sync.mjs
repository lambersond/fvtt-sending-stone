import { COMPANION_UNTAKEN, EVENTS, MODULE_ID } from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { recheckCombats } from "./campaign-combats.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { forgetActorKey, forgetSheetTold, sendActor } from "./character-sync.mjs";
import { aloneReader } from "./command-alone.mjs";
import { rollFeatures } from "./commands.mjs";
import { combatEnabled } from "./config.mjs";
import { companionKeyOf, companionOfActor, companionsOf, ownedByPlayers } from "./creatures.mjs";
import { characterSheet } from "./sheet.mjs";
import { SheetTexts } from "./sheet-texts.mjs";
import { helloPending, send } from "./transport.mjs";

/**
 * Keeping each campaign's copy of its characters' companions current, since 0.36.0, for an app that
 * says it reads them, `features.companions` (round 0.36.0 §4.2-§4.4, §6.3-§6.5). A hello lists them
 * without their sheets, as it lists characters; once it's answered each companion's sheet follows
 * in `companion.updated`, a post of its own, built as a character's from its live actor. After that
 * the whole list goes again in `companions.listed` whenever it changes, as when a familiar is
 * summoned onto the active scene, its token is hidden or deleted, the active scene changes, or a
 * player is given or loses Owner of an NPC; and a companion's sheet goes again when it changes, as
 * when it takes damage or spends a use.
 *
 * A token's creature is heard of through its token and its ActorDelta, whichever core tells, and
 * through its items and effects, whatever parent core gives them; every way settles to one post per
 * companion, 250 ms after the last change. An app that says nothing of companions, as one before
 * 0.36.0, is sent none of this, and its combats and chat are as module 0.35.0 sends them.
 */

/**
 * How long to wait for a burst of changes to settle before sending, in milliseconds.
 * @type {number}
 */
const SETTLE_AFTER = 250;

/**
 * What changing on a token may change of the list: whether it's hidden, linked or which actor's,
 * its delta, which holds a summon's flags and an owner given on the token, and its name and portrait.
 * @type {string[]}
 */
const TOKEN_KEYS = ["hidden", "actorLink", "actorId", "delta", "name", "texture"];

/**
 * What changing on an ActorDelta may change of the list: who owns it, its flags, name and portrait.
 * @type {string[]}
 */
const DELTA_KEYS = ["ownership", "flags", "name", "img"];

/**
 * What changing on a world NPC may change of the list.
 * @type {string[]}
 */
const NPC_KEYS = ["ownership", "name", "img", "type", "prototypeToken", "flags"];

/**
 * The campaigns whose app's latest answer said it reads companions, `features.companions` 1 or more,
 * and the format it said, 2 or more since 0.41.0 for one that reads what the game asks of them.
 * @type {Map<string, number>}
 */
const readers = new Map();

/**
 * What's told when companions leave a campaign's list, with their keys: since 0.41.0, prompts.mjs's
 * closing of what the game asked of them, which this file needn't import.
 * @type {((campaignId: string, keys: string[]) => void)[]}
 */
const leftListeners = [];

/**
 * What's told when a campaign's app first says it reads what the game asks of companions, since
 * 0.41.0: prompts.mjs's sending of those open again, which a hello built before it said so left out.
 * @type {((campaignId: string) => void)[]}
 */
const promptReaderListeners = [];

/**
 * What each campaign was last told of its companions, by campaign id: the list's JSON, null where
 * it was lost and is to be sent again, and its entries, which its combatants and chat messages are
 * told by.
 * @type {Map<string, {json: string|null, entries: CompanionEntry[]}>}
 */
const toldLists = new Map();

/**
 * The companions whose sheets a campaign's app may not have taken, by campaign id: those a
 * `companions.listed` lost to failures that might not last listed, whose sheets went after it to
 * an app that takes no sheet of a companion it doesn't list. Each still listed is sent again at the
 * next comparison, after the list then sent or on its way.
 * @type {Map<string, Set<string>>}
 */
const unseen = new Map();

/**
 * Companions with changes waiting to settle, and their timers, by `${campaignId}.c:${key}`.
 * @type {Map<string, number>}
 */
const settling = new Map();

/**
 * The list's recompute waiting to settle.
 * @type {number|null}
 */
let listing = null;

/* -------------------------------------------- */
/*  The listener's format                       */
/* -------------------------------------------- */

/**
 * Note whether a campaign's app reads companions, from what it said in answer to its hello or
 * heartbeat: `features.companions`, the format it reads, 1 or later. One that starts to in a
 * heartbeat's answer, as an app deployed mid-session does, is sent the list and every companion's
 * sheet at once; after a hello's, they follow its character and group sheets. Since 0.41.0 the format
 * is kept: 2 or more says it reads what the game asks of companions, and where it first says so, from
 * less or from nothing, as after a reload, whose hello left those out, or in the hello's own answer,
 * their prompts open now are sent again (round 0.41.0 §3.6.6).
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteCompanionReader(campaignId, features, type) {
  const format = features?.companions;
  if ( !(Number.isInteger(format) && (format >= 1)) ) {
    readers.delete(campaignId);
    return;
  }
  const was = readers.get(campaignId) ?? 0;
  readers.set(campaignId, format);
  if ( !was && (type === EVENTS.HEARTBEAT) ) companionsWanted(campaignId);
  if ( (format >= 2) && (was < 2) ) {
    for ( const fn of promptReaderListeners ) fn(campaignId);
  }
}

/**
 * Does a campaign's app read companions?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function companionReader(campaignId) {
  return readers.has(campaignId);
}

/**
 * Does a campaign's app read what the game asks of companions, since 0.41.0: its latest answer said
 * `companions` 2 or more? One that drops to 1 is asked no more; what was asked closes in its time.
 * @param {string} campaignId
 * @returns {boolean}
 */
export function companionPromptReader(campaignId) {
  return (readers.get(campaignId) ?? 0) >= 2;
}

/**
 * Be told of the companions that leave a campaign's list, by their keys, as the list is compared.
 * @param {(campaignId: string, keys: string[]) => void} fn
 * @returns {void}
 */
export function onCompanionsLeft(fn) {
  leftListeners.push(fn);
}

/**
 * Be told of each campaign whose app first says it reads what the game asks of companions.
 * @param {(campaignId: string) => void} fn
 * @returns {void}
 */
export function onCompanionPromptReader(fn) {
  promptReaderListeners.push(fn);
}

/**
 * What a campaign's hello says of its companions' rolls, `features.companions`: the kinds a
 * companion's command may be, as the campaign takes them now, those of its rolls but what an NPC
 * has none of, what isn't asked and what edits it; none where its rolls are off. And since the
 * Gamemaster chooses it per campaign, how its companions enter initiative, whether or not its rolls
 * are made here: each its own roll, or right after its character (creature-initiative.mjs).
 * @param {Campaign} campaign
 * @returns {{kinds: string[], initiative: string}}
 */
export function companionFeatures(campaign) {
  return {
    kinds: rollFeatures(campaign).kinds.filter(kind => !COMPANION_UNTAKEN.includes(kind)),
    initiative: campaign.companionInitiative
  };
}

/**
 * The companions a campaign was last told of: by its delivered hello, or its latest
 * `companions.listed`; and while its hello is on its way, the hello's own. Its combatants and chat
 * messages are told by them, so that the app is never told of a companion it hasn't been listed.
 * @param {string} campaignId
 * @returns {CompanionEntry[]}
 */
export function toldList(campaignId) {
  return toldLists.get(campaignId)?.entries ?? [];
}

/**
 * Note the companions a campaign is told of, in its hello or `companions.listed`.
 * @param {string} campaignId
 * @param {CompanionEntry[]} entries
 * @returns {void}
 */
export function noteListed(campaignId, entries) {
  const list = Array.isArray(entries) ? entries : [];
  const json = JSON.stringify(list);
  toldLists.set(campaignId, { json, entries: JSON.parse(json) });
}

/**
 * Forget what a campaign was told of its companions' list, and the changes waiting to be sent of
 * them, as before its hello. Their sheets are forgotten with its characters' (character-sync.mjs).
 * @param {string} campaignId
 * @returns {void}
 */
export function forgetListed(campaignId) {
  toldLists.delete(campaignId);
  unseen.delete(campaignId);
  for ( const [key, timer] of settling ) {
    if ( !key.startsWith(`${campaignId}.c:`) ) continue;
    clearTimeout(timer);
    settling.delete(key);
  }
}

/* -------------------------------------------- */
/*  Chat and combat                             */
/* -------------------------------------------- */

/**
 * The companion a chat message is a campaign's, for an app that reads companions: the module's own
 * mark, where it made the message for a companion's command and the campaign was told of it; else
 * the companion whose live actor speaks it; else null. Undefined for any other app, which is told
 * nothing of companions.
 * @param {ChatMessage} message
 * @param {Campaign} campaign
 * @returns {string|null|undefined}
 */
export function messageCompanion(message, campaign) {
  if ( !readers.has(campaign.id) ) return undefined;
  const list = toldList(campaign.id);
  const marked = message.flags?.[MODULE_ID]?.companion;
  if ( (typeof marked === "string") && list.some(entry => entry.key === marked) ) return marked;
  return companionOfActor(list, message.speakerActor)?.key ?? null;
}

/**
 * The companion a combatant is, for an app that reads companions; undefined for any other app.
 * @param {Combatant} combatant
 * @param {Campaign} campaign
 * @returns {string|null|undefined}
 */
export function combatantCompanion(combatant, campaign) {
  if ( !readers.has(campaign.id) ) return undefined;
  return companionKeyOf(toldList(campaign.id), combatant);
}

/* -------------------------------------------- */
/*  Sending                                     */
/* -------------------------------------------- */

/**
 * Send a campaign one of its companions' sheets as it now stands, unless that is what the campaign
 * was last told: in `companion.updated`, as `sendActor` sends it, keyed `c:<key>` so that two wolves
 * of one Wolf never share one. Only to an app that reads companions, only for one in the list it was
 * last told, and never while a hello is on its way, which they follow. Where none of its characters'
 * players owns it in Foundry, as a familiar the Gamemaster summoned, its descriptions go without the
 * Gamemaster's secrets and its biography is its public one; its links stay ones to act on, as its
 * player acts for it.
 * @param {Campaign} campaign
 * @param {CompanionEntry} entry
 * @param {Actor} actor   Its live actor.
 * @returns {void}
 */
export function sendCompanion(campaign, entry, actor) {
  if ( !canSend() || !readers.has(campaign.id) || helloPending(campaign.id) ) return;
  if ( !toldList(campaign.id).some(listed => listed.key === entry.key) ) return;
  const secrets = ownedByPlayers(actor, entry.of);
  sendActor(campaign, actor, {
    event: EVENTS.COMPANION_UPDATED,
    key: `c:${entry.key}`,
    name: entry.name,
    apart: true,
    build: ({ sheet=true }={}) => {
      const texts = new SheetTexts({ secrets });
      // A companion's effects take no commands, so its sheet offers none. Since 0.41.0 its damage on
      // its own carries its choices, to an app that reads them.
      const aloneChoices = aloneReader(campaign.id);
      return {
        texts,
        data: { companion: { ...entry }, sheet: sheet ? characterSheet(actor, texts, { secrets, ops: false, aloneChoices }) : null }
      };
    }
  });
}

/**
 * Send a companion's sheet as it stands to each campaign listing it, ahead of a command's result
 * that changed it, rather than once its changes settle, as `sheetFirst` sends a character's.
 * @param {Actor} actor                The companion's live actor.
 * @param {CompanionEntry} companion
 * @returns {void}
 */
export function companionFirst(actor, companion) {
  if ( !canSend() ) return;
  for ( const campaign of getCampaigns() ) {
    const entry = toldList(campaign.id).find(listed => listed.key === companion.key);
    if ( entry ) sendCompanion(campaign, entry, actor);
  }
}

/**
 * Send a campaign whose app has just said it reads companions, in answer to a heartbeat, the list
 * and every companion's sheet afresh, and its combats as they are described for it now: until now
 * they were described without companions, so each with one in it goes again, and one with only
 * companions reaches it.
 * @param {string} campaignId
 * @returns {void}
 */
export function companionsWanted(campaignId) {
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( !campaign || !canSend() || helloPending(campaign.id) ) return;
  for ( const { key } of toldList(campaign.id) ) forgetActorKey(campaign.id, `c:${key}`);
  forgetListed(campaign.id);
  compareList(campaign, { before: [] });
}

/**
 * Send a campaign whose hello was answered its companions, after its characters' and groups'
 * sheets: the hello's own list counts as told, each companion it lists that still is one has its
 * sheet sent, and then the list is compared with the campaign's now, at once, so that a companion
 * that came or went while the hello was on its way is told of. A hello built before its app was
 * known to read companions described its combats without them: those it knows of with a companion
 * among them are sent again, whole.
 * @param {Campaign} campaign
 * @param {object} [hello]   The hello answered.
 * @returns {void}
 */
export function companionsDelivered(campaign, hello) {
  if ( !readers.has(campaign.id) ) return;
  const listed = Array.isArray(hello?.data?.companions) ? hello.data.companions : [];
  noteListed(campaign.id, listed);
  const found = companionsOf(campaign);
  for ( const entry of toldList(campaign.id) ) {
    const now = found.find(each => each.entry.key === entry.key);
    if ( now ) sendCompanion(campaign, now.entry, now.actor);
  }
  const described = (hello?.data?.combats ?? []).flatMap(combat => combat?.combatants ?? []);
  const keyed = described.some(combatant => Object.hasOwn(combatant ?? {}, "companion"));
  compareList(campaign, { found, before: keyed ? toldList(campaign.id) : [] });
}

/**
 * Send a campaign whose listener now takes sheets differently every companion's sheet again, as its
 * characters' are.
 * @param {Campaign} campaign
 * @returns {void}
 */
export function companionTermsChanged(campaign) {
  if ( !readers.has(campaign.id) ) return;
  for ( const { entry, actor } of companionsOf(campaign) ) sendCompanion(campaign, entry, actor);
}

/**
 * The live actors of the companions every campaign was last told of, each once: for what runs down
 * on their sheets with time, and what every sheet says.
 * @returns {Actor[]}
 */
export function toldCompanions() {
  const actors = new Map();
  for ( const campaign of getCampaigns() ) {
    if ( !readers.has(campaign.id) ) continue;
    const keys = new Set(toldList(campaign.id).map(entry => entry.key));
    if ( !keys.size ) continue;
    for ( const { entry, actor } of companionsOf(campaign) ) {
      if ( keys.has(entry.key) ) actors.set(entry.uuid, actor);
    }
  }
  return Array.from(actors.values());
}

/* -------------------------------------------- */
/*  Changes                                     */
/* -------------------------------------------- */

/**
 * Note that the companions may have changed, and compare each campaign's with what it was last
 * told once the changes settle: 250 ms after the last, or at once.
 * @param {object} [options]
 * @param {boolean} [options.now]   Compare at once.
 * @returns {void}
 */
export function listsChanged({ now=false }={}) {
  if ( !canSend() ) return;
  clearTimeout(listing);
  listing = null;
  if ( now ) {
    compareLists();
    return;
  }
  listing = setTimeout(() => {
    listing = null;
    compareLists();
  }, SETTLE_AFTER);
}

/**
 * Compare every campaign's companions with what it was last told.
 * @returns {void}
 */
function compareLists() {
  if ( !canSend() ) return;
  for ( const campaign of getCampaigns() ) compareList(campaign);
}

/**
 * Tell a campaign whose app reads companions of its list where it differs from the list it was last
 * told, in `companions.listed`, then the sheets of those new to it; and forget those gone, which the
 * app deletes. A companion whose sheet went after a list that was lost, which the app ignored as
 * one it didn't list, has it sent again, after the list now sent or the one already on its way,
 * which the posts' order keeps ahead of it. Then its combats are checked again: one with no
 * character but a companion in it now reaches it, one with none leaves it, and one whose combatants
 * it would be told of otherwise now goes again, whole. Not while a hello is on its way, which is
 * compared once it's answered.
 * @param {Campaign} campaign
 * @param {object} [options]
 * @param {{entry: CompanionEntry, actor: Actor}[]} [options.found]   The campaign's companions now.
 * @param {CompanionEntry[]} [options.before]   What its combats were described by; what it was told.
 * @returns {void}
 */
function compareList(campaign, { found, before }={}) {
  if ( !readers.has(campaign.id) || helloPending(campaign.id) ) return;
  const told = toldLists.get(campaign.id);
  const was = before ?? told?.entries ?? [];
  found ??= companionsOf(campaign);
  const list = found.map(({ entry }) => entry);
  const changed = told?.json !== JSON.stringify(list);
  const again = unseen.get(campaign.id);
  if ( !changed && (before === undefined) && !again ) return;
  const old = new Set((told?.entries ?? []).map(entry => entry.key));
  if ( changed ) {
    send(EVENTS.COMPANIONS_LISTED, { companions: list }, campaign);
    const keys = new Set(list.map(entry => entry.key));
    const left = (told?.entries ?? []).map(entry => entry.key).filter(key => !keys.has(key));
    for ( const key of left ) forgetCompanion(campaign.id, key);
    noteListed(campaign.id, list);
    // Since 0.41.0 what the game asked of those that left closes at once, as they're no one's now.
    if ( left.length ) {
      for ( const fn of leftListeners ) fn(campaign.id, left);
    }
  }
  unseen.delete(campaign.id);
  // Each new to the list has its sheet sent after it, and each sent after a list that was lost again.
  for ( const { entry, actor } of found ) {
    if ( again?.has(entry.key) ) forgetSheetTold(campaign.id, `c:${entry.key}`);
    else if ( !changed || old.has(entry.key) ) continue;
    sendCompanion(campaign, entry, actor);
  }
  if ( combatEnabled() ) {
    recheckCombats(campaign, combatant => companionKeyOf(was, combatant) !== companionKeyOf(list, combatant));
  }
}

/**
 * Forget a companion gone from a campaign's list: what it was told of its sheet, and any change of
 * it waiting to be sent.
 * @param {string} campaignId
 * @param {string} key
 * @returns {void}
 */
function forgetCompanion(campaignId, key) {
  forgetActorKey(campaignId, `c:${key}`);
  const settle = `${campaignId}.c:${key}`;
  clearTimeout(settling.get(settle));
  settling.delete(settle);
}

/**
 * Note that a live actor may have changed, and send it once its changes settle to each campaign
 * whose list it's in, as its companion: from any actor heard of, its items' and effects' too. A
 * world actor's change also reaches each of its unlinked tokens' creatures, which core makes again
 * from it with no hook of their own, as when the Gamemaster edits a familiar's template: each of them
 * listed is sent again too, read from its own live actor.
 * @param {Actor|null|undefined} actor
 * @returns {void}
 */
export function creatureChanged(actor) {
  if ( !actor || !canSend() ) return;
  for ( const campaign of getCampaigns() ) {
    if ( !readers.has(campaign.id) ) continue;
    const list = toldList(campaign.id);
    const entries = new Set([companionOfActor(list, actor)]);
    if ( !actor.isToken ) {
      for ( const entry of list ) {
        if ( (entry.tokenId !== null) && (entry.actorId === actor.id) ) entries.add(entry);
      }
    }
    for ( const entry of entries ) {
      if ( !entry ) continue;
      const settle = `${campaign.id}.c:${entry.key}`;
      clearTimeout(settling.get(settle));
      settling.set(settle, setTimeout(() => {
        settling.delete(settle);
        resendCompanion(campaign.id, entry.key);
      }, SETTLE_AFTER));
    }
  }
}

/**
 * Send a campaign one of its companions as it now stands, if it's still one, by §2.1's rule.
 * @param {string} campaignId
 * @param {string} key
 * @returns {void}
 */
export function resendCompanion(campaignId, key) {
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( !campaign || !canSend() || !toldList(campaignId).some(entry => entry.key === key) ) return;
  const found = companionsOf(campaign).find(({ entry }) => entry.key === key);
  if ( found ) sendCompanion(campaign, found.entry, found.actor);
}

/**
 * Note a campaign's `companions.listed` lost to failures that might not last: where it's the list
 * last told, it's taken as untold, so the next comparison sends it again, its entries kept meanwhile
 * for its combats and chat. Either way, the sheets of the companions it listed, which went after it
 * to an app that didn't list them, go again at the next comparison.
 * @param {string} campaignId
 * @param {object} envelope
 * @returns {void}
 */
export function listingDropped(campaignId, envelope) {
  const listed = Array.isArray(envelope?.data?.companions) ? envelope.data.companions : [];
  const told = toldLists.get(campaignId);
  if ( told && (told.json === JSON.stringify(listed)) ) {
    toldLists.set(campaignId, { ...told, json: null });
  }
  const keys = unseen.get(campaignId) ?? new Set();
  for ( const entry of listed ) {
    if ( typeof entry?.key === "string" ) keys.add(entry.key);
  }
  if ( keys.size ) unseen.set(campaignId, keys);
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Listen for what may change a campaign's companions: tokens placed, changed or deleted, their
 * deltas, the active scene switched or deleted, NPCs given or taken from players, actors made or
 * deleted, users changed; and, after the world is ready, compare the list once, as a token's actor
 * is made up only once documents are. Every client listens; only the bridge sends.
 * @returns {void}
 */
export function registerCreatureHooks() {
  const has = (changes, keys) => Boolean(changes) && (typeof changes === "object")
    && keys.some(key => Object.hasOwn(changes, key));
  for ( const hook of ["createToken", "deleteToken", "deleteScene", "createActor", "deleteActor", "createUser", "deleteUser"] ) {
    Hooks.on(hook, () => listsChanged());
  }
  Hooks.on("updateToken", (token, changes) => {
    if ( has(changes, TOKEN_KEYS) ) listsChanged();
    if ( has(changes, ["delta"]) ) creatureChanged(token?.actor);
  });
  Hooks.on("updateActorDelta", (delta, changes) => {
    creatureChanged(delta?.parent?.actor);
    if ( has(changes, DELTA_KEYS) ) listsChanged();
  });
  Hooks.on("updateScene", (scene, changes) => {
    if ( has(changes, ["active"]) ) listsChanged();
  });
  Hooks.on("updateActor", (actor, changes) => {
    if ( actor?.isToken ) return;
    const character = getCampaigns().some(campaign => campaign.characters.has(actor?.id));
    if ( character ? has(changes, ["ownership"]) : ((actor?.type === "npc") && has(changes, NPC_KEYS)) ) listsChanged();
  });
  Hooks.on("updateUser", () => listsChanged());
  Hooks.once("ready", () => listsChanged());
}
