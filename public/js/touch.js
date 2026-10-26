// On-screen controls for phones and tablets: a floating steering pad on the left, pedals on the right.
// Shown on touch screens, hidden while a gamepad is connected.

const STEER_RANGE = 70; // px of horizontal drag for full lock

// Keep receiving a finger's moves even when it slides off the control. Some pointers can't be captured.
function capture(node, id) {
  try {
    node.setPointerCapture(id);
  } catch {
    // fine: we still get the events while the finger stays on the control
  }
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

export class TouchControls {
  constructor(input, { onFullscreen }) {
    this.input = input;
    this.root = el('div', 'touch-controls');
    this.root.id = 'touch';

    // Steering: put a thumb down anywhere in the zone, then drag left/right.
    const zone = el('div', 'steer-zone');
    this.pad = el('div', 'steer-pad');
    this.knob = el('div', 'steer-knob');
    this.pad.append(el('span', 'steer-hint', '◀ STEER ▶'), this.knob);
    zone.append(this.pad);
    this.bindSteer(zone);

    const pedals = el('div', 'pedals');
    for (const [key, label, cls] of [
      ['nitro', 'N₂O', 'nitro'], ['handbrake', 'DRIFT', 'drift'], ['brake', 'BRAKE', 'brake'], ['throttle', 'GAS', 'gas'],
    ]) {
      const btn = el('button', `pedal ${cls}`, label);
      btn.type = 'button';
      this.bindHold(btn, key);
      pedals.append(btn);
    }

    const utils = el('div', 'touch-utils');
    for (const [action, icon, title] of [['horn', '📯', 'Honk'], ['reset', '↺', 'Reset to road'], ['camera', '🎥', 'Camera'], ['fullscreen', '⛶', 'Fullscreen']]) {
      const btn = el('button', 'util', icon);
      btn.type = 'button';
      btn.title = title;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (action === 'fullscreen') onFullscreen();
        else input.tap(action);
      });
      utils.append(btn);
    }

    this.root.append(zone, pedals, utils);
    document.getElementById('hud').append(this.root);
    document.body.append(el('div', 'rotate-hint', '<span>🔄</span>Turn your phone sideways<br>for maximum spuriousness'));

    // Show on touch screens; a connected gamepad takes over.
    this.touchScreen = matchMedia('(pointer: coarse)').matches;
    addEventListener('touchstart', () => {
      if (!this.touchScreen) {
        this.touchScreen = true;
        this.refresh();
      }
    }, { passive: true });
    addEventListener('gamepadconnected', () => this.refresh());
    addEventListener('gamepaddisconnected', () => this.refresh());
    this.refresh();
  }

  refresh() {
    const pad = [...(navigator.getGamepads?.() ?? [])].some(Boolean);
    const on = this.touchScreen && !pad;
    document.body.classList.toggle('touch', on);
    document.getElementById('copy-link').textContent = on && navigator.share ? '🔗 Invite' : 'Copy invite link';
    if (!on) this.release();
    // Thumbs need the screen: start with the lobby panel folded up.
    if (on && !this.folded) {
      this.folded = true;
      document.getElementById('lobby').classList.add('collapsed');
    }
  }

  release() {
    Object.assign(this.input.touch, {
      steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false,
    });
    this.knob.style.transform = '';
    for (const b of this.root.querySelectorAll('.pedal.down')) b.classList.remove('down');
  }

  bindSteer(zone) {
    let id = null;
    let originX = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      originX = e.clientX;
      capture(zone, id);
      // The pad jumps to where the thumb landed.
      const r = zone.getBoundingClientRect();
      this.pad.style.left = `${e.clientX - r.left}px`;
      this.pad.style.top = `${e.clientY - r.top}px`;
      this.pad.classList.add('active');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const s = Math.max(-1, Math.min(1, (e.clientX - originX) / STEER_RANGE));
      this.input.touch.steer = s;
      this.knob.style.transform = `translateX(${s * STEER_RANGE * 0.6}px)`;
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.input.touch.steer = 0;
      this.knob.style.transform = '';
      this.pad.classList.remove('active');
      this.pad.style.left = this.pad.style.top = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  bindHold(btn, key) {
    const ids = new Set();
    const set = () => {
      const on = ids.size > 0;
      this.input.touch[key] = key === 'throttle' || key === 'brake' ? (on ? 1 : 0) : on;
      btn.classList.toggle('down', on);
      if (on) navigator.vibrate?.(8);
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ids.add(e.pointerId);
      capture(btn, e.pointerId);
      set();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      btn.addEventListener(type, (e) => {
        if (!ids.delete(e.pointerId)) return;
        set();
      });
    }
  }
}
