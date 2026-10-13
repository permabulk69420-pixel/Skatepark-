// Top-down plan view of a level (and optionally a close-up): node tools/plan-level.mjs <levelId> <out.png> [cx,cz,height]
import { serveDist, openPage } from './browser.mjs';

const [levelId = 'foundry', out = 'plan.png', view = ''] = process.argv.slice(2);
const [cx, cz, height] = (view || '7,-8,230').split(',').map(Number);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`, { width: 1600, height: 1300 });
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  await page.evaluate(({ cx, cz, height }) => {
    document.querySelector('.entry').style.display = 'none'; document.querySelector('#reset').style.display = 'none';
    const { renderer, scene, camera, lods } = window.__skate;
    renderer.setAnimationLoop(null);
    scene.fog = null;
    camera.far = 1000; camera.fov = 50; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    camera.parent.position.set(cx, height, cz);
    camera.parent.rotation.set(-Math.PI / 2, 0, 0);
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    camera.parent.updateMatrixWorld(true);
    for (const g of lods.groups) g.levels.forEach((l, i) => { l.mesh.visible = i === 0; });
    renderer.render(scene, camera);
  }, { cx, cz, height });
  await page.screenshot({ path: out });
} finally { await browser.close(); server.close(); }
