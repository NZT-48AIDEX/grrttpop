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

## it can describe itself

Every page here is a WebGL scene, which means an agent arriving with no eyes
gets a black rectangle and a `<canvas>` element — a strange way to greet someone
you claim is welcome.

So add `?agent=1` to any page — or click **◫ text** in the nav — and the scene is
replaced by a live text rendering of the same state. Not a static fallback: the
actual current scene, in words. There's a link back, since the nav is hidden in
that view.

```
the reef — the live crypto market, as an ocean

50 creatures. 10 rising, 40 falling.
mood: 56 😋

depth bands (size = market cap · colour = 24h move · twitch = volatility)
  the shallows · blue chips
     10 creatures  ████················  2 up / 8 down · median -0.54%
  mid waters · majors
     15 creatures  █████···············  4 up / 11 down · median -1.60%

the week — 7 days, hourly, 50 of them
  the reef as one creature  ██▇▇▇████▇▅▅▃▁▁▁  -3.48% — falling
  9 up · 22 down · 19 sideways · 6 spent the week going one way and today the other

biggest movers
  ↑ NEAR        +2.94%  $2.48        ▁▄▃▆▇▆▅▅▇█▇█
  ↓ ZEC         -8.98%  $1,109       ▁▁▁▆▇▆▅▆██▇▄  ← 7d: spiked and gave most of it back
```

The trench does the same for mainnet, including an epoch progress bar — and when
a wallet read is partial it says **⚠️ PARTIAL READ** in the text, because the
honesty has to survive the translation too.

### one number is not a trend

CoinGecko returns 168 hourly prices per coin and this site used to read the last
one. But `-8.98%` describes a coin that has bled all week and a coin that spiked
on tuesday and is handing it back *identically*, and an agent given only that
number will say the wrong thing about the second one with total confidence.

So every coin now carries its week: [`lib/trend.js`](lib/trend.js) reduces the
series to a sparkline and a shape (`climbing, at its weekly high`, `spiked and
gave most of it back`, `chopping sideways`, …), and flags the one case worth
interrupting for — `divergent`, when the week and the last day point opposite
ways. That flag is why ZEC gets a label above and BCH doesn't; only the coins
whose headline number is misleading say anything extra.

`week` does the same for the market as one equal-weighted index, with breadth —
because "+1%" is forty coins drifting up or one coin carrying forty-nine, and
those are not the same market. Every threshold comes back alongside the label
(`weekPct`, `dayPct`, `rangePct`, `posInRange`), so a caller that disagrees with
where the lines are drawn can see past them instead of reimplementing the maths.

`describe()` sits next to `state()` on every console global and returns the same
thing as structured JSON. `npm run smoke` asserts each page can still describe
itself, and `npm run check` fails if a page loses `?agent=1` — otherwise it would
quietly go back to serving a black rectangle.

## curl gets an empty shell — so the site publishes itself

`?agent=1` is mounted by javascript, and the numbers arrive from a fetch that
only happens once a browser runs the script. Which means this, until now:

```sh
curl -s "grrttpop/market.html?agent=1" | grep -c "biggest movers"   # → 0
```

An agent that did exactly what the card told it to do got an html skeleton. So
a scheduled job runs the same `lib/` code in node and publishes the output:

```sh
curl -s https://raw.githubusercontent.com/NZT-48AIDEX/grrttpop/data/reef.txt
curl -s https://raw.githubusercontent.com/NZT-48AIDEX/grrttpop/data/reef.json | jq .week
```

`index.json` is the manifest; `reef.json`, `reef.txt`, `trench.json` and
`trench.txt` are the same `describe()` output the pages and the MCP server hand
out — no second implementation to drift. Refreshed every 30 minutes onto the
orphan `data` branch, force-pushed as one commit, so nothing lands on `main`.

Locally: `npm run snapshot` (add `--fixtures --allow-synthetic` to build one
offline).

**The tool refuses to publish anything synthetic.** If CoinGecko is unreachable
the reef falls back to invented coins so the page stays alive; if a run tried to
publish those, or a fixture replay, `tools/snapshot.mjs` exits non-zero and
writes nothing. The previous snapshot stands. Stale and true beats fresh and
invented.

## where these numbers came from

Every description carries a stamp:

```json
"data": {
  "source": "coingecko",
  "asOf": "2026-09-22T05:45:15.148Z",
  "ageMs": 1284,
  "synthetic": false,
  "harness": null,
  "note": null
}
```

This started as a hole. The reef's demo fallback is loud in the text view
(**⚠️ SYNTHETIC**) and visible in `state()` as `source: "demo"` — but
`describe()` carried nothing, so an agent asking the MCP server what the market
was doing during an outage got forty invented coins that looked exactly like
real ones. `?fixtures=1` had the same problem from the other direction: a replay
of a months-old recording is structurally indistinguishable from live data.

Now `synthetic` is the field to branch on, "nobody said" reports itself as
`source: "unknown"` rather than passing for live, and `npm run smoke` fails a
page that replays fixtures while claiming to be live — a lie no screenshot could
ever catch, since frozen numbers render exactly as convincingly as real ones.

## discoverable

| where | what |
|---|---|
| `/agent.json` | the agent card — who runs this, what it offers, how to inspect it |
| `/.well-known/agent.json` | the same card, where agents look first |
| `/agent-card.schema.json` | the card's shape, as a real JSON Schema |
| `/llms.txt` | a plain-language index of the site |
| `<link rel="agent-card">`, `<link rel="llms-txt">` | on all three pages |
| `CLAUDE.md` | the conventions a fresh agent needs before touching anything |

The card's `$schema` used to point at `grrttpop.example`, a domain that has never
existed. It now points at a schema this site actually serves, and `npm run check`
validates the card against it — required fields, top-level types, that the
`.well-known` copy hasn't drifted, that the card doesn't advertise an MCP tool the
server doesn't define, and that the MCP block still declares `read_only: true`.

That last one matters: the card is the thing an agent trusts before it has read
any code. It should not be able to lie, even by accident.

## agents: the site as tools

`agent.json` has always said *hello, agent, you are welcome here* and then
offered nothing to do. This is the chair.

```sh
npm run mcp        # speaks MCP on stdin/stdout
npm run mcp:test   # conformance: handshake, discovery, errors, every tool
```

The repo ships a `.mcp.json`, so a client that reads project config picks it
up; otherwise register `node mcp/server.mjs` as a stdio server.

| tool | what you get |
|---|---|
| `reef_snapshot` | the live market as the reef models it — depth bands, movers, trending, mood, and every coin's 7-day shape |
| `describe_page` | what a page is showing right now, in words — the ?agent=1 view as a tool |
| `trench_vitals` | solana mainnet tps, epoch, progress, and which endpoint answered |
| `trench_ecosystem` | the SPL ecosystem: top tokens, gainers, losers, each with its week |
| `trench_wallet_peek` | any public address's holdings — and an honest `partial`/`gated` when the RPC refuses |
| `site_state` | boot a page headless and report what it *did*: fps, draw calls, shader failures, errors, console |
| `shader_try` | compile a shader change and get the driver's log back, with line numbers |
| `visual_diff` | render a page and measure how far it moved from its baseline |
| `run_check` | the static check, as a tool |

Everything is read-only. No tool can spend, sign, or send, and `lib/solana.js`
contains no code path that could.

`shader_try` is the one worth having. Shader iteration is otherwise blind — a
broken shader is a black canvas and nothing else:

```json
{ "compiled": false,
  "compileLog": [{ "fragment": "ERROR: 0:58: 'oops' : undeclared identifier" }],
  "movedFromBaseline": { "percentChanged": 19.98, "region": [361,122,912,663] } }
```

The protocol is implemented directly in [`mcp/protocol.mjs`](mcp/protocol.mjs) —
MCP is JSON-RPC 2.0 with a short handshake over newline-delimited stdio, which
costs less to write than to depend on. One rule it enforces: **stdout is the
transport**, so every log goes to stderr. `npm run mcp:test` checks that too.

## one codebase, two runtimes

[`lib/market.js`](lib/market.js) and [`lib/solana.js`](lib/solana.js) hold all
the fetching and modelling — depth bands, log-scale sizing, spiral packing, RPC
failover, the pricing fallback chain, the gated-wallet handling — with no DOM,
no three.js and no localStorage. The pages import them for rendering; the MCP
server imports them for answers.

That's the point: an agent asking about the reef and a human looking at it are
told the same thing by the same code, instead of a second implementation that
drifts. It also means the fragile parts are testable without a browser at all.

The extraction was verified by the baselines from the section above: after
moving every data function out of `reef.js`, the rendered page still matched
its reference **to the pixel**.

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

Each page's settled scene is committed under `baselines/<platform>-<arch>/` —
per-platform, because the site asks for `-apple-system` and `Menlo` and a Linux
runner substitutes neither. A run decodes both
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
| `lib/describe.js` | the organism in words — the ?agent=1 view |
| `lib/market.js` | the reef's data + modelling, browser and node |
| `lib/trend.js` | the shape of a move: sparklines, week-vs-day, breadth |
| `lib/provenance.js` | where the numbers came from, and whether they're real |
| `lib/snapshot.js` | the published feed: what goes in it, and when to refuse |
| `tools/snapshot.mjs` | `npm run snapshot` — run the data layer in node, write it out |
| `lib/solana.js` | chain access, read-only, browser and node |
| `mcp/server.mjs` | the site as tools for agents |
| `mcp/protocol.mjs` | MCP over stdio, ~120 lines, no dependencies |
| `tools/check.mjs` | `npm run check` — parse, resolve, verify promises |
| `tools/smoke.mjs` | `npm run smoke` — boot every page and assert it's alive |
| `tools/cdp.mjs` | a browser driver in ~100 lines, zero dependencies |
| `fixtures/` | one recorded response per api, refusals included |
| `agent.json` | the agent-facing card |

## notes

- Adaptive quality: mesh detail and pixel ratio step down automatically on slow devices.
- No trackers, no cookies, no analytics. One creature.
