import { HIT_POINT_KINDS, HIT_POINT_OPS, MOST_HIT_POINTS } from "./constants.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { hitPoints } from "./characters.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import { checkCommand, failedResult, isObject, namesRollFields, throwsNoDice } from "./command-rolls.mjs";
import { commandActor } from "./creatures.mjs";
import { campaignGroups } from "./groups.mjs";

/**
 * A player's hit points and temporary hit points set from the Sending Stone app, since module 0.44.0,
 * directly, as dnd5e's sheet sets them from its two fields: no damage type, resistance or roll, just
 * the numbers, for what happens outside any action ("you fall through the floor and take 4 damage").
 * Their own character's, its Wild Shape form's while she's shaped, the form's sheet being the one the
 * app was sent, or one of its companions', named by `of`, on its live actor. The Gamemaster's client
 * writes it, as it writes every command, with one plain update; dnd5e then does what it does for any
 * change of hit points: a concentration check asked where they went down, its floating numbers over
 * the token, and its damage and healing hooks. A form at 0 hit points ends its Wild Shape, by the
 * module's own ending, once the command is done (wild-shape.mjs).
 *
 * Each field is set only while it still holds the number the app showed (`from`), as a spell slot is
 * spent, so a change made in Foundry meanwhile is never written over unseen. Nothing is posted in
 * chat, as dnd5e posts nothing for its sheet's fields; so only a character's player sets them from
 * the app, never the Gamemaster as them, which would leave no mark.
 *
 * Offered under D&D Fifth Edition where the campaign's Gamemaster lets its players, by its own
 * switch, on until turned off, apart from its rolls: it throws no dice and uses nothing.
 */

/**
 * The campaigns whose app takes hit points, by id, as their latest answer to a hello or heartbeat said.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * The option a write of hit points from the app carries, for a hook to know it by.
 * @type {string}
 */
const OWN = "hitPoints";

/**
 * The fields a player may set, as the command and its `from` name them, and where each is kept.
 * @type {Record<string, string>}
 */
const FIELDS = { value: "system.attributes.hp.value", temp: "system.attributes.hp.temp" };

/**
 * What else a command may name, none of which setting hit points names: another kind's own fields.
 * @type {string[]}
 */
const OTHERS = [
  "transfer", "remove", "typed", "rerolls", "favorite", "note", "dish", "effect", "wildShape", "spellSlot", "counter",
  "count", "inspiration", "concentration", "enchantment", "prepare", "turn", "undo"
];

/* -------------------------------------------- */
/*  Whether hit points are set here             */
/* -------------------------------------------- */

/**
 * May a campaign's players set their hit points from the app: by its own switch, under dnd5e.
 * @param {Campaign} campaign
 * @returns {boolean}
 */
export function hitPointsOn(campaign) {
  return (campaign.hitPoints === true) && (game.system?.id === "dnd5e");
}

/**
 * What a campaign tells the app of its players' hit points in its hello, beside its rolls: whether
 * they may set them here, and if not, why not, its switch off or the system.
 * @param {Campaign} campaign
 * @returns {{enabled: boolean, kinds: string[], reason: "off"|"system"|null}}
 */
export function hitPointFeatures(campaign) {
  if ( campaign.hitPoints !== true ) return { enabled: false, kinds: [], reason: "off" };
  if ( game.system?.id !== "dnd5e" ) return { enabled: false, kinds: [], reason: "system" };
  return { enabled: true, kinds: [...HIT_POINT_KINDS], reason: null };
}

/**
 * Note whether a campaign's app takes hit points: `features.hitPoints`, 1 or later. One that says
 * nothing of them, as an older or rolled back app, is fetched from for them no longer.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {void}
 */
export function noteHitPointReader(campaignId, features) {
  const format = features?.hitPoints;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
}

/**
 * Does a campaign's app take hit points?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function hitPointReader(campaignId) {
  return readers.has(campaignId);
}

/* -------------------------------------------- */
/*  Setting them                                */
/* -------------------------------------------- */

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

/**
 * Set a character's hit points, its form's or a companion's, fetched from the app: every check before
 * the write, as the actor now is. Each field set must still hold what the app showed, else nothing is
 * written and the sheet as it stands goes ahead of the refusal (`changed`); hit points are set within
 * 0 and the maximum the sheet shows, temporary ones as given. Fields already so are done with nothing
 * written. A write a hook stops, as a module's may, leaves them as they were, read again after it:
 * called off. Then the sheet, ahead of the result, which says what they now are.
 * @param {object} command      `{hitPoints: {op, value?, temp?, from}}`, as fetched.
 * @param {Campaign} passed     The campaign as it was when fetched, which may be a queue's wait old.
 * @returns {Promise<CommandResult>}
 */
export async function runHitPointsCommand(command, passed) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  const campaign = getCampaigns().find(({ id }) => id === passed?.id);
  if ( !campaign || !hitPointsOn(campaign) ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const groups = new Set(campaignGroups(campaign).map(group => group.id));
  const found = [command.actorId, command.of].some(id => groups.has(id)) ? null : commandActor(command, campaign);
  const now = hitPoints(found?.actor);
  if ( !now ) return failed("unknown");
  const { actor, companion } = found;
  const { from } = command.hitPoints;
  if ( Object.entries(from).some(([key, value]) => now[key] !== value) ) {
    sheetFirst(actor, companion);
    return failed("changed");
  }

  const wanted = targetsOf(command.hitPoints, now);
  const changes = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => value !== now[key])
    .map(([key, value]) => [FIELDS[key], value]));
  const done = () => {
    sheetFirst(actor, companion);
    return {
      id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [],
      hitPoints: hitPoints(actor)
    };
  };
  if ( !Object.keys(changes).length ) return done();
  try {
    await actor.update(changes, { sendingStone: OWN });
  } catch (err) {
    return failed("error", (err instanceof Error) ? err.message : String(err));
  }
  // Read again: a hook may have stopped the write, which then resolves with nothing changed.
  const after = hitPoints(actor);
  const moved = Object.keys(wanted).some(key => after?.[key] !== now[key]);
  return moved ? done() : failed("cancelled");
}

/**
 * The numbers a setting asks for, as they'll be written: hit points within 0 and the maximum the sheet
 * shows, with any temporary change to it, as dnd5e's own field clamps them; temporary hit points as
 * given, which dnd5e sets no maximum on.
 * @param {{value?: number, temp?: number}} set
 * @param {{value: number, max: number|null, temp: number}} now
 * @returns {{value?: number, temp?: number}}
 */
function targetsOf(set, now) {
  const max = Number.isFinite(now.max) ? now.max : Infinity;
  return {
    ...(Object.hasOwn(set, "value") && { value: Math.min(Math.max(set.value, 0), max) }),
    ...(Object.hasOwn(set, "temp") && { temp: set.temp })
  };
}
