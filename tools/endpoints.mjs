/* ================================================================
   endpoints — the one list of what gets recorded.

   record-fixtures.mjs writes these; drift.mjs re-fetches them and
   compares shapes. If each kept its own copy they would eventually
   disagree, and the drift checker would confidently compare the wrong
   url to the wrong file — a drift checker that has itself drifted.
   ================================================================ */

export const CG = "https://api.coingecko.com/api/v3";
export const RPC = "https://solana-rpc.publicnode.com";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
/** binance's hot wallet: public, read-only, and reliably enormous */
export const WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** each entry: one fixture file and how to fetch its live counterpart */
export const HTTP_FIXTURES = [
  { file: "cg-markets.json", label: "coingecko markets",
    url: `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&sparkline=true&price_change_percentage=1h,24h,7d` },
  { file: "cg-global.json", label: "coingecko global", url: `${CG}/global` },
  { file: "cg-trending.json", label: "coingecko trending", url: `${CG}/search/trending` },
  { file: "cg-eco.json", label: "coingecko solana ecosystem",
    url: `${CG}/coins/markets?vs_currency=usd&category=solana-ecosystem&order=market_cap_desc&per_page=40&sparkline=true&price_change_percentage=1h,24h,7d` },
  { file: "cg-token-price.json", label: "coingecko token price",
    url: `${CG}/simple/token_price/solana?contract_addresses=${SOL_MINT}&vs_currencies=usd&include_24hr_change=true` },
  { file: "fng.json", label: "fear & greed", url: "https://api.alternative.me/fng/" },
  { file: "jup-tokens.json", label: "jupiter verified tokens",
    url: "https://lite-api.jup.ag/tokens/v2/tag?query=verified", timeout: 40_000, trimmed: true },
  { file: "jup-price.json", label: "jupiter prices",
    url: `https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}` },
];

/** the rpc methods recorded into solana-rpc.json, in order */
export const RPC_CALLS = [
  { method: "getRecentPerformanceSamples", params: [1] },
  { method: "getEpochInfo", params: [] },
  { method: "getBalance", params: [WALLET] },
  { method: "getSlot", params: [] },
  // recorded as a refusal on purpose — every free endpoint gates this
  { method: "getTokenAccountsByOwner",
    params: [WALLET, { programId: SPL_TOKEN_PROGRAM }, { encoding: "jsonParsed" }],
    expectRefusal: true },
];
