import { EVENTS, MODULE_ID, MOST_NOTE_TEXT, MOST_NOTE_TITLE, MOST_NOTES, NOTE_BOOKS, NOTE_ID } from "./constants.mjs";
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
 * in Foundry since. Only a page shown to everyone its journal shows is sent, and a party's secrets
 * never are. Names are read as each journal is, never stored.
 *
 * Only the bridge sends, and the hooks are heard only there: what's changed in Foundry while no
 * Gamemaster is connected is read at the next hello.
 */

/**
 * How long to wait for a burst of changes to one journal to settle before sending it, in
 * milliseconds.
 * @type {number}
 */
const SETTLE_JOURNAL = 500;

/**
 * The campaigns whose app reads notes, by id, as their latest answer to a hello or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

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
 * for this campaign in Foundry now. There's no switch.
 * @param {Campaign} campaign
 * @returns {{enabled: true, kinds: string[], reason: null, journals: {kind: string, actorId: string}[]}}
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
  return { enabled: true, kinds: [...NOTE_BOOKS], reason: null, journals };
}

/**
 * Note whether a campaign's app reads notes: `features.notes`, 1 or later. One that starts to in a
 * heartbeat's answer, as an app deployed mid-session does, is sent every book at once; after a
 * hello's, they follow its sheets and groups. One that says nothing of them, as an older or rolled
 * back app, is sent none, and fetched from for none.
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteNotesReader(campaignId, features, type) {
  const format = features?.notes;
  if ( !(Number.isInteger(format) && (format >= 1)) ) {
    readers.delete(campaignId);
    return;
  }
  const was = readers.has(campaignId);
  readers.add(campaignId);
  if ( !was && (type === EVENTS.HEARTBEAT) ) booksWanted(campaignId);
}

/**
 * Does a campaign's app read notes?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function notesReader(campaignId) {
  return readers.has(campaignId);
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
          await quietly(() => page.update({
            ownership: next.ownership,
            [`flags.${MODULE_ID}`]: { ...flags, granted: next.granted }
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
    // Foundry keeps what it had; the next change of ownership tries again.
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
 * How a page would be sent to the app as a note: as format 1 where it's HTML, or a party page whose
 * text, changed in Foundry, holds a secret; and whether its title or text is cut short. What's sent
 * so the app can't change it, as `checkNoteCommand`'s refusal `foundry-only` does.
 * @param {JournalEntryPage} page
 * @returns {{format: 1|2, secret: boolean, body: string, cut: boolean}}
 */
export function pageSentAs(page) {
  const party = journalFlag(page?.parent)?.kind === "party";
  const format = pageFormat(page);
  const content = String(page?.text?.content ?? "");
  let sent = { format, secret: false, body: pageBody(page) };
  if ( party && (format === 1) ) sent.body = withoutSecrets(content);
  // A party page changed in Foundry whose HTML holds a secret goes as that HTML without it, never as
  // its Markdown, which holds the secret too.
  else if ( party && changedInFoundry(page) && holdsSecret(content) ) {
    sent = { format: 1, secret: true, body: withoutSecrets(content) };
  }
  const name = String(page?.name ?? "");
  const cut = (name.length > MOST_NOTE_TITLE) || (sent.body.length > MOST_NOTE_TEXT);
  return { ...sent, cut };
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
  const pages = textPages(entry).filter(page => NOTE_ID.test(String(page.id)) && sharedLikeJournal(page));
  const chapters = new Set(pages.filter(page => pageRole(page) === "chapter").map(page => page.id));
  const notes = [];
  let lastChapter = null;
  for ( const page of pages ) {
    const role = pageRole(page);
    if ( role === "chapter" ) lastChapter = page.id;
    const note = describePage(page, campaign, { role, chapters, lastChapter });
    if ( note ) notes.push(note);
  }
  return { notes };
}

/**
 * A page as the app is told it, a note: who wrote it and when, who changed it last, in the app or
 * in Foundry, and its revision; or null for one with no title, which can't be one.
 * @param {JournalEntryPage} page
 * @param {Campaign} campaign
 * @param {object} read
 * @param {"chapter"|"entry"} read.role
 * @param {Set<string>} read.chapters        The journal's chapters sent.
 * @param {string|null} read.lastChapter     The nearest of them before the page.
 * @returns {object|null}
 */
function describePage(page, campaign, { role, chapters, lastChapter }) {
  const name = (typeof page.name === "string") ? page.name : "";
  if ( !name ) return null;
  const counts = flagsCount(page);
  const flags = counts ? page.flags[MODULE_ID] : null;
  const sent = pageSentAs(page);
  const [title, titleCut] = cutText(name, MOST_NOTE_TITLE);
  const [body, bodyCut] = cutText(sent.body, MOST_NOTE_TEXT);
  let chapter = null;
  if ( role === "entry" ) chapter = counts ? (chapters.has(flags.chapter) ? flags.chapter : null) : lastChapter;
  const createdAt = pageCreatedAt(page);
  const rev = pageRev(page);
  const foundry = !counts || (rev !== flags.hash);
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
    modifiedAt: foundry ? (timeOf(page._stats?.modifiedTime) ?? createdAt) : flags.modified.at,
    modifiedBy: cutText(foundry ? userName(page._stats?.lastModifiedBy, campaign) : writerName(flags.modified), MOST_NAME)[0],
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
    else data = { kind, actorId, journal: { id: entry.id, name: cutText(String(entry.name ?? ""), MOST_NAME)[0], notes: read.notes } };
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
 * their results, so they settle to nothing new.
 * @returns {void}
 */
export function registerJournalHooks() {
  for ( const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"] ) {
    Hooks.on(hook, page => journalChanged(page?.parent));
  }
  for ( const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"] ) {
    Hooks.on(hook, entry => journalChanged(entry));
  }
}

/**
 * Note that a journal of notes may have changed, and send its book once its changes settle. A
 * deleted journal's book goes with no journal, unless another claims it.
 * @param {JournalEntry|null|undefined} entry
 * @returns {void}
 */
function journalChanged(entry) {
  if ( !canSend() ) return;
  const flag = journalFlag(entry);
  if ( !flag ) return;
  const key = bookKey(flag.campaign, flag.kind, flag.actor);
  clearTimeout(settling.get(key));
  settling.set(key, setTimeout(() => {
    settling.delete(key);
    sendBook(flag.kind, flag.actor, flag.campaign);
  }, SETTLE_JOURNAL));
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
