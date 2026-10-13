import * as THREE from 'three';

// Taking the board off your feet in the air and catching it again (board-grab.js does the holding, sim.js the consequences).
// While you hold the board in a grab, squeeze the detach button (left trigger; C on a flat screen): the board leaves your feet and
// stays in your hand exactly where it was. Let go of the button to catch: the board snaps back under your feet if it is close enough
// and lined up well enough at that moment (if not, it stays in your hand: squeeze and let go again). Land without it and you bail.
// Held well away from you it is a Christ Air.
export const BOARD_OFF = Object.freeze({
  clean: Object.freeze({ angle: THREE.MathUtils.degToRad(25), distance: 0.3 }),   // within both: a clean catch
  sketchy: Object.freeze({ angle: THREE.MathUtils.degToRad(60), distance: 0.5 }), // within both: caught, but you land sketchy
  missBails: false,          // a catch pressed with the board way off: false = nothing happens (try again), true = you bail
  christ: 0.5,               // metres: held at least this far from your feet at some point, the trick is a Christ Air
  settle: 0.12,              // seconds the board takes to swing the last few degrees into line after a catch
  names: Object.freeze({ near: 'Board Off', far: 'Christ Air' })
});

const _up = new THREE.Vector3(), _feetUp = new THREE.Vector3(), _len = new THREE.Vector3(), _feetLen = new THREE.Vector3();

// How a catch pressed now would go. board / feet: { pos: Vector3, quat: Quaternion } in the world, where `feet` is the frame the
// board belongs in (the sim's board frame: origin where the wheels meet the ground, nose along −z, up +y).
// Returns { quality: 'clean' | 'sketchy' | 'miss', angle, distance, reversed } — reversed: caught nose-for-tail (it still counts;
// the board is then ridden the other way round, as after a shove-it).
export function judgeCatch(board, feet) {
  _up.set(0, 1, 0).applyQuaternion(board.quat);
  _feetUp.set(0, 1, 0).applyQuaternion(feet.quat);
  _len.set(0, 0, -1).applyQuaternion(board.quat);
  _feetLen.set(0, 0, -1).applyQuaternion(feet.quat);
  const tilt = _up.angleTo(_feetUp);                                   // upside down is ~180°
  const along = _len.dot(_feetLen);
  const twist = Math.acos(Math.min(1, Math.abs(along)));              // nose or tail first, either is fine
  const angle = Math.max(tilt, twist);
  const distance = board.pos.distanceTo(feet.pos);
  const reversed = along < 0;
  const within = (w) => angle <= w.angle && distance <= w.distance;
  const quality = within(BOARD_OFF.clean) ? 'clean' : within(BOARD_OFF.sketchy) ? 'sketchy' : 'miss';
  return { quality, angle, distance, reversed };
}
