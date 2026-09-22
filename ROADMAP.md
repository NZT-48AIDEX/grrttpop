# Roadmap — handoff

Current as of the snapshot + provenance work, 2026-09-22. (No sha here on
purpose: recording one is itself a commit, so it is wrong the moment it lands —
`git log -- ROADMAP.md` is the honest answer.) Conventions and traps live in
[CLAUDE.md](CLAUDE.md) — read that before touching anything; this file is state
and what's next.

**Two things are left from the original list, and both need an account I can't
create.** Everything else on it is done.

What comes after that is not a list of features — it's a loop:
[the next stage](#the-next-stage--a-loop-that-learns-from-real-days) turns the
snapshot feed into a corpus of real days, so the suite stops testing one frozen
afternoon and starts telling you which judgements actually hold up. Read that
before picking anything up.

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

The static feed on the `data` branch now covers *reading*: an agent with no
browser and no clone can curl the reef. What a Worker adds is **asking** — a
wallet peek, a different sort, a question nobody pre-computed. That is the
remaining half.

### 3. One open question I couldn't answer from here

**Does the reef's live heartbeat work on an unblocked network?**
`api.binance.com` returns **HTTP 451** from this machine *and* from GitHub's
runners — the jurisdiction is blocked. The reef now detects and explains that,
which is right either way. But if the socket also fails somewhere unblocked,
the data source itself needs replacing, and that's a different fix. Open
`market.html` from another network and look for `● live`.

---

## The next stage — a loop that learns from real days

Everything in this suite replays **one moment**. `fixtures/` was recorded on
2026-09-11: a falling market, mood 56, ten coins green out of fifty. Every run
since has tested that afternoon, and will keep testing it forever. The paths
that only exist in other worlds are untested by construction:

- a 429 storm — coingecko rate-limiting halfway through a page load
- an all-green day, where `breadth.down` is 0 and the colour range collapses
- a coin listed six hours ago: 6 sparkline points, not 168
- a depeg, where "flat all week" stops being true of the things that are always flat
- an rpc that answers `getEpochInfo` and dies before `getRecentPerformanceSamples`

And the judgement calls have never met a real distribution. `lib/trend.js`
draws its lines at 2% range, 2% net, 0.5% day — tuned against sine waves and
that one frozen afternoon. Nobody knows whether *"chopping sideways"* describes
3% of real coins or 60%. A label that fires on everything says nothing, and no
test will ever report that, because every test agrees with it.

The snapshot feed is what makes this fixable: every 30 minutes it produces a
real market state — and then throws it away, because `data` is force-pushed.
Keep those and the repo grows its own corpus of real days, for free, without
recording anything about anybody.

### Stage 1 — stop discarding the feed

Archive the **raw upstream payloads**, not just the `describe()` output. The
output is derived: replaying it can test nothing you haven't already written.
Tomorrow's `lib/` has to be runnable over yesterday's market.

Sizes are the whole design here. One entry of raw inputs is ~532KB
(`cg-markets` 246KB, `cg-eco` 194KB, trending 88KB); the derived `reef.json` is
8KB. Skip `jup-tokens.json` (342KB and almost static). So:

- gzip each entry (json compresses ~9x, so ≈60KB)
- keep 6-hourly for 14 days, then weekly — ~110 entries, ~7MB steady state
- **plus every weird day, whatever the cadence**: a run whose breadth flips,
  whose index moves more than 10%, whose divergent share doubles, or that
  recorded a refusal. Regular sampling captures the average and the average is
  the part already covered.
- force-push it as an orphan like `data`, so the branch holds the retained set
  and not the sum of all history — otherwise a clone pays for every snapshot
  ever taken

Acceptance: `git clone --single-branch -b corpus` is under 10MB, and
`node tools/corpus.mjs --list` prints entries with dates and why each was kept.

### Stage 2 — replay them (`npm run scenarios`)

A real day has no expected output, so assert **invariants**, never values.
Put them in `lib/invariants.js` — pure, so the unit tests use them too:

- `breadth.up + down + flat === coinsCounted`
- every `divergent` coin has `sign(weekPct) !== sign(dayPct)` and `|weekPct| > 2`
- `posInRange` within [0,1]; `spark.length` is the requested width or 0
- `describeReef`/`describeTrench` never throw on any recorded payload
- the rendered text contains no `undefined`, `NaN`, `null` or `[object Object]`
  — cheap, and it catches most of what actually goes wrong
- the disclaimer is present; a partial wallet read is still labelled partial
- `data.synthetic` is false for archived live entries

Acceptance: `npm run scenarios` passes over the committed
`fixtures/scenarios/` (a handful of labelled edge days, ~360KB) and over a
fetched corpus, naming the entry, the invariant and the offending value on
failure.

**Trap:** never hand-edit a corpus entry to make a run pass. A real day that
breaks an invariant means either the invariant is wrong or the code is. Same
rule as the recorded refusals.

### Stage 3 — calibrate the judgements (`npm run calibrate`)

Print the distribution of every label across the corpus, and flag the
degenerate ones — a shape that fires on more than ~60% of coins or fewer than
~1%. Same for `divergent` share, and p50/p90 of `weekPct` and `rangePct`.

This is the only feedback that says whether a judgement is *useful* rather than
merely correct, and it needs a corpus to exist at all.

Acceptance: the report runs over any corpus and flags at least the obviously
degenerate case (seed it with a deliberately broken threshold and watch it
complain).

### Stage 4 — evals, not guesses (`npm run evals`)

**There is no usage signal here and there must never be one** — no trackers is
not negotiable, and a Worker must not log per-visitor either. So "genuinely
useful" gets measured against the site's own surfaces: a set of real questions
an agent should be able to answer, each with a checker.

- *which coins are up on the week but selling off today?* — one fetch of
  `reef.json`, `direction: "up"` and `divergent: true`
- *is this wallet read complete?* — must answer no, and say gated
- *what is the market doing this week, in one sentence?* — `week.shape` + breadth
- *how old is this data, and is any of it synthetic?* — `data.asOf`, `data.synthetic`
- *did my shader change compile, and what moved?* — `shader_try`

Score each on: answerable at all · how many calls · **and whether it needed a
browser or a clone**. That last column is the backlog, in priority order. It is
the honest version of the question the roadmap keeps asking — what is actually
missing for an agent — and it answers itself.

Acceptance: `npm run evals` prints a table and exits non-zero only on a
regression against the last committed scores.

### Stage 5 — close the loop

Extend `drift.yml`, or add `loop.yml`: weekly, run scenarios + calibrate +
evals over the newest corpus and write the result into an issue the way drift
already reports. Then an agent starting work has fresh feedback context
*before* it runs anything, which is the difference between a loop and a pile of
scripts nobody runs.

### How an agent picks the next thing

1. Read [CLAUDE.md](CLAUDE.md), then this section.
2. Run `npm test`, `npm run scenarios`, `npm run evals`. **The first failure is
   the work.** Not the most interesting failure — the first one.
3. All green? Take the top unanswerable eval question. Not a feature idea.
4. **No new surface without a failing eval or a broken invariant behind it.**
   This site is small and coherent because nothing was ever added on the
   grounds that an agent might enjoy it. That rule is the reason, and it is
   worth more than anything on this list.
5. Write the scenario or the eval first. Watch it fail. Then build.

### Guardrails for this loop

- **No tracking, ever.** Usefulness is measured by evals over our own surfaces,
  never by watching visitors.
- **Invariants, not values.** A real day has no expected output.
- **The corpus is a recording.** Never tune one to pass. Synthetic scenarios
  are allowed and must be labelled synthetic — `provenance.js` already has the
  vocabulary.
- **Keep it cloneable.** Prune, and keep the offline subset committed so the
  whole loop still runs on a plane.
- Nothing here needs an account, a service, or a dependency. If a stage seems
  to, that is a sign it has been designed wrong.

---

## Where things stand

The site got a feedback loop, then an agent surface, then the accessibility and
resilience work it was missing.

```sh
npm run check      # static: parses, imports + named exports, dom ids,
                   # agent-card promises, fixture age. seconds.
npm run test:unit  # 84 tests over lib/, ~1.7s, no browser
npm run snapshot   # run the data layer in node, write the published feed
npm run smoke      # 3 pages headless: 12-15 checks each + pixel baselines
npm test           # check + unit + smoke — the gate
npm run mcp:test   # 22 protocol + tool checks (--slow)
npm run record     # re-capture fixtures (read CLAUDE.md — never one commit)
npm run dev        # http-server on :4173
```

Live at <https://nzt-48aidex.github.io/grrttpop/>. CI runs check + unit + mcp in
~20s and the browser job in ~80s on every push, with pixel baselines for
`darwin-arm64` and `linux-x64`. `drift.yml` runs `smoke --live` weekly and
reports rather than blocks; `snapshot.yml` publishes the `data` branch every
30 minutes.

| | |
|---|---|
| `lib/` | `market.js` `solana.js` — data + modelling, browser **and** node |
| | `diag.js` — `state()`, error buffer, shader logs, ready beacon |
| | `harness.js` — seeded rng, stepped clock, fixture replay, reduced motion |
| | `describe.js` — the organism in words (`?agent=1`) |
| | `quality.js` — when to shed detail (pure policy, no three.js) |
| | `keyboard.js` — reading order and directional neighbour, no DOM |
| | `trend.js` — sparklines, the shape of a week, breadth |
| | `provenance.js` — where the numbers came from, and whether they're real |
| | `snapshot.js` — the published feed, and when to refuse to publish |
| | `fixture-routes.js` — which recording answers which url (browser + node) |
| `tools/` | `check.mjs` `smoke.mjs` `cdp.mjs` `visual.mjs` `record-fixtures.mjs` `mcp-test.mjs`
             `snapshot.mjs` `fixture-fetch.mjs` `drift.mjs` |
| `mcp/` | `server.mjs` (9 read-only tools) · `protocol.mjs` (MCP over stdio, by hand) |
| `test/` | `market.test.mjs` `solana.test.mjs` `shape.test.mjs` `trend.test.mjs`
           `provenance.test.mjs` `snapshot.test.mjs` |

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

**Published snapshots.** Every page renders in the browser, so a curl of
`?agent=1` returned an html shell — the agent card invited people who then had
nothing to fetch. `.github/workflows/snapshot.yml` runs [lib/](lib/) in node
every 30 minutes and force-pushes `index/reef/trench` as json and text to the
orphan `data` branch (nothing on `main`). Same `describe()` output as the pages
and the mcp server, so there's no second implementation to drift. It refuses to
publish anything synthetic and exits non-zero instead: a failed run leaves the
last good snapshot standing.

**Provenance on the structured path.** The demo reef was loud in words and in
`state()`, and silent in `describe()` — so an agent could receive forty invented
coins during a coingecko outage with nothing saying so, and a `?fixtures=1`
replay looked exactly like live data. [lib/provenance.js](lib/provenance.js)
stamps every description with `source` / `asOf` / `synthetic`, "nobody said"
comes back as `unknown` rather than passing for live, and smoke now fails a page
that replays fixtures while claiming to be live.

**The week, not just the number.** Coingecko was returning 168 hourly prices
per coin and the site read the last one. [lib/trend.js](lib/trend.js) reduces
the series to a sparkline and a shape, and flags `divergent` — the week and the
last day pointing opposite ways, which is the case where the headline
percentage actively misleads. It reaches `?agent=1`, `describe()`, the detail
cards and the mcp tools; the thresholds come back with the label so a caller
can disagree with them.

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

Not part of the loop above, and not needed. Parked here so it stops being
rediscovered.

- **The reef and the trench are two near-identical scene files.** Worth
  extracting a shared renderer only if a third page ever appears — not before.
