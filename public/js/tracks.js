// Every track: route, road dimensions, difficulty and the look of its night.
// Points are [x, z] or [x, z, y] (y = elevation); the route is smoothed with a Catmull-Rom spline.
// The sprint runs from `start` to `finish`; the route before and after is the grid and the run-off.

import * as THREE from 'three';

export const DIFFICULTY = {
  1: { label: 'EASY', color: '#b6ff3b' },
  2: { label: 'MEDIUM', color: '#38f2ff' },
  3: { label: 'HARD', color: '#ffae00' },
  4: { label: 'EXTREME', color: '#ff2a3a' },
};

// A hairpin: points on a half circle around (cx, cz), from angle a0 to a1, with elevation y0 -> y1.
function hairpin(cx, cz, r, a0, a1, y0, y1, steps = 4) {
  const pts = [];
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const a = a0 + (a1 - a0) * t;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, y0 + (y1 - y0) * t]);
  }
  return pts;
}

export const TRACKS = [
  {
    id: 'freeway',
    name: 'Neon Freeway',
    difficulty: 1,
    blurb: 'Six lanes, long sweepers and nowhere to hide. Flat out, all the way.',
    scenery: 'freeway',
    width: 26,
    lanes: 6,
    shoulder: 3,
    shoulderStyle: 'asphalt',
    barrier: 'soundwall',
    points: [
      [-160, 0], [0, 0], [350, -20], [700, 40], [1000, 200], [1200, 450], [1280, 750], [1230, 1050],
      [1060, 1300], [800, 1450], [500, 1500], [200, 1560], [0, 1700], [-80, 1900], [-60, 2100],
    ],
    start: [0, 0],
    finish: [-80, 1900],
    overpasses: [0.22, 0.58, 0.83],
    signs: [0.1, 0.4, 0.7],
    lamp: { color: 0xffd9a8, spacing: 55, height: 12 },
    sky: { top: 0x02030b, horizon: 0x141a33, haze: 0x5a3418 },
    fog: [60, 1100],
  },
  {
    id: 'downtown',
    name: 'Downtown Sprint',
    difficulty: 2,
    blurb: 'Skyscrapers, neon, a tunnel and three overpasses. The classic.',
    scenery: 'downtown',
    width: 20,
    lanes: 4,
    shoulder: 4.5,
    shoulderStyle: 'sidewalk',
    barrier: 'jersey',
    points: [
      [-140, 0], [0, 0], [300, 0], [420, 40], [480, 160], [480, 400], [440, 520], [300, 560],
      [100, 560], [0, 620], [-40, 760], [40, 900], [220, 940], [420, 900], [600, 960], [700, 1100],
      [680, 1300], [540, 1400], [300, 1400], [100, 1460], [0, 1600], [-60, 1800],
    ],
    start: [0, 0],
    finish: [0, 1600],
    tunnel: [0.43, 0.53],
    overpasses: [0.18, 0.7, 0.86],
    lamp: { color: 0xff9e40, spacing: 42, height: 9 },
    sky: { top: 0x020309, horizon: 0x1d1430, haze: 0x6a2c48 },
    fog: [40, 750],
  },
  {
    id: 'docks',
    name: 'Dockside Dash',
    difficulty: 3,
    blurb: 'Container canyons and 90° corners. Brake, flick, pray. Mind the water.',
    scenery: 'docks',
    width: 16,
    lanes: 2,
    shoulder: 3,
    shoulderStyle: 'concrete',
    barrier: 'hazard',
    points: [
      [-140, 0], [0, 0], [260, 0], [300, 8], [310, 40], [310, 260], [318, 292], [350, 300],
      [600, 300], [632, 308], [640, 340], [640, 520], [632, 552], [600, 560], [380, 560], [348, 568],
      [340, 600], [340, 800], [348, 832], [380, 840], [700, 840], [760, 860], [800, 920], [800, 1100],
      [790, 1130], [760, 1140], [500, 1140], [470, 1150], [460, 1180], [460, 1350], [450, 1460],
    ],
    start: [0, 0],
    finish: [460, 1350],
    quayX: 862,
    lamp: { color: 0xd8e6ff, spacing: 70, height: 22 },
    ambient: { sky: 0x9fb0c8, ground: 0x1a1a1a, intensity: 1.1 }, // the whole yard is floodlit
    sky: { top: 0x010407, horizon: 0x0f1a20, haze: 0x3d3420 },
    fog: [40, 700],
  },
  {
    id: 'pass',
    name: 'Mount Spurious Pass',
    difficulty: 4,
    blurb: 'A narrow mountain road with hairpins, guardrails and a long drop. Tofu delivery optional.',
    scenery: 'hills',
    width: 12,
    lanes: 2,
    shoulder: 1.6,
    shoulderStyle: 'gravel',
    barrier: 'guardrail',
    points: [
      [0, -130, 0], [0, 0, 0], [8, 90, 5], [0, 170, 10], [0, 195, 11],
      ...hairpin(-16, 195, 16, 0, Math.PI, 11, 13.5),
      [-32, 195, 13.5], [-34, 150, 16], [-40, 100, 19], [-40, 60, 21],
      ...hairpin(-56, 60, 16, 0, -Math.PI, 21, 23.5),
      [-72, 60, 23.5], [-72, 120, 27], [-76, 200, 32], [-80, 270, 37],
      [-60, 330, 42], [-20, 370, 47], [10, 420, 52], [0, 480, 57], [-40, 520, 62], [-50, 580, 67],
      [-20, 630, 72], [30, 680, 78], [80, 690, 82], [120, 670, 85], [150, 690, 88], [160, 740, 91],
      [160, 800, 94],
      ...hairpin(176, 800, 16, Math.PI, 0, 94, 96),
      [192, 800, 96], [200, 760, 99], [225, 720, 102],
      ...hairpin(241, 720, 16, Math.PI, Math.PI * 2, 102, 104),
      [257, 720, 104], [262, 780, 108], [270, 850, 113], [262, 920, 118], [255, 1020, 122],
    ],
    start: [0, 0],
    finish: [262, 920],
    lamp: { color: 0xff9e40, spacing: 0, height: 8 }, // only at the hairpins
    ambient: { sky: 0x5868a0, ground: 0x050608, intensity: 0.7 }, // moonlight on the mountain
    sky: { top: 0x01020a, horizon: 0x0c1226, haze: 0x1c2448 },
    fog: [30, 520],
    envIntensity: 0.25,
  },
];

export const DEFAULT_TRACK = 'downtown';
export const trackById = (id) => TRACKS.find((t) => t.id === id) ?? TRACKS.find((t) => t.id === DEFAULT_TRACK);

export function makeCurve(def) {
  return new THREE.CatmullRomCurve3(
    def.points.map(([x, z, y = 0]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
  );
}

// Outline and sprint length for the track selector, without building the whole track.
const summaries = new Map();
export function trackSummary(def) {
  if (summaries.has(def.id)) return summaries.get(def.id);
  const pts = makeCurve(def).getSpacedPoints(400);
  const nearest = ([x, z]) => pts.reduce((best, p, i) => {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    return d < best.d ? { d, i } : best;
  }, { d: Infinity, i: 0 }).i;
  const a = nearest(def.start);
  const b = nearest(def.finish);
  let length = 0;
  for (let i = a; i < b; i++) length += pts[i].distanceTo(pts[i + 1]);
  const climb = pts[b].y - pts[a].y;
  const summary = { outline: pts.slice(a, b + 1).map((p) => [p.x, p.z]), length, climb };
  summaries.set(def.id, summary);
  return summary;
}
