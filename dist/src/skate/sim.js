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

const _H = new THREE.Vector3(), _R = new THREE.Vector3(), _f = new THREE.Vector3(), _lat = new THREE.Vector3();
const _gt = new THREE.Vector3(), _np = new THREE.Vector3(), _n = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _probe = new THREE.Vector3(), _P = new THREE.Vector3(), _u = new THREE.Vector3();
const _F = new THREE.Vector3(), _t = new THREE.Vector3(), _basisM = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _hit = { y: 0, nx: 0, ny: 1, nz: 0 };
const _cast = { dist: 0, nx: 0, ny: 1, nz: 0 };
const _sf = new THREE.Vector3(), _sr = new THREE.Vector3(), _so = new THREE.Vector3(), _sd = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _wn = new THREE.Vector3();
const WHEEL_LIFT = 0.3;
const _qPitch = new THREE.Quaternion(), _qRoll = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);

// The skater is the board: position is where the wheels meet the ground, heading is which way the nose points.
// The rider is placed over it by the view layer. Everything runs in fixed-ish substeps so frame rate does not change the feel.
export class Skater {
  constructor({ world, paths = [], onEvent = () => {}, random = Math.random }) {
    this.world = world;
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

    this.steer = 0; this.drive = 0;
    this.jumpWas = false; this.crouchTime = 0; this.popRequest = null; this.popBuffer = 0;
    this.pushCool = 0; this.pushPending = 0; this.braking = false;
    this.spinVel = 0; this.exitAlign = 0;
    this.popTimer = 99; this.visPitch = 0; this.visRoll = 0; this.carve = 0;
    this.crouch = 0; this.rollSpeed = 0; this.groundedTime = 0; this.airTime = 0;
    this.grind = null; this.lastGrindPath = null; this.grindCooldown = 0;
    this.bailTime = 0; this.bailBoard = null;
    this.safe = { pos: new THREE.Vector3(), heading: 0 };
    this.spawn = { pos: new THREE.Vector3(), heading: 0 };
    this.wheels = { pts: [0, 1, 2, 3].map(() => new THREE.Vector3()), nrm: [0, 1, 2, 3].map(() => new THREE.Vector3()), ok: [false, false, false, false], count: 0, maxY: 0, centre: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), hasNormal: false };
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
    this.pushCool = 0; this.pushPending = 0; this.crouch = 0; this.popRequest = null;
    this.safe.pos.copy(where.pos); this.safe.heading = where.heading;
    this.onEvent('respawn');
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get facingYaw() { return this.heading + this.faceOffset; }

  // ----- per-frame entry point -------------------------------------------------------------------------------
  update(input, dt) {
    if (!(dt > 0)) return;
    this.steer = damp(this.steer, clamp(input.steer || 0, -1, 1), 20, dt);
    this.drive = clamp(input.drive || 0, -1, 1);

    const jump = !!input.jump;
    if (jump && !this.jumpWas) { this.crouchTime = 0; this.crouch = Math.max(this.crouch, RIDER.crouchPress); this.onEvent('crouch'); }
    if (jump) this.crouchTime = Math.min(this.crouchTime + dt, 1);
    if (!jump && this.jumpWas) {
      this.popRequest = clamp(this.crouchTime / T.popChargeTime, 0, 1);
      this.popBuffer = 0.08;
    }
    this.jumpWas = jump;
    this.jumpHeld = jump;
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
    }
    this.updateVisuals(dt);
  }

  // ----- ground ----------------------------------------------------------------------------------------------
  groundStep(h) {
    this.groundedTime += h;
    const u = this.groundNormal;
    headingVec(this.heading, _H);
    _f.copy(_H).addScaledVector(u, -_H.dot(u)).normalize();
    let s = this.vel.dot(_f);

    if (this.popRequest !== null) { this.pop(this.popRequest); return; }

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
    if (this.drive > T.driveThreshold && this.pushCool <= 0 && s < T.pushMaxSpeed) {
      this.pushPending += T.pushImpulse * clamp(1 - Math.max(s, 0) / T.pushMaxSpeed, 0.12, 1);
      this.pushCool = T.pushInterval;
      this.onEvent('push', { speed: s });
    }
    if (this.pushPending > 0) {
      const give = Math.min(this.pushPending, T.pushDrain * h);
      s += give;
      this.pushPending -= give;
    }
    if (this.drive < -T.driveThreshold && Math.abs(s) > 0.05) {
      this.braking = true;
      s -= Math.sign(s) * Math.min(Math.abs(s), T.brakeDecel * h);
    }
    const sp = Math.abs(s);
    if (sp > 0) s -= Math.sign(s) * Math.min(sp, (T.rollFriction + T.airDrag * sp * sp) * h);

    // Steering: trucks need roll speed to bite, so almost-stopped turning is a slow tail pivot.
    const bite = clamp(sp / T.steerSpeedRef, 0, 1);
    const maxRate = Math.min(T.maxYawRate, T.maxLateralAccel / Math.max(sp, 1.6));
    this.heading = wrap(this.heading - this.steer * (maxRate * bite * (s >= 0 ? 1 : -1) + T.pivotRate * (1 - bite)) * h);
    this.carve = damp(this.carve, this.steer * clamp(sp / 6, 0, 1), 10, h);

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
      // Rays along the normal only report wheels that are actually touching.
      if (w.count < 3) { this.pos.copy(np); this.leaveGround(); return; }
      this.pos.copy(w.centre);
      if (w.hasNormal) this.groundNormal.copy(w.normal);
      this.projectVelocity(this.groundNormal);
      return;
    }
    const hStep = Math.hypot(this.vel.x, this.vel.z) * h;
    const expected = oldY + Math.max(this.vel.y, 0) * h;
    if (w.centre.y - expected > T.maxStep + hStep * T.maxSlopeTan) { this.hitWall(null); return; }
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
    this.groundedTime = 0;
    this.braking = false;
  }

  pop(charge) {
    const speed = T.popMin + (T.popMax - T.popMin) * clamp(charge, 0, 1);
    this.vel.addScaledVector(this.groundNormal, speed);
    this.popRequest = null;
    this.popTimer = 0;
    this.crouch = -RIDER.popRebound;
    this.pos.addScaledVector(this.groundNormal, 0.012); // lift off so the ground check does not re-catch us
    this.leaveGround();
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
    const spinTarget = -spinInput * T.airSpinRate;
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

    _np.copy(this.pos).addScaledVector(this.vel, h);
    this.clampBounds(_np);

    if (this.tryGrind(_np, h)) return;

    const w = this.sampleWheels(_np, this.heading, Math.max(this.pos.y, _np.y) + 0.5, false);
    if (!w.count) {
      if (this.insideSolid(_np)) { this.hitWall(null); this.pos.y = _np.y; return; }
      this.pos.copy(_np);
      return;
    }
    const pen = w.maxY - _np.y;
    if (pen > 0) {
      const hStep = Math.hypot(this.vel.x, this.vel.z) * h;
      const slope = w.hasNormal ? clamp(Math.sqrt(Math.max(0, 1 - w.normal.y * w.normal.y)) / Math.max(w.normal.y, 0.17), 0, T.maxSlopeTan) : 0;
      const allowed = Math.max(0, -this.vel.y * h) + 0.04 + hStep * slope;
      const rising = this.vel.dot(w.hasNormal ? w.normal : UP) > 0.6 && this.popTimer < 0.12;
      if (pen > allowed && !rising) {
        // The side of something, not its top.
        this.pos.y = _np.y;
        this.hitWall(null);
        return;
      }
      if (!rising) {
        this.pos.set(_np.x, w.centre.y, _np.z);
        this.land(w);
        return;
      }
    }
    this.pos.copy(_np);
  }

  land(w) {
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
    this.mode = Mode.GROUND;
    this.groundedTime = 0;
    this.spinVel = 0;
    this.visPitch *= 0.4;
    this.crouch = RIDER.landCompress * clamp(impact / 6, 0.25, 1.3);
    this.onEvent('land', { impact });
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
    const b = T.bounds;
    if (np.x > b.x) { np.x = b.x; if (this.vel.x > 0) this.vel.x = 0; }
    if (np.x < -b.x) { np.x = -b.x; if (this.vel.x < 0) this.vel.x = 0; }
    if (np.z > b.z) { np.z = b.z; if (this.vel.z > 0) this.vel.z = 0; }
    if (np.z < -b.z) { np.z = -b.z; if (this.vel.z < 0) this.vel.z = 0; }
  }

  insideSolid(p) {
    const hit = this.world.ground(p.x, p.z, p.y + 12, _hit, 40);
    return !!hit && hit.y > p.y + 0.02;
  }

  // Raycasts under the four wheels; fills this.wheels with their contact points and the plane through them.
  // Flat ground is probed straight down. Steep ground (a bowl wall) is probed along the board's own normal, because
  // a vertical ray cannot see a surface that is almost vertical itself.
  sampleWheels(np, heading, fromY, steep = false) {
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
        const c = this.world.cast(_so, _sd, WHEEL_LIFT + T.snapDistance, _cast);
        w.ok[k] = !!c && c.nx * n.x + c.ny * n.y + c.nz * n.z > 0.3;
        if (w.ok[k]) { w.pts[k].copy(_so).addScaledVector(_sd, c.dist); w.nrm[k].set(c.nx, c.ny, c.nz); }
      } else {
        const hit = this.world.ground(_so.x, _so.z, fromY, _hit);
        w.ok[k] = !!hit;
        if (hit) { w.pts[k].set(_so.x, hit.y, _so.z); w.nrm[k].set(hit.nx, hit.ny, hit.nz); }
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
      if (w.normal.dot(_wn) < T.planeAgreement) {
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
    if (this.vel.y > T.catchMaxRise) return false;
    headingVec(this.heading, _H);
    let best = null, bestScore = Infinity;
    for (const path of this.paths) {
      if (path === this.lastGrindPath && this.grindCooldown > 0) continue;
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
        if (d > T.slideLateral) continue;
        const theta = Math.acos(clamp(Math.abs(_H.x * seg.dirH.x + _H.z * seg.dirH.y), 0, 1));
        let mode = null;
        if (theta <= T.grindAlign && d <= T.truckLateral) mode = 'truck';
        else if (theta >= Math.PI / 2 - T.slideAlign && d <= T.slideLateral) mode = 'slide';
        if (!mode) continue;
        const top = seg.a.y + (seg.b.y - seg.a.y) * t + path.topOffset;
        const dy = np.y + (mode === 'truck' ? BOARD.truckBottom : path.slideContact) - top;
        if (dy < -T.catchBelow || dy > T.catchAbove + Math.max(0, -this.vel.y * h)) continue;
        const score = d / (mode === 'truck' ? T.truckLateral : T.slideLateral) + Math.abs(dy) / 0.1;
        if (score < bestScore) { bestScore = score; best = { path, seg, i, t, mode, theta, d }; }
      }
    }
    if (!best) return false;
    return this.startGrind(best, np);
  }

  startGrind({ path, seg, i, t, mode, theta, d }, np) {
    const s = seg.start + t * seg.length;
    let gs = this.vel.dot(seg.dir);
    if (Math.abs(gs) < T.grindMinSpeed) return false;
    // Pick the board orientation on the rail closest to how we arrived, then see how sloppy the entry was.
    const pathYaw = yawOf(seg.dir.x, seg.dir.z);
    const options = mode === 'truck' ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
    let offset = options[0], bestDiff = Infinity;
    for (const o of options) {
      const diff = Math.abs(wrap(pathYaw + o - this.heading));
      if (diff < bestDiff) { bestDiff = diff; offset = o; }
    }
    const g = {
      path, mode, s, gs, time: 0, yawOffset: offset,
      bal: 0, balVel: 0, p1: this.random() * TAU, p2: this.random() * TAU,
      snap: new THREE.Vector3(), name: ''
    };
    this.mode = Mode.GRIND;
    this.grind = g;
    this.vel.copy(seg.dir).multiplyScalar(gs);
    this.spinVel = 0;
    this.braking = false;

    // Where the board would sit if it were already perfectly on the rail, to blend the catch instead of teleporting.
    this.placeOnRail(g, 0);
    g.snap.copy(np).sub(this.pos);
    // Sloppy entries start the meter off-centre: lateral error and angle error both count.
    const limit = mode === 'truck' ? T.truckLateral : T.slideLateral;
    const angleLimit = mode === 'truck' ? T.grindAlign : T.slideAlign;
    const dev = mode === 'truck' ? theta : Math.PI / 2 - theta;
    _tmp.set(np.x - (seg.a.x + (seg.b.x - seg.a.x) * t), 0, np.z - (seg.a.z + (seg.b.z - seg.a.z) * t));
    const lateral = _tmp.dot(g.tilt);
    const angSide = Math.sign(wrap(pathYaw + offset - this.heading)) || 1;
    g.bal = clamp(T.balEntryScale * (0.6 * (lateral / limit) + 0.4 * angSide * (dev / angleLimit)), -0.85, 0.85);
    g.name = `${path.kind === 'coping' ? 'Coping ' : ''}${mode === 'truck' ? '50-50' : 'Boardslide'}`;
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
    if (g.mode === 'truck') {
      const phi = Math.atan2(seg.dir.y, Math.max(seg.hLen, 1e-6));
      const forwardSign = Math.abs(wrap(yawOf(seg.dir.x, seg.dir.z) - this.heading)) < Math.PI / 2 ? 1 : -1;
      _f.set(_H.x * Math.cos(phi), forwardSign * Math.sin(phi), _H.z * Math.cos(phi)).normalize();
      _R.crossVectors(_f, UP).normalize();
      _u.crossVectors(_R, _f).normalize();
      g.tilt = (g.tilt || new THREE.Vector3()).copy(_R).multiplyScalar(Math.sign(_R.dot(_F)) || 1);
    } else {
      _u.copy(UP);
      const playerRight = _t.crossVectors(_F, UP);
      g.tilt = (g.tilt || new THREE.Vector3()).copy(_H).multiplyScalar(Math.sign(_H.dot(playerRight)) || 1);
    }
    const rho = clamp(g.bal, -1, 1) * T.balMaxTilt;
    g.u = (g.u || new THREE.Vector3()).copy(_u).multiplyScalar(Math.cos(rho)).addScaledVector(g.tilt, Math.sin(rho)).normalize();
    const contact = g.mode === 'truck' ? BOARD.truckBottom : path.slideContact;
    this.pos.copy(_P).addScaledVector(g.u, -contact);
  }

  grindStep(h) {
    const g = this.grind;
    const path = g.path;
    g.time += h;

    if (this.popRequest !== null) {
      const speed = (T.popMin + (T.popMax - T.popMin) * this.popRequest) * 0.9;
      this.popRequest = null;
      this.endGrind('pop', speed);
      return;
    }

    // Speed along the rail: gravity on sloped rails, friction on everything.
    const seg = path.segmentAt(g.s);
    g.gs += -T.gravity * seg.dir.y * h;
    const fric = path.friction * h;
    g.gs -= Math.sign(g.gs) * Math.min(Math.abs(g.gs), fric);
    g.s += g.gs * h;
    this.rollSpeed = g.gs;

    if (path.closed) {
      g.s = ((g.s % path.length) + path.length) % path.length;
    } else if (g.s <= 0 || g.s >= path.length) {
      g.s = clamp(g.s, 0, path.length);
      this.placeOnRail(g, h);
      this.endGrind('end', 0);
      return;
    }
    if (Math.abs(g.gs) < T.grindStallSpeed) {
      this.endGrind('stall', 0);
      return;
    }

    // Balance: left unattended the board leans over and falls off; the stick pushes the lean back.
    const instab = Math.min(T.balInstab0 + T.balInstabGrow * g.time, T.balInstabMax);
    const wobble = T.balWobble * (0.6 * Math.sin(2.3 * g.time + g.p1) + 0.4 * Math.sin(5.7 * g.time + g.p2));
    const acc = instab * g.bal + wobble + T.balControl * this.steer - T.balDamp * g.balVel;
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
    if (popSpeed > 0) this.vel.y += popSpeed;
    this.mode = Mode.AIR;
    this.airTime = 0;
    this.exitAlign = T.exitAlignTime;
    this.grindCooldown = T.grindCooldown;
    this.lastGrindPath = g.path;
    this.popTimer = popSpeed > 0 ? 0 : 99;
    if (popSpeed > 0) this.crouch = -RIDER.popRebound;
    this.grind = null;
    this.onEvent('grindEnd', { reason, name: g.name, time: g.time });
  }

  // ----- bail ------------------------------------------------------------------------------------------------
  bail(reason) {
    if (this.mode === Mode.BAIL) return;
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
    else if (this.mode === Mode.GROUND) this.up.lerp(this.groundNormal, 1 - Math.exp(-30 * dt)).normalize();
    else this.up.lerp(UP, 1 - Math.exp(-1.6 * dt)).normalize();

    if (this.mode === Mode.AIR && this.popTimer < T.popAnimTime) {
      this.visPitch = 0.5 * Math.sin(Math.PI * this.popTimer / T.popAnimTime);
    } else {
      this.visPitch = damp(this.visPitch, 0, 12, dt);
    }
    this.visRoll = damp(this.visRoll, this.mode === Mode.GROUND ? -this.carve * 0.16 : 0, 12, dt);

    const target = this.jumpHeld ? RIDER.crouchHold : 0;
    this.crouch = damp(this.crouch, target, RIDER.crouchSettle, dt);
  }

  boardQuaternion(out) {
    headingVec(this.heading, _H);
    _R.crossVectors(_H, this.up).normalize();
    _f.crossVectors(this.up, _R);
    _basisM.makeBasis(_R, this.up, _f.negate());
    out.setFromRotationMatrix(_basisM);
    out.multiply(_qPitch.setFromAxisAngle(AXIS_X, this.visPitch));
    out.multiply(_qRoll.setFromAxisAngle(AXIS_Z, this.visRoll));
    return out;
  }
}
