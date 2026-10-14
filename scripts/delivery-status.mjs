import { EVENTS, STATUS_HOOK } from "./constants.mjs";
import { isBridge } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { getDestination, isMixedContent, parseDestination } from "./config.mjs";
import { inMegabytes, status } from "./transport.mjs";

/**
 * What the Gamemaster is told of posts and fetches that fail, and what the settings window shows of
 * them, kept in memory for this page load: the first posts after a reload tell it afresh.
 *
 * Every failure has a reason, which the app and this module share (see transport.mjs), and each
 * reason a scope: the app, a campaign, or one event. The Gamemaster is told once per cause, not
 * once per post: once for the app's address however many campaigns fail, once for each campaign,
 * and once a page load for each campaign and kind of event; and a cause is told again only once
 * it has been gone ten minutes, should it come back, so that one that comes and goes is told
 * once. A failing connection clears with the next post that gets through, or for the app's
 * address, once a post of each campaign that failed for it has, which tells the Gamemaster so if
 * they were told of the failure; a refused event never fails the connection, but is shown as the
 * campaign's last refusal until the next, or until a post of the same type gets through, for the
 * same character where it's about one.
 */

/**
 * Each reason a post or fetch fails for, and its scope: the app's address, whatever the
 * campaign; one campaign, as its title or secret; or one event, as its size or content.
 * @type {Readonly<Record<string, "app"|"campaign"|"event">>}
 */
export const REASONS = Object.freeze({
  unreachable: "app",
  timeout: "app",
  unavailable: "app",
  rateLimited: "app",
  badEnvelope: "app",
  unsupportedProtocol: "app",
  notForge: "app",
  status: "app",
  noSecret: "campaign",
  wrongSecret: "campaign",
  notSetUp: "campaign",
  malformed: "event",
  tooLarge: "event"
});

/**
 * How long a cause must have been gone, since it was told or last cleared after, before it may be
 * told again, should it come back, in milliseconds.
 * @type {number}
 */
export const TELL_AGAIN_AFTER = 600_000;

/**
 * How many fetches of players' rolls in a row may fail, for a reason that's retried, before the
 * Gamemaster is told: one that fails now and then, as a held fetch cut short, is no news.
 * @type {number}
 */
const FAILING_AFTER = 3;

/**
 * What is failing, by `events:app` for the app's address, `events:<campaignId>` for a campaign's
 * events, and `commands:<campaignId>` for fetching its players' rolls: its latest reason, status
 * and detail, since when and when last, how many times in a row, whether the Gamemaster was told,
 * and whether fetching stopped; the causes it was noted for, as `toldAt` keys them; and for the
 * app's address, the campaigns whose posts failed for it, none of which has got through since.
 * @type {Map<string, {reason: string, status: number|null, detail: string|null, since: number,
 *   last: number, count: number, told: boolean, stopped: boolean, causes: Set<string>,
 *   campaigns?: Set<string>}>}
 */
const connection = new Map();

/**
 * Each campaign's latest refused event, by campaign id: why, and which post it was, by its type and,
 * for a sheet, its character's actor id.
 * @type {Map<string, {reason: string, type: string, actorId: string|null, detail: string|null,
 *   size: number|null, limit: number|null, at: number}>}
 */
const lastRefused = new Map();

/**
 * The sheets withheld as too large, by `${campaignId}.${actorId}`.
 * @type {Map<string, {name: string, bytes: number, limit: number}>}
 */
const withheld = new Map();

/**
 * When each campaign last had a post delivered, and its players' rolls fetched, by campaign id.
 * @type {Map<string, number>}
 */
const lastDelivered = new Map();
const lastFetched = new Map();

/**
 * When each cause was last told, or, once told, last cleared, by `app:<reason>`,
 * `<campaignId>:<reason>`, or `<campaignId>:<reason>:<type>` for an event's. Events and players'
 * rolls share the first two.
 * @type {Map<string, number>}
 */
const toldAt = new Map();

/* -------------------------------------------- */

/**
 * Note a post delivered: the campaign's events reach the app, and once each campaign whose posts
 * failed for its address has had one delivered, the app's address works again. One campaign's
 * posts getting through says nothing of another's that keep failing.
 * A delivered hello starts the campaign's sheets afresh, so none is withheld until one is again.
 * The campaign's last refusal goes once a post of the same type gets through, for a sheet once
 * that character's next does: the app takes such posts again. That says nothing of what it refused,
 * which isn't sent again, though a character's next sheet stands in for one refused.
 * @param {object} envelope
 * @returns {void}
 */
export function noteDelivered(envelope) {
  const campaign = envelope?.campaign;
  const app = connection.get("events:app");
  if ( app ) {
    app.campaigns.delete(campaign?.id);
    // A campaign since removed won't post again.
    const saved = new Set(getCampaigns().map(({ id }) => id));
    for ( const id of app.campaigns ) if ( !saved.has(id) ) app.campaigns.delete(id);
    if ( !app.campaigns.size ) recover("events:app", () => game.i18n.localize("SENDINGSTONE.Notify.Reconnected"));
  }
  if ( campaign?.id ) {
    lastDelivered.set(campaign.id, Date.now());
    recover(`events:${campaign.id}`,
      () => game.i18n.format("SENDINGSTONE.Notify.CampaignRecovered", { campaign: campaign.title }));
    if ( envelope.type === EVENTS.HELLO ) dropWithheld(campaign.id);
    const refused = lastRefused.get(campaign.id);
    if ( (refused?.type === envelope.type) && [null, characterOf(envelope)].includes(refused.actorId) ) {
      lastRefused.delete(campaign.id);
    }
  }
  changed();
}

/**
 * Note a post that failed, telling the Gamemaster what went wrong and what to do, once per cause.
 * @param {object} envelope
 * @param {unknown} err       What the delivery threw.
 * @returns {void}
 */
export function noteFailed(envelope, err) {
  const campaign = envelope?.campaign ?? null;
  const id = campaign?.id ?? "";
  const reason = reasonOf(err);
  const scope = REASONS[reason];
  const { problem, fix } = describeProblem(err, { campaign, type: envelope?.type });
  const text = game.i18n.format("SENDINGSTONE.Notify.Problem", { problem, fix });
  if ( scope === "event" ) {
    if ( id ) {
      lastRefused.set(id, {
        reason, type: envelope.type, actorId: characterOf(envelope), detail: err?.detail ?? null,
        size: err?.size ?? null, limit: err?.limit ?? null, at: Date.now()
      });
    }
    tell(`${id}:${reason}:${envelope?.type}`, text, { once: true });
  } else {
    const cause = (scope === "app") ? `app:${reason}` : `${id}:${reason}`;
    const { entry, fresh } = fail((scope === "app") ? "events:app" : `events:${id}`, err, reason, { cause });
    if ( scope === "app" ) (entry.campaigns ??= new Set()).add(id);
    if ( fresh && tell(cause, text) ) entry.told = true;
  }
  changed();
}

/**
 * Note a campaign's players' rolls fetched: they reach the game again, if they didn't.
 * @param {string} campaignId
 * @returns {void}
 */
export function noteFetched(campaignId) {
  lastFetched.set(campaignId, Date.now());
  recover(`commands:${campaignId}`, () => game.i18n.format("SENDINGSTONE.Notify.RollsRecovered", {
    campaign: getCampaigns().find(({ id }) => id === campaignId)?.title ?? ""
  }));
  changed();
}

/**
 * Note a failed fetch of a campaign's players' rolls: told at once when fetching stops, and for a
 * failure that's retried, once it's failed three times in a row.
 * @param {Campaign} campaign
 * @param {unknown} err
 * @param {object} [options]
 * @param {boolean} [options.stopped]   Has fetching stopped, until the settings change?
 * @param {number} [options.failures]   How many fetches in a row have failed, this one included.
 * @returns {void}
 */
export function noteFetchFailed(campaign, err, { stopped=false, failures=1 }={}) {
  const reason = reasonOf(err);
  const key = (REASONS[reason] === "app") ? `app:${reason}` : `${campaign.id}:${reason}`;
  const { entry, fresh } = fail(`commands:${campaign.id}`, err, reason, { cause: key, stopped, count: failures });
  const { problem, fix } = describeProblem(err, { campaign });
  let told = false;
  if ( stopped ) {
    told = tell(key, game.i18n.format("SENDINGSTONE.Notify.RollsStopped", { campaign: campaign.title, problem, fix }));
  }
  else if ( (failures === FAILING_AFTER) || ((failures > FAILING_AFTER) && fresh) ) {
    told = tell(key, game.i18n.format("SENDINGSTONE.Notify.RollsFailing", { campaign: campaign.title, problem }));
  }
  if ( told ) entry.told = true;
  changed();
}

/**
 * Note a character's sheet withheld from a campaign as too large to post.
 * @param {string} campaignId
 * @param {string} actorId
 * @param {{name: string, bytes: number, limit: number}} sheet   The character's name, the post's
 *                                                               size, and the most the app takes.
 * @returns {void}
 */
export function noteWithheld(campaignId, actorId, { name, bytes, limit }) {
  withheld.set(`${campaignId}.${actorId}`, { name, bytes, limit });
  changed();
}

/**
 * Note a character's sheet posted to a campaign in full: it's withheld no longer.
 * @param {string} campaignId
 * @param {string} actorId
 * @returns {void}
 */
export function noteSheetSent(campaignId, actorId) {
  if ( withheld.delete(`${campaignId}.${actorId}`) ) changed();
}

/**
 * Forget the sheets withheld from a campaign, whose every sheet is sent afresh.
 * @param {string} campaignId
 * @returns {void}
 */
export function forgetWithheld(campaignId) {
  if ( dropWithheld(campaignId) ) changed();
}

/* -------------------------------------------- */

/**
 * What went wrong, and what to do about it, as the Gamemaster is told.
 * @param {DeliveryError|{reason: string, status?: number|null, detail?: string|null,
 *   size?: number|null, limit?: number|null}|unknown} err
 * @param {object} [options]
 * @param {{title: string}|null} [options.campaign]   The campaign it was for.
 * @param {string} [options.destination]   The app's address: the saved one unless a test's.
 * @param {string|null} [options.type]     The event's type, for one refused alone.
 * @returns {{problem: string, fix: string}}
 */
export function describeProblem(err, { campaign=null, destination=getDestination(), type=null }={}) {
  const reason = reasonOf(err);
  const offline = (reason === "unreachable") && (globalThis.navigator?.onLine === false);
  const detail = err?.detail ? `: ${String(err.detail).slice(0, 200)}` : "";
  let what = game.i18n.localize(`SENDINGSTONE.What.${whatOf(type)}`);
  // Mid-sentence, where it's not the first word.
  if ( reason === "malformed" ) what = what.charAt(0).toLocaleLowerCase(game.i18n.lang) + what.slice(1);
  const data = {
    address: destination,
    origin: globalThis.location?.origin ?? "",
    campaign: campaign?.title ?? "",
    status: err?.status ?? "",
    size: Number.isFinite(err?.size) ? inMegabytes(err.size, Math.ceil) : "",
    limit: Number.isFinite(err?.limit) ? inMegabytes(err.limit, Math.floor) : "",
    what,
    detail
  };
  const parsed = parseDestination(destination);
  const mixed = (reason === "unreachable") && !offline && parsed && isMixedContent(parsed);
  return {
    problem: game.i18n.format(`SENDINGSTONE.Problem.${offline ? "offline" : reason}`, data),
    fix: game.i18n.format(mixed ? "SENDINGSTONE.Test.HintMixedContent" : `SENDINGSTONE.Fix.${reason}`, data)
  };
}

/**
 * What the settings window says of a saved campaign's posts and fetches, a line each: whether its
 * events are delivered, its last refused event, its sheets withheld, and whether its players'
 * rolls are fetched. Only the browser sending events knows; any other says whose that is.
 * @param {Campaign} campaign
 * @returns {{state: "ok"|"error"|"warning"|"idle", text: string}[]}
 */
export function campaignStatus(campaign) {
  if ( !isBridge() ) {
    return [{
      state: "idle",
      text: game.i18n.format("SENDINGSTONE.Status.OtherBrowser", { name: game.users?.activeGM?.name ?? "" })
    }];
  }
  const lines = [];
  const line = (state, key, data) => lines.push({ state, text: game.i18n.format(`SENDINGSTONE.Status.${key}`, data) });
  const problemOf = (entry, type=null) => describeProblem(entry, { campaign, type }).problem;

  // Whichever failed last, the app's address, if this campaign's posts failed for it, or the campaign.
  const app = connection.get("events:app");
  const failing = [app?.campaigns.has(campaign.id) ? app : null, connection.get(`events:${campaign.id}`)]
    .filter(Boolean).sort((a, b) => b.last - a.last)[0];
  if ( failing ) line("error", "Failing", { time: timeOf(failing.since), problem: problemOf(failing) });
  else if ( lastDelivered.has(campaign.id) ) line("ok", "Delivered", { time: timeOf(lastDelivered.get(campaign.id)) });
  else line("idle", "Idle", {});

  const refused = lastRefused.get(campaign.id);
  if ( refused ) line("warning", "Refused", { time: timeOf(refused.at), problem: problemOf(refused, refused.type) });

  for ( const [key, { name, bytes, limit }] of withheld ) {
    if ( !key.startsWith(`${campaign.id}.`) ) continue;
    line("warning", "Withheld", { name, size: inMegabytes(bytes, Math.ceil), limit: inMegabytes(limit, Math.floor) });
  }

  if ( campaign.rolls ) {
    const rolls = connection.get(`commands:${campaign.id}`);
    if ( rolls?.stopped ) line("error", "RollsStopped", { time: timeOf(rolls.last), problem: problemOf(rolls) });
    else if ( rolls && (rolls.count >= FAILING_AFTER) ) {
      line("warning", "RollsFailing", { time: timeOf(rolls.since), problem: problemOf(rolls) });
    }
    else if ( lastFetched.has(campaign.id) ) line("ok", "RollsFetched", { time: timeOf(lastFetched.get(campaign.id)) });
  }
  return lines;
}

/* -------------------------------------------- */

/**
 * Why a post or fetch failed: its reason, or for anything else thrown, the catch-all.
 * @param {unknown} err
 * @returns {string}   One of REASONS.
 */
function reasonOf(err) {
  return Object.hasOwn(REASONS, err?.reason ?? "") ? err.reason : "status";
}

/**
 * The kind of event a type is, as the Gamemaster is told it: a key of What in the language file.
 * @param {string|null} type
 * @returns {string}
 */
function whatOf(type) {
  const kind = String(type ?? "");
  if ( kind === EVENTS.HELLO ) return "Hello";
  if ( kind === EVENTS.CHARACTER_UPDATED ) return "Sheet";
  if ( kind === EVENTS.CHARACTER_TEXTS ) return "Texts";
  if ( kind.startsWith("chat.") ) return "Chat";
  if ( kind.startsWith("combat.") ) return "Combat";
  if ( kind.startsWith("roll.prompt.") ) return "Prompt";
  if ( kind === EVENTS.COMMAND_RESULT ) return "Result";
  return "Event";
}

/**
 * The character a post is about, for one about one: a sheet's, by its actor id, as its envelope
 * carries it. Descriptions are shared between sheets, so they're about none.
 * @param {object} envelope
 * @returns {string|null}
 */
function characterOf(envelope) {
  if ( envelope?.type !== EVENTS.CHARACTER_UPDATED ) return null;
  const id = envelope.data?.character?.id;
  return (typeof id === "string") ? id : null;
}

/**
 * Note a failure on a connection, keeping since when it has failed.
 * @param {string} key
 * @param {unknown} err
 * @param {string} reason
 * @param {object} [options]
 * @param {string} [options.cause]     Its cause, as `toldAt` keys it.
 * @param {boolean} [options.stopped]
 * @param {number} [options.count]   Failures in a row, when the caller counts them.
 * @returns {{entry: object, fresh: boolean}}   Fresh when it wasn't failing, or failed otherwise.
 */
function fail(key, err, reason, { cause, stopped=false, count }={}) {
  const now = Date.now();
  const before = connection.get(key);
  // Read before the entry, the same object as `before`, takes this failure's reason.
  const fresh = !before || (before.reason !== reason);
  const entry = before ?? { since: now, count: 0, told: false, causes: new Set() };
  if ( cause ) entry.causes.add(cause);
  Object.assign(entry, {
    reason,
    status: err?.status ?? null,
    detail: err?.detail ?? null,
    last: now,
    count: count ?? (entry.count + 1),
    stopped
  });
  connection.set(key, entry);
  return { entry, fresh };
}

/**
 * A connection that works again: told so, if the Gamemaster was told it failed. Each of its causes
 * that was ever told is told again only once it has been gone ten minutes from now, so that one
 * that comes and goes, as a post that fails between others that get through, is told once.
 * @param {string} key
 * @param {() => string} notice
 * @returns {void}
 */
function recover(key, notice) {
  const entry = connection.get(key);
  if ( !entry ) return;
  connection.delete(key);
  for ( const cause of entry.causes ) if ( toldAt.has(cause) ) toldAt.set(cause, Date.now());
  if ( entry.told ) ui.notifications.info(notice());
}

/**
 * Warn the Gamemaster of a cause, unless it was told lately: within ten minutes of when it was told
 * or last cleared after, or for an event's, at all this page load.
 * @param {string} key
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.once]   Told once a page load.
 * @returns {boolean}   Was it told?
 */
function tell(key, text, { once=false }={}) {
  const at = toldAt.get(key);
  if ( (at !== undefined) && (once || (Date.now() - at < TELL_AGAIN_AFTER)) ) return false;
  toldAt.set(key, Date.now());
  ui.notifications.warn(text);
  return true;
}

/**
 * Forget the sheets withheld from a campaign.
 * @param {string} campaignId
 * @returns {boolean}   Were there any?
 */
function dropWithheld(campaignId) {
  let any = false;
  for ( const key of withheld.keys() ) {
    if ( !key.startsWith(`${campaignId}.`) ) continue;
    withheld.delete(key);
    any = true;
  }
  return any;
}

/**
 * A time of day, as the Gamemaster reads it.
 * @param {number} ms
 * @returns {string}
 */
function timeOf(ms) {
  return new Date(ms).toLocaleTimeString(game.i18n.lang, { hour: "numeric", minute: "2-digit" });
}

/**
 * Tell whatever shows delivery status that it changed.
 * @returns {void}
 */
function changed() {
  Hooks.callAll(STATUS_HOOK, status);
}
