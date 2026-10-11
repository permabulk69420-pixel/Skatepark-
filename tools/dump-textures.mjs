// Writes a GLB's textures out as image files so they can be eyeballed:  node tools/dump-textures.mjs <in.glb> <outdir>
import fs from 'fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const [input, dir] = process.argv.slice(2);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
fs.mkdirSync(dir, { recursive: true });
for (const t of doc.getRoot().listTextures()) fs.writeFileSync(`${dir}/${t.getName()}.${t.getMimeType().split('/')[1].replace('jpeg', 'jpg')}`, t.getImage());
