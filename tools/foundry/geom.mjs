// Geometry helpers for the procedural park (tools/build-foundry.mjs). Everything is built straight into world-space triangle lists,
// one per material (render) or per area (collision). Render faces are cut into a grid of cells no longer than `maxEdge`, so the
// ambient occlusion baked into vertex colours (bake-ao.mjs) has vertices where the shading changes.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export { V };

export class Part {
  constructor(name, { uvScale = 3, maxEdge = 0.45, collision = false } = {}) {
    this.name = name;
    this.uvScale = uvScale;       // metres per texture repeat
    this.maxEdge = collision ? Infinity : maxEdge;
    this.collision = collision;
    this.pos = []; this.nor = []; this.uv = []; this.idx = [];
  }
  get vertexCount() { return this.pos.length / 3; }
  get triangleCount() { return this.idx.length / 3; }

  vert(p, n, uv) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    if (!uv) uv = boxUV(p, n, this.uvScale);
    this.uv.push(uv[0], uv[1]);
    return this.vertexCount - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
}

// World-space box projection: the plane the normal faces most decides which two coordinates are the UV.
export function boxUV(p, n, scale) {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return [p.x / scale, -p.z / scale];
  if (ax >= az) return [(n.x > 0 ? -p.z : p.z) / scale, p.y / scale];
  return [(n.z > 0 ? p.x : -p.x) / scale, p.y / scale];
}

const _e1 = V(), _e2 = V();
export function faceNormal(a, b, c, out = V()) {
  return out.crossVectors(_e1.subVectors(b, a), _e2.subVectors(c, a)).normalize();
}

// A planar quad a-b-c-d (counter-clockwise seen from the front) cut into a grid. `uvs` optional [[u,v] × 4].
export function quad(part, a, b, c, d, { normal, uvs, normals } = {}) {
  const n = normal || faceNormal(a, b, c);
  const nu = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), d.distanceTo(c)) / part.maxEdge));
  const nv = Math.max(1, Math.ceil(Math.max(a.distanceTo(d), b.distanceTo(c)) / part.maxEdge));
  const base = part.vertexCount;
  const p = V(), q = V(), r = V(), nn = V(), m0 = V(), m1 = V();
  for (let j = 0; j <= nv; j++) {
    const fv = j / nv;
    for (let i = 0; i <= nu; i++) {
      const fu = i / nu;
      q.copy(a).lerp(b, fu); r.copy(d).lerp(c, fu); p.copy(q).lerp(r, fv);
      if (normals) { m0.copy(normals[0]).lerp(normals[1], fu); m1.copy(normals[3]).lerp(normals[2], fu); nn.copy(m0).lerp(m1, fv).normalize(); }
      let uv;
      if (uvs) {
        const u0 = uvs[0][0] + (uvs[1][0] - uvs[0][0]) * fu, v0 = uvs[0][1] + (uvs[1][1] - uvs[0][1]) * fu;
        const u1 = uvs[3][0] + (uvs[2][0] - uvs[3][0]) * fu, v1 = uvs[3][1] + (uvs[2][1] - uvs[3][1]) * fu;
        uv = [u0 + (u1 - u0) * fv, v0 + (v1 - v0) * fv];
      }
      part.vert(p, normals ? nn : n, uv);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const k = base + j * row + i;
    part.tri(k, k + 1, k + row + 1);
    part.tri(k, k + row + 1, k + row);
  }
}

// A triangle, split along its longest edge until every edge fits. Pass the same `cache` (a Map) for every triangle of one flat face
// and their corners are shared, so the face stays one connected mesh (which the LOD simplifier can then reduce).
export function tri(part, a, b, c, normal, cache = new Map()) {
  const n = normal || faceNormal(a, b, c);
  const index = (p) => {
    const key = `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
    let i = cache.get(key);
    if (i === undefined) { i = part.vert(p, n); cache.set(key, i); }
    return i;
  };
  const split = (p0, p1, p2, depth) => {
    const l0 = p0.distanceTo(p1), l1 = p1.distanceTo(p2), l2 = p2.distanceTo(p0);
    const longest = Math.max(l0, l1, l2);
    if (longest <= part.maxEdge || depth > 12) {
      part.tri(index(p0), index(p1), index(p2));
      return;
    }
    if (longest === l0) { const m = p0.clone().lerp(p1, 0.5); split(p0, m, p2, depth + 1); split(m, p1, p2, depth + 1); }
    else if (longest === l1) { const m = p1.clone().lerp(p2, 0.5); split(p0, p1, m, depth + 1); split(p0, m, p2, depth + 1); }
    else { const m = p2.clone().lerp(p0, 0.5); split(p0, p1, m, depth + 1); split(m, p1, p2, depth + 1); }
  };
  split(a, b, c, 0);
}

// A planar polygon (any shape, no holes), counter-clockwise seen from the front.
export function polygon(part, pts, normal) {
  const n = normal || newellNormal(pts);
  if (pts.length === 4 && isRect(pts)) {
    const q = faceNormal(pts[0], pts[1], pts[2]).dot(n) >= 0 ? pts : pts.slice().reverse();
    quad(part, q[0], q[1], q[2], q[3], { normal: n });
    return;
  }
  // Project to 2D in the polygon's own plane (u, v, n right-handed), triangulate, and turn every triangle to face +n.
  const ax = Math.abs(n.x) > 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const u = V().crossVectors(ax, n).normalize(), v = V().crossVectors(n, u);
  const flat = pts.map((p) => new THREE.Vector2(p.dot(u), p.dot(v)));
  const cache = new Map();
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(flat, [])) {
    const area = (flat[j].x - flat[i].x) * (flat[k].y - flat[i].y) - (flat[k].x - flat[i].x) * (flat[j].y - flat[i].y);
    area >= 0 ? tri(part, pts[i], pts[j], pts[k], n, cache) : tri(part, pts[i], pts[k], pts[j], n, cache);
  }
}

function isRect(p) {
  const d1 = p[0].distanceTo(p[2]), d2 = p[1].distanceTo(p[3]);
  return Math.abs(d1 - d2) < 1e-6 && Math.abs(p[0].distanceTo(p[1]) - p[3].distanceTo(p[2])) < 1e-6;
}

export function newellNormal(pts) {
  const n = V();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.normalize();
}

// Axis-aligned box. `faces` can drop sides ({ bottom: false, ... }).
export function box(part, min, max, { bottom = false, top = true, sides = true } = {}) {
  const [x0, y0, z0] = [min.x, min.y, min.z], [x1, y1, z1] = [max.x, max.y, max.z];
  const P = (x, y, z) => V(x, y, z);
  if (top) quad(part, P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0));
  if (bottom) quad(part, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1));
  if (!sides) return;
  quad(part, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1));   // +z
  quad(part, P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0));   // -z
  quad(part, P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1));   // +x
  quad(part, P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0));   // -x
}

// Extrudes a 2D profile along a straight line. The profile is in (across, up) coordinates: across runs to the right of `dir`
// (dir × up), up is world Y. The extrusion goes from `start` along `dir` (unit, horizontal) for `length`.
// Profile points: [across, up] or [across, up, true], where `true` smooths the shading through that point (arcs).
// closed: a closed outline (either winding; faces come out pointing outwards) with caps at both ends. Open: a surface (a ramp face)
// that faces to the left of the way the profile runs in (across, up), i.e. upwards for a profile running towards +across.
export function extrude(part, profile, { start, dir, length, closed = true, caps = true }) {
  if (closed && signedArea(profile) > 0) profile = profile.slice().reverse();
  const up = V(0, 1, 0);
  const side = V().crossVectors(dir, up).normalize();
  const at = (pt, d) => V().copy(start).addScaledVector(side, pt[0]).addScaledVector(up, pt[1]).addScaledVector(dir, d);
  const n = profile.length;
  const edges = closed ? n : n - 1;
  const edgeNormal = [];
  for (let i = 0; i < edges; i++) {
    const ea = at(profile[i], 0), eb = at(profile[(i + 1) % n], 0);
    edgeNormal.push(V().crossVectors(V().subVectors(eb, ea), dir).normalize());
  }
  const pointNormal = (i, e) => {
    if (!profile[i][2]) return edgeNormal[e];
    const prev = closed || i > 0 ? (i - 1 + edges) % edges : -1;
    const next = closed || i < n - 1 ? i % edges : -1;
    const other = e === prev ? next : prev;
    return other < 0 ? edgeNormal[e] : V().addVectors(edgeNormal[e], edgeNormal[other]).normalize();
  };
  const s = part.uvScale;
  const u0 = start.dot(dir) / s, u1 = u0 + length / s;
  let perimeter = 0;
  for (let e = 0; e < edges; e++) {
    const ia = e, ib = (e + 1) % n;
    const a = profile[ia], b = profile[ib];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const v0 = perimeter / s, v1 = (perimeter + len) / s;
    quad(part, at(a, 0), at(b, 0), at(b, length), at(a, length), {
      uvs: [[u0, v0], [u0, v1], [u1, v1], [u1, v0]],
      normals: [pointNormal(ia, e), pointNormal(ib, e), pointNormal(ib, e), pointNormal(ia, e)]
    });
    perimeter += len;
  }
  if (closed && caps) {
    polygon(part, profile.map((p) => at(p, 0)), dir.clone().negate());
    polygon(part, profile.map((p) => at(p, length)), dir.clone());
  }
}

export function signedArea(profile) {
  let area = 0;
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i], b = profile[(i + 1) % profile.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

// Tube along a polyline (rails, coping, posts). Parallel-transported frames, mitred joints.
export function tube(part, pts, radius, { segments = 12, caps = true, uvScale = 1 } = {}) {
  const n = pts.length;
  const tangents = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    if (i > 0 && i < n - 1) {
      const t0 = V().subVectors(p, a).normalize(), t1 = V().subVectors(b, p).normalize();
      return t0.add(t1).normalize();
    }
    return V().subVectors(b, a).normalize();
  });
  let normal = Math.abs(tangents[0].y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  normal.addScaledVector(tangents[0], -normal.dot(tangents[0])).normalize();
  const rings = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const q = new THREE.Quaternion().setFromUnitVectors(tangents[i - 1], tangents[i]);
      normal.applyQuaternion(q);
      along += pts[i].distanceTo(pts[i - 1]);
    }
    const binormal = V().crossVectors(tangents[i], normal);
    const ring = [];
    for (let k = 0; k <= segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      const dirv = V().addScaledVector(normal, Math.cos(a)).addScaledVector(binormal, Math.sin(a));
      const p = V().copy(pts[i]).addScaledVector(dirv, radius);
      ring.push(part.vert(p, dirv, [k / segments, along / uvScale]));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < segments; k++) {
    const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k + 1], d = rings[i + 1][k];
    part.tri(a, c, d); part.tri(a, b, c);
  }
  if (caps) for (const [i, sign] of [[0, -1], [n - 1, 1]]) {
    const t = tangents[i].clone().multiplyScalar(sign);
    const centre = part.vert(pts[i], t, [0.5, 0.5]);
    const ring = [];
    for (let k = 0; k < segments; k++) {
      const p = V(...part.pos.slice(rings[i][k] * 3, rings[i][k] * 3 + 3));
      ring.push(part.vert(p, t, [0.5, 0.5]));
    }
    for (let k = 0; k < segments; k++) sign > 0 ? part.tri(centre, ring[k], ring[(k + 1) % segments]) : part.tri(centre, ring[(k + 1) % segments], ring[k]);
  }
}

// Arc points (2D) from angle a0 to a1 around (cx, cy), radius r, `steps` segments; every point marked smooth.
export function arc(cx, cy, r, a0, a1, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), true]);
  }
  return out;
}

