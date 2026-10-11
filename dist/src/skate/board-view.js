import * as THREE from 'three';
import { BOARD } from './config.js';
import { Mode } from './sim.js';

const UP = new THREE.Vector3(0, 1, 0);
const _hit = { y: 0, nx: 0, ny: 1, nz: 0 };
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();

function makeBlobShadow() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}

// The RIFT board in the scene: follows the sim, spins its wheels, and drops a blob shadow so height reads in VR.
export class BoardView {
  constructor(scene, model) {
    this.root = new THREE.Group();
    this.root.name = 'skateboard';
    this.model = model;
    this.root.add(model);
    this.wheels = [];
    model.traverse((node) => {
      if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; node.frustumCulled = false; }
      if (/^Wheel_/.test(node.name)) this.wheels.push(node);
    });
    this.shadow = makeBlobShadow();
    scene.add(this.root, this.shadow);
  }

  update(sim, dt) {
    const bailing = sim.mode === Mode.BAIL && sim.bailBoard;
    if (bailing) {
      this.root.position.copy(sim.bailBoard.pos);
      this.root.quaternion.copy(sim.bailBoard.quat);
    } else {
      this.root.position.copy(sim.pos).addScaledVector(sim.up, sim.manualLift);
      sim.boardQuaternion(this.root.quaternion);
    }
    const spin = -(sim.rollSpeed / BOARD.wheelRadius) * dt;
    for (const wheel of this.wheels) wheel.rotation.x += spin;

    const base = bailing ? this.root.position : sim.pos;
    const hit = sim.world.ground(base.x, base.z, base.y + 0.6, _hit, 40);
    if (!hit) { this.shadow.visible = false; return; }
    const height = Math.max(0, base.y - hit.y);
    const fade = THREE.MathUtils.clamp(1 - height / 4.5, 0, 1);
    this.shadow.visible = fade > 0.02;
    this.shadow.material.opacity = fade;
    this.shadow.position.set(base.x, hit.y + 0.012, base.z);
    _n.set(hit.nx, hit.ny, hit.nz);
    this.shadow.quaternion.copy(_q.setFromUnitVectors(UP, _n));
    // Same heading as the board, so the long blob lines up with the deck.
    _q.setFromAxisAngle(UP, sim.heading);
    this.shadow.quaternion.multiply(_q);
    const size = 0.5 + height * 0.09;
    this.shadow.scale.set(size * 0.75, 1, size * 1.55);
  }
}
