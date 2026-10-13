// The levels the game can load, picked with ?level=<id> (default: the first one). Each entry says where its model is and the few
// things that differ per level: how far the static sun shadow has to reach (around `center`, default the origin), which meshes
// are left out of it, `decals` (an optional regex of material names that are drawn flat on other surfaces), `doubleSided` (material names to draw on both sides)
// and the intro text. `look` (optional) overrides the lighting: toneMapping ('aces' | 'agx' | 'neutral'), exposure, sun (intensity),
// sunColor, sunDirection ([x, y, z] towards the sun), hemisphere (fill intensity), environment (sky reflections), fog (colour).
export const LEVELS = {
  breakwater: {
    name: 'Breakwater',
    file: 'assets/skatepark.glb',
    blurb: '104 × 88 metres · Street, bowl and transition · RIFT board',
    // Play area the skater is kept inside (half-extents around an optional centre); a level's collision decides it.
    bounds: { x: 54.6, z: 46.3 },
    shadowHalf: 85,
    noShadow: /Landscape|Asphalt/
  },
  eastbank: {
    name: 'Eastbank school',
    file: 'assets/levels/eastbank-school.glb',
    blurb: '210 × 160 metres · School campus: seven linked sections, rails, ledges, a locker hall and a drainage basin · RIFT board',
    bounds: { x: 103.5, z: 77.5, cx: 7, cz: -8 },
    shadowHalf: 125,
    center: { x: 7, z: -8 },
    // Thin joint and marking lines lie flat on the floor at the same height; pull them a touch towards the camera so they never z-fight.
    decals: /Construction|Paint|ochre line/,
    // Walls and roofs here are thin shells with small gaps at the joints; drawing both sides means a gap shows the far wall, not the sky.
    doubleSided: /^(Brick|Concrete \| warm|School \| (opaque|ochre|oxidised|worn))/,   // not the cream enamel: that is the lettering, which must only read from the front
    // Ground slabs and terrain do not cast; trees, buildings and props do.
    noShadow: /Landscape_Landscape|Site_Concrete|Site_Asphalt|Asphalt/
  },
  burnside: {
    name: 'Burnside',
    file: 'assets/levels/burnside.glb',
    blurb: '30 × 35 metres · Pools, a central hip and a tunnel under the bridge · RIFT board',
    bounds: { x: 15, z: 17.2, cx: -5, cz: -2.7 },
    shadowHalf: 45,
    center: { x: -5, z: -3 },
    noShadow: /Asphalt/
  },
  foundry: {
    name: 'Foundry',
    file: 'assets/levels/foundry.glb',
    blurb: '80 × 72 metres · A 6 m start tower with a loop-the-loop, 7-, 5- and 3-stair sets, rails, hubbas, ledges, a funbox, a bowl and a mini ramp · RIFT board',
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

export function pickLevel(search) {
  const id = new URLSearchParams(search).get('level');
  return LEVELS[id] ? id : DEFAULT_LEVEL;
}
