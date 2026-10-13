// Rides the real skater from a level's entrance down its roll-in and into its loop, with a few ways of using the stick, and reports
// the speed going in, the lowest the board got (upside down?), and whether it made it round:   node tools/check-loop.mjs [levelId]
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'foundry';
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const rows = await page.evaluate(() => {
    const { sim, renderer } = window.__skate; renderer.setAnimationLoop(null);
    const dt = 1 / 72;
    const styles = {
      'hold forward all the way': () => ({ drive: 1 }),
      'push on the deck, then let go': (t, s) => ({ drive: s.pos.y > 5.9 ? 1 : 0 }),
      'just roll off (no pushing)': (t) => ({ drive: t < 0.3 ? 1 : 0 }),
      'push on the deck, pump the loop': (t, s) => ({ drive: s.pos.y > 5.9 || s.mode === 'loop' ? 1 : 0 })
    };
    const out = [];
    for (const [name, input] of Object.entries(styles)) {
      sim.respawn(sim.spawn);
      const events = [];
      const orig = sim.onEvent;
      sim.onEvent = (type, data) => { events.push({ type, data }); orig(type, data); };
      let minUp = 1, entry = null, maxSpeed = 0;
      for (let i = 0; i < 72 * 12; i++) {
        const t = i * dt;
        sim.update(input(t, sim), dt);
        maxSpeed = Math.max(maxSpeed, sim.speed);
        if (sim.mode === 'loop') minUp = Math.min(minUp, sim.groundNormal.y);
        if (sim.mode === 'bail') break;
      }
      sim.onEvent = orig;
      entry = events.find((e) => e.type === 'loopStart')?.data;
      const end = events.find((e) => e.type === 'loopEnd')?.data;
      out.push({
        style: name,
        entrySpeed: entry ? +entry.speed.toFixed(2) : null,
        result: end ? (end.completed ? 'LOOP' : end.reason) : 'never reached the loop',
        upsideDown: minUp < -0.9,
        bails: events.filter((e) => e.type === 'bail').map((e) => e.data.reason).join(',') || '-',
        end: `${sim.mode} at (${sim.pos.x.toFixed(1)}, ${sim.pos.y.toFixed(1)}, ${sim.pos.z.toFixed(1)}) ${sim.speed.toFixed(1)} m/s`
      });
    }
    return out;
  });
  for (const r of rows) console.log(JSON.stringify(r));
} finally { await browser.close(); server.close(); }
