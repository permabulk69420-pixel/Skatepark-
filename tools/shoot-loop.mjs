// Screenshots from the rider's own view while riding a level's loop (flat-screen camera, which looks down the board's nose):
//   node tools/shoot-loop.mjs [levelId] [outDir]     → <outDir>/<level>-loop-<n>.png at the run-in, the first wall, the top, the way down
import fs from 'node:fs';
import { serveDist, openPage } from './browser.mjs';

const [levelId = 'foundry', outDir = '.'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`, { width: 1100, height: 700 });
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  await page.evaluate(() => {
    document.querySelector('.entry').style.display = 'none'; document.querySelector('#reset').style.display = 'none';
    const s = window.__skate; s.renderer.setAnimationLoop(null);
    s.sim.respawn(s.sim.spawn);
    window.__shots = { stage: 0 };
  });
  const stages = [(s) => s.mode === 'loop', (s) => s.mode === 'loop' && Math.abs(s.groundNormal.y) < 0.1, (s) => s.mode === 'loop' && s.groundNormal.y < -0.95, (s) => s.mode === 'loop' && s.groundNormal.y > -0.1 && s.loop.minNy < -0.9, (s) => s.mode === 'ground' && s.pos.x > 0];
  for (let k = 0; k < stages.length; k++) {
    const found = await page.evaluate((k) => {
      const { sim, rider, boardView, lods, camera, renderer, scene, hud } = window.__skate;
      const tests = [(s) => s.mode === 'loop', (s) => s.mode === 'loop' && Math.abs(s.groundNormal.y) < 0.1, (s) => s.mode === 'loop' && s.groundNormal.y < -0.95, (s) => s.mode === 'loop' && s.groundNormal.y > -0.1 && s.loop.minNy < -0.9, (s) => s.mode === 'ground' && s.pos.x > 0];
      const dt = 1 / 72;
      for (let i = 0; i < 72 * 12; i++) {
        sim.update({ drive: 1 }, dt);
        rider.update(dt); boardView.update(sim, dt); hud.update(dt);
        if (tests[k](sim)) {
          lods.update(camera.getWorldPosition(camera.position.clone()));
          renderer.render(scene, camera);
          return `${sim.mode} n.y=${sim.groundNormal.y.toFixed(2)} pos=${sim.pos.toArray().map((v) => v.toFixed(1))}`;
        }
      }
      return null;
    }, k);
    console.log(k, found);
    if (found) await page.screenshot({ path: `${outDir}/${levelId}-loop-${k}.png` });
  }
} finally { await browser.close(); server.close(); }
