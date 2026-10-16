import { WebSocket } from 'ws';
import {
  LAPS, CHECKPOINTS, MAX_PLAYERS, COUNTDOWN_MS, RESULTS_MS, FINISH_GRACE_MS, HORNS,
} from '../shared/config.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PALETTE = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ff2d95', '#af52de', '#ff9500', '#5ac8fa'];
const FALLBACK_NAMES = ['Anonymous Hamster', 'Nameless Nugget', 'Mystery Minivan', 'Some Guy In A Car'];

let nextPlayerId = 1;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isNum = (v, limit) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
const round = (v, digits) => Math.round(v * digits) / digits;

function cleanName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return name || pick(FALLBACK_NAMES);
}

function cleanCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  join(ws, msg) {
    let code = cleanCode(msg.room);
    if (!code) code = this.freshCode();

    let room = this.rooms.get(code);
    if (!room) {
      room = new Room(code);
      this.rooms.set(code, room);
    }
    if (room.players.size >= MAX_PLAYERS) {
      send(ws, { t: 'error', msg: `Room ${code} is full. Even the clown car has limits.` });
      return null;
    }
    const player = room.add(ws, msg);
    return { room, player };
  }

  leave(room, player) {
    room.remove(player.id);
    if (room.players.size === 0) this.rooms.delete(room.code);
  }

  freshCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += pick(CODE_CHARS);
      if (!this.rooms.has(code)) return code;
    }
  }

  tick(now) {
    for (const room of this.rooms.values()) room.tick(now);
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.phase = 'lobby'; // lobby -> countdown -> racing -> results -> lobby
    this.phaseEndsAt = 0;
    this.raceStart = 0;
    this.finishCount = 0;
  }

  add(ws, msg) {
    const id = nextPlayerId++;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const wanted = typeof msg.color === 'string' && /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color.toLowerCase() : null;
    const color = wanted && !used.has(wanted) ? wanted : (PALETTE.find((c) => !used.has(c)) ?? '#ffffff');

    const player = {
      id,
      ws,
      name: cleanName(msg.name),
      color,
      horn: HORNS[id % HORNS.length],
      slot: this.players.size,
      ready: false,
      inRace: false,
      lap: 0,
      nextCp: 0,
      cpCount: 0,
      finished: false,
      time: null,
      place: null,
      state: null,
      lastHonk: 0,
    };
    this.players.set(id, player);

    send(ws, {
      t: 'welcome', id, room: this.code, name: player.name, color, horn: player.horn, slot: player.slot,
    });
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
    switch (msg.t) {
      case 'ready':
        if (this.phase !== 'lobby') return;
        player.ready = !!msg.ready;
        this.sendRoom();
        break;

      case 's': {
        const { x, z, h, v, s, f, i } = msg;
        if (!isNum(x, 5000) || !isNum(z, 5000) || !isNum(h, 100) || !isNum(v, 200) || !isNum(s, 2)) return;
        if (!Number.isInteger(f) || f < 0 || f > 15 || !Number.isInteger(i) || i < 0 || i > 100000) return;
        player.state = {
          x: round(x, 100), z: round(z, 100), h: round(h, 1000), v: round(v, 10), s: round(s, 100), f, i,
        };
        break;
      }

      case 'cp':
        this.checkpoint(player, msg.i);
        break;

      case 'honk': {
        const now = Date.now();
        if (now - player.lastHonk < 400) return;
        player.lastHonk = now;
        this.broadcast({ t: 'honk', id: player.id }, player.id);
        break;
      }

      default:
        break;
    }
  }

  // Checkpoints must be hit in order; crossing checkpoint 0 (the start line) advances the lap.
  checkpoint(player, i) {
    if (this.phase !== 'racing' || !player.inRace || player.finished || i !== player.nextCp) return;
    player.nextCp = (i + 1) % CHECKPOINTS;
    player.cpCount++;
    if (i !== 0) return;

    if (player.lap < LAPS) {
      player.lap++;
      this.sendRoom();
      return;
    }

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
        inRace: true, lap: 0, nextCp: 0, cpCount: 0, finished: false, time: null, place: null,
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
    const racers = [...this.players.values()].filter((p) => p.inRace);

    switch (this.phase) {
      case 'lobby':
        if (this.players.size > 0 && [...this.players.values()].every((p) => p.ready)) this.startCountdown(now);
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
    for (const p of this.players.values()) {
      const s = p.state;
      if (s) snap.push([p.id, s.x, s.z, s.h, s.v, s.s, s.f, p.cpCount, s.i]);
    }
    if (snap.length) this.broadcast({ t: 'snap', p: snap });
  }

  sendRoom(extra = {}) {
    this.broadcast({
      t: 'room',
      code: this.code,
      phase: this.phase,
      phaseMs: Math.max(0, this.phaseEndsAt - Date.now()),
      laps: LAPS,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        horn: p.horn,
        ready: p.ready,
        inRace: p.inRace,
        lap: p.lap,
        finished: p.finished,
        time: p.time,
        place: p.place,
      })),
      ...extra,
    });
  }

  broadcast(msg, exceptId = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      // Skip clients whose socket is backed up rather than buffering forever.
      if (p.ws.readyState === WebSocket.OPEN && p.ws.bufferedAmount < 256 * 1024) p.ws.send(data);
    }
  }
}
