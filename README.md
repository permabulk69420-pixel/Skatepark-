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

The camera is bolted to the board: it goes where the board goes, turns when it turns and tilts with whatever the board is
lying on, so walls and grind balance swing the whole world around you. Gentle slopes (a fun box, a bank edge) are eased
so they don't snap the view; past about 50° (a half-pipe wall) it follows almost rigidly. Tune it in `RIDER` in `config.js`.

You stand on the board the way you would on a real one: side-on to travel, facing the board's right side (regular)
or left (goofy). The play space turns with the board, so your head stays over the deck and your own movement still
moves you around on it.

**Flat screen:** W push · S brake · A/D steer & balance · hold Space, release to ollie · drag to look · Z stance · R entrance.

**Grinding.** Be in the air, close to a rail, ledge or coping, with the board roughly parallel (50-50) or roughly
square (boardslide) to it. It locks on, and the meter starts wherever your landing put it. Left unattended the board
leans over and falls off, and it gets harder the longer you hold it — stick towards the way the marker is drifting
to bring it back. Release the ollie button to pop off. Over-leaning, landing sideways at speed, or hitting a wall
fast is a bail: the board tumbles, the view fades, and you are put back where you were last rolling.

**Half pipes and transitions.** Ramps are ridden, not climbed: gravity does the work, so speed you carry in is the height
you get out (roll up to the lip, hang, and come back down fakie). Drop in by rolling slowly off the deck over the coping;
you lean into the wall and ride it down. Faster than the lip and you air out over it and land back in. Reach the coping
square-on almost stopped and you catch an **axle stall**: balance it like a grind, then release the ollie button to rock
back in fakie (it only catches when you come up from the pit, never when you drop in). **Airs stay in the pipe unless you mean to go over.** Ollie at the lip, or just fly out of it, and you are held over the
pit and ride back down the wall, however fast you are going. To pass over the top you have to hold forward on the stick
for a decent while (about 2 s of it; a tap doesn't build it and letting go drains it fast), and it's decided when you
launch, so you can let go in the air, *and* have enough speed to
clear the lip (the pop doesn't count, only the speed you brought). Holding forward is also what pumps the transitions, so
it all happens together. Going over never grabs the coping, and holding forward at the top never stalls: from a 4 m/s start on the mini ramp you pass over after a few passes (see `pass*` and `lip*` in
`config.js`).

In the air the board keeps the tilt it left the surface with (come out of a wall vertical and you stay vertical, and the
view with you) and eases towards whatever it is about to land on, faster as the ground gets close.

**Hold forward on a transition to pump it** (the same input that pushes on the flat):
speed builds pass after pass until you can reach the lip and air out of it. An ollie on a wall pops you up, not backwards
into the pipe. In VR you can also **pump** with your real
knees: squat, then stand as you go up a transition and you gain speed (squatting costs a little, so mashing doesn't pay).

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
rail locking (50-50 and boardslide), balance, popping off, near-misses, respawn. `tests/halfpipe.test.mjs` builds a real
half-pipe mesh (round transitions, vertical, deck, coping) and checks wall riding, drop-ins, airs, pumping and axle stalls
through the same collision code the game uses.
