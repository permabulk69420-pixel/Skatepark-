import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mode } from '../dist/src/skate/sim.js';
import { TUNING as T } from '../dist/src/skate/config.js';
import { makeSkater, rail, run } from './helpers.mjs';

const dt = 1 / 72;
const TAU = Math.PI * 2;

// A flat-ground ollie at 4 m/s, returned just after takeoff.
function ollied(events = [], opts = {}) {
  const s = makeSkater({ events, ...opts });
  run(s, {}, 0.6);
  s.vel.set(0, 0, -4);
  run(s, { jump: true }, 0.2);
  run(s, {}, 0.03);
  assert.equal(s.mode, Mode.AIR, 'did not take off');
  return s;
}
const names = (events, type) => events.filter((e) => e.type === type).map((e) => e.data?.name);

test('flip button + stick left in the air is a kickflip that comes round and lands clean', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, steer: -1 }, 0.05);
  assert.deepEqual(names(events, 'flipStart'), ['Kickflip']);
  run(s, {}, 1.2);
  assert.equal(s.mode, Mode.GROUND);
  assert.deepEqual(names(events, 'flip'), ['Kickflip']);
  assert.ok(!events.some((e) => e.type === 'bail' || e.type === 'sketchy'));
  assert.equal(s.flip, null);
  assert.equal(s.flipRoll, 0, 'the board is left rolled over');
});

test('stick right is a heelflip, turning the board the other way', () => {
  const kickEvents = [], heelEvents = [];
  const kick = ollied(kickEvents), heel = ollied(heelEvents);
  run(kick, { flip: true, steer: -1 }, 0.05);
  run(heel, { flip: true, steer: 1 }, 0.05);
  run(kick, {}, 0.1);
  run(heel, {}, 0.1);
  assert.deepEqual(names(heelEvents, 'flipStart'), ['Heelflip']);
  assert.ok(kick.flipRoll * heel.flipRoll < 0, 'both flips turned the same way');
  run(heel, {}, 1.2);
  assert.deepEqual(names(heelEvents, 'flip'), ['Heelflip']);
});

test('goofy mirrors the turn, not the names', () => {
  const regular = ollied(), goofy = ollied();
  goofy.faceOffset = -goofy.faceOffset;
  run(regular, { flip: true, steer: -1 }, 0.15);
  run(goofy, { flip: true, steer: -1 }, 0.15);
  assert.equal(regular.flip.name, goofy.flip.name);
  assert.ok(regular.flipRoll * goofy.flipRoll < 0);
});

test('the stick can come a moment after the button, but not long after', () => {
  const soon = ollied([]);
  run(soon, { flip: true }, 0.05);
  run(soon, { steer: -1 }, 0.1);
  assert.ok(soon.flip, 'a stick push 0.1 s after the button should still flip');
  const late = ollied([]);
  run(late, { flip: true }, 0.05);
  run(late, {}, T.flipArmWindow + 0.05);
  run(late, { steer: -1 }, 0.1);
  assert.equal(late.flip, null, 'a stick push long after the button flipped');
});

test('a flip needs a stick direction, and does nothing on the ground', () => {
  const noStick = ollied([]);
  run(noStick, { flip: true }, 0.2);
  assert.equal(noStick.flip, null);
  const ground = makeSkater();
  run(ground, {}, 0.6);
  ground.vel.set(0, 0, -4);
  run(ground, { flip: true, steer: -1 }, 0.3);
  assert.equal(ground.flip, null);
  assert.equal(ground.mode, Mode.GROUND);
});

test('the stick that picks the flip does not also spin the board', () => {
  const s = ollied();
  const heading = s.heading;
  run(s, { flip: true, steer: -1 }, 0.05);
  run(s, { steer: -1 }, 0.35);
  assert.ok(Math.abs(s.heading - heading) < 0.05, `heading turned ${(s.heading - heading).toFixed(2)} rad during a flip`);
  // ...and the lock lets go once the stick returns to centre after the flip is done
  run(s, { steer: 0 }, 0.2);
  assert.equal(s.spinLock, false);
});

test('starting too late bails: you cannot land mid-flip', () => {
  const events = [];
  const s = ollied(events);
  run(s, {}, 0.4);                       // near the top of a tap ollie's air
  run(s, { flip: true, steer: -1 }, 0.05);
  run(s, {}, 1);
  const bail = events.find((e) => e.type === 'bail');
  assert.ok(bail, 'landed mid-flip without bailing');
  assert.equal(bail.data.reason, 'flip');
  assert.ok(!names(events, 'flip').length, 'a bailed flip was credited');
});

test('coming down a little off flat is a sketchy landing: a stumble, not a bail, and not a trick', () => {
  const events = [];
  const s = makeSkater({ events });
  run(s, {}, 0.6);
  s.vel.set(0, -1, -5);
  s.mode = Mode.AIR;
  s.flip = { sign: 1, angle: TAU - 1.1, name: 'Kickflip' };
  s.flipRoll = s.flip.angle;
  const before = s.speed;
  s.land({ hasNormal: true, normal: new THREE.Vector3(0, 1, 0) });
  assert.equal(s.mode, Mode.GROUND);
  assert.ok(events.some((e) => e.type === 'sketchy'));
  assert.ok(!names(events, 'flip').length);
  assert.ok(s.speed < before * 0.8, 'a sketchy landing kept all its speed');
});

test('a flip that was barely started when you land is simply cancelled', () => {
  const events = [];
  const s = makeSkater({ events });
  run(s, {}, 0.6);
  s.vel.set(0, -1, -5);
  s.mode = Mode.AIR;
  s.flip = { sign: 1, angle: 0.2, name: 'Kickflip' };
  s.land({ hasNormal: true, normal: new THREE.Vector3(0, 1, 0) });
  assert.equal(s.mode, Mode.GROUND);
  assert.ok(!events.some((e) => e.type === 'bail' || e.type === 'sketchy' || e.type === 'flip'));
});

test('a board mid-flip cannot catch a rail, one that has come round can', () => {
  const path = rail([[0, 0.5, -4], [0, 0.5, -20]]);
  const approach = (events) => {
    const s = makeSkater({ paths: [path], events });
    s.pos.set(0, 0.6, -6); s.heading = 0; s.vel.set(0, 0, -4.5); s.mode = Mode.AIR;
    return s;
  };
  const mid = approach([]);
  mid.flip = { sign: 1, angle: Math.PI, name: 'Kickflip' };
  mid.update({}, dt);
  assert.notEqual(mid.mode, Mode.GRIND, 'caught a rail upside down');

  const events = [];
  const done = approach(events);
  done.flip = { sign: 1, angle: TAU, name: 'Kickflip' };
  run(done, {}, 0.5);
  assert.ok(events.some((e) => e.type === 'grindStart'), 'a finished flip could not catch the rail');
  assert.deepEqual(names(events, 'flip'), ['Kickflip'], 'kickflip to rail was not credited');
});

test('rolling backwards, the trick is named fakie', () => {
  const events = [];
  const s = makeSkater({ events });
  run(s, {}, 0.6);
  s.vel.set(0, 0, 4);              // heading 0 points the nose at -Z, so this is fakie
  run(s, { jump: true }, 0.2);
  run(s, {}, 0.03);
  run(s, { flip: true, steer: 1 }, 0.05);
  assert.deepEqual(names(events, 'flipStart'), ['Fakie Heelflip']);
});
