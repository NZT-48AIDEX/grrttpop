/* the shape of a move. the whole point of this module is that it
   disagrees with the headline percentage sometimes — so these tests are
   mostly pairs of series that end at the same number and should not be
   described the same way. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sparkline, shapeOf, trendOf, trendSentence, priceSeries, indexSeries, weekShape,
} from "../lib/trend.js";

/** 168 hourly points from a function of t in 0..1 */
const week = (f) => Array.from({ length: 168 }, (_, i) => f(i / 167));
const coinOf = (prices, over = {}) => ({ id: "c", sparkline_in_7d: { price: prices }, ...over });

const climb = week((t) => 100 * (1 + 0.2 * t));
const slide = week((t) => 100 * (1 - 0.2 * t));
/* up 8% by the end, but it was up 25% on tuesday — the case this module exists for */
const spike = week((t) => 100 * (1 + (t < 0.4 ? 0.62 * t : 0.25 - 0.28 * (t - 0.4))));
const flat = week(() => 100);

test("sparkline scales to its own range, not to zero", () => {
  const s = sparkline(climb, 8);
  assert.equal(s.length, 8);
  assert.equal(s[0], "▁", "the week's low is the bottom block");
  assert.equal(s.at(-1), "█", "and its high is the top one");
});

test("a flat series draws a flat line, not a crash", () => {
  assert.equal(sparkline(flat, 6), "▄▄▄▄▄▄");
});

test("sparkline downsamples by mean, so a spike survives", () => {
  const spiky = [1, 1, 1, 1, 99, 1, 1, 1, 1, 1, 1, 1];
  assert.ok(sparkline(spiky, 4).includes("█"), "the bucket holding the spike is still tall");
});

test("sparkline is empty rather than wrong when there is nothing to draw", () => {
  assert.equal(sparkline([], 8), "");
  assert.equal(sparkline([5], 8), "");
  assert.equal(sparkline(null, 8), "");
  assert.equal(sparkline([1, NaN, 2, Infinity, 3], 3).length, 3, "non-numbers drop out");
});

test("shapeOf needs a real series before it says anything", () => {
  assert.equal(shapeOf([1, 2, 3]), null);
  assert.equal(shapeOf([]), null);
  assert.equal(priceSeries({ sparkline_in_7d: { price: [1, 2, 3] } }), null);
  assert.equal(priceSeries({}), null);
  assert.ok(priceSeries(coinOf(climb)).length === 168);
});

test("a climb and a faded spike end near the same number and are described differently", () => {
  const up = shapeOf(climb);
  const faded = shapeOf(spike);
  assert.ok(Math.abs(up.weekPct - 20) < 0.5);
  assert.ok(faded.weekPct > 5 && faded.weekPct < 12, "still up on the week");

  assert.equal(up.direction, "up");
  assert.equal(faded.direction, "up", "the week really is up — the number isn't a lie");

  assert.equal(up.divergent, false);
  assert.equal(faded.divergent, true, "but the last day is going the other way");
  assert.equal(faded.shape, "spiked and gave most of it back");
});

test("at the weekly high and at the weekly low are worth saying out loud", () => {
  assert.equal(shapeOf(climb).shape, "climbing, at its weekly high");
  assert.equal(shapeOf(climb).posInRange, 1);
  assert.equal(shapeOf(slide).shape, "falling, at its weekly low");
  assert.equal(shapeOf(slide).posInRange, 0);
});

test("a bounce off the bottom is not the same as still falling", () => {
  const bounced = week((t) => 100 * (t < 0.85 ? 1 - 0.3 * t : 0.745 + 0.25 * (t - 0.85)));
  const s = shapeOf(bounced);
  assert.equal(s.direction, "down");
  assert.ok(s.dayPct > 0, "the last day is green");
  assert.equal(s.divergent, true);
});

test("flat and chop are not directions", () => {
  assert.equal(shapeOf(flat).shape, "flat all week");
  assert.equal(shapeOf(flat).direction, "flat");
  const chop = week((t) => 100 * (1 + 0.05 * Math.sin(t * Math.PI * 10)));   // five round trips, back where it started
  assert.equal(shapeOf(chop).shape, "chopping sideways");
  assert.ok(shapeOf(chop).rangePct > 2, "it moved — it just didn't go anywhere");
});

test("shapeOf shows its working, so a caller can disagree with the thresholds", () => {
  const s = shapeOf(spike);
  for (const k of ["weekPct", "dayPct", "rangePct", "posInRange", "high", "low", "points"])
    assert.ok(Number.isFinite(s[k]), `${k} is a number`);
  assert.equal(s.points, 168);
  assert.ok(s.high > s.low);
});

test("trendOf returns null for a coin that brought no history", () => {
  assert.equal(trendOf({ id: "x" }), null);
  assert.equal(trendOf({ id: "x", sparkline_in_7d: { price: [] } }), null);
  const t = trendOf(coinOf(climb), { width: 10 });
  assert.equal(t.spark.length, 10);
  assert.equal(t.shape, "climbing, at its weekly high");
});

test("the index gives every coin one vote, whatever it costs", () => {
  const cheap = coinOf(week((t) => 0.00002 * (1 + t)));        // +100%
  const dear = coinOf(week((t) => 60000 * (1 - 0.5 * t)));     // -50%
  const idx = indexSeries([cheap, dear]);
  assert.equal(idx.counted, 2);
  assert.equal(idx.series[0], 1, "everything starts at 1");
  assert.ok(Math.abs(idx.series.at(-1) - 1.25) < 0.01, "(2.0 + 0.5) / 2 — not dominated by the big price");
});

test("the index aligns on the most recent point when lengths differ", () => {
  const long = coinOf(week((t) => 100 * (1 + t)));
  const short = coinOf(Array.from({ length: 24 }, (_, i) => 100 + i));
  const idx = indexSeries([long, short]);
  assert.equal(idx.series.length, 24, "trimmed to the shortest week anyone brought");
  assert.equal(idx.counted, 2);
});

test("coins with no series don't sink the index, they just don't vote", () => {
  assert.equal(indexSeries([{ id: "a" }, { id: "b" }]), null);
  assert.equal(indexSeries([]), null);
  assert.equal(indexSeries([{ id: "a" }, coinOf(climb)]).counted, 1);
});

test("weekShape counts breadth, which one index number hides", () => {
  const coins = [
    coinOf(climb), coinOf(climb), coinOf(climb),
    coinOf(slide),
    coinOf(flat),
    coinOf(spike),
  ];
  const w = weekShape(coins);
  assert.equal(w.coinsCounted, 6);
  assert.equal(w.breadth.up, 4, "three climbs and the faded spike are all up on the week");
  assert.equal(w.breadth.down, 1);
  assert.equal(w.breadth.flat, 1);
  assert.equal(w.breadth.divergent, 1, "only the spike is fighting its own number");
  assert.equal(w.shapes["climbing, at its weekly high"], 3);
  assert.ok(w.spark.length > 0);
});

test("weekShape is null rather than fictional when nothing brought history", () => {
  assert.equal(weekShape([]), null);
  assert.equal(weekShape([{ id: "a" }]), null);
});

test("trendSentence says both numbers only when they disagree", () => {
  const steady = trendSentence(trendOf(coinOf(climb)));
  assert.match(steady, /^7d: climbing, at its weekly high — \+20\.\d\d%$/);

  const faded = trendSentence(trendOf(coinOf(spike)));
  assert.match(faded, /spiked and gave most of it back/);
  assert.match(faded, /on the week, -\d+\.\d\d% today$/, "the disagreement is the point");
});

test("trendSentence is empty, not 'undefined', for a coin with no week", () => {
  assert.equal(trendSentence(trendOf({ id: "x" })), "");
  assert.equal(trendSentence(null), "");
});
