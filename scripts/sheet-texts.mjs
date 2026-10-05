import { EVENTS, MODULE_ID } from "./constants.mjs";
import { sendLater } from "./transport.mjs";

/**
 * The descriptions on a character's sheet: of its features, its effects and its conditions.
 *
 * They are most of a sheet's size and seldom change, so a sheet refers to each by a hash of where
 * it comes from, and the text itself goes separately in character.texts: once per hello, and
 * after that only when a sheet refers to one the campaign has not been sent. Each is enriched as
 * the character's player would see it in Foundry, links and rolls turned into plain HTML.
 */

/**
 * The most a character.texts payload should hold, in characters of JSON, well within the 1 MB a
 * listener may accept.
 * @type {number}
 */
const CHUNK = 400_000;

/**
 * The longest description sent, in characters. Anything longer is cut short.
 * @type {number}
 */
const LONGEST = 100_000;

/**
 * Enriched descriptions, by hash, for this page load. A hash names the source, so the same source
 * is enriched once, even for campaigns being sent it at the same time.
 * @type {Map<string, Promise<string>>}
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
   * Refer to a description, noting where it comes from.
   * @param {TextSource} source
   * @returns {string|null}   Its hash, or null if there is nothing to describe.
   */
  add(source) {
    const { html, relativeTo, reference } = source;
    if ( !reference && !html?.trim() ) return null;
    // Rolls in a description, such as [[/damage 1d8 + @mod]] or [[/damage]] for an activity's
    // damage, show the character's numbers, so those numbers are part of what it comes from.
    const numbers = html?.includes("[[") ? rollNumbers(relativeTo) : "";
    const hash = textHash(reference ? `ref:${reference}` : `${relativeTo?.uuid ?? ""}\n${numbers}\n${html}`);
    if ( !this.sources.has(hash) ) this.sources.set(hash, source);
    return hash;
  }
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
  for ( const [hash, source] of sources ) {
    if ( !enriched.has(hash) ) enriched.set(hash, enrich(source));
    texts[hash] = await enriched.get(hash);
  }
  return texts;
}

/**
 * A description as the character's player sees it in Foundry: secrets included, since they own
 * the character, and links and rolls enriched.
 * @param {TextSource} source
 * @returns {Promise<string>}
 */
async function enrich({ html, relativeTo, reference }) {
  try {
    if ( reference ) {
      const page = await fromUuid(reference);
      relativeTo = page;
      html = page?.text?.content ?? "";
    }
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const result = await TextEditor.enrichHTML(html, {
      secrets: true,
      relativeTo,
      rollData: relativeTo?.getRollData?.()
    });
    return result.slice(0, LONGEST);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not enrich a description of ${relativeTo?.uuid ?? reference}`, err);
    return (html ?? "").slice(0, LONGEST);
  }
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
 * The numbers a description's rolls may show: the character's level, proficiency and ability
 * modifiers.
 * @param {Document} [document]   The description's document, or an item or effect of the actor.
 * @returns {string}
 */
function rollNumbers(document) {
  const actor = (document?.documentName === "Actor") ? document : document?.actor;
  const system = actor?.system;
  if ( !system ) return "";
  const mods = Object.values(system.abilities ?? {}).map(ability => ability.mod);
  return JSON.stringify([system.details?.level, system.attributes?.prof, mods]);
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
