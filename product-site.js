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
