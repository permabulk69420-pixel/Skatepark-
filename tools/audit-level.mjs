// Compares what is drawn with what can be ridden, over a grid: where a visible upward surface has no collision under it
// (you would fall through a floor you can see), or collision has no visible surface (an invisible floor).
//   node tools/audit-level.mjs <levelId> [step]
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'eastbank';
const step = Number(process.argv[3] || 3);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const result = await page.evaluate(async ({ step }) => {
    const THREE = await import('three');
    const { sim, scene, lods, renderer } = window.__skate;
    renderer.setAnimationLoop(null);
    for (const g of lods.groups) g.levels.forEach((l, i) => { l.mesh.visible = i === 0; });
    scene.updateMatrixWorld(true);
    const render = [];
    scene.traverse((o) => { if (o.isMesh && o.visible && !o.userData.role?.includes('collision') && o.userData.role === 'environment' && !/Foliage|Bark/.test(o.name)) render.push(o); });
    const collide = sim.world.colliders;
    const ray = new THREE.Raycaster(); ray.firstHitOnly = false;
    const heights = (objs, x, z, isRender) => {
      ray.set(new THREE.Vector3(x, 14, z), new THREE.Vector3(0, -1, 0)); ray.far = 20;
      const hits = [];
      for (const h of ray.intersectObjects(objs, false)) {
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (n.y > 0.9 && h.point.y > -2.5 && h.point.y < 3.2) hits.push({ y: +h.point.y.toFixed(2), name: h.object.name });
      }
      // The terrain plane runs under the whole campus; it only matters where nothing else is drawn above it.
      // (the same goes for the terrain's collision, which also runs under everything)
      const kept = isRender ? hits.filter((h) => !/Landscape/.test(h.name) || !hits.some((o) => o.y > h.y + 0.02 && !/Landscape/.test(o.name))) : hits.filter((h) => !/COL_Landscape/.test(h.name) || !hits.some((o) => o.y > h.y + 0.02 && !/COL_Landscape/.test(o.name)));
      return [...new Set(kept.map((h) => h.y))];
    };
    const bad = [];
    let total = 0;
    for (let x = -96; x <= 110; x += step) for (let z = -86; z <= 70; z += step) {
      const r = heights(render, x, z, true), c = heights(collide, x, z, false);
      if (!r.length && !c.length) continue;
      total++;
      const noCollision = r.filter((y) => !c.some((cy) => Math.abs(cy - y) < 0.12));
      const noRender = c.filter((y) => !r.some((ry) => Math.abs(ry - y) < 0.12));
      if (noCollision.length || noRender.length) bad.push({ x, z, noCollision, noRender });
    }
    return { total, bad };
  }, { step });
  // cluster into regions
  const cells = new Map();
  for (const b of result.bad) cells.set(`${b.x},${b.z}`, b);
  const seen = new Set(), regions = [];
  for (const [key, b] of cells) {
    if (seen.has(key)) continue;
    const stack = [b], region = [];
    seen.add(key);
    while (stack.length) {
      const c = stack.pop(); region.push(c);
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const k = `${c.x + dx},${c.z + dz}`;
        if (cells.has(k) && !seen.has(k)) { seen.add(k); stack.push(cells.get(k)); }
      }
    }
    regions.push(region);
  }
  regions.sort((a, b) => b.length - a.length);
  console.log(`${result.total} grid points with a floor, ${result.bad.length} mismatched, ${regions.length} regions`);
  for (const r of regions.slice(0, 25)) {
    const xs = r.map((c) => c.x), zs = r.map((c) => c.z);
    const kind = r.some((c) => c.noCollision.length) && r.some((c) => c.noRender.length) ? 'both' : r.some((c) => c.noCollision.length) ? 'VISIBLE FLOOR, NO COLLISION' : 'COLLISION, NO VISIBLE FLOOR';
    console.log(`${String(r.length).padStart(4)} pts x[${Math.min(...xs)},${Math.max(...xs)}] z[${Math.min(...zs)},${Math.max(...zs)}] ${kind} e.g. render-only ${JSON.stringify(r[0].noCollision)} collision-only ${JSON.stringify(r[0].noRender)}`);
  }
} finally { await browser.close(); server.close(); }
