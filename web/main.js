"use strict";
/* Second Helping in the browser: the engine, the walking, the HUD and the
   fair's five days. The rules live in rules.js and the fairground in scene.js. */
(function () {
  const R = window.Rules, S = window.Scene, W = window.HallWalk, K = window.HallControls;
  const {PIES, NAMES, DOORS} = R;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const canvas = $("fair");
  const touchFirst = matchMedia("(hover: none), (pointer: coarse)").matches;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SAVE_KEY = "second-helping.v1";
  const FOV = 62;
  const TEX_MIPS = 1, TEX_CLAMP = 2 | 4, UNLIT = 1, LATE = 0x10000;
  const SOFTWARE = /llvmpipe|softpipe|lavapipe|swiftshader|software|basic render/i;
  const REACH = 1.75;

  let mod = null, kit = null, economy = false;
  let me = Object.assign({}, S.SPAWN_SAT);
  const keys = new Set();
  let stickInput = {forward: 0, right: 0, run: false};
  let activeUse = null, clock = 0;

  /* ---------------------------------------------------------- the story */
  const G = {
    mode: "title",      // title | sat (hand counts) | sun (the doors) | lab (days 2, 5) | end
    step: "",
    day: 1, reached: 1, met: [], boardTitle: "The Harvest Fair",
    lab: null,          // {board, uses, bell}: what a lab day offers right now
    para: null, counting: false,
    sat: null, sun: null,
    myBallot: [], metBertie: false,
    pending: null,      // the count while it plays
    countRound: 0, winner: null,
    door: null,         // the door being talked to
  };

  const loadSave = () => R.parseSave(StrataKit.store.get(SAVE_KEY));
  function writeSave() {
    if (G.sun) G.met = [...G.sun.met];
    StrataKit.store.set(SAVE_KEY, JSON.stringify({reached: G.reached, met: G.met}));
  }
  const dayLabel = () => `Day ${G.day} · ${R.DAYS[G.day - 1].name}`;
  const goal = (text) => setGoal(dayLabel(), text);
  /* Every day starts the same way. */
  function enter(day, spawn, boardTitle) {
    Object.assign(G, {day, reached: Math.max(G.reached, day), winner: null, pending: null, countRound: 0, door: null,
      sat: null, sun: null, lab: null, para: null, counting: false, boardTitle});
    me = Object.assign({}, spawn, {vx: 0, vz: 0});
    placeView();
    slips = []; youIndex = -1; sundayOrder = {}; barNeed = 0;
    $("title").hidden = true; $("hud").hidden = false; $("held").hidden = true; $("assist").hidden = true;
    $("knocks").hidden = true; $("ledger").hidden = true; $("skip").hidden = false;
    writeSave();
    canvas.focus({preventScroll: true});
  }
  function nextDayButton() {
    return {label: `On to Day ${G.day + 1}`, primary: true, run: () => { const n = G.day + 1; closePanel(); fadeTo(() => startDay(n)); }};
  }
  /* Skipping never touches the ledger, and a count that has started finishes first. */
  function skipPanel() {
    if (fading || G.mode === "title" || G.mode === "end") return;
    if (!$("panel").hidden) { toast("Close this panel first."); return; }
    if (G.counting || G.step === "done") { toast("Wait for the count to finish."); return; }
    const last = G.day === R.DAYS.length, next = R.DAYS[G.day];
    panel(`Skip Day ${G.day}?`, last
      ? "<p>Last day. Goes to the fair summary.</p>"
      : `<p>Goes to Day ${G.day + 1}, ${next.name}. Replay any day from the title screen.</p>`, [
      {label: last ? "Skip to the end" : `Skip to Day ${G.day + 1}`, primary: true, run: () => {
        writeSave(); closePanel();
        if (last) finish(); else { const n = G.day + 1; fadeTo(() => startDay(n)); }
      }},
      {label: "Keep playing", run: closePanel},
    ], closePanel);
  }
  function startDay(n) { [startSaturday, startSpoiler, () => startSunday(), startShort, startParadox][n - 1](); }

  /* ----------------------------------------------------------- the heap */
  function put(typed) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const ptr = mod._malloc(Math.max(bytes.length, 4));
    new Uint8Array(mod.HEAPF32.buffer).set(bytes, ptr);
    return ptr;
  }
  function texture(slot, w, h, rgba, flags) {
    const ptr = put(rgba);
    try { return mod._hall_texture(slot, w, h, ptr, flags); } finally { mod._free(ptr); }
  }
  function mesh(slot, mb, tex = -1, flags = 0) {
    const p = put(new Float32Array(mb.positions)), n = put(new Float32Array(mb.normals));
    const c = put(new Float32Array(mb.colors)), u = mb.uvs.length ? put(new Float32Array(mb.uvs)) : 0;
    const i = put(new Uint32Array(mb.indices));
    try {
      return mod._hall_mesh(slot, p, n, c, u, mb.nv, i, mb.indices.length, tex, flags);
    } finally { [p, n, c, u, i].forEach((x) => x && mod._free(x)); }
  }
  /* Rows change every frame, so one block of wasm memory is kept for them. */
  const rowBlocks = new Map();
  function rows(fn, flat, width) {
    let block = rowBlocks.get(fn);
    if (!block || block.cap < flat.length) {
      if (block) mod._free(block.ptr);
      block = {cap: flat.length * 2 + 64, ptr: mod._malloc((flat.length * 2 + 64) * 4)};
      rowBlocks.set(fn, block);
    }
    new Float32Array(mod.HEAPF32.buffer, block.ptr, flat.length).set(flat);
    fn(block.ptr, flat.length / width);
  }

  /* ------------------------------------------------------- the textures */
  function canvasOf(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", {willReadFrequently: true});
    draw(ctx, w, h);
    return {rgba: new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer), w, h};
  }
  function grass() {
    return canvasOf(256, 256, (x, w, h) => {
      x.fillStyle = "#6f8f45"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        x.fillStyle = v < 0.45 ? "rgba(92,124,56,.5)" : v < 0.8 ? "rgba(132,158,76,.45)" : "rgba(176,160,80,.32)";
        x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 1 + Math.random() * 5);
      }
    });
  }
  const FONT = '"Atkinson Hyperlegible",system-ui,sans-serif';
  const SHOUT = 'Shrikhand,Georgia,serif';
  function atlas() {
    const A = S.ATLAS, cw = A.w / A.cols, ch = A.h / A.rows;
    const css = {apple: "#3C8A37", pumpkin: "#C2650A", pecan: "#7B4B2A", cherry: "#B01A5B"};
    return canvasOf(A.w, A.h, (x) => {
      x.fillStyle = "#fbf8ec"; x.fillRect(0, 0, A.w, A.h);
      x.textAlign = "center"; x.textBaseline = "middle";
      const at = (key) => { const i = S.CELLS[key]; return [(i % A.cols) * cw, Math.floor(i / A.cols) * ch]; };
      const plate = (key, text, bg, fg, font, span = 1) => {
        const [l, t] = at(key);
        x.fillStyle = bg; x.fillRect(l, t, cw * span, ch);
        x.fillStyle = fg; x.font = font;
        x.fillText(text, l + cw * span / 2, t + ch / 2 + 4);
      };
      for (const p of PIES) {
        plate(p, NAMES[p], css[p], "#fff", `52px ${SHOUT}`);
      }
      plate("crate", "No picks left", "#493120", "#FFD95A", `700 34px ${FONT}`);
      plate("booth", "Vote here", "#1F3FB8", "#FFD95A", `46px ${SHOUT}`);
      plate("clerk", "The Count", "#fbf8ec", "#1B2433", `40px ${SHOUT}`);
      plate("gate", "Harvest Fair", "#1F3FB8", "#FFD95A", `92px ${SHOUT}`, 4);
      DOORS.forEach((d, i) => plate("door" + i, d.name, "#fbf8ec", "#1B2433", `700 58px ${FONT}`));
    });
  }
  function drawBoard() {
    if (!mod) return;
    let title = G.boardTitle, sub = "", tally = null, out = [], needed = 0;
    if (G.mode === "sat" && G.sat) {
      const s = G.sat;
      needed = s.needed();
      sub = s.phase === "done" ? `${NAMES[s.winner]} wins` : `Round ${s.round}`;
      tally = Object.fromEntries(PIES.map((p) => [p, s.towers[p].length]));
      out = PIES.filter((p) => !s.active.includes(p));
    } else if (G.pending) {
      const r = G.pending[Math.min(G.countRound, G.pending.length - 1)];
      needed = r.needed; sub = `Round ${G.countRound + 1}`;
      tally = Object.fromEntries(PIES.map((p) => [p, r.piles[p].length]));
      out = PIES.filter((p) => !r.active.includes(p));
    } else if (G.lab && G.lab.board) {
      ({sub, tally, out, needed} = G.lab.board);
    } else if (G.mode === "sun") {
      const r = R.runCount(DOORS.map((d) => d.ballot))[0];
      needed = r.needed; sub = "First choices";
      tally = Object.fromEntries(PIES.map((p) => [p, r.piles[p].length]));
    }
    if (needed) barNeed = needed;
    const img = canvasOf(1024, 452, (x, w, h) => {
      x.fillStyle = "#172F8C"; x.fillRect(0, 0, w, h);
      x.fillStyle = "#FFD95A"; x.font = `62px ${SHOUT}`; x.textBaseline = "top"; x.textAlign = "left";
      x.fillText(title, 40, 24);
      if (!tally) return;
      x.fillStyle = "#FFF6CF"; x.font = `700 36px ${FONT}`; x.textAlign = "right";
      x.fillText(needed ? `${sub} · ${needed} to win` : sub, w - 40, 44);
      x.textAlign = "left";
      PIES.forEach((p, i) => {
        const y = 124 + i * 80, gone = out.includes(p);
        x.fillStyle = gone ? "#8d97bf" : "#fff"; x.font = `700 44px ${FONT}`;
        x.fillText(NAMES[p], 40, y + 6);
        const scale = needed || 13, full = 620, bw = full * Math.min(tally[p], scale + 3) / (scale + 3);
        x.fillStyle = gone ? "#44518a" : {apple: "#6CC562", pumpkin: "#F59A38", pecan: "#C08C60", cherry: "#EE619C"}[p];
        x.fillRect(280, y + 4, bw, 50);
        x.fillStyle = gone ? "#8d97bf" : "#fff"; x.textAlign = "right";
        x.fillText(gone ? "out" : String(tally[p]), w - 40, y + 6);
        x.textAlign = "left";
      });
      if (!needed) return;
      const lx = 280 + 620 * needed / (needed + 3);
      x.strokeStyle = "#FFD95A"; x.lineWidth = 5; x.setLineDash([12, 8]);
      x.beginPath(); x.moveTo(lx, 112); x.lineTo(lx, h - 14); x.stroke();
    });
    texture(2, img.w, img.h, img.rgba, TEX_CLAMP);
  }

  /* -------------------------------------------------------- the ballots */
  let slips = [], stepH = S.BAR_RISE / 13, youIndex = -1, barNeed = 0, barY = S.PLINTH.top + S.BAR_RISE;
  const SLIP_TIME = 0.5;
  function jitter(i, k) { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return (v - Math.floor(v) - 0.5); }
  function makeSlips(firsts, you, needed) {
    stepH = S.BAR_RISE / needed;
    youIndex = you;
    slips = firsts.map((pie, i) => ({i, pie, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, t: 1, held: false, hide: false}));
  }
  function send(s, x, y, z, instant) {
    if (Math.abs(s.tx - x) + Math.abs(s.ty - y) + Math.abs(s.tz - z) < 1e-4) return;
    if (instant || reducedMotion) { s.x = s.tx = x; s.y = s.ty = y; s.z = s.tz = z; s.t = 1; return; }
    s.fx = s.x; s.fy = s.y; s.fz = s.z; s.tx = x; s.ty = y; s.tz = z; s.t = 0;
  }
  function towerSpot(pie, n) {
    const q = S.plinths[pie];
    return [q.x + jitter(n, 1) * 0.05, S.PLINTH.top + (n + 0.5) * stepH, q.z + jitter(n, 2) * 0.04];
  }
  function layTowers(towers, crate, instant) {
    for (const p of PIES) (towers[p] || []).forEach((id, n) => {
      const s = slips[id]; if (!s) return;
      s.held = false; send(s, ...towerSpot(p, n), instant);
    });
    (crate || []).forEach((id, n) => {
      const s = slips[id]; if (!s) return;
      s.held = false; send(s, S.crate.x + jitter(n, 3) * 0.3, 0.6 + n * 0.03, S.crate.z + jitter(n, 4) * 0.3, instant);
    });
  }
  function syncSaturday(instant) {
    const s = G.sat;
    const towers = Object.fromEntries(PIES.map((p) => [p, s.towers[p].slice()]));
    if (s.pulled && s.queue.length) towers[s.pulled] = s.queue.slice();
    layTowers(towers, s.crate, instant);
    slips.forEach((b) => { b.held = b.i === s.held; });
    drawBoard();
  }
  let sundayOrder = {};
  function layRound(round, instant) {
    const next = {};
    for (const p of PIES) {
      const m = round.piles[p], kept = (sundayOrder[p] || []).filter((i) => m.includes(i));
      next[p] = [...kept, ...m.filter((i) => !kept.includes(i))];
    }
    sundayOrder = next;
    layTowers(next, round.exhausted, instant);
  }

  /* ---------------------------------------------------------------- HUD */
  const chip = (p) => `<span class="chip ${p}"></span>`;
  function rankList(ballot, active) {
    return `<ol class="rank">${ballot.map((p, i) =>
      `<li class="${active && !active.includes(p) ? "out" : ""}"><b>${i + 1}</b>${chip(p)}${NAMES[p]}</li>`).join("")}</ol>`;
  }
  function setGoal(day, text) { $("day").textContent = day; $("objective").textContent = text; }
  let toastTimer = 0;
  function toast(text, ms = 3800) {
    $("toast").textContent = text; $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, ms);
  }
  let panelDismiss = null;
  function panel(title, html, buttons, dismiss) {
    $("panel-title").textContent = title;
    $("panel-body").innerHTML = html;
    const box = $("panel-buttons");
    box.innerHTML = "";
    buttons.forEach((b) => {
      const el = document.createElement("button");
      el.type = "button"; el.className = "btn" + (b.primary ? " primary" : ""); el.textContent = b.label;
      if (b.disabled) el.disabled = true;
      el.addEventListener("click", b.run);
      box.appendChild(el);
    });
    panelDismiss = dismiss || null;
    $("panel").hidden = false;
    const focus = box.querySelector(".primary:not([disabled])") || box.querySelector("button:not([disabled])");
    if (focus) focus.focus({preventScroll: true});
    keys.clear();
  }
  function closePanel() {
    $("panel").hidden = true; panelDismiss = null;
    canvas.focus({preventScroll: true});
  }
  const busy = () => !$("panel").hidden || G.mode === "title";
  let fading = false;
  function fadeTo(fn) {
    const f = $("fade");
    f.hidden = false; fading = true;
    requestAnimationFrame(() => f.classList.add("on"));
    setTimeout(() => {
      fn(); fading = false;
      f.classList.remove("on");
      setTimeout(() => { f.hidden = true; }, reducedMotion ? 0 : 520);
    }, reducedMotion ? 0 : 520);
  }
  function refreshHeld() {
    const s = G.sat;
    const on = G.mode === "sat" && s && s.held != null;
    $("held").hidden = !on;
    if (on) {
      const mine = s.held === s.you;
      const ended = s.nextPie(s.held) == null;
      $("held").innerHTML = `<h3>${mine ? "Your ballot" : "A neighbour's ballot"}</h3>${rankList(s.ballots[s.held], s.active)}${ended ? '<p class="spent">No pies left on this slip</p>' : ""}`;
    }
    $("assist").hidden = !(G.mode === "sat" && s && s.phase === "move" && s.moved >= 2);
  }
  function roundsTable(rs) {
    const pies = PIES.filter((p) => rs[0].active.includes(p));
    const head = rs.map((_, i) => `<th scope="col">R${i + 1}</th>`).join("");
    const body = pies.map((p) => `<tr><th scope="row">${NAMES[p]}</th>${rs.map((r) => {
      if (!r.active.includes(p)) return '<td class="gone">·</td>';
      return `<td class="${r.winner === p ? "won" : r.out === p ? "exit" : ""}">${r.piles[p].length}</td>`;
    }).join("")}</tr>`).join("");
    return `<table class="rounds"><thead><tr><th scope="col">Pie</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  /* ----------------------------------------------------------- Saturday */
  function startSaturday() {
    enter(1, S.SPAWN_SAT, "Blue Ribbon Vote");
    Object.assign(G, {mode: "sat", step: "booth", myBallot: [], metBertie: false});
    drawBoard();
    goal("Go to the blue booth and rank the pies.");
  }
  function votePanel() {
    const picks = PIES.map((p) => {
      const r = G.myBallot.indexOf(p);
      return `<button class="pick" type="button" data-pie="${p}" aria-pressed="${r >= 0}"><span class="chip ${p}"></span><span>${NAMES[p]}</span><span>${r >= 0 ? r + 1 : ""}</span></button>`;
    }).join("");
    panel("Rank the pies", `<p>Tap pies in order, favourite first. Rank as many as you like.</p><div class="picks" id="picks">${picks}</div>`, [
      {label: "Cast my ballot", primary: true, disabled: !G.myBallot.length, run: castBallot},
      {label: "Not yet", run: closePanel},
    ], closePanel);
    $("picks").addEventListener("click", (e) => {
      const b = e.target.closest(".pick"); if (!b) return;
      const p = b.dataset.pie, r = G.myBallot.indexOf(p);
      if (r >= 0) G.myBallot.splice(r, 1); else G.myBallot.push(p);
      votePanel();
    });
  }
  function castBallot() {
    closePanel();
    const s = G.sat = R.saturday(G.myBallot.slice());
    makeSlips(s.ballots.map((b) => b[0]), s.you, 13);
    syncSaturday(true);
    G.step = "walk";
    goal("Ballot cast. Go to the striped tent.");
  }
  function meetBertie() {
    G.metBertie = true; G.step = "count";
    bertiePanel();
    goal("Pull the shortest tower.");
  }
  function bertiePanel() {
    if (G.day === 4) { panel("Bertie, the clerk", "<p>Pull the shortest tower. Move each ballot to its next pie still in. No pies left? It goes in the crate.</p>", [{label: "Start", primary: true, run: closePanel}], closePanel); return; }
    panel("Bertie, the clerk", `<p>Ballots are stacked on first choices. 13 wins.</p>
      <p>No tower has 13, so the shortest goes out. Move its ballots to each voter's next pie still in. Repeat until a tower reaches the bar.</p>`,
      [{label: "Start", primary: true, run: closePanel}], closePanel);
  }
  function afterMove() {
    const s = G.sat;
    syncSaturday(false); refreshHeld();
    if (s.phase === "done") {
      goal(`${NAMES[s.winner]} wins the ribbon.`);
      G.step = "done"; G.winner = s.winner;
      celebrate(s.winner);
      setTimeout(G.day === 4 ? shortDone : saturdayDone, reducedMotion ? 300 : 1500);
    } else if (s.phase === "pull") {
      goal(`Round ${s.round}: pull the shortest tower.`);
      toast(G.day === 4 && barDropped() ? `Bar drops to ${s.needed()}: spent ballots no longer count.` : `Round ${s.round}.`);
    } else {
      const left = s.queue.length + (s.held != null ? 1 : 0);
      goal(s.held != null
        ? (s.nextPie(s.held) ? "Drop it on the top pie still in." : "No pies left. Take it to the crate.")
        : `Take a ballot from ${NAMES[s.pulled]} (${left} left).`);
    }
  }
  let lastNeeded = 0;
  function barDropped() { const n = G.sat.needed(), d = n < lastNeeded; lastNeeded = n; return d; }
  function useTower(pie) {
    const s = G.sat;
    if (s.phase === "pull") {
      const r = s.pull(pie);
      if (!r.ok) { if (r.why) toast(r.why); return; }
      toast(`${NAMES[r.out]} is out${r.tied ? " (tie, drew straws)" : ""}. Move its ballots.`);
    } else if (s.held != null) {
      const r = s.drop(pie);
      if (!r.ok) { toast(r.why, 4600); return; }
      if (pie === "crate") toast("Out of the count.", 2200);
    } else if (pie === s.pulled) {
      if (!s.take().ok) return;
    }
    afterMove();
  }
  function finishPile() {
    if (!G.sat || G.sat.phase !== "move") return;
    G.sat.finishPile();
    toast("Bertie moves the rest.");
    afterMove();
  }
  function saturdayDone() {
    const s = G.sat, w = s.winner;
    const margin = s.towers[w].length - Math.max(...s.active.filter((p) => p !== w).map((p) => s.towers[p].length), 0);
    let body = `<p>${NAMES[w]} wins with ${s.towers[w].length} of ${s.ballots.length - s.crate.length} ballots in play.</p>`;
    if (s.drawn) body = `<p>${NAMES[w]} and ${NAMES[s.drawn]} tied at ${s.towers[w].length}. ${NAMES[w]} won on straws.</p>`;
    body += `<p>Your ballot: ${s.path.join(" → ")}.`;
    if (s.crate.includes(s.you)) body += " All your pies went out, so it missed the final.";
    else if (margin === 1 && s.towers[w].includes(s.you)) body += " The rest tied 12–12. Your ballot decided it.";
    body += "</p>";
    panel("The blue ribbon", body, [nextDayButton()]);
  }

  /* ------------------------------------------------------------- Sunday */
  function resetSundayTowers(instant) {
    const r = R.runCount(DOORS.map((d) => d.ballot))[0];
    sundayOrder = {};
    G.pending = null; G.countRound = 0;
    layRound(r, instant);
    drawBoard();
  }
  function startSunday() {
    const met = G.met.slice();
    enter(3, S.SPAWN_SUN, "Supper Pie Vote");
    Object.assign(G, {mode: "sun", step: "doors"});
    G.sun = R.sunday();
    met.forEach((i) => G.sun.met.add(i));
    makeSlips(DOORS.map((d) => d.ballot[0]), -1, R.runCount(DOORS.map((d) => d.ballot))[0].needed);
    resetSundayTowers(true);
    $("knocks").hidden = false; $("ledger").hidden = false;
    goalSunday();
    dotPanel();
  }
  function goalSunday() {
    const left = G.sun.left();
    goal(left ? "Knock on doors. Yard flags show each favourite." : "Ring the bell in the tent.");
    $("knocks").textContent = `Knocks left: ${left} of ${R.MAX_KNOCKS}`;
  }
  function dotPanel() {
    panel("Aunt Dot", `<p>Help my Pecan win the Supper Pie vote. It needs 9 of 17.</p>
      <p>You have three knocks. Each one asks a neighbour to rank Pecan second. Pick doors where that second place will count. The tent board shows first choices.</p>
      <p>Ring the bell in the tent when you're done.</p>`,
      [{label: "Start", primary: true, run: closePanel}], closePanel);
  }
  function doorPanel(i) {
    const d = DOORS[i], s = G.sun, fan = d.ballot[0] === "pecan", done = s.knocked.has(i);
    G.door = i;
    s.met.add(i); writeSave();
    const close = () => { G.door = null; closePanel(); };
    const buttons = [];
    if (!fan && !done) buttons.push({label: `Ask for second place (${s.left()} left)`, primary: true, disabled: s.left() < 1, run: () => { s.toggle(i); goalSunday(); doorPanel(i); }});
    if (done) buttons.push({label: "Take back this knock", run: () => { s.toggle(i); goalSunday(); doorPanel(i); }});
    buttons.push({label: "Leave", primary: fan || done, run: close});
    const note = fan ? "<p>Pecan is already first here.</p>"
      : done ? `<p>${d.name} agrees to put Pecan second.</p>`
      : s.left() < 1 ? "<p>No knocks left. Take one back from another door.</p>" : "";
    panel(d.name, `<p class="quote">"${d.says}"</p>${rankList(s.ballotOf(i))}${note}`, buttons, close);
  }
  function ledgerPanel() {
    const s = G.sun, list = [...s.met].sort((a, b) => DOORS[a].name.localeCompare(DOORS[b].name));
    const body = list.length
      ? `<ul class="ledger">${list.map((i) => `<li>${DOORS[i].name}<span class="dots">${s.ballotOf(i).map(chip).join("")}</span>${s.knocked.has(i) ? "<em>Knocked</em>" : ""}</li>`).join("")}</ul>`
      : "<p>Neighbours you visit appear here.</p>";
    panel("Your ledger", `${body}<p>Best to worst.</p>`, [{label: "Close", primary: true, run: closePanel}], closePanel);
  }
  function ringBell() {
    const rs = G.sun.count();
    G.step = "counting";
    runRounds(rs, sundayResult);
  }
  /* The towers count themselves, round by round, then done(rs). */
  function runRounds(rs, done) {
    G.pending = rs; G.countRound = 0; G.counting = true;
    goal("Counting. Watch the towers.");
    playRound(rs, done);
  }
  function playRound(rs, done) {
    const r = rs[G.countRound];
    layRound(r, false); drawBoard();
    if (r.tied && r.winner) toast("Tie. Drawing straws.", 2200);
    else if (r.out && !r.winner) toast(`${NAMES[r.out]} is out.`, 2200);
    else toast(`${NAMES[r.winner]} reaches the bar.`, 2200);
    setTimeout(() => {
      if (G.countRound < rs.length - 1) { G.countRound += 1; playRound(rs, done); }
      else { G.counting = false; done(rs); }
    }, reducedMotion ? 900 : 2300);
  }
  function sundayResult(rs) {
    G.step = "result";
    goal("The count is in.");
    const win = rs[rs.length - 1].winner === "pecan";
    if (win) {
      G.winner = "pecan"; celebrate("pecan");
      const last = rs[rs.length - 1];
      panel("Pecan wins", `<p>Pecan took the Supper Pie with ${last.piles.pecan.length} of 17, and only ${rs[0].piles.pecan.length} of those were first choices.</p>${roundsTable(rs)}`,
        [nextDayButton()]);
      return;
    }
    panel(`${NAMES[rs[rs.length - 1].winner]} wins`, `<p>${R.sundayHint(rs)}</p>${roundsTable(rs)}`,
      [{label: "Try different doors", primary: true, run: () => { closePanel(); G.sun.retry(); G.step = "doors"; G.winner = null; resetSundayTowers(false); goalSunday(); }}]);
  }
  /* ------------------------------------------------- Day 2: The Spoiler */
  function pilesOf(ballots, out) {
    const piles = Object.fromEntries(PIES.map((p) => [p, []]));
    ballots.forEach((b, i) => { const p = b.find((q) => !out.includes(q)); if (p) piles[p].push(i); });
    return {piles, exhausted: []};
  }
  function labBoard(sub, round, out = [], needed = 0) {
    G.lab.board = {sub, needed, out, tally: Object.fromEntries(PIES.map((p) => [p, round.piles[p].length]))};
    drawBoard();
  }
  const topPie = (round) => PIES.reduce((a, b) => (round.piles[b].length > round.piles[a].length ? b : a));
  function ribbonUses(round, next) {
    return PIES.filter((p) => round.piles[p].length).map((p) => ({pie: p, label: `Hang the ribbon on ${NAMES[p]}`, run: () => {
      if (p !== topPie(round)) { toast(`${NAMES[p]} isn't the tallest tower.`); return; }
      G.winner = p; celebrate(p); next(p);
    }}));
  }
  function startSpoiler() {
    enter(2, S.SPAWN_TENT, "One Mark Rule");
    Object.assign(G, {mode: "lab", step: "lab", lab: {uses: [], bell: false, board: null}});
    makeSlips(R.SPOILER.map((b) => b[0]), -1, 13);
    const first = pilesOf(R.SPOILER, []);
    layRound(first, true);
    labBoard("Most marks wins", first);
    G.lab.uses = ribbonUses(first, spoilerAfterOld);
    goal("Hang the ribbon on the tallest tower.");
    panel("Bertie, the clerk", `<p>The old rule: count first marks, tallest tower wins. Here are 25 ballots from an old contest.</p>
      <p>Hang the ribbon on the tallest tower.</p>`, [{label: "Start", primary: true, run: closePanel}], closePanel);
  }
  function spoilerAfterOld(w) {
    const count = pilesOf(R.SPOILER, []).piles[w].length;
    G.lab.uses = [{pie: "cherry", label: "Take Cherry off the ballot", run: spoilerNoCherry}];
    goal("Take Cherry off the ballot.");
    panel("Fair result?", `<p>${NAMES[w]} wins with ${count} of 25. Apple and Cherry split 13 votes between them.</p>
      <p>Cherry fans like Apple next. Take Cherry out and see.</p>`, [{label: "OK", primary: true, run: closePanel}], closePanel);
  }
  function spoilerNoCherry() {
    G.winner = null;
    const noCherry = pilesOf(R.SPOILER, ["cherry"]);
    layRound(noCherry, false);
    labBoard("Most marks, no Cherry", noCherry, ["cherry"]);
    G.lab.uses = ribbonUses(noCherry, spoilerAfterNoCherry);
    goal("Hang the ribbon on the new tallest tower.");
  }
  function spoilerAfterNoCherry() {
    G.lab.uses = [];
    goal("Put Cherry back.");
    panel("That's a spoiler", `<p>Cherry couldn't win, but it picked the winner: in, Pumpkin wins; out, Apple wins.</p>
      <p>Now use the rankings with all four pies in. Call the winner at a tower, then ring the bell.</p>`,
      [{label: "Put Cherry back", primary: true, run: () => { closePanel(); spoilerPredict(); }}]);
  }
  function spoilerPredict() {
    G.winner = null;
    const first = pilesOf(R.SPOILER, []);
    layRound(first, false);
    labBoard("Ranked: make your call", first, [], 13);
    G.lab.uses = PIES.map((p) => ({pie: p, label: `Call it for ${NAMES[p]}`, run: () => {
      G.lab.call = p; G.lab.uses = []; G.lab.bell = true;
      toast(`Called: ${NAMES[p]}.`, 2200);
      goal("Ring the bell.");
    }}));
    goal("Who wins? Call it at a tower.");
  }
  function spoilerCount() {
    G.lab.bell = false;
    runRounds(R.runCount(R.SPOILER), (rs) => {
      const last = rs[rs.length - 1], w = last.winner;
      G.winner = w; celebrate(w); goal(`${NAMES[w]} wins the ranked count.`);
      const called = G.lab.call === w ? "You called it." : `You called ${NAMES[G.lab.call]}. Towers don't show second choices.`;
      panel(`${NAMES[w]} wins, ${last.piles[w].length} to ${last.piles.pumpkin.length}`, `<p>${called} Cherry stayed in, and its fans still chose between the leaders.</p>${roundsTable(rs)}
        <p><strong>Same ballots:</strong> one mark, Pumpkin. No Cherry, Apple. Ranked with Cherry in, Apple.</p>`, [nextDayButton()]);
    });
  }

  /* --------------------------------------------- Day 4: The Short Ballot */
  function startShort() {
    enter(4, S.SPAWN_TENT, "Thank-You Vote");
    Object.assign(G, {mode: "sat", step: "count"});
    const s = G.sat = R.handCount(R.SHORT_BALLOTS, {manualCrate: true});
    lastNeeded = s.needed();
    makeSlips(s.ballots.map((b) => b[0]), -1, s.needed());
    syncSaturday(true);
    goal("Pull the shortest tower.");
    panel("Bertie, the clerk", `<p>Many neighbours ranked only one pie, so some ballots will run out.</p>
      <p>A ballot with no pies left goes in the crate. The bar is more than half of the ballots <em>still in play</em>, so it can drop.</p>`,
      [{label: "Start", primary: true, run: closePanel}], closePanel);
  }
  function shortDone() {
    const s = G.sat, w = s.winner, n = s.towers[w].length;
    G.step = "crate";
    goal("Read the crate.");
    panel(`${NAMES[w]} wins with ${n}`, `<p>${n} of ${s.ballots.length - s.crate.length} in play, but only ${n} of ${s.ballots.length} cast. ${s.crate.length} ballots are in the crate.</p>`, [{label: "OK", primary: true, run: closePanel}], closePanel);
  }
  function readCrate() {
    const quotes = R.SHORT_VOTERS.map((v) => `<li><strong>${v.name}:</strong> <span class="quote">"${v.says}"</span></li>`).join("");
    panel("In the crate", `<ul class="clean-list">${quotes}</ul>`, [
      {label: "Count again with their rankings", primary: true, run: () => { closePanel(); shortRerun(); }},
    ], closePanel);
  }
  function shortRerun() {
    G.step = "bell"; G.winner = null;
    const full = R.runCount(R.SHORT_FULL), r = full[0];
    G.sat = null; G.mode = "lab"; G.lab = {uses: [], bell: true, board: null};
    slips.forEach((b) => { b.held = false; });
    sundayOrder = {};
    layRound(r, false);
    labBoard("With full rankings", r, [], r.needed);
    goal("Ring the bell to recount.");
  }
  function shortCount() {
    G.lab.bell = false;
    runRounds(R.runCount(R.SHORT_FULL), (rs) => {
      const last = rs[rs.length - 1], w = last.winner;
      G.winner = w; celebrate(w); goal(`${NAMES[w]} wins the recount.`);
      panel(`Now ${NAMES[w]} wins`, `<p>Same favourites. Five voters added a next choice, and ${NAMES[w]} beat Pumpkin ${last.piles[w].length} to ${last.piles.pumpkin.length}.</p>${roundsTable(rs)}
        <p>A second choice can't hurt your first: your ballot moves only after your favourite is out. Stop early and it may miss the final.</p>`, [nextDayButton()]);
    });
  }

  /* ------------------------------------------------- Day 5: The Paradox */
  function startParadox() {
    enter(5, S.SPAWN_TENT, "Closing Vote");
    Object.assign(G, {mode: "lab", step: "lab", lab: {uses: [], bell: true, board: null, base: true}, para: R.paradox()});
    makeSlips(R.PARADOX.map((b) => b[0]), -1, 11);
    const r = R.runCount(R.PARADOX)[0];
    layRound(r, true);
    labBoard("First choices", r, ["pumpkin"], r.needed);
    goal("Ring the bell.");
    panel("Bertie, the clerk", `<p>Last vote: Apple, Cherry and Pecan. Ring the bell.</p>`,
      [{label: "Start", primary: true, run: closePanel}], closePanel);
  }
  function paradoxSetup() {
    const p = G.para;
    p.reset();
    G.winner = null;
    const r = R.runCount(p.ballots())[0];
    sundayOrder = {}; G.pending = null; G.countRound = 0;
    layRound(r, false);
    labBoard("First choices", r, ["pumpkin"], r.needed);
    paradoxUses();
  }
  function paradoxUses() {
    const p = G.para, left = p.left();
    G.lab.bell = left === 0;
    G.lab.uses = left ? ["cherry", "pecan"].map((pie) => ({pie, label: `Move a ${NAMES[pie]} ballot to Apple (${left} left)`, run: () => {
      p.pick(pie);
      const r = R.runCount(p.ballots())[0];
      layRound(r, false);
      labBoard("First choices", r, ["pumpkin"], r.needed);
      paradoxUses();
    }})) : [];
    goal(left ? `Move ${left} more ballot${left > 1 ? "s" : ""} to Apple first. Make Apple lose.` : "Ring the bell.");
  }
  function paradoxCount() {
    G.lab.bell = false;
    const base = G.lab.base;
    runRounds(base ? R.runCount(R.PARADOX) : G.para.count(), (rs) => {
      const w = rs[rs.length - 1].winner, table = roundsTable(rs);
      if (base) {
        G.lab.base = false;
        goal("Read Bertie's offer.");
        panel("A strange offer", `<p>Apple won. Free slices convince two voters to rank Apple first.</p>${table}
          <p><strong>Your job:</strong> move two Cherry or Pecan ballots to Apple and make Apple <em>lose</em>.</p>`,
          [{label: "Try it", primary: true, run: () => { closePanel(); paradoxSetup(); }}]);
        return;
      }
      if (w === "apple") {
        goal("Apple won. Try a different pair.");
        panel("Apple still wins", `<p>Look at who goes out first. Which pie would Apple rather face in the final?</p>${table}`,
          [{label: "Try a different pair", primary: true, run: () => { closePanel(); paradoxSetup(); }}]);
        return;
      }
      G.winner = w; celebrate(w); goal(`Apple gained votes and lost to ${NAMES[w]}.`);
      panel("Apple gained votes and lost", `<p>Moving two ballots from Cherry dropped it below Pecan, so Cherry went out first. Cherry's fans prefer Pecan, and Pecan won 11 to 10.</p>${table}
        <p>Who goes out first can decide the result. This is rare in real elections, but no voting method avoids every problem.</p>`,
        [{label: "Finish the fair", primary: true, run: finish}]);
    });
  }
  function finish() {
    G.mode = "end"; $("skip").hidden = true; writeSave();
    panel("What the fair showed", `<ul class="learned">
      <li>A ranked ballot still counts after its first choice goes out.</li>
      <li>Each round, last place goes out and its ballots move on.</li>
      <li>Similar pies can stay in without splitting the vote.</li>
      <li>Second choices decide close contests.</li>
      <li>A short ballot can miss the final.</li>
      <li>More first places can sometimes hurt a candidate.</li></ul>`,
      [{label: "Play again", primary: true, run: () => { closePanel(); fadeTo(startSaturday); }}]);
  }

  /* ---------------------------------------------- what's within reach */
  function uses() {
    const list = [];
    if (G.mode === "sat") {
      if (G.step === "booth") list.push({id: "booth", x: S.booth.standX, z: S.booth.z, label: "Rank the pies", run: votePanel});
      const s = G.sat;
      if (G.step === "count" && s) {
        for (const p of PIES) {
          const q = S.plinths[p], x = q.x, z = q.z + 1.6;
          if (s.phase === "pull" && s.active.includes(p)) list.push({id: p, x, z, label: `Pull ${NAMES[p]} out`, run: () => useTower(p)});
          else if (s.phase === "move" && s.held != null && s.active.includes(p) && s.nextPie(s.held)) list.push({id: p, x, z, label: `Drop on ${NAMES[p]}`, run: () => useTower(p)});
          else if (s.phase === "move" && s.held == null && p === s.pulled && s.queue.length) list.push({id: p, x, z, label: "Take a ballot", run: () => useTower(p)});
        }
        if (G.day === 4 && s.held != null && !s.nextPie(s.held)) list.push({id: "crate", x: S.crate.x, z: S.crate.z + 1.3, label: "Put it in the crate", run: () => useTower("crate"), reach: 2.6});
        list.push({id: "clerk", x: S.clerk.x, z: S.clerk.z + 0.75, label: "Ask Bertie", run: bertiePanel});
      }
      if (G.step === "crate") list.push({id: "crate", x: S.crate.x, z: S.crate.z + 1.3, label: "Read the crate", run: readCrate});
    } else if (G.mode === "lab" && !G.counting) {
      for (const u of G.lab.uses) {
        const q = S.plinths[u.pie];
        list.push({id: u.pie + u.label, x: q.x, z: q.z + 1.6, label: u.label, run: u.run});
      }
      if (G.lab.bell) list.push({id: "bell", x: S.bell.x, z: S.bell.z + 0.8, label: "Ring the bell", run: G.day === 2 ? spoilerCount : G.day === 4 ? shortCount : paradoxCount});
    } else if (G.mode === "sun") {
      list.push({id: "dot", x: S.dot.x, z: S.dot.z, label: "Ask Aunt Dot", run: dotPanel, reach: 1.6});
      if (G.step === "doors") {
        for (const h of S.houses) list.push({id: "door" + h.door, x: h.stand.x, z: h.stand.z, label: `Visit ${DOORS[h.door].name}`, run: () => doorPanel(h.door), reach: 1.5});
        list.push({id: "bell", x: S.bell.x, z: S.bell.z + 0.8, label: "Ring the bell", run: ringBell});
      }
    }
    return list;
  }
  function nearestUse() {
    let best = null, score = Infinity;
    const fx = -Math.cos(me.yaw), fz = -Math.sin(me.yaw);
    for (const u of uses()) {
      const dx = u.x - me.x, dz = u.z - me.z, d = Math.hypot(dx, dz);
      if (d > (u.reach || REACH)) continue;
      const v = d - 0.4 * (d > 1e-6 ? (dx * fx + dz * fz) / d : 1);
      if (v < score) { score = v; best = u; }
    }
    return best;
  }
  function objectivePoint() {
    if (G.mode === "sat") {
      if (G.step === "booth") return [S.booth.x, 3, S.booth.z];
      if (G.step === "walk") return [0, 2, -1];
      const s = G.sat;
      const above = (pie, n) => [S.plinths[pie].x, S.towerTop(n, stepH) + 0.32, S.plinths[pie].z];
      if (G.step === "count" && s && s.phase === "pull") { const p = s.shortest()[0]; return above(p, s.towers[p].length); }
      if (G.step === "count" && s && s.phase === "move" && s.held == null) return above(s.pulled, s.queue.length);
      if (G.step === "count" && s && s.held != null && !s.nextPie(s.held)) return [S.crate.x, 1.3, S.crate.z];
      if (G.step === "crate") return [S.crate.x, 1.3, S.crate.z];
    } else if (G.mode === "sun" && G.step === "doors" && G.sun.left() === 0) {
      return [S.bell.x, 1.9, S.bell.z];
    } else if (G.mode === "lab" && !G.counting) {
      if (G.lab.bell) return [S.bell.x, 1.9, S.bell.z];
      if (G.lab.uses.length === 1) { const q = S.plinths[G.lab.uses[0].pie]; return [q.x, 2.1, q.z]; }
    }
    return null;
  }

  /* --------------------------------------------------------- celebration */
  let confetti = [];
  function celebrate() {
    if (reducedMotion) return;
    const colors = [[1, 0.85, 0.35], [0.14, 0.27, 0.74], [0.9, 0.2, 0.2], [1, 1, 1]];
    confetti = Array.from({length: 70}, (_, i) => ({
      x: (Math.random() - 0.5) * 9, y: 3 + Math.random() * 1.5, z: -5 + (Math.random() - 0.5) * 4,
      v: 0.7 + Math.random() * 0.8, c: colors[i % 4], life: 3 + Math.random() * 2,
    }));
  }

  /* ------------------------------------------------------- walkers */
  const CROWD = Array.from({length: 9}, (_, i) => ({
    a: i * 0.7, r: 9.5 + (i % 3) * 3.4, speed: (0.035 + (i % 4) * 0.012) * (i % 2 ? 1 : -1),
    body: [[0.26, 0.42, 0.62], [0.68, 0.34, 0.26], [0.33, 0.5, 0.36], [0.58, 0.44, 0.2]][i % 4],
    skin: [[0.93, 0.76, 0.62], [0.68, 0.48, 0.34], [0.46, 0.32, 0.23]][i % 3],
  }));
  function person(out, x, z, body, skin) {
    out.push(1, x, 0.74, z, 0.46, 0.6, 0.46, ...body);
    out.push(3, x, 1.6, z, 0.3, 0.3, 0.3, ...skin);
  }

  function items(dt) {
    const out = [];
    for (const s of slips) {
      if (s.t < 1) {
        s.t = Math.min(1, s.t + dt / SLIP_TIME);
        const k = s.t * s.t * (3 - 2 * s.t);
        s.x = s.fx + (s.tx - s.fx) * k; s.z = s.fz + (s.tz - s.fz) * k;
        s.y = s.fy + (s.ty - s.fy) * k + Math.sin(Math.PI * s.t) * 0.7;
      }
      if (s.held) continue;
      const col = S.C[s.pie];
      out.push(0, s.x, s.y, s.z, 0.7, stepH * 0.78, 0.46, ...col);
      if (s.i === youIndex) out.push(0, s.x, s.y, s.z, 0.8, stepH * 0.36, 0.56, ...S.C.butter);
    }
    if (G.mode === "sat" && G.sat && G.sat.held != null) {
      const s = slips[G.sat.held], cp = Math.cos(me.pitch);
      const fx = -cp * Math.cos(me.yaw), fy = -Math.sin(me.pitch), fz = -cp * Math.sin(me.yaw);
      out.push(0, me.x + fx * 0.62, W.EYE + fy * 0.62 - 0.26, me.z + fz * 0.62, 0.3, 0.02, 0.2, ...S.C[s.pie]);
    }
    if (G.mode === "sat" || G.mode === "lab") person(out, S.clerk.x - 0.1, S.clerk.z - 1.6, [0.14, 0.27, 0.6], [0.8, 0.6, 0.46]);
    if (G.mode === "sat" && G.day === 1) {
      for (const c of CROWD) {
        c.a += c.speed * dt * 4;
        const x = c.r * Math.sin(c.a) * 1.15, z = -3 + c.r * Math.cos(c.a) * 1.3 + 3;
        if (Math.abs(x) < 7.6 && z < 1.6) continue;
        person(out, x, z, c.body, c.skin);
      }
    } else if (G.mode === "sun") {
      person(out, S.dot.x, S.dot.z - 0.75, [0.6, 0.24, 0.42], [0.86, 0.68, 0.54]);
      for (const h of S.houses) {
        const shown = G.door === h.door;
        const knocked = G.sun && G.sun.knocked.has(h.door);
        if (knocked) out.push(3, h.pole[0], 1.86, h.pole[2], 0.3, 0.3, 0.3, ...S.C.butter);
        if (shown) {
          const p = h.fr.p(0, 0, S.HOUSE_D / 2 + 0.22);
          person(out, p[0], p[2], [0.42, 0.42, 0.56], [0.86, 0.68, 0.54]);
        }
      }
    }
    if (barNeed) {
      const y = S.towerTop(barNeed, stepH);
      barY += (y - barY) * (reducedMotion ? 1 : Math.min(1, dt * 3));
      out.push(0, 0, barY, S.BAR_Z, 10, 0.04, 0.05, ...S.C.butter);
    }
    const w = G.winner;
    if (w) {
      const q = S.plinths[w], n = G.mode === "sat" && G.sat ? G.sat.towers[w].length : (sundayOrder[w] || []).length;
      const y = S.towerTop(n, stepH) + 0.32 + Math.sin(clock * 2) * 0.03;
      out.push(3, q.x, y, q.z, 0.34, 0.34, 0.08, ...S.C.ribbon);
      out.push(3, q.x, y, q.z, 0.17, 0.17, 0.1, ...S.C.butter);
    }
    const aim = objectivePoint();
    // Once you're standing at it, the prompt says enough.
    const t = aim && Math.hypot(aim[0] - me.x, aim[2] - me.z) > 1.6 ? aim : null;
    markerPoint = t;
    if (t) out.push(3, t[0], t[1] + Math.sin(clock * 3) * 0.1, t[2], 0.2, 0.2, 0.2, ...S.C.butter);
    return out;
  }
  let markerPoint = null;

  function points(dt) {
    const out = [];
    if (markerPoint) out.push(markerPoint[0], markerPoint[1], markerPoint[2], 0, 0.6, 1, 0.85, 0.35, 0.5);
    confetti = confetti.filter((c) => (c.life -= dt) > 0);
    for (const c of confetti) {
      c.y = Math.max(0.1, c.y - c.v * dt);
      out.push(c.x + Math.sin(clock * 3 + c.life) * 0.2, c.y, c.z, 0, 0.09, c.c[0], c.c[1], c.c[2], 1);
    }
    return out;
  }

  /* -------------------------------------------------------------- view */
  function placeView() {
    if (!kit) return;
    Object.assign(kit.cam, {yaw: me.yaw, pitch: me.pitch, tx: me.x, ty: W.EYE, tz: me.z});
  }
  function input() {
    const down = (...k) => k.some((x) => keys.has(x));
    let forward = (down("w", "arrowup") ? 1 : 0) - (down("s", "arrowdown") ? 1 : 0);
    let right = (down("d") ? 1 : 0) - (down("a") ? 1 : 0);
    const turn = (down("arrowleft") ? -1.9 : 0) + (down("arrowright") ? 1.9 : 0);
    if (Math.abs(stickInput.forward) + Math.abs(stickInput.right) > 0) { forward = stickInput.forward; right = stickInput.right; }
    return {forward, right, turn, run: down("shift") || stickInput.run};
  }
  function tick(t, now, dt) {
    clock += dt;
    me.yaw = kit.cam.yaw; me.pitch = kit.cam.pitch;
    if (!busy()) {
      me = W.step(me, input(), dt, S.world);
      kit.cam.yaw = me.yaw;
    }
    kit.cam.tx = me.x; kit.cam.ty = W.EYE; kit.cam.tz = me.z;
    placeSky(false);
    if (G.mode === "sat" && G.step === "walk" && Math.abs(me.x) < 7 && me.z < 0.6 && me.z > -9) meetBertie();
    rows(mod._hall_set_items, new Float32Array(items(dt)), 10);
    rows(mod._hall_set_points, new Float32Array(points(dt)), 9);
    refreshHeld();
    activeUse = busy() || G.counting ? null : nearestUse();
    const pr = $("prompt");
    pr.hidden = !activeUse;
    if (activeUse && pr.dataset.id !== activeUse.id + activeUse.label) {
      pr.dataset.id = activeUse.id + activeUse.label;
      pr.innerHTML = `<kbd>E</kbd>${activeUse.label}`;
    }
    pointArrow();
  }
  function pointArrow() {
    const a = $("arrow");
    if (!markerPoint || busy()) { a.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    const v = {x: me.x, y: W.EYE, z: me.z, yaw: me.yaw, pitch: me.pitch, aspect: rect.width / Math.max(rect.height, 1), fov: FOV};
    const p = K.project(v, markerPoint);
    a.hidden = p.on;
    if (!p.on) {
      const x = (p.nx + 1) / 2 * rect.width, y = (1 - p.ny) / 2 * rect.height;
      a.style.transform = `translate(${x}px,${y}px) rotate(${-p.angle}rad) translate(-11px,-11px)`;
    }
  }
  function useNow() { if (activeUse && !busy()) { const u = activeUse; activeUse = null; u.run(); } }

  /* ------------------------------------------------------------- input */
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "escape" && panelDismiss) { panelDismiss(); return; }
    if (busy()) return;
    if (k === "e" && !e.repeat) { useNow(); return; }
    if (k === "l" && G.mode === "sun") { ledgerPanel(); return; }
    if (["w", "a", "s", "d", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) { keys.add(k); e.preventDefault(); }
  });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => keys.clear());
  $("prompt").addEventListener("click", useNow);
  $("assist").addEventListener("click", finishPile);
  $("ledger").addEventListener("click", () => { if (!busy()) ledgerPanel(); });
  $("skip").addEventListener("click", skipPanel);
  $("help").addEventListener("click", () => {
    const desk = "<p>W A S D or arrows: walk. Shift: run. Drag: look. E: use. L: ledger (Day 3). Esc: close.</p>";
    const pad = "<p>Stick: walk. Drag: look. Yellow button: use.</p>";
    panel("Controls", touchFirst ? pad : desk, [{label: "Close", primary: true, run: closePanel}], closePanel);
  });
  const stick = $("stick"), knob = $("knob");
  let stickId = null;
  function stickMove(e) {
    const r = stick.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    stickInput = W.stick(dx, dy, r.width / 2);
    const m = Math.hypot(dx, dy), lim = r.width / 2 - 24, k = m > lim ? lim / m : 1;
    knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
  }
  stick.addEventListener("pointerdown", (e) => { stickId = e.pointerId; stick.setPointerCapture(stickId); stickMove(e); });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; stickInput = {forward: 0, right: 0, run: false}; knob.style.transform = ""; };
  stick.addEventListener("pointerup", stickEnd);
  stick.addEventListener("pointercancel", stickEnd);

  /* --------------------------------------------------------------- boot */
  function rendererName() {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return name;
    } catch (e) { return ""; }
  }
  function setLights() {
    if (economy) { rows(mod._hall_set_lights, new Float32Array(0), 8); return; }
    rows(mod._hall_set_lights, new Float32Array([
      38, 34, 40, 170, 1, 0.9, 0.72, 1.5,        // the low sun
      -30, 40, -30, 170, 0.6, 0.72, 1, 0.55,     // the sky's fill
      0, 4.4, -4, 16, 1, 0.9, 0.7, 1.1,          // the lamp in the tent
    ]), 8);
  }
  function setEconomy(on) {
    economy = !!on;
    if (economy && kit) kit.dprCap = Math.min(kit.dprCap, 0.75);
    mod._hall_set_view(economy ? 0.95 : 0.62, FOV);
    setLights();
  }
  function buildWorld() {
    const m = S.build((i) => DOORS[i].ballot[0]);
    const g = grass(); texture(1, g.w, g.h, g.rgba, TEX_MIPS);
    const a = atlas(); texture(3, a.w, a.h, a.rgba, TEX_MIPS | TEX_CLAMP);
    skyMesh = m.sky; placeSky(true);
    mesh(2, m.ground, 1, LATE);
    mesh(3, m.solid);
    mesh(4, m.signs, 3, UNLIT);
    drawBoard();
    mesh(5, m.board, 2, UNLIT);
  }
  /* The engine's far plane is 80 m, so the sky and hills travel with the
     walker and the dome is never out of range. */
  let skyMesh = null, skyAt = [Infinity, 0];
  function placeSky(force) {
    if (!force && Math.hypot(me.x - skyAt[0], me.z - skyAt[1]) < 3) return;
    skyAt = [me.x, me.z];
    const moved = Object.assign(Object.create(Object.getPrototypeOf(skyMesh)), skyMesh, {positions: skyMesh.positions.slice()});
    for (let i = 0; i < moved.positions.length; i += 3) { moved.positions[i] += me.x; moved.positions[i + 2] += me.z; }
    mesh(1, moved, -1, UNLIT | LATE);
  }
  function showTitle() {
    const save = loadSave(), box = $("title-buttons");
    G.reached = save.reached; G.met = save.met;
    box.innerHTML = "";
    const add = (label, primary, run) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn" + (primary ? " primary" : ""); b.textContent = label;
      b.addEventListener("click", run); box.appendChild(b);
    };
    const dayName = (d) => `Day ${d}, ${R.DAYS[d - 1].name}`;
    if (save.reached > 1) add(`Continue: ${dayName(save.reached)}`, true, () => startDay(save.reached));
    else add("Start the fair", true, startSaturday);
    R.DAYS.forEach((_, i) => { if (i + 1 !== save.reached) add(dayName(i + 1), false, () => startDay(i + 1)); });
    if (save.reached > 1) add("Start the fair over", false, () => { StrataKit.store.set(SAVE_KEY, ""); G.reached = 1; G.met = []; startSaturday(); });
    $("title").hidden = false;
    box.querySelector("button").focus({preventScroll: true});
  }
  async function boot() {
    document.body.classList.toggle("touch", touchFirst);
    $("stick").hidden = !touchFirst;
    try { await document.fonts.load(`62px Shrikhand`); await document.fonts.load(`700 40px "Atkinson Hyperlegible"`); } catch (e) { /* fallback faces still read */ }
    mod = await StrataLoader.load({script: "vendor/hall-engine.js", factory: "createHallEngine", wasm: "vendor/hall-engine.wasm",
      title: "the harvest fair", fallback: {href: "https://play.danielstephenson.dev/", text: "Your browser can't run the fair"}});
    const software = SOFTWARE.test(rendererName());
    mod._hall_configure(software ? 0 : 1, params.get("drive") === "1" ? 1 : 0);
    const wantEconomy = params.has("economy") ? params.get("economy") === "1" : software;
    me = Object.assign({}, S.SPAWN_SAT, {pitch: 0.02});
    kit = StrataKit.create({
      module: mod, canvas,
      camera: {yaw: me.yaw, pitch: me.pitch, dist: 1, tx: me.x, ty: W.EYE, tz: me.z},
      limits: {minPitch: -1.1, maxPitch: 1.2, minDist: 1, maxDist: 1},
      idleOrbit: false, dprCap: 1.5, quality: wantEconomy ? 0 : undefined,
      frame: tick,
      onKey: (e) => e.key !== "Tab",
      onSlow: () => { if (!economy) setEconomy(true); },
      onFatal: (code, msg) => StrataLoader.fallback(code, msg),
    });
    buildWorld();
    setEconomy(wantEconomy);
    kit.start();
    StrataLoader.done();
    showTitle();
    window.__fair = {
      G, S, get me() { return me; },
      tp(x, z, yaw, pitch = 0.04) { me = Object.assign({}, me, {x, z, yaw, pitch, vx: 0, vz: 0}); placeView(); },
      use: () => activeUse && activeUse.label,
      act: useNow,
    };
  }
  boot().catch((e) => { console.error(e); StrataLoader.fallback("boot", String(e)); });
})();
