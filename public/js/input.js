const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight', 'KeyH', 'KeyR', 'KeyC', 'Enter', 'KeyQ', 'KeyF', 'KeyG', 'KeyM', 'KeyN',
]);

const isTyping = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

// Standard gamepad mapping.
const PAD = {
  throttle: 7, brake: 6, drift: 0, nitro: 1, honk: 3, reset: 2, camera: 8, ready: 9, purge: 4, brights: 5, call: 12,
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.padPrev = [];
    this.enabled = true;
    // On-screen controls write here (see touch.js): held controls and one-shot taps.
    this.touch = {
      steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false,
    };
    this.taps = new Set();

    addEventListener('keydown', (e) => {
      if (isTyping(e) || !this.enabled) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  read() {
    const k = (...codes) => codes.some((c) => this.down.has(c));
    const once = (c) => this.pressed.has(c);

    const out = {
      throttle: k('KeyW', 'ArrowUp') ? 1 : 0,
      brake: k('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
      handbrake: k('Space'),
      nitro: k('ShiftLeft', 'ShiftRight'),
      horn: once('KeyH'),
      reset: once('KeyR'),
      camera: once('KeyC'),
      ready: once('Enter'),
      purge: once('KeyQ'),
      brights: once('KeyF'),
      call: once('KeyG'),
      mute: once('KeyM'),
      nextTrack: once('KeyN'),
    };
    this.pressed.clear();

    const t = this.touch;
    if (Math.abs(t.steer) > 0.02) out.steer = t.steer;
    out.throttle = Math.max(out.throttle, t.throttle);
    out.brake = Math.max(out.brake, t.brake);
    out.handbrake ||= t.handbrake;
    out.nitro ||= t.nitro;
    for (const tap of this.taps) out[tap] = true;
    this.taps.clear();

    const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    if (pad) {
      const b = (i) => pad.buttons[i]?.value ?? 0;
      const edge = (i) => b(i) > 0.5 && !(this.padPrev[i] > 0.5);
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.12) out.steer = axis;
      out.throttle = Math.max(out.throttle, b(PAD.throttle));
      out.brake = Math.max(out.brake, b(PAD.brake));
      out.handbrake ||= b(PAD.drift) > 0.5;
      out.nitro ||= b(PAD.nitro) > 0.5;
      for (const key of ['horn', 'reset', 'camera', 'ready', 'purge', 'brights', 'call']) {
        out[key] ||= edge(PAD[key === 'horn' ? 'honk' : key]);
      }
      this.padPrev = pad.buttons.map((btn) => btn.value);
    }
    return out;
  }

  // A one-shot action from a button on screen (horn, reset, purge, ...).
  tap(action) {
    if (this.enabled) this.taps.add(action);
  }

  static neutral() {
    return {
      throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false,
    };
  }
}
