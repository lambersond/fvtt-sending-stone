import { MODULE_ID, MOST_BOOK_TEXT, MOST_CHAPTERS, MOST_ENTRIES, MOST_NOTE_BODY, MOST_NOTE_TITLE, NOTE_BOOKS, NOTE_ID } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { checkCommand, failedResult, isId, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { accessFor, groupEntry } from "./groups.mjs";
import {
  bookActor, compareIds, flagsCount, journalFor, makeJournal, noteRev, notesOn, pageBody, pageCreatedAt, pageOwners,
  pageRev, pageRole, pageSentAs, pagesInOrder, sendBook, sharedLikeJournal, textPages
} from "./journals.mjs";

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
 * Gamemaster as no character.
 * @param {object} command
 * @returns {string|null}
 */
export function checkNoteCommand(command) {
  const note = command.note;
  const given = value => (value !== undefined) && (value !== null);
  if ( namesRollFields(command) || given(command.transfer) || given(command.remove) || given(command.typed) || !isObject(note) ) {
    return "note";
  }
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
 * Make a note command fetched from the app, once every note command before it has been made, past
 * the watchdog too, so two changes never overlap.
 * @param {object} command      `{note: {book, op, id, role, base, writer, at, …}}`, as fetched.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export function runNoteCommand(command, campaign) {
  const id = command.id;
  inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  const run = notesChain.then(() => noteNow(command, campaign)).finally(() => {
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

  // From here, Foundry's journal goes ahead of whatever is answered.
  const post = () => sendBook(kind, owner.id, campaign.id);
  const refused = (reason, error=null) => {
    post();
    return failed(reason, error);
  };
  const done = ({ deleted=false }={}) => {
    post();
    const result = {
      id: command.id, status: "done", reason: null, error: null, messageId: null, visible: false, rolls: []
    };
    return answer(result, { rev: deleted ? null : revOf(page), deleted });
  };

  let entry = journalFor(kind, owner.id, campaign.id);
  if ( op === "create" ) {
    const there = entry?.pages?.get(note.id) ?? null;
    if ( there ) {
      page = (there.type === "text") ? there : null;
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
      // the note moved if its chapter isn't the one asked.
      if ( noteRev(role, title, 2, note.markdown ?? "") === pageRev(page) ) {
        if ( (role === "entry") && (chapterOf(entry, page) !== note.chapter) ) {
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
      page = await createPage(entry, note, { gm, content, author: (kind === "party") && (role === "entry") ? writer : null });
      await sortJournal(entry);
    }
    else if ( op === "update" ) await updatePage(entry, page, note, { gm, content });
    else {
      const gone = await entry.deleteEmbeddedDocuments("JournalEntryPage", [page.id]);
      if ( !Array.from(gone ?? []).some(doc => doc?.id === page.id) ) throw new Error("A write was refused");
      page = null;
    }
  } catch (err) {
    return refused("error", messageOf(err));
  }
  return done({ deleted: op === "delete" });
}

/* -------------------------------------------- */
/*  Writes                                      */
/* -------------------------------------------- */

/**
 * Make a note's page, with the id the app chose for it, in a call of its own, so that Foundry keeps
 * when it was made and by whom; with everything it holds, its flags among them, so that nothing is
 * written after it but its place: a reload at any point leaves either no page or a whole one. A
 * party's note is owned by the players of the character who wrote it.
 * @param {JournalEntry} entry
 * @param {object} note
 * @param {object} options
 * @param {boolean} options.gm             Is it the Gamemaster's?
 * @param {string} options.content         A note's HTML.
 * @param {Actor|null} options.author      For a party's note, the character whose players own it.
 * @returns {Promise<JournalEntryPage>}
 * @throws {Error}   Where Foundry made none, or made one with another id, which is deleted again.
 */
async function createPage(entry, note, { gm, content, author }) {
  const { INHERIT } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const chapter = (note.role === "entry") ? note.chapter : null;
  const markdown = (note.role === "entry") ? note.markdown : "";
  const title = note.title.trim();
  const owners = pageOwners(author);
  const sheetClass = markdownSheet();
  const order = wantedOrder(pagesInOrder(entry), { id: note.id, role: note.role, chapter, at: note.createdAt });
  const data = {
    _id: note.id,
    name: title,
    type: "text",
    sort: sortBetween(entry, order, note.id),
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
  const made = await entry.createEmbeddedDocuments("JournalEntryPage", [data], { keepId: true });
  const page = Array.from(made ?? [])[0] ?? null;
  if ( !page ) throw new Error("A write was refused");
  if ( page.id !== note.id ) {
    // A page with another id would be a second note once the change is handed over again.
    await entry.deleteEmbeddedDocuments("JournalEntryPage", [page.id]);
    throw new Error("Foundry didn’t keep the note’s id");
  }
  return page;
}

/**
 * Change a page to what's asked, in one update: its title, its level, a note's Markdown and HTML,
 * and its flags, whole; a page first written in Foundry gains them here, with no author. A note
 * moved to another chapter is given its place there in the same update, and the journal is put in
 * order after it where it must be.
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
  const chapter = (note.role === "entry") ? note.chapter : null;
  const markdown = (note.role === "entry") ? note.markdown : "";
  const before = flagsCount(page) ? page.flags[MODULE_ID]
    : { page: page.id, role: note.role, chapter: null, author: null, createdAt: pageCreatedAt(page), granted: [] };
  const moved = (note.role === "entry") && (chapterOf(entry, page) !== chapter);
  const flags = {
    ...before, role: note.role, chapter, modified: { actor: note.writer, gm, at: note.at }, hash: noteRev(note.role, title, 2, markdown)
  };
  const changes = { name: title, "title.level": (note.role === "chapter") ? 1 : 2, [`flags.${MODULE_ID}`]: flags };
  if ( note.role === "entry" ) {
    Object.assign(changes, {
      "text.format": CONST.JOURNAL_ENTRY_PAGE_FORMATS?.MARKDOWN ?? 2, "text.markdown": markdown, "text.content": content
    });
  }
  let fits = true;
  if ( moved ) {
    const order = wantedOrder(pagesInOrder(entry), { id: page.id, role: "entry", chapter, at: pageCreatedAt(page) });
    const sort = sortBetween(entry, order, page.id, { strict: true });
    fits = sort !== null;
    if ( fits ) changes.sort = sort;
  }
  if ( !await page.update(changes) ) throw new Error("A write was refused");
  if ( moved ) await sortJournal(entry, { renumber: !fits });
}

/* -------------------------------------------- */
/*  Order in Foundry                            */
/* -------------------------------------------- */

/**
 * The chapter a page is in, as its order in Foundry would keep it: by its flag where its flags
 * count, whether or not that chapter is there yet; else the nearest chapter before it.
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
 * Every page of a journal in the order wanted (round §2.7), the journal reading in Foundry as the app
 * lists it: the notes in no chapter first, by when they were written; then each chapter, by when it
 * was, followed by its notes, by when they were; ties by id. A note whose chapter isn't there yet is
 * in none until it comes. A page first written in Foundry is in the chapter before it, by when it
 * was made; and a page that isn't text, as an image, stays after the page it follows now.
 * @param {JournalEntryPage[]} pages   The journal's pages in Foundry's order.
 * @param {{id: string, role: string, chapter: string|null, at: number}} [placed]   A page as it's
 *   about to be, made or moved.
 * @returns {string[]}
 */
function wantedOrder(pages, placed) {
  const facts = new Map();
  let chapter = null;
  for ( const page of pages ) {
    if ( page.type !== "text" ) continue;
    const role = pageRole(page);
    const counts = flagsCount(page);
    if ( role === "chapter" ) chapter = page.id;
    facts.set(page.id, {
      id: page.id, role,
      chapter: (role === "chapter") ? null : (counts ? page.flags[MODULE_ID].chapter : chapter),
      at: pageCreatedAt(page)
    });
  }
  if ( placed ) facts.set(placed.id, placed);
  const all = Array.from(facts.values());
  const chapters = all.filter(fact => fact.role === "chapter");
  const known = new Set(chapters.map(fact => fact.id));
  const byTime = (a, b) => (a.at - b.at) || compareIds(a.id, b.id);
  const under = id => all.filter(fact => (fact.role === "entry") && ((known.has(fact.chapter) ? fact.chapter : null) === id))
    .sort(byTime).map(fact => fact.id);
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
  const last = Math.max(0, ...Array.from(entry.pages.values(), page => Number(page.sort) || 0));
  return last + DENSITY;
}

/**
 * Put a journal's pages in the order wanted where Foundry's differs from it, as when a page was
 * made with no room for it, or a chapter has come that notes written before it were waiting for:
 * every page renumbered a step apart, in one call, writing only the pages whose sort changes.
 * @param {JournalEntry} entry
 * @param {object} [options]
 * @param {boolean} [options.renumber]   Renumber whatever the order.
 * @returns {Promise<void>}
 * @throws {Error}   Where Foundry wrote less than asked.
 */
async function sortJournal(entry, { renumber=false }={}) {
  const pages = pagesInOrder(entry);
  const order = wantedOrder(pages);
  if ( !renumber && order.every((id, n) => pages[n]?.id === id) ) {
    // In order, unless two pages share a sort, which Foundry may draw either way round.
    const sorts = order.map(id => Number(entry.pages.get(id)?.sort) || 0);
    if ( sorts.every((sort, n) => !n || (sort > sorts[n - 1])) ) return;
  }
  const updates = order.map((id, n) => ({ _id: id, sort: (n + 1) * DENSITY }))
    .filter(({ _id, sort }) => (Number(entry.pages.get(_id)?.sort) || 0) !== sort);
  if ( !updates.length ) return;
  const written = await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
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
