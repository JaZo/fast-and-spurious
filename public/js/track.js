import * as THREE from 'three';
import { CHECKPOINTS } from './config.js';
import { makeCurve } from './tracks.js';

const SAMPLE_SPACING = 1.5; // metres between centre-line samples

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

const SHOULDERS = {
  sidewalk: { base: '#3a3b42', dots: ['#43444b', '#33343a'], joints: true },
  asphalt: { base: '#1b1c21', dots: ['#22232a', '#15161a'], joints: false },
  concrete: { base: '#4a4b4f', dots: ['#55565a', '#404145'], joints: true },
  gravel: { base: '#2a2824', dots: ['#36332d', '#1f1d1a', '#403c35'], joints: false },
};

// A point-to-point road: sampled centre line (with elevation), the road surface, shoulders and barriers.
export class Track {
  constructor(def, parent) {
    this.def = def;
    this.roadHalf = def.width / 2;
    this.wallOffset = this.roadHalf + def.shoulder;

    const curve = makeCurve(def);
    this.length = curve.getLength();
    const n = Math.round(this.length / SAMPLE_SPACING);
    this.samples = n;
    this.segLen = this.length / (n - 1);

    const pts = curve.getSpacedPoints(n - 1);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.nx = new Float32Array(n);
    this.nz = new Float32Array(n);
    this.grade = new Float32Array(n); // rise per metre along the driving direction
    for (let i = 0; i < n; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz);
      this.grade[i] = (next.y - prev.y) / len;
      dx /= len;
      dz /= len;
      this.px[i] = pts[i].x;
      this.py[i] = pts[i].y;
      this.pz[i] = pts[i].z;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.nx[i] = -dz; // right-hand side of the driving direction
      this.nz[i] = dx;
    }

    // How sharply the road turns at each sample (radians over ~15 m), for scenery that likes corners.
    this.turn = new Float32Array(n);
    const w = Math.round(7.5 / this.segLen);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w);
      const b = Math.min(n - 1, i + w);
      let d = Math.atan2(this.tx[b], this.tz[b]) - Math.atan2(this.tx[a], this.tz[a]);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.turn[i] = d;
    }

    this.startIdx = this.nearest(...def.start);
    this.finishIdx = this.nearest(...def.finish);

    this.group = new THREE.Group();
    parent.add(this.group);
    this.buildRoad();
    this.buildBarriers();
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
      const hi = Math.min(this.samples - 1, hint + 40);
      for (let i = lo; i <= hi; i++) {
        const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (bestD < (this.wallOffset + 15) ** 2) return best;
    }
    for (let i = 0; i < this.samples; i++) {
      const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // Cheap nearest sample for scenery placement (coarse scan, then refine). Returns { i, d }.
  nearestCoarse(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.samples; i += 6) {
      const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    for (let i = Math.max(0, best - 6); i <= Math.min(this.samples - 1, best + 6); i++) {
      const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { i: best, d: Math.sqrt(bestD) };
  }

  distanceToTrack(x, z) {
    return this.nearestCoarse(x, z).d;
  }

  // Signed distance from the centre line; positive is to the right of the driving direction.
  lateral(i, x, z) {
    return (x - this.px[i]) * this.nx[i] + (z - this.pz[i]) * this.nz[i];
  }

  along(i, x, z) {
    return (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i];
  }

  // Road height under (x, z), interpolated between the nearest sample and its neighbour.
  heightAt(i, x, z) {
    const a = this.along(i, x, z);
    const j = a >= 0 ? Math.min(i + 1, this.samples - 1) : Math.max(i - 1, 0);
    const t = Math.min(1, Math.abs(a) / this.segLen);
    return this.py[i] + (this.py[j] - this.py[i]) * t;
  }

  // Grid slot k: two columns, rows going back from the start line.
  gridPose(slot) {
    const row = Math.floor(slot / 2);
    const back = 7 + row * 8;
    const i = Math.max(1, this.startIdx - Math.round(back / this.segLen));
    const side = (slot % 2 === 0 ? -1 : 1) * Math.min(4.5, this.roadHalf / 2);
    return {
      x: this.px[i] + this.nx[i] * side,
      z: this.pz[i] + this.nz[i] * side,
      h: this.headingAt(i),
      i,
    };
  }

  // A strip following the track between lateral offsets a and b, `y` above the road, over samples [from, to].
  ribbon(a, b, y, vLen, from = 0, to = this.samples - 1) {
    const n = to - from + 1;
    const pos = new Float32Array(n * 6);
    const uv = new Float32Array(n * 4);
    const idx = [];
    for (let k = 0; k < n; k++) {
      const i = from + k;
      const v = (i * this.segLen) / vLen;
      const h = this.py[i] + y;
      pos.set([this.px[i] + this.nx[i] * a, h, this.pz[i] + this.nz[i] * a,
        this.px[i] + this.nx[i] * b, h, this.pz[i] + this.nz[i] * b], k * 6);
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

  // A vertical strip at lateral offset `off`, from y0 to y1 above the road.
  wall(off, y0, y1, vLen, from = 0, to = this.samples - 1) {
    const n = to - from + 1;
    const pos = new Float32Array(n * 6);
    const uv = new Float32Array(n * 4);
    const idx = [];
    for (let k = 0; k < n; k++) {
      const i = from + k;
      const x = this.px[i] + this.nx[i] * off;
      const z = this.pz[i] + this.nz[i] * off;
      const v = (i * this.segLen) / vLen;
      pos.set([x, this.py[i] + y0, z, x, this.py[i] + y1, z], k * 6);
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
    const { lanes, width } = this.def;
    // Wet asphalt: dark, with lane markings, and a roughness map with puddles so reflections break up.
    const asphalt = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#18191e';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 16000, ['#1f2026', '#141519', '#24252b', '#101114']);
      const px = 512 / width; // pixels per metre across
      const line = (x, lw, color, dash) => {
        ctx.fillStyle = color;
        ctx.fillRect(x - (lw * px) / 2, 0, lw * px, dash ? h * 0.45 : h);
      };
      line(w * 0.03, 0.18, '#d9d9d9');
      line(w * 0.97, 0.18, '#d9d9d9');
      if (lanes >= 4) {
        line(w / 2 - 0.18 * px, 0.14, '#d8b23a');
        line(w / 2 + 0.18 * px, 0.14, '#d8b23a');
      } else {
        line(w / 2, 0.14, '#d8b23a', true);
      }
      for (let k = 1; k < lanes; k++) {
        if (k !== lanes / 2) line((k / lanes) * w, 0.14, '#cfcfcf', true);
      }
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
      this.ribbon(-this.roadHalf, this.roadHalf, 0.02, width),
      new THREE.MeshStandardMaterial({ map: asphalt, roughnessMap: puddles, roughness: 0.55, metalness: 0.15 }),
    );
    road.receiveShadow = true;
    this.group.add(road);

    const style = SHOULDERS[this.def.shoulderStyle];
    const shoulderTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = style.base;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 1500, style.dots);
      if (style.joints) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 3;
        for (let i = 0; i <= 4; i++) {
          ctx.beginPath();
          ctx.moveTo(0, (i * h) / 4);
          ctx.lineTo(w, (i * h) / 4);
          ctx.stroke();
        }
      }
    });
    const shoulderMat = new THREE.MeshStandardMaterial({ map: shoulderTex, roughness: 0.75, metalness: 0.05 });
    const R = this.roadHalf;
    const W = this.wallOffset;
    for (const [a, b] of [[R, W], [-W, -R]]) {
      const s = new THREE.Mesh(this.ribbon(a, b, 0.03, 3), shoulderMat);
      s.receiveShadow = true;
      this.group.add(s);
    }

    if (this.def.shoulderStyle === 'sidewalk') {
      const curbTex = canvasTexture(16, 64, (ctx, w, h) => {
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(0, 0, w, h / 2);
        ctx.fillStyle = '#1b1b1b';
        ctx.fillRect(0, h / 2, w, h / 2);
      });
      const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.5 });
      for (const [a, b] of [[R - 0.1, R + 0.4], [-R - 0.4, -R + 0.1]]) {
        this.group.add(new THREE.Mesh(this.ribbon(a, b, 0.04, 2), curbMat));
      }
    }
  }

  buildBarriers() {
    const W = this.wallOffset;
    const add = (geo, mat, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
    };
    const kind = this.def.barrier;

    if (kind === 'jersey' || kind === 'hazard') {
      const tex = canvasTexture(64, 64, (ctx, w, h) => {
        ctx.fillStyle = '#8d8e93';
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, 300, ['#7f8085', '#9a9ba0']);
        if (kind === 'hazard') {
          for (let x = -h; x < w; x += 16) {
            ctx.fillStyle = (x / 16) % 2 ? '#111' : '#e0b000';
            ctx.beginPath();
            ctx.moveTo(x, h);
            ctx.lineTo(x + 16, h);
            ctx.lineTo(x + 16 + h * 0.45, h * 0.55);
            ctx.lineTo(x + h * 0.45, h * 0.55);
            ctx.fill();
          }
        } else {
          ctx.fillStyle = '#e0e0e0';
          ctx.fillRect(0, h * 0.25, w, h * 0.12);
        }
        ctx.fillStyle = '#5b5c61';
        ctx.fillRect(0, 0, 3, h);
      });
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
      for (const off of [W, -W]) add(this.wall(off, 0, 1.1, 3), mat);
    } else if (kind === 'soundwall') {
      const tex = canvasTexture(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#4b4d55';
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, 900, ['#55575f', '#42444b']);
        ctx.fillStyle = '#2f3036';
        ctx.fillRect(0, 0, 4, h);
        ctx.fillStyle = '#5c5e66';
        ctx.fillRect(0, h * 0.05, w, h * 0.04);
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(0, h * 0.8, w, h * 0.03); // reflector band
      });
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
      for (const off of [W, -W]) add(this.wall(off, 0, 4.5, 4), mat);
    } else if (kind === 'guardrail') {
      const tex = canvasTexture(64, 64, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#5d6168');
        g.addColorStop(0.3, '#c3c8cf');
        g.addColorStop(0.5, '#7b8087');
        g.addColorStop(0.7, '#b4b9c0');
        g.addColorStop(1, '#565a61');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide });
      for (const off of [W, -W]) add(this.wall(off, 0.4, 0.8, 4), mat);

      // Posts and amber reflectors.
      const step = Math.max(1, Math.round(4 / this.segLen));
      const count = Math.ceil(this.samples / step) * 2;
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), new THREE.MeshStandardMaterial({ color: 0x6b6f76, metalness: 0.6, roughness: 0.5 }), count);
      const reflectors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.1, 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa020).multiplyScalar(3) }), count);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      const p = new THREE.Vector3();
      let k = 0;
      for (let i = 0; i < this.samples; i += step) {
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.headingAt(i));
        for (const side of [-1, 1]) {
          const off = side * (W + 0.1);
          const x = this.px[i] + this.nx[i] * off;
          const z = this.pz[i] + this.nz[i] * off;
          posts.setMatrixAt(k, m.compose(p.set(x, this.py[i] + 0.4, z), q, one));
          const r = side * (W - 0.05);
          const show = (i / step) % 3 === 0 ? 1 : 0;
          reflectors.setMatrixAt(k, m.compose(p.set(this.px[i] + this.nx[i] * r, this.py[i] + 0.65, this.pz[i] + this.nz[i] * r), q, one.clone().multiplyScalar(show)));
          k++;
        }
      }
      posts.count = reflectors.count = k;
      this.group.add(posts, reflectors);
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
    g.position.set(this.px[i], this.py[i], this.pz[i]);
    g.rotation.y = this.headingAt(i);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), steel);
      pillar.position.set(side * (this.roadHalf + 1.2), 4, 0);
      pillar.castShadow = true;
      g.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.def.width + 3.5, Math.min(2.6, this.def.width / 6), 0.5), [steel, steel, steel, steel, banner, banner]);
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
    const lineGeo = new THREE.PlaneGeometry(this.def.width, 2.4);
    lineGeo.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: checker, roughness: 0.5 }));
    line.position.y = 0.05;
    line.rotation.x = -Math.atan(this.grade[i]);
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
    for (const [i, dir] of [[0, -1], [this.samples - 1, 1]]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(this.wallOffset * 2, 1.4, 0.8), mat);
      cap.position.set(this.px[i] + this.tx[i] * dir * 0.5, this.py[i] + 0.7, this.pz[i] + this.tz[i] * dir * 0.5);
      cap.rotation.y = this.headingAt(i);
      cap.castShadow = true;
      this.group.add(cap);
    }
  }
}
