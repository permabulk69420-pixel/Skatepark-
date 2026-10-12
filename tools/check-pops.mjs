// Ollies from random spots of a level (rolling at 4 m/s, any surface up to about 45°) and counts the ones that do not leave the ground:
//   node tools/check-pops.mjs [levelId] [tries]
import { serveDist, openPage } from './browser.mjs';
const [level, n = '60'] = process.argv.slice(2);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${level}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 280000 });
  const res = await page.evaluate(async (n) => {
    const THREE = await import('three');
    const { sim, renderer } = window.__skate; renderer.setAnimationLoop(null);
    let seed = 777; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const b = sim.bounds; const rows = [];
    for (let r = 0; r < n; r++) {
      let start = null;
      for (let k = 0; k < 300 && !start; k++) {
        const x = b.cx + (rnd() * 2 - 1) * b.x * 0.9, z = b.cz + (rnd() * 2 - 1) * b.z * 0.9;
        const g = sim.world.ground(x, z, 4, {}, 12);
        if (g && g.ny > 0.7) start = { x, z, y: g.y, ny: g.ny };
      }
      if (!start) continue;
      const h = rnd() * Math.PI * 2;
      sim.respawn({ pos: new THREE.Vector3(start.x, start.y, start.z), heading: h });
      sim.mode = 'ground'; sim.vel.set(-Math.sin(h) * 4, 0, -Math.cos(h) * 4);
      let popped = false, airTime = 0, maxLift = 0, y0 = null, nAtPop = null, modeAtPress = null;
      const orig = sim.onEvent; sim.onEvent = (t, d) => { if (t === 'pop') { popped = true; nAtPop = sim.groundNormal.y; } orig(t, d); };
      for (let i = 0; i < 72 * 2.2; i++) {
        const t = i / 72;
        const jump = t > 0.8 && t < 0.95;
        if (t >= 0.94 && modeAtPress === null) modeAtPress = sim.mode;
        sim.update({ drive: 0, jump }, 1 / 72);
        if (popped) { if (y0 === null) y0 = sim.pos.y; if (sim.mode === 'air') airTime += 1 / 72; maxLift = Math.max(maxLift, sim.pos.y - y0); }
      }
      sim.onEvent = orig;
      rows.push({ h: +h.toFixed(3), x: +start.x.toFixed(1), z: +start.z.toFixed(1), ny: +start.ny.toFixed(2), modeAtPress, popped, airTime: +airTime.toFixed(2), lift: +maxLift.toFixed(2), nAtPop });
    }
    return rows;
  }, Number(n));
  const bad = res.filter((r) => r.modeAtPress === 'ground' && (!r.popped || r.airTime < 0.15));
  console.log(level, 'tries', res.length, 'on ground at the press', res.filter((r) => r.modeAtPress === 'ground').length, 'no pop / no air', bad.length);
  for (const r of bad.slice(0, 12)) console.log('  ', JSON.stringify(r));
} finally { await browser.close(); server.close(); }

