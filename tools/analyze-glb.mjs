import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
console.log('--- textures');
for (const t of root.listTextures()) {
  const img = t.getImage(); const m = await sharp(img).metadata();
  console.log(t.getName().padEnd(24), m.width+'x'+m.height, (img.byteLength/1e6).toFixed(2)+'MB', 'gpu~'+(m.width*m.height*4*1.33/1e6).toFixed(1)+'MB');
}
console.log('--- meshes (node-instance count, tris, verts, bbox)');
const uses = new Map();
for (const n of root.listNodes()) { const m = n.getMesh(); if (m) uses.set(m,(uses.get(m)||0)+1); }
let rows=[]; let totRender=0,totCol=0, dc=0;
for (const mesh of root.listMeshes()) {
  let tris=0, verts=0; const mats=new Set();
  for (const p of mesh.listPrimitives()) { tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount())/3; verts+=p.getAttribute('POSITION').getCount(); mats.add(p.getMaterial()?.getName()); }
  const n = uses.get(mesh)||0;
  const isCol = /COL_|collision/i.test(mesh.getName()) || [...mats].some(x=>/Collision/.test(x||''));
  rows.push({name:mesh.getName(), n, tris, verts, prims: mesh.listPrimitives().length, isCol, mats:[...mats].join('|').slice(0,40)});
  if (isCol) totCol+=tris*n; else { totRender+=tris*n; dc+=mesh.listPrimitives().length*n; }
}
rows.sort((a,b)=>b.tris*b.n-a.tris*a.n);
for (const r of rows.slice(0,40)) console.log(r.name.padEnd(34), 'x'+r.n, String(r.tris).padStart(8), 'v'+r.verts, 'p'+r.prims, r.isCol?'COL':'', r.mats);
console.log('render tris (instances)', totRender, 'collision tris', totCol, 'render draw calls (prims*instances)', dc);
console.log('--- scene');
const sc = root.listScenes()[0];
function walk(n, d){ if(d>2) return; console.log(' '.repeat(d*2)+n.getName(), n.getMesh()?'[mesh '+n.getMesh().getName()+']':'', n.listChildren().length+' kids', JSON.stringify(n.getExtras()).slice(0,80)); if (d<1) n.listChildren().forEach(c=>walk(c,d+1)); }
sc.listChildren().forEach(c=>walk(c,0));
