// The "spurious" bit: mild, short-lived ways to distract the competition. No banana peels.
//  - NOS Purge: a cold cloud out of your front bumper; drivers who go through it get a fogged windscreen.
//  - High Beams: blinds anyone in front of you (in your beam) for a moment.
//  - Spam Call: the driver ahead gets a phone call that covers their minimap and mutes their music.
// Effects last a few seconds and you're immune to the same effect for a while afterwards.

import * as THREE from 'three';
import { ACTIONS, IMMUNITY_MS } from './config.js';
import { pick, SPAM_CALLS } from './fun.js';

const PURGE_MS = 1200;
const CLOUD_LIFE = 3500;
const CLOUD_RADIUS = 6;
const BEAM_RANGE = 80;
const BEAM_HALF_ANGLE = 0.45;

export class Spurious {
  constructor({ hud, audio, music, particles }) {
    Object.assign(this, { hud, audio, music, particles });
    this.readyAt = { purge: 0, brights: 0, call: 0 };
    this.purging = new Map(); // player id -> purge end time
    this.clouds = []; // trail of other players' purges: { x, z, t }
    this.immuneUntil = {};
    this.fog = 0;
    this.fogTarget = 0;
    this.glare = 0;
    this.tmp = [new THREE.Vector3(), new THREE.Vector3()];
  }

  // The local player pressed an action key. Returns the message to send, or null.
  trigger(kind, ctx) {
    const now = performance.now();
    const action = ACTIONS[kind];
    if (now < this.readyAt[kind]) {
      this.hud.toast(`${action.icon} ${action.name} is recharging…`, 1200);
      return null;
    }
    const { me } = ctx;
    let target = null;
    if (kind === 'purge') {
      if (me.physics.nitro < action.nitroCost) {
        this.hud.toast('💨 Not enough nitrous to purge!', 1500);
        return null;
      }
      me.physics.nitro -= action.nitroCost;
      this.purging.set(me.id, now + PURGE_MS);
      this.audio.purge();
    } else if (kind === 'brights') {
      me.model.flash();
      this.audio.click();
    } else if (kind === 'call') {
      target = ctx.callTarget();
      if (target == null) {
        this.hud.toast('📞 Nobody to prank-call. Lonely at the top.', 1800);
        return null;
      }
      this.audio.click();
      this.hud.toast(`📞 Spam-calling ${ctx.nameOf(target)}…`, 2000);
    }
    this.readyAt[kind] = now + action.cooldown;
    return { t: 'act', k: kind, target };
  }

  // Someone else used an action.
  receive(msg, ctx) {
    const now = performance.now();
    const r = ctx.remotes.get(msg.id);
    if (!r) return;
    const name = r.info.name;
    const me = ctx.me.physics;
    if (msg.k === 'purge') {
      this.purging.set(msg.id, now + PURGE_MS);
      const d = Math.hypot(r.state.x - me.x, r.state.z - me.z);
      if (d < 120) this.audio.purge();
    } else if (msg.k === 'brights') {
      r.model.flash();
      if (this.inBeam(r.state, me) && this.canHit('brights', now)) {
        this.glare = 1;
        this.hud.toast(`🔦 ${name} flashed their brights at you!`, 2200);
      }
    } else if (msg.k === 'call' && msg.target === ctx.me.id && this.canHit('call', now)) {
      const [caller, text] = pick(SPAM_CALLS);
      this.hud.phone(caller, text, name, 3500);
      this.audio.ring();
      this.music.duck(3.5);
    }
  }

  canHit(kind, now) {
    if (now < (this.immuneUntil[kind] ?? 0)) return false;
    this.immuneUntil[kind] = now + IMMUNITY_MS;
    return true;
  }

  inBeam(src, me) {
    const dx = me.x - src.x;
    const dz = me.z - src.z;
    const d = Math.hypot(dx, dz);
    if (d > BEAM_RANGE || d < 2) return false;
    return (dx * Math.sin(src.h) + dz * Math.cos(src.h)) / d > Math.cos(BEAM_HALF_ANGLE);
  }

  update(dt, ctx) {
    const now = performance.now();
    for (const [id, until] of this.purging) {
      if (now > until) {
        this.purging.delete(id);
        continue;
      }
      const model = id === ctx.me.id ? ctx.me.model : ctx.remotes.get(id)?.model;
      if (!model) continue;
      const h = model.root.rotation.y;
      const sideX = Math.cos(h);
      const sideZ = -Math.sin(h);
      // ~40 puffs a second: plenty of cloud without drowning the GPU in overdraw.
      if (Math.random() < dt * 20) {
        model.localToWorld([[0.8, 0.45, 2.0], [-0.8, 0.45, 2.0]], this.tmp);
        this.tmp.forEach((p, k) => {
          const out = k === 0 ? 1 : -1;
          this.particles.spawn(p, {
            size: 1.5, alpha: 0.55, life: 2.4, grow: 3, tint: 1, spread: 2, rise: 0.4, vx: sideX * out * 5, vz: sideZ * out * 5,
          });
        });
      }
      if (id !== ctx.me.id) this.clouds.push({ x: model.root.position.x, z: model.root.position.z, t: now });
    }
    this.clouds = this.clouds.filter((c) => now - c.t < CLOUD_LIFE);

    // Driving through someone's purge fogs up the windscreen.
    const p = ctx.me.physics;
    const inCloud = this.clouds.some((c) => (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < CLOUD_RADIUS ** 2);
    if (inCloud && (this.fog > 0.05 || this.canHit('purge', now))) this.fogTarget = 0.85;
    else this.fogTarget = 0;
    this.fog = this.fogTarget > this.fog
      ? Math.min(this.fogTarget, this.fog + dt * 4)
      : Math.max(0, this.fog - dt * 0.6);
    this.glare = Math.max(0, this.glare - dt * 0.75);
    this.hud.setEffects(this.fog, this.glare);

    this.hud.setActions(Object.entries(ACTIONS).map(([kind, a]) => ({
      kind, key: a.key, icon: a.icon, name: a.name, ready: 1 - Math.max(0, this.readyAt[kind] - now) / a.cooldown,
    })));
  }
}
