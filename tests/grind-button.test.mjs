import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Skater, Mode } from '../dist/src/skate/sim.js';
import { TUNING as T } from '../dist/src/skate/config.js';
import { pipeSkater } from './halfpipe.mjs';
import { FlatWorld, rail, run } from './helpers.mjs';

// In the game rails and copings are only caught after one press of the right trigger (grind); holding it does nothing more.
function railSkater(events) {
  const s = new Skater({ world: new FlatWorld(), paths: [rail([[0, 0.5, -4], [0, 0.5, -40]])], onEvent: (type, data) => events.push({ type, data }), requireGrind: true });
  s.setSpawn(new THREE.Vector3(0, 0, 0), 0);
  s.pos.set(0, 0.62, -6); s.heading = 0; s.vel.set(0, 0, -5); s.mode = Mode.AIR;
  return s;
}
const started = (events) => events.some((e) => e.type === 'grindStart');
const balance = (sk) => ({ lean: sk.grind ? THREE.MathUtils.clamp(-(sk.grind.bal * 2.2 + sk.grind.balVel * 0.7), -1, 1) : 0 });
// The board reaches the rail about 0.05 s in (it starts 0.12 m above it, falling).
const pressedAt = (at, width = 0.08) => (t, sk) => ({ ...balance(sk), grind: t >= at && t < at + width });

test('without pressing the grind button a board passes over a rail', () => {
  const events = [];
  const s = railSkater(events);
  run(s, balance, 1.5);
  assert.ok(!started(events), 'caught the rail without the button');
});

test('one quick press catches the rail, before or as you touch it, and you can let go straight away', () => {
  for (const at of [0, 0.03, 0.1]) {
    const events = [];
    const s = railSkater(events);
    run(s, pressedAt(at), 1.5);
    assert.ok(started(events), `press at ${at}: did not catch`);
    assert.equal(s.mode, Mode.GRIND, `press at ${at}: came off the rail when the button was let go`);
  }
});

test('a press well before the rail is not remembered', () => {
  const events = [];
  const s = railSkater(events);
  s.pos.set(0, 3, -6);                     // falls for a good while before it reaches the rail
  run(s, pressedAt(0), 2.5);
  assert.ok(!started(events), 'caught the rail from a press made long before touching it');
});

test('holding the button down does not keep catching: you have to press it again for the next rail', () => {
  const events = [];
  const s = railSkater(events);
  run(s, (t, sk) => ({ ...balance(sk), grind: true }), 0.6);     // held from the start: that is one press
  assert.ok(started(events));
  const first = events.filter((e) => e.type === 'grindStart').length;
  s.vel.set(0, 3, -3); s.pos.set(0, 1.5, -10); s.mode = Mode.AIR; s.grind = null;
  run(s, (t, sk) => ({ ...balance(sk), grind: true }), 1.5);     // still held: no new press, so no new catch
  assert.equal(events.filter((e) => e.type === 'grindStart').length, first, 'caught again with the button merely held');
});

test('riding up a half-pipe without pressing the grind button never touches the coping, however slowly or off square you arrive', () => {
  for (const speed of [4, 5.5, 7, 9]) for (const yawDeg of [0, 4, 7]) {
    const events = [];
    const s = pipeSkater({ events, withCoping: true, requireGrind: true });
    s.respawn({ pos: new THREE.Vector3(0, 0, 0), heading: Math.PI / 2 + yawDeg * Math.PI / 180 });
    for (let i = 0; i < 20; i++) s.update({}, 1 / 72);
    const h = s.heading;
    s.vel.set(-Math.sin(h) * speed, 0, -Math.cos(h) * speed);
    run(s, { drive: 1 }, 6);
    assert.ok(!started(events), `speed ${speed}, ${yawDeg}° off: caught the coping`);
  }
});

test('the press window is a moment, not a latch', () => {
  assert.ok(T.grindArmWindow > 0.2 && T.grindArmWindow < 0.8, `window ${T.grindArmWindow}`);
});

// Tony Hawk style: roll up the wall of a ramp or bowl, press grind near the top, and the board latches onto the coping and grinds along it.
function ridePipe({ speed, yawDeg, pressWhenAbove, events, drive = 1 }) {
  const s = pipeSkater({ events, withCoping: true, requireGrind: true });
  s.respawn({ pos: new THREE.Vector3(0, 0, 0), heading: Math.PI / 2 + yawDeg * Math.PI / 180 });
  for (let i = 0; i < 20; i++) s.update({}, 1 / 72);
  const h = s.heading;
  s.vel.set(-Math.sin(h) * speed, 0, -Math.cos(h) * speed);
  let pressedAt = -1, grindTime = 0, mode0 = null;
  run(s, (t, sk) => {
    if (pressedAt < 0 && sk.pos.y > pressWhenAbove) pressedAt = t;
    return { drive, lean: sk.grind ? THREE.MathUtils.clamp(-(sk.grind.bal * 2.2 + sk.grind.balVel * 0.7), -1, 1) : 0, grind: pressedAt >= 0 && t - pressedAt < 0.08 };
  }, 3, 1 / 72, (t, sk) => { if (sk.mode === Mode.GRIND) { grindTime += 1 / 72; mode0 = mode0 ?? sk.grind.name; } });
  return { s, grindTime, name: mode0, pressedAt };
}

test('pressing grind near the top of the wall, rolling up at an angle, latches onto the coping and grinds along it', () => {
  for (const [speed, yawDeg] of [[8, 25], [8, -25], [7, 20], [9, 15]]) {
    const events = [];
    const r = ridePipe({ speed, yawDeg, pressWhenAbove: 1.2, events });
    assert.ok(started(events), `speed ${speed}, ${yawDeg}° off: did not catch the coping`);
    assert.ok(r.grindTime > 0.4, `speed ${speed}, ${yawDeg}° off: only grinded for ${r.grindTime.toFixed(2)} s`);   // the test coping is only 11 m long
    assert.ok(/Coping/.test(r.name), `caught ${r.name}`);
  }
});

test('the same press from the air, just under or over the lip, catches too', () => {
  for (const above of [1.7, 1.9]) {
    const events = [];
    const r = ridePipe({ speed: 9, yawDeg: 20, pressWhenAbove: above, events });
    assert.ok(started(events), `press above ${above}: did not catch`);
    assert.ok(r.grindTime > 0.4);
  }
});

test('pressing grind arriving square-on with no speed along the lip does not catch (there is nothing to grind along)', () => {
  const events = [];
  const r = ridePipe({ speed: 8, yawDeg: 0, pressWhenAbove: 1.5, events });
  assert.ok(!started(events), `caught while square-on (${r.name})`);
});
