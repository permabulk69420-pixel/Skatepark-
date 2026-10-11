import * as THREE from 'three';
import { SkateWorld } from '../dist/src/skate/world.js';
import { GrindPath } from '../dist/src/skate/rails.js';
import { Skater } from '../dist/src/skate/sim.js';

// A procedural half pipe running along Z: flat bottom, round transitions, a short vertical, a deck on each side and coping on
// the lips. Built as a real triangle mesh so the actual SkateWorld ray code is what gets tested.
export const PIPE = { halfFlat: 2.5, radius: 1.9, vertical: 0.25, deck: 2.4, length: 12, arcSteps: 24 };
PIPE.height = PIPE.radius + PIPE.vertical;
PIPE.lip = PIPE.halfFlat + PIPE.radius;       // |x| of the lip on each side

export function buildHalfPipe(p = PIPE) {
  const profile = [];
  const side = (sign) => {
    const pts = [];
    pts.push([sign * (p.lip + p.deck), p.height], [sign * p.lip, p.height], [sign * p.lip, p.radius]);
    for (let i = p.arcSteps - 1; i >= 0; i--) {
      const th = (i / p.arcSteps) * Math.PI / 2;
      pts.push([sign * (p.halfFlat + p.radius * Math.sin(th)), p.radius - p.radius * Math.cos(th)]);
    }
    return pts;
  };
  const left = side(-1);                     // deck → floor, increasing x
  const right = side(1).reverse();           // floor → deck
  profile.push(...left, ...right.slice(1));
  const L = p.length / 2;
  const pos = [];
  for (let i = 0; i + 1 < profile.length; i++) {
    const [ax, ay] = profile[i], [bx, by] = profile[i + 1];
    const a0 = [ax, ay, -L], a1 = [ax, ay, L], b0 = [bx, by, -L], b1 = [bx, by, L];
    pos.push(...a0, ...a1, ...b0, ...b0, ...a1, ...b1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

export function coping(sign, p = PIPE) {
  return new GrindPath({
    name: sign < 0 ? 'west coping' : 'east coping', kind: 'coping', closed: false, radius: 0.042,
    points: [new THREE.Vector3(sign * p.lip, p.height + 0.045, -p.length / 2 + 0.5), new THREE.Vector3(sign * p.lip, p.height + 0.045, p.length / 2 - 0.5)]
  });
}

export function pipeSkater({ events = [], withCoping = true, seed = 7 } = {}) {
  let state = seed;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const world = new SkateWorld([buildHalfPipe()]);
  const paths = withCoping ? [coping(-1), coping(1)] : [];
  const skater = new Skater({ world, paths, random, onEvent: (type, data) => events.push({ type, data }) });
  return skater;
}

// Put the skater on the floor at x, rolling along -X (towards the west wall) or +X.
export function rollFrom(skater, x, speed, towards = -1) {
  skater.respawn({ pos: new THREE.Vector3(x, 0, 0), heading: towards < 0 ? Math.PI / 2 : -Math.PI / 2 });
  for (let i = 0; i < 20; i++) skater.update({}, 1 / 72);
  skater.vel.set(towards * speed, 0, 0);
}
