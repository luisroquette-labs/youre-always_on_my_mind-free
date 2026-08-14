const header = document.querySelector('[data-header]');
const reveals = document.querySelectorAll('.reveal');

const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 18);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -30px' });
  reveals.forEach((element) => observer.observe(element));
} else {
  reveals.forEach((element) => element.classList.add('visible'));
}

document.querySelector('[data-copy-install]')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const command = document.querySelector('[data-install-command]')?.textContent?.trim();
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    const label = button.querySelector('span');
    if (label) label.textContent = 'Copied';
    window.setTimeout(() => { if (label) label.textContent = 'Copy commands'; }, 1800);
  } catch {
    const code = document.querySelector('[data-install-command]');
    if (code) window.getSelection()?.selectAllChildren(code);
  }
});

const year = document.querySelector('[data-year]');
if (year) year.textContent = String(new Date().getFullYear());

const memoryLab = document.querySelector('[data-memory-lab]');
const memoryTabs = [...document.querySelectorAll('[data-memory-view]')];
const memoryViews = {
  decision: {
    query: 'Why did we choose local-first memory?', type: 'DECISION', score: '94% MATCH',
    title: "Keep durable context on the user's machine.",
    summary: 'The dashboard binds to localhost; the compatible bridge remains the source of truth.',
    source: 'Architecture decision', relation: 'privacy → local bridge', quality: 'USEFUL', map: 'DECISION PATH',
  },
  relation: {
    query: 'Which projects share the same memory bridge?', type: 'RELATION', score: '3 PROJECTS',
    title: 'The cockpit, gateway and clients meet at one bridge.',
    summary: 'Shared files and decisions explain the connection without merging project boundaries.',
    source: 'Project relations', relation: '3 scoped projects', quality: 'EXPLAINED', map: 'RELATION MAP',
  },
  quality: {
    query: 'Which context should be reviewed next?', type: 'QUALITY', score: '82 / 100',
    title: 'One stale routing note needs human review.',
    summary: 'The cockpit can flag age and feedback signals; it never silently deletes the original memory.',
    source: 'Quality signal', relation: 'routing → provider', quality: 'REVIEW', map: 'QUALITY TRACE',
  },
};

const setMemoryView = (name, focus = false) => {
  const view = memoryViews[name];
  if (!memoryLab || !view) return;
  Object.entries({ query: view.query, type: view.type, score: view.score, title: view.title, summary: view.summary, source: view.source, relation: view.relation, quality: view.quality, map: view.map }).forEach(([key, value]) => {
    const target = memoryLab.querySelector(`[data-memory-${key}]`);
    if (target) target.textContent = value;
  });
  memoryTabs.forEach((tab) => {
    const active = tab.dataset.memoryView === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active) {
      memoryLab.querySelector('#memory-panel')?.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
    }
  });
};

memoryTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => setMemoryView(tab.dataset.memoryView));
  tab.addEventListener('keydown', (event) => {
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % memoryTabs.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + memoryTabs.length) % memoryTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = memoryTabs.length - 1;
    else return;
    event.preventDefault();
    setMemoryView(memoryTabs[next].dataset.memoryView, true);
  });
});

setMemoryView('decision');
