import { EVENTS } from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { send, sinceLastSent } from "./transport.mjs";

/**
 * Telling each campaign that the bridge is still connected.
 *
 * The listener cannot reach the Gamemaster's browser, so it only knows the game is connected
 * while events keep arriving. Between events, each campaign is sent a heartbeat. Any other event
 * says the same, so a heartbeat only goes to a campaign that has been sent nothing for a while.
 */

/**
 * How long a campaign goes without an event before it is sent a heartbeat, in milliseconds.
 * @type {number}
 */
export const HEARTBEAT_AFTER = 30_000;

/**
 * How often to check for campaigns due a heartbeat, in milliseconds.
 * @type {number}
 */
const CHECK_EVERY = 10_000;

/**
 * The timer checking for campaigns due a heartbeat, once started.
 * @type {number|null}
 */
let timer = null;

/**
 * Start sending heartbeats. Every client runs the check, but only the bridge sends.
 * @returns {void}
 */
export function startHeartbeat() {
  timer ??= setInterval(heartbeat, CHECK_EVERY);
}

/**
 * Send a heartbeat to each campaign that has been sent nothing for a while.
 * @returns {void}
 */
export function heartbeat() {
  if ( !canSend() ) return;
  for ( const campaign of getCampaigns() ) {
    if ( sinceLastSent(campaign.id) < HEARTBEAT_AFTER ) continue;
    send(EVENTS.HEARTBEAT, {}, campaign, { sequenced: false });
  }
}
