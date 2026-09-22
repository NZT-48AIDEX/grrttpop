# grrttpop — working notes

A personal site that is also an experiment: a living organism rather than a
brochure. Keep it weird, keep it warm, keep it honest.

Conventions and traps are below. What's *left to do* is in [ROADMAP.md](ROADMAP.md).

## Shape of the thing

No build step. No framework. No bundler. Vanilla ES modules served straight
from disk, with three.js **vendored** in `vendor/` and resolved through an
import map in each HTML file. Do not introduce a build, a framework, or a
runtime dependency without being asked — the absence of them is the point.

```
index.html / market.html / solana.html    three pages, three scenes
main.js / reef.js / trench.js             rendering + DOM for each
lib/                                      shared code, browser AND node
tools/                                    check, smoke, cdp, visual, record
mcp/                                      the site as tools for agents
fixtures/ baselines/                      recorded inputs, expected outputs
```

`lib/` is the rule that matters: `market.js` and `solana.js` hold all fetching
and modelling with **no DOM, no three.js, no localStorage**, so node and the
browser run the same code. New data logic goes there, not in a page file.

## Running it

```sh
npm run dev      # http-server on :4173 — NOT `serve`, which rewrites paths
npm run check    # static check, sub-second, run after every edit
npm run smoke    # boot all three pages headless and assert they're alive
npm test         # check + smoke
npm run mcp:test # mcp protocol conformance
```

`npm run check` is cheap enough to run constantly. `npm run smoke` is the one
that decides whether a change actually works — do not report a rendering change
as done without it.

## Traps that have already bitten

- **`node --check foo.js` exits 0 on a broken file** containing ESM syntax. It
  is a silent no-op on every browser file here. `tools/check.mjs` stages files
  as `.mjs` to force the module parser — don't "simplify" that away.
- **`lib/harness.js` must be the first import** in each page script; it patches
  RNG, the clock and fetch before anything reads them. `check.mjs` enforces this.
- **`proc.killed` does not mean the process died** — node sets it when the
  signal was *delivered*, so `kill(); if (!proc.killed) kill("SIGKILL")` never
  reaches the fallback. A headless chrome that hangs on SIGTERM then lives
  forever on software webgl, spinning a core. This repo left four of them on
  one laptop for ten days; `tools/cdp.mjs` now waits for the real `exit` event
  and reaps on signals too. If a run ever feels absurdly slow, check
  `pgrep -fl "puppeteer/chrome"` before blaming the change.
- **stdout is the MCP transport.** Anything printed there that isn't a JSON-RPC
  message corrupts the stream. Logs go to stderr.
- **CSS animations ignore the virtual clock** — they run on the compositor's.
  Screenshots freeze them with `animation: none` (not `paused`, which stops an
  animation wherever it happens to be).
- **Byte-identical screenshots are not achievable.** Identical runs still differ
  by ~18px from antialiasing rounding. Compare with a tolerance.

## Baselines and fixtures

`baselines/<platform>-<arch>/*.png` are the expected renders; `npm run smoke`
fails if a page moves more than 0.05% of its pixels. Never re-bless to make a
failure go away.

Baselines are **per-platform on purpose**. The site asks for `-apple-system` and
`Menlo`; a Linux runner substitutes different fonts and a different SwiftShader
build, so a macOS baseline can never match there. Two sets are committed:

| set | rendered by | checked by |
|---|---|---|
| `baselines/darwin-arm64/` | a mac running `npm run smoke` | local runs |
| `baselines/linux-x64/` | the ubuntu CI runner | every push |

### Re-blessing after an intended visual change

`--update-baselines` **only updates the platform you are running on.** A mac
cannot produce the Linux set and CI cannot commit the mac one, so any change
that moves pixels takes two rounds. This is the whole procedure:

1. `npm run smoke -- --update-baselines` locally, then commit and push. Your
   platform's set is now correct; the other one is deliberately stale.
2. **CI will fail, and that is the expected outcome** — not something to fix by
   widening the tolerance, deleting the Linux set, or reverting. Read the
   failure: it reports the contiguous row bands that moved. Confirm the mass is
   where your change was. If pixels moved somewhere you did not touch, that is a
   real regression and the rest of this list does not apply yet.
3. Download the `renders-linux-x64` artifact from that failed run
   (`gh run download <id> -n renders-linux-x64 -D <dir>`).
4. **Look at the PNGs before committing them.** A baseline is a promise that
   this is what correct looks like; blessing a broken render locks the bug in.
   Zoom in on anything glyph-shaped — a missing glyph and a real box character
   are nearly identical at normal size on a Linux font stack, and `◫ text` in
   the nav is exactly that risk.
5. Copy them into `baselines/linux-x64/`, commit, push. Both platforms green.

Say in the commit message that baselines were re-blessed and why. A silent
baseline update is indistinguishable from hiding a regression.

`fixtures/` are recorded API responses; `npm run record` refreshes them, and
`fixtures/recorded-at.json` says when they were last captured. They exist
because CoinGecko rate-limits hard — a loop of live runs will spend its time
fighting 429s instead of finding bugs.

The recorded Solana RPC **refusals** are load-bearing. `getTokenAccountsByOwner`
is recorded as `{"__error": {"message": "Request blocked"}}`, because that is
what free endpoints actually answer. Never "fix" a recorded refusal into a
success: it would test a world that does not exist and the gated-wallet path —
the most fragile code here — would stop being exercised.

### Fixtures go stale, and the failure mode is silent

A fixture freezes an API's *shape*, not just its numbers. When a provider
changes its response format, **the site breaks in production while CI stays
green**, because CI is replaying the old shape back to itself. That is the worst
direction for a test suite to fail in: it does not go red, it goes confidently
wrong. `npm run check` verifies the fixtures exist and that `solana-rpc.json`
still has an entry per method — it cannot tell you the shape is out of date.

What it *can* do is say how old the recording is. Past 90 days it prints a
warning (and still passes — staleness is a thing to know, not a reason to stop):

```
⚠️  fixtures/
    recorded 131 days ago (2026-05-04). an api may have changed shape since,
    which this suite cannot see — it would replay the old shape and stay green.
    check with: npm run smoke -- --live
```

Age is a proxy, not evidence: fresh fixtures can already be wrong if a provider
shipped a change yesterday, and year-old ones can be perfectly accurate. The
warning is a nudge to go look, nothing more.

Frozen values are the harmless half. Smoke output reads `epoch 1032 · 72%` and
the same prices on every run, forever. That is expected; it is not live data and
should never be quoted as if it were.

**To check for drift:** two commands, for two halves of the problem.

`npm run drift` catches the quiet half. It re-fetches each fixture's live
counterpart and compares *shapes* — key paths and types, not values — then says
which field moved and, crucially, whether anything reads it:

```
❌ fng.json
     ❌ gone: data[].value_classification  — read by lib/market.js
⚠️  cg-eco.json
     ⚠️  gone: [].roi  (nothing reads it)
```

It fails only on fields the code reads; a provider adding or dropping something
nobody touches is a line of output, not a fire. `DRIFT_LIVE_DIR=<dir>` makes it
read "live" responses from files instead of fetching, which is how it is tested
— a drift checker that needs a cooperative rate-limited API to exercise is a
drift checker nobody exercises.

`tools/endpoints.mjs` is the single list of what gets recorded, shared by the
recorder and the checker. Keep it that way: two copies would drift apart and the
checker would compare the wrong URL to the wrong file. `check.mjs` enforces it.

**`npm run smoke -- --live`** catches the loud half — a response that actually
breaks a page. Read a
failure carefully before believing it — a CoinGecko 429 means you are rate
limited, not that anything drifted. Chrome reports a 429 as a CORS error,
because the error response carries no CORS headers, so the console will look
like a bug in the page. It usually isn't. Wait and retry before investigating.

Live runs print third-party console noise without failing on it: the trench
talks to four public RPCs of which several always refuse, and that failover *is*
the design. Failing on it would mean `--live` could never pass. Real drift still
fails, in both modes — a response whose shape changed under the parser raises a
js error, which `no page errors` catches. Fixtures mode stays strict, since
there is no network variance to excuse.

**To refresh:** `npm run record`. Then be aware it moves the pixels — new prices
mean new creature colours and sizes — so it triggers the full two-platform
re-bless above. Refreshing fixtures is never a one-commit job. Diff the fixtures
before blessing anything: if a field you rely on has been renamed or dropped,
that is a real change to the site, not a baseline update.

## Things that must stay true

- **No trackers, no cookies, no analytics.** Ever. Don't helpfully suggest them.
- **Solana access is read-only.** No keys, no signing, no transactions. There is
  no code path that could, and there should never be one.
- **Provenance travels with the data.** Every description carries
  `data.source` / `data.asOf` / `data.synthetic` from `lib/provenance.js`. The
  demo reef and fixture replay are both `synthetic: true`, and a caller that
  says nothing gets `unknown` — never a silence that reads as live. Smoke fails
  a page that replays fixtures while claiming otherwise.
- **Disclaimers travel with the data.** "Not financial advice" and the
  partial/gated wallet warnings are not boilerplate to tidy away.
- **A partial read is never presented as whole.** This is the trench's central
  honesty and there is a smoke check guarding it.
- Bags and watchlists live in localStorage and never leave the browser.
- **Every page is usable by keyboard**, including the creatures. The scenes are
  `<canvas>`, which has no children to tab through, so each canvas takes focus
  once and arrow keys move a selection *inside* it — the standard composite
  widget arrangement. Every move is announced through a live region, because a
  glowing blob tells a screen reader nothing. Focus follows into an opened card
  and returns to the scene on close. **Never add `outline: none` without a
  `:focus-visible` replacement** — five of those had removed the focus ring from
  every text input with nothing in its place. Smoke drives the reef and the
  trench by keyboard on every run.
- **`prefers-reduced-motion` is honoured on every page.** This site is made of
  movement; for someone with vestibular sensitivity that is a reason to close
  the tab, not a delight. The answer is stillness, not absence — the creature,
  the colours and the live data all stay, they just stop lurching. `?motion=full`
  overrides for anyone who wants it anyway. There is a smoke check per page, and
  it needs CDP media emulation to see: no amount of looking at the page finds a
  regression here.

## Voice

Lowercase, warm, specific. Acid green (`--acid`) and hot pink on near-black,
big type. Comments explain *why*, not what. Error messages are plain and say
what to do next. The site talks to the reader like a person, including when
the reader is a machine.
