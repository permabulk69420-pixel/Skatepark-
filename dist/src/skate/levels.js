// The levels the game can load, picked with ?level=<id> (default: the first one). Each entry says where its model is and the few
// things that differ per level: how far the static sun shadow has to reach (around `center`, default the origin), which meshes
// are left out of it, `decals` (an optional regex of material names that are drawn flat on other surfaces), `doubleSided` (material names to draw on both sides)
// and the intro text. `look` (optional) overrides the lighting: toneMapping ('aces' | 'agx' | 'neutral'), exposure, sun (intensity),
// sunColor, sunDirection ([x, y, z] towards the sun), hemisphere (fill intensity), environment (sky reflections), fog (colour).
export const LEVELS = {
  flightline: {
    name: 'Flightline',
    menu: { group: 'Built parks', short: '1 km downhill big-air run: ten gaps, rails and a vert finish' },
    file: 'assets/levels/flightline.glb',
    blurb: '1 km downhill Big Air circuit · Ten linked gaps from 8 to 32 m, a shorter-gap route, four gap-spanning rails and a 10.5 m vert finish · RIFT board',
    bounds: { x: 86, z: 566.37, cx: 4, cz: -496.37 },
    center: { x: 4, z: -496.37 },
    skyCenter: { x: 4, z: -496.37 },
    cameraFar: 1500,
    shadowHalf: 580,
    shadowDistance: 850,
    shadowFar: 1700,
    noShadow: /ENV_apron_|ENV_terrain_|ENV_joint_|ENV_marking_/,
    decals: /Paint/,
    look: { toneMapping: 'neutral', exposure: 0.74, sun: 3.4, sunColor: '#ffdcb4', sunDirection: [-0.62, 0.5, -0.6], hemisphere: 0.25, environment: 0.5, fog: '#c4d4de', fogNear: 320, fogFar: 1300 }
  },
  switchyard: {
    name: 'Switchyard',
    menu: { group: 'Built parks', short: 'Huge park: 30 ft vert halfpipe, spine, flow bowl, 24 stairs' },
    file: 'assets/levels/switchyard.glb',
    blurb: '194 × 172 metres · 30-foot vert halfpipe, 20-foot transitions, 15-foot spine, deep flow bowl, 24 stairs and a sweeping boardslide rail · RIFT board',
    bounds: { x: 96.75, z: 85.75, cx: 5, cz: 6 },
    shadowHalf: 115,
    noShadow: /ENV_slab_|ENV_apron_|ENV_joints_|ENV_marking_|ENV_blue_/,
    decals: /Construction|Paint/,
    look: { toneMapping: 'neutral', exposure: 0.76, sun: 3.3, sunColor: '#ffead3', sunDirection: [-0.5, 0.62, -0.6], hemisphere: 0.28, environment: 0.65, fog: '#c4d1d4', fogNear: 210, fogFar: 500 }
  },
  breakwater: {
    name: 'Breakwater',
    menu: { group: 'Built parks', short: 'Street, bowl and transition. The original park' },
    file: 'assets/skatepark.glb',
    blurb: '104 × 88 metres · Street, bowl and transition · RIFT board',
    // Play area the skater is kept inside (half-extents around an optional centre); a level's collision decides it.
    bounds: { x: 54.6, z: 46.3 },
    shadowHalf: 85,
    noShadow: /Landscape|Asphalt/
  },
  megaramp: {
    name: 'Mega Ramp',
    menu: { group: 'Built parks', short: 'Competition mega ramp with a big gap and a vert quarter' },
    file: 'assets/levels/megaramp.glb',
    blurb: 'Competition mega ramp · 25 m roll-in, the big gap and a practice gap, a vert quarter pipe · RIFT board',
    // Built in Blender (source/levels/megaramp/megaramp.blend), exported raw by tools/export-blend.py (not optimised).
    bounds: { x: 31.5, z: 81.5, cx: 0, cz: -60 },
    shadowHalf: 88,
    center: { x: 0, z: -60 },
    noShadow: /Ground|Apron|Collision/i,
    look: { toneMapping: 'neutral', exposure: 0.74, sun: 3.4, sunColor: '#ffdcb4', sunDirection: [-0.62, 0.5, -0.6], hemisphere: 0.25, environment: 0.5, fog: '#c4d4de' }
  },
  france25: {
    name: 'France 25 stair',
    menu: { group: 'Built parks', short: 'A 25-stair with banks, rails and a plaza' },
    file: 'assets/levels/france25.glb',
    blurb: 'A 25-stair, its banks, rails and the plaza round it · RIFT board',
    // Built from code after photos of the real one (tools/france25/park.mjs, node tools/build-level.mjs france25).
    bounds: { x: 12.9, z: 40, cx: 12.5, cz: 6 },
    shadowHalf: 46,
    center: { x: 12.5, z: 6 },
    decals: /Construction/,
    noShadow: /Construction|pavers/,
    // Afternoon sun on the terracotta facade.
    look: { toneMapping: 'neutral', exposure: 0.74, sun: 3.4, sunColor: '#ffdcb4', sunDirection: [0.55, 0.55, -0.62], hemisphere: 0.25, environment: 0.5, fog: '#c4d4de' }
  },
  funbox: {
    name: 'Funbox',
    menu: { group: 'Scanned parks', short: 'A real funbox, scanned: bank and an up-flat-down ledge' },
    file: 'assets/levels/funbox.glb',
    blurb: 'A photogrammetry scan of a real funbox · 2K textures, bank, up-flat-down ledge · scan by matousekfoto (CC-BY 4.0) · RIFT board',
    // Built from a scan by tools/build-scan-level.mjs (source/scans/matousekfoto-skatepark/level.json), then tools/optimise-level.mjs.
    bounds: { x: 19, z: 19, cx: 0, cz: 0 },
    shadowHalf: 30,
    noShadow: /ENV_Concrete_ground/,
    look: { toneMapping: 'neutral', exposure: 0.74, sun: 3.4, sunColor: '#ffdcb4', sunDirection: [-0.62, 0.5, -0.6], hemisphere: 0.25, environment: 0.5, fog: '#c4d4de' }
  },
  gravesend: {
    name: 'Gravesend 8K',
    menu: { group: 'Scanned parks', short: 'The real Gravesend park: banks, ledges, a rail, quarter and stairs. 8K textures' },
    file: 'assets/levels/gravesend.glb',
    blurb: 'A photogrammetry scan of the real Gravesend skatepark · 8K textures, banks, ledges, rail, a quarter and stairs · scan by artfletch (CC-BY 4.0) · RIFT board',
    // Built from a scan by tools/build-scan-level.mjs (source/scans/gravesend-skatepark/level.json), then tools/optimise-level.mjs.
    bounds: { x: 29, z: 22.5, cx: 0, cz: 0 },
    shadowHalf: 52,
    noShadow: /^$/,
    look: { toneMapping: 'neutral', exposure: 0.74, sun: 3.4, sunColor: '#ffdcb4', sunDirection: [-0.62, 0.5, -0.6], hemisphere: 0.25, environment: 0.5, fog: '#c4d4de' }
  },
  gravesend4k: {
    name: 'Gravesend 4K',
    menu: { group: 'Scanned parks', short: 'Gravesend with lighter 4K textures, for comparing' },
    file: 'assets/levels/gravesend-4k.glb',
    blurb: 'The same Gravesend scan with 4K textures, for comparing against the 8K one · scan by artfletch (CC-BY 4.0) · RIFT board',
    // Built from a scan by tools/build-scan-level.mjs (source/scans/gravesend-skatepark/level.json), then tools/optimise-level.mjs.
    bounds: { x: 29, z: 22.5, cx: 0, cz: 0 },
    shadowHalf: 52,
    noShadow: /^$/,
    look: { toneMapping: 'neutral', exposure: 0.74, sun: 3.4, sunColor: '#ffdcb4', sunDirection: [-0.62, 0.5, -0.6], hemisphere: 0.25, environment: 0.5, fog: '#c4d4de' }
  },
  gravesendnight: {
    name: 'Gravesend Night',
    menu: { group: 'Scanned parks', short: 'Gravesend after dark: LED floods, lamps, moon and stars' },
    file: 'assets/levels/gravesend-4k.glb',
    blurb: 'The Gravesend scan after dark · lit by cool white LED floods, with a big pool of light from where the sun was and three lamps · scan by artfletch (CC-BY 4.0) · RIFT board',
    // The same file as Gravesend 4K. The scan's lighting is baked in, so the night is made in its material (src/skate/night.js).
    bounds: { x: 29, z: 22.5, cx: 0, cz: 0 },
    shadowHalf: 52,
    noShadow: /^$/,
    // sunDirection is the moon: up and ahead of the spawn (the floodlight below still comes from where the sun was when the scan was photographed).
    look: { toneMapping: 'neutral', exposure: 1.0, sun: 0.25, sunColor: '#9db8ff', sunDirection: [-0.45, 0.53, -0.71], hemisphere: 0.12, environment: 0.02, fog: '#03060d', fogNear: 18, fogFar: 85 },
    night: {
      // the moon is up and ahead, to the right of where the rider starts (the faint moonlight on the board comes from it too)
      sky: { moon: [-0.45, 0.53, -0.71] },
      ambient: '#0b1426',
      key: { direction: [0.31, 0.42, 0.85], colour: '#bcd6ff', strength: 0.9, centre: [0, 0], radius: 14 },
      lamps: [
        { base: [-24, 1.99, -17], height: 9, colour: '#d6e6ff', power: 1.5, radius: 15, glow: 9 },
        { base: [23, 1.93, 2], height: 9, colour: '#d6e6ff', power: 1.5, radius: 15, glow: 9 },
        { base: [-4, 2.16, 16], height: 9, colour: '#d6e6ff', power: 1.5, radius: 15, glow: 9 }
      ]
    }
  },
  undercroft15: {
    name: 'Undercroft 1.5x',
    menu: { group: 'Scanned parks', short: 'The Southbank Undercroft in London at 1.5x size' },
    file: 'assets/levels/undercroft-1-5x.glb',
    blurb: 'The real Southbank Undercroft in London, scanned, at 1.5 times real size · 8K texture · scan by artfletch (CC-BY 4.0) · RIFT board',
    // Built from a scan by tools/build-scan-level.mjs (source/scans/southbank-undercroft/level.json, scale 1.5), then tools/optimise-level.mjs.
    // The scan has holes and open sides, so the play area is only its best covered floor and the rest fades into the dark.
    bounds: { x: 33, z: 16.5, cx: 0, cz: 0 },
    noSky: true,
    shadowHalf: 45,
    noShadow: /^$/,
    look: { toneMapping: 'neutral', exposure: 1.0, sun: 0.2, sunColor: '#bcd0ff', hemisphere: 0.15, environment: 0.05, fog: '#07080b', fogNear: 45, fogFar: 142 }
  },
  undercroft2: {
    name: 'Undercroft 2x',
    menu: { group: 'Scanned parks', short: 'The Southbank Undercroft in London at 2x size' },
    file: 'assets/levels/undercroft-2x.glb',
    blurb: 'The real Southbank Undercroft in London, scanned, at twice real size · 8K texture · scan by artfletch (CC-BY 4.0) · RIFT board',
    // Built from a scan by tools/build-scan-level.mjs (source/scans/southbank-undercroft/level.json, scale 2), then tools/optimise-level.mjs.
    // The scan has holes and open sides, so the play area is only its best covered floor and the rest fades into the dark.
    bounds: { x: 44, z: 22, cx: 0, cz: 0 },
    noSky: true,
    shadowHalf: 60,
    noShadow: /^$/,
    look: { toneMapping: 'neutral', exposure: 1.0, sun: 0.2, sunColor: '#bcd0ff', hemisphere: 0.15, environment: 0.05, fog: '#07080b', fogNear: 60, fogFar: 190 }
  },
  foundry: {
    name: 'Foundry',
    menu: { group: 'Built parks', short: 'Start tower with a loop, stair sets, rails, hubbas, bowl and mini ramp' },
    file: 'assets/levels/foundry.glb',
    blurb: '80 × 72 metres · A 6.5 m start tower with a loop-the-loop, 7-, 5- and 3-stair sets, rails, hubbas, ledges, a funbox, a bowl and a mini ramp · RIFT board',
    bounds: { x: 39.55, z: 35.55, cx: 0, cz: 0 },
    shadowHalf: 58,
    // Saw-cut joints and painted lines lie on the slab.
    decals: /Construction|Paint/,
    // The slab and the apron round the park do not cast.
    noShadow: /Concrete_brushed|Concrete_apron|Construction|Paint/,
    // A lower, warmer, stronger sun against less fill, under a clear blue sky: longer shadows and more shape to everything.
    look: { toneMapping: 'neutral', exposure: 0.74, sun: 3.4, sunColor: '#ffdcb4', sunDirection: [-0.62, 0.5, -0.6], hemisphere: 0.25, environment: 0.5, fog: '#c4d4de' }
  }
};

export const DEFAULT_LEVEL = 'breakwater';

// The order the start menu lists them in, by group (levels not listed here are added at the end of their group).
export const MENU_GROUPS = ['Scanned parks', 'Built parks'];
export const MENU_ORDER = ['gravesend', 'gravesendnight', 'undercroft15', 'undercroft2', 'funbox', 'gravesend4k', 'foundry', 'breakwater', 'switchyard', 'france25', 'megaramp', 'flightline'];

export function pickLevel(search) {
  const id = new URLSearchParams(search).get('level');
  return LEVELS[id] ? id : DEFAULT_LEVEL;
}
