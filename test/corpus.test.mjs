/* retention. the failure mode is a branch that grows until nobody can
   clone the repo, or one that churns so much it stops being diffable —
   so these are mostly about bounds and stability. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entryName, entryDate, isoWeek, retain, corpusManifest,
  KEEP_ALL_DAYS, SIZE_CAP_MB, ENTRY_KB,
} from "../lib/corpus.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 23, 6, 0);           // 2026-09-23T06:00Z
const at = (daysAgo, hour = 12) => new Date(NOW - daysAgo * DAY + hour * 3600_000);

/** a plausible history: `perDay` entries a day going back `days` */
const history = (days, perDay = 6) => {
  const out = [];
  for (let d = days; d >= 0; d--)
    for (let i = 0; i < perDay; i++) out.push(entryName(at(d, 2 + i * 4)));
  return out;
};

test("a name round-trips to the minute it was taken", () => {
  const d = new Date(Date.UTC(2026, 8, 23, 4, 54));
  assert.equal(entryName(d), "2026-09-23T0454Z.json.gz");
  assert.equal(+entryDate(entryName(d)), +d);
  assert.equal(entryDate("not-an-entry.json"), null);
  assert.equal(entryDate("index.json"), null);
});

test("names sort chronologically as strings", () => {
  const names = [at(0), at(5), at(2)].map(entryName);
  assert.deepEqual([...names].sort(), names.slice().sort((a, b) => entryDate(a) - entryDate(b)));
});

test("iso weeks are iso weeks, including the new-year edge", () => {
  assert.equal(isoWeek(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  assert.equal(isoWeek(new Date("2026-09-23T00:00:00Z")), isoWeek(new Date("2026-09-21T00:00:00Z")),
    "monday and wednesday of one week agree");
  assert.notEqual(isoWeek(new Date("2026-09-20T00:00:00Z")), isoWeek(new Date("2026-09-21T00:00:00Z")),
    "sunday belongs to the week before");
});

test("everything recent is kept", () => {
  const names = history(2);
  const r = retain(names, { now: NOW });
  assert.equal(r.drop.length, 0, "nothing from the last three days is thinned");
  assert.ok(r.keep.every((n) => r.why.get(n) === "recent"));
});

test("older entries thin to one a day, then one a week", () => {
  const r = retain(history(60), { now: NOW });
  const tiers = r.keep.reduce((a, n) => ((a[r.tier.get(n)] = (a[r.tier.get(n)] ?? 0) + 1), a), {});
  assert.ok(tiers.recent >= 6, "the recent window survives intact");
  assert.ok(tiers.daily > 20 && tiers.daily < 30, "about one per day for a month");
  assert.ok(tiers.weekly >= 3, "then weekly");
  assert.ok(r.keep.length < 70, `thinned 60 days to ${r.keep.length} entries`);
});

test("the kept set does not churn when a new entry arrives", () => {
  /* earliest-in-bucket wins, so yesterday's decisions stay decided —
     otherwise every prune rewrites the branch and diffing it is useless */
  const names = history(40);
  const before = retain(names, { now: NOW }).keep;
  const after = retain([...names, entryName(at(-1, 3))], { now: NOW }).keep;
  const lost = before.filter((n) => !after.includes(n));
  assert.deepEqual(lost, [], "adding an entry removed none of the existing keeps");
});

test("the ceiling is a bound, not a hope", () => {
  const names = history(400);
  const r = retain(names, { now: NOW });
  assert.ok(r.bytes <= SIZE_CAP_MB * 1024 * 1024, `${(r.bytes / 1048576).toFixed(1)}MB is under the cap`);
  assert.equal(r.overCap, true, "and it said the ceiling engaged");
});

test("a year of history costs the same as four months", () => {
  const a = retain(history(120), { now: NOW });
  const b = retain(history(400), { now: NOW });
  assert.equal(a.keep.length, b.keep.length, "bounded, not merely slowed");
});

test("the recent window is defended last when the ceiling bites", () => {
  const names = history(400);
  const r = retain(names, { now: NOW });
  const recentKept = r.keep.filter((n) => r.tier.get(n) === "recent").length;
  const recentTotal = names.filter((n) => NOW - entryDate(n) <= KEEP_ALL_DAYS * DAY).length;
  assert.equal(recentKept, recentTotal, "nothing recent was sacrificed for old history");
});

test("a tiny cap still yields a valid, bounded set", () => {
  const r = retain(history(90), { now: NOW, capBytes: ENTRY_KB * 1024 * 3 });
  assert.ok(r.keep.length <= 3);
  assert.ok(r.bytes <= ENTRY_KB * 1024 * 3);
});

test("files that are not entries are left alone", () => {
  const r = retain([...history(1), "index.json", "incidents"], { now: NOW });
  assert.deepEqual(r.unnamed, ["index.json", "incidents"]);
  assert.ok(!r.drop.includes("index.json"), "pruning never touches what it does not understand");
});

test("the manifest says how it was sampled, not just what is in it", () => {
  const m = corpusManifest({ entries: history(3), incidents: ["a.json"], bytes: 1234 });
  assert.equal(m.incidents, 1);
  assert.ok(m.oldest < m.newest);
  assert.match(m.replay, /same names fixtures\/ uses/);
  assert.ok(m.caveats.some((c) => /over-sampled/.test(c)), "the push bias is disclosed");
  assert.ok(m.caveats.some((c) => /getTokenAccountsByOwner/.test(c)), "so is the missing coverage");
});

test("an empty corpus describes itself without inventing dates", () => {
  const m = corpusManifest({});
  assert.equal(m.entries, 0);
  assert.equal(m.oldest, null);
  assert.equal(m.newest, null);
});
