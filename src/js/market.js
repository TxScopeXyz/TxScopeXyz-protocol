// Live market. Driven only by the market-source register record.
import { register } from './register.js';
import { setNumber } from './motion.js';

const rec = register.records.find((r) => r.id === 'market-source');
const { api, secondary, fallback, networkId, networkPages, slugTtlMs, pools: TOP, pollMs } = rec.value;
const SLUG_KEY = 'txscope.slug';
const HEADERS = { accept: 'application/json' };
const TIMEOUT = 12000;
const BACKOFF_BASE = 2000;

const $ = (s, r = document) => r.querySelector(s);
const rowsEl = $('[data-rows]');
const slots = [...rowsEl.querySelectorAll('.row')];
const tickerEl = $('[data-ticker]');
const statusEl = $('[data-status]');
const statusText = $('[data-status-text]');
const errorEl = $('[data-error]');

let slug = null;
let timer = 0;
let fails = 0;
let inflight = false;
let pools = [];
let sortKey = 'trend';

async function getJSON(url) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctl.signal });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

// Runtime slug discovery: walk the network list until the register's network id turns up.
// Epoch ms without a date API (nothing date-like is ever displayed).
const clock = () => Math.round(performance.timeOrigin + performance.now());

function cachedSlug() {
  try {
    const c = JSON.parse(localStorage.getItem(SLUG_KEY));
    if (c && c.id === networkId && clock() - c.at < slugTtlMs) return c.id;
  } catch {
    /* storage unavailable: scan instead */
  }
  return null;
}

function rememberSlug(id) {
  try {
    localStorage.setItem(SLUG_KEY, JSON.stringify({ id, at: clock() }));
  } catch {
    /* ignore */
  }
}

async function discoverSlug() {
  if (slug) return slug;
  slug = cachedSlug();
  if (slug) return slug;
  for (let p = 1; p <= networkPages; p++) {
    const json = await getJSON(`${api}/networks?page=${p}`);
    if (!json || !Array.isArray(json.data)) throw new Error('no data');
    const hit = json.data.find((n) => n.id === networkId);
    if (hit) {
      rememberSlug(hit.id);
      return (slug = hit.id);
    }
    if (!json.data.length) break;
  }
  throw new Error('network not listed');
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Only https image URLs are ever handed to the browser.
const safeImage = (u) => {
  try {
    return u && new URL(u).protocol === 'https:' && !/missing/.test(u) ? u : null;
  } catch {
    return null;
  }
};

function normalize(json) {
  if (!json || !Array.isArray(json.data)) throw new Error('no data');
  const inc = new Map((json.included || []).map((i) => [i.id, i.attributes]));
  return json.data.slice(0, TOP).map((p) => {
    const a = p.attributes;
    const base = inc.get(p.relationships?.base_token?.data?.id) || {};
    return {
      key: a.address,
      addr: a.address,
      name: a.name,
      symbol: base.symbol || String(a.name).split(' / ')[0],
      image: safeImage(base.image_url),
      price: num(a.base_token_price_usd),
      chg: num(a.price_change_percentage && a.price_change_percentage.h24),
      vol: num(a.volume_usd && a.volume_usd.h24),
      liq: num(a.reserve_in_usd)
    };
  });
}

// Secondary feed: DexScreener search, kept to this network's pairs and ranked by 24h volume.
function normalizeSecondary(json) {
  if (!json || !Array.isArray(json.pairs)) throw new Error('no data');
  return json.pairs
    .filter((p) => p.chainId === networkId && p.pairAddress)
    .sort((a, b) => (num(b.volume && b.volume.h24) ?? -1) - (num(a.volume && a.volume.h24) ?? -1))
    .slice(0, TOP)
    .map((p) => ({
      key: p.pairAddress,
      addr: p.pairAddress,
      name: (p.baseToken && p.baseToken.name) || '',
      symbol: (p.baseToken && p.baseToken.symbol) || '?',
      image: safeImage(p.info && p.info.imageUrl),
      price: num(p.priceUsd),
      chg: num(p.priceChange && p.priceChange.h24),
      vol: num(p.volume && p.volume.h24),
      liq: num(p.liquidity && p.liquidity.usd)
    }));
}

// Last resort: plain coin list, so there is no pool address and no depth figure.
function normalizeFallback(list) {
  if (!Array.isArray(list)) throw new Error('no data');
  return list.slice(0, TOP).map((c) => ({
    key: c.id,
    addr: null,
    name: c.name,
    symbol: String(c.symbol || c.name).toUpperCase(),
    image: safeImage(c.image),
    price: num(c.current_price),
    chg: num(c.price_change_percentage_24h),
    vol: num(c.total_volume),
    liq: null
  }));
}

/* formatting */
const dash = '—';
const usd = (v) => {
  if (v === null || v === undefined) return dash;
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
};
const price = (v) => {
  if (v === null || v === undefined) return dash;
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(3);
  if (v === 0) return '$0';
  const lead = -Math.floor(Math.log10(v));
  return '$' + v.toFixed(Math.min(12, lead + 3));
};
const pct = (v) => (v === null || v === undefined ? dash : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');

/* status + errors */
function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusText.textContent = text;
}

/* rows */
const order = {
  trend: (a, b) => a._i - b._i,
  vol: (a, b) => (b.vol ?? -1) - (a.vol ?? -1),
  liq: (a, b) => (b.liq ?? -1) - (a.liq ?? -1),
  chg: (a, b) => (b.chg ?? -Infinity) - (a.chg ?? -Infinity)
};

function tileFor(el, p) {
  el.textContent = '';
  el.removeAttribute('data-hue');
  const letter = (p.symbol || '?').trim().charAt(0).toUpperCase() || '?';
  el.dataset.hue = String([...p.symbol].reduce((h, c) => h + c.charCodeAt(0), 0) % 5);
  const span = document.createElement('span');
  span.textContent = letter;
  el.append(span);
  if (p.image) {
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove());
    img.src = p.image;
    el.append(img);
  }
}

function paintChg(el, v) {
  el.classList.toggle('up', v !== null && v >= 0);
  el.classList.toggle('down', v !== null && v < 0);
  if (v === null) {
    el.textContent = dash;
    el._n = null;
    return;
  }
  const arrow = v >= 0 ? '▲' : '▼';
  setNumber(el, v, (x) => `${arrow} ${pct(x)}`);
}

function paintRow(slot, p, rank) {
  const d = slot.querySelector('.row-data');
  const same = slot.dataset.addr === p.key;
  slot.dataset.addr = p.key;
  slot.classList.remove('is-gone', 'is-failed');
  if (!same) {
    // different pool in this slot: reset counters so nothing flashes or counts from a stranger
    for (const c of ['.c-price', '.c-chg', '.c-vol', '.c-liq']) d.querySelector(c)._n = undefined;
    tileFor(d.querySelector('.tile-img'), p);
    d.querySelector('.c-name').textContent = p.name;
    d.querySelector('.c-sym').textContent = p.symbol;
  }
  d.querySelector('.c-rank').textContent = String(rank);
  setNumber(d.querySelector('.c-price'), p.price, price);
  paintChg(d.querySelector('.c-chg'), p.chg);
  setNumber(d.querySelector('.c-vol'), p.vol, usd);
  setNumber(d.querySelector('.c-liq'), p.liq, usd);
  const btn = d.querySelector('.icon-btn');
  btn.dataset.copy = p.addr || '';
  btn.disabled = !p.addr;
  btn.setAttribute('aria-label', p.addr ? `Copy pool address for ${p.name}` : `No pool address for ${p.name}`);
  slot.classList.add('is-loaded');
}

function paintRows() {
  const list = pools.map((p, i) => ({ ...p, _i: i })).sort(order[sortKey]);
  slots.forEach((slot, i) => {
    const p = list[i];
    if (!p) {
      slot.classList.add('is-gone');
      return;
    }
    paintRow(slot, p, i + 1);
  });
}

function paintFailed() {
  for (const slot of slots) {
    slot.classList.add('is-failed');
    const d = slot.querySelector('.row-data');
    d.querySelector('.c-rank').textContent = dash;
    d.querySelector('.c-name').textContent = dash;
    d.querySelector('.c-sym').textContent = '';
    d.querySelector('.tile-img').textContent = '';
    for (const c of ['.c-price', '.c-chg', '.c-vol', '.c-liq']) d.querySelector(c).textContent = dash;
  }
  for (const s of document.querySelectorAll('[data-stat]')) s.textContent = dash;
}

/* stat tiles */
function paintStats() {
  const sum = (k) => pools.reduce((a, p) => a + (p[k] || 0), 0);
  const set = (k, v, f) => {
    const el = $(`[data-stat="${k}"]`);
    if (el.querySelector('.sk')) el.textContent = '';
    setNumber(el, v, f);
  };
  set('count', pools.length, (v) => String(Math.round(v)));
  set('vol', sum('vol'), usd);
  set('liq', sum('liq'), usd);
  const best = pools.filter((p) => p.chg !== null).sort((a, b) => b.chg - a.chg)[0];
  const el = $('[data-stat="mover"]');
  if (best) {
    if (el.querySelector('.sk')) el.textContent = '';
    if (!el._lab) {
      el.textContent = '';
      el._lab = document.createElement('span');
      el._val = document.createElement('span');
      el._small = document.createElement('small');
      el.append(el._val, el._small);
    }
    el._small.textContent = best.symbol;
    setNumber(el._val, best.chg, pct);
  } else {
    el.textContent = dash;
  }
}

/* ticker: same data, built twice for a seamless loop */
function paintTicker() {
  const key = pools.map((p) => p.key).join();
  if (tickerEl._key !== key) {
    tickerEl._key = key;
    tickerEl.textContent = '';
    for (let copy = 0; copy < 2; copy++) {
      for (const p of pools) {
        const t = document.createElement('span');
        t.className = 'tk';
        t.dataset.addr = p.key;
        t.innerHTML = '<b></b><span class="tk-p"></span><span class="tk-c"></span>';
        tickerEl.append(t);
      }
    }
  }
  const items = [...tickerEl.children];
  items.forEach((t, i) => {
    const p = pools[i % pools.length];
    t.querySelector('b').textContent = p.symbol;
    t.querySelector('.tk-p').textContent = price(p.price);
    const c = t.querySelector('.tk-c');
    c.className = 'tk-c ' + (p.chg !== null && p.chg >= 0 ? 'up' : 'down');
    c.textContent = p.chg === null ? dash : `${p.chg >= 0 ? '▲' : '▼'} ${pct(p.chg)}`;
  });
  requestAnimationFrame(() => {
    const w = tickerEl.scrollWidth / 2;
    tickerEl.style.setProperty('--dur', Math.max(24, w / 55).toFixed(1) + 's');
  });
}

/* polling */
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(cycle, ms);
}

async function cycle() {
  if (document.hidden || inflight) return;
  inflight = true;
  clearTimeout(timer);
  if (!pools.length) setStatus('loading', 'Connecting');
  try {
    let next;
    let backup = false;
    try {
      const s = await discoverSlug();
      next = normalize(await getJSON(`${api}/networks/${s}/trending_pools?include=base_token,quote_token&page=1`));
      if (!next.length) throw new Error('empty');
    } catch {
      backup = true;
      try {
        // GeckoTerminal failed: DexScreener, same network
        next = normalizeSecondary(await getJSON(secondary));
        if (!next.length) throw new Error('empty');
      } catch {
        // both pool feeds failed: plain coin list
        next = normalizeFallback(await getJSON(fallback));
        if (!next.length) throw new Error('empty');
      }
    }
    pools = next;
    fails = 0;
    errorEl.hidden = true;
    paintRows();
    paintStats();
    paintTicker();
    setStatus('live', backup ? 'Live, backup feed' : 'Live');
    schedule(pollMs);
  } catch (err) {
    fails += 1;
    if (pools.length) {
      setStatus('stale', 'Holding last data');
    } else {
      paintFailed();
      errorEl.hidden = false;
      setStatus('down', 'Source unavailable');
    }
    const wait = Math.min(pollMs, BACKOFF_BASE * 2 ** (fails - 1));
    schedule(wait * (0.85 + Math.random() * 0.3));
  } finally {
    inflight = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else cycle();
});

for (const tab of document.querySelectorAll('[data-sort]')) {
  tab.addEventListener('click', () => {
    sortKey = tab.dataset.sort;
    for (const t of document.querySelectorAll('[data-sort]')) t.setAttribute('aria-selected', String(t === tab));
    if (pools.length) paintRows();
  });
  tab.addEventListener('keydown', (e) => {
    const tabs = [...document.querySelectorAll('[data-sort]')];
    const i = tabs.indexOf(tab);
    const n = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i + tabs.length - 1) % tabs.length] : null;
    if (n) {
      e.preventDefault();
      n.focus();
      n.click();
    }
  });
}

export function startMarket() {
  cycle();
}
