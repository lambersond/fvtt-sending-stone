#!/bin/sh
# Remakes the app's slim-sheet fixture, src/utils/slim-sheet.fixture.json in the app's checkout (its
# slim-sheet.test.ts reads it), for when the slim format changes: every harness-all.sh run, with
# SLIM_FIXTURE set, so each SLIM_CHECK=1 run adds its actors' widest {name, full, slim} sheets
# (slim-check.mjs, under 600 KB in all). The new file replaces the app's only when every run passed.
# APP_DIR is the app's checkout, by default sending-stone-player beside this one.
T=$(cd "$(dirname "$0")" && pwd)
R=$(dirname "$T")
APP_DIR=${APP_DIR:-$(dirname "$R")/sending-stone-player}
[ -d "$APP_DIR/src/utils" ] || { echo "no app checkout at $APP_DIR: set APP_DIR" >&2; exit 2; }
mkdir -p "$R/test/out"
NEW=$R/test/out/slim-sheet.fixture.json
rm -f "$NEW"
SLIM_FIXTURE=$NEW sh "$T/harness-all.sh" || { echo "a run failed: $APP_DIR/src/utils/slim-sheet.fixture.json left as it was" >&2; exit 1; }
mv "$NEW" "$APP_DIR/src/utils/slim-sheet.fixture.json"
echo "slim-sheet.fixture.json: $(wc -c < "$APP_DIR/src/utils/slim-sheet.fixture.json") bytes, in $APP_DIR/src/utils"
