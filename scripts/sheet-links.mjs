import { MODULE_ID } from "./constants.mjs";

/**
 * The links in a description that the app can act on: saving throws, checks, damage and healing,
 * rolls, and conditions.
 *
 * dnd5e and Foundry enrich a description into links that only work inside Foundry. Before it is
 * sent, each one the app can act on becomes a span of its own, which says what it is in data
 * attributes; the rest become their text:
 *
 * - `<span class="ss-save roll" data-n data-ability="dex" data-dc="15">`, with "str|dex" for a
 *   choice of abilities and `data-type="concentration"` for a concentration check;
 * - `<span class="ss-check roll" data-n data-checks="skill:str:ath|check:dex" data-dc="15">`, a
 *   check, with `|` between a choice of checks, each "check:<ability>", "skill:<ability>:<skill>"
 *   or "tool:<ability>:<tool>", and `data-using-tool="thief"` for a skill checked using a tool;
 * - `<span class="ss-damage roll" data-n data-formulas="2d6&1d4" data-types="fire&cold|fire">`,
 *   with `&` between parts, `|` between a part's choice of types, and `data-healing="true"` for
 *   healing;
 * - `<span class="ss-roll roll" data-n data-formula="1d6">`, a roll in the text;
 * - `<span class="ss-condition ref" data-condition="prone">`, a condition, to read about.
 *
 * Those to act on are numbered by `data-n`, in the order they come in the text, and a command from
 * the app names one by its description's hash and that number. Plain text the game's language is
 * English for, such as "a DC 15 Dexterity saving throw", "a Strength (Athletics) check" or "2d6
 * fire damage", is marked too, as are conditions named in any language.
 *
 * Nothing in a description is trusted: it may be a player's own. Spans in its source that look
 * like these lose their classes and data, and every formula is the character's, resolved and
 * checked. Every pattern here is bounded, so no text can make one take long.
 */

/**
 * The most links to act on, and the most conditions, one description has. Any more are text.
 * @type {number}
 */
export const MOST_LINKS = 200;

/**
 * The longest description sent, in characters, once its links are normalised: anything longer is
 * cut short, by `cutShort`.
 * @type {number}
 */
export const LONGEST = 100_000;

/**
 * The longest source normalised, in characters: ten times the longest description sent, which is
 * cut after normalising.
 * @type {number}
 */
const LONGEST_READ = 10 * LONGEST;

/**
 * NodeFilter.SHOW_TEXT, which a document's tree walker takes to visit text only.
 * @type {number}
 */
const SHOW_TEXT = 4;

/**
 * The classes of the spans this makes. Any other element with a class like these, beginning
 * "ss-", loses it.
 * @type {string[]}
 */
const LINK_CLASSES = ["ss-save", "ss-check", "ss-damage", "ss-roll", "ss-condition"];

/**
 * The data attributes of the spans this makes. Any other element with one loses it.
 * @type {string[]}
 */
const LINK_DATA = [
  "n", "ability", "dc", "type", "checks", "using-tool", "formulas", "types", "healing", "formula", "condition"
];

/**
 * The most checks one link offers a choice of. One that offers more is text.
 * @type {number}
 */
const MOST_CHECKS = 10;

/**
 * The kinds of check a link may offer, as dnd5e's roll request buttons name them: an ability
 * check, a skill check, or a tool check.
 * @type {string[]}
 */
const CHECK_TYPES = ["check", "skill", "tool"];

/**
 * A key dnd5e names a skill or tool by, as the app accepts one: never ":" or "|", which separate
 * the checks a span offers.
 * @type {RegExp}
 */
const CHECK_KEY = /^[A-Za-z][\w-]{0,31}$/;

/**
 * The abilities a check may be made with: the six the app knows. A link to a check with any other,
 * such as a world's own, is text.
 * @type {string[]}
 */
const SIX_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * Where text is never marked: links, headings, and the spans this makes.
 * @type {string}
 */
const UNMARKED = ["a", "h1", "h2", "h3", "h4", "h5", "h6", "button", "script", "style", ...LINK_CLASSES.map(name => `.${name}`)]
  .join(", ");

/**
 * A formula the app may be sent: the characters of dice, numbers, arithmetic and dice functions,
 * never a reference to data, and no longer than the app accepts.
 * @type {RegExp}
 */
const SAFE_FORMULA = /^[\w\s+\-*/().,]{1,100}$/;

/**
 * Inline rolls a player makes for everyone to see; one made for the Gamemaster's or their own eyes
 * only is text.
 * @type {Set<string>}
 */
const OPEN_ROLLS = new Set(["roll", "publicroll"]);

/**
 * What dnd5e or Foundry leaves of a link it couldn't enrich, such as `[[/save]]` on an item with
 * no saving throw, `[[/r 1d4]]{Luck}` or `&Reference[nowhere]`: its command and configuration,
 * and its label.
 * @type {RegExp}
 */
const LEFTOVER = new RegExp("\\[\\[(\\/[a-z]{1,16}|lookup|language)(?![a-z])((?:[^\\]]|\\](?!\\])){0,300})\\]\\]"
  + "(?:\\{([^}]{0,200})\\})?|&Reference\\[([^\\]]{0,100})\\](?:\\{([^}]{0,200})\\})?", "gi");

/**
 * Whether a text may hold what `LEFTOVER` matches, cheaply.
 * @type {RegExp}
 */
const MAYBE_LEFTOVER = /\[\[|&reference\[/i;

/**
 * What marks one of the Gamemaster's own links in an enriched description, read in the link's
 * opening tag: dnd5e's "Request Roll", "Apply Status" and award links, for a cleanup without a
 * document.
 * @type {RegExp}
 */
const GM_LINK = /\b(?:enricher-action|award-link)\b/i;

/**
 * How far after a Gamemaster's link's opening tag its closing tag is looked for, in characters.
 * @type {number}
 */
const GM_LINK_LENGTH = 1000;

/**
 * Where dnd5e's 2024 rules keep each condition's rules, and where its 2014 rules kept them, as
 * `config.mjs` and `config-legacy.mjs` of dnd5e 5.3 have them. dnd5e's configuration names only
 * the pages of the rules a world plays by, but a description may link either.
 * @type {Record<string, string>}
 */
const CONDITION_PAGES = {
  blinded: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.uDogReMO6QtH6NDw",
  charmed: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.vLAsIUa0FhZNsyLk",
  deafened: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.qlRw66tJhk0zLnwq",
  exhaustion: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.jSQtPgNm0i4f3Qi3",
  frightened: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.93uaingTESo8N1qL",
  grappled: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.KbQ1k0OIowtZeQgp",
  incapacitated: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.4i3G895hy99piand",
  invisible: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.MQIZ1zRLWRcNOtPN",
  paralyzed: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.RnxZoTglPnLc6UPb",
  petrified: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.6vtLuQT9lwZ9N299",
  poisoned: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.HWs8kEojffqwTSJz",
  prone: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.QxCrRcgMdUd3gfzz",
  restrained: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.dqLeGdpHtb8FfcxX",
  stunned: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.EjbXjvyQAMlDyANI",
  unconscious: "Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.fZCRaKEJd4KoQCqH"
};
const LEGACY_CONDITION_PAGES = {
  blinded: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.0b8N4FymGGfbZGpJ",
  charmed: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.zZaEBrKkr66OWJvD",
  deafened: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.6G8JSjhn701cBITY",
  exhaustion: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.cspWveykstnu3Zcv",
  frightened: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.oreoyaFKnvZCrgij",
  grappled: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.gYDAhd02ryUmtwZn",
  incapacitated: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.TpkZgLfxCmSndmpb",
  invisible: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.3UU5GCTVeRDbZy9u",
  paralyzed: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.xnSV5hLJIMaTABXP",
  petrified: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.xaNDaW6NwQTgHSmi",
  poisoned: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.lq3TRI6ZlED8ABMx",
  prone: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.y0TkcdyoZlOTmAFT",
  restrained: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.cSVcyZyNe2iG1fIc",
  stunned: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.ZyZMUwA2rboh4ObS",
  unconscious: "Compendium.dnd5e.rules.JournalEntry.w7eitkpD7QQTB6j0.JournalEntryPage.UWw13ISmMxDzmwbd"
};

/**
 * Where a word starts and ends, in any alphabet: `\b` knows only ASCII letters, and would find a
 * word ending in the middle of "Pétrifié".
 * @type {string}
 */
const START = "(?<![\\p{L}\\p{N}_])";
const END = "(?![\\p{L}\\p{N}_])";

/**
 * The space between two words of a phrase, and the space there may be, a few characters at most:
 * an unbounded run is what lets a pattern take seconds over a long run of spaces.
 * @type {string}
 */
const GAP = "\\s{1,4}";
const SPACE = "\\s{0,4}";

/**
 * The most choices plain text may list for one saving throw or check, "Strength, Dexterity, or
 * Constitution": as many as the six abilities.
 * @type {number}
 */
const MOST_LISTED = 6;

/**
 * How far before a saving throw or check in plain text is read for a list it ends: "Charisma
 * (Deception, Intimidation, Performance, or Persuasion) or ".
 * @type {number}
 */
const LIST_BEFORE = 64;

/**
 * Words before a condition's name, in English, that say something is in it: "is prone", "falls
 * unconscious". Tested on the few characters before a match, never as part of the pattern.
 * @type {RegExp}
 */
const IN_CONDITION = new RegExp("(?:^|[^\\p{L}\\p{N}_])"
  + "(?:is|are|be|being|been|becomes?|became|remains?|was|were|knocked|falls?|fell|left)\\s{1,3}$", "iu");

/**
 * "condition" after a condition's name, in English: "the poisoned condition".
 * @type {RegExp}
 */
const CONDITION_WORD = /^\s{1,3}condition(?![\p{L}\p{N}_])/iu;

/**
 * A DC just before a saving throw's or check's link, "DC 15 ", and one just after it, "saving
 * throw (DC 15)" or "check (DC 15)".
 * @type {RegExp}
 */
const DC_BEFORE = /DC\s{0,3}(\d{1,3})\s{0,3}$/;
const DC_AFTER = /^\s{0,3}(?:(?:saving\s{1,3}throw|save)\s{0,3})?\(DC\s{0,3}(\d{1,3})\)/i;
const CHECK_DC_AFTER = /^\s{0,3}(?:check\s{0,3})?\(DC\s{0,3}(\d{1,3})\)/i;

/**
 * "against your spell save DC" just after a saving throw's or check's link, in English.
 * @type {RegExp}
 */
const SPELL_DC_AFTER = new RegExp("^\\s{0,3}(?:(?:saving\\s{1,3}throw|save)\\s{1,3})?"
  + "against\\s{1,3}your\\s{1,3}spell\\s{1,3}save\\s{1,3}DC(?![\\p{L}\\p{N}_])", "iu");
const CHECK_SPELL_DC_AFTER = new RegExp("^\\s{0,3}(?:check\\s{1,3})?"
  + "against\\s{1,3}your\\s{1,3}spell\\s{1,3}save\\s{1,3}DC(?![\\p{L}\\p{N}_])", "iu");

/**
 * The patterns for plain text, built for the game's language and dnd5e's labels, kept until either
 * changes.
 * @type {{key: string}|null}
 */
let plain = null;

/* -------------------------------------------- */
/*  Normalising                                 */
/* -------------------------------------------- */

/**
 * A description's HTML with its links as the app can act on them. See the top of this file.
 * @param {string} html                     As enriched, or as stored if it couldn't be.
 * @param {object} [options]
 * @param {Document} [options.relativeTo]   The document it belongs to: an item, a spell an item
 *                                          casts, an effect, the character, or a journal page.
 * @param {object} [options.rollData]       The roll data its formulas are resolved with.
 * @param {boolean} [options.actionable]    Whether it may have links to act on, as a character's
 *                                          own descriptions do; the rules of a condition have only
 *                                          conditions.
 * @param {Map<number, number>} [options.hiddenDCs]   Filled with the DC of each saving throw whose
 *                                          author hid it, by its link's number: never in the HTML,
 *                                          for the module alone to roll it against, as dnd5e does.
 * @returns {string}
 */
export function normaliseLinks(html, { relativeTo, rollData, actionable=true, hiddenDCs }={}) {
  const doc = new DOMParser().parseFromString(String(html ?? "").slice(0, LONGEST_READ), "text/html");
  const body = doc.body;
  const context = {
    doc, relativeTo, actionable,
    rollData: rollData ?? {},
    actor: actorOf(relativeTo),
    made: new Set(),
    hidden: new Map(),
    hiddenDCs,
    links: 0,
    conditions: 0
  };
  forgetForgedLinks(body);
  for ( const el of body.querySelectorAll("enriched-content") ) el.replaceWith(...el.childNodes);
  // Conditions first: dnd5e's "Apply Status" link, removed next, names the condition.
  markReferences(body, context);
  for ( const el of body.querySelectorAll(".enricher-action, .award-link") ) el.remove();
  for ( const el of body.querySelectorAll("i.currency") ) replaceSafely(el, () => el.replaceWith(currencyLabel(el)));
  for ( const el of body.querySelectorAll(".roll-link-group") ) {
    if ( el.isConnected ) replaceSafely(el, () => replaceRollLink(el, context));
  }
  for ( const el of body.querySelectorAll("a.inline-roll") ) {
    if ( el.isConnected ) replaceSafely(el, () => replaceInlineRoll(el, context));
  }
  for ( const el of body.querySelectorAll(".roll-link, .roll-action, .passive-check, .lookup-value") ) {
    if ( el.isConnected ) el.replaceWith(el.textContent);
  }
  replaceLeftovers(body, context);
  markPlainText(body, context);
  numberLinks(body, context);
  return body.innerHTML;
}

/**
 * A description's HTML without the Gamemaster's own links and with what dnd5e couldn't enrich
 * reduced to its label, by string alone: for when it can't be normalised. Nothing in it can be
 * taken for a link to act on. Only as much as is sent is read, each character a few times at most,
 * so no text can make it take long.
 * @param {string} html
 * @returns {string}
 */
export function cleanLinks(html) {
  return withoutGMLinks(cutShort(String(html ?? "")))
    .replace(/\bss-(?=[a-z])/gi, "x-ss-")
    .replace(/\bdata-n(?=\s{0,3}=)/gi, "data-x-n")
    .replace(LEFTOVER, leftoverLabel);
}

/**
 * HTML cut to the longest description sent, short of any tag the cut would split.
 * @param {string} html
 * @returns {string}
 */
export function cutShort(html) {
  if ( html.length <= LONGEST ) return html;
  const kept = html.slice(0, LONGEST);
  const open = kept.lastIndexOf("<");
  return (open > kept.lastIndexOf(">")) ? kept.slice(0, open) : kept;
}

/**
 * HTML without the Gamemaster's own links, by string alone: each `<a>` whose opening tag names one
 * is dropped with all it holds, up to its `</a>` if that comes soon after, or else its opening tag
 * alone. Read from start to end once, never a pattern over the whole text: the closing tags are
 * looked for ahead of the links, and never twice over the same text.
 * @param {string} html
 * @returns {string}
 */
function withoutGMLinks(html) {
  const opening = /<a[\s/]/gi;
  const closing = /<\/a>/gi;
  const kept = [];
  let at = 0;
  let close = -1;
  for ( let found = opening.exec(html); found; found = opening.exec(html) ) {
    const open = found.index;
    const end = html.indexOf(">", open);
    if ( end === -1 ) break;
    opening.lastIndex = end + 1;
    if ( !GM_LINK.test(html.slice(open, end + 1)) ) continue;
    if ( (close !== Infinity) && (close <= end) ) {
      closing.lastIndex = end + 1;
      close = closing.exec(html)?.index ?? Infinity;
    }
    const stop = (close - end - 1 <= GM_LINK_LENGTH) ? close + 4 : end + 1;
    kept.push(html.slice(at, open));
    at = opening.lastIndex = stop;
  }
  kept.push(html.slice(at));
  return kept.join("");
}

/**
 * Replace an element as `replace` does, or should that fail, as for a link written so that nothing
 * here foresaw it, with its text: one link that can't be read costs its description only itself.
 * @param {HTMLElement} el
 * @param {Function} replace
 */
function replaceSafely(el, replace) {
  try {
    replace();
  } catch {
    if ( el.isConnected ) el.replaceWith(el.textContent);
  }
}

/* -------------------------------------------- */

/**
 * Strip what in a description's source looks like the spans this makes, as a player might write
 * into their biography: their classes and their number.
 * @param {HTMLElement} body
 */
function forgetForgedLinks(body) {
  for ( const el of body.querySelectorAll("[class*='ss-']") ) {
    for ( const name of Array.from(el.classList) ) if ( name.startsWith("ss-") ) el.classList.remove(name);
    if ( !el.classList.length ) el.removeAttribute("class");
  }
  for ( const el of body.querySelectorAll("[data-n]") ) el.removeAttribute("data-n");
}

/**
 * Turn links to a condition's rules into conditions: dnd5e's `&Reference[prone]`, which names it
 * in its "Apply Status" link, or a link to the condition's page in either rules.
 * @param {HTMLElement} body
 * @param {object} context
 */
function markReferences(body, context) {
  const pages = conditionPages();
  for ( const el of body.querySelectorAll(".reference-link, a.content-link[data-uuid]") ) {
    if ( !el.isConnected ) continue;
    replaceSafely(el, () => {
      const link = el.matches("a") ? el : el.querySelector("a.content-link");
      const status = el.querySelector("[data-action='applyStatus'][data-status]")?.dataset.status;
      const key = conditionKey(status) ?? conditionKey(pages.get(link?.dataset.uuid));
      const span = key ? conditionSpan(context, key, (link ?? el).textContent) : null;
      if ( span ) el.replaceWith(span);
    });
  }
}

/**
 * A dnd5e roll link: a saving throw or concentration check, an ability, skill or tool check, or
 * damage or healing, as a span to act on; anything else, such as an attack or an item to use, as
 * its text.
 * @param {HTMLElement} el      Its `.roll-link-group`.
 * @param {object} context
 */
function replaceRollLink(el, context) {
  const data = el.dataset;
  const label = el.textContent;
  let span = null;
  if ( context.actionable ) {
    if ( (data.type === "save") || (data.type === "concentration") ) span = enrichedSave(el, label, context);
    else if ( CHECK_TYPES.includes(data.type) ) span = enrichedCheck(el, label, context);
    else if ( data.type === "damage" ) span = damageSpan(context, {
      formulas: (data.formulas ?? "").split("&"),
      types: (data.damageTypes ?? "").split("&"),
      healing: data.rollType === "healing"
    }, label);
  }
  el.replaceWith(span ?? label);
}

/**
 * A dnd5e saving throw or concentration check link as a span, with its DC: dnd5e's own, or one
 * the text gives around it, or the item's. One whose author hid its DC has none in the span; its
 * DC is noted apart, by the span, for the module alone.
 * @param {HTMLElement} el
 * @param {string} label
 * @param {object} context
 * @returns {HTMLElement|null}
 */
function enrichedSave(el, label, context) {
  const concentration = el.dataset.type === "concentration";
  const abilities = abilityKeys((el.dataset.ability ?? "").split("|"));
  if ( !concentration && !abilities.length ) return null;
  if ( el.dataset.hideDC === "true" ) {
    const span = saveSpan(context, { abilities, dc: null, concentration }, label);
    const hidden = challenge(el.dataset.dc);
    if ( span && (hidden !== null) ) context.hidden.set(span, hidden);
    return span;
  }
  const before = (el.previousSibling?.nodeType === 3) ? el.previousSibling.data.slice(-24) : "";
  const after = (el.nextSibling?.nodeType === 3) ? el.nextSibling.data.slice(0, 64) : "";
  const spellDC = english() && SPELL_DC_AFTER.test(after);
  const dc = challenge(el.dataset.dc) ?? challenge(DC_BEFORE.exec(before)?.[1])
    ?? challenge(DC_AFTER.exec(after)?.[1]) ?? (spellDC ? spellDCOf(context.actor) : null)
    ?? (concentration ? null : activityDC(context.relativeTo, abilities));
  return saveSpan(context, { abilities, dc, concentration }, label);
}

/**
 * A dnd5e check link, from `[[/check]]`, `[[/skill]]` or `[[/tool]]`, as a span offering the checks
 * dnd5e's request for it would: an ability check, for a link that names no skill or tool; or else
 * a check with each skill and tool it names, with the ability it names, or else each one's own, as
 * dnd5e's configuration has it, never the character's; but not with a tool a skill is checked
 * using, as under the 2024 rules. Its DC is dnd5e's, or one the text gives around it, or the
 * item's. One whose author hid its DC has none in the span; its DC is noted apart, by the span,
 * for the module alone, as a saving throw's is. dnd5e's passive checks are no link to act on.
 * @param {HTMLElement} el
 * @param {string} label
 * @param {object} context
 * @returns {HTMLElement|null}
 */
function enrichedCheck(el, label, context) {
  const data = el.dataset;
  const skills = CONFIG.DND5E?.skills ?? {};
  const tools = CONFIG.DND5E?.tools ?? {};
  const fixed = data.ability || null;
  const skillKeys = splitKeys(data.skill);
  const toolKeys = splitKeys(data.tool);
  const offered = (type, list) => key => ({ type, ability: fixed ?? ownEntry(list, key)?.ability, key });
  // A tool a skill is checked using is no check of its own.
  const named = (!skillKeys.length && !toolKeys.length) ? [{ type: "check", ability: fixed }] : [
    ...skillKeys.map(offered("skill", skills)),
    ...(data.usingTool ? [] : toolKeys).map(offered("tool", tools))
  ];
  const checks = checkOptions(named);
  if ( !checks ) return null;
  const usingTool = usingToolOf(checks, data.usingTool);
  if ( data.hideDC === "true" ) {
    const span = checkSpan(context, { checks, dc: null, usingTool }, label);
    const hidden = challenge(data.dc);
    if ( span && (hidden !== null) ) context.hidden.set(span, hidden);
    return span;
  }
  const before = (el.previousSibling?.nodeType === 3) ? el.previousSibling.data.slice(-24) : "";
  const after = (el.nextSibling?.nodeType === 3) ? el.nextSibling.data.slice(0, 64) : "";
  const spellDC = english() && CHECK_SPELL_DC_AFTER.test(after);
  const dc = challenge(data.dc) ?? challenge(DC_BEFORE.exec(before)?.[1])
    ?? challenge(CHECK_DC_AFTER.exec(after)?.[1]) ?? (spellDC ? spellDCOf(context.actor) : null)
    ?? checkActivityDC(context.relativeTo, checks);
  return checkSpan(context, { checks, dc, usingTool }, label);
}

/**
 * The keys a dnd5e link lists, joined by `|`, as its `data-skill` and `data-tool` have them.
 * @param {string} [value]
 * @returns {string[]}
 */
function splitKeys(value) {
  return String(value ?? "").split("|").filter(Boolean);
}

/**
 * A Foundry inline roll as a span to act on: `[[/r 1d6]]`, rolled when it's clicked, or `[[1d6]]`,
 * rolled as the description was enriched, which keeps its formula and never the Gamemaster's
 * result. One that always comes to the same, such as `[[@prof]]`, one only the Gamemaster or the
 * roller would see, and one that can't be read, are text.
 * @param {HTMLElement} el      Its `a.inline-roll`.
 * @param {object} context
 */
function replaceInlineRoll(el, context) {
  const rolled = el.classList.contains("inline-result");
  const data = rolled ? rolledData(el) : null;
  // Its stored roll is anyone's to write: only a formula that is text is read from it.
  const stored = (typeof data?.formula === "string") ? data.formula : null;
  const formula = rolled ? (stored ?? el.dataset.tooltipText ?? el.getAttribute("title")) : el.dataset.formula;
  const resolved = formula ? resolveFormula(formula, context.rollData) : null;
  // One that comes to the same every time shows what it comes to.
  if ( resolved && deterministic(resolved) ) {
    el.replaceWith(el.textContent);
    return;
  }
  // One labelled with its formula is labelled with the character's numbers in it.
  const text = el.textContent;
  const label = rolled ? rolledLabel(el, data, formula)
    : ((resolved && (text.trim() === formula.trim())) ? resolved : text);
  const open = rolled || !el.dataset.mode || OPEN_ROLLS.has(el.dataset.mode);
  const span = (resolved && open && context.actionable) ? rollSpan(context, resolved, label) : null;
  el.replaceWith(span ?? label);
}

/**
 * The roll a rolled inline roll carries, as Foundry stores it on the link: its data, encoded.
 * @param {HTMLElement} el
 * @returns {object|null}
 */
function rolledData(el) {
  const raw = el.dataset.roll;
  if ( !raw ) return null;
  try {
    const json = raw.trimStart().startsWith("{") ? raw : (globalThis.unescape?.(raw) ?? decodeURIComponent(raw));
    const data = JSON.parse(json);
    return (data && (typeof data === "object")) ? data : null;
  } catch {
    return null;
  }
}

/**
 * What a rolled inline roll is called: its label, without the Gamemaster's result after it, or
 * else its formula.
 * @param {HTMLElement} el
 * @param {object|null} data
 * @param {string|null} formula
 * @returns {string}
 */
function rolledLabel(el, data, formula) {
  const text = el.textContent.trim().slice(0, 200);
  const total = data?.total;
  if ( Number.isFinite(total) ) {
    const suffix = `: ${total}`;
    if ( text.endsWith(suffix) && (text.length > suffix.length) ) return text.slice(0, -suffix.length);
  }
  return String(formula ?? "");
}

/**
 * Replace what dnd5e or Foundry couldn't enrich with its label, or else the words of its
 * configuration a reader would follow, such as the formula of `[[/damage 2d6 fire]]`.
 * @param {HTMLElement} body
 * @param {object} context
 */
function replaceLeftovers(body, context) {
  for ( const node of textNodes(body, context.doc) ) {
    if ( !MAYBE_LEFTOVER.test(node.data) ) continue;
    const text = node.data.replace(LEFTOVER, leftoverLabel);
    if ( text !== node.data ) node.data = text;
  }
}

/**
 * The label of what dnd5e or Foundry couldn't enrich, as a replacement for `LEFTOVER`.
 * @param {string} match
 * @param {string} [command]        Such as "/save", or "lookup".
 * @param {string} [config]
 * @param {string} [label]
 * @param {string} [reference]      What `&Reference[…]` named.
 * @param {string} [referenceLabel]
 * @returns {string}
 */
function leftoverLabel(match, command, config, label, reference, referenceLabel) {
  if ( reference !== undefined ) {
    // &Reference[Frightened apply=false], or &Reference[condition=frightened]
    const words = reference.trim().split(/\s{1,10}/);
    return referenceLabel ?? (plainWords(words) || (words[0]?.split("=")[1] ?? ""));
  }
  if ( label !== undefined ) return label;
  if ( command.toLowerCase() === "lookup" ) return "";
  return plainWords(config.split("#")[0].trim().split(/\s{1,10}/));
}

/**
 * The words of a link's configuration a reader would follow: those that aren't settings.
 * @param {string[]} words
 * @returns {string}
 */
function plainWords(words) {
  return words.filter(word => word && !word.includes("=")).join(" ");
}

/* -------------------------------------------- */
/*  Plain text                                  */
/* -------------------------------------------- */

/**
 * Mark what plain text says the app can act on: saving throws, checks and damage in English, and
 * conditions by name in any language. Only text is read, never inside a link, a heading or a span
 * this made, and each match becomes a span beside the text around it, never HTML.
 * @param {HTMLElement} body
 * @param {object} context
 */
function markPlainText(body, context) {
  const patterns = plainPatterns();
  if ( !patterns.save && !patterns.check && !patterns.damage && !patterns.condition && !patterns.lower ) return;
  for ( const node of textNodes(body, context.doc) ) {
    if ( node.parentElement?.closest(UNMARKED) ) continue;
    const text = node.data;
    let spans;
    try {
      spans = plainSpans(text, patterns, context);
    } catch {
      // Left as it is: what its words name couldn't be read, as of an item written so that nothing
      // here foresaw it.
      continue;
    }
    if ( !spans.length ) continue;
    const parts = [];
    let at = 0;
    for ( const { start, end, span } of spans ) {
      if ( start > at ) parts.push(text.slice(at, start));
      parts.push(span);
      at = end;
    }
    if ( at < text.length ) parts.push(text.slice(at));
    node.replaceWith(...parts);
  }
}

/**
 * The spans a text's plain words make, in order, none overlapping another. Where two matches
 * overlap, a saving throw or check comes before damage, and damage before a condition.
 * @param {string} text
 * @param {object} patterns
 * @param {object} context
 * @returns {{start: number, end: number, span: HTMLElement}[]}
 */
function plainSpans(text, patterns, context) {
  const found = [];
  const add = (rank, pattern, make) => {
    if ( !pattern ) return;
    for ( const match of text.matchAll(pattern) ) {
      found.push({ rank, start: match.index, end: match.index + match[0].length, match, make });
    }
  };
  if ( context.actionable ) {
    add(0, patterns.save, match => plainSave(match, patterns, context));
    add(0, patterns.check, match => plainCheck(match, patterns, context));
    add(1, patterns.damage, match => plainDamage(match, patterns, context));
  }
  add(2, patterns.condition, match => conditionSpan(context, patterns.conditions.get(match[1]), match[1]));
  add(2, patterns.lower, match => inCondition(text, match)
    ? conditionSpan(context, patterns.lowerConditions.get(match[1]), match[1]) : null);
  if ( !found.length ) return [];
  found.sort((a, b) => (a.rank - b.rank) || (a.start - b.start));
  const taken = [];
  for ( const candidate of found ) {
    if ( taken.some(other => (candidate.start < other.end) && (other.start < candidate.end)) ) continue;
    const span = candidate.make(candidate.match);
    if ( span ) taken.push({ start: candidate.start, end: candidate.end, span });
  }
  return taken.sort((a, b) => a.start - b.start);
}

/**
 * Does the text around a lower-case condition's name say something is in it: "is prone", or "the
 * prone condition"? Read from a few characters either side.
 * @param {string} text
 * @param {RegExpMatchArray} match
 * @returns {boolean}
 */
function inCondition(text, match) {
  const end = match.index + match[0].length;
  return IN_CONDITION.test(text.slice(Math.max(0, match.index - 24), match.index))
    || CONDITION_WORD.test(text.slice(end, end + 16));
}

/**
 * Does a saving throw or check in plain text end a list of choices longer than its match, as one
 * of more than six, or with skills the pattern doesn't take: "Charisma (Deception, Intimidation,
 * Performance, or Persuasion) or Wisdom (Animal Handling) check"? Read from a few characters
 * before it, as `inCondition` reads them. Such a one is left as text, rather than offering only
 * the last of the choices its words give.
 * @param {RegExpMatchArray} match
 * @param {object} patterns
 * @returns {boolean}
 */
function inLongerList(match, patterns) {
  return patterns.listed.test(match.input.slice(Math.max(0, match.index - LIST_BEFORE), match.index));
}

/**
 * A saving throw in plain text, "a DC 15 Dexterity saving throw", or a choice, "a Strength,
 * Dexterity, or Constitution saving throw", as a span. Its DC is the one the text gives, or the
 * character's spell save DC if it says so, or the item's.
 * @param {RegExpMatchArray} match
 * @param {object} patterns
 * @param {object} context
 * @returns {HTMLElement|null}
 */
function plainSave(match, patterns, context) {
  const [label, before, listed, after, spell] = match;
  if ( inLongerList(match, patterns) ) return null;
  const named = Array.from(listed.matchAll(patterns.abilityName), ([, name]) => patterns.abilities.get(name.toLowerCase()));
  const abilities = abilityKeys(named);
  if ( !abilities.length ) return null;
  const dc = challenge(before) ?? challenge(after) ?? (spell ? spellDCOf(context.actor) : null)
    ?? activityDC(context.relativeTo, abilities);
  return saveSpan(context, { abilities, dc, concentration: false }, label);
}

/**
 * A check in plain text, "a DC 15 Strength (Athletics) check", "an Intelligence or Wisdom check"
 * or "a Strength, Dexterity, or Constitution check", as a span: an ability check with each ability
 * it names alone, and a skill check with each it names with a skill. Its DC is the one the text
 * gives, or the character's spell save DC if it says so, or the item's.
 * @param {RegExpMatchArray} match
 * @param {object} patterns
 * @param {object} context
 * @returns {HTMLElement|null}
 */
function plainCheck(match, patterns, context) {
  const [label, before, listed, after, spell] = match;
  if ( inLongerList(match, patterns) ) return null;
  const checks = checkOptions(Array.from(listed.matchAll(patterns.option), ([, name, skill]) => {
    const ability = patterns.abilities.get(name.toLowerCase());
    if ( !skill ) return { type: "check", ability };
    return { type: "skill", ability, key: patterns.skills.get(skill.toLowerCase()) };
  }));
  if ( !checks ) return null;
  const dc = challenge(before) ?? challenge(after) ?? (spell ? spellDCOf(context.actor) : null)
    ?? checkActivityDC(context.relativeTo, checks);
  return checkSpan(context, { checks, dc, usingTool: null }, label);
}

/**
 * Damage in plain text, "2d6 fire damage" or "7 (2d6) fire damage", as a span.
 * @param {RegExpMatchArray} match
 * @param {object} patterns
 * @param {object} context
 * @returns {HTMLElement|null}
 */
function plainDamage(match, patterns, context) {
  const [label, , averaged, formula, type] = match;
  const key = type ? patterns.types.get(type.toLowerCase()) : null;
  const dice = (averaged ?? formula).toLowerCase();
  return damageSpan(context, { formulas: [dice], types: [key ?? ""], healing: false }, label);
}

/**
 * The patterns plain text is matched with, for the game's language and dnd5e's labels: saving
 * throws, checks and damage in English, and conditions by name, capitalised as dnd5e names them,
 * in any; in English also in lower case, where the words around say something is in it.
 * @returns {object}
 */
function plainPatterns() {
  const config = CONFIG.DND5E ?? {};
  const isEnglish = english();
  const abilities = labelsOf(config.abilities, "label");
  const skills = labelsOf(config.skills, "label");
  const types = labelsOf(config.damageTypes, "label");
  const conditions = new Map();
  for ( const [key, condition] of Object.entries(config.conditionTypes ?? {}) ) {
    if ( condition?.pseudo ) continue;
    const name = localize(condition?.name ?? condition?.label);
    if ( name && (name.length > 2) ) conditions.set(name, key);
  }
  const key = JSON.stringify([isEnglish, [...abilities], [...skills], [...types], [...conditions]]);
  if ( plain?.key === key ) return plain;
  const lowerConditions = new Map([...conditions].map(([name, id]) => [name.toLowerCase(), id]));
  const ability = alternatives(abilities.keys());
  const skill = alternatives(skills.keys()) || "(?!)";
  const type = alternatives(types.keys()) || "(?!)";
  const dice = `\\d{0,3}d\\d{1,3}(?:${SPACE}[+\\-−]${SPACE}\\d{1,3})?`;
  // "Strength", "Strength or Dexterity", or "Strength, Dexterity, or Constitution": six at most
  const listOf = choice => `${choice}(?:(?:,${GAP}${choice}){0,${MOST_LISTED - 2}},?${GAP}or${GAP}${choice})?`;
  // "DC 15 Strength, Dexterity, or Constitution saving throw (DC 15) against your spell save DC"
  const save = `${START}(?:DC${SPACE}(\\d{1,3})${GAP})?(${listOf(`(?:${ability})`)})`
    + `${GAP}(?:saving${GAP}throw|save)${END}(?:${SPACE}\\(DC${SPACE}(\\d{1,3})\\))?`
    + `(?:${GAP}(against${GAP}your${GAP}spell${GAP}save${GAP}DC)${END})?`;
  // "DC 15 Strength (Athletics) or Dexterity (Acrobatics) check (DC 15) against your spell save DC";
  // never a passive one, "passive Wisdom (Perception)", nor "advantage on Strength checks"
  const option = `(?:${ability})(?:${SPACE}\\(${SPACE}(?:${skill})${SPACE}\\))?`;
  const check = `${START}(?<!passive${GAP})(?:DC${SPACE}(\\d{1,3})${GAP})?(${listOf(option)})`
    + `${GAP}check${END}(?:${SPACE}\\(DC${SPACE}(\\d{1,3})\\))?`
    + `(?:${GAP}(against${GAP}your${GAP}spell${GAP}save${GAP}DC)${END})?`;
  // What a list of choices that goes on before a match ends with: "Strength, ", "Persuasion) or "
  const listed = `(?:${START}(?:${ability})|${START}(?:${skill})${SPACE}\\))`
    + `(?:${SPACE},${SPACE}(?:(?:or|and)${GAP})?|${GAP}(?:or|and)${GAP})$`;
  // "7 (2d6 + 1) fire damage", "1d6 damage"
  const damage = `${START}(?:(\\d{1,4})${SPACE}\\(${SPACE}(${dice})${SPACE}\\)|(${dice}))${END}`
    + `(?:${GAP}(${type}))?${GAP}damage${END}`;
  const named = names => `${START}(${alternatives(names)})${END}`;
  plain = {
    key, abilities, skills, types, conditions, lowerConditions,
    save: (isEnglish && ability) ? new RegExp(save, "giu") : null,
    check: (isEnglish && ability) ? new RegExp(check, "giu") : null,
    // Each choice in a list a saving throw or check matched, and what a longer one ends with.
    abilityName: new RegExp(`${START}(${ability || "(?!)"})${END}`, "giu"),
    option: new RegExp(`${START}(${ability || "(?!)"})(?:${SPACE}\\(${SPACE}(${skill})${SPACE}\\))?`, "giu"),
    listed: new RegExp(listed, "iu"),
    damage: isEnglish ? new RegExp(damage, "giu") : null,
    condition: conditions.size ? new RegExp(named(conditions.keys()), "gu") : null,
    lower: (isEnglish && conditions.size) ? new RegExp(named(lowerConditions.keys()), "gu") : null
  };
  return plain;
}

/**
 * Labels as a pattern's alternatives, longest first, each matched as written.
 * @param {Iterable<string>} labels
 * @returns {string}
 */
function alternatives(labels) {
  return Array.from(labels)
    .sort((a, b) => b.length - a.length)
    .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

/**
 * The keys of one of dnd5e's lists of things by their labels in lower case, as the game's
 * language names them: abilities, skills, or damage types.
 * @param {object} [list]
 * @param {string} field    The field each entry's label is in.
 * @returns {Map<string, string>}
 */
function labelsOf(list, field) {
  const labels = new Map();
  for ( const [key, entry] of Object.entries(list ?? {}) ) {
    const label = localize((typeof entry === "string") ? entry : entry?.[field]);
    if ( label && (label.length > 2) ) labels.set(label.toLowerCase(), key);
  }
  return labels;
}

/* -------------------------------------------- */
/*  Spans                                       */
/* -------------------------------------------- */

/**
 * A span this makes: its class, its data, and its label, text only. One to act on gets its number
 * once the whole description is read; past the most a description may have, none is made.
 * @param {object} context
 * @param {string} kind         Such as "ss-save".
 * @param {Record<string, string|number|null>} data
 * @param {string} label
 * @returns {HTMLElement|null}
 */
function makeSpan(context, kind, data, label) {
  const text = words(String(label ?? ""));
  if ( !text ) return null;
  const condition = kind === "ss-condition";
  if ( condition ? (context.conditions >= MOST_LINKS) : (context.links >= MOST_LINKS) ) return null;
  const span = context.doc.createElement("span");
  span.className = `${kind} ${condition ? "ref" : "roll"}`;
  if ( !condition ) span.setAttribute("data-n", "");
  for ( const [key, value] of Object.entries(data) ) {
    if ( (value !== null) && (value !== undefined) && (value !== "") ) span.setAttribute(`data-${key}`, String(value));
  }
  span.textContent = text;
  context.made.add(span);
  if ( condition ) context.conditions++;
  else context.links++;
  return span;
}

/**
 * A saving throw, or a concentration check, to act on.
 * @param {object} context
 * @param {{abilities: string[], dc: number|null, concentration: boolean}} save
 * @param {string} label
 * @returns {HTMLElement|null}
 */
function saveSpan(context, { abilities, dc, concentration }, label) {
  return makeSpan(context, "ss-save", {
    ability: abilities.join("|"),
    dc,
    type: concentration ? "concentration" : null
  }, label);
}

/**
 * A check to act on: one or a choice of several, each an ability check, or a skill or tool check,
 * with the ability it's made with; and the tool a skill is checked using, if any.
 * @param {object} context
 * @param {{checks: CheckOption[], dc: number|null, usingTool: string|null}} check
 * @param {string} label
 * @returns {HTMLElement|null}
 */
function checkSpan(context, { checks, dc, usingTool }, label) {
  return makeSpan(context, "ss-check", {
    checks: checks.map(checkName).join("|"),
    dc,
    "using-tool": usingTool
  }, label);
}

/**
 * Damage or healing to act on: one or more parts, each a formula with the types it may be. None if
 * any part's formula can't be rolled.
 * @param {object} context
 * @param {{formulas: string[], types: string[], healing: boolean}} damage
 * @param {string} label
 * @returns {HTMLElement|null}
 */
function damageSpan(context, { formulas, types, healing }, label) {
  if ( context.links >= MOST_LINKS ) return null;
  const parts = formulas.map((formula, index) => ({
    formula: resolveFormula(formula, context.rollData),
    types: typeKeys((types[index] ?? "").split("|"))
  }));
  if ( !parts.length || parts.some(part => !part.formula) ) return null;
  return makeSpan(context, "ss-damage", {
    formulas: parts.map(part => part.formula).join("&"),
    types: parts.map(part => part.types.join("|")).join("&"),
    healing: healing ? "true" : null
  }, label);
}

/**
 * A roll to act on.
 * @param {object} context
 * @param {string} formula      Resolved and checked.
 * @param {string} label
 * @returns {HTMLElement|null}
 */
function rollSpan(context, formula, label) {
  return makeSpan(context, "ss-roll", { formula }, label);
}

/**
 * A condition to read about.
 * @param {object} context
 * @param {string} key
 * @param {string} label
 * @returns {HTMLElement|null}
 */
function conditionSpan(context, key, label) {
  return key ? makeSpan(context, "ss-condition", { condition: key }, label) : null;
}

/**
 * Number the spans to act on, in the order they come, noting by its number the DC of each saving
 * throw or check whose author hid it; and take the data of the spans this makes off every other
 * element, and the look of a roll, so nothing else can be taken for one.
 * @param {HTMLElement} body
 * @param {object} context
 */
function numberLinks(body, context) {
  let n = 0;
  for ( const el of body.querySelectorAll("*") ) {
    if ( context.made.has(el) ) {
      if ( !el.hasAttribute("data-n") ) continue;
      if ( context.hidden.has(el) ) context.hiddenDCs?.set(n, context.hidden.get(el));
      el.setAttribute("data-n", String(n++));
      continue;
    }
    for ( const name of LINK_DATA ) el.removeAttribute(`data-${name}`);
    if ( el.classList.contains("roll") ) {
      el.classList.remove("roll");
      if ( !el.classList.length ) el.removeAttribute("class");
    }
  }
}

/* -------------------------------------------- */
/*  Values                                      */
/* -------------------------------------------- */

/**
 * A formula with the character's numbers in it, if it can be rolled and sent: no data left
 * unresolved, only the characters of a formula, and one Foundry can roll.
 * @param {string} formula
 * @param {object} [rollData]
 * @returns {string|null}
 */
function resolveFormula(formula, rollData={}) {
  const Roll = rollClass();
  if ( !Roll || (typeof formula !== "string") || (formula.length > 1000) ) return null;
  let resolved;
  try {
    resolved = words(Roll.replaceFormulaData(formula.trim(), rollData ?? {}).replace(/−/g, "-"));
    if ( !resolved || resolved.includes("@") || !SAFE_FORMULA.test(resolved) ) return null;
    return Roll.validate(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Does a formula always come to the same, with no dice in it? Also true of one that can't be read.
 * @param {string} formula
 * @returns {boolean}
 */
function deterministic(formula) {
  try {
    return new (rollClass())(formula).isDeterministic !== false;
  } catch {
    return true;
  }
}

/**
 * The roll class formulas are read with: dnd5e's, or Foundry's.
 * @returns {typeof Roll|null}
 */
function rollClass() {
  const Roll = globalThis.Roll?.defaultImplementation ?? globalThis.Roll;
  return ((typeof Roll?.replaceFormulaData === "function") && (typeof Roll.validate === "function")) ? Roll : null;
}

/**
 * A DC the app may show: a whole number from 1 to 99.
 * @param {*} value
 * @returns {number|null}
 */
function challenge(value) {
  if ( (value === null) || (value === undefined) || (value === "") ) return null;
  const dc = Number(value);
  return (Number.isInteger(dc) && (dc >= 1) && (dc <= 99)) ? dc : null;
}

/**
 * Abilities by key, as dnd5e has them, each once.
 * @param {(string|undefined)[]} keys
 * @returns {string[]}
 */
function abilityKeys(keys) {
  const abilities = CONFIG.DND5E?.abilities ?? {};
  return Array.from(new Set(keys.filter(key => key && Object.hasOwn(abilities, key))));
}

/**
 * One check a link offers: an ability check, or a skill or tool check, by dnd5e's key.
 * @typedef {object} CheckOption
 * @property {"check"|"skill"|"tool"} type
 * @property {string} ability   The ability it's made with, such as "str".
 * @property {string} [key]     The skill or tool, such as "ath" or "thief"; none for an ability
 *                              check.
 */

/**
 * The checks a link offers, each one dnd5e has, with one of the six abilities the app knows, and
 * each kind of check once, the first it names; or null if it offers none of them, or more than
 * the most a link may offer.
 * @param {{type: string, ability?: string|null, key?: string|null}[]} options
 * @returns {CheckOption[]|null}
 */
function checkOptions(options) {
  const config = CONFIG.DND5E ?? {};
  const known = new Set();
  const checks = [];
  for ( const { type, ability, key } of options ) {
    if ( !CHECK_TYPES.includes(type) || !SIX_ABILITIES.includes(ability) ) continue;
    if ( !Object.hasOwn(config.abilities ?? {}, ability) ) continue;
    if ( (type === "skill") && !(CHECK_KEY.test(key ?? "") && Object.hasOwn(config.skills ?? {}, key)) ) continue;
    if ( (type === "tool") && !isTool(key) ) continue;
    const id = (type === "check") ? `check:${ability}` : `${type}:${key}`;
    if ( known.has(id) ) continue;
    known.add(id);
    checks.push((type === "check") ? { type, ability } : { type, ability, key });
  }
  return (checks.length && (checks.length <= MOST_CHECKS)) ? checks : null;
}

/**
 * A check as a span names it: "check:str", "skill:str:ath" or "tool:dex:thief".
 * @param {CheckOption} check
 * @returns {string}
 */
function checkName({ type, ability, key }) {
  return (type === "check") ? `check:${ability}` : `${type}:${ability}:${key}`;
}

/**
 * The checks a span names, as `checkName` names them, checked again.
 * @param {string} [value]
 * @returns {CheckOption[]|null}
 */
function readChecks(value) {
  const names = String(value ?? "").split("|");
  if ( names.length > MOST_CHECKS ) return null;
  const options = names.map(name => {
    const parts = name.split(":");
    const [type, ability, key] = parts;
    return (parts.length === ((type === "check") ? 2 : 3)) ? { type, ability, key } : null;
  });
  return options.every(Boolean) ? checkOptions(options) : null;
}

/**
 * The tool a link's skill is checked using, if it names one dnd5e has, and offers a skill check to
 * use it with.
 * @param {CheckOption[]} checks
 * @param {string} [key]
 * @returns {string|null}
 */
function usingToolOf(checks, key) {
  return (checks.some(check => check.type === "skill") && isTool(key)) ? key : null;
}

/**
 * Is this a tool dnd5e can roll a check with: one of its tools, or a kind of vehicle?
 * @param {unknown} key
 * @returns {boolean}
 */
function isTool(key) {
  if ( (typeof key !== "string") || !CHECK_KEY.test(key) ) return false;
  const config = CONFIG.DND5E ?? {};
  return Object.hasOwn(config.tools ?? {}, key) || Object.hasOwn(config.vehicleTypes ?? {}, key);
}

/**
 * An entry of one of dnd5e's lists by its key, if it's one of its own, never a name any object
 * answers to.
 * @param {object} list
 * @param {string} key
 * @returns {object|null}
 */
function ownEntry(list, key) {
  return Object.hasOwn(list ?? {}, key) ? list[key] : null;
}

/**
 * Damage or healing types by key, as dnd5e has them, each once.
 * @param {string[]} keys
 * @returns {string[]}
 */
function typeKeys(keys) {
  const damage = CONFIG.DND5E?.damageTypes ?? {};
  const healing = CONFIG.DND5E?.healingTypes ?? {};
  const known = key => key && (Object.hasOwn(damage, key) || Object.hasOwn(healing, key));
  return Array.from(new Set(keys.filter(known)));
}

/**
 * A condition by key, if it is one of dnd5e's the app has rules for: not one dnd5e marks as only
 * like a condition, such as burning or bleeding.
 * @param {string} [key]
 * @returns {string|null}
 */
function conditionKey(key) {
  const condition = key ? CONFIG.DND5E?.conditionTypes?.[key] : null;
  return (condition && Object.hasOwn(CONFIG.DND5E.conditionTypes, key) && !condition.pseudo) ? key : null;
}

/**
 * The condition each page of rules is for: dnd5e's current pages, and those of both rules.
 * @returns {Map<string, string>}
 */
function conditionPages() {
  const pages = new Map();
  for ( const list of [LEGACY_CONDITION_PAGES, CONDITION_PAGES] ) {
    for ( const [key, uuid] of Object.entries(list) ) pages.set(uuid, key);
  }
  for ( const [key, condition] of Object.entries(CONFIG.DND5E?.conditionTypes ?? {}) ) {
    if ( condition?.reference ) pages.set(condition.reference, key);
  }
  return pages;
}

/**
 * The character's spell save DC, for "against your spell save DC".
 * @param {Actor|null} actor
 * @returns {number|null}
 */
function spellDCOf(actor) {
  return challenge(actor?.system?.attributes?.spell?.dc);
}

/**
 * The DC of an item's saving throw for one of these abilities, for text that names the saving
 * throw without one: "make a Wisdom saving throw". An item not identified yet keeps its saving
 * throws to itself.
 * @param {Document} [document]
 * @param {string[]} abilities
 * @returns {number|null}
 */
function activityDC(document, abilities) {
  for ( const activity of saveActivities(document) ) {
    const own = Array.from(activity.save?.ability ?? []);
    if ( abilities.some(ability => own.includes(ability)) ) return challenge(activity.save?.dc?.value);
  }
  return null;
}

/**
 * The DC of an item's check for one of these checks, for text that names the check without one:
 * "make a Strength (Athletics) check". A check activity is for each skill or tool it names, made
 * with the ability it names, or else the skill's or tool's own, as dnd5e makes it; or for an
 * ability check with the ability it names. An item not identified yet keeps its checks to itself.
 * @param {Document} [document]
 * @param {CheckOption[]} checks
 * @returns {number|null}
 */
function checkActivityDC(document, checks) {
  const config = CONFIG.DND5E ?? {};
  for ( const activity of checkActivities(document) ) {
    const ability = activity.check?.ability || null;
    const associated = Array.from(activity.check?.associated ?? []);
    const matches = checks.some(check => {
      if ( check.type === "check" ) return ability === check.ability;
      if ( !associated.includes(check.key) ) return false;
      const own = ownEntry((check.type === "skill") ? config.skills : config.tools, check.key)?.ability;
      return (ability ?? own) === check.ability;
    });
    if ( matches ) return challenge(activity.check?.dc?.value);
  }
  return null;
}

/**
 * An identified item's saving throw activities, as dnd5e has them.
 * @param {Document} [document]
 * @returns {object[]}
 */
export function saveActivities(document) {
  return activitiesOf(document, "save");
}

/**
 * An identified item's check activities, as dnd5e has them.
 * @param {Document} [document]
 * @returns {object[]}
 */
export function checkActivities(document) {
  return activitiesOf(document, "check");
}

/**
 * An identified item's activities of a type, as dnd5e has them.
 * @param {Document} [document]
 * @param {string} type     Such as "save".
 * @returns {object[]}
 */
function activitiesOf(document, type) {
  if ( (document?.documentName !== "Item") || (document.system?.identified === false) ) return [];
  const activities = document.system?.activities;
  if ( !activities ) return [];
  if ( typeof activities.getByType === "function" ) return Array.from(activities.getByType(type) ?? []);
  const all = (typeof activities.values === "function") ? Array.from(activities.values()) : [];
  return all.filter(activity => activity?.type === type);
}

/**
 * The actor a document belongs to: itself, or the actor of the item or effect it's on.
 * @param {Document} [document]
 * @returns {Actor|null}
 */
export function actorOf(document) {
  let current = document;
  for ( let depth = 0; current && (depth < 4); depth++ ) {
    if ( current.documentName === "Actor" ) return current;
    current = current.parent ?? null;
  }
  return document?.actor ?? null;
}

/**
 * The label for one of dnd5e's currency icons in an award: its abbreviation, such as "gp".
 * @param {HTMLElement} el
 * @returns {string}
 */
function currencyLabel(el) {
  const key = Array.from(el.classList).find(name => name !== "currency");
  const currencies = CONFIG.DND5E?.currencies ?? {};
  const currency = (key && Object.hasOwn(currencies, key)) ? currencies[key] : null;
  return localize(currency?.abbreviation) || el.getAttribute("aria-label") || key || "";
}

/**
 * Text with each run of spaces between its words made one, and none around them.
 * @param {string} text
 * @returns {string}
 */
function words(text) {
  return text.split(/\s/).filter(Boolean).join(" ");
}

/**
 * Text in the game's language.
 * @param {string} [key]
 * @returns {string}
 */
function localize(key) {
  if ( !key || (typeof key !== "string") ) return "";
  return game.i18n?.localize?.(key) ?? key;
}

/**
 * Is the game in English, the language the phrases plain text is matched by are in?
 * @returns {boolean}
 */
function english() {
  return game.i18n?.lang === "en";
}

/**
 * The text nodes under an element, in order, collected before any is changed.
 * @param {HTMLElement} root
 * @param {Document} doc
 * @returns {Text[]}
 */
function textNodes(root, doc) {
  const walker = doc.createTreeWalker(root, SHOW_TEXT);
  const nodes = [];
  for ( let node = walker.nextNode(); node; node = walker.nextNode() ) nodes.push(node);
  return nodes;
}

/* -------------------------------------------- */
/*  Finding a link                              */
/* -------------------------------------------- */

/**
 * A link a command names, by the hash of one of the character's descriptions and its number in
 * it: read from the module's own copy of that description, the one it sent, never from the app.
 * @param {Actor} actor
 * @param {string} hash
 * @param {number} n
 * @returns {Promise<{source: object, origin: {name: string, item?: Item, spell?: Item}, link: object}
 *   |{refusal: "gone"|"link"}>}
 *   The description, where it comes from, and the link: a saving throw or concentration check
 *   `{kind, abilities, dc, secret}`; a check `{kind: "check", checks: [{type, ability, key?}], dc,
 *   usingTool?, secret}`, a choice of the checks it offers; either with `hideDC: true` where its
 *   author hid its DC, which is then the one noted as it was sent; damage or healing `{kind:
 *   "damage", parts: [{formula, types}], healing}`; or a roll `{kind: "roll", formula}`. Refused as
 *   "gone" when the character's sheet has no such description now, and as "link" when it has no
 *   such link.
 */
export async function findLink(actor, hash, n) {
  const { characterSheet } = await import("./sheet.mjs");
  const { SheetTexts, hiddenDCsOf, textOf } = await import("./sheet-texts.mjs");
  const texts = new SheetTexts();
  try {
    if ( !characterSheet(actor, texts) ) return { refusal: "gone" };
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read the descriptions of ${actor?.uuid}`, err);
    return { refusal: "gone" };
  }
  const source = texts.sources.get(hash);
  if ( !source ) return { refusal: "gone" };
  if ( source.reference ) return { refusal: "link" };
  const link = readLink(await textOf(hash, source), n);
  if ( !link ) return { refusal: "link" };
  const hidden = (await hiddenDCsOf(hash, source)).get(n);
  if ( (hidden !== undefined) && ["save", "concentration", "check"].includes(link.kind) ) {
    Object.assign(link, { dc: hidden, hideDC: true });
  }
  return { source, origin: originOf(actor, source), link };
}

/**
 * A link to act on in a normalised description, by its number, checked again as it is read.
 * @param {string} html
 * @param {number} n
 * @returns {object|null}   As `findLink` gives it.
 */
export function readLink(html, n) {
  if ( !Number.isInteger(n) || (n < 0) || (n >= MOST_LINKS) || !html ) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.body.querySelector(`span[data-n="${n}"]`);
  if ( !el ) return null;
  const data = el.dataset;
  if ( el.classList.contains("ss-save") ) {
    const concentration = data.type === "concentration";
    const abilities = abilityKeys((data.ability ?? "").split("|"));
    if ( !concentration && !abilities.length ) return null;
    return {
      kind: concentration ? "concentration" : "save",
      abilities,
      dc: challenge(data.dc),
      secret: Boolean(el.closest("section.secret"))
    };
  }
  if ( el.classList.contains("ss-check") ) {
    const checks = readChecks(data.checks);
    if ( !checks ) return null;
    const usingTool = usingToolOf(checks, data.usingTool);
    return {
      kind: "check",
      checks,
      dc: challenge(data.dc),
      ...(usingTool && { usingTool }),
      secret: Boolean(el.closest("section.secret"))
    };
  }
  if ( el.classList.contains("ss-damage") ) {
    const types = (data.types ?? "").split("&");
    const parts = (data.formulas ?? "").split("&").map((formula, index) => ({
      formula: resolveFormula(formula),
      types: typeKeys((types[index] ?? "").split("|"))
    }));
    if ( !parts.length || parts.some(part => !part.formula) ) return null;
    return { kind: "damage", parts, healing: data.healing === "true" };
  }
  if ( el.classList.contains("ss-roll") ) {
    const formula = resolveFormula(data.formula ?? "");
    return formula ? { kind: "roll", formula } : null;
  }
  return null;
}

/**
 * Where a description comes from, by the name players know it by: its item, as an item not
 * identified yet is called; "Spell (Item)" for a spell an item casts, with the item, and the copy of
 * the spell dnd5e keeps for it; the effect; or the character, for their biography.
 * @param {Actor} actor
 * @param {{relativeTo?: Document}} source
 * @returns {{name: string, item?: Item, spell?: Item}}
 */
export function originOf(actor, { relativeTo }) {
  if ( relativeTo?.documentName === "Item" ) {
    const cachedFor = relativeTo.getFlag?.("dnd5e", "cachedFor") ?? relativeTo.flags?.dnd5e?.cachedFor;
    const item = cachedFor ? relativeTo.system?.linkedActivity?.item : null;
    if ( item ) return { name: `${relativeTo.name} (${item.name})`, item, spell: relativeTo };
    return { name: relativeTo.name, item: relativeTo };
  }
  if ( relativeTo && (relativeTo.documentName !== "Actor") && relativeTo.name ) return { name: relativeTo.name };
  return { name: actor.name };
}
