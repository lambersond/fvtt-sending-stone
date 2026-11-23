import { MODULE_ID } from "./constants.mjs";
import { isId } from "./command-checks.mjs";
import { given, isKey } from "./command-rolls.mjs";
import { asksOnCard, offeredProfiles, summonLabel } from "./sheet-summon.mjs";

/**
 * Summoning from the app, since 0.54.0: the creature, creature type and size a use names, checked
 * at the level the summon activity is cast at; written on its card where dnd5e's card would ask,
 * which nothing places from the app; and chosen beforehand in dnd5e's own dialog when that card's
 * Summon button is clicked. The Gamemaster places the creature from the card in Foundry, as when a
 * player casts it there, and may change the choice in the dialog.
 *
 * A script of its own beside command-uses.mjs, which casts the activity, for what a summoning alone
 * asks: its check, the flag its card carries, dnd5e's hooks, and the one note kept between a click
 * on a card's Summon button and the dialog it opens.
 */

/**
 * The player's choice of creature for a summon activity's use, as its card notes it, or why the use
 * is refused, spending nothing: it's cast at no one, so any target, or the user, is `"target"`; it
 * must summon something at the level it's cast at, a creature dnd5e offers there that can be found,
 * or dnd5e would spend the slot and post a card with no Summon button, `"creature"`; and the
 * creature, type and size named must be among those offered there, a type or size only where it
 * offers more than one, else `"creature"`, as only a sheet out of date sends. Without `summon` it's
 * cast as dnd5e casts it, nothing chosen beforehand; and where dnd5e's card would ask nothing, as
 * for one creature and no choice, nothing is noted.
 * @param {object} command
 * @param {Activity} activity   The activity used, its item the one the card is of.
 * @param {Activity} scaled     The activity as it's cast, at the level it's cast at.
 * @returns {{refusal: string}|{item: string, activity: string, profile: string, label: string,
 *   type?: string, size?: string}|null}
 */
export function summonChoice(command, activity, scaled) {
  if ( (Array.isArray(command.targets) && command.targets.length) || (command.self === true) ) return { refusal: "target" };
  const offered = offeredProfiles(scaled);
  if ( !offered.length ) return { refusal: "creature" };
  const summon = command.summon;
  if ( (summon === undefined) || (summon === null) ) return null;
  const profile = offered.find(each => each._id === summon.profile);
  if ( !profile ) return { refusal: "creature" };
  if ( !offers(scaled.creatureTypes, summon.type) || !offers(scaled.creatureSizes, summon.size) ) return { refusal: "creature" };
  if ( !asksOnCard(scaled) ) return null;
  return {
    item: activity.item.id,
    activity: activity.id,
    profile: profile._id,
    label: summonLabel(scaled, profile),
    ...(given(summon.type) && { type: summon.type }),
    ...(given(summon.size) && { size: summon.size })
  };
}

/**
 * Does a summon activity offer this creature type or size: none named, or one of more than one?
 * @param {Set<string>|undefined} keys
 * @param {string|undefined|null} key
 * @returns {boolean}
 */
function offers(keys, key) {
  if ( !given(key) ) return true;
  return ((keys?.size ?? 0) > 1) && keys.has(key);
}

/**
 * What a summon activity's card carries of the player's choice, beside the app's own flags: the
 * choice `summonChoice` noted, where it noted one.
 * @param {object} use   What the use is made with.
 * @returns {{summon?: object}}
 */
export function summonFlag(use) {
  return use?.summoning ? { summon: use.summoning } : {};
}

/* -------------------------------------------- */
/*  The card and dnd5e's dialog                 */
/* -------------------------------------------- */

/**
 * The choice of the Summon button last clicked on this client, as its card carries it, for the
 * dialog that click opens to take as it's first drawn: `{item, activity, profile, label, type?,
 * size?}`; null for a card with none, so that a Foundry card's click never takes an app card's
 * choice. Cleared as the dialog takes it, as dnd5e begins to place what it summons, and as the same
 * activity is used by hand in Foundry, whose own dialog it would otherwise fill.
 * @type {object|null}
 */
let clicked = null;

/**
 * A card's choice, as `summonChoice` wrote it, where it can be read: its item, activity and profile
 * ids, its label, and the type and size keys where chosen. Null for anything else.
 * @param {unknown} flag
 * @returns {{item: string, activity: string, profile: string, label: string, type?: string,
 *   size?: string}|null}
 */
function cardChoice(flag) {
  if ( !flag || (typeof flag !== "object") ) return null;
  const { item, activity, profile, label, type, size } = flag;
  if ( !isId(item) || !isId(activity) || !isId(profile) || (typeof label !== "string") || !label ) return null;
  if ( (given(type) && !isKey(type)) || (given(size) && !isKey(size)) ) return null;
  return { item, activity, profile, label, ...(given(type) && { type }), ...(given(size) && { size }) };
}

/**
 * A card's choice, from the message as the chat log holds it now.
 * @param {ChatMessage} message
 * @returns {object|null}
 */
function choiceOf(message) {
  const current = game.messages?.get?.(message?.id) ?? message;
  return cardChoice(current?.flags?.[MODULE_ID]?.summon);
}

/**
 * The words a card's choice is written in: its label, then in brackets its type's and size's, as
 * dnd5e labels them, where chosen, such as "Owl (Fey)" or "Wolf (Beast, Large)".
 * @param {{label: string, type?: string, size?: string}} choice
 * @returns {string}
 */
function choiceWords(choice) {
  const name = (key, table) => (key ? game.i18n.localize(table?.[key]?.label ?? key) : null);
  const kinds = [name(choice.type, CONFIG.DND5E?.creatureTypes), name(choice.size, CONFIG.DND5E?.actorSizes)].filter(Boolean);
  return kinds.length ? `${choice.label} (${kinds.join(", ")})` : choice.label;
}

/**
 * A summon activity's card, as any client draws it (`dnd5e.renderChatMessage`): each Summon button
 * on it noted as clicked, with the card's choice, before dnd5e's own listener, which is the
 * message's and runs as the click bubbles, opens its dialog; and on a card the app cast with a
 * choice, the line that says it, "Chosen on Sending Stone: Owl (Fey)", once, before the card's
 * buttons, or at the end of the card where a viewer is shown none.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 * @returns {void}
 */
export function drawSummonChoice(message, html) {
  if ( typeof html?.querySelectorAll !== "function" ) return;
  const buttons = Array.from(html.querySelectorAll('[data-action="placeSummons"]'));
  for ( const button of buttons ) {
    if ( listening.has(button) ) continue;
    listening.add(button);
    button.addEventListener("click", () => {
      clicked = choiceOf(message);
    });
  }
  const choice = choiceOf(message);
  if ( !choice || html.querySelector(".sending-stone-summon-choice") ) return;
  const line = html.ownerDocument.createElement("p");
  line.className = "sending-stone-summon-choice";
  line.textContent = game.i18n.format("SENDINGSTONE.Roll.SummonChoice", { choice: choiceWords(choice) });
  const row = buttons[0]?.closest(".card-buttons, .icon-row");
  if ( row ) {
    row.before(line);
    return;
  }
  const content = html.querySelector(".message-content");
  (content?.querySelector(".chat-card") ?? content ?? html).append(line);
}

/**
 * The Summon buttons a listener has been added to, so that a card drawn again keeps one.
 * @type {WeakSet<HTMLElement>}
 */
const listening = new WeakSet();

/**
 * dnd5e's summoning dialog, as it's first drawn (`preRenderSummonUsageDialog`), for the card whose
 * Summon button was just clicked here: the player's creature, type and size set on the dialog's
 * own configuration, which dnd5e draws its fields from and places from, as it sets them itself on
 * any change, each only where the dialog offers it at the level the card was cast at. The note is
 * taken whatever it holds; nothing is drawn again. The Gamemaster may change any of them.
 * @param {Application} app
 * @param {object} context
 * @param {object} options
 * @returns {void}
 */
export function preselectSummon(app, context, options) {
  if ( !options?.isFirstRender || !clicked ) return;
  const choice = clicked;
  clicked = null;
  try {
    const activity = app.activity;
    if ( (app.item?.id !== choice.item) || (activity?.id !== choice.activity) ) return;
    const summons = app.config?.summons;
    if ( !summons || (typeof summons !== "object") ) return;
    if ( Array.from(activity.availableProfiles ?? []).some(profile => profile._id === choice.profile) ) {
      summons.profile = choice.profile;
    }
    if ( choice.type && activity.creatureTypes?.has?.(choice.type) ) summons.creatureType = choice.type;
    if ( choice.size && activity.creatureSizes?.has?.(choice.size) ) summons.creatureSize = choice.size;
  } catch (err) {
    console.warn(`${MODULE_ID} | The player's choice of creature couldn't be set in dnd5e's dialog:`, err);
  }
}

/**
 * dnd5e begins to place what a summoning summons (`dnd5e.preSummon`): any note of a click is spent,
 * whether its dialog took it or none was opened. Stops nothing.
 * @returns {void}
 */
export function forgetSummonClick() {
  clicked = null;
}

/**
 * An activity is used (`dnd5e.preUseActivity`): the note of a click is forgotten where it's the very
 * activity noted, used by hand in Foundry, whose own dialog is the only other summoning dialog the
 * note could fill. The app's uses, made with no dialog, and any other activity's leave it. Stops
 * nothing.
 * @param {Activity} activity
 * @param {object} usage
 * @param {object} dialog
 * @returns {void}
 */
export function forgetSummonUse(activity, usage, dialog) {
  if ( !clicked || (dialog?.configure === false) ) return;
  if ( (activity?.item?.id === clicked.item) && (activity?.id === clicked.activity) ) clicked = null;
}

/**
 * Listen for summon activities' cards and dnd5e's summoning dialog, on every client, since 0.54.0.
 * @returns {void}
 */
export function registerSummonHooks() {
  Hooks.on("dnd5e.renderChatMessage", drawSummonChoice);
  Hooks.on("preRenderSummonUsageDialog", preselectSummon);
  Hooks.on("dnd5e.preSummon", forgetSummonClick);
  Hooks.on("dnd5e.preUseActivity", forgetSummonUse);
}
