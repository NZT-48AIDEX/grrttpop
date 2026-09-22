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
  const load = (name) => {
    if (!cache.has(name)) {
      try { cache.set(name, JSON.parse(readFileSync(join(dir, name), "utf8"))); }
      catch { throw new Error(`missing fixture ${name} — run: npm run record`); }
    }
    return cache.get(name);
  };

  return async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);

    const body = init?.body;
    if (typeof body === "string" && body.includes("jsonrpc")) {
      const { method } = JSON.parse(body);
      const hit = load(RPC_FIXTURE)[method];
      if (hit === undefined) return json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no fixture for " + method } });
      // a recorded refusal stays a refusal: the gated path is the point
      if (hit?.__error) return json({ jsonrpc: "2.0", id: 1, error: hit.__error });
      return json({ jsonrpc: "2.0", id: 1, result: hit });
    }

    const name = routeFor(url);
    return name ? json(load(name)) : json({ error: "no fixture for " + url }, 404);
  };
}
