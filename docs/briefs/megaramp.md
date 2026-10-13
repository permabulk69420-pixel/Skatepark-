# Brief: a mega ramp level for the Skatepark VR game

You are making one 3D level file for a Quest 3 WebXR skateboarding game (three.js). You do not need the game's code: this brief is
the contract. Build it the size of a real competition mega ramp. **Do not scale it down to be safe**: the game's physics will be
tuned to the ramp afterwards, not the other way round.

## What to hand back

1. `megaramp.glb`: glTF 2.0 binary, everything in it (textures embedded).
2. The source you built it from (a `.blend`, or the script that generates it), so it can be changed later.
3. `megaramp.md`: the main dimensions you used, the play-area rectangle (see Spawn and play area), and anything you were unsure of.
4. Two or three screenshots (from the top of the roll-in, from the side showing the whole ramp, from the bottom of the quarter pipe).
5. **A download link for all of it** (a zip is fine). If you were given access to the GitHub repo instead, commit the files to
   `source/levels/megaramp/` on a new branch and say which branch. Do not touch anything in `dist/`.

## Units and axes

- Metres. Y is up. The ground is y = 0.
- Keep everything within 250 m of the origin.
- Apply all transforms before export (no scaled or rotated parents, no negative scale), so every vertex and every point listed below
  is in world space.

## The ramp (real mega ramp proportions; go big)

One straight line, running along **−Z** (the rider starts at the top of the roll-in and travels towards −Z):

| Part | Size (about) |
| --- | --- |
| Start deck on top of the roll-in tower | 23–27 m up, at least 4 × 4 m, railing round the back and sides (visual only) |
| Roll-in | straight slope 45–50°, then a long curved transition (radius 12–15 m) into flat |
| Run-up | 10–15 m of flat |
| Launch ramp (kicker) | 3.5–4.5 m tall, curved (radius about 6–8 m), its lip about 30–35° |
| Gap | 15–20 m from the launch lip to the start of the landing (open: the ground below is the floor at y = 0) |
| Landing | a short flat "knuckle" deck level with the top of the gap, then a downslope of 25–30°, 25–30 m long, curving into flat |
| Run-out | 15–20 m of flat |
| Quarter pipe | 8–9 m tall: transition radius about 7–8 m, **ending vertical**, plus 0.5–1 m of straight vertical wall, steel coping, and a flat deck behind |
| Width | 8–10 m all along (the quarter pipe can be a little wider) |

Also add a **smaller second launch ramp beside the big one, or a second landing start, for a shorter gap (8–10 m)**, so there is an
easier line to learn on. Steel scaffold or truss under the decks and slopes looks great; make it visual only (no collision).

## The riding surface rules (these matter: the physics depends on them)

- **Transitions under a coping must end exactly vertical (90°)**, then go straight up a little before the coping and deck. A
  transition that stops at 60–70° and goes into a flat deck does not ride well in this game.
- Banks and slopes that roll over into a flat deck (the top of the roll-in, the landing knuckle) are fine up to about 70° and should
  be rounded over the crest, not a sharp corner.
- Every surface you roll on must be continuous: no steps over 2 cm, no gaps, no overlaps that stick up. Where a ramp meets the
  ground, start it at the ground height (it may sit 0.5 cm above to avoid flicker).
- Curves must be smooth: at most about 3° between neighbouring faces along any transition (more segments is better; the game
  reduces the drawn ones itself).

## How the file has to be organised

The game reads the file by node names and by custom properties (glTF "extras"; in Blender, add them as Custom Properties and export
with **Include → Custom Properties** ticked).

### 1. What you see: render meshes

- Any number of meshes, any names (prefix `ENV_` is nice but not needed).
- PBR metallic-roughness materials. Name each material `Kind | description`, e.g. `Timber | ply deck`, `Steel | galvanized coping`,
  `Steel | painted truss`, `Concrete | ground`. The kind before the `|` is how materials will be swapped for shared textures later.
- Textures are optional (plain colours are fine; shared textures get added later). If you use texture sets, name the images
  `<set>_base`, `<set>_normal` and `<set>_orm` (colour, normal, AO-roughness-metal), up to 2048².
- Up to about 500k triangles is fine; detail is welcome (the game cuts it into chunks and makes distance LODs itself).

### 2. What you ride on: collision meshes (invisible)

- Separate meshes whose names start with **`COL_`**, then an area name, e.g. `COL_Rollin`, `COL_Launch`, `COL_Landing`,
  `COL_Quarter`, `COL_Ground`. Give each the custom property `role` = `collision`.
- They are the solid outer surfaces of everything you can ride or hit: every riding surface, the sides and backs of ramps, the decks,
  and a ground plane covering the whole play area. No railings, no coping pipes, no scaffold.
- **Triangles must face outwards** (counter-clockwise seen from outside; normals pointing away from the solid). Riding surfaces face
  up/into the ramp. The game's raycasts ignore back faces, so a flipped face is a hole.
- Usually this is the riding surfaces of the render mesh, without bevels and small details. Keep it under about 50k triangles.

### 3. What you grind: grind lines

Empty nodes (no mesh), named **`PATH_<name>`**, at the origin with no transform, each with these custom properties:

| property | value |
| --- | --- |
| `role` | `grind_path` |
| `kind` | `coping`, `rail` or `ledge` |
| `closed` | `false` (true only for a closed loop) |
| `radius` | metres, e.g. `0.035` for coping |
| `points` | one flat list of numbers `[x, y, z, x, y, z, …]` in world space, at least 2 points |

- **Coping** (the quarter pipe lip, any deck edges you want grindable): the points run along the centre of the coping pipe. Put
  the pipe centre 1 cm above the deck at the lip, radius 0.035, so its top is 4.5 cm above the deck.
- **Rails** (if you add any): the points are the rail's centreline.
- **Ledges**: the points run 3 cm in from the edge, at the ledge top + 0.9 × radius.

### 4. Spawn and play area

- An empty node named **`Spawn_Entrance`**, placed on the start deck about 2 m back from the edge of the roll-in, at deck height,
  with custom properties `role` = `spawn` and `heading_radians` = `0` (the rider faces −Z, down the roll-in). If you have to face
  another way: the rider's nose points along (−sin h, 0, −cos h) for heading h.
- In `megaramp.md`, give the play area as a rectangle on the ground: its centre (x, z) and half-widths (x, z). The rider is kept
  inside it, so it should cover the whole ramp and its run-outs.

## Before you send it

- Open the `.glb` in a viewer (e.g. https://gltf-viewer.donmccurdy.com) and check it looks right, and run it through the Khronos
  glTF validator (https://github.khronos.org/glTF-Validator/) with no errors.
- List every node name with its custom properties in `megaramp.md`, so it can be checked without opening the file.
- Check the roll-in top, the landing knuckle and the quarter-pipe lip in particular: smooth, continuous, transition vertical
  under the coping.

What happens afterwards (not your job): the file goes through the game's level optimiser, gets an entry in its level list, and its
physics gets tuned for mega ramp speeds.
