// The race room. Runs in the browser of whoever created the room (the host).
// Every player, including the host itself, is a { send } endpoint; the room never touches the network directly.

import {
  CHECKPOINTS, MAX_PLAYERS, COUNTDOWN_MS, RESULTS_MS, FINISH_GRACE_MS, IDLE_KICK_MS, HORNS, ACTIONS,
} from './config.js';
import { sanitizeLook } from './tuning.js';

const FALLBACK_NAMES = ['Anonymous Hamster', 'Nameless Nugget', 'Mystery Minivan', 'Some Guy In A Car'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isNum = (v, limit) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
const round = (v, digits) => Math.round(v * digits) / digits;

function cleanName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return name || pick(FALLBACK_NAMES);
}

export class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.nextId = 1;
    this.phase = 'lobby'; // lobby -> countdown -> racing -> results -> lobby
    this.phaseEndsAt = 0;
    this.raceStart = 0;
    this.finishCount = 0;
  }

  // Returns the player, or null if the room is full.
  add(send, msg, { local = false } = {}) {
    if (this.players.size >= MAX_PLAYERS) {
      send({ t: 'error', msg: `Room ${this.code} is full. Even the clown car has limits.` });
      return null;
    }
    const id = this.nextId++;
    const used = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;

    const player = {
      id,
      send,
      local,
      name: cleanName(msg.name),
      look: sanitizeLook(msg.look),
      horn: HORNS[id % HORNS.length],
      slot,
      ready: false,
      inRace: false,
      nextCp: 0,
      finished: false,
      time: null,
      place: null,
      state: null,
      lastSeen: Date.now(),
      lastAct: {},
      lastHonk: 0,
    };
    this.players.set(id, player);

    send({ t: 'welcome', id, room: this.code, name: player.name, horn: player.horn, slot });
    this.broadcast({ t: 'event', kind: 'join', id, name: player.name }, id);
    this.sendRoom();
    return player;
  }

  remove(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.broadcast({ t: 'event', kind: 'leave', id, name: player.name });
    this.sendRoom();
  }

  handle(player, msg) {
    if (!this.players.has(player.id)) return;
    const now = Date.now();
    player.lastSeen = now;

    switch (msg.t) {
      case 'ready':
        if (this.phase !== 'lobby') return;
        player.ready = !!msg.ready;
        this.sendRoom();
        break;

      case 'look':
        if (this.phase === 'countdown' || this.phase === 'racing') return;
        player.look = sanitizeLook(msg.look);
        this.sendRoom();
        break;

      case 's': {
        const { x, z, h, v, s, f, i } = msg;
        if (!isNum(x, 5000) || !isNum(z, 5000) || !isNum(h, 100) || !isNum(v, 200) || !isNum(s, 2)) return;
        if (!Number.isInteger(f) || f < 0 || f > 255 || !Number.isInteger(i) || i < 0 || i > 100000) return;
        player.state = {
          x: round(x, 100), z: round(z, 100), h: round(h, 1000), v: round(v, 10), s: round(s, 100), f, i,
        };
        break;
      }

      case 'cp':
        this.checkpoint(player, msg.i);
        break;

      case 'honk':
        if (now - player.lastHonk < 400) return;
        player.lastHonk = now;
        this.broadcast({ t: 'honk', id: player.id }, player.id);
        break;

      case 'act': {
        const action = ACTIONS[msg.k];
        if (!action) return;
        // A second of slack for clocks and latency; the client enforces the real cooldown.
        if (now - (player.lastAct[msg.k] ?? 0) < action.cooldown - 1000) return;
        player.lastAct[msg.k] = now;
        const target = Number.isInteger(msg.target) && this.players.has(msg.target) ? msg.target : null;
        this.broadcast({ t: 'act', id: player.id, k: msg.k, target }, player.id);
        break;
      }

      default:
        break;
    }
  }

  // Checkpoints must be hit in order; the last one is the finish line.
  checkpoint(player, i) {
    if (this.phase !== 'racing' || !player.inRace || player.finished || i !== player.nextCp) return;
    player.nextCp++;
    if (player.nextCp < CHECKPOINTS) return;

    const now = Date.now();
    player.finished = true;
    player.time = now - this.raceStart;
    player.place = ++this.finishCount;
    if (player.place === 1) this.phaseEndsAt = now + FINISH_GRACE_MS;
    this.broadcast({
      t: 'event', kind: 'finish', id: player.id, name: player.name, place: player.place, time: player.time,
    });
    this.sendRoom();
  }

  startCountdown(now) {
    this.phase = 'countdown';
    this.phaseEndsAt = now + COUNTDOWN_MS;
    this.finishCount = 0;
    const grid = {};
    let slot = 0;
    for (const p of this.players.values()) {
      Object.assign(p, {
        inRace: true, nextCp: 0, finished: false, time: null, place: null,
      });
      grid[p.id] = slot++;
    }
    this.sendRoom({ grid });
  }

  toLobby() {
    this.phase = 'lobby';
    this.phaseEndsAt = 0;
    for (const p of this.players.values()) {
      p.ready = false;
      p.inRace = false;
    }
    this.sendRoom();
  }

  tick(now) {
    for (const p of [...this.players.values()]) {
      if (!p.local && now - p.lastSeen > IDLE_KICK_MS) {
        this.remove(p.id);
        p.onKick?.();
      }
    }

    const all = [...this.players.values()];
    const racers = all.filter((p) => p.inRace);

    switch (this.phase) {
      case 'lobby':
        if (all.length > 0 && all.every((p) => p.ready)) this.startCountdown(now);
        break;
      case 'countdown':
        if (racers.length === 0) {
          this.toLobby();
        } else if (now >= this.phaseEndsAt) {
          this.phase = 'racing';
          this.raceStart = this.phaseEndsAt;
          this.phaseEndsAt = 0;
          this.sendRoom();
        }
        break;
      case 'racing': {
        const allDone = racers.every((p) => p.finished);
        const graceOver = this.phaseEndsAt > 0 && now >= this.phaseEndsAt;
        if (allDone || graceOver) {
          this.phase = 'results';
          this.phaseEndsAt = now + RESULTS_MS;
          this.sendRoom();
        }
        break;
      }
      case 'results':
        if (now >= this.phaseEndsAt) this.toLobby();
        break;
      default:
        break;
    }

    const snap = [];
    for (const p of all) {
      const s = p.state;
      if (s) snap.push([p.id, s.x, s.z, s.h, s.v, s.s, s.f, s.i]);
    }
    if (snap.length) this.broadcast({ t: 'snap', p: snap });
  }

  sendRoom(extra = {}) {
    this.broadcast({
      t: 'room',
      code: this.code,
      phase: this.phase,
      phaseMs: Math.max(0, this.phaseEndsAt - Date.now()),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        look: p.look,
        horn: p.horn,
        slot: p.slot,
        ready: p.ready,
        inRace: p.inRace,
        finished: p.finished,
        time: p.time,
        place: p.place,
      })),
      ...extra,
    });
  }

  broadcast(msg, exceptId = null) {
    for (const p of this.players.values()) {
      if (p.id !== exceptId) p.send(msg);
    }
  }
}
