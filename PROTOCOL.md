# Sending Stone protocol

What a listener receives, and how it should answer. Protocol version **2**.

The version in each envelope's `protocol` field changes only for changes a listener must adapt to.
New fields may appear in any payload at any time; ignore the ones you do not recognize.

## Transport

The Gamemaster sets a **destination**: the address of the listening app, such as
`https://sending-stone.vercel.app`. Only its origin is used. Each event is one HTTP request to a
fixed path under it:

```
POST <destination>/api/events
Content-Type: application/json
Authorization: Bearer <the campaign's secret>     (only when one is configured)

<envelope>
```

| Your answer | What the module does |
| --- | --- |
| Any `2xx` | Delivered. `204 No Content` is fine. A JSON body of `{"resend": "hello"}` asks for the campaign's full state again; see [Keeping in step](#keeping-in-step). Any other body is ignored. |
| `408`, `425`, `429`, any `5xx`, no answer, or no answer within 10 s | Retried after 1 s, then again after 3 s, with the same envelope. Dropped after the third failure. |
| Any other status, such as `400` or `401` | Dropped immediately. |

The Gamemaster is warned once when deliveries start failing and told when they recover.

The request comes from the Gamemaster's **browser**, so the listener must handle CORS. Answer the
`OPTIONS` preflight with `Access-Control-Allow-Origin` (the Foundry origin, or `*`),
`Access-Control-Allow-Methods: POST, OPTIONS` and
`Access-Control-Allow-Headers: Content-Type, Authorization`. If the preflight carries
`Access-Control-Request-Private-Network: true`, also answer
`Access-Control-Allow-Private-Network: true`. See
[`tools/echo-listener.mjs`](tools/echo-listener.mjs) for a complete minimal listener.

## Envelope

```json
{
  "protocol": 2,
  "id": "0_rIUebRgh6Gm7hZ",
  "session": "NXUK8rWJac7xwtdn",
  "sequence": 2,
  "type": "chat.message.created",
  "time": "2026-10-03T21:49:00.054Z",
  "world": { "id": "my-world", "title": "My World" },
  "campaign": { "id": "k3jd8s7aQ1pZ0vXe", "title": "Curse of Strahd" },
  "data": { }
}
```

| Field | Meaning |
| --- | --- |
| `protocol` | The protocol version, `2`. |
| `id` | Unique to this event, and unchanged across retries. **Ignore an `id` you have already processed.** |
| `session` | One page load of the sending browser. Changes when the Gamemaster reloads, or another Gamemaster's browser takes over sending. |
| `sequence` | Counts up by exactly 1 per event within a session and campaign. A gap means that campaign missed events. `null` on `bridge.ping` and `bridge.heartbeat`, which are outside the event stream. |
| `type` | What happened. Listed below. |
| `time` | When the event was raised, as an ISO 8601 timestamp. |
| `world` | The Foundry world the event came from. |
| `campaign` | The [campaign](#campaigns) the event is for: its `id`, which never changes, and its `title`, which the Gamemaster may change. On `bridge.ping`, the campaign tested, or `null` from modules before 0.4.0. |
| `data` | The payload, which depends on `type`. |

### Keeping in step

- **Every session starts with a `bridge.hello` for each campaign**, which carries that campaign's
  full current state. Treat it as a reset: discard what you held for that campaign and rebuild
  from it.
- A `sequence` gap means you missed events. The payloads that matter most carry full snapshots
  (each `combat.turn` includes the whole combat), so you will be back in step at the next one.
- **`*.updated` events are upserts.** A message can become visible after it was created, for
  instance when the Gamemaster reveals a blind roll, so you may receive an update for something
  you never saw created.
- Deletions may name something you never saw. Ignore them.
- **Missing a campaign's state? Ask for it.** Answer any event for the campaign with
  `Content-Type: application/json` and `{"resend": "hello"}`, and the module sends that campaign
  a fresh `bridge.hello`, at most once every 30 seconds. Ask when you have not applied a hello from
  the envelope's `session`: for instance when you refused the campaign's hello because it was not
  set up with you yet, or when you lost what you held. Answer a `bridge.hello` itself without
  asking, or you will be sent another.

## Campaigns

The Gamemaster groups player characters into campaigns, each with a title. A world can run
several, and a character can be in more than one. Hold state per campaign: everything below is
about one campaign at a time, keyed by its `id`.

Each event is sent separately to every campaign it involves, each copy with its own envelope `id`
and described for that campaign alone: an `audience` lists only that campaign's characters, a
`character` field names only one of its characters, and hit points are included only for its
characters.

| Event | Sent to |
| --- | --- |
| A chat message | Each campaign one of whose characters said it, or whose characters' players can read it. A public message reaches every campaign with characters. |
| `chat.cleared` | Every campaign. |
| A combat event | Each campaign with a character in the combat. |

A campaign hears about a combat while any of its characters are in it. When the first of them
joins, the combat arrives as **`combat.created` with its full snapshot**, which may already be
under way. When the last of them leaves, the campaign is sent **`combat.ended`**: for that
campaign, the fight is over.

## Visibility

Events are sent from the Gamemaster's browser, which can see everything. Unless **Send
Gamemaster-Only Information** is on (`config.gmContent` in `bridge.hello`), anything only a
Gamemaster could see is withheld; see the README for the full list.

Every chat message carries an `audience`:

| Field | Meaning |
| --- | --- |
| `public` | Everyone can read it. |
| `gmOnly` | No player can read it. Only ever `true` when Gamemaster-only information is on. |
| `users` | The ids of the players who can read it. Empty when `public`. Gamemasters are never listed. |
| `characters` | The ids of the campaign's characters whose players can read it. All of them when `public`. |

Use `characters` to route a message to the right player's device.

## Shared shapes

### Character

```json
{
  "id": "thorin",
  "uuid": "Actor.thorin",
  "name": "Thorin",
  "img": "thorin.webp",
  "type": "character",
  "owners": [{ "id": "alice", "name": "Alice" }]
}
```

`owners` lists players only, never Gamemasters, and may be empty.

### Chat message

| Field | Meaning |
| --- | --- |
| `id`, `uuid` | The message's id and UUID. |
| `type` | The message subtype: `"base"`, or a system's own, such as dnd5e's `"usage"`, `"turn"`, `"rest"` and `"request"`. |
| `style` | `"OTHER"`, `"OOC"`, `"IC"` or `"EMOTE"`. |
| `timestamp` | When it was created, in milliseconds since the epoch. |
| `author` | `{ id, name }` of the user who created it. |
| `speaker` | `{ alias, actorId, tokenId, sceneId }`. The ids are `null` when not spoken by an actor. |
| `character` | The campaign character's actor id if one spoke it, else `null`. |
| `title` | The pop-out title, or `null`. |
| `flavor`, `content` | As stored, in HTML. Content links are not yet rendered: they appear as `@UUID[…]{Label}`. |
| `text` | `content` as plain text, with content links reduced to their labels. |
| `blind` | Was it a blind roll? |
| `audience` | Who can read it. See [Visibility](#visibility). |
| `rolls` | Every roll in the message, as below. |
| `system` | The subtype's data for any `type` other than `"base"`, else `null`. |
| `dnd5e` | Under dnd5e, what the system recorded about the message, as below. Otherwise `null`. |

A roll:

```json
{
  "class": "D20Roll",
  "formula": "2d20kh + 7",
  "total": 24,
  "dice": [
    {
      "expression": "2d20kh",
      "faces": 20,
      "number": 2,
      "results": [{ "result": 17, "active": true }, { "result": 4, "active": false }]
    }
  ],
  "advantage": true,
  "disadvantage": false,
  "critical": false,
  "fumble": false
}
```

`advantage`, `disadvantage`, `critical` and `fumble` appear only for roll classes that define
them, such as dnd5e's `D20Roll`. A dnd5e `DamageRoll` also carries `damageType`. An inactive
result is one that was discarded, such as the lower die of a roll with advantage. Success or
failure against a DC is deliberately not included.

The `dnd5e` object:

```json
{
  "messageType": "roll",
  "roll": { "type": "skill", "skillId": "acr" },
  "item": { "id": "sword", "uuid": "Actor.thorin.Item.sword", "type": "weapon", "name": "Longsword" },
  "activity": { "id": "atk", "uuid": "Actor.thorin.Item.sword.Activity.atk", "type": "attack", "name": "Attack" },
  "targets": [{ "name": "Goblin", "uuid": "Scene.a.Token.b.Actor.goblin" }],
  "originatingMessage": null
}
```

| Field | Meaning |
| --- | --- |
| `messageType` | dnd5e's own classification, such as `"roll"` or `"usage"`. |
| `roll` | What was rolled, exactly as dnd5e records it. `type` is one of `"skill"` (with `skillId`), `"tool"` (with `toolId`), `"ability"` or `"save"` (with `ability`), `"attack"`, `"damage"`, `"death"`, `"hitDie"`, `"concentration"` or `"generic"`. `null` if not a roll. |
| `item`, `activity` | The item and activity used, or `null`. |
| `targets` | What was targeted when the item was used. `ac` is added only when Gamemaster-only information is on. |
| `originatingMessage` | For a roll made from an item's chat card, the id of that card's message. |

### Combat

```json
{
  "id": "cmbt1",
  "name": null,
  "sceneId": "sceneA",
  "active": true,
  "started": true,
  "round": 2,
  "combatantId": "cmbThorin",
  "combatants": [ ]
}
```

| Field | Meaning |
| --- | --- |
| `name` | The encounter's name, or `null` if it has none. |
| `sceneId` | The scene it is linked to, or `null` if unlinked. |
| `active` | Is it the encounter the tracker is currently showing? |
| `started`, `round` | Whether it has begun, and the current round. `round` is `0` before it begins. |
| `combatantId` | Whose turn it is. `null` before it starts, or when it is a hidden combatant's turn. |
| `combatants` | In turn order. Hidden combatants are left out unless Gamemaster-only information is on. |

Turn positions are deliberately not given as indices: with hidden combatants left out, an index
would not match the list and would reveal how many were left out.

### Combatant

```json
{
  "id": "cmbThorin",
  "name": "Thorin",
  "img": "thorin.webp",
  "actorId": "thorin",
  "tokenId": "tokThorin",
  "sceneId": "sceneA",
  "groupId": null,
  "initiative": 18,
  "defeated": false,
  "character": "thorin",
  "playerOwned": true,
  "hp": { "value": 30, "max": 40, "temp": 0 }
}
```

`initiative` is `null` until rolled. `character` is the campaign character's actor id, or `null`.
`hp` is present for the campaign's characters, and for every combatant when Gamemaster-only
information is on; it is `null` when the system does not model hit points the way dnd5e does.
`hidden` is present only when Gamemaster-only information is on.

## Events

### `bridge.hello`

A campaign's full current state. Sent to each campaign first in every session, and again whenever
the destination, the campaigns or any event setting changes.

| Field | Meaning |
| --- | --- |
| `module` | `{ id, version }` of this module. |
| `foundry` | `{ version, generation }`, such as `"14.365"` and `14`. |
| `system` | `{ id, title, version }` of the game system. |
| `bridge` | `{ userId, name }` of the Gamemaster whose browser is sending. |
| `config` | `{ chat, chatScope, combat, gmContent }`: which events are on, whether chat is `"all"` a campaign's players can read or only what its characters said (`"connected"`), and whether Gamemaster-only information is sent. |
| `characters` | Every [character](#character) in the campaign. |
| `combats` | Every [combat](#combat) the campaign's characters are in, when combat events are on; otherwise empty. |

### `bridge.heartbeat`

`{}`. The bridge is still connected. Sent to a campaign that has been sent no other event for 30
seconds, so while a Gamemaster has the game open, each campaign hears something at least every
30 to 40 seconds. Browsers slow the timers of a background tab, to as little as once a minute, so
allow for that before deciding the Gamemaster has gone: two minutes without any event is a safe
sign.

### `bridge.ping`

`{ userId, name }` of the Gamemaster testing a campaign's connection. Sent by a campaign's
**Test** button in Manage Campaigns, with the address, title and secret as typed, which may not
have been saved, and from a browser that may not be the one sending events. It names the campaign
tested: answer `2xx` if the secret is that campaign's, `404` if no campaign with its title is set
up, and `401` for the wrong secret. Store nothing. Modules before 0.4.0 sent it with
`campaign: null`, testing the one secret they had.

### Chat

Sent only while **Send Chat Events** is on.

| Type | Payload |
| --- | --- |
| `chat.message.created` | `{ message }` |
| `chat.message.updated` | `{ changes, message }`: the names of the fields that changed, and the [message](#chat-message) as it now stands. An upsert. |
| `chat.message.deleted` | `{ id }`. Also sent when a message is made private after it was sent. |
| `chat.cleared` | `{}`. The whole chat log was cleared; sent once rather than a deletion per message. |

### Combat

Sent only while **Send Combat Events** is on. Every payload naming a combat carries its full
[snapshot](#combat).

| Type | Payload |
| --- | --- |
| `combat.created` | `{ combat }`. An encounter now includes the campaign's characters. Usually it has just been set up, but it may already be under way. |
| `combat.started` | `{ combat }`. Round 1 began. Followed immediately by a `combat.turn` for the first turn. |
| `combat.turn` | `{ combatId, round, newRound, direction, combatant, previousCombatantId, combat }` |
| `combat.updated` | `{ changes, combat }`: the encounter's `name`, `active` or `scene` changed. |
| `combat.ended` | `{ combat }`. The encounter was ended, which deletes it, or the campaign's last character left it. The snapshot is its final state. |
| `combat.combatant.added` | `{ combatId, combatant }` |
| `combat.combatant.updated` | `{ combatId, changes, combatant }`: any of `name`, `img`, `initiative`, `defeated`, `hidden` or `group` changed. |
| `combat.combatant.removed` | `{ combatId, combatantId }` |

`combat.turn` is sent whenever whose turn it is, or the round, changes, in either direction:

| Field | Meaning |
| --- | --- |
| `round` | The round now. |
| `newRound` | Did this turn begin a new round, moving forward? |
| `direction` | `"forward"`, `"backward"` (the Gamemaster stepped back), or `null` when neither applies, as when the current combatant was removed. |
| `combatant` | Whose turn it now is, or `null` for a hidden combatant. |
| `previousCombatantId` | Whose turn it was, or `null` if that was a hidden combatant. |

While hidden combatants are withheld, revealing one is sent as `combat.combatant.added`, and
hiding one as `combat.combatant.removed`.

## Additions within protocol 2

- Module 0.3.0 sends [`bridge.heartbeat`](#bridgeheartbeat). A listener that answers `2xx` to
  types it does not use needs no change.
- Module 0.3.1 resends a campaign's `bridge.hello` when an answer asks for it with
  `{"resend": "hello"}`. A listener that never asks needs no change.
- Module 0.4.0 sends each campaign's events with that campaign's own secret, and `bridge.ping`
  names the campaign being tested.

## Changes from protocol 1

- Events are posted to `<destination>/api/events`; the Gamemaster sets only the destination.
- Every envelope carries `campaign`, and each event is sent once per campaign it involves,
  described for that campaign. `sequence` counts per campaign.
- `bridge.hello` is sent per campaign, with that campaign's characters and combats.
- `characters.updated` is no longer sent: a change to the campaigns sends `bridge.hello` instead.
- `combat.created` and `combat.ended` also mark a campaign's characters joining or leaving a fight.

## Coming next

The listener will be able to act for a campaign's character: rolling a check, attacking, casting a
spell, as if its player had done it in Foundry. Because a browser cannot accept incoming
requests, that will need the Gamemaster's browser to hold a connection open to the listener
rather than the listener calling Foundry. The campaigns and secrets configured now are what that
connection will use.
