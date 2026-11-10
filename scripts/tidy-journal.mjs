import {
  EVENTS, MOST_NOTE_TEXT, MOST_NOTE_TITLE, MOST_TIDY_ENTRIES, NOTES_TIDY, TIDY, TIDY_CLASSIC, TIDY_ID
} from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { campaignActors, playerOwners } from "./characters.mjs";
import { bookActor, cutText, withoutSecrets } from "./journals.mjs";
import { textHash } from "./sheet-texts.mjs";
import { buildEnvelope, helloPending, inMegabytes, post, termsOf } from "./transport.mjs";

/**
 * Tidy 5e Sheets' journal, since 0.45.0: what a character's players keep on its Journal tab in Tidy,
 * sent to the app read only, beside the character's own journal of notes (journals.mjs), never mixed
 * with it.
 *
 * Tidy keeps it in its own flags on the actor: the current sheet's entries in `document-journal`, a
 * record of `{id, title, value, sort}` by key, the value HTML; and its Classic sheet's five boxes,
 * `notes1` to `notes4` (`{name, value}`) and `notes` (`{value}`), which Tidy 13 still offers and Tidy
 * 14 no longer shows. It has no API for them and no hooks: it writes them with plain updates of the
 * actor, so the bridge hears each change as `updateActor`, a burst of them settling before the
 * character is read again. Nothing here ever writes them, nor anything else.
 *
 * They're read straight off the actor's flags, never through `getFlag`, which needs the module's
 * scope active: so Tidy turned off, or uninstalled, still has its entries read, and the hello says
 * which, for the app to say they can't be changed meanwhile. Under D&D Fifth Edition only, Tidy being
 * a sheet of dnd5e's; read the same way under dnd5e 5 and 6. Secrets follow the personal journal's
 * rule: kept from the app where no player owns the character.
 *
 * Sent only to an app that says it reads them, `features.notes` 3 or more; each character's whole,
 * in `journal.tidy`, and never twice the same until the campaign's next hello. Only the bridge sends,
 * and the hook is heard only there.
 */

/**
 * How long to wait for a burst of changes to one character's Tidy flags to settle before sending
 * it, in milliseconds: Tidy's editor saves on every change and again as it closes.
 * @type {number}
 */
const SETTLE_TIDY = 500;

/** The key of Tidy's flag holding the current sheet's journal. */
const JOURNAL = "document-journal";

/** The longest version sent, as the app takes a module's version. */
const MOST_VERSION = 100;

/**
 * The campaigns whose app reads Tidy's journal, by id: its latest answer to a hello or heartbeat
 * said `features.notes` of 3 or more.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * What each campaign was last told of each character's Tidy journal, as JSON, by
 * `${campaignId}|${actorId}`: so an unchanged one isn't posted again, and those the app may hold
 * are known.
 * @type {Map<string, string>}
 */
const told = new Map();

/**
 * The characters each campaign's last answered hello listed as holding Tidy entries, by campaign
 * id: the app may hold theirs, though nothing was sent since.
 * @type {Map<string, string[]>}
 */
const listed = new Map();

/**
 * Characters whose Tidy flags or ownership changed, waiting to settle, and their timers, by actor id.
 * @type {Map<string, number>}
 */
const settling = new Map();

/**
 * The Tidy journals the Gamemaster has been told were too large to send this page load, by
 * `${campaignId}|${actorId}`.
 * @type {Set<string>}
 */
const warned = new Set();

/* -------------------------------------------- */
/*  Reading Tidy's flags                        */
/* -------------------------------------------- */

/**
 * Is Tidy's journal read here: under D&D Fifth Edition, whose sheet Tidy is, any version.
 * @returns {boolean}
 */
function tidyOn() {
  return game.system?.id === "dnd5e";
}

/**
 * The entries of a character's Tidy journal as the app is told them, in the order Tidy shows them:
 * the current sheet's entries, then the Classic sheet's boxes; each cut to what the app takes, its
 * secret sections left out where no player owns the character, and its revision of Tidy's own text.
 * @param {Actor} actor
 * @returns {{from: "journal"|"classic", id: string, title: string, html: string, cut?: true,
 *   secret?: true, sort: number, rev: string}[]}
 */
export function tidyEntries(actor) {
  const hidden = !playerOwners(actor).length;
  return storedEntries(actor).map(entry => sentAs(entry, hidden));
}

/**
 * A character's Tidy entries as Tidy keeps them, only those of the shape Tidy writes, in its order,
 * each numbered by its place within its store.
 * @param {Actor} actor
 * @returns {{from: "journal"|"classic", id: string, title: string, value: string, sort: number}[]}
 */
function storedEntries(actor) {
  const flags = tidyFlags(actor);
  return flags ? [...journalEntries(flags[JOURNAL]), ...classicBoxes(flags)] : [];
}

/**
 * Tidy's flags on an actor, as Foundry holds them: from its flags, where a module's data is kept
 * whether the module is active or not, else from its source data, should a Foundry leave an inactive
 * module's out of the first. Never through `getFlag`, which refuses a scope that isn't active.
 * @param {Actor} actor
 * @returns {object|null}
 */
function tidyFlags(actor) {
  for ( const flags of [actor?.flags?.[TIDY], actor?._source?.flags?.[TIDY]] ) {
    if ( isObject(flags) ) return flags;
  }
  return null;
}

/**
 * The current sheet's journal entries, as Tidy's Journal tab lists them: by `sort` alone, a stable
 * sort, so that entries of one sort keep the order the flag holds them in. A key that isn't one Tidy
 * makes, as a stray `-=<key>` an old delete left, or a value not of Tidy's shape, is skipped.
 * @param {unknown} journal
 * @returns {{from: "journal", id: string, title: string, value: string, sort: number}[]}
 */
function journalEntries(journal) {
  if ( !isObject(journal) ) return [];
  const entries = Object.entries(journal).filter(([key, entry]) => TIDY_ID.test(key) && isObject(entry)
    && (typeof entry.title === "string") && (typeof entry.value === "string") && Number.isFinite(entry.sort));
  entries.sort(([, a], [, b]) => a.sort - b.sort);
  return entries.map(([key, entry], place) => ({ from: "journal", id: key, title: entry.title, value: entry.value, sort: place + 1 }));
}

/**
 * The Classic sheet's boxes that hold something, in its order, each numbered by its place among the
 * five: a box's name where it has one, never for Journal Entries, which has none.
 * @param {object} flags   Tidy's flags.
 * @returns {{from: "classic", id: string, title: string, value: string, sort: number}[]}
 */
function classicBoxes(flags) {
  return TIDY_CLASSIC.flatMap((key, place) => {
    const box = flags[key];
    if ( !isObject(box) || (typeof box.value !== "string") || holdsNothing(box.value) ) return [];
    const title = ((key !== "notes") && (typeof box.name === "string")) ? box.name : "";
    return [{ from: "classic", id: key, title, value: box.value, sort: place + 1 }];
  });
}

/**
 * Does a box's HTML hold nothing to read: no text but spaces, only tags, and no image, as an editor
 * emptied leaves `<p></p>`?
 * @param {string} html
 * @returns {boolean}
 */
function holdsNothing(html) {
  return !/<img\b/i.test(html) && (html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/gi, "") === "");
}

/**
 * An entry as the app is told it: its title and text cut to what the app takes, its secrets left out
 * where they're hidden, and its revision, of Tidy's own title and text before either.
 * @param {{from: string, id: string, title: string, value: string, sort: number}} entry
 * @param {boolean} hidden   Are secrets kept from the app: no player owns the character?
 * @returns {object}
 */
function sentAs({ from, id, title, value, sort }, hidden) {
  const kept = hidden ? withoutSecrets(value) : value;
  const [shown, titleCut] = cutText(title, MOST_NOTE_TITLE);
  const [html, textCut] = cutText(kept, MOST_NOTE_TEXT);
  return {
    from,
    id,
    title: shown,
    html,
    ...((titleCut || textCut) && { cut: true }),
    ...((kept !== value) && { secret: true }),
    sort,
    rev: textHash(JSON.stringify(["tidy", from, title, value]))
  };
}

/* -------------------------------------------- */
/*  The hello                                   */
/* -------------------------------------------- */

/**
 * What a campaign's hello says of Tidy's journal, in `features.notes`, since 0.45.0: under D&D Fifth
 * Edition, where Tidy is installed or one of its characters holds entries, whether Tidy is active,
 * its version, null where it isn't installed, and which of the campaign's characters hold entries;
 * nothing otherwise.
 * @param {Campaign} campaign
 * @returns {{tidy?: {active: boolean, version: string|null, actors: string[]}}}
 */
export function tidyHello(campaign) {
  if ( !tidyOn() ) return {};
  const module = game.modules.get(TIDY);
  const actors = holders(campaign);
  if ( !module && !actors.length ) return {};
  const version = (typeof module?.version === "string") ? cutText(module.version, MOST_VERSION)[0] : null;
  return { tidy: { active: module?.active === true, version, actors } };
}

/**
 * A campaign's characters that are none of its groups, as personal books are, in its order.
 * @param {Campaign} campaign
 * @returns {Actor[]}
 */
function characters(campaign) {
  return campaignActors(campaign).filter(actor => bookActor("personal", actor.id, campaign));
}

/**
 * The ids of a campaign's characters that hold at least one Tidy entry the app would be sent.
 * @param {Campaign} campaign
 * @returns {string[]}
 */
function holders(campaign) {
  return characters(campaign).filter(actor => storedEntries(actor).length).map(actor => actor.id);
}

/* -------------------------------------------- */
/*  Who reads it                                */
/* -------------------------------------------- */

/**
 * Note whether a campaign's app reads Tidy's journal: `features.notes` of 3 or more. One that starts
 * to in a heartbeat's answer, as an app deployed mid-session does, is sent every character's afresh;
 * after a hello's, they follow its books. One that says less, as an older or rolled back app, is sent
 * none.
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteTidyReader(campaignId, features, type) {
  const format = features?.notes;
  if ( !(Number.isInteger(format) && (format >= NOTES_TIDY)) ) {
    readers.delete(campaignId);
    return;
  }
  const was = readers.has(campaignId);
  readers.add(campaignId);
  if ( !was && (type === EVENTS.HEARTBEAT) ) tidyAfresh(campaignId);
}

/**
 * Does a campaign's app read Tidy's journal?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function tidyReader(campaignId) {
  return readers.has(campaignId);
}

/* -------------------------------------------- */
/*  Sending                                     */
/* -------------------------------------------- */

/**
 * The key a character's Tidy journal is known by, in a campaign.
 * @param {string} campaignId
 * @param {string} actorId
 * @returns {string}
 */
function tidyKey(campaignId, actorId) {
  return `${campaignId}|${actorId}`;
}

/**
 * Send a campaign one of its characters' Tidy journal, as the character holds it now, in
 * `journal.tidy`: under D&D Fifth Edition, to an app that reads it, while the campaign has the
 * character, never while its hello is on its way, which every one follows, and never twice the same;
 * withheld where it's too large to post.
 * @param {string} actorId
 * @param {Campaign} campaign
 * @returns {void}
 */
export function sendTidy(actorId, campaign) {
  if ( !canSend() || !tidyOn() || !tidyReader(campaign.id) || helloPending(campaign.id) ) return;
  const actor = bookActor("personal", actorId, campaign);
  if ( !actor ) return;
  try {
    postTidy(actor, campaign);
  } catch {
    // The app keeps what it was last told; the next change or hello sends it again.
  }
}

/**
 * Build and post a character's Tidy journal, as `sendTidy` sends it. More than 400 entries, or a post
 * larger than the app takes, is withheld instead, the Gamemaster warned once a page load.
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @returns {void}
 */
function postTidy(actor, campaign) {
  const key = tidyKey(campaign.id, actor.id);
  const data = { actorId: actor.id, entries: tidyEntries(actor) };
  const json = JSON.stringify(data);
  if ( told.get(key) === json ) return;
  told.set(key, json);

  // Measured as it will be posted.
  const envelope = buildEnvelope(EVENTS.JOURNAL_TIDY, data, { campaign });
  const { maxBytes } = termsOf(campaign.id);
  const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
  if ( (data.entries.length > MOST_TIDY_ENTRIES) || (bytes > maxBytes) ) {
    envelope.data = { actorId: actor.id, entries: [], withheld: { reason: "tooLarge", bytes, limit: maxBytes } };
    post(envelope);
    warnTooLarge(key, actor, campaign, { count: data.entries.length, bytes, limit: maxBytes });
    return;
  }
  post(envelope);
}

/**
 * Tell the Gamemaster, once a page load for each character and campaign, that its Tidy journal was
 * too large to send.
 * @param {string} key
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @param {{count: number, bytes: number, limit: number}} size
 * @returns {void}
 */
function warnTooLarge(key, actor, campaign, { count, bytes, limit }) {
  if ( warned.has(key) ) return;
  warned.add(key);
  ui.notifications?.warn(game.i18n.format("SENDINGSTONE.Notify.TidyTooLarge", {
    name: actor.name, campaign: campaign.title, count, most: MOST_TIDY_ENTRIES,
    size: inMegabytes(bytes, Math.ceil), limit: inMegabytes(limit, Math.floor)
  }));
}

/**
 * Send a campaign whose hello was answered every character's Tidy journal afresh, after its books:
 * each the hello listed, which the app keeps, and each that holds entries now, which the hello may
 * have been built before.
 * @param {Campaign} campaign
 * @param {object} [hello]   The hello answered.
 * @returns {void}
 */
export function sendTidyAll(campaign, hello) {
  const said = hello?.data?.features?.notes?.tidy?.actors;
  listed.set(campaign.id, Array.isArray(said) ? said.filter(id => typeof id === "string") : []);
  forgetTidy(campaign.id);
  if ( !canSend() || !tidyReader(campaign.id) ) return;
  for ( const id of new Set([...listed.get(campaign.id), ...holders(campaign)]) ) sendTidy(id, campaign);
}

/**
 * Send a campaign every character's Tidy journal afresh, as when its app starts to read them in a
 * heartbeat's answer, or what it takes of posts changes, which may now take one withheld: each that
 * holds entries now, that its last answered hello listed, or that it was sent since, which the app
 * may hold. Not while its hello is on its way, which they follow anyway.
 * @param {string} campaignId
 * @returns {void}
 */
export function tidyAfresh(campaignId) {
  const campaign = getCampaigns().find(({ id }) => id === campaignId);
  if ( !campaign || !canSend() || helloPending(campaign.id) ) return;
  const prefix = tidyKey(campaign.id, "");
  const sent = [...told.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
  forgetTidy(campaign.id);
  for ( const id of new Set([...holders(campaign), ...(listed.get(campaign.id) ?? []), ...sent]) ) sendTidy(id, campaign);
}

/**
 * Forget what a campaign was told of its characters' Tidy journals, as its hello does.
 * @param {string} campaignId
 * @returns {void}
 */
export function forgetTidy(campaignId) {
  const prefix = tidyKey(campaignId, "");
  for ( const key of told.keys() ) {
    if ( key.startsWith(prefix) ) told.delete(key);
  }
}

/* -------------------------------------------- */
/*  Hearing of changes                          */
/* -------------------------------------------- */

/**
 * Listen for changes to the campaigns' characters' Tidy flags, on the bridge alone: an entry added,
 * edited, reordered or deleted, by Tidy 13's `-=<key>` or Tidy 14's `_del`, or a Classic box
 * written; and for a change of their ownership, which decides whether their secrets are sent. Each
 * character is read again once its changes settle.
 * @returns {void}
 */
export function registerTidyHooks() {
  Hooks.on("updateActor", (actor, changes) => tidyChanged(actor, changes));
}

/**
 * Note that a character's Tidy journal may have changed, and send it to each campaign it's in once
 * its changes settle. A token's own actor, a group, and any actor that's none of a campaign's
 * characters, as a Wild Shape form, are left be: entries are read from the character itself.
 * @param {Actor|null|undefined} actor
 * @param {object} [changes]   What the update changed.
 * @returns {void}
 */
function tidyChanged(actor, changes) {
  if ( !canSend() || !tidyOn() || !actor || actor.isToken || !touchesTidy(changes) ) return;
  const id = actor.id;
  if ( !getCampaigns().some(campaign => bookActor("personal", id, campaign)) ) return;
  clearTimeout(settling.get(id));
  settling.set(id, setTimeout(() => {
    settling.delete(id);
    for ( const campaign of getCampaigns() ) sendTidy(id, campaign);
  }, SETTLE_TIDY));
}

/**
 * Does an actor's update touch its Tidy flags, or its ownership? Foundry hands the hook the changes
 * expanded, a delete as its key; a dotted key is read too, as is the whole scope's removal.
 * @param {unknown} changes
 * @returns {boolean}
 */
function touchesTidy(changes) {
  if ( !isObject(changes) ) return false;
  if ( Object.hasOwn(changes, "ownership") ) return true;
  const flags = isObject(changes.flags) ? Object.keys(changes.flags) : [];
  if ( flags.some(key => (key === TIDY) || (key === `-=${TIDY}`)) ) return true;
  return Object.keys(changes).some(key => key.startsWith(`flags.${TIDY}`) || key.startsWith(`flags.-=${TIDY}`));
}

/**
 * Is this a plain object?
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return Boolean(value) && (typeof value === "object") && !Array.isArray(value);
}
