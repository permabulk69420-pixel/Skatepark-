import * as THREE from 'three';

// Ground and wall queries against the park's invisible collision meshes. A cheap XZ box test picks the few
// meshes worth raycasting, so each query touches a handful of triangles instead of all 116 colliders.
export class SkateWorld {
  constructor(colliders) {
    this.colliders = colliders;
    this.boxes = colliders.map((mesh) => new THREE.Box3().setFromObject(mesh));
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.candidates = [];
    this.normal = new THREE.Vector3();
  }

  gather(minX, maxX, minZ, maxZ, minY, maxY) {
    const out = this.candidates;
    out.length = 0;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.max.x < minX || b.min.x > maxX || b.max.z < minZ || b.min.z > maxZ || b.max.y < minY || b.min.y > maxY) continue;
      out.push(this.colliders[i]);
    }
    return out;
  }

  // First upward-facing surface below (x, fromY, z). Back faces are culled, so a point inside solid
  // geometry finds nothing — callers read that as "you are in a wall".
  ground(x, z, fromY, out, maxDrop = 30) {
    const list = this.gather(x - 0.01, x + 0.01, z - 0.01, z + 0.01, fromY - maxDrop, fromY + 0.001);
    if (!list.length) return null;
    const ray = this.raycaster;
    ray.ray.origin.set(x, fromY, z);
    ray.ray.direction.set(0, -1, 0);
    ray.near = 0;
    ray.far = maxDrop;
    const hits = ray.intersectObjects(list, false);
    if (!hits.length) return null;
    const hit = hits[0];
    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (this.normal.y < 0.05) return null;
    out.y = hit.point.y;
    out.nx = this.normal.x; out.ny = this.normal.y; out.nz = this.normal.z;
    out.object = hit.object;          // which collision mesh (the sounds tell wood from concrete by its name)
    return out;
  }

  // Any-direction ray against the collision meshes (front faces only). Fills out.dist and the surface normal.
  cast(origin, dir, far, out) {
    const ex = origin.x + dir.x * far, ey = origin.y + dir.y * far, ez = origin.z + dir.z * far;
    const list = this.gather(
      Math.min(origin.x, ex) - 0.05, Math.max(origin.x, ex) + 0.05,
      Math.min(origin.z, ez) - 0.05, Math.max(origin.z, ez) + 0.05,
      Math.min(origin.y, ey) - 0.05, Math.max(origin.y, ey) + 0.05);
    if (!list.length) return null;
    const ray = this.raycaster;
    ray.ray.origin.copy(origin);
    ray.ray.direction.copy(dir);
    ray.near = 0;
    ray.far = far;
    const hits = ray.intersectObjects(list, false);
    if (!hits.length) return null;
    const hit = hits[0];
    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    out.dist = hit.distance;
    out.nx = this.normal.x; out.ny = this.normal.y; out.nz = this.normal.z;
    return out;
  }
}
