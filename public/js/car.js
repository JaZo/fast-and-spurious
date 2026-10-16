import * as THREE from 'three';
import { ROAD_HALF, CURB, WALL_OFFSET } from './track.js';

export const CAR_RADIUS = 1.7;
const HALF_WIDTH = 1.05;

const TUNING = {
  maxSpeed: 58, // m/s, ~210 km/h
  nitroSpeed: 78, // ~280 km/h
  gravelSpeed: 24,
  engine: 22,
  nitroBoost: 20,
  brake: 38,
  reverseAccel: 12,
  reverseMax: 14,
  rolling: 3,
  grip: 9,
  driftGrip: 1.4,
  steerRate: 2.3,
  nitroDrain: 0.28,
  nitroRegen: 0.05,
  driftRegen: 0.3,
};

export const FLAG_NITRO = 1;
export const FLAG_DRIFT = 2;
export const FLAG_BRAKE = 4;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Arcade physics: decompose velocity into forward/sideways parts, grip kills the sideways part.
// Heading 0 faces +z; forward = (sin h, cos h). Positive steer turns right (towards -x).
export class CarPhysics {
  constructor() {
    this.x = 0;
    this.z = 0;
    this.h = 0;
    this.vx = 0;
    this.vz = 0;
    this.steer = 0;
    this.nitro = 1;
    this.nitroOn = false;
    this.drifting = false;
    this.braking = false;
    this.offroad = false;
    this.frozen = false;
    this.trackIdx = -1;
    this.lateral = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get forwardSpeed() {
    return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
  }

  get flags() {
    return (this.nitroOn ? FLAG_NITRO : 0) | (this.drifting ? FLAG_DRIFT : 0) | (this.braking ? FLAG_BRAKE : 0);
  }

  place({ x, z, h, i }) {
    this.x = x;
    this.z = z;
    this.h = h;
    this.vx = this.vz = 0;
    this.steer = 0;
    this.trackIdx = i ?? -1;
  }

  // Returns the impact speed if we hit a wall this step, else 0.
  step(dt, input, track) {
    const T = TUNING;
    const fx = Math.sin(this.h);
    const fz = Math.cos(this.h);
    const sx = Math.cos(this.h);
    const sz = -Math.sin(this.h);
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * sx + this.vz * sz;

    this.steer += (input.steer - this.steer) * Math.min(1, dt * 10);

    if (this.frozen) {
      this.vx = this.vz = 0;
      this.nitroOn = this.drifting = false;
      this.braking = input.brake > 0;
      return 0;
    }

    this.nitroOn = input.nitro && this.nitro > 0 && vF > 2 && input.throttle > 0;
    this.drifting = input.handbrake && Math.abs(vF) > 8;
    this.braking = input.brake > 0 && vF > 1;

    const top = this.offroad ? T.gravelSpeed : (this.nitroOn ? T.nitroSpeed : T.maxSpeed);

    if (input.throttle > 0) {
      const power = T.engine + (this.nitroOn ? T.nitroBoost : 0);
      if (vF < 0) vF += T.brake * dt; // throttle while rolling backwards brakes first
      else if (vF < top) vF += power * input.throttle * (1 - (vF / top) ** 2) * dt;
    }
    if (input.brake > 0) {
      if (vF > 1) vF -= T.brake * input.brake * dt;
      else vF = Math.max(vF - T.reverseAccel * input.brake * dt, -T.reverseMax);
    }
    if (input.throttle === 0 && input.brake === 0) {
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), T.rolling * dt);
    }
    if (vF > top) vF -= (vF - top) * (this.offroad ? 2.5 : 0.8) * dt; // bleed off nitro / gravel
    if (this.drifting) vF -= Math.sign(vF) * 4 * dt;

    // Steering: needs some speed, and calms down at high speed.
    const speedRatio = clamp(Math.abs(vF) / T.maxSpeed, 0, 1);
    const yaw = this.steer * T.steerRate * clamp(Math.abs(vF) / 8, 0, 1) * (1 - 0.45 * speedRatio)
      * Math.sign(vF) * (this.drifting ? 1.5 : 1);
    this.h -= yaw * dt;
    if (this.h > Math.PI) this.h -= Math.PI * 2;
    else if (this.h < -Math.PI) this.h += Math.PI * 2;

    let grip = this.drifting ? T.driftGrip : T.grip * (1 - 0.35 * Math.abs(this.steer) * speedRatio);
    if (this.offroad) grip *= 0.7;
    vR *= Math.exp(-grip * dt);

    if (this.nitroOn) this.nitro = Math.max(0, this.nitro - T.nitroDrain * dt);
    else this.nitro = Math.min(1, this.nitro + (T.nitroRegen + (this.drifting && Math.abs(vR) > 4 ? T.driftRegen : 0)) * dt);

    // Recompose with the *old* axes; the next step decomposes against the new heading, which is the slide.
    this.vx = fx * vF + sx * vR;
    this.vz = fz * vF + sz * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    return this.collideTrack(track);
  }

  collideTrack(track) {
    const i = track.nearest(this.x, this.z, this.trackIdx);
    this.trackIdx = i;
    const lat = track.lateral(i, this.x, this.z);
    this.lateral = lat;
    this.offroad = Math.abs(lat) > ROAD_HALF + CURB;

    const limit = WALL_OFFSET - HALF_WIDTH;
    if (Math.abs(lat) <= limit) return 0;

    const sgn = Math.sign(lat);
    const nx = track.nx[i];
    const nz = track.nz[i];
    const pen = Math.abs(lat) - limit;
    this.x -= nx * sgn * pen;
    this.z -= nz * sgn * pen;
    const vn = this.vx * nx + this.vz * nz;
    if (vn * sgn <= 0) return 0;
    this.vx -= nx * vn * 1.35; // reflect with a weak bounce
    this.vz -= nz * vn * 1.35;
    this.vx *= 0.92; // and some scraping
    this.vz *= 0.92;
    return Math.abs(vn);
  }
}

// ---------- visuals ----------

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const wheel = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 16);
  wheel.rotateZ(Math.PI / 2);
  const flame = new THREE.ConeGeometry(0.22, 1.3, 8);
  flame.rotateX(-Math.PI / 2);
  shared = {
    chassis: new THREE.BoxGeometry(2, 0.55, 4.3),
    nose: new THREE.BoxGeometry(1.8, 0.2, 1.1),
    cabin: new THREE.BoxGeometry(1.55, 0.5, 2.0),
    wing: new THREE.BoxGeometry(2.0, 0.07, 0.45),
    post: new THREE.BoxGeometry(0.08, 0.35, 0.08),
    light: new THREE.BoxGeometry(0.45, 0.16, 0.05),
    wheel,
    flame,
    hatCone: new THREE.ConeGeometry(0.35, 0.9, 12),
    hatBall: new THREE.SphereGeometry(0.35, 12, 8),
    hatCrown: new THREE.CylinderGeometry(0.4, 0.35, 0.35, 8, 1, true),
    honk: textSprite('HONK!', { color: '#1a1a1a', bg: '#ffdd00', font: 'italic 900 52px Impact, sans-serif', w: 256, h: 96 }),
  };
  return shared;
}

function textSprite(text, { color = '#fff', bg = null, font = '600 34px Inter, sans-serif', w = 256, h = 64 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 20);
    ctx.fill();
  }
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!bg) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, w / 2, h / 2, w - 10);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2, w - 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const HATS = ['none', 'cone', 'duck', 'crown'];

export class CarModel {
  constructor(color, { name = null, hatSeed = 0 } = {}) {
    const g = sharedAssets();
    this.materials = {
      paint: new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.35 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x2a3a50, metalness: 0.6, roughness: 0.1 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 }),
      head: new THREE.MeshStandardMaterial({ color: 0xfff6d5, emissive: 0xfff2c0, emissiveIntensity: 1.2 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.8 }),
      flame: new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85 }),
    };
    const M = this.materials;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const add = (geo, mat, x, y, z, parent = this.body) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    add(g.chassis, M.paint, 0, 0.62, 0);
    add(g.nose, M.paint, 0, 0.95, 1.4);
    add(g.cabin, M.glass, 0, 1.15, -0.3);
    add(g.wing, M.dark, 0, 1.28, -1.95);
    add(g.post, M.dark, -0.6, 1.08, -1.95);
    add(g.post, M.dark, 0.6, 1.08, -1.95);
    for (const side of [-1, 1]) {
      add(g.light, M.head, side * 0.65, 0.68, 2.16);
      add(g.light, M.tail, side * 0.65, 0.72, -2.16);
    }

    this.flames = [-0.4, 0.4].map((x) => {
      const f = add(g.flame, M.flame, x, 0.45, -2.85);
      f.castShadow = false;
      f.visible = false;
      return f;
    });

    this.wheels = [];
    this.frontPivots = [];
    for (const [x, z, front] of [[-0.95, 1.4, true], [0.95, 1.4, true], [-0.95, -1.4, false], [0.95, -1.4, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.4, z);
      this.root.add(pivot);
      const wheel = add(g.wheel, M.dark, 0, 0, 0, pivot);
      this.wheels.push(wheel);
      if (front) this.frontPivots.push(pivot);
    }

    this.addHat(HATS[hatSeed % HATS.length]);

    if (name) {
      this.nameTex = textSprite(name);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, transparent: true }));
      tag.scale.set(4, 1, 1);
      tag.position.y = 2.9;
      this.root.add(tag);
    }

    this.honkSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: g.honk, transparent: true }));
    this.honkSprite.scale.set(2.6, 1, 1);
    this.honkSprite.position.y = 4;
    this.honkSprite.visible = false;
    this.root.add(this.honkSprite);
    this.honkTimer = 0;

    this.spin = 0;
    this.opacity = 1;
  }

  addHat(kind) {
    const g = sharedAssets();
    if (kind === 'cone') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 });
      this.materials.hat = mat;
      const cone = new THREE.Mesh(g.hatCone, mat);
      cone.position.set(0, 1.85, -0.3);
      cone.castShadow = true;
      this.body.add(cone);
    } else if (kind === 'duck') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.4 });
      this.materials.hat = mat;
      const b = new THREE.Mesh(g.hatBall, mat);
      b.scale.set(1, 0.8, 1.3);
      b.position.set(0, 1.65, -0.4);
      const head = new THREE.Mesh(g.hatBall, mat);
      head.scale.setScalar(0.65);
      head.position.set(0, 2.0, -0.05);
      this.body.add(b, head);
    } else if (kind === 'crown') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffc400, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide });
      this.materials.hat = mat;
      const crown = new THREE.Mesh(g.hatCrown, mat);
      crown.position.set(0, 1.58, -0.3);
      this.body.add(crown);
    }
  }

  honk() {
    this.honkTimer = 0.9;
  }

  setOpacity(o) {
    if (o === this.opacity) return;
    this.opacity = o;
    for (const mat of Object.values(this.materials)) {
      mat.transparent = o < 1 || mat === this.materials.flame;
      mat.opacity = mat === this.materials.flame ? 0.85 * o : o;
      mat.depthWrite = o >= 1;
      mat.needsUpdate = true;
    }
  }

  // state: { x, z, h, speed, steer, flags }
  update(s, dt) {
    this.root.position.set(s.x, 0, s.z);
    this.root.rotation.y = s.h;

    this.spin += (s.speed * dt) / 0.4;
    for (const w of this.wheels) w.rotation.x = this.spin;
    for (const p of this.frontPivots) p.rotation.y = -s.steer * 0.45;

    const drift = (s.flags & FLAG_DRIFT) !== 0;
    const nitro = (s.flags & FLAG_NITRO) !== 0;
    const brake = (s.flags & FLAG_BRAKE) !== 0;
    const sr = clamp(Math.abs(s.speed) / 60, 0, 1);
    const k = Math.min(1, dt * 8);
    const roll = -s.steer * sr * 0.06 * (drift ? 1.8 : 1);
    const pitch = brake ? 0.035 : (nitro ? -0.03 : 0);
    this.body.rotation.z += (roll - this.body.rotation.z) * k;
    this.body.rotation.x += (pitch - this.body.rotation.x) * k;

    for (const f of this.flames) {
      f.visible = nitro;
      if (nitro) f.scale.set(1, 1, 0.7 + Math.random() * 0.7);
    }
    this.materials.tail.emissiveIntensity = brake ? 3 : 0.8;

    if (this.honkTimer > 0) {
      this.honkTimer -= dt;
      this.honkSprite.visible = true;
      this.honkSprite.position.y = 4 + Math.sin(this.honkTimer * 30) * 0.08;
    } else {
      this.honkSprite.visible = false;
    }
  }

  // World positions of the rear wheels, for tyre smoke.
  rearWheels(out) {
    out[0].set(-0.95, 0.3, -1.4);
    out[1].set(0.95, 0.3, -1.4);
    this.root.localToWorld(out[0]);
    this.root.localToWorld(out[1]);
    return out;
  }

  dispose() {
    this.root.removeFromParent();
    for (const mat of Object.values(this.materials)) mat.dispose();
    this.nameTex?.dispose();
  }
}
