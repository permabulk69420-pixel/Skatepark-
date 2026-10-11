// Renders a level from a grid of ground positions (8 directions each, Quest-like field of view) and reports triangles and
// draw calls per view, with and without the LODs.   node tools/measure-level.mjs [levelId] [gridStep]
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'eastbank';
const step = Number(process.argv[3] || 14);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const result = await page.evaluate(async ({ step }) => {
    const { renderer, scene, camera, rig, collision, lods } = window.__skate;
    const THREE = (await import('three'));
    renderer.setAnimationLoop(null);
    const world = window.__skate.sim.world;
    camera.fov = 96; camera.aspect = 1.1; camera.updateProjectionMatrix();
    camera.position.set(0, 1.65, 0);
    const out = { y: 0 };
    const points = [];
    for (let x = -100; x <= 112; x += step) for (let z = -88; z <= 72; z += step) {
      const g = world.ground(x, z, 20, out);
      if (g) points.push([x, g.y, z]);
    }
    const run = (useLods) => {
      const rows = [];
      const eye = new THREE.Vector3();
      for (const [x, y, z] of points) {
        rig.position.set(x, y, z);
        for (let k = 0; k < 8; k++) {
          rig.rotation.set(0, k * Math.PI / 4, 0);
          rig.updateMatrixWorld(true);
          camera.getWorldPosition(eye);
          if (useLods) lods.update(eye);
          else for (const group of lods.groups) group.levels.forEach((l, i) => { l.mesh.visible = i === 0; group.current = 0; });
          renderer.render(scene, camera);
          rows.push([renderer.info.render.triangles, renderer.info.render.calls]);
        }
      }
      const stat = (i) => { const v = rows.map((r) => r[i]).sort((a, b) => a - b); return { mean: Math.round(v.reduce((s, n) => s + n, 0) / v.length), p50: v[v.length >> 1], p95: v[Math.floor(v.length * 0.95)], max: v[v.length - 1] }; };
      return { views: rows.length, triangles: stat(0), calls: stat(1) };
    };
    const withLods = run(true);
    const without = run(false);
    let textureBytes = 0;
    const seen = new Set();
    scene.traverse((o) => { if (!o.material) return; for (const m of [].concat(o.material)) for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) { const t = m[key]; if (t && !seen.has(t) && t.image) { seen.add(t); textureBytes += t.image.width * t.image.height * 4 * 1.33; } } });
    return { points: points.length, withLods, without, textureMB: Math.round(textureBytes / 1e6), geometries: renderer.info.memory.geometries, groups: lods.groups.length };
  }, { step });
  console.log(JSON.stringify(result, null, 1));
} finally {
  await browser.close();
  server.close();
}
