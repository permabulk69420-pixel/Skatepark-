import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { acceleratedRaycast, computeBoundsTree } from '../vendor/mesh-bvh.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';

const status = document.querySelector('#status');
const progress = document.querySelector('#progress');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(new THREE.Color('#b8c6c5'), 130, 290);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1);
renderer.xr.setFoveation(0.5);
document.body.prepend(renderer.domElement);

const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 280);
camera.position.y = 1.65;
camera.rotation.order = 'YXZ';
rig.add(camera);
const spawn = new THREE.Vector3(0, 0.045, 40);

const sky = new Sky();
sky.scale.setScalar(1500);
const skyUniforms = sky.material.uniforms;
skyUniforms.turbidity.value = 3.3;
skyUniforms.rayleigh.value = 1.15;
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
scene.environmentIntensity = 0.38;
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xc0d7ed, 0x786951, 0.72));
const sun = new THREE.DirectionalLight(0xffe6c4, 3.0);
sun.position.copy(sunDirection).multiplyScalar(110);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -85, right: 85, top: 85, bottom: -85, near: 0.5, far: 245 });
sun.shadow.normalBias = 0.035;
sun.shadow.bias = -0.00006;
scene.add(sun, sun.target);

// Minimal original controller silhouettes stay attached to tracked grips.
for (let i = 0; i < 2; i++) {
  const grip = renderer.xr.getControllerGrip(i);
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.082, 5, 10), new THREE.MeshStandardMaterial({ color: 0x364b4e, roughness: 0.68 }));
  handle.rotation.x = 0.25;
  handle.position.y = -0.025;
  grip.add(handle);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.004, 6, 20), new THREE.MeshStandardMaterial({ color: 0xbcc6c5, metalness: 0.4, roughness: 0.5 }));
  ring.rotation.x = -0.75;
  ring.position.set(0, 0.042, -0.025);
  grip.add(ring);
  rig.add(grip);
}

const collision = [];
const grindPaths = [];
const renderMeshes = [];
let ready = false;
let park;
let verticalVelocity = 0;
let wasFlying = false;
const floorRay = new THREE.Raycaster();
floorRay.firstHitOnly = true;
floorRay.ray.direction.set(0, -1, 0);
floorRay.far = 15;
const floorNormal = new THREE.Vector3();
const headPosition = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const headBeforeTurn = new THREE.Vector3();
const headAfterTurn = new THREE.Vector3();
const clock = new THREE.Clock();
const keys = new Set();
let pitch = 0;
let yaw = 0;

function reset() {
  rig.position.copy(spawn);
  rig.rotation.set(0, 0, 0);
  verticalVelocity = 0;
  pitch = yaw = 0;
  if (!renderer.xr.isPresenting) {
    camera.position.set(0, 1.65, 0);
    camera.rotation.set(0, 0, 0, 'YXZ');
  }
}
reset();
document.querySelector('#reset').addEventListener('click', reset);

function floorAt(x, z, fromY) {
  floorRay.ray.origin.set(x, fromY + 6, z);
  const hits = floorRay.intersectObjects(collision, false);
  if (!hits.length) return { y: -0.025, slope: 1 };
  const hit = hits[0];
  floorNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  return { y: hit.point.y, slope: floorNormal.y };
}

function deadzone(v) { return Math.abs(v) > 0.15 ? (Math.abs(v) - 0.15) / 0.85 * Math.sign(v) : 0; }

function explore(dt) {
  let lateral = 0, longitudinal = 0, turn = 0, climb = 0;
  let flying = false, speed = 3.7;
  if (renderer.xr.isPresenting) {
    rig.updateMatrixWorld(true);
    renderer.xr.updateCamera(camera);
    const session = renderer.xr.getSession();
    for (const source of session.inputSources) {
      if (!source.gamepad) continue;
      const { axes, buttons } = source.gamepad;
      const a = axes.length >= 4 ? 2 : 0;
      if (source.handedness === 'left') {
        lateral = deadzone(axes[a] || 0);
        longitudinal = deadzone(axes[a + 1] || 0);
        if (buttons[3]?.pressed) speed = 7;
      } else if (source.handedness === 'right') {
        turn = deadzone(axes[a] || 0);
        flying = !!buttons[1]?.pressed;
        if (flying) climb = -deadzone(axes[a + 1] || 0);
      }
    }
    if (turn) {
      camera.getWorldPosition(headBeforeTurn);
      rig.rotation.y -= turn * 1.85 * dt;
      rig.updateMatrixWorld(true);
      camera.getWorldPosition(headAfterTurn);
      rig.position.x += headBeforeTurn.x - headAfterTurn.x;
      rig.position.z += headBeforeTurn.z - headAfterTurn.z;
      rig.updateMatrixWorld(true);
    }
  } else {
    lateral = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    longitudinal = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
    climb = Number(keys.has('KeyE')) - Number(keys.has('KeyQ'));
    flying = climb !== 0;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed = 8;
  }
  const head = camera;
  head.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
  move.copy(right).multiplyScalar(lateral).addScaledVector(forward, -longitudinal);
  if (move.lengthSq() > 1) move.normalize();
  move.multiplyScalar(speed * dt);
  head.getWorldPosition(headPosition);
  const currentFloor = rig.position.y;
  const nextX = THREE.MathUtils.clamp(headPosition.x + move.x, -54.8, 54.8);
  const nextZ = THREE.MathUtils.clamp(headPosition.z + move.z, -46.5, 46.5);
  const nextFloor = floorAt(nextX, nextZ, currentFloor);
  const rise = nextFloor.y - currentFloor;
  if (flying || (rise < 0.30 && (nextFloor.slope > 0.48 || rise < -0.04))) {
    rig.position.x += nextX - headPosition.x;
    rig.position.z += nextZ - headPosition.z;
  }
  if (flying) {
    rig.position.y = THREE.MathUtils.clamp(rig.position.y + climb * 4 * dt, -4.2, 30);
    verticalVelocity = 0;
  } else {
    head.getWorldPosition(headPosition);
    const ground = floorAt(headPosition.x, headPosition.z, rig.position.y);
    if (ground.y - rig.position.y < 0.31 || wasFlying) {
      if (rig.position.y > ground.y + 0.03) {
        verticalVelocity -= 9.8 * dt;
        rig.position.y = Math.max(ground.y + 0.025, rig.position.y + verticalVelocity * dt);
      } else { rig.position.y = ground.y + 0.025; verticalVelocity = 0; }
    }
  }
  wasFlying = flying;
}

const manager = new THREE.LoadingManager();
const loader = new GLTFLoader(manager);
loader.setMeshoptDecoder(MeshoptDecoder);
try {
  const gltf = await loader.loadAsync('./assets/skatepark.glb', event => {
    if (event.total) {
      const percent = Math.round(event.loaded / event.total * 100);
      progress.style.width = `${percent}%`;
      status.textContent = percent < 100 ? `Loading the park… ${percent}%` : 'Preparing materials…';
    }
  });
  park = gltf.scene;
  scene.add(park);
  park.updateMatrixWorld(true);
  park.traverse(object => {
    if (object.userData.role === 'grind_path') grindPaths.push(object);
    if (!object.isMesh) return;
    if (object.userData.role === 'collision' || object.name.startsWith('COL_')) {
      collision.push(object);
      object.visible = false;
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      if (object.geometry.index?.count > 900) {
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
  if (spawnNode) { spawnNode.getWorldPosition(spawn); reset(); }
  renderer.shadowMap.needsUpdate = true;
  await renderer.compileAsync(scene, camera);
  ready = true;
  progress.style.width = '100%';
  document.querySelector('.progress').style.display = 'none';
  status.textContent = 'Park ready';
  const button = VRButton.createButton(renderer, { optionalFeatures: ['local-floor'] });
  document.body.append(button);
  if (!navigator.xr) document.querySelector('#controls').innerHTML = 'Drag to look · WASD move · Shift faster · Q/E fly';
} catch (error) {
  status.textContent = 'The park could not load.';
  document.querySelector('#controls').textContent = error.message;
  console.error('Skate Park loading failed', error);
}

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-vr');
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  const session = renderer.xr.getSession();
  if (session.supportedFrameRates?.includes(72) && session.updateTargetFrameRate) session.updateTargetFrameRate(72).catch(() => {});
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  camera.position.set(0, 1.65, 0);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
});

let dragging = false, previousX = 0, previousY = 0;
renderer.domElement.addEventListener('pointerdown', event => {
  dragging = true; previousX = event.clientX; previousY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointerup', () => dragging = false);
renderer.domElement.addEventListener('pointercancel', () => dragging = false);
renderer.domElement.addEventListener('pointermove', event => {
  if (!dragging || renderer.xr.isPresenting) return;
  yaw -= (event.clientX - previousX) * 0.003;
  pitch = THREE.MathUtils.clamp(pitch - (event.clientY - previousY) * 0.003, -1.45, 1.45);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  previousX = event.clientX; previousY = event.clientY;
});
addEventListener('keydown', event => { keys.add(event.code); if (['Space','ArrowUp','ArrowDown'].includes(event.code)) event.preventDefault(); });
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => keys.clear());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.035);
  if (ready) explore(dt);
  renderer.render(scene, camera);
});

// Read-only scene access supports inspection and later skateboard integration.
export { scene, renderer, camera, rig, collision, grindPaths, renderMeshes, park, floorAt, reset };
