import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LodSet } from '../dist/src/skate/lod.js';
import { LEVELS, DEFAULT_LEVEL, pickLevel } from '../dist/src/skate/levels.js';
import { makeSkater } from './helpers.mjs';

// One chunk at x = 0..10 with three levels that take over at 20 m and 60 m.
function chunk(scene, group, x = 0) {
  const meshes = [0, 1, 2].map((level) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 10), new THREE.MeshBasicMaterial());
    mesh.position.set(x + 5, 1, 0);
    mesh.userData.lod = { group, level, from: [0, 20, 60][level] };
    scene.add(mesh);
    return mesh;
  });
  return meshes;
}
const shown = (meshes) => meshes.map((m) => m.visible ? 1 : 0).join('');

test('a chunk shows the level its distance calls for', () => {
  const scene = new THREE.Scene();
  const meshes = chunk(scene, 'a');
  const lods = new LodSet(scene);
  lods.update(new THREE.Vector3(-5, 1, 0));
  assert.equal(shown(meshes), '100');
  lods.update(new THREE.Vector3(-30, 1, 0));
  assert.equal(shown(meshes), '010');
  lods.update(new THREE.Vector3(-100, 1, 0));
  assert.equal(shown(meshes), '001');
});

test('distance is measured to the chunk box, so standing beside a big chunk keeps its detail', () => {
  const scene = new THREE.Scene();
  const meshes = chunk(scene, 'a');
  const lods = new LodSet(scene);
  lods.update(new THREE.Vector3(5, 1, 0));
  assert.equal(shown(meshes), '100', 'inside the box is distance zero');
  lods.update(new THREE.Vector3(10 + 19, 1, 0));
  assert.equal(shown(meshes), '100', '19 m from the nearest face is still close');
});

test('a chunk on a boundary does not flicker', () => {
  const scene = new THREE.Scene();
  const meshes = chunk(scene, 'a');
  const lods = new LodSet(scene);
  lods.update(new THREE.Vector3(-5, 1, 0));
  lods.update(new THREE.Vector3(-21, 1, 0));   // 21 m from the face: past 20 but inside the hysteresis band
  assert.equal(shown(meshes), '100');
  lods.update(new THREE.Vector3(-22, 1, 0));
  assert.equal(shown(meshes), '010');
  lods.update(new THREE.Vector3(-19, 1, 0));   // back inside 20 but not yet inside 20 less the band
  assert.equal(shown(meshes), '010');
  lods.update(new THREE.Vector3(-18, 1, 0));
  assert.equal(shown(meshes), '100');
});

test('chunks switch independently and meshes without a lod tag are left alone', () => {
  const scene = new THREE.Scene();
  const near = chunk(scene, 'near', 0);
  const far = chunk(scene, 'far', 200);
  const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  scene.add(plain);
  const lods = new LodSet(scene);
  assert.equal(lods.groups.length, 2);
  lods.update(new THREE.Vector3(0, 1, 0));
  assert.equal(shown(near), '100');
  assert.equal(shown(far), '001');
  assert.equal(plain.visible, true);
  const census = lods.census();
  assert.equal(census[0], 1);
  assert.equal(census[2], 1);
  assert.ok(!census[1]);
});

test('levels: unknown or missing ?level falls back to the default, known ones are picked', () => {
  assert.equal(pickLevel(''), DEFAULT_LEVEL);
  assert.equal(pickLevel('?level=nope'), DEFAULT_LEVEL);
  assert.equal(pickLevel('?level=foundry'), 'foundry');
  for (const [id, level] of Object.entries(LEVELS)) {
    assert.ok(level.name && level.file && level.blurb, `${id} is missing text or a file`);
    assert.ok(level.bounds.x > 0 && level.bounds.z > 0 && level.shadowHalf > 0, `${id} has no play area`);
    assert.ok(level.noShadow instanceof RegExp, `${id} needs a shadow filter`);
  }
});

test('the skater is kept inside its level\'s bounds, centre included', () => {
  const s = makeSkater();
  s.bounds = { x: 10, z: 5, cx: 100, cz: -50 };
  const np = new THREE.Vector3(200, 0, 0);
  s.vel.set(5, 0, -5);
  s.clampBounds(np);
  assert.equal(np.x, 110);
  assert.equal(np.z, -45, 'z is pulled back to the edge of the box around the centre');
  assert.equal(s.vel.x, 0, 'moving out through the edge stops');
  assert.equal(s.vel.z, -5, 'moving back into the box keeps its velocity');
});
