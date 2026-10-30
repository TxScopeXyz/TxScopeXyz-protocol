// Pure renderers: register records in, HTML strings out. Shared by build and gates.

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const find = (register, id) => register.records.find((r) => r.id === id);
export const isStated = (r) => r && r.state === 'stated';

// Official marks: X (24 grid) and GitHub Octicon mark-github-16.
const ICON = {
  x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
  github: '<svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>'
};
const COPY_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path fill="currentColor" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
export const icons = { ...ICON, copy: COPY_ICON };

const HOSTS = { x: ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'], github: ['github.com', 'www.github.com'] };

// Link rule: the URL is stored, the handle is derived from it.
export function handleOf(id, url) {
  const u = new URL(url);
  if (HOSTS[id] && !HOSTS[id].includes(u.hostname)) throw new Error(`${id}: host ${u.hostname} is not an expected host`);
  const seg = u.pathname.split('/').filter(Boolean);
  if (!seg.length) throw new Error(`${id}: url has no handle`);
  return id === 'x' ? '@' + seg[0] : seg.slice(0, 2).join('/');
}

export function validate(register) {
  for (const r of register.records) {
    if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) throw new Error(`${r.id}: bad state ${r.state}`);
    if (r.state !== 'stated' && ('value' in r || 'url' in r)) throw new Error(`${r.id}: inert record carries value or url`);
    if (r.state === 'stated' && !('value' in r) && !('url' in r)) throw new Error(`${r.id}: stated record has no value or url`);
  }
  const ca = find(register, 'ca');
  if (isStated(ca) && !ADDRESS.test(ca.value)) throw new Error('ca: value is not a full address');
}

export function renderSocial(register, id) {
  const r = find(register, id);
  const name = id === 'x' ? 'X' : 'GitHub';
  if (isStated(r)) {
    const handle = handleOf(id, r.url);
    return `<a class="social" data-rec="${id}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${name}, ${esc(handle)}">${ICON[id]}</a>`;
  }
  return `<span class="social is-inert" data-rec="${id}" role="img" aria-disabled="true" aria-label="${name}, pending">${ICON[id]}</span>`;
}

export function renderSocials(register) {
  return renderSocial(register, 'x') + renderSocial(register, 'github');
}

export function renderCA(register) {
  const r = find(register, 'ca');
  if (isStated(r)) {
    return `<div class="ca" data-rec="ca" data-state="stated"><div class="wrap ca-row">
  <span class="ca-label">Contract</span>
  <button class="ca-copy" type="button" data-copy="${esc(r.value)}" aria-label="Copy contract address"><code class="ca-addr">${esc(r.value)}</code><span class="ca-act">${COPY_ICON}<span class="ca-act-text" data-copy-text>Copy</span></span></button>
</div></div>`;
  }
  return `<div class="ca is-inert" data-rec="ca" data-state="absent"><div class="wrap ca-row">
  <span class="ca-label">Contract</span>
  <span class="ca-pending">pending</span>
</div></div>`;
}

export function renderRec(register, id) {
  const r = find(register, id);
  if (isStated(r)) {
    const host = new URL(r.url).hostname.replace(/^www\./, '');
    return `<li class="rec" data-rec="${id}"><a class="rec-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><span class="rec-label">${esc(r.label)}</span><span class="rec-state">${esc(host)}</span></a></li>`;
  }
  return `<li class="rec is-inert" data-rec="${id}"><span class="rec-label">${esc(r.label)}</span><span class="rec-state">pending</span></li>`;
}

export function renderTile(register, id) {
  const r = find(register, id);
  const v = isStated(r) ? esc(r.value) : 'pending';
  return `<div class="tile flow-tile${isStated(r) ? '' : ' is-inert'}" data-rec="${id}" data-spot data-reveal><span class="tile-label">${esc(r.label)}</span><span class="tile-val">${v}</span></div>`;
}

export function renderFlowBar(register) {
  const ids = ['split-burn', 'split-rewards', 'split-treasury', 'split-partners'];
  const seg = ids.map((id) => {
    const r = find(register, id);
    const n = isStated(r) ? parseFloat(r.value) : NaN;
    return `<i class="${Number.isFinite(n) ? '' : 'is-inert'}" style="flex:${Number.isFinite(n) ? n : 1} 1 0"></i>`;
  });
  return `<div class="flowbar" aria-hidden="true">${seg.join('')}</div>`;
}

const cell = (cls, label) => `<span class="${cls}" data-label="${label}"></span>`;
export function renderRows(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<li class="row" style="--i:${i}" data-slot="${i}" data-spot>
  <div class="row-skel" aria-hidden="true"><i class="sk sk-rank"></i><i class="sk sk-tile"></i><i class="sk sk-name"></i><i class="sk sk-cell"></i><i class="sk sk-cell"></i><i class="sk sk-cell"></i><i class="sk sk-cell"></i></div>
  <div class="row-data"><span class="c-rank"></span><div class="c-token"><span class="tile-img"></span><span class="c-names"><strong class="c-name"></strong><span class="c-sym"></span></span></div>${cell('c-price', 'Price')}${cell('c-chg', '24h')}${cell('c-vol', 'Volume')}${cell('c-liq', 'Depth')}<button class="icon-btn" type="button" data-copy="" aria-label="Copy pool address" disabled>${COPY_ICON}</button></div>
</li>`;
  }
  return out;
}

export function renderTickerSkeleton(n) {
  return Array.from({ length: n }, () => '<span class="tk tk-skel"><i class="sk"></i></span>').join('');
}
