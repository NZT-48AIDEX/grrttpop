/* ================================================================
   capture-fetch — record what the upstream actually said.

   The mirror of tools/fixture-fetch.mjs: that one replays recordings,
   this one makes them. It wraps the publisher's own fetch rather than
   re-requesting afterwards, so the archive is exactly the bytes the
   run worked from — a second request would be a different moment and
   would double the load on a rate-limited api for the privilege.

   Keyed by the same filenames fixtures/ uses (lib/fixture-routes.js),
   which is what lets a corpus entry be replayed by the existing shim
   instead of needing a reader of its own.
   ================================================================ */

import { routeFor, RPC_FIXTURE } from "../lib/fixture-routes.js";

export function captureFetch(base = fetch) {
  const captured = {};

  const wrapped = async (input, init) => {
    const res = await base(input, init);
    const url = typeof input === "string" ? input : input?.url ?? String(input);

    try {
      const body = init?.body;
      if (typeof body === "string" && body.includes("jsonrpc")) {
        const { method } = JSON.parse(body);
        const j = await res.clone().json();
        captured[RPC_FIXTURE] ??= {};
        /* a refusal is recorded as a refusal, in the same shape
           fixtures/ uses — the gated path is the most fragile code
           here and a corpus that quietly dropped its refusals would
           stop exercising it */
        captured[RPC_FIXTURE][method] = j?.error ? { __error: j.error } : j?.result;
        return res;
      }

      const name = routeFor(url);
      if (name && res.ok) captured[name] = await res.clone().json();
    } catch {
      // a body that will not parse is not worth failing a publish over
    }
    return res;
  };

  wrapped.captured = captured;
  wrapped.count = () => Object.keys(captured).length;
  return wrapped;
}
