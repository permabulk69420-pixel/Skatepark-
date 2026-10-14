# Skatepark

A Quest 3 WebXR skateboarding test bed: you ride a RIFT board around, to find out whether the skating itself is fun.
There are two levels, picked with `?level=` (or the links in the info panel): **Breakwater** (a 104 × 88 m skatepark, the
default) and **Foundry**
(`?level=foundry`, an 80 × 72 m park with a **loop-the-loop**, built entirely from code: see [Foundry](#foundry)). Static files, no build step — `dist/` is what GitHub Pages serves (push to `main` deploys).

## Playing

**Quest browser**

| Input | Does |
| --- | --- |
| Left stick up / down | Push (kicks repeat while held) / brake; on a rail in a 50-50: up = nosegrind, down = 5-0. A quick up-down (or down-up) flick is a manual, in the air too (land in it) |
| Left stick sideways | Steer · spin in the air |
| Your hands | **Balance grinds and manuals**: raise your right hand to push the meter right, your left hand to push it left (relative to how your hands were resting) |
| Right **A** | Hold to crouch, release to ollie. A longer hold pops higher |
| Right **trigger** | **Press once to grind.** A rail, ledge or coping only catches if you pressed it up to 0.4 s before the board touches it (you do not hold it); the grind then lasts until the rail ends, you ollie off, or you bail. **Near the top of a ramp or bowl wall, a press latches you onto the coping** (from the wall as you roll up it, from the air, or from the deck) and you grind along it, round a bowl's rim if it is a loop, as long as you are moving along the lip at 1.5 m/s or more. Without a press you roll over rails and ride ramps without ever catching the coping (keyboard: **G** or **Shift**) |
| Right **B** + left stick | **Flip tricks, Tony Hawk style.** Press B and push the stick, in either order, within 0.4 s: **left = kickflip**, **right = heelflip**, **down = pop shove-it**, **down-left = varial kickflip**, **down-right = varial heelflip**. Up does nothing. Only a push within 15° of straight down is a shove-it; 15–65° is the varial. The trick name in the HUD shows the stick angle it was read from (e.g. `(stick 32° L)`). Press B on the ground as you ollie and the trick goes as soon as you leave the ground. The trick is read once your thumb stops moving (at most 0.18 s), from the furthest it reached on each axis, so a thumb that goes down and then rolls into the diagonal still gets the varial. One press, one trick. Tune it in the `trick*` values in `config.js` |
| Either **grip** (in the air) | **Grab the board.** Squeeze a grip while you are in the air with a hand near the board: the board comes up to meet your hand (as if you tucked your knees) and your hand closes on the nearest part: the **nose** or **tail** tip, or the edge in the **middle** of the deck (Indy / Stalefish on the right edge, Melon / Mute on the left, by which hand is on which side). It lets go when you let go of the grip, or when you land, catch a rail or bail. Press the grip once you are already in the air (squeezing before you leave the ground does not count). Holding both grips on the ground still re-centres you, but not in the air. No scoring yet; the grab name and how long you held it show for a moment when you let go. Tune it in `GRAB` in `board-grab.js` |
| Left **trigger** (while grabbing, in the air) | **Hold it to take the board off your feet.** It stays in your hand exactly where it was and follows it; hold it out wide for a **Christ Air**. Bring it back under your feet, about the right way up and lined up, and **let go of the trigger to catch** it: close and square is clean, a bit off is a sketchy landing, too far off and it stays in your hand (squeeze and let go again). Land without it and you bail; let go of the grip and you drop it. Nose-for-tail catches count (you ride on switch). The view keeps following your body through the air meanwhile. Tune it in `BOARD_OFF` in `board-off.js` (keyboard: hold **C**, held out to the side; letting go always catches) |
| Left stick **back / forward** (in the air, while grabbing) | **Backflip / frontflip.** Hold the stick most of the way, close to straight back (or forward), for a moment (0.15 s) and you start turning over; you keep turning while you hold it, and can push it diagonally to spin at the same time. A sideways or diagonal push alone stays a spin, and a quick flick does nothing. Land upright and it counts (Backflip, Double Backflip…); a bit off is sketchy, way off is a slam. You go nose over tail: a backflip lifts the nose and goes over backwards. Tune it in the `bodyFlip*` values in `config.js` |
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

**Shove-its.** Same button, with down on the stick (see the table). The board spins 180° flat in about a third of a second; a
varial adds a kickflip or heelflip roll to it. When the board has come round the sim turns its heading (and your stance, so you
still face the way you were going) and you ride on with the tail leading. Land it half turned and you bail. Credited names reuse the
`flip` event. No scoring yet. Tune rotation in the `shuv*` values and input timing in the `trick*` values in `config.js`. The input directions and one-press selection are in `trick-controls.js`.

**Ramps that end in a deck.** A steep bank (up to about 70° at its top) that meets a flat deck is ridden, not treated as a wall: at the crest
the board is judged by the ground under its middle, and once the middle is over a flat deck it flies off the lip with the speed it
has (ollie at the lip and it carries on over the top; otherwise the half-pipe air logic brings you back into the ramp). Tune it with
`crestMinNormalY`, `crestDeckNormalY` and `crestLeave` in `config.js`. `tests/crest.test.mjs` is built from a real ramp profile (from an earlier level).

**Loops.** Roll into a loop's track and the board follows it all the way round: up the wall, upside down over the top and back
down onto the way out, which runs beside the way in. Gravity slows you on the way up; holding forward pumps the bottom half. The
one rule is the real one: the track can only push, so wherever your speed is too low to stay pressed onto it (upside down) you fall
off, and that is a bail. Too slow to reach the vertical and you simply roll back out, fakie. Ollie out only on the flat-ish run in
and out. On Foundry, pushing off the start tower and dropping in carries you round easily (about 10.8 m/s is needed going in, or
10.1 if you pump). The camera stays bolted to the board the whole way, so in the headset the world goes over your head. Tune it
in the `loop*` values in `config.js`; the shape and the riding are in `loop.js` (`loopRibbon`, `LoopPath`) and `loopStep` in
`sim.js`; `tests/loop.test.mjs` rides a real loop mesh.

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
almost stopped and you simply roll back down the wall (the axle stall was taken out: it left the board perched on the lip). **Airs stay in the pipe unless you mean to go over.** Fly out of the lip and you are held over the pit and ride back down the wall, however fast you are going and however long you have been holding forward (the first version sent you over the top after about 2 s of holding forward, which on a headset is just pushing, so every ride up a quarter-pipe ended on the deck behind it). To pass over the top you ollie at the lip **while holding forward**; speed by itself never commands an exit (but you still need enough momentum to reach the lip). Once you commit, letting go of forward mid-air will not pull you back. Going over never grabs the coping, and holding forward at the top never stalls. Dropping back onto a coping while barely moving along it is not a boardslide (`copingSlideMinSpeed`); one that slows to a crawl drops you into the pit (`copingSlideEnd`).

In the air the board keeps the tilt it left the surface with (come out of a wall vertical and you stay vertical, and the
view with you) and eases towards whatever it is about to land on, faster as the ground gets close.

**Hold forward on a transition to pump it** (the same input that pushes on the flat):
speed builds pass after pass until you can reach the lip and air out of it. An ollie on a wall pops you up, not backwards
into the pipe. In VR you can also **pump** with your real
knees: squat, then stand as you go up a transition and you gain speed (squatting costs a little, so mashing doesn't pay).

**Sound.** Board sounds play through Web Audio alongside the music (after the first click, key press or VR session): a pop on the
ollie, a landing that gets heavier with the drop, a clank as you lock onto a rail or coping, a metal grind on rails and coping and a
concrete grind on ledges (both rise in pitch with speed), rolling that gets louder and higher as you speed up (on concrete, or on
ply: the mini ramp and the loop), a scuff on every push, and a slam and a clattering board when you bail. Levels in `SFX` in
`sfx.js`; the clips are cut from CC0 Freesound recordings (`source/sfx`, credits in `source/sfx/CREDITS.md`) by
`node tools/build-sfx.mjs`, which says where in each recording each clip starts; `node tools/check-sfx.mjs` plays them in a
headless browser and reports what sounded.

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
dist/src/skate/loop.js     loop-the-loops: the track shape (loopRibbon) and the ridden path read from the park file (role "loop_path")
dist/src/skate/rider.js    puts the player on the board (stance, centring, crouch, lean)
dist/src/skate/input.js    Quest controllers / keyboard
dist/src/skate/hands.js    VR hands (rigs from Oasis / Sandboarding), with the adaptive grip so a hand can close round something
dist/src/skate/board-off.js    taking the board off your feet in the air and catching it again: the catch judgement and its numbers
dist/src/skate/board-grab.js   grabbing the board in the air (nose / tail / middle), from Sandboarding, and holding it off your feet; handle-hold.js, grip-contact.js, adaptive-grip.js and grip-poses.js are the hand-fitting code it rests on
dist/src/skate/haptics.js  controller pulses
dist/src/skate/sfx.js      board sounds: one-shots on the skater's events, rolling and grinding loops that follow its speed
dist/src/skate/music.js    the soundtrack: the three tracks in dist/assets/music play one after another, forever (starts on the first click / key press / VR session; volume in `MUSIC`)
dist/src/skate/hud.js      grind balance gauge
dist/assets/skateboard.glb game version of the board (2 MB)
dist/assets/sfx/           the board sounds (mono Ogg Vorbis, 264 KB in all; tools/build-sfx.mjs makes them from source/sfx)
dist/assets/music/         the soundtrack, three mp3s at 96 kbps (4 MB in all)
dist/assets/levels/        optimised level models (foundry.glb)
dist/models/hands/         the hand rigs
tools/slim-skateboard.mjs  makes dist/assets/skateboard.glb from source/RIFT_Skateboard.glb
tools/build-foundry.mjs    builds the Foundry park from code (tools/foundry/: park.mjs the layout, geom.mjs shapes, bake-ao.mjs, probe.mjs)
tools/ride-line.mjs        rides the real skater from a level's entrance (push, then roll) and prints a trace of where it went and what happened
tools/check-loop.mjs       rides the real skater from a level's entrance into its loop, a few ways, and says whether it got round
tools/shoot-loop.mjs       screenshots from the rider's own view going round a loop
source/textures/           the CC0 Poly Haven texture sets Foundry uses (2K: colour, normal, AO/roughness/metal)
tools/export-blend.py      level .blend -> raw GLB, via Blender as a Python module (see Levels)
tools/optimise-level.mjs   raw level GLB -> merged, chunked, LOD'd, compressed game GLB (see Levels)
tools/measure-level.mjs    triangles / draw calls per view over a grid of ground positions, with and without LODs
tools/check-level.mjs      drives the real skater on a level: spawns, ground grid, every grind path
tools/shoot-level.mjs      screenshots a level from chosen spots
tools/plan-level.mjs       top-down plan of a level;  plan-collision.mjs: the same for its collision, coloured by height
tools/audit-level.mjs      compares what is drawn with what can be ridden (visible floor with no collision and the reverse)
tools/check-stairs.mjs     rolls the skater off the top of every stair set, with and without an ollie
tools/check-stair-tops.mjs what is at the top of each stair set (flat run, then a wall, a drop or nothing)
tools/check-board-off.mjs  fakes controllers, grabs the board in mid-air, takes it off, swings it out (a Christ Air), misses a catch out there and catches it under the feet
tools/check-grab.mjs       fakes two controllers in a headless browser, grabs the nose / tail / sides of the board in mid-air and checks the hand lands on the edge (optional screenshots);  see also below
tools/check-ramps.mjs      finds every ramp in the collision and rides up it at a given speed (stops dead? bails? gets to the top?)
tools/ride-ramp.mjs        traces the skater riding at a ramp from a point and heading;  profile-ramp.mjs: collision vs visible height along a line
tools/patches/<level>.py   (none at the moment) fixes run inside Blender on every export of a level's .blend (see Levels)
tests/                     simulation tests
```

The board's origin is where the wheels meet the ground and the nose points down −Z. Heading `h` points the nose along
(−sin h, 0, −cos h). Rails have no collision of their own; they only exist as grind paths.

## Levels

A level is a GLB with `ENV_*` render meshes, `COL_*` collision meshes (invisible), `PATH_*` grind paths (node extras, role
`grind_path`) and a `Spawn_Entrance` node. Add it to `dist/src/skate/levels.js` with its play-area `bounds` (the skater is
kept inside them) and the `?level=` id it answers to.

A level built in Blender: `tools/export-blend.py` turns the `.blend` into a raw GLB (it runs Blender as a Python module, so no
Blender install is needed; setup in the file), and `node tools/optimise-level.mjs <raw.glb> dist/assets/levels/<level>.glb [tweaks.json]`
turns that into the game file. The optimiser:

- bakes every object's transform and merges everything that shares a material, so thousands of separate objects do not become
  thousands of draw calls (collision pieces are merged by area, `COL_<Area>`, and otherwise left exactly as exported);
- cuts the render meshes into chunks with a quadtree (a square only splits while it holds too many triangles), so culling works
  and sparse things such as rails stay a single draw call;
- gives every chunk LOD1/LOD2 copies, swapped in by distance to the chunk's box (`lod.js`). Geometry is simplified with locked
  borders so chunks do not crack apart; leaf cards are thinned (whole leaves dropped, the rest scaled up) instead;
- quantises positions, normals and colours, resizes textures (base/normal 1024², ORM 512², or `textureSizes` in the tweaks file)
  to WebP, and meshopt-compresses the buffers.

**Fixes to a model (`tools/patches/<level>.py`).** `export-blend.py` can run a patch file inside Blender just before exporting, so
fixes survive each new version of the `.blend`. A tweaks file can re-point or tint materials in the optimiser. Thin joint and
marking lines are decals: the game gives them a depth offset (`decals` in `levels.js`); thin-shell walls can be drawn on both sides
(`doubleSided`). `audit-level.mjs` compares what is drawn with what can be ridden.

`node tools/measure-level.mjs <level>` reports what a headset would be asked to draw (triangles and draw calls per view, with and
without LODs); `node tools/check-pops.mjs <level>` ollies from random spots; `node tools/check-level.mjs <level>` rides the real
skater over the level (spawns, a grid of ground points, every grind path); `node tools/shoot-level.mjs <level> <dir> x,z,heading …`
takes screenshots. (Two earlier levels, the Eastbank school campus and a Burnside rebuild, were removed; they are in the git
history, and the school's raw export is on the `level/eastbank-school` branch.)

## Mega Ramp

`?level=megaramp`. A competition mega ramp built in Blender by another AI from `docs/briefs/megaramp.md`: a 25 m roll-in, the big
launch and gap with a landing knuckle and downslope, a practice launch and gap beside it, and an 8–9 m vert quarter pipe; truss
structure and signage. The source is `source/levels/megaramp/megaramp.blend` (textures packed in it). It ships **raw** (not through
the optimiser, so its 2K textures are untouched): `tools/export-blend.py` writes `dist/assets/levels/megaramp.glb` (21 MB, about
620k triangles). Re-export after changing the .blend:

```
uv venv .venv-bpy --python 3.13 && uv pip install --python .venv-bpy/bin/python bpy     # once (Blender as a Python module)
.venv-bpy/bin/python -c "exec(open('tools/export-blend.py').read())" -- source/levels/megaramp/megaramp.blend dist/assets/levels/megaramp.glb /tmp
npm run manifest
```

(Running the script as `-c "exec(…)"` rather than as a file avoids a Blender 5 start-up crash, "InitGoogleLogging() twice".)
`node tools/ride-line.mjs megaramp` rides it from the top and prints a trace: on the first ride it reaches 18 m/s off the roll-in,
clears the gap onto the knuckle (landing impact about 8 m/s; the bail limit is 13) and airs about 4 m out of the quarter pipe.

## Foundry

`?level=foundry`. A park built entirely from code rather than Blender: `node tools/build-foundry.mjs` writes
`dist/assets/levels/foundry.glb` (under a minute; it runs the usual optimiser at the end, with `tools/foundry/foundry.tweaks.json`). Change the park in
`tools/foundry/park.mjs` and rebuild; `node tools/foundry/probe.mjs x0,z0 x1,z1` prints the collision heights along a line without a
browser.

What is in it (x is east, z is south; you start on the tower facing east):

- **Start tower** (6.5 m, north-west corner): a 26° roll-in east into the **loop** (4.6 m teardrop, ply on an orange steel frame), a
  run-out to a 3.3 m **quarter pipe**; and a 30° bank south into the plaza.
- **Street**: the **Big Seven** (7 stairs, two handrails, a hubba), the **five** (handrail and hubba, faces east), the **three**
  (centre rail, faces north), each with a bank up to its deck; a long ledge, a flat bar, a manual pad, a **funbox** with a kinked rail
  beside it, a **curved ledge**, a kicker, and a seat-height ledge all round the outside wall.
- **Transition**: a ply **mini half-pipe** (1.8 m), a 2.4 m deep **bowl** with pool coping and a tile band, a smaller quarter pipe.

Every rail, ledge edge and coping has a grind line (28 in all). The look: 2K Poly Haven CC0 textures (`source/textures`, colour
maps graded at build time), rounded edges on the concrete, and ambient occlusion plus a little weathering baked into the vertex
colours (a 0.3 m grid), so contact shadows under ledges, in stair corners and in the bowl cost nothing on the headset. It has its
own lighting (`look` in `levels.js`: Neutral tone mapping, a lower, warmer, stronger sun, less fill, a clear sky); levels without
a `look` keep the original lighting. On the measuring grid the worst view is about 315k triangles and 71 draw calls
(`node tools/measure-level.mjs foundry 8`); 14.5 MB to download, about 250 MB of texture memory uncompressed. If that is too much
on the headset, set `textureSizes` in `tools/foundry/foundry.tweaks.json` back to 1024 and rebuild (about 5 MB, a quarter of the
memory). The materials are named by kind (`Concrete | brushed slab`, `Concrete | smooth transition`, `Concrete | precast`,
`Timber | ply deck`, `Steel | …`), so swapping in shared PBR sets later is a change to `MATERIALS` in `park.mjs`.

Checks that pass on it: `check-level` (both spawns, the ground grid, all 28 grind lines catch), `check-stairs` (all three sets, rolled
and ollied), `check-loop` (round the loop from the tower whether you hold forward, push and coast, or just roll off).

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
