import { DAMAGE_FACES, DIE_FACES, MODULE_ID, ROLL_TAG } from "./constants.mjs";

/**
 * Making a player's roll here with the dice they rolled in the Sending Stone app.
 *
 * A player's roll is made through dnd5e as if they had rolled it in Foundry, so its card, its
 * critical hits, Dice So Nice and modules such as Midi-QOL all behave as they always do. Only the
 * dice are the player's: each roll made for them is tagged with their roll's id, and while that roll
 * is being made, each die it throws takes the next value the player rolled for that kind of die.
 * A die the player didn't roll, such as a third d20 for Elven Accuracy, a d4 for Bless, or a
 * Halfling's reroll of a 1, is rolled by Foundry as usual, and Foundry's total is the roll's total.
 */

/**
 * A player's roll being made, with the dice they rolled.
 */
class DicePlan {
  /**
   * @param {object} command   The player's roll, as fetched from the app.
   */
  constructor(command) {
    this.command = command;

    /**
     * The values not yet used, by the faces of the die rolled, in the order they were rolled.
     * @type {Map<number, number[]>}
     */
    this.queues = new Map();
    for ( const { faces, results } of command.dice ?? [] ) {
      const queue = this.queues.get(faces) ?? [];
      queue.push(...results);
      this.queues.set(faces, queue);
    }

    /**
     * Has the roll been made? Its tag, kept in its message, then matches nothing.
     * @type {boolean}
     */
    this.ended = false;

    /**
     * Why the roll was called off here, if it was: "dice", where the player's dice can't be used.
     * @type {string|null}
     */
    this.refusal = null;
  }

  /**
   * The next value the player rolled on a die with this many faces, if one is left.
   * @param {number} faces
   * @returns {number|undefined}
   */
  take(faces) {
    if ( this.ended ) return undefined;
    const queue = this.queues.get(faces);
    const value = queue?.[0];
    if ( !Number.isInteger(value) || (value < 1) || (value > faces) ) return undefined;
    queue.shift();
    served++;
    return value;
  }

  /**
   * How many values are left for dice with this many faces.
   * @param {number} faces
   * @returns {number}
   */
  remaining(faces) {
    return this.queues.get(faces)?.length ?? 0;
  }
}

/**
 * The plan of each player's roll being made, by its id.
 * @type {Map<string, DicePlan>}
 */
const plans = new Map();

/**
 * The kinds of a player's roll that are damage, which they may change in the app: a use's, as an
 * attack's, and a description's.
 * @type {Set<string>}
 */
const DAMAGE_COMMANDS = new Set(["damage", "textDamage"]);

/**
 * The dice of tagged rolls being evaluated, with their roll's plan, should a die not know the roll
 * it belongs to.
 * @type {WeakMap<DiceTerm, DicePlan>}
 */
const termPlans = new WeakMap();

/**
 * How many dice have been given a player's value, ever. The self-test watches it.
 * @type {number}
 */
let served = 0;

/**
 * Whether players' rolls can be made here: only under D&D Fifth Edition, and once the self-test
 * has shown that this Foundry and its modules roll dice as expected. Their hit dice also need
 * dnd5e's hit die roll to take their die, their attacks their damage rolled as expected, and the
 * damage they change in the app, more dice, another die or every die at its highest, changed as
 * expected, which the self-test checks apart.
 * @type {{ready: boolean, reason: string|null, error: string|null, hitDice: boolean,
 *   hitDiceError: string|null, attacks: boolean, attacksError: string|null, modifiers: boolean,
 *   modifiersError: string|null}}
 */
export const diceStatus = {
  ready: false, reason: "pending", error: null, hitDice: false, hitDiceError: null, attacks: false, attacksError: null,
  modifiers: false, modifiersError: null
};

/* -------------------------------------------- */

/**
 * Make a player's roll with the dice they rolled. The plan exists only while it's being made, so a
 * roll's tag, which its message keeps, never matches another roll later.
 * @template T
 * @param {object} command                      The player's roll, with its id and dice.
 * @param {(plan: DicePlan) => Promise<T>} make  Makes the roll.
 * @returns {Promise<T>}
 */
export async function withPlan(command, make) {
  const plan = new DicePlan(command);
  plans.set(command.id, plan);
  try {
    return await make(plan);
  } finally {
    plan.ended = true;
    if ( plans.get(command.id) === plan ) plans.delete(command.id);
  }
}

/**
 * The plan of the player's roll a roll is tagged for, while it's being made.
 * @param {unknown} tag   The roll's tag, from its options.
 * @returns {DicePlan|undefined}
 */
function planFor(tag) {
  return (typeof tag === "string") ? plans.get(tag) : undefined;
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * Give a die of a tagged roll the next value the player rolled for it. Only a die's first roll is
 * the player's: a reroll or an explosion is Foundry's, so a player can't stock values for them.
 * @this {DiceTerm}
 * @param {Function} wrapped   Foundry's own roll of the die.
 * @param {...any} args
 * @returns {number|undefined|Promise<number|undefined>}
 */
function plannedRoll(wrapped, ...args) {
  const [options] = args;
  const first = !options?.reroll && !options?.explode && !options?.minimize && !options?.maximize;
  if ( first ) {
    const plan = termPlans.get(this) ?? planFor(this._root?.options?.[ROLL_TAG]);
    const value = plan?.take(this.faces);
    if ( value !== undefined ) return value;
  }
  return wrapped(...args);
}

/**
 * Evaluate a tagged roll without asking anyone for its dice, as a Gamemaster's manual dice would:
 * they are the player's. Its dice are noted with its plan, in case they don't know their roll.
 * @this {Roll}
 * @param {Function} wrapped   Foundry's own evaluation.
 * @param {object} [options]
 * @param {...any} rest
 * @returns {Promise<Roll>}
 */
function taggedEvaluate(wrapped, options={}, ...rest) {
  const plan = planFor(this.options?.[ROLL_TAG]);
  if ( !plan ) return wrapped(options, ...rest);
  const { DiceTerm } = foundry.dice.terms;
  for ( const term of this.terms ) {
    if ( term instanceof DiceTerm ) termPlans.set(term, plan);
  }
  // Damage the player chose at its highest has every die at its highest, Foundry's own too.
  const maximize = DAMAGE_COMMANDS.has(plan.command.kind) && (plan.command.modifiers?.maximize === true);
  return wrapped({ ...options, allowInteractive: false, ...(maximize && { maximize: true }) }, ...rest);
}

/**
 * Before dnd5e builds a roll for a player's roll: tag it, if only its process is, and roll it as
 * the player chose, if they chose, as dnd5e's roll dialog would; and add what they added, as the
 * dialog's situational bonus. That goes first, after the d20, so that the player's dice for it
 * aren't taken by a bonus of the same dice, such as Bless's d4, which Foundry rolls. Only a d20 roll
 * is changed so. Damage is rolled as it is, but as the kind of damage the player chose, where it
 * offers a choice: anything added to it would take a critical hit's extra dice, and be added once
 * for each of its parts. A hit die's formula is written with its die outside dnd5e's `max`, where
 * the player's die can reach it, coming to the same.
 * @param {object} process   The roll process's configuration.
 * @param {object} config    The roll's configuration.
 * @param {number} index     The roll's place among the process's rolls.
 */
function onBuildRollConfig(process, config, index) {
  const tag = tagOf(process, config, index);
  const plan = planFor(tag);
  if ( !plan || !config ) return;
  config.options ??= {};
  config.options[ROLL_TAG] = tag;
  const hookNames = process?.hookNames ?? [];
  if ( hookNames.includes("hitDie") ) {
    if ( (index === 0) && (plan.command.kind === "hitDie") ) {
      config.parts = (config.parts ?? []).map(part => hitDieFormula(part, config.data) ?? part);
    }
    return;
  }
  if ( hookNames.includes("damage") ) {
    const type = plan.command.types?.[index];
    if ( (typeof type === "string") && config.options.types?.includes(type) ) config.options.type = type;
    return;
  }
  if ( !hookNames.includes("d20Test") ) return;
  const { mode, explicit, extras } = plan.command;
  if ( explicit ) config.options.advantageMode = mode;
  const situational = extrasFormula(extras);
  if ( situational && !config.parts?.includes("@situational") ) {
    config.parts = ["@situational", ...(config.parts ?? [])];
    config.data ??= {};
    config.data.situational = situational;
  }
}

/**
 * The rolls tagged on their process whose dialog a player's roll never opens, whatever asked for
 * it: damage, a hit die and a utility's own roll.
 * @type {string[]}
 */
const UNASKED = ["damage", "hitDie", "formula"];

/**
 * Before a player's damage, hit die or utility's roll is rolled, roll it without dnd5e's dialog,
 * whatever asked for it, as Midi-QOL does for a choice of damage types, and a utility set to prompt
 * for its roll does: the player chose, in the app.
 * @param {object} process   The roll process's configuration.
 * @param {object} dialog    The roll dialog's configuration.
 */
function onPreRoll(process, dialog) {
  if ( !UNASKED.some(name => process?.hookNames?.includes(name)) || !dialog ) return;
  if ( planFor(process[ROLL_TAG]) ) dialog.configure = false;
}

/**
 * The player's roll a roll being built is for, if any: as tagged on the roll itself, as checks and
 * dnd5e's attacks are; or on its process, as damage is, whose rolls dnd5e makes up itself; or on
 * the Midi-QOL workflow it's rolled in, for the attack Midi rolls once the item is used.
 * @param {object} process   The roll process's configuration.
 * @param {object} config    The roll's configuration.
 * @param {number} index     The roll's place among the process's rolls.
 * @returns {string|undefined}
 */
function tagOf(process, config, index) {
  const own = config?.options?.[ROLL_TAG];
  if ( typeof own === "string" ) return own;
  if ( typeof process?.[ROLL_TAG] === "string" ) return process[ROLL_TAG];
  if ( (index === 0) && process?.hookNames?.includes("attack") ) {
    const midi = process.workflow?.workflowOptions?.[ROLL_TAG] ?? process.midiOptions?.workflowOptions?.[ROLL_TAG];
    if ( typeof midi === "string" ) return midi;
  }
  return undefined;
}

/**
 * Once dnd5e has built a tagged roll, keep how the player chose to roll it, whatever changed it
 * since, as a module granting advantage might; and change the first of a player's damage rolls, a
 * use's or a description's, as they chose in the app. A hit die, a utility's roll or a description's
 * roll another module changed so that the player's dice can't reach it, as inside a function, is
 * called off: nothing is spent or healed, and nothing posted.
 * @param {Roll[]} rolls
 * @returns {boolean|void}   False to call the roll off.
 */
function onRollConfiguration(rolls) {
  for ( const [index, roll] of (rolls ?? []).entries() ) {
    const plan = planFor(roll.options?.[ROLL_TAG]);
    if ( DAMAGE_COMMANDS.has(plan?.command.kind) ) {
      if ( index === 0 ) reshapeDamage(roll, plan.command.modifiers);
      continue;
    }
    if ( ["hitDie", "formula", "textRoll"].includes(plan?.command.kind) ) {
      if ( (index === 0) && !takesPlayersDice(roll, plan.command.dice) ) {
        plan.refusal = "dice";
        return false;
      }
      continue;
    }
    if ( !plan?.command.explicit ) continue;
    const { mode } = plan.command;
    if ( roll.options.advantageMode === mode ) continue;
    roll.options.advantageMode = mode;
    roll.configureModifiers?.();
  }
}

/**
 * Can a roll take every die the player rolled for it: has it as many dice of each size as they
 * rolled, among its own, outside any function or parentheses?
 * @param {Roll} roll   Built, not yet rolled.
 * @param {{faces: number, results: number[]}[]} dice
 * @returns {boolean}
 */
function takesPlayersDice(roll, dice) {
  const { DiceTerm } = foundry.dice.terms;
  const thrown = new Map();
  for ( const term of roll.terms ) {
    if ( (term instanceof DiceTerm) && Number.isInteger(term.number) ) {
      thrown.set(term.faces, (thrown.get(term.faces) ?? 0) + term.number);
    }
  }
  const rolled = new Map();
  for ( const { faces, results } of dice ?? [] ) rolled.set(faces, (rolled.get(faces) ?? 0) + results.length);
  return Array.from(rolled).every(([faces, number]) => (thrown.get(faces) ?? 0) >= number);
}

/**
 * dnd5e's formula for a hit die, `max(least, 1dX + @abilities.con.mod)`, which the player's die
 * can't reach inside its `max`, written with the die outside it, coming to the same: the die at
 * least as high as it must be for the total to reach the least, then the modifier, such as
 * `1d8min4 + @abilities.con.mod` for a Constitution of -3. A die no face of which reaches it
 * always comes to the least. Null for any other formula, such as one a module wrote.
 * @param {string} part   The roll's part, as dnd5e wrote it.
 * @param {object} data   The roll's data, with the character's Constitution modifier.
 * @returns {string|null}
 */
export function hitDieFormula(part, data) {
  const match = /^max\(\s*(\d+)\s*,\s*1d(\d+)\s*\+\s*@abilities\.con\.mod\s*\)$/.exec(String(part ?? "").trim());
  const mod = Number(data?.abilities?.con?.mod);
  if ( !match || !Number.isInteger(mod) ) return null;
  const least = Number(match[1]);
  const faces = Number(match[2]);
  const lowest = least - mod;
  if ( lowest <= 1 ) return `1d${faces} + @abilities.con.mod`;
  if ( lowest <= faces ) return `1d${faces}min${lowest} + @abilities.con.mod`;
  // Foundry raises a die no higher than its faces.
  const rest = least - faces;
  return `1d${faces}min${faces} ${(rest < 0) ? "-" : "+"} ${Math.abs(rest)}`;
}

/**
 * What a player added to a roll, as a formula: such as "1d4 - 1". Only dice and numbers, never
 * anything a player typed.
 * @param {object[]} [extras]   Each `{sign, count, sides}` or `{sign, flat}`.
 * @returns {string}
 */
export function extrasFormula(extras=[]) {
  return extras.map((term, index) => {
    const text = ("flat" in term) ? String(term.flat) : `${term.count}d${term.sides}`;
    if ( index === 0 ) return (term.sign < 0) ? `-${text}` : text;
    return `${(term.sign < 0) ? "-" : "+"} ${text}`;
  }).join(" ");
}

/**
 * The dice a roll will throw, before it's rolled, for a player to roll them in the app: each die
 * term's faces and number, in order. A roll can't be planned when one of its dice can't be known
 * beforehand: dice inside parentheses or a function, a number of dice still to be worked out, or a
 * die a player can't roll, such as a d3. Foundry then rolls all of them.
 * @param {Roll} roll   Built, not yet evaluated.
 * @returns {{plannable: boolean, dice: {faces: number, number: number}[]}}
 */
export function plannedDice(roll) {
  const { DiceTerm } = foundry.dice.terms;
  const dice = [];
  for ( const term of roll.terms ) {
    if ( term instanceof DiceTerm ) {
      const { faces, number } = term;
      if ( !Number.isInteger(number) || (number < 0) || (number > 40) || !DIE_FACES.has(faces) ) {
        return { plannable: false, dice: [] };
      }
      if ( number > 0 ) dice.push({ faces, number });
    }
    else if ( /d\d/i.test(term.formula ?? term.expression ?? "") ) return { plannable: false, dice: [] };
  }
  return { plannable: true, dice };
}

/**
 * Are these the dice a roll throws, as planned: the same dice, in order? None, for one that can't
 * be planned or has no dice.
 * @param {{faces: number, results: number[]}[]} dice
 * @param {{faces: number, number: number}[]} planned
 * @returns {boolean}
 */
export function matchesDice(dice, planned) {
  if ( dice.length !== planned.length ) return false;
  return dice.every((die, index) => (die.faces === planned[index].faces) && (die.results.length === planned[index].number));
}

/**
 * A utility activity's own roll, such as a d4 of luck, as dnd5e builds it, built but not rolled:
 * with the character's numbers in its formula, such as `1d4 + 3` for `1d4 + @abilities.wis.mod`.
 * Null for an activity with no roll of its own, or one Foundry can't read.
 * @param {Activity} [activity]
 * @returns {Roll|null}
 */
export function formulaRoll(activity) {
  if ( (activity?.type !== "utility") || !activity.roll?.formula ) return null;
  try {
    return new CONFIG.Dice.BasicRoll(activity.roll.formula, activity.getRollData());
  } catch {
    return null;
  }
}

/**
 * How many dice a damage roll throws for each die of its own, as this world rolls a critical hit's
 * damage: one, but on a critical hit, such as two, or one where its dice are maximized instead. A
 * player who adds a die to damage in the app throws that many more.
 * @param {object} process   A damage roll's configuration, with whether it's a critical hit's.
 * @param {number} index     The roll's place among its rolls.
 * @returns {number}
 */
export function diceForEach(process, index) {
  const config = process.rolls?.[index];
  if ( !process.isCritical || !config ) return 1;
  const thrown = parts => {
    const [roll] = damageRollsFor({ ...process, rolls: [{ ...config, parts }] });
    return plannedDice(roll).dice[0]?.number ?? 0;
  };
  return Math.max(thrown(["2d6"]) - thrown(["1d6"]), 1);
}

/**
 * The dice damage throws, as its preview has them, changed as its player chose in the app: more of
 * its first roll's first die, as many more as `perDie` says for each, or that die another size.
 * @param {{plannable: boolean, rolls: {dice: object[], perDie?: number}[]}} preview
 * @param {{extra?: number, faces?: number}} [modifiers]
 * @returns {{faces: number, number: number}[]|null}   None for damage that can't be planned; null
 *   when there's no such die to change.
 */
export function modifiedDice(preview, modifiers) {
  const planned = preview.plannable ? preview.rolls.flatMap(roll => roll.dice) : [];
  if ( !reshapes(modifiers) || !preview.plannable ) return planned;
  const [first] = preview.rolls;
  if ( !first?.dice?.length ) return null;
  const [die, ...rest] = planned;
  const number = die.number + ((modifiers.extra ?? 0) * (first.perDie ?? 1));
  return [{ faces: modifiers.faces ?? die.faces, number }, ...rest];
}

/**
 * Change the first of a player's damage rolls, built but not yet rolled, as they chose in the app:
 * more of its first die, or another size of it; then make a critical hit's dice again, as this
 * world makes them.
 * @param {Roll} roll
 * @param {{extra?: number, faces?: number}} [modifiers]
 */
export function reshapeDamage(roll, modifiers) {
  if ( !reshapes(modifiers) ) return;
  const { DiceTerm } = foundry.dice.terms;
  const term = roll.terms.find(each => (each instanceof DiceTerm) && Number.isInteger(each.number) && (each.number > 0));
  if ( !term ) return;
  if ( modifiers.faces ) term.faces = modifiers.faces;
  if ( modifiers.extra ) {
    term.options.baseNumber = (term.options.baseNumber ?? term.number) + modifiers.extra;
    term.number = term.options.baseNumber;
  }
  if ( typeof roll.configureDamage === "function" ) roll.configureDamage();
  else roll.resetFormula();
}

/**
 * The changes a player chose for their damage in the app, as read: more of its first die, up to
 * 40, that die another size, and every die at its highest. Nothing for none; null for what can't be
 * read.
 * @param {unknown} modifiers
 * @returns {{extra: number, faces: number|undefined, maximize: boolean}|undefined|null}
 */
export function readModifiers(modifiers) {
  if ( (modifiers === undefined) || (modifiers === null) ) return undefined;
  if ( typeof modifiers !== "object" ) return null;
  const { extra=0, faces, maximize=false } = modifiers;
  if ( !Number.isInteger(extra) || (extra < 0) || (extra > 40) ) return null;
  if ( (faces !== undefined) && !DAMAGE_FACES.has(faces) ) return null;
  if ( typeof maximize !== "boolean" ) return null;
  return { extra, faces, maximize };
}

/**
 * Do these change damage's dice: more of them, or another size?
 * @param {{extra?: number, faces?: number}} [modifiers]
 * @returns {boolean}
 */
function reshapes(modifiers) {
  return ((modifiers?.extra ?? 0) > 0) || (modifiers?.faces !== undefined);
}

/**
 * Do these change damage at all: more of its dice, another size of them, or every die at its
 * highest?
 * @param {{extra?: number, faces?: number, maximize?: boolean}} [modifiers]
 * @returns {boolean}
 */
export function changesDamage(modifiers) {
  return reshapes(modifiers) || (modifiers?.maximize === true);
}

/**
 * The dice damage throws, worked out before it's rolled, as an attack's preview has them: each
 * roll's dice, as this world rolls them, a critical hit's too, and how many it throws for each die
 * of its own. None, for damage that can't be planned.
 * @param {object} process   A damage roll's configuration, with whether it's a critical hit's.
 * @returns {{plannable: boolean, rolls: {dice: {faces: number, number: number}[], perDie: number}[]}}
 */
export function plannedDamage(process) {
  const planned = damageRollsFor(process).map(roll => plannedDice(roll));
  const plannable = planned.every(each => each.plannable);
  return {
    plannable,
    rolls: planned.map(({ dice }, index) => ({ dice: plannable ? dice : [], perDie: diceForEach(process, index) }))
  };
}

/**
 * The ways numbers may come out of a critical hit's damage, as dnd5e's two settings for it make
 * them: doubled or not (Critical Damage Modifiers), and with the most its dice could roll added or
 * not (Powerful Critical).
 * @type {[boolean, boolean][]}
 */
const NUMBER_RULES = [[false, false], [true, false], [false, true], [true, true]];

/**
 * How this world rolls a critical hit's damage, for the app to plan a description's: each die
 * thrown `perDie` times over, such as twice, or once where dnd5e's Powerful Critical adds the most
 * it could roll instead, and no other die; whether its numbers are doubled, and the most its dice
 * could roll added, for the app to work out its total by; and whether its dice are changed beyond
 * that, as at their highest, so that only the game can. Found by building a critical hit's damage
 * as this client builds it, with the rules of modules that change it, such as Midi-QOL's, which
 * keeps its own for the Gamemaster, never from dnd5e's settings alone, which Midi's may set aside:
 * one die and a number first, then dice of two sizes, which must come out the same way. Null where
 * those rules throw dice of their own beside each, as Midi's that roll critical dice apart or
 * explode them do, make dice of one size otherwise than another's, come to numbers dnd5e's settings
 * don't, or can't be read.
 * @returns {{perDie: number, multiplyNumeric: boolean, powerfulCritical: boolean, altered: boolean}|null}
 */
export function criticalRule() {
  try {
    const built = formula => damageRollsFor({ rolls: [{ parts: [formula], data: {}, options: {} }], isCritical: true })[0];
    const one = built("1d6 + 3");
    const thrown = plannedDice(one);
    const perDie = thrown.dice[0]?.number;
    if ( !thrown.plannable || (thrown.dice.length !== 1) || (thrown.dice[0].faces !== 6) ) return null;
    if ( !Number.isInteger(perDie) || (perDie < 1) ) return null;
    // Its numbers, 3 at first, as each pair of dnd5e's settings would make them, the most a d6 could
    // roll being 6.
    const rule = NUMBER_RULES.find(([doubled, most]) => numbersOf(one) === (doubled ? 6 : 3) + (most ? 6 : 0));
    if ( !rule ) return null;
    const [multiplyNumeric, powerfulCritical] = rule;
    // Dice of two sizes, each thrown as many times over, and their numbers the same way: the most
    // they could roll being 20.
    const two = built("2d8 + 1d4 + 3");
    const expected = [{ faces: 8, number: 2 * perDie }, { faces: 4, number: perDie }];
    const planned = plannedDice(two);
    if ( !planned.plannable || (JSON.stringify(planned.dice) !== JSON.stringify(expected)) ) return null;
    if ( numbersOf(two) !== (multiplyNumeric ? 6 : 3) + (powerfulCritical ? 20 : 0) ) return null;
    return { perDie, multiplyNumeric, powerfulCritical, altered: [one, two].some(roll => altersDice(roll)) };
  } catch {
    return null;
  }
}

/**
 * What a built roll's numbers come to, each with its sign, its dice left out; null for one with
 * anything else in it, such as parentheses, or numbers multiplied or divided.
 * @param {Roll} roll   Built, not yet evaluated.
 * @returns {number|null}
 */
function numbersOf(roll) {
  const { DiceTerm, NumericTerm, OperatorTerm } = foundry.dice.terms;
  let sign = 1;
  let total = 0;
  for ( const term of roll.terms ) {
    if ( term instanceof OperatorTerm ) {
      if ( !["+", "-"].includes(term.operator) ) return null;
      sign = (term.operator === "-") ? -sign : sign;
    }
    else if ( term instanceof NumericTerm ) {
      total += sign * term.number;
      sign = 1;
    }
    else if ( term instanceof DiceTerm ) sign = 1;
    else return null;
  }
  return total;
}

/**
 * Does a built roll change its dice beyond how many it throws, as Midi-QOL's rules for a critical
 * hit's damage may: at their highest (`min`), the highest of them kept (`kh`), or each doubled?
 * @param {Roll} roll   Built, not yet evaluated.
 * @returns {boolean}
 */
function altersDice(roll) {
  const { DiceTerm } = foundry.dice.terms;
  return roll.terms.some(term => (term instanceof DiceTerm) && (term.modifiers?.length > 0));
}

/**
 * The rolls dnd5e makes of a damage roll's configuration, as it makes them without its dialog,
 * built but not rolled: with the world's rules for critical hits, which dnd5e's damage rolls
 * apply, and those of modules that change them, such as Midi-QOL's.
 * @param {object} process   A damage roll's configuration, as an activity's `getDamageConfig`
 *                           gives it, with whether it's a critical hit's.
 * @returns {Roll[]}
 */
export function damageRollsFor(process) {
  const { DamageRoll } = CONFIG.Dice;
  const config = { ...process, critical: { ...(process.critical ?? {}) } };
  config.critical.multiplyNumeric ??= game.settings.get("dnd5e", "criticalDamageModifiers");
  config.critical.powerfulCritical ??= game.settings.get("dnd5e", "criticalDamageMaxDice");
  return (config.rolls ?? []).map(rollConfig => {
    const options = { ...(rollConfig.options ?? {}) };
    options.isCritical ??= config.isCritical;
    return DamageRoll.fromConfig({ ...rollConfig, options }, config);
  });
}

/* -------------------------------------------- */
/*  Set-up                                      */
/* -------------------------------------------- */

/**
 * Has rolling with players' dice been set up?
 * @type {boolean}
 */
let installed = false;

/**
 * Set up rolling with players' dice. Done on the Gamemaster's client, which makes their rolls.
 * Wrapped through libWrapper when it's active, to sit well with other modules that wrap dice.
 * @returns {void}
 */
export function installDicePlans() {
  if ( installed ) return;
  installed = true;
  const DiceTerm = "foundry.dice.terms.DiceTerm.prototype._roll";
  const Roll = "foundry.dice.Roll.prototype.evaluate";
  if ( game.modules.get("lib-wrapper")?.active && globalThis.libWrapper ) {
    globalThis.libWrapper.register(MODULE_ID, DiceTerm, plannedRoll, "MIXED");
    globalThis.libWrapper.register(MODULE_ID, Roll, taggedEvaluate, "WRAPPER");
  } else {
    wrap(foundry.dice.terms.DiceTerm.prototype, "_roll", plannedRoll);
    wrap(foundry.dice.Roll.prototype, "evaluate", taggedEvaluate);
  }
  Hooks.on("dnd5e.preRoll", onPreRoll);
  Hooks.on("dnd5e.postBuildRollConfig", onBuildRollConfig);
  Hooks.on("dnd5e.postRollConfiguration", onRollConfiguration);
}

/**
 * Wrap a method without libWrapper.
 * @param {object} target       The prototype.
 * @param {string} name         The method's name.
 * @param {Function} wrapper    Called with the original method, bound, then the arguments.
 */
function wrap(target, name, wrapper) {
  const original = target[name];
  target[name] = function(...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
}

/* -------------------------------------------- */

/**
 * Check that a player's dice reach a roll made for them, and only that roll, before offering to
 * make their rolls: Foundry, the system or a module may roll dice differently than expected. The
 * outcome is in `diceStatus`.
 * @returns {Promise<void>}
 */
export async function selfTest() {
  const D20Roll = CONFIG.Dice?.D20Roll;
  if ( (game.system.id !== "dnd5e") || !D20Roll ) {
    Object.assign(diceStatus, { ready: false, reason: "system", error: null });
    return;
  }
  try {
    const id = `self-test-${foundry.utils.randomID()}`;
    const dice = [{ faces: 20, results: [17, 3] }, { faces: 4, results: [2] }];
    const results = roll => roll.dice.map(die => die.results.map(({ result }) => result));
    const expected = JSON.stringify([[17, 3], [2]]);

    // Copies are made before the roll is, as initiative copies the roll it has built.
    const roll = new D20Roll("1d20 + 1d4", {}, { advantageMode: D20Roll.ADV_MODE.ADVANTAGE, [ROLL_TAG]: id });
    const copy = roll.clone();
    const later = roll.clone();

    // With advantage, both d20s are the player's, as is the d4; a roll for no one, made meanwhile,
    // isn't given any of them.
    await withPlan({ id, dice }, async plan => {
      await new foundry.dice.Roll("1d20").evaluate({ allowInteractive: false });
      check(plan.remaining(20) === 2, "a roll for no one was given the player's dice");
      await roll.evaluate();
    });
    check(JSON.stringify(results(roll)) === expected, `the dice were ${JSON.stringify(results(roll))}`);
    check(roll.total === 19, `the total was ${roll.total}`);

    // A copy of the roll, as initiative makes, is given them too.
    await withPlan({ id, dice }, () => copy.evaluate());
    check(JSON.stringify(results(copy)) === expected, `a copy's dice were ${JSON.stringify(results(copy))}`);

    // Once made, the roll's tag matches nothing.
    const before = served;
    await later.evaluate();
    check(served === before, "a roll made earlier was given a player's dice");

    Object.assign(diceStatus, { ready: true, reason: null, error: null });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    Object.assign(diceStatus, { ready: false, reason: "self-test", error, hitDice: false, attacks: false });
    console.warn(`${MODULE_ID} | Players' rolls from Sending Stone can't be made in this game: ${error}`, err);
    return;
  }

  try {
    await hitDieSelfTest();
    Object.assign(diceStatus, { hitDice: true, hitDiceError: null });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    Object.assign(diceStatus, { hitDice: false, hitDiceError: error });
    console.warn(`${MODULE_ID} | Players can't spend hit dice from Sending Stone in this game: ${error}`, err);
  }

  try {
    await attackSelfTest();
    Object.assign(diceStatus, { attacks: true, attacksError: null });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    Object.assign(diceStatus, { attacks: false, attacksError: error, modifiers: false });
    console.warn(`${MODULE_ID} | Players' attacks from Sending Stone can't be made in this game: ${error}`, err);
    return;
  }

  try {
    await modifiersSelfTest();
    Object.assign(diceStatus, { modifiers: true, modifiersError: null });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    Object.assign(diceStatus, { modifiers: false, modifiersError: error });
    console.warn(`${MODULE_ID} | Players can't change their damage from Sending Stone in this game: ${error}`, err);
  }
}

/**
 * Check that a player's die reaches a hit die, as dnd5e builds its roll without its dialog, and
 * that the roll comes to dnd5e's total, however the die is raised to reach the least it heals.
 * Other modules' hooks aren't called, there being no character to roll for; one that changes the
 * formula so the player's die can't reach it has the roll called off when it's made.
 * @returns {Promise<void>}
 */
async function hitDieSelfTest() {
  const BasicRoll = CONFIG.Dice?.BasicRoll;
  if ( !BasicRoll ) throw new Error("dnd5e has no basic rolls");
  // The least, the die, the Constitution modifier and the player's roll: no least to raise it to; a
  // least it must be raised to; the legacy rules' least of 0; a die above it; and a die no face of
  // which reaches it.
  const cases = [[1, 8, 2, 5], [1, 8, -3, 2], [0, 10, -3, 1], [1, 6, -3, 6], [1, 4, -5, 3]];
  for ( const [least, faces, mod, rolled] of cases ) {
    const id = `self-test-${foundry.utils.randomID()}`;
    const config = { parts: [`max(${least}, 1d${faces} + @abilities.con.mod)`], data: { abilities: { con: { mod } } } };
    const dice = [{ faces, results: [rolled] }];
    await withPlan({ id, kind: "hitDie", denomination: `d${faces}`, dice }, async plan => {
      onBuildRollConfig({ hookNames: ["hitDie", ""], [ROLL_TAG]: id }, config, 0);
      const roll = BasicRoll.fromConfig(config, {});
      check(takesPlayersDice(roll, dice), `a hit die, ${roll.formula}, can't take the player's d${faces}`);
      await roll.evaluate();
      check(plan.remaining(faces) === 0, `a hit die, ${roll.formula}, didn't take the player's d${faces}`);
      const total = Math.max(least, rolled + mod);
      check(roll.total === total, `a hit die, ${roll.formula}, came to ${roll.total} with a ${rolled}, not ${total}`);
    });
  }
}

/**
 * Check that a player's dice reach an attack's damage: each part of it, which dnd5e rolls apart,
 * takes its own dice, in order; and a critical hit's damage takes every die planned for it,
 * however this world and its modules roll critical damage. What a module then does to a die, as
 * Midi-QOL's critical rules can maximize it, is its own.
 * @returns {Promise<void>}
 */
async function attackSelfTest() {
  if ( !CONFIG.Dice?.DamageRoll ) throw new Error("dnd5e has no damage rolls");
  const id = `self-test-${foundry.utils.randomID()}`;
  const [slashing, fire] = damageRollsFor({
    rolls: [
      { parts: ["1d8", "2"], data: {}, options: { type: "slashing", [ROLL_TAG]: id } },
      { parts: ["2d6"], data: {}, options: { type: "fire", [ROLL_TAG]: id } }
    ],
    isCritical: false
  });
  const dice = [{ faces: 8, results: [5] }, { faces: 6, results: [2, 4] }];
  await withPlan({ id, kind: "damage", dice }, async plan => {
    await slashing.evaluate();
    check((plan.remaining(8) === 0) && (plan.remaining(6) === 2), "the first part didn't take its own dice");
    await fire.evaluate();
    check(plan.remaining(6) === 0, "the second part didn't take its own dice");
  });

  const critId = `self-test-${foundry.utils.randomID()}`;
  const [critical] = damageRollsFor({
    rolls: [{ parts: ["1d8", "1d6", "2"], data: {}, options: { type: "slashing", [ROLL_TAG]: critId } }],
    isCritical: true
  });
  const planned = plannedDice(critical);
  check(planned.plannable, `a critical hit's damage, ${critical.formula}, can't be planned`);
  const critDice = planned.dice.map(({ faces, number }) => ({
    faces, results: Array.from({ length: number }, (_, i) => (i % faces) + 1)
  }));
  await withPlan({ id: critId, kind: "damage", dice: critDice }, async plan => {
    await critical.evaluate();
    const left = critDice.filter(({ faces }) => plan.remaining(faces) > 0);
    check(!left.length, `a critical hit's damage, ${critical.formula}, left the player's dice unused`);
  });
}

/**
 * Check that damage a player changes in the app is changed as expected: a critical hit's with a die
 * more, made a d10, throws the dice its changed preview says, however this world and its modules
 * roll critical damage, and takes every one of the player's dice; and damage at its highest has
 * every die at its highest.
 * @returns {Promise<void>}
 */
async function modifiersSelfTest() {
  const id = `self-test-${foundry.utils.randomID()}`;
  const process = {
    rolls: [{ parts: ["1d8", "2"], data: {}, options: { type: "slashing", [ROLL_TAG]: id } }],
    isCritical: true
  };
  const preview = plannedDamage(process);
  const modifiers = { extra: 1, faces: 10 };
  const expected = modifiedDice(preview, modifiers);
  const [roll] = damageRollsFor(process);
  reshapeDamage(roll, modifiers);
  const thrown = plannedDice(roll);
  check(thrown.plannable && (JSON.stringify(thrown.dice) === JSON.stringify(expected)),
    `a critical hit's damage with a d10 more threw ${roll.formula}, not ${JSON.stringify(expected)}`);
  const dice = expected.map(({ faces, number }) => ({
    faces, results: Array.from({ length: number }, (_, i) => (i % faces) + 1)
  }));
  await withPlan({ id, kind: "damage", dice, modifiers }, async plan => {
    await roll.evaluate();
    check(dice.every(({ faces }) => plan.remaining(faces) === 0), `${roll.formula} left the player's dice unused`);
  });

  const highest = `self-test-${foundry.utils.randomID()}`;
  const [max] = damageRollsFor({ rolls: [{ parts: ["2d6", "1"], data: {}, options: { [ROLL_TAG]: highest } }] });
  await withPlan({ id: highest, kind: "damage", dice: [{ faces: 6, results: [6, 6] }], modifiers: { maximize: true } },
    () => max.evaluate());
  check(max.total === 13, `damage at its highest, 2d6 + 1, came to ${max.total}`);
}

/**
 * @param {boolean} condition
 * @param {string} failure     What went wrong, when it isn't so.
 */
function check(condition, failure) {
  if ( !condition ) throw new Error(failure);
}
