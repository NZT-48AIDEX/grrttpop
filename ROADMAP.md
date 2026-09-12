# Roadmap — handoff

Started 2026-09-12; everything below the line got done in the same stretch.
Conventions and traps live in [CLAUDE.md](CLAUDE.md).

**What's actually left is two items, and both need a human with an account** —
see *Blocked on you* immediately below. Everything else is struck through.

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

## Blocked on you

### Record a real wallet fixture (needs a free RPC key)

Every recorded Solana response is a *refusal*, so the browser only ever
exercises the degraded path. The happy path — token accounts returning, the
school assembling — is covered by unit tests with an injected `rpc`, but never
end to end in a page.

Get a free Helius or QuickNode endpoint, then:

```sh
# paste the endpoint into the trench's wallet panel, or:
node -e 'import("./lib/solana.js").then(async m => {
  const rpc = m.makeRpc({ custom: "https://YOUR-ENDPOINT" });
  console.log(JSON.stringify(await rpc("getTokenAccountsByOwner",
    ["5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
     { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
     { encoding: "jsonParsed" }])));
})' > fixtures/solana-rpc-authed.json
```

**Keep the key out of the repo** — the recorded response is the artifact, not
the credential. Then teach `lib/harness.js` to serve it under a flag
(`?fixtures=authed`) and add a smoke case.

### Publish the MCP server (needs a Cloudflare account)

See *P3 — public MCP* below. `lib/` already runs anywhere; it's a deploy target
and a Worker entrypoint.

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

## ~~P2 — scheduled drift detection~~ — done

[.github/workflows/drift.yml](.github/workflows/drift.yml) runs `smoke --live`
every Monday. Advisory only: it never blocks a push, and it opens (or comments
on) a `drift`-labelled issue rather than reddening `main`.

It distinguishes a rate limit from real drift before reporting, because
CoinGecko's 429 arrives without CORS headers and reads in the console exactly
like a broken page. A 429 gets "inconclusive, re-run"; anything else gets "a
provider may have changed shape". It also prints the fixture age on the way past.

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

## ~~P2 — the reef and trench have no adaptive quality~~ — done

All three pages now share one governor ([lib/quality.js](lib/quality.js)): it
watches frame times and says "go down a tier", and each page decides what a tier
means. The reef and trench swap their shared geometry (detail 5 → 3 → 2) and
step the pixel ratio down; the index moved onto the same policy instead of its
own inline copy.

It only ever steps *down*. Recovering upward oscillates: more detail makes
frames slow again, which drops it, forever — a visitor on a weak device would
watch the page pulse between two qualities.

Verified under `Emulation.setCPUThrottlingRate`: at normal speed the reef finds a
sustainable tier and stays there; at 20× slower it walks to the floor. Under the
pumped clock the frame delta is a constant 16.67ms, so deterministic runs never
trigger it and baselines are unaffected — which is what you want.

## P3 — public MCP — needs an account

The MCP server is stdio-only, so it's for people who cloned the repo. A
Cloudflare Worker over `lib/` would let any agent on the internet dive the reef —
the version where "you are welcome here" has teeth. `lib/market.js` and
`lib/solana.js` already run anywhere, so this is mostly a deploy target and a
Worker entrypoint. **Blocked on a Cloudflare account**, which I can't create.

## ~~P3 — index's `describe()` is thinner than the others~~ — done

All three pages now answer `describe()` with the same shape, so an agent can ask
any of them the same question. `check.mjs` lost its `main.js` exemption.

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

## Where the suite stands

```
npm run check      19 scripts · 3 pages · 14 json · agent-card promises · fixture age
npm run test:unit  42 tests, ~1.2s, no browser
npm run smoke      3 pages · 12-14 checks each · baselines on 2 platforms
npm run mcp:test   22 checks (--slow)
```

CI runs check + unit + mcp in ~20s and the browser job in ~80s, on every push.
`drift.yml` runs `smoke --live` weekly and reports rather than blocks.
