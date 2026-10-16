// Every sound is synthesised with WebAudio, so there are no assets to load (or license).

const GEARS = [0, 12, 22, 33, 45, 58, 100]; // m/s at which each gear tops out

export class AudioFX {
  constructor() {
    this.ctx = null;
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
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // Engine: two detuned oscillators through a resonant low-pass.
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
    this.engFilter.connect(this.engGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // Shared white-noise buffer for skids and thuds.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
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
    skid.connect(band).connect(this.skidGain).connect(this.master);
    skid.start();
  }

  engine(speed, throttle, nitro, active) {
    if (!this.ctx) return;
    let g = 1;
    while (g < GEARS.length - 1 && speed > GEARS[g]) g++;
    const r = Math.min(1, Math.max(0, (speed - GEARS[g - 1]) / (GEARS[g] - GEARS[g - 1])));
    const rpm = g === 1 ? 0.15 + r * 0.85 : 0.35 + r * 0.65;
    const f = 42 + rpm * 120 + (nitro ? 18 : 0);
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(400 + rpm * 1400 + throttle * 700, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? 0.07 + throttle * 0.06 : 0, t, 0.1);
  }

  skid(amount) {
    if (!this.ctx) return;
    this.skidGain.gain.setTargetAtTime(Math.min(1, amount) * 0.16, this.ctx.currentTime, 0.05);
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
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    gain.gain.setValueAtTime(vol, t + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  beep(high = false) {
    this.tone(high ? 880 : 440, high ? 0.6 : 0.2, { vol: 0.12 });
  }

  thud(intensity) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(Math.min(1, intensity / 25), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(lp).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.32);
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
