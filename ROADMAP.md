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

There is now a second reason. Github delivered 15% of this repo's scheduled
ticks in a measured 10-hour window; cloudflare's cron is a real scheduler. If
the corpus above turns out to want a dependable heartbeat rather than six
samples a day whenever the queue feels like it, that is where it comes from.

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

The snapshot feed is what makes this fixable: it produces a real market state
and then throws it away, because `data` is force-pushed. Keep those and the
repo grows its own corpus of real days, for free, without recording anything
about anybody.

**Measured, 2026-09-22, over a 10-hour window.** The cron asks for minutes 13
and 43 — twenty ticks. Three arrived:

| scheduled run | vs requested | gap |
|---|---|---|
| 13:40Z | +27 min | — |
| 17:45Z | +2 min | 4.08h |
| 21:17Z | +4 min | 3.53h |

So **15% of ticks are delivered**, and the ones that do fire are roughly on
time. That is not lateness, it is dropping — a different failure from
`drift.yml`'s consistent 6h37m lag, and it means the real scheduled cadence is
about **one snapshot every 3.8 hours**, or ~6 a day. Plan against that number,
not against the one in the cron expression.

### Stage 1 — stop discarding the feed ✅ built

`npm run corpus` · [lib/corpus.js](lib/corpus.js) ·
[tools/corpus.mjs](tools/corpus.mjs) ·
[tools/capture-fetch.mjs](tools/capture-fetch.mjs)

Every snapshot run now archives the **raw upstream payloads** — not the derived
`describe()` output, which could only ever test code that already exists — to an
orphan `corpus` branch, force-pushed as one commit so the repo holds the
retained set rather than every snapshot ever taken.

They are captured from the publisher's own responses rather than re-fetched: a
second request would be a different moment and would double the load on a
rate-limited api for the privilege. Each bundle is keyed by the same filenames
`fixtures/` uses, so [tools/fixture-fetch.mjs](tools/fixture-fetch.mjs) replays
a corpus entry with no reader of its own — which is stage 2's whole input, for
free.

**The numbers moved again when measured.** A bundle is **168KB gzipped** from
~532KB of json: 3.2x compression, not the 9x this plan assumed. So 14 days at
~6 a day would be 14.5MB, over the ceiling, and the ladder was redesigned to
spend the budget deliberately instead of letting the cap eat the oldest tier in
silence:

| tier | span | entries |
|---|---|---|
| everything | 3 days | ~19 |
| one a day | 30 days | ~27 |
| one a week | 180 days | ~21 |
| one a month | beyond | trimmed to fit |

Simulated against 120 and 400 days of history, both settle at **60 entries,
9.8MB** — bounded, not merely slowed. Earliest-in-bucket wins so the kept set
does not churn as entries arrive, and the recent window is defended last when
the ceiling bites.

**Incidents are captured, not sampled for.** A run that fails already knows
what no sampler can catch — a 429, an rpc refusal, an api that changed shape —
and those last minutes while the publisher looks every few hours. A refused
publish now writes the incident to `corpus/incidents/` and the workflow
publishes it even when the snapshot step failed, which is exactly when the
rarest recordings exist.

Two honest limits, both in the manifest: an entry holds what the publisher
called, so there is no wallet read in it (`getBalance`, `getSlot`,
`getTokenAccountsByOwner` stay `fixtures/`'s job); and `event` records what
triggered each entry, because pushes cluster in working hours and that bias
should be visible rather than baked in.

### Stage 2 — replay them ✅ built

`npm run scenarios` · [lib/invariants.js](lib/invariants.js) ·
[tools/scenarios.mjs](tools/scenarios.mjs) · `fixtures/scenarios/`

Runs today's code over recorded days and asserts **properties, never
values** — a real market has no expected output, and a test that pins today's
numbers has to be rewritten every time it is right.

Fifteen invariants, each returning the offending value rather than a boolean:
bands account for every creature · breadth and shape counts sum to what they
counted · every shape is in `SHAPES` · a `divergent` coin really does disagree
with its own week · `posInRange` inside [0,1], `high ≥ low`, ≥8 points ·
sparklines drawn from blocks or not drawn · prices finite and non-negative ·
provenance present and synthetic data announcing itself · a live recording not
reported as synthetic · disclaimers surviving · a partial wallet read still
labelled partial in the words · epoch progress a percentage · and the cheapest
one, which catches the most: **no `undefined`, `NaN`, `null` or
`[object Object]` anywhere in the rendered text.** A renamed field shows up
there long before it shows up as an exception.

Sources: `fixtures/` itself, the committed edge cases in `fixtures/scenarios/`
(28KB, all labelled synthetic — an empty market, a coin listed six hours ago
with 6 sparkline points, a week where nothing moved, every decoration endpoint
refusing at once), any local corpus directory, and `--fetch=N` for the newest
bundles off the corpus branch. Corpus entries need no reader of their own: they
are keyed like `fixtures/`, so the same replay shim takes both.

Unlike the loop this one **blocks** — it is a test, and it is in `npm test`.
Verified in both directions: 77/77 invariants across six recorded days,
and an injected bad day fails with `BOOM price -5` naming the invariant.

Building it found a false positive in `check.mjs`: its import scanner used a
lazy `[\s\S]*?` that crossed newlines, so `export const INVARIANTS = [`
scanned forward until a string ended in the word "from" and reported the prose
after it as a missing module. The clause is now restricted to characters an
import clause can contain; every import form is covered by a regression test.

**Trap:** never edit a recording to make a run pass. A real day that breaks an
invariant means the invariant is wrong or the code is — same rule as the
fixtures and their refusals.

### Stage 3 — calibrate the judgements (`npm run calibrate`)

Print the distribution of every label across the corpus, and flag the
degenerate ones — a shape that fires on more than ~60% of coins or fewer than
~1%. Same for `divergent` share, and p50/p90 of `weekPct` and `rangePct`.

This is the only feedback that says whether a judgement is *useful* rather than
merely correct, and it needs a corpus to exist at all.

Be careful what the report claims. With ~6 samples a day it is a distribution
over *sampled moments*, not over the week — though each sample carries 168
hours of history per coin, so for price shape specifically the underlying
series is dense even when the sampling is not. Say which one a number is.

Acceptance: the report runs over any corpus and flags at least the obviously
degenerate case (seed it with a deliberately broken threshold and watch it
complain).

### Stage 4 — evals, not guesses ✅ built

`npm run evals` · [lib/evals.js](lib/evals.js) · [tools/evals.mjs](tools/evals.mjs)
· `evals/baseline.json`

Nine real questions, each with a checker, scored on three things: could it be
answered, how many calls it took, and **what it cost** — a plain fetch of the
published feed, a fetch of the site, a clone with node, or a headless browser.

That last column is the backlog. A question needing chrome is one most agents
will never ask, so the expensive list *is* the priority order, derived rather
than guessed. Today: 8 of 9 answerable from a single fetch each; the wallet
peek needs a clone; only "is the page actually rendering" needs a browser, and
that is the reason `site_state` exists.

`scene-in-words` is worth noting — "what is the reef showing right now, in
words?" used to need a browser, because `?agent=1` is rendered by javascript.
Stage 1's published `reef.txt` moved it to `feed`. That is what an improvement
looks like here, and the baseline records it so the day it moves back is loud.

Only regressions fail: something that was answerable and is not, or something
that got more expensive. A new question is never a failure, and the committed
baseline holds the *shape* — tier, ok, calls — never the answers, which change
hourly.

**Not in `npm test`**, deliberately: these ask the live internet, and a gate
that depends on coingecko's mood is a gate that teaches people to rerun it. The
loop runs them and reports.

**It found a real bug on its first run.** `peek at a public wallet — is what
you got the whole thing?` came back `partial: false, gated: true`. There are
two token programs; `partial` was `accounts.every(a => a === null)`, so a read
where spl-token answered and token-2022 was gated reported itself as complete
while missing every token-2022 holding. The fixtures cannot produce that case —
one recorded refusal keyed by method fails both calls together — so smoke had
only ever seen all-or-nothing. Fixed, with a regression test for the mixed
case, and the eval's checker now asserts the shape directly: gated can never
mean complete.

That is the whole argument for this stage. Every other signal here says "is it
correct". This one asked "can you actually get at it", and the first honest
answer was a hole in the honesty the site is built around.

### Stage 5 — close the loop ✅ built

`npm run loop` · [tools/loop.mjs](tools/loop.mjs) ·
[.github/workflows/loop.yml](.github/workflows/loop.yml)

Built first, out of order, because a plan written on one morning had two of its
numbers invalidated by that evening — and every stage below will want the same
correction, continuously. A loop that only closes once everything else exists
is a loop that never gets to correct anything.

It reports five sections that exist today — suite, fixture age, feed health,
**delivered cadence** (measured from the run history, rather than quoting a
number that goes stale), and a calibration slice over the live feed — and three
that do not: corpus, scenarios, evals. **Absent is a reported status, not a
pass.** A report that quietly omitted its missing halves would read as all
green, which is the exact failure this repo's testing position exists to
prevent.

It names one thing to start on, worst first, and it never blocks.

Two things the building of it taught, which change the stages below:

- **A "never fires" flag is wolf-crying below a real sample count.** On a
  rising day `falling, at its weekly low` does not fire because nothing is
  falling. Flagging that every green day is how a drift checker earns being
  ignored — `lib/calibrate.js` holds those flags until `DEAD_LABEL_SAMPLES`
  (20) independent samples exist, and says plainly that it is looking at a
  moment rather than a distribution.
- **Schedule-only reporting does not work here.** 15% tick delivery means a
  weekly cron mostly does not happen, so the workflow also runs on push with a
  seven-day staleness guard. Assume the same for anything else on a timer.

Run it locally before starting work; it is faster than waiting for the cron and
it is the same report.

### How an agent picks the next thing

1. Read [CLAUDE.md](CLAUDE.md), then this section.
2. Run **`npm run loop`**. It names one thing. **That is the work** — not the
   most interesting item on it, the named one. (`npm test`, `npm run
   scenarios` and `npm run evals` are what it runs on your behalf as they come
   to exist.)
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
reports rather than blocks; `snapshot.yml` publishes the `data` branch twice an
hour and on every push — nominally: github's scheduler here runs hours late and
drops ticks, so `data.asOf` is the only honest age.

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
| `tools/` | `check.mjs` `smoke.mjs` `cdp.mjs` `serve.mjs` `visual.mjs` `record-fixtures.mjs`
             `mcp-test.mjs` `snapshot.mjs` `fixture-fetch.mjs` `drift.mjs` |
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
