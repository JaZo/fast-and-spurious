import {
  DRIVER_NAMES, pick, ordinal, formatTime, finishQuip,
} from './fun.js';
import { TRACKS, DIFFICULTY, trackSummary } from './tracks.js';

const $ = (id) => document.getElementById(id);

export const storage = {
  get(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class Hud {
  constructor() {
    this.track = null;
    this.lastText = {};
    this.tacho = $('tacho').getContext('2d');
    this.map = $('minimap').getContext('2d');
  }

  // ---------- menu ----------

  bindMenu({ onCreate, onJoin, onGarage, onMusicVolume, onQuality }) {
    const name = $('name');
    const room = $('room');
    name.value = storage.get('fs.name') ?? pick(DRIVER_NAMES);
    room.value = new URLSearchParams(location.search).get('room') ?? '';
    $('dice').onclick = () => { name.value = pick(DRIVER_NAMES); };

    const details = () => {
      storage.set('fs.name', name.value.trim());
      return { name: name.value.trim(), room: room.value.trim().toUpperCase() };
    };
    const syncJoin = () => { $('join').disabled = room.value.trim().length < 4; };
    room.addEventListener('input', syncJoin);
    syncJoin();

    $('create').onclick = () => onCreate(details());
    $('join').onclick = () => onJoin(details());
    $('menu-garage').onclick = () => onGarage();
    room.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('join').disabled) onJoin(details()); });
    name.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (room.value.trim().length >= 4) onJoin(details());
      else onCreate(details());
    });

    const vol = $('music-volume');
    vol.value = storage.get('fs.musicVolume', '0.6');
    vol.oninput = () => onMusicVolume(Number(vol.value));
    const quality = $('quality');
    quality.value = storage.get('fs.quality', 'high');
    quality.onchange = () => {
      storage.set('fs.quality', quality.value);
      onQuality(quality.value);
    };
    if (room.value) room.focus();
    else name.focus();
  }

  menuBusy(text) {
    for (const id of ['create', 'join', 'menu-garage']) $(id).disabled = !!text;
    if (!text) $('join').disabled = $('room').value.trim().length < 4;
    const status = $('menu-status');
    status.hidden = !text;
    status.textContent = text ?? '';
    $('menu-error').hidden = true;
  }

  menuError(msg) {
    this.menuBusy(null);
    $('menu').hidden = false;
    $('hud').hidden = true;
    const err = $('menu-error');
    err.textContent = msg;
    err.hidden = false;
  }

  showMenu(show) {
    $('menu').hidden = !show;
  }

  showGame() {
    $('menu').hidden = true;
    $('hud').hidden = false;
  }

  showDisconnected(text) {
    $('disconnected-text').textContent = text;
    $('disconnected').hidden = false;
  }

  // ---------- lobby ----------

  bindLobby({ onReady, onGarage, onPickTrack }) {
    $('ready').onclick = (e) => {
      onReady();
      e.currentTarget.blur(); // so Space doesn't re-click it while drifting
    };
    $('lobby-garage').onclick = (e) => {
      onGarage();
      e.currentTarget.blur();
    };
    const step = (d) => (e) => {
      const i = TRACKS.findIndex((t) => t.id === this.shownTrack);
      onPickTrack(TRACKS[(i + d + TRACKS.length) % TRACKS.length].id);
      e.currentTarget.blur();
    };
    $('track-prev').onclick = step(-1);
    $('track-next').onclick = step(1);
    // On small screens the lobby panel folds down to the essentials.
    $('lobby-toggle').onclick = (e) => {
      $('lobby').classList.toggle('collapsed');
      e.currentTarget.blur();
    };
    $('copy-link').onclick = async (e) => {
      const btn = e.currentTarget;
      const code = $('room-code').textContent;
      const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
      btn.blur();
      // Phones get the native share sheet; everyone else gets the clipboard.
      if (document.body.classList.contains('touch') && navigator.share) {
        navigator.share({ title: 'Fast & Spurious', text: `Race me in room ${code}!`, url }).catch(() => {});
        return;
      }
      const label = btn.textContent;
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Copied!';
      } catch {
        btn.textContent = url;
      }
      setTimeout(() => { btn.textContent = label; }, 2000);
    };
  }

  // The track card in the lobby: everyone sees it, only the host can flip through it.
  showTrack(def, isHost) {
    this.shownTrack = def.id;
    const diff = DIFFICULTY[def.difficulty];
    const { outline, length, climb } = trackSummary(def);
    $('track-name').textContent = def.name;
    const badge = $('track-diff');
    badge.textContent = `${diff.label} ${'●'.repeat(def.difficulty)}${'○'.repeat(4 - def.difficulty)}`;
    badge.style.color = diff.color;
    badge.style.borderColor = diff.color;
    $('track-meta').textContent = `${(length / 1000).toFixed(1)} km sprint${climb > 5 ? ` · ${Math.round(climb)} m climb` : ''}`;
    $('track-blurb').textContent = def.blurb;
    for (const id of ['track-prev', 'track-next']) $(id).hidden = !isHost;
    $('track-host-note').hidden = isHost;

    // Route preview, start in cyan and finish in pink.
    const ctx = $('track-preview').getContext('2d');
    const S = ctx.canvas.width;
    const H = ctx.canvas.height;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const [x, z] of outline) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const scale = Math.min((S - 16) / (maxX - minX || 1), (H - 16) / (maxZ - minZ || 1));
    const ox = (S - (maxX - minX) * scale) / 2;
    const oz = (H - (maxZ - minZ) * scale) / 2;
    // Mirror x so the map matches the view from above (+x is on the left when looking down +z).
    const pt = ([x, z]) => [S - ox - (x - minX) * scale, H - oz - (z - minZ) * scale];
    ctx.clearRect(0, 0, S, H);
    ctx.beginPath();
    outline.forEach((p, k) => (k ? ctx.lineTo(...pt(p)) : ctx.moveTo(...pt(p))));
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(56,242,255,0.3)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = diff.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    for (const [p, color] of [[outline[0], '#38f2ff'], [outline[outline.length - 1], '#ff2fd6']]) {
      const [x, y] = pt(p);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  updateRoom(room, myId, isHost) {
    $('room-code').textContent = room.code;
    $('host-badge').hidden = !isHost;
    $('lobby').hidden = room.phase !== 'lobby';
    document.body.classList.toggle('in-lobby', room.phase === 'lobby');

    $('player-list').replaceChildren(...room.players.map((p) => {
      const li = el('li', p.id === myId ? 'me' : '');
      const dot = el('span', 'dot');
      dot.style.background = p.look.color;
      const status = el('span', `status${p.ready ? ' ready' : ''}`, p.ready ? '✔ READY' : 'revving…');
      li.append(dot, el('span', 'name', p.name), status);
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
    $('progress').hidden = !info;
    if (!info) return;
    this.setText('pos', String(info.position));
    this.setText('pos-suffix', ordinal(info.position));
    this.setText('pos-total', `/${info.total}`);
    this.setText('timer', formatTime(info.timeMs));
    this.setText('to-go', info.toGo > 0 ? `${(info.toGo / 1000).toFixed(2)} km to go` : 'FINISHED');

    const bar = $('progress-markers');
    while (bar.children.length < info.markers.length) bar.append(el('div', 'marker'));
    while (bar.children.length > info.markers.length) bar.lastChild.remove();
    info.markers.forEach((m, k) => {
      const node = bar.children[k];
      node.style.left = `${(m.frac * 100).toFixed(2)}%`;
      node.style.background = m.color;
      node.classList.toggle('me', !!m.me);
    });
  }

  drawTacho({ rpm, gear, kmh, nitro, nitroOn }) {
    const ctx = this.tacho;
    const S = ctx.canvas.width;
    const c = S / 2;
    const R = S * 0.44;
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    ctx.clearRect(0, 0, S, S);

    ctx.beginPath();
    ctx.arc(c, c, R + 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,8,16,0.78)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(56,242,255,0.35)';
    ctx.stroke();

    // Redline.
    ctx.beginPath();
    ctx.arc(c, c, R - 6, a0 + sweep * 0.8, a0 + sweep);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ff2a3a';
    ctx.stroke();

    // Ticks and numbers (x1000 rpm).
    ctx.fillStyle = '#cfe9ff';
    ctx.font = `600 ${S * 0.07}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 18; k++) {
      const a = a0 + (k / 18) * sweep;
      const major = k % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * (R - (major ? 16 : 10)), c + Math.sin(a) * (R - (major ? 16 : 10)));
      ctx.lineTo(c + Math.cos(a) * (R - 2), c + Math.sin(a) * (R - 2));
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.strokeStyle = k >= 15 ? '#ff6b75' : '#cfe9ff';
      ctx.stroke();
      if (major) ctx.fillText(String(k / 2), c + Math.cos(a) * (R - 30), c + Math.sin(a) * (R - 30));
    }

    // Nitrous arc along the bottom.
    ctx.beginPath();
    ctx.arc(c, c, R + 2, Math.PI * 0.3, Math.PI * 0.7);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, R + 2, Math.PI * 0.7 - Math.PI * 0.4 * nitro, Math.PI * 0.7);
    ctx.strokeStyle = nitroOn ? '#ff2fd6' : '#38f2ff';
    ctx.stroke();

    // Needle.
    const a = a0 + Math.min(1.02, rpm) * sweep;
    ctx.beginPath();
    ctx.moveTo(c - Math.cos(a) * 14, c - Math.sin(a) * 14);
    ctx.lineTo(c + Math.cos(a) * (R - 8), c + Math.sin(a) * (R - 8));
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ff2fd6';
    ctx.shadowColor = '#ff2fd6';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Gear and speed.
    ctx.fillStyle = rpm > 0.8 && gear !== 'R' ? '#ff6b75' : '#ffffff';
    ctx.font = `italic ${S * 0.2}px "Russo One", Impact, sans-serif`;
    ctx.fillText(String(gear), c, c - S * 0.03);
    ctx.fillStyle = '#38f2ff';
    ctx.font = `italic ${S * 0.13}px "Russo One", Impact, sans-serif`;
    ctx.fillText(String(Math.round(kmh)), c, c + S * 0.2);
    ctx.fillStyle = 'rgba(207,233,255,0.6)';
    ctx.font = `600 ${S * 0.05}px Inter, sans-serif`;
    ctx.fillText('KM/H', c, c + S * 0.29);
  }

  setActions(actions) {
    const box = $('actions');
    if (box.children.length !== actions.length) {
      box.replaceChildren(...actions.map((a) => {
        // Tappable too: that's how touch players (and mouse fans) fire them.
        const slot = el('button', 'action');
        slot.type = 'button';
        slot.title = `${a.name} (${a.key})`;
        slot.append(el('span', 'icon', a.icon), el('kbd', '', a.key), el('div', 'fill'));
        slot.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.onAction?.(a.kind);
        });
        return slot;
      }));
    }
    actions.forEach((a, k) => {
      const slot = box.children[k];
      slot.classList.toggle('ready', a.ready >= 1);
      slot.lastChild.style.transform = `scaleY(${1 - a.ready})`;
    });
  }

  setEffects(fog, glare) {
    const f = $('fog-fx');
    const g = $('glare-fx');
    f.style.opacity = fog.toFixed(3);
    g.style.opacity = Math.min(1, glare * 1.2).toFixed(3);
  }

  phone(caller, text, from, ms) {
    const box = $('phone');
    $('phone-caller').textContent = caller;
    $('phone-text').textContent = text;
    $('phone-from').textContent = `(courtesy of ${from})`;
    box.hidden = false;
    box.style.animation = 'none';
    void box.offsetWidth;
    box.style.animation = '';
    clearTimeout(this.phoneTimer);
    this.phoneTimer = setTimeout(() => { box.hidden = true; }, ms);
  }

  nowPlaying(song) {
    const box = $('now-playing');
    $('np-title').textContent = song.title;
    $('np-artist').textContent = song.artist;
    $('np-album').textContent = song.album;
    box.hidden = false;
    box.classList.remove('out');
    clearTimeout(this.npTimer);
    this.npTimer = setTimeout(() => box.classList.add('out'), 6000);
  }

  setBanner(text) {
    const node = $('banner');
    node.hidden = !text;
    if (text) this.setText('banner', text);
  }

  setCountdown(text) {
    const node = $('countdown');
    if (!text) {
      node.hidden = true;
      this.lastText.countdown = null;
      return;
    }
    if (this.lastText.countdown === text) return;
    this.lastText.countdown = text;
    node.textContent = text;
    node.hidden = false;
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  }

  bigMessage(text, ms = 2500) {
    const node = $('big-msg');
    node.textContent = text;
    node.hidden = false;
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
    clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => { node.hidden = true; }, ms);
  }

  toast(text, ms = 3000) {
    const box = $('toasts');
    const node = el('div', 'toast', text);
    box.append(node);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { node.style.opacity = '0'; }, ms);
    setTimeout(() => node.remove(), ms + 400);
  }

  // ---------- results ----------

  showResults(players, myId) {
    const racers = players.filter((p) => p.inRace);
    const sorted = [...racers].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
    const me = racers.find((p) => p.id === myId);
    let quip = 'You were spectating. Next race is yours.';
    if (me?.place) quip = finishQuip(me.place, racers.length);
    else if (me) quip = 'DNF. The gas pedal is the one on the right.';
    $('results-quip').textContent = quip;

    $('results-list').replaceChildren(...sorted.map((p) => {
      const li = el('li', p.id === myId ? 'me' : '');
      const dot = el('span', 'dot');
      dot.style.background = p.look.color;
      li.append(
        el('span', 'place', p.place ? `${p.place}${ordinal(p.place)}` : '—'),
        dot,
        el('span', 'name', p.name),
        el('span', 'time', p.finished ? formatTime(p.time) : 'DNF'),
      );
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

  // ---------- minimap: rotates with the car, like the real thing ----------

  drawMinimap(me, dots) {
    const ctx = this.map;
    const S = ctx.canvas.width;
    const c = S / 2;
    const scale = 0.3;
    const { px, pz } = this.track;
    const fx = Math.sin(me.h);
    const fz = Math.cos(me.h);
    const rx = -fz; // screen right is the car's right, which is world (-cos h, sin h)
    const rz = fx;
    const toScreen = (x, z) => {
      const dx = x - me.x;
      const dz = z - me.z;
      return [c + (dx * rx + dz * rz) * scale, c - (dx * fx + dz * fz) * scale];
    };

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(6,8,16,0.75)';
    ctx.fill();

    ctx.beginPath();
    let started = false;
    for (let i = 0; i < this.track.samples; i += 3) {
      const [x, y] = toScreen(px[i], pz[i]);
      if (!started) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(56,242,255,0.35)';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = '#d7f9ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    for (const [i, color] of [[this.track.startIdx, '#38f2ff'], [this.track.finishIdx, '#ff2fd6']]) {
      const [x, y] = toScreen(px[i], pz[i]);
      ctx.fillStyle = color;
      ctx.fillRect(x - 5, y - 5, 10, 10);
    }

    for (const d of dots) {
      const [x, y] = toScreen(d.x, d.z);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }

    // You: an arrow pointing up.
    ctx.beginPath();
    ctx.moveTo(c, c - 9);
    ctx.lineTo(c + 6, c + 7);
    ctx.lineTo(c, c + 3);
    ctx.lineTo(c - 6, c + 7);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#38f2ff';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }
}
