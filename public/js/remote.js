import { CarModel } from './car.js';

const INTERP_DELAY = 110; // ms behind the newest snapshot; a bit more than one tick at 20 Hz
const MAX_EXTRAPOLATE = 250;

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Another player's car, rendered slightly in the past and interpolated between snapshots.
export class RemoteCar {
  constructor(info, scene) {
    this.scene = scene;
    this.buf = [];
    this.trackIdx = 0;
    this.state = { x: 0, z: 0, h: 0, speed: 0, steer: 0, flags: 0 };
    this.visible = false;
    this.model = null;
    this.setInfo(info);
  }

  // Rebuilds the model when the player changes their car in the garage.
  setInfo(info) {
    this.info = info;
    const key = JSON.stringify(info.look);
    if (key === this.lookKey) return;
    this.lookKey = key;
    const opacity = this.model?.opacity ?? 1;
    this.model?.dispose();
    this.model = new CarModel(info.look, { name: info.name });
    this.model.root.visible = this.visible;
    this.model.setOpacity(opacity);
    this.scene.add(this.model.root);
  }

  push(t, x, z, h, v, s, f, i) {
    this.buf.push({ t, x, z, h, v, s, f });
    if (this.buf.length > 30) this.buf.shift();
    this.trackIdx = i;
  }

  update(now, dt) {
    const buf = this.buf;
    if (!buf.length) return;
    const rt = now - INTERP_DELAY;
    const st = this.state;

    let a = buf[0];
    let b = buf[0];
    for (let k = buf.length - 1; k >= 0; k--) {
      if (buf[k].t <= rt) {
        a = buf[k];
        b = buf[k + 1] ?? buf[k];
        break;
      }
    }

    if (a === b) {
      // Ran out of data: coast forward a little, then hold.
      const ahead = Math.min(MAX_EXTRAPOLATE, Math.max(0, rt - a.t)) / 1000;
      st.x = a.x + Math.sin(a.h) * a.v * ahead;
      st.z = a.z + Math.cos(a.h) * a.v * ahead;
      st.h = a.h;
      st.speed = a.v;
      st.steer = a.s;
      st.flags = a.f;
    } else {
      const t = Math.min(1, (rt - a.t) / (b.t - a.t));
      st.x = a.x + (b.x - a.x) * t;
      st.z = a.z + (b.z - a.z) * t;
      st.h = lerpAngle(a.h, b.h, t);
      st.speed = a.v + (b.v - a.v) * t;
      st.steer = a.s + (b.s - a.s) * t;
      st.flags = b.f;
    }

    this.visible = true;
    this.model.root.visible = true;
    this.model.update(st, dt);
  }

  // Velocity estimate for bumping into each other.
  get vx() {
    return Math.sin(this.state.h) * this.state.speed;
  }

  get vz() {
    return Math.cos(this.state.h) * this.state.speed;
  }

  dispose() {
    this.model.dispose();
  }
}
