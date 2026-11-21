/* Released saves still load. Every file in tests/fixtures/saves is a save a
   released build wrote: a JSON object mapping each localStorage key to the
   exact string the game stored there. Released fixtures never change; a new
   save format adds new v<N>-*.json files (see docs/RELEASING.md). */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("../web/rules.js");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };

const DIR = path.join(__dirname, "fixtures", "saves");
const SAVE_KEY = "second-helping.v1";
/* Every fixture, by name, with the progress it must load as. */
const FIXTURES = {
  "v1-day1-start.json": {reached: 1, met: []},
  "v1-day4-after-the-doors.json": {reached: 4, met: [0, 15, 16, 8]},
  "v1-all-five-days.json": {reached: 5, met: [0, 15, 16, 8]},
};

/* The storage the game reads through (StrataKit.store), over a fixture. */
function fakeStore(values) {
  return {get: (k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null), set: (k, v) => { values[k] = String(v); }};
}

t("the fixture folder holds exactly the listed fixtures", () => {
  const files = fs.readdirSync(DIR).sort();
  assert.deepEqual(files, Object.keys(FIXTURES).sort(), "a fixture is missing, or a file in the folder is not listed in FIXTURES");
});

t("SAVE_VERSION is a positive integer and every format 1..SAVE_VERSION has a fixture", () => {
  assert(Number.isInteger(R.SAVE_VERSION) && R.SAVE_VERSION >= 1);
  for (const name of Object.keys(FIXTURES)) {
    const m = /^v(\d+)-[a-z0-9-]+\.json$/.exec(name);
    assert(m, `${name} is not named v<N>-<name>.json`);
    assert(+m[1] <= R.SAVE_VERSION, `${name} is newer than SAVE_VERSION ${R.SAVE_VERSION}`);
  }
  for (let v = 1; v <= R.SAVE_VERSION; v++) assert(Object.keys(FIXTURES).some((f) => f.startsWith(`v${v}-`)), `no fixture for save format ${v}`);
});

for (const [name, want] of Object.entries(FIXTURES)) {
  t(`${name} loads as Day ${want.reached} with ${want.met.length} doors met`, () => {
    const stored = JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
    assert.deepEqual(Object.keys(stored), [SAVE_KEY]);
    assert.equal(typeof stored[SAVE_KEY], "string");
    // the game's read path: loadSave() = Rules.parseSave(StrataKit.store.get(SAVE_KEY))
    const store = fakeStore(stored);
    const save = R.parseSave(store.get(SAVE_KEY));
    assert.deepEqual(save, want);
    // the title screen's "Continue" names a real day
    assert(R.DAYS[save.reached - 1], `day ${save.reached} exists`);
    // saving again (writeSave) stores the same string
    store.set(SAVE_KEY, JSON.stringify({reached: save.reached, met: save.met}));
    assert.equal(store.get(SAVE_KEY), stored[SAVE_KEY]);
  });
}

console.log(`${n} tests passed`);
