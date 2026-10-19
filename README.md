# Sending Stone

A Foundry VTT **v14** module that sends what happens at the table to the Sending Stone app, or any
listener that speaks its [protocol](PROTOCOL.md). Chat messages and combat tracker changes are
posted as JSON, campaign by campaign, so players can follow their game as it happens.

It is built for D&D Fifth Edition (dnd5e 5.3.x): roll messages carry the kind of roll, advantage,
and the item, activity and targets involved. Chat and combat events work under any system.

It also works the other way, for a campaign whose Gamemaster lets it: checks, saving throws,
initiative, death saving throws, hit dice and features' own dice, such as a d4 of luck, that a
player rolls in the app are made in Foundry with the dice they rolled, as if they had rolled them
there, and so can their attacks, spells and features and their damage or healing, through
Midi-QOL's workflow where it's in use, and the saving throws, checks, damage and rolls their
descriptions call for. See [Players' rolls](#players-rolls),
[Players' attacks and spells](#players-attacks-and-spells) and
[Descriptions that roll](#descriptions-that-roll).

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
twice; after that the event is dropped, and the Gamemaster is told what went wrong and what to do,
once per cause: once for the app's address, once for each campaign, once for each campaign and kind
of event. The full wire format is in [PROTOCOL.md](PROTOCOL.md).

## Setup

1. **Gamemaster, in the Sending Stone app:** under *Campaigns*, set up each campaign with its
   title, your game's Forge address and a secret.
2. **Gamemaster, in Foundry:** *Settings → Configure Settings → Sending Stone → Open Settings*.
   Under **General**, enter the **App address**, such as `https://sending-stone.vercel.app`.
   Events go to `/api/events` under it; you don't type that part. Then add each campaign with
   **New campaign**: on its **Connection** tab, the same title and secret as in the app (**Test**
   checks them before saving), and on its **Players** tab, **Add characters** to pick its player
   characters. Once saved, each campaign's dot down the side, and its Connection tab, say how its
   events, and its players' rolls, are going, as the browser sending them has it.
3. **Gamemaster:** under **General**, tick **Chat messages** and/or **Combat tracker**. Then share
   each campaign's invite link from the app; players open it and choose their character.

While a Gamemaster has the game open, each campaign that has been sent nothing else for 30
seconds is sent a heartbeat, so the app can show players whether the game is connected.

Each campaign's characters are sent with their sheets under D&D Fifth Edition: abilities, saves,
skills, tools, hit points, armor class and the like, as dnd5e shows them, along with their
features, conditions and effects, inventory, spells, traits and biography, and their actions, as
Tidy 5e's Actions tab lists them, with each one's bonus to hit, saving throw and damage, as are the
spells, features and inventory items that roll anything, and their favorites, as dnd5e's sheet
shows them, each old-style resource as the feature it stands for. Each character's sheet goes in
a post of its own, after the hello that lists the
campaign's characters, so that a large party's sheets never make one post too large for the app;
and to an app that expands them, in a smaller shape, each action referring to the item it repeats
and what every row has left out, which the app puts back as it was. When a character changes, such
as taking damage, levelling up or gaining a condition, its campaigns are sent it again, so players
can see their character and roll from it in the app. Descriptions, enriched as the player would see
them in Foundry, are sent once and
then only when one is new, since they are most of a sheet's size. Their saving throws, checks,
damage, healing, rolls and conditions are marked for the app to act on, and your own links in
them, such as Request Roll and Apply Status, are left out.

Every setting is in one window, *Settings → Configure Settings → Sending Stone → Open Settings*,
with its sections down the side: General, Modules, each campaign and the Roster. Only the open
section is shown, so a world with many players and campaigns never lists every character once per
campaign. Edits are kept as you move between sections, and nothing is saved until **Save Changes**.

| Section | Setting | Effect |
| --- | --- | --- |
| General | App address | The Sending Stone app's address. Each event goes to the campaigns it involves. |
| General | Chat messages | Chat messages created, edited and deleted, and the log being cleared. |
| General | Which messages | Every message a campaign's players can read, or only those its characters spoke. |
| General | Combat tracker | Encounters created, started, updated and ended; turns and rounds; combatants joining, leaving, rolling initiative and being defeated. |
| General | GM-only details | Also send what only a Gamemaster can see. Off by default. |
| General | Run players' attacks through Midi | Shown while Midi-QOL is active. On by default: players' attacks, spells and features from the app go through Midi's workflow. Off: they stay in the app while Midi handles items' uses. |
| General | Allow targets off your screen | Shown while Midi-QOL is active. Off by default: a player's use through Midi at a target on a level or scene you aren't viewing is refused. On: it's made, and you apply to such targets from its card what Midi can't. |
| Modules | | Which of the author's other modules are installed and on, such as [Manual Dice](https://github.com/lambersond/fvtt-manual-dice) and [Combat Focus](https://github.com/lambersond/fvtt-combat-focus), and what each unlocks here; whether Midi-QOL and libWrapper are active, and a note naming Midi-QOL's version where it lacks what asking its saves in the app needs; and whether the game system is D&D Fifth Edition. |
| A campaign's Players | | Its player characters, by player. **Add characters** lists the world's others, by player, to pick from, and a campaign with none can copy another's. While its players may enter their own dice results, each character has a switch for it, coming soon. |
| A campaign's Player actions | Players roll in the app, Attacks, spells and features, Save and concentration prompts, Allow Players to enter dice results manually | Whether its players' rolls, and attacks and spells, in the app are made here, and whether they're asked there for the saves the game asks of them, Midi-QOL's too while the character is open there. Under **Who rolls the dice**, whether its players may type in what their own dice show instead, which needs Players roll in the app and Manual Dice on; the app says it's coming soon. |
| A campaign's Connection | Title, Secret | Its title and its secret (sent as `Authorization: Bearer …` with its events), **Test**, and how its events and its players' rolls are going. |
| Roster | | Every player character against every campaign, to tick who plays in which. |

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

**Party sheets.** On a campaign's **Party** tab in Manage Campaigns, add the world's Group actors,
such as dnd5e's primary party. A group's sheet, the names and portraits of its members, its
inventory and its description, goes to the app for the campaign's characters whose players have
Observer or Owner on the group in Foundry; the tab says who sees each group, and warns when no one
does. A group no player of the campaign can see goes without its sheet. Party sheets need D&D Fifth
Edition, and an app that reads them.

### Players' rolls

Tick **Players roll in the app** on a campaign's **Player actions** tab, and its players'
skill, tool and ability checks, saving throws, initiative and death saving throws in the app are
made in Foundry too, with the dice they rolled there: the d20s, and any dice they added, such as a
d4 for Bless. So are the hit dice they spend, and a feature's own roll, such as a d4 of luck. dnd5e
makes each roll, without its dialog, as the character's player, so its card, critical hits, death
saving throws, the combat tracker, Dice So Nice and Midi-QOL all behave as if they had rolled in
Foundry. Each card is marked as rolled on Sending Stone. A campaign's Gamemaster can open any of
its characters' sheets in the app and roll as them; those rolls are marked GM on their cards, and
are made as the character's player all the same, so the modules that read a card's author treat
them as the player's own. Each tells the app which chat messages it made, so the app marks those
alone as yours, never a copy a player posts from their own browser. A module that posts chat
messages from your browser for players, as Midi-QOL does, could still let a player have one marked
while the roll is being made.

- **Under D&D Fifth Edition only.** The Gamemaster's browser makes the rolls, so a Gamemaster must
  have the game open, as for everything else.
- **How it's rolled.** A tap in the app rolls as the character's sheet has it, so Foundry decides
  advantage. Choosing advantage, disadvantage or extra dice in the app is the player's say, as in
  dnd5e's roll dialog.
- **Foundry's dice where the player rolled none.** A Halfling's reroll of a 1, Elven Accuracy's
  third d20, or a bonus the game applies, such as Bless as an effect, is rolled by Foundry. So is
  a die a formula rolls again, as a Great Weapon Fighter's `2d6r<=2` rerolls a 1 or a 2, or `1d6x`
  explodes on a 6: the player's dice are each die's first throw, and what a formula keeps or counts
  of them, as `4d6kh3` keeps the highest three, Foundry works out from those. Foundry's total
  stands, and is what the player is shown.
- **What the player is told.** The app shows each roll's total in the game, unless the roll was
  made blind, as Midi-QOL can make a player's check: then only that it was made.
- **Hit dice** heal the character as dnd5e's rest dialog does: the die and their Constitution
  modifier, at least 1, or 0 under the 2014 rules. dnd5e's roll keeps the die where a player's die
  can't reach it, so it's written the other way round, coming to the same total. A hit die the
  character hasn't left is refused in the app, rather than said on your screen. Several spent at
  once, of one size or more, are one roll from the app, which dnd5e makes a die at a time, a card
  each, as on a short rest; they stop once the character is at full hit points, and aren't spent
  at all if they're there already.
- **A self-test** checks, as the game loads, that the player's dice reach the roll made for them
  and no other. If it fails, as it might with a module that rolls dice its own way, players' rolls
  stay in the app, and each campaign's Player actions tab says why.
- **libWrapper** is recommended: with it, the dice are wrapped alongside other modules' wrappers.
- **Players' own dice.** Players who roll physical dice will be able to type what they show in the
  app instead, with [Manual Dice](https://github.com/lambersond/fvtt-manual-dice) on. With it on,
  **Allow Players to enter dice results manually** on a campaign's Player actions tab tells the app,
  which shows the setting as coming soon, and its Players tab shows each character's switch for it,
  coming soon too. Nothing is entered in the app yet.

The app's address must be able to answer the module's fetches of players' rolls, which only the
Sending Stone app, or a listener that says it can, is asked for; see
[PROTOCOL.md](PROTOCOL.md#rolls-from-the-app).

### Players' attacks and spells

Tick **Attacks, spells and features** too, and the campaign's players can attack,
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
- **At themselves.** A use whose range is Self that still names a creature, such as a potion or
  Wild Shape, lets the player pick themselves, Self, among its targets, first for healing and the
  like. It's then made at their token in the combat, or else at their token on the scene you're
  viewing, or else at the character, named on the card. Midi-QOL, which can target only a token
  your canvas draws, uses it then at the other targets or at no one, as before 0.22.0, for you
  to apply to the character from the card; only where its Requires Targets needs a target is it
  refused in the app.
- **With Midi-QOL**, the use goes through Midi's workflow, as if the player had used it in
  Foundry: Midi checks the hit, rolls the targets' saving throws and applies the damage, healing
  and effects as you have it set up. The card is yours, spoken as the character, since Midi asks
  a card's author to confirm and apply. While it's made, your targets are the player's targets,
  then they're put back. With **Run players' attacks through Midi** off, attacks
  and spells stay in the app.
- **Targets you aren't viewing.** Midi can only target tokens your screen shows, on the level and
  scene you're viewing, so a use at any other is refused, and its player is told you aren't
  viewing their target. With **Allow targets off your screen** on, it's made anyway: the card
  names every target, Midi does what it does for those your screen shows, and you apply the rest
  from the card.
- **Areas are picked, not placed.** No template is placed for an area spell or attack, such as a
  breath weapon's cone: its targets are the combatants the player ticked in the app. An area
  attack is one roll, and the app shows whether it hit each target, where the game shows players.
- **Spell slots.** A spell is cast with the slot the player chose, from those dnd5e's usage dialog
  offers, or else with its own level's, or the first one left at a higher level, as the dialog
  picks it. Upcast spells scale their damage and number of targets as in Foundry. A spell cast
  from an item is cast at a level, not with a slot, as below.
- **Items with several activities.** Each of an item's activities can be used, as Foundry's
  activity dialog offers them: Hex's curse and its Bonus Hex Damage, Channel Divinity's choices, an
  unarmed strike's grapple. The app shows an item as its first activity, which for a spell is how
  it's cast, with the rest beneath it. An activity used after a spell is cast without spending a
  slot, such as Spirit Guardians' save each turn, is used at the level the player picks, slots left
  or not, as dnd5e uses it.
- **Spells cast from items.** A staff's, a wand's or a scroll's spells, cast with its Cast
  activities, are cast from the item, spending its charges, or using up the scroll, rather than a
  spell slot, as Foundry casts them. The app lists the item under each kind of action it has: a
  staff that strikes as an action and casts Silvery Barbs as a reaction is under Actions and under
  Reactions. Where the Cast activity lets the spell be cast higher for more charges, as a wand of
  magic missiles or fireballs does, the player picks the level from those dnd5e's usage dialog
  offers, each with the charges it costs; levels the item never has the charges for, such as a
  2014 wand's 8th and 9th, aren't offered, and one it hasn't the charges for now is refused before
  anything is spent. The spell's damage, targets and cost scale as Foundry scales them, and
  modules listening to dnd5e's hooks for a spell cast from an item are told the level.
- **A spell's later activities, cast from an item.** Once a spell is cast from an item, its other
  activities, such as Hex's Bonus Hex Damage or Spirit Guardians' save each turn, are listed beneath
  the item's Cast row in the app, as on the Spells tab, and used through dnd5e's copy of the spell,
  at any level the item's Cast activity offers. As in Foundry, one that spends no slot spends no
  charges either; any other spends the item's charges again.
- **Check activities.** A feature's or item's check activity, such as the Thief's Fast Hands or
  the Manacles' Bind, is used from the app as in Foundry: its card is posted with dnd5e's button for
  each check it calls for, spending what it spends, for the table to roll. The player can instead
  roll their own check, with their dice, against its DC, as the card's button rolls it, spending
  nothing, a tool's own bonus added for a check of the tool. A spell's check, such as Maze's, is
  its target's to make: the player casts the spell, and its card asks for it. A spell's checks
  with no activation of their own, such as the 2014 Entangle's Escape Plants, are listed after how
  it's cast, even where dnd5e lists them first; the 2014 Silent Image's and Disguise Self's checks
  to see through them, and Entangle's, spend no slot, not being the spell cast, though they're used
  at the level the player picks, as in Foundry. One whose DC scales with the level it's used at,
  and every check activity under dnd5e 6 for now, are left to Foundry; with Midi-QOL, the targets'
  checks are Midi's, rolled as Midi rolls them, and one Midi would have its user make at
  themselves, as a tool's, is refused in the app, Midi rolling it with Foundry's dice.
- **Free castings.** A spell granted with uses of its own, such as Fey Touched's Misty Step, has
  dnd5e's free casting, a forward, which the app lists beneath it: cast from the app, it spends the
  use, never a slot, at the spell's own level, or a warlock's at their pact slots' level, as dnd5e
  casts it, and its card is the spell's. Repeats of the same free casting, as dnd5e gives a spell
  granted more than once, are listed once; forwards that each spend uses of their own are each
  listed. A forward to a summoning, a transformation, an enchantment or a Cast activity, or one
  whose level may be chosen, is left to Foundry, and so is a free casting of a check that isn't the
  spell cast, as the 2014 Silent Image's.
- **Enchantments.** An enchant activity, such as Magic Weapon, Shillelagh, True Strike, Sacred
  Weapon or Pact of the Blade, is used from the app on one of the character's own items: the player
  picks the profile, from those dnd5e offers at the level it's cast at, such as Magic Weapon's +2 at
  4th level, and the item, from those dnd5e's rules let take it, as a nonmagical weapon for Magic
  Weapon or a club or quarterstaff for Shillelagh. Its card is posted, with dnd5e's tray, spending
  what it spends, and the game applies it to that item as the tray would, tied to the
  concentration the spell began, its riders, such as Pact of the Blade's attack, included; the
  player's sheet then shows the item enchanted. Cast again on the same item, it replaces its
  enchantment rather than stacking another, and what was tied to the concentration it ends goes
  too, as a scroll of Magic Weapon read while concentrating on the spell. Left without an item, the
  card is posted for you to apply to an ally's weapon. One on its own item, such as a Flame Tongue's
  Engulf in Flames, is a switch in the app; used again while it's on, it's refused rather than put
  out at the cost of what it spends. Players can end the enchantments on their character's items
  from the app, as the item's owner can in Foundry with the ⟲ on dnd5e's card, an ally's Magic
  Weapon included, the ally's concentration going on; a magic item's template's, and a permanent one
  whose item is gone, stay. An item not identified yet is named as its player knows it. Where the
  game won't apply it once it's used, as when the item can no longer take it, it's left on the card
  for you; one whose concentration has ended by then isn't applied at all, as dnd5e's card no longer
  offers it. Choices made once, such as Eldritch Spear or Spell Mastery, and a magic item's
  templates, such as a Shield's +1, are left to Foundry; summoning and transforming are yours to do.
- **Changed damage.** A right-click or long-press on damage in the app lets a player roll it at its
  highest, or add more of its first die, or make that die another size, as a versatile weapon or
  Toll the Dead has, as dnd5e's damage dialog would. The game rolls it so, with their dice, a
  critical hit's extra dice and critical damage included, such as a melee weapon's die more for
  Savage Attacks and a weapon's critical damage: the die added to is always the damage's own,
  never its critical damage's nor one it takes away, such as Reduce's or Ray of Enfeeblement's
  −1d4; damage that takes a die away isn't offered at its highest, which would take the most away,
  even damage the game rolls itself, such as a d3's; nor is damage with a die that explodes, or
  rerolls on its highest face, as `1d6x`, which Foundry would roll again.
  A description's damage too; see [Descriptions that roll](#descriptions-that-roll).
- **Nothing asks you, where it can be helped.** An enchantment's profile and item are chosen in the
  app, so dnd5e's usage dialog never opens. Area attacks Midi targets itself around their user,
  summoning, transforming and other activities dnd5e asks about, Midi's Active Defence, a used
  reaction or bonus action Midi enforces, and an activity set to always show Midi's dialogs or to
  ask which effects to apply are refused in the app with a reason. Midi may still ask you what it
  would in Foundry, such as a target's reaction, an optional bonus or confirming ammunition or
  damage; the player is told it took too long, then that it was made once you answer.
- **Dice So Nice** doesn't animate a Midi attack while your tab is hidden, which would hold Midi's
  workflow until you came back.

### Concentration, charges and Heroic Inspiration

- **Ending concentration.** With **Players roll in the app** ticked, attacks or not, a player can
  end one of their character's concentrations from the app, as dnd5e's Break Concentration does:
  through dnd5e, so a module may still keep it, and what depends on it, such as Bless on their
  allies, ends too, deleted by your browser. Nothing is posted in chat, as dnd5e posts nothing, so
  the Gamemaster's page in the app doesn't offer it.
- **Spending charges.** With **Attacks, spells and features** ticked too, a player can spend a
  feature's, item's or activity's uses, or an old-style resource, directly, such as two Sorcery
  Points, a Luck point or a staff's charge, as they would on dnd5e's sheet, whether or not their
  attacks can be made now. Never a spell's own uses, which casting it spends, an item not identified
  yet, or a potion's, scroll's or other item's that's used up as it runs out, which only using it
  should spend. Nothing is given back from the app: a mis-tap is yours to put right on the sheet.
- **Heroic Inspiration.** With the same switch, a player can use or gain Heroic Inspiration, as
  dnd5e's sheet header toggles it.
- **A line in chat.** dnd5e posts nothing for what's changed on its sheet, so each spend, and each
  use or gain of Heroic Inspiration, posts a line as the character, such as "Spends 2 · Sorcery
  Points" or "Gains Heroic Inspiration", never how many are left. One you make from the app's
  Gamemaster page is marked "GM" on its card, as your rolls there are.

### Hit, miss and save results

The app shows whether an attack hit each target, and whether a creature saved or passed a check,
only where Foundry shows players, as Midi-QOL changes it. Under each campaign's title, Manage
Campaigns says what players see in chat now, from the settings below, and the campaign's Gamemaster
sees the same in the app.

- **dnd5e's attacks:** while dnd5e's **Attack Result Visibility** is "Show only results" or "Show
  results & target ACs" (under **Configure Visibility** in dnd5e's system settings). A target
  under total cover is drawn as your dnd5e draws it: hit under dnd5e 5 unless the attack fumbled,
  missed under dnd5e 6. With Midi-QOL active, dnd5e's card draws no hits and misses of its own:
  only an attack at one target is told, by whether its total is coloured as a hit, while Midi's
  **Color code Hit/Miss/Save Display** is on and **Only highlight critical/fumble hits** off.
- **Saves and checks,** whatever asked for them: dnd5e's save card, a roll request, a
  concentration card, Midi-QOL's card, a description's link, or nothing. dnd5e's **Challenge
  Visibility** decides by whose card it is, or whose roll where there's no card: "Show all" shows
  everyone; "Show only from other players" shows everyone a player's and no one the Gamemaster's;
  "Show none" shows only the player whose card or roll it is, and the app tells only their
  characters. dnd5e's default Challenge Visibility ("Show only from other players") already shows
  everyone whether each creature saved against a save card a player posted, and so does the app.
  With Midi-QOL active, only while Color code Hit/Miss/Save Display is on and Only highlight
  critical/fumble hits off: otherwise Midi takes dnd5e's success and failure off every roll.
- **Midi-QOL's cards,** told to everyone who can read the card, whoever it's whispered to:
  - hits and misses once Midi has checked them, with **Auto check if attack hits target** "Check -
    all see result" and Attack Result Visibility showing results;
  - for an attack at one target, with Auto check if attack hits target "None" or "Check - all see
    result", also by the colour of its total against the target's armor class, with Attack Result
    Visibility showing results, Color code Hit/Miss/Save Display on and Only highlight
    critical/fumble hits off; and on the Gamemaster's, by Midi's own hit and miss words, under
    **GM Attack Roll Display** "Hit/Miss Only" or "Hit/Miss/Critical/Fumble", whatever Attack
    Result Visibility is;
  - who saved, under **Auto check Saves** "Save - All see result only", "Save - All see result +
    save total" or "Save - All see Result + Rolls": a player's character where Challenge
    Visibility is "Show all" or "Show only from other players", any other creature only under
    "Show all", whoever's card it is.

Out of the box, dnd5e's Attack Result Visibility ("Hide all") hides every hit and miss, and Midi's
Auto check Saves ("Off") every save on its cards, so turn those on to see them in the app. With
Gamemaster-only information off, the Gamemaster's attack and damage rolls on Midi-QOL's cards arrive
trimmed as Midi-QOL's GM Attack Roll Display and GM Damage Roll Display show them to players. With
**GM-only details** on, every result is sent, whatever Foundry shows players, as armor class is, and
every roll whole.

### Saves the game asks for

Tick **Save and concentration prompts** too, and the campaign's players are asked in the
app for the saving throws the game asks of their characters, wherever Foundry waits for a player to
click one on a chat card. The app shows the request on every tab of the character, and the player
rolls it there; the game makes it with their dice, as if they had clicked the card's button, so
the card shows whether they saved.

- **What asks.** dnd5e's concentration check after a concentrating character takes damage; a spell
  or feature that calls for a saving throw, at each character it targets; and a saving throw or
  concentration check you request in chat from an enricher, such as `[[/save dex 15]]`'s request
  link, at every character whose player can read it. A request a player asks the table for from
  the app asks no one; see [Descriptions that roll](#descriptions-that-roll).
- **Only what the player could click.** A card whispered to you alone asks no one. The DC, and
  whether they saved, are shown in the app only where dnd5e's Challenge Visibility would show the
  player on the card, and the DC never where the card hides it from everyone, as a request for a
  link with `hideDC` does.
- **A failed concentration check ends concentration**, all of it, as dnd5e's card does. Players can
  also end a concentration from the app themselves; see [Concentration, charges and Heroic
  Inspiration](#concentration-charges-and-heroic-inspiration). Once a character no longer
  concentrates on what dnd5e's concentration card asked about, however it ended, the card asks
  them nothing more, even once they concentrate on something new. Midi-QOL's own concentration
  cards are left to Midi.
- **With Midi-QOL** checking saves, the saves it asks of a character are asked in the app while
  the character is open there: a monster's or your spell's save, check or skill check, a player's
  own spell from the app that catches them, a concentration check in Midi's "chat" or "item" mode,
  and an OverTime effect's turn save or check, such as Athletics to escape. Midi decides how it's
  rolled: the app shows Midi's advantage and DC, as Midi would show them, a concentration check's
  with Midi's own flags for concentration, and the player rolls it with their dice, Midi's bonuses
  with it; a save Midi fails or passes by itself isn't asked. What Midi makes of it, the damage,
  ending concentration or removing the effect, is Midi's as ever.
  - **Not open in the app?** Midi goes its own way at once, as you have it set up. Open, it waits a
    minute for the answer, then goes its own way; it waits as long as Midi's Player Save Timeout
    where that's shorter and Midi asks the player in Foundry too.
  - **Asked in Foundry too.** With Midi's Player Roll Saves at "chat", or a dialog setting, a player
    in Foundry is asked there as well: whichever they answer first counts. Answered in the app,
    Midi's chat request is deleted, or its roll dialog closed on their screen, so that Midi's Player
    Save Timeout doesn't roll the save again there. An answer from the app that fails leaves the
    save to Midi, its Player Save Timeout still counting from when Midi asked.
  - **A spell from the app** with no attack or damage, such as Hold Person, is made once a save it
    asks waits on the app, so other players' Midi spells from the app aren't held up a minute.
  - **Only on your browser.** Saves of a workflow on a player's browser, such as their spell cast in
    Foundry at another character, or on another Gamemaster's, aren't asked; nor a concentration card
    Midi posts on a player's browser; nor what Midi has Monk's TokenBar, Flash Rolls or Epic Rolls
    ask, or an OverTime effect's action save. A concentration card held for the app when you reload
    is rolled as Midi would once you're back.
  - With its Concentration Check at "chat only", dnd5e's card is posted, and the player is asked as
    for any card; Midi ends concentration after a failed check, as you have it set up. A save card
    of Midi's own workflow never asks as a card too.
- **Ten minutes.** A request waits ten minutes, or until its card is deleted or the save is rolled
  from it in Foundry.

### Descriptions that roll

With **Players roll in the app** ticked, players can act in the app on what their
character's descriptions call for: a spell's "DC 15 Dexterity saving throw", a cloak's "DC 15
Strength (Athletics) check" or "8d6 fire damage", dnd5e's save, check, skill, tool, damage and
healing links, or a `[[/r 1d4]]` in their biography. The conditions a description names, such as
Prone, are marked in every campaign, for the app to show their rules. Under dnd5e 6 players can
only roll a description's save or check themselves for now: asking the table and rolling a
description's damage or roll aren't offered yet.

- **Asking the table.** A player can ask the table for a description's saving throw or check:
  dnd5e's own roll request card is posted in Foundry, from their character, naming where it's from,
  such as "Roll Request: Staff of Fire", for you to roll for the creatures it calls on, with a
  button for each ability, skill or tool it offers, as your own request from the link would have.
  No one is asked in the app, and anyone in Foundry may click it, as on a request you post. A
  character can ask once in 10 seconds, and for the same link once in 30. Never for one in a secret
  section of the description, which the card would show everyone. One whose DC its author hid
  (`hideDC`) is asked for with its DC shown no one, as dnd5e's own request does, and rolls from it
  are judged against it.
- **Their own save.** A player can roll the save themselves, with their dice, against its DC, as if
  they had clicked it in the description, so the card shows whether they saved; against one its
  author hid too, which the app is never told. A concentration check is rolled as one, with War
  Caster and the like, with the character's own concentration ability where the link names none,
  and against 10 where it has no DC; a failed one leaves ending concentration to you, as dnd5e's
  link does, or to Midi-QOL as you have it set up.
- **Their own check.** Likewise a check: the player picks one of the checks it offers, such as
  "Strength (Athletics) or Dexterity (Acrobatics)", and it's rolled as dnd5e rolls it from the
  link, with the ability the link names, against its DC, so the card shows whether they passed. A
  tool needs no proficiency, as in Foundry, and a skill checked using a tool, under the 2024 rules,
  gets the higher of the two proficiencies, and dnd5e's advantage where the character is proficient
  with both: Foundry rolls the second d20, and the game's total counts. A check activity's own
  check, such as Fast Hands' Sleight of Hand, is rolled the same way, against the activity's DC; see
  [Players' attacks and spells](#players-attacks-and-spells).
- **Damage and healing**, with **Attacks, spells and features** ticked too, are
  rolled with their dice, on a card naming where they're from, such as "Starry Wisp (Staff of
  Fire)" for a spell an item casts, and no targets: you apply them from the card, as from dnd5e's
  own link. With Midi-QOL, it's the roll alone, outside any workflow, and it's offered even with
  **Run players' attacks through Midi** off. A link whose dice your world can't
  plan for the player, such as a d3's, is left as text.
- **A critical hit's, and changed.** A right-click or long-press on a description's damage lets the
  player roll it as a critical hit's, as when they hit with it on a natural 20, or change it as they
  would an attack's damage: at its highest, with more of its first die, or that die another size,
  the die added to never one it takes away, as the −1d4 of `3 - 1d4 + 2d6`, and damage that takes a
  die away never at its highest. Healing can be changed, but is never a critical hit's. The game
  rolls a critical hit's as your world rolls one: dnd5e's Critical Damage Modifiers and Powerful
  Critical, or Midi-QOL's critical damage rules for the Gamemaster. Damage dnd5e's own link rolls
  through one of the item's activities, as a `[[/damage]]` naming no formula, is a critical hit's
  only as that activity allows: never for a saving throw's damage, as dnd5e's damage dialog offers
  none, and with what it adds, such as a weapon's critical damage. One whose critical hit throws
  extra dice, as a melee weapon does for a character with Savage Attacks or Brutal Critical, or
  whose critical damage has dice of its own, is offered with those dice, as your world rolls them:
  thrown with the weapon's first die, at their most as Midi's "Max Critical Dice (flat number)" adds
  them, or left out where Midi's rules leave them out. Where Midi rolls a critical hit's dice apart,
  as its "Max Critical Dice (roll dice)" and exploding rules do, the app can't plan a description's
  critical hit, and doesn't offer one. Changes aren't offered where the self-test found damage isn't
  changed as expected.
- **Rolls**, such as `[[/r 1d4]]`, are rolled with their dice on a card naming where they're from.
  One with a die the app doesn't roll, such as a d3, is refused.
- **Dice Foundry rolls again, keeps or counts**, such as `[[/damage 2d6r<=2 + 7]]` or
  `[[/r 4d6kh3]]`, are links too: the player's dice are each die's first throw, and a reroll or an
  explosion is Foundry's, as for any roll.
- **Only what the description says.** The app names a link in a description the module sent it,
  and the module reads its formula and DC from its own copy, as the character's sheet has it now:
  a description that has changed since is refused until the app has the new one. Nothing a player
  writes into a description, such as their biography, can pass for a link, and every formula is
  the character's, resolved and checked, as in Foundry.
- **What's marked.** dnd5e's save, concentration, check, skill, tool, damage and healing links,
  Foundry's inline rolls, links to a condition's rules, and, in a game in English, saving throws,
  ability and skill checks, and damage in plain words. Conditions are found by name in any
  language. Attack, passive check and other links are shown as text, as are rolls made for your
  eyes or the roller's alone (`/gmr`, `/br`, `/sr`), and a check with an ability of your world's
  own.

Modules 0.17.0, 0.18.0, 0.19.0, 0.20.0, 0.21.0 and 0.22.0 each send every description again once,
in its new form. Since 0.20.0 a description with damage links is also sent again when the damage it
shows changes, as with Rage.

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

With **GM-only details** off, the listener receives what players could see:

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
| Party sheets | Only to characters whose players have Observer or Owner on the group in Foundry: names and portraits of its members, its inventory and its description, without secrets. |
| Foundry settings | Versions, this campaign's switches, the visibility settings that decide chat results, and what players see, for the campaign's Gamemaster only; never a secret, address or token. |
| Attack targets | Name only; armor class is withheld. Whether an attack hit each, only where Foundry shows players: dnd5e's *Attack Result Visibility*, and with Midi-QOL its *Auto check if attack hits target*, its highlights and its *GM Attack Roll Display* ([Hit, miss and save results](#hit-miss-and-save-results)). |
| Success or failure against a DC | Left out of roll summaries, so a hidden DC is not revealed. A save or check says whether it succeeded only as dnd5e's *Challenge Visibility* shows players for its card or roll, to its author's characters alone where it shows only them, and with Midi-QOL only while Midi keeps dnd5e's highlight; Midi-QOL's card says who saved only where Midi shows players it, a player's character's under "Show all" or "Show only from other players", any other only under "Show all". |
| The Gamemaster's rolls on Midi-QOL's cards | Trimmed as Midi-QOL's *GM Attack Roll Display* and *GM Damage Roll Display* show them to players: without the formula, dice or total each hides. |
| DCs on chat cards | A card's text, and a roll request's DC, as dnd5e's *Challenge Visibility* shows players: of the two labels its buttons have, with the DC and without, only the one players see; never a DC the card shows no one, as a request for a link with `hideDC`. A card's content goes with no button's DC, without labels with DCs players don't see, and with Midi-QOL's sections of hits and saves, drawn for you with armor classes and DCs, emptied; and its `system` data, as dnd5e 6 keeps a card's, with no target's armor class, no button's DC, a card's or a roll request's or concentration check's, and no request's DC. |
| Token dispositions | Friendly, neutral or hostile, as players see a token's border; never Secret, nor a hidden token's. |

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
- **Every post's size is checked.** The app takes posts of up to 1 MB until it says it takes more,
  as the Sending Stone app says 4 MB. A larger event is dropped, never sent, and you're told once for
  each campaign and kind of event. A sheet too large is withheld rather than cut short: you're
  warned once for each character and campaign, the campaign's Connection tab shows it until it's sent, and the
  app tells its player why. A hello, sheet or description lost to the app being unreachable for a
  while is sent again 30 seconds later.
- **A refusal shows until a post of the same kind gets through.** A campaign's Connection tab shows
  the last post the app refused until a post of the same kind reaches it, for a sheet that
  character's next, or until the app refuses another. The refused post itself isn't sent again.
- **Players' attacks and spells with Midi-QOL set your targets** while each is made, one at a
  time, then put them back.
- **Midi-QOL's request for a target's save is wrapped** on Gamemasters' browsers, its workflow's
  `queueTargetSaveRoll`, through libWrapper when it's active, so that a save for a character open
  in the app can be asked there; any other is Midi's own at once. A Midi-QOL without it is left
  as before, and the Modules section names its version.
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
| `scripts/companions.mjs` | The author's other modules, such as Manual Dice, and whether each is on in the world |
| `scripts/bridge.mjs` | Which browser sends, and the `bridge.hello` state snapshot |
| `scripts/heartbeat.mjs` | Heartbeats to campaigns sent nothing lately, so the app knows the game is connected |
| `scripts/transport.mjs` | Envelope, ordered delivery queue, retries and status; what the app says it takes of sheets, and no post larger; why the app refused a post or fetch |
| `scripts/delivery-status.mjs` | What the Gamemaster is told when posts or fetches fail, once per cause, and when they work again; each campaign's status in the settings window |
| `scripts/campaigns.mjs` | Campaigns, and moving pre-campaign connected characters into one |
| `scripts/characters.mjs` | A campaign's characters and who owns them |
| `scripts/sheet.mjs` | A character's sheet under dnd5e: abilities, saves, skills, tools and the like |
| `scripts/sheet-features.mjs` | A character's classes and features, grouped as dnd5e's Features tab groups them |
| `scripts/sheet-effects.mjs` | A character's conditions and effects, as dnd5e shows them to its player, and what it concentrates on |
| `scripts/sheet-inventory.mjs` | A character's inventory: items by type, containers, currency, encumbrance and attunement |
| `scripts/sheet-spells.mjs` | A character's spellcasting and spellbook, sectioned as dnd5e sections it |
| `scripts/sheet-details.mjs` | A character's biography, personality and details, traits, tools and death saves |
| `scripts/sheet-actions.mjs` | A character's actions, listed as Tidy 5e's Actions tab lists them, an item in a section for each kind of action it has |
| `scripts/sheet-favorites.mjs` | A character's favorites, as dnd5e's sheet shows them under Favorites; and the feature each old-style resource stands for |
| `scripts/sheet-enchant.mjs` | Which enchant activities the app may use, with their profiles and the items each may enchant, as dnd5e's rules have it; and the enchantments an item carries, and which of them its player may end |
| `scripts/sheet-rolls.mjs` | What an action, spell, feature or inventory item rolls, and each activity it's used through; the levels an item may cast its spell at, and their cost; the checks a check activity calls for, and what a forward is used through and spends; what each use spends |
| `scripts/sheet-texts.mjs` | Sheets' descriptions: enriched, their links marked, hashed, and sent only when a campaign lacks them; a group's without secrets and without links to act on, under hashes of their own |
| `scripts/sheet-links.mjs` | The links in a description the app can act on, marked as its own spans, and finding the one a player's command names |
| `scripts/sheet-values.mjs` | Helpers for describing a sheet as plain JSON; which counter a count is, and whether its player may spend it |
| `scripts/groups.mjs` | A campaign's groups (party sheets): the world's Group actors to pick from, the primary party first, and which of the campaign's characters see each, by their players' ownership |
| `scripts/sheet-group.mjs` | A group's sheet: its members' names and portraits, its description, and its inventory without what items roll or are used through |
| `scripts/sheet-slim.mjs` | A sheet in the smaller shape the app expands: actions by reference, defaults left out |
| `scripts/character-sync.mjs` | Sending each character's sheet after its campaign's hello, in a post of its own, and again when it changes, then each of the campaign's groups, again when it, its members' names or portraits, or its characters' ownership change, or one of its characters is deleted, and its removal when deleted, after the hello if one was on its way; withholding a sheet too large to post or a group's no player sees; sending again what was lost |
| `scripts/chat.mjs` | Chat hooks |
| `scripts/chat-data.mjs` | Chat message serialization and audience, its GM roll, and each roll's damage marks: whether it's damage, its type's label, its part of Midi-QOL's card and a bonus's name, and whether it's the attack; whether an attack hit each target, who saved and whether a save or check succeeded, by the rules of `results.mjs`; dnd5e 6's typed messages, and their data without what players don't see; its content without what cards keep from players; the Gamemaster's rolls on Midi-QOL's cards trimmed as Midi shows them to players |
| `scripts/results.mjs` | The rules of what players see of chat results, as dnd5e and Midi-QOL show them, read once per message, and the verdict on them that Manage Campaigns and the app show |
| `scripts/foundry-settings.mjs` | A campaign's Foundry settings for its Gamemaster in the app: versions, its switches, the visibility settings that decide chat results and the verdict; sent again when one changes or a listed group is renamed or deleted, and after a hello if they changed while it was on its way |
| `scripts/combat.mjs` | Combat hooks |
| `scripts/combat-data.mjs` | Combat and combatant serialization, each combatant's token's disposition as players see it |
| `scripts/campaign-combats.mjs` | Which campaigns each combat has reached, and sending to them |
| `scripts/commands.mjs` | Fetching players' rolls, attacks, spells and descriptions' links from the app, one campaign at a time, with which characters it has open, and reporting what became of each, a Gamemaster's roll with the chat messages it made; what a campaign's hello says it makes |
| `scripts/prompts.mjs` | The saves the game asks of a campaign's characters on chat cards, told to the app as prompts, and closed as they're answered, or a concentration card's once its character no longer concentrates on what it asked about |
| `scripts/midi-prompts.mjs` | Midi-QOL's own saves, concentration checks and OverTime turn saves, asked in the app while the character is open there, answered with the player's dice, or left to Midi |
| `scripts/command-rolls.mjs` | Making a player's roll through dnd5e, as the player, and marking its card, as the Gamemaster's where they made it; a prompt's save on its card, or Midi-QOL's as Midi rolls it; a description's save or check, or a check activity's check, against its DC; several hit dice spent at once, a die at a time |
| `scripts/command-texts.mjs` | Asking the table for a description's save or check, and rolling a description's damage, healing or roll with a player's dice |
| `scripts/command-uses.mjs` | Making a player's attack, spell or feature and its damage or healing, through dnd5e's cards or Midi-QOL's workflow; a spell an item casts at the level chosen; check activities, and forwards used through the activity they name |
| `scripts/command-enchant.mjs` | Using enchant activities (Magic Weapon, Shillelagh, Flame Tongue…) on the character's own items, and ending enchantments, through dnd5e's cards or Midi-QOL's workflow; sending a character's sheet ahead of what a command changed |
| `scripts/command-concentration.mjs` | Ending a character's concentration from the app, through dnd5e |
| `scripts/command-charges.mjs` | Spending a character's charges and using or gaining Heroic Inspiration from the app, each with its line in chat |
| `scripts/dice-plan.mjs` | Giving a player's roll the dice they rolled, planning damage's dice as the world rolls them, critical hits too, and the self-test that it works |
| `scripts/apps/settings-window.mjs` | The settings window: General, Modules, each campaign's players, party, player actions and connection test, what its players see in chat, and the Roster |
| `templates/settings/` | The settings window's templates, one for each kind of section |
| `tools/echo-listener.mjs` | Stand-in listener for development |
| `PROTOCOL.md` | Event envelope and payload reference |
