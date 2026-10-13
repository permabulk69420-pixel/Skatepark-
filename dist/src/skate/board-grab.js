import * as THREE from 'three';
import { createHandleHold } from './handle-hold.js';
import { pulseHaptics } from './haptics.js';
import { BOARD_OFF, judgeCatch } from './board-off.js';

// Grabbing the board in the air (from Sandboarding's board-grab.js). Squeeze a grip button with your hand anywhere near the board and
// the board comes up to meet it (as if you'd tucked your knees), then your hand closes on the nearest edge: the nose, the tail, or
// either side in the middle of the deck. Which hand on which part names the grab. The grab lets go when you let go of the grip, or
// when the board touches down, lands on a rail or bails. The physics never changes; the board and hands only move for the eye.
// No scoring yet: the name and how long you held it are reported through `onEvent` ('grabStart', 'grabEnd').
//
// The hand itself is fitted onto the edge by the Oasis handle hold (handle-hold.js): the edge is a very thin handle, and the palm is
// turned to face the middle of the deck.

export const GRAB = Object.freeze({
  squeezeOn: 0.6, // grip button travel that starts a grab...
  squeezeOff: 0.35, // ...and that ends one (a little lower, so it doesn't flicker)
  maxLift: 0.45, // metres the board can come up toward your hand (a tuck of the knees, not a yank across the room)
  reach: 0.15, // and how far your hand can still be from the edge after that: so your hand has to be within 0.6 m of the part you grab
  follow: 16, // per second: how quickly the board comes up (and settles back when you let go)
  between: 0.17, // side grabs sit in the middle of the deck, within this of its centre
  plate: Object.freeze({ thickness: 0.016, width: 0.1 }), // the edge is held as a plate this thick (the deck), the fingers on one face
});

const names = {
  nose: () => 'Nose grab', tail: () => 'Tail grab',
  right: hand => (hand === 'right' ? 'Indy' : 'Stalefish'),
  left: hand => (hand === 'left' ? 'Melon' : 'Mute'),
};

// The board's outline from its deck mesh, in the board's own space (nose toward -z, right toward +x, up +y).
export function outline(boardMesh) {
  let deck = null;
  boardMesh.traverse(o => { if (o.isMesh && !deck && /deck/i.test(o.name + (o.parent?.name || ''))) deck = o; });
  if (!deck) boardMesh.traverse(o => { if (o.isMesh && !deck) deck = o; });
  if (!deck) return null;
  boardMesh.updateMatrixWorld(true);
  const toBoard = new THREE.Matrix4().copy(boardMesh.matrixWorld).invert().multiply(deck.matrixWorld);
  const pos = deck.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
  for (let i = 0; i < pos.count; i += 1) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(toBoard).clone());
  return {
    // the side edge at z: its outermost point that way, halfway up the deck's thickness there
    side(sign, z) {
      const near = pts.filter(p => Math.abs(p.z - z) < 0.015);
      if (!near.length) return new THREE.Vector3(sign * 0.15, 0.03, z);
      const out = Math.max(...near.map(p => p.x * sign)), rim = near.filter(p => p.x * sign > out - 0.006);
      return new THREE.Vector3(sign * out, (Math.min(...rim.map(p => p.y)) + Math.max(...rim.map(p => p.y))) / 2, z);
    },
    // the very tip at x (sign -1: the nose, +1: the tail), halfway up its thickness
    tip(sign, x) {
      const near = pts.filter(p => Math.abs(p.x - x) < 0.02);
      if (!near.length) return new THREE.Vector3(x, 0.05, sign * 0.78);
      const out = Math.max(...near.map(p => p.z * sign)), rim = near.filter(p => p.z * sign > out - 0.006);
      return new THREE.Vector3(x, (Math.min(...rim.map(p => p.y)) + Math.max(...rim.map(p => p.y))) / 2, sign * out);
    },
  };
}

// Which part of the board a hand at `local` (the hand's grip, in the board's own space) would take: whichever is closest of the nose
// tip, the tail tip, and the side edges level with the hand (kept within `between` of the middle of the deck).
export function pickGrab(local, shape) {
  const cx = THREE.MathUtils.clamp(local.x, -0.07, 0.07), cz = THREE.MathUtils.clamp(local.z, -GRAB.between, GRAB.between);
  const options = [
    { part: 'nose', point: shape.tip(-1, cx), axis: [1, 0, 0], inward: [0, 0, 1] },
    { part: 'tail', point: shape.tip(1, cx), axis: [1, 0, 0], inward: [0, 0, -1] },
    { part: 'right', point: shape.side(1, cz), axis: [0, 0, 1], inward: [-1, 0, 0] },
    { part: 'left', point: shape.side(-1, cz), axis: [0, 0, 1], inward: [1, 0, 0] },
  ];
  let best = options[0], bestD = Infinity;
  for (const o of options) { const d = o.point.distanceTo(local); if (d < bestD) { bestD = d; best = o; } }
  return best;
}

export const grabName = (part, hand) => names[part](hand);

// Taking the board off your feet (board-off.js): while a hand holds the board, toggleOff() lets it go from your feet and it then follows
// that hand rigidly, from wherever it was, until toggleOff() again catches it (or not, if it is too far off). Let go of the grip with it
// off and you have dropped it: it falls, and you bail when you land. On a flat screen (no hands) it is held out to your right instead.
const DESK_HOLD = new THREE.Matrix4().compose(new THREE.Vector3(0.62, -0.75, -0.25), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2.4)), new THREE.Vector3(1, 1, 1));

export function createBoardGrab({ hands, boardMesh, onEvent = () => {}, desk = null }) {
  const hold = createHandleHold();
  const grabs = new Map(); // hand state -> { part, name, marker, time }
  const offset = new THREE.Vector3(), want = new THREE.Vector3(), socket = new THREE.Vector3(), mark = new THREE.Vector3(), local = new THREE.Vector3();
  const toBoard = new THREE.Matrix4();
  let shape = null;
  const log = []; // finished grabs this jump: { name, time } (for points, later)
  // The board off your feet: { hand (a hand state, or null on a flat screen), rel (board relative to the hand), dropped, vel, spin }
  let off = null, settle = null;
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _feetQ = new THREE.Quaternion();
  const _prev = new THREE.Vector3(), _handVel = new THREE.Vector3(), _sq = new THREE.Quaternion();

  const squeezeOf = state => state.inputSource?.gamepad?.buttons?.[1]?.value ?? 0;

  function start(state) {
    shape ||= outline(boardMesh);
    if (!shape || !state.handAnchor) return false;
    hold.realSocket(state, socket);
    boardMesh.updateMatrixWorld(true);
    local.copy(socket).applyMatrix4(toBoard.copy(boardMesh.matrixWorld).invert());
    // Grab whichever part your hand is actually closest to: the nose, the tail, or the side edge level with your hand.
    const { part, point, axis, inward } = pickGrab(local, shape);
    const marker = new THREE.Object3D();
    marker.name = `Grab ${part}`;
    marker.position.copy(point);
    boardMesh.add(marker);
    marker.updateMatrixWorld(true);
    marker.getWorldPosition(mark);
    if (mark.distanceTo(socket) > GRAB.maxLift + GRAB.reach) { marker.removeFromParent(); return false; }
    if (!hold.grab(state, { node: marker, axis, halfLength: 0, plate: GRAB.plate, inward, wristSide: [0, 1, 0] })) { marker.removeFromParent(); return false; }
    grabs.set(state, { part, name: names[part](state.handedness), marker, time: 0, inward });
    pulseHaptics(state, 0.5, 45);
    onEvent('grabStart', { name: names[part](state.handedness), part });
    return true;
  }

  function stop(state, air = false) {
    const g = grabs.get(state);
    if (!g) return;
    // Letting go of the board in the air while it is off your feet drops it: it carries on with the hand's speed and falls.
    if (air && off && off.hand === state && !off.dropped) { off.dropped = true; off.vel = _handVel.clone(); off.spin = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6); onEvent('dropBoard', {}); }
    hold.release(state);
    g.marker.removeFromParent();
    grabs.delete(state);
    if (g.time > 0.1) log.push({ name: g.name, time: g.time });
    onEvent('grabEnd', { name: g.name, part: g.part, time: g.time });
  }

  return {
    GRAB,
    log,
    holding: () => grabs.size > 0,
    names: () => [...grabs.values()].map(g => g.name),
    // After main.js has put the board where the physics says. `air`: in the air and riding (grabs only start then).
    update(dt, air) {
      for (const state of hands.states) {
        const sq = squeezeOf(state), g = grabs.get(state);
        if (g && (!air || sq < GRAB.squeezeOff)) stop(state, air);
        else if (!g && air && sq > GRAB.squeezeOn && !state.wasSqueezed) start(state);
        state.wasSqueezed = sq > GRAB.squeezeOn;
      }
      // Bring the board up so the grabbed edges meet the hands (the average, with both), no further than it can come.
      want.set(0, 0, 0);
      if (grabs.size) {
        boardMesh.updateMatrixWorld(true);
        for (const [state, g] of grabs) {
          g.time += dt;
          hold.realSocket(state, socket);
          g.marker.getWorldPosition(mark);
          want.add(socket.sub(mark));
        }
        want.divideScalar(grabs.size).clampLength(0, GRAB.maxLift);
      }
      offset.lerp(want, Math.min(1, GRAB.follow * dt));
      if (offset.lengthSq() > 1e-8) { boardMesh.position.add(offset); boardMesh.updateMatrixWorld(true); }
    },
    // The detach button was pressed (main.js, after hold): take the board off your feet, or catch it. `sim` is the skater.
    toggleOff(sim, presenting) {
      if (!off) {
        if (sim.mode !== 'air') return false;
        const hand = grabs.size ? grabs.keys().next().value : null;
        if (!hand && presenting) return false;            // in VR you have to be holding it
        if (!sim.detachBoard()) return false;
        boardMesh.updateMatrixWorld(true);
        const anchor = hand ? hand.grip : desk;
        anchor.updateMatrixWorld(true);
        off = { hand, rel: hand ? new THREE.Matrix4().copy(anchor.matrixWorld).invert().multiply(boardMesh.matrixWorld) : DESK_HOLD.clone(), dropped: false };
        _prev.setFromMatrixPosition(anchor.matrixWorld); _handVel.set(0, 0, 0);
        settle = null;
        if (hand) pulseHaptics(hand, 0.6, 40);
        return true;
      }
      if (off.dropped) return false;                     // nothing in your hand to put back
      boardMesh.updateMatrixWorld(true);
      boardMesh.matrixWorld.decompose(_p, _q, _s);
      sim.boardQuaternion(_feetQ, false);
      // On a flat screen there is no hand to line it up with: a press always brings it back clean.
      const verdict = off.hand ? judgeCatch({ pos: _p, quat: _q }, { pos: sim.pos, quat: _feetQ }) : { quality: 'clean', reversed: false };
      if (verdict.quality === 'miss') {
        if (off.hand) pulseHaptics(off.hand, 0.15, 20);
        onEvent('catchMiss', verdict);
        if (BOARD_OFF.missBails) sim.bail('missed catch');
        return false;
      }
      sim.catchBoard(verdict.quality, verdict.reversed);
      // Swing the last few degrees into line rather than snapping (from where it was, relative to the feet; reversed: the other end first).
      sim.boardQuaternion(_feetQ, false);
      settle = { from: _feetQ.clone().invert().multiply(_q), t: 0 };
      if (verdict.reversed) settle.from.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      offset.copy(_p).sub(sim.pos);                       // and let the existing lift ease it back down to the feet
      if (off.hand) pulseHaptics(off.hand, verdict.quality === 'clean' ? 0.9 : 0.6, verdict.quality === 'clean' ? 60 : 90);
      off = null;
      return true;
    },
    // After update, before toggleOff: while the board is off, put it where the hand has it (or where it has fallen to).
    hold(sim, dt) {
      if (off && sim.mode !== 'air') { off = null; settle = null; }   // landed (a bail, the sim saw to that) or respawned
      if (!off) {
        if (settle && sim.mode !== 'bail') {
          settle.t += dt;
          const k = Math.min(1, settle.t / BOARD_OFF.settle);
          _sq.identity().slerp(settle.from, 1 - k);
          boardMesh.quaternion.multiply(_sq);
          if (k >= 1) settle = null;
        }
        return;
      }
      if (off.dropped) {
        off.vel.y -= 9.81 * dt;
        boardMesh.position.copy(_p.copy(sim.boardOffPose?.pos ?? boardMesh.position)).addScaledVector(off.vel, dt);
        boardMesh.quaternion.copy(sim.boardOffPose?.quat ?? boardMesh.quaternion);
        _q.setFromEuler(new THREE.Euler(off.spin.x * dt, off.spin.y * dt, off.spin.z * dt));
        boardMesh.quaternion.premultiply(_q);
      } else {
        const anchor = off.hand ? off.hand.grip : desk;
        anchor.updateMatrixWorld(true);
        _m.copy(anchor.matrixWorld).multiply(off.rel).decompose(boardMesh.position, boardMesh.quaternion, _s);
        if (off.hand) { _p.setFromMatrixPosition(anchor.matrixWorld); if (dt > 0) _handVel.copy(_p).sub(_prev).divideScalar(dt); _prev.copy(_p); }
      }
      boardMesh.updateMatrixWorld(true);
      // How far you have held it from your feet decides the name; the sim keeps the pose in case you bail with it in your hand.
      if (sim.offTrick) {
        sim.offTrick.far = Math.max(sim.offTrick.far, boardMesh.position.distanceTo(sim.pos));
        if (sim.offTrick.far >= BOARD_OFF.christ) sim.offTrick.name = BOARD_OFF.names.far;
      }
      sim.boardOffPose = { pos: boardMesh.position.clone(), quat: boardMesh.quaternion.clone() };
    },
    get off() { return off ? { dropped: off.dropped, hand: off.hand?.handedness ?? null } : null; },
    // After the hands have posed: fit each holding hand onto its edge.
    place() { for (const state of grabs.keys()) hold.place(state); },
    releaseAll() { for (const state of [...grabs.keys()]) stop(state); },
    clearLog() { log.length = 0; },
    // dev: each grab with the inward direction it asked for, in the world
    debug() {
      const m = new Map(), q = new THREE.Quaternion();
      for (const [state, g] of grabs) { g.marker.getWorldQuaternion(q); m.set(state, { name: g.name, inwardWorld: new THREE.Vector3().fromArray(g.inward).applyQuaternion(q) }); }
      return m;
    },
  };
}
