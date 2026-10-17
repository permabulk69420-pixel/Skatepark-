import * as THREE from 'three';

// Night version of a scanned level (levels.js `night`). A scan's lighting is painted into its texture and its material is unlit, so real
// lights do nothing to it. Instead its material gets a small shader hook that multiplies the texture by a made-up light: a dark ambient,
// a big "floodlight" pool that comes from the direction of the sun the scan was photographed in (so the baked shadows still make sense),
// and a few lamp pools. The same lamps are also real point lights, so the board, hands and rider are lit by them, and each gets a pole,
// a lamp head and a glow so there is something to look at.

const MAX_LAMPS = 4;

const colour = (hex) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };

function glowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createNight({ scene, meshes, night }) {
  const lamps = night.lamps.slice(0, MAX_LAMPS);
  const key = night.key;
  const keyDirection = new THREE.Vector3(...key.direction).normalize();

  const uniforms = {
    uAmbient: { value: colour(night.ambient) },
    uKeyDir: { value: keyDirection },
    uKeyColour: { value: colour(key.colour).multiplyScalar(key.strength) },
    uKeyCentre: { value: new THREE.Vector2(...key.centre) },
    uKeyRadius: { value: key.radius },
    uLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3(0, -1000, 0)) },
    uLampColour: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
    uLampRadius: { value: new Array(MAX_LAMPS).fill(1) }
  };
  const glow = glowTexture();
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0.6 });

  lamps.forEach((lamp, i) => {
    const head = new THREE.Vector3(lamp.base[0], lamp.base[1] + lamp.height, lamp.base[2]);
    uniforms.uLampPos.value[i].copy(head);
    uniforms.uLampColour.value[i].copy(colour(lamp.colour)).multiplyScalar(lamp.power);
    uniforms.uLampRadius.value[i] = lamp.radius;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, lamp.height, 8), poleMaterial);
    pole.position.set(lamp.base[0], lamp.base[1] + lamp.height / 2, lamp.base[2]);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.45), new THREE.MeshBasicMaterial({ color: new THREE.Color(lamp.colour).lerp(new THREE.Color(0xffffff), 0.6), fog: false }));
    bar.position.copy(head).add(new THREE.Vector3(0, 0.05, 0));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: lamp.colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sprite.scale.setScalar(lamp.glow ?? 9);
    sprite.position.copy(head);
    // a real light for the things that are lit (board, hands, rider)
    const light = new THREE.PointLight(lamp.colour, lamp.power * 90, lamp.radius * 2.5, 2);
    light.position.copy(head);
    scene.add(pole, bar, sprite, light);
  });

  // the same pool that lights the scan, as a real light, for the lit things
  scene.add(new THREE.AmbientLight(0x1a2744, 0.35));

  const patched = new Set();
  for (const mesh of meshes) {
    for (const material of [].concat(mesh.material)) {
      if (patched.has(material) || !material.isMeshBasicMaterial || !material.map) continue;
      patched.add(material);
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            varying vec3 vNightPos;
            varying vec3 vNightNormal;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vNightPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vNightNormal = normalize(mat3(modelMatrix) * normal);`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vNightPos;
            varying vec3 vNightNormal;
            uniform vec3 uAmbient;
            uniform vec3 uKeyDir;
            uniform vec3 uKeyColour;
            uniform vec2 uKeyCentre;
            uniform float uKeyRadius;
            uniform vec3 uLampPos[${MAX_LAMPS}];
            uniform vec3 uLampColour[${MAX_LAMPS}];
            uniform float uLampRadius[${MAX_LAMPS}];`)
          .replace('#include <map_fragment>', `#include <map_fragment>
            {
              vec3 n = normalize(vNightNormal);
              float away = length(vNightPos.xz - uKeyCentre) / uKeyRadius;
              float pool = 1.0 / (1.0 + away * away);
              vec3 lit = uAmbient + uKeyColour * (0.35 + 0.65 * max(dot(n, uKeyDir), 0.0)) * pool * pool;
              for (int i = 0; i < ${MAX_LAMPS}; i++) {
                vec3 toLamp = uLampPos[i] - vNightPos;
                float d = length(toLamp);
                float a = 1.0 / (1.0 + (d / uLampRadius[i]) * (d / uLampRadius[i]));
                lit += uLampColour[i] * a * a * (0.4 + 0.6 * max(dot(n, toLamp / d), 0.0));
              }
              diffuseColor.rgb *= lit;
            }`);
      };
      material.customProgramCacheKey = () => 'night-scan';
      material.needsUpdate = true;
    }
  }
}
