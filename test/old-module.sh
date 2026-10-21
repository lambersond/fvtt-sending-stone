#!/bin/sh
# The module's own older releases the harness compares with, extracted from this checkout's history by
# SHA (pins.env) into .cache/module-<version>: 0.29.0 for groups.mjs, 0.30.0 for outcomes.mjs. Each is
# extracted once, and again only when its pin changes. A shallow clone needs `git fetch --tags` first.
T=$(cd "$(dirname "$0")" && pwd)
R=$(dirname "$T")
. "$T/pins.env"
extract() {
  version=$1; sha=$2; dir=$R/.cache/module-$version
  [ "$(cat "$dir.sha" 2>/dev/null)" = "$sha" ] && [ -f "$dir/module.json" ] && return 0
  git -C "$R" cat-file -e "$sha^{commit}" 2>/dev/null \
    || { echo "module $version: $sha is not in this checkout's history (git fetch --tags)" >&2; return 1; }
  rm -rf "$dir" "$dir.sha"
  mkdir -p "$dir"
  git -C "$R" archive "$sha" | tar -x -C "$dir" || { echo "module $version: git archive $sha failed" >&2; rm -rf "$dir"; return 1; }
  echo "$sha" > "$dir.sha"
  echo "module $version: $dir at $sha"
}
extract 0.29.0 "$MODULE_029_SHA" && extract 0.30.0 "$MODULE_030_SHA"
