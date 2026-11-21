# Releasing Second Helping

Releases are made by the fleet's release automation. The arcade is separate:
every push to `main` keeps deploying `web/` to
https://second-helping.play.danielstephenson.dev, whether or not a release is cut.

## Versions and tags

- The version lives in `package.json` (`"version"`). It is the only version file.
- The arcade deploy reports `<package.json version>+g<short sha>`.
- Tags are the bare version, `X.Y.Z` (for example `0.1.0`), annotated, on a
  commit of `main` whose `package.json` holds that version.

## What a tag builds

Pushing a tag runs `.github/workflows/release.yml`. It checks that
`package.json` matches the tag, runs the unit tests (`npm test`), builds
`second-helping-<version>-web.zip` with `tools/build-release.sh` (the `web/`
folder the arcade serves, inside `second-helping-<version>-web/`, plus a
`version.txt`), writes `second-helping-<version>-web.zip.sha256`
(`sha256sum` format), creates the GitHub release if it does not exist and
uploads both files.

Running the workflow by hand with no tag is a dry run: it builds and checks
the zip at the selected commit and keeps it as a workflow artifact, attaching
nothing.

## Saves

Progress is kept in `localStorage` under `second-helping.v1`
(`{"reached": <day>, "met": [<door>, ...]}`). It is read by `parseSave` in
`web/rules.js`, which also holds `SAVE_VERSION`.

- `tests/fixtures/saves/v<N>-<name>.json` are saves written by a released
  build: each maps a `localStorage` key to the exact string the game stored.
  The current ones were dumped from the 0.1.0 build after playing it in
  headless Chromium.
- `tests/saves.test.cjs` names every fixture, fails on any file it does not
  name, and loads each through `parseSave`.
- Released fixtures never change. When the stored format changes, bump
  `SAVE_VERSION`, migrate the older format in `parseSave`, and add new
  `v<N>-*.json` fixtures next to the old ones.
