// Height profile of the collision along a line (what a board rolling along it would meet), plus what the visible meshes do:
//   node tools/profile-ramp.mjs <levelId> <x0,z0> <x1,z1> [step]
import { serveDist, openPage } from './browser.mjs';

const [levelId = 'foundry', a = '20,-27.5', b = '28,-27.5', step = '0.1'] = process.argv.slice(2);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const rows = await page.evaluate(async ({ a, b, step }) => {
    const THREE = await import('three');
    const { sim, scene, lods, renderer } = window.__skate; renderer.setAnimationLoop(null);
    for (const g of lods.groups) g.levels.forEach((l, i) => { l.mesh.visible = i === 0; });
    scene.updateMatrixWorld(true);
    const render = []; scene.traverse((o) => { if (o.isMesh && o.visible && o.userData.role === 'environment') render.push(o); });
    const [x0, z0] = a.split(',').map(Number), [x1, z1] = b.split(',').map(Number);
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / Number(step));
    const ray = new THREE.Raycaster(); ray.firstHitOnly = false;
    const top = (objs, x, z, fromY) => { ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0)); ray.far = 40; const h = ray.intersectObjects(objs, false).filter((i) => i.face.normal.clone().transformDirection(i.object.matrixWorld).y > 0.02); return h.length ? h[0].point.y : null; };
    const out = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
      const c = sim.world.ground(x, z, 12, {});
      const r = top(render, x, z, 12);
      out.push(`x ${x.toFixed(2)}  collision ${c ? c.y.toFixed(2) : '  - '}  n.y ${c ? c.ny.toFixed(2) : ' - '}   visible ${r === null ? ' - ' : r.toFixed(2)}`);
    }
    return out;
  }, { a, b, step });
  console.log(rows.join('\n'));
} finally { await browser.close(); server.close(); }
