# Skatepark

A Quest 3 WebXR skateboarding test bed: you ride a RIFT board around, to find out whether the skating itself is fun.
There are two levels, picked with `?level=` (or the links in the info panel): **Breakwater** (a 104 × 88 m skatepark, the
default) and **Eastbank school** (`?level=eastbank`, a 210 × 160 m school campus) and **Burnside** (`?level=burnside`, a 30 × 35 m pools-and-bridge park rebuilt from reference, work in progress). Static files, no build step — `dist/` is what GitHub Pages serves (push to `main` deploys).

## Playing

**Quest browser**

| Input | Does |
| --- | --- |
| Left stick up / down | Push (kicks repeat while held) / brake; on a rail in a 50-50: up = nosegrind, down = 5-0. A quick up-down (or down-up) flick is a manual, in the air too (land in it) |
| Left stick sideways | Steer · spin in the air |
| Your hands | **Balance grinds and manuals**: raise your right hand to push the meter right, your left hand to push it left (relative to how your hands were resting) |
| Right **A** | Hold to crouch, release to ollie. A longer hold pops higher |
| Right **trigger** | **Press once to grind.** A rail, ledge or coping only catches if you pressed it up to 0.4 s before the board touches it (you do not hold it); the grind then lasts until the rail ends, you ollie off, or you bail. **Near the top of a ramp or bowl wall, a press latches you onto the coping** (from the wall as you roll up it, from the air, or from the deck) and you grind along it, round a bowl's rim if it is a loop, as long as you are moving along the lip at 1.5 m/s or more. Without a press you roll over rails and ride ramps without ever catching the coping (keyboard: **G** or **Shift**) |
| Right **B** (in the air) | Flip button: press it, then push the left stick **left for a kickflip**, **right for a heelflip**, **down for a pop shove-it**, **down-left for a varial kickflip**, or **down-right for a varial heelflip** (the stick's direction is read as an angle, so a diagonal only has to go part way; up on its own does nothing) (the stick can come just before or just after) |
| Either **grip** (in the air) | **Grab the board.** Squeeze a grip while you are in the air with a hand near the board: the board comes up to meet your hand (as if you tucked your knees) and your hand closes on the nearest part: the **nose** or **tail** tip, or the edge in the **middle** of the deck (Indy / Stalefish on the right edge, Melon / Mute on the left, by which hand is on which side). It lets go when you let go of the grip, or when you land, catch a rail or bail. Press the grip once you are already in the air (squeezing before you leave the ground does not count). Holding both grips on the ground still re-centres you, but not in the air. No scoring yet; the grab name and how long you held it show for a moment when you let go. Tune it in `GRAB` in `board-grab.js` |
| Left **Y** | Switch regular / goofy (only when slow) |
| Hold both grips | Re-centre: stand on the board where you are now |
| Hold left **X** | Back to the entrance |

The camera is bolted to the board: it goes where the board goes, turns when it turns and tilts with whatever the board is
lying on, so walls and grind balance swing the whole world around you. Gentle slopes (a fun box, a bank edge) are eased
so they don't snap the view; past about 50° (a half-pipe wall) it follows almost rigidly. Tune it in `RIDER` in `config.js`.

**Manuals.** Flick the left stick forward then back (a loose flick is fine, about half a second end to end) while rolling
(about 1.5 m/s or more) for a manual: the nose comes up and the balance meter appears. Back then forward is a nose manual.
Flick in the air after an ollie and you land in it. Balance it with your hands, like a grind (the marker drifts and gets
harder the longer you hold it; push it back with the opposite hand; over-leaning is a bail). No pushing or braking while you are in one, and turning is weaker. Ollie to pop out of it, or it ends when you run
out of speed. The camera tilts with the board. Tune it in the `manual*` and `flick*` values in `config.js`.

**Nosegrind / 5-0.** While you are in a 50-50 (board along the rail), hold the left stick **up** to put the front truck on the
rail (a nosegrind: tail up, the board sits behind the rail point) or **down** for the back truck (a 5-0: nose up, the board sits
ahead of it). Let go and it is a 50-50 again. Holding the stick as you land on the rail starts you in it. They are harder to
balance and a bit slower than a 50-50, and the trick takes the name of whichever you held longest. Boardslides are unchanged.
The stick does not read as a manual flick while you are on a rail. Tune it in the `variant*` values in `config.js`.

**Flips.** In the air, press right **B** and push the left stick left (kickflip) or right (heelflip): the board turns one full
revolution in about half a second. The stick picks the direction and does not also spin you while the flip is going. You have to
start early enough to finish: a tap ollie needs the flip started within about 0.2 s of leaving the ground, a full one about
0.35 s. Land with the board nearly flat and it counts; land a bit short (up to ~110° off) and it is a sketchy landing (you
stumble and lose speed, no trick); land mid-flip and you bail. A board that is still turning cannot catch a rail, one that has come
round can (kickflip to rail). Tune it in the `flip*` values in `config.js`; the direction sign for goofy and regular is in `startTrick`.

**Shove-its.** Same button, with up or down on the stick (see the table). The board spins 180° flat in about a third of a second; a
varial adds a kickflip or heelflip roll to it. When the board has come round the sim turns its heading (and your stance, so you
still face the way you were going) and you ride on with the tail leading. Land it half turned and you bail. Credited names reuse the
`flip` event. No scoring yet. Tune it in the `shuv*` values in `config.js`; which way each one spins is in `startTrick` (one line). The cones are `shuvCone` and `varialCone`.

**Ramps that end in a deck.** A steep bank (up to about 70° at its top) that meets a flat deck is ridden, not treated as a wall: at the crest
the board is judged by the ground under its middle, and once the middle is over a flat deck it flies off the lip with the speed it
has (ollie at the lip and it carries on over the top; otherwise the half-pipe air logic brings you back into the ramp). Tune it with
`crestMinNormalY`, `crestDeckNormalY` and `crestLeave` in `config.js`. `tests/crest.test.mjs` is built from the school's real ramp profile.

**Fakie / switch.** Roll backwards and the controls follow where you are going, not the board: steer right and you go right of
your direction of travel, forward on the stick pushes the way you are rolling, a manual lifts the end that leads (a
"Fakie Manual" tail-up), and the balance moves are the same as going forward.

You stand on the board the way you would on a real one: side-on to travel, facing the board's right side (regular)
or left (goofy). The play space turns with the board, so your head stays over the deck and your own movement still
moves you around on it.

**Flat screen:** W push · S brake · A/D steer & balance (no hands on a flat screen) · hold Space, release to ollie · F in the air with A/D: kickflip / heelflip; F with S: shove-it; F with S+A / S+D: varial kickflip / heelflip · drag to look · Z stance · R entrance.

**Grinding.** Be in the air, close to a rail, ledge or coping, with the board roughly parallel (50-50) or roughly
square (boardslide) to it. It locks on, and the meter starts wherever your landing put it. Left unattended the board
leans over and falls off, and it gets harder the longer you hold it — stick towards the way the marker is drifting
to bring it back. Release the ollie button to pop off. Over-leaning, landing sideways at speed, or hitting a wall
fast is a bail: the board tumbles, the view fades, and you are put back where you were last rolling.

**Half pipes and transitions.** Ramps are ridden, not climbed: gravity does the work, so speed you carry in is the height
you get out (roll up to the lip, hang, and come back down fakie). Drop in by rolling slowly off the deck over the coping;
you lean into the wall and ride it down. Faster than the lip and you air out over it and land back in. Reach the coping
almost stopped and you simply roll back down the wall (the axle stall was taken out: it left the board perched on the lip). **Airs stay in the pipe unless you mean to go over.** Fly out of the lip and you are held over the pit and ride back down the wall, however fast you are going and however long you have been holding forward (the first version sent you over the top after about 2 s of holding forward, which on a headset is just pushing, so every ride up a quarter-pipe ended on the deck behind it). To pass over the top you ollie at the lip *and* have the speed to clear it (see `passPopWindow` and `lip*` in `config.js`). Going over never grabs the coping, and holding forward at the top never stalls. Dropping back onto a coping while barely moving along it is not a boardslide (`copingSlideMinSpeed`); one that slows to a crawl drops you into the pit (`copingSlideEnd`).

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
dist/src/skate/levels.js   the level list (?level=): model, play area, shadow reach, intro text
dist/src/skate/lod.js      swaps chunks of a level between full and cheaper versions by distance
dist/src/skate/rails.js    grind paths read from the park file (node extras, role "grind_path")
dist/src/skate/rider.js    puts the player on the board (stance, centring, crouch, lean)
dist/src/skate/input.js    Quest controllers / keyboard
dist/src/skate/hands.js    VR hands (rigs from Oasis / Sandboarding), with the adaptive grip so a hand can close round something
dist/src/skate/board-grab.js   grabbing the board in the air (nose / tail / middle), from Sandboarding; handle-hold.js, grip-contact.js, adaptive-grip.js and grip-poses.js are the hand-fitting code it rests on
dist/src/skate/haptics.js  controller pulses
dist/src/skate/music.js    the soundtrack: the three tracks in dist/assets/music play one after another, forever (starts on the first click / key press / VR session; volume in `MUSIC`)
dist/src/skate/hud.js      grind balance gauge
dist/assets/skateboard.glb game version of the board (2 MB)
dist/assets/music/         the soundtrack, three mp3s at 96 kbps (4 MB in all)
dist/assets/levels/        optimised level models (eastbank-school.glb, burnside.glb)
dist/models/hands/         the hand rigs
tools/slim-skateboard.mjs  makes dist/assets/skateboard.glb from source/RIFT_Skateboard.glb
tools/export-blend.py      level .blend -> raw GLB, via Blender as a Python module (see Levels)
tools/optimise-level.mjs   raw level GLB -> merged, chunked, LOD'd, compressed game GLB (see Levels)
tools/measure-level.mjs    triangles / draw calls per view over a grid of ground positions, with and without LODs
tools/check-level.mjs      drives the real skater on a level: spawns, ground grid, every grind path
tools/shoot-level.mjs      screenshots a level from chosen spots
tools/plan-level.mjs       top-down plan of a level;  plan-collision.mjs: the same for its collision, coloured by height
tools/audit-level.mjs      compares what is drawn with what can be ridden (visible floor with no collision and the reverse)
tools/check-stairs.mjs     rolls the skater off the top of every stair set, with and without an ollie
tools/check-stair-tops.mjs what is at the top of each stair set (flat run, then a wall, a drop or nothing)
tools/check-grab.mjs       fakes two controllers in a headless browser, grabs the nose / tail / sides of the board in mid-air and checks the hand lands on the edge (optional screenshots);  see also below
tools/check-ramps.mjs      finds every ramp in the collision and rides up it at a given speed (stops dead? bails? gets to the top?)
tools/ride-ramp.mjs        traces the skater riding at a ramp from a point and heading;  profile-ramp.mjs: collision vs visible height along a line
tools/patches/eastbank.py  fixes applied inside Blender on every export of the school (see Levels)
tools/patches/burnside.py  Burnside's spawn points moved to their real positions on export; Burnside ships as the raw export (no optimiser, no collision simplification: `dist/assets/levels/burnside.glb` is `tools/export-blend.py` output); `burnside.tweaks.json` is only used if you do optimise it
tools/patches/eastbank_ramps.py  re-profiles the school's quarter-pipes to end vertical under the coping (the model's ended at 59° with a flat deck, which nothing in the ramp physics copes with)
tools/patches/eastbank_details.py  frames round windows and doors, door handles (built in Blender during the same export)
tests/                     simulation tests
```

The board's origin is where the wheels meet the ground and the nose points down −Z. Heading `h` points the nose along
(−sin h, 0, −cos h). Rails have no collision of their own; they only exist as grind paths.

## Levels

A level is a GLB with `ENV_*` render meshes, `COL_*` collision meshes (invisible), `PATH_*` grind paths (node extras, role
`grind_path`) and a `Spawn_Entrance` node. Add it to `dist/src/skate/levels.js` with its play-area `bounds` (the skater is
kept inside them) and the `?level=` id it answers to.

Eastbank school is built by Codex in Blender. `tools/export-blend.py` turns the `.blend` into a raw GLB (it runs Blender as a
Python module, so no Blender install is needed), and `node tools/optimise-level.mjs <raw.glb> dist/assets/levels/eastbank-school.glb`
turns that into the game file. The first export came in at 80 MB with 1.6 M triangles and ~335 MB of texture memory; the
current one is a 7.7 MB game file. The optimiser:

- bakes every object's transform and merges everything that shares a material, so thousands of separate objects do not become
  thousands of draw calls (collision pieces are merged by area, `COL_<Area>`, and otherwise left exactly as exported);
- cuts the render meshes into chunks with a quadtree (a square only splits while it holds too many triangles), so culling works
  and sparse things such as rails stay a single draw call;
- gives every chunk LOD1/LOD2 copies, swapped in by distance to the chunk's box (`lod.js`). Geometry is simplified with locked
  borders so chunks do not crack apart; leaf cards are thinned (whole leaves dropped, the rest scaled up) instead;
- quantises positions, normals and colours, resizes textures (base/normal 1024², ORM 512²) to WebP, and meshopt-compresses
  the buffers.

**Fixes to the model (`tools/patches/<level>.py`).** `export-blend.py` can run a patch file inside Blender just before exporting,
so fixes survive each new version of the `.blend`. The school's patch (1) digs pockets out of the terrain slab, which was
drawn over everything below −0.4 m and buried the drainage basin and the Forum plaza, (2) moves surfaces that were modelled at
exactly the same height on top of each other 2 cm apart (roads over the concrete extension, and so on) so they stop z-fighting,
(3) copies the grass outside the campus to collision, so it can be ridden, (4) makes the ground around the campus concrete,
(5) removes a lone pier that held nothing up, (6) gives the Locker Hall a base (its floor hovered 0.5 m off the ground), and
(7) slides the ledge that blocked the top of the dock stairs along the landing. A small tweaks file next to it
(`eastbank.materials.json`) corrects materials in the optimiser: the asphalt used the dark green loam texture, so it is
re-pointed at the concrete set and tinted grey. Thin joint and marking lines are decals: the game
gives them a depth offset (`decals` in `levels.js`), and the walls, glazing and roofs, which are thin shells with small gaps at the joints, are drawn on both sides
(`doubleSided`) so a gap shows the far wall instead of the sky; the cream enamel is left single-sided because that is the lettering. `audit-level.mjs` is how to find this sort of thing.

`node tools/measure-level.mjs eastbank` reports what a headset would be asked to draw (triangles and draw calls per view, with and
without LODs); `node tools/check-pops.mjs eastbank` ollies from random spots and reports pops that do not leave the ground; `node tools/check-level.mjs eastbank` rides the real skater over the level (spawns, a grid of ground points, every
grind path); `node tools/shoot-level.mjs eastbank <dir> x,z,heading …` takes screenshots. The raw first export lives on the
`level/eastbank-school` branch.

## Cache busting (so you always test the latest)

`dist/manifest.json` holds a short content hash for every script and model the game loads, and one **build id** for the whole
set. `index.html` fetches it fresh on every visit and loads each file as `?v=<hash>` (plus an import map so the modules that
import each other are versioned too), so a changed file always has a new URL and Quest cannot run a stale copy, while
unchanged files stay cached. The build id is shown in the info panel on a flat screen and flashes in the view at the start of a
VR session; compare it with the build id in the deploy message. After changing anything in `dist/` run `npm run manifest`
(`npm test` fails if the committed manifest is out of date).

## Tests

```
npm install
npm test
```

Runs the simulation against a flat test floor: rolling, pushing, steering, ollie height, landing and wall bails,
rail locking (50-50 and boardslide), balance, popping off, near-misses, respawn. `tests/halfpipe.test.mjs` builds a real
half-pipe mesh (round transitions, vertical, deck, coping) and checks wall riding, drop-ins, airs, pumping and axle stalls
through the same collision code the game uses.

## Balancing with your hands (VR)

Grinds and manuals are balanced with your hands, not the thumbstick. The push is the tilt of the line between your hands, like
holding a balance pole: right hand up moves the marker right, left hand up moves it left; about 22° is a full push. Because it
is an angle it feels the same with the hands close together or wide apart. It is measured from a neutral that is learned only
while you are rolling relaxed on the ground (not crouching, popping or in the air, where your arms swing about), and frozen for
the length of the grind or manual. The push eases in over a quarter of a second when a balance starts. Change the feel in `HANDS` in
`config.js` (`range`, `deadzone`, `restTime`, `minSpread`, `ease`, `response`). The thumbstick still pushes, brakes, steers,
spins you in the air and flicks for a manual.
