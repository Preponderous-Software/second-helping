#!/usr/bin/env bash
# Builds the release download: second-helping-<version>-web.zip, holding
# exactly what the arcade deploy ships (the web/ folder) inside a top folder
# second-helping-<version>-web/, plus a version.txt.
#   tools/build-release.sh <version> [out-dir]   (out-dir defaults to dist)
set -euo pipefail
version="${1:?usage: tools/build-release.sh <version> [out-dir]}"
out="${2:-dist}"
slug=second-helping
name="$slug-$version-web"
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/$name"
cp -R "$root/web/." "$stage/$name/"
printf '%s\n' "$version" > "$stage/$name/version.txt"
rm -f "$out/$name.zip"
(cd "$stage" && python3 -m zipfile -c "$out/$name.zip" "$name")
echo "$out/$name.zip"
