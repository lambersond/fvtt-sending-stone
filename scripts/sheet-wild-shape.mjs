import { MODULE_ID } from "./constants.mjs";
import { finite } from "./sheet-values.mjs";
import {
  anywhereReader, canPlayersSee, fitsNow, formName, formSummary, foundryOnlyWhy, inPool, knownProfiles, sizeLabel,
  wildShapeOn, wildShapeRules
} from "./wild-shape.mjs";

/**
 * What a character's sheet says of Wild Shape, since module 0.40.0, to an app that takes it (see
 * wild-shape.mjs, command-wildshape.mjs): on a 2024 druid's sheet, `wildShape`, what a change gives
 * her now, her known forms and her last ending; and on a transformed character's, which is its form's,
 * `form`, what she is now. Each is left out, never the sheet, should building it fail. Since 0.54.0,
 * to an app that says `wildShape` 2 or more, a known form from anywhere else is listed as one from
 * the campaign's compendiums is where each of her players could use it in Foundry, and with why not
 * where not.
 */

/**
 * A 2024 druid's Wild Shape, shaped or not, whatever the switch: the row it's used from on this sheet
 * and its uses, her level and circle, her limits, what a change gives now, her known forms, whether a
 * replacement is free, whether she has Wild Resurgence, and how her last Wild Shape ended.
 * @param {Actor} original     She.
 * @param {Actor} sheetActor   The actor the sheet is built from: she, or her form.
 * @param {Campaign} campaign  Whose compendiums her known forms come from.
 * @returns {object|undefined}
 */
export function wildShapeBlock(original, sheetActor, campaign) {
  try {
    const rules = wildShapeRules(original);
    if ( !rules ) return undefined;
    // Her row as the form's copy has it while shaped: dnd5e copies her features with their ids.
    const row = sheetActor.items?.get?.(rules.item.id) ?? rules.item;
    const uses = row.system?.uses ?? {};
    const flag = rules.item.getFlag?.(MODULE_ID, "wildShape") ?? {};
    const ended = flag.ended;
    return {
      item: row.id,
      uses: { value: finite(uses.value) ?? 0, max: finite(Number(uses.max)) ?? 0 },
      level: rules.level,
      circle: rules.moon ? "moon" : null,
      limits: { count: rules.count, cr: rules.cr, fly: rules.fly },
      hours: rules.hours,
      temp: rules.temp,
      acFloor: rules.acFloor,
      known: knownForms(original, rules, campaign),
      swap: flag.swap === true,
      resurgence: Array.from(sheetActor.items ?? []).some(item => item.system?.identifier === "wild-resurgence"),
      ended: (ended && (typeof ended === "object"))
        ? { form: ended.form ?? null, why: ended.why ?? null, at: finite(ended.at), formId: ended.formId ?? null } : null
    };
  } catch {
    return undefined;
  }
}

/**
 * Her known forms, in her Wild Shape's order: one from the campaign's compendiums summarised as it
 * was loaded, with whether it fits her now, and whether it can't be found; one from anywhere else
 * by its profile's name alone, never loaded here, so nothing a player put on their own feature in
 * Foundry is read as a Gamemaster or shown in the app, unless, since 0.54.0 and for an app that
 * takes it, each of her players could use it in Foundry (`foundryOnlyWhy`): then as one from the
 * campaign's compendiums, and otherwise with why not. A profile with no name, as dnd5e's own sheet
 * adds a dropped creature, is named as `formName` finds, never blank.
 * @param {Actor} original
 * @param {object} rules
 * @param {Campaign} campaign
 * @returns {object[]}
 */
function knownForms(original, rules, campaign) {
  const anywhere = anywhereReader(campaign.id);
  return knownProfiles(rules.activity).map(profile => {
    const id = profile._id;
    const named = () => formName(profile, original, campaign);
    if ( !inPool(profile.uuid, campaign) ) {
      if ( !anywhere ) return { id, name: named(), pool: false };
      const why = foundryOnlyWhy(profile.uuid, original);
      if ( why ) return { id, name: named(), pool: false, why };
    }
    const summary = formSummary(profile.uuid, original);
    const fits = fitsNow(profile.uuid, summary, rules);
    const uuid = profile.uuid;
    if ( summary === null ) return { id, uuid, name: named(), pool: true, fits, found: false };
    if ( !summary ) return { id, uuid, name: named(), pool: true, fits };
    const { name, img, size, cr, ac, speeds, attack } = summary;
    return { id, uuid, name, img, size, cr, ac, speeds, attack, pool: true, fits };
  });
}

/**
 * What a transformed character is now, its sheet being its form's: the kind of transformation, the
 * creature, the known form it was taken as, its hours and the whole minutes of world time left where
 * the module times it, whether its armor class is Circle of the Moon's floor, and which of its
 * numbers are the creature's rather than hers. A form made before 0.40.0, with no record, is another
 * kind, untimed, named as its token is.
 * @param {Actor} form
 * @param {Actor} original
 * @param {Campaign} campaign
 * @returns {object|undefined}
 */
export function formBlock(form, original, campaign) {
  try {
    const record = form.getFlag(MODULE_ID, "form") ?? null;
    const hours = Number.isFinite(record?.hours) ? record.hours : null;
    const timed = (hours !== null) && wildShapeOn(campaign) && Number.isFinite(record.endsAt);
    return {
      kind: (record?.kind === "wildShape") ? "wildShape" : "other",
      name: record?.name ?? unrecordedName(form, original),
      img: record ? (record.img ?? null) : (form.img ?? null),
      size: record ? (record.size ?? null) : sizeLabel(form),
      cr: record ? finite(record.cr) : null,
      type: record?.type ?? null,
      profile: record?.profile ?? null,
      hours,
      minutesLeft: timed ? Math.max(0, Math.floor((record.endsAt - (game.time?.worldTime ?? 0)) / 60)) : null,
      flooredAc: flooredAc(form, record, original, campaign),
      beast: beastOf(form, original)
    };
  } catch {
    return undefined;
  }
}

/**
 * A form's name with no record: its token's, less her own name's "{name} (" … ")" where it has that
 * shape, as dnd5e names a form; else the actor's.
 * @param {Actor} form
 * @param {Actor} original
 * @returns {string}
 */
function unrecordedName(form, original) {
  const name = String(form.prototypeToken?.name ?? form.name ?? "");
  const prefix = `${original.name} (`;
  return (name.startsWith(prefix) && name.endsWith(")") && (name.length > prefix.length + 1))
    ? name.slice(prefix.length, -1) : (form.name ?? name);
}

/**
 * Is the form's armor class Circle of the Moon's floor, not the creature's: the floor as dnd5e sets
 * it, a natural armor class of exactly it, where the creature's own, as loaded, is lower. A creature
 * from the campaign's compendiums is loaded for it; one from anywhere else, as a world actor or
 * another pack a form was taken from in Foundry, is loaded too since 0.54.0, for an app that takes
 * such forms, where each of her players may observe it, whatever Foundry's other permissions; else
 * its own armor class, unknown, is taken to be lower, as for a pool form not loaded yet.
 * @param {Actor} form
 * @param {object|null} record
 * @param {Actor} original
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function flooredAc(form, record, original, campaign) {
  const floor = wildShapeRules(original)?.acFloor ?? null;
  const ac = form.system?.attributes?.ac ?? {};
  if ( (record?.kind !== "wildShape") || (floor === null) || (ac.calc !== "natural") || (finite(ac.value) !== floor) ) return false;
  const loaded = inPool(record.uuid, campaign) || (anywhereReader(campaign.id) && canPlayersSee(record.uuid, original));
  const own = loaded ? formSummary(record.uuid, original)?.ac : undefined;
  return !Number.isFinite(own) || (own < floor);
}

/**
 * Which of a form's numbers are the creature's: its abilities whose scores dnd5e took from it (all
 * but a physical or mental one of a kind its transformation kept, Wild Shape keeping the mental ones;
 * one of neither type, as a world's own may be, always the creature's; none where it kept her whole
 * self, as Appearance does), and the saves and skills whose totals on the form are above her own.
 * @param {Actor} form
 * @param {Actor} original
 * @returns {{abilities: string[], saves: string[], skills: string[]}}
 */
function beastOf(form, original) {
  const keep = new Set(form.getFlag?.("dnd5e", "transformOptions")?.keep ?? []);
  // A score is the character's as dnd5e keeps it: a physical one where the transformation keeps the
  // physical, a mental one where it keeps the mental, one of neither type, as a world's own may be,
  // never. Keeping her whole self, as Appearance does, it takes no score from the creature.
  const kept = key => {
    const type = CONFIG.DND5E?.abilities?.[key]?.type;
    return (keep.has("physical") && (type === "physical")) || (keep.has("mental") && (type === "mental"));
  };
  const abilities = keep.has("self") ? [] : Object.keys(form.system?.abilities ?? {}).filter(key => !kept(key));
  const save = (actor, key) => {
    const ability = actor.system?.abilities?.[key] ?? {};
    return finite(ability.save?.value) ?? finite(ability.save) ?? finite(ability.mod) ?? 0;
  };
  const total = (actor, key) => finite(actor.system?.skills?.[key]?.total) ?? 0;
  return {
    abilities,
    saves: Object.keys(form.system?.abilities ?? {}).filter(key => save(form, key) > save(original, key)),
    skills: Object.keys(form.system?.skills ?? {}).filter(key => total(form, key) > total(original, key))
  };
}
