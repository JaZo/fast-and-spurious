// Scenery building blocks shared by the track themes. None of this affects physics.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, speckle } from '../track.js';
import { pick } from '../fun.js';

// HDR colour for unlit "glowing" materials, so bloom picks them up.
export const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

export function radialTexture(stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [at, c] of stops) g.addColorStop(at, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: false });
}

export function neonTexture(text, color) {
  return canvasTexture(1024, 192, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'italic 900 92px "Russo One", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.strokeStyle = color;
    ctx.strokeText(text, w / 2, h / 2, w - 40);
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, h / 2, w - 40);
  }, { repeat: false });
}

export function neonSign(text, color, width, k = 2.2) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.19),
    new THREE.MeshBasicMaterial({
      map: neonTexture(text, color), transparent: true, depthWrite: false, color: glow(0xffffff, k), side: THREE.DoubleSide,
    }),
  );
}

// Reusable placement helpers.
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const POOL_X = new THREE.Vector3();
const POOL_Y = new THREE.Vector3();
const POOL_Z = new THREE.Vector3();
export function setInstance(mesh, k, x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) {
  Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
  mesh.setMatrixAt(k, M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz)));
}

// Does a w x d rectangle centred on (cx, cz), rotated by rot, keep `margin` metres away from the road?
export function fits(track, cx, cz, w, d, rot, margin) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const [ox, oz] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, -d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]]) {
    const x = cx + ox * c + oz * s;
    const z = cz - ox * s + oz * c;
    if (track.distanceToTrack(x, z) < margin) return false;
  }
  return true;
}

export function trackBounds(track, pad) {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (let i = 0; i < track.samples; i++) {
    minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
  }
  return {
    minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
  };
}

// A sky dome with stars and a moon. Colours change per track; it follows the camera.
export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    this.uniforms = {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      haze: { value: new THREE.Color() },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(2500, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 horizon;
          uniform vec3 haze;
          varying vec3 vDir;
          void main() {
            float h = max(vDir.y, 0.0);
            vec3 c = mix(horizon, top, pow(h, 0.4));
            c += haze * pow(1.0 - h, 10.0) * 0.5; // light pollution
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -1;
    this.group.add(dome);

    const starPos = [];
    for (let i = 0; i < 1600; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.12 + Math.random() * 0.88;
      const r = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(a) * r * 2000, y * 2000, Math.sin(a) * r * 2000);
    }
    this.stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
      new THREE.PointsMaterial({ color: 0xbfc8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }),
    );
    this.group.add(this.stars);

    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture([[0, 'rgba(255,255,245,1)'], [0.18, 'rgba(255,250,230,1)'], [0.22, 'rgba(200,190,255,0.35)'], [1, 'rgba(120,100,200,0)']]),
      color: glow(0xffffff, 1.5),
      fog: false,
      depthWrite: false,
    }));
    moon.position.set(-900, 900, 1600);
    moon.scale.setScalar(420);
    this.group.add(moon);
    scene.add(this.group);
  }

  setColors({ top, horizon, haze }) {
    this.uniforms.top.value.set(top);
    this.uniforms.horizon.value.set(horizon);
    this.uniforms.haze.value.set(haze);
  }
}

// A tiny neon-lit "room" baked into an environment map, for reflections on paint and wet asphalt.
export function nightEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x07060f, side: THREE.BackSide })));
  const panel = (hex, k, x, y, z, w, h) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: glow(hex, k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    panel(pick([0xff2fd6, 0x38f2ff, 0xffae40, 0x9b4dff, 0xffffff]), 1.5 + Math.random() * 1.5,
      Math.cos(a) * 40, 2 + Math.random() * 10, Math.sin(a) * 40, 4 + Math.random() * 8, 1 + Math.random() * 3);
  }
  for (let i = 0; i < 6; i++) panel(0xffa040, 3, (Math.random() - 0.5) * 50, 30, (Math.random() - 0.5) * 50, 6, 1);
  panel(0x2a1c48, 1.2, 0, -2, 45, 90, 8); // horizon haze
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.03).texture;
  pmrem.dispose();
  return tex;
}

export function buildGround(group, { color = '#121217', dots = ['#17171d', '#0e0e12', '#1b1b21'], size = 6000, cx = 0, cz = 0, sizeX = size, sizeZ = size, y = -0.02 } = {}) {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 4000, dots);
  });
  tex.repeat.set(sizeX / 20, sizeZ / 20);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, y, cz);
  ground.receiveShadow = true;
  group.add(ground);
  return ground;
}

// Street lamps with an arm over the road and a soft pool of light on the asphalt.
// `where(i)` decides which samples get a lamp (default: every `spacing` metres, alternating sides).
export function buildLamps(group, track, {
  color, spacing = 42, height = 9, skip = () => false, where = null, pool = 22, poolStrength = 0.55, heads = 1,
}) {
  const spots = [];
  if (where) {
    for (const s of where) spots.push(s);
  } else {
    const step = Math.max(1, Math.round(spacing / track.segLen));
    let side = 1;
    for (let i = 10; i < track.samples - 10; i += step) {
      side = -side;
      if (!skip(i)) spots.push({ i, side });
    }
  }
  const n = spots.length;
  if (!n) return;
  const lampColor = new THREE.Color(color);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, height, 8);
  poleGeo.translate(0, height / 2, 0);
  const arm = Math.min(2.6, track.roadHalf * 0.4);
  const armGeo = new THREE.BoxGeometry(0.12, 0.12, arm);
  const headGeo = new THREE.BoxGeometry(heads > 1 ? 2.2 : 0.5, 0.16, heads > 1 ? 0.5 : 0.9);
  const poolGeo = new THREE.PlaneGeometry(pool, pool);
  poolGeo.rotateX(-Math.PI / 2);

  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c33, metalness: 0.6, roughness: 0.5 });
  const poles = new THREE.InstancedMesh(poleGeo, metal, n);
  const arms = new THREE.InstancedMesh(armGeo, metal, n);
  const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: lampColor.clone().multiplyScalar(5) }), n);
  const pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]),
    color: lampColor.clone().multiplyScalar(poolStrength),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), n);
  poles.castShadow = true;

  spots.forEach(({ i, side }, k) => {
    const nx = track.nx[i] * side;
    const nz = track.nz[i] * side;
    const base = track.wallOffset - 1.2;
    const bx = track.px[i] + nx * base;
    const bz = track.pz[i] + nz * base;
    const y = track.py[i];
    const rot = Math.atan2(-nx, -nz); // arm points back over the road
    setInstance(poles, k, bx, y, bz, rot);
    setInstance(arms, k, bx - nx * arm / 2, y + height, bz - nz * arm / 2, rot);
    setInstance(headMesh, k, bx - nx * arm, y + height - 0.1, bz - nz * arm, rot);
    // The light pool lies on the road surface, so it tilts with the slope.
    const reach = Math.min(track.roadHalf, 4.5);
    const g = track.grade[i];
    const len = Math.hypot(1, g);
    POOL_Z.set(track.tx[i] / len, g / len, track.tz[i] / len);
    POOL_X.set(track.nx[i], 0, track.nz[i]);
    POOL_Y.crossVectors(POOL_Z, POOL_X);
    M.makeBasis(POOL_X, POOL_Y, POOL_Z).setPosition(bx - nx * (arm + reach), y + 0.06, bz - nz * (arm + reach));
    pools.setMatrixAt(k, M);
  });
  pools.renderOrder = 1;
  group.add(poles, arms, headMesh, pools);
}

// Window texture: a facade map plus a matching emissive map where only the lit windows glow.
export function makeWindowTexture(litChance = 0.3) {
  const W = 512;
  const H = 512;
  const cols = 8;
  const rows = 8;
  const lit = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) lit.push(Math.random() < litChance ? pick(['#ffd9a0', '#fff1d0', '#bfe3ff', '#ffb36b']) : null);
  const draw = (emissive) => (ctx) => {
    ctx.fillStyle = emissive ? '#000' : '#2c2e36';
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * (W / cols) + 10;
        const y = r * (H / rows) + 14;
        const color = lit[r * cols + c];
        ctx.fillStyle = emissive ? (color ?? '#000') : (color ? '#555' : '#101218');
        ctx.fillRect(x, y, W / cols - 20, H / rows - 26);
      }
    }
    ctx.fillStyle = emissive ? '#000' : '#141519'; // roof corner
    ctx.fillRect(W - 8, 0, 8, 8);
  };
  return { map: canvasTexture(W, H, draw(false)), emissive: canvasTexture(W, H, draw(true)) };
}

// One merged mesh for a set of buildings, with lit windows that bloom.
// Returns the street-facing fronts (for neon signs).
export function buildBuildings(group, track, {
  frontage = true, frontGap = 3, heightRange = [10, 50], tallChance = 0.2, tallExtra = 50,
  fillers = 260, fillerMargin = 30, fillerHeight = [20, 140], pad = 300, skip = () => false, litChance = 0.3,
  hueRange = [0.6, 0.75], baseY = () => 0,
}) {
  const { map, emissive } = makeWindowTexture(litChance);
  const geos = [];
  const fronts = [];
  const color = new THREE.Color();
  const tint = new THREE.Color(0x6a4cff);

  const addBox = (cx, cz, w, d, h, rot, y0 = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(rot);
    g.translate(cx, y0 + h / 2, cz);
    // Scale UVs so a window is always ~4 m wide and ~3.4 m tall; shift per building for variety.
    const uv = g.attributes.uv;
    const du = Math.floor(Math.random() * 8) / 8;
    const dv = Math.floor(Math.random() * 8) / 8;
    const faceW = [d, d, w, w, w, w];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const k = f * 4 + v;
        if (f === 2 || f === 3) uv.setXY(k, 0.99, 0.99); // roof: dark corner of the texture
        else uv.setXY(k, uv.getX(k) * (faceW[f] / 32) + du, uv.getY(k) * (h / 27) + dv);
      }
    }
    color.setHSL(hueRange[0] + Math.random() * (hueRange[1] - hueRange[0]), 0.15, 0.3 + Math.random() * 0.3);
    color.lerp(tint, 0.15);
    const colors = new Float32Array(24 * 3);
    for (let k = 0; k < 24; k++) color.toArray(colors, k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
  };

  const W = track.wallOffset;
  if (frontage) {
    for (const side of [-1, 1]) {
      let i = 30;
      while (i < track.samples - 30) {
        const width = 14 + Math.random() * 22;
        const step = Math.round((width + 3) / track.segLen);
        const mid = Math.min(track.samples - 1, i + Math.round(step / 2));
        i += step;
        if (skip(mid)) continue;
        const depth = 14 + Math.random() * 26;
        const height = heightRange[0] + Math.random() * (heightRange[1] - heightRange[0]) + (Math.random() < tallChance ? tallExtra : 0);
        const nx = track.nx[mid] * side;
        const nz = track.nz[mid] * side;
        const off = W + frontGap + depth / 2;
        const cx = track.px[mid] + nx * off;
        const cz = track.pz[mid] + nz * off;
        const rot = track.headingAt(mid);
        if (!fits(track, cx, cz, width, depth, rot, W + frontGap - 1)) continue;
        addBox(cx, cz, width, depth, height, rot, baseY(mid));
        fronts.push({
          x: track.px[mid] + nx * (W + frontGap), y: baseY(mid), z: track.pz[mid] + nz * (W + frontGap), nx, nz, width, height,
        });
      }
    }
  }

  const b = trackBounds(track, pad);
  let placed = 0;
  for (let tries = 0; placed < fillers && tries < fillers * 15; tries++) {
    const x = b.minX + Math.random() * (b.maxX - b.minX);
    const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
    const w = 20 + Math.random() * 40;
    const d = 20 + Math.random() * 40;
    const rot = Math.random() < 0.5 ? 0 : Math.PI / 2;
    if (!fits(track, x, z, w, d, rot, W + fillerMargin)) continue;
    addBox(x, z, w, d, fillerHeight[0] + Math.random() * (fillerHeight[1] - fillerHeight[0]), rot);
    placed++;
  }

  if (!geos.length) return fronts;
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({
    map,
    emissiveMap: emissive,
    emissive: new THREE.Color(0.75, 0.68, 0.55),
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.2,
  }));
  mesh.receiveShadow = true;
  for (const g of geos) g.dispose();
  group.add(mesh);
  return fronts;
}

// Neon signs on building fronts facing the road.
export function buildNeonSigns(group, fronts, names) {
  const colors = ['#ff2fd6', '#38f2ff', '#7dff3b', '#ffae00', '#ff2a3a', '#9b4dff'];
  const shuffled = [...names].sort(() => Math.random() - 0.5);
  const candidates = fronts.filter((f) => f.width > 16).sort(() => Math.random() - 0.5);
  candidates.slice(0, shuffled.length).forEach((f, k) => {
    const sign = neonSign(shuffled[k], colors[k % colors.length], Math.min(f.width - 2, 18));
    sign.position.set(f.x - f.nx * 0.3, f.y + Math.min(f.height - 2, 6 + Math.random() * 4), f.z - f.nz * 0.3);
    sign.rotation.y = Math.atan2(-f.nx, -f.nz);
    group.add(sign);
  });
}

// A concrete bridge across the road, with a neon sign on its face.
export function buildOverpass(group, track, i, text, color = '#38f2ff') {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x55565e, roughness: 0.85 });
  const W = track.wallOffset;
  const g = new THREE.Group();
  g.position.set(track.px[i], track.py[i], track.pz[i]);
  g.rotation.y = track.headingAt(i);
  const span = W * 2 + 30;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 1.6, 14), concrete);
  deck.position.y = 10;
  deck.castShadow = true;
  g.add(deck);
  for (const side of [-1, 1]) {
    for (const dz of [-4.5, 4.5]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.4), concrete);
      pillar.position.set(side * (W + 1.5), 5, dz);
      g.add(pillar);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 1, 0.3), concrete);
    rail.position.set(0, 11.3, side * 6.8);
    g.add(rail);
  }
  const sign = neonSign(text, color, 14, 2);
  sign.position.set(0, 10, -7.05);
  sign.rotation.y = Math.PI;
  g.add(sign);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(track.roadHalf * 2, 0.1, 0.3), new THREE.MeshBasicMaterial({ color: glow(0xbfe3ff, 4) }));
  lamp.position.y = 9.15;
  g.add(lamp);
  group.add(g);
}

// Low-poly mountains on the horizon.
export function buildMountains(group, cx, cz, { count = 28, radius = 1100, color = 0x141826, snow = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0x8a90a8, roughness: 1, flatShading: true });
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.1;
    const r = radius + Math.random() * 300;
    const height = 160 + Math.random() * 260;
    const rad = 180 + Math.random() * 140;
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, height, 6 + Math.floor(Math.random() * 3)), mat);
    m.position.set(cx + Math.cos(a) * r, height / 2 - 40, cz + Math.sin(a) * r);
    m.rotation.y = Math.random() * Math.PI;
    if (snow) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.32, height * 0.3, 6), snowMat);
      cap.position.y = height * 0.35 + 1;
      m.add(cap);
    }
    group.add(m);
  }
}
