import { initReveal, initProgress, initParallax, initSpotlight } from './motion.js';
import { startMarket } from './market.js';

const live = document.querySelector('[data-live]');

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn || btn.disabled) return;
  const value = btn.dataset.copy;
  if (!value) return;
  const ok = await copyText(value);
  const label = btn.querySelector('[data-copy-text]');
  btn.classList.add('is-copied');
  if (label) label.textContent = ok ? 'Copied' : 'Press Ctrl+C';
  if (live) live.textContent = ok ? 'Copied to clipboard' : 'Copy failed';
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('is-copied');
    if (label) label.textContent = 'Copy';
    if (live) live.textContent = '';
  }, 1600);
});

initReveal();
initProgress();
initParallax();
initSpotlight();
startMarket();
document.documentElement.classList.add('ready');
