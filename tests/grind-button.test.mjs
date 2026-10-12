import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Skater, Mode } from '../dist/src/skate/sim.js';
import { pipeSkater } from './halfpipe.mjs';
import { FlatWorld, rail, run } from './helpers.mjs';

// In the game rails and copings are only caught while the right trigger (grind) is held.
function railSkater(events) {
  const s = new Skater({ world: new FlatWorld(), paths: [rail([[0, 0.5, -4], [0, 0.5, -40]])], onEvent: (type, data) => events.push({ type, data }), requireGrind: true });
  s.setSpawn(new THREE.Vector3(0, 0, 0), 0);
  s.pos.set(0, 0.62, -6); s.heading = 0; s.vel.set(0, 0, -5); s.mode = Mode.AIR;
  return s;
}
const started = (events) => events.some((e) => e.type === 'grindStart');
const hold = (sk) => ({ lean: sk.grind ? THREE.MathUtils.clamp(-(sk.grind.bal * 2.2 + sk.grind.balVel * 0.7), -1, 1) : 0 });

test('without the grind button a board passes over a rail', () => {
  const events = [];
  const s = railSkater(events);
  run(s, {}, 1.5);
  assert.ok(!started(events), 'caught the rail without the button');
});

test('holding the grind button catches the rail, and pressing it just before touching it does too', () => {
  for (const pressAt of [0, 0.1]) {
    const events = [];
    const s = railSkater(events);
    run(s, (t, sk) => ({ ...hold(sk), grind: t >= pressAt }), 1.5);
    assert.ok(started(events), `press at ${pressAt}: did not catch`);
  }
});

test('letting go of the grind button hops you off the rail with your speed', () => {
  const events = [];
  const s = railSkater(events);
  run(s, (t, sk) => ({ ...hold(sk), grind: t < 0.6 }), 2);
  assert.ok(started(events));
  const end = events.find((e) => e.type === 'grindEnd');
  assert.equal(end?.data.reason, 'release');
  assert.notEqual(s.mode, Mode.GRIND);
  assert.ok(s.vel.length() > 2, `lost the speed (${s.vel.length().toFixed(1)} m/s)`);
});

test('riding up a half-pipe without the grind button never touches the coping, however slowly or off square you arrive', () => {
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
