import {
  DISH_DECISIONS_RESENT_FOR, EVENTS, MODULE_ID, MOST_DISH_CHARACTERS, MOST_DISH_LIST, MOST_DISH_RESENDS, MOST_DISH_TEXT,
  SETTINGS
} from "./constants.mjs";
import { canSend, isBridge } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { campaignActors, rosterEntry } from "./characters.mjs";
import { dishReader, dishSystem } from "./command-dishes.mjs";
import { commandActor } from "./creatures.mjs";
import {
  deleteHeld, dishChanges, dishEffectData, dishEffectsOf, durationOf, expireDishEffects, inert, rolledLine, rolledOf
} from "./dish-effects.mjs";
import { send } from "./transport.mjs";

/**
 * A dish's card in Foundry, since module 0.38.0: posted by the bridge, whispered to every Gamemaster,
 * the whole dish in its flags, so that a reload, another Gamemaster or the same command handed over
 * again can act from it. A Gamemaster's client draws its buttons: who ate it, chosen in a dialog from
 * the campaign's characters, or Set aside. Each choice is written to the card's flags, and the bridge
 * tells the app of it, in `dish.applied` or `dish.dismissed`, to an app that takes dishes alone.
 *
 * What the app missed hears of it again: an event lost to failures that might not last 30 seconds
 * later, as other posts are (character-sync.mjs); and after every hello, every decision of the last
 * 30 days, whether or not an earlier send of it was refused. A card deleted undecided is gone from
 * the chat log, so its deletion is kept as a tombstone in a world setting, ids and the Gamemaster's
 * name alone, never the dish, as every user can read a world setting. A decided card deleted keeps a
 * tombstone of its choice too, so the same dish handed over again posts no card, and its event, as
 * the card last said it, for the rest of the session, so a send of it lost meanwhile still goes.
 *
 * The module has no socket, so two Gamemasters serving one dish at once each write the card in turn:
 * each run reads it again and merges by character before it writes, and the bridge adds back anyone
 * holding the dish's effect whom a write left out. Two runs for one character at the same moment
 * could each leave it a dish effect: the bridge keeps the newest.
 */

/**
 * Where the card's template is.
 * @type {string}
 */
const TEMPLATE = `modules/${MODULE_ID}/templates/chat/dish.hbs`;

/**
 * A translation, through game.i18n: its methods read their translations through `this`, so one
 * taken apart from it throws.
 * @param {string} key
 * @returns {string}
 */
const localize = key => game.i18n.localize(key);

/**
 * A translation with its data filled in, through game.i18n, as localize.
 * @param {string} key
 * @param {object} data
 * @returns {string}
 */
const format = (key, data) => game.i18n.format(key, data);

/**
 * The dish cards being served on this client, by its user and the card, so a second click waits for
 * nothing and serves no one twice.
 * @type {Set<string>}
 */
const serving = new Set();

/**
 * The tombstones not yet written, those of a write still on its way among them; the writes, each
 * after the last, so each writes on what the last one stored; and the write, once per burst, as a
 * cleared chat log deletes every card at once.
 * @type {object[]}
 */
let unwritten = [];
let storing = Promise.resolve();
let writeTombstones = () => {};

/**
 * The decisions of the decided cards deleted while this client was the bridge, by card, the newest
 * 50, each as its card last said it: so one lost to a failure that might not last still goes again,
 * its card being gone, and the same dish handed over again is told it. This session's alone: its
 * tombstone keeps no one's name but the Gamemaster's.
 * @type {Map<string, {type: string, data: object}>}
 */
const deletedDecisions = new Map();

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Register the hooks a dish's card and effect need on every client: a change to a card's choice, told
 * to the app by the bridge; a card deleted, kept as a tombstone, and told where it was undecided; world
 * time moving, which ends dish effects on the bridge; and an effect created, after which the bridge
 * keeps one dish effect per character.
 * @returns {void}
 */
export function registerDishHooks() {
  // A write refused keeps its tombstones unwritten, for the next.
  writeTombstones = foundry.utils.debounce(() => { storing = storing.then(storeTombstones).catch(() => null); }, 250);
  Hooks.on("updateChatMessage", (message, changed) => dishChanged(message, changed));
  Hooks.on("deleteChatMessage", (message, _options, userId) => dishDeleted(message, userId));
  Hooks.on("updateWorldTime", () => void expireDishEffects());
  Hooks.on("createActiveEffect", effect => void keepOneDish(effect));
}

/* -------------------------------------------- */
/*  The card                                    */
/* -------------------------------------------- */

/**
 * Post a dish's card: by this client's user, the bridge, a Gamemaster, never a player, whom a whisper
 * would show it to as its author; whispered to every Gamemaster; spoken by the cook's character
 * where it's still the campaign's, else by the cook's name in the cookbook. A create that fails, or
 * that a hook refuses, throws, so the app hands the dish over again.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {Promise<ChatMessage>}
 */
export async function postDishCard(command, campaign) {
  const body = command.dish.body;
  const cook = commandActor(command, campaign)?.actor ?? null;
  const card = await ChatMessage.implementation.create({
    author: game.user.id,
    speaker: cook ? ChatMessage.implementation.getSpeaker({ actor: cook }) : { alias: inert(body.cook.name) },
    whisper: game.users.filter(user => user.isGM).map(user => user.id),
    content: await foundry.applications.handlebars.renderTemplate(TEMPLATE, cardContext(command, cook)),
    flags: { [MODULE_ID]: { dish: {
      command: command.id,
      app: command.id.slice("dish-".length),
      campaignId: campaign.id,
      cookId: cook?.id ?? null,
      queuedAt: command.dish.queuedAt,
      body,
      state: "waiting",
      applied: [],
      decided: null
    } } }
  });
  if ( !card ) throw new Error("The dish's card was not posted");
  return card;
}

/**
 * What the card says, every cookbook string inert, for the template's `{{ }}` to escape: the recipe
 * and its outcome; who cooked it and when it was sent; whose link sent it; the cookbook's words and
 * each ingredient's; what was rolled once, what isn't applied by itself, that a damage bonus is only
 * an attack's and a sense no token's vision; and for a boon or bane, how long it lasts.
 * @param {object} command
 * @param {Actor|null} cook   The cook's character, where it's still the campaign's.
 * @returns {object}
 */
function cardContext(command, cook) {
  const body = command.dish.body;
  const { effect } = body;
  const outcome = body.dish.outcome;
  const notes = [];
  if ( effect ) {
    const mapped = dishChanges(effect.changes);
    notes.push(...mapped.rolled.map(rolled => inert(rolledLine(rolled))));
    notes.push(...mapped.skipped.map(({ type }) => format("SENDINGSTONE.Dish.NotApplied", { type: inert(type) })));
    if ( mapped.changes.some(change => /^system\.bonuses\.\w+\.damage$/.test(change.key)) ) {
      notes.push(localize("SENDINGSTONE.Dish.AttackDamage"));
    }
    if ( mapped.changes.some(change => change.key.startsWith("system.attributes.senses.ranges.")) ) {
      notes.push(localize("SENDINGSTONE.Dish.Vision"));
    }
  }
  return {
    outcome,
    recipe: inert(body.dish.recipe),
    chip: localize(`SENDINGSTONE.Dish.${{ boon: "Boon", bane: "Bane" }[outcome] ?? "Standard"}`),
    cooked: format("SENDINGSTONE.Dish.Cooked", { cook: inert(body.cook.name), when: sentWhen(command.dish.queuedAt) }),
    through: cook ? format("SENDINGSTONE.Dish.Through", { seat: cook.name }) : localize("SENDINGSTONE.Dish.ThroughGone"),
    message: inert(body.message),
    ingredients: (effect?.ingredients ?? []).map(({ name, text }) => ({ name: inert(name), text: inert(text) })),
    notes,
    lasts: effect ? format("SENDINGSTONE.Dish.Lasts", { duration: lasting(effect.duration.seconds) }) : null
  };
}

/**
 * How long ago a dish was sent, in the module's own words, as the card is posted: just now, then in
 * whole minutes, hours or days.
 * @param {number} queuedAt   When the app took it, in ms.
 * @returns {string}
 */
function sentWhen(queuedAt) {
  const seconds = Math.max(0, (Date.now() - queuedAt) / 1000);
  const ago = (count, one, many) => ((count === 1) ? localize(`SENDINGSTONE.Dish.When.${one}`)
    : format(`SENDINGSTONE.Dish.When.${many}`, { count }));
  if ( seconds < 60 ) return localize("SENDINGSTONE.Dish.When.Now");
  if ( seconds < 3600 ) return ago(Math.floor(seconds / 60), "Minute", "Minutes");
  if ( seconds < 86_400 ) return ago(Math.floor(seconds / 3600), "Hour", "Hours");
  return ago(Math.floor(seconds / 86_400), "Day", "Days");
}

/**
 * How long a dish's effect lasts, in words: whole hours as hours, else seconds.
 * @param {number} seconds
 * @returns {string}
 */
function lasting(seconds) {
  const { value, units } = durationOf(seconds);
  if ( units !== "hours" ) return game.i18n.format("SENDINGSTONE.Dish.DurationSeconds", { seconds });
  return (value === 1) ? game.i18n.localize("SENDINGSTONE.Dish.DurationHour")
    : game.i18n.format("SENDINGSTONE.Dish.DurationHours", { hours: value });
}

/* -------------------------------------------- */
/*  The buttons                                 */
/* -------------------------------------------- */

/**
 * Draw a dish card's controls for a Gamemaster, as its state now is, under dnd5e 5, whose paths its
 * effect writes: while it waits, Apply… or, for a standard dish, Who ate it…, and Set aside; once
 * eaten, who ate it, with what each regained or gained, and Apply to others…; once set aside, by
 * whom. A player sees none. The module's own classes, never dnd5e's `.card-buttons`, which dnd5e
 * hides by ownership.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 * @returns {void}
 */
export function renderDishCard(message, html) {
  const flags = message?.flags?.[MODULE_ID]?.dish;
  if ( !flags || !game.user?.isGM || !dishSystem() || (typeof html?.querySelector !== "function") ) return;
  const place = html.querySelector(".sending-stone-dish-actions");
  if ( !place ) return;
  const made = html.ownerDocument;
  const line = (text, className) => Object.assign(made.createElement("p"), { className, textContent: text });
  const button = (label, action, run) => {
    const element = Object.assign(made.createElement("button"), { type: "button", textContent: label });
    element.dataset.action = action;
    element.addEventListener("click", event => {
      event.preventDefault();
      void run(game.messages.get(message.id) ?? message);
    });
    return element;
  };
  const controls = [];
  if ( flags.state === "waiting" ) {
    const standard = flags.body?.dish?.outcome === "standard";
    controls.push(button(localize(standard ? "SENDINGSTONE.Dish.WhoAte" : "SENDINGSTONE.Dish.Apply"), "dishApply", chooseCharacters));
    controls.push(button(localize("SENDINGSTONE.Dish.SetAside"), "dishSetAside", dismissDish));
  } else if ( flags.state === "applied" ) {
    const applied = flags.applied ?? [];
    controls.push(line(format("SENDINGSTONE.Dish.EatenBy", { names: applied.map(entry => entry.name).join(", ") }), "sending-stone-dish-eaten"));
    for ( const entry of applied ) {
      if ( entry.healed > 0 ) controls.push(line(format("SENDINGSTONE.Dish.Healed", { name: entry.name, hp: entry.healed }), "hint"));
      if ( entry.exhaustion > 0 ) {
        controls.push(line(format("SENDINGSTONE.Dish.Exhausted", { name: entry.name, levels: entry.exhaustion }), "hint"));
      }
      if ( (entry.skipped ?? []).some(skip => skip.reason === "immune") ) {
        controls.push(line(format("SENDINGSTONE.Dish.Immune", { name: entry.name }), "hint"));
      }
    }
    controls.push(button(localize("SENDINGSTONE.Dish.ApplyOthers"), "dishApply", chooseCharacters));
  } else if ( flags.state === "dismissed" ) {
    controls.push(line(format("SENDINGSTONE.Dish.SetAsideBy", { name: flags.decided?.name ?? "" }), "sending-stone-dish-dismissed"));
  }
  place.replaceChildren(...controls);
}

/* -------------------------------------------- */
/*  The dialog                                  */
/* -------------------------------------------- */

/**
 * Who a dish may be served to, as the dialog lists them, read from the card as it now is: the
 * campaign's characters, each with its portrait and its players; the cook's ticked; one that has
 * eaten it ticked and fixed, "Already has it", a boon or bane by its effect or the card's list, a
 * standard dish by the card's list; one holding another dish's effect "Replaces" it. A campaign
 * since deleted, or with no characters, says so instead.
 * @param {ChatMessage} message
 * @returns {{rows: object[], notice: string|null}}
 */
export function dishRows(message) {
  const flags = (game.messages.get(message.id) ?? message).getFlag(MODULE_ID, "dish");
  const campaign = getCampaigns().find(({ id }) => id === flags?.campaignId);
  const actors = campaign ? campaignActors(campaign) : [];
  if ( !actors.length ) return { rows: [], notice: game.i18n.localize("SENDINGSTONE.Dish.NoCharacters") };
  const standard = flags.body.dish.outcome === "standard";
  const eaten = new Set((flags.applied ?? []).map(entry => entry.actorId));
  const rows = actors.map(actor => {
    const held = standard ? [] : dishEffectsOf(actor);
    const same = eaten.has(actor.id) || held.some(effect => effect.getFlag(MODULE_ID, "dish")?.id === flags.body.dish.id);
    const other = same ? null : held[0]?.getFlag(MODULE_ID, "dish");
    const note = same ? game.i18n.localize("SENDINGSTONE.Dish.AlreadyHas")
      : (other ? game.i18n.format("SENDINGSTONE.Dish.Replaces", { recipe: other.recipe }) : null);
    return {
      actorId: actor.id, name: actor.name, img: actor.img, owners: rosterEntry(actor).owners.map(owner => owner.name).join(", "),
      ticked: same || (actor.id === flags.cookId), disabled: same, note
    };
  });
  return { rows, notice: null };
}

/**
 * The dialog's content: the dish, then a box for each character, every name escaped and each
 * cookbook string, as the recipe and a replaced dish's, inert first. Pure, so the harness checks it,
 * as it opens no dialog.
 * @param {object} options
 * @param {string} options.recipe
 * @param {{actorId: string, name: string, img: string, owners: string, ticked: boolean, disabled: boolean,
 *   note: string|null}[]} options.rows
 * @param {string|null} [options.notice]
 * @returns {string}
 */
export function dishDialogContent({ recipe, rows, notice=null }) {
  const escape = foundry.utils.escapeHTML;
  const boxes = rows.map(row => `<label class="sending-stone-dish-eater">`
    + `<input type="checkbox" name="actors" value="${escape(row.actorId)}"${row.ticked ? " checked" : ""}${row.disabled ? " disabled" : ""}>`
    + `<img src="${escape(row.img ?? "")}" alt="" width="32" height="32">`
    + `<span class="sending-stone-dish-name">${escape(row.name)}</span>`
    + (row.owners ? `<span class="sending-stone-dish-owners">${escape(row.owners)}</span>` : "")
    + (row.note ? `<span class="sending-stone-dish-note">${escape(inert(row.note))}</span>` : "")
    + "</label>");
  return `<fieldset class="sending-stone-dish-eaters"><legend>${escape(inert(recipe))}</legend>`
    + (notice ? `<p class="hint">${escape(notice)}</p>` : "")
    + boxes.join("")
    + "</fieldset>";
}

/**
 * Ask a Gamemaster who ate a dish, from its card, and serve it to them; or, while it waits, set it
 * aside. Apply needs at least one new tick. A campaign with no one to serve it to says so, offering
 * only Set aside, or nothing once it's decided.
 * @param {ChatMessage} message
 * @returns {Promise<void>}
 */
export async function chooseCharacters(message) {
  const flags = message.getFlag(MODULE_ID, "dish");
  if ( !flags ) return;
  const { rows, notice } = dishRows(message);
  const waiting = flags.state === "waiting";
  if ( !rows.length && !waiting ) {
    ui.notifications.info("SENDINGSTONE.Dish.NoCharacters", { localize: true });
    return;
  }
  const content = document.createElement("div");
  content.innerHTML = dishDialogContent({ recipe: flags.body.dish.recipe, rows, notice });
  const chosen = () => Array.from(content.querySelectorAll('input[name="actors"]:checked:not(:disabled)'), input => input.value);
  const buttons = [];
  if ( rows.length ) {
    buttons.push({ action: "apply", label: localize("SENDINGSTONE.Dish.Confirm"), icon: "fa-solid fa-utensils", default: true, callback: chosen });
  }
  if ( waiting ) buttons.push({ action: "setAside", label: localize("SENDINGSTONE.Dish.SetAside") });
  const result = await new Promise(resolve => {
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: format("SENDINGSTONE.Dish.DialogTitle", { recipe: inert(flags.body.dish.recipe) }) },
      content,
      buttons,
      submit: answer => resolve(answer)
    });
    const sync = () => {
      const apply = dialog.element?.querySelector?.('[data-action="apply"]');
      if ( apply ) apply.disabled = !chosen().length;
    };
    content.addEventListener("change", sync);
    dialog.addEventListener("close", () => resolve(null), { once: true });
    void dialog.render({ force: true }).then(sync);
  });
  if ( result === "setAside" ) await dismissDish(message);
  else if ( Array.isArray(result) && result.length ) await applyDish(message, result);
}

/* -------------------------------------------- */
/*  Serving it                                  */
/* -------------------------------------------- */

/**
 * Who decided, and when: this client's Gamemaster, in real and world time.
 * @returns {{userId: string, name: string, at: string, worldTime: number}}
 */
function decision() {
  return { userId: game.user.id, name: game.user.name, at: new Date().toISOString(), worldTime: game.time.worldTime };
}

/**
 * Serve a dish to these characters, one at a time, as the dialog chose them: a boon or bane replaces
 * each one's earlier dish, its effect deleted first, so a character never holds two, then its own
 * effect, with what it heals and the exhaustion it adds worked out first, so its flags carry them,
 * then those made; a standard dish touches no character, only saying who ate it. One that has eaten
 * it already is skipped. Every character in every run gets the values the card holds, rolled once in
 * the cookbook. One whose steps throw is left out, so Apply to others… may try it again, and named in
 * one notification. The card is written once, with whoever was served merged into its list by
 * character as it now stands, unless no one was.
 * @param {ChatMessage} message
 * @param {string[]} actorIds
 * @returns {Promise<object[]>}   Those served now, as the card lists them.
 */
export async function applyDish(message, actorIds) {
  const key = `${game.user?.id}.${message.id}`;
  if ( serving.has(key) ) return [];
  serving.add(key);
  try {
    return await serveNow(message, actorIds);
  } finally {
    serving.delete(key);
  }
}

/**
 * Serve a dish now: what `applyDish` does, once its card isn't being served on this client already.
 * @param {ChatMessage} message
 * @param {string[]} actorIds
 * @returns {Promise<object[]>}
 */
async function serveNow(message, actorIds) {
  const current = () => game.messages.get(message.id) ?? message;
  const flags = current().getFlag(MODULE_ID, "dish");
  if ( !flags ) return [];
  const body = flags.body;
  const now = game.time.worldTime;
  const served = [];
  const failed = [];
  try {
    for ( const actorId of new Set(actorIds) ) {
      const actor = game.actors.get(actorId);
      if ( !actor ) continue;
      let removed = false;
      try {
        const eaten = (current().getFlag(MODULE_ID, "dish")?.applied ?? []).some(entry => entry.actorId === actor.id);
        if ( eaten ) continue;
        if ( body.effect === null ) {
          served.push({ actorId: actor.id, name: actor.name, effectId: null, replaced: null, healed: 0, exhaustion: 0, skipped: [] });
          continue;
        }
        const prior = dishEffectsOf(actor);
        if ( prior.some(effect => effect.getFlag(MODULE_ID, "dish")?.id === body.dish.id) ) continue;
        const mapped = dishChanges(body.effect.changes, actor);
        const was = prior[0]?.getFlag(MODULE_ID, "dish");
        const replaced = was ? { id: was.id, recipe: was.recipe } : null;
        if ( prior.length ) {
          await deleteHeld(actor, prior.map(effect => effect.id));
          removed = true;
        }
        // Read after the earlier dish is gone: it no longer raises the maximum.
        const hp = actor.system.attributes?.hp ?? {};
        const value = Number.isFinite(hp.value) ? hp.value : 0;
        const effectiveMax = (Number.isFinite(hp.effectiveMax) ? hp.effectiveMax : (hp.max ?? 0)) + mapped.maxHp;
        const healed = (mapped.maxHp > 0) ? Math.max(0, Math.min(mapped.maxHp, effectiveMax - value)) : 0;
        const skipped = [...mapped.skipped];
        let exhaustion = 0;
        let exhausted = null;
        if ( mapped.exhaustion > 0 ) {
          if ( actor.system.traits?.ci?.value?.has?.("exhaustion") ) skipped.push({ type: "exhaustion", reason: "immune" });
          else {
            const level = actor.system.attributes?.exhaustion ?? 0;
            exhausted = Math.min(level + mapped.exhaustion, CONFIG.DND5E.conditionTypes?.exhaustion?.levels ?? 6);
            exhaustion = Math.max(0, exhausted - level);
          }
        }
        const data = dishEffectData(body, {
          app: flags.app, card: message.id, now, changes: mapped.changes, rolled: mapped.rolled, maxHp: mapped.maxHp,
          healed, exhaustion, replaced, skipped
        });
        const effect = await ActiveEffect.implementation.create(
          { ...data, start: ActiveEffect.implementation.getEffectStart() }, { parent: actor });
        if ( !effect ) throw new Error("The dish's effect was not created");
        if ( healed > 0 ) await actor.update({ "system.attributes.hp.value": value + healed });
        if ( exhaustion > 0 ) await actor.update({ "system.attributes.exhaustion": exhausted });
        served.push({ actorId: actor.id, name: actor.name, effectId: effect.id, replaced, healed, exhaustion, skipped });
      } catch (err) {
        console.error(`${MODULE_ID} | Could not serve ${body.dish.recipe} to ${actor.name}`, err);
        failed.push({ name: actor.name, removed });
      }
    }
  } finally {
    if ( served.length ) {
      const card = current();
      const kept = card.getFlag(MODULE_ID, "dish")?.applied ?? [];
      const merged = [
        ...kept.map(entry => served.find(each => each.actorId === entry.actorId) ?? entry),
        ...served.filter(each => !kept.some(entry => entry.actorId === each.actorId))
      ];
      await card.update({
        [`flags.${MODULE_ID}.dish.state`]: "applied",
        [`flags.${MODULE_ID}.dish.applied`]: merged,
        [`flags.${MODULE_ID}.dish.decided`]: decision()
      });
    }
    if ( failed.length ) {
      ui.notifications.error(failed.some(each => each.removed) ? "SENDINGSTONE.Dish.FailedRemoved" : "SENDINGSTONE.Dish.Failed", {
        localize: true, format: { recipe: inert(body.dish.recipe), names: failed.map(each => each.name).join(", ") }
      });
    }
  }
  return served;
}

/**
 * Set a waiting dish aside, from its card: nobody ate it. A decided card is never set aside.
 * @param {ChatMessage} message
 * @returns {Promise<ChatMessage|null>}
 */
export async function dismissDish(message) {
  const card = game.messages.get(message.id) ?? message;
  if ( card.getFlag(MODULE_ID, "dish")?.state !== "waiting" ) return null;
  return card.update({
    [`flags.${MODULE_ID}.dish.state`]: "dismissed",
    [`flags.${MODULE_ID}.dish.decided`]: decision()
  });
}

/**
 * Keep one dish effect per character, on the bridge: two Gamemasters serving one character at the
 * same moment may each have read it before either created, and so each leave it one. The newest
 * stays, by when it was made, then by id; every other goes, one deleted meanwhile being done.
 * @param {ActiveEffect} effect   One just created.
 * @returns {Promise<void>}
 */
async function keepOneDish(effect) {
  if ( !isBridge() || !effect?.getFlag?.(MODULE_ID, "dish") ) return;
  const actor = effect.parent;
  const dishes = dishEffectsOf(actor);
  if ( dishes.length < 2 ) return;
  const made = each => each._stats?.createdTime ?? 0;
  const newer = (a, b) => ((made(a) !== made(b)) ? (made(a) > made(b)) : (String(a.id) > String(b.id)));
  const newest = dishes.reduce((best, each) => (newer(each, best) ? each : best));
  try {
    await deleteHeld(actor, dishes.filter(each => each !== newest).map(each => each.id));
  } catch {
    // Deleted on another client meanwhile: the next dish effect made looks again.
  }
}

/* -------------------------------------------- */
/*  Telling the app                             */
/* -------------------------------------------- */

/**
 * Every string of an event cut to 200 characters, its characters to 200 and each one's skipped
 * changes, and what was rolled, to 100, as the app takes them: actor and user names are bounded
 * nowhere.
 * @param {object} data
 * @returns {object}
 */
function cutEvent(data) {
  const cut = value => {
    if ( typeof value === "string" ) return value.slice(0, MOST_DISH_TEXT);
    if ( Array.isArray(value) ) return value.map(cut);
    if ( value && (typeof value === "object") ) return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, cut(each)]));
    return value;
  };
  const event = cut(data);
  if ( Array.isArray(event.characters) ) {
    event.characters = event.characters.slice(0, MOST_DISH_CHARACTERS)
      .map(entry => ({ ...entry, skipped: Array.isArray(entry?.skipped) ? entry.skipped.slice(0, MOST_DISH_LIST) : [] }));
  }
  if ( Array.isArray(event.rolled) ) event.rolled = event.rolled.slice(0, MOST_DISH_LIST);
  return event;
}

/**
 * Send a dish event: from the bridge alone, and only to an app that takes dishes.
 * @param {string} type   `dish.applied` or `dish.dismissed`.
 * @param {object} data
 * @param {Campaign} campaign
 * @returns {void}
 */
export function sendDishEvent(type, data, campaign) {
  if ( !canSend() || !dishReader(campaign.id) ) return;
  send(type, cutEvent(data), campaign);
}

/**
 * A decided card's event, from its flags: `dish.applied`, with everyone served so far, or
 * `dish.dismissed`, set aside. None for a card that waits.
 * @param {ChatMessage} message
 * @returns {{type: string, data: object}|null}
 */
export function buildDishEvent(message) {
  const flags = message?.flags?.[MODULE_ID]?.dish;
  if ( !flags || !["applied", "dismissed"].includes(flags.state) ) return null;
  const { decided } = flags;
  const base = {
    dish: flags.app, id: flags.body?.dish?.id ?? null, card: message.id,
    by: decided ? { userId: decided.userId, name: decided.name } : null,
    at: decided ? { time: decided.at, worldTime: decided.worldTime } : null
  };
  if ( flags.state === "dismissed" ) return { type: EVENTS.DISH_DISMISSED, data: { ...base, reason: "dismissed" } };
  return {
    type: EVENTS.DISH_APPLIED,
    data: {
      dish: base.dish, id: base.id, card: base.card, outcome: flags.body?.dish?.outcome ?? null,
      characters: flags.applied ?? [], rolled: rolledOf(flags.body?.effect?.changes), by: base.by, at: base.at
    }
  };
}

/**
 * Tell the app again what was decided on a card, if anything was: to its campaign, from the bridge,
 * to an app that takes dishes.
 * @param {ChatMessage} message
 * @returns {void}
 */
export function resendDishDecision(message) {
  const event = buildDishEvent(message);
  const campaign = getCampaigns().find(({ id }) => id === message.flags?.[MODULE_ID]?.dish?.campaignId);
  if ( event && campaign ) sendDishEvent(event.type, event.data, campaign);
}

/**
 * Tell a campaign's app again every decision of the last 30 days, the newest first, at most 50: the
 * decided cards in the chat log and the tombstones of those deleted undecided, whether or not an
 * earlier send of one was refused. After each answered hello, and when the app starts taking dishes
 * in a heartbeat's answer; on the bridge, to an app that takes dishes.
 * @param {Campaign} campaign
 * @returns {void}
 */
export function resendDishDecisions(campaign) {
  if ( !canSend() || !dishReader(campaign.id) ) return;
  const since = Date.now() - DISH_DECISIONS_RESENT_FOR;
  // Every answered hello comes here, so a world with no chat log, as midi-prompts.mjs's releaseHeldCards
  // allows for, sends its tombstones alone.
  const decided = (game.messages?.contents ?? []).filter(message => {
    const flags = message.flags?.[MODULE_ID]?.dish;
    return (flags?.campaignId === campaign.id) && ["applied", "dismissed"].includes(flags.state)
      && (Date.parse(flags.decided?.at) >= since);
  }).map(message => ({ at: Date.parse(message.flags[MODULE_ID].dish.decided.at), event: buildDishEvent(message) }));
  const deleted = tombstones().filter(stone => !stone.state && (stone.campaignId === campaign.id) && (Date.parse(stone.at) >= since))
    .map(stone => ({ at: Date.parse(stone.at), event: { type: EVENTS.DISH_DISMISSED, data: stone.data } }));
  const latest = [...decided, ...deleted].sort((a, b) => b.at - a.at).slice(0, MOST_DISH_RESENDS);
  for ( const { event } of latest ) sendDishEvent(event.type, event.data, campaign);
}

/**
 * Send again a dish event lost to failures that might not last: a deletion's as it was kept, its card
 * being gone; any other's from its card, as it now stands, or, its card deleted since, as the card last
 * said it; none where neither is.
 * @param {string} campaignId
 * @param {string} card
 * @param {object} [data]   The deletion's event, as it was built.
 * @returns {void}
 */
export function resendLostDish(campaignId, card, data) {
  const campaign = getCampaigns().find(({ id }) => id === campaignId);
  if ( !campaign ) return;
  if ( data ) {
    sendDishEvent(EVENTS.DISH_DISMISSED, data, campaign);
    return;
  }
  const message = game.messages.get(card);
  const kept = message ? null : deletedDecisions.get(card);
  if ( message ) resendDishDecision(message);
  else if ( kept ) sendDishEvent(kept.type, kept.data, campaign);
}

/**
 * Tell the app again what a deleted card's tombstone says, as the same dish handed over again asks:
 * its deletion while it waited; or its decision, as its card last said it where this session saw it
 * deleted, else a set aside from the tombstone itself. Nothing for one eaten that this session didn't
 * see deleted: its tombstone doesn't say who ate it.
 * @param {{app: string, campaignId: string, data: object, at: string, state?: string}} stone
 * @param {Campaign} campaign
 * @returns {void}
 */
export function resendTombstone(stone, campaign) {
  const event = deletedDecisions.get(stone.data?.card)
    ?? ((stone.state === "applied") ? null : { type: EVENTS.DISH_DISMISSED, data: stone.data });
  if ( event ) sendDishEvent(event.type, event.data, campaign);
}

/**
 * A change to a card's choice, on every client: on the bridge, `dish.applied` with everyone served so
 * far, first adding back, in one write of its own, anyone of the campaign's holding the dish's effect
 * whom a Gamemaster's write left out; or `dish.dismissed`. Other changes to the card send nothing.
 * @param {ChatMessage} message
 * @param {object} changed
 * @returns {void}
 */
function dishChanged(message, changed) {
  if ( !changed?.flags?.[MODULE_ID]?.dish ) return;
  const flags = message.flags?.[MODULE_ID]?.dish;
  if ( !flags ) return;
  if ( (flags.state === "applied") && isBridge() ) {
    const campaign = getCampaigns().find(({ id }) => id === flags.campaignId);
    const applied = flags.applied ?? [];
    const missing = (campaign ? campaignActors(campaign) : [])
      .filter(actor => !applied.some(entry => entry.actorId === actor.id))
      .flatMap(actor => dishEffectsOf(actor).filter(effect => effect.getFlag(MODULE_ID, "dish")?.app === flags.app)
        .slice(0, 1).map(effect => {
          const { healed = 0, exhaustion = 0, replaced = null, skipped = [] } = effect.getFlag(MODULE_ID, "dish");
          return { actorId: actor.id, name: actor.name, effectId: effect.id, replaced, healed, exhaustion, skipped };
        }));
    if ( missing.length ) {
      void message.update({ [`flags.${MODULE_ID}.dish.applied`]: [...applied, ...missing] });
      return;
    }
  }
  resendDishDecision(message);
}

/**
 * A card deleted, on every client: on the bridge, one still waiting tells the app it's gone, each by
 * itself as a cleared chat log deletes every card, and is kept as a tombstone, as its card can no
 * longer say so. A decided card's deletion says nothing, but its decision is kept.
 * @param {ChatMessage} message
 * @param {string} userId   Who deleted it.
 * @returns {void}
 */
function dishDeleted(message, userId) {
  const flags = message?.flags?.[MODULE_ID]?.dish;
  if ( !flags || !isBridge() ) return;
  if ( flags.state !== "waiting" ) {
    keepDecision(message, flags);
    return;
  }
  const user = game.users.get(userId);
  const data = cutEvent({
    dish: flags.app, id: flags.body?.dish?.id ?? null, card: message.id, reason: "deleted",
    by: user ? { userId: user.id, name: user.name } : null,
    at: { time: new Date().toISOString(), worldTime: game.time.worldTime }
  });
  keepTombstone({ app: flags.app, campaignId: flags.campaignId, data, at: data.at.time });
  const campaign = getCampaigns().find(({ id }) => id === flags.campaignId);
  if ( campaign ) sendDishEvent(EVENTS.DISH_DISMISSED, data, campaign);
}

/* -------------------------------------------- */
/*  Tombstones                                  */
/* -------------------------------------------- */

/**
 * The tombstones of the cards deleted, those not yet written among them: a card deleted undecided's
 * `{app, campaignId, data, at}`, `data` its `dish.dismissed`; and a decided card's, with its `state`,
 * `data` its decision's ids, the Gamemaster's name and the time, a set aside's whole event.
 * @returns {{app: string, campaignId: string, data: object, at: string, state?: string}[]}
 */
function tombstones() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.DISH_TOMBSTONES);
  return [...(Array.isArray(stored) ? stored : []), ...unwritten];
}

/**
 * The tombstone of a dish's deleted card, by the app's row id, if there is one.
 * @param {string} app
 * @returns {{app: string, campaignId: string, data: object, at: string, state?: string}|null}
 */
export function dishTombstone(app) {
  return tombstones().findLast(stone => stone.app === app) ?? null;
}

/**
 * Keep a deleted card's tombstone, written with every other of the same burst.
 * @param {{app: string, campaignId: string, data: object, at: string, state?: string}} stone
 * @returns {void}
 */
function keepTombstone(stone) {
  unwritten.push(stone);
  writeTombstones();
}

/**
 * Keep a decided card's decision once it's deleted, on the bridge, sending nothing: its event as the
 * card last said it, for this session, so a send of it lost meanwhile still goes again; and a
 * tombstone of its choice, its ids, `state`, the Gamemaster's name and the time, never the dish, so the
 * same dish handed over again, after a reload too, posts no card.
 * @param {ChatMessage} message
 * @param {object} flags   Its `flags["sending-stone"].dish`.
 * @returns {void}
 */
function keepDecision(message, flags) {
  const event = buildDishEvent(message);
  if ( !event ) return;
  deletedDecisions.delete(message.id);
  deletedDecisions.set(message.id, event);
  if ( deletedDecisions.size > MOST_DISH_RESENDS ) deletedDecisions.delete(deletedDecisions.keys().next().value);
  const { dish, id, card, by, at } = event.data;
  const data = cutEvent((flags.state === "dismissed") ? event.data : { dish, id, card, by, at });
  keepTombstone({ app: flags.app, campaignId: flags.campaignId, data, at: new Date().toISOString(), state: flags.state });
}

/**
 * Write the tombstones kept, with those stored, keeping only those of the last 30 days, the newest 50
 * of the cards deleted undecided and the newest 50 of those decided, so a log cleared of many decided
 * cards never pushes out a deletion the app must hear of. Those being written count as unwritten until
 * the write lands, as a world setting changes only once the server answers, so the same dish handed
 * over again meanwhile still finds its tombstone; those of a write refused stay so, for the next.
 * @returns {Promise<void>}
 */
async function storeTombstones() {
  const writing = [...unwritten];
  if ( !writing.length ) return;
  const since = Date.now() - DISH_DECISIONS_RESENT_FOR;
  const newest = stones => stones.filter(stone => Date.parse(stone.at) >= since)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MOST_DISH_RESENDS);
  const all = tombstones();
  const list = [...newest(all.filter(stone => !stone.state)), ...newest(all.filter(stone => stone.state))];
  await game.settings.set(MODULE_ID, SETTINGS.DISH_TOMBSTONES, list);
  unwritten = unwritten.filter(stone => !writing.includes(stone));
}
