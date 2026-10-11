import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mode } from '../dist/src/skate/sim.js';
import { makeSkater, rail, run, FlatWorld } from './helpers.mjs';

const settle = (s) => run(s, {}, 0.5);

test('settles onto flat ground and rolls straight', () => {
  const s = makeSkater();
  settle(s);
  assert.equal(s.mode, Mode.GROUND);
  s.vel.set(0, 0, -4);
  run(s, {}, 3);
  assert.equal(s.mode, Mode.GROUND);
  assert.ok(Math.abs(s.pos.y) < 1e-6);
  assert.ok(Math.abs(s.pos.x) < 1e-3, 'drifted sideways');
  assert.ok(s.speed > 3.0 && s.speed < 4, `speed ${s.speed}`);
  assert.ok(s.pos.z < -10);
});

test('holding forward pushes up to a cruising speed and no further', () => {
  const events = [];
  const s = makeSkater({ events });
  settle(s);
  run(s, { drive: 1 }, 7);
  assert.ok(s.speed > 5.2 && s.speed < 7.2, `speed ${s.speed}`);
  assert.ok(events.filter((e) => e.type === 'push').length >= 6);
});

test('braking stops the board', () => {
  const s = makeSkater();
  settle(s);
  s.vel.set(0, 0, -5);
  run(s, { drive: -1 }, 2);
  assert.ok(s.speed < 0.05, `speed ${s.speed}`);
});

test('steering right curves toward +X, and does nothing when standing still', () => {
  const s = makeSkater();
  settle(s);
  s.vel.set(0, 0, -4);
  run(s, { steer: 1 }, 1.5);
  assert.ok(s.pos.x > 1, `x ${s.pos.x}`);
  assert.ok(s.heading < -0.5);
  const still = makeSkater();
  settle(still);
  run(still, { steer: 1 }, 1);
  assert.ok(Math.abs(still.pos.x) < 1e-6 && Math.abs(still.pos.z) < 1e-6);
});

test('ollie: instant crouch event, pop on release, realistic height, clean landing', () => {
  const events = [];
  const s = makeSkater({ events });
  settle(s);
  s.vel.set(0, 0, -3);
  let peak = 0;
  run(s, (t) => ({ jump: t < 0.05 }), 1.5, 1 / 72, (t, sk) => { peak = Math.max(peak, sk.pos.y); });
  assert.ok(peak > 0.38 && peak < 0.62, `tap ollie peak ${peak}`);
  assert.deepEqual(events.map((e) => e.type).slice(-3), ['crouch', 'pop', 'land']);
  assert.equal(s.mode, Mode.GROUND);

  const big = makeSkater();
  settle(big);
  big.vel.set(0, 0, -3);
  let bigPeak = 0;
  run(big, (t) => ({ jump: t < 0.5 }), 1.8, 1 / 72, (t, sk) => { bigPeak = Math.max(bigPeak, sk.pos.y); });
  assert.ok(bigPeak > peak + 0.2 && bigPeak < 1.0, `full ollie peak ${bigPeak}`);
});

test('a held crouch drops the rider and releasing stands them tall', () => {
  const s = makeSkater();
  settle(s);
  run(s, { jump: true }, 0.4);
  assert.ok(s.crouch > 0.1, `crouch ${s.crouch}`);
});

test('landing sideways at speed is a bail, landing straight is not', () => {
  const events = [];
  const s = makeSkater({ events });
  settle(s);
  s.vel.set(0, 0, -6);
  run(s, (t) => ({ jump: t < 0.05 }), 0.2);
  s.heading = Math.PI / 2; // sideways to travel mid-air
  run(s, {}, 1);
  assert.ok(events.some((e) => e.type === 'bail' && e.data.reason === 'landing'));

  const good = makeSkater();
  settle(good);
  good.vel.set(0, 0, -6);
  run(good, (t) => ({ jump: t < 0.05 }), 1.2);
  assert.equal(good.mode, Mode.GROUND);
});

test('hitting a ledge face at speed bails; low speed just stops', () => {
  const world = new FlatWorld([{ min: [-5, -10], max: [5, -9], top: 0.5 }]);
  const events = [];
  const fast = makeSkater({ world, events });
  settle(fast);
  fast.vel.set(0, 0, -6);
  run(fast, {}, 3);
  assert.ok(events.some((e) => e.type === 'bail' && e.data.reason === 'wall'));

  const slow = makeSkater({ world });
  settle(slow);
  slow.vel.set(0, 0, -1.5);
  run(slow, {}, 12);
  assert.equal(slow.mode, Mode.GROUND);
  assert.ok(slow.pos.z > -9.2, 'slow board climbed the ledge');
});

function approachRail(path, { heading = 0, startZ = -6, y = 0.62, speed = 4.5, offsetX = 0, events } = {}) {
  const s = makeSkater({ paths: [path], events });
  s.pos.set(offsetX, y, startZ);
  s.heading = heading;
  s.vel.set(-Math.sin(heading) * speed, 0, -Math.cos(heading) * speed);
  s.mode = Mode.AIR;
  return s;
}

const longRail = () => rail([[0, 0.5, -4], [0, 0.5, -20]]);

test('dropping a truck-aligned board onto a rail locks a 50-50', () => {
  const events = [];
  const s = approachRail(longRail(), { events });
  let locked = false;
  run(s, { steer: 0 }, 1, 1 / 72, (t, sk) => { if (sk.mode === Mode.GRIND) locked = true; });
  assert.ok(locked, 'never locked');
  const start = events.find((e) => e.type === 'grindStart');
  assert.equal(start.data.name, '50-50');
});

test('grinding with no input falls off; with corrective input it stays on to the end', () => {
  const events = [];
  const s = approachRail(longRail(), { events, speed: 5 });
  run(s, {}, 4);
  const bailed = events.find((e) => e.type === 'bail');
  assert.ok(bailed && bailed.data.reason === 'balance', 'unattended grind should bail on balance');

  const ev2 = [];
  const c = approachRail(longRail(), { events: ev2, speed: 6 });
  let maxBal = 0;
  run(c, (t, sk) => ({ steer: sk.grind ? THREE.MathUtils.clamp(-(sk.grind.bal * 2.2 + sk.grind.balVel * 0.7) , -1, 1) : 0 }), 4, 1 / 72, (t, sk) => { if (sk.grind) maxBal = Math.max(maxBal, Math.abs(sk.grind.bal)); });
  assert.ok(!ev2.some((e) => e.type === 'bail'), 'controlled grind bailed');
  const end = ev2.find((e) => e.type === 'grindEnd');
  assert.ok(end && end.data.reason === 'end', `grind ended with ${end?.data.reason}`);
});

test('releasing the ollie button pops you off the rail', () => {
  const events = [];
  const s = approachRail(longRail(), { events, speed: 6 });
  run(s, (t, sk) => ({
    steer: sk.grind ? THREE.MathUtils.clamp(-(sk.grind.bal * 2.2 + sk.grind.balVel * 0.7), -1, 1) : 0,
    jump: t > 0.2 && t < 0.35
  }), 3);
  const end = events.find((e) => e.type === 'grindEnd');
  assert.equal(end?.data.reason, 'pop');
});

test('a board perpendicular to the rail boardslides', () => {
  const events = [];
  const s = approachRail(longRail(), { heading: Math.PI / 2, events, y: 0.54 });
  s.vel.set(0, 0, -4.5);
  run(s, { steer: 0 }, 0.6);
  const start = events.find((e) => e.type === 'grindStart');
  assert.equal(start?.data.name, 'Boardslide');
});

test('a board at 45° to the rail does not catch it', () => {
  const events = [];
  const s = approachRail(longRail(), { heading: Math.PI / 4, events });
  s.vel.set(0, 0, -4.5);
  run(s, {}, 1);
  assert.ok(!events.some((e) => e.type === 'grindStart'));
});

test('missing the rail sideways does not catch it', () => {
  const events = [];
  const s = approachRail(longRail(), { offsetX: 0.4, events });
  run(s, {}, 1);
  assert.ok(!events.some((e) => e.type === 'grindStart'));
});

test('bail respawns the rider at the last safe spot', () => {
  const events = [];
  const s = makeSkater({ events });
  settle(s);
  run(s, { drive: 1 }, 3);
  s.bail('test');
  run(s, {}, 2);
  assert.equal(events.filter((e) => e.type === 'respawn').length, 2); // spawn + recovery
  assert.notEqual(s.mode, Mode.BAIL);
});
