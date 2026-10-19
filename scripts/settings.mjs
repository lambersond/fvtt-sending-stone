import { CHAT_SCOPES, MODULE_ID, SETTINGS } from "./constants.mjs";
import { announce } from "./bridge.mjs";
import { getCampaigns } from "./campaigns.mjs";
import { MANUAL_DICE } from "./companions.mjs";
import SettingsWindow from "./apps/settings-window.mjs";

const { ArrayField, BooleanField, SchemaField, SetField, StringField } = foundry.data.fields;

/**
 * Register this module's settings and setting menus.
 * @returns {void}
 */
export function registerSettings() {
  // Saving the settings form writes each changed setting separately. Debounced so that changing
  // several at once sends the listener one fresh state rather than one per setting.
  const reannounce = foundry.utils.debounce(announce, 250);

  // Every setting is edited in the settings window, which can test a campaign's connection before
  // saving. Only the destination's origin is kept.
  game.settings.register(MODULE_ID, SETTINGS.DESTINATION, {
    scope: "world",
    config: false,
    type: String,
    default: "",
    onChange: () => reannounce()
  });

  // Client scope: world settings are sent to every connected user, and players must not be able to
  // read a secret from their own browser. A new secret may make a refused campaign welcome, so
  // every campaign is told afresh.
  game.settings.register(MODULE_ID, SETTINGS.CAMPAIGN_SECRETS, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
    onChange: () => reannounce()
  });

  // The secret from before each campaign had its own, still sent for a campaign without one.
  game.settings.register(MODULE_ID, SETTINGS.SECRET, {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS.CAMPAIGNS_MENU, {
    name: "SENDINGSTONE.Settings.Menu.Name",
    label: "SENDINGSTONE.Settings.Menu.Label",
    hint: "SENDINGSTONE.Settings.Menu.Hint",
    icon: "fa-solid fa-tower-broadcast",
    type: SettingsWindow,
    restricted: true
  });

  // Which campaign an event belongs to decides what it says, so every campaign is told afresh.
  game.settings.register(MODULE_ID, SETTINGS.CAMPAIGNS, {
    scope: "world",
    config: false,
    type: new ArrayField(new SchemaField({
      id: new StringField({ blank: false }),
      title: new StringField({ blank: false }),
      characters: new ArrayField(new StringField({ blank: false })),
      // Its Group actors, its parties, whose sheets its players may see as Foundry lets them.
      groups: new ArrayField(new StringField({ blank: false })),
      rolls: new BooleanField({ initial: false }),
      attacks: new BooleanField({ initial: false }),
      prompts: new BooleanField({ initial: false }),
      manualDice: new BooleanField({ initial: false })
    })),
    default: [],
    onChange: () => reannounce()
  });

  // Whether a campaign's players may enter their own dice results counts only while Manual Dice
  // is on, so switching it on or off in its own settings tells the campaigns that allow it afresh.
  // Enabling or disabling the module reloads the world, which tells every campaign anyway.
  const allowed = () => getCampaigns().some(campaign => campaign.rolls && campaign.manualDice);
  for ( const hook of ["createSetting", "updateSetting"] ) {
    Hooks.on(hook, setting => {
      if ( (setting?.key === `${MANUAL_DICE}.enabled`) && allowed() ) reannounce();
    });
  }

  // Kept only so connected characters chosen before campaigns can be moved into one.
  game.settings.register(MODULE_ID, SETTINGS.CHARACTERS, {
    scope: "world",
    config: false,
    type: new SetField(new StringField({ blank: false })),
    default: []
  });

  // What's sent, and how players' attacks are made, are edited in the settings window's General
  // section rather than Foundry's own list, beside the campaigns they apply to.
  game.settings.register(MODULE_ID, SETTINGS.CHAT_EVENTS, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => reannounce()
  });

  game.settings.register(MODULE_ID, SETTINGS.CHAT_SCOPE, {
    scope: "world",
    config: false,
    type: String,
    choices: {
      [CHAT_SCOPES.ALL]: "SENDINGSTONE.Config.General.ScopeAll",
      [CHAT_SCOPES.CONNECTED]: "SENDINGSTONE.Config.General.ScopeConnected"
    },
    default: CHAT_SCOPES.ALL,
    onChange: () => reannounce()
  });

  game.settings.register(MODULE_ID, SETTINGS.COMBAT_EVENTS, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => reannounce()
  });

  game.settings.register(MODULE_ID, SETTINGS.GM_CONTENT, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => reannounce()
  });

  // Shown in the settings window only where Midi-QOL is: without it, attacks and spells always take
  // dnd5e's own way. Whether they can be made here changes what each campaign is told.
  game.settings.register(MODULE_ID, SETTINGS.MIDI_INTEGRATION, {
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => reannounce()
  });

  // Midi-QOL targets only tokens the Gamemaster's canvas draws: those on the level and scene they
  // view. Whether a player's use at another is made anyway is checked as it's made.
  game.settings.register(MODULE_ID, SETTINGS.OFF_CANVAS_TARGETS, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  // How long Midi-QOL waits on a save asked in the app before going its own way. Never shown in
  // the settings window: a minute is what players get, and only tests make it shorter.
  game.settings.register(MODULE_ID, SETTINGS.MIDI_PROMPT_WAIT, {
    scope: "world",
    config: false,
    type: Number,
    default: 60_000
  });
}
