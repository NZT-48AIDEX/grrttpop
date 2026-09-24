/* chain access, without a chain.
   the failover and the gated-wallet handling are the most fragile code in
   this repo and the hardest to reach through a canvas. every fetch here is
   injected, so these cover the branches a live run never reaches. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeRpc, fetchVitals, fetchPrices, peekWallet, describeTrench, TOKEN_PROGRAMS,
  isSolAddress, hostOf, RPCS, SOL_MINT,
} from "../lib/solana.js";

const WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const ok = (body) => ({ ok: true, json: async () => body });
const rpcOk = (result) => ok({ jsonrpc: "2.0", id: 1, result });
const rpcErr = (message, code = -32602) => ok({ jsonrpc: "2.0", id: 1, error: { code, message } });

/** a fetch that answers per-host from a table; anything unlisted throws */
const fetchByHost = (table, log = []) => async (url, init) => {
  const host = hostOf(url);
  log.push({ host, method: init?.body ? JSON.parse(init.body).method : null });
  const answer = table[host];
  if (!answer) throw new Error("ENOTFOUND " + host);
  return typeof answer === "function" ? answer(init) : answer;
};

test("isSolAddress accepts base58 and rejects the rest", () => {
  assert.ok(isSolAddress(WALLET));
  assert.ok(isSolAddress(SOL_MINT));
  assert.ok(isSolAddress("  " + WALLET + "  "), "surrounding space is trimmed");
  assert.ok(!isSolAddress("too-short"));
  assert.ok(!isSolAddress(""));
  assert.ok(!isSolAddress(WALLET + WALLET), "too long");
  // base58 excludes 0, O, I and l precisely because they look alike
  assert.ok(!isSolAddress("0".repeat(40)));
  assert.ok(!isSolAddress("O".repeat(40)));
  assert.ok(!isSolAddress("l".repeat(40)));
});

test("rpc returns the first endpoint that answers", async () => {
  const log = [];
  const rpc = makeRpc({ fetch: fetchByHost({ "solana-rpc.publicnode.com": rpcOk(42) }, log) });
  assert.equal(await rpc("getSlot"), 42);
  assert.equal(rpc.state().connected, true);
  assert.equal(log.length, 1, "no need to try the others");
});

test("rpc fails over to the next endpoint", async () => {
  const log = [];
  const rpc = makeRpc({
    fetch: fetchByHost({ "solana.drpc.org": rpcOk("second") }, log),   // first host throws
  });
  assert.equal(await rpc("getSlot"), "second");
  assert.deepEqual(log.map((l) => l.host), [hostOf(RPCS[0]), hostOf(RPCS[1])]);
  assert.equal(rpc.state().endpoint, "solana.drpc.org", "and stays on the one that worked");
});

test("rpc sticks to a working endpoint on later calls", async () => {
  const log = [];
  const rpc = makeRpc({ fetch: fetchByHost({ "solana.drpc.org": rpcOk(1) }, log) });
  await rpc("getSlot");
  log.length = 0;
  await rpc("getSlot");
  assert.deepEqual(log.map((l) => l.host), ["solana.drpc.org"], "no re-walking the dead one");
});

test("a gated method is distinguished from a dead network", async () => {
  // this distinction is the whole reason the trench can tell you to bring
  // your own endpoint instead of saying "solana is down"
  const gated = makeRpc({ fetch: async () => rpcErr("Request blocked") });
  const err = await gated("getTokenAccountsByOwner").catch((e) => e);
  assert.equal(err.blocked, true);
  assert.equal(gated.state().connected, false, "never connected, but not because the chain is down");

  const dead = makeRpc({ fetch: async () => { throw new Error("ECONNREFUSED"); } });
  const err2 = await dead("getSlot").catch((e) => e);
  assert.equal(err2.blocked, false, "a refused connection is not a gated method");
});

test("blocked is recognised from every phrasing the providers use", async () => {
  for (const msg of ["Request blocked", "Access forbidden",
                     "chain is not available on free plan, please upgrade to paid plan",
                     "api key required", "unauthorized", "payment required"]) {
    const rpc = makeRpc({ fetch: async () => rpcErr(msg) });
    const err = await rpc("getTokenAccountsByOwner").catch((e) => e);
    assert.equal(err.blocked, true, `"${msg}" should read as gated`);
  }
});

test("a connection that succeeded stays connected when a later method is gated", async () => {
  let call = 0;
  const rpc = makeRpc({ fetch: async () => (++call === 1 ? rpcOk(7) : rpcErr("Request blocked")) });
  await rpc("getSlot");
  assert.equal(rpc.state().connected, true);
  await rpc("getTokenAccountsByOwner").catch(() => {});
  assert.equal(rpc.state().connected, true, "the dot stays lit — the network is fine, the method isn't");
});

test("your own endpoint is tried before the public pool", async () => {
  const log = [];
  const rpc = makeRpc({
    custom: "https://mine.helius-rpc.com/?api-key=x",
    fetch: fetchByHost({ "mine.helius-rpc.com": rpcOk("mine") }, log),
  });
  assert.equal(await rpc("getSlot"), "mine");
  assert.equal(log[0].host, "mine.helius-rpc.com");
  assert.equal(rpc.state().custom, true);
  assert.equal(rpc.state().poolSize, RPCS.length + 1);
});

test("every refusal is reported, with its host and method", async () => {
  const events = [];
  const rpc = makeRpc({
    fetch: fetchByHost({ "api.mainnet-beta.solana.com": rpcOk(1) }),
    onEvent: (e) => events.push(e),
  });
  await rpc("getEpochInfo");
  const failures = events.filter((e) => e.kind === "fail");
  assert.equal(failures.length, 3, "three endpoints refused before the fourth answered");
  assert.ok(failures.every((f) => f.method === "getEpochInfo" && f.host && f.message));
  assert.equal(events.at(-1).kind, "ok");
});

test("fetchVitals reads tps and epoch, and names what failed", async () => {
  const good = await fetchVitals(async (m) =>
    m === "getRecentPerformanceSamples"
      ? [{ numTransactions: 240_000, samplePeriodSecs: 60 }]
      : { epoch: 1032, slotIndex: 216_000, slotsInEpoch: 432_000, absoluteSlot: 9 });
  assert.equal(good.tps, 4000);
  assert.equal(good.epoch, 1032);
  assert.equal(good.epochPct, 50);
  assert.deepEqual(good.errors, []);

  const half = await fetchVitals(async (m) => {
    if (m === "getEpochInfo") throw new Error("nope");
    return [{ numTransactions: 60, samplePeriodSecs: 60 }];
  });
  assert.equal(half.tps, 1);
  assert.equal(half.epoch, null);
  assert.deepEqual(half.errors.map((e) => e.call), ["getEpochInfo"], "says which call died");
});

test("fetchPrices falls back from jupiter to coingecko", async () => {
  const jup = await fetchPrices([SOL_MINT], {
    fetch: async () => ok({ [SOL_MINT]: { usdPrice: 99.5, priceChange24h: -1.5 } }),
  });
  assert.equal(jup.get(SOL_MINT).price, 99.5);

  const events = [];
  const fell = await fetchPrices([SOL_MINT], {
    onEvent: (e) => events.push(e),
    fetch: async (url) => {
      if (url.includes("jup.ag")) throw new Error("jupiter down");
      return ok({ [SOL_MINT]: { usd: 101, usd_24h_change: 2 } });
    },
  });
  assert.equal(fell.get(SOL_MINT).price, 101, "coingecko by contract address picks it up");
  assert.equal(fell.get(SOL_MINT).chg, 2);
  assert.equal(events[0].source, "jupiter", "the fallback is recorded, not silent");

  const none = await fetchPrices([SOL_MINT], { fetch: async () => { throw new Error("offline"); } });
  assert.equal(none.size, 0, "amounts-only rather than throwing");
});

test("fetchPrices batches large wallets", async () => {
  const mints = Array.from({ length: 120 }, (_, i) => "mint" + i);
  const priced = (url) => {
    const ids = new URL(url).searchParams.get("ids")?.split(",")
      ?? new URL(url).searchParams.get("contract_addresses").split(",");
    return ok(Object.fromEntries(ids.map((m) => [m, { usdPrice: 1, usd: 1 }])));
  };

  let jup = 0;
  const got = await fetchPrices(mints, { fetch: async (url) => { jup++; return priced(url); } });
  assert.equal(jup, 3, "jupiter takes 50 at a time, so 120 mints is three requests");
  assert.equal(got.size, 120, "and every mint comes back priced");

  // the coingecko fallback batches at 80, and is only reached when jupiter
  // yields nothing at all — an empty answer counts as nothing
  let cg = 0;
  await fetchPrices(mints, {
    fetch: async (url) => {
      if (url.includes("jup.ag")) return ok({});
      cg++; return priced(url);
    },
  });
  assert.equal(cg, 2, "80 at a time on the fallback");
});

/* ---------------- wallet peek ---------------- */

const tokenListFetch = (extra = []) => async (url) => {
  if (url.includes("jup.ag/tokens")) {
    return ok([{ id: SOL_MINT, symbol: "SOL", name: "Solana", icon: "sol.png" }, ...extra]);
  }
  if (url.includes("jup.ag/price")) {
    return ok(Object.fromEntries([[SOL_MINT, { usdPrice: 100, priceChange24h: 1 }],
      ...extra.map((t) => [t.id, { usdPrice: 2, priceChange24h: 0 }])]));
  }
  throw new Error("unexpected " + url);
};

test("peekWallet refuses a bad address before touching the network", async () => {
  await assert.rejects(() => peekWallet("nope", { rpc: async () => { throw new Error("should not be called"); } }),
    /not a solana address/);
});

test("peekWallet reports a gated read as partial, never as the whole wallet", async () => {
  const rpc = async (method) => {
    if (method === "getBalance") return { value: 9_670_000e9 };
    const e = new Error("Request blocked"); e.blocked = true; throw e;
  };
  const res = await peekWallet(WALLET, { rpc, fetch: tokenListFetch() });

  assert.equal(res.partial, true);
  assert.equal(res.gated, true);
  assert.match(res.reason, /own endpoint/, "and says how to fix it");
  assert.equal(res.items.length, 1, "the SOL balance still comes back");
  assert.equal(res.items[0].symbol, "SOL");
  assert.ok(res.total > 0);
});

test("peekWallet assembles the whole school when token accounts are allowed", async () => {
  // the happy path: no public endpoint will do this, so it is only ever
  // reachable in a test or with your own key
  const accounts = [1, 2, 3].map((n) => ({
    account: { data: { parsed: { info: { mint: "mint" + n, tokenAmount: { uiAmount: n * 10 } } } } },
  }));
  const rpc = async (method) => {
    if (method === "getBalance") return { value: 5e9 };
    if (method === "getTokenAccountsByOwner") return { value: accounts };
    throw new Error("unexpected " + method);
  };
  const extra = [1, 2, 3].map((n) => ({ id: "mint" + n, symbol: "TK" + n, name: "Token " + n, icon: "" }));
  const res = await peekWallet(WALLET, { rpc, fetch: tokenListFetch(extra) });

  assert.equal(res.partial, false, "nothing was refused");
  assert.equal(res.gated, false);
  assert.equal(res.reason, null);
  // 3 token mints x2 programs (both return the same set) + SOL
  assert.ok(res.items.length > 1, "the school is more than one fish");
  assert.ok(res.items.every((i, k, all) => k === 0 || all[k - 1].usd >= i.usd), "sorted by value, descending");
  const shares = res.items.reduce((s, i) => s + i.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9, `shares total 100%, got ${shares}`);
  assert.equal(res.tokenListSize, 4);
});

test("peekWallet keeps the school to its limit", async () => {
  const many = Array.from({ length: 60 }, (_, n) => ({
    account: { data: { parsed: { info: { mint: "mint" + n, tokenAmount: { uiAmount: n + 1 } } } } },
  }));
  const extra = Array.from({ length: 60 }, (_, n) => ({ id: "mint" + n, symbol: "T" + n, name: "t", icon: "" }));
  const res = await peekWallet(WALLET, {
    limit: 5,
    rpc: async (m) => (m === "getBalance" ? { value: 1e9 } : { value: many }),
    fetch: tokenListFetch(extra),
  });
  assert.equal(res.items.length, 5, "a school, not a landfill");
});

test("peekWallet still works when the token list is unavailable", async () => {
  const res = await peekWallet(WALLET, {
    rpc: async (m) => { if (m === "getBalance") return { value: 2e9 }; const e = new Error("Request blocked"); e.blocked = true; throw e; },
    fetch: async (url) => { if (url.includes("tokens")) throw new Error("jupiter down"); return ok({}); },
  });
  assert.equal(res.tokenListSize, 0);
  assert.equal(res.items.length, 1, "unpriced, but the balance is still read");
  assert.equal(res.items[0].usd, 0);
});

test("one token program answering does not make the read whole", async () => {
  /* the case fixtures cannot produce: spl-token answers, token-2022 is
     gated. it used to come back partial:false, gated:true — a wallet
     missing every token-2022 holding, presented as complete. a live
     eval asked and got exactly that. */
  const rpc = async (method, params) => {
    if (method === "getBalance") return { value: 2e9 };
    if (method === "getTokenAccountsByOwner") {
      if (params[1].programId === TOKEN_PROGRAMS[0]) {
        return { value: [{ account: { data: { parsed: { info: {
          mint: "So11111111111111111111111111111111111111112",
          tokenAmount: { uiAmount: 5 },
        } } } } }] };
      }
      const e = new Error("Request blocked");
      e.blocked = true;
      throw e;
    }
    throw new Error("unexpected " + method);
  };
  const w = await peekWallet("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
    { rpc, fetch: async () => { throw new Error("offline"); } });

  assert.equal(w.gated, true);
  assert.equal(w.partial, true, "gated can never mean complete");
  assert.match(w.reason, /1 of 2 token programs refused/);
  assert.ok(w.items.length > 0, "and it still returns what it did read");
});

test("a read that lost nothing is not called partial", async () => {
  const rpc = async (method) => {
    if (method === "getBalance") return { value: 1e9 };
    if (method === "getTokenAccountsByOwner") return { value: [] };
    throw new Error("unexpected " + method);
  };
  const w = await peekWallet("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
    { rpc, fetch: async () => { throw new Error("offline"); } });
  assert.equal(w.partial, false);
  assert.equal(w.reason, null);
});

test("describeTrench carries the partial-read warning into the description", () => {
  const d = describeTrench({
    vitals: { tps: 4000, epoch: 1032, epochPct: 72 },
    eco: [],
    wallet: { address: WALLET, items: [{ symbol: "SOL", amount: 1, usd: 100, share: 1, mint: SOL_MINT }],
              total: 100, partial: true, gated: true, reason: "free public RPCs block token-account reads" },
  });
  assert.equal(d.network.tps, 4000);
  assert.equal(d.wallet.partial, true);
  assert.equal(d.wallet.gated, true);
  assert.match(d.wallet.reason, /block/);
  assert.match(d.note, /read-only/, "the read-only promise travels with the payload");
});
