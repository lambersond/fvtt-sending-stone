import { EVENTS } from "./constants.mjs";
import { canSend } from "./bridge-role.mjs";
import { knowsCombat, recheckCombats } from "./campaign-combats.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { owningActor } from "./character-sync.mjs";
import { forgetDescribed, healthChanges, involvesCampaign, isCombatantShared, summarizeCombatant } from "./combat-data.mjs";
import { combatEnabled } from "./config.mjs";
import { healthReader } from "./creature-health.mjs";
import { send } from "./transport.mjs";

/**
 * Since 0.50.0, each fight's combatants sent again as their hit points, health or defeat change
 * outside the combat events, to an app that reads health. A script of its own, as combat.mjs hears
 * only combats and combatants.
 *
 * An actor's hit points, a token's disposition and an effect's Dead or Aid change no combat, so no
 * combat event follows them: until now the app's rows were as of the last turn. Here every client
 * hears them; only the bridge sends. A combat is checked 250 ms after the last change to any of its
 * combatants settles, and each combatant whose `hp`, `health` or `defeated`, as its campaign would
 * be told them now, differ from what it was last told goes again, as `combat.combatant.updated`. The
 * party's own hit points follow too, whatever the campaign's switch (the owner's Q3 A).
 */

/**
 * How long a combat's changes must settle before its combatants are checked, in milliseconds.
 * @type {number}
 */
const SETTLE_AFTER = 250;

/**
 * The timer each combat waits on before its combatants are checked, by combat id.
 * @type {Map<string, number>}
 */
const settling = new Map();

/**
 * A token's fields whose change may change what's told of its combatant: its creature's own
 * changes, as an unlinked token's, whether players see it and how it's disposed, and which actor it
 * stands for.
 * @type {readonly string[]}
 */
const TOKEN_KEYS = Object.freeze(["delta", "disposition", "hidden", "actorLink", "actorId"]);

/**
 * Hear what changes a combatant's hit points, health or defeat outside the combat events: an actor
 * changed, a token's creature or the token itself, and an effect made, changed or deleted, as Aid
 * raises a maximum and Dead makes a combatant defeated; and forget a combat as it's deleted. Every
 * client listens; only the bridge sends.
 * @returns {void}
 */
export function registerHealthHooks() {
  Hooks.on("updateActor", actor => actorChanged(actor));
  Hooks.on("updateActorDelta", delta => actorChanged(delta?.parent?.actor));
  Hooks.on("updateToken", (token, changes) => {
    if ( Boolean(changes) && (typeof changes === "object") && TOKEN_KEYS.some(key => Object.hasOwn(changes, key)) ) {
      tokenChanged(token);
    }
  });
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    Hooks.on(hook, effect => actorChanged(owningActor(effect)));
  }
  Hooks.on("deleteCombat", combat => {
    clearTimeout(settling.get(combat?.id));
    settling.delete(combat?.id);
    forgetDescribed(combat?.id);
  });
}

/**
 * Check, once their changes settle, the combats an actor is in, by any combatant made from it.
 * @param {Actor|null|undefined} actor
 * @returns {void}
 */
function actorChanged(actor) {
  if ( !actor?.id || !canSend() || !combatEnabled() ) return;
  for ( const combat of game.combats?.filter?.(c => c.combatants.some(each => each.actorId === actor.id)) ?? [] ) settle(combat);
}

/**
 * Check, once their changes settle, the combats a token is in, and those its actor is in.
 * @param {TokenDocument|null|undefined} token
 * @returns {void}
 */
function tokenChanged(token) {
  if ( !token || !canSend() || !combatEnabled() ) return;
  const actorId = token.actor?.id ?? token.actorId;
  const concerned = combat => combat.combatants.some(each => (each.tokenId === token.id) || (actorId && (each.actorId === actorId)));
  for ( const combat of game.combats?.filter?.(concerned) ?? [] ) settle(combat);
}

/**
 * Check a combat's combatants `SETTLE_AFTER` after the last change to it.
 * @param {Combat} combat
 * @returns {void}
 */
function settle(combat) {
  clearTimeout(settling.get(combat.id));
  settling.set(combat.id, setTimeout(() => {
    settling.delete(combat.id);
    const now = game.combats?.get?.(combat.id);
    if ( now ) healthAfresh(now);
  }, SETTLE_AFTER));
}

/**
 * Send each campaign whose app reads health, that knows a combat and that it still involves, each
 * of its combatants it may be told of whose hit points, health or defeat it would be told otherwise
 * now, with which of them changed.
 * @param {Combat} combat
 * @returns {void}
 */
function healthAfresh(combat) {
  if ( !canSend() || !combatEnabled() ) return;
  for ( const campaign of getCampaigns() ) {
    if ( !healthReader(campaign.id) || !knowsCombat(combat.id, campaign.id) || !involvesCampaign(combat, campaign) ) continue;
    for ( const combatant of (combat.turns ?? []).filter(isCombatantShared) ) {
      const changes = healthChanges(combatant, campaign);
      if ( !changes.length ) continue;
      send(EVENTS.COMBATANT_UPDATED, { combatId: combat.id, changes, combatant: summarizeCombatant(combatant, campaign) }, campaign);
    }
  }
}

/**
 * Send a campaign whose app has just said it reads health its combats afresh, as `combat.created`:
 * the hello its answer follows, or the combats it was told before, were described without health.
 * What this queues follows any hello on its way, so it never waits for one.
 * @param {string} campaignId
 * @returns {void}
 */
export function healthWanted(campaignId) {
  const campaign = getCampaigns().find(c => c.id === campaignId);
  if ( !campaign || !canSend() || !combatEnabled() ) return;
  recheckCombats(campaign, () => true);
}
