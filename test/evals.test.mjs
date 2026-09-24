/* the scoreboard and the regression rule. the thing to get right is
   what counts as a regression: too strict and a moving market turns it
   red, too loose and the day a fetch starts needing a browser goes
   unnoticed. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreboard, compare, baselineOf, TIERS, TIER_COST } from "../lib/evals.js";

const R = (id, over = {}) => ({ id, question: `${id}?`, tier: "feed", ok: true, calls: 1, ...over });

test("tiers are ordered cheapest first", () => {
  assert.equal(TIERS[0], "feed");
  assert.equal(TIERS.at(-1), "unanswerable");
  assert.ok(TIER_COST.feed < TIER_COST.clone);
  assert.ok(TIER_COST.clone < TIER_COST.browser);
});

test("the scoreboard counts what ran, not what was skipped", () => {
  const b = scoreboard([R("a"), R("b", { skipped: true }), R("c", { ok: false })]);
  assert.equal(b.total, 3);
  assert.equal(b.ran, 2);
  assert.equal(b.skipped, 1);
  assert.equal(b.answered, 1);
  assert.equal(b.failed, 1);
});

test("the backlog is everything an agent cannot fetch, worst first", () => {
  const b = scoreboard([
    R("cheap"), R("needs-node", { tier: "clone" }),
    R("needs-chrome", { tier: "browser" }), R("nothing", { tier: "unanswerable" }),
  ]);
  assert.deepEqual(b.backlog.map((x) => x.id), ["nothing", "needs-chrome", "needs-node"]);
  assert.ok(!b.backlog.some((x) => x.id === "cheap"), "a plain fetch is not backlog");
});

test("a question that got more expensive is a regression", () => {
  const d = compare([R("x", { tier: "browser" })], [{ id: "x", tier: "feed", ok: true, calls: 1 }]);
  assert.equal(d.ok, false);
  assert.match(d.regressions[0].why, /feed → browser/);
});

test("a question that stopped being answerable is a regression", () => {
  const d = compare([R("x", { ok: false, detail: "404" })], [{ id: "x", tier: "feed", ok: true, calls: 1 }]);
  assert.equal(d.ok, false);
  assert.match(d.regressions[0].why, /was answerable/);
});

test("getting cheaper is an improvement, not a failure", () => {
  const d = compare([R("x", { tier: "feed" })], [{ id: "x", tier: "browser", ok: true, calls: 1 }]);
  assert.equal(d.ok, true);
  assert.match(d.improvements[0].why, /browser → feed/);
});

test("a new question is never a failure", () => {
  const d = compare([R("brand-new")], []);
  assert.equal(d.ok, true);
  assert.deepEqual(d.added.map((a) => a.id), ["brand-new"]);
});

test("a skipped question neither passes nor regresses", () => {
  const d = compare([R("x", { skipped: true })], [{ id: "x", tier: "feed", ok: true, calls: 1 }]);
  assert.equal(d.ok, true);
  assert.deepEqual(d.regressions, []);
});

test("a question that disappeared is noticed but does not fail the run", () => {
  const d = compare([], [{ id: "gone", tier: "feed", ok: true, calls: 1 }]);
  assert.deepEqual(d.removed.map((r) => r.id), ["gone"]);
  assert.equal(d.ok, true);
});

test("the baseline records the shape and never the answers", () => {
  const b = baselineOf([R("b", { answer: "btc is up 8%" }), R("a", { skipped: true }), R("c")]);
  assert.deepEqual(b.map((x) => x.id), ["b", "c"], "sorted, and skipped ones left out");
  for (const row of b) {
    assert.deepEqual(Object.keys(row).sort(), ["calls", "id", "ok", "tier"]);
    assert.ok(!("answer" in row), "answers change hourly — committing them would be noise");
  }
});
