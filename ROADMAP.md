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

## ~~P0 — the reef's heartbeat is geo-blocked, and the UI doesn't say so~~ — done

`https://api.binance.com/api/v3/ping` returns **HTTP 451** from this network:
Binance blocks the jurisdiction, which is why the socket closed `1006`
everywhere. The reef now probes and explains itself instead of showing a dim dot
(`diagnoseTicks` in [lib/market.js](lib/market.js), surfaced on `#live-dot` and
in `state().ws.trouble`).

One thing worth knowing if you touch it: **a browser cannot read that 451.**
A cross-origin error response carries no CORS headers, so `fetch` rejects before
any status is visible and a geo-block looks identical to a dead network. The
probe falls back to a `no-cors` request, which still resolves opaquely when the
server answered *something* — enough to say "refused us" rather than "couldn't
reach it". Node reads the 451 directly; the browser says "most likely a regional
block". Both are covered by unit tests.

Still worth doing: **verify from an unblocked network.** If the heartbeat works
elsewhere, everything here is correct. If it doesn't, the data source is the
problem, not the disclosure.

## ~~P1 — `lib/` has no unit tests~~ — done

39 tests over `market.js` and `solana.js` in `test/`, run by `npm run test:unit`
(and `npm test`, and CI's fast job) in ~1.2s with no browser. They cover the
branches a live run never reaches: blocked-vs-down against every phrasing the
providers use, the jupiter→coingecko pricing fallback and its batch sizes, and
both sides of the wallet peek.

`check.mjs` fails if the suite disappears, since "lib/ is testable without a
browser" stops being true the moment nobody tests it.

## ~~P1 — the wallet peek's happy path has never been tested~~ — done in tests

The happy path — token accounts returning, the school assembling, shares summing
to 100%, the limit applied — is now covered by unit tests with an injected
`rpc`. No public endpoint will ever let this run, so a test is the only place it
can exist.

Still open, and needs a human: **record a real fixture** with a free
Helius/QuickNode key so the browser path is exercised end to end too. Keep the
key out of the repo — the recorded response is the artifact, not the credential.

## P2 — scheduled drift detection

`smoke -- --live` passes reliably now, so a weekly `schedule:` job is finally
meaningful. Make it non-blocking and have it open an issue rather than redden
`main`. It must not cry wolf on rate limits — see CLAUDE.md on telling a
CoinGecko 429 (which Chrome reports as a CORS error) from real shape drift.

## ~~P2 — `prefers-reduced-motion`~~ — done

Honoured on all three pages: the creature's displacement and scroll speed drop,
the companion stops spinning, camera parallax and star drift stop, creature bob
and spin stop, the trench's current crawls instead of streaming, trade pulses
soften to a quarter, and both stylesheets collapse CSS animations (which run on
the compositor and ignore the JS clock entirely).

Stillness, not absence — everything stays visible and the data stays live.
`?motion=reduced` / `?motion=full` override the system preference either way.

Smoke checks it per page via CDP media emulation, which is the only way to see
it: the query param is a convenience, and testing only that would leave the real
path — an actual system preference — unverified. I made exactly that mistake
first; the check now emulates the media feature.

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
