/* the drift checker's own logic. if this is wrong it either cries wolf
   every week until everyone ignores it, or misses the rename it exists
   to catch — both end with nobody trusting it. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeOf, compareShapes, referencedBy } from "../lib/shape.mjs";

const paths = (m) => [...m.keys()].sort();

test("shapeOf records paths and types, not values", () => {
  const a = shapeOf({ id: "btc", price: 50000, meta: { rank: 1 } });
  const b = shapeOf({ id: "eth", price: 3000, meta: { rank: 2 } });
  assert.deepEqual(paths(a), paths(b), "different values, same shape");
  assert.deepEqual(a, b);
  assert.equal(a.get("price"), "number");
  assert.equal(a.get("meta.rank"), "number");
});

test("shapeOf collapses arrays to one shape", () => {
  const s = shapeOf({ coins: [{ id: "a" }, { id: "b" }, { id: "c" }] });
  assert.deepEqual(paths(s), ["coins", "coins[]", "coins[].id"],
    "fifty coins have one coin shape, not fifty");
  assert.equal(s.get("coins"), "array");
});

test("shapeOf unions across array elements", () => {
  // apis omit or null-out fields on some rows; reading only the first
  // element would report drift that isn't there
  const s = shapeOf({ rows: [{ a: 1 }, { a: 2, b: "x" }] });
  assert.equal(s.get("rows[].b"), "string", "a field only some rows carry is still part of the shape");
});

test("shapeOf treats null as a nullable of whatever else appears", () => {
  const s = shapeOf({ rows: [{ chg: null }, { chg: 1.5 }] });
  assert.equal(s.get("rows[].chg"), "number", "nullable number, not a conflict");

  const allNull = shapeOf({ rows: [{ chg: null }] });
  assert.equal(allNull.get("rows[].chg"), "null", "but all-null stays null — we learned nothing else");
});

test("shapeOf stops at maxDepth rather than walking forever", () => {
  let deep = { v: 1 };
  for (let i = 0; i < 40; i++) deep = { nest: deep };
  const s = shapeOf(deep, { maxDepth: 3 });
  assert.ok(paths(s).every((p) => p.split(".").length <= 3));
});

test("compareShapes says nothing changed when nothing changed", () => {
  const rec = shapeOf({ a: 1, b: { c: "x" } });
  const live = shapeOf({ a: 99, b: { c: "different" } });
  const d = compareShapes(rec, live);
  assert.equal(d.same, true);
  assert.deepEqual([d.removed, d.added, d.changed], [[], [], []]);
});

test("compareShapes catches a renamed field as removed plus added", () => {
  const rec = shapeOf({ value_classification: "greed" });
  const live = shapeOf({ valueClassification: "greed" });
  const d = compareShapes(rec, live);
  assert.deepEqual(d.removed, ["value_classification"]);
  assert.deepEqual(d.added, ["valueClassification"]);
  assert.equal(d.same, false);
});

test("compareShapes catches a type flip", () => {
  // the quiet one: a price that became a string still renders, wrongly
  const d = compareShapes(shapeOf({ price: 1.5 }), shapeOf({ price: "1.5" }));
  assert.deepEqual(d.changed, [{ path: "price", from: "number", to: "string" }]);
  assert.equal(d.same, false);
});

test("compareShapes treats a new field as harmless", () => {
  const d = compareShapes(shapeOf({ a: 1 }), shapeOf({ a: 1, b: 2 }));
  assert.deepEqual(d.added, ["b"]);
  assert.equal(d.same, true, "providers add fields constantly; that is not drift");
});

test("referencedBy finds the fields the code actually reads", () => {
  const sources = {
    "lib/market.js": 'const chg = c.price_change_percentage_24h_in_currency ?? 0;',
    "lib/solana.js": "const amt = info?.tokenAmount?.uiAmount;",
  };
  const hits = referencedBy(
    ["rows[].price_change_percentage_24h_in_currency", "rows[].uiAmount", "rows[].something_unused"],
    sources);

  assert.deepEqual(hits.get("rows[].price_change_percentage_24h_in_currency"), ["lib/market.js"]);
  assert.deepEqual(hits.get("rows[].uiAmount"), ["lib/solana.js"]);
  assert.equal(hits.has("rows[].something_unused"), false,
    "a field nobody reads is worth mentioning, not worth waking someone for");
});

test("referencedBy matches whole words only", () => {
  const hits = referencedBy(["a.id"], { "x.js": "const idCounter = 1;" });
  assert.equal(hits.has("a.id"), false, '"id" must not match "idCounter"');
});

test("referencedBy ignores very short leaf names", () => {
  // two-letter keys match everything and would make the report useless
  const hits = referencedBy(["a.x"], { "x.js": "const x = 1; let ax = 2;" });
  assert.equal(hits.size, 0);
});
