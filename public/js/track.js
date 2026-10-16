import * as THREE from 'three';
import { TRACK_POINTS, TRACK_WIDTH, CHECKPOINTS } from '/shared/config.js';
import { BILLBOARDS } from './fun.js';

export const SAMPLES = 1200;
export const ROAD_HALF = TRACK_WIDTH / 2;
export const CURB = 1.2;
export const WALL_OFFSET = ROAD_HALF + 8; // gravel run-off between the curb and the tyre wall

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function speckle(ctx, w, h, count, colors) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

export class Track {
  constructor(scene) {
    const curve = new THREE.CatmullRomCurve3(
      TRACK_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    this.segLen = this.length / SAMPLES;

    // Evenly spaced samples with tangent (t) and right-hand normal (n) at each.
    const pts = curve.getSpacedPoints(SAMPLES);
    this.px = new Float32Array(SAMPLES);
    this.pz = new Float32Array(SAMPLES);
    this.tx = new Float32Array(SAMPLES);
    this.tz = new Float32Array(SAMPLES);
    this.nx = new Float32Array(SAMPLES);
    this.nz = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const prev = pts[(i - 1 + SAMPLES) % SAMPLES];
      const next = pts[i + 1];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      this.px[i] = pts[i].x;
      this.pz[i] = pts[i].z;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.nx[i] = -dz;
      this.nz[i] = dx;
    }

    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildGround();
    this.buildRoad();
    this.buildStartLine();
    this.buildScenery();
  }

  cpIndex(cp) {
    return Math.round((cp * SAMPLES) / CHECKPOINTS) % SAMPLES;
  }

  headingAt(i) {
    return Math.atan2(this.tx[i], this.tz[i]);
  }

  // Nearest sample index. Searches around `hint` first, falling back to a full scan.
  nearest(x, z, hint = -1) {
    let best = 0;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + SAMPLES) % SAMPLES;
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

  // Signed distance from the centre line; positive is to the right of the driving direction.
  lateral(i, x, z) {
    return (x - this.px[i]) * this.nx[i] + (z - this.pz[i]) * this.nz[i];
  }

  distanceToTrack(x, z) {
    const i = this.nearest(x, z);
    return Math.hypot(x - this.px[i], z - this.pz[i]);
  }

  // Grid slot k: two columns, rows going back from the start line.
  gridPose(slot) {
    const row = Math.floor(slot / 2);
    const back = 8 + row * 7;
    const i = (SAMPLES - Math.round(back / this.segLen)) % SAMPLES;
    const side = slot % 2 === 0 ? -3.5 : 3.5;
    return {
      x: this.px[i] + this.nx[i] * side,
      z: this.pz[i] + this.nz[i] * side,
      h: this.headingAt(i),
      i,
    };
  }

  // A flat strip following the track between lateral offsets a and b.
  ribbon(a, b, y, vLen) {
    const n = SAMPLES + 1;
    const pos = new Float32Array(n * 6);
    const nor = new Float32Array(n * 6);
    const uv = new Float32Array(n * 4);
    const idx = [];
    for (let k = 0; k < n; k++) {
      const i = k % SAMPLES;
      const v = (k * this.segLen) / vLen;
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

  // A vertical strip at lateral offset `off`.
  wall(off, height, vLen) {
    const n = SAMPLES + 1;
    const pos = new Float32Array(n * 6);
    const uv = new Float32Array(n * 4);
    const idx = [];
    for (let k = 0; k < n; k++) {
      const i = k % SAMPLES;
      const x = this.px[i] + this.nx[i] * off;
      const z = this.pz[i] + this.nz[i] * off;
      const v = (k * this.segLen) / vLen;
      pos.set([x, 0, z, x, height, z], k * 6);
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

  buildGround() {
    const grass = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#4f8a3a';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 1400, ['#5a9a42', '#447a32', '#62a34a', '#3d6e2c']);
    });
    grass.repeat.set(400, 400);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  buildRoad() {
    const asphalt = canvasTexture(256, 512, (ctx, w, h) => {
      ctx.fillStyle = '#3b3c42';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 9000, ['#45464d', '#33343a', '#4d4e55', '#2c2d32']);
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(6, 0, 7, h);
      ctx.fillRect(w - 13, 0, 7, h);
      ctx.fillStyle = '#f5d04a';
      ctx.fillRect(w / 2 - 3, 0, 6, h / 2);
    });
    const road = new THREE.Mesh(
      this.ribbon(-ROAD_HALF, ROAD_HALF, 0.03, 14),
      new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85 }),
    );
    road.receiveShadow = true;
    this.group.add(road);

    const curbTex = canvasTexture(16, 64, (ctx, w, h) => {
      ctx.fillStyle = '#e8322b';
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(0, h / 2, w, h / 2);
    });
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
    for (const [a, b] of [[ROAD_HALF, ROAD_HALF + CURB], [-ROAD_HALF - CURB, -ROAD_HALF]]) {
      const curb = new THREE.Mesh(this.ribbon(a, b, 0.05, 4), curbMat);
      curb.receiveShadow = true;
      this.group.add(curb);
    }

    const gravelTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#c9b68a';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 2500, ['#b9a578', '#d8c79d', '#a8956a']);
    });
    const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1 });
    for (const [a, b] of [[ROAD_HALF + CURB, WALL_OFFSET], [-WALL_OFFSET, -ROAD_HALF - CURB]]) {
      const gravel = new THREE.Mesh(this.ribbon(a, b, 0.02, 8), gravelMat);
      gravel.receiveShadow = true;
      this.group.add(gravel);
    }

    const tyreTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#d92b2b';
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, h / 2, w, h / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, 6, h);
    });
    const wallMat = new THREE.MeshStandardMaterial({ map: tyreTex, roughness: 0.8, side: THREE.DoubleSide });
    for (const off of [WALL_OFFSET, -WALL_OFFSET]) {
      const wall = new THREE.Mesh(this.wall(off, 1.2, 4), wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
    }
  }

  buildStartLine() {
    const checker = canvasTexture(256, 32, (ctx, w, h) => {
      const s = 16;
      for (let x = 0; x < w / s; x++) {
        for (let y = 0; y < h / s; y++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
          ctx.fillRect(x * s, y * s, s, s);
        }
      }
    });
    const h = this.headingAt(0);
    const lineGeo = new THREE.PlaneGeometry(TRACK_WIDTH, 2.2);
    lineGeo.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8 }));
    line.position.set(this.px[0], 0.06, this.pz[0]);
    line.rotation.y = h;
    line.receiveShadow = true;
    this.group.add(line);

    const banner = canvasTexture(1024, 128, (ctx, w, hh) => {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, hh);
      ctx.font = 'italic 900 84px Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffcc00';
      ctx.fillText('FAST & SPURIOUS', w / 2, hh / 2 + 4);
    });
    banner.wrapS = banner.wrapT = THREE.ClampToEdgeWrapping;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d35, metalness: 0.6, roughness: 0.4 });
    const bannerMat = new THREE.MeshStandardMaterial({ map: banner, roughness: 0.6 });

    const gantry = new THREE.Group();
    gantry.position.set(this.px[0], 0, this.pz[0]);
    gantry.rotation.y = h;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), steel);
      pillar.position.set(side * (ROAD_HALF + 2.5), 4.5, 0);
      pillar.castShadow = true;
      gantry.add(pillar);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_WIDTH + 6, 2.2, 0.6),
      [steel, steel, steel, steel, bannerMat, bannerMat],
    );
    beam.position.y = 9;
    beam.castShadow = true;
    gantry.add(beam);
    this.group.add(gantry);
  }

  buildScenery() {
    this.buildTrees();
    this.buildMountains();
    this.buildBillboards();
    this.buildDuck();
  }

  buildTrees() {
    const count = 380;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.35, 0.55, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
      count,
    );
    const leaves = new THREE.InstancedMesh(
      new THREE.ConeGeometry(3, 7, 7),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
      count,
    );
    trunks.castShadow = leaves.castShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 20; tries++) {
      const x = (Math.random() - 0.5) * 1100;
      const z = -250 + Math.random() * 800;
      if (this.distanceToTrack(x, z) < WALL_OFFSET + 6) continue;
      const k = 0.7 + Math.random() * 0.9;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * Math.PI);
      s.set(k, k, k);
      trunks.setMatrixAt(placed, m.compose(p.set(x, 1.5 * k, z), q, s));
      leaves.setMatrixAt(placed, m.compose(p.set(x, (3 + 3.5) * k, z), q, s));
      leaves.setColorAt(placed, c.setHSL(0.27 + Math.random() * 0.08, 0.5, 0.25 + Math.random() * 0.12));
      placed++;
    }
    trunks.count = leaves.count = placed;
    this.group.add(trunks, leaves);
  }

  buildMountains() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f8a7a, roughness: 1, flatShading: true });
    const snow = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 1, flatShading: true });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + Math.random() * 0.1;
      const r = 950 + Math.random() * 250;
      const height = 140 + Math.random() * 200;
      const radius = 160 + Math.random() * 120;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 6 + Math.floor(Math.random() * 3)), mat);
      mountain.position.set(Math.cos(a) * r, height / 2 - 5, 120 + Math.sin(a) * r);
      mountain.rotation.y = Math.random() * Math.PI;
      // Slightly fatter than the peak it sits on, so the two surfaces don't z-fight.
      const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.32, height * 0.3, 6), snow);
      cap.position.y = height * 0.35 + 1;
      mountain.add(cap);
      this.group.add(mountain);
    }
  }

  buildBillboards() {
    const post = new THREE.MeshStandardMaterial({ color: 0x555a63, metalness: 0.5, roughness: 0.5 });
    const back = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.8 });
    BILLBOARDS.forEach((text, k) => {
      const i = (90 + Math.round((k * SAMPLES) / BILLBOARDS.length)) % SAMPLES;
      let side = 1;
      let x = this.px[i] + this.nx[i] * (WALL_OFFSET + 9);
      let z = this.pz[i] + this.nz[i] * (WALL_OFFSET + 9);
      if (this.distanceToTrack(x, z) < WALL_OFFSET + 4) {
        side = -1;
        x = this.px[i] - this.nx[i] * (WALL_OFFSET + 9);
        z = this.pz[i] - this.nz[i] * (WALL_OFFSET + 9);
      }
      const tex = canvasTexture(1024, 256, (ctx, w, h) => {
        const hue = (k * 53) % 360;
        ctx.fillStyle = `hsl(${hue} 80% 52%)`;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(0, h - 40, w, 40);
        ctx.fillStyle = '#fff';
        ctx.font = 'italic 900 78px Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.strokeText(text, w / 2, h / 2 - 10, w - 60);
        ctx.fillText(text, w / 2, h / 2 - 10, w - 60);
      });
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

      const board = new THREE.Group();
      board.position.set(x, 0, z);
      // Face the track: local +z points back along the normal.
      board.rotation.y = Math.atan2(-this.nx[i] * side, -this.nz[i] * side);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      face.position.y = 6.5;
      face.position.z = 0.16;
      const backing = new THREE.Mesh(new THREE.BoxGeometry(16.4, 4.4, 0.3), back);
      backing.position.y = 6.5;
      backing.castShadow = true;
      board.add(face, backing);
      for (const px of [-5, 5]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.6, 0.4), post);
        pole.position.set(px, 2.3, -0.2);
        pole.castShadow = true;
        board.add(pole);
      }
      this.group.add(board);
    });
  }

  // Every serious racing game needs a giant rubber duck in the infield.
  buildDuck() {
    const candidates = [[-140, 140], [0, 130], [200, 150], [-220, 120]];
    const spot = candidates.find(([x, z]) => this.distanceToTrack(x, z) > 45) ?? candidates[0];
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.35 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xff8c00, roughness: 0.4 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });

    const duck = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), yellow);
    body.scale.set(1.25, 0.85, 1.6);
    body.position.y = 8;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(4, 8, 12), yellow);
    tail.position.set(0, 13, -15);
    tail.rotation.x = -0.9;
    const head = new THREE.Mesh(new THREE.SphereGeometry(6.5, 24, 16), yellow);
    head.position.set(0, 20, 9);
    const beak = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8), orange);
    beak.scale.set(1.3, 0.45, 1.4);
    beak.position.set(0, 18.5, 15.5);
    duck.add(body, tail, head, beak);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), black);
      eye.position.set(side * 2.8, 22, 14.2);
      duck.add(eye);
    }
    duck.traverse((o) => { o.castShadow = true; });
    duck.position.set(spot[0], 0, spot[1]);
    duck.rotation.y = Math.atan2(this.px[0] - spot[0], this.pz[0] - spot[1]); // stares at the start line
    this.duck = duck;
    this.group.add(duck);
  }
}
