import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { judgeCatch, BOARD_OFF } from '../dist/src/skate/board-off.js';
import { Mode } from '../dist/src/skate/sim.js';
import { makeSkater, rail, run } from './helpers.mjs';

const feet = { pos: new THREE.Vector3(0, 1, 0), quat: new THREE.Quaternion() };
const board = (dx = 0, dy = 0, dz = 0, euler = [0, 0, 0]) => ({ pos: feet.pos.clone().add(new THREE.Vector3(dx, dy, dz)), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler)) });
const deg = THREE.MathUtils.degToRad;

test('a catch is judged by how far the board is from your feet and how far it is turned', () => {
  assert.equal(judgeCatch(board(), feet).quality, 'clean');
  assert.equal(judgeCatch(board(0.1, 0.15, 0, [deg(15), 0, 0]), feet).quality, 'clean');
  assert.equal(judgeCatch(board(0, 0, 0, [0, 0, deg(40)]), feet).quality, 'sketchy', 'rolled 40°');
  assert.equal(judgeCatch(board(0.4, 0, 0), feet).quality, 'sketchy', '40 cm off to the side');
  assert.equal(judgeCatch(board(0.7, 0, 0), feet).quality, 'miss', 'out at arm\'s length');
  assert.equal(judgeCatch(board(0, 0, 0, [0, 0, Math.PI]), feet).quality, 'miss', 'upside down');
  assert.equal(judgeCatch(board(0, 0, 0, [0, deg(80), 0]), feet).quality, 'miss', 'turned across');
});

test('caught nose-for-tail still counts, and says it was reversed', () => {
  const v = judgeCatch(board(0, 0, 0, [0, Math.PI, 0]), feet);
  assert.equal(v.quality, 'clean');
  assert.equal(v.reversed, true);
  assert.equal(judgeCatch(board(), feet).reversed, false);
});

function inAir(events, height = 2.2) {
  const s = makeSkater({ events });
  s.respawn({ pos: new THREE.Vector3(0, height, 0), heading: 0 });
  s.mode = Mode.AIR;
  s.vel.set(0, 3.5, -4);
  return s;
}
const names = (events, type) => events.filter((e) => e.type === type).map((e) => e.data);

test('the board only comes off in the air, and not in the middle of a flip', () => {
  const events = [];
  const s = makeSkater({ events });
  run(s, {}, 0.5);
  assert.equal(s.mode, Mode.GROUND);
  assert.equal(s.detachBoard(), false, 'not on the ground');
  const a = inAir(events);
  a.flip = { sign: 1, angle: 1, progress: 0.2, kick: true, name: 'Kickflip' };
  assert.equal(a.detachBoard(), false, 'not mid-flip');
  a.flip = null;
  assert.equal(a.detachBoard(), true);
  assert.equal(a.boardOff, true);
});

test('come down without the board under you and you bail', () => {
  const events = [];
  const s = inAir(events);
  s.detachBoard();
  run(s, {}, 2);
  assert.deepEqual(names(events, 'bail').map((d) => d.reason), ['no board']);
});

test('take it off, catch it clean, land: a clean Board Off; held out far it is a Christ Air', () => {
  for (const [far, name] of [[0.3, 'Board Off'], [BOARD_OFF.christ + 0.1, 'Christ Air']]) {
    const events = [];
    const s = inAir(events);
    s.detachBoard();
    run(s, {}, 0.2);
    s.offTrick.far = far;
    if (far >= BOARD_OFF.christ) s.offTrick.name = BOARD_OFF.names.far;
    s.catchBoard('clean');
    run(s, {}, 2);
    assert.deepEqual(names(events, 'bail'), []);
    assert.deepEqual(names(events, 'flip').map((d) => d.name), [name]);
    assert.equal(names(events, 'sketchy').length, 0);
    assert.equal(s.mode, Mode.GROUND);
  }
});

test('a sketchy catch makes a sketchy landing', () => {
  const events = [];
  const s = inAir(events);
  s.detachBoard();
  run(s, {}, 0.2);
  s.catchBoard('sketchy');
  run(s, {}, 2);
  assert.equal(names(events, 'sketchy').length, 1);
  assert.deepEqual(names(events, 'bail'), []);
});

test('caught nose-for-tail, you ride on the other way round (still facing the same way)', () => {
  const events = [];
  const s = inAir(events);
  const heading = s.heading, facing = s.facingYaw;
  s.detachBoard();
  s.catchBoard('clean', true);
  assert.ok(Math.abs(Math.abs(s.heading - heading) - Math.PI) < 1e-9);
  assert.ok(Math.abs(Math.cos(s.facingYaw - facing) - 1) < 1e-9, 'the rider still faces the same way');
});

test('a board in your hand catches no rail; caught again, it does', () => {
  for (const offWhenArriving of [true, false]) {
    const events = [];
    const path = rail([[0, 0.5, 2], [0, 0.5, -8]]);
    const s = makeSkater({ events, paths: [path] });
    s.respawn({ pos: new THREE.Vector3(0, 1.0, 1.5), heading: 0 });
    s.mode = Mode.AIR;
    s.vel.set(0, 0, -4);
    s.detachBoard();
    if (!offWhenArriving) s.catchBoard('clean');
    run(s, {}, 0.6);
    const caught = names(events, 'grindStart').length > 0;
    assert.equal(caught, !offWhenArriving);
  }
});

test('a bail or a respawn puts the board back', () => {
  const events = [];
  const s = inAir(events);
  s.detachBoard();
  s.bail('test');
  assert.equal(s.boardOff, false);
  s.respawn(s.spawn);
  assert.equal(s.boardOff, false);
  assert.equal(s.offTrick, null);
});
