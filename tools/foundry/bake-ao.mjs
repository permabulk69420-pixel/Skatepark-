// Ambient occlusion baked into vertex colours: from every render vertex, rays over the hemisphere around its normal; the share
// that hit something nearby darkens it. Contact shadows under ledges, in the corners of stairs, under rails and in the bottom of
// the bowl come for free on the headset (a vertex colour costs nothing to draw).
import * as THREE from 'three';
import { MeshBVH } from '../../dist/vendor/mesh-bvh.js';

// parts: [{ pos, nor, ... }] (world space). Fills part.col (RGBA, linear) on each. Parts with `aoCasterOnly` cast but are not shaded.
export function bakeAO(parts, { rays = 40, reach = 2.2, strength = 0.9, floorY = -0.5, seed = 12345 } = {}) {
  // One BVH over every triangle that can occlude.
  let triCount = 0;
  for (const p of parts) if (!p.aoSkipCast) triCount += p.idx.length / 3;
  const positions = new Float32Array(triCount * 9);
  let o = 0;
  for (const p of parts) {
    if (p.aoSkipCast) continue;
    for (const v of p.idx) { positions[o++] = p.pos[v * 3]; positions[o++] = p.pos[v * 3 + 1]; positions[o++] = p.pos[v * 3 + 2]; }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const bvh = new MeshBVH(geometry, { maxLeafTris: 8 });
  const ray = new THREE.Ray();

  // A fixed set of cosine-weighted directions around +Y (rotated onto each normal).
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const dirs = [];
  for (let i = 0; i < rays; i++) {
    // Stratified so a small count still covers the hemisphere evenly.
    const u = (i + rand()) / rays, v = rand();
    const r = Math.sqrt(u), phi = 2 * Math.PI * (v + i * 0.618034);
    dirs.push(new THREE.Vector3(r * Math.cos(phi), Math.sqrt(Math.max(0, 1 - u)), r * Math.sin(phi)));
  }
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), d = new THREE.Vector3();
  let done = 0;
  for (const p of parts) {
    if (p.aoSkipShade) continue;
    const count = p.pos.length / 3;
    p.col = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      n.set(p.nor[i * 3], p.nor[i * 3 + 1], p.nor[i * 3 + 2]).normalize();
      q.setFromUnitVectors(up, n);
      ray.origin.set(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]).addScaledVector(n, 0.012);
      let occ = 0;
      for (const dir of dirs) {
        d.copy(dir).applyQuaternion(q);
        ray.direction.copy(d);
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, reach);
        if (hit) occ += 1 - Math.pow(hit.distance / reach, 0.7);
        // Everything below the level's floor counts as solid ground (open edges of the world do not glow).
        else if (d.y < 0 && ray.origin.y + d.y * reach < floorY) occ += 0.5;
      }
      const ao = 1 - strength * Math.min(1, occ / rays * 1.6);
      // Broad, soft changes of tone (weathering) so a tiling texture does not read as a repeat across a big slab.
      const tone = p.vary ? 1 - p.vary * fbm(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]) : 1;
      p.col[i * 4] = p.col[i * 4 + 1] = p.col[i * 4 + 2] = Math.max(0.12, ao) * tone;
      p.col[i * 4 + 3] = 1;
    }
    done += count;
  }
  return done;
}

// Smooth value noise, 0..1, over world space: two octaves, roughly 7 m and 2.3 m across.
function hash(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x, y, z) {
  return 0.65 * noise(x / 7, y / 7, z / 7) + 0.35 * noise(x / 2.3 + 17, y / 2.3, z / 2.3 + 5);
}
