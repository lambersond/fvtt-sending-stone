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
| Any `2xx` | Delivered. `204 No Content` is fine. A JSON body of `{"resend": "hello"}` asks for the campaign's full state again; see [Keeping in step](#keeping-in-step). In answer to a `bridge.hello` or `bridge.heartbeat`, `{"features": {"commands": true}}` says the listener has players' rolls for the module to fetch; see [Rolls from the app](#rolls-from-the-app). Since module 0.22.0, in answer to those and to a `character.updated`, `features`' `slimSheets` and `maxBytes` say what the listener takes of sheets and posts; see [below](#post-size-and-slim-sheets). Since module 0.27.0, in answer to a `bridge.hello` or `bridge.heartbeat`, `features`' `midiPrompts` says the listener reads [Midi-QOL's prompts](#midi-qols-own-saves). Since module 0.30.0, in answer to those, `features`' `groups` says it reads [groups](#group), and `settings` that it reads [`bridge.settings`](#bridgesettings); and a `group.updated`'s answer says what it takes of sheets, as a `character.updated`'s does. Since module 0.38.0, in answer to a `bridge.hello` or `bridge.heartbeat`, `features`' `dishes` says the listener takes [dishes from the Magical Recipe Book](#dishes-from-the-magical-recipe-book). Since module 0.41.0, in answer to those, `features`' `companions` at 2 or more says it reads the [saves the game asks](#saves-the-game-asks-for) of companions, as well as companions. All may be in one body. Anything else is ignored. |
| `408`, `425`, `429`, any `5xx`, no answer, or no answer within 10 s | Retried after 1 s, then again after 3 s, with the same envelope. Dropped after the third failure. |
| Any other status, such as `400` or `401` | Dropped immediately. |

**Refusals.** Since module 0.23.0 the module reads why a post was refused, which the Sending Stone
app says in a JSON body beside the status: `{"reason": "notSetUp", "message": "No campaign titled
“Curse of Strahd” is set up for https://my-game.forge-vtt.com in Sending Stone"}`, with what more it
has to say. It words each reason itself, and uses `message` only for a reason it doesn't know.

| Status | `reason` | `message` | More |
| --- | --- | --- | --- |
| `401` | `noSecret` | `Send the campaign’s secret` | |
| `401` | `wrongSecret` | `The secret isn’t this campaign’s in Sending Stone` | |
| `403` | `notForge` | `Only games on The Forge are accepted` | |
| `404` | `notSetUp` | `No campaign titled “<title>” is set up for <origin> in Sending Stone` | |
| `413` | `tooLarge` | `Larger than the <limit> bytes Sending Stone takes` | `limit`, in bytes |
| `400` | `badEnvelope` | `Not a Sending Stone envelope`; for a fetch, `Not a Sending Stone fetch` | |
| `400` | `unsupportedProtocol` | `Unsupported protocol <n>` | `protocol`, the one it takes |
| `400` | `malformed` | `No campaign for <type>`, or `Malformed <type>` | `type`; `detail`, what was wrong |
| `500` | `unavailable` | `Sending Stone couldn’t take this just now` | |

The status alone still decides retrying; a listener answering plain text or nothing needs no
change. Without a reason, the module goes by the status: a `401` is `noSecret` if it sent no
secret, `wrongSecret` if it did; a `403` or `404` is `notForge` or `notSetUp` if its text says
nothing else, or starts as the app's did before ("Only games", "No campaign"); a `413` is
`tooLarge`, a `400` `malformed`, a `408` `timeout`, a `425` or `429` `rateLimited`, and a `5xx`
`unavailable`; no answer is `unreachable`, or `timeout` after 10 s; and anything else, or a
reason it doesn't know, is `status`.

The Gamemaster is told what went wrong and what to do once per cause, not once per post: once for
the app's address, however many campaigns fail (no answer, a `5xx`, a game not on The Forge…);
once for each campaign (no secret, the wrong one, not set up); and once a page load for each
campaign and kind of event (too large, malformed), which never fails the connection. A cause is
told again only once it has been gone ten minutes, since it was told or last cleared, should it
come back, so one that comes and goes is told once; and when it clears, as the next post gets
through (for the app's address, the next of each campaign whose posts failed for it), the
Gamemaster is told so, if they were told of it. The settings window shows each campaign's status, as
the browser sending events has it.

The request comes from the Gamemaster's **browser**, so the listener must handle CORS. Answer the
`OPTIONS` preflight with `Access-Control-Allow-Origin` (the Foundry origin, or `*`),
`Access-Control-Allow-Methods: POST, OPTIONS` and
`Access-Control-Allow-Headers: Content-Type, Authorization`. If the preflight carries
`Access-Control-Request-Private-Network: true`, also answer
`Access-Control-Allow-Private-Network: true`. See
[`tools/echo-listener.mjs`](tools/echo-listener.mjs) for a complete minimal listener.

### Post size and slim sheets

A listener takes posts of at least 1,000,000 bytes, counted as the body is sent, in UTF-8. Since
module 0.22.0 it may say what more it takes, among the `features` of its answers to `bridge.hello`,
`bridge.heartbeat` and `character.updated`: `"maxBytes"`, the largest post it takes, a whole number
of bytes of at least 1,000,000; and `"slimSheets"`, the highest [slim format](#slim-sheets) of sheet
it expands, a whole number, `1` being the first. The module goes by each campaign's latest such
answer. Anything else there, or no JSON, means 1,000,000 bytes and sheets in the full shape: so an
answer to a `character.updated` without `slimSheets` means full sheets from then on, as from an app
rolled back to one that doesn't expand them, and one that does says it in every answer. Whenever
they change, every character is sent again as the listener now takes them. The module never posts
more than the listener says it takes: a larger event is dropped unsent, as a refused one is,
counted, logged and the Gamemaster warned as for any failure, and a sheet that would make its post
too large is withheld instead; see [`character.updated`](#characterupdated). A `bridge.ping` is held
to 1,000,000 bytes, as it may go elsewhere than the campaign's events. Before 0.22.0, a
`bridge.hello` carried every character's sheet, and a large party's could come to more than 1 MB.

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
| `sequence` | Counts up by exactly 1 per event within a session and campaign. A gap means that campaign missed events. `null` on `bridge.ping`, `bridge.heartbeat` and `command.result`, which are outside the event stream. |
| `type` | What happened. Listed below. |
| `time` | When the event was raised, as an ISO 8601 timestamp. |
| `world` | The Foundry world the event came from. |
| `campaign` | The [campaign](#campaigns) the event is for: its `id`, which never changes, and its `title`, which the Gamemaster may change. On `bridge.ping`, the campaign tested, or `null` from modules before 0.4.0. |
| `data` | The payload, which depends on `type`. |

### Keeping in step

- **Every session starts with a `bridge.hello` for each campaign**, which carries that campaign's
  full current state. Treat it as a reset: discard what you held for that campaign and rebuild
  from it. Since module 0.22.0 its characters carry no sheets (`sheetsApart`): once it's answered,
  each character's sheet follows in a [`character.updated`](#characterupdated) of its own. Keep
  the sheet you hold of a character it lists until that one arrives, as it will, and drop those of
  characters it doesn't list.
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
- **Descriptions come first.** Sheets refer to their descriptions by hash, and the module sends
  every description a campaign has not had since its last hello in
  [`character.texts`](#charactertexts), before the `character.updated` that refers to it, or from
  modules before 0.22.0, the `bridge.hello`: since 0.22.0 every one again after each hello, before
  the first sheet that refers to it. So a sheet that refers to a description you don't have means
  one went missing: answer that `bridge.hello` or `character.updated` with `{"resend": "hello"}`,
  the one time a hello itself may ask. Don't ask on `character.texts`, which from modules before
  0.22.0 may arrive before its session's hello.
- **Lost posts are sent again.** Since module 0.22.0, a `bridge.hello`, `character.updated` or
  `character.texts` dropped after failures that might not last (no answer, or `408`, `425`, `429`
  or a `5xx`, three times) is sent again some 30 seconds later: a hello with every sheet after it, a
  character as it then stands, and descriptions with the next sheet that refers to them. Since
  module 0.30.0, a `group.updated` too, as the group then stands; and a `group.removed` or
  `bridge.settings` lost sends the campaign's hello again, which says both. One refused with any
  other status isn't.
- **Say what you read, in your answers to a hello and a heartbeat.** Since module 0.30.0 the
  module sends a campaign's [groups](#group) (`group.updated`, `group.removed`) only to a listener
  whose latest answer to the campaign's `bridge.hello` or `bridge.heartbeat` said
  `"features": {"groups": 1}`, and [`bridge.settings`](#bridgesettings) only to one that said
  `"settings": 1`, each a whole number of 1 or more, the format it reads. Say it in every such
  answer: one that doesn't is sent neither from then on. A listener that starts to say it in a
  heartbeat's answer, as one deployed mid-session, is sent every group, and the settings, at once;
  after a hello's answer, the groups follow its characters, and the hello said the settings.

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
| `character.updated` | Each campaign the character is in. |

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
  "owners": [{ "id": "alice", "name": "Alice" }],
  "sheet": { "…": "see Character sheet" }
}
```

`owners` lists players only, never Gamemasters, and may be empty. `sheet` is the character's
[sheet](#character-sheet) under dnd5e, or `null` under another system, or where it can't be
described; in the [slim shape](#slim-sheets), with `slim`, to a listener that expands it. In a
`bridge.hello` since module 0.22.0 (`sheetsApart`), a character has no `sheet` at all: it follows
in `character.updated`. In a `bridge.hello` since module 0.26.0, a character also says whether its
player may enter its dice results in the app, `manualDice`: always `false` before module 0.32.0.
Since then it's `true` only where the campaign lets its players enter what their own dice show and
Manual Dice is on (the hello's [`features.rolls.manualDice`](#bridgehello)), and one of the
character's primary players has core's **Make Manual Rolls** permission, which Manual Dice's roles
set. Its primary players are the players whose assigned Character (User Configuration) it is,
Gamemasters left out, or where it's no player's, its player owners. A player's own Manual Dice
toggle in Foundry lives in their browser alone and plays no part. Since module 0.32.0
`manualDice` is in [`character.updated`](#characterupdated) too, after `owners` and before `sheet`
(and `sheetWithheld`), and is sent again when the permissions, a user's role, assigned Character or
permissions, the users or the character's ownership change. Only the boolean leaves Foundry: no
role, permission or assignment.

A `character.updated` whose post would come to more than the listener takes withholds the sheet
(module 0.22.0): `sheet` is `null`, and `sheetWithheld` says why, `{ reason, bytes, limit }`, `reason`
being `"tooLarge"`, `bytes` what the post came to and `limit` the most the listener takes, both in
bytes. It's otherwise left out; the character's next update without it replaces it.

### Character sheet

What the character's player sees of them, and rolls from: every modifier is the one dnd5e shows on
its own sheet, already including proficiency and fixed bonuses. Bonuses that are dice, such as
Bless or Guidance, are not included; dnd5e adds those only when it rolls; since module 0.42.0, under
dnd5e 5, they're listed apart, [`effectDice`](#character-sheet).

Since module 0.40.0, to a listener that says `"wildShape": 1`, a transformed character's sheet is its
form's, as dnd5e made it ([Wild Shape](#wild-shape)), sent under the character's own id, with the
character's own id, uuid, name, image, type and owners, and `form`; a 2024 druid's sheet, shaped or
not, has `wildShape`. Every effect row on a form's sheet has `ops` `[]`. To any other listener, the
character's own actor's sheet, without either.

```json
{
  "img": "worlds/erebor/thorin.webp",
  "rules": "modern",
  "critical": { "perDie": 2, "multiplyNumeric": false, "powerfulCritical": false, "altered": false, "bonusDice": "rolled" },
  "level": 5,
  "classes": [
    { "id": "4kWt1v7QeXzEa2Nc", "identifier": "fighter", "name": "Fighter", "levels": 4, "subclass": "Champion", "hitDice": { "die": "d10", "value": 3, "max": 4 } },
    { "id": "Hq2d0m1RkPzc8VyB", "identifier": "rogue", "name": "Rogue", "levels": 1, "subclass": null, "hitDice": { "die": "d8", "value": 1, "max": 1 } }
  ],
  "species": "Dwarf",
  "background": "Soldier",
  "hp": { "value": 31, "max": 44, "temp": 0 },
  "ac": 18,
  "proficiency": 3,
  "initiative": 2,
  "speed": { "value": 25, "units": "ft" },
  "inspiration": false,
  "abilities": [
    { "id": "str", "label": "Strength", "abbreviation": "STR", "score": 18, "mod": 4, "check": 4, "save": 7, "saveProficient": true, "checkMode": 0, "saveMode": 0 }
  ],
  "skills": [
    { "id": "ath", "label": "Athletics", "ability": "str", "total": 7, "passive": 17, "proficiency": 1, "mode": 0 }
  ],
  "tools": [
    { "id": "thief", "name": "Thieves' Tools", "ability": "dex", "total": 5, "passive": 15, "proficiency": 1, "mode": 0 }
  ],
  "conditions": [
    { "id": "exhaustion", "name": "Exhaustion", "img": "systems/dnd5e/icons/svg/statuses/exhaustion.svg", "level": 2, "detail": null, "text": "0c41a7d2e9b3f5" },
    { "id": "concentrating", "name": "Concentrating", "img": "systems/dnd5e/icons/svg/statuses/concentrating.svg", "level": null, "detail": "Bless", "text": null }
  ],
  "concentration": { "effects": [{ "id": "cOnCbLeSs0000001", "name": "Bless", "item": "bLeSs00000000001" }] },
  "features": [
    {
      "id": "fighter", "label": "Fighter Features", "text": "1b7e04c2d9a8f3",
      "features": [
        {
          "id": "kQ1bW7sYp3Xc0RtE", "name": "Second Wind", "img": "icons/magic/life/heart-cross-green.webp",
          "kind": "Class Feature", "requirements": "Fighter 1", "activation": "1 Bonus Action", "passive": false,
          "uses": { "value": 1, "max": 1, "recovery": "Short Rest, Long Rest", "counter": { "item": "kQ1bW7sYp3Xc0RtE" }, "spendable": true },
          "text": "05d2e8a1c7b94f"
        }
      ]
    }
  ],
  "effects": [
    {
      "id": "temporary", "label": "Temporary Effects",
      "effects": [
        { "id": "a8LkT3wPz0QcN5vB", "name": "Bless", "img": "icons/magic/control/buff-flight-wings-blue.webp", "source": "Bless", "duration": "9 Rounds", "disabled": false, "ops": ["disable", "delete"], "text": "3f9c0b2a7d1e64" }
      ]
    }
  ],
  "inventory": {
    "sections": [
      {
        "id": "weapons", "label": "Weapons",
        "items": [
          {
            "id": "Lw3sQ9nE2vB7kTzD", "name": "Warhammer", "img": "icons/weapons/hammers/hammer-war-rounding.webp", "type": "weapon",
            "quantity": 1, "weight": { "value": 5, "units": "lb" }, "price": "15 GP", "equipped": true,
            "attunement": null, "attuned": false, "uses": null, "rarity": null, "properties": ["Versatile"], "identified": true, "text": "2c8e1f4b6a0d93"
          }
        ]
      }
    ],
    "containers": [
      { "id": "Pq7RtY2wX9mK4bVc", "name": "Backpack", "type": "container", "quantity": 1, "capacity": { "value": 12.5, "max": 30, "units": "lb" }, "contents": [], "text": null }
    ],
    "currency": [{ "id": "gp", "label": "Gold", "abbreviation": "GP", "value": 41 }],
    "encumbrance": { "value": 62.5, "max": 270, "units": "lb", "encumbered": null, "heavilyEncumbered": null },
    "attunement": { "value": 1, "max": 3 }
  },
  "spellcasting": { "ability": "Intelligence", "dc": 14, "attack": 6, "classes": [{ "name": "Wizard", "ability": "Intelligence", "dc": 14, "attack": 6, "prepared": { "value": 5, "max": 6 } }] },
  "spells": [
    {
      "id": "spell1", "label": "1st Level", "slots": { "value": 3, "max": 4, "level": 1 },
      "spells": [
        {
          "id": "Sh3lD8vX0qWc5ZpM", "name": "Shield", "img": "icons/magic/defensive/shield-barrier-blue.webp", "level": 1,
          "school": "Abjuration", "components": "V, S", "materials": null, "concentration": false, "ritual": false,
          "activation": "1 Reaction", "range": "Self", "duration": "1 Round", "target": null, "prepared": 1, "uses": null, "castFrom": null,
          "text": "6d2a9c4e0b7f18"
        }
      ]
    }
  ],
  "traits": [
    { "id": "senses", "label": "Senses", "values": ["Darkvision 60 ft"] },
    { "id": "languages", "label": "Languages", "values": ["Common", "Dwarvish"] }
  ],
  "deathSaves": { "success": 0, "failure": 0 },
  "details": {
    "about": [{ "id": "alignment", "label": "Alignment", "value": "Lawful Good" }],
    "personality": [{ "id": "ideal", "label": "Ideals", "value": "Greater good." }],
    "appearance": "Broad-shouldered, with a braided beard.",
    "xp": { "value": 6500, "max": 14000 },
    "biography": "7a1c3e5f9b2d40"
  },
  "actions": [
    {
      "id": "action", "label": "Actions",
      "actions": [
        {
          "id": "hR4cT7mWp2qLs9vB", "name": "Warhammer", "img": "icons/weapons/hammers/hammer-war.webp", "type": "weapon",
          "activation": "Action", "range": "reach 5 ft", "target": "1 Creature", "toHit": 7, "save": null,
          "damage": [{ "formula": "1d8 + 4", "type": "Bludgeoning", "healing": false }],
          "uses": null, "level": null, "castFrom": null, "concentration": false, "identified": true, "text": "1b9d3f5a7c2e48"
        }
      ]
    }
  ],
  "favorites": [
    { "type": "resource", "id": "primary", "name": "Superiority Dice", "uses": { "value": 3, "max": 4, "recovery": "Short Rest", "counter": { "resource": "primary" }, "spendable": true }, "itemId": null },
    { "type": "item", "id": "hR4cT7mWp2qLs9vB", "itemType": "weapon", "name": "Warhammer", "img": "icons/weapons/hammers/hammer-war.webp" },
    {
      "type": "activity", "id": "cAsTfIrEbAlL0001", "itemId": "sT4fFoFfIrE00001", "itemType": "weapon", "itemName": "Staff of Fire",
      "name": "Cast Fireball", "img": "systems/dnd5e/icons/svg/activity/cast.svg", "activation": "Action", "range": "150 ft",
      "target": "20 ft Sphere", "toHit": null, "save": { "ability": "DEX", "dc": 15 },
      "damage": [{ "formula": "8d6", "type": "Fire", "healing": false }], "uses": null
    },
    { "type": "effect", "id": "bL3sSeFfEcT00001", "name": "Bless", "img": "icons/magic/control/buff-flight-wings-blue.webp", "disabled": false, "suppressed": false },
    { "type": "skill", "id": "prc", "name": "Perception" },
    { "type": "tool", "id": "thief", "name": "Thieves' Tools", "ability": "dex", "total": 5, "passive": null, "proficiency": 1, "mode": 0 },
    { "type": "slots", "id": "spell1", "name": "1st Level", "value": 3, "max": 4, "level": 1 }
  ]
}
```

| Field | Description |
| --- | --- |
| `img` | The portrait's path as Foundry stores it: relative to the game's address, or a full URL. |
| `rules` | The rules the world is played by, as dnd5e's *Rules Version* setting has them: `"modern"` (2024) or `"legacy"` (2014), or `null` where that can't be read. Under the legacy rules a [hit die](#hit-dice-and-formulas) can heal nothing. Module 0.16.0. |
| `critical` | How the world rolls a critical hit's damage, for the app to plan a [description's](#descriptions-that-roll): `{ perDie, multiplyNumeric, powerfulCritical, altered }`, each found by building a critical hit's damage as the module builds it for a roll from the app. Since module 0.32.0 that's always as dnd5e's own rules make a critical hit's, whatever Midi-QOL's "Choose critical damage" options say, which apply to the Gamemaster's own rolls alone: so `perDie` `2`, or `1` under *Powerful Critical*, `altered` `false`, `multiplyNumeric` dnd5e's *Critical Damage Modifiers*, and since module 0.33.0 always `false`, as the app's critical hits never double a number, `powerfulCritical` dnd5e's *Powerful Critical*, and `bonusDice` `"rolled"`, or `null` under dnd5e 6's *Powerful Critical*, under Midi as without it. Before 0.32.0 it was built as the Gamemaster's client builds it, so with the rules of modules that change it, such as Midi-QOL's critical damage for the Gamemaster, never from dnd5e's settings alone, which Midi's rules may set aside; what follows of Midi's rules is of those modules. `perDie` is how many times over each die is thrown, and no other die: `2`, dnd5e's own, or `1` where dnd5e's *Powerful Critical* adds the most its dice could roll instead. `multiplyNumeric`, whether its numbers are doubled, as dnd5e's *Critical Damage Modifiers* does, and `powerfulCritical`, whether the most its dice could roll is added, as dnd5e's *Powerful Critical* does, or Midi's "Max Critical Dice (flat number)": for the app to work out a total by. `altered`, whether the rules change the dice thrown beyond that, as Midi's do that roll them at their highest, double them or keep the highest of them: the app can then work out no total, and the game's is the one that counts, as it always is. `null` where the rules throw dice of their own beside each die, as Midi's that roll a critical hit's dice apart or explode them do, throw dice of one size otherwise than another's, come to numbers neither of dnd5e's settings would, or where it can't be found. `bonusDice` (module 0.20.0), what the rules do with a critical hit's extra dice, such as a melee weapon's for Savage Attacks or Brutal Critical, which dnd5e throws with a part's first die alone (a part's own, `d` of them, are in [`data-critical-dice`](#links-in-descriptions)): `"rolled"`, thrown on that die after it's thrown `perDie` times over, so its count becomes `n × perDie + d`, as dnd5e does; `"maximized"`, not thrown, but `d` times that die's faces added as a number, as Midi's "Max Critical Dice (flat number)" does; `"ignored"`, left out, as Midi's rules that change dice otherwise do; or `null` where that can't be told, as under dnd5e 6's *Powerful Critical*, when no addition with dice may be planned. It's found as the rest is, by building a critical hit's damage: one die with a die more and critical damage of a die and a number, then dice of two sizes with two dice more and critical damage of a number, which must come out the same way, the critical damage added after as it is. Left out before 0.20.0, which counts as `null`; not there when `critical` is `null`. Sent again in [`character.updated`](#characterupdated) when those settings change; since module 0.33.0 not for *Critical Damage Modifiers*, which changes nothing in it. Module 0.19.0. |
| `level`, `classes` | Character level, and each class with its levels and subclass, highest first. A class's `identifier` is dnd5e's, such as `"fighter"`, and `hitDice` its `{ die, value, max }`: the size, how many are left and how many it has, or `null`. |
| `species`, `background` | Their names, or `null`. |
| `hp` | `{ value, max, temp }`, as on a [combatant](#combatant). |
| `ac`, `proficiency`, `initiative` | Armor class, proficiency bonus, and initiative modifier. |
| `speed` | Walking speed: `{ value, units }`, such as `"ft"`. |
| `abilities` | In dnd5e's order (Strength first). `check` and `save` are the modifiers for an ability check and a saving throw; `saveProficient`, whether proficient in the save. |
| `skills` | Sorted by `label`. `total` is the check modifier, `passive` the passive score, and `proficiency` the multiplier: `0`, `0.5` (half, as from Jack of All Trades), `1`, or `2` (expertise). |
| `tools` | The tools the character has, as dnd5e keeps them with their proficiency, sorted by `name`, as dnd5e names the tool: each with its `ability`, and `total`, `passive`, `proficiency` and `mode` as a skill has them. A tool the character doesn't have can still be checked, with the ability's `check`, as dnd5e does. Module 0.18.0; left out before. |
| `checkMode`, `saveMode`, `mode` | Whether that roll is made with advantage (`1`) or disadvantage (`-1`) from the character's conditions and features, else `0`. A skill's or tool's combines its ability's, as dnd5e does. |
| `conditions` | The character's statuses that the game names, by `name`: conditions such as Poisoned, and others such as Concentrating or Dead. `level` is Exhaustion's level, otherwise `null`; `detail`, for Concentrating, what the character is concentrating on. `text` is the rules for it. |
| `concentration` | Since module 0.29.0, what the character concentrates on, for its player to [end](#concentration-charges-and-heroic-inspiration) from the app: `{ effects }`, each of dnd5e's concentration effects on them, in dnd5e's order, `{ id, name, item }`. `id` is the effect's, the one `endConcentration` names; `name` the name of the item it's on as dnd5e prepares it, so as its player knows it, an unidentified scroll's by its unidentified name, never the name the effect keeps of a spent item's source; or else dnd5e's words for a concentration with no item, such as "Concentration With No Source"; `item` that item's `id` while it's on the character, else `null`, as for a scroll spent to cast it. `{ "effects": [] }` while the character concentrates on nothing, or can't concentrate at all (dnd5e's limit `0`). Always there from 0.29.0; left out before. |
| `features` | Grouped as dnd5e's Features tab groups them: a section for each class (with `id` its identifier), then `"species"`, `"background"` and `"other"`, each with its `label` and the `text` of the class, species or background. Empty sections are left out. |
| `features[].features` | In the order the player keeps them in Foundry. `kind`, such as Class Feature; `requirements`, such as Fighter 1; `activation`, such as 1 Bonus Action; `passive` for a trait or anything with nothing to use; `uses`, if limited, as `{ value, max, recovery }`, with `value` the uses left and `recovery` when they come back, such as Short Rest, Long Rest or Recharge [5–6]; and since module 0.29.0 `counter` and `spendable`, as [below](#counters). A feature that rolls or is used through anything also has [what it rolls](#what-an-item-rolls), with its `range`, `target` and `concentration`, as an action's. |
| `effects` | Grouped as dnd5e's Effects tab groups them, by `id`: `"temporary"`, `"passive"`, `"inactive"` (turned off or expired) and `"suppressed"` (unavailable, as from an unequipped item). Empty groups are left out. Conditions are listed in `conditions` instead, except concentration under dnd5e 6. |
| `effects[].effects` | `source` names what it comes from, such as the item that carries it or the spell another character cast; `duration` is the time it has left, such as `"9 Rounds"` or `"End of Source's Next Turn"`, or `null`; `disabled` whether it's turned off. An `id` is unique within the sheet. Since module 0.39.0, `ops`: what its player may do to it from the app, where the campaign lets them ([their own effects](#a-players-own-effects)): `"disable"`, `"enable"`, `"delete"`, in that order, or none; none on a companion's sheet. |
| `inventory.sections` | Items by type, in dnd5e's order: weapons, equipment, consumables, tools, loot. Only items in no container; empty sections are left out. |
| `inventory.sections[].items` | In the order the player keeps them in Foundry. `weight` is the item's and its quantity's together, in its `units`, or `null` for none; `price` dnd5e's label for it, such as `"15 GP"`; `equipped` whether it is, or `null` for a type that never is; `attunement` whether it is `"required"` or `"optional"`, with `attuned`; `uses` as on a feature; `rarity` and `properties` dnd5e's labels. An item that rolls or is used through anything, such as a weapon, a potion or a wand, also has [what it rolls](#what-an-item-rolls), with its `activation`, `range`, `target` and `concentration`, as an action's, whether it's equipped or not. |
| `inventory.containers` | Each container the character holds, in no other container, as an item with `capacity`, `{ value, max, units }` by count or weight, `null` without a limit, and `contents`: the items in it, containers among them with their own contents. |
| `identified` | `false` for an item not identified yet, which shows as dnd5e shows it to players: its unidentified name and description, and no price, rarity, uses, properties or attunement. An unidentified container whose contents are secret has `capacity` and `contents` `null`. |
| `inventory.currency` | Each currency, in dnd5e's order, with its `label`, `abbreviation` and `value`. |
| `inventory.encumbrance` | `{ value, max, units, encumbered, heavilyEncumbered }`: what the character carries of the most it can, and, under the variant encumbrance rule, where being encumbered and heavily encumbered begin, otherwise `null`. `null` when encumbrance isn't tracked. |
| `inventory.attunement` | `{ value, max }`: items attuned, and how many may be. |
| `spellcasting` | `{ ability, dc, attack, classes }`: the spellcasting ability, spell save DC and spell attack bonus, and each spellcasting class's. `null` for a character with no spells and no spellcasting class. Since module 0.42.1 a class may have `prepared`, `{ value, max }`, as dnd5e's sheet shows "Prepared 5 / 6" for it: `value` how many of the character's spells of that class are prepared, as dnd5e counts them (leveled, prepared, not always prepared, and come from that class or its subclass), and `max` how many it may prepare, by its prepared formula, `0` where it gives none; each a whole number from 0. `value` may be above `max`, as dnd5e lets it be; nothing caps it. Left out where both are `0`, as for a 2014 caster who knows their spells, where dnd5e's sheet shows nothing, or where dnd5e gives no numbers. The class's own, or its subclass's where that has a spellcasting progression of its own, as dnd5e's sheet reads it. A slim sheet keeps it. |
| `spells` | Sections of the spellbook as dnd5e builds them, in its order: at will, innate, ritual, cantrips (`"spell0"`), pact magic, then each spell level (`"spell1"` and so on), with `slots`, `{ value, max, level }`, for those that use them, then spells cast from items (`"item"`): since module 0.16.0, every spell an item casts, whether dnd5e's sheet lists it or not, such as one whose Cast activity isn't to be shown in the spellbook or one the item can't cast now, but none of an item hidden or not identified yet. A slot's `level` is the level a spell is cast at with it, which for pact magic is the pact slots' level, or `null` for pact magic without slots. Module 0.8.0 and earlier leave it out. A section with slots is listed even with no spells in it, as dnd5e lists it. |
| `spells[].spells` | `school`, `components` (such as `"V, S, M"`), `materials`, `activation`, `range`, `duration` (such as `"Concentration, up to 1 Minute"`, as dnd5e's spell cards put it) and `target` are dnd5e's labels; `concentration` and `ritual` say whether; `prepared` is `0` unprepared, `1` prepared or `2` always prepared, or `null` for a spell that isn't prepared, such as a cantrip; `uses` as on a feature; `castFrom`, `{ id, name }`, the item the spell is cast from with one of its Cast activities, such as a wand, or `null` for a spell of the character's own: since module 0.16.0, for one the item can't cast now, `{ id, name, usable, attune }`, `usable` being `false` and `attune` whether that's because the character must attune to the item and hasn't. A spell that rolls or is used through anything also has [what it rolls](#what-an-item-rolls), as an action, whether it's prepared or not, but not one its item can't cast now. |
| `traits` | Each trait with values, `{ id, label, values }`, in order: size, senses, speeds, languages, then dnd5e's traits, such as armor and tool proficiencies and damage resistances and immunities, with whatever the Gamemaster typed in among them. |
| `deathSaves` | `{ success, failure }`, or `null`. |
| `details` | `about`, `{ id, label, value }` for alignment, age and the like that are filled in; `personality`, likewise, for personality traits, ideals, bonds and flaws; `appearance`; `xp`, `{ value, max }`, `max` being `null` at the highest level; and `biography`, a description's hash. |
| `actions` | What the character can do in a fight, listed as Tidy 5e's Actions tab lists it by default: equipped weapons; equipped equipment and consumables used in a fight, not over minutes or more; spells that can be cast now and deal damage, are cast as a bonus action or reaction, last a minute or a round, or apply effects; and features that are activated. An item a player added to Tidy 5e's list, or took off it, is listed or not as they chose. Since module 0.15.0 the spells an item casts with its Cast activities are cast from the item, and the copies of them dnd5e keeps aren't listed; an item Tidy 5e's rules leave off the list is still listed for the spells it casts, unless the player took it off. Sections are by activation, in Tidy 5e's order: `"action"`, `"bonus"`, `"reaction"`, `"legendary"`, `"mythic"`, `"lair"`, `"crew"`, `"special"`, `"other"` for any other, then any the player named in Tidy 5e, whose `id` and `label` are its name. Empty sections are left out. Since module 0.15.0 an item is listed in each section for how its activities are activated, such as a staff that strikes as an action and casts Silvery Barbs as a reaction, under `"action"` and under `"reaction"`, each time with the activities activated that way; an activity with no activation of its own, or a special one, used along with another, such as Hex's Bonus Hex Damage, goes with the item's first. An item the player gave a section of its own, or one not identified yet, is listed once, with all its activities, or for one Tidy 5e's rules leave off the list, all the spells it casts. Before, an item was listed once, by its first activity's activation. |
| `favorites` | What dnd5e's sheet shows under Favorites, and Tidy 5e in its own, in its order: the old-style resources (`"resource"`) that are named and have a maximum, then what the player made a favorite, in their order. Each has a `type` and an `id` that refers to what the sheet lists elsewhere, where it lists it, and a `name`. An `"item"`'s `id` is the item's, as in `inventory`, `spells`, `features` and `actions`, with its `itemType` and `img`. An `"activity"`, one of an item's activities, has the item's `itemId`, `itemType` and `itemName`, its own `name` and `img`, and `activation`, `range`, `target`, `toHit`, `save`, `damage` and `uses` as on an action, for that activity alone, with its own id as `attackId`, and its `attackModes` and `ammunition`, when it's an attack, and itself as `activity` when it's a save, damage, healing or utility activity, or since module 0.21.0 a check or enchant activity, and `consumesSlot`, `check` and `forward` as on an action; an item not identified yet keeps them back, as on an action. An `"effect"`'s `id` is as in `effects`, with its `img`, whether it's `disabled`, and whether it's `suppressed`. A `"skill"`'s `id` is as in `skills`. A `"tool"` has its `ability`, its `total` modifier, `passive` score, `proficiency` and roll `mode`, as a skill has, and as in `tools` since module 0.18.0. A `"slots"`'s `id` is as in `spells`, with `value`, `max` and `level` as a section's `slots`. A `"resource"` has `uses` as on a feature, and, from module 0.23.0, `itemId`: the feature it stands for, by its id in `features` and `actions`, or `null`: the feature whose name is the resource's, compared without case, spacing or curly apostrophes, preferring one that spends it; or else the only feature whose activity spends it (an `attribute` consumption target `resources.<id>.value`, on an activity its player sees). A feature stands for one resource at most. A favorite that refers to nothing any longer, or to what a player doesn't see, such as an item hidden from the sheet or an effect of an item not yet identified, is left out. |
| `creature` | Since module 0.36.0, only on an NPC's sheet, a [companion](#companions)'s: what dnd5e's NPC sheet says of the creature, `{ cr, type, size, alignment, important, legendary, resistance, lair, hitDice }`, after `details`. `cr` its challenge rating as a number (`0.125`, `0.25`, `0.5`, `1`…) or `null`; `type` its creature type's label, such as `"Beast"` or `"Fey (Shapechanger)"`, or `null`; `size` its size's label, as `traits` names it; `alignment` as written, `null` where blank; `important`, dnd5e's *Important* NPC flag (`traits.important`), or `true` for an NPC with a class, as a sidekick has; `legendary` and `resistance`, `{ value, max }`, its legendary actions and resistances left, where it has any, the maximum as dnd5e prepares it, one more in its lair, else `null`; `lair`, `{ inside, initiative }` where it has lair actions, `initiative` `null` where none is set, else `null`; `hitDice`, `{ denomination, value, max }` (`"d8"`), where it has any, else `null`. Absent on any other sheet. An NPC's legendary pools are never `favorites`: only the old-style resources `primary`, `secondary` and `tertiary` become `"resource"` favorites. |
| `form` | Since module 0.40.0, to a listener that says `"wildShape": 1`, on a transformed character's sheet, its form's: what the character is now, `{ kind, name, img, size, cr, type, profile, hours, minutesLeft, flooredAc, beast }`. `kind` `"wildShape"` for dnd5e's Wild Shape preset on a druid, else `"other"` (Polymorph, any other transformation, or a form with no record of the module's); `name`, `img`, `size`, `cr` and `type` the creature's, `size` and `type` dnd5e's labels, `cr` a number or `null`; `profile` the known form's profile id it was taken as, or `null`; `hours` its duration where the 2024 rules time it, else `null` (`"other"`, a 2014 Wild Shape), the listener offering Return only where it's set; `minutesLeft` the whole minutes of world time left, rounded down, never below 0, only where the module times it (`hours` set and the campaign's switch on), else `null`; `flooredAc` whether its armor class is Circle of the Moon's floor, not the creature's (for a creature from outside the campaign's compendiums, which is never loaded to compare, whenever its armor class is the floor); `beast` `{ abilities, saves, skills }`, which of its numbers are the creature's: the abilities whose scores dnd5e took from it (`["str", "dex", "con"]` for Wild Shape), and the saves and skills whose totals on the form are above the character's own. Absent on any other sheet. |
| `wildShape` | Since module 0.40.0, to a listener that says `"wildShape": 1`, on a 2024 druid's sheet (one whose druid class has the `known-forms` scale value), shaped or not: `{ item, uses, level, circle, limits, hours, temp, acFloor, known, swap, resurgence, ended }`. `item` the Wild Shape row's id on this sheet, the form's copy's while shaped; `uses` `{ value, max }`, that row's; `level` the character's druid level; `circle` `"moon"` or `null`; `limits` `{ count, cr, fly }`, how many forms the druid may know, the highest Challenge Rating and whether a Fly Speed is allowed; `hours`, `temp` and `acFloor` what a change gives now, its duration, its temporary hit points and the Moon's armor class floor or `null`; `known` the druid's known forms in order: one from the campaign's compendiums `{ id, uuid, name, img, size, cr, ac, speeds, attack, pool: true, fits }`, `attack` `{ name, toHit, damage }` or `null`, while it's loaded `{ id, uuid, name, pool: true, fits }`, one that can't be `{ id, uuid, name, pool: true, fits, found: false }`, and one from anywhere else `{ id, name, pool: false }`, never loaded; `fits` whether it's usable by the rules now; `swap` whether a replacement after the last Long Rest is free; `resurgence` whether the sheet has Wild Resurgence; `ended` `{ form, why, at, formId }` of the last ending, `why` `"app"`, `"time"`, `"hp"`, `"incapacitated"` or `"foundry"`, `at` the real time it was written, or `null` since the last change. See [Wild Shape](#wild-shape). Absent on any other sheet. |
| `effectDice` | Since module 0.42.0, under dnd5e 5, where the character's effects add a die to its d20 rolls, for a player typing in their dice: each die an effect adds or takes away, as dnd5e will add it when it rolls, and since module 0.42.1 one it offers, at most 10, in the order of the character's effects, each `{ name, effect, faces, count, sign, on }` and, since 0.42.1, `offer`, one for each effect and die. `name` is the spell or item it comes from, never an actor's name: `"Bless"` for the effect dnd5e applies from a caster's concentration on Bless, the item an item's effect is on, else the effect's own name, such as `"Blessed"`; where two share a name, a party caster's is added in parentheses, `"Bless (Vex)"`, never an enemy's; at most 100 characters. `effect` is the effect's id as `effects` gives it (`<item>.<effect>` for an item's). `faces` is 4, 6, 8, 10, 12 or 100, never 20; `count` 1 to 20; `sign` `1` where it's added, `-1` where it's taken away. `on`, 1 to 60, are the rolls it's added to: a kind, `attack`, `check`, `save`, `skill`, `tool`, `initiative`, `death` or `concentration`, for every roll of it, or `kind.key` for one, such as `save.dex`, `skill.ath`, `tool.thief` or `check.str`, each matching `^(attack\|check\|save\|skill\|tool\|initiative\|death\|concentration)(\.[A-Za-z0-9_-]{1,32})?$`, in that order of kinds, a key left out where its whole kind is listed: Bless's `["attack", "save", "death", "concentration"]`, Guidance's on Athletics `["skill.ath"]`. Listed only for an effect on, neither disabled nor suppressed, not an enchantment, that its player can see, for a change that adds one plain die, such as `1d4`, `-1d4` or `2d6`, to a field dnd5e adds to a d20 roll (an ability's, skill's or tool's check bonus, an ability's save bonus, every check's, save's or skill's, initiative's, death saves' and concentration's, and each kind of attack's), and only where that field, as prepared, still holds the die; on attacks only where it adds the same die to all four kinds of attack; taken away only where the self-test has seen this world take such a die away as one of the roll's own. Anything else, such as `1d4 + 1`, a die written with roll data, a d20, or a die bonus no effect explains, is left to Foundry to roll. Left out where there is none, and under dnd5e 6. A listener reads it beside `features.rolls.effectDice` alone. A listener before 0.42.1 reads an entry only where its keys are exactly these six, `name`, `effect`, `faces`, `count`, `sign` and `on`: an entry with any other key, as a later module may add for a die dnd5e doesn't add itself, is dropped and its die left to Foundry, so that a listener older than the module never asks for such a die as one the game adds. Since module 0.42.1, an entry may also have `offer`: `true` on a die dnd5e doesn't add to the roll itself, which the player may add to a d20 roll as one of its [`extras`](#fetching-rolls) once its rules allow: the 2024 Bardic Inspiration, from an effect on the character whose origin is another character's Bardic Inspiration feature (not one marked for the 2014 rules, as an item that doesn't say is in a world on the legacy rules), its die and count the bard's scale's as of this sheet, `sign` 1, on every kind but `initiative`, which can't fail; never one the bard gave themselves, one expired, or one with a Midi-QOL optional bonus's change, which Midi-QOL offers. For an offer, `effect` is the effect adding the die uses up, which a listener may delete once the roll is made, where its `ops` allow. Left out otherwise, never `false`, and never sent in a roll's `effectDice`. A listener from 0.42.1 reads an entry whose keys are the six and `offer`, and drops one with any other. |
| `actions[].actions` | Items, in the order the player keeps them. `activation`, `range` (for a weapon, its reach or range, such as `"reach 5 ft or range 20/60 ft"`) and `target` are dnd5e's labels; `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save` and `damage` are its first activity's, in dnd5e's order, but for a spell, after its other activities its checks that have no activation of their own, such as the 2014 Entangle's Escape Plants; and a forward that repeats an earlier one, used through the same activity for the same cost, of uses they share, is left out (module 0.21.0), as [below](#what-an-item-rolls): `toHit` the bonus to hit of an attack, without any dice in it, as dnd5e's sheets show it; `attackId` the attack activity's id, so that the app can have the attack [made in the game](#attacks), `null` for any other; beside it, since module 0.32.0, `elvenAccuracy` `true` where dnd5e would give the attack Elven Accuracy with advantage: its actor has dnd5e's Elven Accuracy flag and the activity's own ability is one the flag is for; left out otherwise, never `false`, for the app to take [three d20s](#fetching-rolls) for it, which it reaches wherever an attack's roll fields do, an activity's, a spell's cast from an item and a forward's too; `activity` the activity itself, for one [used in the game](#spells-and-features) other than by attacking, `{ id, type, targets }`: `type` being `"save"`, `"damage"`, `"heal"` or `"utility"`, or since module 0.21.0 `"check"` or `"enchant"`, and for a forward that of the activity it's used through, and `targets`, `{ self, area, count, perLevel, affects, fromSelf }`, whom it's used at: `self` its user alone, `area` everyone in an area, `count` the most targets it takes, or `null` for no limit, `perLevel` how many more a spell takes for each level it's cast above its own, as Bless does, or `null`, for a spell cast from an item since module 0.20.0 for each level above the one it's cast at, its `cast`'s `level`, and `affects` dnd5e's kind of target, such as `"ally"`, `"enemy"`, `"creature"` or `"willing"`, or `null`, and since module 0.22.0 `fromSelf`, whether its range is Self, as a potion's or Wild Shape's, which may still name a creature, for the app to offer its user among its targets, [`self`](#spells-and-features) (left out before, where an action's `range` of `"Self"` says the same); and for an `"enchant"`, since module 0.21.0, `enchant`, what it may enchant, and with what, as [below](#what-an-item-rolls); `null` for any other; `attackModes` the ways its attack is made, each `{ value, label }`, such as one- or two-handed, or thrown, when there's more than one, otherwise `null`; `ammunition` what its attack fires, each `{ id, name, quantity }` the character has, for a weapon that fires ammunition, otherwise `null`; `save`, `{ ability, dc }`, the saving throw it calls for, `ability` being `"DC"` when the target chooses among several; `damage` its damage or healing as dnd5e labels it, each part `{ formula, type, healing }` with the ability modifier in the formula; `consumesSlot` `false` for a spell's activity used without spending a spell slot, and otherwise left out (module 0.14.0); `attackArea` and `rollFormula` for an attack at an area and a utility with a roll of its own, as [below](#what-an-item-rolls), and otherwise left out (module 0.16.0); `check` and `forward` for a check activity and a forward, as [below](#what-an-item-rolls), and otherwise left out (module 0.21.0); `activities` each of its activities, for an item with more than one (module 0.14.0): since module 0.15.0, those activated as its section has it, and those even when there's one, where the item is listed in other sections too; `uses` as on a feature, the first activity's when the item has none: since module 0.15.0, that of the first activity it's listed for, or for one that casts a spell, those casting it spends; `level` a spell's, `0` for a cantrip, otherwise `null`; `castFrom` as on a spell, `null` for anything but a spell. Since module 0.15.0, an item listed in a section for an activity other than its first names it, `activityName`, such as `"Silvery Barbs"`, and is otherwise without; `activationType` is the kind of action its first activity there is activated with, as a section's `id` names it, `"action"`, `"bonus"`, `"reaction"`, `"legendary"`, `"mythic"`, `"lair"`, `"crew"` or `"special"`, where it takes just one, Midi-QOL's kinds of reaction being `"reaction"`, or `null` for any other, such as two actions, a Legendary Action that costs two, a minute or a long rest; `consumable` is `true` for one of the consumables: an item dnd5e's inventory has among them, such as a potion, a scroll or a wand, or another whose uses never come back, and otherwise left out; and `cast` and `spellId`, for one that casts a spell, as [below](#what-an-item-rolls). An item not identified yet has no `toHit`, `attackId`, `elvenAccuracy`, `activity`, `attackModes`, `ammunition`, `save`, `damage`, `attackArea`, `rollFormula`, `check`, `forward`, `activities`, `uses`, `activityName`, `consumable`, `cast` or `spellId`. |
| `enchantments` | Since module 0.21.0, on an inventory item, a container's contents included, a spell, a feature or an action: the enchantments an [enchant activity](#enchantments) applied to it, the character's own or anyone else's, up to 50, each `{ id, name, source, concentration, duration, expired, endable }`: `id` the enchantment's id on that item; `name` its own, such as `"Magic Weapon, +1"`; `source` the name of the item whose activity applied it, as its player knows it: without its enchantments, such as `"Magic Weapon"`, or for one not identified yet, the name dnd5e gives it then; or `null` where that can't be found, as a magic item's template from a compendium or a used-up scroll; `concentration` whether it lasts as long as a concentration, as one cast with it does; `duration` the time it has left, as an effect's, or `null`; `expired` whether its time has run out, as dnd5e 5 leaves one on its item; and `endable` whether its player may [end it](#enchantments) from the app, as the item's owner may in Foundry: one an enchant activity applied that a player could use from the app, whoever's it is, the character's own or another's, such as an ally's Magic Weapon on their club; or one whose activity is gone, as a used-up scroll's or oil's, that lasts only a while, or as long as a concentration. Not a magic item's template's, a choice made once, or one whose activity is gone that lasts for good. The changes dnd5e makes to the copy of a spell an item casts, which no enchant activity applied, aren't listed. Left out where there are none. One dnd5e hides from players isn't listed, but on an item not identified yet, one the character cast on it from another item of theirs that is, as Darkness on a ring; never one the item applies to itself, which would tell what it is, as a Flame Tongue's Ablaze. The item's `name` is as its enchantments make it, such as `"Longsword, +1"`. |
| `text` | A [description](#descriptions)'s hash, or `null` if there is none. |

#### Counters

Since module 0.29.0 a sheet's `uses` say which counter they are, so that a listener can have a
player [spend some](#concentration-charges-and-heroic-inspiration) directly, and tell whether a use
spends the same: `counter`, and `spendable` where they may be spent so. Both are added wherever
`uses` are `{ value, max, recovery }`, and left out by modules before; an item not identified yet
still has `uses` `null`.

| Field | Meaning |
| --- | --- |
| `counter` | `{ item }`, an item's own uses: a feature's, an inventory item's or a spell's, by the row's `id`, and an action's where its count is its item's; `{ item, activity }`, an activity's own, on an `activities` entry, an activity favorite, or an action whose count is its lead activity's; or `{ resource }`, an old-style resource's, `"primary"`, `"secondary"` or `"tertiary"`, on a resource favorite. Left out where the count is what a Cast activity or a forward spends of another counter, which is shown by that counter. |
| `spendable` | `true` where a player may spend them directly: an item's or activity's uses, of an item identified that isn't a spell, a spell's own uses being spent by casting it, and whose uses don't use it up as they run out (dnd5e's `autoDestroy`), as a potion's or a scroll's; and every resource's, as only those named with a maximum are listed. Left out otherwise, never `false`. |

An action and its row build them alike, so a [slim](#slim-sheets) action whose `uses` are its row's
leaves them to the row, as before; neither key is among an action's keys of its own.

Since module 0.36.0 `uses` that recharge, as a breath weapon's Recharge 5–6, say `recharge`, the
lowest d6 that recharges them: from the first of their recoveries whose period is `"recharge"`, its
formula `"6"` where it names none, from 2 to 6. Left out of every other `uses`. `recovery` still says
it in dnd5e's words, such as `"Recharge [5+]"`. A spent one may be [rolled](#damage-on-its-own-and-recharges) from the app.

#### What an item rolls

An action's `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save` and `damage` say
what it rolls, and what it's used through in the game. Since module 0.13.0, spells, features and
inventory items have them too, as an action has them, so that a player can roll them, or use them
in the game, from any tab: a spell whether it's prepared or not, an item whether it's equipped or
not. They're left out of one that rolls nothing and is used through nothing, such as a passive
feature, rope, or a spell that only summons, and out of an item not identified yet. A listener
takes a missing field as `null`, and `damage` as none.

Since module 0.14.0 they're the item's first activity's, in dnd5e's order, which for a spell is
how it's cast: Hex's are its curse's, not its Bonus Hex Damage's. Before, they were gathered from
its first attack, its first save, and the first activity with damage. An item with more than one
activity also lists each in `activities`, its first first, so that each can be rolled or used:

| Field | Meaning |
| --- | --- |
| `id` | The activity's id, by which an attack or a use [names it](#attacks). |
| `name` | Its name, such as `"Bonus Hex Damage"` or `"Grapple/Shove"`, or else its kind's, such as `"Attack"`. |
| `type` | Its kind, such as `"attack"`, `"save"`, `"damage"`, `"heal"`, `"utility"`, `"check"`, `"forward"` or `"enchant"`, or one the app can't use, such as `"summon"`. A forward's stays `"forward"`, whatever it's used through. |
| `activation`, `activationType`, `range`, `target`, `uses` | As on an action, for this activity alone. A Cast activity's `uses` are those casting its spell spends, such as the item's charges. |
| `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save`, `damage`, `attackArea`, `rollFormula`, `consumesSlot` | What it rolls, and what it's used through, as on an action. |
| `check` | For a check activity, `{ checks, dc, own }`, the checks it calls for, as below. Module 0.21.0. |
| `forward` | For a forward, `{ charges, short }`, what it spends, as below. Module 0.21.0. |
| `cast` | For a Cast activity, `{ level, concentration, charges, short, text }`, and `levels` where it may be cast higher (module 0.20.0), as below. |
| `spellId` | For a Cast activity, the `id` of the copy of its spell dnd5e keeps, as below. Module 0.17.0. |
| `duration` | How long what it does lasts, as dnd5e labels it, such as `"1 Minute"`, or `"Concentration, up to 1 Minute"` for one that takes it; for a Cast activity, as its spell's copy has it, as the Spells tab shows the spell. Left out for one that's instantaneous or has no duration. Module 0.17.0. |
| `trigger` | When it's used, as the activity's activation condition says it, such as what a reaction is taken in answer to: `"when you are hit by an attack"`. Left out where it says nothing. Module 0.17.0. |
| `text` | Under dnd5e 6, which gives an activity a description of its own, that [description](#descriptions)'s hash, enriched with its item's numbers. Left out where it has none, as always under dnd5e 5, where an activity has only a line of chat flavor. Module 0.17.0. |

An activity favorite has the same fields, and of an item not identified yet keeps them all back,
`duration`, `trigger`, `text` and `spellId` too. `consumesSlot` is `false` for a spell's activity
used after it's cast without spending a slot, such as Spirit Guardians' save each turn or Hex's
Bonus Hex Damage: dnd5e still asks the level it's used at, which its damage may scale with, but
spends nothing, so it's used whether any slot is left or not. Of the copy of a spell an item casts,
it marks an activity that spends none of the item's uses either, a cantrip's too since module
0.20.0. A spell with one activity, or an item with none, has no `activities`.

Since module 0.15.0 a Cast activity, by which an item casts a spell, such as a staff's Silvery
Barbs or a scroll's spell, rolls and is used as its spell's first activity does, as dnd5e keeps a
copy of the spell for it: `toHit`, `attackId`, `activity`, `save` and `damage` are that activity's,
with the Cast activity's own id as `attackId` or as `activity`'s `id`, by which an attack or a use
[casts it from the item](#spells-and-features). It has no `attackModes`, `ammunition` or
`consumesSlot`. `cast` says how it's cast: `level`, the level it's cast at; `concentration`,
whether it takes concentration; `charges`, how many of the item's uses, or another item's, or the
activity's own, it spends first, its cost scaled for a spell cast above its own level as dnd5e
scales it, or `null` for none, or one that's a formula; and `short`, whether any of the uses it
spends has fewer left than it spends. Its `uses` are the first it spends. One whose spell dnd5e
hasn't copied yet, or that the item can't cast, such as one the character must attune to and
hasn't, rolls nothing, as a summoning doesn't, but has the same `uses`.

Since module 0.20.0 a `cast` whose Cast activity may cast its spell higher, for more of the item's
uses, as a wand of magic missiles does, has `levels`: each level it may be [cast
at](#spells-and-features), `{ level, charges, short }`, lowest first, with `charges` and `short` as
`cast`'s own for that level. They're the levels dnd5e's usage dialog offers: from `cast`'s `level`,
the Cast activity's or the spell's own, whichever is higher, up to as many levels as its scaling
allows, the most worked out from the item's numbers, such as `min(@item.uses.value, 3)` from its
charges left, or else up to 9th. Its first is `cast`'s own level, `charges` and `short`; a level
above it that costs more than the item's uses ever come to, such as a 2014 wand's 8th and 9th with
seven charges, is left out. Only a leveled spell whose Cast activity allows scaling has them, and
none where fewer than two are left; they change with the charges left, as the sheet is sent again.
A Cast activity above its spell's own level is cast higher as dnd5e casts it: its cost and a count
of targets written with the spell's level grow with each level, but its damage, and a count
written with its scaling, stay at the Cast activity's level. Its `activity`'s `targets` and its
`attackArea` have `perLevel`, how many more for each level above `cast`'s `level`, where they had
`null` before.

Since module 0.17.0 every `cast` has `text`: its spell's description's hash, the same its copy has
on the Spells tab, so it's no more to send; or `null` for a spell without one. Before, only an
action's and an activity favorite's had it. And a Cast activity whose spell dnd5e has copied has
`spellId`, the copy's `id`, by which the Spells tab lists the spell among those cast from items, so
that the app can show the spell's details: even where it rolls nothing, such as Find Familiar's, or
the item can't cast it now, which have no `cast`. An action, feature or inventory item whose first
activity is a Cast activity has its `spellId` with its other fields.

Since module 0.16.0 two more are sent where they apply, and left out otherwise, so that a listener
that doesn't know them sees nothing new:

| Field | Meaning |
| --- | --- |
| `attackArea` | For an attack made at an area, such as a breath weapon's cone: `{ count, perLevel, affects }`, whom it's made at, as an `activity`'s `targets` say it: `count` the most targets it takes, or `null` for no limit, `perLevel` how many more for each level a spell is cast above its own, or `null`, for a spell cast from an item each level above its `cast`'s `level` (before module 0.20.0, always `null` on a Cast activity, and on its copy where the Cast activity is above the spell's own level), and `affects` dnd5e's kind of target. The app has it [made at the targets the player picks](#attacks) in the area. |
| `rollFormula` | For a utility activity with a roll of its own, such as a d4 of luck: `{ formula, name }`, its `formula` with the character's numbers in, such as `"1d4 + 3"` for `1d4 + @abilities.wis.mod`, and its `name` as dnd5e's card's button has it, or `null`. The app rolls its dice and has it [rolled in the game](#hit-dice-and-formulas). |

A Cast activity has its spell's first activity's, by its own id, as for its other fields.

Since module 0.21.0 a check activity, which calls for checks, such as Fast Hands' Sleight of Hand,
the Manacles' Bind or Maze, is [used in the game](#spells-and-features) as a save activity is,
under dnd5e 5: its `activity`'s `type` is `"check"`. Where it calls for a check the app can roll,
it has `check`, `{ checks, dc, own }`:

| Field | Meaning |
| --- | --- |
| `checks` | Each check its card has a button for, in dnd5e's order, one to ten, each `{ type, ability, key, bonus }`: `type` `"skill"`, `"tool"`, or `"check"` for an ability check; `ability` the ability it's made with, one of the six, as dnd5e makes it: the one the activity names, or else the skill's or tool's, or a tool item's own for its tool; `key` the skill or tool, left out for an ability check; and `bonus`, for a tool item's check of its own tool, or of any tool where the item is of none, the item's bonus as a whole number, which dnd5e adds to that check rolled from its card, left out where it's `0`. Each once. A tool item that names no check checks its own tool; a key that's neither a skill nor a tool, such as a kind of vehicle, is an ability check, as dnd5e's card makes it. One with an ability the app doesn't know, or a tool item's whose bonus throws dice, is left out. |
| `dc` | The activity's DC, `1` to `99`, or `null` for none, or for one the app can't show, as above 99, which a check [rolled](#descriptions-that-roll) for it isn't rolled against either. |
| `own` | Whether it's the character's own check: `false` for a spell's, a spell an item casts or one used through a forward included, which its targets make, such as Maze's; `true` otherwise. |

A check activity that calls for no check the app can roll, such as the 2014 Pipes of the Sewers',
has `activity` and no `check`: it's only used. One that scales, its DC worked out from the level
it's used at, or an item's whose level may be chosen, such as the Hat of Many Spells', has neither,
nor does one under dnd5e 6, or of an item not identified yet: they're used in Foundry. A spell's
check activity with no activation of its own, such as the 2014 Entangle's Escape Plants or Silent
Image's and Disguise Self's checks to see through them, is one its targets make once it's cast: it's
listed after the spell's other activities, even where dnd5e sorts it first, as Entangle's, so that
the spell leads with how it's cast; and for a leveled spell, but where it's the only activity the
player sees, it doesn't cast the spell: it's marked `consumesSlot` `false`, and used without
spending a slot, at the level of the slot sent for it, as any activity so marked is.

Since module 0.21.0 a forward, an activity used through another of its item's for what it spends in
place of that one's, such as the free casting dnd5e gives a spell granted with uses of its own, has
the roll fields of the activity it's used through, following a chain of them up to ten long, by its
own id: `attackId` and `activity`'s `id` are the forward's, `activity`'s `type` the other's, such as
`"utility"` for Bless's, and `save`, `damage`, `check`, `attackArea` and `rollFormula` the other's.
Its `range`, `target` and `duration`, of which dnd5e gives a forward none, are the other's; its
`activation` and `activationType` its own. A spell's is marked `consumesSlot` `false`: it's cast
with no slot, at the level dnd5e casts it at, the spell's own, or for a Pact Magic spell its pact
slots', so its `activity`'s `targets` and its `attackArea` have the `count` at that level and
`perLevel` `null`. Its `uses` are those it spends, and `forward`, `{ charges, short }`, says how
many: `charges` `0` where it spends nothing (none to spend, or the activity it's used through is a
spell's that spends no slot, for which dnd5e spends none of the forward's); a whole number of uses,
the first of the item's uses, another item's or the forward's own it spends; or `null` where what
it spends can't be counted, such as a formula; and `short` whether fewer are left, `false` for `0`
and `null`. One used through a Cast activity, a summoning, a transformation, an enchantment or
anything else the app doesn't use, or a spell's check with no activation of its own, as above;
through a chain that goes round, is broken or runs on past ten, or passes an activity or forward
the player can't see; or that lets its level be chosen, rolls nothing: it's used in Foundry. A
forward that repeats an earlier one of its item's, used through the same activity, activated the
same and for the same cost, as the free castings dnd5e gives a spell granted more than once, isn't
listed: the first alone is, by dnd5e's order. One that spends uses of its own, which dnd5e spends
from that forward's alone, repeats none.

Since module 0.21.0 an enchant activity, which applies an enchantment to an item, such as Magic
Weapon, Shillelagh, True Strike, Sacred Weapon, Pact of the Blade or a Flame Tongue's Engulf in
Flames, is [used in the game](#enchantments): its `activity`'s `type` is `"enchant"`, and the
`activity` has `enchant`, `{ self, toggle, profiles, items, applied }`. Its `targets` are as
dnd5e's, but say nothing of what it enchants: only `self` does.

| Field | Meaning |
| --- | --- |
| `self` | Whether it enchants its own item, as Engulf in Flames does, and nothing else. One used on its user alone, as Sacred Weapon is, may still enchant another item. |
| `toggle` | Whether it's a switch: one that enchants its own item and spends nothing, no use and no slot, and takes no concentration, as Engulf in Flames. Used, it's on; ending its enchantment (`endEnchantment`) puts it out. Used again with the profile its item carries, it's refused (`"applied"`), never put out. |
| `profiles` | The enchantments it may apply, in dnd5e's order, one to twenty, each `{ id, name, min, max }`: `id` the profile's, `name` its effect's, such as `"Magic Weapon, +2"`. For a leveled spell, one an item casts included, every one, with `min` and `max` the spell levels it's offered at, either `null` for no limit, as the level it's cast at decides; for anything else, those offered at its level now, a character's or a class's, as a cantrip's at the character's, with both `null`: a scroll's too, which dnd5e offers by the character's level, whatever the spell's, as a 5th-level character's scroll of the 2014 Magic Weapon its +2. |
| `items` | The ids of the character's items it may enchant, in their order, up to 500, as dnd5e's rules have it: an item of a kind dnd5e lets be enchanted, of the kind the activity enchants, or where it names none, one the Inventory tab lists; not the copy of a spell an item casts; and one dnd5e's own check takes, with the categories, properties and magic it allows, as other modules may have it. Each is asked about as it would be without what goes as the activity is used: the activity's own enchantment, which casting it again [replaces](#enchantments), and what's tied to the concentration dnd5e ends as it's used, the character concentrating on as much as they may. The 2014 Magic Weapon's weapon, made magical by it, is still offered, and so is the weapon for a scroll of the spell read while concentrating on it. Empty for one that enchants its own item. |
| `applied` | The enchantments it has applied, each `{ item, effect, profile }`, as the items' `enchantments` list them: for one that enchants its own item, the one it carries, if any; otherwise those on the character's items, up to 50. A spell an item casts has its copy's. |

One that's a choice made once, with no activation, as Eldritch Spear's, Spell Mastery's or Signature
Spells', a magic item's template, which isn't a spell's or a feature's, enchants no item of its own
and names no kind of item, as a Shield's +1, +2 or +3, or one with no profile to apply, for anything
but a leveled spell none at its level now, has no `activity`: it's used in Foundry. A forward used
through an enchant activity rolls nothing, as before.

Since module 0.29.0 an `activity` says what using it spends, `spends`, where it spends anything:
each of its consumption targets that spends uses, `{ counter, amount }`, `counter` named as
[above](#counters), `{ item }` for an item's uses, its own or another item's it names, `{ item,
activity }` for its own, `{ resource }` for a resource's value; and `amount` how many, at the level
it's cast at, or `null` for a formula. Other kinds of target are left out, and so is one of an item
not identified yet. A Cast activity's are the Cast activity's own, of its item, never its spell
copy's; a forward's are the forward's, in place of the activity it's used through, and none where
that's a spell's that spends no slot, as dnd5e spends them. Left out where it spends nothing, and by
modules before; it goes with `activity` in slim sheets.

Since module 0.36.0 every action and activity row that carries `damage`, favorites' activity rows
among them, also carries `tableDamage`: `{ normal, critical }`, the dice its damage or healing throws
[on its own](#damage-on-its-own-and-recharges), each as an [attack's `damage`](#attacks) preview is,
`{ critical, plannable, healing, rolls }`: `normal` at the activity's first attack mode, with no
ammunition, at the spell's own level; `critical` a critical hit's, as dnd5e makes it (each die
doubled, with the activity's extra dice and critical damage), or `null` for a heal and for an
activity that allows no critical hit, as a save. `tableDamage` is `null` on a Cast or forward row,
for an item not identified yet, an activity that's no attack, save, damage or heal, one with no
damage, and one whose dice can't be planned. In a [slim](#slim-sheets) sheet an action takes it
from its row, as it takes `damage`.

Since module 0.41.0, to a listener that answers `"aloneChoices": 1` (see
[Damage on its own and recharges](#damage-on-its-own-and-recharges)), a `tableDamage` that isn't
`null` also carries `choices` and `spends`. `choices` lists the plans that differ from `normal` and
`critical`, each `{ level?, attackMode?, ammunition?, normal, critical }`: at each spell slot level
dnd5e offers the spell above its own, `level`; and of an attack, in each of its weapon's attack
modes, `attackMode`, where it has more than one; with each ammunition it fires, `ammunition`, that
ammunition item's id, previewed with it; and in each of those modes with each ammunition. It's `[]`
where none differs, and left out where there would be more than 64, or where dnd5e or a module
can't work them out, the row then rolled as without them. `spends` lists what spending its use
would spend, in this order, each where it applies: `"slot"`, a spell slot casting it spends;
`"uses"`, its consumption, its own or its item's uses, a consumable's quantity or a resource;
`"ammunition"`, the ammunition an attack's weapon fires; and `"thrown"`, a weapon with a thrown mode
that doesn't return; `[]` where it spends nothing, and left out where dnd5e or a module can't work
it out. A plan is looked up by the picks that change the dice: `level`, the named slot's level,
where above the spell's own; `attackMode`, where the weapon has more than one mode; and
`ammunition`, where it fires any; the entry whose keys are exactly those, else `normal` or
`critical`. A listener reads them beside `features.rolls.aloneChoices`; to any other, `tableDamage`
is `{ normal, critical }` as before. A slim sheet's action takes them from its row too, and in a
[slim](#slim-sheets) sheet each choice goes with only what it doesn't hold alike with `normal` and
`critical`.

Any number dnd5e doesn't provide is `null`. Labels are in the Gamemaster's language. The sheet
shows what the character's player would see in Foundry: effects dnd5e hides from players, such as
an unidentified item's, are left out, even though a Gamemaster's browser sends it.

#### Slim sheets

Since module 0.22.0 a sheet goes in a smaller shape to a listener that says it expands it, with
`slimSheets` in its answers (see [Post size and slim sheets](#post-size-and-slim-sheets)): the same
sheet, with `slim` `1`, and what the listener can put back left out. Put back, it is the sheet the
module built, key for key: only the rules below change anything. A sheet without `slim` is in the
full shape, as modules before 0.22.0 send every sheet; one with a `slim` you don't know can't be
read.

**Actions by reference.** An action is mostly its item's, spell's or feature's row again. Its row
is the row with its `id` in `spells[].spells[]`, `inventory.sections[].items[]`,
`inventory.containers[]` or any `contents[]` within them at any depth, or `features[].features[]`,
the first found in that order. An action with a row goes as `{ id, ref: true, … }`, keeping every
key of its own that isn't one of those below, and each of those below it has that its row hasn't,
or holds otherwise than its row, as built; and `drop`, those below its row has and it hasn't, left
out when there are none. An action with no row, such as a class item Tidy 5e lists, goes whole.

`name`, `img`, `type`, `activityName`, `activation`, `activationType`, `range`, `target`, `toHit`,
`attackId`, `activity`, `attackModes`, `ammunition`, `save`, `damage`, `tableDamage` (since module
0.36.0), `attackArea`, `rollFormula`, `check`, `consumesSlot`, `cast`, `spellId`, `forward`,
`activities`, `uses`, `level`, `castFrom`, `concentration`, `identified`, `consumable`,
`enchantments`, `text`.

To put an action with `ref: true` back, take its row, its defaults put back, and make the action
`{ id }`, then each of the keys above: the action's own value where it has the key, else a copy of
its row's where the row has it and `drop` doesn't name it, else none; then the action's other keys;
without `ref` and `drop`. Leave out an action whose row isn't there, and take a `drop` that isn't an
array as none.

**Defaults left out.** Each key below is left out where its value is the one shown, and put back
wherever it's missing. Each is always there in the full shape, so one missing is never in doubt.

| Where | Key = default |
| --- | --- |
| A spell (`spells[].spells[]`) | `img` = `null`, `level` = `0`, `school` = `null`, `components` = `null`, `materials` = `null`, `concentration` = `false`, `ritual` = `false`, `activation` = `null`, `range` = `null`, `duration` = `null`, `target` = `null`, `prepared` = `null`, `uses` = `null`, `castFrom` = `null`, `text` = `null` |
| An item (`inventory.sections[].items[]`, `inventory.containers[]` and every `contents[]` entry) | `img` = `null`, `quantity` = `1`, `weight` = `null`, `price` = `null`, `equipped` = `null`, `attunement` = `null`, `attuned` = `false`, `uses` = `null`, `rarity` = `null`, `properties` = `[]`, `identified` = `true`, `text` = `null` |
| A container (`inventory.containers[]`, and `contents[]` entries whose `type` is `"container"`) | `capacity` = `null`, `contents` = `null`; `contents` of `[]` is kept |
| A feature (`features[].features[]`) | `img` = `null`, `kind` = `null`, `requirements` = `null`, `activation` = `null`, `passive` = `false`, `uses` = `null`, `text` = `null` |
| An activity (each entry of the `activities` of a spell, item, feature or action) | `activation`, `activationType`, `range`, `target`, `uses`, `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save` = `null`, `damage` = `[]` |
| Whom a use is at (`activity.targets` of any row, activity, action or activity favorite) | `self` = `false`, `area` = `false`, `count` = `null`, `perLevel` = `null`, `affects` = `null` |
| A damage part (each part of the `damage` of any row, activity, action or activity favorite) | `type` = `null`, `healing` = `false` |

A spell, item or feature that rolls has `damage`, even none, which is always kept: its other roll
keys are left out where they hold their defaults, and put back on any such row with `damage`. A
spell's `toHit`, `attackId`, `activity`, `attackModes`, `ammunition` and `save`, `null`; an item's
`activation`, `range` and `target`, `null`, and `concentration`, `false`, then those six; a
feature's `range` and `target`, `null`, and `concentration`, `false`, then those six. A row without
`damage` rolls nothing, and nothing is put back. Nothing else is left out but what the choices
below hold alike with their row's own: not an action's own keys or a favorite's, labels or images.

**Choices' plans.** Since module 0.41.0, wherever in the sheet a
[`tableDamage`](#what-an-item-rolls) holds `choices`, which only a listener that answers
`aloneChoices` is sent, each choice leaves out what its plans hold alike with that `tableDamage`'s
own: its `normal` or `critical` where it is the same as the `tableDamage`'s, as a `critical` of
`null` beside a `critical` of `null`; and of one that isn't, each of its `critical`, `plannable`,
`healing` and `rolls` that is the same, and in `rolls` that aren't, each of a roll's `formula`,
`type`, `types`, `dice` and `perDie` that is the same as the `tableDamage`'s own roll's at the same
place in its `rolls`. Each of those keys is always there in the full shape. To put a choice back,
give it each of `normal` and `critical` it lacks, a copy of the `tableDamage`'s; and to one it has
that the `tableDamage`'s is an object for too, each of those plan keys it lacks, and to each of its
rolls that the `tableDamage`'s own has a roll at the same place for, each of those roll keys it
lacks, each copied from there; its picks first, then `normal` and `critical`, each plan's and roll's
keys in the order above, as the module builds them. So Burning Hands at 2nd level goes as
`{ "level": 2, "normal": { "rolls": [ { "formula": "4d6", "dice": [ { "faces": 6, "number": 4 } ] } ] } }`,
put back with the rest of its plan and its roll from the row's own 3d6, and `critical: null`.

Put the defaults back first, in rows and in what they list, and in actions and activity favorites,
then the actions by reference; choices' plans before or after either. Bound what you put back: a
post of rows of nothing, of many references to one wide row, or of many empty choices beside a wide
plan, would grow many times over as it's expanded. The Sending Stone app gives up on a sheet, as
unreadable, once what it adds comes to three times the largest post it takes, or `contents` nest
deeper than 8; the module nests them 6 deep at most.

#### Descriptions

A sheet refers to each description by `text`, a 14-character hexadecimal hash of where it comes
from, and the description itself is sent in [`character.texts`](#charactertexts). It is HTML,
enriched as the character's player sees it in Foundry: links to documents are already turned into
HTML, and secret sections, which the player may see as the character's owner, are included. Since
module 0.17.0 the saving throws, damage, healing and rolls in it that the app can act on, and the
conditions it names, are spans of their own, as [below](#links-in-descriptions), and since 0.18.0
its checks; Foundry's and dnd5e's other roll links are their text. Its rolls have the numbers of
the document it's on, and an effect's those of the item or character it's on. Images and links in
it are relative to the game's address, like `img`. It is not sanitised: treat it as untrusted and
sanitise it before showing it. A description longer than 100,000 characters is cut short, short of
any tag the cut would split.

The same hash always names the same description, its links numbered the same. Its hash is of
everything what's sent depends on: the format descriptions are sent in, the rules the world is
played by and the game's language, where it comes from and its HTML, and what it shows of the
character's numbers. A description with rolls in it shows the character's level, proficiency,
ability modifiers and spell save DC; one that says "spell save DC", that DC; one that names a
saving throw, the abilities and DCs of its item's saving throws, which a saving throw without a DC
of its own takes; one that names a check, or has dnd5e's skill or tool links, the abilities, skills,
tools and DCs of its item's checks, which dnd5e's `[[/check]]` shows and a check without a DC of its
own takes (since module 0.18.0); and one with dnd5e's damage or healing links, its item's damage,
and for an item with an attack, since module 0.19.0, whether the character's critical hits with a
melee weapon throw extra dice, as Savage Attacks gives; and since module 0.20.0, its activities'
damage as dnd5e resolves it, in each of the item's attack modes, so with the character's bonuses to
damage, such as Rage's, and the scale values they name, and what a critical hit adds to it, such as
an attack's critical damage. So it gets a new hash when any of them changes. Modules 0.17.0,
0.18.0, 0.19.0, 0.20.0 and 0.21.0 each send descriptions in a new format, so each gets a new hash,
and is sent again once, with its next hello.

#### Links in descriptions

Since module 0.17.0 the links in a description that the app can act on are spans of their own,
which say what they are in data attributes, so that a player can act on them [from the
app](#descriptions-that-roll):

```html
<span class="ss-save roll" data-n="0" data-ability="dex" data-dc="15">DC 15 Dexterity saving throw</span>
<span class="ss-damage roll" data-n="1" data-formulas="2d6&amp;1d4" data-types="fire&amp;cold|fire">2d6 Fire plus 1d4 Cold or Fire</span>
<span class="ss-roll roll" data-n="2" data-formula="1d6">1d6</span>
<span class="ss-condition ref" data-condition="prone">Prone</span>
<span class="ss-check roll" data-n="3" data-checks="skill:str:ath" data-dc="15">DC 15 Strength (Athletics)</span>
<span class="ss-check roll" data-n="4" data-checks="check:int|check:wis">Intelligence or Wisdom check</span>
<span class="ss-check roll" data-n="5" data-checks="skill:str:ath|skill:dex:acr" data-dc="12">DC 12 Strength (Athletics) or Dexterity (Acrobatics)</span>
<span class="ss-check roll" data-n="6" data-checks="tool:dex:thief" data-dc="15">DC 15 Dexterity (Thieves' Tools)</span>
<span class="ss-check roll" data-n="7" data-checks="skill:dex:slt" data-using-tool="thief">Dexterity (Sleight of Hand) check using Thieves' Tools</span>
<span class="ss-damage roll" data-n="8" data-formulas="1d12 + 4" data-types="slashing" data-critical="false" data-critical-dice="1" data-critical-damage="1d6">1d12 + 4 slashing</span>
<span class="ss-damage roll" data-n="9" data-formulas="1d6 + 4" data-types="piercing" data-critical-dice="0" data-critical-damage="4">1d6 + 4 piercing</span>
```

| Span | Is | Attributes |
| --- | --- | --- |
| `ss-save roll` | A saving throw, or a concentration check. | `data-ability`: the ability, as dnd5e's key, such as `"dex"`, or several joined by `\|` for a choice, such as `"str\|dex"`; left out for a concentration check that names none. `data-dc`: its DC, a whole number from 1 to 99, where one is known. `data-type`: `"concentration"` for a concentration check, else left out. |
| `ss-check roll` | An ability, skill or tool check, or a choice of several. Module 0.18.0. | `data-checks`: from 1 to 10 checks joined by `\|`, each `check:<ability>` for an ability check, `skill:<ability>:<skill>` for a skill check, or `tool:<ability>:<tool>` for a tool check, as dnd5e's keys, such as `"skill:str:ath"`; each kind of check, by its skill or tool, or its ability for an ability check, at most once. The ability is always given: the one the description names, or else the skill's or tool's own, as dnd5e's configuration has it, as dnd5e's request for it would, never the character's own. Only the six abilities, `str` to `cha`. A tool is one of dnd5e's `tools`, or a kind of vehicle, as `water`. Keys match `[A-Za-z][\w-]{0,31}`. `data-dc` as for a save. `data-using-tool`: for a skill checked using a tool, as dnd5e's 2024 rules have it, "a Dexterity (Sleight of Hand) check using Thieves' Tools", the tool's key; else left out. |
| `ss-damage roll` | Damage or healing, in one or more parts. Since module 0.21.0, written only where this world can plan every part's dice for a player to throw: a part with a die a player can't roll, as a d3, or a die inside parentheses or a function, as Foundry's parser may put a leading `-1d4`, leaves the link as its text. | `data-formulas`: each part's formula, joined by `&`. A formula may hold Foundry's modifiers on its dice, such as `4d6kh3` or `1d6x`, and since module 0.22.0 their comparisons, such as a Great Weapon Fighter's `2d6r<=2`: each die throws its number first, the player's, as [Making a roll](#making-a-roll) has it. `data-types`: each part's kinds of damage or healing, as dnd5e's keys, joined by `&` in the same order, and a part's choice among several joined by `\|`; a part that names none has nothing in its place, and a single part that names none leaves it out. `data-healing`: `"true"` for healing, else left out. `data-critical`: `"false"` for damage never [rolled as a critical hit's](#descriptions-that-roll), else left out: damage dnd5e's own link rolls through one of the item's activities, as it does `[[/damage]]` naming no formula of its own, where that activity allows none, as a saving throw's, a healing's and most damage activities' don't, or its configuration can't be read. Module 0.19.0. `data-critical-dice` and `data-critical-damage`, module 0.20.0: what a critical hit adds to each part of damage dnd5e's own link rolls through an activity, joined by `&` in the parts' order, one for each part of `data-formulas`; both or neither, and only where it adds something. `data-critical-dice` is the extra dice on that part's first die, a whole number from 0 to 20, such as a melee weapon's for Savage Attacks or Brutal Critical: none where the part, as dnd5e builds the activity's own roll, starts with anything but a die, as a number or a die taken away, though the link's formula is written with its dice first. `data-critical-damage` is that part's critical damage, as dnd5e adds it after the part's own: empty for none; a number, from -100 to 100, for one that always comes to the same, such as an attack's critical damage of its wielder's Strength modifier, empty for 0; or else its terms, resolved, in order, as dnd5e adds them, none merged, without their flavor, each one to twenty of a d4, d6, d8, d10, d12, d20 or d100 with nothing changing them, a whole number up to 100, or a `+` or `-` (`^[\dd +\-]{0,100}$`). Where any of it throws dice, `data-critical="false"` is written too, for apps before 0.20.0, which can't plan them: one that reads the pair takes `"false"` with it to mean a critical hit's is allowed, with those additions; one that doesn't, never. An activity whose additions can't be written so allows none. |
| `ss-roll roll` | A roll in the text, such as Foundry's `[[/r 1d6]]` or `[[1d6]]`. | `data-formula`: its formula, never what the Gamemaster's browser rolled for it as it enriched the description. It may hold Foundry's modifiers on its dice, as `ss-damage`'s may, such as `4d6kh3`. |
| `ss-condition ref` | A condition named, to read about. | `data-condition`: one of dnd5e's `conditionTypes` keys, such as `"prone"`; never one dnd5e marks as only like a condition, such as burning or bleeding. |

- **`data-n`.** Each span to act on, every one but a condition, is numbered `0` to `199` in the
  order it comes in the description, and a player's command names one by its description's hash
  and this number. A description has at most 200 to act on and 200 conditions; any more are text.
- **Labels are text alone,** with no elements in them.
- **Formulas** have the character's numbers in, as dnd5e resolves them, such as `"1d8 + 3"` for
  `1d8 + @mod`: no more than 100 characters, of letters, digits, spaces and `+ - * / ( ) . ,`, and
  since module 0.22.0 `< > =`, of the comparisons dice's modifiers make, such as `2d6r<=2`; and
  one Foundry can roll. Never `@`, `&` or `|`. A link whose formula isn't is text.
- **A saving throw's DC** is dnd5e's, or else one the text gives around it, "DC 15 Dexterity
  saving throw" or "Dexterity saving throw (DC 15)", or for "against your spell save DC" the
  character's, or else that of its item's saving throw with that ability. One whose author hid its
  DC, as with `[[/save dex 15 hideDC]]`, has none in the span: the module keeps it to itself, never
  sending it, and rolls and asks for the save against it, as dnd5e does. A concentration check
  never takes its item's.
- **A check's DC** is found the same way: dnd5e's, as `[[/check]]` takes its item's check
  activity's; or else "DC 15 Strength (Athletics) check", "Strength (Athletics) check (DC 15)", or
  "check against your spell save DC" around it; or else that of its item's check for one of its
  checks, by the skill or tool and the ability it's made with, or for an ability check, its ability.
  One whose author hid it, as with `[[/skill ath 15 hideDC]]`, is kept by the module alone, as a
  save's is.
- **What's marked:** dnd5e's saving throw, concentration, damage and healing links, and since
  module 0.18.0 its check, skill and tool links (`[[/check]]`, `[[/skill]]`, `[[/tool]]`); Foundry's
  inline rolls made for everyone to see, such as `[[/r 1d6]]`, and those rolled as the description
  was enriched, such as `[[1d6]]`; links to a condition's rules, dnd5e's
  `&Reference[prone]`, or a link to a condition's page in either the 2024 or 2014 rules; and in a
  game in English, plain text such as "a DC 15 Dexterity saving throw", "a Strength or Dexterity
  saving throw", "a DC 15 Strength (Athletics) check", "an Intelligence or Wisdom check", "a
  Strength (Athletics) or Dexterity (Acrobatics) check", "a Strength, Dexterity, or Constitution
  check" (six choices at most), "2d6 fire damage" or "7 (2d6) fire damage", with skills named as
  dnd5e names them. Conditions are also marked by their
  names, capitalised as dnd5e names them, in any language, and in English in lower case where the
  words around say something is in one, as "falls prone" or "the poisoned condition" do. Text in a
  link, a heading or a button is never marked; "advantage on Strength saving throws" isn't a
  saving throw, nor "advantage on Strength checks" a check, and a passive check, "passive Wisdom
  (Perception)", is no check to roll.
- **What's text:** an inline roll that always comes to the same, such as `[[@prof]]`, as what it
  comes to; one made for the Gamemaster's eyes or the roller's alone, such as `[[/gmr]]`, `[[/br]]`
  or `[[/sr]]`; dnd5e's attack, passive check, item and lookup links; a check with no ability,
  skill or tool dnd5e has, or with an ability other than the six, such as dnd5e 6's `spellcasting`,
  or with more than 10 checks; a tool's check in plain text, and a saving throw or check in plain
  text that ends a list of choices longer than those it takes, rather than offering only the last;
  and what dnd5e or Foundry couldn't enrich, such as `[[/save]]` on an item with no saving throw,
  or `[[/check str/dex]]`, as its label, or else the words of its configuration, such as `2d6 fire`
  for `[[/damage 2d6 fire]]`. dnd5e's "Request Roll" and "Apply Status" buttons and its award
  links, which are the Gamemaster's, are left out.
- **A condition's rules,** a condition's `text`, mark conditions only, with nothing to act on.
- **Nothing in the source is trusted.** Any class beginning `ss-`, and any `data-n`, in what was
  stored are taken off first, and the attributes above and the class `roll` are taken off every
  element but the spans made. So a span a player wrote into their biography acts on nothing.
- **Older listeners** see the classes `roll` and `ref` that Foundry's and dnd5e's links had, and can
  show them as before. A listener that doesn't know `ss-check` can show it as text.

### Group

Since module 0.30.0, under D&D Fifth Edition, a campaign's Gamemaster adds Group actors, its parties,
to it in Manage Campaigns, and its players see each group's sheet as Foundry lets them. A campaign
may have several, and a group may be in several campaigns. dnd5e's encounters, an Actor type of
their own, are never one.

```json
{
  "id": "party",
  "uuid": "Actor.party",
  "name": "The Company",
  "img": "party.webp",
  "type": "group",
  "primary": true,
  "access": { "thorin": "observer", "vex": "owner" },
  "sheet": { "…": "see below" }
}
```

| Field | Meaning |
| --- | --- |
| `id`, `uuid`, `name`, `img`, `type` | The group's actor: `uuid` `"Actor.<id>"`, `img` as stored or `null`, `type` always `"group"`. |
| `primary` | Is it the world's primary party, as dnd5e's actors directory sets it (`game.actors.party`)? |
| `access` | Which of the campaign's characters may see it, as Foundry lets their players: by each character's player owners' highest ownership of the group, or for a character no player owns, the group's default; `"owner"` for Owner, `"observer"` for Observer. A character whose players have Limited or less on it, or none, has no key. Gamemasters count for none: they see every group. `{}` means no player may see it. |
| `sheet` | In `group.updated`, the group's sheet, as below; `null` where it's private, `access` being `{}`, or withheld as too large, with `sheetWithheld` saying so: `{ reason: "private" }` or `{ reason: "tooLarge", bytes, limit }`, as a character's (see [Character](#character)). A private group goes with no descriptions at all. Absent in a hello. |

Its sheet: what any of its players may see of it, and nothing more, observers and owners alike.

| Field | Meaning |
| --- | --- |
| `members` | Its members, as dnd5e's group sheet lists them: characters, then NPCs, then vehicles, each by name in the game's language. Each is exactly `{ id, name, img, type, character }`, and nothing else of any member is ever sent, not their level, classes or hit points: `img` their token's image where the group shows token portraits (`flags.dnd5e.showTokenPortrait`), never one of its random images, else their own, or `null`; `type` `"character"`, `"npc"` or `"vehicle"`; `character` `true` for one of the campaign's characters. A member no longer in the world, and any other kind of actor, is left out. |
| `description` | `{ full, summary }`, each the hash of a [description](#descriptions) sent in `character.texts`, or `null`. dnd5e shows a group's secrets to its owners alone, so they're enriched without secrets, and with no link to act on: the hash never names the same text as a character's would. |
| `inventory` | The group's own items, never its primary vehicle's, exactly as a [character sheet](#character-sheet)'s `inventory`, with nothing to roll, use or enchant: no roll, use or enchantment fields on any item; `uses` read-only; `encumbrance` and `attunement` `null`. Item and container ids are Foundry's; currency ids are dnd5e's, and a value may be fractional under dnd5e 6. |
| `slim` | `1` where the listener expands [slim sheets](#slim-sheets), which a group's are made as a character's are. |

### Companions

Since module 0.36.0 a campaign's characters' companions are listed beside them, to a listener that
reads them: the creatures each character summons, and the NPCs its player owns. For each campaign
character `C` and its players `U` (its non-Gamemaster users with Owner), each condition read on the
creature's **live actor**: a token's synthetic actor for an unlinked token, the world actor for a
linked one or one with no token.

1. **Summoned:** a token on the **active scene**, not hidden, whose live actor is an NPC, isn't
   transformed (`flags.dnd5e.isPolymorphed`), and has `flags.dnd5e.summon.origin` beginning
   `Actor.<C's id>.Item.`, the item being `C`'s own. Who cast it doesn't matter: a familiar the
   Gamemaster summoned with the character's spell is the character's, though its player doesn't own
   it in Foundry.
2. **Owned:** a live actor of type `npc`, not a campaign character, not transformed, not carrying
   `flags.dnd5e.summon`, not a summon's template (`flags.dnd5e.isAutoImported`), whose own
   `ownership` gives a user of `U` Owner by their id, never through `default`: a **linked** one, the
   world actor, always, on a scene or not; an **unlinked** token on the active scene, not hidden, its
   synthetic actor's ownership its delta's where set, else its base's, so a Gamemaster who shares one
   placed wolf by its token makes that wolf a companion while the world Wolf stays theirs. A world NPC
   whose prototype is unlinked is never itself one: only its placed tokens are.
3. **Not companions:** a campaign character; since module 0.40.0, a campaign character's form; a
   `character`-type actor; any transformed actor; a
   group, vehicle or encounter; a hidden token; a token on any scene but the active one; an NPC owned
   only through `default`; a summon's template; a token with no live actor yet.
4. **Once each:** a token both summoned by `C` and owned by `U` is listed once, as summoned.
5. **Whose:** `of`, every campaign character it's a companion of: a summon's summoner; an owned
   NPC's every character played by a user who owns it.
6. **Order:** per character, owned first, then summoned, each by name, then key; the campaign's, its
   characters' in the roster's order, each companion once, at its first character, with every `of`.
7. **Limits:** at most 20 a character and 50 a campaign, the rest left out in that order, never
   listed and never commanded.

**Keys:** a world actor's companion is keyed by its actor id; a token's creature by
`<sceneId>-<tokenId>`, a hyphen never occurring in Foundry's ids, so two wolves placed from one Wolf
are two companions. A key never names a campaign character. A token re-created on another scene, or
switched between linked and unlinked, is a new companion.

```json
{ "key": "sceneA-tokWolf1", "of": ["thorin"], "kind": "owned", "actorId": "wolf", "tokenId": "tokWolf1",
  "sceneId": "sceneA", "uuid": "Scene.sceneA.Token.tokWolf1.Actor.wolf", "name": "Wolf", "img": "wolf.webp", "summon": null }
```

| Field | Meaning |
| --- | --- |
| `key` | As above. |
| `of` | The campaign characters' actor ids it's a companion of, one or more. |
| `kind` | `"owned"` or `"summoned"`. |
| `actorId` | Its world actor's id; a token's creature's, its base actor's. |
| `tokenId`, `sceneId` | A token's creature's token and scene; `null` for a world actor's. |
| `uuid` | Its live actor's, a token's creature's `Scene.<s>.Token.<t>.Actor.<base>`. |
| `name` | The token's name for a token's creature, else the actor's, cut to 200 characters. |
| `img` | Its live actor's portrait, or `null` where it has none or one longer than 2,000 characters. |
| `summon` | A summoned one's `{ itemId, item, activityId }`: the summoning item's id and name, and its activity's id or `null`; `null` for an owned one. |
| `sheetWithheld` | In `companion.updated` only, where its sheet was too large: `{ reason: "tooLarge", bytes, limit }`, as a character's. |

**Live actors:** what's rolled, read and sent of a token's creature is its synthetic actor, its own
hit points and items; nothing is read of its base. **Who commands one:** a command names it by its
key as `actorId` and its character as [`of`](#fetching-rolls); the module makes it only where the
companion is `of`'s by the rule above **now**, as the player of `of`, whoever owns the creature in
Foundry, so a familiar the Gamemaster summoned, or a wolf two players own, rolls as its player.
**Without secrets:** where none of its characters' players owns its live actor in Foundry, as a
familiar the Gamemaster summoned, its sheet's descriptions are sent without secrets, and its
biography is dnd5e's public one, none where that's blank; its links stay ones to act on.
**What stays in Foundry:** summoning, dismissing and changing a companion; spending its charges by
hand, its hit dice, Heroic Inspiration, moves, removals and journal notes, none of which a companion
has in the app; a companion's own transformation, a transformed actor being no companion; and the
saves the game asks of a companion, rolled in Foundry, but since module 0.41.0 asked in the app of a
listener that answers `"companions": 2` (see [Saves the game asks for](#saves-the-game-asks-for)).

**Companions' initiative:** each campaign's Gamemaster chooses in Manage Campaigns how its
companions enter initiative, `features.companions.initiative`:

- **`"own"`**, *Its own roll*, the default and a campaign's saved before 0.36.0: each companion's
  initiative is its own, rolled in Foundry or from the app, as any combatant's.
- **`"after"`**, *Right after its character*: whenever one of a companion's characters' initiative
  is set, rerolled or cleared, from the app or in Foundry, the module sets the companion, where it's
  a combatant of the same combat, to `Math.round((I - 0.001) * 1000) / 1000`, `I` its character's.
  dnd5e sorts by initiative first and makes its own initiatives in hundredths, its Dexterity
  tiebreaker included, so 0.001 below sorts straight after the character and before anything dnd5e
  rolls below it: 18.14 makes 18.139, 16 makes 15.999. A combatant tied with the character that
  dnd5e sorts after it by name still comes between them. A companion of two characters follows the
  first of its `of` with an initiative in that combat; one with none of its characters in the combat
  is left alone; where its character's is cleared and no other of its characters there has one, its
  own is cleared too. A change made to the companion's own initiative stands until its character's
  next, through a save of the campaigns that doesn't switch its campaign and a Gamemaster's page
  load, which follow a character's change missed while no Gamemaster was connected only for a
  companion the module placed last or with none. Switching a campaign to `"after"` places every
  companion whose character has an initiative, in every combat, at once; switching back changes
  nothing. Only the active Gamemaster's Foundry writes, whether or not an app is set, and its own
  writes never set off another, so two NPCs that are each the other's companion in another
  campaign never move each other twice. Each write is an initiative's change, not a roll: dnd5e's
  recoveries on rolling initiative don't run for a companion placed so. The companion's own
  `initiative` from the app is refused
  [`"follows"`](#commandresult) while one of its characters is a combatant of that combat; with none
  of them in it, it's rolled as its own.

### Chat message

| Field | Meaning |
| --- | --- |
| `id`, `uuid` | The message's id and UUID. |
| `type` | The message subtype: `"base"`, or a system's own, such as dnd5e's `"usage"`, `"turn"`, `"rest"` and `"request"`. |
| `style` | `"OTHER"`, `"OOC"`, `"IC"` or `"EMOTE"`. |
| `timestamp` | When it was created, in milliseconds since the epoch. |
| `author` | `{ id, name }` of the user who created it. |
| `speaker` | `{ alias, actorId, tokenId, sceneId }`. The ids are `null` when not spoken by an actor. |
| `character` | The campaign character's actor id if one spoke it, else `null`. Since module 0.40.0 a transformed actor stands for its character: a form's messages carry its character's id, and keep it once the form is deleted, though Foundry then finds no speaker for one whose speaker names no token. |
| `companion` | Since module 0.36.0, and only to a listener that [reads companions](#companionslisted): the [companion](#companions) it's the campaign's, by its key in the list the campaign was last told: the module's own mark where it made the message for a companion's command (`flags["sending-stone"].companion`), else the listed companion whose live actor spoke it (`speakerActor`), else `null`. Absent for any other listener. A message a companion spoke counts as spoken by the campaign's characters, under chat scope `"connected"` too. |
| `alone` | Since module 0.36.0, to every listener: `true` on a damage or healing card the app's [`itemDamage`](#damage-on-its-own-and-recharges) made, by the module's own flag on it (`flags["sending-stone"].alone`); left out on any other message, an attack's or a use's damage and a recharge's among them. Like `gmRoll`, it's a claim, as the message's author may change its flags: a listener may say the card was made on its own, but should do nothing more on its word. |
| `title` | The pop-out title, or `null`. |
| `flavor`, `content` | As stored, in HTML. Content links are not yet rendered: they appear as `@UUID[…]{Label}`. Since module 0.29.0, unless Gamemaster-only information is on, `content` is cleaned of what cards keep from players there, parsed into an inert document and written back: every element's `data-dc` is removed; dnd5e's labels with DCs (`.visible-dc`) are removed where its *Challenge Visibility* doesn't show players the card's DC, as `ask`'s `dc` below; and Midi-QOL's sections of hits and saves (`.midi-qol-hits-display`, `.midi-qol-saves-display`), which the client that ran its workflow, often the Gamemaster's, draws with armor classes and DCs, are emptied. Since module 0.30.0, on a Gamemaster's card of Midi-QOL's, what Midi's *GM Attack Roll Display* and *GM Damage Roll Display* keep from players goes too, with its attack and damage buttons: see [A Gamemaster's rolls on Midi-QOL's cards](#a-gamemasters-rolls-on-midi-qols-cards). With it on, `content` is as stored. Read results from `dnd5e` below, never from `content`. |
| `text` | `content` as plain text, with content links reduced to their labels. dnd5e's cards, such as a roll request or a spell's saving throw, give each button two labels, with its DC and without, and show one; since module 0.17.0, only the one players see is kept, as `ask`'s `dc` below. Before, both were. Since module 0.29.0 it's made from `content` as sent, so without Midi's sections' words either, unless Gamemaster-only information is on. |
| `ask` | The save, or since module 0.18.0 the check, a roll request card asks the table for, or `null` for any other message: the Gamemaster's, posted from a `/save`, `/concentration`, `/check`, `/skill` or `/tool` enricher's request link, or a player's [asked from the app](#descriptions-that-roll). For a save, `{ type, abilities, dc, label }`: `type` is `"save"`, or `"concentration"` for a concentration check; `abilities` the abilities its buttons offer, as dnd5e's keys, or for a concentration check the one it names, if any. For a check, `{ type: "check", checks, dc, label }`: `checks` the checks its buttons offer, from 1 to 10, each `{ type, ability }` with `type` `"check"` for an ability check, `{ type: "skill", ability, skill }`, or `{ type: "tool", ability, tool, name }`, with the tool's `name` as dnd5e names it, never as the card labels it; each check once, each ability one of the six, its button's or else the skill's or tool's own, and each skill and tool one dnd5e has, a tool or a kind of vehicle; a card that offers none of them, or more than 10, has `null`. For either, `dc` its DC, only where dnd5e's *Challenge Visibility* shows players the card's DC: *Show all*, or *Show only from other players* for a card a player posted; and never for a card that shows it no one, as dnd5e's request for a link whose author hid its DC, or any card that labels its buttons alike with the DC and without; otherwise left out; `label`, for a player's, where the save or check comes from, such as their item, and otherwise left out. dnd5e 6's requests, which are messages of their own kind, have `null`. Module 0.17.0; checks, 0.18.0, before which a check's request card has `null`. |
| `blind` | Was it a blind roll? |
| `audience` | Who can read it. See [Visibility](#visibility). |
| `rolls` | Every roll in the message, as below. Since module 0.30.0, on a Gamemaster's card of Midi-QOL's with Gamemaster-only information off, as Midi shows them to players: see [A Gamemaster's rolls on Midi-QOL's cards](#a-gamemasters-rolls-on-midi-qols-cards). |
| `system` | The subtype's data for any `type` other than `"base"`, else `null`. Since module 0.30.0, unless Gamemaster-only information is on, without what dnd5e keeps from players there, under every dnd5e version: every target's armor class (`targets[].ac`), every button's DC (`buttons[].dataset.dc` on a usage card, and `buttons[].dc` on dnd5e 6's `prompt` messages, its posted roll requests and concentration checks, whose labels each client draws for itself), a button's label with its DC (`buttons[].label.value`, replaced by its `label.hidden` unless that's blank, as dnd5e draws it) where *Challenge Visibility* doesn't show players the card's DC, as `ask`'s `dc` above, and a request's DC and target (`data.dc`, `data.target`). |
| `dnd5e` | Under dnd5e, what the system recorded about the message, as below: from dnd5e 5's flags, and since module 0.30.0 from dnd5e 6's typed messages (`type` and `system`), which before had `null`. Otherwise `null`. |
| `gmRoll` | Since module 0.23.0, on a message flagged as made for a roll the campaign's Gamemaster made in the app as a character (`flags["sending-stone"].by` `"gm"`, see [Making a roll](#making-a-roll)), that roll's `id`: the roll it was made for, the use whose card it is, or the death save whose outcome it tells. Left out on any other. The message's author, a player, may change its flags, so it's a claim, which a listener checks against the rolls it handed over as the Gamemaster's. A player can copy a real one onto a message of their own too, so the app takes it only on a message spoken by the character the roll was made as, and only while the roll is being made: the module sends the messages a roll makes before the [`command.result`](#commandresult) that says it was made. Since module 0.25.0 that result lists the messages the roll made, [`messages`](#commandresult), where the hello says `gmRollMessages`, so a listener can take `gmRoll` on those alone, whichever arrives first, and never on a copy a player's browser made. A module that creates chat messages on the Gamemaster's browser for players, as Midi-QOL's `createChatMessage` socket does, could still have a copy listed while the roll is being made. |

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
failure against a DC is deliberately not included in a roll: since module 0.29.0, where players see
it in Foundry, it's in the message's `dnd5e`, below.

Since module 0.28.0 a roll also says what it is among its message's rolls, so that a listener can
show a message's damage as one, as dnd5e's damage card and Midi-QOL's item card do. Each is left
out where it doesn't apply, never `null` or `false`:

| Field | Meaning |
| --- | --- |
| `damage` | `true` for a dnd5e `DamageRoll` (`CONFIG.Dice.DamageRoll`), with a type or without one. |
| `damageLabel` | Where `damageType` is sent, the words dnd5e's damage card names it by, in the game's language: its short label, else its label, from dnd5e's damage types or else its healing types, such as `"Piercing"` or `"Temp HP"`. Left out for a type not among them. Midi-QOL adds types of its own to them, `none`, `midi-none` and `vitality`, with its labels, so where Midi is active those have one too. |
| `section` | On Midi-QOL's item card, the part of the card a roll belongs to, by the tag Midi gives it (`options["midi-qol"].rollType`): `"damage"` for the item's own damage (`"defaultDamage"`), `"bonus"` for a bonus macro's, such as Sneak Attack's (`"bonusDamage"`), and `"other"` for its other damage, such as poison on a failed save (`"otherDamage"`). Left out for Midi's attack and utility rolls, and for any roll Midi didn't tag. A bonus macro's own plain `Roll`, which Midi keeps as it is, has `section` `"bonus"` but no `damage`. |
| `flavor` | For `"bonus"` damage only, the bonus's name from the roll's flavor, trimmed, such as `"Sneak Attack"`. Midi gives a bonus whose macro names none its type as its flavor, so a flavor that is the roll's type, or any of dnd5e's damage or healing types in any case, is left out. |
| `attack` | `true` for the attack: the roll Midi tags `"attack"` on its card, or one whose dnd5e kind of roll, `options.rollType`, is `"attack"`, which dnd5e copies to each roll of an attack from its message's `roll.type`. |

A bonus macro's damage on Midi-QOL's item card:

```json
{
  "class": "DamageRoll",
  "formula": "3d6",
  "total": 11,
  "dice": [{ "expression": "3d6", "faces": 6, "number": 3, "results": [{ "result": 4, "active": true }, { "result": 2, "active": true }, { "result": 5, "active": true }] }],
  "critical": false,
  "damage": true,
  "damageType": "piercing",
  "damageLabel": "Piercing",
  "section": "bonus",
  "flavor": "Sneak Attack"
}
```

Each is read from the roll alone, from the options Foundry keeps with a message's rolls, so a
message sent again, after a reload or by a Gamemaster's client that never ran Midi's workflow, says
the same. Midi's `useOther`, which draws a card's own damage in its other damage section, is never
followed, and such a card's own damage has `section` `"damage"`, a known limit: in Midi's source it
is only declared and read, never set; it isn't kept with the card, so a workflow rebuilt from its
card, or a Gamemaster's client for a player's workflow, lacks it; the flags it changes,
`damageTotal` and `damageDetail`, are written elsewhere too; and only the card's own HTML shows it,
which is Midi's own and is written over where the card has other damage. The same fields are on
[`command.result`](#commandresult)'s `rolls`.

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
| `messageType` | dnd5e's own classification, such as `"roll"` or `"usage"`; under dnd5e 6, the message's `type`, such as `"attack"` or `"save"`. |
| `roll` | What was rolled, exactly as dnd5e records it. `type` is one of `"skill"` (with `skillId`), `"tool"` (with `toolId`), `"ability"` or `"save"` (with `ability`), `"attack"`, `"damage"`, `"death"`, `"hitDie"`, `"concentration"` or `"generic"`. `null` if not a roll. Under dnd5e 6, since module 0.30.0, made from the message's `type` and `system` as dnd5e 5 names it: `"attack"`, `"damage"`, `"healing"` and `"hitDie"` as they are; a save `"save"`, a concentration save's among them, and a death save `"death"`; a check `"skill"`, `"tool"` or `"ability"`, by its `system.skill` and `system.tool`, never initiative; each with `ability`, `skillId` and `toolId` where `system` has them; `null` for any other. |
| `item`, `activity` | The item and activity used, or `null`. |
| `targets` | What was targeted when the item was used, each `{ name, uuid }`, `uuid` the target's actor's; under dnd5e 6 from `system.targets`, `uuid` their `actor`. `ac` is added only when Gamemaster-only information is on. Since module 0.29.0 each may have `outcome` and `save`, as below. |
| `originatingMessage` | For a roll made from an item's chat card, the id of that card's message; under dnd5e 6, `system.origin`'s, else dnd5e's flag. |
| `save` | Since module 0.29.0, on a saving throw rolled from a save activity's card of dnd5e's, and since 0.30.0 on any saving throw but a death save, from any origin (`roll.type` `"save"` or `"concentration"`): `{ target, outcome, readers }`, as below. Left out on any other message. |
| `check` | Since module 0.30.0, on an ability, skill or tool check, from any origin (`roll.type` `"ability"`, `"skill"` or `"tool"`): `{ target, outcome, readers }`, as `save`. Left out on any other message. |

**Hits, misses, saves and checks** (module 0.29.0; checks, and every rule as Foundry draws it for a
player, from dnd5e 5.3.3's, dnd5e 6.0.5's and Midi-QOL v14's own code, since 0.30.0). What Foundry
decided of a message's targets is told only once it's decided, and only where Foundry shows players
it: unless Gamemaster-only information is on, when everything decided is told, as `ac` is, and
`readers` never is. The settings are read as the message is sent, each that can't be read counting
as hiding it; one changed later sends no message again. A message Midi-QOL shows players as "??"
(`flags["midi-qol"].obscureRoll`) tells none, unless Gamemaster-only information is on. Each field
is left out where it isn't told. Midi-QOL's settings are named by their own labels.

**Hit/miss and save results in the app** (module 0.31.0, the world setting `chatResults`): "Follow
Foundry's visibility settings" (`"foundry"`, the default) tells as above; "Always show them to
players" (`"always"`) tells everything decided, as Gamemaster-only information does, to everyone
who gets the message, `readers` never, but never `ac`, a DC or anything else Gamemaster-only
information alone adds, and nothing of a roll Midi-QOL shows players as "??". A message's audience,
`content`, `text`, `system` and `rolls`, the [Gamemaster's rolls](#a-gamemasters-rolls-on-midi-qols-cards)
trimmed as Midi-QOL's settings have them among them, are exactly as under "Follow". Whispered and
blind messages go only to those who may read them, as ever. Changing it sends `bridge.settings`, not
a hello, and no message already sent again.

| Field | Meaning |
| --- | --- |
| `targets[].outcome` | `"hit"` or `"miss"`. On dnd5e's attack (`roll.type` `"attack"`, its first roll a `D20Roll`), as its card judges each target: a critical hit hits, a fumble or a total under the target's `ac` misses, and since module 0.30.0 a target under total cover (`ac` `null`) is drawn as dnd5e's version draws it: a hit under dnd5e 5 unless the attack is a fumble, a miss under dnd5e 6. Before, it was a miss under both, as the app's own attacks are still judged (`attack.outcome` in a command's result). Told while dnd5e's *Attack Result Visibility* is "Show only results" or "Show results & target ACs" (its `attackRollVisibility` setting, `hideAC` or `all`), never under "Hide all" (`none`); nothing for a target with no `ac` at all. **With Midi-QOL active**, which draws no tray of targets on any message, since module 0.30.0 only for an attack at one target, by dnd5e's own highlight of the total: where the d20 has the target's armor class (its `options.target`, which dnd5e gives an attack at a single target) and is one d20 dnd5e judges, unmodified, and while Midi's *Color code Hit/Miss/Save Display* is on and *Only highlight critical/fumble hits* off; never under total cover, which gives the d20 no target. **On Midi-QOL's card** (one whose `flags["midi-qol"].messageType` is a string), only once Midi has checked (`GMOnlyAttackRoll` `false`, which Midi writes `true` before it checks), on a card with an attack roll (so not a use whose every target Midi lists as hit), by the three ways Midi shows players hits, in this order. Its hits section: under *Auto check if attack hits target* "Check - all see result" (`all`) with *Attack Result Visibility* showing results (since 0.30.0: before, whatever it was), from the tokens Midi records as hit (`hitTargetUuids`, `hitECTargetUuids`) and as aimed at (its `targets`), each taken for its actor; nothing for a target that would be a miss on a critical card (`isCritical`), as Midi draws every row of a critical hit. Since 0.30.0, the Gamemaster's words in place of the total: on a Gamemaster's card at one target, under *GM Attack Roll Display* "Hit/Miss Only" or "Hit/Miss/Critical/Fumble" (`hitMiss`, `hitMissCrit`) and *Auto check if attack hits target* "None" or "all", the word Midi writes, from `isHit`, under the second `isCritical`, then `isFumble`, first; under "None" only where the d20 has a target. And since 0.30.0 the success or failure Midi marks on the total of a card at one target whose d20 has a target, as its icons read it: under *Auto check if attack hits target* "None" or "all", *Attack Result Visibility* showing results, *Color code Hit/Miss/Save Display* on and *Only highlight critical/fumble hits* off, of one d20 Midi judges, never on a Gamemaster's card under *GM Attack Roll Display* "Hidden". Told to every reader of the card, whatever its whispers, as Midi draws it (before 0.30.0, only on a card whispered to no one). Nothing for a target whose token can't be found, as one deleted since, nor for an actor two of whose tokens came out differently. With Gamemaster-only information on, or since module 0.31.0 Hit/miss and save results in the app Always, everything Midi checked; where it checked nothing ("None"), the total's outcome for a card at one target whose d20 has one, and since 0.31.0 for any other, at several targets or one whose d20 has none, each target judged against the `ac` Midi writes on its card, as the d20 would be: one under total cover (`ac` `null`) a miss, one with no `ac` at all told nothing. A Shield cast, or a Gamemaster's ruling, after the roll isn't reflected, as Midi didn't check it. With either, dnd5e's own attack in a world with Midi-QOL is told for every target by its `ac`, as without Midi. |
| `targets[].save` | `"success"` or `"failure"`, on Midi-QOL's card only, from the tokens Midi records as saved (`saveUuids`) and as failed (`failedSaveUuids`), each taken for its actor, never from `saved`: only once Midi has checked saves, its *Auto check Saves* not "Off" (`none`), and shown them, some target marked `saved` `true` or `false` (Midi lists every target as failed before anyone rolls). Since module 0.30.0, told for each target as Midi draws it, by the target alone: under *Auto check Saves* "Save - All see result only", "Save - All see result + save total" or "Save - All see Result + Rolls" (`allNoRoll`, `all`, `allShow`), for a target a player owns where dnd5e's *Challenge Visibility* is "Show all" or "Show only from other players", and for any other only under "Show all". The card's speaker, its DC, its whispers and its activity's own *Save Display* play no part, as they did before 0.30.0. Nothing for a target Midi decided nothing of. |
| `save.target` | The `uuid` of the actor who saved, as cards' `targets` name it: the message's speaker's. Sent whenever that resolves, on a save of any origin since module 0.30.0: a save activity's card, Midi-QOL's card, a request in chat, dnd5e's concentration card, a link in a description, or none. Before, on a save activity's card still in the chat log alone. |
| `save.outcome` | `"success"` or `"failure"`, as dnd5e highlights it: its first roll a `D20Roll` against a DC (`options.target`), whose first die is one d20 dnd5e counts no otherwise (no success counting or margins); a legendary resistance's forced success (dnd5e 5's `roll.forceSuccess`, dnd5e 6's `resisted`) a success. A link whose author hid its DC is rolled against it anyway, so its roller sees it, but the DC itself is never sent. With Midi-QOL active, since module 0.30.0 only while its *Color code Hit/Miss/Save Display* is on and *Only highlight critical/fumble hits* off, as Midi strips dnd5e's highlight from every roll otherwise. Told as dnd5e's *Challenge Visibility* shows it for the card it was rolled from, its `originatingMessage` still in the chat log, Midi-QOL's among them, or else for the roll itself, whose author is its roller: under "Show all", or "Show only from other players" for a card a player posted, to everyone; otherwise, for a card a player posted, to its author's characters alone, with `readers`, and not at all where they have none; otherwise not at all. |
| `save.readers` | The ids of the campaign's characters whose players alone may see `outcome`: those the card's author owns. Absent where everyone who can read the message may. |
| `check.target`, `check.outcome`, `check.readers` | Since module 0.30.0, as `save`'s, for an ability, skill or tool check: from a check activity's card, a request in chat, a link in a description, or none. |

#### A Gamemaster's rolls on Midi-QOL's cards

Since module 0.30.0, with Gamemaster-only information off, a Gamemaster's card of Midi-QOL's (its
author a Gamemaster, `flags["midi-qol"].messageType` a string) has its `rolls` and `content` trimmed
as Midi's *GM Attack Roll Display* and *GM Damage Roll Display* show it to players, and never more
than those settings' own words say they show. Nothing changes where both are "Full Roll", on a
player's card, on any other message, or with Gamemaster-only information on. Where Midi's settings
can't be read, both count as "Hidden". A roll keeps every key and its type: what's gone is an empty
`formula` (`""`), no `dice` (`[]`), or no `total` (`null`), which a listener shows as "–".

The attack roll (`attack` `true`), by *GM Attack Roll Display*. "If marked" means the roll's own
`critical` and `fumble` are kept only where Midi marks the total for players, under *Auto check if
attack hits target* "None" or "all", *Attack Result Visibility* showing results and *Color code
Hit/Miss/Save Display* on; otherwise they're `false`. Outside "Hit/Miss Only" and "Hidden",
`critical` is also `true` where Midi's hits section is shown (as under `targets[].outcome`) and the
card, which lists a target, is a critical (`isCritical`), as its rows' ✓✓ show it. `advantage` and
`disadvantage` are kept, as Midi's label says them, except under Midi's fake dice (`addFakeDice`),
whose label always reads "Attack": then both are `false` under every value but "Full Roll".

| *GM Attack Roll Display* | `formula` | `dice` | `total` | `critical`, `fumble` |
| --- | --- | --- | --- | --- |
| "Full Roll" (`full`) | as rolled | as rolled | as rolled | as rolled |
| "Hide Formula" (`hideFormula`) | `""` | `[]` | as rolled | if marked |
| "D20 Only" (`d20Only`) | `""` | exactly `[{ "expression": "d20", "faces": 20, "number": 1, "results": [{ "result": N, "active": true }] }]`, `N` the one number Midi shows, the first term's total: never the die's own expression, how many were rolled, or any other result | `null` | if marked |
| "Attack Total Only" (`attackTotal`) | `""` | `[]` | as rolled | if marked |
| "Hit/Miss Only" (`hitMiss`) | `""` | `[]` | `null` | both `false` |
| "Hit/Miss/Critical/Fumble" (`hitMissCrit`) | `""` | `[]` | `null` | `critical` where the card's `isCritical` is `true`, or marked and rolled; `fumble` otherwise where its `isFumble` is, or marked and rolled |
| "Hidden" (`hidden`) | `""` | `[]` | `null` | both `false` |

Damage rolls (`damage` `true`), by *GM Damage Roll Display*: under "Full Roll" as rolled; under
"Damage Total Only" (`totalOnly`) with `formula` `""` and `dice` `[]`; under "Hidden" with `total`
`null` too. Unless Midi shows each roll apart (*mergeCardMultiDamage*), under those two each
`section`'s damage rolls arrive folded into one, as Midi draws one total per section, in its first
roll's place: of its `class`, `damage` and `section`; its `total` the section's, each part by
damage type counted as at least 0 as Midi adds them (`null` under "Hidden"); `damageType` and
`damageLabel` only where every roll of the section has the one type; and `flavor` the rolls'
bonus names joined with ", ", to 100 characters. Where Midi does show each apart, each roll's total
is as Midi draws it alone, a part below zero counted as 0. On every trimmed card, a damage roll's
`critical` is `true` only where the trimmed attack roll's is, as Midi marks no critical on damage.

In `content`, unless *GM Attack Roll Display* is "Full Roll", every `.dice-roll` in
`.midi-qol-attack-roll` and every `.midi-attribution-info` is removed; unless *GM Damage Roll
Display* is, every `.dice-roll` in `.midi-qol-damage-roll`, `.midi-qol-other-damage-roll` and
`.midi-qol-bonus-damage-roll`; and always the attack and damage buttons (`.midi-qol-attack-buttons`,
`.midi-qol-damage-buttons`, `.midi-qol-otherDamage-button`), which Midi hides from players who
didn't write the card, and whose damage button reads "Critical" on a critical. `text` is made from
it. What players see of the rolls is in `rolls`, never in `content`.

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
  "disposition": "friendly",
  "hp": { "value": 30, "max": 40, "temp": 0 }
}
```

`initiative` is `null` until rolled. `character` is the campaign character's actor id, or `null`.
Since module 0.40.0 a transformed actor stands for its character: a form's combatant carries its
`character`, and keeps it once the form is deleted, its `hp` then the character's, though Foundry
finds no actor for one with no token.
`hp` is present for the campaign's characters, and for every combatant when Gamemaster-only
information is on; it is `null` when the system does not model hit points the way dnd5e does. Its
`max` is the maximum dnd5e shows on the sheet and token bar, and heals up to: since module 0.17.0,
with any temporary change to it, such as Aid's or a wraith's Life Drain, which dnd5e keeps apart
from the maximum itself. Before, it left that change out, so a character at their lowered maximum
was sent as short of it.
`hidden` is present only when Gamemaster-only information is on.
Since module 0.36.0, to a listener that [reads companions](#companionslisted) only, `companion`
follows `character`: the key of the [companion](#companions) the combatant is, in the list the
campaign was last told (its token's `<scene>-<token>` for an unlinked token, its actor's id for a
linked one), or `null`; and a companion has `hp` as a character has. A fight with only a companion of
the campaign's in it, such as its familiar, reaches the campaign. To any other listener every
combatant and combat is as before: no `companion`, no companion's `hp`, no companion-only fight.
`disposition`, since module 0.29.0, is its token's, as players see its border: `"friendly"`,
`"neutral"` or `"hostile"`; `null` for a Secret one, which players see as none, for a token hidden
from players, for a combatant with no token, and for any other. The same whether or not
Gamemaster-only information is on: never Secret, nor the number Foundry keeps it as. Hostile may
be no more than Foundry's default, for a token whose disposition no one chose. A change is sent with the next combat event that
carries the combatant, such as `combat.turn`, or the next hello. Always there from 0.29.0; left out
before.

## Events

### `bridge.hello`

A campaign's full current state. Sent to each campaign first in every session, and again whenever
the destination, the campaigns or any event setting changes, and since module 0.26.0 when Manual
Dice is switched on or off while a campaign allows its players to enter their dice results.

| Field | Meaning |
| --- | --- |
| `module` | `{ id, version }` of this module. |
| `foundry` | `{ version, generation }`, such as `"14.365"` and `14`. |
| `system` | `{ id, title, version }` of the game system. |
| `bridge` | `{ userId, name }` of the Gamemaster whose browser is sending. |
| `config` | `{ chat, chatScope, combat, gmContent }`: which events are on, whether chat is `"all"` a campaign's players can read or only what its characters said (`"connected"`), and whether Gamemaster-only information is sent. |
| `features` | `{ rolls: { enabled, kinds, reason, modifiers, areaAttacks, prompts, activityChecks, signedDice, selfTargets, gmRolls, gmRollMessages, manualDice, midiPrompts, aloneChoices, companionPrompts, effectDice, keptRerolls } }`: whether the campaign's players' rolls in the app are made in the game, which `kinds` it makes (since module 0.16.0, `"formula"` among the checks, and `"hitDie"` once the self-test has checked that a hit die takes the player's die, and since module 0.20.0 `"hitDice"` with it, never without; with `"attack"`, `"use"` and `"damage"` when the Gamemaster lets the campaign's players attack and cast from the app too, and the game can make their attacks and spells, and since module 0.21.0 `"endEnchantment"` with them, never without; since module 0.29.0 `"endConcentration"` wherever players' rolls are made, and `"spend"` and `"inspiration"` wherever the Gamemaster lets them attack and cast, whether or not the game can make their attacks now, as while the attack self-test fails or **Run players' attacks through Midi** is off; since module 0.42.1 `"spellSlot"` right after them, wherever they are; since module 0.42.1 `"prepare"` right after them, wherever they are; and since module 0.17.0, for the [links in their descriptions](#descriptions-that-roll), under dnd5e 5 only, `"textRoll"`, `"ask"` where its roll request card can be made, and `"textDamage"` when the Gamemaster lets the campaign's players attack too, and the self-test has checked that damage takes their dice, even with **Run players' attacks through Midi** off), and if not, why not: `"off"` until the Gamemaster turns them on, `"system"` under a system other than D&D Fifth Edition, `"self-test"` when this Foundry or a module rolls dice differently than expected; and `modifiers`, whether players may change their damage in the app, with more dice, another die or every die at its highest, which the self-test checks: an attack's or use's, and since module 0.19.0 a description's, so wherever `"damage"` or `"textDamage"` is among the `kinds`; `areaAttacks`, whether an attack at an area is made at the targets the player picks, `true` wherever attacks are made, since module 0.16.0; `prompts`, whether its players are asked in the app for the [saves the game asks](#saves-the-game-asks-for) of their characters; and since module 0.21.0 `activityChecks`, whether a `skill`, `tool` or `ability` may name a check activity's `item` and `activity`, to [roll the character's own check](#descriptions-that-roll) for it, `true` wherever players' rolls are made under dnd5e 5, attacks or not; and since module 0.21.0 `signedDice`, `true` wherever players' rolls are made: more dice and another die change only a die damage adds, never one it takes away, and attack and use previews mark those [`subtracted`](#attacks). A listener needs it for a description's damage, which it plans itself; an attack's preview shows it by its marks. And since module 0.22.0 `selfTargets`, whether a `use` may be made at its user beside the combatants picked, [`self`](#spells-and-features), `true` wherever `"use"` is among the `kinds`. And since module 0.23.0 `gmRolls`, `true` wherever players' rolls are made: a roll may say it's the campaign's Gamemaster's, made in the app as the character, [`by`](#fetching-rolls) `"gm"`, which is then [marked as theirs](#making-a-roll). And since module 0.25.0 `gmRollMessages`, `true` wherever `gmRolls` is: such a roll's [`command.result`](#commandresult) lists the chat messages it made, `messages`. And since module 0.26.0 `manualDice`, whether the campaign's players may enter what their own dice show in the app: `true` only while players' rolls are made (`enabled`), the Gamemaster allows it and [Manual Dice](https://github.com/lambersond/fvtt-manual-dice) is on, else `false`. Since module 0.32.0 a player enters them where their character's [`manualDice`](#character) is also `true`, sending the roll [`typed`](#fetching-rolls); before it, nothing was entered. And since module 0.27.0 `midiPrompts`: `true` where `prompts` is and this Midi-QOL has what [asking its own saves](#midi-qols-own-saves) needs, else `false`; a listener needs nothing from it, as Midi prompts are sent only to one that says it reads them. And since module 0.41.0 `aloneChoices`, `true` exactly where `"itemDamage"` is among the `kinds`, else `false`: [damage on its own](#damage-on-its-own-and-recharges) may name a spell slot, an attack mode and ammunition and ask to spend what its use would, on a row whose [`tableDamage`](#what-an-item-rolls) carries `choices`, which it carries to a listener that answers `"aloneChoices": 1`. And since module 0.41.0 `companionPrompts`, after it, `true` exactly where `prompts` is, else `false`: the [saves the game asks](#saves-the-game-asks-for) of a listed [companion](#companions) are asked too, of a listener that answers `"companions": 2`. And since module 0.42.0 `effectDice`, after it, `true` under dnd5e 5 where `manualDice` is and the self-test has checked a typed roll's effect dice: a typed d20 roll's [`effectDice`](#fetching-rolls) are its player's; and `keptRerolls`, last, `true` where `manualDice` is and the self-test has checked a kept reroll: a typed roll's [`rerolls`](#fetching-rolls) `"kept"` is honoured. See [Rolls from the app](#rolls-from-the-app). Since module 0.31.0, beside `rolls`, never inside it, and under any system, `transfers`: `{ enabled, kinds, reason }`, whether the campaign's players may [move items and coins](#moving-items-and-coins) from the app: `{ enabled: false, kinds: [], reason: "off" }` until the Gamemaster turns **Players move items and coins** on; `reason` `"system"` with it on under a system other than D&D Fifth Edition; and with it on under dnd5e, `{ enabled: true, kinds: ["transfer"], reason: null }`. Since module 0.32.0 it ends with `partySends` and `distribute`, `true` both wherever `enabled` is and `false` otherwise: `partySends`, a party's items and coins may be [sent](#moving-items-and-coins) by a player whose character's users own it to any of the campaign's characters or another of its parties they own, and by the Gamemaster to any of them, party to party no longer refused; `distribute`, a `transfer` may share a party's coin among its characters, `among`. It reads neither the rolls, nor the self-test, nor whether the world has groups. Since module 0.33.0, beside them, under any system, `removals`: `{ enabled, kinds, reason }`, whether an item may be [removed](#removing-an-item) from a character from the app: `{ enabled: true, kinds: ["remove"], reason: null }` under dnd5e, otherwise `{ enabled: false, kinds: [], reason: "system" }`; there's no switch. Since module 0.34.0, beside them, `notes`: `{ enabled, kinds, reason, journals }`, whether [journal notes](#journal-notes) are kept here (always, under any system: `{ enabled: true, kinds: ["personal", "party"], reason: null }`), and `journals`, the campaign's characters and parties whose journal for this campaign exists in Foundry, as `{ kind, actorId }`, `kind` `"personal"` or `"party"`: `[]` where none has one. A book it doesn't list has no journal; one it lists follows the hello in a [`journal.updated`](#journalupdated). Since module 0.35.0 `notes` also says `orders: true`, that it takes the app's [`order`](#journal-notes) of a group's notes and keeps Foundry's order, and `changes: true`, that it says who deleted or reordered notes in Foundry, in `journal.updated`'s `journal.changed`, to a listener that answers `"notes": 2`. Since module 0.36.0, beside them, `companions`: `{ kinds, initiative }`, the kinds a [companion](#companions)'s command may be, as the campaign takes them now, `rolls`' `kinds` without `inspiration`, `hitDie`, `hitDice`, `spend`, `transfer`, `remove`, `note`, `endTurn` and `undoEndTurn`, and, since module 0.42.1, `spellSlot` and `prepare`, `[]` where rolls are off; and the campaign's companions' initiative, `"own"` or `"after"`, whether or not rolls are on. And `rolls`' `kinds` gain `"itemDamage"` and `"recharge"`, after the descriptions', where the Gamemaster lets players attack and the damage self-test has passed, Midi-QOL's integration on or off, under dnd5e 5 and 6: [damage on its own and recharges](#damage-on-its-own-and-recharges); `modifiers` is then `true` where the self-test allows it; and `"endTurn"`, right after `"endConcentration"`, [ending the current turn](#rolls-from-the-app), the character's or one of its companions', wherever the campaign's rolls are made, attacks or not, Midi-QOL or not; never among `features.companions.kinds`; and `"undoEndTurn"` right after it, taking back an `endTurn` the listener just sent; never among `features.companions.kinds`. Since module 0.37.0, after `companions`, `favorites`: `{ enabled, kinds, reason }`, whether a character's [favorites](#favorites) may be added and removed from the app: `{ enabled: true, kinds: ["favorite"], reason: null }` under dnd5e, otherwise `{ enabled: false, kinds: [], reason: "system" }`; there's no switch, and it reads neither the rolls nor the self-test. `"favorite"` is never among `rolls`' `kinds`, nor `features.companions.kinds`. Since module 0.38.0, after `favorites`, `dishes`: `{ enabled, kinds, reason, versions }`, whether the campaign takes [dishes from the Magical Recipe Book](#dishes-from-the-magical-recipe-book), by its own switch, **Dishes from the Magical Recipe Book**: `{ enabled: false, kinds: [], reason: "off", versions: [] }` until the Gamemaster turns it on; `reason` `"system"` with it on under any system but dnd5e 5, dnd5e 6 among them; and with it on under dnd5e 5, `{ enabled: true, kinds: ["dish"], reason: null, versions: [1] }`, `versions` the cookbook body versions it reads. It reads neither the rolls nor the self-test. `"dish"` is never among `rolls`' `kinds`, nor `features.companions.kinds`. Since module 0.39.0, after `dishes`, `effects`: `{ enabled, kinds, reason }`, whether the campaign's players may turn off, turn on and delete [their own effects](#a-players-own-effects) from the app, by its own switch, **Allow Players to disable & remove their own active effects**: `{ enabled: false, kinds: [], reason: "off" }` until the Gamemaster turns it on; `reason` `"system"` with it on under a system other than D&D Fifth Edition; and with it on under dnd5e 5 or 6, `{ enabled: true, kinds: ["effect"], reason: null }`. It reads neither the rolls nor the self-test. `"effect"` is never among `rolls`' `kinds`, nor `features.companions.kinds`. Since module 0.40.0, after `effects`, `wildShape`: `{ enabled, kinds, reason }`, whether the campaign's players may use [Wild Shape](#wild-shape) from the app, by its own switch, **Allow Players to use Wild Shape from the app**: `{ enabled: false, kinds: [], reason: "off" }` until the Gamemaster turns it on; `reason` `"system"` with it on under a system other than D&D Fifth Edition; and with it on under dnd5e 5 or 6, `{ enabled: true, kinds: ["wildShape"], reason: null }`. It reads neither the rolls nor the self-test. `"wildShape"` is never among `rolls`' `kinds`, nor `features.companions.kinds`. |
| `characters` | Every [character](#character) in the campaign: since module 0.22.0 without its `sheet`, which follows in `character.updated`; since module 0.26.0 each with `manualDice`, whether its player may enter its dice results in the app, as [Character](#character) says: always `false` before module 0.32.0. |
| `groups` | Since module 0.30.0, the campaign's [groups](#group), its parties, in the order the Gamemaster listed them, each without its sheet: `[]` where it has none, and under any system but D&D Fifth Edition. Actors that no longer exist, or aren't of dnd5e's Group type, are left out. Each group's sheet follows in [`group.updated`](#groupupdated) to a listener that reads groups. |
| `companions` | Since module 0.36.0, the campaign's characters' [companions](#companions), at most 50, each without its sheet, to every listener: `[]` where there are none. Each companion's sheet follows in [`companion.updated`](#companionupdated) to a listener that reads companions. Never a companion in `characters`. |
| `settings` | Since module 0.30.0, [what Foundry says of itself](#bridgesettings) for the campaign's Gamemaster: the modules Sending Stone works with and their versions, the campaign's switches and every campaign's, the dnd5e and Midi-QOL settings that decide what players see in chat, and what players see. |
| `sheetsApart` | `true` since module 0.22.0: the characters carry no sheets, and each follows once the hello is answered. Absent before, when each carried its sheet. |
| `combats` | Every [combat](#combat) the campaign's characters are in, when combat events are on; otherwise empty. |
| `prompts` | Every [prompt](#prompts) open for the campaign's players, read afresh from the chat log, and since module 0.27.0 every [Midi prompt](#midi-qols-own-saves) waiting on them: any the campaign was told of that isn't among them has closed. Empty while its players aren't asked for their saves. |

Since module 0.22.0 nothing comes before it, and once it's answered `2xx`, each character follows
in the order listed, each in a [`character.updated`](#characterupdated) of its own after the
[`character.texts`](#charactertexts) with the descriptions its sheet refers to that haven't gone
since the hello. Since module 0.30.0, to a listener that reads groups, each of the campaign's groups
follows its characters in a [`group.updated`](#groupupdated) of its own, in the order listed. Since
module 0.34.0, to a listener that reads notes, each book whose journal the hello's `features.notes`
lists follows the groups in a [`journal.updated`](#journalupdated) of its own. Since module 0.36.0, to a
listener that reads companions, each companion the hello lists that still is one follows them in a
[`companion.updated`](#companionupdated) of its own, in the order listed, and then, at once, a
[`companions.listed`](#companionslisted) where the list has changed since the hello was built. A
hello refused is followed by nothing: ask for another, as ever. Before 0.22.0 a hello came after the
`character.texts` with every description its characters' sheets refer to, and carried their sheets
itself.

### `character.updated`

`{ character }`: one of the campaign's [characters](#character), sheet included, as it now stands.
Sent when it changes between `bridge.hello`s, such as taking damage, levelling up, equipping armor
or gaining a condition: a change to the actor, its items or its effects. A burst of changes is
sent once it settles, and nothing is sent if the character is unchanged from what the campaign
was last told. Time passing in the game, or a new round or turn of combat, counts as a change for
a character with a temporary effect, whose time left is on its sheet. Since module 0.21.0, an
enchantment applied or ended from the app is sent at once, ahead of the
[`command.result`](#commandresult) that says so, so that a listener checking what the player asks
next against the sheet it was sent, as a switch turned straight back, has it as it now is.

Since module 0.22.0 it also follows every `bridge.hello` that's answered, once for each character,
whose sheets the hello no longer carries; and every character is sent again when what the listener
takes changes (see [Post size and slim sheets](#post-size-and-slim-sheets)). A change while a hello
is on its way is sent with the sheets after it. Its sheet is [slim](#slim-sheets), with `slim`,
where the listener says it expands it. A sheet whose post would come to more than the listener
takes is withheld, never cut short: `sheet` is `null`, with `sheetWithheld` saying so (see
[Character](#character)), and the Gamemaster is warned once; it goes once it fits. Answer it with
your `features`, as you answer a heartbeat: one that doesn't say `slimSheets` is sent full sheets
from then on.

Any description its sheet refers to that the campaign has not been sent since its last hello
comes first, in [`character.texts`](#charactertexts); none for a sheet withheld, whose descriptions
go with the sheet that fits.

### `character.texts`

`{ texts }`: [descriptions](#descriptions) that characters' sheets refer to, as an object of
HTML by hash. Sent before the `character.updated` whose sheet refers to them, or from modules
before 0.22.0 the `bridge.hello` whose sheets did: after a hello, every description each sheet
refers to, before the first that does; after that, each new one, once. Several may follow one
another when there is too much for one post: since module 0.22.0, up to 400,000 bytes of them each,
counted in bytes rather than characters. Keep them for the campaign: the same hash always names the
same description. A campaign's descriptions that none of its sheets refers to any more can be
dropped on its next hello: since 0.22.0, those none of the sheets you keep refers to.

`character.texts` is not part of the event stream, so its `sequence` is `null`. Since module
0.22.0 it comes after its session's `bridge.hello`; from a module before, it may arrive before it:
store it, and don't ask for a resend.

### `group.updated`

Since module 0.30.0, `{ group }`: one of the campaign's [groups](#group), sheet included, as it now
stands, to a listener whose latest answer to the campaign's hello or heartbeat said `"groups": 1`.
Part of the event stream. Sent after every answered hello, after its characters; to every group when
the listener starts to read groups in a heartbeat's answer, and when what it takes of sheets
changes; and when a group may have changed: the group itself or its items, as an item made, changed,
deleted or moved into a container; a member renamed or given a new portrait, or deleted; a campaign
character's ownership, or its deletion, which changes who may see every group of its campaign; and
the world's primary party. Nothing is sent where the group is as the campaign was last told, so a
member's hit points changing sends nothing. A burst of changes is sent once it settles, and a change
while a hello is on its way goes after it. Any description its sheet refers to that the campaign
hasn't had since its hello comes first, in `character.texts`. Answer it with your `features`, as you
answer a `character.updated`.

### `group.removed`

Since module 0.30.0, `{ id }`: one of the campaign's groups was deleted. Part of the event stream,
and sent only to a listener that reads groups. One deleted while the campaign's hello is on its way,
which was built as it was queued and so lists it, is removed once that hello is answered, after it,
where the answer says the listener reads groups. A group the Gamemaster takes out of the campaign
sends a fresh `bridge.hello` instead, which no longer lists it: drop any group a hello doesn't list.
You may be told of the removal of one you don't have: ignore it.

### `companions.listed`

Since module 0.36.0, `{ companions }`: the campaign's characters' [companions](#companions), the whole
list, as the hello's `companions`. Part of the event stream, and sent only to a listener whose latest
answer said `"companions": 1` or more: whenever the list differs from the last it was told, as a
familiar is summoned onto the active scene, a token is hidden or deleted, the active scene changes,
or a player is given or loses Owner of an NPC, 250 ms after the change was heard. A delivered hello's
list counts as told. Replace the list, and drop the sheets of companions no longer in it. One lost to
failures that might not last is sent again, and so are the sheets of the companions it listed, after
the list the listener next takes: those posted after the lost one named companions it didn't list.

### `companion.updated`

Since module 0.36.0, `{ companion, sheet }`: one [companion](#companions)'s entry, as listed, and its
[sheet](#character-sheet), built as a character's from its live actor, beside it, never inside it.
Part of the event stream, and sent only to a listener whose latest answer said `"companions": 1` or
more, only for a companion in the list it was last told: after each hello, and whenever its sheet
changes, as it takes damage or spends a use, or a token's creature's world actor changes, as the
Gamemaster edits a familiar's template, 250 ms after the last change. It follows the
[`character.texts`](#charactertexts) its sheet's descriptions need, slim where the listener reads slim
sheets; one too large goes with `sheet` `null` and its entry's `sheetWithheld` saying so, the
Gamemaster warned once. Its answer's terms count as a character's update's. Two tokens of one actor
are two companions, each sent apart.

### `journal.updated`

Since module 0.34.0, a character's or a party's [journal of notes](#journal-notes), whole, as
Foundry holds it, for one campaign. Part of the event stream. Sent only to a listener whose latest
answer to the campaign's hello or heartbeat said `"notes": 1`, as an integer of 1 or more; `changed`
only where it said 2 or more. Never to one that didn't, and none while the campaign's hello is on
its way, which every book follows.

```
{
  kind: "personal"|"party",
  actorId: <the character's or the group's id>,
  journal: { id: <JournalEntry id>, name: <string, at most 200>, notes: Note[],
             changed?: { what: "delete"|"order", by: <name, at most 200>, at: <ms> } } | null,
  withheld?: { reason: "private" } | { reason: "tooLarge", bytes: <int>, limit: <int> }
}
Note = {
  id: <the page's id, 16 letters and digits>, role: "chapter"|"entry", chapter: <a chapter page's id>|null,
  title: <1-200 characters>,
  format: 1|2, markdown?: <string> (format 2), html?: <string> (format 1),
  cut?: true, secret?: true,
  createdAt: <ms>, modifiedAt: <ms>, modifiedBy: <name>, modifiedIn: "app"|"foundry",
  author: { actorId: <id>|null, gm: <boolean>, name: <string> } | null,
  rev: <14 hex>
}
```

| Field | Meaning |
| --- | --- |
| `kind`, `actorId` | The book: a character's own notes in this campaign, by the character's id, or a party's, by the group's. |
| `journal` | `null` with no `withheld`: the book has no journal in Foundry, never made or deleted there; drop the notes you hold of it. Otherwise its `id`, its `name` as it's called in Foundry now, cut to 200 characters, and its `notes` in Foundry's page order, at most 400: the notes that share a `chapter`, `null` for none, are in that group's order, and the chapters in theirs. |
| `changed` | Since module 0.35.0, only to a listener that answered `"notes": 2` or more: the last time someone deleted a page the app is sent, or wrote the `sort` of an entry page the app is sent, in Foundry, other than the module's own writes. `what` `"delete"` or `"order"`; `by` the user, named as `modifiedBy` names them (`"Gamemaster"`, a player by the one character of the campaign's they own, else by their own name, and `"Someone in Foundry"` for a user that's gone), cut to 200 characters; and `at` Foundry's server time of it, whole milliseconds. Left out, never `null`, where the journal has recorded none. See [Journal notes](#journal-notes). |
| `withheld` | The book isn't told now, and `journal` is `null`: keep what you hold. `"private"`: a party none of the campaign's characters may see in Foundry, as its [`group.updated`](#groupupdated) withholds its sheet. `"tooLarge"`: more than 400 notes, or a post larger than the listener takes, `bytes` the post's size and `limit` the most it takes; the Gamemaster is warned once a page load. |
| `id` | The page's id. For a note made from the app it's the id the app chose (`keepId`); a page added in Foundry has Foundry's. A duplicated page has a new one: it's a note of its own. |
| `role`, `chapter` | A chapter, or an entry under one: by the module's flag where the page's flags count, otherwise a page whose title is a level 1 heading is a chapter and any other an entry, in the nearest chapter before it. An entry in a chapter that isn't sent, as one only the Gamemaster sees, is in the nearest chapter before it that is, as players see it in Foundry. `chapter` is `null` for a chapter, for an entry in none, and for one whose chapter isn't in the journal, as one made before its chapter reached Foundry. |
| `title` | The page's name, cut to 200 characters (`cut`). |
| `format`, `markdown`, `html` | `2` with its `markdown` for a page kept in Markdown; `1` with its `html` for one edited in Foundry's rich-text editor. A secret goes only where its readers could read it in Foundry, which shows a page's secrets to its Owners alone: never in a party's journal, and in a character's only where every one of the character's player owners is an Owner of the page. Where it doesn't go, an HTML page's `section.secret` is removed; and a page changed in Foundry whose HTML holds one, or a chapter whose text does (the app never writes a chapter's text), goes as `1`, `secret: true`, with that HTML without the secret, never as its Markdown. Over 100,000 characters, cut there (`cut`). |
| `createdAt` | When it was first written: in the app, where it was written there, even if it reached Foundry later; else Foundry's `_stats.createdTime`, else its `modifiedTime`, else `0`. Whole milliseconds. |
| `modifiedAt`, `modifiedBy`, `modifiedIn` | Who changed it last and when: `"app"` where Foundry holds what the module last wrote, with the app's time and its writer's name; `"foundry"` where it was changed in Foundry since, or written there, with `_stats.modifiedTime` and its last user, or, where the module has since written only its place or who owns it, which Foundry counts as the Gamemaster's change, the change made in Foundry before that, as the module kept it: `"Gamemaster"` for a Gamemaster, a player by the one character of the campaign's they own, where they own just one, else by their own name, and `"Someone in Foundry"` for a user that's gone. The module's own sorts, flags and ownership never count as a change. |
| `author` | Who wrote it from the app, `{ actorId, gm, name }`, the Gamemaster's `actorId` `null` and `gm` `true`; `null` for one written in Foundry. Names are read as each book is, so a character renamed shows its new name. |
| `rev` | The page's revision: a hash of its title and, for an entry, its format and text, which changes with every change made in Foundry and never with the module's own sorts, flags or ownership. Send it back as a change's `base`. |

**When.** After each answered hello, after its groups, one for each book whose journal it lists;
when the listener first says `"notes": 1` in a heartbeat's answer, or since module 0.35.0 a higher
format than it said before, every book afresh; 500 ms after the last change the bridge hears of to a
journal or its pages, its ownership included, as a page made, changed or deleted in Foundry, or the
journal deleted; when a character's or a party's ownership changes, its books and every party book
of its campaigns, whose privacy may have changed; when what the listener takes of sheets changes;
and before the result of every [note command](#journal-notes), a refusal's included, so the book
always comes before the result that follows it. A book is sent only where it's the campaign's own, a
personal book while the campaign's characters include the actor, a party book while its groups do
and its listener reads groups; and never twice the same, until the campaign's next hello. One lost
to failures that might not last sends the hello again 30 seconds later, which every book follows.

**What's never sent.** A page that isn't text, as an image; a page shown to fewer of the journal's
players than the journal is, or to the Gamemaster alone; a secret its readers couldn't read in
Foundry, a party page's or chapter's, or one on a character's page its player owners don't all own;
a page with no title. Every note is as the app's schema takes it, so one odd page, as a hand-edited flag or a null
`createdTime`, reads as written in Foundry rather than failing the event.

### `dish.applied`

Since module 0.38.0, who a Gamemaster served a [dish from the Magical Recipe
Book](#dishes-from-the-magical-recipe-book) to: everyone served it so far, built from its card. Part
of the event stream, sent by the bridge alone, and only to a listener whose latest answer to the
campaign's hello or heartbeat said `"dishes": 1`: each time the card's choice is written, as a
Gamemaster serves it, or serves it to others.

| Field | Meaning |
| --- | --- |
| `dish` | The listener's own id of the dish: the command's `id` without its `dish-`. |
| `id` | The cookbook's id of the dish, its body's `dish.id`. |
| `card` | The card's chat message id. |
| `outcome` | `"boon"`, `"bane"` or `"standard"`. |
| `characters` | Everyone served it so far, at most 200, each `{ actorId, name, effectId, replaced, healed, exhaustion, skipped }`: the effect made, `null` for a standard dish; the dish effect it replaced, `{ id, recipe }`, the cookbook's id and recipe, or `null`; the hit points it healed and the levels of exhaustion it added, once, when served; and each change not applied, `{ type, reason }`, `reason` `"unknown"` (a kind the module doesn't map), `"invalid"` (a kind it maps, failing its check) or `"immune"` (exhaustion, for a character immune to it), at most 100. |
| `rolled` | Each change that carried a formula, with the whole-number value the cookbook rolled once for everyone: `{ type, value, formula }`, `formula` cut to 32 characters, at most 100. |
| `by` | `{ userId, name }` of the Gamemaster who decided last. |
| `at` | `{ time, worldTime }`: when they decided, an ISO time, and the world time then. |

Every string is cut to 200 characters. Where a Gamemaster's write of the card left out a campaign
character holding the dish's effect, as two Gamemasters serving it at once may, the bridge adds them
back first, from the effect's flags, in one write of its own, and sends after that.

### `dish.dismissed`

Since module 0.38.0, a [dish](#dishes-from-the-magical-recipe-book) set aside, nobody having eaten
it, or its card deleted while it waited. To such a listener alone, as `dish.applied` is, cut as it
is.

| Field | Meaning |
| --- | --- |
| `dish`, `id`, `card` | As `dish.applied`'s. |
| `reason` | `"dismissed"`: set aside, from its card. `"deleted"`: its card deleted while it waited, each card its own `dish.dismissed` when the chat log is cleared. A decided card's deletion sends nothing. |
| `by` | `{ userId, name }` of who set it aside or deleted it; `null` for a deletion where no user is named. |
| `at` | As `dish.applied`'s. |

Both are sent again after a temporary drop, 30 seconds later; and after every hello, and where the
listener starts to say `"dishes"` in a heartbeat's answer, for 30 days, the newest 50, a deleted
card's from a tombstone, whether or not an earlier send was refused. A refusal of one is recorded
and comes back after every hello, so a listener refuses one only for a `dish` it can't read. A
deleted card's tombstone is kept in a world setting, `dishTombstones`: its ids, the Gamemaster's
name and the time, never the dish, as every user can read a world setting. So a reload, or the next
session, settles any decision the listener missed, a deletion included, for 30 days. A decided
card's deletion sends nothing, but the bridge keeps its decision, as the card last said it, for the
rest of the session, so a send of it dropped meanwhile still goes again 30 seconds later; and a
tombstone of its choice, its ids, its `state`, the Gamemaster's name and the time, so the same dish
handed over again is answered from it, posting nothing. That one decision, a card deleted once
decided while its event waited to go again, is the one a reload before it went doesn't settle.

### `bridge.settings`

Since module 0.30.0, `{ settings }`: what Foundry says of itself for the campaign, for its
Gamemaster, as in the hello's `settings`. Part of the event stream, sent only to a listener whose
latest answer to the campaign's hello or heartbeat said `"settings": 1`: once when it starts to say
so in a heartbeat's answer, and after a change to one of the settings it says that tells nothing
else afresh, dnd5e's *Attack Result Visibility* and *Challenge Visibility*, Midi-QOL's settings,
its *GM Sees all whispered messages* and *Replace dnd5e activities with midi-qol equivalents*,
**Allow targets off your screen**, and since module 0.31.0 **Hit/miss and save results in the
app**, or to the name of a group the campaign lists, or its deletion,
since its groups are among what it says, once a burst of changes settles, and only where what it
says differs from what the campaign was last told. A change while the campaign's hello is on its
way, which says them as they were when it was queued, follows that hello once it's answered. Every
other setting it says sends a hello. A listener need not count it as a change players see.

`settings` is format 1, an allowlist, never a whole settings object: it never holds a secret, the
app's address or any token, nor the Gamemaster's user, nor a free-text error.

```json
{
  "format": 1,
  "modules": [{ "id": "midi-qol", "title": "Midi QOL", "version": "14.1.2", "active": true }],
  "sections": [
    { "id": "campaign", "title": "This campaign", "rows": [
      { "id": "rolls", "label": "Players roll in the app", "value": true, "text": "On", "note": "Foundry, or a module, rolls dice differently than expected. The browser console says why." }
    ] },
    { "id": "dnd5e", "title": "D&D Fifth Edition", "rows": [
      { "id": "challengeVisibility", "label": "Challenge Visibility", "value": "player", "text": "Show only from other players" }
    ] }
  ],
  "results": [
    { "id": "saves", "state": "partial", "text": "Saves: shown on players' cards and rolls, hidden otherwise (Challenge Visibility: Show only from other players)" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `format` | `1`. |
| `modules` | The modules Sending Stone works with that are installed, in this order: `midi-qol`, `lib-wrapper`, `manual-dice`, `combat-focus`; each `{ id, title, version, active }`, `version` `null` where it has none. Sending Stone's own is the hello's `module`. |
| `sections` | In this order: `campaign`, "This campaign", always, with `rolls`, `attacks`, `prompts`, `manualDice`, since module 0.31.0 `transfers` ("Players move items and coins", On or Off, its `note` saying it needs D&D Fifth Edition where it's on under another system), since module 0.38.0 `dishes` ("Dishes from the Magical Recipe Book", its `note` where it's on under any system but dnd5e 5), since module 0.39.0 `effects` ("Allow Players to disable & remove their own active effects", On or Off, its `note` saying it needs D&D Fifth Edition where it's on under another system), since module 0.36.0 `companionInitiative` ("Companions' initiative", `value` `"own"` or `"after"`, `text` "Its own roll" or "Right after its character"), and `groups`; `sending-stone`, "Sending Stone, for every campaign", always, with `chatEvents`, `chatScope`, since module 0.31.0 `chatResults` ("Hit/miss and save results in the app", `value` `"foundry"` or `"always"`, `text` "Follow Foundry's visibility settings" or "Always show them to players"), `combatEvents`, `gmContent`, and while Midi-QOL is active `midiIntegration` and `offCanvasTargets`; `dnd5e`, titled as the system is, under D&D Fifth Edition, with `attackRollVisibility` and `challengeVisibility`, and under dnd5e 6 `chatCardSummary`, as the Gamemaster's browser has it; and `midi-qol`, "Midi-QOL", while it's active, with `autoCheckHit`, `autoCheckSaves`, `gmAttackDisplay`, `gmDamageDisplay`, `highlightSuccess`, `highLightCriticalAttackOnly`, `playerRollSaves`, `rollNPCSaves`, `rollNPCLinkedSaves`, `rollSavesBlind`, `rollChecksBlind`, `rollSkillsBlind`, `blindRollDisplay`, `showGM`, `ReplaceDefaultActivities`, and as the Gamemaster's browser has them `ForceHideRoll` and `EnableWorkflow`. Each row is `{ id, label, value, text, note? }`: `label` in the Gamemaster's Foundry language, dnd5e's and Midi-QOL's in their own words; `value` as stored, a boolean, a string up to 100 characters, a number (a list of ids is how many it names, `"all"` as it is) or `null`; `text` the value in words, "—" where there's none; and `note`, where a switch that's on can't do what it says in this game, why. |
| `results` | What players see in chat, by the same rules as each message is told by: up to six lines, `{ id, state, text }`, `state` `"shown"`, `"partial"` or `"hidden"`. With GM-only details on, every line is shown, "(GM-only details: On)"; since module 0.31.0, with it off and **Hit/miss and save results in the app** Always, every line but `gmRolls` is shown, "(Hit/miss and save results in the app: Always show them to players)", except `midiSaves` under Midi-QOL's *Auto check Saves* "Off", hidden, as Midi records no saves on its card then; `gmRolls` still says what Midi trims. `id` is one of `hits` (dnd5e's own attacks), `midiHits`, `saves`, `checks`, `midiSaves` and `gmRolls` (a Gamemaster's rolls on Midi-QOL's cards), the Midi ones while it's active; or alone, `chat`, with chat messages off, or `system`, under another system. Read `id` as any string. |

### `bridge.heartbeat`

`{}`. The bridge is still connected. Sent to a campaign that has been sent no other event for 30
seconds, so while a Gamemaster has the game open, each campaign hears something at least every
30 to 40 seconds. Browsers slow the timers of a background tab, to as little as once a minute, so
allow for that before deciding the Gamemaster has gone: two minutes without any event is a safe
sign.

### `bridge.ping`

`{ userId, name }` of the Gamemaster testing a campaign's connection. Sent by a campaign's
**Test** button in the settings window, with the address, title and secret as typed, which may not
have been saved, and from a browser that may not be the one sending events. It names the campaign
tested: answer `2xx` if the secret is that campaign's, `404` if no campaign with its title is set
up, and `401` for the wrong secret, or none: since module 0.23.0, **Test** says what the
[refusal's](#transport) `reason` (`notSetUp`, `wrongSecret`, `noSecret`, or any other) means, and
what to do. Store nothing. Modules before 0.4.0 sent it with
`campaign: null`, testing the one secret they had.

### `command.result`

What became of a player's roll, attack or use fetched from the listener; see
[Rolls from the app](#rolls-from-the-app), [Attacks](#attacks) and [Spells and features](#spells-and-features). Not part of the event stream, so its `sequence` is
`null`. It follows the chat events of the message the roll made.

| Field | Meaning |
| --- | --- |
| `id` | The roll's `id`, as fetched. |
| `status` | `"done"`, or `"failed"` when it wasn't made. |
| `reason` | Why it failed: `"off"` (the campaign doesn't take players' rolls now), since module 0.36.0 `"legendary"` (a legendary or mythic action with too few of the creature's legendary actions left, as dnd5e would refuse it), `"follows"` (a companion's own initiative, where it acts right after its character, who is in that combat) and, for a recharge, `"charged"` (its uses aren't spent); `"invalid"` (not a roll the module makes; `error` says what), `"unknown"` (no such character in the campaign, or no such skill, tool or ability), `"not-dying"`, `"not-in-combat"` (the character isn't in the combat the Gamemaster has up), `"already-rolled"` (it has initiative), `"busy"`, `"cancelled"` (a module called the roll off), `"timeout"` (not made within a minute, as when a module asks the Gamemaster something first) or `"error"`. For a hit die, also `"no-hit-dice"` and `"self-test"`, and for it or a formula, `"dice"`; for hit dice spent at once (module 0.20.0), those and `"full-hp"` (the character is at full hit points); for a formula, also `"item"` and `"activity"`; see [Hit dice and formulas](#hit-dice-and-formulas). For an attack, a use or their damage, also: `"attacks-off"`, `"midi-off"`, `"self-test"`, `"item"`, `"activity"`, `"area"`, `"slot"`, `"ammo"`, `"mode"`, `"target"`, `"scene"`, `"consume"`, `"active-defence"`, `"reaction"`, `"bonus-action"`, `"midi-dialog"`, `"midi"`, `"no-attack"`, `"gone"`, `"not-waiting"`, `"type"` and `"damaged"`; see [Attacks](#attacks) and [Spells and features](#spells-and-features). Since module 0.21.0, for an enchant activity's use, also `"profile"`, `"enchant-target"`, `"applied"` and `"enchant"`, and for ending an enchantment, `"enchantment"`, besides those of a use; see [Enchantments](#enchantments). For a save answering a prompt, also `"prompt"`; see [Saves the game asks for](#saves-the-game-asks-for). Since module 0.29.0, for ending a concentration, also `"concentration"` and `"cancelled"`; for spending charges, `"attacks-off"`, `"item"`, `"uses"` and `"short"`; and for Heroic Inspiration, `"attacks-off"`, `"not-inspired"` and `"inspired"`; see [Concentration, charges and Heroic Inspiration](#concentration-charges-and-heroic-inspiration). Since module 0.42.1, for a spell slot spent or restored, `"attacks-off"`, `"shaped"` (the character is transformed), `"slot"` (no such pool with slots), `"changed"` (its count isn't the one the app showed), `"slots"` (none left to spend) and `"full"` (none used to restore); see [Concentration, charges and Heroic Inspiration](#concentration-charges-and-heroic-inspiration). Since module 0.42.1, for a spell prepared or unprepared, `"attacks-off"`, `"shaped"`, `"gone"` (no such spell on the character), `"prepare"` (not one the character prepares: a cantrip, one always prepared, one whose method doesn't prepare, or one an item casts) and `"cancelled"`; see [Preparing spells](#preparing-spells). For an ask, a description's roll, damage or healing, or a save or check rolled for a description, also `"gone"`, `"link"`, `"busy"`, `"secret"`, `"type"`, `"dice"`, `"attacks-off"` and `"self-test"`; see [Descriptions that roll](#descriptions-that-roll). Since module 0.31.0, for a move of items and coins, `"off"`, `"transfers-off"`, `"invalid"`, `"unknown"`, `"not-yours"`, `"not-owner"`, `"gone"`, `"short"`, `"container"`, `"nested"`, `"deep"`, `"error"` and `"timeout"`, and since module 0.32.0 `"members"` and `"split"`, for a party's coin shared among its characters; see [Moving items and coins](#moving-items-and-coins). Since module 0.33.0, for an item removed, `"off"`, `"invalid"`, `"unknown"`, `"gone"`, `"short"`, `"changed"` (the stack isn't as many as the app's sheet showed now), `"error"` and `"timeout"`; see [Removing an item](#removing-an-item). Since module 0.34.0, for a note command, `"off"`, `"invalid"`, `"unknown"`, `"private"`, `"not-member"`, `"not-yours"`, `"foundry-only"`, `"headings"`, `"full"`, `"error"` and `"timeout"`, and `"changed"` and `"gone"` where it was changed or deleted in Foundry since; see [Journal notes](#journal-notes). Since module 0.35.0, for an order, `"off"`, `"invalid"`, `"unknown"`, `"private"`, `"not-member"`, `"gone"`, `"changed"`, `"error"` and `"timeout"`. Since module 0.36.0, for ending a turn, `"off"`, `"invalid"`, `"unknown"`, `"not-in-combat"` (combat events are off, or there's no such combat the campaign is told of), `"not-started"` (the combat hasn't started), `"moved"` (its round or current combatant isn't the one named, or the current one is hidden: the turn has moved on, as when the Gamemaster, or an earlier command, ended it already), `"not-turn"` (the current combatant is neither the character nor one of its companions now), `"cancelled"` (the turn didn't move: a module stopped it), `"error"` and `"timeout"`; and for taking a turn back, those and `"not-undoable"` (that `endTurn` isn't one this Foundry remembers making for the character, as one taken back already, a later one of the combat, one older than a minute or one made before Foundry reloaded, or the combatant whose turn it ended has left the combat or is hidden); see [Rolls from the app](#rolls-from-the-app). Since module 0.37.0, for a favorite added or removed, `"off"`, `"invalid"`, `"unknown"`, `"gone"`, `"error"` and `"timeout"`; see [Favorites](#favorites). Since module 0.38.0, for a dish, `"off"`, `"invalid"`, `"error"` or `"timeout"`, never `"unknown"`; see [Dishes from the Magical Recipe Book](#dishes-from-the-magical-recipe-book). Since module 0.39.0, for an effect, `"off"`, `"invalid"`, `"unknown"`, `"gone"`, `"effect"` (there, but its player may not do that to it now), `"cancelled"` (Foundry, or a module's hook, stopped the write), `"error"` or `"timeout"`; see [A player's own effects](#a-players-own-effects). Since module 0.40.0, for Wild Shape, `"off"`, `"invalid"`, `"unknown"`, `"gone"`, `"form"` (not a form usable now), `"full"` (every place for a known form taken), `"swap"` (no replacement since the last Long Rest), `"consume"` (no use left), `"incapacitated"`, `"transformed"` (another kind of transformation, which ends in Foundry), `"shaped"` (a replacement of the form the character is in), `"cancelled"`, `"error"` or `"timeout"`; and `"shaped"` for a favorite, effect, move or removal while its character, for a move either end, is transformed; see [Wild Shape](#wild-shape). Since module 0.41.0, for damage on its own, also `"slot"` (a spell slot not offered for it), `"mode"` (an attack mode not its weapon's, or named for no attack), `"ammo"` (ammunition its weapon doesn't fire, or none left of it to spend), `"consume"` (nothing left to spend: dnd5e's own message in `error`, or a thrown weapon with none in hand), `"bonus-action"` and `"reaction"` (Midi-QOL's used, where it enforces them, in a fight); and for Wild Shape, `"bonus-action"` (Midi-QOL's Bonus Action used in a fight, where it enforces them); see [Damage on its own and recharges](#damage-on-its-own-and-recharges). `null` when done. |
| `error` | What went wrong, for `"invalid"` and `"error"`, what dnd5e said for `"consume"`, and why for `"prompt"`; otherwise `null`. |
| `messageId` | The chat message the roll made; for hit dice, the last of their cards. Since module 0.21.0, an enchant activity's use that failed once used, `"enchant"` or `"midi"`, has its card's while the card is there, with `visible`, for the Gamemaster to apply it from; one with no card, as a module stopped dnd5e posting it or Midi-QOL deleted it, or with a card no one can apply it from, as one naming a concentration that has since ended, has `null`, with `visible` `true`, and so does the end of an enchantment, and since module 0.29.0 the end of a concentration, and since module 0.37.0 a favorite added or removed, and since module 0.39.0 an effect turned off, on or deleted. Charges spent and Heroic Inspiration have the line they posted, and `null`, with `visible` `true`, where it couldn't be posted. Since module 0.27.0, an answer to a [Midi prompt](#midi-qols-own-saves) has `null` where Midi makes no message for the roll, as when the Gamemaster's browser rolls it and Midi doesn't show saves, with `visible` `true`: its dice are the player's own. |
| `visible` | May the roll's player see that message? `false` for a roll made blind, as Midi-QOL can make a player's check; for hit dice, `false` unless they may see every card. |
| `rolls` | The [rolls](#chat-message) as made, Foundry's total and every die, when `visible`; otherwise empty. For hit dice, every roll of every card, in order. A roll's `total` is Foundry's: damage that takes dice away may come below 0, where dnd5e's card shows each kind of damage at least 0. Since module 0.28.0 each has the marks a chat message's roll has, `damage`, `damageLabel`, `section`, `flavor` and `attack`, where they apply: a player's damage through Midi-QOL has `section` `"damage"`. |
| `healed` | For a hit die or hit dice: the hit points gained; see [Hit dice and formulas](#hit-dice-and-formulas). |
| `spent` | For hit dice (module 0.20.0), once past the checks made before any is spent: `{ count, made }`, how many were asked for, and how many were rolled, a card each. Hit dice that stopped part way, with `made` below `count`, are `"failed"` with the reason they stopped, and still carry `messageId`, `visible`, `rolls` and `healed` for those made, where any were; see [Hit dice and formulas](#hit-dice-and-formulas). Left out otherwise. |
| `attack` | For an attack: `{ critical, fumble, outcome }`, and for an area attack `targets`, when `visible`; see [Attacks](#attacks). |
| `use` | For a use: `{ type }`, the kind of activity used; see [Spells and features](#spells-and-features). |
| `damage` | For an attack or a use: the dice its damage or healing will throw, or `null`; see [Attacks](#attacks). |
| `enchantment` | For an enchant activity's use and the end of an enchantment (module 0.21.0): `{ enchanted, ended }`, the enchantment applied and the one ended, each or both `null`; `null` for a use that failed once made. See [Enchantments](#enchantments). |
| `messages` | For a roll the campaign's Gamemaster made in the app, `by` `"gm"` (module 0.25.0): the `id`s of the chat messages it made, in the order made, at most 20. They're the messages it flagged `by` `"gm"` and sent with [`gmRoll`](#chat-message), dnd5e 5.3's message of a death save's outcome among them, and only those the Gamemaster's client made or marked for it while it was made, never one a player's browser made or marked with its flags copied. A module that creates chat messages on the Gamemaster's browser for players, as Midi-QOL's `createChatMessage` socket does, could still have a copy listed while the roll is being made. Empty when it made none, as when it failed first; on a result after a `"timeout"`, every one made by then. Left out for a player's roll, and by modules before 0.25.0. |
| `transfer` | For a move of items and coins (module 0.31.0) that moved anything: `{ from, to, items, currency }`, its ends' actor ids, each item moved `{ id, quantity, created, stacked }`, in the command's order, and the coins moved, `{ <key>: <count> }`, or `null` for none; on `"done"`, and on `"error"` after some moved, listing only those. Never a name, nor what a container held. Since module 0.32.0, for a party's coin shared among its characters, `{ from, to: null, items: [], currency, among }`: `currency` the coins given out, `{ <key>: <share × those given one> }`, and `among` the characters given their share, in order, every one of them when done; on `"error"` only where any was given one. Left out on any other failure. See [Moving items and coins](#moving-items-and-coins). |
| `removed` | For an item removed (module 0.33.0): `{ item, quantity }`, the item's id and how many of it were removed; on `"done"`, and on `"error"` where the item itself was lowered or deleted. Never a name, nor what a container held. See [Removing an item](#removing-an-item). |
| `favorited` | For a favorite added or removed (module 0.37.0): whether it's one of the character's favorites now, on `"done"`. See [Favorites](#favorites). |
| `dish` | For a dish (module 0.38.0): `{ card, state }`, on `"done"`: its card's id, the `messageId` too, and `"waiting"`; or, for a dish handed over again whose card was decided, `"applied"` or `"dismissed"`, for one whose card was deleted undecided, `"dismissed"`, and for one whose card was deleted once decided, its choice. Since module 0.39.0 `visible` is `true` where the cook's character's player is among the card's readers; before, it was `false`, as no player saw the card. See [Dishes from the Magical Recipe Book](#dishes-from-the-magical-recipe-book). |
| `effect` | For an effect turned off, on or deleted (module 0.39.0): `{ id, disabled, deleted }`, on `"done"`: the effect's id as the sheet names it, whether it's turned off now, `null` once deleted, and `deleted`, `true` for a delete, one already gone among them. See [A player's own effects](#a-players-own-effects). |
| `wildShape` | For Wild Shape (module 0.40.0), on `"done"`: for `"transform"` `{ op, form: { id, name, uuid }, temp, hours }`, the sheet sent first; for `"revert"` `{ op, form: { name } }`, the sheet sent first, or `{ op, form: null }` where the character wasn't shaped; for `"learn"` `{ op, form: { id, name, uuid }, replaced: { id, name } \| null }`, the sheet sent first where it wrote; for `"forms"` `{ op, forms, more, limits }`, the Beasts the character may learn now, each `{ uuid, name, img, size, cr, ac, speeds, known }`, by Challenge Rating then name, at most 200, `more` `true` where there were more, and `limits` `{ count, cr, fly }`, as the sheet's `wildShape.limits`. See [Wild Shape](#wild-shape). |
| `alone` | For damage on its own that asked to spend what it uses (module 0.41.0), on `"done"`: `{ spent, concentrating? }`, what was spent once it was rolled, as dnd5e recorded it, in this order, of `"slot"`, `"uses"`, `"ammunition"` and `"thrown"`, `[]` where nothing was; and `concentrating: true` where concentration on it began. Left out otherwise. See [Damage on its own and recharges](#damage-on-its-own-and-recharges). |
| `note` | For a note command (module 0.34.0): `{ id, rev, deleted? }`, the note's id, its page's revision now, and `deleted: true` for a delete. `rev` is `null` for a delete. On a refusal, `{ id, rev }`, the page's revision as Foundry holds it, or `null` where there's none, or it isn't sent, as one only the Gamemaster sees. Never its text. See [Journal notes](#journal-notes). |
| `order` | For an order of a group's notes (module 0.35.0): `{ chapter, ids }`, the group's order in Foundry after it, as the book sent before lists it; on a refusal once the group is found, `"changed"` or `"error"`, its order then, and left out on any other. Never a title. No `note`. See [Journal notes](#journal-notes). |
| `outcome` | For a save answering a prompt: for a [`recharge`](#damage-on-its-own-and-recharges) (module 0.36.0), `"success"` or `"failure"`, whether it recharged, where `visible`; `"success"` or `"failure"`, where its player may see whether they saved, as the card would show them, or since module 0.31.0 always, with **Hit/miss and save results in the app** Always, the DC still never sent; since module 0.27.0, for an answer to a [Midi prompt](#midi-qols-own-saves), Midi's own verdict, where its DC was sent and Midi shows players whether they saved, or since module 0.31.0, with that setting Always, wherever Midi checks saves at all, its *Auto check Saves* not "Off"; since module 0.17.0, for a save rolled for a [description's link](#descriptions-that-roll), and since 0.18.0 a check, whether it met the DC it was rolled against, as its card shows the player, when `visible`; otherwise `null`. |

A roll made after the module reported its `"timeout"`, as once the Gamemaster has answered what a
module asked them, is reported again when it's made, `"done"`; for hit dice, also when some were
made before they stopped (`spent.made` above `0`), `"failed"` with the reason they stopped, as a
rule `"timeout"`.

### Chat

Sent only while **Chat messages** is ticked.

| Type | Payload |
| --- | --- |
| `chat.message.created` | `{ message }` |
| `chat.message.updated` | `{ changes, message }`: the names of the fields that changed, and the [message](#chat-message) as it now stands. An upsert. |
| `chat.message.deleted` | `{ id }`. Also sent when a message is made private after it was sent. |
| `chat.cleared` | `{}`. The whole chat log was cleared; sent once rather than a deletion per message. |

### Combat

Sent only while **Combat tracker** is ticked. Every payload naming a combat carries its full
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

### Prompts

Sent only for a campaign whose players are asked for their saves; see
[Saves the game asks for](#saves-the-game-asks-for).

| Type | Payload |
| --- | --- |
| `roll.prompt.opened` | `{ prompt }`: the game asks one of the campaign's characters for a saving throw, or since module 0.41.0 one of its companions. |
| `roll.prompt.closed` | `{ id, reason }`: a prompt no longer waits on its player. `reason` is `"answered"` (rolled from the app), `"rolled"` (rolled from its card in Foundry), `"gone"` (its card was deleted, or since module 0.29.0 its character no longer concentrates on what a concentration card asked about, or since module 0.41.0 its companion left the campaign's list) or `"expired"` (left ten minutes). For a [Midi prompt](#midi-qols-own-saves) (module 0.27.0), exactly one of: `"answered"` (an answer from the app was made), `"rolled"` (answered in Foundry first, where Midi asks there too), `"expired"` (the wait ended, or the character is no longer open in the app, so Midi's own way is taken) or `"gone"` (Midi's workflow was aborted, or since module 0.41.0 its companion left the campaign's list, Midi's own way then taken). |

A prompt:

| Field | Meaning |
| --- | --- |
| `id` | The card's id and the character's, joined by `-`; for a Midi prompt, a key of its own, never a card's, and the character's. Since module 0.41.0, a companion's names, in the character's place, its token's id, or for a world actor's companion its actor's: `<card>-<tokenId>`, never its key, which may hold a `-`. Either matches `^[A-Za-z0-9]{1,64}-[A-Za-z0-9]{1,64}$`. |
| `actorId` | The character asked, or since module 0.41.0 the [companion](#companions)'s key. |
| `messageId` | The chat card that asks; for a Midi prompt, Midi's item card, or its concentration card, or where neither has an id the app takes, the prompt's own key. |
| `type` | `"save"`, or `"concentration"` for a concentration check; since module 0.27.0, for a Midi prompt only, `"check"` for an ability check or `"skill"` for a skill check. |
| `abilities` | The abilities it may be rolled with, such as `["dex"]`, or `["str", "dex"]` for a choice; one for a concentration check or an ability check; `[]` for a `"skill"`. At most 10. |
| `skills` | A Midi prompt's of `type` `"skill"` only: the skills it may be rolled with, dnd5e's keys, such as `["ath", "acr"]` for a choice. At most 10. |
| `dc` | The DC, where dnd5e's *Challenge Visibility* lets the character's player see it on the card; otherwise `null`, as also for a card that shows it no one, such as a request for a link whose author hid its DC (module 0.17.0). |
| `label` | What asks: the spell or feature whose card it is, or what the character is concentrating on; or `null`. |
| `openedAt`, `expiresAt` | When its card was posted, and when it stops waiting, ten minutes later; for a Midi prompt, when it was sent, and when Midi's own way is taken, at most a minute later, by the game's clock: a listener may put it on its own once, as it first stores it, counting what's left from the envelope's `time`, as a hello may be the first to carry one; a post held up in the module's queue isn't counted. |
| `source` | Since module 0.27.0, a Midi prompt's only: `"midi"` for a save, check or skill check a Midi-QOL workflow asks, `"concentration"` for a concentration check Midi asks, in its "item" mode or on its own card, and `"overtime"` for an OverTime effect's turn save. Absent from every other prompt, whose rules are as before. |
| `advantage` | A Midi prompt's: how Midi has decided each choice is rolled, such as `{ "str": "adv", "dex": "dis" }`, each key one offered and each value `"adv"` or `"dis"`; a choice not named is rolled normally. `{}` for none. |
| `askedInFoundry` | A Midi prompt's: `true` where Midi asks the player in Foundry at once too, in its chat request or a roll dialog on their screen; else `false`. |

Since module 0.41.0 a companion's open prompts are sent again, each in `roll.prompt.opened`, when a
listener's answer first says `"companions": 2`, from less or from nothing, as after the Gamemaster
reloads, whose hello was built before the answer and left them out; a listener reopens a prompt it
had closed `"gone"` when it's opened again.

## Additions within protocol 2

- Module 0.3.0 sends [`bridge.heartbeat`](#bridgeheartbeat). A listener that answers `2xx` to
  types it does not use needs no change.
- Module 0.3.1 resends a campaign's `bridge.hello` when an answer asks for it with
  `{"resend": "hello"}`. A listener that never asks needs no change.
- Module 0.4.0 sends each campaign's events with that campaign's own secret, and `bridge.ping`
  names the campaign being tested.
- Module 0.5.0 adds each [character's sheet](#character-sheet) to the characters in
  `bridge.hello`, and sends [`character.updated`](#characterupdated) when one changes.
- Module 0.6.0 adds `conditions`, `features` and `effects` to the sheet, and each class's `id`,
  `identifier` and `hitDice`; sends their descriptions in
  [`character.texts`](#charactertexts); and sends `character.updated` as temporary effects run
  down. A listener that answers `2xx` to types it does not use needs no change.
- Module 0.7.0 adds `inventory`, `spellcasting`, `spells`, `traits`, `deathSaves` and `details` to
  the sheet, with the descriptions of its items and spells and its biography in
  `character.texts`.
- Module 0.8.0 adds `actions` to the sheet.
- Module 0.8.1 adds `level` to the spellbook's `slots`.
- Module 0.8.2 adds `castFrom` to spells and actions: the item a spell is cast from.
- Module 0.9.0 adds `favorites` to the sheet.
- Module 0.10.0 makes players' [rolls from the app](#rolls-from-the-app) in the game, for a
  campaign whose Gamemaster lets it: `features` in `bridge.hello`, the fetch from
  `/api/bridge/commands` and [`command.result`](#commandresult). A listener that never answers
  with `features` is never fetched from, and needs no change.
- Module 0.11.0 makes players' [attacks](#attacks) in the game too, for a campaign whose
  Gamemaster lets it: `"attack"` and `"damage"` among the `kinds` in `bridge.hello`, their
  fetched rolls, and `attack` and `damage` in `command.result`. It adds `attackId` to the sheet's
  actions and activity favorites, and reports a roll made after its `"timeout"` again.
- Module 0.12.0 makes players' [spells and features](#spells-and-features) in the game too, under
  the same option: `"use"` among the `kinds`, its fetched uses, and `use` in `command.result`. An
  attack may name its `slot`, `ammunition` and `attackMode`, and damage its `types`; the damage
  preview adds `healing` and each roll's `types`, and an attack with a choice of damage types is
  no longer refused (`"damage-type"`). It adds `activity`, `attackModes` and `ammunition` to the
  sheet's actions and activity favorites.
- Module 0.13.0 adds [what an item rolls](#what-an-item-rolls) to the sheet's spells, features and
  inventory items, and a feature's `range`, `target` and `concentration`, and an inventory item's
  `activation`, `range`, `target` and `concentration`, where they roll or are used through
  anything; attacks and uses may name any of them. A use at a target on a level or scene the
  Gamemaster isn't viewing is made through Midi-QOL where they allow it. Damage may be
  [changed](#attacks) with `modifiers`, as the hello's `modifiers` says, and the damage preview's
  rolls say their `perDie`. Players may be asked for the [saves the game asks](#saves-the-game-asks-for)
  of their characters: `prompts` in the hello's `features` and in the hello,
  [`roll.prompt.opened` and `roll.prompt.closed`](#prompts), a save's `prompt`, and `outcome` and
  the reason `"prompt"` in `command.result`. A listener that answers `2xx` to types it does not use
  needs no change.
- Module 0.14.0 makes [an item's own roll fields](#what-an-item-rolls) its first activity's, and
  lists each activity of an item with more than one in `activities`, on the sheet's actions,
  spells, features and inventory items; attacks and uses may name any of them. A spell's activity
  used without spending a slot says so with `consumesSlot`, on an activity favorite too.
- Module 0.15.0 lists an item in [each section of `actions`](#character-sheet) for how its
  activities are activated, with `activityName`, `activationType` and `consumable`, and the
  activities activated as each section has it; and no longer lists the copies dnd5e keeps of the
  spells an item casts. A Cast activity rolls as its spell does, with `cast`, and attacks and uses
  may name it, casting the spell from the item. A spell cast from an item is no longer `prepared`
  `0`, and a favorite of one the spellbook doesn't list is left out. A listener that takes an
  item's id to be listed once in `actions` takes the first it's listed under as the item.
- Module 0.16.0 lists every spell an item casts among the spellbook's spells cast from items, and
  says with `castFrom`'s `usable` and `attune` which the item can't cast now, and why; those roll
  nothing. A favorite of one is left out when its item is hidden or not identified, and a favorite
  of one of its activities, as before, while the item can't cast it; a formula of one is refused
  then (`"item"`). It adds
  `rules` to the sheet. Players may spend [hit dice and roll a utility's
  formula](#hit-dice-and-formulas): `"hitDie"`, once the self-test has checked it, and `"formula"`
  among the `kinds`, their fetched rolls, `rollFormula` on the sheet, `healed` in `command.result`,
  and the reasons `"no-hit-dice"` and `"dice"`. [Area attacks](#attacks) are made at the targets the
  player picks: `areaAttacks` in the hello's `features`, `attackArea` on the sheet, an attack's
  `targets`, and `attack`'s `targets` in `command.result`; only an area Midi-QOL targets itself is
  still refused (`"area"`). `attackArea`, `rollFormula`, `healed` and `attack`'s `targets` are left
  out where they don't apply; a listener that sends neither the new kinds nor an attack's `targets`
  needs no change.
- Module 0.17.0 marks the [links in descriptions](#links-in-descriptions) the app can act on, as
  `ss-save`, `ss-damage`, `ss-roll` and `ss-condition` spans, those to act on numbered by `data-n`,
  and makes Foundry's and dnd5e's other roll links their text. Descriptions are sent in this new
  format under new hashes, so each is sent again once; a description's hash now also changes with
  the character's spell save DC, its item's saving throws and damage, and the rules and language,
  and an effect's with its character's numbers. Players may act on the links [from the
  app](#descriptions-that-roll): `"ask"`, `"textRoll"` and `"textDamage"` among the `kinds`, their
  fetched commands, a save's `text` and `link`, and its `outcome`, with the reasons `"gone"`,
  `"link"`, `"busy"`, `"secret"` and `"type"` for them in `command.result`; under dnd5e 5 only. A
  request a player asks for opens no [prompt](#prompts), and a prompt's `dc` is `null` for a card
  that shows its DC no one. Chat messages carry [`ask`](#chat-message), the save a roll
  request card asks for, and their `text` keeps only the label with or without a DC that players
  see. On the sheet, [activities](#what-an-item-rolls) and activity favorites have `duration`,
  `trigger` and, under dnd5e 6, `text`; a Cast activity has `spellId`, as does an item whose first
  activity is one; and every `cast` has `text`. `hp`'s `max`, on the sheet and on combatants, is
  the maximum dnd5e shows, with any temporary change to it. The new sheet fields are left out where
  they don't apply, and `ask` is `null`; a listener that sends none of the new kinds needs no
  change, and one that styled the `roll` and `ref` classes of Foundry's and dnd5e's links can keep
  doing so.
- Module 0.18.0 marks the checks in descriptions, dnd5e's `[[/check]]`, `[[/skill]]` and `[[/tool]]`
  links and, in English, plain text such as "a DC 15 Strength (Athletics) check", as
  [`ss-check`](#links-in-descriptions) spans, numbered with the other links to act on, with
  `data-checks` and `data-using-tool`; passive checks stay text. Descriptions are sent in this new
  format under new hashes, so each is sent again once; a description's hash now also changes with
  its item's checks. Players may [ask the table](#descriptions-that-roll) for a description's check,
  on dnd5e's roll request card with a button for each check it offers, and roll it themselves with
  a `skill`, `tool` or `ability` naming its `text` and `link`, against its DC, with its `outcome`
  in `command.result`; a tool so rolled may be a kind of vehicle. A check's request card, the
  Gamemaster's or a player's, has [`ask`](#chat-message) `{ type: "check", checks, dc, label }`, and
  opens no [prompt](#prompts). The sheet has [`tools`](#character-sheet). A listener that doesn't
  know `ss-check` can show it as text, and one that sends none of the new commands needs no change;
  one that reads `ask` should expect its new `type`.
- Module 0.19.0 rolls a [description's damage](#descriptions-that-roll) as a critical hit's, where
  the player chose one, with `critical` on a `"textDamage"`, never for healing, as the world's rules
  make a critical hit's damage, Midi-QOL's too; and changed in the app, with `modifiers`, as an
  attack's damage is: more of its first part's first die, that die another size, or every die at
  its highest. The sheet has [`critical`](#character-sheet), how the world rolls a critical hit's
  damage, for the app to plan its dice by, and is sent again when the world's settings for it
  change. The hello's `modifiers` now also says whether a description's damage may be changed, and
  is `true` where only it is offered, as with **Run players' attacks through Midi**
  off while Midi makes items' uses. Damage dnd5e's own link rolls through an activity that allows
  no critical hit, or whose critical hit throws dice the app can't plan, is marked
  [`data-critical="false"`](#links-in-descriptions), and is never one (`"invalid"`, `"critical"`);
  descriptions are sent in this new format under new hashes, so each is sent again once. Before
  module 0.19.0, a `textDamage` with `modifiers` was refused (`"invalid"`, `"modifiers"`), but its
  `critical` was never read: it was rolled as an ordinary hit's, or refused as `"dice"` where its
  dice were a critical hit's. A listener should send `critical` only where the sheet has
  `critical`, which module 0.19.0 sends; one that sends neither needs no change.
- Module 0.20.0 offers critical hits that add dice. Damage dnd5e's own link rolls through an
  activity has [`data-critical-dice` and `data-critical-damage`](#links-in-descriptions), both or
  neither, what a critical hit adds to each of its parts, such as a melee weapon's extra dice for
  Savage Attacks and an attack's critical damage, and keeps `data-critical="false"` where any of it
  throws dice, so that apps before it keep it non-critical; an app that reads the pair takes it to
  allow a critical hit's, rolled with those additions. The sheet's [`critical`](#character-sheet)
  has `bonusDice`, what the world's rules do with extra dice. An attack's [`damage`](#attacks)
  preview marks its critical damage's dice `added`, which a die more never changes; damage that,
  once built, can't take the player's dice is refused (`"invalid"`, `"dice"`) with nothing posted,
  a description's as `"dice"`. Descriptions are sent in a new format, 5, under new hashes, which
  now change with the damage they show as resolved, so each is sent again once, with the next
  hello. A listener that reads neither the pair nor `bonusDice` needs no change: unknown attributes
  and fields are dropped, and `"false"` keeps such damage non-critical for it.
- Module 0.20.0 also casts a spell from an item [at a higher level](#spells-and-features), where
  its Cast activity lets it, for more of the item's uses: a `cast` has `levels`, the levels it may
  be cast at with what each costs, and an attack or use of it, or of its copy's other activities,
  names one as its `slot`, `"spell"` and the level; a level dnd5e wouldn't offer for the Cast
  activity is refused (`"slot"`), and one it offers that the item can't pay for, as one left out
  of `levels` for costing more than the item ever has, is refused as spending more than is left
  (`"consume"`).
  dnd5e's `dnd5e.preUseLinkedSpell` hook is told the level as `spell.slot` and `scaling`. A Cast
  activity above its spell's own level is refused beforehand (`"consume"`) where its scaled cost
  is more than is left. The `perLevel` of a Cast activity, on its `activity`'s `targets` and its
  `attackArea`, is how many more for each level above the one it casts its spell at, rather than
  `null`. Its copy's is counted from that level too: the same as before where the Cast activity
  casts at the spell's own level, but where it casts above it, no longer `null` for a count
  written with the spell's level. And `consumesSlot` marks a cantrip copy's activity that spends
  nothing.
  A listener that doesn't read `levels` sends no `slot` for a spell cast from an item, which is
  then cast at its own level as before; its targets, counted from `cast`'s `level`, come to the
  same.
- Module 0.20.0 also spends [several hit dice at once](#hit-dice-and-formulas), of one size or
  more, in one command, `"hitDice"`, among the `kinds` wherever `"hitDie"` is; dnd5e spends them
  one at a time, a card each, and they stop at full hit points, with the new reason `"full-hp"`.
  `command.result` has `spent`, and hit dice that stopped part way are reported with those made.
  A listener should send `hitDice` only where the hello lists it, and otherwise a `hitDie` for
  each die, each once the one before is made; one that sends no `hitDice` needs no change.
- Module 0.21.0 makes more of dnd5e's activities from the app. Under dnd5e 5 a check activity is
  [used](#spells-and-features) as a save activity is, its `activity`'s `type` `"check"` and its
  `use`'s too, and has [`check`](#what-an-item-rolls): the checks it calls for, its DC, and whether
  they're the character's own, which a player may [roll](#descriptions-that-roll) with a `skill`,
  `tool` or `ability` naming its `item` and `activity`, against its DC, with `outcome`, where the
  hello's new `activityChecks` says so. A forward rolls and is used as the activity it's used
  through, by its own id, with `forward`, what it spends, `0` for nothing: a spell's spends no slot,
  and a `slot` sent for it is ignored. A spell's check activity with no activation of its own, as
  the 2014 Entangle's Escape Plants or Silent Image's check, is listed after the spell's other
  activities, so that a spell dnd5e sorts its check first, as Entangle, leads with how it's cast; it
  doesn't cast the spell, and for a leveled spell is marked `consumesSlot` `false`, used at the
  level of the `slot` sent and spending none. A forward that repeats an earlier one, through the
  same activity for the same cost, of uses they share, as the free castings dnd5e gives a spell
  granted more than once, is left out of the listing, but used, and rolled for, when named.
  `check` and `forward` are left out where they don't apply. A listener that doesn't know the
  `"check"` type takes such an activity as one it can't use; a forward it knows the kind of is used
  as that one. Since a module before 0.21.0 would roll a check naming an `item` as a plain one,
  against no DC, a listener sends one only where the hello says `activityChecks`.
  An enchant activity, such as Magic Weapon, Shillelagh or a Flame Tongue's Engulf in Flames, has
  `activity`'s `type` `"enchant"` and [`enchant`](#what-an-item-rolls): its profiles and the items
  it may enchant. It's [used](#enchantments) with a `use`'s new `enchant`, `{ profile, item }`, its
  enchantment applied by the game as dnd5e applies it, in place of what goes as it's used. Inventory
  items, spells, features and actions carry `enchantments`, which a player may end where they're
  `endable`, anyone's on the character's items, with the new kind `"endEnchantment"`, among the
  `kinds` wherever `"use"` is. `command.result` has `enchantment`, and the new reasons `"profile"`,
  `"enchant-target"`, `"applied"`, `"enchant"` and `"enchantment"`; one used that failed once
  made has its card's `messageId` while the card is there for the Gamemaster to apply it from. A listener that doesn't know the
  `"enchant"` type takes such an activity as one it can't use, and needn't read `enchantments`;
  one before 0.21.0 sends neither `enchant` nor `endEnchantment`.
  Damage previews mark the dice the damage takes away, as Reduce's −1d4, [`subtracted`](#attacks):
  more dice and another die never change one, the first die being the first roll's first die that
  is neither `added` nor `subtracted`, and damage that takes a die away, an attack's, a use's or a
  description's, isn't rolled at its highest (`"invalid"`, `"modifiers"`), nor is damage the game
  rolls itself whose `formula` takes one away. An older listener's
  change of a die taken away, or its maximum of such damage, is refused, and nothing posted; one
  that reads no `subtracted` needs no change. The hello's new `signedDice` says so; a listener
  changes a description's damage only where its first die that it adds is also its first part's
  first die whatever its sign, where the hello doesn't say `signedDice`. A description's damage
  link this world can't plan is no longer written; descriptions are sent in a new format, 6, under
  new hashes, so each is sent again once, with the next hello, and none keeps a link numbered as
  it was.
- Module 0.22.0 writes [description links](#links-in-descriptions) whose dice's modifiers have
  comparisons, such as a Great Weapon Fighter's `[[/damage 2d6r<=2 + 7]]` or `6d6cs>=5`, which were
  text before: formulas may hold `<`, `>` and `=`. Descriptions are sent in a new format, 7, under
  new hashes, so each is sent again once, and no link is numbered as it was. A die with modifiers
  throws its number of dice first, the player's, in every kind of roll: a reroll or an explosion is
  Foundry's, and the game's total stands ([Making a roll](#making-a-roll)); a listener sends the
  first throw alone, as it does now, and shows the game's total. Damage with a die that explodes, or
  rerolls on its highest face, isn't rolled at its highest, an attack's, use's or description's
  (`"invalid"`, `"modifiers"`). An activity's `targets` have `fromSelf`, whether its range is Self,
  and a `use` may name its user beside its `targets`, [`self`](#spells-and-features), where the
  hello's new `selfTargets` says so: refused as `"invalid"` (`error` `"self"`) on an attack or where
  it isn't `true` or `false`, as `"target"` with their own combatant among the targets too or beyond
  its `count`, and with Midi-QOL as `"scene"` only where Midi needs a target and has none: a user
  whose token the Gamemaster's canvas doesn't draw is named on the card, and Midi uses it at the
  others, or at no one, as before. A
  module before 0.22.0 ignores `self`, using the activity at its `targets` alone, so a listener
  sends it only where the hello says `selfTargets`; one that sends none needs no change, and one
  that reads no `fromSelf` may take an action's `range` of `"Self"` for it.
  Module 0.22.0 also sends a party's sheets apart, and smaller. A `bridge.hello` says `sheetsApart`
  and lists its characters without their sheets, with nothing before it; once it's answered, each
  character follows in a [`character.updated`](#characterupdated) of its own, after the
  `character.texts` its sheet needs, every description going again after each hello; and a change
  while a hello is on its way goes with them. A sheet goes [slim](#slim-sheets), with `slim` `1`, its
  actions by reference to their rows and its rows' defaults left out, to a listener that says
  `slimSheets` in the `features` of its answers, to a `character.updated` as to a hello or heartbeat:
  one that stops saying it is sent full sheets again. No post is larger than the listener takes,
  1,000,000 bytes or the `maxBytes` it says ([Post size and slim sheets](#post-size-and-slim-sheets)):
  a larger event is dropped unsent, and a sheet withheld, with `sheetWithheld`, the Gamemaster warned
  once. A hello, sheet or description lost to failures that might not last is sent again 30 seconds
  later, and descriptions are split into posts by bytes. A listener keeps the sheets of the
  characters a `sheetsApart` hello lists until theirs arrive, drops the others', keeps the
  descriptions the sheets it keeps refer to, and answers such a hello without asking for a resend;
  it says `slimSheets` only if it expands format 1, and then in every answer, `character.updated`'s
  too. A listener before 0.22.0, which takes a hello's characters without sheets as having none, is
  sent every sheet again, full and at most 1,000,000 bytes, in the posts after the hello, with the
  descriptions before each.
- Module 0.23.0 says which feature each old-style resource stands for: a `"resource"` favorite has
  `itemId`, the id of the feature in [`features` and `actions`](#character-sheet) it stands for, or
  `null` for none: one of its name, compared without case, spacing or curly apostrophes, preferring
  one that spends it, or else the only feature that spends it. A listener that reads no `itemId`
  shows the resource as before; one that reads it shows the feature's row with the resource's
  count, and where `itemId` is missing, from an older module, may match names itself. A slim sheet
  has it as a full one does, and the hello says nothing new: the field is its own sign.

  Module 0.23.0 makes the rolls a campaign's Gamemaster makes from the app as one of its characters
  where the hello's new `gmRolls` says so (`true` wherever `enabled`). Such a roll says `by: "gm"`
  and is made as any other, as the same user; every message it makes (dnd5e 5.3's death outcome
  too, as `outcome`) is flagged `flags["sending-stone"].by` `"gm"`, marked "GM" on its card, and
  sent with `gmRoll`, the roll's id. Another `by`, or `"gm"` on `endEnchantment` (and since 0.29.0
  `endConcentration`), is `"invalid"` (`error` `"by"`). A module before 0.23.0 ignores `by`, so a listener sends it only to the session
  whose hello said `gmRolls`; one that sends none needs no change.

  Module 0.23.0 reads a refusal's JSON [`reason`](#transport), or its status and text from an older
  app, and tells the Gamemaster what went wrong and what to do once per cause, rather than once as
  deliveries start failing and again as they recover, which a campaign refused beside one that
  isn't made alternate; the settings window shows each campaign's status. Retrying is as before, but
  that a fetch of rolls refused with any status not retried stops. It sends nothing new: no field,
  header or parameter, so a listener that answers in text or with nothing needs no change.
- Module 0.25.0 lists, in the [`command.result`](#commandresult) of each roll the campaign's
  Gamemaster made in the app (`by: "gm"`), late results included, the chat messages it made,
  `messages`: the ids of those it flagged `by` `"gm"` and sent with `gmRoll`, dnd5e 5.3's death
  outcome among them, in the order made, at most 20, and `[]` when it made none. It lists only the
  messages the Gamemaster's client made or marked for the roll while it was made, so never a
  player's own message with a roll's flags copied onto it from their browser; a module that creates
  chat messages on the Gamemaster's browser for players, as Midi-QOL's `createChatMessage` socket
  does, could still have such a copy listed while the roll is being made. The messages are still
  sent before the result. The hello's `features.rolls` says `gmRollMessages` wherever it says
  `gmRolls`. A listener whose session's hello says so can take a message's `gmRoll` on the messages
  its roll's result lists alone: one that arrives before the result waits for it. Neither is sent
  by modules before 0.25.0, for which a listener keeps what it did; one that reads neither needs no
  change.

  Module 0.25.0 also clears a campaign's last refusal in the settings window once a post of the same
  type gets through, for a sheet that character's, rather than keeping it until another is refused.
  It sends nothing new for it.
- Module 0.26.0 gets ready for players entering what their own dice show in the app, with
  [Manual Dice](https://github.com/lambersond/fvtt-manual-dice); nothing is entered yet. The
  hello's `features.rolls` says `manualDice`: `true` while players' rolls are made (`enabled`), the
  Gamemaster allows it with **Allow Players to enter dice results manually** on the campaign's
  Player actions tab, and Manual Dice is installed, active and on; else `false`. A choice saved
  while Manual Dice was on is kept once it isn't, but counts as off. Each of the hello's
  `characters` says `manualDice` too, whether its player enters its dice results, always `false`
  for now. A change to the choice, or Manual Dice switched on or off in its settings while a
  campaign allows it, sends the campaigns their hellos again, as other roll settings do. Modules
  before 0.26.0 send neither; a listener that reads neither needs no change.
- Module 0.27.0 asks in the app for the saves Midi-QOL asks of a campaign's characters, while the
  character is open there: [Midi-QOL's own saves](#midi-qols-own-saves). Only of a listener that
  says, among its answers' `features` to a hello or heartbeat, `"midiPrompts": 1`, the format of
  Midi prompts it reads, and lists in each [fetch](#fetching-rolls)'s answer which of the
  campaign's characters are `open`. Such a [prompt](#prompts) has `source`, which no other has, its
  `type` may also be `"check"` or `"skill"`, with `skills` for a skill, and it has `advantage` and
  `askedInFoundry`; it waits a minute at most, and closes as `"answered"`, `"rolled"`, `"expired"`
  or `"gone"`. It's answered with a `save`, an `ability` or a `skill` naming it, `explicit` `false`
  and no `extras`, made at once, whose [`command.result`](#commandresult) may have no `messageId`,
  and is refused as `"mode"` besides. The hello's `features.rolls` says `midiPrompts`, informational
  only. A card of Midi's workflow asks no prompt, Midi's activities on or off, and nor does an
  OverTime effect's action save card. A Midi `use` with no attack, damage or healing has its
  result sent once its workflow waits on such a prompt. A listener before 0.27.0, saying neither,
  is sent no Midi prompt, and Midi goes its own way, as before; one with an older module, which
  never sends one, needs nothing of it.
- Module 0.28.0 adds `damage`, `damageLabel`, `section`, `flavor` and `attack` to every
  [roll summary](#chat-message), in chat messages' `rolls` and `command.result`'s `rolls`, each
  left out where it doesn't apply. A listener that doesn't read them needs no change.
- Module 0.29.0 lets a player end a concentration, spend charges directly and use or gain Heroic
  Inspiration from the app, as three new `kinds`, [`endConcentration`, `spend` and
  `inspiration`](#concentration-charges-and-heroic-inspiration): the first wherever players' rolls
  are made, the others wherever the Gamemaster lets them attack and cast, whether or not attacks can
  be made now; no other hello field changes. `spend` and `inspiration` post a line in chat, marked
  the Gamemaster's for theirs; `endConcentration` posts nothing and refuses theirs (`"by"`). Their
  results have no new fields: the character's sheet goes first. The sheet adds
  [`concentration`](#character-sheet), and its `uses` say which [`counter`](#counters) they are and
  whether they're `spendable`, and an `activity` what it `spends`. A dnd5e concentration card's
  prompt closes as `"gone"` once its character no longer concentrates on what it asked about. A
  [combatant](#combatant) says its token's `disposition`, never Secret. A chat message's
  [`dnd5e`](#chat-message) says whether an attack hit each target, `targets[].outcome`, who saved
  against Midi-QOL's card, `targets[].save`, and on a save from dnd5e's card whose save it is and
  whether it succeeded, `save`, each only where Foundry shows players it unless Gamemaster-only
  information is on; and unless it's on, `content` goes without DCs on buttons, without labels with
  DCs players don't see, and with Midi's sections of hits and saves emptied, and `text` with it. Each
  is an addition a listener before 0.29.0 ignores, or drops, as an unknown kind; a listener that
  offers the new kinds only where the hello lists them needs nothing more for an older module.
- Module 0.30.0 adds a campaign's [party sheets](#group) and its [Foundry settings](#bridgesettings),
  and tells chat results only as Foundry shows them to players. A listener may say, in the
  `features` of its answers to a hello or heartbeat, `"groups": 1`, that it reads the hello's
  `groups`, [`group.updated`](#groupupdated) and [`group.removed`](#groupremoved), and
  `"settings": 1`, that it reads [`bridge.settings`](#bridgesettings); each is read as an integer of
  1 or more, and without it neither event is sent. `group.updated` is among the answers whose terms
  the module follows, and the `sendingStone.listenerFeatures` hook is called with the envelope's
  type as its third argument, and `sendingStone.helloDelivered` with the hello's envelope as its
  second. Every hello has `groups`, the campaign's groups the Gamemaster listed on its new Party
  tab, each with its `access` for the campaign's characters, `[]` for none or outside dnd5e, and
  `settings`, the campaign's Foundry settings in format 1 with `results`, what players see of chat
  results. A `group.updated` follows every answered hello after its
  `character.updated`s, and any change to a group, its members' names and portraits, its items, its
  primary party or its characters' ownership; it carries the group's sheet (`members`,
  `description`, `inventory`), or `sheet` `null` with `sheetWithheld` `{ reason: "private" }` or
  `"tooLarge"`. A listed group deleted is `group.removed`, after the hello if one is on its way;
  one unlisted sends the hello again. A `bridge.settings` follows a change to a watched setting or
  to a listed group's name, and an answered hello whose settings changed while it was on its way,
  only when what the campaign was last told differs. A chat message's [`dnd5e`](#chat-message) has
  `save` on a saving throw from any origin, and a new `check`, of the same shape, on an ability,
  skill or tool check; `targets[].outcome` is drawn as dnd5e's version draws a target under total
  cover, under Midi-QOL is told on dnd5e's attacks only for one target, by its total's highlight,
  and on Midi-QOL's cards also needs
  **Attack Result Visibility** to show results, may be told for one target by Midi-QOL's highlight
  or its Gamemaster's hit or miss words, and is told to every reader of the card whatever its
  whispers; `targets[].save` is told per target, by its player owner, whoever spoke the card; and
  with Midi-QOL active, `save` and `check` keep their `outcome` only while Midi keeps dnd5e's
  highlight. Under dnd5e 6, `dnd5e` is built from the message's type and `system`, rather than
  `null`. With Gamemaster-only information off, `system` goes without targets' `ac`, buttons' DCs,
  in their `dataset` or on dnd5e 6's prompt buttons themselves, labels with DCs players don't see
  and a request's `dc` and `target`, under every version; and the
  [Gamemaster's rolls on Midi-QOL's cards](#a-gamemasters-rolls-on-midi-qols-cards) are trimmed in
  `rolls` as Midi-QOL's **GM Attack Roll Display** and **GM Damage Roll Display** show them, a
  section's damage folded into one under `totalOnly` and `hidden` without `mergeCardMultiDamage`,
  and their `content` and `text` without those sections' dice rolls, its attribution icon and its
  attack and damage buttons. A trimmed roll keeps every key, with `formula` `""`, `dice` `[]` or one
  d20, or `total` `null`. A listener before 0.30.0 ignores all of them: it never says `groups` or
  `settings`, so is sent neither event, ignores the hello's new fields and `check`, and reads a
  trimmed roll as one with nothing shown.

- Module 0.31.0 lets players [move items and coins](#moving-items-and-coins) from the app, and adds
  **Hit/miss and save results in the app**. Every hello's `features` has `transfers`,
  `{ enabled, kinds, reason }`, beside `rolls`, never inside it: `kinds` `["transfer"]` while the
  campaign's new **Players move items and coins** is on under dnd5e, `reason` `"off"` or `"system"`
  otherwise. A listener may say, in the `features` of its answers to a hello or heartbeat,
  `"transfers": 1`, read as an integer of 1 or more, that it takes the new command, `transfer`; the
  module then fetches commands for a campaign whose moves are on, its rolls on or not, and refuses a
  roll fetched while they're off as `"off"`. An answer to a hello ends the wait the last fetch's
  answer asked for. A `transfer` names `{ from, to, items?, currency? }`; its result has `transfer`
  on `"done"`, and on `"error"` after some moved, with the reasons `"transfers-off"`,
  `"not-yours"`, `"not-owner"`, `"gone"`, `"short"`, `"container"`, `"nested"` and `"deep"`; it
  posts a public line, "Gives …" or "Takes …", and sends both ends' sheets first. A move waits for
  the rolls of both its ends, and theirs for it. The settings report has the campaign's `transfers`
  after `manualDice` and the world's `chatResults` after `chatScope`. With **Hit/miss and save
  results in the app** "Always show them to players", a chat message's `targets[].outcome`,
  `targets[].save`, `save` and `check` are told as with Gamemaster-only information, but never with
  `ac` or a DC, nor of a roll Midi-QOL obscures, the message's audience, content, `system` and
  `rolls` as before; the verdict's lines say so; and the app's own attack and save results say
  whether they hit or saved. Where Midi-QOL checks no hits, its card's targets are judged against
  the `ac` it writes on them, with Gamemaster-only information or Always, at several targets as at
  one. A listener before 0.31.0 ignores all of it: it never says `transfers`, so is handed none,
  ignores the hello's `features.transfers` and the two new rows, and reads the results it's told
  as ever.
- Module 0.32.0 lets players enter what their own dice show in the app, lets a party's Owner send
  its things elsewhere and share its coin, and makes an app roll's critical damage as dnd5e does.
  Each character's [`manualDice`](#character), in the hello and now in `character.updated` too,
  after `owners`, says whether its player may enter its dice results in the app: `true` only where
  the campaign's `features.rolls.manualDice` is and one of its primary players (those whose
  assigned Character it is, or else its player owners) has core's **Make Manual Rolls**, which
  Manual Dice's roles set; it's sent again when the permissions, a user's role, assigned Character
  or permissions, the users or the character's ownership change. A roll may say
  [`typed`](#fetching-rolls) `true`, its dice typed in from the player's own: read as nothing else,
  never refused, it changes nothing of how the dice are used, and every message the roll makes is
  flagged `typed` and its card marked with a keyboard, "Entered by hand on Sending Stone", but
  never a roll `by` `"gm"`, whose mark wins. An attack's sheet roll fields have
  [`elvenAccuracy`](#character-sheet) `true` beside `attackId` where dnd5e would give it Elven
  Accuracy, and such an attack with advantage may send three d20s; where the roll throws fewer d20s
  first than were sent, the d20 values over are dropped before any die is thrown. A critical hit's
  damage made for the app, and every damage roll built to plan or preview one, is made as dnd5e's
  own rules make it, never Midi-QOL's "Choose critical damage" options, which keep to the
  Gamemaster's own rolls; the sheet's [`critical`](#character-sheet) says dnd5e's rule under Midi
  too, so `1d6 + 4` is `2d6 + 4`, though under dnd5e's *Critical Damage Modifiers*, or a roll's own
  `critical.multiplyNumeric`, 0.32.0 doubled its numbers too, `2d6 + 8`, as module 0.33.0 never
  does; its critical damage's dice are `added` in a preview under dnd5e 6
  too, so damage may be changed in the app there (`modifiers`), with or without Midi. A party's
  Owner may send its items and coins to any of the campaign's characters or to another party they
  own, and the Gamemaster anything, party to party too, `features.transfers.partySends`; and a
  party's coin of one kind may be shared among its characters, a `transfer` with
  [`among`](#moving-items-and-coins) in place of `to`, `features.transfers.distribute`; both `true`
  wherever `transfers.enabled` is. A move from a party,
  or a distribution, may be made as any of the campaign's characters, an end or not. They post
  "Sends … from … to …" and "Distributes … among … (… each); … stays with …" (or "none stays"),
  spoken by the character the move is made as; a distribution is refused `"members"` where `among`
  isn't the party's characters, and `"split"` where there's less than a coin each, and its result's
  `transfer` is `{ from, to: null, items: [], currency, among }`. A distribution waits for the rolls
  of each character it shares among. A listener before 0.32.0 sends no `typed`, three d20s nor
  `among`, reads `manualDice` as before, ignores `elvenAccuracy` and the two new booleans, and reads
  the new lines as any.
- Module 0.33.0 doubles only the dice of a critical hit's damage made for the app, never a number in
  it: not the ability modifier, a flat bonus nor a number in parentheses, whatever dnd5e's *Critical
  Damage Modifiers*, Midi-QOL or the roll's own `critical.multiplyNumeric` say. That's every
  critical hit's damage the app makes or plans, as in [Making a roll](#making-a-roll): the player's
  and the Gamemaster's as the character, an attack's, its preview, a description's, with more dice,
  another die or at its highest, versatile or typed in. So `1d6 + 4` is `2d6 + 4`, and with a die
  more `4d6 + 4`, where 0.32.0 made `2d6 + 8` and `4d6 + 8` under *Critical Damage Modifiers*. dnd5e
  6 copies a group in parentheses for a critical hit, its numbers with it: the copy is made of its
  dice alone, so `(1d6 + 2) + 4` is `(1d6 + 2) + (1d6) + 4`, and its *Powerful Critical* adds the
  most a group's dice could roll, never its numbers, and nothing for a number in parentheses. It
  copies a function of dice whole too, its numbers with it: instead the function's own dice are
  thrown as many more times within it, so `floor((1d6 + 4) / 2)` is `floor((2d6 + 4) / 2)`, and
  under *Powerful Critical* the most added is that of its dice alone, `floor((1d6) / 2)`'s. The
  roll's own `options.critical.multiplyNumeric` says `false`, and the sheet's
  [`critical`](#character-sheet) `multiplyNumeric` is `false` under any setting, so changing
  *Critical Damage Modifiers* sends no sheet again. Its dice are doubled as before, the item's
  critical extra dice on the first, its critical damage added as it is, and *Powerful Critical*
  followed; the Gamemaster's own rolls in Foundry keep dnd5e's and Midi-QOL's rules. A listener
  needs no change: `multiplyNumeric` reads `false`, as dnd5e's default has it. And every hello's
  `features` has `removals`, `{ enabled, kinds, reason }`, beside `rolls` and `transfers`: `kinds`
  `["remove"]` under dnd5e, otherwise `reason` `"system"`, with no switch. A listener may answer
  `"removals": 1`, and the module then fetches for a campaign whose rolls and moves are off too. A
  [`remove`](#removing-an-item) names `{ item, quantity, held }`, the item, how many of it and how
  many the app's sheet showed, and its result has `removed`, `{ item, quantity }`. It's refused
  `"changed"` where the stack isn't `held` now, and `"off"`, `"unknown"`, `"gone"`, `"short"` and
  `"error"` as [Removing an item](#removing-an-item) says; it posts "Removes 2 Potion of Healing";
  the character's sheet goes first; and it's made one at a time with the moves. A listener before
  0.33.0 never says `removals`, so it's handed none, and it ignores the hello's `features.removals`.
- Module 0.34.0 keeps journal notes: a character's own, and a party's, one journal of each per
  campaign in Foundry, a page per chapter and per note. Every hello's `features` has `notes`, `{
  enabled: true, kinds: ["personal", "party"], reason: null, journals }`, after `removals`, under any
  system and with no switch, `journals` listing the campaign's characters and parties whose journal
  for it exists. A listener may answer `"notes": 1`; the module then fetches for the campaign, its
  rolls, moves and removals on or not, and sends each book in a new event,
  [`journal.updated`](#journalupdated), the journal whole as Foundry holds it: after each hello, after
  every change heard of in Foundry, and before the result of every
  [`note`](#journal-notes) command, which adds, changes or deletes a note or chapter, `{ book, op,
  id, role, base, writer, at, title?, markdown?, chapter?, createdAt? }`. Its result has `note`, `{
  id, rev, deleted? }`, never its text, and the new reasons `"private"`, `"not-member"`,
  `"not-yours"`, `"foundry-only"`, `"headings"` and `"full"`, with `"changed"` and `"gone"` where it
  was changed or deleted in Foundry since. A listener before 0.34.0 never says `notes`, so it's
  handed no note command and sent no `journal.updated`, and it ignores the hello's `features.notes`.
- Module 0.35.0 keeps each group's order of notes, a chapter's or those in no chapter, in Foundry's
  page order, which `journal.updated` lists them in, and takes an order from the app. Every hello's
  `features.notes` ends with `orders: true` and `changes: true`. A [`note`](#journal-notes) command
  may be an order, `{ book, op: "order", chapter, ids, was, writer, at }`, from anyone who may see
  the party, with no author check, refused `"invalid"`, `"off"`, `"unknown"`, `"private"`,
  `"not-member"`, `"gone"`, `"changed"` (the same notes reordered in Foundry since) or `"error"`;
  notes added, deleted or moved meanwhile are merged. Its result has `order`, `{ chapter, ids }`,
  the group's order in Foundry then, in place of `note`. Foundry's order is kept: a reorder made
  there stays, and a note made or moved goes last in its group, no longer by when it was written. A
  listener that answers `"notes": 2` is told who last deleted or reordered a page it's sent in
  Foundry, and when, as `journal.updated`'s `journal.changed`, `{ what, by, at }`. A listener before
  0.35.0 never sends an order and answers `"notes": 1`, so it's sent no `journal.changed`; it may
  ignore `orders` and `changes`.
- Module 0.36.0 lists the campaign's characters' [companions](#companions), the creatures each
  summons, while their tokens are on the active scene, and the NPCs its players own in Foundry: every
  hello has `companions`, after `groups`, and `features.companions`, `{ kinds, initiative }`, after
  `notes`. A listener may answer `"companions": 1`; the module then sends each companion's sheet in a
  new event, [`companion.updated`](#companionupdated), `{ companion, sheet }`, built from its live
  actor, a token's synthetic actor for an unlinked token, after the hello and whenever it changes,
  without secrets where none of its players owns it in Foundry; and the list again in
  [`companions.listed`](#companionslisted) whenever it changes. To such a listener only, a
  [combatant](#combatant) and a [chat message](#chat-message) have `companion`, a companion's key or
  `null`, and a companion has `hp` as a character has, so a fight with only a companion in it reaches
  the campaign. Any command among `features.companions.kinds` may name a companion, `actorId` its key
  and [`of`](#fetching-rolls) its character, made on its live actor as the character's player, its
  messages flagged `companion`; `inspiration`, `hitDie`, `hitDice`, `spend`, `transfer`, `remove`,
  `note`, `endTurn` and `undoEndTurn` with `of` are refused `"invalid"`, `error` `"of"`, and one not
  `of`'s companion now `"unknown"`. A legendary or mythic action with too few legendary actions left
  is refused `"legendary"`, for a character or a companion. Sheets have `creature`, an NPC's,
  `uses.recharge`, and every damaging row `tableDamage`, which a [slim](#slim-sheets) action takes
  from its row, as it takes `damage`; and `rolls`' `kinds` gain
  [`itemDamage` and `recharge`](#damage-on-its-own-and-recharges), with the new refusal `"charged"`
  and a recharge's `outcome`; to every listener, a [chat message](#chat-message) of a card
  `itemDamage` made has `alone: true`. And it says how the campaign's companions enter initiative,
  `features.companions.initiative`, `"own"` or `"after"`: under `"after"` it sets a companion's
  initiative 0.001 below its character's, to thousandths, in Foundry, whenever the character's is
  set, rerolled or cleared, and refuses the companion's own `initiative` `"follows"` while one of its
  characters is in that combat; the hello's `settings` gain the campaign's `companionInitiative` row.
  And `rolls`' `kinds` gain [`endTurn`](#rolls-from-the-app), right after `endConcentration`, wherever
  the campaign's rolls are made, never among `features.companions.kinds`: the module ends the current
  turn for `endTurn`, where its round and current combatant are those named and it's the character's
  or one of its companions' now, by `combat.nextTurn()` on the Gamemaster's Foundry, refusing
  `"not-started"`, `"moved"` or `"not-turn"`; and [`undoEndTurn`](#rolls-from-the-app) right after
  it, taking back the last `endTurn` of a combat, made from the listener for the same character a
  minute ago at most, while the combat stands where it left it, by one update of the turn back with
  Foundry's turn events off, refusing `"not-undoable"`; a listener before 0.36.0 never sends either,
  and a module before 0.36.0 refuses one `"invalid"`, `error` `"kind"`.
  A listener before 0.36.0 never answers `"companions"`, so it's sent no `companions.listed` or
  `companion.updated`, and its combats and chat are as module 0.35.0 sends them; it may ignore the
  hello's `companions`, `features.companions`, the sheets' `creature`, `uses.recharge` and
  `tableDamage`, and a chat message's `alone`. It never sends `of`, `itemDamage` or `recharge`; a
  module before 0.36.0 refuses a companion's command `"unknown"`.
- Module 0.37.0 adds to and removes from a character's [favorites](#favorites) from the app, by
  dnd5e's own `addFavorite` and `removeFavorite`: every hello's `features` has `favorites`, `{
  enabled, kinds, reason }`, after `companions`, `kinds` `["favorite"]` under dnd5e, otherwise
  `reason` `"system"`, with no switch, and a listener may answer `"favorites": 1` to have the
  campaign fetched for with its rolls, moves, removals and notes off too. A `favorite` names `{ op,
  type, id, item? }`, stored as dnd5e's menus store it, one id for an Add and a Remove, never with
  `of` or `by` `"gm"`; it's refused `"off"`, `"invalid"`, `"unknown"`, `"gone"` or `"error"`, is
  done with nothing written where it's already so, posts no line, sends the character's sheet first
  on every `"done"`, and its result has `favorited`. A listener before 0.37.0 never says
  `favorites`, so it's handed none, and it ignores the hello's `features.favorites`. The module's
  `title` is now "illagria/sending-stone", which nothing in the protocol carries: the hello's
  `module` is `{ id, version }`, its `id` still `"sending-stone"`.
- Module 0.38.0 adds [dishes from the Magical Recipe Book](#dishes-from-the-magical-recipe-book):
  `features.dishes` in `bridge.hello` (`{enabled, kinds: ["dish"], reason, versions}`, after
  `favorites`, by the campaign's own switch, under dnd5e 5), fetched for where the answer says
  `"dishes": 1`, with every other switch off; the `dish` command, handed over until a result answers
  it; `command.result`'s `dish: {card, state}`; and two events, `dish.applied` and `dish.dismissed`,
  sent only to such an app. A listener before 0.38.0 never says `"dishes"`, so it is sent no dish
  events and fetched for no dishes; a module before 0.38.0 handed one anyway answers `"off"`, or
  `"invalid"` with error `"kind"`.
- Module 0.39.0 lets a player turn off, turn back on and delete effects on their own character from
  the app ([A player's own effects](#a-players-own-effects)). Each effect row in a sheet's `effects`
  gains `ops`, what its player may do to it, the same in every campaign and `[]` on a companion's
  sheet: an effect the party put on the character (a dish, or a spell or feature of a character a
  player owns, by the effect's `origin`) may be turned off and deleted; an item's temporary effect
  turned off, never deleted; either turned back on only where its player turned it off from the app
  (`flags.sending-stone.offByPlayer`, which any other change to whether it's on clears); never a
  condition, a concentration or what it keeps up on the character. `features.effects` in
  `bridge.hello` (`{enabled, kinds: ["effect"], reason}`, after `dishes`, by the campaign's own
  switch, under D&D Fifth Edition), fetched for where the answer says `"effects": 1`, with every
  other switch off; the `effect` command (`effect: {op, id}`, never with `of` or `by` `"gm"`), taken
  once; and `command.result`'s `effect: {id, disabled, deleted}`, with a new reason, `"effect"`, and
  `"cancelled"` where a hook stopped the write. A dish's card is whispered to the campaign's players
  too, whose clients draw what became of it and no button; its chat message reaches only its own
  campaign's app chat; its result's `visible` says whether the cook's player is among its readers.
  Module 0.38.x's dish dialog served only the characters ticked as it opened, whatever the
  Gamemaster ticked: check who ate each dish served then. A listener before 0.39.0 never says
  `"effects"`, so it's handed none, and ignores `ops` and `features.effects`; a module before 0.39.0
  handed one anyway answers `"off"`, or `"invalid"` with error `"kind"`.
- Module 0.40.0 adds [Wild Shape](#wild-shape) from the app, by the 2024 rules, where the campaign's
  own switch allows it under D&D Fifth Edition: `features.wildShape` in `bridge.hello` (`{enabled,
  kinds: ["wildShape"], reason}`, after `effects`); the `wildShape` command (`wildShape: {op}`, ops
  `"transform"`, `"revert"`, `"learn"`, `"forms"`, never with `of` or `by` `"gm"`), fetched for where
  the answer says `"wildShape": 1`, taken once; and `command.result`'s `wildShape`, with new reasons
  `"form"`, `"full"`, `"swap"`, `"incapacitated"`, `"transformed"`, and `"shaped"` for a favorite,
  effect, move or removal while its character is transformed. A druid's known forms are the linked
  forms of the druid's own Wild Shape in dnd5e (`transform.mode: ""`, one profile each), from the
  campaign's compendiums. To such a listener a transformed character's sheet is its form's, under the
  character's own id, with `form`, and a 2024 druid's sheet has `wildShape`; and the character's
  commands are made on the form, its rolls, attacks, uses, hit dice, charges and Heroic Inspiration,
  each result still the character's; to any other listener, on the character's own actor, as before.
  To every listener, initiative is rolled for the combatant that is the character's now, the form's
  while transformed, on that combatant's actor, as dnd5e rolls it, and End Turn ends the form's turn;
  a form's combatant, chat messages and the saves asked of it name its character: a save asked of
  the form is asked of the character, its prompt id and `actorId` the character's, answered from the
  character's seat and rolled on the form, dnd5e's and Midi-QOL's alike; a concentration ended while
  transformed is ended on the form and the character both; a dish's cook is the character, never the
  form. A listener before 0.40.0 never says `"wildShape"`, so it gets the character's own sheet as
  before and is handed no Wild Shape; it is refused `"shaped"`, a reason it has no words for, for a
  favorite, effect, move or removal while one of its characters is transformed in Foundry, though the
  sheet it's sent is the character's own and shows them. A module before 0.40.0 handed a Wild Shape
  anyway answers `"off"`, or `"invalid"` with error `"kind"`.
- Module 0.41.0 adds, in `features.rolls`, `aloneChoices`, `true` wherever `"itemDamage"` is among the
  kinds, and `companionPrompts`, `true` wherever `prompts` is. To a listener that answers
  `"aloneChoices": 1`, a damaging row's
  [`tableDamage`](#what-an-item-rolls) carries `choices`, its plans at the spell's higher levels, in
  its weapon's other attack modes and with each ammunition, each in a [slim](#slim-sheets) sheet with
  only what it doesn't hold alike with the row's own, and `spends`; and with `aloneChoices` an
  [`itemDamage`](#damage-on-its-own-and-recharges) may name `slot`, `attackMode`, `ammunition` and
  `consume: true`, checked as a use's are, rolled at that level, in that mode, with that ammunition,
  the card's flavor naming them, then spending what its use would, as dnd5e spends it, the ammunition
  fired and a weapon thrown, beginning concentration and counting Midi-QOL's Bonus Action or reaction
  where it enforces them, reported in `command.result`'s `alone: { spent, concentrating? }`, with new
  reasons for it `"slot"`, `"mode"`, `"ammo"`, `"consume"`, `"bonus-action"` and `"reaction"`, and
  `"invalid"` errors `"slot"`, `"attack-mode"`, `"ammo"` and `"consume"`. With `companionPrompts`,
  to a listener that answers `"companions": 2`, the [saves the game asks](#saves-the-game-asks-for)
  of a listed [companion](#companions) are asked too, by dnd5e's cards and
  [Midi-QOL's](#midi-qols-own-saves): filed under its key, its token's or world actor's id in the
  prompt's [`id`](#prompts), answered with `of`, closed `"gone"` as it leaves the list, and sent
  again when that listener's answer first says 2. And a
  [Wild Shape](#wild-shape) change or return is refused `"bonus-action"` where Midi-QOL makes uses
  and enforces Bonus Actions, in a combat, and one is used, and marks one used: on the new form, or
  on the character once back. A listener before 0.41.0 says `"companions": 1` and no
  `aloneChoices`: it is asked no companion's save, is sent no choices and never names one; a module
  before 0.41.0 says neither flag, so a listener answers no companion's prompt and names no choice
  to it, and refuses a slot, attack mode or ammunition `"invalid"`, `"item"`.
- Module 0.42.0 lets a player typing in their dice type the dice their effects add: a character's
  sheet lists them under dnd5e 5, [`effectDice`](#character-sheet) (`{ name, effect, faces, count,
  sign, on }`), and a typed d20 roll may send them, [`effectDice`](#fetching-rolls) (`[{ faces,
  sign, results }]`), where `features.rolls.effectDice` says `true`; a malformed one is refused
  `"invalid"`, error `"effectDice"`. And a typed roll may say its rerolls were made at the table,
  [`rerolls`](#fetching-rolls) `"kept"`, where `features.rolls.keptRerolls` says `true`: its `r`
  and `rr` are dropped before it's made. A listener before 0.42.0 sends neither and ignores the
  sheet's list, and its rolls are made as before; a module before 0.42.0 says neither feature, so a
  listener sends neither to it.
- Module 0.42.1 lists, among a character's [`effectDice`](#character-sheet), the 2024 Bardic
  Inspiration another character gave it, marked `offer: true`: a die dnd5e doesn't add, which a
  player typing in their dice may add to a d20 roll as one of its `extras`, its `effect` the Inspired
  that adding it uses up. Nothing else changes: no flag, the roll is made as any with added dice, and
  the effect deleted as any effect is. A listener before 0.42.1 drops an entry with `offer` (0.42.0),
  or never reads the list; a module before 0.42.1 sends none, so nothing is offered.
- Module 0.42.1 also lets a player spend one of their character's spell slots, or restore one, from
  the app: a new kind among `features.rolls.kinds`,
  [`spellSlot`](#concentration-charges-and-heroic-inspiration), right after `inspiration` wherever
  `spend` is, never among `features.companions.kinds`, naming `{ op, id, from }`; it's made only from
  the count named, never while the character is shaped, and posts a line as `spend` does. No flag: a
  listener offers it only where the kind is listed, one before 0.42.1 keeps only the kinds it knows,
  and a module before 0.42.1 never lists it.
- Module 0.42.1 also lets a player prepare one of their character's spells from the app, or unprepare
  one, as dnd5e's sheet's menu does: a new kind among `features.rolls.kinds`,
  [`prepare`](#preparing-spells), right after the charge kinds wherever `spend` is, never among
  `features.companions.kinds`, naming `{ op, id }`, the state wanted, never a toggle; never the
  Gamemaster's, as it posts nothing; a new `reason`, `"prepare"`. No flag: a listener offers it only
  where the kind is listed, one before 0.42.1 keeps only the kinds it knows, and a module before
  0.42.1 never lists it. And each class among a character sheet's
  [`spellcasting.classes`](#character-sheet) may have `prepared`, `{ value, max }`, its count of
  prepared spells and how many it may prepare, as dnd5e's sheet shows "Prepared 5 / 6", left out
  where both are 0; a listener before 0.42.1 ignores it, and a module before 0.42.1 sends none.

## Changes from protocol 1

- Events are posted to `<destination>/api/events`; the Gamemaster sets only the destination.
- Every envelope carries `campaign`, and each event is sent once per campaign it involves,
  described for that campaign. `sequence` counts per campaign.
- `bridge.hello` is sent per campaign, with that campaign's characters and combats.
- `characters.updated` is no longer sent: a change to the campaigns sends `bridge.hello` instead.
- `combat.created` and `combat.ended` also mark a campaign's characters joining or leaving a fight.

## Rolls from the app

A player can roll a check in the app and have it made in the game, with the dice they rolled, as
if they had rolled it in Foundry: dnd5e makes the roll, so its card, critical hits, Dice So Nice
and modules such as Midi-QOL behave as they always do. The Gamemaster turns it on for each
campaign, with **Players roll in the app** on its Player actions tab. It is made for:

| `kind` | The roll | Names |
| --- | --- | --- |
| `skill` | A skill check, such as Perception. | `key`: dnd5e's skill key, such as `"prc"`; since module 0.18.0, `text` and `link`, the [check in a description](#descriptions-that-roll) it's rolled for, if any; or since module 0.27.0 `prompt`, the [Midi prompt](#midi-qols-own-saves) of `type` `"skill"` it answers. |
| `tool` | A tool check. | `key`: dnd5e's tool key, such as `"thief"`; or for a check in a description, a kind of vehicle, such as `"water"`; `text` and `link` as for a skill. |
| `ability` | An ability check. | `key`: the ability, such as `"str"`; `text` and `link` as for a skill; or since module 0.27.0 `prompt`, the [Midi prompt](#midi-qols-own-saves) of `type` `"check"` it answers. |
| `save` | A saving throw. | `key`: the ability; `prompt`, the [prompt](#saves-the-game-asks-for) it answers, if any, a Midi prompt's of `type` `"save"` or `"concentration"` among them; or since module 0.17.0 `text` and `link`, the [saving throw in a description](#descriptions-that-roll) it's rolled for, if any. |
| `death` | A death saving throw, while the character is dying. | |
| `initiative` | Initiative, while the character has none in the combat the Gamemaster has up. | `combatId` |
| `hitDie` | A [hit die](#hit-dice-and-formulas) spent, healing the character. Module 0.16.0. | `denomination`: its size, such as `"d10"`. |
| `hitDice` | Several [hit dice](#hit-dice-and-formulas) spent at once, of one or more sizes. Module 0.20.0. | `hitDice`: each size and how many of it, `[{ denomination, count }]`. |
| `formula` | A utility's [own roll](#hit-dice-and-formulas), such as a d4 of luck. Module 0.16.0. | `item`, `activity`: the item and activity with its `rollFormula`. |
| `textRoll` | A [roll in a description](#descriptions-that-roll), such as `[[/r 1d4]]`. Module 0.17.0. | `text`, `link`: the description and the link in it. |
| `ask` | Not a roll: the table [asked](#descriptions-that-roll) for a description's saving throw, or since module 0.18.0 its check. Module 0.17.0. | `text`, `link` |
| `endEnchantment` | Not a roll: an [enchantment](#enchantments) on one of the character's items ended, among the `kinds` wherever `"use"` is. Module 0.21.0. | `enchantment`: `{ item, effect }`. |
| `endConcentration` | Not a roll: a [concentration](#concentration-charges-and-heroic-inspiration) of the character's ended. Module 0.29.0. | `concentration`: `{ effect }`. |
| `spend` | Not a roll: so many of the character's [charges](#concentration-charges-and-heroic-inspiration) spent directly. Module 0.29.0. | `counter`, `count`. |
| `spellSlot` | Not a roll: one of the character's [spell slots](#concentration-charges-and-heroic-inspiration) spent, or one restored. Module 0.42.1. | `spellSlot`. |
| `inspiration` | Not a roll: the character's [Heroic Inspiration](#concentration-charges-and-heroic-inspiration) used or gained. Module 0.29.0. | `inspiration`: `"use"` or `"gain"`. |
| `prepare` | Not a roll: one of the character's spells [prepared or unprepared](#preparing-spells), as dnd5e's sheet's menu does. Module 0.42.1, among `features.rolls.kinds` wherever `"spend"` is. | `prepare`: `{ op, id }`. |
| `transfer` | Not a roll: items and coins [moved](#moving-items-and-coins) between the character and a party, or another character; since module 0.32.0 also a party's sent elsewhere, party to party too, or a party's coin shared among its characters. Module 0.31.0, among `features.transfers`' `kinds`, never `features.rolls`'. | `transfer`: `{ from, to, items?, currency? }`, or since module 0.32.0 `{ from, among, currency }`. |
| `remove` | Not a roll: an item, or part of its stack, [removed](#removing-an-item) from the character. Module 0.33.0, among `features.removals`' `kinds`, never `features.rolls`'. | `remove`: `{ item, quantity, held }`. |
| `favorite` | Not a roll: one of the character's [favorites](#favorites) added or removed, by dnd5e's own methods. Module 0.37.0, among `features.favorites`' `kinds`, never `features.rolls`'. | `favorite`: `{ op, type, id, item? }`. |
| `dish` | Not a roll: a [dish from the Magical Recipe Book](#dishes-from-the-magical-recipe-book), a card for the Gamemaster. Module 0.38.0, among `features.dishes`' `kinds`, never `features.rolls`'. | `dish`: `{ queuedAt, body }`. |
| `effect` | Not a roll: one of the character's own [effects](#a-players-own-effects) turned off, on or deleted. Module 0.39.0, among `features.effects`' `kinds`, never `features.rolls`'. | `effect`: `{ op, id }`. |
| `wildShape` | Not a roll: [Wild Shape](#wild-shape) from the app, a change, a return, a form learned, or the Beasts to learn listed. Module 0.40.0, among `features.wildShape`' `kinds`, never `features.rolls`'. | `wildShape`: `{ op, … }`. |
| `note` | Not a roll: a journal note or chapter added, changed, or a note deleted (module 0.34.0), or since 0.35.0 a group's notes put in order. | `note`: `{ book, op, id, role, base, writer, at, title?, markdown?, chapter?, createdAt? }`, or `{ book, op: "order", chapter, ids, was, writer, at }`; see [Journal notes](#journal-notes). |
| `itemDamage` | Damage or healing of an item's activity on its own: dnd5e's damage card with no targets, for the Gamemaster to apply. Module 0.36.0. | `item`, `activity`, `critical`, `types`, `modifiers`; see [Damage on its own and recharges](#damage-on-its-own-and-recharges). |
| `recharge` | A spent recharge rolled, dnd5e's own. Module 0.36.0. | `item`, `activity`; see [Damage on its own and recharges](#damage-on-its-own-and-recharges). |
| `endTurn` | Not a roll: the current turn ended, the character's or one of its companions', as Foundry's Next Turn does, made on the Gamemaster's Foundry. Module 0.36.0. | `turn: { combatId, round, combatantId }`: the combat, its round (1 or more) and its current combatant, as the listener was shown them; never a turn index. It names nothing else and throws no dice (`mode` `0`, `explicit` `false`, `extras` and `dice` empty). An `endTurn` names the character, never `of`, and is never the Gamemaster's (`by`). It's made where that combat is one the campaign is told of and has started, its round and current combatant are those named and that combatant isn't hidden, and it's the character or one of its companions now; then by `combat.nextTurn()`, with nothing waited for between those checks and it, after waiting up to 10 seconds for any use from the app still going through Midi-QOL's workflow, which may hold the Gamemaster's targets. It waits for the character's earlier commands, and its companions', and for any earlier `endTurn` of the same combat, any character's: of two players ending the turn of a companion they share at once, the later is refused `"moved"`. Its result is a plain `done`; the new turn comes as [`combat.turn`](#combat), ahead of it. |
| `undoEndTurn` | Not a roll: the turn an `endTurn` from the listener just ended, taken back, on the Gamemaster's Foundry. Module 0.36.0. | `undo`, that `endTurn`'s `id`; `turn: { combatId, round, combatantId }`, the combat and where that `endTurn` left it, as the listener shows it now; never a turn index. It names nothing else and throws no dice. It names the character, never `of`, and is never the Gamemaster's (`by`). It's made only for the character whose `endTurn` it names, made on this Foundry a minute ago at most and the last `endTurn` of that combat; only while the combat stands where that `endTurn` left it, by its round and current combatant, and the combatant whose turn it ended is still in it, not hidden, and the character or one of its companions; then by one update of the combat's `round` and `turn` back to that combatant, found by its id, with Foundry's turn events off (`turnEvents: false`), so no start- or end-of-turn work runs again. It waits as `endTurn` does. Its result is a plain `done`; the turn comes as [`combat.turn`](#combat) ahead of it, its `direction` `"backward"` unless the order changed since. |

### Fetching rolls

A browser can't take incoming requests, so the module fetches players' rolls from the listener.
It does so only once the listener has answered a campaign's `bridge.hello` or `bridge.heartbeat`
with `{"features": {"commands": true}}`, and only for a campaign whose rolls are `enabled`, from
the bridge alone; since module 0.31.0, also for one whose [moves](#moving-items-and-coins) are, its
rolls on or not, where the answer says `"transfers": 1` too, and since module 0.33.0, under dnd5e,
for every campaign, its rolls and moves on or not, where the answer says `"removals": 1`, to
[remove items](#removing-an-item); and since module 0.34.0, for every campaign, its rolls, moves and
removals on or not, under any system, where the answer says `"notes": 1`, to
[keep journal notes](#journal-notes); and since module 0.38.0, for every campaign whose Gamemaster
takes dishes, under dnd5e 5, its rolls, moves, removals, notes and favorites on or not, where the
answer says `"dishes": 1`, to take [dishes from the Magical Recipe Book](#dishes-from-the-magical-recipe-book);
and since module 0.39.0, for every campaign whose Gamemaster lets its players change their own
effects, under dnd5e, its other switches on or not, where the answer says `"effects": 1`, to turn
off, turn on and delete [their own effects](#a-players-own-effects); and since module 0.40.0, for
every campaign whose Gamemaster lets its players use Wild Shape from the app, under dnd5e, its other
switches on or not, where the answer says `"wildShape": 1`, for [Wild Shape](#wild-shape).
An answer to the campaign's hello
ends the wait the last fetch's answer asked for, so a fetch answered before the listener had taken
the hello is made again at once. Each campaign is fetched for in turn, one fetch after another:

```
POST <destination>/api/bridge/commands
Content-Type: application/json
Authorization: Bearer <the campaign's secret>

{ "protocol": 2, "session": "NXUK8rWJac7xwtdn", "campaign": { "id": "k3jd8s7aQ1pZ0vXe", "title": "Curse of Strahd" } }
```

Answer it as an event, CORS included, with the campaign's waiting rolls:

```json
{ "commands": [ { "id": "r1", "actorId": "aB3…", "kind": "skill", "key": "prc", "mode": 1, "explicit": true,
  "extras": [ { "sign": 1, "count": 1, "sides": 4 } ],
  "dice": [ { "faces": 20, "results": [17, 3] }, { "faces": 4, "results": [2] } ] } ], "wait": 10000 }
```

| Field | Meaning |
| --- | --- |
| `commands` | The rolls to make, oldest first; may be empty. |
| `wait` | How long to wait before fetching again, in milliseconds. Absent or `0`: fetch again at once. |
| `open` | Since module 0.27.0: the campaign's characters open in the app, by actor id, whose player's page asked for the table lately (the Sending Stone app: within 15 seconds), at most 200, each matching `^[A-Za-z0-9]{1,64}$`; may be `[]`. Send it in every answer. The module asks [Midi's saves](#midi-qols-own-saves) only of a character an answer within the last 45 seconds listed; one absent or not an array lists none, as from an older listener, and entries that aren't ids are dropped. A listener holding a fetch open may answer early, with no commands, when the list changes, so that the module learns of a character closed within seconds. |

Hold a fetch open, for up to 30 seconds, while a roll may come, so that it reaches the game at
once; and otherwise answer at once with a `wait`. The module gives a fetch up after 35 seconds.
After a failed fetch it waits 2 seconds, then twice as long after each failure in a row, up to a
minute, when it failed for a reason that may pass: `unreachable`, `timeout`, `unavailable` or
`rateLimited` (see [Refusals](#transport)), as with no answer, a `408`, `425`, `429` or `5xx`, or a
`200` that isn't JSON; the Gamemaster is told after three in a row. Any other refusal, such as a
`400`, `401`, `403`, `404` or `413`, stops fetching for the campaign until the settings change or
its hello is sent, and the Gamemaster is told. Before module 0.23.0, only a `401`, `403` or `404`
stopped it, and nothing was told.

**Hand each roll over once.** One whose answer is lost is lost: never a roll made twice. The
module also makes a roll only once, however often it's handed over, and a character's rolls in
the order they came; but for an answer to a [Midi prompt](#midi-qols-own-saves), made at once
(module 0.27.0), as Midi may be waiting on it inside the character's own roll before it.

| Roll field | Meaning |
| --- | --- |
| `id` | Unique to the roll. |
| `actorId` | The campaign's character it is for. |
| `kind`, `key`, `combatId`, `denomination`, `hitDice`, `item`, `activity`, `text`, `link`, `turn` | What is rolled, as above. |
| `mode` | `-1`, `0` or `1`: rolled with disadvantage, normally, or with advantage. |
| `explicit` | Did the player choose how, as in dnd5e's roll dialog? Then the game rolls it that way. Otherwise it rolls as the character's sheet has it, which is where the app's `mode` came from. |
| `extras` | What the player added, each `{ sign, count, sides }` or `{ sign, flat }`: such as `+1d4` for Bless. At most 10. Made as the roll's situational bonus. |
| `dice` | Every die thrown, in order: the d20s, one or two (`mode` not `0`), or since module 0.32.0 three for an `attack` with advantage whose sheet says [`elvenAccuracy`](#character-sheet), then each added term's dice; for a hit die, its one die; for hit dice, one entry per `hitDice` entry, in the same order, with `count` results; for a formula or a description's roll, each of its dice terms'. Each `{ faces, results }`, every result one of the die's faces. |
| `by` | `"gm"` for a roll the campaign's Gamemaster made in the app as the character (module 0.23.0), where the hello says `gmRolls`; absent for its player's, as is `null`. Anything else, or `"gm"` on an `endEnchantment`, since module 0.29.0 an `endConcentration` or since module 0.36.0 an `endTurn` or an `undoEndTurn`, or since module 0.37.0 a `favorite`, or since module 0.42.1 a `prepare`, none of which posts anything to mark as theirs, is refused (`"invalid"`, `error` `"by"`) with nothing posted. A `spend` and an `inspiration` may have it, and since 0.42.1 a `spellSlot`: their line is marked as the Gamemaster's, and since module 0.31.0 so may a `transfer`, and since 0.33.0 a `remove`, and since 0.34.0 a `note`. Any other kind may have it: an attack, a use, their damage, an ask and a prompt's answer too. |
| `of` | Since module 0.36.0, the campaign character whose [companion](#companions) the roll is for, `actorId` then being the companion's key: any kind among `features.companions.kinds`, never `inspiration`, `hitDie`, `hitDice`, `spend`, since module 0.42.1 `spellSlot`, `transfer`, `remove`, since module 0.37.0 `favorite`, `note`, since module 0.42.1 `prepare`, `endTurn` or `undoEndTurn` (a companion's turn is ended, and taken back, by its character's command), each refused `"invalid"`, `error` `"of"`, as is an `of` that isn't an id. Made only where the companion is `of`'s now, on its live actor, as `of`'s player, else refused `"unknown"`: a companion's key is never a character's, so a module before 0.36.0, which ignores `of`, refuses it `"unknown"` too. A companion's commands wait for its character's, and its character's for its own. Every message it makes is flagged `companion` with its key. Absent, or `null`, for the character's own. |
| `typed` | `true` where the player typed these dice in, from their own physical dice (module 0.32.0), as the app offers where their character's [`manualDice`](#character) is `true`. Anything else, or left out, is read as not, and never refused: it changes nothing of how the dice are used on its own; since module 0.42.0 `rerolls` beside it may. A module before 0.32.0 ignores it. Since module 0.33.0 a [`remove`](#removing-an-item) with it, as anything but left out or `null`, is refused (`"invalid"`, `error` `"remove"`): nothing is typed in for one. Every message the roll makes is then [flagged and marked](#making-a-roll) as typed; never a roll with `by` `"gm"`, whose mark it would hide. |
| `effectDice` | Since module 0.42.0, on a typed `skill`, `tool`, `ability`, `save`, `death`, `initiative` or `attack`, where `features.rolls.effectDice` says `true`: the values the player typed for the dice their character's effects add to the roll, as its sheet's [`effectDice`](#character-sheet) lists them, each `{ faces, sign, results }`, at most 10: `faces` a die a player rolls, never 20; `sign` `1` for a die added, `-1` for one taken away; and 1 to 20 `results`, each from 1 to `faces`. A die the player skipped is left out, for Foundry to roll; never an empty list. Anything else, or on another kind, is refused (`"invalid"`, `error` `"effectDice"`); `null` is read as none. Used only where `typed` is `true`, never with `by` `"gm"`, and where the self-test has checked it, and otherwise ignored; each value is [taken](#making-a-roll) by a die of the roll's own of its faces and sign. Never refused for what the sheet says: a value no die takes is dropped, and a die no value reaches is Foundry's. A die the sheet offers (`offer`) is never among them: the player adds it as one of the roll's `extras`. |
| `rerolls` | Since module 0.42.0, `"kept"` on a typed roll of any kind, where `features.rolls.keptRerolls` says `true`: its player rerolled at the table, as a Great Weapon Fighter or a Halfling would, and typed the die they kept, so each of the roll's own die terms they typed every die of [keeps no reroll](#making-a-roll). Read only where `typed` is `true`, never with `by` `"gm"`, and where the self-test has checked it. Anything else, or left out, is read as not, and never refused: Foundry rerolls as before. |

### Making a roll

The module makes the roll as dnd5e's roll dialog would, without it, as the character's player
(the user whose character it is, or else its only player), shown to everyone. Each die the roll
throws takes the next value the player rolled for a die of its faces: their d20s, then their added
dice. Only a die's first roll is the player's: a reroll, such as a Halfling's of a 1, or a die the
player didn't roll, such as a Bless the game applies, is Foundry's. Elven Accuracy's third d20 is
the player's where they sent three (module 0.32.0), and Foundry's otherwise. Where the built roll
throws fewer d20s first than the player sent, as an attack the game gives no Elven Accuracy after
all, the d20 values over are dropped before any die is thrown, so a d20 the player added keeps its
own value; where it throws more, as for advantage the app didn't know of, Foundry throws the rest,
unless the roll adds d20s of the player's own, whose values the next throws take first, so a
listener that sends two d20s for Elven Accuracy sends no added d20 with them. A die a formula's
own modifiers roll again is Foundry's too (module 0.22.0, which the self-test checks before
offering attacks): a term such as a Great Weapon Fighter's `2d6r<=2`, `1d6x` or `4d6kh3` throws its
number of dice first, the player's, `number` of them in its `dice`; a reroll (`r`, `rr`) or an
explosion (`x`, `xo`) is Foundry's, and what the term keeps, drops, raises, lowers or counts (`k`,
`kh`, `kl`, `d`, `dh`, `dl`, `min`, `max`, `cs`, `cf`), Foundry works out from those.
Foundry's total is the roll's total. The roll's message is flagged
`flags["sending-stone"].request` with the roll's `id`, and marked on its card.

Since module 0.42.0, for a roll its player [typed](#fetching-rolls), a die an effect adds is theirs
where they sent it in `effectDice`, by its faces and sign, after their own dice: a die of the roll's
own, outside any parentheses or function, of those faces, added or taken away as the value says; and
where they sent `rerolls` `"kept"`, each top-level die term they typed every die of has its `r` and
`rr` dropped before it's made, a Halfling's `r1=1` among them, so the die typed is the die kept, and
the card shows the roll without them; a term with a die the game throws, as a d20 a module's
advantage adds as the roll is made, keeps them. Its explosions (`x`, `xo`), and what it keeps,
drops, raises, lowers or counts, are as before.

Since module 0.36.0, a [companion](#companions)'s roll, named by [`of`](#fetching-rolls), is made on
the companion's live actor, a token's creature's own, as `of`'s player: authored by them, whoever
owns the creature in Foundry, and whether that roll is visible to them is read as theirs. Every
message it makes is flagged `flags["sending-stone"].companion` with the companion's key besides, so
that a listener places it however Foundry names its speaker. A use of a token's creature is made by
its own activity, its Self its own token. A legendary or mythic action with too few of the creature's
legendary actions left is refused `"legendary"` before anything is used, as dnd5e would refuse it,
one that costs none with none left among them; one whose own consumption spends the pool is left to
dnd5e. Under Midi-QOL, where Midi averages the creature's damage (its *Average damage* for every
actor or for the creature's type), a use's damage is Midi's own: nothing is due.

Since module 0.23.0, a roll the campaign's Gamemaster made in the app as the character, `by:
"gm"`, is made as any other, as the same user: its author, speaker, flavor and roll mode are the
player's, as dnd5e's *Challenge Visibility*, Midi-QOL and Dice So Nice expect, and what the app is
told is the same. Every message it makes is flagged `flags["sending-stone"].by` `"gm"` besides, and
its card's mark says "GM": the roll's own, a use's card, its damage, an ask's card, each hit die's
card, and under dnd5e 5.3 the message telling a death save's outcome, which dnd5e posts apart and
which is flagged `outcome` with the roll's `id`, never `request`. dnd5e 6 writes that outcome on the
roll's own card. Chat events send such a message with [`gmRoll`](#chat-message), and since module
0.25.0 the roll's [`command.result`](#commandresult) lists every such message it made, `messages`.

Since module 0.32.0, a roll its player typed in, [`typed`](#fetching-rolls) `true` and not `by`
`"gm"`, is made as any other, and every message it makes is flagged `flags["sending-stone"].typed`
`true` besides: the roll's own, an attack's card and its damage, each hit die's card, a
description's roll and damage, an answer to a [Midi prompt](#midi-qols-own-saves), and under dnd5e
5.3 the message telling a death save's outcome. Its card's mark is a keyboard, "Entered by hand on
Sending Stone", in place of the phone; the Gamemaster's mark wins. A use's card never has it, as a
use has no dice of its own.

Since module 0.32.0, a critical hit's damage made for the app, the player's and the Gamemaster's as
the character, an attack's, a use's and a description's, and every damage roll the module builds to
plan or preview one, is made as dnd5e's own rules make a critical hit's, whatever Midi-QOL's "Choose
critical damage" options say: each rolled die term's dice twice over, the item's critical extra dice
on the first; since module 0.33.0 never a number doubled, the ability modifier, a flat bonus or one
in parentheses, whatever dnd5e's *Critical Damage Modifiers*, Midi-QOL or the roll's own
`critical.multiplyNumeric` say (0.32.0 doubled them under either), and under dnd5e 6, which copies a
group in parentheses for a critical hit, the copy made of the group's dice alone, `(1d6 + 2) +
(1d6)`, and a function of dice whole, the function's dice thrown as many more times within it
instead, `floor((2d6 + 4) / 2)`; under *Powerful Critical*, its dice once, with the most they could
roll added as a number, never a number's (under dnd5e 6 a group's or a function's most is its
dice's); critical damage added
after, as it is, and marked as dnd5e 5.3 marks it under dnd5e 6 too, which doesn't, so that its dice
are `added` in a [preview](#attacks) and a die more never changes them; and never `mx`, `min`, `kh`
or `x` added for it. Midi-QOL's other changes to damage still apply, and its critical rules to the
Gamemaster's own rolls in Foundry, which the app makes none of. So `1d6 + 4` is thrown as `2d6 + 4`,
under Midi as without it, and under *Critical Damage Modifiers* too since module 0.33.0, and the
sheet's [`critical`](#character-sheet) says so.

It then sends [`command.result`](#commandresult). A roll made blind, as Midi-QOL can make a
player's check, is reported as made, with `visible: false` and no rolls, so that the app tells
its player no more than Foundry would.

Before offering rolls, the module checks, as the game loads, that the player's dice reach a roll
made for them and only that roll. If they don't, its hellos say `"self-test"`, and Manage
Campaigns says why.

### Hit dice and formulas

Since module 0.16.0 a player can spend a hit die in the app, as on a short rest, and since module
0.20.0 several at once; and roll a utility's own roll, such as a d4 of luck, which dnd5e's card
offers as a button once it's used; and have them made in the game with the dice they rolled. None
is rolled with advantage, or has anything added: `mode` is `0`, `explicit` `false` and `extras`
empty.

Since module 0.40.0, while the character is in Wild Shape (to a listener that says `"wildShape": 1`),
these act on the form's copy, and what they spend is carried back on the return (see [Wild
Shape](#wild-shape)).

```json
{ "id": "r2", "actorId": "aB3…", "kind": "hitDie", "denomination": "d10", "mode": 0, "explicit": false,
  "extras": [], "dice": [ { "faces": 10, "results": [7] } ] }
```

```json
{ "id": "r4", "actorId": "aB3…", "kind": "hitDice",
  "hitDice": [ { "denomination": "d10", "count": 2 }, { "denomination": "d8", "count": 1 } ],
  "mode": 0, "explicit": false, "extras": [],
  "dice": [ { "faces": 10, "results": [7, 3] }, { "faces": 8, "results": [4] } ] }
```

```json
{ "id": "r3", "actorId": "aB3…", "kind": "formula", "item": "fE7…", "activity": "uT1…", "mode": 0,
  "explicit": false, "extras": [], "dice": [ { "faces": 4, "results": [3] } ] }
```

- **A hit die** names its size, `denomination`, as a class's `hitDice` `die` on the sheet has it,
  and has the one die of that size. dnd5e spends it, as its rest dialog would, from a class with
  one of that size left, and heals the character the die and their Constitution modifier, at least
  1 under the modern rules, or 0 under the legacy ones (the sheet's `rules`), up to their maximum.
  dnd5e's roll keeps the die inside a `max`, out of a player's die's reach, so the module writes it
  with the die outside, coming to the same: `1d10min4 - 3` for `max(1, 1d10 - 3)`; a die raised so
  shows the face rolled. `command.result` adds `healed`, the hit points it gained: `0` where a
  module kept dnd5e from healing. Refused: `"no-hit-dice"` for a size the character has none of
  left, before dnd5e would tell the Gamemaster so. Hit dice are offered once the self-test has
  checked that a hit die takes the player's die and comes to dnd5e's total; if not, the hello
  leaves `"hitDie"` out of `kinds`, and one fetched anyway is refused as `"self-test"`.
- **Several hit dice**, since module 0.20.0, are one command, `"hitDice"`, offered wherever
  `"hitDie"` is and refused as `"self-test"` where it isn't. It names no `denomination` (else
  `"invalid"`, `"denomination"`), but each size and how many of it, `hitDice`: one to seven entries
  `{ denomination, count }`, each size once, at most 20 dice in all (else `"invalid"`,
  `"hit-dice"`); and has a `dice` entry for each, in the same order, of that size, with `count`
  results (else `"invalid"`, `"dice"`). They're checked before any is spent: refused as
  `"no-hit-dice"` where the character hasn't that many of each size left, those of every class with
  that size together, or an NPC more than its own; and as `"full-hp"` where the character is at full
  hit points, as a hit die alone isn't. The module then spends them as dnd5e's short rest does, one
  die at a time, each as a hit die above, with a card of its own, flagged with the command's `id`
  and marked: `hitDice[0]`'s dice in the order of their results, then `hitDice[1]`'s, and so on.
  They stop before the next die once the module has reported them as taking too long (`"timeout"`),
  once the character is at full hit points (`"full-hp"`), as dnd5e stops spending them on a rest, or
  has none of the next size left (`"no-hit-dice"`); and at a die that's called off (`"cancelled"`,
  or `"dice"` as below), or after one a module kept dnd5e from spending, which posts its card but
  spends nothing (`"cancelled"`). `command.result` has [`spent`](#commandresult), how many were
  asked for and made; and `healed`, `rolls`, every roll of every card, and `messageId`, the last
  card, for all of them. Hit dice that stopped part way are `"failed"`, with the reason they
  stopped, and still have those for the dice made, where any were. Each die takes the player's die
  rolled for it and no other: a die a module adds to its roll, or to its card as a roll of its own,
  of that size or another, is Foundry's, and heals as dnd5e has it.
- **A formula** names the `item` and `activity`, as for a [use](#spells-and-features): a utility
  activity with a `rollFormula` on the sheet, or a Cast activity whose spell's first activity is
  one. It has the dice the formula throws: one `{ faces, results }` for each of its dice terms, in
  order, with as many results as the term has dice. It's rolled as the card's button rolls it,
  without its dialog, as the character's player, its card naming none of the Gamemaster's targets;
  even with Midi-QOL, it's the roll alone. Refused: `"item"` for no such item, one not
  identified yet, or a spell an item casts while the item can't cast it; `"activity"` for no such activity, one without a roll of its own, or one whose
  formula has a die no player rolls, such as a d3, or dice inside parentheses or a function; and
  `"dice"` for dice that aren't the ones its formula throws.

A module may change any of these rolls before it's made, as dnd5e's hooks allow, each of several
hit dice too. Where the player's dice can then no longer reach it, as inside a function, the roll
is called off, nothing is spent or healed, and it's refused as `"dice"`; for several hit dice, that
die, after those spent before it, which stand. Dice a module adds are Foundry's.

### Attacks

With **Attacks, spells and features** also ticked for the campaign, a player's
weapon and spell attacks in the app are made in the game too, and so are the spells and features
they use, as [below](#spells-and-features). The item is used as in Foundry, spending what it
spends; the attack is made at the target the player picked, with their d20s; and then, once they
roll it, its damage, on the same use, with their dice. It takes two rolls, an `attack`, then its
`damage`:

| Roll field | Meaning |
| --- | --- |
| `kind` | `"attack"`. |
| `item`, `activity` | The item and its attack activity: an action's `id` and `attackId` in the sheet, or a spell's, feature's or inventory item's, or an activity favorite's `itemId` and `attackId`; or the item's `id` and the `attackId` of any of its `activities`. |
| `target` | `{ combatId, combatantId }`: the combatant attacked, in a combat its player can see; or `null`. |
| `targets` | For an attack with an `attackArea` (module 0.16.0), in place of `target`: the combatants in its area the player picked, each `{ combatId, combatantId }`, in one combat its player can see: up to 20, none twice, and no more than its `count`, at the level it's cast at; empty for none. An attack at one target with `targets` is refused (`"target"`), and one with both is `"invalid"`. |
| `slot` | Optional: the spell slot a spell is cast with, such as `"spell3"` or `"pact"`, as a `spells` section's `id`. For a spell cast from an item, since module 0.20.0, the level it's cast at, `"spell"` and one of its `cast`'s `levels`' `level`, such as `"spell2"`, or for its copy's activities its Cast activity's; never `"pact"`. |
| `ammunition` | Optional: the `id` of the ammunition fired, one of the action's `ammunition`. |
| `attackMode` | Optional: the attack mode, one of the action's `attackModes`' `value`, such as `"twoHanded"` or `"thrown"`. |
| `mode`, `explicit`, `extras`, `dice` | As for a check: the d20s, then the dice the player added. |

| Roll field | Meaning |
| --- | --- |
| `kind` | `"damage"`. |
| `use` | The `id` of the attack, or [use](#spells-and-features), it follows. |
| `dice` | The dice the attack's `command.result` said its damage throws, in order, each `{ faces, results }`. None when it said they can't be planned, or there are none. |
| `types` | Optional: for each of the damage's rolls, by its place among them, the kind of damage chosen, as one of that roll's `types`' `key`, or `null`. A roll with no choice made is rolled as the kind last rolled, as dnd5e does. |
| `modifiers` | Optional, where the hello says `modifiers`: `{ extra, faces, maximize }`, how the player changed the damage in the app, each optional. `extra` more of its first roll's first die, up to 40, as many more as that roll's `perDie` for each; `faces` that die another size, `4`, `6`, `8`, `10` or `12`, as a versatile weapon's or Toll the Dead's; `maximize` every die at its highest, the game's own too, but since module 0.22.0 never for damage with a die Foundry would roll again at its highest, one that explodes (`x`, `xo`) or rerolls on its highest face, such as `1d6r6` (`"invalid"`, `"modifiers"`). `dice` are then the changed ones. |

**The attack.** The module uses the activity as dnd5e's usage dialog would, without it: with the
spell slot, ammunition and attack mode the player chose, or else the dialog's own: the spell's own
spell slot, or else the first with any left at a higher level; the ammunition and attack mode last
used. What it can't spend is refused, rather than said on the Gamemaster's screen. Then:

- **dnd5e's cards.** Without Midi-QOL, or with Midi's *Replace Default Activities* off, dnd5e's
  own cards are posted, as the character's player: the use's card, naming the target, then the
  attack, linked to it.
- **Midi-QOL's workflow.** Where Midi's activities make each use a workflow, the attack goes
  through the workflow, as if the player had attacked in Foundry: Midi checks the hit and, once
  the damage is rolled, applies it, as the Gamemaster has it set up. The card is the
  Gamemaster's, spoken as the character, since Midi asks a card's author to confirm and apply.
  While the attack is rolled, the Gamemaster's targets are the player's target; then they're put
  back. Midi uses are made one at a time. With **Make Players' Attacks and Spells Through
  Midi-QOL** off, attacks and uses aren't offered.

**An area attack**, such as a breath weapon's cone, is made since module 0.16.0 at the `targets`
the player picked, without placing a template, as an area's use is: with one attack roll, one set
of d20s and one piece of ammunition, and against no armor class where it has more than one target,
as dnd5e makes it. On dnd5e's cards, the card, the attack and its damage name every target, and the
Gamemaster applies the damage to those hit, as in Foundry. Through Midi's workflow, the
Gamemaster's targets are the player's while it's made; Midi checks the hit on each, and applies the
damage to those hit. An area Midi targets itself, as it uses the activity, is refused (`"area"`):
one around its user, such as a radius from *Self*, which Midi places and targets those in, unless
its auto-targeting is off, or one it targets around its user without a template. With its
auto-targeting off, Midi still draws its own template around the user for such an area, as it does
when it's used in Foundry, though the targets are the player's. Before module 0.16.0, every area
attack was refused.

Refused beforehand, rather than have the Gamemaster asked: an area attack Midi-QOL targets itself,
as above (`"area"`); a spell slot the usage
dialog doesn't offer, or with none left, as for a spell cast from an item a level the dialog
doesn't offer for its Cast activity, or any for a cantrip (`"slot"`); ammunition that isn't the weapon's, or is used
up (`"ammo"`); an attack mode that isn't the weapon's (`"mode"`); Midi's Active Defence; a reaction
or bonus action Midi enforces that's been used; an activity that always opens Midi's roll, consume
or damage dialog, or has Midi ask which effects to apply; and a target Midi can't target, or no
target where Midi needs one. Midi targets only tokens the Gamemaster's canvas draws, on the level
and scene they're viewing: any other is refused (`"scene"`), unless the Gamemaster turns on
**Allow targets off your screen**. Then the use is made; Midi works only on the targets it can
see, and the card names every target, for the Gamemaster to apply the rest. Its user, picked with
[`self`](#spells-and-features), is always treated so, whatever the setting, as such a use was made
at no one before module 0.22.0. What's left may ask
the Gamemaster, as it would in Foundry, such as a target's reaction; an attack made after its
`"timeout"` is reported again.

`command.result` for an attack adds:

| Field | Meaning |
| --- | --- |
| `attack` | `{ critical, fumble, outcome }`, when `visible`. `outcome` is `"hit"` or `"miss"` at its target, given only where the game shows players whether an attack hit: dnd5e's *Attack Result Visibility* not *Hide all*; Midi's *Auto Check Hits* showing hits to all, and not whispered as the Gamemaster's own rolls are when private. Since module 0.31.0, with **Hit/miss and save results in the app** Always, given whatever those show: through dnd5e, under *Hide all* too; through Midi, as Midi checked it whatever it whispers, and where its *Auto Check Hits* is "None", judged against the armor class Midi writes on its card for each target, a target the card doesn't name telling nothing. Otherwise `null`. A target under total cover is missed. The target's armor class is never sent. An area attack also has `targets` (module 0.16.0): each `{ combatId, combatantId, outcome }`, in the order picked, its `outcome` given as above, and `null` for a target Midi didn't check, not being on the Gamemaster's canvas; `outcome` is then the one target's, or `null` for several or none. Its targets' names and armor classes are never sent. |
| `damage` | The dice the attack's damage will throw, for its player to roll: `{ critical, plannable, healing, rolls: [{ formula, type, types, dice: [{ faces, number, added?, subtracted? }], perDie }] }`, as dnd5e will make up its rolls, with a critical hit's dice, its extra dice and its critical damage's among them; the dice a critical hit adds as terms of their own have `added: true` (module 0.20.0): its critical damage's, which dnd5e adds after the roll's own, and the copies Midi-QOL's rules that throw a critical hit's dice apart place beside each die; its extra dice, such as Savage Attacks', are counted in its first die's `number`, and the roll's own dice never have `added`. Since module 0.21.0 the dice the damage takes away, as Reduce's or Ray of Enfeeblement's −1d4, are marked `subtracted: true`, as dnd5e reads a roll's signs when it adds damage up: `+` and `-` part its terms, each `-` turns the sign over, and `*`, `/` and `%` keep terms together; a die may be both `added` and `subtracted`, as Midi's copies placed after a `-` are, in the order `faces`, `number`, `added`, `subtracted`; left out otherwise. A roll's `perDie` is how many dice it throws for each die of its own: `1`, or on a critical hit as many as this world's rules make of each, such as `2`; module 0.13.0. `plannable` is `false` when a die can't be known beforehand, such as a d3, or a die inside parentheses, as Foundry's parser may put a leading `-1d4`: the game then rolls all of them, and since module 0.21.0 not at their highest where the roll's `formula` takes a die away (see [changed damage](#attacks)). `healing` is `true` for healing. A roll's `types`, `[{ key, label }]`, are the kinds of damage its roller chooses among, as Chromatic Orb's, or `null` for none. `null` when no damage follows, as when Midi's workflow ends at a miss. |

**The damage** is rolled on the attack's use: on dnd5e's cards, a damage roll linked to the use's
card; with Midi, into the workflow waiting for it, which then applies it. Its dice must be the
ones the attack said, its kinds of damage ones its rolls offer (`"type"`), and a use takes one
damage roll. It's rolled without dnd5e's damage dialog, even where Midi would open it for a choice
of damage types. The use's card is flagged `flags["sending-stone"].use` with the attack's `id`,
and keeps what its damage needs, so that it can be rolled after the game is reloaded, except into
a Midi workflow, which lives only in the Gamemaster's browser. Dice the game adds, such as Midi's
bonus damage, are Foundry's.

**Changed damage.** Where the hello says `modifiers`, a player may change their damage as dnd5e's
damage dialog would let them: more of its first roll's first die, as a spell cast higher has; that
die another size, as a versatile weapon or Toll the Dead has; or every die at its highest. The
first die is the first roll's first die that is neither `added` nor `subtracted`: never one of a
critical hit's critical damage, which dnd5e adds as it is, nor, since module 0.21.0, one the damage
takes away, as Reduce's −1d4, on which dnd5e itself never places the dice it adds, a critical hit's
extra dice, a spell's scaling or a versatile die, though a critical hit doubles it as it does every
die; a first roll with neither has none to change. It's changed before it's rolled, and a critical
hit's dice made again, as this world makes them, so the player throws `perDie` more dice for each
they add; dice that aren't those changed ones are refused (`"invalid"`, `"dice"`), as are changes
the module can't read (`"invalid"`, `"modifiers"`). Damage at its highest is rolled so, every die
at its highest, Foundry's own too.
Since module 0.21.0, damage that takes any die away is not rolled at its highest, which would take
the most away (`"invalid"`, `"modifiers"`). Damage whose dice can't be planned has none marked: it
takes one away where a roll's `formula` has a die in a group of terms that comes out negative, read
as dnd5e reads signs, at each depth of parentheses, a function's among them: a `-` between two
terms starts a group taken away, and any other `-`, as one leading or after `*`, `/` or `%`, turns
its group over; so `1d3 + 3 - 1d4` and the `(1d4 * -1) + 2d6` Foundry's parser may make of a
leading `-1d4` take a die away, and `1d3 - 1` and `- - 1d4` don't. A listener reads it so too.
Since module 0.19.0 a [description's damage](#descriptions-that-roll) may be changed the same way.
Since module 0.20.0, damage that, once built and changed, can't take every die the player rolled,
at least as many of each size, as where a module changed the activity since its preview, is called
off before it's rolled and refused (`"invalid"`, `"dice"`): nothing is posted, the use's damage
isn't spent, and Midi's workflow still waits for it, so it may be rolled again. Only the first
damage roll made with the player's dice is changed and checked; another, as Midi's other damage,
is left as it is.

Players' attacks are offered once the self-test has also checked that the player's dice reach an
attack's damage. If they don't, attacks and uses stay in the app, and the campaign's Player actions tab says why.
The self-test then checks that a critical hit's damage with a die more, made another size, throws
the dice it should, with extra dice and critical damage of a die too since module 0.20.0, whose die
is never the one changed, and damage that takes a die away since module 0.21.0, whose die taken
away is never the one changed, that damage whose only die is its critical damage's, or one it takes
away, has none to change,
and that damage at its highest is; if not, the hello says `modifiers` is `false`, and players'
damage is rolled as it is.

### Spells and features

With the same option, a player's other uses of a spell or feature are made in the game too, at the
targets they picked: a saving throw's, such as Fireball or Sacred Flame; damage alone, such as
Magic Missile; healing, such as Cure Wounds or Second Wind; anything else, such as Bless, Shield
or Action Surge; and since module 0.21.0 a check activity's, such as Fast Hands' Sleight of Hand or
Maze, and a forward's, such as a spell's free casting. The item is used as in Foundry, spending what
it spends, and its damage or healing, if any, is rolled once the player rolls it, as an attack's:

| Roll field | Meaning |
| --- | --- |
| `kind` | `"use"`. |
| `item`, `activity` | The item and the activity used: an action's `id` and its `activity`'s `id` in the sheet, or a spell's, feature's or inventory item's, or an activity favorite's `itemId` and `activity`'s `id`, or the item's `id` and the `activity`'s `id` of any of its `activities`: a `save`, `damage`, `heal` or `utility` activity, or since module 0.15.0 a Cast activity whose spell's first activity is one, or since module 0.21.0 a `check` or `enchant` activity, or a forward used through any of them but an `enchant`. |
| `targets` | The combatants it's used at, each `{ combatId, combatantId }`, in a combat its player can see: up to 20, none twice, and no more than its `count`, at the level it's cast at; none for one used on its user alone. Empty out of combat. |
| `slot` | The spell slot a spell is cast with, as for an attack; or `null` for the usage dialog's own. For an activity used without spending a slot (`consumesSlot` `false`), the level it's used at, as that slot's: one with none left too, since none is spent. For a spell cast from an item, the level it's cast at, as for an attack (module 0.20.0). Ignored for a forward, which spends none and is cast at the level dnd5e casts it at (module 0.21.0); a spell's check activity that doesn't cast it is used at it, as any marked `consumesSlot` `false`. |
| `self` | Optional, since module 0.22.0, where the hello says `selfTargets`: `true` to use it at its user too, beside the `targets`, counted among them toward its `count`: at their own combatant's token in the combat the Gamemaster has up, or else at their token on the scene the Gamemaster views, or else at the character alone, whom the card names all the same. Ignored for one used on its user alone, which is used at them anyway. `false`, `null` or left out for not. Anything else, or `self` on an attack, is refused (`"invalid"`, `error` `"self"`); their own combatant among the `targets` too, more than its `count` with them, or an enchant activity (`"target"`). With Midi-QOL, a user whose token the Gamemaster's canvas doesn't draw, or who has none, is named on the card alone, whether or not targets the Gamemaster isn't viewing are allowed, and Midi uses it at the other `targets`, or at no one; it's refused (`"scene"`) only where Midi then needs a target. |
| `enchant` | For an enchant activity, since module 0.21.0: `{ profile, item }`, the profile chosen, one of its `enchant`'s `profiles`' `id`, and the item it enchants, one of its `items`, left out to leave it on the card, and never for one that enchants its own item. See [Enchantments](#enchantments). On anything else, refused (`"invalid"`, `error` `"enchant"`). |

A use has no dice. The module uses the activity as an attack's, without placing a template: an
area's targets are those the player picked. Then:

- **dnd5e's cards.** The use's card is posted as the character's player, naming the targets, its
  user among them where the player chose `self`, or its user for one used on its user alone. The
  Gamemaster rolls the targets' saving throws and applies the damage, healing and effects from it,
  as in Foundry; the player's damage or healing is rolled linked to it.
- **Midi-QOL's workflow.** The use goes through Midi's workflow at the targets the player picked,
  which roll their saving throws as Midi has them roll, and which it applies the damage, healing
  and effects to. While it's used, and while an area's damage is rolled, the Gamemaster's targets
  are the player's targets; then they're put back. A utility's own roll, such as a formula, is
  Midi's. Since module 0.27.0, a use with no attack, damage or healing, such as Hold Person, is
  made, and its `command.result` sent, once its workflow waits on the app for a target's
  [save asked there](#midi-qols-own-saves), rather than once its saves are in: the targets are
  Midi's by then, and other Midi uses from the app aren't held behind it for that save's minute.

A spell cast from an item, by its Cast activity's id, is cast as dnd5e's Cast activity casts it:
through the activity of the copy of the spell dnd5e keeps for it, at the level the Cast activity
casts it at, spending the item's uses, or the activity's, rather than a spell slot. The card is the
spell's. dnd5e's `dnd5e.preUseLinkedSpell` and `dnd5e.postUseLinkedSpell` hooks are called, as
they are when it's cast in Foundry: the first before anything of the use is worked out, so that
what a module changes of how it's used, such as what it spends, holds; a module that stops it
with the first makes the use fail (`"cancelled"`), and a use it lets go ahead may still be
refused after it. An attack spell, such as Starry Wisp, is cast so with an attack. One the item
can't cast now, such as one the character must attune to and hasn't, or whose spell dnd5e hasn't
copied yet, is refused (`"activity"`), as is the copy of the spell itself, cast from the spellbook,
while the item's Cast activity can't be used (`"item"`).

Since module 0.20.0 one whose `cast` has `levels` is cast at the level its `slot` names, one of
them, or else at the first, `cast`'s own: the item's uses it spends are scaled for that level, as
the level's `charges` say, and its targets and damage as dnd5e scales them. A listener sends a
`slot` for a spell cast from an item only from its `cast`'s `levels`. A level dnd5e's usage dialog
doesn't offer for the Cast activity, such as one the item's charges no longer allow, or any for a
cantrip, is refused (`"slot"`), as is a slot other than its own level for a `cast` without
`levels`, where the dialog offers no other; one the dialog offers but the item hasn't the uses for,
as a level whose `charges` are `short`, or one left out of `levels` for costing more than the item
ever has, is refused as spending more than is left (`"consume"`). dnd5e's
`dnd5e.preUseLinkedSpell` hook is told the level as dnd5e's usage dialog tells it, `spell.slot`,
such as `"spell2"`, and `scaling`, the levels above the spell's own; a module's change to them
holds, and isn't checked again, and what's spent is worked out for the slot it leaves. A Cast activity above its spell's own level, as
a wand of fireballs at 4th, costs what dnd5e charges for it: its cost scaled by the levels above
the spell's, where it scales, which before module 0.20.0 was refused only as the use was made
(`"cancelled"`) rather than beforehand (`"consume"`). Cast higher still, its cost and a count of
targets written with the spell's level grow, but its damage stays at the Cast activity's level, as
dnd5e scales the copy.

The copy's other activities, such as Hex's Bonus Hex Damage once it's cast from an item, are used
by the copy's `id`, its Cast activity's `spellId`, and the activity's own `id`, as the Spells tab
lists it, as since module 0.15.0. They're used at the level a `slot` names as the Cast activity is,
one of its `cast`'s `levels`, or else its own; each spends the item's uses again, scaled, as dnd5e
spends them, unless it's marked `consumesSlot` `false`, when it spends nothing at any level the
Cast activity offers, even one whose charges are `short`. As dnd5e's spellbook uses them, they call
neither of the Cast activity's hooks.

Since module 0.21.0 a check activity is used as a save activity is: its card is posted with dnd5e's
button for each check it calls for, for the table to roll, or with Midi-QOL, for its targets to roll
as Midi has them roll it, with Foundry's dice: a skill's where it names only skills, a tool's where
it names only tools, the first it names where it names both, a tool item's own tool where it names
none, otherwise an ability check; its card's buttons as Midi's settings show them. It spends what
dnd5e spends, such as the Manacles' use or Maze's slot, and begins concentration where it takes it.
The character's own check is [rolled apart](#descriptions-that-roll), spending nothing, as the
card's button rolls it. A leveled spell's check with no activation of its own, marked `consumesSlot`
`false`, as the 2014 Entangle's Escape Plants and Silent Image's check, is used without spending a
slot, as a player in Foundry would use it, unticking the slot, at the level of the `slot` sent for
it, one with none left too, which its card names, or with none sent at the spell's own; one dnd5e's
usage dialog doesn't offer is refused (`"slot"`). With Midi-QOL, one Midi would have its own user
make, at its user alone or a tool's with no kind of target, is refused (`"activity"`), since Midi
would roll the player's check with Foundry's dice; and one at targets needs them where Midi's
*Requires Targets* says, as a save does (`"target"`). Under dnd5e 6 none is used (`"activity"`).

Since module 0.21.0 a forward is used as dnd5e uses it: by the forward's `id`, the activity it's
used through is used, with the forward as its cause, spending what the forward spends, such as a
spell's use a day, in place of what that activity spends, and never a slot. A `use`, `attack` or
`formula` names it as the kind of activity it's used through. The card is that activity's, its
`system.cause` the forward, and its attack and damage are that activity's, rolled with the player's
dice. A spell is cast at the level dnd5e casts it at by default with the forward as its cause, the
spell's own, or for a Pact Magic spell, as dnd5e has it, its pact slots', to which it's scaled; a
`slot` sent for it is ignored, never refused, so no free casting is cast higher. With Midi-QOL, the
activity is used through Midi's workflow as dnd5e's forward has it used, the forward its cause. A
forward the sheet leaves out as a repeat of an earlier one is used as any other, by its `id`.
Refused (`"activity"`) where the forward or the activity can't be used, where it's used through
anything the app doesn't use, such as a Cast activity, a summoning, a transformation or an
enchantment, or a spell's check with no activation of its own, which a free casting would spend its
use on without casting the spell; through a chain that goes round, is broken, runs on past ten or
passes an activity or forward the player can't see; and where it lets its level be chosen; and
(`"consume"`), with nothing spent, where what it spends isn't left.

Refused beforehand, beyond what an attack is: an activity of another kind (`"activity"`), such as a
summoning, which dnd5e would ask the Gamemaster about; more targets than it takes, its user among
them, or any for one used on its user alone (`"target"`); and, with Midi, a utility whose roll
prompts for its formula (`"midi-dialog"`).

`command.result` for a use adds:

| Field | Meaning |
| --- | --- |
| `use` | `{ type }`: the kind of activity used, `"save"`, `"damage"`, `"heal"` or `"utility"`, or since module 0.21.0 `"check"` or `"enchant"`; for a forward, that of the activity it's used through. |
| `damage` | The dice its damage or healing will throw, as for an attack, never a critical hit's; or `null` when none follows, as for Bless, or where Midi rolled it itself. |
| `enchantment` | For an enchant activity's use, as [below](#enchantments). |

#### Enchantments

Since module 0.21.0 an enchant activity whose `activity` the sheet sends, as [above](#what-an-item-rolls):
one used by an action of some kind, not a choice made once nor a magic item's template, with a
profile to apply, is used with `kind` `"use"`, as any other, at no one, and `enchant`,
`{ profile, item }`: the profile chosen, offered at the level it's cast at, its `slot`'s for a
leveled spell, or for anything else, a scroll's included, the character's or a class's level now;
and the item it enchants, if any, one of its `items`, as dnd5e's `canEnchant` takes it. One the
sheet sends no `activity` for, as a magic item's template, is refused `"activity"` if a command
names it anyway: it's used in Foundry alone. The module uses it as dnd5e does, its usage dialog never opened: spending what it spends, such as a
slot, a use of Channel Divinity or a dagger's use a day, and beginning concentration where it takes
it; and posts its card, with dnd5e's tray and the profile chosen, as the character's player. Then:

- **An item chosen.** The enchantment is applied to it as the tray applies it, tied to the
  concentration the card names, which ends it when it ends, or to none where the card names none,
  as when concentration is turned off or a module stopped it; its riders, such as Pact of the
  Blade's attack or True Strike's, are added as dnd5e adds them, from the card. dnd5e's rules for
  the item are checked again as it's applied, with no dialog. One the item no longer may take, a
  module stopping it through dnd5e's hooks, or a card for another profile, is left on the card, for
  the Gamemaster to apply from it, spent: `"enchant"`, with the card's `messageId`. One whose card
  names a concentration that has since ended, as when something else ends it as it's used, isn't
  applied either, nor can it be from the card, which dnd5e then shows no tray on, its tray refusing
  it: `"enchant"`, spent, with `messageId` `null` and `visible` `true`.
- **On its own item.** One that enchants its own item, as Engulf in Flames, is applied to it as dnd5e
  applies it, in place of one it carries with another profile. Used with the profile its item
  carries already, chosen or dnd5e's own, it's refused beforehand, spending nothing
  (`"applied"`): dnd5e's would put it out instead, at the cost of what it spends, such as a Dagger
  of Venom's one use a day, and a listener sends such a use only from a sheet that's out of date. A
  switch's (`toggle`) end is sent as `endEnchantment`, which spends nothing, and so is a
  non-switch's.
- **No item.** The card is posted with its tray, for the Gamemaster to apply it, as to an ally's
  weapon: done, with `enchanted` `null`.
- **No card.** Where a module stops dnd5e posting its card, as through `dnd5e.preCreateUsageMessage`,
  nothing is applied, since the riders an enchantment adds are found from its card: `"enchant"`,
  spent, with `messageId` `null` and `visible` `true`.

Cast again on an item that carries its enchantment already, as Magic Weapon at a higher level, an
activity replaces it, rather than stacking another, as `ended` says. That's the module's choice:
dnd5e would apply a second Shillelagh beside the first. What's tied to the concentration the use
ends goes with it too, as dnd5e has it, and the module waits until it's gone before applying the
new one, as a scroll of Magic Weapon read while concentrating on the spell's +1 on the same sword
makes it +2. The item may take it as it would without them both, which the 2014 Magic Weapon makes
magical. Ending the concentration it was tied to, as casting another concentration spell does, ends
it too, as dnd5e has it, which the sheet then shows, as it does one deleted in Foundry, such as by
Times Up or the Gamemaster.

With Midi-QOL it's used through Midi's workflow, at no one, as a use is, and applied once the
workflow is done, tied to the concentration Midi begins once its checks pass and names on the card.
One that needs concentration Midi never began, as where its checks stopped the workflow first, is
used but not applied (`"midi"`, with the card's `messageId` while it's there), so that no
concentration spell's enchantment is left that never ends; the card's tray is left for the
Gamemaster. One whose card names a concentration that has since ended is used but not applied
either (`"midi"`), with `messageId` `null` and `visible` `true`, as dnd5e shows that card no tray.
One that needs none is applied as the tray would let its player. One whose card Midi deleted, as on an abort, has `messageId` `null`. One Midi
applies itself is reported, not applied again; and one at a creature, such as Sequester, needs a
target where Midi's *Requires Targets* says, so is refused beforehand (`"target"`). Midi's enchant
activity's own source isn't to hand: whether it ever applies the enchantment itself, and how it
treats one that needs no target where *Requires Targets* is `"always"`, are checked in a live game.

Refused beforehand, spending nothing: a profile not offered at the level it's cast at, or none
offered (`"profile"`); an item for one that enchants its own, or one that isn't the character's, or
that dnd5e's rules don't let take it now, such as a magical weapon for Magic Weapon
(`"enchant-target"`); the profile its own item carries already (`"applied"`); and any targets
(`"target"`). A use of an enchant activity without `enchant`, as a listener before 0.21.0 would
send, is used with dnd5e's own choice, the profile its own item carries, if offered, or else the
first, at the level it's cast at, and no item: refused (`"applied"`) where that's the one its own
item carries.

A listener ends an enchantment with `kind` `"endEnchantment"`, among the `kinds` wherever `"use"`
is, with `mode` `0`, `explicit` `false` and no `extras` or `dice`:

| Roll field | Meaning |
| --- | --- |
| `kind` | `"endEnchantment"`. |
| `enchantment` | `{ item, effect }`: the item's `id` and the enchantment's, as the item's `enchantments` list it, one that's `endable`. |

It's deleted as the ⟲ on dnd5e's card deletes it, whatever it was tied to, such as a concentration,
going on; what it added, such as a rider's attack, goes with it, as dnd5e has it. As in Foundry,
where an item's owner may end any enchantment on it, a player may end one another character
applied to their character's item, such as an ally's Magic Weapon on their club, the ally's
concentration going on. Refused where the item isn't the character's (`"item"`), or the effect
isn't one the item's `enchantments` list as `endable` (`"enchantment"`): a magic item's
template's, a choice made once, one whose activity is gone that lasts for good, one hidden on an
item not identified yet, or the changes dnd5e makes to the copy of a spell an item casts; and, as a
use is, where the campaign doesn't take attacks and spells. One already gone as it's ended, as
with its concentration, is ended all the same. It has no card: `messageId` is `null`, `visible`
`true`.

`command.result` for either has `enchantment`, `{ enchanted, ended }`:

| Field | Meaning |
| --- | --- |
| `enchanted` | The enchantment applied, `{ item, itemName, effect, profile, name }`: the item's `id`, its name as its player knows it, without its enchantments, such as `"Longsword"`, or for one not identified yet the name dnd5e gives it then, such as `"Strange Sword"`; the enchantment's `id` on it, its profile's `id` and its name, such as `"Magic Weapon, +1"`; or `null` for none, as one left on the card, or ended. |
| `ended` | The enchantment ended, `{ item, itemName, effect, name }`: one ended from the app, or replaced, or gone with the concentration the use ended, the first of them; or `null`. |

A use of an enchant activity has `use` `{ type: "enchant" }`, `damage` `null` and no `rolls`; one
that failed once used, `"enchant"` or `"midi"`, has `enchantment` `null`.

### Concentration, charges and Heroic Inspiration

Since module 0.29.0 a player can end a concentration of their character's, spend their charges
directly, and use or gain Heroic Inspiration, and since module 0.42.1 spend one of their spell
slots, or restore one, from the app, as they would on dnd5e's sheet. None of
them is a roll: each is sent with `mode` `0`, `explicit` `false` and no `extras` or `dice`, names
exactly its own field below, and none of `item`, `activity`, `target`, `targets`, `self`, `slot`,
`enchant`, `prompt`, `text`, `link` or `key`; otherwise it's `"invalid"`, with `error` its own
field's name, or `"dice"` for one that throws dice. Each goes in the character's turn, as their
rolls do, and the character's sheet as it then stands is sent ahead of the
[`command.result`](#commandresult), in [`character.updated`](#characterupdated): the result says
nothing new of what changed, the sheet does.

Since module 0.40.0, while the character is in Wild Shape (to a listener that says `"wildShape": 1`),
these act on the form's copy, and what they spend is carried back on the return (see [Wild
Shape](#wild-shape)); the character's own resources aren't on the form, whose sheet lists none. A
concentration ended while the character is transformed is ended on both copies, the form's and the
character's own, for any listener, so that it doesn't come back on the return.

| Roll field | Meaning |
| --- | --- |
| `kind` | `"endConcentration"`, `"spend"` or `"inspiration"`, or since module 0.42.1 `"spellSlot"`. |
| `concentration` | For `endConcentration`: `{ effect }`, a concentration's `id` as the sheet's [`concentration`](#character-sheet) lists it. |
| `counter` | For `spend`: the counter, as a `uses`' [`counter`](#counters) names it, `{ item }`, `{ item, activity }` or `{ resource }`, and nothing else. |
| `count` | For `spend`: how many, a whole number from 1 to 999. |
| `inspiration` | For `inspiration`: `"use"` or `"gain"`. |
| `spellSlot` | For `spellSlot`, since module 0.42.1: `{ op, id, from }` and nothing else: `op` `"spend"` or `"restore"`; `id` a pool's key, as the sheet's [`spells`](#character-sheet) section `id` and a `"slots"` favorite's `id` name it, such as `"spell3"` or `"pact"`: a letter, then up to 31 letters, digits, `_` or `-`; `from` the count of that pool the app showed, an integer from 0: made only where it's still the count. |

**Ending a concentration**, among the `kinds` wherever players' rolls are made, whether or not they
may attack. It's ended through dnd5e's own `endConcentration`, so a module's
`dnd5e.preEndConcentration` hook may keep it, and what depends on it, such as Bless on the
character's allies or an enchantment tied to it, goes with it, as the active Gamemaster's client
deletes it, the bridge; perhaps after the sheet is sent, which is sent again then. Nothing is
posted, as dnd5e posts nothing, so the Gamemaster can't end one as the character (`by` `"gm"` is
`"invalid"`, `error` `"by"`). Refused, in this order: `"off"` where the campaign's players' rolls
aren't made here or the self-test hasn't passed; `"invalid"`; `"unknown"` for a character not in the
campaign; `"concentration"` where the character doesn't concentrate on it now, as one ended since
it was sent; and `"cancelled"` where a module's hook kept it. Its result has `messageId` `null` and
`visible` `true`. A concentration check a [card asks](#saves-the-game-asks-for) of a character who
no longer concentrates on what it asked about closes as `"gone"`.

**Spending charges**, among the `kinds` wherever the Gamemaster lets the campaign's players attack
and cast from the app, whether or not attacks can be made here now: it throws no dice and goes
through no Midi-QOL. The counter's uses are read as they now are: an item's are left as so many
spent of its maximum (`system.uses.spent`), an activity's likewise through dnd5e's `updateActivity`
(`uses.spent`), as dnd5e's sheet writes them, and a resource's value (`system.resources.<key>.value`)
lowered; never given back. Refused, in this order: `"off"`; `"attacks-off"` where the Gamemaster
doesn't let the campaign's players attack; `"invalid"`; `"unknown"`; `"item"` where the item, or the
activity, isn't the character's, or one its player can't see; `"uses"` where it may not be spent so,
as the counter's `spendable` would say, or has no limited uses, or a resource that's unnamed or has
no maximum; and `"short"` where fewer are left than `count`. It posts a line in chat, below.

**Heroic Inspiration**, among the `kinds` where `"spend"` is: `"use"` while the character has it,
`"gain"` while they haven't, as dnd5e's sheet header toggles it. Refused, in this order: `"off"`,
`"attacks-off"`, `"invalid"`, `"unknown"`, then `"not-inspired"` for a use without it and
`"inspired"` for a gain with it. It posts a line in chat, below.

**Spell slots**, since module 0.42.1, among the `kinds` where `"spend"` is, right after
`"inspiration"`: one of the character's spell slots spent (`op` `"spend"`) or one restored
(`"restore"`), as dnd5e's sheet's pips do, one at a time: the pool's `system.spells.<id>.value`
lowered or raised by one, only while it's still `from`, the count the app showed, so a tap made
from a count Foundry has since changed is refused rather than made. A pool is an own key of the
character's `system.spells` whose maximum, the override where set, is above 0, `"pact"` among them.
Refused, in this order: `"off"`, `"attacks-off"`, `"invalid"`, `"unknown"`; `"shaped"` while the
character is transformed, as by Wild Shape, whose own slots wait for the return; `"slot"` where
there's no such pool; `"changed"` where its count isn't `from`; `"slots"` for a spend with none
left; and `"full"` for a restore with none used, at or above its maximum. A pool above its maximum,
as dnd5e's temporary slots leave one, can be spent, never restored. The Gamemaster's may have `by`
`"gm"`; none is a companion's (`of`). Each refusal changes nothing and posts nothing. It posts a
line in chat, below.

**The line.** Charges spent, Heroic Inspiration and spell slots each post one public chat message as the
character, by their player, as a roll from the app is, with `flags["sending-stone"].request` the
command's `id`, marked on its card, and for the Gamemaster's, `by` `"gm"`, marked "GM", sent with
[`gmRoll`](#chat-message) and listed in their result's `messages`. Its `content` is one paragraph in
the game's language: `Spends {count} · {name}`, `name` the item's, for an activity's own uses
`<item>: <activity>`, or the resource's label, escaped, never how many are left, which other players
don't see in Foundry; `Uses Heroic Inspiration`; `Gains Heroic Inspiration`; or since module 0.42.1
`Spends a spell slot · {name}` or `Regains a spell slot · {name}`, `name` the pool's label as dnd5e
prepares it, such as `1st Level` or `Pact Magic`, else its level's, else its key, escaped, never the
count. The result has its
`messageId` and whether its player may see it, `visible`; where it can't be posted, what it tells of
is made all the same, `"done"`, with `messageId` `null` and `visible` `true`.

### Preparing spells

Since module 0.42.1 a player can prepare one of their character's spells from the app, or unprepare
it, as dnd5e's sheet's Prepare and Unprepare do: its `system.prepared` set to `1` or `0`. It's among
`features.rolls.kinds` as `"prepare"`, right after the charge kinds, wherever the Gamemaster lets the
campaign's players attack and cast from the app (`"spend"`'s gate), whether or not attacks can be made
here now: it throws no dice and goes through no Midi-QOL. Never among `features.companions.kinds`.

```json
{ "id": "…", "kind": "prepare", "actorId": "thorin", "prepare": { "op": "prepare", "id": "witch" },
  "mode": 0, "explicit": false, "extras": [], "dice": [] }
```

| Roll field | Meaning |
| --- | --- |
| `kind` | `"prepare"`, since module 0.42.1: one of the character's spells prepared or unprepared, as dnd5e's sheet's Prepare and Unprepare do. |
| `prepare` | `{ op, id }` and nothing else: `op` `"prepare"` or `"unprepare"`, the state wanted, never a toggle; `id` the spell's item id as the sheet's [`spells`](#character-sheet) name it, 1 to 64 letters and digits. |

Not a roll: `mode` `0`, `explicit` `false`, no `extras` or `dice`, none of the roll fields
(`enchant`, `item`, `activity`, `target`, `targets`, `self`, `slot`, `prompt`, `text`, `link`,
`key`) and none of another kind's (`transfer`, `remove`, `typed`, `favorite`, `note`, `dish`,
`effect`, `wildShape`, `spellSlot`, `counter`, `count`, `inspiration`, `concentration`, `turn`,
`undo`); else `"invalid"`, `error` `"prepare"`, or `"dice"` for one that throws dice. `by` never
(`"invalid"`, `error` `"by"`): nothing is posted, as dnd5e posts nothing, so a change the
Gamemaster made as the character would leave no mark, and their page in the app doesn't offer it.
`of` never (`"invalid"`, `error` `"of"`): an NPC's spells are prepared already.

**Which spells.** Those the sheet sends with `prepared` `0` (to prepare) or `1` (to unprepare): a
spell above cantrip level whose casting prepares, by dnd5e's `canPrepare` (the `spell` and `pact`
methods), not always prepared (`2`) and not cast from an item. The module checks the same rule on
the spell as it now is, the one the sheet's `prepared` is read by, and refuses the copy of a spell
an item casts besides, as dnd5e's own menu leaves it out. Only a spell already on the character's
sheet: dnd5e keeps no class spell list on the character. Nothing limits how many are prepared, as
dnd5e limits none; a class's count, `prepared` among the sheet's
[`spellcasting.classes`](#character-sheet), may go past its maximum.

**Refused**, in this order: `"off"` (the campaign is gone, its players' rolls aren't made here, or
the self-test hasn't passed); `"attacks-off"` (its Gamemaster doesn't let them attack and cast from
the app); `"invalid"`; `"unknown"` (no such character in the campaign, or a group); `"shaped"` (the
character is transformed, as by Wild Shape: her form's spells are copies her return loses);
`"gone"` (no spell of that id on the character, or one hidden as the sheet hides it); `"prepare"`
(not one the character prepares: a cantrip, one always prepared, one whose method doesn't prepare,
or one an item casts); then, the write: `"error"` (it threw; `error` its message) or `"cancelled"`
(a module stopped it: read back unchanged). Each changes nothing and posts nothing. The campaign is
read again as the command is made, so one deleted while the command waited its turn is `"off"`.

**Made.** Already in the state wanted, as when the app showed an older sheet: `"done"` with nothing
written. Else `system.prepared` set to `1` or `0` on the spell, as dnd5e's own menu writes it, and
read back. Nothing is posted in chat. The character's sheet as it then stands goes first, in
[`character.updated`](#characterupdated) (an unchanged one isn't sent again), then the
[`command.result`](#commandresult): `"done"`, `messageId` `null`, `visible` `true`, `rolls` `[]`,
and no field of its own: the sheet says what the spell now is, and moves its class's `prepared`.

### Moving items and coins

Since module 0.31.0 a player can move items and coins from the app, as they would by dragging
between sheets in Foundry: take from one of the campaign's parties, give to one, or give to another
of its characters; and the campaign's Gamemaster can move anything between its characters and its
parties. Since module 0.32.0 a party's Owner can also send its items and coins to any of the
campaign's characters, or to another of its parties they own, and the Gamemaster anything, party to
party too (the hello's `partySends`); and either can share one kind of a party's coin among its
characters (`distribute`), as below. The Gamemaster turns it on for each campaign with **Players
move items and coins**, on its Player actions tab, off until they do and apart from the rolls; the hello's
[`features.transfers`](#bridgehello) says whether it's on. A move is fetched as a roll is, but for
a campaign whose rolls are off too, from a listener that says `"transfers": 1` in the `features` of
its answers to the campaign's hello or heartbeat, as an integer of 1 or more, besides
`"commands": true`; one that stops saying it isn't fetched from for moves. A roll fetched while only
moves are, which a listener shouldn't hand over, is refused `"off"`, as one while rolls are off.

It's no roll: sent with `mode` `0`, `explicit` `false` and no `extras` or `dice`, and naming none of
a roll's fields (`item`, `activity`, `target`, `targets`, `self`, `slot`, `enchant`, `prompt`,
`text`, `link` or `key`): its list of items is `items`, inside `transfer`.

| Roll field | Meaning |
| --- | --- |
| `kind` | `"transfer"`. |
| `actorId` | The character the move is made as: an end of it, the giving one for a give or a send, the receiving one for a take; for the Gamemaster, either. Since module 0.32.0, a move from a party, or a distribution, may be made as any of the campaign's characters, the seat's own, an end or not; a move from a character is still made as one of its ends, the Gamemaster's too. |
| `by` | `"gm"` for the Gamemaster's, as for a roll. |
| `transfer` | `{ from, to, items?, currency? }`, and nothing else: `from` the actor id of the giving end and `to` of the receiving one, each one of the campaign's characters or one of the groups it lists, never the same; `items`, from 1 to 10 `{ id, quantity }`, nothing else, `id` an item of `from`'s, each once, `quantity` a whole number from 1 to 10,000,000; `currency`, from 1 to 10 `{ <key>: <count> }`, each key one of dnd5e's coins (`CONFIG.DND5E.currencies`, such as `"gp"`), each count a whole number from 1 to 10,000,000, a coin of none left out. At least one of them. Since module 0.32.0, or a distribution, as below, `{ from, among, currency }`: `from` a party, `among` from 1 to 20 of the campaign's characters' actor ids, each once, never `from`, and `currency` exactly one coin. Never both `to` and `among`. |

A move refused for what it is is `"invalid"`, with `error` `"transfer"` (it names a roll's field,
`transfer` is no object of those fields alone, an end isn't an id, or is the other, or it moves
nothing; since module 0.32.0 also where it has both `to` and `among`, or neither), since 0.32.0
`"among"` (not 1 to 20 ids, each once, none `from`), `"items"` (since 0.32.0 also items in a
distribution), `"currency"` (since 0.32.0 also a distribution's of other than one coin), `"dice"`
or `"by"`. Everything is checked before anything is
written, as both ends now are, in this order, and each check of every part before the next:

| `reason` | When |
| --- | --- |
| `"transfers-off"` | The campaign's **Players move items and coins** is off now, the Gamemaster's moves too, or the campaign is gone. |
| `"off"` | The system isn't D&D Fifth Edition. |
| `"invalid"` | As above. |
| `"unknown"` | An end isn't one of the campaign's characters or the groups it lists, or isn't an actor any more; since module 0.32.0, one of `among` isn't one of the campaign's characters with an actor, a party among them saying nothing of whether it's one; or for a player, a group their character can't see in Foundry, as one not there. |
| `"shaped"` | Since module 0.40.0, while the character (for a move, either end) is transformed: an end that's a character, one of the characters a distribution is shared among, or `actorId`'s character, as by Wild Shape. Its things aren't on its form, which dnd5e gives none of them. |
| `"not-yours"` | `actorId` isn't one of the campaign's characters among the ends; or the ends are two groups; or for a player, a give or send not from `actorId`, or a take not into it. Since module 0.32.0: `actorId` isn't one of the campaign's characters with an actor; a move from a character isn't made as one of its ends, the Gamemaster's too; a player's from a character isn't from `actorId`; or a distribution isn't from a party. Two groups, and a move from a party made as a character that isn't an end, are no longer refused. |
| `"not-owner"` | For a player, a group their character only observes in Foundry, either end, the party a distribution is from too. A group's `access` decides, as the hello's [groups](#group) give it: the highest ownership of the group among the character's player owners, or for one no player owns, the group's default. The Gamemaster needs none, and a send to another character needs nothing of it. |
| `"members"` | Since module 0.32.0, a distribution's `among`, taken as a set, isn't the party's members that are the campaign's characters, as Foundry now has them. |
| `"gone"` | An item that isn't `from`'s, isn't one of its inventory's kinds, or isn't one its [sheet](#character-sheet) lists: never one in a container that hides what it holds, nor below five containers. A move doesn't name what the app can't. |
| `"short"` | More of an item than `from` holds, as stored; or more of a coin than it holds, as its sheet shows it (dnd5e 6 rounds a fraction down) or as stored. |
| `"split"` | Since module 0.32.0, a distribution of fewer coins than the characters it's shared among. |
| `"container"` | Part of a container that holds anything, or may, as one not yet identified that hides what it holds. Such a one moves whole. |
| `"nested"` | An item inside another the move names, at any depth: it moves with it. |
| `"deep"` | A container holding containers deeper than dnd5e copies, five levels, whose deepest contents would be deleted and never copied. |

**What moves.** Coins first, each only the coins moved, from what each actor stores: taken from
`from` in one update, then added to `to` in another, a coin it has no key for starting at none, so a
dnd5e 6 fraction stays (10.5 gp less 10 leaves 0.5). Never dnd5e's Award, which caps what it moves
without saying so and writes the giver last from what it read first. Then each item in order. Part
of a stack, fewer than `from` holds: `from`'s stack keeps the rest under its id, taken first, then a
copy of the part is made on `to`, at the top of its inventory, wherever it was. All of it: a copy made
first, as dnd5e's own `createWithContents` makes it, a container with everything in it under new
ids, each in its new container, the top at the top; then the original and everything in it deleted
from `from` in one call. Deleting first would end what depends on it, such as a concentration or a
favorite, which nothing could put back. Every copy arrives unequipped, unattuned, unprepared and with
no crew, what a container holds too, as dnd5e's drop resets the item dropped; its uses, effects,
attunement, identification and source are kept. A consumable joins `to`'s stack of the same source
(`_stats.compendiumSource`, or the legacy `flags.core.sourceId`) and name, at the top, as dnd5e's
drop stacks it, but never where either isn't identified, the one moved has uses spent, or either
carries an enchantment, all of which a stack would lose.

**What fails.** A write that fails puts back what it can, and nothing more is tried: coins added to
`to` that fail are put back on `from`; part of a stack that can't be made on `to` is put back in
`from`'s stack; a whole item whose original can't be deleted has its copy deleted, or the stack it
joined put back. A write a module's hook refuses, which Foundry leaves out without throwing, fails as
one that throws would, so nothing is made from nothing: a refused update fails with `"An update was
refused"`; a copy made only in part, as a container without some of what it held, is deleted, with
`"Not every item was created"` (`"No item was created"` where none was); and where some of a whole
item stays on `from`, with `"Not every item was deleted"`, the copies of what stayed are deleted, or
the stack it joined put back, so nothing is on both ends, and what went keeps its copy. The result is
`"failed"`, `"error"`, its `error` what went wrong, and both messages joined by " / " where putting
back failed too: coins are then lost, never made twice. Its
[`transfer`](#commandresult) lists what moved before, if anything did. A browser closed between two
writes can leave a whole item on both ends, or part of one or coins on neither; nothing puts that
right but the Gamemaster, and the sheets show it. A change made by hand in Foundry between the
checks and the writes may be written over.

**A party's coin shared among its characters.** Since module 0.32.0, where the hello says
`distribute`, a `transfer` with `among` in place of `to` shares one kind of a party's coin among its
characters, as the app's Distribute does. `among` is exactly the party's members that are the
campaign's characters, in the order its [sheet](#group) lists them, or it's `"members"`; and
`currency`'s one count, `n`, is the party's whole coins of that kind as the app's sheet showed them.
The party holds the fewer of what its sheet shows (dnd5e 6 rounds a fraction down) and what it
stores: `"short"` where `n` is more, then `"split"` where it's fewer than the characters. Each is
given `n` divided by their number, rounded down, its share; the shares together are taken from the
party in one update, then each character is given its share in order, one update each, so what
can't be shared evenly stays with the party: 100 gp among four, 25 gp each; 103 among four, the
same, and 3 stay. Where the party's own update fails, nothing is written and the move is `"failed"`,
`"error"`, with no `transfer`, line or sheet. Where a character's fails, the shares not given are
put back on the party in one update and the move is `"failed"`, `"error"`, its `transfer` listing
those given theirs; where the put back fails too, `error` holds both messages joined by " / ", and
the coins are lost, never made twice. Under dnd5e 6, of a party's 103.5 gp, 100 shared among four
leaves it 3.5.

**One at a time.** A move waits for the moves before it, whoever made them, and for every roll of
each of its ends, and each end's next roll waits for it; since module 0.32.0, also for every roll of
the character it's made as, and a distribution for every roll of each character it's shared among,
whose next rolls wait for it. Two players taking the last potion at once
are made one after the other, the second refused `"gone"` or `"short"`; two distributions, or a
distribution and a send of the same coin, the second refused `"short"` or `"split"` where too little
is left. A distribution sent again, as after a `"timeout"` or from a second device, carries the
count its dialog showed, so it's `"short"` once the first has shared the coin; and the party's
members changing meanwhile make it `"members"`, nothing written. A move whose writes take
longer than a minute is told `"timeout"`, as a roll is, and the rolls waiting on it go ahead; the
next move still waits for its writes, and its late `"done"` follows. A move whose writes never end
holds the next until the page is reloaded.

**The line.** A move that moved anything posts one public chat message, by the character's player as
a roll is, marked on its card, the Gamemaster's `by` `"gm"` and listed in their result's `messages`:
from a character, as `from`, `Gives {things} to {target}`; from a party, as `to`, `Takes {things}
from {source}`, where `to` is the character it's made as. Since module 0.32.0, from a party to
another of the campaign's characters, or to a party, as the character it's made as, `Sends {things}
from {source} to {target}`: "Sends 20 gp from The Iron Company to Vex"; and a distribution, as the
character it's made as, `Distributes {things} among {names} ({each} each); {left} stays with
{source}`, or `…; none stays with {source}` where the party holds no whole coin of it left:
"Distributes 100 gp among Bram, Lia, Thorin, and Vex (25 gp each); 3 gp stays with The Iron
Company". `{things}` is then the coins given out, `{each}` one share, `{left}` the party's whole
coins of the kind now, after any put back, and `{names}` the characters given their share, in
order, listed as `{things}` is. `{things}` lists each item moved, `{count} {name}`, by the name its sheet has, an
unidentified one's, then each coin, `{count} {abbreviation}`, in dnd5e's order, joined as the game's
language lists them: "Gives 2 Potion of Healing, 1 Rope, and 5 sp to The Iron Company". Every name is
escaped; a container is named alone, never what it held. A refusal posts nothing.

**The result.** Both ends' sheets as they then stand go first, `from`'s then `to`'s, each in
[`character.updated`](#characterupdated), or [`group.updated`](#groupupdated) to a listener that
reads groups, after any write. Then `"done"`, with `messageId` and `visible` the line's (`null` and
`true` where it couldn't be posted), `rolls` `[]`, and `transfer`: `{ from, to, items, currency }`,
each item moved `{ id, quantity, created, stacked }`, `created` its copy's new id or `null`, `stacked`
the id of the stack it joined or `null`, and the coins moved, or `null`. Never a name, nor what a
container held. Since module 0.32.0, a distribution's sheets are the party's, then each character's
given its share, in order, and none where nothing was written; its `transfer` is `{ from, to: null,
items: [], currency, among }`, the coins given out and the characters given them, in order.

### Removing an item

Since module 0.33.0 a player can remove an item from their own character from the app, as they would
delete it on dnd5e's sheet, part of a stack or all of it; and the campaign's Gamemaster from any of
its characters, at that character's page. There's no switch: wherever the system is D&D Fifth
Edition the hello's [`features.removals`](#bridgehello) is `{ enabled: true, kinds: ["remove"],
reason: null }`, whatever the campaign's rolls and moves, and under any other system `{ enabled:
false, kinds: [], reason: "system" }`. A removal is fetched as a roll is, but for a campaign whose
rolls and moves are both off too, from a listener that says `"removals": 1` in the `features` of its
answers to the campaign's hello or heartbeat, as an integer of 1 or more, besides `"commands":
true`; one that stops saying it isn't fetched from for removals. A roll fetched while only removals
are, which a listener shouldn't hand over, is refused `"off"`, and a move `"transfers-off"`, as
while they're off.

It's no roll: sent with `mode` `0`, `explicit` `false` and no `extras` or `dice`, naming none of a
roll's fields (`item`, `activity`, `target`, `targets`, `self`, `slot`, `enchant`, `prompt`, `text`,
`link` or `key`), no `transfer`, and no `typed`: nothing is typed in for it, and the line of one
said to be typed would be marked as entered by hand.

| Roll field | Meaning |
| --- | --- |
| `kind` | `"remove"`. |
| `actorId` | The character it's removed from: for a player their own, for the Gamemaster the character whose page it's removed at. It names no other actor, so a player only ever removes from their own character. |
| `by` | `"gm"` for the Gamemaster's, as for a roll; it needs no `gmRolls`, as a move doesn't. |
| `remove` | `{ item, quantity, held }`, and nothing else: `item` the id of an item of the character's, at the top of its inventory or in a container; `quantity` how many of its stack to remove, a whole number from 1 to `held`, `held` itself deleting it, or `0` only where `held` is `0`, a stack of none, which deletes it; and `held` how many of it the app's sheet showed when the removal was chosen, a whole number from 0 to 10,000,000. |

**Why `held`.** The module removes an item only while its stack is still exactly `held`. A potion
drunk, ammunition spent, another seat's move or the Gamemaster's own change in Foundry can leave the
stack at the very number asked for; without `held`, part of a stack would then be taken for all of
it, deleting it whole, a container's contents with it, which the player never confirmed. So too a
removal handed over twice, or sent again from a dialog left open, never takes more.

A removal refused for what it is is `"invalid"`, with `error` `"remove"` (no `remove`, or one that's
no object of `item`, `quantity` and `held` alone, or whose `item` isn't an id; a roll's field, a
`transfer` or a `typed` beside it), `"quantity"` (`quantity` or `held` not a whole number from 0 to
10,000,000, `quantity` more than `held`, or `0` of a stack of some), `"dice"` or `"by"`. Everything
is checked before anything is written, as the character now is, in this order:

| `reason` | When |
| --- | --- |
| `"off"` | The system isn't D&D Fifth Edition, or the campaign is gone. |
| `"invalid"` | As above. |
| `"unknown"` | `actorId` isn't one of the campaign's characters with an actor; one of its groups is unknown too. |
| `"shaped"` | Since module 0.40.0, while the character is transformed, as by Wild Shape: its things aren't on its form. |
| `"gone"` | The item isn't the character's, isn't one of its inventory's kinds, or isn't one its [sheet](#character-sheet) lists: never one in a container that hides what it holds, nor below five containers, for the Gamemaster too, the same answer as no such item. |
| `"short"` | `quantity` is more than the character holds of it now, as stored. |
| `"changed"` | The stack holds as many as `quantity` or more, but not `held`: it changed after the app's sheet showed it. Checked after `"short"`. |

Equipped and attuned items are removed as any other, and part of a container's stack may be.

**What's written.** Part of a stack, fewer than it holds: its quantity lowered, in one update; part
of a container's stack leaves what it holds with what's left. All of it: the item and everything in
it, at any depth, deleted in one `deleteEmbeddedDocuments`, never with dnd5e's `deleteContents`, as
everything in it is named, so the sheet sent next lists none of it. What a container holds when its
removal is made goes with it, whatever was put in it after the app's sheet was sent. dnd5e then does
on the Gamemaster's browser what it does for any item deleted in Foundry: the item's activities
cleaned up, what depends on its effects deleted, a concentration on it ended and favorites of it
cleared.

**What fails.** A write that fails, or that a module's hook refuses, which Foundry leaves out without
throwing, fails as one that throws would: a refused update with `"An update was refused"`, and a
delete that leaves the item, or anything it held, with `"Not every item was deleted"`. Nothing
deleted is put back, as nothing can be: what a hook kept from going with its container stays, shown
at the top of the inventory. The result is `"failed"`, `"error"`, its `error` what went wrong.

**One at a time.** A removal waits for the moves and removals before it, whoever made them, and for
every roll and move of its character's before it, whose next ones wait for it. A move or removal
whose writes take longer than a minute is told `"timeout"`, as a roll is, and the rolls waiting on it
go ahead; the next move or removal still waits for its writes. So nothing is ever both moved and
removed: a move made first leaves the removal `"gone"`, `"short"` or `"changed"`, and a removal made
first leaves the move `"gone"` or `"short"`. A removal whose writes never end holds the next move or
removal until the page is reloaded.

**The line.** A removal that lowered or deleted the item posts one public chat message, as the
character, by their player as a roll is, marked on its card, the Gamemaster's `by` `"gm"` and listed
in their result's `messages`: `Removes {things}`, `{things}` being `{count} {name}`, the quantity
removed, always said, `0` too, and the name its sheet has, an unidentified one's, escaped: "Removes 2
Potion of Healing", "Removes 0 Arrows". A container is named alone, never what it held. A refusal
posts nothing.

**The result.** Where anything was written, the character's sheet as it then stands goes first, in
[`character.updated`](#characterupdated), unless it's what the listener was last sent. Then
`"done"`, with `messageId` and `visible` the line's (`null` and `true` where it couldn't be posted),
`rolls` `[]`, and [`removed`](#commandresult), `{ item, quantity }`, as asked. A failure after the
item itself was lowered or deleted, as where a hook kept some of what a container held, is `"error"`
with `removed` too; any other has none. Never a name, nor what a container held.

A listener before module 0.33.0 never says `"removals"`, so it's handed no removal, and it may
ignore the hello's `features.removals`.

### Favorites

Since module 0.37.0 a player can add to their own character's favorites from the app, and remove
from them, as dnd5e's sheet's menus do: an item, one of its activities or an effect, and a skill, a
tool or a pool of spell slots where the listener sends one. They're dnd5e's own favorites, written by
dnd5e's own `addFavorite` and `removeFavorite` on the Gamemaster's Foundry, so Foundry's sheet,
Tidy 5e's and the character's [`favorites`](#character-sheet) all show the same list, and a new one
goes last, its `sort` the highest plus `CONST.SORT_INTEGER_DENSITY`, as dnd5e adds it. There's no switch:
wherever the system is D&D Fifth Edition the hello's [`features.favorites`](#bridgehello) is `{
enabled: true, kinds: ["favorite"], reason: null }`, whatever the campaign's rolls and moves and the
dice self-test, and under any other system `{ enabled: false, kinds: [], reason: "system" }`. A
favorite is fetched as a roll is, but for a campaign whose rolls, moves, removals and notes are all
off too, from a listener that says `"favorites": 1` in the `features` of its answers to the
campaign's hello or heartbeat, as an integer of 1 or more, besides `"commands": true`; one that stops
saying it isn't fetched from for favorites. A roll fetched while only favorites are, which a listener
shouldn't hand over, is refused `"off"`, as while rolls are off.

It's no roll: sent with `mode` `0`, `explicit` `false` and no `extras` or `dice`, naming none of a
roll's fields (`item`, `activity`, `target`, `targets`, `self`, `slot`, `enchant`, `prompt`, `text`,
`link` or `key`), no `transfer`, no `remove` and no `typed`. Nothing is posted in chat, as dnd5e
posts nothing for a favorite, so only a character's player makes one: never the Gamemaster as them,
which would leave no mark (`by` `"gm"` is refused `"invalid"`, `error` `"by"`), and never for a
companion, an NPC, which has no favorites (`of` is refused `"invalid"`, `error` `"of"`).

| Roll field | Meaning |
| --- | --- |
| `kind` | `"favorite"`. |
| `actorId` | The player's own character. It names no other actor, so a player only ever changes their own character's favorites. |
| `favorite` | `{ op, type, id, item? }`, and nothing else, as below. |

| `favorite` field | Meaning |
| --- | --- |
| `op` | `"add"` or `"remove"`. |
| `type` | One of dnd5e's: `"item"`, `"activity"`, `"effect"`, `"skill"`, `"tool"` or `"slots"`. Never `"resource"`: an old-style resource's place among the favorites is dnd5e's own. |
| `id` | As the [sheet](#character-sheet) names it: an item's or an activity's id, 1 to 64 letters and digits; an effect's as the sheet's `effects` name it, its own id on the character, or its item's and its own joined by one `.`; a skill's, a tool's or a pool's key, a letter then up to 31 letters, digits, `_` or `-`, such as `"prc"`, `"thief"` or `"spell1"`. So no id is ever `resources.<key>`, which dnd5e's `removeFavorite` takes for an old-style resource, setting its maximum to 0. |
| `item` | For an `"activity"` only, and always: its item's id, 1 to 64 letters and digits. dnd5e gives the first activity of every item it migrated the same id, so an activity is known by its item. |

**What's stored.** The module builds the id dnd5e keeps, as dnd5e's menus build it, and passes that
one string to `addFavorite` and to `removeFavorite`, as dnd5e's menus match it:

| `type` | Stored id |
| --- | --- |
| `item` | `.Item.<id>` |
| `activity` | `.Item.<item>.Activity.<id>` |
| `effect` | `.ActiveEffect.<id>`, or for `<itemId>.<id>`, `.Item.<itemId>.ActiveEffect.<id>` |
| `skill`, `tool`, `slots` | the key |

A favorite stored any other way is one the sheet doesn't list, so a listener never offers it for
removal.

A favorite refused for what it is is `"invalid"`, with `error` `"favorite"` (no `favorite`, or one
that's no object of `op`, `type` and `id` alone, `item` beside them for an activity only; an `op` or
`type` not among those above, or an `id` or `item` not as above; a roll's field, a `transfer`, a
`remove` or a `typed` beside it), `"dice"`, `"by"` or `"of"`. Everything is checked before anything
is written, as the character now is, in this order:

| `reason` | When |
| --- | --- |
| `"off"` | The system isn't D&D Fifth Edition, or the campaign is gone. |
| `"invalid"` | As above: `by`, then `of`, then what it names, then `"dice"`. |
| `"unknown"` | `actorId` isn't one of the campaign's characters with an actor; one of its groups is unknown too, and so is a character whose actor has no dnd5e favorites (`hasFavorite`, `addFavorite` and `removeFavorite`). |
| `"shaped"` | Since module 0.40.0, while the character is transformed, as by Wild Shape: its form's favorites are a copy its return loses. |
| `"gone"` | For an Add: it isn't one the character's [sheet](#character-sheet) would list among its favorites: no such item, activity, effect, skill, tool or pool on the character, or one the sheet leaves out, as an item dnd5e hides, an activity its player can't see, or an effect dnd5e hides from them. A Remove is never `"gone"`: a favorite of something deleted since can still go. |
| `"error"` | dnd5e's method threw; `error` is what it said. It throws, if at all, before its one update, or the update fails whole, so nothing was written. |

**Already so.** An Add of what's a favorite already, or a Remove of what isn't, is `"done"` with
nothing written: the listener may have shown an older sheet, as where it was made a favorite in
Foundry a moment before.

**One at a time.** A favorite waits for its character's earlier commands, a removal of the same item
among them, and their next ones for it, as a roll does. Two sent one after another are made in that
order, so the later is last.

**The result.** The character's sheet as it then stands goes first, on every `"done"`, written or
not, in [`character.updated`](#characterupdated), unless it's what the listener was last sent. Then
`"done"`, with `messageId` `null`, `visible` `true`, `rolls` `[]` and
[`favorited`](#commandresult), whether it's one of the character's favorites now. A refusal has no
`favorited` and sends no sheet.

A listener before module 0.37.0 never says `"favorites"`, so it's handed no favorite, and it may
ignore the hello's `features.favorites`. A module before 0.37.0 has no `features.favorites`; handed a
favorite anyway, it refuses it `"off"` where the campaign's rolls are off, else `"invalid"`, `error`
`"kind"`.

### Journal notes

Since module 0.34.0 players keep journal notes in the app, and the module keeps them in Foundry as
journals: each character's own, and each party's, with chapters. The app keeps every change first,
Foundry open or not, and hands it over as a `note` command, fetched as a roll is; the module makes
it, and sends the journal back whole in [`journal.updated`](#journalupdated) before the result.
There's no switch: every hello's [`features.notes`](#bridgehello) says `{ enabled: true, kinds:
["personal", "party"], reason: null, journals }` under any system. Note commands are fetched for
every campaign whose listener says `"notes": 1` in the `features` of its answers to the campaign's
hello or heartbeat, as an integer of 1 or more, besides `"commands": true`, its rolls, moves and
removals on or not. One that stops saying it is neither fetched from for notes nor sent journals.

**The layout: a page per chapter and a page per note.** A journal is one JournalEntry, in
multi-page view (`flags.core.viewMode` `2`), so it reads in Foundry as one document. A chapter is a
text page whose title shows as a level 1 heading (`title: { show: true, level: 1 }`), its text
empty; a note, an entry, is a text page whose title shows as a level 2 heading, written in Markdown
(`text.format` `2`, `text.markdown` its Markdown and `text.content` its HTML), in Foundry's Markdown
sheet where it's registered (`flags.core.sheetClass`, found among
`CONFIG.JournalEntryPage.sheetClasses.text` by its class `JournalEntryPageMarkdownSheet`). An entry
before the journal's first chapter is in no chapter. A note's id is its page's id: the app chooses
16 letters and digits for a note it makes, and the module creates the page with that `_id`
(`keepId`).

**Where journals live.** One journal per book, and a book is per campaign: a character's personal
notes in a campaign, and a party's notes in a campaign. A character or party in two campaigns has a
journal for each, so one campaign's players never read what another's wrote. A journal is found by
its flag, never by name or folder: `flags["sending-stone"].journal` `{ kind, actor, campaign,
granted, default }`, `kind` `"personal"` or `"party"`, `actor` the character's or group's id and
`campaign` the module's campaign id. Where several claim one book, as a duplicated journal does, the
one Foundry made first wins (`_stats.createdTime`, ties to the smaller id), and the others are
ignored. The module makes a journal the first time a note or chapter is added to its book from the
app, never on a hello, in a folder found by its flag, `flags["sending-stone"].folder` `"notes"`,
made where there's none, "Sending Stone notes". It's named "{name}'s notes" or "{name}: party
notes", `{name}` the actor's name then, with " ({campaign})" after it where the actor is in more
than one campaign then, as "Thorin's notes (Erebor)"; a rename in Foundry stays. Its table of
contents is locked (`flags.core.locked`) against casual dragging: a Gamemaster who unlocks it and
reorders notes there keeps that order, which the app shows.

**Each page's flags**, written whole in the same call that makes it, as its id is known before:
`flags["sending-stone"]` `{ page, role, chapter, author, createdAt, modified, hash, granted }`:
`page` its own id; `role` `"chapter"` or `"entry"`; `chapter` an entry's chapter's id, or `null`;
`author` `{ actor, gm }`, who wrote it from the app, `actor` `null` and `gm` `true` for the
Gamemaster, or `null` itself for a page first written in Foundry; `createdAt` the app's time;
`modified` `{ actor, gm, at }`, who changed it last from the app and when; `hash` its revision as
the module last wrote it; and `granted`, who the module made its Owner. A page's flags count only
where `page` is its own id and every field has its shape: a duplicated page's copied flags, or a
hand-edited one, never do, and it reads as a page written in Foundry, claiming no author. Where the
module writes only a note's place or who owns it, which Foundry counts as the Gamemaster's change,
now, a note changed in Foundry also keeps `foundry`, `{ page, rev, at, by }`: who last changed it
there (`by`, a user's id, or `null`) and when, while it holds revision `rev`, on the page whose id
is `page` alone. It's `null` once the app changes the note again. A page with no other flags of the
module's may hold it, and its flags still don't count.

**Ownership.** A personal journal is Owner to the character's player owners (non-Gamemaster users
with Owner of the actor) and None by default; its pages inherit. A party journal is Observer to each
player who may see the party in Foundry, by their own level on the group, Observer or more, table
players outside the app included, and Observer by default where the group's own default is
Observer or more, else None; each note added from the app by a player is Owner to their
character's player owners, so in Foundry too a member changes only their own notes; a note the
Gamemaster added, and a chapter, inherit. Members add no pages to a party journal in Foundry. The
module keeps both in step when an actor's ownership changes: a character's own journals, the party
notes it wrote, and a party's journals, writing only what changes, one update a document. It keeps
the Gamemaster's own changes: `granted` lists who the module gave a level to and `default` the
default it set; a re-derive sets each wanted user's level, never touches anyone else's, sets one in
`granted` no longer wanted to None on a journal and back to inherit on a page (never None there,
which would hide it from someone the journal still shows it to), and changes the default only while
it's still the one the module set.

**What's sent.** Only text pages, and only those shared as their journal is: a page whose own
ownership hides it from no player the journal shows it to, up to Observer, and from no one by
default, and that isn't the Gamemaster's alone (a default of None or Limited of its own with no
player given Observer or more on it). The module's own pages always are, even in a journal no
player can see yet. A page the Gamemaster hides from some of the journal's players, or all, isn't
sent at all: it leaves the app's books as if deleted there. A secret goes only where its readers
in the app could read it in Foundry, which shows a page's secrets to its Owners alone: never in a
party's journal, and in a character's only where every one of the character's player owners is an
Owner of the page, so not where the Gamemaster made one of them an Observer of it, or of the
journal, nor for a character no player owns. Where it doesn't go, an HTML page's secret sections
are removed from its HTML, and a page changed in Foundry whose HTML holds one goes as that HTML
without them, `format` `1` and `secret: true`, never as its Markdown; so does a chapter whose text
holds one, as the app never writes a chapter's text, though a chapter's revision is its title
alone. A page or title too long is cut and marked `cut`. Each note is as the app's schema takes it.

**Revisions and "changed in Foundry".** A page's revision, `rev`, is a hash of a chapter's title, or
of an entry's title, format and text (its Markdown, or its HTML where it's read as HTML). Its format
is Markdown where `text.format` is Markdown and `text.markdown` a string, unless that's empty while
its HTML isn't, as Foundry's rich-text editor leaves it. A page whose revision isn't its flags'
`hash`, or that has none, was changed in Foundry: `modifiedIn` `"foundry"`, with
`_stats.modifiedTime` and `lastModifiedBy`, or what its flags' `foundry` kept of them before the
module's own write of its place or owners; otherwise `"app"`, with its flags' `modified`. The
module's own sorts, flags and ownership change no revision, and text the Gamemaster writes under a
chapter never makes its rename a conflict.

**Order.** A journal's order is its pages' order in Foundry, by `sort`, and nothing else holds it;
[`journal.updated`](#journalupdated) lists the notes in it. The chapter pages divide it into groups:
the notes in no chapter first, then each chapter, by when it was written, ties by id, followed by
its notes. Since module 0.35.0 each group's notes keep the order Foundry holds them in, as the app
sets it with an order (below), or a Gamemaster who unlocks the journal's contents drags them there;
before it, every create and move put each group back in the order its notes were written. Chapters
aren't reordered: one dragged in Foundry is put back by when it was written at the next create or
move from the app. A note made, or moved to another chapter, goes last in its group, whenever it was
written, and a chapter made goes among the chapters by when it was written. A page written in
Foundry is in the chapter before it; a note whose chapter isn't in the journal yet is in none until
the chapter comes, and is then gathered under it; and a page that isn't text keeps its place after
the note it follows. Only a create, a move to another chapter and an order place pages. A create
places its page, and a move its note, midway between the pages it falls between. Where no whole
number fits there, a create makes its page at the journal's end and a move leaves its note where it
was, and the journal is then renumbered, every page `100000` apart, in one `updateEmbeddedDocuments`
writing only those whose `sort` changes, the moved note last in its new chapter. A note a page that
isn't text follows is given no place of its own: the journal is put in order after the move, as
below, the note and that page together. Wherever the whole order still differs from this, as after
a chapter was dragged in Foundry, the pages are put back in one `updateEmbeddedDocuments`, each
taking the `sort` of the page that held its place, so only the pages whose place changes are
written; where two pages share a `sort`, the journal is renumbered instead. Reading never sorts.

**Markdown, and the level 1 and 2 headings.** A note's text is Markdown as Foundry's showdown,
2.1.0 with Foundry's options, renders it: paragraphs, emphasis, strikethrough, lists, quotes, fenced
code, rules, tables, sized images, links, headings of level 3 to 6, and raw HTML. It may hold no
level 1 or 2 heading, which only chapters and notes are, as showdown reads one: `#` or `##` at a
line's start with or without a space, inside a quote too, and a line underlined with `=` or `-`;
never inside fenced code. The module converts a note's Markdown itself, with Foundry's own converter
(`JournalEntryPageTextSheet._converter`) where there is one, else showdown with
`CONST.SHOWDOWN_OPTIONS`, cleans it with `foundry.utils.cleanHTML`, and writes both. A note whose
HTML has an `<h1>` or `<h2>` is refused `"headings"`. Without the converter, or the cleaner, it's
refused `"error"`, "Foundry’s Markdown converter wasn’t found" or "Foundry’s HTML cleaner wasn’t
found": a player's raw HTML is never written as the Gamemaster.

**The command.** It's no roll: `kind` `"note"`, `mode` `0`, `explicit` `false`, no `extras` or
`dice`, and none of a roll's fields, no `transfer`, `remove` or `typed`.

```
{ id: "<write id>.<seq>", actorId: <the book's actor id>, kind: "note", by?: "gm",
  note: { book, op, id, role, base, writer, at, title?, markdown?, chapter?, createdAt? },
  mode: 0, explicit: false, extras: [], dice: [] }
```

| Roll field | Meaning |
| --- | --- |
| `id` | The change's: it changes whenever the waiting change does, and stays the same each time the same change is handed over. At most 64 characters. |
| `actorId` | The book's: the character for a personal book, the group for a party book. |
| `by` | `"gm"` for the Gamemaster's. |
| `note.book`, `note.op`, `note.role` | `"personal"` or `"party"`; `"create"`, `"update"` or `"delete"`; `"chapter"` or `"entry"`. A chapter is never deleted from the app. |
| `note.id` | The note's id, 16 letters and digits: for a create, the id the page is made with. |
| `note.base` | The revision the change was made from; `null` for a create. |
| `note.writer` | The writing character: a player's own, for a personal book the book's character; `null` for the Gamemaster. |
| `note.at` | When it was changed in the app, in milliseconds. |
| `note.title`, `note.markdown`, `note.chapter`, `note.createdAt` | Its title, 1 to 200 characters on one line after trimming; an entry's Markdown, at most 20,000 characters, `""` allowed, and chapter, a chapter's id or `null`; and a create's `createdAt`, when it was first written in the app. |

Exactly these fields: a create `{ book, op, id, role, base, writer, at, title, createdAt }`, an
update `{ book, op, id, role, base, writer, at, title }`, each with `{ markdown, chapter }` for an
entry, and a delete `{ book, op, id, role, base, writer, at }`. A command refused for what it is is
`"invalid"`, with `error` `"note"` (no `note`, or one that isn't an object of exactly its fields, an
unknown book, op or role, an `id` that isn't 16 letters and digits, a chapter's delete, `at` or
`createdAt` not a positive whole number, or a roll's field, a `transfer`, `remove` or `typed` beside
it), `"title"`, `"body"`, `"chapter"`, `"base"` (not `null` for a create, or not 14 hexadecimal
digits otherwise), `"writer"` (not an id, `null` without `by` `"gm"`, or for a personal book a
player's that isn't `actorId`), `"dice"` or `"by"`. Everything is checked before anything is
written, as Foundry holds the journal then, in this order:

| `reason` | When |
| --- | --- |
| `"off"` | The campaign is gone, or there's no JournalEntry here. |
| `"invalid"` | As above. |
| `"unknown"` | The book's actor isn't one of the campaign's characters, or groups, with an actor; or a player's writer isn't one of its characters. |
| `"private"` | A party none of the campaign's characters may see in Foundry. |
| `"not-member"` | A player's writer may no longer see the party in Foundry. |
| `"gone"` | An update of a note or chapter that isn't in the journal, or isn't sent, or with no journal at all; and a create whose page is already there but isn't sent, as one the Gamemaster has hidden since, so a note made again from the app after a `"gone"` is never taken as made already. A create whose page is there and sent is done, writing nothing; a delete of one that's gone, or isn't sent, is done. |
| `"changed"` | The page isn't the command's `role` now, as one whose level was changed in Foundry; or, after the next checks, `base` isn't its revision now: it was changed in Foundry. |
| `"not-yours"` | A player's update or delete of a party note their character didn't write, or one written in Foundry. |
| `"foundry-only"` | An update of a note the app shows read only: kept as HTML, sent as HTML for its secret, cut, or with Markdown over 20,000 characters. |
| `"full"` | A create into a journal holding 300 entries, or 50 chapters, or whose text would pass 1,000,000 characters; an update past it. |
| `"headings"`, `"error"` | The note's HTML has a level 1 or 2 heading; there's no converter or cleaner. |

An update already holding exactly what's asked, its title and text, is done before `base` is
compared, writing nothing but moving the note where the chapter asked isn't the one it was sent in.

**An order** (module 0.35.0). A group's notes, a chapter's or those in no chapter, put in the order
a player or the Gamemaster set in the app:

```
{ id: "<order id>.<seq>", actorId: <the book's actor id>, kind: "note", by?: "gm",
  note: { book, op: "order", chapter, ids, was, writer, at },
  mode: 0, explicit: false, extras: [], dice: [] }
```

| Roll field | Meaning |
| --- | --- |
| `id` | The order's: it changes whenever the waiting order does, and stays the same each time the same order is handed over. At most 64 characters. |
| `note.book`, `note.op` | `"personal"` or `"party"`; `"order"`. |
| `note.chapter` | The group: a chapter's id, or `null` for the notes in no chapter. |
| `note.ids` | The group's notes in the new order, as the app showed them: 1 to 400 distinct note ids. |
| `note.was` | The group's notes in the order Foundry held them when the order was made, as the app's copy of the journal had them: 0 to 400 distinct note ids. |
| `note.writer`, `note.at` | As a note's: the writing character, a player's own, for a personal book the book's character, `null` for the Gamemaster; and when the order was saved in the app. |

Exactly these fields: no `id`, `role`, `base`, `title`, `markdown` or `createdAt`. One refused for
what it is is `"invalid"`, with `error` `"note"` (not an object of exactly these fields, an unknown
book, `ids` empty or longer than 400, `was` longer than 400, either not a list of distinct note ids,
`at` not a positive whole number, or a roll's field, a `transfer`, `remove` or `typed` beside it),
`"chapter"` (neither `null` nor a note id), `"writer"`, `"dice"` or `"by"`, as a note's. Everything
is checked before anything is written, in this order: `"off"`, `"invalid"`, `"unknown"`, `"private"`
and `"not-member"` as for a note. No author check: anyone who may see the party puts its notes in
order, as it writes only where pages sit, never a note's title, text, chapter or owner. From here
the book goes before the result. `"gone"` where there's no journal, or `chapter` isn't a chapter the
app is sent now: deleted in Foundry, hidden since, or made a note. The group is its notes as the app
is sent them, in Foundry's order: the notes `ids` lists that are still in it take its order, and the
rest follow in Foundry's; one it lists that isn't there now is left out. Where Foundry holds the
group as the order would make it, it's done, writing nothing, as when the same order is handed over
again after it was made, one made only as far as a chapter only the Gamemaster sees allowed (below)
too. Otherwise, where the notes of `was` still in the group are in another order in Foundry than
`was` has them, someone reordered them there since, and it's refused `"changed"`: Foundry's order
stays, for the app to offer its player theirs beside it. Notes added to the group meanwhile,
deleted, or moved out of it never refuse it. A write that throws, or writes less than asked, is
`"error"`. Where a chapter only the Gamemaster sees falls between a group's notes, as the app is
shown them, the order is made within each of Foundry's chapters, as far as they allow, and the
result says the order made. Its result has [`order`](#commandresult), `{ chapter, ids }`, the
group's order in Foundry then, on `"done"`, `"changed"` and `"error"`, and no `note`. Orders are
made one at a time with the note changes, after those of the same journal fetched before them, the
book first.

**What's written.** A create: the journal, where there's none; then the page, in a
`createEmbeddedDocuments` of its own, with `keepId`, its flags in it, and nothing written after it
but its place. One that makes no page fails `"error"`, "A write was refused", and one Foundry makes
with another id is deleted again and fails "Foundry didn’t keep the note’s id". An update: one
`update` of its name, its title's level, an entry's format, Markdown and HTML, and its flags, whole,
a page first written in Foundry gaining them with no author; a note moved given its place in the
same update, or, where none fits there or a page that isn't text follows it, by the journal's sort
after it (Order, above). A note is moved only where the update names another chapter than the one
it was sent in; otherwise it stays in the chapter it's in, by its flag or its place, even one the
app isn't sent, as one only the Gamemaster sees. A delete: `deleteEmbeddedDocuments`. An order: one
`updateEmbeddedDocuments` of `sort` (and the kept `foundry` flag) of the group's pages whose place
changes, each taking the slot of the page that held its new place, with the pages that aren't text
and follow them; where the journal was out of its layout, the pages that put it back, as a create's
sort does; no page changes chapter. A write a module's hook refuses fails as one that throws would,
"A write was refused", and nothing is put back. No note goes to chat.

**Made at most once.** A change is handed over until it's answered, so it may arrive more than once:
after a reload, or a result lost on its way. A create whose page is there and sent, an update whose
page holds what's asked, and a delete of a page that's gone are each done, writing nothing; since
module 0.35.0, so is an order whose group Foundry holds as the order would make it. While a change is
being made, the same command handed over again is ignored, and the run answers it; that lasts until
its writes end, however long after a `"timeout"`. Once it's answered, the same command handed over
again is made again, which is then one of the cases above, and answered.

**Both places.** A change that reaches Foundry after the page was changed there is never made: the
command's `base` isn't the page's revision now, and it's refused `"changed"` with Foundry's version
kept, which the book sent before the result holds, for the app to offer its player theirs beside
it. A change of a page deleted in Foundry is refused `"gone"`, and a delete of one is done.

**Who changed it in Foundry** (module 0.35.0). Each note says who last changed it, in the app or in
Foundry, but a page deleted in Foundry leaves nothing behind, and a reorder there changes no note.
So the journal keeps who last deleted or reordered a page the app is sent in Foundry, and when:
`flags["sending-stone"].changed`, `{ what, by, at }`, on the JournalEntry beside `journal`, never in
it; `what` `"delete"` or `"order"`, `by` the user's id, or `null`, and `at` Foundry's server time
(`game.time.serverTime`), whole milliseconds. The bridge hears it from the page hooks, with the user
who made each change: the delete of a page the app is sent, or a write of the `sort` of an entry
page it's sent (a chapter's doesn't count: chapters keep the order they were written in), in the
book's own journal. Never the module's own writes, which carry `{ "sending-stone": true }` in their
options and, where core doesn't hand a write's options to its hooks, are known by the pages being
written; nor a page made, a title or text edited (each note says those), a level or ownership
changed, a journal deleted, or a page the app isn't sent: one only the Gamemaster sees, one shown to
some of the journal's players, or an image. As the journal's changes settle, 500 ms after the last,
the latest heard is written to the flag, where it's later than the one there: once for the burst, so
a drag that writes several pages' sorts is one change. The write is the module's own, and doesn't
redraw the journal where it's open (`render: false`). The book follows, with
[`changed`](#journalupdated) to a listener that answers `"notes": 2`. The flag is kept on the
journal, through a reload, a hello and another Gamemaster becoming the bridge. A change made in
Foundry while no Gamemaster is connected isn't recorded: the next hello's book shows what Foundry
holds, and says the change recorded before it.

**One at a time, the book first.** Note commands are made one after another, whichever journal, past
the watchdog too, after the note commands of the same journal fetched before them. Each result is
`"done"` with `messageId` `null`, `visible` `false`, `rolls` `[]` and [`note`](#commandresult),
`{ id, rev }`, or `{ id, rev: null, deleted: true }` for a delete; a refusal `"failed"` with `note`
`{ id, rev }`, the page's revision as Foundry holds it. Before every result, a refusal's from the
journal's lookup on included, the module sends the book as Foundry then holds it, in
[`journal.updated`](#journalupdated), so the book always arrives before the result. A command
fetched while the campaign's hello is on its way, as one that waited for the Gamemaster is when
they come back, has its result wait for the hello: the books follow the hello, then the result. A late
`"done"` after a `"timeout"` is sent; a late refusal isn't, and the next hand-over answers it.

A listener before module 0.34.0 never says `"notes"`, so it's handed no note command and sent no
`journal.updated`, and it may ignore the hello's `features.notes`.

### Saves the game asks for

With **Save and concentration prompts** also ticked for the campaign, its players are
asked in the app for the saving throws the game asks of their characters, where Foundry waits for
a player to click a button on a chat card:

- **dnd5e's concentration check.** After a concentrating character takes damage, dnd5e posts a
  card asking for one, whispered to the character's owners. That character is asked.
- **A save's card.** A spell or feature that calls for a saving throw posts its card with a button
  for it. Each of the campaign's characters it targets is asked.
- **A request in chat.** A Gamemaster posts a saving throw or concentration check from a `/save`
  or `/concentration` enricher's request link. Each of the campaign's characters whose player can
  read it is asked: every one, unless it's whispered.

Since module 0.40.0 a save asked of a transformed character's form is asked of the character: its
prompt id and `actorId` are the character's, it is answered from the character's seat, and the save
is rolled on the form. A card targeting the form, or a concentration card the form speaks,
asks the character, for any listener, and the form's save closes the character's prompt; see [Wild
Shape](#wild-shape).

Since module 0.41.0, to a listener that answers `"companions": 2`, a listed
[companion](#companions) is asked too: by a save card targeting it, where every one of its
characters has a player who can read the card; by its concentration card, whoever it's whispered
to, as a check of concentration gives nothing away, so a familiar the Gamemaster summoned is asked
of its player; never by a Gamemaster's request in chat. It's matched by its live actor among the
companions the campaign was last told of, each once. Its prompt is filed under its key, `actorId`,
its id naming its token's id, or its world actor's, and it's answered with [`of`](#fetching-rolls)
its character and `actorId` its key, from its character's seat, rolled on its live actor as its
character's player, the message marked `companion`; another seat's answer, or its character's own,
is refused `"character"`. Its own save closes it, from the app or clicked on the card in Foundry
with its token selected, so two wolves of one Wolf are each asked and closed alone. A companion
that leaves the list has its prompts closed `"gone"` at once, and an answer after is refused
`"unknown"`. A listener that answers `"companions": 1`, or none, is asked no companion's save, and
its hello lists none.

A card its character's player can't read asks no one, and nor does a roll request a player
[asked for from the app](#descriptions-that-roll), whoever it's posted as. Where Midi-QOL rolls the
saves itself, as
its *Auto Check Saves* has it, or posts and rolls its own concentration card, no card asks, and
since module 0.27.0 its saves are asked as [Midi prompts](#midi-qols-own-saves) instead, while the
character is open in the app; no card of Midi's workflow asks, even where Midi's activities aren't
in place of dnd5e's, so a save is never asked twice. With its *Concentration Check* at "chat only",
it posts dnd5e's card, and the player is asked. Since module 0.27.0, an OverTime effect's card
asking a character to use their action to save (`actionSave`) asks no one: an answer from the app
couldn't count for it.

Each is sent as [`roll.prompt.opened`](#prompts). It stays open for up to ten minutes: until its
character rolls the save from its card, or the card is deleted. Since module 0.29.0 dnd5e's
concentration card asks its character only while they concentrate on something they began
concentrating on no later than the card was posted, as both documents' server times
(`_stats.createdTime`) have it: once the last of those ends, from the app or in Foundry by anyone,
its prompt closes as `"gone"`, a later hello leaves it out and an answer is refused (`"gone"`), and
concentrating on something new after doesn't bring it back. A request in chat for a concentration
check is asked as before, whatever the character concentrates on, and Midi-QOL's own concentration
cards are left to [Midi's prompts](#midi-qols-own-saves), untouched. [`roll.prompt.closed`](#prompts)
says when it closes. The player answers it with a `save` naming it:

| Roll field | Meaning |
| --- | --- |
| `kind` | `"save"`. |
| `key` | One of the prompt's `abilities`. |
| `prompt` | The prompt's `id`. |

Its other fields are a save's. The module makes it as dnd5e does from the card's button: a saving
throw, or a concentration check, against the card's DC, as the character's player, linked to the
card (`flags.dnd5e.originatingMessage`), so the card shows whether they saved. A failed
concentration check ends the character's concentration, all of it, as dnd5e's card does; with
Midi-QOL, Midi ends it, where its Gamemaster has it remove concentration. Since module 0.29.0 the
player may also [end one](#concentration-charges-and-heroic-inspiration) from the app themselves. Refused as `"prompt"`,
with why in `error`: `"off"` (the campaign doesn't ask its players now), `"character"` (another
character's), `"gone"` (its card is gone, or asks no save of the character), `"expired"`,
`"answered"` (the character has rolled it), or `"ability"` (one the prompt doesn't offer, or since
module 0.27.0 a roll of another kind than a `save`). `command.result` adds `outcome`.

### Midi-QOL's own saves

Since module 0.27.0, with **Save and concentration prompts** ticked and Midi-QOL checking saves,
the saves Midi asks of a campaign's characters are asked in the app too, while the character is
open there, the app said it reads them, `"midiPrompts": 1` among its answers' `features`, and its
fetches list the character as `open`; the hello's `features.rolls.midiPrompts` says the game can.
Each is sent as [`roll.prompt.opened`](#prompts), with `source`, to every campaign that has the
character, asks for its players' saves and reads Midi's prompts; the game waits if the character
is open in any of them. One not open isn't asked, and Midi goes its own way at once, as it's set up.
Since module 0.40.0 a save asked of a transformed character's form is asked of the character: its
prompt id and `actorId` are the character's, it is answered from the character's seat, and the save
is rolled on the form. Midi's own concentration card the form speaks is
asked the same; the roll Midi waits for is the form's.
Since module 0.41.0, to a listener that answers `"companions": 2`, a save Midi asks of a listed
[companion](#companions), its workflow's, its OverTime turn save, or its own concentration card the
companion's token speaks, is asked too, in each campaign that asks for its players' saves, reads
Midi's prompts and was last told of the companion; it waits while one of the characters it's a
companion of is open there, as the companion lives on their pages, and goes Midi's way once none
is. Its prompt is filed under its key and answered with `of`, as a card's is, the roll made as its
character's player, even where no player owns it; one whose companion leaves the list goes Midi's
way at once, closed `"gone"`. A character's form is asked as the character, never as a companion.

- **What's asked.** A save, ability check or skill check a Midi workflow on the bridge's browser
  asks of the character (`"midi"`): an NPC's or the Gamemaster's attack, spell or feature, or one a
  player uses from the app, which the bridge makes; a concentration check, in Midi's "item" mode,
  made there too, or on Midi's own concentration card in its "chat" mode, posted there, as when the
  Gamemaster's browser applies the damage (`"concentration"`); and an OverTime effect's turn save,
  check or skill check (`"overtime"`). Not a workflow on a player's browser, as a player's spell
  cast in Foundry, nor on another Gamemaster's; nor a concentration card posted on a player's; nor
  a tool check, a check with no ability, Midi's simulations, or a target Midi has Monk's TokenBar,
  Flash Rolls or Epic Rolls ask, whose requests go once Midi has asked every target; nor an
  OverTime action save's card.
- **Midi decides how it's rolled.** A save Midi fails or passes by itself, by its trackers or for a
  friendly target, isn't asked; of several choices, those Midi fails are left out. The prompt's
  `advantage` is Midi's; for a concentration check, with what Midi adds as it rolls one: the
  character's Midi flags for concentration and dnd5e's own mode for it, and on Midi's card, for
  which nothing is worked out beforehand, the flags and mode of the ability's saves too, each flag
  evaluated as Midi evaluates it. The app rolls that many d20s and offers no other way: the answer
  has `explicit` `false`, no `extras`, and `mode` `1`, `-1` or `0` as `advantage` says, with two
  d20s for `1` or `-1`. Midi works advantage out again as it rolls, so a d20 the player didn't
  roll, where it then rolls more, is Foundry's.
- **The DC**, and whether they saved, only where Midi shows players them: not for saves Midi
  whispers or shows the Gamemaster alone, and only as dnd5e's *Challenge Visibility* has it for
  the workflow's actor; for Midi's concentration card, as for dnd5e's. The roll is made against
  Midi's own DC either way.
- **Answered in the app**, the answer is a `save` (for `"save"` or `"concentration"`), `ability`
  (for `"check"`) or `skill` (for `"skill"`) naming the prompt and one of its choices. It's made at
  once, rolled as Midi rolls a save itself, with its own options, bonuses and the advantage it
  works out, with only the choice made to choose from, the player's dice, and Midi's DC; a skill
  with its own ability unless the check names one; on the token Midi asks of, as the player's.
  Its message is made where Midi's own roll would make one, and shown as that would be; Midi's
  concentration card's check is made as Midi's Gamemaster would, its message whispered to the
  Gamemaster. The rolls are Midi's, and what Midi makes of them is its own: the damage, the effects,
  concentration ended, an OverTime effect removed. The prompt closes as `"answered"`, then once
  Midi has decided whether they saved, or ten seconds on, the result follows: `"done"`, with
  `messageId` `null` where no message was made, `visible` `true`, and `outcome` Midi's verdict,
  where the DC was sent and Midi shows players whether they saved. Refused as `"prompt"`, with
  why in `error`: as for any prompt, `"expired"` once the wait is over or the save went Midi's
  way, `"answered"` once answered, being answered or rolled in Foundry, `"character"` for another
  character's or in a campaign not told of it, `"ability"` for another kind of roll or a choice not
  offered, and `"mode"` for one with `explicit` or `extras`.
- **Asked in Foundry too.** Where Midi asks the player in Foundry at once, in its chat request
  ("chat" *Player Roll Saves*) or a roll dialog on their screen ("dialog" ones), the prompt says
  `askedInFoundry`, and both are asked: the first answer is the one Midi takes, and the other
  closes, as `"rolled"` in the app, and in Foundry, Midi's request card deleted, or Midi's roll
  dialog closed on the player's screen, unrolled, by the module in their browser: the answer's
  message is made as theirs, the player Midi asked, and names the workflow and the character. So
  Midi's own *Player Save Timeout* on their screen doesn't roll the save again and post it; an
  answer made just as that timeout is up may still meet Midi's roll there, which Midi then ignores,
  though it's posted. The wait is Midi's *Player Save Timeout* where that's shorter. An answer that fails, or
  that a module calls off, gives Midi's chat request back, its *Player Save Timeout* with it,
  counted from when Midi asked, which rolls the save once it's up, as Midi's would have; a roll in
  Foundry before then is the save. Anywhere else, as for a player not in Foundry, Midi waits on
  the app, and asks as it's set up only once the app's wait is over.
- **The wait** is a minute: then, or once the character is no longer open, or the bridge or the
  campaign no longer asks, the save goes Midi's way, closed as `"expired"`; an aborted workflow's
  closes as `"gone"`. Midi's concentration card held for the app is marked so; held when the
  Gamemaster reloads, it's rolled as Midi would once their browser is the bridge again, so no
  check is lost. Where several Gamemasters are connected, Midi may route a roll left to it to its
  preferred one, as it's set up.
- **Known Midi behaviour.** In its chat request, Midi takes any roll message whose speaker is the
  target's token as the save, another workflow's request for the same token among them.

### Descriptions that roll

Since module 0.17.0 a player can act from the app on the [links in their character's
descriptions](#links-in-descriptions): ask the table for a saving throw a description calls for,
or since module 0.18.0 a check, roll that saving throw or check themselves against its DC, and roll
a description's damage, healing or other roll with their dice. Each names its link by the
description's hash, `text`, and the link's `data-n`, `link`:

| `kind` | What it does | Offered |
| --- | --- | --- |
| `ask` | Asks the table for a description's saving throw, concentration check or check, on dnd5e's roll request card. | Where players' rolls are made, under dnd5e 5. |
| `save` with `text` and `link` | Rolls that saving throw or concentration check, against its DC. | Where players' rolls are made. |
| `skill`, `tool` or `ability` with `text` and `link` | Rolls one of the checks a description's check offers, against its DC. Module 0.18.0. | Where players' rolls are made. |
| `textRoll` | Rolls a description's roll, such as `[[/r 1d4]]`. | Where players' rolls are made, under dnd5e 5. |
| `textDamage` | Rolls a description's damage or healing; since module 0.19.0 as a critical hit's, or changed in the app. | Where the Gamemaster lets the campaign's players attack too, and the self-test has checked that damage takes their dice, under dnd5e 5. |

Under dnd5e 6, whose damage, healing and roll requests are messages of kinds of their own, only a
`save`, or a check, rolled for a link is offered yet, and one of the others fetched anyway is
refused as `"off"`: a card for a description's damage posted as dnd5e 5 posts it would have no tray
to apply it from there.

The module reads the link from its own copy of the description, as it sent it, among the
descriptions the character's sheet refers to now: the app sends no formula or DC of its own, and
what a player can roll is only what a description on their sheet says. Refused for any of them:
`"gone"` for a description the sheet no longer refers to, as once it's edited, its item or effect
is gone, or the character's numbers it shows have changed, so that it has a new hash, which comes
with the `character.updated` that changes it; and `"link"` for a link that isn't in it, or isn't
of the kind, or a description that's a condition's rules.

**Asking the table.**

```json
{ "id": "r4", "actorId": "aB3…", "kind": "ask", "text": "7a1c3e5f9b2d40", "link": 0 }
```

The module posts dnd5e's own roll request card, as a Gamemaster could from the description's
link: a button for each ability the saving throw offers, or one for a concentration check, or one
for each check a check offers, as dnd5e's request for a choice of checks makes them (its `type`,
`ability`, and `skill` or `tool`, the `short` format, and for a skill checked using a tool,
`data-using-tool`), each labelled with its DC and without, for dnd5e to show the one each viewer may
see; or for a link whose author hid its DC, labelled without it either way, the DC on the button
marked hidden (`data-hide-dc`), for rolls from the card to be judged by, as dnd5e's own request has
it:

```html
<button data-type="skill" data-ability="str" data-skill="ath" data-dc="15" data-format="short" data-action="rollRequest" data-visibility="all">
```

It's for the Gamemaster, to roll for the creatures it calls on, and anyone in Foundry may click it;
it asks no one in the app, and opens no [prompt](#saves-the-game-asks-for). It's posted as the
character's player (the user whose character it is, or else its only player, or else the
Gamemaster), spoken as the character, for everyone to see, with the flavor `Roll Request: ` and
where the description comes from, its name escaped: its item's name, as an item not identified yet
is called; `Spell (Item)` for the spell an item casts; an effect's name; or the character's, for
their biography. It's flagged `flags["sending-stone"].request` with the ask's `id` and
`flags["sending-stone"].ask` with `{ actorId, text, link }`; and for an item's description,
`flags.dnd5e.item` with the item's `{ id, uuid, type }`, or for a spell an item casts, the item's
that casts it. It's sent in chat with its [`ask`](#chat-message), and `command.result` names its
`messageId`, with no rolls. Refused: `"off"` also under dnd5e 6, whose requests are messages of
their own kind; `"link"` for a link that isn't a saving throw, concentration check or check;
`"secret"` for one in a secret section, which only the character's owners and the Gamemaster see,
and the card would show everyone; and `"busy"` while the character asked within the last 10 seconds,
or asked for the same link within the last 30.

**A saving throw against its DC.** A `save` may name a description's saving throw with `text` and
`link`, both or neither, and never with a `prompt` (`"invalid"`). Its `key` must be one of the
link's abilities, or for a concentration check that names none, Constitution or the character's
own concentration ability (`"link"`), which is rolled with the character's own either way, as
dnd5e rolls it from the link. The module makes it as dnd5e does from the link, without its
dialog, as the character's player: against the link's DC, if it has one, even one its author hid,
and a concentration check without one against dnd5e's 10, so the card shows them whether they
saved; and `command.result` adds `outcome`, `"success"` or `"failure"`, when `visible`, or `null`
for a save against no DC. A concentration check is made as one, with what adds to it,
such as War Caster; failed, it doesn't end concentration, as dnd5e's link doesn't: that's left to
the Gamemaster, or to Midi-QOL as they have it set up. One in a secret section may be rolled so.

**A check against its DC.** Since module 0.18.0 a `skill`, `tool` or `ability` may name a
description's check with `text` and `link`, as a save does, and never with a `prompt` (`"invalid"`):

```json
{ "id": "r6", "actorId": "aB3…", "kind": "skill", "key": "ath", "text": "7a1c3e5f9b2d40", "link": 3,
  "mode": 0, "explicit": false, "extras": [], "dice": [ { "faces": 20, "results": [14] } ] }
```

Its `kind` and `key` must be one of the checks the link offers (`"link"`): `"ability"` with the
ability for a `check:<ability>`, `"skill"` with the skill for a `skill:…`, and `"tool"` with the
tool for a `tool:…`. The module makes it as dnd5e does from the link, or from its request card,
without its dialog, as the character's player: with the ability the link names for that check, which
may not be the character's own for that skill or tool; a skill checked using a tool with that tool,
for dnd5e to give advantage where the character is proficient with both, a d20 the player didn't
roll being rolled by Foundry; and against the link's DC, if it has one, even one its author hid. A
tool needs no proficiency, as in dnd5e, and may be a kind of vehicle; a skill must be one the
character has, and a tool one dnd5e has (`"unknown"`). `command.result` adds `outcome`, as for a
save: `"success"` or `"failure"`, when `visible`, or `null` for a check against no DC. One in a
secret section may be rolled so.

**A check activity's check.** Since module 0.21.0, where the hello says `activityChecks`, a `skill`,
`tool` or `ability` may name instead the `item` and `activity` of one of the character's check
activities, both, each an id, as the sheet lists them, a forward's or a Cast activity's too, or a
forward's the sheet leaves out as a repeat of another, and then never a `text`, `link` or `prompt`.
One naming only one of them, or them with a `text`, `link` or `prompt`, is refused (`"invalid"`,
`"item"`), as is any kind but these, an `attack`, a `use` and a `formula` naming either:

```json
{ "id": "r7", "actorId": "aB3…", "kind": "tool", "key": "thief", "item": "kT9…", "activity": "pQ2…",
  "mode": 0, "explicit": false, "extras": [], "dice": [ { "faces": 20, "results": [9] } ] }
```

Its `kind` and `key` must be one of the `checks` of the activity's [`check`](#what-an-item-rolls),
as for a description's, and the check the character's own, `own`, not a spell's (`"activity"`). The
module makes it as dnd5e rolls it from the button on the activity's card, without its dialog, as the
character's player, using nothing and spending nothing, with no card of the activity's: with the
ability the activity names for it, against the activity's DC as its `check`'s `dc` has it, so
against none where that's `null`, as for a DC above 99, and for a tool item's check of its own tool
with the item's bonus and proficiency, as `bonus` says. `command.result` adds `outcome`, as for a
description's check. Refused: `"item"` for an item not the character's, not identified yet, or a
spell its item can't cast now; `"activity"` for an activity they can't see, one that, a forward
followed, each along the way one they can see, or a Cast activity's spell taken, isn't a check
activity used here, as one that scales or any under dnd5e 6, is a spell's, or doesn't offer that
check; and `"unknown"`, as for any check, for a skill the character hasn't, or a tool dnd5e hasn't.

**A description's damage or healing.**

```json
{ "id": "r5", "actorId": "aB3…", "kind": "textDamage", "text": "2c8e1f4b6a0d93", "link": 1,
  "types": ["fire", null], "dice": [ { "faces": 6, "results": [3, 5] }, { "faces": 4, "results": [2] } ] }
```

| Roll field | Meaning |
| --- | --- |
| `text`, `link` | The description, and its damage or healing link. |
| `types` | Optional: for each of its parts, in order, the kind of damage chosen from that part's types, or `null`. A part with no choice made is rolled as the first kind it names. A kind a part doesn't offer, or more kinds than parts, is refused (`"type"`). |
| `critical` | Optional: `true` to roll it as a critical hit's, as dnd5e's rules make a critical hit's damage (since module 0.32.0, as [any](#making-a-roll) made for the app; before it, with those of modules that change them, such as Midi-QOL's); `false` or left out for not. Its `dice` are then each dice term's as many times over as the sheet's [`critical`](#character-sheet) `perDie` says, with what a critical hit adds to each part, as its span's [`data-critical-dice` and `data-critical-damage`](#links-in-descriptions) say (module 0.20.0): the extra dice on the part's first die as the sheet's `bonusDice` says, and its critical damage's dice after. Never for healing, nor for damage marked `data-critical="false"` without that pair (`"invalid"`, `"critical"`), nor where the activity dnd5e's link rolls it through allows none now, or what it adds can't be read; `true` on a `textRoll`, or anything but a boolean, is refused the same way. Module 0.19.0. |
| `modifiers` | Optional, where the hello says `modifiers`: `{ extra, faces, maximize }`, each optional, how the player changed it in the app, as an [attack's damage](#attacks) may be, healing too. `extra` more of its first part's first die that it adds, never one it takes away (module 0.21.0; before, its first die whatever its sign; a listener without the hello's `signedDice` should change it only where that's the same die), up to 40: for a critical hit's, `perDie` more for each, else one; a first part with no such die has none to change (`"dice"`); `faces` that die another size, `4`, `6`, `8`, `10` or `12`; `maximize` every die at its highest, the game's own too, but since module 0.21.0 never for damage that takes a die away, such as `- 1d4 + 4`, nor since module 0.22.0 for damage with a die Foundry would roll again at its highest, one that explodes or rerolls on its highest face, such as `1d6x` (`"invalid"`, `"modifiers"`). `dice` are then the changed ones. Refused on a `textRoll`, or where it can't be read (`"invalid"`, `"modifiers"`). Module 0.19.0. |
| `dice` | One `{ faces, results }` for each dice term of its parts' formulas, in order, with as many results as the term has dice, as for a [formula](#hit-dice-and-formulas); as a critical hit's and as changed, if so. For a critical hit's, each part's own dice terms come first, in its formula's order, the first's count with its extra dice and the player's change, then its critical damage's dice terms, in order; then the next part's. |

It's rolled as dnd5e rolls its description's link, without the damage dialog: a roll for each
part, of the kind chosen for it; as a critical hit's, where the player chose one, as dnd5e's own
link is where its roller does, so with the world's rules for a critical hit's damage, its *Critical
Damage Modifiers* and *Powerful Critical* (before module 0.32.0, or the Gamemaster's critical damage
rules of Midi-QOL; since module 0.33.0 its dice alone doubled, never a number, whatever *Critical
Damage Modifiers* says, as [any](#making-a-roll) made for the app),
and where dnd5e's link rolls it through one of the item's activities, with what that activity adds
to a critical hit's, as the activity is now, such as a melee weapon's extra dice and an attack's
critical damage, its critical damage rolled with its flavor, for its kind of damage, and never where
it allows none, even should it have come to allow none since the description was sent (`"invalid"`,
`"critical"`); and changed as the player chose, as an attack's damage is: the first part's first die of its own that it
adds, never one it takes away, is changed before it's rolled, and a critical hit's dice made again,
as the world makes them, and damage at its highest has every die at its highest, but for damage
that takes a die away, which isn't rolled so (`"invalid"`, `"modifiers"`). Damage changed where
the self-test found it isn't changed as expected is refused (`"self-test"`); a critical hit's is still rolled. The card is the player's,
spoken as the character, with the flavor
`<where it comes from> - Damage Roll`, or `Healing Roll`, and `flags.dnd5e` of `{ messageType:
"roll", roll: { type: "damage" }, targets: [] }`, `type` `"healing"` for healing, with `item` as an
ask has it, for dnd5e to head the card with it, but none for a spell an item casts: dnd5e would
head its card with the item alone, in place of the flavor naming both. It names no targets: the
Gamemaster applies it from the card, as from dnd5e's own link; dnd5e heads an item's critical
hit's with "Critical Hit". Even with Midi-QOL, it's the roll alone, outside any workflow:
dnd5e's `dnd5e.rollDamage` hook isn't called, so no workflow waiting for damage takes it. Its
rolls in `command.result` have `critical`. Refused:
`"attacks-off"` while the Gamemaster doesn't let the campaign's players attack, `"self-test"`
where damage doesn't take their dice, and `"dice"` for dice that aren't the ones its formulas
throw, as a critical hit's and as changed, as when the world's rules for critical hits or what the
activity adds changed since the app was told them, or there's no die of its own to change in its
first part; or a formula with a die no player rolls, such as a d3, or dice inside parentheses or a
function; and since module 0.20.0, damage that, once built and changed, can't take every die the
player rolled, as an attack's.

**A description's roll.** A `textRoll` has the same `text`, `link` and `dice`, for an `ss-roll`
link. It's rolled as dnd5e rolls a formula, without its dialog, on a card spoken as the character,
with where it comes from as its flavor, `flags.dnd5e.roll.type` `"generic"`, and the item as for
damage, none for a spell an item casts. Refused as `"dice"` as damage is; and where a module changes the roll so that the player's
dice can no longer reach it, as inside a function, it's called off, and nothing is posted.

Neither is rolled with advantage or has anything added: `mode`, `explicit` and `extras` may be
left out, and if given are `0`, `false` and empty. A description's roll is never a critical hit's
or changed in the app. Both are flagged
`flags["sending-stone"].request` with the roll's `id`, as other rolls are, and both report their
rolls as other rolls do.

### Damage on its own and recharges

Since module 0.36.0, where the hello's `rolls` `kinds` have them:

- **`itemDamage`**, `{ item, activity, critical?, dice, types?, modifiers? }`: an action's damage or
  healing rolled on its own, with no attack and no use, as dnd5e's sheet Damage button rolls it:
  dnd5e's own damage or healing card for the activity's kind (a save's with its "On save" line),
  public, authored by the player, naming **no targets**, whatever the Gamemaster has targeted (under
  dnd5e 5 `flags.dnd5e.targets` `[]`, under dnd5e 6 `system.targets` `[]`), for the Gamemaster to
  select tokens and apply it from its tray; flagged `flags["sending-stone"].alone`, so that its
  [chat message](#chat-message) has `alone: true`. Nothing is used or spent, unless, since module
  0.41.0, it asks to (below). `dice` are those of
  the row's
  [`tableDamage`](#what-an-item-rolls) `normal`, or `critical` with `critical: true`, changed by
  `modifiers` as a use's damage is, in order; `types` as a use's damage's. dnd5e's own `rollDamage` is
  called, never a module's in its place: under Midi-QOL no workflow starts and nothing is applied
  until the Gamemaster applies it, Midi's own damage roll modifiers still applying as they do to its
  sheet's Damage button (one that changes the dice is refused `"invalid"`, `error` `"dice"`), and
  ammunition an attack fired before is never added. Refused `"off"`, `"attacks-off"` or
  `"self-test"` as a description's damage is; `"invalid"` with `error` `"item"` (no item or activity,
  or a use, targets, description, enchantment, key, combat or prompt named; before module 0.41.0 also
  a slot, attack mode or ammunition), since module 0.41.0 `"slot"`, `"attack-mode"`, `"ammo"` or
  `"consume"` (not a key, a key, an id, or `true`), `"mode"`, `"critical"` (a critical hit the
  activity allows none of, or of a heal),
  `"dice"`, `"types"`, `"modifiers"` or `"of"`; `"gone"` (no such item or activity, one not
  identified yet, a Cast or a forward, or none that rolls damage); `"type"` (a kind its roll doesn't
  offer). Its result is a roll's, as a use's damage's: the card's id and its rolls where visible.
- **`recharge`**, `{ item, activity?, dice }`: a spent recharge, as a breath weapon's Recharge 5–6,
  rolled as dnd5e's own `rollRecharge` rolls it, with the player's one d6, against its recovery's
  formula, `activity` naming the activity whose own uses recharge, left out for the item's own: the
  uses recharged on a success, as dnd5e recharges them, unless dnd5e's hooks keep them as they were;
  the card dnd5e's, public, authored by the player, typed `"recharge"` under dnd5e 6. Refused `"off"`
  or `"attacks-off"`; `"invalid"` with `error` `"item"`, `"dice"` (not one d6), `"mode"` or `"of"`;
  `"gone"` (no such item or activity, or uses that don't recharge); `"charged"` (its uses aren't
  spent). Its result has `outcome`, `"success"` or `"failure"`, and the d6 in `rolls`, where visible.

Both may be a companion's, with [`of`](#fetching-rolls), and the Gamemaster's as the character, `by`
`"gm"`, and typed; a listener before 0.36.0 never sends them.

**With its choices.** Since module 0.41.0, a listener that says `"aloneChoices": 1` in the
`features` of its answers to the campaign's hello or heartbeat, as an integer of 1 or more, is sent
each damaging row's [`tableDamage`](#what-an-item-rolls) with `choices` and `spends`, its characters'
sheets and its companions' alike; one that starts or stops saying it in a heartbeat's answer is sent
every sheet of the campaign again. Where the hello's `features.rolls.aloneChoices` is `true`, an
`itemDamage` may then also name:

| Field | Meaning |
| --- | --- |
| `slot` | A spell slot dnd5e offers the spell, by its key (`"spell2"`, `"pact"`), else refused `"slot"`: the damage is rolled at that slot's level, as dnd5e would roll it cast with that slot. None named: with `consume`, the slot dnd5e's use would pick first; without, the spell's own level, as before 0.41.0. |
| `attackMode` | Of an attack, one of its weapon's attack modes, such as `"twoHanded"`, `"offhand"` or `"thrown"`, else refused `"mode"`: rolled as dnd5e rolls that mode's damage. |
| `ammunition` | Of an attack, the id of ammunition its weapon fires, one of its ammunition options, else refused `"ammo"`, and with `consume`, `"ammo"` too where none of it is left: rolled with it, its damage added as dnd5e adds it. |
| `consume` | `true` only: spend what using it would, once it's rolled. |

`dice` are then those of the plan the choices pick, by the rule [What an item rolls](#what-an-item-rolls)
gives, else `normal` or `critical`, changed by `modifiers` as before. Before anything is rolled or
spent: the slot, the mode and the ammunition as above; with `consume`, a weapon thrown, in a thrown
mode named, or its only mode where none is, with no ammunition and not returning, needs one in hand
(`"consume"`); and, where Midi-QOL makes uses (its activities in place of dnd5e's) and the actor, or
for a character in [Wild Shape](#wild-shape) the character, is in a combat, a Bonus Action is refused
`"bonus-action"` and a reaction `"reaction"` where Midi's Enforce setting applies to the actor
(`"all"`, or its type) and one is used; then the checks of the dice as before; then, with `consume`,
what using it would spend is worked out as dnd5e's use works it out, never the action itself, a
spell slot where casting it spends one, a target spent only in a fight left out of one, and refused
`"consume"`, with dnd5e's own message in `error`, where something isn't there to spend. Under
Midi-QOL, with a mode named, the damage is rolled on a copy whose damage configuration is dnd5e's
own followed by Midi's damage roll modifiers, as Midi adds them, so that the mode holds and Midi's
modifiers still apply; the activity itself is never changed.

The card's flavor is dnd5e's own, `{item} - {damage flavor}`, followed by ` · ` and the slot's level
as dnd5e names it (`"2nd Level"`), where a slot is named; the mode as dnd5e names it (`"Two-Handed"`,
`"Thrown"`), where one is; the ammunition's name, where named; and `"nothing spent"` where `consume`
isn't asked: "Burning Hands - Damage Roll · 2nd Level · nothing spent". Its flags'
`flags["sending-stone"].chosen` is `{ level?, attackMode?, ammunition?, consume }`, `ammunition` its
id. With `consume`, once it's rolled: worked out again, so that what was spent meanwhile leaves
nothing spent; then spent by dnd5e's own `activity.consume`, its hooks able to stop it or let it
write, what was spent read from what dnd5e recorded; concentration begun as dnd5e's use begins it,
with the concentration dnd5e names ended at the limit, where anything was spent or nothing was to
be; the ammunition fired, its quantity less one unless it returns, deleted at none where it destroys
itself; and a weapon thrown, its quantity less one, never deleted. No usage card is posted, and the
action itself is never spent. The card's flavor then gains ` · ` and what was spent, `"spell slot
spent"`, `"use spent"`, `"ammunition spent"`, `"thrown weapon spent"` (joined as a list, `"spell slot
and use spent"`), or `"nothing spent"`, and ` · concentrating` where concentration began, and its
`chosen` gains `spent` and `concentrating`; the damage stands whatever becomes of that. Where Midi's
Bonus Action or reaction was checked, it's marked used once rolled, as Midi's own use marks it.
`command.result` has [`alone`](#commandresult): `{ spent, concentrating? }`. A companion's spends on
the companion. A listener before 0.41.0 says no `aloneChoices`, so it's sent no choices and never
names one; a module before 0.41.0 refuses a slot, attack mode or ammunition `"invalid"`, `"item"`,
and says no `aloneChoices`.

### Dishes from the Magical Recipe Book

Since module 0.38.0 a dish a player cooks and eats in the Magical Recipe Book reaches their
Gamemaster in Foundry, since module 0.39.0 as a card the Gamemasters and the campaign's players see. The listener takes it from the cookbook's
server, by the player's link code, and hands it to the module as a `dish` command; from the card a
Gamemaster chooses who ate it, and each character chosen gets one Active Effect for the time the
cookbook gives it, 24 hours of game time today, one dish at a time. Each campaign takes dishes by its
own switch, **Dishes from the Magical Recipe Book** on its Player actions tab, off until the
Gamemaster turns it on, and only under dnd5e 5: the hello's [`features.dishes`](#bridgehello) says
which. A dish is fetched as a roll is, but for a campaign whose rolls, moves, removals, notes and
favorites are all off too, from a listener that says `"dishes": 1` in the `features` of its answers
to the campaign's hello or heartbeat, as an integer of 1 or more, besides `"commands": true`; one
that stops saying it isn't fetched from for dishes, and is sent no dish events. Under dnd5e 6 the
switch is off as a matter of scope: dnd5e 6.0.5 shims the paths a dish writes, but its exhaustion
and expiry are its own, and it isn't tested.

It's no roll: sent with `mode` `0`, `explicit` `false` and no `extras` or `dice`, naming none of a
roll's fields (`item`, `activity`, `target`, `targets`, `self`, `slot`, `enchant`, `prompt`, `text`,
`link` or `key`), no `transfer`, `remove`, `typed`, `note` or `favorite`, and never `by` or `of`: the
Gamemaster never sends a dish from the app, and no companion eats.

| Roll field | Meaning |
| --- | --- |
| `id` | `"dish-<row>"`, the listener's own id of the dish after `dish-`, the same on every hand-over, at most 64 characters. |
| `kind` | `"dish"`. |
| `actorId` | The character whose player's link code sent it: who sent it, ticked in the dialog, never who ate it. It may have left the campaign since: the card says so, and it's never refused for it. |
| `dish` | `{ queuedAt, body }`: when the listener took it, in milliseconds since the epoch, and the cookbook's body as the listener first took it, `{ version, dish: { id, recipe, status, outcome, cookedOnDay, consumedOnDay }, cook: { name }, message, effect }`. `effect` is `null` for a `"standard"` dish, and otherwise `{ name, ingredients: [{ name, text }], duration: { seconds }, stacks: false, changes }`, each change `{ type, … }` with its dice rolled already. `version` is the cookbook's, `1`, never the envelope's `protocol`. |

A dish refused for what it is is `"invalid"`, with `error`:

| `error` | When |
| --- | --- |
| `"dish"` | A roll's field, a `transfer`, `remove`, `typed`, `note` or `favorite` given; `dish` not an object; `queuedAt` not a positive whole number; `body` not an object. |
| `"by"` | `by` given at all. |
| `"of"` | `of` given. |
| `"version"` | `body.version` isn't one the module reads, `1`. |
| `"body.dish"` | Its `id` isn't an id; its `recipe` isn't 1 to 200 characters; its `outcome` isn't `"boon"`, `"bane"` or `"standard"`. |
| `"body.cook"` | `cook.name` isn't a string. |
| `"body.message"` | `message` isn't a string. |
| `"body.effect"` | An effect on a standard dish, or none on a boon or bane; or its `name` blank or over 300 characters, its `ingredients` not at most 20 of `{ name, text }`, its `duration.seconds` not a positive whole number, or `stacks` not `false`. |
| `"body.changes"` | `changes` not an array of at most 100 objects, each with a string `type`. A change's own fields are checked as it's mapped: one that fails is skipped, never the dish. |
| `"dice"` | It throws dice. |

| `reason` | When |
| --- | --- |
| `"off"` | The campaign is gone, its switch is off now, or the system isn't dnd5e 5. |
| `"invalid"` | As above. |
| `"error"` | Posting its card failed, or a module's hook refused it; the listener hands it over again. |
| `"timeout"` | Not answered within a minute. |

Never `"unknown"`: a cook no longer in the campaign still gets a card.

**The card.** Posted by the bridge's own user, a Gamemaster, never a player, whom a whisper would
show it to as its author; since module 0.39.0 whispered to every Gamemaster and every player who
owns one of the campaign's characters as it's posted, so its [chat message](#chat-message) reaches
those players' app, as text, in this campaign only, though one of them plays in another (before, it
was whispered to the Gamemasters alone, `gmOnly`, sent only with **GM-only details** on); spoken by
the cook's character where it's still the campaign's, else by the cook's name in the cookbook. The whole dish is in its
`flags["sending-stone"].dish`, `{ command, app, campaignId, cookId, queuedAt, body, state, applied,
decided }`, `state` `"waiting"`, `"applied"` or `"dismissed"`, so a reload, another Gamemaster or the
same dish handed over again can act from it. It says the recipe and its outcome; who cooked it in the
cookbook and how long ago it was sent; whose link sent it; the cookbook's words and each
ingredient's; what was rolled once for everyone; what isn't applied by itself; that a damage bonus is
only an attack's, and a sense no token's vision; and how long it lasts. Every string from the cookbook
is escaped, and made inert for Foundry's and dnd5e's enrichers, a zero-width space breaking `[[`,
`]]`, `@Word[` and `&Word[`, wherever it's shown: on the card, in the dialog, in the effect's name and
description, and in a notification. A Gamemaster's client draws its buttons: **Apply…** (or, for a
standard dish, **Who ate it…**) and **Set aside** while it waits; once eaten, who ate it and
**Apply to others…**; once set aside, by whom. Players' clients draw what became of it, never a
button, and a player's call of what the buttons do changes nothing. Each block of the card is its
own line in its content, so its chat message's `text` reads them apart.

**What's written.** For each character the Gamemaster ticks, one at a time: a character that has eaten
this dish already, by its effect or the card's list, is skipped; any earlier dish effect is deleted
first, so it never holds two, and named `replaced`; then one Active Effect, `type` `"base"`, its
`name` the cookbook's, plain, its `description` each ingredient's words and what was rolled, no
`origin`, a `duration` of `{ value, units, expiry: null }` (whole hours as hours, else seconds), its
`start` the world time when applied, and in `system.changes` every change it maps, each a string
`value` of phase `"initial"`, on dnd5e 5.3.3's paths (`abilityScore` a score, `rollMode` a check's,
save's or skill's `roll.mode`, `rollBonus` each kind of attack's bonus, ability checks' or saving
throws', which a death save adds too, once, `maxHitPoints` `hp.tempmax`, the value rolled, never its
formula, `damageResistance`, `damageVulnerability` and `conditionImmunity` their traits, `sense` its
range in the character's units, the larger kept); its flags `flags["sending-stone"].dish`, `{ id, app, card,
recipe, outcome, cook, appliedAt, expiresAt, seconds, maxHp, healed, exhaustion, replaced, skipped }`.
Once made, its one-offs: hit points healed by the net `maxHitPoints`, never past the new maximum, and
`exhaustion`'s levels added, up to 6, unless the character is immune. A standard dish writes no
effect, replaces nothing, and only says who ate it. Then the card, once, with whoever was served
merged into its list by character as it then stands: `state` `"applied"`, `applied`, and `decided`,
`{ userId, name, at, worldTime }`. One character whose steps fail is left out, so **Apply to
others…** may try it again, and named to the Gamemaster. **Set aside** writes `state` `"dismissed"`
and `decided`, while it waits alone. A dish effect is deleted by the bridge once its time has passed,
as world time moves and when a client takes over as the bridge, whatever the campaign's switch or the
system: core marks it expired and suppresses it, and the module deletes it, as nothing else here does;
one whose duration the Gamemaster changed by hand ends by its new duration. A long rest wakes a
character holding a dish that raised its maximum at that maximum. Two Gamemasters serving one
character at the same moment may each leave it a dish effect: the bridge keeps the newest.

**The result.** Answered as soon as the card is posted, never at the Gamemaster's choice: `"done"`,
with `messageId` the card's id, `visible` `true` where the cook's player is among its readers (since
module 0.39.0; `false` for a card posted before, and one answered from its tombstone), `rolls` `[]`,
and [`dish`](#commandresult), `{ card, state }`.

**Made at most once.** A dish is handed over until it's answered, so it may arrive more than once:
after a reload, a result lost on its way, or while its first run still goes. One whose card is in the
chat log is answered again from it, `state` its card's, and its decision, if it has one, is sent
again; one whose card was deleted undecided is answered `"dismissed"` from its tombstone, and its
deletion sent again; and one whose card was deleted once decided is answered its choice from its
tombstone, and its decision sent again where this session saw the card deleted, or it was set aside.
None posts anything. While a dish is being made, the same command handed over again is ignored, and
the run answers it. Dishes are made one at a time, each after the last, and wait for no roll of the
cook's.

**Telling the listener.** [`dish.applied`](#dishapplied) and [`dish.dismissed`](#dishdismissed), from
the bridge alone, to a listener that says `"dishes": 1`; again after a temporary drop, and after
every hello for 30 days.

A listener before module 0.38.0 never says `"dishes"`, so it's sent no dish events and fetched for no
dishes, and it may ignore the hello's `features.dishes`. A module before 0.38.0 handed a dish anyway
answers `"off"` while the campaign's rolls are off, else `"invalid"` with `error` `"kind"`.

### A player's own effects

Since module 0.39.0 a player can turn off, turn back on and delete effects on their own character
from the app, as dnd5e's sheet toggles and deletes them, where the campaign's Gamemaster lets them:
**Allow Players to disable & remove their own active effects**, under **Active effects** on the
campaign's Player actions tab, off until the Gamemaster turns it on, apart from the campaign's
rolls. Under D&D Fifth Edition, 5 and 6 alike, the hello's [`features.effects`](#bridgehello) is then
`{ enabled: true, kinds: ["effect"], reason: null }`; with the switch off it's `{ enabled: false,
kinds: [], reason: "off" }`, and with it on under another system `reason` `"system"`. An effect
command is fetched as a roll is, but for a campaign whose rolls, moves, removals, notes, favorites
and dishes are all off too, from a listener that says `"effects": 1` in the `features` of its answers
to the campaign's hello or heartbeat, as an integer of 1 or more, besides `"commands": true`; one
that stops saying it isn't fetched from for effects. A roll fetched while only effects are is
refused `"off"`, as while rolls are off.

**Which effects.** The module says, for each effect in the [sheet](#character-sheet), what its
player may do to it from the app, `ops`: `"disable"`, `"enable"`, `"delete"`, in that order, or none.
The listener offers what `ops` lists and the module checks it again as the character now is. It's
the same in every campaign, as a sheet is built without one; the hello says whether a campaign
takes them. A companion's sheet carries `ops: []` on every row: a companion's effects take no
commands.

- On the character itself, an effect the party put there: a dish's
  ([Dishes from the Magical Recipe Book](#dishes-from-the-magical-recipe-book)), or one whose
  `origin`, as dnd5e records it, names a spell or feature of a character a player owns, the
  character's own or an ally's, such as Bless from an ally's concentration. An `origin` naming an
  effect counts by what that effect is on; one naming an actor itself counts as made on that actor's
  sheet, as dnd5e names the sheet's own actor there, and so does none, or one with no actor, as a
  compendium's: those stay the Gamemaster's. Such an effect may be turned off and deleted.
- On one of the character's items, a temporary effect, such as Rage on the Rage feature: turned off,
  never deleted, which would change the item for good. A passive one, such as a ring's bonus, gets
  nothing.
- Either is turned back on only where its player turned it off from the app.
- One that has expired may only be deleted; an item's, nothing.
- Never a condition (a dnd5e 5 condition's effect, by its fixed id, or dnd5e 6's `type`
  `"condition"`), a concentration or an effect the character's own concentration keeps up, which
  [End](#concentration-charges-and-heroic-inspiration) ends; never anything dnd5e hides from the
  player, nor an enchantment.

**The mark.** An effect turned off from the app is marked, `flags["sending-stone"].offByPlayer`
`true`, written in the same update; turning it on from the app writes it `false`. Any other change to
whether it's on, in Foundry or by a module, clears the mark in the same write (the module's
`preUpdateActiveEffect` hook, on every client). So an effect the Gamemaster turned off stays off,
and an item's Rage isn't started from the app without spending a use.

It's no roll: sent with `mode` `0`, `explicit` `false` and no `extras` or `dice`, naming none of a
roll's fields (`item`, `activity`, `target`, `targets`, `self`, `slot`, `enchant`, `prompt`, `text`,
`link` or `key`), no `transfer`, `remove`, `typed`, `favorite`, `note` or `dish`. Nothing is posted in
chat, as dnd5e posts nothing when its sheet toggles or deletes an effect, so only a character's
player makes one: never the Gamemaster as them, which would leave no mark (`by` `"gm"` is refused
`"invalid"`, `error` `"by"`), and never for a companion (`of` is refused `"invalid"`, `error`
`"of"`).

| Roll field | Meaning |
| --- | --- |
| `kind` | `"effect"`. |
| `actorId` | The player's own character. |
| `effect` | `{ op, id }`, and nothing else: `op` the state wanted, `"disable"`, `"enable"` or `"delete"`, never a toggle, so a command handed over twice can't flip twice; `id` the effect's as the sheet names it, its own on the character, or its item's and its own joined by one `.`, each 1 to 64 letters and digits. |

An effect refused for what it is is `"invalid"`, with `error` `"by"`, `"of"`, `"effect"` (no
`effect`, or one not exactly `{ op, id }` as above; a roll's field, a `transfer`, `remove`, `typed`,
`favorite`, `note` or `dish` beside it) or `"dice"`. Everything is checked before anything is
written, as the character now is, in this order:

| `reason` | When |
| --- | --- |
| `"off"` | The campaign is gone, its switch is off now, or the system isn't D&D Fifth Edition. The campaign is read again, as a queue's wait may leave it changed. |
| `"invalid"` | As above: `by`, then `of`, then what it names, then `"dice"`. |
| `"unknown"` | `actorId` isn't one of the campaign's characters with an actor; one of its groups is unknown too. |
| `"shaped"` | Since module 0.40.0, while the character is transformed, as by Wild Shape: its form's effects are copies, which the form's sheet lists with `ops` `[]`, and its own wait for its return. |
| `"gone"` | No effect the character's sheet could list has that `id`, for `"disable"` or `"enable"`. A `"delete"` of one gone is `"done"`. |
| `"effect"` | Its `ops` are empty now, or lack the `op` and it isn't already so: Turn on of one the Gamemaster turned off, or of one that has expired, Delete of an item's, anything of an effect its player may not change. |
| `"cancelled"` | The write was made, and read again, nothing had changed: a module's hook, or Foundry, stopped it. No sheet is sent. |
| `"error"` | Foundry's update or delete threw; `error` is what it said. A delete that throws once the effect is gone anyway, as with what kept it up, is `"done"`. |
| `"timeout"` | Not answered within a minute. |

**Already so.** Turn off of one that's off, Turn on of one that's on, and Delete of one that's gone
are `"done"` with nothing written: the listener may have shown an older sheet.

**The write.** With the option `{ sendingStone: "effect" }`: Turn off is `update({ disabled: true,
"flags.sending-stone.offByPlayer": true })`, Turn on `update({ disabled: false,
"flags.sending-stone.offByPlayer": false })`, Delete `delete()`. Then it's read again: a delete is
done only where no effect of the character's has that `id`, an update only where it's now as asked.

**One at a time.** An effect command waits for its character's earlier commands, and their next
ones for it, as a favorite does.

**The result.** The character's sheet as it then stands goes first, on every `"done"`, in
[`character.updated`](#characterupdated), unless it's what the listener was last sent. Then
`"done"`, with `messageId` `null`, `visible` `true`, `rolls` `[]` and
[`effect`](#commandresult), `{ id, disabled, deleted }`: `disabled` whether it's turned off now,
`null` once deleted, and `deleted` `true` for a delete. A refusal has no `effect` and sends no sheet.

**Midi-QOL.** Midi's own `deleteActiveEffect` hook, on the active Gamemaster's client, ends a
caster's concentration once no effect it kept up is left: deleting an ally's Bless from the app can
end the ally's concentration, as deleting it in Foundry does.

A listener before module 0.39.0 never says `"effects"`, so it's handed no effect command, and it may
ignore `ops` and the hello's `features.effects`. A module before 0.39.0 has neither; handed an effect
command anyway, it refuses it `"off"` where the campaign's rolls are off, else `"invalid"`, `error`
`"kind"`.

### Wild Shape

Since module 0.40.0 a 2024 druid's player can choose the Beasts the druid knows, change into one and
back, from the app, where the campaign's Gamemaster lets them: **Allow Players to use Wild Shape from
the app**, under **Wild Shape** on the campaign's Player actions tab, off until the Gamemaster turns
it on, apart from the campaign's rolls, and **Beasts come from**, the world's Actor compendiums the
campaign's druids learn Beasts from (`wildShapePacks`), dnd5e's 2024 Actors (`dnd5e.actors24`) until
the Gamemaster chooses; one the world has no longer is left out. Under D&D Fifth Edition, 5 and 6
alike, the hello's [`features.wildShape`](#bridgehello) is then `{ enabled: true, kinds:
["wildShape"], reason: null }`; with the switch off `{ enabled: false, kinds: [], reason: "off" }`,
and with it on under another system `reason` `"system"`. A Wild Shape command is fetched as a roll
is, but for a campaign whose other switches are all off too, from a listener that says
`"wildShape": 1` in the `features` of its answers to the campaign's hello or heartbeat, as an
integer of 1 or more, besides `"commands": true`; one that stops saying it isn't fetched from for
Wild Shape, and is sent its characters' own sheets. A listener that starts or stops saying it in a
heartbeat's answer is sent every character of the campaign again.

**The rules**, the 2024 ones, for a druid whose class has dnd5e's `known-forms` scale value and level
2 or more: the druid knows 4, 6 or 8 Beasts by druid level (`known-forms`), each a Beast's stat
block, no swarm, with a Challenge Rating up to the druid's `wild-shape` scale value, or for the
Circle of the Moon (the subclass's identifier `moon`) a third of the druid level from level 3,
whichever is higher, and no Fly Speed before level 8 (`movement.fly`, or dnd5e 6's
`movement.speeds.fly`, as an index entry saved under dnd5e 6 has it); not a spell's, an item's or a
summon's creature (a compendium folder, or one within one, named Conjurations, Magic Items or
Summons). A change gives the druid temporary hit points, the druid level, or three times it for the
Moon, unless the druid has more already, and lasts half the druid level in hours; the Moon's armor
class is at least 13 and the druid's Wisdom modifier. A 2014 druid's Wild Shape is used in Foundry:
that druid's sheet has no `wildShape` block, and a form taken there is followed but never timed or
returned from the app.

**Known forms** are kept where dnd5e keeps them: the druid's own Wild Shape feature's Transform
activity's linked forms ("By Direct Link", `transform.mode: ""`), one profile each, `{ _id, name,
uuid }`, the uuid a compendium Beast's, so dnd5e's sheet and Tidy 5e offer the same forms in place of
the Challenge Rating browser. A druid with none yet has Wild Shape as dnd5e ships it; the first
`learn` links forms and drops its Challenge Rating profiles. A known form from the campaign's
compendiums is loaded once on the bridge and listed with its numbers (`wildShape.known`, on the
[sheet](#character-sheet)); one from anywhere else, as a world actor or another pack, put there in
Foundry, is listed by its profile's name alone, `pool: false`, never loaded, and used only in
Foundry. One that no longer fits the rules (`fits: false`) or can't be found (`found: false`) is
listed, marked, and not taken from the app. A profile with no name, as dnd5e's own sheet adds a
dropped creature, is named by what the character's players could see already, never loading it: a
compendium entry's name, from the campaign's compendiums or one they may observe, a world actor's
they may observe, else "Foundry form", a bare name as a Beast's is, to which the listener adds "a"
or "an" as it does to any form's.

**The Beasts to learn**, the `forms` op's answer: `forms`, the Beasts of the campaign's compendiums
the druid may learn now, by the rules above, each `{ uuid, name, img, size, cr, ac, speeds, known }`:
`uuid` its compendium Actor's; `img` its portrait or `null`; `size` dnd5e's label of its size, or
`null`; `cr` its Challenge Rating, a number; `ac` its armor class as its compendium's index has it,
its flat armor class where dnd5e works it out as natural or flat, 10 and its Dexterity modifier where
dnd5e works it out by default (as a stat block's is with no armor), else `null`; `speeds` labelled as
the sheet's are, `"Walk 40 ft"`, each speed saved as a plain number read as one, in the world's units
of length where none are saved; `known` whether it's one of the druid's known forms already. No
attack: an index holds none of a creature's items. They're sorted by Challenge Rating, then by name,
at most 200, `more` `true` where there were more than that; `limits` is `{ count, cr, fly }`, as the
sheet's `wildShape.limits`. Only the compendiums' indexes are read; nothing is loaded or written, and
no sheet is sent.

**The replacement after a Long Rest.** dnd5e's `restCompleted` with a Long Rest, on the client that
rested, for a druid of a campaign whose switch is on, with at least one known form, sets
`flags.sending-stone.wildShape.swap` `true` on the druid's Wild Shape feature; a `learn` that
replaces a form writes it `false` in the same update. Filling an empty place needs none. Never saved
up.

It's no roll: sent with `mode` `0`, `explicit` `false` and no `extras` or `dice`, naming none of a
roll's fields, no `transfer`, `remove`, `typed`, `favorite`, `note`, `dish` or `effect`. Only its
player makes one: never the Gamemaster as them (`by` `"gm"` is refused `"invalid"`, `error` `"by"`),
which would pass dnd5e's own Allow Polymorphing for a player who may not, and never for a companion
(`of` is refused `"invalid"`, `error` `"of"`).

| Roll field | Meaning |
| --- | --- |
| `kind` | `"wildShape"`. |
| `actorId` | The player's own character. |
| `wildShape` | Exactly one of: `{ op: "transform", form }`, a change into a known form, `form` its profile's `_id` (16 letters and digits); `{ op: "revert" }`, back to the character's own form; `{ op: "learn", uuid, replace }`, a Beast learned, `uuid` a compendium Actor's (`Compendium.<package>.<pack>.Actor.<id>`), `replace` the profile `_id` it takes the place of, or `null` for an empty place; `{ op: "forms" }`, the Beasts the character may learn listed, as **The Beasts to learn** above says. Anything else is refused `"invalid"`, `error` `"wildShape"`. |

**The checks**, every one before any write, as the character now is. For every op: the campaign read
again, its switch on under dnd5e, else `"off"`; then `"invalid"` (`by`, `of`, `wildShape`, `"dice"`);
the campaign's character, not one of its groups, else `"unknown"`; a 2024 Wild Shape, else `"gone"`.
Then, for `transform`: a known form usable from the app (from the campaign's compendiums, fitting
the druid now, its entry still there), else `"form"`, or `"gone"` for one whose compendium entry was
deleted; not the form the character is now (`"form"`); not another kind of transformation, as a
Polymorph, a 2014 Wild Shape or a form made before 0.40.0 (`"transformed"`); not Incapacitated,
Unconscious, Paralyzed, Petrified, Stunned, Asleep or Dead, nor at 0 hit points, as the actor the
character is now (`"incapacitated"`); a use left, on that actor (`"consume"`); and since module
0.41.0, where Midi-QOL makes uses (its activities in place of dnd5e's) and the character or the form
it's in is in a combat, the Bonus Action Wild Shape takes not used yet on that actor, where Midi's
Enforce bonus actions applies to it (`"all"`, or its type) (`"bonus-action"`). For `revert`: none
shaped is `"done"` with `form` `null`; a form the module doesn't time, `"transformed"`; and since
module 0.41.0, as for a change, the form's Bonus Action not used yet (`"bonus-action"`). For `learn`:
from the campaign's compendiums, else `"form"`; its entry there, else `"gone"`; fitting the druid
now, else `"form"`; known already is `"done"` with nothing written; then for an empty place none left
(`"full"`), and for a replacement a known form (`"form"`), not the one the character is now
(`"shaped"`), and the replacement after a Long Rest not spent (`"swap"`). `forms` reads only the
compendiums' indexes and writes nothing.

**A change.** Shaped already, the character's current form is returned first, as one command. One
use of Wild Shape is spent on the character's own feature, never through its activity, whose
Compendium Browser or card would open on the Gamemaster's screen, read again (`"cancelled"` where a
hook stopped it), and refunded where the change doesn't happen. Then dnd5e's own `transformInto`, on
the Gamemaster's client, with its Wild Shape preset and the module's own numbers, `tempFormula` the
higher of the character's temporary hit points and the change's, `minimumAC` the Moon's floor or
`0`, `transformTokens: false`, no dialog and no sheet shown; dnd5e throwing is `"error"`, the use
refunded. Once the form exists the use is never refunded. The character's linked tokens are switched
on every scene, from dnd5e's own token data for the change, where they stand; the combats the
character is in are sent again; a line goes to chat; the character's sheet goes first, in
[`character.updated`](#characterupdated); then `"done"` with
[`wildShape`](#commandresult) `{ op, form: { id, name, uuid }, temp, hours }`. Since module 0.41.0,
where the Bonus Action was checked, it's marked used on the new form, as Midi-QOL's own use marks
it, before the line goes to chat; and a return so checked marks it used on the character once back.

**The record.** Every transformation, from the app or made in Foundry by anyone, Wild Shape or not,
is recorded on the form as dnd5e creates it (`dnd5e.transformActorV2`), on the client that makes it:
`flags.sending-stone.form`, `{ kind, uuid, name, img, cr, type, size, startedAt, hours, endsAt,
profile, request, baseline }`. `kind` is `"wildShape"` for dnd5e's Wild Shape preset on a druid, else
`"other"`; `startedAt` and `endsAt` world time, `hours` and `endsAt` only for a 2024 druid's Wild
Shape, which the module alone times, ends and returns from the app; `profile` the known form it was
taken as; `request` the command's id, for one from the app; `baseline` what the character had going
in: hit points and temporary ones, each of the character's items the form keeps with its uses spent
and each activity's, each class's hit dice spent, Heroic Inspiration, exhaustion and death saves,
which of the character's own effects the form carries, and each spell slot pool's value. A form made
from a form, as dnd5e chains them, keeps the first's baseline. The character's active form is the
newest of the world actors dnd5e flags as the character's that no later form lists among its
`previousActorIds`, and only one that looks like a form dnd5e made of the character: never one of a
campaign's characters, nor a copy of an actor (Foundry's Duplicate), owned by no player who doesn't
own the character (dnd5e copies the character's ownership onto it), each earlier form it lists the
character or another form of the character. A player owns their own actor and may write dnd5e's
flags on it, so nothing else is followed, ended, returned, deleted or carried back by the bridge.

**The endings.** Where the campaign's switch is on, on the bridge alone, for the character's active
form and only one the module times: its hours of world time run out (`"time"`), the form at 0 hit
points or Dead (`"hp"`), or Incapacitated, by that condition or one that gives it
(`"incapacitated"`). Checked as world time moves, as the form changes, as this client becomes the
bridge, as one whose time ran out while no Gamemaster was connected, and once a command of the
character's on its way is done; never while one is. Each says so in chat.

**What comes back.** dnd5e's return copies back only the character's hit points, temporary hit
points and spell slots, and puts back the viewed scene's tokens. On every return, from the app, an
ending or made in Foundry, the module adds what dnd5e's return would lose, on top of anything done to
the character's own actor meanwhile, as sums from the record's `baseline`: the character's items'
uses and their activities' spent in form, hit dice, exhaustion and death saves, each within its
range; Heroic Inspiration as the form left it where it changed in form; each condition gained in form
put on the character, one effect each, never the statuses it implies; each condition and
concentration that ended in form taken off the character, the character's concentration ended with
what it kept up; the character's tokens put back on every scene, each where it stands then, its
rotation, elevation, visibility and level as they are, not as they were at the change; and the
character's hit points, where the character's own changed meanwhile (a party's Long Rest, a dish),
what the form took added to what the character has, within the maximum, and the character's own
temporary hit points where they changed, else the form's; and likewise each spell slot pool, what the
form spent added to what the character has where the character's own changed meanwhile (a Long
Rest), within its maximum, over dnd5e's copy of the form's. Each return notes its ending on the
character's Wild Shape, `flags.sending-stone.wildShape.ended`, `{ form, why, at, formId }`, `why`
`"app"`, `"time"`, `"hp"`, `"incapacitated"` or `"foundry"`, cleared by the next change; a change of
form while shaped notes none.

**Made in Foundry.** A return made in Foundry, by the character's player or the Gamemaster, is
carried back by the client that made it and noted `"foundry"`. A form deleted by hand from the
sidebar, which dnd5e doesn't return, is treated as a return by the bridge once it's settled (two
seconds), unless a return made it, as its `ended.formId` or the bridge's own return says: the
character's tokens put back, and hit points, temporary ones, spell slots and what was spent or gained
in form carried back to the character. An earlier form
of a chain, deleted with the later one that lists it or before it, is carried on in that later form,
which was made from it: never carried back itself where the later one is a Wild Shape, which holds
what it spent; under another kind, as a Polymorph cast on the shaped druid, what it spent is carried
back, and no hit points, which dnd5e's return of the later one copies. A player's own return in
Foundry leaves the form in the world, unflagged: the bridge deletes it, as a Gamemaster's return
does, at once, or where no Gamemaster was connected, once a client becomes the bridge. A Polymorph or any other kind of transformation is followed (`form.kind` `"other"`, no time) and
returned in Foundry; the module carries nothing back for it.

**The chat lines**, public, from the character, flagged `flags.sending-stone.wildShape` `{ op, form,
why }`: "{name} uses Wild Shape and becomes a Wolf.", "{name} uses Wild Shape again and becomes a
Black Bear.", "{name} is no longer a Wolf: Wild Shape ends.", "{name}'s Wild Shape ends: its 2 hours
ran out." (at levels 2 and 3, "its hour ran out"), "{name}'s Wild Shape ends at 0 hit points." and
"{name}'s Wild Shape ends: {name} is Incapacitated.".

| `reason` | When |
| --- | --- |
| `"off"` | The campaign is gone, its switch is off now, or the system isn't D&D Fifth Edition. |
| `"invalid"` | As above: `by`, `of`, `wildShape`, then `"dice"`. |
| `"unknown"` | `actorId` isn't one of the campaign's characters with an actor; one of its groups is unknown too. |
| `"gone"` | No 2024 Wild Shape; a known form's or a Beast's compendium entry isn't there. |
| `"form"` | Not a known form, or not one usable from the app now; the form the character is now; a Beast not in the campaign's compendiums, or not fitting the druid. |
| `"full"`, `"swap"` | Every place for a known form taken; a replacement with none since the last Long Rest. |
| `"shaped"` | A replacement of the form the character is now. |
| `"consume"` | No use of Wild Shape left. |
| `"bonus-action"` | Since module 0.41.0: Midi-QOL makes uses and enforces Bonus Actions for the actor the character is now, in a combat, and its Bonus Action is used. |
| `"incapacitated"` | Incapacitated, at 0 hit points or Dead. |
| `"transformed"` | A change from, or a return of, a form the module doesn't time: it ends in Foundry. |
| `"cancelled"` | A write a hook stopped, or the form not made, or not gone, read again. |
| `"error"` | Foundry or dnd5e threw; `error` is what it said. |
| `"timeout"` | Not answered within a minute. |

**The seat while shaped.** To a listener that says `"wildShape": 1`, which is sent the form's sheet
under the character's own id, the character's commands are made on the form, its active form, as
that sheet lists it: checks, saves, death saves, attacks, uses, damage, a utility's roll, a
description's roll, hit dice, charges and Heroic Inspiration, each result the character's, queued by
the character's id; what they spend in form is carried back on the return. Refused `"shaped"`, for
every listener, while the character is transformed: a favorite added or removed, an effect changed, a
move to, from or by the character, and a removal; a listener before 0.40.0, sent the character's own
sheet, shows these and has no words for the reason. To any other listener, which is sent the
character's own sheet, the rest are made on the character's own actor, as before. For every listener,
initiative is rolled for the combatant that is the character's now, the form's while transformed (of
the form's token, or of the character's own), on that combatant's actor, as dnd5e rolls it; End Turn
and its Undo act on that combatant's turn. For every listener, a form's
combatant, chat messages and the saves asked of it are the character's: a save asked of the form, by
dnd5e's card or Midi-QOL, is asked of the character, answered from the character's seat and rolled on
the form ([Saves the game asks for](#saves-the-game-asks-for)); a combat with only the form in it
stays the campaign's after the return, and the form's combatant the character's, with the
character's hit points and turn, even one with no token, which still names the deleted form; a chat
message the form spoke stays the character's after the
form is deleted, though Foundry finds no speaker for one with no token; a concentration ended while
transformed is ended on the form and on the character both, and the prompt its card asked closes once
whoever spoke it no longer concentrates; a companion summoned by the form's copy of an item is the
character's while the form exists, and one set to act right after its character follows a combatant
made from the form's token; and a dish cooked while transformed has the character as its cook.

**One at a time.** A change, return or learn waits for its character's earlier commands, and their
next ones for it; `forms`, which writes nothing, waits on a queue of its own.

**Midi-QOL.** A use spent by the module isn't seen by Midi-QOL's or any module's consumption hooks.
Midi's "auto undo transformations" may return the character when a concentration ends: that's a
return made in Foundry.

A listener before module 0.40.0 never says `"wildShape"`, so it's handed no Wild Shape command and is
sent the character's own sheet, without `form` or `wildShape`; while the character is transformed in
Foundry, its favorites, effects, moves and removals are refused `"shaped"`, which it has no words for.
A module before 0.40.0 has neither;
handed a Wild Shape command anyway, it refuses it `"off"` where the campaign's rolls are off, else
`"invalid"`, `error` `"kind"`.
