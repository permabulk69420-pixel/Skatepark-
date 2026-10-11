// Invisible walls: casts rays sideways at board height from a grid of ground points; where collision is hit but nothing visible is
// there (the visible surface is further away, or missing), you would bump into something you cannot see.
//   node tools/audit-walls.mjs <levelId> [step]
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'eastbank';
const step = Number(process.argv[3] || 2.5);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const hits = await page.evaluate(async ({ step }) => {
    const THREE = await import('three');
    const { sim, scene, lods, renderer } = window.__skate; renderer.setAnimationLoop(null);
    for (const g of lods.groups) g.levels.forEach((l, i) => { l.mesh.visible = i === 0; });
    scene.updateMatrixWorld(true);
    const render = []; scene.traverse((o) => { if (o.isMesh && o.visible && o.userData.role === 'environment' && !/Foliage|Bark/.test(o.name)) { o.material = Array.isArray(o.material) ? o.material : o.material; render.push(o); } });
    const world = sim.world, b = sim.bounds, g = {};
    const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
    const out = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const first = (objs, o, d, far) => { ray.set(o, d); ray.far = far; ray.near = 0; const h = ray.intersectObjects(objs, false); return h.length ? h[0].distance : Infinity; };
    // double-sided so the visible check does not depend on facing
    const sides = render.map((m) => { const s = m.material.side; return s; });
    render.forEach((m) => { m.material = m.material.clone(); m.material.side = THREE.DoubleSide; });
    for (let x = b.cx - b.x; x <= b.cx + b.x; x += step) for (let z = b.cz - b.z; z <= b.cz + b.z; z += step) {
      const hit = world.ground(x, z, 12, g);
      if (!hit || hit.ny < 0.9) continue;
      for (const [dx, dz] of dirs) {
        const o = new THREE.Vector3(x, hit.y + 0.4, z), d = new THREE.Vector3(dx, 0, dz);
        const c = world.cast(o, d, 6, {});
        if (!c || c.ny > 0.5) continue;                                  // want walls, not slopes
        const v = first(render, o, d, 7);
        if (v > c.dist + 0.3) out.push({ x: +x.toFixed(1), z: +z.toFixed(1), dx, dz, wallAt: +c.dist.toFixed(2), visibleAt: v === Infinity ? null : +v.toFixed(2), y: +hit.y.toFixed(2) });
      }
    }
    return out;
  }, { step });
  // cluster nearby hits
  const cells = new Map();
  for (const h of hits) { const k = `${Math.round((h.x + h.dx * h.wallAt) / 3)},${Math.round((h.z + h.dz * h.wallAt) / 3)},${h.dx},${h.dz}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(h); }
  const rows = [...cells.values()].sort((a, b) => b.length - a.length);
  console.log(`${hits.length} sideways hits on collision with nothing visible there, in ${rows.length} places`);
  for (const r of rows.slice(0, 30)) {
    const h = r[0];
    console.log(`  ${String(r.length).padStart(3)}x near (${(h.x + h.dx * h.wallAt).toFixed(0)}, ${(h.z + h.dz * h.wallAt).toFixed(0)}) height ${h.y}: wall ${h.wallAt} m away facing (${h.dx},${h.dz}), visible surface ${h.visibleAt === null ? 'none' : h.visibleAt + ' m'}`);
  }
} finally { await browser.close(); server.close(); }
