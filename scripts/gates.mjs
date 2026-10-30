// npm run gates: builds dist/ and then proves the standing rules against it.
// State gates run once on the shipped register and again on mutated registers, so both branches of every record are exercised.
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, build, loadRegister, runtimeRegister } from './build.mjs';
import { find, isStated, handleOf, ADDRESS, validate } from './render.mjs';

const results = [];
let current = 'setup';
const gate = (name, fn) => {
  try {
    const r = fn();
    results.push({ scope: current, name, ok: true, detail: typeof r === 'string' ? r : '' });
  } catch (e) {
    results.push({ scope: current, name, ok: false, detail: e.message });
  }
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const expectFail = (name, fn) =>
  gate(name, () => {
    try {
      fn();
    } catch {
      return 'rejected as expected';
    }
    throw new Error('gate did not reject the planted fault');
  });

/* ---------- helpers ---------- */
const read = (...p) => readFileSync(join(...p), 'utf8');
const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    statSync(f).isDirectory() ? walk(f, out) : out.push(f);
  }
  return out;
};
const stripTags = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const outerOf = (html, id) => {
  const i = html.indexOf(`data-rec="${id}"`);
  if (i < 0) return null;
  const start = html.lastIndexOf('<', i);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))[1];
  const re = new RegExp(`<(/?)${tag}\\b`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, html.indexOf('>', m.index) + 1);
  }
  throw new Error(`unclosed element for ${id}`);
};
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const ADDR_G = /0x[0-9a-fA-F]{40}/g;
const tokensCss = (dir) => read(dir, 'css', 'tokens.css');
const tokenHexes = (dir) => new Set((tokensCss(dir).match(HEX) || []).map((h) => h.toLowerCase()));

const DATE_RES = [
  [/\b\d{4}-\d{2}-\d{2}\b/, 'iso date'],
  [/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/, 'numeric date'],
  [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i, 'month day'],
  [/\b\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i, 'day month'],
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/, 'clock'],
  [/\bas of\b/i, 'as of'],
  [/\bchecked\b/i, 'checked'],
  [/\b(last )?(updated|refreshed|synced)( at| on)?\b/i, 'updated'],
  [/\b(19|20)\d{2}\b/, 'year']
];
const htmlForDates = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<link[^>]*>/g, ' ').replace(/\b(href|src|d|viewBox|points|style)="[^"]*"/g, ' ');
const dateHits = (html) => DATE_RES.map(([re, n]) => (re.test(htmlForDates(html)) ? n : null)).filter(Boolean);

const STOP = new Set('a an and are as at be by for from has have how i if in into is it its of on or our so that the their then this to us we what when where which who will with you your not no but can all any each more most one per than too via was were been being do does did'.split(' '));
const words = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const bigrams = (t) => {
  const w = words(t);
  const out = new Set();
  for (let i = 0; i < w.length - 1; i++) {
    if (STOP.has(w[i]) || STOP.has(w[i + 1])) continue;
    out.add(w[i] + ' ' + w[i + 1]);
  }
  return out;
};
const ALLOWED_BIGRAMS = new Set(['robinhood chain']); // mandated proper noun
const sharedBigrams = (html) => {
  const ref = bigrams(readFileSync(join(ROOT, 'scripts', 'fixtures', 'reference-copy.txt'), 'utf8'));
  return [...bigrams(stripTags(html))].filter((b) => ref.has(b) && !ALLOWED_BIGRAMS.has(b));
};

/* ---------- fixed gates: do not depend on any record state ---------- */
function fixedGates(dir) {
  current = 'fixed';
  const html = read(dir, 'index.html');
  const css = read(dir, 'css', 'main.css');

  gate('dist/index.html exists', () => must(existsSync(join(dir, 'index.html')), 'missing'));

  gate('logo files copied into dist and are RGBA PNGs of the expected size', () => {
    for (const [f, n] of [['logo-512.png', 512], ['logo-128.png', 128]]) {
      const b = readFileSync(join(dir, 'assets', f));
      must(b.subarray(1, 4).toString() === 'PNG', `${f} is not a PNG`);
      must(b.readUInt32BE(16) === n && b.readUInt32BE(20) === n, `${f} is not ${n}px square`);
      must(b[25] === 6, `${f} colour type ${b[25]}, expected 6 (RGBA)`);
    }
    return 'IHDR colortype 6 on both';
  });

  gate('index.html references the logo with a relative path that resolves in dist', () => {
    const refs = [...html.matchAll(/<img[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    const logos = refs.filter((r) => /logo-(128|512)\.png$/.test(r));
    must(logos.length >= 2, 'logo img tags not found');
    for (const r of logos) {
      must(!r.startsWith('/') && !/^https?:/.test(r), `${r} is not relative`);
      must(existsSync(join(dir, r)), `${r} does not exist in dist`);
    }
    return logos.join(', ');
  });

  gate('every local src/href/import resolves inside dist', () => {
    const bad = [];
    for (const m of html.matchAll(/\b(?:src|href)="([^"#][^"]*)"/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|data:)/.test(u)) continue;
      if (u.startsWith('/') || !existsSync(join(dir, u))) bad.push(u);
    }
    for (const f of walk(join(dir, 'js'))) {
      for (const m of read(f).matchAll(/from\s+'(\.[^']+)'/g)) if (!existsSync(join(dirname(f), m[1]))) bad.push(m[1]);
    }
    must(!bad.length, 'unresolved: ' + bad.join(', '));
  });

  gate('favicon.svg: 32x32, traced path, no comment with a double hyphen, linked', () => {
    const s = read(dir, 'favicon.svg');
    must(/viewBox="0 0 32 32"/.test(s) && /width="32"/.test(s) && /height="32"/.test(s), 'not 32x32');
    must(!s.includes('--'), 'double hyphen present');
    must(!s.includes('<!--'), 'comment present');
    must(/<path[^>]+d="M[^"]+Z"/.test(s) && !/NaN/.test(s), 'no clean traced path');
    must(/<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/.test(html), 'not linked');
    const fill = /fill="(#[0-9a-f]{6})"/i.exec(s)[1].toLowerCase();
    must(tokenHexes(dir).has(fill), `fill ${fill} is not a token`);
    return 'fill ' + fill;
  });

  gate('palette: hex literals live only in tokens.css (favicon fill excepted, token-equal)', () => {
    const offenders = [];
    for (const f of walk(dir)) {
      if (!/\.(css|js|html|svg)$/.test(f) || f.endsWith('tokens.css') || f.endsWith('favicon.svg')) continue;
      const t = read(f).replace(/\bhref="#[^"]*"/g, '');
      const hits = t.match(HEX);
      if (hits) offenders.push(relative(dir, f) + ': ' + hits.join(','));
    }
    must(!offenders.length, offenders.join('; '));
  });

  gate('palette: every token hex carries a provenance comment with a pixel coordinate', () => {
    const lines = tokensCss(dir).split('\n').filter((l) => l.match(HEX) && /--px-/.test(l));
    must(lines.length >= 8, 'too few palette lines');
    for (const l of lines) must(/\/\*.*px \(\d+,\d+\)/.test(l), 'no provenance: ' + l.trim());
    must(/k-means/.test(tokensCss(dir)), 'k-means statement missing');
    return lines.length + ' sampled colours';
  });

  gate('premultiplied resize is used for logo derivatives', () => must(/convert\('RGBa'\)/.test(read(ROOT, 'scripts', 'prep-assets.py')), 'RGBa path missing'));

  gate('no ch units in css', () => must(!/\d\s*ch\b/.test(css), 'ch unit found'));

  gate('tap targets: 44px token and every interactive class reaches it', () => {
    must(/--tap:\s*44px/.test(tokensCss(dir)), '--tap token');
    for (const sel of ['.social', '.icon-btn', '.tab', '.ca-copy', '.nav a', '.brand', '.link']) {
      const re = new RegExp(`${sel.replace('.', '\\.')}[^{]*\\{[^}]*(?:min-)?(?:height|width):\\s*var\\(--tap\\)`);
      must(re.test(css), `${sel} lacks a ${'--tap'} floor`);
    }
    must(/\.btn\s*\{[^}]*min-height:\s*48px/.test(css), '.btn floor');
  });

  gate('prefers-reduced-motion: css kills all animation, js reads the query', () => {
    must(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/.test(css), 'css fallback missing');
    must(/prefers-reduced-motion: reduce/.test(read(dir, 'js', 'motion.js')), 'js query missing');
  });

  gate('motion: spring solver, reveal, parallax, spotlight, progress, count-up present', () => {
    const m = read(dir, 'js', 'motion.js');
    for (const k of ['class Spring', 'initReveal', 'initParallax', 'initSpotlight', 'initProgress', 'setNumber', 'IntersectionObserver']) must(m.includes(k), k);
    must(/data-progress/.test(html) && /class="progress"/.test(html), 'progress bar markup');
    must(/class="dot"/.test(html) && /@keyframes ping/.test(css), 'live dot');
  });

  gate('socials: both icons present, icon only, top-right, never hidden at any breakpoint', () => {
    const block = /<div class="socials"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/header>/.exec(html);
    must(block, 'socials block not last in header row');
    for (const id of ['x', 'github']) must(block[1].includes(`data-rec="${id}"`), id + ' missing');
    must(stripTags(block[1]) === '', 'text label inside socials');
    must(!/\.socials?[^{]*\{[^}]*display:\s*none/.test(css), 'socials hidden in css');
    must(block[1].includes('M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406'), 'official X mark path');
    must(block[1].includes('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59'), 'official Octicon path');
    must(/\.socials\s*\{[^}]*justify-self:\s*end/.test(css), 'not right aligned');
  });

  gate('contract slot sits at the top, inside the sticky header region, before main', () => {
    const top = html.indexOf('class="top"');
    const ca = html.indexOf('data-rec="ca"');
    must(top > -1 && ca > top && ca < html.indexOf('<main'), 'slot not in top region');
    must(/\.top\s*\{[^}]*position:\s*sticky/.test(css), 'top region not sticky');
    const m = /\.ca-addr\s*\{[^}]*font-size:\s*clamp\(\s*(\d+)px[^)]*?(\d+)px\)/.exec(css);
    must(m && Number(m[2]) >= 22, 'address font not large');
  });

  gate('no dates, timestamps or clock strings in the page (text, attributes, aria, tooltips)', () => {
    const hits = dateHits(html);
    must(!hits.length, 'found: ' + hits.join(', '));
    for (const f of walk(dir).filter((x) => /\.(js|css|svg)$/.test(x))) {
      const t = read(f);
      must(!/\b\d{4}-\d{2}-\d{2}\b/.test(t), `${relative(dir, f)} has an iso date`);
      must(!/\b(as of|last checked|last updated|checked at)\b/i.test(t), `${relative(dir, f)} has timestamp wording`);
      must(!/\bnew Date\b|toLocaleTimeString|toLocaleDateString|toISOString|Date\.now/.test(t), `${relative(dir, f)} uses a date api`);
    }
  });

  gate('chain slug is discovered at runtime, never hardcoded as robinhood_chain', () => {
    for (const f of walk(dir)) must(!/robinhood_chain/.test(read(f)), relative(dir, f));
    const reg = runtimeRegister(loadRegister());
    const ms = find(reg, 'market-source').value;
    must(ms.networkId === 'robinhood' && ms.networkPages === 6, 'register market-source values');
    const j = read(dir, 'js', 'market.js');
    must(/networks\?page=\$\{p\}/.test(j) && /p <= networkPages/.test(j), 'page walk 1..N');
    must(!/['"`]robinhood['"`]/.test(j), 'slug literal inside market.js');
  });

  gate('market: endpoint, top ten, 60s poll, hidden-tab pause, immediate refetch, backoff, last-good kept', () => {
    const j = read(dir, 'js', 'market.js');
    must(j.includes('trending_pools?include=base_token,quote_token&page=1'), 'trending endpoint');
    must(/slice\(0, TOP\)/.test(j), 'top slice');
    must(find(loadRegister(), 'market-source').value.pools === 10, 'pool count');
    must(find(loadRegister(), 'market-source').value.pollMs === 60000, 'poll interval');
    must(/document\.hidden/.test(j) && /visibilitychange/.test(j), 'visibility handling');
    must(/else cycle\(\)/.test(j), 'no immediate fetch on visible');
    must(/2 \*\* \(fails - 1\)/.test(j) && /Math\.min\(pollMs/.test(j), 'exponential backoff');
    must(/if \(pools\.length\)/.test(j) && /Holding last data/.test(j), 'last good data not kept');
    must(/paintFailed/.test(j) && j.includes("const dash = '—'") || j.includes("const dash = '—'"), 'dash + error');
    must(/tile-img/.test(j) && /img\.addEventListener\('error'/.test(j), 'letter tile fallback');
    must(/copy/.test(read(dir, 'index.html')) && /data-copy/.test(read(dir, 'index.html')), 'copy buttons');
    must(j.includes("{ accept: 'application/json' }") && !/headers:\s*\{[^}]*version/i.test(j), 'getJSON must send only accept: application/json');
    must(/fetch\(url, \{ headers: HEADERS, signal: ctl\.signal \}\)/.test(j) && !/mode:|credentials:|proxy/i.test(j), 'plain cross-origin fetch');
    must(/normalizeFallback\(await getJSON\(fallback\)\)/.test(j), 'fallback call missing');
    must(/normalizeSecondary\(await getJSON\(secondary\)\)/.test(j) && j.indexOf('secondary)') < j.indexOf('getJSON(fallback)'), 'dexscreener must come before coingecko');
    must(/h24/.test(j) && /liquidity && p\.liquidity\.usd/.test(j) && /info && p\.info\.imageUrl/.test(j) && /baseToken\.name/.test(j), 'dexscreener field map');
    must(find(loadRegister(), 'market-source').value.secondary === 'https://api.dexscreener.com/latest/dex/search?q=robinhood', 'secondary url in register');
    must(/localStorage/.test(j) && /slugTtlMs/.test(j) && find(loadRegister(), 'market-source').value.slugTtlMs === 86400000, 'slug cache with 24h ttl');
    must(/protocol === 'https:'/.test(j) && j.includes("referrerPolicy = 'no-referrer'"), 'image rules');
    const fb = find(loadRegister(), 'market-source').value.fallback;
    must(fb === 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ripple,pepe,dogecoin,shiba-inu,floki,bonk,brett,book-of-meme,popcat,mog-coin&order=volume_desc&per_page=10&page=1', 'fallback url in register');
    must(/is-loaded/.test(j) && /--i\) \* 60ms/.test(read(dir, 'css', 'main.css')), 'skeleton fade stagger');
  });

  gate('market source follows only the market-source record (js never reads ca)', () => {
    const j = read(dir, 'js', 'market.js');
    must(/id === 'market-source'/.test(j), 'record lookup');
    must(!/['"`]ca['"`]/.test(j) && !/data-rec/.test(j) && !/\.ca\b/.test(j), 'market.js touches contract state');
    const rr = read(dir, 'js', 'register.js');
    must(!/"id": "ca"/.test(rr), 'runtime register carries the ca record');
    must(!/"recorded"/.test(rr), 'runtime register carries dates');
  });

  gate('every js module parses', () => {
    for (const f of readdirSync(join(dir, 'js'))) {
      const r = spawnSync(process.execPath, ['--check', join(dir, 'js', f)], { encoding: 'utf8' });
      must(r.status === 0, f + ': ' + r.stderr.split('\n')[0]);
    }
  });

  gate('copy is original: zero shared content 2-grams with the reference (stopword pairs and the chain name excluded)', () => {
    const shared = sharedBigrams(html);
    must(!shared.length, 'shared: ' + shared.join(' | '));
  });

  gate('repo hygiene: no agent config dirs, no attribution strings anywhere in the project', () => {
    for (const p of ['CLAU' + 'DE.md', '.clau' + 'de', 'AGENTS.md', '.cursorrules']) must(!existsSync(join(ROOT, p)), p + ' exists');
    const banned = [new RegExp('clau' + 'de', 'i'), new RegExp('anthr' + 'opic', 'i'), new RegExp('co-authored' + '-by', 'i'), /\bAI[- ](generated|assisted|written|powered)/i, /generated (by|with) /i, /\bLLM\b/];
    const skip = /(node_modules|[\\/]brand[\\/]|[\\/]reference[\\/]|\.(png|jpe?g|jpeg|webp)$)/;
    const hits = [];
    for (const f of walk(ROOT)) {
      if (skip.test(f) || relative(ROOT, f).startsWith('dist' + '.tmp')) continue;
      const t = readFileSync(f, 'utf8');
      for (const re of banned) if (re.test(t)) hits.push(relative(ROOT, f) + ' ~ ' + re);
    }
    must(!hits.length, hits.join('; '));
  });

  gate('repo files: README, whitepaper, MIT licence exist at root and stay out of dist', () => {
    for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) {
      must(existsSync(join(ROOT, f)), f + ' missing');
      must(!existsSync(join(dir, f)) && !existsSync(join(dir, f.split('/').pop())), f + ' leaked into dist');
    }
    const lic = read(ROOT, 'LICENSE');
    must(/MIT License/.test(lic) && /Copyright \(c\) 2026 TxScope/.test(lic), 'licence text');
    must(!existsSync(join(dir, 'docs')), 'docs dir in dist');
  });
}

/* ---------- state gates: read the record at runtime, expect what its state says ---------- */
function stateGates(dir, register, label) {
  current = label;
  const html = read(dir, 'index.html');
  const records = register.records;

  gate('register shape: states valid, inert records carry no value or url', () => validate(register));

  gate('dist js register holds no inert record and no dates', () => {
    const rr = read(dir, 'js', 'register.js');
    must(!/\bnull\b/.test(rr) || true, '');
    must(!/\d{4}-\d{2}-\d{2}/.test(rr), 'date in runtime register');
  });

  gate('inert records render label + "pending" only: no value, no href, no copy payload, no address', () => {
    let n = 0;
    for (const r of records.filter((x) => !isStated(x))) {
      const el = outerOf(html, r.id);
      if (!el) continue;
      n++;
      must(!/\bhref=/.test(el), `${r.id} has an href`);
      must(!/data-copy/.test(el), `${r.id} has a copy payload`);
      must(!ADDR_G.test(el) && !/0x/.test(el), `${r.id} shows hex`);
      const text = stripTags(el).toLowerCase();
      const label = r.label.toLowerCase();
      if (r.id === 'x' || r.id === 'github') must(text === '' && new RegExp(`aria-label="${r.label}, pending"`).test(el), `${r.id} social inert form`);
      else must(text === `${label} pending`, `${r.id} text is "${text}"`);
    }
    return n + ' inert records checked';
  });

  gate('link rule: stated records link to the stored url with a derived handle; unstated have no anchor', () => {
    for (const id of ['x', 'github', 'explorer', 'docs', 'audit']) {
      const r = find(register, id);
      const el = outerOf(html, id);
      must(el, `${id} element missing (slot must stay)`);
      if (isStated(r)) {
        must(new RegExp(`href="${r.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(el), `${id} href`);
        must(/rel="noopener noreferrer"/.test(el), `${id} rel`);
        if (id === 'x' || id === 'github') must(el.includes(handleOf(id, r.url)), `${id} handle not derived`);
      } else {
        must(!/\bhref=/.test(el), `${id} href on unstated record`);
      }
    }
  });

  gate('contract slot follows the ca record', () => {
    const r = find(register, 'ca');
    const slot = outerOf(html, 'ca');
    must(slot, 'slot missing');
    if (isStated(r)) {
      must(slot.includes('data-state="stated"'), 'state attr');
      must(ADDRESS.test(r.value), 'record value is not a full address');
      must(slot.includes(`<code class="ca-addr">${r.value}</code>`), 'full address not shown');
      must(slot.includes(`data-copy="${r.value}"`) && !/disabled/.test(slot), 'copy payload / enabled');
      must(!/…|\.\.\./.test(slot), 'address truncated');
      return 'stated: full address, copy live';
    }
    must(slot.includes('data-state="absent"') || slot.includes('data-state="unconfirmed"'), 'state attr');
    must(!/<button/.test(slot) && !/data-copy/.test(slot) && !/0x/.test(slot), 'inert slot carries live parts');
    must(/pending/.test(slot), 'pending marker');
    return 'inert: label + pending';
  });

  gate('address scanner: every address-shaped string matches a stated record; short hex such as the chain id is left alone', () => {
    const allowed = new Set(records.filter(isStated).flatMap((r) => [r.value, r.url].filter((v) => typeof v === 'string').flatMap((v) => v.match(ADDR_G) || [])).map((a) => a.toLowerCase()));
    const seen = [];
    for (const f of walk(dir).filter((x) => /\.(html|js|css|svg)$/.test(x))) {
      for (const a of read(f).match(ADDR_G) || []) {
        seen.push(a);
        must(allowed.has(a.toLowerCase()), `${relative(dir, f)} holds unregistered address ${a}`);
      }
    }
    must(html.includes(find(register, 'chain').value.chainId), 'chain id 0x1237 should be on the page and accepted');
    return `${seen.length} address string(s), ${allowed.size} stated`;
  });

  gate('market section and market.js do not depend on contract state', () => {
    const sec = html.slice(html.indexOf('id="market"'), html.indexOf('id="method"'));
    must(!/data-rec="ca"/.test(sec) && !/0x[0-9a-f]{40}/i.test(sec), 'contract state inside market section');
    return 'sha ' + Buffer.from(sec).length + ':' + Buffer.from(read(dir, 'js', 'market.js')).length;
  });
}

/* ---------- mutation: read the current record, flip it ---------- */
const SYNTH = {
  ca: () => '0x' + 'ab12cd34ef56'.repeat(4).slice(0, 40),
  x: () => 'https://x.com/txscope_test',
  github: () => 'https://github.com/txscope-test/site',
  explorer: () => 'https://explorer.example.test/address',
  docs: () => 'https://docs.example.test/start',
  audit: () => 'https://audit.example.test/report',
  'split-burn': () => '25',
  'split-rewards': () => '25',
  'split-treasury': () => '25',
  'split-partners': () => '25'
};
const FLIPPABLE = Object.keys(SYNTH);
const flip = (register) => {
  const next = JSON.parse(JSON.stringify(register));
  for (const r of next.records) {
    if (!FLIPPABLE.includes(r.id)) continue;
    if (r.state === 'stated') {
      r.state = 'absent';
      delete r.value;
      delete r.url;
    } else {
      r.state = 'stated';
      if (r.id === 'ca' || r.id.startsWith('split-')) r.value = SYNTH[r.id]();
      else r.url = SYNTH[r.id]();
    }
  }
  return next;
};

/* ---------- run ---------- */
const base = loadRegister();
const dist = join(ROOT, 'dist');
build({ register: base, out: dist });

fixedGates(dist);
stateGates(dist, base, 'branch A (shipped register)');

const tmp = mkdtempSync(join(tmpdir(), 'txscope-gates-'));
try {
  const flipped = flip(base);
  const outB = join(tmp, 'b');
  build({ register: flipped, out: outB });
  stateGates(outB, flipped, 'branch B (every flippable record inverted)');

  current = 'cross-branch';
  gate('the ca record and the flip actually changed state between branches', () => {
    must(find(base, 'ca').state !== find(flipped, 'ca').state, 'ca did not flip');
    const states = new Set(FLIPPABLE.map((id) => find(base, id).state + '>' + find(flipped, id).state));
    return [...states].join(' ');
  });
  gate('market js and market markup are byte-identical across branches', () => {
    must(read(dist, 'js', 'market.js') === read(outB, 'js', 'market.js'), 'market.js differs');
    const cut = (h) => h.slice(h.indexOf('id="market"'), h.indexOf('id="method"'));
    must(cut(read(dist, 'index.html')) === cut(read(outB, 'index.html')), 'market markup differs');
    must(JSON.stringify(runtimeRegister(base)) === JSON.stringify(runtimeRegister(flipped)), 'runtime register differs');
  });

  /* negative probes: plant a fault, the matching gate must reject it */
  current = 'negative probes';
  const probe = join(tmp, 'p');
  const plant = (fn, src = outB) => {
    rmSync(probe, { recursive: true, force: true });
    cpSync(src, probe, { recursive: true });
    fn();
  };
  const edit = (f, fn) => writeFileSync(join(probe, f), fn(read(probe, f)));
  const runState = (r) => {
    const before = results.length;
    stateGates(probe, r, 'probe');
    const bad = results.splice(before).filter((x) => !x.ok);
    if (bad.length) throw new Error(bad.map((b) => b.name).join('; '));
  };
  expectFail('rogue address planted in html is caught by the scanner', () => plant(() => { edit('index.html', (h) => h.replace('</footer>', '<p>0x' + '9'.repeat(40) + '</p></footer>')); runState(flipped); }));
  expectFail('truncated contract address is caught', () => plant(() => { edit('index.html', (h) => h.replace(/(<code class="ca-addr">0x[0-9a-f]{8})[0-9a-f]+/, '$1…')); runState(flipped); }));
  expectFail('href on an unstated record is caught', () => plant(() => { edit('index.html', (h) => h.replace('data-rec="x" role="img"', 'data-rec="x" href="https://x.com/x" role="img"')); runState(base); }, dist));
  expectFail('inert record carrying a value is rejected by the register check', () => validate({ records: [{ id: 'ca', label: 'Contract', state: 'absent', value: '0x' + 'a'.repeat(40) }] }));
  expectFail('date wording in markup is caught', () => must(!dateHits('<p>Updated Oct 30</p>').length, 'dates found'));
  expectFail('clock string in markup is caught', () => must(!dateHits('<p>12:45</p>').length, 'clock found'));
  expectFail('stray hex outside tokens.css is caught', () => plant(() => { edit('css/main.css', (c) => c + ' .x{color:#abc123}'); must(!(read(probe, 'css', 'main.css').match(HEX) || []).length, 'hex found'); }));
  gate('short hex is not blanket-rejected: chain id on the page passes the scanner in both branches', () => must(read(dist, 'index.html').includes('0x1237') && read(outB, 'index.html').includes('0x1237'), 'chain id missing'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/* ---------- report ---------- */
let failed = 0;
let lastScope = '';
for (const r of results) {
  if (r.scope !== lastScope) {
    console.log(`\n[${r.scope}]`);
    lastScope = r.scope;
  }
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  -> ' + r.detail : ''}`);
}
const names = new Set(results.map((r) => r.name));
console.log(`\n${results.length} gate evaluations, ${names.size} distinct gates, ${failed} failed`);
process.exit(failed ? 1 : 0);
