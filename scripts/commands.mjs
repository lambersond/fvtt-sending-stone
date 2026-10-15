import { ATTACK_KINDS, ENCHANT_KINDS, EVENTS, MODULE_ID, PROTOCOL_VERSION, ROLL_KINDS } from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { describeCampaign, getCampaigns, manualDiceOn } from "./campaigns.mjs";
import { commandsUrl, getDestination, getSecret, parseDestination } from "./config.mjs";
import { noteFetched, noteFetchFailed } from "./delivery-status.mjs";
import { runEndEnchantmentCommand } from "./command-enchant.mjs";
import { attacksUnavailable, runDamageCommand, runUseCommand } from "./command-uses.mjs";
import { failedResult, HIT_DICE_KINDS, runRollCommand } from "./command-rolls.mjs";
import { runAskCommand, runTextDamageCommand, runTextRollCommand, textKinds } from "./command-texts.mjs";
import { gmRollOf } from "./chat-data.mjs";
import { diceStatus } from "./dice-plan.mjs";
import { answersMidiPrompt, midiPromptsOffered, noteMidiReader, noteOpen } from "./midi-prompts.mjs";
import { prompting } from "./prompts.mjs";
import { checksOffered } from "./sheet-rolls.mjs";
import { currentSession, DeliveryError, refusalError, send } from "./transport.mjs";

/**
 * Fetching what players ask the game to do from the Sending Stone app: their rolls, their attacks,
 * their spells and features, and what the links in their descriptions do.
 *
 * The app can't reach the Gamemaster's browser, so the bridge fetches from it instead, for each
 * campaign that lets its players roll from the app. While a player has their table open, the app
 * holds each fetch open until a roll comes, so it reaches the game at once; otherwise it answers
 * at once, saying how long to wait before fetching again. Only an app that says, in its answer to
 * a campaign's hello or heartbeat, that it has commands is fetched from: an older one would refuse
 * the fetch in a way a browser can't tell from the app being unreachable.
 *
 * A fetch the app refuses as the campaign is set up, as for a wrong secret or one it couldn't
 * read, isn't made again until the settings change or the campaign's hello is sent; one that may
 * work later, as with the app unreachable, is, after a while. Since 0.23.0 the Gamemaster is told
 * of either, as delivery-status.mjs tells them of a post's failure.
 */

/**
 * How long a fetch may take before it is given up on, in milliseconds: longer than the app holds
 * one open.
 * @type {number}
 */
const FETCH_TIMEOUT = 35_000;

/**
 * How long to wait before fetching again after each failure in a row, in milliseconds.
 * @type {number[]}
 */
const BACKOFF = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];

/**
 * The longest wait the app may ask for, in milliseconds.
 * @type {number}
 */
const MAX_WAIT = 300_000;

/**
 * How long a roll may take to make before the app is told it took too long, in milliseconds. A
 * module may stop it to ask the Gamemaster something, as Midi-QOL can for an optional bonus.
 * @type {number}
 */
const WATCHDOG = 60_000;

/**
 * How many of the latest commands are remembered, so that one fetched twice is made once.
 * @type {number}
 */
const REMEMBERED = 200;

/**
 * The campaigns the app said it has commands for, in its last answer to their hello or heartbeat.
 * @type {Set<string>}
 */
const offered = new Set();

/**
 * Campaigns whose fetch the app refused, as for a wrong secret, until the settings change.
 * @type {Set<string>}
 */
const refused = new Set();

/**
 * The reasons a fetch fails for that may not last, after which it's made again, after a while.
 * @type {Set<string>}
 */
const PASSING = new Set(["unreachable", "timeout", "unavailable", "rateLimited"]);

/**
 * Each campaign's poller, while it runs, by campaign id.
 * @type {Map<string, Poller>}
 */
const pollers = new Map();

/**
 * The ids of the latest commands taken, oldest first.
 * @type {string[]}
 */
const taken = [];

/**
 * The latest roll of each character, which its next roll waits for, by actor id.
 * @type {Map<string, Promise<void>>}
 */
const queues = new Map();

/**
 * The most chat messages a Gamemaster's roll's result lists.
 * @type {number}
 */
const MOST_MESSAGES = 20;

/**
 * The chat messages each of the Gamemaster's rolls being made has made, by the roll's id, in the
 * order made: the messages flagged as theirs that this client created for it, or marked for it.
 * @type {Map<string, string[]>}
 */
const made = new Map();

/* -------------------------------------------- */

/**
 * What a campaign tells the app of its players' rolls in its hello: whether they're made here,
 * which, and if not, why not. A hit die, and several spent at once, are among them once the
 * self-test has shown a hit die takes the player's die. Attacks, the uses of spells and features,
 * and their damage are among them when the Gamemaster lets the campaign's players attack and cast
 * from the app too, and they can be made here, and ending an enchantment of theirs with them; and
 * then that an area attack is made at the targets they pick. The links in their descriptions are
 * among them too: a description's own roll, asking the table for a save, where dnd5e's card for it
 * can be made, and a description's damage or healing, where players may attack and damage takes
 * their dice. Where their damage is, an attack's or a description's, whether players may change it
 * in the app, as the self-test found. Whether its players are asked in the app for the saves the
 * game asks of them. And whether a check their check activities call for, such as Fast Hands'
 * Sleight of Hand, may be rolled for the activity, against its DC, under dnd5e 5.x, where check
 * activities are made here. And, from module 0.21.0, that more dice and another die change only a
 * die the damage adds, never one it takes away, which previews mark (`signedDice`); from 0.22.0,
 * that a use may be made at its user, `self`, beside those picked, wherever uses are made
 * (`selfTargets`); and from 0.23.0, that a command may say it's the Gamemaster's, `by`, made as
 * the character's and marked as theirs, wherever rolls are made (`gmRolls`); from 0.25.0, that
 * the result of such a command lists the chat messages it made (`gmRollMessages`), so that only
 * those are taken as the Gamemaster's; from 0.26.0, whether its players may enter their own dice
 * results in the app, with Manual Dice (`manualDice`), which the app doesn't offer yet; and from
 * 0.27.0, whether the saves Midi-QOL asks of them are asked in the app too (`midiPrompts`).
 * @param {Campaign} campaign
 * @returns {{enabled: boolean, kinds: string[], reason: string|null, modifiers: boolean,
 *   areaAttacks: boolean, prompts: boolean, activityChecks: boolean, signedDice: boolean,
 *   selfTargets: boolean, gmRolls: boolean, gmRollMessages: boolean, manualDice: boolean,
 *   midiPrompts: boolean}}
 */
export function rollFeatures(campaign) {
  const off = {
    enabled: false, kinds: [], modifiers: false, areaAttacks: false, prompts: false, activityChecks: false,
    signedDice: false, selfTargets: false, gmRolls: false, gmRollMessages: false, manualDice: false,
    midiPrompts: false
  };
  if ( !campaign.rolls ) return { ...off, reason: "off" };
  if ( !diceStatus.ready ) return { ...off, reason: diceStatus.reason };
  const attacks = campaign.attacks && !attacksUnavailable();
  const texts = textKinds(campaign);
  return {
    enabled: true,
    kinds: [
      ...ROLL_KINDS.filter(kind => !HIT_DICE_KINDS.includes(kind) || diceStatus.hitDice),
      ...(attacks ? [...ATTACK_KINDS, ...ENCHANT_KINDS] : []),
      ...texts
    ],
    reason: null,
    modifiers: (attacks || texts.includes("textDamage")) && diceStatus.modifiers,
    areaAttacks: attacks,
    prompts: prompting(campaign),
    activityChecks: checksOffered(),
    signedDice: true,
    selfTargets: attacks,
    gmRolls: true,
    gmRollMessages: true,
    manualDice: manualDiceOn(campaign),
    midiPrompts: midiPromptsOffered(campaign)
  };
}

/**
 * Register the hooks that note which chat messages the Gamemaster's rolls make.
 * @returns {void}
 */
export function registerCommandHooks() {
  Hooks.on("createChatMessage", (message, _options, userId) => noteMessageMade(message, userId));
  // dnd5e 5.3's message of a death save's outcome is marked as the Gamemaster's once made.
  Hooks.on("updateChatMessage", (message, changed, _options, userId) => {
    if ( changed?.flags?.[MODULE_ID] ) noteMessageMade(message, userId);
  });
}

/**
 * Note what the app said it does beyond taking events, answering a campaign's hello or heartbeat:
 * since 0.27.0, whether it reads Midi-QOL's prompts too.
 * @param {string} campaignId
 * @param {object|null} features   Such as `{commands: true}`; null when it said nothing.
 * @returns {void}
 */
export function noteListenerFeatures(campaignId, features) {
  if ( features?.commands === true ) offered.add(campaignId);
  else offered.delete(campaignId);
  noteMidiReader(campaignId, features);
  syncPollers();
}

/**
 * Fetch for each campaign that lets its players roll from the app, and that the app has commands
 * for, while this client is the bridge; and for no other.
 * @param {object} [options]
 * @param {boolean} [options.retry]   Try again the campaigns whose fetch the app refused, as after
 *                                    a change to the settings.
 * @returns {void}
 */
export function syncPollers({ retry=false }={}) {
  if ( retry ) refused.clear();
  const wanted = new Set();
  if ( canSend() && diceStatus.ready ) {
    for ( const campaign of getCampaigns() ) {
      if ( campaign.rolls && offered.has(campaign.id) && !refused.has(campaign.id) ) wanted.add(campaign.id);
    }
  }
  for ( const [id, poller] of pollers ) {
    if ( !wanted.has(id) ) poller.stop();
  }
  for ( const id of wanted ) {
    if ( !pollers.has(id) ) new Poller(id).start();
  }
}

/**
 * Stop fetching, as when this client is no longer the bridge.
 * @returns {void}
 */
export function stopPollers() {
  for ( const poller of pollers.values() ) poller.stop();
}

/**
 * Does a fetch that failed for this reason stop fetching for its campaign? Every refusal does
 * that isn't retried, until the settings change or its hello is sent: as it's set up, the next
 * fetch would be refused too.
 * @param {string} reason   One of delivery-status.mjs's REASONS.
 * @returns {boolean}
 */
export function stopsFetching(reason) {
  return !PASSING.has(reason);
}

/* -------------------------------------------- */

/**
 * Fetches one campaign's commands from the app, one fetch after another, until stopped.
 */
class Poller {
  /**
   * @param {string} campaignId
   */
  constructor(campaignId) {
    this.campaignId = campaignId;
    this.stopped = false;

    /**
     * Gives up the fetch under way.
     * @type {AbortController|null}
     */
    this.controller = null;

    /**
     * Ends the wait under way.
     * @type {(() => void)|null}
     */
    this.wake = null;
  }

  /** @returns {void} */
  start() {
    pollers.set(this.campaignId, this);
    void this.#run();
  }

  /** @returns {void} */
  stop() {
    this.stopped = true;
    this.controller?.abort();
    this.wake?.();
    if ( pollers.get(this.campaignId) === this ) pollers.delete(this.campaignId);
  }

  /**
   * Fetch until stopped, waiting as the app asks, and longer after each failure in a row.
   * @returns {Promise<void>}
   */
  async #run() {
    let failures = 0;
    while ( !this.stopped ) {
      const campaign = getCampaigns().find(({ id }) => id === this.campaignId);
      if ( !campaign?.rolls || !canSend() ) break;
      let answer;
      try {
        answer = await this.#fetch(campaign);
        failures = 0;
        noteFetched(campaign.id);
      } catch (err) {
        if ( this.stopped ) break;
        failures++;
        // The app won't take this campaign's fetch as it's set up: not until the settings change.
        const stop = stopsFetching(err?.reason);
        noteFetchFailed(campaign, err, { stopped: stop, failures });
        if ( stop ) {
          console.warn(`${MODULE_ID} | The app refused to send ${campaign.title}'s rolls: ${err?.message ?? err}`);
          refused.add(this.campaignId);
          break;
        }
        await this.#pause(BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)]);
        continue;
      }
      // Which of its characters the app has open decides whether Midi-QOL's saves wait on it.
      noteOpen(this.campaignId, answer.open);
      // The Gamemaster may have changed the campaign while the fetch was held open: its commands are
      // made as it now is.
      const current = getCampaigns().find(({ id }) => id === this.campaignId) ?? campaign;
      for ( const command of answer.commands ) take(command, current);
      if ( answer.wait > 0 ) await this.#pause(Math.min(answer.wait, MAX_WAIT));
    }
    this.stop();
  }

  /**
   * Fetch the campaign's commands once, and since 0.27.0 which of its characters the app has open,
   * `open`, as it lists them; none where it lists none, as an older app.
   * @param {Campaign} campaign
   * @returns {Promise<{commands: object[], wait: number, open: unknown}>}
   * @throws {DeliveryError}   Saying why, as a post's does.
   */
  async #fetch(campaign) {
    const destination = parseDestination(getDestination());
    const network = (key, reason, cause) => new DeliveryError(game.i18n.localize(`SENDINGSTONE.Error.${key}`), {
      retryable: true, reason, cause
    });
    if ( !destination ) throw network("InvalidDestination", "unreachable");
    const headers = { "Content-Type": "application/json" };
    const secret = getSecret(campaign.id);
    if ( secret ) headers.Authorization = `Bearer ${secret}`;

    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      let response;
      try {
        response = await fetch(commandsUrl(destination), {
          method: "POST",
          headers,
          body: JSON.stringify({
            protocol: PROTOCOL_VERSION,
            session: currentSession(),
            campaign: describeCampaign(campaign)
          }),
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal
        });
      } catch (err) {
        // Given up on after 35 seconds, unless it was stopped, which is no failure.
        const timeout = ["AbortError", "TimeoutError"].includes(err?.name);
        throw network(timeout ? "Timeout" : "Network", timeout ? "timeout" : "unreachable", err);
      }
      if ( !response.ok ) throw await refusalError(response, { secret });
      let answer;
      try {
        answer = await response.json();
      } catch (err) {
        // Something other than the app answered, as at a wrong address.
        throw network("Network", "unreachable", err);
      }
      const commands = Array.isArray(answer?.commands) ? answer.commands : [];
      return {
        commands: commands.filter(command => command && (typeof command === "object")),
        wait: Number.isFinite(answer?.wait) ? answer.wait : 0,
        open: answer?.open
      };
    } finally {
      clearTimeout(timer);
      if ( this.controller === controller ) this.controller = null;
    }
  }

  /**
   * Wait this long, or until stopped.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #pause(ms) {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        if ( this.wake === done ) this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }
}

/* -------------------------------------------- */

/**
 * Take a command to make: once, however often it's fetched, and after the same character's
 * earlier rolls, in the order they were made. An answer to a save Midi-QOL asked is made at once:
 * Midi waits on it, perhaps inside one of those earlier rolls, as a player's spell from the app
 * that asks them for a save.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {void}
 */
function take(command, campaign) {
  if ( (typeof command.id !== "string") || taken.includes(command.id) ) return;
  taken.push(command.id);
  if ( taken.length > REMEMBERED ) taken.shift();
  if ( answersMidiPrompt(command) ) {
    void make(command, campaign).catch(err => {
      console.error(`${MODULE_ID} | Could not report a roll from Sending Stone`, err);
    });
    return;
  }

  const actorId = String(command.actorId);
  const made = (queues.get(actorId) ?? Promise.resolve())
    .then(() => make(command, campaign))
    .catch(err => console.error(`${MODULE_ID} | Could not report a roll from Sending Stone`, err));
  queues.set(actorId, made);
  void made.finally(() => {
    if ( queues.get(actorId) === made ) queues.delete(actorId);
  });
}

/**
 * Make a command, and tell the app what became of it. One that takes too long is reported as such,
 * and the character's next roll goes ahead; if it's made after all, as once the Gamemaster has
 * answered what a module asked them, the app is told so too; and so it is of hit dice spent at
 * once, some of which were spent before they stopped for it. A Gamemaster's roll's result lists
 * the chat messages it has made, by then.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {Promise<void>}
 */
async function make(command, campaign) {
  if ( command.by === "gm" ) made.set(command.id, []);
  let timer;
  const watchdog = new AbortController();
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      watchdog.abort();
      resolve(failedResult(command, "timeout"));
    }, WATCHDOG);
  });
  const running = runCommand(command, campaign, watchdog.signal).catch(err => {
    console.error(`${MODULE_ID} | Could not make a roll from Sending Stone`, err);
    return failedResult(command, "error", err instanceof Error ? err.message : String(err));
  });
  try {
    const result = await Promise.race([running, timeout]);
    send(EVENTS.COMMAND_RESULT, withMessages(command, result), campaign, { sequenced: false });
    if ( watchdog.signal.aborted ) {
      void running.then(late => {
        if ( (late.status === "done") || (late.spent?.made > 0) ) {
          send(EVENTS.COMMAND_RESULT, withMessages(command, late), campaign, { sequenced: false });
        }
      });
    }
  } finally {
    clearTimeout(timer);
    // One that took too long may make more messages, for its late result; after that, none.
    void running.finally(() => made.delete(command.id));
  }
}

/**
 * A result as the app is told it: a Gamemaster's roll's with the ids of the chat messages it has
 * made, in the order made, none if it made none; a player's as it is.
 * @param {object} command
 * @param {CommandResult} result
 * @returns {CommandResult}
 */
function withMessages(command, result) {
  if ( command.by !== "gm" ) return result;
  return { ...result, messages: [...(made.get(command.id) ?? [])] };
}

/**
 * Note a chat message as made by the Gamemaster's roll it's flagged for, while that roll is being
 * made: only one this client created or marked, as the module does, never one a player's browser
 * did, as their own message with a roll's flags copied onto it. A module that creates messages on
 * this client for players, as Midi-QOL's createChatMessage socket does, could have such a copy
 * listed while the roll is made. Its speaker can't narrow it: dnd5e posts a utility's formula with
 * none.
 * @param {ChatMessage} message
 * @param {string} userId   Who created or changed it.
 * @returns {void}
 */
function noteMessageMade(message, userId) {
  if ( userId !== game.user?.id ) return;
  const list = made.get(gmRollOf(message).gmRoll);
  if ( list && !list.includes(message.id) && (list.length < MOST_MESSAGES) ) list.push(message.id);
}

/**
 * Make a command of whichever kind it is.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {AbortSignal} signal   Aborted once the app has been told the command took too long.
 * @returns {Promise<CommandResult>}
 */
function runCommand(command, campaign, signal) {
  switch ( command.kind ) {
    case "attack":
    case "use": return runUseCommand(command, campaign, { signal });
    case "damage": return runDamageCommand(command, campaign);
    case "endEnchantment": return runEndEnchantmentCommand(command, campaign);
    case "ask": return runAskCommand(command, campaign);
    case "textDamage": return runTextDamageCommand(command, campaign);
    case "textRoll": return runTextRollCommand(command, campaign);
    default: return runRollCommand(command, campaign, { signal });
  }
}
