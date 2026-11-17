// Catalogues (achievements, collectibles) and the starter board. Edit freely:
// achievements and items are looked up by id, so renaming text is safe, but
// changing an id orphans anything already earned under the old one.

// --- collectibles: 5 themed sets of 8, plus 5 legendary relics ---

const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 11, epic: 3.5, legendary: 0.5 };

const SETS = [
  { id: 'rack', name: 'Server rack', items: [
    ['patch-cable', 'Patch cable', 'plug', 'common'], ['zip-tie', 'Zip tie', 'zip-tie', 'common'],
    ['rack-screw', 'Rack screw', 'screw', 'common'], ['thermal-paste', 'Thermal paste', 'tube', 'common'],
    ['rubber-duck', 'Debugging duck', 'duck', 'uncommon'], ['spare-ssd', 'Spare SSD', 'ssd', 'uncommon'],
    ['golden-sfp', 'Golden SFP module', 'antenna', 'rare'], ['uptime-counter', 'Ten-year uptime counter', 'stopwatch', 'epic'],
  ] },
  { id: 'mine', name: 'Deep mine', items: [
    ['coal', 'Coal lump', 'rock', 'common'], ['copper', 'Copper ore', 'ore', 'common'],
    ['iron', 'Iron nugget', 'gear', 'common'], ['quartz', 'Quartz shard', 'crystal', 'common'],
    ['amethyst', 'Amethyst cluster', 'cluster', 'uncommon'], ['ruby', 'Ruby', 'ruby', 'uncommon'],
    ['meteorite', 'Meteorite fragment', 'comet', 'rare'], ['star-core', 'Star core', 'sparkle', 'epic'],
  ] },
  { id: 'kitchen', name: 'Kitchen', items: [
    ['garlic', 'Garlic clove', 'garlic', 'common'], ['chili', 'Chili pepper', 'chili', 'common'],
    ['wooden-spoon', 'Wooden spoon', 'spoon', 'common'], ['cast-iron', 'Cast iron pan', 'pan', 'common'],
    ['sourdough', 'Sourdough starter', 'bread', 'uncommon'], ['saffron', 'Saffron thread', 'leaf', 'uncommon'],
    ['truffle', 'Black truffle', 'mushroom', 'rare'], ['recipe-card', "Grandma's recipe card", 'scroll', 'epic'],
  ] },
  { id: 'dojo', name: 'Dojo', items: [
    ['chalk', 'Chalk block', 'brick', 'common'], ['jump-rope', 'Jump rope', 'jump-rope', 'common'],
    ['band', 'Resistance band', 'band', 'common'], ['mat', 'Yoga mat', 'mat', 'common'],
    ['pullup-bar', 'Pull-up bar', 'pullup-bar', 'uncommon'], ['rings', 'Gymnastics rings', 'rings', 'uncommon'],
    ['black-belt', 'Black belt', 'belt', 'rare'], ['golden-kettlebell', 'Golden kettlebell', 'kettlebell', 'epic'],
  ] },
  { id: 'cinema', name: 'Cinema', items: [
    ['popcorn', 'Popcorn', 'popcorn', 'common'], ['ticket', 'Ticket stub', 'ticket', 'common'],
    ['blank-dvd', 'Blank DVD', 'disc', 'common'], ['remote', 'Remote control', 'tv', 'common'],
    ['film-reel', 'Film reel', 'film-reel', 'uncommon'], ['bluray', 'Blu-ray box set', 'box-set', 'uncommon'],
    ['directors-chair', "Director's chair", 'clapper', 'rare'], ['projector', 'Vintage projector', 'projector', 'epic'],
  ] },
  { id: 'relics', name: 'Legendary relics', items: [
    ['phoenix-feather', 'Phoenix feather', 'feather', 'legendary'], ['infinite-mug', 'Bottomless coffee mug', 'mug', 'legendary'],
    ['ancient-keyboard', 'Ancient mechanical keyboard', 'keyboard', 'legendary'], ['crown', 'Crown of consistency', 'crown', 'legendary'],
    ['dragon-egg', 'Dragon egg', 'egg', 'legendary'],
  ] },
];

const ITEMS = SETS.flatMap((set) =>
  set.items.map(([id, name, icon, rarity]) => ({ id, name, icon, rarity, set: set.id })));

// --- achievements ---

function metric(state, ctx, stat) {
  const p = state.player;
  switch (stat) {
    case 'level': return require('./engine').levelInfo(p.xp).level;
    case 'bestStreak': return p.bestStreak;
    case 'gold': return p.gold;
    case 'uniqueItems': return Object.keys(state.collection).length;
    case 'daysSinceStart': return Math.round((Date.parse(ctx.today) - Date.parse(p.startedDay)) / 86400000);
    default: return state.stats[stat] || 0;
  }
}

const tiers = (key, icon, stat, desc, list, extra = {}) =>
  list.map(([goal, name]) => ({ id: `${key}-${goal}`, name, icon, stat, goal, desc: desc(goal), ...extra }));

const n = (x) => x.toLocaleString('en-US');

const ACHIEVEMENTS = [
  ...tiers('tasks', 'check-circle', 'tasksDone', (g) => `Complete ${n(g)} dailies and to-dos`, [
    [1, 'First step'], [10, 'Warming up'], [50, 'Momentum'], [100, 'Centurion'], [250, 'Grinder'],
    [500, 'Machine'], [1000, 'Thousand-task titan'], [2500, 'Relentless'], [5000, 'Unstoppable'], [10000, 'Mythic doer'],
  ]),
  ...tiers('streak', 'flame', 'bestStreak', (g) => `Reach a ${n(g)}-day streak`, [
    [3, 'Spark'], [7, 'Week warrior'], [14, 'Fortnight'], [30, 'Monthly devotion'], [60, 'Two-month tenacity'],
    [100, 'Triple digits'], [180, 'Half-year hero'], [365, 'Year of fire'], [730, 'Two-year flame'], [1000, 'Eternal flame'],
  ]),
  ...tiers('level', 'star', 'level', (g) => `Reach level ${g}`, [
    [5, 'Apprentice'], [10, 'Journeyman'], [20, 'Adept'], [30, 'Veteran'], [50, 'Master'], [75, 'Grandmaster'], [100, 'Legend'],
  ]),
  ...tiers('dailies', 'calendar-check', 'dailiesDone', (g) => `Complete ${n(g)} dailies`, [
    [25, 'Routine rookie'], [100, 'Creature of habit'], [500, 'Clockwork'], [1000, 'Ritualist'],
    [2500, 'Unbreakable routine'], [5000, 'Living metronome'],
  ]),
  ...tiers('perfect', 'gem', 'perfectDays', (g) => `Finish every due daily on ${n(g)} days`, [
    [1, 'Flawless'], [10, 'Clean sweep'], [50, 'Perfectionist'], [100, 'Hundred perfect days'], [365, 'Year of perfection'],
  ]),
  ...tiers('perfect-run', 'rainbow', 'bestPerfectRun', (g) => `${g} perfect days in a row`, [
    [7, 'Perfect week'], [30, 'Perfect month'], [100, 'Perfect season'],
  ]),
  ...tiers('habits', 'plus-circle', 'habitUps', (g) => `Tap a good habit ${n(g)} times`, [
    [10, 'Good vibes'], [100, 'Habit builder'], [500, 'Second nature'], [1000, 'Habit forged'], [5000, 'Rewired'],
  ]),
  ...tiers('quests', 'map', 'questsDone', (g) => `Finish ${g} quest line${g > 1 ? 's' : ''}`, [
    [1, 'Quest complete'], [3, 'Adventurer'], [5, 'Hero of the homelab'], [10, 'Saga'], [25, 'Epic cycle'], [50, 'Living legend'],
  ]),
  ...tiers('gold', 'coin', 'goldEarned', (g) => `Earn ${n(g)} gold in total`, [
    [500, 'Pocket money'], [2500, 'Coin purse'], [10000, 'Treasure chest'], [50000, 'Dragon hoard'], [100000, 'Midas touch'],
  ]),
  ...tiers('rewards', 'gift', 'rewardsBought', (g) => `Redeem ${g} reward${g > 1 ? 's' : ''}`, [
    [1, 'Treat yourself'], [10, 'Earned it'], [50, 'Connoisseur'], [100, 'Living well'],
  ]),
  ...tiers('active', 'calendar', 'activeDays', (g) => `Be active on ${n(g)} different days`, [
    [30, 'Regular'], [100, 'Hundred days'], [365, 'A year in the game'], [730, 'Two years strong'], [1825, 'Five-year veteran'],
  ]),
  ...tiers('weekends', 'tent', 'fullWeekends', (g) => `Get things done on both days of ${g} weekends`, [
    [4, 'Weekend warrior'], [26, 'Never off'], [52, 'Year of weekends'],
  ]),
  ...tiers('anniversary', 'cake', 'daysSinceStart', (g) => `Keep the board going for ${g / 365} year${g > 365 ? 's' : ''}`, [
    [365, 'First anniversary'], [1095, 'Three-year veteran'], [1825, 'Five-year legend'],
  ]),
  ...tiers('items', 'backpack', 'uniqueItems', (g) => `Collect ${g} different items`, [
    [1, 'Finders keepers'], [10, 'Collector'], [25, 'Curator'], [ITEMS.length, 'Completionist'],
  ]),
  ...tiers('hoard', 'coins', 'gold', (g) => `Hold ${n(g)} gold at once`, [[1000, 'Saver'], [5000, 'Tycoon']]),
  ...SETS.map((set) => ({
    id: `set-${set.id}`, name: `${set.name} complete`, icon: set.items[set.items.length - 1][2],
    desc: `Collect every item in the ${set.name.toLowerCase()} set`,
    test: (s) => set.items.every(([id]) => s.collection[id]),
  })),
  ...tiers('night', 'moon', 'nightOwl', () => 'Complete something between midnight and 4am', [[1, 'Night owl']], { secret: true }),
  ...tiers('early', 'sunrise', 'earlyBird', () => 'Complete something between 4am and 6am', [[1, 'Early bird']], { secret: true }),
  ...tiers('clutch', 'bandage', 'clutch', () => 'Complete something with 10 HP or less', [[1, 'Clutch']], { secret: true }),
  ...tiers('comeback', 'heart-pulse', 'comebacks', () => 'Get back to work after fainting', [[1, 'Back from the brink']], { secret: true }),
  {
    id: 'inbox-zero', name: 'Inbox zero', icon: 'inbox', secret: true,
    desc: 'Clear every to-do on the board (at least 5)',
    test: (s) => s.todos.length >= 5 && s.todos.every((t) => t.done),
  },
];

for (const a of ACHIEVEMENTS) {
  if (!a.test) a.test = (s, ctx) => metric(s, ctx, a.stat) >= a.goal;
}

// --- starter board ---

const STRETCH_NOTE = 'Move slowly and breathe. Mild stretch is fine; sharp or pinching pain means stop.';

function seedState(today) {
  const daily = (id, title, difficulty, days, checklist, notes = '') =>
    ({ id, title, notes, difficulty, days, checklist: checklist.map((text) => ({ text, done: false })), done: false, streak: 0, award: null });
  const todo = (questId, id, title, difficulty, notes = '') =>
    ({ id, questId, title, notes, difficulty, checklist: [], done: false, doneAt: null, award: null });
  const habit = (id, title, difficulty, up, down, notes = '') => ({ id, title, notes, difficulty, up, down, ups: 0, downs: 0 });
  const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

  return {
    version: 1,
    player: { xp: 0, gold: 0, hp: 50, streak: 0, bestStreak: 0, lastActiveDay: null, freezes: 1, lastCronDay: null, startedDay: today, fainted: false },
    stats: {},
    history: {},
    achievements: {},
    collection: {},
    habits: [
      habit('water', 'Drink a glass of water', 'trivial', true, false),
      habit('stand', 'Get up and move for 2+ minutes', 'trivial', true, false, 'Every hour or so at the desk.'),
      habit('read', 'Read 10 pages', 'easy', true, false),
      habit('protein', 'Eat a proper meal with protein', 'easy', true, false),
      habit('lab', 'Work on a sysadmin lab', 'medium', true, false),
      habit('doomscroll', 'Doomscrolled 30+ minutes', 'easy', false, true),
      habit('junk', 'Energy drink or junk food', 'easy', false, true),
      habit('late', 'Up past midnight on a work night', 'medium', false, true),
    ],
    dailies: [
      daily('morning-mobility', 'Morning mobility (10 min)', 'easy', EVERY_DAY, [
        'Cat-cow, 10 slow reps',
        "World's greatest stretch, 5 per side",
        'Deep squat hold, 60 s (hold something if needed)',
        'Half-kneeling hip flexor stretch, 45 s per side (squeeze the back glute)',
        'Thoracic open books, 8 per side',
        'Arm circles, 30 s forward and 30 s back',
      ], STRETCH_NOTE),
      daily('evening-stretch', 'Evening stretch (10 min)', 'easy', EVERY_DAY, [
        'Standing hamstring fold, 60 s (soft knees)',
        'Figure-4 glute stretch on your back, 45 s per side',
        'Pigeon pose (or figure-4), 60 s per side',
        'Doorway chest stretch, 2 x 30 s',
        'Neck side stretch, 30 s per side',
        "Child's pose, 60 s",
      ], STRETCH_NOTE),
      daily('walk', 'Walk 20+ minutes', 'easy', EVERY_DAY, []),
      daily('calisthenics', 'Calisthenics: full body', 'hard', [1, 3, 5], [
        'Warm-up: 2 min jumping jacks, 10 arm swings, 10 bodyweight squats',
        'Push-ups: 3 sets, 2 short of failure (knees or incline if needed)',
        'Rows (table or bar): 3 x 8-12',
        'Squats: 3 x 15 (add a pause at the bottom when easy)',
        'Pike push-ups: 3 x 6-10',
        'Plank: 3 x 30-45 s',
        'Dead hang (if you have a bar): 3 x 20-30 s',
      ], 'Rest 60-90 s between sets. When every set hits the top of its range, make it harder next time.'),
      daily('core-balance', 'Core and balance', 'medium', [2, 4], [
        'Dead bug: 3 x 10',
        'Side plank: 3 x 20 s per side',
        'Glute bridge: 3 x 15',
        'Bird dog: 3 x 8 per side',
        'Single-leg balance: 30 s per side',
      ]),
      daily('homelab-check', 'Check the dashboard', 'trivial', EVERY_DAY, [
        'Vitals look normal (RAM headroom)',
        'Minecraft servers are in the state you expect',
      ]),
      daily('one-task', 'Finish one quest step', 'medium', [1, 2, 3, 4, 5], [], 'Pick anything from the Quests column. Small counts.'),
      daily('finance', 'Import bank statements into Firefly', 'medium', [6], [
        'Download CSV/OFX from the bank',
        'Upload it in the Firefly Importer',
        'Categorize anything new',
      ]),
      daily('weekly-review', 'Weekly review', 'medium', [0], [
        'Look back: what got done this week?',
        'Pick 3 quest steps for next week',
        'Update Portainer stacks that have new images',
        'Check backups ran',
      ]),
    ],
    quests: [
      { id: 'cleanup', title: 'Homelab cleanup', notes: 'Loose ends from the stack migration.', completedAt: null, award: null },
      { id: 'backups', title: 'Minecraft backups you can trust', notes: 'The in-mod backups stopped silently. Replace them with something outside the mod that you can see.', completedAt: null, award: null },
      { id: 'gtnh-29', title: 'Upgrade GTNH to 2.9.0', notes: 'The compose changes are already prepped in stacks/minecraft.', completedAt: null, award: null },
      { id: 'ram', title: 'RAM upgrade', notes: 'GTNH running puts the host at 10 of 11.6 GB.', completedAt: null, award: null },
      { id: 'pihole-tile', title: 'Phase 5: Pi-hole stats tile', notes: '', completedAt: null, award: null },
      { id: 'calisthenics-tracker', title: 'Phase 6: Calisthenics tracker', notes: 'Routine builder, then session logging, then a feedback engine.', completedAt: null, award: null },
    ],
    todos: [
      todo('cleanup', 'delete-homepage', 'Delete the homepage stack and ~/docker/homepage', 'easy'),
      todo('cleanup', 'delete-dumps', 'Delete ~/stacks-dump.txt and ~/homepage-dump.txt', 'trivial', 'They contain secrets.'),
      todo('cleanup', 'gitops', 'Turn on GitOps updates for each stack (not minecraft)', 'easy'),
      todo('cleanup', 'paper-branch', 'Decide on the family-server-paper-security branch: merge or close', 'medium'),
      todo('cleanup', 'family-unhealthy', 'Find out why family-minecraft reports unhealthy', 'medium'),
      todo('backups', 'why-stopped', 'Find out why the GTNH in-mod backups stopped', 'medium'),
      todo('backups', 'pick-tool', 'Pick a backup tool (restic or borg) and a target disk', 'easy'),
      todo('backups', 'nightly', 'Set up a nightly backup of ~/GTNHServer and ~/FamilyServer', 'hard'),
      todo('backups', 'restore-test', 'Restore a backup to a scratch folder and check the world opens', 'hard'),
      todo('backups', 'backup-tile', 'Show last backup time on the dashboard', 'medium'),
      todo('gtnh-29', 'gtnh-backup', 'Take a full backup of ~/GTNHServer', 'easy'),
      todo('gtnh-29', 'gtnh-jar', 'Check CUSTOM_SERVER matches the jar name in the 2.9.0 zip', 'easy'),
      todo('gtnh-29', 'gtnh-boot', 'First boot on 2.9.0 and watch for registry prompts', 'hard', 'Do NOT confirm a missing-registry prompt. It deletes blocks from the world.'),
      todo('gtnh-29', 'gtnh-flag', 'Re-add -Dfml.queryResult=confirm once the world loads cleanly', 'easy'),
      todo('ram', 'ram-max', 'Look up the motherboard\'s max RAM and free slots', 'easy'),
      todo('ram', 'ram-buy', 'Buy matching RAM', 'medium'),
      todo('ram', 'ram-install', 'Install it and check the host sees all of it', 'medium'),
      todo('ram', 'ram-lift', 'Remove the one-Minecraft-server-at-a-time check', 'easy', 'Delete findRunningOtherServer and its two callers in server/routes/minecraft.js.'),
      todo('pihole-tile', 'pihole-pass', 'Create a Pi-hole app password for the dashboard', 'easy'),
      todo('pihole-tile', 'pihole-route', 'Add a /api/pihole route that reads its stats', 'medium'),
      todo('pihole-tile', 'pihole-ui', 'Show queries, block rate and top blocked domains', 'medium'),
      todo('calisthenics-tracker', 'cal-routines', 'Routine builder', 'hard'),
      todo('calisthenics-tracker', 'cal-log', 'Session logging', 'hard'),
      todo('calisthenics-tracker', 'cal-feedback', 'Feedback engine that adjusts routines', 'hard'),
    ],
    rewards: [
      { id: 'gtnh', title: 'GTNH session (2 hours)', cost: 100 },
      { id: 'family-night', title: 'Family server night', cost: 60 },
      { id: 'movie', title: 'Movie night', cost: 80 },
      { id: 'lazy-morning', title: 'Lazy morning, no alarm', cost: 150 },
      { id: 'takeout', title: 'Takeout dinner', cost: 250 },
      { id: 'game', title: 'Buy a new game', cost: 1000 },
      { id: 'homelab-part', title: 'Buy a homelab upgrade', cost: 1500 },
    ],
  };
}

module.exports = { ACHIEVEMENTS, ITEMS, SETS, RARITY_WEIGHTS, metric, seedState };
