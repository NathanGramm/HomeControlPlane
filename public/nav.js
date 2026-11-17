// Sidebar shared by every page. Dashboard sections are #hash routes on
// index.html; the quest board is its own page.
(() => {
  const LINKS = [
    ['overview', 'Overview', 'home', '/#overview'],
    ['system', 'System', 'server', '/#system'],
    ['minecraft', 'Minecraft', 'pickaxe', '/#minecraft'],
    ['pihole', 'Pi-hole', 'shield', '/#pihole'],
    ['jellyfin', 'Jellyfin', 'film', '/#jellyfin'],
    ['finance', 'Finance', 'wallet', '/#finance'],
    ['services', 'Services', 'link', '/#services'],
    ['quests', 'Quest board', 'swords', '/quests.html'],
  ];
  const nav = document.getElementById('sidebar');
  nav.innerHTML = `
    <a class="side-brand" href="/#overview"><span class="eyebrow">marshmallowmc</span><span class="side-title">Control Plane</span></a>
    ${LINKS.map(([id, label, icon, href]) => `<a class="side-link" data-nav="${id}" href="${href}"><span class="side-icon">${window.icon(icon)}</span>${label}</a>`).join('')}`;

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

  // On phones the bar scrolls sideways; the quest board is a separate page, so
  // carry the scroll position across page loads and keep the active tab visible.
  nav.scrollLeft = Number(sessionStorage.getItem('navScroll')) || 0;
  const active = nav.querySelector('.side-link.active');
  if (active && nav.scrollWidth > nav.clientWidth) {
    const a = active.getBoundingClientRect(), n = nav.getBoundingClientRect();
    if (a.left < n.left || a.right > n.right) nav.scrollLeft += a.left - n.left - (n.width - a.width) / 2;
  }
  nav.addEventListener('scroll', () => sessionStorage.setItem('navScroll', nav.scrollLeft), { passive: true });
})();
