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
  "rules": "modern",
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
| `rules` | The rules the world is played by, as dnd5e's *Rules Version* setting has them: `"modern"` (2024) or `"legacy"` (2014), or `null` where that can't be read. Under the legacy rules a [hit die](#hit-dice-and-formulas) can heal nothing. Module 0.16.0. |
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
| `favorites` | What dnd5e's sheet shows under Favorites, and Tidy 5e in its own, in its order: the old-style resources (`"resource"`) that are named and have a maximum, then what the player made a favorite, in their order. Each has a `type` and an `id` that refers to what the sheet lists elsewhere, where it lists it, and a `name`. An `"item"`'s `id` is the item's, as in `inventory`, `spells`, `features` and `actions`, with its `itemType` and `img`. An `"activity"`, one of an item's activities, has the item's `itemId`, `itemType` and `itemName`, its own `name` and `img`, and `activation`, `range`, `target`, `toHit`, `save`, `damage` and `uses` as on an action, for that activity alone, with its own id as `attackId`, and its `attackModes` and `ammunition`, when it's an attack, and itself as `activity` when it's a save, damage, healing or utility activity, and `consumesSlot` as on an action; an item not identified yet keeps them back, as on an action. An `"effect"`'s `id` is as in `effects`, with its `img`, whether it's `disabled`, and whether it's `suppressed`. A `"skill"`'s `id` is as in `skills`. A `"tool"`, which the sheet has nowhere else, has its `ability`, its `total` modifier, `passive` score, `proficiency` and roll `mode`, as a skill has. A `"slots"`'s `id` is as in `spells`, with `value`, `max` and `level` as a section's `slots`. A `"resource"` has `uses` as on a feature. A favorite that refers to nothing any longer, or to what a player doesn't see, such as an item hidden from the sheet or an effect of an item not yet identified, is left out. |
| `actions[].actions` | Items, in the order the player keeps them. `activation`, `range` (for a weapon, its reach or range, such as `"reach 5 ft or range 20/60 ft"`) and `target` are dnd5e's labels; `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save` and `damage` are its first activity's, in dnd5e's order, as [below](#what-an-item-rolls): `toHit` the bonus to hit of an attack, without any dice in it, as dnd5e's sheets show it; `attackId` the attack activity's id, so that the app can have the attack [made in the game](#attacks), `null` for any other; `activity` the activity itself, for one [used in the game](#spells-and-features) other than by attacking, `{ id, type, targets }`: `type` being `"save"`, `"damage"`, `"heal"` or `"utility"`, and `targets`, `{ self, area, count, perLevel, affects }`, whom it's used at: `self` its user alone, `area` everyone in an area, `count` the most targets it takes, or `null` for no limit, `perLevel` how many more a spell takes for each level it's cast above its own, as Bless does, or `null`, and `affects` dnd5e's kind of target, such as `"ally"`, `"enemy"`, `"creature"` or `"willing"`, or `null`; `null` for any other; `attackModes` the ways its attack is made, each `{ value, label }`, such as one- or two-handed, or thrown, when there's more than one, otherwise `null`; `ammunition` what its attack fires, each `{ id, name, quantity }` the character has, for a weapon that fires ammunition, otherwise `null`; `save`, `{ ability, dc }`, the saving throw it calls for, `ability` being `"DC"` when the target chooses among several; `damage` its damage or healing as dnd5e labels it, each part `{ formula, type, healing }` with the ability modifier in the formula; `consumesSlot` `false` for a spell's activity used without spending a spell slot, and otherwise left out (module 0.14.0); `attackArea` and `rollFormula` for an attack at an area and a utility with a roll of its own, as [below](#what-an-item-rolls), and otherwise left out (module 0.16.0); `activities` each of its activities, for an item with more than one (module 0.14.0): since module 0.15.0, those activated as its section has it, and those even when there's one, where the item is listed in other sections too; `uses` as on a feature, the first activity's when the item has none: since module 0.15.0, that of the first activity it's listed for, or for one that casts a spell, those casting it spends; `level` a spell's, `0` for a cantrip, otherwise `null`; `castFrom` as on a spell, `null` for anything but a spell. Since module 0.15.0, an item listed in a section for an activity other than its first names it, `activityName`, such as `"Silvery Barbs"`, and is otherwise without; `activationType` is the kind of action its first activity there is activated with, as a section's `id` names it, `"action"`, `"bonus"`, `"reaction"`, `"legendary"`, `"mythic"`, `"lair"`, `"crew"` or `"special"`, where it takes just one, Midi-QOL's kinds of reaction being `"reaction"`, or `null` for any other, such as two actions, a Legendary Action that costs two, a minute or a long rest; `consumable` is `true` for one of the consumables: an item dnd5e's inventory has among them, such as a potion, a scroll or a wand, or another whose uses never come back, and otherwise left out; and `cast`, for one that casts a spell, as [below](#what-an-item-rolls), also has `text`, the spell's description's hash. An item not identified yet has no `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save`, `damage`, `attackArea`, `rollFormula`, `activities`, `uses`, `activityName`, `consumable` or `cast`. |
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
| `type` | Its kind, such as `"attack"`, `"save"`, `"damage"`, `"heal"`, `"utility"`, or one the app can't use, such as `"summon"`. |
| `activation`, `activationType`, `range`, `target`, `uses` | As on an action, for this activity alone. A Cast activity's `uses` are those casting its spell spends, such as the item's charges. |
| `toHit`, `attackId`, `activity`, `attackModes`, `ammunition`, `save`, `damage`, `attackArea`, `rollFormula`, `consumesSlot` | What it rolls, and what it's used through, as on an action. |
| `cast` | For a Cast activity, `{ level, concentration, charges, short }`, as below. |

An activity favorite has the same fields. `consumesSlot` is `false` for a spell's activity used
after it's cast without spending a slot, such as Spirit Guardians' save each turn or Hex's Bonus
Hex Damage: dnd5e still asks the level it's used at, which its damage may scale with, but spends
nothing, so it's used whether any slot is left or not. A spell with one activity, or an item with
none, has no `activities`.

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
hasn't, rolls nothing, as a summoning doesn't, but has the same `uses`. An activity favorite that
casts a spell also has the spell's description's hash in `cast`'s `text`.

Since module 0.16.0 two more are sent where they apply, and left out otherwise, so that a listener
that doesn't know them sees nothing new:

| Field | Meaning |
| --- | --- |
| `attackArea` | For an attack made at an area, such as a breath weapon's cone: `{ count, perLevel, affects }`, whom it's made at, as an `activity`'s `targets` say it: `count` the most targets it takes, or `null` for no limit, `perLevel` how many more for each level a spell is cast above its own, or `null`, always `null` for a spell cast from an item, and `affects` dnd5e's kind of target. The app has it [made at the targets the player picks](#attacks) in the area. |
| `rollFormula` | For a utility activity with a roll of its own, such as a d4 of luck: `{ formula, name }`, its `formula` with the character's numbers in, such as `"1d4 + 3"` for `1d4 + @abilities.wis.mod`, and its `name` as dnd5e's card's button has it, or `null`. The app rolls its dice and has it [rolled in the game](#hit-dice-and-formulas). |

A Cast activity has its spell's first activity's, by its own id, as for its other fields.

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
| `features` | `{ rolls: { enabled, kinds, reason, modifiers, areaAttacks, prompts } }`: whether the campaign's players' rolls in the app are made in the game, which `kinds` it makes (since module 0.16.0, `"formula"` among the checks, and `"hitDie"` once the self-test has checked that a hit die takes the player's die; with `"attack"`, `"use"` and `"damage"` when the Gamemaster lets the campaign's players attack and cast from the app too, and the game can make their attacks and spells), and if not, why not: `"off"` until the Gamemaster turns them on, `"system"` under a system other than D&D Fifth Edition, `"self-test"` when this Foundry or a module rolls dice differently than expected; and `modifiers`, whether players may change their damage in the app, with more dice, another die or every die at its highest, which the self-test checks; `areaAttacks`, whether an attack at an area is made at the targets the player picks, `true` wherever attacks are made, since module 0.16.0; and `prompts`, whether its players are asked in the app for the [saves the game asks](#saves-the-game-asks-for) of their characters. See [Rolls from the app](#rolls-from-the-app). |
| `characters` | Every [character](#character) in the campaign. |
| `combats` | Every [combat](#combat) the campaign's characters are in, when combat events are on; otherwise empty. |
| `prompts` | Every [prompt](#prompts) open for the campaign's players, read afresh from the chat log: any the campaign was told of that isn't among them has closed. Empty while its players aren't asked for their saves. |

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

What became of a player's roll, attack or use fetched from the listener; see
[Rolls from the app](#rolls-from-the-app), [Attacks](#attacks) and [Spells and features](#spells-and-features). Not part of the event stream, so its `sequence` is
`null`. It follows the chat events of the message the roll made.

| Field | Meaning |
| --- | --- |
| `id` | The roll's `id`, as fetched. |
| `status` | `"done"`, or `"failed"` when it wasn't made. |
| `reason` | Why it failed: `"off"` (the campaign doesn't take players' rolls now), `"invalid"` (not a roll the module makes; `error` says what), `"unknown"` (no such character in the campaign, or no such skill, tool or ability), `"not-dying"`, `"not-in-combat"` (the character isn't in the combat the Gamemaster has up), `"already-rolled"` (it has initiative), `"busy"`, `"cancelled"` (a module called the roll off), `"timeout"` (not made within a minute, as when a module asks the Gamemaster something first) or `"error"`. For a hit die, also `"no-hit-dice"` and `"self-test"`, and for it or a formula, `"dice"`; for a formula, also `"item"` and `"activity"`; see [Hit dice and formulas](#hit-dice-and-formulas). For an attack, a use or their damage, also: `"attacks-off"`, `"midi-off"`, `"self-test"`, `"item"`, `"activity"`, `"area"`, `"slot"`, `"ammo"`, `"mode"`, `"target"`, `"scene"`, `"consume"`, `"active-defence"`, `"reaction"`, `"bonus-action"`, `"midi-dialog"`, `"midi"`, `"no-attack"`, `"gone"`, `"not-waiting"`, `"type"` and `"damaged"`; see [Attacks](#attacks) and [Spells and features](#spells-and-features). For a save answering a prompt, also `"prompt"`; see [Saves the game asks for](#saves-the-game-asks-for). `null` when done. |
| `error` | What went wrong, for `"invalid"` and `"error"`, what dnd5e said for `"consume"`, and why for `"prompt"`; otherwise `null`. |
| `messageId` | The chat message the roll made. |
| `visible` | May the roll's player see that message? `false` for a roll made blind, as Midi-QOL can make a player's check. |
| `rolls` | The [rolls](#chat-message) as made, Foundry's total and every die, when `visible`; otherwise empty. |
| `healed` | For a hit die: the hit points it gained; see [Hit dice and formulas](#hit-dice-and-formulas). |
| `attack` | For an attack: `{ critical, fumble, outcome }`, and for an area attack `targets`, when `visible`; see [Attacks](#attacks). |
| `use` | For a use: `{ type }`, the kind of activity used; see [Spells and features](#spells-and-features). |
| `damage` | For an attack or a use: the dice its damage or healing will throw, or `null`; see [Attacks](#attacks). |
| `outcome` | For a save answering a prompt: `"success"` or `"failure"`, where its player may see whether they saved, as the card would show them; otherwise `null`. |

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
| `dc` | The DC, where dnd5e's *Challenge Visibility* lets the character's player see it on the card; otherwise `null`. |
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
  nothing. A favorite of one is left out only when its item is hidden or not identified. It adds
  `rules` to the sheet. Players may spend [hit dice and roll a utility's
  formula](#hit-dice-and-formulas): `"hitDie"`, once the self-test has checked it, and `"formula"`
  among the `kinds`, their fetched rolls, `rollFormula` on the sheet, `healed` in `command.result`,
  and the reasons `"no-hit-dice"` and `"dice"`. [Area attacks](#attacks) are made at the targets the
  player picks: `areaAttacks` in the hello's `features`, `attackArea` on the sheet, an attack's
  `targets`, and `attack`'s `targets` in `command.result`; only an area Midi-QOL targets itself is
  still refused (`"area"`). `attackArea`, `rollFormula`, `healed` and `attack`'s `targets` are left
  out where they don't apply; a listener that sends neither the new kinds nor an attack's `targets`
  needs no change.

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
| `save` | A saving throw. | `key`: the ability; `prompt`, the [prompt](#saves-the-game-asks-for) it answers, if any. |
| `death` | A death saving throw, while the character is dying. | |
| `initiative` | Initiative, while the character has none in the combat the Gamemaster has up. | `combatId` |
| `hitDie` | A [hit die](#hit-dice-and-formulas) spent, healing the character. Module 0.16.0. | `denomination`: its size, such as `"d10"`. |
| `formula` | A utility's [own roll](#hit-dice-and-formulas), such as a d4 of luck. Module 0.16.0. | `item`, `activity`: the item and activity with its `rollFormula`. |

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
| `kind`, `key`, `combatId`, `denomination`, `item`, `activity` | What is rolled, as above. |
| `mode` | `-1`, `0` or `1`: rolled with disadvantage, normally, or with advantage. |
| `explicit` | Did the player choose how, as in dnd5e's roll dialog? Then the game rolls it that way. Otherwise it rolls as the character's sheet has it, which is where the app's `mode` came from. |
| `extras` | What the player added, each `{ sign, count, sides }` or `{ sign, flat }`: such as `+1d4` for Bless. At most 10. Made as the roll's situational bonus. |
| `dice` | Every die thrown, in order: the d20s, one or two (`mode` not `0`), then each added term's dice; for a hit die, its one die; for a formula, each of its dice terms'. Each `{ faces, results }`, every result one of the die's faces. |

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

### Hit dice and formulas

Since module 0.16.0 a player can spend a hit die in the app, as on a short rest, and roll a
utility's own roll, such as a d4 of luck, which dnd5e's card offers as a button once it's used; and
have them made in the game with the dice they rolled. Neither is rolled with advantage, or has
anything added: `mode` is `0`, `explicit` `false` and `extras` empty.

```json
{ "id": "r2", "actorId": "aB3…", "kind": "hitDie", "denomination": "d10", "mode": 0, "explicit": false,
  "extras": [], "dice": [ { "faces": 10, "results": [7] } ] }
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
- **A formula** names the `item` and `activity`, as for a [use](#spells-and-features): a utility
  activity with a `rollFormula` on the sheet, or a Cast activity whose spell's first activity is
  one. It has the dice the formula throws: one `{ faces, results }` for each of its dice terms, in
  order, with as many results as the term has dice. It's rolled as the card's button rolls it,
  without its dialog, as the character's player, its card naming none of the Gamemaster's targets;
  even with Midi-QOL, it's the roll alone. Refused: `"item"` for no such item, or one not
  identified yet; `"activity"` for no such activity, one without a roll of its own, or one whose
  formula has a die no player rolls, such as a d3, or dice inside parentheses or a function; and
  `"dice"` for dice that aren't the ones its formula throws.

A module may change either roll before it's made, as dnd5e's hooks allow. Where the player's dice
can then no longer reach it, as inside a function, the roll is called off, nothing is spent or
healed, and it's refused as `"dice"`. Dice a module adds are Foundry's.

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
| `slot` | Optional: the spell slot a spell is cast with, such as `"spell3"` or `"pact"`, as a `spells` section's `id`. |
| `ammunition` | Optional: the `id` of the ammunition fired, one of the action's `ammunition`. |
| `attackMode` | Optional: the attack mode, one of the action's `attackModes`' `value`, such as `"twoHanded"` or `"thrown"`. |
| `mode`, `explicit`, `extras`, `dice` | As for a check: the d20s, then the dice the player added. |

| Roll field | Meaning |
| --- | --- |
| `kind` | `"damage"`. |
| `use` | The `id` of the attack, or [use](#spells-and-features), it follows. |
| `dice` | The dice the attack's `command.result` said its damage throws, in order, each `{ faces, results }`. None when it said they can't be planned, or there are none. |
| `types` | Optional: for each of the damage's rolls, by its place among them, the kind of damage chosen, as one of that roll's `types`' `key`, or `null`. A roll with no choice made is rolled as the kind last rolled, as dnd5e does. |
| `modifiers` | Optional, where the hello says `modifiers`: `{ extra, faces, maximize }`, how the player changed the damage in the app, each optional. `extra` more of its first roll's first die, up to 40, as many more as that roll's `perDie` for each; `faces` that die another size, `4`, `6`, `8`, `10` or `12`, as a versatile weapon's or Toll the Dead's; `maximize` every die at its highest, the game's own too. `dice` are then the changed ones. |

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
its auto-targeting is off, or one it targets around its user without a template. Before module
0.16.0, every area attack was refused.

Refused beforehand, rather than have the Gamemaster asked: an area attack Midi-QOL targets itself,
as above (`"area"`); a spell slot the usage
dialog doesn't offer, or with none left (`"slot"`); ammunition that isn't the weapon's, or is used
up (`"ammo"`); an attack mode that isn't the weapon's (`"mode"`); Midi's Active Defence; a reaction
or bonus action Midi enforces that's been used; an activity that always opens Midi's roll, consume
or damage dialog, or has Midi ask which effects to apply; and a target Midi can't target, or no
target where Midi needs one. Midi targets only tokens the Gamemaster's canvas draws, on the level
and scene they're viewing: any other is refused (`"scene"`), unless the Gamemaster turns on
**Allow Targets You Aren't Viewing**. Then the use is made; Midi works only on the targets it can
see, and the card names every target, for the Gamemaster to apply the rest. What's left may ask
the Gamemaster, as it would in Foundry, such as a target's reaction; an attack made after its
`"timeout"` is reported again.

`command.result` for an attack adds:

| Field | Meaning |
| --- | --- |
| `attack` | `{ critical, fumble, outcome }`, when `visible`. `outcome` is `"hit"` or `"miss"` at its target, given only where the game shows players whether an attack hit: dnd5e's *Attack Roll Visibility* not *None*; Midi's *Auto Check Hits* showing hits to all, and not whispered as the Gamemaster's own rolls are when private. Otherwise `null`. A target under total cover is missed. The target's armor class is never sent. An area attack also has `targets` (module 0.16.0): each `{ combatId, combatantId, outcome }`, in the order picked, its `outcome` given as above, and `null` for a target Midi didn't check, not being on the Gamemaster's canvas; `outcome` is then the one target's, or `null` for several or none. Its targets' names and armor classes are never sent. |
| `damage` | The dice the attack's damage will throw, for its player to roll: `{ critical, plannable, healing, rolls: [{ formula, type, types, dice: [{ faces, number }], perDie }] }`, as dnd5e will make up its rolls, with a critical hit's dice. A roll's `perDie` is how many dice it throws for each die of its own: `1`, or on a critical hit as many as this world's rules make of each, such as `2`; module 0.13.0. `plannable` is `false` when a die can't be known beforehand, such as a d3: the game then rolls all of them. `healing` is `true` for healing. A roll's `types`, `[{ key, label }]`, are the kinds of damage its roller chooses among, as Chromatic Orb's, or `null` for none. `null` when no damage follows, as when Midi's workflow ends at a miss. |

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
first die is changed before it's rolled, and a critical hit's dice made again, as this world makes
them, so the player throws `perDie` more dice for each they add; dice that aren't those changed
ones are refused (`"invalid"`, `"dice"`), as are changes the module can't read (`"invalid"`,
`"modifiers"`). Damage at its highest is rolled so, every die at its highest, Foundry's own too.

Players' attacks are offered once the self-test has also checked that the player's dice reach an
attack's damage. If they don't, attacks and uses stay in the app, and Manage Campaigns says why.
The self-test then checks that a critical hit's damage with a die more, made another size, throws
the dice it should, and that damage at its highest is; if not, the hello says `modifiers` is
`false`, and players' damage is rolled as it is.

### Spells and features

With the same option, a player's other uses of a spell or feature are made in the game too, at the
targets they picked: a saving throw's, such as Fireball or Sacred Flame; damage alone, such as
Magic Missile; healing, such as Cure Wounds or Second Wind; and anything else, such as Bless,
Shield or Action Surge. The item is used as in Foundry, spending what it spends, and its damage or
healing, if any, is rolled once the player rolls it, as an attack's:

| Roll field | Meaning |
| --- | --- |
| `kind` | `"use"`. |
| `item`, `activity` | The item and the activity used: an action's `id` and its `activity`'s `id` in the sheet, or a spell's, feature's or inventory item's, or an activity favorite's `itemId` and `activity`'s `id`, or the item's `id` and the `activity`'s `id` of any of its `activities`: a `save`, `damage`, `heal` or `utility` activity, or since module 0.15.0 a Cast activity whose spell's first activity is one. |
| `targets` | The combatants it's used at, each `{ combatId, combatantId }`, in a combat its player can see: up to 20, none twice, and no more than its `count`, at the level it's cast at; none for one used on its user alone. Empty out of combat. |
| `slot` | The spell slot a spell is cast with, as for an attack; or `null` for the usage dialog's own. For an activity used without spending a slot (`consumesSlot` `false`), the level it's used at, as that slot's: one with none left too, since none is spent. |

A use has no dice. The module uses the activity as an attack's, without placing a template: an
area's targets are those the player picked. Then:

- **dnd5e's cards.** The use's card is posted as the character's player, naming the targets, or
  its user for one used on its user alone. The Gamemaster rolls the targets' saving throws and
  applies the damage, healing and effects from it, as in Foundry; the player's damage or healing
  is rolled linked to it.
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

Refused beforehand, beyond what an attack is: an activity of another kind (`"activity"`), such as
a summoning, which dnd5e would ask the Gamemaster about; more targets than it takes, or any for
one used on its user alone (`"target"`); and, with Midi, a utility whose roll prompts for its
formula (`"midi-dialog"`).

`command.result` for a use adds:

| Field | Meaning |
| --- | --- |
| `use` | `{ type }`: the kind of activity used, `"save"`, `"damage"`, `"heal"` or `"utility"`. |
| `damage` | The dice its damage or healing will throw, as for an attack, never a critical hit's; or `null` when none follows, as for Bless, or where Midi rolled it itself. |

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

A card its character's player can't read asks no one. Where Midi-QOL rolls the saves itself, as
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
