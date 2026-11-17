import { HIT_POINT_OPS, MOST_HIT_POINTS } from "./constants.mjs";

/**
 * What the checks of a command fetched from the Sending Stone app ask in common: whether a command
 * names anything a roll names its item, targets, prompt or link by, and whether it throws no dice;
 * whether a value is a plain object, or an id as the app sends one. And one kind's check whole, with
 * its two tables: hit points', which command-hit-points.mjs sets from the app.
 *
 * command-rolls.mjs holds `checkCommand`, and beside it most kinds' own checks, each with the
 * tables it alone reads. Two kinds' can't stand there with the rest: a move's, a note's and hit
 * points' each read a table named `FIELDS`, and a spell prepared's and hit points' one named
 * `OTHERS`, and a file holds one of a name. So a note's check is in journals.mjs, which keeps what
 * a note is, and hit points' is here.
 *
 * Both of those files are below command-rolls.mjs, which asks them their checks. So what those two
 * checks ask in their turn, as other kinds' do, is here as well, in a file importing only
 * constants.mjs: asked of command-rolls.mjs, each of the two would import the file that imports
 * it. (Whether a value is a plain object, a note's check asks journals.mjs's own `isObject`, the
 * same test as the one here.)
 *
 * Hit points' `FIELDS` says where each of them is kept, which command-hit-points.mjs writes them
 * by: it leaves this file under a name that says what it is, `HIT_POINT_FIELDS`.
 */

/**
 * The fields a command names its item, activity, targets, prompt or link by, none of which ending
 * a concentration, spending charges or Heroic Inspiration names, nor a move of items and coins.
 * @type {string[]}
 */
const ROLL_FIELDS = [
  "enchant", "item", "activity", "target", "targets", "self", "slot", "prompt", "text", "link", "key"
];

/**
 * Does a command name anything it's no roll at, as ROLL_FIELDS has them?
 * @param {object} command
 * @returns {boolean}
 */
export function namesRollFields(command) {
  return ROLL_FIELDS.some(field => (command[field] !== undefined) && (command[field] !== null));
}

/**
 * Is a command one that throws no dice: with no advantage, nothing added and no dice?
 * @param {object} command
 * @returns {boolean}
 */
export function throwsNoDice(command) {
  if ( (command.mode !== 0) || (command.explicit !== false) ) return false;
  const none = list => (list === undefined) || (list === null) || (Array.isArray(list) && !list.length);
  return none(command.extras) && none(command.dice);
}

/**
 * Is this a plain object, rather than null or an array?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isObject(value) {
  return Boolean(value) && (typeof value === "object") && !Array.isArray(value);
}

/**
 * Is this the id of a document, as the app sends it?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isId(value) {
  return (typeof value === "string") && (value.length > 0) && (value.length <= 64);
}

/**
 * The fields a player may set, as the command and its `from` name them, and where each is kept.
 * @type {Record<string, string>}
 */
const FIELDS = { value: "system.attributes.hp.value", temp: "system.attributes.hp.temp" };

export { FIELDS as HIT_POINT_FIELDS };

/**
 * What else a command may name, none of which setting hit points names: another kind's own fields.
 * @type {string[]}
 */
const OTHERS = [
  "transfer", "remove", "typed", "rerolls", "favorite", "note", "dish", "effect", "wildShape", "spellSlot", "counter",
  "count", "inspiration", "concentration", "enchantment", "prepare", "turn", "undo"
];

/**
 * Why a fetched setting of hit points isn't one to make, if it isn't: it names exactly
 * `{ op: "set", value?, temp?, from }`, at least one of the two fields, each a whole number from 0 to
 * MOST_HIT_POINTS, and `from` the same fields, as the app showed them; and nothing else, nothing a
 * roll names nor any other kind's field, and throws no dice. Only its player sets them from the app:
 * it posts nothing, so would leave no mark of the Gamemaster's.
 * @param {object} command
 * @returns {string|null}
 */
export function checkHitPointsCommand(command) {
  if ( command.by === "gm" ) return "by";
  const given = value => (value !== undefined) && (value !== null);
  if ( namesRollFields(command) || OTHERS.some(key => given(command[key])) ) return "hitPoints";
  if ( !isHitPoints(command.hitPoints) ) return "hitPoints";
  return throwsNoDice(command) ? null : "dice";
}

/**
 * Is this a setting of hit points as the app sends one?
 * @param {unknown} set
 * @returns {boolean}
 */
function isHitPoints(set) {
  if ( !isObject(set) || !HIT_POINT_OPS.includes(set.op) || !isObject(set.from) ) return false;
  const fields = Object.keys(FIELDS).filter(key => Object.hasOwn(set, key));
  if ( !fields.length || (Object.keys(set).length !== fields.length + 2) ) return false;
  const from = Object.keys(set.from);
  if ( (from.length !== fields.length) || !fields.every(key => from.includes(key)) ) return false;
  const number = value => Number.isInteger(value) && (value >= 0) && (value <= MOST_HIT_POINTS);
  return fields.every(key => number(set[key]) && number(set.from[key]));
}
