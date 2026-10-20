// The mountain pass: terrain that hugs the road, pine forest, lamps only at the hairpins,
// a torii gate, a tofu shop, and the lights of the city twinkling far below.

import * as THREE from 'three';
import {
  buildLamps, neonSign, glow, setInstance, trackBounds, buildMountains,
} from './common.js';

const VALLEY_Y = -90;

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Roughly -1..1.
const fbm = (x, z) => (valueNoise(x / 180, z / 180) + valueNoise(x / 70, z / 70) * 0.45 + valueNoise(x / 25, z / 25) * 0.15 - 0.8) * 1.6;

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildHills(group, track, def) {
  const W = track.wallOffset;

  // Smooth "hillside" through the road heights (inverse-distance weighting), so the switchbacks
  // sit on one slope instead of on separate terraces.
  const coarse = [];
  for (let i = 0; i < track.samples; i += 10) coarse.push([track.px[i], track.pz[i], track.py[i]]);
  const hillside = (x, z) => {
    let sw = 0;
    let sh = 0;
    for (const [px, pz, py] of coarse) {
      const w = 1 / ((x - px) ** 2 + (z - pz) ** 2 + 400);
      sw += w;
      sh += w * py;
    }
    return sh / sw;
  };
  const height = (x, z) => {
    const { i, d } = track.nearestCoarse(x, z);
    const road = track.py[i] - 0.35;
    const away = Math.max(0, d - W);
    const far = hillside(x, z) + fbm(x, z) * 28 * smoothstep(0, 80, away) - away * 0.12;
    let h = road + (far - road) * smoothstep(W + 0.5, W + 26, d);
    if (d < W + 2.5) h = Math.min(h, road);
    return Math.max(h, VALLEY_Y + 5);
  };

  const b = trackBounds(track, 320);
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const seg = Math.min(260, Math.round(size / 4.5));
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(b.cx, 0, b.cz);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, height(pos.getX(k), pos.getZ(k)));
  geo.computeVertexNormals();
  // Grass on gentle slopes, rock on steep ones.
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x16241c);
  const rock = new THREE.Color(0x34343b);
  const c = new THREE.Color();
  const normals = geo.attributes.normal;
  for (let k = 0; k < pos.count; k++) {
    const steep = smoothstep(0.92, 0.7, normals.getY(k));
    c.copy(grass).lerp(rock, steep).offsetHSL(0, 0, (hash(k, 7) - 0.5) * 0.03);
    c.toArray(colors, k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true;
  group.add(terrain);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(b.cx, VALLEY_Y, b.cz);
  group.add(floor);
  buildMountains(group, b.cx, b.cz, { radius: size * 0.75 + 300, color: 0x0e1220 });

  buildTrees(group, track, b, size, height);
  buildCornerLamps(group, track, def);
  buildValleyLights(group, b, size);
  buildTorii(group, track, track.atFraction(0.04));
  buildTofuShop(group, track, Math.max(5, track.startIdx - Math.round(40 / track.segLen)), height);
}

function buildTrees(group, track, b, size, height) {
  const count = 1100;
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.35, 3, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 1 }),
    count,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.4, 9, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    count,
  );
  const c = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 8; tries++) {
    const x = b.cx + (Math.random() - 0.5) * size * 0.95;
    const z = b.cz + (Math.random() - 0.5) * size * 0.95;
    const d = track.distanceToTrack(x, z);
    if (d < track.wallOffset + 4 || d > 260) continue;
    const y = height(x, z);
    const s = 0.7 + Math.random() * 0.8;
    const rot = Math.random() * Math.PI;
    setInstance(trunks, placed, x, y + 1.5 * s, z, rot, s, s, s);
    setInstance(leaves, placed, x, y + 7 * s, z, rot, s, s, s);
    leaves.setColorAt(placed, c.setHSL(0.38 + Math.random() * 0.06, 0.35, 0.1 + Math.random() * 0.06));
    placed++;
  }
  trunks.count = leaves.count = placed;
  group.add(trunks, leaves);
}

// Lamps only where the road turns hard, on the outside of the bend, like a real mountain road.
function buildCornerLamps(group, track, def) {
  const where = [];
  const win = Math.round(25 / track.segLen);
  for (let i = 5; i < track.samples - 5; i++) {
    const t = Math.abs(track.turn[i]);
    if (t < 0.35) continue;
    let isPeak = true;
    for (let j = Math.max(0, i - win); j <= Math.min(track.samples - 1, i + win); j++) {
      if (Math.abs(track.turn[j]) > t) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) where.push({ i, side: track.turn[i] > 0 ? 1 : -1 });
  }
  for (const i of [track.startIdx, track.finishIdx]) where.push({ i, side: -1 }, { i, side: 1 });
  buildLamps(group, track, {
    color: def.lamp.color, height: def.lamp.height, where, pool: 22, poolStrength: 0.42,
  });
}

function buildValleyLights(group, b, size) {
  const positions = [];
  const colors = [];
  const c = new THREE.Color();
  for (let town = 0; town < 30; town++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * 0.6 + Math.random() * 1300;
    const tx = b.cx + Math.cos(a) * r;
    const tz = b.cz + Math.sin(a) * r;
    const n = 40 + Math.floor(Math.random() * 120);
    for (let k = 0; k < n; k++) {
      const spread = 20 + Math.random() * 70;
      positions.push(tx + (Math.random() - 0.5) * spread * 2, VALLEY_Y + 1 + Math.random() * 4, tz + (Math.random() - 0.5) * spread * 2);
      c.set(Math.random() < 0.7 ? 0xffb860 : 0xdfe8ff).multiplyScalar(2);
      colors.push(c.r, c.g, c.b);
    }
  }
  const lights = new THREE.Points(
    new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      .setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)),
    new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false }),
  );
  group.add(lights);
}

function buildTorii(group, track, i) {
  const red = new THREE.MeshStandardMaterial({ color: 0xb01c14, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
  const g = new THREE.Group();
  g.position.set(track.px[i], track.py[i], track.pz[i]);
  g.rotation.y = track.headingAt(i);
  const span = track.wallOffset + 0.8;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 8, 12), red);
    post.position.set(side * span, 4, 0);
    g.add(post);
  }
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.5, 0.6, 0.5), red);
  nuki.position.y = 6.6;
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 4, 0.7, 0.9), black);
  kasagi.position.y = 8.3;
  const shimaki = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 3.2, 0.5, 0.7), red);
  shimaki.position.y = 7.8;
  g.add(nuki, kasagi, shimaki);
  group.add(g);
}

// A tiny tofu shop behind the grid, with a glowing vending machine. For reasons.
function buildTofuShop(group, track, i, height) {
  const side = -1;
  const off = track.wallOffset + 10;
  const x = track.px[i] + track.nx[i] * off * side;
  const z = track.pz[i] + track.nz[i] * off * side;
  const y = height(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = Math.atan2(track.nx[i] * side * -1, track.nz[i] * side * -1);
  const house = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 8), new THREE.MeshStandardMaterial({ color: 0x4a3f36, roughness: 0.9 }));
  house.position.y = 2.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(7.6, 3, 4), new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.8 }));
  roof.position.y = 6.5;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.8);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3), new THREE.MeshBasicMaterial({ color: glow(0xffc070, 1.4) }));
  door.position.set(-2, 1.5, 4.01);
  const vend = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2, 0.8), [
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2 }), new THREE.MeshStandardMaterial({ color: 0xc8ccd2 }),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2 }), new THREE.MeshStandardMaterial({ color: 0xc8ccd2 }),
    new THREE.MeshBasicMaterial({ color: glow(0xd8f0ff, 2.2) }), new THREE.MeshStandardMaterial({ color: 0xc8ccd2 }),
  ]);
  vend.position.set(3.4, 1, 4.6);
  const sign = neonSign('TOFU SHOP', '#ff2fd6', 7, 2);
  sign.position.set(0, 4.2, 4.05);
  g.add(house, roof, door, vend, sign);
  group.add(g);
}
