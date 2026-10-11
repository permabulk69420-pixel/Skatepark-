import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rider } from '../dist/src/skate/rider.js';
import { makeSkater, run } from './helpers.mjs';

function makeRider() {
  const skater = makeSkater();
  run(skater, {}, 0.5);
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  rig.add(camera);
  const renderer = { xr: { isPresenting: false, updateCamera() {} } };
  const rider = new Rider({ rig, camera, renderer, sim: skater });
  rider.update(1 / 72);
  return { skater, rider, rig };
}

const riderUp = (rig) => new THREE.Vector3(0, 1, 0).applyQuaternion(rig.quaternion);

test('the view eases into a gentle slope but takes a steep wall almost rigidly', () => {
  for (const [name, tilt, wantFirstFrameAtLeast, wantFirstFrameAtMost] of [['gentle 20° ramp', 0.35, 0, 0.3], ['half-pipe wall 70°', 1.22, 0.65, 1]]) {
    const { skater, rider, rig } = makeRider();
    skater.up.set(Math.sin(tilt), Math.cos(tilt), 0);
    rider.update(1 / 72);
    const done = THREE.MathUtils.clamp(Math.acos(riderUp(rig).y) / tilt, 0, 1.2);
    assert.ok(done >= wantFirstFrameAtLeast && done <= wantFirstFrameAtMost, `${name}: view covered ${(done * 100).toFixed(0)}% of the tilt in one frame`);
    for (let i = 0; i < 72; i++) rider.update(1 / 72);
    assert.ok(riderUp(rig).distanceTo(skater.up) < 0.01, `${name}: view never caught up with the board`);
  }
});

test('the rider is carried with the board: same place, same heading, standing on the deck', () => {
  const { skater, rider, rig } = makeRider();
  skater.vel.set(0, 0, -5);
  run(skater, { steer: 0.4 }, 1.5, 1 / 72, () => rider.update(1 / 72));
  rig.updateMatrixWorld(true);
  const head = new THREE.Vector3(0, 1.65, 0).applyMatrix4(rig.matrixWorld);
  assert.ok(Math.hypot(head.x - skater.pos.x, head.z - skater.pos.z) < 0.05);
  assert.ok(Math.abs(head.y - (skater.pos.y + 0.145 + 1.65)) < 0.05);
});
