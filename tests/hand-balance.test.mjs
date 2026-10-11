import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HandBalance } from '../dist/src/skate/hand-balance.js';
import { HANDS } from '../dist/src/skate/config.js';
import { Mode } from '../dist/src/skate/sim.js';
import { makeSkater, rail, run } from './helpers.mjs';

const dt = 1 / 72;
function rest(hb, left, right, seconds) {
  let lean = 0;
  for (let i = 0; i < seconds / dt; i++) lean = hb.update(dt, left, right, false);
  return lean;
}
function hold(hb, left, right, seconds, balancing = true) {
  let lean = 0;
  for (let i = 0; i < seconds / dt; i++) lean = hb.update(dt, left, right, balancing);
  return lean;
}

test('hands at rest, however you hold them, are no push', () => {
  const hb = new HandBalance();
  assert.ok(Math.abs(rest(hb, 1.25, 1.1, 3)) < 0.01, 'uneven resting hands pushed the meter');
  assert.ok(Math.abs(rest(hb, 0.9, 0.9, 3)) < 0.01);
});

test('right hand up pushes right, left hand up pushes left, relative to how they were resting', () => {
  const hb = new HandBalance();
  rest(hb, 1.2, 1.1, 2);
  const right = hold(hb, 1.2, 1.1 + 0.12, 0.6);
  assert.ok(right > 0.3, `right hand 12 cm up pushed only ${right.toFixed(2)}`);
  const left = hold(hb, 1.2 + 0.12, 1.1, 0.6);
  assert.ok(left < -0.3, `left hand 12 cm up pushed ${left.toFixed(2)}`);
});

test('a full push at the configured range, and a small wobble inside the deadzone does nothing', () => {
  const hb = new HandBalance();
  rest(hb, 1.2, 1.2, 2);
  assert.ok(hold(hb, 1.2, 1.2 + HANDS.range, 0.8) > 0.95);
  const hb2 = new HandBalance();
  rest(hb2, 1.2, 1.2, 2);
  assert.ok(Math.abs(hold(hb2, 1.2, 1.2 + HANDS.deadzone * 0.8, 0.8)) < 0.01);
});

test('while balancing the resting reference is frozen, so holding a push keeps pushing', () => {
  const hb = new HandBalance();
  rest(hb, 1.2, 1.2, 2);
  hold(hb, 1.2, 1.2 + 0.15, 0.3);
  const later = hold(hb, 1.2, 1.2 + 0.15, 4);
  assert.ok(later > 0.5, `the push faded to ${later.toFixed(2)} while still held`);
});

test('between balances the reference follows your hands, so it never builds up a stale offset', () => {
  const hb = new HandBalance();
  rest(hb, 1.2, 1.2, 2);
  const settled = rest(hb, 1.2, 1.2 + 0.15, 6);     // you just stand differently now
  assert.ok(Math.abs(settled) < 0.05, `still pushing ${settled.toFixed(2)} after standing differently for 6 s`);
});

test('an untracked hand is no push', () => {
  const hb = new HandBalance();
  rest(hb, 1.2, 1.2, 2);
  hold(hb, 1.2, 1.4, 0.5);
  assert.ok(Math.abs(hold(hb, null, 1.4, 1)) < 0.02);
});

test('in a grind the hands push the meter, and the stick does not', () => {
  const stickOnly = makeSkater();
  const path = rail([[0, 0.5, -4], [0, 0.5, -20]]);
  const mk = (input) => {
    const events = [];
    const s = makeSkater({ paths: [path], events });
    s.pos.set(0, 0.62, -6); s.heading = 0; s.vel.set(0, 0, -5); s.mode = Mode.AIR;
    run(s, input, 4);
    return { s, events };
  };
  // mashing the stick every way while grinding saves nothing
  const mashed = mk((t) => ({ steer: Math.sin(t * 9), drive: Math.cos(t * 7) }));
  assert.ok(mashed.events.some((e) => e.type === 'bail' && e.data.reason === 'balance'), 'the stick balanced the grind');
  // the same grind held with the hands (a lean input) stays on
  const held = mk((t, sk) => ({ lean: sk.grind ? THREE.MathUtils.clamp(-(sk.grind.bal * 2.2 + sk.grind.balVel * 0.7), -1, 1) : 0 }));
  assert.ok(!held.events.some((e) => e.type === 'bail'), 'could not hold a grind with the hands');
  void stickOnly;
});
