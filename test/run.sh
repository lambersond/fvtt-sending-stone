#!/bin/sh
# One harness and one variant, with harness-all.sh's own set-up and run(): its "name variant oks=N
# exit=C" line and, when it fails, up to 15 lines that aren't ok. From the module's checkout:
#   npm run harness:one -- rolls BREAK_ROLL=1      (or sh test/run.sh rolls BREAK_ROLL=1)
[ $# -ge 1 ] || { echo "usage: sh test/run.sh <harness> [VARIABLE=value ...]" >&2; exit 2; }
eval "$(sed -n '1,/^}/p' "$(cd "$(dirname "$0")" && pwd)/harness-all.sh")"
run "$@"
exit $fail
