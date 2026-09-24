/* ================================================================
   solana — the trench's chain access, with no trench attached.

   Runs unchanged in a browser and in node. Strictly read-only: this
   module can read balances and token accounts and nothing else. It
   holds no keys, signs nothing, and sends no transactions. There is
   no code path here that could.

   The interesting part is honesty about refusal. Every free public
   endpoint blocks getTokenAccountsByOwner — it's an indexed method
   gated behind api keys — so a wallet read can succeed partially.
   That case is reported as `partial`/`gated`, never smoothed over.
   ================================================================ */

import { trendOf, weekShape } from "./trend.js";
import { provenanceOf } from "./provenance.js";

export const CG = "https://api.coingecko.com/api/v3";
export const RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://endpoints.omniatech.io/v1/sol/mainnet/public",
  "https://api.mainnet-beta.solana.com",
];
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",              // spl-token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",              // token-2022
];
export const ECO_COUNT = 40;

/* a gated method and a dead network look the same from the outside
   unless you read the message */
const BLOCKED_RE = /blocked|forbidden|paid|not allowed|upgrade|api key|unauthor|payment/i;

export const isSolAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s).trim());
export const hostOf = (u) => { try { return new URL(u).host; } catch { return "?"; } };

export const jfetch = (url, ms = 8000, f = fetch) =>
  f(url, { signal: AbortSignal.timeout(ms) })
    .then(async (r) => {
      if (r.ok) return r.json();
      // same reason as market.js: a recorded failure should be diagnosable
      const err = new Error(String(r.status));
      err.status = r.status;
      err.url = url;
      err.body = await r.text().then((t) => t.slice(0, 500)).catch(() => null);
      throw err;
    });

/* ---------------- rpc with failover ---------------- */
/**
 * Build an rpc caller over a pool of endpoints. `custom` (your own
 * helius/quicknode url) always goes first — it's the only one likely
 * to answer the gated methods.
 * onEvent({ kind }) lets a caller record per-endpoint refusals.
 */
export function makeRpc({ custom = "", pool = RPCS, fetch: f = fetch, onEvent = () => {}, timeout = 15_000 } = {}) {
  const endpoints = () => (custom ? [custom, ...pool] : pool);
  let idx = 0;
  let connected = false;

  async function rpc(method, params = []) {
    const list = endpoints();
    let blocked = false;
    for (let i = 0; i < list.length; i++) {
      const url = list[(idx + i) % list.length];
      try {
        const r = await f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(timeout),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || j?.error) {
          const msg = String(j?.error?.message ?? r.status);
          if (BLOCKED_RE.test(msg)) blocked = true;
          throw new Error(msg);
        }
        idx = (idx + i) % list.length;
        connected = true;
        onEvent({ kind: "ok", method, host: hostOf(url) });
        return j.result;
      } catch (err) {
        onEvent({ kind: "fail", method, host: hostOf(url), message: err?.message ?? String(err), blocked });
      }
    }
    if (!blocked) connected = false;   // a gated method isn't a dead connection
    const err = new Error("solana rpc unreachable");
    err.blocked = blocked;
    throw err;
  }

  rpc.state = () => ({ connected, endpoint: hostOf(endpoints()[idx] ?? ""), poolSize: endpoints().length, custom: !!custom });
  rpc.endpoints = endpoints;
  return rpc;
}

/* ---------------- network vitals ---------------- */
export async function fetchVitals(rpc) {
  const out = { tps: null, epoch: null, epochPct: null, errors: [] };
  try {
    const s = (await rpc("getRecentPerformanceSamples", [1]))?.[0];
    if (s) out.tps = Math.round(s.numTransactions / s.samplePeriodSecs);
  } catch (err) { out.errors.push({ call: "getRecentPerformanceSamples", message: err?.message ?? String(err) }); }
  try {
    const e = await rpc("getEpochInfo");
    out.epoch = e.epoch;
    out.epochPct = Math.round((e.slotIndex / e.slotsInEpoch) * 100);
    out.slotsInEpoch = e.slotsInEpoch;
    out.absoluteSlot = e.absoluteSlot;
  } catch (err) { out.errors.push({ call: "getEpochInfo", message: err?.message ?? String(err) }); }
  return out;
}

/* ---------------- ecosystem + pricing ---------------- */
export function fetchEcosystem({ count = ECO_COUNT, fetch: f = fetch } = {}) {
  return jfetch(`${CG}/coins/markets?vs_currency=usd&category=solana-ecosystem&order=market_cap_desc` +
    `&per_page=${count}&sparkline=true&price_change_percentage=1h,24h,7d`, 20_000, f);
}

export async function loadTokenList({ fetch: f = fetch } = {}) {
  const arr = await jfetch("https://lite-api.jup.ag/tokens/v2/tag?query=verified", 20_000, f);
  return new Map(arr.map((t) => [t.id, { symbol: t.symbol, name: t.name, logoURI: t.icon }]));
}

/** jupiter first, coingecko-by-contract as a fallback, amounts-only if both fail */
export async function fetchPrices(mints, { fetch: f = fetch, onEvent = () => {} } = {}) {
  const out = new Map();
  try {
    for (let i = 0; i < mints.length; i += 50) {
      const j = await jfetch("https://lite-api.jup.ag/price/v3?ids=" + mints.slice(i, i + 50).join(","), 8000, f);
      for (const [mint, d] of Object.entries(j))
        if (d?.usdPrice != null) out.set(mint, { price: d.usdPrice, chg: d.priceChange24h ?? 0 });
    }
    if (out.size) return out;
  } catch (err) { onEvent({ kind: "prices", source: "jupiter", message: err?.message ?? String(err) }); }
  try {
    for (let i = 0; i < mints.length; i += 80) {
      const j = await jfetch(`${CG}/simple/token_price/solana?contract_addresses=` +
        mints.slice(i, i + 80).join(",") + "&vs_currencies=usd&include_24hr_change=true", 8000, f);
      for (const [mint, d] of Object.entries(j))
        if (d?.usd != null) out.set(mint, { price: d.usd, chg: d.usd_24h_change ?? 0 });
    }
  } catch (err) { onEvent({ kind: "prices", source: "coingecko", message: err?.message ?? String(err) }); }
  return out;
}

/* ---------------- wallet peek (read-only) ---------------- */
const SOL_META = {
  symbol: "SOL", name: "Solana",
  logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
};

/**
 * Read a public address's holdings. Never throws on a gated endpoint —
 * returns what it could read plus `partial`/`gated`, so a caller can
 * say so rather than presenting a fragment as the whole wallet.
 */
export async function peekWallet(addr, { rpc, limit = 24, fetch: f = fetch, onEvent = () => {} } = {}) {
  if (!isSolAddress(addr)) throw new Error("not a solana address");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let gated = false;

  // token-account reads are gated on free endpoints: retry transient
  // failures, but a hard block is final — don't stall on it
  async function accountsFor(programId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await rpc("getTokenAccountsByOwner", [addr, { programId }, { encoding: "jsonParsed" }]);
      } catch (e) {
        if (e.blocked) { gated = true; return null; }
        if (attempt < 2) await sleep(700 * (attempt + 1));
      }
    }
    return null;
  }

  const [bal, list, ...accounts] = await Promise.all([
    rpc("getBalance", [addr]).catch(() => null),
    loadTokenList({ fetch: f }).catch((err) => { onEvent({ kind: "tokenlist", message: err?.message }); return new Map(); }),
    ...TOKEN_PROGRAMS.map(accountsFor),
  ]);
  /* A read is partial when *any* token program failed, not only when
     all of them did. There are two — spl-token and token-2022 — and a
     free endpoint can answer one while gating the other, which used to
     come back `partial: false, gated: true`: a wallet missing every
     token-2022 holding, presented as whole. The fixtures cannot produce
     that case (one recorded refusal keyed by method fails both calls
     together), so nothing caught it until a live eval asked. */
  const failedReads = accounts.filter((a) => a === null).length;
  const accountsFailed = failedReads === accounts.length;
  const accountsMissing = failedReads > 0;

  const held = [{ mint: SOL_MINT, amount: (bal?.value ?? bal ?? 0) / 1e9 }];
  for (const acc of accounts.flatMap((a) => a?.value ?? [])) {
    const info = acc.account?.data?.parsed?.info;
    const amt = info?.tokenAmount?.uiAmount;
    if (amt > 0) held.push({ mint: info.mint, amount: amt });
  }

  // prefer verified mints (whale wallets hold thousands of spam tokens);
  // if the list is unavailable, price a capped set so peek still works
  const priceable = list.size
    ? held.filter((h) => h.mint === SOL_MINT || list.has(h.mint))
    : held.slice(0, 150);
  const prices = await fetchPrices(priceable.map((h) => h.mint), { fetch: f, onEvent });

  let items = priceable.map((h) => {
    const meta = h.mint === SOL_MINT ? SOL_META : list.get(h.mint);
    const p = prices.get(h.mint);
    return {
      id: "w:" + h.mint,
      mint: h.mint,
      symbol: meta?.symbol ?? h.mint.slice(0, 4) + "…",
      name: meta?.name ?? "unknown token",
      image: meta?.logoURI ?? "",
      amount: h.amount,
      price: p?.price ?? null,
      chg: p?.chg ?? 0,
      usd: p ? p.price * h.amount : 0,
    };
  });

  items = items.sort((a, b) => b.usd - a.usd).slice(0, limit);   // a school, not a landfill
  const total = items.reduce((s, i) => s + i.usd, 0);
  items.forEach((i) => (i.share = total > 0 ? i.usd / total : 0));

  return {
    address: addr,
    items,
    total,
    tokenListSize: list.size,
    /* the whole point: a partial read announces itself */
    partial: accountsMissing,
    gated,
    /* how much is missing changes what to say about it */
    reason: !accountsMissing ? null
      : accountsFailed
        ? (gated
            ? "free public RPCs block token-account reads — add your own endpoint (free key from helius/quicknode) to see the whole wallet"
            : "rpc unreachable for token accounts — SOL balance only")
        : (gated
            ? `${failedReads} of ${accounts.length} token programs refused — holdings under it are missing. add your own endpoint (free key from helius/quicknode) to see all of them`
            : `${failedReads} of ${accounts.length} token-account reads failed — some holdings are missing`),
  };
}

/** what the trench would look like, for something that cannot see it */
export function describeTrench({ vitals = {}, eco = [], wallet = null, data = null } = {}) {
  const brief = (c) => ({
    id: c.id, symbol: c.symbol?.toUpperCase(), name: c.name,
    price: c.current_price, change24h: c.price_change_percentage_24h_in_currency,
    change1h: c.price_change_percentage_1h_in_currency ?? null,
    change7d: c.price_change_percentage_7d_in_currency ?? null,
    marketCap: c.market_cap,
    trend: trendOf(c),
  });
  const byChange = [...eco].sort((a, b) =>
    (b.price_change_percentage_24h_in_currency ?? 0) - (a.price_change_percentage_24h_in_currency ?? 0));
  return {
    network: { tps: vitals.tps, epoch: vitals.epoch, epochPercent: vitals.epochPct },
    ecosystem: {
      tokens: eco.length,
      rising: eco.filter((c) => (c.price_change_percentage_24h_in_currency ?? 0) >= 0).length,
      topGainers: byChange.slice(0, 5).map(brief),
      topLosers: byChange.slice(-5).reverse().map(brief),
      week: weekShape(eco),
    },
    wallet: wallet && {
      address: wallet.address,
      holdings: wallet.items.length,
      totalUsd: wallet.total,
      partial: wallet.partial,
      gated: wallet.gated,
      reason: wallet.reason,
      top: wallet.items.slice(0, 10).map((i) => ({
        symbol: i.symbol, amount: i.amount, usd: i.usd, share: i.share, mint: i.mint,
      })),
    },
    data: provenanceOf(data ?? {}),
    note: "read-only — no keys, no signatures, no transactions. not financial advice.",
  };
}
