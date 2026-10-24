import {
  DEFAULT_MAX_BYTES, EVENT_DROPPED_HOOK, EVENTS, HELLO_DELIVERED_HOOK, HELLO_WANTED_HOOK, LISTENER_FEATURES_HOOK,
  MODULE_ID, PROTOCOL_VERSION, SHEET_TERMS_HOOK, SLIM_SHEETS
} from "./constants.mjs";
import { describeCampaign } from "./campaigns.mjs";
import { eventsUrl, getDestination, getSecret, parseDestination } from "./config.mjs";
import { noteDelivered, noteFailed, REASONS } from "./delivery-status.mjs";

/**
 * Delivering events to the listener.
 *
 * Events are posted one at a time, in the order they were raised, so the listener never has to
 * reorder them. A failed post is retried a few times when the failure might be temporary, then
 * dropped: an event about a turn that has long since passed is worth less than keeping the queue
 * moving. Each envelope keeps its id across retries so the listener can discard duplicates. No post
 * is larger than the listener says it takes.
 *
 * Since 0.23.0 every failure has a reason, which an app from then says, beside the status, in a
 * refusal's JSON body, and which an older app's status, and its words, are read for: what the
 * Gamemaster is told, and when, is delivery-status.mjs's. The status alone still decides retrying.
 */

/**
 * The most events held while waiting on the listener. Past this, the oldest are dropped.
 * @type {number}
 */
const MAX_QUEUE = 500;

/**
 * How long a single post may take before it is abandoned, in milliseconds.
 * @type {number}
 */
const TIMEOUT = 10_000;

/**
 * Delays before each retry of a failed post, in milliseconds. One more attempt than entries.
 * @type {number[]}
 */
const RETRY_DELAYS = [1_000, 3_000];

/**
 * Events waiting to be posted, oldest first. The event being posted is not in here. An entry is an
 * envelope, or the events still being prepared for a place in the queue: see sendLater.
 * @type {Array<object|{later: Promise<object[]>}>}
 */
const queue = [];

/**
 * Is the queue currently being worked through?
 * @type {boolean}
 */
let draining = false;

/**
 * The envelope being posted, retries and all, if any.
 * @type {object|null}
 */
let posting = null;

/**
 * Identifies this page load, so the listener can tell a reloaded bridge from a gap in sequence.
 * Created on first use: the foundry global need not exist when this file is evaluated.
 * @type {string|null}
 */
let session = null;

/**
 * The events whose answers say what the listener does beyond taking events.
 * @type {Set<string>}
 */
const ANNOUNCING = new Set([EVENTS.HELLO, EVENTS.HEARTBEAT]);

/**
 * The events whose answers say what the listener takes of sheets: since 0.22.0, a character's
 * update's too, so that an app rolled back to one that doesn't expand slim sheets is noticed at
 * the next sheet it's sent; since 0.30.0 a group's; and since 0.36.0 a companion's.
 * @type {Set<string>}
 */
const TERMS_FROM = new Set([
  EVENTS.HELLO, EVENTS.HEARTBEAT, EVENTS.CHARACTER_UPDATED, EVENTS.GROUP_UPDATED, EVENTS.COMPANION_UPDATED
]);

/**
 * What the listener takes of each campaign's sheets, from its latest answer that says, by
 * campaign id: see termsOf.
 * @type {Map<string, {slimSheets: number|null, maxBytes: number}>}
 */
const terms = new Map();

/**
 * The sequence number of the last envelope built in this session, for each campaign. Each
 * campaign's events form their own stream, so a gap in one means that campaign missed something.
 * @type {Map<string, number>}
 */
const sequences = new Map();

/**
 * When each campaign was last sent an event, by campaign id, in milliseconds since the epoch.
 * @type {Map<string, number>}
 */
const lastSent = new Map();

/**
 * The outcome of recent deliveries from this browser.
 * @type {{state: "idle"|"ok"|"error", delivered: number, dropped: number,
 *         lastDelivered: number|null, lastError: {message: string, at: number}|null}}
 */
export const status = {
  state: "idle",
  delivered: 0,
  dropped: 0,
  lastDelivered: null,
  lastError: null
};

/* -------------------------------------------- */

/**
 * A post the listener did not accept.
 */
export class DeliveryError extends Error {
  /**
   * @param {string} message                  A short description of what went wrong.
   * @param {object} options
   * @param {boolean} options.retryable       Might the same post succeed if tried again?
   * @param {number} [options.status]         The HTTP status, if the listener responded at all.
   * @param {unknown} [options.cause]         The underlying error.
   * @param {string} [options.reason]         Why, one of delivery-status.mjs's REASONS.
   * @param {string|null} [options.detail]    What more the listener said, or the module knows.
   * @param {number|null} [options.limit]     For a post too large, the most the listener takes,
   * @param {number|null} [options.size]      and the post's size, in bytes.
   */
  constructor(message, { retryable, status, cause, reason, detail, limit, size }={}) {
    super(message, { cause });
    this.name = "DeliveryError";
    this.retryable = retryable === true;
    this.status = status ?? null;
    this.reason = reason ?? "status";
    this.detail = detail ?? null;
    this.limit = limit ?? null;
    this.size = size ?? null;
  }
}

/* -------------------------------------------- */

/**
 * Wrap a payload in the envelope every event shares.
 * @param {string} type                     One of EVENTS.
 * @param {object} data                     The event payload.
 * @param {object} [options]
 * @param {Campaign|null} [options.campaign]  The campaign the event is for. Only a connection
 *                                          test, which belongs to no campaign, goes without.
 * @param {boolean} [options.sequenced]     Is this part of the event stream? A connection test is
 *                                          not: it may go to a destination other than the
 *                                          configured one, and must not leave a gap there.
 * @returns {object}
 */
export function buildEnvelope(type, data, { campaign=null, sequenced=true }={}) {
  const sessionId = currentSession();
  let sequence = null;
  if ( sequenced ) {
    const key = campaign?.id ?? "";
    sequence = (sequences.get(key) ?? 0) + 1;
    sequences.set(key, sequence);
  }
  return {
    protocol: PROTOCOL_VERSION,
    id: foundry.utils.randomID(16),
    session: sessionId,
    sequence,
    type,
    time: new Date().toISOString(),
    world: { id: game.world.id, title: game.world.title },
    campaign: campaign ? describeCampaign(campaign) : null,
    data
  };
}

/**
 * This page load's session, as every envelope names it.
 * @returns {string}
 */
export function currentSession() {
  session ??= foundry.utils.randomID(16);
  return session;
}

/**
 * Queue an event for delivery to the configured destination.
 * @param {string} type                 One of EVENTS.
 * @param {object} data                 The event payload. Must be plain, JSON-serializable data.
 * @param {Campaign} campaign           The campaign the event is for.
 * @param {object} [options]
 * @param {boolean} [options.sequenced] Is this part of the campaign's event stream? A heartbeat
 *                                      is not, so missing one leaves no gap.
 * @returns {void}
 */
export function send(type, data, campaign, { sequenced=true }={}) {
  post(buildEnvelope(type, data, { campaign, sequenced }));
}

/**
 * Queue an envelope already built, as one measured before it's sent, for delivery to the configured
 * destination.
 * @param {object} envelope   As `buildEnvelope` builds it, for a campaign.
 * @returns {void}
 */
export function post(envelope) {
  enqueue(envelope);
  lastSent.set(envelope.campaign.id, Date.now());
}

/**
 * Queue events whose payloads take time to prepare, such as descriptions that must be enriched,
 * holding their place in the queue: they are posted after everything queued before them and before
 * anything queued after, however long they take. They are not part of the campaign's event stream,
 * so they carry no sequence number.
 * @param {string} type                     One of EVENTS.
 * @param {() => Promise<object[]>} prepare Resolves to the payloads to post, in order; none to post
 *                                          nothing. If it fails, nothing is posted.
 * @param {Campaign} campaign               The campaign the events are for.
 * @returns {void}
 */
export function sendLater(type, prepare, campaign) {
  const later = prepare()
    .then(payloads => payloads.map(data => buildEnvelope(type, data, { campaign, sequenced: false })))
    .catch(err => {
      console.warn(`${MODULE_ID} | Could not prepare ${type}`, err);
      return [];
    });
  enqueue({ later });
  lastSent.set(campaign.id, Date.now());
}

/**
 * Add to the queue, dropping the oldest entry when it is full, and start working through it.
 * @param {object} entry
 * @returns {void}
 */
function enqueue(entry) {
  queue.push(entry);
  if ( queue.length > MAX_QUEUE ) {
    const dropped = queue.shift();
    status.dropped++;
    // Lost to a listener too slow to keep up, which it may not be later.
    if ( !dropped.later ) Hooks.callAll(EVENT_DROPPED_HOOK, dropped, { temporary: true });
  }
  drain();
}

/**
 * Is a bridge.hello for a campaign waiting to be posted, or being posted?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function helloPending(campaignId) {
  const hello = envelope => (envelope?.type === EVENTS.HELLO) && (envelope.campaign?.id === campaignId);
  return hello(posting) || queue.some(hello);
}

/**
 * What the listener takes of a campaign's sheets, as its latest answer to a hello, heartbeat or
 * character's update said: `slimSheets`, the slim format to send them in, or null for the full
 * shape; and `maxBytes`, the largest post it takes. Until it has said, full sheets of at most
 * 1,000,000 bytes, as any listener takes.
 * @param {string} [campaignId]
 * @returns {{slimSheets: number|null, maxBytes: number}}
 */
export function termsOf(campaignId) {
  return terms.get(campaignId) ?? { slimSheets: null, maxBytes: DEFAULT_MAX_BYTES };
}

/**
 * What an answer says the listener takes of sheets: a whole number of at least 1 for
 * `slimSheets` says it expands slim format 1 (and any later one), and one of at least 1,000,000
 * for `maxBytes` the largest post it takes. Anything else, or nothing, is what any listener takes.
 * @param {object|null} features    The answer's `features`.
 * @returns {{slimSheets: number|null, maxBytes: number}}
 */
function termsIn(features) {
  const { slimSheets, maxBytes } = features ?? {};
  return {
    slimSheets: (Number.isInteger(slimSheets) && (slimSheets >= 1)) ? SLIM_SHEETS : null,
    maxBytes: (Number.isInteger(maxBytes) && (maxBytes >= DEFAULT_MAX_BYTES)) ? maxBytes : DEFAULT_MAX_BYTES
  };
}

/**
 * A size in megabytes, to one decimal, as the Gamemaster and the app are told it.
 * @param {number} bytes
 * @param {(n: number) => number} round   Up for a post's size, down for a limit, so that a post
 *                                        over the limit always reads as larger.
 * @returns {string}                      Such as "1.1 MB".
 */
export function inMegabytes(bytes, round) {
  return `${(round(bytes / 100_000) / 10).toFixed(1)} MB`;
}

/**
 * How long ago a campaign was last sent an event.
 * @param {string} campaignId
 * @returns {number}            In milliseconds; Infinity if it has been sent nothing.
 */
export function sinceLastSent(campaignId) {
  const at = lastSent.get(campaignId);
  return at === undefined ? Infinity : Date.now() - at;
}

/* -------------------------------------------- */

/**
 * Post one envelope to the destination, without retrying.
 * @param {object} envelope                 The envelope to post.
 * @param {object} [options]
 * @param {string} [options.destination]    The destination. Defaults to the configured one.
 * @param {string} [options.secret]         The secret. Defaults to the one this browser holds for
 *                                          the envelope's campaign.
 * @returns {Promise<{status: number, elapsed: number}>}
 * @throws {DeliveryError}
 */
export async function deliver(envelope, { destination=getDestination(), secret=getSecret(envelope.campaign?.id) }={}) {
  const parsed = parseDestination(destination);
  if ( !parsed ) {
    throw new DeliveryError(game.i18n.localize("SENDINGSTONE.Error.InvalidDestination"), {
      retryable: false, reason: "unreachable"
    });
  }
  const target = eventsUrl(parsed);

  let body;
  try {
    body = JSON.stringify(envelope);
  } catch (err) {
    throw new DeliveryError(err.message, { retryable: false, cause: err, reason: "malformed", detail: err.message });
  }

  // A post larger than the listener takes would be refused, or worse, cut off unread. A test of a
  // campaign's connection may go elsewhere than its events, so it's held to what any listener takes.
  const size = new TextEncoder().encode(body).length;
  const limit = (envelope.type === EVENTS.PING) ? DEFAULT_MAX_BYTES : termsOf(envelope.campaign?.id).maxBytes;
  if ( size > limit ) {
    throw new DeliveryError(game.i18n.format("SENDINGSTONE.Error.TooLarge", {
      size: inMegabytes(size, Math.ceil), limit: inMegabytes(limit, Math.floor)
    }), { retryable: false, reason: "tooLarge", size, limit });
  }

  const headers = { "Content-Type": "application/json" };
  if ( secret ) headers.Authorization = `Bearer ${secret}`;

  const started = performance.now();
  let response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers,
      body,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT)
    });
  } catch (err) {
    // The browser deliberately does not say why a request failed outright: an unreachable host,
    // a refused CORS preflight and blocked mixed content all surface as the same TypeError.
    const timeout = err?.name === "TimeoutError";
    throw new DeliveryError(game.i18n.localize(timeout ? "SENDINGSTONE.Error.Timeout" : "SENDINGSTONE.Error.Network"), {
      retryable: true, cause: err, reason: timeout ? "timeout" : "unreachable"
    });
  }
  const elapsed = Math.round(performance.now() - started);

  if ( response.ok ) return { status: response.status, elapsed, answer: await readAnswer(response) };
  throw await refusalError(response, { secret, size, limit });
}

/**
 * Why a listener refused a post or fetch, as an error to throw.
 * @param {Response} response                 The refusal.
 * @param {object} [options]
 * @param {string} [options.secret]           The secret it was sent with, if any.
 * @param {number|null} [options.size]        Its size, and the most the listener was taken to take,
 * @param {number|null} [options.limit]       in bytes, for one refused as too large.
 * @returns {Promise<DeliveryError>}
 */
export async function refusalError(response, { secret, size=null, limit=null }={}) {
  const refusal = await readRefusal(response);
  const { reason, detail } = reasonFor(response.status, refusal, { secret });
  // A listener that is overloaded or restarting may accept the same post later. One that
  // rejected it outright, a wrong secret for instance, will not.
  const retryable = (response.status >= 500) || [408, 425, 429].includes(response.status);
  const status = game.i18n.format("SENDINGSTONE.Error.Status", {
    status: `${response.status} ${response.statusText ?? ""}`.trim()
  });
  const tooLarge = reason === "tooLarge";
  return new DeliveryError(refusal.message ? `${status}: ${refusal.message}` : status, {
    retryable, status: response.status, reason, detail,
    size: tooLarge ? size : null, limit: tooLarge ? (refusal.limit ?? limit) : null
  });
}

/**
 * What a listener said in refusing a post or fetch, as far as it can be read: since 0.23.0's app,
 * JSON with its `reason`, `message`, and what more it says, such as `detail` or `limit`; from an
 * older one, a line of text, or nothing. Never throws, whatever the answer lacks.
 * @param {Response} response
 * @returns {Promise<{reason?: string, message?: string, detail?: string, limit?: number,
 *   protocol?: number}>}
 */
export async function readRefusal(response) {
  const line = value => String(value).trim().slice(0, 300);
  try {
    if ( String(response?.headers?.get?.("content-type") ?? "").includes("application/json") ) {
      const body = await response.json();
      if ( !body || (typeof body !== "object") ) return {};
      const refusal = {};
      if ( (typeof body.reason === "string") && /^[A-Za-z]{1,40}$/.test(body.reason) ) refusal.reason = body.reason;
      for ( const key of ["message", "detail"] ) {
        if ( (typeof body[key] === "string") && line(body[key]) ) refusal[key] = line(body[key]);
      }
      for ( const key of ["limit", "protocol"] ) {
        if ( Number.isInteger(body[key]) ) refusal[key] = body[key];
      }
      return refusal;
    }
    if ( typeof response?.text !== "function" ) return {};
    const first = line(String(await response.text()).trim().split(/\r?\n/)[0]);
    return first ? { message: first } : {};
  } catch {
    return {};
  }
}

/**
 * Why a listener refused a post or fetch. A reason the app gives that this module knows wins; an
 * unknown one is a status, its message said. Otherwise the status, and an older app's words, say:
 * a 401 is no secret when none was sent, the wrong one when one was; a 403 or 404 is a game not on
 * The Forge, or a campaign not set up, when it says nothing else or says so as the app before
 * 0.23.0 did; a 400 is an event the app couldn't read.
 * @param {number} status
 * @param {{reason?: string, message?: string, detail?: string}} refusal   As readRefusal reads it.
 * @param {object} [options]
 * @param {string} [options.secret]   The secret sent, if any.
 * @returns {{reason: string, detail: string|null}}
 */
export function reasonFor(status, refusal={}, { secret }={}) {
  const { reason, message, detail } = refusal;
  if ( reason !== undefined ) {
    return Object.hasOwn(REASONS, reason) ? { reason, detail: detail ?? null }
      : { reason: "status", detail: message ?? detail ?? null };
  }
  const text = message ?? "";
  if ( status === 401 ) return { reason: secret ? "wrongSecret" : "noSecret", detail: null };
  if ( (status === 403) || (status === 404) ) {
    if ( !text || text.startsWith("Only games") || text.startsWith("No campaign") ) {
      return { reason: (status === 403) ? "notForge" : "notSetUp", detail: null };
    }
    return { reason: "status", detail: text };
  }
  if ( status === 413 ) return { reason: "tooLarge", detail: null };
  if ( status === 400 ) return { reason: "malformed", detail: text || null };
  if ( status === 408 ) return { reason: "timeout", detail: null };
  if ( (status === 425) || (status === 429) ) return { reason: "rateLimited", detail: null };
  if ( status >= 500 ) return { reason: "unavailable", detail: null };
  return { reason: "status", detail: text || null };
}

/**
 * What the listener said in a successful answer, if anything. A listener that lacks a campaign's
 * full state, such as one that refused its bridge.hello because the campaign was not set up yet,
 * may answer an event for it with `{"resend": "hello"}`; and one that does more than take events
 * says so in `features`, such as `{"features": {"commands": true}}`, and since 0.22.0 what it takes
 * of sheets, such as `{"features": {"slimSheets": 1, "maxBytes": 4000000}}`.
 * @param {Response} response
 * @returns {Promise<{resend: "hello"|null, features: object|null}>}
 */
async function readAnswer(response) {
  const nothing = { resend: null, features: null };
  if ( !response.headers?.get("content-type")?.includes("application/json") ) return nothing;
  try {
    const answer = await response.json();
    const features = answer?.features;
    return {
      resend: answer?.resend === "hello" ? "hello" : null,
      features: (features && (typeof features === "object") && !Array.isArray(features)) ? features : null
    };
  } catch {
    return nothing;
  }
}

/* -------------------------------------------- */

/**
 * Work through the queue until it is empty. Only one drain runs at a time.
 * @returns {Promise<void>}
 */
async function drain() {
  if ( draining ) return;
  draining = true;
  try {
    while ( queue.length ) {
      // Taken off the queue before posting, so an overflow while it is in flight drops the
      // oldest waiting event rather than this one.
      const entry = queue.shift();
      const envelopes = entry.later ? await entry.later : [entry];

      // The destination may have been removed while events were waiting.
      if ( !getDestination() ) {
        queue.length = 0;
        break;
      }
      for ( const envelope of envelopes ) await deliverWithRetry(envelope);
    }
  } finally {
    draining = false;
  }
}

/**
 * Post one envelope, retrying failures that might be temporary.
 * @param {object} envelope   The envelope to post.
 * @returns {Promise<void>}
 */
async function deliverWithRetry(envelope) {
  posting = envelope;
  for ( let attempt = 0; ; attempt++ ) {
    try {
      const { answer } = await deliver(envelope);
      posting = null;
      recordSuccess(envelope);
      answered(envelope, answer);
      return;
    } catch (err) {
      const retryable = (err instanceof DeliveryError) && err.retryable;
      if ( !retryable || (attempt >= RETRY_DELAYS.length) ) {
        posting = null;
        recordFailure(envelope, err);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

/**
 * Act on what the listener said in answer to a post it took. What it takes of sheets is noted
 * before anything is told of the answer, so that whatever sheets follow are sent as it takes them.
 * @param {object} envelope
 * @param {{resend: "hello"|null, features: object|null}} answer
 * @returns {void}
 */
function answered(envelope, answer) {
  const campaignId = envelope.campaign?.id;
  if ( !campaignId ) return;
  let termsChanged = false;
  if ( TERMS_FROM.has(envelope.type) ) {
    const before = termsOf(campaignId);
    const after = termsIn(answer.features);
    termsChanged = (after.slimSheets !== before.slimSheets) || (after.maxBytes !== before.maxBytes);
    terms.set(campaignId, after);
  }
  if ( answer.resend === "hello" ) Hooks.callAll(HELLO_WANTED_HOOK, campaignId);
  // A listener that says nothing of what more it does, as one before Sending Stone's commands,
  // does nothing more. Since 0.30.0 it's told which event was answered, as what's sent when a
  // feature turns on differs after a hello and a heartbeat.
  if ( ANNOUNCING.has(envelope.type) ) {
    Hooks.callAll(LISTENER_FEATURES_HOOK, campaignId, answer.features, envelope.type);
  }
  // The sheets follow the hello they belong to, sent as the listener now takes them; a hello's
  // sheets are sent as it takes them anyway. Since 0.30.0 it's told the hello, which says what the
  // campaign was as it was queued.
  if ( envelope.type === EVENTS.HELLO ) Hooks.callAll(HELLO_DELIVERED_HOOK, campaignId, envelope);
  else if ( termsChanged ) Hooks.callAll(SHEET_TERMS_HOOK, campaignId);
}

/* -------------------------------------------- */

/**
 * Note a successful delivery, which tells the Gamemaster if what failed works again, and calls
 * STATUS_HOOK with the status.
 * @param {object} envelope   The envelope delivered.
 * @returns {void}
 */
function recordSuccess(envelope) {
  status.state = "ok";
  status.delivered++;
  status.lastDelivered = Date.now();
  noteDelivered(envelope);
}

/**
 * Note a dropped event. The Gamemaster is told what went wrong and what to do once per cause
 * rather than once per event, and STATUS_HOOK called; every failure is still logged to the console.
 * @param {object} envelope   The envelope that could not be delivered.
 * @param {unknown} err       Why it could not be delivered.
 * @returns {void}
 */
function recordFailure(envelope, err) {
  const message = err instanceof Error ? err.message : String(err);
  status.state = "error";
  status.dropped++;
  status.lastError = { message, at: Date.now() };
  const detail = err?.detail ? `\n${err.detail}` : "";
  console.warn(`${MODULE_ID} | Could not deliver ${envelope.type} #${envelope.sequence}: ${message}${detail}`, err);
  noteFailed(envelope, err);
  // What the listener may take later is sent again then; what it refused, as too large or with
  // the wrong secret, would be refused again.
  const temporary = (err instanceof DeliveryError) && err.retryable;
  Hooks.callAll(EVENT_DROPPED_HOOK, envelope, { temporary });
}
