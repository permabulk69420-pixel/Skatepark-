import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { acceleratedRaycast, computeBoundsTree } from '../vendor/mesh-bvh.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';
import { SkateWorld } from './skate/world.js';
import { parseGrindPaths } from './skate/rails.js';
import { Skater, Mode } from './skate/sim.js';
import { createInput } from './skate/input.js';
import { createHaptics } from './skate/haptics.js';
import { createVRHands } from './skate/hands.js';
import { BoardView } from './skate/board-view.js';
import { Rider } from './skate/rider.js';
import { createHud } from './skate/hud.js';

const status = document.querySelector('#status');
const progress = document.querySelector('#progress');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(new THREE.Color('#b8c6c5'), 130, 290);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
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
const sunDirection = new THREE.Vector3(-0.40, 0.73, -0.56).normalize();
skyUniforms.sunPosition.value.copy(sunDirection);
scene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
skyScene.add(sky.clone());
const skyEnvironment = pmrem.fromScene(skyScene, 0.035, 0.1, 1800);
scene.environment = skyEnvironment.texture;
scene.environmentIntensity = 0.25;
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xc0d7ed, 0x786951, 0.48));
const sun = new THREE.DirectionalLight(0xffe6c4, 2.1);
sun.position.copy(sunDirection).multiplyScalar(110);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -85, right: 85, top: 85, bottom: -85, near: 0.5, far: 245 });
sun.shadow.normalBias = 0.035;
sun.shadow.bias = -0.00006;
scene.add(sun, sun.target);

const collision = [];
const grindNodes = [];
const renderMeshes = [];
let park, ready = false;
const spawn = new THREE.Vector3(0, 0.045, 40);
const clock = new THREE.Clock();

const haptics = createHaptics(renderer);
const input = createInput(renderer);
const hands = createVRHands({ renderer, parent: rig });

// The skater is created once the park's collision is loaded; events from it drive haptics and messages.
let sim, rider, boardView, hud;
const feel = (type, data = {}) => {
  switch (type) {
    case 'crouch': haptics.pulse(0.22, 18); break;
    case 'pop': haptics.pulse(0.5 + 0.35 * data.charge, 34); break;
    case 'push': haptics.pulse(0.3, 28); break;
    case 'pump': haptics.pulse(THREE.MathUtils.clamp(0.25 + data.gain * 0.6, 0.25, 0.7), 40); break;
    case 'land': if (data.impact < 0.9) break; haptics.pulse(THREE.MathUtils.clamp(0.2 + data.impact * 0.09, 0.2, 1), Math.min(120, 30 + data.impact * 7)); break;
    case 'wall': haptics.pulse(THREE.MathUtils.clamp(0.3 + data.impact * 0.14, 0.3, 1), 70); break;
    case 'grindStart': haptics.pulse(0.85, 32); break;
    case 'grindEnd': if (data.reason !== 'bail' && data.time > 0.3) hud?.say(`${data.name}  ${data.time.toFixed(1)}s`); break;
    case 'bail': haptics.pulse(1, 240); hud?.say('BAIL', 1.2); break;
    default: break;
  }
};

function continuousFeedback() {
  if (sim.mode === Mode.GROUND) {
    if (sim.braking) haptics.rumble(0.3, 'both', 40);
    else if (sim.speed > 0.4) haptics.rumble(0.03 + 0.06 * Math.min(sim.speed / 10, 1), 'both', 60);
  } else if (sim.mode === Mode.GRIND && sim.grind) {
    // The closer to falling off, the harder the rail shakes the board.
    haptics.rumble(0.28 + 0.5 * sim.grind.bal * sim.grind.bal, 'both', 35);
  }
}

const manager = new THREE.LoadingManager();
const loader = new GLTFLoader(manager);
loader.setMeshoptDecoder(MeshoptDecoder);
const bust = encodeURIComponent(window.__skateparkCacheKey || Date.now());
try {
  const [gltf, boardGltf] = await Promise.all([
    loader.loadAsync(`./assets/skatepark.glb?fresh=${bust}`, (event) => {
      if (event.total) {
        const percent = Math.round(event.loaded / event.total * 100);
        progress.style.width = `${percent}%`;
        status.textContent = percent < 100 ? `Loading the park… ${percent}%` : 'Preparing materials…';
      }
    }),
    loader.loadAsync(`./assets/skateboard.glb?fresh=${bust}`)
  ]);
  park = gltf.scene;
  scene.add(park);
  park.updateMatrixWorld(true);
  park.traverse((object) => {
    if (object.userData.role === 'grind_path') grindNodes.push(object);
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
    object.castShadow = !object.name.includes('Landscape') && !object.name.includes('Asphalt');
    object.receiveShadow = true;
    object.frustumCulled = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material.isMeshStandardMaterial) continue;
      for (const map of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
        if (map) map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      }
    }
  });
  const spawnNode = park.getObjectByName('Spawn_Entrance');
  if (spawnNode) spawnNode.getWorldPosition(spawn);

  const world = new SkateWorld(collision);
  const paths = parseGrindPaths(grindNodes);
  sim = new Skater({ world, paths, onEvent: (type, data) => feel(type, data) });
  sim.setSpawn(spawn, 0);
  rider = new Rider({ rig, camera, renderer, sim });
  boardView = new BoardView(scene, boardGltf.scene);
  hud = createHud({ rig, rider, sim });
  boardGltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    for (const m of [].concat(node.material)) for (const map of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) if (map) map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  });

  renderer.shadowMap.needsUpdate = true;
  await renderer.compileAsync(scene, camera);
  ready = true;
  progress.style.width = '100%';
  document.querySelector('.progress').style.display = 'none';
  status.textContent = `Park ready · ${paths.length} grindable lines`;
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
  renderer.xr.setFoveation(0);
  const baseLayer = renderer.xr.getSession()?.renderState?.baseLayer;
  if (baseLayer && 'fixedFoveation' in baseLayer) baseLayer.fixedFoveation = 0;
  document.body.classList.add('in-vr');
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  rider?.requestCalibration();
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
  const command = input.poll(dt);
  command.bodyY = renderer.xr.isPresenting && rider.calibrated ? camera.position.y : undefined;
  if (command.toggleStance && sim.mode === Mode.GROUND && sim.speed < 2) {
    sim.faceOffset = -sim.faceOffset;
    hud.say(sim.faceOffset < 0 ? 'Regular' : 'Goofy', 1.0);
    haptics.pulse(0.3, 25);
  }
  if (command.recenter) { rider.requestCalibration(); haptics.pulse(0.4, 40); hud.say('Recentred', 1.0); }
  if (command.toSpawn) sim.respawn(sim.spawn);
  sim.update(command, dt);
  rider.update(dt);
  boardView.update(sim, dt);
  hands.update(dt);
  hud.update(dt);
  continuousFeedback();
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (ready) frame(dt);
  renderer.render(scene, camera);
});

// Handles for the console and the automated checks.
window.__skate = { get sim() { return sim; }, get rider() { return rider; }, get boardView() { return boardView; }, get hud() { return hud; }, input, haptics, scene, camera, rig, renderer, collision, grindNodes };
export { scene, renderer, camera, rig, collision, renderMeshes, park, spawn };
