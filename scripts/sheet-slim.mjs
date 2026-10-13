/**
 * The smaller shape a sheet is sent in to an app that expands it, slim format 1: the same sheet,
 * with what the app can put back left out. It imports nothing, so that anything can check it.
 *
 * Two things are left out. An action is mostly the row of its item, spell or feature again, so it
 * goes by reference: its id, `ref`, and only what differs from that row. And a key whose value is
 * the default its kind of row always has, such as a spell's `ritual: false`, is left out, the app
 * adding it back. Nothing else changes, so a sheet expanded is the sheet built, key for key.
 */

/**
 * The slim format built here: constants.mjs' SLIM_SHEETS, which this file can't import.
 * @type {number}
 */
const FORMAT = 1;

/**
 * What an item, spell or feature rolls, which a row has only where it rolls, marked by its
 * `damage`.
 * @type {string[]}
 */
const ROLLS = ["toHit", "attackId", "activity", "attackModes", "ammunition", "save"];

/**
 * The keys left out of each kind of object where they hold these values. Each is always there in
 * the full shape, so one missing is never a doubt.
 * @type {Record<string, Record<string, unknown>>}
 */
const DEFAULTS = {
  spell: {
    img: null, level: 0, school: null, components: null, materials: null, concentration: false, ritual: false,
    activation: null, range: null, duration: null, target: null, prepared: null, uses: null, castFrom: null, text: null
  },
  item: {
    img: null, quantity: 1, weight: null, price: null, equipped: null, attunement: null, attuned: false, uses: null,
    rarity: null, properties: [], identified: true, text: null
  },
  // An empty container's `contents: []` is kept: only its contents that are kept secret are null.
  container: { capacity: null, contents: null },
  feature: {
    img: null, kind: null, requirements: null, activation: null, passive: false, uses: null, text: null
  },
  entry: {
    activation: null, activationType: null, range: null, target: null, uses: null,
    ...Object.fromEntries(ROLLS.map(key => [key, null])), damage: []
  },
  targets: { self: false, area: false, count: null, perLevel: null, affects: null },
  part: { type: null, healing: false }
};

/**
 * The keys a row that rolls has, left out where they hold their default: null, but for
 * `concentration`, false. A row's `damage`, even none, says it rolls, so it's always kept.
 * @type {Record<string, string[]>}
 */
const ROLL_GROUPS = {
  spell: ROLLS,
  item: ["activation", "range", "target", "concentration", ...ROLLS],
  feature: ["range", "target", "concentration", ...ROLLS]
};

/**
 * The keys of an action an app takes from its row, where the action doesn't have its own.
 * @type {string[]}
 */
export const ACTION_KEYS = [
  "name", "img", "type", "activityName", "activation", "activationType", "range", "target", ...ROLLS, "damage",
  "attackArea", "rollFormula", "check", "consumesSlot", "cast", "spellId", "forward", "activities", "uses", "level",
  "castFrom", "concentration", "identified", "consumable", "enchantments", "text"
];

/* -------------------------------------------- */

/**
 * A sheet in slim format 1: a new object, the sheet given left as it is.
 * @param {object} sheet    A sheet as `characterSheet` builds it.
 * @returns {object}
 */
export function slimSheet(sheet) {
  if ( !isObject(sheet) ) return sheet;
  // Copies of what is posted, so that what is compared is what the app is sent.
  const json = JSON.stringify(sheet);
  const full = JSON.parse(json);
  const slim = JSON.parse(json);

  // Actions by reference, against their rows as built.
  const rows = rowsById(full);
  for ( const section of list(slim.actions) ) {
    if ( isObject(section) && Array.isArray(section.actions) ) {
      section.actions = section.actions.map(action => byReference(action, rows.get(action?.id)));
    }
  }

  // Then defaults, in rows, in what they list, and in what actions and activity favorites keep.
  for ( const [row, kind] of rowsOf(slim) ) {
    if ( kind !== "container" ) within(row, leaveOut);
    leaveOut(row, kind, true);
  }
  for ( const section of list(slim.actions) ) {
    for ( const action of list(section?.actions) ) within(action, leaveOut);
  }
  for ( const favorite of list(slim.favorites) ) {
    if ( favorite?.type === "activity" ) within(favorite, leaveOut);
  }
  slim.slim = FORMAT;
  return slim;
}

/* -------------------------------------------- */

/**
 * An action by reference to its row: its id, `ref`, its keys that aren't its row's, or hold
 * something else than its row's, and in `drop` those its row has and it hasn't. An action whose
 * item is listed nowhere else, as a class item Tidy 5e lists, goes whole.
 * @param {unknown} action
 * @param {object} [row]
 * @returns {unknown}
 */
function byReference(action, row) {
  if ( !isObject(action) || !row ) return action;
  const slim = { id: action.id, ref: true };
  for ( const [key, value] of Object.entries(action) ) {
    if ( key === "id" ) continue;
    if ( ACTION_KEYS.includes(key) && Object.hasOwn(row, key) && same(row[key], value) ) continue;
    slim[key] = value;
  }
  const drop = ACTION_KEYS.filter(key => !Object.hasOwn(action, key) && Object.hasOwn(row, key));
  if ( drop.length ) slim.drop = drop;
  return slim;
}

/**
 * Leave out the keys of an object that hold their defaults.
 * @param {object} object
 * @param {string} kind         One of DEFAULTS' kinds.
 * @param {boolean} [row]       Is it a spell's, item's or feature's row, which may roll?
 * @returns {void}
 */
function leaveOut(object, kind, row=false) {
  for ( const [key, value] of Object.entries(DEFAULTS[kind]) ) {
    if ( Object.hasOwn(object, key) && same(object[key], value) ) delete object[key];
  }
  if ( !row || !ROLL_GROUPS[kind] || !Object.hasOwn(object, "damage") ) return;
  for ( const key of ROLL_GROUPS[kind] ) {
    if ( Object.hasOwn(object, key) && same(object[key], rollDefault(key)) ) delete object[key];
  }
}

/**
 * The default of a key a row that rolls has.
 * @param {string} key
 * @returns {null|false}
 */
function rollDefault(key) {
  return (key === "concentration") ? false : null;
}

/**
 * Do something to what a row, an activity entry, an action or an activity favorite holds: whom
 * its use is at, its damage parts, and each activity it lists, and what that holds.
 * @param {object} object
 * @param {(object: object, kind: string) => void} fn
 * @returns {void}
 */
function within(object, fn) {
  if ( !isObject(object) ) return;
  const use = object.activity;
  if ( isObject(use) && isObject(use.targets) ) fn(use.targets, "targets");
  for ( const part of list(object.damage) ) {
    if ( isObject(part) ) fn(part, "part");
  }
  for ( const entry of list(object.activities) ) {
    if ( !isObject(entry) ) continue;
    within(entry, fn);
    fn(entry, "entry");
  }
}

/**
 * The rows of a sheet, each with its kind: its spells, its inventory's items, its containers and
 * everything in them at any depth, and its features. A container is listed as an item, then as a
 * container.
 * @param {object} sheet
 * @returns {Array<[object, string]>}
 */
function rowsOf(sheet) {
  const rows = [];
  const add = (row, kind) => {
    if ( isObject(row) ) rows.push([row, kind]);
  };
  const container = row => {
    if ( !isObject(row) ) return;
    add(row, "item");
    add(row, "container");
    for ( const entry of list(row.contents) ) {
      if ( entry?.type === "container" ) container(entry);
      else add(entry, "item");
    }
  };
  for ( const section of list(sheet.spells) ) list(section?.spells).forEach(row => add(row, "spell"));
  const inventory = isObject(sheet.inventory) ? sheet.inventory : {};
  for ( const section of list(inventory.sections) ) list(section?.items).forEach(row => add(row, "item"));
  list(inventory.containers).forEach(container);
  for ( const section of list(sheet.features) ) list(section?.features).forEach(row => add(row, "feature"));
  return rows;
}

/**
 * The rows an action may refer to, by id: the first with each id, in the order `rowsOf` lists them.
 * @param {object} sheet
 * @returns {Map<unknown, object>}
 */
function rowsById(sheet) {
  const rows = new Map();
  for ( const [row, kind] of rowsOf(sheet) ) {
    if ( (kind !== "container") && !rows.has(row.id) ) rows.set(row.id, row);
  }
  return rows;
}

/* -------------------------------------------- */

/**
 * Are two values parsed from JSON the same, whatever the order of their keys?
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function same(a, b) {
  if ( a === b ) return true;
  if ( !a || !b || (typeof a !== "object") || (typeof b !== "object") ) return false;
  if ( Array.isArray(a) !== Array.isArray(b) ) return false;
  if ( Array.isArray(a) ) return (a.length === b.length) && a.every((value, i) => same(value, b[i]));
  const keys = Object.keys(a);
  return (keys.length === Object.keys(b).length) && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}

/**
 * Is this a plain object, rather than null or an array?
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return (value !== null) && (typeof value === "object") && !Array.isArray(value);
}

/**
 * An array, or none for anything else.
 * @param {unknown} value
 * @returns {unknown[]}
 */
function list(value) {
  return Array.isArray(value) ? value : [];
}
