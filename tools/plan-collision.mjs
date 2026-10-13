// Top-down plan of a level's collision only, coloured by height (blue low, red high, black = nothing to ride):
//   node tools/plan-collision.mjs <levelId> <out.png> [cx,cz,height]
import { serveDist, openPage } from './browser.mjs';

const [levelId = 'foundry', out = 'collision.png', view = ''] = process.argv.slice(2);
const [cx, cz, height] = (view || '7,-8,230').split(',').map(Number);
const { server, origin } = await serveDist();
const { browser, page } = await openPage(`${origin}/index.html?level=${levelId}`, { width: 1600, height: 1300 });
try {
  await page.waitForFunction(() => window.__skate?.sim && document.querySelector('#status')?.textContent.includes('ready'), null, { timeout: 240000 });
  await page.evaluate(async ({ cx, cz, height }) => {
    const THREE = await import('three');
    document.querySelector('.entry').style.display = 'none'; document.querySelector('#reset').style.display = 'none';
    const { renderer, scene, camera, collision } = window.__skate;
    renderer.setAnimationLoop(null);
    scene.fog = null; scene.background = new THREE.Color(0x000000);
    scene.traverse((o) => { if (o.isMesh) o.visible = false; });
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: 'varying float h; void main(){ vec4 w = modelMatrix * vec4(position,1.0); h = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'varying float h; void main(){ float t = clamp((h + 2.5) / 7.0, 0.0, 1.0); gl_FragColor = vec4(t, 0.3 + 0.5 * (1.0 - abs(t - 0.5) * 2.0), 1.0 - t, 1.0); }'
    });
    for (const mesh of collision) { mesh.material = material; mesh.visible = true; }
    scene.environment = null;
    for (const l of scene.children.filter((c) => c.isLight || c.isSky)) l.visible = false;
    renderer.toneMapping = THREE.NoToneMapping;
    camera.far = 1000; camera.fov = 50; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    camera.parent.position.set(cx, height, cz); camera.parent.rotation.set(-Math.PI / 2, 0, 0);
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); camera.parent.updateMatrixWorld(true);
    renderer.render(scene, camera);
  }, { cx, cz, height });
  await page.screenshot({ path: out });
} finally { await browser.close(); server.close(); }
