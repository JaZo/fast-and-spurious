// Game constants. Everything that the host and the clients must agree on lives here.

export const MAX_PLAYERS = 8;
export const TICK_RATE = 20; // state snapshots per second, both directions

export const COUNTDOWN_MS = 3000;
export const RESULTS_MS = 12000;
export const FINISH_GRACE_MS = 45000; // time the stragglers get after the winner crosses the line
export const IDLE_KICK_MS = 10000; // drop peers we haven't heard from in this long

// PeerJS ids are global on the public signalling server, so namespace ours.
export const PEER_PREFIX = 'fast-and-spurious-v2-';

export const TRACK_NAME = 'Downtown Sprint';
export const ROAD_WIDTH = 20;
export const CHECKPOINTS = 32; // spread from start to finish; the last one is the finish line

// Control points (x, z) of the racing line, smoothed with a Catmull-Rom spline.
// The sprint runs from START_POINT to FINISH_POINT; the bits before and after are grid and run-off.
export const TRACK_POINTS = [
  [-140, 0], [0, 0], [300, 0], [420, 40], [480, 160], [480, 400], [440, 520], [300, 560],
  [100, 560], [0, 620], [-40, 760], [40, 900], [220, 940], [420, 900], [600, 960], [700, 1100],
  [680, 1300], [540, 1400], [300, 1400], [100, 1460], [0, 1600], [-60, 1800],
];
export const START_POINT = [0, 0];
export const FINISH_POINT = [0, 1600];

// Fraction ranges (0 = start, 1 = finish) of the special sections.
export const TUNNEL = [0.43, 0.53];
export const OVERPASSES = [0.18, 0.7, 0.86];

export const HORNS = ['classic', 'clown', 'cucaracha', 'goat', 'duck'];

// Spurious actions: mild ways to annoy the competition. Cooldowns are checked by the host too.
export const ACTIONS = {
  purge: { key: 'Q', name: 'NOS Purge', icon: '💨', cooldown: 12000, nitroCost: 0.15 },
  brights: { key: 'F', name: 'High Beams', icon: '🔦', cooldown: 10000 },
  call: { key: 'G', name: 'Spam Call', icon: '📞', cooldown: 25000 },
};
// After being hit by an effect you're immune to that same effect for this long.
export const IMMUNITY_MS = 8000;
