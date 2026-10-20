// Game constants. Everything that the host and the clients must agree on lives here.

export const MAX_PLAYERS = 8;
export const TICK_RATE = 20; // state snapshots per second, both directions

export const COUNTDOWN_MS = 3000;
export const RESULTS_MS = 12000;
export const FINISH_GRACE_MS = 45000; // time the stragglers get after the winner crosses the line
export const IDLE_KICK_MS = 20000; // drop peers we haven't heard from in this long (generous: loading a track can stall a slow PC)

// PeerJS ids are global on the public signalling server, so namespace ours.
export const PEER_PREFIX = 'fast-and-spurious-v3-';

export const CHECKPOINTS = 32; // spread from start to finish; the last one is the finish line

export const HORNS = ['classic', 'clown', 'cucaracha', 'goat', 'duck'];

// Spurious actions: mild ways to annoy the competition. Cooldowns are checked by the host too.
export const ACTIONS = {
  purge: { key: 'Q', name: 'NOS Purge', icon: '💨', cooldown: 12000, nitroCost: 0.15 },
  brights: { key: 'F', name: 'High Beams', icon: '🔦', cooldown: 10000 },
  call: { key: 'G', name: 'Spam Call', icon: '📞', cooldown: 25000 },
};
// After being hit by an effect you're immune to that same effect for this long.
export const IMMUNITY_MS = 8000;
