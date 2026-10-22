import {
  MODULE_ID, MOST_BOOK_TEXT, MOST_CHAPTERS, MOST_ENTRIES, MOST_NOTE_BODY, MOST_NOTE_TITLE, MOST_NOTES, NOTE_BOOKS, NOTE_ID, OWN_WRITE
} from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { checkCommand, failedResult, isId, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { accessFor, groupEntry } from "./groups.mjs";
import {
  bookActor, chaptersAsSent, compareIds, flagsCount, groupMembers, journalFor, lastFoundryEdit, makeJournal, noteRev, notesOn,
  ownWrite, pageBody, pageCreatedAt, pageOwners, pageRev, pageRole, pageSentAs, pagesInOrder, sendBook, sentChapters,
  sharedLikeJournal, textPages
} from "./journals.mjs";
import { helloPending } from "./transport.mjs";

/**
 * Journal notes changed from the Sending Stone app, since module 0.34.0: a note or chapter added to
 * a character's or a party's journal, changed, or a note deleted, by a player or their Gamemaster
 * (journals.mjs keeps the journals and reads them back).
 *
 * The app keeps every change first, Foundry open or not, and hands it over until it's answered, so
 * the same change may arrive more than once: after a reload, or a result lost on its way. Each is
 * made at most once in effect: a note's id is its page's, chosen by the app, so a create whose page
 * is there already is done; an update whose page already holds what's asked is done; a delete of a
 * page that's gone is done.
 *
 * Each change says which revision of the page it was made from. One that reaches Foundry after the
 * page was changed there is never made: Foundry's version stays, and the app keeps the player's
 * beside it for them to choose (`changed`); so does one of a page deleted there (`gone`). Everything
 * is checked before anything is written, the rights too, as the bridge may write anything: in a
 * party's journal a player changes only the notes their own character wrote, while it may see the
 * party in Foundry. A note's Markdown is converted to HTML here, as Foundry would, and cleaned, and
 * refused where it holds a level 1 or 2 heading, which only chapters and notes are.
 *
 * Changes are made one at a time, each after the last, whichever journal, past the 60 seconds after
 * which the app is told one took too long. The journal as Foundry then holds it goes ahead of each
 * result, a refusal's too, so the app has Foundry's version when it says what became of the change.
 * No note goes to chat, and no result carries a note's title or text.
 *
 * Since 0.35.0 the notes of a chapter, and those in none, keep the order Foundry holds them in: a
 * note made or moved goes last in its chapter, and anyone who may see the party puts a group's notes
 * in order from the app, which writes only where pages sit, never a note's text, title, chapter or
 * owner. An order is made as far as the group is as it was when the order was made from it: notes
 * added, deleted or moved meanwhile are merged, while the same notes reordered in Foundry meanwhile
 * keep Foundry's order (`changed`). Every write here is the module's own, so the journal never says
 * it was changed in Foundry by them.
 */

/**
 * Note pages' sorts, as Foundry spaces them (`CONST.SORT_INTEGER_DENSITY`).
 * @type {number}
 */
const DENSITY = 100_000;

/**
 * Each change's fields, exactly, by what it does and to what (round §3.4).
 * @type {Record<string, Record<string, string>>}
 */
const FIELDS = (() => {
  const base = ["book", "op", "id", "role", "base", "writer", "at"];
  const list = (...fields) => [...base, ...fields].sort().join();
  return {
    create: { chapter: list("title", "createdAt"), entry: list("title", "createdAt", "markdown", "chapter") },
    update: { chapter: list("title"), entry: list("title", "markdown", "chapter") },
    delete: { chapter: list(), entry: list() }
  };
})();

/**
 * An order's fields, exactly, since 0.35.0 (round 0.35.0 §3.4).
 * @type {string}
 */
const ORDER_FIELDS = ["at", "book", "chapter", "ids", "op", "was", "writer"].sort().join();

/**
 * How often a result waiting for its campaign's hello looks again, in milliseconds.
 * @type {number}
 */
const HELLO_LOOK = 100;

/**
 * The latest note command, which the next waits for, whichever journal.
 * @type {Promise<void>}
 */
let notesChain = Promise.resolve();

/**
 * The note commands being made, by id, with how many runs of each are under way.
 * @type {Map<string, number>}
 */
const inFlight = new Map();

/* -------------------------------------------- */

/**
 * Why a fetched note command isn't one to make, if it isn't (round §3.4): it names a book, what's
 * done, a note by id, a chapter or a note, the revision it was made from, who wrote it and when,
 * and for a new or changed one its title and, for a note, its Markdown and chapter; exactly those,
 * nothing a roll names, no move, removal or typed dice, and it throws no dice. A chapter is never
 * deleted from the app. A player writes only as their own character in its own journal; the
 * Gamemaster as no character. Since 0.35.0 an order of a group's notes: the book, the group, its
 * notes' ids in the new order and in the order it was made from, who and when; nothing else.
 * @param {object} command
 * @returns {string|null}
 */
export function checkNoteCommand(command) {
  const note = command.note;
  const given = value => (value !== undefined) && (value !== null);
  if ( namesRollFields(command) || given(command.transfer) || given(command.remove) || given(command.typed) || !isObject(note) ) {
    return "note";
  }
  if ( note.op === "order" ) return checkOrder(command, note);
  if ( !NOTE_BOOKS.includes(note.book) || !Object.hasOwn(FIELDS, note.op) || !["chapter", "entry"].includes(note.role) ) return "note";
  if ( Object.keys(note).sort().join() !== FIELDS[note.op][note.role] ) return "note";
  if ( !isNoteId(note.id) || ((note.op === "delete") && (note.role === "chapter")) ) return "note";
  if ( note.op !== "delete" ) {
    const title = (typeof note.title === "string") ? note.title.trim() : "";
    if ( !title || (title.length > MOST_NOTE_TITLE) || /[\r\n]/.test(title) ) return "title";
    if ( note.role === "entry" ) {
      if ( (typeof note.markdown !== "string") || (note.markdown.length > MOST_NOTE_BODY) ) return "body";
      if ( (note.chapter !== null) && !isNoteId(note.chapter) ) return "chapter";
    }
  }
  if ( (note.op === "create") ? (note.base !== null) : !((typeof note.base === "string") && /^[0-9a-f]{14}$/.test(note.base)) ) {
    return "base";
  }
  const gm = command.by === "gm";
  if ( (note.writer === null) ? !gm : !isId(note.writer) ) return "writer";
  if ( !gm && (note.book === "personal") && (note.writer !== command.actorId) ) return "writer";
  const positive = value => Number.isInteger(value) && (value > 0);
  if ( !positive(note.at) || ((note.op === "create") && !positive(note.createdAt)) ) return "note";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Why an order of a group's notes isn't one to make, if it isn't (round 0.35.0 §6.3): exactly its
 * fields; the group, a chapter's id or null for the notes in none; the group's notes in the new
 * order, 1 to 400 distinct ids, and in the order it was made from, 0 to 400 (a sent journal holds at
 * most 400, though the app adds at most 300 entries, so a group written in Foundry may hold more);
 * who and when, as a note's; and no dice.
 * @param {object} command
 * @param {object} note
 * @returns {string|null}
 */
function checkOrder(command, note) {
  if ( !NOTE_BOOKS.includes(note.book) || (Object.keys(note).sort().join() !== ORDER_FIELDS) ) return "note";
  if ( (note.chapter !== null) && !isNoteId(note.chapter) ) return "chapter";
  const ids = (list, least) => Array.isArray(list) && (list.length >= least) && (list.length <= MOST_NOTES)
    && list.every(isNoteId) && (new Set(list).size === list.length);
  if ( !ids(note.ids, 1) || !ids(note.was, 0) ) return "note";
  const gm = command.by === "gm";
  if ( (note.writer === null) ? !gm : !isId(note.writer) ) return "writer";
  if ( !gm && (note.book === "personal") && (note.writer !== command.actorId) ) return "writer";
  if ( !(Number.isInteger(note.at) && (note.at > 0)) ) return "note";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Make a note command fetched from the app, once every note command before it has been made, past
 * the watchdog too, so two changes never overlap: a change of a note or chapter, or since 0.35.0 an
 * order of a group's notes.
 * @param {object} command      `{note: {book, op, id, role, base, writer, at, …}}`, or `{note: {book,
 *                              op: "order", chapter, ids, was, writer, at}}`, as fetched.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export function runNoteCommand(command, campaign) {
  const id = command.id;
  inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  const making = () => ((command.note?.op === "order") ? orderNow(command, campaign) : noteNow(command, campaign));
  const run = notesChain.then(making).finally(() => {
    const left = (inFlight.get(id) ?? 1) - 1;
    if ( left > 0 ) inFlight.set(id, left);
    else inFlight.delete(id);
  });
  notesChain = run.then(() => {}, () => {});
  return run;
}

/**
 * Is a note command with this id being made now, from when it's taken until its run settles? Its
 * making starts once the note commands of its journal before it are made, and lasts until its writes
 * end, however long after the app was told it took too long: a hand-over of it meanwhile is the same
 * change, which this run answers.
 * @param {string} commandId
 * @returns {boolean}
 */
export function noteInFlight(commandId) {
  return inFlight.has(commandId);
}

/* -------------------------------------------- */

/**
 * Make a change to a note now, if it may be made: every check before any write (round §7.4), the
 * journal and the page as Foundry now holds them; then the one write; then the book, as Foundry then
 * holds it, ahead of the result. A refusal once the journal is looked for posts the book first too.
 * @param {object} command
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
async function noteNow(command, passed) {
  const note = isObject(command.note) ? command.note : {};
  let page = null;
  const answer = (result, { rev=null, deleted=false }={}) => (isNoteId(note.id)
    ? { ...result, note: { id: note.id, rev, ...(deleted && { deleted: true }) } } : result);
  const revOf = found => ((found && sharedLikeJournal(found)) ? pageRev(found) : null);
  const failed = (reason, error=null) => answer(failedResult(command, reason, error), { rev: revOf(page) });

  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !notesOn() ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const { book: kind, op, role } = note;
  const owner = bookActor(kind, command.actorId, campaign);
  if ( !owner ) return failed("unknown");
  if ( (kind === "party") && !Object.keys(groupEntry(owner, campaign).access).length ) return failed("private");
  const gm = command.by === "gm";
  let writer = null;
  if ( !gm ) {
    writer = (kind === "personal") ? owner : bookActor("personal", note.writer, campaign);
    if ( !writer ) return failed("unknown");
    if ( (kind === "party") && !accessFor(owner, writer) ) return failed("not-member");
  }

  // From here, Foundry's journal goes ahead of whatever is answered. No book is sent while the
  // campaign's hello is on its way, as when a change that waited for the Gamemaster is fetched as
  // they come back, before the hello is answered: the books follow the hello, so the result waits
  // for it, and then for this book, to come after them.
  const post = async () => {
    while ( helloPending(campaign.id) ) await new Promise(resolve => setTimeout(resolve, HELLO_LOOK));
    sendBook(kind, owner.id, campaign.id);
  };
  const refused = async (reason, error=null) => {
    await post();
    return failed(reason, error);
  };
  const done = async ({ deleted=false }={}) => {
    await post();
    const result = {
      id: command.id, status: "done", reason: null, error: null, messageId: null, visible: false, rolls: []
    };
    return answer(result, { rev: deleted ? null : revOf(page), deleted });
  };

  let entry = journalFor(kind, owner.id, campaign.id);
  if ( op === "create" ) {
    const there = entry?.pages?.get(note.id) ?? null;
    if ( there ) {
      // Made already, as when the same create is handed over again; but a page of this id the app
      // isn't sent, as one the Gamemaster has hidden since, is gone to it, as a change of it is: a
      // note the player adds again is never taken as made there, which would lose it.
      if ( (there.type !== "text") || !sharedLikeJournal(there) ) return refused("gone");
      page = there;
      return done();
    }
  } else {
    const found = entry?.pages?.get(note.id) ?? null;
    page = (found?.type === "text") ? found : null;
    const shared = Boolean(page) && sharedLikeJournal(page);
    if ( !shared ) {
      if ( op === "delete" ) {
        page = null;
        return done({ deleted: true });
      }
      page = null;
      return refused("gone");
    }
    if ( pageRole(page) !== role ) return refused("changed");
    if ( !gm && (kind === "party") && (role === "entry") ) {
      const author = flagsCount(page) ? page.flags[MODULE_ID].author : null;
      if ( author?.actor !== writer.id ) return refused("not-yours");
    }
    if ( (op === "update") && (role === "entry") ) {
      const sent = pageSentAs(page);
      if ( (sent.format === 1) || sent.cut || (sent.body.length > MOST_NOTE_BODY) ) return refused("foundry-only");
    }
    if ( op === "update" ) {
      const title = note.title.trim();
      // Already what's asked, as when the same change is handed over again after it was made: done,
      // the note moved if the chapter asked isn't the one it was sent in.
      if ( noteRev(role, title, 2, note.markdown ?? "") === pageRev(page) ) {
        if ( (role === "entry") && (shownIn(entry, page) !== note.chapter) ) {
          try {
            await updatePage(entry, page, note, { gm, content: page.text?.content ?? "" });
          } catch (err) {
            return refused("error", messageOf(err));
          }
        }
        return done();
      }
    }
    if ( note.base !== pageRev(page) ) return refused("changed");
  }

  // What the journal may hold.
  const pages = entry ? textPages(entry) : [];
  const text = pages.reduce((sum, other) => sum + pageBody(other).length, 0);
  if ( op === "create" ) {
    const most = (role === "chapter") ? MOST_CHAPTERS : MOST_ENTRIES;
    if ( pages.filter(other => pageRole(other) === role).length >= most ) return refused("full");
    if ( text + (note.markdown?.length ?? 0) > MOST_BOOK_TEXT ) return refused("full");
  }
  else if ( (op === "update") && (role === "entry") && (text - pageBody(page).length + note.markdown.length > MOST_BOOK_TEXT) ) {
    return refused("full");
  }

  // A note's HTML, as Foundry would convert and clean it: never a player's raw HTML written as the
  // Gamemaster, whose writes Foundry may trust further than the player's own.
  let content = "";
  if ( (role === "entry") && (op !== "delete") ) {
    const converter = markdownConverter();
    if ( !converter ) return refused("error", "Foundry’s Markdown converter wasn’t found");
    const clean = foundry.utils?.cleanHTML;
    if ( typeof clean !== "function" ) return refused("error", "Foundry’s HTML cleaner wasn’t found");
    content = String(await clean(converter.makeHtml(note.markdown)) ?? "");
    if ( new DOMParser().parseFromString(content, "text/html").querySelector("h1, h2") ) return refused("headings");
  }

  try {
    if ( op === "create" ) {
      entry ??= await makeJournal(kind, owner, campaign);
      let renumber;
      ({ page, renumber } = await createPage(entry, note, { gm, content, author: (kind === "party") && (role === "entry") ? writer : null }));
      await sortJournal(entry, { renumber });
    }
    else if ( op === "update" ) await updatePage(entry, page, note, { gm, content });
    else {
      const id = page.id;
      const gone = await ownWrite([id], () => entry.deleteEmbeddedDocuments("JournalEntryPage", [id], { ...OWN_WRITE }));
      if ( !Array.from(gone ?? []).some(doc => doc?.id === id) ) throw new Error("A write was refused");
      page = null;
    }
  } catch (err) {
    return refused("error", messageOf(err));
  }
  return done({ deleted: op === "delete" });
}

/**
 * Make an order of a group's notes now, if it may be made (round 0.35.0 §6.4): every check before
 * any write, as Foundry now holds the journal, as for a note's change but with no author's, as an
 * order writes only where pages sit; then the one write, and the book, as Foundry then holds it,
 * ahead of the result. A refusal once the group is found, and the result, say the group's order in
 * Foundry then.
 *
 * The group is its notes as the app is sent them, in Foundry's order. The notes the order lists
 * that are still in it take its order, and the rest follow in Foundry's; one it lists that isn't
 * there now is left out. Where Foundry holds the group as the order would make it already, as far as
 * its chapters allow, as when the same order is handed over again after it was made, it's done,
 * writing nothing. Otherwise, where the notes it was made from that are still in the group are in
 * another order in Foundry than it was made from, someone reordered them there meanwhile, and
 * Foundry's order stays (`changed`): notes added, deleted or moved meanwhile don't refuse it.
 * @param {object} command
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
async function orderNow(command, passed) {
  const note = isObject(command.note) ? command.note : {};
  let entry = null;
  let found = false;
  const answer = result => (found ? { ...result, order: { chapter: note.chapter, ids: groupMembers(entry, note.chapter) } } : result);

  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !notesOn() ) return failedResult(command, "off");
  const invalid = checkCommand(command);
  if ( invalid ) return failedResult(command, "invalid", invalid);
  const kind = note.book;
  const owner = bookActor(kind, command.actorId, campaign);
  if ( !owner ) return failedResult(command, "unknown");
  if ( (kind === "party") && !Object.keys(groupEntry(owner, campaign).access).length ) return failedResult(command, "private");
  if ( command.by !== "gm" ) {
    const writer = (kind === "personal") ? owner : bookActor("personal", note.writer, campaign);
    if ( !writer ) return failedResult(command, "unknown");
    if ( (kind === "party") && !accessFor(owner, writer) ) return failedResult(command, "not-member");
  }

  // From here, Foundry's journal goes ahead of whatever is answered, as for a note's change.
  const post = async () => {
    while ( helloPending(campaign.id) ) await new Promise(resolve => setTimeout(resolve, HELLO_LOOK));
    sendBook(kind, owner.id, campaign.id);
  };
  const refused = async (reason, error=null) => {
    await post();
    return answer(failedResult(command, reason, error));
  };

  entry = journalFor(kind, owner.id, campaign.id);
  if ( !entry || ((note.chapter !== null) && !sentChapters(entry).has(note.chapter)) ) return refused("gone");
  found = true;
  const group = groupMembers(entry, note.chapter);
  const members = new Set(group);
  const asked = note.ids.filter(id => members.has(id));
  const listed = new Set(asked);
  const wanted = [...asked, ...group.filter(id => !listed.has(id))];
  // The group as the order would make it, which isn't the order asked where a chapter only the
  // Gamemaster sees falls between its notes: compared with that, an order made that far and handed
  // over again is done, never taken for a reorder made in Foundry since its `was`.
  const ranks = new Map(wanted.map((id, n) => [id, n]));
  const asMade = wantedOrder(pagesInOrder(entry), { ranks }).filter(id => members.has(id));
  if ( !asMade.every((id, n) => id === group[n]) ) {
    const was = new Set(note.was);
    const before = note.was.filter(id => members.has(id));
    const now = group.filter(id => was.has(id));
    if ( !before.every((id, n) => id === now[n]) ) return refused("changed");
    try {
      await sortJournal(entry, { ranks });
    } catch (err) {
      return refused("error", messageOf(err));
    }
  }
  await post();
  return answer({ id: command.id, status: "done", reason: null, error: null, messageId: null, visible: false, rolls: [] });
}

/* -------------------------------------------- */
/*  Writes                                      */
/* -------------------------------------------- */

/**
 * Make a note's page, with the id the app chose for it, in a call of its own, so that Foundry keeps
 * when it was made and by whom; with everything it holds, its flags among them, so that nothing is
 * written after it but its place: a reload at any point leaves either no page or a whole one. A
 * party's note is owned by the players of the character who wrote it. A note goes last in its
 * chapter, or in none, and a chapter among the chapters by when it was written; where no whole
 * number fits there, at the journal's end, to be renumbered once it's made.
 * @param {JournalEntry} entry
 * @param {object} note
 * @param {object} options
 * @param {boolean} options.gm             Is it the Gamemaster's?
 * @param {string} options.content         A note's HTML.
 * @param {Actor|null} options.author      For a party's note, the character whose players own it.
 * @returns {Promise<{page: JournalEntryPage, renumber: boolean}>}   The page, and whether the
 *   journal must be renumbered to put it in its place.
 * @throws {Error}   Where Foundry made none, or made one with another id, which is deleted again.
 */
async function createPage(entry, note, { gm, content, author }) {
  const { INHERIT } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const chapter = (note.role === "entry") ? note.chapter : null;
  const markdown = (note.role === "entry") ? note.markdown : "";
  const title = note.title.trim();
  const owners = pageOwners(author);
  const sheetClass = markdownSheet();
  const order = wantedOrder(pagesInOrder(entry), { placed: { id: note.id, role: note.role, chapter, at: note.createdAt } });
  const sort = sortBetween(entry, order, note.id, { strict: true });
  const data = {
    _id: note.id,
    name: title,
    type: "text",
    sort: sort ?? (journalEnd(entry) + DENSITY),
    title: { show: true, level: (note.role === "chapter") ? 1 : 2 },
    text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.MARKDOWN ?? 2, markdown, content: (note.role === "entry") ? content : "" },
    ownership: { default: INHERIT, ...Object.fromEntries(owners) },
    flags: {
      ...(sheetClass && { core: { sheetClass } }),
      [MODULE_ID]: {
        page: note.id,
        role: note.role,
        chapter,
        author: { actor: note.writer, gm },
        createdAt: note.createdAt,
        modified: { actor: note.writer, gm, at: note.at },
        hash: noteRev(note.role, title, 2, markdown),
        granted: [...owners.keys()]
      }
    }
  };
  const made = await ownWrite([note.id], () => entry.createEmbeddedDocuments("JournalEntryPage", [data], { keepId: true, ...OWN_WRITE }));
  const page = Array.from(made ?? [])[0] ?? null;
  if ( !page ) throw new Error("A write was refused");
  if ( page.id !== note.id ) {
    // A page with another id would be a second note once the change is handed over again.
    await ownWrite([page.id], () => entry.deleteEmbeddedDocuments("JournalEntryPage", [page.id], { ...OWN_WRITE }));
    throw new Error("Foundry didn’t keep the note’s id");
  }
  return { page, renumber: sort === null };
}

/**
 * Change a page to what's asked, in one update: its title, its level, a note's Markdown and HTML,
 * and its flags, whole; a page first written in Foundry gains them here, with no author. A note
 * moved to another chapter than the one the app was shown it in is given its place there, last, in
 * the same update, and the journal is put in order after it where it must be, the note still last
 * where there was no room for it; a note a page that isn't text follows, as an image, is put there
 * by that sort alone, so the page goes with it. One that isn't moved stays in the chapter it's in,
 * by its flag or its place, though that may be one the app isn't shown.
 * @param {JournalEntry} entry
 * @param {JournalEntryPage} page
 * @param {object} note
 * @param {object} options
 * @param {boolean} options.gm
 * @param {string} options.content   A note's HTML.
 * @returns {Promise<void>}
 * @throws {Error}   Where Foundry wrote nothing.
 */
async function updatePage(entry, page, note, { gm, content }) {
  const title = note.title.trim();
  const moved = (note.role === "entry") && (shownIn(entry, page) !== note.chapter);
  const chapter = (note.role !== "entry") ? null : (moved ? note.chapter : chapterOf(entry, page));
  const markdown = (note.role === "entry") ? note.markdown : "";
  const before = flagsCount(page) ? page.flags[MODULE_ID]
    : { page: page.id, role: note.role, chapter: null, author: null, createdAt: pageCreatedAt(page), granted: [] };
  // What the app writes is the last change, so who changed it in Foundry before is kept no longer.
  const flags = {
    ...before, role: note.role, chapter, modified: { actor: note.writer, gm, at: note.at }, hash: noteRev(note.role, title, 2, markdown),
    foundry: null
  };
  const changes = { name: title, "title.level": (note.role === "chapter") ? 1 : 2, [`flags.${MODULE_ID}`]: flags };
  if ( note.role === "entry" ) {
    Object.assign(changes, {
      "text.format": CONST.JOURNAL_ENTRY_PAGE_FORMATS?.MARKDOWN ?? 2, "text.markdown": markdown, "text.content": content
    });
  }
  let fits = true;
  let placed = null;
  if ( moved ) {
    placed = { id: page.id, role: "entry", chapter, at: pageCreatedAt(page) };
    // A page that isn't text and follows the note goes with it, which a place of the note's own
    // would leave behind, under the chapter the note leaves: the note keeps its place in this
    // update, and the sort after it moves the two together.
    if ( !followed(entry, page) ) {
      const sort = sortBetween(entry, wantedOrder(pagesInOrder(entry), { placed }), page.id, { strict: true });
      fits = sort !== null;
      if ( fits ) changes.sort = sort;
    }
  }
  if ( !await ownWrite([page.id], () => page.update(changes, { ...OWN_WRITE })) ) throw new Error("A write was refused");
  // With no room, or a page following it, the note keeps its old place until the journal is put in
  // order, which must still put it last in its new chapter, not where its old place would rank it
  // there.
  if ( moved ) await sortJournal(entry, { renumber: !fits, placed });
}

/* -------------------------------------------- */
/*  Order in Foundry                            */
/* -------------------------------------------- */

/**
 * The chapter a page is in, as its order in Foundry would keep it: by its flag where its flags
 * count, whether or not that chapter is there yet; else the nearest chapter before it, whoever may
 * see it.
 * @param {JournalEntry} entry
 * @param {JournalEntryPage} page
 * @returns {string|null}
 */
function chapterOf(entry, page) {
  if ( flagsCount(page) ) return page.flags[MODULE_ID].chapter;
  let chapter = null;
  for ( const other of textPages(entry) ) {
    if ( other.id === page.id ) return chapter;
    if ( pageRole(other) === "chapter" ) chapter = other.id;
  }
  return chapter;
}

/**
 * The chapter an entry was sent to the app in, which a change of it from the app names again where
 * it isn't moving it (`chaptersAsSent`).
 * @param {JournalEntry} entry
 * @param {JournalEntryPage} page
 * @returns {string|null}
 */
function shownIn(entry, page) {
  return chaptersAsSent(entry).get(page.id) ?? null;
}

/**
 * Does a page that isn't text, as an image, follow this one in Foundry's order? It stays after the
 * page it follows (`wantedOrder`), so it goes wherever that one goes.
 * @param {JournalEntry} entry
 * @param {JournalEntryPage} page
 * @returns {boolean}
 */
function followed(entry, page) {
  const pages = pagesInOrder(entry);
  const at = pages.findIndex(other => other.id === page.id);
  return (at >= 0) && ((pages[at + 1]?.type ?? "text") !== "text");
}

/**
 * Every page of a journal in the order wanted (round 0.35.0 §2.3), the journal reading in Foundry as
 * the app lists it: the notes in no chapter first, then each chapter by when it was written,
 * followed by its notes; each group's notes in the order Foundry holds them now, a page being made
 * or moved last in its group, and a group being ordered in the order asked, in the slots its notes
 * hold now; chapters' ties by id. A note whose chapter isn't there yet is in none until it comes. A
 * page first written in Foundry is in the chapter before it; and a page that isn't text, as an
 * image, stays after the page it follows now.
 * @param {JournalEntryPage[]} pages   The journal's pages in Foundry's order.
 * @param {object} [options]
 * @param {{id: string, role: string, chapter: string|null, at: number}} [options.placed]   A page as
 *   it's about to be, made or moved.
 * @param {Map<string, number>} [options.ranks]   An order asked of a group's notes: each note's place
 *   in it. Each of the module's groups puts the notes it ranks in that order, in their own slots, so
 *   that no page changes chapter.
 * @returns {string[]}
 */
function wantedOrder(pages, { placed, ranks }={}) {
  const facts = new Map();
  let chapter = null;
  pages.forEach((page, index) => {
    if ( page.type !== "text" ) return;
    const role = pageRole(page);
    const counts = flagsCount(page);
    if ( role === "chapter" ) chapter = page.id;
    facts.set(page.id, {
      id: page.id, role,
      chapter: (role === "chapter") ? null : (counts ? page.flags[MODULE_ID].chapter : chapter),
      at: pageCreatedAt(page),
      index
    });
  });
  if ( placed ) facts.set(placed.id, { ...placed, index: Infinity });
  const all = Array.from(facts.values());
  const chapters = all.filter(fact => fact.role === "chapter");
  const known = new Set(chapters.map(fact => fact.id));
  const byTime = (a, b) => (a.at - b.at) || compareIds(a.id, b.id);
  const byPlace = (a, b) => (a.index - b.index) || compareIds(a.id, b.id);
  const under = id => {
    const group = all.filter(fact => (fact.role === "entry") && ((known.has(fact.chapter) ? fact.chapter : null) === id))
      .sort(byPlace).map(fact => fact.id);
    if ( !ranks ) return group;
    const ranked = group.filter(other => ranks.has(other)).sort((a, b) => ranks.get(a) - ranks.get(b));
    return group.map(other => (ranks.has(other) ? ranked.shift() : other));
  };
  const notes = [...under(null), ...chapters.sort(byTime).flatMap(fact => [fact.id, ...under(fact.id)])];

  // Pages that aren't notes, after the note page they follow now.
  const after = new Map();
  let last = null;
  for ( const page of pages ) {
    if ( facts.has(page.id) ) last = page.id;
    else after.set(last, [...(after.get(last) ?? []), page.id]);
  }
  return [...(after.get(null) ?? []), ...notes.flatMap(id => [id, ...(after.get(id) ?? [])])];
}

/**
 * A page's sort midway between the pages it falls between in the order wanted; after the last, or
 * before the first, a step on. Where no whole number fits between them, the end of the journal, to
 * be renumbered once it's made; or with `strict`, null.
 * @param {JournalEntry} entry
 * @param {string[]} order   The order wanted, the page in it.
 * @param {string} id
 * @param {object} [options]
 * @param {boolean} [options.strict]
 * @returns {number|null}
 */
function sortBetween(entry, order, id, { strict=false }={}) {
  const sortOf = other => Number(entry.pages.get(other)?.sort) || 0;
  const at = order.indexOf(id);
  const before = (at > 0) ? sortOf(order[at - 1]) : null;
  const after = (at < order.length - 1) ? sortOf(order[at + 1]) : null;
  if ( (before === null) && (after === null) ) return DENSITY;
  if ( before === null ) return after - DENSITY;
  if ( after === null ) return before + DENSITY;
  const middle = Math.floor((before + after) / 2);
  if ( (middle > before) && (middle < after) ) return middle;
  if ( strict ) return null;
  return journalEnd(entry) + DENSITY;
}

/**
 * The largest sort of a journal's pages, 0 for none.
 * @param {JournalEntry} entry
 * @returns {number}
 */
function journalEnd(entry) {
  return Math.max(0, ...Array.from(entry.pages.values(), page => Number(page.sort) || 0));
}

/**
 * Put a journal's pages in the order wanted where Foundry's differs from it, as when a page was
 * made with no room for it, a chapter has come that notes written before it were waiting for, or a
 * group's notes are being put in an order asked: in one call, writing only the pages whose sort
 * changes. Where Foundry's sorts strictly increase, each page wanted at a place takes the sort of the
 * page there now, so only the pages whose place changes are written; otherwise, or where asked,
 * every page is renumbered a step apart.
 * @param {JournalEntry} entry
 * @param {object} [options]
 * @param {boolean} [options.renumber]                 Renumber whatever the order.
 * @param {Map<string, number>} [options.ranks]        An order asked of a group's notes (`wantedOrder`).
 * @param {object} [options.placed]                    A page just moved, which goes last in its group.
 * @returns {Promise<void>}
 * @throws {Error}   Where Foundry wrote less than asked.
 */
async function sortJournal(entry, { renumber=false, ranks, placed }={}) {
  const pages = pagesInOrder(entry);
  const order = wantedOrder(pages, { ranks, placed });
  // In order, unless two pages share a sort, which Foundry may draw either way round.
  const sorts = pages.map(page => Number(page.sort) || 0);
  const rising = sorts.every((sort, n) => !n || (sort > sorts[n - 1]));
  if ( !renumber && rising && order.every((id, n) => pages[n]?.id === id) ) return;
  // A note changed in Foundry keeps who changed it there, which a write of its place alone would
  // make the Gamemaster's, now.
  const reuse = !renumber && rising;
  const updates = order.map((id, n) => ({ _id: id, sort: reuse ? sorts[n] : (n + 1) * DENSITY }))
    .filter(({ _id, sort }) => (Number(entry.pages.get(_id)?.sort) || 0) !== sort)
    .map(update => {
      const edit = lastFoundryEdit(entry.pages.get(update._id));
      return edit ? { ...update, [`flags.${MODULE_ID}.foundry`]: edit } : update;
    });
  if ( !updates.length ) return;
  const written = await ownWrite(updates.map(update => update._id),
    () => entry.updateEmbeddedDocuments("JournalEntryPage", updates, { ...OWN_WRITE }));
  if ( Array.from(written ?? []).length < updates.length ) throw new Error("A write was refused");
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Foundry's own Markdown converter, as its text pages use it; else one made with Foundry's options
 * from the showdown Foundry carries; else none.
 * @returns {{makeHtml: (markdown: string) => string}|null}
 */
function markdownConverter() {
  try {
    const own = foundry.applications?.sheets?.journal?.JournalEntryPageTextSheet?._converter;
    if ( typeof own?.makeHtml === "function" ) return own;
  } catch {
    // Not where Foundry 13 and 14 keep it: showdown's own is made instead.
  }
  if ( typeof globalThis.showdown?.Converter !== "function" ) return null;
  return new globalThis.showdown.Converter({ ...(CONST.SHOWDOWN_OPTIONS ?? {}) });
}

/**
 * The id of Foundry's Markdown sheet for text pages, as it's registered here, so that a note opens
 * in the editor it's written for; none where it isn't found.
 * @returns {string|null}
 */
function markdownSheet() {
  const sheets = CONFIG.JournalEntryPage?.sheetClasses?.text ?? {};
  for ( const [id, sheet] of Object.entries(sheets) ) {
    if ( sheet?.cls?.name === "JournalEntryPageMarkdownSheet" ) return id;
  }
  return null;
}

/**
 * Is this a note's id: 16 letters and digits?
 * @param {unknown} value
 * @returns {boolean}
 */
function isNoteId(value) {
  return (typeof value === "string") && NOTE_ID.test(value);
}

/**
 * What went wrong, in words.
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  return (err instanceof Error) ? err.message : String(err);
}
