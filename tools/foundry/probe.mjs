// Ground heights of the built park's collision along a line, for checking the layout without a browser:
//   node tools/foundry/probe.mjs x0,z0 x1,z1 [steps]
import * as THREE from 'three';
import { buildPark } from './park.mjs';
import { SkateWorld } from '../../dist/src/skate/world.js';

const park = buildPark();
const meshes = Object.values(park.cols).map((part) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
  g.setIndex(part.idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.name = part.name;
  m.updateMatrixWorld(true);
  return m;
});
export const world = new SkateWorld(meshes);
export { park };
if (process.argv[1]?.endsWith('probe.mjs')) {
  const [a, b, n = 20] = process.argv.slice(2);
  const [x0, z0] = a.split(',').map(Number), [x1, z1] = b.split(',').map(Number);
  const out = {};
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
    const g = world.ground(x, z, 30, out);
    console.log(x.toFixed(2), z.toFixed(2), g ? `${g.y.toFixed(3)}  n=(${g.nx.toFixed(2)},${g.ny.toFixed(2)},${g.nz.toFixed(2)})` : '-');
  }
}
