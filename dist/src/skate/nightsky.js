import * as THREE from 'three';

// The sky for a night level (levels.js `night.sky`): a horizon glow, stars (three layers, bright to faint), a faint Milky Way,
// thin cloud lit by the moon, and the moon itself, from a real NASA map (assets/sky/moon.jpg: Lunar Reconnaissance Orbiter data,
// NASA Scientific Visualization Studio) with a phase. It is one shader on one sphere that follows the camera, so it costs almost nothing
// next to the level, and it is drawn at the far plane so every object in the level sits in front of it.
// All options are optional: moon (direction towards the moon), phaseDegrees (0 = full), moonSize (radians), stars, galaxy, clouds, glow.

const vertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const fragmentShader = /* glsl */`
  varying vec3 vDir;
  uniform sampler2D uMoon;
  uniform vec3 uMoonDir, uPhase, uZenith, uHorizon, uGlow, uGalaxyNormal;
  uniform float uMoonSize, uStars, uGalaxy, uClouds, uTime;

  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

  // One layer of stars: a random point in each cell of a 3D grid laid over the sky. A star smaller than a pixel is dimmed rather than lost.
  vec3 starLayer(vec3 dir, float scale, float density, float size, float gain) {
    vec3 p = dir * scale, id = floor(p), f = fract(p);
    vec3 h = hash33(id);
    if (hash13(id + 17.7) > density) return vec3(0.0);
    float px = length(fwidth(p));
    float r = size * (0.6 + 0.8 * h.x), rr = max(r, px * 0.9);
    float d = length(f - (0.25 + 0.5 * h));
    float s = smoothstep(rr, 0.0, d) * min(1.0, (r * r) / (rr * rr));
    float twinkle = 1.0 + 0.22 * sin(uTime * (1.5 + 4.0 * h.y) + 40.0 * h.z);
    vec3 tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.65, 0.78, 1.0), h.z);
    return tint * s * twinkle * gain * (0.35 + 1.4 * h.y * h.y);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = clamp(dir.y, 0.0, 1.0);

    // sky gradient and a low glow, like a town beyond the trees
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
    col += uGlow * pow(1.0 - up, 6.0);

    // moon basis
    vec3 mr = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 mu = cross(uMoonDir, mr);
    float cosA = clamp(dot(dir, uMoonDir), -1.0, 1.0);
    float ang = sqrt(max(2.0 * (1.0 - cosA), 0.0));
    vec3 moonLight = vec3(0.62, 0.7, 0.9);

    // thin cloud, drifting slowly, brightest near the moon
    float cloud = 0.0;
    if (uClouds > 0.0 && dir.y > 0.02) {
      vec3 q = vec3(dir.xz / (dir.y + 0.18), 0.0) * 1.6 + vec3(uTime * 0.012, 0.0, uTime * 0.004);
      cloud = smoothstep(0.52, 0.86, fbm(q)) * smoothstep(0.02, 0.22, dir.y) * uClouds;
    }

    // stars, thinned where there is cloud, and washed out near the moon
    vec3 stars = starLayer(dir, 34.0, 0.22, 0.07, 1.7) + starLayer(dir, 80.0, 0.3, 0.09, 1.0) + starLayer(dir, 190.0, 0.3, 0.12, 0.75);
    float band = exp(-pow(dot(dir, uGalaxyNormal) / 0.2, 2.0));
    vec3 dense = starLayer(dir, 330.0, 0.5 * band, 0.14, 0.55);
    float dust = fbm(dir * 5.0 + 3.0);
    vec3 galaxy = vec3(0.5, 0.58, 0.8) * band * (0.25 + 0.9 * dust) * 0.05 * uGalaxy;
    float visible = smoothstep(-0.02, 0.12, dir.y) * (1.0 - cloud) * (1.0 - smoothstep(0.0, 0.5, 0.12 / (ang + 0.05)));
    col += (stars * uStars + dense * uStars * uGalaxy + galaxy) * visible;

    // the moon
    vec2 p = vec2(dot(dir, mr), dot(dir, mu)) / uMoonSize;
    float r = length(p);
    float edge = fwidth(r) * 1.5 + 0.01;
    if (cosA > 0.0 && r < 1.0 + edge) {
      vec3 n = vec3(p, sqrt(max(1.0 - r * r, 0.0)));
      vec2 uv = vec2(0.5 + atan(n.x, n.z) / 6.2831853, 0.5 + asin(clamp(n.y, -1.0, 1.0)) / 3.1415927);
      vec3 albedo = texture2D(uMoon, uv).rgb;
      float lit = smoothstep(-0.04, 0.3, dot(n, uPhase));
      vec3 surface = albedo * (lit * 3.0 + 0.012) * vec3(1.0, 0.96, 0.88);
      col = mix(col, surface, 1.0 - smoothstep(1.0 - edge, 1.0 + edge, r));
    }
    // halo around the moon, and the moon shining through the cloud
    float halo = 0.045 / (ang * ang * 90.0 + 0.5) + 0.018 / (ang * 3.0 + 0.2);
    col += moonLight * halo * 1.1 * (cosA > 0.0 ? 1.0 : 0.0);
    col = mix(col, col + vec3(0.02, 0.026, 0.04) + moonLight * halo * 0.9, cloud * 0.8);

    // a little noise so the dark gradient does not band
    col += (hash13(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 160.0;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createNightSky({ scene, sky = {}, key, horizon, moonUrl }) {
  const moonDirection = new THREE.Vector3(...(sky.moon ?? key ?? [0.3, 0.5, -0.8])).normalize();
  // the phase: the moon is lit from the right (waxing), `phaseDegrees` away from full
  const phase = THREE.MathUtils.degToRad(sky.phaseDegrees ?? 38);
  const moon = new THREE.TextureLoader().load(moonUrl);
  moon.colorSpace = THREE.SRGBColorSpace;
  moon.anisotropy = 4;
  const horizonColour = new THREE.Color(horizon);
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uMoon: { value: moon },
      uMoonDir: { value: moonDirection },
      uPhase: { value: new THREE.Vector3(Math.sin(phase), 0.12, Math.cos(phase)).normalize() },
      uMoonSize: { value: sky.moonSize ?? 0.026 },
      uZenith: { value: new THREE.Color(sky.zenith ?? '#01030a') },
      uHorizon: { value: new THREE.Color(sky.horizon ?? horizonColour.clone().lerp(new THREE.Color('#0a1830'), 0.6)) },
      uGlow: { value: new THREE.Color(sky.glow ?? '#1c1410') },
      uGalaxyNormal: { value: new THREE.Vector3(...(sky.galaxyNormal ?? [0.55, 0.25, -0.8])).normalize() },
      uStars: { value: sky.stars ?? 1 },
      uGalaxy: { value: sky.galaxy ?? 0.8 },
      uClouds: { value: sky.clouds ?? 0.6 },
      uTime: { value: 0 }
    },
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), material);
  mesh.name = 'night-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    material.uniforms.uTime.value = performance.now() / 1000;
    mesh.position.setFromMatrixPosition(camera.matrixWorld);
    mesh.updateMatrixWorld();
  };
  scene.add(mesh);
  return mesh;
}
