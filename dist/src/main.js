import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { acceleratedRaycast, computeBoundsTree } from '../vendor/mesh-bvh.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';
import { SkateWorld } from './skate/world.js';
import { parseGrindPaths } from './skate/rails.js';
import { parseLoopPaths } from './skate/loop.js';
import { Skater, Mode } from './skate/sim.js';
import { createInput } from './skate/input.js';
import { createHaptics } from './skate/haptics.js';
import { createVRHands } from './skate/hands.js';
import { BoardView } from './skate/board-view.js';
import { createBoardGrab } from './skate/board-grab.js';
import { createMusic, MUSIC } from './skate/music.js';
import { createSfx } from './skate/sfx.js';
import { Rider } from './skate/rider.js';
import { createHud } from './skate/hud.js';
import { HandBalance } from './skate/hand-balance.js';
import { LodSet } from './skate/lod.js';
import { LEVELS, pickLevel } from './skate/levels.js';

const levelId = pickLevel(location.search);
const level = LEVELS[levelId];
const status = document.querySelector('#status');
const progress = document.querySelector('#progress');
document.querySelector('#blurb').textContent = level.blurb;
document.querySelector('#level-name').textContent = level.name;
document.title = `Skate Park — ${level.name}`;
document.querySelector('#levels').innerHTML = Object.entries(LEVELS)
  .map(([id, entry]) => (id === levelId ? `<b>${entry.name}</b>` : `<a href="?level=${id}" style="color:#d9a779">${entry.name}</a>`))
  .join(' &nbsp;·&nbsp; ');
// Lighting: these defaults, unless the level sets its own (`look` in levels.js).
const lighting = {
  toneMapping: 'aces', exposure: 0.85, sun: 2.1, sunColor: '#ffe6c4', sunDirection: [-0.40, 0.73, -0.56], hemisphere: 0.48,
  environment: 0.25, fog: '#b8c6c5', ...level.look
};
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(new THREE.Color(lighting.fog), 130, 290);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }[lighting.toneMapping];
renderer.toneMappingExposure = lighting.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1);
renderer.xr.setFoveation(0);
document.body.prepend(renderer.domElement);

// The rig is the player's play space: the skater moves and turns it, the headset moves freely inside it.
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 280);
camera.position.y = 1.65;
camera.rotation.order = 'YXZ';
rig.add(camera);

const sky = new Sky();
sky.scale.setScalar(1500);
const skyUniforms = sky.material.uniforms;
skyUniforms.turbidity.value = 2.5;
skyUniforms.rayleigh.value = 2.0;
skyUniforms.mieCoefficient.value = 0.003;
skyUniforms.mieDirectionalG.value = 0.77;
const sunDirection = new THREE.Vector3(...lighting.sunDirection).normalize();
skyUniforms.sunPosition.value.copy(sunDirection);
scene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
skyScene.add(sky.clone());
const skyEnvironment = pmrem.fromScene(skyScene, 0.035, 0.1, 1800);
scene.environment = skyEnvironment.texture;
scene.environmentIntensity = lighting.environment;
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xc0d7ed, 0x786951, lighting.hemisphere));
const sun = new THREE.DirectionalLight(lighting.sunColor, lighting.sun);
const shadowCentre = new THREE.Vector3(level.center?.x ?? 0, 0, level.center?.z ?? 0);
sun.position.copy(sunDirection).multiplyScalar(110).add(shadowCentre);
sun.target.position.copy(shadowCentre);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -level.shadowHalf, right: level.shadowHalf, top: level.shadowHalf, bottom: -level.shadowHalf, near: 0.5, far: 245 });
sun.shadow.normalBias = 0.035;
sun.shadow.bias = -0.00006;
scene.add(sun, sun.target);

const collision = [];
const grindNodes = [];
const loopNodes = [];
const renderMeshes = [];
let park, lods, ready = false;
const spawn = new THREE.Vector3(0, 0.045, 40);
const clock = new THREE.Clock();
const lodEye = new THREE.Vector3();

const haptics = createHaptics(renderer);
const input = createInput(renderer);
const hands = createVRHands({ renderer, parent: rig });
const handBalance = new HandBalance();
// Soundtrack: loops through the three tracks; starts on the first click / key press / VR session (browsers need one before any sound).
const music = createMusic({ urls: MUSIC.tracks.map((name) => new URL(`assets/music/${name}.mp3`, location.href).href) });
for (const type of ['pointerdown', 'keydown', 'click']) addEventListener(type, () => { music.start(); sfx?.start(); }, { capture: true });

// The skater is created once the park's collision is loaded; events from it drive haptics and messages.
let sim, rider, boardView, hud, grab, sfx;
let detachWas = false;
const feel = (type, data = {}) => {
  sfx?.event(type, data);
  switch (type) {
    case 'crouch': haptics.pulse(0.22, 18); break;
    case 'pop': haptics.pulse(0.5 + 0.35 * data.charge, 34); break;
    case 'push': haptics.pulse(0.3, 28); break;
    case 'flipStart': haptics.pulse(0.3, 22); hud?.say(data.stick ? `${data.name}   stick ${data.stick.x.toFixed(2)}, ${data.stick.y.toFixed(2)}` : data.name, 1.6); break; // the stick readout is for tuning the diagonals
    case 'flip': haptics.pulse(0.6, 45); hud?.say(data.name, 1.1); break;
    case 'sketchy': haptics.pulse(0.55, 80); hud?.say('Sketchy', 0.9); break;
    case 'pump': haptics.pulse(THREE.MathUtils.clamp(0.25 + data.gain * 0.6, 0.25, 0.7), 40); break;
    case 'land': if (data.impact < 0.9) break; haptics.pulse(THREE.MathUtils.clamp(0.2 + data.impact * 0.09, 0.2, 1), Math.min(120, 30 + data.impact * 7)); break;
    case 'wall': haptics.pulse(THREE.MathUtils.clamp(0.3 + data.impact * 0.14, 0.3, 1), 70); break;
    case 'grindStart': haptics.pulse(0.85, 32); break;
    case 'manualStart': haptics.pulse(0.45, 28); break;
    case 'manualEnd': if (data.reason !== 'bail' && data.time > 0.5) hud?.say(`${data.name}  ${data.time.toFixed(1)}s`); break;
    case 'grindEnd': if (data.reason !== 'bail' && data.time > 0.3) hud?.say(`${data.name}  ${data.time.toFixed(1)}s`); break;
    case 'bail': haptics.pulse(1, 240); hud?.say('BAIL', 1.2); break;
    case 'loopStart': haptics.pulse(0.4, 30); break;
    case 'loopEnd': if (data.completed) { haptics.pulse(0.9, 90); hud?.say('LOOP!', 1.6); } break;
    case 'detach': hud?.say('Board off', 0.7); break;
    case 'catch': haptics.pulse(data.quality === 'clean' ? 0.7 : 0.5, 50); if (data.quality === 'sketchy') hud?.say('Sketchy catch', 0.8); break;
    case 'catchMiss': hud?.say('Missed it', 0.6); break;
    case 'dropBoard': hud?.say('Dropped it', 0.9); break;
    case 'grabEnd': if (data.time > 0.3) hud?.say(`${data.name}  ${data.time.toFixed(1)}s`); break;
    default: break;
  }
};

function continuousFeedback() {
  if (sim.mode === Mode.GROUND) {
    if (sim.manual) haptics.rumble(0.12 + 0.45 * sim.manual.bal * sim.manual.bal, 'both', 40);
    else if (sim.braking) haptics.rumble(0.3, 'both', 40);
    else if (sim.speed > 0.4) haptics.rumble(0.03 + 0.06 * Math.min(sim.speed / 10, 1), 'both', 60);
  } else if (sim.mode === Mode.LOOP && sim.loop) {
    // The track presses harder the faster you go round it.
    haptics.rumble(0.08 + 0.3 * Math.min(Math.abs(sim.loop.gs) / 12, 1), 'both', 40);
  } else if (sim.mode === Mode.GRIND && sim.grind) {
    // The closer to falling off, the harder the rail shakes the board.
    haptics.rumble(0.28 + 0.5 * sim.grind.bal * sim.grind.bal, 'both', 35);
  }
}

const manager = new THREE.LoadingManager();
const loader = new GLTFLoader(manager);
loader.setMeshoptDecoder(MeshoptDecoder);
const assetUrl = window.__skateparkUrl || ((file) => `./${file}?t=${Date.now()}`);
try {
  const [gltf, boardGltf] = await Promise.all([
    loader.loadAsync(assetUrl(level.file), (event) => {
      if (event.total) {
        const percent = Math.round(event.loaded / event.total * 100);
        progress.style.width = `${percent}%`;
        status.textContent = percent < 100 ? `Loading ${level.name}… ${percent}%` : 'Preparing materials…';
      }
    }),
    loader.loadAsync(assetUrl('assets/skateboard.glb'))
  ]);
  park = gltf.scene;
  scene.add(park);
  park.updateMatrixWorld(true);
  park.traverse((object) => {
    if (object.userData.role === 'grind_path') grindNodes.push(object);
    if (object.userData.role === 'loop_path') loopNodes.push(object);
    if (!object.isMesh) return;
    if (object.userData.role === 'collision' || object.name.startsWith('COL_')) {
      collision.push(object);
      object.visible = false;
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      if (object.geometry.index?.count > 900) {
        // Mirrored ramps share one index buffer, and building a BVH reorders its index in place, which silently broke
        // the earlier tree. Give every collider its own copy first.
        object.geometry.setIndex(new THREE.BufferAttribute(object.geometry.index.array.slice(), 1));
        computeBoundsTree.call(object.geometry, { maxLeafTris: 12 });
        object.raycast = acceleratedRaycast;
      }
      return;
    }
    renderMeshes.push(object);
    object.castShadow = !level.noShadow.test(object.name);
    object.receiveShadow = true;
    object.frustumCulled = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (level.decals?.test(material.name)) Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      if (level.doubleSided?.test(material.name)) material.side = THREE.DoubleSide;
      if (!material.isMeshStandardMaterial) continue;
      for (const map of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
        if (map) map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      }
    }
  });
  const spawnNode = park.getObjectByName('Spawn_Entrance');
  if (spawnNode) spawnNode.getWorldPosition(spawn);
  const spawnHeading = spawnNode?.userData.heading_radians ?? 0;
  lods = new LodSet(park);
  lods.update(spawn);

  const world = new SkateWorld(collision);
  const paths = parseGrindPaths(grindNodes);
  sfx = createSfx({ url: (name) => assetUrl(`assets/sfx/${name}.ogg`), world });
  if (music.started) sfx.start();   // the click that started the music came while the park was loading
  const loops = parseLoopPaths(loopNodes);
  sim = new Skater({ world, paths, loops, bounds: level.bounds, requireGrind: true, onEvent: (type, data) => feel(type, data) });
  sim.setSpawn(spawn, spawnHeading);
  rider = new Rider({ rig, camera, renderer, sim });
  boardView = new BoardView(scene, boardGltf.scene);
  hud = createHud({ rig, rider, sim });
  grab = createBoardGrab({ hands, boardMesh: boardView.root, onEvent: (type, data) => feel(type, data), desk: camera });
  boardGltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    for (const m of [].concat(node.material)) for (const map of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) if (map) map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  });

  renderer.shadowMap.needsUpdate = true;
  await renderer.compileAsync(scene, camera);
  ready = true;
  progress.style.width = '100%';
  document.querySelector('.progress').style.display = 'none';
  status.textContent = `${level.name} ready · ${paths.length} grindable lines${loops.length ? ` · ${loops.length} loop${loops.length > 1 ? 's' : ''}` : ''}`;
  const button = VRButton.createButton(renderer, { optionalFeatures: ['local-floor'] });
  document.body.append(button);
  if (!navigator.xr) document.querySelector('#controls').innerHTML = document.querySelector('#controls-desktop').innerHTML;
} catch (error) {
  status.textContent = 'The park could not load.';
  document.querySelector('#controls').textContent = error.message;
  console.error('Skate Park loading failed', error);
}

document.querySelector('#reset').addEventListener('click', () => sim?.respawn(sim.spawn));

renderer.xr.addEventListener('sessionstart', () => {
  music.start();
  sfx?.start();
  renderer.xr.setFoveation(0);
  const baseLayer = renderer.xr.getSession()?.renderState?.baseLayer;
  if (baseLayer && 'fixedFoveation' in baseLayer) baseLayer.fixedFoveation = 0;
  document.body.classList.add('in-vr');
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  rider?.requestCalibration();
  hud?.say(`Build ${window.__skateparkBuild || '?'}`, 5);
  const session = renderer.xr.getSession();
  if (session.supportedFrameRates?.includes(72) && session.updateTargetFrameRate) session.updateTargetFrameRate(72).catch(() => {});
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  camera.position.set(0, 1.65, 0);
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  rider?.requestCalibration();
});

// Flat-screen look-around (drag), for testing off the headset.
const look = { pitch: 0, yaw: 0 };
let dragging = false, previousX = 0, previousY = 0;
renderer.domElement.addEventListener('pointerdown', (event) => {
  dragging = true; previousX = event.clientX; previousY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('pointercancel', () => { dragging = false; });
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging || renderer.xr.isPresenting) return;
  look.yaw -= (event.clientX - previousX) * 0.003;
  look.pitch = THREE.MathUtils.clamp(look.pitch - (event.clientY - previousY) * 0.003, -1.45, 1.45);
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  previousX = event.clientX; previousY = event.clientY;
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function frame(dt) {
  // Grabs (board-grab.js): in the air, once any board flip has finished. Holding both grips must not re-centre you while you are up there.
  const airborne = sim.mode === Mode.AIR && (!sim.flip || sim.flip.progress >= 1);
  input.block.recenter = sim.mode === Mode.AIR || grab.holding();
  const command = input.poll(dt);
  command.bodyY = renderer.xr.isPresenting && rider.calibrated ? camera.position.y : undefined;
  command.grabbing = grab.holding();   // grabbing lets the stick flip you over (backflip / frontflip)
  if (renderer.xr.isPresenting) {
    // In VR the hands balance grinds and manuals: right hand up pushes the meter right, left hand up pushes it left. The neutral
    // hand position is only learned while rolling relaxed on the ground, not through a crouch, pop or flight.
    const grips = hands.gripPositions();
    const relaxed = sim.mode === Mode.GROUND && !sim.manual && sim.groundedTime > 0.4 && Math.abs(sim.crouch) < 0.06 && !command.jump;
    command.lean = handBalance.update(dt, grips.left, grips.right, { balancing: !!sim.balance, learn: relaxed });
  }
  if (command.toggleStance && sim.mode === Mode.GROUND && sim.speed < 2) {
    sim.faceOffset = -sim.faceOffset;
    hud.say(sim.goofy ? 'Goofy' : 'Regular', 1.0);
    haptics.pulse(0.3, 25);
  }
  if (command.recenter) { rider.requestCalibration(); haptics.pulse(0.4, 40); hud.say('Recentred', 1.0); }
  if (command.toSpawn) sim.respawn(sim.spawn);
  sim.update(command, dt);
  // Live stick readout for tuning the trick zones: hold the flip button on the ground and move the left stick.
  if (command.flip && sim.mode === Mode.GROUND) {
    const x = command.trickSteer, y = command.trickDrive;
    const z = sim.trickZone(x, y);
    hud.say(z.none && z.name === '-' ? 'stick: middle' : `${z.name}   ${Math.round(z.deg)}°   (${x.toFixed(2)}, ${y.toFixed(2)})`, 0.15);
  }
  rider.update(dt);
  lods.update(camera.getWorldPosition(lodEye));
  boardView.update(sim, dt);
  grab.update(dt, airborne);   // the board comes up to a squeezing hand (after the board is placed)...
  grab.hold(sim, dt);          // ...or, taken off your feet, is wherever your hand has it
  // Left trigger: squeeze it to take the board off your feet, let go to catch it (a miss leaves it in your hand: squeeze and let go again).
  if (command.detach && !detachWas && !grab.off) grab.toggleOff(sim, renderer.xr.isPresenting);
  if (!command.detach && detachWas && grab.off) grab.toggleOff(sim, renderer.xr.isPresenting);
  detachWas = command.detach;
  hands.update(dt);
  grab.place();                // ...then each holding hand is fitted onto its edge (after the hands have posed)
  hud.update(dt);
  sfx.update(sim, dt);
  continuousFeedback();
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (ready) frame(dt);
  renderer.render(scene, camera);
});

// Handles for the console and the automated checks.
window.__skate = { music, get sfx() { return sfx; }, hands, get grab() { return grab; }, handBalance, get sim() { return sim; }, get rider() { return rider; }, get boardView() { return boardView; }, get hud() { return hud; }, input, haptics, scene, camera, rig, renderer, collision, grindNodes, get lods() { return lods; }, level: levelId };
export { scene, renderer, camera, rig, collision, renderMeshes, park, spawn };
