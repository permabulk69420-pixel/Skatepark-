import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SkateWorld } from '../dist/src/skate/world.js';
import { Skater, Mode } from '../dist/src/skate/sim.js';

// The east transition of the school's drainage half-pipe, sampled from the real collision: a smooth curve that gets steeper to
// about 58° and then meets a flat deck at 1.85 m. Heights every 0.1 m of x from the start of the curve.
const CURVE = [0, 0, 0.01, 0.02, 0.03, 0.05, 0.07, 0.09, 0.11, 0.14, 0.17, 0.2, 0.24, 0.28, 0.32, 0.37, 0.42, 0.47, 0.53, 0.59, 0.66, 0.73, 0.8, 0.89, 0.98, 1.07, 1.18, 1.29, 1.41, 1.54, 1.69, 1.85];
const DECK = 3;       // m of flat deck behind the lip

// A ramp along X: flat floor, the curve, a deck, and then a drop behind the deck. Triangles in the XY plane extruded along Z.
function ramp() {
  const profile = [[-12, 0]];
  CURVE.forEach((y, i) => profile.push([i * 0.1, y]));
  const lipX = (CURVE.length - 1) * 0.1;
  profile.push([lipX + DECK, CURVE[CURVE.length - 1]], [lipX + DECK, -1], [-12, -1]);
  const pos = [];
  const L = 5;
  // top surface strips only (the underside is never touched); the drop behind the deck is a vertical face
  for (let i = 0; i + 1 < profile.length - 2; i++) {
    const [ax, ay] = profile[i], [bx, by] = profile[i + 1];
    pos.push(ax, ay, -L, ax, ay, L, bx, by, -L, bx, by, -L, ax, ay, L, bx, by, L);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return { mesh, lipX };
}

function rideUp(speed, { hold = false } = {}) {
  const { mesh, lipX } = ramp();
  const events = [];
  const s = new Skater({ world: new SkateWorld([mesh]), paths: [], onEvent: (type, data) => events.push({ type, data }) });
  s.respawn({ pos: new THREE.Vector3(-10, 0, 0), heading: -Math.PI / 2 });     // nose towards +X
  s.mode = Mode.GROUND;
  s.vel.set(speed, 0, 0);
  let maxX = -99, maxY = 0, stuck = 0;
  let last = s.pos.clone();
  for (let i = 0; i < 72 * 6; i++) {
    s.update({ drive: hold ? 1 : 0 }, 1 / 72);
    maxX = Math.max(maxX, s.pos.x);
    maxY = Math.max(maxY, s.pos.y);
    // "stuck": still on the ground, still moving fast along the surface, but not going anywhere for a full second
    if (i % 72 === 0) { if (s.mode === Mode.GROUND && s.speed > 1 && s.pos.distanceTo(last) < 0.05) stuck++; last = s.pos.clone(); }
  }
  return { s, events, maxX, maxY, lipX, stuck };
}

test('a steep bank that meets a flat deck can be ridden up to the lip: no invisible wall', () => {
  const r = rideUp(7.4);
  assert.ok(r.maxY > 1.8, `only got ${r.maxY.toFixed(2)} m up a 1.85 m ramp`);
  assert.equal(r.stuck, 0, 'the board stopped dead on the ramp while still moving');
  assert.ok(!r.events.some((e) => e.type === 'bail'), `bailed: ${r.events.find((e) => e.type === 'bail')?.data.reason}`);
});

test('with forward held and enough speed you go over the lip and land on the deck', () => {
  const r = rideUp(7.4, { hold: true });
  assert.ok(r.maxX > r.lipX + 0.5, `never got past the lip (max x ${r.maxX.toFixed(2)})`);
  assert.ok(!r.events.some((e) => e.type === 'bail'), 'bailed going over the top');
});

test('too slow to reach the top: you roll back down the ramp, never stuck on it', () => {
  const r = rideUp(5.2);
  assert.equal(r.stuck, 0);
  assert.ok(r.maxX < r.lipX, 'a slow rider should not have reached the top');
  assert.ok(Math.abs(r.s.pos.y) < 0.2 || r.s.pos.x < 0, `ended up at (${r.s.pos.x.toFixed(2)}, ${r.s.pos.y.toFixed(2)})`);
  assert.ok(!r.events.some((e) => e.type === 'bail'));
});
