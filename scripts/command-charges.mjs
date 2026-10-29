import { MODULE_ID } from "./constants.mjs";
import { activeForm, seatActor } from "./characters.mjs";
import { sheetFirst } from "./command-enchant.mjs";
import { appFlags, authorFor, checkCommand, failedResult, visibleTo } from "./command-rolls.mjs";
import { wildShapeReader } from "./command-wildshape.mjs";
import { diceStatus } from "./dice-plan.mjs";
import { activityName, shownActivity } from "./sheet-rolls.mjs";
import { slotPoolOf } from "./sheet-spells.mjs";
import { finite, limitedUses, RESOURCES, spendsDirectly } from "./sheet-values.mjs";

/**
 * Spending a character's charges from the Sending Stone app, since module 0.29.0, as a player
 * would on dnd5e's sheet: so many of a feature's or an item's uses, an activity's own, or an
 * old-style resource's, such as two Sorcery Points or a Luck point, of a counter the sheet names
 * and says may be spent so; and using or gaining Heroic Inspiration, as dnd5e's sheet header does;
 * and since 0.42.1 spending one of their spell slots, or restoring one, as dnd5e's sheet's pips do,
 * one at a time and only from the count the app showed. Nothing else is ever given back from the
 * app: a mistake is the Gamemaster's to put right.
 *
 * dnd5e posts nothing for what's changed on its sheet, so each posts a line in chat saying what
 * the character did, as the character, such as "Spends 2 · Sorcery Points": never how many are
 * left, which other players don't see in Foundry. One the Gamemaster made in the app as the
 * character is marked as theirs, as their rolls are.
 *
 * Offered wherever the Gamemaster lets the campaign's players attack and cast from the app, and its
 * players' rolls are made here, whether or not attacks can be made here now: neither throws dice or
 * goes through Midi-QOL. The character's sheet as it then stands goes ahead of the result, which
 * says nothing of the counts: the sheet does.
 *
 * Since 0.40.0, for an app that takes Wild Shape, a character shaped spends from her form's copies,
 * the form's sheet being the one it was sent, and her return carries what she spent back onto her
 * own actor (wild-shape.mjs). Her own actor's resources aren't on the form, which dnd5e gives none.
 */

/* -------------------------------------------- */
/*  Spending                                    */
/* -------------------------------------------- */

/**
 * Spend so many of a character's charges, as fetched from the app, if they may be spent directly
 * and there are that many left, as they now are; then post the line that says so.
 * @param {object} command      `{counter, count}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runSpendCommand(command, campaign) {
  const refusal = chargeRefusal(command, campaign);
  if ( refusal ) return failedResult(command, refusal.reason, refusal.error);
  const character = characterOf(command, campaign);
  if ( !character ) return failedResult(command, "unknown");
  const actor = actingAs(character, campaign);
  const found = counterOf(actor, command.counter);
  if ( found.refusal ) return failedResult(command, found.refusal);
  const { uses, name, spend } = found;
  if ( command.count > uses.value ) return failedResult(command, "short");
  await spend(uses.value - command.count);
  const text = game.i18n.format("SENDINGSTONE.Chat.Spends", {
    count: command.count, name: foundry.utils.escapeHTML(name)
  });
  return lineResult(command, actor, campaign, await postLine(command, actor, text), character);
}

/**
 * The counter a spend names, live, with its uses as `limitedUses` has them, the name the line says
 * it by and how to leave so many of them: an item's own uses, by its id; one of its activities'
 * own, by both ids, of one its player can see; or an old-style resource's, by its key. Or why not:
 * the item or activity isn't the character's (`item`); or it's not one to spend directly, as
 * `spendsDirectly` has it, or has no limited uses, or the resource has no name or maximum, as the
 * sheet leaves out (`uses`).
 * @param {Actor} actor
 * @param {{item?: string, activity?: string, resource?: string}} counter
 * @returns {{refusal: string}|{uses: {value: number, max: number}, name: string,
 *   spend: (left: number) => Promise<unknown>}}
 */
function counterOf(actor, counter) {
  if ( counter.resource !== undefined ) {
    const key = counter.resource;
    const resource = RESOURCES.includes(key) ? actor.system?.resources?.[key] : null;
    const max = finite(resource?.max);
    if ( !resource?.label || !max ) return { refusal: "uses" };
    return {
      uses: { value: finite(resource.value) ?? 0, max },
      name: String(resource.label),
      spend: left => actor.update({ [`system.resources.${key}.value`]: left })
    };
  }
  const item = actor.items?.get(counter.item);
  if ( !item ) return { refusal: "item" };
  if ( counter.activity !== undefined ) {
    const activity = item.system?.activities?.get?.(counter.activity);
    if ( !activity || !shownActivity(activity) ) return { refusal: "item" };
    const uses = spendsDirectly(item) ? limitedUses(activity.uses, activity.labels) : null;
    if ( !uses ) return { refusal: "uses" };
    return {
      uses,
      name: `${item.name}: ${activityName(activity)}`,
      // As dnd5e's sheet writes an activity's uses left: as so many spent of its maximum.
      spend: left => item.updateActivity(activity.id, { "uses.spent": uses.max - left })
    };
  }
  const uses = spendsDirectly(item) ? limitedUses(item.system?.uses, item.labels) : null;
  if ( !uses ) return { refusal: "uses" };
  return {
    uses,
    name: String(item.name ?? ""),
    spend: left => item.update({ "system.uses.spent": uses.max - left })
  };
}

/* -------------------------------------------- */
/*  Heroic Inspiration                          */
/* -------------------------------------------- */

/**
 * Use or gain a character's Heroic Inspiration, as fetched from the app, as dnd5e's sheet header
 * does: used only while they have it (`not-inspired`), gained only while they haven't
 * (`inspired`); then post the line that says so.
 * @param {object} command      `{inspiration: "use"|"gain"}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runInspirationCommand(command, campaign) {
  const refusal = chargeRefusal(command, campaign);
  if ( refusal ) return failedResult(command, refusal.reason, refusal.error);
  const character = characterOf(command, campaign);
  if ( !character ) return failedResult(command, "unknown");
  const actor = actingAs(character, campaign);
  const gain = command.inspiration === "gain";
  const inspired = actor.system?.attributes?.inspiration === true;
  if ( !gain && !inspired ) return failedResult(command, "not-inspired");
  if ( gain && inspired ) return failedResult(command, "inspired");
  await actor.update({ "system.attributes.inspiration": gain });
  const text = game.i18n.localize(gain ? "SENDINGSTONE.Chat.InspirationGained" : "SENDINGSTONE.Chat.InspirationUsed");
  return lineResult(command, actor, campaign, await postLine(command, actor, text), character);
}

/* -------------------------------------------- */
/*  Spell slots                                 */
/* -------------------------------------------- */

/**
 * Spend one of a character's spell slots, or restore one, as fetched from the app, since 0.42.1:
 * one of a pool the character has with slots, as `slotPoolOf` reads it, and only while its count is
 * still the one the app showed (`changed`), so that a slot spent in Foundry meanwhile is never spent
 * again, nor a cast the app hadn't heard of undone. None is spent with none left (`slots`), and none
 * restored at or above its maximum (`full`), so dnd5e's temporary slots above it can be spent but
 * never restored. None while the character is transformed (`shaped`): the character's own slots
 * wait for the return, and the form's are a copy the return loses. Then the line that says so, as the
 * character.
 * @param {object} command      `{spellSlot: {op, id, from}}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runSpellSlotCommand(command, campaign) {
  const refusal = chargeRefusal(command, campaign);
  if ( refusal ) return failedResult(command, refusal.reason, refusal.error);
  const character = characterOf(command, campaign);
  if ( !character ) return failedResult(command, "unknown");
  if ( activeForm(character) ) return failedResult(command, "shaped");
  const { op, id, from } = command.spellSlot;
  const pool = slotPoolOf(character, id);
  if ( !pool ) return failedResult(command, "slot");
  if ( pool.value !== from ) return failedResult(command, "changed");
  const spend = op === "spend";
  if ( spend && (pool.value <= 0) ) return failedResult(command, "slots");
  if ( !spend && (pool.value >= pool.max) ) return failedResult(command, "full");
  await character.update({ [`system.spells.${id}.value`]: pool.value + (spend ? -1 : 1) });
  const text = game.i18n.format(spend ? "SENDINGSTONE.Chat.SpendsSlot" : "SENDINGSTONE.Chat.RegainsSlot", {
    name: foundry.utils.escapeHTML(pool.name)
  });
  return lineResult(command, character, campaign, await postLine(command, character, text));
}

/* -------------------------------------------- */
/*  All                                         */
/* -------------------------------------------- */

/**
 * The campaign character a spend or Heroic Inspiration is for, as it's now.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {Actor|null}
 */
function characterOf(command, campaign) {
  const actor = game.actors.get(command.actorId);
  return (actor && campaign.characters.has(actor.id)) ? actor : null;
}

/**
 * The actor a character's charges and Heroic Inspiration are changed on, since 0.40.0: for an app
 * that takes Wild Shape, the actor she is now, her form while she's shaped; for any other, which was
 * sent her own sheet, her own.
 * @param {Actor} character
 * @param {Campaign} campaign
 * @returns {Actor}
 */
function actingAs(character, campaign) {
  return wildShapeReader(campaign.id) ? seatActor(character) : character;
}

/**
 * Why charges or Heroic Inspiration aren't to be changed, before looking at the character: the
 * campaign's players' rolls aren't made here, or the self-test hasn't passed (`off`); its
 * Gamemaster doesn't let them attack and cast from the app (`attacks-off`); or the command isn't
 * one to make (`invalid`). Whether attacks can be made here now, as the attack self-test and
 * Midi-QOL decide, doesn't matter: neither throws dice or goes through Midi.
 * @param {object} command
 * @param {Campaign} campaign
 * @returns {{reason: string, error?: string}|null}
 */
function chargeRefusal(command, campaign) {
  if ( !campaign.rolls || !diceStatus.ready ) return { reason: "off" };
  if ( !campaign.attacks ) return { reason: "attacks-off" };
  const invalid = checkCommand(command);
  if ( invalid ) return { reason: "invalid", error: invalid };
  return null;
}

/**
 * Post the line that says what a character did, as the character, for everyone: the text given,
 * whose names are escaped already, being what players may write. One the Gamemaster made in the
 * app is flagged theirs, and so listed in their result. One that can't be posted is no failure of
 * what it tells of, which is done: it's left unsaid. Since 0.31.0 a move of items and coins posts
 * its line so too.
 * @param {object} command
 * @param {Actor} actor
 * @param {string} text
 * @returns {Promise<ChatMessage|null>}
 */
export async function postLine(command, actor, text) {
  try {
    return await ChatMessage.implementation.create({
      author: authorFor(actor).id,
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<p>${text}</p>`,
      flags: { [MODULE_ID]: appFlags(command) }
    }) ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | Could not post what ${actor.name} did from Sending Stone`, err);
    return null;
  }
}

/**
 * What the app is told of charges spent or Heroic Inspiration changed: its line, and whether its
 * player may see it; the character's sheet as it now stands going first, as `sheetFirst` has it,
 * since 0.40.0 hers for her form's.
 * @param {object} command
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @param {ChatMessage|null} line
 * @param {Actor} [character]   The campaign character whose player is told.
 * @returns {CommandResult}
 */
function lineResult(command, actor, campaign, line, character=actor) {
  sheetFirst(actor);
  return {
    id: command.id, status: "done", reason: null, error: null,
    messageId: line?.id ?? null,
    visible: line ? visibleTo(line, character, campaign) : true,
    rolls: []
  };
}
