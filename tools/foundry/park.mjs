// Foundry: the second park, built entirely from code (tools/build-foundry.mjs). 80 × 72 m of concrete plaza: a 6 m start tower
// with a roll-in into a loop-the-loop and a big bank down into the street section; 7-, 5- and 3-stair sets with handrails and
// hubbas; ledges, a flat bar, a manual pad, a funbox with a kinked rail, a curved ledge, a kicker; a mini half-pipe, a deep bowl,
// and quarter pipes. x is east, z is south, y is up; the board's heading h points along (−sin h, 0, −cos h).
import * as THREE from 'three';
import { V, Part, quad, polygon, box, extrude, tube, arc, faceNormal } from './geom.mjs';
import { loopRibbon, LoopPath } from '../../dist/src/skate/loop.js';

export const MATERIALS = {
  floor: { name: 'Concrete | brushed slab / 3m', textures: 'brushed_concrete', uvScale: 3.2, color: [1, 1, 1, 1], vary: 0.16 },
  apron: { name: 'Concrete | apron / 4m', textures: 'brushed_concrete', uvScale: 4.5, color: [0.55, 0.54, 0.52, 1], maxEdge: 8 },
  smooth: { name: 'Concrete | smooth transition / 2.5m', textures: 'garage_floor', uvScale: 2.5, color: [1, 1, 1, 1], vary: 0.12 },
  precast: { name: 'Concrete | precast / 2m', textures: 'concrete_floor', uvScale: 2.2, color: [1, 1, 1, 1], vary: 0.12 },
  ply: { name: 'Timber | ply deck / 2.4m', textures: 'plywood', uvScale: 2.4, color: [1, 1, 1, 1], vary: 0.1 },
  galv: { name: 'Steel | galvanized', color: [0.6, 0.62, 0.63, 1], metallic: 1, roughness: 0.32, uvScale: 1 },
  graphite: { name: 'Steel | graphite powdercoat', color: [0.045, 0.05, 0.055, 1], metallic: 0.55, roughness: 0.5, uvScale: 1 },
  orange: { name: 'Steel | foundry orange', color: [0.6, 0.16, 0.045, 1], metallic: 0.35, roughness: 0.48, uvScale: 1 },
  tile: { name: 'Tile | glazed teal', color: [0.04, 0.27, 0.3, 1], metallic: 0, roughness: 0.22, uvScale: 1 },
  joint: { name: 'Construction | joint sealant', color: [0.06, 0.06, 0.06, 1], metallic: 0, roughness: 0.95, uvScale: 1, maxEdge: 1e9, decal: true },
  paint: { name: 'Paint | safety yellow', color: [0.78, 0.52, 0.04, 1], metallic: 0, roughness: 0.62, uvScale: 1, maxEdge: 1e9, decal: true }
};

const HALF = { x: 39.6, z: 35.6 };          // inside faces of the perimeter wall
const TOWER_H = 6.5;                         // the start tower's deck: enough drop that pushing off it carries you round the loop

export function buildPark() {
  const parts = {};
  for (const [key, m] of Object.entries(MATERIALS)) parts[key] = new Part(m.name, { uvScale: m.uvScale, maxEdge: m.maxEdge ?? 0.42 });
  const cols = {};
  const col = (area) => (cols[area] ??= new Part(`COL_${area}`, { collision: true }));
  const paths = [];
  const loops = [];
  const spawns = [];
  const P = parts;

  // Everything standing on the slab leaves a footprint; the saw-cut joints (drawn last) stop at them, or they would show through.
  const footprints = [];
  const footprint = (pts, pad = 0.05) => {
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
    footprints.push([Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad]);
  };
  const addPath = (name, kind, pts, { radius = kind === 'rail' ? 0.024 : kind === 'coping' ? 0.035 : 0.03, closed = false } = {}) => {
    paths.push({ name: `PATH_${name}`, kind, closed, radius, points: pts.flatMap((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]) });
  };

  // ------------------------------------------------------------------ building blocks
  // A solid ramp shape: `surface` is the riding profile as [d, y(, smooth)] with d increasing along `dir`; the shape runs `width`
  // metres to the right of dir from `origin` (a ground point at d = 0). Sides and back walls go down to the ground.
  function rampBody(surface, { origin, dir, width, top, side = P.precast, area, back = true, front = true, sideCol = true }) {
    const w = V().crossVectors(V(0, 1, 0), dir).normalize();        // across the ramp: extrude axis, so that "across" in the profile is dir
    const start = origin.clone();
    const profile = surface.map((p) => [p[0], p[1], p[2]]);
    // extrude's profile runs to the right of its own dir (= w), which is `dir` here.
    extrude(top, profile, { start, dir: w, length: width, closed: false });
    if (area) extrude(col(area), profile, { start, dir: w, length: width, closed: false });
    const at = (d, y, k) => V().copy(origin).addScaledVector(dir, d).addScaledVector(w, k).setY(origin.y + y);
    const first = surface[0], last = surface[surface.length - 1];
    if (origin.y < 0.01) footprint([at(first[0], 0, 0), at(first[0], 0, width), at(last[0], 0, 0), at(last[0], 0, width)]);
    // Side faces: the outline of the surface closed along the ground.
    const outline = surface.map((p) => [p[0], p[1]]);
    if (last[1] > 0.01) outline.push([last[0], 0]);
    if (first[1] > 0.01) outline.push([first[0], 0]);
    for (const [k, facing] of [[0, -1], [width, 1]]) {
      const pts = outline.map(([d, y]) => at(d, y, k));
      const n = w.clone().multiplyScalar(facing);
      polygon(side, pts, n);
      if (area && sideCol) polygon(col(area), pts, n);
    }
    // Back and front walls where the surface ends above the ground.
    const wall = (d, y, facingDir) => {
      if (y <= 0.01) return;
      const a = at(d, 0, 0), b = at(d, 0, width), c = at(d, y, width), e = at(d, y, 0);
      const pts = facingDir > 0 ? [b, a, e, c] : [a, b, c, e];
      const ok = faceNormal(pts[0], pts[1], pts[2]).dot(dir) * facingDir > 0 ? pts : pts.slice().reverse();
      polygon(side, ok, dir.clone().multiplyScalar(facingDir));
      if (area) polygon(col(area), ok, dir.clone().multiplyScalar(facingDir));
    };
    if (back) wall(last[0], last[1], 1);
    if (front) wall(first[0], first[1], -1);
  }

  // A block with a top of one material and sides of another.
  function block(min, max, { top = P.floor, side = P.precast, area } = {}) {
    if (min.y < 0.01) footprint([min, max]);
    box(top, min, max, { sides: false });
    box(side, min, max, { top: false });
    if (area) box(col(area), min, max, {});
  }

  // A concrete ledge with steel angle on its two long top edges, and grind lines along them. Long axis along x or z.
  function ledge(name, min, max, { area = 'Street', edges = 'both' } = {}) {
    block(min, max, { top: P.precast, side: P.precast, area });
    const alongX = max.x - min.x > max.z - min.z;
    const y = max.y;
    const sides = alongX ? [[min.z, 1], [max.z, -1]] : [[min.x, 1], [max.x, -1]];
    sides.forEach(([e, inward], i) => {
      if (edges !== 'both' && edges !== i) return;
      const a = alongX ? V(min.x, y, e) : V(e, y, min.z), b = alongX ? V(max.x, y, e) : V(e, y, max.z);
      // steel angle: a slim dark strip wrapping the edge, 3.5 cm into the top and down the face
      const s = 0.035, lo = Math.min(e - inward * 0.004, e + inward * s), hi = Math.max(e - inward * 0.004, e + inward * s);
      if (alongX) box(P.graphite, V(min.x, y - s, lo), V(max.x, y + 0.004, hi), {});
      else box(P.graphite, V(lo, y - s, min.z), V(hi, y + 0.004, max.z), {});
      const off = alongX ? V(0, 0, inward * 0.03) : V(inward * 0.03, 0, 0);
      addPath(`${name}_${i ? 'B' : 'A'}`, 'ledge', [a.clone().add(off).setY(y + 0.027), b.clone().add(off).setY(y + 0.027)]);
    });
  }

  // A handrail: a round tube through `pts`, posts down to whatever is under them (footY(x, z)), and its grind line.
  function handrail(name, pts, posts, footY) {
    tube(P.galv, pts, 0.024, { segments: 12 });
    for (const p of posts) {
      const y = footY(p.x, p.z);
      const top = railY(pts, p);
      tube(P.galv, [V(p.x, y, p.z), V(p.x, top - 0.02, p.z)], 0.022, { segments: 10 });
      box(P.graphite, V(p.x - 0.07, y, p.z - 0.07), V(p.x + 0.07, y + 0.012, p.z + 0.07), { bottom: false });
    }
    addPath(name, 'rail', pts);
  }
  // Height of a rail polyline over a point (by its horizontal position).
  function railY(pts, p) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const ab = V(b.x - a.x, 0, b.z - a.z), ap = V(p.x - a.x, 0, p.z - a.z);
      const t = ab.lengthSq() > 1e-9 ? ap.dot(ab) / ab.lengthSq() : 0;
      if (t >= -1e-6 && t <= 1 + 1e-6) return a.y + (b.y - a.y) * t;
    }
    return pts[0].y;
  }

  // A stair set: `risers` steps down from height h, starting at the edge `top` (centre of the top edge, at the landing height) and
  // going down along `dir`, `width` wide. Steel nosings on every step. Returns the surface height function along it.
  function stairs({ top, dir, width, risers, rise = 0.16, tread = 0.36, area = 'Street' }) {
    const h = risers * rise;
    const w = V().crossVectors(V(0, 1, 0), dir).normalize();
    const origin = top.clone().addScaledVector(w, -width / 2).setY(0);
    const prof = [[0, h]];
    for (let i = 1; i < risers; i++) { prof.push([(i - 1) * tread, h - i * rise], [i * tread, h - i * rise]); }
    prof.push([(risers - 1) * tread, 0], [-0.4, 0], [-0.4, h]);
    extrude(P.precast, prof, { start: origin, dir: w, length: width });
    extrude(col(area), prof, { start: origin, dir: w, length: width });
    footprint([origin, origin.clone().addScaledVector(w, width), origin.clone().addScaledVector(dir, (risers - 1) * tread), origin.clone().addScaledVector(w, width).addScaledVector(dir, (risers - 1) * tread)]);
    // Nosings: a dark steel strip over each step's front edge (and the top edge of the landing).
    for (let i = 0; i < risers; i++) {
      const d = i * tread, y = h - i * rise;
      const a = origin.clone().addScaledVector(dir, d).setY(y);
      const lo = a.clone().addScaledVector(dir, -0.05).addScaledVector(V(0, 1, 0), -0.04);
      const hi = a.clone().addScaledVector(dir, 0.004).addScaledVector(w, width).setY(y + 0.004);
      box(P.graphite, V(Math.min(lo.x, hi.x), lo.y, Math.min(lo.z, hi.z)), V(Math.max(lo.x, hi.x), hi.y, Math.max(lo.z, hi.z)), { bottom: false });
    }
    // Height of the stair surface at a world point (for rail posts).
    return (x, z) => {
      const d = V(x - origin.x, 0, z - origin.z).dot(dir);
      if (d < 0) return h;
      const i = Math.floor(d / tread) + 1;
      return i >= risers ? 0 : h - i * rise;
    };
  }

  // Transition profiles. Quarter pipe rising along +d: flat run-in `lead`, radius `r` to vertical, `vert` of straight wall, `deck`.
  function quarterProfile({ r, vert = 0.2, deck = 2, lead = 0, steps = 40, lift = 0.004 }) {
    const pts = [];
    if (lead > 0) pts.push([0, lift]);
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI / 2;
      pts.push([lead + r * Math.sin(a), lift + r * (1 - Math.cos(a)), i > 0 && i < steps]);
    }
    const lipD = lead + r, lipY = lift + r + vert;
    if (vert > 0) pts.push([lipD, lipY]);
    pts.push([lipD + deck, lipY]);
    return { pts, lipD, lipY };
  }

  // Roll-in: from a deck at height H, over a rounded lip into a straight slope, then a long concave transition to the ground.
  function rollInProfile({ H, deck = 0, r1 = 2.5, slope = 26, r2 = 8, steps = 24 }) {
    const a = slope * Math.PI / 180;
    const pts = [];
    if (deck > 0) pts.push([-deck, H]);
    // convex lip: centre below the deck edge
    for (let i = 0; i <= steps / 2; i++) {
      const t = (i / (steps / 2)) * a;
      pts.push([r1 * Math.sin(t), H - r1 * (1 - Math.cos(t)), i > 0]);
    }
    const d1 = r1 * Math.sin(a), y1 = H - r1 * (1 - Math.cos(a));
    const y2 = r2 * (1 - Math.cos(a));                      // height where the concave transition starts
    const d2 = d1 + (y1 - y2) / Math.tan(a);
    for (let i = 0; i <= steps; i++) {
      const t = a * (1 - i / steps);
      pts.push([d2 + r2 * Math.sin(a) - r2 * Math.sin(t), r2 * (1 - Math.cos(t)) + 0.004, i < steps]);
    }
    return { pts, length: d2 + r2 * Math.sin(a) };
  }

  // ------------------------------------------------------------------ ground
  const bowlRect = { x0: 15, x1: 35, z0: 8, z1: 24 };
  const groundRects = [
    [-HALF.x, HALF.x, -HALF.z, bowlRect.z0],
    [-HALF.x, bowlRect.x0, bowlRect.z0, bowlRect.z1],
    [bowlRect.x1, HALF.x, bowlRect.z0, bowlRect.z1],
    [-HALF.x, HALF.x, bowlRect.z1, HALF.z]
  ];
  for (const [x0, x1, z0, z1] of groundRects) {
    quad(P.floor, V(x0, 0, z1), V(x1, 0, z1), V(x1, 0, z0), V(x0, 0, z0));
    quad(col('Ground'), V(x0, 0, z1), V(x1, 0, z1), V(x1, 0, z0), V(x0, 0, z0));
  }
  // The world beyond the wall: plain concrete apron out to the fog.
  const far = 160;
  for (const [x0, x1, z0, z1] of [[-far, far, -far, -HALF.z - 0.4], [-far, far, HALF.z + 0.4, far], [-far, -HALF.x - 0.4, -HALF.z - 0.4, HALF.z + 0.4], [HALF.x + 0.4, far, -HALF.z - 0.4, HALF.z + 0.4]]) {
    quad(P.apron, V(x0, 0, z1), V(x1, 0, z1), V(x1, 0, z0), V(x0, 0, z0));
  }
  // ------------------------------------------------------------------ perimeter: a seat-height wall, ledge on the inside
  const wallH = 0.5, wallT = 0.45;
  ledge('Perimeter_South', V(-HALF.x - wallT, 0, HALF.z), V(HALF.x + wallT, wallH, HALF.z + wallT), { area: 'Perimeter', edges: 0 });
  ledge('Perimeter_North', V(-29.5, 0, -HALF.z - wallT), V(HALF.x + wallT, wallH, -HALF.z), { area: 'Perimeter', edges: 1 });
  ledge('Perimeter_East', V(HALF.x, 0, -HALF.z), V(HALF.x + wallT, wallH, HALF.z), { area: 'Perimeter', edges: 0 });
  const bankEnd = -24 + rollInProfile({ H: TOWER_H, r1: 2, slope: 30, r2: 6 }).length;
  ledge('Perimeter_West', V(-HALF.x - wallT, 0, bankEnd), V(-HALF.x, wallH, HALF.z), { area: 'Perimeter', edges: 1 });   // starts where the tower's bank ends

  // ------------------------------------------------------------------ the start tower, its roll-in and the loop
  const towerH = TOWER_H;
  const tower = { x0: -HALF.x, x1: -29.6, z0: -HALF.z, z1: -24 };
  block(V(tower.x0, 0, tower.z0), V(tower.x1, towerH, tower.z1), { top: P.floor, side: P.precast, area: 'Tower' });
  // Parapets round the deck, leaving the two roll-ins open.
  const parapet = (x0, z0, x1, z1) => block(V(x0, towerH, z0), V(x1, towerH + 1.0, z1), { top: P.precast, side: P.precast, area: 'Tower' });
  parapet(tower.x0, tower.z0, tower.x1, tower.z0 + 0.3);                 // north
  parapet(tower.x0, tower.z0 + 0.3, tower.x0 + 0.3, tower.z1);           // west
  parapet(tower.x1 - 0.3, tower.z0 + 0.3, tower.x1, -33.2);              // east, north of the loop roll-in
  parapet(tower.x1 - 0.3, -26.8, tower.x1, tower.z1);                    // east, south of it
  parapet(-31.2, tower.z1 - 0.3, tower.x1 - 0.3, tower.z1);              // south, east of the bank roll-in
  // Railing along the parapets (just to look at: no grind lines up here), and the precast panel joints down the tower walls.
  {
    const y0 = towerH + 1.0, y1 = y0 + 0.75;
    const runs = [
      [V(tower.x0 + 0.15, 0, tower.z0 + 0.15), V(tower.x1 - 0.15, 0, tower.z0 + 0.15)],
      [V(tower.x0 + 0.15, 0, tower.z0 + 0.15), V(tower.x0 + 0.15, 0, tower.z1 - 0.15)],
      [V(tower.x1 - 0.15, 0, tower.z0 + 0.15), V(tower.x1 - 0.15, 0, -33.2)],
      [V(tower.x1 - 0.15, 0, -26.8), V(tower.x1 - 0.15, 0, tower.z1 - 0.15)]
    ];
    for (const [a, b] of runs) {
      tube(P.galv, [a.clone().setY(y1), b.clone().setY(y1)], 0.024, { segments: 10 });
      tube(P.galv, [a.clone().setY(y0 + 0.4), b.clone().setY(y0 + 0.4)], 0.016, { segments: 8 });
      const n = Math.max(1, Math.round(a.distanceTo(b) / 1.6));
      for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); tube(P.galv, [p.clone().setY(y0), p.clone().setY(y1)], 0.02, { segments: 8, caps: false }); }
    }
    const jointLine = (a, b, out) => {
      const d = V().subVectors(b, a).normalize(), w = V().crossVectors(d, out).normalize().multiplyScalar(0.007);
      const o = out.clone().multiplyScalar(0.003);
      quad(P.joint, a.clone().sub(w).add(o), a.clone().add(w).add(o), b.clone().add(w).add(o), b.clone().sub(w).add(o), { normal: out });
    };
    for (let z = tower.z0 + 2.4; z < tower.z1 - 0.5; z += 2.4) jointLine(V(tower.x1, 0.02, z), V(tower.x1, towerH, z), V(1, 0, 0));
    for (let x = tower.x0 + 2.4; x < tower.x1 - 0.5; x += 2.4) jointLine(V(x, 0.02, tower.z1), V(x, towerH, tower.z1), V(0, 0, 1));
    for (const y of [2.2, 4.4]) {
      jointLine(V(tower.x1, y, tower.z0), V(tower.x1, y, tower.z1), V(1, 0, 0));
      jointLine(V(tower.x0, y, tower.z1), V(tower.x1, y, tower.z1), V(0, 0, 1));
    }
  }
  // Loop roll-in: east off the deck, 26° with an 8 m transition, onto a 3 m run-up to the loop.
  const roll = rollInProfile({ H: towerH, r1: 2.5, slope: 26, r2: 8 });
  const rollStartX = tower.x1;
  rampBody(roll.pts, { origin: V(rollStartX, 0, -26.8), dir: V(1, 0, 0), width: 6.4, top: P.smooth, area: 'Tower', back: false, front: false });
  // yellow drop-in line at the lip
  quad(P.paint, V(rollStartX - 0.18, towerH + 0.002, -26.8), V(rollStartX - 0.06, towerH + 0.002, -26.8), V(rollStartX - 0.06, towerH + 0.002, -33.2), V(rollStartX - 0.18, towerH + 0.002, -33.2), { normal: V(0, 1, 0) });
  const loopStartX = rollStartX + roll.length + 3;
  // Bank roll-in: south off the deck, 30°, into the plaza.
  const bank = rollInProfile({ H: towerH, r1: 2, slope: 30, r2: 6 });
  rampBody(bank.pts, { origin: V(-HALF.x, 0, tower.z1), dir: V(0, 0, 1), width: HALF.x - 31.2, top: P.smooth, area: 'Tower', back: false, front: false });
  quad(P.paint, V(-31.2, towerH + 0.002, tower.z1 - 0.18), V(-31.2, towerH + 0.002, tower.z1 - 0.06), V(-HALF.x, towerH + 0.002, tower.z1 - 0.06), V(-HALF.x, towerH + 0.002, tower.z1 - 0.18), { normal: V(0, 1, 0) });

  // The loop itself.
  const LOOP = { length: 17, alpha: 0.7, shift: 2.8, width: 2.4, thick: 0.16 };
  const ribbon = loopRibbon({ start: [loopStartX, 0.004, -30], heading: -Math.PI / 2, length: LOOP.length, alpha: LOOP.alpha, shift: LOOP.shift, step: 0.1 });
  loops.push({ name: 'LOOP_Foundry', ...ribbon, width: LOOP.width });
  buildLoop(new LoopPath({ ...ribbon, width: LOOP.width }), LOOP);

  function buildLoop(path, L) {
    const n = path.p.length, half = L.width / 2, across = 6;
    footprint(path.p.flatMap((p, i) => [p.clone().addScaledVector(path.b[i], -half - 0.1), p.clone().addScaledVector(path.b[i], half + 0.1)]));
    // Thickness tapers to nothing at the two ends, where the track lies on the floor.
    const thick = (i) => L.thick * Math.min(1, path.s[i] / 1.2, (path.length - path.s[i]) / 1.2);
    const inner = [], outer = [];
    for (let i = 0; i < n; i++) {
      const rowI = [], rowO = [];
      for (let k = 0; k <= across; k++) {
        const l = -half + (k / across) * L.width;
        const p = path.p[i].clone().addScaledVector(path.b[i], l);
        rowI.push(p);
        rowO.push(p.clone().addScaledVector(path.n[i], -Math.max(thick(i), 0.01)));
      }
      inner.push(rowI); outer.push(rowO);
    }
    const grid = (target, rows, normalAt, flip, uvAt) => {
      const base = target.vertexCount, cols = rows[0].length;
      for (let i = 0; i < rows.length; i++) for (let k = 0; k < cols; k++) target.vert(rows[i][k], normalAt(i, k), uvAt ? uvAt(i, k) : [k / (cols - 1) * L.width / 2.4, path.s[i] / 2.4]);
      for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k + 1 < cols; k++) {
        const a = base + i * cols + k, b = a + 1, c = a + cols + 1, d = a + cols;
        // inner surface faces the normal: (row i, col k) → (row i, col k+1) → (row i+1, col k)…
        if (!flip) { target.tri(a, b, d); target.tri(b, c, d); } else { target.tri(a, d, b); target.tri(b, d, c); }
      }
    };
    // Which winding faces along +n: check once.
    const testN = faceNormal(inner[10][0], inner[10][1], inner[11][0]);
    const flipInner = testN.dot(path.n[10]) < 0;
    grid(P.ply, inner, (i) => path.n[i], flipInner);
    grid(col('Loop'), inner, (i) => path.n[i], flipInner);
    grid(P.orange, outer, (i) => path.n[i].clone().negate(), !flipInner, (i, k) => [k / across, path.s[i] / 2]);
    grid(col('Loop'), outer, (i) => path.n[i].clone().negate(), !flipInner);
    // Side faces between the inner and outer edges.
    for (const [k, sign] of [[0, -1], [across, 1]]) {
      const rows = inner.map((row, i) => [row[k], outer[i][k]]);
      const flipSide = faceNormal(rows[10][0], rows[10][1], rows[11][0]).dot(path.b[10].clone().multiplyScalar(sign)) < 0;
      grid(P.orange, rows, (i) => path.b[i].clone().multiplyScalar(sign), flipSide, (i, j) => [j * 0.1, path.s[i] / 2]);
      grid(col('Loop'), rows, (i) => path.b[i].clone().multiplyScalar(sign), flipSide);
      // a galvanised edge tube along the riding edge
      const edge = inner.map((row) => row[k].clone());
      tube(P.galv, edge.filter((_, i) => i % 2 === 0 || i === n - 1), 0.022, { segments: 8, caps: true });
    }
    // Ribs across the back of the track every metre or so, where it is off the ground.
    for (let s = 0.9; s < path.length - 0.9; s += 1.1) {
      const i = path.index(s);
      if (path.p[i].y < 0.35) continue;
      const c = path.p[i].clone().addScaledVector(path.n[i], -(thick(i) + 0.07));
      obox(P.orange, c, [path.b[i], path.n[i], path.t[i]], [half + 0.12, 0.07, 0.06]);
    }
    // Supports: columns standing clear of both lanes, arms out to the track's outer edges, a portal over the top.
    const right = path.b[0].clone();                         // the rider's right going in (towards the exit lane)
    const entryCentre = path.p[0].clone();
    const leftOff = -half - 0.75, rightOff = L.shift + half + 0.75;
    const atA = (i) => path.p[i].clone().sub(entryCentre).dot(V(1, 0, 0));    // along the loop line (it runs east)
    const iTop = path.p.reduce((best, p, i) => (p.y > path.p[best].y ? i : best), 0);
    const quarter = Math.round(n * 0.27), threeQ = Math.round(n * 0.73);
    const column = (along, lateral, h) => {
      const base = entryCentre.clone().add(V(along, 0, 0)).addScaledVector(right, lateral).setY(0);
      obox(P.orange, base.clone().setY(h / 2), [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)], [0.14, h / 2, 0.14]);
      box(P.graphite, base.clone().add(V(-0.3, 0, -0.3)), base.clone().add(V(0.3, 0.05, 0.3)), { bottom: false });
      box(col('Loop'), base.clone().add(V(-0.16, 0, -0.16)), base.clone().add(V(0.16, h, 0.16)), {});
      return base;
    };
    const beam = (a, b, size = 0.09) => {
      const c = a.clone().add(b).multiplyScalar(0.5), d = V().subVectors(b, a), len = d.length();
      d.normalize();
      const up = Math.abs(d.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
      const s = V().crossVectors(d, up).normalize(), u = V().crossVectors(s, d);
      obox(P.orange, c, [s, u, d], [size, size, len / 2]);
    };
    // top portal
    const topY = path.p[iTop].y + L.thick + 0.25;
    const lc = column(atA(iTop), leftOff, topY), rc = column(atA(iTop), rightOff, topY);
    beam(lc.clone().setY(topY), rc.clone().setY(topY), 0.12);
    // the first wall (going up) is held from the left, the second (coming down) from the right
    for (const [i, lateral, edgeK] of [[quarter, leftOff, 0], [threeQ, rightOff, across]]) {
      const h = path.p[i].y;
      const base = column(atA(i), lateral, h + 0.4);
      const edgePt = outer[i][edgeK];
      beam(base.clone().setY(h), edgePt, 0.08);
      beam(base.clone().setY(h + 0.35), path.p[iTop].clone().addScaledVector(path.b[iTop], (edgeK ? 1 : -1) * half).addScaledVector(path.n[iTop], -L.thick), 0.06);
    }
  }

  function obox(target, c, axes, h) {
    const [ax, ay, az] = axes.map((v) => v.clone().normalize());
    const corner = (sx, sy, sz) => c.clone().addScaledVector(ax, sx * h[0]).addScaledVector(ay, sy * h[1]).addScaledVector(az, sz * h[2]);
    const faces = [
      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], ax],
      [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1], ax.clone().negate()],
      [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1], ay],
      [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1], ay.clone().negate()],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], az],
      [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], az.clone().negate()]
    ];
    for (const [a, b, cc, d, n] of faces) {
      let pts = [corner(...a), corner(...b), corner(...cc), corner(...d)];
      if (faceNormal(pts[0], pts[1], pts[2]).dot(n) < 0) pts = pts.reverse();
      quad(target, pts[0], pts[1], pts[2], pts[3], { normal: n });
    }
  }

  // Run-out from the loop to a big quarter pipe at the east end.
  {
    const q = quarterProfile({ r: 3.0, vert: 0.3, deck: 2.6, lead: 0 });
    const ox = 24;
    rampBody(q.pts, { origin: V(ox, 0, -21), dir: V(1, 0, 0), width: 13.5, top: P.smooth, area: 'Quarter' });
    const lipX = ox + q.lipD, lipY = q.lipY;
    tube(P.galv, [V(lipX, lipY + 0.01, -21), V(lipX, lipY + 0.01, -34.5)], 0.035, { segments: 14 });
    addPath('BigQuarter_Coping', 'coping', [V(lipX, lipY + 0.01, -21.4), V(lipX, lipY + 0.01, -34.1)]);
  }
  // A smaller quarter on the east side, facing the mini ramp.
  {
    const q = quarterProfile({ r: 1.9, vert: 0.15, deck: 1.8 });
    const ox = 32.6;
    rampBody(q.pts, { origin: V(ox, 0, -2), dir: V(1, 0, 0), width: 12, top: P.smooth, area: 'Quarter' });
    const lipX = ox + q.lipD, lipY = q.lipY;
    tube(P.galv, [V(lipX, lipY + 0.01, -2), V(lipX, lipY + 0.01, -14)], 0.035, { segments: 14 });
    addPath('EastQuarter_Coping', 'coping', [V(lipX, lipY + 0.01, -2.4), V(lipX, lipY + 0.01, -13.6)]);
  }

  // ------------------------------------------------------------------ street: the Big Seven
  const U = { x0: -36, x1: -20, z0: -4, z1: 4, h: 1.12 };
  block(V(U.x0, 0, U.z0), V(U.x1, U.h, U.z1), { area: 'Street' });
  const seven = stairs({ top: V(-28.75, U.h, U.z1), dir: V(0, 0, 1), width: 8.5, risers: 7 });
  const sevenRail = (x) => {
    const pts = [V(x, 0, 3.7), V(x, 0, 6.65)].map((p) => p.setY(U.h - 0.444 * (p.z - 4) + 0.82));
    handrail(`SevenStairs_Handrail_${x < -30 ? 'W' : 'C'}`, pts, [V(x, 0, 3.85), V(x, 0, 5.1), V(x, 0, 6.5)], (px, pz) => seven(px, pz));
  };
  sevenRail(-32.6);
  sevenRail(-28.75);
  // Hubba down the east side of the seven.
  {
    const x0 = -24.5, x1 = -23.9, zTop = 2.8, zEdge = 4, zEnd = 6.36;
    const yTop = U.h + 0.45, yEnd = U.h - 0.444 * (zEnd - zEdge) + 0.45;
    const surf = [[zTop - zTop, yTop], [zEdge - zTop, yTop], [zEnd - zTop, yEnd]];
    rampBody(surf, { origin: V(x0, 0, zTop), dir: V(0, 0, 1), width: x1 - x0, top: P.precast, area: 'Street' });
    for (const [x, inward] of [[x0, 1], [x1, -1]]) {
      const pts = [V(x, yTop, zTop), V(x, yTop, zEdge), V(x, yEnd, zEnd)];
      tube(P.graphite, pts, 0.02, { segments: 8 });
      addPath(`BigSeven_Hubba_${inward > 0 ? 'W' : 'E'}`, 'ledge', pts.map((p) => p.clone().add(V(inward * 0.03, 0.007, 0))));
    }
  }
  // Bank up to the seven's deck from the east, and a ledge on the deck.
  rampBody([[0, U.h], ...bankFoot(U.h, 6)], { origin: V(U.x1, 0, U.z1), dir: V(1, 0, 0), width: U.z1 - U.z0, top: P.smooth, area: 'Street', back: false, front: false });
  ledge('BigSeven_DeckLedge', V(-35, U.h, -3.1), V(-29.5, U.h + 0.42, -2.55), { area: 'Street' });

  // ------------------------------------------------------------------ street: the five (faces east) with rail and hubba
  const M = { x0: -36, x1: -26, z0: 22, z1: HALF.z, h: 0.8 };
  block(V(M.x0, 0, M.z0), V(M.x1, M.h, M.z1), { area: 'Street' });
  const five = stairs({ top: V(M.x1, M.h, 27), dir: V(1, 0, 0), width: 6, risers: 5 });
  {
    const z = 24.35;
    const pts = [V(-26.3, 0, z), V(-24.25, 0, z)].map((p) => p.setY(M.h - 0.444 * (p.x - M.x1) + 0.8));
    handrail('FiveStairs_Handrail', pts, [V(-26.15, 0, z), V(-24.4, 0, z)], (px, pz) => five(px, pz));
    const x0 = -27.2, xEdge = M.x1, xEnd = -24.36, zl = 30, zr = 30.6;
    const yTop = M.h + 0.45, yEnd = M.h - 0.444 * (xEnd - xEdge) + 0.45;
    rampBody([[0, yTop], [xEdge - x0, yTop], [xEnd - x0, yEnd]], { origin: V(x0, 0, zr), dir: V(1, 0, 0), width: zr - zl, top: P.precast, area: 'Street' });
    for (const [zz, inward] of [[zl, 1], [zr, -1]]) {
      const p = [V(x0, yTop, zz), V(xEdge, yTop, zz), V(xEnd, yEnd, zz)];
      tube(P.graphite, p, 0.02, { segments: 8 });
      addPath(`Five_Hubba_${inward > 0 ? 'N' : 'S'}`, 'ledge', p.map((q) => q.clone().add(V(0, 0.007, inward * 0.03))));
    }
  }
  rampBody([[0, M.h], ...bankFoot(M.h, 5.5)], { origin: V(M.x1, 0, M.z0), dir: V(0, 0, -1), width: M.x1 - M.x0, top: P.smooth, area: 'Street', back: false, front: false });

  // ------------------------------------------------------------------ street: the three (faces north), centre rail
  const L3 = { x0: -14, x1: -6, z0: 26, z1: HALF.z, h: 0.48 };
  block(V(L3.x0, 0, L3.z0), V(L3.x1, L3.h, L3.z1), { area: 'Street' });
  const three = stairs({ top: V(-10, L3.h, L3.z0), dir: V(0, 0, -1), width: 5, risers: 3 });
  {
    const pts = [V(-10, 0, 26.9), V(-10, 0, 24.3)].map((p) => p.setY(L3.h - 0.444 * (L3.z0 - p.z) + 0.75));
    handrail('ThreeStairs_Handrail', pts, [V(-10, 0, 26.75), V(-10, 0, 25.5), V(-10, 0, 24.45)], (px, pz) => three(px, pz));
  }
  rampBody([[0, L3.h], ...bankFoot(L3.h, 4.2)], { origin: V(L3.x0, 0, L3.z0), dir: V(-1, 0, 0), width: L3.z1 - L3.z0, top: P.smooth, area: 'Street', back: false, front: false });

  // ------------------------------------------------------------------ street: flat stuff in the middle
  {
    // flat bar
    const pts = [V(-8, 0.36, 1.6), V(-8, 0.36, 9.4)];
    tube(P.galv, pts, 0.024);
    for (const z of [2, 5.5, 9]) { tube(P.galv, [V(-8, 0, z), V(-8, 0.34, z)], 0.022, { segments: 10 }); box(P.graphite, V(-8.08, 0, z - 0.08), V(-7.92, 0.012, z + 0.08), { bottom: false }); }
    addPath('FlatBar', 'rail', pts);
  }
  ledge('Long_Ledge', V(-2.3, 0, -6), V(-1.7, 0.45, 4));
  ledge('Manual_Pad', V(2, 0, 8), V(5.2, 0.2, 14));
  // Funbox: banks north and south, flat top, ledge edges along its sides, a kinked rail beside it.
  {
    const x0 = -5.5, x1 = -2.5, h = 0.75;
    const surf = [[0, 0.003], [2.8, h], [5.8, h], [8.6, 0.003]];
    rampBody(surf, { origin: V(x0, 0, 12), dir: V(0, 0, 1), width: x1 - x0, top: P.smooth, area: 'Street' });
    for (const [x, inward] of [[x0, 1], [x1, -1]]) {
      const pts = [V(x, 0.003, 12), V(x, h, 14.8), V(x, h, 17.8), V(x, 0.003, 20.6)];
      tube(P.graphite, pts, 0.018, { segments: 8 });
      addPath(`Funbox_Edge_${inward > 0 ? 'W' : 'E'}`, 'ledge', [V(x + inward * 0.03, h + 0.027, 14.8), V(x + inward * 0.03, h + 0.027, 17.8)]);
    }
    const rx = -1.85, ry = 0.38;
    const rail = [V(rx, ry, 11.2), V(rx, ry, 12.0), V(rx, h + ry, 14.8), V(rx, h + ry, 17.8), V(rx, ry, 20.6), V(rx, ry, 21.4)];
    handrail('Funbox_KinkRail', rail, [V(rx, 0, 11.4), V(rx, 0, 14.8), V(rx, 0, 17.8), V(rx, 0, 21.2)], () => 0);
  }
  // Kicker launching east towards the funbox.
  {
    const r = 2.8, a = 30 * Math.PI / 180, steps = 16;
    const surf = [];
    for (let i = 0; i <= steps; i++) { const t = (i / steps) * a; surf.push([r * Math.sin(t), 0.003 + r * (1 - Math.cos(t)), i > 0 && i < steps]); }
    rampBody(surf, { origin: V(-16, 0, 14.2), dir: V(1, 0, 0), width: 2.4, top: P.smooth, area: 'Street' });
    const lx = -16 + r * Math.sin(a), ly = 0.003 + r * (1 - Math.cos(a));
    box(P.graphite, V(lx - 0.04, ly - 0.04, 11.8), V(lx + 0.004, ly + 0.004, 14.2), {});
  }
  // Curved ledge: a quarter circle round (10, 32).
  {
    const c = V(10, 0, 32), r1 = 7, r0 = 6.45, h = 0.42, steps = 40;
    const ptsAt = (r, y) => arc(c.x, c.z, r, Math.PI, Math.PI * 1.5, steps).map(([x, z]) => V(x, y, z));
    const outerTop = ptsAt(r1, h), innerTop = ptsAt(r0, h), outerBot = ptsAt(r1, 0), innerBot = ptsAt(r0, 0);
    for (let i = 0; i < steps; i++) {
      const strip = (a, b, nrm) => {
        const n = nrm(i);
        const pts = [a[i], b[i], b[i + 1], a[i + 1]];
        const ok = faceNormal(pts[0], pts[1], pts[2]).dot(n) > 0 ? pts : pts.slice().reverse();
        quad(P.precast, ok[0], ok[1], ok[2], ok[3], { normal: n });
        quad(col('Street'), ok[0], ok[1], ok[2], ok[3], { normal: n });
      };
      const radial = (k) => V(outerTop[k].x - c.x, 0, outerTop[k].z - c.z).normalize();
      strip(innerTop, outerTop, () => V(0, 1, 0));
      footprint([outerBot[i], outerBot[i + 1], innerBot[i], innerBot[i + 1]]);
      strip(outerBot, outerTop, radial);
      strip(innerTop, innerBot, (k) => radial(k).negate());
    }
    for (const k of [0, steps]) {
      const pts = [innerBot[k], outerBot[k], outerTop[k], innerTop[k]];
      const n = V().subVectors(outerTop[k === 0 ? 1 : steps - 1], outerTop[k]).normalize().negate();
      polygon(P.precast, pts, n);
      polygon(col('Street'), pts, n);
    }
    tube(P.graphite, outerTop, 0.02, { segments: 8 });
    addPath('Curved_Ledge', 'ledge', ptsAt(r1 - 0.03, h + 0.027));
  }

  // ------------------------------------------------------------------ transition: mini half-pipe (ply)
  {
    const R = 1.7, vert = 0.12, flat = 3.6, deck = 2.0, H = R + vert + 0.02;
    // deck, a short vertical, then the transition down to the flat (circle centred at (deck + R, 0.02 + R))
    const surf = [[0, H], [deck, H]];
    for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI / 2; surf.push([deck + R - R * Math.cos(a), 0.02 + R - R * Math.sin(a), i > 0 && i < 32]); }
    const x2 = deck + R + flat;
    for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI / 2; surf.push([x2 + R * Math.sin(a), 0.02 + R * (1 - Math.cos(a)), i > 0 && i < 32]); }
    const lipE = x2 + R;
    surf.push([lipE, H], [lipE + deck, H]);
    const ox = 12, z0 = -4, width = 6;
    rampBody(surf, { origin: V(ox, 0, z0 + width), dir: V(1, 0, 0), width, top: P.ply, side: P.ply, area: 'Mini' });
    for (const lx of [ox + deck, ox + lipE]) {
      tube(P.galv, [V(lx, H + 0.01, z0), V(lx, H + 0.01, z0 + width)], 0.035, { segments: 14 });
      addPath(`Mini_Coping_${lx < ox + 5 ? 'W' : 'E'}`, 'coping', [V(lx, H + 0.01, z0 + 0.3), V(lx, H + 0.01, z0 + width - 0.3)]);
    }
  }

  // ------------------------------------------------------------------ transition: the bowl
  buildBowl({ cx: 25, cz: 16, hx: 7, hz: 5, rc: 3.0, R: 2.0, vert: 0.4, rect: bowlRect });

  function buildBowl({ cx, cz, hx, hz, rc, R, vert, rect }) {
    const D = R + vert;
    // Coping outline: a rounded rectangle, sampled counter-clockwise seen from above (x east, z south → angle from +x towards -z).
    const outline = [], outward = [];
    const corners = [[hx - rc, -(hz - rc), 0], [-(hx - rc), -(hz - rc), Math.PI / 2], [-(hx - rc), hz - rc, Math.PI], [hx - rc, hz - rc, Math.PI * 1.5]];
    const perStraight = (len) => Math.max(1, Math.ceil(len / 0.4));
    for (let c = 0; c < 4; c++) {
      const [ox, oz, a0] = corners[c];
      const steps = 20;
      for (let i = 0; i < steps; i++) {
        const a = a0 + (i / steps) * Math.PI / 2;
        outward.push(V(Math.cos(a), 0, -Math.sin(a)));
        outline.push(V(cx + ox + rc * Math.cos(a), 0, cz + oz - rc * Math.sin(a)));
      }
      // straight run to the next corner
      const [nx, nz, na] = corners[(c + 1) % 4];
      const a1 = a0 + Math.PI / 2;
      const from = V(cx + ox + rc * Math.cos(a1), 0, cz + oz - rc * Math.sin(a1));
      const to = V(cx + nx + rc * Math.cos(na), 0, cz + nz - rc * Math.sin(na));
      const k = perStraight(from.distanceTo(to));
      for (let i = 0; i < k; i++) { outline.push(from.clone().lerp(to, i / k)); outward.push(V(Math.cos(a1), 0, -Math.sin(a1))); }
    }
    // Wall profile, from the coping down: [inset, y, normal-in-profile (inward, up)], tile band at the top.
    const prof = [];
    const tileDepth = 0.16;
    prof.push([0, 0, 1, 0], [0, -tileDepth, 1, 0], [0, -vert, 1, 0]);
    for (let i = 1; i <= 26; i++) {
      const t = (i / 26) * Math.PI / 2;
      prof.push([R - R * Math.cos(t), -vert - R * Math.sin(t), Math.cos(t), Math.sin(t)]);
    }
    const rows = outline.map((c, j) => prof.map(([inset, y]) => c.clone().addScaledVector(outward[j], -inset).setY(y)));
    const nrm = (j, k) => outward[j].clone().multiplyScalar(-prof[k][2]).add(V(0, prof[k][3], 0)).normalize();
    const wallGrid = (target, k0, k1, uvs = true) => {
      const base = target.vertexCount;
      const m = outline.length;
      let around = 0;
      for (let j = 0; j <= m; j++) {
        const jj = j % m;
        if (j > 0) around += outline[jj].distanceTo(outline[j - 1]);
        let down = 0;
        for (let k = k0; k <= k1; k++) {
          if (k > k0) down += rows[jj][k].distanceTo(rows[jj][k - 1]);
          target.vert(rows[jj][k], nrm(jj, k), uvs ? [around / target.uvScale, down / target.uvScale] : undefined);
        }
      }
      const cols = k1 - k0 + 1;
      // orientation check on the first quad
      const a = rows[0][k0], b = rows[0][k0 + 1], d = rows[1][k0];
      const flip = faceNormal(a, b, d).dot(nrm(0, k0)) < 0;
      for (let j = 0; j < m; j++) for (let k = 0; k < cols - 1; k++) {
        const i0 = base + j * cols + k, i1 = i0 + 1, i2 = i0 + cols, i3 = i2 + 1;
        if (!flip) { target.tri(i0, i1, i2); target.tri(i1, i3, i2); } else { target.tri(i0, i2, i1); target.tri(i1, i2, i3); }
      }
    };
    wallGrid(P.tile, 0, 1);
    wallGrid(P.smooth, 1, prof.length - 1);
    wallGrid(col('Bowl'), 0, prof.length - 1, false);
    // Floor.
    const floorPts = rows.map((r) => r[prof.length - 1].clone());
    polygon(P.smooth, floorPts, V(0, 1, 0));
    polygon(col('Bowl'), floorPts, V(0, 1, 0));
    // Deck: a 1 m band round the coping, then fill out to the rectangle the plaza leaves for it.
    // Rings close together near the coping, so the shading under its lip stays there.
    const rings = [0, 0.05, 0.14, 0.3, 0.55, 1.0];
    const deckRows = outline.map((c, j) => rings.map((r) => c.clone().addScaledVector(outward[j], r)));
    for (const target of [P.floor, col('Bowl')]) {
      const base = target.vertexCount, m = outline.length, w = rings.length;
      for (let j = 0; j < m; j++) for (const p of deckRows[j]) target.vert(p, V(0, 1, 0));
      const fl = faceNormal(deckRows[0][0], deckRows[0][1], deckRows[1][0]).y < 0;
      for (let j = 0; j < m; j++) for (let r = 0; r + 1 < w; r++) {
        const a = base + j * w + r, b = base + ((j + 1) % m) * w + r;
        if (!fl) { target.tri(a, a + 1, b); target.tri(a + 1, b + 1, b); } else { target.tri(a, b, a + 1); target.tri(a + 1, b, b + 1); }
      }
    }
    // Between the band and the rectangle: a frame of four pieces, each a polygon following the band's outer edge.
    const outer = deckRows.map((r) => r[r.length - 1]);
    const rx0 = rect.x0, rx1 = rect.x1, rz0 = rect.z0, rz1 = rect.z1;
    // Fan from the band's outer edge out to the rectangle by projecting each point to the nearest rectangle side
    // along its outward normal's dominant axis, and fill the four corners with triangles.
    const proj = outer.map((p, j) => {
      const o = outward[j];
      if (Math.abs(o.x) >= Math.abs(o.z)) return V(o.x > 0 ? rx1 : rx0, 0, p.z);
      return V(p.x, 0, o.z > 0 ? rz1 : rz0);
    });
    for (const target of [P.floor, col('Bowl')]) {
      const m = outer.length;
      for (let j = 0; j < m; j++) {
        const k = (j + 1) % m;
        const a = outer[j], b = outer[k], c2 = proj[k], d = proj[j];
        // Where the projection switches sides (at 45° on a corner) the gap is a corner of the rectangle.
        const sameSide = (Math.abs(outward[j].x) >= Math.abs(outward[j].z)) === (Math.abs(outward[k].x) >= Math.abs(outward[k].z));
        if (sameSide) polygon(target, ensureUp([a, b, c2, d]), V(0, 1, 0));
        else {
          const corner = V(Math.abs(d.x - rx0) < 1e-6 || Math.abs(c2.x - rx0) < 1e-6 ? rx0 : rx1, 0, Math.abs(d.z - rz0) < 1e-6 || Math.abs(c2.z - rz0) < 1e-6 ? rz0 : rz1);
          polygon(target, ensureUp([a, b, c2, corner, d]), V(0, 1, 0));
        }
      }
    }
    // Coping all the way round, and its grind line.
    const cop = outline.map((p) => p.clone().setY(0.01));
    tube(P.galv, [...cop, cop[0]], 0.035, { segments: 12, caps: false });
    addPath('Bowl_Coping', 'coping', cop, { closed: true });
  }

  function ensureUp(pts) {
    // drop repeated points and order counter-clockwise seen from above
    const out = pts.filter((p, i) => p.distanceTo(pts[(i + 1) % pts.length]) > 1e-5);
    let area = 0;
    for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; area += a.x * b.z - b.x * a.z; }
    return area > 0 ? out.reverse() : out;
  }

  // A bank from (0, h) straight down to the ground at d = run, with the corner at the bottom rounded off (radius `foot`).
  function bankFoot(h, run, foot = 1.5, steps = 10) {
    const a = Math.atan2(h, run);
    const T = foot * Math.tan(a / 2);                         // the round touches the slope and the ground this far from the corner
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = a * (1 - i / steps);                         // surface angle: a where the round starts, 0 on the ground
      pts.push([run + T - foot * Math.sin(t), foot * (1 - Math.cos(t)) + 0.003, i > 0 && i < steps]);
    }
    return pts;
  }

  // ------------------------------------------------------------------ floodlights (just the masts)
  for (const [x, z] of [[38.4, 34.4], [-38.4, 34.4], [38.4, -34.4]]) {
    tube(P.graphite, [V(x, 0, z), V(x, 11, z)], 0.14, { segments: 12 });
    obox(P.graphite, V(x, 11.2, z), [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)], [0.9, 0.25, 0.25]);
    box(col('Perimeter'), V(x - 0.16, 0, z - 0.16), V(x + 0.16, 3, z + 0.16), {});
  }

  // Saw-cut joints every 4 m (a decal: the game pulls these towards the camera so they never fight the slab).
  const jointW = 0.012, jy = 0.0015;
  const inBowl = (x, z) => (x > bowlRect.x0 - 0.01 && x < bowlRect.x1 + 0.01 && z > bowlRect.z0 - 0.01 && z < bowlRect.z1 + 0.01) ||
    footprints.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
  const jointRun = (a, b) => {   // a, b: Vector3 on the floor; split around the bowl
    const n = Math.ceil(a.distanceTo(b) / 0.1);
    let runStart = null;
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      const inside = inBowl(p.x, p.z);
      if (!inside && runStart === null) runStart = p;
      if ((inside || i === n) && runStart) {
        const end = inside ? a.clone().lerp(b, (i - 1) / n) : p;
        if (end.distanceTo(runStart) > 0.1) {
          const dirv = V().subVectors(end, runStart).normalize(), w = V(-dirv.z, 0, dirv.x).multiplyScalar(jointW / 2);
          quad(P.joint, runStart.clone().sub(w).setY(jy), runStart.clone().add(w).setY(jy), end.clone().add(w).setY(jy), end.clone().sub(w).setY(jy), { normal: V(0, 1, 0) });
        }
        runStart = null;
      }
    }
  };
  for (let x = -36; x <= 36; x += 4) jointRun(V(x, 0, HALF.z), V(x, 0, -HALF.z));
  for (let z = -32; z <= 32; z += 4) jointRun(V(-HALF.x, 0, z), V(HALF.x, 0, z));

  // ------------------------------------------------------------------ spawns
  spawns.push({ name: 'Spawn_Entrance', pos: V(-34.8, towerH, -30), heading: -Math.PI / 2 });
  spawns.push({ name: 'Spawn_Plaza', pos: V(0, 0, 30), heading: 0 });

  return { parts, cols, paths, loops, spawns, bounds: { x: HALF.x - 0.05, z: HALF.z - 0.05, cx: 0, cz: 0 } };
}
