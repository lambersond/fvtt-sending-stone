import { checkBridge } from "./bridge.mjs";
import { migrateConnectedCharacters } from "./campaigns.mjs";
import { registerChatHooks } from "./chat.mjs";
import { registerCombatHooks } from "./combat.mjs";
import { registerSettings } from "./settings.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerChatHooks();
  registerCombatHooks();
});

// Every client registers the hooks, but only the active Gamemaster's posts anything. That role can
// move mid-session, when Gamemasters connect or disconnect, so it is checked on each change and
// whichever client gains it sends the listener the current state.
Hooks.once("ready", async () => {
  await migrateConnectedCharacters();
  checkBridge();
});
Hooks.on("userConnected", checkBridge);
