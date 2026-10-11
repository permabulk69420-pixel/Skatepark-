import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HandBalance } from '../dist/src/skate/hand-balance.js';
import { HANDS } from '../dist/src/skate/config.js';
import { Mode } from '../dist/src/skate/sim.js';
import { makeSkater, rail, run } from './helpers.mjs';

const dt = 1 / 72;
// Hands at heights ly / ry, spread apart sideways.
const hands = (ly, ry, spread = 0.6) => [{ x: -spread / 2, y: ly, z: 0 }, { x: spread / 2, y: ry, z: 0 }];
// A hand pair tilted by `deg` degrees (right hand up positive), at a given spread.
const tilted = (deg, spread = 0.6, base = 1.2) => hands(base, base + Math.tan(deg * Math.PI / 180) * spread, spread);
function rest(hb, [l, r], seconds) {
  let lean = 0;
  for (let i = 0; i < seconds / dt; i++) lean = hb.update(dt, l, r, { balancing: false, learn: true });
  return lean;
}
function hold(hb, [l, r], seconds, opts = { balancing: true, learn: false }) {
  let lean = 0;
  for (let i = 0; i < seconds / dt; i++) lean = hb.update(dt, l, r, opts);
  return lean;
}

test('hands at rest, however you hold them, are no push', () => {
  const hb = new HandBalance();
  assert.ok(Math.abs(rest(hb, hands(1.1, 1.25), 3)) < 0.01, 'uneven resting hands pushed the meter');
  assert.ok(Math.abs(rest(hb, hands(0.9, 0.9), 3)) < 0.01);
});

test('right hand up pushes right, left hand up pushes left, relative to how they were resting', () => {
  const hb = new HandBalance();
  rest(hb, hands(1.1, 1.2), 2);
  const right = hold(hb, hands(1.1, 1.2 + 0.12), 0.8);
  assert.ok(right > 0.3, `right hand 12 cm up pushed only ${right.toFixed(2)}`);
  const left = hold(hb, hands(1.1 + 0.12, 1.2), 0.8);
  assert.ok(left < -0.3, `left hand 12 cm up pushed ${left.toFixed(2)}`);
});

test('a full push at the configured range, and a small wobble inside the deadzone does nothing', () => {
  const hb = new HandBalance();
  rest(hb, tilted(0), 2);
  assert.ok(hold(hb, tilted(HANDS.range * 180 / Math.PI), 1) > 0.95);
  const hb2 = new HandBalance();
  rest(hb2, tilted(0), 2);
  assert.ok(Math.abs(hold(hb2, tilted(HANDS.deadzone * 0.8 * 180 / Math.PI), 1)) < 0.01);
});

test('the same tilt feels the same with the hands close together or wide apart', () => {
  const pushes = [0.4, 0.6, 0.9].map((spread) => {
    const hb = new HandBalance();
    rest(hb, tilted(0, spread), 2);
    return hold(hb, tilted(20, spread), 1);
  });
  assert.ok(Math.max(...pushes) - Math.min(...pushes) < 0.05, `pushes differ with spread: ${pushes.map((p) => p.toFixed(2))}`);
});

test('while balancing the resting reference is frozen, so holding a push keeps pushing', () => {
  const hb = new HandBalance();
  rest(hb, tilted(0), 2);
  hold(hb, tilted(15), 0.3);
  const later = hold(hb, tilted(15), 4);
  assert.ok(later > 0.5, `the push faded to ${later.toFixed(2)} while still held`);
});

test('between balances the reference follows your hands, so it never builds up a stale offset', () => {
  const hb = new HandBalance();
  rest(hb, tilted(0), 2);
  const settled = rest(hb, tilted(15), 6);          // you just stand differently now
  assert.ok(Math.abs(settled) < 0.05, `still pushing ${settled.toFixed(2)} after standing differently for 6 s`);
});

test('arms swinging through a crouch, pop and flight do not become the neutral', () => {
  // Riding relaxed with the right hand 10 cm higher than the left, then an ollie flings the arms about for a second.
  const hb = new HandBalance();
  rest(hb, hands(1.0, 1.1), 3);
  for (let i = 0; i < 1 / dt; i++) hb.update(dt, ...hands(0.8, 1.3), { balancing: false, learn: false });
  // The grind starts with the hands back in the riding posture: that must read as no push.
  const push = hold(hb, hands(1.0, 1.1), 0.5);
  assert.ok(Math.abs(push) < 0.05, `relaxed hands read as a push of ${push.toFixed(2)} after an arm swing`);
});

test('the push eases in when a balance starts, so landing arm-swing does not kick the meter', () => {
  const hb = new HandBalance();
  rest(hb, tilted(0), 2);
  const first = hold(hb, tilted(25), 0.05);
  assert.ok(Math.abs(first) < 0.3, `kicked straight to ${first.toFixed(2)}`);
  assert.ok(hold(hb, tilted(25), 0.6) > 0.95, 'never reached a full push');
});

test('an untracked hand is no push', () => {
  const hb = new HandBalance();
  rest(hb, tilted(0), 2);
  hold(hb, tilted(20), 1);
  assert.ok(Math.abs(hold(hb, [null, tilted(20)[1]], 1)) < 0.02);
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
