import { DRIVER_NAMES, pick, ordinal, formatTime, finishQuip } from './fun.js';
import { SAMPLES } from './track.js';

const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ff2d95', '#af52de', '#ff9500', '#5ac8fa'];
const $ = (id) => document.getElementById(id);

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

export class Hud {
  constructor(track) {
    this.track = track;
    this.color = storage.get('fs.color') ?? pick(COLORS);
    this.lastText = {};
    this.prepareMinimap();
  }

  // ---------- menu ----------

  bindMenu(onPlay) {
    const name = $('name');
    const room = $('room');
    name.value = storage.get('fs.name') ?? pick(DRIVER_NAMES);
    room.value = new URLSearchParams(location.search).get('room') ?? '';
    $('dice').onclick = () => { name.value = pick(DRIVER_NAMES); };

    const swatches = $('swatches');
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c;
      b.dataset.color = c;
      b.onclick = () => {
        this.color = c;
        for (const s of swatches.children) s.classList.toggle('selected', s.dataset.color === c);
      };
      swatches.append(b);
    }
    swatches.querySelector(`[data-color="${this.color}"]`)?.classList.add('selected');

    const go = () => {
      storage.set('fs.name', name.value.trim());
      storage.set('fs.color', this.color);
      $('play').disabled = true;
      onPlay({ name: name.value.trim(), room: room.value.trim().toUpperCase(), color: this.color });
    };
    $('play').onclick = go;
    for (const input of [name, room]) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }
    name.focus();
  }

  menuError(msg) {
    $('menu').hidden = false;
    $('hud').hidden = true;
    $('play').disabled = false;
    const el = $('menu-error');
    el.textContent = msg;
    el.hidden = false;
  }

  showGame() {
    $('menu').hidden = true;
    $('hud').hidden = false;
  }

  showDisconnected() {
    $('disconnected').hidden = false;
  }

  // ---------- lobby ----------

  bindLobby(onReady) {
    $('ready').onclick = (e) => {
      onReady();
      e.currentTarget.blur(); // so Space doesn't re-click it while drifting
    };
    $('copy-link').onclick = async (e) => {
      const btn = e.currentTarget;
      const url = `${location.origin}/?room=${encodeURIComponent($('room-code').textContent)}`;
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Copied!';
      } catch {
        btn.textContent = url;
      }
      setTimeout(() => { btn.textContent = 'Copy invite link'; }, 2000);
      btn.blur();
    };
  }

  updateRoom(room, myId) {
    $('room-code').textContent = room.code;
    $('lobby').hidden = room.phase !== 'lobby';

    const list = $('player-list');
    list.replaceChildren(...room.players.map((p) => {
      const li = document.createElement('li');
      if (p.id === myId) li.className = 'me';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const status = document.createElement('span');
      status.className = `status${p.ready ? ' ready' : ''}`;
      status.textContent = p.ready ? '✔ READY' : 'revving…';
      li.append(dot, name, status);
      return li;
    }));

    const me = room.players.find((p) => p.id === myId);
    const btn = $('ready');
    btn.classList.toggle('is-ready', !!me?.ready);
    btn.textContent = me?.ready ? 'READY! (CANCEL)' : "I'M READY";
  }

  // ---------- race HUD ----------

  setText(id, text) {
    if (this.lastText[id] === text) return;
    this.lastText[id] = text;
    $(id).textContent = text;
  }

  setRace(info) {
    $('race-info').hidden = !info;
    if (!info) return;
    this.setText('pos', String(info.position));
    this.setText('pos-suffix', ordinal(info.position));
    this.setText('pos-total', `/${info.total}`);
    this.setText('lap', `${info.lap}/${info.laps}`);
    this.setText('timer', formatTime(info.timeMs));
  }

  setSpeed(kmh, nitro, nitroOn) {
    this.setText('speed', String(Math.round(kmh)));
    const fill = $('nitro-fill');
    fill.style.width = `${Math.round(nitro * 100)}%`;
    fill.classList.toggle('on', nitroOn);
  }

  setBanner(text) {
    const el = $('banner');
    el.hidden = !text;
    if (text) this.setText('banner', text);
  }

  setCountdown(text) {
    const el = $('countdown');
    if (!text) {
      el.hidden = true;
      this.lastText.countdown = null;
      return;
    }
    if (this.lastText.countdown === text) return;
    this.lastText.countdown = text;
    el.textContent = text;
    el.hidden = false;
    // restart the pop animation
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  bigMessage(text, ms = 2500) {
    const el = $('big-msg');
    el.textContent = text;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  toast(text, ms = 3000) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    box.append(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { el.style.opacity = '0'; }, ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  // ---------- results ----------

  showResults(players, myId) {
    const racers = players.filter((p) => p.inRace);
    const sorted = [...racers].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
    const me = racers.find((p) => p.id === myId);
    $('results-quip').textContent = me?.place
      ? finishQuip(me.place, racers.length)
      : me ? 'DNF. The brake pedal is the one on the left.' : 'You were spectating. Next race is yours.';

    $('results-list').replaceChildren(...sorted.map((p) => {
      const li = document.createElement('li');
      if (p.id === myId) li.className = 'me';
      const place = document.createElement('span');
      place.className = 'place';
      place.textContent = p.place ? `${p.place}${ordinal(p.place)}` : '—';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = p.finished ? formatTime(p.time) : 'DNF';
      li.append(place, dot, name, time);
      return li;
    }));
    $('results').hidden = false;
  }

  setResultsTimer(sec) {
    this.setText('results-timer', String(Math.max(0, Math.ceil(sec))));
  }

  hideResults() {
    $('results').hidden = true;
  }

  // ---------- minimap ----------

  prepareMinimap() {
    const canvas = $('minimap');
    const size = canvas.width;
    const { px, pz } = this.track;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
      minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
    }
    const pad = 22;
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    // Mirror x so the map matches what you see from behind the car (+x is to the left).
    this.mapXY = (x, z) => [size / 2 - (x - cx) * scale, size / 2 - (z - cz) * scale];

    const bg = document.createElement('canvas');
    bg.width = bg.height = size;
    const ctx = bg.getContext('2d');
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= SAMPLES; i += 4) {
      const [x, y] = this.mapXY(px[i % SAMPLES], pz[i % SAMPLES]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = '#3b3c42';
    ctx.lineWidth = 4;
    ctx.stroke();
    const [sx, sy] = this.mapXY(px[0], pz[0]);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 2, sy - 6, 4, 12);
    this.mapBg = bg;
    this.mapCtx = canvas.getContext('2d');
  }

  // dots: [{ x, z, color, me }]
  drawMinimap(dots) {
    const ctx = this.mapCtx;
    const size = ctx.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.mapBg, 0, 0);
    for (const d of dots) {
      const [x, y] = this.mapXY(d.x, d.z);
      ctx.beginPath();
      ctx.arc(x, y, d.me ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = d.me ? 2.5 : 1.5;
      ctx.strokeStyle = d.me ? '#fff' : '#000';
      ctx.stroke();
    }
  }
}
