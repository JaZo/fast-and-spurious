import * as THREE from 'three';
import { CHECKPOINTS, TICK_RATE } from './config.js';
import { World } from './world.js';
import { trackById, DEFAULT_TRACK } from './tracks.js';
import { Sky, nightEnvironment } from './scenery/common.js';
import {
  CarPhysics, CarModel, CAR_RADIUS, FLAG_DRIFT,
} from './car.js';
import { RemoteCar } from './remote.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { Network } from './net.js';
import { Hud, storage } from './hud.js';
import { AudioFX } from './audio.js';
import { Music } from './music.js';
import { Particles } from './particles.js';
import { Post } from './post.js';
import { Garage } from './garage.js';
import { Spurious } from './spurious.js';
import { loadBuild, computeTuning } from './tuning.js';
import * as fun from './fun.js';

// ---------- scene ----------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 40, 750);
const env = nightEnvironment(renderer);
scene.environment = env;
scene.environmentIntensity = 0.4;

const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 4000);

scene.add(new THREE.HemisphereLight(0x5866a8, 0x140c1c, 0.35));
const moon = new THREE.DirectionalLight(0x9fb0ff, 0.6);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 });
moon.shadow.bias = -0.0005;
scene.add(moon, moon.target);

// Only the local car gets a real headlight; everyone else gets a fake beam on the road.
const headlight = new THREE.SpotLight(0xfff2dd, 140, 110, 0.55, 0.55, 1.4);
headlight.position.set(0, 0.7, 2.6); // ahead of the bumper, so it never lights our own car
headlight.target.position.set(0, 0, 20);

const sky = new Sky(scene);
const particles = new Particles(scene);
const hud = new Hud();
const input = new Input();
new TouchControls(input, { onFullscreen: toggleFullscreen });
const audio = new AudioFX();
const music = new Music(audio);
const post = new Post(renderer);
const spurious = new Spurious({ hud, audio, music, particles });
music.onTrack = (song) => hud.nowPlaying(song);

function applyQuality(q) {
  const high = q !== 'low';
  post.enabled = high;
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 2) : 1);
  if (renderer.shadowMap.enabled !== high) {
    renderer.shadowMap.enabled = high;
    scene.traverse((o) => { for (const m of [].concat(o.material ?? [])) m.needsUpdate = true; });
  }
  resize();
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  post.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  particles.setViewportHeight(innerHeight * renderer.getPixelRatio());
}
addEventListener('resize', resize);
applyQuality(storage.get('fs.quality', 'high'));

// Browsers only allow audio after a user gesture; start the menu music on the first one.
const unlockAudio = () => {
  audio.init();
  if (!music.song) music.playMenu();
};
addEventListener('pointerdown', unlockAudio, { once: true });
addEventListener('keydown', unlockAudio, { once: true });
document.addEventListener('visibilitychange', () => audio.setPaused(document.hidden));

// ---------- game state ----------

const me = {
  id: 0,
  build: loadBuild(),
  physics: null,
  model: null,
  horn: 'classic',
  nextCp: 0,
  finished: false,
  finishTime: null,
};
me.physics = new CarPhysics(computeTuning(me.build));
audio.configureCar({ turbo: me.build.perf.turbo, exhaust: me.build.look.exhaust });

const remotes = new Map();
let room = { code: '', phase: 'none', players: [] };
let playersById = new Map();
let net = null;
let goTime = 0; // performance.now() timestamp of the green light
let phaseEndsLocal = 0;
let camMode = 0;
let camHeading = 0;
let snapCamera = true;
let lastWallQuip = 0;
let lastBumpQuip = 0;
let lastReset = 0;
let lastCountdownSecond = null;
let wrongWayTime = 0;
let prevThrottle = 0;
let prevNitro = false;
let disconnected = false;
let world = null;
let track = null;
let flyT = 0; // menu fly-through position along the road

// Builds a track and its scenery (tearing down the previous one) and sets the mood for it.
function loadTrack(id) {
  const def = trackById(id);
  if (world?.def.id === def.id) return;
  world?.dispose();
  world = new World(scene, def);
  track = world.track;
  hud.track = track;
  sky.setColors(def.sky);
  scene.background.set(def.sky.horizon);
  scene.fog.color.set(def.sky.horizon);
  [scene.fog.near, scene.fog.far] = def.fog;
  scene.environmentIntensity = def.envIntensity ?? 0.4;
  flyT = 0;
  for (const r of remotes.values()) r.reset();
  if (me.model) {
    const mine = myInfo();
    me.physics.place(track.gridPose((mine?.slot ?? 0) % 8));
    snapCamera = true;
  }
}
loadTrack(storage.get('fs.track', DEFAULT_TRACK));

const myInfo = () => playersById.get(me.id);
const isRacePhase = () => room.phase === 'countdown' || room.phase === 'racing';
const amRacing = () => isRacePhase() && !!myInfo()?.inRace;
// Players who aren't (or are no longer) competing drive as ghosts so they can't wreck the race.
const isGhost = (info, finished) => isRacePhase() && (!info?.inRace || finished);

const garage = new Garage(env, {
  onClose: (build) => {
    input.enabled = true;
    applyBuild(build);
    if (me.model) hud.showGame();
    else hud.showMenu(true);
  },
});

function openGarage() {
  if (isRacePhase()) return;
  input.enabled = false;
  hud.showMenu(false);
  document.getElementById('hud').hidden = true;
  garage.open(me.build);
}

function applyBuild(build) {
  me.build = build;
  me.physics.tune(computeTuning(build));
  audio.configureCar({ turbo: build.perf.turbo, exhaust: build.look.exhaust });
  if (me.model) {
    const opacity = me.model.opacity;
    me.model.dispose();
    spawnModel();
    me.model.setOpacity(opacity);
  }
  net?.send({ t: 'look', look: build.look });
}

function spawnModel() {
  me.model = new CarModel(me.build.look);
  me.model.root.add(headlight, headlight.target);
  scene.add(me.model.root);
}

// ---------- networking ----------

hud.bindMenu({
  onCreate: (details) => enterRoom('create', details),
  onJoin: (details) => enterRoom('join', details),
  onGarage: () => {
    unlockAudio();
    openGarage();
  },
  onMusicVolume: (v) => audio.setMusicVolume(v),
  onQuality: applyQuality,
});
hud.onAction = (kind) => input.tap(kind);

// Fullscreen + landscape lock where the browser allows it (Android; iPhones ignore both).
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

hud.bindLobby({
  onReady: toggleReady,
  onGarage: openGarage,
  onPickTrack: (id) => {
    storage.set('fs.track', id);
    net?.send({ t: 'track', id });
  },
});

async function enterRoom(mode, details) {
  if (net) return; // already connecting or connected
  document.activeElement?.blur(); // so Enter (= ready) doesn't click the menu button again
  unlockAudio();
  hud.menuBusy(mode === 'create' ? 'Opening a room in the underground…' : `Looking for room ${details.room}…`);
  net = new Network({
    welcome: onWelcome,
    room: onRoom,
    snap: onSnap,
    honk: onHonk,
    act: (msg) => spurious.receive(msg, actionContext),
    event: onEvent,
    error: (msg) => hud.menuError(msg.msg),
    close: () => lostConnection('The host left, and took the room with them.'),
  });
  const joinMsg = { t: 'join', name: details.name, look: me.build.look };
  try {
    if (mode === 'create') await net.host(joinMsg, storage.get('fs.track', world.def.id));
    else await net.join(details.room, joinMsg);
  } catch (err) {
    net.peer?.destroy();
    net = null;
    hud.menuError(err.message);
    return;
  }
  music.playRace();
}

// Tell the others right away when the tab closes, instead of letting them time out.
addEventListener('pagehide', () => net?.peer?.destroy());

function lostConnection(text) {
  if (disconnected || !me.id) return;
  disconnected = true;
  hud.showDisconnected(text);
}

function toggleReady() {
  if (room.phase !== 'lobby') return;
  net?.send({ t: 'ready', ready: !myInfo()?.ready });
}

function onWelcome(msg) {
  me.id = msg.id;
  me.horn = msg.horn;
  spawnModel();
  me.physics.place(track.gridPose(msg.slot % 8));
  snapCamera = true;
  history.replaceState(null, '', `${location.pathname}?room=${encodeURIComponent(msg.room)}`);
  hud.menuBusy(null);
  hud.showGame();
  hud.toast(`Welcome to the underground, ${msg.name}! Room code: ${msg.room}`, 5000);
  if (net.isHost) hud.toast('You are hosting. Keep this tab open, or the room closes.', 6000);
}

function onRoom(msg) {
  const prevPhase = room.phase;
  room = msg;
  if (msg.track !== world.def.id) {
    net?.send({ t: 'ping' }); // building a track can take a moment; let the host know we're still here
    loadTrack(msg.track);
  }
  playersById = new Map(msg.players.map((p) => [p.id, p]));
  phaseEndsLocal = performance.now() + msg.phaseMs;

  for (const p of msg.players) {
    if (p.id === me.id) continue;
    const r = remotes.get(p.id);
    if (r) r.setInfo(p);
    else remotes.set(p.id, new RemoteCar(p, scene));
  }
  for (const [id, r] of remotes) {
    if (!playersById.has(id)) {
      r.dispose();
      remotes.delete(id);
    }
  }

  const mine = myInfo();
  if (msg.phase === 'countdown' && prevPhase !== 'countdown' && mine?.inRace) {
    garage.close();
    me.physics.place(track.gridPose(msg.grid?.[me.id] ?? 0));
    me.physics.nitro = 1;
    Object.assign(me, { nextCp: 0, finished: false, finishTime: null });
    goTime = phaseEndsLocal;
    lastCountdownSecond = null;
    snapCamera = true;
    hud.hideResults();
  }
  if (msg.phase === 'results' && prevPhase !== 'results') hud.showResults(msg.players, me.id);
  if (msg.phase === 'lobby' && prevPhase !== 'lobby' && prevPhase !== 'none') {
    // Back to the start line for free roam.
    hud.hideResults();
    me.physics.place(track.gridPose((mine?.slot ?? 0) % 8));
    snapCamera = true;
  }
  hud.updateRoom(room, me.id, net?.isHost);
  hud.showTrack(world.def, !!net?.isHost);
}

function onSnap(msg) {
  const now = performance.now();
  for (const [id, x, z, h, v, s, f, i] of msg.p) {
    if (id !== me.id) remotes.get(id)?.push(now, x, z, h, v, s, f, i);
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
  else if (msg.kind === 'track') hud.bigMessage(msg.name.toUpperCase(), 2000);
  else if (msg.kind === 'finish') {
    hud.toast(`🏁 ${msg.name} finished ${msg.place}${fun.ordinal(msg.place)} (${fun.formatTime(msg.time)})`, 5000);
    if (msg.id === me.id) {
      me.finished = true;
      me.finishTime = msg.time;
      const total = room.players.filter((p) => p.inRace).length;
      hud.bigMessage(fun.finishQuip(msg.place, total), 4000);
      audio.fanfare();
    }
  }
}

// ---------- gameplay helpers ----------

function respawn() {
  const now = performance.now();
  if (me.physics.frozen || now - lastReset < 1500) return;
  lastReset = now;
  const i = Math.max(2, Math.min(track.samples - 3, me.physics.trackIdx));
  me.physics.place({ x: track.px[i], z: track.pz[i], h: track.headingAt(i), i });
  snapCamera = true;
  hud.toast(fun.pick(fun.RESET_QUIPS));
}

// Finished drivers by place, then everyone else by how far along the street they are.
function standings() {
  const entries = [];
  for (const p of room.players) {
    if (!p.inRace) continue;
    const idx = p.id === me.id ? me.physics.trackIdx : (remotes.get(p.id)?.trackIdx ?? 0);
    entries.push({ id: p.id, place: p.place, idx, color: p.look.color });
  }
  entries.sort((a, b) => {
    if (a.place || b.place) return (a.place ?? 99) - (b.place ?? 99);
    return b.idx - a.idx;
  });
  return entries;
}

const actionContext = {
  me,
  remotes,
  nameOf: (id) => playersById.get(id)?.name ?? 'someone',
  // The driver directly ahead of you (or behind, if you're leading). Outside a race: whoever is closest.
  callTarget: () => {
    if (amRacing()) {
      const order = standings().filter((e) => !e.place);
      const k = order.findIndex((e) => e.id === me.id);
      if (k < 0) return null;
      return order[k - 1]?.id ?? order[k + 1]?.id ?? null;
    }
    let best = null;
    let bestD = Infinity;
    for (const [id, r] of remotes) {
      const d = Math.hypot(r.state.x - me.physics.x, r.state.z - me.physics.z);
      if (r.visible && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  },
};

function checkCheckpoints() {
  if (room.phase !== 'racing' || !amRacing() || me.finished || me.physics.frozen) return;
  while (me.nextCp < CHECKPOINTS && me.physics.trackIdx >= track.cpIndex(me.nextCp)) {
    net.send({ t: 'cp', i: me.nextCp });
    me.nextCp++;
  }
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

const smokePos = [new THREE.Vector3(), new THREE.Vector3()];
function smokeFrom(model, speed, flags, dt) {
  if ((flags & FLAG_DRIFT) === 0 || Math.abs(speed) < 8 || Math.random() > dt * 40) return;
  model.localToWorld([[-0.85, 0.3, -1.38], [0.85, 0.3, -1.38]], smokePos);
  for (const p of smokePos) particles.spawn(p);
}

// ---------- camera ----------

const camLook = new THREE.Vector3();

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
    const back = 6.2 + speed * 0.025;
    camera.position.set(p.x - Math.sin(camHeading) * back, p.y + 2.0 + speed * 0.006, p.z - Math.cos(camHeading) * back);
    camLook.set(p.x + fx * 5, p.y + 1.0, p.z + fz * 5);
  } else {
    camera.position.set(p.x + fx * 0.3, p.y + 1.3, p.z + fz * 0.3);
    camLook.set(p.x + fx * 10, p.y + 1.1, p.z + fz * 10);
  }
  if (p.nitroOn) {
    camera.position.x += (Math.random() - 0.5) * 0.05;
    camera.position.y += (Math.random() - 0.5) * 0.05;
  }
  camera.lookAt(camLook);

  const fov = 64 + Math.min(speed, 85) * 0.24 + (p.nitroOn ? 10 : 0);
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  followLights(p.x, p.y, p.z);
}

function followLights(x, y, z) {
  moon.position.set(x - 40, y + 120, z + 60);
  moon.target.position.set(x, y, z);
  sky.group.position.copy(camera.position);
}

// Menu backdrop: a slow fly-through down the street.
function attractCamera(dt) {
  flyT += dt * 14;
  const i = Math.floor(flyT / track.segLen) % (track.samples - 60);
  const j = i + 30;
  camera.position.set(track.px[i] + track.nx[i] * -2, track.py[i] + 4.5, track.pz[i] + track.nz[i] * -2);
  camera.lookAt(track.px[j], track.py[j] + 2, track.pz[j]);
  camera.fov = 62;
  camera.updateProjectionMatrix();
  followLights(camera.position.x, camera.position.y, camera.position.z);
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

  const inp = input.read();
  if (inp.mute) hud.toast(music.toggleMute() ? '🔇 Music off' : '🔊 Music on', 1200);
  if (inp.nextTrack) music.next();

  if (net?.hostSilent(now)) lostConnection('Lost the connection to the host.');

  if (garage.active) {
    if (me.model) simulate(now, dt, Input.neutral(), false);
    garage.update(dt, innerWidth / innerHeight);
    post.render(garage.scene, garage.camera);
    return;
  }

  if (!me.model) {
    attractCamera(dt);
    post.render(scene, camera);
    return;
  }

  simulate(now, dt, inp, true);
  updateCamera(dt);
  post.render(scene, camera);
}

function simulate(now, dt, inp, interactive) {
  const p = me.physics;
  const mine = myInfo();
  const racing = amRacing();

  if (interactive) {
    if (inp.horn) {
      net.send({ t: 'honk' });
      audio.honk(me.horn, 1);
      me.model.honk();
    }
    if (inp.reset) respawn();
    if (inp.camera) camMode = (camMode + 1) % 2;
    if (inp.ready) toggleReady();
    for (const kind of ['purge', 'brights', 'call']) {
      if (!inp[kind] || p.frozen) continue;
      const msg = spurious.trigger(kind, actionContext);
      if (msg) net.send(msg);
    }
  }

  // Countdown.
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
    hud.setCountdown('GO GO GO!');
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

  // Turbo and nitrous noises.
  if (prevThrottle > 0 && inp.throttle === 0 && p.rpm > 0.6) audio.blowoff(1);
  if (p.shifted) {
    if (inp.throttle > 0) audio.blowoff(0.45);
    p.shifted = false;
  }
  if (p.nitroOn && !prevNitro) audio.nitroStart();
  prevThrottle = inp.throttle;
  prevNitro = p.nitroOn;

  for (const r of remotes.values()) r.update(now, dt, track);
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
  me.model.update({
    x: p.x, y: p.y, z: p.z, h: p.h, pitch: p.pitch, speed: p.forwardSpeed, steer: p.steer, flags,
  }, dt);
  me.model.setOpacity(isGhost(mine, me.finished) ? 0.45 : 1);
  smokeFrom(me.model, p.forwardSpeed, flags, dt);
  for (const r of remotes.values()) {
    if (!r.visible) continue;
    r.model.setOpacity(isGhost(r.info, r.info.finished) ? 0.35 : 1);
    smokeFrom(r.model, r.state.speed, r.state.flags, dt);
  }
  spurious.update(dt, actionContext);
  particles.update(dt);

  audio.engine(p.rpm, inp.throttle, p.nitroOn, true);
  audio.skid(p.drifting ? Math.min(1, p.speed / 30) : 0);

  if (!interactive) return;

  // Wrong-way detection.
  const ti = Math.max(0, p.trackIdx);
  const along = p.vx * track.tx[ti] + p.vz * track.tz[ti];
  wrongWayTime = along < -5 ? wrongWayTime + dt : 0;

  // HUD.
  hud.drawTacho({
    rpm: p.rpm, gear: p.gear, kmh: p.speed * 3.6, nitro: p.nitro, nitroOn: p.nitroOn,
  });
  if (racing) {
    const order = standings();
    const position = Math.max(1, order.findIndex((e) => e.id === me.id) + 1);
    const timeMs = me.finished ? me.finishTime : Math.max(0, now - goTime);
    hud.setRace({
      position,
      total: order.length,
      timeMs,
      toGo: me.finished ? 0 : Math.max(0, (track.finishIdx - p.trackIdx) * track.segLen),
      markers: order.map((e) => ({ frac: track.progress(e.idx), color: e.color, me: e.id === me.id })),
    });
  } else {
    hud.setRace(null);
  }

  const left = Math.ceil((phaseEndsLocal - now) / 1000);
  let banner = '';
  if (wrongWayTime > 1) banner = '⚠ WRONG WAY, COLUMBUS ⚠';
  else if (room.phase === 'lobby') banner = 'Free roam! Tune your ride in the GARAGE, then hit READY.';
  else if (isRacePhase() && !mine?.inRace) banner = "👻 Race in progress — you're a ghost until the next one.";
  else if (room.phase === 'racing' && me.finished) banner = 'Finished! Waiting for the slowpokes…';
  else if (room.phase === 'racing' && room.phaseMs > 0 && left > 0) banner = `Hurry! ${left}s until the cops show up.`;
  hud.setBanner(banner);
  if (room.phase === 'results') hud.setResultsTimer(left);

  const dots = [];
  for (const r of remotes.values()) if (r.visible) dots.push({ x: r.state.x, z: r.state.z, color: r.info.look.color });
  hud.drawMinimap({ x: p.x, z: p.z, h: p.h }, dots);
}

requestAnimationFrame(frame);

// Handy for poking at the game from the dev console.
globalThis.__fs = {
  me, remotes, get track() { return track; }, get world() { return world; }, get room() { return room; }, get net() { return net; }, music,
};
