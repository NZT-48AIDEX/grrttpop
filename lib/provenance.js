/* ================================================================
   provenance — where these numbers came from, travelling with them.

   The reef has a fallback: when coingecko is unreachable it renders
   `demoData()` — invented coins with invented prices — so the page
   stays alive instead of going blank. The text view shouts about it
   and `state()` reports `source: "demo"`, but `describe()` handed the
   same synthetic numbers to callers with nothing attached. An agent
   asking the mcp server what the market is doing during an outage got
   forty made-up coins that looked exactly like real ones.

   Same hole under `?fixtures=1`: a replay of a recording from months
   ago is, structurally, indistinguishable from live data.

   This site's rule is that a partial read is never presented as
   whole. A synthetic read is the same promise. So every description
   carries a stamp saying where it came from, how old it is, and
   whether it is real — and "nobody said" is itself an answer, not a
   silence that reads as "live".
   ================================================================ */

const NOTES = {
  demo: "SYNTHETIC — the market api was unreachable, so these are the demo reef's " +
        "invented coins and invented prices. do not quote them as market data.",
  fixtures: "REPLAY — recorded fixtures are being served (?fixtures=1). these numbers are " +
            "frozen at the time of recording, not live.",
  unknown: "the caller did not say where these numbers came from. treat them as unverified.",
};

/**
 * Stamp a description with its origin.
 *
 * `source` is whoever actually answered ("coingecko", "solana-rpc",
 * "demo", …), `at` is when, and `harness` is the page's deterministic
 * flags if any are on. Replay wins over the named source: a fixture
 * of coingecko is not coingecko.
 */
export function provenanceOf({ source = "unknown", at = null, harness = null, now = Date.now() } = {}) {
  const src = harness?.fixtures && source !== "demo" ? "fixtures" : source;
  const synthetic = src === "demo" || src === "fixtures";
  return {
    source: src,
    asOf: at ? new Date(at).toISOString() : null,
    ageMs: at ? Math.max(0, now - at) : null,
    /* the field to branch on. everything else here is detail. */
    synthetic,
    harness: harness?.on ? harness : null,
    note: NOTES[src] ?? null,
  };
}

/** the stamp as one line, for the views that are made of lines */
export function provenanceLine(p) {
  if (!p) return "source: unstated";
  const age = p.ageMs == null ? "" :
    p.ageMs < 90_000 ? `, ${Math.round(p.ageMs / 1000)}s ago` :
    `, ${Math.round(p.ageMs / 60_000)}m ago`;
  return `source: ${p.source}${p.asOf ? ` · ${p.asOf}${age}` : ""}`;
}
