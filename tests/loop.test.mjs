import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkateWorld } from '../dist/src/skate/world.js';
import { Skater, Mode } from '../dist/src/skate/sim.js';
import { LoopPath, loopRibbon } from '../dist/src/skate/loop.js';
import { run } from './helpers.mjs';

// A loop on a flat floor, built as real triangles (the riding surface, facing into the loop) so the game's own collision code is
// what the board rolls onto. It starts at the origin heading −Z, like the park's.
const SHAPE = { start: [0, 0.003, 0], heading: 0, length: 17, alpha: 0.7, shift: 2.8 };
const WIDTH = 2.4;

function loopWorld() {
  const ribbon = loopRibbon(SHAPE);
  const path = new LoopPath({ name: 'test loop', ...ribbon, width: WIDTH });
  const pos = [];
  for (let i = 0; i + 1 < path.p.length; i++) {
    const [l0, r0, l1, r1] = [[i, -1], [i, 1], [i + 1, -1], [i + 1, 1]].map(([k, side]) => path.p[k].clone().addScaledVector(path.b[k], side * WIDTH / 2));
    pos.push(...l0.toArray(), ...r0.toArray(), ...l1.toArray(), ...r0.toArray(), ...r1.toArray(), ...l1.toArray());
  }
  const ribbonGeometry = new THREE.BufferGeometry();
  ribbonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  const track = new THREE.Mesh(ribbonGeometry, new THREE.MeshBasicMaterial());
  for (const m of [floor, track]) { m.updateMatrixWorld(true); m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere(); }
  return { world: new SkateWorld([floor, track]), path };
}

function rollIn(speed, { drive = 0, from = 6 } = {}) {
  const { world, path } = loopWorld();
  const events = [];
  let seed = 3;
  const skater = new Skater({ world, loops: [path], random: () => (seed = (seed * 16807) % 2147483647) / 2147483647, onEvent: (type, data) => events.push({ type, data }) });
  skater.respawn({ pos: new THREE.Vector3(0, 0, from), heading: 0 });
  run(skater, {}, 0.3);
  skater.vel.set(0, 0, -speed);
  return { skater, events, path };
}

const names = (events, type) => events.filter((e) => e.type === type).map((e) => e.data);

test('the loop shape is a closed teardrop about 4.6 m tall whose exit runs beside the way in', () => {
  const { path } = loopWorld();
  assert.ok(path.top > 4.2 && path.top < 5, `top ${path.top}`);
  const end = path.p[path.p.length - 1];
  assert.ok(Math.abs(end.y - SHAPE.start[1]) < 0.01, 'ends on the floor');
  assert.ok(Math.abs(end.x - SHAPE.shift) < 0.01, 'exit is shifted sideways by the shift');
  assert.ok(end.z < -4, 'and comes out ahead of where it went in');
  // Both ends point straight along the heading, flat on the floor.
  for (const i of [0, path.t.length - 1]) {
    assert.ok(path.t[i].z < -0.999, `end tangent ${path.t[i].toArray()}`);
    assert.ok(path.n[i].y > 0.999, `end normal ${path.n[i].toArray()}`);
  }
  // Upside down at the top.
  assert.ok(Math.min(...path.n.map((n) => n.y)) < -0.99);
});

test('rolling in fast enough goes all the way round and out the other side', () => {
  const { skater, events } = rollIn(11.5);
  let minUp = 1, modes = new Set();
  run(skater, {}, 4, 1 / 72, (t, s) => { modes.add(s.mode); minUp = Math.min(minUp, s.up.y); });
  assert.ok(modes.has(Mode.LOOP), 'rode the loop');
  assert.deepEqual(names(events, 'bail'), []);
  const ends = names(events, 'loopEnd');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].completed, true);
  assert.ok(minUp < -0.95, 'the board was upside down at the top');
  assert.equal(skater.mode, Mode.GROUND);
  assert.ok(skater.pos.z < -10, `rolled on out of the loop (${skater.pos.z.toFixed(1)})`);
  assert.ok(Math.abs(skater.pos.x - SHAPE.shift) < 0.6, `on the exit lane (${skater.pos.x.toFixed(2)})`);
  assert.ok(skater.vel.z < -5, 'still going the same way, with most of its speed');
  assert.ok(Math.abs(wrapAngle(skater.heading)) < 0.05, 'heading straight out');
});

test('too slow and you fall from the top: a bail', () => {
  const { skater, events } = rollIn(9.2);
  run(skater, {}, 3);
  assert.deepEqual(names(events, 'bail').map((d) => d.reason), ['loop']);
  assert.equal(names(events, 'loopEnd')[0].reason, 'fell');
});

test('slow enough to stay below the vertical and you roll back out the way you came, fakie', () => {
  const { skater, events } = rollIn(6);
  run(skater, {}, 4);
  assert.deepEqual(names(events, 'bail'), []);
  const ends = names(events, 'loopEnd');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].reason, 'start');
  assert.equal(ends[0].completed, false);
  assert.equal(skater.mode, Mode.GROUND);
  assert.ok(skater.vel.z > 2, 'rolling back out');
});

test('the speed needed is between the two: about 10.8 m/s, and pumping (holding forward) gets you round from about 10.1', () => {
  const makes = (speed, drive) => {
    const { skater, events } = rollIn(speed);
    run(skater, { drive }, 4);
    return names(events, 'loopEnd').some((d) => d.completed) && !names(events, 'bail').length;
  };
  assert.equal(makes(11.2, 0), true);
  assert.equal(makes(10.5, 0), false);
  assert.equal(makes(10.5, 1), true);
  assert.equal(makes(9.8, 1), false);
});

test('the view frame turns smoothly all the way round: no flips at the vertical walls or the top', () => {
  const { skater } = rollIn(11.5);
  const q = new THREE.Quaternion(), prev = new THREE.Quaternion();
  let first = true, worst = 0;
  const up = new THREE.Vector3();
  run(skater, {}, 3, 1 / 72, (t, s) => {
    if (s.mode !== Mode.LOOP && s.mode !== Mode.GROUND) return;
    s.boardQuaternion(q, false, s.groundNormal);
    up.set(0, 1, 0).applyQuaternion(q);
    assert.ok(up.dot(s.groundNormal) > 0.999, 'board up is the track normal');
    if (!first) worst = Math.max(worst, q.angleTo(prev));
    prev.copy(q); first = false;
  });
  assert.ok(worst < 0.25, `largest frame-to-frame turn ${worst.toFixed(3)} rad`);
});

test('steering drifts across the track but never off it', () => {
  const { skater } = rollIn(11.5);
  let maxL = 0;
  run(skater, (t, s) => ({ steer: s.loop ? 1 : 0 }), 3, 1 / 72, (t, s) => { if (s.loop) maxL = Math.max(maxL, Math.abs(s.loop.l)); });
  assert.ok(maxL > 0.3 && maxL <= WIDTH / 2 - 0.3 + 1e-9, `max offset ${maxL}`);
});

function wrapAngle(a) { return a - Math.PI * 2 * Math.round(a / (Math.PI * 2)); }
