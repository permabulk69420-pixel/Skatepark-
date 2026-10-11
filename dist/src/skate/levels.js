// The levels the game can load, picked with ?level=<id> (default: the first one). Each entry says where its model is and the few
// things that differ per level: how far the static sun shadow has to reach, which meshes are left out of it, and the intro text.
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
    blurb: '180 × 150 metres · School campus: stairs, rails, ledges and a drainage basin · RIFT board',
    bounds: { x: 87.5, z: 67, cz: 2.5 },
    shadowHalf: 100,
    // Ground slabs and terrain do not cast; trees, buildings and props do.
    noShadow: /Landscape_Landscape|Site_Concrete|Site_Asphalt|Asphalt/
  }
};

export const DEFAULT_LEVEL = 'breakwater';

export function pickLevel(search) {
  const id = new URLSearchParams(search).get('level');
  return LEVELS[id] ? id : DEFAULT_LEVEL;
}
