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
- **bring your own RPC**: every *free public* Solana endpoint blocks
  `getTokenAccountsByOwner` (it's an indexed method gated behind api keys), so
  anonymous peek shows the SOL balance and says so plainly. Paste a free
  Helius/QuickNode/Alchemy endpoint in the wallet panel and the full school
  appears — the URL is stored in your browser only and takes priority over the
  public pool.
- honest failure modes: a gated method is distinguished from a real outage, and
  a partial wallet is never presented as the whole thing
- **strictly read-only**: no keys, no signatures, no transactions, no wallet
  connections — paste an address, that's it. Not financial advice.

One WebGL creature (noise-displaced, iridescent, pokeable), a starfield, a tiny
companion that trails your cursor and talks, a ⌘K command palette, a toybox
that rewires the creature's shader live, and a structured welcome for AI agents.

## run it

```sh
npm run dev
# open http://localhost:4173
```

No build step. No framework. Vanilla ES modules + three.js via an import map.

## check it

```sh
npm run check
```

Sub-second, zero dependencies. Parses every script, resolves every import and
asset reference, validates the import maps, catches `$("id")` lookups whose
element isn't in the markup, and fails if a page loses its console global or
its `state()`. Run it after every edit — with no build step, nothing else will
tell you a file is broken until a browser silently renders black.

> One trap it works around: `node --check foo.js` **exits 0 on a broken file**
> if that file contains ESM syntax — the CJS parse fails, Node detects module
> syntax, retries, and swallows the result. Every browser file here is an ESM
> `.js`, so the naive check is a silent no-op. `check.mjs` stages each file as
> `.mjs` to force the module parser.

## smoke it

```sh
npm run smoke          # headless, recorded fixtures, all three pages
npm run smoke -- --live    # hit the real apis instead
npm run smoke -- --head    # watch it happen in a real window
```

Boots every page in a headless Chrome, waits for the network to go quiet,
steps the scene a fixed number of frames, then asserts against `state()`
rather than pixels — a WebGL page can render plausible-looking black. Prints
pass/fail per page and drops `state()`, a report and a screenshot in `.smoke/`.

It checks the things that actually break: shaders compiled, draw calls landed,
data arrived, creatures exist and are visible, the reef's depth bands respond,
trade ticks reach the creatures, and — the important one — that a partial
wallet read in the trench is *disclosed* rather than shown as if it were whole.

No Playwright, no Puppeteer, no `node_modules` at all: Node 22 ships `fetch`
and `WebSocket`, and Chrome speaks CDP over both, so [`tools/cdp.mjs`](tools/cdp.mjs)
drives the browser in about a hundred lines. WebGL works headless through
SwiftShader — slower than a GPU, but the shaders genuinely compile and
rasterise.

## make it repeat itself

Three query params, off by default, turn the organism into something a machine
can run twice and get the same answer from:

| param | what it does |
|---|---|
| `?seed=42` | every `Math.random()` becomes a fixed sequence |
| `?freeze=1` | `requestAnimationFrame` becomes a pump nothing drives on its own; `__harness.step(n)` advances exactly n frames |
| `?fixtures=1` | replay recorded API responses — no network, no rate limits |

```sh
npm run record     # re-capture fixtures when an api changes shape
```

`state().harness` reports which are active, so replayed data is never mistaken
for live data.

`freeze` **steps** rather than freezes. Truly stopping the clock would pin every
lerp at its starting value and the reef would never assemble; stepping lets the
scene settle and still land on the same pixels. And counting frames is not
enough on its own — a free-running loop renders however many frames fit in the
wall-clock gap before a screenshot, so the harness steps to an *absolute* frame
count instead.

Getting screenshots to repeat turned up four things worth knowing:

- **Data landing mid-run rebuilds the scene at a different frame each time.**
  The harness waits for `net.inflight === 0` before stepping at all.
- **CSS animations ignore the virtual clock entirely** — they run on the
  compositor's wall clock. The scroll cue's `bob` kept landing 1.1px apart.
  `page.freezeCss()` sets `animation: none` before capture; `animation-play-state:
  paused` is *not* enough, because it freezes an animation wherever it happens
  to be, which is still wall-clock dependent.
- **The rate-limit stagger has nothing to dodge when replaying fixtures**, so it
  collapses to zero and the extras land before the scene is stepped.
- **Byte equality is the wrong test.** Even with the scene provably identical —
  same `uTime`, same rotation, to full float precision — two runs still differ
  by ~18 pixels in a million, each off by one in a single channel. Text
  antialiasing over a blended backdrop rounds differently and nothing fixes it.
  So the comparison has a tolerance, and fails on the *size* of a change: a real
  regression moves thousands of pixels, not eighteen.

## watch it for regressions

```sh
npm run smoke                          # compares against baselines/
npm run smoke -- --update-baselines    # re-bless them after an intended change
```

Each page's settled scene is committed under `baselines/`. A run decodes both
images inside Chrome (which already has a PNG decoder, so this stays dependency
-free), ignores per-channel deltas ≤ 2, and fails if more than 0.05% of pixels
move.

Measured against that: identical runs differ by **0%**. Shifting one shader's
time scale by a third moves **28.7%**. Breaking a single fixture route moves
**82.8%** — and that one is the interesting case, because the state assertions
all still passed: the trench had silently fallen through to the *reef's* markets
fixture and rendered plausible, wrong data. Only the picture caught it.

## ask it how it's doing

A WebGL page renders identical black whether it's loading, rate-limited, or
dead on a shader compile. So the organism reports its own vitals — no pixels
required:

```js
await window.__ready       // resolves when the page reaches its working state
reef.state()               // one structured snapshot
window.__diag.errors       // the last 50 things that went wrong
```

`state()` gives you fps, shader compile failures, data source + staleness,
websocket liveness, scene contents, and the page's current note. `__diag`
captures js exceptions, rejected promises, failed fetches, dead sockets, and
**shader compile logs with line numbers** — the one string that turns a black
canvas into a fixable bug.

The trench reports each RPC endpoint's refusal separately, so a gated method
is distinguishable from a dead network at a glance:

```js
trench.state().wallet   // { holdings: 1, partial: true, gated: true, … }
trench.state().errors   // publicnode "Request blocked" · drpc "free plan" · …
```

`__ready` carries `painted: false` when the tab is backgrounded — a hidden tab
suspends `requestAnimationFrame`, so a paint-gated beacon would hang a headless
check forever. `state().frames` tells you whether anything actually rendered.

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
| `reef.js` / `trench.js` | the reef and the trench |
| `lib/diag.js` | the nervous system: error capture, fps, the ready beacon |
| `lib/harness.js` | seeded rng, the stepped clock, fixture replay |
| `tools/check.mjs` | `npm run check` — parse, resolve, verify promises |
| `tools/smoke.mjs` | `npm run smoke` — boot every page and assert it's alive |
| `tools/cdp.mjs` | a browser driver in ~100 lines, zero dependencies |
| `fixtures/` | one recorded response per api, refusals included |
| `agent.json` | the agent-facing card |

## notes

- Adaptive quality: mesh detail and pixel ratio step down automatically on slow devices.
- No trackers, no cookies, no analytics. One creature.
