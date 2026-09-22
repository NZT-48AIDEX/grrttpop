#!/usr/bin/env node
/* ================================================================
   serve — a static server, in process, with no dependencies.

   This used to be `npx --yes http-server`, spawned twice: once by
   smoke.mjs and once by mcp/server.mjs, each with its own copy of the
   wait-for-it loop. Three problems, all of which bit:

     · http-server is not a dependency, so `npx --yes` fetched it from
       the network in the middle of a test run. On a slow ci runner
       that took longer than the 30s wait, chrome then loaded a dead
       port, and the failure surfaced twenty seconds later as
       "timed out waiting for page scripts" — a page problem, in a
       different subsystem, for a server that was never up.
     · the two copies of the loop disagreed: smoke threw when the
       server didn't come up, the mcp one carried on silently.
     · killing the `npx` wrapper did not reliably take the child with
       it. github's runner kept having to clean up after us.

   In process, none of those exist: no fetch, no wrapper, no orphan,
   and one implementation to be wrong in only one way.

   Paths are served **literally** — no rewriting, no spa fallback, no
   extension guessing. A request for a file that isn't there is a 404,
   because a test harness that quietly serves index.html instead of
   the missing module teaches you nothing.

   also runnable directly:  node tools/serve.mjs --port=4173
   ================================================================ */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  // es modules are served from disk here; the wrong type and nothing loads
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/**
 * Start a static server over `root`. Returns once it is listening —
 * there is no "probably up by now" to get wrong.
 */
export async function serve({ root, port = 0, host = "127.0.0.1" } = {}) {
  const ROOT = resolve(root);

  const server = createServer(async (req, res) => {
    const send = (code, body, type = "text/plain; charset=utf-8") => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };

    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
    catch { return send(400, "bad path"); }

    /* resolve first, then check containment: "/../etc/passwd" and
       "/%2e%2e/" both become ordinary paths by this point */
    const target = resolve(join(ROOT, pathname));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) return send(403, "outside the root");

    let file = target;
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, "index.html");
    } catch { /* fall through to the read, which reports the 404 */ }

    try {
      await stat(file);
    } catch {
      return send(404, `not found: ${pathname}`);
    }

    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      // the harness must never be served a stale file: a page that passes
      // because the browser kept yesterday's module is worse than a failure
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).on("error", () => res.end()).pipe(res);
  });

  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, host, ok);
  });

  const actual = server.address().port;
  return {
    port: actual,
    url: `http://${host}:${actual}`,
    /** kept for symmetry with the old spawn-based helper; it is already up */
    async ready() { return true; },
    async stop() {
      // keep-alive sockets hold close() open forever otherwise
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

/* run directly: node tools/serve.mjs --port=4173 [--root=.] */
if (import.meta.url === `file://${process.argv[1]}`) {
  const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
  const s = await serve({ root: opt("root", process.cwd()), port: Number(opt("port", 4173)) });
  console.log(`serving ${resolve(opt("root", process.cwd()))} at ${s.url}`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => s.stop().then(() => process.exit(0)));
}
