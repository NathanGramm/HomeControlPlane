// Sidebar shared by every page. Dashboard sections are #hash routes on
// index.html; the quest board is its own page.
(() => {
  const LINKS = [
    ['overview', 'Overview', '🏠', '/#overview'],
    ['system', 'System', '🖥️', '/#system'],
    ['minecraft', 'Minecraft', '⛏️', '/#minecraft'],
    ['pihole', 'Pi-hole', '🛡️', '/#pihole'],
    ['jellyfin', 'Jellyfin', '🎬', '/#jellyfin'],
    ['finance', 'Finance', '💰', '/#finance'],
    ['services', 'Services', '🔗', '/#services'],
    ['quests', 'Quest board', '⚔️', '/quests.html'],
  ];
  const nav = document.getElementById('sidebar');
  nav.innerHTML = `
    <a class="side-brand" href="/#overview"><span class="eyebrow">marshmallowmc</span><span class="side-title">Control Plane</span></a>
    ${LINKS.map(([id, label, icon, href]) => `<a class="side-link" data-nav="${id}" href="${href}"><span class="side-icon" aria-hidden="true">${icon}</span>${label}</a>`).join('')}`;

  function markActive() {
    const current = location.pathname.endsWith('quests.html') ? 'quests' : (location.hash.slice(1) || 'overview');
    for (const a of nav.querySelectorAll('.side-link')) {
      const on = a.dataset.nav === current;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
  window.addEventListener('hashchange', markActive);
  markActive();
})();
