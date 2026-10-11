import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// The skinned hands from Oasis/Sandboarding (Open, Grip, Point, Pinch and Fist poses as animation clips).
// Skateboarding needs no held objects, so this is just the rigs following the controllers and closing with grip and trigger.
const bust = window.__skateparkCacheKey ? `?fresh=${encodeURIComponent(window.__skateparkCacheKey)}` : '';
const ASSETS = Object.freeze({ left: `./models/hands/LeftHand.glb${bust}`, right: `./models/hands/RightHand.glb${bust}` });
// The meshes are authored with fingers along -Z and palms along -Y; these are the mirrored grip-space offsets.
const GRIP_ROTATION = Object.freeze({ left: Math.PI / 2, right: -Math.PI / 2 });
const loader = new GLTFLoader();

function createActions(root, clips) {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    action.weight = 0;
    actions.set(clip.name, action);
  }
  return { mixer, actions, current: null };
}

function setPose(state, name, amount) {
  const action = state.actions.get(name);
  if (!action) return;
  if (state.current && state.current !== action) state.current.weight = 0;
  state.current = action;
  action.weight = 1;
  action.time = THREE.MathUtils.clamp(amount, 0, 1);
}

export function createVRHands({ renderer, parent, onError = console.warn }) {
  const models = { left: null, right: null };
  const states = [0, 1].map((index) => {
    const controller = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);
    parent.add(controller, grip);
    return { controller, grip, inputSource: null, handedness: '', anchor: null, mixer: null };
  });
  let visible = true;

  function detach(state) {
    if (state.anchor) state.grip.remove(state.anchor);
    state.anchor = null;
    state.mixer = null;
  }

  function attach(state) {
    const gltf = models[state.handedness];
    if (!gltf) return;
    detach(state);
    const root = clone(gltf.scene);
    root.name = `${state.handedness}-vr-hand`;
    root.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      child.frustumCulled = false; // skinned bounds do not follow the pose
    });
    const anchor = new THREE.Group();
    anchor.name = `${state.handedness}-hand-grip-offset`;
    anchor.rotation.set(0, 0, GRIP_ROTATION[state.handedness]);
    anchor.visible = visible;
    anchor.add(root);
    state.grip.add(anchor);
    state.anchor = anchor;
    state.mixer = createActions(root, gltf.animations);
    setPose(state.mixer, 'Open', 0);
  }

  for (const state of states) {
    state.controller.addEventListener('connected', (event) => {
      state.inputSource = event.data;
      state.handedness = event.data.handedness === 'left' || event.data.handedness === 'right' ? event.data.handedness : '';
      attach(state);
    });
    state.controller.addEventListener('disconnected', () => {
      state.inputSource = null;
      state.handedness = '';
      detach(state);
    });
  }

  Promise.allSettled([loader.loadAsync(ASSETS.left), loader.loadAsync(ASSETS.right)]).then(([left, right]) => {
    if (left.status === 'fulfilled') models.left = left.value; else onError(`Left hand failed to load: ${left.reason?.message || left.reason}`);
    if (right.status === 'fulfilled') models.right = right.value; else onError(`Right hand failed to load: ${right.reason?.message || right.reason}`);
    for (const state of states) attach(state);
  });

  function update(dt) {
    for (const state of states) {
      if (!state.mixer) continue;
      const buttons = state.inputSource?.gamepad?.buttons || [];
      const trigger = buttons[0]?.value ?? 0;
      const squeeze = buttons[1]?.value ?? 0;
      if (squeeze > 0.08 && trigger > 0.08) setPose(state.mixer, 'Fist', Math.max(trigger, squeeze));
      else if (squeeze > 0.08) setPose(state.mixer, 'Grip', squeeze);
      else if (trigger > 0.08) setPose(state.mixer, 'Pinch', trigger);
      else setPose(state.mixer, 'Open', 0);
      state.mixer.mixer.update(dt);
    }
  }

  return {
    update,
    states,
    setVisible(value) {
      visible = !!value;
      for (const state of states) if (state.anchor) state.anchor.visible = visible;
    }
  };
}
