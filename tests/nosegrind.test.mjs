import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mode, headingVec } from '../dist/src/skate/sim.js';
import { BOARD, TUNING as T } from '../dist/src/skate/config.js';
import { makeSkater, rail, run } from './helpers.mjs';

const longRail = (kind = 'rail') => rail([[0, 0.5, -4], [0, 0.5, -40]], { kind });
function approach(opts = {}) {
  const { heading = 0, events = [], seed = 1, kind = 'rail', speed = 5 } = opts;
  const s = makeSkater({ paths: [longRail(kind)], events, seed });
  s.pos.set(0, 0.62, -6); s.heading = heading; s.vel.set(-Math.sin(heading) * speed, 0, -Math.cos(heading) * speed); s.mode = Mode.AIR;
  return s;
}
// Hands that hold a grind steady, so only the variant under test changes the outcome.
const hold = (extra = {}) => (t, sk) => ({ ...extra, lean: sk.grind ? THREE.MathUtils.clamp(-(sk.grind.bal * 2.2 + sk.grind.balVel * 0.7), -1, 1) : 0 });
const grindEnd = (events) => events.find((e) => e.type === 'grindEnd')?.data;
// Pop off the rail the way a player does: press and release the ollie button.
function popOff(s, input = {}) {
  run(s, { ...input, jump: true }, 0.1);
  run(s, input, 0.2);
}
const forward = (s) => headingVec(s.heading, new THREE.Vector3());

test('stick up on a rail is a nosegrind, stick down a 5-0, and no stick is a 50-50', () => {
  for (const [drive, name] of [[1, 'Nosegrind'], [-1, '5-0 Grind'], [0, '50-50']]) {
    const events = [];
    const s = approach({ events });
    run(s, hold({ drive }), 1.2);
    assert.equal(s.mode, Mode.GRIND, `drive ${drive}: not grinding`);
    assert.equal(s.grind.name, name);
    run(s, hold({ drive }), 0.3);
    popOff(s, hold({ drive }));
    assert.equal(grindEnd(events)?.name, name);
  }
});

test('the stick held as you land on the rail starts you in the variant', () => {
  const s = approach();
  s.drive = 1;
  run(s, { drive: 1 }, 0.3);
  assert.equal(s.grind.variant, 1);
  assert.ok(s.grind.vb > 0.8, 'rocked onto the truck late');
});

test('a nosegrind has the board behind the rail with the tail up; a 5-0 has it ahead with the nose up', () => {
  const place = (drive) => {
    const s = approach();
    run(s, hold({ drive }), 1.5);
    return { pos: s.pos.clone(), fwd: forward(s), up: s.up.clone(), s };
  };
  const flat = place(0), nose = place(1), tail = place(-1);
  // Where the middle of the board sits along its own length, measured from the rail point it is gripping.
  const contact = (x) => x.s.grind.path.pointAt(x.s.grind.s, new THREE.Vector3());
  const offset = (x) => x.pos.clone().sub(contact(x)).dot(x.fwd);
  assert.ok(Math.abs(offset(flat)) < 0.02, `50-50 middle is ${offset(flat).toFixed(3)} from the rail`);
  assert.ok(offset(nose) < -0.8 * BOARD.wheelHalfBase, `nosegrind middle only ${offset(nose).toFixed(3)} behind the rail`);
  assert.ok(offset(tail) > 0.8 * BOARD.wheelHalfBase, `5-0 middle only ${offset(tail).toFixed(3)} ahead of the rail`);
  // tail up = the deck's up vector leans toward the nose
  assert.ok(nose.up.dot(nose.fwd) > 0.15, 'nosegrind is not pitched nose-down');
  assert.ok(tail.up.dot(tail.fwd) < -0.15, '5-0 is not pitched nose-up');
  assert.ok(Math.abs(flat.up.dot(flat.fwd)) < 0.05);
});

test('nosegrinds and 5-0s are harder to balance than a 50-50', () => {
  const life = (drive) => {
    let total = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = approach({ seed, speed: 6 });
      let lasted = 0;
      run(s, { drive }, 6, 1 / 72, (t, sk) => { if (sk.grind) lasted = sk.grind.time; });   // nobody balancing: how long until it falls off?
      total += lasted;
    }
    return total / 12;
  };
  const flat = life(0);
  assert.ok(life(1) < flat - 0.02, `nosegrind lasted ${life(1).toFixed(2)} s vs 50-50 ${flat.toFixed(2)} s`);
  assert.ok(life(-1) < flat - 0.02);
});

test('letting go of the stick goes back to a 50-50 but the trick keeps the name of what you held longest', () => {
  const events = [];
  const s = approach({ events });
  run(s, hold({ drive: 1 }), 1.2);
  run(s, hold({ drive: 0 }), 0.4);
  assert.equal(s.grind.variant, 0);
  assert.ok(s.grind.vb < 0.2, 'did not rock back onto both trucks');
  assert.equal(s.grind.name, 'Nosegrind');
  run(s, hold({ drive: -1 }), 0.3);                // a short 5-0 does not rename it
  assert.equal(s.grind.name, 'Nosegrind');
});

test('boardslides are unchanged by the stick, and so is the sloppy-aim case', () => {
  const s = makeSkater({ paths: [longRail()] });
  s.pos.set(0, 0.54, -6); s.heading = Math.PI / 2; s.vel.set(0, 0, -4.5); s.mode = Mode.AIR;
  run(s, { drive: 1 }, 0.6);
  assert.equal(s.mode, Mode.GRIND);
  assert.equal(s.grind.name, 'Boardslide');
  assert.equal(s.grind.vb, 0);
});

test('on a ledge it is the same trick; on coping the name keeps its prefix', () => {
  const s = approach({ kind: 'ledge' });
  run(s, hold({ drive: 1 }), 1.2);
  assert.equal(s.grind.name, 'Nosegrind');
});

test('flicking the stick on a rail is not a manual', () => {
  const events = [];
  const s = approach({ events });
  run(s, hold({ drive: 1 }), 0.4);
  run(s, hold({ drive: -1 }), 0.15);
  run(s, hold({ drive: 1 }), 0.15);
  assert.equal(s.manualQueue, null);
  popOff(s, hold({ drive: 1 }));
  assert.equal(s.mode, Mode.AIR);
  assert.equal(s.manualQueue, null, 'a stick flick on the rail queued a manual');
});
