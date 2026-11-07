"use strict";
/* The fairground: where everything stands and the geometry that draws it,
   with no DOM and no engine (tests/scene.test.cjs walks it under node).

   Coordinates are metres. The gate is south at +z, the tent north of it.
   Frames follow HallWalk.frame: r = (cos a, 0, -sin a), f = (sin a, 0, cos a). */
(function (root) {
  const Walk = typeof module !== "undefined" && module.exports ? require("./vendor/hall-walk.js") : root.HallWalk;
  const PIES = ["apple", "pumpkin", "pecan", "cherry"];

  const C = {
    apple: [0.28, 0.62, 0.25], pumpkin: [0.9, 0.5, 0.1], pecan: [0.5, 0.3, 0.17], cherry: [0.72, 0.1, 0.36],
    butter: [1, 0.85, 0.35], ribbon: [0.14, 0.27, 0.74], canvas: [0.95, 0.92, 0.82], stripe: [0.76, 0.17, 0.16],
    wood: [0.47, 0.32, 0.2], woodDark: [0.32, 0.22, 0.14], thatch: [0.62, 0.47, 0.26], slate: [0.35, 0.38, 0.45],
    leaf: [0.24, 0.42, 0.2], leafGold: [0.8, 0.52, 0.14], leafRed: [0.68, 0.26, 0.12], hay: [0.86, 0.71, 0.36],
    hedge: [0.19, 0.34, 0.18], lane: [0.66, 0.54, 0.38],
  };
  const WALLS = [[0.91, 0.84, 0.7], [0.82, 0.71, 0.58], [0.86, 0.8, 0.8], [0.75, 0.81, 0.76], [0.92, 0.77, 0.62]];
  const DOOR_COLORS = [[0.16, 0.32, 0.56], [0.52, 0.16, 0.16], [0.17, 0.42, 0.33], [0.55, 0.38, 0.1]];

  /* ------------------------------------------------------------ layout */
  const BOUNDS = 31;
  const PLINTH = {z: -5.5, top: 0.45, size: 1, spacing: 2.4};
  const BOARD = {z: -7.5, w: 4.1, h: 1.81, y: 1.74};
  const BAR_RISE = 1.2;                 // plinth top to the win bar: the bar means "more than half"
  const plinths = Object.fromEntries(PIES.map((p, i) => [p, {x: (i - 1.5) * PLINTH.spacing, z: PLINTH.z}]));
  const crate = {x: 5.9, z: -5.5};
  const bell = {x: 0, z: -2.5};
  const booth = {x: -6, z: 11, standX: -4.1};
  const clerk = {x: -5.1, z: -3.9};
  const dot = {x: 3, z: 6};
  const SPAWN_SAT = {x: 0, z: 29.6, yaw: Math.PI / 2, pitch: 0.04};
  const SPAWN_SUN = {x: 0, z: 9, yaw: Math.PI / 2, pitch: 0.04};
  const SPAWN_TENT = {x: 0, z: -1.4, yaw: Math.PI / 2, pitch: 0.04};
  const BAR_Z = PLINTH.z - 0.62;
  const towerTop = (n, step) => PLINTH.top + n * step;

  /* The doors round the green. Neighbours aren't in their rules-file order,
     so the two Cherry fans live far apart. HOUSE[k] is the Rules.DOORS index. */
  const HOUSE = [3, 15, 8, 0, 12, 6, 1, 10, 13, 4, 16, 7, 2, 9, 14, 5, 11];
  const HOUSE_W = 5, HOUSE_D = 4;
  const houses = HOUSE.map((door, k) => {
    const th = (28 + (304 / 16) * k) * Math.PI / 180;
    const x = 23 * Math.sin(th), z = -3 + 22 * Math.cos(th);
    const l = Math.hypot(x, z + 3), f = [-x / l, -(z + 3) / l];
    const a = Math.atan2(f[0], f[1]);
    const fr = Walk.frame({x, z, angle: a});
    const stand = fr.p(0, 0, HOUSE_D / 2 + 1.7), pole = fr.p(1.5, 0, HOUSE_D / 2 + 0.9), doorAt = fr.p(0, 0, HOUSE_D / 2 + 0.04);
    return {door, k, x, z, angle: a, fr, stand: {x: stand[0], z: stand[2]}, pole, doorAt};
  });

  /* Stored as [x0, z0, x1, z1] with an angle for houses and stalls. */
  function rect(x0, z0, x1, z1) { return {fr: Walk.frame({x: 0, z: 0, angle: 0}), x0, z0, x1, z1, c: null}; }
  function placed(x, z, angle, hw, hd) { return {fr: Walk.frame({x, z, angle}), x0: -hw, z0: -hd, x1: hw, z1: hd, c: null}; }
  const STALLS = [{x: 6, z: 18, angle: -Math.PI / 2, color: C.apple}, {x: -6, z: 18, angle: Math.PI / 2, color: C.cherry}, {x: 6.2, z: 11, angle: -Math.PI / 2, color: C.pumpkin}];
  const BALES = [[-9, 3.5], [-10.4, 5], [9.5, 4], [11, 15], [-11.5, 15]];
  const obstacles = [
    rect(-7, -9.2, 7, -8.9), rect(-7.2, -9.2, -6.9, 1), rect(6.9, -9.2, 7.2, 1),
    rect(-7, 0.8, -3.6, 1), rect(3.6, 0.8, 7, 1),
    ...PIES.map((p) => rect(plinths[p].x - 0.5, plinths[p].z - 0.5, plinths[p].x + 0.5, plinths[p].z + 0.5)),
    rect(crate.x - 0.45, crate.z - 0.45, crate.x + 0.45, crate.z + 0.45),
    rect(bell.x - 0.14, bell.z - 0.14, bell.x + 0.14, bell.z + 0.14),
    rect(clerk.x - 1.1, clerk.z - 1.25, clerk.x + 0.6, clerk.z - 0.45),
    rect(booth.x - 0.8, booth.z - 0.9, booth.x + 0.8, booth.z + 0.9),
    rect(-4.1, 23.8, -3.7, 24.2), rect(3.7, 23.8, 4.1, 24.2),
    ...houses.map((h) => placed(h.x, h.z, h.angle, HOUSE_W / 2, HOUSE_D / 2)),
    ...STALLS.map((s) => placed(s.x, s.z, s.angle, 1.5, 0.7)),
    ...BALES.map(([x, z]) => rect(x - 0.6, z - 0.4, x + 0.6, z + 0.4)),
  ];
  const world = {obstacles, bounds: [-BOUNDS, -BOUNDS, BOUNDS, BOUNDS]};

  /* ---------------------------------------------------------- the atlas
     One canvas of signs: an 8 x 8 grid of 2:1 cells, drawn by the page. */
  const ATLAS = {w: 2048, h: 1024, cols: 8, rows: 8};
  const CELLS = {};
  PIES.forEach((p, i) => { CELLS[p] = i; });
  CELLS.crate = 4; CELLS.booth = 5; CELLS.bell = 6; CELLS.clerk = 7;
  CELLS.gate = 8;  // four cells wide
  for (let i = 0; i < 17; i++) CELLS["door" + i] = 16 + i;
  function cellUV(key, span = 1) {
    const i = CELLS[key], u0 = (i % ATLAS.cols) / ATLAS.cols, v0 = Math.floor(i / ATLAS.cols) / ATLAS.rows;
    return [u0, v0, u0 + span / ATLAS.cols, v0 + 1 / ATLAS.rows];
  }

  /* ------------------------------------------------------- mesh building */
  class Mesh {
    constructor() { this.positions = []; this.normals = []; this.colors = []; this.uvs = []; this.indices = []; }
    get nv() { return this.positions.length / 3; }
    /* Any polygon, wound here to face n; colors is one colour or one per point. */
    poly(pts, n, color = [1, 1, 1], uvs = null) {
      const b = this.nv, [p0, p1, p2] = pts;
      const e1 = [0, 1, 2].map((i) => p1[i] - p0[i]), e2 = [0, 1, 2].map((i) => p2[i] - p0[i]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
      pts.forEach((p, i) => {
        this.positions.push(...p); this.normals.push(...n);
        this.colors.push(...(Array.isArray(color[0]) ? color[i] : color));
        if (uvs) this.uvs.push(...uvs[i]);
      });
      for (let i = 1; i < pts.length - 1; i++) {
        if (flip) this.indices.push(b, b + i + 1, b + i); else this.indices.push(b, b + i, b + i + 1);
      }
    }
    both(pts, n, color) { this.poly(pts, n, color); this.poly(pts, n.map((v) => -v), color); }
    /* A box with its base at y, turned by a about its centre. */
    box(x, y, z, sx, sy, sz, color, a = 0, top = null) {
      const r = [Math.cos(a), 0, -Math.sin(a)], f = [Math.sin(a), 0, Math.cos(a)];
      const P = (u, v, w) => [x + u * sx / 2 * r[0] + w * sz / 2 * f[0], y + v * sy, z + u * sx / 2 * r[2] + w * sz / 2 * f[2]];
      this.poly([P(-1, 0, 1), P(1, 0, 1), P(1, 1, 1), P(-1, 1, 1)], f, color);
      this.poly([P(1, 0, -1), P(-1, 0, -1), P(-1, 1, -1), P(1, 1, -1)], f.map((v) => -v), color);
      this.poly([P(1, 0, 1), P(1, 0, -1), P(1, 1, -1), P(1, 1, 1)], r, color);
      this.poly([P(-1, 0, -1), P(-1, 0, 1), P(-1, 1, 1), P(-1, 1, -1)], r.map((v) => -v), color);
      this.poly([P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)], [0, 1, 0], top || color);
    }
    /* A gable: ridge along the local x axis. */
    gable(x, y, z, sx, sz, h, color, end, a = 0) {
      const r = [Math.cos(a), 0, -Math.sin(a)], f = [Math.sin(a), 0, Math.cos(a)];
      const P = (u, v, w) => [x + u * r[0] + w * f[0], y + v, z + u * r[2] + w * f[2]];
      const hx = sx / 2, hz = sz / 2, l = Math.hypot(hz, h), ny = hz / l, nf = h / l;
      this.poly([P(-hx, 0, hz), P(hx, 0, hz), P(hx, h, 0), P(-hx, h, 0)], [f[0] * nf, ny, f[2] * nf], color);
      this.poly([P(hx, 0, -hz), P(-hx, 0, -hz), P(-hx, h, 0), P(hx, h, 0)], [-f[0] * nf, ny, -f[2] * nf], color);
      this.poly([P(hx, 0, hz), P(hx, 0, -hz), P(hx, h, 0)], r, end);
      this.poly([P(-hx, 0, -hz), P(-hx, 0, hz), P(-hx, h, 0)], r.map((v) => -v), end);
    }
    cylinder(x, y, z, rad, h, color, n = 10, top = rad) {
      for (let i = 0; i < n; i++) {
        const a = i / n * 2 * Math.PI, b = (i + 1) / n * 2 * Math.PI, m = (a + b) / 2;
        const A = (t, k) => [x + k * Math.cos(t), y, z + k * Math.sin(t)], B = (t, k) => [x + k * Math.cos(t), y + h, z + k * Math.sin(t)];
        const l = Math.hypot(h, rad - top) || 1, ny = (rad - top) / l, nr = h / l;
        const pts = top > 1e-3 ? [A(a, rad), A(b, rad), B(b, top), B(a, top)] : [A(a, rad), A(b, rad), B(a, 0)];
        this.poly(pts, [Math.cos(m) * nr, ny, Math.sin(m) * nr], color);
        if (top > 1e-3) this.poly([B(a, top), B(b, top), [x, y + h, z]], [0, 1, 0], color);
      }
    }
    /* A sign: a flat quad at o facing unit (nx, nz), width w, height h, from the atlas. */
    sign(o, nx, nz, w, h, uv) {
      const rx = nz, rz = -nx, hw = w / 2;
      const [u0, v0, u1, v1] = uv;
      this.poly([
        [o[0] - rx * hw, o[1], o[2] - rz * hw], [o[0] + rx * hw, o[1], o[2] + rz * hw],
        [o[0] + rx * hw, o[1] + h, o[2] + rz * hw], [o[0] - rx * hw, o[1] + h, o[2] - rz * hw],
      ], [nx, 0, nz], [1, 1, 1], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
    }
  }

  let seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

  function buildTent(m) {
    const H = 2.6, R = 5.5, x0 = -7.2, x1 = 7.2, z0 = -9.4, z1 = 1.2, mid = (z0 + z1) / 2;
    m.box(0, 0, -9.05, 14.2, H, 0.3, C.canvas);
    m.box(-7.05, 0, -4.1, 0.3, H, 10.2, C.canvas);
    m.box(7.05, 0, -4.1, 0.3, H, 10.2, C.canvas);
    m.box(-5.3, 0, 0.9, 3.4, H, 0.2, C.canvas);
    m.box(5.3, 0, 0.9, 3.4, H, 0.2, C.canvas);
    m.box(0, 2.15, 0.9, 7.2, 0.45, 0.2, C.stripe);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n, col = i % 2 ? C.canvas : C.stripe;
      const l = Math.hypot(z1 - mid, R - H), ny = (z1 - mid) / l, nz = (R - H) / l;
      m.both([[a, H, z1], [b, H, z1], [b, R, mid], [a, R, mid]], [0, ny, nz], col);
      m.both([[a, H, z0], [b, H, z0], [b, R, mid], [a, R, mid]], [0, ny, -nz], col);
    }
    for (const x of [x0, x1]) m.both([[x, H, z0], [x, H, z1], [x, R, mid]], [Math.sign(x), 0, 0], C.canvas);
    for (const x of [-7, 0, 7]) m.cylinder(x, R, mid, 0.05, 1.3, C.woodDark, 6);
    for (const x of [-7, 7]) m.box(x + 0.32, R + 0.95, mid, 0.6, 0.32, 0.03, C.ribbon);
    m.box(0.32, R + 0.95, mid, 0.6, 0.32, 0.03, C.butter);
    m.cylinder(-3.4, 0, 1.0, 0.09, 2.7, C.woodDark, 8);
    m.cylinder(3.4, 0, 1.0, 0.09, 2.7, C.woodDark, 8);
    // The floor boards, and straw round the count.
    m.box(0, 0, -4, 14, 0.04, 10, [0.72, 0.58, 0.38]);
    for (const p of PIES) {
      const q = plinths[p];
      m.box(q.x, 0, q.z, PLINTH.size, PLINTH.top, PLINTH.size, C[p], 0, [0.93, 0.9, 0.8]);
    }
    // The win bar, the height of more than half.
    const y = PLINTH.top + BAR_RISE;
    // (The bar itself moves with the count: it's drawn each frame in main.js.)
    m.cylinder(-5, 0, PLINTH.z - 0.62, 0.05, y + 0.05, C.woodDark, 6);
    m.cylinder(5, 0, PLINTH.z - 0.62, 0.05, y + 0.05, C.woodDark, 6);
    // The tally board on its stand, clear of the roof's slope.
    m.box(0, BOARD.y - 0.09, BOARD.z - 0.08, BOARD.w + 0.2, BOARD.h + 0.16, 0.08, C.woodDark);
    for (const x of [-2.3, 2.3]) m.box(x, 0, BOARD.z - 0.1, 0.1, 1.8, 0.1, C.woodDark);
    // The crate, the clerk's desk, the bell.
    m.box(crate.x, 0, crate.z, 0.9, 0.55, 0.9, C.wood, 0, C.woodDark);
    m.box(clerk.x - 0.25, 0, clerk.z - 0.85, 1.7, 0.78, 0.8, C.wood, 0, C.woodDark);
    m.box(clerk.x - 0.4, 0.78, clerk.z - 0.85, 0.5, 0.12, 0.36, [0.92, 0.88, 0.76]);
    m.cylinder(bell.x, 0, bell.z, 0.05, 1.2, C.woodDark, 8);
    m.box(bell.x, 1.2, bell.z, 0.42, 0.05, 0.05, C.woodDark);
    m.cylinder(bell.x, 0.98, bell.z, 0.15, 0.2, C.butter, 12, 0.05);
  }

  function buildHouse(m, h, i, first) {
    const wall = WALLS[i % WALLS.length], roof = i % 3 === 1 ? C.slate : C.thatch, door = DOOR_COLORS[i % DOOR_COLORS.length];
    m.box(h.x, 0, h.z, HOUSE_W, 2.5, HOUSE_D, wall, h.angle);
    m.gable(h.x, 2.5, h.z, HOUSE_W + 0.5, HOUSE_D + 0.7, 1.7, roof, wall, h.angle);
    const P = h.fr.p, a = h.angle, z = HOUSE_D / 2;
    const frame = P(0, 0, z + 0.03);
    m.box(frame[0], 0, frame[2], 1.2, 2.15, 0.06, C.woodDark, a);
    const leaf = P(0, 0, z + 0.07);
    m.box(leaf[0], 0.05, leaf[2], 1, 2.02, 0.05, door, a);
    const flag = P(1.85, 0, z + 0.9);
    m.box(flag[0], 1.28, flag[2], 0.68, 0.42, 0.03, C[first], a);
    for (const u of [-1.55, 1.55]) {
      const w = P(u, 0, z + 0.03);
      m.box(w[0], 1.05, w[2], 0.9, 0.85, 0.06, C.woodDark, a);
      const g = P(u, 0, z + 0.05);
      m.box(g[0], 1.12, g[2], 0.72, 0.68, 0.05, [0.97, 0.82, 0.48], a);
    }
    const stoop = P(0, 0, z + 0.45);
    m.box(stoop[0], 0, stoop[2], 1.6, 0.1, 0.9, [0.6, 0.57, 0.52], a);
    const c = P(1.6, 0, -0.6);
    m.box(c[0], 3.2, c[2], 0.5, 1.5, 0.5, [0.55, 0.3, 0.24], a);
    m.cylinder(h.pole[0], 0, h.pole[2], 0.035, 1.7, C.woodDark, 6);
  }

  function buildGrounds(m) {
    // The lane round the green and the path up from the gate.
    const lane = (y) => {
      const n = 64, cols = [];
      for (let i = 0; i < n; i++) {
        const a = i / n * 2 * Math.PI, b = (i + 1) / n * 2 * Math.PI;
        const ring = (t, k) => [k * 18.4 * Math.sin(t), y, -3 + k * 17.4 * Math.cos(t)];
        m.poly([ring(a, 0.94), ring(b, 0.94), ring(b, 1.06), ring(a, 1.06)], [0, 1, 0], C.lane);
      }
      return cols;
    };
    lane(0.02);
    m.poly([[-1.5, 0.03, 1], [1.5, 0.03, 1], [1.5, 0.03, 29], [-1.5, 0.03, 29]], [0, 1, 0], C.lane);
    // The gate.
    m.box(-3.9, 0, 24, 0.34, 3.6, 0.34, C.wood);
    m.box(3.9, 0, 24, 0.34, 3.6, 0.34, C.wood);
    m.box(0, 3.5, 24, 8.4, 0.2, 0.3, C.woodDark);
    // The voting booth, facing the path.
    const b = booth;
    m.box(b.x, 0, b.z - 0.85, 1.6, 2.2, 0.1, C.ribbon);
    m.box(b.x, 0, b.z + 0.85, 1.6, 2.2, 0.1, C.ribbon);
    m.box(b.x - 0.75, 0, b.z, 0.1, 2.2, 1.8, C.ribbon);
    m.box(b.x, 2.2, b.z, 1.9, 0.12, 2.1, C.butter);
    m.box(b.x + 0.2, 0, b.z, 0.62, 0.95, 0.62, C.wood, 0, C.woodDark);
    for (const s of STALLS) {
      m.box(s.x, 0, s.z, 3, 0.9, 1.2, C.wood, s.angle, C.woodDark);
      const f = Walk.frame({x: s.x, z: s.z, angle: s.angle});
      for (const u of [-1, 0, 1]) {
        const p = f.p(u, 0, 0);
        m.cylinder(p[0], 0.9, p[2], 0.27, 0.07, C.hay, 12);
        m.cylinder(p[0], 0.97, p[2], 0.2, 0.015, s.color, 12);
      }
      m.gable(s.x, 2.1, s.z, 3.4, 1.9, 0.6, s.color, C.canvas, s.angle);
      for (const [u, w] of [[-1.4, -0.5], [1.4, -0.5], [-1.4, 0.5], [1.4, 0.5]]) {
        const p = f.p(u, 0, w);
        m.cylinder(p[0], 0, p[2], 0.05, 2.1, C.woodDark, 6);
      }
    }
    for (const [x, z] of BALES) m.box(x, 0, z, 1.2, 0.6, 0.8, C.hay);
    // Bunting from the gate to the tent.
    const flags = [C.stripe, C.butter, C.ribbon, C.apple];
    for (const side of [-1, 1]) {
      const n = 22, ax = side * 3.7, az = 23.9, bx = side * 3.4, bz = 1.1;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, sag = 4 * t * (1 - t) * 0.5;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = 3.3 - (3.3 - 2.7) * t - sag;
        m.both([[x, y, z - 0.17], [x, y, z + 0.17], [x, y - 0.32, z]], [side, 0, 0], flags[i % 4]);
      }
    }
    // Hedge, and trees beyond the houses.
    const e = BOUNDS + 0.5;
    m.box(0, 0, -e, 2 * e, 1.6, 1, C.hedge);
    m.box(-e, 0, 0, 1, 1.6, 2 * e, C.hedge);
    m.box(e, 0, 0, 1, 1.6, 2 * e, C.hedge);
    m.box(-16.7, 0, e, 2 * e - 29.6, 1.6, 1, C.hedge);
    m.box(16.7, 0, e, 2 * e - 29.6, 1.6, 1, C.hedge);
    const leaves = [C.leaf, C.leafGold, C.leafRed, C.leafGold, C.leaf];
    for (let i = 0; i < 46; i++) {
      const a = rnd() * 2 * Math.PI, d = 0.5 + rnd() * 0.5;
      const x = (Math.cos(a) > 0 ? 1 : -1) * Math.min(Math.abs(Math.cos(a)) * 80, 29.5) * (0.92 + 0.08 * d);
      const z = (Math.sin(a) > 0 ? 1 : -1) * Math.min(Math.abs(Math.sin(a)) * 80, 29.5) * (0.92 + 0.08 * d);
      if (z > 24 && Math.abs(x) < 8) continue;
      if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < 4.6)) continue;
      const s = 0.8 + rnd() * 0.7, c = leaves[i % leaves.length];
      m.cylinder(x, 0, z, 0.2 * s, 1.5 * s, C.woodDark, 6);
      m.cylinder(x, 1.1 * s, z, 1.5 * s, 2.3 * s, c, 8, 0);
      m.cylinder(x, 2.3 * s, z, 1.1 * s, 2 * s, c, 8, 0);
    }
  }

  function buildSky() {
    const m = new Mesh(), R = 75, stops = [[-0.1, [0.5, 0.45, 0.42]], [0.03, [0.98, 0.72, 0.45]], [0.18, [0.96, 0.83, 0.66]], [0.45, [0.56, 0.74, 0.88]], [1, [0.3, 0.5, 0.78]]];
    const shade = (y) => {
      for (let i = 1; i < stops.length; i++) {
        if (y <= stops[i][0]) {
          const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = Math.max(0, (y - a) / (b - a));
          return ca.map((v, k) => v + (cb[k] - v) * t);
        }
      }
      return stops[stops.length - 1][1];
    };
    const lat = 12, lon = 32;
    for (let j = 0; j < lat; j++) {
      const p0 = -0.1 + j / lat * 1.67, p1 = -0.1 + (j + 1) / lat * 1.67;
      for (let i = 0; i < lon; i++) {
        const a = i / lon * 2 * Math.PI, b = (i + 1) / lon * 2 * Math.PI;
        const P = (t, p) => [R * Math.cos(p) * Math.cos(t), R * Math.sin(p), R * Math.cos(p) * Math.sin(t)];
        const pts = [P(a, p0), P(b, p0), P(b, p1), P(a, p1)];
        const mid = pts.reduce((s, q) => s.map((v, k) => v + q[k] / 4), [0, 0, 0]);
        m.poly(pts, mid.map((v) => -v / R), pts.map((q) => shade(q[1] / R)));
      }
    }
    // Low hills all the way round.
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * 2 * Math.PI, b = (i + 1) / 40 * 2 * Math.PI;
      const h = (t) => 4 + 2.2 * Math.sin(t * 3 + 1) + 1.4 * Math.sin(t * 7);
      const P = (t, y) => [68 * Math.cos(t), y, 68 * Math.sin(t)];
      const d = [(Math.cos(a) + Math.cos(b)) / -2, 0, (Math.sin(a) + Math.sin(b)) / -2];
      m.poly([P(a, 0), P(b, 0), P(b, h(b)), P(a, h(a))], d, [[0.36, 0.47, 0.3], [0.36, 0.47, 0.3], [0.5, 0.56, 0.36], [0.5, 0.56, 0.36]]);
    }
    return m;
  }

  /* firstOf(doorIndex): the pie on that neighbour's yard flag. */
  function build(firstOf) {
    seed = 7;
    const ground = new Mesh(), solid = new Mesh(), signs = new Mesh(), board = new Mesh();
    const G = 90, rep = 60;
    ground.poly([[-G, 0, G], [G, 0, G], [G, 0, -G], [-G, 0, -G]], [0, 1, 0], [1, 1, 1], [[0, rep], [rep, rep], [rep, 0], [0, 0]]);
    buildTent(solid);
    buildGrounds(solid);
    houses.forEach((h, i) => buildHouse(solid, h, i, firstOf(h.door)));

    for (const p of PIES) signs.sign([plinths[p].x, 0.03, plinths[p].z + 0.52], 0, 1, 0.84, 0.42, cellUV(p));
    signs.sign([crate.x, 0.07, crate.z + 0.46], 0, 1, 0.84, 0.42, cellUV("crate"));
    signs.sign([booth.x + 0.9, 2.28, booth.z], 1, 0, 1.6, 0.7, cellUV("booth"));
    signs.sign([0, 2.2, 24.17], 0, 1, 7.4, 1.3, cellUV("gate", 4));
    signs.sign([0, 2.2, 23.83], 0, -1, 7.4, 1.3, cellUV("gate", 4));
    signs.sign([clerk.x - 0.25, 0.1, clerk.z - 0.44], 0, 1, 1.2, 0.6, cellUV("clerk"));
    for (const h of houses) {
      const a = h.fr.p(0, 2.2, 2.09);
      signs.sign(a, h.fr.f[0], h.fr.f[2], 1.15, 0.5, cellUV("door" + h.door));
    }
    const bw = BOARD.w / 2, by = BOARD.y, bt = by + BOARD.h, bz = BOARD.z;
    board.poly([[-bw, by, bz], [bw, by, bz], [bw, bt, bz], [-bw, bt, bz]],
      [0, 0, 1], [1, 1, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    return {ground, solid, signs, board, sky: buildSky()};
  }

  const Scene = {C, PIES, PLINTH, BAR_RISE, BOUNDS, ATLAS, CELLS, plinths, crate, bell, booth, clerk, dot, houses, HOUSE, HOUSE_D,
    SPAWN_SAT, SPAWN_SUN, SPAWN_TENT, BAR_Z, world, towerTop, build};
  if (typeof module !== "undefined" && module.exports) module.exports = Scene;
  else root.Scene = Scene;
})(typeof window !== "undefined" ? window : globalThis);
