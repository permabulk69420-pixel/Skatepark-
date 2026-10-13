import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../tools/make-manifest.mjs';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

test('dist/manifest.json is up to date (run `npm run manifest` after changing anything in dist/)', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  const current = buildManifest(dist);
  const stale = Object.keys({ ...committed.files, ...current.files }).filter((f) => committed.files[f] !== current.files[f]);
  assert.deepEqual(stale, [], `stale in manifest.json: ${stale.join(', ')}. Run npm run manifest.`);
  assert.equal(committed.build, current.build);
});

test('every game module and model is in the manifest, so nothing is ever loaded unversioned', () => {
  const { files } = buildManifest(dist);
  for (const file of ['src/main.js', 'src/skate/sim.js', 'src/skate/rider.js', 'assets/skatepark.glb', 'assets/levels/foundry.glb', 'assets/skateboard.glb', 'models/hands/LeftHand.glb', 'vendor/three.module.js', 'vendor/three.core.js']) {
    assert.ok(files[file], `${file} missing from the manifest`);
  }
  for (const f of fs.readdirSync(path.join(dist, 'src/skate'))) assert.ok(files[`src/skate/${f}`], `src/skate/${f} missing`);
});
