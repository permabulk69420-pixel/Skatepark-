// Turns Quest controllers (or a keyboard) into the five things the skater cares about.
//   left stick  up = push, down = brake, sideways = steer / air spin / grind balance
//   right A = hold to crouch, release to ollie
//   right trigger (keyboard G / Shift) = grind: press it once; the rail or coping the board touches in the next moment is caught
//   right B (keyboard F) = flip button: in the air, with the stick left (kickflip) or right (heelflip)
//   left trigger (keyboard C) = in the air while holding the board in a grab: hold it to take the board off your feet, let go to catch it (board-off.js)
//   left Y = switch stance, left X held = back to the entrance, both grips held (on the ground) = stand on the board where you are
//   either grip, in the air = grab the board (board-grab.js)
const DEADZONE = 0.15;
const deadzone = (v) => (Math.abs(v) > DEADZONE ? (Math.abs(v) - DEADZONE) / (1 - DEADZONE) * Math.sign(v) : 0);
const BUTTON = { trigger: 0, squeeze: 1, stick: 3, a: 4, b: 5 };

export function createInput(renderer) {
  const keys = new Set();
  const held = { recenter: 0, spawn: 0 };
  const edge = { stance: false, keyStance: false };
  const out = { steer: 0, drive: 0, lean: 0, jump: false, grind: false, flip: false, detach: false, recenter: false, toSpawn: false, toggleStance: false, grips: { left: null, right: null } };
  const override = {};
  // Set by the game: while true, holding both grips does not re-centre (in the air, or while grabbing the board with both hands).
  const block = { recenter: false };

  addEventListener('keydown', (event) => {
    keys.add(event.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  });
  addEventListener('keyup', (event) => keys.delete(event.code));
  addEventListener('blur', () => keys.clear());

  function poll(dt) {
    let steer = 0, drive = 0, jump = false, grind = false, flip = false, detach = keys.has('KeyC'), toggleStance = false, recenter = false, toSpawn = false;
    steer += Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    drive += Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    jump = keys.has('Space');
    flip = keys.has('KeyF');
    grind = keys.has('KeyG') || keys.has('ShiftLeft') || keys.has('ShiftRight');
    const keyStance = keys.has('KeyZ');
    if (keyStance && !edge.keyStance) toggleStance = true;
    edge.keyStance = keyStance;
    held.spawn = keys.has('KeyR') ? held.spawn + dt : 0;

    const session = renderer.xr.isPresenting ? renderer.xr.getSession() : null;
    let leftSqueeze = false, rightSqueeze = false, leftX = false, leftY = false;
    if (session) {
      for (const source of session.inputSources) {
        const pad = source.gamepad;
        if (!pad) continue;
        const { axes, buttons } = pad;
        const a = axes.length >= 4 ? 2 : 0;
        if (source.handedness === 'left') {
          steer += deadzone(axes[a] || 0);
          drive -= deadzone(axes[a + 1] || 0);
          leftSqueeze = !!buttons[BUTTON.squeeze]?.pressed;
          leftX = !!buttons[BUTTON.a]?.pressed;
          leftY = !!buttons[BUTTON.b]?.pressed;
          detach = detach || !!buttons[BUTTON.trigger]?.pressed;
        } else if (source.handedness === 'right') {
          jump = jump || !!buttons[BUTTON.a]?.pressed;
          grind = grind || !!buttons[BUTTON.trigger]?.pressed;
          flip = flip || !!buttons[BUTTON.b]?.pressed;
          rightSqueeze = !!buttons[BUTTON.squeeze]?.pressed;
        }
      }
      if (leftY && !edge.stance) toggleStance = true;
      edge.stance = leftY;
      held.spawn = leftX ? held.spawn + dt : (keys.has('KeyR') ? held.spawn : 0);
    }
    held.recenter = leftSqueeze && rightSqueeze && !block.recenter ? held.recenter + dt : 0;
    if (held.recenter > 0.6) { recenter = true; held.recenter = -1e9; }
    if (held.spawn > 0.8) { toSpawn = true; held.spawn = -1e9; }

    out.steer = Math.max(-1, Math.min(1, steer));
    out.drive = Math.max(-1, Math.min(1, drive));
    // Balance comes from the hands in VR (main.js sets it); on a flat screen A/D balance so it stays playable for testing.
    out.lean = session ? 0 : out.steer;
    out.jump = jump;
    out.grind = grind;
    out.flip = flip;
    out.detach = detach;
    out.recenter = recenter;
    out.toSpawn = toSpawn;
    out.toggleStance = toggleStance;
    return Object.assign(out, override);
  }

  return { poll, override, keys, block };
}
