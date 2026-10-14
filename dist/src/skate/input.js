// Turns Quest controllers (or a keyboard) into the five things the skater cares about.
//   left stick  up = push, down = brake, sideways = steer / air spin / grind balance
//   right A = hold to crouch, release to ollie
//   right trigger (keyboard G / Shift) = grind: press it once; the rail or coping the board touches in the next moment is caught
//   right B (keyboard F) = flip button: left/right = kickflip/heelflip,
//     down = shove-it, down-left/down-right = varial kickflip/heelflip; up does nothing
//   left trigger (keyboard C) = in the air while holding the board in a grab: hold it to take the board off your feet, let go to catch it (board-off.js)
//   left Y = switch stance, left X held = back to the entrance, both grips held (on the ground) = stand on the board where you are
//   either grip, in the air = grab the board (board-grab.js)
const DEADZONE = 0.15;
const deadzone = (v) => (Math.abs(v) > DEADZONE ? (Math.abs(v) - DEADZONE) / (1 - DEADZONE) * Math.sign(v) : 0);
const BUTTON = { trigger: 0, squeeze: 1, stick: 3, a: 4, b: 5 };
const axis = (v) => Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;

export function createInput(renderer) {
  const keys = new Set();
  const held = { recenter: 0, spawn: 0 };
  const edge = { stance: false, keyStance: false };
  const trickStick = { x: 0, y: 0 };
  const out = { steer: 0, drive: 0, trickStick, lean: 0, jump: false, grind: false, flip: false, detach: false, recenter: false, toSpawn: false, toggleStance: false, grips: { left: null, right: null } };
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
    let trickX = steer, trickY = -drive;
    const keyStance = keys.has('KeyZ');
    if (keyStance && !edge.keyStance) toggleStance = true;
    edge.keyStance = keyStance;

    const session = renderer.xr.isPresenting ? renderer.xr.getSession() : null;
    let leftSqueeze = false, rightSqueeze = false, leftX = false, leftY = false;
    if (session) {
      // In XR, trick controls come exclusively from the left controller and
      // right B. Keyboard state cannot change a controller's direction.
      trickX = 0; trickY = 0; flip = false;
      for (const source of session.inputSources) {
        const pad = source.gamepad;
        if (!pad) continue;
        const { axes, buttons } = pad;
        const a = axes.length >= 4 ? 2 : 0;
        if (source.handedness === 'left') {
          const x = axis(axes[a]), y = axis(axes[a + 1]);
          steer += deadzone(x);
          drive -= deadzone(y);
          trickX = x; trickY = y;
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
    }
    // Held left X (or R) takes you back to the entrance. (The keyboard used to zero this every frame before the controller could add to it.)
    held.spawn = leftX || keys.has('KeyR') ? held.spawn + dt : 0;
    held.recenter = leftSqueeze && rightSqueeze && !block.recenter ? held.recenter + dt : 0;
    if (held.recenter > 0.6) { recenter = true; held.recenter = -1e9; }
    if (held.spawn > 0.8) { toSpawn = true; held.spawn = -1e9; }

    out.steer = Math.max(-1, Math.min(1, steer));
    out.drive = Math.max(-1, Math.min(1, drive));
    out.trickStick = trickStick;
    trickStick.x = trickX;
    trickStick.y = trickY;
    // Balance comes from the hands in VR (main.js sets it); on a flat screen A/D balance so it stays playable for testing.
    out.lean = session ? 0 : out.steer;
    out.jump = jump;
    out.grind = grind;
    out.flip = flip;
    out.detach = detach;
    out.recenter = recenter;
    out.toSpawn = toSpawn;
    out.toggleStance = toggleStance;
    Object.assign(out, override);
    if (!session && !override.trickStick) {
      out.trickStick.x = axis(out.steer);
      out.trickStick.y = -axis(out.drive);
    }
    return out;
  }

  return { poll, override, keys, block };
}
