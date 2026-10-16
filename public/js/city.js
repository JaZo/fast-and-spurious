// Night-time city dressing: sky, streetlights, buildings with lit windows, neon signs, a tunnel and overpasses.
// None of this affects physics; the track barriers do that.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TUNNEL, OVERPASSES } from './config.js';
import {
  SAMPLES, ROAD_HALF, WALL_OFFSET, canvasTexture, speckle,
} from './track.js';
import { NEON_SIGNS, pick } from './fun.js';

export const SKY_HORIZON = 0x1d1430;
const SODIUM = new THREE.Color(1.0, 0.62, 0.25);

// HDR colour for unlit "glowing" materials, so bloom picks them up.
const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function radialTexture(stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [at, c] of stops) g.addColorStop(at, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: false });
}

// A dim purple-black dome with stars and a moon; follows the camera.
export function buildSky(scene) {
  const sky = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x020309) },
        horizon: { value: new THREE.Color(SKY_HORIZON) },
        haze: { value: new THREE.Color(0x6a2c48) },
      },
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
  sky.add(dome);

  const starPos = [];
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.15 + Math.random() * 0.85;
    const r = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(a) * r * 2000, y * 2000, Math.sin(a) * r * 2000);
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
    new THREE.PointsMaterial({ color: 0xbfc8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }),
  );
  sky.add(stars);

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(255,255,245,1)'], [0.18, 'rgba(255,250,230,1)'], [0.22, 'rgba(200,190,255,0.35)'], [1, 'rgba(120,100,200,0)']]),
    color: glow(0xffffff, 1.5),
    fog: false,
    depthWrite: false,
  }));
  moon.position.set(-900, 900, 1600);
  moon.scale.setScalar(420);
  sky.add(moon);

  scene.add(sky);
  return sky;
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

export function buildCity(scene, track) {
  const city = new THREE.Group();
  scene.add(city);

  const tunnel = [track.atFraction(TUNNEL[0]), track.atFraction(TUNNEL[1])];
  const inTunnel = (i) => i >= tunnel[0] - 4 && i <= tunnel[1] + 4;

  buildGround(city);
  buildStreetlights(city, track, inTunnel);
  const fronts = buildBuildings(city, track, inTunnel);
  buildNeonSigns(city, fronts);
  buildTunnel(city, track, tunnel);
  for (const f of OVERPASSES) buildOverpass(city, track, track.atFraction(f));
  return city;
}

function buildGround(city) {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#121217';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 4000, ['#17171d', '#0e0e12', '#1b1b21']);
  });
  tex.repeat.set(300, 300);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  city.add(ground);
}

function buildStreetlights(city, track, inTunnel) {
  const spots = [];
  const spacing = Math.round(42 / track.segLen);
  let side = 1;
  for (let i = 10; i < SAMPLES - 10; i += spacing) {
    side = -side;
    if (inTunnel(i)) continue;
    spots.push({ i, side });
  }
  const n = spots.length;
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 9, 8);
  poleGeo.translate(0, 4.5, 0);
  const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.6);
  const headGeo = new THREE.BoxGeometry(0.5, 0.16, 0.9);
  const poolGeo = new THREE.PlaneGeometry(22, 22);
  poolGeo.rotateX(-Math.PI / 2);

  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c33, metalness: 0.6, roughness: 0.5 });
  const poles = new THREE.InstancedMesh(poleGeo, metal, n);
  const arms = new THREE.InstancedMesh(armGeo, metal, n);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: SODIUM.clone().multiplyScalar(5) }), n);
  const pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]),
    color: SODIUM.clone().multiplyScalar(0.55),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), n);
  poles.castShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  spots.forEach(({ i, side }, k) => {
    const nx = track.nx[i] * side;
    const nz = track.nz[i] * side;
    const baseX = track.px[i] + nx * (ROAD_HALF + 2.2);
    const baseZ = track.pz[i] + nz * (ROAD_HALF + 2.2);
    // Arm points back over the road.
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-nx, -nz));
    poles.setMatrixAt(k, m.compose(p.set(baseX, 0, baseZ), q, one));
    arms.setMatrixAt(k, m.compose(p.set(baseX - nx * 1.2, 9, baseZ - nz * 1.2), q, one));
    heads.setMatrixAt(k, m.compose(p.set(baseX - nx * 2.4, 8.9, baseZ - nz * 2.4), q, one));
    pools.setMatrixAt(k, m.compose(p.set(baseX - nx * 4.5, 0.06, baseZ - nz * 4.5), q, one));
  });
  pools.renderOrder = 1;
  city.add(poles, arms, heads, pools);
}

// One merged mesh for every building, with a window texture whose lit windows are bloom-bright.
function buildBuildings(city, track, inTunnel) {
  const winTex = makeWindowTexture();
  const facade = winTex.map;
  const lit = winTex.emissive;
  const geos = [];
  const fronts = [];
  const color = new THREE.Color();

  const addBox = (cx, cz, w, d, h, rot, tint) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(rot);
    g.translate(cx, h / 2, cz);
    // Scale UVs so a window is always ~4 m wide and ~3.4 m tall; shift per building for variety.
    const uv = g.attributes.uv;
    const du = Math.floor(Math.random() * 8) / 8;
    const dv = Math.floor(Math.random() * 8) / 8;
    const faceW = [d, d, w, w, w, w];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const k = f * 4 + v;
        if (f === 2 || f === 3) {
          uv.setXY(k, 0.99, 0.99); // roof: dark corner of the texture
        } else {
          uv.setXY(k, uv.getX(k) * (faceW[f] / 32) + du, uv.getY(k) * (h / 27) + dv);
        }
      }
    }
    color.setHSL(0.6 + Math.random() * 0.15, 0.15, 0.3 + Math.random() * 0.3);
    color.lerp(tint, 0.15);
    const colors = new Float32Array(24 * 3);
    for (let k = 0; k < 24; k++) color.toArray(colors, k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
  };

  const fits = (cx, cz, w, d, rot, margin) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const [ox, oz] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, -d / 2], [0, d / 2]]) {
      const x = cx + ox * c + oz * s;
      const z = cz - ox * s + oz * c;
      if (track.distanceToTrack(x, z) < margin) return false;
    }
    return true;
  };

  // Street frontage on both sides.
  const tint = new THREE.Color(0x6a4cff);
  for (const side of [-1, 1]) {
    let i = 30;
    while (i < SAMPLES - 30) {
      const width = 14 + Math.random() * 22;
      const step = Math.round((width + 3) / track.segLen);
      const mid = Math.min(SAMPLES - 1, i + Math.round(step / 2));
      i += step;
      if (inTunnel(mid)) continue;
      const depth = 14 + Math.random() * 26;
      const height = 10 + Math.random() * (Math.random() < 0.2 ? 90 : 40);
      const nx = track.nx[mid] * side;
      const nz = track.nz[mid] * side;
      const off = WALL_OFFSET + 3 + depth / 2;
      const cx = track.px[mid] + nx * off;
      const cz = track.pz[mid] + nz * off;
      const rot = track.headingAt(mid);
      if (!fits(cx, cz, width, depth, rot, WALL_OFFSET + 2)) continue;
      addBox(cx, cz, width, depth, height, rot, tint);
      fronts.push({
        x: track.px[mid] + nx * (WALL_OFFSET + 3), z: track.pz[mid] + nz * (WALL_OFFSET + 3), nx, nz, width, height,
      });
    }
  }

  // Back-lot fillers so you see a skyline over the frontage.
  let placed = 0;
  for (let tries = 0; placed < 260 && tries < 4000; tries++) {
    const x = -500 + Math.random() * 1700;
    const z = -350 + Math.random() * 2400;
    const w = 20 + Math.random() * 40;
    const d = 20 + Math.random() * 40;
    const rot = Math.random() < 0.5 ? 0 : Math.PI / 2;
    if (!fits(x, z, w, d, rot, WALL_OFFSET + 30)) continue;
    addBox(x, z, w, d, 20 + Math.random() * 120, rot, tint);
    placed++;
  }

  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({
    map: facade,
    emissiveMap: lit,
    emissive: new THREE.Color(0.75, 0.68, 0.55),
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.2,
  }));
  mesh.receiveShadow = true;
  for (const g of geos) g.dispose();
  city.add(mesh);
  return fronts;
}

function makeWindowTexture() {
  const W = 512;
  const H = 512;
  const cols = 8;
  const rows = 8;
  const lit = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) lit.push(Math.random() < 0.3 ? pick(['#ffd9a0', '#fff1d0', '#bfe3ff', '#ffb36b']) : null);
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
  const map = canvasTexture(W, H, draw(false));
  const emissive = canvasTexture(W, H, draw(true));
  return { map, emissive };
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

function buildNeonSigns(city, fronts) {
  const colors = ['#ff2fd6', '#38f2ff', '#7dff3b', '#ffae00', '#ff2a3a', '#9b4dff'];
  const names = [...NEON_SIGNS].sort(() => Math.random() - 0.5);
  const candidates = fronts.filter((f) => f.width > 16).sort(() => Math.random() - 0.5);
  candidates.slice(0, names.length).forEach((f, k) => {
    const color = colors[k % colors.length];
    const width = Math.min(f.width - 2, 18);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width * 0.19),
      new THREE.MeshBasicMaterial({
        map: neonTexture(names[k], color), transparent: true, depthWrite: false, color: glow(0xffffff, 2.2), side: THREE.DoubleSide,
      }),
    );
    sign.position.set(f.x - f.nx * 0.3, Math.min(f.height - 2, 6 + Math.random() * 4), f.z - f.nz * 0.3);
    sign.rotation.y = Math.atan2(-f.nx, -f.nz);
    city.add(sign);
  });
}

function buildTunnel(city, track, [from, to]) {
  const H = 7.5;
  const concrete = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#4a4b52';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1200, ['#55565d', '#3f4046']);
    ctx.fillStyle = '#3a3b41';
    ctx.fillRect(0, h - 4, w, 4);
  });
  const tiles = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b9b39b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8d8875';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(0, (i * h) / 8); ctx.lineTo(w, (i * h) / 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo((i * w) / 8, 0); ctx.lineTo((i * w) / 8, h); ctx.stroke();
    }
  });
  const wallMat = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide });
  const roofMat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.9, side: THREE.DoubleSide });
  const w = WALL_OFFSET + 0.4;
  city.add(new THREE.Mesh(track.wall(w, 0, H, 4, from, to), wallMat));
  city.add(new THREE.Mesh(track.wall(-w, 0, H, 4, from, to), wallMat));
  city.add(new THREE.Mesh(track.ribbon(-w - 1, w + 1, H, 6, from, to), roofMat));
  // Thick portal faces at each end.
  for (const i of [from, to]) {
    const portal = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 6, 3, 1.5), roofMat);
    portal.position.set(track.px[i], H + 1.2, track.pz[i]);
    portal.rotation.y = track.headingAt(i);
    city.add(portal);
  }

  // Orange strip lights along both ceiling edges.
  const step = Math.round(6 / track.segLen);
  const count = Math.ceil((to - from) / step) * 2;
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.12, 2.2), new THREE.MeshBasicMaterial({ color: SODIUM.clone().multiplyScalar(5) }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  let k = 0;
  for (let i = from; i <= to && k < count; i += step) {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, track.headingAt(i));
    for (const side of [-1, 1]) {
      const off = side * (ROAD_HALF - 1);
      lamps.setMatrixAt(k++, m.compose(p.set(track.px[i] + track.nx[i] * off, H - 0.1, track.pz[i] + track.nz[i] * off), q, one));
    }
  }
  lamps.count = k;
  city.add(lamps);

  const pools = new THREE.Mesh(track.ribbon(-ROAD_HALF, ROAD_HALF, 0.05, 6, from, to), new THREE.MeshBasicMaterial({
    map: canvasTexture(64, 64, (ctx, cw, ch) => {
      const g = ctx.createLinearGradient(0, 0, cw, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.15)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'rgba(255,255,255,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }),
    color: SODIUM.clone().multiplyScalar(0.35),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  city.add(pools);
}

function buildOverpass(city, track, i) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x55565e, roughness: 0.85 });
  const g = new THREE.Group();
  g.position.set(track.px[i], 0, track.pz[i]);
  g.rotation.y = track.headingAt(i);
  const span = WALL_OFFSET * 2 + 30;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 1.6, 14), concrete);
  deck.position.y = 10;
  deck.castShadow = true;
  g.add(deck);
  for (const side of [-1, 1]) {
    for (const dz of [-4.5, 4.5]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.4), concrete);
      pillar.position.set(side * (WALL_OFFSET + 1.5), 5, dz);
      g.add(pillar);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 1, 0.3), concrete);
    rail.position.set(0, 11.3, side * 6.8);
    g.add(rail);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 2.6),
    new THREE.MeshBasicMaterial({ map: neonTexture('SPURIOUS CITY', '#38f2ff'), transparent: true, depthWrite: false, color: glow(0xffffff, 2) }),
  );
  sign.position.set(0, 10, -7.05);
  sign.rotation.y = Math.PI;
  g.add(sign);
  // Underside lights.
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2, 0.1, 0.3), new THREE.MeshBasicMaterial({ color: glow(0xbfe3ff, 4) }));
  lamp.position.y = 9.15;
  g.add(lamp);
  city.add(g);
}
