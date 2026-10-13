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
| Any `2xx` | Delivered. `204 No Content` is fine. A JSON body of `{"resend": "hello"}` asks for the campaign's full state again; see [Keeping in step](#keeping-in-step). In answer to a `bridge.hello` or `bridge.heartbeat`, `{"features": {"commands": true}}` says the listener has players' rolls for the module to fetch; see [Rolls from the app](#rolls-from-the-app). Since module 0.22.0, in answer to those and to a `character.updated`, `features`' `slimSheets` and `maxBytes` say what the listener takes of sheets and posts; see [below](#post-size-and-slim-sheets). All may be in one body. Anything else is ignored. |
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
Gamemaster is told so, if they were told of it. Manage Campaigns shows each campaign's status, as
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
  character as it then stands, and descriptions with the next sheet that refers to them. One
  refused with any other status isn't.

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
in `character.updated`.

A `character.updated` whose post would come to more than the listener takes withholds the sheet
(module 0.22.0): `sheet` is `null`, and `sheetWithheld` says why, `{ reason, bytes, limit }`, `reason`
being `"tooLarge"`, `bytes` what the post came to and `limit` the most the listener takes, both in
bytes. It's otherwise left out; the character's next update without it replaces it.

### Character sheet

What the character's player sees of them, and rolls from: every modifier is the one dnd5e shows on
its own sheet, already including proficiency and fixed bonuses. Bonuses that are dice, such as
Bless or Guidance, are not included; dnd5e adds those only when it rolls.

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
  "features": [
    {
      "id": "fighter", "label": "Fighter Features", "text": "1b7e04c2d9a8f3",
      "features": [
        {
          "id": "kQ1bW7sYp3Xc0RtE", "name": "Second Wind", "img": "icons/magic/life/heart-cross-green.webp",
          "kind": "Class Feature", "requirements": "Fighter 1", "activation": "1 Bonus Action", "passive": false,
          "uses": { "value": 1, "max": 1, "recovery": "Short Rest, Long Rest" }, "text": "05d2e8a1c7b94f"
        }
      ]
    }
  ],
  "effects": [
    {
      "id": "temporary", "label": "Temporary Effects",
      "effects": [
        { "id": "a8LkT3wPz0QcN5vB", "name": "Bless", "img": "icons/magic/control/buff-flight-wings-blue.webp", "source": "Bless", "duration": "9 Rounds", "disabled": false, "text": "3f9c0b2a7d1e64" }
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
  "spellcasting": { "ability": "Intelligence", "dc": 14, "attack": 6, "classes": [{ "name": "Wizard", "ability": "Intelligence", "dc": 14, "attack": 6 }] },
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
    { "type": "resource", "id": "primary", "name": "Superiority Dice", "uses": { "value": 3, "max": 4, "recovery": "Short Rest" }, "itemId": null },
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
| `critical` | How the world rolls a critical hit's damage, for the app to plan a [description's](#descriptions-that-roll): `{ perDie, multiplyNumeric, powerfulCritical, altered }`, each found by building a critical hit's damage as the Gamemaster's client builds it, so with the rules of modules that change it, such as Midi-QOL's critical damage for the Gamemaster, never from dnd5e's settings alone, which Midi's rules may set aside. `perDie` is how many times over each die is thrown, and no other die: `2`, dnd5e's own, or `1` where dnd5e's *Powerful Critical* adds the most its dice could roll instead. `multiplyNumeric`, whether its numbers are doubled, as dnd5e's *Critical Damage Modifiers* does, and `powerfulCritical`, whether the most its dice could roll is added, as dnd5e's *Powerful Critical* does, or Midi's "Max Critical Dice (flat number)": for the app to work out a total by. `altered`, whether the rules change the dice thrown beyond that, as Midi's do that roll them at their highest, double them or keep the highest of them: the app can then work out no total, and the game's is the one that counts, as it always is. `null` where the rules throw dice of their own beside each die, as Midi's that roll a critical hit's dice apart or explode them do, throw dice of one size otherwise than another's, come to numbers neither of dnd5e's settings would, or where it can't be found. `bonusDice` (module 0.20.0), what the rules do with a critical hit's extra dice, such as a melee weapon's for Savage Attacks or Brutal Critical, which dnd5e throws with a part's first die alone (a part's own, `d` of them, are in [`data-critical-dice`](#links-in-descriptions)): `"rolled"`, thrown on that die after it's thrown `perDie` times over, so its count becomes `n × perDie + d`, as dnd5e does; `"maximized"`, not thrown, but `d` times that die's faces added as a number, as Midi's "Max Critical Dice (flat number)" does; `"ignored"`, left out, as Midi's rules that change dice otherwise do; or `null` where that can't be told, as under dnd5e 6's *Powerful Critical*, when no addition with dice may be planned. It's found as the rest is, by building a critical hit's damage: one die with a die more and critical damage of a die and a number, then dice of two sizes with two dice more and critical damage of a number, which must come out the same way, the critical damage added after as it is. Left out before 0.20.0, which counts as `null`; not there when `critical` is `null`. Sent again in [`character.updated`](#characterupdated) when those settings change. Module 0.19.0. |
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
| `features` | Grouped as dnd5e's Features tab groups them: a section for each class (with `id` its identifier), then `"species"`, `"background"` and `"other"`, each with its `label` and the `text` of the class, species or background. Empty sections are left out. |
| `features[].features` | In the order the player keeps them in Foundry. `kind`, such as Class Feature; `requirements`, such as Fighter 1; `activation`, such as 1 Bonus Action; `passive` for a trait or anything with nothing to use; `uses`, if limited, as `{ value, max, recovery }`, with `value` the uses left and `recovery` when they come back, such as Short Rest, Long Rest or Recharge [5–6]. A feature that rolls or is used through anything also has [what it rolls](#what-an-item-rolls), with its `range`, `target` and `concentration`, as an action's. |
| `effects` | Grouped as dnd5e's Effects tab groups them, by `id`: `"temporary"`, `"passive"`, `"inactive"` (turned off or expired) and `"suppressed"` (unavailable, as from an unequipped item). Empty groups are left out. Conditions are listed in `conditions` instead, except concentration under dnd5e 6. |
| `effects[].effects` | `source` names what it comes from, such as the item that carries it or the spell another character cast; `duration` is the time it has left, such as `"9 Rounds"` or `"End of Source's Next Turn"`, or `null`; `disabled` whether it's turned off. An `id` is unique within the sheet. |
| `inventory.sections` | Items by type, in dnd5e's order: weapons, equipment, consumables, tools, loot. Only items in no container; empty sections are left out. |
| `inventory.sections[].items` | In the order the player keeps them in Foundry. `weight` is the item's and its quantity's together, in its `units`, or `null` for none; `price` dnd5e's label for it, such as `"15 GP"`; `equipped` whether it is, or `null` for a type that never is; `attunement` whether it is `"required"` or `"optional"`, with `attuned`; `uses` as on a feature; `rarity` and `properties` dnd5e's labels. An item that rolls or is used through anything, such as a weapon, a potion or a wand, also has [what it rolls](#what-an-item-rolls), with its `activation`, `range`, `target` and `concentration`, as an action's, whether it's equipped or not. |
| `inventory.containers` | Each container the character holds, in no other container, as an item with `capacity`, `{ value, max, units }` by count or weight, `null` without a limit, and `contents`: the items in it, containers among them with their own contents. |
| `identified` | `false` for an item not identified yet, which shows as dnd5e shows it to players: its unidentified name and description, and no price, rarity, uses, properties or attunement. An unidentified container whose contents are secret has `capacity` and `contents` `null`. |
| `inventory.currency` | Each currency, in dnd5e's order, with its `label`, `abbreviation` and `value`. |
| `inventory.encumbrance` | `{ value, max, units, encumbered, heavilyEncumbered }`: what the character carries of the most it can, and, under the variant encumbrance rule, where being encumbered and heavily encumbered begin, otherwise `null`. `null` when encumbrance isn't tracked. |
| `inventory.attunement` | `{ value, max }`: items attuned, and how many may be. |
| `spellcasting` | `{ ability, dc, attack, classes }`: the spellcasting ability, spell save DC and spell attack bonus, and each spellcasting class's. `null` for a character with no spells and no spellcasting class. |
| `spells` | Sections of the spellbook as dnd5e builds them, in its order: at will, innate, ritual, cantrips (`"spell0"`), pact magic, then each spell level (`"spell1"` and so on), with `slots`, `{ value, max, level }`, for those that use them, then spells cast from items (`"item"`): since module 0.16.0, every spell an item casts, whether dnd5e's sheet lists it or not, such as one whose Cast activity isn't to be shown in the spellbook or one the item can't cast now, but none of an item hidden or not identified yet. A slot's `level` is the level a spell is cast at with it, which for pact magic is the pact slots' level, or `null` for pact magic without slots. Module 0.8.0 and earlier leave it out. A section with slots is listed even with no spells in it, as dnd5e lists it. |
| `spells[].spells` | `school`, `components` (such as `"V, S, M"`), `materials`, `activation`, `range`, `duration` (such as `"Concentration, up to 1 Minute"`, as dnd5e's spell cards put it) and `target` are dnd5e's labels; `concentration` and `ritual` say whether; `prepared` is `0` unprepared, `1` prepared or `2` always prepared, or `null` for a spell that isn't prepared, such as a cantrip; `uses` as on a feature; `castFrom`, `{ id, name }`, the item the spell is cast from with one of its Cast activities, such as a wand, or `null` for a spell of the character's own: since module 0.16.0, for one the item can't cast now, `{ id, name, usable, attune }`, `usable` being `false` and `attune` whether that's because the character must attune to the item and hasn't. A spell that rolls or is used through anything also has [what it rolls](#what-an-item-rolls), as an action, whether it's prepared or not, but not one its item can't cast now. |
| `traits` | Each trait with values, `{ id, label, values }`, in order: size, senses, speeds, languages, then dnd5e's traits, such as armor and tool proficiencies and damage resistances and immunities, with whatever the Gamemaster typed in among them. |
| `deathSaves` | `{ success, failure }`, or `null`. |
| `details` | `about`, `{ id, label, value }` for alignment, age and the like that are filled in; `personality`, likewise, for personality traits, ideals, bonds and flaws; `appearance`; `xp`, `{ value, max }`, `max` being `null` at the highest level; and `biography`, a description's hash. |
| `actions` | What the character can do in a fight, listed as Tidy 5e's Actions tab lists it by default: equipped weapons; equipped equipment and consumables used in a fight, not over minutes or more; spells that can be cast now and deal damage, are cast as a bonus action or reaction, last a minute or a round, or apply effects; and features that are activated. An item a player added to Tidy 5e's list, or took off it, is listed or not as they chose. Since module 0.15.0 the spells an item casts with its Cast activities are cast from the item, and the copies of them dnd5e keeps aren't listed; an item Tidy 5e's rules leave off the list is still listed for the spells it casts, unless the player took it off. Sections are by activation, in Tidy 5e's order: `"action"`, `"bonus"`, `"reaction"`, `"legendary"`, `"mythic"`, `"lair"`, `"crew"`, `"special"`, `"other"` for any other, then any the player named in Tidy 5e, whose `id` and `label` are its name. Empty sections are left out. Since module 0.15.0 an item is listed in each section for how its activities are activated, such as a staff that strikes as an action and casts Silvery Barbs as a reaction, under `"action"` and under `"reaction"`, each time with the activities activated that way; an activity with no activation of its own, or a special one, used along with another, such as Hex's Bonus Hex Damage, goes with the item's first. An item the player gave a section of its own, or one not identified yet, is listed once, with all its activities, or for one Tidy 5e's rules leave off the list, all the spells it casts. Before, an item was listed once, by its first activity's activation. |
| `favorites` | What dnd5e's sheet shows under Favorites, and Tidy 5e in its own, in its order: the old-style resources (`"resource"`) that are named and have a maximum, then what the player made a favorite, in their order. Each has a `type` and an `id` that refers to what the sheet lists elsewhere, where it lists it, and a `name`. An `"item"`'s `id` is the item's, as in `inventory`, `spells`, `features` and `actions`, with its `itemType` and `img`. An `"activity"`, one of an item's activities, has the item's `itemId`, `itemType` and `itemName`, its own `name` and `img`, and `activation`, `range`, `target`, `toHit`, `save`, `damage` and `uses` as on an action, for that activity alone, with its own id as `attackId`, and its `attackModes` and `ammunition`, when it's an attack, and itself as `activity` when it's a save, damage, healing or utility activity, or since module 0.21.0 a check or enchant activity, and `consumesSlot`, `check` and `forward` as on an action; an item not identified yet keeps them back, as on an action. An `"effect"`'s `id` is as in `effects`, with its `img`, whether it's `disabled`, and whether it's `suppressed`. A `"skill"`'s `id` is as in `skills`. A `"tool"` has its `ability`, its `total` modifier, `passive` score, `proficiency` and roll `mode`, as a skill has, and as in `tools` since module 0.18.0. A `"slots"`'s `id` is as in `spells`, with `value`, `max` and `level` as a section's `slots`. A `"resource"` has `uses` as on a feature, and, from module 0.23.0, `itemId`: the feature it stands for, by its id in `features` and `actions`, or `null`: the feature whose name is the resource's, compared without case, spacing or curly apostrophes, preferring one that spends it; or else the only feature whose activity spends it (an `attribute` consumption target `resources.<id>.value`, on an activity its player sees). A feature stands for one resource at most. A favorite that refers to nothing any longer, or to what a player doesn't see, such as an item hidden from the sheet or an effect of an item not yet identified, is left out. |
| `actions[].actions` | Items, in the order the player keeps them. `activation`, `range` (for a weapon, its reach or range, such as `"reach 5 ft or range 20/60 ft"`) and `target` are dnd5e's labels; `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save` and `damage` are its first activity's, in dnd5e's order, but for a spell, after its other activities its checks that have no activation of their own, such as the 2014 Entangle's Escape Plants; and a forward that repeats an earlier one, used through the same activity for the same cost, of uses they share, is left out (module 0.21.0), as [below](#what-an-item-rolls): `toHit` the bonus to hit of an attack, without any dice in it, as dnd5e's sheets show it; `attackId` the attack activity's id, so that the app can have the attack [made in the game](#attacks), `null` for any other; `activity` the activity itself, for one [used in the game](#spells-and-features) other than by attacking, `{ id, type, targets }`: `type` being `"save"`, `"damage"`, `"heal"` or `"utility"`, or since module 0.21.0 `"check"` or `"enchant"`, and for a forward that of the activity it's used through, and `targets`, `{ self, area, count, perLevel, affects, fromSelf }`, whom it's used at: `self` its user alone, `area` everyone in an area, `count` the most targets it takes, or `null` for no limit, `perLevel` how many more a spell takes for each level it's cast above its own, as Bless does, or `null`, for a spell cast from an item since module 0.20.0 for each level above the one it's cast at, its `cast`'s `level`, and `affects` dnd5e's kind of target, such as `"ally"`, `"enemy"`, `"creature"` or `"willing"`, or `null`, and since module 0.22.0 `fromSelf`, whether its range is Self, as a potion's or Wild Shape's, which may still name a creature, for the app to offer its user among its targets, [`self`](#spells-and-features) (left out before, where an action's `range` of `"Self"` says the same); and for an `"enchant"`, since module 0.21.0, `enchant`, what it may enchant, and with what, as [below](#what-an-item-rolls); `null` for any other; `attackModes` the ways its attack is made, each `{ value, label }`, such as one- or two-handed, or thrown, when there's more than one, otherwise `null`; `ammunition` what its attack fires, each `{ id, name, quantity }` the character has, for a weapon that fires ammunition, otherwise `null`; `save`, `{ ability, dc }`, the saving throw it calls for, `ability` being `"DC"` when the target chooses among several; `damage` its damage or healing as dnd5e labels it, each part `{ formula, type, healing }` with the ability modifier in the formula; `consumesSlot` `false` for a spell's activity used without spending a spell slot, and otherwise left out (module 0.14.0); `attackArea` and `rollFormula` for an attack at an area and a utility with a roll of its own, as [below](#what-an-item-rolls), and otherwise left out (module 0.16.0); `check` and `forward` for a check activity and a forward, as [below](#what-an-item-rolls), and otherwise left out (module 0.21.0); `activities` each of its activities, for an item with more than one (module 0.14.0): since module 0.15.0, those activated as its section has it, and those even when there's one, where the item is listed in other sections too; `uses` as on a feature, the first activity's when the item has none: since module 0.15.0, that of the first activity it's listed for, or for one that casts a spell, those casting it spends; `level` a spell's, `0` for a cantrip, otherwise `null`; `castFrom` as on a spell, `null` for anything but a spell. Since module 0.15.0, an item listed in a section for an activity other than its first names it, `activityName`, such as `"Silvery Barbs"`, and is otherwise without; `activationType` is the kind of action its first activity there is activated with, as a section's `id` names it, `"action"`, `"bonus"`, `"reaction"`, `"legendary"`, `"mythic"`, `"lair"`, `"crew"` or `"special"`, where it takes just one, Midi-QOL's kinds of reaction being `"reaction"`, or `null` for any other, such as two actions, a Legendary Action that costs two, a minute or a long rest; `consumable` is `true` for one of the consumables: an item dnd5e's inventory has among them, such as a potion, a scroll or a wand, or another whose uses never come back, and otherwise left out; and `cast` and `spellId`, for one that casts a spell, as [below](#what-an-item-rolls). An item not identified yet has no `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save`, `damage`, `attackArea`, `rollFormula`, `check`, `forward`, `activities`, `uses`, `activityName`, `consumable`, `cast` or `spellId`. |
| `enchantments` | Since module 0.21.0, on an inventory item, a container's contents included, a spell, a feature or an action: the enchantments an [enchant activity](#enchantments) applied to it, the character's own or anyone else's, up to 50, each `{ id, name, source, concentration, duration, expired, endable }`: `id` the enchantment's id on that item; `name` its own, such as `"Magic Weapon, +1"`; `source` the name of the item whose activity applied it, as its player knows it: without its enchantments, such as `"Magic Weapon"`, or for one not identified yet, the name dnd5e gives it then; or `null` where that can't be found, as a magic item's template from a compendium or a used-up scroll; `concentration` whether it lasts as long as a concentration, as one cast with it does; `duration` the time it has left, as an effect's, or `null`; `expired` whether its time has run out, as dnd5e 5 leaves one on its item; and `endable` whether its player may [end it](#enchantments) from the app, as the item's owner may in Foundry: one an enchant activity applied that a player could use from the app, whoever's it is, the character's own or another's, such as an ally's Magic Weapon on their club; or one whose activity is gone, as a used-up scroll's or oil's, that lasts only a while, or as long as a concentration. Not a magic item's template's, a choice made once, or one whose activity is gone that lasts for good. The changes dnd5e makes to the copy of a spell an item casts, which no enchant activity applied, aren't listed. Left out where there are none. One dnd5e hides from players isn't listed, but on an item not identified yet, one the character cast on it from another item of theirs that is, as Darkness on a ring; never one the item applies to itself, which would tell what it is, as a Flame Tongue's Ablaze. The item's `name` is as its enchantments make it, such as `"Longsword, +1"`. |
| `text` | A [description](#descriptions)'s hash, or `null` if there is none. |

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
`attackId`, `activity`, `attackModes`, `ammunition`, `save`, `damage`, `attackArea`, `rollFormula`,
`check`, `consumesSlot`, `cast`, `spellId`, `forward`, `activities`, `uses`, `level`, `castFrom`,
`concentration`, `identified`, `consumable`, `enchantments`, `text`.

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
`damage` rolls nothing, and nothing is put back. Nothing else is left out: not an action's own keys
or a favorite's, labels or images.

Put the defaults back first, in rows and in what they list, and in actions and activity favorites,
then the actions by reference. Bound what you put back: a post of rows of nothing, or of many
references to one wide row, would grow many times over as it's expanded. The Sending Stone app
gives up on a sheet, as unreadable, once what it adds comes to three times the largest post it
takes, or `contents` nest deeper than 8; the module nests them 6 deep at most.

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
| `text` | `content` as plain text, with content links reduced to their labels. dnd5e's cards, such as a roll request or a spell's saving throw, give each button two labels, with its DC and without, and show one; since module 0.17.0, only the one players see is kept, as `ask`'s `dc` below. Before, both were. |
| `ask` | The save, or since module 0.18.0 the check, a roll request card asks the table for, or `null` for any other message: the Gamemaster's, posted from a `/save`, `/concentration`, `/check`, `/skill` or `/tool` enricher's request link, or a player's [asked from the app](#descriptions-that-roll). For a save, `{ type, abilities, dc, label }`: `type` is `"save"`, or `"concentration"` for a concentration check; `abilities` the abilities its buttons offer, as dnd5e's keys, or for a concentration check the one it names, if any. For a check, `{ type: "check", checks, dc, label }`: `checks` the checks its buttons offer, from 1 to 10, each `{ type, ability }` with `type` `"check"` for an ability check, `{ type: "skill", ability, skill }`, or `{ type: "tool", ability, tool, name }`, with the tool's `name` as dnd5e names it, never as the card labels it; each check once, each ability one of the six, its button's or else the skill's or tool's own, and each skill and tool one dnd5e has, a tool or a kind of vehicle; a card that offers none of them, or more than 10, has `null`. For either, `dc` its DC, only where dnd5e's *Challenge Visibility* shows players the card's DC: *Show all*, or *Show only from other players* for a card a player posted; and never for a card that shows it no one, as dnd5e's request for a link whose author hid its DC, or any card that labels its buttons alike with the DC and without; otherwise left out; `label`, for a player's, where the save or check comes from, such as their item, and otherwise left out. dnd5e 6's requests, which are messages of their own kind, have `null`. Module 0.17.0; checks, 0.18.0, before which a check's request card has `null`. |
| `blind` | Was it a blind roll? |
| `audience` | Who can read it. See [Visibility](#visibility). |
| `rolls` | Every roll in the message, as below. |
| `system` | The subtype's data for any `type` other than `"base"`, else `null`. |
| `dnd5e` | Under dnd5e, what the system recorded about the message, as below. Otherwise `null`. |
| `gmRoll` | Since module 0.23.0, on a message flagged as made for a roll the campaign's Gamemaster made in the app as a character (`flags["sending-stone"].by` `"gm"`, see [Making a roll](#making-a-roll)), that roll's `id`: the roll it was made for, the use whose card it is, or the death save whose outcome it tells. Left out on any other. The message's author, a player, may change its flags, so it's a claim, which a listener checks against the rolls it handed over as the Gamemaster's. A player can copy a real one onto a message of their own too, so the app takes it only on a message spoken by the character the roll was made as, and only while the roll is being made: the module sends the messages a roll makes before the [`command.result`](#commandresult) that says it was made. |

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
information is on; it is `null` when the system does not model hit points the way dnd5e does. Its
`max` is the maximum dnd5e shows on the sheet and token bar, and heals up to: since module 0.17.0,
with any temporary change to it, such as Aid's or a wraith's Life Drain, which dnd5e keeps apart
from the maximum itself. Before, it left that change out, so a character at their lowered maximum
was sent as short of it.
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
| `features` | `{ rolls: { enabled, kinds, reason, modifiers, areaAttacks, prompts, activityChecks, signedDice, selfTargets, gmRolls } }`: whether the campaign's players' rolls in the app are made in the game, which `kinds` it makes (since module 0.16.0, `"formula"` among the checks, and `"hitDie"` once the self-test has checked that a hit die takes the player's die, and since module 0.20.0 `"hitDice"` with it, never without; with `"attack"`, `"use"` and `"damage"` when the Gamemaster lets the campaign's players attack and cast from the app too, and the game can make their attacks and spells, and since module 0.21.0 `"endEnchantment"` with them, never without; and since module 0.17.0, for the [links in their descriptions](#descriptions-that-roll), under dnd5e 5 only, `"textRoll"`, `"ask"` where its roll request card can be made, and `"textDamage"` when the Gamemaster lets the campaign's players attack too, and the self-test has checked that damage takes their dice, even with **Make Players' Attacks and Spells Through Midi-QOL** off), and if not, why not: `"off"` until the Gamemaster turns them on, `"system"` under a system other than D&D Fifth Edition, `"self-test"` when this Foundry or a module rolls dice differently than expected; and `modifiers`, whether players may change their damage in the app, with more dice, another die or every die at its highest, which the self-test checks: an attack's or use's, and since module 0.19.0 a description's, so wherever `"damage"` or `"textDamage"` is among the `kinds`; `areaAttacks`, whether an attack at an area is made at the targets the player picks, `true` wherever attacks are made, since module 0.16.0; `prompts`, whether its players are asked in the app for the [saves the game asks](#saves-the-game-asks-for) of their characters; and since module 0.21.0 `activityChecks`, whether a `skill`, `tool` or `ability` may name a check activity's `item` and `activity`, to [roll the character's own check](#descriptions-that-roll) for it, `true` wherever players' rolls are made under dnd5e 5, attacks or not; and since module 0.21.0 `signedDice`, `true` wherever players' rolls are made: more dice and another die change only a die damage adds, never one it takes away, and attack and use previews mark those [`subtracted`](#attacks). A listener needs it for a description's damage, which it plans itself; an attack's preview shows it by its marks. And since module 0.22.0 `selfTargets`, whether a `use` may be made at its user beside the combatants picked, [`self`](#spells-and-features), `true` wherever `"use"` is among the `kinds`. And since module 0.23.0 `gmRolls`, `true` wherever players' rolls are made: a roll may say it's the campaign's Gamemaster's, made in the app as the character, [`by`](#fetching-rolls) `"gm"`, which is then [marked as theirs](#making-a-roll). See [Rolls from the app](#rolls-from-the-app). |
| `characters` | Every [character](#character) in the campaign: since module 0.22.0 without its `sheet`, which follows in `character.updated`. |
| `sheetsApart` | `true` since module 0.22.0: the characters carry no sheets, and each follows once the hello is answered. Absent before, when each carried its sheet. |
| `combats` | Every [combat](#combat) the campaign's characters are in, when combat events are on; otherwise empty. |
| `prompts` | Every [prompt](#prompts) open for the campaign's players, read afresh from the chat log: any the campaign was told of that isn't among them has closed. Empty while its players aren't asked for their saves. |

Since module 0.22.0 nothing comes before it, and once it's answered `2xx`, each character follows
in the order listed, each in a [`character.updated`](#characterupdated) of its own after the
[`character.texts`](#charactertexts) with the descriptions its sheet refers to that haven't gone
since the hello. A hello refused is followed by nothing: ask for another, as ever. Before 0.22.0 a
hello came after the `character.texts` with every description its characters' sheets refer to,
and carried their sheets itself.

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
| `reason` | Why it failed: `"off"` (the campaign doesn't take players' rolls now), `"invalid"` (not a roll the module makes; `error` says what), `"unknown"` (no such character in the campaign, or no such skill, tool or ability), `"not-dying"`, `"not-in-combat"` (the character isn't in the combat the Gamemaster has up), `"already-rolled"` (it has initiative), `"busy"`, `"cancelled"` (a module called the roll off), `"timeout"` (not made within a minute, as when a module asks the Gamemaster something first) or `"error"`. For a hit die, also `"no-hit-dice"` and `"self-test"`, and for it or a formula, `"dice"`; for hit dice spent at once (module 0.20.0), those and `"full-hp"` (the character is at full hit points); for a formula, also `"item"` and `"activity"`; see [Hit dice and formulas](#hit-dice-and-formulas). For an attack, a use or their damage, also: `"attacks-off"`, `"midi-off"`, `"self-test"`, `"item"`, `"activity"`, `"area"`, `"slot"`, `"ammo"`, `"mode"`, `"target"`, `"scene"`, `"consume"`, `"active-defence"`, `"reaction"`, `"bonus-action"`, `"midi-dialog"`, `"midi"`, `"no-attack"`, `"gone"`, `"not-waiting"`, `"type"` and `"damaged"`; see [Attacks](#attacks) and [Spells and features](#spells-and-features). Since module 0.21.0, for an enchant activity's use, also `"profile"`, `"enchant-target"`, `"applied"` and `"enchant"`, and for ending an enchantment, `"enchantment"`, besides those of a use; see [Enchantments](#enchantments). For a save answering a prompt, also `"prompt"`; see [Saves the game asks for](#saves-the-game-asks-for). For an ask, a description's roll, damage or healing, or a save or check rolled for a description, also `"gone"`, `"link"`, `"busy"`, `"secret"`, `"type"`, `"dice"`, `"attacks-off"` and `"self-test"`; see [Descriptions that roll](#descriptions-that-roll). `null` when done. |
| `error` | What went wrong, for `"invalid"` and `"error"`, what dnd5e said for `"consume"`, and why for `"prompt"`; otherwise `null`. |
| `messageId` | The chat message the roll made; for hit dice, the last of their cards. Since module 0.21.0, an enchant activity's use that failed once used, `"enchant"` or `"midi"`, has its card's while the card is there, with `visible`, for the Gamemaster to apply it from; one with no card, as a module stopped dnd5e posting it or Midi-QOL deleted it, or with a card no one can apply it from, as one naming a concentration that has since ended, has `null`, with `visible` `true`, and so does the end of an enchantment. |
| `visible` | May the roll's player see that message? `false` for a roll made blind, as Midi-QOL can make a player's check; for hit dice, `false` unless they may see every card. |
| `rolls` | The [rolls](#chat-message) as made, Foundry's total and every die, when `visible`; otherwise empty. For hit dice, every roll of every card, in order. A roll's `total` is Foundry's: damage that takes dice away may come below 0, where dnd5e's card shows each kind of damage at least 0. |
| `healed` | For a hit die or hit dice: the hit points gained; see [Hit dice and formulas](#hit-dice-and-formulas). |
| `spent` | For hit dice (module 0.20.0), once past the checks made before any is spent: `{ count, made }`, how many were asked for, and how many were rolled, a card each. Hit dice that stopped part way, with `made` below `count`, are `"failed"` with the reason they stopped, and still carry `messageId`, `visible`, `rolls` and `healed` for those made, where any were; see [Hit dice and formulas](#hit-dice-and-formulas). Left out otherwise. |
| `attack` | For an attack: `{ critical, fumble, outcome }`, and for an area attack `targets`, when `visible`; see [Attacks](#attacks). |
| `use` | For a use: `{ type }`, the kind of activity used; see [Spells and features](#spells-and-features). |
| `damage` | For an attack or a use: the dice its damage or healing will throw, or `null`; see [Attacks](#attacks). |
| `enchantment` | For an enchant activity's use and the end of an enchantment (module 0.21.0): `{ enchanted, ended }`, the enchantment applied and the one ended, each or both `null`; `null` for a use that failed once made. See [Enchantments](#enchantments). |
| `outcome` | For a save answering a prompt: `"success"` or `"failure"`, where its player may see whether they saved, as the card would show them; since module 0.17.0, for a save rolled for a [description's link](#descriptions-that-roll), and since 0.18.0 a check, whether it met the DC it was rolled against, as its card shows the player, when `visible`; otherwise `null`. |

A roll made after the module reported its `"timeout"`, as once the Gamemaster has answered what a
module asked them, is reported again when it's made, `"done"`; for hit dice, also when some were
made before they stopped (`spent.made` above `0`), `"failed"` with the reason they stopped, as a
rule `"timeout"`.

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

### Prompts

Sent only for a campaign whose players are asked for their saves; see
[Saves the game asks for](#saves-the-game-asks-for).

| Type | Payload |
| --- | --- |
| `roll.prompt.opened` | `{ prompt }`: the game asks one of the campaign's characters for a saving throw. |
| `roll.prompt.closed` | `{ id, reason }`: a prompt no longer waits on its player. `reason` is `"answered"` (rolled from the app), `"rolled"` (rolled from its card in Foundry), `"gone"` (its card was deleted) or `"expired"` (left ten minutes). |

A prompt:

| Field | Meaning |
| --- | --- |
| `id` | The card's id and the character's, joined by `-`. |
| `actorId` | The character asked. |
| `messageId` | The chat card that asks. |
| `type` | `"save"`, or `"concentration"` for a concentration check. |
| `abilities` | The abilities it may be rolled with, such as `["dex"]`, or `["str", "dex"]` for a choice; one for a concentration check. |
| `dc` | The DC, where dnd5e's *Challenge Visibility* lets the character's player see it on the card; otherwise `null`, as also for a card that shows it no one, such as a request for a link whose author hid its DC (module 0.17.0). |
| `label` | What asks: the spell or feature whose card it is, or what the character is concentrating on; or `null`. |
| `openedAt`, `expiresAt` | When its card was posted, and when it stops waiting, ten minutes later. |

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
  is `true` where only it is offered, as with **Make Players' Attacks and Spells Through Midi-QOL**
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
  sent with `gmRoll`, the roll's id. Another `by`, or `"gm"` on `endEnchantment`, is `"invalid"`
  (`error` `"by"`). A module before 0.23.0 ignores `by`, so a listener sends it only to the session
  whose hello said `gmRolls`; one that sends none needs no change.

  Module 0.23.0 reads a refusal's JSON [`reason`](#transport), or its status and text from an older
  app, and tells the Gamemaster what went wrong and what to do once per cause, rather than once as
  deliveries start failing and again as they recover, which a campaign refused beside one that
  isn't made alternate; Manage Campaigns shows each campaign's status. Retrying is as before, but
  that a fetch of rolls refused with any status not retried stops. It sends nothing new: no field,
  header or parameter, so a listener that answers in text or with nothing needs no change.

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
campaign, with **Let Players Roll from Sending Stone** in Manage Campaigns. It is made for:

| `kind` | The roll | Names |
| --- | --- | --- |
| `skill` | A skill check, such as Perception. | `key`: dnd5e's skill key, such as `"prc"`; since module 0.18.0, `text` and `link`, the [check in a description](#descriptions-that-roll) it's rolled for, if any. |
| `tool` | A tool check. | `key`: dnd5e's tool key, such as `"thief"`; or for a check in a description, a kind of vehicle, such as `"water"`; `text` and `link` as for a skill. |
| `ability` | An ability check. | `key`: the ability, such as `"str"`; `text` and `link` as for a skill. |
| `save` | A saving throw. | `key`: the ability; `prompt`, the [prompt](#saves-the-game-asks-for) it answers, if any; or since module 0.17.0 `text` and `link`, the [saving throw in a description](#descriptions-that-roll) it's rolled for, if any. |
| `death` | A death saving throw, while the character is dying. | |
| `initiative` | Initiative, while the character has none in the combat the Gamemaster has up. | `combatId` |
| `hitDie` | A [hit die](#hit-dice-and-formulas) spent, healing the character. Module 0.16.0. | `denomination`: its size, such as `"d10"`. |
| `hitDice` | Several [hit dice](#hit-dice-and-formulas) spent at once, of one or more sizes. Module 0.20.0. | `hitDice`: each size and how many of it, `[{ denomination, count }]`. |
| `formula` | A utility's [own roll](#hit-dice-and-formulas), such as a d4 of luck. Module 0.16.0. | `item`, `activity`: the item and activity with its `rollFormula`. |
| `textRoll` | A [roll in a description](#descriptions-that-roll), such as `[[/r 1d4]]`. Module 0.17.0. | `text`, `link`: the description and the link in it. |
| `ask` | Not a roll: the table [asked](#descriptions-that-roll) for a description's saving throw, or since module 0.18.0 its check. Module 0.17.0. | `text`, `link` |
| `endEnchantment` | Not a roll: an [enchantment](#enchantments) on one of the character's items ended, among the `kinds` wherever `"use"` is. Module 0.21.0. | `enchantment`: `{ item, effect }`. |

### Fetching rolls

A browser can't take incoming requests, so the module fetches players' rolls from the listener.
It does so only once the listener has answered a campaign's `bridge.hello` or `bridge.heartbeat`
with `{"features": {"commands": true}}`, and only for a campaign whose rolls are `enabled`, from
the bridge alone. Each campaign is fetched for in turn, one fetch after another:

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
the order they came.

| Roll field | Meaning |
| --- | --- |
| `id` | Unique to the roll. |
| `actorId` | The campaign's character it is for. |
| `kind`, `key`, `combatId`, `denomination`, `hitDice`, `item`, `activity`, `text`, `link` | What is rolled, as above. |
| `mode` | `-1`, `0` or `1`: rolled with disadvantage, normally, or with advantage. |
| `explicit` | Did the player choose how, as in dnd5e's roll dialog? Then the game rolls it that way. Otherwise it rolls as the character's sheet has it, which is where the app's `mode` came from. |
| `extras` | What the player added, each `{ sign, count, sides }` or `{ sign, flat }`: such as `+1d4` for Bless. At most 10. Made as the roll's situational bonus. |
| `dice` | Every die thrown, in order: the d20s, one or two (`mode` not `0`), then each added term's dice; for a hit die, its one die; for hit dice, one entry per `hitDice` entry, in the same order, with `count` results; for a formula or a description's roll, each of its dice terms'. Each `{ faces, results }`, every result one of the die's faces. |
| `by` | `"gm"` for a roll the campaign's Gamemaster made in the app as the character (module 0.23.0), where the hello says `gmRolls`; absent for its player's, as is `null`. Anything else, or `"gm"` on an `endEnchantment`, is refused (`"invalid"`, `error` `"by"`) with nothing posted. Any kind may have it: an attack, a use, their damage, an ask and a prompt's answer too. |

### Making a roll

The module makes the roll as dnd5e's roll dialog would, without it, as the character's player
(the user whose character it is, or else its only player), shown to everyone. Each die the roll
throws takes the next value the player rolled for a die of its faces: their d20s, then their added
dice. Only a die's first roll is the player's: a reroll, such as a Halfling's of a 1, or a die the
player didn't roll, such as Elven Accuracy's third d20 or a Bless the game applies, is Foundry's.
So is a die a formula's own modifiers roll again (module 0.22.0, which the self-test checks before
offering attacks): a term such as a Great Weapon Fighter's `2d6r<=2`, `1d6x` or `4d6kh3` throws its
number of dice first, the player's, `number` of them in its `dice`; a reroll (`r`, `rr`) or an
explosion (`x`, `xo`) is Foundry's, and what the term keeps, drops, raises, lowers or counts (`k`,
`kh`, `kl`, `d`, `dh`, `dl`, `min`, `max`, `cs`, `cf`), Foundry works out from those.
Foundry's total is the roll's total. The roll's message is flagged
`flags["sending-stone"].request` with the roll's `id`, and marked on its card.

Since module 0.23.0, a roll the campaign's Gamemaster made in the app as the character, `by:
"gm"`, is made as any other, as the same user: its author, speaker, flavor and roll mode are the
player's, as dnd5e's *Challenge Visibility*, Midi-QOL and Dice So Nice expect, and what the app is
told is the same. Every message it makes is flagged `flags["sending-stone"].by` `"gm"` besides, and
its card's mark says "GM": the roll's own, a use's card, its damage, an ask's card, each hit die's
card, and under dnd5e 5.3 the message telling a death save's outcome, which dnd5e posts apart and
which is flagged `outcome` with the roll's `id`, never `request`. dnd5e 6 writes that outcome on the
roll's own card. Chat events send such a message with [`gmRoll`](#chat-message).

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

With **Let Players Attack and Cast from Sending Stone** also ticked for the campaign, a player's
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
**Allow Targets You Aren't Viewing**. Then the use is made; Midi works only on the targets it can
see, and the card names every target, for the Gamemaster to apply the rest. Its user, picked with
[`self`](#spells-and-features), is always treated so, whatever the setting, as such a use was made
at no one before module 0.22.0. What's left may ask
the Gamemaster, as it would in Foundry, such as a target's reaction; an attack made after its
`"timeout"` is reported again.

`command.result` for an attack adds:

| Field | Meaning |
| --- | --- |
| `attack` | `{ critical, fumble, outcome }`, when `visible`. `outcome` is `"hit"` or `"miss"` at its target, given only where the game shows players whether an attack hit: dnd5e's *Attack Roll Visibility* not *None*; Midi's *Auto Check Hits* showing hits to all, and not whispered as the Gamemaster's own rolls are when private. Otherwise `null`. A target under total cover is missed. The target's armor class is never sent. An area attack also has `targets` (module 0.16.0): each `{ combatId, combatantId, outcome }`, in the order picked, its `outcome` given as above, and `null` for a target Midi didn't check, not being on the Gamemaster's canvas; `outcome` is then the one target's, or `null` for several or none. Its targets' names and armor classes are never sent. |
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
attack's damage. If they don't, attacks and uses stay in the app, and Manage Campaigns says why.
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
  Midi's.

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

### Saves the game asks for

With **Prompt Players for Saves & Concentration** also ticked for the campaign, its players are
asked in the app for the saving throws the game asks of their characters, where Foundry waits for
a player to click a button on a chat card:

- **dnd5e's concentration check.** After a concentrating character takes damage, dnd5e posts a
  card asking for one, whispered to the character's owners. That character is asked.
- **A save's card.** A spell or feature that calls for a saving throw posts its card with a button
  for it. Each of the campaign's characters it targets is asked.
- **A request in chat.** A Gamemaster posts a saving throw or concentration check from a `/save`
  or `/concentration` enricher's request link. Each of the campaign's characters whose player can
  read it is asked: every one, unless it's whispered.

A card its character's player can't read asks no one, and nor does a roll request a player
[asked for from the app](#descriptions-that-roll), whoever it's posted as. Where Midi-QOL rolls the
saves itself, as
its *Auto Check Saves* has it, or posts and rolls its own concentration card, it still does, and
no one is asked; with its *Concentration Check* at "chat only", it posts dnd5e's card, and the
player is asked.

Each is sent as [`roll.prompt.opened`](#prompts). It stays open for up to ten minutes: until its
character rolls the save from its card, or the card is deleted. [`roll.prompt.closed`](#prompts)
says when it closes. The player answers it with a `save` naming it:

| Roll field | Meaning |
| --- | --- |
| `kind` | `"save"`. |
| `key` | One of the prompt's `abilities`. |
| `prompt` | The prompt's `id`. |

Its other fields are a save's. The module makes it as dnd5e does from the card's button: a saving
throw, or a concentration check, against the card's DC, as the character's player, linked to the
card (`flags.dnd5e.originatingMessage`), so the card shows whether they saved. A failed
concentration check ends the character's concentration, which the player can't from the app; with
Midi-QOL, Midi ends it, where its Gamemaster has it remove concentration. Refused as `"prompt"`,
with why in `error`: `"off"` (the campaign doesn't ask its players now), `"character"` (another
character's), `"gone"` (its card is gone, or asks no save of the character), `"expired"`,
`"answered"` (the character has rolled it), or `"ability"` (one the prompt doesn't offer).
`command.result` adds `outcome`.

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
| `critical` | Optional: `true` to roll it as a critical hit's, as the world's rules make a critical hit's damage, and those of modules that change them, such as Midi-QOL's; `false` or left out for not. Its `dice` are then each dice term's as many times over as the sheet's [`critical`](#character-sheet) `perDie` says, with what a critical hit adds to each part, as its span's [`data-critical-dice` and `data-critical-damage`](#links-in-descriptions) say (module 0.20.0): the extra dice on the part's first die as the sheet's `bonusDice` says, and its critical damage's dice after. Never for healing, nor for damage marked `data-critical="false"` without that pair (`"invalid"`, `"critical"`), nor where the activity dnd5e's link rolls it through allows none now, or what it adds can't be read; `true` on a `textRoll`, or anything but a boolean, is refused the same way. Module 0.19.0. |
| `modifiers` | Optional, where the hello says `modifiers`: `{ extra, faces, maximize }`, each optional, how the player changed it in the app, as an [attack's damage](#attacks) may be, healing too. `extra` more of its first part's first die that it adds, never one it takes away (module 0.21.0; before, its first die whatever its sign; a listener without the hello's `signedDice` should change it only where that's the same die), up to 40: for a critical hit's, `perDie` more for each, else one; a first part with no such die has none to change (`"dice"`); `faces` that die another size, `4`, `6`, `8`, `10` or `12`; `maximize` every die at its highest, the game's own too, but since module 0.21.0 never for damage that takes a die away, such as `- 1d4 + 4`, nor since module 0.22.0 for damage with a die Foundry would roll again at its highest, one that explodes or rerolls on its highest face, such as `1d6x` (`"invalid"`, `"modifiers"`). `dice` are then the changed ones. Refused on a `textRoll`, or where it can't be read (`"invalid"`, `"modifiers"`). Module 0.19.0. |
| `dice` | One `{ faces, results }` for each dice term of its parts' formulas, in order, with as many results as the term has dice, as for a [formula](#hit-dice-and-formulas); as a critical hit's and as changed, if so. For a critical hit's, each part's own dice terms come first, in its formula's order, the first's count with its extra dice and the player's change, then its critical damage's dice terms, in order; then the next part's. |

It's rolled as dnd5e rolls its description's link, without the damage dialog: a roll for each
part, of the kind chosen for it; as a critical hit's, where the player chose one, as dnd5e's own
link is where its roller does, so with the world's rules for a critical hit's damage, its *Critical
Damage Modifiers* and *Powerful Critical*, or the Gamemaster's critical damage rules of Midi-QOL,
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
