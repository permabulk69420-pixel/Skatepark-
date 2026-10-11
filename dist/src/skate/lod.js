import * as THREE from 'three';

// Distance LODs for chunked levels (tools/optimise-level.mjs). Meshes that belong to one chunk share userData.lod.group;
// level 0 is the full detail, higher levels are cheaper copies that take over past their `from` distance. The distance is
// measured to the chunk's bounding box, so a big chunk keeps its detail while any part of it is close.
export class LodSet {
  constructor(root, { hysteresis = 0.08 } = {}) {
    this.hysteresis = hysteresis;
    this.groups = [];
    const byName = new Map();
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      const lod = object.isMesh && object.userData.lod;
      if (!lod) return;
      let group = byName.get(lod.group);
      if (!group) {
        group = { levels: [], box: new THREE.Box3(), current: -1 };
        byName.set(lod.group, group);
        this.groups.push(group);
      }
      object.geometry.computeBoundingBox();
      group.box.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      group.levels[lod.level] = { mesh: object, from: lod.from };
    });
    for (const group of this.groups) group.levels = group.levels.filter(Boolean);
    this.counts = [];
  }

  // Picks the level of every chunk for a viewer at `position` (world space). Returns how many chunks changed.
  update(position) {
    let changed = 0;
    for (const group of this.groups) {
      const distance = group.box.distanceToPoint(position);
      const levels = group.levels;
      let want = 0;
      for (let i = 1; i < levels.length; i++) {
        // Moving out needs a little more distance than moving in, so a chunk on the boundary does not flicker.
        const edge = levels[i].from * (group.current >= i ? 1 - this.hysteresis : 1 + this.hysteresis);
        if (distance >= edge) want = i;
      }
      if (want === group.current) continue;
      group.current = want;
      levels.forEach((level, i) => { level.mesh.visible = i === want; });
      changed++;
    }
    return changed;
  }

  // How many chunks sit at each level right now.
  census() {
    const out = [];
    for (const group of this.groups) out[group.current] = (out[group.current] || 0) + 1;
    return out;
  }
}
