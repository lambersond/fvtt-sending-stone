import { EVENTS, MODULE_ID } from "./constants.mjs";
import { actorOf, checkActivities, cleanLinks, cutShort, normaliseLinks, saveActivities } from "./sheet-links.mjs";
import { sendLater } from "./transport.mjs";

/**
 * The descriptions on a character's sheet: of its features, its effects and its conditions.
 *
 * They are most of a sheet's size and seldom change, so a sheet refers to each by a hash of where
 * it comes from, and the text itself goes separately in character.texts: once per hello, and
 * after that only when a sheet refers to one the campaign has not been sent. Each is enriched as
 * the character's player would see it in Foundry, links and rolls turned into plain HTML, and
 * those the app can act on into its own spans (see sheet-links.mjs).
 */

/**
 * The markup descriptions are sent in, part of every hash: raising it sends every description
 * again under a new hash, so nothing the app or a browser keeps under an old one is shown.
 * 1, before it was part of the hash: as Foundry enriched them. 2: with the spans of
 * sheet-links.mjs, since 0.17.0. 3: with their checks, `ss-check`, since 0.18.0.
 * @type {number}
 */
const TEXT_FORMAT = 3;

/**
 * The most a character.texts payload should hold, in characters of JSON, well within the 1 MB a
 * listener may accept.
 * @type {number}
 */
const CHUNK = 400_000;

/**
 * What a description's text says that makes it show the character's numbers: a roll or link,
 * which shows their modifiers; their spell save DC; a saving throw or a check, which may show the
 * DC of the item's; damage of the item's activities.
 * @type {RegExp}
 */
const ROLLS = /\[\[/;
const SPELL_DC = /spell\s{1,4}save\s{1,4}DC/i;
const SAVES = /sav(?:e|ing)/i;
const CHECKS = /check|\[\[\/(?:skill|tool)/i;
const DAMAGE = /\[\[\/(?:damage|heal)/i;

/**
 * Enriched descriptions, by hash, for this page load: the very text sent, which commands from the
 * app read their links from, and the DCs its authors hid of its saving throws, by link number,
 * which are never sent. A hash names the source, so the same source is enriched once, even for
 * campaigns being sent it at the same time.
 * @type {Map<string, {text: Promise<string>, hiddenDCs: Promise<Map<number, number>>}>}
 */
const enriched = new Map();

/**
 * The hashes of the descriptions each campaign has been sent since its last hello, by campaign id.
 * @type {Map<string, Set<string>>}
 */
const sent = new Map();

/* -------------------------------------------- */

/**
 * Where a description comes from: HTML, enriched relative to a document, or the text of a
 * journal page such as a condition's rules reference.
 * @typedef {object} TextSource
 * @property {string} [html]            The description's HTML, as stored.
 * @property {Document} [relativeTo]    The document it belongs to, for its links and roll data.
 * @property {string} [reference]       The UUID of a journal page whose text it is, instead.
 */

/**
 * The descriptions a set of sheets refers to, collected as they are described.
 */
export class SheetTexts {
  /**
   * Sources by hash.
   * @type {Map<string, TextSource>}
   */
  sources = new Map();

  /**
   * The format descriptions are sent in, with the rules and language they are enriched in.
   * @type {string|null}
   */
  #format = null;

  /**
   * Refer to a description, noting where it comes from.
   *
   * Its hash is of everything what is sent depends on: the format it's sent in, the rules and
   * language, where it comes from and its HTML, and what it shows of the character's numbers. A
   * change to any of them is a new description, sent anew.
   * @param {TextSource} source
   * @returns {string|null}   Its hash, or null if there is nothing to describe.
   */
  add(source) {
    const { html, relativeTo, reference } = source;
    if ( !reference && !html?.trim() ) return null;
    this.#format ??= textFormat();
    const from = reference ? `ref:${reference}`
      : `${relativeTo?.uuid ?? ""}\n${numbersShown(html, relativeTo)}\n${html}`;
    const hash = textHash(`${this.#format}\n${from}`);
    if ( !this.sources.has(hash) ) this.sources.set(hash, source);
    return hash;
  }
}

/**
 * A description as it was sent, by its hash, enriching it if it hasn't been yet this page load:
 * the very text the app was sent, for a command to read a link from.
 * @param {string} hash
 * @param {TextSource} source
 * @returns {Promise<string>}
 */
export function textOf(hash, source) {
  return enrichedOf(hash, source).text;
}

/**
 * The DCs of a description's saving throws whose authors hid them, by link number, as it was sent
 * without them: for the module to roll them against, as dnd5e does.
 * @param {string} hash
 * @param {TextSource} source
 * @returns {Promise<Map<number, number>>}
 */
export function hiddenDCsOf(hash, source) {
  return enrichedOf(hash, source).hiddenDCs;
}

/**
 * A description enriched, by its hash, enriching it if it hasn't been yet this page load.
 * @param {string} hash
 * @param {TextSource} source
 * @returns {{text: Promise<string>, hiddenDCs: Promise<Map<number, number>>}}
 */
function enrichedOf(hash, source) {
  if ( !enriched.has(hash) ) {
    const done = enrich(source);
    enriched.set(hash, { text: done.then(({ html }) => html), hiddenDCs: done.then(({ hiddenDCs }) => hiddenDCs) });
  }
  return enriched.get(hash);
}

/* -------------------------------------------- */

/**
 * Note that a campaign was sent these descriptions with its hello, replacing what it was sent
 * before.
 * @param {Campaign} campaign
 * @param {Iterable<string>} hashes
 * @returns {void}
 */
export function noteTextsSent(campaign, hashes) {
  sent.set(campaign.id, new Set(hashes));
}

/**
 * The descriptions a campaign has not been sent, noting them as sent.
 * @param {Campaign} campaign
 * @param {SheetTexts} texts
 * @returns {Map<string, TextSource>}
 */
export function takeUnsent(campaign, texts) {
  const known = sent.get(campaign.id) ?? new Set();
  sent.set(campaign.id, known);
  const unsent = new Map();
  for ( const [hash, source] of texts.sources ) {
    if ( known.has(hash) ) continue;
    known.add(hash);
    unsent.set(hash, source);
  }
  return unsent;
}

/**
 * Send a campaign descriptions in character.texts, ahead of anything queued after them.
 * @param {Campaign} campaign
 * @param {Map<string, TextSource>} sources
 * @returns {void}
 */
export function sendTexts(campaign, sources) {
  if ( !sources.size ) return;
  sendLater(EVENTS.CHARACTER_TEXTS, async () => chunk(await render(sources)), campaign);
}

/* -------------------------------------------- */

/**
 * Enrich descriptions, reusing any enriched before.
 * @param {Map<string, TextSource>} sources
 * @returns {Promise<Record<string, string>>}   HTML by hash.
 */
async function render(sources) {
  const texts = {};
  for ( const [hash, source] of sources ) texts[hash] = await textOf(hash, source);
  return texts;
}

/**
 * A description as the character's player sees it in Foundry: secrets included, since they own
 * the character, and links and rolls enriched, with the roll data of the document it's on, or of
 * the actor an effect is on. Then its links are made the app's, and it is cut to the longest sent.
 *
 * It never fails, so it can't cost a hello its descriptions: a description that can't be enriched
 * is read as it's stored, one whose links can't be read has them cleaned up by string alone, and
 * failing that it goes as it is.
 * @param {TextSource} source
 * @returns {Promise<{html: string, hiddenDCs: Map<number, number>}>}   The HTML sent, and the DCs
 *   its authors hid, by link number.
 */
async function enrich({ html, relativeTo, reference }) {
  let text = html ?? "";
  let rollData;
  let result = null;
  try {
    if ( reference ) {
      const page = await fromUuid(reference);
      relativeTo = page;
      text = page?.text?.content ?? "";
    }
    rollData = rollDataOf(relativeTo);
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    result = await TextEditor.enrichHTML(text, { secrets: true, relativeTo, rollData });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not enrich a description of ${relativeTo?.uuid ?? reference}`, err);
  }
  const enrichedText = (typeof result === "string") ? result : ((typeof text === "string") ? text : "");
  try {
    const hiddenDCs = new Map();
    const normalised = normaliseLinks(enrichedText, { relativeTo, rollData, actionable: !reference, hiddenDCs });
    return { html: cutShort(normalised), hiddenDCs };
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read the links of a description of ${relativeTo?.uuid ?? reference}`, err);
  }
  try {
    return { html: cutShort(cleanLinks(enrichedText)), hiddenDCs: new Map() };
  } catch {
    return { html: cutShort(enrichedText), hiddenDCs: new Map() };
  }
}

/**
 * The roll data a description's rolls are resolved with: its document's, or for an effect, which
 * has none, the item's or actor's it's on.
 * @param {Document} [document]
 * @returns {object|undefined}
 */
function rollDataOf(document) {
  let current = document;
  for ( let depth = 0; current && (depth < 4); depth++ ) {
    if ( typeof current.getRollData === "function" ) return current.getRollData();
    current = current.parent ?? null;
  }
  return undefined;
}

/**
 * Split descriptions into payloads small enough to post.
 * @param {Record<string, string>} texts
 * @returns {{texts: Record<string, string>}[]}
 */
function chunk(texts) {
  const payloads = [];
  let current = {};
  let size = 0;
  for ( const [hash, html] of Object.entries(texts) ) {
    const length = hash.length + JSON.stringify(html).length + 4;
    if ( size && (size + length > CHUNK) ) {
      payloads.push({ texts: current });
      current = {};
      size = 0;
    }
    current[hash] = html;
    size += length;
  }
  if ( size ) payloads.push({ texts: current });
  return payloads;
}

/* -------------------------------------------- */

/**
 * The format descriptions are sent in, and what they are enriched in that every one shows: the
 * rules, which name conditions' pages and damage types, and the game's language, which labels
 * everything and decides whether plain text is read.
 * @returns {string}
 */
function textFormat() {
  let rules = "";
  try {
    rules = game.settings.get("dnd5e", "rulesVersion") ?? "";
  } catch {
    rules = "";
  }
  return `format:${TEXT_FORMAT}\nrules:${rules}\nlang:${game.i18n?.lang ?? ""}`;
}

/**
 * What a description shows of the character's numbers, by what its text says: a roll shows their
 * level, proficiency, ability modifiers and spell save DC; "your spell save DC", that DC; a saving
 * throw, the DCs of the item's saving throws, which one with no DC of its own takes; a check, as
 * dnd5e's `[[/check]]` and its skill and tool links, those of the item's checks, which dnd5e's
 * `[[/check]]` shows, and one with no DC of its own takes; and dnd5e's damage links, the damage of
 * the item's activities. An effect's are its actor's.
 * @param {string} html
 * @param {Document} [document]   The description's document.
 * @returns {string}
 */
function numbersShown(html, document) {
  const actor = actorOf(document);
  const shown = [];
  if ( ROLLS.test(html) ) shown.push(rollNumbers(actor));
  else if ( SPELL_DC.test(html) ) shown.push(JSON.stringify([actor?.system?.attributes?.spell?.dc ?? null]));
  if ( SAVES.test(html) ) shown.push(saveNumbers(document));
  if ( CHECKS.test(html) ) shown.push(checkNumbers(document));
  if ( DAMAGE.test(html) ) shown.push(damageNumbers(document));
  return shown.join("\n");
}

/**
 * The numbers a description's rolls may show: the character's level, proficiency, ability
 * modifiers and spell save DC.
 * @param {Actor|null} actor
 * @returns {string}
 */
function rollNumbers(actor) {
  const system = actor?.system;
  if ( !system ) return "";
  const mods = Object.values(system.abilities ?? {}).map(ability => ability.mod);
  return JSON.stringify([system.details?.level, system.attributes?.prof, mods, system.attributes?.spell?.dc ?? null]);
}

/**
 * The abilities and DCs of an identified item's saving throws.
 * @param {Document} [document]
 * @returns {string}
 */
function saveNumbers(document) {
  const saves = saveActivities(document)
    .map(activity => [Array.from(activity.save?.ability ?? []).sort(), activity.save?.dc?.value ?? null]);
  return saves.length ? JSON.stringify(saves) : "";
}

/**
 * The abilities, skills and tools, and DCs of an identified item's checks.
 * @param {Document} [document]
 * @returns {string}
 */
function checkNumbers(document) {
  const checks = checkActivities(document).map(({ check }) => [
    check?.ability ?? null, Array.from(check?.associated ?? []).sort(), check?.dc?.value ?? null
  ]);
  return checks.length ? JSON.stringify(checks) : "";
}

/**
 * The damage and healing of an identified item and its activities, as stored, which dnd5e's
 * `[[/damage]]` links show.
 * @param {Document} [document]
 * @returns {string}
 */
function damageNumbers(document) {
  if ( (document?.documentName !== "Item") || (document.system?.identified === false) ) return "";
  const system = document._source?.system;
  if ( !system ) return "";
  const activities = Object.values(system.activities ?? {}).map(activity => [
    activity?._id ?? null, activity?.type ?? null, activity?.damage ?? null, activity?.healing ?? null
  ]);
  return JSON.stringify([system.damage ?? null, system.magicalBonus ?? null, activities]);
}

/**
 * A short hash of a string: 53 bits as hexadecimal, from cyrb53. Enough to tell a campaign's few
 * thousand descriptions apart.
 * @param {string} string
 * @returns {string}
 */
export function textHash(string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for ( let i = 0; i < string.length; i++ ) {
    const code = string.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
