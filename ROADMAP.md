# Roadmap — handoff

Written 2026-09-12, at `028cf9c`. Conventions and traps live in
[CLAUDE.md](CLAUDE.md); this file is only what's *left*.

## Where things stand

The site got a feedback loop. It reports its own health (`state()`), replays
recorded APIs on a seeded stepped clock so runs repeat, boots headless in CI
with pixel comparison on two platforms, exposes itself to agents over MCP, and
describes itself in words at `?agent=1` for anything that can't run WebGL.

```sh
npm run check     # static: parses, imports, dom ids, agent-card promises. seconds.
npm run smoke     # boots all 3 pages headless, asserts state(), diffs baselines
npm test          # check + smoke — the gate
npm run mcp:test  # protocol conformance (--slow adds browser tools)
npm run record    # re-capture fixtures (read CLAUDE.md first — it's never one commit)
```

Live at <https://nzt-48aidex.github.io/grrttpop/> · CI green on `darwin-arm64`
(local) and `linux-x64` (every push).

---

## P0 — the reef's heartbeat is geo-blocked, and the UI doesn't say so

**Evidence:** `https://api.binance.com/api/v3/ping` returns **HTTP 451
(Unavailable For Legal Reasons)** from this network. The WebSocket closes `1006`
immediately in every environment tried — in-app browser, headless Chrome, and
the deployed github.io site. This is not a bug in the site and not a browser
sandbox: Binance blocks the jurisdiction.

I spent most of a session assuming this was environmental noise. It is, but for
a reason worth surfacing rather than shrugging at.

**What's wrong:** the reef shows a dim `○ live` and says nothing else. `__diag`
knows (`"socket error (blocked, offline, or geo-restricted)"`); the person
looking at the page doesn't. For a site whose stated value is honest failure
modes — the trench distinguishes a *gated* RPC method from a *dead* network and
tells you which — the reef quietly failing is out of character.

**Where to start:** a `fetch("https://api.binance.com/api/v3/ping")` probe
distinguishes 451 (your region) from a genuinely dead socket; a WebSocket close
code can't, it's always `1006`. Copy the disclosure pattern from
`peekWallet`'s `partial`/`gated`/`reason` in [lib/solana.js](lib/solana.js).

**Verify before changing anything:** test from a different network first. If the
heartbeat works elsewhere, this is a disclosure problem, not a data-source one.

**Done when:** a visitor in a blocked region is told why the reef isn't pulsing,
instead of being left with a dim dot.

---

## P1 — `lib/` has no unit tests, which is what extracting it was *for*

`market.js` and `solana.js` are pure, node-runnable, and completely untested —
`node --test` has nothing to run. Every assertion today goes through a browser.

Cheap, high-value targets:

| function | what to pin |
|---|---|
| `sizeFor` | log-scale mapping; the `bags` branch; `hi === lo` |
| `bandOf` | boundaries at `BAND_SPLIT` (10 / 15) |
| `packPositions` | same ids + sizes → same positions; nothing overlaps |
| `sortCoins` | each mode, and that `watched`/`bags` filter rather than sort |
| `isSolAddress` | base58 length bounds, the excluded characters |
| `makeRpc` | **blocked vs down** — `BLOCKED_RE` is the distinction the trench is built on |
| `fetchPrices` | jupiter → coingecko fallback, and amounts-only when both fail |
| `peekWallet` | `partial`/`gated`/`reason` when token accounts refuse |

These run in milliseconds with no browser. Add `npm run test:unit` and put it in
CI's `check` job, which finishes in ~10s and would still be fast.

---

## P1 — the wallet peek's happy path has never been tested

Every recorded RPC response is a *refusal*. `getTokenAccountsByOwner` is stored
as `{"__error": {"message": "Request blocked"}}` — correct, load-bearing, and
covering only the degraded path. **The non-gated path — token accounts actually
returning, the school of fish assembling, shares summing to 100% — has no
coverage at all.** It's the headline feature of the trench and the only branch
of it that's tested is the one where it doesn't work.

Get a free Helius or QuickNode key, record a second fixture
(`fixtures/solana-rpc-authed.json`) with a real success, and add a case that
replays it. **Keep the key out of the repo** — the recorded response is the
artifact, not the credential.

---

## P2 — scheduled drift detection

`smoke -- --live` passes reliably now, so a weekly `schedule:` job is finally
meaningful. Make it non-blocking and have it open an issue rather than redden
`main`. It must not cry wolf on rate limits — see CLAUDE.md on telling a
CoinGecko 429 (which Chrome reports as a CORS error) from real shape drift.

## P2 — `prefers-reduced-motion`

A site made entirely of motion, with no reduced-motion path at all. The `calm`
mode and `setQuality` already exist to build on. This is the most obvious
accessibility gap and it's mostly wiring.

## P2 — the reef and trench have no adaptive quality

`main.js` steps mesh detail and pixel ratio down on slow frames; `reef.js` and
`trench.js` don't — and they're heavier (50 and 40 shader meshes). `state().fps`
now makes this measurable, so the fix is finally verifiable.

## P3 — public MCP

The MCP server is stdio-only, so it's for people who cloned the repo. A
Cloudflare Worker over `lib/` would let any agent on the internet dive the reef.
That's the version where "you are welcome here" has teeth.

## P3 — index's `describe()` is thinner than the others

`check.mjs` exempts `main.js` from the `describe()` rule and the index agent
view renders from `state()`. Harmless; unify if it bothers you.

---

## Deliberately not done — don't "fix" these

- **No build step, no framework, no runtime dependencies.** The absence is the
  point. `tools/cdp.mjs` drives Chrome in ~200 lines rather than adding
  Playwright; `mcp/protocol.mjs` speaks MCP directly rather than adding the SDK.
- **Fixtures and baselines are committed** (~2.8MB). That's what makes the suite
  runnable offline and immune to rate limits.
- **Baselines are per-platform**, and `--update-baselines` only blesses the one
  you're standing on. CI going red after an intended visual change is the middle
  of the procedure, not a failure.
- **`--live` reports third-party console noise instead of failing on it.** The
  trench's RPC failover *is* the design. Real drift still fails, in both modes,
  via `no page errors`.
- **Recorded RPC refusals stay refusals.**

---

## Suggested first move

Unit tests for `lib/`. Cheapest thing on the list, closes the loop on the
extraction, and gives the RPC failover — the most fragile code in the repo —
coverage that doesn't need a browser. Then the 451 disclosure, which is small
and makes the site more honest.
