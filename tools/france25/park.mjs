// France 25 stair, rebuilt from code after the reference photos (node tools/build-level.mjs france25). A sunken courtyard: the 25-stair
// runs down from an upper plaza to a lower one along a long terracotta-clad building; on its other side a cheek wall with a rail, and
// beyond that a big slanted bank of stone panels up to the street, with a walkway and railing along its top. At the back of the upper
// plaza a flight of stairs climbs to that same walkway, so nothing leads into nothing.
// x is east, z is south, y is up; you start on the upper plaza facing −z, down the stairs.
import * as THREE from 'three';
import sharp from 'sharp';
import { V, Part, quad, polygon, box, roundedBox, extrude, tube, faceNormal } from '../foundry/geom.mjs';

export const MATERIALS = {
  pavers: { name: 'Stone | small square courtyard pavers / 2m', textures: 'gen:pavers', uvScale: 2.0, color: [1, 1, 1, 1], vary: 0.12, maxEdge: 0.9 },
  limestone: { name: 'Stone | pale limestone stair slabs / 2m', textures: 'concrete_floor', uvScale: 2.0, color: [1, 1, 1, 1], vary: 0.1 },
  bank: { name: 'Stone | slanted bank panels / 3m', textures: 'concrete_floor', uvScale: 3.0, color: [0.93, 0.92, 0.9, 1], vary: 0.14, maxEdge: 0.8 },
  terracotta: { name: 'Brick | terracotta rainscreen / 2.4m', textures: 'gen:terracotta', uvScale: 2.4, color: [1, 1, 1, 1], vary: 0.08, maxEdge: 1.6 },
  concrete: { name: 'Concrete | smooth overhang and walkway / 2.5m', textures: 'garage_floor', uvScale: 2.5, color: [1, 1, 1, 1], vary: 0.1, maxEdge: 1.0 },
  glass: { name: 'Glass | smoky green glazing', color: [0.07, 0.11, 0.1, 1], metallic: 0.85, roughness: 0.06, uvScale: 1, maxEdge: 1e9 },
  frame: { name: 'Steel | dark grey frames', color: [0.13, 0.13, 0.14, 1], metallic: 0.6, roughness: 0.45, uvScale: 1 },
  rail: { name: 'Steel | satin grey rails', color: [0.5, 0.52, 0.54, 1], metallic: 0.9, roughness: 0.35, uvScale: 1 },
  timber: { name: 'Timber | bench slats / 1m', textures: 'plywood', uvScale: 1.2, color: [0.75, 0.62, 0.5, 1] },
  grass: { name: 'Landscape | planter grass', color: [0.2, 0.3, 0.12, 1], metallic: 0, roughness: 0.95, uvScale: 1, maxEdge: 1.0 },
  joint: { name: 'Construction | panel joints', color: [0.18, 0.17, 0.16, 1], metallic: 0, roughness: 0.95, uvScale: 1, maxEdge: 1e9, decal: true }
};

// Colour grading of the photo textures (build-level.mjs): pale limestone, and the ply as bench timber.
export const GRADE = {
  concrete_floor: { saturation: 0.35, mean: [206, 200, 188] },
  garage_floor: { saturation: 0.35, mean: [190, 188, 182] },
  plywood: { saturation: 0.9, mean: [170, 130, 92] }
};

// ---------------------------------------------------------------- textures made in code
const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
function smooth(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(hash(xi, yi), hash(xi + 1, yi), u), l(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
// height field + colour → { base, normal, orm } PNGs (normal map OpenGL-style, green up).
async function encode(size, colour, height, rough, strength) {
  const base = Buffer.alloc(size * size * 3), nor = Buffer.alloc(size * size * 3), orm = Buffer.alloc(size * size * 3);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    base[i * 3] = colour[i * 3]; base[i * 3 + 1] = colour[i * 3 + 1]; base[i * 3 + 2] = colour[i * 3 + 2];
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    nor[i * 3] = Math.round((-dx / len * 0.5 + 0.5) * 255);
    nor[i * 3 + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
    nor[i * 3 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
    orm[i * 3] = Math.round(255 * (0.75 + 0.25 * height[i]));   // a little occlusion in the grooves
    orm[i * 3 + 1] = Math.round(255 * rough[i]);
    orm[i * 3 + 2] = 0;
  }
  const png = (buf) => sharp(buf, { raw: { width: size, height: size, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
  return { base: await png(base), normal: await png(nor), orm: await png(orm) };
}

export const TEXTURES = {
  // Terracotta rainscreen (one repeat = 2.4 m square): horizontal baguettes 0.3 m tall with dark gaps, aluminium joints every 1.2 m.
  async terracotta() {
    const size = 1024, px = size / 2.4;
    const colour = new Uint8Array(size * size * 3), height = new Float32Array(size * size), rough = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, m = y / px, row = Math.floor(m / 0.3), inRow = m - row * 0.3, col = Math.floor((x / px) / 1.2);
      const xm = (x / px) % 1.2;
      const gap = inRow < 0.022, joint = xm < 0.018 || xm > 1.2 - 0.004;
      const tone = 0.9 + 0.2 * hash(row, col) + 0.08 * (smooth(x / 9, y / 50) - 0.5) + 0.05 * (hash(x, y) - 0.5);
      // each baguette is slightly rounded across its height (lit top, shaded underside)
      const across = gap ? 0 : Math.sin(Math.PI * Math.min(1, (inRow - 0.022) / (0.3 - 0.022)));
      let r = 196 * tone, g = 92 * tone, b = 52 * tone;
      if (gap) { r = 62; g = 34; b = 24; }
      if (joint && !gap) { r = 92; g = 84; b = 78; }
      colour[i * 3] = Math.min(255, r); colour[i * 3 + 1] = Math.min(255, g); colour[i * 3 + 2] = Math.min(255, b);
      height[i] = gap ? 0 : joint ? 0.55 : 0.6 + 0.4 * across;
      rough[i] = joint ? 0.45 : 0.72;
    }
    return encode(size, colour, height, rough, 2.2);
  },
  // Small square pavers (one repeat = 2 m): 0.2 m stones, each its own pale tone, in dark-ish joints.
  async pavers() {
    const size = 1024, px = size / 2.0;
    const colour = new Uint8Array(size * size * 3), height = new Float32Array(size * size), rough = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, mx = x / px, my = y / px, cx = Math.floor(mx / 0.2), cy = Math.floor(my / 0.2);
      const fx = mx / 0.2 - cx, fy = my / 0.2 - cy;
      const edge = Math.min(fx, fy, 1 - fx, 1 - fy) * 0.2;           // metres to the stone's edge
      const joint = edge < 0.006;
      const tone = 0.88 + 0.16 * hash(cx, cy) + 0.06 * (hash(x, y) - 0.5) + 0.06 * (smooth(x / 40, y / 40) - 0.5);
      let r = 200 * tone, g = 194 * tone, b = 182 * tone;
      if (joint) { r = 118; g = 112; b = 102; }
      colour[i * 3] = Math.min(255, r); colour[i * 3 + 1] = Math.min(255, g); colour[i * 3 + 2] = Math.min(255, b);
      height[i] = joint ? 0 : Math.min(1, 0.4 + edge / 0.02);
      rough[i] = 0.82 + 0.1 * hash(cx + 7, cy);
    }
    return encode(size, colour, height, rough, 1.6);
  }
};

// ---------------------------------------------------------------- the layout
export const SIZE = {
  risers: 25, rise: 0.15, tread: 0.4,          // the 25: 3.75 m down over 9.6 m
  stairX0: -0.5, stairX1: 12.0,                // the stairs fill the courtyard from the building to the cheek wall
  cheekX1: 12.6,                               // the cheek wall, then the bank
  bankTopX: 19.0, street: 8.5,                 // the bank rises to the street walkway (y 8.5) at x 19
  walkX1: 25.5,
  facadeX: -0.5,
  zFront: -34, zBack: 30, zRear: 40            // lower plaza front edge; back of the upper plaza; the walkway behind it
};

export function buildPark() {
  const S = SIZE, H = S.risers * S.rise, run = (S.risers - 1) * S.tread;   // H 3.75; the last riser at z = −9.6
  const parts = {};
  for (const [key, m] of Object.entries(MATERIALS)) parts[key] = new Part(m.name, { uvScale: m.uvScale, maxEdge: m.maxEdge ?? 0.5 });
  const cols = {};
  const col = (area) => (cols[area] ??= new Part(`COL_${area}`, { collision: true }));
  const P = parts, paths = [], spawns = [];
  const addPath = (name, kind, pts, radius = kind === 'rail' ? 0.024 : 0.03) =>
    paths.push({ name: `PATH_${name}`, kind, closed: false, radius, points: pts.flatMap((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]) });
  // A quad (or polygon) facing `n`, whichever order its corners come in.
  const face = (part, pts, n) => {
    const ok = faceNormal(pts[0], pts[1], pts[2]).dot(n) >= 0 ? pts : pts.slice().reverse();
    if (ok.length === 4) quad(part, ok[0], ok[1], ok[2], ok[3], { normal: n }); else polygon(part, ok, n);
  };
  const both = (part, area, pts, n) => { face(part, pts, n); if (area) face(col(area), pts, n); };
  const plain = (lo, hi, area, part = P.pavers, sides = P.limestone) => {
    box(part, lo, hi, { sides: false });
    box(sides, lo, hi, { top: false });
    if (area) box(col(area), lo, hi, {});
  };

  // ---------------------------------------------------------------- ground: lower plaza, upper plaza
  const yStairEnd = 0;
  both(P.pavers, 'Lower', [V(S.facadeX, 0, -run), V(S.cheekX1, 0, -run), V(S.cheekX1, 0, S.zFront), V(S.facadeX, 0, S.zFront)], V(0, 1, 0));
  // The upper plaza is a solid platform: its top, and the face that the stairs do not cover is hidden in the bank and the building.
  both(P.pavers, 'Upper', [V(S.facadeX, H, 0), V(S.cheekX1, H, 0), V(S.cheekX1, H, S.zBack), V(S.facadeX, H, S.zBack)], V(0, 1, 0));
  box(col('Upper'), V(S.facadeX, 0, 0), V(S.cheekX1, H, S.zBack), {});

  // ---------------------------------------------------------------- the 25
  {
    const prof = [[0, H]];
    for (let i = 1; i < S.risers; i++) prof.push([(i - 1) * S.tread, H - i * S.rise], [i * S.tread, H - i * S.rise]);
    prof.push([run, yStairEnd], [-0.3, 0], [-0.3, H]);
    const dir = V(0, 0, -1), w = V().crossVectors(V(0, 1, 0), dir).normalize();   // w = −x
    const origin = V(S.stairX1, 0, 0);
    extrude(P.limestone, prof, { start: origin, dir: w, length: S.stairX1 - S.stairX0 });
    extrude(col('Stairs'), prof, { start: origin, dir: w, length: S.stairX1 - S.stairX0 });
  }
  const nosingY = (z) => H + z * (S.rise / S.tread);         // the line through the step edges, for z from 0 down to −9.6

  // Cheek wall down the right side of the stairs, a ledge 0.4 m over the nosings, with the handrail on it.
  {
    const top = 0.4, z0 = 0.6, z1 = -run - 0.5;
    const yAt = (z) => (z > 0 ? H + top : Math.max(top, nosingY(z) + top));
    const zs = [z0, 0]; for (let k = 1; k <= 12; k++) zs.push(-run * k / 12); zs.push(z1);
    const pts = zs.map((z) => [z, yAt(z)]);
    for (const [x, n] of [[S.stairX1, V(-1, 0, 0)], [S.cheekX1, V(1, 0, 0)]]) {
      const outline = [...pts.map(([z, y]) => V(x, y, z)), V(x, 0, z1), V(x, 0, z0)];
      both(P.limestone, 'Cheek', outline, n);
    }
    for (let k = 0; k + 1 < pts.length; k++) {
      const [za, ya] = pts[k], [zb, yb] = pts[k + 1];
      const n = faceNormal(V(S.stairX1, ya, za), V(S.cheekX1, ya, za), V(S.stairX1, yb, zb));
      both(P.limestone, 'Cheek', [V(S.stairX1, ya, za), V(S.cheekX1, ya, za), V(S.cheekX1, yb, zb), V(S.stairX1, yb, zb)], n.y < 0 ? n.negate() : n);
    }
    both(P.limestone, 'Cheek', [V(S.stairX1, 0, z1), V(S.cheekX1, 0, z1), V(S.cheekX1, yAt(z1), z1), V(S.stairX1, yAt(z1), z1)], V(0, 0, -1));
    addPath('Cheek_Ledge', 'ledge', pts.map(([z, y]) => V(S.stairX1 + 0.03, y + 0.027, z)));
    // handrail posts on the wall, the rail 0.85 m above it
    const rx = (S.stairX1 + S.cheekX1) / 2, rail = pts.map(([z, y]) => V(rx, y + 0.85, z));
    tube(P.rail, rail, 0.024, { segments: 12 });
    for (const z of [z0 - 0.1, -run * 0.33, -run * 0.66, z1 + 0.1]) tube(P.rail, [V(rx, yAt(z), z), V(rx, yAt(z) + 0.83, z)], 0.02, { segments: 10 });
    addPath('MainStairs_Handrail', 'rail', rail);
  }

  // ---------------------------------------------------------------- the slanted bank up to the street
  // A ruled surface from its foot (the plaza edge, coming down with the stairs) to its top edge along the street at x = 19.
  {
    const footY = (z) => (z >= 0 ? H : z <= -run ? 0 : H * (1 + z / run));
    const zs = [];
    for (let z = S.zFront; z < S.zRear; z += 0.5) zs.push(z);
    zs.push(S.zRear);
    const across = 10;
    const at = (z, k) => { const f = k / across; return V(S.cheekX1 + (S.bankTopX - S.cheekX1) * f, footY(z) + (S.street - footY(z)) * f, z); };
    for (const target of [P.bank, col('Bank')]) {
      const base = target.vertexCount;
      for (const z of zs) for (let k = 0; k <= across; k++) {
        const p = at(z, k);
        const n = V(-(S.street - footY(z)), S.bankTopX - S.cheekX1, 0).normalize();
        target.vert(p, n, [z / 3, (k / across) * Math.hypot(S.street - footY(z), S.bankTopX - S.cheekX1) / 3]);
      }
      const row = across + 1;
      for (let i = 0; i + 1 < zs.length; i++) for (let k = 0; k < across; k++) {
        const a = base + i * row + k, b = a + 1, c = a + row + 1, d = a + row;
        const n = faceNormal(at(zs[i], k), at(zs[i], k + 1), at(zs[i + 1], k));
        if (n.x < 0) { target.tri(a, b, d); target.tri(b, c, d); } else { target.tri(a, d, b); target.tri(b, d, c); }
      }
    }
    // Diagonal panel joints, laid on the surface (a decal): every 4 m, rising towards +z.
    for (let z0 = S.zFront - 6; z0 < S.zRear; z0 += 4) {
      const seg = [];
      for (let k = 0; k <= across; k++) { const z = z0 + 6 * k / across; if (z < S.zFront || z > S.zRear) continue; seg.push(at(z, k)); }
      for (let k = 0; k + 1 < seg.length; k++) {
        const a = seg[k], b = seg[k + 1], n = V(-(S.street - footY(a.z)), S.bankTopX - S.cheekX1, 0).normalize();
        const side = V().crossVectors(V().subVectors(b, a).normalize(), n).multiplyScalar(0.012);
        const o = n.clone().multiplyScalar(0.004);
        face(P.joint, [a.clone().sub(side).add(o), a.clone().add(side).add(o), b.clone().add(side).add(o), b.clone().sub(side).add(o)], n);
      }
    }
    // Horizontal joint at the foot of the panels, and a stone kerb where the bank meets the plaza.
    // The street walkway along the top, and its railing on the bank edge.
    both(P.concrete, 'Street', [V(S.bankTopX, S.street, S.zFront), V(S.walkX1, S.street, S.zFront), V(S.walkX1, S.street, S.zRear), V(S.bankTopX, S.street, S.zRear)], V(0, 1, 0));
    box(P.limestone, V(S.bankTopX, 0, S.zFront), V(S.walkX1, S.street, S.zFront + 0.01), { top: false });
    const posts = [];
    for (let z = S.zFront + 0.2; z <= S.zBack - 0.2; z += 1.8) posts.push(z);
    for (const z of posts) tube(P.frame, [V(S.bankTopX + 0.1, S.street, z), V(S.bankTopX + 0.1, S.street + 1.0, z)], 0.025, { segments: 8 });
    tube(P.rail, [V(S.bankTopX + 0.1, S.street + 1.0, S.zFront + 0.2), V(S.bankTopX + 0.1, S.street + 1.0, S.zBack - 0.2)], 0.028, { segments: 10 });
    tube(P.frame, [V(S.bankTopX + 0.1, S.street + 0.5, S.zFront + 0.2), V(S.bankTopX + 0.1, S.street + 0.5, S.zBack - 0.2)], 0.015, { segments: 6 });
    box(col('Street'), V(S.bankTopX + 0.05, S.street, S.zFront), V(S.bankTopX + 0.15, S.street + 1.0, S.zBack - 0.2), {});
  }

  // ---------------------------------------------------------------- the back: stairs up to the street, and a retaining wall
  {
    const x0 = 9.4, x1 = S.cheekX1, rise = 0.16, tread = 0.32, n = Math.round((S.street - H) / rise);
    const prof = [[0, H]];
    for (let i = 1; i <= n; i++) prof.push([(i - 1) * tread, H + i * rise], [i * tread, H + i * rise]);
    const len = n * tread;
    prof.push([len, H], [0, H]);
    // runs +z from the back of the upper plaza; extrude across x
    const dir = V(0, 0, 1), w = V().crossVectors(V(0, 1, 0), dir).normalize();   // +x
    extrude(P.limestone, prof, { start: V(x0, 0, S.zBack), dir: w, length: x1 - x0 });
    extrude(col('Rear'), prof, { start: V(x0, 0, S.zBack), dir: w, length: x1 - x0 });
    const zTop = S.zBack + len;
    // the walkway behind, joining the street walkway along the bank top
    both(P.concrete, 'Rear', [V(S.facadeX, S.street, zTop), V(S.walkX1, S.street, zTop), V(S.walkX1, S.street, S.zRear + 6), V(S.facadeX, S.street, S.zRear + 6)], V(0, 1, 0));
    both(P.concrete, 'Rear', [V(S.cheekX1, S.street, S.zBack), V(S.bankTopX, S.street, S.zBack), V(S.bankTopX, S.street, zTop), V(S.cheekX1, S.street, zTop)], V(0, 1, 0));
    // retaining wall beside the stairs, from the building to the stairs, up to the walkway
    plain(V(S.facadeX, H, S.zBack), V(x0, S.street, zTop), 'Rear', P.concrete, P.limestone);
    box(col('Rear'), V(x1, H, S.zBack), V(S.bankTopX, S.street, zTop), {});
    plain(V(x1, H, S.zBack), V(S.bankTopX, S.street, zTop), null, P.concrete, P.limestone);
    // the stair's handrails
    for (const x of [x0 + 0.15, x1 - 0.15]) {
      const r = [V(x, H + 0.9, S.zBack - 0.3), V(x, S.street + 0.9, zTop + 0.2)];
      tube(P.rail, r, 0.024, { segments: 10 });
      for (const t of [0.05, 0.5, 0.95]) { const p = r[0].clone().lerp(r[1], t); tube(P.frame, [V(x, Math.max(H, p.y - 0.9 + 0.02), p.z), p.clone().setY(p.y - 0.02)], 0.02, { segments: 8 }); }
      addPath(`RearStairs_Handrail_${x < 10 ? 'W' : 'E'}`, 'rail', r);
    }
    // a planter with a little grass against the retaining wall
    plain(V(2, H, S.zBack - 3.2), V(6, H + 0.45, S.zBack - 0.01), 'Planter', P.limestone, P.limestone);
    box(P.grass, V(2.15, H + 0.4, S.zBack - 3.05), V(5.85, H + 0.43, S.zBack - 0.16), { sides: false });
    addPath('Planter_Edge', 'ledge', [V(2.03, H + 0.477, S.zBack - 3.17), V(5.97, H + 0.477, S.zBack - 3.17)]);
  }

  // ---------------------------------------------------------------- benches on the upper plaza, by the bank
  for (const z of [7, 15, 23]) {
    const x0 = S.cheekX1 - 1.1, x1 = x0 + 0.5, z0 = z, z1 = z + 2.2, y = H;
    roundedBox(P.limestone, V(x0, y, z0), V(x1, y + 0.38, z0 + 0.35), 0.02);
    roundedBox(P.limestone, V(x0, y, z1 - 0.35), V(x1, y + 0.38, z1), 0.02);
    roundedBox(P.timber, V(x0 - 0.02, y + 0.38, z0 - 0.05), V(x1 + 0.02, y + 0.46, z1 + 0.05), 0.012);
    box(col('Benches'), V(x0 - 0.02, y, z0 - 0.05), V(x1 + 0.02, y + 0.46, z1 + 0.05), {});
    addPath(`Bench_${z}`, 'ledge', [V(x0 + 0.01, y + 0.487, z0 - 0.03), V(x0 + 0.01, y + 0.487, z1 + 0.03)]);
  }
  // a low stone ledge closing the front of the lower plaza
  roundedBox(P.limestone, V(S.facadeX, 0, S.zFront), V(S.cheekX1, 0.45, S.zFront + 0.5), 0.03);
  box(col('Lower'), V(S.facadeX, 0, S.zFront), V(S.cheekX1, 0.45, S.zFront + 0.5), {});
  addPath('Front_Ledge', 'ledge', [V(S.facadeX + 0.3, 0.477, S.zFront + 0.47), V(S.cheekX1 - 0.3, 0.477, S.zFront + 0.47)]);

  // ---------------------------------------------------------------- the building
  buildFacade();
  function buildFacade() {
    const x = S.facadeX, top = 18, z0 = S.zFront, z1 = S.zRear + 6;
    const groundTop = (z) => (z < 0 ? 0 : H);
    // Ground floor: recessed glazing under a soffit, mullions every 1.5 m; lower plaza and upper plaza each have their own.
    for (const [za, zb, y0] of [[z0, -run, 0], [-run, 0, null], [0, S.zBack, H]]) {
      if (y0 === null) {
        // beside the stairs the building's base is solid terracotta down to the steps
        both(P.terracotta, 'Building', [V(x, 0, za), V(x, 0, zb), V(x, H + 3.4, zb), V(x, H + 3.4, za)], V(1, 0, 0));
        continue;
      }
      const y1 = y0 + 3.4, inset = 0.9;
      both(P.glass, null, [V(x - inset, y0, za), V(x - inset, y0, zb), V(x - inset, y1, zb), V(x - inset, y1, za)], V(1, 0, 0));
      face(P.concrete, [V(x - inset, y1, za), V(x, y1, za), V(x, y1, zb), V(x - inset, y1, zb)], V(0, -1, 0));   // soffit
      face(P.pavers, [V(x - inset, y0, za), V(x - inset, y0, zb), V(x, y0, zb), V(x, y0, za)], V(0, 1, 0));    // floor under it
      for (const [zc, nz] of [[za, 1], [zb, -1]]) face(P.terracotta, [V(x - inset, y0, zc), V(x, y0, zc), V(x, y1, zc), V(x - inset, y1, zc)], V(0, 0, nz));   // recess ends
      face(col('Building'), [V(x, y0, za), V(x, y0, zb), V(x, y1, zb), V(x, y1, za)], V(1, 0, 0));
      for (let z = za; z <= zb + 1e-6; z += 1.5) box(P.frame, V(x - inset, y0, z - 0.04), V(x - inset + 0.08, y1, z + 0.04), { bottom: false });
      box(P.frame, V(x - inset, y0 + 2.5, za), V(x - inset + 0.06, y0 + 2.58, zb), { bottom: false });
    }
    // Terracotta above, from the top of the ground floor to the roof, with two bands of windows.
    const bandsTop = (z) => groundTop(z) + 3.4;
    const strips = [[8.6, 9.25, 'slab'], [11.2, 12.6, 'glass'], [14.8, 16.2, 'glass']];
    const yBreaks = (z) => [bandsTop(z), ...strips.flatMap(([a, b]) => [a, b]), top];
    for (const [za, zb] of [[z0, -run], [-run, 0], [0, z1]]) {
      const ys = yBreaks((za + zb) / 2);
      for (let k = 0; k + 1 < ys.length; k++) {
        const ya = ys[k], yb = ys[k + 1];
        const strip = strips.find(([a]) => Math.abs(a - ya) < 1e-6);
        if (strip && strip[2] === 'glass') {
          both(P.glass, null, [V(x - 0.25, ya, za), V(x - 0.25, ya, zb), V(x - 0.25, yb, zb), V(x - 0.25, yb, za)], V(1, 0, 0));
          face(P.frame, [V(x - 0.25, ya, za), V(x, ya, za), V(x, ya, zb), V(x - 0.25, ya, zb)], V(0, 1, 0));
          face(P.frame, [V(x - 0.25, yb, za), V(x, yb, za), V(x, yb, zb), V(x - 0.25, yb, zb)], V(0, -1, 0));
          for (let z = za; z <= zb + 1e-6; z += 1.2) box(P.frame, V(x - 0.26, ya, z - 0.03), V(x - 0.2, yb, z + 0.03), { bottom: false });
        } else if (!strip || strip[2] !== 'slab') {
          both(P.terracotta, null, [V(x, ya, za), V(x, ya, zb), V(x, yb, zb), V(x, yb, za)], V(1, 0, 0));
        }
      }
      face(col('Building'), [V(x, 0, za), V(x, 0, zb), V(x, top, zb), V(x, top, za)], V(1, 0, 0));
    }
    // The balcony slab that runs the length of the building, 2.3 m out over the plaza, with its railing.
    const slab0 = strips[0][0], slab1 = strips[0][1], out = 2.3;
    roundedBox(P.concrete, V(x - 0.4, slab0, z0), V(x + out, slab1, z1), 0.03);
    box(col('Building'), V(x - 0.4, slab0, z0), V(x + out, slab1, z1), {});
    for (let z = z0 + 0.3; z < z1; z += 1.6) tube(P.frame, [V(x + out - 0.12, slab1, z), V(x + out - 0.12, slab1 + 1.05, z)], 0.022, { segments: 8 });
    tube(P.rail, [V(x + out - 0.12, slab1 + 1.05, z0 + 0.3), V(x + out - 0.12, slab1 + 1.05, z1 - 0.3)], 0.026, { segments: 10 });
    for (const yy of [slab1 + 0.35, slab1 + 0.7]) tube(P.frame, [V(x + out - 0.12, yy, z0 + 0.3), V(x + out - 0.12, yy, z1 - 0.3)], 0.012, { segments: 6 });
    // ends and roof
    for (const [z, n] of [[z0, V(0, 0, -1)], [z1, V(0, 0, 1)]]) face(P.terracotta, [V(x - 14, 0, z), V(x, 0, z), V(x, top, z), V(x - 14, top, z)], n);
    face(P.concrete, [V(x - 14, top, z0), V(x, top, z0), V(x, top, z1), V(x - 14, top, z1)], V(0, 1, 0));
  }

  // The far end of the lower plaza: a wall up to the street, so the courtyard is closed in.
  both(P.concrete, 'Lower', [V(S.facadeX, 0, S.zFront), V(S.bankTopX, 0, S.zFront), V(S.bankTopX, S.street + 1.1, S.zFront), V(S.facadeX, S.street + 1.1, S.zFront)], V(0, 0, 1));
  // The world beyond: a plain apron below the street and round the back, so nothing floats.
  face(P.concrete, [V(-60, 0, -120), V(120, 0, -120), V(120, 0, S.zFront - 0.01), V(-60, 0, S.zFront - 0.01)], V(0, 1, 0));
  face(P.concrete, [V(S.walkX1, S.street, S.zFront), V(120, S.street, S.zFront), V(120, S.street, 120), V(S.walkX1, S.street, 120)], V(0, 1, 0));
  face(P.concrete, [V(-60, S.street, S.zRear + 6), V(S.walkX1, S.street, S.zRear + 6), V(S.walkX1, S.street, 120), V(-60, S.street, 120)], V(0, 1, 0));

  spawns.push({ name: 'Spawn_Entrance', pos: V(5.5, H, 14), heading: 0 });
  spawns.push({ name: 'Spawn_Bottom', pos: V(5.5, 0, -20), heading: Math.PI });
  return { parts, cols, paths, loops: [], spawns };
}
