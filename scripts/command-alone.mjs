import { EVENTS, MODULE_ID, ROLL_TAG } from "./constants.mjs";
import { aloneTermsChanged } from "./character-sync.mjs";
import {
  appFlags, authorFor, checkCommand, describeResult, failedResult, findMessage, isId, isKey, isOptional, isRolled,
  PUBLIC
} from "./command-rolls.mjs";
import { defaultSlot, offersTypes, scaleAsUsed } from "./command-uses.mjs";
import { commandActor } from "./creatures.mjs";
import {
  changesDamage, diceStatus, matchesDice, modifiedDice, readModifiers, takesAway, unmaximizable, withPlan
} from "./dice-plan.mjs";
import {
  markMidiBonusAction, markMidiReaction, midiActivities, midiBonusActionUsed, midiReactionUsed
} from "./midi-economy.mjs";
import {
  aloneSubject, criticalAdditions, DND5E_ACTIVITIES, eligibleSlots, ownDamageConfig, previewDamage, slotChoice
} from "./sheet-links.mjs";
import { REACTIONS } from "./sheet-rolls.mjs";
import { finite, localize } from "./sheet-values.mjs";

/**
 * What a player can have made here from a row of their sheet with no attack or use, since 0.36.0
 * (round 0.36.0 §3, §6.8-§6.9): an action's damage or healing on its own, `itemDamage`, as dnd5e's
 * own damage or healing card with no targets, for the Gamemaster to select tokens and apply from its
 * tray, as normal; and a spent recharge rolled, `recharge`, as dnd5e's own recharge roll, with the
 * player's d6. Neither goes through Midi-QOL's workflow: dnd5e's own damage roll is called on the
 * activity, as Midi's own sheet Damage button relies on, so Midi's damage calculation applies when
 * the Gamemaster applies it, and nothing else of Midi's does.
 *
 * Since 0.41.0 (round 0.41.0 §2), for an app that reads them, damage on its own is rolled at the
 * spell's level, in the weapon's attack mode and with the ammunition the player chose, and where they
 * ask, spends what using it would, as dnd5e spends it, after the roll: the spell slot and the use's
 * other consumption, the ammunition fired and a weapon thrown, beginning concentration and counting
 * Midi-QOL's Bonus Action or reaction as a use would; the card says what was chosen and spent.
 */

/**
 * What a roll names that damage on its own never does: a use, its targets, a description's link,
 * an enchantment, a key, a combat or a prompt. Since 0.41.0 it may name a spell slot, an attack mode
 * and ammunition, and ask to spend what it uses.
 * @type {string[]}
 */
const NOT_ALONE = ["use", "targets", "target", "text", "link", "enchant", "key", "combatId", "prompt"];

/**
 * What a roll names that a recharge never does.
 * @type {string[]}
 */
const NOT_RECHARGE = [
  "key", "combatId", "use", "targets", "target", "types", "modifiers", "critical", "text", "link", "prompt", "slot",
  "enchant"
];

/**
 * What damage on its own may spend, in the order the app is told it.
 * @type {string[]}
 */
const SPENDS = ["slot", "uses", "ammunition", "thrown"];

/**
 * The campaigns whose app reads damage on its own's choices, by id, as their latest answer to a hello
 * or heartbeat said: `aloneChoices` 1 or later, since 0.41.0.
 * @type {Set<string>}
 */
const readers = new Set();

/**
 * Is this given, rather than left out?
 * @param {unknown} value
 * @returns {boolean}
 */
function given(value) {
  return (value !== undefined) && (value !== null);
}

/**
 * Does a command throw its dice as they are, with no advantage and nothing added?
 * @param {object} command
 * @returns {boolean}
 */
function plain(command) {
  return (command.mode === 0) && (command.explicit === false) && Array.isArray(command.extras) && !command.extras.length;
}

/**
 * dnd5e's generation, as its version's first number has it: 5 for 5.3.3, 6 for 6.0.5.
 * @returns {number}
 */
export function dnd5eGeneration() {
  return Number.parseInt(String(game.system.version ?? ""));
}

/* -------------------------------------------- */
/*  The app's choices                           */
/* -------------------------------------------- */

/**
 * Note whether a campaign's app reads damage on its own's choices, since 0.41.0: `features.aloneChoices`,
 * 1 or later, whose sheets then carry each damaging row's plans at its other levels, modes and
 * ammunition and what it would spend. One that says nothing of it, as an older app, is sent its
 * sheets without them. An answer to a heartbeat that changes it sends the campaign's sheets again; a
 * hello's are sent after it anyway.
 * @param {string} campaignId
 * @param {object|null} features
 * @param {string} [type]   The event answered.
 * @returns {void}
 */
export function noteAloneReader(campaignId, features, type) {
  const format = features?.aloneChoices;
  const was = readers.has(campaignId);
  if ( Number.isInteger(format) && (format >= 1) ) readers.add(campaignId);
  else readers.delete(campaignId);
  if ( (was !== readers.has(campaignId)) && (type !== EVENTS.HELLO) ) aloneTermsChanged(campaignId);
}

/**
 * Does a campaign's app read damage on its own's choices?
 * @param {string} campaignId
 * @returns {boolean}
 */
export function aloneReader(campaignId) {
  return readers.has(campaignId);
}

/* -------------------------------------------- */
/*  Damage on its own                           */
/* -------------------------------------------- */

/**
 * Why a fetched action's damage on its own isn't one to make, if it isn't: it names the item and
 * the activity, and none of what a use names; since 0.41.0 a spell slot, an attack mode and
 * ammunition, each a key or an id, and `consume`, true; it's thrown as it is; it may be a critical
 * hit's; and it has the dice the activity throws, which are checked against them when it's made,
 * and the kind of damage chosen for each of its rolls, as a use's damage has.
 * @param {object} command
 * @returns {string|null}
 */
export function checkItemDamageCommand(command) {
  if ( !isId(command.item) || !isId(command.activity) ) return "item";
  if ( NOT_ALONE.some(field => given(command[field])) ) return "item";
  if ( !isOptional(command.slot, isKey) ) return "slot";
  if ( !isOptional(command.attackMode, isKey) ) return "attack-mode";
  if ( !isOptional(command.ammunition, isId) ) return "ammo";
  if ( !isOptional(command.consume, consume => consume === true) ) return "consume";
  if ( !plain(command) ) return "mode";
  if ( !isOptional(command.critical, critical => critical === true) ) return "critical";
  const { dice, types } = command;
  if ( !Array.isArray(dice) || !dice.length || (dice.length > 20) || !dice.every(isRolled) ) return "dice";
  if ( given(types) && (!Array.isArray(types) || (types.length > 20) || !types.every(type => (type === null) || isKey(type))) ) {
    return "types";
  }
  return null;
}

/**
 * Roll an action's damage or healing on its own, with the player's dice, as dnd5e's sheet and chat
 * Damage buttons make it: dnd5e's own card for the activity's kind, a heal's healing, with its
 * damage breakdown and a save's "On save" line, naming no target, ever, whatever the Gamemaster has
 * targeted, for them to select tokens and apply it from its tray; authored as the player, their
 * character's for a companion's; public; flagged `alone`, so that the app's chat can say it was
 * made on its own. Never a save, a target, or the action itself. Each check is made before anything
 * is rolled, and the dice must be those the sheet's `tableDamage` previews, changed as the player
 * chose, and a critical hit's only where the activity allows one.
 *
 * Since 0.41.0 at the level the player chose, in the attack mode and with the ammunition they chose,
 * as dnd5e would roll them: by a spell slot dnd5e offers, its own level's where none is named; and
 * where they asked (`consume`), spending what using it would, as dnd5e spends it, after the roll:
 * the slot, dnd5e's default where none is named, and the use's other consumption, a consumable's
 * among it, by dnd5e's own `consume`; the ammunition fired and a weapon thrown, as dnd5e's attack
 * spends them; beginning concentration as dnd5e's use begins it; and, where Midi-QOL makes uses and
 * enforces them, in a fight, refused where its Bonus Action or reaction is used, and marking one
 * used. Foundry's card names the level, mode and ammunition, and once spent what was spent.
 * @param {object} command      `{item, activity, critical?, slot?, attackMode?, ammunition?,
 *                              consume?, dice, types?, modifiers?}`, as fetched.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runItemDamageCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready ) return failed("off");
  if ( !campaign.attacks ) return failed("attacks-off");
  if ( !diceStatus.attacks ) return failed("self-test");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const modifiers = readModifiers(command.modifiers);
  if ( modifiers === null ) return failed("invalid", "modifiers");
  if ( changesDamage(modifiers) && !diceStatus.modifiers ) return failed("self-test");
  const found = commandActor(command, campaign);
  if ( !found ) return failed("unknown");
  const { actor, character, form } = found;

  const item = actor.items?.get(command.item);
  const activity = item?.system?.activities?.get?.(command.activity);
  if ( !item || !activity || (item.system?.identified === false) || !DND5E_ACTIVITIES[activity.type] ) return failed("gone");
  const consume = command.consume === true;

  // The level: a slot dnd5e offers the spell; with none named, what spending casts with, or else the
  // spell's own level, as before 0.41.0.
  const offered = eligibleSlots(activity);
  if ( given(command.slot) && !offered?.some(each => each.key === command.slot) ) return failed("slot");
  const slot = command.slot ?? ((consume && offered) ? defaultSlot(activity) : null);
  const level = slot ? (finite(actor.system?.spells?.[slot]?.level) ?? null) : null;
  const scaling = (level !== null) ? Math.max(0, level - (finite(item.system?.level) ?? 0)) : 0;
  const spendsSlot = consume && (slotChoice(activity)?.consumes === true);

  // The attack mode and ammunition, the weapon's own, and whether it's thrown.
  const weapon = weaponOf(command, item, activity, consume);
  if ( weapon.refusal ) return failed(weapon.refusal);
  const { attackMode, ammunition, thrown } = weapon;

  // Midi-QOL's Bonus Actions and reactions, where it asks to spend, as a use's are (round 0.41.0 §2.5).
  const economy = consume && midiActivities() && Boolean(actor.inCombat || (form && character.inCombat));
  const type = activity.effectiveActivationType ?? activity.activation?.type ?? "";
  const bonus = economy && (type === "bonus");
  const reaction = economy && REACTIONS.has(type) && ((activity.activation?.cost ?? 1) > 0);
  if ( bonus && midiBonusActionUsed(actor) ) return failed("bonus-action");
  if ( reaction && midiReactionUsed(actor) ) return failed("reaction");

  const isCritical = command.critical === true;
  const { subject, config } = aloneSubject(activity, scaling);
  const options = { ...config, ...(attackMode && { attackMode }), ...(ammunition && { ammunition }) };
  const preview = previewDamage(subject, { ...options, isCritical });
  if ( !preview?.plannable ) return failed("gone");
  if ( isCritical && ((activity.type === "heal")
    || !criticalAdditions(ownDamageConfig(subject, options), preview.rolls.length).allowed) ) return failed("invalid", "critical");
  // At its highest, damage that takes a die away would take the most away, and a die Foundry rolls
  // again, as one that explodes, wouldn't be at its highest.
  const formulas = preview.rolls.map(roll => roll.formula);
  if ( modifiers?.maximize && (takesAway(preview) || unmaximizable(formulas)) ) return failed("invalid", "modifiers");
  const expected = modifiedDice(preview, modifiers);
  if ( !expected || !matchesDice(command.dice, expected) ) return failed("invalid", "dice");
  if ( !offersTypes(command.types, preview) ) return failed("type");

  // What using it would spend, worked out without spending it, as dnd5e's use works it out: never
  // the action itself; its other consumption as dnd5e fills it in, a target spent only in a fight
  // left out of one; and concentration begun, at the limit the one dnd5e names ended.
  let usage = null;
  if ( consume ) {
    usage = activity._prepareUsageConfig({ consume: { action: false, spellSlot: spendsSlot }, ...(slot && { spell: { slot } }) });
    scaleAsUsed(usage, activity);
    try {
      const errors = await activity._prepareUsageUpdates(usage, { returnErrors: true });
      if ( Array.isArray(errors) && errors.length ) return failed("consume", errors[0]?.message ?? null);
    } catch (err) {
      return failed("consume", err instanceof Error ? err.message : String(err));
    }
  }

  // dnd5e's own, not a module's in its place: Midi-QOL's would add the ammunition it cached on the
  // activity from an earlier attack.
  const own = globalThis.dnd5e?.documents?.activity?.[DND5E_ACTIVITIES[activity.type]]?.prototype?.rollDamage;
  if ( typeof own !== "function" ) return failed("gone");
  const rolled = keptMode(subject, attackMode);
  const sixth = dnd5eGeneration() >= 6;
  const chosen = {
    ...((level !== null) && { level }), ...(attackMode && { attackMode }), ...(ammunition && { ammunition: ammunition.id }),
    consume
  };
  const flavor = [
    `${item.name} - ${rolled.damageFlavor}`,
    ...((level !== null) ? [levelLabel(level)] : []),
    ...(attackMode ? [modeLabel(item, attackMode)] : []),
    ...(ammunition ? [ammunition.name] : []),
    ...(consume ? [] : [localize("SENDINGSTONE.Alone.NothingSpent")])
  ].join(" · ");
  let plan;
  let rolls;
  try {
    rolls = await withPlan(command, made => {
      plan = made;
      return own.call(rolled,
        { isCritical, ...options, [ROLL_TAG]: command.id },
        { configure: false },
        { rollMode: PUBLIC, data: {
          author: authorFor(actor, character).id,
          flavor,
          // No targets, ever: the Gamemaster's of the moment aren't the player's. dnd5e 6 keeps
          // them in its message's own data, which it reads alone. Marked made on its own, so that
          // the app can say it's for the Gamemaster to apply, with what was chosen.
          flags: { ...(!sixth && { dnd5e: { targets: [] } }), [MODULE_ID]: { ...appFlags(command), alone: true, chosen } },
          ...(sixth && { system: { targets: [] } })
        } }
      );
    });
  } catch (err) {
    return failed("error", err instanceof Error ? err.message : String(err));
  }
  if ( !rolls?.length ) return (plan?.refusal === "dice") ? failed("invalid", "dice") : failed(plan?.refusal ?? "cancelled");
  const message = rolls[0].parent ?? findMessage(command.id);

  // The damage was rolled, so what it uses is spent, and the action taken, as the player asked.
  let alone = null;
  if ( consume ) {
    alone = await spend({ actor: activity.actor ?? actor, character, item, activity, usage, ammunition, thrown });
    await tellCard(message, flavor, alone);
  }
  if ( bonus ) {
    try {
      await markMidiBonusAction(actor);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not mark ${character.name}'s Bonus Action for Midi-QOL`, err);
    }
  }
  if ( reaction ) {
    try {
      await markMidiReaction(actor);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not mark ${character.name}'s reaction for Midi-QOL`, err);
    }
  }
  const result = describeResult(command, message, character, campaign, { rolls });
  if ( alone ) result.alone = alone;
  return result;
}

/**
 * The attack mode and ammunition damage on its own is rolled with, since 0.41.0: a mode only of an
 * attack, one of its weapon's; ammunition only of an attack, one its weapon fires, with one left
 * where it's to be spent; and whether a weapon is thrown, and so spent: in a thrown mode named, or
 * its weapon's only mode where none is, as dnd5e's attack would be made in it, with no ammunition and
 * not returning, and with one in hand.
 * @param {object} command
 * @param {Item} item
 * @param {Activity} activity
 * @param {boolean} consume
 * @returns {{attackMode?: string|null, ammunition?: Item|null, thrown?: boolean, refusal?: string}}
 */
function weaponOf(command, item, activity, consume) {
  const attack = activity.type === "attack";
  const modes = attack ? Array.from(item.system?.attackModes ?? []).filter(mode => mode?.value) : [];
  if ( given(command.attackMode) && !modes.some(mode => mode.value === command.attackMode) ) return { refusal: "mode" };
  let ammunition = null;
  if ( given(command.ammunition) ) {
    const option = attack ? Array.from(item.system?.ammunitionOptions ?? []).find(each => each.value === command.ammunition) : null;
    ammunition = option ? (item.actor?.items?.get(option.value) ?? option.item ?? null) : null;
    if ( !ammunition || (consume && !((finite(ammunition.system?.quantity) ?? 0) > 0)) ) return { refusal: "ammo" };
  }
  const mode = command.attackMode ?? ((modes.length === 1) ? modes[0].value : null);
  const thrown = consume && !ammunition && String(mode ?? "").startsWith("thrown") && !item.system?.properties?.has?.("ret");
  if ( thrown && !((finite(item.system?.quantity) ?? 0) > 0) ) return { refusal: "consume" };
  return { attackMode: command.attackMode ?? null, ammunition, thrown };
}

/**
 * The activity damage on its own is rolled on in an attack mode named: under Midi-QOL, whose own
 * damage configuration sets aside a mode it's given outside its workflow, a copy of its item's, whose
 * damage configuration is dnd5e's own followed by Midi's damage roll modifiers, as Midi adds them,
 * so that the mode holds and Midi's modifiers still apply. Otherwise, and with no mode, as it is.
 * The real activity is never changed.
 * @param {Activity} subject
 * @param {string|null} attackMode
 * @returns {Activity}
 */
function keptMode(subject, attackMode) {
  if ( !attackMode ) return subject;
  const own = globalThis.dnd5e?.documents?.activity?.[DND5E_ACTIVITIES[subject.type]]?.prototype?.getDamageConfig;
  if ( (typeof own !== "function") || (subject.getDamageConfig === own) ) return subject;
  const copy = subject.item.clone({}, { keepId: true })?.system?.activities?.get?.(subject.id);
  if ( !copy ) return subject;
  Object.defineProperty(copy, "getDamageConfig", {
    configurable: true,
    writable: true,
    value: function getDamageConfig(config={}) {
      const made = ownDamageConfig(this, config);
      if ( made ) this.createDamageRollModifiers?.(made);
      return made;
    }
  });
  return copy;
}

/**
 * Spend what damage on its own's use would, once it's rolled, since 0.41.0 (round 0.41.0 §2.6): first
 * worked out again, so that what was spent meanwhile leaves this spending nothing; then by dnd5e's own
 * `consume`, which its hooks may stop, or let write and then refuse, so that what was spent is read
 * from what dnd5e recorded, never from what it returns; concentration begun, as dnd5e's use begins
 * it, where anything was spent or nothing was to be; and the ammunition fired, deleted at 0 where it
 * destroys itself, or the weapon thrown, never deleted, unless it returns.
 * @param {object} spending
 * @param {Actor} spending.actor
 * @param {Actor} spending.character
 * @param {Item} spending.item
 * @param {Activity} spending.activity
 * @param {object} spending.usage       As `_prepareUsageConfig` gave it, scaled.
 * @param {Item|null} spending.ammunition
 * @param {boolean} spending.thrown
 * @returns {Promise<{spent: string[], concentrating?: true}>}
 */
async function spend({ actor, character, item, activity, usage, ammunition, thrown }) {
  const spent = new Set();
  let concentrating = false;
  let again = null;
  try {
    again = await activity._prepareUsageUpdates(usage, { returnErrors: true });
  } catch {
    again = null;
  }
  if ( again && !Array.isArray(again) ) {
    const deleting = Array.from(again.delete ?? []);
    const messageConfig = {};
    let updates = false;
    try {
      updates = await activity.consume(usage, messageConfig);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not spend what ${character.name}'s ${item.name} uses`, err);
    }
    const deltas = messageConfig.data?.system?.deltas ?? {};
    for ( const { keyPath } of deltas.actor ?? [] ) spent.add(String(keyPath).startsWith("system.spells.") ? "slot" : "uses");
    const items = Object.values(deltas.item ?? {}).some(changes => changes?.length);
    if ( items || deltas.deleted?.length || deleting.some(id => !actor.items?.has?.(id)) ) spent.add("uses");
    if ( (spent.size || (updates && (typeof updates === "object"))) && usage.concentration?.begin ) {
      try {
        const effect = await actor.beginConcentrating(activity, { "flags.dnd5e.scaling": usage.scaling });
        concentrating = Boolean(effect);
        if ( usage.concentration.end ) await actor.endConcentration(usage.concentration.end);
      } catch (err) {
        console.error(`${MODULE_ID} | Could not begin ${character.name}'s concentration on ${item.name}`, err);
      }
    }
  }
  if ( ammunition ) {
    try {
      const ammo = actor.items?.get?.(ammunition.id);
      const quantity = finite(ammo?.system?.quantity) ?? 0;
      if ( ammo && (quantity > 0) && !ammo.system?.properties?.has?.("ret") ) {
        if ( ammo.system?.uses?.autoDestroy && (quantity === 1) ) await actor.deleteEmbeddedDocuments("Item", [ammo.id]);
        else await actor.updateEmbeddedDocuments("Item", [{ _id: ammo.id, "system.quantity": quantity - 1 }]);
        spent.add("ammunition");
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Could not spend ${character.name}'s ${ammunition.name}`, err);
    }
  }
  if ( thrown ) {
    try {
      const own = actor.items?.get?.(item.id);
      const quantity = finite(own?.system?.quantity) ?? 0;
      if ( own && (quantity > 0) ) {
        await actor.updateEmbeddedDocuments("Item", [{ _id: own.id, "system.quantity": quantity - 1 }]);
        spent.add("thrown");
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Could not spend ${character.name}'s ${item.name}`, err);
    }
  }
  return { spent: SPENDS.filter(each => spent.has(each)), ...(concentrating && { concentrating: true }) };
}

/**
 * Say on damage on its own's card, once it's spent, what was: its flavor followed by what was spent,
 * or nothing, and that concentration began; and the same in its flags. Its damage stands whatever
 * becomes of this.
 * @param {ChatMessage|null} message
 * @param {string} flavor     As it was rolled with.
 * @param {{spent: string[], concentrating?: true}} alone
 * @returns {Promise<void>}
 */
async function tellCard(message, flavor, alone) {
  if ( !message ) return;
  const parts = alone.spent.map(each => localize(`SENDINGSTONE.Alone.Spends.${each}`));
  const said = parts.length
    ? game.i18n.format("SENDINGSTONE.Alone.Spent", { parts: new Intl.ListFormat(game.i18n.lang, { type: "conjunction" }).format(parts) })
    : localize("SENDINGSTONE.Alone.NothingSpent");
  try {
    await message.update({
      flavor: [flavor, said, ...(alone.concentrating ? [localize("SENDINGSTONE.Alone.Concentrating")] : [])].join(" · "),
      [`flags.${MODULE_ID}.chosen.spent`]: alone.spent,
      ...(alone.concentrating && { [`flags.${MODULE_ID}.chosen.concentrating`]: true })
    });
  } catch {
    // The damage is made and spent all the same; the result says what was spent.
  }
}

/**
 * A spell slot's level, as dnd5e names it, such as "2nd Level".
 * @param {number} level
 * @returns {string}
 */
function levelLabel(level) {
  return localize(CONFIG.DND5E?.spellLevels?.[level]) || String(level);
}

/**
 * An attack mode, as its weapon names it, such as "Two-Handed".
 * @param {Item} item
 * @param {string} attackMode
 * @returns {string}
 */
function modeLabel(item, attackMode) {
  const mode = Array.from(item.system?.attackModes ?? []).find(each => each?.value === attackMode);
  return localize(mode?.label) || localize(CONFIG.DND5E?.attackModes?.[attackMode]?.label) || attackMode;
}

/* -------------------------------------------- */
/*  Recharges                                   */
/* -------------------------------------------- */

/**
 * Why a fetched recharge isn't one to make, if it isn't: it names the item, and the activity whose
 * own uses recharge, if it's an activity's, each an id; it's one d6, thrown as it is; and it names
 * nothing else a roll does.
 * @param {object} command
 * @returns {string|null}
 */
export function checkRechargeCommand(command) {
  if ( !isId(command.item) ) return "item";
  if ( given(command.activity) && !isId(command.activity) ) return "item";
  const { dice } = command;
  const one = Array.isArray(dice) && (dice.length === 1) && isRolled(dice[0]) && (dice[0].faces === 6)
    && (dice[0].results.length === 1);
  if ( !one ) return "dice";
  if ( !plain(command) ) return "mode";
  if ( NOT_RECHARGE.some(field => given(command[field])) ) return "item";
  return null;
}

/**
 * Roll a spent recharge, as dnd5e's own `rollRecharge` rolls one, with the player's d6: an item's
 * uses, or one of its activities' own, that recharge, where any is spent, as dnd5e would roll one,
 * against the recovery's formula; recharged on a success, as dnd5e recharges it; posted publicly,
 * spoken by the creature, authored as the player, their character's for a companion's. dnd5e's
 * hooks may keep the uses as they were, which leaves the roll as it was made. Refused as no such
 * item or activity, or none that recharges (`gone`), and as not spent (`charged`).
 * @param {object} command      `{item, activity?, dice: [one d6]}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runRechargeCommand(command, campaign) {
  const failed = (reason, error=null) => failedResult(command, reason, error);
  if ( !campaign.rolls || !diceStatus.ready ) return failed("off");
  if ( !campaign.attacks ) return failed("attacks-off");
  const invalid = checkCommand(command);
  if ( invalid ) return failed("invalid", invalid);
  const found = commandActor(command, campaign);
  if ( !found ) return failed("unknown");
  const { actor, character } = found;

  const item = actor.items?.get(command.item);
  const ofActivity = given(command.activity);
  const subject = ofActivity ? item?.system?.activities?.get?.(command.activity) : item;
  if ( !subject ) return failed("gone");
  const uses = ofActivity ? subject.uses : subject.system?.uses;
  const recovery = Array.from(uses?.recovery ?? []).find(each => each?.period === "recharge");
  if ( !recovery || (typeof uses.rollRecharge !== "function") ) return failed("gone");
  if ( !uses.spent ) return failed("charged");

  // dnd5e's own roll, given whole, as its options merge arrays whole: tagged as the player's.
  const delta = ofActivity ? { item: item.id, keyPath: `system.activities.${subject.id}.uses.spent` }
    : { item: item.id, keyPath: "system.uses.spent" };
  let plan;
  let made;
  try {
    made = await withPlan(command, planned => {
      plan = planned;
      return uses.rollRecharge(
        { rolls: [{
          parts: ["1d6"],
          data: subject.getRollData(),
          options: { delta, target: Number.parseInt(recovery.formula ?? "6"), [ROLL_TAG]: command.id }
        }] },
        {},
        { rollMode: PUBLIC, data: { author: authorFor(actor, character).id, flags: { [MODULE_ID]: appFlags(command) } } }
      );
    });
  } catch (err) {
    return failed("error", err instanceof Error ? err.message : String(err));
  }
  const rolls = Array.isArray(made) ? made : made?.rolls;
  if ( !rolls?.length ) return (plan?.refusal === "dice") ? failed("invalid", "dice") : failed(plan?.refusal ?? "cancelled");
  const message = rolls[0].parent ?? findMessage(command.id);
  if ( !message ) return failed("cancelled");
  const result = describeResult(command, message, character, campaign, { rolls });
  if ( result.visible ) result.outcome = rolls[0].isSuccess ? "success" : "failure";
  return result;
}
