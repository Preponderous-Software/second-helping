"use strict";
/* Second Helping's rules: the instant-runoff count and the two days' game
   logic, with no DOM and no engine, so the same code runs in the page and
   under node (tests/rules.test.cjs). */
(function (root) {
  const PIES = ["apple", "pumpkin", "pecan", "cherry"];
  const NAMES = {apple: "Apple", pumpkin: "Pumpkin", pecan: "Pecan", cherry: "Cherry"};
  // A tie for last drops the pie earliest in this fixed draw of straws.
  const DRAW_ORDER = ["pecan", "cherry", "apple", "pumpkin"];

  const repeat = (n, b) => Array.from({length: n}, () => b.slice());

  /* Saturday's 24 neighbours. Two Cherry fans rank Pecan second, so a Cherry
     ballot must skip the Pecan that is already out. */
  const VILLAGE = [
    ...repeat(9, ["pumpkin", "pecan", "apple", "cherry"]),
    ...repeat(7, ["apple", "cherry", "pecan", "pumpkin"]),
    ...repeat(3, ["cherry", "apple", "pecan", "pumpkin"]),
    ...repeat(2, ["cherry", "pecan", "apple", "pumpkin"]),
    ...repeat(3, ["pecan", "pumpkin", "apple", "cherry"]),
  ];

  /* Sunday's 17 doors. Winning takes both Cherry fans plus one Apple fan who
     ranks Pumpkin second. */
  const DOORS = [
    {name: "Mabel", ballot: ["pumpkin", "apple", "pecan", "cherry"], says: "Pumpkin. It tastes like my mother's kitchen."},
    {name: "Otis", ballot: ["pumpkin", "apple", "pecan", "cherry"], says: "I've voted Pumpkin since before you were born."},
    {name: "Priya", ballot: ["pumpkin", "apple", "pecan", "cherry"], says: "Pumpkin with extra nutmeg. Nothing else."},
    {name: "Hank", ballot: ["pumpkin", "cherry", "apple", "pecan"], says: "Pumpkin first. I do like a sharp Cherry, though."},
    {name: "Noor", ballot: ["pumpkin", "cherry", "apple", "pecan"], says: "Pumpkin. Is that what you came to ask?"},
    {name: "Bea", ballot: ["pumpkin", "cherry", "apple", "pecan"], says: "Pumpkin, and a nap afterwards."},
    {name: "Tomas", ballot: ["apple", "pecan", "pumpkin", "cherry"], says: "Apple first, but your Pecan is already my second."},
    {name: "Ines", ballot: ["apple", "pecan", "pumpkin", "cherry"], says: "Apple. I had your Pecan last year and I remember it."},
    {name: "Walt", ballot: ["apple", "pumpkin", "pecan", "cherry"], says: "Apple, then Pumpkin. I've never thought past that."},
    {name: "June", ballot: ["apple", "pumpkin", "pecan", "cherry"], says: "Apple. Pumpkin if Apple's gone. Pecan's a bit sweet."},
    {name: "Arlo", ballot: ["apple", "pumpkin", "pecan", "cherry"], says: "Apple all the way. After that, whatever's orange."},
    {name: "Kiko", ballot: ["pecan", "pumpkin", "apple", "cherry"], says: "Pecan! You don't need to ask me."},
    {name: "Dell", ballot: ["pecan", "pumpkin", "apple", "cherry"], says: "I'm with you. Tell Dot the crust was perfect."},
    {name: "Rosa", ballot: ["pecan", "apple", "pumpkin", "cherry"], says: "Pecan, of course. Good luck out there."},
    {name: "Gus", ballot: ["pecan", "apple", "pumpkin", "cherry"], says: "Pecan. I'd vote for it twice if they'd let me."},
    {name: "Lena", ballot: ["cherry", "apple", "pumpkin", "pecan"], says: "Cherry, and I know it can't win. Who's next, then?"},
    {name: "Ada", ballot: ["cherry", "apple", "pecan", "pumpkin"], says: "Cherry. There are only two of us, so make your case."},
  ];
  const MAX_KNOCKS = 3;

  /* The fair's five days. */
  const DAYS = [
    {n: 1, name: "The Count"}, {n: 2, name: "The Spoiler"}, {n: 3, name: "The Doors"},
    {n: 4, name: "The Short Ballot"}, {n: 5, name: "The Paradox"},
  ];

  /* Day 2: 25 ballots where two fruit pies split the vote. */
  const SPOILER = [
    ...repeat(9, ["pumpkin", "pecan", "apple", "cherry"]),
    ...repeat(8, ["apple", "cherry", "pecan", "pumpkin"]),
    ...repeat(5, ["cherry", "apple", "pecan", "pumpkin"]),
    ...repeat(3, ["pecan", "pumpkin", "apple", "cherry"]),
  ];

  /* Day 4: five neighbours ranked one pie and stopped. `full` is what they
     say they would have ranked if they'd thought it mattered. */
  const SHORT_VOTERS = [
    {name: "Rosa", marked: ["pecan"], full: ["pecan", "apple", "pumpkin", "cherry"], says: "I marked Pecan and went for tea. I'd have put Apple next."},
    {name: "Gus", marked: ["pecan"], full: ["pecan", "apple", "pumpkin", "cherry"], says: "One mark felt like plenty. Apple would have been my second."},
    {name: "Lena", marked: ["cherry"], full: ["cherry", "apple", "pumpkin", "pecan"], says: "I thought a second choice might hurt my first. It wouldn't have. Apple."},
    {name: "Ada", marked: ["cherry"], full: ["cherry", "apple", "pecan", "pumpkin"], says: "I only cared about Cherry. If I'd known, I'd have said Apple."},
    {name: "Wyn", marked: ["cherry"], full: ["cherry", "apple", "pumpkin", "pecan"], says: "Nobody told me I could keep going. Apple, then."},
  ];
  const SHORT_REST = [
    ...repeat(8, ["pumpkin", "apple"]),
    ...repeat(6, ["apple", "pumpkin"]),
    ["pecan", "apple"],
    ["cherry", "pumpkin"],
  ];
  const SHORT_BALLOTS = [...SHORT_REST, ...SHORT_VOTERS.map((v) => v.marked)];
  const SHORT_FULL = [...SHORT_REST, ...SHORT_VOTERS.map((v) => v.full)];

  /* Day 5: the contest where gaining first choices can lose. */
  const PARADOX = [
    ...repeat(8, ["apple", "pecan", "cherry"]),
    ...repeat(7, ["cherry", "pecan", "apple"]),
    ...repeat(6, ["pecan", "apple", "cherry"]),
  ];
  const MAX_SWITCHES = 2;

  /* ballots: arrays of pies, best first (a ballot may stop early).
     -> rounds: {piles, exhausted, live, needed, active, winner, out, tied}. */
  function runCount(ballots) {
    const active = new Set(PIES.filter((p) => ballots.some((b) => b.includes(p))));
    const rounds = [];
    for (;;) {
      const piles = Object.fromEntries(PIES.map((p) => [p, []]));
      const exhausted = [];
      ballots.forEach((b, i) => {
        const top = b.find((p) => active.has(p));
        if (top) piles[top].push(i); else exhausted.push(i);
      });
      const live = ballots.length - exhausted.length;
      const needed = Math.floor(live / 2) + 1;
      const standing = [...active].sort((x, y) => piles[y].length - piles[x].length);
      const round = {piles, exhausted, live, needed, active: [...active], winner: null, out: null, tied: false};
      rounds.push(round);
      if (standing.length === 1 || piles[standing[0]].length >= needed) {
        round.winner = standing[0];
        return rounds;
      }
      const low = piles[standing[standing.length - 1]].length;
      const lowest = standing.filter((p) => piles[p].length === low);
      round.tied = lowest.length > 1;
      round.out = DRAW_ORDER.find((p) => lowest.includes(p));
      if (round.tied && standing.length === 2) {
        round.winner = standing.find((p) => p !== round.out);
        return rounds;
      }
      active.delete(round.out);
    }
  }

  /* Pecan moves up to second; first place never changes. */
  function knock(ballot) {
    if (ballot[0] === "pecan") return ballot.slice();
    return [ballot[0], "pecan", ...ballot.slice(1).filter((p) => p !== "pecan")];
  }

  /* Saturday, played by hand. The player finds the shortest tower, then moves
     its ballots one at a time. Every ballot is always in exactly one place:
     a tower, the player's hands, the queue on the pulled tower, or the crate. */
  function saturday(myBallot) { return handCount([...VILLAGE, myBallot], {you: VILLAGE.length}); }

  /* manualCrate: the player carries spent ballots to the crate themselves. */
  function handCount(ballots, {you = -1, manualCrate = false} = {}) {
    const towers = Object.fromEntries(PIES.map((p) => [p, []]));
    const crate = [];
    ballots.forEach((b, i) => towers[b[0]].push(i));
    const s = {
      ballots, you, towers, crate, active: PIES.slice(), round: 1,
      phase: "pull", pulled: null, queue: [], held: null, moved: 0, winner: null, drawn: null, path: you >= 0 ? [NAMES[ballots[you][0]]] : [],
    };
    const live = () => ballots.length - crate.length;
    s.needed = () => Math.floor(live() / 2) + 1;
    s.shortest = () => {
      const low = Math.min(...s.active.map((p) => towers[p].length));
      return s.active.filter((p) => towers[p].length === low);
    };
    s.nextPie = (i) => ballots[i].find((p) => s.active.includes(p)) || null;

    function settle() {
      s.round += 1;
      const top = s.active.reduce((a, b) => (towers[b].length > towers[a].length ? b : a));
      if (s.active.length === 1 || towers[top].length >= s.needed()) {
        s.winner = top; s.phase = "done";
        return;
      }
      const low = s.shortest();
      if (s.active.length === 2 && low.length === 2) {
        s.drawn = DRAW_ORDER.find((p) => low.includes(p));
        s.winner = s.active.find((p) => p !== s.drawn); s.phase = "done";
        return;
      }
      s.phase = "pull";
    }
    function park(i) {
      const next = s.nextPie(i);
      if (next) towers[next].push(i); else crate.push(i);
      if (i === you) s.path.push(next ? NAMES[next] : "the crate");
      s.moved += 1;
    }
    /* Ballots with nowhere to go leave the queue on their own. */
    function drain() {
      if (manualCrate) { if (!s.queue.length && s.held == null) settle(); return; }
      for (let k = s.queue.length - 1; k >= 0; k--) {
        if (!s.nextPie(s.queue[k])) { crate.push(s.queue[k]); if (s.queue[k] === you) s.path.push("the crate"); s.queue.splice(k, 1); }
      }
      if (!s.queue.length && s.held == null) settle();
    }

    s.pull = (pie) => {
      if (s.phase !== "pull") return {ok: false};
      if (!s.active.includes(pie)) return {ok: false, why: `${NAMES[pie]} is already out.`};
      const low = s.shortest();
      if (!low.includes(pie)) return {ok: false, why: `${NAMES[pie]} isn't the shortest tower.`};
      const out = low.length > 1 ? DRAW_ORDER.find((p) => low.includes(p)) : pie;
      s.pulled = out;
      s.active = s.active.filter((p) => p !== out);
      s.queue = towers[out].splice(0);
      s.phase = "move";
      drain();
      return {ok: true, out, tied: low.length > 1};
    };
    s.take = () => {
      if (s.phase !== "move" || s.held != null || !s.queue.length) return {ok: false};
      s.held = s.queue.shift();
      return {ok: true, ballot: s.held};
    };
    s.drop = (pie) => {
      if (s.held == null) return {ok: false};
      const want = s.nextPie(s.held);
      if (pie === "crate") {
        if (want) return {ok: false, why: `${NAMES[want]} is still in. Drop it there.`};
        crate.push(s.held);
        s.held = null; s.moved += 1;
        if (!s.queue.length) settle();
        return {ok: true};
      }
      if (want == null) return {ok: false, why: "No pies left. It goes in the crate."};
      if (pie !== want) {
        const b = ballots[s.held];
        const why = !s.active.includes(pie)
          ? `${NAMES[pie]} is out. Find the next pie still in.`
          : `Wrong pie. Read the slip from the top.`;
        return {ok: false, why, ballot: b};
      }
      const i = s.held;
      towers[pie].push(i);
      if (i === you) s.path.push(NAMES[pie]);
      s.held = null; s.moved += 1;
      if (!s.queue.length) settle();
      return {ok: true};
    };
    /* The clerk finishes the current pile. */
    s.finishPile = () => {
      if (s.phase !== "move") return {ok: false};
      const left = s.held != null ? [s.held, ...s.queue] : s.queue.slice();
      s.held = null; s.queue = [];
      left.forEach(park);
      settle();
      return {ok: true, moved: left};
    };
    return s;
  }

  /* Sunday: which doors were knocked, and what the count makes of them. */
  function sunday() {
    const s = {knocked: new Set(), met: new Set(), results: null, tries: 0};
    s.left = () => MAX_KNOCKS - s.knocked.size;
    s.canKnock = (i) => DOORS[i].ballot[0] !== "pecan" && !s.knocked.has(i) && s.left() > 0;
    s.toggle = (i) => {
      if (s.knocked.has(i)) { s.knocked.delete(i); return true; }
      if (!s.canKnock(i)) return false;
      s.knocked.add(i);
      return true;
    };
    s.ballotOf = (i) => (s.knocked.has(i) ? knock(DOORS[i].ballot) : DOORS[i].ballot);
    s.count = () => { s.tries += 1; s.results = runCount(DOORS.map((_, i) => s.ballotOf(i))); return s.results; };
    s.retry = () => { s.knocked.clear(); s.results = null; };
    return s;
  }

  /* Day 5: move up to two ballots to Apple first. Exactly two Cherry ballots
     make Apple lose. */
  function paradox() {
    const s = {picks: [], results: null};
    s.left = () => MAX_SWITCHES - s.picks.length;
    s.pick = (pie) => {
      if (s.left() < 1 || pie === "apple") return null;
      const i = PARADOX.findIndex((b, k) => b[0] === pie && !s.picks.includes(k));
      if (i < 0) return null;
      s.picks.push(i);
      return i;
    };
    s.ballots = () => PARADOX.map((b, i) => (s.picks.includes(i) ? ["apple", ...b.filter((p) => p !== "apple")] : b));
    s.count = () => { s.results = runCount(s.ballots()); return s.results; };
    s.reset = () => { s.picks = []; s.results = null; };
    return s;
  }

  /* Reads any save this game has written, or a damaged one, without throwing.
     Older saves held {satDone, met}: finishing the old Saturday meant the
     player had reached the Doors, which is now Day 3. */
  function parseSave(text) {
    let v = null;
    try { v = JSON.parse(text || "null"); } catch (e) { v = null; }
    const fresh = {reached: 1, met: []};
    if (!v || typeof v !== "object" || Array.isArray(v)) return fresh;
    const met = Array.isArray(v.met) ? [...new Set(v.met.filter((i) => Number.isInteger(i) && DOORS[i]))] : [];
    const reached = Number.isInteger(v.reached) && v.reached >= 1 && v.reached <= DAYS.length ? v.reached : (v.satDone === true ? 3 : 1);
    return {reached, met};
  }

  /* What Sunday's count tells the player, without giving the answer away. */
  function sundayHint(rounds) {
    const last = rounds[rounds.length - 1];
    if (last.winner === "pecan") return null;
    const at = rounds.findIndex((r) => r.out === "pecan");
    if (at >= 0) {
      const r = rounds[at];
      const gap = Math.min(...r.active.filter((p) => p !== "pecan").map((p) => r.piles[p].length)) - r.piles.pecan.length;
      return `Pecan went out in round ${at + 1}, ${gap} behind the next tower. Whose ballots move before Pecan's?`;
    }
    return `Pecan lost the final ${last.piles.pecan.length} to ${last.piles[last.winner].length}. Where did the last tower's ballots go?`;
  }

  const Rules = {PIES, NAMES, DRAW_ORDER, VILLAGE, DOORS, DAYS, MAX_KNOCKS, MAX_SWITCHES, SPOILER, SHORT_VOTERS, SHORT_BALLOTS, SHORT_FULL, PARADOX,
    runCount, knock, saturday, handCount, sunday, sundayHint, paradox, parseSave};
  if (typeof module !== "undefined" && module.exports) module.exports = Rules;
  else root.Rules = Rules;
})(typeof window !== "undefined" ? window : globalThis);
