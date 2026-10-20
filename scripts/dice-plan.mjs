import { CRITICAL_AS_DND5E, DAMAGE_FACES, DIE_FACES, MODULE_ID, ROLL_TAG } from "./constants.mjs";

/**
 * Making a player's roll here with the dice they rolled in the Sending Stone app.
 *
 * A player's roll is made through dnd5e as if they had rolled it in Foundry, so its card, its
 * critical hits, Dice So Nice and modules such as Midi-QOL all behave as they always do. Only the
 * dice are the player's: each roll made for them is tagged with their roll's id, and while that roll
 * is being made, each die it throws takes the next value the player rolled for that kind of die.
 * A die the player didn't roll, such as a d4 for Bless, or a Halfling's reroll of a 1, is rolled by
 * Foundry as usual, and Foundry's total is the roll's total. Elven Accuracy's third d20 is the
 * player's where they sent three, as one typing in their own dice does since 0.32.0, and Foundry's
 * otherwise; and a d20 roll that throws fewer first than they sent, as one dnd5e gives no Elven
 * Accuracy after all, takes only as many, so that a d20 they added keeps its own.
 * So is a die a formula's own modifiers roll again, as `2d6r<=2` rerolls a 1 or a 2 and `1d6x`
 * explodes on a 6: the player's dice are each die's first throw, and what Foundry keeps, drops or
 * counts of them, as `4d6kh3` keeps the highest three, it works out from those.
 *
 * Since 0.32.0 a critical hit's damage made for a player from the app, or planned for one, is made
 * as dnd5e makes it, whatever another module's rules for critical hits say, as Midi-QOL's for the
 * Gamemaster, whose client this is: each die doubled, never Midi's `mx2` or its maximized dice.
 * The Gamemaster's own rolls keep those rules.
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

    /**
     * Has the player's damage been built and changed as they chose, and checked? Another damage
     * roll made with it then, as Midi-QOL's other damage, is left as it is.
     * @type {boolean}
     */
    this.configured = false;

    /**
     * Have the player's d20s been fitted to the d20s its roll throws first, so that a d20 they
     * added keeps its own? Once, for the roll as first built.
     * @type {boolean}
     */
    this.d20Fitted = false;
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
 * dnd5e's own configuration of a damage roll, as it was before any module wrapped it: Midi-QOL's
 * critical rules, which never call it for a critical hit, are set aside with it for the app's.
 * Null where dnd5e's dice aren't there, as under another system; the app's rolls are then left
 * to whatever configures them.
 * @type {Function|null}
 */
const DND5E_CONFIGURE = globalThis.dnd5e?.dice?.DamageRoll?.prototype?.configureDamage ?? null;

/**
 * Each app roll's terms as configured without its critical hit, the first time.
 * @type {WeakMap<Roll, RollTerm[]>}
 */
const uncritical = new WeakMap();

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
 * Foundry rolls one with `reroll` or `explode`, as its `r`, `rr`, `x` and `xo` modifiers do, which
 * the self-test checks.
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
 * use's or a description's, as they chose in the app, once: another damage roll made with them
 * after, as Midi-QOL's other damage, is left as it is. A hit die, a utility's roll or a description's
 * roll another module changed so that the player's dice can't reach it, as inside a function, is
 * called off: nothing is spent or healed, and nothing posted; so is damage that, built and changed,
 * can't take every die the player rolled for it, as where a module added dice to it afterwards
 * otherwise than planned, or a die more was chosen of a part with none of its own. Since 0.32.0 a
 * d20 roll then takes no more of the player's d20s than it throws first (`fitD20s`).
 * @param {Roll[]} rolls
 * @returns {boolean|void}   False to call the roll off.
 */
function onRollConfiguration(rolls) {
  const damage = planFor(rolls?.[0]?.options?.[ROLL_TAG]);
  if ( DAMAGE_COMMANDS.has(damage?.command.kind) && !damage.configured ) {
    damage.configured = true;
    reshapeDamage(rolls[0], damage.command.modifiers);
    const own = rolls.filter(roll => planFor(roll.options?.[ROLL_TAG]) === damage);
    if ( !takesAllDice(own, damage.command.dice) ) {
      damage.refusal = "dice";
      return false;
    }
  }
  for ( const [index, roll] of (rolls ?? []).entries() ) {
    const plan = planFor(roll.options?.[ROLL_TAG]);
    if ( DAMAGE_COMMANDS.has(plan?.command.kind) ) continue;
    if ( ["hitDie", "formula", "textRoll"].includes(plan?.command.kind) ) {
      if ( (index === 0) && !takesPlayersDice(roll, plan.command.dice) ) {
        plan.refusal = "dice";
        return false;
      }
      continue;
    }
    if ( !plan ) continue;
    const { explicit, mode } = plan.command;
    if ( explicit && (roll.options.advantageMode !== mode) ) {
      roll.options.advantageMode = mode;
      roll.configureModifiers?.();
    }
    fitD20s(plan, roll);
  }
}

/**
 * How many d20s a built d20 roll throws first: its number, times one more than its advantage's
 * count, as dnd5e expands it (basic-die.mjs's expandAdvantage). Null where it can't be told.
 * @param {Roll} roll
 * @returns {number|null}
 */
function firstD20s(roll) {
  const die = roll?.d20;
  if ( !die || !Number.isInteger(die.number) ) return null;
  const match = (die.modifiers ?? []).map(modifier => /^(adv|dis)(\d*)/i.exec(modifier)).find(Boolean);
  return die.number * (match ? 1 + parseInt(match[2] || 1) : 1);
}

/**
 * Leave the d20s a built roll throws first only as many of the player's values as it takes, so a
 * d20 they added keeps its own: as when they sent three for Elven Accuracy and the roll has none.
 * Never adds any.
 * @param {DicePlan} plan
 * @param {Roll} roll
 */
function fitD20s(plan, roll) {
  if ( plan.d20Fitted ) return;
  plan.d20Fitted = true;
  const given = plan.command.dice?.[0];
  const need = firstD20s(roll);
  if ( (given?.faces !== 20) || (need === null) || (given.results.length <= need) ) return;
  plan.queues.get(20)?.splice(need, given.results.length - need);
}

/**
 * Can a roll take every die the player rolled for it: has it as many dice of each size as they
 * rolled, among its own, outside any function or parentheses?
 * @param {Roll} roll   Built, not yet rolled.
 * @param {{faces: number, results: number[]}[]} dice
 * @returns {boolean}
 */
function takesPlayersDice(roll, dice) {
  return takesAllDice([roll], dice);
}

/**
 * Can rolls made together, as a damage roll's parts, take every die the player rolled for them:
 * have they at least as many dice of each size as they rolled, among their own, outside any
 * function or parentheses? A die more of theirs, such as a d4 for Bless, is Foundry's to roll. A
 * die with modifiers counts as its number, its first throw: what they roll again is Foundry's.
 * @param {Roll[]} rolls   Built, not yet rolled.
 * @param {{faces: number, results: number[]}[]} dice
 * @returns {boolean}
 */
function takesAllDice(rolls, dice) {
  const { DiceTerm } = foundry.dice.terms;
  const thrown = new Map();
  for ( const term of rolls.flatMap(roll => roll.terms) ) {
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
 * term's faces and number, in order, those of a critical hit's critical damage, which dnd5e adds
 * after the roll's own, marked `added`, and those the roll takes away, as Reduce's −1d4, marked
 * `subtracted`; a die may be both. A die with modifiers, such as `2d6r<=2`, `1d6x` or `4d6kh3`, is
 * planned as its number, the first throw the player rolls; a die its modifiers roll again is
 * Foundry's. A roll can't be planned when one of its dice can't be known beforehand: dice inside
 * parentheses or a function, a number of dice still to be worked out, or a die a player can't
 * roll, such as a d3. Foundry then rolls all of them.
 * @param {Roll} roll   Built, not yet evaluated.
 * @returns {{plannable: boolean, dice: {faces: number, number: number, added?: true, subtracted?: true}[]}}
 */
export function plannedDice(roll) {
  const { DiceTerm } = foundry.dice.terms;
  const taken = subtractedTerms(roll.terms);
  const dice = [];
  for ( const term of roll.terms ) {
    if ( term instanceof DiceTerm ) {
      const { faces, number } = term;
      if ( !Number.isInteger(number) || (number < 0) || (number > 40) || !DIE_FACES.has(faces) ) {
        return { plannable: false, dice: [] };
      }
      if ( number > 0 ) dice.push({
        faces, number, ...(criticalDamageTerm(term) && { added: true }), ...(taken.has(term) && { subtracted: true })
      });
    }
    else if ( /d\d/i.test(term.formula ?? term.expression ?? "") ) return { plannable: false, dice: [] };
  }
  return { plannable: true, dice };
}

/**
 * Can this world plan the dice of a part of damage, built as dnd5e builds one, for a player to roll
 * them: every die one a player rolls, none inside parentheses or a function, as Foundry's parser
 * may put a leading −1d4? Such damage is Foundry's to roll where it's an attack's, and isn't
 * offered where it's a description's. One that can't be built can't be planned.
 * @param {string} formula   Resolved, with no data left in it.
 * @returns {boolean}
 */
export function plannableDamage(formula) {
  const DamageRoll = CONFIG.Dice?.DamageRoll;
  if ( !DamageRoll ) return true;
  try {
    return plannedDice(new DamageRoll(formula, {}, {})).plannable;
  } catch {
    return false;
  }
}

/**
 * The dice a roll's terms take away, as dnd5e reads the signs of damage when it adds it up
 * (aggregate-damage-rolls.mjs: chunkTerms): a + or a - ends a group of terms, each - turns the sign
 * over, and *, / and % keep terms together, so that "5 - 2 * 1d4" takes its d4 away.
 * @param {RollTerm[]} terms
 * @returns {Set<DiceTerm>}
 */
export function subtractedTerms(terms) {
  const { DiceTerm, OperatorTerm } = foundry.dice.terms;
  const taken = new Set();
  let negative = false;
  // The sign of the group being read, once it has a term.
  let chunk = null;
  for ( const term of terms ?? [] ) {
    if ( (term instanceof OperatorTerm) && ["+", "-"].includes(term.operator) ) {
      if ( chunk !== null ) {
        chunk = null;
        negative = false;
      }
      if ( term.operator === "-" ) negative = !negative;
      continue;
    }
    chunk ??= negative;
    if ( chunk && (term instanceof DiceTerm) ) taken.add(term);
  }
  return taken;
}

/**
 * Does damage, as its preview has it, take any of its dice away, as Reduce's −1d4 does? Such damage
 * isn't rolled at its highest, which would take the most away. Damage whose dice can't be planned
 * has none to mark: its rolls' formulas say, as `formulaTakesAway` reads them.
 * @param {{plannable: boolean, rolls: {dice: object[], formula?: string}[]}} preview
 * @returns {boolean}
 */
export function takesAway(preview) {
  if ( !preview ) return false;
  if ( !preview.plannable ) return preview.rolls.some(roll => formulaTakesAway(roll.formula));
  return preview.rolls.some(roll => roll.dice.some(die => die.subtracted === true));
}

/**
 * Does a roll's formula take a die away, read as it's written, for damage whose dice can't be
 * planned: where a die is in a group of terms that comes out negative, as dnd5e reads the signs of
 * damage (chunkTerms), at each depth of parentheses, each group's own `-` turning it over, and a
 * `-` after `*`, `/` or `%` or opening it too, as in `1d3 + 3 - 1d4`, or the `(1d4 * -1)` Foundry's
 * parser may make of a leading −1d4. `1d3 - 1` takes none away, nor does `- - 1d4`. A die within a
 * function counts as within parentheses. The app reads it so too.
 * @param {string} [formula]
 * @returns {boolean}
 */
export function formulaTakesAway(formula) {
  if ( typeof formula !== "string" ) return false;
  return groupTakesAway(formula.replace(/\[[^\]]*\]/g, ""), false);
}

/**
 * Does a formula, or what's within a pair of parentheses of one, take a die away: one of its groups
 * of terms, parted by a `+`, a `-` or a function's comma between them, coming out negative with a
 * die of its own, or any parentheses within one, read with that group's sign?
 * @param {string} text
 * @param {boolean} negative   It's taken away, or made negative, as a whole.
 * @returns {boolean}
 */
function groupTakesAway(text, negative) {
  let group = { negative: false, own: "", within: [] };
  const groups = [group];
  let depth = 0;
  // What's within the parentheses being read.
  let inner = "";
  // The last character read that isn't a space: a sign after a term parts two groups.
  let before = "";
  for ( const char of text ) {
    if ( "({".includes(char) ) {
      if ( depth++ > 0 ) inner += char;
    }
    else if ( ")}".includes(char) ) {
      if ( depth > 1 ) inner += char;
      else if ( depth === 1 ) {
        group.within.push(inner);
        inner = "";
      }
      depth = Math.max(depth - 1, 0);
    }
    else if ( depth > 0 ) inner += char;
    else if ( "+-,".includes(char) ) {
      if ( (char === ",") || /[\w.)}]/.test(before) ) {
        group = { negative: char === "-", own: "", within: [] };
        groups.push(group);
      }
      else if ( char === "-" ) group.negative = !group.negative;
    }
    else group.own += char;
    if ( char.trim() ) before = char;
  }
  return groups.some(({ negative: turned, own, within }) => {
    const sign = negative !== turned;
    return (sign && /d\d/i.test(own)) || within.some(each => groupTakesAway(each, sign));
  });
}

/**
 * Would damage at its highest still have Foundry roll a die of it again: one that explodes, as
 * `1d6x`, or rerolls on its highest face, as `1d6r6`? The player's dice are each die's first throw,
 * and a die Foundry rolls again isn't at its highest, so such damage isn't rolled at its highest.
 * Its formulas are read as Foundry reads them, each die's modifiers as Foundry splits and applies
 * them, at each depth of parentheses and within functions; one Foundry can't read is taken to
 * explode where a die is followed by an `x` among its modifiers, as the app reads it.
 * @param {string[]} formulas   Each roll's formula, as built.
 * @returns {boolean}
 */
export function unmaximizable(formulas) {
  return (formulas ?? []).some(formula => {
    if ( typeof formula !== "string" ) return false;
    let terms;
    try {
      terms = new foundry.dice.Roll(formula).terms;
    } catch {
      return /d\d+[a-z\d<>=]*x/i.test(formula);
    }
    const { DiceTerm } = foundry.dice.terms;
    return terms.some(term => {
      if ( term instanceof DiceTerm ) return rethrownAtHighest(term);
      // Parentheses hold a formula of their own, and a function or a pool one for each argument,
      // each shorter than the formula they're in, which a term of text isn't.
      const inner = [term.term, ...(Array.isArray(term.terms) ? term.terms : [])];
      return unmaximizable(inner.filter(each => (typeof each === "string") && (each.length < formula.length)));
    });
  });
}

/**
 * Does a die, at its highest, have Foundry roll it again: does one of its modifiers explode it, or
 * reroll it on its highest face? Each modifier is the command Foundry reads it as, or for one it
 * doesn't know as a whole, such as `kx`, each it starts with in turn, as Foundry applies them.
 * @param {DiceTerm} term
 * @returns {boolean}
 */
function rethrownAtHighest(term) {
  const commands = term.constructor.MODIFIERS ?? {};
  const known = Object.keys(commands).sort((a, b) => b.length - a.length);
  const again = ([command, text]) => {
    const method = commands[command];
    if ( ["explode", "explodeOnce"].includes(method) ) return true;
    return ["reroll", "rerollRecursive"].includes(method) && rerollsOn(text, term.faces);
  };
  return (term.modifiers ?? []).some(modifier => modifierCommands(String(modifier), known).some(again));
}

/**
 * The commands Foundry applies a die's modifier as, each with the text it's applied with: the
 * modifier's own letters, as `r` for `r<=2`, where they're a command; or else each command its
 * letters start with in turn, longest first, applied bare.
 * @param {string} modifier
 * @param {string[]} known   The die's commands, longest first.
 * @returns {[string, string][]}
 */
function modifierCommands(modifier, known) {
  let letters = /[a-z]+/i.exec(modifier)?.[0]?.toLowerCase() ?? "";
  if ( known.includes(letters) ) return [[letters, modifier]];
  const found = [];
  while ( letters ) {
    const command = known.find(each => letters.startsWith(each));
    if ( !command ) break;
    found.push([command, command]);
    letters = letters.slice(command.length);
  }
  return found;
}

/**
 * Does a reroll modifier reroll a die showing this face, as Foundry reads it: `r` a 1, `rN` an N,
 * `r<=N` and the like what meets its comparison, and `rM…` none once M is 0?
 * @param {string} modifier   Such as "r<=2" or "rr1".
 * @param {number} face
 * @returns {boolean}
 */
function rerollsOn(modifier, face) {
  const match = /rr?([0-9]+)?([<>=]+)?([0-9]+)?/i.exec(modifier);
  if ( !match ) return false;
  let [, most, comparison, target] = match;
  if ( most && !(target || comparison) ) {
    target = most;
    most = undefined;
  }
  if ( (most !== undefined) && (Number(most) <= 0) ) return false;
  const value = (target !== undefined) ? Number(target) : 1;
  switch ( comparison || "=" ) {
    case "=": return face === value;
    case "<": return face < value;
    case "<=": return face <= value;
    case ">": return face > value;
    case ">=": return face >= value;
    default: return false;
  }
}

/**
 * Is a term one dnd5e added to a critical hit's damage as its critical damage, as an attack's
 * critical damage or a damage activity's: marked so, for it to be taken off when the roll is made
 * again? Midi-QOL marks the dice its rules add beside each die so too.
 * @param {RollTerm} term
 * @returns {boolean}
 */
function criticalDamageTerm(term) {
  return term.options?.criticalBonusDamage === true;
}

/**
 * Are these the dice a roll throws, as planned: the same dice, in order? None, for one that can't
 * be planned or has no dice. A die with modifiers throws its number of them first, the player's.
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
 * its first roll's first die of its own that it adds, never one it takes away, as many more as
 * `perDie` says for each, or that die another size. Never a die of a critical hit's critical damage,
 * which dnd5e adds afterwards as it is.
 * @param {{plannable: boolean, rolls: {dice: object[], perDie?: number}[]}} preview
 * @param {{extra?: number, faces?: number}} [modifiers]
 * @returns {{faces: number, number: number, added?: true, subtracted?: true}[]|null}   None for
 *   damage that can't be planned; null when there's no such die to change.
 */
export function modifiedDice(preview, modifiers) {
  const planned = preview.plannable ? preview.rolls.flatMap(roll => roll.dice) : [];
  if ( !reshapes(modifiers) || !preview.plannable ) return planned;
  const [first] = preview.rolls;
  // The first roll's dice come first among them all.
  const index = (first?.dice ?? []).findIndex(die => !die.added && !die.subtracted);
  if ( index === -1 ) return null;
  const die = planned[index];
  const number = die.number + ((modifiers.extra ?? 0) * (first.perDie ?? 1));
  return planned.map((each, at) => ((at === index) ? { faces: modifiers.faces ?? die.faces, number } : each));
}

/**
 * Change the first of a player's damage rolls, built but not yet rolled, as they chose in the app:
 * more of its first die of its own that it adds, never one of a critical hit's critical damage nor
 * one it takes away, or another size of it; then make a critical hit's dice again, as this world
 * makes them.
 * @param {Roll} roll
 * @param {{extra?: number, faces?: number}} [modifiers]
 */
export function reshapeDamage(roll, modifiers) {
  if ( !reshapes(modifiers) ) return;
  const { DiceTerm } = foundry.dice.terms;
  // An app roll's critical hit is made again from its terms as they were without it.
  const terms = uncriticalTerms(roll);
  const taken = subtractedTerms(terms);
  const term = terms.find(each => (each instanceof DiceTerm) && Number.isInteger(each.number) && (each.number > 0)
    && !criticalDamageTerm(each) && !taken.has(each));
  if ( !term ) return;
  if ( modifiers.faces ) term.faces = modifiers.faces;
  if ( modifiers.extra ) {
    term.options.baseNumber = (term.options.baseNumber ?? term.number) + modifiers.extra;
    term.number = term.options.baseNumber;
  }
  if ( typeof roll.configureDamage === "function" ) roll.configureDamage();
  // dnd5e 6 configures a roll once, so its formula says the change only once written again.
  roll.resetFormula();
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
 * roll's dice, as this world rolls them, a critical hit's too: its extra dice counted in its first
 * die's number, and the dice it adds as terms of their own, as its critical damage's, marked
 * `added`, and the dice it takes away marked `subtracted`; and how many it throws for each die of
 * its own. None, for damage that can't be planned.
 * @param {object} process   A damage roll's configuration, with whether it's a critical hit's.
 * @returns {{plannable: boolean, rolls: {dice: {faces: number, number: number, added?: true,
 *   subtracted?: true}[], perDie: number}[]}}
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
 * don't, or can't be read. With it, what the rules do with a critical hit's extra dice, as
 * `extraDiceRule` finds it.
 * @returns {{perDie: number, multiplyNumeric: boolean, powerfulCritical: boolean, altered: boolean,
 *   bonusDice: "rolled"|"maximized"|"ignored"|null}|null}
 */
export function criticalRule() {
  try {
    const built = (formula, critical={}) => damageRollsFor({
      rolls: [{ parts: [formula], data: {}, options: { critical } }], isCritical: true
    })[0];
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
    return {
      perDie, multiplyNumeric, powerfulCritical,
      altered: [one, two].some(roll => altersDice(roll)),
      bonusDice: extraDiceRule(built, one, two, perDie)
    };
  } catch {
    return null;
  }
}

/**
 * What this world's rules for a critical hit's damage do with its extra dice, such as a melee
 * weapon's for Savage Attacks or Brutal Critical, which dnd5e throws with a roll's first die alone,
 * after it's thrown `perDie` times over: "rolled", thrown with it, as dnd5e does; "maximized", not
 * thrown, but the most they could roll added, as Midi-QOL's "Max Critical Dice (flat number)"
 * adds it; or "ignored", left out, as Midi's rules that change dice otherwise leave them. Found as
 * the rule is, by building a critical hit's damage with them, with critical damage added after it as
 * it is: one die with a die more and critical damage of a die and a number, then dice of two sizes
 * with two dice more, which must come out the same way. Null where they come out otherwise, as under
 * dnd5e 6's Powerful Critical, which adds the most each die's dice and its extra ones could roll
 * together, or can't be read.
 * @param {(formula: string, critical?: object) => Roll} built   A critical hit's damage, built.
 * @param {Roll} one        "1d6 + 3", built with nothing added.
 * @param {Roll} two        "2d8 + 1d4 + 3", built with nothing added.
 * @param {number} perDie
 * @returns {"rolled"|"maximized"|"ignored"|null}
 */
function extraDiceRule(built, one, two, perDie) {
  try {
    const added = built("1d6 + 3", { bonusDice: 1, bonusDamage: "1d4 + 2" });
    const thrown = plannedDice(added);
    const [first, critical] = thrown.dice;
    if ( !thrown.plannable || (thrown.dice.length !== 2) || (first.faces !== 6) ) return null;
    if ( (critical.faces !== 4) || (critical.number !== 1) ) return null;
    const numbers = [numbersOf(added), numbersOf(one)];
    if ( numbers.includes(null) ) return null;
    // Its extra die thrown, and the most a d6 could roll added in its place: 6.
    const rolled = first.number - perDie;
    const most = (numbers[0] - numbers[1] - 2) / 6;
    const rule = { "1,0": "rolled", "0,1": "maximized", "0,0": "ignored" }[`${rolled},${most}`] ?? null;
    if ( !rule ) return null;

    // Dice of two sizes, two dice more on the first alone, and critical damage of a number: the most
    // two d8s could roll being 16.
    const both = built("2d8 + 1d4 + 3", { bonusDice: 2, bonusDamage: "2" });
    const planned = plannedDice(both);
    const dice = planned.dice.map(({ faces, number }) => ({ faces, number }));
    const expected = [{ faces: 8, number: (2 * perDie) + (2 * rolled) }, { faces: 4, number: perDie }];
    if ( !planned.plannable || (JSON.stringify(dice) !== JSON.stringify(expected)) ) return null;
    const more = [numbersOf(both), numbersOf(two)];
    if ( more.includes(null) || (more[0] - more[1] !== 2 + (16 * most)) ) return null;
    return rule;
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
 * apply, and the changes modules make to damage, such as Midi-QOL's. Since 0.32.0 each is marked
 * as one of the app's, so that its critical hit is made as dnd5e makes it, as the player's roll
 * will be (`criticalAsDnd5e`).
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
    options[CRITICAL_AS_DND5E] = true;
    return DamageRoll.fromConfig({ ...rollConfig, options }, config);
  });
}

/**
 * Configure a critical hit's damage made for a player's roll from the app, or planned for one, as
 * dnd5e makes it, whatever another module's rules for critical hits say: the roll configured as
 * if it weren't critical, by every module that configures it, Midi-QOL's other changes to damage
 * among them; those terms kept the first time; then dnd5e's own critical made of a fresh copy of
 * them, each time it's configured, so that a die more never doubles what was doubled. Any other
 * roll is configured as it would be.
 * @this {DamageRoll}
 * @param {Function} wrapped
 * @param {...any} args
 * @returns {void}
 */
function criticalAsDnd5e(wrapped, ...args) {
  const ours = (this.options?.[CRITICAL_AS_DND5E] === true)
    || DAMAGE_COMMANDS.has(planFor(this.options?.[ROLL_TAG])?.command.kind);
  const allowed = (this.options?.critical?.allow !== false) && (args[0]?.critical?.allow !== false);
  if ( !ours || !DND5E_CONFIGURE || !this.isCritical || !allowed ) return wrapped(...args);
  // libWrapper drops a WRAPPER that doesn't call what it wraps: the rest always configures it.
  this.options.isCritical = false;
  try {
    wrapped(...args);
  } finally {
    this.options.isCritical = true;
  }
  if ( !uncritical.has(this) ) uncritical.set(this, this.terms.map(copyTerm));
  this.terms = uncritical.get(this).map(copyTerm);
  this.options.configured = false;
  return DND5E_CONFIGURE.call(this, { critical: args[0]?.critical ?? {} });
}

/**
 * A copy of a roll's term, unevaluated, as dnd5e 6 copies one (damage-roll.mjs:217).
 * @param {RollTerm} term
 * @returns {RollTerm}
 */
function copyTerm(term) {
  return foundry.dice.terms.RollTerm.fromData(foundry.utils.deepClone(term.toJSON()));
}

/**
 * A damage roll's terms as configured without its critical hit, where it's an app roll's: those
 * a player's changes are made to.
 * @param {Roll} roll
 * @returns {RollTerm[]}
 */
export function uncriticalTerms(roll) {
  return uncritical.get(roll) ?? roll.terms;
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
 * Since 0.32.0 dnd5e's configuration of damage too, where it has damage rolls, as a WRAPPER, which
 * libWrapper runs outside every other kind, so outside Midi-QOL's: a critical hit's damage for the
 * app is then made as dnd5e makes it.
 * @returns {void}
 */
export function installDicePlans() {
  if ( installed ) return;
  installed = true;
  const DiceTerm = "foundry.dice.terms.DiceTerm.prototype._roll";
  const Roll = "foundry.dice.Roll.prototype.evaluate";
  const Damage = "CONFIG.Dice.DamageRoll.prototype.configureDamage";
  const damage = typeof CONFIG.Dice?.DamageRoll?.prototype?.configureDamage === "function";
  if ( game.modules.get("lib-wrapper")?.active && globalThis.libWrapper ) {
    globalThis.libWrapper.register(MODULE_ID, DiceTerm, plannedRoll, "MIXED");
    globalThis.libWrapper.register(MODULE_ID, Roll, taggedEvaluate, "WRAPPER");
    if ( damage ) globalThis.libWrapper.register(MODULE_ID, Damage, criticalAsDnd5e, "WRAPPER");
  } else {
    wrap(foundry.dice.terms.DiceTerm.prototype, "_roll", plannedRoll);
    wrap(foundry.dice.Roll.prototype, "evaluate", taggedEvaluate);
    if ( damage ) wrap(CONFIG.Dice.DamageRoll.prototype, "configureDamage", criticalAsDnd5e);
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
export function wrap(target, name, wrapper) {
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
 * takes its own dice, in order; a critical hit's damage takes every die planned for it, however
 * this world and its modules roll critical damage; and dice with modifiers take them as their first
 * throw alone. What a module then does to a die, as Midi-QOL's critical rules can maximize it, is
 * its own.
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
  await modifiedDiceSelfTest();
}

/**
 * Check that dice with modifiers take the player's dice as their first throw, and only that:
 * damage of a d6 rerolled on a 2 or less, a d8, an exploding d6 and four d6s the highest three of
 * which are kept, with the player's 1 and 5, 3, 6, and 1 to 4. Foundry must roll the reroll of the
 * 1 and the explosion of the 6 itself; one that rolled them as first throws would give them the
 * player's next dice, which belong to the dice after, and its totals would be the app's no longer.
 * @returns {Promise<void>}
 */
async function modifiedDiceSelfTest() {
  const id = `self-test-${foundry.utils.randomID()}`;
  const [roll] = damageRollsFor({
    rolls: [{ parts: ["2d6r<=2 + 1d8 + 1d6x + 4d6kh3"], data: {}, options: { type: "slashing", [ROLL_TAG]: id } }],
    isCritical: false
  });
  const dice = [
    { faces: 6, results: [1, 5] }, { faces: 8, results: [3] }, { faces: 6, results: [6] },
    { faces: 6, results: [1, 2, 3, 4] }
  ];
  const planned = plannedDice(roll);
  check(planned.plannable && matchesDice(dice, planned.dice),
    `damage with modifiers, ${roll.formula}, can't be planned`);
  await withPlan({ id, kind: "damage", dice }, async plan => {
    await roll.evaluate();
    check([6, 8].every(faces => plan.remaining(faces) === 0), `${roll.formula} left the player's dice unused`);
  });
  const [rerolled, , exploded, kept] = roll.dice;
  const firsts = (die, count) => JSON.stringify((die?.results ?? []).slice(0, count).map(({ result }) => result));
  check((firsts(rerolled, 2) === "[1,5]") && (rerolled.results[0].rerolled === true) && (rerolled.results.length === 3),
    `${roll.formula} threw ${firsts(rerolled, 3)} for its rerolled d6, not the player's 1, rerolled, and 5`);
  check((firsts(exploded, 1) === "[6]") && (exploded.results[0].exploded === true) && (exploded.results.length >= 2),
    `${roll.formula} threw ${firsts(exploded, 2)} for its exploding d6, not the player's 6, exploded`);
  check((firsts(kept, 4) === "[1,2,3,4]") && (kept.total === 9),
    `${roll.formula} threw ${firsts(kept, 4)} for the d6s it keeps three of, coming to ${kept?.total}, not 9`);
}

/**
 * Check that damage a player changes in the app is changed as expected: a critical hit's with a die
 * more, made a d10, throws the dice its changed preview says, however this world and its modules
 * roll critical damage, and takes every one of the player's dice, with extra dice and critical
 * damage of a die too, whose die is never the one changed, and damage that takes a die away, whose
 * die taken away is never the one changed; damage whose only die is its critical damage's, or one it
 * takes away, has none to change; and damage at its highest has every die at its highest.
 * @returns {Promise<void>}
 */
async function modifiersSelfTest() {
  const modifiers = { extra: 1, faces: 10 };
  for ( const [parts, critical] of [
    [["1d8", "2"], undefined], [["1d8 + 2"], { bonusDice: 1, bonusDamage: "1d4" }], [["3 - 1d4 + 1d8"], undefined]
  ] ) {
    const id = `self-test-${foundry.utils.randomID()}`;
    const process = {
      rolls: [{ parts, data: {}, options: { type: "slashing", [ROLL_TAG]: id, ...(critical && { critical }) } }],
      isCritical: true
    };
    const expected = modifiedDice(plannedDamage(process), modifiers);
    const [roll] = damageRollsFor(process);
    reshapeDamage(roll, modifiers);
    const thrown = plannedDice(roll);
    check(Array.isArray(expected) && thrown.plannable && (JSON.stringify(thrown.dice) === JSON.stringify(expected)),
      `a critical hit's damage with a d10 more threw ${roll.formula}, not ${JSON.stringify(expected)}`);
    const dice = playersDice(expected);
    check(takesAllDice([roll], dice), `${roll.formula} can't take the player's dice`);
    await withPlan({ id, kind: "damage", dice, modifiers }, async plan => {
      await roll.evaluate();
      check(dice.every(({ faces }) => plan.remaining(faces) === 0), `${roll.formula} left the player's dice unused`);
    });
  }

  // A number with critical damage of a die: no die of its own to change, nor is the critical
  // damage's changed in its place.
  const flat = { rolls: [{ parts: ["3"], data: {}, options: { critical: { bonusDamage: "1d6" } } }], isCritical: true };
  check(modifiedDice(plannedDamage(flat), { extra: 1 }) === null, "a die more was planned of damage with none of its own");
  const [flatRoll] = damageRollsFor(flat);
  reshapeDamage(flatRoll, { extra: 1 });
  const flatDice = plannedDice(flatRoll).dice.map(({ faces, number }) => ({ faces, number }));
  check(JSON.stringify(flatDice) === JSON.stringify([{ faces: 6, number: 1 }]),
    `damage with no die of its own, a die more, threw ${flatRoll.formula}`);

  // A number less a die, with critical damage of a die: the die it takes away is never the one
  // changed, nor is the critical damage's in its place.
  const taken = { rolls: [{ parts: ["3 - 1d4"], data: {}, options: { critical: { bonusDamage: "1d6" } } }], isCritical: true };
  check(modifiedDice(plannedDamage(taken), { extra: 1 }) === null, "a die more was planned of a die damage takes away");
  const [takenRoll] = damageRollsFor(taken);
  // As this world makes a critical hit's dice: under dnd5e's own rules, 2d4 and 1d6.
  const built = JSON.stringify(plannedDice(takenRoll).dice.map(({ faces, number }) => ({ faces, number })));
  reshapeDamage(takenRoll, { extra: 1 });
  const takenDice = JSON.stringify(plannedDice(takenRoll).dice.map(({ faces, number }) => ({ faces, number })));
  check(takenDice === built, `damage that takes its only die of its own away, a die more, threw ${takenRoll.formula}`);

  const highest = `self-test-${foundry.utils.randomID()}`;
  const [max] = damageRollsFor({ rolls: [{ parts: ["2d6", "1"], data: {}, options: { [ROLL_TAG]: highest } }] });
  await withPlan({ id: highest, kind: "damage", dice: [{ faces: 6, results: [6, 6] }], modifiers: { maximize: true } },
    () => max.evaluate());
  check(max.total === 13, `damage at its highest, 2d6 + 1, came to ${max.total}`);
}

/**
 * Dice a player might roll for planned dice, for a self-test: each die's faces in turn.
 * @param {{faces: number, number: number}[]} planned
 * @returns {{faces: number, results: number[]}[]}
 */
function playersDice(planned) {
  return planned.map(({ faces, number }) => ({ faces, results: Array.from({ length: number }, (_, i) => (i % faces) + 1) }));
}

/**
 * @param {boolean} condition
 * @param {string} failure     What went wrong, when it isn't so.
 */
function check(condition, failure) {
  if ( !condition ) throw new Error(failure);
}
