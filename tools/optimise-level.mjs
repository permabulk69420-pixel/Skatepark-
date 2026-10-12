// Turns a raw level GLB (one huge merged mesh per feature/material, 2K textures) into something a Quest browser can draw:
//   * every render mesh is cut into spatial chunks, so frustum culling works and LODs can switch per chunk
//   * each chunk gets cheaper copies (LOD1/LOD2) that the game swaps in by distance (src/skate/lod.js)
//   * leaf cards are thinned out by dropping whole leaves and scaling the rest up, rather than decimating them
//   * positions/normals/colours are quantised, textures are resized and stored as WebP, buffers are meshopt-compressed
// Collision meshes and everything that is not a render mesh (grind paths, spawns, hints) pass through untouched.
//
//   node tools/optimise-level.mjs <in.glb> <out.glb> [tweaks.json]
// An optional tweaks file (also `collisionError`: simplify the collision meshes within that many metres) corrects materials that were authored wrong, e.g. { "materials": [ { "match": "Asphalt",
// "texturesFrom": "concrete", "baseColorFactor": [0.4, 0.4, 0.42, 1] } ] } points every material whose name matches at another
// texture set (<name>_base / _normal / _orm) and tints it.
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const [input, output, tweaksPath] = process.argv.slice(2);
if (!input || !output) { console.error('usage: node tools/optimise-level.mjs <in.glb> <out.glb> [tweaks.json]'); process.exit(1); }

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

// Material corrections from the optional tweaks file.
const tweaks = tweaksPath ? JSON.parse(fs.readFileSync(tweaksPath, 'utf8')) : {};
if (tweaksPath) {
  const texture = (name) => root.listTextures().find((t) => t.getName() === name);
  for (const rule of tweaks.materials ?? []) {
    for (const material of root.listMaterials().filter((m) => new RegExp(rule.match, 'i').test(m.getName()))) {
      if (rule.texturesFrom) {
        const [base, normal, orm] = ['base', 'normal', 'orm'].map((k) => texture(`${rule.texturesFrom}_${k}`));
        if (!base) throw new Error(`tweaks: no texture ${rule.texturesFrom}_base`);
        material.setBaseColorTexture(base);
        if (normal) material.setNormalTexture(normal);
        if (orm) material.setMetallicRoughnessTexture(orm).setOcclusionTexture(orm);
      }
      if (rule.baseColorFactor) material.setBaseColorFactor(rule.baseColorFactor);
      console.log(`tweaked material ${material.getName()}`);
    }
  }
}

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
  return { n, idx, pos, nor: readAttr('NORMAL', 3), uv: readAttr('TEXCOORD_0', 2), uv1: readAttr('TEXCOORD_1', 2), col: readAttr('COLOR_0', 4) };
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
  return { n: order.length, idx, pos: take(src.pos, 3), nor: take(src.nor, 3), uv: take(src.uv, 2), uv1: take(src.uv1, 2), col: take(src.col, 4) };
}

// ---------------------------------------------------------------- LOD generation
function simplifyData(data, ratio, errMetres) {
  const target = Math.max(12, Math.floor(data.idx.length * ratio / 3) * 3);
  const attrs = [];
  const weights = [];
  const stride = (data.nor ? 3 : 0) + (data.uv ? 2 : 0) + (data.uv1 ? 2 : 0) + (data.col ? 3 : 0);
  const packed = new Float32Array(data.n * stride);
  for (let i = 0; i < data.n; i++) {
    let o = i * stride;
    if (data.nor) for (let k = 0; k < 3; k++) packed[o++] = data.nor[i * 3 + k];
    if (data.uv) for (let k = 0; k < 2; k++) packed[o++] = data.uv[i * 2 + k];
    if (data.uv1) for (let k = 0; k < 2; k++) packed[o++] = data.uv1[i * 2 + k];
    if (data.col) for (let k = 0; k < 3; k++) packed[o++] = data.col[i * 4 + k];
  }
  if (data.nor) weights.push(0.5, 0.5, 0.5);
  if (data.uv) weights.push(0.8, 0.8);
  if (data.uv1) weights.push(0.8, 0.8);
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
  if (data.uv1) prim.setAttribute('TEXCOORD_1', doc.createAccessor().setType('VEC2').setArray(data.uv1).setBuffer(buffer));
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

// ---------------------------------------------------------------- merging
// A level can arrive as thousands of separate objects. Bake each object's transform and merge everything that shares a material
// into one mesh before chunking, so draw calls depend on the chunking and not on how the scene was split up in the editor.
function worldPrimitive(node, prim) {
  const src = readPrimitive(prim);
  const m = node.getWorldMatrix();
  if (m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6)) return src;
  for (let i = 0; i < src.n; i++) {
    const x = src.pos[i * 3], y = src.pos[i * 3 + 1], z = src.pos[i * 3 + 2];
    src.pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    src.pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    src.pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  // Normals follow the inverse transpose of the upper 3x3 (the cofactor matrix over the determinant).
  const a = [m[0], m[4], m[8]], b = [m[1], m[5], m[9]], c = [m[2], m[6], m[10]];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const rows = [cross(b, c), cross(c, a), cross(a, b)];
  const det = a[0] * rows[0][0] + a[1] * rows[0][1] + a[2] * rows[0][2];
  if (src.nor) {
    for (let i = 0; i < src.n; i++) {
      const x = src.nor[i * 3], y = src.nor[i * 3 + 1], z = src.nor[i * 3 + 2];
      const nx = rows[0][0] * x + rows[0][1] * y + rows[0][2] * z;
      const ny = rows[1][0] * x + rows[1][1] * y + rows[1][2] * z;
      const nz = rows[2][0] * x + rows[2][1] * y + rows[2][2] * z;
      const len = Math.hypot(nx, ny, nz) * Math.sign(det) || 1;
      src.nor[i * 3] = nx / len; src.nor[i * 3 + 1] = ny / len; src.nor[i * 3 + 2] = nz / len;
    }
  }
  // A mirrored object turns its triangles inside out.
  if (det < 0) for (let t = 0; t < src.idx.length; t += 3) { const tmp = src.idx[t + 1]; src.idx[t + 1] = src.idx[t + 2]; src.idx[t + 2] = tmp; }
  return src;
}

function mergePrimitives(list) {
  if (list.length === 1) return list[0];
  const n = list.reduce((sum, p) => sum + p.n, 0);
  const idx = new Uint32Array(list.reduce((sum, p) => sum + p.idx.length, 0));
  const out = { n, idx, pos: new Float32Array(n * 3), nor: null, uv: null, uv1: null, col: null };
  const attrs = [['nor', 3, 0], ['uv', 2, 0], ['uv1', 2, 0], ['col', 4, 1]];       // [name, size, fill for parts that lack it]
  for (const [name, size, fill] of attrs) if (list.some((p) => p[name])) out[name] = new Float32Array(n * size).fill(fill);
  let vo = 0, io2 = 0;
  for (const p of list) {
    out.pos.set(p.pos, vo * 3);
    for (const [name, size] of attrs) if (p[name]) out[name].set(p[name], vo * size);
    if (!p.nor && out.nor) for (let i = 0; i < p.n; i++) out.nor[(vo + i) * 3 + 1] = 1;
    for (let i = 0; i < p.idx.length; i++) idx[io2 + i] = p.idx[i] + vo;
    vo += p.n; io2 += p.idx.length;
  }
  return out;
}

// ---------------------------------------------------------------- main pass
const stats = { before: 0, after: 0, chunks: 0, lodChunks: 0, collision: 0 };
const perMaterial = new Map();
const renderNodes = root.listNodes().filter((n) => n.getMesh() && !isCollision(n));
const collisionNodes = root.listNodes().filter((n) => n.getMesh() && isCollision(n));

const groups = new Map();
for (const node of renderNodes) for (const prim of node.getMesh().listPrimitives()) {
  const material = prim.getMaterial();
  if (!groups.has(material)) groups.set(material, []);
  groups.get(material).push(worldPrimitive(node, prim));
}

for (const [material, parts] of groups) {
  const materialName = material?.getName() ?? '';
  const meshName = `ENV_${materialName.split('|')[0].trim().replace(/\W+/g, '_')}_${materialName.split('|')[1]?.trim().split(/\W+/)[0] ?? 'Mesh'}`;
  const klass = /foliage/i.test(materialName) ? CLASSES.foliage : /bark/i.test(materialName) ? CLASSES.bark : CLASSES.general;
  {
    const src = mergePrimitives(parts);
    const mesh = { getName: () => meshName };
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
}

// Collision: bake transforms and merge by area (COL_<Area>_…), exactly as exported otherwise: float positions, no quantising.
const collisionGroups = new Map();
for (const node of collisionNodes) {
  const area = node.getName().split('_')[1] ?? 'Level';
  if (!collisionGroups.has(area)) collisionGroups.set(area, { material: node.getMesh().listPrimitives()[0].getMaterial(), parts: [] });
  for (const prim of node.getMesh().listPrimitives()) collisionGroups.get(area).parts.push(worldPrimitive(node, prim));
}
// Optional: collision modelled as dense as the render mesh (a smooth pool is 100k triangles) is simplified, within `collisionError` metres.
const collisionError = tweaks.collisionError ?? 0;
function simplifyCollision(m) {
  // Vertices are split per normal/UV in the export; weld them by position first or the simplifier sees every triangle as isolated.
  const key = (i) => `${Math.round(m.pos[i * 3] * 1e4)},${Math.round(m.pos[i * 3 + 1] * 1e4)},${Math.round(m.pos[i * 3 + 2] * 1e4)}`;
  const welded = new Map(), remap = new Uint32Array(m.n), pos = [];
  for (let i = 0; i < m.n; i++) {
    const k = key(i);
    let j = welded.get(k);
    if (j === undefined) { j = pos.length / 3; welded.set(k, j); pos.push(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]); }
    remap[i] = j;
  }
  const wpos = Float32Array.from(pos);
  const idx = Uint32Array.from(m.idx, (v) => remap[v]);
  const scale = MeshoptSimplifier.getScale(wpos, 3);
  const [out] = MeshoptSimplifier.simplify(idx, wpos, 3, 0, collisionError / scale, []);
  const used = new Map(), npos = [], nidx = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    let j = used.get(out[i]);
    if (j === undefined) { j = npos.length / 3; used.set(out[i], j); npos.push(wpos[out[i] * 3], wpos[out[i] * 3 + 1], wpos[out[i] * 3 + 2]); }
    nidx[i] = j;
  }
  return { n: npos.length / 3, idx: nidx, pos: Float32Array.from(npos) };
}
for (const [area, { material, parts }] of collisionGroups) {
  let merged = mergePrimitives(parts.map((p) => ({ n: p.n, idx: p.idx, pos: p.pos })));
  if (collisionError > 0) { const before = merged.idx.length / 3; merged = simplifyCollision(merged); console.log(`collision ${area}: ${before} -> ${merged.idx.length / 3} triangles`); }
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(merged.pos).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(merged.n > 65535 ? merged.idx : Uint16Array.from(merged.idx)).setBuffer(buffer));
  scene.addChild(doc.createNode(`COL_${area}`).setMesh(doc.createMesh(`COL_${area}`).addPrimitive(prim)).setExtras({ role: 'collision' }));
  stats.collision += merged.idx.length / 3;
}
// (nodes that instance one mesh share it: it is gone after the first of them is disposed)
for (const node of [...renderNodes, ...collisionNodes]) { const mesh = node.getMesh(); node.dispose(); mesh?.dispose(); }

// Textures: resize and store as WebP.
for (const t of TEXTURES) {
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [t.size, t.size], pattern: t.pattern, quality: t.quality }));
}
// meshopt() would quantise the collision meshes too; compress the buffers without touching their precision.
await doc.transform(prune({ keepExtras: true }), reorder({ encoder: MeshoptEncoder, target: 'size' }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(output, doc);
for (const [name, row] of [...perMaterial].sort((a, b) => b[1][0] - a[1][0])) console.log(`  ${name.slice(0, 44).padEnd(44)} LOD0 ${String(row[0]).padStart(7)}  LOD1 ${String(row[1]).padStart(7)}  LOD2 ${String(row[2]).padStart(7)}`);
console.log(`chunks ${stats.chunks} (${stats.lodChunks} with LODs), render triangles ${stats.before} -> LOD0 ${stats.after}, collision triangles ${stats.collision} in ${collisionGroups.size} meshes`);
