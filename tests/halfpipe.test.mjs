import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mode } from '../dist/src/skate/sim.js';
import { PIPE, pipeSkater, rollFrom } from './halfpipe.mjs';
import { makeSkater, run } from './helpers.mjs';

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

test('holding forward pumps the transitions: speed builds pass after pass until you air out over the lip', () => {
  const s = pipeSkater({ withCoping: false });
  rollFrom(s, 0, 4, -1);
  let apexByTen = 0, passes = [], last = 1;
  run(s, { drive: 1 }, 10, 1 / 72, (t, sk) => {
    apexByTen = Math.max(apexByTen, sk.pos.y);
    const side = Math.sign(sk.pos.x);
    if (side !== last && Math.abs(sk.pos.x) < 0.3 && sk.mode === Mode.GROUND) { passes.push(sk.speed); last = side; }
  });
  assert.ok(passes.length >= 3, 'did not complete several passes');
  assert.ok(Math.max(...passes) > 5.8, `bottom speeds ${passes.map((p) => p.toFixed(1))}`);
  assert.ok(apexByTen > PIPE.height, `never reached the lip (apex ${apexByTen.toFixed(2)})`);
});

test('forward on the stick while rolling fakie keeps you rolling, it does not brake you', () => {
  const s = makeSkater();
  run(s, {}, 0.5);
  s.heading = Math.PI / 2;           // nose pointing -X but rolling +X: fakie
  s.vel.set(4, 0, 0);
  run(s, { drive: 1 }, 1.5);
  assert.ok(s.vel.x > 3.5, `fakie speed fell to ${s.vel.x.toFixed(2)}`);
});

test('an ollie off the wall goes up, not backwards into the pipe', () => {
  for (const popAtY of [0.5, 1.0, 1.5]) {
    const popped = pipeSkater({ withCoping: false });
    const plain = pipeSkater({ withCoping: false });
    for (const sk of [popped, plain]) rollFrom(sk, 0, 7, -1);
    let t0 = -1, apexPopped = 0, apexPlain = 0, vxAfter = 0;
    run(popped, (t, sk) => {
      if (t0 < 0 && Math.abs(sk.pos.x) > PIPE.halfFlat && sk.pos.y > popAtY && sk.vel.y > 0) t0 = t;
      return { jump: t0 >= 0 && t - t0 < 0.04 };
    }, 3, 1 / 72, (t, sk) => { apexPopped = Math.max(apexPopped, sk.pos.y); if (t0 >= 0 && vxAfter === 0 && t - t0 > 0.12) vxAfter = sk.vel.x; });
    run(plain, {}, 3, 1 / 72, (t, sk) => { apexPlain = Math.max(apexPlain, sk.pos.y); });
    assert.ok(apexPopped > apexPlain + 0.4, `pop at y>${popAtY}: apex ${apexPopped.toFixed(2)} vs ${apexPlain.toFixed(2)} without`);
    assert.ok(vxAfter < 0.3, `pop at y>${popAtY} threw the board backwards (vx ${vxAfter.toFixed(2)})`);
  }
});

// Furthest the board gets from the pipe's centre while above the lip, i.e. whether an air went out over the top.
function airOverLip(s, input, seconds) {
  let maxOut = 0, apex = 0, first = { air: -1, over: -1 };
  run(s, input, seconds, 1 / 72, (t, sk) => {
    apex = Math.max(apex, sk.pos.y);
    if (sk.pos.y > PIPE.height + 0.2 && first.air < 0) first.air = t;
    if (Math.abs(sk.pos.x) > PIPE.lip + 0.8 && sk.pos.y > PIPE.height - 0.3 && first.over < 0) first.over = t;
    if (sk.pos.y > PIPE.height - 0.3) maxOut = Math.max(maxOut, Math.abs(sk.pos.x) - PIPE.lip);
  });
  return { maxOut, apex, ...first };
}

test('an air out of the lip with ordinary speed comes back down into the pipe, pop or no pop', () => {
  for (const popAtY of [null, 1.0, 1.6]) {
    const events = [];
    const s = pipeSkater({ events, withCoping: true });
    rollFrom(s, 0, 7.6, -1);
    let t0 = -1;
    const r = airOverLip(s, (t, sk) => {
      if (popAtY !== null && t0 < 0 && Math.abs(sk.pos.x) > PIPE.halfFlat && sk.pos.y > popAtY && sk.vel.y > 0) t0 = t;
      return { jump: t0 >= 0 && t - t0 < 0.05 };
    }, 5);
    assert.ok(r.maxOut < 0.2, `pop ${popAtY}: drifted ${r.maxOut.toFixed(2)} m out over the lip`);
    assert.deepEqual(bails(events), [], `pop ${popAtY}: bailed coming back in`);
    assert.ok(Math.abs(s.pos.x) < PIPE.lip + 0.2, 'ended up outside the pipe');
  }
});

test('real speed alone is not enough: without holding forward you stay in the pipe, even at 10 m/s', () => {
  for (const [label, drive] of [['not touching the stick', () => 0], ['tapping forward', (t) => ((t * 3) % 1 < 0.4 ? 1 : 0)]]) {
    const events = [];
    const s = pipeSkater({ events });
    rollFrom(s, 0, 10.5, -1);
    const r = airOverLip(s, (t) => ({ drive: drive(t) }), 4);
    assert.ok(r.maxOut < 0.45, `${label}: went ${r.maxOut.toFixed(2)} m out over the lip`);
    assert.ok(r.apex > PIPE.height + 1.5, `${label}: no real air (apex ${r.apex.toFixed(2)})`);
    assert.deepEqual(bails(events), []);
  }
});

test('holding forward with the speed to clear the lip takes you out over the top, with or without a pop', () => {
  for (const pop of [false, true]) {
    const events = [];
    const s = pipeSkater({ events });
    rollFrom(s, 0, 9.5, -1);
    s.holdFwd = 4;                       // forward has been held a good while
    let t0 = -1;
    const r = airOverLip(s, (t, sk) => {
      if (pop && t0 < 0 && Math.abs(sk.pos.x) > PIPE.halfFlat + 1 && sk.pos.y > 1.0 && sk.vel.y > 0) t0 = t;
      return { drive: 1, jump: t0 >= 0 && t - t0 < 0.05 };
    }, 2.5);
    assert.ok(r.maxOut > 1.2, `${pop ? 'pop' : 'no pop'}: only ${r.maxOut.toFixed(2)} m beyond the lip`);
    assert.deepEqual(bails(events), []);
  }
});

test('holding forward without the speed to clear the lip still stays in', () => {
  const s = pipeSkater({});
  rollFrom(s, 0, 6.2, -1);
  s.holdFwd = 4;
  const r = airOverLip(s, { drive: 1 }, 3);
  assert.ok(r.maxOut < 0.45, `went ${r.maxOut.toFixed(2)} m out over the lip`);
});

test('holding forward: early airs stay in the pipe, and a decent while later you pass over', () => {
  const s = pipeSkater({ withCoping: true });
  rollFrom(s, 0, 4, -1);
  const r = airOverLip(s, { drive: 1 }, 25);
  assert.ok(r.air > 0 && r.over > 0, `air at ${r.air}, over at ${r.over}`);
  assert.ok(r.air < r.over, 'passed over before ever airing in the pipe');
  assert.ok(r.over > 3.5, `passed over after only ${r.over.toFixed(1)} s`);
  assert.ok(r.over < 22, `still had not passed over after ${r.over.toFixed(1)} s`);
});

test('coming out of the wall you stay tilted like the wall, easing towards what you will land on', () => {
  const s = pipeSkater({ withCoping: true });
  rollFrom(s, 0, 8, -1);
  const tilt = () => Math.acos(THREE.MathUtils.clamp(s.up.y, -1, 1));
  let leftAt = -1, atLeave = 0, after04 = 0, landed = 0;
  run(s, {}, 3, 1 / 72, (t) => {
    if (s.mode === Mode.AIR && leftAt < 0 && s.pos.y > 1.2) { leftAt = t; atLeave = tilt(); }
    if (leftAt >= 0 && t - leftAt > 0.4 && after04 === 0) after04 = tilt();
  });
  assert.ok(atLeave > 0.7, `left the wall only tilted ${(atLeave * 57.3).toFixed(0)}°`);
  assert.ok(after04 > atLeave * 0.8, `snapped back to ${(after04 * 57.3).toFixed(0)}° from ${(atLeave * 57.3).toFixed(0)}° within 0.4 s`);
});

test('passing over the top never grabs the coping', () => {
  for (const speed of [8.2, 9.2, 10.5]) {
    const events = [];
    const s = pipeSkater({ events, withCoping: true });
    rollFrom(s, 0, speed, -1);
    s.holdFwd = 4;
    const r = airOverLip(s, { drive: 1 }, 3);
    assert.ok(r.maxOut > 1.0, `entry ${speed}: only ${r.maxOut.toFixed(2)} m beyond the lip`);
    assert.ok(!events.some((e) => e.type === 'grindStart'), `entry ${speed}: grabbed the coping`);
    assert.deepEqual(bails(events), []);
  }
});

test('holding forward at the top is never an axle stall', () => {
  for (let speed = 6.4; speed <= 7.4; speed += 0.2) {
    const events = [];
    const s = pipeSkater({ events, withCoping: true });
    rollFrom(s, 0, speed, -1);
    run(s, { drive: 1 }, 3);
    assert.ok(!events.some((e) => e.type === 'grindStart'), `entry ${speed.toFixed(1)}: stalled while holding forward`);
  }
});
