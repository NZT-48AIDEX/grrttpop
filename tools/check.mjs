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

/* ---------------- 5b. the promises made to agents ---------------- */
/* the card, the copy of it, the schema and llms.txt are four files that
   describe the same site. they drift apart the moment nobody checks. */
{
  const cardPath = join(ROOT, "agent.json");
  const wellKnown = join(ROOT, ".well-known", "agent.json");
  const schemaPath = join(ROOT, "agent-card.schema.json");

  if (!existsSync(wellKnown)) {
    fail(".well-known/agent.json", "missing — agents look here first. `cp agent.json .well-known/agent.json`");
  } else if (existsSync(cardPath) &&
             readFileSync(wellKnown, "utf8") !== readFileSync(cardPath, "utf8")) {
    fail(".well-known/agent.json", "has drifted from agent.json. `cp agent.json .well-known/agent.json`");
  }

  if (!existsSync(schemaPath)) fail("agent-card.schema.json", "missing — agent.json's $schema points at it");
  else if (existsSync(cardPath)) {
    const card = JSON.parse(readFileSync(cardPath, "utf8"));
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

    /* $schema has to resolve from the card's own url. an absolute url pins
       one deployment; a leading slash assumes the site is mounted at the
       domain root, which breaks the moment it is served from a subpath —
       github pages puts this one under /grrttpop/. document-relative is the
       only form that works locally and deployed, which is why a copy of the
       schema also sits next to the .well-known copy of the card. */
    if (/^https?:\/\//.test(card.$schema ?? "")) {
      fail("agent.json", `$schema is an absolute url (${card.$schema}) — pins one deployment; use a relative path`);
    } else if (card.$schema?.startsWith("/")) {
      fail("agent.json", `$schema "${card.$schema}" is root-absolute — 404s wherever the site is served from a subpath`);
    } else if (card.$schema && !existsSync(join(ROOT, card.$schema))) {
      fail("agent.json", `$schema "${card.$schema}" does not resolve to a file`);
    }
    const wkSchema = join(ROOT, ".well-known", "agent-card.schema.json");
    if (!existsSync(wkSchema)) {
      fail(".well-known/agent-card.schema.json", "missing — the .well-known card's relative $schema resolves here");
    } else if (readFileSync(wkSchema, "utf8") !== readFileSync(schemaPath, "utf8")) {
      fail(".well-known/agent-card.schema.json", "has drifted from agent-card.schema.json");
    }
    // a deliberate subset of json-schema: required keys and top-level types.
    // enough to catch a hand-edit that drops a field, without pretending to
    // be a validator.
    for (const key of schema.required ?? []) {
      if (!(key in card)) fail("agent.json", `missing required field "${key}" (per agent-card.schema.json)`);
    }
    for (const [key, spec] of Object.entries(schema.properties ?? {})) {
      if (!(key in card) || !spec.type) continue;
      const actual = Array.isArray(card[key]) ? "array" : typeof card[key];
      if (spec.type !== actual) fail("agent.json", `"${key}" should be ${spec.type}, got ${actual}`);
    }
    for (const key of schema.properties?.site?.required ?? []) {
      if (!(key in (card.site ?? {}))) fail("agent.json", `site is missing required field "${key}"`);
    }
    // the card must not promise tools the server does not have
    const promised = Object.keys(card.site?.mcp?.tools ?? {});
    if (promised.length) {
      const server = readFileSync(join(ROOT, "mcp", "server.mjs"), "utf8");
      for (const t of promised) {
        if (!server.includes(`name: "${t}"`)) fail("agent.json", `advertises an mcp tool the server does not define: ${t}`);
      }
    }
    if (card.site?.mcp && card.site.mcp.read_only !== true) {
      fail("agent.json", "the mcp block must declare read_only: true — every tool is read-only and the card should say so");
    }
  }

  // github pages runs jekyll by default, and jekyll drops dotdirs from the
  // built site — without this file /.well-known/agent.json 404s in production
  // while working perfectly on every local server.
  if (!existsSync(join(ROOT, ".nojekyll"))) {
    fail(".nojekyll", "missing — jekyll will strip /.well-known/ and the agent card 404s once deployed");
  }
  if (!existsSync(join(ROOT, "llms.txt"))) fail("llms.txt", "missing — the plain-language index for language models");
  if (!existsSync(join(ROOT, "CLAUDE.md"))) fail("CLAUDE.md", "missing — the conventions a fresh agent needs");
}

/* ---------------- 5c. can the site still describe itself? ---------------- */
/* ?agent=1 is the only thing an eyeless visitor gets. if a page loses
   describe(), it silently goes back to serving a black rectangle. */
for (const [js, global] of [["main.js", "grrtt"], ["reef.js", "reef"], ["trench.js", "trench"]]) {
  const src = readFileSync(join(ROOT, js), "utf8");
  if (!src.includes("isAgentView()")) fail(js, "no ?agent=1 view — an eyeless visitor gets a black canvas");
  if (js !== "main.js" && !/describe:\s*\(\)/.test(src)) {
    fail(js, `no ${global}.describe() — nothing to render as text`);
  }
}
for (const page of ["index.html", "market.html", "solana.html"]) {
  const src = readFileSync(join(ROOT, page), "utf8");
  for (const rel_ of ["agent-card", "llms-txt"]) {
    if (!src.includes(`rel="${rel_}"`)) fail(page, `no <link rel="${rel_}"> — agents cannot discover it`);
  }
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
