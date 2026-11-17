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
  snowflake: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
