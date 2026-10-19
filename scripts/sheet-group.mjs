import { inventoryOf } from "./sheet-inventory.mjs";

/**
 * A Group actor's sheet, its party sheet, as a campaign's players see it in the app (module
 * 0.30.0): who is in it, by name and portrait alone, what it holds, and its description.
 *
 * Nothing else of any member is sent, not their level, classes or hit points, for anyone. Its
 * descriptions are enriched without secrets and with no links to act on (see SheetTexts), and its
 * items carry nothing to roll or use: it's only looked at. Only the group's own items count, never
 * its primary vehicle's, which dnd5e's sheet can show in their place.
 */

/**
 * The kinds of member a group lists, in the order dnd5e's sheet lists them.
 * @type {readonly string[]}
 */
const MEMBER_TYPES = Object.freeze(["character", "npc", "vehicle"]);

/**
 * A group's sheet.
 * @param {Actor} group
 * @param {SheetTexts} texts    Collects its descriptions: one made without secrets or links to act
 *                              on, `new SheetTexts({ secrets: false, actionable: false })`.
 * @param {Campaign} campaign   The campaign it's for, whose characters its members are marked as.
 * @returns {{members: object[], description: {full: string|null, summary: string|null}, inventory: object}}
 */
export function groupSheet(group, texts, campaign) {
  const description = group.system?.description ?? {};
  return {
    members: membersOf(group, campaign),
    description: {
      full: texts.add({ html: description.full, relativeTo: group }),
      summary: texts.add({ html: description.summary, relativeTo: group })
    },
    inventory: { ...inventoryOf(group, texts, { usable: false }), encumbrance: null, attunement: null }
  };
}

/**
 * A group's members as dnd5e's sheet lists them: characters, then NPCs, then vehicles, each by
 * name, read from what it last prepared. One deleted since, and any other kind of actor, is left
 * out. Each by exactly five keys.
 * @param {Actor} group
 * @param {Campaign} campaign
 * @returns {{id: string, name: string, img: string|null, type: string, character: boolean}[]}
 */
function membersOf(group, campaign) {
  const lang = game.i18n.lang;
  const tokenPortraits = group.flags?.dnd5e?.showTokenPortrait === true;
  return Array.from(group.system?.members ?? [], member => member?.actor)
    .map(actor => (actor?.id ? game.actors.get(actor.id) : null))
    .filter(actor => actor && MEMBER_TYPES.includes(actor.type))
    .sort((a, b) => (MEMBER_TYPES.indexOf(a.type) - MEMBER_TYPES.indexOf(b.type)) || a.name.localeCompare(b.name, lang))
    .map(actor => ({
      id: actor.id,
      name: actor.name,
      img: portraitOf(actor, tokenPortraits),
      type: actor.type,
      character: campaign.characters.has(actor.id)
    }));
}

/**
 * A member's portrait, as dnd5e's group sheet shows it: its token's image where the group shows
 * token portraits, else its own. Never one of a token's random images, which would change the sheet
 * each time it's looked at.
 * @param {Actor} actor
 * @param {boolean} tokenPortraits
 * @returns {string|null}
 */
function portraitOf(actor, tokenPortraits) {
  if ( !tokenPortraits ) return actor.img ?? null;
  const token = actor.isToken ? actor.token : actor.prototypeToken;
  return token?.texture?.src ?? null;
}
