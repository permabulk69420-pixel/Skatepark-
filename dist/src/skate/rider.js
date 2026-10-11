import * as THREE from 'three';
import { BOARD, RIDER, TUNING as T } from './config.js';
import { Mode } from './sim.js';

const { clamp } = THREE.MathUtils;
const UP = new THREE.Vector3(0, 1, 0);
const _smoothUp = new THREE.Vector3();
const _qBoard = new THREE.Quaternion(), _qOff = new THREE.Quaternion(), _pivot = new THREE.Vector3(), _local = new THREE.Vector3();

// Puts the player on the board. The play space (rig) is bolted to the board: it goes wherever the board goes, turns
// when it turns and tilts with whatever the board is lying on, so ramps, walls and rails all swing the whole world
// around you. Inside it the headset keeps its real position over the deck, and you face the way you would standing
// on a real board: side-on to travel, never forward.
export class Rider {
  constructor({ rig, camera, renderer, sim }) {
    this.rig = rig;
    this.camera = camera;
    this.renderer = renderer;
    this.sim = sim;
    this.anchor = new THREE.Vector2();   // where the head was, in play-space metres, when you "stood on the board"
    this.yawCal = 0;                      // which way the head faced then, relative to the play space
    this.calibrated = false;
    this.settleFrames = 0;
    this.up = new THREE.Vector3(0, 1, 0);  // the up the view is actually using: the board's, eased
    this.fade = 0;
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
  }

  update(dt) {
    const sim = this.sim;
    const vr = this.presenting;
    if (!this.calibrated) this.up.copy(sim.up);
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
    }

    // Feet on the deck, dropping with a crouch (and, in a bail, falling away from the board). Everything is measured
    // along the board's own up so it stays right on a wall.
    let drop = sim.crouch;
    if (sim.mode === Mode.BAIL) {
      const e = clamp(sim.bailTime / 0.35, 0, 1);
      drop += T.bailFallDrop * e * e * (3 - 2 * e);
    }
    // Ease into changes of surface angle: gentle slopes are smoothed, steep walls are followed almost rigidly.
    const tilt = Math.acos(clamp(sim.up.y, -1, 1));
    const steep = THREE.MathUtils.smoothstep(tilt, RIDER.tiltGentleAngle, RIDER.tiltSteepAngle);
    let rate = RIDER.tiltRateGentle + (RIDER.tiltRateSteep - RIDER.tiltRateGentle) * steep;
    if (sim.mode === Mode.GRIND || sim.mode === Mode.BAIL) rate = RIDER.tiltRateGrind;
    if (dt > 1) this.up.copy(sim.up);
    this.up.lerp(sim.up, 1 - Math.exp(-rate * dt)).normalize();
    _pivot.copy(sim.pos).addScaledVector(this.up, BOARD.deckTop - drop);

    // Rig attitude = the board's frame (heading + eased up), then turned so the player's calibrated gaze is the stance
    // direction (side-on in VR, down the board on a flat screen).
    sim.boardQuaternion(_qBoard, false, this.up);
    _qOff.setFromAxisAngle(UP, (vr ? sim.faceOffset : 0) - this.yawCal);
    this.rig.quaternion.copy(_qBoard).multiply(_qOff);

    // Rig origin so the calibrated head position sits over the board centre.
    _local.set(this.anchor.x, 0, this.anchor.y).applyQuaternion(this.rig.quaternion);
    this.rig.position.copy(_pivot).sub(_local);
    if (!vr) this.camera.position.set(0, RIDER.eyeHeightDesktop, 0);
    this.rig.updateMatrixWorld(true);

    // Fade to black while a bail plays out, then back in at the respawn.
    const fadeTarget = sim.mode === Mode.BAIL && sim.bailTime > 0.5 ? 1 : 0;
    this.fade += (fadeTarget - this.fade) * (1 - Math.exp(-(fadeTarget ? 6 : 5) * dt));
    this.fadeMesh.visible = this.fade > 0.01;
    this.fadeMesh.material.opacity = this.fade;
  }
}
