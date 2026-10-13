// Rides the real skater from a level's entrance with a given stick input and prints a trace (time, mode, position, speed) and the
// events (pops, landings with their impact, bails):   node tools/ride-line.mjs [levelId] [seconds] [pushSeconds]
// Made for the mega ramp: push on the deck for pushSeconds, then let it roll.
import { serveDist, openPage } from './browser.mjs';

const [levelId = 'megaramp', seconds = '14', push = '1.5'] = process.argv.slice(2);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const out = await page.evaluate(({ seconds, push }) => {
    const { sim, renderer } = window.__skate; renderer.setAnimationLoop(null);
    const lines = [], dt = 1 / 72;
    const orig = sim.onEvent;
    sim.onEvent = (t, d) => { if (!['push', 'crouch', 'pump'].includes(t)) lines.push(`   event ${t} ${JSON.stringify(d ?? {}).slice(0, 90)} @ (${sim.pos.x.toFixed(1)}, ${sim.pos.y.toFixed(1)}, ${sim.pos.z.toFixed(1)})`); orig(t, d); };
    sim.respawn(sim.spawn);
    let last = '';
    for (let i = 0; i < seconds * 72; i++) {
      const t = i * dt;
      sim.update({ drive: t < push ? 1 : 0 }, dt);
      const tag = sim.mode;
      if (i % 36 === 0 || tag !== last) lines.push(`${t.toFixed(2).padStart(6)} ${tag.padEnd(6)} pos (${sim.pos.x.toFixed(1)}, ${sim.pos.y.toFixed(1)}, ${sim.pos.z.toFixed(1)})  speed ${sim.vel.length().toFixed(1)}  n.y ${sim.groundNormal.y.toFixed(2)}`);
      last = tag;
      if (sim.mode === 'bail' && sim.bailTime > 0.1) break;
    }
    sim.onEvent = orig;
    return lines.join('\n');
  }, { seconds: Number(seconds), push: Number(push) });
  console.log(out);
} finally { await browser.close(); server.close(); }
