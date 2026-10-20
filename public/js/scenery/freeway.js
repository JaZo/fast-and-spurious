// Freeway: sound walls, tall lamps, green overhead signs, billboards and a distant skyline.

import * as THREE from 'three';
import { canvasTexture } from '../track.js';
import { FREEWAY_SIGNS, BILLBOARDS } from '../fun.js';
import {
  buildGround, buildLamps, buildBuildings, buildOverpass, neonSign, glow,
} from './common.js';

export function buildFreeway(group, track, def) {
  buildGround(group, { color: '#0e1012', dots: ['#121518', '#0b0d0f', '#14171a'] });
  buildLamps(group, track, {
    color: def.lamp.color, spacing: def.lamp.spacing, height: def.lamp.height, pool: 30, poolStrength: 0.45,
  });
  // Nothing next to the road (sound walls); the city sits further back.
  buildBuildings(group, track, {
    frontage: false, fillers: 320, fillerMargin: 60, fillerHeight: [25, 170], pad: 600, litChance: 0.35,
  });
  for (const f of def.overpasses) buildOverpass(group, track, track.atFraction(f), 'NEON FREEWAY', '#ff2fd6');
  def.signs.forEach((f, k) => buildSignGantry(group, track, track.atFraction(f), FREEWAY_SIGNS.slice(k * 2, k * 2 + 2)));
  buildBillboards(group, track);
}

function signTexture([top, bottom]) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0d6b3c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#f2f2f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 64px Inter, Arial, sans-serif';
    ctx.fillText(top, w / 2, h * 0.36, w - 50);
    ctx.font = '700 46px Inter, Arial, sans-serif';
    ctx.fillText(bottom, w / 2, h * 0.7, w - 50);
  }, { repeat: false });
}

function buildSignGantry(group, track, i, signs) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d45, metalness: 0.7, roughness: 0.4 });
  const W = track.wallOffset;
  const g = new THREE.Group();
  g.position.set(track.px[i], track.py[i], track.pz[i]);
  g.rotation.y = track.headingAt(i);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), steel);
    post.position.set(side * (W - 0.6), 4.5, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.5, 0.5), steel);
  beam.position.y = 9;
  g.add(beam);
  signs.forEach((text, k) => {
    // Face the oncoming traffic, lit just enough to read.
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 4.5),
      new THREE.MeshBasicMaterial({ map: signTexture(text), color: glow(0xffffff, 0.55) }),
    );
    panel.position.set((k === 0 ? 1 : -1) * track.roadHalf * 0.45, 8.6, -0.3);
    panel.rotation.y = Math.PI;
    g.add(panel);
  });
  group.add(g);
}

function buildBillboards(group, track) {
  const colors = ['#ff2fd6', '#38f2ff', '#ffae00', '#7dff3b'];
  const W = track.wallOffset;
  const texts = [...BILLBOARDS].sort(() => Math.random() - 0.5);
  const board = new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.7 });
  const pole = new THREE.MeshStandardMaterial({ color: 0x30333b, metalness: 0.6, roughness: 0.5 });
  texts.slice(0, 7).forEach((text, k) => {
    const i = track.atFraction(0.06 + k * 0.14);
    const side = k % 2 ? 1 : -1;
    const nx = track.nx[i] * side;
    const nz = track.nz[i] * side;
    const g = new THREE.Group();
    g.position.set(track.px[i] + nx * (W + 14), track.py[i], track.pz[i] + nz * (W + 14));
    // Face the road, angled towards drivers coming down it.
    g.rotation.y = Math.atan2(-nx - 0.6 * track.tx[i], -nz - 0.6 * track.tz[i]);
    const back = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 0.4), board);
    back.position.y = 14;
    g.add(back);
    const sign = neonSign(text, colors[k % colors.length], 17, 2);
    sign.position.set(0, 14, 0.25);
    g.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 12, 8), pole);
    post.position.y = 6;
    g.add(post);
    group.add(g);
  });
}
