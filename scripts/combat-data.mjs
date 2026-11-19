import { includeGmContent } from "./config.mjs";
import { campaignCharacterId, combatantCharacterId, endedForms, hitPoints } from "./characters.mjs";
import { healthOf, healthOn, healthReader, isHealthShown } from "./creature-health.mjs";

/**
 * Turning combats and combatants into plain data for the listener. Since 0.50.0, and so here, what
 * each campaign whose app reads health was last told of each combatant's hit points, health and
 * defeat, by every description it was sent, so that health-sync.mjs sends one again only where that
 * differs.
 */

/**
 * What each campaign whose app reads health was last described of each combatant, since 0.50.0: by
 * combat id, then `<campaign id>.<combatant id>`, the JSON of its `{ hp, health, defeated }`.
 * @type {Map<string, Map<string, string>>}
 */
const described = new Map();

/**
 * The fields of a combatant's description health-sync.mjs follows, since 0.50.0, in the order a
 * change names them.
 * @type {readonly string[]}
 */
const FOLLOWED = Object.freeze(["hp", "health", "defeated"]);

/**
 * What says which companion a combatant is, for an app that reads companions: creature-sync.mjs's
 * `combatantCompanion`, once module.mjs hands it over as it loads (`registerCombatantCompanion`), so
 * that this file never imports creature-sync.mjs, which imports it by way of campaign-combats.mjs.
 * Undefined until then, as `combatantCompanion` itself answers for an app that doesn't read them,
 * and none has said it does before then.
 * @type {(combatant: Combatant, campaign: Campaign) => string|null|undefined}
 */
let combatantCompanion = () => undefined;

/**
 * Let module.mjs hand over what says which companion a combatant is: registered once, as it loads.
 * @param {(combatant: Combatant, campaign: Campaign) => string|null|undefined} reader
 * @returns {void}
 */
export function registerCombatantCompanion(reader) {
  combatantCompanion = reader;
}

/**
 * May the listener be told about this combatant? A hidden combatant is withheld unless
 * Gamemaster-only information is being sent, just as the combat tracker hides it from players.
 * @param {Combatant|null|undefined} combatant
 * @returns {boolean}
 */
export function isCombatantShared(combatant) {
  if ( !combatant ) return false;
  return !combatant.hidden || includeGmContent();
}

/**
 * Does a combat include any of a campaign's characters that the listener may be told about? Since
 * 0.36.0, for an app that reads companions, any of their companions it was listed counts too, so a
 * fight with only the familiar in it reaches the campaign. Since 0.40.0 a character's form counts as
 * the character, before and after the return: a combatant made from her form's token keeps the
 * form's id once the form is deleted, so its live actor is read through its token first, which names
 * her again after the return, then the id it keeps, then the form that id was, if it's gone.
 * @param {Combat} combat
 * @param {Campaign} campaign
 * @param {string} [leaving]   The id of a combatant to leave out, as it is being removed.
 * @returns {boolean}
 */
export function involvesCampaign(combat, campaign, leaving) {
  return combat.combatants.some(combatant => (combatant.id !== leaving) && isCombatantShared(combatant)
    && (isCharacter(combatant, campaign) || Boolean(combatantCompanion(combatant, campaign))));
}

/**
 * Is a combatant one of a campaign's characters: by its live actor, the actor it keeps the id of, or
 * the deleted form that id was?
 * @param {Combatant} combatant
 * @param {Campaign} campaign
 * @returns {boolean}
 */
function isCharacter(combatant, campaign) {
  if ( campaignCharacterId(combatant.actor, campaign) ) return true;
  if ( campaignCharacterId(game.actors.get(combatant.actorId), campaign) ) return true;
  return campaign.characters.has(endedForms.get(combatant.actorId) ?? combatant.actorId);
}

/**
 * Describe a combatant for a campaign.
 *
 * Hit points are included for the campaign's characters, whose players can see them anyway, and
 * for everyone else only when Gamemaster-only information is being sent. Since 0.29.0 its token's
 * disposition is included, as `dispositionOf` has it. Since 0.36.0, for an app that reads
 * companions, which of their companions it is, `companion`, by its key in the list the campaign was
 * last told, and a companion's hit points as a character's; for any other app, exactly as before.
 * Since 0.40.0 a form's combatant is its character's, and stays so where it names the form once
 * deleted with no token to read another actor through: the character's own actor then stands in.
 * Since 0.50.0, for an app that reads health, where the campaign's Gamemaster shows it, how hurt a
 * creature not of the party is, `health`, and its hit points too where they show them; and what the
 * campaign is told of each combatant's hit points, health and defeat is noted, whichever event
 * tells it. Every description sent passes here.
 * @param {Combatant} combatant
 * @param {Campaign} campaign
 * @returns {object}
 */
export function summarizeCombatant(combatant, campaign) {
  const summary = describe(combatant, campaign);
  if ( healthReader(campaign.id) ) noteDescribed(combatant, campaign, summary);
  return summary;
}

/**
 * A combatant as a campaign would be told it now, noting nothing.
 * @param {Combatant} combatant
 * @param {Campaign} campaign
 * @returns {object}
 */
function describe(combatant, campaign) {
  const character = combatantCharacterId(combatant, campaign);
  const actor = combatant.actor ?? (character ? game.actors.get(character) : null) ?? null;
  const companion = combatantCompanion(combatant, campaign);
  const gmContent = includeGmContent();
  const summary = {
    id: combatant.id,
    name: combatant.name,
    img: combatant.img,
    actorId: combatant.actorId ?? null,
    tokenId: combatant.tokenId ?? null,
    sceneId: combatant.sceneId ?? null,
    groupId: combatant._source.group ?? null,
    initiative: combatant.initiative ?? null,
    defeated: combatant.isDefeated,
    character,
    ...((companion !== undefined) && { companion }),
    playerOwned: actor?.hasPlayerOwner ?? false,
    disposition: dispositionOf(combatant)
  };
  // The campaign's own: one of its characters or a companion it was listed.
  const own = Boolean(character || companion);
  const shown = !own && healthReader(campaign.id) && healthOn(campaign) && isHealthShown(combatant, actor);
  if ( gmContent ) summary.hidden = combatant.hidden;
  if ( own || gmContent || (shown && (campaign.healthHitPoints === true)) ) summary.hp = hitPoints(actor);
  if ( shown ) summary.health = healthOf(actor);
  return summary;
}

/**
 * Note what a campaign is told of a combatant's hit points, health and defeat, since 0.50.0.
 * @param {Combatant} combatant
 * @param {Campaign} campaign
 * @param {object} summary   Its description as sent.
 * @returns {void}
 */
function noteDescribed(combatant, campaign, summary) {
  const combatId = combatant.parent?.id;
  if ( !combatId ) return;
  if ( !described.has(combatId) ) described.set(combatId, new Map());
  described.get(combatId).set(`${campaign.id}.${combatant.id}`, followedOf(summary));
}

/**
 * A description's hit points, health and defeat, as noted.
 * @param {object} summary
 * @returns {string}
 */
function followedOf(summary) {
  return JSON.stringify(Object.fromEntries(FOLLOWED.map(key => [key, summary[key]])));
}

/**
 * Which of a combatant's hit points, health and defeat, `"hp"`, `"health"` and `"defeated"` in that
 * order, a campaign would be told otherwise now than it was last told, since 0.50.0: none where it
 * was told nothing of it with health read, as nothing it holds is known. It notes nothing.
 * @param {Combatant} combatant
 * @param {Campaign} campaign
 * @returns {string[]}
 */
export function healthChanges(combatant, campaign) {
  const was = described.get(combatant.parent?.id)?.get(`${campaign.id}.${combatant.id}`);
  if ( was === undefined ) return [];
  const before = JSON.parse(was);
  const now = JSON.parse(followedOf(describe(combatant, campaign)));
  return FOLLOWED.filter(key => JSON.stringify(now[key]) !== JSON.stringify(before[key]));
}

/**
 * Forget what campaigns were told of a combat's combatants, since 0.50.0, as it's deleted.
 * @param {string} combatId
 * @returns {void}
 */
export function forgetDescribed(combatId) {
  described.delete(combatId);
}

/**
 * A combatant's token's disposition, as players see its border in Foundry: "friendly", "neutral"
 * or "hostile". Null for a Secret one, which Foundry draws for players as no disposition at all,
 * and so for any other; for a token hidden from players; and for a combatant with no token. The
 * same whether or not Gamemaster-only information is being sent: never Secret, nor its number.
 * @param {Combatant} combatant
 * @returns {"friendly"|"neutral"|"hostile"|null}
 */
function dispositionOf(combatant) {
  const token = combatant.token;
  const dispositions = CONST.TOKEN_DISPOSITIONS;
  if ( !token || (token.hidden === true) || !dispositions || !Number.isInteger(token.disposition) ) return null;
  switch ( token.disposition ) {
    case dispositions.FRIENDLY: return "friendly";
    case dispositions.NEUTRAL: return "neutral";
    case dispositions.HOSTILE: return "hostile";
    default: return null;
  }
}

/**
 * Describe a combatant for a campaign, if the listener may be told about it.
 * @param {Combatant|null|undefined} combatant
 * @param {Campaign} campaign
 * @returns {object|null}
 */
export function shareCombatant(combatant, campaign) {
  return isCombatantShared(combatant) ? summarizeCombatant(combatant, campaign) : null;
}

/**
 * Describe a combat for a campaign: its state and its combatants in turn order.
 *
 * Positions in the turn order are deliberately not given as indices. Hidden combatants are left
 * out, so an index would not match the list sent, and would reveal how many were left out.
 * @param {Combat} combat
 * @param {Campaign} campaign
 * @returns {object}
 */
export function snapshotCombat(combat, campaign) {
  const current = combat.combatant;
  return {
    id: combat.id,
    name: combat.name || null,
    sceneId: combat._source.scene ?? null,
    active: combat.active,
    started: combat.started,
    round: combat.round,
    // Before the first round the tracker may already point at someone, but it is nobody's turn.
    combatantId: (combat.started && isCombatantShared(current)) ? current.id : null,
    combatants: (combat.turns ?? []).filter(isCombatantShared).map(combatant => summarizeCombatant(combatant, campaign))
  };
}
