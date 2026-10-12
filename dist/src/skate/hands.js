import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { getHeldGripPose } from './grip-poses.js';
import { createAdaptiveGrip } from './adaptive-grip.js';

// The skinned hands from Oasis/Sandboarding (Open, Grip, Point, Pinch and Fist poses as animation clips), with the same
// adaptive grip: a hand that holds something (here, the board in a grab) is posed so its fingers close round it instead of through it.
// Each hand has an `objectGrip` anchor in the hand's grip socket; whatever is parented there is what the hand holds (src/skate/handle-hold.js).
const assetUrl = window.__skateparkUrl || ((file) => `./${file}?t=${Date.now()}`);
const ASSETS = Object.freeze({ left: assetUrl('models/hands/LeftHand.glb'), right: assetUrl('models/hands/RightHand.glb') });
// The meshes are authored with fingers along -Z and palms along -Y; these are the mirrored grip-space offsets.
const GRIP_ROTATION = Object.freeze({ left: Math.PI / 2, right: -Math.PI / 2 });
const loader = new GLTFLoader();
const gripMatrix = new THREE.Matrix4();

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
    const objectGrip = new THREE.Group();
    objectGrip.name = `controller-${index}-held-object-anchor`;
    grip.add(objectGrip);
    return {
      controller, grip, objectGrip, inputSource: null, handedness: '',
      handAnchor: null, handRoot: null, gripSocket: null, mixerState: null, adaptiveGrip: null, heldGripProfile: null
    };
  });
  let visible = true;

  function resetObjectGrip(state) {
    state.grip.add(state.objectGrip);
    state.objectGrip.position.set(0, 0, 0);
    state.objectGrip.quaternion.identity();
    state.objectGrip.scale.set(1, 1, 1);
  }

  // Keeps the held-object anchor on the hand's grip socket, in the controller's own space.
  function syncObjectGrip(state) {
    if (!state.gripSocket) return;
    if (state.objectGrip.parent !== state.grip) state.grip.add(state.objectGrip);
    state.grip.updateWorldMatrix(true, false);
    state.gripSocket.updateWorldMatrix(true, false);
    gripMatrix
      .copy(state.grip.matrixWorld)
      .invert()
      .multiply(state.gripSocket.matrixWorld)
      .decompose(state.objectGrip.position, state.objectGrip.quaternion, state.objectGrip.scale);
    state.objectGrip.updateMatrixWorld(true);
  }

  function detach(state) {
    state.adaptiveGrip?.dispose();
    state.adaptiveGrip = null;
    resetObjectGrip(state);
    state.heldGripProfile = null;
    if (state.handAnchor) state.grip.remove(state.handAnchor);
    state.handAnchor = null;
    state.handRoot = null;
    state.gripSocket = null;
    state.mixerState = null;
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

    const socketName = `b_${state.handedness === 'left' ? 'l' : 'r'}_grip`;
    const gripSocket = root.getObjectByName(socketName);
    if (!gripSocket) onError(`Missing ${socketName}; the hand cannot hold the board.`);
    state.handAnchor = anchor;
    state.handRoot = root;
    state.gripSocket = gripSocket || null;
    state.mixerState = createActions(root, gltf.animations);
    state.adaptiveGrip = createAdaptiveGrip({ root, clips: gltf.animations, objectGrip: state.objectGrip, handedness: state.handedness });
    setPose(state.mixerState, 'Open', 0);
    syncObjectGrip(state);
  }

  for (const state of states) {
    state.controller.addEventListener('connected', (event) => {
      state.inputSource = event.data;
      state.handedness = event.data.handedness === 'left' || event.data.handedness === 'right' ? event.data.handedness : '';
      state.objectGrip.name = `${state.handedness || 'unknown'}-held-object-anchor`;
      attach(state);
    });
    state.controller.addEventListener('disconnected', () => {
      state.inputSource = null;
      state.handedness = '';
      state.heldGripProfile = null;
      detach(state);
    });
  }

  Promise.allSettled([loader.loadAsync(ASSETS.left), loader.loadAsync(ASSETS.right)]).then(([left, right]) => {
    if (left.status === 'fulfilled') models.left = left.value; else onError(`Left hand failed to load: ${left.reason?.message || left.reason}`);
    if (right.status === 'fulfilled') models.right = right.value; else onError(`Right hand failed to load: ${right.reason?.message || right.reason}`);
    for (const state of states) attach(state);
  });

  function updatePose(state, dt) {
    if (!state.mixerState) return;
    const buttons = state.inputSource?.gamepad?.buttons || [];
    const trigger = buttons[0]?.value ?? 0;
    const squeeze = buttons[1]?.value ?? 0;
    const heldPose = getHeldGripPose(state);
    // A hand that holds something (a board grab) takes the authored pose for that grip; the adaptive grip then fits each finger to it.
    if (heldPose && squeeze > 0.08) setPose(state.mixerState, heldPose.animation, heldPose.amount);
    else if (squeeze > 0.08 && trigger > 0.08) setPose(state.mixerState, 'Fist', Math.max(trigger, squeeze));
    else if (squeeze > 0.08) setPose(state.mixerState, 'Grip', squeeze);
    else if (trigger > 0.08) setPose(state.mixerState, 'Pinch', trigger);
    else setPose(state.mixerState, 'Open', 0);
    state.mixerState.mixer.update(dt);
    state.adaptiveGrip?.update(state.objectGrip.children[0] || null, dt);
  }

  function update(dt) {
    for (const state of states) syncObjectGrip(state);
    for (const state of states) updatePose(state, dt);
  }

  // Positions of the two grips in play space (null for one that is not connected), for hand balancing.
  function gripPositions() {
    const out = { left: null, right: null };
    for (const state of states) if (state.handedness && state.inputSource) out[state.handedness] = state.grip.position;
    return out;
  }

  return {
    update,
    gripPositions,
    states,
    setVisible(value) {
      visible = !!value;
      for (const state of states) if (state.handAnchor) state.handAnchor.visible = visible;
    }
  };
}
