/* ================================================================
   report — the loop's output, assembled.

   ROADMAP's next stage is a loop: replay real days, calibrate the
   judgements, score what an agent can actually answer, and then *say
   so somewhere an agent will read before it starts*. Without that
   last part it is a pile of scripts nobody runs.

   The awkward part is that most of the loop does not exist yet. A
   report that quietly omits its missing halves would read as "all
   green" — the most expensive kind of wrong in a repo whose entire
   testing philosophy is that silence must never pass for health. So
   an absent section is a *reported* section, with the stage number
   that would build it.

   Pure. Sections in, markdown and a verdict out.
   ================================================================ */

/** worst-first, because the verdict is the worst thing in the list */
const RANK = { fail: 0, warn: 1, absent: 2, ok: 3 };
const MARK = { fail: "❌", warn: "⚠️", absent: "·", ok: "✅" };

/**
 * A section: { name, status: ok|warn|fail|absent, headline, lines[], stage? }
 * `stage` is only for absent ones — which roadmap stage would build it.
 */
export function verdict(sections = []) {
  const worst = [...sections].filter((s) => !s.skipped)
    .sort((a, b) => RANK[a.status] - RANK[b.status])[0];
  if (!worst) return { status: "absent", first: null, why: "nothing ran" };

  /* "the first failure is the work" — so the report has to name one
     thing, not hand over a list and call it prioritised. A section
     skipped on request is not work: nobody asked for it. */
  const real = sections.filter((s) => !s.skipped);
  const first = real.find((s) => s.status === "fail")
    ?? real.find((s) => s.status === "warn")
    ?? real.find((s) => s.status === "absent")
    ?? null;

  return {
    status: worst.status,
    first: first?.name ?? null,
    why: first?.headline ?? "everything that exists is green",
  };
}

const bullet = (s) => `- ${MARK[s.status]} **${s.name}** — ${s.headline}`;

export function renderMarkdown(sections = [], { at = new Date(), runUrl = null } = {}) {
  const v = verdict(sections);
  const L = [];

  L.push(v.status === "ok"
    ? "Everything that exists is green."
    : `**Start here: ${v.first}** — ${v.why}`);
  L.push("");
  L.push("| | section | |");
  L.push("|---|---|---|");
  for (const s of sections) {
    L.push(`| ${MARK[s.status]} | ${s.name} | ${s.headline} |`);
  }
  L.push("");

  for (const s of sections) {
    if (!s.lines?.length) continue;
    L.push(`### ${MARK[s.status]} ${s.name}`);
    L.push("");
    L.push(...s.lines);
    L.push("");
  }

  const absent = sections.filter((s) => s.status === "absent" && !s.skipped);
  if (absent.length) {
    L.push("### not built yet");
    L.push("");
    L.push("These are the parts of the loop that would close it. Absent is a");
    L.push("status, not a pass — nothing below has been checked at all.");
    L.push("");
    for (const s of absent) L.push(`- **${s.name}** — ${s.headline}${s.stage ? ` *(roadmap stage ${s.stage})*` : ""}`);
    L.push("");
  }

  L.push("---");
  L.push(`Generated ${at.toISOString()} by \`npm run loop\`.` +
    (runUrl ? ` [run](${runUrl})` : "") +
    " Reports rather than blocks: a red section is a thing to go and look at, not a broken build.");
  return L.join("\n");
}

/** one line for a terminal, for the agent that ran this locally */
export function renderLine(sections = []) {
  const v = verdict(sections);
  const counts = sections.reduce((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {});
  const tally = ["ok", "warn", "fail", "absent"].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(" · ");
  return `${MARK[v.status]} ${tally}${v.first ? ` — start here: ${v.first}` : ""}`;
}

export { bullet };
