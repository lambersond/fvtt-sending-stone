import { MODULE_ID, ROLL_TAG } from "./constants.mjs";
import { askFlavor } from "./chat-data.mjs";
import { authorFor, checkCommand, describeResult, failedResult, PUBLIC } from "./command-rolls.mjs";
import { damageRollsFor, diceStatus, matchesDice, plannedDice, withPlan } from "./dice-plan.mjs";
import { findLink } from "./sheet-links.mjs";

/**
 * Acting from the Sending Stone app on the links in a character's descriptions: asking the table
 * for the saving throw a description calls for, on dnd5e's own roll request card; and rolling a
 * description's damage, healing or other roll with the player's dice, on a card naming where it
 * comes from.
 *
 * A command names a link by its description's hash and the link's number in it, and the link is
 * read from the description as this module sent it, from the character's sheet as it is now. So a
 * player never sends a formula or a DC of their own: only what a description on their sheet says,
 * as its owner may write it, as in Foundry.
 */

/**
 * How long a character waits after asking the table before asking again, in milliseconds.
 * @type {number}
 */
const ASK_EVERY = 10_000;

/**
 * How long the same link waits after being asked before it can be asked again, in milliseconds.
 * @type {number}
 */
const ASK_AGAIN = 30_000;

/**
 * When each character last asked the table, by actor id, and when each link was last asked, by
 * actor id, hash and number, in milliseconds.
 * @type {Map<string, number>}
 */
const asked = new Map();

/* -------------------------------------------- */

/**
 * What a campaign's players can do from the app with the links in their descriptions, for its
 * hello, where its players' rolls are made here, under dnd5e 5.x: roll a description's own roll,
 * such as a d4 of luck, always; ask the table for a saving throw, where dnd5e's roll request card
 * can be made; and roll a description's damage or healing where the Gamemaster lets the campaign's
 * players attack, and damage takes their dice, as the self-test found. None under dnd5e 6.
 * @param {Campaign} campaign
 * @returns {string[]}
 */
export function textKinds(campaign) {
  if ( !textsOffered() ) return [];
  return [
    ...(asksOffered() ? ["ask"] : []),
    "textRoll",
    ...((campaign.attacks && diceStatus.attacks) ? ["textDamage"] : [])
  ];
}

/**
 * Are a description's rolls made here? Under dnd5e 5.x, whose messages they're posted as; not yet
 * under dnd5e 6, whose damage, healing and requests are messages of kinds of their own: posted as
 * dnd5e 5 posts it, a description's damage would have no tray there to apply it from.
 * @returns {boolean}
 */
function textsOffered() {
  if ( game.system.id !== "dnd5e" ) return false;
  return Number.parseInt(String(game.system.version ?? "")) < 6;
}

/**
 * Can the table be asked for a saving throw here, on dnd5e's roll request card? Under dnd5e 5.x,
 * which has its template and labels; not yet under dnd5e 6, whose requests are messages of their
 * own kind.
 * @returns {boolean}
 */
export function asksOffered() {
  return textsOffered() && (typeof globalThis.dnd5e?.enrichers?.createRollLabel === "function");
}

/* -------------------------------------------- */
/*  Asking the table                            */
/* -------------------------------------------- */

/**
 * Ask the table for the saving throw a description on a character's sheet calls for: post dnd5e's
 * roll request card for it, from the character, naming where it comes from, as the Gamemaster
 * could from the description. It prompts no one: it's for the Gamemaster, who rolls it for the
 * creatures it names, and anyone in Foundry may click it. Refused while the campaign doesn't take
 * its players' rolls (`off`); for a description no longer on the sheet (`gone`); for a link that
 * isn't a save (`link`); for one in a section only the Gamemaster's players see, which would be
 * posted for everyone (`secret`); and while the character asked within the last ten seconds, or
 * that link within the last thirty (`busy`).
 * @param {object} command      The player's ask, as fetched from the app.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export async function runAskCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !asksOffered() ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failed("unknown");
  const found = await findLink(actor, command.text, command.link);
  if ( found.refusal ) return failed(found.refusal);
  const { link, origin } = found;
  if ( !["save", "concentration"].includes(link?.kind) ) return failed("link");
  if ( (link.kind === "save") && !link.abilities?.length ) return failed("link");
  if ( link.secret ) return failed("secret");
  const now = Date.now();
  if ( askedLately(actor, command, now) ) return failed("busy");
  const message = await postAsk(command, actor, origin, link);
  if ( !message ) return failed("cancelled");
  noteAsked(actor, command, now);
  return describeResult(command, message, actor, campaign, { rolls: [] });
}

/**
 * Has the character asked the table too lately to ask again: within ten seconds, or for this link
 * within thirty? What's older than either is forgotten.
 * @param {Actor} actor
 * @param {object} command
 * @param {number} now   In milliseconds.
 * @returns {boolean}
 */
function askedLately(actor, command, now) {
  for ( const [key, at] of asked ) {
    if ( now - at >= ASK_AGAIN ) asked.delete(key);
  }
  const last = asked.get(actor.id);
  if ( (last !== undefined) && (now - last < ASK_EVERY) ) return true;
  return asked.has(askedKey(actor, command));
}

/**
 * Note that the character asked the table for a link.
 * @param {Actor} actor
 * @param {object} command
 * @param {number} now   In milliseconds.
 * @returns {void}
 */
function noteAsked(actor, command, now) {
  asked.set(actor.id, now);
  asked.set(askedKey(actor, command), now);
}

/**
 * The key a link a character asked for is remembered by.
 * @param {Actor} actor
 * @param {object} command
 * @returns {string}
 */
function askedKey(actor, command) {
  return `${actor.id} ${command.text} ${command.link}`;
}

/**
 * Post dnd5e's roll request card for a description's save, as dnd5e's own request from the
 * description would make it: a button for each ability, each labelled with its DC and without, for
 * dnd5e to show the one each viewer may see; or for a save whose author hid its DC, without it
 * either way, but with the DC on the button for its rolls to be judged by. It's the player's,
 * spoken by their character, so it's shown and its DC hidden as dnd5e does for a player's card;
 * and it's flagged as an ask, so that no one is prompted for it.
 * @param {object} command
 * @param {Actor} actor
 * @param {{name: string, item?: Item}} origin   Where the description comes from.
 * @param {{kind: string, abilities: string[], dc: number|null, hideDC?: boolean}} link
 * @returns {Promise<ChatMessage|null>}
 */
async function postAsk(command, actor, origin, link) {
  const { createRollLabel } = dnd5e.enrichers;
  const dc = Number.isInteger(link.dc) ? link.dc : undefined;
  const hideDC = ((dc !== undefined) && (link.hideDC === true)) ? true : undefined;
  const datasets = (link.kind === "save")
    ? link.abilities.map(ability => ({ type: "save", ability, dc, hideDC, format: "long" }))
    : [{ type: "concentration", ability: link.abilities?.[0], dc, hideDC, format: "short" }];
  const buttons = datasets.map(dataset => ({
    buttonLabel: createRollLabel({ ...dataset, icon: true }),
    hiddenLabel: createRollLabel({ ...dataset, icon: true, hideDC: true }),
    dataset: { ...dataset, action: "rollRequest", visibility: "all" }
  }));
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/dnd5e/templates/chat/roll-request-card.hbs", { buttons }
  );
  return ChatMessage.implementation.create({
    author: authorFor(actor).id,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: askFlavor(origin.name),
    content,
    flags: {
      [MODULE_ID]: { request: command.id, ask: { actorId: actor.id, text: command.text, link: command.link } },
      ...(origin.item && { dnd5e: { item: itemFlag(origin.item) } })
    }
  });
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * Roll a description's damage or healing with the player's dice, as dnd5e rolls it from the
 * description, without its dialog: each part as the kind the player chose, where it offers a
 * choice. Its card names where it comes from, and no target: the Gamemaster applies it from the
 * card. Never a critical hit's, nor changed in the app. Offered only under dnd5e 5.x where the
 * campaign's players' rolls are made (`off`), the Gamemaster lets them attack (`attacks-off`) and
 * damage takes their dice (`self-test`); refused for a description no longer on the sheet
 * (`gone`), a link that isn't damage (`link`), a kind of damage a part doesn't offer (`type`), and
 * dice that aren't the ones it throws (`dice`).
 * @param {object} command      The player's roll, as fetched from the app.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export async function runTextDamageCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready || !textsOffered() ) return failed("off");
  if ( !campaign.attacks ) return failed("attacks-off");
  if ( !diceStatus.attacks ) return failed("self-test");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failed("unknown");
  const found = await findLink(actor, command.text, command.link);
  if ( found.refusal ) return failed(found.refusal);
  const { link, origin } = found;
  if ( (link?.kind !== "damage") || !link.parts?.length ) return failed("link");
  const types = chosenTypes(command.types, link.parts);
  if ( !types ) return failed("type");
  const planned = damageRollsFor(damageProcess(command, link, types)).map(roll => plannedDice(roll));
  if ( !planned.every(each => each.plannable) || !matchesDice(command.dice, planned.flatMap(each => each.dice)) ) {
    return failed("dice");
  }

  const healing = link.healing === true;
  const label = game.i18n.localize(healing ? "DND5E.HEAL.HealingRoll" : "DND5E.DamageRoll");
  const flavor = `${escapeName(origin.name)} - ${label}`;
  const message = rollMessage(command, actor, origin, flavor, healing ? "healing" : "damage");
  let plan;
  const rolls = await withPlan(command, made => {
    plan = made;
    return CONFIG.Dice.DamageRoll.build(damageProcess(command, link, types), { configure: false }, message);
  });
  if ( !rolls?.length ) return failed(plan?.refusal ?? "cancelled");
  return describeResult(command, rolls[0].parent, actor, campaign, { rolls });
}

/**
 * Roll a description's own roll, such as an inline `[[/r 1d4]]`, with the player's dice, as dnd5e
 * rolls a formula, without its dialog, on a card naming where it comes from. Offered only under
 * dnd5e 5.x where the campaign's players' rolls are made (`off`); refused for a description no
 * longer on the sheet (`gone`), a link that isn't such a roll (`link`), and dice that aren't the
 * ones it throws (`dice`).
 * @param {object} command      The player's roll, as fetched from the app.
 * @param {Campaign} campaign   The campaign it was fetched for.
 * @returns {Promise<CommandResult>}
 */
export async function runTextRollCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready || !textsOffered() ) return failed("off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failed("unknown");
  const found = await findLink(actor, command.text, command.link);
  if ( found.refusal ) return failed(found.refusal);
  const { link, origin } = found;
  if ( (link?.kind !== "roll") || (typeof link.formula !== "string") ) return failed("link");
  const built = basicRoll(link.formula);
  const planned = built ? plannedDice(built) : null;
  if ( !planned?.plannable || !matchesDice(command.dice, planned.dice) ) return failed("dice");

  const message = rollMessage(command, actor, origin, escapeName(origin.name), "generic");
  let plan;
  const rolls = await withPlan(command, made => {
    plan = made;
    return CONFIG.Dice.BasicRoll.build(
      { rolls: [{ parts: [link.formula], data: {}, options: { [ROLL_TAG]: command.id } }] },
      { configure: false },
      message
    );
  });
  if ( !rolls?.length ) return failed(plan?.refusal ?? "cancelled");
  return describeResult(command, rolls[0].parent, actor, campaign, { rolls });
}

/**
 * The kind of damage each part of a description's damage is rolled as: the one the player chose,
 * where it offers a choice, else the first it names, as dnd5e rolls it. Null where the player chose
 * one a part doesn't offer, or for more parts than it has.
 * @param {(string|null)[]|undefined|null} chosen
 * @param {{formula: string, types: string[]}[]} parts
 * @returns {(string|undefined)[]|null}
 */
function chosenTypes(chosen, parts) {
  if ( Array.isArray(chosen) && (chosen.length > parts.length) ) return null;
  const types = [];
  for ( const [index, part] of parts.entries() ) {
    const choice = chosen?.[index] ?? null;
    if ( (choice !== null) && !part.types.includes(choice) ) return null;
    types.push(choice ?? part.types[0]);
  }
  return types;
}

/**
 * The configuration dnd5e rolls a description's damage or healing with, as its own description link
 * does: a roll for each part, as the kind chosen for it, offering the kinds it names; tagged as the
 * player's roll. Made afresh for each use, as dnd5e changes what it's given.
 * @param {object} command
 * @param {{parts: {formula: string, types: string[]}[]}} link
 * @param {(string|undefined)[]} types   The kind of each part.
 * @returns {object}
 */
function damageProcess(command, link, types) {
  return {
    hookNames: ["damage"],
    isCritical: false,
    [ROLL_TAG]: command.id,
    rolls: link.parts.map(({ formula, types: offered }, index) => ({
      parts: [formula],
      data: {},
      options: { ...(types[index] && { type: types[index] }), types: [...offered], [ROLL_TAG]: command.id }
    }))
  };
}

/**
 * A description's own roll, built but not rolled, as dnd5e builds a formula: null for one Foundry
 * can't read.
 * @param {string} formula
 * @returns {Roll|null}
 */
function basicRoll(formula) {
  try {
    return new CONFIG.Dice.BasicRoll(formula, {});
  } catch {
    return null;
  }
}

/**
 * The message a description's roll is posted with: the player's, spoken by their character, for
 * everyone to see, naming no target, and the item it comes from, if any, for dnd5e to head its card
 * with. Not for a spell an item casts: dnd5e would head its card with the item alone, in place of
 * the flavor, which names the spell too.
 * @param {object} command
 * @param {Actor} actor
 * @param {{name: string, item?: Item, spell?: Item}} origin   Where the description comes from.
 * @param {string} flavor                                      HTML, its names escaped.
 * @param {"damage"|"healing"|"generic"} type                  The kind of roll, as dnd5e names it.
 * @returns {object}
 */
function rollMessage(command, actor, origin, flavor, type) {
  return {
    rollMode: PUBLIC,
    data: {
      author: authorFor(actor).id,
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flavor,
      flags: {
        dnd5e: {
          messageType: "roll",
          roll: { type },
          targets: [],
          ...((origin.item && !origin.spell) && { item: itemFlag(origin.item) })
        },
        [MODULE_ID]: { request: command.id }
      }
    }
  };
}

/**
 * An item as dnd5e names it in a message's flags, for the message to be associated with it.
 * @param {Item} item
 * @returns {{id: string, uuid: string, type: string}}
 */
function itemFlag(item) {
  return { id: item.id, uuid: item.uuid, type: item.type };
}

/**
 * A name as HTML, escaped: players may write names, and a card's flavor is HTML.
 * @param {string} name
 * @returns {string}
 */
function escapeName(name) {
  return foundry.utils.escapeHTML(String(name ?? ""));
}
