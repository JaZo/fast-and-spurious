// Performance parts, tuning sliders and visual options, plus turning a build into physics numbers.

export const LEVELS = ['Stock', 'Street', 'Pro', 'Extreme'];
export const BUDGET = 10; // "Street Cred" to spend on parts; maxing everything would cost 18

export const PARTS = [
  { key: 'engine', name: 'Engine', blurb: 'Cams, pistons, questionable stickers' },
  { key: 'turbo', name: 'Turbo', blurb: 'Spool it up. Pssssh included.' },
  { key: 'transmission', name: 'Transmission', blurb: 'Shorter shifts, longer legs' },
  { key: 'nitrous', name: 'Nitrous', blurb: 'More boost, lasts longer' },
  { key: 'tires', name: 'Tires', blurb: 'Grip and braking' },
  { key: 'suspension', name: 'Suspension', blurb: 'Sharper steering, less body roll' },
];

export const SLIDERS = [
  { key: 'gearing', name: 'Gear ratio', left: 'Acceleration', right: 'Top speed' },
  { key: 'downforce', name: 'Downforce', left: 'Top speed', right: 'Grip' },
  { key: 'balance', name: 'Handling', left: 'Drift', right: 'Grip' },
];

export const PAINT = ['#ff2fd6', '#38f2ff', '#b6ff3b', '#ffcc00', '#ff6a00', '#ff2a3a', '#8a5cff', '#f4f6fb', '#9aa3ad', '#16171c'];

export const VISUALS = [
  { key: 'finish', name: 'Paint finish', values: ['Gloss', 'Metallic', 'Matte', 'Pearl'] },
  { key: 'kit', name: 'Body kit', values: ['Stock', 'Street', 'Pro', 'Extreme'] },
  { key: 'spoiler', name: 'Spoiler', values: ['None', 'Ducktail', 'GT Wing', 'Absurd'] },
  { key: 'hood', name: 'Hood', values: ['Stock', 'Scoop', 'Carbon'] },
  { key: 'rims', name: 'Rims', values: ['5-Spoke', '10-Spoke', 'Dish', 'Turbine'] },
  { key: 'rimColor', name: 'Rim color', values: ['Silver', 'Black', 'Gold', 'Neon'] },
  { key: 'vinyl', name: 'Vinyl', values: ['None', 'Racing stripes', 'Flames', 'Tribal', 'Number 13'] },
  { key: 'neon', name: 'Neon', values: ['None', 'Cyan', 'Lime', 'Pink', 'Purple', 'Red', 'Amber', 'White'] },
  { key: 'tint', name: 'Window tint', values: ['Clear', 'Dark', 'Limo'] },
  { key: 'lights', name: 'Headlights', values: ['Halogen', 'Xenon', 'Yellow'] },
  { key: 'exhaust', name: 'Exhaust', values: ['Single', 'Dual', 'Cannon'] },
  { key: 'roof', name: 'Roof', values: ['Nothing', 'Roof scoop', 'Traffic cone', 'Rubber duck', 'Crown'] },
];

export const NEON_COLORS = [null, '#38f2ff', '#7dff3b', '#ff2fd6', '#9b4dff', '#ff2a3a', '#ffae00', '#ffffff'];

const HEX = /^#[0-9a-f]{6}$/i;
const STORAGE_KEY = 'fs.build.v2';

export function defaultBuild() {
  return {
    perf: { engine: 1, turbo: 1, transmission: 1, nitrous: 1, tires: 1, suspension: 1 },
    sliders: { gearing: 0, downforce: 0, balance: 0 },
    look: {
      color: PAINT[Math.floor(Math.random() * 7)],
      vinylColor: '#ffffff',
      finish: 0, kit: 1, spoiler: 2, hood: 0, rims: 0, rimColor: 0, vinyl: 0, neon: 1, tint: 1, lights: 1, exhaust: 1, roof: 0,
    },
  };
}

export const spent = (perf) => PARTS.reduce((sum, p) => sum + perf[p.key], 0);

// Clamp anything that came from storage or from another player into something we can render.
export function sanitizeLook(raw) {
  const look = defaultBuild().look;
  if (!raw || typeof raw !== 'object') return look;
  if (typeof raw.color === 'string' && HEX.test(raw.color)) look.color = raw.color.toLowerCase();
  if (typeof raw.vinylColor === 'string' && HEX.test(raw.vinylColor)) look.vinylColor = raw.vinylColor.toLowerCase();
  for (const opt of VISUALS) {
    const v = raw[opt.key];
    if (Number.isInteger(v) && v >= 0 && v < opt.values.length) look[opt.key] = v;
  }
  return look;
}

function sanitizeBuild(raw) {
  const build = defaultBuild();
  if (!raw || typeof raw !== 'object') return build;
  for (const p of PARTS) {
    const v = raw.perf?.[p.key];
    if (Number.isInteger(v) && v >= 0 && v <= 3) build.perf[p.key] = v;
  }
  // Over budget (old save, fiddling in devtools)? Back to the default package.
  if (spent(build.perf) > BUDGET) build.perf = defaultBuild().perf;
  for (const s of SLIDERS) {
    const v = raw.sliders?.[s.key];
    if (typeof v === 'number' && Number.isFinite(v)) build.sliders[s.key] = Math.max(-1, Math.min(1, v));
  }
  build.look = sanitizeLook(raw.look);
  return build;
}

export function loadBuild() {
  try {
    return sanitizeBuild(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return defaultBuild();
  }
}

export function saveBuild(build) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
  } catch {
    // private mode: the build just won't survive a reload
  }
}

// Build -> physics numbers (m/s, m/s², 1/s).
export function computeTuning(build) {
  const { engine, turbo, transmission, nitrous, tires, suspension } = build.perf;
  const { gearing, downforce, balance } = build.sliders;

  let maxSpeed = 52 + engine * 2.4 + turbo * 1.2 + transmission * 1.6;
  let accel = 16 + engine * 1.5 + turbo * 2.4 + transmission * 1.3;
  let grip = 7.6 + tires * 0.8 + suspension * 0.45;

  accel *= 1 - gearing * 0.14;
  maxSpeed *= 1 + gearing * 0.07 - downforce * 0.04;
  grip *= 1 + downforce * 0.12 + balance * 0.08;

  return {
    maxSpeed,
    engine: accel,
    nitroSpeed: maxSpeed + 16 + nitrous * 2,
    nitroBoost: 12 + nitrous * 3.5,
    nitroDrain: 0.34 - nitrous * 0.035,
    nitroRegen: 0.04 + nitrous * 0.005,
    driftRegen: 0.28,
    brake: 32 + tires * 3,
    reverseAccel: 12,
    reverseMax: 14,
    rolling: 3,
    grip,
    driftGrip: 1.5 + balance * 0.5,
    steerRate: 2.15 + suspension * 0.12,
    roll: 1 - suspension * 0.22,
    sidewalkFactor: 0.72,
    turbo,
  };
}

// 0..1 bars for the garage, plus a couple of human numbers.
export function statBars(t) {
  // 0-100 km/h by integrating the same curve the physics uses.
  let v = 0;
  let time = 0;
  while (v < 27.78 && time < 20) {
    v += t.engine * (1 - (v / t.maxSpeed) ** 2) * 0.005;
    time += 0.005;
  }
  const clamp = (x) => Math.max(0.03, Math.min(1, x));
  return {
    topSpeed: { value: clamp((t.maxSpeed - 46) / 28), label: `${Math.round(t.maxSpeed * 3.6)} km/h` },
    accel: { value: clamp((3.2 - time) / 2), label: `0-100 in ${time.toFixed(2)}s` },
    handling: { value: clamp((t.grip - 6.5) / 5 + (t.steerRate - 2.1) / 2), label: '' },
    nitro: { value: clamp((t.nitroBoost - 9) / 14 + (0.34 - t.nitroDrain) * 2), label: '' },
  };
}
