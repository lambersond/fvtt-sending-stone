import { EVENTS, MODULE_ID, SETTINGS } from "./constants.mjs";
import { canSend } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { wrap } from "./dice-plan.mjs";
import {
  concentratingOn, ownConcentrationAbility, prompting, PROMPT_LIFETIME, showsChallenge
} from "./prompts.mjs";
import { send } from "./transport.mjs";

/**
 * Asking players in the Sending Stone app for the saves Midi-QOL asks of their characters (module
 * 0.27.0): a save, check or skill check a Midi workflow on this client asks of one of a campaign's
 * characters, as an NPC's spell, a player's use from the app, a concentration check in Midi's
 * "item" mode or an OverTime effect's turn save; and Midi's own concentration card in its "chat"
 * mode, posted here. Only while the character is open in the app: otherwise Midi goes its own way
 * at once, as it's set up.
 *
 * Midi asks for each target's save through its workflow's `queueTargetSaveRoll`, which returns
 * the roll it waits for, and the request card it deletes once every target has rolled. The module
 * wraps it on the bridge: a save the app is asked for is answered with the player's dice, rolled as
 * Midi would roll it itself, Midi's own bonuses, advantage and DC with it; and a save the app
 * doesn't answer within a minute is left to Midi's own way after all. Where Midi asks the player in
 * Foundry too, in its "chat" request or a roll dialog on their screen, both are asked, and the
 * first answer is the one Midi takes.
 *
 * Midi decides how the save is rolled: the app is told its advantage, and isn't asked at all for a
 * save Midi fails or passes by itself. What Midi makes of the save, as the damage or the end of an
 * OverTime effect, is its workflow's, as ever.
 */

/**
 * How long a save waits on the app, in milliseconds, unless the hidden setting shortens it.
 * @type {number}
 */
export const MIDI_PROMPT_WAIT = 60_000;

/**
 * The shortest wait the hidden setting may set, in milliseconds.
 * @type {number}
 */
const SHORTEST_WAIT = 1_000;

/**
 * How long a fetch that listed a character as open counts, in milliseconds: one that failed, or
 * stopped, ends "open" within this.
 * @type {number}
 */
const OPEN_FRESH = 45_000;

/**
 * How often waiting saves are looked at, in milliseconds, besides after every fetch.
 * @type {number}
 */
const CHECK_EVERY = 5_000;

/**
 * How long an answer's result waits for Midi's verdict on it, in milliseconds.
 * @type {number}
 */
const VERDICT_WAIT = 10_000;

/**
 * The longest label sent, as the app takes it.
 * @type {number}
 */
const LONGEST_LABEL = 200;

/**
 * The ids an app may name a character or a card by.
 * @type {RegExp}
 */
const ID = /^[A-Za-z0-9]{1,64}$/;

/**
 * The keys dnd5e names abilities and skills by, as the app takes them.
 * @type {RegExp}
 */
const KEY = /^[A-Za-z][\w-]{0,31}$/;

/**
 * The ways Midi shows saves for which it shows players whether they saved.
 * @type {Set<string>}
 */
const OUTCOME_SHOWN = new Set(["all", "allNoRoll", "allShow"]);

/**
 * The roll mode of a player's save in Midi's standard roll, by its *Player Roll Saves*.
 * @type {Record<string, string>}
 */
const PLAYER_ROLL_MODES = {
  nonePublic: "public", noneDialogPublic: "public", none: "gm", noneDialogPrivate: "gm",
  noneDialogSelf: "self", noneDialogBlind: "blind"
};

/**
 * What of Midi-QOL this module found at ready: whether its workflows' saves can be asked in the
 * app (`workflow`), and its concentration cards too (`chat`); and its version.
 * @type {{workflow: boolean, chat: boolean, version: string|null}}
 */
export const midiPromptStatus = { workflow: false, chat: false, version: null };

/**
 * Has the workflow's queueTargetSaveRoll been wrapped?
 * @type {boolean}
 */
let installed = false;

/**
 * The campaigns whose app reads Midi prompts, as its latest answer to their hello or heartbeat
 * said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * The characters each campaign's app has open, as its latest fetch answered, and when.
 * @type {Map<string, {ids: Set<string>, at: number}>}
 */
const presence = new Map();

/**
 * Every Midi prompt asked, by its id, kept a while once closed so that a late answer is told why
 * it's refused.
 * @type {Map<string, MidiPrompt>}
 */
const registry = new Map();

/**
 * The calls already asked, so that one is never asked twice.
 * @type {WeakSet<object>}
 */
const handled = new WeakSet();

/**
 * What has been warned of, once each.
 * @type {Set<string>}
 */
const warned = new Set();

/**
 * The next look at the waiting saves.
 * @type {number|null}
 */
let checking = null;

/**
 * A save asked of a character for Midi-QOL, from the moment the app is told of it.
 * @typedef {object} MidiPrompt
 * @property {string} id                       Its key and the character's, joined by "-".
 * @property {string} key                      Random: never a card's id, so nothing for a card
 *                                             closes it.
 * @property {string} actorId
 * @property {Set<string>} campaignIds         The campaigns told of it.
 * @property {Actor} actor                     Whose save it is: the target token's, or the
 *                                             concentration card's speaker.
 * @property {object} [workflow]               Midi's workflow, and what it asked with: the
 *                                             target's token among it.
 * @property {object} [token]
 * @property {object} [options]
 * @property {Function} [original]             Midi's own request, as it was asked.
 * @property {ChatMessage} [card]              Or Midi's concentration card.
 * @property {"held"|"parallel"} mode          Held: Midi's own way waits on the app. Parallel:
 *                                             Midi asks in Foundry at once, too.
 * @property {"chat"|"dialog"|null} branch     Where Midi asks in Foundry, for a parallel save.
 * @property {"waiting"|"answering"|"answered"|"rolled"|"released"} state
 * @property {string} type
 * @property {string} source
 * @property {string} rollType                 Midi's: "save", "check" or "skill".
 * @property {string[]} abilities
 * @property {string[]} skills
 * @property {Record<string, "adv"|"dis">} advantage
 * @property {number|null} dc                  As the app is told it.
 * @property {number|undefined} rollTarget     The DC the answer is rolled against.
 * @property {string|null} label
 * @property {string} messageId
 * @property {number} openedAt
 * @property {number} expiresAt
 * @property {number|null} midiDeadline        When Midi's own wait for a player asked in Foundry
 *                                             too is up, where it has one.
 * @property {User|null} asked                 The player whose roll dialog Midi opened.
 */

/* -------------------------------------------- */
/*  Setting up                                  */
/* -------------------------------------------- */

/**
 * Register the hooks that read Midi's verdicts and its concentration cards. Every client has
 * them; only the bridge acts on them.
 * @returns {void}
 */
export function registerMidiPromptHooks() {
  Hooks.on("midi-qol.postCheckSaves", noteVerdicts);
  Hooks.on("preCreateChatMessage", holdConcentrationCard);
  Hooks.on("createChatMessage", askConcentrationCard);
  Hooks.on("createChatMessage", closeAnsweredDialog);
}

/**
 * Find what of Midi-QOL its prompts need, and wrap its workflows' save requests, on a Gamemaster's
 * client, once. Every Gamemaster's client wraps them, the bridge may move to any; each acts only
 * while it's the bridge. Where Midi lacks what's needed, its saves are left to it as before, and
 * the Gamemaster is warned once, in the console.
 * @returns {void}
 */
export function installMidiPrompts() {
  if ( installed || (game.modules.get("midi-qol")?.active !== true) ) return;
  installed = true;
  const Midi = globalThis.MidiQOL;
  midiPromptStatus.version = game.modules.get("midi-qol")?.version ?? null;
  midiPromptStatus.workflow = (typeof Midi?.Workflow?.prototype?.queueTargetSaveRoll === "function")
    && (typeof Midi.configSettings === "function");
  midiPromptStatus.chat = midiPromptStatus.workflow && (typeof Midi.socket === "function")
    && (typeof Midi.playerForActor === "function");
  if ( !midiPromptStatus.workflow ) {
    console.warn(`${MODULE_ID} | This Midi-QOL (${midiPromptStatus.version}) lacks what asking its saves in the app`
      + " needs: Midi rolls them as before.");
    return;
  }
  if ( !midiPromptStatus.chat ) {
    console.warn(`${MODULE_ID} | This Midi-QOL (${midiPromptStatus.version}) lacks what asking its concentration`
      + " cards in the app needs: Midi rolls them as before.");
  }
  const target = "MidiQOL.Workflow.prototype.queueTargetSaveRoll";
  if ( game.modules.get("lib-wrapper")?.active && globalThis.libWrapper ) {
    globalThis.libWrapper.register(MODULE_ID, target, queueTargetSaveRoll, "MIXED");
  }
  else wrap(Midi.Workflow.prototype, "queueTargetSaveRoll", queueTargetSaveRoll);
}

/**
 * Can Midi's saves be asked in a campaign's app: it asks its players for their saves, and this
 * Midi-QOL has what that needs? As the campaign's hello says, `midiPrompts`.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function midiPromptsOffered(campaign) {
  return prompting(campaign) && midiPromptStatus.workflow;
}

/**
 * Note whether a campaign's app reads Midi prompts, from what it said in answer to its hello or
 * heartbeat: `features.midiPrompts`, the format it reads, 1 or later. An app that says nothing of
 * it, as one before them, is asked nothing.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {void}
 */
export function noteMidiReader(campaignId, features) {
  const format = features?.midiPrompts;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
}

/**
 * Note the characters a campaign's app has open, from a fetch's answer, `open`: those whose
 * player's page asked for the table lately. An answer without it, as an older app's, has none
 * open. Waiting saves are looked at again at once, so that one whose character closed goes Midi's
 * way.
 * @param {string} campaignId
 * @param {unknown} open
 * @returns {void}
 */
export function noteOpen(campaignId, open) {
  const ids = Array.isArray(open) ? open.filter(id => (typeof id === "string") && ID.test(id)) : [];
  presence.set(campaignId, { ids: new Set(ids), at: Date.now() });
  checkWaiting();
}

/**
 * Is a character open in a campaign's app: listed by a fetch answered within the last 45 seconds?
 * @param {string} campaignId
 * @param {string} actorId
 * @returns {boolean}
 */
function isOpen(campaignId, actorId) {
  const seen = presence.get(campaignId);
  return Boolean(seen) && ((Date.now() - seen.at) <= OPEN_FRESH) && seen.ids.has(actorId);
}

/**
 * The campaigns a character's Midi save would be asked in: each that has it, asks its players for
 * their saves, and whose app reads Midi prompts.
 * @param {string} actorId
 * @returns {Campaign[]}
 */
function askers(actorId) {
  return getCampaigns().filter(campaign => campaign.characters.has(actorId) && prompting(campaign)
    && readers.has(campaign.id));
}

/**
 * How long a save waits on the app: a minute, or less where a test set it so.
 * @returns {number}
 */
function promptWait() {
  let wait;
  try {
    wait = Number(game.settings.get(MODULE_ID, SETTINGS.MIDI_PROMPT_WAIT));
  } catch {
    wait = MIDI_PROMPT_WAIT;
  }
  if ( !Number.isFinite(wait) ) wait = MIDI_PROMPT_WAIT;
  return Math.min(Math.max(wait, SHORTEST_WAIT), MIDI_PROMPT_WAIT);
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
/*  Midi's request for a target's save          */
/* -------------------------------------------- */

/**
 * In place of Midi's queueTargetSaveRoll, on a Gamemaster's client: for a save to ask in the app,
 * the roll Midi waits for and the card it deletes after, at once, as Midi's own are, so that every
 * target is asked together; anything else, Midi's own. Only the bridge asks. A failure deciding
 * leaves the save to Midi.
 * @this {object}                The workflow.
 * @param {Function} wrapped     Midi's own.
 * @param {object} options       What Midi asks with.
 * @param {...any} rest
 * @returns {{promise: Promise, requestCard: Promise|undefined}}
 */
function queueTargetSaveRoll(wrapped, options, ...rest) {
  if ( !canSend() || !options || (typeof options !== "object") || handled.has(options) ) {
    return wrapped(options, ...rest);
  }
  let asked;
  try {
    asked = describeAsk(this, options);
  } catch (err) {
    warnOnce("decide", "Could not tell whether to ask a Midi-QOL save in the app: Midi asks as it would.", err);
    asked = null;
  }
  if ( !asked ) return wrapped(options, ...rest);
  handled.add(options);
  return askSave(this, options, () => wrapped(options, ...rest), asked);
}

/**
 * What to ask the app of a save Midi requests, or null to leave it to Midi at once: a save, ability
 * check or skill check of a campaign's character, open in the app, that Midi doesn't fail or pass
 * by itself, and that no other module rolls for it.
 * @param {object} workflow
 * @param {object} options
 * @returns {object|null}
 */
function describeAsk(workflow, options) {
  const { target, saveDetails, rollInfo = {}, displayOptions = {}, playerInfo, moduleFlags = {} } = options;
  const actor = target?.actor;
  if ( !actor || !saveDetails || (typeof saveDetails !== "object") || !playerInfo ) {
    warnOnce("shape", "A Midi-QOL save request wasn't as expected: Midi asks as it would.");
    return null;
  }
  const Midi = globalThis.MidiQOL;
  // Midi's simulations ask no one.
  if ( displayOptions.simulate ) return null;
  if ( (typeof Midi?.DummyWorkflow === "function") && (workflow instanceof Midi.DummyWorkflow) ) return null;
  if ( !ID.test(String(actor.id)) ) return null;
  const campaigns = askers(actor.id);
  if ( !campaigns.some(campaign => isOpen(campaign.id, actor.id)) ) return null;

  // Monk's TokenBar, Flash Rolls and Epic Rolls get their requests once Midi has asked for every
  // target: theirs can't be held.
  const { player } = playerInfo;
  const toModule = player?.isGM ? (moduleFlags.gmMonksTB || moduleFlags.gmFlashTB || moduleFlags.gmRER)
    : (moduleFlags.playerMonksTB || moduleFlags.playerFlashTB || moduleFlags.playerEpicRolls);
  if ( toModule ) return null;
  if ( friendlyResult(workflow, saveDetails) ) return null;

  const rollType = saveDetails.rollType ?? rollInfo.type;
  if ( !["save", "check", "skill"].includes(rollType) ) return null;
  const skill = rollType === "skill";
  const listed = list => (Array.isArray(list) && list.length ? list : null);
  const named = skill ? (listed(saveDetails.rollSkills) ?? listed(rollInfo.skills) ?? [])
    : (listed(saveDetails.rollAbilities) ?? listed(rollInfo.abilities) ?? []);
  const known = skill ? CONFIG.DND5E?.skills : CONFIG.DND5E?.abilities;
  const choices = Array.from(new Set(named.filter(key => (typeof key === "string") && KEY.test(key)
    && Object.hasOwn(known ?? {}, key))));
  if ( !choices.length ) return null;

  // What Midi fails or passes by itself isn't asked: as Midi reads its trackers.
  const several = choices.length > 1;
  const modifiers = key => (several ? saveDetails.advantageByChoice?.[key]?.tracker : saveDetails.modifierTracker)
    ?.modifiers ?? {};
  if ( choices.some(key => modifiers(key).willSucceed) || choices.every(key => modifiers(key).willFail) ) return null;
  const offered = several ? choices.filter(key => !modifiers(key).willFail) : choices;

  const concentration = (rollType === "save") && (saveDetails.isConcentrationCheck === true);
  const single = { hasAdvantage: saveDetails.advantage, hasDisadvantage: saveDetails.disadvantage };
  // Midi works out a concentration check's advantage as a plain save's beforehand, and adds what
  // is for concentration alone as it rolls it.
  const advantage = advantageOf(offered, key => (several ? saveDetails.advantageByChoice?.[key] : single),
    concentration ? { actor } : null);

  // Parallel: Midi asks the player in Foundry at once too, in its chat request or a roll dialog
  // on their screen. Held: anything else, where Midi's own way waits on the app.
  const asksPlayer = Boolean(player) && !player.isGM && (player.active === true);
  let branch = null;
  if ( asksPlayer && (playerInfo.playerChat === true) ) branch = "chat";
  else if ( asksPlayer && (displayOptions.showRollDialog === true) ) branch = "dialog";
  if ( (branch === "chat") && ((typeof workflow.saveRequests !== "object") || !workflow.saveRequests) ) branch = null;
  const settings = Midi.configSettings() ?? {};
  let wait = promptWait();
  const timeout = Number(settings.playerSaveTimeout);
  // Midi's own wait for the player, after which it rolls for them, in Foundry: the app's ends then.
  const midiWait = (branch && (timeout > 0)) ? timeout * 1000 : null;
  if ( midiWait !== null ) wait = Math.min(wait, midiWait);

  // The DC, and whether the player saved, only where Midi shows players them.
  const shown = workflow.activity?.saveDisplay;
  const saveDisplay = ((shown ?? "default") === "default") ? settings.autoCheckSaves : shown;
  const dcShown = !["whisper", "gmOnly"].includes(saveDisplay) && challengeShown(workflow.actor);
  const rollDC = saveDetails.rollDC;
  const effect = workflow.workflowOptions?.overTimeEffectUuid ?? saveDetails.workflowOptions?.overTimeEffectUuid;
  const overtime = typeof effect === "string";
  let cardId;
  try {
    cardId = workflow.itemCardId;
  } catch {
    cardId = null;
  }
  const checkAbility = workflow.saveActivity?.check?.ability;
  const rollMode = workflow.activity?.midiProperties?.rollMode;

  return {
    actor, campaigns, rollType, offered, advantage, branch, wait, midiWait, saveDisplay, dcShown,
    // Whose client Midi's roll dialog is open on, whose the answer's roll is, as Midi's own would be.
    asked: (branch === "dialog") ? player : null,
    type: concentration ? "concentration" : rollType,
    source: concentration ? "concentration" : (overtime ? "overtime" : "midi"),
    // Midi has the chosen ability stamped on the roll where it offered several.
    choices: named.length,
    dc: (dcShown && Number.isInteger(rollDC) && (rollDC > 0) && (rollDC <= 100)) ? rollDC : null,
    rollTarget: (dcShown && Number.isFinite(rollDC) && (rollDC !== 0)) ? rollDC : undefined,
    label: clip(concentration ? concentratingOn(actor) : workflow.item?.name),
    messageId: ((typeof cardId === "string") && ID.test(cardId)) ? cardId : null,
    checkAbility: (skill && (typeof checkAbility === "string") && checkAbility) ? checkAbility : null,
    // As Midi's own roll for the target would show it.
    create: asksPlayer || (displayOptions.showRoll === true),
    rollMode: (rollMode && (rollMode !== "default")) ? rollMode
      : ((player && !player.isGM && PLAYER_ROLL_MODES[settings.playerRollSaves])
        || (displayOptions.whisper ? "gm" : "public"))
  };
}

/**
 * Does Midi pass or fail a friendly target by itself, as its activity or item says? It rolls them
 * a -1 or a 99 then.
 * @param {object} workflow
 * @param {object} saveDetails
 * @returns {boolean}
 */
function friendlyResult(workflow, saveDetails) {
  if ( !saveDetails.isFriendly ) return false;
  const friendly = workflow.activity?.friendlySave;
  if ( ["friendlyFail", "friendlySuccess"].includes(friendly) ) return true;
  const autoFail = game.i18n.localize("midi-qol.autoFailFriendly")?.toLowerCase();
  const description = workflow.item?.system?.description?.value;
  return Boolean(autoFail) && (typeof description === "string") && description.toLowerCase().includes(autoFail);
}

/**
 * The advantage of each choice, as Midi worked it out before asking: advantage or disadvantage,
 * or neither, absent, where it has both or neither. A concentration check has what Midi adds as it
 * rolls one besides.
 * @param {string[]} keys
 * @param {(key: string) => {hasAdvantage?: boolean, hasDisadvantage?: boolean}|undefined} of
 * @param {{actor: Actor, card?: boolean}|null} concentrating   For a concentration check: the
 *   character, and whether it's Midi's card's.
 * @returns {Record<string, "adv"|"dis">}
 */
function advantageOf(keys, of, concentrating) {
  const advantage = {};
  for ( const key of keys ) {
    const each = of(key);
    const added = concentrating ? concentrationModes(concentrating, key) : {};
    const adv = (each?.hasAdvantage === true) || (added.advantage === true);
    const dis = (each?.hasDisadvantage === true) || (added.disadvantage === true);
    if ( adv !== dis ) advantage[key] = adv ? "adv" : "dis";
  }
  return advantage;
}

/**
 * What Midi has a concentration check rolled with, as a concentration check rather than a plain
 * save, as it rolls one (patching.ts:1594, 2047-2064): the character's own flags for concentration,
 * and dnd5e's mode for it; and for its card in "chat" mode, for which nothing is worked out
 * beforehand, the ability's save's too, as Midi has them for any save (patching.ts:1915-1949). A
 * flag is evaluated as Midi evaluates it, where Midi can be asked to; and, as an inference, its
 * tracker not being to be had, a "no advantage" flag cancels the advantage the character's flags
 * give, not dnd5e's mode.
 * @param {{actor: Actor, card?: boolean}} concentrating
 * @param {string} ability
 * @returns {{advantage: boolean, disadvantage: boolean}}
 */
function concentrationModes({ actor, card = false }, ability) {
  const Midi = globalThis.MidiQOL;
  let data = {};
  try {
    if ( typeof Midi?.createConditionData === "function" ) data = Midi.createConditionData({ actor }) ?? {};
  } catch {
    data = {};
  }
  // A save's flags of each kind, and a concentration check's.
  const save = ["all", "save.all", `save.${ability}`];
  const flags = {
    advantage: [...(card ? [...save, "ability.all"] : []), "concentration"],
    noAdvantage: [...(card ? save : []), "concentration"]
  };
  const on = (kind, of) => of.some(name => midiFlag(actor, `${kind}.${name}`, data));
  const modes = [actor.system?.attributes?.concentration?.roll?.mode,
    ...(card ? [actor.system?.abilities?.[ability]?.save?.roll?.mode] : [])].map(mode => Number(mode) || 0);
  return {
    advantage: (on("advantage", flags.advantage) && !on("noAdvantage", flags.noAdvantage))
      || modes.some(mode => mode > 0),
    disadvantage: (on("disadvantage", flags.advantage) && !on("noDisadvantage", flags.noAdvantage))
      || modes.some(mode => mode < 0)
  };
}

/**
 * Is one of Midi's flags on a character, `flags.midi-qol.<name>`: as Midi evaluates it, where it
 * can be asked to; else as it's set.
 * @param {Actor} actor
 * @param {string} name
 * @param {object} data   What Midi evaluates it with.
 * @returns {boolean}
 */
function midiFlag(actor, name, data) {
  const flag = `flags.midi-qol.${name}`;
  const evaluate = globalThis.MidiQOL?.evalAllConditions;
  if ( typeof evaluate === "function" ) {
    try {
      return Boolean(evaluate(actor, flag, data));
    } catch {
      // Read as it's set, below.
    }
  }
  const value = foundry.utils.getProperty(actor, flag);
  return Boolean(value) && !["0", "false"].includes(String(value).trim().toLowerCase());
}

/**
 * May players see a workflow's DC, as Midi has dnd5e's *Challenge Visibility*: everyone's, or only
 * where its user is a player's character?
 * @param {Actor|undefined} actor   The workflow's.
 * @returns {boolean}
 */
function challengeShown(actor) {
  let visibility;
  try {
    visibility = game.settings.get("dnd5e", "challengeVisibility");
  } catch {
    return false;
  }
  if ( visibility === "all" ) return true;
  return (visibility === "player") && (actor?.hasPlayerOwner === true);
}

/**
 * A label as the app takes it.
 * @param {unknown} text
 * @returns {string|null}
 */
function clip(text) {
  return ((typeof text === "string") && text) ? text.slice(0, LONGEST_LABEL) : null;
}

/**
 * Ask the app for a target's save, and give Midi the roll it waits for and the card it deletes
 * after: for a held save, Midi's own way waits; for a parallel one, Midi asks in Foundry at once,
 * and whichever is answered first is the roll.
 * @param {object} workflow
 * @param {object} options
 * @param {() => object} original   Midi's own request.
 * @param {object} asked            What describeAsk found.
 * @returns {{promise: Promise, requestCard: Promise}}
 */
function askSave(workflow, options, original, asked) {
  const entry = createEntry({
    ...asked, workflow, options, original, token: options.target,
    mode: asked.branch ? "parallel" : "held"
  });
  if ( entry.mode === "parallel" ) {
    const requests = (entry.branch === "chat") ? workflow.saveRequests : null;
    const before = new Set(Object.keys(requests ?? {}));
    const out = original();
    try {
      entry.midi = { promise: out?.promise, requestCard: out?.requestCard };
      if ( requests ) {
        // Midi keys a chat request by the target's token id, or at random for a token with none.
        const added = Object.keys(requests).filter(key => !before.has(key));
        entry.requestId = (added.length === 1) ? added[0] : (options.target?.id ?? null);
      }
      Promise.resolve(out?.promise).then(value => midiAnswered(entry, value), () => midiAnswered(entry, null));
      openEntry(entry);
    } catch (err) {
      warnOnce("ask", "Could not ask a Midi-QOL save in the app: Midi asks as it would.", err);
      registry.delete(entry.id);
      return out;
    }
  } else {
    try {
      openEntry(entry);
    } catch (err) {
      warnOnce("ask", "Could not ask a Midi-QOL save in the app: Midi asks as it would.", err);
      registry.delete(entry.id);
      return original();
    }
  }
  return { promise: entry.promise, requestCard: entry.requestCard };
}

/**
 * A new prompt, waiting, with the roll Midi waits for and the card it deletes after, each settled
 * once.
 * @param {object} fields
 * @returns {MidiPrompt}
 */
function createEntry(fields) {
  const key = foundry.utils.randomID(16);
  const openedAt = Date.now();
  let settle;
  let settleCard;
  let decide;
  const entry = {
    ...fields,
    key,
    id: `${key}-${fields.actor.id}`,
    actorId: fields.actor.id,
    messageId: fields.messageId ?? key,
    abilities: (fields.rollType === "skill") ? [] : (fields.abilities ?? fields.offered),
    skills: (fields.rollType === "skill") ? fields.offered : [],
    campaignIds: new Set(),
    state: "waiting",
    timer: null,
    finished: false,
    closedAt: null,
    openedAt,
    expiresAt: openedAt + fields.wait,
    // When Midi's own wait for a player asked in Foundry too ends, as it's started with them asked.
    midiDeadline: Number.isFinite(fields.midiWait) ? openedAt + fields.midiWait : null,
    promise: new Promise(resolve => { settle = resolve; }),
    requestCard: new Promise(resolve => { settleCard = resolve; }),
    verdict: new Promise(resolve => { decide = resolve; })
  };
  Object.assign(entry, { settle, settleCard, decide });
  return entry;
}

/**
 * Tell each campaign that asks of a new prompt, and wait for its answer, until the wait is over.
 * @param {MidiPrompt} entry
 * @returns {void}
 */
function openEntry(entry) {
  prune();
  registry.set(entry.id, entry);
  entry.timer = setTimeout(() => release(entry, "expired"), Math.max(entry.expiresAt - Date.now(), 0));
  const prompt = summarize(entry);
  for ( const campaign of entry.campaigns ) {
    entry.campaignIds.add(campaign.id);
    send(EVENTS.PROMPT_OPENED, { prompt }, campaign);
  }
  delete entry.campaigns;
  scheduleCheck();
}

/**
 * A prompt as a campaign is told of it.
 * @param {MidiPrompt} entry
 * @returns {object}
 */
function summarize(entry) {
  return {
    id: entry.id,
    actorId: entry.actorId,
    messageId: entry.messageId,
    type: entry.type,
    abilities: entry.abilities,
    ...((entry.type === "skill") && { skills: entry.skills }),
    dc: entry.dc,
    label: entry.label,
    openedAt: new Date(entry.openedAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
    source: entry.source,
    advantage: entry.advantage,
    askedInFoundry: entry.mode === "parallel"
  };
}

/**
 * Settle the roll Midi waits for with what's given, once its card is settled too, so that the card
 * is never later than the roll; a promise that fails gives null, for Midi to take as no roll.
 * @param {MidiPrompt} entry
 * @param {unknown} value      The rolls, or a promise of them.
 * @param {unknown} card       The card Midi deletes after, or a promise of it.
 * @returns {void}
 */
function finish(entry, value, card) {
  if ( entry.finished ) return;
  entry.finished = true;
  const settledCard = Promise.resolve(card).then(found => found ?? undefined, () => undefined);
  entry.settleCard(settledCard);
  Promise.resolve(value).then(made => made ?? null, () => null)
    .then(made => settledCard.then(() => entry.settle(made)));
}

/**
 * Tell each campaign told of a prompt that it's closed, and why.
 * @param {MidiPrompt} entry
 * @param {"answered"|"rolled"|"expired"|"gone"} reason
 * @returns {void}
 */
function closeEntry(entry, reason) {
  entry.closedAt = Date.now();
  if ( !canSend() ) return;
  for ( const campaign of getCampaigns() ) {
    if ( entry.campaignIds.has(campaign.id) ) send(EVENTS.PROMPT_CLOSED, { id: entry.id, reason }, campaign);
  }
}

/**
 * Leave a prompt's save to Midi's own way, once: a held one is asked of Midi now, as it would have
 * been, and its roll is Midi's; a parallel one is Midi's anyway. A concentration card is rolled as
 * Midi rolls it.
 * @param {MidiPrompt} entry
 * @param {"expired"|"gone"} reason
 * @param {object} [options]
 * @param {Function|null} [options.resolver]   Midi's chat request, taken from it to answer it,
 *                                             which it gets back.
 * @returns {void}
 */
function release(entry, reason, { resolver=null }={}) {
  if ( !["waiting", "answering"].includes(entry.state) ) return;
  entry.state = "released";
  clearTimeout(entry.timer);
  closeEntry(entry, reason);
  if ( entry.card ) {
    rollAsMidi(entry.card, entry.actor, entry.rollTarget);
    return;
  }
  if ( entry.mode === "parallel" ) {
    if ( resolver ) giveBack(entry, resolver);
    finish(entry, entry.midi?.promise, entry.midi?.requestCard);
    return;
  }
  let out;
  try {
    out = entry.original();
  } catch (err) {
    console.error(`${MODULE_ID} | Midi-QOL couldn't ask for ${entry.actor.name}'s save itself`, err);
    finish(entry, null, undefined);
    return;
  }
  finish(entry, out?.promise, out?.requestCard);
}

/**
 * Give Midi's chat request back what was taken from it to answer it: its resolver, and its own wait,
 * which rolls the save for a player who doesn't in Foundry, now or once its time is up, as Midi
 * would have (Workflow.ts:5847-5913). Without it, Midi would wait on Foundry alone, however long.
 * @param {MidiPrompt} entry
 * @param {Function} resolver
 * @returns {void}
 */
function giveBack(entry, resolver) {
  const { workflow, requestId } = entry;
  const requests = workflow.saveRequests;
  if ( !requestId || !requests || (requestId in requests) ) return;
  requests[requestId] = resolver;
  if ( entry.midiDeadline === null ) return;
  const left = Math.max(entry.midiDeadline - Date.now(), 0);
  const timer = setTimeout(() => void midiTimesOut(entry, resolver), left);
  const timeouts = workflow.saveTimeouts;
  if ( timeouts && (typeof timeouts === "object") ) timeouts[requestId] = timer;
}

/**
 * Midi's own wait for a player asked in Foundry is up, with the save still not rolled there: it's
 * rolled here, as Midi's timer rolls it (Workflow.ts:5848-5909), with Midi's options, every
 * choice Midi offers, its own DC where it shows it, and Foundry's dice. A roll that fails is taken
 * as none, so that Midi's workflow goes on.
 * @param {MidiPrompt} entry
 * @param {Function} resolver
 * @returns {Promise<void>}
 */
async function midiTimesOut(entry, resolver) {
  const { workflow, requestId } = entry;
  if ( workflow.saveRequests?.[requestId] !== resolver ) return;
  delete workflow.saveRequests[requestId];
  const timeouts = workflow.saveTimeouts;
  if ( timeouts && (typeof timeouts === "object") ) delete timeouts[requestId];
  let rolls = null;
  try {
    const { target, saveDetails, rollInfo = {}, displayOptions = {} } = entry.options;
    const settings = globalThis.MidiQOL.configSettings() ?? {};
    const shown = (settings.autoCheckSaves !== "whisper") && displaysDC(workflow.actor);
    const [rollAbilities, rollSkills, rollTools] = [rollInfo.abilities, rollInfo.skills, rollInfo.tools]
      .map(list => (Array.isArray(list) ? list : []));
    const config = {
      target: shown ? saveDetails.rollDC : undefined,
      ability: rollAbilities[0],
      skill: rollSkills[0],
      midiOptions: {
        ...midiOptionsOf(entry),
        rollAbilities, rollSkills, rollTools,
        advantageByChoice: saveDetails.advantageByChoice
      }
    };
    const dialog = { ability: rollAbilities[0], skill: rollSkills[0], tool: rollTools[0] };
    const actor = target.actor;
    const action = (typeof rollInfo.action === "function") ? rollInfo.action
      : { skill: actor.rollSkill, check: actor.rollAbilityCheck }[entry.rollType] ?? actor.rollSavingThrow;
    rolls = await action.call(actor, config, dialog, { create: displayOptions.showRoll });
  } catch (err) {
    console.error(`${MODULE_ID} | Midi-QOL couldn't roll ${entry.actor.name}'s save itself`, err);
  }
  resolver(rolls ?? null);
}

/**
 * May players see a workflow's DC, as Midi's `shouldDisplaySaveDC` has dnd5e's *Challenge
 * Visibility* (settings.ts:2041-2047)?
 * @param {Actor|undefined} actor   The workflow's.
 * @returns {boolean}
 */
function displaysDC(actor) {
  let visibility;
  try {
    visibility = game.settings.get("dnd5e", "challengeVisibility");
  } catch {
    visibility = undefined;
  }
  if ( visibility === "none" ) return false;
  return (visibility === "all") || !actor || (actor.hasPlayerOwner === true);
}

/**
 * Midi's own request for a parallel save was answered, in Foundry or by Midi's own wait: while the
 * app's still waits, that's the save; once the app's answer is being made, it's set aside.
 * @param {MidiPrompt} entry
 * @param {unknown} value
 * @returns {void}
 */
function midiAnswered(entry, value) {
  if ( entry.state !== "waiting" ) return;
  entry.state = "rolled";
  clearTimeout(entry.timer);
  closeEntry(entry, "rolled");
  finish(entry, value, entry.midi?.requestCard);
}

/* -------------------------------------------- */
/*  Looking at the waiting saves                */
/* -------------------------------------------- */

/**
 * Leave to Midi every waiting save whose time is up, whose character is no longer open, whose
 * workflow was aborted, or that this client no longer asks, as the bridge.
 * @returns {void}
 */
function checkWaiting() {
  for ( const entry of registry.values() ) {
    if ( entry.state === "waiting" ) checkEntry(entry);
  }
  scheduleCheck();
}

/**
 * Leave a waiting save to Midi, if it's no longer to wait.
 * @param {MidiPrompt} entry
 * @returns {void}
 */
function checkEntry(entry) {
  if ( entry.workflow?.aborted === true ) return release(entry, "gone");
  if ( !canSend() || (Date.now() >= entry.expiresAt) ) return release(entry, "expired");
  const asking = askers(entry.actorId).filter(campaign => entry.campaignIds.has(campaign.id));
  if ( !asking.some(campaign => isOpen(campaign.id, entry.actorId)) ) release(entry, "expired");
}

/**
 * Look at the waiting saves again in a while, while any waits.
 * @returns {void}
 */
function scheduleCheck() {
  if ( checking !== null ) return;
  if ( !Array.from(registry.values()).some(entry => entry.state === "waiting") ) return;
  checking = setTimeout(() => {
    checking = null;
    checkWaiting();
  }, CHECK_EVERY);
}

/**
 * Forget prompts closed long ago.
 * @returns {void}
 */
function prune() {
  const before = Date.now() - PROMPT_LIFETIME;
  for ( const [id, entry] of registry ) {
    if ( (entry.closedAt !== null) && (entry.closedAt < before) ) registry.delete(id);
  }
}

/* -------------------------------------------- */
/*  Answering                                   */
/* -------------------------------------------- */

/**
 * The Midi prompt a player's roll answers, if its id is one; or why it can't be answered: the
 * campaign wasn't told of it (`character`), the wait is over or it was left to Midi (`expired`),
 * it's answered, being answered or rolled in Foundry (`answered`), the roll is of another kind or
 * with something it doesn't offer (`ability`), or it's rolled otherwise than Midi decides
 * (`mode`). Null for an id that's no Midi prompt.
 * @param {string} id
 * @param {Campaign} campaign
 * @param {object} command
 * @returns {{midi?: MidiPrompt, refusal?: string}|null}
 */
export function findMidiPrompt(id, campaign, command) {
  const entry = registry.get(id);
  if ( !entry ) return null;
  if ( !entry.campaignIds.has(campaign.id) ) return { refusal: "character" };
  if ( entry.state === "waiting" ) checkEntry(entry);
  if ( entry.state === "released" ) return { refusal: "expired" };
  if ( entry.state !== "waiting" ) return { refusal: "answered" };
  if ( Date.now() >= entry.expiresAt ) return { refusal: "expired" };
  const kinds = { save: ["save", "concentration"], ability: ["check"], skill: ["skill"] };
  const offered = (entry.type === "skill") ? entry.skills : entry.abilities;
  if ( !kinds[command.kind]?.includes(entry.type) || !offered.includes(command.key) ) return { refusal: "ability" };
  if ( (command.explicit !== false) || !Array.isArray(command.extras) || command.extras.length ) {
    return { refusal: "mode" };
  }
  return { midi: entry };
}

/**
 * Does a workflow wait on the app for a save it asked there?
 * @param {object} workflow
 * @returns {boolean}
 */
export function midiPromptWaits(workflow) {
  if ( !workflow ) return false;
  for ( const entry of registry.values() ) {
    if ( (entry.workflow === workflow) && (entry.state === "waiting") ) return true;
  }
  return false;
}

/**
 * Is this command an answer to a Midi prompt? Midi may be waiting on it inside the character's own
 * roll before it, as a player's spell from the app that asks them for a save: it's made at once.
 * @param {object} command
 * @returns {boolean}
 */
export function answersMidiPrompt(command) {
  return (typeof command?.prompt === "string") && registry.has(command.prompt);
}

/**
 * Take a waiting prompt to answer it, at once, before anything's awaited: its wait ends, and Midi's
 * chat request for a parallel save is taken from it, its own wait with it, so nothing in Foundry
 * answers it meanwhile. Refused as `answered` where Midi has its roll already.
 * @param {MidiPrompt} entry
 * @returns {{refusal?: string, resolver?: Function|null}}
 */
export function claimMidiPrompt(entry) {
  if ( entry.state === "released" ) return { refusal: "expired" };
  if ( entry.state !== "waiting" ) return { refusal: "answered" };
  let resolver = null;
  if ( (entry.mode === "parallel") && (entry.branch === "chat") && entry.requestId ) {
    const requests = entry.workflow.saveRequests;
    if ( typeof requests?.[entry.requestId] !== "function" ) return { refusal: "answered" };
    resolver = requests[entry.requestId];
    delete requests[entry.requestId];
    const timeouts = entry.workflow.saveTimeouts;
    if ( timeouts && (entry.requestId in timeouts) ) {
      clearTimeout(timeouts[entry.requestId]);
      delete timeouts[entry.requestId];
    }
  }
  entry.state = "answering";
  clearTimeout(entry.timer);
  return { resolver };
}

/**
 * The answer couldn't be made: the save goes Midi's way, and its chat request gets back what was
 * taken from it.
 * @param {MidiPrompt} entry
 * @param {{resolver?: Function|null}} claim
 * @returns {void}
 */
export function midiAnswerFailed(entry, claim) {
  release(entry, "expired", { resolver: claim?.resolver ?? null });
}

/**
 * The answer is made: its rolls are Midi's, with the chosen ability stamped on them where Midi
 * offered several, as it reads it; Midi's own chat request card for a parallel save is deleted,
 * nothing else in Foundry having answered it; and the campaigns are told it's answered, before
 * Midi's verdict, as there may be no message to say so.
 * @param {MidiPrompt} entry
 * @param {Roll[]} rolls
 * @param {string} chosen
 * @returns {void}
 */
export function midiPromptAnswered(entry, rolls, chosen) {
  entry.state = "answered";
  if ( entry.card ) {
    markDone(entry.card);
  } else {
    if ( entry.choices > 1 ) {
      for ( const roll of rolls ) {
        if ( roll?.options ) roll.options.midiChosenId = chosen;
      }
    }
    if ( (entry.mode === "parallel") && (entry.branch === "chat") ) {
      Promise.resolve(entry.midi?.requestCard).then(card => card?.delete?.()).catch(err => {
        console.error(`${MODULE_ID} | Could not delete Midi-QOL's request for ${entry.actor.name}'s save`, err);
      });
    }
    finish(entry, rolls, undefined);
  }
  closeEntry(entry, "answered");
}

/**
 * Whether the answer saved, as Midi decided it, where its player may know: when the DC was sent
 * and Midi shows players whether they saved; for a concentration card, as its roll met the DC.
 * Waited for at most ten seconds.
 * @param {MidiPrompt} entry
 * @param {Roll[]} rolls
 * @returns {Promise<"success"|"failure"|null>}
 */
export async function midiOutcome(entry, rolls) {
  if ( entry.card ) {
    const [roll] = rolls;
    if ( (entry.dc === null) || !roll || !Number.isNumeric(roll.options?.target) ) return null;
    return (roll.isSuccess || (roll.options.success === true)) ? "success" : "failure";
  }
  let timer;
  const verdict = await Promise.race([
    entry.verdict,
    new Promise(resolve => { timer = setTimeout(() => resolve(null), VERDICT_WAIT); })
  ]);
  clearTimeout(timer);
  return ((entry.dc !== null) && OUTCOME_SHOWN.has(entry.saveDisplay)) ? verdict : null;
}

/**
 * Midi has checked a workflow's saves: note whether each of its targets asked in the app saved.
 * @param {object} workflow
 * @returns {void}
 */
function noteVerdicts(workflow) {
  for ( const entry of registry.values() ) {
    if ( entry.workflow !== workflow ) continue;
    const saved = workflow.saves?.has?.(entry.token);
    entry.decide(saved ? "success" : (workflow.failedSaves?.has?.(entry.token) ? "failure" : null));
  }
}

/**
 * How the answer to a workflow's save is rolled: as Midi rolls it itself when a player's time is
 * up, with its own options, so that its bonuses, magic resistance and the advantage it works out
 * apply; with only the ability or skill the player chose to choose from, as that is the choice; and
 * against Midi's DC, where players may see it. A skill is rolled with its own ability, unless the
 * check names one.
 * @param {MidiPrompt} entry
 * @param {string} chosen
 * @returns {object}   The roll's configuration, but for its `rolls`.
 */
export function midiAnswerConfig(entry, chosen) {
  const { saveDetails } = entry.options;
  const skill = entry.rollType === "skill";
  const choice = saveDetails.advantageByChoice?.[chosen];
  return {
    ...(skill ? { skill: chosen, ...(entry.checkAbility && { ability: entry.checkAbility }) } : { ability: chosen }),
    ...((entry.rollTarget !== undefined) && { target: entry.rollTarget }),
    midiOptions: {
      ...midiOptionsOf(entry),
      rollAbilities: skill ? [] : [chosen],
      rollSkills: skill ? [chosen] : [],
      rollTools: [],
      advantageByChoice: choice ? { [chosen]: choice } : undefined
    }
  };
}

/**
 * Midi's options for a workflow's save, as its timer rolls one (Workflow.ts:5869-5887), but for the
 * choices.
 * @param {MidiPrompt} entry
 * @returns {object}
 */
function midiOptionsOf(entry) {
  const { workflow, options: { saveDetails } } = entry;
  return {
    workflowId: workflow.id,
    itemCardUuid: workflow.itemCardUuid,
    advantage: saveDetails.advantage,
    disadvantage: saveDetails.disadvantage,
    mapKeys: false,
    fastForward: true,
    recomputeAdvantage: true,
    saveItemUuid: workflow.saveItem?.uuid,
    isConcentrationCheck: saveDetails.isConcentrationCheck,
    workflowOptions: saveDetails.workflowOptions
  };
}

/**
 * The flags of the message of an answer to a save Midi asks of a player in a roll dialog on their
 * screen too, for their client to close it by: the workflow's, and the character's.
 * @param {MidiPrompt} entry
 * @returns {object}
 */
export function midiAnswerFlags(entry) {
  if ( entry.branch !== "dialog" ) return {};
  return { midiAnswer: { workflowId: String(entry.workflow.id), actorUuid: entry.actor.uuid } };
}

/**
 * Who an answer's roll is made as: the player whose roll dialog Midi opened, as Midi's own roll
 * would be theirs, so that their client is sure to see its message; else null.
 * @param {MidiPrompt} entry
 * @returns {User|null}
 */
export function midiAnswerAuthor(entry) {
  return entry.asked ?? null;
}

/* -------------------------------------------- */
/*  The player's roll dialog                    */
/* -------------------------------------------- */

/**
 * On the client of a player Midi asked for a save in a roll dialog too, once the app's answer is
 * made: close that dialog, unrolled. dnd5e then has no roll from it, and Midi's request on that
 * client settles with none, its own wait cleared (GMAction.ts:984-1011): so that Midi doesn't roll
 * the save again there once its Player Save Timeout is up, and post it, nor does the player.
 * @param {ChatMessage} message
 * @returns {void}
 */
function closeAnsweredDialog(message) {
  const answered = message.flags?.[MODULE_ID]?.midiAnswer;
  if ( (typeof answered?.workflowId !== "string") || (typeof answered.actorUuid !== "string") ) return;
  const open = foundry.applications?.instances;
  if ( typeof open?.values !== "function" ) return;
  for ( const app of Array.from(open.values()) ) {
    const config = app?.config;
    const asking = (config?.midiOptions?.workflowId === answered.workflowId)
      && (config.subject?.uuid === answered.actorUuid);
    if ( !asking ) continue;
    Promise.resolve(app.close?.()).catch(err => {
      console.error(`${MODULE_ID} | Could not close Midi-QOL's roll dialog for a save answered in the app`, err);
    });
  }
}

/* -------------------------------------------- */
/*  Midi's concentration card                   */
/* -------------------------------------------- */

/**
 * Midi's concentration card in its "chat" mode, as it reads it to roll it: its one concentration
 * element, its DC, and the character it's for, the speaker.
 * @param {ChatMessage} message
 * @returns {{actor: Actor, dc: number}|null}
 */
function concentrationCard(message) {
  const content = message?.content;
  if ( (typeof content !== "string") || !content.includes("midi-concentration") ) return null;
  const parsed = new DOMParser().parseFromString(content, "text/html");
  const found = parsed.querySelectorAll('[data-action="concentration"]');
  if ( (found.length !== 1) || (found[0].dataset.type !== "midi-concentration") ) return null;
  const dc = Number(found[0].dataset.dc);
  const { scene, token, actor: actorId } = message.speaker ?? {};
  let actor = (scene && token) ? (game.scenes?.get(scene)?.tokens?.get(token)?.actor ?? null) : null;
  actor ??= message.speakerActor ?? game.actors.get(actorId) ?? null;
  return (actor && Number.isFinite(dc)) ? { actor, dc } : null;
}

/**
 * Before Midi's concentration card is made here, the bridge, for a character open in the app:
 * mark it rolled, so Midi doesn't roll it as it's rendered, and held, so the check is asked in the
 * app, and is never lost should the Gamemaster reload.
 * @param {ChatMessage} message
 * @param {object} data
 * @param {object} options
 * @param {string} userId
 * @returns {void}
 */
function holdConcentrationCard(message, data, options, userId) {
  try {
    if ( !midiPromptStatus.chat || !canSend() || (userId !== game.user?.id) ) return;
    if ( globalThis.MidiQOL.configSettings()?.doConcentrationCheck !== "chat" ) return;
    const asked = concentrationCard(message);
    if ( !asked || !askers(asked.actor.id).some(campaign => isOpen(campaign.id, asked.actor.id)) ) return;
    message.updateSource({ "flags.midi-qol.concentrationRolled": true, [`flags.${MODULE_ID}.midiHeld`]: true });
  } catch (err) {
    warnOnce("card", "Could not hold Midi-QOL's concentration card for the app: Midi rolls it as it would.", err);
  }
}

/**
 * Once Midi's concentration card held for the app is made, ask for the check; or roll it as Midi
 * would, should no campaign ask now.
 * @param {ChatMessage} message
 * @param {object} options
 * @param {string} userId
 * @returns {void}
 */
function askConcentrationCard(message, options, userId) {
  const flags = message.flags?.[MODULE_ID];
  if ( (userId !== game.user?.id) || !flags?.midiHeld || flags.midiDone ) return;
  const asked = concentrationCard(message);
  if ( !asked ) return markDone(message);
  try {
    const campaigns = askers(asked.actor.id);
    if ( !canSend() || !campaigns.some(campaign => isOpen(campaign.id, asked.actor.id)) ) {
      rollAsMidi(message, asked.actor, asked.dc);
      return;
    }
    const { actor, dc } = asked;
    const entry = createEntry({
      card: message, actor, campaigns, mode: "held", branch: null, rollType: "save", type: "concentration",
      source: "concentration", offered: [ownConcentrationAbility(actor)], choices: 1,
      advantage: advantageOf([ownConcentrationAbility(actor)], () => undefined, { actor, card: true }),
      dc: (showsChallenge(message, actor) && Number.isInteger(dc) && (dc >= 0) && (dc <= 100)) ? dc : null,
      rollTarget: dc, label: clip(concentratingOn(actor)), messageId: ID.test(message.id) ? message.id : null,
      wait: promptWait()
    });
    openEntry(entry);
  } catch (err) {
    warnOnce("card", "Could not ask Midi-QOL's concentration card in the app: Midi's roll is made.", err);
    rollAsMidi(message, asked.actor, asked.dc);
  }
}

/**
 * Roll a held concentration card's check as Midi would have, had it not been held: on the player's
 * client where they're in Foundry, otherwise here; and mark it done.
 * @param {ChatMessage} card
 * @param {Actor} actor
 * @param {number} dc
 * @returns {void}
 */
function rollAsMidi(card, actor, dc) {
  try {
    const Midi = globalThis.MidiQOL;
    const user = Midi.playerForActor(actor);
    const made = user?.active
      ? Midi.socket().executeAsUser("rollConcentration", user.id, {
        actorUuid: actor.uuid, target: dc, create: true, rollMode: "gm"
      })
      : actor.rollConcentration({ legacy: false, target: dc }, {}, { create: true, rollMode: "gm" });
    Promise.resolve(made).catch(err => {
      console.error(`${MODULE_ID} | Midi-QOL couldn't roll ${actor.name}'s concentration check`, err);
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Midi-QOL couldn't roll ${actor.name}'s concentration check`, err);
  }
  markDone(card);
}

/**
 * Mark a held concentration card done: its check is rolled, here or in the app.
 * @param {ChatMessage} card
 * @returns {void}
 */
function markDone(card) {
  Promise.resolve(card.setFlag?.(MODULE_ID, "midiDone", true)).catch(err => {
    console.error(`${MODULE_ID} | Could not mark Midi-QOL's concentration card done`, err);
  });
}

/**
 * Roll, as Midi would have, the concentration checks held for the app that no client asks any
 * more, from the last ten minutes: on becoming the bridge, as after the Gamemaster reloads. A card
 * another Gamemaster's client, still here, holds is left to it.
 * @returns {void}
 */
export function releaseHeldCards() {
  if ( !midiPromptStatus.chat ) return;
  const since = Date.now() - PROMPT_LIFETIME;
  const asked = new Set(Array.from(registry.values(), entry => entry.card?.id).filter(Boolean));
  for ( const message of game.messages?.contents ?? [] ) {
    const flags = message.flags?.[MODULE_ID];
    if ( !flags?.midiHeld || flags.midiDone || (message.timestamp < since) || asked.has(message.id) ) continue;
    const author = message.author;
    if ( author && (author.id !== game.user?.id) && author.active ) continue;
    const card = concentrationCard(message);
    if ( card ) rollAsMidi(message, card.actor, card.dc);
    else markDone(message);
  }
}

/* -------------------------------------------- */
/*  Telling campaigns                           */
/* -------------------------------------------- */

/**
 * The Midi prompts waiting in a campaign, for its hello: as told of them.
 * @param {Campaign} campaign
 * @returns {object[]}
 */
export function midiOpenPrompts(campaign) {
  return Array.from(registry.values())
    .filter(entry => (entry.state === "waiting") && entry.campaignIds.has(campaign.id))
    .map(summarize);
}
