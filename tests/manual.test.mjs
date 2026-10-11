import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mode, headingVec } from '../dist/src/skate/sim.js';
import { makeSkater, run } from './helpers.mjs';

// A stick flick: first direction for 0.1 s, a beat, then the other for 0.1 s, starting at t0.
const flick = (t0, first, gap = 0.05) => (t) => (t >= t0 && t < t0 + 0.1 ? first : t >= t0 + 0.1 + gap && t < t0 + 0.2 + gap ? -first : 0);

function rolling(speed = 5, events = []) {
  const s = makeSkater({ events });
  run(s, {}, 0.6);
  s.vel.set(0, 0, -speed);
  return s;
}
const noseTilt = (s) => { const f = headingVec(s.heading, new THREE.Vector3()); return s.up.dot(f); };   // < 0: nose up
const starts = (events) => events.filter((e) => e.type === 'manualStart').map((e) => e.data.name);

test('forward then back on the stick, quickly, starts a manual with the nose up', () => {
  const events = [];
  const s = rolling(5, events);
  run(s, (t) => ({ drive: flick(0.3, 1)(t) }), 1.2);
  assert.deepEqual(starts(events), ['Manual']);
  assert.ok(s.manual, 'not in a manual');
  assert.ok(noseTilt(s) < -0.15, `nose tilt ${noseTilt(s).toFixed(2)}`);
  assert.ok(s.manualLift > 0.03, 'board did not rock back onto its rear wheels');
});

test('back then forward is a nose manual with the tail up', () => {
  const events = [];
  const s = rolling(5, events);
  run(s, (t) => ({ drive: flick(0.3, -1)(t) }), 1.2);
  assert.deepEqual(starts(events), ['Nose Manual']);
  assert.ok(noseTilt(s) > 0.15, `nose tilt ${noseTilt(s).toFixed(2)}`);
});

test('ordinary riding does not start one: holding forward, braking, slow taps, too slow, button held', () => {
  const cases = [
    ['holding forward', 5, () => ({ drive: 1 })],
    ['braking', 5, () => ({ drive: -1 })],
    ['slow taps', 5, (t) => ({ drive: flick(0.3, 1, 0.6)(t) })],
    ['too slow', 1.2, (t) => ({ drive: flick(0.3, 1)(t) })],
    ['ollie button held', 5, (t) => ({ drive: flick(0.3, 1)(t), jump: true })],
  ];
  for (const [label, speed, input] of cases) {
    const events = [];
    const s = rolling(speed, events);
    run(s, input, 1.5);
    assert.deepEqual(starts(events), [], `${label} started a manual`);
  }
});

test('a manual you leave alone falls over: the meter runs away and it is a bail', () => {
  const events = [];
  const s = rolling(6, events);
  run(s, (t) => ({ drive: flick(0.3, 1)(t) }), 6);
  assert.ok(events.some((e) => e.type === 'bail' && e.data.reason === 'manual'), 'never bailed');
});

test('a balanced manual holds, does not push, and runs out of speed without a bail', () => {
  const events = [];
  const s = rolling(6, events);
  let last = null, rose = false;
  run(s, (t, sk) => {
    if (t < 0.5) return { drive: flick(0.3, 1)(t) };
    const m = sk.manual;
    return { drive: m ? THREE.MathUtils.clamp(m.kind * (m.bal * 2.4 + m.balVel * 0.8), -1, 1) : 0 };
  }, 12, 1 / 72, (t, sk) => { if (sk.manual) { if (last !== null && sk.speed > last + 0.001) rose = true; last = sk.speed; } });
  const end = events.find((e) => e.type === 'manualEnd');
  assert.ok(end, 'manual never ended');
  assert.ok(end.data.time > 3, `only held ${end.data.time.toFixed(1)} s`);
  assert.equal(end.data.reason, 'stall');
  assert.ok(!events.some((e) => e.type === 'bail'));
  assert.ok(!rose, 'speed went up during the manual (it pushed)');
  assert.equal(s.mode, Mode.GROUND);
  assert.ok(s.manualLift < 0.01, 'board stayed rocked back after the manual ended');
});

test('ollie out of a manual', () => {
  const events = [];
  const s = rolling(6, events);
  run(s, (t, sk) => {
    if (t < 0.5) return { drive: flick(0.3, 1)(t) };
    const m = sk.manual;
    return { drive: m ? THREE.MathUtils.clamp(m.kind * (m.bal * 2.4 + m.balVel * 0.8), -1, 1) : 0, jump: t > 1.2 && t < 1.3 };
  }, 2.5);
  const end = events.find((e) => e.type === 'manualEnd');
  assert.equal(end?.data.reason, 'pop');
  assert.ok(events.some((e) => e.type === 'pop'));
  assert.equal(s.manual, null);
});

test('the manual shows up as a balance meter for the HUD', () => {
  const s = rolling(6);
  run(s, (t) => ({ drive: flick(0.3, 1)(t) }), 1.0);
  assert.ok(s.balance && s.balance.name === 'Manual' && typeof s.balance.bal === 'number');
  const g = makeSkater();
  run(g, {}, 0.5);
  assert.equal(g.balance, null);
});
