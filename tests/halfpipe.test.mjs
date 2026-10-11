import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mode } from '../dist/src/skate/sim.js';
import { PIPE, pipeSkater, rollFrom } from './halfpipe.mjs';
import { run } from './helpers.mjs';

const bails = (events) => events.filter((e) => e.type === 'bail').map((e) => e.data.reason);

test('rolling up the wall rises about as high as the speed allows, and comes back down fakie', () => {
  for (const speed of [4, 5.5]) {
    const events = [];
    const s = pipeSkater({ events });
    rollFrom(s, 0, speed, -1);
    let maxY = 0, minVelX = 0, maxVelX = -9;
    run(s, {}, 5, 1 / 72, (t, sk) => { maxY = Math.max(maxY, sk.pos.y); minVelX = Math.min(minVelX, sk.vel.x); maxVelX = Math.max(maxVelX, sk.vel.x); });
    const ideal = speed * speed / (2 * 9.81);
    assert.ok(maxY > ideal * 0.85 && maxY < ideal * 1.05, `speed ${speed}: rose ${maxY.toFixed(2)} m, expected about ${ideal.toFixed(2)}`);
    assert.ok(maxVelX > 2, 'did not roll back down the wall');
    assert.deepEqual(bails(events), [], 'bailed riding the wall');
    assert.equal(s.mode, Mode.GROUND);
  }
});

test('dropping in from the deck lands on the wall and rides to the far side', () => {
  const events = [];
  const s = pipeSkater({ events });
  s.respawn({ pos: new THREE.Vector3(PIPE.lip + 1.2, PIPE.height, 0), heading: Math.PI / 2 });
  for (let i = 0; i < 20; i++) s.update({}, 1 / 72);
  s.vel.set(-1.6, 0, 0);
  let farMax = 0, peakSpeed = 0, crossed = false;
  run(s, {}, 8, 1 / 72, (t, sk) => {
    peakSpeed = Math.max(peakSpeed, sk.speed);
    if (sk.pos.x < -PIPE.halfFlat) { crossed = true; farMax = Math.max(farMax, sk.pos.y); }
  });
  assert.deepEqual(bails(events), [], 'bailed dropping in');
  assert.ok(crossed, 'never reached the far wall');
  assert.ok(peakSpeed > 3.8, `peak speed ${peakSpeed.toFixed(1)}`);
  assert.ok(farMax > PIPE.height * 0.4, `far wall height ${farMax.toFixed(2)}`);
  assert.equal(s.mode, Mode.GROUND);
});

test('enough speed carries you out over the lip and back onto the deck or into the pipe', () => {
  const events = [];
  const s = pipeSkater({ events, withCoping: false });
  rollFrom(s, 0, 9.5, -1);
  let maxY = 0;
  run(s, {}, 4, 1 / 72, (t, sk) => { maxY = Math.max(maxY, sk.pos.y); });
  assert.ok(maxY > PIPE.height + 0.4, `only reached ${maxY.toFixed(2)}`);
  assert.deepEqual(bails(events), []);
  assert.equal(s.mode, Mode.GROUND);
});

test('a board never ends up stuck on the transition', () => {
  for (const [x, speed] of [[0, 2], [-1.2, 0.5], [-3.2, 0.2], [-3.9, 0]]) {
    const s = pipeSkater({ withCoping: false });
    rollFrom(s, x, speed, -1);
    s.pos.y = Math.max(s.pos.y, 0);
    run(s, {}, 8);
    // wherever it was put, it must settle on the floor of the pipe, not hang on the wall
    assert.ok(s.pos.y < 0.3 && Math.abs(s.pos.x) < PIPE.halfFlat + 1, `x=${x}: ended at (${s.pos.x.toFixed(2)}, ${s.pos.y.toFixed(2)})`);
  }
});

test('pumping (squat then stand) on the transitions gains speed; no pumping does not', () => {
  const pumped = pipeSkater();
  rollFrom(pumped, 0, 4, -1);
  const plain = pipeSkater();
  rollFrom(plain, 0, 4, -1);
  const energy = (sk) => 0.5 * sk.vel.lengthSq() + 9.81 * sk.pos.y;
  let startE = energy(pumped), bestPumped = 0, bestPlain = 0;
  run(pumped, (t, sk) => {
    // squat while on the flat, stand as the board starts up a wall (what a rider does by feel)
    const onWall = Math.abs(sk.pos.x) > PIPE.halfFlat && sk.pos.y > 0.15;
    const target = onWall ? 1.65 : 1.45;
    sk.bodyTarget = (sk.bodyTarget ?? 1.55) + (target - (sk.bodyTarget ?? 1.55)) * 0.12;
    return { bodyY: sk.bodyTarget };
  }, 25, 1 / 72, (t, sk) => { bestPumped = Math.max(bestPumped, energy(sk)); });
  run(plain, { bodyY: 1.6 }, 25, 1 / 72, (t, sk) => { bestPlain = Math.max(bestPlain, energy(sk)); });
  assert.ok(bestPumped > startE * 1.15, `pumped energy ${bestPumped.toFixed(1)} vs start ${startE.toFixed(1)}`);
  assert.ok(bestPlain <= startE * 1.02, `unpumped energy grew to ${bestPlain.toFixed(1)} from ${startE.toFixed(1)}`);
});

test('axle stall: reaching the coping almost stopped and square-on catches it; popping rocks you back in fakie', () => {
  let found = null;
  for (let speed = 6.0; speed <= 7.6 && !found; speed += 0.1) {
    const events = [];
    const s = pipeSkater({ events });
    rollFrom(s, 0, speed, -1);
    let stallTime = -1;
    run(s, (t, sk) => {
      if (sk.mode === Mode.GRIND && stallTime < 0) stallTime = t;
      const steer = sk.grind ? THREE.MathUtils.clamp(-(sk.grind.bal * 2.4 + sk.grind.balVel * 0.8), -1, 1) : 0;
      return { steer, jump: stallTime >= 0 && t - stallTime > 0.5 && t - stallTime < 0.62 };
    }, 6);
    const start = events.find((e) => e.type === 'grindStart');
    if (start?.data.name === 'Axle Stall') found = { speed, events, s };
  }
  assert.ok(found, 'no entry speed produced an axle stall');
  assert.deepEqual(bails(found.events), [], 'bailed out of the stall');
  assert.equal(found.events.filter((e) => e.type === 'grindStart').length, 1, 'caught the coping again after popping off');
  assert.equal(found.events.find((e) => e.type === 'grindEnd').data.reason, 'pop');
  assert.equal(found.s.mode, Mode.GROUND);
  assert.ok(found.s.pos.x > -PIPE.lip + 0.2, `ended up outside the pipe (x ${found.s.pos.x.toFixed(2)})`);
});

test('an unattended axle stall falls off the balance meter rather than hanging there forever', () => {
  const events = [];
  const s = pipeSkater({ events });
  rollFrom(s, 0, 7.0, -1);
  run(s, {}, 8);
  assert.ok(events.some((e) => e.type === 'grindStart' && e.data.name === 'Axle Stall'));
  assert.ok(bails(events).includes('balance'));
});

test('rolling off the deck over the coping is a drop-in, never a stall', () => {
  const events = [];
  const s = pipeSkater({ events });
  s.respawn({ pos: new THREE.Vector3(PIPE.lip + 1.2, PIPE.height, 0), heading: Math.PI / 2 });
  for (let i = 0; i < 20; i++) s.update({}, 1 / 72);
  s.vel.set(-1.6, 0, 0);
  run(s, {}, 4);
  assert.ok(!events.some((e) => e.type === 'grindStart'), 'caught the coping while dropping in');
  assert.deepEqual(bails(events), []);
});
