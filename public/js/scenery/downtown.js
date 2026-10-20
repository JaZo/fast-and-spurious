// Downtown: skyscrapers with lit windows, neon shop signs, a tiled tunnel and overpasses.

import * as THREE from 'three';
import { canvasTexture, speckle } from '../track.js';
import { NEON_SIGNS } from '../fun.js';
import {
  buildGround, buildLamps, buildBuildings, buildNeonSigns, buildOverpass, setInstance,
} from './common.js';

export function buildDowntown(group, track, def) {
  const tunnel = [track.atFraction(def.tunnel[0]), track.atFraction(def.tunnel[1])];
  const inTunnel = (i) => i >= tunnel[0] - 4 && i <= tunnel[1] + 4;

  buildGround(group, {});
  buildLamps(group, track, { color: def.lamp.color, spacing: def.lamp.spacing, height: def.lamp.height, skip: inTunnel });
  const fronts = buildBuildings(group, track, { skip: inTunnel });
  buildNeonSigns(group, fronts, NEON_SIGNS);
  buildTunnel(group, track, tunnel, def.lamp.color);
  for (const f of def.overpasses) buildOverpass(group, track, track.atFraction(f), 'SPURIOUS CITY');
}

function buildTunnel(group, track, [from, to], lampColor) {
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
  const w = track.wallOffset + 0.4;
  group.add(new THREE.Mesh(track.wall(w, 0, H, 4, from, to), wallMat));
  group.add(new THREE.Mesh(track.wall(-w, 0, H, 4, from, to), wallMat));
  group.add(new THREE.Mesh(track.ribbon(-w - 1, w + 1, H, 6, from, to), roofMat));
  for (const i of [from, to]) {
    const portal = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 6, 3, 1.5), roofMat);
    portal.position.set(track.px[i], track.py[i] + H + 1.2, track.pz[i]);
    portal.rotation.y = track.headingAt(i);
    group.add(portal);
  }

  // Strip lights along both ceiling edges.
  const step = Math.round(6 / track.segLen);
  const count = Math.ceil((to - from) / step) * 2 + 2;
  const lamps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.4, 0.12, 2.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(lampColor).multiplyScalar(5) }),
    count,
  );
  let k = 0;
  for (let i = from; i <= to && k < count - 1; i += step) {
    for (const side of [-1, 1]) {
      const off = side * (track.roadHalf - 1);
      setInstance(lamps, k++, track.px[i] + track.nx[i] * off, track.py[i] + H - 0.1, track.pz[i] + track.nz[i] * off, track.headingAt(i));
    }
  }
  lamps.count = k;
  group.add(lamps);

  const pools = new THREE.Mesh(track.ribbon(-track.roadHalf, track.roadHalf, 0.05, 6, from, to), new THREE.MeshBasicMaterial({
    map: canvasTexture(64, 64, (ctx, cw, ch) => {
      const g = ctx.createLinearGradient(0, 0, cw, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.15)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'rgba(255,255,255,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }),
    color: new THREE.Color(lampColor).multiplyScalar(0.35),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  group.add(pools);
}
