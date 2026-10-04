import { MODULE_ID, PROTOCOL_VERSION, STATUS_HOOK } from "./constants.mjs";
import { describeCampaign } from "./campaigns.mjs";
import { eventsUrl, getDestination, getSecret, parseDestination } from "./config.mjs";

/**
 * Delivering events to the listener.
 *
 * Events are posted one at a time, in the order they were raised, so the listener never has to
 * reorder them. A failed post is retried a few times when the failure might be temporary, then
 * dropped: an event about a turn that has long since passed is worth less than keeping the queue
 * moving. Each envelope keeps its id across retries so the listener can discard duplicates.
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
 * Events waiting to be posted, oldest first. The event being posted is not in here.
 * @type {object[]}
 */
const queue = [];

/**
 * Is the queue currently being worked through?
 * @type {boolean}
 */
let draining = false;

/**
 * Identifies this page load, so the listener can tell a reloaded bridge from a gap in sequence.
 * Created on first use: the foundry global need not exist when this file is evaluated.
 * @type {string|null}
 */
let session = null;

/**
 * The sequence number of the last envelope built in this session, for each campaign. Each
 * campaign's events form their own stream, so a gap in one means that campaign missed something.
 * @type {Map<string, number>}
 */
const sequences = new Map();

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
   */
  constructor(message, { retryable, status, cause }={}) {
    super(message, { cause });
    this.name = "DeliveryError";
    this.retryable = retryable === true;
    this.status = status ?? null;
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
  session ??= foundry.utils.randomID(16);
  let sequence = null;
  if ( sequenced ) {
    const key = campaign?.id ?? "";
    sequence = (sequences.get(key) ?? 0) + 1;
    sequences.set(key, sequence);
  }
  return {
    protocol: PROTOCOL_VERSION,
    id: foundry.utils.randomID(16),
    session,
    sequence,
    type,
    time: new Date().toISOString(),
    world: { id: game.world.id, title: game.world.title },
    campaign: campaign ? describeCampaign(campaign) : null,
    data
  };
}

/**
 * Queue an event for delivery to the configured destination.
 * @param {string} type           One of EVENTS.
 * @param {object} data           The event payload. Must be plain, JSON-serializable data.
 * @param {Campaign} campaign     The campaign the event is for.
 * @returns {void}
 */
export function send(type, data, campaign) {
  queue.push(buildEnvelope(type, data, { campaign }));
  if ( queue.length > MAX_QUEUE ) {
    queue.shift();
    status.dropped++;
  }
  drain();
}

/* -------------------------------------------- */

/**
 * Post one envelope to the destination, without retrying.
 * @param {object} envelope                 The envelope to post.
 * @param {object} [options]
 * @param {string} [options.destination]    The destination. Defaults to the configured one.
 * @param {string} [options.secret]         The shared secret. Defaults to this browser's.
 * @returns {Promise<{status: number, elapsed: number}>}
 * @throws {DeliveryError}
 */
export async function deliver(envelope, { destination=getDestination(), secret=getSecret() }={}) {
  const parsed = parseDestination(destination);
  if ( !parsed ) {
    throw new DeliveryError(game.i18n.localize("SENDINGSTONE.Error.InvalidDestination"), { retryable: false });
  }
  const target = eventsUrl(parsed);

  let body;
  try {
    body = JSON.stringify(envelope);
  } catch (err) {
    throw new DeliveryError(err.message, { retryable: false, cause: err });
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
    const key = err?.name === "TimeoutError" ? "SENDINGSTONE.Error.Timeout" : "SENDINGSTONE.Error.Network";
    throw new DeliveryError(game.i18n.localize(key), { retryable: true, cause: err });
  }
  const elapsed = Math.round(performance.now() - started);

  if ( response.ok ) return { status: response.status, elapsed };

  // A listener that is overloaded or restarting may accept the same post later. One that
  // rejected it outright, a wrong secret for instance, will not.
  const retryable = (response.status >= 500) || [408, 425, 429].includes(response.status);
  const message = game.i18n.format("SENDINGSTONE.Error.Status", {
    status: `${response.status} ${response.statusText}`.trim()
  });
  throw new DeliveryError(message, { retryable, status: response.status });
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
      const envelope = queue.shift();

      // The destination may have been removed while events were waiting.
      if ( !getDestination() ) {
        queue.length = 0;
        break;
      }
      await deliverWithRetry(envelope);
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
  for ( let attempt = 0; ; attempt++ ) {
    try {
      await deliver(envelope);
      recordSuccess();
      return;
    } catch (err) {
      const retryable = (err instanceof DeliveryError) && err.retryable;
      if ( !retryable || (attempt >= RETRY_DELAYS.length) ) {
        recordFailure(envelope, err);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

/* -------------------------------------------- */

/**
 * Note a successful delivery, telling the Gamemaster if the listener has just come back.
 * @returns {void}
 */
function recordSuccess() {
  const recovered = status.state === "error";
  status.state = "ok";
  status.delivered++;
  status.lastDelivered = Date.now();
  if ( recovered ) ui.notifications.info("SENDINGSTONE.Notify.Recovered", { localize: true });
  Hooks.callAll(STATUS_HOOK, status);
}

/**
 * Note a dropped event. The Gamemaster is warned once when deliveries start failing rather than
 * once per event; every failure is still logged to the console.
 * @param {object} envelope   The envelope that could not be delivered.
 * @param {unknown} err       Why it could not be delivered.
 * @returns {void}
 */
function recordFailure(envelope, err) {
  const firstFailure = status.state !== "error";
  const message = err instanceof Error ? err.message : String(err);
  status.state = "error";
  status.dropped++;
  status.lastError = { message, at: Date.now() };
  console.warn(`${MODULE_ID} | Could not deliver ${envelope.type} #${envelope.sequence}: ${message}`, err);
  if ( firstFailure ) {
    ui.notifications.warn(game.i18n.format("SENDINGSTONE.Notify.Failing", { error: message }));
  }
  Hooks.callAll(STATUS_HOOK, status);
}
