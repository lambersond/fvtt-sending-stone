import { DISH_KINDS, DISH_VERSIONS, MODULE_ID } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { characterPlayers } from "./characters.mjs";
import { checkCommand, failedResult } from "./command-rolls.mjs";
import { commandActor } from "./creatures.mjs";
import { dishTombstone, postDishCard, resendDishDecision, resendTombstone } from "./dish-card.mjs";
import { dishSystem } from "./dish-effects.mjs";

/**
 * Dishes from the Magical Recipe Book, since module 0.38.0: a dish a player cooks and eats in the
 * cookbook reaches the app by their link code, and the app hands it here as a `dish` command, which
 * this posts as a card the Gamemasters and the campaign's players see; only Gamemasters choose who
 * ate it, from that card, and each gets its effect for the time the cookbook gives it, one dish at a
 * time (dish-card.mjs, dish-effects.mjs); the app hears of the choice in `dish.applied` or
 * `dish.dismissed`.
 *
 * The app hands a dish over until a result answers it, as it does journal notes, so the same command
 * may arrive again: after a reload, a result lost on its way, or while its first run still goes. So
 * it's posted at most once: a command whose card is in the chat log answers again from it, and posts
 * nothing; and so does one whose card was deleted, decided or not, from its tombstone. The result
 * answers the card's being posted, never the Gamemaster's choice.
 *
 * Each campaign takes dishes by its own switch, off until its Gamemaster turns it on, and only under
 * dnd5e 5; and only from an app that says it takes them, `features.dishes`, which then fetches for
 * them with every other switch off. A cook who has left the campaign still gets a card: the player's
 * dish was already taken, and a roster change mustn't lose it.
 */

/**
 * The dish commands being made, by id, with how many runs of each are under way.
 * @type {Map<string, number>}
 */
const inFlight = new Map();

/* -------------------------------------------- */
/*  Whether dishes are taken here               */
/* -------------------------------------------- */

/**
 * Does a campaign take dishes: by its own switch, under dnd5e 5.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function dishesOn(campaign) {
  return (campaign.dishes === true) && dishSystem();
}

/**
 * What a campaign tells the app of dishes in its hello: whether it takes them, the kind its commands
 * are and the cookbook body versions it reads; and if not, why not, its switch off or the system.
 * @param {Campaign} campaign
 * @returns {{enabled: boolean, kinds: string[], reason: "off"|"system"|null, versions: number[]}}
 */
export function dishFeatures(campaign) {
  if ( campaign.dishes !== true ) return { enabled: false, kinds: [], reason: "off", versions: [] };
  if ( !dishSystem() ) return { enabled: false, kinds: [], reason: "system", versions: [] };
  return { enabled: true, kinds: [...DISH_KINDS], reason: null, versions: [...DISH_VERSIONS] };
}

/**
 * Is a dish command with this id being made now, from when its run starts until it settles: a
 * hand-over of it meanwhile is the same dish, which this run answers.
 * @param {string} commandId
 * @returns {boolean}
 */
export function dishInFlight(commandId) {
  return inFlight.has(commandId);
}

/**
 * The card a dish command posted, the latest, if the chat log holds it.
 * @param {string} commandId
 * @returns {ChatMessage|null}
 */
export function findDishCard(commandId) {
  return game.messages.contents.findLast(message => message.flags?.[MODULE_ID]?.dish?.command === commandId) ?? null;
}

/* -------------------------------------------- */
/*  A dish                                      */
/* -------------------------------------------- */

/**
 * Take a dish fetched from the app: its card posted, once however often it's handed over, and the
 * result answering that.
 * @param {object} command      `{dish: {queuedAt, body}}`, as fetched.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export function runDishCommand(command, campaign) {
  const id = command.id;
  inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  return dishNow(command, campaign).finally(() => {
    const left = (inFlight.get(id) ?? 1) - 1;
    if ( left > 0 ) inFlight.set(id, left);
    else inFlight.delete(id);
  });
}

/**
 * Take a dish now, if the campaign takes them, as it now is: a card posted already answers again, and
 * its decision, if it has one, goes again; one deleted undecided answers from its tombstone, set
 * aside, its deletion going again, and posts nothing, as the app may hand the command over again
 * before it hears of the deletion; and one deleted decided answers its choice from its tombstone,
 * its decision going again where this session kept it, and posts nothing either. Otherwise its card,
 * whose create failing is an error the app hands it over again for. Since 0.39.0 the result says
 * whether the cook's player reads the card, `visible`; one answered from a tombstone, no card, never.
 * @param {object} command
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
async function dishNow(command, passed) {
  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !dishesOn(campaign) ) return failedResult(command, "off");
  const invalid = checkCommand(command);
  if ( invalid ) return failedResult(command, "invalid", invalid);
  const answer = (card, state, visible=false) => ({
    id: command.id, status: "done", reason: null, error: null, messageId: card, visible, rolls: [],
    dish: { card, state }
  });
  const found = findDishCard(command.id);
  if ( !found ) {
    const tombstone = dishTombstone(command.id.slice("dish-".length));
    if ( tombstone ) {
      resendTombstone(tombstone, campaign);
      return answer(tombstone.data.card, tombstone.state ?? "dismissed");
    }
  }
  if ( found ) resendDishDecision(found);
  const card = found ?? await postDishCard(command, campaign);
  return answer(card.id, card.getFlag(MODULE_ID, "dish")?.state ?? "waiting", cookReads(card, command, campaign));
}

/**
 * Is the card whispered to a player of the cook's character, still the campaign's? A card module
 * 0.38.x posted, whispered to the Gamemasters alone, isn't. Since 0.46.0 its players are read as the
 * card's readers are (`characterPlayers`), so the two agree; before, they were every player with
 * Owner on it, through `default` too.
 * @param {ChatMessage} card
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function cookReads(card, command, campaign) {
  // The character, never her form while she's shaped (since 0.40.0).
  const cook = commandActor(command, campaign)?.character;
  if ( !cook ) return false;
  const readers = new Set(card.whisper ?? []);
  return characterPlayers(cook).some(user => readers.has(user.id));
}
