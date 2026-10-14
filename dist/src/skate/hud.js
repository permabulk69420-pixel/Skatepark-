import * as THREE from 'three';
import { Mode } from './sim.js';

// Balance gauge for grinds. In VR it hangs in front of the player (fixed to the play space, not the head, so it
// never swims with your gaze); on a flat screen the same state also drives a plain DOM readout.
const BAR_W = 0.56;

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W, BAR_W * 96 / 512), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  mesh.renderOrder = 1002;
  mesh.userData.draw = (text, color = '#f4efe2') => {
    const ctx = canvas.getContext('2d');
    ctx.font = '600 52px system-ui, sans-serif';
    const lines = [];
    let line = '';
    for (const trick of text.split(' + ')) {
      const next = line ? `${line} + ${trick}` : trick;
      if (line && ctx.measureText(next).width > 480) { lines.push(line); line = trick; }
      else line = next;
    }
    lines.push(line);
    canvas.height = lines.length === 1 ? 96 : lines.length * 64 + 16;
    mesh.scale.y = canvas.height / 96;
    mesh.position.y = 0.105 + BAR_W * (canvas.height - 96) / 1024;
    ctx.font = '600 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(8,20,22,0.85)';
    for (let i = 0; i < lines.length; i++) {
      const y = canvas.height / 2 + 2 + (i - (lines.length - 1) / 2) * 64;
      ctx.strokeText(lines[i], 256, y, 480);
      ctx.fillStyle = color;
      ctx.fillText(lines[i], 256, y, 480);
    }
    texture.needsUpdate = true;
  };
  return mesh;
}

function flat(width, height, color, opacity = 1, z = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
  mesh.position.z = z;
  mesh.renderOrder = 1000 + Math.round(z * 1000);
  return mesh;
}

export function createHud({ rig, rider, sim }) {
  const group = new THREE.Group();
  group.name = 'grind-gauge';
  group.visible = false;
  const back = flat(BAR_W + 0.04, 0.085, 0x0d1c1f, 0.7);
  const safe = flat(BAR_W * 0.5, 0.05, 0x2f7d63, 0.9, 0.001);
  const warnL = flat(BAR_W * 0.25, 0.05, 0xb08a2e, 0.9, 0.001); warnL.position.x = -BAR_W * 0.375;
  const warnR = warnL.clone(); warnR.position.x = BAR_W * 0.375;
  const danger = flat(BAR_W * 0.04, 0.05, 0xb5412f, 0.95, 0.001);
  const dangerL = danger.clone(); dangerL.position.x = -BAR_W * 0.48;
  const dangerR = danger.clone(); dangerR.position.x = BAR_W * 0.48;
  const marker = flat(0.016, 0.105, 0xffffff, 1, 0.003);
  const label = makeLabel();
  label.position.y = 0.105;
  group.add(back, safe, warnL, warnR, dangerL, dangerR, marker, label);
  rig.add(group);

  const dom = document.querySelector('#hud');
  const domTrick = dom?.querySelector('[data-trick]');
  const domSpeed = dom?.querySelector('[data-speed]');
  const domBar = dom?.querySelector('[data-balance]');
  let shown = '';
  let message = '', messageTime = 0;

  function say(text, seconds = 1.4) { message = text; messageTime = seconds; }

  function setLabel(text, color) {
    if (text === shown) return;
    shown = text;
    label.userData.draw(text, color);
  }

  function update(dt) {
    messageTime -= dt;
    const g = sim.balance;
    const showMessage = messageTime > 0;
    group.visible = !!g || showMessage;
    if (group.visible) {
      // Straight ahead of where the player was looking when they stood on the board.
      group.position.set(rider.anchor.x - Math.sin(rider.yawCal) * 1.15, 1.0, rider.anchor.y - Math.cos(rider.yawCal) * 1.15);
      group.rotation.y = rider.yawCal;
      back.visible = safe.visible = warnL.visible = warnR.visible = dangerL.visible = dangerR.visible = marker.visible = !!g;
      if (g) {
        marker.position.x = THREE.MathUtils.clamp(g.bal, -1, 1) * BAR_W * 0.5;
        const risk = Math.abs(g.bal);
        marker.material.color.set(risk > 0.75 ? 0xff6a55 : risk > 0.5 ? 0xf0c75e : 0xffffff);
        setLabel(`${g.name}  ${g.time.toFixed(1)}s`);
      } else {
        setLabel(message, message === 'BAIL' ? '#ff8573' : '#f4efe2');
      }
    }
    if (dom && !rider.presenting) {
      const text = g ? `${g.name} ${g.time.toFixed(1)}s` : showMessage ? message : sim.mode === Mode.AIR ? 'air' : '';
      domTrick.textContent = text;
      domSpeed.textContent = `${sim.speed.toFixed(1)} m/s`;
      domBar.style.display = g ? 'block' : 'none';
      if (g) domBar.firstElementChild.style.left = `${50 + THREE.MathUtils.clamp(g.bal, -1, 1) * 50}%`;
    }
  }

  return { update, say, group };
}
