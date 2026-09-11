#!/usr/bin/env node
/* ================================================================
   check — the cheapest possible feedback loop.

   No build step means nothing ever tells you a file is broken until
   a browser silently renders black. This parses every script, walks
   every import and asset reference, and fails loudly. Zero deps,
   sub-second, safe to run on every edit.

   usage: npm run check
   ================================================================ */

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", "vendor", ".claude"]);

const problems = [];
const fail = (file, msg) => problems.push({ file, msg });
const rel = (p) => relative(ROOT, p) || p;

/* ---------------- walk the tree ---------------- */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const scripts = files.filter((f) => extname(f) === ".js" || extname(f) === ".mjs");
const pages = files.filter((f) => extname(f) === ".html");
const jsons = files.filter((f) => extname(f) === ".json");
/* tooling runs in node, where bare specifiers are legal — the import-map
   rule below is about what the *browser* can resolve. */
const browserScripts = scripts.filter((f) => !rel(f).startsWith("tools/") && !rel(f).startsWith("mcp/"));

/* ---------------- 1. does every script parse? ---------------- */
/* careful: `node --check foo.js` EXITS 0 on a broken file if the file
   contains esm syntax — the cjs parse fails, node detects module syntax,
   retries, and swallows the result. every browser file here is an esm
   .js, so the naive check is a silent no-op. copy to .mjs and check that,
   which forces the module parser and actually reports. */
const stage = mkdtempSync(join(tmpdir(), "grrtt-check-"));
try {
  for (const f of scripts) {
    const asModule = extname(f) === ".mjs" ? f : join(stage, basename(f, ".js") + ".mjs");
    if (asModule !== f) writeFileSync(asModule, readFileSync(f));   // same bytes, so line numbers match
    try {
      execFileSync(process.execPath, ["--check", asModule], { stdio: "pipe" });
    } catch (e) {
      const out = (e.stderr?.toString() || e.message)
        .split("\n").slice(0, 6).join("\n")
        // report the real path, not the staging copy (macos reports a /private realpath)
        .replace(new RegExp("\\S*" + basename(asModule).replace(".", "\\."), "g"), rel(f));
      fail(rel(f), "syntax error\n" + out.replace(/^/gm, "    "));
    }
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}

/* ---------------- 2. does every import resolve? ---------------- */
/* the import map only declares "three"; anything else must exist on disk,
   spelled exactly — a case-only typo works on this mac and 404s on a
   case-sensitive host. */
const BARE_OK = new Set(["three"]);
const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

for (const f of browserScripts) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    if (spec.startsWith("node:") || spec.startsWith("http")) continue;
    if (!spec.startsWith(".") && !spec.startsWith("/")) {
      if (!BARE_OK.has(spec)) fail(rel(f), `bare import "${spec}" is not in any import map`);
      continue;
    }
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) fail(rel(f), `import not found: ${spec}`);
    else if (!readdirSync(dirname(target)).includes(target.split("/").pop())) {
      fail(rel(f), `import case mismatch: ${spec} (breaks on case-sensitive hosts)`);
    }
  }
}

/* ---------------- 3. do the pages point at real files? ---------------- */
const REF_RE = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
for (const f of pages) {
  const src = readFileSync(f, "utf8");

  for (const m of src.matchAll(REF_RE)) {
    const ref = m[1];
    if (/^(https?:|data:|mailto:|#|\/\/)/.test(ref)) continue;
    const target = resolve(dirname(f), ref.split(/[?#]/)[0]);
    if (!existsSync(target)) fail(rel(f), `dead reference: ${ref}`);
  }

  // every page that loads a module needs the three import map, or it
  // dies at parse time with a bare-specifier error and renders nothing
  if (/type=["']module["']/.test(src) && !/type=["']importmap["']/.test(src)) {
    fail(rel(f), "loads an ES module but declares no import map");
  }
  const map = src.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (map) {
    try {
      const imports = JSON.parse(map[1]).imports ?? {};
      for (const [name, path] of Object.entries(imports)) {
        if (path.startsWith(".") && !existsSync(resolve(dirname(f), path))) {
          fail(rel(f), `import map "${name}" points at a missing file: ${path}`);
        }
      }
    } catch (e) { fail(rel(f), "import map is not valid JSON: " + e.message); }
  }

  // ids the scripts reach for with $("…") must actually be in the markup
  const scriptRef = src.match(/<script type="module" src="([^"]+)"/);
  if (scriptRef) {
    const jsPath = resolve(dirname(f), scriptRef[1]);
    if (existsSync(jsPath)) {
      const js = readFileSync(jsPath, "utf8");
      const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      const wanted = new Set([
        ...[...js.matchAll(/\bgetElementById\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
        ...[...js.matchAll(/(?<![\w.])\$\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ]);
      for (const id of wanted) {
        if (!ids.has(id)) fail(rel(jsPath), `looks up #${id}, absent from ${rel(f)}`);
      }
    }
  }
}

/* ---------------- 4. is every json actually json? ---------------- */
for (const f of jsons) {
  try { JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { fail(rel(f), "invalid JSON: " + e.message); }
}

/* ---------------- 5. the promises the site makes ---------------- */
/* the site tells agents to fetch /agent.json and tells humans the
   console globals are hackable. both are load-bearing claims. */
if (existsSync(join(ROOT, "agent.json"))) {
  const card = JSON.parse(readFileSync(join(ROOT, "agent.json"), "utf8"));
  for (const [name, tool] of Object.entries(card.site?.tools ?? {})) {
    if (tool.url && !existsSync(join(ROOT, tool.url))) {
      fail("agent.json", `tool "${name}" points at a missing page: ${tool.url}`);
    }
  }
} else fail("agent.json", "missing — the site tells agents to fetch it");

for (const [js, global] of [["main.js", "grrtt"], ["reef.js", "reef"], ["trench.js", "trench"]]) {
  const p = join(ROOT, js);
  if (!existsSync(p)) { fail(js, "missing"); continue; }
  const src = readFileSync(p, "utf8");
  if (!src.includes(`window.${global} =`)) fail(js, `no window.${global} — the console API is gone`);
  if (!/state:\s*\(\)/.test(src)) fail(js, `no ${global}.state() — agents have no way to see this page`);
  // harness has to evaluate before anything reads Math.random, the clock,
  // or fetch — if it slides down the import list, determinism dies quietly
  const firstImport = src.match(/^\s*import\s.*$/m)?.[0] ?? "";
  if (!firstImport.includes("harness")) fail(js, "lib/harness.js is not the first import — seeding and the fixed-step clock will not apply");
}

/* ---------------- 6. can the harness still replay? ---------------- */
/* fixtures are the difference between a test suite and a rate-limit
   fight, so a missing one should fail here, not halfway through smoke. */
const FIXTURES = ["cg-markets.json", "cg-global.json", "cg-trending.json", "cg-eco.json",
                  "fng.json", "jup-tokens.json", "jup-price.json", "solana-rpc.json"];
const fixDir = join(ROOT, "fixtures");
if (!existsSync(fixDir)) fail("fixtures/", "missing — run: npm run record");
else {
  for (const f of FIXTURES) {
    if (!existsSync(join(fixDir, f))) fail("fixtures/" + f, "missing — run: npm run record");
  }
  const rpcPath = join(fixDir, "solana-rpc.json");
  if (existsSync(rpcPath)) {
    const rpcFix = JSON.parse(readFileSync(rpcPath, "utf8"));
    for (const m of ["getBalance", "getEpochInfo", "getRecentPerformanceSamples", "getTokenAccountsByOwner"]) {
      if (!(m in rpcFix)) fail("fixtures/solana-rpc.json", `no recorded response for ${m}`);
    }
  }
}

/* ---------------- report ---------------- */
const n = scripts.length + pages.length + jsons.length;
if (!problems.length) {
  console.log(`✅ check passed — ${scripts.length} scripts, ${pages.length} pages, ${jsons.length} json, ${n} files total`);
  process.exit(0);
}
console.error(`❌ ${problems.length} problem${problems.length > 1 ? "s" : ""}:\n`);
for (const p of problems) console.error(`  ${p.file}\n    ${p.msg}\n`);
process.exit(1);
