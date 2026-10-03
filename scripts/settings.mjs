import { CHAT_SCOPES, MODULE_ID, SETTINGS } from "./constants.mjs";
import { announce, announceCharacters } from "./bridge.mjs";
import CharacterConfig from "./apps/character-config.mjs";
import ConnectionConfig from "./apps/connection-config.mjs";

/**
 * Register this module's settings and setting menus.
 * @returns {void}
 */
export function registerSettings() {
  // Saving the settings form writes each changed setting separately. Debounced so that changing
  // several at once sends the listener one fresh state rather than one per setting.
  const reannounce = foundry.utils.debounce(announce, 250);

  // Where events go, and how the bridge authenticates. Edited together in their own dialog, which
  // can test the connection before saving.
  game.settings.registerMenu(MODULE_ID, SETTINGS.CONNECTION, {
    name: "SENDINGSTONE.Settings.Connection.Name",
    label: "SENDINGSTONE.Settings.Connection.Label",
    hint: "SENDINGSTONE.Settings.Connection.Hint",
    icon: "fa-solid fa-tower-broadcast",
    type: ConnectionConfig,
    restricted: true
  });

  game.settings.register(MODULE_ID, SETTINGS.LISTENER_URL, {
    scope: "world",
    config: false,
    type: String,
    default: "",
    onChange: () => reannounce()
  });

  // Client scope: world settings are sent to every connected user, and players must not be able to
  // read the secret from their own browser.
  game.settings.register(MODULE_ID, SETTINGS.SECRET, {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS.CHARACTERS_MENU, {
    name: "SENDINGSTONE.Settings.Characters.Name",
    label: "SENDINGSTONE.Settings.Characters.Label",
    hint: "SENDINGSTONE.Settings.Characters.Hint",
    icon: "fa-solid fa-users",
    type: CharacterConfig,
    restricted: true
  });

  game.settings.register(MODULE_ID, SETTINGS.CHARACTERS, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.SetField(new foundry.data.fields.StringField({ blank: false })),
    default: [],
    onChange: () => announceCharacters()
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
