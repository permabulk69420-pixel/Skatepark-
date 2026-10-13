import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mode } from '../dist/src/skate/sim.js';
import { TUNING as T } from '../dist/src/skate/config.js';
import { makeSkater, run } from './helpers.mjs';

const TAU = Math.PI * 2;
function highAir(events) {
  const s = makeSkater({ events });
  s.respawn({ pos: new THREE.Vector3(0, 4.5, 0), heading: 0 });
  s.mode = Mode.AIR;
  s.vel.set(0, 5, -3);
  return s;
}
const names = (events, type) => events.filter((e) => e.type === type).map((e) => e.data);

// Hold the stick (x, y) while grabbing until the body has turned `until` radians (or forever), then let go and fall.
function flip(s, { x = 0, y = -1, grabbing = true, until = TAU }) {
  run(s, (t, sk) => ({ grabbing, steer: Math.abs(sk.bodyRoll) < until - 0.15 ? x : 0, drive: Math.abs(sk.bodyRoll) < until - 0.15 ? y : 0 }), 4);
}

test('grab and hold the stick back: one full backflip, landed and named', () => {
  const events = [];
  const s = highAir(events);
  flip(s, { y: -1 });
  assert.deepEqual(names(events, 'bail'), []);
  assert.deepEqual(names(events, 'flip').map((d) => d.name), ['Backflip']);
  assert.equal(s.mode, Mode.GROUND);
});

test('forward is a frontflip, and the two turn opposite ways', () => {
  const a = highAir([]), b = highAir([]);
  run(a, { grabbing: true, drive: -1 }, 0.5);
  run(b, { grabbing: true, drive: 1 }, 0.5);
  assert.ok(Math.abs(a.bodyRoll) > 0.5 && Math.abs(b.bodyRoll) > 0.5);
  assert.ok(Math.sign(a.bodyRoll) !== Math.sign(b.bodyRoll));
  const events = [];
  const c = highAir(events);
  flip(c, { y: 1 });
  assert.deepEqual(names(events, 'flip').map((d) => d.name), ['Frontflip']);
});

test('the buffer: no flip without a grab, from a quick flick, from a half push, or from a push off to the side', () => {
  const cases = {
    'not grabbing': (s) => run(s, { grabbing: false, drive: -1 }, 1),
    'a flick shorter than the delay': (s) => run(s, (t) => ({ grabbing: true, drive: t < T.bodyFlipDelay * 0.6 ? -1 : 0 }), 1),
    'half way back': (s) => run(s, { grabbing: true, drive: -0.5 }, 1),
    'diagonal (45°): a spin, not a flip': (s) => run(s, { grabbing: true, drive: -0.75, steer: 0.75 }, 1)
  };
  for (const [label, act] of Object.entries(cases)) {
    const s = highAir([]);
    act(s);
    assert.equal(s.bodyRoll, 0, label);
  }
});

test('once flipping, a diagonal keeps it going and spins you as well', () => {
  const s = highAir([]);
  run(s, { grabbing: true, drive: -1 }, 0.3);
  const heading = s.heading, roll = s.bodyRoll;
  run(s, { grabbing: true, drive: -0.7, steer: 0.7 }, 0.3);
  assert.ok(Math.abs(s.bodyRoll) > Math.abs(roll) + 0.5, 'still flipping');
  assert.ok(Math.abs(s.heading - heading) > 0.3, 'and spinning');
});

test('landing half way round is a slam; a little short is sketchy; flipping does not queue a manual', () => {
  let events = [];
  flip(highAir(events), { y: -1, until: Math.PI });
  assert.equal(names(events, 'bail')[0]?.reason, 'flip');
  events = [];
  const s = highAir(events);
  flip(s, { y: -1, until: TAU - 1.75 });
  assert.equal(names(events, 'sketchy').length, 1);
  assert.equal(s.manual, null);
});
