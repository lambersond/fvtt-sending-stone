import {
  CHAT_SCOPES, COMPANION_INITIATIVE, EVENTS, MODULE_ID, RESULTS_MODES, SETTINGS, STATUS_HOOK
} from "../constants.mjs";
import { getCampaigns, manualDiceOn } from "../campaigns.mjs";
import { candidateActors, playerOwners } from "../characters.mjs";
import { transferReader } from "../command-transfers.mjs";
import { dishReader, dishSystem } from "../command-dishes.mjs";
import { attacksUnavailable } from "../command-uses.mjs";
import { commandsOffered } from "../commands.mjs";
import { familyModules, MANUAL_DICE, moduleState } from "../companions.mjs";
import { getDestination, getSecret, isMixedContent, parseDestination } from "../config.mjs";
import { campaignStatus, describeProblem } from "../delivery-status.mjs";
import { diceStatus } from "../dice-plan.mjs";
import { WATCHED_SETTINGS } from "../foundry-settings.mjs";
import { candidateGroups, groupEntry, groupsAvailable, memberCount, primaryPartyId } from "../groups.mjs";
import { midiPromptStatus } from "../midi-prompts.mjs";
import { resultsVerdict } from "../results.mjs";
import { buildEnvelope, deliver, DeliveryError } from "../transport.mjs";
import { typedDiceState } from "../typed-dice.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/**
 * Where this window's templates are.
 * @type {string}
 */
const TEMPLATES = `modules/${MODULE_ID}/templates/settings`;

/**
 * The world settings edited in the General section, by the name of their field.
 * @type {Readonly<Record<string, string>>}
 */
const GENERAL = Object.freeze({
  chatEvents: SETTINGS.CHAT_EVENTS,
  chatScope: SETTINGS.CHAT_SCOPE,
  chatResults: SETTINGS.CHAT_RESULTS,
  combatEvents: SETTINGS.COMBAT_EVENTS,
  gmContent: SETTINGS.GM_CONTENT,
  midiIntegration: SETTINGS.MIDI_INTEGRATION,
  offCanvasTargets: SETTINGS.OFF_CANVAS_TARGETS
});

/**
 * Fields that need another switched on, by that other's name: switching it off disables them.
 * @type {Readonly<Record<string, string[]>>}
 */
const DEPENDENTS = Object.freeze({
  "campaign.rolls": ["campaign.attacks", "campaign.prompts", "campaign.manualDice"],
  chatEvents: ["chatScope", "chatResults"],
  midiIntegration: ["offCanvasTargets"]
});

/**
 * How a campaign's status lines can stand, worst first. A campaign stands as its worst line.
 * @type {readonly string[]}
 */
const STATES = Object.freeze(["error", "warning", "ok", "idle"]);

/**
 * How a module's state is shown: the tone of its badge.
 * @type {Readonly<Record<string, string>>}
 */
const MODULE_TONES = Object.freeze({ active: "ok", off: "warning", inactive: "idle", missing: "idle" });

/**
 * The Players tab's mark of whether a character's player may enter its dice results in the app:
 * an icon of its own for each state, so that the states differ by more than how faint the mark is.
 * @type {Readonly<Record<string, string>>}
 */
const TYPED_DICE_ICONS = Object.freeze({ allowed: "fa-keyboard", permission: "fa-lock", none: "fa-user-slash" });

/**
 * The marks whose tooltips open on focus too, for keyboards, as Foundry opens tooltips on hover alone.
 * @type {string}
 */
const FOCUS_TOOLTIPS = ".sending-stone-manual-dice[data-tooltip]";

/**
 * The Gamemaster's window for every Sending Stone setting, in sections down its side: General,
 * for the app's address and what's sent; Modules, for the modules that change what Sending Stone
 * can do, the author's own among them; each campaign, one at a time, with its players, since 0.30.0
 * its parties, what they may do from the app, and its connection, under a line saying what its
 * players see in chat; and the Roster, every character against every campaign.
 *
 * Only the open section is drawn, so a world with many players and campaigns never lists every
 * character once per campaign. What's typed and ticked is kept as it changes, whichever section
 * it was in, and nothing is saved until Save Changes. A campaign's connection can be tested as
 * typed, and each saved campaign says how its posts and fetches are going, as they go, from this
 * page load.
 * @extends ApplicationV2
 * @mixes HandlebarsApplication
 */
export default class SettingsWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    id: "sending-stone-settings",
    tag: "form",
    window: {
      contentClasses: ["standard-form"],
      icon: "fa-solid fa-tower-broadcast",
      title: "SENDINGSTONE.Config.Title",
      resizable: true
    },
    position: { width: 880, height: 660 },
    form: {
      closeOnSubmit: true,
      handler: SettingsWindow.#onSubmit
    },
    actions: {
      view: SettingsWindow.#onView,
      addCampaign: SettingsWindow.#onAddCampaign,
      removeCampaign: SettingsWindow.#onRemoveCampaign,
      testCampaign: SettingsWindow.#onTestCampaign,
      revealSecret: SettingsWindow.#onRevealSecret,
      removeCharacter: SettingsWindow.#onRemoveCharacter,
      copyCharacters: SettingsWindow.#onCopyCharacters,
      openPicker: SettingsWindow.#onOpenPicker,
      closePicker: SettingsWindow.#onClosePicker,
      pickGroup: SettingsWindow.#onPickGroup,
      addPicked: SettingsWindow.#onAddPicked,
      filterScope: SettingsWindow.#onFilterScope,
      openPartyPicker: SettingsWindow.#onOpenPartyPicker,
      closePartyPicker: SettingsWindow.#onClosePartyPicker,
      addPickedParties: SettingsWindow.#onAddPickedParties,
      removeParty: SettingsWindow.#onRemoveParty
    }
  };

  /** @override */
  static PARTS = {
    nav: {
      template: `${TEMPLATES}/nav.hbs`
    },
    content: {
      template: `${TEMPLATES}/content.hbs`,
      templates: ["general", "modules", "roster", "campaign"].map(name => `${TEMPLATES}/${name}.hbs`),
      scrollable: [".sending-stone-scroll"]
    },
    footer: {
      template: `${TEMPLATES}/footer.hbs`
    }
  };

  /**
   * The app's address and the General section's settings, as being edited.
   * @type {{destination: string, chatEvents: boolean, chatScope: string, chatResults: string,
   *   combatEvents: boolean, gmContent: boolean, midiIntegration: boolean, offCanvasTargets: boolean}}
   */
  #general = SettingsWindow.#readGeneral();

  /**
   * The campaigns as being edited, each with the secret this browser holds for it.
   * @type {{id: string, title: string, secret: string, characters: Set<string>, groups: Set<string>,
   *   rolls: boolean, attacks: boolean, prompts: boolean, manualDice: boolean, transfers: boolean,
   *   dishes: boolean, companionInitiative: string}[]}
   */
  #campaigns = getCampaigns().map(campaign => ({ ...campaign, secret: getSecret(campaign.id) }));

  /**
   * Everything as saved, to tell whether anything has changed since.
   * @type {string}
   */
  #saved = this.#snapshot();

  /**
   * The section open: General, Modules, the Roster, or a campaign at one of its tabs.
   * @type {{section: "general"|"modules"|"roster"|"campaign", campaignId: string|null,
   *   tab: "players"|"actions"|"party"|"connection"}}
   */
  #view = this.#firstView();

  /**
   * Is the open campaign's list of characters to add in place of its players?
   * @type {boolean}
   */
  #picker = false;

  /**
   * Is the open campaign's list of groups to add in place of its parties?
   * @type {boolean}
   */
  #partyPicker = false;

  /**
   * What each list is filtered by, typed or chosen, kept for re-rendering.
   * @type {{players: string, picker: string, pickerScope: "outside"|"everyone", roster: string,
   *   rosterScope: "everyone"|"unassigned"}}
   */
  #filters = { players: "", picker: "", pickerScope: "outside", roster: "", rosterScope: "everyone" };

  /**
   * Is the open campaign's secret shown as typed?
   * @type {boolean}
   */
  #revealed = false;

  /**
   * What each campaign's latest test found, by its id, kept for re-rendering.
   * @type {Map<string, {state: string, text: string}>}
   */
  #tests = new Map();

  /**
   * What to focus once rendered, as a selector, and whether the open section scrolls to its top.
   * @type {{focus: string|null, top: boolean}}
   */
  #after = { focus: null, top: false };

  /**
   * The STATUS_HOOK listener rewriting the campaigns' status while the window is open.
   * @type {number|null}
   */
  #statusHook = null;

  /**
   * The listeners rewriting what players see in chat while the window is open, as the settings that
   * decide it are stored or changed, by their hook.
   * @type {[string, number][]}
   */
  #resultsHooks = [];

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /**
   * The app's address and the General section's settings, as saved.
   * @returns {SettingsWindow["#general"]}
   */
  static #readGeneral() {
    return {
      destination: String(game.settings.get(MODULE_ID, SETTINGS.DESTINATION) ?? ""),
      ...Object.fromEntries(Object.entries(GENERAL).map(([name, key]) => [name, game.settings.get(MODULE_ID, key)]))
    };
  }

  /**
   * Where the window opens: General until the app's address is set or while there's no campaign,
   * else the first campaign's players.
   * @returns {SettingsWindow["#view"]}
   */
  #firstView() {
    const [first] = this.#campaigns;
    if ( !first || !this.#general.destination.trim() ) return { section: "general", campaignId: null, tab: "players" };
    return { section: "campaign", campaignId: first.id, tab: "players" };
  }

  /**
   * Everything as being edited, in a form that compares equal when nothing that's saved differs.
   * @returns {string}
   */
  #snapshot() {
    return JSON.stringify({
      general: { ...this.#general, destination: this.#general.destination.trim() },
      campaigns: this.#campaigns.map(campaign => ({
        id: campaign.id,
        title: campaign.title.trim(),
        secret: campaign.secret.trim(),
        characters: Array.from(campaign.characters).filter(id => game.actors.has(id)).sort(),
        groups: Array.from(campaign.groups).filter(isGroup),
        rolls: campaign.rolls,
        attacks: campaign.attacks,
        prompts: campaign.prompts,
        manualDice: campaign.manualDice,
        transfers: campaign.transfers,
        dishes: campaign.dishes,
        companionInitiative: campaign.companionInitiative
      }))
    });
  }

  /**
   * The campaign open, if one is.
   * @returns {SettingsWindow["#campaigns"][number]|null}
   */
  #current() {
    if ( this.#view.section !== "campaign" ) return null;
    return this.#campaigns.find(campaign => campaign.id === this.#view.campaignId) ?? null;
  }

  /**
   * Keep what the open section shows as typed and ticked. Fields of other sections aren't in the
   * form, and disabled ones aren't read, so what they hold stays as it was.
   * @returns {void}
   */
  #capture() {
    const data = new FormDataExtended(this.element).object;
    const has = name => Object.hasOwn(data, name);
    if ( has("destination") ) this.#general.destination = String(data.destination ?? "");
    for ( const name of Object.keys(GENERAL) ) {
      if ( !has(name) ) continue;
      // The choices are strings; every other General setting is a switch.
      this.#general[name] = (["chatScope", "chatResults"].includes(name)) ? String(data[name]) : (data[name] === true);
    }

    const campaign = this.#current();
    if ( campaign ) {
      if ( has("campaign.title") ) campaign.title = String(data["campaign.title"] ?? "");
      if ( has("campaign.secret") ) campaign.secret = String(data["campaign.secret"] ?? "");
      for ( const name of ["rolls", "attacks", "prompts", "manualDice", "transfers", "dishes"] ) {
        if ( has(`campaign.${name}`) ) campaign[name] = data[`campaign.${name}`] === true;
      }
      // A choice, as the General section's are, never a switch.
      if ( has("campaign.companionInitiative") ) {
        campaign.companionInitiative = (String(data["campaign.companionInitiative"]) === COMPANION_INITIATIVE.AFTER)
          ? COMPANION_INITIATIVE.AFTER : COMPANION_INITIATIVE.OWN;
      }
    }

    // The Roster's boxes, each named for its campaign and character: roster.<campaign>.<actor>.
    for ( const [name, checked] of Object.entries(data) ) {
      if ( !name.startsWith("roster.") ) continue;
      const [, campaignId, actorId] = name.split(".");
      const member = this.#campaigns.find(c => c.id === campaignId);
      if ( !member ) continue;
      if ( checked === true ) member.characters.add(actorId);
      else member.characters.delete(actorId);
    }
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(_options = {}) {
    const saved = new Map(getCampaigns().map(campaign => [campaign.id, campaign]));
    const actors = this.#actors();
    if ( (this.#view.section === "campaign") && !this.#current() ) this.#view = { section: "general", campaignId: null, tab: "players" };
    // A world without Group actors has no Party tab.
    if ( (this.#view.tab === "party") && !groupsAvailable() ) this.#view.tab = "players";
    const { section } = this.#view;
    const context = {
      nav: this.#navContext(saved, actors),
      section: { [section]: true },
      dirty: this.#snapshot() !== this.#saved
    };
    if ( section === "general" ) context.general = this.#generalContext();
    else if ( section === "modules" ) context.modules = this.#modulesContext();
    else if ( section === "roster" ) context.roster = this.#rosterContext(actors);
    else if ( section === "campaign" ) context.campaign = this.#campaignContext(this.#current(), saved, actors);
    return context;
  }

  /**
   * Every character the window offers: the player characters, and any other actor a campaign
   * has, by who plays them, then by name. Those no player owns come last.
   * @returns {{id: string, name: string, img: string, owners: string[], group: string,
   *   search: string}[]}
   */
  #actors() {
    const none = game.i18n.localize("SENDINGSTONE.Config.Players.NoOwner");
    const actors = candidateActors();
    const listed = new Set(actors.map(actor => actor.id));
    for ( const campaign of this.#campaigns ) {
      for ( const id of campaign.characters ) {
        const actor = game.actors.get(id);
        if ( !actor || listed.has(id) ) continue;
        actors.push(actor);
        listed.add(id);
      }
    }
    const lang = game.i18n.lang;
    return actors
      .map(actor => {
        const owners = playerOwners(actor).map(user => user.name);
        return {
          id: actor.id,
          name: actor.name,
          img: actor.img,
          owners,
          group: owners.length ? owners.join(", ") : none,
          search: [actor.name, ...owners].join(" ").toLocaleLowerCase(lang)
        };
      })
      .sort((a, b) => (Number(!a.owners.length) - Number(!b.owners.length))
        || a.group.localeCompare(b.group, lang) || a.name.localeCompare(b.name, lang));
  }

  /**
   * Characters gathered by who plays them, in the order given.
   * @template {{group: string}} T
   * @param {T[]} entries
   * @returns {{label: string, count: string, entries: T[]}[]}
   */
  #groups(entries) {
    const groups = new Map();
    for ( const entry of entries ) {
      if ( !groups.has(entry.group) ) groups.set(entry.group, []);
      groups.get(entry.group).push(entry);
    }
    return Array.from(groups, ([label, members]) => ({ label, count: count(members.length, "Character"), entries: members }));
  }

  /**
   * A campaign's title as shown, or that it has none yet.
   * @param {{title: string}} campaign
   * @returns {string}
   */
  #titleOf(campaign) {
    return campaign.title.trim() || game.i18n.localize("SENDINGSTONE.Config.Untitled");
  }

  /**
   * How many of a campaign's characters still exist.
   * @param {{characters: Set<string>}} campaign
   * @returns {number}
   */
  #countOf(campaign) {
    return Array.from(campaign.characters).filter(id => game.actors.has(id)).length;
  }

  /**
   * How a campaign stands: not saved yet, or as its worst status line, with every line.
   * @param {{id: string}} campaign
   * @param {Map<string, Campaign>} saved   The campaigns as saved, by id.
   * @returns {{state: string, stateLabel: string, stateTooltip: string,
   *   lines: {state: string, text: string}[]}}
   */
  #stateOf(campaign, saved) {
    const stored = saved.get(campaign.id);
    const lines = stored ? campaignStatus(stored) : [];
    const state = stored ? (STATES.find(s => lines.some(line => line.state === s)) ?? "idle") : "new";
    const stateLabel = game.i18n.localize(`SENDINGSTONE.Config.State.${state}`);
    return { state, stateLabel, stateTooltip: lines.map(line => line.text).join(" ") || stateLabel, lines };
  }

  /**
   * The sections down the window's side.
   * @param {Map<string, Campaign>} saved
   * @param {object[]} actors
   * @returns {object}
   */
  #navContext(saved, actors) {
    const { section, campaignId } = this.#view;
    const family = familyModules().filter(module => module.state === "active");
    return {
      general: section === "general",
      modules: section === "modules",
      roster: section === "roster",
      family: family.length,
      familyTooltip: game.i18n.format("SENDINGSTONE.Config.Nav.ModulesActive", {
        names: family.map(module => module.title).join(", ")
      }),
      rosterCount: actors.length,
      campaigns: this.#campaigns.map(campaign => ({
        id: campaign.id,
        title: this.#titleOf(campaign),
        untitled: !campaign.title.trim(),
        count: this.#countOf(campaign),
        current: (section === "campaign") && (campaign.id === campaignId),
        ...this.#stateOf(campaign, saved)
      }))
    };
  }

  /**
   * The General section: the app's address, what's sent, and Midi-QOL's options where it's active.
   * @returns {object}
   */
  #generalContext() {
    const general = this.#general;
    return {
      destination: general.destination,
      chatEvents: general.chatEvents === true,
      scopes: [
        { value: CHAT_SCOPES.ALL, key: "ScopeAll" },
        { value: CHAT_SCOPES.CONNECTED, key: "ScopeConnected" }
      ].map(({ value, key }) => ({
        value,
        label: game.i18n.localize(`SENDINGSTONE.Config.General.${key}`),
        selected: general.chatScope === value
      })),
      results: [
        { value: RESULTS_MODES.FOUNDRY, key: "ResultsFoundry" },
        { value: RESULTS_MODES.ALWAYS, key: "ResultsAlways" }
      ].map(({ value, key }) => ({
        value,
        label: game.i18n.localize(`SENDINGSTONE.Config.General.${key}`),
        selected: general.chatResults === value
      })),
      combatEvents: general.combatEvents === true,
      gmContent: general.gmContent === true,
      midi: (game.modules.get("midi-qol")?.active === true) ? {
        integration: general.midiIntegration !== false,
        offCanvas: general.offCanvasTargets === true
      } : null
    };
  }

  /**
   * The Modules section: the author's own modules, those Sending Stone works with, and the system
   * it needs.
   * @returns {object}
   */
  #modulesContext() {
    const label = state => game.i18n.localize(`SENDINGSTONE.Modules.State.${state}`);
    const module = (id, key, icon) => {
      const state = moduleState(id);
      return {
        id,
        icon,
        title: game.modules.get(id)?.title ?? game.i18n.localize(`SENDINGSTONE.Modules.${key}.Title`),
        hint: game.i18n.localize(`SENDINGSTONE.Modules.${key}.Hint`),
        state,
        stateLabel: label(state),
        tone: MODULE_TONES[state]
      };
    };
    const midi = module("midi-qol", "Midi", "fa-solid fa-wand-sparkles");
    // Since 0.27.0 the saves Midi asks are asked in the app, where this Midi has what that needs.
    if ( (midi.state === "active") && (game.system.id === "dnd5e") && !midiPromptStatus.workflow ) {
      const version = game.modules.get("midi-qol")?.version ?? "?";
      midi.note = game.i18n.format("SENDINGSTONE.Modules.Midi.Prompts", { version });
    }
    const wrapper = module("lib-wrapper", "LibWrapper", "fa-solid fa-link");
    // libWrapper is only recommended, so not having it isn't a fault.
    if ( wrapper.state !== "active" ) Object.assign(wrapper, { stateLabel: label("recommended"), tone: "warning" });
    const dnd5e = game.system.id === "dnd5e";
    return {
      family: familyModules().map(entry => ({
        ...entry,
        icon: (entry.id === MANUAL_DICE) ? "fa-solid fa-dice-d20" : "fa-solid fa-puzzle-piece",
        stateLabel: label(entry.state),
        tone: MODULE_TONES[entry.state]
      })),
      integrations: [midi, wrapper],
      system: {
        title: dnd5e ? game.system.title : game.i18n.localize("SENDINGSTONE.Modules.System.Title"),
        hint: game.i18n.localize("SENDINGSTONE.Modules.System.Hint"),
        stateLabel: label(dnd5e ? "met" : "unmet"),
        tone: dnd5e ? "ok" : "error"
      }
    };
  }

  /**
   * The Roster: every character against every campaign.
   * @param {object[]} actors
   * @returns {object}
   */
  #rosterContext(actors) {
    const rows = actors.map(entry => ({
      ...entry,
      unassigned: !this.#campaigns.some(campaign => campaign.characters.has(entry.id)),
      cells: this.#campaigns.map(campaign => ({
        campaignId: campaign.id,
        checked: campaign.characters.has(entry.id),
        label: game.i18n.format("SENDINGSTONE.Config.Roster.Toggle", { name: entry.name, campaign: this.#titleOf(campaign) })
      }))
    }));
    const unassigned = rows.filter(row => row.unassigned).length;
    return {
      campaigns: this.#campaigns.map(campaign => ({
        id: campaign.id, title: this.#titleOf(campaign), count: this.#countOf(campaign)
      })),
      rows,
      summary: `${count(actors.length, "Character")} · ${count(new Set(actors.flatMap(a => a.owners)).size, "Player")}`,
      filter: this.#filters.roster,
      unassignedOnly: this.#filters.rosterScope === "unassigned",
      unassignedLabel: game.i18n.format("SENDINGSTONE.Config.Roster.Unassigned", { count: unassigned })
    };
  }

  /**
   * A campaign, at its open tab.
   * @param {SettingsWindow["#campaigns"][number]} campaign
   * @param {Map<string, Campaign>} saved
   * @param {object[]} actors
   * @returns {object}
   */
  #campaignContext(campaign, saved, actors) {
    const others = this.#campaigns.filter(other => other !== campaign);
    const titles = list => list.map(other => this.#titleOf(other)).join(", ");
    const members = actors.filter(entry => campaign.characters.has(entry.id));
    const { tab } = this.#view;
    const context = {
      id: campaign.id,
      heading: this.#titleOf(campaign),
      untitled: !campaign.title.trim(),
      summary: `${count(members.length, "Character")} · ${count(new Set(members.flatMap(m => m.owners)).size, "Player")}`,
      tabs: { [tab]: true },
      partyTab: groupsAvailable(),
      results: verdictLine(),
      ...this.#stateOf(campaign, saved)
    };

    if ( (tab === "players") && this.#picker ) {
      const entries = actors.map(entry => {
        const where = others.filter(other => other.characters.has(entry.id));
        const inCampaign = campaign.characters.has(entry.id);
        return {
          ...entry,
          inCampaign,
          where: inCampaign ? game.i18n.localize("SENDINGSTONE.Config.Picker.Already")
            : where.length ? game.i18n.format("SENDINGSTONE.Config.Picker.In", { campaigns: titles(where) })
              : game.i18n.localize("SENDINGSTONE.Config.Picker.Nowhere")
        };
      });
      const outside = entries.filter(entry => !entry.inCampaign).length;
      context.picker = {
        title: game.i18n.format("SENDINGSTONE.Config.Picker.Title", { campaign: this.#titleOf(campaign) }),
        groups: this.#groups(entries),
        filter: this.#filters.picker,
        everyone: this.#filters.pickerScope === "everyone",
        outsideLabel: game.i18n.format("SENDINGSTONE.Config.Picker.Outside", { count: outside }),
        everyoneLabel: game.i18n.format("SENDINGSTONE.Config.Picker.Everyone", { count: entries.length }),
        none: !outside
      };
    }
    else if ( tab === "players" ) {
      // Whether each character's player may enter its dice results in the app, while the campaign's
      // players may: its primary player has Make Manual Rolls, needs it, or there's none. The switch
      // itself is each player's, in the app.
      const manualDice = manualDiceOn(campaign);
      const typedDice = entry => {
        const actor = manualDice ? game.actors.get(entry.id) : null;
        if ( !actor ) return null;
        const { state, player } = typedDiceState(actor);
        const label = game.i18n.format(`SENDINGSTONE.Config.Players.TypedDice.${state}`, { player: player?.name ?? "", name: entry.name });
        return { state, label, icon: TYPED_DICE_ICONS[state] };
      };
      Object.assign(context, {
        groups: this.#groups(members.map(entry => {
          const also = others.filter(other => other.characters.has(entry.id));
          return {
            ...entry,
            also: also.length ? game.i18n.format("SENDINGSTONE.Config.Players.AlsoIn", { campaigns: titles(also) }) : null,
            removeLabel: game.i18n.format("SENDINGSTONE.Config.Players.Remove", { name: entry.name }),
            typedDice: typedDice(entry)
          };
        })),
        filter: this.#filters.players,
        copySources: others.filter(other => this.#countOf(other)).map(other => ({
          id: other.id, label: `${this.#titleOf(other)} (${this.#countOf(other)})`
        }))
      });
    }
    else if ( tab === "actions" ) Object.assign(context, this.#actionsContext(campaign));
    else if ( tab === "party" ) context.party = this.#partyContext(campaign, others);
    else if ( tab === "connection" ) {
      Object.assign(context, {
        title: campaign.title,
        secret: campaign.secret,
        revealed: this.#revealed,
        test: this.#tests.get(campaign.id) ?? null,
        status: saved.has(campaign.id) ? context.lines : null,
        address: parseDestination(this.#general.destination)?.host
          ?? game.i18n.localize("SENDINGSTONE.Config.Connection.NoAddress")
      });
    }
    return context;
  }

  /**
   * A campaign's Party tab: its groups, each with how many members it has and which of the
   * campaign's characters' players may see it in Foundry, or a warning that none may; or in their
   * place, the groups that can be added. The context is `party`, as `groups` is the players tab's.
   * @param {SettingsWindow["#campaigns"][number]} campaign
   * @param {SettingsWindow["#campaigns"]} others   The other campaigns.
   * @returns {object}
   */
  #partyContext(campaign, others) {
    const names = new Map(Array.from(campaign.characters, id => [id, game.actors.get(id)?.name]));
    const listed = Array.from(campaign.groups, id => game.actors.get(id)).filter(isGroup);
    const context = {
      groups: listed.map(group => {
        const { access, primary } = groupEntry(group, campaign);
        const seen = Object.keys(access).map(id => names.get(id)).filter(Boolean);
        const members = memberCount(group);
        return {
          id: group.id,
          name: group.name,
          img: group.img,
          primary,
          members: (members === 1) ? game.i18n.localize("SENDINGSTONE.Config.Party.Member")
            : game.i18n.format("SENDINGSTONE.Config.Party.Members", { count: members }),
          seenBy: seen.length ? game.i18n.format("SENDINGSTONE.Config.Party.SeenBy", { characters: seen.join(", ") }) : null,
          removeLabel: game.i18n.format("SENDINGSTONE.Config.Party.Remove", { name: group.name })
        };
      })
    };
    if ( !this.#partyPicker ) return context;
    const titles = list => list.map(other => this.#titleOf(other)).join(", ");
    const primary = primaryPartyId();
    const entries = candidateGroups().map(group => {
      const inCampaign = campaign.groups.has(group.id);
      const where = others.filter(other => other.groups.has(group.id));
      return {
        id: group.id,
        name: group.name,
        img: group.img,
        primary: group.id === primary,
        inCampaign,
        where: inCampaign ? game.i18n.localize("SENDINGSTONE.Config.Picker.Already")
          : where.length ? game.i18n.format("SENDINGSTONE.Config.Picker.In", { campaigns: titles(where) })
            : game.i18n.localize("SENDINGSTONE.Config.Picker.Nowhere")
      };
    });
    context.picker = {
      title: game.i18n.format("SENDINGSTONE.Config.Party.PickerTitle", { campaign: this.#titleOf(campaign) }),
      entries,
      empty: !entries.length ? game.i18n.localize("SENDINGSTONE.Config.Party.NoGroups")
        : entries.every(entry => entry.inCampaign) ? game.i18n.localize("SENDINGSTONE.Config.Party.PickerEmpty") : null
    };
    return context;
  }

  /**
   * A campaign's Player actions tab: what its players may do from the app, why any of it can't be
   * done in this game, and whether they may enter their own dice results, which needs Manual Dice;
   * and since 0.31.0, whether they may move items and coins, which needs D&D Fifth Edition and an
   * app that takes moves, an older one answering with commands but not with `transfers`; and since
   * 0.38.0, whether it takes dishes from the Magical Recipe Book, which need dnd5e 5 and an app that
   * takes them, an older one answering with commands but not with `dishes`.
   * @param {SettingsWindow["#campaigns"][number]} campaign
   * @returns {object}
   */
  #actionsContext(campaign) {
    // Why players' rolls can't be made here, once that's known; and their attacks, when rolls can.
    const rollsUnavailable = (diceStatus.ready || (diceStatus.reason === "pending")) ? null
      : game.i18n.format("SENDINGSTONE.Config.Actions.Unavailable", {
        reason: game.i18n.localize(`SENDINGSTONE.Config.Actions.RollsReason.${diceStatus.reason}`)
      });
    const attacksReason = rollsUnavailable ? null : attacksUnavailable();
    const manualDice = moduleState(MANUAL_DICE);
    return {
      rolls: campaign.rolls,
      attacks: campaign.attacks,
      prompts: campaign.prompts,
      manualDice: campaign.manualDice,
      rollsUnavailable,
      attacksUnavailable: (attacksReason && (attacksReason !== "pending"))
        ? game.i18n.format("SENDINGSTONE.Config.Actions.Unavailable", {
          reason: game.i18n.localize(`SENDINGSTONE.Config.Actions.AttacksReason.${attacksReason}`)
        }) : null,
      // Allowed only while Manual Dice is on. A choice saved while it was is shown as saved, and
      // kept, but can't be changed until it's on again.
      dice: {
        ready: manualDice === "active",
        enabled: campaign.rolls && (manualDice === "active"),
        note: game.i18n.localize(`SENDINGSTONE.Config.Actions.ManualDice.${manualDice}`)
      },
      transfers: campaign.transfers,
      transfersUnavailable: (game.system?.id !== "dnd5e")
        ? game.i18n.format("SENDINGSTONE.Config.Actions.Unavailable", {
          reason: game.i18n.localize("SENDINGSTONE.Config.Actions.RollsReason.system")
        }) : null,
      transfersApp: campaign.transfers && commandsOffered(campaign.id) && !transferReader(campaign.id),
      dishes: campaign.dishes,
      dishesSystem: !dishSystem(),
      dishesApp: campaign.dishes && commandsOffered(campaign.id) && !dishReader(campaign.id),
      // Since 0.36.0, how its companions enter initiative, which needs no app: it's kept here.
      initiativeChoices: [
        { value: COMPANION_INITIATIVE.OWN, key: "CompanionInitiativeOwn" },
        { value: COMPANION_INITIATIVE.AFTER, key: "CompanionInitiativeAfter" }
      ].map(({ value, key }) => ({
        value,
        label: game.i18n.localize(`SENDINGSTONE.Config.Actions.${key}`),
        selected: campaign.companionInitiative === value
      }))
    };
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    this.#statusHook = Hooks.on(STATUS_HOOK, () => this.#showStatus());
    // What players see in chat follows dnd5e's and Midi-QOL's settings, which change elsewhere.
    this.#resultsHooks = ["createSetting", "updateSetting"].map(hook => [hook, Hooks.on(hook, setting => {
      if ( WATCHED_SETTINGS.has(setting?.key) ) this.#showResults();
    })]);
    this.element.addEventListener("change", event => this.#onEdit(event));
    this.element.addEventListener("input", event => this.#onEdit(event));
    this.element.addEventListener("keydown", event => this.#onKeyDown(event));
    this.element.addEventListener("focusin", event => {
      const mark = event.target.closest?.(FOCUS_TOOLTIPS);
      if ( mark ) game.tooltip?.activate(mark, { text: mark.dataset.tooltip });
    });
    this.element.addEventListener("focusout", event => {
      if ( event.target.closest?.(FOCUS_TOOLTIPS) ) game.tooltip?.deactivate();
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender?.(context, options);
    this.#applyFilters();
    this.#countPicks();
    this.#countPartyPicks();
    const { focus, top } = this.#after;
    this.#after = { focus: null, top: false };
    if ( top ) this.element.querySelector(".sending-stone-scroll")?.scrollTo(0, 0);
    if ( focus ) this.element.querySelector(focus)?.focus();
  }

  /** @inheritDoc */
  _onClose(options) {
    super._onClose?.(options);
    if ( this.#statusHook !== null ) Hooks.off(STATUS_HOOK, this.#statusHook);
    this.#statusHook = null;
    for ( const [hook, id] of this.#resultsHooks ) Hooks.off(hook, id);
    this.#resultsHooks = [];
  }

  /**
   * Open a section, or a campaign at a tab, and render it.
   * @param {{section: string, campaignId?: string|null, tab?: string}} view
   * @param {string|null} [focus]   What to focus once it's drawn, as a selector.
   * @returns {Promise<void>}
   */
  async #show(view, focus=null) {
    const moved = (view.section !== this.#view.section) || ((view.campaignId ?? null) !== this.#view.campaignId);
    this.#view = { section: view.section, campaignId: view.campaignId ?? null, tab: view.tab ?? "players" };
    this.#picker = false;
    this.#partyPicker = false;
    if ( moved ) {
      this.#revealed = false;
      this.#filters.players = "";
    }
    this.#after = { focus, top: true };
    await this.render();
  }

  /* -------------------------------------------- */
  /*  Live updates                                */
  /* -------------------------------------------- */

  /**
   * Keep an edit as it's made, and show what follows from it without redrawing: fields that
   * depend on it, campaign titles and counts, and whether anything is unsaved.
   * @param {Event} event
   * @returns {void}
   */
  #onEdit(event) {
    const target = event.target;
    if ( target.dataset?.filter ) {
      this.#filters[target.dataset.filter] = target.value;
      this.#applyFilters();
      return;
    }
    if ( target.dataset?.pick ) {
      this.#countPicks();
      return;
    }
    if ( target.dataset?.pickParty ) {
      this.#countPartyPicks();
      return;
    }
    if ( !target.name ) return;
    this.#capture();
    for ( const name of DEPENDENTS[target.name] ?? [] ) {
      const field = this.element.querySelector(`[name="${name}"]`);
      if ( !field ) continue;
      // One that can't be changed for a reason of its own, as without Manual Dice, stays so.
      const off = !target.checked || ("locked" in field.dataset);
      field.disabled = off;
      field.closest(".form-group")?.classList.toggle("disabled", off);
    }
    for ( const note of this.element.querySelectorAll(`[data-needs="${target.name}"]`) ) note.hidden = target.checked;
    if ( target.name === "campaign.title" ) this.#showTitles();
    if ( target.name.startsWith("roster.") ) this.#showCounts();
    this.#showDirty();
  }

  /**
   * Keep Enter in a filter from saving the window, and Escape in the character picker from
   * closing it.
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  #onKeyDown(event) {
    if ( (event.key === "Enter") && event.target.dataset?.filter ) event.preventDefault();
    if ( (event.key === "Escape") && this.#picker ) {
      event.preventDefault();
      event.stopPropagation();
      SettingsWindow.#onClosePicker.call(this);
    }
    else if ( (event.key === "Escape") && this.#partyPicker ) {
      event.preventDefault();
      event.stopPropagation();
      SettingsWindow.#onClosePartyPicker.call(this);
    }
  }

  /**
   * Show each list's rows that match what it's filtered by, and each group with any shown.
   * @returns {void}
   */
  #applyFilters() {
    const lang = game.i18n.lang;
    for ( const list of this.element.querySelectorAll("[data-filter-list]") ) {
      const kind = list.dataset.filterList;
      const query = String(this.#filters[kind] ?? "").trim().toLocaleLowerCase(lang);
      let any = false;
      for ( const item of list.querySelectorAll("[data-search]") ) {
        let shown = !query || item.dataset.search.includes(query);
        if ( (kind === "picker") && (this.#filters.pickerScope === "outside") ) shown &&= item.dataset.inCampaign !== "true";
        if ( (kind === "roster") && (this.#filters.rosterScope === "unassigned") ) shown &&= item.dataset.unassigned === "true";
        item.hidden = !shown;
        any ||= shown;
      }
      for ( const group of list.querySelectorAll("[data-filter-group]") ) {
        group.hidden = !group.querySelector("[data-search]:not([hidden])");
      }
      const empty = list.querySelector("[data-filter-empty]");
      if ( empty ) empty.hidden = any;
    }
  }

  /**
   * Say how many characters are picked to add, and offer each group's to all be picked or none.
   * @returns {void}
   */
  #countPicks() {
    const picker = this.element.querySelector("[data-picker]");
    if ( !picker ) return;
    const picked = picker.querySelectorAll("[data-pick]:checked:not(:disabled)").length;
    picker.querySelector("[data-pick-count]").textContent = picked
      ? game.i18n.format("SENDINGSTONE.Config.Picker.Selected", { count: picked })
      : game.i18n.localize("SENDINGSTONE.Config.Picker.NoneSelected");
    picker.querySelector("[data-action='addPicked']").disabled = !picked;
    for ( const group of picker.querySelectorAll("[data-filter-group]") ) {
      const boxes = SettingsWindow.#pickable(group);
      const button = group.querySelector("[data-action='pickGroup']");
      button.hidden = !boxes.length;
      button.textContent = game.i18n.localize(`SENDINGSTONE.Config.Picker.${(boxes.length && boxes.every(box => box.checked)) ? "Clear" : "SelectAll"}`);
    }
  }

  /**
   * Say how many groups are picked to add.
   * @returns {void}
   */
  #countPartyPicks() {
    const picker = this.element.querySelector("[data-party-picker]");
    if ( !picker ) return;
    const picked = picker.querySelectorAll("[data-pick-party]:checked:not(:disabled)").length;
    picker.querySelector("[data-pick-party-count]").textContent = picked
      ? game.i18n.format("SENDINGSTONE.Config.Picker.Selected", { count: picked })
      : game.i18n.localize("SENDINGSTONE.Config.Picker.NoneSelected");
    picker.querySelector("[data-action='addPickedParties']").disabled = !picked;
  }

  /**
   * A group's characters that can be picked and are shown.
   * @param {HTMLElement} group
   * @returns {HTMLInputElement[]}
   */
  static #pickable(group) {
    return Array.from(group.querySelectorAll("[data-pick]:not(:disabled)"))
      .filter(box => !box.closest("[data-search]")?.hidden);
  }

  /**
   * Show the open campaign's title, as typed, wherever it's named.
   * @returns {void}
   */
  #showTitles() {
    const campaign = this.#current();
    if ( !campaign ) return;
    for ( const element of this.element.querySelectorAll(`[data-campaign-title="${campaign.id}"]`) ) {
      element.textContent = this.#titleOf(campaign);
      element.classList.toggle("untitled", !campaign.title.trim());
    }
  }

  /**
   * Show how many characters each campaign has, and which are in none, as ticked in the Roster.
   * @returns {void}
   */
  #showCounts() {
    for ( const campaign of this.#campaigns ) {
      for ( const element of this.element.querySelectorAll(`[data-campaign-count="${campaign.id}"]`) ) {
        element.textContent = String(this.#countOf(campaign));
      }
    }
    let unassigned = 0;
    for ( const row of this.element.querySelectorAll("[data-unassigned]") ) {
      const none = !this.#campaigns.some(campaign => campaign.characters.has(row.dataset.actorId));
      row.dataset.unassigned = String(none);
      unassigned += Number(none);
    }
    const label = this.element.querySelector("[data-unassigned-count]");
    if ( label ) label.textContent = game.i18n.format("SENDINGSTONE.Config.Roster.Unassigned", { count: unassigned });
  }

  /**
   * Say whether anything is unsaved.
   * @returns {void}
   */
  #showDirty() {
    const output = this.element.querySelector("[data-dirty]");
    if ( !output ) return;
    const dirty = this.#snapshot() !== this.#saved;
    if ( output.dataset.dirty === String(dirty) ) return;
    output.dataset.dirty = String(dirty);
    output.textContent = game.i18n.localize(`SENDINGSTONE.Config.${dirty ? "Unsaved" : "NoChanges"}`);
  }

  /**
   * Rewrite what players see in chat as the saved settings now say, leaving the rest of the window,
   * and what has been typed in it, as it is.
   * @returns {void}
   */
  #showResults() {
    if ( !this.element ) return;
    const line = verdictLine();
    for ( const element of this.element.querySelectorAll("[data-results]") ) element.textContent = line;
  }

  /**
   * Rewrite each saved campaign's status as it now stands, leaving the rest of the window, and
   * what has been typed in it, as it is.
   * @returns {void}
   */
  #showStatus() {
    if ( !this.element ) return;
    const saved = new Map(getCampaigns().map(campaign => [campaign.id, campaign]));
    for ( const campaign of this.#campaigns ) {
      if ( !saved.has(campaign.id) ) continue;
      const { state, stateLabel, stateTooltip, lines } = this.#stateOf(campaign, saved);
      for ( const element of this.element.querySelectorAll(`[data-campaign-state="${campaign.id}"]`) ) {
        element.dataset.state = state;
        element.dataset.tooltip = stateTooltip;
      }
      for ( const element of this.element.querySelectorAll(`[data-campaign-state-label="${campaign.id}"]`) ) {
        element.textContent = stateLabel;
      }
      const output = this.element.querySelector(`[data-campaign-status="${campaign.id}"]`);
      output?.replaceChildren(...lines.map(({ state, text }) => {
        const line = output.ownerDocument.createElement("span");
        line.dataset.state = state;
        line.textContent = text;
        return line;
      }));
    }
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * Open the section, campaign or tab a button names. A campaign opens at the tab open before.
   * Focus stays on the button as drawn again, in the side or the tabs; from anywhere else, it
   * moves to the section's heading.
   * @this {SettingsWindow}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   * @returns {Promise<void>}
   */
  static async #onView(_event, target) {
    const { section, campaignId=null, tab } = target.dataset;
    const keep = (this.#view.section === "campaign") ? this.#view.tab : "players";
    const same = Object.entries({ section, "campaign-id": campaignId, tab })
      .filter(([, value]) => value)
      .map(([key, value]) => `[data-${key}="${value}"]`)
      .join("");
    const focus = target.closest("nav") ? `[data-action="view"]${same}` : ".sending-stone-content h2";
    await this.#show({ section, campaignId, tab: tab ?? keep }, focus);
  }

  /**
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onAddCampaign() {
    const campaign = {
      id: foundry.utils.randomID(), title: "", secret: "", characters: new Set(), groups: new Set(), rolls: false,
      attacks: false, prompts: false, manualDice: false, transfers: false, dishes: false,
      companionInitiative: COMPANION_INITIATIVE.OWN
    };
    this.#campaigns.push(campaign);
    await this.#show({ section: "campaign", campaignId: campaign.id, tab: "connection" }, "[name='campaign.title']");
  }

  /**
   * Remove the open campaign, and open the next, or else General.
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onRemoveCampaign() {
    const index = this.#campaigns.findIndex(campaign => campaign.id === this.#view.campaignId);
    if ( index < 0 ) return;
    const [removed] = this.#campaigns.splice(index, 1);
    this.#tests.delete(removed.id);
    const next = this.#campaigns[index] ?? this.#campaigns[index - 1];
    await this.#show(next ? { section: "campaign", campaignId: next.id } : { section: "general" });
  }

  /**
   * Post a connection test for the open campaign, with the address, title and secret as typed, and
   * report the outcome, where it stays until it's tested again. The app checks that the campaign
   * is set up with it and that the secret is the campaign's.
   * @this {SettingsWindow}
   * @param {PointerEvent} event                The originating click event.
   * @param {HTMLButtonElement} target          The test button.
   * @returns {Promise<void>}
   */
  static async #onTestCampaign(event, target) {
    event.preventDefault();
    this.#capture();
    const current = this.#current();
    if ( !current ) return;
    const { id } = current;
    const output = this.element.querySelector("[data-test-result]");
    this.#tests.delete(id);
    const report = (state, text) => {
      output.dataset.state = state;
      output.textContent = text;
      if ( state !== "pending" ) this.#tests.set(id, { state, text });
    };

    const destination = this.#general.destination.trim();
    const parsed = parseDestination(destination);
    if ( !parsed ) return report("error", game.i18n.localize("SENDINGSTONE.Error.InvalidDestination"));
    const campaign = { id, title: current.title.trim() };
    if ( !campaign.title ) return report("error", game.i18n.localize("SENDINGSTONE.Config.TitleRequired"));
    const secret = current.secret.trim();

    target.disabled = true;
    report("pending", game.i18n.localize("SENDINGSTONE.Test.Testing"));
    try {
      const data = { userId: game.user.id, name: game.user.name };
      const envelope = buildEnvelope(EVENTS.PING, data, { campaign, sequenced: false });
      const result = await deliver(envelope, { destination, secret });
      const lines = [game.i18n.format("SENDINGSTONE.Test.Ok", result)];
      // Events go as saved, which this test may not be.
      const saved = getCampaigns().find(c => c.id === id);
      if ( (parsed.origin !== getDestination()) || (saved?.title !== campaign.title) || (getSecret(id) !== secret) ) {
        lines.push(game.i18n.localize("SENDINGSTONE.Test.Unsaved"));
      }
      report("ok", lines.join(" "));
    } catch (err) {
      report("error", SettingsWindow.#describeFailure(err, parsed, campaign));
    } finally {
      target.disabled = false;
    }
  }

  /**
   * Why a connection test failed, and what to do, as the Gamemaster is told when events fail; and
   * for a request that failed outright, what usually causes it.
   * @param {unknown} err                       What the delivery threw.
   * @param {URL} parsed                        The destination tested.
   * @param {{id: string, title: string}} campaign   The campaign tested, as typed.
   * @returns {string}
   */
  static #describeFailure(err, parsed, campaign) {
    const { problem, fix } = describeProblem(err, { campaign, destination: parsed.origin });
    const lines = [`${problem} ${fix}`];
    // The browser hides why a request failed outright, so list what usually causes it.
    if ( (err instanceof DeliveryError) && (err.status === null) && ["unreachable", "timeout"].includes(err.reason) ) {
      const mixed = game.i18n.localize("SENDINGSTONE.Test.HintMixedContent");
      if ( isMixedContent(parsed) && (fix !== mixed) ) lines.push(mixed);
      lines.push(game.i18n.localize("SENDINGSTONE.Test.HintNetwork"));
    }
    return lines.join("\n");
  }

  /**
   * Show the open campaign's secret as typed, or hide it again.
   * @this {SettingsWindow}
   * @param {PointerEvent} _event
   * @param {HTMLButtonElement} target
   * @returns {void}
   */
  static #onRevealSecret(_event, target) {
    this.#revealed = !this.#revealed;
    const input = this.element.querySelector("[name='campaign.secret']");
    if ( input ) input.type = this.#revealed ? "text" : "password";
    const label = game.i18n.localize(`SENDINGSTONE.Config.Connection.${this.#revealed ? "Hide" : "Show"}`);
    target.setAttribute("aria-pressed", String(this.#revealed));
    target.setAttribute("aria-label", label);
    target.dataset.tooltip = label;
    target.classList.toggle("fa-eye", !this.#revealed);
    target.classList.toggle("fa-eye-slash", this.#revealed);
  }

  /**
   * @this {SettingsWindow}
   * @param {PointerEvent} _event
   * @param {HTMLButtonElement} target   The remove button, carrying the character's id.
   * @returns {Promise<void>}
   */
  static async #onRemoveCharacter(_event, target) {
    this.#current()?.characters.delete(target.dataset.actorId);
    this.#after.focus = "[data-filter='players'], [data-action='openPicker']";
    await this.render();
  }

  /**
   * Add every character of the campaign chosen to copy from to the open campaign.
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onCopyCharacters() {
    const campaign = this.#current();
    const source = this.#campaigns.find(c => c.id === this.element.querySelector("[data-copy-source]")?.value);
    if ( !campaign || !source ) return;
    for ( const id of source.characters ) campaign.characters.add(id);
    this.#after.focus = "[data-filter='players']";
    await this.render();
  }

  /**
   * Show the characters that can be added to the open campaign in place of its players.
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onOpenPicker() {
    this.#picker = true;
    this.#filters.picker = "";
    this.#after = { focus: "[data-filter='picker']", top: true };
    await this.render();
  }

  /**
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onClosePicker() {
    this.#picker = false;
    this.#after = { focus: "[data-action='openPicker']", top: true };
    await this.render();
  }

  /**
   * Pick every shown character of a group, or none if all are picked.
   * @this {SettingsWindow}
   * @param {PointerEvent} _event
   * @param {HTMLButtonElement} target
   * @returns {void}
   */
  static #onPickGroup(_event, target) {
    const boxes = SettingsWindow.#pickable(target.closest("[data-filter-group]"));
    const pick = !boxes.every(box => box.checked);
    for ( const box of boxes ) box.checked = pick;
    this.#countPicks();
  }

  /**
   * Add the characters picked to the open campaign, and show its players again.
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onAddPicked() {
    const campaign = this.#current();
    if ( !campaign ) return;
    for ( const box of this.element.querySelectorAll("[data-pick]:checked:not(:disabled)") ) {
      campaign.characters.add(box.dataset.pick);
    }
    await SettingsWindow.#onClosePicker.call(this);
  }

  /**
   * Show the groups that can be added to the open campaign in place of its parties.
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onOpenPartyPicker() {
    this.#partyPicker = true;
    this.#after = { focus: "[data-pick-party]:not(:disabled), [data-action='closePartyPicker']", top: true };
    await this.render();
  }

  /**
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onClosePartyPicker() {
    this.#partyPicker = false;
    this.#after = { focus: "[data-action='openPartyPicker']", top: true };
    await this.render();
  }

  /**
   * Add the groups picked to the open campaign, after those it has, and show its parties again.
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onAddPickedParties() {
    const campaign = this.#current();
    if ( !campaign ) return;
    for ( const box of this.element.querySelectorAll("[data-pick-party]:checked:not(:disabled)") ) {
      campaign.groups.add(box.dataset.pickParty);
    }
    await SettingsWindow.#onClosePartyPicker.call(this);
  }

  /**
   * @this {SettingsWindow}
   * @param {PointerEvent} _event
   * @param {HTMLButtonElement} target   The remove button, carrying the group's id.
   * @returns {Promise<void>}
   */
  static async #onRemoveParty(_event, target) {
    this.#current()?.groups.delete(target.dataset.groupId);
    this.#after.focus = "[data-action='openPartyPicker']";
    await this.render();
  }

  /**
   * Show a list's characters in one scope or another: the picker's, those not in the campaign or
   * everyone; the Roster's, everyone or those in no campaign.
   * @this {SettingsWindow}
   * @param {PointerEvent} _event
   * @param {HTMLButtonElement} target   Carrying the filter it sets and its value.
   * @returns {void}
   */
  static #onFilterScope(_event, target) {
    const { filterScope, value } = target.dataset;
    this.#filters[filterScope] = value;
    for ( const button of target.parentElement.querySelectorAll("[data-filter-scope]") ) {
      button.setAttribute("aria-pressed", String(button === target));
    }
    this.#applyFilters();
    this.#countPicks();
  }

  /**
   * Persist the address, what's sent and the campaigns for the world, and each campaign's secret
   * for this browser. Every section's edits are kept as they're made, so what's saved doesn't
   * depend on the section open. A problem opens where it is.
   * @this {SettingsWindow}
   * @returns {Promise<void>}
   */
  static async #onSubmit() {
    this.#capture();
    const destination = this.#general.destination.trim();
    const parsed = parseDestination(destination);
    const campaigns = this.#campaigns.map(campaign => ({
      ...campaign,
      title: campaign.title.trim(),
      secret: campaign.secret.trim(),
      characters: Array.from(campaign.characters).filter(id => game.actors.has(id)),
      groups: Array.from(campaign.groups).filter(isGroup)
    }));

    // Thrown rather than notified, so that the window stays open with what was entered. Each
    // campaign is matched to the one set up in the app by its title, so titles must be present
    // and tell campaigns apart.
    if ( destination && !parsed ) {
      await this.#show({ section: "general" }, "[name='destination']");
      throw new Error(game.i18n.localize("SENDINGSTONE.Error.InvalidDestination"));
    }
    const seen = new Set();
    for ( const campaign of campaigns ) {
      const key = campaign.title.toLocaleLowerCase(game.i18n.lang);
      const problem = !campaign.title ? "TitleRequired" : seen.has(key) ? "TitleTaken" : null;
      seen.add(key);
      if ( !problem ) continue;
      await this.#show({ section: "campaign", campaignId: campaign.id, tab: "connection" }, "[name='campaign.title']");
      throw new Error(game.i18n.localize(`SENDINGSTONE.Config.${problem}`));
    }

    // Secrets first: the others each tell every campaign afresh, which needs them.
    const secrets = Object.fromEntries(campaigns.filter(campaign => campaign.secret)
      .map(campaign => [campaign.id, campaign.secret]));
    await game.settings.set(MODULE_ID, SETTINGS.CAMPAIGN_SECRETS, secrets);
    await game.settings.set(MODULE_ID, SETTINGS.DESTINATION, parsed?.origin ?? "");
    await game.settings.set(MODULE_ID, SETTINGS.CAMPAIGNS, campaigns.map(campaign => ({
      id: campaign.id,
      title: campaign.title,
      characters: campaign.characters,
      groups: campaign.groups,
      rolls: campaign.rolls,
      attacks: campaign.attacks,
      prompts: campaign.prompts,
      manualDice: campaign.manualDice,
      transfers: campaign.transfers,
      dishes: campaign.dishes,
      companionInitiative: campaign.companionInitiative
    })));
    for ( const [name, key] of Object.entries(GENERAL) ) {
      const value = this.#general[name];
      if ( game.settings.get(MODULE_ID, key) !== value ) await game.settings.set(MODULE_ID, key, value);
    }
    ui.notifications.info("SENDINGSTONE.Config.Saved", { localize: true });
    if ( parsed && isMixedContent(parsed) ) {
      ui.notifications.warn("SENDINGSTONE.Test.HintMixedContent", { localize: true });
    }
  }
}

/**
 * Is an id, or an actor, one of the world's Group actors?
 * @param {string|Actor|null|undefined} idOrActor
 * @returns {boolean}
 */
function isGroup(idOrActor) {
  const actor = (typeof idOrActor === "string") ? game.actors.get(idOrActor) : idOrActor;
  return actor?.type === "group";
}

/**
 * What players see in chat, as the saved settings have it, in one line: for the campaign's header.
 * @returns {string}
 */
function verdictLine() {
  const lines = resultsVerdict().map(line => line.text);
  return `${game.i18n.localize("SENDINGSTONE.Results.Lead")} ${lines.join(" · ")}`;
}

/**
 * A count of characters or players, as said in the window, such as "1 character" or "6 players".
 * @param {number} number
 * @param {"Character"|"Player"} noun
 * @returns {string}
 */
function count(number, noun) {
  return (number === 1) ? game.i18n.localize(`SENDINGSTONE.Config.Count.${noun}`)
    : game.i18n.format(`SENDINGSTONE.Config.Count.${noun}s`, { count: number });
}
