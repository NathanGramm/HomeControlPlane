// Monochrome line icons (24x24, drawn in currentColor) shared by every page.
// icon(name) returns inline SVG markup; it inherits the surrounding text color.
const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  pickaxe: '<path d="M8 5Q19 4 20 16"/><path d="M4 20l10.5-10.5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  wallet: '<path d="M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h11"/><path d="M16 13.5h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  swords: '<path d="M3 3l11 11M11 17l6-6M14 14l6 6"/><path d="M21 3L10 14M7 11l6 6M10 14l-6 6"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10a2.5 2 0 0 1 2.5-1.5c1.5 0 2.5.7 2.5 1.7s-1 1.4-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7a2.5 2 0 0 0 2.5-1.5"/>',
  flame: '<path d="M12 21c-3.9 0-7-2.7-7-6.5 0-3.4 2.4-5.3 3.5-8 1.5 1.5 2 3 2 4.5 1-1 2-3.5 1.5-7 3.5 2 7 5.5 7 10.5 0 3.8-3.1 6.5-7 6.5z"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  snowflake: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',

  // Achievement badges
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  'calendar-check': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15.5l2 2 4-4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 21L8 9l4-6 4 6z"/>',
  rainbow: '<path d="M2 18a10 10 0 0 1 20 0M6 18a6 6 0 0 1 12 0M10 18a2 2 0 0 1 4 0"/>',
  'plus-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-6c0-1.7-2.7-3-6-3"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8c-1.5-3.5-5-4-5-2s3 2 5 2c2 0 5 0 5-2s-3.5-1.5-5 2z"/>',
  tent: '<path d="M12 3L2 20h20z"/><path d="M9 20l3-6 3 6"/>',
  cake: '<path d="M4 13h16v8H4z"/><path d="M4 17c2 1 3-1 4 0s2 1 4 0 2-1 4 0 3 1 4 0"/><path d="M8 13v-3M12 13v-3M16 13v-3M8 6.5v.01M12 6.5v.01M16 6.5v.01"/>',
  backpack: '<path d="M6 9a6 6 0 0 1 12 0v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/><path d="M9 3h6M9 14h6v4H9z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sunrise: '<path d="M2 18h20M5 18a7 7 0 0 1 14 0M12 3v4M4.2 9.2l1.4 1.4M19.8 9.2l-1.4 1.4M6 22h12"/>',
  bandage: '<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10 12h.01M12 10h.01M14 12h.01M12 14h.01"/>',
  'heart-pulse': '<path d="M12 20s-8-4.5-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.5 12 20 12 20z"/><path d="M4 12.5h4l1.5-2.5 3 5 1.5-2.5h6"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',

  // Collectibles: server rack
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  'zip-tie': '<circle cx="10" cy="13" r="6"/><path d="M15 10l6-7M14 8.5l2.5 2.5"/>',
  screw: '<path d="M8 4h8l-1 3H9zM10 7v10l2 4 2-4V7M10 10l4 1.5M10 13l4 1.5"/>',
  tube: '<path d="M7 3h10l-1 13H8zM10 16h4v2l-1 3h-2l-1-3zM8 7h8"/>',
  duck: '<path d="M9.5 9.5A3.5 3.5 0 1 1 15 11.5l-.5.5H19c1 0 1.5.8 1.2 1.8C19 17.5 16 20 11 20c-4 0-7-2.5-7-6 0-1 .5-2 1.5-2.5"/><path d="M15.5 8H19l-2 1.8M12 8h.01"/>',
  ssd: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M7 18v2M11 18v2M15 18v2M7 10h6M7 13h4"/>',
  antenna: '<path d="M12 12v9"/><circle cx="12" cy="10" r="2"/><path d="M8 6.5a5 5 0 0 0 0 7M16 6.5a5 5 0 0 1 0 7M5 4a9 9 0 0 0 0 12M19 4a9 9 0 0 1 0 12"/>',
  stopwatch: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4M12 2v3"/>',

  // Collectibles: deep mine
  rock: '<path d="M4 15l3-7 6-3 6 4 1 7-5 4H8z"/><path d="M7 8l4 5 2-8M11 13l9 3M11 13l-3 7"/>',
  ore: '<path d="M4 15l3-7 6-3 6 4 1 7-5 4H8z"/><circle cx="10" cy="12" r="1.2"/><circle cx="14.5" cy="10" r="1"/><circle cx="13" cy="15.5" r="1.2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  crystal: '<path d="M12 2l4 5v10l-4 5-4-5V7zM8 7h8M12 2v20"/>',
  cluster: '<path d="M4 21l2-9 3 3v6M9 21V9l3-6 3 6v12M15 21v-6l3-3 2 9M3 21h18"/>',
  ruby: '<path d="M12 3l7 6-7 12-7-12z"/><path d="M5 9h14M9.5 9L12 21l2.5-12L12 3"/>',
  comet: '<circle cx="15" cy="15" r="4"/><path d="M12.2 12.2L4 4M12 14.5L6 11M14.5 12L11 6"/>',
  sparkle: '<path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/>',

  // Collectibles: kitchen
  garlic: '<path d="M12 3c0 3-1.5 3.5-4 5.5S4 13 5 16.5 9 21 12 21s6-1 7-4.5-1.5-6-4-8S12 6 12 3z"/><path d="M12 9c-1.5 2.5-2 6-1 12M12 9c1.5 2.5 2 6 1 12"/>',
  chili: '<path d="M18 7c1.5 3 0 7-4 10s-8 4-10 3c3-1 6-3 8-6s3-6 6-7zM18 7c0-2 1-3.5 3-4"/>',
  spoon: '<ellipse cx="15.5" cy="8.5" rx="3.5" ry="5" transform="rotate(45 15.5 8.5)"/><path d="M13 11L4 20"/>',
  pan: '<circle cx="10" cy="12" r="7"/><circle cx="10" cy="12" r="3"/><path d="M17 12h5"/>',
  bread: '<path d="M5 11a4 4 0 0 1 1-8h12a4 4 0 0 1 1 8v9H5z"/><path d="M9 7l2 2M13 7l2 2"/>',
  leaf: '<path d="M12 21v-9M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 15c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z"/>',
  mushroom: '<path d="M3 12a9 8 0 0 1 18 0zM9 12v6a3 3 0 0 0 6 0v-6M8 8h.01M15 7h.01M12 9.5h.01"/>',
  scroll: '<path d="M7 3h11a2 2 0 0 1 2 2v1h-4M16 5v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1h11M7 3a2 2 0 0 0-2 2v13M9 8h4M9 12h4"/>',

  // Collectibles: dojo
  brick: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M3 12h18M9 7v5M15 12v5"/>',
  'jump-rope': '<rect x="3.5" y="2" width="3" height="7" rx="1.5"/><rect x="17.5" y="2" width="3" height="7" rx="1.5"/><path d="M5 9c0 8 4 12 7 12s7-4 7-12"/>',
  band: '<ellipse cx="12" cy="12" rx="8" ry="6"/><ellipse cx="12" cy="12" rx="5" ry="3.5"/>',
  mat: '<circle cx="7" cy="14" r="4"/><circle cx="7" cy="14" r="1.5"/><path d="M7 10h13v8H7"/>',
  'pullup-bar': '<path d="M2 5h20M5 3v4M19 3v4M8 5l2 4M16 5l-2 4M12 13v5l-2 3M12 18l2 3"/><circle cx="12" cy="11" r="2"/>',
  rings: '<path d="M8 2v9M16 2v9"/><circle cx="8" cy="15.5" r="4"/><circle cx="16" cy="15.5" r="4"/>',
  belt: '<path d="M2 10h20v4H2zM10 9h4v6h-4zM10.5 15l-2 6M13.5 15l2 6"/>',
  kettlebell: '<path d="M9 9V7a3 3 0 0 1 6 0v2M8 9h8a5 5 0 0 1 1.5 9.8L16 21H8l-1.5-2.2A5 5 0 0 1 8 9z"/>',

  // Collectibles: cinema
  popcorn: '<path d="M5 9l2 12h10l2-12zM10 9l.5 12M14 9l-.5 12M5 9a2.5 2.5 0 0 1 2-4 3 3 0 0 1 5-1.5A3 3 0 0 1 17 5a2.5 2.5 0 0 1 2 4"/>',
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M7 9a6 6 0 0 1 3-3"/>',
  tv: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M8 2l4 4 4-4M8 22h8"/>',
  'film-reel': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="7" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="12" r="2"/>',
  'box-set': '<rect x="6" y="3" width="14" height="16" rx="1"/><path d="M4 6v15h13"/><circle cx="13" cy="11" r="3"/>',
  clapper: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M3 9l1.5-5 16 3.5L21 9M8.5 5l-1 4M13.5 6l-1 3"/>',
  projector: '<rect x="2" y="10" width="15" height="9" rx="2"/><circle cx="7" cy="6" r="3"/><circle cx="13" cy="6" r="3"/><path d="M17 13l5-2v7l-5-2"/>',

  // Collectibles: legendary relics
  feather: '<path d="M20 4C12 4 6 9 6 17v3M20 4c0 8-5 13-13 13M6 17l5-5M10 13h4"/>',
  mug: '<path d="M4 8h12v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM16 10h2a2.5 2.5 0 0 1 0 5h-2M8 2.5c0 1.5 1 1.5 1 3M12 2.5c0 1.5 1 1.5 1 3"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5zM5 19h14"/>',
  egg: '<path d="M12 3c3.5 0 7 5.5 7 10.5A7 7 0 0 1 5 13.5C5 8.5 8.5 3 12 3z"/><path d="M8 13l2 1.5 2-2 2 2 2-1.5"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.help}</svg>`;
}

if (typeof module !== 'undefined') module.exports = { ICONS };
