// Drives the real skater on a level's real collision in headless Chromium:  node tools/check-level.mjs [levelId]
//   1. every spawn point settles onto the ground and the board can roll away from it
//   2. a grid of ground points all hold a board (nothing falls through, nothing starts inside a wall)
//   3. every grind path catches a board that is dropped onto it, travelling along it
import { serveDist, openPage } from './browser.mjs';

const levelId = process.argv[2] || 'foundry';
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`);
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  const report = await page.evaluate(async () => {
    const { sim, scene, renderer } = window.__skate;
    renderer.setAnimationLoop(null);
    sim.requireGrind = false;      // the check drops boards onto rails with no one holding the grind button
    const THREE = await import('three');
    const world = sim.world;
    const frame = 1 / 72;
    const step = (cmd, seconds, probe) => { for (let i = 0; i < Math.round(seconds / frame); i++) { sim.update(cmd, frame); probe?.(i * frame); } };
    const out = {};
    const result = { spawns: [], grid: { total: 0, failed: [] }, grinds: { byKind: {}, failed: [] } };

    // 1. spawns
    const spawnNodes = [];
    scene.traverse((o) => { if (o.userData.role === 'spawn') spawnNodes.push(o); });
    for (const node of spawnNodes) {
      const p = node.getWorldPosition(new THREE.Vector3());
      const heading = node.userData.heading_radians ?? 0;
      sim.respawn({ pos: p, heading });
      step({}, 1.5);
      const settled = { name: node.name, mode: sim.mode, dy: +(sim.pos.y - (world.ground(sim.pos.x, sim.pos.z, sim.pos.y + 1, out)?.y ?? NaN)).toFixed(3) };
      const start = sim.pos.clone();
      step({ drive: 1 }, 6);
      settled.rolled = +sim.pos.distanceTo(start).toFixed(1);
      settled.speed = +sim.speed.toFixed(1);
      settled.modeAfter = sim.mode;
      result.spawns.push(settled);
    }

    // 2. ground grid
    for (let x = -96; x <= 110; x += 4) for (let z = -86; z <= 70; z += 4) {
      const g = world.ground(x, z, 30, out);
      if (!g || g.ny < 0.9) continue;
      result.grid.total++;
      sim.respawn({ pos: new THREE.Vector3(x, g.y, z), heading: 0 });
      step({}, 0.8);
      const under = world.ground(sim.pos.x, sim.pos.z, sim.pos.y + 1, out);
      const bad = sim.mode === 'bail' || !under || Math.abs(sim.pos.y - under.y) > 0.15 || sim.pos.y < g.y - 0.3;
      if (bad) result.grid.failed.push({ x, z, mode: sim.mode, y: +sim.pos.y.toFixed(2), ground: +g.y.toFixed(2) });
    }

    // 3. grinds: drop a board onto each path, travelling along it, from either end (stair rails are caught coming down)
    const paths = sim.paths;
    const tryFrom = (path, reverse) => {
      const seg = reverse ? path.segments[path.segments.length - 1] : path.segments[0];
      const dir = (reverse ? seg.dir.clone().negate() : seg.dir.clone());
      const dirH = new THREE.Vector3(dir.x, 0, dir.z);
      if (dirH.length() < 0.3) return 'vertical';
      dirH.normalize();
      const anchor = reverse ? seg.b : seg.a;
      const along = reverse ? 0.5 : 0.7;
      const start = anchor.clone().addScaledVector(dir, reverse ? 0.2 : 0.7).addScaledVector(dir, -(along)).addScaledVector(dirH, reverse ? 0 : 0).add(new THREE.Vector3(0, path.topOffset + 0.14, 0));
      if (reverse) start.copy(anchor).addScaledVector(dirH, 0.9).add(new THREE.Vector3(0, path.topOffset + 0.2, 0));
      sim.respawn({ pos: start, heading: Math.atan2(-dirH.x, -dirH.z) });
      sim.pos.copy(start);
      sim.mode = 'air';
      sim.vel.copy(dirH).multiplyScalar(4.5);
      let caught = false;
      step({}, 1.0, () => { if (sim.mode === 'grind') caught = true; });
      return caught ? 'ok' : sim.mode;
    };
    for (const path of paths) {
      const entry = (result.grinds.byKind[path.kind] ??= { ok: 0, total: 0 });
      entry.total++;
      const forward = tryFrom(path, false);
      const reverse = forward === 'ok' ? 'ok' : tryFrom(path, true);
      if (forward === 'ok' || reverse === 'ok') entry.ok++;
      else result.grinds.failed.push({ name: path.name, kind: path.kind, forward, reverse });
    }
    result.grinds.count = paths.length;
    return result;
  });
  console.log(JSON.stringify(report, null, 1));
} finally { await browser.close(); server.close(); }
