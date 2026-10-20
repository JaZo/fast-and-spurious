// The docks: canyons of stacked containers, gantry cranes with red aviation lights,
// warehouses, a container ship and black water beyond the quay.

import * as THREE from 'three';
import { canvasTexture, speckle } from '../track.js';
import { DOCK_SIGNS, pick } from '../fun.js';
import {
  buildGround, buildLamps, neonSign, glow, setInstance, fits, trackBounds, makeWindowTexture,
} from './common.js';

const CONTAINER = { l: 12.2, h: 2.6, w: 2.44 };
const CONTAINER_COLORS = ['#8f2a1f', '#1f4a86', '#2c7446', '#c0621a', '#cfcabd', '#5f2a70', '#a8821a', '#38454f', '#7a1d2e'];

export function buildDocks(group, track, def) {
  const quayX = def.quayX;
  const b = trackBounds(track, 160);
  const W = track.wallOffset;

  // Land stops at the quay; water beyond.
  const landW = quayX - (b.minX - 600);
  buildGround(group, {
    color: '#2a2b2f', dots: ['#303135', '#25262a', '#34353a'], cx: quayX - landW / 2, cz: b.cz, sizeX: landW, sizeZ: b.maxZ - b.minZ + 1600,
  });
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, b.maxZ - b.minZ + 3000),
    new THREE.MeshStandardMaterial({ color: 0x02050b, roughness: 0.1, metalness: 0.9 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(quayX + 1500, -2.2, b.cz);
  group.add(water);
  const quay = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2.4, b.maxZ - b.minZ + 1600),
    new THREE.MeshStandardMaterial({ color: 0x3b3c40, roughness: 0.9 }),
  );
  quay.position.set(quayX - 1, -1.2, b.cz);
  group.add(quay);
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.15, b.maxZ - b.minZ + 1600),
    new THREE.MeshStandardMaterial({ color: 0xd8b020, roughness: 0.6 }),
  );
  edge.position.set(quayX - 0.3, 0.08, b.cz);
  group.add(edge);

  buildLamps(group, track, {
    color: def.lamp.color, spacing: def.lamp.spacing, height: def.lamp.height, pool: 32, poolStrength: 0.28,
  });

  const sheds = buildWarehouses(group, track, b, quayX);
  buildContainers(group, track, b, quayX, sheds, W);
  for (let z = b.minZ + 80; z < b.maxZ - 40; z += 150) buildCrane(group, quayX, z);
  buildShip(group, quayX + 55, b.cz + 120);
}

function corrugated(base) {
  return canvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 6) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, 0, 2, h);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 3, 0, 1, h);
    }
    speckle(ctx, w, h, 200, ['rgba(80,40,20,0.3)', 'rgba(0,0,0,0.2)']); // rust and grime
  });
}

function buildWarehouses(group, track, b, quayX) {
  const sheds = [];
  const mat = new THREE.MeshStandardMaterial({ map: corrugated('#8a9099'), roughness: 0.7, metalness: 0.3 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.8 });
  const doorMat = new THREE.MeshBasicMaterial({ color: glow(0xffc070, 1.6) });
  const names = [...DOCK_SIGNS];
  for (let tries = 0; sheds.length < 9 && tries < 600; tries++) {
    const w = 50 + Math.random() * 40;
    const d = 26 + Math.random() * 14;
    const h = 12 + Math.random() * 6;
    const rot = Math.random() < 0.5 ? 0 : Math.PI / 2;
    const x = b.minX + Math.random() * (quayX - 40 - b.minX);
    const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
    if (!fits(track, x, z, w, d, rot, track.wallOffset + 8)) continue;
    const ex = rot ? d / 2 : w / 2;
    const ez = rot ? w / 2 : d / 2;
    if (sheds.some((s) => Math.abs(s.x - x) < s.ex + ex + 6 && Math.abs(s.z - z) < s.ez + ez + 6)) continue;
    sheds.push({ x, z, ex, ez });

    const shed = new THREE.Group();
    shed.position.set(x, 0, z);
    shed.rotation.y = rot;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roof, roof, mat, mat]);
    body.position.y = h / 2;
    body.receiveShadow = true;
    shed.add(body);
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), doorMat);
      door.position.set(side * w * 0.25, 3, d / 2 + 0.05);
      shed.add(door);
    }
    // A sign on the wall that faces the road.
    const near = track.nearestCoarse(x, z).i;
    const toRoad = new THREE.Vector2(track.px[near] - x, track.pz[near] - z);
    const local = toRoad.clone().rotateAround(new THREE.Vector2(), rot); // into the shed's frame
    const sign = neonSign(names.pop() ?? pick(DOCK_SIGNS), pick(['#38f2ff', '#ffae00', '#ff2fd6']), Math.min(w * 0.6, 26), 1.8);
    if (Math.abs(local.x) > Math.abs(local.y) * (w / d)) {
      sign.position.set(Math.sign(local.x) * (w / 2 + 0.1), h - 3, 0);
      sign.rotation.y = Math.sign(local.x) * Math.PI / 2;
      sign.scale.setScalar(Math.min(1, (d * 0.8) / 26));
    } else {
      sign.position.set(0, h - 3, Math.sign(local.y) * (d / 2 + 0.1));
      sign.rotation.y = local.y > 0 ? 0 : Math.PI;
    }
    shed.add(sign);
    group.add(shed);
  }
  return sheds;
}

function buildContainers(group, track, b, quayX, sheds, W) {
  const slots = [];
  const near = W + 3 + CONTAINER.l / 2;
  const colStep = CONTAINER.l + 1.6;
  const rowStep = CONTAINER.w + 0.2;
  let col = 0;
  for (let x = b.minX; x < quayX - 40; x += colStep, col++) {
    if (col % 5 === 4) continue; // straddle-carrier aisles
    let row = 0;
    for (let z = b.minZ; z < b.maxZ; z += rowStep, row++) {
      if (row % 10 >= 8) continue;
      const cx = x + CONTAINER.l / 2;
      const d = track.distanceToTrack(cx, z);
      if (d > W + 120 || d < W + 3) continue;
      if (d < near + 4 && !fits(track, cx, z, CONTAINER.l, CONTAINER.w, 0, W + 3)) continue;
      if (sheds.some((s) => Math.abs(s.x - cx) < s.ex + 8 && Math.abs(s.z - z) < s.ez + 3)) continue;
      // Taller stacks further from the road, so the canyon walls step up.
      const max = d < W + 25 ? 3 : 5;
      const stack = 1 + Math.floor(Math.random() ** 1.3 * max);
      for (let k = 0; k < stack; k++) slots.push([cx, CONTAINER.h / 2 + k * CONTAINER.h, z]);
    }
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CONTAINER.l, CONTAINER.h, CONTAINER.w),
    new THREE.MeshStandardMaterial({ map: corrugated('#bdbdbd'), roughness: 0.6, metalness: 0.35 }),
    slots.length,
  );
  const c = new THREE.Color();
  slots.forEach(([x, y, z], k) => {
    setInstance(mesh, k, x, y, z);
    c.set(pick(CONTAINER_COLORS)).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
    mesh.setColorAt(k, c);
  });
  mesh.receiveShadow = true;
  group.add(mesh);
}

function buildCrane(group, quayX, z) {
  const paint = new THREE.MeshStandardMaterial({ color: Math.random() < 0.5 ? 0xb3261e : 0x1f5fa8, roughness: 0.6, metalness: 0.4 });
  const red = new THREE.MeshBasicMaterial({ color: glow(0xff2020, 5) });
  const flood = new THREE.MeshBasicMaterial({ color: glow(0xe8f0ff, 5) });
  const g = new THREE.Group();
  g.position.set(quayX, 0, z);
  const box = (sx, sy, sz, mat, x, y, zz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, zz);
    g.add(m);
    return m;
  };
  for (const x of [-10, 12]) {
    for (const dz of [-9, 9]) box(1.4, 40, 1.4, paint, x, 20, dz);
    box(1.2, 1.2, 19, paint, x, 38, 0);
  }
  box(23, 1.4, 1.2, paint, 1, 38, -9);
  box(23, 1.4, 1.2, paint, 1, 38, 9);
  box(95, 2.2, 3, paint, 12, 44, 0); // boom, mostly over the water
  box(1.2, 14, 1.2, paint, 0, 52, 0); // A-frame
  box(30, 0.6, 0.6, paint, 15, 52, 0).rotation.z = -0.32;
  box(14, 4, 6, paint, -4, 47, 0); // machinery house
  for (const [x, y] of [[0, 59.5], [58, 45.5], [-34, 45.5]]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), red);
    light.position.set(x, y, 0);
    g.add(light);
  }
  for (const x of [-6, 4, 14]) box(1.6, 0.3, 1.6, flood, x, 42.8, 0);
  group.add(g);
}

function buildShip(group, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(32, 12, 230), new THREE.MeshStandardMaterial({ color: 0x3a1214, roughness: 0.7 }));
  hull.position.y = 2;
  g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(31, 0.5, 228), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8 }));
  deck.position.y = 8.2;
  g.add(deck);
  const { map, emissive } = makeWindowTexture(0.55);
  map.repeat.set(1, 1);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(30, 22, 18), new THREE.MeshStandardMaterial({
    map, emissiveMap: emissive, emissive: new THREE.Color(0.9, 0.85, 0.7), color: 0xd8d8d8, roughness: 0.6,
  }));
  bridge.position.set(0, 19, -98);
  g.add(bridge);
  // Deck cargo.
  const cargo = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CONTAINER.w, CONTAINER.h, CONTAINER.l),
    new THREE.MeshStandardMaterial({ map: corrugated('#bdbdbd'), roughness: 0.6, metalness: 0.3 }),
    11 * 13 * 3,
  );
  const c = new THREE.Color();
  let k = 0;
  for (let bay = 0; bay < 13; bay++) {
    for (let rowX = 0; rowX < 11; rowX++) {
      const stack = 1 + Math.floor(Math.random() * 3);
      for (let h = 0; h < stack; h++) {
        setInstance(cargo, k, -13 + rowX * 2.6, 9.8 + h * 2.6, -80 + bay * 14);
        cargo.setColorAt(k++, c.set(pick(CONTAINER_COLORS)));
      }
    }
  }
  cargo.count = k;
  g.add(cargo);
  for (const [color, side] of [[0xff2020, -1], [0x20ff40, 1]]) {
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: glow(color, 5) }));
    nav.position.set(side * 15.5, 31, -98);
    g.add(nav);
  }
  group.add(g);
}
