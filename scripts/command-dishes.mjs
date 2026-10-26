import {
  DISH_KINDS, DISH_OUTCOMES, DISH_VERSIONS, EVENTS, MODULE_ID, MOST_DISH_CHANGES, MOST_DISH_INGREDIENTS
} from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { playerOwners } from "./characters.mjs";
import { dnd5eGeneration } from "./command-alone.mjs";
import { checkCommand, failedResult, isId, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { commandActor } from "./creatures.mjs";
import { dishTombstone, postDishCard, resendDishDecision, resendDishDecisions, resendTombstone } from "./dish-card.mjs";

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
 * The campaigns whose app takes dishes, by id, as their latest answer to a hello or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * The dish commands being made, by id, with how many runs of each are under way.
 * @type {Map<string, number>}
 */
const inFlight = new Map();

/* -------------------------------------------- */
/*  Whether dishes are taken here               */
/* -------------------------------------------- */

/**
 * Is the system one dishes are taken under: dnd5e 5, whose paths the mapping writes. dnd5e 6.0.5
 * shims the bonus keys the mapping writes (D6 documents/active-effect.mjs:75-101), so 6 is off as a
 * choice of scope, untested, its exhaustion and its expiry being its own (D6
 * documents/active-effect.mjs:803-807). 5.3.3 is the 5.x tested, the harness's pin, so the README
 * names it as the version tested rather than this refusing other 5.x releases.
 * @returns {boolean}
 */
export function dishSystem() {
  return (game.system.id === "dnd5e") && (dnd5eGeneration() === 5);
}

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
 * Note whether a campaign's app takes dishes: `features.dishes`, 1 or later. One that starts to in a
 * heartbeat's answer, as an app deployed mid-session does, is sent the campaign's decided dishes at
 * once, on the bridge; after a hello's, they follow it (character-sync.mjs). One that says nothing of
 * them, as an older or rolled back app, is fetched from for them no longer, and sent no dish events.
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteDishReader(campaignId, features, type) {
  const format = features?.dishes;
  if ( !(Number.isInteger(format) && (format >= 1)) ) {
    readers.delete(campaignId);
    return;
  }
  const was = readers.has(campaignId);
  readers.add(campaignId);
  if ( was || (type !== EVENTS.HEARTBEAT) ) return;
  const campaign = getCampaigns().find(({ id }) => id === campaignId);
  if ( campaign ) resendDishDecisions(campaign);
}

/**
 * Does a campaign's app take dishes?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function dishReader(campaignId) {
  return readers.has(campaignId);
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
 * Why a fetched dish isn't one to take, if it isn't: it names nothing a roll names, no move, removal,
 * anything typed in, note or favorite, and isn't the Gamemaster's; its body is a version this reads,
 * of a dish with an id, a recipe and an outcome, a cook and a message; a boon or bane has an effect,
 * with a name for it, at most 20 ingredients, a duration of whole seconds that doesn't stack, and at
 * most 100 changes, each with a kind, whose own fields are checked as each is mapped; a standard dish
 * has none; and it throws no dice.
 * @param {object} command
 * @returns {string|null}
 */
export function checkDishCommand(command) {
  const given = value => (value !== undefined) && (value !== null);
  const text = (value, most) => (typeof value === "string") && (value.length >= 1) && (value.length <= most);
  if ( namesRollFields(command) || ["transfer", "remove", "typed", "note", "favorite"].some(key => given(command[key])) ) {
    return "dish";
  }
  if ( given(command.by) ) return "by";
  const { dish } = command;
  if ( !isObject(dish) || !(Number.isInteger(dish.queuedAt) && (dish.queuedAt > 0)) || !isObject(dish.body) ) return "dish";
  const { body } = dish;
  if ( !DISH_VERSIONS.includes(body.version) ) return "version";
  const about = body.dish;
  if ( !isObject(about) || !isId(about.id) || !text(about.recipe, 200) || !DISH_OUTCOMES.includes(about.outcome) ) return "body.dish";
  if ( !isObject(body.cook) || (typeof body.cook.name !== "string") ) return "body.cook";
  if ( typeof body.message !== "string" ) return "body.message";
  const effect = body.effect;
  if ( about.outcome === "standard" ) return (effect === null) ? (throwsNoDice(command) ? null : "dice") : "body.effect";
  const ingredient = i => isObject(i) && (typeof i.name === "string") && (typeof i.text === "string");
  // An effect's name may not be blank, or every character's create would fail.
  if ( !isObject(effect) || !text(effect.name, 300) || !Array.isArray(effect.ingredients)
    || (effect.ingredients.length > MOST_DISH_INGREDIENTS) || !effect.ingredients.every(ingredient)
    || !(Number.isInteger(effect.duration?.seconds) && (effect.duration.seconds > 0)) || (effect.stacks !== false) ) {
    return "body.effect";
  }
  if ( !Array.isArray(effect.changes) || (effect.changes.length > MOST_DISH_CHANGES)
    || !effect.changes.every(change => isObject(change) && (typeof change.type === "string")) ) return "body.changes";
  return throwsNoDice(command) ? null : "dice";
}

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
 * Is the card whispered to a player who owns the cook's character, still the campaign's? A card
 * module 0.38.x posted, whispered to the Gamemasters alone, isn't.
 * @param {ChatMessage} card
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function cookReads(card, command, campaign) {
  const cook = commandActor(command, campaign)?.actor;
  if ( !cook ) return false;
  const readers = new Set(card.whisper ?? []);
  return playerOwners(cook).some(user => readers.has(user.id));
}
