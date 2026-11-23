import { finite, leveled, localize } from "./sheet-values.mjs";

/**
 * What a character's sheet says of summon activities, since 0.54.0, for an app that reads them:
 * which may be cast from the app, such as Find Familiar, Summon Beast, Conjure Animals or a Steel
 * Defender's feature, and the creatures, creature types and sizes each offers, labelled at each
 * level as dnd5e's usage dialog labels them; and which apps read them. Nothing is placed from the
 * app: the creature is placed by the Gamemaster from the card's Summon button (command-summon.mjs).
 *
 * A script of its own, as check-abilities.mjs is: the Sheets and the Commands both ask it what a
 * summon activity offers at the level it's cast at, and it keeps which apps read summons, which
 * character-sync.mjs and creature-sync.mjs both read.
 */

/**
 * How many profiles a summon activity's sheet lists at most.
 * @type {number}
 */
const MOST_SUMMONS = 20;

/**
 * The highest spell level, to which a leveled spell's labels are worked out.
 * @type {number}
 */
const TOP_LEVEL = 9;

/**
 * The campaigns whose app reads summon activities, by id, as their latest answer to a hello or
 * heartbeat said: `summons` 1 or later, since 0.54.0.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * Note whether a campaign's app reads summon activities, from what it said in answer to its hello
 * or heartbeat: `features.summons`, an integer, 1 or more; not where it said anything else, or
 * nothing. The one writer of the readers.
 * @param {string} campaignId
 * @param {object|null} features
 * @returns {boolean}   Did it read them before?
 */
export function noteSummonFormat(campaignId, features) {
  const was = readers.has(campaignId);
  const format = features?.summons;
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
  return was;
}

/**
 * Does a campaign's app read summon activities, as its latest answer said?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function summonReader(campaignId) {
  return readers.has(campaignId);
}

/* -------------------------------------------- */

/**
 * The profiles dnd5e offers at an activity's level, as its `availableProfiles` has them: for a
 * leveled spell the level it's cast at, else its class's or character's.
 * @param {Activity} activity
 * @returns {object[]}
 */
export function availableProfiles(activity) {
  try {
    return Array.from(activity?.availableProfiles ?? []);
  } catch {
    return [];
  }
}

/**
 * A summon activity's profiles that can be summoned: by Challenge Rating, every one, as dnd5e's
 * compendium browser finds the creature; else one whose creature can be found, as dnd5e's
 * `placeSummons` fetches it.
 * @param {Activity} activity
 * @returns {object[]}
 */
export function usableProfiles(activity) {
  try {
    const profiles = Array.from(activity?.profiles ?? []).filter(profile => typeof profile?._id === "string");
    if ( activity.summon?.mode === "cr" ) return profiles;
    return profiles.filter(profile => profile.uuid && globalThis.fromUuidSync?.(profile.uuid, { strict: false }));
  } catch {
    return [];
  }
}

/**
 * The usable profiles dnd5e offers at an activity's level now, in its order.
 * @param {Activity} activity
 * @returns {object[]}
 */
export function offeredProfiles(activity) {
  const usable = new Set(usableProfiles(activity).map(profile => profile._id));
  return availableProfiles(activity).filter(profile => usable.has(profile._id));
}

/**
 * An activity as it is cast at a spell level: its item cloned with dnd5e's scaling, the levels above
 * its own, keeping its id, as dnd5e's card clones it for its Summon button; the activity itself
 * where that's none, or the clone can't be made.
 * @param {Activity} activity
 * @param {number} level
 * @returns {Activity}
 */
export function castAt(activity, level) {
  const scaling = (finite(level) ?? 0) - (finite(activity?.item?.system?.level) ?? 0);
  if ( scaling <= 0 ) return activity;
  try {
    const item = activity.item.clone({ "flags.dnd5e.scaling": scaling }, { keepId: true });
    return item.system.activities?.get(activity.id) ?? activity;
  } catch {
    return activity;
  }
}

/**
 * Can a summon activity be cast from the app: one with a creature that can be summoned, and for
 * anything but a leveled spell one dnd5e offers at its level now, as `enchantInPlay` asks of an
 * enchantment. Nothing is placed: the Gamemaster places the creature from its card.
 * @param {Activity} activity
 * @returns {boolean}
 */
export function summonInPlay(activity) {
  if ( activity?.type !== "summon" ) return false;
  if ( !usableProfiles(activity).length ) return false;
  return leveled(activity.item) || (offeredProfiles(activity).length > 0);
}

/**
 * A profile's name and count, as dnd5e's usage dialog writes them (summon-usage-dialog.mjs's
 * `getProfileLabel`), with the activity's roll data, the level it's cast at among them: its own
 * name, else by Challenge Rating dnd5e's "Challenge Rating of 2 or lower", else its creature's,
 * else "—"; and the number before it, as dnd5e works it out, a whole number made one, or null where
 * it writes none.
 * @param {Activity} activity
 * @param {object} profile
 * @returns {{name: string, count: string|null}}
 */
export function labelOf(activity, profile) {
  let rollData = {};
  try {
    rollData = activity.getRollData?.() ?? {};
  } catch {
    rollData = {};
  }
  let name = profile?.name ? String(profile.name) : "";
  if ( !name && (activity?.summon?.mode === "cr") ) name = challengeLabel(profile.cr, rollData);
  if ( !name ) {
    try {
      name = String(globalThis.fromUuidSync?.(profile?.uuid, { strict: false })?.name ?? "");
    } catch {
      name = "";
    }
  }
  return { name: (name || "—").slice(0, 200), count: countOf(profile?.count ?? "1", rollData) };
}

/**
 * dnd5e's label of a summoning by Challenge Rating: the most it may be, at the level it's cast at.
 * @param {string} formula
 * @param {object} rollData
 * @returns {string}
 */
function challengeLabel(formula, rollData) {
  const { formatCR, simplifyBonus } = globalThis.dnd5e?.utils ?? {};
  try {
    const cr = simplifyBonus ? simplifyBonus(formula, rollData) : Number(formula);
    return game.i18n.format("DND5E.SUMMON.Profile.ChallengeRatingLabel", { cr: formatCR ? formatCR(cr) : String(cr) });
  } catch {
    return "";
  }
}

/**
 * The number before a profile's label, as dnd5e's dialog works it out: its count formula simplified
 * with the roll data, a whole number where it's a number; null where that's nothing or nought.
 * @param {string} formula
 * @param {object} rollData
 * @returns {string|null}
 */
function countOf(formula, rollData) {
  try {
    const simplify = globalThis.dnd5e?.dice?.simplifyRollFormula;
    let count = simplify ? simplify(Roll.replaceFormulaData(String(formula), rollData)) : String(formula);
    if ( /^\s*-?\d+(\.\d+)?\s*$/.test(String(count)) ) count = parseInt(count);
    return count ? String(count).trim().slice(0, 50) || null : null;
  } catch {
    return null;
  }
}

/**
 * The words a label is written in: "<count> × <name>", or the name.
 * @param {{name: string, count: string|null}} label
 * @returns {string}
 */
function written({ name, count }) {
  return count ? `${count} × ${name}` : name;
}

/**
 * The one label dnd5e's dialog shows for a profile of an activity as it's cast: "<count> × <name>"
 * or the name, with "1 × " dropped where every profile it offers there would start with it.
 * @param {Activity} activity
 * @param {object} profile
 * @returns {string}
 */
export function summonLabel(activity, profile) {
  const own = written(labelOf(activity, profile));
  const all = availableProfiles(activity).map(each => written(labelOf(activity, each)));
  return (all.length && all.every(label => label.startsWith("1 × "))) ? own.replace("1 × ", "") : own;
}

/**
 * Does what a profile is labelled change with the level it's cast at: its count, or by Challenge
 * Rating with no name of its own its Challenge Rating, a formula rather than a number?
 * @param {Activity} activity
 * @param {object[]} profiles
 * @returns {boolean}
 */
function varies(activity, profiles) {
  const formula = value => /[^\d\s.]/.test(String(value ?? ""));
  return profiles.some(profile => formula(profile.count)
    || ((activity.summon?.mode === "cr") && !profile.name && formula(profile.cr)));
}

/**
 * The profiles a summon activity offers, in dnd5e's order, at most twenty, each with its id, its
 * name and count as dnd5e's dialog writes them, the spell levels it's offered at and how its label
 * changes higher: for a leveled spell every usable one, its name and count at the spell's own
 * level, `min` and `max` its level limits, either null for none, and `higher` each level above its
 * own, up to the 9th and within them, at which its label differs, worked out only where it may;
 * for anything else, or `fixed`, those offered at its level now, `min` and `max` null, `higher`
 * empty.
 * @param {Activity} activity
 * @param {object} [options]
 * @param {boolean} [options.fixed]   Is it cast at its level now only, as a forward casts it?
 * @returns {{id: string, name: string, count: string|null, min: number|null, max: number|null,
 *   higher: {level: number, name: string, count: string|null}[]}[]}
 */
export function summonProfiles(activity, { fixed=false }={}) {
  const spell = leveled(activity.item) && !fixed;
  const usable = new Set(usableProfiles(activity).map(profile => profile._id));
  const profiles = (spell ? Array.from(activity.profiles ?? []) : availableProfiles(activity))
    .filter(profile => usable.has(profile._id)).slice(0, MOST_SUMMONS);
  const own = finite(activity.item?.system?.level) ?? 0;
  const scaled = (spell && varies(activity, profiles))
    ? Array.from({ length: Math.max(TOP_LEVEL - own, 0) }, (_, i) => castAt(activity, own + i + 1)) : [];
  return profiles.map(profile => {
    const { name, count } = labelOf(activity, profile);
    const min = spell ? finite(profile.level?.min) : null;
    const max = spell ? finite(profile.level?.max) : null;
    const higher = scaled.flatMap((at, i) => {
      const level = own + i + 1;
      if ( ((min !== null) && (level < min)) || ((max !== null) && (level > max)) ) return [];
      const label = labelOf(at, profile);
      return ((label.name === name) && (label.count === count)) ? [] : [{ level, ...label }];
    });
    return { id: profile._id, name, count, min, max, higher };
  });
}

/**
 * The creature types and sizes a summon activity offers a choice of, each `{key, label}`, labelled
 * as dnd5e's dialog labels them, where it offers more than one; else none.
 * @param {Activity} activity
 * @returns {{types: {key: string, label: string}[], sizes: {key: string, label: string}[]}}
 */
export function summonOptions(activity) {
  const options = (keys, table) => {
    const valid = Array.from(keys ?? []).filter(key => (typeof key === "string") && /^[A-Za-z][\w-]{0,31}$/.test(key));
    if ( valid.length < 2 ) return [];
    return valid.map(key => ({ key, label: (localize(table?.[key]?.label) || key).slice(0, 100) }));
  };
  return {
    types: options(activity?.creatureTypes, CONFIG.DND5E?.creatureTypes),
    sizes: options(activity?.creatureSizes, CONFIG.DND5E?.actorSizes)
  };
}

/**
 * What a summon activity the app may cast offers, as the sheet tells it: its profiles, as
 * `summonProfiles` has them, and its types and sizes.
 * @param {Activity} activity
 * @param {object} [options]
 * @param {boolean} [options.fixed]
 * @returns {{profiles: object[], types: object[], sizes: object[]}}
 */
export function describeSummon(activity, { fixed=false }={}) {
  return { profiles: summonProfiles(activity, { fixed }), ...summonOptions(activity) };
}

/**
 * Would dnd5e's card ask which creature, type or size, as its Summon button opens its dialog where
 * more than one creature is offered at the level cast, or none, or a choice of type or size
 * (summon.mjs's `#placeSummons`)?
 * @param {Activity} activity   As it's cast.
 * @returns {boolean}
 */
export function asksOnCard(activity) {
  return (availableProfiles(activity).length !== 1) || ((activity?.creatureSizes?.size ?? 0) > 1)
    || ((activity?.creatureTypes?.size ?? 0) > 1);
}
