import { MODULE_ID, ROLL_TAG } from "./constants.mjs";
import { sendCharacter } from "./character-sync.mjs";
import { authorFor, describeResult, failedResult, PUBLIC, visibleTo } from "./command-rolls.mjs";
import { castFromItem, commandRefusal, currentTargets, setTargets, workflowSettled } from "./command-uses.mjs";
import {
  availableProfiles, canTake, effectsOf, endable, goingAway, listedOn, originOf, ownName
} from "./sheet-enchant.mjs";

/**
 * Enchanting from the Sending Stone app: using an enchant activity, such as Magic Weapon on a
 * longsword, Shillelagh on a club or quarterstaff, or a Flame Tongue's Engulf in Flames on itself,
 * as dnd5e uses it, with the profile and item the player chose, as dnd5e's usage dialog would have
 * them chosen; and ending an enchantment on an item of theirs, as the ⟲ on dnd5e's card does. What
 * may be enchanted, and with what, is as the sheet says it, from sheet-enchant.mjs, and the game
 * checks it again as it applies it: what the player chose is never taken on trust.
 *
 * Every use posts dnd5e's card, with its tray, as in Foundry. Where the player chose an item, the
 * enchantment is applied to it here, as the tray would apply it, tied to the concentration the card
 * names; one used on its own item is applied as dnd5e applies it; and where it can't be applied,
 * the card is left for the Gamemaster to apply it from. Cast again on an item that carries its
 * enchantment already, an activity replaces it, rather than stacking another, and what's tied to
 * the concentration the use ends goes with it, as dnd5e has it. One on its own item that carries
 * the profile chosen already is refused, never put out at the cost of what it spends.
 */

/**
 * How long an enchantment ended here may take to be gone, in milliseconds: the active Gamemaster
 * deletes those that depend on a concentration without waiting for them, which may be under way.
 * @type {number}
 */
const GONE_WITHIN = 2_000;

/**
 * How often an enchantment being ended is looked for while it goes, in milliseconds.
 * @type {number}
 */
const CHECK_EVERY = 100;

/* -------------------------------------------- */
/*  Using one                                   */
/* -------------------------------------------- */

/**
 * How an enchant activity is used, as dnd5e's usage dialog would have it: at no one; with the
 * profile the player chose, offered at the level it's used at, or else the dialog's own, the one
 * its own item carries, if offered, or the first; and on the item they chose, if any, one of
 * theirs it may enchant once what goes as it's used is gone, but never another for one that
 * enchants its own. One that enchants its own item, which carries the profile chosen already, is
 * refused, before anything is spent: dnd5e's would put it out, at the cost of what it spends. What
 * goes as it's used is noted, the enchantment its own item carries, or what `goingAway` finds on
 * the item chosen, and what the item carries at all, so that Midi-QOL applying it itself can be
 * told.
 * @param {object} command
 * @param {Actor} actor
 * @param {Activity} activity
 * @param {Activity} scaled    The activity as it is at the level it's used at.
 * @returns {{refusal: string}|{profile: string, target: Item|null, existing: ActiveEffect|null,
 *   prior: ActiveEffect[], before: Set<string>}}
 */
export function enchantChoice(command, actor, activity, scaled) {
  if ( command.targets?.length ) return { refusal: "target" };
  const self = activity.enchant?.self === true;
  const existing = self ? (activity.existingEnchantment ?? null) : null;
  const offered = availableProfiles(scaled).map(profile => profile._id);
  const current = existing?.getFlag?.("dnd5e", "enchantmentProfile");
  const profile = command.enchant?.profile ?? (offered.includes(current) ? current : offered[0]);
  if ( !profile || !offered.includes(profile) ) return { refusal: "profile" };
  let target = self ? activity.item : null;
  let prior = self ? [existing].filter(Boolean) : [];
  const named = command.enchant?.item;
  if ( (named !== undefined) && (named !== null) ) {
    if ( self ) return { refusal: "enchant-target" };
    target = actor.items.get(named) ?? null;
    prior = target ? goingAway(activity, target, actor) : [];
    if ( !canTake(activity, target, actor, prior) ) return { refusal: "enchant-target" };
  }
  if ( existing && (current === profile) ) return { refusal: "applied" };
  return { profile, target, existing, prior, before: new Set(effectsOf(target).map(effect => effect.id)) };
}

/**
 * Use an enchant activity through dnd5e, posting its card, then apply its enchantment, as the
 * card's tray would, to the item the player chose, or as dnd5e applies it to its own item: tied to
 * the concentration the card names, in place of what goes as it's used. With no item chosen, the
 * card is left with its tray, as for an ally's weapon. With no card, as a module may stop dnd5e
 * posting one, nothing is applied: the riders an enchantment adds are found from its card.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use   What `prepareUse` found.
 * @returns {Promise<CommandResult>}
 */
export async function dnd5eEnchant(command, campaign, actor, use) {
  const { activity, usage } = use;
  const author = authorFor(actor);
  const results = await activity.use(usage, { configure: false }, {
    rollMode: PUBLIC,
    data: { author: author.id, flags: { dnd5e: { targets: [] }, [MODULE_ID]: { use: command.id } } }
  });
  castFromItem(use, results);
  if ( !results ) return failedResult(command, "cancelled");
  const card = results.message?.id ? results.message : null;
  if ( !card ) return notApplied(command, null, actor, campaign, "enchant");

  // As dnd5e's tray has it: one whose card names a concentration that has since ended is applied no
  // more, nor can it be from the card, which then shows no tray; one whose names none is applied
  // with no concentration.
  const named = card.system?.concentration;
  const concentration = named ? (actor.effects?.get(named) ?? null) : null;
  if ( named && !concentration ) return notApplied(command, null, actor, campaign, "enchant");
  return applyChosen(command, campaign, actor, use, card, concentration);
}

/**
 * Use an enchant activity through Midi-QOL's workflow, at no one, and once it has settled, apply its
 * enchantment as through dnd5e, tied to the concentration Midi began once its checks passed; unless
 * Midi applied it itself, which is then reported as it is. One Midi stopped before beginning the
 * concentration it needs, which would then never end, or whose card it deleted, is used but not
 * applied.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use   What `prepareUse` found.
 * @returns {Promise<CommandResult>}
 */
export async function midiEnchantNow(command, campaign, actor, use) {
  const { activity, usage, prepared, enchanting } = use;
  const saved = currentTargets();
  setTargets([]);
  try {
    const workflowOptions = {
      autoRollAttack: true,
      fastForwardAttack: true,
      autoFastAttack: true,
      autoRollDamage: "none",
      fastForwardDamage: true,
      targetConfirmation: "none",
      forceCompletion: true,
      autoConsumeResource: "both",
      ignoreUserTargets: true,
      preSelectedTargetUuids: [],
      attackRollDSN: !document.hidden,
      damageRollDSN: !document.hidden,
      [ROLL_TAG]: command.id
    };
    const midiUsage = {
      ...usage,
      // Midi puts concentration off until its checks pass, then ends only what it's told to.
      ...(prepared.concentration ? { concentration: { begin: true, end: prepared.concentration.end ?? null } } : {}),
      midiOptions: { targetsToUse: new Set(), configureDialog: false, workflowOptions }
    };
    const results = await activity.use(midiUsage, { configure: false }, {
      rollMode: PUBLIC,
      data: { flags: { dnd5e: { targets: [] }, [MODULE_ID]: { use: command.id } } }
    });
    castFromItem(use, results);
    if ( !results ) return failedResult(command, "midi");
    const card = results.message?.id ? results.message : null;
    if ( !card ) return notApplied(command, null, actor, campaign, "midi");
    const workflow = midiUsage.workflow ?? globalThis.MidiQOL?.Workflow?.getWorkflow(card.uuid);
    if ( !workflow ) return notApplied(command, card, actor, campaign, "midi");
    const state = await workflowSettled(workflow);
    if ( state === "aborted" ) return notApplied(command, card, actor, campaign, "midi");
    if ( state === "late" ) return failedResult(command, "timeout");

    // Midi begins the concentration it put off once its checks pass, and names it on the card; it
    // may stop before then, having spent what the use spends, the card's tray left for the
    // Gamemaster. One whose card names a concentration that has since ended has no tray, as
    // dnd5e's.
    const named = card.system?.concentration;
    const concentration = named ? (actor.effects?.get(named) ?? null) : null;
    if ( named && !concentration ) return notApplied(command, null, actor, campaign, "midi");
    if ( prepared.concentration?.begin && !named ) return notApplied(command, card, actor, campaign, "midi");

    // Applied by Midi itself, as it may be: not again.
    const self = activity.enchant?.self === true;
    const target = self ? activity.item : enchanting.target;
    const { before, profile } = enchanting;
    const applied = effectsOf(target).find(effect => !before.has(effect.id) && (originOf(effect) === activity.uuid)
      && (effect.getFlag?.("dnd5e", "enchantmentProfile") === profile));
    if ( applied ) {
      const ended = await endAll(target, enchanting.prior.filter(effect => effect.id !== applied.id));
      return enchantResult(command, card, actor, campaign, { enchanted: enchantedOf(target, applied, profile), ended });
    }
    return applyChosen(command, campaign, actor, use, card, concentration);
  } finally {
    setTargets(saved);
  }
}

/**
 * Apply an enchantment as the card's tray would, once the activity is used: to its own item, or
 * the item the player chose, if they chose one, in place of what goes as it's used; so long as
 * dnd5e would still let that item take it, and the card is for the profile chosen. What dnd5e's
 * hooks stop, or can't be made, is left on the card for the Gamemaster.
 * @param {object} command
 * @param {Campaign} campaign
 * @param {Actor} actor
 * @param {object} use
 * @param {ChatMessage} card
 * @param {ActiveEffect|null} concentration   What it's tied to, if anything.
 * @returns {Promise<CommandResult>}
 */
async function applyChosen(command, campaign, actor, use, card, concentration) {
  const { activity, enchanting } = use;
  const { profile, prior } = enchanting;
  const self = activity.enchant?.self === true;
  const target = self ? activity.item : enchanting.target;
  if ( !target ) return enchantResult(command, card, actor, campaign, { enchanted: null, ended: null });
  // Asked again, as the item may have changed while it was used: with no dialog, as dnd5e 6 no
  // longer asks as the enchantment is made.
  if ( !self && !canTake(activity, target, actor, prior) ) return notApplied(command, card, actor, campaign, "enchant");
  if ( card.getFlag?.("dnd5e", "use.enchantmentProfile") !== profile ) {
    return notApplied(command, card, actor, campaign, "enchant");
  }
  const ended = await endAll(target, prior);
  let effect = null;
  try {
    effect = await activity.applyEnchantment(profile, target, {
      chatMessage: card, concentration: concentration ?? undefined, strict: false
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not apply ${activity.item?.name}'s enchantment from Sending Stone`, err);
  }
  if ( !effect ) return notApplied(command, card, actor, campaign, "enchant");
  return enchantResult(command, card, actor, campaign, { enchanted: enchantedOf(target, effect, profile), ended });
}

/**
 * End enchantments an item carries, and wait until they're gone: one may be on its way out
 * already, as the active Gamemaster deletes those tied to a concentration ended without waiting.
 * @param {Item} item
 * @param {(ActiveEffect|null)[]} effects
 * @returns {Promise<object|null>}   The first of them, as the app is told it ended; null for none.
 */
async function endAll(item, effects) {
  let ended = null;
  for ( const effect of effects ) {
    if ( !effect ) continue;
    ended ??= endedOf(item, effect);
    if ( item.effects?.has(effect.id) ) {
      try {
        await effect.delete();
      } catch {
        // Already being deleted.
      }
    }
    const until = Date.now() + GONE_WITHIN;
    while ( item.effects?.has(effect.id) && (Date.now() < until) ) {
      await new Promise(resolve => setTimeout(resolve, CHECK_EVERY));
    }
  }
  return ended;
}

/**
 * An enchantment applied, as the app is told: the item, as its player knows it, the effect, its
 * profile and its name.
 * @param {Item} item
 * @param {ActiveEffect} effect
 * @param {string} profile
 * @returns {{item: string, itemName: string, effect: string, profile: string, name: string}}
 */
function enchantedOf(item, effect, profile) {
  return { item: item.id, itemName: ownName(item), effect: effect.id, profile, name: String(effect.name ?? "") };
}

/**
 * An enchantment ended, as the app is told: the item, as its player knows it, the effect and its
 * name.
 * @param {Item} item
 * @param {ActiveEffect} effect
 * @returns {{item: string, itemName: string, effect: string, name: string}}
 */
function endedOf(item, effect) {
  return { item: item.id, itemName: ownName(item), effect: effect.id, name: String(effect.name ?? "") };
}

/**
 * What the app is told of an enchant activity used: its card, and the enchantment it applied and
 * the one it ended, if any; the character's sheet as it now stands going first, as `sheetFirst`
 * has it.
 * @param {object} command
 * @param {ChatMessage} card
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @param {{enchanted: object|null, ended: object|null}} enchantment
 * @returns {CommandResult}
 */
function enchantResult(command, card, actor, campaign, enchantment) {
  sheetFirst(actor);
  return describeResult(command, card, actor, campaign, {
    rolls: [], extra: { use: { type: "enchant" }, damage: null, enchantment }
  });
}

/**
 * Send a character's sheet as it stands, with an enchantment applied or ended, ahead of the result
 * that says so, rather than once its changes settle: the app checks what its player asks next
 * against the sheet it was sent, so a switch turned straight back is checked against the
 * enchantment as it now is, not as it was.
 * @param {Actor} actor
 * @returns {void}
 */
function sheetFirst(actor) {
  try {
    sendCharacter(actor.id);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not send ${actor.name} to Sending Stone`, err);
  }
}

/**
 * What the app is told of an enchant activity used, having spent what it spends, whose enchantment
 * wasn't applied: its card, with dnd5e's tray, for the Gamemaster to apply it from, while the card
 * is there; and with none, as one a module stopped or Midi-QOL deleted, or one that can't be
 * applied from, as a card naming a concentration that has ended, that its player may know as much.
 * @param {object} command
 * @param {ChatMessage|null} card   The card the Gamemaster may apply it from, if any.
 * @param {Actor} actor
 * @param {Campaign} campaign
 * @param {string} reason   "enchant", or "midi".
 * @returns {CommandResult}
 */
function notApplied(command, card, actor, campaign, reason) {
  const messageId = (card?.id && game.messages?.has(card.id)) ? card.id : null;
  return {
    ...failedResult(command, reason),
    messageId,
    visible: messageId ? visibleTo(card, actor, campaign) : true,
    use: { type: "enchant" },
    damage: null,
    enchantment: null
  };
}

/* -------------------------------------------- */
/*  Ending one                                  */
/* -------------------------------------------- */

/**
 * End an enchantment on one of a character's items, as the ⟲ on dnd5e's card does, if the campaign
 * takes their attacks and spells and it's one their player may end, as `endable` has it, that the
 * sheet lists on that item. What depends on it, as what it added to the item, goes with it;
 * whatever it was tied to, such as a concentration, goes on. The character's sheet as it then stands
 * goes ahead of the result, as `sheetFirst` has it.
 * @param {object} command      `{enchantment: {item, effect}}`, as fetched from the app.
 * @param {Campaign} campaign
 * @returns {Promise<CommandResult>}
 */
export async function runEndEnchantmentCommand(command, campaign) {
  const refusal = commandRefusal(command, campaign);
  if ( refusal ) return failedResult(command, refusal.reason, refusal.error);
  const actor = game.actors.get(command.actorId);
  if ( !actor || !campaign.characters.has(actor.id) ) return failedResult(command, "unknown");
  const item = actor.items.get(command.enchantment.item);
  if ( !item ) return failedResult(command, "item");
  const effect = item.effects?.get(command.enchantment.effect);
  if ( !effect || !endable(effect, actor) || !listedOn(effect, item, actor) ) {
    return failedResult(command, "enchantment");
  }
  const ended = endedOf(item, effect);
  try {
    await effect.delete();
  } catch {
    // Gone already, as with what it was tied to: ended all the same.
  }
  sheetFirst(actor);
  return {
    id: command.id, status: "done", reason: null, error: null, messageId: null, visible: true, rolls: [],
    enchantment: { enchanted: null, ended }
  };
}
