# 🫧 grrttpop

A living corner of the web. Not a brochure — an organism.

## 🪸 the reef — the useful part

`market.html` is a dive into the live crypto market — an ocean in three depth bands:

- **the shallows** (blue chips) → **mid waters** (majors) → **the deep** (small caps),
  separated by real fog. Scroll / drag / keys `1 2 3` / the left rail to dive.
- **size** = market cap (log scale) · **color** = 24h move (green up / pink down / periwinkle flat) · **twitch** = volatility · **swim speed** = 1h momentum · **🔥 orange halo** = trending on CoinGecko
- **real-time heartbeat**: a Binance WebSocket streams miniTicker trades for all 50
  coins — creatures visibly pulse when a trade moves their price ("● live" in the legend)
- click a creature → the camera swims to it + detail card: price (ticking live),
  1h/24h/7d, 7-day sparkline, rank, mcap, volume, coin⇄USD converter
- **🎒 my bags**: a local-only holdings tracker — total value ticks live in the
  header; the bags sort re-renders the reef scaled to *your* holdings.
  Stored in localStorage, never leaves the browser.
- `/` to search (non-matches fade into the deep), sorts: size / gainers / losers / ⭐ watched / 🎒 bags
- **🔊 soundscape** (opt-in): generative underwater drone whose brightness follows
  the fear & greed index; trade ticks play soft pentatonic plucks
- CoinGecko + alternative.me + Binance public data; 90s refresh + live ticks;
  falls back to a clearly-labeled demo reef offline
- market data only: no trading, no custody, no wallets, not financial advice

## ⚓ the trench — solana, live

`solana.html` goes on-chain (read-only, always):

- **network vitals from mainnet RPC**: live TPS literally drives the speed of the
  water current; epoch number + progress in the header; RPC failover across four
  public endpoints ("● mainnet" when connected)
- **the SPL ecosystem** as creatures (CoinGecko solana-ecosystem category, top 40),
  wearing solana purple with green/pink for 24h moves
- **🔭 wallet peek**: paste ANY public address → its holdings become a school of
  fish in the deep, sized by USD value. On-chain token accounts (spl-token +
  token-2022) via RPC, symbols/logos via Jupiter's verified token list, prices via
  Jupiter price v3 (CoinGecko contract-price fallback). Verified in testing against
  Binance's hot wallet: 9.67M SOL ≈ $736M read live from mainnet.
- honest failure modes: if token accounts can't be read, the trench says so —
  it never presents a partial wallet as the whole thing
- **strictly read-only**: no keys, no signatures, no transactions, no wallet
  connections — paste an address, that's it. Not financial advice.

One WebGL creature (noise-displaced, iridescent, pokeable), a starfield, a tiny
companion that trails your cursor and talks, a ⌘K command palette, a toybox
that rewires the creature's shader live, and a structured welcome for AI agents.

## run it

```sh
npx http-server -p 4173 -c-1 .
# open http://localhost:4173
```

No build step. No framework. Vanilla ES modules + three.js via an import map.

## play with it

- **click the creature** — it pops (with a synthesized blip, no audio assets)
- **⌘K / ctrl-K** — command palette: navigation, modes, mischief
- **toybox** — goo / nebula / vortex / wireframe / party / calm, all live shader rewiring
- **console** — `grrtt.pop()`, `grrtt.setMode('party')`, `grrtt.uniforms` — the creature is hackable
- **agents** — `GET /agent.json` — a machine-readable card: who, what, how to reach, one small favor

## files

| file | what |
|---|---|
| `index.html` | structure + import map |
| `styles.css` | dark, acid-green + hot-pink, big lowercase type |
| `main.js` | the whole organism: shaders, companion, palette, toybox |
| `agent.json` | the agent-facing card |

## notes

- Adaptive quality: mesh detail and pixel ratio step down automatically on slow devices.
- No trackers, no cookies, no analytics. One creature.
