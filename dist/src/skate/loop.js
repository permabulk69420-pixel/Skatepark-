import * as THREE from 'three';

// Loops (a full 360° loop-the-loop). A loop is a ribbon: a centreline on the riding surface plus, at every point, the surface's
// normal (pointing into the loop, the way the board's wheels point away from). The park file stores it in node extras
// (role "loop_path": points, normals, width). While the board is on the ribbon the sim rides it as a single number s along the
// centreline, like a grind, because a heading-plus-up board cannot describe riding upside down.

// The shape. In the plane of the loop the track turns through 2π over `length` metres with curvature (2π/length)(1 − α cos 2πu),
// u = s/length: gentle at the bottom where you ride in and out, tightest at the top (a teardrop, like real loops, so it needs
// less speed than a circle of the same height). The exit is shifted sideways by `shift` (eased in and out, so both ends point
// straight along `heading`), so the way out runs beside the way in.
//   start: [x, y, z] where the ribbon begins, on the ground; heading: yaw of travel (the sim's convention: (−sin h, 0, −cos h));
//   shift > 0 moves the exit to the rider's right.
export function loopRibbon({ start = [0, 0, 0], heading = 0, length = 17, alpha = 0.7, shift = 2.8, step = 0.1 } = {}) {
  const fwd = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
  const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
  const up = new THREE.Vector3(0, 1, 0);
  const count = Math.max(8, Math.round(length / step));
  const fine = 40;                                  // integration substeps per output step
  const ds = length / (count * fine);
  const phiAt = (u) => 2 * Math.PI * (u - alpha * Math.sin(2 * Math.PI * u) / (2 * Math.PI));
  const sideAt = (u) => shift * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI));
  const points = [], normals = [];
  let a = 0, y = 0;                                 // in-plane position: along the heading, and height
  const o = new THREE.Vector3(...start);
  const t = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3();
  const sample = (u) => {
    const phi = phiAt(u);
    p.copy(o).addScaledVector(fwd, a).addScaledVector(up, y).addScaledVector(right, sideAt(u));
    // Tangent: in-plane direction plus the sideways drift; across: "right", made square to the tangent; normal = across × tangent.
    const dSide = shift * (1 - Math.cos(2 * Math.PI * u)) / length;
    t.copy(fwd).multiplyScalar(Math.cos(phi)).addScaledVector(up, Math.sin(phi)).addScaledVector(right, dSide).normalize();
    b.copy(right).addScaledVector(t, -right.dot(t)).normalize();
    n.crossVectors(b, t).normalize();
    points.push(+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4));
    normals.push(+n.x.toFixed(5), +n.y.toFixed(5), +n.z.toFixed(5));
  };
  for (let i = 0; i <= count; i++) {
    sample(i / count);
    if (i === count) break;
    for (let k = 0; k < fine; k++) {
      const u = (i * fine + k + 0.5) / (count * fine);
      const phi = phiAt(u);
      a += Math.cos(phi) * ds;
      y += Math.sin(phi) * ds;
    }
  }
  return { points, normals };
}

const _d = new THREE.Vector3();

export class LoopPath {
  // points / normals: flat [x, y, z, …] arrays (world space); width: of the riding surface.
  constructor({ name = 'loop', points, normals, width = 2.4 }) {
    this.name = name;
    this.width = width;
    const n = points.length / 3;
    this.p = []; this.n = []; this.t = []; this.b = []; this.k = []; this.s = [0];
    for (let i = 0; i < n; i++) {
      this.p.push(new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
      this.n.push(new THREE.Vector3(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]).normalize());
    }
    for (let i = 1; i < n; i++) this.s.push(this.s[i - 1] + this.p[i].distanceTo(this.p[i - 1]));
    this.length = this.s[n - 1];
    for (let i = 0; i < n; i++) {
      const a = this.p[Math.max(0, i - 1)], c = this.p[Math.min(n - 1, i + 1)];
      const t = c.clone().sub(a).normalize();
      const nn = this.n[i];
      nn.addScaledVector(t, -nn.dot(t)).normalize();         // keep the normal square to the track
      this.t.push(t);
      this.b.push(new THREE.Vector3().crossVectors(t, nn).normalize());   // across the track, to the right of travel
    }
    // Curvature towards the normal (how hard the surface turns the board), from the change of tangent.
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const span = this.s[i1] - this.s[i0];
      this.k.push(span > 1e-6 ? _d.copy(this.t[i1]).sub(this.t[i0]).dot(this.n[i]) / span : 0);
    }
    // The ribbon is ridden as a loop between the first and last points where it tilts past `enterNy`; outside that it is ordinary
    // ground (the run in and the run out, lying on the floor).
    // Across the lanes, flat: the run in and the run out both point square to it.
    this.across = new THREE.Vector3(this.b[0].x, 0, this.b[0].z).normalize();
    this.bounds = new THREE.Box3().setFromPoints(this.p).expandByScalar(width / 2 + 0.6);
    this.top = Math.max(...this.p.map((q) => q.y));
  }

  // The riding window: from the first to the last point whose normal has tilted past ny (0.97 by default).
  window(enterNy) {
    const n = this.n.length;
    let a = 0, b = n - 1;
    while (a < n - 1 && this.n[a].y >= enterNy) a++;
    while (b > 0 && this.n[b].y >= enterNy) b--;
    return [this.s[Math.max(0, a - 1)], this.s[Math.min(n - 1, b + 1)]];
  }

  index(s) {
    let lo = 0, hi = this.s.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.s[mid] <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // Fills out.p (the centreline point), out.t, out.n, out.b and out.k at arc length s.
  frame(s, out) {
    s = Math.min(Math.max(s, 0), this.length);
    const i = this.index(s);
    const span = this.s[i + 1] - this.s[i];
    const f = span > 1e-9 ? (s - this.s[i]) / span : 0;
    out.p.copy(this.p[i]).lerp(this.p[i + 1], f);
    out.t.copy(this.t[i]).lerp(this.t[i + 1], f).normalize();
    out.n.copy(this.n[i]).lerp(this.n[i + 1], f);
    out.n.addScaledVector(out.t, -out.n.dot(out.t)).normalize();
    out.b.crossVectors(out.t, out.n).normalize();
    out.k = this.k[i] + (this.k[i + 1] - this.k[i]) * f;
    return out;
  }

  // Where a point is on the ribbon, between arc lengths sMin and sMax: out.s, out.l (across, + to the right), out.h (height above
  // the surface along its normal). Picks the stretch the point is closest to the surface of. Null if it is not over the ribbon.
  project(pos, sMin, sMax, out, maxH = 0.3) {
    let best = Infinity;
    const half = this.width / 2;
    for (let i = this.index(sMin); i < this.p.length - 1 && this.s[i] <= sMax; i++) {
      const a = this.p[i], c = this.p[i + 1];
      const seg = _d.copy(c).sub(a);
      const len2 = seg.lengthSq();
      if (len2 < 1e-12) continue;
      const rx = pos.x - a.x, ry = pos.y - a.y, rz = pos.z - a.z;
      const f = (rx * seg.x + ry * seg.y + rz * seg.z) / len2;
      if (f < -0.02 || f > 1.02) continue;
      const fc = Math.min(Math.max(f, 0), 1);
      const n = this.n[i], b = this.b[i];
      const qx = pos.x - (a.x + seg.x * fc), qy = pos.y - (a.y + seg.y * fc), qz = pos.z - (a.z + seg.z * fc);
      const h = qx * n.x + qy * n.y + qz * n.z;
      const l = qx * b.x + qy * b.y + qz * b.z;
      if (Math.abs(h) > maxH || Math.abs(l) > half) continue;
      if (Math.abs(h) < best) {
        best = Math.abs(h);
        out.s = this.s[i] + fc * (this.s[i + 1] - this.s[i]);
        out.l = l; out.h = h;
      }
    }
    return best < Infinity ? out : null;
  }
}

export function parseLoopPaths(nodes) {
  const loops = [];
  for (const node of nodes) {
    const data = node.userData;
    if (!data?.points || !data.normals || data.points.length < 12) continue;
    // Stored in world space by the park builder; a moved node would need its matrix applied (none is).
    loops.push(new LoopPath({ name: node.name, points: data.points, normals: data.normals, width: data.width }));
  }
  return loops;
}
