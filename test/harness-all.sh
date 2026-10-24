#!/bin/sh
# Every module harness and variant: "name variant oks status". From the module's checkout: npm test.
# dnd5e comes from DND5E5_DIR and DND5E6_DIR when they are set, else from the pinned copies that
# npm run test:setup fetched into .cache/dnd5e (fvtt/paths.mjs); the module's own 0.29.0 and 0.30.0 are
# extracted from its history into .cache when missing (old-module.sh). MODULE_DIR is the module under
# test: this checkout unless set. test/run.sh runs one line of these with this file's own run().
T=$(cd "$(dirname "$0")" && pwd)
R=$(dirname "$T")
MODULE_DIR=${MODULE_DIR:-$R}
for dir in "${DND5E5_DIR:-$R/.cache/dnd5e/release-5.3.3}" "${DND5E6_DIR:-$R/.cache/dnd5e/release-6.0.5}"; do
  [ -f "$dir/module/dice/d20-roll.mjs" ] || { echo "no dnd5e at $dir: run npm run test:setup, or set DND5E5_DIR and DND5E6_DIR" >&2; exit 2; }
done
sh "$T/old-module.sh" > /dev/null || exit 2
cd "$T/fvtt"
fail=0
# SLIM_CHECK=1 preloads slim-check.mjs: every full sheet posted must slim and expand back to itself.
run() {
  h=$1; shift
  pre=; case " $* " in *" SLIM_CHECK=1 "*) pre="--import ./slim-check.mjs";; esac
  out=$(env "$@" MODULE_DIR="$MODULE_DIR" timeout 300 node --import ./unref-timers.mjs --import ./dnd5e-register.mjs $pre $h.mjs 2>&1)
  code=$?
  echo "$h ${*:-plain} oks=$(echo "$out" | grep -c '^ok') exit=$code"
  [ $code -ne 0 ] && { fail=1; echo "$out" | grep -v '^ok' | head -15; }
}
for h in favorites sheet step2 step3; do run $h X=1 SLIM_CHECK=1; done
for h in features links scenario resend heartbeat dialog sync; do run $h X=1; done
run rolls X=1; run rolls LIBWRAPPER=1; run rolls OMIT_ROOT=1; run rolls LIBWRAPPER=1 OMIT_ROOT=1; run rolls BREAK_ROLL=1; run rolls BREAK_MIN=1; run rolls BREAK_REROLL=1
for v in X=1 MIDI=1 LIBWRAPPER=1 OMIT_ROOT=1; do run attacks $v; done
run uses X=1 SLIM_CHECK=1; run uses MIDI=1 SLIM_CHECK=1; run uses LIBWRAPPER=1; run uses OMIT_ROOT=1
for v in X=1 MIDI=1; do run prompts $v; done
# Midi-QOL's own saves asked in the app (module 0.27.0): through libWrapper too, with a Midi that
# lacks what they need, and with no Midi.
for v in MIDI=1 "MIDI=1 LIBWRAPPER=1" "MIDI=1 OLD_MIDI=1" X=1; do run midi-prompts $v; done
for v in X=1 MIDI=1; do run texts $v; done
# Each roll's marks in chat messages and command.result (module 0.28.0): dnd5e's, and Midi-QOL's card.
for v in X=1 MIDI=1; do run chat-rolls $v; done
run activities X=1 SLIM_CHECK=1; run activities MIDI=1 SLIM_CHECK=1; run activities LIBWRAPPER=1; run activities OMIT_ROOT=1
for v in X=1 MIDI=1; do run enchant $v SLIM_CHECK=1; done
run errors X=1
# Ending a concentration, spending charges and Heroic Inspiration, and hits, misses and saves in chat
# (module 0.29.0): dnd5e's alone, and with Midi-QOL's stand-ins.
for v in X=1 MIDI=1; do run concentration $v SLIM_CHECK=1; run charges $v SLIM_CHECK=1; run outcomes $v; done
# Module 0.30.0: party sheets (dnd5e 5.3.3 and 6.0.5 stand-ins), the Foundry settings field and its
# verdict against every gate, and chat results matching what Foundry shows players.
for v in X=1 "X=1 DND5E6=1"; do run groups $v SLIM_CHECK=1; done
for v in X=1 MIDI=1; do run foundry-settings $v; run verdict $v; done
for v in X=1 MIDI=1; do run outcomes $v; done          # existing run, cases extended
for v in X=1 MIDI=1; do run gmrolls $v; done           # §3.7 F6: a Gamemaster's rolls on Midi's cards
run chat6 X=1 DND5E6=1
# Module 0.31.0: moving items and coins (dnd5e 5.3.3 and 6.0.5 stand-ins), and Hit/miss and save
# results in the app, Always.
for v in X=1 "X=1 DND5E6=1"; do run transfers $v SLIM_CHECK=1; done
# Module 0.32.0: players type in what their own dice show (dnd5e 5.3.3 and 6.0.5 stand-ins, and Midi-QOL's),
# and an app roll's critical damage as dnd5e makes it, whatever Midi-QOL's rules for critical hits say.
for v in X=1 "X=1 DND5E6=1" MIDI=1; do run typed $v SLIM_CHECK=1; done
for v in X=1 "X=1 DND5E6=1" MIDI=1 "MIDI=1 DND5E6=1"; do run crit-rules $v; done
# Module 0.32.0: a party's things sent elsewhere by its Owner, party to party, and a party's coin
# distributed among its characters (dnd5e 5.3.3 and 6.0.5 stand-ins).
for v in X=1 "X=1 DND5E6=1"; do run sends $v SLIM_CHECK=1; done
# Module 0.33.0: an item removed from a character (dnd5e 5.3.3 and 6.0.5 stand-ins), fetched with
# rolls and moves off.
for v in X=1 "X=1 DND5E6=1"; do run removals $v SLIM_CHECK=1; done
# Module 0.34.0: journal notes, personal and party, chapters, kept in step with Foundry (dnd5e 5.3.3 and
# 6.0.5 stand-ins), fetched with rolls, moves and removals off.
for v in X=1 "X=1 DND5E6=1"; do run notes $v; done
# Module 0.36.0: companions (the creatures a character summons, and the NPCs its player owns),
# found, sent and commanded on their own tokens (dnd5e 5.3.3 and 6.0.5 stand-ins, and Midi-QOL's);
# and damage on its own and recharges.
for v in "X=1 SLIM_CHECK=1" MIDI=1 "X=1 DND5E6=1"; do run companions $v; done
for v in X=1 MIDI=1 "X=1 DND5E6=1"; do run alone $v; done
# Module 0.36.0: ending a turn from the app, the character's or a companion's, by Foundry's Next Turn.
for v in X=1 MIDI=1 "X=1 DND5E6=1"; do run turns $v; done
exit $fail
