import * as THREE from 'three';
import { canvasTexture } from './track.js';
import { NEON_COLORS } from './tuning.js';

export const CAR_RADIUS = 1.6;
const HALF_WIDTH = 1.0;
const HALF_LENGTH = 2.3;
const GEAR_RATIOS = [0.2, 0.36, 0.52, 0.68, 0.84, 1.0]; // fraction of top speed where each gear tops out
const SLOPE_GRAVITY = 6.5; // m/s² per unit of grade; a bit gentler than real gravity

export const FLAG_NITRO = 1;
export const FLAG_DRIFT = 2;
export const FLAG_BRAKE = 4;
export const FLAG_PURGE = 8;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Arcade physics: decompose velocity into forward/sideways parts, grip kills the sideways part.
// Heading 0 faces +z; forward = (sin h, cos h). Positive steer turns right (towards -x).
export class CarPhysics {
  constructor(tuning) {
    this.T = tuning;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.h = 0;
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.steer = 0;
    this.nitro = 1;
    this.nitroOn = false;
    this.drifting = false;
    this.braking = false;
    this.sidewalk = false;
    this.frozen = false;
    this.trackIdx = -1;
    this.lateral = 0;
    this.gear = 1;
    this.rpm = 0.1;
    this.shifted = false;
  }

  tune(tuning) {
    this.T = tuning;
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

  // Returns the impact speed if we hit something this step, else 0.
  step(dt, input, track) {
    const T = this.T;
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
      this.updateGear(0, input, dt);
      return 0;
    }

    this.nitroOn = input.nitro && this.nitro > 0 && vF > 2 && input.throttle > 0;
    this.drifting = input.handbrake && Math.abs(vF) > 8;
    this.braking = input.brake > 0 && vF > 1;

    let top = this.nitroOn ? T.nitroSpeed : T.maxSpeed;
    if (this.sidewalk) top *= T.sidewalkFactor;

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
    if (vF > top) vF -= (vF - top) * 0.8 * dt; // bleed off after nitro / onto the sidewalk
    // Hills: uphill slows you down, downhill speeds you up.
    if (this.trackIdx >= 0) vF -= SLOPE_GRAVITY * track.grade[this.trackIdx] * (fx * track.tx[this.trackIdx] + fz * track.tz[this.trackIdx]) * dt;
    if (this.drifting) vF -= Math.sign(vF) * 4 * dt;

    // Steering: needs some speed, and calms down at high speed.
    const speedRatio = clamp(Math.abs(vF) / T.maxSpeed, 0, 1);
    const yaw = this.steer * T.steerRate * clamp(Math.abs(vF) / 8, 0, 1) * (1 - 0.45 * speedRatio)
      * Math.sign(vF) * (this.drifting ? 1.5 : 1);
    this.h -= yaw * dt;
    if (this.h > Math.PI) this.h -= Math.PI * 2;
    else if (this.h < -Math.PI) this.h += Math.PI * 2;

    const grip = this.drifting ? T.driftGrip : T.grip * (1 - 0.35 * Math.abs(this.steer) * speedRatio);
    vR *= Math.exp(-grip * dt);

    if (this.nitroOn) this.nitro = Math.max(0, this.nitro - T.nitroDrain * dt);
    else this.nitro = Math.min(1, this.nitro + (T.nitroRegen + (this.drifting && Math.abs(vR) > 4 ? T.driftRegen : 0)) * dt);

    // Recompose with the *old* axes; the next step decomposes against the new heading, which is the slide.
    this.vx = fx * vF + sx * vR;
    this.vz = fz * vF + sz * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.updateGear(vF, input, dt);
    return this.collideTrack(track);
  }

  updateGear(vF, input, dt) {
    const top = this.T.maxSpeed;
    const v = Math.abs(vF);
    let target;
    const prev = this.gear;
    if (this.frozen) {
      target = input.throttle > 0 ? 0.92 : 0.12; // revving on the line
      this.gear = 1;
    } else if (vF < -0.5) {
      this.gear = 'R';
      target = 0.2 + Math.min(1, v / this.T.reverseMax) * 0.6;
    } else {
      let g = 0;
      while (g < GEAR_RATIOS.length - 1 && v > GEAR_RATIOS[g] * top) g++;
      const lo = g ? GEAR_RATIOS[g - 1] * top : 0;
      const hi = GEAR_RATIOS[g] * top;
      const r = clamp((v - lo) / (hi - lo), 0, 1.08);
      target = g === 0 ? 0.12 + r * 0.83 : 0.4 + r * 0.56;
      if (input.throttle === 0) target *= 0.85;
      this.gear = g + 1;
    }
    if (typeof prev === 'number' && typeof this.gear === 'number' && this.gear > prev) this.shifted = true;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 12);
  }

  collideTrack(track) {
    const i = track.nearest(this.x, this.z, this.trackIdx);
    this.trackIdx = i;
    const lat = track.lateral(i, this.x, this.z);
    this.lateral = lat;
    this.sidewalk = Math.abs(lat) > track.roadHalf + 0.4;
    // Elevation and pitch follow the road (physics itself stays 2D).
    this.y = track.heightAt(i, this.x, this.z);
    this.pitch = -Math.atan(track.grade[i] * (Math.sin(this.h) * track.tx[i] + Math.cos(this.h) * track.tz[i]));
    let impact = 0;

    const limit = track.wallOffset - HALF_WIDTH;
    if (Math.abs(lat) > limit) {
      const sgn = Math.sign(lat);
      const nx = track.nx[i];
      const nz = track.nz[i];
      const pen = Math.abs(lat) - limit;
      this.x -= nx * sgn * pen;
      this.z -= nz * sgn * pen;
      const vn = this.vx * nx + this.vz * nz;
      if (vn * sgn > 0) {
        this.vx -= nx * vn * 1.35; // reflect with a weak bounce
        this.vz -= nz * vn * 1.35;
        this.vx *= 0.92; // and some scraping
        this.vz *= 0.92;
        impact = Math.abs(vn);
      }
    }

    // Road-closed barriers at both ends of the street.
    for (const [end, dir] of [[0, -1], [track.samples - 1, 1]]) {
      if (Math.abs(i - end) > 12) continue;
      const a = track.along(end, this.x, this.z) * dir; // > 0 means past the barrier
      const pen = a + HALF_LENGTH + 0.2;
      if (pen <= 0) continue;
      const tx = track.tx[end] * dir;
      const tz = track.tz[end] * dir;
      this.x -= tx * pen;
      this.z -= tz * pen;
      const vt = this.vx * tx + this.vz * tz;
      if (vt > 0) {
        this.vx -= tx * vt * 1.4;
        this.vz -= tz * vt * 1.4;
        impact = Math.max(impact, vt);
      }
    }
    return impact;
  }
}

// ---------- visuals ----------

const LIGHT_COLORS = [0xfff0d0, 0xd8ecff, 0xffd75a];
const RIM_COLORS = [0xd8dde3, 0x18181b, 0xd4a017];
const FINISHES = [
  { metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 }, // gloss
  { metalness: 0.75, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }, // metallic
  { metalness: 0.05, roughness: 0.85, clearcoat: 0, clearcoatRoughness: 0 }, // matte
  { metalness: 0.45, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 1, iridescenceIOR: 1.6 }, // pearl
];
const TINTS = [
  { color: 0x9fb8cc, opacity: 0.35 },
  { color: 0x1c2530, opacity: 0.82 },
  { color: 0x040506, opacity: 0.97 },
];

const BEVEL = { bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10 };

function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(2.22, 0.3);
  s.lineTo(1.84, 0.3);
  s.absarc(1.38, 0.34, 0.46, 0, Math.PI, false);
  s.lineTo(-0.92, 0.3);
  s.absarc(-1.38, 0.34, 0.46, 0, Math.PI, false);
  s.lineTo(-2.22, 0.3);
  s.lineTo(-2.3, 0.5);
  s.lineTo(-2.27, 0.88);
  s.lineTo(-2.0, 0.99);
  s.lineTo(-1.35, 0.99);
  s.lineTo(0.55, 0.98);
  s.lineTo(1.7, 0.9);
  s.lineTo(2.25, 0.78);
  s.lineTo(2.33, 0.5);
  s.closePath();
  return s;
}

function glassShape() {
  const s = new THREE.Shape();
  s.moveTo(0.5, 0.98);
  s.lineTo(-0.15, 1.38);
  s.lineTo(-0.95, 1.4);
  s.lineTo(-1.42, 0.99);
  s.closePath();
  return s;
}

// Extrude a side profile across the car's width (world x), centred on x = cx.
function extrudeProfile(shape, width, cx = 0) {
  const depth = width - BEVEL.bevelThickness * 2;
  const geo = new THREE.ExtrudeGeometry(shape, { ...BEVEL, depth });
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2 + cx, 0, 0);
  return geo;
}

let G = null;
function geometries() {
  if (G) return G;
  const tire = new THREE.CylinderGeometry(0.34, 0.34, 0.27, 22);
  tire.rotateZ(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(0.235, 0.235, 0.02, 22);
  disc.rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(0.235, 0.014, 6, 28);
  lip.rotateY(Math.PI / 2);
  const flame = new THREE.ConeGeometry(0.11, 1.1, 8);
  flame.rotateX(-Math.PI / 2);
  const pipe = new THREE.CylinderGeometry(0.06, 0.06, 0.25, 12);
  pipe.rotateX(Math.PI / 2);
  const cannon = new THREE.CylinderGeometry(0.17, 0.15, 0.55, 16);
  cannon.rotateX(Math.PI / 2);
  const flare = new THREE.TorusGeometry(0.44, 0.07, 6, 16, Math.PI);
  flare.rotateY(Math.PI / 2);
  const glowPlane = new THREE.PlaneGeometry(3.4, 5.8);
  glowPlane.rotateX(-Math.PI / 2);
  const beam = new THREE.PlaneGeometry(8, 18);
  beam.rotateX(-Math.PI / 2);
  G = {
    body: extrudeProfile(bodyShape(), 1.86),
    stripeL: extrudeProfile(bodyShape(), 0.16, 0.2).scale(1, 1.012, 1.006),
    stripeR: extrudeProfile(bodyShape(), 0.16, -0.2).scale(1, 1.012, 1.006),
    glass: extrudeProfile(glassShape(), 1.6),
    tire,
    disc,
    lip,
    flame,
    pipe,
    cannon,
    flare,
    glowPlane,
    beam,
    hatCone: new THREE.ConeGeometry(0.32, 0.85, 12),
    hatBall: new THREE.SphereGeometry(0.32, 12, 8),
    hatCrown: new THREE.CylinderGeometry(0.38, 0.32, 0.34, 8, 1, true),
    box: new THREE.BoxGeometry(1, 1, 1),
    glowTex: canvasTexture(128, 256, (ctx, w, h) => {
      ctx.filter = 'blur(18px)';
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(30, 40, w - 60, h - 80, 30);
      ctx.fill();
    }, { repeat: false }),
    // An elongated soft ellipse that fades out well before the texture edges.
    beamTex: canvasTexture(128, 128, (ctx, w, h) => {
      ctx.translate(w / 2, h * 0.08);
      ctx.scale(0.55, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.85);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-w, 0, w * 2, h);
    }, { repeat: false }),
    honk: textTexture('HONK!', { color: '#111', bg: '#ffdd00', font: 'italic 900 52px Impact, sans-serif', w: 256, h: 96 }),
  };
  return G;
}

function textTexture(text, { color = '#fff', bg = null, font = '700 34px Inter, sans-serif', w = 256, h = 64 } = {}) {
  return canvasTexture(w, h, (ctx) => {
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
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(text, w / 2, h / 2, w - 10);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2, w - 10);
  }, { repeat: false });
}

// Side-panel artwork, in the body shape's own coordinates: u = (z + 2.4) / 4.8, v = y - 0.2.
function vinylTexture(look) {
  const W = 1024;
  const H = 256;
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = look.color;
    ctx.fillRect(0, 0, W, H);
    const X = (z) => ((z + 2.4) / 4.8) * W;
    const Y = (y) => (1 - (y - 0.2)) * H;
    if (look.vinyl === 2) {
      // Flames licking back from the front wheel.
      const grad = ctx.createLinearGradient(X(2.3), 0, X(-0.6), 0);
      grad.addColorStop(0, '#fff6a0');
      grad.addColorStop(0.35, '#ffae00');
      grad.addColorStop(1, look.vinylColor);
      ctx.fillStyle = grad;
      for (let k = 0; k < 7; k++) {
        const y = 0.42 + k * 0.065;
        const len = 1.2 + Math.random() * 1.8;
        ctx.beginPath();
        ctx.moveTo(X(2.35), Y(y - 0.06));
        ctx.bezierCurveTo(X(1.4), Y(y - 0.1), X(2.2 - len * 0.6), Y(y + 0.12), X(2.2 - len), Y(y + 0.03));
        ctx.bezierCurveTo(X(2.2 - len * 0.5), Y(y + 0.02), X(1.6), Y(y + 0.05), X(2.35), Y(y + 0.06));
        ctx.fill();
      }
    } else if (look.vinyl === 3) {
      // Tribal: mirrored spiky blades along the flank.
      ctx.fillStyle = look.vinylColor;
      for (const flip of [1, -1]) {
        for (let k = 0; k < 5; k++) {
          const z0 = 0.3 + flip * (0.25 + k * 0.38);
          ctx.beginPath();
          ctx.moveTo(X(0.3), Y(0.62));
          ctx.quadraticCurveTo(X(z0), Y(0.9 - k * 0.04), X(z0 + flip * 0.35), Y(0.55 + (k % 2 ? 0.15 : -0.1)));
          ctx.quadraticCurveTo(X(z0), Y(0.66), X(0.3), Y(0.56));
          ctx.fill();
        }
      }
    }
  }, { repeat: false });
  tex.repeat.set(1 / 4.8, 1);
  tex.offset.set(0.5, -0.2);
  return tex;
}

const HATS = ['none', 'scoop', 'cone', 'duck', 'crown'];

export class CarModel {
  constructor(look, { name = null } = {}) {
    const g = geometries();
    this.look = look;
    this.materials = [];
    this.textures = [];

    const finish = FINISHES[look.finish];
    const neon = NEON_COLORS[look.neon];
    const lightColor = LIGHT_COLORS[look.lights];

    const paint = this.mat(new THREE.MeshPhysicalMaterial({ color: look.color, ...finish }));
    let sidePaint = paint;
    if (look.vinyl === 2 || look.vinyl === 3) {
      const tex = vinylTexture(look);
      this.textures.push(tex);
      sidePaint = this.mat(new THREE.MeshPhysicalMaterial({ map: tex, ...finish }));
    }
    const dark = this.mat(new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.5, metalness: 0.4 }));
    const rubber = this.mat(new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 }));
    const tint = TINTS[look.tint];
    const glass = this.mat(new THREE.MeshPhysicalMaterial({
      color: tint.color, metalness: 0.2, roughness: 0.05, transparent: true, opacity: tint.opacity, clearcoat: 1,
    }));
    this.headMat = this.mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(lightColor).multiplyScalar(3) }));
    this.headBase = new THREE.Color(lightColor).multiplyScalar(3);
    this.tailMat = this.mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1020).multiplyScalar(1.5) }));
    this.flameMat = this.mat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x4fb8ff).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const rimMat = look.rimColor === 3
      ? this.mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(neon ?? '#38f2ff').multiplyScalar(2.5) }))
      : this.mat(new THREE.MeshStandardMaterial({ color: RIM_COLORS[look.rimColor], metalness: 1, roughness: 0.22 }));

    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ'; // yaw, then pitch with the road
    this.body = new THREE.Group();
    this.body.position.y = -0.025 * look.kit;
    this.root.add(this.body);

    const mesh = (geo, material, x = 0, y = 0, z = 0, parent = this.body, shadow = true) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      parent.add(m);
      return m;
    };
    const box = (sx, sy, sz, material, x, y, z, rx = 0, rz = 0) => {
      const m = mesh(g.box, material, x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.set(rx, 0, rz);
      return m;
    };

    // Shell, glasshouse, roof and some interior so clear glass isn't see-through to nothing.
    mesh(g.body, [sidePaint, paint]);
    mesh(g.glass, glass);
    box(1.5, 0.05, 0.85, paint, 0, 1.44, -0.55);
    box(1.3, 0.32, 1.1, dark, 0, 1.15, -0.45);
    box(0.85, 0.12, 0.05, dark, 0, 0.6, 2.37); // grille

    for (const side of [-1, 1]) {
      box(0.46, 0.13, 0.08, this.headMat, side * 0.6, 0.72, 2.33);
      box(0.5, 0.11, 0.06, this.tailMat, side * 0.6, 0.86, -2.35);
    }

    // Vinyls that aren't side artwork.
    if (look.vinyl === 1) {
      const stripe = this.mat(new THREE.MeshPhysicalMaterial({ color: look.vinylColor, ...finish }));
      mesh(g.stripeL, stripe);
      mesh(g.stripeR, stripe);
      box(0.16, 0.012, 0.86, stripe, 0.2, 1.47, -0.55);
      box(0.16, 0.012, 0.86, stripe, -0.2, 1.47, -0.55);
    } else if (look.vinyl === 4) {
      const tex = canvasTexture(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#f4f4f4';
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = 'italic 900 76px Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('13', w / 2, h / 2 + 4);
      }, { repeat: false });
      this.textures.push(tex);
      const decal = this.mat(new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.3 }));
      const plane = new THREE.PlaneGeometry(0.55, 0.55);
      for (const side of [-1, 1]) {
        const d = mesh(plane, decal, side * 0.945, 0.64, -0.1, this.body, false);
        d.rotation.y = side * Math.PI / 2;
      }
    }

    // Body kit.
    if (look.kit >= 1) {
      box(1.92, 0.05, 0.25, dark, 0, 0.26, 2.25);
      for (const side of [-1, 1]) box(0.08, 0.13, 1.75, paint, side * 0.95, 0.33, 0);
    }
    if (look.kit >= 2) {
      box(2.0, 0.04, 0.42, dark, 0, 0.23, 2.3);
      box(1.6, 0.08, 0.35, dark, 0, 0.3, -2.3);
      for (const x of [-0.5, -0.17, 0.17, 0.5]) box(0.03, 0.14, 0.32, dark, x, 0.3, -2.33);
      const out = look.kit === 3 ? 1.0 : 0.95;
      for (const side of [-1, 1]) {
        for (const z of [-1.38, 1.38]) mesh(g.flare, paint, side * out, 0.34, z);
      }
    }
    if (look.kit === 3) {
      for (const side of [-1, 1]) box(0.32, 0.02, 0.18, dark, side * 0.88, 0.48, 2.2, 0, side * 0.35);
    }

    // Spoiler.
    if (look.spoiler === 1) {
      box(1.7, 0.06, 0.32, paint, 0, 1.08, -2.06, 0.3);
    } else if (look.spoiler === 2) {
      for (const side of [-1, 1]) {
        box(0.05, 0.32, 0.12, dark, side * 0.55, 1.18, -2.0);
        box(0.03, 0.2, 0.46, dark, side * 0.98, 1.36, -2.05);
      }
      box(1.95, 0.05, 0.42, dark, 0, 1.36, -2.05, -0.08);
    } else if (look.spoiler === 3) {
      for (const side of [-1, 1]) {
        box(0.06, 1.15, 0.12, dark, side * 0.6, 1.6, -1.95);
        box(0.04, 0.65, 0.75, paint, side * 1.25, 2.28, -2.02);
      }
      box(2.5, 0.06, 0.62, dark, 0, 2.12, -2.02, -0.1);
      box(2.3, 0.05, 0.42, paint, 0, 2.45, -2.12, -0.2);
    }

    // Hood.
    if (look.hood === 1) {
      box(0.72, 0.13, 0.62, paint, 0, 1.06, 1.2, 0.08);
      box(0.6, 0.08, 0.02, dark, 0, 1.07, 1.52);
    } else if (look.hood === 2) {
      const carbon = this.mat(new THREE.MeshPhysicalMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0.3, clearcoat: 1 }));
      box(1.56, 0.02, 1.5, carbon, 0, 1.0, 1.32, 0.07);
    }

    // Roof accessories (the important stuff).
    this.addRoof(HATS[look.roof], paint);

    // Exhaust.
    const tips = look.exhaust === 1 ? [-0.5, 0.5] : [0.55];
    const pipeGeo = look.exhaust === 2 ? g.cannon : g.pipe;
    this.exhausts = tips.map((x) => {
      const p = mesh(pipeGeo, this.mat(new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.25 })), x, look.exhaust === 2 ? 0.38 : 0.34, -2.42);
      return p;
    });
    this.flames = tips.map((x) => {
      const f = mesh(g.flame, this.flameMat, x, look.exhaust === 2 ? 0.38 : 0.34, -3.0, this.body, false);
      if (look.exhaust === 2) f.scale.set(1.6, 1.6, 1.3);
      f.visible = false;
      return f;
    });

    // Wheels.
    this.wheels = [];
    this.frontPivots = [];
    const wx = 0.84 + (look.kit === 3 ? 0.06 : 0);
    for (const [x, z, front] of [[-wx, 1.38, true], [wx, 1.38, true], [-wx, -1.38, false], [wx, -1.38, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.34, z);
      this.root.add(pivot);
      const wheel = new THREE.Group();
      pivot.add(wheel);
      mesh(g.tire, rubber, 0, 0, 0, wheel);
      this.buildRim(wheel, look.rims, rimMat, dark, Math.sign(x));
      this.wheels.push(wheel);
      if (front) this.frontPivots.push(pivot);
    }

    // Neon underglow: a soft pool of light on the road plus the tubes themselves.
    if (neon) {
      const pool = mesh(g.glowPlane, this.mat(new THREE.MeshBasicMaterial({
        map: g.glowTex, color: new THREE.Color(neon).multiplyScalar(1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      })), 0, 0.05, 0, this.root, false);
      pool.renderOrder = 2;
      const tube = this.mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(neon).multiplyScalar(4) }));
      for (const side of [-1, 1]) box(0.03, 0.03, 2.3, tube, side * 0.88, 0.25, 0);
    }

    // Fake headlight beam on the road.
    this.beamMat = this.mat(new THREE.MeshBasicMaterial({
      map: g.beamTex, color: new THREE.Color(lightColor).multiplyScalar(0.22), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.beamBase = this.beamMat.color.clone();
    const beam = mesh(g.beam, this.beamMat, 0, 0.06, 10.5, this.root, false);
    beam.renderOrder = 2;

    if (name) {
      const tex = textTexture(name);
      this.textures.push(tex);
      const tag = new THREE.Sprite(this.mat(new THREE.SpriteMaterial({ map: tex, transparent: true })));
      tag.scale.set(4, 1, 1);
      tag.position.y = 3;
      this.root.add(tag);
    }

    this.honkSprite = new THREE.Sprite(this.mat(new THREE.SpriteMaterial({ map: g.honk, transparent: true })));
    this.honkSprite.scale.set(2.6, 1, 1);
    this.honkSprite.position.y = 4.1;
    this.honkSprite.visible = false;
    this.root.add(this.honkSprite);
    this.honkTimer = 0;
    this.flashTimer = 0;
    this.spin = 0;
    this.opacity = 1;
  }

  mat(m) {
    this.materials.push(m);
    m.userData.baseOpacity = m.opacity;
    m.userData.baseTransparent = m.transparent;
    return m;
  }

  buildRim(wheel, style, rimMat, dark, side) {
    const g = geometries();
    const x = side * 0.13;
    const add = (geo, material, px, py, pz) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(px, py, pz);
      wheel.add(m);
      return m;
    };
    add(g.lip, rimMat, x, 0, 0);
    add(g.disc, style === 2 ? rimMat : dark, side * (style === 2 ? 0.125 : 0.07), 0, 0);
    const spokes = [5, 10, 0, 14][style];
    const size = [[0.03, 0.21, 0.07], [0.025, 0.21, 0.035], null, [0.02, 0.2, 0.06]][style];
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      const s = add(g.box, rimMat, x, Math.cos(a) * 0.11, Math.sin(a) * 0.11);
      s.scale.set(...size);
      s.rotation.x = a;
      if (style === 3) s.rotation.y = 0.5;
    }
    const cap = add(g.disc, rimMat, x + side * 0.01, 0, 0);
    cap.scale.set(1.2, 0.22, 0.22);
  }

  addRoof(kind, paint) {
    const g = geometries();
    const add = (geo, material, x, y, z) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };
    if (kind === 'scoop') {
      const s = add(g.box, paint, 0, 1.53, -0.3);
      s.scale.set(0.5, 0.12, 0.5);
    } else if (kind === 'cone') {
      add(g.hatCone, this.mat(new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 })), 0, 1.88, -0.5);
    } else if (kind === 'duck') {
      const mat = this.mat(new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.4 }));
      add(g.hatBall, mat, 0, 1.68, -0.6).scale.set(1, 0.8, 1.3);
      add(g.hatBall, mat, 0, 2.0, -0.3).scale.setScalar(0.65);
    } else if (kind === 'crown') {
      add(g.hatCrown, this.mat(new THREE.MeshStandardMaterial({ color: 0xffc400, metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide })), 0, 1.62, -0.5);
    }
  }

  honk() {
    this.honkTimer = 0.9;
  }

  flash() {
    this.flashTimer = 0.6;
  }

  setOpacity(o) {
    if (o === this.opacity) return;
    this.opacity = o;
    for (const m of this.materials) {
      m.transparent = o < 1 || m.userData.baseTransparent;
      m.opacity = m.userData.baseOpacity * o;
      m.depthWrite = o >= 1 && !m.userData.baseTransparent;
      m.needsUpdate = true;
    }
  }

  // state: { x, z, h, speed, steer, flags }
  update(s, dt) {
    this.root.position.set(s.x, s.y ?? 0, s.z);
    this.root.rotation.y = s.h;
    this.root.rotation.x = s.pitch ?? 0;

    this.spin += (s.speed * dt) / 0.34;
    for (const w of this.wheels) w.rotation.x = this.spin;
    for (const p of this.frontPivots) p.rotation.y = -s.steer * 0.45;

    const drift = (s.flags & FLAG_DRIFT) !== 0;
    const nitro = (s.flags & FLAG_NITRO) !== 0;
    const brake = (s.flags & FLAG_BRAKE) !== 0;
    const sr = clamp(Math.abs(s.speed) / 60, 0, 1);
    const k = Math.min(1, dt * 8);
    const roll = -s.steer * sr * 0.05 * (drift ? 1.8 : 1);
    const pitch = brake ? 0.03 : (nitro ? -0.025 : 0);
    this.body.rotation.z += (roll - this.body.rotation.z) * k;
    this.body.rotation.x += (pitch - this.body.rotation.x) * k;

    for (const f of this.flames) {
      f.visible = nitro;
      if (nitro) f.scale.z = (this.look.exhaust === 2 ? 1.3 : 1) * (0.7 + Math.random() * 0.7);
    }
    this.tailMat.color.setRGB(brake ? 6 : 1.5, brake ? 0.2 : 0.05, brake ? 0.3 : 0.08);

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const f = 1 + Math.max(0, this.flashTimer) * 8;
      this.headMat.color.copy(this.headBase).multiplyScalar(f);
      this.beamMat.color.copy(this.beamBase).multiplyScalar(f);
    } else {
      this.headMat.color.copy(this.headBase);
      this.beamMat.color.copy(this.beamBase);
    }

    if (this.honkTimer > 0) {
      this.honkTimer -= dt;
      this.honkSprite.visible = true;
      this.honkSprite.position.y = 4.1 + Math.sin(this.honkTimer * 30) * 0.08;
    } else {
      this.honkSprite.visible = false;
    }
  }

  // World positions of the rear wheels (tyre smoke) or the front corners (NOS purge).
  localToWorld(points, out) {
    points.forEach(([x, y, z], k) => {
      out[k].set(x, y, z);
      this.root.localToWorld(out[k]);
    });
    return out;
  }

  dispose() {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
