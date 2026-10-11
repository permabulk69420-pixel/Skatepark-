// Turns a raw level GLB (one huge merged mesh per feature/material, 2K textures) into something a Quest browser can draw:
//   * every render mesh is cut into spatial chunks, so frustum culling works and LODs can switch per chunk
//   * each chunk gets cheaper copies (LOD1/LOD2) that the game swaps in by distance (src/skate/lod.js)
//   * leaf cards are thinned out by dropping whole leaves and scaling the rest up, rather than decimating them
//   * positions/normals/colours are quantised, textures are resized and stored as WebP, buffers are meshopt-compressed
// Collision meshes and everything that is not a render mesh (grind paths, spawns, hints) pass through untouched.
//
//   node tools/optimise-level.mjs <in.glb> <out.glb>
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: node tools/optimise-level.mjs <in.glb> <out.glb>'); process.exit(1); }

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

// Chunks come from a quadtree over the ground plane: a square only splits while it holds more than `maxTris` triangles (and is
// bigger than `minCell` metres), so sparse things like rails stay one draw call and dense areas still cull well.
// LODs: { from: distance it switches in at (m), ratio, err: max simplification error (m) }.
const CLASSES = {
  general: { maxTris: 22000, minCell: 14, lods: [{ from: 26, ratio: 0.4, err: 0.08 }, { from: 70, ratio: 0.12, err: 0.4 }], minTris: 1500 },
  bark: { maxTris: 14000, minCell: 14, lods: [{ from: 24, ratio: 0.35, err: 0.1 }, { from: 60, ratio: 0.1, err: 0.4 }], minTris: 1500 },
  // Foliage: ratio is the share of leaf cards that is kept; the survivors grow to cover the gaps.
  foliage: { maxTris: 16000, minCell: 14, leaf: true, lods: [{ from: 24, ratio: 0.4 }, { from: 55, ratio: 0.13 }], minTris: 1500 }
};
const WORLD = { x: -256, z: -256, size: 512 };
const TEXTURES = [
  { pattern: /_orm$/, size: 512, quality: 85 },
  { pattern: /_normal$/, size: 1024, quality: 92 },
  { pattern: /_base$/, size: 1024, quality: 84 }
];

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const buffer = root.listBuffers()[0];
doc.createExtension(KHRMeshQuantization).setRequired(true);

const isCollision = (node) => node.getExtras()?.role === 'collision' || /^COL_/.test(node.getName());

// ---------------------------------------------------------------- reading
function readPrimitive(prim) {
  const posAcc = prim.getAttribute('POSITION');
  const n = posAcc.getCount();
  const pos = new Float32Array(n * 3);
  const v = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) { posAcc.getElement(i, v); pos.set([v[0], v[1], v[2]], i * 3); }
  const readAttr = (semantic, size) => {
    const acc = prim.getAttribute(semantic);
    if (!acc) return null;
    const out = new Float32Array(n * size);
    const e = acc.getElementSize();
    for (let i = 0; i < n; i++) {
      acc.getElement(i, v);
      for (let k = 0; k < size; k++) out[i * size + k] = k < e ? v[k] : 1;
    }
    return out;
  };
  const idxAcc = prim.getIndices();
  const idx = idxAcc ? Uint32Array.from(idxAcc.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
  return { n, idx, pos, nor: readAttr('NORMAL', 3), uv: readAttr('TEXCOORD_0', 2), col: readAttr('COLOR_0', 4) };
}

// Compact copy of the given triangles (indices into src.idx / 3), with its own vertex arrays.
function extract(src, triangles) {
  const remap = new Map();
  const order = [];
  const idx = new Uint32Array(triangles.length * 3);
  triangles.forEach((t, k) => {
    for (let c = 0; c < 3; c++) {
      const old = src.idx[t * 3 + c];
      let id = remap.get(old);
      if (id === undefined) { id = order.length; remap.set(old, id); order.push(old); }
      idx[k * 3 + c] = id;
    }
  });
  const take = (arr, size) => {
    if (!arr) return null;
    const out = new Float32Array(order.length * size);
    order.forEach((old, i) => { for (let k = 0; k < size; k++) out[i * size + k] = arr[old * size + k]; });
    return out;
  };
  return { n: order.length, idx, pos: take(src.pos, 3), nor: take(src.nor, 3), uv: take(src.uv, 2), col: take(src.col, 4) };
}

// ---------------------------------------------------------------- LOD generation
function simplifyData(data, ratio, errMetres) {
  const target = Math.max(12, Math.floor(data.idx.length * ratio / 3) * 3);
  const attrs = [];
  const weights = [];
  const stride = (data.nor ? 3 : 0) + (data.uv ? 2 : 0) + (data.col ? 3 : 0);
  const packed = new Float32Array(data.n * stride);
  for (let i = 0; i < data.n; i++) {
    let o = i * stride;
    if (data.nor) for (let k = 0; k < 3; k++) packed[o++] = data.nor[i * 3 + k];
    if (data.uv) for (let k = 0; k < 2; k++) packed[o++] = data.uv[i * 2 + k];
    if (data.col) for (let k = 0; k < 3; k++) packed[o++] = data.col[i * 4 + k];
  }
  if (data.nor) weights.push(0.5, 0.5, 0.5);
  if (data.uv) weights.push(0.8, 0.8);
  if (data.col) weights.push(0.3, 0.3, 0.3);
  void attrs;
  const scale = MeshoptSimplifier.getScale(data.pos, 3);
  const [result] = MeshoptSimplifier.simplifyWithAttributes(data.idx, data.pos, 3, packed, stride, weights, null, target, errMetres / scale, ['LockBorder']);
  const triangles = Array.from({ length: result.length / 3 }, (_, i) => i);
  return extract({ ...data, idx: result }, triangles);
}

// Leaf cards are tiny disconnected clumps; find them by welding vertices that share a position.
function leafComponents(data) {
  const rep = new Int32Array(data.n);
  const seen = new Map();
  for (let i = 0; i < data.n; i++) {
    const k = `${Math.round(data.pos[i * 3] * 400)},${Math.round(data.pos[i * 3 + 1] * 400)},${Math.round(data.pos[i * 3 + 2] * 400)}`;
    const found = seen.get(k);
    if (found === undefined) { seen.set(k, i); rep[i] = i; } else rep[i] = found;
  }
  const parent = new Int32Array(data.n).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const triCount = data.idx.length / 3;
  for (let t = 0; t < triCount; t++) {
    const a = find(rep[data.idx[t * 3]]);
    parent[find(rep[data.idx[t * 3 + 1]])] = a;
    parent[find(rep[data.idx[t * 3 + 2]])] = a;
  }
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(rep[data.idx[t * 3]]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()];
}

function thinLeaves(data, components, keep) {
  const chosen = [];
  components.forEach((tris, i) => {
    // Deterministic hash so a rebuild gives the same trees.
    const h = Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
    if (h < keep) chosen.push(tris);
  });
  const triangles = chosen.flat();
  const out = extract(data, triangles);
  // Grow each surviving leaf about its centroid so the canopy keeps its volume.
  const grow = Math.min(2.3, Math.sqrt(1 / keep) * 0.92);
  const done = new Uint8Array(out.n);
  let t = 0;
  for (const tris of chosen) {
    const verts = new Set();
    for (let k = 0; k < tris.length * 3; k++) verts.add(out.idx[t * 3 + k]);
    t += tris.length;
    const c = [0, 0, 0];
    for (const v of verts) for (let a = 0; a < 3; a++) c[a] += out.pos[v * 3 + a] / verts.size;
    for (const v of verts) {
      if (done[v]) continue;
      done[v] = 1;
      for (let a = 0; a < 3; a++) out.pos[v * 3 + a] = c[a] + (out.pos[v * 3 + a] - c[a]) * grow;
    }
  }
  return out;
}

// ---------------------------------------------------------------- writing
function emit(data, material, name, extras) {
  let lo = [1e9, 1e9, 1e9];
  let hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < data.n; i++) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], data.pos[i * 3 + a]);
    hi[a] = Math.max(hi[a], data.pos[i * 3 + a]);
  }
  const centre = lo.map((l, a) => (l + hi[a]) / 2);
  // One uniform scale keeps normals correct under the node transform.
  const half = Math.max(1e-3, ...hi.map((h, a) => (h - lo[a]) / 2));
  const q = new Int16Array(data.n * 4);
  for (let i = 0; i < data.n; i++) for (let a = 0; a < 3; a++) q[i * 4 + a] = Math.round(((data.pos[i * 3 + a] - centre[a]) / half) * 32767);
  const prim = doc.createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positionArray(q, data.n)).setNormalized(true).setBuffer(buffer));
  if (data.nor) {
    const nq = new Int8Array(data.n * 3);
    for (let i = 0; i < data.n * 3; i++) nq[i] = Math.round(Math.max(-1, Math.min(1, data.nor[i])) * 127);
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nq).setNormalized(true).setBuffer(buffer));
  }
  if (data.uv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(data.uv).setBuffer(buffer));
  if (data.col) {
    const cq = new Uint8Array(data.n * 4);
    for (let i = 0; i < data.n * 4; i++) cq[i] = Math.round(Math.max(0, Math.min(1, data.col[i])) * 255);
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(cq).setNormalized(true).setBuffer(buffer));
  }
  const IndexArray = data.n > 65535 ? Uint32Array : Uint16Array;
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(IndexArray.from(data.idx)).setBuffer(buffer));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh).setTranslation(centre).setScale([half, half, half]).setExtras(extras);
  scene.addChild(node);
}

function positionArray(q, n) {
  const out = new Int16Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = q[i * 4]; out[i * 3 + 1] = q[i * 4 + 1]; out[i * 3 + 2] = q[i * 4 + 2]; }
  return out;
}

// ---------------------------------------------------------------- main pass
const stats = { before: 0, after: 0, chunks: 0, lodChunks: 0 };
const perMaterial = new Map();
const originals = root.listNodes().filter((n) => n.getMesh() && !isCollision(n) && n.getExtras()?.role !== 'collision');

for (const node of originals) {
  const mesh = node.getMesh();
  const matrix = node.getWorldMatrix();
  const identity = matrix.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6);
  if (!identity) throw new Error(`${node.getName()} has a transform; bake it first`);
  for (const prim of mesh.listPrimitives()) {
    const material = prim.getMaterial();
    const materialName = material?.getName() ?? '';
    const klass = /foliage/i.test(materialName) ? CLASSES.foliage : /bark/i.test(materialName) ? CLASSES.bark : CLASSES.general;
    const src = readPrimitive(prim);
    const triCount = src.idx.length / 3;
    stats.before += triCount;

    // Work units (single triangles, or whole leaves) are placed by centroid and then split down the quadtree.
    const units = (klass.leaf ? leafComponents(src) : Array.from({ length: triCount }, (_, t) => [t])).map((tris) => {
      let cx = 0;
      let cz = 0;
      for (const t of tris) for (let c = 0; c < 3; c++) {
        const v = src.idx[t * 3 + c];
        cx += src.pos[v * 3] / (tris.length * 3);
        cz += src.pos[v * 3 + 2] / (tris.length * 3);
      }
      return { tris, cx, cz };
    });
    const cells = new Map();
    const split = (list, x, z, size, id) => {
      const count = list.reduce((sum, u) => sum + u.tris.length, 0);
      if (!list.length) return;
      if (count <= klass.maxTris || size <= klass.minCell) { cells.set(id, list.map((u) => u.tris)); return; }
      const half = size / 2;
      const quadrants = [[], [], [], []];
      for (const u of list) quadrants[(u.cx >= x + half ? 1 : 0) + (u.cz >= z + half ? 2 : 0)].push(u);
      quadrants.forEach((q, i) => split(q, x + (i & 1) * half, z + (i >> 1) * half, half, `${id}${i}`));
    };
    split(units, WORLD.x, WORLD.z, WORLD.size, 'q');

    for (const [key, cellUnits] of cells) {
      const data = extract(src, cellUnits.flat());
      const group = `${mesh.getName()}@${key}`;
      const tris = data.idx.length / 3;
      const lodable = tris >= klass.minTris;
      emit(data, material, `${group}#0`, { role: 'environment', lod: lodable ? { group, level: 0, from: 0 } : undefined });
      stats.chunks++;
      stats.after += tris;
      if (!lodable) continue;
      stats.lodChunks++;
      const components = klass.leaf ? leafComponents(data) : null;
      klass.lods.forEach((lod, i) => {
        const reduced = klass.leaf ? thinLeaves(data, components, lod.ratio) : simplifyData(data, lod.ratio, lod.err);
        emit(reduced, material, `${group}#${i + 1}`, { role: 'environment', lod: { group, level: i + 1, from: lod.from } });
        const row = perMaterial.get(materialName) ?? [0, 0, 0];
        row[0] += i === 0 ? tris : 0;
        row[i + 1] += reduced.idx.length / 3;
        perMaterial.set(materialName, row);
      });
    }
  }
  node.dispose();
  mesh.dispose();
}

// Textures: resize and store as WebP.
for (const t of TEXTURES) {
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [t.size, t.size], pattern: t.pattern, quality: t.quality }));
}
// meshopt() would quantise the collision meshes too; compress the buffers without touching their precision.
await doc.transform(prune({ keepExtras: true }), reorder({ encoder: MeshoptEncoder, target: 'size' }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(output, doc);
for (const [name, row] of [...perMaterial].sort((a, b) => b[1][0] - a[1][0])) console.log(`  ${name.slice(0, 44).padEnd(44)} LOD0 ${String(row[0]).padStart(7)}  LOD1 ${String(row[1]).padStart(7)}  LOD2 ${String(row[2]).padStart(7)}`);
console.log(`chunks ${stats.chunks} (${stats.lodChunks} with LODs), render triangles ${stats.before} -> LOD0 ${stats.after}`);
