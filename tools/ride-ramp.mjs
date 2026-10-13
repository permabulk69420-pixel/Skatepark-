// Rides the real skater at a ramp from a start point in a given heading and traces what happens:
//   node tools/ride-ramp.mjs <levelId> <x,z> <headingDegrees> <speed> [seconds] [holdForward 0|1] [startSearchHeight, default 30: lower it to start inside a pit]
// Prints position / height / mode every 0.1 s plus every event (wall hits, bails, landings).
import { serveDist, openPage } from './browser.mjs';

const [levelId = 'foundry', start = '17,-27.5', headingDeg = '-90', speed = '7', seconds = '4', hold = '0', top = '30'] = process.argv.slice(2);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const lines = await page.evaluate(async ({ start, headingDeg, speed, seconds, hold, top }) => {
    const THREE = await import('three');
    const { sim, renderer } = window.__skate; renderer.setAnimationLoop(null);
    const [x, z] = start.split(',').map(Number);
    const h = headingDeg * Math.PI / 180;
    const g = sim.world.ground(x, z, Number(top), {});
    sim.respawn({ pos: new THREE.Vector3(x, g?.y ?? 0, z), heading: h });
    sim.mode = 'ground'; sim.vel.set(-Math.sin(h) * speed, 0, -Math.cos(h) * speed);
    const out = [];
    const orig = sim.onEvent; sim.onEvent = (t, d) => { if (!['crouch', 'push', 'respawn'].includes(t)) out.push(`  EVENT ${t}${d?.reason ? ' ' + d.reason : ''}${d?.impact ? ' impact ' + d.impact.toFixed(1) : ''} at (${sim.pos.x.toFixed(2)}, ${sim.pos.y.toFixed(2)}, ${sim.pos.z.toFixed(2)})`); orig(t, d); };
    for (let i = 0; i < 72 * seconds; i++) {
      sim.update({ drive: Number(hold) ? 1 : 0 }, 1 / 72);
      if (i % 7 === 0) out.push(`t${(i / 72).toFixed(1)} ${sim.mode.padEnd(6)} pos (${sim.pos.x.toFixed(2)}, ${sim.pos.y.toFixed(2)}, ${sim.pos.z.toFixed(2)}) v ${sim.vel.x.toFixed(1)},${sim.vel.y.toFixed(1)},${sim.vel.z.toFixed(1)} n.y ${sim.groundNormal.y.toFixed(2)}`);
    }
    return out;
  }, { start, headingDeg, speed, seconds, hold, top });
  console.log(lines.join('\n'));
} finally { await browser.close(); server.close(); }
