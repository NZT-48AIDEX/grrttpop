/* ================================================================
   snapshot — the site's own answers, as static files.

   Everything here renders in the browser, which means an agent that
   fetches a page gets an empty shell: `?agent=1` is mounted by
   javascript, and the numbers arrive from a fetch that only happens
   once a browser runs the script. The card says "you are welcome
   here" and then hands a curl an html skeleton.

   So a scheduled job runs the same `lib/` code in node and publishes
   the result. No new implementation and no second source of truth:
   these are literally `describeReef()` and `describeTrench()`, the
   objects the page and the mcp server hand out, written to disk.

   A snapshot is minutes old by construction. That is fine — it says
   so in `data.asOf` — but it must never be *fake*, so the tool that
   writes these refuses a synthetic build outright.
   ================================================================ */

import { reefToText, trenchToText } from "./describe.js";

export const SITE = "https://nzt-48aidex.github.io/grrttpop/";

/** what a published snapshot consists of; the agent card promises these names */
export const SNAPSHOT_FILES = ["index.json", "reef.json", "reef.txt", "trench.json", "trench.txt"];

/**
 * May this be published?
 *
 * The demo reef exists so the page stays alive when coingecko is
 * down, and fixtures exist so tests don't need the network. Both are
 * the right answer in a browser and the wrong thing to publish as a
 * feed: a stale real snapshot is honest, an invented one is not.
 */
export function publishability({ reef = null, trench = null } = {}) {
  const why = [];
  if (!reef && !trench) why.push("there is nothing here");
  if (reef?.data?.synthetic) why.push(`the reef is ${reef.data.source}, not live`);
  if (trench?.data?.synthetic) why.push(`the trench is ${trench.data.source}, not live`);
  return { ok: why.length === 0, why };
}

const manifest = ({ reef, trench, at, every }) => ({
  what: "static snapshots of the reef and the trench, for agents that cannot run javascript",
  why: "this site renders its data in the browser, so curling a page returns an empty shell. " +
       "these files are the same describe() output the pages and the mcp server produce, " +
       "published on a schedule.",
  generatedAt: new Date(at).toISOString(),
  every,
  files: [
    { name: "reef.json", what: "the live crypto market as the reef models it — bands, movers, 7-day shapes, breadth" },
    { name: "reef.txt", what: "the same thing in words, as ?agent=1 renders it" },
    { name: "trench.json", what: "solana mainnet vitals and the spl ecosystem" },
    { name: "trench.txt", what: "the same thing in words" },
  ],
  /* `every` is a hope; `asOf` is a fact. github's scheduler has run this
     repo's crons hours late, so a reader that trusts the cadence over the
     timestamp will be wrong, and confidently. */
  freshness: "every file carries a `data` block with `source`, `asOf` and `synthetic`. " +
             "asOf is the only honest statement of age — a snapshot can be hours older " +
             "than `every` suggests. nothing here is ever published from the demo reef " +
             "or from recorded fixtures.",
  live: SITE,
  interactive: "add ?agent=1 to any page for the same text, current to the second — needs javascript",
  mcp: "node mcp/server.mjs from the repo, for tools rather than files",
  limits: [
    "market data only — no trading, no custody, not financial advice",
    "solana access is read-only: no keys, no signatures, no transactions",
    "no trackers, no cookies, no analytics — fetching these costs you nothing but bytes",
  ],
});

/**
 * Assemble the published files. Pure: strings in, strings out, so the
 * whole thing is testable without a network or a disk.
 */
export function buildSnapshot({ reef = null, trench = null, at = Date.now(),
                               every = "when the publisher runs" } = {}) {
  const j = (v) => JSON.stringify(v, null, 2) + "\n";
  const files = { "index.json": j(manifest({ reef, trench, at, every })) };
  if (reef) {
    files["reef.json"] = j(reef);
    // `live: null` — a snapshot has no websocket, and saying "not connected"
    // would read as a broken heartbeat rather than an absent one
    files["reef.txt"] = reefToText(reef, { live: null }) + "\n";
  }
  if (trench) {
    files["trench.json"] = j(trench);
    files["trench.txt"] = trenchToText(trench) + "\n";
  }
  return files;
}
