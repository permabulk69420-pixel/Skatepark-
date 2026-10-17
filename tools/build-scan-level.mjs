// Turns a photogrammetry scan (a Sketchfab GLB) into a raw level file that tools/optimise-level.mjs can take:
//   * places the scan: either a small yaw + scale (frame.yawDegrees / frame.scale / frame.centre / frame.groundHeight, for a scan that
//     is already roughly level) or a full 4x4 `frame.matrix` (glTF, column-major) for one that has to be levelled and scaled
//   * names its materials and textures the way the optimiser and levels.js expect (`Scan | alpha`, `<name>_base`)
//   * optionally crops it to an outline (`crop`: [x, z] metres, in the placed level); `cropEdge` { band, minLuma } also drops the dark
//     triangles (vegetation, by vertex colour) within `band` metres of the outline, and `maxHeight` drops anything higher than that above y = 0; `dropVertexColors` removes the colours afterwards
//   * adds a tiled concrete slab around it (with a hole where the crop is) and collision: the scan's own surface
//     (simplified later by the optimiser) plus a flat ground; grind lines and a spawn
//   node tools/build-scan-level.mjs <level.json> <out.glb>
// Grind-line points in level.json are in the scan's levelled frame as Blender shows it (X right, Y forward, Z up), multiplied by
// frame.scale (frame.pointsInMetres: true means they are plain glTF [x, y, z] metres in the placed level instead).
// The spawn is a plain glTF position (Y up, the rider faces -Z at heading 0).
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const [configPath, output] = process.argv.slice(2);
if (!configPath || !output) { console.error('usage: node tools/build-scan-level.mjs <level.json> <out.glb>'); process.exit(1); }
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const io = new NodeIO().registerExtensions([KHRMaterialsUnlit]);
const doc = await io.read(path.join(repo, config.scan));
const root = doc.getRoot();
const scene = root.listScenes()[0];
const buffer = root.listBuffers()[0];

// --- place the scan
const scanRoot = doc.createNode('ScanRoot');
let scale = 1;
if (config.frame.matrix) {
  scanRoot.setMatrix(config.frame.matrix);
} else {
  // rotate about Y by the yaw around the scan's centre, centre it on the origin, drop it onto y = 0, scale it
  // (Blender's X, Y, Z are glTF's X, -Z, Y)
  const yaw = config.frame.yawDegrees * Math.PI / 180;
  const [cx, cy] = config.frame.centre;
  const [sin, cos] = [Math.sin(yaw), Math.cos(yaw)];
  scale = config.frame.scale ?? 1;
  const rotated = [cx * cos - cy * sin, 0, -cx * sin - cy * cos];
  scanRoot.setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)])
    .setScale([scale, scale, scale])
    .setTranslation([-rotated[0] * scale, -config.frame.groundHeight * scale, -rotated[2] * scale]);
}
for (const child of scene.listChildren()) { scene.removeChild(child); scanRoot.addChild(child); }
scene.addChild(scanRoot);
const pointsScale = config.frame.pointsInMetres ? 0 : scale;
const place = ([x, y, z]) => (pointsScale ? [x * pointsScale, z * pointsScale, -y * pointsScale] : [x, y, z]);

// --- materials and textures
for (const rule of config.materials) {
  const material = root.listMaterials().find((m) => m.getName() === rule.from);
  if (!material) throw new Error(`no material ${rule.from}`);
  material.setName(rule.name);
  material.getBaseColorTexture().setName(rule.texture);
  if (rule.unlit) material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
  if (rule.roughness !== undefined) material.setRoughnessFactor(rule.roughness);
}

// --- crop the scan to an outline (triangles whose centre is outside it are dropped) and drop vertex colours
const inside = (x, z, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
};
const edgeDistance = (x, z, poly) => {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
};
let dropped = 0;
const meshNodes = root.listNodes().filter((x) => x.getMesh() && x !== scanRoot);
for (const node of meshNodes) {
  const m = node.getWorldMatrix();
  for (const prim of node.getMesh().listPrimitives()) {
    const colour = prim.getAttribute('COLOR_0');
    const luma = (i) => { const [r, g, b] = colour.getElement(i, [0, 0, 0, 0]); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    if (!config.crop) { if (config.dropVertexColors) prim.setAttribute('COLOR_0', null); continue; }
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices().getArray();
    const world = (i) => { const [x, y, z] = pos.getElement(i, [0, 0, 0]); return [m[0] * x + m[4] * y + m[8] * z + m[12], m[2] * x + m[6] * y + m[10] * z + m[14], m[1] * x + m[5] * y + m[9] * z + m[13]]; };
    const kept = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = world(idx[t]), b = world(idx[t + 1]), c = world(idx[t + 2]);
      const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[1] + b[1] + c[1]) / 3;
      if (!inside(cx, cz, config.crop)) continue;
      if (config.maxHeight !== undefined && (a[2] + b[2] + c[2]) / 3 > config.maxHeight) { dropped++; continue; }
      if (config.cropEdge && colour && (luma(idx[t]) + luma(idx[t + 1]) + luma(idx[t + 2])) / 3 < config.cropEdge.minLuma
        && edgeDistance(cx, cz, config.crop) < config.cropEdge.band) { dropped++; continue; }
      kept.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    if (config.dropVertexColors) prim.setAttribute('COLOR_0', null);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(kept)).setBuffer(buffer));
  }
}

if (config.cropEdge || config.maxHeight !== undefined) console.log(`dropped ${dropped} triangles at the crop edge (vegetation)`);

// --- collision: the scan's own surface (same mesh, same transform chain), simplified by the optimiser
const collisionName = config.collisionName ?? 'Scan';
let n = 0;
for (const node of meshNodes) {
  const copy = doc.createNode(`COL_${collisionName}_${n++}`).setMesh(node.getMesh()).setMatrix(node.getMatrix()).setExtras({ role: 'collision' });
  node.getParentNode().addChild(copy);
}

// --- slab: a visual plane just under the scan's ground, and the flat ground it is ridden on. With a crop outline the slab is a
// grid of 0.5 m cells with the ones entirely inside the hole (`slab.hole`, default the crop outline) left out: the scan covers them, and
// anything the scan lost near its edge is filled by the slab, which sits 2 cm under the scan's ground.
const half = config.slab.half;
const hole = config.slab.hole ?? config.crop;
const cellSize = hole ? 0.5 : half * 2;
const tile = config.slab.tileMetres;
const set = path.basename(config.slab.textures);
const loadBuffer = (suffix) => fs.readFileSync(path.join(repo, `${config.slab.textures}_${suffix}_2k.jpg`));
const texture = (name, bytes) => doc.createTexture(name).setImage(new Uint8Array(bytes)).setMimeType('image/jpeg');
let diffuse = loadBuffer('diff');
if (config.slab.matchColor) {
  // Scale the colour so the slab's average matches the scan's apron.
  const mean = (await sharp(diffuse).stats()).channels.map((c) => c.mean);
  diffuse = await sharp(diffuse).linear(config.slab.matchColor.map((t, i) => t / mean[i]), [0, 0, 0]).jpeg({ quality: 92 }).toBuffer();
}
const orm = texture(`${set}_orm`, loadBuffer('arm'));
const slabMaterial = doc.createMaterial('Concrete | ground').setBaseColorFactor(config.slab.tint ?? [1, 1, 1, 1])
  .setBaseColorTexture(texture(`${set}_base`, diffuse))
  .setNormalTexture(texture(`${set}_normal`, loadBuffer('nor_gl')))
  .setMetallicRoughnessTexture(orm).setOcclusionTexture(orm);
const slabPrimitive = (y, withUv) => {
  const position = [], uv = [], index = [];
  const cells = Math.round(half * 2 / cellSize);
  for (let i = 0; i < cells; i++) for (let k = 0; k < cells; k++) {
    const x0 = -half + i * cellSize, z0 = -half + k * cellSize, x1 = x0 + cellSize, z1 = z0 + cellSize;
    if (hole && [[x0, z0], [x0, z1], [x1, z1], [x1, z0], [(x0 + x1) / 2, (z0 + z1) / 2]].every(([x, z]) => inside(x, z, hole))) continue;
    const base = position.length / 3;
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]) { position.push(x, y, z); uv.push(x / tile, z / tile); }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', accessor('VEC3', new Float32Array(position)))
    .setIndices(accessor('SCALAR', new Uint32Array(index)));
  if (withUv) {
    prim.setAttribute('NORMAL', accessor('VEC3', new Float32Array(position.map((_, i) => (i % 3 === 1 ? 1 : 0)))));
    prim.setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uv)));
  }
  return prim;
};
scene.addChild(doc.createNode('Slab').setMesh(doc.createMesh('Slab').addPrimitive(slabPrimitive(-0.02, true).setMaterial(slabMaterial))));
scene.addChild(doc.createNode('COL_Ground').setMesh(doc.createMesh('COL_Ground').addPrimitive(slabPrimitive(0, false).setMaterial(slabMaterial))).setExtras({ role: 'collision' }));

// --- grind lines and spawn
for (const ledge of config.ledges ?? []) {
  scene.addChild(doc.createNode(`PATH_${ledge.name}`).setExtras({
    role: 'grind_path', kind: ledge.kind ?? 'ledge', closed: !!ledge.closed, radius: ledge.radius ?? 0.03,
    points: ledge.points.flatMap((p) => place(p).map((v) => Math.round(v * 1000) / 1000))
  }));
}
const { x, y, z, heading } = config.spawn;
scene.addChild(doc.createNode('Spawn_Entrance').setTranslation([x, y, z]).setExtras({ role: 'spawn', heading_radians: heading }));

await io.write(output, doc);
console.log(`${output}: ${root.listNodes().length} nodes, ${(config.ledges ?? []).length} grind lines`);
