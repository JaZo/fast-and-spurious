// Shared between the server and the browser. Keep it dependency-free.

export const LAPS = 3;
export const CHECKPOINTS = 24;
export const MAX_PLAYERS = 8;
export const TICK_RATE = 20; // snapshots per second, both directions

export const COUNTDOWN_MS = 3000;
export const RESULTS_MS = 12000;
export const FINISH_GRACE_MS = 45000; // time the stragglers get after the winner crosses the line

export const TRACK_WIDTH = 18;

// Control points (x, z) of the closed racing line. Smoothed with a Catmull-Rom spline on the client.
export const TRACK_POINTS = [
  [0, 0], [150, -20], [280, 40], [320, 180], [250, 300], [120, 280], [60, 180],
  [-40, 220], [-180, 300], [-300, 220], [-320, 60], [-220, -60], [-100, -40],
];

export const HORNS = ['classic', 'clown', 'cucaracha', 'goat', 'duck'];
