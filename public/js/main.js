import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LAPS, CHECKPOINTS, TICK_RATE } from '/shared/config.js';
import { Track, SAMPLES } from './track.js';
import { CarPhysics, CarModel, CAR_RADIUS, FLAG_DRIFT } from './car.js';
import { RemoteCar } from './remote.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { Hud } from './hud.js';
import { AudioFX } from './audio.js';
import { Particles } from './particles.js';
import * as fun from './fun.js';

// ---------- scene ----------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const SKY = 0x9fd4f5;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 250, 1500);
// Soft studio reflections so the paint looks like paint.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 3000);

scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x4a6b3a, 1.2));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const track = new Track(scene);
const particles = new Particles(scene);
const hud = new Hud(track);
const input = new Input();
const audio = new AudioFX();

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  particles.setViewportHeight(innerHeight * renderer.getPixelRatio());
}
addEventListener('resize', resize);
resize();

// ---------- game state ----------

const me = {
  id: 0,
  physics: new CarPhysics(),
  model: null,
  horn: 'classic',
  lap: 0,
  nextCp: 0,
  cpCount: 0,
  finished: false,
  finishTime: null,
};
const remotes = new Map();
let room = { code: '', phase: 'lobby', players: [] };
let playersById = new Map();
let net = null;
let goTime = 0; // performance.now() timestamp of the green light
let phaseEndsLocal = 0;
let camMode = 0;
let snapCamera = true;
let lastWallQuip = 0;
let lastBumpQuip = 0;
let lastReset = 0;
let lastCountdownSecond = null;
let wrongWayTime = 0;

const myInfo = () => playersById.get(me.id);
const isRacePhase = () => room.phase === 'countdown' || room.phase === 'racing';
const amRacing = () => isRacePhase() && !!myInfo()?.inRace;
// Players who aren't (or are no longer) competing drive as ghosts so they can't wreck the race.
const isGhost = (info, finished) => isRacePhase() && (!info?.inRace || finished);

// ---------- networking ----------

hud.bindMenu(({ name, room: code, color }) => {
  audio.init();
  net = new Net({
    welcome: onWelcome,
    room: onRoom,
    snap: onSnap,
    honk: onHonk,
    event: onEvent,
    error: (msg) => hud.menuError(msg.msg),
    close: () => { if (me.id) hud.showDisconnected(); else hud.menuError('Could not reach the server. Is it running?'); },
  });
  net.connect(() => net.send({ t: 'join', name, room: code, color }));
});

hud.bindLobby(toggleReady);

function toggleReady() {
  if (room.phase !== 'lobby') return;
  net?.send({ t: 'ready', ready: !myInfo()?.ready });
}

function onWelcome(msg) {
  me.id = msg.id;
  me.horn = msg.horn;
  me.model = new CarModel(msg.color, { hatSeed: msg.id });
  scene.add(me.model.root);
  me.physics.place(track.gridPose(msg.slot % 8));
  snapCamera = true;
  history.replaceState(null, '', `?room=${encodeURIComponent(msg.room)}`);
  hud.showGame();
  hud.toast(`Welcome, ${msg.name}! Share room code ${msg.room} with your friends.`, 5000);
}

function onRoom(msg) {
  const prevPhase = room.phase;
  room = msg;
  playersById = new Map(msg.players.map((p) => [p.id, p]));
  phaseEndsLocal = performance.now() + msg.phaseMs;

  for (const p of msg.players) {
    if (p.id === me.id) continue;
    if (!remotes.has(p.id)) remotes.set(p.id, new RemoteCar(p, scene));
    remotes.get(p.id).info = p;
  }
  for (const [id, r] of remotes) {
    if (!playersById.has(id)) {
      r.dispose();
      remotes.delete(id);
    }
  }

  const mine = myInfo();
  if (msg.phase === 'countdown' && prevPhase !== 'countdown' && mine?.inRace) {
    me.physics.place(track.gridPose(msg.grid?.[me.id] ?? 0));
    me.physics.nitro = 1;
    Object.assign(me, { lap: 0, nextCp: 0, cpCount: 0, finished: false, finishTime: null });
    goTime = phaseEndsLocal;
    lastCountdownSecond = null;
    snapCamera = true;
    hud.hideResults();
  }
  if (msg.phase === 'results' && prevPhase !== 'results') hud.showResults(msg.players, me.id);
  if (msg.phase === 'lobby' && prevPhase !== 'lobby') hud.hideResults();

  hud.updateRoom(room, me.id);
}

function onSnap(msg) {
  const now = performance.now();
  for (const [id, x, z, h, v, s, f, c, i] of msg.p) {
    if (id !== me.id) remotes.get(id)?.push(now, x, z, h, v, s, f, c, i);
  }
}

function onHonk({ id }) {
  const r = remotes.get(id);
  if (!r) return;
  r.model.honk();
  const d = Math.hypot(r.state.x - me.physics.x, r.state.z - me.physics.z);
  audio.honk(r.info.horn, Math.max(0, 1 - d / 300));
}

function onEvent(msg) {
  if (msg.kind === 'join') hud.toast(`${msg.name} ${fun.pick(fun.JOIN_QUIPS)}`);
  else if (msg.kind === 'leave') hud.toast(`${msg.name} ${fun.pick(fun.LEAVE_QUIPS)}`);
  else if (msg.kind === 'finish') {
    hud.toast(`🏁 ${msg.name} finished ${msg.place}${fun.ordinal(msg.place)} (${fun.formatTime(msg.time)})`, 5000);
    if (msg.id === me.id) {
      me.finished = true;
      me.finishTime = msg.time;
      const total = room.players.filter((p) => p.inRace).length;
      hud.bigMessage(fun.finishQuip(msg.place, total), 4000);
      audio.honk(me.horn, 0.8);
    }
  }
}

// ---------- gameplay helpers ----------

function respawn() {
  const now = performance.now();
  if (me.physics.frozen || now - lastReset < 1500) return;
  lastReset = now;
  const i = me.physics.trackIdx >= 0 ? me.physics.trackIdx : 0;
  me.physics.place({ x: track.px[i], z: track.pz[i], h: track.headingAt(i), i });
  snapCamera = true;
  hud.toast(fun.pick(fun.RESET_QUIPS));
}

// Race progress as a single comparable number: checkpoints passed + fraction towards the next one.
function progressScore(cpCount, trackIdx) {
  const segment = SAMPLES / CHECKPOINTS;
  const last = (((cpCount - 1) % CHECKPOINTS) + CHECKPOINTS) % CHECKPOINTS;
  const frac = ((trackIdx - track.cpIndex(last) + SAMPLES) % SAMPLES) / segment;
  return cpCount + Math.min(0.999, Math.max(0, frac));
}

function standings() {
  const entries = [];
  for (const p of room.players) {
    if (!p.inRace) continue;
    if (p.id === me.id) {
      entries.push({ id: p.id, place: p.place, score: progressScore(me.cpCount, me.physics.trackIdx) });
    } else {
      const r = remotes.get(p.id);
      entries.push({ id: p.id, place: p.place, score: r ? progressScore(r.cpCount, r.trackIdx) : 0 });
    }
  }
  entries.sort((a, b) => {
    if (a.place || b.place) return (a.place ?? 99) - (b.place ?? 99);
    return b.score - a.score;
  });
  return entries;
}

function checkCheckpoints() {
  if (room.phase !== 'racing' || !amRacing() || me.finished || me.physics.frozen) return;
  const ci = track.cpIndex(me.nextCp);
  const past = (me.physics.trackIdx - ci + SAMPLES) % SAMPLES;
  if (past >= SAMPLES / CHECKPOINTS / 2) return;

  net.send({ t: 'cp', i: me.nextCp });
  if (me.nextCp === 0) {
    me.lap++;
    if (me.lap === LAPS) hud.bigMessage("FINAL LAP! Don't bottle it.");
    else if (me.lap > 1 && me.lap < LAPS) hud.bigMessage(`LAP ${me.lap}`, 1500);
  }
  me.nextCp = (me.nextCp + 1) % CHECKPOINTS;
  me.cpCount++;
}

function collideWithRemotes() {
  const p = me.physics;
  if (isGhost(myInfo(), me.finished)) return;
  const R = CAR_RADIUS * 2;
  for (const r of remotes.values()) {
    if (!r.visible || isGhost(r.info, r.info.finished)) continue;
    const dx = p.x - r.state.x;
    const dz = p.z - r.state.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    // Each client only moves its own car, so take a bit more than half the overlap.
    p.x += nx * (R - d) * 0.6;
    p.z += nz * (R - d) * 0.6;
    const vn = (p.vx - r.vx) * nx + (p.vz - r.vz) * nz;
    if (vn < 0) {
      p.vx -= nx * vn * 0.9;
      p.vz -= nz * vn * 0.9;
      if (-vn > 4) audio.thud(-vn);
      const now = performance.now();
      if (-vn > 10 && now - lastBumpQuip > 5000) {
        lastBumpQuip = now;
        hud.toast(fun.pick(fun.BUMP_QUIPS));
      }
    }
  }
}

const wheelPos = [new THREE.Vector3(), new THREE.Vector3()];
function smokeFrom(model, speed, flags, dt) {
  if ((flags & FLAG_DRIFT) === 0 || Math.abs(speed) < 8 || Math.random() > dt * 40) return;
  model.rearWheels(wheelPos);
  particles.spawn(wheelPos[0]);
  particles.spawn(wheelPos[1]);
}

// ---------- camera ----------

const camLook = new THREE.Vector3();
let camHeading = 0;
let orbit = 0;

function updateCamera(dt) {
  const p = me.physics;
  const speed = p.speed;
  // Follow rigidly in position, but let the viewing angle trail the car so drifts look like drifts.
  let dh = p.h - camHeading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  camHeading = snapCamera ? p.h : camHeading + dh * (1 - Math.exp(-dt * 6));
  snapCamera = false;

  const fx = Math.sin(p.h);
  const fz = Math.cos(p.h);
  if (camMode === 0) {
    const back = 7 + speed * 0.03;
    camera.position.set(p.x - Math.sin(camHeading) * back, 2.8 + speed * 0.01, p.z - Math.cos(camHeading) * back);
    camLook.set(p.x + fx * 4, 1.2, p.z + fz * 4);
  } else {
    camera.position.set(p.x + fx * 0.2, 1.45, p.z + fz * 0.2);
    camLook.set(p.x + fx * 10, 1.25, p.z + fz * 10);
  }
  if (p.nitroOn) camera.position.y += (Math.random() - 0.5) * 0.06;
  camera.lookAt(camLook);

  const fov = 62 + Math.min(speed, 80) * 0.22 + (p.nitroOn ? 8 : 0);
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();

  sun.position.set(p.x + 60, 140, p.z + 40);
  sun.target.position.set(p.x, 0, p.z);
}

function attractCamera(dt) {
  orbit += dt * 0.05;
  camera.position.set(Math.cos(orbit) * 480, 170, 120 + Math.sin(orbit) * 480);
  camera.lookAt(0, 0, 120);
  sun.position.set(60, 300, 40);
  sun.target.position.set(0, 0, 120);
}

// ---------- main loop ----------

const STEP = 1 / 120;
let acc = 0;
let sendAcc = 0;
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (!me.model) {
    attractCamera(dt);
    renderer.render(scene, camera);
    return;
  }

  const p = me.physics;
  const mine = myInfo();
  const racing = amRacing();
  const inp = input.read();

  if (inp.horn) {
    net.send({ t: 'honk' });
    audio.honk(me.horn, 1);
    me.model.honk();
  }
  if (inp.reset) respawn();
  if (inp.camera) camMode = (camMode + 1) % 2;
  if (inp.ready) toggleReady();

  // Countdown lights.
  p.frozen = racing && now < goTime;
  if (racing && now < goTime) {
    const sec = Math.ceil((goTime - now) / 1000);
    if (sec !== lastCountdownSecond) {
      lastCountdownSecond = sec;
      audio.beep(false);
    }
    hud.setCountdown(String(sec));
  } else if (racing && now - goTime < 1000) {
    if (lastCountdownSecond !== 0) {
      lastCountdownSecond = 0;
      audio.beep(true);
    }
    hud.setCountdown('SEND IT!');
  } else {
    hud.setCountdown(null);
  }

  // Physics at a fixed rate.
  acc += dt;
  let impact = 0;
  while (acc >= STEP) {
    impact = Math.max(impact, p.step(STEP, inp, track));
    acc -= STEP;
  }
  if (impact > 3) audio.thud(impact);
  if (impact > 14 && now - lastWallQuip > 4000) {
    lastWallQuip = now;
    hud.toast(fun.pick(fun.WALL_QUIPS));
  }

  for (const r of remotes.values()) r.update(now, dt);
  collideWithRemotes();
  checkCheckpoints();

  sendAcc += dt;
  if (sendAcc >= 1 / TICK_RATE) {
    sendAcc %= 1 / TICK_RATE;
    net.send({
      t: 's', x: p.x, z: p.z, h: p.h, v: p.forwardSpeed, s: p.steer, f: p.flags, i: Math.max(0, p.trackIdx),
    });
  }

  // Visuals.
  const flags = p.flags;
  me.model.update({ x: p.x, z: p.z, h: p.h, speed: p.forwardSpeed, steer: p.steer, flags }, dt);
  me.model.setOpacity(isGhost(mine, me.finished) ? 0.45 : 1);
  smokeFrom(me.model, p.forwardSpeed, flags, dt);
  for (const r of remotes.values()) {
    if (!r.visible) continue;
    r.model.setOpacity(isGhost(r.info, r.info.finished) ? 0.35 : 1);
    smokeFrom(r.model, r.state.speed, r.state.flags, dt);
  }
  particles.update(dt);
  updateCamera(dt);

  // Sound.
  audio.engine(Math.abs(p.forwardSpeed), inp.throttle, p.nitroOn, true);
  audio.skid(p.drifting ? Math.min(1, p.speed / 30) : 0);

  // Wrong-way detection.
  const ti = Math.max(0, p.trackIdx);
  const along = p.vx * track.tx[ti] + p.vz * track.tz[ti];
  wrongWayTime = along < -5 ? wrongWayTime + dt : 0;

  // HUD.
  hud.setSpeed(p.speed * 3.6, p.nitro, p.nitroOn);
  if (racing) {
    const order = standings();
    const position = Math.max(1, order.findIndex((e) => e.id === me.id) + 1);
    const timeMs = me.finished ? me.finishTime : Math.max(0, now - goTime);
    hud.setRace({
      position, total: order.length, lap: Math.min(Math.max(me.lap, 1), LAPS), laps: LAPS, timeMs,
    });
  } else {
    hud.setRace(null);
  }

  const left = Math.ceil((phaseEndsLocal - now) / 1000);
  let banner = '';
  if (wrongWayTime > 1) banner = '⚠ WRONG WAY, COLUMBUS ⚠';
  else if (room.phase === 'lobby') banner = 'Free roam! Hit READY when you want to race.';
  else if (isRacePhase() && !mine?.inRace) banner = "👻 Race in progress — you're a ghost until the next one.";
  else if (room.phase === 'racing' && me.finished) banner = 'Finished! Waiting for the slowpokes…';
  else if (room.phase === 'racing' && room.phaseMs > 0 && left > 0) banner = `Hurry! ${left}s until the bus leaves.`;
  hud.setBanner(banner);
  if (room.phase === 'results') hud.setResultsTimer(left);

  const dots = [{ x: p.x, z: p.z, color: me.model.materials.paint.color.getStyle(), me: true }];
  for (const r of remotes.values()) if (r.visible) dots.push({ x: r.state.x, z: r.state.z, color: r.info.color });
  hud.drawMinimap(dots);

  renderer.render(scene, camera);
}

requestAnimationFrame(frame);

// Handy for poking at the game from the dev console.
globalThis.__fs = { me, remotes, track, get room() { return room; } };
