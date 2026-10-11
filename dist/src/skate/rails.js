import * as THREE from 'three';
import { BOARD, TUNING as T } from './config.js';

// Grind paths come from the park file as polylines stored in node extras (role "grind_path").
// Each becomes a list of segments with cumulative arc length so a grind can be a single number, s.
export class GrindPath {
  constructor({ name, kind, closed, radius, points }) {
    this.name = name;
    this.kind = ['rail', 'coping', 'ledge'].includes(kind) ? kind : 'rail';
    this.closed = !!closed;
    this.radius = radius || 0.025;
    this.points = points;
    const n = points.length;
    const segCount = this.closed ? n : n - 1;
    this.segments = [];
    this.cumulative = [0];
    this.bounds = new THREE.Box3().setFromPoints(points);
    for (let i = 0; i < segCount; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const dir = b.clone().sub(a);
      const length = dir.length();
      if (length < 1e-6) continue;
      dir.divideScalar(length);
      const dirH = new THREE.Vector2(dir.x, dir.z);
      const hLen = dirH.length();
      if (hLen > 1e-6) dirH.divideScalar(hLen);
      this.segments.push({ a, b, dir, dirH, hLen, length, start: this.cumulative[this.cumulative.length - 1] });
      this.cumulative.push(this.cumulative[this.cumulative.length - 1] + length);
    }
    this.length = this.cumulative[this.cumulative.length - 1];
    this.bounds.expandByScalar(0.6);
    this.friction = T.grindFriction[this.kind];
    // Height of the surface the board actually touches above the stored line.
    this.topOffset = this.radius * T.railTopOffset[this.kind];
    // A ledge is solid underneath, so a board across it has to ride on its wheels rather than on the deck underside.
    this.slideContact = this.kind === 'ledge' ? 0 : BOARD.deckBottom;
  }

  segmentAt(s) {
    let lo = 0, hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid].start <= s) lo = mid; else hi = mid - 1;
    }
    return this.segments[lo];
  }

  pointAt(s, out) {
    const seg = this.segmentAt(s);
    const t = THREE.MathUtils.clamp((s - seg.start) / seg.length, 0, 1);
    return out.copy(seg.a).lerp(seg.b, t);
  }
}

export function parseGrindPaths(nodes) {
  const paths = [];
  const v = new THREE.Vector3();
  for (const node of nodes) {
    const data = node.userData;
    if (!data?.points || data.points.length < 6) continue;
    node.updateWorldMatrix(true, false);
    const points = [];
    for (let i = 0; i + 2 < data.points.length; i += 3) {
      points.push(v.set(data.points[i], data.points[i + 1], data.points[i + 2]).applyMatrix4(node.matrixWorld).clone());
    }
    // A closed loop that repeats its first point would add a zero-length segment; drop the duplicate.
    if (data.closed && points.length > 2 && points[0].distanceToSquared(points[points.length - 1]) < 1e-8) points.pop();
    const path = new GrindPath({ name: node.name, kind: data.kind, closed: data.closed, radius: data.radius, points });
    if (path.segments.length) paths.push(path);
  }
  return paths;
}
