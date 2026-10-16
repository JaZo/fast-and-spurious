// All the jokes live here, so the rest of the code can stay serious.

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const DRIVER_NAMES = [
  'Sir Skids-a-Lot', 'Brake Lightyear', 'Vin Dieselgate', 'Lewis Hamiltoast', 'Captain Drift',
  'Max Verstappuccino', 'Fernando Alonsno', 'Turbo Tortoise', 'Lightning McQueasy', 'Sebastian Vettlebell',
  'Kimi Räikkönot', 'Dom Toretto Jr.', 'Grandma Nitro', 'Clutch Norris', 'Ayrton Sennaplease',
  'Razor Burn', 'Eddie Spaghetti', 'Samantha Spoiler', 'Underglow Ursula', 'Tofu Takumi',
];

export const WALL_QUIPS = [
  'That barrier started it.',
  'Insurance premium: ↑↑↑',
  'Have you tried steering?',
  'The wall is fine, thanks for asking.',
  'Physics 1 – You 0',
  'Bold strategy.',
  'Your body kit felt that one.',
  'Concrete: undefeated since 1824.',
];

export const BUMP_QUIPS = ["Rubbin' is racin'!", 'Excuse you!', 'Mind the paint job!', 'Personal space, please.'];

export const RESET_QUIPS = [
  'Teleported by the Department of Embarrassment.',
  'Nobody saw that. Probably.',
  'Have you tried turning it off and on again?',
];

export const JOIN_QUIPS = ['rolled up. Lock your doors.', 'has entered the underground.', 'arrived. Hide the cones.'];
export const LEAVE_QUIPS = ['rage-quit.', 'went to get milk.', 'drove into the sunset.', 'got towed.'];

export const NEON_SIGNS = [
  'NITROUS NOODLES', 'SPURIOUS AUTO PARTS', 'DRIFT INN', 'TURBO KEBAB 24/7', 'LOW RIDE LAUNDRY',
  'BODY KIT & CABOODLE', 'TOFU DELIVERY CO', 'SPOILER ALERT CINEMA', 'VTEC YO SELF', 'SUBWOOFER SUBS',
  'CLUTCH & GRAB PAWN', 'UNDERGLOW DINER', 'KEBAB BEFORE YOU BRAKE', 'INSURANCE? LOL', 'SKID ROW TYRES',
  'TWO FAST TWO NAPKINS BBQ', 'PIMP MY RIDE-SHARE', 'BLOW-OFF VALVE BAR', 'NEON GENESIS CAR WASH', 'GAS GAS GAS STATION',
];

export const SPAM_CALLS = [
  ['Car Warranty Dept.', "We've been trying to reach you about your car's extended warranty."],
  ['Your Mum', 'Are you wearing a seatbelt? Call me back. Love, Mum.'],
  ['Totally Not A Scam', 'Congratulations! You won a free spoiler. Just send your PIN.'],
  ['Dentist', 'Reminder: you have a root canal at 9:00. Drive safe!'],
  ['Pizza Place', 'Your large Hawaiian is ready. Hurry, the pineapple is getting cold.'],
  ['Unknown Number', '*heavy breathing* ...is your refrigerator running?'],
];

export function finishQuip(place, total) {
  if (place === 1) return pick(['WINNER! Respect +100.', 'King of the Underground.', 'First! Nobody saw the shortcuts.']);
  if (place === total) return pick(['Participation trophy unlocked 🏆', 'You were enjoying the neon, right?', 'Last, but with style.']);
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
