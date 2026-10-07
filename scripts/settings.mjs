import { CHAT_SCOPES, MODULE_ID, SETTINGS } from "./constants.mjs";
import { announce } from "./bridge.mjs";
import CampaignConfig from "./apps/campaign-config.mjs";

const { ArrayField, BooleanField, SchemaField, SetField, StringField } = foundry.data.fields;

/**
 * Register this module's settings and setting menus.
 * @returns {void}
 */
export function registerSettings() {
  // Saving the settings form writes each changed setting separately. Debounced so that changing
  // several at once sends the listener one fresh state rather than one per setting.
  const reannounce = foundry.utils.debounce(announce, 250);

  // Where events go, and each campaign's secret, are edited in Manage Campaigns, which can test a
  // campaign's connection before saving. Only the destination's origin is kept.
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
    name: "SENDINGSTONE.Settings.Campaigns.Name",
    label: "SENDINGSTONE.Settings.Campaigns.Label",
    hint: "SENDINGSTONE.Settings.Campaigns.Hint",
    icon: "fa-solid fa-flag",
    type: CampaignConfig,
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
      rolls: new BooleanField({ initial: false })
    })),
    default: [],
    onChange: () => reannounce()
  });

  // Kept only so connected characters chosen before campaigns can be moved into one.
  game.settings.register(MODULE_ID, SETTINGS.CHARACTERS, {
    scope: "world",
    config: false,
    type: new SetField(new StringField({ blank: false })),
    default: []
  });

  game.settings.register(MODULE_ID, SETTINGS.CHAT_EVENTS, {
    name: "SENDINGSTONE.Settings.ChatEvents.Name",
    hint: "SENDINGSTONE.Settings.ChatEvents.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => reannounce()
  });

  game.settings.register(MODULE_ID, SETTINGS.CHAT_SCOPE, {
    name: "SENDINGSTONE.Settings.ChatScope.Name",
    hint: "SENDINGSTONE.Settings.ChatScope.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [CHAT_SCOPES.ALL]: "SENDINGSTONE.Settings.ChatScope.All",
      [CHAT_SCOPES.CONNECTED]: "SENDINGSTONE.Settings.ChatScope.Connected"
    },
    default: CHAT_SCOPES.ALL,
    onChange: () => reannounce()
  });

  game.settings.register(MODULE_ID, SETTINGS.COMBAT_EVENTS, {
    name: "SENDINGSTONE.Settings.CombatEvents.Name",
    hint: "SENDINGSTONE.Settings.CombatEvents.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => reannounce()
  });

  game.settings.register(MODULE_ID, SETTINGS.GM_CONTENT, {
    name: "SENDINGSTONE.Settings.GmContent.Name",
    hint: "SENDINGSTONE.Settings.GmContent.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => reannounce()
  });
}
