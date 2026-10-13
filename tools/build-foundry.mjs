// Builds the Foundry park from code:  node tools/build-foundry.mjs [out.glb]
//   tools/foundry/park.mjs   the layout (every ramp, stair, rail and the loop) as world-space triangles, collision and grind lines
//   tools/foundry/bake-ao.mjs   ambient occlusion baked into the vertex colours
// It writes a raw GLB with the usual level conventions (ENV_ render meshes, COL_ collision, PATH_ grind lines, LOOP_ loop tracks,
// Spawn_ nodes) and runs it through tools/optimise-level.mjs, like the other levels, into dist/assets/levels/foundry.glb.
// Textures are CC0 sets from Poly Haven (source/textures, 1K): brushed_concrete, garage_floor, concrete_floor, plywood.
import { Document, NodeIO } from '@gltf-transform/core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import sharp from 'sharp';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPark, MATERIALS } from './foundry/park.mjs';
import { bakeAO } from './foundry/bake-ao.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const out = process.argv[2] || path.join(repo, 'dist/assets/levels/foundry.glb');
const raw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-')), 'foundry-raw.glb');

const t0 = Date.now();
const park = buildPark();
const renderParts = Object.entries(park.parts).filter(([, p]) => p.idx.length);
for (const [key, part] of renderParts) {
  const m = MATERIALS[key];
  part.aoSkipCast = !!m.decal;                // decals lie on the floor: they must not shade it
  part.aoSkipShade = key === 'apron';         // far away and flat: left white
  part.vary = m.vary || 0;                    // weathering: how much the tone wanders across big surfaces
}
const shaded = bakeAO(renderParts.map(([, p]) => p), { rays: Number(process.env.AO_RAYS || 40) });
let renderTris = 0;
for (const [key, part] of renderParts) {
  renderTris += part.triangleCount;
  console.log(`  ${MATERIALS[key].name.padEnd(42)} ${String(part.triangleCount).padStart(7)} tris`);
}
console.log(`render ${renderTris} triangles, ${shaded} vertices shaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- write the raw GLB
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Foundry');
// The Poly Haven scans are darker and warmer than the rest of the game's concrete; their colour maps are graded to these average
// sRGB colours (saturation first, then a per-channel gain), so the park sits in the same light as Breakwater.
const GRADE = {
  brushed_concrete: { saturation: 0.55, mean: [170, 169, 165] },
  garage_floor: { saturation: 0.45, mean: [184, 183, 179] },
  concrete_floor: { saturation: 0.6, mean: [198, 189, 174] },
  plywood: { saturation: 0.95, mean: [184, 146, 102] }
};
async function graded(file, grade) {
  const desat = await sharp(file).modulate({ saturation: grade.saturation }).toBuffer();
  const stats = await sharp(desat).stats();
  const gain = grade.mean.map((m, i) => m / stats.channels[i].mean);
  return sharp(desat).linear(gain, [0, 0, 0]).jpeg({ quality: 93 }).toBuffer();
}
const textures = new Map();
const sets = new Set(Object.values(MATERIALS).map((m) => m.textures).filter(Boolean));
for (const set of sets) {
  for (const [kind, suffix] of [['base', 'diff'], ['normal', 'nor_gl'], ['orm', 'arm']]) {
    const file = path.join(repo, 'source/textures', `${set}_${suffix}_1k.jpg`);
    const image = kind === 'base' && GRADE[set] ? await graded(file, GRADE[set]) : fs.readFileSync(file);
    textures.set(`${set}_${kind}`, doc.createTexture(`${set}_${kind}`).setImage(image).setMimeType('image/jpeg').setURI(`${set}_${kind}.jpg`));
  }
}
const texture = (set, kind) => textures.get(`${set}_${kind}`);
const materials = {};
for (const [key, m] of Object.entries(MATERIALS)) {
  const mat = doc.createMaterial(m.name).setBaseColorFactor(m.color);
  if (m.textures) {
    mat.setBaseColorTexture(texture(m.textures, 'base'))
      .setNormalTexture(texture(m.textures, 'normal'))
      .setMetallicRoughnessTexture(texture(m.textures, 'orm'))
      .setOcclusionTexture(texture(m.textures, 'orm'))
      .setMetallicFactor(1).setRoughnessFactor(1);
  } else {
    mat.setMetallicFactor(m.metallic ?? 0).setRoughnessFactor(m.roughness ?? 0.8);
  }
  materials[key] = mat;
}
const collisionMaterial = doc.createMaterial('MAT_Collision').setBaseColorFactor([0.1, 0.5, 0.2, 1]);
const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

for (const [key, part] of renderParts) {
  const prim = doc.createPrimitive().setMaterial(materials[key])
    .setAttribute('POSITION', accessor('VEC3', Float32Array.from(part.pos)))
    .setAttribute('NORMAL', accessor('VEC3', Float32Array.from(part.nor)))
    .setAttribute('TEXCOORD_0', accessor('VEC2', Float32Array.from(part.uv)))
    .setIndices(accessor('SCALAR', Uint32Array.from(part.idx)));
  if (part.col) prim.setAttribute('COLOR_0', accessor('VEC4', part.col));
  const name = `ENV_${key}`;
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setExtras({ role: 'environment' }));
}
let collisionTris = 0;
for (const part of Object.values(park.cols)) {
  collisionTris += part.triangleCount;
  const prim = doc.createPrimitive().setMaterial(collisionMaterial)
    .setAttribute('POSITION', accessor('VEC3', Float32Array.from(part.pos)))
    .setIndices(accessor('SCALAR', Uint32Array.from(part.idx)));
  scene.addChild(doc.createNode(part.name).setMesh(doc.createMesh(part.name).addPrimitive(prim)).setExtras({ role: 'collision' }));
}
for (const p of park.paths) scene.addChild(doc.createNode(p.name).setExtras({ role: 'grind_path', kind: p.kind, closed: p.closed, radius: p.radius, points: p.points }));
for (const l of park.loops) scene.addChild(doc.createNode(l.name).setExtras({ role: 'loop_path', width: l.width, points: l.points, normals: l.normals }));
for (const s of park.spawns) scene.addChild(doc.createNode(s.name).setTranslation([s.pos.x, s.pos.y, s.pos.z]).setExtras({ role: 'spawn', heading_radians: s.heading }));
await new NodeIO().write(raw, doc);
console.log(`collision ${collisionTris} triangles in ${Object.keys(park.cols).length} meshes, ${park.paths.length} grind lines, ${park.loops.length} loop`);
console.log(`raw ${raw} ${(fs.statSync(raw).size / 1e6).toFixed(1)} MB`);

execFileSync(process.execPath, [path.join(here, 'optimise-level.mjs'), raw, out], { stdio: 'inherit' });
console.log(`${out} ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
