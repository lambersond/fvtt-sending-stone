# Sending Stone, the Foundry module: engineering guidelines

Follow these when changing this repository, as a person or as Claude. Each is true of the code as it
stands. [README.md](README.md) says what the module does and, under "Layout", what each script is
for; [test/README.md](test/README.md), how the harness works. Neither is repeated here.

## 1. What this is

- A Foundry VTT v14 module, shipped as written, with no build step. Foundry loads one entry,
  `scripts/module.mjs` (`module.json`'s `esmodules`); every other script is reached by import.
- **[PROTOCOL.md](PROTOCOL.md) is its contract with the Sending Stone app:** every event sent and
  every command taken. The app is another repository, released apart, so either may be the older.

## 2. The layers, and what may import what

The scripts stand in seven layers, bottom to top:

1. **Ground.** What the rest reads: constants and settings, the campaigns, the dice a roll is given,
   which dnd5e runs and which other modules (the author's own, Midi-QOL's Bonus Actions and
   reactions), which client sends, the issue forms' links, and what the commands' checks ask in
   common.
2. **The post.** The queue that posts events, and what became of each post.
3. **The game.** Which characters and parties are a campaign's, who may type a character's dice, its
   combats as it is told them, the rules of what players are shown of results, and a dish's effects.
4. **Sheets.** A character's or a party's sheet as plain data, with its descriptions and their
   links; a druid's Wild Shape and its forms; and which creatures are a character's companions.
5. **What each app was told.** Keeping every campaign's copy current: characters and parties,
   companions, journals, dishes' cards, chat, combat, the saves the game asks, and heartbeats; and,
   posting nothing itself, companions set right after their characters in Foundry's initiative.
6. **Commands.** What the app asks to be made here: each command's check and each kind's run, the
   dice the game rolls later, whose answer is a command, and the fetcher with its queues; and a
   campaign's Foundry settings for its Gamemaster, which say why attacks can't be made.
7. **The bridge and the entry.** The hello, the settings' registration and their windows, Wild
   Shape's hooks, which wait on the command queue, and `module.mjs`.

**A script imports only from its own layer or a lower one, and never its way back to itself,** by
`import`, `export … from` or `import()` alike. Scripts in a loop can't be read, loaded or tested one
without the others, and the order they load in comes to matter.

- **`npm test` enforces it, before any harness runs:** `test/import-layers.mjs` (alone:
  `node test/import-layers.mjs`, silent when all is well) fails on a loop, an import of a higher
  layer, a script in no layer or in two, one listed that isn't there, and an import it can't follow.
- **Which script is in which layer is `LAYERS` in that file, and nowhere else.** Add a new script
  there: in the lowest layer that holds everything it imports, or a higher one if that says better
  what it is for, never above a script that imports it. A new declaration goes in the script it
  plainly belongs to, no higher than what reads it. Give a new script its row in README.md's Layout.
- **The guard reads text, not syntax.** An import written in a comment can count, and the word
  `import` before a bracket that holds something other than one quoted path fails, in prose, in a
  string or as the name a method is declared by: word it otherwise. It also fails on any import but
  one of the module's own `.mjs` scripts, by a relative path.

## 3. When a lower script needs something of a higher one

1. **Move the declaration down,** to the importing script's layer or a lower one.
2. Or **split the script that holds two things,** each part in its own layer, as `bridge-role.mjs`
   stands apart from `bridge.mjs`, and `wild-shape-hooks.mjs` from `wild-shape.mjs`.
3. Or, **as a last resort, a seam,** where state on both sides lets no declaration move: in the
   lower script a `let` named as the function it stands for, with a default, and one exported
   `register…` that assigns it. Its comment says what it is handed, why, and what it does until
   then.

**Never an import back up, and never an `import()` written to slip past the guard,** which follows
those too. The module's only two, `findLink`'s in `command-links.mjs`, point down.

- **`module.mjs` registers a seam as it loads,** before any hook, so that nothing can call one
  unregistered, as it does `character-sync.mjs`'s `registerHelloResend`. A new seam goes there.
  A harness that loads a script without `module.mjs` gets such a seam's default, without a word.
- **Older ones are registered by the script that hands the function over,** as it is set up, as
  `later-dice.mjs` calls `dice-plan.mjs`'s `registerDiceAsks`.

## 4. State stays whole

- **A `let`, a `Map` or a `Set` of state and every function that changes it are in one script:** an
  import can't be assigned, and state written from two scripts has no one place that says how it
  changes. Others only read it: through its functions, as `dishReader` answers for `dish-card.mjs`'s
  `readers`, or by importing it where it is exported, as `endedForms` and `diceStatus` are.
- **The one exception:** `transport.mjs` counts into `status`, the tally of deliveries that
  `delivery-status.mjs` keeps, and says so. Don't add a second.

## 5. Nothing runs as a script loads, outside `module.mjs`

- **No statement runs as a script loads but `module.mjs`'s own:** its seam registrations, then its
  hooks (`init`, `ready` and its `Hooks.on` lines). No other script registers a hook as it loads: a
  function does that `module.mjs` calls from `init` or `ready` (`register…Hooks`, `install…`).
- **A top-level initialiser reads only a global, its own script, or a constant of a script it
  imports,** which, with no loop, has always loaded first (`sheet-actions.mjs`'s `SECTIONS` reads
  `sheet-rolls.mjs`'s `ACTION_KINDS`). So the order scripts load in decides nothing.

## 6. Files, names and comments

- **A script is named for what it holds,** in small letters and hyphens: `sheet-<part>.mjs`,
  `command-<kind>.mjs`, `<thing>-sync.mjs`. Never `utils`, `helpers`, `shared`, `common` or `misc`.
- **No barrel files and no `export … from`:** a name is imported from the script that declares it.
  (`transport.mjs` and `command-uses.mjs` each pass one name on for the harness, and say so.)
- **The harness and the app's e2e import scripts by path and name:** renaming a script or an export,
  or moving a declaration, means changing their import lines with it.
- Functions are camelCase, classes PascalCase, constants `UPPER_SNAKE_CASE`, and state camelCase
  (`readers`, `told`). Exports are named, but for the two windows' default classes.
- Names follow the module's patterns: `is…` and `can…` answer yes or no; `…Of` reads something;
  `note<Thing>Reader` notes, and `<thing>Reader` says, whether a campaign's app reads a thing
  (`noteDishReader`, `dishReader`); `dishFeatures` and its like are what a campaign's hello says.
- **A script opens, after its imports, with a header comment:** what it holds and, where a reader
  would ask, why it is a script of its own. Only `module.mjs`, `settings.mjs`, `issue-links.mjs` and
  the two windows have none. A declaration has a `/** … */` block with its types, as nearly all do.

## 7. A new kind of command

- **Its check, `check<Kind>Command`, goes beside `checkCommand` in `command-rolls.mjs`,** which asks
  it by `command.kind`, with the tables it alone reads. Give those names of their own: `FIELDS`,
  `OTHERS` and `ID` are taken there, and a script holds one of a name. (So a note's check is in
  `journals.mjs` and hit points' in `command-checks.mjs`, with what the checks ask in common.)
- **Its run, `run<Kind>Command`, goes in a `command-<kind>.mjs`,** its own or its kin's (three share
  `command-charges.mjs`), which `commands.mjs` calls, with whether a campaign takes the kind and
  what its hello says of it, as `command-effects.mjs` has `effectsOn` and `effectFeatures`.
- **A dice ask's answer, kind `dice`, is the one kind that follows neither:** checked and run in
  `later-dice.mjs`, beside the asks it answers.

## 8. The harness

- `npm ci` and `npm run test:setup` once; then **`npm test`: the guard, then every run in
  `test/harness-all.sh`,** under dnd5e 5.3.3 and, in its `DND5E6=1` runs, 6.0.5: it needs both. One
  run alone: `npm run harness:one -- rolls BREAK_ROLL=1`.
- **A change to what the module does comes with its harness cases,** in its area's
  `test/fvtt/<area>.mjs`, under both releases where they differ. A change that only moves code
  changes no assertion: only the import lines that name what moved. The app's e2e imports
  `test/fvtt/`'s stand-ins too: a change to one can break it.
- **test/README.md's counts stay true:** "48 harnesses, 115 runs" changes with `harness-all.sh`.
- **The dnd5e checkouts are read-only:** `test:setup` fetches them at pinned SHAs into
  `.cache/dnd5e/` (or set `DND5E5_DIR` and `DND5E6_DIR`). Never edit or commit them; a pin moves in
  `test/pins.env` alone.

## 9. Standing rules

- **`module.json`'s `version` is never edited by hand.** The release workflow stamps it, with
  `manifest` and `download`, from the `v*` tag pushed; the committed copy is stale on purpose.
- **A change to what is sent or accepted goes into [PROTOCOL.md](PROTOCOL.md) with it:** where the
  thing is described, as "Since module 0.x.0", and as an entry under "Additions within protocol 2".
  `PROTOCOL_VERSION` changes only for what a listener must adapt to.
- **An older app is never sent, or fetched from for, what it doesn't know.** An app says what it
  reads in the `features` of its answer to a hello or heartbeat, noted by `noteListenerFeatures`
  (`commands.mjs`); the hello's own `features` say what the module makes. Something new waits on
  both.
- **No console output but a failure's:** `console.warn` or `console.error`, begun `${MODULE_ID} |`.
  No `console.log`, and nothing left in from debugging.
