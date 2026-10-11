import * as THREE from 'three';
import { BOARD, RIDER, TUNING as T } from './config.js';
import { Mode } from './sim.js';

const { clamp } = THREE.MathUtils;
const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);
const UP = new THREE.Vector3(0, 1, 0);
const _qYaw = new THREE.Quaternion(), _qLean = new THREE.Quaternion(), _axis = new THREE.Vector3(), _tilt = new THREE.Vector3();
const _pivot = new THREE.Vector3(), _origin = new THREE.Vector3(), _H = new THREE.Vector3();

// Puts the player on the board. In VR the headset keeps its real position over the board and the whole play space
// (rig) is turned so the player faces the way they would standing on the deck: side-on to travel, never forward.
export class Rider {
  constructor({ rig, camera, renderer, sim }) {
    this.rig = rig;
    this.camera = camera;
    this.renderer = renderer;
    this.sim = sim;
    this.anchor = new THREE.Vector2();   // where the head was, in play-space metres, when you "stood on the board"
    this.yawCal = 0;                      // which way the head faced then, relative to the play space
    this.rigYaw = 0;
    this.calibrated = false;
    this.settleFrames = 0;
    this.fade = 0;
    this.leanAmount = 0;
    this.fadeMesh = this.makeFade();
    camera.add(this.fadeMesh);
  }

  makeFade() {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
    );
    mesh.position.z = -0.12;
    mesh.renderOrder = 9999;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  get presenting() { return this.renderer.xr.isPresenting; }

  // Call when a session starts, or any time the player wants the board re-centred under them.
  requestCalibration() { this.calibrated = false; this.settleFrames = 0; }

  calibrate() {
    this.anchor.set(this.camera.position.x, this.camera.position.z);
    this.yawCal = this.camera.rotation.y;
    this.calibrated = true;
    this.snapYaw = true;
  }

  update(dt) {
    const sim = this.sim;
    const vr = this.presenting;
    if (vr) {
      this.rig.updateMatrixWorld(true);
      this.renderer.xr.updateCamera(this.camera);
      if (!this.calibrated) {
        // Give tracking a moment to settle before reading where the head is.
        this.settleFrames++;
        if (this.settleFrames > 24 && this.camera.position.y > 0.4) this.calibrate();
      }
    } else if (!this.calibrated) {
      this.anchor.set(0, 0);
      this.yawCal = 0;
      this.calibrated = true;
      this.snapYaw = true;
    }

    // Facing: side-on in VR, down the board on a flat screen.
    const targetYaw = sim.heading + (vr ? sim.faceOffset : 0) - this.yawCal;
    if (this.snapYaw) { this.rigYaw = targetYaw; this.snapYaw = false; }
    const diff = wrap(targetYaw - this.rigYaw);
    this.rigYaw = wrap(this.rigYaw + diff * (1 - Math.exp(-RIDER.rigYawResponse * dt)));

    // Height of the player's feet.
    let drop = sim.crouch;
    let bailEase = 0;
    if (sim.mode === Mode.BAIL) bailEase = clamp(sim.bailTime / 0.35, 0, 1);
    drop += T.bailFallDrop * bailEase * bailEase * (3 - 2 * bailEase);
    const feetY = sim.pos.y + BOARD.deckTop - drop;
    const eye = vr ? 0 : RIDER.eyeHeightDesktop;

    // Lean: the board's grind tilt (and a hint of carving) carried up into the rider.
    let leanAngle = 0;
    _tilt.set(0, 0, 0);
    if (sim.mode === Mode.GRIND && sim.grind?.tilt) {
      leanAngle = sim.grind.bal * RIDER.maxRigLean;
      _tilt.copy(sim.grind.tilt);
    } else if (sim.mode === Mode.GROUND) {
      leanAngle = sim.carve * 0.045;
      _H.set(-Math.sin(sim.heading), 0, -Math.cos(sim.heading));
      _tilt.crossVectors(_H, UP); // board right
    }
    this.leanAmount += (leanAngle - this.leanAmount) * (1 - Math.exp(-14 * dt));

    // Rig origin so the anchor point sits over the board centre.
    const cos = Math.cos(this.rigYaw), sin = Math.sin(this.rigYaw);
    _origin.set(sim.pos.x - (cos * this.anchor.x + sin * this.anchor.y), feetY, sim.pos.z - (-sin * this.anchor.x + cos * this.anchor.y));
    _qYaw.setFromAxisAngle(UP, this.rigYaw);
    if (Math.abs(this.leanAmount) > 1e-4 && _tilt.lengthSq() > 0) {
      _axis.crossVectors(UP, _tilt).normalize();
      _qLean.setFromAxisAngle(_axis, this.leanAmount);
      _pivot.set(sim.pos.x, sim.pos.y + BOARD.deckTop - drop, sim.pos.z);
      this.rig.position.copy(_origin).sub(_pivot).applyQuaternion(_qLean).add(_pivot);
      this.rig.quaternion.copy(_qLean).multiply(_qYaw);
    } else {
      this.rig.position.copy(_origin);
      this.rig.quaternion.copy(_qYaw);
    }
    if (!vr) this.camera.position.set(0, eye, 0);
    this.rig.updateMatrixWorld(true);

    // Fade to black while a bail plays out, then back in at the respawn.
    const fadeTarget = sim.mode === Mode.BAIL && sim.bailTime > 0.5 ? 1 : 0;
    this.fade += (fadeTarget - this.fade) * (1 - Math.exp(-(fadeTarget ? 6 : 5) * dt));
    this.fadeMesh.visible = this.fade > 0.01;
    this.fadeMesh.material.opacity = this.fade;
  }
}
