# Sending Stone

A Foundry VTT **v14** module that sends what happens at the table to the Sending Stone app, or any
listener that speaks its [protocol](PROTOCOL.md). Chat messages and combat tracker changes are
posted as JSON, campaign by campaign, so players can follow their game as it happens.

It is built for D&D Fifth Edition (dnd5e 5.3.x): roll messages carry the kind of roll, advantage,
and the item, activity and targets involved. Chat and combat events work under any system.

This is the outbound half. Later, the listener will also be able to act *for* a campaign's
character (rolling a check, attacking, casting a spell) as if its player had done it in Foundry.

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
skills, hit points, armor class and the like, as dnd5e shows them. When a character changes, such
as taking damage or levelling up, its campaigns are sent it again, so players can see their
character and roll from it in the app.

| Setting | Effect |
| --- | --- |
| Manage Campaigns | The Sending Stone app's address, and each campaign: its title, its secret (sent as `Authorization: Bearer …` with its events) and its player characters. Each event goes to the campaigns it involves. |
| Send Chat Events | Chat messages created, edited and deleted, and the log being cleared. |
| Chat Messages to Send | Every message a campaign's players can read, or only those its characters spoke. |
| Send Combat Events | Encounters created, started, updated and ended; turns and rounds; combatants joining, leaving, rolling initiative and being defeated. |
| Send Gamemaster-Only Information | Also send what only a Gamemaster can see. Off by default. |

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
- **Nothing is patched.** The module registers settings and hooks; it overrides no core or
  system class.

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
| `scripts/character-sync.mjs` | Sending a character again when it changes |
| `scripts/chat.mjs` | Chat hooks |
| `scripts/chat-data.mjs` | Chat message serialization and audience |
| `scripts/combat.mjs` | Combat hooks |
| `scripts/combat-data.mjs` | Combat and combatant serialization |
| `scripts/campaign-combats.mjs` | Which campaigns each combat has reached, and sending to them |
| `scripts/apps/campaign-config.mjs` | Manage Campaigns: the app's address, and each campaign's title, secret, characters and connection test |
| `tools/echo-listener.mjs` | Stand-in listener for development |
| `PROTOCOL.md` | Event envelope and payload reference |
