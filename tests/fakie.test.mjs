import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { headingVec } from '../dist/src/skate/sim.js';
import { makeSkater, run } from './helpers.mjs';

// Heading 0 points the nose at -Z. Rolling forward is towards -Z (right of travel is +X); rolling fakie is towards +Z, so right
// of travel is -X.
function rolling(forward, events = []) {
  const s = makeSkater({ events });
  run(s, {}, 0.6);
  s.vel.set(0, 0, forward ? -5 : 5);
  return s;
}

test('steering right goes right of where you are heading, forward or fakie', () => {
  const fwd = rolling(true);
  run(fwd, { steer: 1 }, 1.2);
  assert.ok(fwd.pos.x > 1, `forward: x ${fwd.pos.x.toFixed(2)}`);
  const fakie = rolling(false);
  run(fakie, { steer: 1 }, 1.2);
  assert.ok(fakie.pos.x < -1, `fakie: x ${fakie.pos.x.toFixed(2)} (right of travel is -X)`);
  const fakieLeft = rolling(false);
  run(fakieLeft, { steer: -1 }, 1.2);
  assert.ok(fakieLeft.pos.x > 1, `fakie left: x ${fakieLeft.pos.x.toFixed(2)}`);
});

test('steering is continuous through a stop: no snap as you roll from forward to backward', () => {
  const s = rolling(true);
  s.vel.set(0, 0, -0.2);
  let maxTurn = 0, last = s.heading;
  run(s, { steer: 1 }, 2, 1 / 72, (t, sk) => { maxTurn = Math.max(maxTurn, Math.abs(sk.heading - last)); last = sk.heading; });
  assert.ok(maxTurn < 0.05, `heading jumped ${maxTurn.toFixed(3)} rad in a frame`);
});

const flick = (t0, first) => (t) => (t >= t0 && t < t0 + 0.1 ? first : t >= t0 + 0.15 && t < t0 + 0.25 ? -first : 0);
const noseTilt = (s) => s.up.dot(headingVec(s.heading, new THREE.Vector3()));   // < 0: nose up

test('a manual lifts the end that leads: nose up going forward, tail up going fakie', () => {
  const events = [];
  const fwd = rolling(true, events);
  run(fwd, (t) => ({ drive: flick(0.3, 1)(t) }), 1.2);
  assert.equal(events.find((e) => e.type === 'manualStart').data.name, 'Manual');
  assert.ok(noseTilt(fwd) < -0.15, 'forward manual: nose should be up');

  const ev2 = [];
  const fakie = rolling(false, ev2);
  run(fakie, (t) => ({ drive: flick(0.3, 1)(t) }), 1.2);
  assert.equal(ev2.find((e) => e.type === 'manualStart').data.name, 'Fakie Manual');
  assert.ok(noseTilt(fakie) > 0.15, 'fakie manual: tail should be up (the leading end)');

  const ev3 = [];
  const fakieNose = rolling(false, ev3);
  run(fakieNose, (t) => ({ drive: flick(0.3, -1)(t) }), 1.2);
  assert.equal(ev3.find((e) => e.type === 'manualStart').data.name, 'Fakie Nose Manual');
  assert.ok(noseTilt(fakieNose) < -0.15);
});

test('a fakie manual is balanced with the same stick moves as a forward one', () => {
  for (const forward of [true, false]) {
    const events = [];
    const s = rolling(forward, events);
    run(s, (t, sk) => {
      if (t < 0.5) return { drive: flick(0.3, 1)(t) };
      const m = sk.manual;
      // Back on the stick leans a manual further over, forward brings it back, whichever way you are rolling.
      return { drive: m ? THREE.MathUtils.clamp(m.kind * (m.bal * 2.4 + m.balVel * 0.8), -1, 1) : 0 };
    }, 8);
    const end = events.find((e) => e.type === 'manualEnd');
    assert.ok(end && end.data.time > 2.5, `${forward ? 'forward' : 'fakie'}: manual lasted ${end?.data.time ?? 0}`);
    assert.ok(!events.some((e) => e.type === 'bail'), `${forward ? 'forward' : 'fakie'} manual bailed`);
  }
});
