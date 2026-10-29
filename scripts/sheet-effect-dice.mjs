import { DIE_FACES, MOST_EFFECT_DICE } from "./constants.mjs";
import { diceStatus } from "./dice-plan.mjs";
import { effectIdOf, fromTheParty, hiddenFromPlayer } from "./sheet-effects.mjs";

/**
 * Since module 0.42.0, the dice a character's effects add to its d20 rolls, as dnd5e will add them,
 * for its player to type in: Bless's d4 on attacks and saving throws, Bane's taken away from them,
 * Guidance's on its one skill. Read under dnd5e 5 alone, from the effects the player can see: each
 * change that adds one plain die, never a d20, to a field dnd5e adds to a d20 roll, kept only where
 * that field, as dnd5e prepared it, still holds the die. Each is named by the spell or item it comes
 * from, never by an actor, and says which rolls it's on (`on`). A die no effect explains, one written
 * otherwise, such as `1d4 + 1` or with roll data, or one on some kinds of attack alone is left out,
 * for Foundry to roll as ever.
 *
 * Since 0.42.1, the die the 2024 Bardic Inspiration another character gave this one offers, which
 * dnd5e never adds: marked `offer`, on every kind of d20 roll but initiative, for its player to add
 * once the roll fails; its `effect` the Inspired that adding it uses up.
 */

/**
 * A roll an effect's die is on, as a sheet's `effectDice` names it: every roll of a kind, or one of
 * them by its key, such as `save.dex` or `skill.ath`. The app reads them alike.
 * @type {RegExp}
 */
export const EFFECT_TOKEN = /^(attack|check|save|skill|tool|initiative|death|concentration)(\.[A-Za-z0-9_-]{1,32})?$/;

/**
 * The kinds of roll, in the order a die's `on` lists them.
 * @type {string[]}
 */
const KINDS = ["attack", "check", "save", "skill", "tool", "initiative", "death", "concentration"];

/**
 * The kinds of roll a die offered is on, in `on`'s order: every kind but initiative, which has no
 * DC, so never fails, as the 2024 Bardic Inspiration asks.
 * @type {string[]}
 */
const OFFER_KINDS = KINDS.filter(kind => kind !== "initiative");

/**
 * The identifier dnd5e gives the Bardic Inspiration feature, 2014's and 2024's alike.
 * @type {string}
 */
const BARDIC_INSPIRATION = "bardic-inspiration";

/**
 * The start of a change's key that makes it a Midi-QOL optional bonus, which Midi-QOL offers itself
 * after the roll.
 * @type {string}
 */
const MIDI_OPTIONAL = "flags.midi-qol.optional.";

/**
 * The most rolls one die's `on` lists, and the longest name a die has.
 * @type {number}
 */
const MOST_ON = 60;
const LONGEST_NAME = 100;

/**
 * One plain die an effect's change adds, as written: `1d4`, `-1d4` or `2d6`, its count 1 to 20 and
 * at most 999 faces.
 * @type {RegExp}
 */
const ONE_DIE = /^\s*([+-])?\s*(\d{1,2})?d(\d{1,3})\s*$/i;

/**
 * The attack bonus fields, one for each kind of attack, melee and ranged, weapon and spell: an
 * effect's die is on attacks only where it adds the same die to all four.
 * @type {string[]}
 */
const ATTACK_KINDS = ["mwak", "rwak", "msak", "rsak"];

/**
 * The fields of a character dnd5e adds to a d20 roll, `system.` left off, each with the rolls it's
 * added to (D5 documents/actor/actor.mjs:1368-1383, :1486-1492, :1589-1590, :1613, :1724-1725,
 * :1747, :1801-1808; data/activity/attack-data.mjs:271): the death save adds the saving throws'
 * bonus too, as does a concentration check, which adds its ability's save bonus as well; an ability's
 * check bonus is added to that ability's checks, the skills and tools that use it and initiative
 * where it's initiative's ability. A `*` is one key: an ability's, a skill's, a tool's, or an attack
 * kind's.
 * @type {Readonly<Record<string, (system: object, key: string) => string[]>>}
 */
export const EFFECT_FIELDS = Object.freeze({
  "bonuses.abilities.save": () => ["save", "death", "concentration"],
  "bonuses.abilities.check": () => ["check", "skill", "tool", "initiative"],
  "bonuses.abilities.skill": () => ["skill"],
  "abilities.*.bonuses.save": (system, ability) => [
    `save.${ability}`, ...((concentrationAbility(system) === ability) ? ["concentration"] : [])
  ],
  "abilities.*.bonuses.check": (system, ability) => [
    `check.${ability}`,
    ...usingAbility(system.skills, ability).map(id => `skill.${id}`),
    ...usingAbility(system.tools, ability).map(id => `tool.${id}`),
    ...((initiativeAbility(system) === ability) ? ["initiative"] : [])
  ],
  "skills.*.bonuses.check": (system, skill) => [`skill.${skill}`],
  "tools.*.bonuses.check": (system, tool) => [`tool.${tool}`],
  "attributes.init.bonus": () => ["initiative"],
  "attributes.death.bonuses.save": () => ["death"],
  "attributes.concentration.bonuses.save": () => ["concentration"],
  "bonuses.*.attack": () => ["attack"]
});

/**
 * The fields of `EFFECT_FIELDS` with a key in them, each as the path it matches and its key.
 * @type {[RegExp, string][]}
 */
const KEYED_FIELDS = [
  [/^abilities\.([^.]+)\.bonuses\.save$/, "abilities.*.bonuses.save"],
  [/^abilities\.([^.]+)\.bonuses\.check$/, "abilities.*.bonuses.check"],
  [/^skills\.([^.]+)\.bonuses\.check$/, "skills.*.bonuses.check"],
  [/^tools\.([^.]+)\.bonuses\.check$/, "tools.*.bonuses.check"],
  [/^bonuses\.(mwak|rwak|msak|rsak)\.attack$/, "bonuses.*.attack"]
];

/* -------------------------------------------- */

/**
 * Are effects' dice read under this system: D&D Fifth Edition 5.x? dnd5e 6 keeps its bonuses
 * otherwise, and its support is to come.
 * @returns {boolean}
 */
export function effectDiceSystem() {
  if ( game.system?.id !== "dnd5e" ) return false;
  return Number.parseInt(String(game.system.version ?? "")) < 6;
}

/**
 * The sheet's `effectDice`, where the character's effects add any die to its d20 rolls: `{}` where
 * they add none, under another system, or where they can't be read, so that the sheet goes without
 * the key, and is never lost for it.
 * @param {Actor} actor
 * @returns {{effectDice?: object[]}}
 */
export function effectDiceField(actor) {
  try {
    const dice = effectDiceOf(actor);
    return dice.length ? { effectDice: dice } : {};
  } catch {
    return {};
  }
}

/**
 * The dice a character's effects add to its d20 rolls, at most ten, in the order of its effects:
 * each `{ name, effect, faces, count, sign, on }`, one for each effect and die. Only effects on,
 * neither disabled nor suppressed, never an enchantment, nor one its player can't see. Only a change
 * that adds one plain die to a field of `EFFECT_FIELDS`, kept where the field as prepared still holds
 * it, as dnd5e combines them, such as `1d4 - 1d4` for Bless and Bane: a change later overridden, or
 * one dnd5e didn't apply, holds none. A die on attacks only where the effect adds it to all four kinds
 * of attack. A die taken away only where this world's rolls take one away as their own, as the
 * self-test has seen (`negativeDice`). None under another system than dnd5e 5, or for anything that
 * can't be read.
 *
 * Since 0.42.1, the die the 2024 Bardic Inspiration another character gave this one offers, which
 * dnd5e never adds: marked `offer`, on every kind of d20 roll but initiative, for its player to add
 * once the roll fails; its `effect` the Inspired that adding it uses up. At most one for each
 * effect, after that effect's own dice, and counted among the ten.
 * @param {Actor} actor
 * @returns {{name: string, effect: string, faces: number, count: number, sign: 1|-1, on: string[], offer?: true}[]}
 */
export function effectDiceOf(actor) {
  try {
    if ( !effectDiceSystem() || !actor?.system ) return [];
    const system = actor.system;
    // The dice each field holds as prepared, as each change takes its own.
    const fields = new Map();
    const held = path => {
      if ( !fields.has(path) ) fields.set(path, fieldTerms(foundry.utils.getProperty(system, path)));
      return fields.get(path);
    };
    const entries = [];
    for ( const effect of actor.allApplicableEffects?.() ?? [] ) {
      if ( !shown(effect) ) continue;
      for ( const entry of effectEntries(effect, system, held) ) {
        if ( (entry.die.sign < 0) && (diceStatus.negativeDice !== true) ) continue;
        entries.push(entry);
      }
      const offer = offerOf(effect, actor);
      if ( offer ) entries.push(offer);
    }
    const listed = entries.slice(0, MOST_EFFECT_DICE);
    return namedApart(listed).map(({ effect, name, die, on, offer }) => ({
      name, effect: effectIdOf(effect), faces: die.faces, count: die.count, sign: die.sign, on,
      ...(offer && { offer: true })
    }));
  } catch {
    return [];
  }
}

/**
 * Is an effect one whose dice a player is asked for: on, neither disabled nor suppressed, not an
 * enchantment, and one dnd5e shows its player?
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function shown(effect) {
  if ( !effect || effect.disabled || effect.isSuppressed || (effect.active === false) ) return false;
  if ( (effect.type === "enchantment") || effect.isAppliedEnchantment ) return false;
  return !hiddenFromPlayer(effect);
}

/**
 * The dice one effect adds, one entry for each die, in the order its changes first add each, with
 * the rolls it adds it to, in `on`'s order: each change the field it's on still holds, the attack
 * fields only where all four hold the same die from it.
 * @param {ActiveEffect} effect
 * @param {object} system                The actor's prepared data.
 * @param {(path: string) => object[]} held   The dice a field holds that no change has taken yet.
 * @returns {{effect: ActiveEffect, die: object, on: string[]}[]}
 */
function effectEntries(effect, system, held) {
  const byDie = new Map();
  const entryOf = die => {
    const id = `${die.count}d${die.faces}|${die.sign}`;
    if ( !byDie.has(id) ) byDie.set(id, { effect, die, tokens: new Set() });
    return byDie.get(id);
  };
  // The attack kinds each die is added to, by the die.
  const attacks = new Map();
  for ( const change of changesOf(effect) ) {
    if ( !addsTo(change) ) continue;
    const die = oneDie(change.value);
    const field = fieldOf(change.key);
    if ( !die || !field ) continue;
    if ( field.field === "bonuses.*.attack" ) {
      const id = `${die.count}d${die.faces}|${die.sign}`;
      if ( !attacks.has(id) ) attacks.set(id, { die, kinds: new Set() });
      attacks.get(id).kinds.add(field.key);
      // Its entry comes in the order its die first appears.
      entryOf(die);
      continue;
    }
    if ( !takeTerm(held(field.path), die) ) continue;
    for ( const token of EFFECT_FIELDS[field.field](system, field.key) ) entryOf(die).tokens.add(token);
  }
  for ( const { die, kinds } of attacks.values() ) {
    if ( !ATTACK_KINDS.every(kind => kinds.has(kind)) ) continue;
    const paths = ATTACK_KINDS.map(kind => `bonuses.${kind}.attack`);
    if ( !paths.every(path => held(path).some(term => sameDie(term, die))) ) continue;
    for ( const path of paths ) takeTerm(held(path), die);
    entryOf(die).tokens.add("attack");
  }
  return Array.from(byDie.values()).flatMap(({ die, tokens }) => {
    const on = orderedTokens(tokens);
    return on.length ? [{ effect, die, on }] : [];
  });
}

/**
 * The die an effect offers the character, which dnd5e never adds (module 0.42.1): the 2024 Bardic
 * Inspiration's, from the Inspired another character's Bardic Inspiration put on this one, which
 * dnd5e applies with no change, its origin the effect on the bard's feature. Only from an effect on
 * the character itself, never an item's; with an origin, not expired; with no Midi-QOL optional
 * bonus among its changes, which Midi-QOL offers itself; from a feature dnd5e knows as Bardic
 * Inspiration, by its identifier or its name, not one for the 2014 rules, whose die is chosen
 * before the roll's result, as an item that doesn't say is in a world on the legacy rules; of a bard
 * who isn't this character, nor the character a Wild Shape form was made from; the die and its count
 * the bard's scale's now, as dnd5e keeps none on the effect. Its own throws give none, so an odd
 * bard never costs the character the other dice its effects add.
 * @param {ActiveEffect} effect
 * @param {Actor} actor
 * @returns {{effect: ActiveEffect, die: object, on: string[], offer: true}|null}
 */
function offerOf(effect, actor) {
  try {
    if ( (effect.parent !== actor) || (typeof effect.origin !== "string") || !effect.origin ) return null;
    if ( effect.duration?.expired === true ) return null;
    if ( changesOf(effect).some(change => String(change?.key ?? "").startsWith(MIDI_OPTIONAL)) ) return null;
    const { item } = originOf(effect);
    if ( item?.documentName !== "Item" ) return null;
    if ( (item.identifier ?? item.system?.identifier) !== BARDIC_INSPIRATION ) return null;
    if ( item.system?.source?.rules === "2014" ) return null;
    const bard = actorOfItem(item);
    if ( !bard || (bard === actor) || (bard.uuid === actor.uuid) ) return null;
    const original = actor.getFlag?.("dnd5e", "originalActor");
    if ( original && (original === bard.id) ) return null;
    const scale = bard.system?.scale?.bard?.inspiration;
    const faces = scale?.faces;
    if ( (faces === 20) || !DIE_FACES.has(faces) ) return null;
    const count = Number(scale.number) || 1;
    if ( !Number.isInteger(count) || (count < 1) || (count > 20) ) return null;
    return { effect, die: { count, faces, sign: 1 }, on: [...OFFER_KINDS], offer: true };
  } catch {
    return null;
  }
}

/**
 * An effect's changes, as Foundry v14 keeps them, `system.changes`, or as an older Foundry did.
 * @param {ActiveEffect} effect
 * @returns {object[]}
 */
function changesOf(effect) {
  const changes = effect.system?.changes ?? effect.changes ?? [];
  return Array.isArray(changes) ? changes : Array.from(changes ?? []);
}

/**
 * Does a change add to its field: of type "add", as Foundry v14 has it, or of the mode it once was?
 * @param {object} change
 * @returns {boolean}
 */
function addsTo(change) {
  return (change?.type === "add") || (change?.mode === 2);
}

/**
 * The one plain die a change's value is, such as `1d4` or `-1d4`, never a d20; null for anything
 * else, such as `1d4 + 1`, `@scale.bard.inspiration` or `1d3`.
 * @param {unknown} value
 * @returns {{count: number, faces: number, sign: 1|-1}|null}
 */
function oneDie(value) {
  if ( typeof value !== "string" ) return null;
  const match = ONE_DIE.exec(value);
  if ( !match ) return null;
  const count = Number(match[2] ?? 1);
  const faces = Number(match[3]);
  if ( (count < 1) || (count > 20) || (faces === 20) || !DIE_FACES.has(faces) ) return null;
  return { count, faces, sign: (match[1] === "-") ? -1 : 1 };
}

/**
 * The field of `EFFECT_FIELDS` a change's key names, with the key within it, such as `dex`.
 * @param {unknown} key   Such as "system.bonuses.abilities.save".
 * @returns {{path: string, field: string, key: string|null}|null}
 */
function fieldOf(key) {
  if ( typeof key !== "string" ) return null;
  const path = key.replace(/^system\./, "");
  if ( !path.includes("*") && Object.hasOwn(EFFECT_FIELDS, path) ) return { path, field: path, key: null };
  for ( const [pattern, field] of KEYED_FIELDS ) {
    const match = pattern.exec(path);
    if ( match ) return { path, field, key: match[1] };
  }
  return null;
}

/**
 * The dice a field holds as dnd5e prepared it, such as `1d4 - 1d4` for Bless and Bane: its flavors
 * left out, each sum it adds or takes away read apart at the top, its sign before it, a leading `-`
 * signing the first, and only a sum that's a plain die kept; anything within parentheses or a
 * function, or multiplied, is passed by.
 * @param {unknown} formula
 * @returns {{count: number, faces: number, sign: 1|-1}[]}
 */
export function fieldTerms(formula) {
  if ( typeof formula !== "string" ) return [];
  const text = formula.replace(/\[[^\]]*\]/g, "");
  const terms = [];
  let depth = 0;
  let sum = "";
  let sign = 1;
  let within = false;
  const end = () => {
    const match = /^(\d{0,2})d(\d{1,3})$/i.exec(sum.trim());
    if ( match && !within ) terms.push({ count: Number(match[1] || 1), faces: Number(match[2]), sign });
    sum = "";
    within = false;
  };
  for ( const char of text ) {
    if ( char === "(" ) {
      depth++;
      within = true;
      continue;
    }
    if ( char === ")" ) {
      depth = Math.max(depth - 1, 0);
      continue;
    }
    if ( depth > 0 ) continue;
    if ( (char === "+") || (char === "-") ) {
      if ( sum.trim() || within ) {
        end();
        sign = (char === "-") ? -1 : 1;
      }
      else if ( char === "-" ) sign = -sign;
      continue;
    }
    sum += char;
  }
  end();
  return terms;
}

/**
 * Take a die from those a field holds, if it holds one of its count, faces and sign.
 * @param {object[]} terms
 * @param {{count: number, faces: number, sign: number}} die
 * @returns {boolean}   Did it hold one?
 */
function takeTerm(terms, die) {
  const index = terms.findIndex(term => sameDie(term, die));
  if ( index === -1 ) return false;
  terms.splice(index, 1);
  return true;
}

/**
 * @param {{count: number, faces: number, sign: number}} a
 * @param {{count: number, faces: number, sign: number}} b
 * @returns {boolean}
 */
function sameDie(a, b) {
  return (a.count === b.count) && (a.faces === b.faces) && (a.sign === b.sign);
}

/**
 * The rolls a die is on, in order: attacks, checks, each ability's check in dnd5e's order of
 * abilities, saving throws, each ability's, skills, each skill's by id, tools, each tool's, then
 * initiative, death saves and concentration; a roll by its key left out where every roll of its kind
 * is listed, and any the app couldn't read, at most sixty.
 * @param {Set<string>} tokens
 * @returns {string[]}
 */
function orderedTokens(tokens) {
  const abilities = Object.keys(CONFIG.DND5E?.abilities ?? {});
  const valid = Array.from(tokens).filter(token => EFFECT_TOKEN.test(token));
  const whole = new Set(valid.filter(token => !token.includes(".")));
  // A kind's every roll first; then an ability's by dnd5e's order of abilities, else a key by itself.
  const rank = token => {
    const [kind, key] = token.split(".");
    if ( key === undefined ) return [KINDS.indexOf(kind), -1, ""];
    const ability = ["check", "save"].includes(kind) ? abilities.indexOf(key) : -1;
    return [KINDS.indexOf(kind), (ability === -1) ? abilities.length : ability, key];
  };
  return valid
    .filter(token => !token.includes(".") || !whole.has(token.split(".")[0]))
    .sort((a, b) => {
      const [kindA, keyedA, keyA] = rank(a);
      const [kindB, keyedB, keyB] = rank(b);
      return (kindA - kindB) || (keyedA - keyedB) || ((keyA < keyB) ? -1 : (keyA > keyB) ? 1 : 0);
    })
    .slice(0, MOST_ON);
}

/* -------------------------------------------- */
/*  Names                                       */
/* -------------------------------------------- */

/**
 * The name a die is asked for by: the spell or item its effect comes from, as `effectDieName` has
 * it; where two dice share one, each a character of the party gave is told apart by that character's
 * name, as "Bless (Vex)" and "Bless (Mira)". Another's keeps the name alone: an enemy's name is never
 * shown.
 * @param {{effect: ActiveEffect}[]} entries
 * @returns {{effect: ActiveEffect, name: string}[]}
 */
function namedApart(entries) {
  const named = entries.map(entry => ({ ...entry, name: effectDieName(entry.effect) }));
  const counts = new Map();
  for ( const { name } of named ) counts.set(name, (counts.get(name) ?? 0) + 1);
  return named.map(entry => {
    if ( (counts.get(entry.name) ?? 0) < 2 || !fromTheParty(entry.effect) ) return entry;
    const caster = sourceOf(entry.effect).caster?.name;
    if ( (typeof caster !== "string") || !caster ) return entry;
    return { ...entry, name: `${entry.name} (${caster})`.slice(0, LONGEST_NAME) };
  });
}

/**
 * The name a die an effect adds is asked for by, at most a hundred characters, never an actor's:
 * the item an effect on an item is on; else the spell or item it was applied from, as its origin has
 * it, the item a caster's concentration is on where it's applied from that, as Bless is; else the
 * effect's own name, as "Blessed".
 * @param {ActiveEffect} effect
 * @returns {string}
 */
export function effectDieName(effect) {
  const { name } = sourceOf(effect);
  const own = (typeof effect?.name === "string") ? effect.name : "";
  return ((typeof name === "string") && name ? name : own).slice(0, LONGEST_NAME);
}

/**
 * What an effect comes from, by its name, and who gave it: the item it's on and that item's actor;
 * or, from its origin, the item a caster's concentration is on and the caster, the item an effect it
 * was applied from is on and its actor, or the item it was applied from and its actor. Never an
 * actor's name: an origin that is an actor, or nothing found, names nothing. With the item it named
 * it by, where that's an item.
 * @param {ActiveEffect} effect
 * @returns {{name: string|null, caster: Actor|null, item: Item|null}}
 */
function sourceOf(effect) {
  const parent = effect?.parent;
  if ( parent?.documentName === "Item" ) return { name: parent.name, caster: actorOfItem(parent), item: parent };
  return originOf(effect);
}

/**
 * What an effect was applied from, by its origin alone: the item a caster's concentration is on and
 * the caster, the item an effect it was applied from is on and its actor, or the item it was applied
 * from and its actor; with that item, where its origin leads to one.
 * @param {ActiveEffect} effect
 * @returns {{name: string|null, caster: Actor|null, item: Item|null}}
 */
function originOf(effect) {
  const none = { name: null, caster: null, item: null };
  if ( !effect?.origin ) return none;
  let source;
  try {
    source = fromUuidSync(effect.origin, { strict: false });
  } catch {
    return none;
  }
  if ( source?.documentName === "ActiveEffect" ) {
    const parent = source.parent;
    // A caster's concentration, which dnd5e applies a concentration spell's effect from.
    if ( parent?.documentName === "Actor" ) return { name: concentrationItemName(source), caster: parent, item: null };
    if ( parent?.documentName === "Item" ) return { name: parent.name, caster: actorOfItem(parent), item: parent };
    return none;
  }
  if ( source?.documentName === "Item" ) return { name: source.name, caster: actorOfItem(source), item: source };
  return none;
}

/**
 * The name of the item a concentration is on: the item its origin names, else the item dnd5e kept
 * the data of in its flags, as a spell scroll spent to cast it; null where neither can be read.
 * @param {ActiveEffect} concentration
 * @returns {string|null}
 */
function concentrationItemName(concentration) {
  let item = null;
  try {
    item = concentration.origin ? fromUuidSync(concentration.origin, { strict: false }) : null;
  } catch {
    item = null;
  }
  if ( (item?.documentName === "Item") && item.name ) return item.name;
  const kept = concentration.flags?.dnd5e?.item?.data?.name;
  return (typeof kept === "string") && kept ? kept : null;
}

/**
 * The actor an item is on, if it's on one.
 * @param {Item} item
 * @returns {Actor|null}
 */
function actorOfItem(item) {
  const actor = item?.actor ?? item?.parent;
  return (actor?.documentName === "Actor") ? actor : null;
}

/* -------------------------------------------- */
/*  The character's abilities                   */
/* -------------------------------------------- */

/**
 * The ability a character's concentration checks are made with, as dnd5e rolls them.
 * @param {object} system
 * @returns {string|undefined}
 */
function concentrationAbility(system) {
  const own = system.attributes?.concentration?.ability;
  return own || CONFIG.DND5E?.defaultAbilities?.concentration;
}

/**
 * The ability a character's initiative is rolled with, as dnd5e rolls it.
 * @param {object} system
 * @returns {string|undefined}
 */
function initiativeAbility(system) {
  return system.attributes?.init?.ability || CONFIG.DND5E?.defaultAbilities?.initiative;
}

/**
 * The skills or tools a character has that use an ability, by id, sorted.
 * @param {object} [list]   The character's skills or tools.
 * @param {string} ability
 * @returns {string[]}
 */
function usingAbility(list, ability) {
  return Object.entries(list ?? {}).filter(([, entry]) => entry?.ability === ability).map(([id]) => id).sort();
}
