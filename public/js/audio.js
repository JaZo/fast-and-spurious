// Every sound is synthesised with WebAudio, so there are no assets to load (or license).

const storage = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.musicVolume = Number(storage.get('fs.musicVolume', '0.6'));
    this.onReady = [];
  }

  // Must be called from a user gesture (browsers block autoplay).
  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    // Engine: two detuned oscillators through a resonant low-pass, plus a sub for the cannon exhaust.
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const sub = ctx.createGain();
    sub.gain.value = 0.5;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(sub).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfx);
    this.osc1.start();
    this.osc2.start();

    // Turbo whistle.
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain).connect(this.sfx);
    this.whistle.start();

    // Shared white-noise buffer for skids, thuds, purges and blow-off valves.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const skid = ctx.createBufferSource();
    skid.buffer = this.noise;
    skid.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 1.2;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skid.connect(band).connect(this.skidGain).connect(this.sfx);
    skid.start();

    this.car = { turbo: 1, exhaust: 1 };
    for (const fn of this.onReady) fn(ctx);
    this.onReady = [];
  }

  whenReady(fn) {
    if (this.ctx) fn(this.ctx);
    else this.onReady.push(fn);
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    storage.set('fs.musicVolume', String(v));
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  configureCar({ turbo, exhaust }) {
    this.car = { turbo, exhaust };
  }

  engine(rpm, throttle, nitro, active) {
    if (!this.ctx) return;
    const cannon = this.car.exhaust === 2;
    const f = (cannon ? 34 : 42) + rpm * (cannon ? 105 : 125) + (nitro ? 18 : 0);
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(380 + rpm * 1500 + throttle * 700, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? (0.06 + throttle * 0.06) * (cannon ? 1.5 : 1) : 0, t, 0.1);
    const spool = this.car.turbo > 0 && active ? throttle * Math.max(0, rpm - 0.3) : 0;
    this.whistle.frequency.setTargetAtTime(1600 + rpm * 2600, t, 0.08);
    this.whistleGain.gain.setTargetAtTime(spool * 0.012 * this.car.turbo, t, 0.12);
  }

  skid(amount) {
    if (!this.ctx) return;
    this.skidGain.gain.setTargetAtTime(Math.min(1, amount) * 0.14, this.ctx.currentTime, 0.05);
  }

  noiseBurst({ dur, freq, type = 'bandpass', q = 1, vol = 0.3, at = 0, attack = 0.005, sweepTo = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // The NFSU turbo "pssssh-tu-tu-tu".
  blowoff(strength = 1) {
    if (!this.car.turbo) return;
    const vol = 0.12 * strength * (0.6 + this.car.turbo * 0.25);
    this.noiseBurst({ dur: 0.35, freq: 3200, sweepTo: 1600, q: 0.8, vol });
    for (let k = 0; k < 3; k++) this.noiseBurst({ dur: 0.05, freq: 900, q: 3, vol: vol * 0.6, at: 0.2 + k * 0.06 });
  }

  nitroStart() {
    this.noiseBurst({ dur: 0.6, freq: 600, sweepTo: 3000, q: 0.7, vol: 0.18, attack: 0.08 });
  }

  purge() {
    this.noiseBurst({ dur: 1.3, freq: 5000, type: 'highpass', q: 0.5, vol: 0.22, attack: 0.03 });
  }

  click() {
    this.tone(2400, 0.03, { vol: 0.08 });
    this.tone(1800, 0.03, { vol: 0.08, at: 0.08 });
  }

  ring() {
    for (let k = 0; k < 4; k++) {
      for (let n = 0; n < 8; n++) this.tone(n % 2 ? 960 : 1180, 0.045, { vol: 0.07, at: k * 0.9 + n * 0.05, type: 'square' });
    }
  }

  fanfare() {
    [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.4]].forEach(([f, at], i) => this.tone(f, i === 3 ? 0.7 : 0.15, { vol: 0.12, at, type: 'sawtooth' }));
  }

  tone(freq, dur, { type = 'square', vol = 0.2, at = 0, slideTo = null, vibrato = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 9;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.setValueAtTime(vol, t + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  beep(high = false) {
    this.tone(high ? 880 : 440, high ? 0.6 : 0.2, { vol: 0.12 });
  }

  thud(intensity) {
    this.noiseBurst({ dur: 0.3, freq: 320, type: 'lowpass', vol: Math.min(0.9, intensity / 25) });
  }

  honk(kind, vol = 1) {
    if (vol <= 0.01) return;
    switch (kind) {
      case 'clown':
        this.tone(760, 0.17, { type: 'triangle', vol: 0.3 * vol, slideTo: 380 });
        this.tone(760, 0.17, { type: 'triangle', vol: 0.3 * vol, at: 0.22, slideTo: 380 });
        break;
      case 'cucaracha': // la cu-ca-ra-cha
        [[392, 0], [392, 0.12], [392, 0.24], [523, 0.36], [659, 0.6]].forEach(([f, at], i) => {
          this.tone(f, i === 4 ? 0.3 : 0.1, { vol: 0.14 * vol, at });
        });
        break;
      case 'goat':
        this.tone(430, 0.7, { type: 'sawtooth', vol: 0.16 * vol, slideTo: 360, vibrato: 45 });
        break;
      case 'duck':
        this.tone(560, 0.12, { type: 'sawtooth', vol: 0.18 * vol, slideTo: 280 });
        this.tone(560, 0.12, { type: 'sawtooth', vol: 0.18 * vol, at: 0.17, slideTo: 280 });
        break;
      default:
        this.tone(349, 0.38, { vol: 0.15 * vol });
        this.tone(440, 0.38, { vol: 0.12 * vol });
    }
  }
}
