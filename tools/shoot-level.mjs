// Screenshots a level from a few viewpoints:  node tools/shoot-level.mjs <levelId> <outDir> [x,z,headingDeg ...]
// With OVERLAY=collision in the environment the collision meshes are drawn over the scene as magenta wireframe, so a wall you cannot
// see (collision with nothing drawn there) stands out.
import fs from 'node:fs';
import { serveDist, openPage } from './browser.mjs';

const [levelId = 'eastbank', outDir = '.', ...views] = process.argv.slice(2);
const spots = views.length ? views.map((v) => v.split(',').map(Number)) : [[22, 44, 0], [4, -20, 200], [-30, -10, 90]];
fs.mkdirSync(outDir, { recursive: true });
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`, { width: 1100, height: 700 });
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  await page.evaluate(async (overlay) => {
    document.querySelector('.entry').style.display = 'none'; document.querySelector('#reset').style.display = 'none'; window.__skate.renderer.setAnimationLoop(null);
    if (overlay === 'collision') {
      const THREE = await import('three');
      const material = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.55, depthTest: true });
      for (const mesh of window.__skate.collision) { mesh.material = material; mesh.visible = true; mesh.renderOrder = 10; }
    }
  }, process.env.OVERLAY || '');
  for (const [i, [x, z, heading]] of spots.entries()) {
    await page.evaluate(({ x, z, heading }) => {
      const { renderer, scene, camera, rig, lods, sim } = window.__skate;
      const out = {};
      const g = sim.world.ground(x, z, 30, out);
      camera.fov = 75; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      rig.position.set(x, g ? g.y : 0, z);
      rig.rotation.set(0, heading * Math.PI / 180, 0);
      camera.position.set(0, 1.65, 0);
      rig.updateMatrixWorld(true);
      lods.update(camera.getWorldPosition(new camera.position.constructor()));
      renderer.render(scene, camera);
    }, { x, z, heading });
    await page.screenshot({ path: `${outDir}/${levelId}-${i}.png` });
  }
} finally { await browser.close(); server.close(); }
