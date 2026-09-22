#!/usr/bin/env node
/* ================================================================
   grrttpop's mcp server — the site, for agents.

   agent.json has always said "hello, agent, you are welcome here"
   and then offered nothing to do. This is the chair.

   Two kinds of tool:
     · data — the reef and the trench answered straight from
       lib/market.js and lib/solana.js, the same code the pages run,
       so an agent and a human are never told different things
     · sight — boot a page headless and report what it actually did:
       state(), console, shader compile logs, a screenshot diffed
       against the committed baseline

   Everything here is read-only. There is no tool that can spend,
   sign, or send, and the solana module it calls has no such code.

   run: node mcp/server.mjs          (speaks MCP on stdin/stdout)
   ================================================================ */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createServer, log } from "./protocol.mjs";
import {
  fetchMarkets, fetchGlobal, fetchFearGreed, fetchTrending,
  describeReef, sortCoins, COINS,
} from "../lib/market.js";
import {
  makeRpc, fetchVitals, fetchEcosystem, peekWallet, describeTrench, isSolAddress,
} from "../lib/solana.js";
import { launch } from "../tools/cdp.mjs";
import { checkBaseline, diffPng } from "../tools/visual.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINES = join(ROOT, "baselines", `${process.platform}-${process.arch}`);
const SHOTS = join(ROOT, ".smoke", "mcp");
const PORT = 4179;
const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = { index: "index.html", reef: "market.html", trench: "solana.html" };
const GLOBALS = { index: "grrtt", reef: "reef", trench: "trench" };

/* ---------------- a browser + server, started once, lazily ---------------- */
/* booting chrome costs a second or two, so the first tool that needs
   eyes pays for it and every later call reuses the same instance. */
let rig = null;
async function eyes() {
  if (rig) return rig;
  mkdirSync(SHOTS, { recursive: true });

  const server = spawn("npx", ["--yes", "http-server", "-p", String(PORT), "-c-1", "--silent", ROOT],
    { stdio: ["ignore", "ignore", "ignore"] });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/agent.json`)).ok) break; } catch {}
    await sleep(250);
  }

  const browser = await launch({ headless: true });
  const differ = await browser.newPage();
  log("browser up:", browser.version);

  rig = { server, browser, differ };
  return rig;
}

/** load a page under the deterministic harness and let it settle */
async function openPage(name, { live = false, settle = 150, extraQuery = "" } = {}) {
  const { browser } = await eyes();
  const page = await browser.newPage();
  const q = live ? "" : "?seed=42&freeze=1&fixtures=1";
  await page.goto(`http://localhost:${PORT}/${PAGES[name]}${q}${extraQuery}`);
  await page.waitFor("window.__ready !== undefined", { label: "page scripts" });
  await page.eval("await window.__ready; return 1");
  if (!live) {
    await page.waitFor("__diag.snapshot().net.inflight === 0", { label: "requests to settle" });
    await page.eval(`return __harness.step(Math.max(0, ${settle} - __harness.state().steppedFrames))`);
  } else {
    await page.frames(settle);
  }
  return page;
}

const pageEnum = { type: "string", enum: Object.keys(PAGES), description: "which page" };
const liveFlag = { type: "boolean", default: false, description: "hit the real apis instead of recorded fixtures" };

/* ---------------- the tools ---------------- */
const tools = [
  {
    name: "reef_snapshot",
    description:
      "The live crypto market as the reef models it: depth bands, what's rising and falling, " +
      "biggest movers, trending coins, and the fear & greed mood. Every coin also carries its " +
      "week — a 168-point hourly series reduced to a sparkline and a shape, so you can tell a " +
      "coin that has climbed all week from one that spiked on tuesday and is giving it back, " +
      "which report the same 24h number. `week` does the same for the market as a whole, with " +
      "breadth. Answered by the same code the page runs, with no browser. Market data only — " +
      "not financial advice.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: COINS, description: `how many coins (default ${COINS})` },
        sort: { type: "string", enum: ["mcap", "gainers", "losers"], default: "mcap" },
        extras: { type: "boolean", default: true, description: "also fetch trending + mood + global stats" },
      },
    },
    async run({ limit = COINS, sort = "mcap", extras = true }) {
      const coins = await fetchMarkets({ perPage: limit });
      let trending = new Set(), mood = null, global = null;
      if (extras) {
        // these are decoration: a rate limit on them must not lose the reef
        const [t, m, g] = await Promise.allSettled([fetchTrending(), fetchFearGreed(), fetchGlobal()]);
        if (t.status === "fulfilled") trending = new Set(t.value);
        if (m.status === "fulfilled") mood = m.value.value;
        if (g.status === "fulfilled") global = g.value;
      }
      return describeReef(sortCoins(coins, { sort }),
        { trending, mood, global, sort, data: { source: "coingecko", at: Date.now() } });
    },
  },

  {
    name: "trench_vitals",
    description:
      "Solana mainnet right now: transactions per second (which drives the speed of the water in " +
      "the trench), epoch number and progress, and which RPC endpoint answered. Read-only.",
    inputSchema: {
      type: "object",
      properties: { rpc: { type: "string", description: "your own https rpc endpoint, tried first" } },
    },
    async run({ rpc: custom = "" }) {
      const events = [];
      const rpc = makeRpc({ custom, onEvent: (e) => e.kind === "fail" && events.push(e) });
      const v = await fetchVitals(rpc);
      return { ...v, endpoint: rpc.state(), refusals: events };
    },
  },

  {
    name: "trench_wallet_peek",
    description:
      "Read any PUBLIC Solana address's holdings — token balances, USD values, share of wallet. " +
      "Strictly read-only: no keys, no signatures, no transactions. Free public RPCs block " +
      "token-account reads, so without your own endpoint this returns the SOL balance and says " +
      "so via partial/gated — a partial read is never presented as the whole wallet.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "a public solana address" },
        rpc: { type: "string", description: "your own https rpc endpoint (helius/quicknode) to see every token" },
        limit: { type: "number", default: 24 },
      },
      required: ["address"],
    },
    async run({ address, rpc: custom = "", limit = 24 }) {
      if (!isSolAddress(address)) throw new Error(`"${address}" is not a solana address`);
      const refusals = [];
      const rpc = makeRpc({ custom, onEvent: (e) => e.kind === "fail" && refusals.push(e) });
      const wallet = await peekWallet(address, { rpc, limit });
      const d = describeTrench({ wallet, data: { source: rpc.state().endpoint ?? "solana-rpc", at: Date.now() } });
      return {
        ...d.wallet,
        data: d.data,
        allItems: wallet.items,
        refusals: refusals.map(({ method, host, message }) => ({ method, host, message })),
      };
    },
  },

  {
    name: "trench_ecosystem",
    description:
      "The Solana token ecosystem as the trench shows it: top tokens by market cap, gainers and " +
      "losers, each with its 7-day shape (sparkline, direction, and whether the last day is " +
      "fighting the week), plus `week` for the ecosystem as one equal-weighted index.",
    inputSchema: { type: "object", properties: { count: { type: "number", default: 40 } } },
    async run({ count = 40 }) {
      const eco = await fetchEcosystem({ count });
      const d = describeTrench({ eco, data: { source: "coingecko", at: Date.now() } });
      return { ...d.ecosystem, data: d.data };
    },
  },

  {
    name: "describe_page",
    description:
      "What a page is showing right now, in words — the same text a visitor with no eyes gets at " +
      "?agent=1. The reef reports how many creatures are in which depth band and which way they're " +
      "moving; the trench reports what mainnet is doing. Both draw each coin's last 7 days as a " +
      "sparkline. Use this to read the site as a scene rather than as a data dump.",
    inputSchema: {
      type: "object",
      properties: { page: pageEnum, live: liveFlag, format: { type: "string", enum: ["text", "json"], default: "text" } },
      required: ["page"],
    },
    async run({ page: name, live = false, format = "text" }) {
      const page = await openPage(name, { live, settle: 60, extraQuery: live ? "?agent=1" : "&agent=1" });
      // the view repaints as data trickles in; wait for it to say something real
      await page.waitFor(`(document.getElementById("agent-text")?.textContent ?? "").length > 200`,
        { timeout: 30_000, label: "the page to describe itself" });
      if (format === "json") {
        return name === "index"
          ? await page.eval("return grrtt.state()")
          : await page.eval(`return ${GLOBALS[name]}.describe()`);
      }
      return await page.eval(`return document.getElementById("agent-text").textContent`);
    },
  },

  {
    name: "site_state",
    description:
      "Boot a page in a headless browser and report what it actually did: fps, draw calls, shader " +
      "compile failures, data freshness, socket liveness, scene contents, every recorded error, and " +
      "the browser console. This is how to tell a page that is working from one that is rendering " +
      "plausible-looking black.",
    inputSchema: {
      type: "object",
      properties: { page: pageEnum, live: liveFlag, settle: { type: "number", default: 150, description: "frames to run before reading" } },
      required: ["page"],
    },
    async run({ page: name, live = false, settle = 150 }) {
      const page = await openPage(name, { live, settle });
      const state = await page.eval(`return ${GLOBALS[name]}.state()`);
      return { state, console: page.console.slice(-25) };
    },
  },

  {
    name: "shader_try",
    description:
      "Compile a shader change and get the compile log back. Give it a toybox mode (goo, nebula, " +
      "vortex, wireframe, party, calm) or raw GLSL for the creature's fragment shader. Returns " +
      "whether it linked, the driver's error text with line numbers, and how far the result moved " +
      "from the committed baseline. Shader iteration is otherwise blind: a broken shader is a " +
      "black canvas and nothing else.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["goo", "nebula", "vortex", "wireframe", "party", "calm"] },
        fragment: { type: "string", description: "raw GLSL to swap into the creature's fragment shader" },
        settle: { type: "number", default: 90 },
      },
    },
    async run({ mode, fragment, settle = 90 }) {
      if (!mode && !fragment) throw new Error("pass a mode or a fragment shader");
      const page = await openPage("index", { settle: 60 });
      const before = await page.eval("return grrtt.state().gl");

      if (mode) await page.eval(`grrtt.setMode(${JSON.stringify(mode)}); return 1`);
      if (fragment) {
        await page.eval(`
          const m = grrtt.creature.material;
          m.fragmentShader = ${JSON.stringify(fragment)};
          m.needsUpdate = true;
          return 1;`);
      }
      await page.eval(`return __harness.step(${settle})`);

      const state = await page.eval("return grrtt.state()");
      const shaderErrors = state.errors.filter((e) => e.kind === "shader");
      await page.freezeCss();
      const shot = join(SHOTS, `shader-${Date.now()}.png`);
      await page.screenshot(shot);

      let movedFromBaseline = null;
      const base = join(BASELINES, "index.png");
      if (existsSync(base)) {
        const { differ } = await eyes();
        const d = await diffPng(differ, readFileSync(base), readFileSync(shot));
        movedFromBaseline = d.sizeMismatch ? d : { percentChanged: d.percent, pixels: d.differing, region: d.box };
      }

      return {
        compiled: shaderErrors.length === 0,
        shaderFailures: state.gl.shaderFails - (before?.shaderFails ?? 0),
        compileLog: shaderErrors.map((e) => ({ link: e.msg, vertex: e.vertex, fragment: e.fragment })),
        mode: state.mode,
        uniforms: state.uniforms,
        drawCalls: state.gl.calls,
        movedFromBaseline,
        screenshot: shot,
      };
    },
  },

  {
    name: "visual_diff",
    description:
      "Render a page and compare it against its committed baseline. Reports the share of pixels " +
      "that moved and where. Per-channel deltas of 2 or less are ignored: identical runs still " +
      "differ by a handful of pixels from text antialiasing, so the question is how big a change is, " +
      "not whether there is one.",
    inputSchema: {
      type: "object",
      properties: { page: pageEnum, settle: { type: "number", default: 150 } },
      required: ["page"],
    },
    async run({ page: name, settle = 150 }) {
      const page = await openPage(name, { settle });
      await page.freezeCss();
      const shot = join(SHOTS, `${name}.png`);
      await page.screenshot(shot);
      const { differ } = await eyes();
      const res = await checkBaseline(differ, BASELINES, name, readFileSync(shot));
      return { ...res, screenshot: shot };
    },
  },

  {
    name: "run_check",
    description:
      "Run the project's static check: parses every script, resolves every import and asset " +
      "reference, validates the import maps, and verifies the pages still expose their console " +
      "globals and state(). Fast, and catches the dumbest class of mistake before a browser is involved.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      try {
        const { stdout } = await execFileP(process.execPath, [join(ROOT, "tools", "check.mjs")]);
        return { passed: true, output: stdout.trim() };
      } catch (err) {
        return { passed: false, output: (err.stdout ?? "") + (err.stderr ?? "") };
      }
    },
  },
];

/* ---------------- go ---------------- */
const card = JSON.parse(readFileSync(join(ROOT, "agent.json"), "utf8"));
const server = createServer({ name: "grrttpop", version: card.version ?? "1.0.0", tools });

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => { await rig?.browser?.close(); rig?.server?.kill(); process.exit(0); });
}

log(`grrttpop mcp · ${tools.length} tools · read-only`);
await server.listen();
await rig?.browser?.close();
rig?.server?.kill();
