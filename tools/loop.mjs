#!/usr/bin/env node
/* ================================================================
   loop — what an agent should know before it starts.

   ROADMAP stage 5. The other stages produce signals; this one puts
   them where somebody reads them, which is the difference between a
   loop and a pile of scripts nobody runs.

   Most of those signals do not exist yet, and that is the point of
   the `absent` status: a report that omitted its missing halves would
   read as "all green", and this repo's whole position is that silence
   must never pass for health.

   usage:
     npm run loop                # markdown to stdout
     npm run loop -- --line      # one line, for a terminal
     npm run loop -- --json      # the sections, for something else to read
     npm run loop -- --offline   # skip anything that needs the network

   Reports, never blocks. Exit 1 only if the reporter itself broke.
   ================================================================ */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { calibrate } from "../lib/calibrate.js";
import { renderMarkdown, renderLine } from "../lib/report.js";
import { SNAPSHOT_FILES } from "../lib/snapshot.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const execFileP = promisify(execFile);
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const OFFLINE = flag("offline");

const FEED = "https://raw.githubusercontent.com/NZT-48AIDEX/grrttpop/data/";
const REPO = process.env.GITHUB_REPOSITORY || "NZT-48AIDEX/grrttpop";

const days = (ms) => ms / 86_400_000;
const ago = (iso) => days(Date.now() - new Date(iso).getTime());
const fmtAge = (d) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`);

const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.json();
};

/* ---------------- does the suite still pass ---------------- */
async function suite() {
  const run = async (cmd, a) => {
    try { return { ok: true, out: (await execFileP(cmd, a, { cwd: ROOT })).stdout }; }
    catch (e) { return { ok: false, out: (e.stdout ?? "") + (e.stderr ?? "") }; }
  };
  const check = await run(process.execPath, ["tools/check.mjs"]);
  const unit = await run(process.execPath, ["--test"]);
  const passed = /^# pass (\d+)/m.exec(unit.out)?.[1] ?? "?";
  const failed = /^# fail (\d+)/m.exec(unit.out)?.[1] ?? "?";

  const ok = check.ok && unit.ok;
  return {
    name: "suite",
    status: ok ? "ok" : "fail",
    headline: ok ? `check + ${passed} unit tests pass` : `check ${check.ok ? "ok" : "FAILED"}, ${failed} unit test(s) failing`,
    lines: ok ? [] : ["```", (check.ok ? unit.out : check.out).trim().split("\n").slice(-25).join("\n"), "```"],
    /* smoke is deliberately not here: it needs chrome, and a report that
       takes two minutes is a report nobody runs before starting. */
    note: "smoke not run — `npm test` covers it",
  };
}

/* ---------------- how old are the recorded inputs ---------------- */
function fixtures() {
  const p = join(ROOT, "fixtures", "recorded-at.json");
  if (!existsSync(p)) return { name: "fixtures", status: "fail", headline: "recorded-at.json is missing", lines: [] };
  const age = ago(JSON.parse(readFileSync(p, "utf8")).at);
  const stale = age > 90;
  return {
    name: "fixtures",
    status: stale ? "warn" : "ok",
    headline: `recorded ${Math.round(age)} days ago`,
    lines: stale
      ? ["An api may have changed shape since, which the suite cannot see — it would",
         "replay the old shape and stay green. Check with `npm run smoke -- --live`."]
      : [],
  };
}

/* ---------------- is the published feed alive and honest ---------------- */
async function feed() {
  if (OFFLINE) return { name: "feed", status: "absent", skipped: true, headline: "skipped (--offline)", lines: [] };
  try {
    const index = await get(FEED + "index.json");
    const reef = await get(FEED + "reef.json");
    const age = ago(reef.data.asOf);
    const missing = SNAPSHOT_FILES.filter((f) => f !== "index.json" && !index.files.some((x) => x.name === f));

    const problems = [];
    if (reef.data.synthetic) problems.push(`the published reef says synthetic: ${reef.data.source}`);
    if (missing.length) problems.push(`manifest is missing ${missing.join(", ")}`);

    // 3.8h is the measured cadence; a day means something stopped
    const status = problems.length ? "fail" : age > 1 ? "warn" : "ok";
    return {
      name: "feed",
      status,
      headline: problems.length ? problems[0] : `${fmtAge(age)} old, ${reef.coins} coins, source ${reef.data.source}`,
      lines: [
        `- \`data.asOf\` **${reef.data.asOf}** (${fmtAge(age)} ago)`,
        `- synthetic: **${reef.data.synthetic}** · source: ${reef.data.source}`,
        `- the week: ${reef.week?.spark ?? "—"} ${reef.week?.shape ?? ""}`,
        ...(age > 1 ? ["", "Older than a day. The scheduler drops most ticks, so check whether the",
                       "workflow is disabled before assuming the publisher is broken."] : []),
      ],
    };
  } catch (e) {
    return { name: "feed", status: "fail", headline: `unreachable: ${e.message}`, lines: [] };
  }
}

/* ---------------- what cadence is github actually delivering ---------------- */
/* measured by hand once and immediately out of date; the number moves,
   so the loop measures it rather than quoting yesterday's. */
async function cadence() {
  if (OFFLINE) return { name: "cadence", status: "absent", skipped: true, headline: "skipped (--offline)", lines: [] };
  try {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const runs = await get(
      `https://api.github.com/repos/${REPO}/actions/workflows/snapshot.yml/runs?per_page=100`,
      token ? { authorization: `Bearer ${token}` } : {});

    const week = runs.workflow_runs.filter((r) => ago(r.created_at) <= 7);
    const sched = week.filter((r) => r.event === "schedule").map((r) => new Date(r.created_at)).sort((a, b) => a - b);
    const byEvent = week.reduce((a, r) => ((a[r.event] = (a[r.event] ?? 0) + 1), a), {});
    const failed = week.filter((r) => r.conclusion && r.conclusion !== "success").length;

    const gaps = sched.slice(1).map((t, i) => (t - sched[i]) / 3_600_000);
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[gaps.length >> 1] : null;

    /* an occasional failed run is the publisher refusing a 429, which is
       it working. a run failing *now*, or failing often, is not. */
    const newestFailed = week[0] && week[0].conclusion && week[0].conclusion !== "success";
    const flaky = week.length >= 4 && failed / week.length > 0.25;

    const lines = [
      `- runs in the last 7 days: **${week.length}** (${Object.entries(byEvent).map(([k, v]) => `${v} ${k}`).join(", ") || "none"})`,
      `- scheduled only: **${sched.length}**` + (median ? `, median gap **${median.toFixed(1)}h**` : ""),
      `- failed runs: ${failed}${failed && !newestFailed && !flaky ? " (refusals are the publisher working, not breaking)" : ""}`,
    ];
    if (median && median > 1.5) {
      lines.push("", "The cron asks for twice an hour. Anything near this is github dropping",
                 "ticks, not a bug here — but it is what the corpus has to be designed around.");
    }
    return {
      name: "cadence",
      status: week.length === 0 ? "fail" : newestFailed || flaky ? "warn" : "ok",
      headline: week.length === 0
        ? "no snapshot runs in 7 days — is the workflow disabled?"
        : `${week.length} runs in 7d, ${sched.length} scheduled` + (median ? `, ~${median.toFixed(1)}h apart` : ""),
      lines,
    };
  } catch (e) {
    return { name: "cadence", status: "warn", headline: `could not read run history: ${e.message}`, lines: [] };
  }
}

/* ---------------- are the judgements saying anything ---------------- */
async function calibration() {
  if (OFFLINE) return { name: "calibration", status: "absent", skipped: true, headline: "skipped (--offline)", lines: [] };
  try {
    /* bounded on purpose: the whole corpus would be megabytes per loop
       run, and twenty moments is exactly where the dead-label gate opens */
    const { stdout } = await execFileP(process.execPath,
      ["tools/calibrate.mjs", "--json", "--fetch=20"], { cwd: ROOT, maxBuffer: 8e6 });
    const c = JSON.parse(stdout);
    const top = c.labels.filter((l) => l.count).slice(0, 5)
      .map((l) => `  - \`${l.label}\` — ${(l.share * 100).toFixed(0)}%`);
    const serious = c.flags.filter((f) => f.kind !== "very-rare");

    return {
      name: "calibration",
      status: serious.length ? "warn" : "ok",
      headline: `${c.moments} moment(s), ${c.coins} coin-observations, ${c.flags.length} flag(s)` +
        (c.enoughForDeadLabels ? "" : " — under 20 moments, silent labels not judged"),
      lines: [
        `_${c.note}_`, "",
        ...(c.span ? [`spanning ${c.span.hours}h, ${c.span.from} → ${c.span.to}`, ""] : []),
        "most common shapes:", ...top,
        `\ndivergent: **${(c.breadth.divergentShare * 100).toFixed(0)}%** of coin-observations`,
        ...(c.silentLabels.length ? ["", `not seen: ${c.silentLabels.map((l) => `\`${l}\``).join(", ")}` +
          (c.enoughForDeadLabels ? "" : " _(not evidence — see the note)_")] : []),
        ...(c.flags.length ? ["", "flags:", ...c.flags.map((f) => `  - **${f.kind}** \`${f.label}\` — ${f.why}`)] : []),
      ],
    };
  } catch (e) {
    return { name: "calibration", status: "warn", headline: `could not calibrate: ${e.message.split("\n")[0]}`, lines: [] };
  }
}

/* ---------------- is the archive growing, and is it bounded ---------------- */
async function corpus() {
  if (OFFLINE) return { name: "corpus", status: "absent", skipped: true, headline: "skipped (--offline)", lines: [] };
  try {
    const m = await get(`https://raw.githubusercontent.com/${REPO}/corpus/index.json`);
    const span = m.oldest && m.newest ? (new Date(m.newest) - new Date(m.oldest)) / 86_400_000 : 0;
    const perDay = span > 0.5 ? (m.entries / span).toFixed(1) : "—";
    const mb = (m.bytes / 1048576).toFixed(1);

    /* the number that decides whether calibration means anything yet */
    const enough = m.entries >= 20;
    return {
      name: "corpus",
      status: enough ? "ok" : "warn",
      headline: `${m.entries} ${m.entries === 1 ? "entry" : "entries"} over ${span.toFixed(1)}d (${mb}MB)` +
        (enough ? "" : " — under 20, too few to calibrate from"),
      lines: [
        `- oldest **${m.oldest}** · newest **${m.newest}** · ~${perDay}/day`,
        `- ${mb}MB of the ceiling · ${m.incidents} incident(s)`,
        `- retention: ${m.retention}`,
        ...(enough ? [] : ["",
          "Calibration holds its 'this label never fires' findings until 20 samples,",
          "so until then the loop is describing a moment rather than a distribution.",
          "Nothing to do but let it run."]),
      ],
    };
  } catch (e) {
    return {
      name: "corpus", status: "absent", stage: 1,
      headline: "no corpus branch yet — the first publish will start one",
      lines: [`_${e.message}_`],
    };
  }
}

/* ---------------- do the invariants still hold ---------------- */
async function scenarios() {
  try {
    const { stdout } = await execFileP(process.execPath, ["tools/scenarios.mjs"], { cwd: ROOT });
    const m = /(\d+)\/(\d+) invariants held over (\d+)/.exec(stdout);
    return {
      name: "scenarios",
      status: "ok",
      headline: m ? `${m[1]}/${m[2]} invariants held over ${m[3]} recorded day(s)` : "passed",
      lines: [],
    };
  } catch (e) {
    const out = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
    const failures = out.split("\n").filter((l) => l.includes("❌")).slice(0, 8);
    return {
      name: "scenarios",
      status: "fail",
      headline: /(\d+)\/(\d+) invariants held/.exec(out)?.[0] ?? "a recorded day broke an invariant",
      lines: ["```", ...failures, "```", "",
        "A recording that breaks an invariant means the invariant is wrong or the",
        "code is. Never edit the recording — it is a day that actually happened."],
    };
  }
}

/* ---------------- what can an agent actually get at ---------------- */
async function evals() {
  if (OFFLINE) return { name: "evals", status: "absent", skipped: true, headline: "skipped (--offline)", lines: [] };
  try {
    const { stdout } = await execFileP(process.execPath, ["tools/evals.mjs", "--json"], { cwd: ROOT, maxBuffer: 8e6 });
    const { board, diff } = JSON.parse(stdout);
    return {
      name: "evals",
      status: diff.ok ? (board.failed ? "warn" : "ok") : "fail",
      headline: `${board.answered}/${board.ran} answered in ${board.calls} calls · ` +
        `${board.backlog.length} still need a clone or a browser`,
      lines: [
        ...Object.entries(board.byTier).map(([t, n]) => `- ${n} answered from ${t}`),
        ...(board.backlog.length ? ["", "**the backlog, worst first:**",
          ...board.backlog.map((b) => `  - _${b.tier}_ — ${b.question}`)] : []),
        ...(diff.improvements.length ? ["", ...diff.improvements.map((i) => `⬆️ ${i.id}: ${i.why}`)] : []),
      ],
    };
  } catch (e) {
    /* a non-zero exit is a regression, which is the signal, not a crash */
    let parsed = null;
    try { parsed = JSON.parse(e.stdout ?? ""); } catch {}
    return {
      name: "evals",
      status: "fail",
      headline: parsed?.diff?.regressions?.length
        ? `${parsed.diff.regressions.length} question(s) got harder to answer`
        : `evals could not run: ${e.message.split("\n")[0]}`,
      lines: (parsed?.diff?.regressions ?? []).map((r) => `- **${r.id}** — ${r.why}`),
    };
  }
}

/* ---------------- the parts that do not exist yet ---------------- */
/* named, so their absence is a status rather than a silence */
const missing = () => [].filter((s) => !existsSync(join(ROOT, "tools", `${s.name}.mjs`)));

/* ---------------- go ---------------- */
const sections = [
  await suite(),
  fixtures(),
  await feed(),
  await cadence(),
  await corpus(),
  await scenarios(),
  await evals(),
  await calibration(),
  ...missing(),
];

if (flag("json")) console.log(JSON.stringify({ at: new Date().toISOString(), sections }, null, 2));
else if (flag("line")) console.log(renderLine(sections));
else console.log(renderMarkdown(sections, { runUrl: process.env.LOOP_RUN_URL || null }));
