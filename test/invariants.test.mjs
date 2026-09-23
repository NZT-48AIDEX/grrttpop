/* the invariants themselves. a checker that cannot fail is worse than
   no checker — it reports green forever and everyone believes it — so
   every one of these is exercised in both directions. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAll, INVARIANTS } from "../lib/invariants.js";

const ok = (rows, name) => rows.find((r) => r.name === name)?.ok;
const detail = (rows, name) => rows.find((r) => r.name === name)?.detail;

const reef = (over = {}) => ({
  coins: 2, rising: 1, falling: 1,
  bands: [{ creatures: 2 }],
  biggestGainers: [], biggestLosers: [],
  week: { coinsCounted: 2, spark: "▁█", shapes: { climbing: 1, falling: 1 },
          breadth: { up: 1, down: 1, flat: 0, divergent: 0 } },
  data: { source: "coingecko", synthetic: false, note: null },
  note: "market data only — not financial advice",
  ...over,
});
const trend = (over = {}) => ({
  spark: "▁▂▃", shape: "climbing", direction: "up", divergent: false,
  weekPct: 5, dayPct: 1, rangePct: 10, posInRange: 0.5, high: 2, low: 1, points: 168, ...over,
});
const coin = (over = {}) => ({ symbol: "AAA", price: 1, marketCap: 1e9, trend: trend(), ...over });

test("every invariant has a name and both halves of a check", () => {
  for (const i of INVARIANTS) {
    assert.ok(i.name && typeof i.check === "function" && typeof i.when === "function", i.name);
  }
});

test("a healthy day passes everything that applies", () => {
  const rows = checkAll({ reef: reef(), reefText: "all good", live: true });
  assert.ok(rows.length >= 8, "a fair few applied");
  assert.deepEqual(rows.filter((r) => !r.ok), []);
});

test("bands that lose a creature are caught, with the numbers", () => {
  const rows = checkAll({ reef: reef({ bands: [{ creatures: 1 }] }) });
  assert.equal(ok(rows, "bands account for every creature"), false);
  assert.match(detail(rows, "bands account for every creature"), /1 of 2/);
});

test("breadth that does not sum is caught", () => {
  const r = reef();
  r.week.breadth.flat = 5;
  assert.equal(ok(checkAll({ reef: r }), "breadth sums to the coins it counted"), false);
});

test("a shape outside the vocabulary is caught", () => {
  const r = reef();
  r.week.shapes = { "vibing sideways": 2 };
  const rows = checkAll({ reef: r });
  assert.equal(ok(rows, "every shape is in the vocabulary"), false);
  assert.match(detail(rows, "every shape is in the vocabulary"), /vibing sideways/);
});

test("divergent must actually disagree", () => {
  const same = reef({ biggestGainers: [coin({ trend: trend({ divergent: true, weekPct: 5, dayPct: 3 }) })] });
  assert.equal(ok(checkAll({ reef: same }), "a divergent coin really does disagree with its own week"), false);

  const tiny = reef({ biggestGainers: [coin({ trend: trend({ divergent: true, weekPct: 0.5, dayPct: -3 }) })] });
  assert.equal(ok(checkAll({ reef: tiny }), "a divergent coin really does disagree with its own week"), false);

  const real = reef({ biggestGainers: [coin({ trend: trend({ divergent: true, weekPct: 8, dayPct: -4 }) })] });
  assert.equal(ok(checkAll({ reef: real }), "a divergent coin really does disagree with its own week"), true);
});

test("trend numbers outside their definitions are caught", () => {
  for (const bad of [{ posInRange: 1.5 }, { posInRange: -0.1 }, { rangePct: -1 }, { high: 1, low: 2 }, { points: 3 }]) {
    const rows = checkAll({ reef: reef({ biggestGainers: [coin({ trend: trend(bad) })] }) });
    assert.equal(ok(rows, "trend numbers stay inside their own definitions"), false, JSON.stringify(bad));
  }
});

test("a sparkline made of the wrong characters is caught", () => {
  const rows = checkAll({ reef: reef({ biggestGainers: [coin({ trend: trend({ spark: "▁▂x" }) })] }) });
  assert.equal(ok(rows, "a sparkline is drawn from blocks, or not drawn"), false);
  // an empty one is fine: nothing to draw is a real answer
  assert.equal(ok(checkAll({ reef: reef({ biggestGainers: [coin({ trend: trend({ spark: "" }) })] }) }),
    "a sparkline is drawn from blocks, or not drawn"), true);
});

test("synthetic data must announce itself", () => {
  const rows = checkAll({ reef: reef({ data: { source: "demo", synthetic: true, note: null } }) });
  assert.equal(ok(rows, "the description says where it came from"), false);
});

test("a live recording reported as synthetic is caught", () => {
  const rows = checkAll({ live: true, reef: reef({ data: { source: "fixtures", synthetic: true, note: "replay" } }) });
  assert.equal(ok(rows, "a recording of the real thing is not marked synthetic"), false);
  // and the same data is fine when it is not claiming to be a live recording
  assert.equal(checkAll({ reef: reef({ data: { source: "fixtures", synthetic: true, note: "replay" } }) })
    .find((r) => r.name === "a recording of the real thing is not marked synthetic"), undefined);
});

test("a dropped disclaimer is caught on both pages", () => {
  assert.equal(ok(checkAll({ reef: reef({ note: "market data only" }) }), "the disclaimers survive the modelling"), false);
  assert.equal(ok(checkAll({ trench: { note: "solana stuff", data: { source: "x" } } }),
    "the disclaimers survive the modelling"), false);
});

test("a partial wallet read has to say so in the words too", () => {
  const trench = { note: "read-only", data: { source: "x" },
                   wallet: { partial: true, reason: "gated" } };
  assert.equal(ok(checkAll({ trench, trenchText: "wallet peek · abc" }),
    "a partial wallet read is still labelled partial"), false);
  assert.equal(ok(checkAll({ trench, trenchText: "⚠️ PARTIAL READ — gated" }),
    "a partial wallet read is still labelled partial"), true);
});

test("leaked undefined and friends are caught in the words", () => {
  for (const bad of ["24h undefined", "price NaN", "[object Object]", "mood null"]) {
    const rows = checkAll({ reef: reef(), reefText: `the reef — ${bad} — ok` });
    assert.equal(ok(rows, "nothing leaked into the words"), false, bad);
    assert.match(detail(rows, "nothing leaked into the words"), /reef text contains/);
  }
});

test("an invariant that throws is a finding, not a crash", () => {
  const rows = checkAll({ reef: { bands: "not an array", coins: 1 } });
  const row = rows.find((r) => r.name === "bands account for every creature");
  assert.equal(row.ok, false);
  assert.match(row.detail, /the check itself threw/);
});

test("checks that do not apply are not counted as passes", () => {
  const rows = checkAll({});
  assert.deepEqual(rows, [], "nothing to check means nothing claimed");
});
