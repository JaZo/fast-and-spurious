// "EA TRAX", but procedurally generated (the real NFSU soundtrack is licensed, so we wrote our own).
// A tiny step sequencer: 16 steps per bar, synthesised drums, 808s, drop-D guitars, acid bass and leads.

import { workerInterval } from './timer.js';

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Drum strings: '.' rest, 'x' hit, 'X' accent, 'g' ghost, 'o' open hat.
// Note strings: space-separated tokens, '.' rest, '-' hold previous, numbers are semitones above
// the key + current bar root, with an optional 'm' suffix for palm-muted guitar.
export const SONGS = [
  {
    id: 'get-slow',
    title: 'Get Slow (To The Windooow)',
    artist: 'Lil Jog & The East Side Boyz',
    album: 'Crunk Juice Box',
    bpm: 101,
    swing: 0.1,
    key: 50,
    roots: [0, 0, 0, -2],
    voices: {
      kick: { inst: 'kick', boom: true }, clap: { inst: 'clap' }, hat: { inst: 'hat' }, crash: { inst: 'crash' },
      bass: { inst: 'bass808', oct: -2 }, stab: { inst: 'stab', chord: [0, 3, 7] }, lead: { inst: 'lead', oct: 1 },
    },
    parts: {
      kick: { A: 'x.....x...x.....', B: 'x.....x.x.x...x.' },
      clap: { A: '....x.......x...', B: '....x.......x.xx' },
      hat: { A: 'x.x.x.x.x.x.x.x.', B: 'x.xxx.x.x.xxx.xx' },
      bass: { A: '0 - - - - - 0 - - - 0 - - - - -' },
      stab: { A: '0 . . 0 . . 0 . . . 0 . 0 . . .' },
      lead: { A: '7 . 7 . 10 . 7 . 5 . 3 . 5 - . .', B: '12 . 12 . 10 . 12 . 15 - 12 . 10 . 7 .' },
    },
    sections: [
      { bars: 4, play: { stab: 'A', hat: 'A' } },
      { bars: 8, crash: true, play: { kick: 'A', clap: 'A', hat: 'A', bass: 'A', stab: 'A' } },
      { bars: 8, crash: true, play: { kick: 'B', clap: 'A', hat: 'B', bass: 'A', stab: 'A', lead: 'A' } },
      { bars: 8, crash: true, play: { kick: 'A', clap: 'B', hat: 'A', bass: 'A', lead: 'B' } },
      { bars: 8, crash: true, play: { kick: 'B', clap: 'A', hat: 'B', bass: 'A', stab: 'A', lead: 'B' } },
      { bars: 4, play: { stab: 'A', kick: 'A' } },
    ],
  },
  {
    id: 'only-lane',
    title: 'The Only Lane',
    artist: 'Static-X-haust',
    album: 'Wisconsin Death Drift',
    bpm: 140,
    swing: 0,
    key: 38, // drop D, obviously
    roots: [0, 0, 3, 1],
    voices: {
      kick: { inst: 'kick' }, snare: { inst: 'snare' }, hat: { inst: 'hat' }, crash: { inst: 'crash' },
      guitar: { inst: 'guitar' }, bass: { inst: 'bass', cutoff: 500 }, lead: { inst: 'lead' },
    },
    parts: {
      kick: { A: 'x.x...x.x.x...x.', B: 'x.......x.x.....' },
      snare: { A: '....x.......x...', B: '........x.......' },
      hat: { A: 'x.x.x.x.x.x.x.x.', B: 'x...x...x...x...' },
      guitar: {
        A: '0m . 0m 0m . 0m 0m . 3 - - . 0m 0m 1 -',
        B: '0 - - - - - - - 5 - - - 3 - - -',
        C: '0m . . . . . . . 0m . 0m . . . 6 -',
      },
      bass: {
        A: '0 . 0 0 . 0 0 . 3 - - . 0 0 1 -',
        B: '0 - - - - - - - 5 - - - 3 - - -',
        C: '0 - - - - - - - 0 . 0 . . . 6 -',
      },
      lead: { A: '24 - - - 22 - - - 27 - - - 24 - 22 -' },
    },
    sections: [
      { bars: 4, play: { guitar: 'A', hat: 'B' } },
      { bars: 8, crash: true, play: { kick: 'A', snare: 'A', hat: 'A', guitar: 'A', bass: 'A' } },
      { bars: 8, crash: true, play: { kick: 'A', snare: 'A', hat: 'A', guitar: 'B', bass: 'B', lead: 'A' } },
      { bars: 8, crash: true, play: { kick: 'A', snare: 'A', hat: 'A', guitar: 'A', bass: 'A' } },
      { bars: 4, crash: true, play: { kick: 'B', snare: 'B', hat: 'B', guitar: 'C', bass: 'C' } },
      { bars: 8, crash: true, play: { kick: 'A', snare: 'A', hat: 'A', guitar: 'B', bass: 'B', lead: 'A' } },
      { bars: 2, crash: true, play: { kick: 'B', guitar: 'B' } },
    ],
  },
  {
    id: 'born-too-spurious',
    title: 'Born Too Spurious',
    artist: 'The Crystal Methods of Transport',
    album: 'Vegas Parking Lot',
    bpm: 128,
    swing: 0.05,
    key: 45,
    roots: [0, 0, -2, -4],
    voices: {
      kick: { inst: 'kick' }, snare: { inst: 'snare' }, hat: { inst: 'hat' }, crash: { inst: 'crash' },
      acid: { inst: 'bass', acid: true }, arp: { inst: 'arp', oct: 2 }, pad: { inst: 'pad', oct: 1, chord: [0, 3, 7, 10] },
    },
    parts: {
      kick: { A: 'x...x...x...x...', B: 'x.x.......xx....' },
      snare: { A: '....x.......x...', B: '....x..g.g..x..g', R: 'x.x.x.x.xxxxXXXX' },
      hat: { A: '..x...x...x...x.', B: 'x.xxx.xxx.xxx.xo' },
      acid: { A: '0 0 12 0 0 10 0 0 12 0 3 0 0 7 0 5' },
      arp: { A: '0 3 7 12 0 3 7 12 0 3 7 12 0 3 7 12' },
      pad: { A: '0 - - - - - - - - - - - - - - -' },
    },
    sections: [
      { bars: 4, play: { acid: 'A' } },
      { bars: 3, play: { acid: 'A', hat: 'A', kick: 'A' } },
      { bars: 1, play: { acid: 'A', snare: 'R', kick: 'A' } },
      { bars: 8, crash: true, play: { kick: 'B', snare: 'B', hat: 'B', acid: 'A' } },
      { bars: 4, play: { pad: 'A', arp: 'A', hat: 'A' } },
      { bars: 8, crash: true, play: { kick: 'B', snare: 'B', hat: 'B', acid: 'A', arp: 'A' } },
      { bars: 4, play: { pad: 'A', acid: 'A', kick: 'A' } },
    ],
  },
  {
    id: 'garage-days',
    title: 'Garage Days (Tint My Windows)',
    artist: 'Mudvayne Rover',
    album: 'Lowered Expectations',
    bpm: 86,
    swing: 0.2,
    key: 53,
    roots: [0, -4, -2, -7],
    menu: true,
    voices: {
      kick: { inst: 'kick' }, snare: { inst: 'snare', soft: true }, hat: { inst: 'hat' },
      pad: { inst: 'pad', chord: [0, 3, 7, 10] }, bass: { inst: 'bass808', oct: -2 }, lead: { inst: 'arp', oct: 1 },
    },
    parts: {
      kick: { A: 'x......x..x.....' },
      snare: { A: '....x.......x...' },
      hat: { A: 'x.g.x.g.x.g.x.gx' },
      pad: { A: '0 - - - - - - - - - - - - - - -' },
      bass: { A: '0 - - - - - - 0 - - 0 - - - - -' },
      lead: { A: '. . 7 . . 10 . . 12 . . 10 . 7 . .' },
    },
    sections: [
      { bars: 4, play: { pad: 'A', hat: 'A' } },
      { bars: 8, play: { pad: 'A', kick: 'A', snare: 'A', hat: 'A', bass: 'A' } },
      { bars: 8, play: { pad: 'A', kick: 'A', snare: 'A', hat: 'A', bass: 'A', lead: 'A' } },
    ],
  },
];

const DRUM_VEL = {
  '.': 0, x: 0.8, X: 1, g: 0.35, o: 0.8,
};

function parseDrums(str) {
  return [...str].map((c) => ({ vel: DRUM_VEL[c] ?? 0, open: c === 'o' }));
}

function parseNotes(str) {
  const tokens = str.trim().split(/\s+/);
  const steps = new Array(16).fill(null);
  let last = null;
  tokens.slice(0, 16).forEach((tok, i) => {
    if (tok === '.') {
      last = null;
    } else if (tok === '-') {
      if (last) last.len++;
    } else {
      last = { note: parseInt(tok, 10), mute: tok.endsWith('m'), len: 1 };
      steps[i] = last;
    }
  });
  return steps;
}

const DRUMS = new Set(['kick', 'snare', 'clap', 'hat', 'crash']);

function compile(song) {
  const parts = {};
  for (const [name, variants] of Object.entries(song.parts)) {
    const drum = DRUMS.has(song.voices[name].inst);
    parts[name] = Object.fromEntries(Object.entries(variants).map(([k, s]) => [k, drum ? parseDrums(s) : parseNotes(s)]));
  }
  return { ...song, compiled: parts };
}

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.songs = SONGS.map(compile);
    this.song = null;
    this.onTrack = null;
    this.muted = false;
  }

  setup() {
    if (this.out || !this.audio.ctx) return;
    const ctx = this.audio.ctx;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.duckGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.out.connect(comp).connect(this.duckGain).connect(this.audio.musicBus);

    this.drums = ctx.createGain();
    this.drums.gain.value = 0.9;
    this.drums.connect(this.out);

    // Guitar amp: drive -> waveshaper -> "cabinet" low-pass.
    this.guitarIn = ctx.createGain();
    this.guitarIn.gain.value = 3;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = ((1 + 60) * x) / (1 + 60 * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70;
    const cab = ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 3200;
    const guitarOut = ctx.createGain();
    guitarOut.gain.value = 0.16;
    this.guitarIn.connect(shaper).connect(hp).connect(cab).connect(guitarOut).connect(this.out);
  }

  // Plays a shuffled list of the race tracks, forever.
  playRace() {
    const race = this.songs.filter((s) => !s.menu);
    this.queue = race.sort(() => Math.random() - 0.5);
    this.queuePos = 0;
    this.loop = false;
    this.start(this.queue[0]);
  }

  playMenu() {
    if (this.song?.menu) return;
    this.queue = null;
    this.loop = true;
    this.start(this.songs.find((s) => s.menu));
  }

  next() {
    if (!this.queue) {
      this.playRace();
      return;
    }
    this.queuePos = (this.queuePos + 1) % this.queue.length;
    this.start(this.queue[this.queuePos]);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.duckGain) this.duckGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // Briefly turn the music down (e.g. while your phone is ringing).
  duck(seconds) {
    if (!this.duckGain || this.muted) return;
    const t = this.ctx.currentTime;
    this.duckGain.gain.cancelScheduledValues(t);
    this.duckGain.gain.setTargetAtTime(0.15, t, 0.05);
    this.duckGain.gain.setTargetAtTime(1, t + seconds, 0.3);
  }

  start(song) {
    this.audio.whenReady(() => {
      this.setup();
      this.song = song;
      this.step = 0;
      this.bar = 0;
      this.section = 0;
      this.sectionBar = 0;
      this.nextTime = this.ctx.currentTime + 0.15;
      this.onTrack?.(song);
      if (!this.stopTimer) this.stopTimer = workerInterval(25, () => this.schedule());
    });
  }

  schedule() {
    const song = this.song;
    if (!song) return;
    const stepDur = 60 / song.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.nextTime);
      this.nextTime += stepDur * (this.step % 2 === 0 ? 1 + song.swing : 1 - song.swing);
      this.step++;
      if (this.step < 16) continue;
      this.step = 0;
      this.bar++;
      this.sectionBar++;
      if (this.sectionBar < song.sections[this.section].bars) continue;
      this.sectionBar = 0;
      this.section++;
      if (this.section < song.sections.length) continue;
      if (this.loop) {
        this.section = 1; // skip the intro when looping
      } else {
        this.next();
        return;
      }
    }
  }

  playStep(t) {
    const song = this.song;
    const section = song.sections[this.section];
    const root = song.key + song.roots[this.bar % song.roots.length];
    const stepDur = 60 / song.bpm / 4;
    if (section.crash && this.sectionBar === 0 && this.step === 0) this.crash(t, 0.8);

    for (const [name, variant] of Object.entries(section.play)) {
      const voice = song.voices[name];
      const step = song.compiled[name][variant][this.step];
      if (!step) continue;
      switch (voice.inst) {
        case 'kick': if (step.vel) this.kick(t, step.vel, voice.boom); break;
        case 'snare': if (step.vel) this.snare(t, step.vel * (voice.soft ? 0.6 : 1)); break;
        case 'clap': if (step.vel) this.clap(t, step.vel); break;
        case 'hat': if (step.vel) this.hat(t, step.vel, step.open); break;
        case 'crash': if (step.vel) this.crash(t, step.vel); break;
        default: {
          const note = root + step.note + 12 * (voice.oct ?? 0);
          const dur = step.len * stepDur;
          if (voice.inst === 'bass808') this.bass808(t, note, dur);
          else if (voice.inst === 'bass') this.bass(t, note, dur, voice);
          else if (voice.inst === 'guitar') this.guitar(t, note, dur, step.mute);
          else if (voice.inst === 'stab') this.chord(t, note + 12, voice.chord, Math.min(dur, 0.25), 'stab');
          else if (voice.inst === 'pad') this.chord(t, note, voice.chord, dur, 'pad');
          else if (voice.inst === 'lead') this.lead(t, note, dur);
          else if (voice.inst === 'arp') this.arp(t, note, dur);
        }
      }
    }
  }

  // ---------- voices ----------

  env(gain, t, peak, attack, end, sustain = null, releaseAt = null) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    if (sustain !== null) {
      gain.gain.setValueAtTime(sustain, releaseAt);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  osc(type, freq, t, end, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end + 0.05);
    return o;
  }

  noise(t, end, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.audio.noise;
    src.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(end + 0.05);
  }

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  kick(t, v, boom) {
    const g = this.ctx.createGain();
    g.connect(this.drums);
    const end = t + (boom ? 0.9 : 0.35);
    this.env(g, t, v, 0.003, end);
    const o = this.osc('sine', boom ? 120 : 150, t, end, g);
    o.frequency.exponentialRampToValueAtTime(boom ? 38 : 45, t + (boom ? 0.25 : 0.1));
  }

  snare(t, v) {
    const g = this.ctx.createGain();
    g.connect(this.drums);
    this.env(g, t, v * 0.45, 0.002, t + 0.2);
    const hp = this.filter('highpass', 1300);
    hp.connect(g);
    this.noise(t, t + 0.2, hp);
    const tg = this.ctx.createGain();
    tg.connect(this.drums);
    this.env(tg, t, v * 0.35, 0.002, t + 0.1);
    this.osc('triangle', 185, t, t + 0.1, tg);
  }

  clap(t, v) {
    const g = this.ctx.createGain();
    g.connect(this.drums);
    g.gain.setValueAtTime(0.0001, t);
    for (let k = 0; k < 3; k++) {
      g.gain.setValueAtTime(v * 0.5, t + k * 0.011);
      g.gain.exponentialRampToValueAtTime(v * 0.08, t + k * 0.011 + 0.009);
    }
    g.gain.setValueAtTime(v * 0.4, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    const bp = this.filter('bandpass', 1100, 0.8);
    bp.connect(g);
    this.noise(t, t + 0.25, bp);
  }

  hat(t, v, open) {
    const g = this.ctx.createGain();
    g.connect(this.drums);
    const end = t + (open ? 0.28 : 0.05);
    this.env(g, t, v * 0.18, 0.001, end);
    const hp = this.filter('highpass', 7500);
    hp.connect(g);
    this.noise(t, end, hp);
  }

  crash(t, v) {
    const g = this.ctx.createGain();
    g.connect(this.drums);
    this.env(g, t, v * 0.2, 0.002, t + 1.8);
    const hp = this.filter('highpass', 3500);
    hp.connect(g);
    this.noise(t, t + 1.8, hp);
  }

  bass808(t, note, dur) {
    const g = this.ctx.createGain();
    g.connect(this.out);
    const end = t + dur + 0.15;
    this.env(g, t, 0.6, 0.005, end, 0.5, t + dur);
    this.osc('sine', midi(note), t, end, g);
  }

  bass(t, note, dur, voice) {
    const g = this.ctx.createGain();
    g.connect(this.out);
    const end = t + dur + 0.04;
    this.env(g, t, 0.28, 0.004, end, 0.2, t + dur);
    let cutoff = voice.cutoff ?? 700;
    if (voice.acid) {
      // Slow filter sweep over 8 bars, plus a per-note "wow".
      const phase = (this.bar + this.step / 16) / 8;
      cutoff = 250 + 1700 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    }
    const lp = this.filter('lowpass', cutoff * (voice.acid ? 5 : 1.5), voice.acid ? 14 : 3);
    lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.12);
    lp.connect(g);
    this.osc('sawtooth', midi(note), t, end, lp);
  }

  guitar(t, note, dur, mute) {
    const g = this.ctx.createGain();
    let dest = this.guitarIn;
    if (mute) {
      const lp = this.filter('lowpass', 650);
      lp.connect(this.guitarIn);
      dest = lp;
    }
    g.connect(dest);
    const end = mute ? t + Math.min(dur, 0.13) : t + dur + 0.08;
    if (mute) this.env(g, t, 0.5, 0.003, end);
    else this.env(g, t, 0.5, 0.004, end, 0.35, t + dur);
    for (const interval of [0, 7, 12]) {
      for (const det of [-9, 9]) this.osc('sawtooth', midi(note + interval), t, end, g, det);
    }
  }

  chord(t, root, intervals, dur, kind) {
    const g = this.ctx.createGain();
    const pad = kind === 'pad';
    const lp = this.filter('lowpass', pad ? 1400 : 2600, 1);
    lp.connect(this.out);
    g.connect(lp);
    const end = t + dur + (pad ? 0.4 : 0.05);
    if (pad) this.env(g, t, 0.07, 0.08, end, 0.06, t + dur);
    else this.env(g, t, 0.09, 0.004, end);
    for (const iv of intervals) {
      if (pad) {
        this.osc('sine', midi(root + iv), t, end, g);
        this.osc('triangle', midi(root + iv + 12), t, end, g, 4);
      } else {
        for (const det of [-10, 10]) this.osc('sawtooth', midi(root + iv), t, end, g, det);
      }
    }
  }

  lead(t, note, dur) {
    const g = this.ctx.createGain();
    const lp = this.filter('lowpass', 3000, 2);
    lp.connect(this.out);
    g.connect(lp);
    const end = t + dur + 0.1;
    this.env(g, t, 0.07, 0.01, end, 0.06, t + dur);
    const a = this.osc('square', midi(note), t, end, g);
    const b = this.osc('sawtooth', midi(note), t, end, g, 7);
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(12, t + Math.min(0.3, dur));
    lfo.connect(depth);
    depth.connect(a.detune);
    depth.connect(b.detune);
    lfo.start(t);
    lfo.stop(end + 0.05);
  }

  arp(t, note, dur) {
    const g = this.ctx.createGain();
    const lp = this.filter('lowpass', 2200, 4);
    lp.connect(this.out);
    g.connect(lp);
    const end = t + Math.min(dur, 0.14) + 0.02;
    this.env(g, t, 0.06, 0.004, end);
    this.osc('square', midi(note), t, end, g);
  }
}
