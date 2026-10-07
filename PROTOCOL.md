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
| Any `2xx` | Delivered. `204 No Content` is fine. A JSON body of `{"resend": "hello"}` asks for the campaign's full state again; see [Keeping in step](#keeping-in-step). In answer to a `bridge.hello` or `bridge.heartbeat`, `{"features": {"commands": true}}` says the listener has players' rolls for the module to fetch; see [Rolls from the app](#rolls-from-the-app). Both may be in one body. Anything else is ignored. |
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
| `sequence` | Counts up by exactly 1 per event within a session and campaign. A gap means that campaign missed events. `null` on `bridge.ping`, `bridge.heartbeat` and `command.result`, which are outside the event stream. |
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
- **Descriptions come first.** Sheets refer to their descriptions by hash, and the module sends
  every description a campaign has not had since its last hello in
  [`character.texts`](#charactertexts), before the `bridge.hello` or `character.updated` that
  refers to it. So a sheet that refers to a description you don't have means one went missing:
  answer that `bridge.hello` or `character.updated` with `{"resend": "hello"}`, the one time a
  hello itself may ask. Don't ask on `character.texts`, which may arrive before its session's
  hello.

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
[sheet](#character-sheet) under dnd5e, or `null` under another system.

### Character sheet

What the character's player sees of them, and rolls from: every modifier is the one dnd5e shows on
its own sheet, already including proficiency and fixed bonuses. Bonuses that are dice, such as
Bless or Guidance, are not included; dnd5e adds those only when it rolls.

```json
{
  "img": "worlds/erebor/thorin.webp",
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
    { "type": "resource", "id": "primary", "name": "Superiority Dice", "uses": { "value": 3, "max": 4, "recovery": "Short Rest" } },
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
| `level`, `classes` | Character level, and each class with its levels and subclass, highest first. A class's `identifier` is dnd5e's, such as `"fighter"`, and `hitDice` its `{ die, value, max }`: the size, how many are left and how many it has, or `null`. |
| `species`, `background` | Their names, or `null`. |
| `hp` | `{ value, max, temp }`, as on a [combatant](#combatant). |
| `ac`, `proficiency`, `initiative` | Armor class, proficiency bonus, and initiative modifier. |
| `speed` | Walking speed: `{ value, units }`, such as `"ft"`. |
| `abilities` | In dnd5e's order (Strength first). `check` and `save` are the modifiers for an ability check and a saving throw; `saveProficient`, whether proficient in the save. |
| `skills` | Sorted by `label`. `total` is the check modifier, `passive` the passive score, and `proficiency` the multiplier: `0`, `0.5` (half, as from Jack of All Trades), `1`, or `2` (expertise). |
| `checkMode`, `saveMode`, `mode` | Whether that roll is made with advantage (`1`) or disadvantage (`-1`) from the character's conditions and features, else `0`. A skill's combines its ability's, as dnd5e does. |
| `conditions` | The character's statuses that the game names, by `name`: conditions such as Poisoned, and others such as Concentrating or Dead. `level` is Exhaustion's level, otherwise `null`; `detail`, for Concentrating, what the character is concentrating on. `text` is the rules for it. |
| `features` | Grouped as dnd5e's Features tab groups them: a section for each class (with `id` its identifier), then `"species"`, `"background"` and `"other"`, each with its `label` and the `text` of the class, species or background. Empty sections are left out. |
| `features[].features` | In the order the player keeps them in Foundry. `kind`, such as Class Feature; `requirements`, such as Fighter 1; `activation`, such as 1 Bonus Action; `passive` for a trait or anything with nothing to use; `uses`, if limited, as `{ value, max, recovery }`, with `value` the uses left and `recovery` when they come back, such as Short Rest, Long Rest or Recharge [5–6]. |
| `effects` | Grouped as dnd5e's Effects tab groups them, by `id`: `"temporary"`, `"passive"`, `"inactive"` (turned off or expired) and `"suppressed"` (unavailable, as from an unequipped item). Empty groups are left out. Conditions are listed in `conditions` instead, except concentration under dnd5e 6. |
| `effects[].effects` | `source` names what it comes from, such as the item that carries it or the spell another character cast; `duration` is the time it has left, such as `"9 Rounds"` or `"End of Source's Next Turn"`, or `null`; `disabled` whether it's turned off. An `id` is unique within the sheet. |
| `inventory.sections` | Items by type, in dnd5e's order: weapons, equipment, consumables, tools, loot. Only items in no container; empty sections are left out. |
| `inventory.sections[].items` | In the order the player keeps them in Foundry. `weight` is the item's and its quantity's together, in its `units`, or `null` for none; `price` dnd5e's label for it, such as `"15 GP"`; `equipped` whether it is, or `null` for a type that never is; `attunement` whether it is `"required"` or `"optional"`, with `attuned`; `uses` as on a feature; `rarity` and `properties` dnd5e's labels. |
| `inventory.containers` | Each container the character holds, in no other container, as an item with `capacity`, `{ value, max, units }` by count or weight, `null` without a limit, and `contents`: the items in it, containers among them with their own contents. |
| `identified` | `false` for an item not identified yet, which shows as dnd5e shows it to players: its unidentified name and description, and no price, rarity, uses, properties or attunement. An unidentified container whose contents are secret has `capacity` and `contents` `null`. |
| `inventory.currency` | Each currency, in dnd5e's order, with its `label`, `abbreviation` and `value`. |
| `inventory.encumbrance` | `{ value, max, units, encumbered, heavilyEncumbered }`: what the character carries of the most it can, and, under the variant encumbrance rule, where being encumbered and heavily encumbered begin, otherwise `null`. `null` when encumbrance isn't tracked. |
| `inventory.attunement` | `{ value, max }`: items attuned, and how many may be. |
| `spellcasting` | `{ ability, dc, attack, classes }`: the spellcasting ability, spell save DC and spell attack bonus, and each spellcasting class's. `null` for a character with no spells and no spellcasting class. |
| `spells` | Sections of the spellbook as dnd5e builds them, in its order: at will, innate, ritual, cantrips (`"spell0"`), pact magic, then each spell level (`"spell1"` and so on), with `slots`, `{ value, max, level }`, for those that use them, then spells cast from items (`"item"`). A slot's `level` is the level a spell is cast at with it, which for pact magic is the pact slots' level, or `null` for pact magic without slots. Module 0.8.0 and earlier leave it out. A section with slots is listed even with no spells in it, as dnd5e lists it. |
| `spells[].spells` | `school`, `components` (such as `"V, S, M"`), `materials`, `activation`, `range`, `duration` (such as `"Concentration, up to 1 Minute"`, as dnd5e's spell cards put it) and `target` are dnd5e's labels; `concentration` and `ritual` say whether; `prepared` is `0` unprepared, `1` prepared or `2` always prepared, or `null` for a spell that isn't prepared, such as a cantrip; `uses` as on a feature; `castFrom`, `{ id, name }`, the item the spell is cast from with one of its Cast activities, such as a wand, or `null` for a spell of the character's own. |
| `traits` | Each trait with values, `{ id, label, values }`, in order: size, senses, speeds, languages, then dnd5e's traits, such as armor and tool proficiencies and damage resistances and immunities, with whatever the Gamemaster typed in among them. |
| `deathSaves` | `{ success, failure }`, or `null`. |
| `details` | `about`, `{ id, label, value }` for alignment, age and the like that are filled in; `personality`, likewise, for personality traits, ideals, bonds and flaws; `appearance`; `xp`, `{ value, max }`, `max` being `null` at the highest level; and `biography`, a description's hash. |
| `actions` | What the character can do in a fight, listed as Tidy 5e's Actions tab lists it by default: equipped weapons; equipped equipment and consumables used in a fight, not over minutes or more; spells that can be cast now and deal damage, are cast as a bonus action or reaction, last a minute or a round, or apply effects; and features that are activated. An item a player added to Tidy 5e's list, or took off it, is listed or not as they chose. Sections are by the first activity's activation, in Tidy 5e's order: `"action"`, `"bonus"`, `"reaction"`, `"legendary"`, `"mythic"`, `"lair"`, `"crew"`, `"special"`, `"other"` for any other, then any the player named in Tidy 5e, whose `id` and `label` are its name. Empty sections are left out. |
| `favorites` | What dnd5e's sheet shows under Favorites, and Tidy 5e in its own, in its order: the old-style resources (`"resource"`) that are named and have a maximum, then what the player made a favorite, in their order. Each has a `type` and an `id` that refers to what the sheet lists elsewhere, where it lists it, and a `name`. An `"item"`'s `id` is the item's, as in `inventory`, `spells`, `features` and `actions`, with its `itemType` and `img`. An `"activity"`, one of an item's activities, has the item's `itemId`, `itemType` and `itemName`, its own `name` and `img`, and `activation`, `range`, `target`, `toHit`, `save`, `damage` and `uses` as on an action, for that activity alone, with its own id as `attackId` when it's an attack; an item not identified yet keeps them back, as on an action. An `"effect"`'s `id` is as in `effects`, with its `img`, whether it's `disabled`, and whether it's `suppressed`. A `"skill"`'s `id` is as in `skills`. A `"tool"`, which the sheet has nowhere else, has its `ability`, its `total` modifier, `passive` score, `proficiency` and roll `mode`, as a skill has. A `"slots"`'s `id` is as in `spells`, with `value`, `max` and `level` as a section's `slots`. A `"resource"` has `uses` as on a feature. A favorite that refers to nothing any longer, or to what a player doesn't see, such as an item hidden from the sheet or an effect of an item not yet identified, is left out. |
| `actions[].actions` | Items, in the order the player keeps them. `activation`, `range` (for a weapon, its reach or range, such as `"reach 5 ft or range 20/60 ft"`) and `target` are dnd5e's labels; `toHit` the attack's bonus to hit, without any dice in it, as dnd5e's sheets show it; `attackId` the id of the attack activity `toHit` is for, so that the app can have the attack [made in the game](#attacks), `null` when it has none; `save`, `{ ability, dc }`, the saving throw it calls for, `ability` being `"DC"` when the target chooses among several; `damage` its damage or healing as dnd5e labels it, each part `{ formula, type, healing }` with the ability modifier in the formula, from its attack, or else the first activity that has any; `uses` as on a feature, the first activity's when the item has none; `level` a spell's, `0` for a cantrip, otherwise `null`; `castFrom` as on a spell, `null` for anything but a spell. An item not identified yet has no `toHit`, `attackId`, `save`, `damage` or `uses`. |
| `text` | A [description](#descriptions)'s hash, or `null` if there is none. |

Any number dnd5e doesn't provide is `null`. Labels are in the Gamemaster's language. The sheet
shows what the character's player would see in Foundry: effects dnd5e hides from players, such as
an unidentified item's, are left out, even though a Gamemaster's browser sends it.

#### Descriptions

A sheet refers to each description by `text`, a 14-character hexadecimal hash of where it comes
from, and the description itself is sent in [`character.texts`](#charactertexts). It is HTML,
enriched as the character's player sees it in Foundry: links to documents and rolls are already
turned into HTML, and secret sections, which the player may see as the character's owner, are
included. Images and links in it are relative to the game's address, like `img`. It is not
sanitised: treat it as untrusted and sanitise it before showing it. A description longer than
100,000 characters is cut short.

The same hash always names the same description. A description with rolls in it is hashed with the
character's level, proficiency and ability modifiers, since its rolls may show them, so it gets a
new hash when they change.

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
| `features` | `{ rolls: { enabled, kinds, reason } }`: whether the campaign's players' rolls in the app are made in the game, which `kinds` it makes (with `"attack"` and `"damage"` when the Gamemaster lets the campaign's players attack from the app too, and the game can make their attacks), and if not, why not: `"off"` until the Gamemaster turns them on, `"system"` under a system other than D&D Fifth Edition, `"self-test"` when this Foundry or a module rolls dice differently than expected. See [Rolls from the app](#rolls-from-the-app). |
| `characters` | Every [character](#character) in the campaign. |
| `combats` | Every [combat](#combat) the campaign's characters are in, when combat events are on; otherwise empty. |

It follows the [`character.texts`](#charactertexts) with every description the characters' sheets
refer to.

### `character.updated`

`{ character }`: one of the campaign's [characters](#character), sheet included, as it now stands.
Sent when it changes between `bridge.hello`s, such as taking damage, levelling up, equipping armor
or gaining a condition: a change to the actor, its items or its effects. A burst of changes is
sent once it settles, and nothing is sent if the character is unchanged from what the campaign
was last told. Time passing in the game, or a new round or turn of combat, counts as a change for
a character with a temporary effect, whose time left is on its sheet.

Any description its sheet refers to that the campaign has not been sent since its last hello
comes first, in [`character.texts`](#charactertexts).

### `character.texts`

`{ texts }`: [descriptions](#descriptions) that characters' sheets refer to, as an object of
HTML by hash. Sent before the `bridge.hello` or `character.updated` whose sheets refer to them:
with a hello, every description its sheets refer to; after that, each new one, once. Several may
follow one another when there is too much for one post. Keep them for the campaign: the same hash
always names the same description. A campaign's descriptions that none of its sheets refers to
any more can be dropped on its next hello.

`character.texts` is not part of the event stream, so its `sequence` is `null`. It may arrive
before its session's `bridge.hello`: store it, and don't ask for a resend.

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

### `command.result`

What became of a player's roll or attack fetched from the listener; see
[Rolls from the app](#rolls-from-the-app) and [Attacks](#attacks). Not part of the event stream, so its `sequence` is
`null`. It follows the chat events of the message the roll made.

| Field | Meaning |
| --- | --- |
| `id` | The roll's `id`, as fetched. |
| `status` | `"done"`, or `"failed"` when it wasn't made. |
| `reason` | Why it failed: `"off"` (the campaign doesn't take players' rolls now), `"invalid"` (not a roll the module makes; `error` says what), `"unknown"` (no such character in the campaign, or no such skill, tool or ability), `"not-dying"`, `"not-in-combat"` (the character isn't in the combat the Gamemaster has up), `"already-rolled"` (it has initiative), `"busy"`, `"cancelled"` (a module called the roll off), `"timeout"` (not made within a minute, as when a module asks the Gamemaster something first) or `"error"`. For an attack or its damage, also: `"attacks-off"`, `"midi-off"`, `"self-test"`, `"item"`, `"activity"`, `"area"`, `"ammo"`, `"target"`, `"scene"`, `"consume"`, `"damage-type"`, `"active-defence"`, `"reaction"`, `"bonus-action"`, `"midi-dialog"`, `"midi"`, `"no-attack"`, `"gone"`, `"not-waiting"` and `"damaged"`; see [Attacks](#attacks). `null` when done. |
| `error` | What went wrong, for `"invalid"` and `"error"`, and what dnd5e said for `"consume"`; otherwise `null`. |
| `messageId` | The chat message the roll made. |
| `visible` | May the roll's player see that message? `false` for a roll made blind, as Midi-QOL can make a player's check. |
| `rolls` | The [rolls](#chat-message) as made, Foundry's total and every die, when `visible`; otherwise empty. |
| `attack` | For an attack: `{ critical, fumble, outcome }`, when `visible`; see [Attacks](#attacks). |
| `damage` | For an attack: the dice its damage will throw, or `null`; see [Attacks](#attacks). |

A roll made after the module reported its `"timeout"`, as once the Gamemaster has answered what a
module asked them, is reported again when it's made, `"done"`.

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
| `skill` | A skill check, such as Perception. | `key`: dnd5e's skill key, such as `"prc"`. |
| `tool` | A tool check. | `key`: dnd5e's tool key, such as `"thief"`. |
| `ability` | An ability check. | `key`: the ability, such as `"str"`. |
| `save` | A saving throw. | `key`: the ability. |
| `death` | A death saving throw, while the character is dying. | |
| `initiative` | Initiative, while the character has none in the combat the Gamemaster has up. | `combatId` |

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
minute. A `401`, `403` or `404` stops fetching for the campaign until the settings change or the
listener asks for a hello.

**Hand each roll over once.** One whose answer is lost is lost: never a roll made twice. The
module also makes a roll only once, however often it's handed over, and a character's rolls in
the order they came.

| Roll field | Meaning |
| --- | --- |
| `id` | Unique to the roll. |
| `actorId` | The campaign's character it is for. |
| `kind`, `key`, `combatId` | What is rolled, as above. |
| `mode` | `-1`, `0` or `1`: rolled with disadvantage, normally, or with advantage. |
| `explicit` | Did the player choose how, as in dnd5e's roll dialog? Then the game rolls it that way. Otherwise it rolls as the character's sheet has it, which is where the app's `mode` came from. |
| `extras` | What the player added, each `{ sign, count, sides }` or `{ sign, flat }`: such as `+1d4` for Bless. At most 10. Made as the roll's situational bonus. |
| `dice` | Every die thrown, in order: the d20s, one or two (`mode` not `0`), then each added term's dice. Each `{ faces, results }`, every result one of the die's faces. |

### Making a roll

The module makes the roll as dnd5e's roll dialog would, without it, as the character's player
(the user whose character it is, or else its only player), shown to everyone. Each die the roll
throws takes the next value the player rolled for a die of its faces: their d20s, then their added
dice. Only a die's first roll is the player's: a reroll, such as a Halfling's of a 1, or a die the
player didn't roll, such as Elven Accuracy's third d20 or a Bless the game applies, is Foundry's.
Foundry's total is the roll's total. The roll's message is flagged
`flags["sending-stone"].request` with the roll's `id`, and marked on its card.

It then sends [`command.result`](#commandresult). A roll made blind, as Midi-QOL can make a
player's check, is reported as made, with `visible: false` and no rolls, so that the app tells
its player no more than Foundry would.

Before offering rolls, the module checks, as the game loads, that the player's dice reach a roll
made for them and only that roll. If they don't, its hellos say `"self-test"`, and Manage
Campaigns says why.

### Attacks

With **Let Players Attack from Sending Stone** also ticked for the campaign, a player's weapon and
spell attacks in the app are made in the game too. The item is used as in Foundry, spending what
it spends; the attack is made at the target the player picked, with their d20s; and then, once
they roll it, its damage, on the same use, with their dice. It takes two rolls, an `attack`, then
its `damage`:

| Roll field | Meaning |
| --- | --- |
| `kind` | `"attack"`. |
| `item`, `activity` | The item and its attack activity: an action's `id` and `attackId` in the sheet, or an activity favorite's `itemId` and `attackId`. |
| `target` | `{ combatId, combatantId }`: the combatant attacked, in a combat its player can see; or `null`. |
| `mode`, `explicit`, `extras`, `dice` | As for a check: the d20s, then the dice the player added. |

| Roll field | Meaning |
| --- | --- |
| `kind` | `"damage"`. |
| `use` | The `id` of the attack it follows. |
| `dice` | The dice the attack's `command.result` said its damage throws, in order, each `{ faces, results }`. None when it said they can't be planned, or there are none. |

**The attack.** The module uses the activity as dnd5e's usage dialog would, without it: with the
spell's own spell slot, or else the first with any left at a higher level, as the dialog picks it;
with the ammunition and attack mode last used. What it can't spend is refused, rather than said on
the Gamemaster's screen. Then:

- **dnd5e's cards.** Without Midi-QOL, or with Midi's *Replace Default Activities* off, dnd5e's
  own cards are posted, as the character's player: the use's card, naming the target, then the
  attack, linked to it.
- **Midi-QOL's workflow.** Where Midi's activities make each use a workflow, the attack goes
  through the workflow, as if the player had attacked in Foundry: Midi checks the hit and, once
  the damage is rolled, applies it, as the Gamemaster has it set up. The card is the
  Gamemaster's, spoken as the character, since Midi asks a card's author to confirm and apply.
  While the attack is rolled, the Gamemaster's targets are the player's target; then they're put
  back. Midi attacks are made one at a time. With **Make Players' Attacks Through Midi-QOL** off,
  attacks aren't offered.

Refused beforehand, rather than have the Gamemaster asked: an area attack, a damage part with a
choice of types, Midi's Active Defence, a reaction or bonus action Midi enforces that's been used,
an activity that always opens Midi's roll or consume dialog, and a target Midi can't target, or no
target where Midi needs one. What's left may ask the Gamemaster, as it would in Foundry, such as a
target's reaction; an attack made after its `"timeout"` is reported again.

`command.result` for an attack adds:

| Field | Meaning |
| --- | --- |
| `attack` | `{ critical, fumble, outcome }`, when `visible`. `outcome` is `"hit"` or `"miss"` at its target, given only where the game shows players whether an attack hit: dnd5e's *Attack Roll Visibility* not *None*; Midi's *Auto Check Hits* showing hits to all, and not whispered as the Gamemaster's own rolls are when private. Otherwise `null`. A target under total cover is missed. The target's armor class is never sent. |
| `damage` | The dice the attack's damage will throw, for its player to roll: `{ critical, plannable, rolls: [{ formula, type, dice: [{ faces, number }] }] }`, as dnd5e will make up its rolls, with a critical hit's dice. `plannable` is `false` when a die can't be known beforehand, such as a d3: the game then rolls all of them. `null` when no damage follows, as when Midi's workflow ends at a miss. |

**The damage** is rolled on the attack's use: on dnd5e's cards, a damage roll linked to the use's
card; with Midi, into the workflow waiting for it, which then applies it. Its dice must be the
ones the attack said, and a use takes one damage roll. The use's card is flagged
`flags["sending-stone"].use` with the attack's `id`, and keeps what its damage needs, so that it
can be rolled after the game is reloaded, except into a Midi workflow, which lives only in the
Gamemaster's browser. Dice the game adds, such as Midi's bonus damage, are Foundry's.

Players' attacks are offered once the self-test has also checked that the player's dice reach an
attack's damage. If they don't, attacks stay in the app, and Manage Campaigns says why.

