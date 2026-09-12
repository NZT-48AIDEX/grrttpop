# Roadmap — handoff

Last updated 2026-09-12 at `3ec5ab7`, after 21 commits. Conventions and traps
live in [CLAUDE.md](CLAUDE.md) — read that before touching anything; this file
is state and what's next.

**Two things are left, and both need an account I can't create.** Everything
else on the original list is done.

---

## What's left

### 1. Record a real wallet fixture — needs a free RPC key

Every recorded Solana response is a *refusal*, because that's what free public
endpoints actually answer. So in a browser the wallet peek only ever exercises
the degraded path. The happy path — token accounts returning, the school
assembling, shares summing to 100% — is covered by unit tests with an injected
`rpc`, but never end to end in a page.

Get a free Helius or QuickNode endpoint, then:

```sh
node -e 'import("./lib/solana.js").then(async m => {
  const rpc = m.makeRpc({ custom: "https://YOUR-ENDPOINT" });
  console.log(JSON.stringify(await rpc("getTokenAccountsByOwner",
    ["5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
     { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
     { encoding: "jsonParsed" }])));
})' > fixtures/solana-rpc-authed.json
```

**Keep the key out of the repo** — the recorded response is the artifact, not
the credential. Then teach [lib/harness.js](lib/harness.js) to serve it behind a
flag (`?fixtures=authed`) and add a smoke case that asserts a full school.

### 2. Publish the MCP server — needs a Cloudflare account

The server is stdio-only, so it's for people who cloned the repo. A Worker over
`lib/` would let any agent on the internet dive the reef — the version where
*"you are welcome here"* has teeth. `lib/market.js` and `lib/solana.js` already
run anywhere with no DOM and no three.js, so this is a deploy target and an
entrypoint, not a rewrite.

### 3. One open question I couldn't answer from here

**Does the reef's live heartbeat work on an unblocked network?**
`api.binance.com` returns **HTTP 451** from this machine *and* from GitHub's
runners — the jurisdiction is blocked. The reef now detects and explains that,
which is right either way. But if the socket also fails somewhere unblocked,
the data source itself needs replacing, and that's a different fix. Open
`market.html` from another network and look for `● live`.

---

## Where things stand

The site got a feedback loop, then an agent surface, then the accessibility and
resilience work it was missing.

```sh
npm run check      # static: parses, imports + named exports, dom ids,
                   # agent-card promises, fixture age. seconds.
npm run test:unit  # 42 tests over lib/, ~1.2s, no browser
npm run smoke      # 3 pages headless: 12-14 checks each + pixel baselines
npm test           # check + unit + smoke — the gate
npm run mcp:test   # 22 protocol + tool checks (--slow)
npm run record     # re-capture fixtures (read CLAUDE.md — never one commit)
npm run dev        # http-server on :4173
```

Live at <https://nzt-48aidex.github.io/grrttpop/>. CI runs check + unit + mcp in
~20s and the browser job in ~80s on every push, with pixel baselines for
`darwin-arm64` and `linux-x64`. `drift.yml` runs `smoke --live` weekly and
reports rather than blocks.

| | |
|---|---|
| `lib/` | `market.js` `solana.js` — data + modelling, browser **and** node |
| | `diag.js` — `state()`, error buffer, shader logs, ready beacon |
| | `harness.js` — seeded rng, stepped clock, fixture replay, reduced motion |
| | `describe.js` — the organism in words (`?agent=1`) |
| | `quality.js` — when to shed detail (pure policy, no three.js) |
| `tools/` | `check.mjs` `smoke.mjs` `cdp.mjs` `visual.mjs` `record-fixtures.mjs` `mcp-test.mjs` |
| `mcp/` | `server.mjs` (9 read-only tools) · `protocol.mjs` (MCP over stdio, by hand) |
| `test/` | `market.test.mjs` `solana.test.mjs` |

---

## What got done

**Diagnostics.** `state()` on every page — fps, draw calls, shader compile
failures with line numbers, data staleness, socket liveness, per-endpoint RPC
refusals, quality tier, reduced-motion status. A rolling buffer of the last 50
failures. `window.__ready` that doesn't hang in a backgrounded tab.

**Determinism.** `?seed`, `?freeze` (rAF becomes a pump you drive), `?fixtures`
(replay recorded APIs). Off by default; `state().harness` says when they're on.

**A harness with no dependencies.** [tools/cdp.mjs](tools/cdp.mjs) drives Chrome
over CDP in ~200 lines — Node 22 ships `fetch` and `WebSocket`, and WebGL works
headless through SwiftShader. `npm run smoke` asserts against `state()` rather
than pixels, then compares pixels separately with a tolerance.

**The `lib/` extraction**, verified by the baselines: after moving every data
function out of `reef.js`, the render still matched to the pixel.

**MCP**, protocol written directly rather than pulled in. `shader_try` returns
the driver's compile log with line numbers — shader work stopped being a black
canvas and a guess.

**`?agent=1`** — every page renders its live state as text for anything that
can't run WebGL, reachable from the nav as `◫ text`.

**Discovery** — `/.well-known/agent.json`, `llms.txt`, a real card schema, and
`check.mjs` rules so the card can't advertise a tool the server lacks or quietly
drop its `read_only` claim.

**Unit tests** over the branches a live run never reaches: blocked-vs-down
against every phrasing the providers use, the pricing fallback chain, both sides
of the wallet peek.

**The reef explains its silence** — `diagnoseTicks` probes and says *why* the
heartbeat is quiet instead of showing a dim dot and leaving you to guess.

**`prefers-reduced-motion`** on all three pages: stillness, not absence.
`?motion=full` overrides for anyone who wants the motion anyway.

**Adaptive quality** on every page from one shared policy. It only steps down;
recovering upward oscillates.

**Keyboard navigation.** The creatures were pointer-only — you could tab to the
sort buttons and never touch a coin. Each canvas now takes focus and arrow keys
move between creatures inside it, announced through a live region; enter opens
the details and focus follows, escape closes and hands focus back. Plus visible
`:focus-visible` rings (five `outline: none` rules had removed them with nothing
in their place), skip links, and accessible names on the icon-only controls.

---

## Deliberately not done — don't "fix" these

- **No build step, no framework, no runtime dependencies.** The absence is the
  point: `cdp.mjs` instead of Playwright, `protocol.mjs` instead of the MCP SDK.
- **Fixtures and baselines are committed** (~2.8MB). That's what makes the suite
  runnable offline and immune to rate limits.
- **Baselines are per-platform**, and `--update-baselines` blesses only the one
  you're standing on. CI going red after an intended visual change is the middle
  of the procedure, not a failure.
- **`--live` reports third-party console noise instead of failing on it.** The
  trench's RPC failover *is* the design. Real drift still fails, in both modes.
- **Recorded RPC refusals stay refusals.**
- **The quality governor never steps back up.** That's not an oversight.

---

## If you want more to do

Nothing here is needed — the list above is the honest end of the plan. These are
the next things I'd reach for.

- **`describe()` could carry the sparklines**, so an agent gets the shape of a
  trend and not only the latest number.
- **Drift is detected but never diagnosed.** `drift.yml` says "something moved";
  it could diff the live response's *keys* against the recorded ones and name
  the field that changed.
- **The reef and the trench are two near-identical scene files.** Worth
  extracting a shared renderer only if a third page ever appears — not before.
