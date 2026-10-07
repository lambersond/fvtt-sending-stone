import { DIE_FACES, MODULE_ID, ROLL_TAG } from "./constants.mjs";

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
 * has shown that this Foundry and its modules roll dice as expected. Their attacks also need their
 * damage rolled as expected, which the self-test checks apart.
 * @type {{ready: boolean, reason: string|null, error: string|null, attacks: boolean,
 *   attacksError: string|null}}
 */
export const diceStatus = { ready: false, reason: "pending", error: null, attacks: false, attacksError: null };

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
  return wrapped({ ...options, allowInteractive: false }, ...rest);
}

/**
 * Before dnd5e builds a roll for a player's roll: tag it, if only its process is, and roll it as
 * the player chose, if they chose, as dnd5e's roll dialog would; and add what they added, as the
 * dialog's situational bonus. That goes first, after the d20, so that the player's dice for it
 * aren't taken by a bonus of the same dice, such as Bless's d4, which Foundry rolls. Only a d20 roll
 * is changed so. Damage is rolled as it is, but as the kind of damage the player chose, where it
 * offers a choice: anything added to it would take a critical hit's extra dice, and be added once
 * for each of its parts.
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
 * Before a player's damage is rolled, roll it without dnd5e's damage dialog, whatever asked for it,
 * as Midi-QOL does for a choice of damage types: the player chose, in the app.
 * @param {object} process   The roll process's configuration.
 * @param {object} dialog    The roll dialog's configuration.
 */
function onPreRoll(process, dialog) {
  if ( !process?.hookNames?.includes("damage") || !dialog ) return;
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
 * since, as a module granting advantage might.
 * @param {Roll[]} rolls
 */
function onRollConfiguration(rolls) {
  for ( const roll of rolls ?? [] ) {
    const plan = planFor(roll.options?.[ROLL_TAG]);
    if ( !plan?.command.explicit || (plan.command.kind === "damage") ) continue;
    const { mode } = plan.command;
    if ( roll.options.advantageMode === mode ) continue;
    roll.options.advantageMode = mode;
    roll.configureModifiers?.();
  }
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
    Object.assign(diceStatus, { ready: false, reason: "self-test", error, attacks: false });
    console.warn(`${MODULE_ID} | Players' rolls from Sending Stone can't be made in this game: ${error}`, err);
    return;
  }

  try {
    await attackSelfTest();
    Object.assign(diceStatus, { attacks: true, attacksError: null });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    Object.assign(diceStatus, { attacks: false, attacksError: error });
    console.warn(`${MODULE_ID} | Players' attacks from Sending Stone can't be made in this game: ${error}`, err);
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
 * @param {boolean} condition
 * @param {string} failure     What went wrong, when it isn't so.
 */
function check(condition, failure) {
  if ( !condition ) throw new Error(failure);
}
