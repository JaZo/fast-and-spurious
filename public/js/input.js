const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight', 'KeyH', 'KeyR', 'KeyC', 'Enter',
]);

const isTyping = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

// Standard gamepad mapping: RT throttle, LT brake, A drift, B nitro, Y honk, X reset, Back camera.
const PAD = { throttle: 7, brake: 6, drift: 0, nitro: 1, honk: 3, reset: 2, camera: 8, ready: 9 };

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.padPrev = [];

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
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
    };
    this.pressed.clear();

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
      out.horn ||= edge(PAD.honk);
      out.reset ||= edge(PAD.reset);
      out.camera ||= edge(PAD.camera);
      out.ready ||= edge(PAD.ready);
      this.padPrev = pad.buttons.map((btn) => btn.value);
    }
    return out;
  }
}
