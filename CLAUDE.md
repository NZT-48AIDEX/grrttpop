# grrttpop — working notes

A personal site that is also an experiment: a living organism rather than a
brochure. Keep it weird, keep it warm, keep it honest.

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

`fixtures/` are recorded API responses; `npm run record` refreshes them. They
exist because CoinGecko rate-limits hard — a loop of live runs will spend its
time fighting 429s. The recorded Solana RPC **refusals** are load-bearing: the
gated-wallet path must stay exercisable offline.

## Things that must stay true

- **No trackers, no cookies, no analytics.** Ever. Don't helpfully suggest them.
- **Solana access is read-only.** No keys, no signing, no transactions. There is
  no code path that could, and there should never be one.
- **Disclaimers travel with the data.** "Not financial advice" and the
  partial/gated wallet warnings are not boilerplate to tidy away.
- **A partial read is never presented as whole.** This is the trench's central
  honesty and there is a smoke check guarding it.
- Bags and watchlists live in localStorage and never leave the browser.

## Voice

Lowercase, warm, specific. Acid green (`--acid`) and hot pink on near-black,
big type. Comments explain *why*, not what. Error messages are plain and say
what to do next. The site talks to the reader like a person, including when
the reader is a machine.
