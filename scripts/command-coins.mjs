import { COIN_KINDS } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { activeForm } from "./characters.mjs";
import { coinUpdate, takenCoins } from "./coin-change.mjs";
import { postLine } from "./command-charges.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import { checkCommand, failedResult, visibleTo } from "./command-rolls.mjs";
import { afterMoves, coinsWords, escape, messageOf, updated } from "./command-transfers.mjs";
import { campaignGroups } from "./groups.mjs";

/**
 * A character's coins added to and taken away from the Sending Stone app, since module 0.48.0, as
 * when the Gamemaster says "you're paid 5 gp" or "that costs 5 gp": so many of each coin, by its
 * player, on their own character, or by the campaign's Gamemaster at that character's page. Never a
 * party's, which has its own moves, nor a companion's.
 *
 * Taking away more of a coin than the character holds is paid with its other coins, by the rule
 * coin-change.mjs keeps: a larger coin broken, the change given back, smaller coins paying where no
 * larger one is left; refused only where all its coins are worth too little, or, where the
 * campaign's Gamemaster has turned that off, wherever it's short of a coin.
 *
 * dnd5e posts nothing for coins changed on its sheet, so each change posts a line in chat, for
 * everyone, as the character: "Thorin received 5 gp", "Thorin paid 5 gp", by the coins asked for,
 * never by what else was broken or used, which the result tells the app. One the Gamemaster made is
 * marked as theirs, as their rolls are.
 *
 * Only the coins that change are written, in one update, each from what the actor stores, so dnd5e
 * 6's fraction of a coin stays. It's made in the line the moves stand in (command-transfers.mjs's
 * `afterMoves`), so that coins on their way to another character are never also taken away.
 *
 * Offered under D&D Fifth Edition where the campaign's Gamemaster lets its players, by its own
 * switch, on until turned off, apart from its rolls and its moves: it throws no dice.
 */

/**
 * The campaigns whose app takes coins added and taken away, by id, as their latest answer to a hello
 * or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/* -------------------------------------------- */
/*  Whether coins are changed here              */
/* -------------------------------------------- */

/**
 * May a campaign's players add coins to their characters and take them away from the app: by its
 * own switch, under dnd5e.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function coinsOn(campaign) {
  return (campaign.coins === true) && (game.system?.id === "dnd5e");
}

/**
 * What a campaign tells the app of its players' coins in its hello, beside its rolls: whether they
 * may add and take them away here, and if not, why not, its switch off or the system; and wherever
 * they may, whether a character's other coins pay where it's short of one (`change`), as its
 * Gamemaster has set it.
 * @param {Campaign} campaign
 * @returns {{enabled: boolean, kinds: string[], reason: "off"|"system"|null, change: boolean}}
 */
export function coinFeatures(campaign) {
  if ( campaign.coins !== true ) return { enabled: false, kinds: [], reason: "off", change: false };
  if ( game.system?.id !== "dnd5e" ) return { enabled: false, kinds: [], reason: "system", change: false };
  return { enabled: true, kinds: [...COIN_KINDS], reason: null, change: campaign.coinChange === true };
}

/**
 * Note whether a campaign's app takes coins added and taken away: `features.coins`, 1 or later. One
 * that says nothing of them, as an older or rolled back app, is fetched from for them no longer.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {void}
 */
export function noteCoinReader(campaignId, features) {
  const format = features?.coins;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
}

/**
 * Does a campaign's app take coins added and taken away?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function coinReader(campaignId) {
  return readers.has(campaignId);
}

/* -------------------------------------------- */
/*  The command                                 */
/* -------------------------------------------- */

/**
 * Add coins to a character, or take them away, as fetched from the app, once every move and removal
 * before it has been made.
 * @param {object} command      `{coins: {op, currency}}`, as fetched.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export function runCoinsCommand(command, campaign) {
  return afterMoves(() => coinsNow(command, campaign));
}

/**
 * Add or take away a character's coins now, if they may be: every check before the write, the
 * character as it now is. Coins taken away are paid as coin-change.mjs's `takenCoins` pays them,
 * refused where they can't be (`short`). Then one update of only the coins that change, each from
 * what the actor stores (`coinUpdate`); one that throws, or that a module's hook refuses, is an
 * `error`, with nothing posted and no sheet. Then the line, the sheet as it then stands, and the result, which says what was asked
 * and which of the character's other coins went for it (`used`).
 * @param {object} command
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
async function coinsNow(command, passed) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !coinsOn(campaign) ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const groups = new Set(campaignGroups(campaign).map(group => group.id));
  const actor = (campaign.characters.has(command.actorId) && !groups.has(command.actorId))
    ? (game.actors.get(command.actorId) ?? null) : null;
  if ( !actor ) return failed("unknown");
  // None while she's transformed: her coins aren't on her form.
  if ( activeForm(actor) ) return failed("shaped");

  const { op, currency } = command.coins;
  // The coins asked for, in dnd5e's order, as a line says them and the result repeats them.
  const asked = Object.fromEntries(Object.keys(CONFIG.DND5E?.currencies ?? {})
    .filter(key => Object.hasOwn(currency, key)).map(key => [key, currency[key]]));
  // Coins added change by as many, nothing else used; coins taken away as they're paid.
  const plan = (op === "add") ? { by: asked, used: {} } : takenCoins(actor, asked, { change: campaign.coinChange === true });
  if ( plan.refusal ) return failed(plan.refusal);
  try {
    await updated(actor, coinUpdate(actor, plan.by));
  } catch (err) {
    return failed("error", messageOf(err));
  }

  const text = game.i18n.format((op === "add") ? "SENDINGSTONE.Chat.Received" : "SENDINGSTONE.Chat.Paid", {
    name: escape(actor.name), things: coinsWords(asked)
  });
  const line = await postLine(command, actor, text);
  sheetFirst(actor);
  return {
    id: command.id, status: "done", reason: null, error: null,
    messageId: line?.id ?? null,
    visible: line ? visibleTo(line, actor, campaign) : true,
    rolls: [],
    coins: { op, currency: asked, used: Object.keys(plan.used).length ? plan.used : null }
  };
}
