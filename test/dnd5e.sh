#!/bin/sh
# dnd5e's two pinned releases for the harness (pins.env), each fetched once into .cache/dnd5e/<tag>: a
# shallow, sparse clone of https://github.com/foundryvtt/dnd5e at the tag, holding only module/, lang/
# and templates/ (and its top-level files) in dnd5e's own layout, as dnd5e-hooks.mjs needs. It is
# refused, and removed, unless its HEAD is the pinned SHA and its system.json names the tag's version.
# DND5E5_DIR and DND5E6_DIR, when set, are checkouts of your own the harness uses instead (paths.mjs):
# that release is then not fetched, and its checkout is only checked (system.json names the version),
# never changed or removed.
T=$(cd "$(dirname "$0")" && pwd)
R=$(dirname "$T")
. "$T/pins.env"
URL=https://github.com/foundryvtt/dnd5e
version_of() { node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$1/system.json" 2>/dev/null; }
fetch() {
  tag=$1; sha=$2; own=$3; dir=$R/.cache/dnd5e/$tag; version=${tag#release-}
  if [ -n "$own" ]; then
    [ -f "$own/module/dice/d20-roll.mjs" ] || { echo "dnd5e $version: no dnd5e at $own (module/dice/d20-roll.mjs): refused" >&2; return 1; }
    got=$(version_of "$own")
    [ "$got" = "$version" ] || { echo "dnd5e $version: $own/system.json says ${got:-nothing}, not $version: refused" >&2; return 1; }
    echo "dnd5e $version: $own, your own checkout, not fetched"
    return 0
  fi
  if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" != "$sha" ]; then
    rm -rf "$dir"
    mkdir -p "$R/.cache/dnd5e"
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" --filter=blob:none --sparse "$URL" "$dir" \
      && git -C "$dir" sparse-checkout set module lang templates \
      || { echo "dnd5e $tag: the clone failed" >&2; rm -rf "$dir"; return 1; }
  fi
  head=$(git -C "$dir" rev-parse HEAD)
  [ "$head" = "$sha" ] || { echo "dnd5e $tag: HEAD is $head, not the pinned $sha: refused" >&2; rm -rf "$dir"; return 1; }
  got=$(version_of "$dir")
  [ "$got" = "$version" ] || { echo "dnd5e $tag: system.json says ${got:-nothing}, not $version: refused" >&2; rm -rf "$dir"; return 1; }
  echo "dnd5e $version: $dir at $sha"
}
fetch "$DND5E5_TAG" "$DND5E5_SHA" "$DND5E5_DIR" && fetch "$DND5E6_TAG" "$DND5E6_SHA" "$DND5E6_DIR"
