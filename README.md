# TxScope

**A live lens on the busiest pools on Robinhood Chain.**

[![Live site](https://img.shields.io/badge/live-txscope.xyz-fd5901?style=flat-square)](https://txscope.xyz)
![Chain](https://img.shields.io/badge/chain-Robinhood%20Chain-020100?style=flat-square)

| | |
|---|---|
| Chain | Robinhood Chain (`0x1237`) |
| Contract address | `pending` |
| Site | https://txscope.xyz |

## Overview

TxScope follows the pools drawing the most attention on Robinhood Chain and keeps their price, momentum, turnover and depth on screen. The site is a static page: no wallet connection, no backend, nothing typed in by hand. Market numbers are read from a public pool index in the browser.

## Features

- Ten trending pools with price, 24h move, 24h volume, depth and a one-click copy of each pool address
- Ticker that mirrors the same live data
- Re-sort by trending order, volume, depth or momentum
- Refreshes every minute, rests while the tab is hidden, fetches at once when you return
- Backs off exponentially on failure and keeps the last good numbers on screen
- Contract slot at the top of every page, inert until an address is stated
- Reduced-motion support throughout

## Links

| | |
|---|---|
| Website | https://txscope.xyz |
| X | pending |
| GitHub | pending |
| Docs | [docs/whitepaper.md](docs/whitepaper.md) |

## Develop

```bash
npm run build   # writes dist/
npm run gates   # builds, then checks the standing rules
npm run serve   # serves dist/ locally
```

`dist/` is the deploy folder.

## Licence

MIT. See [LICENSE](LICENSE).
