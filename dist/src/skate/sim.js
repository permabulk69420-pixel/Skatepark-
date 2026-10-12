import * as THREE from 'three';
import { BOARD, RIDER, TUNING as T } from './config.js';

const { clamp } = THREE.MathUtils;
const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);
const UP = new THREE.Vector3(0, 1, 0);

export const Mode = Object.freeze({ GROUND: 'ground', AIR: 'air', GRIND: 'grind', BAIL: 'bail' });

// Board heading h points the nose along (-sin h, 0, -cos h): h = 0 is -Z, the way the park entrance faces.
export const headingVec = (h, out) => out.set(-Math.sin(h), 0, -Math.cos(h));
export const yawOf = (x, z) => Math.atan2(-x, -z);
const damp = (current, target, rate, dt) => target + (current - target) * Math.exp(-rate * dt);

// A short acceleration/deceleration at either end of a trick, with constant angular speed in the middle.
// A full turn still takes flipTime; a half turn still takes shuvTime. The physical angle and displayed angle agree.
export const trickRotationEase = (progress) => {
  const p = clamp(progress, 0, 1), ramp = 0.18;
  if (p < ramp) return p * p / (2 * ramp * (1 - ramp));
  if (p > 1 - ramp) return 1 - (1 - p) * (1 - p) / (2 * ramp * (1 - ramp));
  return (p - ramp / 2) / (1 - ramp);
};

const _H = new THREE.Vector3(), _R = new THREE.Vector3(), _f = new THREE.Vector3(), _lat = new THREE.Vector3();
const _gt = new THREE.Vector3(), _np = new THREE.Vector3(), _n = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _probe = new THREE.Vector3(), _P = new THREE.Vector3(), _u = new THREE.Vector3();
const _F = new THREE.Vector3(), _t = new THREE.Vector3(), _basisM = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _hit = { y: 0, nx: 0, ny: 1, nz: 0 };
const _cast = { dist: 0, nx: 0, ny: 1, nz: 0 };
const _sf = new THREE.Vector3(), _sr = new THREE.Vector3(), _so = new THREE.Vector3(), _sd = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _wn = new THREE.Vector3(), _cand = new THREE.Vector3();
const WHEEL_LIFT = 0.3;
const _qPitch = new THREE.Quaternion(), _qRoll = new THREE.Quaternion(), _qYaw = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);

// The skater is the board: position is where the wheels meet the ground, heading is which way the nose points.
// The rider is placed over it by the view layer. Everything runs in fixed-ish substeps so frame rate does not change the feel.
export class Skater {
  constructor({ world, paths = [], onEvent = () => {}, random = Math.random, bounds = T.bounds, requireGrind = false }) {
    this.world = world;
    this.requireGrind = requireGrind;           // true in the game: rails and copings are only caught after a press of the grind button
    this.grindHeld = false; this.grindWas = false; this.grindArm = 0;
    this.bounds = bounds;                        // the level's play area: half-extents x/z around an optional centre cx/cz
    this.paths = paths;
    this.onEvent = onEvent;
    this.random = random;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.mode = Mode.AIR;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.up = new THREE.Vector3(0, 1, 0);         // smoothed board up, for display
    this.faceOffset = -Math.PI / 2;               // rider's facing relative to the nose (regular stance faces the board's right)

    this.steer = 0; this.drive = 0; this.lean = 0;
    this.manual = null; this.manualQueue = null; this.manualLift = 0; this.clock = 0; this.stickExtreme = 0; this.stickExtremeT = -9; this.stickExtremeSpeed = 0;
    this.jumpWas = false; this.crouchTime = 0; this.popRequest = null; this.popBuffer = 0;
    this.pushCool = 0; this.pushPending = 0; this.braking = false; this.edgeGrace = 0; this.rolledOff = false; this.launchE = 0; this.holdFwd = 0; this.passIntent = false; this.lipExit = false; this.airFloor = { y: 0, nx: 0, ny: 1, nz: 0, found: false };
    this.spinVel = 0; this.exitAlign = 0;
    this.flip = null; this.flipArm = 0; this.flipWas = false; this.flipRoll = 0; this.spinLock = false;
    this.shuv = null; this.shuvYaw = 0; this.trickWait = 0; this.bestStick = null; this.lastStickAng = null; this.rawSteer = 0; this.rawDrive = 0; this.trickPrefix = ''; this.switched = false;
    this.freezeT = 0; this._freezePos = new THREE.Vector3(); this.popTimer = 99; this.visPitch = 0; this.visRoll = 0; this.carve = 0;
    this.crouch = 0; this.rollSpeed = 0; this.bodyRef = null; this.bodyY = null; this.extend = 0; this.pumpAcc = 0; this.groundedTime = 0; this.airTime = 0;
    this.grind = null; this.lastGrindPath = null; this.grindCooldown = 0;
    this.bailTime = 0; this.bailBoard = null;
    this.safe = { pos: new THREE.Vector3(), heading: 0 };
    this.spawn = { pos: new THREE.Vector3(), heading: 0 };
    this.wheels = { pts: [0, 1, 2, 3].map(() => new THREE.Vector3()), nrm: [0, 1, 2, 3].map(() => new THREE.Vector3()), h: [0, 0, 0, 0], ok: [false, false, false, false], count: 0, maxY: 0, centre: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), hasNormal: false };
  }

  setSpawn(pos, heading = 0) {
    this.spawn.pos.copy(pos);
    this.spawn.heading = heading;
    this.respawn(this.spawn);
  }

  respawn(where = this.safe) {
    this.pos.copy(where.pos).y += 0.04;
    this.heading = where.heading;
    this.vel.set(0, 0, 0);
    this.mode = Mode.AIR;
    this.grind = null; this.bailBoard = null;
    this.up.set(0, 1, 0); this.groundNormal.set(0, 1, 0);
    this.spinVel = 0; this.exitAlign = 0; this.visPitch = 0; this.visRoll = 0;
    this.pushCool = 0; this.pushPending = 0; this.crouch = 0; this.popRequest = null; this.holdFwd = 0; this.passIntent = false; this.lipExit = false; this.manual = null; this.manualQueue = null; this.manualLift = 0;
    this.endFlip(); this.flipArm = 0;
    if (this.switched) { this.faceOffset = -this.faceOffset; this.switched = false; } // the spawn heading is the board's nose again
    this.safe.pos.copy(where.pos); this.safe.heading = where.heading;
    this.onEvent('respawn');
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  // Whatever balance meter is running (a grind or a manual), for the HUD and haptics.
  get balance() { return this.mode === Mode.GRIND ? this.grind : (this.mode === Mode.GROUND ? this.manual : null); }
  get facingYaw() { return this.heading + this.faceOffset; }
  // Goofy or regular as the rider stands, whatever a shove-it has done to the board's heading since.
  get goofy() { return (this.faceOffset > 0) !== this.switched; }

  // ----- per-frame entry point -------------------------------------------------------------------------------
  update(input, dt) {
    if (!(dt > 0)) return;
    this.steer = damp(this.steer, clamp(input.steer || 0, -1, 1), 20, dt);
    this.lean = clamp(input.lean || 0, -1, 1);   // the hands (VR) or A/D (flat screen): what balances grinds and manuals
    this.drive = clamp(input.drive || 0, -1, 1);
    this.rawSteer = clamp(input.steer || 0, -1, 1); // the stick as it is, for picking a trick (this.steer is smoothed)
    this.rawDrive = this.drive;
    // How long forward has been held; a tap does not build it and letting go drains it quickly.
    this.holdFwd = clamp(this.holdFwd + (this.drive > T.driveThreshold ? dt : -dt * T.passHoldDrain), 0, T.passHoldMax);
    this.clock += dt;
    this.detectFlick();

    const jump = !!input.jump;
    if (jump && !this.jumpWas) { this.crouchTime = 0; this.crouch = Math.max(this.crouch, RIDER.crouchPress); this.onEvent('crouch'); }
    if (jump) this.crouchTime = Math.min(this.crouchTime + dt, 1);
    if (!jump && this.jumpWas) {
      this.popRequest = clamp(this.crouchTime / T.popChargeTime, 0, 1);
      this.popBuffer = 0.08;
    }
    this.jumpWas = jump;
    this.jumpHeld = jump;
    // The grind button (right trigger): press it once and for the next moment a rail or coping that the board touches is caught.
    // It is the press that counts, not holding it, and a catch uses the press up.
    this.grindHeld = !!input.grind;
    if (this.grindHeld && !this.grindWas) this.grindArm = T.grindArmWindow;
    this.grindWas = this.grindHeld;
    this.grindArm = Math.max(0, this.grindArm - dt);
    const flipHeld = !!input.flip;
    if (flipHeld && !this.flipWas) this.flipArm = T.flipArmWindow;
    this.flipWas = flipHeld;
    this.flipArm = Math.max(0, this.flipArm - dt);
    this.trackBody(input.bodyY, dt);
    this.popBuffer -= dt;
    if (this.popBuffer <= 0) this.popRequest = null;
    this.grindCooldown = Math.max(0, this.grindCooldown - dt);

    if (this.mode === Mode.BAIL) {
      this.bailStep(dt);
    } else {
      const n = Math.max(1, Math.ceil(dt / T.maxSubstep));
      const h = dt / n;
      for (let i = 0; i < n && this.mode !== Mode.BAIL; i++) {
        if (this.mode === Mode.GROUND) this.groundStep(h);
        else if (this.mode === Mode.AIR) this.airStep(h);
        else this.grindStep(h);
      }
      if (this.pos.y < T.killY) this.respawn(this.spawn);
      // Safety net: airborne with a real velocity but not moving at all means the board is wedged in the level geometry. Bail out of it
      // rather than hang there (and fall through it, in the end).
      if (this.mode === Mode.AIR && this.pos.distanceToSquared(this._freezePos) < 1e-6 && this.vel.lengthSq() > 0.25) this.freezeT += dt;
      else this.freezeT = 0;
      this._freezePos.copy(this.pos);
      if (this.freezeT > T.freezeBail) { this.freezeT = 0; this.bail('stuck'); }
    }
    this.updateVisuals(dt);
  }

  // Forward then back (or back then forward) on the stick, quickly, starts a manual.
  detectFlick() {
    // On a rail the stick up and down picks nosegrind / 5-0; it must not read as a manual flick.
    if (this.mode === Mode.GRIND) { this.stickExtreme = 0; this.stickExtremeT = this.clock; return; }
    const d = this.drive;
    const sign = d > T.flickThreshold ? 1 : d < -T.flickThreshold ? -1 : 0;
    if (sign !== 0 && sign !== this.stickExtreme) {
      // Judge speed when the flick began: the forward half is itself a kick and must not lift a stand-still over the bar.
      if (this.stickExtreme !== 0 && this.clock - this.stickExtremeT <= T.flickWindow && this.stickExtremeSpeed >= T.manualMinSpeed) this.requestManual(this.stickExtreme);
      this.stickExtreme = sign;
      this.stickExtremeT = this.clock;
      this.stickExtremeSpeed = this.speed;
    } else if (sign === 0 && this.clock - this.stickExtremeT > T.flickWindow) {
      this.stickExtreme = 0;
    }
  }

  // Ask for a manual (a flick of the stick). On the ground it starts now; in the air it is remembered and starts when you land:
  // ollie, flick, land in it.
  requestManual(kind) {
    if (this.manual) return;
    // Down or up on the stick with the flip button is a shove-it, not a manual.
    if (this.mode === Mode.AIR && (this.flipWas || this.flipArm > 0 || this.flip || this.shuv || this.trickWait > 0)) return;
    if (this.mode === Mode.GROUND) this.tryManual(kind);
    else if (this.mode === Mode.AIR) this.manualQueue = { kind, t: this.clock };
  }

  // kind +1: tail manual (nose up), −1: nose manual (tail up).
  tryManual(kind, queued = false) {
    if (this.mode !== Mode.GROUND || this.manual || (this.jumpHeld && !queued)) return;
    if (this.groundNormal.y < 0.97 || this.speed < T.manualMinSpeed) return;
    // A manual lifts the end that leads: the nose going forward, the tail rolling fakie (and the nose manual the other way).
    headingVec(this.heading, _H);
    const fakie = this.vel.x * _H.x + this.vel.z * _H.z < -0.3;
    this.manual = {
      kind, pitchSign: fakie ? -kind : kind, bal: 0, balVel: 0, time: 0, p1: this.random() * TAU, p2: this.random() * TAU,
      name: `${fakie ? 'Fakie ' : ''}${kind > 0 ? 'Manual' : 'Nose Manual'}`
    };
    this.pushPending = 0;
    this.stickExtreme = 0;
    this.onEvent('manualStart', { name: this.manual.name });
  }

  endManual(reason) {
    const m = this.manual;
    if (!m) return;
    this.manual = null;
    this.onEvent('manualEnd', { reason, name: m.name, time: m.time });
  }

  manualStep(h, sp) {
    const m = this.manual;
    m.time += h;
    const instab = Math.min(T.manualInstab0 + T.manualInstabGrow * m.time, T.manualInstabMax);
    const wobble = T.manualWobble * (0.6 * Math.sin(2.1 * m.time + m.p1) + 0.4 * Math.sin(4.9 * m.time + m.p2));
    // The meter is the interface: a push to the right moves the marker right, whichever way the board is leaning.
    const acc = instab * m.bal + wobble + T.manualControl * this.lean - T.manualDamp * m.balVel;
    m.balVel += acc * h;
    m.bal += m.balVel * h;
    if (Math.abs(m.bal) >= 1) { m.bal = Math.sign(m.bal); this.endManual('bail'); this.bail('manual'); return; }
    if (sp < T.manualEndSpeed) this.endManual('stall');
    else if (this.groundNormal.y < 0.93) this.endManual('slope');
  }

  // Head height (VR only) → how fast the rider is standing up or squatting, relative to their own standing height.
  trackBody(y, dt) {
    if (typeof y !== 'number' || !isFinite(y) || y < 0.2) { this.extend = damp(this.extend, 0, 10, dt); return; }
    if (this.bodyY === null) { this.bodyY = y; this.bodyRef = y; return; }
    const rate = (y - this.bodyY) / dt;
    this.bodyY = y;
    this.bodyRef += (y - this.bodyRef) * (1 - Math.exp(-dt / T.pumpRefTime));
    this.extend = damp(this.extend, clamp(rate, -3, 3), T.pumpResponse, dt);
  }

  // ----- ground ----------------------------------------------------------------------------------------------
  groundStep(h) {
    this.groundedTime += h;
    const m = this.manual;
    const u = this.groundNormal;
    headingVec(this.heading, _H);
    _f.copy(_H).addScaledVector(u, -_H.dot(u)).normalize();
    let s = this.vel.dot(_f);

    if (this.popRequest !== null) { this.pop(this.popRequest); return; }
    if (this.tryCopingMagnet(this.pos)) return;

    _lat.copy(this.vel).addScaledVector(_f, -s);
    _lat.addScaledVector(u, -_lat.dot(u));

    // Gravity along the surface: this is all a bowl needs to work.
    _gt.set(0, -T.gravity, 0);
    _gt.addScaledVector(u, -_gt.dot(u));
    const along = _gt.dot(_f);
    s += along * h;
    _lat.addScaledVector(_gt, h).addScaledVector(_f, -along * h);

    // Pushing and braking
    this.pushCool -= h;
    this.braking = false;
    // Kicks go the way you are already rolling (rolling fakie, forward on the stick keeps you going, it does not brake you).
    const rolling = s < -0.3 ? -1 : 1;
    if (!m && this.drive > T.driveThreshold && this.pushCool <= 0 && Math.abs(s) < T.pushMaxSpeed && u.y > 0.97) {
      this.pushPending += T.pushImpulse * clamp(1 - Math.abs(s) / T.pushMaxSpeed, 0.12, 1);
      this.pushCool = T.pushInterval;
      this.onEvent('push', { speed: s });
    }
    if (this.pushPending > 0) {
      const give = Math.min(this.pushPending, T.pushDrain * h);
      s += give * rolling;
      this.pushPending -= give;
    }
    if (!m && this.drive < -T.driveThreshold && Math.abs(s) > 0.05) {
      this.braking = true;
      s -= Math.sign(s) * Math.min(Math.abs(s), T.brakeDecel * h);
    }
    const sp = Math.abs(s);
    if (sp > 0) s -= Math.sign(s) * Math.min(sp, (T.rollFriction + T.airDrag * sp * sp) * h);

    // Forward on the stick pumps a curved surface (the same input that pushes on the flat).
    const bend = clamp((1 - u.y) / T.pumpCurve, 0, 1);
    if (!m && this.drive > T.driveThreshold && bend > 0 && sp > 1.2 && sp < T.autoPumpMaxSpeed) {
      const before = s;
      s += Math.sign(s) * T.autoPump * bend * h;
      this.pumpAcc += Math.abs(s) - Math.abs(before);
    }

    // Pumping a transition: standing up out of a squat while on a curved surface adds speed along the way you are rolling.
    const curve = clamp((1 - u.y) / T.pumpCurve, 0, 1);
    if (curve > 0 && sp > 1) {
      const before = s;
      if (this.extend > 0) s += Math.sign(s) * Math.min(T.pumpMaxAccel, T.pumpGain * this.extend * curve) * h;
      else s += Math.sign(s) * T.pumpGain * 0.35 * this.extend * curve * h; // squatting costs a little, so mashing is not free
      this.pumpAcc += Math.abs(s) - Math.abs(before);
    }
    if (this.pumpAcc > T.pumpEventSpeed && this.extend < 0.2) { this.onEvent('pump', { gain: this.pumpAcc }); this.pumpAcc = 0; }
    else if (this.extend < 0) this.pumpAcc = 0;

    if (m) {
      s -= Math.sign(s) * Math.min(Math.abs(s), T.manualDrag * h);
      this.manualStep(h, Math.abs(s));
      if (this.mode !== Mode.GROUND) return;
    }

    // Steering: trucks need roll speed to bite, so almost-stopped turning is a slow tail pivot.
    const bite = clamp(sp / T.steerSpeedRef, 0, 1);
    const maxRate = Math.min(T.maxYawRate, T.maxLateralAccel / Math.max(sp, 1.6));
    // Left and right mean left and right of where you are going, forward or fakie (a real board's trucks would turn the other
    // way rolling backwards, which is just confusing).
    this.heading = wrap(this.heading - this.steer * (maxRate * (this.manual ? T.manualSteer : 1) * bite + T.pivotRate * (1 - bite)) * h);
    this.carve = damp(this.carve, this.steer * clamp(sp / 6, 0, 1) * (s < 0 ? -1 : 1), 10, h);

    headingVec(this.heading, _H);
    _f.copy(_H).addScaledVector(u, -_H.dot(u)).normalize();
    _lat.multiplyScalar(Math.exp(-T.lateralGrip * h));
    this.vel.copy(_f).multiplyScalar(s).add(_lat);
    this.rollSpeed = s;

    _np.copy(this.pos).addScaledVector(this.vel, h);
    this.moveOnGround(_np, h);
    if (this.mode === Mode.GROUND && this.groundNormal.y > 0.92 && this.groundedTime > 0.5 && this.speed < 9) {
      this.safe.pos.copy(this.pos); this.safe.heading = this.heading;
    }
  }

  moveOnGround(np, h) {
    const oldY = this.pos.y;
    const n = this.groundNormal;
    const speed = this.vel.length();

    // Look ahead along the motion: a surface much steeper than the one we are on is a wall, not a ramp.
    if (speed > 0.4) {
      _sd.copy(this.vel).divideScalar(speed);
      _a.copy(this.pos).addScaledVector(n, 0.1);
      const far = T.wallProbe + speed * h;
      const c = this.world.cast(_a, _sd, far, _cast);
      if (c && c.nx * n.x + c.ny * n.y + c.nz * n.z < T.wallCos) { this.hitWall(c); return; }
    }

    this.clampBounds(np);
    const steep = n.y < T.steepNormalY;
    const w = this.sampleWheels(np, this.heading, Math.max(oldY, np.y) + 0.5, steep);
    if (!w.count) {
      if (this.insideSolid(np)) { this.hitWall(null); return; }
      this.pos.copy(np);
      this.leaveGround();
      return;
    }
    if (steep) {
      // Rays along the normal only report wheels that are actually near the surface; how high they hover says whether we left it.
      let hover = 0;
      for (let k = 0; k < 4; k++) if (w.ok[k]) hover += w.h[k];
      hover /= w.count;
      if (hover > T.steepLeave) { this.pos.copy(np); this.leaveGround(); return; }
      if (w.count >= 3) {
        this.pos.copy(w.centre);
        if (w.hasNormal) this.groundNormal.copy(w.normal);
      } else {
        // Fewer than three wheels agree: at a crest the front wheels are over a flat deck and the rear ones still on the slope.
        // Sliding the board "down onto the surface" along the slope normal can drive it into the deck, so check the candidate
        // against the ground that is really under it. If that is a flat deck the board is over the lip and flies off with the
        // speed it has; otherwise it is lifted onto the real surface.
        _cand.copy(np).addScaledVector(n, -hover);
        const mid = this.world.ground(_cand.x, _cand.z, _cand.y + 0.6, _hit);
        if (mid) {
          if (mid.ny > T.crestDeckNormalY && mid.y >= _cand.y - T.crestLeave) {
            this.pos.set(_cand.x, Math.max(_cand.y, mid.y), _cand.z);
            this.leaveGround();
            return;
          }
          if (_cand.y < mid.y - 0.02) _cand.y = mid.y;
        }
        this.pos.copy(_cand);
      }
      this.projectVelocity(this.groundNormal);
      return;
    }
    const hStep = Math.hypot(this.vel.x, this.vel.z) * h;
    const expected = oldY + Math.max(this.vel.y, 0) * h;
    const allowed = T.maxStep + hStep * T.maxSlopeTan;
    if (w.centre.y - expected > allowed) {
      // At the crest of a steep ramp the front wheels reach a flat deck while the rear ones are still on the slope; the wheel
      // fit then jumps well above the board, which looks like a wall. A surface that is continuous under the middle of the
      // board is a ramp, however steep its last few centimetres: judge by that, so a bank ending in a deck can be ridden over.
      const mid = this.world.ground(np.x, np.z, Math.max(oldY, np.y) + 0.5, _hit);
      if (mid && mid.y - expected <= allowed && mid.ny > T.crestMinNormalY) {
        w.centre.set(np.x, mid.y, np.z);
        w.normal.set(mid.nx, mid.ny, mid.nz);
        w.hasNormal = true;
      } else {
        // Higher ground behind us means we have rolled off an edge (tail still on the deck), not into a wall.
        const hv = Math.hypot(this.vel.x, this.vel.z);
        const ahead = hv > 1e-4 ? ((w.centre.x - np.x) * this.vel.x + (w.centre.z - np.z) * this.vel.z) / hv : 0;
        if (ahead < -0.05) { this.pos.copy(np); this.leaveGround(); return; }
        this.hitWall(null);
        return;
      }
    }
    if (np.y - w.centre.y <= T.snapDistance) {
      this.pos.set(np.x, w.centre.y, np.z);
      if (w.hasNormal) this.groundNormal.copy(w.normal);
      this.projectVelocity(this.groundNormal);
    } else {
      this.pos.copy(np);
      this.leaveGround();
    }
  }

  projectVelocity(n) {
    const total = this.vel.length();
    this.vel.addScaledVector(n, -this.vel.dot(n));
    const flat = this.vel.length();
    if (flat > 1e-6 && total > flat) this.vel.multiplyScalar((flat + (total - flat) * T.transitionKeep) / flat);
  }

  leaveGround() {
    this.mode = Mode.AIR;
    this.airTime = 0;
    this.edgeGrace = T.edgeGrace;
    this.rolledOff = true;
    this.endManual('air');
    this.launchE = 0.5 * this.vel.lengthSq() + T.gravity * this.pos.y;
    this.passIntent = this.popTimer < T.passPopWindow;      // an ollie arms a possible exit; forward input at the lip commits it
    this.lipExit = false;
    this.groundedTime = 0;
    this.braking = false;
  }

  pop(charge) {
    this.endManual('pop');
    const speed = T.popMin + (T.popMax - T.popMin) * clamp(charge, 0, 1);
    // Straight off the surface on flat ground, but leaning towards straight up as it steepens: popping off a wall along
    // its normal would throw you backwards into the pit.
    const n = this.groundNormal;
    const energyBeforePop = 0.5 * this.vel.lengthSq() + T.gravity * this.pos.y;
    const lean = Math.pow(clamp(n.y, 0, 1), T.popUpBias);
    _tmp.copy(UP).multiplyScalar(1 - lean).addScaledVector(n, lean).normalize();
    this.vel.addScaledVector(_tmp, speed);
    this.popRequest = null;
    this.popTimer = 0;
    this.crouch = -RIDER.popRebound;
    this.pos.addScaledVector(this.groundNormal, 0.012); // lift off so the ground check does not re-catch us
    this.leaveGround();
    this.rolledOff = false;
    this.launchE = energyBeforePop;   // speed carried to a lip is what counts, not the pop
    this.onEvent('pop', { charge, speed });
  }

  // ----- air -------------------------------------------------------------------------------------------------
  airStep(h) {
    this.airTime += h;
    this.popTimer += h;
    this.vel.y -= T.gravity * h;
    const sp = this.vel.length();
    this.vel.multiplyScalar(Math.max(0, 1 - T.airDrag * sp * h));

    // A little stick drift while carving into a jump must not spin you; spin only starts past the dead zone.
    const spinInput = Math.sign(this.steer) * Math.max(0, Math.abs(this.steer) - T.airSpinDeadzone) / (1 - T.airSpinDeadzone);
    // Flips and shove-its take the stick for themselves: it picks the trick and must not also spin the board.
    // The button's window only gates the stick leaving the middle; a trick that is already being picked carries on past it.
    if (!this.flip && !this.shuv && this.airTime > T.flipMinAir && (this.flipArm > 0 || this.trickWait > 0)) this.pickTrick(h);
    else if (this.flip || this.shuv) this.trickWait = 0;
    if (this.flip) {
      const f = this.flip;
      f.progress = clamp((f.progress ?? Math.abs(f.angle) / TAU) + h / T.flipTime, 0, 1);
      f.angle = f.sign * TAU * trickRotationEase(f.progress);
      this.flipRoll = f.angle;
    }
    if (this.shuv && !this.shuv.done) {
      const s = this.shuv;
      s.progress = clamp((s.progress ?? Math.abs(s.angle) / Math.PI) + h / T.shuvTime, 0, 1);
      s.angle = s.sign * Math.PI * trickRotationEase(s.progress);
      this.shuvYaw = s.angle;
      if (s.progress >= 1) this.commitShuv();
    }
    if (this.spinLock && (!this.flip || Math.abs(this.flip.angle) >= TAU) && (!this.shuv || this.shuv.done) && Math.abs(this.steer) < T.airSpinDeadzone) this.spinLock = false;
    const spinTarget = this.spinLock || this.trickWait > 0 ? 0 : -spinInput * T.airSpinRate;
    this.spinVel = damp(this.spinVel, spinTarget, T.airSpinResponse, h);
    this.heading = wrap(this.heading + this.spinVel * h);
    if (this.exitAlign > 0) {
      this.exitAlign -= h;
      if (Math.abs(this.steer) < 0.35 && this.speed > 0.5) {
        const travel = yawOf(this.vel.x, this.vel.z);
        let diff = wrap(travel - this.heading);
        if (Math.abs(diff) > Math.PI / 2) diff = wrap(diff - Math.sign(diff) * Math.PI);
        this.heading = wrap(this.heading + clamp(diff, -T.exitAlignRate * h, T.exitAlignRate * h));
      }
    }

    if (this.popTimer < T.passPopWindow) this.passIntent = true;
    this.hugWall(h);
    this.lipAir(h);
    this.sampleAirFloor();

    _np.copy(this.pos).addScaledVector(this.vel, h);
    this.clampBounds(_np);

    // A board that is mid-flip cannot catch a rail; one that has come round (or is nearly there) can.
    if ((!this.flip || this.flipResidual() <= T.flipCleanRoll) && (!this.shuv || this.shuvResidual() <= T.shuvClean) && (this.tryGrind(_np, h) || this.tryCopingMagnet(_np))) return;

    if (this.sweepBoard(_np, h)) return;
    this.pos.copy(_np);
  }

  // ----- flips and shove-its ---------------------------------------------------------------------------------
  // The flip button in the air, then the direction the stick is pushed picks the trick, measured as an angle (like an 8-way pad), not
  // as separate left/right and up/down amounts, so a lazy diagonal that only reaches half way still reads as a diagonal:
  //   down (±22.5°) ............ pop shove-it (the board spins 180° flat, backside)
  //   down-left / down-right . varial kickflip / varial heelflip (a kickflip with a backside shove-it / a heelflip with a frontside one)
  //   left / right ........... kickflip / heelflip (the board rolls once about its length)
  //   up-left / up-right ..... the same flips (up on its own does nothing: forward is the push, and it is held a lot)
  // The stick gets a moment (trickSettle) to land on its direction once it leaves the middle, because a thumb takes a few frames to get there.
  pickTrick(h) {
    const x = this.rawSteer, y = this.rawDrive, mag = Math.hypot(x, y);
    if (this.trickWait === 0) {
      if (mag < T.trickStick) return;
      this.trickWait = 1e-6; this.bestStick = null; this.lastStickAng = null;
    }
    this.trickWait += h;
    if (mag >= T.trickStick) this.bestStick = { x, y };
    // A thumb often goes straight down or sideways first and swings onto the diagonal a moment later. Wait for it to stop moving
    // (its direction changing less than a few degrees a frame), but never longer than trickMaxWait.
    const ang = Math.atan2(x, -y);
    const moving = mag >= T.trickStick && (this.lastStickAng !== null && Math.abs(Math.atan2(Math.sin(ang - this.lastStickAng), Math.cos(ang - this.lastStickAng))) > T.trickStable);
    this.lastStickAng = mag >= T.trickStick ? ang : null;
    if (this.trickWait < T.trickSettle || (moving && this.trickWait < T.trickMaxWait)) return;
    const st = this.bestStick || { x, y };
    this.pickedStick = { x: st.x, y: st.y };
    this.trickWait = 0; this.bestStick = null;
    const z = this.trickZone(st.x, st.y);
    if (!z.none) this.startTrick(z.flip, z.shuv);
  }

  // Which trick a stick position means: { name, flip, shuv, deg } or null. `deg` is the stick's direction in degrees, 0 = straight down,
  // positive to the right, after the stickTurn correction. Used by pickTrick and by the live readout (hold the flip button on the ground).
  trickZone(x, y) {
    const mag = Math.hypot(x, y);
    // Turn the stick reading by stickTurn (positive = clockwise as you look at the stick) before reading its direction.
    const c = Math.cos(T.stickTurn), sn = Math.sin(T.stickTurn);
    const rx = x * c + y * sn, ry = -x * sn + y * c;
    const deg = Math.atan2(rx, -ry) * 180 / Math.PI;
    if (mag < T.trickStick) return { name: '-', flip: null, shuv: null, deg, none: true };
    const fromDown = Math.atan2(Math.abs(rx), -ry);
    const kick = rx < 0;
    if (fromDown <= T.shuvCone) return { name: 'Pop Shove-it', flip: null, shuv: true, deg };
    if (fromDown <= T.varialCone) return { name: kick ? 'Varial Kickflip' : 'Varial Heelflip', flip: kick, shuv: kick, deg };
    if (fromDown < Math.PI - T.shuvCone) return { name: kick ? 'Kickflip' : 'Heelflip', flip: kick, shuv: null, deg };
    return { name: '(up: nothing)', flip: null, shuv: null, deg, none: true };
  }

  makeFlip(kick) {
    // Which way the board rolls for each flip; goofy is the mirror image. This is the one place to change if it looks backwards
    // (the first version was backwards: stick left looked like a heelflip in the headset).
    const sign = (kick ? 1 : -1) * (this.faceOffset < 0 ? 1 : -1);
    return { sign, angle: 0, progress: 0, kick, name: `${this.trickPrefix}${kick ? 'Kickflip' : 'Heelflip'}` };
  }

  makeShuv(bs) {
    // Backside is the way the rider's back leads: clockwise seen from above for a regular rider (counter-clockwise for goofy).
    // A varial kickflip shoves backside and a varial heelflip frontside. Like the flip direction, this is the one place to change it.
    const sign = (bs ? 1 : -1) * Math.sign(this.faceOffset);
    return { sign, angle: 0, progress: 0, bs, done: false, name: `${this.trickPrefix}${bs ? '' : 'Frontside '}Pop Shove-it` };
  }

  // flipKick: null for no flip, true for a kickflip, false for a heelflip. shuvBs: null for no shove-it, else true for backside.
  startTrick(flipKick, shuvBs) {
    headingVec(this.heading, _H);
    const fakie = (this.vel.x * _H.x + this.vel.z * _H.z < -0.3) !== this.switched; // a board that a shove-it turned round is not "fakie"
    this.trickPrefix = fakie ? 'Fakie ' : '';
    if (flipKick !== null) this.flip = this.makeFlip(flipKick);
    if (shuvBs !== null) this.shuv = this.makeShuv(shuvBs);
    if (this.flip && this.shuv) this.flip.varial = `${this.trickPrefix}Varial ${this.flip.kick ? 'Kickflip' : 'Heelflip'}`;
    this.trickWait = 0;
    this.flipArm = 0;
    this.spinLock = true;
    this.onEvent('flipStart', { name: this.flip?.varial || this.flip?.name || this.shuv.name, stick: this.pickedStick });
  }

  // The board has come round 180°: it is now travelling tail first. Turn the heading and the rider's stance with it, so the rider
  // (who never moved) still faces the same way, and carry the board's tilts across so nothing jumps.
  commitShuv() {
    const s = this.shuv;
    if (!s || s.done) return;
    s.done = true;
    s.angle = s.sign * Math.PI;
    this.shuvYaw = 0;
    this.heading = wrap(this.heading + Math.PI);
    this.faceOffset = -this.faceOffset;
    this.switched = !this.switched;
    // Reparenting 180° of local shove yaw into board heading must preserve the visible orientation.
    // Pitch reverses in the new frame, but roll (including a mid-varial flip) does NOT:
    // reversing the flip here used to make the board snap abruptly halfway through a varial.
    this.visPitch = -this.visPitch;
  }

  // How far the board is from pointing straight (or straight round), in radians.
  shuvResidual() {
    const s = this.shuv;
    if (!s || s.done) return 0;
    const a = Math.abs(s.angle);
    return Math.min(a, Math.PI - a);
  }

  // How far the board is from lying flat, in radians: the distance to the nearest whole turn.
  flipResidual() {
    const a = Math.abs(this.flip.angle);
    return Math.abs(a - Math.round(a / TAU) * TAU);
  }

  endFlip() {
    this.flip = null;
    this.flipRoll = 0;
    this.shuv = null;
    this.shuvYaw = 0;
    this.trickWait = 0;
    this.spinLock = false;
  }

  // The name to credit when the board is back under you, or null if nothing really happened.
  trickCredit() {
    const f = this.flip, s = this.shuv;
    const flipOk = f && Math.abs(f.angle) > Math.PI && this.flipResidual() <= T.flipCleanRoll;
    const shuvOk = s && (s.done || (Math.abs(s.angle) > Math.PI / 2 && this.shuvResidual() <= T.shuvClean));
    if (flipOk && shuvOk) return f.varial || f.name;
    if (flipOk) return f.name;
    if (shuvOk) return s.name;
    return null;
  }

  // What is below the airborne board, so its tilt can ease towards that surface's before it lands.
  sampleAirFloor() {
    const f = this.airFloor;
    const hit = this.world.ground(this.pos.x, this.pos.z, this.pos.y + 0.2, _hit, 40);
    f.found = !!hit;
    if (hit) { f.y = hit.y; f.nx = hit.nx; f.ny = hit.ny; f.nz = hit.nz; }
  }

  // Airs near a coping lip stay over the pit regardless of speed unless an ollie and forward input
  // deliberately commit to crossing the lip. Once chosen, an exit remains committed for this air.
  lipAir(h) {
    let best = null, bestD = T.lipZone;
    const px = this.pos.x, pz = this.pos.z;
    for (const path of this.paths) {
      if (path.kind !== 'coping') continue;
      const b = path.bounds;
      if (Math.max(b.min.x - px, 0, px - b.max.x) > bestD || Math.max(b.min.z - pz, 0, pz - b.max.z) > bestD) continue;
      for (const seg of path.segments) {
        const abx = seg.b.x - seg.a.x, abz = seg.b.z - seg.a.z;
        const len2 = abx * abx + abz * abz;
        if (len2 < 1e-9) continue;
        const t = clamp(((px - seg.a.x) * abx + (pz - seg.a.z) * abz) / len2, 0, 1);
        const d = Math.hypot(px - (seg.a.x + abx * t), pz - (seg.a.z + abz * t));
        if (d < bestD) { bestD = d; best = { path, seg, t }; }
      }
    }
    if (!best) return;
    const { path, seg, t } = best;
    const lipY = seg.a.y + (seg.b.y - seg.a.y) * t + path.topOffset;
    if (this.pos.y < lipY + 0.02 || this.pos.y > lipY + 10) return;
    const pit = this.pitDirection(seg);
    if (!pit) return;
    const cx = seg.a.x + (seg.b.x - seg.a.x) * t, cz = seg.a.z + (seg.b.z - seg.a.z) * t;
    const intoPit = (px - cx) * pit.x + (pz - cz) * pit.y;       // + over the pit, − over the deck
    const outward = -(this.vel.x * pit.x + this.vel.z * pit.y);  // + moving out over the lip
    // Speed controls how high you get, never whether you are allowed out.
    // Require a deliberate forward hold during an ollie near the coping; do not drop
    // the exit decision if forward is released while crossing.
    if (this.passIntent && this.drive > T.driveThreshold) this.lipExit = true;
    if (!this.lipExit) {
      // A damped spring to just inside the lip line: the air stays over the pit and comes back down against the wall.
      if (intoPit > -0.7 && intoPit < T.lipHoldDist + 2) {
        const acc = clamp(T.lipSpring * (T.lipHoldDist - intoPit) + T.lipDamp * outward, -T.lipMaxAccel, T.lipMaxAccel);
        this.vel.x += pit.x * acc * h; this.vel.z += pit.y * acc * h;
      }
    } else if (intoPit > -T.lipOutwardZone && outward < T.lipOutwardSpeed) {
      const dv = Math.min(T.lipOutwardSpeed - outward, T.lipOutwardAccel * h);
      this.vel.x -= pit.x * dv; this.vel.z -= pit.y * dv;
    }
  }

  // Rolling slowly off a lip onto a steep wall (a drop-in) the rider leans into the wall and rides it down; without this the
  // board just drifts away from the face and free-falls onto the curve, losing most of the speed the drop should give.
  hugWall(h) {
    if (!this.rolledOff || this.airTime > T.hugTime) return;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (hv < 0.05 || hv > T.hugMaxSpeed) return;
    _sd.set(-this.vel.x / hv, 0, -this.vel.z / hv);
    _a.copy(this.pos); _a.y -= 0.3;
    const c = this.world.cast(_a, _sd, T.hugReach, _cast);
    if (!c || c.ny > 0.5 || c.nx * -_sd.x + c.nz * -_sd.z < 0.5) return;
    const k = Math.exp(-T.hugDamp * h);
    this.vel.x *= k; this.vel.z *= k;
  }

  // Continuous collision while airborne: the board's centre and its leading wheels (and, once clear of the edge
  // it just left, its trailing wheels) are swept along this step's motion. Whatever they meet first is what the
  // board lands on or bounces off, however steep, so there is no separate "wall" guess from wheel heights.
  sweepBoard(np, h) {
    _sd.copy(np).sub(this.pos);
    const len = _sd.length();
    if (len < 1e-5) return false;
    _sd.divideScalar(len);
    headingVec(this.heading, _H);
    const lead = _H.x * _sd.x + _H.z * _sd.z >= 0 ? 1 : -1;
    this.edgeGrace = Math.max(0, this.edgeGrace - h);
    let best = null;
    for (let i = 0; i < 3; i++) {
      if (i === 2 && this.edgeGrace > 0) continue;
      const off = i === 0 ? 0 : (i === 1 ? lead : -lead) * BOARD.wheelHalfBase;
      _a.copy(this.pos).addScaledVector(_H, off).y += 0.02;
      // Just after an ollie the board is still tilted with the ground it left: on a slope the leading wheel would be inside the
      // surface ahead and "land" the board on the spot, so popping on any incline went nowhere. Only the middle counts until it is clear.
      if (i !== 0 && this.popTimer < T.popWheelFree) continue;
      const c = this.world.cast(_a, _sd, len, _cast);
      if (!c || (best && c.dist >= best.dist)) continue;
      if (i !== 0 && c.ny >= T.sweepLandMinNormalY) {
        // A wheel that clips the edge of a flat surface is only a landing if the board's middle would be over that surface too. With
        // the middle hanging out over a drop (the lip of a ramp) the board just catches the corner, and landing there left it
        // perched on its front wheels, sat "on the coping" and then sinking through the ramp.
        const cx = this.pos.x + _sd.x * c.dist, cz = this.pos.z + _sd.z * c.dist, cy = this.pos.y + _sd.y * c.dist;
        const under = this.world.ground(cx, cz, cy + T.sweepSupportReach, _hit);
        if (!under || under.y < cy - T.sweepSupportDrop) continue;
      }
      best = { dist: c.dist, nx: c.nx, ny: c.ny, nz: c.nz };
    }
    if (!best) return false;
    this.pos.addScaledVector(_sd, best.dist);
    if (best.ny >= T.sweepLandMinNormalY) {
      _wn.set(best.nx, best.ny, best.nz);
      this.landOn(_wn);
      return true;
    }
    this.pos.x += best.nx * 0.01; this.pos.z += best.nz * 0.01;
    this.hitWall(best);
    return true;
  }

  // Touch down on a surface with this normal: let the wheels settle the board onto it, then run the landing checks.
  landOn(normal) {
    this.groundNormal.copy(normal);
    const steep = normal.y < T.steepNormalY;
    const w = this.sampleWheels(this.pos, this.heading, this.pos.y + 0.5, steep);
    if (w.count >= 3 && w.hasNormal) { this.pos.copy(w.centre); this.groundNormal.copy(w.normal); }
    this.land({ hasNormal: true, normal: this.groundNormal });
  }

  land(w) {
    let credit = null, sketchy = false;
    this.trickWait = 0; this.bestStick = null; this.lastStickAng = null; // a pick still waiting must not carry into the next jump
    if (this.flip || this.shuv) {
      // Beginning a flip/shove just before touchdown is not a completed trick.
      // The old residual check treated a barely-started turn as already aligned and silently cancelled it.
      const incompleteFlip = this.flip && Math.abs(this.flip.angle) < Math.PI;
      const incompleteShuv = this.shuv && !this.shuv.done && Math.abs(this.shuv.angle) < Math.PI / 2;
      if (incompleteFlip || incompleteShuv || (this.flip && this.flipResidual() > T.flipBailRoll) || (this.shuv && this.shuvResidual() > T.shuvBail)) { this.bail('flip'); return; }
      sketchy = (this.flip && this.flipResidual() > T.flipCleanRoll) || (this.shuv && this.shuvResidual() > T.shuvClean);
      credit = this.trickCredit();
      if (this.shuv && Math.abs(this.shuv.angle) > Math.PI / 2) this.commitShuv(); // landed it round: you are riding the other way
      this.endFlip();
    }
    if (w.hasNormal) this.groundNormal.copy(w.normal); else this.groundNormal.set(0, 1, 0);
    const n = this.groundNormal;
    const impact = Math.max(0, -this.vel.dot(n));
    _tmp.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
    const flatSpeed = _tmp.length();
    if (flatSpeed > T.landAngleMinSpeed) {
      // Compare along the surface, not along the horizontal, so landing on a wall is judged fairly.
      headingVec(this.heading, _H);
      _f.copy(_H).addScaledVector(n, -_H.dot(n));
      const align = _f.lengthSq() > 1e-6 ? Math.acos(clamp(Math.abs(_tmp.dot(_f.normalize())) / flatSpeed, 0, 1)) : 0;
      if (align > T.landMaxAngle) { this.bail('landing'); return; }
    }
    if (impact > T.landBailImpact) { this.bail('impact'); return; }
    this.vel.copy(_tmp);
    // Coming back down onto a steep wall you are riding it, not slamming into it: most of the fall carries on down the face.
    const wallness = clamp((T.wallLandFrom - n.y) / T.wallLandSpan, 0, 1);
    if (wallness > 0 && flatSpeed > 1e-3) {
      const total = Math.hypot(flatSpeed, impact);
      this.vel.multiplyScalar((flatSpeed + (total - flatSpeed) * T.wallLandKeep * wallness) / flatSpeed);
    }
    this.mode = Mode.GROUND;
    this.rolledOff = false;
    this.passIntent = false;
    this.groundedTime = 0;
    this.spinVel = 0;
    this.visPitch *= 0.4;
    this.crouch = RIDER.landCompress * clamp(impact / 6, 0.25, 1.3);
    if (sketchy) {
      this.vel.multiplyScalar(T.flipSketchySpeed);
      this.crouch = Math.max(this.crouch, RIDER.landCompress * 1.3);
      this.onEvent('sketchy');
    }
    this.onEvent('land', { impact });
    if (credit) this.onEvent('flip', { name: credit });
    const q = this.manualQueue;
    this.manualQueue = null;
    if (q && this.clock - q.t <= T.manualQueueWindow) this.tryManual(q.kind, true);
  }

  // ----- walls -----------------------------------------------------------------------------------------------
  // Throw away the part of the motion that goes into the surface. `c` is the probe hit, or null when we only know we are blocked.
  hitWall(c) {
    const speed = this.vel.length();
    if (speed < 1e-4) return;
    if (c) {
      _wn.set(c.nx, c.ny, c.nz);
    } else {
      _sd.set(this.vel.x, 0, this.vel.z);
      if (_sd.lengthSq() < 1e-8) return;
      _sd.normalize();
      _probe.set(this.pos.x, this.pos.y + 0.12, this.pos.z);
      if (this.world.cast(_probe, _sd, 0.7, _cast)) _wn.set(_cast.nx, _cast.ny, _cast.nz);
      else _wn.copy(_sd).negate();
    }
    const vn = this.vel.dot(_wn);
    if (vn >= 0) return;
    const impact = -vn;
    this.vel.addScaledVector(_wn, -vn * 1.15);
    if (impact > T.wallEventSpeed) this.onEvent('wall', { impact });
    if (impact > T.wallBailSpeed) this.bail('wall');
  }

  clampBounds(np) {
    const b = this.bounds;
    const cx = b.cx || 0, cz = b.cz || 0;
    if (np.x > cx + b.x) { np.x = cx + b.x; if (this.vel.x > 0) this.vel.x = 0; }
    if (np.x < cx - b.x) { np.x = cx - b.x; if (this.vel.x < 0) this.vel.x = 0; }
    if (np.z > cz + b.z) { np.z = cz + b.z; if (this.vel.z > 0) this.vel.z = 0; }
    if (np.z < cz - b.z) { np.z = cz - b.z; if (this.vel.z < 0) this.vel.z = 0; }
  }

  insideSolid(p) {
    const hit = this.world.ground(p.x, p.z, p.y + 12, _hit, 40);
    return !!hit && hit.y > p.y + 0.02;
  }

  // Raycasts under the four wheels; fills this.wheels with their contact points and the plane through them.
  // Flat ground is probed straight down. Steep ground (a bowl wall) is probed along the board's own normal, because
  // a vertical ray cannot see a surface that is almost vertical itself.
  sampleWheels(np, heading, fromY, steep = false, trailVel = null) {
    const w = this.wheels;
    const n = this.groundNormal;
    headingVec(heading, _H);
    if (steep) {
      _sf.copy(_H).addScaledVector(n, -_H.dot(n)).normalize();
      _sr.crossVectors(_sf, n);
    } else {
      _sf.copy(_H);
      _sr.set(Math.cos(heading), 0, -Math.sin(heading));
    }
    for (let k = 0; k < 4; k++) {
      const across = (k & 1 ? 1 : -1) * BOARD.wheelHalfTrack;
      const along = (k & 2 ? 1 : -1) * BOARD.wheelHalfBase;
      _so.copy(np).addScaledVector(_sf, along).addScaledVector(_sr, across);
      if (steep) {
        _so.addScaledVector(n, WHEEL_LIFT);
        _sd.copy(n).negate();
        const c = this.world.cast(_so, _sd, WHEEL_LIFT + T.steepContact, _cast);
        w.ok[k] = !!c && c.nx * n.x + c.ny * n.y + c.nz * n.z > 0.3;
        if (w.ok[k]) { w.pts[k].copy(_so).addScaledVector(_sd, c.dist); w.nrm[k].set(c.nx, c.ny, c.nz); w.h[k] = WHEEL_LIFT - c.dist; }
      } else {
        const hit = this.world.ground(_so.x, _so.z, fromY, _hit);
        w.ok[k] = !!hit;
        if (hit) { w.pts[k].set(_so.x, hit.y, _so.z); w.nrm[k].set(hit.nx, hit.ny, hit.nz); }
      }
    }
    if (trailVel) {
      for (let k = 0; k < 4; k++) {
        const across = (k & 1 ? 1 : -1) * BOARD.wheelHalfTrack;
        const along = (k & 2 ? 1 : -1) * BOARD.wheelHalfBase;
        if (_sf.x * along * trailVel.x + _sf.z * along * trailVel.z + _sr.x * across * trailVel.x + _sr.z * across * trailVel.z < 0) w.ok[k] = false;
      }
    }
    let count = 0;
    for (let k = 0; k < 4; k++) if (w.ok[k]) count++;
    w.count = count;
    w.hasNormal = false;
    w.maxY = 0;
    if (!count) return w;

    // Three or four wheels define a plane. If that plane disagrees with the surfaces the wheels actually hit, the
    // wheels are straddling a step or an edge rather than lying on a slope: keep only the wheels on the higher surface.
    if (count >= 3) {
      this.fitPlane(w);
      _wn.set(0, 0, 0);
      for (let k = 0; k < 4; k++) if (w.ok[k]) _wn.add(w.nrm[k]);
      _wn.normalize();
      let straddling = w.normal.dot(_wn) < T.planeAgreement;
      for (let k = 0; k < 4 && !straddling; k++) if (w.ok[k] && w.nrm[k].dot(w.normal) < T.wheelAgreement) straddling = true;
      if (straddling) {
        let top = -Infinity;
        for (let k = 0; k < 4; k++) if (w.ok[k]) top = Math.max(top, w.pts[k].dot(_wn));
        count = 0;
        for (let k = 0; k < 4; k++) {
          if (w.ok[k] && w.pts[k].dot(_wn) < top - 0.08) w.ok[k] = false;
          if (w.ok[k]) count++;
        }
        w.count = count;
      } else {
        w.hasNormal = w.normal.y > 0.02 || (steep && w.normal.dot(n) > 0.5);
      }
    }
    // The three-wheel fill above wrote a made-up fourth point; the centre is the mean of the real ones.
    w.centre.set(0, 0, 0);
    let real = 0, maxY = -Infinity;
    for (let k = 0; k < 4; k++) if (w.ok[k]) { w.centre.add(w.pts[k]); real++; maxY = Math.max(maxY, w.pts[k].y); }
    w.centre.divideScalar(real);
    w.maxY = maxY;
    if (w.hasNormal && real === 3) {
      // Fourth corner by parallelogram, so the centre sits in the middle of the board, not of three wheels.
      w.centre.set(0, 0, 0);
      for (let k = 0; k < 4; k++) w.centre.add(w.pts[k]);
      w.centre.divideScalar(4);
    }
    return w;
  }

  // Plane through the wheel contacts (three valid wheels get a parallelogram fourth). Leaves the normal in w.normal.
  fitPlane(w) {
    if (w.count === 3) {
      const m = w.ok.indexOf(false);
      w.pts[m].copy(w.pts[m ^ 1]).add(w.pts[m ^ 2]).sub(w.pts[3 - m]);
    }
    _a.copy(w.pts[2]).add(w.pts[3]).sub(w.pts[0]).sub(w.pts[1]);   // rear → front
    _b.copy(w.pts[1]).add(w.pts[3]).sub(w.pts[0]).sub(w.pts[2]);   // left → right
    w.normal.crossVectors(_b, _a).normalize();
  }

  // ----- grinding --------------------------------------------------------------------------------------------
  tryGrind(np, h) {
    if (this.requireGrind && this.grindArm <= 0) return false;
    if (this.vel.y > T.catchMaxRise) return false;
    headingVec(this.heading, _H);
    let best = null, bestScore = Infinity;
    for (const path of this.paths) {
      if (path === this.lastGrindPath && this.grindCooldown > 0) continue;
      if (path.kind === 'coping' && this.passIntent) continue;      // going over the top: the coping is not a place to land
      if (!path.bounds.containsPoint(np)) continue;
      const segs = path.segments;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (seg.hLen < 0.05) continue;
        const abx = seg.b.x - seg.a.x, abz = seg.b.z - seg.a.z;
        const len2 = abx * abx + abz * abz;
        const raw = ((np.x - seg.a.x) * abx + (np.z - seg.a.z) * abz) / len2;
        const t = clamp(raw, 0, 1);
        if (Math.abs(raw - t) * Math.sqrt(len2) > 0.12) continue;
        const cx = seg.a.x + abx * t, cz = seg.a.z + abz * t;
        const d = Math.hypot(np.x - cx, np.z - cz);
        if (d > (path.kind === 'coping' ? T.stallLateral : T.slideLateral)) continue;
        const theta = Math.acos(clamp(Math.abs(_H.x * seg.dirH.x + _H.z * seg.dirH.y), 0, 1));
        let mode = null;
        if (theta <= T.grindAlign && d <= T.truckLateral) mode = 'truck';
        else if (theta >= Math.PI / 2 - T.slideAlign && d <= (path.kind === 'coping' ? T.stallLateral : T.slideLateral)) mode = 'slide';
        if (!mode) continue;
        if (mode === 'slide' && path.kind === 'coping' && this.rollingIntoPit(seg, np)) continue;
        const top = seg.a.y + (seg.b.y - seg.a.y) * t + path.topOffset;
        const dy = np.y + (mode === 'truck' ? BOARD.truckBottom : path.slideContact) - top;
        if (dy < -T.catchBelow || dy > T.catchAbove + Math.max(0, -this.vel.y * h)) continue;
        const score = d / (mode === 'truck' ? T.truckLateral : (path.kind === 'coping' ? T.stallLateral : T.slideLateral)) + Math.abs(dy) / 0.1;
        if (score < bestScore) { bestScore = score; best = { path, seg, i, t, mode, theta, d }; }
      }
    }
    if (!best) return false;
    return this.startGrind(best, np);
  }

  // Press the grind button near the top of a ramp or bowl wall and the board latches onto the coping and grinds along it: from the wall
  // while it is still rolling up, from the air, or from the deck, at whatever angle it arrives. It needs real speed along the lip
  // (arriving square-on and slow, there is nothing to grind along).
  tryCopingMagnet(np) {
    if (!this.requireGrind || this.grindArm <= 0) return false;
    headingVec(this.heading, _H);
    const reach = T.magnetReach;
    let best = null, bestScore = Infinity;
    for (const path of this.paths) {
      if (path.kind !== 'coping') continue;
      if (path === this.lastGrindPath && this.grindCooldown > 0) continue;
      const b = path.bounds;
      if (np.x < b.min.x - reach || np.x > b.max.x + reach || np.z < b.min.z - reach || np.z > b.max.z + reach) continue;
      const segs = path.segments;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (seg.hLen < 0.05) continue;
        const abx = seg.b.x - seg.a.x, abz = seg.b.z - seg.a.z;
        const len2 = abx * abx + abz * abz;
        const raw = ((np.x - seg.a.x) * abx + (np.z - seg.a.z) * abz) / len2;
        const t = clamp(raw, 0, 1);
        const d = Math.hypot(np.x - (seg.a.x + abx * t), np.z - (seg.a.z + abz * t));
        if (d > reach || Math.abs(raw - t) * Math.sqrt(len2) > 0.3) continue;
        const top = seg.a.y + (seg.b.y - seg.a.y) * t + path.topOffset;
        const dy = top - np.y;                               // + the board is below the lip
        if (dy < -T.magnetAbove || dy > T.magnetBelow) continue;
        if (Math.abs(this.vel.dot(seg.dir)) < T.magnetMinSpeed) continue;
        const score = d / reach + Math.abs(dy) / T.magnetBelow;
        if (score < bestScore) { bestScore = score; best = { path, seg, i, t, d }; }
      }
    }
    if (!best) return false;
    const theta = Math.acos(clamp(Math.abs(_H.x * best.seg.dirH.x + _H.z * best.seg.dirH.y), 0, 1));
    return this.startGrind({ ...best, mode: theta <= T.magnetTruckAngle ? 'truck' : 'slide', theta }, np);
  }

  // Which side of this stretch of coping is the drop (lower ground), as a horizontal unit vector; cached on the segment.
  pitDirection(seg) {
    if (seg.pit === undefined) {
      const mx = (seg.a.x + seg.b.x) / 2, mz = (seg.a.z + seg.b.z) / 2, y = Math.max(seg.a.y, seg.b.y);
      const px = -seg.dirH.y, pz = seg.dirH.x;
      // The ramp is the side with the steep face just inside the lip; the other side is a flat deck, or a drop. (Going by "the lower
      // side" alone picks the wrong side for a wall quarter whose far side is the lower ground outside the building.)
      const faceA = this.world.ground(mx + px * 0.3, mz + pz * 0.3, y + 1, _hit, 30);
      const steepA = faceA ? 1 - faceA.ny : 0;
      const faceB = this.world.ground(mx - px * 0.3, mz - pz * 0.3, y + 1, _hit, 30);
      const steepB = faceB ? 1 - faceB.ny : 0;
      if (Math.abs(steepA - steepB) > 0.25) {
        seg.pit = steepA > steepB ? new THREE.Vector2(px, pz) : new THREE.Vector2(-px, -pz);
        return seg.pit;
      }
      const hi = this.world.ground(mx + px * 0.7, mz + pz * 0.7, y + 1, _hit, 30);
      const lo = hi ? hi.y : -Infinity;
      const hj = this.world.ground(mx - px * 0.7, mz - pz * 0.7, y + 1, _hit, 30);
      const lo2 = hj ? hj.y : -Infinity;
      seg.pit = lo === lo2 ? null : (lo < lo2 ? new THREE.Vector2(px, pz) : new THREE.Vector2(-px, -pz));
    }
    return seg.pit;
  }

  // Heading over the coping towards the drop is a drop-in (or an air coming down onto the deck side), not something to stall on.
  rollingIntoPit(seg, np) {
    const pit = this.pitDirection(seg);
    if (!pit) return false;
    return this.vel.x * pit.x + this.vel.z * pit.y > T.stallIntoPit;
  }

  startGrind({ path, seg, i, t, mode, theta, d }, np) {
    const s = seg.start + t * seg.length;
    let gs = this.vel.dot(seg.dir);
    // Square-on to coping and nearly stopped is not a failed grind, it is an axle stall (rock to fakie).
    const stall = mode === 'slide' && path.kind === 'coping' && Math.abs(gs) < T.grindMinSpeed;
    if (Math.abs(gs) < T.grindMinSpeed && !stall) return false;
    // Dropping back onto a coping while barely moving along it is not a boardslide (it crawled along the lip until the balance meter dumped you).
    if (!stall && path.kind === 'coping' && mode === 'slide' && Math.abs(gs) < T.copingSlideMinSpeed) return false;
    // No axle stalls: arriving at a coping almost stopped just rolls you back in. (Catching it made the board sit on the lip, perched
    // on its front wheels, until it rocked out or sank into the ramp; nobody wanted that.)
    if (stall) return false;
    // A stall is something you do at the top of a climb; falling back past the coping at speed is not it.
    if (stall && (Math.abs(this.vel.y) > T.stallMaxVertical || this.holdFwd > T.stallBlockHold)) return false;
    // The way back in is the way we came: against the part of our motion that was square to the coping.
    let backX = 0, backZ = 0;
    if (stall) {
      gs = 0;
      _tmp.set(this.vel.x, 0, this.vel.z);
      _P.set(seg.dir.x, 0, seg.dir.z).normalize();
      _tmp.addScaledVector(_P, -_tmp.dot(_P));
      if (_tmp.lengthSq() > 1e-4) { _tmp.normalize(); backX = -_tmp.x; backZ = -_tmp.z; }
      // On a ramp lip the way back in is down into the pit, whichever way we were drifting when it caught (catching it already
      // rolling back would otherwise rock you out over the deck).
      const pit = this.pitDirection(seg);
      if (pit) { backX = pit.x; backZ = pit.y; }
    }
    // Pick the board orientation on the rail closest to how we arrived, then see how sloppy the entry was.
    const pathYaw = yawOf(seg.dir.x, seg.dir.z);
    const options = mode === 'truck' ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
    let offset = options[0], bestDiff = Infinity;
    for (const o of options) {
      const diff = Math.abs(wrap(pathYaw + o - this.heading));
      if (diff < bestDiff) { bestDiff = diff; offset = o; }
    }
    const g = {
      path, mode, s, gs, time: 0, yawOffset: offset, stall,
      back: new THREE.Vector3(),
      bal: 0, balVel: 0, p1: this.random() * TAU, p2: this.random() * TAU,
      variant: 0, vb: 0, vTime: { nose: 0, tail: 0 },
      snap: new THREE.Vector3(), name: ''
    };
    // The stick held up or down as you land on the rail starts you in the nosegrind or 5-0.
    if (mode === 'truck' && !stall) g.variant = g.vb = this.variantFor(0);
    this.mode = Mode.GRIND;
    this.grind = g;
    this.grindArm = 0;
    if (this.flip || this.shuv) {
      const credit = this.trickCredit();
      if (this.shuv && Math.abs(this.shuv.angle) > Math.PI / 2) this.commitShuv();
      this.endFlip();
      if (credit) this.onEvent('flip', { name: credit });
    }
    this.vel.copy(seg.dir).multiplyScalar(gs);
    this.spinVel = 0;
    this.braking = false;

    // Where the board would sit if it were already perfectly on the rail, to blend the catch instead of teleporting.
    this.placeOnRail(g, 0);
    g.snap.copy(np).sub(this.pos);
    // Sloppy entries start the meter off-centre: lateral error and angle error both count.
    const limit = mode === 'truck' ? T.truckLateral : (path.kind === 'coping' ? T.stallLateral : T.slideLateral);
    const angleLimit = mode === 'truck' ? T.grindAlign : T.slideAlign;
    const dev = mode === 'truck' ? theta : Math.PI / 2 - theta;
    _tmp.set(np.x - (seg.a.x + (seg.b.x - seg.a.x) * t), 0, np.z - (seg.a.z + (seg.b.z - seg.a.z) * t));
    const lateral = _tmp.dot(g.tilt);
    const angSide = Math.sign(wrap(pathYaw + offset - this.heading)) || 1;
    g.bal = clamp(T.balEntryScale * (0.6 * (lateral / limit) + 0.4 * angSide * (dev / angleLimit)), -0.85, 0.85);
    g.name = stall ? 'Axle Stall' : `${path.kind === 'coping' ? 'Coping ' : ''}${mode === 'truck' ? '50-50' : 'Boardslide'}`;
    g.back.set(backX, 0, backZ);
    this.pos.copy(np);
    this.placeOnRail(g, 0);
    this.pos.add(g.snap);
    this.lastGrindPath = path;
    this.onEvent('grindStart', { name: g.name, kind: path.kind, mode, pathName: path.name, speed: Math.abs(gs) });
    return true;
  }

  // Sets this.pos / this.up / this.heading targets for the current grind state; slew is the heading rate limit.
  placeOnRail(g, h) {
    const path = g.path;
    const seg = path.segmentAt(g.s);
    const target = wrap(yawOf(seg.dir.x, seg.dir.z) + g.yawOffset);
    if (h > 0) {
      const diff = wrap(target - this.heading);
      this.heading = wrap(this.heading + clamp(diff, -T.grindAlignRate * h, T.grindAlignRate * h));
    }
    headingVec(this.heading, _H);
    path.pointAt(g.s, _P);
    _P.y += path.topOffset;

    // Board attitude: lie along the rail's slope for a 50-50, stay level for a boardslide.
    _F.set(-Math.sin(this.facingYaw), 0, -Math.cos(this.facingYaw));
    let truckShift = 0;
    if (g.mode === 'truck') {
      const phi = Math.atan2(seg.dir.y, Math.max(seg.hLen, 1e-6));
      const forwardSign = Math.abs(wrap(yawOf(seg.dir.x, seg.dir.z) - this.heading)) < Math.PI / 2 ? 1 : -1;
      _f.set(_H.x * Math.cos(phi), forwardSign * Math.sin(phi), _H.z * Math.cos(phi)).normalize();
      _R.crossVectors(_f, UP).normalize();
      _u.crossVectors(_R, _f).normalize();
      g.tilt = (g.tilt || new THREE.Vector3()).copy(_R).multiplyScalar(Math.sign(_R.dot(_F)) || 1);
      // Nosegrind (vb > 0): pitched nose-down onto the front truck; 5-0 (vb < 0): nose up onto the back one.
      const a = g.vb * T.variantTilt;
      if (a) {
        _a.copy(_u).multiplyScalar(Math.cos(a)).addScaledVector(_f, Math.sin(a));
        _b.copy(_f).multiplyScalar(Math.cos(a)).addScaledVector(_u, -Math.sin(a));
        _u.copy(_a); _f.copy(_b);
        truckShift = g.vb * BOARD.wheelHalfBase;
      }
    } else {
      _u.copy(UP);
      const playerRight = _t.crossVectors(_F, UP);
      g.tilt = (g.tilt || new THREE.Vector3()).copy(_H).multiplyScalar(Math.sign(_H.dot(playerRight)) || 1);
    }
    const rho = clamp(g.bal, -1, 1) * T.balMaxTilt;
    g.u = (g.u || new THREE.Vector3()).copy(_u).multiplyScalar(Math.cos(rho)).addScaledVector(g.tilt, Math.sin(rho)).normalize();
    const contact = g.mode === 'truck' ? BOARD.truckBottom : path.slideContact;
    this.pos.copy(_P).addScaledVector(g.u, -contact);
    // The rail is under one truck, so the middle of the board is behind it (nosegrind) or ahead of it (5-0).
    if (truckShift) this.pos.addScaledVector(_f, -truckShift);
  }

  // Stick up is the nose on the rail, down is the tail; between the two thresholds it stays as it was.
  variantFor(current) {
    if (this.drive > T.variantStick) return 1;
    if (this.drive < -T.variantStick) return -1;
    return Math.abs(this.drive) < T.variantRelease ? 0 : current;
  }

  grindName(g) {
    const { nose, tail } = g.vTime;
    const prefix = g.path.kind === 'coping' ? 'Coping ' : '';
    if (Math.max(nose, tail) < T.variantMinTime) return `${prefix}50-50`;
    return `${prefix}${nose >= tail ? 'Nosegrind' : '5-0 Grind'}`;
  }

  grindStep(h) {
    const g = this.grind;
    const path = g.path;
    g.time += h;

    if (this.popRequest !== null) {
      const speed = (T.popMin + (T.popMax - T.popMin) * this.popRequest) * (g.stall ? T.stallPopScale : 0.9);
      this.popRequest = null;
      this.endGrind('pop', speed);
      return;
    }

    // Rolled up to the top of a ramp and stopped on the coping: a held stall rocks back in by itself rather than freezing until the
    // balance meter dumps you.
    if (g.stall && g.time > T.stallAutoRock) {
      this.endGrind('rock', T.popMin * T.stallPopScale);
      return;
    }

    if (g.mode === 'truck' && !g.stall) {
      g.variant = this.variantFor(g.variant);
      g.vb += (g.variant - g.vb) * (1 - Math.exp(-T.variantResponse * h));
      if (g.variant) g.vTime[g.variant > 0 ? 'nose' : 'tail'] += h;
      g.name = this.grindName(g);
    }

    // Speed along the rail: gravity on sloped rails, friction on everything.
    const seg = path.segmentAt(g.s);
    if (!g.stall) {
      g.gs += -T.gravity * seg.dir.y * h;
      const fric = path.friction * (1 + T.variantDrag * Math.abs(g.vb)) * h;
      g.gs -= Math.sign(g.gs) * Math.min(Math.abs(g.gs), fric);
      g.s += g.gs * h;
    }
    this.rollSpeed = g.gs;

    if (path.closed) {
      g.s = ((g.s % path.length) + path.length) % path.length;
    } else if (g.s <= 0 || g.s >= path.length) {
      g.s = clamp(g.s, 0, path.length);
      this.placeOnRail(g, h);
      this.endGrind('end', 0);
      return;
    }
    if (!g.stall && Math.abs(g.gs) < T.grindStallSpeed) {
      this.endGrind('stall', 0);
      return;
    }
    // A coping slide that has slowed to a crawl drops you back into the pit instead of creeping along the lip.
    if (!g.stall && path.kind === 'coping' && Math.abs(g.gs) < T.copingSlideEnd) {
      const pit = this.pitDirection(path.segmentAt(g.s));
      this.endGrind('stall', 0);
      if (pit) {
        // Face the way you are going (down the wall), not along the lip, so the landing on the wall is a clean one.
        this.vel.x = pit.x * T.copingDropIn; this.vel.z = pit.y * T.copingDropIn;
        this.heading = yawOf(pit.x, pit.y);
        this.spinVel = 0;
      }
      return;
    }

    // Balance: left unattended the board leans over and falls off; a push from the hands pushes the lean back.
    const instab = Math.min(T.balInstab0 + T.balInstabGrow * g.time, T.balInstabMax) * (1 + (T.variantHard - 1) * Math.abs(g.vb));
    const wobble = T.balWobble * (0.6 * Math.sin(2.3 * g.time + g.p1) + 0.4 * Math.sin(5.7 * g.time + g.p2));
    const acc = instab * g.bal + wobble + T.balControl * this.lean - T.balDamp * g.balVel;
    g.balVel += acc * h;
    g.bal += g.balVel * h;
    if (Math.abs(g.bal) >= 1) {
      g.bal = Math.sign(g.bal);
      this.bail('balance');
      return;
    }

    this.placeOnRail(g, h);
    g.snap.multiplyScalar(Math.exp(-18 * h));
    this.pos.add(g.snap);
    const cur = path.segmentAt(g.s);
    this.vel.copy(cur.dir).multiplyScalar(g.gs);
  }

  endGrind(reason, popSpeed) {
    const g = this.grind;
    const seg = g.path.segmentAt(g.s);
    this.vel.copy(seg.dir).multiplyScalar(g.gs);
    this.launchE = 0.5 * this.vel.lengthSq() + T.gravity * this.pos.y;
    this.passIntent = popSpeed > 0;
    if (popSpeed > 0) this.vel.y += popSpeed;
    if (g.stall && popSpeed > 0) this.vel.addScaledVector(g.back, T.stallBackSpeed);
    this.mode = Mode.AIR;
    this.rolledOff = false;
    this.airTime = 0;
    this.exitAlign = T.exitAlignTime;
    this.grindCooldown = g.stall ? T.stallCooldown : T.grindCooldown;
    this.lastGrindPath = g.path;
    this.popTimer = popSpeed > 0 ? 0 : 99;
    if (popSpeed > 0) this.crouch = -RIDER.popRebound;
    this.grind = null;
    this.onEvent('grindEnd', { reason, name: g.name, time: g.time });
  }

  // ----- bail ------------------------------------------------------------------------------------------------
  bail(reason) {
    if (this.mode === Mode.BAIL) return;
    this.manual = null;
    this.manualQueue = null;
    if (this.grind) this.grind = null;
    this.mode = Mode.BAIL;
    this.bailTime = 0;
    this.braking = false;
    this.bailBoard = {
      pos: this.pos.clone(),
      vel: this.vel.clone().multiplyScalar(0.8).add(new THREE.Vector3((this.random() - 0.5) * 3, 2.5 + this.random() * 2, (this.random() - 0.5) * 3)),
      spin: new THREE.Vector3((this.random() - 0.5) * 14, (this.random() - 0.5) * 10, (this.random() - 0.5) * 14),
      quat: this.boardQuaternion(new THREE.Quaternion())
    };
    this.endFlip();
    this.flipArm = 0;
    this.onEvent('bail', { reason });
  }

  bailStep(dt) {
    this.bailTime += dt;
    // The rider skids to a stop; the board tumbles off on its own.
    this.vel.multiplyScalar(Math.exp(-2.6 * dt));
    _np.copy(this.pos).addScaledVector(this.vel, dt);
    const g = this.world.ground(_np.x, _np.z, this.pos.y + 0.5, _hit);
    if (g && g.y <= this.pos.y + 0.3) { this.pos.set(_np.x, g.y, _np.z); }
    const b = this.bailBoard;
    if (b) {
      b.vel.y -= T.gravity * dt;
      b.pos.addScaledVector(b.vel, dt);
      const gb = this.world.ground(b.pos.x, b.pos.z, b.pos.y + 0.6, _hit);
      const floor = gb ? gb.y : this.pos.y;
      if (b.pos.y < floor) {
        b.pos.y = floor;
        if (b.vel.y < -1) b.vel.y *= -0.3; else b.vel.y = 0;
        b.vel.x *= 0.7; b.vel.z *= 0.7; b.spin.multiplyScalar(0.6);
      }
      _q.setFromEuler(new THREE.Euler(b.spin.x * dt, b.spin.y * dt, b.spin.z * dt));
      b.quat.premultiply(_q);
    }
    if (this.bailTime >= T.bailTime) this.respawn(this.safe);
  }

  // ----- display ---------------------------------------------------------------------------------------------
  updateVisuals(dt) {
    if (this.mode === Mode.GRIND && this.grind) this.up.copy(this.grind.u);
    else if (this.mode === Mode.GROUND) {
      let lift = 0;
      _u.copy(this.groundNormal);
      if (this.manual) {
        // The board rocks back (or forward) onto one pair of wheels; the rider's world rocks with it.
        const a = this.manual.pitchSign * (T.manualTilt + this.manual.bal * T.manualMaxTilt);
        headingVec(this.heading, _H);
        _f.copy(_H).addScaledVector(this.groundNormal, -_H.dot(this.groundNormal)).normalize();
        _u.multiplyScalar(Math.cos(a)).addScaledVector(_f, -Math.sin(a));
        lift = BOARD.wheelHalfBase * Math.abs(Math.sin(a));
      }
      this.manualLift = damp(this.manualLift, lift, 14, dt);
      this.up.lerp(_u, 1 - Math.exp(-30 * dt)).normalize();
    }
    else if (this.mode === Mode.AIR) {
      // Keep the tilt we left the surface with; ease towards what is below, faster as it gets close.
      const f = this.airFloor;
      let rate = T.airTiltFar;
      if (f.found) {
        _u.set(f.nx, f.ny, f.nz);
        rate += (T.airTiltNear - T.airTiltFar) * clamp(1 - (this.pos.y - f.y) / T.airTiltReach, 0, 1);
      } else _u.copy(UP);
      this.up.lerp(_u, 1 - Math.exp(-rate * dt)).normalize();
    } else this.up.lerp(UP, 1 - Math.exp(-1.6 * dt)).normalize();

    if (this.mode !== Mode.GROUND) this.manualLift = damp(this.manualLift, 0, 14, dt);

    if (this.mode === Mode.AIR && this.popTimer < T.popAnimTime) {
      this.visPitch = 0.5 * Math.sin(Math.PI * this.popTimer / T.popAnimTime);
    } else {
      this.visPitch = damp(this.visPitch, 0, 12, dt);
    }
    this.visRoll = damp(this.visRoll, this.mode === Mode.GROUND ? -this.carve * 0.16 : 0, 12, dt);

    const target = this.jumpHeld ? RIDER.crouchHold : 0;
    this.crouch = damp(this.crouch, target, RIDER.crouchSettle, dt);
  }

  // The board's orientation. With `flair` the pop pitch and carve roll are included (the model); without it this is the
  // frame the rider is bolted to: heading plus whatever surface (or grind tilt) the board is lying on.
  boardQuaternion(out, flair = true, up = this.up) {
    headingVec(this.heading, _H);
    _R.crossVectors(_H, up);
    if (_R.lengthSq() < 1e-8) _R.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    _R.normalize();
    _f.crossVectors(up, _R);
    _basisM.makeBasis(_R, up, _f.negate());
    out.setFromRotationMatrix(_basisM);
    if (flair) {
      out.multiply(_qPitch.setFromAxisAngle(AXIS_X, this.visPitch));
      if (this.shuvYaw) out.multiply(_qYaw.setFromAxisAngle(AXIS_Y, this.shuvYaw)); // spins flat, then the flip rolls about the board's own length
      out.multiply(_qRoll.setFromAxisAngle(AXIS_Z, this.visRoll + this.flipRoll));
    }
    return out;
  }
}
