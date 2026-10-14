import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mode } from '../dist/src/skate/sim.js';
import { TUNING as T } from '../dist/src/skate/config.js';
import { stickDirection, TRICKS } from '../dist/src/skate/trick-controls.js';
import { makeSkater, rail, run } from './helpers.mjs';

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
const clean = (events) => assert.ok(!events.some((e) => e.type === 'bail' || e.type === 'sketchy'), 'bailed or sketchy');

test('down + flip is a backside pop shove-it: the board turns round, you land riding on and credited', () => {
  const events = [];
  const s = ollied(events);
  const h0 = s.heading, face0 = s.faceOffset;
  run(s, { flip: true, drive: -1 }, 0.2);
  assert.deepEqual(names(events, 'flipStart'), ['Pop Shove-it']);
  run(s, {}, 1.2);
  assert.equal(s.mode, Mode.GROUND);
  assert.deepEqual(names(events, 'flip'), ['Pop Shove-it']);
  clean(events);
  assert.equal(s.shuv, null);
  assert.equal(s.shuvYaw, 0);
  const turned = Math.abs(Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0)));
  assert.ok(Math.abs(turned - Math.PI) < 0.35, `heading turned ${turned}`);
  assert.equal(s.faceOffset, -face0, 'stance turned with the board');
  assert.equal(s.switched, true);
  assert.equal(s.goofy, false, 'still regular');
  assert.ok(s.vel.z < -2, 'lost the speed');
});

test('the rider keeps facing the same way when the board comes round', () => {
  const s = ollied();
  const before = s.facingYaw;
  run(s, { flip: true, drive: -1 }, 0.2);
  run(s, {}, 0.3);
  const d = Math.atan2(Math.sin(s.facingYaw - before), Math.cos(s.facingYaw - before));
  assert.ok(Math.abs(d) < 0.2, `rider turned ${d}`);
});

test('a shove-it spins the board flat, never through the rider frame, and the visible yaw reaches a half turn', () => {
  const s = ollied();
  run(s, { flip: true, drive: -1 }, 0.17);
  assert.equal(s.shuv.sign, -1, 'backside for a regular rider spins clockwise from above');
  assert.ok(s.shuvYaw < -0.1 && s.shuvYaw > -Math.PI, `yaw ${s.shuvYaw}`);
});

test('goofy spins the other way', () => {
  const regular = ollied(), goofy = ollied();
  goofy.faceOffset = -goofy.faceOffset;
  run(regular, { flip: true, drive: -1 }, 0.15);
  run(goofy, { flip: true, drive: -1 }, 0.15);
  assert.equal(regular.shuv.sign, -goofy.shuv.sign);
  assert.equal(regular.shuv.name, goofy.shuv.name);
});

test('up and upward diagonals do not select board tricks', () => {
  const events = [], e2 = [];
  const a = ollied(events), b = ollied(e2);
  run(a, { flip: true, drive: 1 }, 0.3);
  assert.deepEqual(names(events, 'flipStart'), []);
  run(b, { flip: true, drive: 0.5, steer: 0.8 }, 0.3);
  assert.deepEqual(names(e2, 'flipStart'), []);
  assert.equal(b.shuv, null);
  assert.ok(!events.some((e) => e.type === 'manualStart'), 'the stick up read as a manual');
  assert.equal(TRICKS[stickDirection(0.4, -0.9)], undefined, 'near-up incorrectly selects a flip');
  assert.equal(TRICKS[stickDirection(-0.4, -0.9)], undefined, 'near-up-left incorrectly selects a kickflip');
});

test('a lazy diagonal that only goes half way on both axes is still a varial', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -0.4, steer: 0.4 }, 0.25);
  assert.deepEqual(names(events, 'flipStart'), ['Varial Heelflip']);
});

test('a stick that is mostly down with a little sideways is a plain pop shove-it', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -1, steer: 0.25 }, 0.25);
  assert.deepEqual(names(events, 'flipStart'), ['Pop Shove-it']);
});

test('down-left is a varial kickflip: a kickflip and a backside shove-it together', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -0.8, steer: -0.8 }, 0.2);
  assert.deepEqual(names(events, 'flipStart'), ['Varial Kickflip']);
  assert.ok(s.flip && s.shuv);
  assert.equal(s.shuv.bs, true);
  run(s, {}, 1.2);
  assert.equal(s.mode, Mode.GROUND);
  assert.deepEqual(names(events, 'flip'), ['Varial Kickflip']);
  clean(events);
  assert.equal(s.flipRoll, 0);
});

test('down-right is a varial heelflip, with the shove-it the other way', () => {
  const events = [], kEvents = [];
  const heel = ollied(events), kick = ollied(kEvents);
  run(heel, { flip: true, drive: -0.8, steer: 0.8 }, 0.2);
  run(kick, { flip: true, drive: -0.8, steer: -0.8 }, 0.2);
  assert.deepEqual(names(events, 'flipStart'), ['Varial Heelflip']);
  assert.equal(heel.shuv.sign, -kick.shuv.sign);
  assert.ok(heel.flip.sign * kick.flip.sign < 0);
  run(heel, {}, 1.2);
  assert.deepEqual(names(events, 'flip'), ['Varial Heelflip']);
  clean(events);
});

test('the stick going diagonal a moment after it goes down still counts as the varial', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -1 }, 0.02);
  run(s, { flip: true, drive: -1, steer: 1 }, 0.05);
  run(s, {}, 0.2);
  assert.deepEqual(names(events, 'flipStart'), ['Varial Heelflip']);
});

test('a plain left or right is still a kickflip or heelflip', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, steer: -1 }, 0.25);
  assert.deepEqual(names(events, 'flipStart'), ['Kickflip']);
  assert.equal(s.shuv, null);
});

test('landing a shove-it halfway round bails; landing it nearly round is sketchy at worst', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -1 }, 0.17);
  assert.ok(s.shuv && !s.shuv.done);
  s.shuv.angle = -Math.PI / 2;
  s.shuvYaw = s.shuv.angle;
  s.pos.y = 0.05; s.vel.y = -3;
  run(s, {}, 0.3);
  assert.ok(events.some((e) => e.type === 'bail'), 'sideways landing did not bail');
});

test('a shove-it started too late fails rather than disappearing on landing', () => {
  const events = [];
  const s = ollied(events);
  const h = s.heading;
  run(s, { flip: true, drive: -1 }, 0.17);
  s.shuv.angle = -0.2; s.shuvYaw = -0.2; s.shuv.progress = 0.05;
  s.pos.y = 0.05; s.vel.y = -3;
  run(s, {}, 0.3);
  assert.deepEqual(names(events, 'flip'), []);
  assert.ok(events.some((e) => e.type === 'bail' && e.data?.reason === 'flip'));
  assert.equal(s.switched, false);
  assert.ok(Math.abs(s.heading - h) < 0.1);
});

test('the stick down then up with the flip button does not queue a manual', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -1 }, 0.1);
  run(s, { flip: true, drive: 1 }, 0.1);
  run(s, {}, 1.2);
  assert.ok(!events.some((e) => e.type === 'manualStart'));
});

test('a respawn after a shove-it puts the stance back with the spawn heading', () => {
  const s = ollied();
  const face0 = s.faceOffset;
  run(s, { flip: true, drive: -1 }, 0.5);
  assert.equal(s.switched, true);
  s.respawn(s.spawn);
  assert.equal(s.switched, false);
  assert.equal(s.faceOffset, face0);
});

test('a board that has come round can catch a rail, and the credit is given', () => {
  const events = [];
  const s = ollied(events);
  // Just verifies the gate: a half-turned board cannot grind, a finished one can.
  run(s, { flip: true, drive: -1 }, 0.17);
  s.shuv.angle = -Math.PI / 2;
  assert.ok(s.shuvResidual() > T.shuvClean);
  s.commitShuv();
  assert.equal(s.shuvResidual(), 0);
});

test('a thumb that goes sideways first and then down still makes the varial', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, steer: -1 }, 0.03);
  run(s, { flip: true, steer: -0.7, drive: -0.7 }, 0.2);
  assert.deepEqual(names(events, 'flipStart'), ['Varial Kickflip']);
});

test('a thumb that goes down first and only slightly sideways still makes the varial', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -0.6, steer: 0.5 }, 0.25);
  assert.equal(names(events, 'flipStart').at(-1), 'Varial Heelflip');
  assert.ok(s.flip && s.shuv && !s.shuv.bs, 'heelflip goes with a frontside shove');
});

test('a thumb that pushes straight down and then swings onto the diagonal over about 0.07 s gets the varial', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -1 }, 0.02);
  for (let i = 0; i <= 6; i += 1) run(s, { flip: true, drive: -1, steer: -i / 6 * 0.9 }, 0.008); // swinging from down to down-left
  run(s, { flip: true, drive: -0.8, steer: -0.8 }, 0.15);
  assert.equal(names(events, 'flipStart').at(-1), 'Varial Kickflip');
});

test('a trick being picked is not cancelled when the button window runs out', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true }, 0.27);                         // button pressed, stick still in the middle, window nearly out
  run(s, { flip: true, drive: -0.7, steer: 0.7 }, 0.2);  // stick arrives at the very end of it
  assert.equal(names(events, 'flipStart').at(-1), 'Varial Heelflip');
});

test('a diagonal picked in a short hop still has time to come round', () => {
  const events = [];
  const s = ollied(events);
  run(s, { flip: true, drive: -0.7, steer: -0.7 }, 0.05);
  const started = s.airTime;
  run(s, {}, 0.1);
  assert.ok(s.flip && s.shuv, 'not started');
  assert.ok(started < 0.2, `picked at ${started}`);
});

test('Quest stick has distinct down, diagonal, side and near-up sectors', () => {
  const at = (degrees, side) => {
    const rad = degrees * Math.PI / 180;
    return TRICKS[stickDirection(Math.sin(rad) * side, Math.cos(rad))]?.name;
  };
  for (const side of [-1, 1]) {
    const plain = side < 0 ? 'Kickflip' : 'Heelflip';
    const varial = side < 0 ? 'Varial Kickflip' : 'Varial Heelflip';
    for (const a of [0, 8, 14]) assert.equal(at(a, side), 'Pop Shove-it', `down at ${a}°`);
    for (const a of [16, 20, 30, 45, 55, 64]) assert.equal(at(a, side), varial, `diagonal at ${a}°`);
    for (const a of [66, 75, 90, 110, 119]) assert.equal(at(a, side), plain, `side at ${a}°`);
    for (const a of [125, 145, 165, 180]) assert.equal(at(a, side), undefined, `up at ${a}°`);
  }
});

test('slightly off-axis down is a shove-it and slightly downward left/right stays a basic flip', () => {
  for (const [steer, drive, name] of [
    [-0.2, -0.95, 'Pop Shove-it'],
    [-0.95, -0.3, 'Kickflip'],
    [0.2, -0.95, 'Pop Shove-it'],
    [0.95, -0.3, 'Heelflip'],
  ]) {
    const events = [];
    const s = ollied(events);
    run(s, { flip: true, steer, drive }, 0.2);
    assert.deepEqual(names(events, 'flipStart'), [name], `stick (${steer}, ${drive})`);
  }
});

test('a finished shove preserves board orientation through the 180° heading transfer', () => {
  for (const sign of [-1, 1]) {
    const s = makeSkater();
    s.heading = 0.4;
    s.visPitch = 0.24;
    s.visRoll = -0.13;
    s.flip = { angle: 4.3, sign: 1, name: 'Kickflip' };
    s.flipRoll = s.flip.angle;
    s.shuv = { angle: sign * Math.PI, sign, done: false, bs: sign < 0 };
    s.shuvYaw = s.shuv.angle;
    const before = s.boardQuaternion(new THREE.Quaternion());
    s.commitShuv();
    const after = s.boardQuaternion(new THREE.Quaternion());
    assert.ok(1 - Math.abs(before.dot(after)) < 1e-10, 'board orientation jumped at shove completion');
    assert.equal(s.flip.angle, 4.3, 'committing the shove unexpectedly reversed the flip');
    assert.equal(s.flip.sign, 1, 'committing the shove reversed flip velocity');
    assert.equal(s.shuvYaw, 0);
    assert.equal(s.shuv.done, true);
  }
});

test('a partly deflected down-left or down-right selects the varial from raw axes', () => {
  assert.equal(TRICKS[stickDirection(-0.42, 0.85)].name, 'Varial Kickflip');
  assert.equal(TRICKS[stickDirection(0.42, 0.85)].name, 'Varial Heelflip');
});

test('down-to-left thumb movement stays pending until the varial direction settles', () => {
  const events = [], s = ollied(events);
  run(s, { flip: true, drive: -1 }, 0.028);
  for (let i = 1; i <= 9; i++) run(s, { flip: true, steer: -0.8 * i / 9, drive: -1 + 0.2 * i / 9 }, 1 / 72);
  run(s, { flip: true, steer: -0.8, drive: -0.8 }, 0.15);
  assert.deepEqual(names(events, 'flipStart'), ['Varial Kickflip']);
});

test('a brief leftward reading while moving to up is not mistaken for a kickflip', () => {
  const events = [], s = ollied(events);
  run(s, { flip: true, steer: -0.65, drive: 0.12 }, 0.028);
  run(s, { flip: true, steer: -0.45, drive: 0.75 }, 0.028);
  run(s, { flip: true, steer: -0.05, drive: 1 }, 0.21);
  assert.deepEqual(names(events, 'flipStart'), []);
  run(s, { flip: true, steer: -1 }, 0.15);
  assert.deepEqual(names(events, 'flipStart'), [], 'up must consume the armed attempt');
});
