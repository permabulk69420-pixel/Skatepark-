# Brief for Codex: building skate levels for the Skatepark game

Paste this at the start of a level task.

---

You are building a skate level for a Quest 3 browser (WebXR) skateboarding game in the style of Tony Hawk's Pro Skater. The game code, the optimisation pipeline and the tests live on `main`. Your job is the level model only.

## What not to touch
- Do not edit anything in `dist/src`, `dist/index.html`, `dist/manifest.json`, `tests/`, `tools/` or `.github/`.
- Do not commit temporary builders, zips or workflows. Commit the finished model only, once per milestone. Every re-commit of a ~80 MB GLB adds 80 MB to the repo for good.
- Do not put the final model in `dist/assets/`. Export the raw GLB to `source/levels/<name>.raw.glb` on your branch. I run `node tools/optimise-level.mjs` on it (chunking, LODs, texture and geometry compression) and ship the result. The previous level only ran well because of that step.

## Budgets (the raw export, before my optimiser)
- At most about 2 million triangles for the whole level, at most about 25 materials, and reuse the existing material and texture sets. Do not add a unique texture per object. Textures must tile, at most 2048².
- **Trees:** do not model individual leaves or branches. The last level spent 40% of its triangles on 97,000 leaf cards and 1,800 bark pieces, which is wasted. Use a simple placeholder: a trunk and a small blob canopy, under 300 triangles each, as separate objects named `PROP_Tree_*`. We will replace them later. Use few of them.
- Keep geometry efficient: no hidden faces, no tiny bevels on things nobody sees, no decoration far from any skateable surface.
- Scale is 1 unit = 1 metre, Y up. Bake all transforms (every node must be identity).

## Naming and data (the game reads these)
- Visible meshes: `ENV_*`. One mesh per material per area is plenty.
- Collision: separate, invisible, simple `COL_*` meshes. They must be closed solids with outward-facing winding, because the game raycasts front faces only, and at least 0.3 m thick. Every skateable surface needs one: floors, stairs, ramps, banks, ledges, walls. Make curved ramps and bowls smooth, with at least 12 segments per quarter-pipe curve.
- Grind paths: empty nodes named `PATH_*` with extras `{ "role": "grind_path", "kind": "rail" | "ledge" | "coping", "radius": 0.03, "closed": false, "points": [x,y,z, x,y,z, ...] }`. Every rail, ledge edge and coping needs one.
- Spawns: `Spawn_Entrance` (extras `heading_radians`) and more `Spawn_*` nodes.
- Check your own work before committing: open the level and ride every line. If you cannot ride it, I cannot ride it.

## Design critique of the first school, and what to do instead
It is one big flat square courtyard with buildings round the edge and furniture scattered on it. It is 180 × 150 m, but it feels small, because it is mostly empty concrete, so there is nothing to ride to. Several details were lazy: classroom doors, and a lone locker in the middle of nowhere.

Build it like a Tony Hawk level, from designed sections with lines through them:
1. **Sections, not a square.** Make 5 to 7 distinct areas with their own character, for example: a quad with banks and a fun box, a stair set with a rail, a covered walkway or hall, a loading dock with a gap, a drainage bowl or half-pipe, a rooftop or upper level, a plaza with ledges and manual pads. Each one should hold a clear line of 3 to 5 tricks, such as bank to ledge to rail to gap.
2. **Flow.** Connect the sections into loops you can ride continuously, with no dead ends. Each section should be about 2 to 4 seconds of rolling from the next, around 15 to 30 m at skating speed. Density beats distance: a skateable feature every 15 to 25 m, and no big empty stretches.
3. **Vertical variety.** Use at least three elevations, joined by ramps, banks, stairs and drop-ins. Include quarter-pipes against walls, a hip or spine, a bowl or pool, and a wallride. Put gaps and transfers between levels. Give a loop to ride at the top.
4. **Interiors and details.** Include a corridor or hall that can be ridden through, with open doorways, rows of lockers you can ledge along, benches, handrails and window ledges. Do real doors and real lockers instead of one placed in the middle. Keep the triangle count low.
5. **Readability.** Give each section a landmark (a clock tower, a gym, a stand of tall trees) so a player in a headset knows where they are. Keep the first 20 seconds from the spawn easy, with a gentle bank and an obvious first line.
6. **Surfaces.** Vary them: smooth concrete, brick, timber, asphalt. Keep signage readable from the front, not mirrored.

When you are done, list the lines you built and every spawn, so I can test them.
