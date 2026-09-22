/* the published feed. the interesting tests here are the refusals:
   this is the one part of the site that speaks without anyone
   watching, so the thing to guarantee is that it stays quiet rather
   than saying something untrue. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSnapshot, publishability, SNAPSHOT_FILES } from "../lib/snapshot.js";
import { fetchMarkets, fetchGlobal, describeReef, demoData } from "../lib/market.js";
import { fetchEcosystem, describeTrench } from "../lib/solana.js";
import { fixtureFetch } from "../tools/fixture-fetch.mjs";

const f = fixtureFetch();
const live = (over = {}) => ({ data: { synthetic: false, source: "coingecko" }, ...over });

test("a live pair is publishable", () => {
  const v = publishability({ reef: live(), trench: live() });
  assert.equal(v.ok, true);
  assert.deepEqual(v.why, []);
});

test("the demo reef is never published", () => {
  const v = publishability({
    reef: { data: { synthetic: true, source: "demo" } },
    trench: live(),
  });
  assert.equal(v.ok, false);
  assert.match(v.why.join(" "), /the reef is demo, not live/);
});

test("nor is a replay of the fixtures", () => {
  const v = publishability({ reef: live(), trench: { data: { synthetic: true, source: "fixtures" } } });
  assert.equal(v.ok, false);
  assert.match(v.why.join(" "), /the trench is fixtures/);
});

test("and an empty build is not 'nothing wrong'", () => {
  assert.equal(publishability({}).ok, false);
  assert.equal(publishability().ok, false);
});

test("a snapshot carries every file the agent card promises", async () => {
  const coins = await fetchMarkets({ fetch: f });
  const reef = describeReef(coins, {
    global: await fetchGlobal({ fetch: f }),
    data: { source: "coingecko", at: 1_700_000_000_000 },
  });
  const trench = describeTrench({
    vitals: { tps: 3000, epoch: 1040, epochPct: 2 },
    eco: await fetchEcosystem({ fetch: f }),
    data: { source: "solana-rpc + coingecko", at: 1_700_000_000_000 },
  });

  const files = buildSnapshot({ reef, trench, at: 1_700_000_000_000 });
  assert.deepEqual(Object.keys(files).sort(), [...SNAPSHOT_FILES].sort());

  const index = JSON.parse(files["index.json"]);
  assert.equal(index.generatedAt, "2023-11-14T22:13:20.000Z");
  assert.match(index.freshness, /ever published from the demo reef/);
  assert.deepEqual(index.files.map((x) => x.name).sort(), ["reef.json", "reef.txt", "trench.json", "trench.txt"]);

  // the json is the same object the page and the mcp server hand out
  const back = JSON.parse(files["reef.json"]);
  assert.equal(back.coins, 50);
  assert.equal(back.data.source, "coingecko");
  assert.equal(back.data.synthetic, false);
  assert.ok(back.week.spark.length, "the week survives the round trip");

  // a snapshot has no socket, and must not read as a dead one
  assert.match(files["reef.txt"], /heartbeat: n\/a — a snapshot has no socket/);
  assert.match(files["trench.txt"], /source: solana-rpc \+ coingecko/);
});

test("a partial build publishes what it has, without inventing the rest", () => {
  const files = buildSnapshot({ reef: live({ coins: 0, bands: [], biggestGainers: [], biggestLosers: [] }) });
  assert.ok("reef.json" in files);
  assert.ok(!("trench.json" in files), "no trench, no trench file");
  assert.ok("index.json" in files, "the manifest is always there");
});

test("the whole offline path ends in a refusal, not a file", async () => {
  /* replaying recordings marks everything synthetic, which is what the
     tool checks before writing. if this ever comes back ok, the feed
     could publish a recording from months ago as today's market. */
  const coins = await fetchMarkets({ fetch: f });
  const reef = describeReef(coins, {
    data: { source: "coingecko", at: Date.now(), harness: { on: true, fixtures: true } },
  });
  assert.equal(reef.data.source, "fixtures");
  assert.equal(publishability({ reef, trench: live() }).ok, false);
});

test("the demo reef reaches the same verdict, from the other direction", () => {
  const reef = describeReef(demoData({ now: 1_700_000_000_000 }), { data: { source: "demo", at: 1 } });
  assert.equal(publishability({ reef, trench: live() }).ok, false);
});
