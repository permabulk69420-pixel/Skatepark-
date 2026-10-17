// Turns a photogrammetry scan (a Sketchfab GLB) into a raw level file that tools/optimise-level.mjs can take:
//   * places the scan: either a small yaw + scale (frame.yawDegrees / frame.scale / frame.centre / frame.groundHeight, for a scan that
//     is already roughly level) or a full 4x4 `frame.matrix` (glTF, column-major) for one that has to be levelled and scaled
//   * `dropMaterials` removes meshes using those materials (an untextured base block, say); no `slab` means no slab or ground plane
//   * names its materials and textures the way the optimiser and levels.js expect (`Scan | alpha`, `<name>_base`)
//   * optionally crops it to an outline (`crop`: [x, z] metres, in the placed level); `cropEdge` { band, minLuma } also drops the dark
//     triangles (vegetation, by vertex colour) within `band` metres of the outline, and `maxHeight` drops anything higher than that above y = 0; `dropVertexColors` removes the colours afterwards
//   * `flatten` { width, y, steep }: outside the slab hole the scan is pressed flat onto y over `width` metres (so its ragged edge ends
//     flush with the slab instead of hanging over it), and near-vertical triangles out there (flaps) are dropped
//   * adds a tiled concrete slab around it (with a hole, `slab.hole`, where the scan is: star-shaped about `slab.holeCentre`) and collision: the scan's own surface
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

// --- drop meshes that use the named materials (e.g. a scan's untextured base block)
for (const name of config.dropMaterials ?? []) {
  for (const node of root.listNodes().filter((x) => x.getMesh()?.listPrimitives().some((p) => p.getMaterial()?.getName() === name))) {
    const mesh = node.getMesh(); node.dispose(); mesh.dispose();
  }
}

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
const outsideHole = (x, z) => (inside(x, z, config.slab.hole) ? 0 : edgeDistance(x, z, config.slab.hole));
const textures = new Map();
const pixels = async (texture) => {
  if (!textures.has(texture)) textures.set(texture, await sharp(Buffer.from(texture.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
  return textures.get(texture);
};
let dropped = 0;
const meshNodes = root.listNodes().filter((x) => x.getMesh() && x !== scanRoot);
for (const node of meshNodes) {
  const m = node.getWorldMatrix();
  for (const prim of node.getMesh().listPrimitives()) {
    if (!config.crop) { if (config.dropVertexColors) prim.setAttribute('COLOR_0', null); continue; }
    const pos = prim.getAttribute('POSITION');
    const uv = prim.getAttribute('TEXCOORD_0');
    const idx = prim.getIndices().getArray();
    const edge = config.cropEdge;
    const image = edge && prim.getMaterial().getBaseColorTexture() ? await pixels(prim.getMaterial().getBaseColorTexture()) : null;
    const world = (i) => { const [x, y, z] = pos.getElement(i, [0, 0, 0]); return [m[0] * x + m[4] * y + m[8] * z + m[12], m[2] * x + m[6] * y + m[10] * z + m[14], m[1] * x + m[5] * y + m[9] * z + m[13]]; };
    const texel = (i) => {
      const [u, v] = uv.getElement(i, [0, 0]);
      const px = Math.min(image.info.width - 1, Math.max(0, Math.floor(u * image.info.width)));
      const py = Math.min(image.info.height - 1, Math.max(0, Math.floor(v * image.info.height)));
      const o = (py * image.info.width + px) * image.info.channels;
      return [image.data[o], image.data[o + 1], image.data[o + 2]];
    };
    const kept = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = world(idx[t]), b = world(idx[t + 1]), c = world(idx[t + 2]);
      const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[1] + b[1] + c[1]) / 3;
      if (!inside(cx, cz, config.crop)) continue;
      if (config.maxHeight !== undefined && (a[2] + b[2] + c[2]) / 3 > config.maxHeight) { dropped++; continue; }
      if (image && !inside(cx, cz, edge.keep)) {
        const tx = [texel(idx[t]), texel(idx[t + 1]), texel(idx[t + 2])];
        const r = (tx[0][0] + tx[1][0] + tx[2][0]) / 3, g = (tx[0][1] + tx[1][1] + tx[2][1]) / 3, bl = (tx[0][2] + tx[1][2] + tx[2][2]) / 3;
        if (0.2126 * r + 0.7152 * g + 0.0722 * bl < edge.darkLuma || r - bl > edge.maxWarm) { dropped++; continue; }
      }
      if (config.flatten && outsideHole(cx, cz) > 0) {
        // near-vertical triangles out here are flaps hanging off the edge
        const ux = b[0] - a[0], uy = b[2] - a[2], uz = b[1] - a[1], vx = c[0] - a[0], vy = c[2] - a[2], vz = c[1] - a[1];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1) < config.flatten.steep) { dropped++; continue; }
      }
      kept.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    if (config.flatten) {
      // press the vertices outside the hole down onto flatten.y, fading in over flatten.width metres
      // The node maps local to world as world = A * local + t. A world height change d is a local move of d * (A^-1)'s Y column.
      const A = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
      const cof = (r, c) => { const [r1, r2] = [0, 1, 2].filter((k) => k !== r), [c1, c2] = [0, 1, 2].filter((k) => k !== c); return (((r + c) % 2) ? -1 : 1) * (A[r1][c1] * A[r2][c2] - A[r1][c2] * A[r2][c1]); };
      const det = A[0][0] * cof(0, 0) + A[0][1] * cof(0, 1) + A[0][2] * cof(0, 2);
      const column = [cof(1, 0) / det, cof(1, 1) / det, cof(1, 2) / det];   // (A^-1)[i][1] = cofactor(1, i) / det
      const tmp = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        const [x, y, z] = pos.getElement(i, tmp);
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wz = m[2] * x + m[6] * y + m[10] * z + m[14], wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const k = Math.min(1, outsideHole(wx, wz) / config.flatten.width);
        if (k <= 0) continue;
        const delta = (config.flatten.y - wy) * k * k * (3 - 2 * k);
        pos.setElement(i, [x + column[0] * delta, y + column[1] * delta, z + column[2] * delta]);
      }
    }
    if (config.dropVertexColors) prim.setAttribute('COLOR_0', null);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(kept)).setBuffer(buffer));
  }
}
if (config.cropEdge || config.maxHeight !== undefined) console.log(`dropped ${dropped} triangles at the crop edge (plants, dirt)`);

// --- collision: the scan's own surface (same mesh, same transform chain), simplified by the optimiser
const collisionName = config.collisionName ?? 'Scan';
let n = 0;
for (const node of meshNodes) {
  const copy = doc.createNode(`COL_${collisionName}_${n++}`).setMesh(node.getMesh()).setMatrix(node.getMatrix()).setExtras({ role: 'collision' });
  node.getParentNode().addChild(copy);
}

if (config.slab) {
  // --- slab: a visual plane just under the scan's ground, and the flat ground it is ridden on. The slab goes right up to the edge of the
  // hole, under the scan's margin, so anything the scan lost near its edge is filled by the slab (2 cm under the scan's ground).
  const half = config.slab.half;
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
  // Ground at height y: one square, or with a `slab.hole` (star-shaped about its centre) the ring between the square and the hole, cut into quads along rays
  // from the hole's centre (through every hole corner and every square corner, so each quad has one straight edge on each side).
  // (a ray can cross a star-shaped hole only once, which is what the cutting relies on)
  const ring = (hole) => {
    const centre = config.slab.holeCentre ?? [hole.reduce((s, p) => s + p[0], 0) / hole.length, hole.reduce((s, p) => s + p[1], 0) / hole.length];
    const corners = [[-half, -half], [-half, half], [half, half], [half, -half]];
    const angle = ([x, z]) => Math.atan2(z - centre[1], x - centre[0]);
    const angles = [...hole, ...corners].map(angle).sort((p, q) => p - q);
    const hit = (a, poly, closedSquare) => {   // first boundary crossing of the ray from the centre at angle a
      const d = [Math.cos(a), Math.sin(a)];
      let best = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, az] = poly[j], [bx, bz] = poly[i];
        const ex = bx - ax, ez = bz - az, det = d[0] * -ez - d[1] * -ex;
        if (Math.abs(det) < 1e-12) continue;
        const t = ((ax - centre[0]) * -ez - (az - centre[1]) * -ex) / det;
        const u = (d[0] * (az - centre[1]) - d[1] * (ax - centre[0])) / det;
        if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
      }
      return [centre[0] + d[0] * best, centre[1] + d[1] * best];
    };
    const inner = angles.map((a) => hit(a, hole)), outer = angles.map((a) => hit(a, corners));
    const quads = [];
    for (let i = 0; i < angles.length; i++) { const k = (i + 1) % angles.length; quads.push([inner[i], outer[i], outer[k], inner[k]]); }
    return quads;
  };
  const slabPrimitive = (y, withUv) => {
    const position = [], uv = [], index = [];
    const quads = config.slab.hole ? ring(config.slab.hole) : [[[-half, -half], [-half, half], [half, half], [half, -half]]];
    for (const quad of quads) {
      const base = position.length / 3;
      for (const [x, z] of quad) { position.push(x, y, z); uv.push(x / tile, z / tile); }
      for (const tri of [[0, 1, 2], [0, 2, 3]]) {
        const [p, q, r] = tri.map((k) => [position[(base + k) * 3], position[(base + k) * 3 + 2]]);
        const up = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);   // the sign of the face normal's Y for (x, z) winding
        index.push(...(up < 0 ? tri.map((k) => base + k) : [base + tri[0], base + tri[2], base + tri[1]]));
      }
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
}

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
