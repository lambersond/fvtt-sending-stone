import { EVENTS, MODULE_ID, MOST_NOTE_TEXT, MOST_NOTE_TITLE, MOST_NOTES, NOTE_BOOKS, NOTE_ID, NOTES_CHANGES, OWN_WRITE } from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { campaignActors, playerOwners } from "./characters.mjs";
import { campaignGroups, groupEntry, groupReader } from "./groups.mjs";
import { textHash } from "./sheet-texts.mjs";
import { buildEnvelope, helloPending, inMegabytes, post, termsOf } from "./transport.mjs";

/**
 * Journal notes, since 0.34.0: what players write in the app about their game, kept in Foundry as
 * journals, a character's own and a party's, one of each for every campaign it's in.
 *
 * A journal is a JournalEntry in multi-page view, found by this module's flag on it, never by its
 * name or folder. A chapter is a text page whose title Foundry draws as a level 1 heading, and each
 * note one at level 2, written in Markdown; so the journal reads in Foundry as one document of
 * chapters and the notes under them, and each note has its own page, owner and history. A
 * character's journal is its player owners' alone; a party's is open to those who may see the party,
 * each note owned by the players of the character who wrote it, so in Foundry too a member changes
 * only their own.
 *
 * The app keeps every note first and hands each change over as a command (command-notes.mjs). Here,
 * each journal is read back for the app whole, in `journal.updated`, as Foundry holds it: after each
 * hello, after every change heard of in Foundry, and before the result of every change from the app.
 * A page's flags say what the module last wrote, and a hash of its text whether it has been changed
 * in Foundry since. Only a page shown to everyone its journal shows is sent, and a secret written in
 * Foundry only where every one of the character's players may read it there, never a party's. Names
 * are read as each journal is, never stored.
 *
 * Only the bridge sends, and the hooks are heard only there: what's changed in Foundry while no
 * Gamemaster is connected is read at the next hello.
 *
 * Since 0.35.0 each group's notes, a chapter's or those in none, keep the order Foundry holds them
 * in, which the app may set (command-notes.mjs), and a journal says who last deleted or reordered a
 * page the app is sent in Foundry, and when, as a note says who last changed it: kept in a flag on
 * the journal, as the bridge hears it, never for the module's own writes.
 */

/**
 * How long to wait for a burst of changes to one journal to settle before sending it, in
 * milliseconds.
 * @type {number}
 */
const SETTLE_JOURNAL = 500;

/**
 * The notes format of each campaign whose app reads notes, by id, as its latest answer to a hello or
 * heartbeat said: an integer of 1 or more.
 * @type {Map<string, number>}
 */
const formats = new Map();

/**
 * Each book as it was built when its campaign was last told of it, as JSON, by `bookKey`, so that
 * an unchanged one isn't posted again.
 * @type {Map<string, string>}
 */
const told = new Map();

/**
 * Journals with changes waiting to settle, and their timers, by `bookKey`.
 * @type {Map<string, number>}
 */
const settling = new Map();

/**
 * The books the Gamemaster has been told were too large to send this page load, by `bookKey`.
 * @type {Set<string>}
 */
const warned = new Set();

/**
 * The latest change heard of in Foundry that the app is told of, a page the app is sent deleted or
 * an entry's place written, waiting for its journal's changes to settle, by `bookKey`: one for the
 * burst, so a drag that writes several pages' sorts is one change.
 * @type {Map<string, {what: "delete"|"order", by: string|null, at: number}>}
 */
const heard = new Map();

/**
 * The pages the module is writing now, by id, which the hooks that hear those writes never count as
 * a change made in Foundry, where core doesn't hand the hooks the write's own options.
 * @type {Set<string>}
 */
const writing = new Set();

/**
 * A page's revision, as the module writes it to a page's flags: 14 hexadecimal digits.
 * @type {RegExp}
 */
const REV = /^[0-9a-f]{14}$/;

/**
 * An actor's id as the app takes one.
 * @type {RegExp}
 */
const ACTOR_ID = /^[A-Za-z0-9]{1,64}$/;

/**
 * The longest name sent, the same as a title: what the app takes.
 * @type {number}
 */
const MOST_NAME = 200;

/* -------------------------------------------- */
/*  Whether notes are kept here                 */
/* -------------------------------------------- */

/**
 * Can notes be kept in journals here: Foundry's JournalEntry exists. Under any system.
 * @returns {boolean}
 */
export function notesOn() {
  return (typeof globalThis.JournalEntry === "function") && Boolean(game.journal);
}

/**
 * What a campaign tells the app of notes in its hello, since 0.34.0 (round §3.1): that they're kept
 * here, in both kinds of journal, and which of its characters and parties have a journal of them
 * for this campaign in Foundry now. There's no switch. Since 0.35.0 `orders`: it takes the app's
 * orders of a group's notes and keeps Foundry's order; and `changes`: it says who deleted or
 * reordered notes in Foundry, to an app that reads it.
 * @param {Campaign} campaign
 * @returns {{enabled: true, kinds: string[], reason: null, journals: {kind: string, actorId: string}[],
 *   orders: true, changes: true}}
 */
export function noteFeatures(campaign) {
  const journals = [];
  if ( notesOn() ) {
    const found = journalsByBook();
    for ( const actor of characterActors(campaign) ) {
      if ( found.has(bookKey(campaign.id, "personal", actor.id)) ) journals.push({ kind: "personal", actorId: actor.id });
    }
    for ( const group of campaignGroups(campaign) ) {
      if ( found.has(bookKey(campaign.id, "party", group.id)) ) journals.push({ kind: "party", actorId: group.id });
    }
  }
  return { enabled: true, kinds: [...NOTE_BOOKS], reason: null, journals, orders: true, changes: true };
}

/**
 * Note whether a campaign's app reads notes: `features.notes`, 1 or later. One that starts to in a
 * heartbeat's answer, as an app deployed mid-session does, is sent every book at once; after a
 * hello's, they follow its sheets and groups. One that says nothing of them, as an older or rolled
 * back app, is sent none, and fetched from for none. Since 0.35.0 the format is kept: from 2 the
 * listener is told who changed a journal in Foundry, so one that rises to it in a heartbeat's answer
 * is sent every book afresh too.
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteNotesReader(campaignId, features, type) {
  const format = features?.notes;
  if ( !(Number.isInteger(format) && (format >= 1)) ) {
    formats.delete(campaignId);
    return;
  }
  const was = formats.get(campaignId) ?? 0;
  formats.set(campaignId, format);
  if ( (format > was) && (type === EVENTS.HEARTBEAT) ) booksWanted(campaignId);
}

/**
 * Does a campaign's app read notes?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function notesReader(campaignId) {
  return formats.has(campaignId);
}

/**
 * A campaign's notes format, as its latest answer said; 0 where it reads none.
 * @param {string} campaignId
 * @returns {number}
 */
export function notesFormat(campaignId) {
  return formats.get(campaignId) ?? 0;
}

/* -------------------------------------------- */
/*  Finding and making journals                 */
/* -------------------------------------------- */

/**
 * The book's journal in a campaign, found by flag; the earliest where several claim it (§2.3), as a
 * duplicated journal does.
 * @param {"personal"|"party"} kind
 * @param {string} actorId
 * @param {string} campaignId
 * @returns {JournalEntry|null}
 */
export function journalFor(kind, actorId, campaignId) {
  if ( !notesOn() ) return null;
  let found = null;
  for ( const entry of game.journal.values() ) {
    const flag = journalFlag(entry);
    if ( (flag?.kind !== kind) || (flag.actor !== actorId) || (flag.campaign !== campaignId) ) continue;
    if ( !found || earlier(entry, found) ) found = entry;
  }
  return found;
}

/**
 * The journal each book has, by `bookKey`: the earliest of those that claim it.
 * @returns {Map<string, JournalEntry>}
 */
function journalsByBook() {
  const found = new Map();
  for ( const entry of game.journal.values() ) {
    const flag = journalFlag(entry);
    if ( !flag ) continue;
    const key = bookKey(flag.campaign, flag.kind, flag.actor);
    const other = found.get(key);
    if ( !other || earlier(entry, other) ) found.set(key, entry);
  }
  return found;
}

/**
 * Was one journal made before another? Ties go to the smaller id, so every client picks the same.
 * @param {JournalEntry} a
 * @param {JournalEntry} b
 * @returns {boolean}
 */
function earlier(a, b) {
  const at = entry => (Number.isFinite(entry._stats?.createdTime) ? entry._stats.createdTime : Infinity);
  return (at(a) < at(b)) || ((at(a) === at(b)) && (String(a.id) < String(b.id)));
}

/**
 * The book a journal holds, as its flag says, where the flag has its shape.
 * @param {JournalEntry|null|undefined} entry
 * @returns {{kind: "personal"|"party", actor: string, campaign: string, granted: string[],
 *   default: number}|null}
 */
function journalFlag(entry) {
  const flag = entry?.flags?.[MODULE_ID]?.journal;
  if ( !isObject(flag) || !NOTE_BOOKS.includes(flag.kind) ) return null;
  if ( (typeof flag.actor !== "string") || (typeof flag.campaign !== "string") ) return null;
  return flag;
}

/**
 * The book's journal, made with its folder, ownership and flags where there's none (§2.3-§2.4):
 * named for its actor as it's called now, and for the campaign too where the actor is in more than
 * one, as each has a journal of its own.
 * @param {"personal"|"party"} kind
 * @param {Actor} actor       The character, or the party.
 * @param {Campaign} campaign
 * @returns {Promise<JournalEntry>}
 * @throws {Error}   Where Foundry made none, as when a module's hook refused it.
 */
export async function makeJournal(kind, actor, campaign) {
  const folder = await notesFolder();
  const wanted = (kind === "personal") ? personalWanted(actor) : partyWanted(actor);
  const ownership = { default: wanted.default, ...Object.fromEntries(wanted.users) };
  let name = game.i18n.format((kind === "personal") ? "SENDINGSTONE.Journal.Personal" : "SENDINGSTONE.Journal.Party", {
    name: actor.name
  });
  const listed = getCampaigns().filter(other => ((kind === "personal") ? other.characters : other.groups).has(actor.id));
  if ( listed.length > 1 ) name = game.i18n.format("SENDINGSTONE.Journal.InCampaign", { journal: name, campaign: campaign.title });
  const entry = await JournalEntry.implementation.create({
    name,
    folder: folder?.id ?? null,
    ownership,
    flags: {
      core: { viewMode: 2, locked: true },
      [MODULE_ID]: {
        journal: { kind, actor: actor.id, campaign: campaign.id, granted: [...wanted.users.keys()], default: wanted.default }
      }
    }
  });
  if ( !entry ) throw new Error("A write was refused");
  return entry;
}

/**
 * The folder journals of notes are made in, made where there's none. Found by its flag, so one
 * renamed is still used; folders only organise, so one deleted is simply made again.
 * @returns {Promise<Folder|null>}
 */
async function notesFolder() {
  const found = Array.from(game.folders?.values?.() ?? [])
    .find(folder => (folder.type === "JournalEntry") && (folder.flags?.[MODULE_ID]?.folder === "notes"));
  if ( found ) return found;
  return await Folder.implementation.create({
    name: game.i18n.localize("SENDINGSTONE.Journal.Folder"),
    type: "JournalEntry",
    sorting: "a",
    flags: { [MODULE_ID]: { folder: "notes" } }
  }) ?? null;
}

/**
 * The actor a book is of in a campaign: for a personal book one of its characters that isn't one of
 * its groups, whose actor exists; for a party book one of its groups.
 * @param {string} kind
 * @param {unknown} actorId
 * @param {Campaign} campaign
 * @returns {Actor|null}
 */
export function bookActor(kind, actorId, campaign) {
  if ( typeof actorId !== "string" ) return null;
  const groups = campaignGroups(campaign);
  if ( kind === "party" ) return groups.find(group => group.id === actorId) ?? null;
  if ( (kind !== "personal") || !campaign.characters.has(actorId) || groups.some(group => group.id === actorId) ) return null;
  return game.actors.get(actorId) ?? null;
}

/**
 * A campaign's characters that are no group, as its personal books are.
 * @param {Campaign} campaign
 * @returns {Actor[]}
 */
function characterActors(campaign) {
  const groups = new Set(campaignGroups(campaign).map(group => group.id));
  return campaignActors(campaign).filter(actor => !groups.has(actor.id));
}

/* -------------------------------------------- */
/*  Ownership                                   */
/* -------------------------------------------- */

/**
 * Who a character's journal is shown to, as the module would set it: its player owners as Owners,
 * and no one else.
 * @param {Actor} actor
 * @returns {{users: Map<string, number>, default: number}}
 */
function personalWanted(actor) {
  const { NONE, OWNER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  return { users: new Map(playerOwners(actor).map(user => [user.id, OWNER])), default: NONE };
}

/**
 * Who a party's journal is shown to, as the module would set it: each player who may see the party
 * in Foundry, as an Observer, table players outside the app included; and everyone where the party
 * is shown to everyone.
 * @param {Actor} group
 * @returns {{users: Map<string, number>, default: number}}
 */
function partyWanted(group) {
  const { NONE, OBSERVER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const users = new Map();
  for ( const user of game.users.values() ) {
    if ( !user.isGM && ((Number(group.getUserLevel(user)) || 0) >= OBSERVER) ) users.set(user.id, OBSERVER);
  }
  return { users, default: ((Number(group.ownership?.default) || 0) >= OBSERVER) ? OBSERVER : NONE };
}

/**
 * Who owns a party's note in Foundry, as the module would set it: the players of the character who
 * wrote it; for one the Gamemaster wrote, or a chapter, no one but the journal's own.
 * @param {Actor|null} author   The character who wrote it, if a player did.
 * @returns {Map<string, number>}
 */
export function pageOwners(author) {
  const { OWNER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  return new Map(author ? playerOwners(author).map(user => [user.id, OWNER]) : []);
}

/**
 * A document's ownership as it should now be, keeping the Gamemaster's own changes: each user the
 * module wants given their level; each it gave one and wants no more taken back (`removed`); every
 * other user as they are; and the default changed only while it's still the one the module set.
 * @param {object} ownership         As the document has it.
 * @param {string[]} granted         The users the module gave a level to.
 * @param {number|null} setDefault   The default the module set, or null to leave it be.
 * @param {{users: Map<string, number>, default?: number}} wanted
 * @param {number} removed           The level a user no longer wanted goes back to.
 * @returns {{ownership: object, granted: string[], default: number|null, changed: boolean}}
 */
function rederived(ownership, granted, setDefault, wanted, removed) {
  const next = { ...ownership };
  let changed = false;
  for ( const [id, level] of wanted.users ) {
    if ( next[id] === level ) continue;
    next[id] = level;
    changed = true;
  }
  for ( const id of granted ) {
    if ( wanted.users.has(id) || !Object.hasOwn(next, id) || (next[id] === removed) ) continue;
    next[id] = removed;
    changed = true;
  }
  let stillDefault = setDefault;
  if ( (setDefault !== null) && (ownership.default === setDefault) && (wanted.default !== setDefault) ) {
    next.default = wanted.default;
    stillDefault = wanted.default;
    changed = true;
  }
  const nextGranted = [...wanted.users.keys()];
  const sameGranted = (nextGranted.length === granted.length) && nextGranted.every(id => granted.includes(id));
  return { ownership: next, granted: nextGranted, default: stillDefault, changed: changed || !sameGranted };
}

/**
 * Re-derive who may see a journal and the notes in it after an actor's ownership has changed (§2.4),
 * and send again what that changes: for a character, its own journals, one for each campaign, and
 * the party notes it wrote; for a party, its journals. Only what changes is written, one update for
 * each journal or page; a user the Gamemaster gave a level by hand keeps it. A write that fails is
 * left for the actor's next change of ownership, and what Foundry then holds is sent all the same,
 * with the party books of the character's campaigns, which it may now see or not.
 * @param {string} actorId
 * @returns {Promise<void>}
 */
export async function journalOwnershipChanged(actorId) {
  try {
    const actor = game.actors.get(actorId);
    if ( !actor || !canSend() || !notesOn() ) return;
    const { NONE, INHERIT } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const books = new Map();
    const touch = (kind, id, campaignId) => books.set(bookKey(campaignId, kind, id), { kind, id, campaignId });
    for ( const entry of Array.from(game.journal.values()) ) {
      const flag = journalFlag(entry);
      if ( !flag ) continue;
      const own = flag.actor === actorId;
      if ( own && ((flag.kind === "party") === (actor.type === "group")) ) {
        const wanted = (flag.kind === "party") ? partyWanted(actor) : personalWanted(actor);
        const next = rederived(entry.ownership ?? {}, idList(flag.granted), Number.isInteger(flag.default) ? flag.default : null,
          wanted, NONE);
        if ( next.changed ) {
          await quietly(() => entry.update({
            ownership: next.ownership,
            [`flags.${MODULE_ID}.journal`]: { ...flag, granted: next.granted, default: next.default ?? flag.default }
          }));
        }
        touch(flag.kind, flag.actor, flag.campaign);
      }
      if ( (flag.kind !== "party") || (actor.type === "group") ) continue;
      for ( const page of textPages(entry) ) {
        if ( !flagsCount(page) || (pageRole(page) !== "entry") ) continue;
        const flags = page.flags[MODULE_ID];
        if ( flags.author?.actor !== actorId ) continue;
        const next = rederived(page.ownership ?? {}, idList(flags.granted), null, { users: pageOwners(actor) }, INHERIT);
        if ( next.changed ) {
          // A note changed in Foundry keeps who changed it there, which this write would make the
          // Gamemaster's, now.
          const edit = lastFoundryEdit(page);
          await quietly(() => page.update({
            ownership: next.ownership,
            [`flags.${MODULE_ID}`]: { ...flags, granted: next.granted, ...(edit && { foundry: edit }) }
          }));
        }
        touch("party", flag.actor, flag.campaign);
      }
    }
    for ( const campaign of getCampaigns() ) {
      if ( campaign.characters.has(actorId) ) {
        for ( const group of campaignGroups(campaign) ) touch("party", group.id, campaign.id);
      }
      if ( campaign.groups.has(actorId) ) touch("party", actorId, campaign.id);
    }
    for ( const { kind, id, campaignId } of books.values() ) sendBook(kind, id, campaignId);
  } catch {
    // Left for the actor's next change of ownership: nothing here is worth stopping a sheet for.
  }
}

/**
 * Make a write, leaving one that fails or is refused for later.
 * @param {() => Promise<unknown>} write
 * @returns {Promise<void>}
 */
async function quietly(write) {
  try {
    await write();
  } catch {
    // Foundry keeps what it had; the next such change tries again.
  }
}

/**
 * The user ids a flag lists, where it lists them.
 * @param {unknown} value
 * @returns {string[]}
 */
function idList(value) {
  return Array.isArray(value) ? value.filter(id => typeof id === "string") : [];
}

/**
 * Is a page shared as its journal is: hidden from nobody the journal shows it to, and not GM-only
 * (§2.8)? A pure test of the two ownership maps, never of who reads the app, which can't be known
 * here: every player, and the default, must have at least the level on the page that the journal
 * gives them, up to Observer; and a page whose own default is None or Limited that no player is
 * given Observer on is the Gamemaster's alone. The module's own pages, which inherit, always pass.
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
export function sharedLikeJournal(page) {
  const { INHERIT, LIMITED, OBSERVER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const journal = page?.parent?.ownership ?? {};
  const own = page?.ownership ?? {};
  const level = value => (Number.isFinite(Number(value)) ? Number(value) : INHERIT);
  const journalDefault = Math.max(level(journal.default ?? 0), 0);
  const journalLevel = id => {
    const value = Object.hasOwn(journal, id) ? level(journal[id]) : INHERIT;
    return (value === INHERIT) ? journalDefault : value;
  };
  const ownDefault = Object.hasOwn(own, "default") ? level(own.default) : INHERIT;
  const pageDefault = (ownDefault === INHERIT) ? journalDefault : ownDefault;
  const pageLevel = id => {
    const value = Object.hasOwn(own, id) ? level(own[id]) : ownDefault;
    return (value === INHERIT) ? journalLevel(id) : value;
  };
  const players = Array.from(game.users.values()).filter(user => !user.isGM);
  if ( pageDefault < Math.min(journalDefault, OBSERVER) ) return false;
  if ( players.some(user => pageLevel(user.id) < Math.min(journalLevel(user.id), OBSERVER)) ) return false;
  const gmOnly = (ownDefault !== INHERIT) && (ownDefault <= LIMITED)
    && !players.some(user => Object.hasOwn(own, user.id) && (level(own[user.id]) >= OBSERVER));
  return !gmOnly;
}

/* -------------------------------------------- */
/*  Reading pages                               */
/* -------------------------------------------- */

/**
 * A journal's text pages, the only ones that are notes, in Foundry's order.
 * @param {JournalEntry} entry
 * @returns {JournalEntryPage[]}
 */
export function textPages(entry) {
  return pagesInOrder(entry).filter(page => page.type === "text");
}

/**
 * Every page of a journal, in Foundry's order: by `sort`, then id.
 * @param {JournalEntry} entry
 * @returns {JournalEntryPage[]}
 */
export function pagesInOrder(entry) {
  return Array.from(entry?.pages?.values?.() ?? [])
    .sort((a, b) => ((Number(a.sort) || 0) - (Number(b.sort) || 0)) || compareIds(a.id, b.id));
}

/**
 * Two ids in a fixed order.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareIds(a, b) {
  return (String(a) < String(b)) ? -1 : ((String(a) > String(b)) ? 1 : 0);
}

/**
 * Do a page's module flags count: its own id, every field in shape (§2.5)? A page duplicated in
 * Foundry carries the original's flags under a new id, and one whose flags were edited by hand may
 * hold anything: either reads as a page written in Foundry, which can't claim an author.
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
export function flagsCount(page) {
  const flags = page?.flags?.[MODULE_ID];
  if ( !isObject(flags) || (flags.page !== page.id) ) return false;
  if ( !["chapter", "entry"].includes(flags.role) ) return false;
  if ( (flags.chapter !== null) && !((typeof flags.chapter === "string") && NOTE_ID.test(flags.chapter)) ) return false;
  if ( !isTime(flags.createdAt) || (typeof flags.hash !== "string") || !REV.test(flags.hash) ) return false;
  const who = value => isObject(value) && ((value.actor === null) || isActorId(value.actor)) && (typeof value.gm === "boolean");
  if ( !who(flags.modified) || !isTime(flags.modified.at) ) return false;
  if ( (flags.author !== null) && !who(flags.author) ) return false;
  return (flags.granted === undefined) || (Array.isArray(flags.granted) && flags.granted.every(id => typeof id === "string"));
}

/**
 * Is a page a chapter or a note: by its flag where its flags count; otherwise by the level Foundry
 * draws its title at, a level 1 heading being a chapter.
 * @param {JournalEntryPage} page
 * @returns {"chapter"|"entry"}
 */
export function pageRole(page) {
  if ( flagsCount(page) ) return page.flags[MODULE_ID].role;
  return (page.title?.level === 1) ? "chapter" : "entry";
}

/**
 * The format a page's text is in, as it's read: Markdown (2) where it's kept as Markdown, unless its
 * Markdown is empty while its HTML isn't, as Foundry's HTML editor leaves it; HTML (1) otherwise.
 * @param {JournalEntryPage} page
 * @returns {1|2}
 */
export function pageFormat(page) {
  const text = page?.text ?? {};
  const markdown = CONST.JOURNAL_ENTRY_PAGE_FORMATS?.MARKDOWN ?? 2;
  if ( (Number(text.format) !== markdown) || (typeof text.markdown !== "string") ) return 1;
  return ((text.markdown === "") && (String(text.content ?? "") !== "")) ? 1 : 2;
}

/**
 * A page's text as it's read, in its format: its Markdown, or its HTML.
 * @param {JournalEntryPage} page
 * @returns {string}
 */
export function pageBody(page) {
  return (pageFormat(page) === 2) ? page.text.markdown : String(page?.text?.content ?? "");
}

/**
 * A page's revision (§2.6): a hash of what the app can change of it, so that a write of the
 * module's own sort, flags or ownership never makes it look changed in Foundry. A chapter's is its
 * title alone, so text the Gamemaster writes under one never makes its rename a conflict.
 * @param {JournalEntryPage} page
 * @returns {string}
 */
export function pageRev(page) {
  if ( pageRole(page) === "chapter" ) return noteRev("chapter", page.name);
  const format = pageFormat(page);
  return noteRev("entry", page.name, format, pageBody(page));
}

/**
 * The revision of a note's title and text, as `pageRev` reads a page holding them.
 * @param {"chapter"|"entry"} role
 * @param {string} name
 * @param {1|2} [format]
 * @param {string} [body]
 * @returns {string}
 */
export function noteRev(role, name, format=2, body="") {
  return textHash(JSON.stringify((role === "chapter") ? ["chapter", name] : ["entry", name, format, body]));
}

/**
 * When a page was first written, as it's read: the app's time, kept in its flags; else Foundry's,
 * when it was made, else last changed, else 0, never null.
 * @param {JournalEntryPage} page
 * @returns {number}
 */
export function pageCreatedAt(page) {
  if ( flagsCount(page) ) return page.flags[MODULE_ID].createdAt;
  return timeOf(page?._stats?.createdTime) ?? timeOf(page?._stats?.modifiedTime) ?? 0;
}

/**
 * How a page would be sent to the app as a note: as format 1 where it's HTML, or where its text,
 * written in Foundry, holds a secret its readers in the app couldn't see there; and whether its
 * title or text is cut short. What's sent so the app can't change it, as `checkNoteCommand`'s
 * refusal `foundry-only` does.
 * @param {JournalEntryPage} page
 * @returns {{format: 1|2, secret: boolean, body: string, cut: boolean}}
 */
export function pageSentAs(page) {
  const hidden = secretsHidden(page);
  const format = pageFormat(page);
  const content = String(page?.text?.content ?? "");
  let sent = { format, secret: false, body: pageBody(page) };
  if ( hidden && (format === 1) ) sent.body = withoutSecrets(content);
  // A page changed in Foundry whose HTML holds a secret goes as that HTML without it, never as its
  // Markdown, which holds the secret too. A chapter's text is always Foundry's, as the app never
  // writes it, so its title alone, which its revision is of, can't say it's unchanged.
  else if ( hidden && ((pageRole(page) === "chapter") || changedInFoundry(page)) && holdsSecret(content) ) {
    sent = { format: 1, secret: true, body: withoutSecrets(content) };
  }
  const name = String(page?.name ?? "");
  const cut = (name.length > MOST_NOTE_TITLE) || (sent.body.length > MOST_NOTE_TEXT);
  return { ...sent, cut };
}

/**
 * Are a page's secrets kept from the app? Always in a party's journal, as a party sheet's texts are
 * sent without them; and in a character's where not every one of its player owners is an Owner of
 * the page, as when the Gamemaster made one of them an Observer of it or of the journal: Foundry
 * shows a page's secrets to its Owners alone, and the character's seat in the app is any of them.
 * A character no player owns has no one to show them to.
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
function secretsHidden(page) {
  const flag = journalFlag(page?.parent);
  if ( flag?.kind !== "personal" ) return true;
  const actor = game.actors.get(flag.actor);
  const owners = actor ? playerOwners(actor) : [];
  return !owners.length || !owners.every(user => page.testUserPermission(user, "OWNER"));
}

/**
 * Has a page been changed in Foundry since the module last wrote it, or never written by it?
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
function changedInFoundry(page) {
  return !flagsCount(page) || (pageRev(page) !== page.flags[MODULE_ID].hash);
}

/**
 * Who last changed a note in Foundry, and when, as the module kept it before a write of its own
 * that Foundry counts as the Gamemaster's change, now: one of the note's place or who owns it
 * (`lastFoundryEdit`). Only while the page still holds what it held then, and only on the page it
 * was kept on, never a copy of it.
 * @param {JournalEntryPage} page
 * @param {string} rev   The page's revision now.
 * @returns {{at: number, by: string|null}|null}
 */
function keptFoundryEdit(page, rev) {
  const kept = page?.flags?.[MODULE_ID]?.foundry;
  if ( !isObject(kept) || (kept.page !== page.id) || (kept.rev !== rev) || !isTime(kept.at) ) return null;
  return ((kept.by === null) || (typeof kept.by === "string")) ? { at: kept.at, by: kept.by } : null;
}

/**
 * What to keep in a note's flags, `foundry`, of who last changed it in Foundry and when, in a write
 * the module makes of its place or who owns it, which Foundry's `_stats` would count as the
 * Gamemaster's change, now: for a text page changed in Foundry, where what's kept isn't of what it
 * holds now already; null for any other. A page with no flags of the module's may hold this alone:
 * its flags still don't count, as `page` isn't among them.
 * @param {JournalEntryPage|undefined} page
 * @returns {{page: string, rev: string, at: number, by: string|null}|null}
 */
export function lastFoundryEdit(page) {
  if ( (page?.type !== "text") || !changedInFoundry(page) ) return null;
  const rev = pageRev(page);
  if ( keptFoundryEdit(page, rev) ) return null;
  const by = page._stats?.lastModifiedBy;
  return { page: page.id, rev, at: timeOf(page._stats?.modifiedTime) ?? pageCreatedAt(page), by: (typeof by === "string") ? by : null };
}

/**
 * Does HTML hold a secret section, as Foundry's editor makes one?
 * @param {string} html
 * @returns {boolean}
 */
function holdsSecret(html) {
  if ( !html.includes("secret") ) return false;
  return Boolean(new DOMParser().parseFromString(html, "text/html").querySelector("section.secret"));
}

/**
 * HTML without its secret sections, and what they hold.
 * @param {string} html
 * @returns {string}
 */
function withoutSecrets(html) {
  if ( !holdsSecret(html) ) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for ( const section of doc.body.querySelectorAll("section.secret") ) section.remove();
  return doc.body.innerHTML;
}

/**
 * The notes of a journal as its campaign is told them (§2.8), or a reason it isn't told: a party
 * no character of the campaign may see in Foundry is private. Only text pages that are shared as the
 * journal is are notes, in Foundry's order; each as far as the app takes it, so that one odd page
 * can never cost the rest of the journal its place.
 * @param {JournalEntry} entry
 * @param {Campaign} campaign
 * @returns {{notes: object[]}|{withheld: {reason: "private"}}}
 */
export function readJournal(entry, campaign) {
  const flag = journalFlag(entry);
  if ( (flag?.kind === "party") && partyPrivate(flag.actor, campaign) ) return { withheld: { reason: "private" } };
  const chapters = chaptersAsSent(entry);
  const notes = [];
  for ( const page of textPages(entry) ) {
    if ( !sentToApp(page) ) continue;
    const role = pageRole(page);
    const note = describePage(page, campaign, { role, chapter: (role === "entry") ? (chapters.get(page.id) ?? null) : null });
    if ( note ) notes.push(note);
  }
  return { notes };
}

/**
 * Is a text page one of its journal's notes the app is sent: one with an id the app takes, shared
 * as its journal is?
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
function sentToApp(page) {
  return NOTE_ID.test(String(page.id)) && sharedLikeJournal(page);
}

/**
 * The chapter each of a journal's entries is in as the app is told it (§2.8 step 5), by the entry's
 * id: its flag's where its flags count, else the nearest chapter before it, whoever may see it; where
 * that's a chapter the app isn't sent, as one only the Gamemaster sees, the nearest before the entry
 * that it is, as players read the journal in Foundry; and none where it names no chapter here, as
 * one not made yet. The note command reads an entry's chapter by this rule too, so a change from the
 * app that leaves its chapter as the app was shown it never takes it out of one the app isn't shown.
 * @param {JournalEntry} entry
 * @returns {Map<string, string|null>}
 */
export function chaptersAsSent(entry) {
  const pages = textPages(entry);
  const roles = new Map(pages.map(page => [page.id, pageRole(page)]));
  const shown = new Set(pages.filter(page => (roles.get(page.id) === "chapter") && sentToApp(page)).map(page => page.id));
  const chapters = new Map();
  let nearest = null;
  let nearestShown = null;
  for ( const page of pages ) {
    if ( roles.get(page.id) === "chapter" ) {
      nearest = page.id;
      if ( shown.has(page.id) ) nearestShown = page.id;
      continue;
    }
    const placed = flagsCount(page) ? page.flags[MODULE_ID].chapter : nearest;
    let chapter = null;
    if ( shown.has(placed) ) chapter = placed;
    else if ( roles.get(placed) === "chapter" ) chapter = nearestShown;
    chapters.set(page.id, chapter);
  }
  return chapters;
}

/**
 * The chapters of a journal the app is sent now, by id (§2.8): as `readJournal` sends them.
 * @param {JournalEntry} entry
 * @returns {Set<string>}
 */
export function sentChapters(entry) {
  return new Set(textPages(entry).filter(page => sentNote(page) && (pageRole(page) === "chapter")).map(page => page.id));
}

/**
 * The ids of a group's notes as the app is sent them, in Foundry's order: the entries `readJournal`
 * sends with this chapter, or with none for null (round 0.35.0 §2.1).
 * @param {JournalEntry} entry
 * @param {string|null} chapter
 * @returns {string[]}
 */
export function groupMembers(entry, chapter) {
  const chapters = chaptersAsSent(entry);
  return textPages(entry)
    .filter(page => sentNote(page) && (pageRole(page) === "entry") && ((chapters.get(page.id) ?? null) === chapter))
    .map(page => page.id);
}

/**
 * Is a text page one `readJournal` sends: one the app is sent, with a title?
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
function sentNote(page) {
  return sentToApp(page) && (typeof page.name === "string") && (page.name !== "");
}

/**
 * A page as the app is told it, a note: who wrote it and when, who changed it last, in the app or
 * in Foundry, and its revision; or null for one with no title, which can't be one.
 * @param {JournalEntryPage} page
 * @param {Campaign} campaign
 * @param {object} read
 * @param {"chapter"|"entry"} read.role
 * @param {string|null} read.chapter   An entry's chapter as the app is told it (`chaptersAsSent`).
 * @returns {object|null}
 */
function describePage(page, campaign, { role, chapter }) {
  const name = (typeof page.name === "string") ? page.name : "";
  if ( !name ) return null;
  const counts = flagsCount(page);
  const flags = counts ? page.flags[MODULE_ID] : null;
  const sent = pageSentAs(page);
  const [title, titleCut] = cutText(name, MOST_NOTE_TITLE);
  const [body, bodyCut] = cutText(sent.body, MOST_NOTE_TEXT);
  const createdAt = pageCreatedAt(page);
  const rev = pageRev(page);
  const foundry = !counts || (rev !== flags.hash);
  // Who changed it in Foundry, as kept before the module's own writes of its place or owners, which
  // Foundry would otherwise count as the Gamemaster's change.
  const kept = foundry ? keptFoundryEdit(page, rev) : null;
  return {
    id: page.id,
    role,
    chapter,
    title,
    format: sent.format,
    ...((sent.format === 2) ? { markdown: body } : { html: body }),
    ...((titleCut || bodyCut) && { cut: true }),
    ...(sent.secret && { secret: true }),
    createdAt,
    modifiedAt: foundry ? (kept?.at ?? timeOf(page._stats?.modifiedTime) ?? createdAt) : flags.modified.at,
    modifiedBy: cutText(foundry ? userName(kept ? kept.by : page._stats?.lastModifiedBy, campaign) : writerName(flags.modified), MOST_NAME)[0],
    modifiedIn: foundry ? "foundry" : "app",
    author: flags?.author
      ? { actorId: flags.author.actor, gm: flags.author.gm, name: cutText(writerName(flags.author), MOST_NAME)[0] }
      : null,
    rev
  };
}

/**
 * Who wrote or changed a note from the app, by name as they're called now: the Gamemaster, or the
 * character.
 * @param {{actor: string|null, gm: boolean}} who
 * @returns {string}
 */
function writerName(who) {
  if ( who.gm ) return game.i18n.localize("SENDINGSTONE.Journal.Gamemaster");
  return (who.actor && game.actors.get(who.actor)?.name) || game.i18n.localize("SENDINGSTONE.Journal.Someone");
}

/**
 * Who changed a page in Foundry, by name: the Gamemaster; a player by the one character of the
 * campaign's they own, where they own just one; else by their own name; and someone unknown where
 * the user is gone.
 * @param {unknown} userId
 * @param {Campaign} campaign
 * @returns {string}
 */
function userName(userId, campaign) {
  const user = (typeof userId === "string") ? game.users.get(userId) : null;
  if ( !user ) return game.i18n.localize("SENDINGSTONE.Journal.Someone");
  if ( user.isGM ) return game.i18n.localize("SENDINGSTONE.Journal.Gamemaster");
  const owned = characterActors(campaign).filter(actor => playerOwners(actor).some(owner => owner.id === user.id));
  return ((owned.length === 1) ? owned[0].name : user.name) || game.i18n.localize("SENDINGSTONE.Journal.Someone");
}

/* -------------------------------------------- */
/*  Sending books                               */
/* -------------------------------------------- */

/**
 * The key a book is known by, in a campaign.
 * @param {string} campaignId
 * @param {string} kind
 * @param {string} actorId
 * @returns {string}
 */
function bookKey(campaignId, kind, actorId) {
  return `${campaignId}|${kind}|${actorId}`;
}

/**
 * Is a party one no character of the campaign may see in Foundry?
 * @param {string} groupId
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function partyPrivate(groupId, campaign) {
  const group = bookActor("party", groupId, campaign);
  return !group || !Object.keys(groupEntry(group, campaign).access).length;
}

/**
 * Send a book to its campaign, as Foundry holds it now (§3.3): in `journal.updated`, with every note
 * the campaign may be told of; with `journal: null` where it has no journal; and saying why where it
 * isn't told, a party no character of the campaign may see, or a journal too large to post. Only to
 * the book's own campaign, while it still has the character or party, and its app reads notes, and
 * groups too for a party; never while its hello is on its way, which every book follows; and never
 * twice the same.
 * @param {"personal"|"party"} kind
 * @param {string} actorId
 * @param {string} campaignId
 * @returns {void}
 */
export function sendBook(kind, actorId, campaignId) {
  if ( !canSend() ) return;
  const campaign = getCampaigns().find(({ id }) => id === campaignId);
  if ( !campaign || !notesReader(campaign.id) || helloPending(campaign.id) ) return;
  if ( !bookActor(kind, actorId, campaign) || ((kind === "party") && !groupReader(campaign.id)) ) return;
  try {
    postBook(kind, actorId, campaign);
  } catch {
    // The app keeps what it was last told; the next change or hello sends the book again.
  }
}

/**
 * Build and post a book, as `sendBook` sends it.
 * @param {"personal"|"party"} kind
 * @param {string} actorId
 * @param {Campaign} campaign
 * @returns {void}
 */
function postBook(kind, actorId, campaign) {
  const key = bookKey(campaign.id, kind, actorId);
  let data;
  let entry = null;
  if ( (kind === "party") && partyPrivate(actorId, campaign) ) {
    data = { kind, actorId, journal: null, withheld: { reason: "private" } };
  } else {
    entry = journalFor(kind, actorId, campaign.id);
    const read = entry ? readJournal(entry, campaign) : null;
    if ( !entry ) data = { kind, actorId, journal: null };
    else if ( read.withheld ) data = { kind, actorId, journal: null, withheld: read.withheld };
    else {
      // Who last deleted or reordered a page the app is sent in Foundry, to an app that reads it.
      const changed = (notesFormat(campaign.id) >= NOTES_CHANGES) ? changedFlag(entry) : null;
      data = { kind, actorId, journal: {
        id: entry.id, name: cutText(String(entry.name ?? ""), MOST_NAME)[0], notes: read.notes,
        ...(changed && { changed: { what: changed.what, by: cutText(userName(changed.by, campaign), MOST_NAME)[0], at: changed.at } })
      } };
    }
  }
  const json = JSON.stringify(data);
  if ( told.get(key) === json ) return;
  told.set(key, json);

  // Measured as it will be posted.
  const envelope = buildEnvelope(EVENTS.JOURNAL_UPDATED, data, { campaign });
  const { maxBytes } = termsOf(campaign.id);
  const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
  const notes = data.journal?.notes;
  if ( notes && ((notes.length > MOST_NOTES) || (bytes > maxBytes)) ) {
    envelope.data = { kind, actorId, journal: null, withheld: { reason: "tooLarge", bytes, limit: maxBytes } };
    post(envelope);
    warnTooLarge(key, entry, campaign, bytes);
    return;
  }
  post(envelope);
}

/**
 * Tell the Gamemaster, once a page load for each book, that its journal was too large to send.
 * @param {string} key
 * @param {JournalEntry} entry
 * @param {Campaign} campaign
 * @param {number} bytes
 * @returns {void}
 */
function warnTooLarge(key, entry, campaign, bytes) {
  if ( warned.has(key) ) return;
  warned.add(key);
  ui.notifications?.warn(game.i18n.format("SENDINGSTONE.Notify.JournalTooLarge", {
    name: entry.name, size: inMegabytes(bytes, Math.ceil), campaign: campaign.title
  }));
}

/**
 * Send a campaign every book it holds afresh, after its hello's sheets and groups: one for each
 * journal the campaign has in Foundry, as its hello lists them; and for each the hello answered
 * listed that has gone since, `journal: null`. A book with no journal isn't sent: the hello said so.
 * @param {Campaign} campaign
 * @param {object} [hello]   The hello answered.
 * @returns {void}
 */
export function sendBooks(campaign, hello) {
  if ( !canSend() || !notesReader(campaign.id) ) return;
  const books = new Map();
  const listed = hello?.data?.features?.notes?.journals;
  for ( const book of [...noteFeatures(campaign).journals, ...(Array.isArray(listed) ? listed : [])] ) {
    if ( NOTE_BOOKS.includes(book?.kind) && (typeof book.actorId === "string") ) books.set(`${book.kind}|${book.actorId}`, book);
  }
  for ( const { kind, actorId } of books.values() ) sendBook(kind, actorId, campaign.id);
}

/**
 * Send a campaign whose app has just said it reads notes, in answer to a heartbeat, every book
 * afresh. After a hello's answer, they follow its sheets and groups instead.
 * @param {string} campaignId
 * @returns {void}
 */
function booksWanted(campaignId) {
  const campaign = getCampaigns().find(({ id }) => id === campaignId);
  if ( !campaign || !canSend() || helloPending(campaign.id) ) return;
  forgetBooks(campaign.id);
  sendBooks(campaign);
}

/**
 * Forget what a campaign was told of its books, as its hello does.
 * @param {string} campaignId
 * @returns {void}
 */
export function forgetBooks(campaignId) {
  for ( const key of told.keys() ) {
    if ( key.startsWith(`${campaignId}|`) ) told.delete(key);
  }
}

/* -------------------------------------------- */
/*  Hearing of changes                          */
/* -------------------------------------------- */

/**
 * Listen for changes to journals and their pages that hold notes, on the bridge alone: a page made,
 * changed or deleted, and a journal made, changed, as its ownership, or deleted. Each journal is
 * sent once its changes settle, as Foundry then holds it; the module's own writes are sent before
 * their results, so they settle to nothing new. Since 0.35.0 a page's delete, and a write of an
 * entry's place, are heard with who made them, for the journal to say who changed it in Foundry.
 * @returns {void}
 */
export function registerJournalHooks() {
  Hooks.on("createJournalEntryPage", page => journalChanged(page?.parent));
  Hooks.on("updateJournalEntryPage", (page, change, options, userId) => {
    const placed = isObject(change) && Object.hasOwn(change, "sort");
    journalChanged(page?.parent, placed ? changeHeard(page, "order", options, userId) : null);
  });
  Hooks.on("deleteJournalEntryPage", (page, options, userId) => journalChanged(page?.parent, changeHeard(page, "delete", options, userId)));
  for ( const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"] ) {
    Hooks.on(hook, entry => journalChanged(entry));
  }
}

/**
 * A page's delete, or a write of an entry's place, as the journal's change made in Foundry (round
 * 0.35.0 §6.6.2), where it counts: a page of the book's own journal that the app is sent (a deleted
 * one as the hook hands it, still holding its ownership), in a write that isn't the module's own. A
 * chapter's place doesn't count: chapters keep the order they were written in, in the app.
 * The write's own options say so where core hands them on; the pages being written say so where it
 * doesn't. Who made it, and Foundry's time of it; null for any other.
 * @param {JournalEntryPage} page
 * @param {"delete"|"order"} what
 * @param {object} [options]   The write's options, as the hook has them.
 * @param {string} [userId]    Who made it.
 * @returns {{what: "delete"|"order", by: string|null, at: number}|null}
 */
function changeHeard(page, what, options, userId) {
  if ( !canSend() || (page?.type !== "text") || !sentNote(page) ) return null;
  if ( (what === "order") && (pageRole(page) !== "entry") ) return null;
  const flag = journalFlag(page.parent);
  if ( !flag || (journalFor(flag.kind, flag.actor, flag.campaign) !== page.parent) ) return null;
  if ( (options?.[MODULE_ID] === true) || ((userId === game.user?.id) && writing.has(page.id)) ) return null;
  const server = Number(game.time?.serverTime);
  const at = Math.floor((Number.isFinite(server) && (server > 0)) ? server : Date.now());
  return { what, by: (typeof userId === "string") ? userId : null, at };
}

/**
 * Make writes of a journal's pages as the module's own: their hooks never count as Foundry's change,
 * whatever options core hands them. A page written in Foundry at the same time, by the Gamemaster on
 * this client, is taken for the module's own too.
 * @template T
 * @param {string[]} ids                  The pages written.
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 */
export async function ownWrite(ids, write) {
  const mine = ids.filter(id => !writing.has(id));
  for ( const id of mine ) writing.add(id);
  try {
    return await write();
  } finally {
    for ( const id of mine ) writing.delete(id);
  }
}

/**
 * Note that a journal of notes may have changed, and send its book once its changes settle. A
 * deleted journal's book goes with no journal, unless another claims it. Since 0.35.0 the latest
 * change heard of in Foundry, who deleted or reordered a page the app is sent, is written to the
 * journal as it settles, once for the burst, where it's later than the one there; and the book then
 * says it.
 * @param {JournalEntry|null|undefined} entry
 * @param {{what: string, by: string|null, at: number}|null} [change]   Who changed it in Foundry.
 * @returns {void}
 */
function journalChanged(entry, change=null) {
  if ( !canSend() ) return;
  const flag = journalFlag(entry);
  if ( !flag ) return;
  const key = bookKey(flag.campaign, flag.kind, flag.actor);
  if ( change && !(heard.get(key)?.at > change.at) ) heard.set(key, change);
  clearTimeout(settling.get(key));
  settling.set(key, setTimeout(() => {
    settling.delete(key);
    void journalSettled(key, flag);
  }, SETTLE_JOURNAL));
}

/**
 * A journal's changes have settled: write who changed it in Foundry, where that was heard and is
 * later than what the journal says, and send its book. The change is taken as the write starts, so
 * the settle that write causes writes nothing; one heard meanwhile settles on its own. The write is
 * the module's own, and doesn't redraw the journal where the Gamemaster has it open.
 * @param {string} key
 * @param {{kind: string, actor: string, campaign: string}} flag
 * @returns {Promise<void>}
 */
async function journalSettled(key, flag) {
  const change = heard.get(key) ?? null;
  heard.delete(key);
  const entry = (change && canSend()) ? journalFor(flag.kind, flag.actor, flag.campaign) : null;
  if ( entry && !(changedFlag(entry)?.at >= change.at) ) {
    await quietly(() => entry.update({ [`flags.${MODULE_ID}.changed`]: change }, { render: false, ...OWN_WRITE }));
  }
  sendBook(flag.kind, flag.actor, flag.campaign);
}

/**
 * Who last deleted or reordered a page the app is sent in Foundry, and when, as the journal keeps
 * it beside its book (`flags["sending-stone"].changed`), where it has its shape; never inside
 * `journal`, which the module's writes of who may see it rewrite.
 * @param {JournalEntry} entry
 * @returns {{what: "delete"|"order", by: string|null, at: number}|null}
 */
function changedFlag(entry) {
  const changed = entry?.flags?.[MODULE_ID]?.changed;
  if ( !isObject(changed) || !["delete", "order"].includes(changed.what) ) return null;
  if ( (changed.by !== null) && (typeof changed.by !== "string") ) return null;
  return (Number.isInteger(changed.at) && (changed.at > 0)) ? changed : null;
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Text cut to at most this many characters, never through a character written as two, and whether
 * it was cut.
 * @param {string} text
 * @param {number} most
 * @returns {[string, boolean]}
 */
function cutText(text, most) {
  if ( text.length <= most ) return [text, false];
  const end = /[\uD800-\uDBFF]/.test(text[most - 1]) ? most - 1 : most;
  return [text.slice(0, end), true];
}

/**
 * A time as the app takes one, in whole milliseconds; null for anything else, as a null `_stats`
 * time.
 * @param {unknown} value
 * @returns {number|null}
 */
function timeOf(value) {
  return (Number.isFinite(value) && (value >= 0)) ? Math.floor(value) : null;
}

/**
 * Is this a time as the module writes one to a page's flags: whole milliseconds, never negative?
 * @param {unknown} value
 * @returns {boolean}
 */
function isTime(value) {
  return Number.isInteger(value) && (value >= 0);
}

/**
 * Is this an actor's id as the app takes one?
 * @param {unknown} value
 * @returns {boolean}
 */
function isActorId(value) {
  return (typeof value === "string") && ACTOR_ID.test(value);
}

/**
 * Is this a plain object?
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return Boolean(value) && (typeof value === "object") && !Array.isArray(value);
}
