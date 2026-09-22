/* ================================================================
   fixture routes — which recording answers which request.

   Two things replay the recorded APIs: the browser harness
   (`?fixtures=1`) and the snapshot tool running offline in node. If
   each kept its own table they would drift, and one of them would
   quietly start testing a different world — the same trap
   `tools/endpoints.mjs` exists to close for the recorder and the
   drift checker.

   Pure data and one matcher. First match wins, so the specific
   patterns come before the general ones.
   ================================================================ */

export const ROUTES = [
  [(u) => u.includes("coins/markets") && u.includes("solana-ecosystem"), "cg-eco.json"],
  [(u) => u.includes("coins/markets"), "cg-markets.json"],
  [(u) => u.includes("/global"), "cg-global.json"],
  [(u) => u.includes("search/trending"), "cg-trending.json"],
  [(u) => u.includes("simple/token_price"), "cg-token-price.json"],
  [(u) => u.includes("alternative.me/fng"), "fng.json"],
  [(u) => u.includes("jup.ag/tokens"), "jup-tokens.json"],
  [(u) => u.includes("jup.ag/price"), "jup-price.json"],
];

/** the fixture file that answers this url, or null if nothing does */
export const routeFor = (url) => ROUTES.find(([match]) => match(url))?.[1] ?? null;

/** every rpc method is recorded in this one file, keyed by method name */
export const RPC_FIXTURE = "solana-rpc.json";
