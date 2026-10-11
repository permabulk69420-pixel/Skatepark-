import * as THREE from 'three';
import { Skater } from '../dist/src/skate/sim.js';
import { GrindPath } from '../dist/src/skate/rails.js';

// A flat floor at y = 0 with optional solid boxes, standing in for the park's collision meshes.
export class FlatWorld {
  constructor(boxes = []) { this.boxes = boxes; }
  ground(x, z, fromY, out) {
    let y = 0;
    for (const b of this.boxes) {
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[1] && z <= b.max[1] && fromY >= b.top) y = Math.max(y, b.top);
    }
    out.y = y; out.nx = 0; out.ny = 1; out.nz = 0;
    return out;
  }
  // Ray against the boxes (solid from the floor up to `top`); front faces only.
  cast(origin, dir, far, out) {
    let best = null;
    for (const b of this.boxes) {
      const lo = [b.min[0], 0, b.min[1]], hi = [b.max[0], b.top, b.max[1]];
      const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
      let tNear = -Infinity, tFar = Infinity, axis = -1, sign = 0;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) { tNear = Infinity; break; } continue; }
        let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i], s1 = -1;
        if (t1 > t2) { [t1, t2] = [t2, t1]; s1 = 1; }
        if (t1 > tNear) { tNear = t1; axis = i; sign = s1; }
        tFar = Math.min(tFar, t2);
      }
      if (tNear > tFar || tNear < 0 || tNear > far || axis < 0) continue;
      if (!best || tNear < best.dist) best = { dist: tNear, n: [0, 0, 0].map((_, i) => (i === axis ? sign : 0)) };
    }
    if (!best) return null;
    out.dist = best.dist; out.nx = best.n[0]; out.ny = best.n[1]; out.nz = best.n[2];
    return out;
  }
}

export function makeSkater({ paths = [], world = new FlatWorld(), events = [], seed = 1 } = {}) {
  let state = seed;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const skater = new Skater({ world, paths, random, onEvent: (type, data) => events.push({ type, data }) });
  skater.setSpawn(new THREE.Vector3(0, 0, 0), 0);
  return skater;
}

export function rail(points, opts = {}) {
  return new GrindPath({ name: 'test', kind: 'rail', closed: false, radius: 0.025, ...opts, points: points.map((p) => new THREE.Vector3(...p)) });
}

export function run(skater, input, seconds, frame = 1 / 72, probe = () => {}) {
  const frames = Math.round(seconds / frame);
  for (let i = 0; i < frames; i++) {
    const inp = typeof input === 'function' ? input(i * frame, skater) : input;
    skater.update(inp, frame);
    probe(i * frame, skater);
  }
}
