import { MODULE_ID } from "./constants.mjs";

/**
 * Modules by Sending Stone's own author, and what each adds to it.
 *
 * The settings window lists them with whether each is on in this world, so the Gamemaster can see
 * what a feature needs. Those this module knows of are listed whether or not they're installed;
 * any other module sharing an author with this one is listed while it's installed.
 */

/**
 * The id of Manual Dice, which lets players type in what their physical dice show. Players
 * entering their dice in the Sending Stone app will need it.
 * @type {string}
 */
export const MANUAL_DICE = "manual-dice";

/**
 * The family's modules this one knows of, with the language keys of their title, what each does,
 * and what it unlocks here, if anything.
 * @type {readonly {id: string, title: string, hint: string, unlocks: string|null}[]}
 */
const KNOWN = Object.freeze([
  {
    id: MANUAL_DICE,
    title: "SENDINGSTONE.Modules.ManualDice.Title",
    hint: "SENDINGSTONE.Modules.ManualDice.Hint",
    unlocks: "SENDINGSTONE.Modules.ManualDice.Unlocks"
  },
  {
    id: "combat-focus",
    title: "SENDINGSTONE.Modules.CombatFocus.Title",
    hint: "SENDINGSTONE.Modules.CombatFocus.Hint",
    unlocks: null
  }
]);

/**
 * How a module stands in this world: "active"; "off", active but switched off in its own settings,
 * as Manual Dice is until its Gamemaster enables it; "inactive", installed but not enabled in the
 * world; or "missing", not installed.
 * @param {string} id
 * @returns {"active"|"off"|"inactive"|"missing"}
 */
export function moduleState(id) {
  const module = game.modules.get(id);
  if ( !module ) return "missing";
  if ( !module.active ) return "inactive";
  if ( (id === MANUAL_DICE) && game.settings.settings.has(`${MANUAL_DICE}.enabled`)
    && (game.settings.get(MANUAL_DICE, "enabled") !== true) ) return "off";
  return "active";
}

/**
 * Is Manual Dice on in this world?
 * @returns {boolean}
 */
export function manualDiceEnabled() {
  return moduleState(MANUAL_DICE) === "active";
}

/**
 * The family's modules: those this one knows of, then any other installed module sharing an
 * author with it, by title.
 * @returns {{id: string, title: string, state: string, hint: string|null, unlocks: string|null}[]}
 */
export function familyModules() {
  const authorsOf = module => Array.from(module?.authors ?? [], author => author?.name).filter(Boolean);
  const authors = new Set(authorsOf(game.modules.get(MODULE_ID)));
  const known = KNOWN.map(({ id, title, hint, unlocks }) => ({
    id,
    title: game.modules.get(id)?.title ?? game.i18n.localize(title),
    state: moduleState(id),
    hint: game.i18n.localize(hint),
    unlocks: unlocks ? game.i18n.localize(unlocks) : null
  }));
  const others = game.modules
    .filter(module => (module.id !== MODULE_ID) && !KNOWN.some(({ id }) => id === module.id)
      && authorsOf(module).some(name => authors.has(name)))
    .map(module => ({ id: module.id, title: module.title, state: moduleState(module.id), hint: null, unlocks: null }))
    .sort((a, b) => a.title.localeCompare(b.title, game.i18n.lang));
  return [...known, ...others];
}
