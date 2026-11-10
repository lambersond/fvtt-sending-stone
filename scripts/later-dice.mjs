import { COST_CHECK, COST_SPENDING, DIE_FACES, EVENTS, MODULE_ID, ROLL_TAG, RUN_KINDS, SETTINGS } from "./constants.mjs";
import { canSend, registerDiceAsks } from "./bridge.mjs";
import { getCampaigns, manualDiceOn } from "./campaigns.mjs";
import { summarizeRoll } from "./chat-data.mjs";
import { failedResult, isId } from "./command-rolls.mjs";
import { commandActor } from "./creatures.mjs";
import { costTargetClass, isOwnRoll, planAlive, registerLaterDice, withPlan, wrap } from "./dice-plan.mjs";
import { isOpen } from "./midi-prompts.mjs";
import { send } from "./transport.mjs";

/**
 * The dice the game rolls later, asked of a player typing in theirs (module 0.45.0, PROTOCOL.md's
 * "Dice the game rolls later").
 *
 * A player's typed roll of an item opens its **run**: while it's made, and under Midi-QOL until the
 * workflow it started or fed completes, five minutes at most. A roll dnd5e builds in the run after
 * the roll's own, such as the 2d6 cold of dnd5e's Ice Knife that Midi rolls with its 1d10, is
 * paused as it's about to be thrown, and its player is asked for its dice, one ask for each step of
 * rolls, each die term answered apart; so are the dice its use spends, and a Midi bonus damage
 * macro's formula. A die of a typed roll thrown again, an explosion or a reroll not kept at the
 * table, is asked one die at a time, where the throw it follows took its player's value. Which rolls
 * belong to a run is told from what dnd5e and Midi put on every roll, its subject and its workflow,
 * and the dice a use spends from the use's own spending, which dnd5e passes to each, so no item
 * needs code of its own.
 *
 * An ask waits a minute, only while the character is open in the app; then, or once the Gamemaster
 * chooses Roll it now in the small window their Foundry shows, Foundry's computer dice roll it. A
 * roll whose run is waiting isn't timed out meanwhile (commands.mjs's watchdog asks `heldFor`).
 *
 * dice-plan.mjs makes the rolls, with the values given; it never imports this file, which
 * registers itself there. Only under dnd5e 5: under dnd5e 6 no run opens, and the hello says why.
 */

/**
 * How long an ask waits, in milliseconds, unless the hidden setting shortens it.
 * @type {number}
 */
export const DICE_ASK_WAIT = 60_000;

/**
 * The shortest wait the hidden setting may set, in milliseconds.
 * @type {number}
 */
const SHORTEST_WAIT = 1_000;

/**
 * How long a run stays open at most, in milliseconds, as a Midi-QOL use from the app may take.
 * @type {number}
 */
const RUN_WITHIN = 300_000;

/**
 * How often waiting asks are looked at, in milliseconds, besides after every fetch.
 * @type {number}
 */
const CHECK_EVERY = 5_000;

/**
 * How long an answer's result waits for the rolls it answers to be thrown, in milliseconds.
 * @type {number}
 */
const RESULT_WAIT = 10_000;

/**
 * How long a closed ask is kept, in milliseconds, so that a late answer is told why it's refused.
 * @type {number}
 */
const KEPT = 600_000;

/**
 * The most rolls an ask lists, terms each of its rolls lists, dice one term may have, and entries
 * an answer may have.
 * @type {{rolls: number, terms: number, dice: number, entries: number}}
 */
const MOST = { rolls: 10, terms: 10, dice: 40, entries: 100 };

/**
 * The longest label, formula and flavor an ask carries.
 * @type {{label: number, formula: number, flavor: number}}
 */
const LONGEST = { label: 200, formula: 400, flavor: 200 };

/**
 * The ids an app may name an ask, a character or a companion by.
 * @type {RegExp}
 */
const ID = /^[A-Za-z0-9]{1,64}$/;

/**
 * Whether this world can ask for later dice: once set up under dnd5e 5 and its self-test has
 * passed (`ready`); and if not, why not: `"pending"`, `"system"` (another system, dnd5e 6
 * among them) or `"self-test"`, with what went wrong (`error`).
 * @type {{ready: boolean, reason: string|null, error: string|null}}
 */
export const laterDiceStatus = { ready: false, reason: "pending", error: null };

/**
 * Has later-dice been set up?
 * @type {boolean}
 */
let installed = false;

/**
 * The campaigns whose app reads dice asks, as its latest answer to their hello or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * Each typed roll being made, or whose run is still open, by its command's id.
 * @type {Map<string, Run>}
 */
const runs = new Map();

/**
 * The run each Midi-QOL workflow is bound to: the latest roll that started or fed it.
 * @type {Map<object, Run>}
 */
const byWorkflow = new Map();

/**
 * The Midi-QOL workflows taken out of any run: fed by a roll that opens none, as the Gamemaster's
 * damage from the app or an untyped one, or rolled with a click, as the Gamemaster's from Midi's
 * card. Their rolls are no run's, though a use from the app tags them still.
 * @type {WeakSet<object>}
 */
const released = new WeakSet();

/**
 * Every ask, by its id, kept a while once closed.
 * @type {Map<string, Ask>}
 */
const asks = new Map();

/**
 * The time each command's asks waited, counted once while two wait together; how many wait now, and
 * since when one has; and when this last changed; by the command's id.
 * @type {Map<string, {held: number, open: number, since: number, at: number}>}
 */
const held = new Map();

/**
 * The later step each roll belongs to.
 * @type {WeakMap<Roll, Step>}
 */
const steps = new WeakMap();

/**
 * The asks each roll is listed in, for their answers' results.
 * @type {WeakMap<Roll, Ask[]>}
 */
const asksOfRoll = new WeakMap();

/**
 * What's open while Midi-QOL rolls a workflow's bonus damage, after its macros have returned: rolls
 * of their formulas are expected, each taken once, built as Midi builds them, one at a time.
 * @type {Bracket[]}
 */
const brackets = [];

/**
 * The runs whose use dnd5e is spending now, by the key its spending's configuration carries
 * (`COST_SPENDING`), from `dnd5e.preActivityConsumption` until `dnd5e.activityConsumption`: each dice
 * cost dnd5e rolls with it is that run's, its ask labelled so.
 * @type {Map<string, {run: Run, label: string}>}
 */
const spending = new Map();

/**
 * The Midi-QOL workflows of runs inside their check of their other activity's consumption, which
 * spends what that activity spends: the activity, and whether its spending has begun, which is the
 * run's, once.
 * @type {Map<object, {activity: object, taken: boolean}>}
 */
const otherSpending = new Map();

/**
 * The workflows whose bonus damage Midi-QOL is rolling, before their macros have returned.
 * @type {WeakSet<object>}
 */
const rollingBonus = new WeakSet();

/**
 * What has been warned of, once each.
 * @type {Set<string>}
 */
const warned = new Set();

/**
 * The next look at the waiting asks.
 * @type {number|null}
 */
let checking = null;

/**
 * The self-test's own answers, in order, while it runs: its asks send nothing and wait for nothing.
 * @type {object[][]|null}
 */
let testAnswers = null;

/**
 * A typed roll being made, and its item's run.
 * @typedef {object} Run
 * @property {object} command         As fetched.
 * @property {string} commandId
 * @property {string} campaignId      The campaign it was fetched for, which alone is asked.
 * @property {string} actorId         The character, or a companion's key.
 * @property {string|null} of         A companion's character.
 * @property {Set<string>} actors     The uuids of whose rolls are its: the actor it's made on, as a
 *                                    form or a companion, and the character.
 * @property {string|null} itemId     Its item's id, on that actor.
 * @property {string|null} itemName
 * @property {boolean} window         Is it a kind whose item's later rolls are asked?
 * @property {boolean} running        Is the roll being made now?
 * @property {Set<object>} workflows  The Midi-QOL workflows it started or fed.
 * @property {number} openedAt
 * @property {boolean} closed
 * @property {boolean} [test]         The self-test's own.
 */

/**
 * An ask, from the moment it's open.
 * @typedef {object} Ask
 * @property {string} id
 * @property {Run} run
 * @property {string} purpose
 * @property {string|null} again
 * @property {string} label
 * @property {boolean} critical
 * @property {{roll: Roll|null, terms: {term: DiceTerm, faces: number, number: number}[]}[]} listing
 * @property {number} askedAt
 * @property {number} expiresAt
 * @property {"waiting"|"closed"} state
 * @property {string|null} reason
 * @property {Promise<object[]|null>} settled   The answer's entries, or null for Foundry's dice.
 * @property {Set<Roll>} thrown
 */

/**
 * While Midi-QOL rolls a run's workflow's bonus damage, the rolls of the formulas expected: each as
 * Midi-QOL builds it, a `DamageRoll` of `{type, flavor}`, its flavor its type where the macro gave
 * none. Midi rolls bonus damage one roll after another, each awaited: so while one of a bracket's
 * rolls is being thrown, waiting on its ask among it, no other roll is the bracket's. But nothing on
 * such a roll says whose it is: while another run's bracket expects one of its formulas too,
 * neither's rolls are asked from then on (`shared`).
 * @typedef {object} Bracket
 * @property {"bonus"} purpose
 * @property {Run} run
 * @property {object} owner       What opened it: the workflow.
 * @property {string} label
 * @property {Expected[]} expected
 * @property {Roll|null} busy     The roll of it being thrown now, until it's thrown.
 * @property {boolean} shared     Has another run's bracket expected one of its formulas meanwhile?
 */

/**
 * A roll a bracket expects: its formula; for bonus damage, its type where the macro named one of
 * dnd5e's, and its flavor where the macro gave one (`undefined`: its type).
 * @typedef {object} Expected
 * @property {string} formula
 * @property {string} [type]
 * @property {unknown} [flavor]
 */

/* -------------------------------------------- */
/*  Setting up                                  */
/* -------------------------------------------- */

/**
 * Is this world one whose later dice are asked: under dnd5e 5? Under dnd5e 6, whose support is
 * to come with its own Midi-QOL line, they aren't.
 * @returns {boolean}
 */
function dnd5e5() {
  if ( game.system?.id !== "dnd5e" ) return false;
  return Number.parseInt(String(game.system.version ?? "")) === 5;
}

/**
 * Set up asking for later dice, on a Gamemaster's client, once, after the dice plans: dnd5e's roll
 * and consumption hooks; the hello's list of open asks (bridge.mjs, which never imports this file);
 * and where Midi-QOL is active and has them, its bonus damage's macros and rolls, and its check of a
 * workflow's other activity's consumption, wrapped through libWrapper where it's active. Under any
 * system but dnd5e 5 nothing is set up, and the hello says why.
 * @returns {void}
 */
export function installLaterDice() {
  if ( installed ) return;
  if ( !dnd5e5() ) {
    Object.assign(laterDiceStatus, { ready: false, reason: "system", error: null });
    return;
  }
  installed = true;
  registerLaterDice({ stepOf, again, thrown, costOf, selfTest: laterSelfTest });
  registerDiceAsks(openDiceAsks);
  Hooks.on("dnd5e.postRollConfiguration", onRollConfiguration);
  Hooks.on("dnd5e.preActivityConsumption", openCost);
  Hooks.on("dnd5e.activityConsumption", closeCost);
  const Workflow = globalThis.MidiQOL?.Workflow;
  const proto = Workflow?.prototype;
  if ( (game.modules.get("midi-qol")?.active !== true) || !proto ) return;
  const libWrapper = game.modules.get("lib-wrapper")?.active ? globalThis.libWrapper : null;
  const around = (name, wrapper) => {
    if ( libWrapper ) libWrapper.register(MODULE_ID, `MidiQOL.Workflow.prototype.${name}`, wrapper, "WRAPPER");
    else wrap(proto, name, wrapper);
  };
  if ( (typeof proto.rollBonusDamage === "function") && (typeof proto.callMacros === "function") ) {
    around("rollBonusDamage", rollBonusDamage);
    around("callMacros", callMacros);
  }
  if ( typeof proto.checkOtherActivityConsumption === "function" ) {
    around("checkOtherActivityConsumption", checkOtherConsumption);
  }
}

/**
 * Can later dice be asked here now: set up, and its self-test passed?
 * @returns {boolean}
 */
function active() {
  return installed && laterDiceStatus.ready;
}

/**
 * What a campaign's hello says of asking its players for their later dice, in `features.rolls`:
 * whether they're asked, and if not, why not. Under any system but dnd5e 5, "system"; where its
 * players don't type in their dice, "manualDice"; where the self-test failed, "self-test".
 * @param {Campaign} campaign
 * @returns {{diceAsks: boolean, diceAsksReason: string|null}}
 */
export function diceAskFeatures(campaign) {
  if ( !dnd5e5() ) return { diceAsks: false, diceAsksReason: "system" };
  if ( !manualDiceOn(campaign) ) return { diceAsks: false, diceAsksReason: "manualDice" };
  if ( !active() ) return { diceAsks: false, diceAsksReason: "self-test" };
  return { diceAsks: true, diceAsksReason: null };
}

/**
 * Note whether a campaign's app reads dice asks, from what it said in answer to its hello or
 * heartbeat: `features.diceAsks`, the format it reads, 1 or later. An app that says nothing of it,
 * as one before them, is asked nothing; waiting asks of a campaign whose app no longer reads them
 * close at once.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {void}
 */
export function noteDiceAskReader(campaignId, features) {
  const format = features?.diceAsks;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else if ( readers.delete(campaignId) ) checkAsks();
}

/**
 * How long a roll waits for its dice: a minute, or less where a test set it so.
 * @returns {number}
 */
function askWait() {
  let wait;
  try {
    wait = Number(game.settings.get(MODULE_ID, SETTINGS.DICE_ASK_WAIT));
  } catch {
    wait = DICE_ASK_WAIT;
  }
  if ( !Number.isFinite(wait) ) wait = DICE_ASK_WAIT;
  return Math.min(Math.max(wait, SHORTEST_WAIT), DICE_ASK_WAIT);
}

/**
 * Warn the Gamemaster, in the console, once for each kind of thing.
 * @param {string} kind
 * @param {string} text
 * @param {unknown} [err]
 * @returns {void}
 */
function warnOnce(kind, text, err) {
  if ( warned.has(kind) ) return;
  warned.add(kind);
  console.warn(`${MODULE_ID} | ${text}`, ...(err ? [err] : []));
}

/* -------------------------------------------- */
/*  Runs                                        */
/* -------------------------------------------- */

/**
 * Open the run of a typed roll as it's about to be made: a player's own, `typed` and never the
 * Gamemaster's, of a kind whose item's later rolls are asked, or of any other, whose own dice may
 * be thrown again. Nothing where later dice aren't asked here at all: under another system than
 * dnd5e 5, or where the self-test failed, the game's later dice are rolled as before 0.45.0.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {Run|null}
 */
export function beginRun(command, campaign) {
  if ( !active() || (command?.typed !== true) || ((command.by !== undefined) && (command.by !== null)) ) return null;
  if ( (typeof command.id !== "string") || (command.kind === "dice") ) return null;
  sweepRuns();
  let found = null;
  try {
    found = commandActor(command, campaign);
  } catch {
    found = null;
  }
  if ( !found ) return null;
  const item = itemOf(command, found.actor);
  const run = {
    command, commandId: command.id, campaignId: campaign.id, actorId: String(command.actorId),
    of: isId(command.of) ? command.of : null,
    actors: new Set([found.actor?.uuid, found.character?.uuid].filter(Boolean)),
    itemId: item?.id ?? null, itemName: (typeof item?.name === "string") ? item.name : null,
    window: RUN_KINDS.includes(command.kind), running: true, workflows: new Set(), openedAt: Date.now(), closed: false
  };
  runs.set(run.commandId, run);
  return run;
}

/**
 * The item a typed roll is of: the one it names on its actor, or for damage, its use's card's.
 * @param {object} command
 * @param {Actor} actor
 * @returns {Item|null}
 */
function itemOf(command, actor) {
  if ( command.kind === "damage" ) {
    const card = game.messages?.contents?.findLast?.(message => message.flags?.[MODULE_ID]?.use === command.use);
    return card?.getAssociatedActivity?.()?.item ?? null;
  }
  return (typeof command.item === "string") ? (actor?.items?.get?.(command.item) ?? null) : null;
}

/**
 * The roll is made: its run stays open while a Midi-QOL workflow it started or fed goes on.
 * @param {Run|null} run
 * @returns {void}
 */
export function endRun(run) {
  if ( !run ) return;
  run.running = false;
  if ( !run.window || !run.workflows.size ) closeRun(run, "gone");
  else sweepRuns();
}

/**
 * Bind a Midi-QOL workflow to the run of the roll that started or fed it, as soon as it's known: its
 * rolls are that run's from then on, its later ones among them, until it ends. Fed by a roll that
 * opens no run, as the Gamemaster's damage from the app or a player's untyped one, it's no run's
 * from then on: what Midi rolls with that damage, and after it, is Foundry's, as before 0.45.0.
 * @param {string} commandId
 * @param {object} workflow
 * @returns {void}
 */
export function bindWorkflow(commandId, workflow) {
  if ( !workflow || (typeof workflow !== "object") ) return;
  const run = runs.get(commandId);
  if ( !run || run.closed || !run.window ) return void releaseWorkflow(workflow);
  released.delete(workflow);
  run.workflows.add(workflow);
  byWorkflow.set(workflow, run);
}

/**
 * Take a Midi-QOL workflow out of every run it started or fed, for good unless a run's roll feeds
 * it again: its rolls are no run's. Such a run, made, closes once no other workflow of its goes on.
 * @param {object} workflow
 * @returns {void}
 */
function releaseWorkflow(workflow) {
  released.add(workflow);
  byWorkflow.delete(workflow);
  let bound = false;
  for ( const run of runs.values() ) bound = run.workflows.delete(workflow) || bound;
  if ( !bound ) return;
  for ( const bracket of Array.from(brackets) ) {
    if ( bracket.owner === workflow ) closeBracket(bracket);
  }
  sweepRuns();
}

/**
 * Has a Midi-QOL workflow ended: completed, finished rolling, or aborted?
 * @param {object} workflow
 * @returns {boolean}
 */
function workflowEnded(workflow) {
  if ( workflow.aborted === true ) return true;
  const ended = ["WorkflowState_Abort", "WorkflowState_RollFinished", "WorkflowState_Cleanup", "WorkflowState_Completed"]
    .map(state => workflow[state]).filter(state => typeof state === "function");
  return ended.includes(workflow.currentAction);
}

/**
 * Close the runs that are over: made, with every workflow they're bound to ended, or open for five
 * minutes. Their waiting asks close too: `"gone"` where a workflow was aborted, else `"expired"`.
 * @returns {void}
 */
function sweepRuns() {
  const now = Date.now();
  for ( const run of Array.from(runs.values()) ) {
    if ( run.running && (now - run.openedAt < RUN_WITHIN) ) continue;
    const aborted = Array.from(run.workflows).some(workflow => workflow.aborted === true);
    if ( (now - run.openedAt >= RUN_WITHIN) ) closeRun(run, aborted ? "gone" : "expired");
    else if ( !run.running && Array.from(run.workflows).every(workflowEnded) ) closeRun(run, aborted ? "gone" : "expired");
  }
}

/**
 * Close a run, and its waiting asks with this reason.
 * @param {Run} run
 * @param {"gone"|"expired"} reason
 * @returns {void}
 */
function closeRun(run, reason) {
  run.closed = true;
  if ( runs.get(run.commandId) === run ) runs.delete(run.commandId);
  for ( const workflow of run.workflows ) {
    if ( byWorkflow.get(workflow) === run ) byWorkflow.delete(workflow);
  }
  for ( const bracket of Array.from(brackets) ) {
    if ( bracket.run === run ) closeBracket(bracket);
  }
  for ( const [key, entry] of Array.from(spending) ) {
    if ( entry.run === run ) spending.delete(key);
  }
  for ( const ask of asks.values() ) {
    if ( (ask.run === run) && (ask.state === "waiting") ) closeAsk(ask, reason);
  }
}

/**
 * Do these actor's rolls belong to a run: the actor it's made on, or its character?
 * @param {Run} run
 * @param {Actor|undefined} actor
 * @returns {boolean}
 */
function actorOf(run, actor) {
  return (typeof actor?.uuid === "string") && run.actors.has(actor.uuid);
}

/**
 * The run a Midi-QOL workflow's rolls belong to: the one it's bound to; or, not yet bound, that of
 * the use from the app it was started for, which tags it. None for any other workflow, the
 * Gamemaster's own among them, nor for one taken out of its run.
 * @param {object} workflow
 * @returns {Run|null}
 */
function runOfWorkflow(workflow) {
  if ( released.has(workflow) ) return null;
  const bound = byWorkflow.get(workflow);
  if ( bound && !bound.closed ) return bound;
  const tag = workflow.workflowOptions?.[ROLL_TAG];
  const run = (typeof tag === "string") ? runs.get(tag) : null;
  if ( !run || run.closed || !run.window ) return null;
  bindWorkflow(run.commandId, workflow);
  return run;
}

/**
 * The run whose item a roll's subject is an activity of, while it's being made, with no click: the
 * latest such, of the subject's actor.
 * @param {object} subject   The roll process's subject.
 * @returns {Run|null}
 */
function runOfSubject(subject) {
  const item = subject?.item;
  if ( !item?.id || (typeof item.id !== "string") ) return null;
  const actor = subject.actor ?? item.actor;
  const found = Array.from(runs.values())
    .filter(run => run.window && run.running && !run.closed && (run.itemId === item.id) && actorOf(run, actor));
  return found.at(-1) ?? null;
}

/* -------------------------------------------- */
/*  Which rolls are asked                       */
/* -------------------------------------------- */

/**
 * The run a step of rolls dnd5e has configured belongs to, if any, and so is asked: not a plan's own
 * step, nor a d20 roll; of the run's character; with Midi-QOL, named its workflow by its process;
 * otherwise, its subject an activity of the run's item while it's made; with no click either way.
 * One with a click in a run's workflow, as the Gamemaster's from Midi's card, takes the workflow out
 * of the run, as their damage from the app does. Not damage Midi-QOL averages.
 * @param {Roll[]} rolls
 * @param {object} process   The roll process's configuration.
 * @returns {Run|null}
 */
function runOfStep(rolls, process) {
  if ( !Array.isArray(rolls) || !rolls.length || rolls.some(roll => isOwnRoll(roll)) ) return null;
  const D20Roll = CONFIG.Dice?.D20Roll;
  if ( D20Roll && rolls.some(roll => roll instanceof D20Roll) ) return null;
  const workflow = process?.workflow;
  let run;
  if ( workflow && (typeof workflow === "object") ) {
    run = runOfWorkflow(workflow);
    if ( run && !actorOf(run, process.subject?.actor ?? workflow.actor) ) return null;
    if ( run && process.event ) {
      releaseWorkflow(workflow);
      return null;
    }
  } else {
    if ( process?.event ) return null;
    run = runOfSubject(process?.subject);
  }
  if ( !run ) return null;
  const DamageRoll = CONFIG.Dice?.DamageRoll;
  if ( DamageRoll && (rolls[0] instanceof DamageRoll) && midiAverages(process.subject?.actor ?? workflow?.actor) ) return null;
  return run;
}

/**
 * Does Midi-QOL roll this actor's damage itself, at its average, as its Average Damage setting has
 * it for every actor, or for actors of its type?
 * @param {Actor|undefined} actor
 * @returns {boolean}
 */
function midiAverages(actor) {
  if ( game.modules.get("midi-qol")?.active !== true ) return false;
  const average = globalThis.MidiQOL?.configSettings?.()?.averageDamage;
  return (average === "all") || ((typeof average === "string") && (average === actor?.type));
}

/**
 * Once dnd5e has configured a step of rolls, just before they're thrown: note it as a later step of
 * the run it belongs to, if any, to be asked as its first roll is thrown.
 * @param {Roll[]} rolls
 * @param {object} process
 * @returns {void}
 */
function onRollConfiguration(rolls, process) {
  if ( !active() ) return;
  let run;
  try {
    run = runOfStep(rolls, process);
  } catch (err) {
    warnOnce("attribute", "Could not tell whether a roll's dice are to be asked in the app: Foundry rolls them.", err);
    return;
  }
  if ( !run ) return;
  const step = new Step(run, rolls, {
    purpose: purposeOf(rolls, process), label: labelOf(process?.subject, run),
    critical: (process?.isCritical === true) || (rolls[0]?.isCritical === true)
  });
  for ( const roll of rolls ) steps.set(roll, step);
}

/**
 * What a step of rolls is: a utility's formula, damage, healing, where every roll's kind is one of
 * dnd5e's healing types, or another roll.
 * @param {Roll[]} rolls
 * @param {object} process
 * @returns {"formula"|"damage"|"healing"|"other"}
 */
function purposeOf(rolls, process) {
  if ( process?.hookNames?.includes?.("formula") ) return "formula";
  const DamageRoll = CONFIG.Dice?.DamageRoll;
  if ( !DamageRoll || !(rolls[0] instanceof DamageRoll) ) return "other";
  const healing = CONFIG.DND5E?.healingTypes ?? {};
  return rolls.every(roll => (typeof roll.options?.type === "string") && (roll.options.type in healing)) ? "healing" : "damage";
}

/**
 * What an ask says rolls: the item's name, and its activity's after a colon where that's another;
 * the run's item's where there's none.
 * @param {object} [activity]
 * @param {Run} run
 * @returns {string}
 */
function labelOf(activity, run) {
  const item = (typeof activity?.item?.name === "string") ? activity.item.name : run.itemName;
  const own = (typeof activity?.name === "string") ? activity.name.trim() : "";
  const label = (item && own && (own !== item)) ? `${item}: ${own}` : (item || own || "");
  return label.slice(0, LONGEST.label);
}

/**
 * The later step a roll about to be thrown belongs to, for dice-plan.mjs: as noted once configured,
 * or as a run's dice cost, or a roll of a formula expected while a run's workflow rolls its Midi
 * bonus damage, taken once.
 * @param {Roll} roll
 * @returns {Step|null}
 */
function stepOf(roll) {
  if ( !active() || !roll ) return null;
  // One whose run has closed meanwhile is still a later roll: asked of no one, never given its
  // plan's values.
  const noted = steps.get(roll);
  if ( noted ) return noted;
  if ( !brackets.length || isOwnRoll(roll) || planAlive(roll.options?.[ROLL_TAG]) ) return null;
  for ( const bracket of brackets ) {
    // One at a time: while one of its rolls is thrown, any other roll is someone else's. A shared
    // one's are asked of no one, and wait for nothing.
    if ( bracket.busy && !bracket.shared ) continue;
    const index = bracket.expected.findIndex(each => fitsBracket(bracket.purpose, each, roll));
    if ( index === -1 ) continue;
    bracket.expected.splice(index, 1);
    // A shared one stays open until what opened it is done: another run's roll may have been taken
    // in place of one of its own.
    if ( bracket.shared ) bracket.busy = null;
    else if ( bracket.expected.length ) bracket.busy = roll;
    else closeBracket(bracket);
    const step = new Step(bracket.run, [roll], {
      purpose: bracket.purpose, label: bracket.label, critical: false, silent: bracket.shared
    });
    steps.set(roll, step);
    return step;
  }
  return null;
}

/**
 * Is a roll about to be thrown one a bracket expects, built as Midi-QOL builds bonus damage: of its
 * formula, a DamageRoll of the type the macro named, flavored as Midi flavors it, never a d20 roll?
 * @param {"bonus"} purpose
 * @param {Expected} expected
 * @param {Roll} roll
 * @returns {boolean}
 */
function fitsBracket(purpose, expected, roll) {
  const { DamageRoll, D20Roll } = CONFIG.Dice ?? {};
  if ( (purpose !== "bonus") || (roll.formula !== expected.formula) || (D20Roll && (roll instanceof D20Roll)) ) return false;
  const options = roll.options ?? {};
  if ( !DamageRoll || !(roll instanceof DamageRoll) || (typeof options.type !== "string") ) return false;
  if ( (expected.type !== undefined) && (options.type !== expected.type) ) return false;
  return options.flavor === ((expected.flavor === undefined) ? options.type : expected.flavor);
}

/**
 * Open a bracket: where another run's, of the same purpose, expects a roll of one of its formulas
 * too, as two characters' workflows rolling a bonus 1d6 each at once, which roll is whose can't be
 * told, so neither's rolls are asked from then on; they're still later rolls, Foundry's computer
 * dice.
 * @param {Omit<Bracket, "busy"|"shared">} details
 * @returns {void}
 */
function openBracket(details) {
  const bracket = { ...details, busy: null, shared: false };
  const formulas = new Set(bracket.expected.map(each => each.formula));
  for ( const other of brackets ) {
    if ( (other.run === bracket.run) || (other.purpose !== bracket.purpose) ) continue;
    if ( !other.expected.some(each => formulas.has(each.formula)) ) continue;
    other.shared = true;
    bracket.shared = true;
  }
  brackets.push(bracket);
}

/**
 * Close a bracket. Once what opened it is done, what a shared one still expects is a roll of
 * another run's yet to come, one of whose place its own took: another run's shared bracket of the
 * same purpose, still open, takes it over.
 * @param {Bracket} bracket
 * @param {boolean} [done]   Is what opened it done: has Midi rolled the bonus damage?
 * @returns {void}
 */
function closeBracket(bracket, done=false) {
  const index = brackets.indexOf(bracket);
  if ( index !== -1 ) brackets.splice(index, 1);
  if ( !done || !bracket.shared || !bracket.expected.length ) return;
  const heir = brackets.find(other => other.shared && (other.purpose === bracket.purpose) && (other.run !== bracket.run));
  heir?.expected.push(...bracket.expected);
}

/* -------------------------------------------- */
/*  Dice a use spends                           */
/* -------------------------------------------- */

/**
 * As dnd5e begins spending what an activity uses: where it's a run's own spending, mark its
 * configuration as that run's (`COST_SPENDING`), which dnd5e passes on to every dice cost it rolls
 * for it, a linked activity's among them, until it has spent. Any other's carries no mark: a dice
 * cost rolled for it is no run's.
 * @param {Activity} activity
 * @param {object} usageConfig
 * @returns {void}
 */
function openCost(activity, usageConfig) {
  if ( !usageConfig || (typeof usageConfig !== "object") ) return;
  delete usageConfig[COST_SPENDING];
  if ( !active() ) return;
  try {
    const run = runOfSpending(activity, usageConfig);
    if ( !run ) return;
    const key = `${run.commandId}.${foundry.utils.randomID(8)}`;
    spending.set(key, { run, label: labelOf(activity, run) });
    usageConfig[COST_SPENDING] = key;
  } catch (err) {
    warnOnce("cost", "Could not tell whether a use's dice cost is to be asked in the app: Foundry rolls it.", err);
  }
}

/**
 * dnd5e has worked out what an activity spends: its dice costs are rolled, and the mark goes.
 * @param {Activity} activity
 * @param {object} usageConfig
 * @returns {void}
 */
function closeCost(activity, usageConfig) {
  const key = usageConfig?.[COST_SPENDING];
  if ( typeof key !== "string" ) return;
  spending.delete(key);
  delete usageConfig[COST_SPENDING];
}

/**
 * The run whose own spending dnd5e begins, if any: the use the module makes for a run's roll, its
 * configuration naming that roll (command-uses.mjs, command-alone.mjs), while it's made, of its
 * actor; or, under Midi-QOL, the other activity of a run's workflow, as that very workflow's check
 * of its other activity's consumption spends it, the first spending of that activity within it.
 * Never by the item, nor by a run's being open: the Gamemaster's own use of the item meanwhile is a
 * use of its own, on a copy dnd5e makes of the item, with no such name.
 * @param {Activity} activity
 * @param {object} usageConfig
 * @returns {Run|null}
 */
function runOfSpending(activity, usageConfig) {
  const actor = activity?.actor ?? activity?.item?.actor;
  const tag = usageConfig[ROLL_TAG];
  const own = (typeof tag === "string") ? runs.get(tag) : null;
  if ( own ) return (own.window && own.running && !own.closed && actorOf(own, actor)) ? own : null;
  for ( const [workflow, entry] of otherSpending ) {
    if ( entry.taken || (entry.activity !== activity) ) continue;
    entry.taken = true;
    const run = runOfWorkflow(workflow);
    return (run && !workflowEnded(workflow) && actorOf(run, actor)) ? run : null;
  }
  return null;
}

/**
 * What notes a dice cost dnd5e rolls with a use's configuration as its run's, for dice-plan.mjs:
 * one step of its own, asked as it's thrown; none where the configuration isn't a run's spending.
 * @param {object} config
 * @returns {((roll: Roll) => void)|null}
 */
function costOf(config) {
  if ( !active() ) return null;
  const entry = spending.get(config?.[COST_SPENDING]);
  if ( !entry || entry.run.closed ) return null;
  return roll => {
    steps.set(roll, new Step(entry.run, [roll], { purpose: "cost", label: entry.label, critical: false }));
  };
}

/**
 * Around Midi-QOL's check of a workflow's other activity's consumption, which spends what that
 * activity spends before its deferred damage is rolled: for a workflow of a run, the first spending
 * of that very activity within it is the run's.
 * @this {object}              The workflow.
 * @param {Function} wrapped   Midi's own.
 * @param {...any} args
 * @returns {Promise<boolean>}
 */
async function checkOtherConsumption(wrapped, ...args) {
  let entry = null;
  try {
    const run = active() ? runOfWorkflow(this) : null;
    const activity = (run && !workflowEnded(this)) ? this.otherActivity : null;
    if ( activity && (typeof activity === "object") ) entry = { activity, taken: false };
  } catch (err) {
    warnOnce("other", "Could not tell whether a Midi-QOL other activity's cost is to be asked in the app: Foundry rolls it.", err);
  }
  if ( entry ) otherSpending.set(this, entry);
  try {
    return await wrapped(...args);
  } finally {
    if ( entry && (otherSpending.get(this) === entry) ) otherSpending.delete(this);
  }
}

/* -------------------------------------------- */
/*  Midi-QOL's bonus damage                     */
/* -------------------------------------------- */

/**
 * Around Midi-QOL's roll of a workflow's bonus damage: its macros' formulas are expected while it
 * rolls them, and no longer once it returns.
 * @this {object}              The workflow.
 * @param {Function} wrapped   Midi's own.
 * @param {...any} args
 * @returns {Promise<Roll[]>}
 */
async function rollBonusDamage(wrapped, ...args) {
  rollingBonus.add(this);
  try {
    return await wrapped(...args);
  } finally {
    rollingBonus.delete(this);
    for ( const bracket of Array.from(brackets) ) {
      if ( (bracket.purpose === "bonus") && (bracket.owner === this) ) closeBracket(bracket, true);
    }
  }
}

/**
 * Around Midi-QOL's call of a workflow's macros: once its bonus damage macros have returned, while it
 * rolls them for a workflow bound to a run, expect a roll of each formula they returned, built as
 * Midi builds it, each once. A Roll a macro made itself is never one.
 * @this {object}              The workflow.
 * @param {Function} wrapped   Midi's own.
 * @param {...any} args        Its item, macros, tag and pass.
 * @returns {Promise<unknown>}
 */
async function callMacros(wrapped, ...args) {
  const results = await wrapped(...args);
  if ( !active() || (args[2] !== "DamageBonus") || !rollingBonus.has(this) ) return results;
  try {
    const run = runOfWorkflow(this);
    if ( run && !workflowEnded(this) ) {
      const expected = bonusFormulas(this, args[0], results);
      if ( expected.length ) {
        openBracket({ purpose: "bonus", run, owner: this, label: labelOf(this.activity, run), expected });
      }
    }
  } catch (err) {
    warnOnce("bonus", "Could not tell whether a Midi-QOL bonus damage is to be asked in the app: Foundry rolls it.", err);
  }
  return results;
}

/**
 * The rolls of a workflow's bonus damage macros' results, as Midi-QOL builds each into a damage
 * roll (Workflow.ts:4078-4105): with the item's roll data, or the actor's; of the kind of damage it
 * names, where that's one of dnd5e's, else of one Midi works out; flavored as the macro says, else
 * as its type. A Roll of the macro's own left out.
 * @param {object} workflow
 * @param {Item|undefined} item
 * @param {unknown} results
 * @returns {Expected[]}
 */
function bonusFormulas(workflow, item, results) {
  const DamageRoll = CONFIG.Dice?.DamageRoll;
  if ( !DamageRoll ) return [];
  const flat = (Array.isArray(results) ? results : [results]).flat(Infinity);
  const data = item?.getRollData?.() ?? workflow.actor?.getRollData?.() ?? {};
  const types = { ...(CONFIG.DND5E?.damageTypes ?? {}), ...(CONFIG.DND5E?.healingTypes ?? {}) };
  const expected = [];
  for ( const entry of flat ) {
    if ( !entry || (typeof entry !== "object") || (entry instanceof foundry.dice.Roll) ) continue;
    if ( (typeof entry.damageRoll !== "string") || !entry.damageRoll ) continue;
    try {
      const roll = new DamageRoll(entry.damageRoll, data, {});
      if ( roll.isDeterministic ) continue;
      const named = (typeof entry.damageType === "string") && Object.hasOwn(types, entry.damageType);
      const flavored = (entry.flavor !== undefined) && (entry.flavor !== null);
      expected.push({ formula: roll.formula, ...(named && { type: entry.damageType }), ...(flavored && { flavor: entry.flavor }) });
    } catch {
      // One Midi can't build either is no roll.
    }
  }
  return expected;
}

/* -------------------------------------------- */
/*  Steps and asks                              */
/* -------------------------------------------- */

/**
 * A step of later rolls of a run, asked once, as its first roll is thrown; or, `silent`, where
 * whose it is can't be told for sure, asked of no one, its dice and any thrown again Foundry's.
 */
class Step {
  /**
   * @param {Run} run
   * @param {Roll[]} rolls
   * @param {{purpose: string, label: string, critical: boolean, silent?: boolean}} details
   */
  constructor(run, rolls, { purpose, label, critical, silent=false }) {
    this.run = run;
    this.rolls = rolls;
    this.purpose = purpose;
    this.label = label;
    this.critical = critical;
    this.silent = silent === true;
    /** @type {Promise<Map<Roll, Map<DiceTerm, number[]>>|null>|null} */
    this.asking = null;
  }

  /**
   * The values given for each of a roll's dice terms, once its player has answered, or none, for
   * Foundry's dice: the step is asked as its first roll is about to be thrown.
   * @param {Roll} roll
   * @returns {Promise<Map<DiceTerm, number[]>|null>}
   */
  values(roll) {
    this.asking ??= this.#ask();
    return this.asking.then(answer => answer?.get(roll) ?? null);
  }

  /**
   * Ask for the step's dice, where they can be asked now.
   * @returns {Promise<Map<Roll, Map<DiceTerm, number[]>>|null>}
   */
  async #ask() {
    if ( this.silent ) return null;
    const listing = listRolls(this.rolls);
    if ( !listing.length || !asksNow(this.run) ) return null;
    const ask = openAsk(this.run, { purpose: this.purpose, label: this.label, critical: this.critical, listing });
    if ( !ask ) return null;
    const dice = await ask.settled;
    return answerMap(listing, dice);
  }
}

/**
 * The rolls of a step an ask lists, up to 10, each with its own dice terms of fixed count, up to 10:
 * a die a player rolls, 1 to 40 of them. One with none, or whose dice are maximized or minimized,
 * isn't listed.
 * @param {Roll[]} rolls
 * @returns {{roll: Roll, terms: {term: DiceTerm, faces: number, number: number}[]}[]}
 */
function listRolls(rolls) {
  const { DiceTerm } = foundry.dice.terms;
  const listing = [];
  for ( const roll of rolls ) {
    if ( listing.length >= MOST.rolls ) break;
    if ( (roll?.options?.minimize === true) || (roll?.options?.maximize === true) ) continue;
    const terms = (roll?.terms ?? [])
      .filter(term => (term instanceof DiceTerm) && Number.isInteger(term.number) && (term.number >= 1)
        && (term.number <= MOST.dice) && DIE_FACES.has(term.faces))
      .slice(0, MOST.terms)
      .map(term => ({ term, faces: term.faces, number: term.number }));
    if ( terms.length ) listing.push({ roll, terms });
  }
  return listing;
}

/**
 * An answer's entries as the values of each listed roll's terms.
 * @param {{roll: Roll, terms: object[]}[]} listing
 * @param {{roll: number, term: number, results: number[]}[]|null} dice
 * @returns {Map<Roll, Map<DiceTerm, number[]>>|null}
 */
function answerMap(listing, dice) {
  if ( !Array.isArray(dice) || !dice.length ) return null;
  const answer = new Map();
  for ( const { roll, term, results } of dice ) {
    const listed = listing[roll];
    const entry = listed?.terms[term];
    if ( !entry ) continue;
    if ( !answer.has(listed.roll) ) answer.set(listed.roll, new Map());
    answer.get(listed.roll).set(entry.term, results);
  }
  return answer;
}

/**
 * Can a run's player be asked now: on the bridge, by a campaign whose app reads dice asks and whose
 * players type in their dice, while the character, or a companion's character, is open there?
 * @param {Run} run
 * @returns {boolean}
 */
function asksNow(run) {
  if ( run.test ) return true;
  if ( !active() || run.closed || !canSend() ) return false;
  const campaign = getCampaigns().find(({ id }) => id === run.campaignId);
  return Boolean(campaign) && campaignAsks(campaign) && isOpen(run.campaignId, run.of ?? run.actorId);
}

/**
 * Does a campaign ask its players for their later dice: its rolls made here, its players typing in
 * their dice, and its app reading dice asks?
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function campaignAsks(campaign) {
  return manualDiceOn(campaign) && readers.has(campaign.id);
}

/**
 * Open an ask: tell the run's campaign, show the Gamemaster, and wait for the answer until the wait
 * is over. The self-test's is answered at once, by itself, telling no one.
 * @param {Run} run
 * @param {{purpose: string, again?: string, label: string, critical: boolean, listing: object[]}} details
 * @returns {Ask|null}
 */
function openAsk(run, { purpose, again: why=null, label, critical, listing }) {
  const campaign = run.test ? null : getCampaigns().find(({ id }) => id === run.campaignId);
  if ( !run.test && !campaign ) return null;
  prune();
  const now = Date.now();
  let settle;
  const ask = {
    id: foundry.utils.randomID(16), run, purpose, again: why, label, critical, listing,
    askedAt: now, expiresAt: now + askWait(), state: "waiting", reason: null, thrown: new Set(),
    settled: new Promise(resolve => { settle = resolve; }), settle, timer: null, dialog: null, ticker: null, closedAt: null
  };
  if ( run.test ) {
    ask.state = "closed";
    ask.settle(testAnswers?.shift() ?? null);
    return ask;
  }
  asks.set(ask.id, ask);
  for ( const { roll } of listing ) {
    if ( roll ) asksOfRoll.set(roll, [...(asksOfRoll.get(roll) ?? []), ask]);
  }
  const time = held.get(run.commandId) ?? { held: 0, open: 0, since: now, at: now };
  if ( !time.open ) time.since = now;
  time.open++;
  time.at = now;
  held.set(run.commandId, time);
  ask.timer = setTimeout(() => closeAsk(ask, "expired"), Math.max(ask.expiresAt - now, 0));
  send(EVENTS.DICE_ASKED, { ask: summarize(ask) }, campaign);
  showWaiting(ask);
  scheduleCheck();
  return ask;
}

/**
 * An ask as its campaign is told of it.
 * @param {Ask} ask
 * @returns {object}
 */
function summarize(ask) {
  const DamageRoll = CONFIG.Dice?.DamageRoll;
  return {
    id: ask.id,
    actorId: ask.run.actorId,
    ...(ask.run.of && { of: ask.run.of }),
    command: ask.run.commandId,
    label: ask.label,
    purpose: ask.purpose,
    ...(ask.again && { again: ask.again }),
    critical: ask.critical === true,
    rolls: ask.listing.map(({ roll, terms }) => {
      const type = (DamageRoll && (roll instanceof DamageRoll) && (typeof roll.options?.type === "string")) ? roll.options.type : null;
      const flavor = (typeof roll?.options?.flavor === "string") ? roll.options.flavor.slice(0, LONGEST.flavor) : "";
      return {
        formula: String(roll?.formula ?? terms[0]?.term?.expression ?? "").slice(0, LONGEST.formula),
        ...(type && { type }),
        ...(flavor && { flavor }),
        terms: terms.map(({ faces, number }) => ({ faces, number }))
      };
    }),
    askedAt: new Date(ask.askedAt).toISOString(),
    expiresAt: new Date(ask.expiresAt).toISOString()
  };
}

/**
 * Close an ask, once, and tell its campaign why, while its app reads asks: its roll takes the
 * answer's dice, or none, for Foundry's computer dice. An app that stopped reading them closes it
 * itself, as its next hello lists none.
 * @param {Ask} ask
 * @param {"answered"|"skipped"|"rolled"|"expired"|"gone"} reason
 * @param {object[]|null} [dice]   The answer's entries.
 * @returns {boolean}               Was it waiting?
 */
function closeAsk(ask, reason, dice=null) {
  if ( ask.state !== "waiting" ) return false;
  const now = Date.now();
  Object.assign(ask, { state: "closed", reason, closedAt: now });
  clearTimeout(ask.timer);
  hideWaiting(ask);
  const time = held.get(ask.run.commandId);
  if ( time ) {
    time.open = Math.max(time.open - 1, 0);
    if ( !time.open ) time.held += now - time.since;
    time.at = now;
  }
  const campaign = getCampaigns().find(({ id }) => id === ask.run.campaignId);
  if ( campaign && canSend() && readers.has(campaign.id) ) send(EVENTS.DICE_CLOSED, { id: ask.id, reason }, campaign);
  ask.settle(dice);
  return true;
}

/**
 * How long a command's asks have waited, in milliseconds, and whether one waits now: what its
 * watchdog doesn't count (commands.mjs).
 * @param {string} commandId
 * @returns {{held: number, waiting: boolean}}
 */
export function heldFor(commandId) {
  const time = held.get(commandId);
  return { held: time?.held ?? 0, waiting: (time?.open ?? 0) > 0 };
}

/**
 * Forget asks closed long ago, and what's kept of their commands.
 * @returns {void}
 */
function prune() {
  const before = Date.now() - KEPT;
  for ( const [id, ask] of asks ) {
    if ( (ask.closedAt !== null) && (ask.closedAt < before) ) asks.delete(id);
  }
  for ( const [id, time] of held ) {
    if ( !time.open && (time.at < before) ) held.delete(id);
  }
}

/**
 * A roll was thrown: the asks listing it may give their answers' results.
 * @param {Roll} roll
 * @returns {void}
 */
function thrown(roll) {
  for ( const ask of asksOfRoll.get(roll) ?? [] ) ask.thrown.add(roll);
  for ( const bracket of brackets ) {
    if ( bracket.busy === roll ) bracket.busy = null;
  }
}

/* -------------------------------------------- */
/*  A die thrown again                          */
/* -------------------------------------------- */

/**
 * A die of a typed roll's thrown again, an explosion or a reroll, for dice-plan.mjs: asked of its
 * player, one die, where they can be asked now. Its value, or none for Foundry's; nothing where it
 * isn't asked at all. dice-plan.mjs asks only where the throw it follows took its player's value.
 * @param {DiceTerm} term
 * @param {"explode"|"reroll"} why
 * @param {object|null} owner   Its roll's plan, or the values given for its term as a later roll's.
 * @returns {Promise<number|undefined>|null}
 */
function again(term, why, owner) {
  if ( !active() || !owner || !DIE_FACES.has(term?.faces) ) return null;
  const step = (owner.later instanceof Step) ? owner.later : null;
  if ( step?.silent ) return null;
  const command = owner.command;
  const run = step?.run
    ?? (((command?.typed === true) && ((command.by === undefined) || (command.by === null))) ? runs.get(command.id) : null);
  if ( !run || run.closed || !asksNow(run) ) return null;
  const roll = term._root ?? null;
  const flavor = (typeof roll?.options?.flavor === "string") ? roll.options.flavor : "";
  const label = (step?.label || run.itemName || flavor || String(roll?.formula ?? term.expression ?? "")).slice(0, LONGEST.label);
  const ask = openAsk(run, {
    purpose: "again", again: why, label, critical: step?.critical ?? false,
    listing: [{ roll, terms: [{ term, faces: term.faces, number: 1 }] }]
  });
  if ( !ask ) return null;
  return ask.settled.then(dice => {
    const value = Array.isArray(dice) ? dice[0]?.results?.[0] : undefined;
    return (Number.isInteger(value) && (value >= 1) && (value <= term.faces)) ? value : undefined;
  });
}

/* -------------------------------------------- */
/*  Looking at the waiting asks                 */
/* -------------------------------------------- */

/**
 * Close every waiting ask that's no longer to wait: past its time, its run over, its workflow
 * aborted (`"gone"`), its campaign no longer asking, its character no longer open, or this client
 * no longer the bridge (`"expired"`). After every fetch, as the app's list of open characters comes,
 * and every 5 seconds while any waits.
 * @returns {void}
 */
export function checkAsks() {
  sweepRuns();
  for ( const ask of Array.from(asks.values()) ) {
    if ( ask.state === "waiting" ) checkAsk(ask);
  }
  scheduleCheck();
}

/**
 * Close a waiting ask that's no longer to wait.
 * @param {Ask} ask
 * @returns {void}
 */
function checkAsk(ask) {
  const { run } = ask;
  if ( run.closed ) return void closeAsk(ask, "gone");
  if ( Array.from(run.workflows).some(workflow => workflow.aborted === true) ) return void closeAsk(ask, "gone");
  if ( Date.now() >= ask.expiresAt ) return void closeAsk(ask, "expired");
  if ( !asksNow(run) ) closeAsk(ask, "expired");
}

/**
 * Look at the waiting asks again in a while, while any waits.
 * @returns {void}
 */
function scheduleCheck() {
  if ( checking !== null ) return;
  if ( !Array.from(asks.values()).some(ask => ask.state === "waiting") ) return;
  checking = setTimeout(() => {
    checking = null;
    checkAsks();
  }, CHECK_EVERY);
}

/* -------------------------------------------- */
/*  The Gamemaster's window                     */
/* -------------------------------------------- */

/**
 * Show the bridge Gamemaster that a roll waits on a player's dice: a small window, not in their way,
 * saying whose player, what and how long is left, with Roll it now. One that can't be drawn changes
 * nothing of the ask.
 * @param {Ask} ask
 * @returns {void}
 */
function showWaiting(ask) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if ( typeof DialogV2 !== "function" ) return;
  try {
    const { i18n } = game;
    const name = game.actors?.get?.(ask.run.of ?? ask.run.actorId)?.name ?? "";
    const text = i18n.format("SENDINGSTONE.DiceAsk.Waiting", {
      name: escapeText(name), label: escapeText(ask.label), dice: escapeText(diceText(ask))
    });
    const content = `<p class="sending-stone-dice-ask">${text}</p>`
      + `<p class="sending-stone-dice-ask-left">${escapeText(leftText(ask))}</p>`;
    const dialog = new DialogV2({
      window: { title: i18n.localize("SENDINGSTONE.DiceAsk.Title") },
      content,
      modal: false,
      rejectClose: false,
      buttons: [{
        action: "roll", label: i18n.localize("SENDINGSTONE.DiceAsk.RollNow"), icon: "fa-solid fa-dice", default: true,
        callback: () => rollNow(ask.id)
      }]
    });
    ask.dialog = dialog;
    void Promise.resolve(dialog.render({ force: true })).catch(() => null);
    ask.ticker = setInterval(() => {
      const left = dialog.element?.querySelector?.(".sending-stone-dice-ask-left");
      if ( left ) left.textContent = leftText(ask);
    }, 1_000);
  } catch (err) {
    warnOnce("window", "Could not show the wait for a player's dice: Roll it now isn't offered.", err);
  }
}

/**
 * Close the Gamemaster's window of an ask, where it's open.
 * @param {Ask} ask
 * @returns {void}
 */
function hideWaiting(ask) {
  clearInterval(ask.ticker);
  ask.ticker = null;
  const { dialog } = ask;
  ask.dialog = null;
  if ( !dialog ) return;
  try {
    void Promise.resolve(dialog.close?.()).catch(() => null);
  } catch {
    // Closed already.
  }
}

/**
 * The Gamemaster chose Roll it now: the ask closes, and Foundry's computer dice roll it.
 * @param {string} id
 * @returns {boolean}   Was it waiting?
 */
export function rollNow(id) {
  const ask = asks.get(id);
  return Boolean(ask) && closeAsk(ask, "rolled");
}

/**
 * The dice an ask waits for, as the Gamemaster reads them: each roll's, such as "2d6 Cold".
 * @param {Ask} ask
 * @returns {string}
 */
function diceText(ask) {
  const types = { ...(CONFIG.DND5E?.damageTypes ?? {}), ...(CONFIG.DND5E?.healingTypes ?? {}) };
  return summarize(ask).rolls.map(({ type, terms }) => {
    const dice = terms.map(({ faces, number }) => `${number}d${faces}`).join(" + ");
    const label = type ? (types[type]?.label ?? type) : "";
    return label ? `${dice} ${game.i18n.localize(label)}` : dice;
  }).join(", ");
}

/**
 * How long an ask has left, as minutes and seconds.
 * @param {Ask} ask
 * @returns {string}
 */
function leftText(ask) {
  const seconds = Math.max(Math.ceil((ask.expiresAt - Date.now()) / 1000), 0);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return game.i18n.format("SENDINGSTONE.DiceAsk.Left", { time });
}

/**
 * Text as HTML, escaped, as Foundry escapes it: names and labels are what players and Gamemasters
 * write.
 * @param {string} text
 * @returns {string}
 */
function escapeText(text) {
  return foundry.utils.escapeHTML(String(text ?? ""));
}

/* -------------------------------------------- */
/*  Answering                                   */
/* -------------------------------------------- */

/**
 * Is this command an answer to a dice ask? The roll it answers is waiting on it: it's made at once.
 * @param {object} command
 * @returns {boolean}
 */
export function answersDiceAsk(command) {
  return command?.kind === "dice";
}

/**
 * Take a player's answer to a dice ask: the dice it gives go to the terms named, the rest are
 * Foundry's, and once the rolls it answers are thrown, or ten seconds on, it's done. Refused, with
 * nothing taken, as PROTOCOL.md's "Dice the game rolls later" lists.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runDiceAnswer(command, campaign) {
  if ( (command.by !== undefined) && (command.by !== null) ) return failedResult(command, "invalid", "by");
  if ( !answerShaped(command) ) return failedResult(command, "invalid", "diceAsk");
  const ask = asks.get(command.diceAsk);
  if ( !ask ) return failedResult(command, "diceAsk", "gone");
  const of = isId(command.of) ? command.of : null;
  if ( (ask.run.campaignId !== campaign.id) || (ask.run.actorId !== String(command.actorId)) || (ask.run.of !== of) ) {
    return failedResult(command, "diceAsk", "character");
  }
  if ( ask.state === "waiting" ) checkAsk(ask);
  if ( ask.state !== "waiting" ) return failedResult(command, "diceAsk", closedError(ask.reason));
  if ( !answerFits(ask, command.dice) ) return failedResult(command, "invalid", "diceAsk");
  closeAsk(ask, command.dice.length ? "answered" : "skipped", command.dice);
  await thrownOrLater(ask);
  const rolls = ask.listing.map(({ roll }) => roll).filter(roll => roll && ask.thrown.has(roll));
  return { id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: rolls.map(summarizeRoll) };
}

/**
 * Why a closed ask refuses an answer.
 * @param {string|null} reason   How it closed.
 * @returns {"answered"|"expired"|"gone"}
 */
function closedError(reason) {
  if ( reason === "expired" ) return "expired";
  if ( reason === "gone" ) return "gone";
  return "answered";
}

/**
 * Is an answer shaped as one: an ask's id, its dice a list of `{roll, term, results}`, at most 100,
 * typed, thrown with no mode, choice or extras, and no dice for effects nor rerolls?
 * @param {object} command
 * @returns {boolean}
 */
function answerShaped(command) {
  if ( (typeof command.diceAsk !== "string") || !ID.test(command.diceAsk) ) return false;
  if ( (command.typed !== true) || (command.mode !== 0) || (command.explicit !== false) ) return false;
  if ( !Array.isArray(command.extras) || command.extras.length ) return false;
  for ( const key of ["effectDice", "rerolls"] ) {
    if ( (command[key] !== undefined) && (command[key] !== null) ) return false;
  }
  const { dice } = command;
  if ( !Array.isArray(dice) || (dice.length > MOST.entries) ) return false;
  return dice.every(entry => entry && (typeof entry === "object") && Number.isInteger(entry.roll)
    && Number.isInteger(entry.term) && Array.isArray(entry.results)
    && entry.results.every(value => Number.isInteger(value)));
}

/**
 * Does an answer fit its ask: each entry one of its rolls' terms, once, with exactly that term's
 * number of values, each one of its die's faces?
 * @param {Ask} ask
 * @param {{roll: number, term: number, results: number[]}[]} dice
 * @returns {boolean}
 */
function answerFits(ask, dice) {
  const seen = new Set();
  for ( const { roll, term, results } of dice ) {
    const entry = ask.listing[roll]?.terms[term];
    const key = `${roll}|${term}`;
    if ( !entry || seen.has(key) || (results.length !== entry.number) ) return false;
    if ( !results.every(value => (value >= 1) && (value <= entry.faces)) ) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Wait until every roll an ask lists is thrown, or ten seconds at most.
 * @param {Ask} ask
 * @returns {Promise<void>}
 */
async function thrownOrLater(ask) {
  const until = Date.now() + RESULT_WAIT;
  const done = () => ask.listing.every(({ roll }) => !roll || ask.thrown.has(roll));
  while ( !done() && (Date.now() < until) ) await new Promise(resolve => setTimeout(resolve, 50));
}

/* -------------------------------------------- */
/*  Telling campaigns                           */
/* -------------------------------------------- */

/**
 * The asks waiting in a campaign, for its hello, in the order asked: none while its app doesn't read
 * them.
 * @param {Campaign} campaign
 * @returns {object[]}
 */
export function openDiceAsks(campaign) {
  if ( !readers.has(campaign.id) ) return [];
  return Array.from(asks.values())
    .filter(ask => (ask.state === "waiting") && (ask.run.campaignId === campaign.id))
    .map(summarize);
}

/* -------------------------------------------- */
/*  Self-test                                   */
/* -------------------------------------------- */

/**
 * Check, at start-up, what asking for later dice relies on, printing nothing, its outcome in
 * `laterDiceStatus`: that a later roll waits for its answer, which reaches the dice of the terms
 * it names, among the roll's own, while a term left out is Foundry's; that a roll outside any run,
 * of another actor, or in another Midi workflow, isn't one; that a dice cost dnd5e rolls with a
 * run's spending takes its answer, while one of the module's own check, or of no run, isn't asked,
 * through dnd5e's own `resolveCost`, where it's wrapped; that a bonus damage formula keeps what a
 * bracket tells it apart by, as Foundry keeps a roll's options; and that a die thrown again, an
 * explosion and a reroll, of a typed roll's own or of a later roll's, waits for the value given, as
 * Foundry awaits a die's `_roll`.
 * @returns {Promise<void>}
 */
async function laterSelfTest() {
  if ( !installed ) return;
  const BasicRoll = CONFIG.Dice?.BasicRoll ?? foundry.dice.Roll;
  const id = `selftest${foundry.utils.randomID(8)}`;
  const actor = { uuid: `Actor.${id}`, type: "character" };
  const item = { id: `item${id}`, name: "Self-test", actor };
  const run = {
    command: { id, typed: true, kind: "formula" }, commandId: id, campaignId: id, actorId: id, of: null,
    actors: new Set([actor.uuid]), itemId: item.id, itemName: item.name, window: true, running: true,
    workflows: new Set(), openedAt: Date.now(), closed: false, test: true
  };
  runs.set(id, run);
  testAnswers = [];
  // Its own rolls are asked as any would be, while it runs.
  laterDiceStatus.ready = true;
  try {
    // A later roll's answer reaches its own term; the term left out is Foundry's.
    const roll = new BasicRoll("1d8 + 2d6", {}, {});
    const step = new Step(run, [roll], { purpose: "other", label: item.name, critical: false });
    steps.set(roll, step);
    testAnswers.push([{ roll: 0, term: 1, results: [3, 5] }]);
    await roll.evaluate();
    const twoD6 = roll.dice.find(die => die.faces === 6)?.results.map(({ result }) => result) ?? [];
    check(JSON.stringify(twoD6) === "[3,5]", `a later roll's 2d6 answered 3 and 5 threw ${JSON.stringify(twoD6)}`);
    check(testAnswers.length === 0, "a later roll wasn't asked for its dice");

    // Rolls of no run, of another actor or in another workflow aren't a run's.
    const other = { item: { id: item.id, name: item.name }, actor: { uuid: "Actor.someoneElse" } };
    check(runOfStep([new BasicRoll("1d6")], {}) === null, "a roll of no run was a run's");
    check(runOfStep([new BasicRoll("1d6")], { subject: other }) === null, "another actor's roll was a run's");
    check(runOfStep([new BasicRoll("1d6")], { subject: { item, actor }, workflow: { workflowOptions: {} } }) === null,
      "a roll in another workflow was a run's");
    check(runOfStep([new BasicRoll("1d6")], { subject: { item, actor } }) === run, "a roll of the run's item wasn't its");

    // A dice cost dnd5e rolls with a run's spending takes the answer; one it rolls for the module's
    // own check, or with no run's spending, isn't asked; one wanted unevaluated, as for a label, is.
    await costSelfTest(run, item);

    // A bonus damage formula as Midi-QOL builds it keeps what tells it apart; one of another flavor,
    // or a plain roll of the same formula, isn't one.
    if ( CONFIG.Dice?.DamageRoll ) {
      const bonus = new CONFIG.Dice.DamageRoll("1d6", {}, { type: "fire", flavor: "Self-test" });
      check(fitsBracket("bonus", { formula: "1d6", flavor: "Self-test" }, bonus), "a bonus damage built as Midi builds it wasn't one");
      check(!fitsBracket("bonus", { formula: "1d6" }, bonus), "a bonus damage of another flavor was one");
    }

    // A die thrown again waits for the value given: an explosion, and a reroll of a 1.
    for ( const [formula, dice, answers, expected] of [
      ["1d6x", [{ faces: 6, results: [6] }], [6, 6, 2], "[6,6,6,2]"],
      ["1d20r1", [{ faces: 20, results: [1] }], [15], "[1,15]"]
    ] ) {
      testAnswers.push(...answers.map(value => [{ roll: 0, term: 0, results: [value] }]));
      const thrownAgain = new BasicRoll(formula, {}, { [ROLL_TAG]: id });
      await withPlan({ id, typed: true, kind: "formula", dice }, () => thrownAgain.evaluate());
      const results = JSON.stringify(thrownAgain.dice[0]?.results.map(({ result }) => result) ?? []);
      check(results === expected, `${formula}, its dice given, threw ${results}, not ${expected}`);
      check(testAnswers.length === 0, `${formula}'s die thrown again wasn't asked for`);
    }

    // So does a later roll's: its explosion asked as its step's.
    const laterAgain = new BasicRoll("1d4x", {}, {});
    steps.set(laterAgain, new Step(run, [laterAgain], { purpose: "other", label: item.name, critical: false }));
    testAnswers.push([{ roll: 0, term: 0, results: [4] }], [{ roll: 0, term: 0, results: [2] }]);
    await laterAgain.evaluate();
    const exploded = JSON.stringify(laterAgain.dice[0]?.results.map(({ result }) => result) ?? []);
    check(exploded === "[4,2]", `a later roll's 1d4x answered 4, then 2, threw ${exploded}`);
    check(testAnswers.length === 0, "a later roll's die thrown again wasn't asked for");
    Object.assign(laterDiceStatus, { ready: true, reason: null, error: null });
  } catch (err) {
    Object.assign(laterDiceStatus, { ready: false, reason: "self-test", error: err instanceof Error ? err.message : String(err) });
  } finally {
    testAnswers = null;
    runs.delete(id);
    run.closed = true;
  }
}

/**
 * The self-test's dice costs, through dnd5e's own `resolveCost`, where dice-plan.mjs wraps it: on a
 * consumption target of a cost of `1d4`, a stand-in for an activity's own, as dnd5e resolves it.
 * Nothing where it isn't wrapped, as with a dnd5e that has none: then no dice cost is asked.
 * @param {Run} run      The self-test's run.
 * @param {object} item  Its item.
 * @returns {Promise<void>}
 */
async function costSelfTest(run, item) {
  const Target = costTargetClass();
  if ( !Target ) return;
  const target = Object.create(Target.prototype);
  Object.defineProperties(target, {
    value: { value: "1d4" },
    scaling: { value: { mode: "", formula: "" } },
    activity: { value: { item, actor: item.actor, getRollData: () => ({}) } }
  });
  const key = `${run.commandId}.selftest`;
  spending.set(key, { run, label: item.name });
  try {
    testAnswers.push([{ roll: 0, term: 0, results: [3] }]);
    const cost = await target.resolveCost({ config: { [COST_SPENDING]: key } });
    check(cost?.total === 3, `a dice cost of 1d4 answered 3 cost ${cost?.total}`);
    check(testAnswers.length === 0, "a dice cost wasn't asked for its die");
    testAnswers.push([{ roll: 0, term: 0, results: [3] }]);
    const thrownAway = await target.resolveCost({ config: { [COST_CHECK]: true, [COST_SPENDING]: key } });
    // One of no run's spending is dnd5e's own: thrown here, as nothing else is, without asking anyone.
    const noRun = await target.resolveCost({ config: {}, evaluate: false })?.evaluate({ allowInteractive: false });
    check([thrownAway, noRun].every(roll => roll?._evaluated === true), "a dice cost not asked wasn't thrown");
    check(testAnswers.length === 1, "the module's own check of a dice cost, or one of no run, was asked for its die");
    const unthrown = target.resolveCost({ config: { [COST_SPENDING]: key }, evaluate: false });
    check((unthrown instanceof foundry.dice.Roll) && !unthrown._evaluated, "a dice cost wanted unevaluated was thrown");
    check(testAnswers.length === 1, "a dice cost wanted unevaluated was asked for its die");
  } finally {
    testAnswers.splice(0);
    spending.delete(key);
  }
}

/**
 * @param {boolean} condition
 * @param {string} failure     What went wrong, when it isn't so.
 */
function check(condition, failure) {
  if ( !condition ) throw new Error(failure);
}
