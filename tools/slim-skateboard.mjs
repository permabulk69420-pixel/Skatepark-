// Makes the Quest game version of the RIFT skateboard from the untouched master in source/.
// Usage (from a scratch dir with @gltf-transform/core, @gltf-transform/extensions, @gltf-transform/functions, sharp installed):
//   node slim-skateboard.mjs source/RIFT_Skateboard.glb dist/assets/skateboard.glb
// Geometry is untouched; textures become WebP (deck colour 2K, the rest 1K), which the park already loads via EXT_texture_webp.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const size = { Deck_BaseColor: 2048, Deck_Normal: 1024, Deck_ORM: 1024, Hardware_BaseColor: 1024, Hardware_Normal: 1024, Hardware_ORM: 256 };
for (const tex of doc.getRoot().listTextures()) {
  const target = size[tex.getName()] ?? 1024;
  await textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [target, target], quality: 88, slots: /./, pattern: new RegExp(`^${tex.getName()}$`) })(doc);
}
await io.write(out, doc);
