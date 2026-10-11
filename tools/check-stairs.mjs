// Rolls the real skater off the top of every stair set (found from the handrail grind paths named *Stair*), with no ollie and with
// an ollie at the edge:  node tools/check-stairs.mjs [levelId]
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'eastbank';
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const rows = await page.evaluate(async () => {
    const THREE = await import('three');
    const { sim, renderer } = window.__skate; renderer.setAnimationLoop(null);
    const dt = 1 / 72, out = [];
    const seen = new Set();
    for (const path of sim.paths) {
      const m = path.name.match(/^PATH_(.*Stairs?)_Handrail/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const pts = path.points;
      const hi = pts[0].y >= pts[pts.length - 1].y ? pts[0] : pts[pts.length - 1];
      const lo = hi === pts[0] ? pts[pts.length - 1] : pts[0];
      const dir = new THREE.Vector3(lo.x - hi.x, 0, lo.z - hi.z).normalize();       // heading down the stairs
      const run = Math.hypot(lo.x - hi.x, lo.z - hi.z), rise = hi.y - lo.y;
      const g = {};
      const topY = (p) => sim.world.ground(p.x, p.z, p.y + 3, g)?.y;
      const trial = (popAt, speed) => {
        const start = hi.clone().addScaledVector(dir, -3.5); start.y = topY(start) ?? hi.y;
        sim.respawn({ pos: start, heading: Math.atan2(-dir.x, -dir.z) });
        sim.mode = 'ground'; sim.vel.copy(dir).multiplyScalar(speed);
        let events = [], popped = false;
        const orig = sim.onEvent; sim.onEvent = (t, d) => { events.push(t + (d?.reason ? ':' + d.reason : '')); orig(t, d); };
        let minGround = 0, result = 'rolled';
        for (let i = 0; i < 72 * 4; i++) {
          const toTop = (sim.pos.x - hi.x) * dir.x + (sim.pos.z - hi.z) * dir.z;     // + once past the top edge
          let cmd = { drive: 0 };
          if (popAt !== null && !popped && toTop > -popAt) { cmd = { jump: true }; if (i > 0) popped = 'press'; }
          if (popped === 'press') { sim.update({ jump: true }, dt); sim.update({}, dt); popped = true; continue; }
          sim.update(cmd, dt);
          if (sim.mode === 'bail') { result = 'BAIL ' + events.filter((e) => e.startsWith('bail')).join(); break; }
        }
        sim.onEvent = orig;
        const end = { x: +sim.pos.x.toFixed(1), z: +sim.pos.z.toFixed(1) };
        const progress = ((sim.pos.x - hi.x) * dir.x + (sim.pos.z - hi.z) * dir.z);
        return `${result}${result === 'rolled' ? ` mode=${sim.mode} ${progress.toFixed(1)} m past the top` : ''}`;
      };
      out.push({ stairs: m[1], rise: +rise.toFixed(2), run: +run.toFixed(1), topY: +(topY(hi) ?? NaN).toFixed(2), rollOff: trial(null, 4.5), pop: trial(0.5, 4.5), popFast: trial(0.4, 6.5) });
    }
    return out;
  });
  for (const r of rows) console.log(JSON.stringify(r));
} finally { await browser.close(); server.close(); }
