// Assembles dist/ from src/ and data/register.json. Importable (gates reuse build()) and runnable.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderSocials, renderCA, renderRec, renderTile, renderFlowBar, renderRows, renderTickerSkeleton, validate, find, icons } from './render.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Explicit copy list: nothing reaches dist/ by accident, and the logo is named here on purpose.
export const ASSETS = ['logo-512.png', 'logo-128.png', 'favicon.svg', 'apple-touch-icon.png'];
const RUNTIME_RECORDS = ['chain', 'market-source']; // the only records client JS may read

export const loadRegister = () => JSON.parse(readFileSync(join(ROOT, 'data', 'register.json'), 'utf8'));

export function runtimeRegister(register) {
  const records = register.records
    .filter((r) => RUNTIME_RECORDS.includes(r.id))
    .map(({ id, label, state, value }) => ({ id, label, state, value }));
  return { records };
}

export function build({ register = loadRegister(), out = join(ROOT, 'dist') } = {}) {
  validate(register);
  rmSync(out, { recursive: true, force: true });
  for (const d of ['assets', 'css', 'js']) mkdirSync(join(out, d), { recursive: true });

  for (const f of ASSETS) {
    const from = join(ROOT, 'src', 'assets', f);
    if (!existsSync(from)) throw new Error(`missing asset ${f}; run npm run assets`);
    // favicon and touch icon sit at the site root, the logos under assets/
    const to = f === 'favicon.svg' || f === 'apple-touch-icon.png' ? join(out, f) : join(out, 'assets', f);
    copyFileSync(from, to);
  }
  for (const f of readdirSync(join(ROOT, 'src', 'css'))) copyFileSync(join(ROOT, 'src', 'css', f), join(out, 'css', f));
  for (const f of readdirSync(join(ROOT, 'src', 'js'))) copyFileSync(join(ROOT, 'src', 'js', f), join(out, 'js', f));
  writeFileSync(join(out, 'js', 'register.js'), `export const register = ${JSON.stringify(runtimeRegister(register), null, 2)};\n`);

  const chain = find(register, 'chain').value;
  const slots = {
    SOCIALS: renderSocials(register),
    CA: renderCA(register),
    TICKER: renderTickerSkeleton(8),
    ROWS: renderRows(find(register, 'market-source').value.pools),
    FLOWBAR: renderFlowBar(register),
    FLOWTILES: ['split-burn', 'split-rewards', 'split-treasury', 'split-partners'].map((id) => renderTile(register, id)).join(''),
    CHAINID: chain.chainId,
    RPC: chain.rpc,
    COPYICON: icons.copy,
    REC_EXPLORER: renderRec(register, 'explorer'),
    REC_DOCS: renderRec(register, 'docs'),
    REC_AUDIT: renderRec(register, 'audit')
  };
  let html = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in slots)) throw new Error(`unknown slot ${m}`);
    return slots[k];
  });
  writeFileSync(join(out, 'index.html'), html);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = build();
  console.log('built', out);
}
