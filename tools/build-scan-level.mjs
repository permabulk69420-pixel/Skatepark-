// Turns a photogrammetry scan (a Sketchfab GLB) into a raw level file that tools/optimise-level.mjs can take:
//   * levels the scan (small yaw so its edges run along X, ground at y = 0) and centres it on the origin
//   * names its materials and textures the way the optimiser and levels.js expect (`Scan | alpha`, `<name>_base`)
//   * keeps the scan's own (unlit) material, adds a tiled concrete slab around it
//   * adds collision (the scan surface itself, simplified later by the optimiser, plus a flat ground plane), grind lines and a spawn
//   node tools/build-scan-level.mjs <level.json> <out.glb>
// Grind-line points in level.json are in the scan's levelled frame as Blender shows it (X right, Y forward, Z up), metres.
// The spawn is a plain glTF position (Y up, the rider faces -Z at heading 0).
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
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

// --- level the scan: rotate about Y by the yaw around the scan's centre, centre it on the origin, drop it onto y = 0, scale it
// (Blender's X, Y, Z are glTF's X, -Z, Y)
const yaw = config.frame.yawDegrees * Math.PI / 180;
const [cx, cy] = config.frame.centre;
const centre = [cx, 0, -cy];
const [sin, cos] = [Math.sin(yaw), Math.cos(yaw)];
const rotate = ([x, y, z]) => [x * cos + z * sin, y, -x * sin + z * cos];
const scale = config.frame.scale ?? 1;
const rotated = rotate(centre);
const scanRoot = doc.createNode('ScanRoot')
  .setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)])
  .setScale([scale, scale, scale])
  .setTranslation([-rotated[0] * scale, -config.frame.groundHeight * scale, -rotated[2] * scale]);
for (const child of scene.listChildren()) { scene.removeChild(child); scanRoot.addChild(child); }
scene.addChild(scanRoot);
// Points given in the scan's levelled, unscaled Blender frame, as glTF positions.
const place = ([x, y, z]) => [x * scale, z * scale, -y * scale];

// --- materials and textures
for (const rule of config.materials) {
  const material = root.listMaterials().find((m) => m.getName() === rule.from);
  if (!material) throw new Error(`no material ${rule.from}`);
  material.setName(rule.name);
  material.getBaseColorTexture().setName(rule.texture);
}

// --- collision: the scan's own surface (same mesh, same transform chain), simplified by the optimiser
let n = 0;
for (const node of root.listNodes().filter((x) => x.getMesh() && x !== scanRoot)) {
  const copy = doc.createNode(`COL_Funbox_${n++}`).setMesh(node.getMesh()).setMatrix(node.getMatrix()).setExtras({ role: 'collision' });
  node.getParentNode().addChild(copy);
}

// --- slab: a visual plane just under the scan's ground, and the flat ground it is ridden on
const half = config.slab.half;
const tile = half * 2 / config.slab.tileMetres;
const slabMaterial = doc.createMaterial('Concrete | ground').setBaseColorFactor(config.slab.tint);
const loadTexture = (suffix, name, mime = 'image/jpeg') => doc.createTexture(name)
  .setImage(new Uint8Array(fs.readFileSync(path.join(repo, `${config.slab.textures}_${suffix}_2k.jpg`)))).setMimeType(mime);
const set = path.basename(config.slab.textures);
const orm = loadTexture('arm', `${set}_orm`);
slabMaterial.setBaseColorTexture(loadTexture('diff', `${set}_base`))
  .setNormalTexture(loadTexture('nor_gl', `${set}_normal`))
  .setMetallicRoughnessTexture(orm).setOcclusionTexture(orm);
const quad = (y, uvScale) => {
  const position = new Float32Array([-half, y, -half, -half, y, half, half, y, half, half, y, -half]);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(position).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer));
  if (uvScale) {
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])).setBuffer(buffer));
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 0, uvScale, uvScale, uvScale, uvScale, 0])).setBuffer(buffer));
  }
  return prim;
};
scene.addChild(doc.createNode('Slab').setMesh(doc.createMesh('Slab').addPrimitive(quad(-0.02, tile).setMaterial(slabMaterial))));
scene.addChild(doc.createNode('COL_Ground').setMesh(doc.createMesh('COL_Ground').addPrimitive(quad(0, 0).setMaterial(slabMaterial))).setExtras({ role: 'collision' }));

// --- grind lines and spawn
for (const ledge of config.ledges) {
  scene.addChild(doc.createNode(`PATH_${ledge.name}`).setExtras({
    role: 'grind_path', kind: 'ledge', closed: false, radius: 0.03, points: ledge.points.flatMap((p) => place(p).map((v) => Math.round(v * 1000) / 1000))
  }));
}
const { x, y, z, heading } = config.spawn;
scene.addChild(doc.createNode('Spawn_Entrance').setTranslation([x, y, z]).setExtras({ role: 'spawn', heading_radians: heading }));

await io.write(output, doc);
console.log(`${output}: ${root.listNodes().length} nodes, ${config.ledges.length} grind lines`);
