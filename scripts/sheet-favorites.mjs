import { describeActivity, shownActivity } from "./sheet-rolls.mjs";
import { describeTool } from "./sheet-details.mjs";
import { castFrom, hiddenCopy } from "./sheet-spells.mjs";
import { effectIdOf, hiddenFromPlayer } from "./sheet-effects.mjs";
import { listedFeatures } from "./sheet-features.mjs";
import { finite, limitedUses, localize } from "./sheet-values.mjs";

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
 * A resource names the feature it stands for, if any, for the listener to show it as that feature.
 */

/**
 * The character's favorites, in the order dnd5e shows them.
 * @param {Actor} actor
 * @param {SheetTexts} [texts]   Collects the descriptions of the spells its items cast, and under
 *                               dnd5e 6, of its activities.
 * @returns {object[]}
 */
export function favoritesOf(actor, texts) {
  const marked = Array.from(actor.system?.favorites ?? [])
    .sort((a, b) => (finite(a?.sort) ?? 0) - (finite(b?.sort) ?? 0));
  return [
    ...resourcesOf(actor),
    ...marked.map(favorite => describeFavorite(actor, favorite, texts)).filter(Boolean)
  ];
}

/* -------------------------------------------- */

/**
 * A favorite, as the listener needs it, or null for one to leave out.
 * @param {Actor} actor
 * @param {{type: string, id: string}} favorite
 * @param {SheetTexts} [texts]
 * @returns {object|null}
 */
function describeFavorite(actor, { type, id }={}, texts) {
  switch ( type ) {
    case "item": return itemFavorite(actor, resolve(actor, id));
    case "activity": return activityFavorite(actor, resolve(actor, id), texts);
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
 * an action is described, since the sheet lists each item's actions by one of its activities. One
 * that casts a spell from the item opens to the spell's description, and under dnd5e 6 one with a
 * description of its own to that. One of a spell an item casts, while the item can't cast it, as
 * dnd5e's sheet doesn't list it then, is left out: it would do nothing; and so is one its player
 * can't see. A forward the item's own list leaves out as a repeat of another is kept, as made one.
 * @param {Actor} actor
 * @param {{item?: Item, activity?: Activity}} found
 * @param {SheetTexts} [texts]
 * @returns {object|null}
 */
function activityFavorite(actor, { item, activity }, texts) {
  if ( !item || !activity || hidden(actor, item) ) return null;
  if ( castFrom(item)?.usable === false ) return null;
  if ( !shownActivity(activity) ) return null;
  return {
    type: "activity",
    id: activity.id,
    itemId: item.id,
    itemType: item.type,
    itemName: item.name,
    name: activity.name || item.name,
    img: activity.img || item.img || null,
    ...describeActivity(item, activity, texts)
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
 * A tool made a favorite: as the sheet's tools describe it, which favorites before module 0.18.0
 * were the only place for.
 * @param {Actor} actor
 * @param {string} id   Such as "thief".
 * @returns {object|null}
 */
function toolFavorite(actor, id) {
  const tool = actor.system?.tools?.[id];
  if ( !tool ) return null;
  return { type: "tool", ...describeTool(actor, id, tool) };
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
 * maximum, with its uses left and when it's recovered, and the feature it stands for, as
 * `resourceLinks` finds it, or null.
 * @param {Actor} actor
 * @returns {object[]}
 */
function resourcesOf(actor) {
  const linkOf = resourceLinks(actor);
  return Object.entries(actor.system?.resources ?? {}).flatMap(([id, resource]) => {
    const max = finite(resource?.max);
    if ( !resource?.label || !max ) return [];
    const recovery = [resource.sr && { period: "sr" }, resource.lr && { period: "lr" }].filter(Boolean);
    return [{
      type: "resource",
      id,
      name: resource.label,
      uses: limitedUses({ max, value: finite(resource.value) ?? 0, recovery }),
      itemId: linkOf(id, resource.label)
    }];
  });
}

/**
 * Finds the feature each resource stands for, asked of each in the order they're listed, among
 * the features the sheet lists, in its order. A resource's label is what the player or an importer
 * called the feature, so a feature of that name stands for it, preferring one that spends it; or
 * else the only feature that spends it. A pool often has many that spend it, such as Metamagic
 * options or a Battle Master's maneuvers, so two or more of them stand for nothing, and a feature
 * that spends it never wins over one of its name. A feature stands for one resource at most, the
 * first it's found for; a later resource is looked for among the rest.
 * @param {Actor} actor
 * @returns {(key: string, label: string) => string|null}   The feature's id, or null for none.
 */
function resourceLinks(actor) {
  const claimed = new Set();
  let candidates;
  return (key, label) => {
    try {
      candidates ??= listedFeatures(actor);
      const free = candidates.filter(feature => !claimed.has(feature.id));
      const name = foldName(label);
      const named = free.filter(feature => foldName(feature.name) === name);
      const spenders = free.filter(feature => spends(feature, key));
      const link = named.find(feature => spenders.includes(feature)) ?? named[0]
        ?? ((spenders.length === 1) ? spenders[0] : null);
      if ( !link ) return null;
      claimed.add(link.id);
      return link.id;
    } catch {
      // A resource whose feature can't be told stands for none, as a counter of its own.
      return null;
    }
  };
}

/**
 * A name as resources and features are compared by: without case, runs of spacing as one, and
 * typographic apostrophes as plain ones, as "Warden’s Ward" and "Warden's Ward" are one name. The
 * app compares names alike, where a resource doesn't say what it stands for.
 * @param {unknown} name
 * @returns {string}
 */
function foldName(name) {
  return String(name ?? "").normalize("NFKC").replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Does a feature spend a resource through an activity its player sees: one whose consumption
 * targets the resource's value? dnd5e makes such a target of what an item from before activities
 * consumed, as it prepares the item, so this finds those too.
 * @param {Item} item
 * @param {string} key    The resource's, such as "primary".
 * @returns {boolean}
 */
function spends(item, key) {
  return Array.from(item.system?.activities ?? []).filter(shownActivity).some(activity =>
    Array.from(activity.consumption?.targets ?? []).some(target =>
      (target?.type === "attribute") && (target.target === `resources.${key}.value`)));
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
 * Is an item hidden from the character's sheet, as dnd5e 6 hides some, or a spell cast from one?
 * @param {Actor} actor
 * @param {Item} item
 * @returns {boolean}
 */
function hidden(actor, item) {
  return (item.isHidden === true) || (actor.hiddenItems?.has?.(item.id) === true) || hiddenCopy(item);
}
