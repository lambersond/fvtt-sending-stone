import { MODULE_ID } from "./constants.mjs";
import { canSend } from "./bridge-role.mjs";
import { activeForm, noteFormDeleted, originalOf, transformed } from "./characters.mjs";
import { queueBusy, registerQueueSettled } from "./commands.mjs";
import { postEnding } from "./command-wildshape.mjs";
import {
  dueWhy, ending, endWildShape, formDeleted, leftover, record, rested, returned, switchedOnCharacters
} from "./wild-shape.mjs";

/**
 * Wild Shape's hooks, and the watch that ends each form when it's due, since module 0.40.0.
 *
 * wild-shape.mjs says how a Wild Shape is kept and ended, and holds what the hooks here hand each
 * event to: the record of a transformation, what comes back on a return, the replacement after a
 * Long Rest, a form deleted, and a player's leftover form. The watch is here whole: on the bridge,
 * it ends each form that's due and posts the ending's line in chat, looking as world time moves, as
 * a form or its effects change, when a character's queue of commands settles, and when a client
 * becomes the bridge (bridge.mjs).
 *
 * They're in a file of their own, above wild-shape.mjs, because the watch waits on the command
 * queue (commands.mjs) and posts each ending's line (command-wildshape.mjs), and both of those
 * files are built on wild-shape.mjs: kept there, the watch would have it import the files that
 * import it.
 */

/**
 * Register Wild Shape's hooks: on every client, the record of a transformation, what comes back on a
 * return, the replacement after a Long Rest, and the forms deleted; on the bridge, the endings, the
 * deletion safety net, and a player's leftover forms.
 * @returns {void}
 */
export function registerWildShapeHooks() {
  Hooks.on("dnd5e.transformActorV2", (host, source, data, settings, options) => record(host, source, data, settings, options));
  Hooks.on("dnd5e.revertOriginalForm", (form, options) => returned(form, options));
  Hooks.on("dnd5e.restCompleted", (actor, result) => rested(actor, result));
  Hooks.on("updateWorldTime", () => {
    if ( canSend() ) setTimeout(() => endDueForms(), 0);
  });
  Hooks.on("updateActor", actor => {
    if ( transformed(actor) ) checkSoon(originalOf(actor));
    else leftover(actor);
  });
  for ( const hook of ["createActiveEffect", "updateActiveEffect"] ) {
    Hooks.on(hook, effect => {
      const actor = effect?.parent;
      if ( (actor?.documentName === "Actor") && transformed(actor) ) checkSoon(originalOf(actor));
    });
  }
  Hooks.on("deleteActor", actor => {
    noteFormDeleted(actor);
    formDeleted(actor);
  });
  registerQueueSettled(key => {
    const character = game.actors.get(key);
    if ( character ) endDueForms(character);
  });
}

/**
 * End each due Wild Shape, on the bridge alone: a character's (or every character's) active form
 * alone, where the 2024 rules time it and its campaign's switch is on; never while a command of that
 * character's is on its way, which checks again when it settles.
 * @param {Actor} [character]   Only this one.
 * @returns {void}
 */
export function endDueForms(character) {
  if ( !canSend() ) return;
  const on = switchedOnCharacters();
  const characters = character ? on.filter(each => each.id === character.id) : on;
  for ( const each of characters ) void endIfDue(each);
}

/**
 * End a character's active form where it's due, and say so in chat.
 * @param {Actor} character
 * @returns {Promise<void>}
 */
async function endIfDue(character) {
  if ( queueBusy(character.id) || ending.has(character.id) ) return;
  const form = activeForm(character);
  const record = form?.getFlag(MODULE_ID, "form");
  if ( !form || !Number.isFinite(record?.hours) ) return;
  const why = dueWhy(form, record);
  if ( !why ) return;
  if ( await endWildShape(form, why) ) await postEnding(character, record, why);
}

/**
 * Check a character again once a write is done, on the next tick.
 * @param {Actor|null} character
 * @returns {void}
 */
function checkSoon(character) {
  if ( !character || !canSend() ) return;
  setTimeout(() => endDueForms(character), 0);
}
