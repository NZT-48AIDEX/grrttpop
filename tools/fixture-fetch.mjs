/* ================================================================
   fixture-fetch — the recorded APIs, as a `fetch` for node.

   The browser gets this from `lib/harness.js` (`?fixtures=1`). Node
   had no equivalent, which meant anything written against the live
   APIs could only be exercised by actually hitting them — and
   coingecko rate-limits hard enough that such a test gets run once
   and then avoided.

   Same route table as the browser, on purpose (lib/fixture-routes.js).
   ================================================================ */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { routeFor, RPC_FIXTURE } from "../lib/fixture-routes.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** a `fetch` that answers from fixtures/ and never touches the network */
export function fixtureFetch({ dir = FIXTURES } = {}) {
  const cache = new Map();
  return bundleFetch({
    get(name) {
      if (!cache.has(name)) {
        try { cache.set(name, JSON.parse(readFileSync(join(dir, name), "utf8"))); }
        catch { throw new Error(`missing fixture ${name} — run: npm run record`); }
      }
      return cache.get(name);
    },
  /* a fixture that is not on disk is a broken checkout, not a market
     event: say so loudly rather than replaying an outage */
  }, { missing: "throw" });
}

/**
 * The same replay, over payloads already in memory — a corpus bundle,
 * or a hand-built scenario. Corpus entries are keyed by the same
 * filenames fixtures/ uses precisely so this works on both without a
 * second reader to drift from the first.
 */
export function bundleFetch(files = {}, { missing = "404" } = {}) {
  const has = typeof files.get === "function" ? () => true : (name) => name in files;
  const read = typeof files.get === "function" ? (name) => files.get(name) : (name) => files[name];

  /* a recording holds what the publisher happened to call. an absent
     payload is an endpoint that did not answer that day, which is a
     thing that really happens — so replay it as one and let the code's
     own failure handling take it. */
  const load = (name) => {
    if (!has(name)) {
      if (missing === "throw") throw new Error(`this recording has no ${name}`);
      return undefined;
    }
    return read(name);
  };

  return async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);

    const body = init?.body;
    if (typeof body === "string" && body.includes("jsonrpc")) {
      const { method } = JSON.parse(body);
      const rpc = load(RPC_FIXTURE);
      if (rpc === undefined) return json({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "no rpc in this recording" } });
      const hit = rpc[method];
      if (hit === undefined) return json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no fixture for " + method } });
      // a recorded refusal stays a refusal: the gated path is the point
      if (hit?.__error) return json({ jsonrpc: "2.0", id: 1, error: hit.__error });
      return json({ jsonrpc: "2.0", id: 1, result: hit });
    }

    const name = routeFor(url);
    if (!name) return json({ error: "no fixture for " + url }, 404);
    const payload = load(name);
    return payload === undefined
      ? json({ error: `this recording has no ${name}` }, 503)
      : json(payload);
  };
}
