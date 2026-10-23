# The harness

The module's own scripts, run in Node against stand-ins for Foundry VTT 14 and Midi-QOL and against
dnd5e's real dice classes: 37 harnesses, 81 runs of them in `harness-all.sh`. No Foundry, no browser
and no network: `fvtt/stub.mjs` stands in for Foundry's core and replaces `fetch`, so every post the
module makes lands in the harness, and the stand-in app answers it. None of this is part of the
module: Foundry reads `module.json` only, and the release workflow leaves `test/`, the package files,
`node_modules` and `.cache` out of `module.zip`.

## Set-up

Node 22 (`.nvmrc`), POSIX `sh`, coreutils' `timeout` and git. From the module's checkout:

    npm ci
    npm run test:setup

`npm ci` installs jsdom, handlebars and showdown, pinned exactly. `npm run test:setup` fetches what the harness
loads but this repository doesn't hold (`pins.env`):

- **dnd5e 5.3.3 and 6.0.5** (`dnd5e.sh`): a shallow, sparse clone of
  https://github.com/foundryvtt/dnd5e at each release's tag, into `.cache/dnd5e/<tag>`, holding only
  `module/`, `lang/` and `templates/` in dnd5e's own layout. It is refused unless its HEAD is the pinned
  SHA and its `system.json` names the version. To use checkouts you already have instead, set
  `DND5E5_DIR` and `DND5E6_DIR` to their roots (absolute paths of the folders holding `module/`) for
  `npm run test:setup` and `npm test` alike: `dnd5e.sh` then fetches neither release, and only checks
  that each checkout's `system.json` names its version (not its SHA), never changing it.
- **The module's own 0.29.0 and 0.30.0** (`old-module.sh`): extracted from this checkout's history by
  SHA (`git archive`) into `.cache/module-<version>`, for `groups.mjs` (a character's hash, byte for
  byte as 0.29.0 made it) and `outcomes.mjs` (chat data as 0.30.0 sent it). `harness-all.sh` extracts
  them itself when they're missing. A shallow clone needs `git fetch --tags` first.

## Running

    npm test                                    # every run: sh test/harness-all.sh
    npm run harness:one -- rolls BREAK_ROLL=1   # one harness, one variant: sh test/run.sh …

Each run prints one line, `name variables oks=N exit=C`: how many `ok` lines it printed, and its exit
code. A failed run also prints up to 15 of its lines that aren't `ok`, and `npm test` exits 1 when any
run failed. A full pass takes about seven minutes.

`MODULE_DIR` is the module under test: this checkout unless set. The variables the harnesses read:

| variable | does |
|---|---|
| `X=1` | nothing: a placeholder for the plain run |
| `MIDI=1` | Midi-QOL's stand-ins (`midi-fake.mjs`, `midi-saves.mjs`, `midi-critical.mjs`) active |
| `OLD_MIDI=1` | a Midi-QOL that lacks what the module's Midi prompts need |
| `LIBWRAPPER=1` | libWrapper present, the module wrapping through it |
| `OMIT_ROOT=1` | Foundry's dice without `_root` on a roll's own dice |
| `DND5E6=1` | dnd5e 6.0.5's stand-ins and dice, rather than 5.3.3's |
| `BREAK_ROLL=1`, `BREAK_MIN=1`, `BREAK_REROLL=1` | dice that don't go through `_roll`, a `min` modifier that does nothing, a reroll or explosion thrown as a first roll: each makes the module's dice self-test fail, as it should |
| `SLIM_CHECK=1` | preloads `slim-check.mjs`: every full sheet posted must slim and expand back to itself |
| `SLIM_DUMP=file` | with `SLIM_CHECK=1`, keeps the sheet that failed |
| `SLIM_FIXTURE=file` | with `SLIM_CHECK=1`, adds each actor's widest sheet to the file (`npm run fixture:slim`) |
| `DEBUG=1` | `midi-prompts.mjs` prints what didn't settle |

## The files

`fvtt/` holds the harnesses (one per area of the module, named in `harness-all.sh`) and what they share:

| file | what it is |
|---|---|
| `stub.mjs` | Foundry core: users, actors, combats, settings, hooks, chat messages; replaces `fetch` |
| `dice-core.mjs` | Foundry v14's core dice |
| `token-core.mjs` | Foundry v14's scenes, tokens and synthetic actors, with their deltas and hooks as a fault picks them, a world actor's item changed as core passes it on to its tokens' creatures, companions' world actors (the only maker of an actor's `ownership`), and combats whose initiative and flags are written as core writes them: what `companions.mjs`, `alone.mjs` and the app's e2e (through `e2e/fvtt`) keep companions on |
| `journal-core.mjs` | Foundry v14's journals, folders and pages, with their ownership, `_stats` and hooks, its showdown and `cleanHTML`: what `notes.mjs` and the app's e2e (through `e2e/fvtt`) keep journal notes in |
| `actor5e.mjs`, `activity5e.mjs`, `enchant5e.mjs` | dnd5e 5.3.3's actor rolls, items and activities, and enchantments, ported as far as the module uses them |
| `dnd5e-cards.mjs` | dnd5e's concentration and chat cards, and Midi-QOL's concentration card |
| `midi-fake.mjs`, `midi-saves.mjs`, `midi-critical.mjs` | Midi-QOL 14's workflow, 13's saving throws, and its rules for critical hits |
| `crit-parentheticals.mjs` | Foundry's parenthetical dice terms |
| `settings-app.mjs` | ApplicationV2 and Handlebars, enough to draw and use the module's settings window in jsdom |
| `results-world.mjs` | the world `verdict`, `gmrolls`, `chat6` and `foundry-settings` share |
| `slim-check.mjs`, `slim-expand.mjs` | the slim-sheet check, and the app's expansion of a slim sheet, ported |
| `texts-hooks.mjs` | a loader that wraps `sheet-links.mjs`'s `findLink` for made-up descriptions |
| `dnd5e-hooks.mjs`, `dnd5e-register.mjs` | a loader that stubs the roll dialogs dnd5e's dice import, for files under `/module/dice/` |
| `unref-timers.mjs` | lets Node exit with the module's timers still set |
| `paths.mjs` | dnd5e's two roots and `oldModule(version)` |
| `THIRD-PARTY.md` | dnd5e's MIT notice and the Midi-QOL attribution |

Every run is `node --import ./unref-timers.mjs --import ./dnd5e-register.mjs <harness>.mjs`, from
`fvtt/`, with `--import ./slim-check.mjs` under `SLIM_CHECK=1`.

## Adding a harness

Start it with `import … from './stub.mjs'` (before any of the module's scripts), take dnd5e's paths
from `./paths.mjs`, print one `ok - …` line per check, and exit non-zero on the first failure
(`node:assert` does). Add its runs to `harness-all.sh`, with `SLIM_CHECK=1` when it posts sheets.

## Moving a pin

Change the tag and SHA together in `pins.env` (from `git ls-remote https://github.com/foundryvtt/dnd5e`)
and run `npm run test:setup` (with `DND5E5_DIR` and `DND5E6_DIR` unset), which fetches the new release
and refuses a checkout at any other SHA.
dnd5e 6.0.5 stays the 6.x pin until the module's 6.x support plans otherwise.

## The app's e2e uses these stand-ins

The app's `e2e/` suites import `fvtt/` through a link (`e2e/fvtt`) to this folder, from a checkout of
this repository beside the app's (`SENDING_STONE_MODULE`). Changing a stand-in here can break the app's
e2e: run both, and keep the two repositories' branches in step.

## Third-party code

See `fvtt/THIRD-PARTY.md`: four stand-ins are ported from dnd5e (MIT, its notice there); three are
modelled on Midi-QOL (CC BY 3.0), with no Midi-QOL file copied or run; no Foundry VTT file is used.
dnd5e itself is fetched at set-up and never committed.
