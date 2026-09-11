#!/usr/bin/env node
/* ================================================================
   mcp-test — talk to the server the way a client does.

   The protocol is hand-rolled, so it does not get to be assumed
   correct: this drives a real handshake over a real pipe, calls
   every tool, and checks the shapes that a client actually relies
   on. Also checks the easiest way to break an stdio server —
   printing something to stdout that isn't a json-rpc message.

   usage: npm run mcp:test          (add --slow to include browser tools)
   ================================================================ */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLOW = process.argv.includes("--slow");
const LIVE = process.argv.includes("--live");

const proc = spawn(process.execPath, [join(ROOT, "mcp", "server.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
const stderr = [];
proc.stderr.on("data", (d) => stderr.push(d.toString()));

let seq = 0;
const waiting = new Map();
let buf = "";
let stdoutJunk = [];

proc.stdout.setEncoding("utf8");
proc.stdout.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch { stdoutJunk.push(line); continue; }   // anything unparseable corrupts the transport
    if (msg.id != null && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  }
});

const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, resolve);
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  setTimeout(() => waiting.has(id) && (waiting.delete(id), reject(new Error(`${method} timed out`))), 240_000);
});
const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

const results = [];
const check = (label, fn) => {
  try { const problem = fn(); results.push({ label, ok: !problem, problem }); }
  catch (e) { results.push({ label, ok: false, problem: e.message }); }
};

try {
  /* ---- handshake ---- */
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  });
  check("initialize returns a result", () => init.result ? null : JSON.stringify(init));
  check("echoes a supported protocol version", () =>
    init.result?.protocolVersion === "2025-06-18" ? null : `got ${init.result?.protocolVersion}`);
  check("declares tool capability", () => init.result?.capabilities?.tools ? null : "no tools capability");
  check("identifies itself", () => init.result?.serverInfo?.name ? null : "no serverInfo.name");

  notify("notifications/initialized");
  const pong = await rpc("ping", {});
  check("answers ping", () => pong.result ? null : "no result");

  /* ---- discovery ---- */
  const list = await rpc("tools/list", {});
  const tools = list.result?.tools ?? [];
  check("lists tools", () => tools.length ? null : "no tools listed");
  check("every tool has a description", () => {
    const bad = tools.filter((t) => !t.description || t.description.length < 20).map((t) => t.name);
    return bad.length ? bad.join(", ") : null;
  });
  check("every tool has an object input schema", () => {
    const bad = tools.filter((t) => t.inputSchema?.type !== "object").map((t) => t.name);
    return bad.length ? bad.join(", ") : null;
  });

  /* ---- error handling ---- */
  const nope = await rpc("tools/call", { name: "does_not_exist", arguments: {} });
  check("unknown tool is a json-rpc error", () => nope.error ? null : "expected an error");
  const badMethod = await rpc("nonsense/method", {});
  check("unknown method returns -32601", () =>
    badMethod.error?.code === -32601 ? null : `got ${JSON.stringify(badMethod.error)}`);
  const badArgs = await rpc("tools/call", { name: "trench_wallet_peek", arguments: { address: "not-an-address" } });
  check("a failing tool reports isError, not a crash", () =>
    badArgs.result?.isError ? null : `got ${JSON.stringify(badArgs.result ?? badArgs.error).slice(0, 120)}`);

  /* ---- the tools themselves ---- */
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    if (r.result?.isError) throw new Error(r.result.content[0].text);
    const text = r.result?.content?.[0]?.text;
    try { return JSON.parse(text); } catch { return text; }
  };

  const checkOk = await call("run_check");
  check("run_check passes", () => checkOk.passed ? null : checkOk.output?.slice(0, 200));

  if (LIVE) {
    const reef = await call("reef_snapshot", { limit: 20, extras: false });
    check("reef_snapshot returns bands", () => reef.bands?.length === 3 ? null : JSON.stringify(reef).slice(0, 150));
    const vitals = await call("trench_vitals");
    check("trench_vitals reads the chain", () => vitals.tps > 0 || vitals.epoch ? null : JSON.stringify(vitals).slice(0, 150));
  }

  if (SLOW) {
    const st = await call("site_state", { page: "reef" });
    check("site_state boots the reef", () => st.state?.data?.coins > 0 ? null : JSON.stringify(st.state ?? st).slice(0, 200));
    check("site_state reports no shader failures", () => st.state?.gl?.shaderFails === 0 ? null : "shaders failed");

    const good = await call("shader_try", { mode: "party" });
    check("shader_try compiles a valid mode", () => good.compiled ? null : JSON.stringify(good.compileLog));
    check("shader_try notices the scene moved", () =>
      good.movedFromBaseline?.percentChanged > 0 ? null : `moved ${good.movedFromBaseline?.percentChanged}%`);

    const bad = await call("shader_try", { fragment: "void main( this is not glsl" });
    check("shader_try catches a broken shader", () => bad.compiled === false ? null : "reported success on broken glsl");
    check("shader_try returns the compile log", () =>
      /ERROR|error/.test(JSON.stringify(bad.compileLog)) ? null : JSON.stringify(bad.compileLog).slice(0, 200));

    const vis = await call("visual_diff", { page: "trench" });
    check("visual_diff matches the baseline", () => vis.status === "pass" ? null : vis.message);
  }

  check("stdout carried only json-rpc", () => stdoutJunk.length ? stdoutJunk.slice(0, 2).join(" | ") : null);
} finally {
  proc.stdin.end();
  proc.kill();
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.label}${r.ok ? "" : `\n     ↳ ${r.problem}`}`);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks` +
  (SLOW ? "" : "  (add --slow for browser tools, --live for network tools)"));
if (failed.length && stderr.length) console.log("\nserver stderr:\n" + stderr.join("").split("\n").slice(-8).join("\n"));
process.exit(failed.length ? 1 : 0);
