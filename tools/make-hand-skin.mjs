// Makes the tileable skin detail used by the VR hands (dist/models/hands/skin-colour.jpg and skin-normal.jpg).
// The hand model has one flat skin colour; this adds pores, fine creases and slight blotchy redness on top of it.
//   node tools/make-hand-skin.mjs
import sharp from 'sharp';
import path from 'node:path';

const size = 512;
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist/models/hands');
let seed = 20240917;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// periodic value noise: wraps at the tile edge, so the texture tiles
function noise(cells) {
  const grid = Float32Array.from({ length: cells * cells }, random);
  const at = (x, y) => grid[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  };
}
const layers = [[8, 0.35], [24, 0.3], [64, 0.2], [128, 0.15]].map(([cells, weight]) => ({ f: noise(cells), weight }));
const fbm = (u, v) => layers.reduce((s, l) => s + l.f(u, v) * l.weight, 0);
const blotch = noise(5), blotch2 = noise(11);

// pores: small dark dots scattered over the tile (wrapped), as a height dent
const height = new Float32Array(size * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[y * size + x] = fbm(x / size, y / size) * 0.6;
for (let n = 0; n < 2600; n++) {
  const cx = Math.floor(random() * size), cy = Math.floor(random() * size), r = 1 + random() * 1.6, depth = 0.25 + random() * 0.35;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.hypot(dx, dy); if (d > r + 1) continue;
    const i = ((cy + dy + size) % size) * size + ((cx + dx + size) % size);
    height[i] -= depth * Math.max(0, 1 - d / (r + 1)) ** 1.5;
  }
}
// fine creases: a few long stretched ridges
for (let n = 0; n < 90; n++) {
  let x = random() * size, y = random() * size, a = random() * Math.PI, len = 20 + random() * 50;
  for (let s = 0; s < len; s++) {
    x += Math.cos(a) * 1.2; y += Math.sin(a) * 1.2; a += (random() - 0.5) * 0.25;
    const i = ((Math.floor(y) + size) % size) * size + ((Math.floor(x) + size) % size);
    height[i] -= 0.12;
  }
}
const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

const normal = Buffer.alloc(size * size * 3), colour = Buffer.alloc(size * size * 3);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = (h(x + 1, y) - h(x - 1, y)) * 3, dy = (h(x, y + 1) - h(x, y - 1)) * 3, len = Math.hypot(dx, dy, 1), o = (y * size + x) * 3;
  normal[o] = Math.round((-dx / len * 0.5 + 0.5) * 255); normal[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255); normal[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
  // colour is multiplied with the model's own skin colour, so it hovers around white: pores slightly dark, blotches slightly red
  const u = x / size, v = y / size, pore = Math.min(0, h(x, y) + 0.05) * 0.5, b = blotch(u, v) - 0.5, b2 = blotch2(u, v) - 0.5;
  const base = 0.93 + pore + b2 * 0.1;
  colour[o] = Math.round(Math.min(1, base + b * 0.12 + 0.04) * 255);
  colour[o + 1] = Math.round(Math.min(1, base - b * 0.10) * 255);
  colour[o + 2] = Math.round(Math.min(1, base - b * 0.14 - 0.01) * 255);
}
await sharp(colour, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(out, 'skin-colour.jpg'));
await sharp(normal, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 90 }).toFile(path.join(out, 'skin-normal.jpg'));
console.log('wrote skin-colour.jpg and skin-normal.jpg');
