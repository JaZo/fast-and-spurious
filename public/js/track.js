import * as THREE from 'three';
import {
  TRACK_POINTS, ROAD_WIDTH, CHECKPOINTS, START_POINT, FINISH_POINT,
} from './config.js';

export const SAMPLES = 2400;
export const ROAD_HALF = ROAD_WIDTH / 2;
export const SIDEWALK = 4.5;
export const WALL_OFFSET = ROAD_HALF + SIDEWALK; // concrete barrier at the back of the sidewalk

export function canvasTexture(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function speckle(ctx, w, h, count, colors, size = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

// An open (point-to-point) street circuit: sampled centre line plus the road surface, sidewalks and barriers.
export class Track {
  constructor(scene) {
    const curve = new THREE.CatmullRomCurve3(
      TRACK_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
    );
    this.length = curve.getLength();
    this.segLen = this.length / (SAMPLES - 1);

    const pts = curve.getSpacedPoints(SAMPLES - 1);
    this.px = new Float32Array(SAMPLES);
    this.pz = new Float32Array(SAMPLES);
    this.tx = new Float32Array(SAMPLES);
    this.tz = new Float32Array(SAMPLES);
    this.nx = new Float32Array(SAMPLES);
    this.nz = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(SAMPLES - 1, i + 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      this.px[i] = pts[i].x;
      this.pz[i] = pts[i].z;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.nx[i] = -dz; // right-hand side of the driving direction
      this.nz[i] = dx;
    }

    this.startIdx = this.nearest(...START_POINT);
    this.finishIdx = this.nearest(...FINISH_POINT);

    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildRoad();
    this.buildGantry(this.startIdx, 'START', '#38f2ff');
    this.buildGantry(this.finishIdx, 'FINISH', '#ff2fd6');
    this.buildEndCaps();
  }

  // Checkpoint k sits between the start and the finish; the last one is the finish line.
  cpIndex(k) {
    return Math.round(this.startIdx + ((k + 1) * (this.finishIdx - this.startIdx)) / CHECKPOINTS);
  }

  // Index of the sample at a given fraction of the sprint (0 = start line, 1 = finish line).
  atFraction(f) {
    return Math.round(this.startIdx + f * (this.finishIdx - this.startIdx));
  }

  progress(i) {
    return Math.max(0, Math.min(1, (i - this.startIdx) / (this.finishIdx - this.startIdx)));
  }

  headingAt(i) {
    return Math.atan2(this.tx[i], this.tz[i]);
  }

  // Nearest sample. Searches around `hint` first, falling back to a full scan.
  nearest(x, z, hint = -1) {
    let best = 0;
    let bestD = Infinity;
    if (hint >= 0) {
      const lo = Math.max(0, hint - 40);
      const hi = Math.min(SAMPLES - 1, hint + 40);
      for (let i = lo; i <= hi; i++) {
        const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (bestD < (WALL_OFFSET + 15) ** 2) return best;
    }
    for (let i = 0; i < SAMPLES; i++) {
      const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // Cheap distance to the centre line for scenery placement (coarse scan, then refine).
  distanceToTrack(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < SAMPLES; i += 6) {
      const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    for (let i = Math.max(0, best - 6); i <= Math.min(SAMPLES - 1, best + 6); i++) {
      bestD = Math.min(bestD, (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2);
    }
    return Math.sqrt(bestD);
  }

  // Signed distance from the centre line; positive is to the right of the driving direction.
  lateral(i, x, z) {
    return (x - this.px[i]) * this.nx[i] + (z - this.pz[i]) * this.nz[i];
  }

  along(i, x, z) {
    return (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i];
  }

  // Grid slot k: two columns, rows going back from the start line.
  gridPose(slot) {
    const row = Math.floor(slot / 2);
    const back = 7 + row * 8;
    const i = Math.max(1, this.startIdx - Math.round(back / this.segLen));
    const side = slot % 2 === 0 ? -4.5 : 4.5;
    return {
      x: this.px[i] + this.nx[i] * side,
      z: this.pz[i] + this.nz[i] * side,
      h: this.headingAt(i),
      i,
    };
  }

  // A flat strip following the track between lateral offsets a and b, over samples [from, to].
  ribbon(a, b, y, vLen, from = 0, to = SAMPLES - 1) {
    const n = to - from + 1;
    const pos = new Float32Array(n * 6);
    const nor = new Float32Array(n * 6);
    const uv = new Float32Array(n * 4);
    const idx = [];
    for (let k = 0; k < n; k++) {
      const i = from + k;
      const v = (i * this.segLen) / vLen;
      pos.set([this.px[i] + this.nx[i] * a, y, this.pz[i] + this.nz[i] * a,
        this.px[i] + this.nx[i] * b, y, this.pz[i] + this.nz[i] * b], k * 6);
      nor.set([0, 1, 0, 0, 1, 0], k * 6);
      uv.set([0, v, 1, v], k * 4);
      if (k < n - 1) {
        const q = k * 2;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }

  // A vertical strip at lateral offset `off` from y0 to y1.
  wall(off, y0, y1, vLen, from = 0, to = SAMPLES - 1) {
    const n = to - from + 1;
    const pos = new Float32Array(n * 6);
    const uv = new Float32Array(n * 4);
    const idx = [];
    for (let k = 0; k < n; k++) {
      const i = from + k;
      const x = this.px[i] + this.nx[i] * off;
      const z = this.pz[i] + this.nz[i] * off;
      const v = (i * this.segLen) / vLen;
      pos.set([x, y0, z, x, y1, z], k * 6);
      uv.set([0, v, 1, v], k * 4);
      if (k < n - 1) {
        const q = k * 2;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  buildRoad() {
    // Wet asphalt: dark, with lane markings, and a roughness map with puddles so reflections break up.
    const asphalt = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#18191e';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 16000, ['#1f2026', '#141519', '#24252b', '#101114']);
      const line = (x, width, color, dash) => {
        ctx.fillStyle = color;
        if (dash) ctx.fillRect(x - width / 2, 0, width, h * 0.45);
        else ctx.fillRect(x - width / 2, 0, width, h);
      };
      line(w * 0.03, 6, '#d9d9d9');
      line(w * 0.97, 6, '#d9d9d9');
      line(w * 0.493, 5, '#d8b23a');
      line(w * 0.507, 5, '#d8b23a');
      line(w * 0.25, 5, '#cfcfcf', true);
      line(w * 0.75, 5, '#cfcfcf', true);
    });
    const puddles = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const r = 8 + Math.random() * 30;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, '#0c0c0c');
        g.addColorStop(1, 'rgba(12,12,12,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.6, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { srgb: false });
    puddles.repeat.set(1, 1.5);
    const road = new THREE.Mesh(
      this.ribbon(-ROAD_HALF, ROAD_HALF, 0.02, 20),
      new THREE.MeshStandardMaterial({ map: asphalt, roughnessMap: puddles, roughness: 0.55, metalness: 0.15 }),
    );
    road.receiveShadow = true;
    this.group.add(road);

    const pavement = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#3a3b42';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 1500, ['#43444b', '#33343a']);
      ctx.strokeStyle = '#2a2b30';
      ctx.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (i * h) / 4);
        ctx.lineTo(w, (i * h) / 4);
        ctx.stroke();
      }
    });
    const walkMat = new THREE.MeshStandardMaterial({ map: pavement, roughness: 0.7, metalness: 0.05 });
    for (const [a, b] of [[ROAD_HALF, WALL_OFFSET], [-WALL_OFFSET, -ROAD_HALF]]) {
      const walk = new THREE.Mesh(this.ribbon(a, b, 0.03, 3), walkMat);
      walk.receiveShadow = true;
      this.group.add(walk);
    }

    const curbTex = canvasTexture(16, 64, (ctx, w, h) => {
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(0, h / 2, w, h / 2);
    });
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.5 });
    for (const [a, b] of [[ROAD_HALF - 0.1, ROAD_HALF + 0.4], [-ROAD_HALF - 0.4, -ROAD_HALF + 0.1]]) {
      this.group.add(new THREE.Mesh(this.ribbon(a, b, 0.04, 2), curbMat));
    }

    // Jersey barriers with a reflective stripe.
    const barrierTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#8d8e93';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 300, ['#7f8085', '#9a9ba0']);
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(0, h * 0.25, w, h * 0.12);
      ctx.fillStyle = '#5b5c61';
      ctx.fillRect(0, 0, 3, h);
    });
    const barrierMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.8, side: THREE.DoubleSide });
    for (const off of [WALL_OFFSET, -WALL_OFFSET]) {
      const wall = new THREE.Mesh(this.wall(off, 0, 1.1, 3), barrierMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
    }
  }

  buildGantry(i, text, color) {
    const tex = canvasTexture(1024, 160, (ctx, w, h) => {
      ctx.fillStyle = '#07070b';
      ctx.fillRect(0, 0, w, h);
      const s = 20;
      for (let x = 0; x < w / s; x++) {
        for (const y of [0, h / s - 1]) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
          ctx.fillRect(x * s, y * s, s, s);
        }
      }
      ctx.font = 'italic 900 96px Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = color;
      ctx.shadowBlur = 24;
      ctx.fillStyle = color;
      ctx.fillText(text, w / 2, h / 2 + 4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.5;
      ctx.fillText(text, w / 2, h / 2 + 4);
    }, { repeat: false });
    const steel = new THREE.MeshStandardMaterial({ color: 0x1d1f26, metalness: 0.7, roughness: 0.35 });
    const banner = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) });

    const g = new THREE.Group();
    g.position.set(this.px[i], 0, this.pz[i]);
    g.rotation.y = this.headingAt(i);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), steel);
      pillar.position.set(side * (ROAD_HALF + 1.5), 4, 0);
      pillar.castShadow = true;
      g.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 4, 2.6, 0.5), [steel, steel, steel, steel, banner, banner]);
    beam.position.y = 8.2;
    g.add(beam);

    const checker = canvasTexture(256, 32, (ctx, w, h) => {
      const s = 16;
      for (let x = 0; x < w / s; x++) {
        for (let y = 0; y < h / s; y++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#ddd';
          ctx.fillRect(x * s, y * s, s, s);
        }
      }
    });
    const lineGeo = new THREE.PlaneGeometry(ROAD_WIDTH, 2.4);
    lineGeo.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: checker, roughness: 0.5 }));
    line.position.y = 0.05;
    line.receiveShadow = true;
    g.add(line);
    this.group.add(g);
  }

  // Road-closed barriers at both ends of the street.
  buildEndCaps() {
    const tex = canvasTexture(256, 64, (ctx, w, h) => {
      for (let x = -h; x < w; x += 32) {
        ctx.fillStyle = (x / 32) % 2 ? '#111' : '#ffcc00';
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + 32, h);
        ctx.lineTo(x + 32 + h, 0);
        ctx.lineTo(x + h, 0);
        ctx.fill();
      }
    });
    tex.repeat.set(4, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0x222200 });
    for (const [i, dir] of [[0, -1], [SAMPLES - 1, 1]]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(WALL_OFFSET * 2, 1.4, 0.8), mat);
      cap.position.set(this.px[i] + this.tx[i] * dir * 0.5, 0.7, this.pz[i] + this.tz[i] * dir * 0.5);
      cap.rotation.y = this.headingAt(i);
      cap.castShadow = true;
      this.group.add(cap);
    }
  }
}
