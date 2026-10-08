# Sending Stone

A Foundry VTT **v14** module that sends what happens at the table to the Sending Stone app, or any
listener that speaks its [protocol](PROTOCOL.md). Chat messages and combat tracker changes are
posted as JSON, campaign by campaign, so players can follow their game as it happens.

It is built for D&D Fifth Edition (dnd5e 5.3.x): roll messages carry the kind of roll, advantage,
and the item, activity and targets involved. Chat and combat events work under any system.

It also works the other way, for a campaign whose Gamemaster lets it: checks, saving throws,
initiative and death saving throws a player rolls in the app are made in Foundry with the dice they
rolled, as if they had rolled them there, and so can their attacks, spells and features and their
damage or healing, through Midi-QOL's workflow where it's in use. See
[Players' rolls](#players-rolls) and [Players' attacks and spells](#players-attacks-and-spells).

## How it works

Foundry modules run in each user's browser, not on the Foundry server. Document hooks fire on
every connected client, so if every browser posted what it saw, the listener would receive each
event once per user. Only the **active Gamemaster's** browser posts, which means:

- **Nothing is sent while no Gamemaster is connected.**
- The Gamemaster sees every message and combatant, so the module, not the listener, decides what
  players may see. See [What the listener sees](#what-the-listener-sees).
- If a second Gamemaster connects and takes over as the active Gamemaster, their browser takes
  over sending and starts by sending the listener the full current state.

Events are posted one per request, in order. Failed posts that might succeed later are retried
twice; after that the event is dropped and the Gamemaster is warned once. The full wire format is
in [PROTOCOL.md](PROTOCOL.md).

## Setup

1. **Gamemaster, in the Sending Stone app:** under *Campaigns*, set up each campaign with its
   title, your game's Forge address and a secret.
2. **Gamemaster, in Foundry:** *Settings → Configure Settings → Sending Stone → Manage
   Campaigns*. Enter the **Sending Stone Address**, such as `https://sending-stone.vercel.app`.
   Events go to `/api/events` under it; you don't type that part. Then add each campaign with the
   same title and secret as in the app, and tick its player characters. **Test** checks a
   campaign's connection before saving.
3. **Gamemaster:** switch on **Send Chat Events** and/or **Send Combat Events**. Then share each
   campaign's invite link from the app; players open it and choose their character.

While a Gamemaster has the game open, each campaign that has been sent nothing else for 30
seconds is sent a heartbeat, so the app can show players whether the game is connected.

Each campaign's characters are sent with their sheets under D&D Fifth Edition: abilities, saves,
skills, hit points, armor class and the like, as dnd5e shows them, along with their features,
conditions and effects, inventory, spells, traits and biography, and their actions, as Tidy 5e's
Actions tab lists them, with each one's bonus to hit, saving throw and damage, as are the spells,
features and inventory items that roll anything, and their favorites, as dnd5e's sheet shows them.
When a character
changes, such as taking damage, levelling up or gaining a condition, its campaigns are sent it again, so players can see their character and roll from it
in the app. Descriptions, enriched as the player would see them in Foundry, are sent once and
then only when one is new, since they are most of a sheet's size.

| Setting | Effect |
| --- | --- |
| Manage Campaigns | The Sending Stone app's address, and each campaign: its title, its secret (sent as `Authorization: Bearer …` with its events), its player characters, and whether its players' rolls, and attacks and spells, in the app are made here. Each event goes to the campaigns it involves. |
| Send Chat Events | Chat messages created, edited and deleted, and the log being cleared. |
| Chat Messages to Send | Every message a campaign's players can read, or only those its characters spoke. |
| Send Combat Events | Encounters created, started, updated and ended; turns and rounds; combatants joining, leaving, rolling initiative and being defeated. |
| Send Gamemaster-Only Information | Also send what only a Gamemaster can see. Off by default. |
| Make Players' Attacks and Spells Through Midi-QOL | Shown while Midi-QOL is active. On by default: players' attacks, spells and features from the app go through Midi's workflow. Off: they stay in the app while Midi handles items' uses. |
| Allow Targets You Aren't Viewing | Shown while Midi-QOL is active. Off by default: a player's use through Midi at a target on a level or scene you aren't viewing is refused. On: it's made, and you apply to such targets from its card what Midi can't. |

**Each campaign's secret is stored only in the browser you enter it in.** World settings are sent
to every connected user, so a secret stored there could be read by players. Enter the secrets in
each browser a Gamemaster runs the game from. A campaign without its own secret is sent the single
secret from before campaigns had their own, if this browser has one.

### Campaigns

A world can run more than one campaign, such as two parties sharing a setting, and a character can
be in more than one. Every event names the campaign it is for, and each campaign gets only what
involves its characters, described for it alone:

- **Chat:** messages one of its characters said, or that the player of one of its characters can
  read. Every public message reaches every campaign with characters.
- **Combat:** encounters while any of its characters are in them. A fight reaches the campaign
  when its first character joins and ends for it when its last one leaves.
- **Hit points and audiences** cover only its own characters.

Worlds set up before campaigns keep working: the connected characters chosen then are moved into a
campaign titled after the world the first time a Gamemaster loads it.

### Players' rolls

Tick **Let Players Roll from Sending Stone** for a campaign in Manage Campaigns, and its players'
skill, tool and ability checks, saving throws, initiative and death saving throws in the app are
made in Foundry too, with the dice they rolled there: the d20s, and any dice they added, such as
a d4 for Bless. dnd5e makes each roll, without its dialog, as the character's player, so its card,
critical hits, death saving throws, the combat tracker, Dice So Nice and Midi-QOL all behave as if
they had rolled in Foundry. Each card is marked as rolled on Sending Stone.

- **Under D&D Fifth Edition only.** The Gamemaster's browser makes the rolls, so a Gamemaster must
  have the game open, as for everything else.
- **How it's rolled.** A tap in the app rolls as the character's sheet has it, so Foundry decides
  advantage. Choosing advantage, disadvantage or extra dice in the app is the player's say, as in
  dnd5e's roll dialog.
- **Foundry's dice where the player rolled none.** A Halfling's reroll of a 1, Elven Accuracy's
  third d20, or a bonus the game applies, such as Bless as an effect, is rolled by Foundry.
  Foundry's total stands, and is what the player is shown.
- **What the player is told.** The app shows each roll's total in the game, unless the roll was
  made blind, as Midi-QOL can make a player's check: then only that it was made.
- **A self-test** checks, as the game loads, that the player's dice reach the roll made for them
  and no other. If it fails, as it might with a module that rolls dice its own way, players' rolls
  stay in the app, and Manage Campaigns says why.
- **libWrapper** is recommended: with it, the dice are wrapped alongside other modules' wrappers.

The app's address must be able to answer the module's fetches of players' rolls, which only the
Sending Stone app, or a listener that says it can, is asked for; see
[PROTOCOL.md](PROTOCOL.md#rolls-from-the-app).

### Players' attacks and spells

Tick **Let Players Attack and Cast from Sending Stone** too, and the campaign's players can attack,
cast their spells and use their features from the app: Fireball, Sacred Flame, Magic Missile, Cure
Wounds, Second Wind, Bless, Shield or Action Surge, from their actions, spells, features, inventory
or favorites, wherever the app lists them. They pick their targets from the combat, and
the spell slot, ammunition or attack mode, and tap it; then the app rolls its damage or healing,
with their dice, once the game has made the use, asking first for the kind of damage where it
offers a choice, as Chromatic Orb does. The item is used as in Foundry, spending its ammunition,
uses or spell slot; an attack is made with the d20s they rolled, at their target; and the damage
or healing is rolled on the same use, critical hit's dice included. The app shows whether an
attack hit only where the game shows players.

- **Without Midi-QOL**, dnd5e's own cards are posted, as the character's player: the use's card,
  naming the targets, the attack and the damage, linked to it. You roll the targets' saving throws
  and apply the damage, healing and effects from the cards, as usual. Self-only features, such as
  Second Wind, name their user.
- **With Midi-QOL**, the use goes through Midi's workflow, as if the player had used it in
  Foundry: Midi checks the hit, rolls the targets' saving throws and applies the damage, healing
  and effects as you have it set up. The card is yours, spoken as the character, since Midi asks
  a card's author to confirm and apply. While it's made, your targets are the player's targets,
  then they're put back. With **Make Players' Attacks and Spells Through Midi-QOL** off, attacks
  and spells stay in the app.
- **Targets you aren't viewing.** Midi can only target tokens your screen shows, on the level and
  scene you're viewing, so a use at any other is refused, and its player is told you aren't
  viewing their target. With **Allow Targets You Aren't Viewing** on, it's made anyway: the card
  names every target, Midi does what it does for those your screen shows, and you apply the rest
  from the card.
- **Areas are picked, not placed.** No template is placed for an area spell: its targets are the
  combatants the player ticked in the app.
- **Spell slots.** A spell is cast with the slot the player chose, from those dnd5e's usage dialog
  offers, or else with its own level's, or the first one left at a higher level, as the dialog
  picks it. Upcast spells scale their damage and number of targets as in Foundry.
- **Changed damage.** A right-click or long-press on damage in the app lets a player roll it at its
  highest, or add more of its first die, or make that die another size, as a versatile weapon or
  Toll the Dead has, as dnd5e's damage dialog would. The game rolls it so, with their dice, a
  critical hit's extra dice included.
- **Nothing asks you, where it can be helped.** Area attacks, summoning, transforming and other
  activities dnd5e asks about, Midi's Active Defence, a used reaction or bonus action Midi
  enforces, and an activity set to always show Midi's dialogs or to ask which effects to apply are
  refused in the app with a reason. Midi may still ask you what it would in Foundry, such as a
  target's reaction, an optional bonus or confirming ammunition or damage; the player is told it
  took too long, then that it was made once you answer.
- **Dice So Nice** doesn't animate a Midi attack while your tab is hidden, which would hold Midi's
  workflow until you came back.

### Saves the game asks for

Tick **Prompt Players for Saves & Concentration** too, and the campaign's players are asked in the
app for the saving throws the game asks of their characters, wherever Foundry waits for a player to
click one on a chat card. The app shows the request on every tab of the character, and the player
rolls it there; the game makes it with their dice, as if they had clicked the card's button, so
the card shows whether they saved.

- **What asks.** dnd5e's concentration check after a concentrating character takes damage; a spell
  or feature that calls for a saving throw, at each character it targets; and a saving throw or
  concentration check you request in chat from an enricher, such as `[[/save dex 15]]`'s request
  link, at every character whose player can read it.
- **Only what the player could click.** A card whispered to you alone asks no one. The DC, and
  whether they saved, are shown in the app only where dnd5e's Challenge Visibility would show the
  player on the card.
- **A failed concentration check ends concentration**, which the player can't do from the app.
- **With Midi-QOL**, saves Midi rolls itself, as its Auto Check Saves has it, and its own
  concentration checks stay Midi's, and no one is asked; with its Concentration Check at "chat
  only", dnd5e's card is posted, and the player is asked. Midi ends concentration after a failed
  check, as you have it set up.
- **Ten minutes.** A request waits ten minutes, or until its card is deleted or the save is rolled
  from it in Foundry.

### The listener must allow cross-origin requests

The post comes from the Gamemaster's browser, not the Foundry server, so the browser enforces
CORS. The listener must answer the preflight `OPTIONS` request with:

```
Access-Control-Allow-Origin: <the Foundry origin, or *>
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

Two further browser rules apply:

- **Mixed content.** If Foundry is served over `https` (The Forge, or a reverse proxy), the
  listener must be `https` too. Plain `http` is only allowed to `localhost`.
- **Private network access.** Chromium-based browsers ask before an internet-hosted page reaches
  `localhost` or a LAN address. The listener should answer a preflight carrying
  `Access-Control-Request-Private-Network: true` with `Access-Control-Allow-Private-Network: true`.

### Trying it without a listener

[`tools/echo-listener.mjs`](tools/echo-listener.mjs) is a dependency-free stand-in that prints
every event and handles all of the above. With Node 18 or later:

```sh
node tools/echo-listener.mjs                  # destination: http://localhost:8787
SECRET=hunter2 node tools/echo-listener.mjs   # also require a shared secret
```

## What the listener sees

With **Send Gamemaster-Only Information** off, the listener receives what players could see:

| Information | Sent? |
| --- | --- |
| Public chat messages | Yes. |
| Whispers, and private or self rolls | Yes, to the campaigns of the characters whose players can read them, marked with which they are. |
| Whispers only Gamemasters can read, private Gamemaster rolls, blind rolls | No. |
| A blind roll the Gamemaster later reveals | Yes, from then on, as an update. |
| A message made private after it was sent | The listener is told to delete it. |
| Hidden combatants | No. Their turns are reported with no combatant. Revealing one reports it joining; hiding one reports it leaving. |
| Hit points | The campaign's own characters only. |
| Character sheets | The campaign's own characters only: what their players can already see in Foundry. |
| Attack targets | Name only; armor class is withheld. |
| Success or failure against a DC | Left out of roll summaries, so a hidden DC is not revealed. |

Every chat message carries an `audience` listing which players, and which of the campaign's
characters, can read it. That lets the listener route each message to the right player even with
Gamemaster-only information switched on.

## Behavior notes

- **Turn changes only.** `combatTurnChange` also fires when combatants are added, removed or
  reordered; those are ignored unless whose turn it is, or the round, actually changed.
- **Clearing the chat log is one event**, `chat.cleared`, not one deletion per message.
- **Order is preserved.** Events are posted one at a time. While the listener is unreachable,
  up to 500 events are held; past that the oldest are dropped.
- **Duplicates are possible.** If the listener received a post but its answer was lost, the post
  is retried with the same envelope `id`. Listeners should ignore an `id` they have already seen.
- **Players' attacks and spells with Midi-QOL set your targets** while each is made, one at a
  time, then put them back.
- **Only dice are wrapped, and only for players' rolls.** On a Gamemaster's browser under D&D Fifth
  Edition, Foundry's `Roll#evaluate` and `DiceTerm#_roll` are wrapped, through libWrapper when it's
  active, so that a roll made for a player from the app takes their dice. Every other roll is left alone. No core
  or system class is otherwise overridden.

## Installation

In Foundry (or on The Forge), install by manifest URL:

```
https://github.com/lambersond/fvtt-sending-stone/releases/latest/download/module.json
```

### Local development

Clone or symlink the repository into your Foundry data directory as `sending-stone`; the folder
name must match the manifest `id`:

```sh
ln -s "$PWD" "$HOME/Library/Application Support/FoundryVTT/Data/modules/sending-stone"
```

### Cutting a release

Pushing a `v*` tag builds the archive and publishes the release via
[`.github/workflows/release.yml`](.github/workflows/release.yml):

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The tag is the source of truth for the version: the workflow stamps `version`, `manifest` and
`download` into the released `module.json`. They are therefore stale in the committed copy
between releases; check the published manifest, not this file, to see what actually shipped.
`tools/` is left out of the release archive.

## Layout

| Path | Purpose |
| --- | --- |
| `scripts/module.mjs` | Entry point and hook registration |
| `scripts/constants.mjs` | Shared identifiers, setting keys and event types |
| `scripts/config.mjs` | Setting accessors and the destination |
| `scripts/settings.mjs` | Settings and setting menu registration |
| `scripts/bridge.mjs` | Which browser sends, and the `bridge.hello` state snapshot |
| `scripts/heartbeat.mjs` | Heartbeats to campaigns sent nothing lately, so the app knows the game is connected |
| `scripts/transport.mjs` | Envelope, ordered delivery queue, retries and status |
| `scripts/campaigns.mjs` | Campaigns, and moving pre-campaign connected characters into one |
| `scripts/characters.mjs` | A campaign's characters and who owns them |
| `scripts/sheet.mjs` | A character's sheet under dnd5e: abilities, saves, skills and the like |
| `scripts/sheet-features.mjs` | A character's classes and features, grouped as dnd5e's Features tab groups them |
| `scripts/sheet-effects.mjs` | A character's conditions and effects, as dnd5e shows them to its player |
| `scripts/sheet-inventory.mjs` | A character's inventory: items by type, containers, currency, encumbrance and attunement |
| `scripts/sheet-spells.mjs` | A character's spellcasting and spellbook, sectioned as dnd5e sections it |
| `scripts/sheet-details.mjs` | A character's biography, personality and details, traits and death saves |
| `scripts/sheet-actions.mjs` | A character's actions, listed and sectioned as Tidy 5e's Actions tab lists them |
| `scripts/sheet-favorites.mjs` | A character's favorites, as dnd5e's sheet shows them under Favorites |
| `scripts/sheet-rolls.mjs` | What an action, spell, feature or inventory item rolls, and the activity it's used through |
| `scripts/sheet-texts.mjs` | Sheets' descriptions: enriched, hashed, and sent only when a campaign lacks them |
| `scripts/sheet-values.mjs` | Helpers for describing a sheet as plain JSON |
| `scripts/character-sync.mjs` | Sending a character again when it changes |
| `scripts/chat.mjs` | Chat hooks |
| `scripts/chat-data.mjs` | Chat message serialization and audience |
| `scripts/combat.mjs` | Combat hooks |
| `scripts/combat-data.mjs` | Combat and combatant serialization |
| `scripts/campaign-combats.mjs` | Which campaigns each combat has reached, and sending to them |
| `scripts/commands.mjs` | Fetching players' rolls, attacks and spells from the app, one campaign at a time, and reporting what became of each |
| `scripts/command-rolls.mjs` | Making a player's roll through dnd5e, as the player, and marking its card |
| `scripts/command-uses.mjs` | Making a player's attack, spell or feature and its damage or healing, through dnd5e's cards or Midi-QOL's workflow |
| `scripts/dice-plan.mjs` | Giving a player's roll the dice they rolled, and the self-test that it works |
| `scripts/apps/campaign-config.mjs` | Manage Campaigns: the app's address, and each campaign's title, secret, characters, players' rolls, attacks and spells, and connection test |
| `tools/echo-listener.mjs` | Stand-in listener for development |
| `PROTOCOL.md` | Event envelope and payload reference |
