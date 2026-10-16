// The garage: a dark showroom with a turntable, plus the NFSU-style tuning menu next to it.

import * as THREE from 'three';
import { CarModel } from './car.js';
import { neonTexture } from './city.js';
import {
  PARTS, SLIDERS, VISUALS, LEVELS, BUDGET, PAINT, spent, computeTuning, statBars, saveBuild,
} from './tuning.js';

const $ = (id) => document.getElementById(id);
const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class Garage {
  constructor(env, { onClose }) {
    this.onClose = onClose;
    this.active = false;
    this.tab = 'perf';
    this.selected = 0;
    this.spin = 0.6;
    this.drag = null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040409);
    scene.fog = new THREE.Fog(0x040409, 18, 40);
    scene.environment = env;
    scene.environmentIntensity = 0.45;
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 48),
      new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.35, metalness: 0.3 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    this.turntable = new THREE.Group();
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.5, 0.14, 64),
      new THREE.MeshStandardMaterial({ color: 0x15161d, roughness: 0.35, metalness: 0.8 }),
    );
    plate.position.y = 0.07;
    plate.receiveShadow = true;
    this.turntable.add(plate);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.47, 0.035, 8, 96), new THREE.MeshBasicMaterial({ color: glow(0x38f2ff, 2) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    scene.add(ring);
    scene.add(this.turntable);

    // Neon tubes on the back wall and a sign.
    for (let k = 0; k < 9; k++) {
      const a = -0.9 + (k / 8) * 1.8;
      const tube = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 6, 0.08),
        new THREE.MeshBasicMaterial({ color: glow(k % 2 ? 0x38f2ff : 0xff2fd6, 1.8) }),
      );
      tube.position.set(Math.sin(a) * 14, 3, -Math.cos(a) * 14);
      scene.add(tube);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 1.9),
      new THREE.MeshBasicMaterial({ map: neonTexture('SPURIOUS GARAGE', '#ff2fd6'), transparent: true, color: glow(0xffffff, 1.3) }),
    );
    sign.position.set(0, 5, -13.5);
    scene.add(sign);

    scene.add(new THREE.HemisphereLight(0x8090ff, 0x100818, 0.25));
    const key = new THREE.SpotLight(0xffffff, 70, 40, 0.5, 0.6, 2);
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const rimL = new THREE.SpotLight(0xff2fd6, 45, 40, 0.6, 0.8, 2);
    rimL.position.set(-7, 4, -5);
    const rimR = new THREE.SpotLight(0x38f2ff, 45, 40, 0.6, 0.8, 2);
    rimR.position.set(7, 4, -4);
    for (const l of [key, rimL, rimR]) {
      l.target.position.set(0, 0.6, 0);
      scene.add(l, l.target);
    }

    this.bindDom();
  }

  bindDom() {
    for (const btn of document.querySelectorAll('#garage .tabs button')) {
      btn.onclick = () => {
        this.tab = btn.dataset.tab;
        this.selected = 0;
        this.render();
      };
    }
    $('garage-done').onclick = () => this.close();

    addEventListener('keydown', (e) => {
      if (!this.active || e.target instanceof HTMLInputElement) return;
      const rows = this.rows();
      const handled = {
        ArrowUp: () => { this.selected = (this.selected - 1 + rows.length) % rows.length; },
        ArrowDown: () => { this.selected = (this.selected + 1) % rows.length; },
        ArrowLeft: () => rows[this.selected]?.change(-1),
        ArrowRight: () => rows[this.selected]?.change(1),
        Tab: () => { this.tab = this.tab === 'perf' ? 'visual' : 'perf'; this.selected = 0; },
        Escape: () => this.close(),
        Enter: () => this.close(),
      }[e.key];
      if (!handled) return;
      e.preventDefault();
      handled();
      if (this.active) this.render();
    });

    const canvas = document.getElementById('game');
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.drag = { x: e.clientX, spin: this.spin };
    });
    addEventListener('pointermove', (e) => {
      if (this.drag) this.spin = this.drag.spin + (e.clientX - this.drag.x) * 0.01;
    });
    addEventListener('pointerup', () => { this.drag = null; });
  }

  open(build) {
    this.build = structuredClone(build);
    this.active = true;
    this.rebuildCar();
    this.render();
    $('garage').hidden = false;
  }

  close() {
    if (!this.active) return;
    this.active = false;
    $('garage').hidden = true;
    saveBuild(this.build);
    this.onClose(this.build);
  }

  rebuildCar() {
    this.car?.dispose();
    this.car = new CarModel(this.build.look);
    this.car.root.position.y = 0.14;
    this.car.update({ x: 0, z: 0, h: 0, speed: 0, steer: 0.35, flags: 0 }, 1);
    this.car.root.position.y = 0.14;
    this.car.root.traverse((o) => { o.castShadow = true; });
    this.turntable.add(this.car.root);
  }

  changed(rebuild = true) {
    saveBuild(this.build);
    if (rebuild) this.rebuildCar();
    this.render();
  }

  // Rows for the current tab: each knows how to render itself and how to change with ←/→.
  rows() {
    const b = this.build;
    if (this.tab === 'perf') {
      const left = BUDGET - spent(b.perf);
      return [
        ...PARTS.map((part) => ({
          label: part.name,
          value: LEVELS[b.perf[part.key]],
          pips: b.perf[part.key],
          hint: part.blurb,
          change: (d) => {
            const next = b.perf[part.key] + d;
            if (next < 0 || next > 3) return;
            if (d > 0 && left <= 0) {
              this.flash('Out of Street Cred! Downgrade something else first.');
              return;
            }
            b.perf[part.key] = next;
            this.changed(false);
          },
        })),
        ...SLIDERS.map((s) => ({
          label: s.name,
          slider: s,
          value: b.sliders[s.key],
          change: (d) => {
            b.sliders[s.key] = Math.max(-1, Math.min(1, Math.round((b.sliders[s.key] + d * 0.25) * 4) / 4));
            this.changed(false);
          },
        })),
      ];
    }
    return [
      { label: 'Paint', colors: 'color', change: (d) => this.cycleColor('color', d) },
      { label: 'Vinyl color', colors: 'vinylColor', change: (d) => this.cycleColor('vinylColor', d) },
      ...VISUALS.map((opt) => ({
        label: opt.name,
        value: opt.values[b.look[opt.key]],
        change: (d) => {
          b.look[opt.key] = (b.look[opt.key] + d + opt.values.length) % opt.values.length;
          this.changed();
        },
      })),
    ];
  }

  cycleColor(key, d) {
    const i = PAINT.indexOf(this.build.look[key]);
    this.build.look[key] = PAINT[(i + d + PAINT.length) % PAINT.length];
    this.changed();
  }

  flash(text) {
    const node = $('garage-msg');
    node.textContent = text;
    node.hidden = false;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => { node.hidden = true; }, 2200);
  }

  render() {
    for (const btn of document.querySelectorAll('#garage .tabs button')) btn.classList.toggle('active', btn.dataset.tab === this.tab);
    const b = this.build;
    const rows = this.rows();
    this.selected = Math.min(this.selected, rows.length - 1);

    $('garage-cred').hidden = this.tab !== 'perf';
    $('garage-cred').textContent = `STREET CRED  ${BUDGET - spent(b.perf)} / ${BUDGET} left`;

    $('garage-rows').replaceChildren(...rows.map((row, k) => {
      const node = el('div', `garage-row${k === this.selected ? ' selected' : ''}`);
      node.onmouseenter = () => {
        if (this.selected === k) return;
        this.selected = k;
        for (const [j, child] of [...node.parentNode.children].entries()) child.classList.toggle('selected', j === k);
      };
      const label = el('div', 'g-label', row.label);
      if (row.hint) label.append(el('small', '', row.hint));
      node.append(label);

      if (row.colors) {
        const sw = el('div', 'g-swatches');
        for (const c of PAINT) {
          const s = el('button', `swatch${b.look[row.colors] === c ? ' selected' : ''}`);
          s.type = 'button';
          s.style.background = c;
          s.onclick = () => {
            b.look[row.colors] = c;
            this.changed();
          };
          sw.append(s);
        }
        const custom = el('input');
        custom.type = 'color';
        custom.value = b.look[row.colors];
        custom.title = 'Custom color';
        custom.onchange = () => {
          b.look[row.colors] = custom.value;
          this.changed();
        };
        sw.append(custom);
        node.append(sw);
        return node;
      }

      if (row.slider) {
        const wrap = el('div', 'g-slider');
        const input = el('input');
        Object.assign(input, { type: 'range', min: -1, max: 1, step: 0.25, value: row.value });
        input.oninput = () => {
          b.sliders[row.slider.key] = Number(input.value);
          saveBuild(b);
          this.renderStats();
        };
        wrap.append(el('small', '', row.slider.left), input, el('small', '', row.slider.right));
        node.append(wrap);
        return node;
      }

      const picker = el('div', 'g-picker');
      const prev = el('button', 'arrow', '◀');
      const next = el('button', 'arrow', '▶');
      prev.type = next.type = 'button';
      prev.onclick = () => row.change(-1);
      next.onclick = () => row.change(1);
      const value = el('span', 'g-value', row.value);
      if (row.pips != null) {
        const pips = el('span', 'pips');
        for (let i = 1; i <= 3; i++) pips.append(el('i', i <= row.pips ? 'on' : ''));
        value.append(pips);
      }
      picker.append(prev, value, next);
      node.append(picker);
      return node;
    }));
    this.renderStats();
  }

  renderStats() {
    const stats = statBars(computeTuning(this.build));
    const rows = [['Top speed', stats.topSpeed], ['Acceleration', stats.accel], ['Handling', stats.handling], ['Nitrous', stats.nitro]];
    $('garage-stats').replaceChildren(...rows.map(([name, s]) => {
      const row = el('div', 'stat');
      const bar = el('div', 'bar');
      const fill = el('div', 'fill');
      fill.style.width = `${Math.round(s.value * 100)}%`;
      bar.append(fill);
      row.append(el('span', 'stat-name', name), bar, el('span', 'stat-label', s.label));
      return row;
    }));
  }

  update(dt, aspect) {
    if (!this.drag) this.spin += dt * 0.25;
    this.turntable.rotation.y = this.spin;
    this.camera.aspect = aspect;
    // On wide screens the menu covers the left, so push the car to the right of the frame.
    this.camera.setViewOffset(1000 * aspect, 1000, aspect > 1.2 ? -170 : 0, 0, 1000 * aspect, 1000);
    this.camera.position.set(0, 2.1, 8.2);
    this.camera.lookAt(0, 0.7, 0);
    this.camera.updateProjectionMatrix();
  }
}
