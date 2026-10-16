// All the jokes live here, so the rest of the code can stay serious.

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const DRIVER_NAMES = [
  'Sir Skids-a-Lot', 'Brake Lightyear', 'Vin Dieselgate', 'Lewis Hamiltoast', 'Captain Drift',
  'Max Verstappuccino', 'Fernando Alonsno', 'Turbo Tortoise', 'Lightning McQueasy', 'Sebastian Vettlebell',
  'Kimi Räikkönot', 'Dom Toretto Jr.', 'Grandma Nitro', 'Clutch Norris', 'Ayrton Sennaplease',
];

export const WALL_QUIPS = [
  'That wall started it.',
  'Insurance premium: ↑↑↑',
  'Have you tried steering?',
  'The wall is fine, thanks for asking.',
  'Physics 1 – You 0',
  'Bold strategy.',
  'Tyre barrier: undefeated.',
  'Your car felt that one.',
];

export const BUMP_QUIPS = ["Rubbin' is racin'!", 'Excuse you!', 'Bumper cars mode: ON', 'Personal space, please.'];

export const RESET_QUIPS = [
  'Teleported by the Department of Embarrassment.',
  'Nobody saw that. Probably.',
  'Have you tried turning it off and on again?',
];

export const JOIN_QUIPS = ['joined. Lock your doors.', 'has entered the chat. And the track.', 'arrived. Hide the cones.'];
export const LEAVE_QUIPS = ['rage-quit.', 'went to get milk.', 'drove into the sunset.', 'left. Their car is still on fire.'];

export const BILLBOARDS = [
  'BRAKES ARE A SUGGESTION',
  'NOW 12% LESS SPURIOUS',
  'DRIFT RESPONSIBLY (DON\'T)',
  'INSURANCE? NEVER HEARD OF IT',
  'HONK IF YOU LOVE DUCKS',
  'YOUR AD HERE (PLEASE)',
  'SPEED LIMIT: YES',
];

export function finishQuip(place, total) {
  if (place === 1) return pick(['WINNER! Tell your mum.', 'Absolute legend.', 'First! Nobody saw the shortcuts.']);
  if (place === total) return pick(['Participation trophy unlocked 🏆', 'You were enjoying the scenery, right?', 'Last, but with style.']);
  return pick(['Respectably mid.', 'Not first, not last. Perfectly balanced.', 'A solid "meh".']);
}

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};

export function formatTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--:--.--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
