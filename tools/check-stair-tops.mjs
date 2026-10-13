// For every stair set, what is at the top: how far flat floor continues past the last step, and what ends it (a wall, a drop, or
// nothing).  A stair that ends in a wall or a short stub "goes nowhere".   node tools/check-stair-tops.mjs [levelId]
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'foundry';
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const rows = await page.evaluate(async () => {
    const THREE = await import('three');
    const { sim, renderer } = window.__skate; renderer.setAnimationLoop(null);
    const out = [], seen = new Set(), g = {}, hit = {};
    for (const path of sim.paths) {
      const m = path.name.match(/^PATH_(.*Stairs?)_Handrail/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const pts = path.points;
      const hi = pts[0].y >= pts[pts.length - 1].y ? pts[0] : pts[pts.length - 1];
      const lo = hi === pts[0] ? pts[pts.length - 1] : pts[0];
      const up = new THREE.Vector3(hi.x - lo.x, 0, hi.z - lo.z).normalize();       // direction of travel up the stairs
      const top = hi.clone().addScaledVector(up, 0.3);
      const y0 = sim.world.ground(top.x, top.z, hi.y + 3, g)?.y;
      let flat = 0, end = 'open';
      for (let d = 0.3; d <= 12; d += 0.25) {
        const p = hi.clone().addScaledVector(up, d);
        const y = sim.world.ground(p.x, p.z, y0 + 2.5, g)?.y;
        if (y === undefined || y > y0 + 0.35) { end = y === undefined ? 'nothing beyond' : `rises ${(y - y0).toFixed(1)} m (wall/step)`; break; }
        if (y < y0 - 0.35) { end = `drops ${(y0 - y).toFixed(1)} m`; break; }
        const wall = sim.world.cast(new THREE.Vector3(p.x, y0 + 0.4, p.z), up, 0.3, hit);
        if (wall) { end = `wall at ${d.toFixed(1)} m`; break; }
        flat = d;
      }
      out.push(`${m[1].padEnd(26)} top ${y0?.toFixed(2)} m at (${hi.x.toFixed(0)}, ${hi.z.toFixed(0)}): flat for ${flat.toFixed(1)} m, then ${end}`);
    }
    return out;
  });
  for (const r of rows) console.log(r);
} finally { await browser.close(); server.close(); }
