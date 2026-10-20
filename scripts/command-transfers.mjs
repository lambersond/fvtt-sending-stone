import { MOST_AMONG, MOST_MOVED, MOST_MOVED_ITEMS, TRANSFER_KINDS } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { postLine } from "./command-charges.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import {
  checkCommand, failedResult, isId, isObject, namesRollFields, throwsNoDice, visibleTo
} from "./command-rolls.mjs";
import { accessFor, campaignGroups, campaignMembers } from "./groups.mjs";
import { hidesContents, inventoryTypes, listedInSheet } from "./sheet-inventory.mjs";
import { localize } from "./sheet-values.mjs";

/**
 * Moving items and coins from the Sending Stone app, since module 0.31.0: a player taking from a
 * party of the campaign's, giving to one, or giving to another of its characters, as they would by
 * dragging between sheets in Foundry; and the campaign's Gamemaster moving anything between its
 * characters and parties. Each move posts a line in chat, as the character who moved it, for
 * everyone, such as "Takes 2 Potion of Healing from The Iron Company".
 *
 * Who may move what is checked here, as the bridge, a Gamemaster's browser, may write anything: a
 * player only from their own character, or into it from a party, and with a party only one their
 * Foundry user owns, by the same rule as the hello's `access` (groups.mjs). A character they give
 * to needs nothing of them. Only items the app's sheet lists may be named: never one in a container
 * that hides what it holds, which the player can't see.
 *
 * An item moves as dnd5e's drop moves it, as a copy, unequipped and unattuned, with its uses,
 * effects and source, and a container with all it holds; part of a stack is split here, as dnd5e
 * has no split between actors. A consumable joins a stack of the same source and name, as dnd5e
 * stacks one, but never an unidentified one, one with uses spent, or one enchanted, which would
 * lose what it is. Coins are never moved with dnd5e's Award, which caps what it moves without
 * saying so, and writes the giver last from what it read first: only the coins moved are written,
 * each from what the actor holds, so dnd5e 6's fractions stay.
 *
 * Everything is checked before anything is written. Then coins go first, taken from the giver
 * before they're added to the receiver; then each item, a part taken from the giver's stack before
 * it's added, a whole item copied before the original and all it holds are deleted, in one go, as
 * deleting first would end what depends on it. A write that fails puts back what it can and moves
 * nothing more; so does one a module's hook refuses, which Foundry leaves out without a word, as
 * coins taken that were never added, or a container copied without some of what it held. A browser
 * closed between two writes can leave a whole item on both sides, or a part or coins on neither: the
 * sheets show it.
 *
 * Moves are made one at a time, each after the last one's writes, whoever made them, so two players
 * taking the last potion never both get it: the second finds it gone. That holds even past the 60
 * seconds after which the app is told a move took too long, as the queues commands.mjs keeps for
 * each character are let go then. A move whose writes never end holds the next until the page is
 * reloaded.
 *
 * The app is told what moved and its new ids, never a name, nor what a container held; the sheets go
 * ahead of it.
 *
 * Since 0.32.0 a party's things may be sent elsewhere by a player whose character's users own it: to
 * any of the campaign's characters, or to another of its parties they own too, made as their
 * character, whether or not it's one of the ends, with the line "Sends 2 gp from The Iron Company
 * to Vex"; and the Gamemaster may send anything anywhere, party to party too. A character's things
 * are still moved only as that character or the one they go to. And a party's coin of one kind may
 * be distributed among its members that are the campaign's characters, a whole share each, what's
 * left staying with the party, which the line says: "Distributes 100 gp among Bram, Lia, Thorin,
 * and Vex (25 gp each); 3 gp stays with The Iron Company".
 */

/**
 * The resets dnd5e's drop makes, of what a copy mustn't keep (D5 base-actor-sheet.mjs:1925-1928):
 * here made of everything moved, a container's contents too.
 * @type {readonly string[]}
 */
const RESET = Object.freeze(["attuned", "equipped", "prepared", "crew.value"]);

/**
 * The fields a move names what it moves by; since 0.32.0, `among` for a distribution, in place of
 * `to`.
 * @type {ReadonlySet<string>}
 */
const FIELDS = Object.freeze(new Set(["from", "to", "items", "currency", "among"]));

/**
 * The campaigns whose app takes moves, by id, as their latest answer to a hello or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * The latest move, which the next waits for.
 * @type {Promise<void>}
 */
let chain = Promise.resolve();

/* -------------------------------------------- */
/*  Whether moves are made here                 */
/* -------------------------------------------- */

/**
 * May a campaign's players move items and coins from the app here: its Gamemaster lets them, under
 * D&D Fifth Edition? Apart from its rolls, and from the dice self-test: a move throws no dice.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function transfersOn(campaign) {
  return (campaign.transfers === true) && (game.system?.id === "dnd5e");
}

/**
 * What a campaign tells the app of moving items and coins in its hello, beside its rolls: whether
 * moves are made here, and if not, why not, the Gamemaster not letting its players, or another
 * system. Since 0.32.0, wherever they're made, that a party's things may be sent elsewhere by its
 * Owner, party to party too (`partySends`), and a party's coin distributed among its characters
 * (`distribute`).
 * @param {Campaign} campaign
 * @returns {{enabled: boolean, kinds: string[], reason: "off"|"system"|null, partySends: boolean,
 *   distribute: boolean}}
 */
export function transferFeatures(campaign) {
  if ( campaign.transfers !== true ) {
    return { enabled: false, kinds: [], reason: "off", partySends: false, distribute: false };
  }
  if ( game.system?.id !== "dnd5e" ) {
    return { enabled: false, kinds: [], reason: "system", partySends: false, distribute: false };
  }
  return { enabled: true, kinds: [...TRANSFER_KINDS], reason: null, partySends: true, distribute: true };
}

/**
 * Note whether a campaign's app takes moves, from what it said in answer to its hello or heartbeat:
 * `features.transfers`, the format it reads, 1 or later. One that says nothing of them, as an older
 * or rolled back app, is fetched from for them no longer.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {void}
 */
export function noteTransferReader(campaignId, features) {
  const format = features?.transfers;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
}

/**
 * Does a campaign's app take moves?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function transferReader(campaignId) {
  return readers.has(campaignId);
}

/* -------------------------------------------- */
/*  The command                                 */
/* -------------------------------------------- */

/**
 * Why a fetched move isn't one to make, if it isn't: it names its two ends, which differ, and what
 * moves, items by id with how many of each, each once, and coins by their keys with how many; at
 * least one of them, and nothing a roll names, and throws no dice. Since 0.32.0 a distribution names
 * the characters it shares among in place of the end it goes to: from one to MOST_AMONG of them,
 * each once, never the party itself, and coins of one kind alone, no items.
 * @param {object} command
 * @returns {string|null}
 */
export function checkTransferCommand(command) {
  const transfer = command.transfer;
  const given = value => (value !== undefined) && (value !== null);
  if ( namesRollFields(command) || !isObject(transfer) ) return "transfer";
  if ( Object.keys(transfer).some(key => !FIELDS.has(key)) ) return "transfer";
  if ( !isId(transfer.from) ) return "transfer";
  if ( given(transfer.to) === given(transfer.among) ) return "transfer";
  if ( given(transfer.to) ) {
    if ( !isId(transfer.to) || (transfer.from === transfer.to) ) return "transfer";
    if ( !given(transfer.items) && !given(transfer.currency) ) return "transfer";
  } else {
    if ( !isAmong(transfer.among, transfer.from) ) return "among";
    if ( given(transfer.items) ) return "items";
    if ( !isCoins(transfer.currency) || (Object.keys(transfer.currency).length !== 1) ) return "currency";
  }
  if ( given(transfer.items) && !isItemList(transfer.items) ) return "items";
  if ( given(transfer.currency) && !isCoins(transfer.currency) ) return "currency";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Are these the characters a distribution shares among: from one to MOST_AMONG ids, each once, none
 * the party it's from?
 * @param {unknown} among
 * @param {string} from
 * @returns {boolean}
 */
function isAmong(among, from) {
  if ( !Array.isArray(among) || !among.length || (among.length > MOST_AMONG) ) return false;
  return among.every(id => isId(id) && (id !== from)) && (new Set(among).size === among.length);
}

/**
 * Is this the items a move names: from one to MOST_MOVED_ITEMS, each `{id, quantity}` and nothing
 * else, by distinct ids?
 * @param {unknown} items
 * @returns {boolean}
 */
function isItemList(items) {
  if ( !Array.isArray(items) || !items.length || (items.length > MOST_MOVED_ITEMS) ) return false;
  const ids = new Set();
  for ( const entry of items ) {
    if ( !isObject(entry) || (Object.keys(entry).sort().join() !== "id,quantity") ) return false;
    if ( !isId(entry.id) || !isMoved(entry.quantity) || ids.has(entry.id) ) return false;
    ids.add(entry.id);
  }
  return true;
}

/**
 * Is this the coins a move names: from one to MOST_MOVED_ITEMS kinds, each one dnd5e has, of a
 * whole number from 1 to MOST_MOVED?
 * @param {unknown} currency
 * @returns {boolean}
 */
function isCoins(currency) {
  if ( !isObject(currency) ) return false;
  const keys = Object.keys(currency);
  if ( !keys.length || (keys.length > MOST_MOVED_ITEMS) ) return false;
  const known = CONFIG.DND5E?.currencies ?? {};
  return keys.every(key => Object.hasOwn(known, key) && isMoved(currency[key]));
}

/**
 * Is this how many of something may be moved at once: a whole number from 1 to MOST_MOVED?
 * @param {unknown} value
 * @returns {boolean}
 */
function isMoved(value) {
  return Number.isInteger(value) && (value >= 1) && (value <= MOST_MOVED);
}

/**
 * Make a move fetched from the app, once every move before it has been made, whoever made it.
 * @param {object} command      `{transfer: {from, to, items?, currency?}}`, or since 0.32.0 a
 *                              distribution's `{transfer: {from, among, currency}}`, as fetched.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export function runTransferCommand(command, campaign) {
  const run = chain.then(() => transferNow(command, campaign));
  chain = run.then(() => {}, () => {});
  return run;
}

/**
 * Make a move now, if it may be made: who may move what (`whoMoves`), then what there is to move,
 * as both ends now are (`plansOf`), before anything is written; then the coins, then each item; the
 * line that says what moved; and both sheets as they then stand, ahead of the result. A
 * distribution is made by `distributeNow`.
 * @param {object} command
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
async function transferNow(command, passed) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || (campaign.transfers !== true) ) return failed("transfers-off");
  if ( game.system?.id !== "dnd5e" ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const ends = whoMoves(command, campaign);
  if ( ends.refusal ) return failed(ends.refusal);
  if ( !ends.to ) return distributeNow(command, campaign, ends);
  const { from, to, mover } = ends;
  const plans = await plansOf(command.transfer, from, to);
  if ( plans.refusal ) return failed(plans.refusal);

  const moved = { coins: [], items: [] };
  let wrote = false;
  let error = null;
  const written = () => { wrote = true; };
  try {
    if ( plans.coins.length ) {
      await moveCoins(from, to, plans.coins, written);
      moved.coins = plans.coins;
    }
    for ( const plan of plans.items ) moved.items.push(await moveItem(from, to, plan, written));
  } catch (err) {
    error = messageOf(err);
  }

  // The line says what moved, if anything did, as the character who moved it: the giver; the taker,
  // from a party into the move's own character; or the one it's made as, from a party elsewhere.
  const verb = !from.group ? "Gives" : ((to.actor.id === mover.id) ? "Takes" : "Sends");
  const speaker = { Gives: from.actor, Takes: to.actor, Sends: mover }[verb];
  const line = (moved.coins.length || moved.items.length)
    ? await postLine(command, speaker, lineText(verb, from, to, moved)) : null;
  if ( wrote ) {
    sheetFirst(from.actor);
    sheetFirst(to.actor);
  }
  const transfer = {
    from: from.actor.id,
    to: to.actor.id,
    items: moved.items.map(({ id, quantity, created, stacked }) => ({ id, quantity, created, stacked })),
    currency: moved.coins.length ? Object.fromEntries(moved.coins) : null
  };
  if ( error !== null ) {
    const result = failed("error", error);
    return (moved.coins.length || moved.items.length) ? { ...result, transfer } : result;
  }
  return {
    id: command.id, status: "done", reason: null, error: null,
    messageId: line?.id ?? null,
    visible: line ? visibleTo(line, speaker, campaign) : true,
    rolls: [],
    transfer
  };
}

/* -------------------------------------------- */
/*  Who may move what                           */
/* -------------------------------------------- */

/**
 * The ends of a move, as they now are, and the character it's made as, if its maker may move
 * between them; or why not. Each end is one of the campaign's characters or parties, and a
 * distribution's are its characters (`unknown`). The character it's made as is one of the
 * campaign's, and one of the ends where a character's things move; a party's things may be moved
 * as any of them, and a distribution is a party's (`not-yours`). A player moves only
 * from their own character, and with a party only one their character's users own in Foundry: one
 * they only observe is `not-owner`, and one they can't see `unknown`, as one not there. The
 * Gamemaster moves anything between them, party to party too. A distribution is shared among
 * exactly the party's characters, as Foundry now has them (`members`).
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {{refusal: string}|{from: MoveEnd, to: MoveEnd|null, among: Actor[], mover: Actor}}
 */
function whoMoves(command, campaign) {
  const { transfer } = command;
  const groups = new Set(campaignGroups(campaign).map(group => group.id));
  const endOf = id => {
    const actor = game.actors.get(id);
    if ( !actor ) return null;
    if ( groups.has(id) ) return { actor, group: true };
    return campaign.characters.has(id) ? { actor, group: false } : null;
  };
  // A distribution's characters are characters alone: a party named among them is as unknown as an
  // id that's nothing, so that it says nothing of a party the player can't see.
  const characterOf = id => {
    const actor = game.actors.get(id);
    return (actor && !groups.has(id) && campaign.characters.has(id)) ? actor : null;
  };
  const sharing = Array.isArray(transfer.among);
  const from = endOf(transfer.from);
  const to = sharing ? null : endOf(transfer.to);
  const among = sharing ? transfer.among.map(characterOf) : [];
  if ( !from || (!sharing && !to) || among.includes(null) ) return { refusal: "unknown" };

  // A character's things are moved only as one of the move's ends, the Gamemaster's too.
  const mover = campaign.characters.has(command.actorId) && !groups.has(command.actorId)
    ? (game.actors.get(command.actorId) ?? null) : null;
  if ( !mover ) return { refusal: "not-yours" };
  if ( !from.group && ![from, to].some(end => end?.actor.id === mover.id) ) return { refusal: "not-yours" };
  if ( sharing && !from.group ) return { refusal: "not-yours" };

  if ( command.by !== "gm" ) {
    // A player moves a character's things only from their own; and with a party, only one they own.
    if ( !from.group && (from.actor.id !== mover.id) ) return { refusal: "not-yours" };
    for ( const end of [from, to] ) {
      if ( !end?.group ) continue;
      const access = accessFor(end.actor, mover);
      if ( !access ) return { refusal: "unknown" };
      if ( access !== "owner" ) return { refusal: "not-owner" };
    }
  }

  if ( sharing ) {
    const members = new Set(campaignMembers(from.actor, campaign).map(actor => actor.id));
    const named = new Set(among.map(actor => actor.id));
    if ( (members.size !== named.size) || [...named].some(id => !members.has(id)) ) return { refusal: "members" };
  }
  return { from, to, among, mover };
}

/**
 * One end of a move: a campaign character, or one of its parties.
 * @typedef {object} MoveEnd
 * @property {Actor} actor
 * @property {boolean} group   Is it a party, a Group actor?
 */

/* -------------------------------------------- */
/*  A distribution                              */
/* -------------------------------------------- */

/**
 * Distribute a party's coin of one kind among its characters, since 0.32.0, as its sheet in the app
 * showed it: refused where the party holds fewer than that now (`short`), or there's not a whole
 * coin for each of them (`split`). Each is given a whole share, in the order named, after the
 * party's are taken; what's left over stays with the party, and the line says how much. Where a
 * share can't be given, the party is given back the shares not given, and the line says what was;
 * where that fails too, those coins are lost, never made twice, and the line says only what the
 * party still has. The party's sheet and each one's given a share go ahead of the result.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {{from: MoveEnd, among: Actor[], mover: Actor}} ends
 * @returns {Promise<CommandResult>}
 */
async function distributeNow(command, campaign, { from, among, mover }) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const party = from.actor;
  const [[key, n]] = Object.entries(command.transfer.currency);
  const k = among.length;
  const stored = actor => actor._source?.system?.currency?.[key] ?? 0;
  const held = Math.min(Math.floor(party.system?.currency?.[key] ?? 0), stored(party));
  if ( n > held ) return failed("short");
  if ( n < k ) return failed("split");
  const share = Math.floor(n / k);
  const total = share * k;

  // The party's own write first: refused, nothing is written, said or sent.
  try {
    await updated(party, { [`system.currency.${key}`]: stored(party) - total });
  } catch (err) {
    return failed("error", messageOf(err));
  }
  const credited = [];
  let error = null;
  let lost = false;
  for ( const actor of among ) {
    try {
      await updated(actor, { [`system.currency.${key}`]: stored(actor) + share });
      credited.push(actor);
    } catch (err) {
      // The shares not given go back to the party, in one write.
      const back = share * (k - credited.length);
      try {
        await putBack(err, () => updated(party, { [`system.currency.${key}`]: stored(party) + back }));
      } catch (thrown) {
        error = messageOf(thrown);
        lost = thrown !== err;
      }
      break;
    }
  }

  // What stays with the party of what it held: all but the shares given, unless the shares not
  // given were lost putting them back.
  const left = lost ? (held - total) : (held - (share * credited.length));
  const line = credited.length
    ? await postLine(command, mover, distributionText(from, credited, key, share, left)) : null;
  sheetFirst(party);
  for ( const actor of credited ) sheetFirst(actor);
  const transfer = {
    from: party.id,
    to: null,
    items: [],
    currency: credited.length ? { [key]: share * credited.length } : null,
    among: credited.map(actor => actor.id)
  };
  if ( error !== null ) {
    const result = failed("error", error);
    return credited.length ? { ...result, transfer } : result;
  }
  return {
    id: command.id, status: "done", reason: null, error: null,
    messageId: line?.id ?? null,
    visible: line ? visibleTo(line, mover, campaign) : true,
    rolls: [],
    transfer
  };
}

/* -------------------------------------------- */
/*  What there is to move                       */
/* -------------------------------------------- */

/**
 * How each part of a move would be made, as the giver and the receiver now are, read and never
 * written; or why it can't be. An item is `gone` where it isn't the giver's, isn't one the
 * inventory lists, or isn't listed in the app's sheet; there are too few of it or of a coin
 * (`short`); a container that holds, or may hold, anything moves whole (`container`); one inside
 * another moved moves with it already (`nested`); and one holding containers deeper than dnd5e
 * copies them can't be moved from here (`deep`). Each check is made of every part before the next.
 * @param {{items?: {id: string, quantity: number}[], currency?: Record<string, number>}} transfer
 * @param {MoveEnd} from
 * @param {MoveEnd} to
 * @returns {Promise<{refusal: string}|{coins: [string, number][], items: ItemPlan[]}>}
 */
async function plansOf(transfer, from, to) {
  const giver = from.actor;
  const asked = transfer.items ?? [];
  const items = asked.map(({ id, quantity }) => ({ id, n: quantity, item: giver.items?.get(id) ?? null }));
  const types = inventoryTypes();
  if ( items.some(({ item }) => !item || !types.has(item.type) || !listedInSheet(giver, item)) ) {
    return { refusal: "gone" };
  }

  const coins = Object.keys(CONFIG.DND5E?.currencies ?? {})
    .filter(key => Object.hasOwn(transfer.currency ?? {}, key))
    .map(key => [key, transfer.currency[key]]);
  const held = key => Math.min(Math.floor(giver.system?.currency?.[key] ?? 0), giver._source?.system?.currency?.[key] ?? 0);
  for ( const part of items ) part.q = quantityOf(part.item);
  if ( items.some(({ n, q }) => n > q) || coins.some(([key, n]) => n > held(key)) ) return { refusal: "short" };

  if ( items.some(({ item, n, q }) => (n < q) && holdsAnything(item)) ) return { refusal: "container" };

  const ids = new Set(items.map(({ id }) => id));
  if ( items.some(({ item }) => insideOf(giver, item, ids)) ) return { refusal: "nested" };

  const plans = [];
  for ( const part of items ) {
    const plan = await planItem(part, to.actor);
    if ( !plan ) return { refusal: "deep" };
    plans.push(plan);
  }
  return { coins, items: plans };
}

/**
 * How one item would be moved.
 * @typedef {object} ItemPlan
 * @property {string} id           Its id on the giver.
 * @property {Item} item           It, on the giver.
 * @property {number} n            How many move.
 * @property {boolean} whole       Do all of them?
 * @property {object[]} data       What's created on the receiver: it, then what it holds.
 * @property {string[]} expected   For a whole item, it and all it holds, deleted from the giver.
 * @property {Map<string, string>} copies   For a whole item, the id of each copy, by its original's.
 * @property {Item|null} stack     The receiver's stack it joins, if it joins one.
 * @property {string} name         Its name, as the app's sheet has it.
 */

/**
 * How one item would be moved, all of it or part, as a copy, or joining the receiver's stack; none
 * where it holds containers deeper than dnd5e copies, as deleting all it holds would delete what
 * was never copied.
 * @param {{id: string, item: Item, n: number, q: number}} part
 * @param {Actor} receiver
 * @returns {Promise<ItemPlan|null>}
 */
async function planItem({ id, item, n, q }, receiver) {
  const whole = n === q;
  let data;
  let expected = [];
  let copies = new Map();
  if ( whole ) {
    // As dnd5e's drop copies an item, with what it holds, each given a new id, its contents pointed
    // at their container's.
    const copied = [];
    data = await CONFIG.Item.documentClass.createWithContents([item], {
      transformAll: doc => {
        copied.push(doc.id);
        return doc;
      },
      transformFirst: doc => doc.toObject()
    });
    expected = [item.id, ...Array.from(item.system?.allContainedItems ?? [], inner => inner.id)];
    if ( !Array.isArray(data) || expected.some(inner => !copied.includes(inner)) ) return null;
    // Each copy is made as its original is walked, the two lists in step.
    copies = new Map(copied.map((original, index) => [original, data[index]?._id]));
  } else {
    const copy = item.toObject();
    delete copy._id;
    copy.system ??= {};
    copy.system.quantity = n;
    data = [copy];
  }
  for ( const entry of data ) for ( const key of RESET ) foundry.utils.deleteProperty(entry.system ?? {}, key);
  data[0].system ??= {};
  data[0].system.container = null;
  return { id, item, n, whole, data, expected, copies, stack: stackOf(data[0], receiver), name: String(item.name ?? "") };
}

/**
 * The receiver's stack an item would join, as dnd5e stacks a dropped consumable: one at the top, of
 * the same source and name. Never where either isn't identified, as dnd5e compares the names its
 * players see, which would join an unidentified copy to the stack it's the secret of; nor where the
 * one moved has uses spent, or either is enchanted, which dnd5e's stack would lose.
 * @param {object} data       The item moved, as created.
 * @param {Actor} receiver
 * @returns {Item|null}
 */
function stackOf(data, receiver) {
  if ( data.type !== "consumable" ) return null;
  const sourceOf = entry => entry?._stats?.compendiumSource ?? entry?.flags?.core?.sourceId;
  const source = sourceOf(data);
  if ( !source ) return null;
  const stack = Array.from(receiver.items ?? []).find(other => (other.type === "consumable")
    && (other.system?.container == null) && (sourceOf(other) === source) && (other._source?.name === data.name));
  if ( !stack ) return null;
  const enchanted = effects => Array.from(effects ?? []).some(effect => effect?.type === "enchantment");
  if ( (data.system?.identified === false) || (stack.system?.identified === false) ) return null;
  if ( (data.system?.uses?.spent ?? 0) !== 0 ) return null;
  if ( enchanted(data.effects) || enchanted(stack.effects) ) return null;
  return stack;
}

/**
 * How many of an item there are, as stored, as dnd5e's sheet writes them.
 * @param {Item} item
 * @returns {number}
 */
function quantityOf(item) {
  const quantity = item._source?.system?.quantity;
  return Number.isFinite(quantity) ? quantity : 1;
}

/**
 * Does a container hold anything, or may it, as one that hides what it holds may? Such a one moves
 * whole: a part would leave its contents behind, or take them twice.
 * @param {Item} item
 * @returns {boolean}
 */
function holdsAnything(item) {
  if ( item.type !== "container" ) return false;
  return (Array.from(item.system?.allContainedItems ?? []).length > 0) || hidesContents(item);
}

/**
 * Is an item inside one of these, at any depth?
 * @param {Actor} actor
 * @param {Item} item
 * @param {Set<string>} ids
 * @returns {boolean}
 */
function insideOf(actor, item, ids) {
  const seen = new Set();
  let id = item.system?.container;
  while ( id && !seen.has(id) ) {
    if ( ids.has(id) ) return true;
    seen.add(id);
    id = actor.items?.get(id)?.system?.container;
  }
  return false;
}

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

/**
 * Move coins: taken from the giver, then added to the receiver, each of only the coins moved, from
 * what it holds as stored. Where the receiver's can't be added, the giver's are put back: coins are
 * never made twice, and at worst, where that fails too, lost.
 * @param {MoveEnd} from
 * @param {MoveEnd} to
 * @param {[string, number][]} coins
 * @param {() => void} written   Called once anything is written.
 * @returns {Promise<void>}
 * @throws {Error}   What went wrong, with the put back's too, if that failed.
 */
async function moveCoins(from, to, coins, written) {
  const stored = actor => actor._source?.system?.currency ?? {};
  const changes = (actor, sign) => Object.fromEntries(coins.map(([key, n]) => [
    `system.currency.${key}`, (stored(actor)[key] ?? 0) + (sign * n)
  ]));
  await updated(from.actor, changes(from.actor, -1));
  written();
  try {
    await updated(to.actor, changes(to.actor, 1));
  } catch (err) {
    await putBack(err, () => updated(from.actor, changes(from.actor, 1)));
  }
}

/**
 * Move one item: part of a stack, taken from the giver's stack before it's added to the receiver;
 * or all of it, copied before the original and all it holds are deleted, in one go. Where the second
 * write fails, the first is undone; where it deletes only some, the copies of the rest.
 * @param {MoveEnd} from
 * @param {MoveEnd} to
 * @param {ItemPlan} plan
 * @param {() => void} written   Called once anything is written.
 * @returns {Promise<{id: string, quantity: number, created: string|null, stacked: string|null, name: string}>}
 * @throws {Error}   What went wrong, with the undoing's too, if that failed.
 */
async function moveItem(from, to, plan, written) {
  const { item, n, stack } = plan;
  const moved = { id: plan.id, quantity: n, created: null, stacked: null, name: plan.name };
  const add = async () => {
    if ( stack ) {
      await updated(stack, { "system.quantity": quantityOf(stack) + n });
      written();
      moved.stacked = stack.id;
      return;
    }
    const made = await to.actor.createEmbeddedDocuments("Item", plan.data, plan.whole ? { keepId: true } : {});
    const ids = Array.from(made ?? [], doc => doc?.id).filter(Boolean);
    // A module's hook may stop any of them being made, which Foundry leaves out without a word:
    // nothing then moves, and what was made is deleted, as a container mustn't go without some of
    // what it held.
    if ( !ids.length ) throw new Error("No item was created");
    written();
    if ( ids.length < plan.data.length ) await putBack(new Error("Not every item was created"), () => deleted(to.actor, ids));
    moved.created = ids[0];
  };

  if ( !plan.whole ) {
    await updated(item, { "system.quantity": quantityOf(item) - n });
    written();
    try {
      await add();
    } catch (err) {
      await putBack(err, () => updated(item, { "system.quantity": quantityOf(item) + n }));
    }
    return moved;
  }

  // Undo the copy of what's still the giver's: the stack it joined put back, or those copies deleted.
  const takeBack = originals => (stack ? updated(stack, { "system.quantity": quantityOf(stack) - n })
    : deleted(to.actor, originals.map(original => plan.copies.get(original)).filter(Boolean)));
  await add();
  let gone;
  try {
    gone = await from.actor.deleteEmbeddedDocuments("Item", plan.expected);
  } catch (err) {
    await putBack(err, () => takeBack(plan.expected));
  }
  // What a module kept from being deleted is still the giver's, so it's never on both ends; and what
  // was deleted keeps its copy, so it's never on neither.
  const ids = new Set(Array.from(gone ?? [], doc => doc?.id));
  const kept = plan.expected.filter(original => !ids.has(original));
  if ( kept.length ) await putBack(new Error("Not every item was deleted"), () => takeBack(kept));
  return moved;
}

/**
 * Update a document, failing where nothing was written: Foundry leaves out, without throwing, an
 * update a module's hook refuses, which then resolves to nothing. Every update here changes
 * something, so none resolves to nothing for want of a change.
 * @param {Actor|Item} document
 * @param {object} changes
 * @returns {Promise<void>}
 * @throws {Error}   Where it was refused, or failed.
 */
async function updated(document, changes) {
  if ( !await document.update(changes) ) throw new Error("An update was refused");
}

/**
 * Delete an actor's items, failing where any is left: Foundry leaves out, without throwing, what a
 * module's hook refuses.
 * @param {Actor} actor
 * @param {string[]} ids
 * @returns {Promise<void>}
 * @throws {Error}   Where any was left, or it failed.
 */
async function deleted(actor, ids) {
  const gone = new Set(Array.from(await actor.deleteEmbeddedDocuments("Item", ids) ?? [], doc => doc?.id));
  if ( ids.some(id => !gone.has(id)) ) throw new Error("Not every item was deleted");
}

/**
 * Undo a write after the next failed, then fail with what went wrong; with what went wrong undoing
 * it too, if that failed.
 * @param {unknown} err        What the failed write threw.
 * @param {() => Promise<unknown>} undo
 * @returns {Promise<never>}
 * @throws {Error}
 */
async function putBack(err, undo) {
  try {
    await undo();
  } catch (again) {
    throw new Error(`${messageOf(err)} / ${messageOf(again)}`);
  }
  throw err;
}

/**
 * What went wrong, in words.
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  return (err instanceof Error) ? err.message : String(err);
}

/* -------------------------------------------- */
/*  The line                                    */
/* -------------------------------------------- */

/**
 * The line that says what moved, as the character who moved it: "Gives 2 Potion of Healing to The
 * Iron Company" from a character, "Takes 50 gp from The Iron Company" from a party into the move's
 * own character, and since 0.32.0 "Sends 20 gp from The Iron Company to Vex" from a party anywhere
 * else. Each item by the name the app's sheet shows, an unidentified one's, in the order moved; then
 * the coins, in dnd5e's order, by its abbreviations; never what a container held. Every name is
 * escaped, as players name their characters and items.
 * @param {"Gives"|"Takes"|"Sends"} verb
 * @param {MoveEnd} from
 * @param {MoveEnd} to
 * @param {{coins: [string, number][], items: {quantity: number, name: string}[]}} moved
 * @returns {string}
 */
function lineText(verb, from, to, moved) {
  const lang = game.i18n.lang;
  const parts = [
    ...moved.items.map(({ quantity, name }) => game.i18n.format("SENDINGSTONE.Chat.Things", {
      count: quantity.toLocaleString(lang), name: escape(name)
    })),
    ...moved.coins.map(([key, n]) => coinsText(key, n))
  ];
  const things = listOf(parts);
  if ( verb === "Takes" ) return game.i18n.format("SENDINGSTONE.Chat.Takes", { things, source: escape(from.actor.name) });
  if ( verb === "Sends" ) {
    return game.i18n.format("SENDINGSTONE.Chat.Sends", { things, source: escape(from.actor.name), target: escape(to.actor.name) });
  }
  return game.i18n.format("SENDINGSTONE.Chat.Gives", { things, target: escape(to.actor.name) });
}

/**
 * The line that says what a distribution shared, among whom, how much each was given, and what of
 * the coin stays with the party: "Distributes 100 gp among Bram, Lia, Thorin, and Vex (25 gp
 * each); 3 gp stays with The Iron Company", or "none stays" where nothing does. Only those given
 * their share are named, in the order they were named.
 * @param {MoveEnd} from
 * @param {Actor[]} credited
 * @param {string} key      The coin's key.
 * @param {number} share    Each one's.
 * @param {number} left     What stays with the party, in whole coins.
 * @returns {string}
 */
function distributionText(from, credited, key, share, left) {
  const data = {
    things: coinsText(key, share * credited.length),
    names: listOf(credited.map(actor => escape(actor.name))),
    each: coinsText(key, share),
    source: escape(from.actor.name)
  };
  if ( left > 0 ) return game.i18n.format("SENDINGSTONE.Chat.Distributes", { ...data, left: coinsText(key, left) });
  return game.i18n.format("SENDINGSTONE.Chat.DistributesAll", data);
}

/**
 * So many of a coin, as a line says them: "25 gp", by dnd5e's abbreviation.
 * @param {string} key
 * @param {number} n
 * @returns {string}
 */
function coinsText(key, n) {
  const currencies = CONFIG.DND5E?.currencies ?? {};
  return game.i18n.format("SENDINGSTONE.Chat.Coins", {
    count: n.toLocaleString(game.i18n.lang), abbreviation: escape(localize(currencies[key]?.abbreviation) || key.toUpperCase())
  });
}

/**
 * Parts listed as the language lists them, "a, b, and c", or with commas where it can't.
 * @param {string[]} parts
 * @returns {string}
 */
function listOf(parts) {
  try {
    return new Intl.ListFormat(game.i18n.lang, { type: "conjunction" }).format(parts);
  } catch {
    return parts.join(", ");
  }
}

/**
 * Text made safe to put in a line's HTML.
 * @param {unknown} text
 * @returns {string}
 */
function escape(text) {
  return foundry.utils.escapeHTML(String(text ?? ""));
}
