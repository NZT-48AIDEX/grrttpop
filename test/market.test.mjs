/* the reef's modelling, without a reef.
   these run in milliseconds and never open a browser — which is the whole
   reason market.js has no DOM in it. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandOf, sizeFor, packPositions, sortCoins, demoData, bagValue,
  fmtPrice, fmtBig, pct, moodEmoji, describeReef, hash, BAND_SPLIT, diagnoseTicks,
} from "../lib/market.js";

const coin = (id, over = {}) => ({
  id, name: id, symbol: id.slice(0, 3), market_cap: 1e9, current_price: 100,
  price_change_percentage_24h_in_currency: 0, ...over,
});

test("bandOf splits the ocean at BAND_SPLIT", () => {
  assert.deepEqual(BAND_SPLIT, [10, 15]);
  assert.equal(bandOf(0), 0);
  assert.equal(bandOf(9), 0, "last of the shallows");
  assert.equal(bandOf(10), 1, "first of the mid waters");
  assert.equal(bandOf(24), 1, "last of the mid waters");
  assert.equal(bandOf(25), 2, "the deep starts here");
  assert.equal(bandOf(999), 2);
});

test("sizeFor scales with log market cap", () => {
  const lo = Math.log(1e6), hi = Math.log(1e12);
  const small = sizeFor(coin("a", { market_cap: 1e6 }), lo, hi);
  const big = sizeFor(coin("b", { market_cap: 1e12 }), lo, hi);
  const mid = sizeFor(coin("c", { market_cap: 1e9 }), lo, hi);
  assert.ok(small < mid && mid < big, "monotonic in market cap");
  assert.ok(small >= 0.55 && big <= 2.6, "stays in the intended range");
  // a trillion is a million times a billion, but only ~2x the radius:
  // the log scale is what keeps btc from filling the screen
  assert.ok(big / small < 5, "log scale, not linear");
});

test("sizeFor survives a degenerate range", () => {
  const s = sizeFor(coin("a"), 5, 5);   // hi === lo: every coin identical
  assert.ok(Number.isFinite(s), "no NaN when the range collapses");
  assert.ok(s > 0);
});

test("sizeFor uses holding value under the bags sort", () => {
  const bags = [{ id: "a", amt: 10 }, { id: "b", amt: 0 }];
  const opts = { sort: "bags", bags };
  const held = sizeFor(coin("a", { current_price: 100 }), 0, 100, opts);
  const empty = sizeFor(coin("b", { current_price: 100 }), 0, 100, opts);
  assert.ok(held > empty, "what you own is bigger than what you don't");
});

test("packPositions is deterministic and never overlaps", () => {
  const items = ["btc", "eth", "sol", "ada", "dot", "xrp", "ltc", "bch"]
    .map((id, i) => ({ id, size: 1 + (i % 3) * 0.4 }));

  const a = packPositions(items);
  const b = packPositions(items);
  assert.deepEqual(a, b, "same ids and sizes give the same reef every time");

  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const gap = Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y);
      assert.ok(gap > a[i].r + a[j].r - 1e-9, `creature ${i} overlaps ${j}`);
    }
  }
});

test("packPositions places the first creature at the centre", () => {
  const [first] = packPositions([{ id: "btc", size: 2 }]);
  assert.deepEqual([first.x, first.y], [0, 0]);
});

test("sortCoins orders and filters per mode", () => {
  const coins = [
    coin("a", { price_change_percentage_24h_in_currency: 5 }),
    coin("b", { price_change_percentage_24h_in_currency: -3 }),
    coin("c", { price_change_percentage_24h_in_currency: 11 }),
  ];

  assert.deepEqual(sortCoins(coins, { sort: "mcap" }).map((c) => c.id), ["a", "b", "c"],
    "mcap keeps the incoming order");
  assert.deepEqual(sortCoins(coins, { sort: "gainers" }).map((c) => c.id), ["c", "a", "b"]);
  assert.deepEqual(sortCoins(coins, { sort: "losers" }).map((c) => c.id), ["b", "a", "c"]);

  // watched and bags filter rather than reorder
  assert.deepEqual(sortCoins(coins, { sort: "watched", watchlist: new Set(["b"]) }).map((c) => c.id), ["b"]);
  assert.deepEqual(sortCoins(coins, { sort: "bags", bags: [{ id: "c", amt: 1 }] }).map((c) => c.id), ["c"]);
  assert.deepEqual(sortCoins(coins, { sort: "watched" }).map((c) => c.id), [],
    "an empty watchlist shows an empty reef, not everything");
});

test("sortCoins does not mutate its input", () => {
  const coins = [coin("a", { price_change_percentage_24h_in_currency: 1 }),
                 coin("b", { price_change_percentage_24h_in_currency: 9 })];
  sortCoins(coins, { sort: "gainers" });
  assert.deepEqual(coins.map((c) => c.id), ["a", "b"]);
});

test("sortCoins tolerates a missing 24h change", () => {
  const coins = [coin("a", { price_change_percentage_24h_in_currency: null }), coin("b", { price_change_percentage_24h_in_currency: 4 })];
  assert.deepEqual(sortCoins(coins, { sort: "gainers" }).map((c) => c.id), ["b", "a"],
    "nulls sink rather than throwing");
});

test("the demo reef is stable for a fixed clock", () => {
  const a = demoData({ now: 1_700_000_000_000 });
  const b = demoData({ now: 1_700_000_000_000 });
  assert.equal(a.length, 40);
  assert.deepEqual(a, b);
  assert.ok(a.every((c) => c.sparkline_in_7d.price.length === 84), "sparklines are populated");
  assert.ok(a[0].market_cap > a[39].market_cap, "ranked by cap, descending");
});

test("bagValue prices holdings against the live list", () => {
  const coins = [coin("btc", { current_price: 50_000 }), coin("eth", { current_price: 3_000 })];
  assert.equal(bagValue([{ id: "btc", amt: 2 }, { id: "eth", amt: 10 }], coins), 130_000);
  assert.equal(bagValue([{ id: "ghost", amt: 5 }], coins), 0, "an unknown coin is worth nothing, not NaN");
  assert.equal(bagValue([], coins), 0);
});

test("formatting handles the empty cases", () => {
  assert.equal(fmtPrice(null), "—");
  assert.equal(fmtBig(null), "—");
  assert.equal(pct(null), "—");
  assert.equal(pct(3), "+3.00%", "gains carry their sign");
  assert.equal(pct(-3), "-3.00%");
  assert.equal(fmtBig(2.5e12), "$2.50T");
  assert.equal(fmtBig(1.5e9), "$1.50B");
  assert.equal(fmtPrice(0.000123), "$0.000123", "small prices keep their digits");
  assert.equal(fmtPrice(1500), "$1,500");
});

test("moodEmoji spans fear to greed", () => {
  assert.equal(moodEmoji(10), "😱");
  assert.equal(moodEmoji(50), "😐");
  assert.equal(moodEmoji(90), "🤪");
});

test("hash is stable and bounded", () => {
  assert.equal(hash("bitcoin"), hash("bitcoin"));
  assert.notEqual(hash("bitcoin"), hash("ethereum"));
  assert.ok(hash("anything") >= 0 && hash("anything") < 1e6);
});

test("describeReef adds up, and carries the disclaimer", () => {
  const coins = Array.from({ length: 30 }, (_, i) =>
    coin("c" + i, { price_change_percentage_24h_in_currency: i % 2 ? 2 : -2 }));
  const d = describeReef(coins, { trending: new Set(["c1"]), mood: 56 });

  assert.equal(d.coins, 30);
  assert.equal(d.rising + d.falling, 30, "every creature is up or down, none lost");
  assert.equal(d.bands.reduce((s, b) => s + b.creatures, 0), 30, "bands account for all of them");
  assert.equal(d.bands.length, 3);
  for (const b of d.bands) assert.equal(b.rising + b.falling, b.creatures);

  assert.equal(d.mood.value, 56);
  assert.ok(d.biggestGainers.length && d.biggestLosers.length);
  assert.ok(d.biggestGainers[0].trending !== undefined, "trending travels with the coin");
  assert.match(d.note, /not financial advice/, "the disclaimer is part of the payload, not the ui");
});

test("describeReef survives an empty market", () => {
  const d = describeReef([], {});
  assert.equal(d.coins, 0);
  assert.equal(d.bands.length, 3);
  assert.equal(d.bands[0].medianChange24h, null, "no median of nothing");
});

/* ---------------- why the heartbeat is quiet ---------------- */

test("diagnoseTicks reads a 451 when cors lets it", async () => {
  const d = await diagnoseTicks({ fetch: async () => ({ ok: false, status: 451 }) });
  assert.equal(d.reason, "geo-blocked");
  assert.match(d.detail, /region/);
  assert.match(d.detail, /unaffected/, "and reassures that the rest of the page is fine");
});

test("diagnoseTicks blames the socket when binance itself answers", async () => {
  const d = await diagnoseTicks({ fetch: async () => ({ ok: true, status: 200 }) });
  assert.equal(d.reason, "socket-blocked");
  assert.match(d.detail, /websocket/i);
});

test("diagnoseTicks distinguishes refused from unreachable in a browser", async () => {
  /* the case this exists for: cross-origin error responses carry no cors
     headers, so a 451 throws before any status is readable and looks exactly
     like a dead network. a no-cors probe still resolves when the server
     answered something at all. */
  const browserish = async (url, opts) => {
    if (opts?.mode !== "no-cors") throw new TypeError("Failed to fetch");
    return {};   // opaque: the server answered, we just can't read it
  };
  const refused = await diagnoseTicks({ fetch: browserish });
  assert.equal(refused.reason, "refused");
  assert.match(refused.detail, /regional block/);
  assert.match(refused.detail, /prices still refresh/, "says what still works");

  const offline = await diagnoseTicks({ fetch: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(offline.reason, "unreachable");
});

test("diagnoseTicks reports an unexpected status rather than guessing", async () => {
  const d = await diagnoseTicks({ fetch: async () => ({ ok: false, status: 503 }) });
  assert.equal(d.reason, "http-503");
  assert.match(d.detail, /503/);
});

/* ---------------- quality governor ---------------- */

test("the quality governor drops a tier only after a bad window", async () => {
  const { makeQualityGovernor, SLOW_FRAME } = await import("../lib/quality.js");
  const seen = [];
  const g = makeQualityGovernor({ window: 10, onChange: (t) => seen.push(t) });

  assert.equal(g.tier, 2, "starts at the top tier");
  for (let i = 0; i < 9; i++) g.frame(0.2);   // slow, but the window isn't full
  assert.equal(g.tier, 2, "no verdict mid-window");
  g.frame(0.2);
  assert.equal(g.tier, 1, "a full slow window costs a tier");
  assert.deepEqual(seen, [1]);

  for (let i = 0; i < 10; i++) g.frame(0.001);   // fast
  assert.equal(g.tier, 1, "good frames never raise it back — that way lies oscillation");
  assert.equal(g.drops, 1);
});

test("the quality governor tolerates the occasional slow frame", async () => {
  const { makeQualityGovernor } = await import("../lib/quality.js");
  const g = makeQualityGovernor({ window: 10 });
  for (let i = 0; i < 30; i++) g.frame(i % 5 === 0 ? 0.2 : 0.001);   // 20% slow
  assert.equal(g.tier, 2, "a fifth of frames slow is not a struggling device");
});

test("the quality governor bottoms out rather than going negative", async () => {
  const { makeQualityGovernor } = await import("../lib/quality.js");
  const g = makeQualityGovernor({ window: 5 });
  for (let i = 0; i < 200; i++) g.frame(1);
  assert.equal(g.tier, 0);
  assert.equal(g.drops, 2, "three tiers means at most two drops");
});
