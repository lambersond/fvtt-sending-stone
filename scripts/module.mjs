import { checkBridge, resendHello } from "./bridge.mjs";
import { eventDropped, helloDelivered, registerCharacterHooks, sheetTermsChanged } from "./character-sync.mjs";
import { markAppRoll } from "./command-rolls.mjs";
import { noteListenerFeatures, registerCommandHooks } from "./commands.mjs";
import {
  EVENT_DROPPED_HOOK, HELLO_DELIVERED_HOOK, HELLO_WANTED_HOOK, LISTENER_FEATURES_HOOK, SHEET_TERMS_HOOK
} from "./constants.mjs";
import { migrateConnectedCharacters } from "./campaigns.mjs";
import { registerChatHooks } from "./chat.mjs";
import { registerCombatHooks } from "./combat.mjs";
import { installDicePlans, selfTest } from "./dice-plan.mjs";
import { startHeartbeat } from "./heartbeat.mjs";
import { registerPromptHooks } from "./prompts.mjs";
import { registerSettings } from "./settings.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerChatHooks();
  registerCombatHooks();
  registerCharacterHooks();
  registerPromptHooks();
  registerCommandHooks();
});

// Every client registers the hooks, but only the active Gamemaster's posts anything. That role can
// move mid-session, when Gamemasters connect or disconnect, so it is checked on each change and
// whichever client gains it sends the listener the current state. Any Gamemaster's client may make
// players' rolls from the app, so each is ready to, once it has checked it can, before the
// campaigns are told whether their players' rolls are made here.
Hooks.once("ready", async () => {
  await migrateConnectedCharacters();
  if ( game.user.isGM ) {
    // Players' rolls are made under D&D Fifth Edition only; under another system, dice are left be.
    if ( game.system.id === "dnd5e" ) installDicePlans();
    await selfTest();
  }
  checkBridge();
  startHeartbeat();
});
Hooks.on("userConnected", checkBridge);
Hooks.on(HELLO_WANTED_HOOK, resendHello);
Hooks.on(LISTENER_FEATURES_HOOK, noteListenerFeatures);
Hooks.on(HELLO_DELIVERED_HOOK, helloDelivered);
Hooks.on(SHEET_TERMS_HOOK, sheetTermsChanged);
Hooks.on(EVENT_DROPPED_HOOK, eventDropped);
Hooks.on("dnd5e.renderChatMessage", markAppRoll);
