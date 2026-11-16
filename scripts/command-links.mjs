import { MODULE_ID } from "./constants.mjs";
import { originOf, readLink } from "./sheet-links.mjs";

/**
 * The link a command from the Sending Stone app names, found in its character's descriptions.
 *
 * sheet-links.mjs says what a link is, and reads one from a description by its number. Finding the
 * description takes the character's sheet and its texts (sheet.mjs, sheet-texts.mjs), both built on
 * sheet-links.mjs. So `findLink` is in a file of its own, above all three: in sheet-links.mjs it
 * had that file load the files that import it. It loads those two as it's called, by the two
 * dynamic imports it had there, the module's only two, unchanged: from here they point down, as
 * nothing they load imports this file.
 *
 * It's in no file that calls it either: the harness wraps this file to answer for descriptions it
 * makes up (test/fvtt/texts-hooks.mjs), and a caller in the same file would go round the wrapper.
 */

/**
 * A link a command names, by the hash of one of the character's descriptions and its number in
 * it: read from the module's own copy of that description, the one it sent, never from the app.
 * @param {Actor} actor
 * @param {string} hash
 * @param {number} n
 * @param {object} [options]
 * @param {boolean} [options.secrets]   Was it sent with its secrets?
 * @returns {Promise<{source: object, origin: {name: string, item?: Item, spell?: Item}, link: object}
 *   |{refusal: "gone"|"link"}>}
 *   The description, where it comes from, and the link: a saving throw or concentration check
 *   `{kind, abilities, dc, secret}`; a check `{kind: "check", checks: [{type, ability, key?}], dc,
 *   usingTool?, secret}`, a choice of the checks it offers; either with `hideDC: true` where its
 *   author hid its DC, which is then the one noted as it was sent; damage or healing `{kind:
 *   "damage", parts: [{formula, types}], healing, critical?, activity?}`, with `critical: false`
 *   where it's never a critical hit's, and the activity dnd5e's own link rolls it by, as noted as it
 *   was sent; or a roll `{kind: "roll", formula}`. Refused as "gone" when the character's sheet has
 *   no such description now, and as "link" when it has no such link. Since 0.36.0 a companion's
 *   sent without the Gamemaster's secrets, as one none of its characters' players owns, is read as
 *   it was sent, without them (`secrets: false`).
 */
export async function findLink(actor, hash, n, { secrets=true }={}) {
  const { characterSheet } = await import("./sheet.mjs");
  const { SheetTexts, hiddenDCsOf, linkActivitiesOf, textOf } = await import("./sheet-texts.mjs");
  const texts = new SheetTexts({ secrets });
  try {
    if ( !characterSheet(actor, texts, { secrets }) ) return { refusal: "gone" };
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
  const activity = (link.kind === "damage") ? (await linkActivitiesOf(hash, source)).get(n) : undefined;
  if ( activity ) link.activity = activity;
  return { source, origin: originOf(actor, source), link };
}
