# Skatepark — Breakwater

A Quest 3 WebXR skateboarding test bed: a 104 × 88 m skatepark you ride a RIFT board around, to find out whether
the skating itself is fun. Static files, no build step — `dist/` is what GitHub Pages serves (push to `main` deploys).

## Playing

**Quest browser**

| Input | Does |
| --- | --- |
| Left stick up / down | Push (kicks repeat while held) / brake |
| Left stick sideways | Steer · spin in the air · **balance on a grind** |
| Right **A** (or right trigger) | Hold to crouch, release to ollie. A longer hold pops higher |
| Left **Y** | Switch regular / goofy (only when slow) |
| Hold both grips | Re-centre: stand on the board where you are now |
| Hold left **X** | Back to the entrance |

You stand on the board the way you would on a real one: side-on to travel, facing the board's right side (regular)
or left (goofy). The play space turns with the board, so your head stays over the deck and your own movement still
moves you around on it.

**Flat screen:** W push · S brake · A/D steer & balance · hold Space, release to ollie · drag to look · Z stance · R entrance.

**Grinding.** Be in the air, close to a rail, ledge or coping, with the board roughly parallel (50-50) or roughly
square (boardslide) to it. It locks on, and the meter starts wherever your landing put it. Left unattended the board
leans over and falls off, and it gets harder the longer you hold it — stick towards the way the marker is drifting
to bring it back. Release the ollie button to pop off. Over-leaning, landing sideways at speed, or hitting a wall
fast is a bail: the board tumbles, the view fades, and you are put back where you were last rolling.

Haptics: roll rumble, push ticks, crouch tick, pop snap, landing thump scaled to the impact, grind rumble that gets
harder as you near falling, wall hits and bails.

## Where things are

```
dist/index.html            page + styles
dist/src/main.js           scene, loading, main loop
dist/src/skate/config.js   every tuning number (speeds, ollie height, balance difficulty, wall/landing limits …)
dist/src/skate/sim.js      the skater: ground, air, grinds, bails
dist/src/skate/world.js    ground/wall queries against the park's collision meshes
dist/src/skate/rails.js    grind paths read from the park file (node extras, role "grind_path")
dist/src/skate/rider.js    puts the player on the board (stance, centring, crouch, lean)
dist/src/skate/input.js    Quest controllers / keyboard
dist/src/skate/hands.js    VR hands (rigs from Oasis / Sandboarding)
dist/src/skate/haptics.js  controller pulses
dist/src/skate/hud.js      grind balance gauge
dist/assets/skateboard.glb game version of the board (2 MB)
dist/models/hands/         the hand rigs
tools/slim-skateboard.mjs  makes dist/assets/skateboard.glb from source/RIFT_Skateboard.glb
tests/                     simulation tests
```

The board's origin is where the wheels meet the ground and the nose points down −Z. Heading `h` points the nose along
(−sin h, 0, −cos h). Rails have no collision of their own; they only exist as grind paths.

## Tests

```
npm install
npm test
```

Runs the simulation against a flat test floor: rolling, pushing, steering, ollie height, landing and wall bails,
rail locking (50-50 and boardslide), balance, popping off, near-misses, respawn.
