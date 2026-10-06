import { describeActivity, visibleActivities } from "./sheet-actions.mjs";
import { traitLabel } from "./sheet-details.mjs";
import { effectIdOf, hiddenFromPlayer } from "./sheet-effects.mjs";
import { limitedUses } from "./sheet-features.mjs";
import { combinedMode, finite, localize } from "./sheet-values.mjs";

/**
 * A character's favorites, as dnd5e's sheet shows them under Favorites, and Tidy 5e in its own:
 * first the old-style resources the character has, then what its player made a favorite, in their
 * order. dnd5e keeps those as references: items, activities and effects by relative UUID, skills
 * and tools by their keys, and spell slots by their pool's key.
 *
 * Each favorite names what it refers to by the ids the sheet uses elsewhere, so that the listener
 * can show it as the sheet shows that item, effect, skill or spell slot, and carries what dnd5e
 * shows of it besides. One that refers to nothing any longer, or to what a player doesn't see,
 * such as an item hidden from the sheet or an effect of an item not yet identified, is left out.
 */

/**
 * The character's favorites, in the order dnd5e shows them.
 * @param {Actor} actor
 * @returns {object[]}
 */
export function favoritesOf(actor) {
  const marked = Array.from(actor.system?.favorites ?? [])
    .sort((a, b) => (finite(a?.sort) ?? 0) - (finite(b?.sort) ?? 0));
  return [
    ...resourcesOf(actor),
    ...marked.map(favorite => describeFavorite(actor, favorite)).filter(Boolean)
  ];
}

/* -------------------------------------------- */

/**
 * A favorite, as the listener needs it, or null for one to leave out.
 * @param {Actor} actor
 * @param {{type: string, id: string}} favorite
 * @returns {object|null}
 */
function describeFavorite(actor, { type, id }={}) {
  switch ( type ) {
    case "item": return itemFavorite(actor, resolve(actor, id));
    case "activity": return activityFavorite(actor, resolve(actor, id));
    case "effect": return effectFavorite(actor, resolve(actor, id));
    case "skill": return skillFavorite(actor, id);
    case "tool": return toolFavorite(actor, id);
    case "slots": return slotsFavorite(actor, id);
    default: return null;
  }
}

/**
 * An item made a favorite: its id, by which the sheet lists it among the inventory, spells,
 * features and actions, and what it is.
 * @param {Actor} actor
 * @param {{item?: Item, activity?: Activity, effect?: ActiveEffect}} found
 * @returns {object|null}
 */
function itemFavorite(actor, { item, activity, effect }) {
  if ( !item || activity || effect || hidden(actor, item) ) return null;
  return { type: "item", id: item.id, itemType: item.type, name: item.name, img: item.img ?? null };
}

/**
 * One of an item's activities made a favorite, such as a staff's Cast Fireball: what it does, as
 * an action is described, since the sheet lists each item's actions by one of its activities.
 * @param {Actor} actor
 * @param {{item?: Item, activity?: Activity}} found
 * @returns {object|null}
 */
function activityFavorite(actor, { item, activity }) {
  if ( !item || !activity || hidden(actor, item) ) return null;
  if ( !visibleActivities(item).includes(activity) ) return null;
  return {
    type: "activity",
    id: activity.id,
    itemId: item.id,
    itemType: item.type,
    itemName: item.name,
    name: activity.name || item.name,
    img: activity.img || item.img || null,
    ...describeActivity(item, activity)
  };
}

/**
 * An effect made a favorite: its id, as the sheet lists it among the effects, and whether it's on.
 * @param {Actor} actor
 * @param {{item?: Item, effect?: ActiveEffect}} found
 * @returns {object|null}
 */
function effectFavorite(actor, { item, effect }) {
  if ( !effect || hiddenFromPlayer(effect) || (item && hidden(actor, item)) ) return null;
  return {
    type: "effect",
    id: effectIdOf(effect),
    name: effect.name,
    img: effect.img ?? null,
    disabled: effect.disabled === true,
    suppressed: effect.isSuppressed === true
  };
}

/**
 * A skill made a favorite, by the id the sheet lists it by.
 * @param {Actor} actor
 * @param {string} id   Such as "prc".
 * @returns {object|null}
 */
function skillFavorite(actor, id) {
  if ( !actor.system?.skills?.[id] ) return null;
  return { type: "skill", id, name: localize(CONFIG.DND5E?.skills?.[id]?.label) || id };
}

/**
 * A tool made a favorite: as a skill is described, since the sheet has no tools of its own to
 * refer to.
 * @param {Actor} actor
 * @param {string} id   Such as "thief".
 * @returns {object|null}
 */
function toolFavorite(actor, id) {
  const tool = actor.system?.tools?.[id];
  if ( !tool ) return null;
  return {
    type: "tool",
    id,
    name: traitLabel(id, "tool"),
    ability: tool.ability ?? null,
    total: finite(tool.total) ?? 0,
    passive: finite(tool.passive),
    proficiency: finite(tool.prof?.multiplier) ?? finite(tool.value) ?? 0,
    mode: combinedMode(actor, [`abilities.${tool.ability}.check.roll.mode`, `tools.${id}.roll.mode`])
  };
}

/**
 * A pool of spell slots made a favorite, by the id of its section of the spellbook, with how many
 * are left of how many and the level they cast at.
 * @param {Actor} actor
 * @param {string} id   Such as "spell3" or "pact".
 * @returns {object|null}
 */
function slotsFavorite(actor, id) {
  const slots = actor.system?.spells?.[id];
  if ( !slots ) return null;
  const level = finite(slots.level) || null;
  const method = CONFIG.DND5E?.spellcasting?.[slots.type];
  return {
    type: "slots",
    id,
    name: method?.getLabel?.({ level }) || localize(`DND5E.SpellLevel${level}`) || id,
    value: finite(slots.value) ?? 0,
    max: finite(slots.override) ?? finite(slots.max) ?? 0,
    level
  };
}

/**
 * The old-style resources dnd5e lists first among the favorites: each that's named and has a
 * maximum, with its uses left and when it's recovered.
 * @param {Actor} actor
 * @returns {object[]}
 */
function resourcesOf(actor) {
  return Object.entries(actor.system?.resources ?? {}).flatMap(([id, resource]) => {
    const max = finite(resource?.max);
    if ( !resource?.label || !max ) return [];
    const recovery = [resource.sr && { period: "sr" }, resource.lr && { period: "lr" }].filter(Boolean);
    return [{
      type: "resource",
      id,
      name: resource.label,
      uses: limitedUses({ max, value: finite(resource.value) ?? 0, recovery })
    }];
  });
}

/* -------------------------------------------- */

/**
 * What a favorite's relative UUID refers to on the actor, such as ".Item.abc", ".Item.abc.Activity.def",
 * ".Item.abc.ActiveEffect.ghi" or ".ActiveEffect.ghi".
 * @param {Actor} actor
 * @param {string} uuid
 * @returns {{item?: Item, activity?: Activity, effect?: ActiveEffect}}
 */
function resolve(actor, uuid) {
  const [start, collection, id, embedded, embeddedId, ...rest] = String(uuid ?? "").split(".");
  if ( (start !== "") || rest.length ) return {};
  if ( collection === "ActiveEffect" ) return (embedded === undefined) ? { effect: actor.effects?.get(id) } : {};
  if ( collection !== "Item" ) return {};
  const item = actor.items?.get(id);
  if ( !item ) return {};
  if ( embedded === undefined ) return { item };
  if ( embedded === "Activity" ) return { item, activity: item.system?.activities?.get?.(embeddedId) };
  if ( embedded === "ActiveEffect" ) return { item, effect: item.effects?.get?.(embeddedId) };
  return {};
}

/**
 * Is an item hidden from the character's sheet, as dnd5e 6 hides some?
 * @param {Actor} actor
 * @param {Item} item
 * @returns {boolean}
 */
function hidden(actor, item) {
  return (item.isHidden === true) || (actor.hiddenItems?.has?.(item.id) === true);
}
