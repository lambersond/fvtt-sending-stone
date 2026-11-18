/**
 * Which of a Wild Shape form's effects come back with the druid, since module 0.49.0, as plain data:
 * those gained in form, told from the effects the form was made with (hers, the creature's own and
 * dnd5e's own for the change) and from the form's own doing; and which of hers have run out on it.
 * dnd5e's return keeps no effect and offers no setting for it, in 5.3.3 or 6.0.5.
 *
 * A script of its own so that the rule is read apart from the writes, which wild-shape.mjs makes:
 * nothing here writes, and it reads nothing of the module's.
 */

/**
 * The fields of dnd5e 6's `system.origin` that name where an effect came from: never its `message`
 * or `profile`.
 * @type {string[]}
 */
const ORIGIN_FIELDS = ["actor", "item", "activity", "effect", "behavior"];

/**
 * An actor's own effects' ids, not its items'.
 * @param {Actor|null|undefined} actor
 * @returns {string[]}
 */
function ownIds(actor) {
  return Array.from(actor?.effects ?? [], effect => effect.id);
}

/**
 * The effects a form is made with that the actor transformed doesn't hold: the creature's own actor
 * effects, and dnd5e's proficiency override where its settings add one. For a first form the actor
 * is the druid herself; for a form made from a form, the earlier form.
 * @param {Actor} host    The actor transformed.
 * @param {object} data   The form's creation data.
 * @returns {string[]}
 */
export function formEffectsOf(host, data) {
  const held = new Set(ownIds(host));
  return Array.from(data?.effects ?? [], effect => effect?._id).filter(id => id && !held.has(id));
}

/**
 * The baseline a form made from a form carries on: the earlier form's, its `expired` among it, with
 * the later creature's own effects added to `formEffects`, where the earlier one has that list (one
 * recorded before 0.49.0 has none, and gets none); and without those of `effects` that the earlier
 * form still holds and the later change left behind, by its settings, which were never taken off.
 * @param {object} base   The earlier form's baseline.
 * @param {Actor} host    The earlier form.
 * @param {object} data   The later form's creation data.
 * @returns {object}
 */
export function chainedBaseline(base, host, data) {
  const held = new Set(ownIds(host));
  const made = new Set(Array.from(data?.effects ?? [], effect => effect?._id));
  const next = { ...base, effects: Array.from(base?.effects ?? []).filter(id => !held.has(id) || made.has(id)) };
  if ( Array.isArray(base?.formEffects) ) next.formEffects = Array.from(new Set([...base.formEffects, ...formEffectsOf(host, data)]));
  return next;
}

/**
 * Is an effect a status effect's own: one whose id is a status effect's static id, of
 * `CONFIG.statusEffects` (a list under dnd5e 5, an object under 6), as a condition's, Exhaustion's,
 * Encumbered's or Dead's is, or Midi-QOL's markers of a Bonus Action or a reaction used; or one of
 * the fixed ids dnd5e keeps for its own (its effect class's `ID`), as Bloodied's, which is in no
 * list. dnd5e sets these from an actor's own numbers, or the module carries them another way; and
 * one that is neither, put on by hand, as dnd5e's Sleeping, Dodging, Hiding or Marked, is left as
 * it is: never kept from a form, and never taken off her for having been taken off one.
 * @param {ActiveEffect|object|null|undefined} effect   An effect, or its data.
 * @returns {boolean}
 */
export function isStatusEffect(effect) {
  const id = effect?._id ?? effect?.id;
  if ( !id ) return false;
  const statuses = Array.isArray(CONFIG.statusEffects) ? CONFIG.statusEffects : Object.values(CONFIG.statusEffects ?? {});
  if ( statuses.some(status => status?._id === id) ) return true;
  return Object.values(CONFIG.ActiveEffect?.documentClass?.ID ?? {}).includes(id);
}

/**
 * Is an effect a concentration?
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function isConcentration(effect) {
  return effect?.statuses?.has?.(CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating") === true;
}

/**
 * Has an effect's duration run out, read as the sheet reads it, once its duration is brought up to
 * date?
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function hasExpired(effect) {
  effect?.updateDuration?.();
  return effect?.duration?.expired === true;
}

/**
 * Where an effect's data says it came from, and what it depends on: its `origin`, as dnd5e 5 writes
 * it; each field of dnd5e 6's `system.origin` that names a document; and `flags.dnd5e.dependentOn`.
 * @param {object} data   An effect's source data.
 * @returns {{origins: string[], dependentOn: string|null}}
 */
function originsOf(data) {
  const from = data?.system?.origin;
  const named = (from && (typeof from === "object")) ? ORIGIN_FIELDS.map(key => from[key]) : [];
  const dependentOn = data?.flags?.dnd5e?.dependentOn;
  return {
    origins: [data?.origin, ...named].filter(each => (typeof each === "string") && each),
    dependentOn: ((typeof dependentOn === "string") && dependentOn) ? dependentOn : null
  };
}

/**
 * Is an effect the form's own doing, by where its data says it came from: a relative uuid, as dnd5e
 * 6 writes an actor's own activity; a bare id in `dependentOn`, which names an effect on the same
 * actor; or an item, effect or activity on the form or an earlier form of its chain. Read by each
 * uuid's start, never by its holding `Actor.`: an unlinked caster's begins `Scene.`. One that is
 * the form's actor itself, as an effect made on its sheet has under dnd5e 5, is not.
 * @param {object} data      An effect's source data.
 * @param {string[]} chain   The form's id, and each earlier form's of its chain.
 * @returns {boolean}
 */
function fromTheForm(data, chain) {
  const { origins, dependentOn } = originsOf(data);
  if ( dependentOn && (dependentOn.length <= 16) ) return true;
  return [...origins, dependentOn].some(uuid => (typeof uuid === "string")
    && (uuid.startsWith(".") || chain.some(id => uuid.startsWith(`Actor.${id}.`))));
}

/**
 * An effect's data with the form's actor, or an earlier form's, written as the druid's own where it
 * is the origin itself, in `origin` and in `system.origin.actor`.
 * @param {object} data      An effect's source data, changed in place.
 * @param {string[]} chain
 * @param {string} uuid      The druid's own.
 * @returns {object}
 */
function asHers(data, chain, uuid) {
  const forms = new Set(chain.map(id => `Actor.${id}`));
  if ( forms.has(data.origin) ) data.origin = uuid;
  if ( forms.has(data.system?.origin?.actor) ) data.system.origin.actor = uuid;
  return data;
}

/**
 * The effects gained in form, as the data to put on the druid, each with its own id: those on the
 * form's own actor, never its items', that the form wasn't made with (her own it carried, and
 * `formEffects`), that are no status effect's own, no concentration and haven't run out, and that
 * aren't the form's own doing. None where the baseline has no `formEffects`, as one recorded before
 * 0.49.0: without it the creature's own can't be told from what was gained. Each is read on its
 * own: one that can't be read, its duration or its data throwing as it is asked, as another module's
 * might, is left out, and named in `unread` with what it threw, so that it never costs the rest.
 * @param {Actor} form
 * @param {object|null} baseline   The record's.
 * @param {string[]} chain         The form's id, and each earlier form's of its chain.
 * @param {Actor} original         The druid.
 * @returns {{gained: object[], unread: {name: string, err: unknown}[]}}
 */
export function gainedOf(form, baseline, chain, original) {
  const gained = [];
  const unread = [];
  if ( !Array.isArray(baseline?.formEffects) ) return { gained, unread };
  const made = new Set([...(baseline.effects ?? []), ...baseline.formEffects]);
  for ( const effect of form?.effects ?? [] ) {
    try {
      if ( made.has(effect.id) || isStatusEffect(effect) || isConcentration(effect) || hasExpired(effect) ) continue;
      const data = effect.toObject();
      if ( fromTheForm(data, chain) ) continue;
      gained.push(asHers(data, chain, original.uuid));
    } catch (err) {
      unread.push({ name: effect?.name, err });
    }
  }
  return { gained, unread };
}

/**
 * The ids of an actor's own effects whose duration has run out: a form's, as Wild Shape ends, and
 * the druid's, as a form is made of her, so that one already run out by then is never read as run
 * out in form. One whose duration can't be read is taken as not run out, so nothing is taken off
 * the druid for it.
 * @param {Actor} actor
 * @returns {string[]}
 */
export function expiredOf(actor) {
  return Array.from(actor?.effects ?? []).filter(effect => {
    try {
      return hasExpired(effect);
    } catch {
      return false;
    }
  }).map(effect => effect.id);
}

/**
 * The concentration an effect's data is tied to, if it names one: `flags.dnd5e.dependentOn` where it
 * is an actor's own effect, `…Actor.<id>.ActiveEffect.<id>`, as a caster's concentration is. Never
 * an item's effect, which dnd5e 5 also names there for an effect applied with no concentration: a
 * potion used up must not cost its effect.
 * @param {object} data   An effect's source data.
 * @returns {string|null}
 */
export function tieOf(data) {
  const dependentOn = data?.flags?.dnd5e?.dependentOn;
  return ((typeof dependentOn === "string") && /(^|\.)Actor\.[^.]+\.ActiveEffect\.[^.]+$/.test(dependentOn)) ? dependentOn : null;
}

/**
 * What to write of an effect's time so that it is as it was sent: of its `start` and its `duration`,
 * each value sent that the one stored differs from; nothing where none does.
 * @param {object|null|undefined} stored   The effect's source data as it is kept.
 * @param {object} sent                    The data it was created from.
 * @returns {{start?: object, duration?: object}}
 */
export function timingChanges(stored, sent) {
  const same = (a, b) => ((a ?? null) === (b ?? null)) || (JSON.stringify(a ?? null) === JSON.stringify(b ?? null));
  const changes = {};
  for ( const field of ["start", "duration"] ) {
    const want = sent?.[field];
    if ( !want || (typeof want !== "object") ) continue;
    const differing = Object.entries(want).filter(([key, value]) => !same(value, stored?.[field]?.[key]));
    if ( differing.length ) changes[field] = Object.fromEntries(differing);
  }
  return changes;
}
